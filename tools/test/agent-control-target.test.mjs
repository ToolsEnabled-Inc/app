import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import {
  CANONICAL_ROOT,
  PROJECT_ROOT,
  assertValidProjection,
  readSchema,
  validateAgainstSchema,
} from '../gen-projection-lib.mjs'

const FIXED_NOW = '2026-08-06T19:00:00.000Z'
const DECLARED = Object.freeze({
  running: 'coordinator-sol',
  // R1186/R1187 (2026-08-08, canonical config/agent-org.json rev18) retired the
  // 'claude' agent id: the sole Claude shadow-manager seat became
  // 'shadow-manager-opus5' under the Opus 5 Ultra org. 'coordinator-sol' is
  // retained (disabled, role 'observer') rather than removed, so it still
  // resolves; 'claude' does not and must track its successor id here.
  starting: 'shadow-manager-opus5',
  finished: 'codex-manager-reconcile',
  failed: 'codex-manager-platform',
  stale: 'codex-manager-release',
  missing: 'codex-manager-deep-systems',
})
const FORBIDDEN_VALUES = Object.freeze([
  'registry-worktree-value',
  'registry-brief-value',
  'registry-console-log-value',
  'registry-launch-spec-value',
  'registry-checkpoint-value',
  'registry-prompt-value',
  'registry-task-handle-value',
  'registry-verdict-value',
  'registry-mailbox-value',
  'registry-path-value',
  'registry-command-value',
])

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, 'utf8')
}

function copyCanonicalReaders(root) {
  for (const name of ['agent-org.js', 'agent-presence.js']) {
    const target = join(root, 'src', 'lib', name)
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(join(CANONICAL_ROOT, 'src', 'lib', name), target)
  }
  const fleetState = join(root, 'src', 'lib', 'fleet-supervisor', 'state.js')
  mkdirSync(dirname(fleetState), { recursive: true })
  copyFileSync(join(CANONICAL_ROOT, 'src', 'lib', 'fleet-supervisor', 'state.js'), fleetState)
  const orgConfig = join(root, 'config', 'agent-org.json')
  mkdirSync(dirname(orgConfig), { recursive: true })
  copyFileSync(join(CANONICAL_ROOT, 'config', 'agent-org.json'), orgConfig)
}

function liveFixture(root) {
  write(join(root, 'tools', 'agent-preflight.js'), `
process.stdout.write(JSON.stringify({
  generatedAt: '${FIXED_NOW}',
  otherAgents: { codex: [], claude: [], activeWindowMinutes: 90 }
}));
`)
}

function presenceRecord({ agentId, runId, status, pid, recordRevision, startedAt }) {
  const terminal = status === 'finished' || status === 'failed'
  return {
    agentId,
    runId,
    recordRevision,
    role: 'manager',
    tier: 'gpt-5.6-sol/xhigh',
    reportsTo: null,
    dispatcher: 'owner',
    lane: 'registry-lane-value',
    territory: 'registry-territory-value',
    currentTask: 'registry-task-handle-value',
    brief: 'registry-brief-value',
    consoleLog: 'registry-console-log-value',
    worktree: 'registry-worktree-value',
    launchSpec: 'registry-launch-spec-value',
    pid,
    startedAt,
    lastHeartbeat: startedAt + 500,
    status,
    exitCode: terminal ? (status === 'finished' ? 0 : 1) : null,
    lastVerdict: terminal ? 'registry-verdict-value' : null,
    terminalAt: terminal ? startedAt + 1_000 : null,
    staleReason: status === 'stale' ? 'registry-stale-reason-value' : null,
    mailboxOffset: 123,
    respawnCount: 2,
    verdictConsumedAt: terminal ? startedAt + 1_100 : null,
    checkpoint: 'registry-checkpoint-value',
    prompt: 'registry-prompt-value',
    taskHandle: 'registry-task-handle-value',
    mailbox: 'registry-mailbox-value',
    path: 'registry-path-value',
    command: 'registry-command-value',
  }
}

function validPresenceState() {
  const specs = [
    [DECLARED.running, 'aaaaaaaa-00000001', 'running', 41001],
    [DECLARED.starting, 'aaaaaaaa-00000002', 'starting', null],
    [DECLARED.finished, 'aaaaaaaa-00000003', 'finished', 41003],
    [DECLARED.failed, 'aaaaaaaa-00000004', 'failed', 41004],
    [DECLARED.stale, 'aaaaaaaa-00000005', 'stale', 41005],
    ['registry-only', 'aaaaaaaa-00000006', 'running', 41006],
  ]
  return {
    schemaVersion: 1,
    revision: 29,
    updatedAt: 1_786_030_000_000,
    agents: Object.fromEntries(specs.map(([agentId, runId, status, pid], index) => [
      agentId,
      presenceRecord({
        agentId,
        runId,
        status,
        pid,
        recordRevision: index + 1,
        startedAt: 1_786_030_001_000 + (index * 10_000),
      }),
    ])),
  }
}

