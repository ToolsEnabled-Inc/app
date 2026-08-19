'use strict'

// This module intentionally has no Electron dependency. It owns Codex session
// lifecycles; shell/main.cjs is only the IPC boundary around it.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
// capability-layer.cjs is itself Electron-free (node:child_process, node:fs,
// node:path only), so requiring it here preserves the property above.
const { resolveCapabilityRoot } = require('./capability-layer.cjs')
/* Per-provider presence, so one provider's missing prerequisite cannot speak
   for the others. Electron-free like this module and like capability-layer. */
const { providerCliPresence } = require('./provider-cli-presence.cjs')

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

/* THE SECOND ENGINE, AND THE REASON THERE WAS ONLY EVER ONE.
 *
 * Until this constant the payload carried a single agent engine, so every
 * non-Codex tier in START_TIERS was refused BY NAME. That refusal was honest --
 * there was genuinely nothing to call -- and it was routinely misread as a
 * policy about Claude. It was not: it was an absence.
 *
 * IT IS NOT claude-process.js AND MUST NEVER BE. That module spawns a
 * third-party wrapper (@agentclientprotocol/claude-agent-acp) onto a throwaway
 * config directory with no login state, which is a licence fence (TE-L-0006)
 * and which means it cannot authenticate at all. Loading it here would trade a
 * clear refusal for a session that always fails to sign in.
 *
 * claude-cli-process.js launches the OFFICIAL binary and overrides no
 * configuration, so the child signs itself in on the person's own subscription
 * exactly as it does in their own terminal. The recorded council reading of
 * TE-L-0006 is that this is first-party use. Nothing in this shell reads,
 * copies or forwards a credential to make it work -- there is nothing to read,
 * which is the point.
 *
 * IT IS OPTIONAL WHERE THE CODEX ONE IS NOT. A build whose payload predates
 * this module keeps working and keeps refusing Claude by name; it does not
 * fail to start, and it does not report itself broken. That is what lets the
 * payload and this shell ship on different days without a dead window in
 * between. */
const PAYLOAD_CLAUDE_ENGINE_MODULE = 'src/lib/agent-engine/claude-cli-process.js'

/* THE TWO MODULES THAT LET ONE AGENT ON THIS COMPUTER WRITE TO ANOTHER.
 *
 * THE OWNER'S FINDING: "This is just the issue with trying to have it reach
 * coordinator through agent comms it didnt work." A child started under a
 * manager on the tree was told its manager's name, handed a messaging tool, and
 * refused every time. The messenger it was handed is CROSS-MACHINE and refuses
 * a local recipient by design; on a one-machine installation that is every
 * recipient it can name.
 *
 * The engine now carries a local sibling, and it needs exactly one thing this
 * process is the only holder of: WHICH SESSION IS WHICH CIRCLE ON THE TREE. The
 * tree lives in the window, the sessions live here, and until now the two never
 * met -- which is the third and least obvious of the three walls.
 *
 * OPTIONAL, LIKE THE CLAUDE ENGINE ABOVE, AND FOR THE SAME REASON. A payload cut
 * before these modules existed keeps starting sessions exactly as it does today
 * and simply carries no local channel. A host that refused to start without them
 * would turn a missing feature into a dead product. */
const PAYLOAD_TREE_DIRECTORY_MODULE = 'src/lib/agent-comms/tree-node-directory.js'
const PAYLOAD_LOCAL_MESSAGE_MODULE = 'src/lib/providers/agent-comms-local.js'

/* WHAT A TREE SESSION IS TOLD ABOUT ITS OWN PLACE, READ BACK OUT.
 *
 * This is a CONTRACT WITH src/tree-node-brief.js, and it is pinned by
 * tools/test/tree-address-contract.test.mjs, which composes a real brief with
 * that module and asserts this expression recovers the two names. Two files
 * agreeing by inspection is how it drifts; a test that runs both is how it does
 * not.
 *
 * WHY THE BRIEF AND NOT THE START REQUEST. The obvious place to carry a node's
 * identity is the start call, and it cannot go there: shell/main.cjs narrows the
 * renderer's start request through parseAgentStart() before this host sees it,
 * and both that file and the view that would have to send it belong to other
 * lanes tonight. The brief already crosses the same boundary, already carries
 * exactly these two names, and is already the thing the person can read on
 * screen -- so the identity travels on the one channel that was never blocked. */
/* THE TRAILING FULL STOP IS NOT PART OF THE MATCH, AND THAT WAS A REAL BUG.
 * A node at the TOP of the tree writes `... you are "X", at the top of your
 * tree.` -- no manager clause, and a comma where an expression anchored on a
 * full stop expected one. So the manager in the owner's own screenshot, the one
 * circle that most needs to be addressable, would never have registered at all
 * while every child registered fine. Found by the contract test running both
 * halves rather than by reading them. */
