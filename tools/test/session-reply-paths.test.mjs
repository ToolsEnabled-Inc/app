/* C6/C7 host mechanics against the recording fixture engine: rewind rebinds
 * the thread, the approval answer reaches the adapter in the adapter's own
 * shape, and per-turn options ride a real sendTurn. NO LIVE APPROVAL PROBE IS
 * POSSIBLE and that limitation is stated here on purpose: approvalPolicy is
 * 'never' at every tier, so nothing fires an approval_request on a real
 * session today — the reply path ships FIRST, which is the ordering the
 * confinement module's own comment demands. The rewind SEMANTICS were proven
 * live separately (tools/agent-rewind-probe.mjs, 2026-08-14: PASS). */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require_ = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const { createAgentHost } = require_(path.join(ROOT, 'shell/agent-host.cjs'))

const CONFINED_ENGINE = path.join(ROOT, 'tools/test/fixtures/confined-engine/src/lib/agent-engine/codex-process.js')

function withPlan(plan, run) {
  const previous = process.env.MC_TEST_CONFINEMENT_PLAN
  process.env.MC_TEST_CONFINEMENT_PLAN = JSON.stringify(plan)
  return Promise.resolve(run()).finally(() => {
    if (previous === undefined) delete process.env.MC_TEST_CONFINEMENT_PLAN
    else process.env.MC_TEST_CONFINEMENT_PLAN = previous
  })
}

function adapterCalls() {
  return require_(CONFINED_ENGINE).adapterCalls
}

function plannedHost(workdir) {
  const plan = {
    ok: true, tier: 'guided', isolated: true,
    threadOptions: { sandbox: 'read-only', approvalPolicy: 'never' },
    env: { CODEX_HOME: path.join(workdir, 'agent-home') },
  }
  return withPlan(plan, async () => {
    const host = createAgentHost({ enginePath: CONFINED_ENGINE, defaultCwd: workdir })
    await host.startSession({ sessionId: 'reply-paths-1' })
    return host
  })
}

test('rewind forks at the named turn and every later send rides the forked thread', async () => {
  const workdir = mkdtempSync(path.join(tmpdir(), 'mc-reply-paths-'))
  const host = await plannedHost(workdir)
  const before = adapterCalls().length
  const rewound = await host.rewindSession({ sessionId: 'reply-paths-1', turnId: 'turn-2' })
  assert.equal(rewound.threadId, 'thread-forked')
  const fork = adapterCalls()[before]
  assert.equal(fork.method, 'forkThread')
  assert.equal(fork.threadId, 'thread-1', 'the fork must name the thread the session held')
  assert.equal(fork.forkOptions.lastTurnId, 'turn-2', 'the fork must name the turn the person picked')
  await host.sendTurn({ sessionId: 'reply-paths-1', text: 'after the rewind' })
  const send = adapterCalls()[adapterCalls().length - 1]
  assert.equal(send.method, 'sendTurn')
  assert.equal(send.request.threadId, 'thread-forked',
    'a send after a rewind still rode the OLD thread — the erased half would be back')
})

test('the approval answer reaches the adapter in the adapter\'s own shape', async () => {
  const workdir = mkdtempSync(path.join(tmpdir(), 'mc-reply-paths-'))
  const host = await plannedHost(workdir)
  const before = adapterCalls().length
  const answered = await host.answerApproval({ sessionId: 'reply-paths-1', approvalId: 'codex:approve:1', decision: 'decline' })
  assert.equal(answered.decision, 'decline')
  const call = adapterCalls()[before]
  assert.equal(call.method, 'answerApproval')
  assert.deepEqual(call.answer, { approvalId: 'codex:approve:1', response: { decision: 'decline' } },
    'the host must speak the adapter\'s exact answer shape — a second dialect is how replies stop landing')
})

test('a per-turn model option rides the wire with the plan\'s policy over it', async () => {
  const workdir = mkdtempSync(path.join(tmpdir(), 'mc-reply-paths-'))
  const host = await plannedHost(workdir)
  await host.sendTurn({ sessionId: 'reply-paths-1', text: 'switch', options: { model: 'gpt-5.6-terra' } })
  const send = adapterCalls()[adapterCalls().length - 1]
  assert.equal(send.method, 'sendTurn')
  assert.deepEqual(send.request.options, { model: 'gpt-5.6-terra', approvalPolicy: 'never' },
    'the optioned turn must carry the chosen model AND the plan\'s own policy, nothing else')
})

test('the renderer half exists: the approval card is event-driven and answers through the channel', () => {
  const { readFileSync } = require_('node:fs')
  const view = readFileSync(path.join(ROOT, 'src/views/computers.js'), 'utf8')
  assert.match(view, /renderApprovalCard\(sessionId, activity\)/, 'an approval request no longer reaches the card')
  const card = view.slice(view.indexOf('function renderApprovalCard'))
  assert.match(card.slice(0, 2400), /availableDecisions\.map/, 'the card must offer exactly the decisions the request named')
  assert.match(card.slice(0, 2400), /bridge\.answerApproval\(\{ sessionId, approvalId: approval\.approvalId, decision \}\)/,
    'the card no longer answers through the channel')
  const events = readFileSync(path.join(ROOT, 'src/agent-session-events.js'), 'utf8')
  assert.match(events, /availableDecisions/, 'the reader drops the decision vocabulary the card needs')
})
