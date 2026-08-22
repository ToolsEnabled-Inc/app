'use strict'

/* CONNECTING THIS COMPUTER TO THE PERSON'S ACCOUNT, FROM INSIDE THE APP.
 *
 * WHY THIS FILE EXISTS. Every other piece of the ceremony was already built
 * and already shipped-shaped: the account service opens a claim, mints a code
 * and hands over the machine's credential (POST /v1/devices/claim-code, its
 * /status, and /claim for the person's browser); the website's account page
 * already has the TC-XXXX-XXXX box and the "Add this computer" button; the
 * engine has both the client (src/lib/online-fra-device-claim.js) and a CLI
 * written for exactly this caller (tools/online-fra-claim-cli.js, whose own
 * header says it exists so "the tray, the settings walkthrough and a bare
 * terminal" share ONE implementation). The shell had none of it.
 * relayMachineIsEnrolled() in shell/main.cjs returned a flat false with a TODO
 * naming this work, and because of that one false the relay leg -- shipped,
 * supervised, correct -- has never started on a customer's machine. This is
 * the missing seam, and it is deliberately thin: it starts the CLI and
 * translates its answer. It does not re-implement the claim, and it must not,
 * because a second implementation of a credential ceremony is a second thing
 * that can be subtly wrong.
 *
 * THE POLL TOKEN NEVER CROSSES TO THE RENDERER. openClaim() returns two things
 * a surface needs -- the code to show the person and how long it lives -- and
 * one thing only a machine needs: the poll token that collects the minted
 * credential. That token is bearer-shaped, so whoever holds it collects the
 * grant. begin() therefore keeps it HERE, in main-process memory, and poll()
 * takes no argument at all. A renderer cannot hand back a token it was never
 * given, which means a page that has been taken over cannot collect a claim it
 * did not open. The contract's shape is the guarantee: there is no field in
 * any reply this module produces that the token could travel in.
 *
 * EVERY REPLY IS BUILT FIELD BY FIELD, NEVER SPREAD. connectionState() in the
 * engine returns the device token, the client certificate and its private key
 * alongside the pair id; the CLI's `status` verb already declines to print
 * them, and this module declines a second time by naming the four fields it
 * copies. Two independent refusals, so a future CLI that starts printing more
 * cannot turn a renderer reply into a credential disclosure.
 *
 * REFUSALS ARE OUR SENTENCES, NOT THE CHILD'S. The engine's messages name the
 * vault key, quote fetch's error text, and can carry a hostname or a path.
 * None of it is forwarded. A refusal is a code from CODES below plus a
 * sentence written here, so nothing a child prints can reach a window even if
 * a future child forgets its manners. That is the discipline
 * shell/relay-supervisor.cjs already applies to its own `lastReason`.
 *
 * THE ENVIRONMENT IS THE RELAY LEG'S ALLOWLIST, BY REFERENCE. This child reads
 * the same DPAPI vault through the same PowerShell as the relay leg and talks
 * to the same account service, so it needs exactly what that child needs.
 * relayChildEnvironment() is imported rather than copied: two allowlists that
 * must agree are two allowlists that will eventually differ, and the one that
 * drifts wider is the one nobody looks at. The facade credentials are simply
 * not passed -- a claim is not an agent call and has no business holding the
 * per-boot bearer.
 *
 * THE CHILD IS BOUNDED. A claim CLI that never exits -- a socket that hangs, a
 * PowerShell waiting on something -- must not wedge the shell behind an IPC
 * reply that never comes. Every invocation has a deadline; past it the child
 * is signalled, escalated, and the caller gets DEVICE_CLAIM_TIMEOUT.
 *
 * NOTHING HERE REQUIRES ELECTRON. The spawn, the payload root, the clock and
 * the timers are injected, which is what lets tools/test/device-claim.test.mjs
 * drive hung children, malformed output and a hostile parent environment with
 * no real child and no real sleep.
 */

const fs = require('node:fs')
const path = require('node:path')

/* One definition of the child environment, shared with the relay leg. See the
   header: this is a reuse, not a convenience. */
const { relayChildEnvironment } = require('./relay-supervisor.cjs')

