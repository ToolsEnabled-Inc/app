/* THE AGENT FACADE -- the loopback HTTP door of docs/relay-agent-facade-DESIGN.md
 * (§2.3, §3, §4, §6.1), exercised as a REAL listening server on an ephemeral
 * port, because the gates under test are HTTP facts: header order, status
 * codes, socket handling, byte bounds.
 *
 * WHAT THIS PROVES:
 *   1. THE DOOR: Origin refused 403 BEFORE auth; missing/wrong/short bearer
 *      401 (timingSafeEqual on equal-length buffers, plain refusal on a
 *      length mismatch); the right bearer dispatches.
 *   2. THE TABLE: every routed path reaches its surface command with the
 *      documented verb and payload; the three REMOTE-OMITTED dialog commands
 *      have no route at all (404, same as any unknown path); wrong verb 405;
 *      construction refuses a table that disagrees with the surface.
 *   3. THE WIRE DISCIPLINE: bodies over 64 KB are 413 and the socket dies
 *      undrained; a surface {ok:false} RETURN passes through 200 verbatim; a
 *      surface THROW crosses as its bounded code and NOTHING else -- no
 *      path, no stack -- and an unbounded throw becomes AGENT_FACADE_INTERNAL
 *      with the real error going to log, never the wire; org reads shed
 *      overlayFile; oversized list answers are clipped honestly.
 *   4. THE EVENT RING (§6.1): seq monotonic, `after` honoured, dropped:true
 *      once the ring has wrapped (and for a cursor from another boot),
 *      long-poll answers early on emit and empty at the cap, oversize reads
 *      clip with truncated/next.
 *   5. THE PRINCIPAL, against the REAL command surface: mayWrite:false
 *      refuses every write with MC_AGENT_PRINCIPAL_READ_ONLY while reads
 *      answer 200; a relay start never touches bindAgentOwner (no destroyed
 *      hook to a caller that has no WebContents); relay-owned sessions'
 *      events reach the facade's emit while window-owned events do not; the
 *      image fence refuses unpicked images through the facade exactly as it
 *      does on IPC. */
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const facadeModule = require('../../shell/agent-facade.cjs')
const surfaceModule = require('../../shell/agent-command-surface.cjs')

const {
  createAgentFacade,
  ROUTES,
  REMOTE_OMITTED,
  MAX_BODY_BYTES,
  MAX_RESPONSE_BYTES,
  RING_SIZE,
  MAX_WAIT_MS,
} = facadeModule
const { createAgentCommandSurface, COMMANDS } = surfaceModule

const ALL_COMMANDS = Object.freeze(Object.keys(COMMANDS))

/* ---------- helpers ---------- */

/* A raw HTTP call. fetch() is deliberately not used: the WHATWG fetch spec
   forbids setting an Origin header by hand, and the Origin gate is exactly
   what several cases here must exercise. */
function call(origin, { method = 'GET', path = '/', token = null, headers = {}, body = null } = {}) {
  const url = new URL(origin)
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: url.hostname,
      port: url.port,
      method,
      path,
      headers: {
        ...(token === null ? {} : { authorization: 'Bearer ' + token }),
        ...(body === null ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
    }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let json = null
        try { json = JSON.parse(text) } catch { /* some cases assert on text */ }
        resolve({ status: response.statusCode, headers: response.headers, text, json })
      })
      response.on('error', reject)
    })
    request.on('error', reject)
    if (body !== null) request.write(typeof body === 'string' ? body : JSON.stringify(body))
    request.end()
  })
}

/* A fake surface for the wire cases: records every dispatch, answers from a
   per-command script. Carries the REAL command inventory so the facade's
   construction-time parity gate runs against the truth. */
function fakeSurface(overrides = {}) {
  const dispatches = []
  return {
    commands: ALL_COMMANDS,
    sessionLoad: () => ({ open: 3, max: 8 }),
    run: async (command, payload, principal) => {
      dispatches.push({ command, payload, principal })
      if (Object.hasOwn(overrides, command)) {
        const scripted = overrides[command]
        if (typeof scripted === 'function') return scripted(payload, principal)
        return scripted
      }
      return { ok: true, command }
    },
    dispatches,
  }
}

const RELAY = Object.freeze({ kind: 'relay', owner: Object.freeze({ principal: 'relay' }), mayWrite: false, label: 'web (relay)' })

async function listening(t, { surface = fakeSurface(), principal = RELAY, log = null } = {}) {
  const logged = []
  const facade = createAgentFacade({
    surface,
    principalForRelay: typeof principal === 'function' ? principal : () => principal,
    log: log || ((entry) => logged.push(entry)),
  })
  const { origin, token } = await facade.listen()
  t.after(() => facade.close())
  return { facade, origin, token, surface, logged }
}

/* ---------- construction fails closed ---------- */

test('construction refuses a missing surface, principal or log, and a route table that drifts', () => {
  const surface = fakeSurface()
  const principalForRelay = () => RELAY
  const log = () => {}
  assert.throws(() => createAgentFacade(), /surface/)
  assert.throws(() => createAgentFacade({ surface, principalForRelay }), /log/)
  assert.throws(() => createAgentFacade({ surface, log }), /principalForRelay/)
  assert.throws(() => createAgentFacade({ surface: { run: async () => {}, commands: ALL_COMMANDS }, principalForRelay, log }), /sessionLoad/)

  /* A surface command with no facade decision -- neither routed nor named
     omitted -- refuses construction: the §10 parity gate, live. */
  const grown = fakeSurface()
  grown.commands = [...ALL_COMMANDS, 'agent:brand-new']
  assert.throws(() => createAgentFacade({ surface: grown, principalForRelay, log }), /agent:brand-new/)

  /* And the table cannot name a command the surface does not hold. */
  const shrunk = fakeSurface()
  shrunk.commands = ALL_COMMANDS.filter(c => c !== 'org:reset')
  assert.throws(() => createAgentFacade({ surface: shrunk, principalForRelay, log }), /org:reset/)
})

