import assert from 'node:assert/strict'
import test from 'node:test'

import {
  chartableColumn,
  readRun,
  readRuns,
  resultTableModel,
  resultsExport,
  runBoardModel,
  runDrillModel,
  runIsTerminal,
  runStateWord,
  submitRun,
} from '../../src/research-runs.js'
import { chartRows } from '../../src/research-result-charts.js'

/* The board models: bridge-down is carried as a sentence beside the last
   knowledge, tables are generic axis-led columns, numbers stay numbers. */

const RUN = (id, status, params, extras = {}) => ({
  runId: id, params, task: { status }, ...extras,
})

test('state words are plain and terminality is exact', () => {
  assert.equal(runStateWord('retry_wait'), 'waiting to retry')
  assert.equal(runStateWord('succeeded'), 'finished')
  assert.equal(runStateWord('something_new'), 'something_new')
  assert.equal(runIsTerminal('succeeded'), true)
  assert.equal(runIsTerminal('retry_wait'), false)
})

test('a failed refresh keeps the last knowledge and says why', () => {
  const previous = [RUN('rr-1', 'running', { a: 'x' })]
  const model = runBoardModel({ read: { ok: false, reason: 'action bridge timed out' }, previousRuns: previous })
  assert.equal(model.runs, previous)
  assert.match(model.note, /could not be refreshed/)
  assert.match(model.note, /action bridge timed out/)
  const fresh = runBoardModel({ read: { ok: true, runs: [RUN('rr-1', 'succeeded', { a: 'x' })] } })
  assert.equal(fresh.note, null)
  assert.equal(fresh.terminal, true)
})

test('the result table leads with axis columns and keeps numbers numeric', () => {
  const runs = [
    RUN('rr-1', 'succeeded', { model_axis: 'm1', effort: 'low' }),
    RUN('rr-2', 'failed', { model_axis: 'm2', effort: 'high' }),
  ]
  const resultsByRun = new Map([
    ['rr-1', [{ record: { score: 0.81, label: 'pass' } }]],
  ])
  const schema = { fields: { score: 'number', label: 'string' }, required: [] }
  const model = resultTableModel({ runs, resultsByRun, resultSchema: schema })
  assert.deepEqual(model.columns, ['model_axis', 'effort', 'score', 'label'])
  assert.equal(model.rows.length, 2)
  assert.equal(model.rows[0].cells[2], 0.81, 'the number is a number, not text')
  assert.equal(model.rows[1].cells[2], null, 'a run without results shows absence, not zero')

  const chart = chartableColumn(model, schema)
  assert.equal(chart.name, 'score')

  const csv = resultsExport(model, 'csv')
  assert.match(csv.split('\n')[0], /runId.*status.*model_axis.*effort.*score.*label/)
  const json = JSON.parse(resultsExport(model, 'json'))
  assert.equal(json[0].score, 0.81)
})

test('reads pass the bridge envelope through and validate shape', async () => {
  const refused = await readRuns('rx-1', { postAction: async () => ({ ok: false, reason: 'down', code: 'BRIDGE_UNREACHABLE' }) })
  assert.equal(refused.code, 'BRIDGE_UNREACHABLE')
  const hollow = await readRuns('rx-1', { postAction: async () => ({ ok: true, receipt: {} }) })
  assert.equal(hollow.code, 'RESEARCH_RUNS_INVALID')
  const good = await readRuns('rx-1', { postAction: async (action, body) => {
    assert.equal(action, 'research-runs')
    assert.equal(body.experimentId, 'rx-1')
    return { ok: true, receipt: { runs: [] } }
  } })
  assert.equal(good.ok, true)
})

test('the drill model states every absence instead of rendering it empty', () => {
  const bare = runDrillModel({ run: { runId: 'rr-1', params: { a: 'x' }, task: { status: 'queued' } } })
  assert.equal(bare.stateWord, 'queued')
  assert.match(bare.checkpointSummary, /No progress note/)
  assert.match(bare.artifactsSentence, /has not been read/)
  assert.equal(bare.errorSentence, null)

  const full = runDrillModel({
    run: {
      runId: 'rr-2', params: { a: 'x' }, artifactDir: 'state/research/p/e/rr-2',
      artifacts: [{ name: 'out.json', bytes: 7 }], artifactsTruncated: false,
      task: { status: 'failed', error: { code: 'RESEARCH_RUN_TIMEOUT', message: 'The declared command exceeded its limit and was stopped.' }, latestCheckpoint: { checkpoint: { summary: 'Runner finished; collecting results.' } } },
    },
    results: [{ record: { n: 1 } }],
  })
  assert.equal(full.checkpointSummary, 'Runner finished; collecting results.')
  assert.match(full.errorSentence, /exceeded its limit/)
  assert.match(full.artifactsSentence, /1 file\./)
  assert.equal(full.resultCount, 1)

  const unreadable = runDrillModel({ run: { runId: 'rr-3', params: {}, artifacts: null, artifactsNote: 'The artifact folder could not be read from here.', task: { status: 'succeeded' } } })
  assert.match(unreadable.artifactsSentence, /could not be read/)
})

test('readRun unwraps the single-run read and names an absent run', async () => {
  const good = await readRun('rr-9', { postAction: async (action, body) => {
    assert.equal(body.runId, 'rr-9')
    return { ok: true, receipt: { runs: [{ runId: 'rr-9' }] } }
  } })
  assert.equal(good.run.runId, 'rr-9')
  const missing = await readRun('rr-0', { postAction: async () => ({ ok: true, receipt: { runs: [] } }) })
  assert.equal(missing.code, 'RESEARCH_RUN_NOT_FOUND')
})

test('chartRows plots only real numbers and labels bars by the other columns', () => {
  const model = {
    columns: ['axis_a', 'score'],
    rows: [
      { runId: 'rr-1', status: 'succeeded', cells: ['x', 0.5] },
      { runId: 'rr-2', status: 'succeeded', cells: ['y', null] },
      { runId: 'rr-3', status: 'succeeded', cells: ['z', 0.9] },
    ],
  }
  const rows = chartRows(model, { name: 'score', index: 1 })
  assert.equal(rows.length, 2, 'a row without a number is not plotted as zero')
  assert.deepEqual(rows[0], { label: 'x', value: 0.5 })
  assert.deepEqual(rows[1], { label: 'z', value: 0.9 })
})

test('submitRun carries the inline spec on first submit and returns the durable run', async () => {
  const submitted = await submitRun({
    experiment: { projectId: 'rp-1', name: 'grid', runnerKind: 'process', runnerConfig: {}, resultSchema: {}, collector: {} },
    params: { a: 'x' },
  }, {
    postAction: async (action, body) => {
      assert.equal(action, 'research-run-submit')
      assert.equal(body.experiment.name, 'grid')
      assert.equal(body.experimentId, undefined, 'either the id or the spec rides, never both')
      return { ok: true, receipt: { disposition: 'submitted', run: { runId: 'rr-9' }, experiment: { experimentId: 'rx-9' } } }
    },
  })
  assert.equal(submitted.ok, true)
  assert.equal(submitted.run.runId, 'rr-9')
  const hollow = await submitRun({ experimentId: 'rx-9', params: {} }, { postAction: async () => ({ ok: true, receipt: {} }) })
  assert.equal(hollow.code, 'RESEARCH_RUN_RECEIPT_INVALID')
})
