import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

import {
  EXPERIMENT_COMPUTER_ID,
  buildExperiment,
  dispatchExperiment,
  experimentsSnapshot,
  parseExperimentsRow,
  removeExperiment,
  resetExperimentTracking,
  seedExperiments,
  serializeExperimentsRow,
  workerBrief,
} from '../../src/research-experiments.js'
import { createFleetTreeStore, isTreeStoreLive, markTreeStoreLive, safeTreeStorage } from '../../src/fleet-trees.js'

/* The bench's dispatcher: an experiment is a tree of real worker nodes, its
   results are a bounded account row, and nothing here may write beside a live
   view's store instance. */

const ROOT = resolve(import.meta.dirname, '..', '..')
const read = file => readFileSync(resolve(ROOT, file), 'utf8')

const EMPTY = Object.freeze({ experiments: [], damaged: false })
const SPEC = Object.freeze({
  name: 'Tokenizer drift sweep',
  promptTemplate: 'Read {dataset} and report the drift.',
  datasetPath: 'C:/data/drift.jsonl',
  tiers: ['luna', 'terra'],
  runsPerTier: 2,
})

function memoryStorage() {
  const map = new Map()
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)) },
    removeItem: key => { map.delete(key) },
  }
}

test('a spec builds bounded cells, and every refusal is a sentence', () => {
  const built = buildExperiment(SPEC, EMPTY)
  assert.equal(built.ok, true)
  assert.equal(built.experiment.cells.length, 4, 'two tiers times two runs')
  assert.ok(built.experiment.cells.every(cell => cell.status === 'designed'))
  const noTier = buildExperiment({ ...SPEC, tiers: [] }, EMPTY)
  assert.equal(noTier.ok, false)
  assert.match(noTier.sentence, /at least one model tier/)
  const tooWide = buildExperiment({ ...SPEC, tiers: ['a', 'b', 'c'], runsPerTier: 3 }, EMPTY)
  assert.equal(tooWide.ok, false)
  assert.match(tooWide.sentence, /at most 8 workers/, 'the tree-bounds cap is stated, not silently truncated')
  const badRuns = buildExperiment({ ...SPEC, runsPerTier: 0 }, EMPTY)
  assert.equal(badRuns.ok, false)
})

test('the brief substitutes the dataset as TEXT and names the cell', () => {
  const built = buildExperiment(SPEC, EMPTY)
  const brief = workerBrief(built.experiment, built.experiment.cells[0])
  assert.match(brief, /C:\/data\/drift\.jsonl/)
  assert.match(brief, /luna run 1/)
  assert.ok(!brief.includes('{dataset}'))
})

test('the row round-trips and damage is stated', () => {
  const built = buildExperiment(SPEC, EMPTY)
  const parsed = parseExperimentsRow(serializeExperimentsRow(built.next))
  assert.equal(parsed.experiments.length, 1)
  assert.equal(parsed.experiments[0].name, SPEC.name)
  assert.equal(parseExperimentsRow('broken').damaged, true)
  assert.equal(parseExperimentsRow(null).damaged, false)
  assert.equal(serializeExperimentsRow({ experiments: [] }), null)
  const removed = removeExperiment(built.next, built.experiment.id)
  assert.equal(removed.ok, true)
  assert.equal(removed.serialized, null)
})

