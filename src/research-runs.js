// Run and result models for the research board: pure builders that merge what
// the research service answered into rows a renderer prints, without ever
// summarizing a failure into an empty table. The bridge-down case is CARRIED
// on the model as a sentence, not dropped — the board says it beside whatever
// local knowledge it still has.

import { postBridgeAction } from './mission-bridge.js'

const RUN_STATE_WORD = Object.freeze({
  queued: 'queued',
  retry_wait: 'waiting to retry',
  leased: 'claimed',
  running: 'running',
  succeeded: 'finished',
  failed: 'failed',
  cancelled: 'cancelled',
  uncertain: 'uncertain',
})

export function runStateWord(status) {
  return RUN_STATE_WORD[status] || String(status || 'unknown')
}

/**
 * The word for a run's task, which knows something the status alone does not:
 * a claimed or running task whose lease has expired is NOT running — nothing
 * holds it. The adversarial live review found the board saying "running" for a
 * run whose worker had been stopped for over an hour, next to "Run worker:
 * stopped." The service will reclaim it on the worker's next start, so the
 * honest word is "stalled" and the honest count is not "running".
 */
export function runTaskStateWord(task) {
  if (runTaskIsStalled(task)) return 'stalled'
  return runStateWord(task?.status)
}

export function runTaskIsStalled(task) {
  /* leaseExpired is only ever true for a row the service stored as leased or
     running, so the flag alone is the whole test. The first version also
     required status to BE 'running' or 'leased' and therefore never fired:
     when a lease expires the service reports 'uncertain' (from running) or
     'expired' (from leased), not the stored word — so the board said
     "uncertain" at a person, and "stalled" appeared nowhere in the shipped
     app (measured on installed 1.0.11). */
  if (!task || task.leaseExpired !== true) return false
  // A finished run is finished however stale its lease record looks. The
  // service never sets the flag on a terminal row, so this only guards a
  // caller handing us a malformed one — cheap, and it keeps the word honest.
  return !runIsTerminal(task.status) && !runIsTerminal(task.storedStatus || task.status)
}

export function runIsTerminal(status) {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}

/** List one experiment's runs from the service. Envelope survives on failure. */
export async function readRuns(experimentId, { postAction = postBridgeAction } = {}) {
  const result = await postAction('research-runs', { experimentId })
  if (result?.ok !== true) return result ?? { ok: false, reason: 'the research service did not answer' }
  const runs = result.receipt?.runs
  if (!Array.isArray(runs)) return { ok: false, reason: 'the research service answered without a run list', code: 'RESEARCH_RUNS_INVALID' }
  return { ok: true, runs }
}

/** The single-run drill read: carries the checkpoint body and artifact listing. */
export async function readRun(runId, { postAction = postBridgeAction } = {}) {
  const result = await postAction('research-runs', { runId })
  if (result?.ok !== true) return result ?? { ok: false, reason: 'the research service did not answer' }
  const run = Array.isArray(result.receipt?.runs) ? result.receipt.runs[0] : null
  if (!run) return { ok: false, reason: 'the research service has no run by that name', code: 'RESEARCH_RUN_NOT_FOUND' }
  return { ok: true, run }
}

export async function readResults(runId, { postAction = postBridgeAction } = {}) {
  const result = await postAction('research-results', { runId })
  if (result?.ok !== true) return result ?? { ok: false, reason: 'the research service did not answer' }
  const results = result.receipt?.results
  if (!Array.isArray(results)) return { ok: false, reason: 'the research service answered without results', code: 'RESEARCH_RESULTS_INVALID' }
  return { ok: true, results }
}

/**
 * Submit one run of a durable experiment. The full spec rides along on the
 * first submit (the service registers or matches it by configuration), so the
 * page needs no separate registration step.
 */
export async function submitRun({ experimentId, experiment, params }, { postAction = postBridgeAction } = {}) {
  const body = experimentId ? { experimentId, params } : { experiment, params }
  const result = await postAction('research-run-submit', body)
  if (result?.ok !== true) return result ?? { ok: false, reason: 'the submission did not reach the research service' }
  const receipt = result.receipt
  if (!receipt || !receipt.run || typeof receipt.run.runId !== 'string') {
    return { ok: false, reason: 'the research service accepted without returning the run', code: 'RESEARCH_RUN_RECEIPT_INVALID' }
  }
  return { ok: true, disposition: receipt.disposition, run: receipt.run, experiment: receipt.experiment }
}

/**
 * The board model for one experiment: each run with its plain state word, its
 * params, and timing. `note` carries the bridge refusal when the read failed;
 * the rows are then whatever was passed as the previous knowledge.
 */
