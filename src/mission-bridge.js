const ACTION_ROUTES = Object.freeze({
  dispatch: '/v1/actions/dispatch',
  'report-read': '/v1/actions/report-read',
  queue: '/v1/actions/queue',
  'thread-reply': '/v1/actions/thread-reply',
  decision: '/v1/actions/decision',
})

let bootstrapPromise = null
const REQUEST_TIMEOUT_MS = 5_000
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

export function postBridgeAction(action, body) {
  const pathname = ACTION_ROUTES[action]
  if (!pathname) return Promise.resolve({ ok: false, reason: 'unknown bridge action', code: 'BRIDGE_ACTION_UNKNOWN' })
  return request(pathname, { method: 'POST', body })
}

export function resetBridgeSession() {
  bootstrapPromise = null
}