test('the route table serves every command except the three omitted dialogs, each exactly once', () => {
  const routed = Object.values(ROUTES).filter(spec => spec.command).map(spec => spec.command)
  assert.equal(new Set(routed).size, routed.length, 'a command is served by two routes')
  assert.deepEqual(
    [...routed].sort(),
    ALL_COMMANDS.filter(c => !REMOTE_OMITTED.includes(c)).sort(),
  )
  assert.deepEqual([...REMOTE_OMITTED].sort(), ['agent:pick-attachment', 'agent:pick-mention', 'agent:profile-create'])
  for (const spec of Object.values(ROUTES)) {
    assert.ok(spec.method === 'GET' || spec.method === 'POST')
  }
  /* The two facade-only routes exist and serve no surface command. */
  assert.equal(ROUTES['/v1/agent/remote-status'].facade, 'remote-status')
  assert.equal(ROUTES['/v1/agent/events'].facade, 'events')
})

/* ---------- the door: Origin, then the bearer ---------- */

test('any request carrying an Origin header is refused 403 BEFORE auth', async (t) => {
  const { origin, token, surface } = await listening(t)
  /* With a VALID token and an Origin: still refused as a browser -- the
     Origin gate runs first, so a browser never learns whether a stolen
     token was right. */
  const withToken = await call(origin, { path: '/v1/agent/history', token, headers: { origin: 'https://toolsenabled.example' } })
  assert.equal(withToken.status, 403)
  assert.deepEqual(withToken.json, { ok: false, error: { code: 'AGENT_FACADE_NO_BROWSERS' } })
  /* With NO token and an Origin: 403, not 401 -- proof of the order. */
  const withoutToken = await call(origin, { path: '/v1/agent/history', headers: { origin: 'null' } })
  assert.equal(withoutToken.status, 403)
  assert.equal(withoutToken.json.error.code, 'AGENT_FACADE_NO_BROWSERS')
  assert.equal(surface.dispatches.length, 0, 'a browser-marked request reached the surface')
})

test('the bearer: absent, malformed, wrong and short all refuse 401; the minted one dispatches', async (t) => {
  const { origin, token, surface } = await listening(t)
  assert.equal((await call(origin, { path: '/v1/agent/history' })).status, 401)
  assert.equal((await call(origin, { path: '/v1/agent/history', headers: { authorization: 'Basic ' + token } })).status, 401)
  const flipped = (token[0] === 'A' ? 'B' : 'A') + token.slice(1)
  assert.equal(flipped.length, token.length)
  assert.equal((await call(origin, { path: '/v1/agent/history', token: flipped })).status, 401, 'an equal-length wrong token was accepted')
  assert.equal((await call(origin, { path: '/v1/agent/history', token: token.slice(0, 10) })).status, 401, 'a short token was accepted (or crashed the compare)')
  assert.equal((await call(origin, { path: '/v1/agent/history', token: token + 'A' })).status, 401, 'a long token was accepted')
  assert.equal(surface.dispatches.length, 0, 'a refused caller reached the surface')

  const accepted = await call(origin, { path: '/v1/agent/history?limit=5', token })
  assert.equal(accepted.status, 200)
  assert.equal(surface.dispatches.length, 1)
  /* The token is 32 bytes, base64url -- 43 characters, no padding. */
  assert.match(token, /^[A-Za-z0-9_-]{43}$/)
})

test('each listen() mints a fresh bearer and the old one stops working', async (t) => {
  const { facade, origin, token } = await listening(t)
  const again = await facade.listen()
  assert.equal(again.origin, origin, 'a re-listen moved the origin')
  assert.notEqual(again.token, token)
  assert.equal((await call(origin, { path: '/v1/agent/profiles', token })).status, 401, 'the superseded bearer still opens the door')
  assert.equal((await call(origin, { path: '/v1/agent/profiles', token: again.token })).status, 200)
})

/* ---------- the table, walked whole ---------- */