/* WHERE THE CLAIM CLI IS INSIDE THE PAYLOAD. Declared in
   tools/capability-manifest.json as a `spawnedPrograms` root, which is what
   makes the packer walk its require() graph and stage it. A payload packed
   before that declaration does not contain this file, and this module says so
   (DEVICE_CLAIM_CLI_ABSENT) rather than spawning a path that is not there. */
const CLAIM_ENTRY = path.join('tools', 'online-fra-claim-cli.js')

/* THE CLOSED SET OF REFUSAL CODES. A renderer branches on these, so they are a
   contract: bounded, stable, and free of anything derived from a message. The
   test asserts that every refusal this module can produce is a member. */
const CODES = Object.freeze({
  /* The shell could not even ask. */
  PAYLOAD_ABSENT: 'DEVICE_CLAIM_PAYLOAD_ABSENT',
  CLI_ABSENT: 'DEVICE_CLAIM_CLI_ABSENT',
  STATE_ROOT_UNKNOWN: 'DEVICE_CLAIM_STATE_ROOT_UNKNOWN',
  SPAWN_FAILED: 'DEVICE_CLAIM_SPAWN_FAILED',
  TIMEOUT: 'DEVICE_CLAIM_TIMEOUT',
  BUSY: 'DEVICE_CLAIM_BUSY',
  UNREADABLE: 'DEVICE_CLAIM_UNREADABLE',
  OUTPUT_TOO_LARGE: 'DEVICE_CLAIM_OUTPUT_TOO_LARGE',
  NAME_INVALID: 'DEVICE_CLAIM_NAME_INVALID',
  /* The service, or the engine, answered and the answer was a no. */
  GONE: 'DEVICE_CLAIM_GONE',
  ALREADY_CONNECTED: 'DEVICE_CLAIM_ALREADY_CONNECTED',
  UNREACHABLE: 'DEVICE_CLAIM_UNREACHABLE',
  CREDENTIAL_INVALID: 'DEVICE_CLAIM_CREDENTIAL_INVALID',
  REFUSED: 'DEVICE_CLAIM_REFUSED',
  /* FOUR REFUSALS THAT ARE NOT THE SAME REFUSAL. They all used to arrive as
     REFUSED -- "The account service refused the request." -- which tells a
     person nothing they can act on. Each of these has a different next step,
     and three of the four are not the person's fault at all. */
  TOO_MANY_TRIES: 'DEVICE_CLAIM_TOO_MANY_TRIES',
  SERVICE_BUSY: 'DEVICE_CLAIM_SERVICE_BUSY',
  REGION_REFUSED: 'DEVICE_CLAIM_REGION_REFUSED',
  NOT_OFFERED: 'DEVICE_CLAIM_NOT_OFFERED',
})
const CODE_VALUES = Object.freeze(Object.values(CODES))

/* THE SENTENCES, written here, one per code. A refusal a person can read is
   the whole point of a bounded code set; a code with no sentence would push
   the wording into a renderer, where three surfaces would each invent their
   own. Nothing in this table interpolates anything. */
const REASONS = Object.freeze({
  [CODES.PAYLOAD_ABSENT]: 'This installation cannot find its own program files, so it cannot connect this computer to an account.',
  [CODES.CLI_ABSENT]: 'This build does not include the program that connects a computer to an account. Updating the app is what fixes it.',
  [CODES.STATE_ROOT_UNKNOWN]: 'This installation does not know where it keeps its own data, so it will not try to connect.',
  [CODES.SPAWN_FAILED]: 'The program that connects this computer to an account could not be started.',
  [CODES.TIMEOUT]: 'The connection step took too long and was stopped. Nothing was changed.',
  [CODES.BUSY]: 'This computer is already in the middle of a connection step. Wait for that one to finish.',
  [CODES.UNREADABLE]: 'The connection step finished but did not answer in a way this app understands.',
  [CODES.OUTPUT_TOO_LARGE]: 'The connection step produced far more output than an answer, so it was stopped.',
  [CODES.NAME_INVALID]: 'That is not a name this computer can be listed under. Use up to 64 ordinary characters.',
  [CODES.GONE]: 'That code is no longer open. It expired, or it was already used. Start again to get a new one.',
  [CODES.ALREADY_CONNECTED]: 'This computer is already connected to an account. Remove it on the account page first.',
  [CODES.UNREACHABLE]: 'The account service did not answer. Check this computer’s internet connection and try again.',
  [CODES.CREDENTIAL_INVALID]: 'What this computer holds for its account is not readable. Connect this computer again.',
  [CODES.REFUSED]: 'The account service refused the request.',
  [CODES.TOO_MANY_TRIES]: 'This computer has asked to connect too many times in a row. Wait about ten minutes and try again — nothing is wrong with your account.',
  [CODES.SERVICE_BUSY]: 'The account service is busy and could not start a connection just now. Try again in a few minutes; this is us, not you.',
  [CODES.REGION_REFUSED]: 'ToolsEnabled cannot connect a computer from this country yet. Nothing is wrong with your account.',
  [CODES.NOT_OFFERED]: 'This account service is not set up to connect computers by code. If you are pointing the app somewhere other than toolsenabled.ai, that is why.',
})

