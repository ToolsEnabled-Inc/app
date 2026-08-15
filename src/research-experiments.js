// Experiments: the research workbench's dispatcher and its results.
//
// ONE EXPERIMENT MODEL (v2). An experiment is a grid — axes × values ×
// runsPerCell — with a runner and result columns as data. Where it RUNS is a
// decision, not a second system: an agent-runner experiment of at most eight
// cells runs LOCALLY as fleet-tree nodes on the computers page (the owner's
// amendment, unchanged: same store, same start contract, same streaming
// chips, same interrupt); anything larger, and every process or http
// experiment, goes to the durable run queue through the research service.
//
// The account row upgrades v1 on read: tiers become the reserved 'tier' axis,
// runsPerTier becomes runsPerCell, and every cell's {tier, run} becomes
// params — in the same array order, because the module-level tracked map
// indexes into it. The row rewrites itself as v2 on the next persist.
//
// RESULTS ARE THIS MODULE'S OWN RECORD for local cells. The tree keeps a
// node's latest reply only while the computers view is mounted to file it;
// experiments need their outcomes durable regardless of which page is open.
// So a module-level listener — it outlives every view — files each tracked
// session's outcome into ONE bounded account row (research_experiments), and
// touches the TREE only when no view holds a live store instance
// (markTreeStoreLive in src/fleet-trees.js). Queued cells resolve on the
// service run board instead; their local status stays 'queued'.
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
import { DEFAULT_RESULT_SCHEMA, cellBrief, cellLabel, gridCells } from './research-grid.js'
import { submitRun } from './research-runs.js'

export const RESEARCH_EXPERIMENTS_ROW_KEY = 'research_experiments'
export const RESEARCH_EXPERIMENTS_EVENT = 'mc:research-experiments-changed'

/* The free cut runs one machine; the fleet face names it this-computer, and
   the tree store key carries the same id (verified on the installed build). */
export const EXPERIMENT_COMPUTER_ID = 'this-computer'

const MAX_EXPERIMENTS = 12
/* The tree bound: one experiment tree is the root and up to seven siblings.
   No longer a build refusal — a bigger grid goes to the run queue instead. */
export const MAX_LOCAL_CELLS = 8
const MAX_QUEUE_CELLS = 512
const MAX_RUNS_PER_CELL = 5
const EXCERPT_CHARS = 400
const MAX_SERIALIZED = 60_000
const CAPS = Object.freeze({ name: 120, briefTemplate: 2000, datasetPath: 400 })

function cleanText(value, cap) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > cap) return null
  return trimmed
}

/* ---------- the row ---------- */

function freshCell(params) {
  return { params, status: 'designed', sessionId: null, nodeId: null, runId: null, startedAtMs: null, endedAtMs: null, replyExcerpt: '' }
}

/* v1 → v2, order-preserving: the tracked map holds cell INDEXES, so a cell may
   change shape here but never position. */
function upgradeV1Experiment(experiment) {
  const tiers = []
  let maxRun = 1
  for (const cell of experiment.cells) {
    if (typeof cell?.tier === 'string' && !tiers.includes(cell.tier)) tiers.push(cell.tier)
    if (Number.isInteger(cell?.run) && cell.run > maxRun) maxRun = cell.run
  }
  return {
    id: experiment.id,
    name: experiment.name,
    axes: [{ id: 'tier', values: tiers.length ? tiers : ['unspecified'] }],
    runner: { kind: 'agent', briefTemplate: experiment.promptTemplate },
    resultSchema: DEFAULT_RESULT_SCHEMA,
    runsPerCell: maxRun,
    datasetPath: experiment.datasetPath ?? null,
    projectId: null,
    serviceExperimentId: null,
    createdAtMs: experiment.createdAtMs,
    treeId: experiment.treeId ?? null,
    cells: experiment.cells.map(cell => ({
      params: { tier: cell.tier, ...(maxRun > 1 ? { replicate: cell.run } : {}) },
      status: cell.status, sessionId: cell.sessionId ?? null, nodeId: cell.nodeId ?? null,
      runId: null, startedAtMs: cell.startedAtMs ?? null, endedAtMs: cell.endedAtMs ?? null,
      replyExcerpt: cell.replyExcerpt ?? '',
    })),
  }
}

