// The transport seam: the app, unchanged, driving a machine over the tunnel.
//
// What matters here is that installing a transport changes WHERE the request
// goes and nothing else -- the same call, the same answer shape, the same
// refusals -- and that it never becomes a way to give the bridge a non-loopback
// address, which is the thing the origin rule exists to prevent.

import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizedBaseUrl, setBridgeTransport, bridgeTransportInstalled, bridgeStatus, bridgeReachable, resetBridgeSession } from '../../src/mission-bridge.js'
import { createRelayBridgeTransport } from '../../src/relay-bridge-transport.js'

const encode = (value) => new TextEncoder().encode(JSON.stringify(value))

/** A web client handle that records what it was asked and answers as a machine would. */
function machine(answerFor = () => ({ status: 200, body: encode({ ok: true, servedBy: 'the machine' }) })) {
  const asked = []
  return {
    asked,
    request: async (method, path, init = {}) => {
      asked.push({ method, path, headers: init.headers, body: init.body ? new TextDecoder().decode(init.body) : null })
      const answer = answerFor(method, path)
      if (answer instanceof Error) throw answer
      return answer
    },
  }
}

test.afterEach(() => { setBridgeTransport(null); resetBridgeSession() })

test('the origin rule is untouched: a transport is not a remote bridge address', () => {
  // The one property the whole seam exists to preserve. Adding a transport
  // must not have made any of these acceptable.
  for (const rejected of ['https://relay.toolsenabled.ai', 'http://192.168.1.10:4610', 'http://example.com', 'http://127.0.0.1:4610/path']) {
    assert.equal(normalizedBaseUrl(rejected).ok, false, `${rejected} must still be refused`)
  }
  assert.equal(normalizedBaseUrl('http://127.0.0.1:4610').ok, true, 'and bare loopback is still the only thing accepted')
})

test('with a transport installed, the app\'s calls go to the machine and come back unchanged', async () => {
  const remote = machine()
  setBridgeTransport(createRelayBridgeTransport(remote))
  assert.equal(bridgeTransportInstalled(), true)

  const result = await bridgeStatus()
  assert.deepEqual(result, { ok: true, servedBy: 'the machine' }, 'the app got the machine\'s own answer, in the shape it always gets')
  assert.equal(remote.asked.length, 1)
  assert.equal(remote.asked[0].path, '/v1/status', 'the same path the app would have asked its own bridge for')
  assert.equal(remote.asked[0].headers.accept, 'application/json')
})

test('a refusal from the far bridge is reported as a refusal, with its own reason', async () => {
  setBridgeTransport(createRelayBridgeTransport(machine(() => ({
    status: 403, body: encode({ ok: false, error: { code: 'BRIDGE_ORIGIN_REFUSED', message: 'Request origin is not allowed.' } }),
  }))))
  const result = await bridgeStatus()
  assert.equal(result.ok, false)
  assert.equal(result.code, 'BRIDGE_ORIGIN_REFUSED', 'the far bridge\'s own code survives the tunnel')
  assert.equal(result.reason, 'Request origin is not allowed.')
})

test('a 200 that does not say ok is still a refusal, exactly as it is locally', async () => {
  setBridgeTransport(createRelayBridgeTransport(machine(() => ({ status: 200, body: encode({ ok: false }) }))))
  const result = await bridgeStatus()
  assert.equal(result.ok, false)
  assert.equal(result.code, 'BRIDGE_REQUEST_REFUSED')
})

test('a machine that is switched off reads as unreachable, not as a mysterious refusal', async () => {
  const gone = new Error('The machine did not answer in time.')
  gone.code = 'WEB_CLIENT_REQUEST_TIMEOUT'
  setBridgeTransport(createRelayBridgeTransport(machine(() => gone)))
  const result = await bridgeStatus()
  assert.equal(result.ok, false)
  assert.equal(result.code, 'BRIDGE_TIMEOUT')

  const dead = new Error('The relay connection closed.')
  dead.code = 'WEB_CLIENT_CLOSED'
  setBridgeTransport(createRelayBridgeTransport(machine(() => dead)))
  assert.equal((await bridgeStatus()).code, 'BRIDGE_UNREACHABLE')
})

test('reachability asks the machine rather than probing a loopback port that is not there', async () => {
  const remote = machine((method, path) => (path === '/v1/runtime'
    ? { status: 200, body: encode({ ok: true, baseUrl: 'http://127.0.0.1:4610', port: 4610 }) }
    : { status: 200, body: encode({ ok: true }) }))
  setBridgeTransport(createRelayBridgeTransport(remote))
  assert.deepEqual(await bridgeReachable(), { ok: true })
  assert.ok(remote.asked.some((c) => c.path === '/v1/runtime'), 'it asked the machine')
})

test('a session reset does not silently drop the tunnel', async () => {
  setBridgeTransport(createRelayBridgeTransport(machine()))
  resetBridgeSession()
  assert.equal(bridgeTransportInstalled(), true,
    'clearing a bearer that only exists locally must not send every later call at a loopback address a browser does not have')
})

test('removing the transport restores the local path', () => {
  setBridgeTransport(createRelayBridgeTransport(machine()))
  setBridgeTransport(null)
  assert.equal(bridgeTransportInstalled(), false)
  assert.throws(() => setBridgeTransport('not a function'), TypeError)
})