test('every routed path dispatches its command with the documented verb and payload, as the relay principal', async (t) => {
  const { origin, token, surface } = await listening(t)
  const expectations = [
    ['GET', '/v1/agent/availability', 'agent:availability', {}],
    ['GET', '/v1/agent/confinement', 'agent:confinement', {}],
    ['GET', '/v1/agent/tools', 'agent:tools', {}],
    ['GET', '/v1/agent/startable-tiers', 'agent:startable-tiers', {}],
    ['GET', '/v1/agent/local-messages?limit=7', 'agent:local-messages', { limit: 7 }],
    ['GET', '/v1/agent/history?limit=20', 'agent:history', { limit: 20 }],
    ['GET', '/v1/agent/usage?limit=3', 'agent:usage', { limit: 3 }],
    ['POST', '/v1/agent/start', 'agent:start', { sessionId: 's1', tier: 'luna' }],
    ['POST', '/v1/agent/send', 'agent:send', { sessionId: 's1', text: 'hello' }],
    ['POST', '/v1/agent/request', 'agent:request', { scope: 'tree', words: 'w' }],
    ['GET', '/v1/agent/requests?scope=tree&key=k1', 'agent:requests', { scope: 'tree', key: 'k1' }],
    ['GET', '/v1/agent/profiles', 'agent:profiles', {}],
    ['POST', '/v1/agent/profile-remove', 'agent:profile-remove', { profileId: 'p1' }],
    ['POST', '/v1/agent/interrupt', 'agent:interrupt', { sessionId: 's1' }],
    ['POST', '/v1/agent/approval-answer', 'agent:approval-answer', { sessionId: 's1', approvalId: 'a', decision: 'approve' }],
    ['POST', '/v1/agent/rewind', 'agent:rewind', { sessionId: 's1', turnId: 't1' }],
    ['POST', '/v1/agent/effort', 'agent:effort', { sessionId: 's1', effort: 'high' }],
    ['GET', '/v1/agent/models?sessionId=s1', 'agent:models', { sessionId: 's1' }],
    ['POST', '/v1/agent/close', 'agent:close', { sessionId: 's1' }],
    ['GET', '/v1/org', 'org:read', {}],
    ['POST', '/v1/org/reparent', 'org:reparent', { agentId: 'a', parentId: null, expectedRevision: 2 }],
    ['POST', '/v1/org/assign-role', 'org:assign-role', { agentId: 'a', role: 'lead', expectedRevision: 2 }],
    ['POST', '/v1/org/create-role', 'org:create-role', { id: 'r', baseDefaultRole: null, rules: [] }],
    ['POST', '/v1/org/edit-role', 'org:edit-role', { id: 'r', rules: [] }],
    ['POST', '/v1/org/reset-role', 'org:reset-role', { id: 'r' }],
    ['POST', '/v1/org/reset', 'org:reset', {}],
    ['GET', '/v1/org/export', 'org:export', {}],
  ]
  /* The list above IS the route table: every command-serving route appears. */
  const covered = new Set(expectations.map(([, path]) => path.split('?')[0]))
  const commandRoutes = Object.entries(ROUTES).filter(([, spec]) => spec.command).map(([route]) => route)
  assert.deepEqual([...covered].sort(), commandRoutes.sort(), 'this test must walk the whole table')

  for (const [method, path, command, payload] of expectations) {
    surface.dispatches.length = 0
    const reply = await call(origin, { method, path, token, body: method === 'POST' ? payload : null })
    assert.equal(reply.status, 200, `${method} ${path} did not dispatch: ${reply.text}`)
    assert.equal(surface.dispatches.length, 1, `${method} ${path}`)
    const seen = surface.dispatches[0]
    assert.equal(seen.command, command, path)
    assert.deepEqual(seen.payload, payload, path)
    assert.equal(seen.principal, RELAY, `${path} ran under a principal that is not the relay's`)
  }
})

test('a POST body that is absent parses as the empty payload, and non-JSON refuses', async (t) => {
  const { origin, token, surface } = await listening(t)
  const bare = await call(origin, { method: 'POST', path: '/v1/org/reset', token })
  assert.equal(bare.status, 200)
  assert.deepEqual(surface.dispatches[0].payload, {})
  assert.equal((await call(origin, { method: 'POST', path: '/v1/agent/start', token, body: 'not json {' })).json.error.code, 'AGENT_FACADE_BAD_JSON')
  assert.equal((await call(origin, { method: 'POST', path: '/v1/agent/start', token, body: '[1,2]' })).json.error.code, 'AGENT_FACADE_BAD_JSON')
  assert.equal((await call(origin, { method: 'POST', path: '/v1/agent/start', token, body: '"words"' })).json.error.code, 'AGENT_FACADE_BAD_JSON')
})

test('unknown routes 404 -- and the three omitted dialog commands are unknown routes, not refusals of their own', async (t) => {
  const { origin, token, surface } = await listening(t)
  for (const path of [
    '/v1/agent/nope',
    '/v1/agent',
    '/v1/org/read',
    '/',
    '/v1/agent/pick-attachment',
    '/v1/agent/pick-mention',
    '/v1/agent/profile-create',
  ]) {
    const asGet = await call(origin, { path, token })
    assert.equal(asGet.status, 404, path)
    assert.deepEqual(asGet.json, { ok: false, error: { code: 'AGENT_FACADE_UNKNOWN_ROUTE' } }, path)
    const asPost = await call(origin, { method: 'POST', path, token, body: { sessionId: 's1' } })
    assert.equal(asPost.status, 404, path)
    assert.equal(asPost.json.error.code, 'AGENT_FACADE_UNKNOWN_ROUTE', path)
  }
  assert.equal(surface.dispatches.length, 0, 'an unrouted path reached the surface')
  /* But an unauthenticated caller is told nothing about the table. */
  assert.equal((await call(origin, { path: '/v1/agent/nope' })).status, 401)
})

test('the wrong verb on a known route is 405, and undeclared query keys refuse', async (t) => {
  const { origin, token, surface } = await listening(t)
  const wrongVerb = await call(origin, { method: 'POST', path: '/v1/agent/history', token, body: {} })
  assert.equal(wrongVerb.status, 405)
  assert.equal(wrongVerb.json.error.code, 'AGENT_FACADE_METHOD_NOT_ALLOWED')
  assert.equal(wrongVerb.headers.allow, 'GET')
  assert.equal((await call(origin, { path: '/v1/agent/start', token })).status, 405)
  assert.equal((await call(origin, { path: '/v1/agent/history?limit=abc', token })).json.error.code, 'AGENT_FACADE_BAD_QUERY')
  assert.equal((await call(origin, { path: '/v1/agent/profiles?x=1', token })).json.error.code, 'AGENT_FACADE_BAD_QUERY')
  assert.equal((await call(origin, { method: 'POST', path: '/v1/agent/close?x=1', token, body: { sessionId: 's' } })).json.error.code, 'AGENT_FACADE_BAD_QUERY')
  assert.equal(surface.dispatches.length, 0)
})

/* ---------- body bounds ---------- */

