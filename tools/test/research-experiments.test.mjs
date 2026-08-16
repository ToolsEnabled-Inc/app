import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

import {
  EXPERIMENT_COMPUTER_ID,
  MAX_LOCAL_CELLS,
  buildExperiment,
  decideDispatch,
  dispatchExperiment,
  experimentsSnapshot,
  parseExperimentsRow,
  removeExperiment,
  resetExperimentTracking,
  seedExperiments,
  serializeExperimentsRow,
  submitExperimentRuns,
  workerBrief,
} from '../../src/research-experiments.js'
import { createFleetTreeStore, isTreeStoreLive, markTreeStoreLive, safeTreeStorage } from '../../src/fleet-trees.js'

/* ONE experiment model: a grid with a runner, upgraded from v1 on read,
   dispatched locally as tree nodes when it is agent-kind and tree-sized, and
   queued through the research service otherwise. The tree semantics, the
   bounded account row, and the live-store discipline are v1's, unchanged. */

const ROOT = resolve(import.meta.dirname, '..', '..')
const read = file => readFileSync(resolve(ROOT, file), 'utf8')

const EMPTY = Object.freeze({ experiments: [], damaged: false })
const SPEC = Object.freeze({
  name: 'Tokenizer drift sweep',
  axes: [{ id: 'tier', values: ['luna', 'terra'] }],
  runner: { kind: 'agent', briefTemplate: 'Read {dataset} and report the drift.' },
  runsPerCell: 2,
  datasetPath: 'C:/data/drift.jsonl',
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
  assert.equal(built.experiment.cells.length, 4, 'two tiers times two repeats')
  assert.ok(built.experiment.cells.every(cell => cell.status === 'designed'))
  assert.deepEqual(built.experiment.cells.map(cell => cell.params.tier), ['luna', 'luna', 'terra', 'terra'],
    'row-major with replicates inner reproduces the v1 cell order exactly')

  const noTier = buildExperiment({ ...SPEC, axes: [{ id: 'style', values: ['a'] }] }, EMPTY)
  assert.equal(noTier.ok, false)
  assert.match(noTier.sentence, /at least one model tier/)
  const badRuns = buildExperiment({ ...SPEC, runsPerCell: 0 }, EMPTY)
  assert.equal(badRuns.ok, false)
  const strayToken = buildExperiment({ ...SPEC, runner: { kind: 'agent', briefTemplate: 'Do {missing_axis}.' } }, EMPTY)
  assert.equal(strayToken.ok, false)
  assert.match(strayToken.sentence, /no axis called missing_axis/, 'an unknown token is refused at design, never mid-run')
})

test('an oversized grid is refused by its measured count, counting repeats', () => {
  const wide = buildExperiment({
    ...SPEC,
    axes: [{ id: 'tier', values: ['luna'] }, { id: 'v', values: Array.from({ length: 24 }, (_x, i) => `v${i}`) }, { id: 'w', values: Array.from({ length: 5 }, (_x, i) => `w${i}`) }],
    runsPerCell: 5,
  }, EMPTY)
  assert.equal(wide.ok, false)
  assert.match(wide.sentence, /600 runs/, 'the refusal states what it measured, repeats included')
})

test('decideDispatch: tree-sized agent grids run local, everything else queues under a project', () => {
  const local = buildExperiment(SPEC, EMPTY).experiment
  assert.deepEqual(decideDispatch(local), { ok: true, mode: 'local' })
  assert.equal(local.cells.length <= MAX_LOCAL_CELLS, true)

  const big = buildExperiment({ ...SPEC, axes: [{ id: 'tier', values: ['luna', 'terra', 'sol'] }], runsPerCell: 3 }, EMPTY).experiment
  assert.equal(big.cells.length, 9)
  assert.equal(decideDispatch(big).ok, false, 'queue-sized with no project is a refusal, not a guess')
  assert.match(decideDispatch(big).sentence, /pick one above/)
  assert.deepEqual(decideDispatch(big, { projectId: 'rp-1234' }), { ok: true, mode: 'queue', projectId: 'rp-1234' })

  const process = buildExperiment({
    ...SPEC, axes: [{ id: 'n', values: ['1'] }], runsPerCell: 1,
    runner: { kind: 'process', command: 'node', args: [] },
  }, EMPTY).experiment
  assert.equal(decideDispatch(process).ok, false, 'a command never runs from the bench, whatever its size')
  assert.equal(decideDispatch(process, { projectId: 'rp-1' }).mode, 'queue')
})

