const ACTION_ROUTES = Object.freeze({
  dispatch: '/v1/actions/dispatch',
  'report-read': '/v1/actions/report-read',
  queue: '/v1/actions/queue',
  'thread-reply': '/v1/actions/thread-reply',
  decision: '/v1/actions/decision',
  terminate: '/v1/actions/terminate',
  'ledger-archive': '/v1/actions/ledger-archive',
})

let bootstrapPromise = null
// Measured against the live bridge 2026-08-06, not guessed: every audited
// action pays for durable audit-chain writes, and the old 5s budget was below
// the floor for all of them — report-read 5.38s, thread-reply 7.79s, status
// 12.34s, dispatch longer still because it spawns a process. A budget under
// the measured cost does not make anything faster; it just turns completed
// work into a false "timed out". The real fix is server-side audit latency;
// see the shadow report to the coordinator.
const REQUEST_TIMEOUT_MS = 30_000
export const WELL_KNOWN_BRIDGE_PORTS = Object.freeze(
  Array.from({ length: 10 }, (_value, index) => 4610 + index),
)
const WELL_KNOWN_BRIDGES = Object.freeze(
  WELL_KNOWN_BRIDGE_PORTS.map(port => `http://127.0.0.1:${port}`),
)

// `/v1/status` is deliberately expensive on the bridge side: it parses every
// root's BUILD-QUEUE.md and writes durable audit receipts per root, measured at
// ~12s. It is a snapshot call, NOT a heartbeat, so it gets its own budget while
// ordinary actions keep the tight one. Availability is probed separately via
// the cheap unauthenticated /v1/runtime — see bridgeReachable().
const STATUS_TIMEOUT_MS = 30_000

function timeoutSignal(ms = REQUEST_TIMEOUT_MS) {
  return AbortSignal.timeout(ms)
}

function unavailable(error) {
  const timedOut = error?.name === 'TimeoutError'
  return { ok: false, reason: timedOut ? 'action bridge timed out' : (error?.message || 'action bridge unreachable'), code: timedOut ? 'BRIDGE_TIMEOUT' : 'BRIDGE_UNREACHABLE' }
}

export function normalizedBaseUrl(candidate) {
  let url
  try { url = new URL(candidate) } catch { return { ok: false, reason: 'action bridge address is malformed' } }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    return { ok: false, reason: 'action bridge address must be a bare loopback HTTP origin' }
  }
  return { ok: true, baseUrl: url.origin }
}

function validRuntimeDiscovery(discoveryOrigin, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.getPrototypeOf(body) !== Object.prototype
      || Reflect.ownKeys(body).some(key => !['ok', 'baseUrl', 'port', 'startedAt', 'pid'].includes(key))
      || ['ok', 'baseUrl', 'port', 'startedAt', 'pid'].some(key => !Object.hasOwn(body, key))
      || body.ok !== true) return null
  const configured = normalizedBaseUrl(body.baseUrl)
  const startedAtMs = typeof body.startedAt === 'string' ? Date.parse(body.startedAt) : NaN
  if (!configured.ok || configured.baseUrl !== discoveryOrigin
      || !Number.isSafeInteger(body.port) || body.port < 1 || body.port > 65535
      || new URL(configured.baseUrl).port !== String(body.port)
      || !Number.isSafeInteger(body.pid) || body.pid < 1
      || !Number.isFinite(startedAtMs) || new Date(startedAtMs).toISOString() !== body.startedAt) return null
  return configured
}

