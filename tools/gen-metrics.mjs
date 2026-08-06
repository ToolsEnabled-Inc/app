/**
 * Read-only metrics projection.  This intentionally uses the established
 * readers/CLI instead of opening live state, particularly any SQLite store.
 */
import { statSync } from 'node:fs'
import { join } from 'node:path'
import {
  CANONICAL_ROOT,
  LIVE_ROOT,
  available,
  availableEnvelope,
  emitProjection,
  loadReader,
  plainObject,
  runJsonCli,
  source,
  unavailable,
  unavailableEnvelope,
} from './gen-projection-lib.mjs'

const PREFLIGHT_SCRIPT = 'tools/agent-preflight.js'
const LEDGER_READER = 'tools/ledger-query.js'
const LEDGER_FILE = 'reports/OWNER-REQUEST-LEDGER.json'
const QUEUE_CORPUS_READER = 'src/lib/build-queue-corpus.js'
const QUEUE_PROJECTION_READER = 'src/lib/build-queue-projection.js'
const QUEUE_ROOT = 'BUILD-QUEUE.md'

function isMetricInteger(value) {
  return Number.isSafeInteger(value) && value >= 0
}

function fileObservedAt(root, relativePath) {
  try {
    return new Date(statSync(join(root, relativePath)).mtimeMs).toISOString()
  } catch {
    return null
  }
}

function safeMetricMap(entries) {
  const output = {}
  for (const [key, value] of entries) {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(key) || !isMetricInteger(value)) return null
    output[key] = value
  }
  return output
}

function sessionsObservation(preflight, observedAt) {
  if (!plainObject(preflight.otherAgents)) return unavailable('source-malformed', observedAt)
  const entries = []
  for (const key of ['codex', 'claude']) {
    if (Object.hasOwn(preflight.otherAgents, key)) {
      if (!Array.isArray(preflight.otherAgents[key])) return unavailable('source-malformed', observedAt)
      entries.push([key, preflight.otherAgents[key].length])
    }
  }
  const value = safeMetricMap(entries)
  return value === null ? unavailable('source-malformed', observedAt) : available(value, observedAt)
}

function fleetSupervisorObservation(preflight, observedAt) {
  const supervisor = preflight.inFlight?.fleetSupervisor
  if (!plainObject(supervisor)) return unavailable('source-malformed', observedAt)
  // A dead supervisor's last item counts are stale and must never be presented
  // as a current fleet observation.
  if (supervisor.alive !== true) return unavailable('source-unavailable', observedAt)
  if (!plainObject(supervisor.items) || !isMetricInteger(supervisor.running)) return unavailable('source-malformed', observedAt)
  const value = safeMetricMap([['running', supervisor.running], ...Object.entries(supervisor.items)])
  return value === null ? unavailable('source-malformed', observedAt) : available(value, observedAt)
}

function servicesObservation(preflight, observedAt) {
  if (!Array.isArray(preflight.localServices)) return unavailable('source-malformed', observedAt)
  const stale = preflight.localServices.filter(service => plainObject(service) && service.stale === true).length
  if (preflight.localServices.some(service => !plainObject(service))) return unavailable('source-malformed', observedAt)
  return available({ total: preflight.localServices.length, stale }, observedAt)
}

async function requestsObservation() {
  const reader = loadReader(CANONICAL_ROOT, LEDGER_READER, 'canonical-ledger')
  const observedAt = fileObservedAt(CANONICAL_ROOT, LEDGER_FILE)
  if (!reader.ok || typeof reader.value?.readLedger !== 'function' || typeof reader.value?.processOpen !== 'function') {
    return { observation: unavailable(reader.reason || 'source-reader-failed', observedAt), source: source({ id: 'canonical-ledger', kind: 'reader', path: LEDGER_READER, ok: false, observedAt, reason: reader.reason || 'source-reader-failed' }) }
  }
  try {
    const ledger = await reader.value.readLedger()
    const open = reader.value.processOpen(ledger)
    if (!Array.isArray(ledger) || !Array.isArray(open)) throw new TypeError('LEDGER_RESULT_INVALID')
    return { observation: available({ total: ledger.length, open: open.length }, observedAt), source: source({ id: 'canonical-ledger', kind: 'reader', path: LEDGER_READER, ok: true, observedAt }) }
  } catch {
    return { observation: unavailable('source-unreadable', observedAt), source: source({ id: 'canonical-ledger', kind: 'reader', path: LEDGER_READER, ok: false, observedAt, reason: 'source-unreadable' }) }
  }
}