/* THE ENGINE ERROR CODES THIS MODULE PASSES THROUGH BY NAME. Anything the
   child names that is not on this map becomes REFUSED: an unbounded code set
   is a renderer branching on a string it has never seen, and a code invented
   by a dependency is exactly how a message leaks through a field everybody
   believed was an enum. */
const CHILD_CODE_MAP = Object.freeze({
  DEVICE_CLAIM_GONE: CODES.GONE,
  DEVICE_CLAIM_ALREADY_CONNECTED: CODES.ALREADY_CONNECTED,
  DEVICE_CLAIM_UNREACHABLE: CODES.UNREACHABLE,
  DEVICE_CLAIM_CREDENTIAL_INVALID: CODES.CREDENTIAL_INVALID,
  DEVICE_CLAIM_CONFIG_INVALID: CODES.REFUSED,
  DEVICE_CLAIM_REFUSED: CODES.REFUSED,
  CLI_USAGE: CODES.REFUSED,
  CLI_FAILED: CODES.REFUSED,
  /* THE ACCOUNT SERVICE'S OWN CODES, WHICH REACH THIS TABLE UNCHANGED.
     online-fra-device-claim.js forwards `body.error.code` verbatim when a claim
     is refused, so what arrives here is the service's word, not the engine's.
     None of these five were in this table, so all five became REFUSED and the
     person was told "the account service refused the request" whether they had
     tried too often, whether the service was overloaded, or whether we cannot
     serve their country at all -- three different answers with three different
     next steps, and only one of them anything they did.
     The CODE is what is mapped; the service's SENTENCE is still thrown away, as
     translateChildError says and means. Text from a remote service must not
     render in this window, and these sentences are ours. */
  RATE_LIMITED: CODES.TOO_MANY_TRIES,
  CLAIM_CAPACITY: CODES.SERVICE_BUSY,
  REGION_REFUSED: CODES.REGION_REFUSED,
  NO_DEVICE_CLAIMS: CODES.NOT_OFFERED,
  CLAIM_UNKNOWN: CODES.GONE,
})

/* HOW LONG EACH VERB MAY TAKE. `status` is a vault read: the engine's runtime
   spawns PowerShell for it, measured at just under a second on the owner's
   machine, and fifteen seconds is the same ceiling shell/vault-presence.cjs
   puts on the same kind of question. `open` and `poll` each make one HTTP call
   whose own client aborts at fifteen seconds, so the shell's deadline has to
   be longer than the child's -- otherwise the shell always wins the race and
   reports a timeout for what the service actually called a refusal. */
const STATUS_TIMEOUT_MS = 15_000
const NETWORK_TIMEOUT_MS = 30_000

/* How long a signalled child gets before it is killed outright. The same five
   seconds the relay supervisor's stop() allows, for the same reason: a
   deadline that itself has no deadline is not a deadline. */
const KILL_ESCALATION_MS = 5_000

/* A ceiling on what is read from the child's stdout. The contract is one JSON
   object; anything approaching this is a child that has lost its manners, and
   reading it to the end would let a broken program grow the shell's heap. */
const MAX_STDOUT_BYTES = 64 * 1024

