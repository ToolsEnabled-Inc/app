// WHICH ENGINE A NO-TIER START REACHES, ON A MACHINE THAT ONLY HAS ONE.
//
// THE DEFECT, driven on a Claude-only foreign machine by the cross-machine
// lane: with no ~/.codex/auth.json anywhere, pressing Start from the agent
// page refused -- even with Claude installed and signed in -- because the
// no-tier start path assumed a CODEX confinement plan regardless of what the
// machine actually has. The provider-login lane fixed the refusal's WORDS
// (6a3ab66); this suite pins the ROUTING: the no-tier default resolves from
// the machine's real presence, per provider.
//
// Asserted on WHICH FIXTURE ENGINE RECORDED THE START, never on source text:
// a host that computes the right provider and then starts the other engine is
// exactly the failure a source scan cannot see.

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const { createAgentHost } = require_(path.join(ROOT, 'shell/agent-host.cjs'))
const CONFINED_ENGINE = path.join(ROOT, 'tools/test/fixtures/confined-engine/src/lib/agent-engine/codex-process.js')

function codexCalls() { return require_(CONFINED_ENGINE).calls }
function claudeCalls() {
  return require_(path.join(ROOT, 'tools/test/fixtures/confined-engine/src/lib/agent-engine/claude-cli-process.js')).calls
}

function withPlan(plan, run) {
  const previous = process.env.MC_TEST_CONFINEMENT_PLAN
  process.env.MC_TEST_CONFINEMENT_PLAN = JSON.stringify(plan)
  try { return run() } finally {
    if (previous === undefined) delete process.env.MC_TEST_CONFINEMENT_PLAN
    else process.env.MC_TEST_CONFINEMENT_PLAN = previous
  }
}

function guidedPlan(workdir) {
  return {
    ok: true, tier: 'guided', isolated: true,
    threadOptions: { sandbox: 'read-only', approvalPolicy: 'never' },
    env: { CODEX_HOME: path.join(workdir, 'agent-home') },
    servers: ['toolsenabled-readonly'],
  }
}

test('a no-tier start on a claude-only machine reaches the claude engine', async () => {
  const workdir = mkdtempSync(path.join(tmpdir(), 'mc-route-claude-'))
  try {
    await withPlan(guidedPlan(workdir), async () => {
      const host = createAgentHost({
        enginePath: CONFINED_ENGINE,
        defaultCwd: workdir,
        startProviderProbe: () => 'claude',
      })
      const codexBefore = codexCalls().length
      const claudeBefore = claudeCalls().length
      await host.startSession({ sessionId: 'route-claude-1' })
      assert.equal(claudeCalls().length, claudeBefore + 1,
        'the claude engine never saw the start; the no-tier path still assumes codex')
      assert.equal(codexCalls().length, codexBefore,
        'the codex engine was started on a machine the probe said cannot serve codex')
      await host.closeAll()
    })
  } finally {
    rmSync(workdir, { recursive: true, force: true, maxRetries: 5 })
  }
})

test('a no-tier start where codex serves keeps codex, exactly as before', async () => {
  const workdir = mkdtempSync(path.join(tmpdir(), 'mc-route-codex-'))
  try {
    await withPlan(guidedPlan(workdir), async () => {
      const host = createAgentHost({
        enginePath: CONFINED_ENGINE,
        defaultCwd: workdir,
        startProviderProbe: () => 'codex',
      })
      const codexBefore = codexCalls().length
      await host.startSession({ sessionId: 'route-codex-1' })
      assert.equal(codexCalls().length, codexBefore + 1, 'the ordinary codex default no longer starts codex')
      await host.closeAll()
    })
  } finally {
    rmSync(workdir, { recursive: true, force: true, maxRetries: 5 })
  }
})

test('a probe that throws falls back to the codex path this host has always taken', async () => {
  const workdir = mkdtempSync(path.join(tmpdir(), 'mc-route-fallback-'))
  try {
    await withPlan(guidedPlan(workdir), async () => {
      const host = createAgentHost({
        enginePath: CONFINED_ENGINE,
        defaultCwd: workdir,
        startProviderProbe: () => { throw new Error('probe fault') },
      })
      const codexBefore = codexCalls().length
      await host.startSession({ sessionId: 'route-fallback-1' })
      assert.equal(codexCalls().length, codexBefore + 1,
        'a broken probe must degrade to the path that existed before it, not to a refusal')
      await host.closeAll()
    })
  } finally {
    rmSync(workdir, { recursive: true, force: true, maxRetries: 5 })
  }
})

test('an explicit tier always outranks the probe', async () => {
  const workdir = mkdtempSync(path.join(tmpdir(), 'mc-route-explicit-'))
  try {
    await withPlan(guidedPlan(workdir), async () => {
      const host = createAgentHost({
        enginePath: CONFINED_ENGINE,
        defaultCwd: workdir,
        startProviderProbe: () => 'claude',
      })
      const codexBefore = codexCalls().length
      await host.startSession({ sessionId: 'route-explicit-1', tier: 'luna' })
      assert.equal(codexCalls().length, codexBefore + 1,
        'a person\'s explicit codex seat was rerouted by the presence probe')
      await host.closeAll()
    })
  } finally {
    rmSync(workdir, { recursive: true, force: true, maxRetries: 5 })
  }
})