export function runBoardModel({ read, previousRuns = [] }) {
  if (read?.ok !== true) {
    return {
      runs: previousRuns,
      note: `The run list could not be refreshed — ${read?.reason || 'the research service did not answer'}. Showing what this page last knew.`,
      terminal: previousRuns.every(run => runIsTerminal(run?.task?.status)),
    }
  }
  const runs = read.runs
  return {
    runs,
    note: null,
    terminal: runs.length > 0 && runs.every(run => runIsTerminal(run?.task?.status)),
  }
}

/**
 * The result table model: generic columns led by the run's params keys (the
 * grid axes), then the declared result fields, in declaration order. Numbers
 * stay numbers so an export or a chart can use them.
 */
export function resultTableModel({ runs, resultsByRun, resultSchema }) {
  const axisNames = []
  for (const run of runs) {
    for (const name of Object.keys(run?.params || {})) {
      if (!axisNames.includes(name)) axisNames.push(name)
    }
  }
  const fieldNames = Object.keys(resultSchema?.fields || {})
  const columns = [...axisNames, ...fieldNames.filter(name => !axisNames.includes(name))]
  const rows = []
  for (const run of runs) {
    const records = resultsByRun.get(run.runId) || []
    if (records.length === 0) {
      rows.push({ runId: run.runId, status: run?.task?.status || 'unknown', cells: axisNames.map(name => run?.params?.[name] ?? null).concat(fieldNames.map(() => null)) })
      continue
    }
    for (const record of records) {
      const payload = record?.record && typeof record.record === 'object' ? record.record : {}
      rows.push({
        runId: run.runId,
        status: run?.task?.status || 'unknown',
        cells: columns.map(name => Object.hasOwn(payload, name) ? payload[name] : (run?.params?.[name] ?? null)),
      })
    }
  }
  return { columns, rows, axisNames }
}

/** csv or json text for the whole table; the caller puts it on the clipboard. */
export function resultsExport(model, format) {
  if (format === 'json') {
    return JSON.stringify(model.rows.map(row => {
      const record = { runId: row.runId, status: row.status }
      model.columns.forEach((name, index) => { record[name] = row.cells[index] })
      return record
    }), null, 2)
  }
  const escape = value => `"${String(value ?? '').replace(/"/g, '""')}"`
  const lines = [['runId', 'status', ...model.columns]]
  for (const row of model.rows) lines.push([row.runId, row.status, ...row.cells])
  return lines.map(line => line.map(escape).join(',')).join('\n')
}

/**
 * The drill-in model for one run: everything a person opens a run to learn,
 * as plain words. `read` is the single-run service answer (which carries the
 * checkpoint body and the bounded artifact listing); `results` that run's
 * records. Absence is stated, never rendered as empty.
 */
export function runDrillModel({ run, results = [] }) {
  const checkpoint = run?.task?.latestCheckpoint?.checkpoint || null
  const artifacts = Array.isArray(run?.artifacts) ? run.artifacts : null
  return {
    runId: run?.runId || 'unknown',
    stateWord: runTaskStateWord(run?.task),
    params: run?.params && typeof run.params === 'object' ? run.params : {},
    checkpointSummary: checkpoint && typeof checkpoint.summary === 'string' && checkpoint.summary.length > 0
      ? checkpoint.summary
      : 'No progress note has been written yet.',
    errorSentence: run?.task?.error
      ? `${run.task.error.message || 'It stopped without a message.'}`
      : null,
    artifacts,
    artifactsSentence: artifacts === null
      ? (run?.artifactsNote || 'The artifact folder has not been read.')
      : artifacts.length === 0
        ? 'The run has produced no files yet.'
        : `${artifacts.length} file${artifacts.length === 1 ? '' : 's'}${run?.artifactsTruncated ? ', showing the first fifty' : ''}.`,
    resultCount: results.length,
    artifactDir: typeof run?.artifactDir === 'string' ? run.artifactDir : null,
  }
}

/** Every declared numeric column with at least one number in the table. */
export function chartableColumns(model, resultSchema) {
  const numericNames = Object.entries(resultSchema?.fields || {})
    .filter(([, kind]) => kind === 'number').map(([name]) => name)
  const columns = []
  for (const name of numericNames) {
    const index = model.columns.indexOf(name)
    if (index !== -1 && model.rows.some(row => typeof row.cells[index] === 'number')) {
      columns.push({ name, index })
    }
  }
  return columns
}

/**
 * The default charted column. Axis parameters are inputs, not measurements —
 * charting one draws meaningless bars (measured on the 2026-08-15 stage:
 * the convergence grid charted "seed") — so the first numeric column that is
 * NOT an axis wins, and axes are only a last resort.
 */
export function chartableColumn(model, resultSchema, { axisIds } = {}) {
  const columns = chartableColumns(model, resultSchema)
  if (columns.length === 0) return null
  const axes = new Set(axisIds ?? model.axisNames ?? [])
  return columns.find(column => !axes.has(column.name)) || columns[0]
}
