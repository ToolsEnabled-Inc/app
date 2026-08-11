'use strict'

// This module intentionally has no Electron dependency. It owns Codex session
// lifecycles; shell/main.cjs is only the IPC boundary around it.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
// capability-layer.cjs is itself Electron-free (node:child_process, node:fs,
// node:path only), so requiring it here preserves the property above.
const { resolveCapabilityRoot } = require('./capability-layer.cjs')

const CLIENT_INFO = Object.freeze({
  name: 'mission-control',
  title: 'Mission Control',
  version: '1.0.0',
})

class AgentHostError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'AgentHostError'
    this.code = code
  }
}

function fail(code, message) {
  throw new AgentHostError(code, message)
}

function boundedString(value, label, max, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0) || value.length > max) {
    fail('AGENT_HOST_INVALID_ARGUMENT', `${label} must be ${allowEmpty ? 'a' : 'a non-empty'} string of at most ${max} characters`)
  }
  return value
}

function normalizedModulePath(candidate) {
  const resolved = path.resolve(candidate)
  return path.extname(resolved).toLowerCase() === '.js'
    ? resolved
    : path.join(resolved, 'codex-process.js')
}

// The engine module the payload carries, declared in
// tools/capability-manifest.json under `hostModules`. The path is duplicated
// here because the manifest is a BUILD input and this is a RUNTIME read; the
// same unavoidable duplication shell/setup-record.cjs documents for the setup
// modules. tools/check-asar-manifest.mjs gates every hostModules entry against
// the built payload, so a build that lists this file without shipping it fails
// rather than reaching a customer.
const PAYLOAD_ENGINE_MODULE = 'src/lib/agent-engine/codex-process.js'

/* The module that turns the RECORDED permission level into the confinement a
 * session actually runs under. Declared in tools/capability-manifest.json under
 * `hostModules` beside the engine, and resolved from the SAME root the engine
 * resolved from -- a session confined by one installation's answer while running
 * another installation's engine would be two products pretending to be one.
 *
 * THE GAP THIS CLOSES. Mission Control's first-run screen asks how much the
 * assistant may do and records the answer. This module used to start every
 * session with `threadOptions: {}` and no environment, so Codex fell back to the
 * user's own ~/.codex/config.toml -- measured on the build machine as
 * `sandbox_mode = "danger-full-access"`, `approval_policy = "never"`. A `guided`
 * install therefore started an agent with unrestricted write access to the whole
 * computer. The product made a safety promise at the point of choice and did not
 * keep it for its own agent. */
const PAYLOAD_CONFINEMENT_MODULE = 'src/lib/agent-session-confinement.js'

/* The module that decides WHOSE MONEY and WHICH ENDPOINT an agent session uses.
 * Declared in tools/capability-manifest.json under `hostModules` beside the
 * other two, and resolved from the SAME engine root, for the same reason.
 *
 * THE GAP THIS CLOSES. Until now this host handed the agent child the user's
 * ENTIRE environment, by both of its branches. At `unrestricted` no `env` key
 * was passed at all, and codex-process.js falls back to `process.env` when
 * `env` is undefined; at every confined level `{ ...process.env, ...plan.env }`
 * was the whole parent environment plus CODEX_HOME. Neither branch removed
 * anything. Measured on the build machine: ANTHROPIC_API_KEY is set AND
 * persisted in HKCU:\Environment, so it is inherited by every process the owner
 * starts -- including this one, including the agent, including anything the
 * agent spawns.
 *
 * TWO DISTINCT HARMS, and they are not the same harm.
 *
 *   1. BILLING. The agent session can spawn a Claude CLI, and Claude Code gives
 *      ANTHROPIC_API_KEY PRECEDENCE over the owner's Max subscription login.
 *      That is not a hypothesis: subscription-launch-env.js records the outage
 *      it came from -- the R1186 sweeps "billed a drained API account for hours
 *      while reporting logged in", under a perfect green `claude auth status`.
 *
 *   2. REDIRECTION. OPENAI_BASE_URL / ANTHROPIC_BASE_URL send the session's
 *      prompts and the file contents they carry to an arbitrary host. The
 *      session still starts, still answers, and is indistinguishable from a
 *      correct one, so there is no failure for anyone to notice.
 *
 * WHY THE PAYLOAD'S MODULE AND NOT A LIST WRITTEN HERE. A second list is how
 * vocabularies drift, and drifting silently is the entire failure mode above --
 * centralising it is the stated reason subscription-launch-env.js exists. It
 * also carries the insight this host needs and a per-provider scrub does not:
 * providerEnvironment(id) strips only the NAMED provider's own credentials, so
 * a Codex launcher that scrubs "its" provider still hands ANTHROPIC_API_KEY to
 * a child. Launching is not a per-provider act. A launch takes the UNION across
 * every provider, and that union is what safeLaunchEnvironment() returns. */
