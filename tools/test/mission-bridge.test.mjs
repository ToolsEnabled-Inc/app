import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
  bridgeStatus,
  configuredBaseUrl,
  resetBridgeSession,
  WELL_KNOWN_BRIDGE_PORTS,
} from '../../src/mission-bridge.js'

const originalFetch = globalThis.fetch
const originalWindow = globalThis.window
// Exactly 43 base64url characters, the shape shell/bridge-proof.cjs enforces.
const SHELL_PROOF = 'mission-bridge-fixture-bootstrap-proof-0001'.padEnd(43, '0')

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body },
  }
}

function runtime(port, overrides = {}) {
  return {
    ok: true,
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    startedAt: '2026-08-06T08:00:00.000Z',
    pid: 43210,
    ...overrides,
  }
}

afterEach(() => {
  globalThis.fetch = originalFetch
  globalThis.window = originalWindow
  resetBridgeSession()
})

test('discovery walks 4610-4619 in order and authenticates only after an exact valid tuple', async () => {
  // The shell proof is part of the bootstrap contract (shell/bridge-proof.cjs):
  // bootstrap refuses before it fetches anything when window.mcShell cannot
  // supply one, so a discovery fixture that omits it never reaches the walk's
  // conclusion. Stubbed here, NOT asserted away -- the plain-browser refusal
  // has its own case in bridge-proof.test.mjs.
  globalThis.window = { location: { search: '' }, mcShell: { getBridgeProof: async () => ({ ok: true, proof: SHELL_PROOF }) } }
  const calls = []
  globalThis.fetch = async (url, options) => {
    const href = String(url)
    calls.push({ url: href, options })
    if (href === 'http://127.0.0.1:4610/v1/runtime') {
      return response(200, runtime(4612))
    }
    if (href === 'http://127.0.0.1:4611/v1/runtime') {
      return response(200, { ...runtime(4611), unexpected: true })
    }
    if (href === 'http://127.0.0.1:4612/v1/runtime') {
      return response(200, runtime(4612))
    }
    if (href === `http://127.0.0.1:4612/v1/bootstrap?proof=${SHELL_PROOF}`) {
      return response(200, { ok: true, token: 'fixture-bearer' })
    }
    if (href === 'http://127.0.0.1:4612/v1/status') {
      return response(200, { ok: true, actions: [] })
    }
    throw new Error(`unexpected fetch ${href}`)
  }

  const status = await bridgeStatus()
  assert.equal(status.ok, true)
  assert.deepEqual(calls.map(call => call.url), [
    'http://127.0.0.1:4610/v1/runtime',
    'http://127.0.0.1:4611/v1/runtime',
    'http://127.0.0.1:4612/v1/runtime',
    `http://127.0.0.1:4612/v1/bootstrap?proof=${SHELL_PROOF}`,
    'http://127.0.0.1:4612/v1/status',
  ])
  assert.equal(calls.slice(0, 4).some(call => Object.hasOwn(call.options.headers, 'authorization')), false)
  assert.equal(calls[4].options.headers.authorization, 'Bearer fixture-bearer')
})

test('discovery returns a typed unavailable result when no candidate answers validly', async () => {
  globalThis.window = { location: { search: '' } }
  const calls = []
  globalThis.fetch = async url => {
    calls.push(url)
    if (url === 'http://127.0.0.1:4614/v1/runtime') return response(200, runtime(4614, { startedAt: 'not-a-date' }))
    throw Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' })
  }

  const configured = await configuredBaseUrl()
  assert.deepEqual(configured, {
    ok: false,
    reason: 'action bridge unavailable on the declared 127.0.0.1:4610-4619 range',
    code: 'BRIDGE_DISCOVERY_UNAVAILABLE',
  })
  assert.equal(calls.length, 10)
  assert.deepEqual(WELL_KNOWN_BRIDGE_PORTS, [4610, 4611, 4612, 4613, 4614, 4615, 4616, 4617, 4618, 4619])
})

test('an explicit bridge query remains first and bypasses well-known discovery', async () => {
  globalThis.window = { location: { search: '?bridge=http%3A%2F%2F127.0.0.1%3A4700' } }
  let fetches = 0
  globalThis.fetch = async () => { fetches += 1; throw new Error('should not fetch') }

  assert.deepEqual(await configuredBaseUrl(), { ok: true, baseUrl: 'http://127.0.0.1:4700' })
  assert.equal(fetches, 0)
})