function validV1(experiment) {
  return experiment
    && typeof experiment === 'object'
    && typeof experiment.id === 'string'
    && cleanText(experiment.name, CAPS.name)
    && cleanText(experiment.promptTemplate, CAPS.briefTemplate)
    && Array.isArray(experiment.cells)
}

/* The parse gate enforces exactly what the renderers dereference: a stored
   row is a trust boundary (partial write, older build, another device), and
   one malformed experiment must drop HERE — not survive to blank the whole
   bench with a render throw. */
function validV2(experiment) {
  return experiment
    && typeof experiment === 'object'
    && typeof experiment.id === 'string'
    && cleanText(experiment.name, CAPS.name)
    && experiment.runner && typeof experiment.runner === 'object'
    && typeof experiment.runner.kind === 'string'
    && (experiment.runner.kind !== 'agent' || cleanText(experiment.runner.briefTemplate, CAPS.briefTemplate))
    && Array.isArray(experiment.axes)
    && experiment.axes.every(axis => axis && typeof axis === 'object'
      && typeof axis.id === 'string' && Array.isArray(axis.values) && axis.values.length > 0)
    && Array.isArray(experiment.cells)
    && experiment.cells.every(cell => cell && typeof cell === 'object'
      && cell.params && typeof cell.params === 'object' && typeof cell.status === 'string')
}

export function parseExperimentsRow(raw) {
  const empty = { experiments: [], damaged: false }
  if (raw === null || raw === undefined || raw === '') return empty
  let parsed
  try { parsed = JSON.parse(raw) } catch { return { ...empty, damaged: true } }
  if (parsed && parsed.v === 2 && Array.isArray(parsed.experiments)) {
    return { experiments: parsed.experiments.filter(validV2), damaged: false }
  }
  if (parsed && parsed.v === 1 && Array.isArray(parsed.experiments)) {
    return { experiments: parsed.experiments.filter(validV1).map(upgradeV1Experiment), damaged: false }
  }
  return { ...empty, damaged: true }
}

export function serializeExperimentsRow({ experiments }) {
  if (experiments.length === 0) return null
  return JSON.stringify({ v: 2, experiments })
}

/* ---------- building a spec ---------- */

/**
 * Build one v2 experiment from already-parsed shapes: the view runs
 * parseAxes/parseRunner/parseResultSchema first, so every refusal here is
 * about the combination, not the pieces.
 */