test('the brief substitutes the dataset as TEXT and names the cell', () => {
  const built = buildExperiment(SPEC, EMPTY)
  const brief = workerBrief(built.experiment, built.experiment.cells[0])
  assert.match(brief, /C:\/data\/drift\.jsonl/)
  assert.match(brief, /luna · #1/)
  assert.ok(!brief.includes('{dataset}'))
})

test('a v1-upgraded row with a stray token falls back to plain dataset substitution', () => {
  const v1Raw = JSON.stringify({
    v: 1,
    experiments: [{
      id: 'exp-legacy', name: 'Legacy', promptTemplate: 'Read {dataset} and keep {this} literal.',
      datasetPath: 'C:/data/x.jsonl', createdAtMs: 5, treeId: null,
      cells: [{ tier: 'luna', run: 1, status: 'designed', sessionId: null, nodeId: null, startedAtMs: null, endedAtMs: null, replyExcerpt: '' }],
    }],
  })
  const upgraded = parseExperimentsRow(v1Raw).experiments[0]
  const brief = workerBrief(upgraded, upgraded.cells[0])
  assert.match(brief, /C:\/data\/x\.jsonl/)
  assert.match(brief, /\{this\}/, 'a stray token in v1 prose stays literal, exactly as v1 ran it')
})

test('a malformed stored v2 experiment drops at the parse gate, never reaching a renderer', () => {
  // The re-review's finding: the gate must enforce what renderDesigner
  // dereferences, or one bad row from a partial write or another device
  // blanks the whole bench with a throw instead of losing the one row.
  const good = buildExperiment(SPEC, EMPTY)
  const raw = JSON.stringify({
    v: 2,
    experiments: [
      good.experiment,
      { id: 'exp-bad-1', name: 'No brief', runner: { kind: 'agent' }, axes: [{ id: 'tier', values: ['luna'] }], cells: [] },
      { id: 'exp-bad-2', name: 'Null axis', runner: { kind: 'process', command: 'node' }, axes: [null], cells: [] },
      { id: 'exp-bad-3', name: 'Bare cells', runner: { kind: 'agent', briefTemplate: 'Do it.' }, axes: [{ id: 'tier', values: ['luna'] }], cells: [{}] },
    ],
  })
  const parsed = parseExperimentsRow(raw)
  assert.equal(parsed.damaged, false)
  assert.deepEqual(parsed.experiments.map(experiment => experiment.id), [good.experiment.id],
    'the three malformed rows drop; the good one survives')
})

test('the row round-trips as v2 and damage is stated', () => {
  const built = buildExperiment(SPEC, EMPTY)
  const serialized = serializeExperimentsRow(built.next)
  assert.match(serialized, /"v":2/)
  const parsed = parseExperimentsRow(serialized)
  assert.equal(parsed.experiments.length, 1)
  assert.equal(parsed.experiments[0].name, SPEC.name)
  assert.equal(parseExperimentsRow('broken').damaged, true)
  assert.equal(parseExperimentsRow(null).damaged, false)
  assert.equal(serializeExperimentsRow({ experiments: [] }), null)
  const removed = removeExperiment(built.next, built.experiment.id)
  assert.equal(removed.ok, true)
  assert.equal(removed.serialized, null)
})

test('a v1 row upgrades on read: order, status and excerpts preserved, and the upgrade is idempotent', () => {
  const v1Raw = JSON.stringify({
    v: 1,
    experiments: [{
      id: 'exp-old', name: 'Old sweep', promptTemplate: 'Read {dataset}.',
      datasetPath: 'C:/data/old.jsonl', createdAtMs: 7, treeId: 'tree-1',
      cells: [
        { tier: 'luna', run: 1, status: 'finished', sessionId: 's1', nodeId: 'n1', startedAtMs: 1, endedAtMs: 2, replyExcerpt: 'kept' },
        { tier: 'luna', run: 2, status: 'failed', sessionId: null, nodeId: 'n2', startedAtMs: 1, endedAtMs: 3, replyExcerpt: 'also kept' },
        { tier: 'terra', run: 1, status: 'designed', sessionId: null, nodeId: null, startedAtMs: null, endedAtMs: null, replyExcerpt: '' },
        { tier: 'terra', run: 2, status: 'designed', sessionId: null, nodeId: null, startedAtMs: null, endedAtMs: null, replyExcerpt: '' },
      ],
    }],
  })
  const upgraded = parseExperimentsRow(v1Raw)
  assert.equal(upgraded.damaged, false)
  const experiment = upgraded.experiments[0]
  assert.deepEqual(experiment.axes, [{ id: 'tier', values: ['luna', 'terra'] }])
  assert.equal(experiment.runsPerCell, 2)
  assert.equal(experiment.runner.kind, 'agent')
  assert.equal(experiment.projectId, null)
  assert.deepEqual(experiment.cells.map(cell => cell.params), [
    { tier: 'luna', replicate: 1 }, { tier: 'luna', replicate: 2 },
    { tier: 'terra', replicate: 1 }, { tier: 'terra', replicate: 2 },
  ], 'the tracked map indexes into this array; order is load-bearing')
  assert.deepEqual(experiment.cells.map(cell => cell.status), ['finished', 'failed', 'designed', 'designed'])
  assert.equal(experiment.cells[0].replyExcerpt, 'kept')
  const again = parseExperimentsRow(serializeExperimentsRow(upgraded))
  assert.deepEqual(again.experiments, upgraded.experiments, 're-serializing the upgrade changes nothing')
})

test('submitExperimentRuns queues designed cells: inline spec first, service id after, refusals honest', async () => {
  resetExperimentTracking()
  try {
    const big = buildExperiment({ ...SPEC, axes: [{ id: 'tier', values: ['luna', 'terra', 'sol'] }], runsPerCell: 3 }, EMPTY)
    seedExperiments({ experiments: big.next.experiments, damaged: false })
    const bodies = []
    let counter = 0
    const outcome = await submitExperimentRuns(big.experiment.id, {
      projectId: 'rp-abcd',
      persist: () => {},
      submit: async body => {
        bodies.push(body)
        counter += 1
        if (counter === 5) return { ok: false, reason: 'the research pipeline is off' }
        return { ok: true, disposition: counter === 2 ? 'replay' : 'submitted', run: { runId: `rr-${counter}` }, experiment: { experimentId: 'rx-service' } }
      },
    })
    assert.equal(outcome.ok, true)
    assert.equal(outcome.submitted, 7)
    assert.equal(outcome.replayed, 1)
    assert.match(outcome.sentence, /pipeline is off/, 'the refused cell rides back as a sentence, not silence')
    assert.ok(Object.hasOwn(bodies[0], 'experiment'), 'the first submit registers the declaration inline')
    assert.ok(bodies.slice(1).every(body => body.experimentId === 'rx-service'),
      'every later cell submits by the captured service id, never a second inline spec')
    const cells = experimentsSnapshot().experiments[0].cells
    assert.equal(cells.filter(cell => cell.status === 'queued').length, 8)
    assert.equal(cells.filter(cell => cell.status === 'designed').length, 1, 'the refused cell stays designed — the honest state')
    const paramKeys = new Set(bodies.map(body => JSON.stringify(body.params)))
    assert.equal(paramKeys.size, bodies.length,
      'the replicate key keeps every repeat a distinct params hash, or the service would replay them into one run')

    // Resubmitting sends ONLY the remaining designed cell, by service id.
    bodies.length = 0
    const retry = await submitExperimentRuns(big.experiment.id, {
      projectId: 'rp-abcd', persist: () => {},
      submit: async body => { bodies.push(body); return { ok: true, disposition: 'submitted', run: { runId: 'rr-late' }, experiment: { experimentId: 'rx-service' } } },
    })
    assert.equal(bodies.length, 1)
    assert.equal(bodies[0].experimentId, 'rx-service')
    assert.equal(retry.submitted, 1)
  } finally {
    resetExperimentTracking()
  }
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
    const built = buildExperiment({ ...SPEC, axes: [{ id: 'tier', values: ['luna'] }], runsPerCell: 2 }, EMPTY)
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

test('a queue-sized experiment refuses the local dispatcher by name', async () => {
  resetExperimentTracking()
  try {
    const big = buildExperiment({ ...SPEC, axes: [{ id: 'tier', values: ['luna', 'terra', 'sol'] }], runsPerCell: 3 }, EMPTY)
    seedExperiments({ experiments: big.next.experiments, damaged: false })
    const outcome = await dispatchExperiment(big.experiment.id, {
      agent: null, persist: () => {}, startAgent: async () => ({ ok: true, sessionId: 'never' }),
    })
    assert.equal(outcome.ok, false)
    assert.match(outcome.sentence, /queue/)
  } finally {
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
  assert.ok(!view.includes('data-grid-form'), 'the second designer form is gone; one form designs every experiment')
})

test('the gathered chips speak service truth for queued cells, without mutation', async () => {
  const { cellsWithServiceStatus } = await import('../../src/research-experiments.js')
  const experiment = {
    cells: [
      { params: { a: 2 }, status: 'queued', runId: 'rr-done' },
      { params: { a: 3 }, status: 'queued', runId: 'rr-broke' },
      { params: { a: 4 }, status: 'queued', runId: 'rr-busy' },
      { params: { a: 5 }, status: 'queued', runId: 'rr-waiting' },
      { params: { a: 6 }, status: 'queued', runId: 'rr-odd' },
      { params: { a: 7 }, status: 'queued' },              // never submitted a runId
      { params: { a: 8 }, status: 'finished', runId: 'rr-done' }, // local truth wins when not queued
    ],
  }
  const runs = [
    { runId: 'rr-done', task: { status: 'succeeded' } },
    { runId: 'rr-broke', task: { status: 'failed' } },
    { runId: 'rr-busy', task: { status: 'claimed' } },
    { runId: 'rr-waiting', task: { status: 'queued' } },
    { runId: 'rr-odd', task: { status: 'held' } },
    { runId: 'rr-null', task: null },
  ]
  const shown = cellsWithServiceStatus(experiment, runs)
  assert.deepEqual(shown.map(cell => cell.status),
    ['finished', 'failed', 'running', 'queued', 'held', 'queued', 'finished'],
    'succeeded reads finished, claimed reads running, unknown words pass through honestly')
  assert.ok(experiment.cells.every(cell => ['queued', 'finished'].includes(cell.status)),
    'the account rows themselves are untouched — display only')
  assert.deepEqual(cellsWithServiceStatus(experiment, undefined).map(cell => cell.status),
    experiment.cells.map(cell => cell.status), 'no runs, no change')

  const view = read('src/views/research.js')
  assert.match(view, /data-gathered-cells/, 'the gathered panel lost its addressable chips block')
  assert.match(view, /cellsWithServiceStatus\(experiment, read\.runs\)/,
    'the service read no longer refreshes the chips from service truth')
})

test('removing an experiment card takes two presses, and a lone press disarms', () => {
  const view = read('src/views/research.js')
  const handler = view.slice(view.indexOf('if (removeId) {'))
  assert.match(handler, /Press again to remove/, 'the first press must arm, not remove')
  assert.match(handler, /dataset\.armed !== 'true'/, 'the removal no longer checks the armed state before acting')
  assert.match(handler, /button\.isConnected && button\.dataset\.armed === 'true'/,
    'a lone press must disarm itself so the label never lies')
  assert.ok(handler.indexOf('Press again to remove') < handler.indexOf('removeExperiment('),
    'the arm gate must sit before the destructive call')
})

test('the bench follows the project selector, hides nothing unreachable, and says what it left out', () => {
  const view = read('src/views/research.js')
  const benchAt = view.indexOf('function benchExperiments')
  assert.ok(benchAt !== -1, 'the shared bench filter is gone')
  const bench = view.slice(benchAt, benchAt + 1200)
  assert.match(bench, /filesUnder\(selection, experiment\.projectId\) \|\| !experiment\.projectId/,
    'an experiment filed under no project must stay visible under every selection')
  assert.match(bench, /filed under another project/, 'the bench must count what the filter left out')

  // Both bench modules must consume the filter, or the page blends two projects.
  const designer = view.slice(view.indexOf('function renderDesigner'), view.indexOf('function renderRunBoard'))
  assert.match(designer, /benchExperiments\(\)/, 'the designer ignores the project selector again')
  const runboard = view.slice(view.indexOf('function renderRunBoard'), view.indexOf('function renderResults'))
  assert.match(runboard, /benchExperiments\(\)/, 'the run board ignores the project selector again')
  assert.match(runboard, /cellsWithServiceStatus\(experiment, read\.runs\)/,
    'the run board promises live state; queue-dispatched cells must read their service state')

  // Switching projects must re-render the bench, not only the service modules.
  const onChange = view.slice(view.indexOf("projectSelect.addEventListener('change'"))
  const handler = onChange.slice(0, onChange.indexOf('\n  })'))
  assert.match(handler, /renderExperimentModules\(\)/, 'a project switch must re-render the bench')
  assert.match(handler, /renderServiceModules\(\)/)
  assert.match(handler, /gatheredExperimentId = null/, 'a gathered panel from the project just left must close')
})

test('the run board and the service board cannot wipe each other, and the worker press is never silent', () => {
  const view = read('src/views/research.js')
  // Both render into [data-research-runboard]; the bench board assigns
  // innerHTML, which deletes the appended service block and the Start button.
  const runboard = view.slice(view.indexOf('function renderRunBoard'), view.indexOf('function renderResults'))
  const calls = runboard.split('renderServiceRunBoard()').length - 1
  assert.equal(calls, 2, 'every exit from renderRunBoard must restore the service board it just deleted')

  // The cache fill must repaint the bench board, or its cells stay cold.
  const refresh = view.slice(view.indexOf('async function refreshRuns'), view.indexOf('function anyRunActive'))
  assert.match(refresh, /renderRunBoard\(\)/, 'the runs cache fills without repainting the bench board again')

  // A slow lifecycle call must survive the poll's repaint as a pending state.
  assert.match(view, /let workerPending = null/)
  const control = view.slice(view.indexOf('function workerControlMarkup'), view.indexOf('function runDrillMarkup'))
  assert.match(control, /if \(workerPending\)/, 'a repaint mid-call hands back an enabled button again')
  assert.match(control, /This can take a few seconds/)

  // A fully-replayed submit must say so instead of doing nothing visible.
  assert.match(view, /Already queued — the run service recognised all/)
})