/* What a computer may be called on the account page. Bounded because it
   becomes an argv value and a row in someone's device list. Control characters
   are refused rather than stripped, so a person sees that their name was not
   accepted instead of silently getting a different one. A leading double dash
   is refused because the CLI reads its arguments by flag name, and a "name"
   that looks like a flag is a question about intent rather than a name. */
const MAX_NAME_LENGTH = 64
const NAME_REFUSED_RE = /[\u0000-\u001f\u007f]/

function refusal(code) {
  return Object.freeze({ ok: false, code, reason: REASONS[code] || REASONS[CODES.REFUSED] })
}

function requireFunction(value, name) {
  if (typeof value !== 'function') {
    throw new TypeError(`createDeviceClaim requires ${name}`)
  }
  return value
}

function validName(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_NAME_LENGTH) return null
  if (NAME_REFUSED_RE.test(trimmed)) return null
  if (trimmed.startsWith('--')) return null
  return trimmed
}

/* THE ONE OBJECT ON STDOUT, FOUND WITHOUT TRUSTING THE STREAM'S SHAPE. The CLI
   writes exactly one line and everything human goes to stderr, so in practice
   the first line is the answer. The LAST parseable line is taken anyway,
   because the failure worth guarding against is a dependency that logs BEFORE
   the answer -- a module printing after a verb returned would be a child that
   answered twice, which the CLI's control flow cannot do. */
function parseChildAnswer(text) {
  const lines = String(text || '').split(/\r?\n/)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim()
    if (!line) continue
    let parsed
    try { parsed = JSON.parse(line) } catch { continue }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  }
  return null
}

/* The child's own refusal, translated. `message` is read only to be thrown
   away: the code decides everything and the sentence comes from our table. */
function translateChildError(answer) {
  const raw = answer && answer.error && typeof answer.error.code === 'string' ? answer.error.code : null
  const code = (raw && CHILD_CODE_MAP[raw]) || CODES.REFUSED
  return refusal(code)
}

/**
 * The shell's half of the device claim.
 *
 * @param {object} deps
 * @param {Function} deps.spawn               child_process.spawn, or a stand-in
 * @param {Function} deps.resolvePayloadRoot  answers the staged payload's root, or null
 * @param {Function} [deps.log]               one line of identifier-free progress
 * @param {Function} [deps.now]               the clock, injected so expiry is testable
 * @param {string}   [deps.stateRoot]         stated rather than inherited
 * @param {string}   [deps.accountOrigin]     a non-production account service, when there is
 *                                            one. Deliberately NOT on the shared allowlist --
 *                                            see relay-supervisor.cjs.
 */
