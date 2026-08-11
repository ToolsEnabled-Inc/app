// WHOSE ACCOUNT DOES THE AGENT TOOLSENABLED STARTS ACTUALLY SPEND?
//
// Until this suite, shell/agent-host.cjs handed its agent child the user's
// ENTIRE environment, by both of its branches and with nothing removed:
//
//   at `unrestricted`   no `env` key was passed at all -- and codex-process.js
//                       does `env === undefined ? process.env : env`, so the
//                       omission handed over the whole parent environment
//   at every other level `{ ...process.env, ...plan.env }` -- the whole parent
//                       environment again, plus CODEX_HOME
//
// The level that got the LEAST protection was the default one, and the branch
// that looked like "we pass nothing" was the branch that passed everything.
// That asymmetry was the defect, so every case below is asserted at BOTH
// levels; a fix covering one of them is the bug with a smaller blast radius.
//
// WHAT IS AT STAKE, in two kinds, kept apart on purpose:
//
//   BILLING     ANTHROPIC_API_KEY is set on the build machine and persisted in
//               HKCU:\Environment, so every process the owner starts inherits
//               it. Claude Code gives it PRECEDENCE over the Max subscription
//               login, and this agent session can spawn a Claude CLI. That is
//               the recorded R1186 outage: hours billed to a drained API
//               account while `claude auth status` reported a perfect green.
//   REDIRECTION OPENAI_BASE_URL / ANTHROPIC_BASE_URL carry no credential and
//               take the session's prompts and file contents to an arbitrary
//               host. The session starts, answers, and looks correct. There is
//               no failure for anyone to notice.
//
// THESE ASSERTIONS ARE BEHAVIOURAL, on the options object the engine was
// actually handed, driven through the host's real resolution path -- engine
// root, hostModule lookup, safeLaunchEnvironment. A source-text assertion that
// a scrub is written still passes when the caller stopped routing through it,
// and that is exactly how a scrub ships bypassed.
//
// Every poisoned variable is set to a value that would be ACTIVELY HARMFUL if
// inherited, and each fixture asserts it really set the variable, so a pass
// means the value was REMOVED rather than absent on this machine.
//
// SCOPE, STATED SO A GREEN RUN IS NOT READ AS MORE THAN IT IS: the fixture
// engine's scrub module is a routing stand-in with a deliberately small sample
// list (see its header). The authoritative list lives in exactly one place --
// src/lib/providers/subscription-launch-env.js, composed by folding the
// provider gateway's own providerEnvironment() over every provider -- and is
// tested there. What this suite pins is that the host ROUTES through that
// module, at every level, and refuses to start when it cannot.

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const { createAgentHost } = require(path.join(ROOT, 'shell/agent-host.cjs'))

const FIXTURES = path.join(ROOT, 'tools/test/fixtures')
const CONFINED_ENGINE = path.join(FIXTURES, 'confined-engine/src/lib/agent-engine/codex-process.js')
const NO_SCRUB_ENGINE = path.join(FIXTURES, 'no-scrub-engine/src/lib/agent-engine/codex-process.js')
const UNRECOGNIZED_SCRUB_ENGINE = path.join(FIXTURES, 'unrecognized-scrub-engine/src/lib/agent-engine/codex-process.js')

// Each name is poisoned with a value that would do real damage if it survived,
// and each is a DIFFERENT kind of harm so that a fix addressing only one shape
// cannot pass. These are the fixture stand-in's sample list; see this file's
// header for why the authoritative list is not duplicated here.
const POISONED = Object.freeze({
  ANTHROPIC_API_KEY: {
    value: 'sk-ant-fixture-would-bill-a-metered-account',
    harm: 'takes precedence over the owner subscription login, so the session bills a metered API account',
  },
  OPENAI_API_KEY: {
    value: 'sk-fixture-another-providers-metered-key',
    harm: "belongs to a DIFFERENT provider than the one being launched -- a per-provider scrub misses it, which is why the launch takes a union",
  },
  OPENAI_BASE_URL: {
    value: 'https://attacker.invalid/v1',
    harm: "carries no credential and redirects the session's prompts and file contents to an arbitrary host, while the session still works",
  },
})