test('a declared body over 64 KB answers 413 and the socket is destroyed, not drained', async (t) => {
  const { origin, token, surface } = await listening(t)
  const url = new URL(origin)
  const outcome = await new Promise((resolve, reject) => {
    const request = http.request({
      host: url.hostname,
      port: url.port,
      method: 'POST',
      path: '/v1/agent/start',
      headers: {
        authorization: 'Bearer ' + token,
        'content-type': 'application/json',
        'content-length': String(MAX_BODY_BYTES + 1024),
      },
    }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode, text: Buffer.concat(chunks).toString('utf8'), socket: request.socket }))
      response.on('error', reject)
    })
    request.on('error', reject)
    /* Only a sliver is sent; the refusal must come from the DECLARED size,
       before the facade has read anything like 64 KB. */
    request.write('{"sessionId":')
  })
  assert.equal(outcome.status, 413)
  assert.equal(JSON.parse(outcome.text).error.code, 'AGENT_FACADE_BODY_TOO_LARGE')
  assert.equal(surface.dispatches.length, 0)
  /* Destroyed, not drained: the connection dies without the body ever being
     accepted. */
  await new Promise((resolve) => {
    if (outcome.socket.destroyed || outcome.socket.closed) return resolve()
    outcome.socket.on('close', resolve)
  })
})

test('a chunked body that crosses 64 KB is cut off mid-stream and never dispatches', async (t) => {
  const { origin, token, surface } = await listening(t)
  const url = new URL(origin)
  const ended = await new Promise((resolve) => {
    const request = http.request({
      host: url.hostname,
      port: url.port,
      method: 'POST',
      path: '/v1/agent/start',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    })
    let verdict = null
    request.on('response', (response) => {
      verdict = response.statusCode
      response.resume()
      response.on('end', () => resolve({ verdict }))
      response.on('error', () => resolve({ verdict }))
    })
    request.on('error', () => resolve({ verdict }))
    /* No content-length: the cap must bite on the accumulated stream. */
    const chunk = Buffer.alloc(8 * 1024, 'x')
    for (let i = 0; i < 12; i += 1) request.write(chunk)
  })
  /* The client sees the 413 or the reset, depending on how fast the
     destruction lands -- either way the refusal held: */
  if (ended.verdict !== null) assert.equal(ended.verdict, 413)
  assert.equal(surface.dispatches.length, 0, 'an oversize body reached the surface')
})

/* ---------- error discipline: the code is the message ---------- */

test('a handler that RETURNS {ok:false,...} passes through as 200 with the body verbatim', async (t) => {
  const refusal = { ok: false, code: 'ORG_REVISION_STALE', reason: 'the org changed underneath this edit' }
  const surface = fakeSurface({ 'org:reparent': refusal, 'agent:availability': { ok: false, code: 'SPAWN_RECORD_UNAVAILABLE' } })
  const { origin, token } = await listening(t, { surface })
  const org = await call(origin, { method: 'POST', path: '/v1/org/reparent', token, body: { agentId: 'a', parentId: null } })
  assert.equal(org.status, 200)
  assert.deepEqual(org.json, refusal)
  const availability = await call(origin, { path: '/v1/agent/availability', token })
  assert.equal(availability.status, 200)
  assert.deepEqual(availability.json, { ok: false, code: 'SPAWN_RECORD_UNAVAILABLE' })
})

test('a surface throw with a bounded code crosses as that code and NOTHING else', async (t) => {
  const throwWith = (code, message) => () => {
    const error = new Error(message)
    error.code = code
    throw error
  }
  const surface = fakeSurface({
    'agent:send': throwWith('MC_AGENT_UNKNOWN_SESSION', 'Unknown sessionId: C:\\Users\\bob\\secret at Object.run (C:\\app\\shell\\main.cjs:100)'),
    'agent:start': throwWith('MC_AGENT_SESSION_EXISTS', 'Session already exists: chat-1'),
    'agent:interrupt': throwWith('AGENT_ENGINE_MISSING', 'Unable to run codex: C:\\secret\\engine'),
  })
  const { origin, token, logged } = await listening(t, { surface })

  const unknown = await call(origin, { method: 'POST', path: '/v1/agent/send', token, body: { sessionId: 's', text: 'hi' } })
  assert.equal(unknown.status, 404)
  assert.deepEqual(unknown.json, { ok: false, error: { code: 'MC_AGENT_UNKNOWN_SESSION' } })
  const exists = await call(origin, { method: 'POST', path: '/v1/agent/start', token, body: {} })
  assert.equal(exists.status, 409)
  assert.deepEqual(exists.json, { ok: false, error: { code: 'MC_AGENT_SESSION_EXISTS' } })
  const engine = await call(origin, { method: 'POST', path: '/v1/agent/interrupt', token, body: { sessionId: 's' } })
  assert.equal(engine.status, 500)
  assert.deepEqual(engine.json, { ok: false, error: { code: 'AGENT_ENGINE_MISSING' } })

  /* NOTHING else: no path separator of either kind, no stack fragment. */
  for (const reply of [unknown, exists, engine]) {
    assert.ok(!reply.text.includes('/'), 'a path crossed: ' + reply.text)
    assert.ok(!reply.text.includes('\\'), 'a path crossed: ' + reply.text)
    assert.ok(!reply.text.includes('at '), 'a stack fragment crossed: ' + reply.text)
  }
  assert.equal(logged.length, 0, 'a bounded refusal is not an internal error and does not need the log')
})