const PAYLOAD_LAUNCH_ENVIRONMENT_MODULE = 'src/lib/providers/subscription-launch-env.js'

function engineCandidates(enginePath, { capabilityRoot = resolveCapabilityRoot() } = {}) {
  // An explicit path is useful to embedders and focused tests.
  //
  // BLOCKER 2 (R1162 non-author review): this used to fall back to a
  // hardcoded path into a private sibling checkout one level above this repo
  // -- unreachable from build.files (`dist/**`, `shell/**`), so it existed on
  // no shipped installation. The chat feature that depended on it was
  // therefore guaranteed dead everywhere it shipped, and the resulting
  // AGENT_ENGINE_UNAVAILABLE failure rendered that internal path into the
  // DOM. Removing it was right. Replacing it with NOTHING was not, and that
  // is what this function did until now.
  //
  // MEASURED 2026-08-10 in the real installed 1.0.5, over CDP:
  //   localStorage['mc.write.agent-session'] -> "enabled"   (the flag was ON)
  //   await window.mcAgent.availability()    -> {ok:false, code:"AGENT_ENGINE_UNAVAILABLE"}
  // A customer has no checkout and no MISSION_CONTROL_ENGINE, and there is no
  // UI anywhere to set one, so with only the two candidates below this could
  // never resolve. "Start an agent from inside Mission Control" was dead on
  // every shipped copy BY CONSTRUCTION -- not misconfigured, and not something
  // onboarding could fix.
  //
  // The fix is the same shape the setup modules already use: ship the engine
  // in the capability payload and resolve it from the root the shell already
  // computes. The environment variable still WINS when set, so a developer
  // pointing at their own checkout keeps getting that checkout rather than the
  // packaged copy -- the same precedence shell/main.cjs applies to
  // MC_BRIDGE_PROOF_FILE.
  if (enginePath !== undefined && enginePath !== null) {
    return [{ source: 'enginePath', value: boundedString(enginePath, 'enginePath', 32_768) }]
  }

  const candidates = []
  if (process.env.MISSION_CONTROL_ENGINE) {
    candidates.push({ source: 'MISSION_CONTROL_ENGINE', value: process.env.MISSION_CONTROL_ENGINE })
  }
  if (capabilityRoot) {
    candidates.push({ source: 'capability-payload', value: path.join(capabilityRoot, PAYLOAD_ENGINE_MODULE) })
  }
  return candidates
}

/* The engine tree a resolved module was found in.
 *
 * PAYLOAD_ENGINE_MODULE is `src/lib/agent-engine/codex-process.js`, so the root
 * is three directories above it. Derived rather than tracked separately because
 * a candidate may name the file OR its directory (normalizedModulePath accepts
 * both), and a second notion of "which tree won" is a second thing to keep in
 * agreement with the first. */
function engineRootOf(modulePath) {
  return path.resolve(path.dirname(modulePath), '..', '..', '..')
}

function loadEngine(enginePath, options = {}) {
  const attempts = []
  for (const candidate of engineCandidates(enginePath, options)) {
    let modulePath
    try {
      modulePath = normalizedModulePath(candidate.value)
    } catch (error) {
      attempts.push(`${candidate.source}: ${String(candidate.value)} (${error.message})`)
      continue
    }

    if (!fs.existsSync(modulePath)) {
      attempts.push(`${candidate.source}: ${modulePath} (not found)`)
      continue
    }

    try {
      const engine = require(modulePath)
      if (!engine || typeof engine.startCodexSession !== 'function') {
        attempts.push(`${candidate.source}: ${modulePath} (does not export startCodexSession())`)
        continue
      }
      return { startCodexSession: engine.startCodexSession, engineRoot: engineRootOf(modulePath) }
    } catch (error) {
      attempts.push(`${candidate.source}: ${modulePath} (${error.code || error.name || 'load error'}: ${error.message})`)
    }
  }

  fail(
    'AGENT_ENGINE_UNAVAILABLE',
    attempts.length > 0
      ? `Unable to resolve the real Codex engine. Paths tried:\n- ${attempts.join('\n- ')}`
      : 'Unable to resolve the real Codex engine: no enginePath was passed and MISSION_CONTROL_ENGINE is not set.',
  )
}

/* Resolve the confinement planner out of the engine tree.
 *
 * FAIL CLOSED, AND FAILING CLOSED HERE MEANS REFUSING TO START. The tempting
 * shape is to carry on with `threadOptions: {}` when this module is missing,
 * which reads as "confinement is optional". It is not optional: an empty thread
 * option set is exactly what made a `guided` install run at the user config's
 * danger-full-access. A payload that cannot say what a level permits must not
 * start an agent under that level's name. */