const TREE_ADDRESS_RE = /^Tree address: you are "([^"\n]{1,120})"(?:, and your manager is "([^"\n]{1,120})")?/m

/* Resolve the Claude engine from the SAME tree the Codex engine came out of.
 *
 * The same rule the confinement and launch-environment modules follow, for the
 * same reason: a session started by one installation's engine and confined by
 * another installation's answer would be two products pretending to be one.
 *
 * IT ANSWERS null RATHER THAN THROWING. Absence is the ordinary case on any
 * build cut before this module existed, and the caller turns a null into the
 * same named refusal Claude tiers have always produced. An exception here would
 * turn "this build cannot start Claude" into "this build cannot start
 * anything", which is a far worse failure and would be caused by the payload
 * being OLDER rather than broken. */
function loadClaudeEngine(engineRoot) {
  if (!engineRoot) return null
  const modulePath = path.join(engineRoot, PAYLOAD_CLAUDE_ENGINE_MODULE)
  try {
    if (!fs.existsSync(modulePath)) return null
    const engine = require(modulePath)
    if (!engine || typeof engine.startClaudeSession !== 'function') return null
    return {
      startClaudeSession: engine.startClaudeSession,
      resumeClaudeSession: typeof engine.resumeClaudeSession === 'function' ? engine.resumeClaudeSession : null,
    }
  } catch {
    /* A payload that cannot load its Claude engine refuses Claude, and still
       starts Codex. Same reason as the null above. */
    return null
  }
}

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
      /* resumeCodexSession is taken when the payload has it and left null
         when it does not: an older pinned engine still starts agents, it
         simply cannot continue a conversation across a restart, and the
         resume path says so rather than crashing on a missing export. */
      return {
        startCodexSession: engine.startCodexSession,
        resumeCodexSession: typeof engine.resumeCodexSession === 'function' ? engine.resumeCodexSession : null,
        engineRoot: engineRootOf(modulePath),
      }
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

    /* THE TWO CHECKS BELOW ARE ABOUT CODEX, AND THEY USED TO REFUSE EVERYTHING.
     *
     * THE DEFECT, MEASURED. On a profile with no ~/.codex/auth.json this
     * function answered {ok:false, AGENT_CONFINEMENT_SIGNED_OUT} and the page
     * offered no start AT ALL -- for every tier, including Claude, which never
     * reads that file. codexCommandIsMissing() above has the same shape. So a
     * person who has installed Claude and signed into it, and has no Codex, is
     * told this copy cannot run an agent. That is the product calling itself
     * broken on a machine that is correctly set up for the thing the owner
     * actually asked for.
     *
     * IT IS ONLY SAFE TO STEP AROUND THEM WHEN A CLAUDE START IS GENUINELY
     * POSSIBLE, and both halves of that are proved rather than assumed:
     *   - the payload really carries the engine (a require() that exports
     *     startClaudeSession -- the same handle resolveStartTier gates on), and
     *   - the `claude` program really resolves on this machine.
     * Neither is a provider name or a flag. If either is missing we fall through
     * to the Codex answers unchanged, which is exactly today's behaviour.
     *
     * IT DOES NOT WEAKEN THE CODEX PATH. A Codex tier still fails at the start
     * on both of these -- startSession builds the confined home and spawns the
     * binary -- and those refusals have their own copy. What changes is only
     * that ONE provider's missing prerequisite no longer speaks for the others.
     *
     * FAIL-CLOSED ON ITS OWN UNCERTAINTY, like every other branch of this
     * function: presence answering 'unknown' is not proof of anything and does
     * NOT open the door. Only a positive 'yes' does. */
    const claudeCouldStart = (() => {
      try {
        if (!loadClaudeEngine(engineRoot)) return false
        const presence = providerCliPresence()
        const claude = presence && presence.providers.find(row => row.id === 'claude')
        return Boolean(claude && claude.installed === 'yes')
      } catch {
        return false
      }
    })()

    /* Before the sign-in, deliberately: `codex login` is a subcommand of this
     * binary, so a machine missing both must be told about the binary first or
     * the instruction it gets cannot be carried out. See codexCommandIsMissing(). */
    if (!claudeCouldStart && codexCommandIsMissing()) {
      fail(
        'AGENT_CODEX_CLI_NOT_INSTALLED',
        'The Codex command-line program is not installed on this computer, so there is nothing for a session to run.',
      )
    }
    if (!claudeCouldStart && confinedSessionIsSignedOut(planner)) {
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

/* WATCH THE ENGINE'S CHILD PROCESS FOR ITS OWN EXIT, so a session whose program
 * has gone away is a fact this shell can state rather than one it infers.
 *
 * WHAT WAS MEASURED BEFORE THIS EXISTED. Neither this file nor shell/main.cjs
 * observed the child's exit at all. The codex adapter turns it into a rejection
 * of whatever was pending (CODEX_APP_SERVER_EXITED) and the Claude adapter
 * rejects the active turn (CLAUDE_CLI_EXITED); if no turn was in flight, an
 * idle child that died left a session in this map, state `ready`, forever. The
 * only shell-visible symptom was the synthetic `turn_completed` with status
 * `failed` that sendTurn() emits when a turn was already announced. So "the
 * child exited" was observable in main.cjs ONLY mid-turn, and only as a failed
 * turn -- which is a fact about a turn, not about the process.
 *
 * THE ENGINE CONTRACT HAS NO EXIT HOOK (engine-contract.js: `{ adapter,
 * threadId, close }`), and the payload is not this shell's to change. What the
 * two vendored engines DO expose, on the adapter each one hands back:
 *
 *   Claude  adapter.transport.child   the ChildProcess itself
 *           (capability/src/lib/agent-engine/claude-cli-process.js,
 *           createClaudeCliTransport returns `{ child, onData, send, ... }`).
 *           ITS onData IS A SINGLE HANDLER SLOT -- calling it would REPLACE the
 *           adapter's own reader and kill the session. So it is never called
 *           here; the child is watched directly.
 *   codex   adapter.transport.onData  a Set of listeners, each delivered
 *           `(null, exitInfo)` exactly once when the child ends, and replayed
 *           to a late subscriber (codex-process.js, createCodexProcessTransport).
 *           It exposes no child. `write` beside it is what tells the two shapes
 *           apart, because a Claude transport has `send`.
 *
 * Both shapes are pinned by tools/test/agent-session-end-record.test.mjs against
 * the vendored transports themselves, spawning a real process, so a payload
 * that changes either handle goes red there rather than going quiet here.
 *
 * IT NEVER THROWS AND IT NEVER SPEAKS FOR AN ENGINE THAT EXPOSES NEITHER. Every
 * test fixture engine and any future engine without a recognisable handle gets
 * `null` back and is left exactly as it was: a session whose exit this shell
 * cannot see is a session whose exit is not recorded, which reads downstream as
 * "does not say" -- never as an ending it did not observe.
 *
 * Returns which handle it attached to ('child' | 'transport') or null. Exported
 * for the test; the host calls it from startSession(). */
function observeEngineExit(startedValue, onExit) {
  try {
    const transport = startedValue && startedValue.adapter && startedValue.adapter.transport
    if (!transport || typeof transport !== 'object') return null
    let reported = false
    const report = (exit) => {
      if (reported) return
      reported = true
      try { onExit(exit) } catch { /* an observer fault must not reach the engine's stream */ }
    }
    const child = transport.child
    if (child && typeof child.once === 'function') {
      /* Already gone before we looked: say so, once, on the next tick, the same
         way the codex transport replays an exit to a late subscriber. */
      const alreadyExited = (child.exitCode !== null && child.exitCode !== undefined) || Boolean(child.signalCode)
      if (alreadyExited) {
        queueMicrotask(() => report({ code: child.exitCode ?? null, signal: child.signalCode ?? null }))
      } else {
        child.once('exit', (code, signal) => report({ code, signal }))
      }
      return 'child'
    }
    if (typeof transport.onData === 'function' && typeof transport.write === 'function') {
      transport.onData((_chunk, exitInfo) => {
        if (!exitInfo) return
        report({
          code: Number.isInteger(exitInfo.code) ? exitInfo.code : null,
          signal: typeof exitInfo.signal === 'string' ? exitInfo.signal : null,
        })
      })
      return 'transport'
    }
    return null
  } catch {
    return null
  }
}

/* THE CONFINEMENT A SESSION RUNS UNDER, ASKED PER PROVIDER.
 *
 * WHAT WAS MEASURED, and it is the owner's own requirement failing. With Claude
 * signed in and NO Codex sign-in on the machine, pressing Start was refused with
 * "Codex is installed on this computer, but nobody is signed in to it ... run
 * codex login" -- for a Claude tier, on a build carrying the Claude engine. The
 * refusal was honest about what it found and wrong about what it meant: nothing
 * on the Claude path reads ~/.codex/auth.json.
 *
 * WHY IT HAPPENED. Every permission level in the payload's
 * INSTALL_TIER_AGENT_CONFINEMENT is `isolated: true`, and confinedSessionPlan()
 * answers an isolated level by building an isolated CODEX home -- mkdir, link the
 * user's Codex credential, write config.toml. linkCredential() refuses when there
 * is no auth.json to link, which is correct for Codex and is the whole plan for
 * every provider, because that function predates there being a second one. So a
 * Claude subscriber was gated on a Codex account to use their own subscription.
 *
 * WHAT A CLAUDE SESSION ACTUALLY NEEDS OUT OF THE PLAN, read from the engine
 * rather than assumed: claudeArgs() in capability/src/lib/agent-engine/
 * claude-cli-adapter.js consumes exactly two keys -- `threadOptions.sandbox`,
 * which it maps to --permission-mode (read-only -> plan, workspace-write ->
 * acceptEdits, danger-full-access -> bypassPermissions, unknown -> plan), and
 * `threadOptions.model`. It reads no environment we set: CODEX_HOME means
 * nothing to it. So the ceiling a person chose is carried in full by
 * resolveAgentConfinement(), which reads the recorded level and touches no
 * credential and no home directory.
 *
 * THIS DOES NOT WIDEN ANYTHING, and that is checkable rather than promised. On
 * the path this changes, plan.env only ever carried CODEX_HOME, which the Claude
 * child ignores -- so the same session reaches exactly what it reached before.
 * What it stops doing is REFUSING on a file it never opens. The scrub still
 * applies: sessionLaunchEnvironment() runs safeLaunchEnvironment() on every
 * branch, so ANTHROPIC_API_KEY and the endpoint redirectors are still removed,
 * which is the whole mechanism that keeps the session on the person's own
 * subscription.
 *
 * IT FAILS CLOSED THE SAME WAY THE PAYLOAD DOES. resolveAgentConfinement() never
 * throws: an unreadable or absent record resolves to the most restrictive level
 * and says so. If the payload predates that export, this falls back to
 * confinedSessionPlan() -- today's behaviour, Codex credential and all -- rather
 * than starting a session at a level nobody resolved.
 *
 * THE CODEX PATH IS UNTOUCHED. provider 'codex' (and an absent tier, which is
 * the agent page's own start) goes through confinedSessionPlan() exactly as
 * before, including its refusal when the Codex credential is missing. */
/* `account` is what the payload's rotation module chose, or null.
 *
 * NULL IS THE ORDINARY CASE and takes the path this function already took,
 * unchanged. A computer with no account list must not be able to tell that any
 * of this shipped, so "no account" is not a branch with its own behaviour -- it
 * is the absence of an argument. */
/* Resolve the local-message pair out of the engine tree, or answer null.
 *
 * BOTH OR NEITHER. The directory without the provider is an address book with
 * nothing to send through; the provider without the directory has nothing to
 * address. Loading one of the two would produce a session that registers itself
 * as reachable and then cannot be reached, which is worse than no channel at
 * all -- the person would see a manager listed and never get an answer. */
function loadTreeMessaging(engineRoot) {
  const directoryPath = path.join(engineRoot, PAYLOAD_TREE_DIRECTORY_MODULE)
  const providerPath = path.join(engineRoot, PAYLOAD_LOCAL_MESSAGE_MODULE)
  if (!fs.existsSync(directoryPath) || !fs.existsSync(providerPath)) return null
  try {
    const directoryModule = require(directoryPath)
    const provider = require(providerPath)
    if (typeof directoryModule.createTreeNodeDirectory !== 'function'
      || typeof provider.inbox !== 'function') return null
    return { directory: directoryModule.createTreeNodeDirectory(), provider }
  } catch {
    /* A payload whose local-message modules do not load is a payload with no
       local channel, and that is all it is. It must not stop a session from
       starting: the channel is an addition to what an agent can do, never a
       precondition for it running at all. */
    return null
  }
}

function confinementPlanFor(planner, { provider = 'codex', account = null } = {}) {
  if (provider === 'codex' || typeof planner.resolveAgentConfinement !== 'function') {
    /* The account reaches the Codex plan because that is where it MEANS
       something: it says which of the person's own signed-in homes the
       credential is linked from, and gives that account a confined home of its
       own so two sessions cannot re-sign each other. A payload that predates
       the option ignores the extra key, which is the same fail-closed shape
       every other option here has. */
    return planner.confinedSessionPlan(account ? { account } : {})
  }
  const resolved = planner.resolveAgentConfinement({})
  if (!resolved || typeof resolved !== 'object') {
    return { ok: false, code: 'AGENT_CONFINEMENT_UNAVAILABLE' }
  }
  return Object.freeze({
    ok: true,
    tier: resolved.tier,
    code: resolved.code,
    failedClosed: resolved.failedClosed === true,
    /* The level is still isolated -- that is what the record says and what the
       sandbox word below enforces. What is not built is the CODEX home, because
       this session is not a Codex session. */
    isolated: resolved.isolated === true,
    threadOptions: Object.freeze({ sandbox: resolved.sandbox, approvalPolicy: resolved.approvalPolicy }),
    /* STILL NULL, AND THAT IS NOT AN OVERSIGHT. `plan.env` is layered over the
       scrubbed environment, and the Claude engine does not read an environment
       variable to find its sign-in -- it is handed the folder as an argument
       (`configDir`). Putting the same fact in two places would create two ways
       for a session to disagree with itself about whose account it is on. */
    env: null,
    codexHome: null,
    servers: Object.freeze([]),
    account: account ? account.name : null,
    /* The one thing the Claude path needs the account FOR, carried on the plan
       so the start has a single object to read rather than two. */
    configDir: account ? account.resolvedHome : null,
  })
}

/* `accountResolver` answers WHICH of the person's own provider sign-ins this
 * session runs on. It is an async function of `{ provider }` returning the
 * payload rotation module's record, or null.
 *
 * OPTIONAL, AND ITS ABSENCE IS THE BEHAVIOUR THAT SHIPPED BEFORE IT. A host
 * built without one -- every test, every embedder -- plans exactly as it always
 * did. It is a constructor option rather than something this file resolves for
 * itself because the account list is the MAIN process's business: it lives
 * beside the machine record, the accounts page writes it, and a host that went
 * looking for it would be a second reader that could answer differently from
 * the surface the person is looking at. */
function createAgentHost({ enginePath, defaultCwd = process.cwd(), confinementPlanner = null, sessionEnvironmentExtras = null, accountResolver = null } = {}) {
  const { startCodexSession, resumeCodexSession, engineRoot } = loadEngine(enginePath)
  /* Loaded ONCE beside the Codex engine, and allowed to be absent. See the note
     above loadClaudeEngine(): a payload cut before that module existed keeps
     starting Codex and keeps refusing Claude by name, rather than failing to
     start anything. */
  const claudeEngine = loadClaudeEngine(engineRoot)
  const fallbackCwd = normalizeCwd(defaultCwd, process.cwd())
  /* Resolved PER SESSION rather than once here, so that changing the permission
   * level takes effect on the next agent the user starts instead of on the next
   * time they restart the application. "You can change it later" is what the
   * first-run screen promises; a ceiling cached at construction would make that
   * promise true only after a relaunch. */
  const planConfinement = confinementPlanner
    || ((options = {}) => confinementPlanFor(loadConfinementPlanner(engineRoot), options))
  const sessions = new Map()
  const listeners = new Set()
  /* Who wants to know when a session's child ends on its own. Kept apart from
     `listeners` on purpose: those receive the engine's protocol events and are
     forwarded to the renderer packet for packet, and a process ending is not a
     protocol event -- it is a fact about this computer that the main process
     records whether or not a window is open to hear it. */
  const exitListeners = new Set()
  let closed = false

  /* ------------------------------------------------------------------ *
   * THE LOCAL CHANNEL: one agent on this computer writing to another.
   *
   * WHAT THIS BLOCK IS AND IS NOT. It is not a messenger -- the engine's
   * agent-comms fabric is, and it was already built, already durable, and
   * already opened no socket. This is the two things only the main process
   * knows: WHICH RUNNING SESSION IS WHICH CIRCLE on the person's tree, and WHEN
   * a message that arrived for one of them should be put in front of it.
   *
   * DELIVERY IS A TURN, AND THAT IS THE ONLY HONEST SHAPE. An agent is not a
   * mailbox that can be topped up between thoughts; it takes turns. So an
   * arriving message becomes a turn addressed to the receiving agent, exactly
   * as if the person had typed it, and the receiving agent may answer it by
   * calling the same tool back. Both halves land in both transcripts.
   *
   * AND IT WAITS ITS TURN. sendTurn() refuses an overlapping turn by name
   * (AGENT_TURN_ACTIVE), correctly -- so an arriving message queues while the
   * receiver is busy and goes in at the next boundary, rather than being
   * dropped or crashing a turn the person is watching.
   * ------------------------------------------------------------------ */
  const treeMessaging = loadTreeMessaging(engineRoot)
  const TREE_POLL_MS = 1200
  const TREE_HEARTBEAT_MS = 30_000
  let treePollTimer = null

  /* A session announces itself the first time it is told who it is, which is
     the first turn it is ever sent -- the brief. Registration is deliberately
     NOT part of startSession(): a session that is started and never briefed has
     no place on the tree and must not be addressable as though it had one. */
  function registerTreeSession(session, text) {
    if (!treeMessaging || session.treeAddress) return
    const match = TREE_ADDRESS_RE.exec(String(text || ''))
    if (!match) return
    const selfName = match[1]
    const managerName = match[2] || null
    try {
      const entry = treeMessaging.directory.registerNode({
        sessionId: session.sessionId,
        nodeName: selfName,
        managerName,
        pid: process.pid,
      })
      session.treeAddress = Object.freeze({ agentId: entry.agentId, selfName, managerName })
      session.treeCursor = 0
      session.treeQueue = []
      session.treeBeatAt = Date.now()
      startTreePolling()
    } catch {
      /* A name this directory will not hold -- empty, over-long, control
         characters -- is a session with no local address, not a session that
         cannot run. The refusal it produces later names the node honestly. */
    }
  }

  function forgetTreeSession(session) {
    if (!treeMessaging || !session.treeAddress) return
    try { treeMessaging.directory.unregisterNode({ sessionId: session.sessionId }) } catch { /* the sweep clears it */ }
    session.treeAddress = null
  }

  /* WHAT ARRIVED, PUT WHERE THE PERSON CAN SEE IT.
   *
   * The event is shaped as the engine's own assistant text so it reaches the
   * transcript through the mapping the renderer already has. That is a
   * compromise and it is stated rather than hidden: this line is not the
   * receiving model speaking, it is what was said TO it, and the only reader
   * the transcript offers today is `assistant_text_delta`
   * (src/agent-session-events.js). It is prefixed with the sender's circle
   * name by the engine provider, so what appears on screen reads as
   * "Default: ..." and a person can tell who wrote it. Giving it its own event
   * type needs the renderer's reader, which another lane holds tonight. */
  function showIncoming(session, text) {
    emit(session, Object.freeze({
      type: 'assistant_text_delta',
      text: `\n${text}\n`,
    }))
  }

  /* Whose circle a durable fabric id belongs to, for the sentence below. A
     sender that has since stopped still resolves, because the directory keeps
     a stopped node's row rather than deleting it. */
  function treeSenderName(agentId) {
    if (!treeMessaging || !agentId) return null
    try {
      const node = treeMessaging.directory.listNodes().find((entry) => entry.agentId === agentId)
      return node ? node.nodeName : null
    } catch { return null }
  }

  /* AN ARRIVING MESSAGE MUST SAY HOW TO ANSWER IT, and this was measured, not
   * guessed. On the first driven two-node run after delivery worked, the child's
   * question arrived in the manager's session as a bare turn -- exactly as if
   * the person had typed it -- and the manager did the natural thing: it
   * answered IN ITS TRANSCRIPT. The answer was correct, on screen, and
   * unreachable, because a transcript is a report to the person, not a message
   * to the asker. The channel worked and the conversation still failed.
   *
   * So the injected turn carries two sentences after the message: what this is,
   * and how to answer it. That keeps the decision with the model -- it may
   * judge that no reply is needed -- while removing the trap where the reply it
   * meant to send lands somewhere the sender will never look. */
  function framedIncomingTurn(session, senderName, body) {
    if (!senderName) return body
    const self = session.treeAddress ? session.treeAddress.selfName : 'you'
    return `${body}\n\nThat message arrived from ${senderName} over this computer's agent tree. What you write here is your report to the person, and ${senderName} will not see it: to answer ${senderName}, call agent_comms.send_local with from "${self}" and to "${senderName}".`
  }

  async function pumpTreeSession(session) {
    if (!treeMessaging || !session.treeAddress || session.state !== 'ready') return
    const now = Date.now()
    if (now - (session.treeBeatAt || 0) >= TREE_HEARTBEAT_MS) {
      session.treeBeatAt = now
      try { treeMessaging.directory.heartbeatNode({ sessionId: session.sessionId }) } catch { /* next beat */ }
    }
    try {
      const { page } = await treeMessaging.provider.inbox({
        agentId: session.treeAddress.agentId,
        cursor: session.treeCursor || 0,
        limit: 10,
      })
      for (const record of (page && page.records) || []) {
        const message = record && record.message
        const body = message && typeof message.body === 'string' ? message.body : null
        if (body) {
          showIncoming(session, body)
          session.treeQueue.push(framedIncomingTurn(session, treeSenderName(message.sender && message.sender.agentId), body))
        }
        if (Number.isFinite(record.sequence)) session.treeCursor = record.sequence
      }
    } catch {
      /* A durable read that fails is retried on the next tick. It is never
         reported as an empty inbox, which would silently lose a message. */
    }
    if (session.treeQueue.length === 0) return
    if (session.sendPromise || session.activeTurnId) return
    const next = session.treeQueue.shift()
    try {
      await sendTurn({ sessionId: session.sessionId, text: next })
    } catch (error) {
      /* Put it back unless the session itself is gone. A message that could not
         be handed over because the receiver was mid-turn must not evaporate. */
      if (!error || error.code === 'AGENT_TURN_ACTIVE') session.treeQueue.unshift(next)
    }
  }

  function startTreePolling() {
    if (treePollTimer || closed) return
    treePollTimer = setInterval(() => {
      for (const session of [...sessions.values()]) {
        pumpTreeSession(session).catch(() => { /* one session's failure is not another's */ })
      }
    }, TREE_POLL_MS)
    /* NEVER HOLD THE PROCESS OPEN. This is a background courier, not work the
       application owes anybody; an app whose only remaining reason to live is a
       poll loop should exit. */
    if (typeof treePollTimer.unref === 'function') treePollTimer.unref()
  }

  function stopTreePolling() {
    if (!treePollTimer) return
    clearInterval(treePollTimer)
    treePollTimer = null
  }

  /* A TURN IS UNDER WAY, ANNOUNCED BY THE TURN'S OWN FIRST EVENT.
   *
   * MEASURED 2026-08-17, one host, two engines, the same question, the order
   * in which this host's own listener saw things:
   *
   *   codex  luna           sendTurn() resolved at +3ms, first delta at +33.8s
   *                         RESOLVED -> delta -> usage -> turn_completed
   *   claude claude-sonnet  sendTurn() resolved at +3884ms, first delta +3867ms
   *                         delta -> usage -> turn_completed -> RESOLVED
   *
   * The codex adapter answers `turn/start`, which is an ACKNOWLEDGEMENT, so its
   * promise settles when the turn BEGINS. The Claude CLI has no acknowledgement
   * to answer with -- its adapter resolves the turn from the `result` packet --
   * so its promise settles when the turn is ALREADY OVER, strictly after this
   * host has emitted that turn's text, its usage and its completion.
   *
   * Everything above this host was written against the first shape, because for
   * one engine it was the only shape there was: a caller sends, is told the turn
   * started, and only then binds its surface to the session. On the Claude path
   * that binding happened after the whole turn had already been delivered, so
   * the fleet tree dropped every packet of it by the session filter and left the
   * node at `running` with an empty reply and no error -- for as long as anyone
   * was willing to wait. drainOutboxMessage() has the same shape for every
   * follow-up turn, and interrupt() waits on the send promise, so a Claude turn
   * could not be stopped either.
   *
   * FIXING IT HERE RATHER THAN AT EACH CALLER IS THE POINT OF THIS FILE. This
   * host is what promises the two engines are interchangeable to everything
   * above it (see sessionHandle() in the engine, and startSession() below). A
   * promise that means "the turn started" for one engine and "the turn ended"
   * for the other is that promise being broken, and repairing it at five call
   * sites would be five chances to miss one.
   *
   * THE ANNOUNCEMENT IS THE ENGINE'S OWN WORD, NOT A GUESS. It is the turnId the
   * engine put on the first event it emitted for the turn -- no timer decides
   * anything, and nothing is invented. For an engine that acknowledges first the
   * announcement never wins the race in sendTurn(), so the codex path behaves
   * exactly as it did. */
  function announceTurn(session, turnId) {
    const pending = session.turnAnnounce
    if (!pending) return
    session.turnAnnounce = null
    pending.resolve(turnId)
  }

  function emit(session, event) {
    if (sessions.get(session.sessionId) !== session) return

    /* BEFORE the completion bookkeeping below, so a turn whose FIRST event is
       already its completion is announced and then immediately recorded as
       completed-during-send, which is the state that pair was built for. */
    if (event && typeof event.turnId === 'string' && event.turnId.length > 0 && event.turnId.length <= 512) {
      announceTurn(session, event.turnId)
    }

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
      /* Off the tree the moment the session is really gone, so a sibling
         addressing it is told "its session has stopped" rather than being told
         the message was delivered to something that will never read it. */
      forgetTreeSession(session)
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
    /* THE GATE OPENS ON THE ENGINE BEING THERE, NEVER ON THE NAME OF A PROVIDER.
     *
     * `claudeEngine` is not a flag, a version string or a configuration value.
     * It is the result of resolving a file inside THIS installation's payload,
     * require()ing it, and confirming it exports startClaudeSession -- see
     * loadClaudeEngine(). So the only thing that opens this gate is a build that
     * genuinely carries the module.
     *
     * WHY THAT DISTINCTION IS THE WHOLE SAFETY OF THIS CHANGE. A gate that
     * opened because somebody typed "claude", or because a tier table listed the
     * provider, would let a person press Start on a build with nothing behind it
     * and get a crash instead of a sentence. A tier that half-starts is worse
     * for them than one that refuses honestly, because a refusal tells them
     * where they are and a crash does not.
     *
     * A build cut before the module existed therefore still refuses, with the
     * same code and the same copy it has always used. Nothing about this change
     * makes an older payload report itself broken. */
    if (row.provider === 'claude' && claudeEngine) return row
    if (row.provider !== 'codex') {
      const startable = Object.keys(START_TIERS)
        .filter(id => START_TIERS[id].provider === 'codex' || (START_TIERS[id].provider === 'claude' && claudeEngine))
      fail('AGENT_TIER_NO_LAUNCHER',
        `The ${tier} tier runs on ${row.provider}, and this copy carries no launcher for it. `
        + `Startable tiers: ${startable.join(', ')}.`)
    }
    return row
  }

  /* EFFORT, BOUND AT SPAWN AND CHANGEABLE AFTERWARDS.
   *
   * CORRECTED 2026-08-16, because what stood here was wrong and expensive.
   * It said "the codex app-server protocol has no per-turn or per-thread
   * effort field ... upstream offers nothing to map to". Upstream offers
   * both: `turn/start` takes `effort`, and `thread/settings/update` exists
   * to "override the reasoning effort for subsequent turns". Our own
   * adapter allowlists were what excluded them, and the method refuses
   * unless `initialize` declares the experimentalApi capability -- which we
   * never declared. On that false premise the product told the owner that
   * changing depth mid-conversation required restarting the agent, and
   * charged him the tokens to re-read the conversation. The adapter now
   * declares the capability and exposes updateThreadSettings.
   *
   * The spawn flag stays: `-c model_reasoning_effort=<key>` is what sets a
   * NEW thread's depth, proven to land (config/read and thread/start both
   * report it back). The values are the provider's own, and the closed set
   * is load-bearing because codex accepts an unknown value silently -- it
   * took `banana` and echoed it back. `ultra` is here because it is the
   * provider's switch for automatic task delegation, not a bigger number. */
  const EFFORT_KEYS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'])
  function resolveEffort(effort, startTier) {
    if (effort === undefined || effort === null || effort === '') return (startTier && startTier.effort) || null
    const key = String(effort).trim()
    if (!EFFORT_KEYS.has(key)) {
      fail('AGENT_EFFORT_UNKNOWN', `Unknown effort "${key}". Available: ${[...EFFORT_KEYS].join(', ')}.`)
    }
    return key
  }

  /* RESUME IS THE SAME START, CONTINUING A THREAD.
   *
   * It is a branch here rather than its own function on purpose: every
   * refusal above the engine call — the tier, the effort, the confinement
   * plan, the tool limits, the scrubbed environment — must apply to a
   * resumed agent exactly as it applies to a new one, in the same order,
   * with the same codes. A parallel resumeSession() would be a second copy
   * of that ladder, and a second copy is one that drifts: the day a new
   * refusal is added to one, the other quietly re-opens the hole. So the
   * ONLY thing resuming changes is which engine call is made.
   */
  function startSession({ sessionId, cwd, tier, effort, resumeThreadId = null } = {}) {
    assertOpen()
    const startTier = resolveStartTier(tier)
    const sessionEffort = resolveEffort(effort, startTier)
    if (resumeThreadId !== null && resumeThreadId !== undefined) {
      if (typeof resumeThreadId !== 'string' || resumeThreadId.length === 0 || resumeThreadId.length > 512) {
        fail('AGENT_RESUME_INVALID_THREAD', 'A resume needs the thread id of the conversation to continue.')
      }
      if (typeof resumeCodexSession !== 'function') {
        fail('AGENT_RESUME_UNSUPPORTED', 'This build\'s engine cannot continue a past conversation. Start a fresh agent instead.')
      }
    }
    const resumeId = resumeThreadId || null
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
    /* THE PROVIDER THIS SESSION IS ABOUT TO RUN ON, not a default. An absent
     * tier is the agent page's own start, which is Codex, so it keeps the Codex
     * plan -- the tier is the only thing that can move it off that. See
     * confinementPlanFor(): a Claude tier is no longer gated on a Codex
     * credential it never reads. */
    const sessionProvider = (startTier && startTier.provider) || 'codex'

    /* THE RECORDED LEVEL, BINDING THIS SESSION -- RESOLVED SYNCHRONOUSLY, AND
     * THE TIMING IS THE SECURITY PROPERTY.
     *
     * `plan.ok === false` means the level was resolved but the confinement it
     * requires could not be built. That REFUSES the start. The alternative --
     * starting anyway with the process sandbox but the user's own MCP servers --
     * is the shape that has cost this project three separate findings: a missing
     * security input treated as consent.
     *
     * IT IS PLANNED WITHOUT AN ACCOUNT FIRST, AND THAT IS DELIBERATE. An earlier
     * version of this change moved the whole plan into the asynchronous start so
     * the chosen account could arrive before it. That turned FIVE refusals from
     * throws into rejections -- an unbuildable confinement, a missing enforcement
     * module, a missing or wrong-shaped launch-environment module, and an account
     * pin that reintroduced a credential after the scrub. Their suites caught it
     * ("Missing expected exception"), which is the only reason it is not in this
     * file. Every one of those is a refusal a caller must receive BEFORE it holds
     * anything it could mistake for a running agent, and none of them depends on
     * WHICH account was picked -- so none of them has any business waiting for an
     * answer that takes a child process to obtain. */
    const basePlan = planConfinement({ provider: sessionProvider })
    if (!basePlan || basePlan.ok !== true) {
      fail(
        (basePlan && basePlan.code) || 'AGENT_CONFINEMENT_UNAVAILABLE',
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

    /* Built here for the same reason the plan is: assertNoBillingCredentials()
       runs inside this call, and a credential that survived the scrub must be a
       refusal the caller receives immediately, not one that arrives later. */
    const baseEnv = sessionLaunchEnvironment(
      loadLaunchEnvironment(engineRoot),
      basePlan,
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
      /* The send in flight, waiting to be told the turn is under way. Held on
         the session because emit() is what learns it, from the engine's own
         first event for that turn. See announceTurn(). */
      turnAnnounce: null,
      completedDuringSend: new Set(),
      completedWithoutTurnId: false,
      startPromise: null,
      /* The confinement the session was started under, kept so per-turn
         options are narrowed against the SAME plan — never a re-read that
         could drift from what actually bound the thread. Filled in below, as
         could drift from what actually bound the thread. Re-pointed below if an
         account is chosen, which happens strictly before any turn can be sent. */
      planThreadOptions: basePlan.threadOptions || null,
    }
    // Reserve before the asynchronous engine start so duplicate starts cannot
    // race and leak a second child process.
    sessions.set(id, session)

    session.startPromise = (async () => {
      try {
        /* WHOSE SIGN-IN THIS SESSION RUNS ON, resolved before anything is planned
         * and before anything is spawned.
         *
         * IT IS ASKED HERE, INSIDE THE START, BECAUSE THE ANSWER TAKES TIME. The
         * resolver asks the provider's own free account surface which of the
         * accounts can serve, which is a real child process and cannot be done in
         * a synchronous constructor. Everything above this line still refuses
         * synchronously; what moved is the plan, which now depends on the answer.
         *
         * IT NEVER RAISES. A resolver that throws, or that is absent, answers
         * null, and null is the path this host took before any of this existed --
         * the whole promise of the feature is that a person who has one sign-in
         * cannot tell it shipped.
         *
         * A BLOCKED ANSWER IS A REFUSAL WITH A NEXT STEP, not a silent switch.
         * That is the "stop and let me switch" setting doing what it says: the
         * account is spent, the person asked to be the one who decides, so the
         * start stops and says which account is spent and which one is ready. */
        /* WHOSE SIGN-IN THIS SESSION RUNS ON.
         *
         * ASKED HERE BECAUSE THE ANSWER COSTS A CHILD PROCESS. The resolver asks
         * the provider's own free account surface which accounts can serve, which
         * cannot be done in the synchronous section above. What IS above is every
         * refusal that does not depend on the answer, so nothing security-shaped
         * waits on this.
         *
         * IT NEVER RAISES. A resolver that throws, or that is absent, answers null,
         * and null keeps the plan already built -- the exact path this host took
         * before any of this existed. A person with one sign-in cannot tell this
         * shipped.
         *
         * A BLOCKED ANSWER IS A REFUSAL WITH A NEXT STEP, not a silent switch. That
         * is the "stop and let me switch" setting doing what it says: the account
         * is spent, the person asked to be the one who decides, so the start stops
         * and names which account is spent and which is ready.
         *
         * ONE KNOWN ORDERING CONSEQUENCE, STATED RATHER THAN DISCOVERED LATER: the
         * base plan above links the credential from the DEFAULT home, so a machine
         * whose default home is signed out still refuses at that point even if a
         * registered account is signed in. Rotation cannot rescue that case, and
         * making it able to would mean deferring the sign-out refusal -- trading a
         * narrow, loud, correct refusal for a late one. */
        let plan = basePlan
        let sessionEnv = baseEnv
        if (accountResolver) {
          let resolvedAccount = null
          try { resolvedAccount = await accountResolver({ provider: sessionProvider }) } catch { resolvedAccount = null }
          if (resolvedAccount && resolvedAccount.blocked === true) {
            fail(
              resolvedAccount.code || 'AGENT_ACCOUNT_UNAVAILABLE',
              resolvedAccount.reason || 'No account on this computer can run right now, so this session was not started.',
            )
          }
          const account = (resolvedAccount && resolvedAccount.rotated === true && resolvedAccount.account) || null
          if (account) {
            /* Re-planned rather than patched: the account changes which home the
               credential is linked FROM and gives that account its own confined
               home, and both of those are decisions the planner makes. */
            const pinned = planConfinement({ provider: sessionProvider, account })
            if (!pinned || pinned.ok !== true) {
              fail(
                (pinned && pinned.code) || 'AGENT_CONFINEMENT_UNAVAILABLE',
                'This session could not be confined to the permission level recorded on this computer, so it was not started.',
              )
            }
            plan = pinned
            session.planThreadOptions = plan.threadOptions || null
            sessionEnv = sessionLaunchEnvironment(
              loadLaunchEnvironment(engineRoot),
              plan,
              { context: 'ToolsEnabled agent session', extras: envExtras },
            )
          }
        }
        /* One shape of arguments, two engine calls. resumeCodexSession
           continues the named thread instead of opening a new one — routing
           a resume through the start would materialise a throwaway thread
           on disk first, so this is not a flag on the other call. */
        /* WHICH ENGINE, decided from the tier the person picked and from
         * nothing else. `claudeEngine` is only ever non-null when this
         * installation's payload really carries the module, and resolveStartTier
         * has already refused a Claude tier when it does not -- so by here the
         * branch cannot select an engine that is not present.
         *
         * The two engines take the SAME arguments on purpose. That is the whole
         * value of engine-contract.js: the confinement plan, the scrubbed
         * environment, the working directory and the event callback are computed
         * once, above, and neither engine gets a private path through this
         * function where a refusal could be skipped. */
        const useClaude = startTier && startTier.provider === 'claude'
        const engineStart = useClaude
          ? (resumeId && claudeEngine.resumeClaudeSession
            ? (request) => claudeEngine.resumeClaudeSession({ ...request, threadId: resumeId })
            : claudeEngine.startClaudeSession)
          : (resumeId
            ? (request) => resumeCodexSession({ ...request, threadId: resumeId })
            : startCodexSession)
        const startedValue = await engineStart({
          cwd: sessionCwd,
          clientInfo: CLIENT_INFO,
          // The spawn seam: effort has no protocol field, so it rides the
          // CLI's own config flag on the app-server process itself.
          //
          // CODEX ONLY, and not because Claude has no notion of effort -- it has
          // `--effort` -- but because `app-server` is a codex subcommand and
          // this argv is codex's. The Claude engine builds its own argv from the
          // same threadOptions below. Handing these strings to it would spawn a
          // program with flags it does not have.
          ...(sessionEffort && !useClaude ? { args: ['app-server', '-c', `model_reasoning_effort=${sessionEffort}`] } : {}),
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
          // level. Since engine f1cc018 (payload pin flip 2026-08-14),
          // `unrestricted` is ALSO redirected to a prepared Codex home
          // carrying the full generated tool surface -- capability parity
          // with the confined tiers, after the measured inversion where the
          // most-trusted tier was the only one with no browser tools. What
          // it still means: sandbox danger-full-access, the widest reach the
          // engine offers; isolation is about whose home, not about reach.
          env: sessionEnv,
          /* WHICH SIGN-IN, for the engine that takes it as an argument rather
             than as an environment variable. Omitted entirely when no account
             was chosen, so the child signs itself in exactly as it does in the
             person's own terminal -- the path that is proven to work. */
          ...(useClaude && plan.configDir ? { configDir: plan.configDir } : {}),
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
        /* THE CHILD'S OWN EXIT, watched from here on. Reported ONLY while this
           session is still the one in the map AND nobody asked for it to close:
           an exit that follows closeSession()/closeAll() is the close, and the
           caller already knows about that ending. See observeEngineExit(). */
        observeEngineExit(started, (exit) => {
          if (sessions.get(id) !== session || session.closeRequested) return
          const report = Object.freeze({ sessionId: id, exit: Object.freeze({ code: exit.code ?? null, signal: exit.signal ?? null }) })
          for (const listener of [...exitListeners]) {
            try { listener(report) } catch { /* a listener fault is not the engine's */ }
          }
        })
        /* WHAT THE ENGINE SAYS, not what we asked for. A resumed thread
           reports the conversation it restored and the settings it really
           holds; those are the only honest source for "how hard is this
           agent thinking" and for re-rendering the history. */
        if (resumeId) {
          session.resumed = Object.freeze({
            turns: Array.isArray(startedValue.turns) ? startedValue.turns : [],
            turnCount: Number.isFinite(startedValue.turnCount) ? startedValue.turnCount : 0,
            threadCwd: typeof startedValue.threadCwd === 'string' ? startedValue.threadCwd : null,
          })
          if (typeof startedValue.reasoningEffort === 'string' && startedValue.reasoningEffort) {
            session.effort = startedValue.reasoningEffort
          }
          if (typeof startedValue.model === 'string' && startedValue.model) session.model = startedValue.model
        }

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
        return Object.freeze({
          sessionId: id,
          threadId: session.threadId,
          tier: plan.tier,
          effort: session.effort,
          /* WHICH ACCOUNT SERVED, reported from the plan that actually bound the
             session rather than re-read afterwards. A name, never a credential,
             and null on a computer with one sign-in. */
          account: plan.account || null,
          ...(session.resumed ? { resumed: session.resumed } : {}),
        })
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

    /* THE FIRST TURN A TREE SESSION IS SENT IS ITS BRIEF, and the brief is the
       only place its place on the tree is written down. Reading it here, rather
       than at start, means a session is addressable from the moment it knows
       who it is and never before. A turn that carries no tree address -- every
       agent started from the single-agent page, every later turn on a tree
       session -- passes through untouched. */
    registerTreeSession(session, turnText)

    /* THIS RESOLVES WHEN THE TURN IS UNDER WAY, NEVER WHEN IT IS OVER. See
       announceTurn() above for the measurement that made the difference matter.
       Whichever of the two the engine offers first wins:

         the adapter's own acknowledgement   (codex: `turn/start`, immediate)
         the turn's first event              (claude: the first delta it emits)

       Both carry the same thing -- the id of the turn that just started -- so
       the caller gets one answer of one shape from either engine. */
    let announce = null
    const announced = new Promise(resolve => { announce = { resolve } })
    session.turnAnnounce = announce

    /* Asked ONCE, before the race, so no branch below can send a second turn. */
    const acknowledged = session.adapter.sendTurn({
      threadId: session.threadId,
      text: turnText,
      images: turnImages,
      ...(turnOptions ? { options: turnOptions } : {}),
    })

    const sendPromise = (async () => {
      const turnId = await Promise.race([
        announced,
        acknowledged.then(result => {
          if (!result || typeof result.turnId !== 'string' || result.turnId.length === 0 || result.turnId.length > 512) {
            fail('AGENT_ENGINE_INVALID_TURN', 'The engine\'s sendTurn() returned an invalid turnId')
          }
          return result.turnId
        }),
      ])
      const alreadyCompleted = session.completedWithoutTurnId || session.completedDuringSend.delete(turnId)
      session.activeTurnId = alreadyCompleted ? null : turnId
      return Object.freeze({
        sessionId: session.sessionId,
        threadId: session.threadId,
        turnId,
      })
    })()
    session.sendPromise = sendPromise

    /* A TURN THAT DIES AFTER IT WAS ANNOUNCED STILL HAS TO REACH THE PERSON.
     *
     * Before this race the adapter's rejection WAS the answer to the send, so a
     * child that died mid-turn surfaced as a refused send. Now the send has
     * usually been answered already, and the Claude adapter emits nothing at all
     * when its child exits -- it only rejects the turn. Left alone, that would
     * trade the old defect for the same silence in a new place: a node running
     * forever behind a program that is no longer there.
     *
     * So a rejection that arrives after the announcement is reported as what it
     * is: this turn ended, and not successfully. `turn_completed` is the
     * contract's own word for that and the only one every surface already reads;
     * the status is deliberately NOT any engine's success word, so nothing can
     * read this as an answer. If the engine did emit its own completion first,
     * activeTurnId is already clear and this adds a second, honest ending rather
     * than inventing a first one. */
    void sendPromise.then(
      accepted => acknowledged.then(
        () => {},
        () => {
          /* Only the turn this send answered for, and only while it is still
             the one running: an engine that already reported its own ending
             has been believed, and a second ending must not overwrite it. */
          if (session.activeTurnId !== accepted.turnId) return
          session.activeTurnId = null
          emit(session, {
            type: 'turn_completed',
            ...(session.threadId ? { threadId: session.threadId } : {}),
            turnId: accepted.turnId,
            status: 'failed',
          })
        },
      ),
      /* The send itself was refused; that refusal is already the caller's
         answer and needs no event beside it. */
      () => {},
    )

    try {
      return await sendPromise
    } finally {
      if (session.sendPromise === sendPromise) session.sendPromise = null
      if (session.turnAnnounce === announce) session.turnAnnounce = null
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

  /* CHANGE HOW HARD A RUNNING AGENT THINKS, without restarting it.
   * The wire's own knob (thread/settings/update). The value is checked
   * against the same closed set a start uses, because codex accepts an
   * unknown effort silently. What comes back is what the engine acknowledged,
   * not what was asked for. */
  async function setSessionEffort({ sessionId, effort } = {}) {
    assertOpen()
    const session = readySession(sessionId)
    const key = String(effort || '').trim()
    if (!EFFORT_KEYS.has(key)) {
      fail('AGENT_EFFORT_UNKNOWN', `Unknown effort "${key}". Available: ${[...EFFORT_KEYS].join(', ')}.`)
    }
    if (typeof session.adapter.updateThreadSettings !== 'function') {
      fail('AGENT_EFFORT_FIXED', 'This build\'s engine cannot change how hard an agent thinks while it runs.')
    }
    await session.adapter.updateThreadSettings(session.threadId, { effort: key })
    session.effort = key
    return Object.freeze({ sessionId: session.sessionId, effort: key })
  }

  /* THE PROVIDER'S MODEL CATALOG, as the engine reports it: every model with
   * the reasoning efforts it really supports, each described in the
   * provider's own words, and its default. The menu is built from this
   * rather than from a table in the product that drifts from it. Needs no
   * session of its own -- it asks any ready one, since they all speak to the
   * same installed codex. */
  async function listEngineModels({ sessionId } = {}) {
    assertOpen()
    const session = sessionId ? readySession(sessionId) : [...sessions.values()].find(entry => entry.state === 'ready')
    if (!session || typeof session.adapter?.listModels !== 'function') {
      fail('AGENT_MODELS_UNAVAILABLE', 'No running agent could be asked what this engine offers. Start one first.')
    }
    return session.adapter.listModels()
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

  /* Hear about a session whose child ended on its own -- `{ sessionId, exit:
     { code, signal } }` -- once per session, and never for a close this host
     performed. Same subscribe/unsubscribe shape as onEvent(). */
  function onSessionExit(listener) {
    assertOpen()
    if (typeof listener !== 'function') fail('AGENT_HOST_INVALID_ARGUMENT', 'onSessionExit requires a listener function')
    exitListeners.add(listener)
    return () => exitListeners.delete(listener)
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
    stopTreePolling()
    listeners.clear()
    exitListeners.clear()
    const failures = results.filter(result => result.status === 'rejected').map(result => result.reason)
    if (failures.length) throw new AggregateError(failures, 'One or more Codex sessions failed to close')
  }

  /* WHICH TIERS THIS INSTALLATION CAN ACTUALLY START, asked rather than guessed.
   *
   * THE DEFECT THIS CLOSES. src/fleet-tree-copy.js carried
   * TREE_STARTABLE_PROVIDERS = ['codex'], hardcoded, and every surface that
   * draws a tier row took its label from it -- so the menu said "cannot start
   * from a tree yet" on a build that could, and would have gone on saying it
   * after the engine shipped. Meanwhile this shell already knew the truth:
   * resolveStartTier() gates on `claudeEngine`, which is a real require() of the
   * payload module confirming it exports startClaudeSession. One side knew and
   * the other was guessing, and the guess is what a person read.
   *
   * IT DERIVES FROM THE SAME VALUES THE START PATH USES -- the START_TIERS table
   * and the same `claudeEngine` handle -- rather than a second list. A parallel
   * list is one that drifts, and the drift is invisible: it shows up as a menu
   * that disagrees with the press, which is precisely today's bug.
   *
   * IT STARTS NOTHING and returns no path: tier ids, which are already the
   * renderer's own vocabulary. */
  function startableTiers() {
    return Object.freeze({
      ok: true,
      tiers: Object.freeze(Object.keys(START_TIERS).filter((id) => {
        try { resolveStartTier(id); return true } catch { return false }
      })),
    })
  }

  return Object.freeze({
    startSession,
    sendTurn,
    interrupt,
    rewindSession,
    setSessionEffort,
    listEngineModels,
    answerApproval,
    closeSession,
    onEvent,
    onSessionExit,
    closeAll,
    startableTiers,
  })
}

/* engineCandidates is exported for ORDER assertions only. engineAvailability()
 * cannot reveal precedence: the resolver walks every candidate and returns the
 * first that WORKS, so when only one resolves the order is unobservable through
 * it. A precedence test written against engineAvailability() therefore passes
 * whichever way round the candidates are, which is exactly what a planted
 * swap proved before this was exported. */
module.exports = { AVAILABILITY_CODES, START_REFUSAL_CODES, confinementPlanFor, createAgentHost, engineAvailability, engineCandidates, narrowTurnOptions, observeEngineExit }
