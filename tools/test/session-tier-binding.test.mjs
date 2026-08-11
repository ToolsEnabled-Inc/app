// DOES THE RECORDED PERMISSION LEVEL REACH THE AGENT THE APP STARTS?
//
// The first-run screen asks how much the assistant may do and records the
// answer. Until this suite the answer reached nothing that runs: shell/
// agent-host.cjs called startCodexSession with `threadOptions: {}` and no
// environment, so Codex fell back to the user's own ~/.codex/config.toml --
// measured on the build machine as `sandbox_mode = "danger-full-access"`. The
// product made a safety promise at the point of choice and did not keep it for
// its own agent.
//
// These assertions are BEHAVIOURAL where it matters. The forwarding cases drive
// the real resolution path -- engine root, hostModule lookup, confinedSessionPlan
// -- through a fixture engine that records what it was handed, rather than
// grepping the source for a variable name. A source assertion cannot tell the
// difference between code that computes a plan and code that computes it and
// then ignores it, and that difference is the entire defect.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const { createAgentHost } = require(path.join(ROOT, 'shell/agent-host.cjs'))
const setupRecord = require(path.join(ROOT, 'shell/setup-record.cjs'))

const CONFINED_ENGINE = path.join(ROOT, 'tools/test/fixtures/confined-engine/src/lib/agent-engine/codex-process.js')
const UNCONFINED_ENGINE = path.join(ROOT, 'tools/test/fixtures/unconfined-engine/src/lib/agent-engine/codex-process.js')

function withPlan(plan, run) {
  const previous = process.env.MC_TEST_CONFINEMENT_PLAN
  process.env.MC_TEST_CONFINEMENT_PLAN = JSON.stringify(plan)
  try { return run() } finally {
    if (previous === undefined) delete process.env.MC_TEST_CONFINEMENT_PLAN
    else process.env.MC_TEST_CONFINEMENT_PLAN = previous
  }
}

function engineCalls() {
  return require(CONFINED_ENGINE).calls
}

test('the recorded level reaches the engine as thread options, not as a comment', async () => {
  const workdir = mkdtempSync(path.join(tmpdir(), 'mc-tier-bind-'))
  try {
    const plan = {
      ok: true, tier: 'guided', isolated: true,
      threadOptions: { sandbox: 'read-only', approvalPolicy: 'never' },
      env: { CODEX_HOME: path.join(workdir, 'agent-home') },
    }
    await withPlan(plan, async () => {
      const before = engineCalls().length
      const host = createAgentHost({ enginePath: CONFINED_ENGINE, defaultCwd: workdir })
      const started = await host.startSession({ sessionId: 's1' })
      const call = engineCalls()[before]

      // The whole point: the sandbox the user's answer implies is what the
      // engine was actually asked for.
      assert.deepEqual(call.threadOptions, { sandbox: 'read-only', approvalPolicy: 'never' })
      // And the home that keeps the user's own MCP servers out of this session.
      assert.equal(call.env.CODEX_HOME, plan.env.CODEX_HOME)
      // The environment is EXTENDED, not replaced: dropping PATH/APPDATA would
      // break the very resolution that finds codex on Windows.
      assert.equal(call.env.PATH, process.env.PATH)
      // The caller can see which level the session actually runs at.
      assert.equal(started.tier, 'guided')
      await host.closeAll()
    })
  } finally {
    rmSync(workdir, { recursive: true, force: true })
  }
})

