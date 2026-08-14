// Experiments: the research workbench's dispatcher and its results.
//
// AN EXPERIMENT RUNS AS TREE NODES. That is the owner's amendment: the
// research page defines the spec and reads the results, and every worker it
// launches is a first-class node on the computers page — same store, same
// start contract, same streaming chips, same interrupt — never a hidden
// process this page owns privately. One experiment dispatches one tree; its
// cells are the root node and up to seven siblings under it (TREE_BOUNDS
// caps children at eight, and honesty about the cap beats paginating trees).
//
// RESULTS ARE THIS MODULE'S OWN RECORD. The tree keeps a node's latest reply
// only while the computers view is mounted to file it; experiments need their
// outcomes durable regardless of which page is open. So a module-level
// listener — it outlives every view — files each tracked session's outcome
// into ONE bounded account row (research_experiments), and touches the TREE
// only when no view holds a live store instance (markTreeStoreLive in
// src/fleet-trees.js): a store persists blob-for-blob, and a second live
// writer would silently discard the first one's work.
//
// The dataset path in a spec is TEXT the owner supplies. It is substituted
// into the worker's brief; the worker reads it under its own confinement.
// This module never opens it, and the R198 fence never comes near this file.

import {
  createFleetTreeStore,
  isTreeStoreLive,
  markTreeStoreLive,
  safeTreeStorage,
} from './fleet-trees.js'
import { sessionEventText, sessionTurnStatus } from './agent-session-events.js'

export const RESEARCH_EXPERIMENTS_ROW_KEY = 'research_experiments'
export const RESEARCH_EXPERIMENTS_EVENT = 'mc:research-experiments-changed'

/* The free cut runs one machine; the fleet face names it this-computer, and
   the tree store key carries the same id (verified on the installed build). */
export const EXPERIMENT_COMPUTER_ID = 'this-computer'

const MAX_EXPERIMENTS = 12
const MAX_CELLS = 8
const MAX_RUNS_PER_TIER = 3
const EXCERPT_CHARS = 400
const MAX_SERIALIZED = 60_000
const CAPS = Object.freeze({ name: 120, promptTemplate: 2000, datasetPath: 400 })

function cleanText(value, cap) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > cap) return null
  return trimmed
}

/* ---------- the row ---------- */

export function parseExperimentsRow(raw) {
  const empty = { experiments: [], damaged: false }
  if (raw === null || raw === undefined || raw === '') return empty
  let parsed
  try { parsed = JSON.parse(raw) } catch { return { ...empty, damaged: true } }
  if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.experiments)) return { ...empty, damaged: true }
  const experiments = parsed.experiments.filter(experiment => experiment
    && typeof experiment === 'object'
    && typeof experiment.id === 'string'
    && cleanText(experiment.name, CAPS.name)
    && cleanText(experiment.promptTemplate, CAPS.promptTemplate)
    && Array.isArray(experiment.cells))
  return { experiments, damaged: false }
}

export function serializeExperimentsRow({ experiments }) {
  if (experiments.length === 0) return null
  return JSON.stringify({ v: 1, experiments })
}

/* ---------- building a spec ---------- */