test('an unbounded throw becomes AGENT_FACADE_INTERNAL on the wire and the real error goes to log', async (t) => {
  const secret = new Error('ENOENT: no such file C:\\Users\\bob\\vault\\key.pem')
  const surface = fakeSurface({ 'agent:tools': () => { throw secret } })
  const { origin, token, logged } = await listening(t, { surface })
  const reply = await call(origin, { path: '/v1/agent/tools', token })
  assert.equal(reply.status, 500)
  assert.deepEqual(reply.json, { ok: false, error: { code: 'AGENT_FACADE_INTERNAL' } })
  assert.ok(!reply.text.includes('\\') && !reply.text.includes('/') && !reply.text.includes('at '))
  assert.deepEqual(logged, [secret], 'the real error must land in the log, once')

  /* rendererSafeAgentError makes the MESSAGE the code; a throw shaped that
     way (code lost, message bounded) still crosses as the code. */
  const messageOnly = fakeSurface({ 'agent:tools': () => { throw new Error('AGENT_SESSION_FAILED') } })
  const second = await listening(t, { surface: messageOnly })
  const asCode = await call(second.origin, { path: '/v1/agent/tools', token: second.token })
  assert.equal(asCode.status, 500)
  assert.deepEqual(asCode.json, { ok: false, error: { code: 'AGENT_SESSION_FAILED' } })
})

test('org reads shed overlayFile -- the one absolute path the IPC answer carries', async (t) => {
  const surface = fakeSurface({
    'org:read': { ok: true, org: { agents: [] }, roles: ['worker'], overlayFile: 'C:\\Users\\bob\\AppData\\org-overlay.json' },
    'org:export': { ok: true, document: { agents: [] }, overlayFile: 'C:\\Users\\bob\\AppData\\org-overlay.json' },
  })
  const { origin, token } = await listening(t, { surface })
  const read = await call(origin, { path: '/v1/org', token })
  assert.equal(read.status, 200)
  assert.deepEqual(read.json, { ok: true, org: { agents: [] }, roles: ['worker'] })
  assert.ok(!read.text.includes('\\'))
  const exported = await call(origin, { path: '/v1/org/export', token })
  assert.deepEqual(exported.json, { ok: true, document: { agents: [] } })
})

test('an oversized list answer is clipped from the OLD end and marked truncated', async (t) => {
  const entries = []
  for (let i = 0; i < 1200; i += 1) entries.push({ sequence: i, at: '2026-08-21T00:00:00Z', action: 'start', note: 'x'.repeat(80) })
  const surface = fakeSurface({ 'agent:history': { ok: true, total: 1200, entries } })
  const { origin, token } = await listening(t, { surface })
  const reply = await call(origin, { path: '/v1/agent/history', token })
  assert.equal(reply.status, 200)
  assert.ok(Buffer.byteLength(reply.text) <= MAX_RESPONSE_BYTES)
  assert.equal(reply.json.truncated, true)
  assert.ok(reply.json.entries.length > 0 && reply.json.entries.length < 1200)
  assert.equal(reply.json.entries.at(-1).sequence, 1199, 'the NEWEST entry must survive the clip')
  assert.equal(reply.json.entries[0].sequence, 1200 - reply.json.entries.length, 'the clip must come off the old end')

  /* A body with nothing to clip refuses honestly instead of feeding the
     tunnel a frame it will reject two hops later. */
  const unclippable = fakeSurface({ 'org:export': { ok: true, document: { blob: 'y'.repeat(MAX_RESPONSE_BYTES + 1024) } } })
  const second = await listening(t, { surface: unclippable })
  const refused = await call(second.origin, { path: '/v1/org/export', token: second.token })
  assert.equal(refused.status, 500)
  assert.equal(refused.json.error.code, 'AGENT_FACADE_RESPONSE_TOO_LARGE')
})

/* ---------- remote-status ---------- */

test('remote-status answers the documented shape from the surface session load', async (t) => {
  const { origin, token, surface } = await listening(t)
  const reply = await call(origin, { path: '/v1/agent/remote-status', token })
  assert.equal(reply.status, 200)
  assert.deepEqual(reply.json, { ok: true, facade: 'ready', sessionsOpen: 3, maxSessions: 8 })
  assert.equal(surface.dispatches.length, 0, 'remote-status is the facade speaking for itself, not a command')
  assert.equal((await call(origin, { path: '/v1/agent/remote-status' })).status, 401, 'status still needs the bearer')
})

/* ---------- the event ring ---------- */

test('events: seq is monotonic, after is honoured, and a sessionId filter narrows without moving seq', async (t) => {
  const { facade, origin, token } = await listening(t)
  for (let i = 1; i <= 5; i += 1) facade.emit({ sessionId: i % 2 ? 'odd' : 'even', event: { type: 'n', n: i } })
  const all = await call(origin, { path: '/v1/agent/events?after=0', token })
  assert.equal(all.status, 200)
  assert.equal(all.json.seq, 5)
  assert.equal(all.json.dropped, false)
  assert.deepEqual(all.json.events.map(e => e.seq), [1, 2, 3, 4, 5], 'seq must be monotonic from 1')
  assert.deepEqual(all.json.events[0].packet, { sessionId: 'odd', event: { type: 'n', n: 1 } }, 'packets ride verbatim')

  const after = await call(origin, { path: '/v1/agent/events?after=3', token })
  assert.deepEqual(after.json.events.map(e => e.seq), [4, 5])

  const filtered = await call(origin, { path: '/v1/agent/events?after=0&sessionId=even', token })
  assert.deepEqual(filtered.json.events.map(e => e.seq), [2, 4])
  assert.equal(filtered.json.seq, 5, 'the cursor is global even when the view is filtered')

  const caughtUp = await call(origin, { path: '/v1/agent/events?after=5', token })
  assert.deepEqual(caughtUp.json, { ok: true, seq: 5, events: [], dropped: false })
})

