/* A CLAUDE SUBSCRIBER MUST NOT NEED A CODEX ACCOUNT.
 *
 * WHAT WAS MEASURED, on the packaged 1.0.20 with Claude signed in and no Codex
 * sign-in anywhere on the machine: pressing Start on a Claude tier was refused
 * with "Codex is installed on this computer, but nobody is signed in to it ...
 * run codex login". Honest about what it found, wrong about what it meant --
 * nothing on the Claude path opens ~/.codex/auth.json.
 *
 * WHY IT HAPPENED. Every level in the payload's INSTALL_TIER_AGENT_CONFINEMENT
 * is `isolated: true`, and confinedSessionPlan() answers an isolated level by
 * preparing an isolated CODEX home and linking the user's Codex credential into
 * it. linkCredential() refuses when there is nothing to link. That is right for
 * Codex and was the plan for every provider, because it predates there being a
 * second one.
 *
 * THESE ASSERTIONS RUN THE REAL MODULES, NOT STUBS. The planner is the payload's
 * own capability/src/lib/agent-session-confinement.js, the record is written by
 * the payload's own machine-record builder, and the decision under test is the
 * shell's exported confinementPlanFor(). The only thing arranged is the machine:
 * LOCALAPPDATA and CODEX_HOME point at a scratch profile, which is how a
 * computer with no Codex sign-in is reproduced without touching a real one.
 *
 * BOTH DIRECTIONS ARE ASSERTED, and the negative control is the point. A change
 * that made every start pass would satisfy the first half of this suite and
 * would be a security regression: it would start a Codex session with no
 * credential and no confined home. So the same missing file must still refuse a
 * CODEX start, with the same code and the same sentence it always had.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require_ = createRequire(import.meta.url)
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const PAYLOAD = path.join(REPO, 'capability')

const planner = require_(path.join(PAYLOAD, 'src', 'lib', 'agent-session-confinement.js'))
const machineRecord = require_(path.join(PAYLOAD, 'src', 'lib', 'setup', 'machine-record.js'))
const { confinementPlanFor } = require_(path.join(REPO, 'shell', 'agent-host.cjs'))

/* A whole machine, in a temporary directory: a recorded permission level, a
   workspace, and a Codex home that either holds a sign-in or does not. */
function withMachine({ tier = 'standard', codexSignedIn = false }, run) {
  const scratch = mkdtempSync(path.join(tmpdir(), 'mc-provider-plan-'))
  const localAppData = path.join(scratch, 'local')
  const servicesRoot = path.join(localAppData, 'ToolsEnabled')
  const workspace = path.join(scratch, 'workspace')
  const codexHome = path.join(scratch, 'codex-home')
  mkdirSync(servicesRoot, { recursive: true })
  mkdirSync(workspace, { recursive: true })
  mkdirSync(codexHome, { recursive: true })
  if (codexSignedIn) {
    /* Inert bytes. linkCredential() links the FILE and never reads it, so this
       proves the gate is about presence -- which is all the product ever knew. */
    writeFileSync(path.join(codexHome, 'auth.json'), JSON.stringify({ note: 'not a credential' }))
  }
  const record = machineRecord.buildMachineRecord({
    tier,
    servicesRoot,
    installRoot: PAYLOAD,
    nodePath: process.execPath,
    workspaceRoots: [workspace],
  })
  machineRecord.writeMachineRecord(record, { servicesRoot })

  const previous = { LOCALAPPDATA: process.env.LOCALAPPDATA, CODEX_HOME: process.env.CODEX_HOME }
  process.env.LOCALAPPDATA = localAppData
  process.env.CODEX_HOME = codexHome
  try {
    return run({ scratch, servicesRoot, codexHome })
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    rmSync(scratch, { recursive: true, force: true })
  }
}