export function buildExperiment({ name, axes, runner, resultSchema, runsPerCell, datasetPath, projectId }, existing) {
  const cleanName = cleanText(name, CAPS.name)
  if (!cleanName) return { ok: false, sentence: `Name the experiment first — up to ${CAPS.name} characters.` }
  let cleanDataset = null
  if (!(datasetPath === '' || datasetPath === null || datasetPath === undefined)) {
    cleanDataset = cleanText(datasetPath, CAPS.datasetPath)
    if (!cleanDataset) return { ok: false, sentence: `A dataset path fits in ${CAPS.datasetPath} characters.` }
  }
  if (!Array.isArray(axes) || axes.length === 0) {
    return { ok: false, sentence: 'The grid needs at least one axis with values.' }
  }
  if (!runner || typeof runner !== 'object' || typeof runner.kind !== 'string') {
    return { ok: false, sentence: 'Pick how this experiment runs: sessions, a command, or a web address.' }
  }
  if (runner.kind === 'agent' && !axes.some(axis => axis.id === 'tier' && axis.values.length > 0)) {
    return { ok: false, sentence: 'Give this experiment a tier axis — pick at least one model tier to run on.' }
  }
  const runs = Number.isInteger(runsPerCell) && runsPerCell >= 1 && runsPerCell <= MAX_RUNS_PER_CELL
    ? runsPerCell
    : null
  if (!runs) return { ok: false, sentence: `Repeats per cell is a whole number from 1 to ${MAX_RUNS_PER_CELL}.` }
  const cells = gridCells(axes, { replicates: runs }).map(freshCell)
  if (cells.length > MAX_QUEUE_CELLS) {
    return { ok: false, sentence: `That grid is ${cells.length} runs counting repeats; this bench submits at most ${MAX_QUEUE_CELLS} per experiment. Trim an axis or the repeats.` }
  }
  if (runner.kind === 'agent') {
    // An unknown {token} is refused at design time, never discovered mid-run.
    const probe = cellBrief(runner.briefTemplate, { ...cells[0].params, dataset: cleanDataset ?? '' })
    if (!probe.ok) return probe
  }
  if (existing.experiments.length >= MAX_EXPERIMENTS) {
    return { ok: false, sentence: `This bench holds at most ${MAX_EXPERIMENTS} experiments. Remove one first.` }
  }
  const experiment = {
    id: `exp-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${existing.experiments.length}`}`,
    name: cleanName,
    axes,
    runner,
    resultSchema: resultSchema || DEFAULT_RESULT_SCHEMA,
    runsPerCell: runs,
    datasetPath: cleanDataset,
    projectId: typeof projectId === 'string' ? projectId : null,
    serviceExperimentId: null,
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

/** The brief one worker receives: the template with every {axis} token and
 *  {dataset} substituted from the cell. Text substitution only — the worker
 *  reads any path under its own confinement. A v1-upgraded row whose prose
 *  happens to contain a stray {token} falls back to the old plain {dataset}
 *  substitution, so every v1 template keeps running exactly as before. */
export function workerBrief(experiment, cell) {
  const dataset = experiment.datasetPath || ''
  const trailer = `\n\n(Experiment "${experiment.name}", ${cellLabel(experiment.axes, cell.params)}. Reply with your result.)`
  const built = cellBrief(experiment.runner.briefTemplate, { ...cell.params, dataset })
  if (built.ok) return `${built.text}${trailer}`
  return `${experiment.runner.briefTemplate.split('{dataset}').join(dataset)}${trailer}`
}

/* ---------- where an experiment runs ---------- */

/**
 * The one dispatch decision, pure: an agent-runner grid of at most
 * MAX_LOCAL_CELLS runs locally as tree nodes (no project needed — the tree
 * knows nothing of projects); everything else is queued through the research
 * service, and queued work is always filed under a project.
 */
export function decideDispatch(experiment, { projectId = experiment.projectId } = {}) {
  if (experiment.runner.kind === 'agent' && experiment.cells.length <= MAX_LOCAL_CELLS) {
    return { ok: true, mode: 'local' }
  }
  if (typeof projectId === 'string' && projectId.length > 0) {
    return { ok: true, mode: 'queue', projectId }
  }
  return { ok: false, sentence: 'Queued runs are filed under a project — pick one above, then run it again.' }
}

/** Runner declaration → the service's runner config, one place. */
export function runnerConfigFor(runner) {
  if (runner.kind === 'agent') return { briefTemplate: runner.briefTemplate }
  if (runner.kind === 'process') return { command: runner.command, args: runner.args || [], stdin: 'none' }
  return { url: runner.url }
}

function collectorFor(runner) {
  return runner.kind === 'agent' ? { kind: 'none' } : { kind: 'stdout-json', recordKind: 'summary' }
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
 * Dispatch one experiment locally: a fresh tree, one node per cell, one
 * session per node — sequentially, because the engine host bounds concurrent
 * sessions and a refusal mid-way must leave a truthful board, not a guessed
 * one. Returns per-cell outcomes; cells refused at start read 'failed' with
 * the sentence. Only the decide guard is new; the tree flow is v1's.
 */
export async function dispatchExperiment(experimentId, { agent, persist, startAgent } = {}) {
  const experiment = state.experiments.find(candidate => candidate.id === experimentId)
  if (!experiment) return { ok: false, sentence: 'That experiment is not on this bench.' }
  if (decideDispatch(experiment).mode !== 'local') {
    return { ok: false, sentence: 'This grid is queue-sized. Use its queue control instead — the run board follows it there.' }
  }
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

      const started = await startAgent({ text: workerBrief(experiment, cell), surface: 'research-experiment', tier: cell.params.tier })
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

/**
 * Submit a queue-sized (or process/http) experiment's designed cells to the
 * research service. The first cell carries the full declaration inline; the
 * service registers or matches it by configuration, and every later cell
 * submits by the captured service experiment id so two same-config
 * experiments cannot silently share one mid-loop. A refused cell stays
 * 'designed' — the honest state — and the first refusal sentence rides back.
 */
export async function submitExperimentRuns(experimentId, { submit = submitRun, persist, projectId } = {}) {
  const experiment = state.experiments.find(candidate => candidate.id === experimentId)
  if (!experiment) return { ok: false, sentence: 'That experiment is not on this bench.' }
  const decision = decideDispatch(experiment, { projectId })
  if (!decision.ok) return decision
  if (decision.mode !== 'queue') {
    return { ok: false, sentence: 'This grid runs here as sessions. Use its Run control instead.' }
  }
  if (typeof persist === 'function') persistImpl = persist
  if (!experiment.projectId) experiment.projectId = decision.projectId

  const spec = {
    projectId: experiment.projectId,
    name: experiment.name,
    runnerKind: experiment.runner.kind,
    runnerConfig: runnerConfigFor(experiment.runner),
    resultSchema: experiment.resultSchema,
    collector: collectorFor(experiment.runner),
  }
  let submitted = 0
  let replayed = 0
  let sentence = null
  for (const cell of experiment.cells) {
    if (cell.status !== 'designed') continue
    const body = experiment.serviceExperimentId
      ? { experimentId: experiment.serviceExperimentId, params: cell.params }
      : { experiment: spec, params: cell.params }
    const outcome = await submit(body)
    if (outcome.ok !== true) {
      if (!sentence) sentence = outcome.reason || 'the research service refused a run'
      continue
    }
    if (!experiment.serviceExperimentId && outcome.experiment?.experimentId) {
      experiment.serviceExperimentId = outcome.experiment.experimentId
    }
    cell.status = 'queued'
    cell.runId = outcome.run.runId
    if (outcome.disposition === 'replay') replayed += 1
    else submitted += 1
  }
  await persistState()
  announce()
  return { ok: true, submitted, replayed, total: experiment.cells.length, sentence }
}

/* Display truth for queue-dispatched cells. The account row keeps 'queued'
   by design (the service run board owns resolution — see the header note),
   but the gathered panel must not show 'queued' beside a service run that
   already finished. Pure translation for rendering; nothing is mutated and
   nothing is persisted. Unknown service words pass through untranslated —
   an honest unfamiliar word beats a familiar wrong one. */
const SERVICE_CELL_WORDS = Object.freeze({
  succeeded: 'finished', failed: 'failed', running: 'running', claimed: 'running', queued: 'queued',
})
export function cellsWithServiceStatus(experiment, runs) {
  const statusByRunId = new Map((Array.isArray(runs) ? runs : [])
    .filter(run => run && typeof run.runId === 'string' && run.task && typeof run.task.status === 'string')
    .map(run => [run.runId, run.task.status]))
  return experiment.cells.map(cell => {
    if (cell.status !== 'queued' || !cell.runId || !statusByRunId.has(cell.runId)) return cell
    const service = statusByRunId.get(cell.runId)
    return { ...cell, status: SERVICE_CELL_WORDS[service] || service }
  })
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