function loadConfinementPlanner(engineRoot) {
  const modulePath = path.join(engineRoot, PAYLOAD_CONFINEMENT_MODULE)
  if (!fs.existsSync(modulePath)) {
    fail(
      'AGENT_CONFINEMENT_UNAVAILABLE',
      `This copy carries no permission-level enforcement for agent sessions (${PAYLOAD_CONFINEMENT_MODULE} is absent from the engine at ${engineRoot}). It is staged by tools/capability-manifest.json under hostModules.`,
    )
  }
  let planner
  try {
    planner = require(modulePath)
  } catch (error) {
    fail('AGENT_CONFINEMENT_UNAVAILABLE', `The permission-level enforcement module could not be loaded (${error.message}).`)
  }
  if (!planner || typeof planner.confinedSessionPlan !== 'function') {
    fail('AGENT_CONFINEMENT_UNAVAILABLE', 'The engine carries a permission-level module this shell does not recognize.')
  }
  return planner
}

/* Resolve the billing/redirection scrub out of the engine tree.
 *
 * FAIL CLOSED, WITH THE SAME MEANING AS ABOVE: refusing to start. The tempting
 * shape is to fall back to `{ ...process.env }` when the module is missing,
 * because that is "what it did before" and it always works. That fallback is
 * the bug wearing a seatbelt: a payload that cannot scrub is a payload that
 * hands over a metered API key, and it would do so on exactly the installs
 * where a packaging mistake removed the protection -- silently, because a
 * mis-billed session looks identical to a correct one.
 *
 * Recognition is checked against the two functions this host actually calls, so
 * a payload carrying a differently-shaped module refuses rather than skipping
 * the scrub it cannot perform. */
function loadLaunchEnvironment(engineRoot) {
  const modulePath = path.join(engineRoot, PAYLOAD_LAUNCH_ENVIRONMENT_MODULE)
  if (!fs.existsSync(modulePath)) {
    fail(
      'AGENT_LAUNCH_ENVIRONMENT_UNAVAILABLE',
      `This copy cannot protect the account an agent session bills (${PAYLOAD_LAUNCH_ENVIRONMENT_MODULE} is absent from the engine at ${engineRoot}). It is staged by tools/capability-manifest.json under hostModules.`,
    )
  }
  let launchEnvironment
  try {
    launchEnvironment = require(modulePath)
  } catch (error) {
    fail('AGENT_LAUNCH_ENVIRONMENT_UNAVAILABLE', `The launch-environment module could not be loaded (${error.message}).`)
  }
  if (
    !launchEnvironment
    || typeof launchEnvironment.safeLaunchEnvironment !== 'function'
    || typeof launchEnvironment.assertNoBillingCredentials !== 'function'
  ) {
    fail('AGENT_LAUNCH_ENVIRONMENT_UNAVAILABLE', 'The engine carries a launch-environment module this shell does not recognize.')
  }
  return launchEnvironment
}

/* The Codex credential a CONFINED session is built from, asked as a question
 * rather than answered by writing.
 *
 * THE FIFTH PRECONDITION, and it was found by another lane measuring the
 * shipped build rather than by reading this file. Same packaged binary, same
 * isolated user-data directory, one variable changed:
 *
 *   USERPROFILE with no Codex sign-in -> availability READY, start() REFUSED
 *   USERPROFILE with a Codex sign-in  -> availability READY, start() STARTED
 *
 * The refusal is correct: prepareConfinedCodexHome() links the user's
 * auth.json into the isolated home, and linkCredential() refuses rather than
 * starting a session against an account it cannot name. What was wrong is that
 * the probe could not see it, so the product offered an enabled button that
 * refused every press -- the exact defect this function was repaired for,
 * surviving in the one precondition nobody had enumerated.
 *
 * IT IS CONDITIONAL, AND THE CONDITION IS THE POINT. Only an ISOLATED level
 * (guided, standard) builds a confined home, so only those levels need the
 * credential; `unrestricted` runs against the user's own Codex home and must
 * not be refused for the absence of a file it never reads. A probe that
 * demanded a sign-in at every level would report the product broken on the
 * default level -- a false negative, which costs more than the bug.
 *
 * FAIL OPEN ON ITS OWN UNCERTAINTY, WHICH IS THE OPPOSITE OF HOW THE START
 * FAILS, DELIBERATELY. Every branch that cannot PROVE the start would refuse
 * returns null and lets readiness stand. A probe that cannot resolve the
 * recorded level has learned nothing about the credential, and turning "I could
 * not tell" into "unavailable" would delete the product's core feature on any
 * machine whose payload shape this shell does not recognise. The start path
 * still fails closed on all of those, so a null here is never worse than the
 * behaviour that shipped -- it is only less helpful.
 *
 * THE PATH IS DUPLICATED FROM THE PAYLOAD MODULE, and that duplication is
 * checked rather than trusted: tools/test/agent-session-surface.test.mjs reads
 * agent-session-confinement.js and asserts it still resolves CODEX_HOME (or
 * ~/.codex) and still raises AGENT_CONFINEMENT_SIGNED_OUT for a missing
 * auth.json. The module exports no read-only sign-in probe to call instead --
 * linkCredential() is private and writes -- so the choice is a checked copy or
 * no answer at all. */
