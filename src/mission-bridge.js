const ACTION_ROUTES = Object.freeze({
  dispatch: '/v1/actions/dispatch',
  'report-read': '/v1/actions/report-read',
  queue: '/v1/actions/queue',
  'thread-reply': '/v1/actions/thread-reply',
  decision: '/v1/actions/decision',
})

let bootstrapPromise = null
const REQUEST_TIMEOUT_MS = 5_000

function timeoutSignal() {
  return AbortSignal.timeout(REQUEST_TIMEOUT_MS)
}

function unavailable(error) {
  const timedOut = error?.name === 'TimeoutError'
  return { ok: false, reason: timedOut ? 'action bridge timed out' : (error?.message || 'action bridge unreachable'), code: timedOut ? 'BRIDGE_TIMEOUT' : 'BRIDGE_UNREACHABLE' }
}

function configuredBaseUrl() {
  const globalValue = window.__MC_MISSION_BRIDGE_URL__
  const queryValue = new URLSearchParams(window.location.search).get('bridge')
  const candidate = typeof globalValue === 'string' && globalValue ? globalValue : queryValue
  if (!candidate) return { ok: false, reason: 'action bridge not configured' }
  let url
  try { url = new URL(candidate) } catch { return { ok: false, reason: 'action bridge address is malformed' } }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    return { ok: false, reason: 'action bridge address must be a bare loopback HTTP origin' }
  }
  return { ok: true, baseUrl: url.origin }
}

async function bootstrap() {
  const configured = configuredBaseUrl()
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

async function request(pathname, { method = 'GET', body = null } = {}) {
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
      signal: timeoutSignal(),
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
  return request('/v1/status')
}

export function postBridgeAction(action, body) {
  const pathname = ACTION_ROUTES[action]
  if (!pathname) return Promise.resolve({ ok: false, reason: 'unknown bridge action', code: 'BRIDGE_ACTION_UNKNOWN' })
  return request(pathname, { method: 'POST', body })
}

export function resetBridgeSession() {
  bootstrapPromise = null
}
