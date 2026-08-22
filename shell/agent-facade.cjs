/* THE AGENT FACADE -- the loopback HTTP door the relay child knocks on.
 *
 * docs/relay-agent-facade-DESIGN.md (§2) commits the shell to serving the
 * agent and organisation surface to ONE non-browser caller: the relay child,
 * which forwards a signed-in browser's commands off the sealed tunnel. This
 * module is that door and nothing more. Every command is decided by the
 * shared surface (shell/agent-command-surface.cjs) -- the same bodies, the
 * same bounds, the same refusals the window gets -- under a RELAY principal
 * whose mayWrite comes from the caller per request: the owner's web-drive
 * switch, set in the connect section of Settings on this machine and read
 * from shell/renderer-prefs.cjs per command. Its default is OFF, so until it
 * is turned on every write through this door is refused
 * MC_AGENT_PRINCIPAL_READ_ONLY. That is correct and expected, not a defect,
 * and there is no route through this door that can move the switch.
 *
 * SERVER RULES (design §2.3), each one load-bearing:
 *
 *   - Binds 127.0.0.1 only, port 0. No runtime file, no discovery route, no
 *     port range: the shell hands the exact origin and a per-listen() 32-byte
 *     bearer to the one legitimate caller at spawn time. A squatter cannot
 *     race onto a port nobody looks for.
 *   - Any request carrying an Origin header is refused 403
 *     AGENT_FACADE_NO_BROWSERS, BEFORE auth. No browser is ever a legitimate
 *     caller, so unlike the mission bridge there is no CORS surface at all.
 *   - Every route requires `authorization: Bearer <token>`, compared with
 *     crypto.timingSafeEqual on equal-length buffers; a length mismatch is a
 *     plain refusal, not a timing oracle. 401 AGENT_FACADE_UNAUTHORIZED.
 *   - JSON only. Request bodies are bounded at 64 KB; an oversize body is
 *     answered 413 AGENT_FACADE_BODY_TOO_LARGE and the socket is DESTROYED
 *     rather than drained -- the facade does not read bytes it has already
 *     refused. Unknown route 404 AGENT_FACADE_UNKNOWN_ROUTE (after auth, so
 *     an unauthenticated caller cannot probe the table); wrong verb 405.
 *   - THE CODE IS THE MESSAGE. Errors cross as status +
 *     {ok:false,error:{code}} -- the same renderer-safe discipline as
 *     rendererSafeAgentError in main.cjs: no path, no stack, no internal
 *     prose. A surface throw whose code (or whose message, which
 *     rendererSafeAgentError makes the code) is a bounded identifier becomes
 *     that identifier; anything else becomes AGENT_FACADE_INTERNAL and the
 *     real error goes to `log`, never to the wire.
 *   - Handlers that RETURN {ok:false,...} (the org record's refusals,
 *     availability, the degraded message reader) pass through as HTTP 200
 *     with the body verbatim -- exactly the IPC semantics (design §3
 *     preamble): resolve what the handler returned, refuse what it threw.
 *   - Responses are bounded at 96 KB serialized (design §6.4) -- well under
 *     the tunnel's 128 KB frame cap, so an honest `truncated:true` reaches
 *     the browser instead of a TUNNEL_RESPONSE_TOO_LARGE mystery.
 *
 * WHAT IS DELIBERATELY NOT ROUTED. The three dialog commands --
 * agent:pick-attachment, agent:pick-mention, agent:profile-create -- have no
 * route: a request to their would-be paths is a 404 exactly like any unknown
 * route, and behind that first lock the surface's own
 * MC_AGENT_DIALOG_REQUIRES_WINDOW is the second. The dialogs are consent
 * boundaries a person crosses AT the machine; remotely there is nobody in
 * front of the screen. `send` is routed but the facade's documented request
 * shape never offers `images` -- the image fence in the surface refuses any
 * path the session's own picker did not issue, and no remote picker exists.
 * Construction fails closed if the surface's command inventory and this
 * route table ever disagree (a command with no facade decision is a build
 * error, not a silent omission -- design §10's parity gate, live).
 *
 * THE EVENT RING (design §6.1). The facade object exposes emit(packet);
 * main.cjs routes relay-owned sessions' event packets here, verbatim
 * ({sessionId, event}), each stamped with a monotonically increasing seq.
 * The ring holds RING_SIZE = 2048 packets -- the design's own figure, chosen
 * against the streaming case: a busy turn emits token deltas continuously,
 * and at the binding's long-poll cadence the buffer must hold at least one
 * full poll window of the busiest plausible stream plus reconnect headroom;
 * 2048 packets of bounded engine events is a few MB worst case, held only
 * while the shell runs. GET /v1/agent/events?after=&sessionId=&waitMs=
 * answers {ok, seq, events:[{seq,packet}], dropped}; `dropped` is TRUE when
 * the caller's `after` has fallen off the ring (or names a seq this boot
 * never issued) -- honesty over silence: the binding resynchronizes instead
 * of splicing a gap it cannot see. waitMs long-polls, capped at 25 s.
 *
 * NEVER any electron import here -- node builtins only. The facade must be
 * constructible and testable outside the shell, and everything it may touch
 * arrives injected: the surface, the principal, the log. */