test('events: dropped:true once the ring has wrapped past the cursor, and for a cursor from another boot', async (t) => {
  const { facade, origin, token } = await listening(t)
  const overflow = RING_SIZE + 10
  for (let i = 1; i <= overflow; i += 1) facade.emit({ sessionId: 's', event: { n: i } })
  /* after=0 predates the ring: events were lost and the answer says so. */
  const stale = await call(origin, { path: '/v1/agent/events?after=0&waitMs=9999', token })
  assert.equal(stale.json.dropped, true, 'a wrapped ring must not pretend continuity')
  assert.equal(stale.json.seq, overflow)
  /* A cursor INSIDE the ring is still honest. */
  const inside = await call(origin, { path: `/v1/agent/events?after=${overflow - 3}`, token })
  assert.equal(inside.json.dropped, false)
  assert.deepEqual(inside.json.events.map(e => e.seq), [overflow - 2, overflow - 1, overflow])
  /* A cursor beyond anything this boot issued is another life's: resync. */
  const future = await call(origin, { path: `/v1/agent/events?after=${overflow + 100}`, token })
  assert.equal(future.json.dropped, true)
  assert.deepEqual(future.json.events, [])
})

test('events: an oversize read clips under the response bound and hands back a next cursor', async (t) => {
  const { facade, origin, token } = await listening(t)
  const fat = 'z'.repeat(60 * 1024)
  facade.emit({ sessionId: 's', event: { blob: fat } })
  facade.emit({ sessionId: 's', event: { blob: fat } })
  const first = await call(origin, { path: '/v1/agent/events?after=0', token })
  assert.equal(first.json.events.length, 1)
  assert.equal(first.json.truncated, true)
  assert.equal(first.json.next, 1)
  assert.ok(Buffer.byteLength(first.text) <= MAX_RESPONSE_BYTES + 128)
  const rest = await call(origin, { path: '/v1/agent/events?after=1', token })
  assert.deepEqual(rest.json.events.map(e => e.seq), [2])
})

test('events: the long-poll answers early on a matching emit and empty at the cap', async (t) => {
  const { facade, origin, token } = await listening(t)
  assert.equal(MAX_WAIT_MS, 25_000)
  facade.emit({ sessionId: 'other', event: { n: 1 } })

  /* Early: a poll parked past the current seq wakes on the next emit. */
  const parked = call(origin, { path: '/v1/agent/events?after=1&waitMs=20000', token })
  const started = Date.now()
  setTimeout(() => facade.emit({ sessionId: 's', event: { n: 2 } }), 60)
  const woken = await parked
  assert.ok(Date.now() - started < 5000, 'the poll waited out its window despite an emit')
  assert.deepEqual(woken.json.events.map(e => e.seq), [2])

  /* A poll filtered to one session sleeps through other sessions' events. */
  const filtered = call(origin, { path: '/v1/agent/events?after=2&sessionId=mine&waitMs=300', token })
  setTimeout(() => facade.emit({ sessionId: 'other', event: { n: 3 } }), 30)
  const slept = await filtered
  assert.deepEqual(slept.json.events, [], 'an event for another session woke a filtered poll')
  assert.equal(slept.json.seq, 3, 'but the cursor still tells the truth')

  /* At the cap: an empty window answers empty, with the current seq. */
  const before = Date.now()
  const expired = await call(origin, { path: '/v1/agent/events?after=3&waitMs=200', token })
  assert.ok(Date.now() - before >= 150, 'the poll did not actually wait')
  assert.deepEqual(expired.json, { ok: true, seq: 3, events: [], dropped: false })
})

/* ---------- against the REAL surface: the principal, the bind, the fan-out ---------- */