function createDeviceClaim({
  spawn,
  resolvePayloadRoot,
  log = () => {},
  now = Date.now,
  execPath = process.execPath,
  env = process.env,
  exists = fs.existsSync,
  stateRoot = undefined,
  accountOrigin = '',
  statusTimeoutMs = STATUS_TIMEOUT_MS,
  networkTimeoutMs = NETWORK_TIMEOUT_MS,
  setTimeout: schedule = setTimeout,
  clearTimeout: cancelTimer = clearTimeout,
} = {}) {
  requireFunction(spawn, 'spawn')
  requireFunction(resolvePayloadRoot, 'resolvePayloadRoot')

  /* Stated by the caller, or the value this process was started with. A
     relative one is refused rather than resolved against a working directory
     nobody chose -- the same rule the relay supervisor applies, and for the
     same reason: two half-populated state roots is how a credential lands
     somewhere the relay leg will never look. */
  const resolvedStateRoot = typeof stateRoot === 'string' && stateRoot
    ? stateRoot
    : (env && typeof env.TOOLSENABLED_STATE_ROOT === 'string' ? env.TOOLSENABLED_STATE_ROOT : '')

  /* THE POLL TOKEN'S ONLY HOME. Held by begin(), read by poll(), cleared by
     cancel() and by any answer that ends the claim. It is never returned,
     never logged and never put in a reply -- see the header. */
  let pending = null

  /* One child at a time. Two claim CLIs racing on one vault is a question
     nobody needs answered, and a renderer firing poll() on a timer while a
     begin() is still in flight would produce exactly that. The refusal is
     named, so the surface can simply wait. */
  let inFlight = false

  /* WHAT THE VAULT LAST SAID, so relayMachineIsEnrolled() can answer without
     awaiting a spawn. It starts false: a shell that has not yet asked has not
     been told this machine is connected, and starting a relay leg on that
     basis would be a guess dressed as a fact.

     A REFUSAL DOES NOT MOVE IT. "I could not read the vault" is not evidence
     that the credential is gone -- that is shell/vault-presence.cjs's rule and
     it holds here for the same reason: an unreadable vault must not look like
     a machine somebody disconnected. Only an answer moves this. */
  let lastKnownConnected = false

  function payloadEntry() {
    const root = resolvePayloadRoot()
    if (typeof root !== 'string' || !root) return { ok: false, code: CODES.PAYLOAD_ABSENT }
    const entry = path.join(root, CLAIM_ENTRY)
    let present = false
    try { present = exists(entry) } catch { present = false }
    if (!present) return { ok: false, code: CODES.CLI_ABSENT }
    if (!resolvedStateRoot || !path.isAbsolute(resolvedStateRoot)) {
      return { ok: false, code: CODES.STATE_ROOT_UNKNOWN }
    }
    return { ok: true, entry }
  }

  function childEnvironment() {
    const environment = relayChildEnvironment(env, { stateRoot: resolvedStateRoot })
    /* Set explicitly rather than inherited. The shared allowlist deliberately
       does not carry this name, so a developer's ambient value cannot point a
       customer's claim at a service nobody chose. */
    if (typeof accountOrigin === 'string' && accountOrigin) {
      environment.TOOLSENABLED_ACCOUNT_ORIGIN = accountOrigin
    }
    return environment
  }

  /* Run one verb and answer with its one JSON object, or with a named refusal.
     Resolves; never rejects. Every caller below is behind an IPC handler, and
     an IPC handler that throws hands the renderer an Error carrying whatever
     text happened to be in it. */
  function runVerb(args, timeoutMs) {
    if (inFlight) return Promise.resolve(refusal(CODES.BUSY))
    const resolved = payloadEntry()
    if (!resolved.ok) return Promise.resolve(refusal(resolved.code))

    let child
    try {
      child = spawn(execPath, [resolved.entry, ...args], {
        env: childEnvironment(),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch {
      /* The error's message is not kept: it names a path. */
      return Promise.resolve(refusal(CODES.SPAWN_FAILED))
    }

    inFlight = true
    return new Promise((resolve) => {
      let settled = false
      let stdout = ''
      let bytes = 0
      let overflowed = false
      let spawnFailed = false
      let escalation = null

      /* THE ESCALATION IS NOT CANCELLED HERE, and that is the whole point of
         it. The caller is answered the moment the deadline passes -- an IPC
         reply must not wait on a process that is ignoring signals -- so
         settling and killing are separate lifetimes. Clearing the escalation
         from finish() reads tidier and means the SIGKILL never fires, which is
         exactly the orphan this bounds. It is cleared by the child's own exit
         below, which is the only event that makes it pointless. */
      const finish = (value) => {
        if (settled) return
        settled = true
        inFlight = false
        cancelTimer(deadline)
        resolve(value)
      }

      const clearEscalation = () => {
        if (escalation === null) return
        cancelTimer(escalation)
        escalation = null
      }

      /* Signalled first, killed if it ignores that. A child left behind by a
         deadline is the orphan the acceptance harness caught once already. */
      const stop = () => {
        try { child.kill() } catch { /* the escalation still runs */ }
        escalation = schedule(() => {
          escalation = null
          try { child.kill('SIGKILL') } catch { /* nothing further to try */ }
        }, KILL_ESCALATION_MS)
      }

      const deadline = schedule(() => {
        log('the connect step passed its deadline and was stopped')
        stop()
        finish(refusal(CODES.TIMEOUT))
      }, timeoutMs)

      if (child.stdout && typeof child.stdout.on === 'function') {
        child.stdout.on('data', (chunk) => {
          if (overflowed || settled) return
          const text = typeof chunk === 'string' ? chunk : String(chunk)
          bytes += Buffer.byteLength(text)
          if (bytes > MAX_STDOUT_BYTES) {
            overflowed = true
            stop()
            finish(refusal(CODES.OUTPUT_TOO_LARGE))
            return
          }
          stdout += text
        })
      }
      /* Drained and dropped. The CLI's prose lives on this stream and prose is
         not data; it is read only so a child cannot block on a full pipe. */
      if (child.stderr && typeof child.stderr.on === 'function') child.stderr.on('data', () => {})

      if (typeof child.on === 'function') {
        child.on('error', () => {
          /* An asynchronous spawn failure. Named as a spawn failure rather than
             as whatever exit code a process that never ran did not produce. */
          spawnFailed = true
          finish(refusal(CODES.SPAWN_FAILED))
        })
        child.on('exit', () => {
          /* It is gone, so there is nothing left to kill. */
          clearEscalation()
          if (spawnFailed) return
          const answer = parseChildAnswer(stdout)
          if (!answer) {
            finish(refusal(CODES.UNREADABLE))
            return
          }
          if (answer.error) {
            finish(translateChildError(answer))
            return
          }
          finish({ ok: true, answer })
        })
      }
    })
  }

  /* The four fields a surface may know about a connected machine, copied by
     name. The engine's credential record also holds a device token, a client
     certificate and its private key; none of them has a line here. */
  function connectedReply(answer) {
    return Object.freeze({
      ok: true,
      connected: true,
      name: typeof answer.name === 'string' ? answer.name : '',
      deviceId: typeof answer.deviceId === 'string' ? answer.deviceId : '',
      pairId: typeof answer.pairId === 'string' ? answer.pairId : '',
      claimedAtMs: Number.isFinite(answer.claimedAtMs) ? answer.claimedAtMs : null,
    })
  }

  /* THE ONE STATUS READ EVERY ASKER SHARES.
   *
   * THE DEFECT THIS CLOSES, and it is the worst thing the connect screen did.
   * `runVerb` allows one child at a time and refuses the second with
   * DEVICE_CLAIM_BUSY -- correct for anything that WRITES. But status is a
   * read, its own comment two lines down says it is "safe to call at any
   * cadence from any surface", and two callers ask it during the same two
   * seconds of every launch: shell/main.cjs awaits one before deciding whether
   * to start the relay leg, and the renderer fires one the moment the connect
   * section mounts. Whichever lost the race was told "This computer is already
   * in the middle of a connection step. Wait for that one to finish." -- drawn
   * as a red alert on a sterile profile, about a step nobody had started, on
   * the most important screen in the product. Three scouts reproduced it
   * independently, roughly eight opens in fourteen.
   *
   * A SECOND ASKER NOW JOINS THE ANSWER instead of being refused. Nothing is
   * cached beyond the flight: the moment the spawn settles the slot is empty
   * again, so this is strictly "do not ask the same question twice at once"
   * and never "remember what the vault said". A stale answer here would be the
   * defect wearing the opposite face. */
  let statusInFlight = null

  return {
    /* Is this computer connected to an account? A read: it starts nothing on
       the account side, and it is safe to call at any cadence from any
       surface. */
    status() {
      if (statusInFlight) return statusInFlight
      statusInFlight = (async () => {
        const result = await runVerb(['status'], statusTimeoutMs)
        if (!result.ok) return result
        const connected = result.answer.connected === true
        lastKnownConnected = connected
        if (!connected) return Object.freeze({ ok: true, connected: false })
        return connectedReply(result.answer)
      })()
      /* Cleared on settle, not by the awaiter, so a caller that walks away
         mid-flight cannot leave the slot held by a promise nobody is reading. */
      const clear = () => { statusInFlight = null }
      statusInFlight.then(clear, clear)
      return statusInFlight
    },

    /* Open a claim and return the code the person types on the account page.
       The poll token that arrives in the same object from the CLI stops
       here. */
    async begin(request) {
      const name = validName(request && request.name)
      if (!name) return refusal(CODES.NAME_INVALID)
      const result = await runVerb(['open', '--name', name], networkTimeoutMs)
      if (!result.ok) return result
      const answer = result.answer
      if (typeof answer.code !== 'string' || typeof answer.pollToken !== 'string') {
        /* A claim without a code is nothing to show, and a claim without a
           token is nothing to collect. Either way there is no claim in flight,
           so nothing is remembered. */
        return refusal(CODES.UNREADABLE)
      }
      pending = {
        pollToken: answer.pollToken,
        expiresAtMs: Number.isFinite(answer.expiresAtMs) ? answer.expiresAtMs : null,
      }
      log('a claim is open; this computer is waiting for the account page')
      return Object.freeze({
        ok: true,
        code: answer.code,
        expiresAtMs: pending.expiresAtMs,
        intervalSeconds: Number.isFinite(answer.intervalSeconds) ? answer.intervalSeconds : 5,
      })
    },

    /* One question, asked with the token this process is holding. `none` means
       nothing is in flight -- a distinct answer from `pending`, because a
       surface that cannot tell them apart shows a spinner forever. */
    async poll() {
      if (!pending) return Object.freeze({ ok: true, state: 'none' })
      /* An expired claim is answered without asking anybody. The service would
         say the same thing (404 -> DEVICE_CLAIM_GONE) and this saves a spawn,
         but the reason it is here is that the token is dead either way, and a
         dead token must not outlive the claim it belonged to. */
      if (pending.expiresAtMs !== null && now() > pending.expiresAtMs) {
        pending = null
        return refusal(CODES.GONE)
      }
      const result = await runVerb(['poll', '--token', pending.pollToken], networkTimeoutMs)
      if (!result.ok) {
        /* A claim the service says is gone can never be collected, so the token
           is dropped here rather than left for a surface to retry with. Every
           other refusal -- unreachable, busy, a timeout -- leaves the claim in
           flight, because the person's code is still on their screen and still
           good. */
        if (result.code === CODES.GONE) pending = null
        return result
      }
      const answer = result.answer
      if (answer.state === 'connected') {
        pending = null
        lastKnownConnected = true
        log('this computer is connected to an account')
        return Object.freeze({
          ok: true,
          state: 'connected',
          /* The CLI reports the grant flat; the contract both halves of this
             seam were built against nests it. Mapped by name, which is also
             what keeps a future extra field out of the renderer. */
          device: Object.freeze({
            name: typeof answer.name === 'string' ? answer.name : '',
            deviceId: typeof answer.deviceId === 'string' ? answer.deviceId : '',
            pairId: typeof answer.pairId === 'string' ? answer.pairId : '',
          }),
        })
      }
      if (answer.state === 'pending') {
        return Object.freeze({
          ok: true,
          state: 'pending',
          intervalSeconds: Number.isFinite(answer.intervalSeconds) ? answer.intervalSeconds : 5,
        })
      }
      /* `wait`'s timeout state, or anything a future CLI invents. Not guessed
         at: an unrecognised state is an answer this shell cannot act on. */
      return refusal(CODES.UNREADABLE)
    },

    /* The person changed their mind. Nothing is told to the service -- there is
       no cancel endpoint and the claim expires on its own -- but the token
       stops existing here, which is the half that matters: this computer will
       not collect a credential nobody is waiting for. */
    cancel() {
      /* WHETHER THERE WAS ANYTHING TO GIVE UP IS REPORTED, because the surface
         cannot see this variable and the difference matters to a person. Every
         "Get a code" is routed through cancel-then-begin now (a second press
         used to open a second live claim and orphan the first token), so most
         of these find nothing and must stay silent; the one that DID drop a
         live claim owes the person a sentence, because the code it dropped may
         already be typed into their browser. */
      const dropped = pending !== null
      pending = null
      return Object.freeze({ ok: true, dropped })
    },

    /* WHAT relayMachineIsEnrolled() ASKS. Synchronous on purpose: the relay
       supervisor's start() takes a predicate, not a promise, and a predicate
       that spawned PowerShell would make every start() a process launch. This
       is the cached answer of the last status() or poll() that actually got
       one. See lastKnownConnected. */
    enrolled() {
      return lastKnownConnected === true
    },

    /* Is a claim in flight? A boolean, so nothing about the token itself has to
       be exposed to answer it. */
    claimOpen() {
      return pending !== null
    },
  }
}

module.exports = {
  CLAIM_ENTRY,
  CODES,
  CODE_VALUES,
  KILL_ESCALATION_MS,
  MAX_NAME_LENGTH,
  MAX_STDOUT_BYTES,
  NETWORK_TIMEOUT_MS,
  REASONS,
  STATUS_TIMEOUT_MS,
  createDeviceClaim,
}