'use strict'

const http = require('node:http')
const crypto = require('node:crypto')

/* Request bodies: 64 KB, well under the tunnel's 128 KB frame cap. */
const MAX_BODY_BYTES = 64 * 1024
/* Serialized responses: 96 KB (design §6.4) -- the tunnel's cap is a hard
   refusal, not a truncation, so the facade clips honestly below it. */
const MAX_RESPONSE_BYTES = 96 * 1024
/* The event ring. See the header for why 2048. */
const RING_SIZE = 2048
/* Long-poll ceiling. The design (§6.1) sketched 20 s; the build contract for
   this module says 25 s, still safely under the web client's 60 s request
   default, and the ceiling is what matters -- the binding chooses its own
   cadence below it. */
const MAX_WAIT_MS = 25_000
const TOKEN_BYTES = 32

/* An error code as this product writes them: a bounded identifier from a
   closed vocabulary. Anything that does not match is internal prose and
   stays on this machine. */
const CODE_SHAPE = /^[A-Z][A-Z0-9_]{1,127}$/

/* The commands the design names REMOTE-OMITTED (§3 rows 12/13/15, §4.3):
   their whole meaning is a native dialog at this keyboard. They are absent
   from the route table below, and construction checks the three lists agree. */
const REMOTE_OMITTED = Object.freeze([
  'agent:pick-attachment',
  'agent:pick-mention',
  'agent:profile-create',
])

/* THE ROUTE TABLE (design §3 and §4). Route -> verb + surface command.
   `query` names the only query parameters a GET route accepts and how each
   is read ('int' | 'string'); anything else in the query string refuses
   AGENT_FACADE_BAD_QUERY -- the same refuse-unknown-keys doctrine
   agentPayload applies to bodies. `dropPathFields` marks the org reads whose
   IPC answer carries `overlayFile`, an absolute machine path that must never
   reach a browser on someone else's computer (design §0.4, §4.1): the facade
   drops it. `facade` marks the two routes this module answers itself. */
const ROUTES = Object.freeze({
  '/v1/agent/availability': Object.freeze({ method: 'GET', command: 'agent:availability' }),
  '/v1/agent/confinement': Object.freeze({ method: 'GET', command: 'agent:confinement' }),
  '/v1/agent/tools': Object.freeze({ method: 'GET', command: 'agent:tools' }),
  '/v1/agent/startable-tiers': Object.freeze({ method: 'GET', command: 'agent:startable-tiers' }),
  '/v1/agent/local-messages': Object.freeze({ method: 'GET', command: 'agent:local-messages', query: Object.freeze({ limit: 'int' }) }),
  '/v1/agent/history': Object.freeze({ method: 'GET', command: 'agent:history', query: Object.freeze({ limit: 'int' }) }),
  '/v1/agent/usage': Object.freeze({ method: 'GET', command: 'agent:usage', query: Object.freeze({ limit: 'int' }) }),
  '/v1/agent/start': Object.freeze({ method: 'POST', command: 'agent:start' }),
  '/v1/agent/send': Object.freeze({ method: 'POST', command: 'agent:send' }),
  '/v1/agent/request': Object.freeze({ method: 'POST', command: 'agent:request' }),
  '/v1/agent/requests': Object.freeze({ method: 'GET', command: 'agent:requests', query: Object.freeze({ scope: 'string', key: 'string' }) }),
  '/v1/agent/profiles': Object.freeze({ method: 'GET', command: 'agent:profiles' }),
  '/v1/agent/profile-remove': Object.freeze({ method: 'POST', command: 'agent:profile-remove' }),
  '/v1/agent/interrupt': Object.freeze({ method: 'POST', command: 'agent:interrupt' }),
  '/v1/agent/approval-answer': Object.freeze({ method: 'POST', command: 'agent:approval-answer' }),
  '/v1/agent/rewind': Object.freeze({ method: 'POST', command: 'agent:rewind' }),
  '/v1/agent/effort': Object.freeze({ method: 'POST', command: 'agent:effort' }),
  '/v1/agent/models': Object.freeze({ method: 'GET', command: 'agent:models', query: Object.freeze({ sessionId: 'string' }) }),
  '/v1/agent/close': Object.freeze({ method: 'POST', command: 'agent:close' }),
  '/v1/org': Object.freeze({ method: 'GET', command: 'org:read', dropPathFields: true }),
  '/v1/org/reparent': Object.freeze({ method: 'POST', command: 'org:reparent' }),
  '/v1/org/assign-role': Object.freeze({ method: 'POST', command: 'org:assign-role' }),
  '/v1/org/create-role': Object.freeze({ method: 'POST', command: 'org:create-role' }),
  '/v1/org/edit-role': Object.freeze({ method: 'POST', command: 'org:edit-role' }),
  '/v1/org/reset-role': Object.freeze({ method: 'POST', command: 'org:reset-role' }),
  '/v1/org/reset': Object.freeze({ method: 'POST', command: 'org:reset' }),
  '/v1/org/export': Object.freeze({ method: 'GET', command: 'org:export', dropPathFields: true }),
  '/v1/agent/remote-status': Object.freeze({ method: 'GET', facade: 'remote-status' }),
  '/v1/agent/events': Object.freeze({ method: 'GET', facade: 'events' }),
})