function realDeps(overrides = {}) {
  const calls = []
  const note = (name, ...args) => calls.push({ name, args })
  function agentIpcError(code, message) {
    const error = new Error(message)
    error.code = code
    throw error
  }
  function rendererSafeAgentError(error) {
    const code = typeof error?.code === 'string' && error.code.length > 0 && error.code.length <= 128 ? error.code : 'AGENT_SESSION_FAILED'
    const safe = new Error(code)
    safe.code = code
    return safe
  }
  function agentPayload(value, allowedKeys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) agentIpcError('MC_AGENT_INVALID_PAYLOAD', 'payload')
    for (const key of Object.keys(value)) if (!allowedKeys.includes(key)) agentIpcError('MC_AGENT_INVALID_PAYLOAD', 'unexpected: ' + key)
    return value
  }
  function boundedAgentString(value, name, maxLength) {
    if (typeof value !== 'string' || value.length === 0 || value.length > maxLength || value.includes('\0')) {
      agentIpcError('MC_AGENT_INVALID_PAYLOAD', name)
    }
    return value
  }
  const host = {
    startSession: async (request) => ({ sessionId: request.sessionId, threadId: 'thread-1', tier: 'unrestricted', effort: 'medium', account: 'acct-1' }),
    sendTurn: async (request) => ({ sessionId: request.sessionId, threadId: 'thread-1', turnId: 'turn-1' }),
    interrupt: async (request) => ({ sessionId: request.sessionId, turnId: 'turn-1' }),
    answerApproval: async (request) => ({ ...request }),
    rewindSession: async (request) => ({ ...request, threadId: 'thread-2' }),
    setSessionEffort: async (request) => ({ ...request }),
    listEngineModels: async () => ({ ok: true, models: [] }),
    closeSession: async (request) => ({ sessionId: request.sessionId, closed: true }),
    startableTiers: () => ({ ok: true, tiers: ['luna'] }),
    fileStandingRequest: async (request) => ({ ok: true, id: 'r-1', ...request }),
  }
  let sequence = 0
  return {
    agentSessions: new Map(),
    currentAgentHost: () => host,
    getAgentHost: () => host,
    agentIpcError,
    agentPayload,
    boundedAgentString,
    parseAgentStart: (value) => {
      const payload = agentPayload(value, ['sessionId', 'tier', 'effort', 'profileId', 'resumeThreadId', 'surface', 'requestKeys', 'cwd'])
      if (payload.cwd !== undefined) agentIpcError('MC_AGENT_CWD_NOT_YOURS', 'no')
      return { sessionId: boundedAgentString(payload.sessionId ?? 'chat-generated', 'sessionId', 128) }
    },
    parseAgentSend: (value) => {
      const payload = agentPayload(value, ['sessionId', 'text', 'model', 'images'])
      const request = { sessionId: boundedAgentString(payload.sessionId, 'sessionId', 128), text: boundedAgentString(payload.text, 'text', 200000) }
      if (payload.images !== undefined) request.images = payload.images.map(image => ({ path: boundedAgentString(image && image.path, 'image path', 32768) }))
      return request
    },
    parseAgentSessionCommand: (value) => ({ sessionId: boundedAgentString(agentPayload(value, ['sessionId']).sessionId, 'sessionId', 128) }),
    rendererSafeAgentError,
    spawnRecordAvailability: () => ({ ok: true }),
    spawnRecordHistory: (limit) => ({ ok: true, total: 0, entries: [], limit }),
    usageRecordHistory: (limit) => ({ ok: true, total: 0, entries: [], limit }),
    engineAvailability: () => ({ ok: true, code: 'AGENT_ENGINE_READY' }),
    ensureWorkspaceRoot: () => 'C:\\fake\\workspace',
    chosenWorkspaceCwd: () => null,
    readAgentConfinement: () => ({ ok: true, tier: 'guided' }),
    listAgentTools: () => ({ ok: true, tier: 'guided', total: 0, tools: [] }),
    resolveCapabilityRoot: () => null,
    requireModule: () => ({ ownerJournal: async () => ({ ok: true, messages: [] }) }),
    readStandingRequests: () => ({ ok: true, exists: false, entries: [] }),
    sessionProfiles: { list: () => [], create: () => null, remove: () => true, resolveCwd: () => 'C:\\fake\\p' },
    recordSpawnIntent: () => { sequence += 1; return { sequence, eventHash: 'hash-' + sequence } },
    recordSpawnOutcome: () => {},
    recordSessionEnd: (session) => { session.ended = true },
    bindAgentOwner: (owner) => note('bindAgentOwner', owner),
    agentOrgRecord: {
      read: () => ({ ok: true, org: {}, roles: [], overlayFile: 'C:\\overlay.json' }),
      reparent: () => ({ ok: true, org: {} }),
      assignRole: () => ({ ok: true, org: {} }),
      createRole: () => ({ ok: true, roles: [] }),
      editRole: () => ({ ok: true, roles: [] }),
      resetRole: () => ({ ok: true, roles: [] }),
      resetOrg: () => ({ ok: true, org: {} }),
      exportOrg: () => ({ ok: true, document: {} }),
    },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    MAX_AGENT_SESSIONS: 8,
    MAX_SESSION_ID_LENGTH: 128,
    AGENT_EFFORT_VALUES: Object.freeze(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']),
    WORKSPACE_ROOT: 'C:\\fake\\workspace',
    calls,
    names: () => calls.map(c => c.name),
    ...overrides,
  }
}

const WINDOW_OWNER = Object.freeze({ id: 'webContents-1' })
const windowPrincipal = Object.freeze({ kind: 'window', owner: WINDOW_OWNER, mayWrite: true, label: 'the application window' })

test('through the facade, a relay principal with mayWrite:false is refused every write and served every read', async (t) => {
  const deps = realDeps()
  const surface = createAgentCommandSurface(deps)
  const { origin, token } = await listening(t, { surface })

  const start = await call(origin, { method: 'POST', path: '/v1/agent/start', token, body: { sessionId: 'web-1' } })
  assert.equal(start.status, 403)
  assert.deepEqual(start.json, { ok: false, error: { code: 'MC_AGENT_PRINCIPAL_READ_ONLY' } })
  assert.ok(!start.text.includes('web (relay)'), 'the refusal sentence must stay on the machine; only the code crosses')
  assert.equal(deps.agentSessions.size, 0)

  const history = await call(origin, { path: '/v1/agent/history?limit=5', token })
  assert.equal(history.status, 200)
  assert.deepEqual(history.json, { ok: true, total: 0, entries: [], limit: 5 })
  const org = await call(origin, { path: '/v1/org', token })
  assert.equal(org.status, 200)
  assert.deepEqual(org.json, { ok: true, org: {}, roles: [] })

  const orgWrite = await call(origin, { method: 'POST', path: '/v1/org/reset', token })
  assert.equal(orgWrite.json.error.code, 'MC_AGENT_PRINCIPAL_READ_ONLY')
})