function confinedSessionIsSignedOut(planner) {
  if (!planner || typeof planner.resolveAgentConfinement !== 'function') return false
  let confinement
  try {
    confinement = planner.resolveAgentConfinement({})
  } catch {
    return false
  }
  if (!confinement || confinement.isolated !== true) return false
  try {
    const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')
    return !fs.existsSync(path.join(codexHome, 'auth.json'))
  } catch {
    return false
  }
}

/* The environment an agent child is allowed to inherit, at EVERY level.
 *
 * BOTH BRANCHES, DELIBERATELY, because the asymmetry WAS the defect. Handling
 * only the `plan.env` branch leaves `unrestricted` -- the default, and the level
 * most people run -- reaching the full `process.env` through codex-process.js's
 * `env === undefined ? process.env : env` fallback. So this always returns an
 * object and the caller always passes it; there is no longer a branch on which
 * "no environment" silently means "all of it".
 *
 * ORDER MATTERS. Scrub first, apply the account pin (CODEX_HOME) second, then
 * assert again -- the order subscription-launch-env.js's own comment prescribes,
 * so a pin can never reintroduce a credential the scrub removed.
 *
 * WHAT IS NOT TAKEN AWAY. The scrub is a named list of credentials and endpoint
 * redirectors, not a filter: PATH, APPDATA and the rest survive, which is what
 * lets Codex still be found on Windows, and CODEX_HOME is not on the list, so a
 * user who sets their own still gets it at `unrestricted`. */
function sessionLaunchEnvironment(launchEnvironment, plan, { context }) {
  const scrubbed = launchEnvironment.safeLaunchEnvironment(process.env, { context })
  if (!plan.env) return scrubbed
  return launchEnvironment.assertNoBillingCredentials({ ...scrubbed, ...plan.env }, { context })
}

/**
 * Resolve the engine WITHOUT starting a session, and report only a bounded
 * code. The resolver's own message names every path it tried; that message is
 * a diagnostic for the main process, never for a renderer, because rendering
 * it is precisely how a private checkout path reached the DOM before
 * (BLOCKER 2). Callers that show this to a person get {ok, code} and nothing
 * else -- there is no path, no message, and no error object to leak.
 *
 * This exists so a spawn surface can be HONEST about its own availability.
 * Without it the only way to learn whether an engine is reachable is to try
 * to start one, which means the UI must offer a control that may be dead --
 * the exact defect the regression gate was written to prevent.
 */
/* `capabilityRoot` is injectable so a test can pin the genuinely-engine-less
 * state deterministically. It used to be enough to delete
 * MISSION_CONTROL_ENGINE, because an unconfigured shell had no other way to
 * find an engine. Now that a shipped payload legitimately resolves one, "no
 * environment variable" no longer means "no engine", and a test that relies on
 * that would be measuring ambient state -- green or red depending on whether a
 * payload happens to be staged beside it. */