const UNRESTRICTED_PLAN = Object.freeze({
  ok: true, tier: 'unrestricted', isolated: false,
  threadOptions: { sandbox: 'danger-full-access', approvalPolicy: 'never' },
  env: null,
})

function confinedPlan(workdir) {
  return {
    ok: true, tier: 'guided', isolated: true,
    threadOptions: { sandbox: 'read-only', approvalPolicy: 'never' },
    env: { CODEX_HOME: path.join(workdir, 'agent-home') },
  }
}

function withPlan(plan, run) {
  const previous = process.env.MC_TEST_CONFINEMENT_PLAN
  process.env.MC_TEST_CONFINEMENT_PLAN = JSON.stringify(plan)
  try { return run() } finally {
    if (previous === undefined) delete process.env.MC_TEST_CONFINEMENT_PLAN
    else process.env.MC_TEST_CONFINEMENT_PLAN = previous
  }
}

// Sets the poisoned variables AND proves it set them. Without that proof an
// "it is gone" assertion is satisfied by a machine where it was never there,
// which is a test that passes for the wrong reason on every CI box.
function withPoisonedEnvironment(run) {
  const extra = { MC_LAUNCH_ENV_FIXTURE_KEEP: 'must-survive' }
  const overrides = { ...extra }
  for (const [name, { value }] of Object.entries(POISONED)) overrides[name] = value

  const saved = new Map()
  for (const [name, value] of Object.entries(overrides)) {
    saved.set(name, Object.hasOwn(process.env, name) ? process.env[name] : undefined)
    process.env[name] = value
  }
  try {
    for (const [name, { value }] of Object.entries(POISONED)) {
      assert.equal(process.env[name], value,
        `the fixture failed to set ${name}, so every "it was removed" assertion in this test would prove nothing`)
    }
    return run()
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}

function engineCalls() {
  return require(CONFINED_ENGINE).calls
}

function scrubCalls() {
  return require(path.join(FIXTURES, 'confined-engine/src/lib/providers/subscription-launch-env.js')).calls
}

async function startAndCapture(plan, sessionId) {
  const workdir = mkdtempSync(path.join(tmpdir(), 'mc-launch-env-'))
  try {
    return await withPlan(plan, async () => await withPoisonedEnvironment(async () => {
      const before = engineCalls().length
      const host = createAgentHost({ enginePath: CONFINED_ENGINE, defaultCwd: workdir })
      const started = await host.startSession({ sessionId })
      const call = engineCalls()[before]
      await host.closeAll()
      return { call, started, workdir }
    }))
  } finally {
    rmSync(workdir, { recursive: true, force: true })
  }
}

/* ---------- the scrub reaches the child, at BOTH levels ---------- */

for (const [label, makePlan] of [
  ['unrestricted', () => UNRESTRICTED_PLAN],
  ['a confined level', (workdir) => confinedPlan(workdir)],
]) {
  test(`no billing credential or endpoint redirector reaches the agent child at ${label}`, async () => {
    const workdir = mkdtempSync(path.join(tmpdir(), 'mc-launch-env-plan-'))
    try {
      const plan = makePlan(workdir)
      const { call } = await startAndCapture(plan, `env-${label.replace(/\s+/g, '-')}`)

      // The branch that used to pass NOTHING is the branch that passed
      // everything, because codex-process.js falls back to process.env when
      // `env` is undefined. So the key must exist before its contents matter.
      assert.ok(Object.hasOwn(call, 'env'),
        `at ${label} the host passed no env key, so codex-process.js falls back to the FULL process.env -- the omission is the leak, not the protection`)

      for (const [name, { harm }] of Object.entries(POISONED)) {
        assert.equal(Object.hasOwn(call.env, name), false,
          `${name} survived into the agent child's environment at ${label} -- it ${harm}`)
      }
    } finally {
      rmSync(workdir, { recursive: true, force: true })
    }
  })

  test(`unrelated inherited variables still pass through at ${label}`, async () => {
    // A scrub that takes away a capability is a different bug, not a safer one.
    // Stripping PATH or APPDATA would break the very resolution that finds
    // codex on Windows, so removal must be by NAME and never by pattern.
    const workdir = mkdtempSync(path.join(tmpdir(), 'mc-launch-env-keep-'))
    try {
      const { call } = await startAndCapture(makePlan(workdir), `keep-${label.replace(/\s+/g, '-')}`)
      assert.equal(call.env.MC_LAUNCH_ENV_FIXTURE_KEEP, 'must-survive',
        `an unrelated variable was dropped at ${label}: the scrub is filtering rather than removing a named list`)
      // Compared as a boolean on purpose: a value comparison prints both PATHs
      // on failure, and this machine's PATH is full of the owner's home
      // directory. Same rule as the credential assertions -- no values in logs.
      assert.equal(call.env.PATH === process.env.PATH, true,
        `PATH was altered at ${label}, which breaks the executable resolution that finds codex on Windows`)
    } finally {
      rmSync(workdir, { recursive: true, force: true })
    }
  })
}

test('the parent environment is what gets scrubbed, not something already replaced', async () => {
  // Proves the host hands process.env INTO the module rather than scrubbing a
  // copy it had already built (or building one and scrubbing nothing). Without
  // this, a host that passed `{}` to the scrub and process.env to the child
  // would satisfy every removal assertion above.
  //
  // Asserted on NAMES and on object IDENTITY, never on a value. The first
  // version of this test compared the credential's value and printed the build
  // machine's REAL ANTHROPIC_API_KEY into the test log when it failed. Names
  // only is the rule the authoritative module already states for its own
  // refusals, and it applies just as much to a test.
  const before = scrubCalls().length
  await startAndCapture(UNRESTRICTED_PLAN, 'scrub-input')
  const call = scrubCalls()[before]
  assert.ok(call, 'the host never called safeLaunchEnvironment(), so nothing was scrubbed')
  assert.equal(call.isLiveProcessEnv, true,
    'the host scrubbed some other object than the live process.env the child inherits -- a scrub of a copy nobody passes on protects nothing')
  assert.equal(call.names.includes('ANTHROPIC_API_KEY'), true,
    'the environment handed to the scrub did not contain the credential under test, so the removal assertions elsewhere in this file would prove nothing')
  assert.equal(typeof call.context === 'string' && call.context.length > 0, true,
    'the scrub was called without a context, so a refusal could not say which launch it refused')
  assert.equal(call.context.includes('scrub-input'), false,
    'the context carries the session id into an error message; caller data has no business in one (BLOCKER 2)')
})

/* ---------- unrestricted keeps everything it actually promised ---------- */

test('unrestricted still gets no redirected Codex home and no substituted MCP servers', async () => {
  // The guarantee `unrestricted` makes is "nothing is decided for you". That is
  // about CAPABILITY, and it is intact: this level is handed no CODEX_HOME of
  // ours, so the user's own Codex configuration and their own MCP servers are
  // what the session uses. Previously this was implied by the absence of an
  // `env` key; it is now asserted directly, because the absence no longer
  // holds and an implication that stops being true stops protecting anything.
  const { call, started } = await startAndCapture(UNRESTRICTED_PLAN, 'unrestricted-home')
  assert.equal(started.tier, 'unrestricted')
  assert.equal(call.threadOptions.sandbox, 'danger-full-access',
    'unrestricted must still ask the engine for the sandbox its own level implies')
  assert.equal(Object.hasOwn(call.env, 'CODEX_HOME'), false,
    'unrestricted was handed a CODEX_HOME: this level must not redirect the user to a home this installation owns, or narrow the MCP servers they configured')
})

test("a user's own CODEX_HOME still survives at unrestricted", async () => {
  // The other half of the same promise, and the one a name-list scrub could
  // break by accident. CODEX_HOME is deliberately not on the scrub list: it
  // names no endpoint and carries no credential.
  const saved = Object.hasOwn(process.env, 'CODEX_HOME') ? process.env.CODEX_HOME : undefined
  process.env.CODEX_HOME = path.join(tmpdir(), 'the-users-own-codex-home')
  try {
    const own = path.join(tmpdir(), 'the-users-own-codex-home')
    assert.equal(process.env.CODEX_HOME === own, true,
      'the fixture failed to set CODEX_HOME, so the assertion below would prove nothing')
    const { call } = await startAndCapture(UNRESTRICTED_PLAN, 'users-codex-home')
    assert.equal(call.env.CODEX_HOME === own, true,
      "the user's own CODEX_HOME was stripped at unrestricted: the scrub is taking away a capability rather than a credential")
  } finally {
    if (saved === undefined) delete process.env.CODEX_HOME
    else process.env.CODEX_HOME = saved
  }
})

test('a confined level still gets the home that keeps the user MCP servers out', async () => {
  const workdir = mkdtempSync(path.join(tmpdir(), 'mc-launch-env-conf-'))
  try {
    const plan = confinedPlan(workdir)
    const { call } = await startAndCapture(plan, 'confined-home')
    assert.equal(call.env.CODEX_HOME === plan.env.CODEX_HOME, true,
      'the confinement pin was lost: scrubbing must happen BEFORE the account pin is applied, not instead of it')
    assert.deepEqual(call.threadOptions, plan.threadOptions,
      'the confined level stopped asking the engine for its own sandbox')
  } finally {
    rmSync(workdir, { recursive: true, force: true })
  }
})

/* ---------- the pin cannot put back what the scrub removed ---------- */

test('an account pin that reintroduces a credential refuses the launch', async () => {
  // Order of operations, made observable. The pin is applied AFTER the scrub,
  // so a plan whose env carries a credential would hand it straight to the
  // child unless the merged object is asserted again. This is the check that
  // makes "scrub, pin, re-assert" a sequence rather than a comment.
  const workdir = mkdtempSync(path.join(tmpdir(), 'mc-launch-env-pin-'))
  try {
    const plan = {
      ok: true, tier: 'guided', isolated: true,
      threadOptions: { sandbox: 'read-only', approvalPolicy: 'never' },
      env: { CODEX_HOME: path.join(workdir, 'agent-home'), ANTHROPIC_API_KEY: 'sk-ant-reintroduced-by-the-pin' },
    }
    withPlan(plan, () => withPoisonedEnvironment(() => {
      const before = engineCalls().length
      const host = createAgentHost({ enginePath: CONFINED_ENGINE, defaultCwd: workdir })
      assert.throws(
        () => host.startSession({ sessionId: 'pin-reintroduce' }),
        (error) => {
          assert.equal(error.code, 'LAUNCH_BILLING_CREDENTIAL_PRESENT',
            'a pin that reintroduced a billing credential did not produce the refusal code that names it')
          assert.equal(error.message.includes('sk-ant-reintroduced-by-the-pin'), false,
            'the refusal printed the credential VALUE, which is the one thing it must never do')
          return true
        },
        // A bare assert.throws that fails reports only "Missing expected
        // exception", which is indistinguishable from every other one in this
        // file. The message has to say what did not happen.
        'the launch was NOT refused: an account pin reintroduced ANTHROPIC_API_KEY after the scrub and the merged environment was never re-asserted, so the credential went to the child',
      )
      assert.equal(engineCalls().length, before,
        'a session was started despite a billing credential surviving into its environment')
    }))
  } finally {
    rmSync(workdir, { recursive: true, force: true })
  }
})

/* ---------- fail closed, both shapes ---------- */

test('an engine carrying no launch-environment module cannot start a session', async () => {
  // Failing OPEN here -- falling back to `{ ...process.env }` because that is
  // "what it did before" -- would hand over a metered API key on exactly the
  // installs where a packaging mistake removed the protection, silently,
  // because a mis-billed session looks identical to a correct one.
  const workdir = mkdtempSync(path.join(tmpdir(), 'mc-launch-env-missing-'))
  try {
    await withPlan(UNRESTRICTED_PLAN, async () => {
      const host = createAgentHost({ enginePath: NO_SCRUB_ENGINE, defaultCwd: workdir })
      assert.throws(
        () => host.startSession({ sessionId: 'no-scrub' }),
        (error) => {
          assert.equal(error.code, 'AGENT_LAUNCH_ENVIRONMENT_UNAVAILABLE',
            'a payload that cannot scrub billing credentials started a session anyway')
          return true
        },
        'the start was NOT refused: an engine with no launch-environment module started a session anyway, which is the fail-open that hands over a metered API key on exactly the installs a packaging mistake stripped the protection from',
      )
      await host.closeAll()
    })
  } finally {
    rmSync(workdir, { recursive: true, force: true })
  }
})

test('a launch-environment module of the wrong shape is refused, not used', async () => {
  // The case a presence check alone gets wrong, and the realistic one: a
  // partial or older payload whose module scrubs but cannot assert. Accepting
  // it would apply the account pin afterwards with nothing left to catch what
  // the pin put back.
  const workdir = mkdtempSync(path.join(tmpdir(), 'mc-launch-env-shape-'))
  try {
    await withPlan(UNRESTRICTED_PLAN, async () => {
      const host = createAgentHost({ enginePath: UNRECOGNIZED_SCRUB_ENGINE, defaultCwd: workdir })
      assert.throws(
        () => host.startSession({ sessionId: 'bad-shape' }),
        (error) => {
          assert.equal(error.code, 'AGENT_LAUNCH_ENVIRONMENT_UNAVAILABLE',
            'a module missing assertNoBillingCredentials was accepted, so the post-pin re-assert would silently not happen')
          return true
        },
        'the start was NOT refused: a launch-environment module of the wrong shape was accepted as if it could protect the account',
      )
      await host.closeAll()
    })
  } finally {
    rmSync(workdir, { recursive: true, force: true })
  }
})

/* ---------- what a customer actually receives ---------- */

test('the launch-environment module is staged in the payload the installer ships', () => {
  // agent-host.cjs resolves it out of the capability payload at runtime, and
  // tools/check-asar-manifest.mjs gates every hostModules entry against the
  // built package. Undeclared, it reaches the payload only as an incidental
  // dependency of src/lib/mission-bridge/actions.js -- so the day that require
  // is removed, every shipped copy would refuse to start an agent, with the
  // cause three modules away from the symptom.
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'tools/capability-manifest.json'), 'utf8'))
  assert.ok(
    manifest.hostModules.includes('src/lib/providers/subscription-launch-env.js'),
    'the launch-environment module must be declared as a hostModule, or nothing verifies it reached the built package',
  )
})

test('the host names the real module, so a customer cannot be running a test stand-in', () => {
  // The fixture used above is a routing stand-in with a deliberately small
  // sample list. This is what keeps that fact harmless: production resolves the
  // authoritative module, whose list is composed from the provider gateway
  // rather than hand-written, by exactly this path.
  const source = readFileSync(path.join(ROOT, 'shell/agent-host.cjs'), 'utf8')
  assert.match(
    source,
    /PAYLOAD_LAUNCH_ENVIRONMENT_MODULE = 'src\/lib\/providers\/subscription-launch-env\.js'/,
    'the host no longer resolves the authoritative launch-environment module by its real path',
  )
})