// Renamed with the assertion below it. The old title -- "unrestricted is handed
// no environment of ours at all" -- describes a mechanism that is deliberately
// no longer true, and a test whose name states the opposite of what it checks
// is worse than no name: it is what the next reader greps for and believes.
test('unrestricted keeps the user own Codex configuration and loses only their billing credentials', async () => {
  const workdir = mkdtempSync(path.join(tmpdir(), 'mc-tier-unres-'))
  try {
    const plan = {
      ok: true, tier: 'unrestricted', isolated: false,
      threadOptions: { sandbox: 'danger-full-access', approvalPolicy: 'never' },
      env: null,
    }
    // A variable that is neither a credential nor an endpoint, standing for
    // "everything the user's own environment carries", and one that IS a
    // credential. Both are needed below: the point of this test is that
    // unrestricted keeps the first and no longer keeps the second.
    const saved = {
      keep: Object.hasOwn(process.env, 'MC_TIER_UNRESTRICTED_KEEP') ? process.env.MC_TIER_UNRESTRICTED_KEEP : undefined,
      key: Object.hasOwn(process.env, 'ANTHROPIC_API_KEY') ? process.env.ANTHROPIC_API_KEY : undefined,
    }
    process.env.MC_TIER_UNRESTRICTED_KEEP = 'inherited-by-the-user'
    process.env.ANTHROPIC_API_KEY = 'sk-ant-fixture-would-bill-a-metered-account'
    try {
      await withPlan(plan, async () => {
        const before = engineCalls().length
        const host = createAgentHost({ enginePath: CONFINED_ENGINE, defaultCwd: workdir })
        await host.startSession({ sessionId: 'u1' })
        const call = engineCalls()[before]
        assert.equal(call.threadOptions.sandbox, 'danger-full-access',
          'unrestricted stopped asking the engine for the sandbox its own level implies')

        /* WHAT THIS ASSERTION USED TO BE, AND WHY IT CHANGED.
         *
         * It was `assert.equal('env' in call, false)` -- unrestricted is handed
         * no environment of ours at all. That was doing two jobs. The one worth
         * keeping is (a) "no redirected Codex home, no narrowing of the MCP
         * servers the user configured". The one that had to go is (b) "no env
         * key is passed", which merely IMPLIED (a) as a side effect.
         *
         * (b) is not a protection, it is a leak. codex-process.js does
         * `env === undefined ? process.env : env`, so passing no key hands the
         * child the ENTIRE parent environment -- on this machine including a
         * live ANTHROPIC_API_KEY persisted in HKCU:\Environment, which Claude
         * Code prefers over the owner's subscription login. `unrestricted` was
         * the least protected level, not the most faithful one.
         *
         * So (a) is now asserted DIRECTLY rather than as a consequence of
         * absence, which is also strictly stronger: the old form could not see
         * a CODEX_HOME slipped into a newly-passed env, and this one names it.
         */
        assert.equal(Object.hasOwn(call.env, 'CODEX_HOME'), false,
          'unrestricted was handed a CODEX_HOME: this level must not redirect the user to a home this installation owns, nor narrow the MCP servers they configured')

        // The user's own environment still reaches the agent. Unrestricted has
        // not become a confined level by the back door.
        assert.equal(call.env.MC_TIER_UNRESTRICTED_KEEP, 'inherited-by-the-user',
          'unrestricted stopped inheriting the user own environment, which is the capability this level exists to preserve')

        // And the part that is new: what the user never chose is taken away.
        // Set to a poisoned value above and asserted here, so a pass means
        // REMOVED rather than absent on whatever machine this runs on.
        assert.equal(process.env.ANTHROPIC_API_KEY === 'sk-ant-fixture-would-bill-a-metered-account', true,
          'the fixture failed to set ANTHROPIC_API_KEY, so the assertion below would prove nothing')
        assert.equal(Object.hasOwn(call.env, 'ANTHROPIC_API_KEY'), false,
          'a metered billing credential reached the agent child at unrestricted: choosing that level means trusting the agent with the computer, not consenting to have an API account billed instead of the subscription')

        await host.closeAll()
      })
    } finally {
      if (saved.keep === undefined) delete process.env.MC_TIER_UNRESTRICTED_KEEP
      else process.env.MC_TIER_UNRESTRICTED_KEEP = saved.keep
      if (saved.key === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = saved.key
    }
  } finally {
    rmSync(workdir, { recursive: true, force: true })
  }
})

test('a session that cannot be confined is not started at a wider level', async () => {
  // The shape that has cost this project three findings is a missing security
  // input read as consent. Here the plan reports failure, and the only correct
  // response is to refuse -- not to start with `threadOptions: {}`, which is
  // precisely what made a guided install run at danger-full-access.
  const workdir = mkdtempSync(path.join(tmpdir(), 'mc-tier-refuse-'))
  try {
    await withPlan({ ok: false, code: 'AGENT_CONFINEMENT_HOME_UNAVAILABLE' }, async () => {
      const before = engineCalls().length
      const host = createAgentHost({ enginePath: CONFINED_ENGINE, defaultCwd: workdir })
      // Synchronous, like every other refusal startSession makes: the caller
      // never gets a session handle it could mistake for a running agent.
      assert.throws(
        () => host.startSession({ sessionId: 'r1' }),
        (error) => {
          assert.equal(error.code, 'AGENT_CONFINEMENT_HOME_UNAVAILABLE')
          return true
        },
      )
      assert.equal(engineCalls().length, before, 'no engine session may be started when confinement failed')
      await host.closeAll()
    })
  } finally {
    rmSync(workdir, { recursive: true, force: true })
  }
})

test('an engine that carries no enforcement module cannot start a session', async () => {
  // A payload that cannot say what a level permits must not start an agent under
  // that level's name. Failing OPEN here would mean every build that forgot to
  // stage the module silently shipped unconfined sessions.
  const workdir = mkdtempSync(path.join(tmpdir(), 'mc-tier-nomodule-'))
  try {
    const host = createAgentHost({ enginePath: UNCONFINED_ENGINE, defaultCwd: workdir })
    assert.throws(
      () => host.startSession({ sessionId: 'n1' }),
      (error) => {
        assert.equal(error.code, 'AGENT_CONFINEMENT_UNAVAILABLE')
        return true
      },
    )
    await host.closeAll()
  } finally {
    rmSync(workdir, { recursive: true, force: true })
  }
})

test('the enforcement module is staged in the payload the installer ships', () => {
  // agent-host.cjs resolves it out of the capability payload at runtime, and
  // tools/check-asar-manifest.mjs gates every hostModules entry against the
  // built payload. An unlisted module would resolve in a checkout and be absent
  // on every customer's machine -- the exact shape of the dead-agent defect this
  // repo already paid for once.
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'tools/capability-manifest.json'), 'utf8'))
  assert.ok(
    manifest.hostModules.includes('src/lib/agent-session-confinement.js'),
    'the confinement module must be staged as a hostModule',
  )
  const source = readFileSync(path.join(ROOT, 'shell/agent-host.cjs'), 'utf8')
  assert.match(source, /PAYLOAD_CONFINEMENT_MODULE = 'src\/lib\/agent-session-confinement\.js'/)
})