test('dispatch builds one tree of real nodes and starts one worker per cell', async () => {
  resetExperimentTracking()
  const storage = memoryStorage()
  const originalWindow = globalThis.window
  globalThis.window = { localStorage: storage, dispatchEvent: () => {}, addEventListener: () => {}, removeEventListener: () => {} }
  try {
    const built = buildExperiment(SPEC, EMPTY)
    seedExperiments({ experiments: built.next.experiments, damaged: false })
    const startedBriefs = []
    let persisted = null
    const outcome = await dispatchExperiment(built.experiment.id, {
      agent: { onEvent: () => () => {} },
      persist: serialized => { persisted = serialized },
      startAgent: async ({ text, surface, tier }) => {
        startedBriefs.push({ text, surface, tier })
        return { ok: true, sessionId: `chat-test-${startedBriefs.length}` }
      },
    })
    assert.equal(outcome.ok, true)
    assert.equal(outcome.startedCount, 4)
    assert.equal(startedBriefs.length, 4)
    assert.ok(startedBriefs.every(request => request.surface === 'research-experiment'))
    assert.deepEqual(startedBriefs.map(request => request.tier), ['luna', 'luna', 'terra', 'terra'])

    /* What dispatch WROTE is read from the raw record: running, with the
       session attached. A fresh store instance deliberately demotes a
       persisted 'running' to 'starting' on load (a run it did not witness is
       not one it may claim), so the rehydrated read asserts THAT. */
    const raw = storage.getItem('mc.fleet.trees.v1:this-computer') || ''
    assert.equal((raw.match(/"status":"running"/g) || []).length, 4, 'dispatch did not record four running workers')
    const store = createFleetTreeStore({ computerId: EXPERIMENT_COMPUTER_ID, storage: safeTreeStorage(storage) })
    const snapshot = store.snapshot()
    const nodes = snapshot.nodes.filter(node => node.sessionId)
    assert.equal(nodes.length, 4, 'every cell landed as a session-bearing node')
    assert.equal(new Set(nodes.map(node => node.treeId)).size, 1, 'one experiment is one tree')
    assert.ok(nodes.every(node => node.status === 'starting'),
      'a fresh instance rehydrates running as starting — the honest unwitnessed state')
    assert.equal(typeof persisted, 'string', 'the results row was persisted after dispatch')
    const snapshotState = experimentsSnapshot()
    assert.ok(snapshotState.experiments[0].cells.every(cell => cell.status === 'running'))
  } finally {
    globalThis.window = originalWindow
    resetExperimentTracking()
  }
})

test('a refused start fails its cell with the sentence and the rest continue', async () => {
  resetExperimentTracking()
  const storage = memoryStorage()
  const originalWindow = globalThis.window
  globalThis.window = { localStorage: storage, dispatchEvent: () => {}, addEventListener: () => {}, removeEventListener: () => {} }
  try {
    const built = buildExperiment({ ...SPEC, tiers: ['luna'], runsPerTier: 2 }, EMPTY)
    seedExperiments({ experiments: built.next.experiments, damaged: false })
    let calls = 0
    const outcome = await dispatchExperiment(built.experiment.id, {
      agent: { onEvent: () => () => {} },
      persist: () => {},
      startAgent: async () => {
        calls += 1
        if (calls === 1) return { ok: false, sessionId: null, sentence: 'Nothing was started for this test.' }
        return { ok: true, sessionId: 'chat-test-second' }
      },
    })
    assert.equal(outcome.ok, true)
    assert.equal(outcome.startedCount, 1)
    const cells = experimentsSnapshot().experiments[0].cells
    assert.equal(cells[0].status, 'failed')
    assert.match(cells[0].replyExcerpt, /Nothing was started/)
    assert.equal(cells[1].status, 'running')
  } finally {
    globalThis.window = originalWindow
    resetExperimentTracking()
  }
})

test('the live-store registry refuses a second writer and releases exactly once', () => {
  assert.equal(isTreeStoreLive('probe-computer'), false)
  const release = markTreeStoreLive('probe-computer')
  assert.equal(isTreeStoreLive('probe-computer'), true)
  const second = markTreeStoreLive('probe-computer')
  release()
  assert.equal(isTreeStoreLive('probe-computer'), true, 'the second holder keeps it live')
  release()
  assert.equal(isTreeStoreLive('probe-computer'), true, 'a double release must not free another holder')
  second()
  assert.equal(isTreeStoreLive('probe-computer'), false)
})

test('the module files the tree ONLY when no view store is live, and the view wires the bench', () => {
  const module = read('src/research-experiments.js')
  assert.match(module, /!isTreeStoreLive\(EXPERIMENT_COMPUTER_ID\)/,
    'the listener writes the tree beside a live view instance — whole-record clobber')
  const computers = read('src/views/computers.js')
  assert.match(computers, /treeStoreLiveRelease = markTreeStoreLive\(computerId\)/,
    'the computers view no longer marks its store live; the registry reads empty and the listener writes beside it')
  assert.match(computers, /export async function startAgentForNode/,
    'the shared start contract is no longer exported; the bench would need its own copy')
  const view = read('src/views/research.js')
  assert.match(view, /startAgent: startAgentForNode/, 'the bench dispatches through a different start path than the compose panel')
  for (const hook of ['data-exp-form', 'data-exp-run', 'data-results-csv', 'data-results-json']) {
    assert.match(view, new RegExp(hook), `the bench lost its ${hook} control`)
  }
})
