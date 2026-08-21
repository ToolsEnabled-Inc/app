// THE BROWSER'S TRANSPORT: the app, unchanged, driving a machine it cannot
// reach directly.
//
// mission-bridge.js funnels every call through one request(); on a machine
// that is a loopback fetch to its own action bridge. This carries the SAME
// request to the person's machine over the sealed relay tunnel, where the
// machine performs it against its own loopback bridge exactly as it would
// locally, and seals the answer back.
//
// The app above this line does not change and does not know. It asks for
// /v1/status and gets the same { ok: true, ... } it has always got.
//
// WHAT THIS IS NOT: it is not a remote bridge address. The bridge is never
// reachable from anywhere but its own machine, before or after this. See the
// note above request() in mission-bridge.js for why the distinction is the
// whole point rather than a technicality.

const decoder = new TextDecoder()

/**
 * client   an online-fra web client handle -- the object createWebClient().connect()
 *          resolves to, with request(method, path, { headers, body }) and closed.
 *
 * Returns a transport for setBridgeTransport().
 */
export function createRelayBridgeTransport(client) {
  if (!client || typeof client.request !== 'function') {
    throw new TypeError('a relay bridge transport needs a connected web client')
  }

  return async function relayTransport(pathname, { method = 'GET', body = null } = {}) {
    let answer
    try {
      answer = await client.request(method, pathname, {
        headers: {
          accept: 'application/json',
          ...(body === null ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === null ? {} : { body: new TextEncoder().encode(JSON.stringify(body)) }),
      })
    } catch (error) {
      // The tunnel's own failures, named as the app already names them, so a
      // machine that is switched off reads as unreachable rather than as a
      // mysterious refusal.
      const code = error?.code === 'WEB_CLIENT_REQUEST_TIMEOUT' ? 'BRIDGE_TIMEOUT' : 'BRIDGE_UNREACHABLE'
      return { ok: false, reason: error?.message || 'that machine is not reachable', code }
    }

    let value = null
    try { value = JSON.parse(decoder.decode(answer.body)) } catch { value = null }

    // The same judgement request() makes locally: a non-2xx, or a body that
    // does not say ok, is a refusal and carries the bridge's own reason.
    if (answer.status < 200 || answer.status >= 300 || value?.ok !== true) {
      return {
        ok: false,
        reason: value?.error?.message || `That machine turned this request down (${answer.status}). Check it is still signed in to this account, then try again.`,
        code: value?.error?.code || 'BRIDGE_REQUEST_REFUSED',
      }
    }
    return value
  }
}