/* READINESS MUST MEAN STARTABLE, AND FOR ONE RELEASE IT DID NOT.
 *
 * This function used to resolve ONLY the engine -- `loadStartCodexSession()`
 * and nothing else -- and answer AGENT_ENGINE_READY when that came back. The
 * real start path resolves three modules out of the engine tree and validates a
 * working directory, so readiness and startability were computed from two
 * different sources. On any payload missing one of the other two the product
 * reported READY, enabled Start, and threw on every press with no way for the
 * person to tell why. That is not hypothetical: agent-session-confinement.js
 * and subscription-launch-env.js were both declared under `hostModules` AFTER
 * the 1.0.5 installer was built, so the copy already delivered to a second
 * machine is exactly that build.
 *
 * SO THE LIST BELOW IS THE START PATH'S OWN LIST, IN THE START PATH'S OWN
 * ORDER, and each entry is here because startSession() cannot proceed without
 * it -- not because it seemed prudent:
 *
 *   loadEngine                -> createAgentHost's first statement.
 *   normalizeCwd(defaultCwd)  -> createAgentHost's SECOND statement, and the
 *                                asar-path defect that killed every PACKAGED
 *                                start while every checkout stayed green.
 *   loadConfinementPlanner    -> planConfinement(), before anything is spawned.
 *   the Codex sign-in         -> inside confinedSessionPlan(), at an isolated
 *                                level only. See confinedSessionIsSignedOut().
 *   loadLaunchEnvironment     -> resolved per session, after the plan.
 *
 * The ORDER is the start path's order so a payload missing more than one module
 * reports the same code from the probe as from the press. A probe that named a
 * different one of two true faults would send someone to fix the wrong thing.
 *
 * WHAT IS DELIBERATELY NOT DONE HERE, and it is the one thing that looks
 * missing: confinedSessionPlan() is NOT called. It is not a read --
 * prepareConfinedCodexHome() mkdirs the isolated agent home, links the Codex
 * credential into it and writes config.toml. Availability is the one agent
 * channel that starts nothing, and a probe the home screen runs on every mount
 * must not build a session's home as a side effect. Its `plan.ok === false`
 * refusal therefore remains a start-time refusal; see the note on that check in
 * startSession(). Everything install-shaped -- a module the payload did not
 * ship, a module this shell does not recognise, a working directory that is a
 * file inside an archive -- is answered here, before a control is offered.
 *
 * `defaultCwd` defaults to process.cwd() rather than being optional, and it is
 * the SAME default createAgentHost() takes. An optional precondition is a
 * precondition a caller can skip, which is the defect this function is being
 * repaired for, one level up. */
function engineAvailability({ enginePath, defaultCwd = process.cwd(), ...options } = {}) {
  try {
    const { engineRoot } = loadEngine(enginePath, options)
    normalizeCwd(defaultCwd, defaultCwd)
    const planner = loadConfinementPlanner(engineRoot)
    if (confinedSessionIsSignedOut(planner)) {
      fail(
        'AGENT_CONFINEMENT_SIGNED_OUT',
        'The assistant is not signed in on this computer, so no confined session can be started for it.',
      )
    }
    loadLaunchEnvironment(engineRoot)
    return Object.freeze({ ok: true, code: 'AGENT_ENGINE_READY' })
  } catch (error) {
    return Object.freeze({
      ok: false,
      code: typeof error?.code === 'string' ? error.code : 'AGENT_ENGINE_UNAVAILABLE',
    })
  }
}

/* Every code engineAvailability() can answer with when it is not ready.
 *
 * EXPORTED SO THE UI CANNOT SILENTLY OUTGROW ITS OWN VOCABULARY. Both surfaces
 * that consume availability translate a code into a sentence and fall back to
 * generic copy for anything unrecognised -- so adding a precondition here
 * without adding copy there produces a refusal that says nothing, next to a
 * disabled control, which is only marginally better than the enabled one it
 * replaced. tools/test/agent-session-surface.test.mjs walks this list against
 * both copy tables, and separately walks every fail() code in this file to
 * force a new one to be classified rather than forgotten. */
const AVAILABILITY_CODES = Object.freeze([
  'AGENT_ENGINE_UNAVAILABLE',
  'AGENT_CONFINEMENT_UNAVAILABLE',
  'AGENT_CONFINEMENT_SIGNED_OUT',
  'AGENT_LAUNCH_ENVIRONMENT_UNAVAILABLE',
  'AGENT_HOST_INVALID_CWD',
  'AGENT_HOST_INVALID_ARGUMENT',
])

function normalizeSessionId(value) {
  return boundedString(value, 'sessionId', 128)
}

/* Stat the way the OS will, not the way Electron's fs patch will.
 *
 * Electron patches fs so that paths inside an `.asar` archive report as real
 * directories. child_process.spawn honours no such patch: it hands cwd to
 * CreateProcess/chdir, which sees `app.asar` as the single FILE it is and
 * refuses it -- surfacing as an ENOENT blamed on the command, not the cwd.
 *
 * So a plain fs.statSync() here answers a DIFFERENT question than the one the
 * spawn will ask, and approves a working directory that cannot work. That gap
 * is not hypothetical: it is how a packaged-only agent-start failure got past
 * this validator while every checkout stayed green (measured 2026-08-10, see
 * getAgentHost() in shell/main.cjs). `process.noAsar` turns the patch off for
 * the duration of the call, so validation and execution agree.
 *
 * Setting a process flag Electron reads is not an Electron dependency -- this
 * module still require()s no Electron -- and in plain Node the property is
 * simply unused. */
function statAsTheOsWill(target) {
  const previous = process.noAsar
  process.noAsar = true
  try {
    return fs.statSync(target)
  } finally {
    process.noAsar = previous
  }
}

