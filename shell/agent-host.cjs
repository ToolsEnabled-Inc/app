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
  name: 'toolsenabled',
  title: 'ToolsEnabled',
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

/* WHAT A RENDERER MAY ASK OF A TURN, and how the plan stays on top.
 *
 * The engine accepts cwd, approvalPolicy, model and serviceTier per turn.
 * Exactly ONE of those is the renderer's to choose: `model`. The other three
 * are refused BY NAME — approvalPolicy and sandbox are the recorded level's
 * ceiling, cwd per-turn would relocate execution outside the workspace root
 * the plan measured, and serviceTier is a billing routing question nobody
 * asked the person. The requested model must be a Codex row of the SAME
 * START_TIERS table the start channel resolves from, so the two surfaces can
 * never disagree about what is launchable.
 *
 * The plan's per-turn-legal key (approvalPolicy) is spread LAST, so even a
 * key that slipped past the name check could not override what the plan
 * states; `sandbox` is thread-level, already bound at start, and refused per
 * turn by the adapter itself. Widening is structurally impossible, not
 * merely checked. Module-level and exported so the suite runs the REAL rule
 * rather than grepping for its shape. */
const RENDERER_TURN_KEYS = Object.freeze(['model'])

function narrowTurnOptions(planThreadOptions, requested, startTiers) {
  if (requested === undefined || requested === null) return null
  if (typeof requested !== 'object' || Array.isArray(requested)) {
    fail('AGENT_TURN_OPTION_FORBIDDEN', 'Turn options must be an object')
  }
  for (const key of Object.keys(requested)) {
    if (!RENDERER_TURN_KEYS.includes(key)) {
      fail('AGENT_TURN_OPTION_FORBIDDEN', `Turn option "${key}" is not a renderer choice`)
    }
  }
  const narrowed = {}
  if (requested.model !== undefined) {
    const model = boundedString(requested.model, 'model', 128, { allowEmpty: false })
    const row = Object.entries(startTiers).find(([, tier]) => tier.model === model)
    if (!row) {
      fail('AGENT_TIER_UNKNOWN', `Unknown model "${model}". Available: ${Object.values(startTiers).map(tier => tier.model).join(', ')}.`)
    }
    if (row[1].provider !== 'codex') {
      fail('AGENT_TIER_NO_LAUNCHER', `The ${row[0]} tier has no launcher in this app yet.`)
    }
    narrowed.model = model
  }
  if (!Object.keys(narrowed).length) return null
  return {
    ...narrowed,
    ...(planThreadOptions && planThreadOptions.approvalPolicy !== undefined
      ? { approvalPolicy: planThreadOptions.approvalPolicy }
      : {}),
  }
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
 * THE GAP THIS CLOSES. ToolsEnabled's first-run screen asks how much the
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
  // never resolve. "Start an agent from inside ToolsEnabled" was dead on
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

/* The Codex CLI itself: the SIXTH precondition, and the one that made the
 * product lie.
 *
 * WHAT WAS MEASURED. A machine with a Codex `auth.json` present and no `codex`
 * on PATH: availability answered {ok:true, AGENT_ENGINE_READY}, home said
 * "agent engine ready", Start rendered ENABLED, and the press failed with the
 * bare string `AGENT_SESSION_FAILED`. Every check above passed, because every
 * check above asks about THIS INSTALLATION -- the engine's modules, its working
 * directory, the credential file. None of them asks whether the program that
 * actually runs an agent exists. A sign-in is a file; the CLI is a binary; the
 * fifth precondition proved the file and stopped.
 *
 * IT IS UNCONDITIONAL, WHICH IS THE DIFFERENCE FROM THE CHECK ABOVE. The
 * sign-in is only needed at an ISOLATED level, so confinedSessionIsSignedOut()
 * is rightly conditional. The CLI is spawned at EVERY level -- `unrestricted`
 * runs the same `codex` -- so a level-conditional CLI check would reproduce the
 * same lie on the default level.
 *
 * IT IS CHECKED BEFORE THE SIGN-IN, AND THAT INVERTS THE START PATH'S ORDER ON
 * PURPOSE. startSession() prepares the confined home (sign-in) before it spawns
 * Codex (CLI), so start-path order would report "not signed in" first. That
 * order is correct for a machine and wrong for a person: `codex login` is a
 * SUBCOMMAND OF THE BINARY THAT IS MISSING. Telling someone with no CLI to sign
 * in sends them to a dead end and the product looks broken twice. Reporting the
 * CLI first yields the only sequence that terminates: install, then sign in,
 * each step true when it is shown. This is the one place in this function where
 * the person's dependency order beats the code's call order, and it is stated
 * here so the next reader does not "fix" it back.
 *
 * IT MIRRORS resolveInvocation() IN THE PAYLOAD rather than guessing, because a
 * check that resolves the CLI differently from the spawn is a check that can
 * pass for a binary the spawn will not find. That duplication is CHECKED rather
 * than trusted -- exactly as the confinement path above is -- by
 * tools/test/agent-codex-cli-precondition.test.mjs, which reads
 * capability/src/lib/agent-engine/codex-process.js and asserts both branches
 * this function copies are still the branches that file takes.
 *
 * IT PROVES ABSENCE OR IT SAYS NOTHING. Every uncertain branch returns false
 * and lets readiness stand, which is the same fail-open-on-own-uncertainty rule
 * the rest of this probe follows: a machine whose PATH this shell cannot read
 * has taught us nothing about whether Codex is installed, and turning "I could
 * not tell" into "unavailable" would delete the product's core feature on it.
 * The start path still fails closed there, so a false here is never worse than
 * what shipped.
 *
 * WHAT IT DOES NOT DO IS RUN ANYTHING. `codex --version` is the engine's own
 * liveness test (detectCodexVersion), but this probe runs on every home mount
 * and spawning a child process per mount is a cost and a side effect an
 * availability read must not have. So this answers PRESENCE, and the residual
 * gap -- a `codex` that resolves but cannot execute -- is answered at the press
 * instead, where CODEX_CLI_NOT_FOUND and CODEX_VERSION_DETECTION_FAILED now
 * have copy of their own rather than reaching the DOM as bare identifiers. */
function codexCommandIsMissing() {
  try {
    /* Branch one, win32: the npm global install the payload prefers, run
     * through process.execPath with no shell. Same path, same order. */
    if (process.platform === 'win32') {
      const appData = process.env.APPDATA
      if (appData) {
        const entry = path.join(appData, 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
        if (fs.existsSync(entry)) return false
      }
    }
    /* Branch two: the payload falls back to a shell-resolved `codex`, which on
     * Windows means cmd.exe searching PATH by PATHEXT. An extensionless file is
     * NOT executable by cmd, so the extension list is the resolution -- checking
     * for a bare `codex` would pass on the npm bash shim that cmd cannot run.
     *
     * PATH is read from this process because the session inherits it: the
     * launch-environment scrub is a named credential denylist and PATH is not on
     * it, which is precisely what lets Codex still be found on Windows. */
    const rawPath = process.env.PATH || process.env.Path
    if (!rawPath) return false
    const extensions = process.platform === 'win32'
      ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').map(value => value.trim()).filter(Boolean)
      : ['']
    for (const directory of rawPath.split(path.delimiter)) {
      if (!directory) continue
      for (const extension of extensions) {
        try {
          if (fs.statSync(path.join(directory, `codex${extension}`)).isFile()) return false
        } catch {
          /* one unreadable directory is not an answer about the others */
        }
      }
    }
    return true
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
function sessionLaunchEnvironment(launchEnvironment, plan, { context, extras = null }) {
  const scrubbed = launchEnvironment.safeLaunchEnvironment(process.env, { context })
  if (!plan.env && !extras) return scrubbed
  /* Extras sit UNDER the plan: a settings row may narrow a session (the tool
     allowlist), but nothing a settings row carries may override what the
     confinement plan decided. Both layered results still pass the billing
     assertion, so an extra can never reintroduce what the scrub removed. */
  return launchEnvironment.assertNoBillingCredentials(
    { ...scrubbed, ...(extras || {}), ...(plan.env || {}) },
    { context },
  )
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
 *   the Codex CLI            -> spawned by startCodexSession() at EVERY level.
 *                                See codexCommandIsMissing(), and the note there
 *                                on why it is asked BEFORE the sign-in.
 *   the Codex sign-in         -> inside confinedSessionPlan(), at an isolated
 *                                level only. See confinedSessionIsSignedOut().
 *   loadLaunchEnvironment     -> resolved per session, after the plan.
 *
 * The ORDER is the start path's order so a payload missing more than one module
 * reports the same code from the probe as from the press. A probe that named a
 * different one of two true faults would send someone to fix the wrong thing.
 * The single exception is the CLI/sign-in pair, inverted against the start path
 * because one instruction cannot be carried out without the other; the reason is
 * argued in full at codexCommandIsMissing().
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
    /* Before the sign-in, deliberately: `codex login` is a subcommand of this
     * binary, so a machine missing both must be told about the binary first or
     * the instruction it gets cannot be carried out. See codexCommandIsMissing(). */
    if (codexCommandIsMissing()) {
      fail(
        'AGENT_CODEX_CLI_NOT_INSTALLED',
        'The Codex command-line program is not installed on this computer, so there is nothing for a session to run.',
      )
    }
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
  'AGENT_CODEX_CLI_NOT_INSTALLED',
  'AGENT_CONFINEMENT_SIGNED_OUT',
  'AGENT_LAUNCH_ENVIRONMENT_UNAVAILABLE',
  'AGENT_HOST_INVALID_CWD',
  'AGENT_HOST_INVALID_ARGUMENT',
])

/* THE REFUSALS THE PROBE NEVER ANSWERS, AND THEREFORE NOTHING REQUIRED COPY FOR.
 *
 * Both surfaces that show a refusal -- src/agent-availability-copy.js for the
 * Start control and ENGINE_REASON in src/local-activity.js for the home screen
 * -- have their coverage walked from an EXPORTED vocabulary:
 * AVAILABILITY_CODES here and RECORD_AVAILABILITY_CODES in shell/spawn-record.cjs.
 * Four codes reach a person as a refusal and appear in neither list, so nothing
 * required either table to have a sentence for them:
 *
 *   AGENT_HOST_CLOSED           raised by fail() below, on a call that arrives
 *                               while the host is being torn down.
 *   MC_AGENT_INVALID_PAYLOAD    raised by the agent IPC frame validator in
 *                               shell/main.cjs before this module is reached.
 *   CODEX_CLI_NOT_FOUND         raised by the ENGINE at start time
 *   CODEX_VERSION_DETECTION_FAILED  (detectCodexVersion in the payload's
 *                               codex-process.js). codexCommandIsMissing()
 *                               answers PRESENCE without spawning anything, so
 *                               a `codex` that resolves on PATH and cannot
 *                               execute passes readiness and fails on the press.
 *
 * Without copy, unavailableReason() falls through to `String(code)` and the
 * page shows the bare identifier, while the home screen's fallback shows "not
 * set up to run agents yet" -- confidently wrong about an installation whose
 * engine resolved. That is the unlabelled refusal a customer already met once
 * as a bare AGENT_SESSION_FAILED, and it is why this list exists rather than
 * living as four unremarkable keys in a copy table nobody walks.
 *
 * They are NOT availability codes and must not be added to AVAILABILITY_CODES:
 * that list is checked both ways against what availability() can return, so a
 * start-only code in it would fail this module's own classification test. */
const START_REFUSAL_CODES = Object.freeze([
  'AGENT_HOST_CLOSED',
  'MC_AGENT_INVALID_PAYLOAD',
  'CODEX_CLI_NOT_FOUND',
  'CODEX_VERSION_DETECTION_FAILED',
  /* Raised by resolveStartTier() when a person picks one of the three Claude
     tiers: listed by name in START_TIERS, refused by name here, because
     omitting them would make a chosen model quietly become Codex -- the exact
     defect the tier channel exists to close. A real user reaches this with one
     click, so it carries copy on both surfaces like every other start
     refusal. */
  'AGENT_TIER_NO_LAUNCHER',
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

function createAgentHost({ enginePath, defaultCwd = process.cwd(), confinementPlanner = null, sessionEnvironmentExtras = null } = {}) {
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

  /* THE SIX DISPATCHABLE TIERS, mirrored from src/orchestration-controls.js.
   *
   * Duplicated rather than imported because that file is ESM and this is CJS in
   * the Electron main process. tools/test/orchestration-controls.test.mjs
   * already parses the ENGINE table and fails when the renderer table drifts
   * from it; the same test now covers this one, so three copies cannot disagree
   * silently.
   *
   * `startCodexSession()` is the only start path here, so the three claude tiers
   * have NO LAUNCHER on this channel. They are listed anyway, and refused BY
   * NAME with a reason, because the alternative -- omitting them -- makes a
   * chosen model quietly become Codex, which is exactly the defect the owner
   * hit: "i cant even choose the provider or model", while every agent silently
   * ran on Codex. A refusal that says why is worth more than a success that
   * lies. */
  const START_TIERS = Object.freeze({
    luna: { provider: 'codex', model: 'gpt-5.6-luna', effort: 'medium' },
    terra: { provider: 'codex', model: 'gpt-5.6-terra', effort: 'high' },
    sol: { provider: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' },
    'claude-fable': { provider: 'claude', model: 'claude/fable' },
    'claude-sonnet': { provider: 'claude', model: 'claude/sonnet' },
    'claude-opus': { provider: 'claude', model: 'claude/opus' },
    /* Offered in the menu like the claude rows, refused honestly at press:
       the engine's local tier is a dispatch-lane runner with no interactive
       ACP adapter yet, and a session this host cannot actually start must
       refuse rather than silently start Codex instead. */
    local: { provider: 'local', model: 'local/auto' },
  })

  function resolveStartTier(tier) {
    if (tier === undefined || tier === null || tier === '') return null
    const row = START_TIERS[tier]
    if (!row) {
      fail('AGENT_TIER_UNKNOWN',
        `Unknown tier "${tier}". Available: ${Object.keys(START_TIERS).join(', ')}.`)
    }
    if (row.provider !== 'codex') {
      fail('AGENT_TIER_NO_LAUNCHER',
        `The ${tier} tier runs on ${row.provider}, and this app can only start Codex agents today. `
        + `Codex tiers: ${Object.keys(START_TIERS).filter(id => START_TIERS[id].provider === 'codex').join(', ')}.`)
    }
    return row
  }

  /* EFFORT, BOUND AT SPAWN. The codex app-server protocol has no per-turn or
   * per-thread effort field (the adapter's allowlists are strict and upstream
   * offers nothing to map to), but the CLI accepts `-c
   * model_reasoning_effort=<key>` -- the same lever the mission-bridge lane
   * already uses -- and codex-process.js takes spawn args as a parameter. So
   * effort is a START-time property of the session, defaulting to the tier's
   * own declared effort, which START_TIERS has carried since the beginning
   * and this path used to read and then drop. */
  const EFFORT_KEYS = new Set(['low', 'medium', 'high', 'xhigh'])
  function resolveEffort(effort, startTier) {
    if (effort === undefined || effort === null || effort === '') return (startTier && startTier.effort) || null
    const key = String(effort).trim()
    if (!EFFORT_KEYS.has(key)) {
      fail('AGENT_EFFORT_UNKNOWN', `Unknown effort "${key}". Available: low, medium, high, xhigh.`)
    }
    return key
  }

  function startSession({ sessionId, cwd, tier, effort } = {}) {
    assertOpen()
    const startTier = resolveStartTier(tier)
    const sessionEffort = resolveEffort(effort, startTier)
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
    /* THE PERSON'S OWN TOOL LIMITS, read per session like the plan is.
     *
     * The hook answers {ok:true, env} — env null when nothing narrows — or
     * {ok:false, code}. A failed read REFUSES the start, for the same reason
     * an unbuildable plan does: the user recorded a narrower surface, and a
     * session that cannot read it must not run at the wider one. The absence
     * of the hook (tests, embedders) narrows nothing. */
    let envExtras = null
    if (sessionEnvironmentExtras) {
      let extrasResult
      try { extrasResult = sessionEnvironmentExtras() } catch { extrasResult = null }
      if (!extrasResult || extrasResult.ok !== true) {
        fail(
          (extrasResult && extrasResult.code) || 'AGENT_TOOL_LIMITS_UNREADABLE',
          'The tool limits recorded for this account could not be read, so this session was not started at a wider surface than was chosen.',
        )
      }
      envExtras = extrasResult.env || null
    }

    const sessionEnv = sessionLaunchEnvironment(
      loadLaunchEnvironment(engineRoot),
      plan,
      { context: 'ToolsEnabled agent session', extras: envExtras },
    )

    const session = {
      sessionId: id,
      cwd: sessionCwd,
      /* The effort this session was spawned with -- the record a probe or a
         later surface reads; never re-derived from the tier, which a model
         override can drift from. */
      effort: sessionEffort,
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
      /* The confinement the session was started under, kept so per-turn
         options are narrowed against the SAME plan — never a re-read that
         could drift from what actually bound the thread. */
      planThreadOptions: plan.threadOptions || null,
    }
    // Reserve before the asynchronous engine start so duplicate starts cannot
    // race and leak a second child process.
    sessions.set(id, session)

    session.startPromise = (async () => {
      try {
        const startedValue = await startCodexSession({
          cwd: sessionCwd,
          clientInfo: CLIENT_INFO,
          // The spawn seam: effort has no protocol field, so it rides the
          // CLI's own config flag on the app-server process itself.
          ...(sessionEffort ? { args: ['app-server', '-c', `model_reasoning_effort=${sessionEffort}`] } : {}),
          // What the OS enforces on the agent process itself. MEASURED against a
          // user config that says danger-full-access: the thread option wins.
          // The chosen model rides in threadOptions, which the adapter already
          // forwards (`['cwd', 'approvalPolicy', 'model', 'serviceTier']`) --
          // no argv change, and `codex app-server` gets told directly. Spread
          // FIRST so the confinement plan always wins: a tier must never be
          // able to widen what the level allows.
          threadOptions: startTier
            ? { ...plan.threadOptions, model: startTier.model }
            : plan.threadOptions,
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

  /* WHAT A RENDERER MAY ASK OF A TURN, and how the plan stays on top.
   *
   * The engine accepts cwd, approvalPolicy, model and serviceTier per turn.
   * Exactly ONE of those is the renderer's to choose: `model`. The other
   * three are refused BY NAME — approvalPolicy and sandbox are the recorded
   * level's ceiling, cwd per-turn would relocate execution outside the
   * workspace root the plan measured, and serviceTier is a billing routing
   * question nobody asked the person. The requested model must be a Codex
   * row of the same START_TIERS table the start channel resolves from, so
   * the two surfaces can never disagree about what is launchable.
   *
   * The plan's own keys are spread LAST, so even a key that slipped past the
   * name check could not override what the plan states. Widening is
   * structurally impossible, not merely checked. */
  const narrowTurn = (plan, requested) => narrowTurnOptions(plan, requested, START_TIERS)

  function boundedTurnImages(images) {
    if (images === undefined || images === null) return []
    if (!Array.isArray(images) || images.length > 8) {
      fail('AGENT_TURN_IMAGES_INVALID', 'A turn carries at most 8 picked images')
    }
    return images.map(image => {
      const path = boundedString(image && image.path, 'image path', 32_768, { allowEmpty: false })
      return { path }
    })
  }

  async function sendTurn({ sessionId, text, images, options } = {}) {
    assertOpen()
    const session = readySession(sessionId)
    const turnText = boundedString(text, 'text', 200_000, { allowEmpty: false })
    const turnImages = boundedTurnImages(images)
    const turnOptions = narrowTurn(session.planThreadOptions, options)
    if (session.sendPromise || session.activeTurnId) {
      fail('AGENT_TURN_ACTIVE', `Session ${session.sessionId} already has an active turn`)
    }

    session.completedDuringSend.clear()
    session.completedWithoutTurnId = false
    const sendPromise = (async () => {
      const result = await session.adapter.sendTurn({
        threadId: session.threadId,
        text: turnText,
        images: turnImages,
        ...(turnOptions ? { options: turnOptions } : {}),
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

  /* REWIND: fork the thread at one of the person's own turns and continue
   * from there. Proven live before this shipped (tools/agent-rewind-probe.mjs
   * 2026-08-14: fork at turn 2 of 3 remembered turns 1-2 and had genuinely
   * forgotten turn 3). The session keeps its child process; only its
   * threadId moves to the fork. A busy session refuses — the person
   * interrupts first, so a rewind can never race the turn it is erasing. */
  async function rewindSession({ sessionId, turnId } = {}) {
    assertOpen()
    const session = readySession(sessionId)
    const rewindTurnId = boundedString(turnId, 'turnId', 512, { allowEmpty: false })
    if (session.sendPromise || session.activeTurnId) {
      fail('AGENT_TURN_ACTIVE', `Session ${session.sessionId} has an active turn; interrupt it before rewinding`)
    }
    const forked = await session.adapter.forkThread(session.threadId, {
      lastTurnId: rewindTurnId,
      cwd: session.cwd,
    })
    if (!forked || typeof forked.threadId !== 'string' || forked.threadId.length === 0) {
      fail('AGENT_ENGINE_INVALID_SESSION', 'thread/fork returned an invalid thread')
    }
    session.threadId = forked.threadId
    session.activeTurnId = null
    return Object.freeze({ sessionId: session.sessionId, threadId: forked.threadId, turnId: rewindTurnId })
  }

  /* THE APPROVAL REPLY PATH. approvalPolicy is 'never' at every tier, so no
   * approval fires today — and that ordering is the point: the confinement
   * module's own comment refused to enable 'on-request' while the host had no
   * way to answer, because the day one fired the turn would hang forever.
   * This is the answer path, landed FIRST. Offering 'on-request' is an
   * install-level settings decision for a later iteration; nothing here
   * widens anything. The decision string is validated by the adapter against
   * the request's own vocabulary. */
  async function answerApproval({ sessionId, approvalId, decision } = {}) {
    assertOpen()
    const session = readySession(sessionId)
    const id = boundedString(approvalId, 'approvalId', 1024, { allowEmpty: false })
    const chosen = boundedString(decision, 'decision', 64, { allowEmpty: false })
    session.adapter.answerApproval({ approvalId: id, response: { decision: chosen } })
    return Object.freeze({ sessionId: session.sessionId, approvalId: id, decision: chosen })
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
    rewindSession,
    answerApproval,
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
module.exports = { AVAILABILITY_CODES, START_REFUSAL_CODES, createAgentHost, engineAvailability, engineCandidates, narrowTurnOptions }