/* How a bounded code maps to an HTTP status. The status is advisory -- the
   browser binding re-throws the CODE on any non-2xx -- but an honest one
   helps every intermediate log. Codes not named here: MC_AGENT_* is a
   refused request (400), anything else is this machine failing to do it
   (500). */
const CODE_STATUS = Object.freeze({
  MC_AGENT_PRINCIPAL_READ_ONLY: 403,
  MC_AGENT_DIALOG_REQUIRES_WINDOW: 403,
  MC_AGENT_PRINCIPAL_INVALID: 403,
  MC_AGENT_SENDER_REFUSED: 403,
  MC_AGENT_UNKNOWN_COMMAND: 404,
  MC_AGENT_UNKNOWN_SESSION: 404,
  MC_AGENT_SESSION_EXISTS: 409,
  MC_AGENT_SESSION_LIMIT: 409,
  AGENT_TURN_ACTIVE: 409,
})

function boundedCode(value) {
  return typeof value === 'string' && CODE_SHAPE.test(value) ? value : null
}

function statusForCode(code) {
  if (Object.prototype.hasOwnProperty.call(CODE_STATUS, code)) return CODE_STATUS[code]
  return code.startsWith('MC_AGENT_') ? 400 : 500
}

function createAgentFacade({ surface, principalForRelay, log } = {}) {
  /* Fails closed at construction, like the surface it fronts: a facade that
     cannot decide every request correctly must not exist at all. */
  if (!surface || typeof surface.run !== 'function' || !Array.isArray(surface.commands)) {
    throw new Error('createAgentFacade needs the shared agent command surface')
  }
  if (typeof surface.sessionLoad !== 'function') {
    throw new Error('createAgentFacade: the surface must answer sessionLoad() for remote-status')
  }
  if (typeof principalForRelay !== 'function') {
    throw new Error('createAgentFacade needs principalForRelay()')
  }
  if (typeof log !== 'function') {
    throw new Error('createAgentFacade needs log(): an unbounded error must go somewhere that is not the wire')
  }

  /* THE PARITY GATE, live (design §10): every routed command must be one the
     surface holds, and every surface command must be routed or deliberately
     omitted. A command added to one side without a facade decision refuses
     construction instead of silently drifting. */
  const routedCommands = new Set()
  for (const [route, spec] of Object.entries(ROUTES)) {
    if (!spec.command) continue
    if (!surface.commands.includes(spec.command)) {
      throw new Error('createAgentFacade: route ' + route + ' names a command the surface does not hold: ' + spec.command)
    }
    if (routedCommands.has(spec.command)) {
      throw new Error('createAgentFacade: two routes serve ' + spec.command)
    }
    routedCommands.add(spec.command)
  }
  for (const command of surface.commands) {
    const routed = routedCommands.has(command)
    const omitted = REMOTE_OMITTED.includes(command)
    if (routed === omitted) {
      throw new Error('createAgentFacade: no facade decision for ' + command + ' (must be routed or REMOTE_OMITTED, never both, never neither)')
    }
  }

  /* ---------- the event ring ---------- */

  let eventSeq = 0
  /* The highest seq that has been pushed out of the ring; a cursor at or
     below it has lost events, and the answer says so. */
  let evictedThrough = 0
  const ring = []
  const waiters = new Set()

  function emit(packet) {
    eventSeq += 1
    ring.push({ seq: eventSeq, packet })
    if (ring.length > RING_SIZE) {
      evictedThrough = ring[0].seq
      ring.shift()
    }
    for (const waiter of [...waiters]) {
      if (waiter.sessionId && !(packet && packet.sessionId === waiter.sessionId)) continue
      waiter.finish()
    }
  }

  function collectEvents(after, sessionId) {
    /* dropped is about the GLOBAL stream: a cursor below what the ring still
       holds, or beyond anything this boot has issued (a cursor from another
       life). Either way the caller's next honest move is a resync, not a
       splice. */
    const dropped = after > eventSeq || after < evictedThrough
    const events = []
    let bytes = 0
    let truncated = false
    for (const item of ring) {
      if (item.seq <= after) continue
      if (sessionId && (!item.packet || item.packet.sessionId !== sessionId)) continue
      const size = Buffer.byteLength(JSON.stringify(item))
      /* The first matching event always rides, even oversized, so the cursor
         can never wedge on a single fat packet. */
      if (events.length > 0 && bytes + size > MAX_RESPONSE_BYTES - 256) {
        truncated = true
        break
      }
      events.push(item)
      bytes += size
    }
    const body = { ok: true, seq: eventSeq, events, dropped }
    if (truncated) {
      body.truncated = true
      body.next = events[events.length - 1].seq
    }
    return body
  }

  /* ---------- the server ---------- */

  let origin = null
  let token = null

  function answer(res, status, body, thenDestroy) {
    const text = JSON.stringify(body)
    if (res.headersSent || res.writableEnded) return
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(text),
    })
    if (thenDestroy) {
      const socket = res.socket
      res.end(text, () => { try { socket.destroy() } catch { /* already gone */ } })
    } else {
      res.end(text)
    }
  }

  function refuse(res, status, code, thenDestroy) {
    answer(res, status, { ok: false, error: { code } }, thenDestroy)
  }

  function authorized(req) {
    if (typeof token !== 'string') return false
    const header = req.headers.authorization
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false
    const presented = Buffer.from(header.slice('Bearer '.length), 'utf8')
    const expected = Buffer.from(token, 'utf8')
    /* A length mismatch is a plain refusal -- comparing unequal-length
       buffers is where naive implementations leak timing. */
    if (presented.length !== expected.length) return false
    return crypto.timingSafeEqual(presented, expected)
  }

  /* Read a POST body: JSON, bounded. Answers the request itself on refusal
     and resolves null; resolves the parsed object on success. */
  function readJsonBody(req, res) {
    return new Promise((resolve) => {
      const declared = Number(req.headers['content-length'])
      if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
        refuse(res, 413, 'AGENT_FACADE_BODY_TOO_LARGE', true)
        resolve(null)
        return
      }
      const chunks = []
      let received = 0
      let settled = false
      const done = (value) => {
        if (settled) return
        settled = true
        resolve(value)
      }
      req.on('data', (chunk) => {
        received += chunk.length
        if (received > MAX_BODY_BYTES) {
          refuse(res, 413, 'AGENT_FACADE_BODY_TOO_LARGE', true)
          done(null)
          return
        }
        chunks.push(chunk)
      })
      req.on('error', () => done(null))
      req.on('end', () => {
        if (settled) return
        const text = Buffer.concat(chunks).toString('utf8')
        if (text.length === 0) {
          done({})
          return
        }
        let parsed
        try {
          parsed = JSON.parse(text)
        } catch {
          refuse(res, 400, 'AGENT_FACADE_BAD_JSON')
          done(null)
          return
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          refuse(res, 400, 'AGENT_FACADE_BAD_JSON')
          done(null)
          return
        }
        done(parsed)
      })
    })
  }

  /* Build a GET route's payload from its declared query parameters; anything
     undeclared refuses. Returns null after answering on refusal. */
  function queryPayload(route, url, res) {
    const payload = {}
    for (const [key, value] of url.searchParams) {
      const kind = route.query ? route.query[key] : undefined
      if (!kind) {
        refuse(res, 400, 'AGENT_FACADE_BAD_QUERY')
        return null
      }
      if (kind === 'int') {
        if (!/^\d{1,9}$/.test(value)) {
          refuse(res, 400, 'AGENT_FACADE_BAD_QUERY')
          return null
        }
        payload[key] = Number(value)
      } else {
        if (value.length === 0 || value.length > 1024) {
          refuse(res, 400, 'AGENT_FACADE_BAD_QUERY')
          return null
        }
        payload[key] = value
      }
    }
    return payload
  }

  /* Bound a success body at MAX_RESPONSE_BYTES. List answers (`entries`
     arrays: history, usage) are clipped from the FRONT -- the ledgers answer
     oldest-first, so the newest survive -- and marked truncated:true. A body
     with no list to clip that still exceeds the bound is refused
     AGENT_FACADE_RESPONSE_TOO_LARGE: an honest refusal here beats a
     TUNNEL_RESPONSE_TOO_LARGE mystery two hops later (design §6.4). */
  function serializeBounded(route, body) {
    let out = body
    if (route.dropPathFields && out && typeof out === 'object' && !Array.isArray(out)
      && Object.prototype.hasOwnProperty.call(out, 'overlayFile')) {
      out = { ...out }
      delete out.overlayFile
    }
    let text = JSON.stringify(out)
    if (text === undefined) text = 'null'
    if (Buffer.byteLength(text) <= MAX_RESPONSE_BYTES) return { text }
    if (out && typeof out === 'object' && Array.isArray(out.entries)) {
      const entries = out.entries.slice()
      const clipped = { ...out, truncated: true }
      while (entries.length > 0) {
        entries.shift()
        clipped.entries = entries
        text = JSON.stringify(clipped)
        if (Buffer.byteLength(text) <= MAX_RESPONSE_BYTES) return { text }
      }
    }
    return { tooLarge: true }
  }

  async function dispatchCommand(route, payload, res) {
    let result
    try {
      result = await surface.run(route.command, payload, principalForRelay())
    } catch (error) {
      /* The code is the message. rendererSafeAgentError makes the message
         the code for everything the bodies throw; the surface's own gate
         refusals carry a bounded `code` beside a prose message. Either way
         only the identifier crosses; everything else goes to the log. */
      const code = boundedCode(error && error.code) || boundedCode(error && error.message)
      if (!code) {
        try { log(error) } catch { /* the log must never take the facade down */ }
        refuse(res, 500, 'AGENT_FACADE_INTERNAL')
        return
      }
      refuse(res, statusForCode(code), code)
      return
    }
    const bounded = serializeBounded(route, result)
    if (bounded.tooLarge) {
      try { log('a ' + route.command + ' answer exceeded the response bound and had no entries list to clip') } catch { /* see above */ }
      refuse(res, 500, 'AGENT_FACADE_RESPONSE_TOO_LARGE')
      return
    }
    if (res.headersSent || res.writableEnded) return
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(bounded.text),
    })
    res.end(bounded.text)
  }

  function handleRemoteStatus(res) {
    const load = surface.sessionLoad()
    answer(res, 200, {
      ok: true,
      facade: 'ready',
      sessionsOpen: load.open,
      maxSessions: load.max,
    })
  }

  function handleEvents(url, res) {
    let after = 0
    let waitMs = 0
    let sessionId = null
    for (const [key, value] of url.searchParams) {
      if (key === 'after') {
        if (!/^\d{1,15}$/.test(value)) return refuse(res, 400, 'AGENT_FACADE_BAD_QUERY')
        after = Number(value)
      } else if (key === 'waitMs') {
        if (!/^\d{1,9}$/.test(value)) return refuse(res, 400, 'AGENT_FACADE_BAD_QUERY')
        waitMs = Math.min(Number(value), MAX_WAIT_MS)
      } else if (key === 'sessionId') {
        if (value.length === 0 || value.length > 1024) return refuse(res, 400, 'AGENT_FACADE_BAD_QUERY')
        sessionId = value
      } else {
        return refuse(res, 400, 'AGENT_FACADE_BAD_QUERY')
      }
    }
    const immediate = collectEvents(after, sessionId)
    /* Answer NOW when there is something to say -- events, or the honest
       `dropped` that demands a resync -- or when the caller declined to
       wait. An empty answer still carries the current seq, so silence is
       distinguishable from disconnection. */
    if (immediate.events.length > 0 || immediate.dropped || waitMs === 0) {
      return answer(res, 200, immediate)
    }
    const waiter = {
      sessionId,
      timer: null,
      finish() {
        waiters.delete(waiter)
        clearTimeout(waiter.timer)
        try {
          answer(res, 200, collectEvents(after, sessionId))
        } catch { /* the client left; nothing to tell it */ }
      },
    }
    waiter.timer = setTimeout(waiter.finish, waitMs)
    waiters.add(waiter)
    res.on('close', () => {
      waiters.delete(waiter)
      clearTimeout(waiter.timer)
    })
  }

  async function handleRequest(req, res) {
    try {
      /* Origin FIRST, before auth: a browser is refused as a browser, never
         told whether its stolen token was right. */
      if ('origin' in req.headers) {
        refuse(res, 403, 'AGENT_FACADE_NO_BROWSERS')
        return
      }
      if (!authorized(req)) {
        refuse(res, 401, 'AGENT_FACADE_UNAUTHORIZED')
        return
      }
      let url
      try {
        url = new URL(req.url, 'http://facade.invalid')
      } catch {
        refuse(res, 404, 'AGENT_FACADE_UNKNOWN_ROUTE')
        return
      }
      const route = ROUTES[url.pathname]
      if (!route) {
        refuse(res, 404, 'AGENT_FACADE_UNKNOWN_ROUTE')
        return
      }
      if (req.method !== route.method) {
        res.setHeader('allow', route.method)
        refuse(res, 405, 'AGENT_FACADE_METHOD_NOT_ALLOWED')
        return
      }
      if (route.facade === 'remote-status') {
        if (url.search) return refuse(res, 400, 'AGENT_FACADE_BAD_QUERY')
        handleRemoteStatus(res)
        return
      }
      if (route.facade === 'events') {
        handleEvents(url, res)
        return
      }
      let payload
      if (route.method === 'GET') {
        payload = queryPayload(route, url, res)
        if (payload === null) return
      } else {
        if (url.search) return refuse(res, 400, 'AGENT_FACADE_BAD_QUERY')
        payload = await readJsonBody(req, res)
        if (payload === null) return
      }
      await dispatchCommand(route, payload, res)
    } catch (error) {
      /* The last fence: whatever happened, only a code crosses -- and a
         socket the client already tore down must not turn this fence into
         an unhandled rejection of its own. */
      try { log(error) } catch { /* nothing left to tell */ }
      try {
        if (!res.headersSent) {
          refuse(res, 500, 'AGENT_FACADE_INTERNAL')
        } else {
          res.destroy()
        }
      } catch { /* already gone */ }
    }
  }

  const server = http.createServer((req, res) => { void handleRequest(req, res) })

  function listen() {
    return new Promise((resolve, reject) => {
      if (server.listening) {
        /* A re-listen is the relay child being respawned: the origin holds,
           the bearer is re-minted so a dead child's copy stops working. */
        token = crypto.randomBytes(TOKEN_BYTES).toString('base64url')
        resolve({ origin, token })
        return
      }
      const onError = (error) => {
        server.removeListener('listening', onListening)
        reject(error)
      }
      const onListening = () => {
        server.removeListener('error', onError)
        origin = 'http://127.0.0.1:' + server.address().port
        token = crypto.randomBytes(TOKEN_BYTES).toString('base64url')
        resolve({ origin, token })
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(0, '127.0.0.1')
    })
  }

  function close() {
    /* Pending long-polls are answered, not abandoned: the tunnel gets an
       empty read instead of a hang it must time out. */
    for (const waiter of [...waiters]) waiter.finish()
    token = null
    const done = new Promise((resolve) => {
      if (!server.listening) {
        origin = null
        resolve()
        return
      }
      server.close(() => {
        origin = null
        resolve()
      })
      server.closeIdleConnections()
      /* Give the just-answered polls this tick to flush, then cut whatever
         still holds a socket so close() cannot hang on a lingering caller. */
      setImmediate(() => { try { server.closeAllConnections() } catch { /* already down */ } })
    })
    return done
  }

  function address() {
    return server.listening ? { origin } : null
  }

  return Object.freeze({ listen, close, address, emit })
}

module.exports = {
  createAgentFacade,
  ROUTES,
  REMOTE_OMITTED,
  MAX_BODY_BYTES,
  MAX_RESPONSE_BYTES,
  RING_SIZE,
  MAX_WAIT_MS,
}