function normalizeCwd(value, fallback) {
  const raw = value === undefined ? fallback : boundedString(value, 'cwd', 32_768)
  const resolved = path.resolve(raw)
  let stats
  try {
    stats = statAsTheOsWill(resolved)
  } catch (error) {
    fail('AGENT_HOST_INVALID_CWD', `cwd is not accessible: ${resolved} (${error.code || error.message})`)
  }
  if (!stats.isDirectory()) {
    // Name the archive case explicitly. "not a directory" about a path that
    // Electron's own fs calls a directory reads as a contradiction otherwise,
    // and that confusion is what cost the time this comment exists to save.
    const inArchive = resolved.split(path.sep).some(segment => segment.toLowerCase().endsWith('.asar'))
    fail(
      'AGENT_HOST_INVALID_CWD',
      inArchive
        ? `cwd is inside an asar archive and cannot be a working directory: ${resolved}`
        : `cwd is not a directory: ${resolved}`,
    )
  }
  return resolved
}

function validateStartedSession(value) {
  if (!value || typeof value !== 'object') {
    fail('AGENT_ENGINE_INVALID_SESSION', 'startCodexSession() did not return a session object')
  }
  if (!value.adapter || typeof value.adapter.sendTurn !== 'function' || typeof value.adapter.interrupt !== 'function') {
    fail('AGENT_ENGINE_INVALID_SESSION', 'startCodexSession() returned an invalid adapter')
  }
  if (typeof value.threadId !== 'string' || value.threadId.length === 0 || value.threadId.length > 512) {
    fail('AGENT_ENGINE_INVALID_SESSION', 'startCodexSession() returned an invalid threadId')
  }
  if (typeof value.close !== 'function') {
    fail('AGENT_ENGINE_INVALID_SESSION', 'startCodexSession() returned no close() function')
  }
  return value
}

