// Messaging a dead agent just works (iteration 6, owner: "We still get this
// message" — the sessionGone refusal standing where a recovery belongs).
//
// The pins here are the recovery's ORDER, because the order is the
// correctness: the phantom you-line strips BEFORE the resume reads the saved
// conversation (or the words ride twice — once in the seed, once queued); the
// typed message queues AFTER the fresh session exists; and the honest dead
// end survives as the fallback for the day the recovery itself fails.
//
// Beneath it all, the liveness rule: a restart-stale node (saved 'running'
// loads as 'starting', forever, over a session this run never owned) must
// read NOT-busy, or its sends park in a queue nothing will ever drain and the
// recovery is unreachable.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const view = readFileSync(join(ROOT, 'src', 'views', 'computers.js'), 'utf8')

test('busy is liveness, not status — and the send path uses it', () => {
  /* The rule moved into src/tree-session-liveness.js when the restart-stale
     defect was closed, because six surfaces on this page needed to ask the same
     question and each was answering it its own way. It is DRIVEN in
     tools/test/zombie-session.test.mjs rather than matched; what is pinned here
     is that this view still reads it from there. */
  const liveness = view.slice(view.indexOf('const nodeSessionLive'), view.indexOf('const nodeSessionLive') + 200)
  assert.match(liveness, /sessionIsLive\(node, sessionNodeIds\)/,
    'the view stopped asking the shared liveness rule; restart-stale nodes read busy forever again')
  assert.match(view, /from '\.\.\/tree-session-liveness\.js'/,
    'the shared liveness rule is no longer imported by the page that needs it')
  const rule = view.slice(view.indexOf('const nodeBusy'), view.indexOf('const nodeBusy') + 400)
  assert.match(rule, /nodeIsBusy\(node, sessionNodeIds\)/,
    'nodeBusy no longer checks session liveness; restart-stale nodes read busy forever again')
  const send = view.slice(view.indexOf('function treeCardSend'), view.indexOf('function treeCardSend') + 2400)
  assert.match(send, /if \(nodeBusy\(node\)\)/, "treeCardSend's busy branch stopped using the liveness rule")
  assert.ok(!/const busy = node\.status === 'starting' \|\| node\.status === 'running'/.test(send),
    'the raw status busy test is back in treeCardSend; dead sessions eat messages again')
})

test('the unknown-session rejection hands the send to the recovery, and only that code', () => {
  const send = view.slice(view.indexOf('function treeCardSend'), view.indexOf('async function recoverDeadSessionSend'))
  assert.match(send, /refusalCode\(error\) === 'MC_AGENT_UNKNOWN_SESSION'/,
    'the dead-session code no longer routes to the recovery; the person reads the refusal again')
  assert.match(send, /recoverDeadSessionSend\(node, text/, 'the recovery call left the rejection branch')
  assert.match(send, /fail\(startRefusalSentence\(/, 'other refusal codes lost their sentences')
})

test('the phantom you-line strips from BOTH copies before the resume reads them', () => {
  /* THE STRIP MOVED, AND THE RULE DID NOT. It used to live inside
     recoverDeadSessionSend, BELOW that function's three early returns (the
     start-control switch, the quarter-minute limiter, the already-recovering
     guard), so a refused or rate-limited recovery left the line standing --
     a phantom YOU bubble as the only thing a panel drew. It now runs in the
     rejection branch that dispatches the recovery, which is above all three
     and still before the resume reads the record. Both copies, same order. */
  const strip = view.slice(view.indexOf('function stripPhantomYouLine'))
  const body = strip.slice(0, strip.indexOf('async function recoverDeadSessionSend'))
  assert.ok(body.indexOf('held.pop()') !== -1, 'the window transcript keeps the phantom you-line; the words ride twice')
  assert.ok(body.indexOf('transcriptStore.save(node.id, { lines: trimmed') !== -1,
    'the durable record keeps the phantom you-line; the seed reads it and the queue re-sends it')
  const send = view.slice(view.indexOf('function treeCardSend'), view.indexOf('function stripPhantomYouLine'))
  const branch = send.slice(send.indexOf("refusalCode(error) === 'MC_AGENT_UNKNOWN_SESSION'"))
  assert.ok(branch.indexOf('stripPhantomYouLine(') !== -1, 'the refused send hands to the recovery without taking its line back')
  assert.ok(branch.indexOf('stripPhantomYouLine(') < branch.indexOf('recoverDeadSessionSend('),
    'the resume runs before the strip — it seeds the phantom line into the fresh agent')
  const recovery = view.slice(view.indexOf('async function recoverDeadSessionSend'), view.indexOf('async function drainOutboxMessage'))
  assert.ok(recovery.indexOf('held.pop()') === -1,
    'the recovery strips a second time; typing the same words twice would then take a real line')
})

test('a recovered message goes straight to a resumed agent, and queues only behind a summary', () => {
  /* Iteration 7 split the two cases, because they are no longer the same.
     A TRUE resume gives the agent its own memory back and leaves it idle,
     so the person's message is an ordinary send. Only the fallback — a
     fresh agent reading the saved summary as its first turn — is busy on
     arrival, and only there does the message queue behind it. */
  /* SLICED BY STRUCTURE, NOT BY BYTE COUNT. These windows used to be
     `indexOf(...) + 4200`, and a comment added above the needle pushed it out
     of range -- the test then reported a real behaviour as missing. The
     function's own end is the honest boundary. */
  const recovery = view.slice(view.indexOf('async function recoverDeadSessionSend'), view.indexOf('async function drainOutboxMessage'))
  assert.match(recovery, /ok === 'engine' \|\| !seeded/,
    'the recovery stopped distinguishing a real resume from a summary; a resumed agent would be sent nothing')
  assert.match(recovery, /outboxEnqueue\(fresh\.sessionId, text\)/,
    'the summary path no longer queues the message behind the seed turn')
  /* And no SECOND drain site appeared: the listener's turn-completion drain
     is the only trigger, seeded recovery included. */
  const listener = view.slice(view.indexOf('unsubs.push(window.mcAgent.onEvent'))
  assert.equal((listener.match(/outboxTakeNext\(sessionId\)/g) || []).length, 1,
    'a second drain site raced the first')
})

test('the recovery is bounded and the honest dead end survives it', () => {
  /* SLICED BY STRUCTURE, NOT BY BYTE COUNT. These windows used to be
     `indexOf(...) + 4200`, and a comment added above the needle pushed it out
     of range -- the test then reported a real behaviour as missing. The
     function's own end is the honest boundary. */
  const recovery = view.slice(view.indexOf('const recoveringNodes'), view.indexOf('async function drainOutboxMessage'))
  assert.match(recovery, /recentRecoveries/, 'the per-node recovery bound is gone; an instantly-dying session bounces forever')
  assert.match(recovery, /fail\(START_REFUSAL\.sessionGone\)/,
    'the sessionGone sentence no longer backs the recovery — a failed resume goes silent')
  assert.match(recovery, /RECOVERED_SESSION\.reconnecting/, 'the recovery no longer says what it is doing')
  /* The cost sentence is said only where a cost was paid. A real resume
     re-sends nothing, so promising tokens up front would be charging him in
     words for something that did not happen. */
  assert.match(recovery, /ok !== 'engine' && seeded\) reply\(RECOVERED_SESSION\.summarised\)/,
    'the token-cost sentence is back on every recovery, including the ones that cost nothing')
})