export async function configuredBaseUrl() {
  const params = new URLSearchParams(window.location.search)
  if (params.has('bridge')) return normalizedBaseUrl(params.get('bridge'))
  for (const discoveryOrigin of WELL_KNOWN_BRIDGES) {
    try {
      const response = await fetch(`${discoveryOrigin}/v1/runtime`, {
        method: 'GET', headers: { accept: 'application/json' }, cache: 'no-store',
        signal: timeoutSignal(),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) continue
      const configured = validRuntimeDiscovery(discoveryOrigin, body)
      if (configured) return configured
    } catch {
      // A refused, malformed, or timed-out candidate is not discovery. Continue
      // through the bounded declared range without trusting its response.
    }
  }
  return {
    ok: false,
    reason: 'action bridge unavailable on the declared 127.0.0.1:4610-4619 range',
    code: 'BRIDGE_DISCOVERY_UNAVAILABLE',
  }
}

async function bootstrap() {
  const configured = await configuredBaseUrl()
  if (!configured.ok) return configured
  try {
    const response = await fetch(`${configured.baseUrl}/v1/bootstrap`, {
      method: 'GET', headers: { accept: 'application/json' }, cache: 'no-store',
      signal: timeoutSignal(),
    })
    const body = await response.json().catch(() => null)
    if (!response.ok || body?.ok !== true || typeof body.token !== 'string') {
      return { ok: false, reason: body?.error?.message || `action bridge refused bootstrap (${response.status})`, code: body?.error?.code || 'BRIDGE_BOOTSTRAP_REFUSED' }
    }
    return { ok: true, baseUrl: configured.baseUrl, token: body.token }
  } catch (error) {
    return unavailable(error)
  }
}

async function session() {
  if (!bootstrapPromise) bootstrapPromise = bootstrap()
  const result = await bootstrapPromise
  if (!result.ok) bootstrapPromise = null
  return result
}

async function request(pathname, { method = 'GET', body = null, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const active = await session()
  if (!active.ok) return active
  try {
    const response = await fetch(`${active.baseUrl}${pathname}`, {
      method,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${active.token}`,
        ...(body === null ? {} : { 'content-type': 'application/json' }),
      },
      cache: 'no-store',
      signal: timeoutSignal(timeoutMs),
      ...(body === null ? {} : { body: JSON.stringify(body) }),
    })
    const value = await response.json().catch(() => null)
    if (!response.ok || value?.ok !== true) {
      if (response.status === 401) bootstrapPromise = null
      return { ok: false, reason: value?.error?.message || `action bridge refused request (${response.status})`, code: value?.error?.code || 'BRIDGE_REQUEST_REFUSED' }
    }
    return value
  } catch (error) {
    bootstrapPromise = null
    return unavailable(error)
  }
}

export function bridgeStatus() {
  return request('/v1/status', { timeoutMs: STATUS_TIMEOUT_MS })
}

/**
 * Cheap availability probe. Uses the unauthenticated, side-effect-free
 * /v1/runtime discovery endpoint (measured ~3ms) rather than /v1/status, so the
 * write surfaces can enable as soon as the bridge is genuinely reachable
 * instead of blocking on a snapshot call that parses queues and writes audit
 * receipts. Returns the same {ok,reason,code} shape as every other call here.
 */
export async function bridgeReachable() {
  const active = await session()
  if (!active.ok) return active
  return { ok: true, baseUrl: active.baseUrl }
}

// Per-action budgets. These are not arbitrary: `dispatch` spawns a real agent
// process (launch record, task lease, child spawn) and was measured taking
// longer than the 5s action budget, which made the UI report BRIDGE_TIMEOUT for
// a dispatch that had ALREADY SUCCEEDED server-side — a lane appeared in the
// registry, ran, and exited 0 while the operator was told it was refused.
// Misreporting a completed spawn as a failure invites a retry, and dispatch
// carries no idempotency key, so the retry would spawn a second agent.
const ACTION_TIMEOUT_MS = Object.freeze({ dispatch: 120_000, queue: 30_000, terminate: 120_000, 'ledger-archive': 120_000 })

export function postBridgeAction(action, body) {
  const pathname = ACTION_ROUTES[action]
  if (!pathname) return Promise.resolve({ ok: false, reason: 'unknown bridge action', code: 'BRIDGE_ACTION_UNKNOWN' })
  return request(pathname, { method: 'POST', body, timeoutMs: ACTION_TIMEOUT_MS[action] ?? REQUEST_TIMEOUT_MS })
}

function validAuditReceipt(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Number.isSafeInteger(value.sequence) && value.sequence > 0
    && /^[a-f0-9]{64}$/.test(String(value.eventHash || ''))
}

const ARCHIVE_REQUEST_ID_RE = /^R[0-9]{1,4}(?:\.[0-9]{1,4})?$/

function validArchiveCandidate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Reflect.ownKeys(value).some(key => !['id', 'reasonCode', 'reason', 'supersedingRequestIds'].includes(key))
      || !['id', 'reasonCode', 'reason'].every(key => Object.hasOwn(value, key))
      || !ARCHIVE_REQUEST_ID_RE.test(String(value.id || ''))
      || !['completed', 'fully-superseded'].includes(value.reasonCode)
      || typeof value.reason !== 'string' || value.reason.length === 0 || value.reason.length > 300
      || /[\r\n]/.test(value.reason)) return false
  const superseding = value.supersedingRequestIds === undefined ? [] : value.supersedingRequestIds
  return Array.isArray(superseding)
    && new Set(superseding).size === superseding.length
    && superseding.every(id => ARCHIVE_REQUEST_ID_RE.test(id))
    && (value.reasonCode === 'fully-superseded' ? superseding.length > 0 : superseding.length === 0)
}

/** Validate the bounded canonical archive receipt before the UI reports a move. */
export function verifiedLedgerArchiveReceipt(result, dryRun) {
  const receipt = result?.receipt
  if (result?.ok !== true
      || !receipt || typeof receipt !== 'object' || Array.isArray(receipt)
      || receipt.action !== 'ledger-archive'
      || receipt.dryRun !== dryRun
      || !canonicalIso(receipt.at)
      || !/^[a-f0-9]{64}$/.test(String(receipt.planSha256 || ''))
      || !Array.isArray(receipt.candidates) || !receipt.candidates.every(validArchiveCandidate)
      || new Set(receipt.candidates.map(candidate => candidate.id)).size !== receipt.candidates.length
      || !Array.isArray(receipt.inconsistencies)
      || !receipt.inconsistencies.every(issue => issue && typeof issue === 'object' && !Array.isArray(issue)
        && Reflect.ownKeys(issue).length === 3
        && ['id', 'code', 'reason'].every(key => Object.hasOwn(issue, key))
        && ARCHIVE_REQUEST_ID_RE.test(String(issue.id || ''))
        && issue.code === 'DONE_WITH_UNMET_GATE'
        && typeof issue.reason === 'string' && issue.reason.length > 0 && issue.reason.length <= 300)
      || !Number.isSafeInteger(receipt.activeCount) || receipt.activeCount < 0
      || !Number.isSafeInteger(receipt.archiveCount) || receipt.archiveCount < 0
      || !Array.isArray(receipt.movedIds)
      || !Number.isSafeInteger(receipt.movedCount) || receipt.movedCount !== receipt.movedIds.length
      || !validAuditReceipt(receipt.audit)) return false
  const candidateIds = receipt.candidates.map(candidate => candidate.id)
  if (dryRun) return receipt.movedCount === 0
  return receipt.movedCount === candidateIds.length
    && JSON.stringify(receipt.movedIds) === JSON.stringify(candidateIds)
    && validAuditReceipt(receipt.intentAudit)
}

function archiveControlState(phase, enabled, label, note, message) {
  return Object.freeze({ phase, enabled, label, note, message })
}

function archivePreviewMessage(receipt) {
  const candidates = receipt.candidates.map(candidate => `${candidate.id} - ${candidate.reason}`).join('; ')
  const issues = receipt.inconsistencies.map(issue => `${issue.id} - ${issue.reason}`).join('; ')
  return [
    candidates ? `Preview: ${candidates}.` : 'Preview: no requests currently qualify.',
    issues ? ` Retained inconsistencies: ${issues}.` : '',
  ].join('')
}

/**
 * Two-step owner control: the first click performs a real dry-run and renders
 * every candidate; only the second click submits {dryRun:false}. Any uncertain
 * response returns to preview instead of silently retrying a move.
 */
export function createLedgerArchiveController({
  postAction = postBridgeAction,
  onState = () => {},
} = {}) {
  let destroyed = false
  let preview = null
  let state = archiveControlState(
    'idle',
    true,
    'Preview cleanup',
    'Owner-gated',
    'Preview completed or fully superseded R requests. Nothing moves on the first click.',
  )
  const publish = next => {
    state = next
    if (!destroyed) onState(state)
  }
  publish(state)

  const runPreview = async () => {
    preview = null
    publish(archiveControlState(
      'pending-preview', false, 'Previewing', 'Dry run',
      'Computing the exact archive set. Nothing has moved.',
    ))
    let result
    try { result = await postAction('ledger-archive', { dryRun: true }) }
    catch (error) {
      result = { ok: false, code: 'BRIDGE_REQUEST_FAILED', reason: error?.message || 'preview failed' }
    }
    if (destroyed) return state
    if (!verifiedLedgerArchiveReceipt(result, true)) {
      publish(archiveControlState(
        'idle', true, 'Preview again', 'No move confirmed',
        `${result?.code || 'BRIDGE_LEDGER_ARCHIVE_PREVIEW_INVALID'}: ${result?.reason || 'The preview receipt was incomplete.'} Nothing moved.`,
      ))
      return state
    }
    preview = result.receipt
    const message = archivePreviewMessage(preview)
    if (preview.candidates.length === 0) {
      publish(archiveControlState('idle', true, 'Preview again', 'Nothing eligible', `${message} Nothing moved.`))
      return state
    }
    publish(archiveControlState(
      'confirm', true,
      `Archive ${preview.candidates.length} request${preview.candidates.length === 1 ? '' : 's'}`,
      'Select again to confirm',
      `${message} Select again to move exactly this preview.`,
    ))
    return state
  }

  const execute = async () => {
    const submittedPreview = preview
    publish(archiveControlState(
      'pending-move', false, 'Archiving', 'Pending',
      'Archive request pending. No move has been confirmed.',
    ))
    let result
    try { result = await postAction('ledger-archive', { dryRun: false }) }
    catch (error) {
      result = { ok: false, code: 'BRIDGE_REQUEST_FAILED', reason: error?.message || 'archive request failed' }
    }
    if (destroyed) return state
    const exactPreview = verifiedLedgerArchiveReceipt(result, false)
      && result.receipt.planSha256 === submittedPreview?.planSha256
      && JSON.stringify(result.receipt.candidates) === JSON.stringify(submittedPreview?.candidates)
    preview = null
    if (!exactPreview) {
      publish(archiveControlState(
        'idle', true, 'Preview current state', 'No move confirmed',
        `${result?.code || 'BRIDGE_LEDGER_ARCHIVE_RECEIPT_INVALID'}: ${result?.reason || 'The archive result did not match the confirmed preview.'} Preview again before any retry.`,
      ))
      return state
    }
    const ids = result.receipt.movedIds.join(', ')
    publish(archiveControlState(
      'success', true, 'Preview cleanup', 'Archived',
      `Archive verified for ${ids || 'no requests'}. The durable active and archive ledgers match the confirmed preview.`,
    ))
    return state
  }

  return Object.freeze({
    click() {
      if (destroyed || state.phase.startsWith('pending')) return Promise.resolve(state)
      if (state.phase === 'confirm' && preview) return execute()
      return runPreview()
    },
    destroy() { destroyed = true },
    getState() { return state },
  })
}

const TERMINAL_AGENT_STATUSES = new Set(['finished', 'failed'])
const SAME_INTENT_RETRY_CODES = new Set([
  'BRIDGE_BOOTSTRAP_REFUSED',
  'BRIDGE_DISCOVERY_UNAVAILABLE',
  'BRIDGE_REQUEST_FAILED',
  'BRIDGE_REQUEST_REFUSED',
  'BRIDGE_TERMINATE_AUDIT_UNAVAILABLE',
  'BRIDGE_TERMINATE_IN_PROGRESS',
  'BRIDGE_TIMEOUT',
  'BRIDGE_UNREACHABLE',
])

function exactNonEmptyId(value) {
  return typeof value === 'string' && value.length > 0 && value.trim() === value
}

function canonicalIso(value) {
  if (typeof value !== 'string') return false
  const epoch = Date.parse(value)
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value
}

/**
 * Decide whether the selected declared agent has a real, exact process target.
 * This deliberately consumes only the projection's controlTarget; it never
 * manufactures one from a declared enabled flag, a route id, or an observed
 * session.
 */
export function terminateTargetAvailability({ live, selectedAgentId, controlTarget }) {
  if (!live) {
    return Object.freeze({
      enabled: false,
      reason: 'Terminate unavailable in simulated mode; no live bridge request will be sent.',
    })
  }
  if (!controlTarget || typeof controlTarget !== 'object' || Array.isArray(controlTarget)) {
    return Object.freeze({
      enabled: false,
      reason: 'Terminate unavailable: no observed control target is mapped to this declared agent.',
    })
  }
  if (!exactNonEmptyId(controlTarget.agentId) || !exactNonEmptyId(controlTarget.runId)) {
    return Object.freeze({
      enabled: false,
      reason: 'Terminate unavailable: the observed control target has no exact agent and run ids.',
    })
  }
  if (controlTarget.agentId !== selectedAgentId) {
    return Object.freeze({
      enabled: false,
      reason: 'Terminate unavailable: the observed control target does not match this declared agent.',
    })
  }
  if (controlTarget.status !== 'running') {
    return Object.freeze({
      enabled: false,
      reason: `Terminate unavailable: observed control target status is ${String(controlTarget.status || 'unknown')}, not running.`,
    })
  }
  if (!Number.isSafeInteger(controlTarget.pid) || controlTarget.pid <= 0) {
    return Object.freeze({
      enabled: false,
      reason: 'Terminate unavailable: the observed control target has no positive integer PID.',
    })
  }
  return Object.freeze({
    enabled: true,
    reason: `Terminate available for observed run ${controlTarget.runId} (PID ${controlTarget.pid}). Select once to review.`,
  })
}

/** Validate the full durable bridge receipt before the UI may claim success. */
export function verifiedTerminateReceipt(result, requestBody) {
  const receipt = result?.receipt
  return result?.ok === true
    && receipt && typeof receipt === 'object' && !Array.isArray(receipt)
    && receipt.action === 'terminate'
    && receipt.idempotencyKey === requestBody?.idempotencyKey
    && receipt.agentId === requestBody?.agentId
    && receipt.runId === requestBody?.expectedRunId
    && receipt.pid === requestBody?.expectedPid
    && receipt.verifiedGone === true
    && TERMINAL_AGENT_STATUSES.has(receipt.terminalStatus)
    && Number.isSafeInteger(receipt.exitCode)
    && canonicalIso(receipt.verifiedGoneAt)
    && Number.isSafeInteger(receipt.terminalAt) && receipt.terminalAt > 0
    && Number.isSafeInteger(receipt.auditSequence) && receipt.auditSequence > 0
    && /^[a-f0-9]{64}$/.test(String(receipt.auditEventHash || ''))
}

function freshTerminateIdempotencyKey() {
  const key = globalThis.crypto?.randomUUID?.()
  if (!exactNonEmptyId(key)) throw new Error('secure idempotency key generation is unavailable')
  return key
}

function frozenControlState(phase, enabled, label, note, message) {
  return Object.freeze({ phase, enabled, label, note, message })
}

/**
 * DOM-independent two-step controller used by the agent view and its focused
 * deterministic probe. An uncertain response retries the exact same request
 * body and idempotency key; a typed target refusal disables the stale control.
 */
export function createTerminateController({
  live,
  selectedAgentId,
  controlTarget,
  postAction = postBridgeAction,
  createIdempotencyKey = freshTerminateIdempotencyKey,
  onState = () => {},
} = {}) {
  const availability = terminateTargetAvailability({ live, selectedAgentId, controlTarget })
  let destroyed = false
  let requestBody = null
  let state = frozenControlState(
    availability.enabled ? 'idle' : 'unavailable',
    availability.enabled,
    'Terminate',
    availability.enabled ? 'Available' : 'Unavailable',
    availability.reason,
  )

  const publish = (next) => {
    state = next
    if (!destroyed) onState(state)
  }
  publish(state)

  const submit = async () => {
    const submittedBody = requestBody
    publish(frozenControlState(
      'pending',
      false,
      'Terminating',
      'Pending',
      'Terminate request pending. No stop has been confirmed.',
    ))

    let result
    try {
      result = await postAction('terminate', submittedBody)
    } catch (error) {
      result = {
        ok: false,
        code: 'BRIDGE_REQUEST_FAILED',
        reason: error?.message || 'terminate request failed',
      }
    }
    if (destroyed || requestBody !== submittedBody) return state

    if (verifiedTerminateReceipt(result, submittedBody)) {
      const receipt = result.receipt
      publish(frozenControlState(
        'success',
        false,
        'Terminated',
        'Verified',
        `Termination verified: run ${receipt.runId} is ${receipt.terminalStatus} with exit ${receipt.exitCode}, and PID ${receipt.pid} is gone.`,
      ))
      return state
    }

    const responseWasShapedSuccess = result?.ok === true
    const code = responseWasShapedSuccess
      ? 'BRIDGE_TERMINATE_RECEIPT_INVALID'
      : (typeof result?.code === 'string' ? result.code : 'BRIDGE_REQUEST_FAILED')
    const reason = responseWasShapedSuccess
      ? 'The terminate response was incomplete or did not match the requested agent, run, and PID.'
      : (result?.reason || 'The terminate request failed without a verified receipt.')
    const retrySameIntent = responseWasShapedSuccess || SAME_INTENT_RETRY_CODES.has(code)
    publish(frozenControlState(
      retrySameIntent ? 'retry' : 'refused',
      retrySameIntent,
      retrySameIntent ? 'Retry terminate' : 'Terminate',
      retrySameIntent ? 'Same intent' : 'Unavailable',
      `${code}: ${reason} No stop has been confirmed.${retrySameIntent ? ' Retry reuses the same request.' : ' Refresh the projection before trying again.'}`,
    ))
    return state
  }

  return Object.freeze({
    click() {
      if (destroyed || !state.enabled || state.phase === 'pending' || state.phase === 'success') {
        return Promise.resolve(state)
      }
      if (state.phase === 'idle') {
        publish(frozenControlState(
          'confirm',
          true,
          'Confirm terminate?',
          'Select again',
          `Terminate agent ${controlTarget.agentId}, run ${controlTarget.runId}, PID ${controlTarget.pid}? Select again to confirm.`,
        ))
        return Promise.resolve(state)
      }
      if (state.phase === 'confirm') {
        let idempotencyKey
        try { idempotencyKey = createIdempotencyKey() }
        catch (error) {
          publish(frozenControlState(
            'idle',
            true,
            'Terminate',
            'Available',
            `BRIDGE_IDEMPOTENCY_UNAVAILABLE: ${error?.message || 'A fresh idempotency key could not be created.'} No request was sent.`,
          ))
          return Promise.resolve(state)
        }
        requestBody = Object.freeze({
          idempotencyKey,
          agentId: controlTarget.agentId,
          expectedRunId: controlTarget.runId,
          expectedPid: controlTarget.pid,
        })
      }
      return submit()
    },
    destroy() { destroyed = true },
    getState() { return state },
  })
}

export function resetBridgeSession() {
  bootstrapPromise = null
}