function createAgentHost({ enginePath, defaultCwd = process.cwd(), confinementPlanner = null } = {}) {
  const { startCodexSession, engineRoot } = loadEngine(enginePath)
  const fallbackCwd = normalizeCwd(defaultCwd, process.cwd())
  /* Resolved PER SESSION rather than once here, so that changing the permission
   * level takes effect on the next agent the user starts instead of on the next
   * time they restart the application. "You can change it later" is what the
   * first-run screen promises; a ceiling cached at construction would make that
   * promise true only after a relaunch. */
  const planConfinement = confinementPlanner
    || (() => loadConfinementPlanner(engineRoot).confinedSessionPlan({}))
  const sessions = new Map()
  const listeners = new Set()
  let closed = false

  function emit(session, event) {
    if (sessions.get(session.sessionId) !== session) return

    if (event && event.type === 'turn_completed') {
      if (typeof event.turnId === 'string') {
        if (session.activeTurnId === event.turnId) session.activeTurnId = null
        else if (session.sendPromise) session.completedDuringSend.add(event.turnId)
      } else if (session.activeTurnId) {
        session.activeTurnId = null
      } else if (session.sendPromise) {
        session.completedWithoutTurnId = true
      }
    }

    const packet = Object.freeze({ sessionId: session.sessionId, event })
    for (const listener of [...listeners]) {
      try {
        listener(packet)
      } catch {
        // A renderer/listener bug must not break the engine's stdio reader.
        process.emitWarning('An agent host event listener threw', { code: 'AGENT_HOST_EVENT_LISTENER' })
      }
    }
  }

  async function closeReadySession(session) {
    if (session.closePromise) return session.closePromise
    session.closeRequested = true
    session.state = 'closing'
    const closePromise = (async () => {
      if (session.engineClose) await Promise.resolve(session.engineClose())
      session.state = 'closed'
      if (sessions.get(session.sessionId) === session) sessions.delete(session.sessionId)
    })()
    session.closePromise = closePromise
    try {
      return await closePromise
    } catch (error) {
      // Keep the cleanup handle and map entry so closeSession()/closeAll() can
      // retry instead of reporting success while a child may still be alive.
      if (session.closePromise === closePromise) {
        session.closePromise = null
        session.state = 'close-failed'
      }
      throw error
    }
  }

  function assertOpen() {
    if (closed) fail('AGENT_HOST_CLOSED', 'The agent host is closed')
  }

  function readySession(sessionId) {
    const id = normalizeSessionId(sessionId)
    const session = sessions.get(id)
    if (!session) fail('AGENT_SESSION_UNKNOWN', `Unknown sessionId: ${id}`)
    if (session.state !== 'ready') {
      fail('AGENT_SESSION_NOT_READY', `Session ${id} is ${session.state}`)
    }
    return session
  }

  function startSession({ sessionId, cwd } = {}) {
    assertOpen()
    const id = normalizeSessionId(sessionId)
    if (sessions.has(id)) fail('AGENT_SESSION_EXISTS', `Session already exists: ${id}`)
    const sessionCwd = normalizeCwd(cwd, fallbackCwd)

    /* THE RECORDED LEVEL, BINDING THIS SESSION.
     *
     * `plan.ok === false` means the level was resolved but the confinement it
     * requires could not be built. That REFUSES the start. The alternative --
     * starting anyway with the process sandbox but the user's own MCP servers --
     * is the shape that has cost this project three separate findings: a missing
     * security input treated as consent. A session that cannot be confined to
     * the level the user chose is not a session that runs at a wider level; it
     * is a session that does not run. */
    const plan = planConfinement()
    if (!plan || plan.ok !== true) {
      fail(
        (plan && plan.code) || 'AGENT_CONFINEMENT_UNAVAILABLE',
        'This session could not be confined to the permission level recorded on this computer, so it was not started.',
      )
    }

    /* WHOSE ACCOUNT THIS SESSION SPENDS, decided before anything is spawned.
     *
     * Resolved per session for the same reason the plan is, and AFTER it so the
     * two failures keep distinct codes in a fixed order: an engine missing both
     * modules still reports the confinement one, which is the answer that was
     * true before this existed.
     *
     * Synchronous, like every other refusal startSession makes, so a caller
     * never receives a session handle it could mistake for a running agent. A
     * refusal here is loud and costs nothing; the alternative it replaces was
     * silent and cost real money.
     *
     * The context carries NO caller data -- it is rendered into an error message
     * and a session id has no business in one (BLOCKER 2). */
    const sessionEnv = sessionLaunchEnvironment(
      loadLaunchEnvironment(engineRoot),
      plan,
      { context: 'Mission Control agent session' },
    )

    const session = {
      sessionId: id,
      cwd: sessionCwd,
      state: 'starting',
      closeRequested: false,
      closePromise: null,
      engineClose: null,
      adapter: null,
      threadId: null,
      activeTurnId: null,
      sendPromise: null,
      completedDuringSend: new Set(),
      completedWithoutTurnId: false,
      startPromise: null,
    }
    // Reserve before the asynchronous engine start so duplicate starts cannot
    // race and leak a second child process.
    sessions.set(id, session)

    session.startPromise = (async () => {
      try {
        const startedValue = await startCodexSession({
          cwd: sessionCwd,
          clientInfo: CLIENT_INFO,
          // What the OS enforces on the agent process itself. MEASURED against a
          // user config that says danger-full-access: the thread option wins.
          threadOptions: plan.threadOptions,
          // What bounds the agent AROUND the process. MCP servers are separate
          // children that no sandbox applied to the agent covers, so a confined
          // level points Codex at a home this installation owns and the user's
          // own servers are never inherited.
          //
          // ALWAYS PASSED NOW, at every level including `unrestricted`, which is
          // a deliberate change to a documented property. This used to omit the
          // key entirely at `unrestricted` to keep that level "byte-for-byte the
          // session it was before" -- but omitting it does not mean "no
          // environment", it means codex-process.js's `env === undefined ?
          // process.env : env` fallback hands over the whole parent environment,
          // API key included. The level that got the LEAST protection was the
          // default one.
          //
          // THE REQUIREMENTS CALL, STATED RATHER THAN SLIPPED IN: a permission
          // tier governs what the agent may REACH. This governs whose money it
          // spends and which host its prompts go to, which is a different axis.
          // `unrestricted` means "I trust this agent with my computer"; nobody
          // choosing it was consenting to have a metered API account billed by
          // surprise, or to have their prompts routed through whatever host an
          // inherited BASE_URL happens to name. So the scrub applies at every
          // level, and what `unrestricted` still means is intact: no redirected
          // Codex home, no substituted MCP servers, and the user's own
          // CODEX_HOME (not on the scrub list) still honoured.
          env: sessionEnv,
          onEvent: (event) => emit(session, event),
        })
        // Retain a usable close handle before validating the rest of the
        // contract. A malformed adapter must not strand a spawned child.
        if (startedValue && typeof startedValue === 'object' && typeof startedValue.close === 'function') {
          session.engineClose = startedValue.close
        }
        const started = validateStartedSession(startedValue)
        session.adapter = started.adapter
        session.threadId = started.threadId
        session.engineClose = started.close

        if (closed || session.closeRequested) {
          await closeReadySession(session)
          fail('AGENT_SESSION_START_CANCELLED', `Session closed while starting: ${id}`)
        }

        session.state = 'ready'
        /* The level is reported back so a caller can say what this session is
         * confined to without asking a second source and risking a different
         * answer. It is the tier the session was ACTUALLY started under, which
         * is not always the recorded one: an unreadable record fails closed to
         * the most restrictive level, and the caller must be able to see that
         * rather than report the level it hoped for. */
        return Object.freeze({ sessionId: id, threadId: session.threadId, tier: plan.tier })
      } catch (error) {
        let cleanupError = null
        if (session.engineClose && session.state !== 'closed') {
          try { await closeReadySession(session) } catch (closeError) { cleanupError = closeError }
        }
        if (cleanupError) {
          const combined = new AggregateError(
            [error, cleanupError],
            `Session ${id} failed to start and its Codex child failed to close`,
          )
          combined.code = 'AGENT_SESSION_CLEANUP_FAILED'
          throw combined
        }
        session.state = session.state === 'closed' ? 'closed' : 'failed'
        if (sessions.get(id) === session) sessions.delete(id)
        throw error
      }
    })()

    return session.startPromise
  }

  async function sendTurn({ sessionId, text } = {}) {
    assertOpen()
    const session = readySession(sessionId)
    const turnText = boundedString(text, 'text', 200_000, { allowEmpty: false })
    if (session.sendPromise || session.activeTurnId) {
      fail('AGENT_TURN_ACTIVE', `Session ${session.sessionId} already has an active turn`)
    }

    session.completedDuringSend.clear()
    session.completedWithoutTurnId = false
    const sendPromise = (async () => {
      const result = await session.adapter.sendTurn({
        threadId: session.threadId,
        text: turnText,
        images: [],
      })
      if (!result || typeof result.turnId !== 'string' || result.turnId.length === 0 || result.turnId.length > 512) {
        fail('AGENT_ENGINE_INVALID_TURN', 'Codex sendTurn() returned an invalid turnId')
      }
      const alreadyCompleted = session.completedWithoutTurnId || session.completedDuringSend.delete(result.turnId)
      session.activeTurnId = alreadyCompleted ? null : result.turnId
      return Object.freeze({
        sessionId: session.sessionId,
        threadId: session.threadId,
        turnId: result.turnId,
      })
    })()
    session.sendPromise = sendPromise

    try {
      return await sendPromise
    } finally {
      if (session.sendPromise === sendPromise) session.sendPromise = null
      session.completedDuringSend.clear()
      session.completedWithoutTurnId = false
    }
  }

  async function interrupt({ sessionId } = {}) {
    assertOpen()
    let session = readySession(sessionId)
    if (session.sendPromise) await session.sendPromise
    session = readySession(sessionId)
    if (!session.activeTurnId) {
      fail('AGENT_TURN_NONE', `Session ${session.sessionId} has no active turn`)
    }
    const turnId = session.activeTurnId
    await session.adapter.interrupt({ threadId: session.threadId, turnId })
    return Object.freeze({ sessionId: session.sessionId, turnId })
  }

  async function closeSession({ sessionId } = {}) {
    const id = normalizeSessionId(sessionId)
    const session = sessions.get(id)
    if (!session) fail('AGENT_SESSION_UNKNOWN', `Unknown sessionId: ${id}`)
    session.closeRequested = true

    if (session.state === 'starting') {
      try { await session.startPromise } catch { /* Retry cleanup below when a close handle remains. */ }
    }
    if (session.state !== 'closed' && session.engineClose) await closeReadySession(session)
    if (sessions.get(id) === session) sessions.delete(id)
    return Object.freeze({ sessionId: id, closed: true })
  }

  function onEvent(listener) {
    assertOpen()
    if (typeof listener !== 'function') fail('AGENT_HOST_INVALID_ARGUMENT', 'onEvent requires a listener function')
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  async function closeAll() {
    if (closed && sessions.size === 0) return
    closed = true
    const pending = [...sessions.values()].map(async (session) => {
      session.closeRequested = true
      if (session.state === 'starting') {
        try { await session.startPromise } catch { /* Startup failure already cleaned itself up. */ }
      }
      if (session.state !== 'closed' && session.engineClose) await closeReadySession(session)
    })
    const results = await Promise.allSettled(pending)
    listeners.clear()
    const failures = results.filter(result => result.status === 'rejected').map(result => result.reason)
    if (failures.length) throw new AggregateError(failures, 'One or more Codex sessions failed to close')
  }

  return Object.freeze({
    startSession,
    sendTurn,
    interrupt,
    closeSession,
    onEvent,
    closeAll,
  })
}

/* engineCandidates is exported for ORDER assertions only. engineAvailability()
 * cannot reveal precedence: the resolver walks every candidate and returns the
 * first that WORKS, so when only one resolves the order is unobservable through
 * it. A precedence test written against engineAvailability() therefore passes
 * whichever way round the candidates are, which is exactly what a planted
 * swap proved before this was exported. */
module.exports = { AVAILABILITY_CODES, createAgentHost, engineAvailability, engineCandidates }