test('a machine with no Codex sign-in still refuses a Codex start, by name', () => {
  /* THE NEGATIVE CONTROL, first, because every other assertion in this file is
     only worth reading if this one holds. The missing credential is a real
     refusal for the provider that reads it, and it must stay one. */
  withMachine({ codexSignedIn: false }, () => {
    const plan = confinementPlanFor(planner, { provider: 'codex' })
    assert.equal(plan.ok, false, 'a Codex session was planned against a machine with no Codex sign-in')
    assert.equal(plan.code, 'AGENT_CONFINEMENT_SIGNED_OUT')
  })
})

test('the same machine plans a Claude session, at the level the person recorded', () => {
  withMachine({ codexSignedIn: false, tier: 'standard' }, () => {
    const plan = confinementPlanFor(planner, { provider: 'claude' })
    assert.equal(plan.ok, true, 'a Claude start is still gated on a Codex credential it never reads')
    assert.equal(plan.tier, 'standard')
    /* THE CEILING IS CARRIED, NOT DROPPED. claudeArgs() in the payload's
       claude-cli-adapter.js maps exactly this word to --permission-mode
       (workspace-write -> acceptEdits), so the level the person chose is what
       the child is launched under. A plan that answered ok with no sandbox word
       would be this change quietly removing the confinement instead of moving
       it. */
    assert.equal(plan.threadOptions.sandbox, 'workspace-write')
    assert.equal(plan.threadOptions.approvalPolicy, 'never')
    /* No Codex home is prepared and none is pinned: the Claude child ignores
       CODEX_HOME, and building one would mean opening a credential to link. */
    assert.equal(plan.codexHome, null)
    assert.equal(plan.env, null)
  })
})

test('every recorded level reaches the Claude plan with its own ceiling', () => {
  /* One tier is a coincidence; three is the mapping. If this ever answers one
     sandbox word for every level, the Claude path has stopped being confined by
     the person's own answer. */
  const seen = {}
  for (const tier of ['guided', 'standard', 'unrestricted']) {
    withMachine({ codexSignedIn: false, tier }, () => {
      const plan = confinementPlanFor(planner, { provider: 'claude' })
      assert.equal(plan.ok, true, `${tier} could not plan a Claude session`)
      seen[tier] = plan.threadOptions.sandbox
    })
  }
  assert.deepEqual(seen, {
    guided: 'read-only',
    standard: 'workspace-write',
    unrestricted: 'danger-full-access',
  })
})

test('a Codex start on a signed-in machine is unchanged', () => {
  /* The other half of "this widens nothing": with the credential present, the
     Codex plan is exactly what it was -- isolated, with a prepared home and the
     CODEX_HOME pin that keeps the user's own MCP servers out of the session. */
  withMachine({ codexSignedIn: true, tier: 'standard' }, () => {
    const plan = confinementPlanFor(planner, { provider: 'codex' })
    assert.equal(plan.ok, true)
    assert.equal(plan.isolated, true)
    assert.equal(typeof plan.codexHome, 'string')
    assert.equal(typeof plan.env.CODEX_HOME, 'string')
    assert.equal(plan.threadOptions.sandbox, 'workspace-write')
  })
})

test('a payload with no level reader falls back to the Codex plan rather than inventing one', () => {
  /* FAIL CLOSED ON AN OLDER PAYLOAD. resolveAgentConfinement() is the export
     this change reads the level from. A payload that predates it must keep
     today's behaviour -- Codex plan, Codex refusal -- and must never be handed a
     session at a level nobody resolved. */
  withMachine({ codexSignedIn: false }, () => {
    const older = { confinedSessionPlan: planner.confinedSessionPlan }
    const plan = confinementPlanFor(older, { provider: 'claude' })
    assert.equal(plan.ok, false)
    assert.equal(plan.code, 'AGENT_CONFINEMENT_SIGNED_OUT')
  })
})

test('an absent provider is the Codex path, because the agent page start has no tier', () => {
  withMachine({ codexSignedIn: false }, () => {
    const plan = confinementPlanFor(planner, {})
    assert.equal(plan.ok, false)
    assert.equal(plan.code, 'AGENT_CONFINEMENT_SIGNED_OUT')
  })
})