function runAgentsFixture(t, presenceState) {
  const fixture = mkdtempSync(join(tmpdir(), 'mc-agent-control-target-'))
  t.after(() => rmSync(fixture, { recursive: true, force: true }))
  const canonical = join(fixture, 'canonical')
  const live = join(fixture, 'live')
  const output = join(fixture, 'output')
  copyCanonicalReaders(canonical)
  liveFixture(live)
  write(join(canonical, 'state', 'agent-presence.json'), JSON.stringify(presenceState))

  const run = spawnSync(process.execPath, [join(PROJECT_ROOT, 'tools', 'gen-agents.mjs')], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      MC_NOW: FIXED_NOW,
      MC_CANONICAL_ROOT: canonical,
      MC_LIVE_ROOT: live,
      MC_OUTPUT_ROOT: output,
    },
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  })
  assert.equal(run.status, 0, run.stderr)
  return JSON.parse(readFileSync(join(output, 'agents.json'), 'utf8'))
}

function declaredAgent(payload, id) {
  const agent = payload.data.declared.find(candidate => candidate.id === id)
  assert.ok(agent, `missing declared fixture agent ${id}`)
  return agent
}

function withRunningTarget(payload, mutate) {
  const candidate = structuredClone(payload)
  const agent = declaredAgent(candidate, DECLARED.running)
  mutate(agent)
  return candidate
}

test('agents generator emits exact canonical control targets for every truthful presence status', t => {
  const payload = runAgentsFixture(t, validPresenceState())
  assert.doesNotThrow(() => assertValidProjection('agents', payload))
  assert.ok(payload.data.declared.every(agent => Object.hasOwn(agent, 'controlTarget')))

  const running = declaredAgent(payload, DECLARED.running).controlTarget
  assert.deepEqual(running, {
    agentId: DECLARED.running,
    runId: 'aaaaaaaa-00000001',
    pid: 41001,
    status: 'running',
    recordRevision: 1,
    startedAt: 1_786_030_001_000,
    lastHeartbeat: 1_786_030_001_500,
  })
  assert.deepEqual(declaredAgent(payload, DECLARED.starting).controlTarget, {
    agentId: DECLARED.starting,
    runId: 'aaaaaaaa-00000002',
    pid: null,
    status: 'starting',
    recordRevision: 2,
    startedAt: 1_786_030_011_000,
    lastHeartbeat: 1_786_030_011_500,
  })
  for (const status of ['finished', 'failed', 'stale']) {
    assert.equal(declaredAgent(payload, DECLARED[status]).controlTarget.status, status)
  }
  assert.equal(declaredAgent(payload, DECLARED.missing).controlTarget, null)
  assert.equal(payload.data.declared.some(agent => agent.id === 'registry-only'), false)

  const serialized = JSON.stringify(payload)
  assert.equal(serialized.includes('registry-only'), false)
  for (const value of FORBIDDEN_VALUES) assert.equal(serialized.includes(value), false, value)
  for (const agent of payload.data.declared.filter(candidate => candidate.controlTarget !== null)) {
    assert.deepEqual(Object.keys(agent.controlTarget).sort(), [
      'agentId',
      'lastHeartbeat',
      'pid',
      'recordRevision',
      'runId',
      'startedAt',
      'status',
    ])
  }
})

test('malformed canonical presence remains fail-closed through the existing source envelope', t => {
  const payload = runAgentsFixture(t, {
    schemaVersion: 1,
    revision: 1,
    updatedAt: null,
    agents: { [DECLARED.running]: { agentId: DECLARED.running, runId: 'malformed' } },
  })
  assert.equal(payload.ok, true)
  assert.ok(payload.data.declared.every(agent => agent.controlTarget === null))
  const source = payload.sources.find(candidate => candidate.id === 'agent-presence')
  assert.deepEqual(source, {
    id: 'agent-presence',
    kind: 'observed-registry',
    path: 'state/agent-presence.json',
    ok: false,
    observedAt: source.observedAt,
    reason: 'source-malformed',
  })
  assert.match(source.observedAt, /^\d{4}-\d{2}-\d{2}T/)
  assert.doesNotThrow(() => assertValidProjection('agents', payload))
})

test('agents schema rejects unsafe or malformed control-target shapes', async t => {
  const payload = runAgentsFixture(t, validPresenceState())
  const schema = readSchema('agents')
  const reject = (name, mutate) => t.test(name, () => {
    const candidate = withRunningTarget(payload, mutate)
    assert.ok(validateAgainstSchema(candidate, schema).length > 0)
  })

  await reject('extra field', agent => { agent.controlTarget.extraControlTargetField = true })
  await reject('malformed run id', agent => { agent.controlTarget.runId = 'NOT-A-RUN' })
  await reject('zero pid', agent => { agent.controlTarget.pid = 0 })
  await reject('negative pid', agent => { agent.controlTarget.pid = -1 })
  await reject('unknown status', agent => { agent.controlTarget.status = 'paused' })
  await reject('missing control target', agent => { delete agent.controlTarget })
  await reject('array control target', agent => { agent.controlTarget = [] })
  await reject('string pid', agent => { agent.controlTarget.pid = '41001' })
  for (const field of ['agentId', 'runId', 'status', 'recordRevision', 'startedAt', 'lastHeartbeat']) {
    await reject(`null ${field}`, agent => { agent.controlTarget[field] = null })
  }
  await reject('fractional record revision', agent => { agent.controlTarget.recordRevision = 1.5 })
})
