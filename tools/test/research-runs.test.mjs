import assert from 'node:assert/strict'
import test from 'node:test'

import {
  chartableColumn,
  readRuns,
  resultTableModel,
  resultsExport,
  runBoardModel,
  runIsTerminal,
  runStateWord,
  submitRun,
} from '../../src/research-runs.js'

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