export function buildExperiment({ name, promptTemplate, datasetPath, tiers, runsPerTier }, existing) {
  const cleanName = cleanText(name, CAPS.name)
  if (!cleanName) return { ok: false, sentence: `Name the experiment first — up to ${CAPS.name} characters.` }
  const cleanTemplate = cleanText(promptTemplate, CAPS.promptTemplate)
  if (!cleanTemplate) return { ok: false, sentence: `Write the task each worker runs first — up to ${CAPS.promptTemplate} characters.` }
  let cleanDataset = null
  if (!(datasetPath === '' || datasetPath === null || datasetPath === undefined)) {
    cleanDataset = cleanText(datasetPath, CAPS.datasetPath)
    if (!cleanDataset) return { ok: false, sentence: `A dataset path fits in ${CAPS.datasetPath} characters.` }
  }
  const tierList = Array.isArray(tiers) ? tiers.filter(tier => typeof tier === 'string' && tier.length > 0) : []
  if (tierList.length === 0) return { ok: false, sentence: 'Pick at least one model tier to run on.' }
  const runs = Number.isInteger(runsPerTier) && runsPerTier >= 1 && runsPerTier <= MAX_RUNS_PER_TIER
    ? runsPerTier
    : null
  if (!runs) return { ok: false, sentence: `Runs per tier is a whole number from 1 to ${MAX_RUNS_PER_TIER}.` }
  const cellCount = tierList.length * runs
  if (cellCount > MAX_CELLS) {
    return { ok: false, sentence: `One experiment runs at most ${MAX_CELLS} workers — one tree of nodes. Fewer tiers or fewer runs.` }
  }
  if (existing.experiments.length >= MAX_EXPERIMENTS) {
    return { ok: false, sentence: `This bench holds at most ${MAX_EXPERIMENTS} experiments. Remove one first.` }
  }
  const cells = []
  for (const tier of tierList) {
    for (let run = 1; run <= runs; run += 1) {
      cells.push({ tier, run, status: 'designed', sessionId: null, nodeId: null, startedAtMs: null, endedAtMs: null, replyExcerpt: '' })
    }
  }
  const experiment = {
    id: `exp-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${existing.experiments.length}`}`,
    name: cleanName,
    promptTemplate: cleanTemplate,
    datasetPath: cleanDataset,
    createdAtMs: Date.now(),
    treeId: null,
    cells,
  }
  const next = { experiments: [...existing.experiments, experiment] }
  const serialized = serializeExperimentsRow(next)
  if (serialized && serialized.length > MAX_SERIALIZED) {
    return { ok: false, sentence: 'Your experiments have filled the space this account file gives them. Remove one first.' }
  }
  return { ok: true, experiment, next, serialized }
}

export function removeExperiment(state, id) {
  const remaining = state.experiments.filter(experiment => experiment.id !== id)
  if (remaining.length === state.experiments.length) return { ok: false, sentence: 'That experiment is not on this bench.' }
  const next = { experiments: remaining }
  return { ok: true, next, serialized: serializeExperimentsRow(next) }
}

/** The brief one worker receives: the template with {dataset} substituted.
 *  Text substitution only — the worker reads the path under its own
 *  confinement, exactly like a path typed into the compose panel. */
export function workerBrief(experiment, cell) {
  const dataset = experiment.datasetPath || ''
  const base = experiment.promptTemplate.split('{dataset}').join(dataset)
  return `${base}\n\n(Experiment "${experiment.name}", ${cell.tier} run ${cell.run}. Reply with your result.)`
}

/* ---------- the dispatcher ---------- */

/* Module-level: tracked sessions outlive the research view. */
const tracked = new Map()   // sessionId -> { experimentId, cellIndex }
const transcripts = new Map() // sessionId -> accumulated text (capped)
let listenerUnsub = null
let persistImpl = null      // set per dispatch; the account bridge outlives views

function announce() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(RESEARCH_EXPERIMENTS_EVENT))
}

/* The in-memory copy of the row, authoritative between persists. The view
   seeds it on mount from the account row; dispatch and the listener mutate
   and persist it. */
let state = { experiments: [], damaged: false }

export function seedExperiments(parsed) {
  state = { experiments: parsed.experiments.slice(), damaged: parsed.damaged }
}

export function experimentsSnapshot() {
  return { experiments: state.experiments.slice(), damaged: state.damaged }
}

async function persistState() {
  if (!persistImpl) return
  try { await persistImpl(serializeExperimentsRow(state)) } catch {}
}

function fileOutcome(sessionId, status) {
  const track = tracked.get(sessionId)
  if (!track) return
  tracked.delete(sessionId)
  const experiment = state.experiments.find(candidate => candidate.id === track.experimentId)
  const cell = experiment?.cells?.[track.cellIndex]
  const text = (transcripts.get(sessionId) || '').trim()
  transcripts.delete(sessionId)
  if (!cell) return
  cell.status = status === 'completed' ? 'finished' : 'failed'
  cell.endedAtMs = Date.now()
  cell.replyExcerpt = text.slice(-EXCERPT_CHARS)
  persistState()
  announce()

  /* The tree's copy of the same outcome — only when no view holds a live
     store. A mounted computers view files its own nodes through its own
     listener; writing beside it would clobber the whole record. */
  if (cell.nodeId && !isTreeStoreLive(EXPERIMENT_COMPUTER_ID)) {
    try {
      const release = markTreeStoreLive(EXPERIMENT_COMPUTER_ID)
      const store = createFleetTreeStore({
        computerId: EXPERIMENT_COMPUTER_ID,
        storage: safeTreeStorage(typeof window === 'undefined' ? null : window.localStorage),
      })
      if (text) store.setNodeReply(cell.nodeId, text)
      store.setNodeStatus(cell.nodeId, cell.status, { note: '' })
      release()
    } catch {
      /* The result is already durable in the experiments row; a tree that
         could not be opened here files nothing and the computers view will
         re-learn the session on its next mount. */
    }
  }
}

function ensureListener(agent) {
  if (listenerUnsub || typeof agent?.onEvent !== 'function') return
  listenerUnsub = agent.onEvent(packet => {
    const sessionId = packet?.sessionId
    if (!sessionId || !tracked.has(sessionId)) return
    const event = packet.event
    const delta = sessionEventText(packet, sessionId)
    if (delta) {
      const held = transcripts.get(sessionId) || ''
      transcripts.set(sessionId, (held + delta).slice(-EXCERPT_CHARS * 4))
    } else if (event?.type === 'assistant_text' && typeof event.text === 'string') {
      transcripts.set(sessionId, event.text.slice(-EXCERPT_CHARS * 4))
    }
    const status = sessionTurnStatus(packet, sessionId)
    if (status) fileOutcome(sessionId, status)
  })
}

/**
 * Dispatch one experiment: a fresh tree, one node per cell, one session per
 * node — sequentially, because the engine host bounds concurrent sessions and
 * a refusal mid-way must leave a truthful board, not a guessed one. Returns
 * per-cell outcomes; cells refused at start read 'failed' with the sentence.
 */
export async function dispatchExperiment(experimentId, { agent, persist, startAgent } = {}) {
  const experiment = state.experiments.find(candidate => candidate.id === experimentId)
  if (!experiment) return { ok: false, sentence: 'That experiment is not on this bench.' }
  if (experiment.cells.some(cell => cell.status === 'running' || cell.status === 'starting')) {
    return { ok: false, sentence: 'This experiment is already running. Watch it on the run board.' }
  }
  if (typeof startAgent !== 'function' || typeof persist !== 'function') {
    return { ok: false, sentence: 'This copy cannot start workers from the bench. Open ToolsEnabled from its installed app.' }
  }
  persistImpl = persist
  ensureListener(agent)

  let store
  let release = () => {}
  try {
    release = markTreeStoreLive(EXPERIMENT_COMPUTER_ID)
    store = createFleetTreeStore({
      computerId: EXPERIMENT_COMPUTER_ID,
      storage: safeTreeStorage(typeof window === 'undefined' ? null : window.localStorage),
    })
  } catch {
    release()
    return { ok: false, sentence: 'The saved trees for this computer could not be opened, so no workers were started.' }
  }

  try {
    let rootId = null
    for (let index = 0; index < experiment.cells.length; index += 1) {
      const cell = experiment.cells[index]
      const added = store.addNode({
        treeId: rootId ? experiment.treeId : null,
        parentId: rootId,
        role: 'helper',
        message: workerBrief(experiment, cell),
      })
      if (!added.ok) {
        cell.status = 'failed'
        cell.replyExcerpt = added.problems?.[0] || 'The tree could not take this worker, so this cell did not run. Make room on the computers page, then run it again.'
        continue
      }
      if (!rootId) {
        rootId = added.node.id
        experiment.treeId = added.node.treeId
      }
      cell.nodeId = added.node.id
      cell.status = 'starting'
      cell.startedAtMs = Date.now()

      const started = await startAgent({ text: workerBrief(experiment, cell), surface: 'research-experiment', tier: cell.tier })
      if (!started || started.ok === false || typeof started.sessionId !== 'string' || started.sessionId.length === 0) {
        /* The fourth outcome shape: a session that IS open whose brief did
           not land. The node keeps the session's name, exactly as the
           compose panel would — an agent running on this computer with
           nothing on screen pointing at it is the defect that rule closed. */
        if (started && typeof started.sessionId === 'string' && started.sessionId.length > 0) {
          store.attachSession(added.node.id, started.sessionId)
        }
        cell.status = 'failed'
        cell.endedAtMs = Date.now()
        cell.replyExcerpt = started?.sentence || 'The worker did not start, and this copy was not told why.'
        store.setNodeStatus(added.node.id, 'failed', { note: '' })
        continue
      }
      cell.sessionId = started.sessionId
      cell.status = 'running'
      tracked.set(started.sessionId, { experimentId: experiment.id, cellIndex: index })
      store.attachSession(added.node.id, started.sessionId)
      store.setNodeStatus(added.node.id, 'running', { note: '' })
    }
  } finally {
    release()
  }

  await persistState()
  announce()
  const startedCount = experiment.cells.filter(cell => cell.status === 'running').length
  return { ok: true, startedCount, total: experiment.cells.length, treeId: experiment.treeId }
}

/* Test seam: the module-level maps outlive suites otherwise. */
export function resetExperimentTracking() {
  tracked.clear()
  transcripts.clear()
  listenerUnsub?.()
  listenerUnsub = null
  persistImpl = null
  state = { experiments: [], damaged: false }
}