function queueObservedAt(corpus) {
  const times = corpus.files.map(relativePath => fileObservedAt(CANONICAL_ROOT, relativePath)).filter(Boolean)
  return times.length ? times.sort().at(-1) : null
}

function queueObservation() {
  const corpusReader = loadReader(CANONICAL_ROOT, QUEUE_CORPUS_READER, 'canonical-queue')
  const projectionReader = loadReader(CANONICAL_ROOT, QUEUE_PROJECTION_READER, 'canonical-queue')
  if (!corpusReader.ok || !projectionReader.ok
    || typeof corpusReader.value?.readQueueCorpus !== 'function'
    || typeof projectionReader.value?.parseQueuePhases !== 'function') {
    const reason = corpusReader.reason || projectionReader.reason || 'source-reader-failed'
    return { observation: unavailable(reason), source: source({ id: 'canonical-queue', kind: 'reader', path: QUEUE_ROOT, ok: false, reason }) }
  }
  try {
    const corpus = corpusReader.value.readQueueCorpus(join(CANONICAL_ROOT, QUEUE_ROOT))
    const phases = projectionReader.value.parseQueuePhases(corpus.text)
    if (!plainObject(corpus) || !Array.isArray(corpus.files) || !Array.isArray(phases)) throw new TypeError('QUEUE_RESULT_INVALID')
    const counts = new Map()
    for (const phase of phases) {
      if (!plainObject(phase) || typeof phase.status !== 'string') throw new TypeError('QUEUE_PHASE_INVALID')
      const status = phase.status.toLowerCase().replaceAll('-', '_')
      if (!/^[a-z][a-z0-9_]{0,63}$/.test(status)) throw new TypeError('QUEUE_STATUS_INVALID')
      counts.set(status, (counts.get(status) || 0) + 1)
    }
    const value = safeMetricMap([['total', phases.length], ...counts.entries()])
    const observedAt = queueObservedAt(corpus)
    if (value === null) throw new TypeError('QUEUE_METRICS_INVALID')
    return { observation: available(value, observedAt), source: source({ id: 'canonical-queue', kind: 'reader', path: QUEUE_ROOT, ok: true, observedAt }) }
  } catch {
    return { observation: unavailable('source-unreadable'), source: source({ id: 'canonical-queue', kind: 'reader', path: QUEUE_ROOT, ok: false, reason: 'source-unreadable' }) }
  }
}

await emitProjection('metrics', async at => {
  const preflight = runJsonCli(LIVE_ROOT, PREFLIGHT_SCRIPT, ['--json'], 'live-preflight')
  const preflightSource = source({
    id: 'live-preflight', kind: 'cli', path: PREFLIGHT_SCRIPT,
    ok: preflight.ok, observedAt: preflight.observedAt, reason: preflight.reason,
  })
  if (!preflight.ok) {
    return unavailableEnvelope('metrics', preflight.reason, [preflightSource], at)
  }
  if (!plainObject(preflight.value) || !Number.isFinite(Date.parse(preflight.value.generatedAt))) {
    const malformedSource = source({
      id: 'live-preflight', kind: 'cli', path: PREFLIGHT_SCRIPT,
      ok: false, observedAt: preflight.observedAt, reason: 'source-malformed',
    })
    return unavailableEnvelope('metrics', 'source-malformed', [malformedSource], at)
  }

  const [requests, queue] = await Promise.all([requestsObservation(), queueObservation()])
  const auditSource = source({ id: 'audit-sqlite', kind: 'sqlite', path: 'state/audit.sqlite3', ok: false, reason: 'source-unreadable-safely' })
  const memorySource = source({ id: 'memory-sqlite', kind: 'sqlite', path: 'state/toolsenabled.sqlite3', ok: false, reason: 'source-unreadable-safely' })
  const observedAt = preflight.observedAt
  return availableEnvelope('metrics', {
    sessions: sessionsObservation(preflight.value, observedAt),
    fleetSupervisor: fleetSupervisorObservation(preflight.value, observedAt),
    services: servicesObservation(preflight.value, observedAt),
    requests: requests.observation,
    queue: queue.observation,
    audit: unavailable('source-unreadable-safely'),
    memory: unavailable('source-unreadable-safely'),
  }, [preflightSource, requests.source, queue.source, auditSource, memorySource], at)
})