test('recording a level also writes the configuration that level implies', () => {
  // The record alone configures nothing. mcsetup.js has always written both; the
  // app wrote only the record, so an installation created through the first-run
  // screen had no .mcp.json at all and the answer narrowed nothing for any
  // client that reads one.
  const workspace = mkdtempSync(path.join(tmpdir(), 'mc-tier-ws-'))
  const written = []
  try {
    const modules = {
      ok: true,
      machineRecord: {
        TIERS: ['guided', 'standard', 'unrestricted'],
        resolveServicesRoot: () => workspace,
        readMachineRecord: () => null,
        resolveNodePath: () => process.execPath,
        defaultMachineId: () => 'machine',
        defaultMachineLabel: () => 'Machine',
        buildMachineRecord: (input) => ({ ...input, machine: { id: input.machineId, label: input.machineLabel } }),
        writeMachineRecord: () => path.join(workspace, 'machine.json'),
        writeMcpConfig: (record, options) => {
          written.push({ tier: record.tier, targetDirectory: options.targetDirectory })
          return { file: path.join(options.targetDirectory, '.mcp.json'), document: { mcpServers: { toolsenabled: {} } } }
        },
      },
      workspace: { defaultWorkspacePath: () => workspace },
    }
    const result = setupRecord.recordTier('guided', { modules })
    assert.equal(result.ok, true)
    assert.equal(result.assistantConfig.ok, true)
    assert.equal(written.length, 1, 'recording a level must generate the assistant configuration')
    assert.equal(written[0].tier, 'guided')
    assert.equal(written[0].targetDirectory, workspace)
    // No internal path crosses back with it.
    assert.equal(result.assistantConfig.targetDirectory, undefined)
    assert.equal(result.assistantConfig.file, undefined)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('a configuration that cannot be narrowed does not leave the wider one in place', () => {
  // The dangerous case is not the absent file, it is the previous one. Someone
  // moving `unrestricted` down to `guided` whose old document still names the
  // full surface would have narrowed the record and nothing else.
  const workspace = mkdtempSync(path.join(tmpdir(), 'mc-tier-stale-'))
  try {
    const stale = path.join(workspace, '.mcp.json')
    writeFileSync(stale, JSON.stringify({ mcpServers: { toolsenabled: { command: 'node' } } }))
    assert.ok(existsSync(stale))

    const modules = {
      ok: true,
      machineRecord: {
        TIERS: ['guided', 'standard', 'unrestricted'],
        resolveServicesRoot: () => workspace,
        readMachineRecord: () => null,
        resolveNodePath: () => process.execPath,
        defaultMachineId: () => 'machine',
        defaultMachineLabel: () => 'Machine',
        buildMachineRecord: (input) => ({ ...input, machine: { id: input.machineId, label: input.machineLabel } }),
        writeMachineRecord: () => path.join(workspace, 'machine.json'),
        writeMcpConfig: () => { const error = new Error('nope'); error.code = 'SETUP_TIER_PROFILE_UNAVAILABLE'; throw error },
      },
      workspace: { defaultWorkspacePath: () => workspace },
    }
    const result = setupRecord.recordTier('guided', { modules })
    // The level is the person's answer and it IS saved; telling them it failed
    // would be false.
    assert.equal(result.ok, true)
    assert.equal(result.tier, 'guided')
    // But the document that grants the wider surface does not survive.
    assert.equal(result.assistantConfig.ok, false)
    assert.equal(result.assistantConfig.code, 'SETUP_TIER_PROFILE_UNAVAILABLE')
    assert.equal(existsSync(stale), false, 'a stale wider configuration must not survive a failed narrowing')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('setup refuses a payload whose machine-record module cannot generate a configuration', () => {
  // Recognition is checked against what this shell actually calls. A payload
  // carrying writeMachineRecord but not writeMcpConfig would record levels and
  // configure nothing, which is the defect that shipped.
  const result = setupRecord.loadSetupModules({
    root: '/nonexistent-payload-root',
    load: (target) => (String(target).includes('machine-record')
      ? { TIERS: ['guided'], writeMachineRecord() {} }
      : {}),
  })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'SETUP_MODULES_UNRECOGNIZED')
})