test('a relay start binds no destroyed hook, and the omitted dialogs are double-locked behind the 404', async (t) => {
  const deps = realDeps()
  const surface = createAgentCommandSurface(deps)
  const writingRelay = Object.freeze({ kind: 'relay', owner: RELAY.owner, mayWrite: true, label: 'web (relay)' })
  const { origin, token } = await listening(t, { surface, principal: writingRelay })

  const started = await call(origin, { method: 'POST', path: '/v1/agent/start', token, body: { sessionId: 'web-1' } })
  assert.equal(started.status, 200, started.text)
  assert.equal(deps.agentSessions.get('web-1').owner, RELAY.owner)
  assert.equal(deps.agentSessions.get('web-1').ownerKind, 'relay')
  assert.ok(!deps.names().includes('bindAgentOwner'),
    'a relay start must NOT bind the destroyed hook: a dropped tab must not kill agents')

  /* The same surface still binds the hook for a window start. */
  await surface.run('agent:start', { sessionId: 'desk-1' }, windowPrincipal)
  assert.deepEqual(deps.calls.filter(c => c.name === 'bindAgentOwner').map(c => c.args), [[WINDOW_OWNER]])

  /* The second lock: even if a picker route existed, the surface refuses a
     relay principal every dialog by kind. */
  const secondLock = await surface.run('agent:pick-attachment', { sessionId: 'web-1' }, writingRelay).then(() => null, (error) => error)
  assert.equal(secondLock.code, 'MC_AGENT_DIALOG_REQUIRES_WINDOW')
  /* And the first lock: the facade has no such route. */
  assert.equal((await call(origin, { method: 'POST', path: '/v1/agent/pick-attachment', token, body: { sessionId: 'web-1' } })).status, 404)

  /* The image fence stays exactly as it is: the facade never offers images,
     and one smuggled in refuses by name because no remote picker can issue
     an allowlist entry. */
  const smuggled = await call(origin, { method: 'POST', path: '/v1/agent/send', token, body: { sessionId: 'web-1', text: 'look', images: [{ path: 'C:\\anything.png' }] } })
  assert.equal(smuggled.status, 400)
  assert.equal(smuggled.json.error.code, 'MC_AGENT_ATTACHMENT_UNKNOWN')
})

test('relay-owned sessions events reach the facade emit; window-owned do not; an absent sink drops with a count, never a throw', async (t) => {
  /* Wired: the surface routes relay-owned packets into the facade ring. */
  const deps = realDeps()
  let facadeRef = null
  deps.emitRelayEvent = (packet) => { facadeRef.emit(packet) }
  const surface = createAgentCommandSurface(deps)
  const writingRelay = Object.freeze({ kind: 'relay', owner: RELAY.owner, mayWrite: true, label: 'web (relay)' })
  const { facade, origin, token } = await listening(t, { surface, principal: writingRelay })
  facadeRef = facade

  await surface.run('agent:start', { sessionId: 'web-1' }, writingRelay)
  await surface.run('agent:start', { sessionId: 'desk-1' }, windowPrincipal)

  const relayPacket = { sessionId: 'web-1', event: { type: 'assistant_text_delta', text: 'hi' } }
  const windowPacket = { sessionId: 'desk-1', event: { type: 'assistant_text_delta', text: 'private' } }
  assert.equal(surface.forwardSessionEvent(relayPacket), true, 'a relay-owned packet is the surface s to route')
  assert.equal(surface.forwardSessionEvent(windowPacket), false, 'a window-owned packet stays with the window fan-out')
  assert.equal(surface.forwardSessionEvent({ sessionId: 'nobody', event: {} }), false)

  const read = await call(origin, { path: '/v1/agent/events?after=0', token })
  assert.deepEqual(read.json.events.map(e => e.packet), [relayPacket], 'exactly the relay-owned packet, verbatim, and never the window s')
  assert.equal(surface.relayEventDropCount(), 0)

  /* Absent sink: dropped, counted, logged -- and no throw reaches the host
     event loop. */
  const logged = []
  const bare = realDeps({ log: (line) => logged.push(line) })
  const bareSurface = createAgentCommandSurface(bare)
  await bareSurface.run('agent:start', { sessionId: 'web-9' }, writingRelay)
  for (let i = 0; i < 3; i += 1) {
    assert.equal(bareSurface.forwardSessionEvent({ sessionId: 'web-9', event: { n: i } }), true)
  }
  assert.equal(bareSurface.relayEventDropCount(), 3)
  assert.equal(logged.length, 1, 'the drop is logged as a count, not once per packet')
  assert.match(logged[0], /dropped so far: 1/)

  /* A sink that THROWS is also survived: dropped and counted. */
  const hostile = realDeps({ emitRelayEvent: () => { throw new Error('sink broke') } })
  const hostileSurface = createAgentCommandSurface(hostile)
  await hostileSurface.run('agent:start', { sessionId: 'web-x' }, writingRelay)
  assert.equal(hostileSurface.forwardSessionEvent({ sessionId: 'web-x', event: {} }), true)
  assert.equal(hostileSurface.relayEventDropCount(), 1)
})

/* ---------- lifecycle ---------- */

test('the facade never requires electron, binds loopback only, and close() takes the door off its hinges', async () => {
  const { readFileSync } = await import('node:fs')
  const source = readFileSync(new URL('../../shell/agent-facade.cjs', import.meta.url), 'utf8')
  /* Stronger than "no electron": every require in the facade is a node
     builtin, so nothing Electron-shaped (or anything else) can creep in. */
  const required = [...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1])
  assert.ok(required.length >= 2, 'the source scan stopped finding requires; fix the scan')
  for (const name of required) {
    assert.match(name, /^node:/, 'the facade requires a non-builtin: ' + name)
  }

  const facade = createAgentFacade({ surface: fakeSurface(), principalForRelay: () => RELAY, log: () => {} })
  assert.equal(facade.address(), null, 'an unlistened facade has no address')
  await facade.close()
  const { origin, token } = await facade.listen()
  assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/)
  assert.deepEqual(facade.address(), { origin })
  assert.equal((await call(origin, { path: '/v1/agent/profiles', token })).status, 200)
  await facade.close()
  assert.equal(facade.address(), null)
  /* Refused or reset -- Windows answers a freshly-closed port either way --
     but never served. */
  await assert.rejects(call(origin, { path: '/v1/agent/profiles', token }), /ECONNREFUSED|ECONNRESET/, 'a closed facade still answered')
})
