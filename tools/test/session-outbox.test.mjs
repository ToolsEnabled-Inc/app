import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

import {
  cancel,
  clearSession,
  enqueue,
  list,
  requeueFront,
  takeNext,
} from '../../src/session-outbox.js'

/* The owner's queue: messages written while the agent is busy. The store is
   renderer memory modeled on write-outcomes.js; these pin its contract, and
   the last test pins the WIRING — one message drained per completed turn,
   refusals back at the front — because a store nothing drains is a text box
   that eats words. */

const SID = 'session-test-outbox'

test('a queue holds what was written, in order, and gives it back one at a time', () => {
  clearSession(SID)
  assert.equal(enqueue(SID, 'first').ok, true)
  assert.equal(enqueue(SID, '  second  ').ok, true)
  const held = list(SID)
  assert.equal(held.length, 2)
  assert.equal(held[1].text, 'second', 'text is trimmed, not rewritten')
  assert.ok(Object.isFrozen(held), 'the listing is frozen')
  assert.equal(takeNext(SID).text, 'first', 'oldest first — the order the person said it')
  assert.equal(takeNext(SID).text, 'second')
  assert.equal(takeNext(SID), null, 'an empty queue hands over nothing')
})

test('refusals are sentences, and the bounds are real', () => {
  clearSession(SID)
  assert.equal(enqueue('', 'words').ok, false)
  assert.match(enqueue('', 'words').sentence, /Start it first/)
  assert.equal(enqueue(SID, '   ').ok, false)
  assert.match(enqueue(SID, '').sentence, /Write the message first/)
  const long = 'x'.repeat(5000)
  const bounded = enqueue(SID, long)
  assert.equal(bounded.ok, true)
  assert.equal(bounded.entry.text.length, 4000, 'a message is capped like the composer that wrote it')
  clearSession(SID)
  for (let i = 0; i < 12; i += 1) assert.equal(enqueue(SID, `m${i}`).ok, true)
  const overflow = enqueue(SID, 'one too many')
  assert.equal(overflow.ok, false)
  assert.match(overflow.sentence, /12 messages waiting/)
  clearSession(SID)
})

test('unqueue removes exactly the named message; a refused send goes back to the FRONT', () => {
  clearSession(SID)
  const a = enqueue(SID, 'alpha').entry
  enqueue(SID, 'beta')
  assert.equal(cancel(SID, a.id), true)
  assert.equal(list(SID)[0].text, 'beta')
  assert.equal(cancel(SID, 'ob-nope'), false, 'absence is not success')
  const taken = takeNext(SID)
  assert.equal(requeueFront(SID, taken), true)
  assert.equal(list(SID)[0].text, 'beta', 'the refused send is still the next thing the person said')
  assert.equal(clearSession(SID), 1)
  assert.equal(list(SID).length, 0)
})

test('the palette holds only real actions, and says what it cannot do in words', () => {
  const ROOT = resolve(import.meta.dirname, '..', '..')
  const view = readFileSync(resolve(ROOT, 'src/views/computers.js'), 'utf8')
  const copy = readFileSync(resolve(ROOT, 'src/fleet-tree-copy.js'), 'utf8')
  /* The unsupported set lives in ONE footer sentence, never as controls. A
     rendered "Rewind" or "Switch model" row would be the temperature-slider
     defect back again. */
  const palette = view.slice(view.indexOf('function showPalette'), view.indexOf('function showControls'))
  assert.ok(palette.length > 200, 'the palette left computers.js')
  assert.ok(!/[Rr]ewind|[Ss]witch model/.test(palette), 'the palette renders a control for an unsupported action')
  assert.match(copy, /Not possible yet, so not listed/, 'the honest footer sentence is gone')
  assert.match(palette, /PALETTE_PANEL\.footer/, 'the palette no longer shows the footer')
  /* Every action id in the palette must have a handler branch. */
  for (const id of ['interrupt', 'stop', 'child', 'queue', 'move', 'copy-brief', 'copy-reply']) {
    assert.ok(view.includes(`'${id}'`), `palette action ${id} lost its binding`)
  }
  assert.match(view, /data-open-palette/, 'the rail lost its way into the palette')
})

test('the compact card is real-sourced or absent, never the simulator', () => {
  const ROOT = resolve(import.meta.dirname, '..', '..')
  const graph = readFileSync(resolve(ROOT, 'src/tree-graph.js'), 'utf8')
  const view = readFileSync(resolve(ROOT, 'src/views/computers.js'), 'utf8')
  /* The card exists only when the view vouches for a real onSend — that is
     what makes buildChat's seeded/canned path unreachable. No config → the
     chip routes to the rail. And only one card opens at a time. */
  const start = graph.indexOf('if (record.agent.treeNode)')
  const branch = graph.slice(start, start + 2200)
  assert.match(branch, /typeof config\.onSend !== 'function'/, 'a card can open without a real send path')
  assert.match(branch, /onOpenControls\?\.\(record\.agent\)/, 'a source-less chip no longer falls back to the rail')
  assert.match(branch, /seed: 0/, 'the tree card seeds fake history again')
  assert.match(branch, /closeChat\(other\)/, 'one-chat-at-a-time is no longer enforced')
  /* Busy sends queue; idle sends register the card reply slot BEFORE the wire
     call, and the turn-completed branch delivers to it before draining. */
  const send = view.slice(view.indexOf('function treeCardSend'), view.indexOf('function drainOutboxMessage'))
  assert.match(send, /outboxEnqueue\(node\.sessionId, text\)/, 'a busy card send no longer queues')
  assert.ok(send.indexOf('cardReplies.set') < send.indexOf('bridge.send({ sessionId'), 'the reply slot registers after the send — a fast turn could race it')
  const turn = view.slice(view.indexOf('unsubs.push(window.mcAgent.onEvent'))
  assert.ok(turn.indexOf('cardReplies.get(sessionId)') < turn.indexOf('outboxTakeNext(sessionId)'),
    'the card reply is delivered after the drain — the queued send would steal the turn')
})

test('the view drains one message per completed turn, and requeues on refusal', () => {
  const ROOT = resolve(import.meta.dirname, '..', '..')
  const view = readFileSync(resolve(ROOT, 'src/views/computers.js'), 'utf8')
  const turnBranch = view.slice(view.indexOf('unsubs.push(window.mcAgent.onEvent'))
  const statusCheck = turnBranch.indexOf('sessionTurnStatus(packet, sessionId)')
  const drain = turnBranch.indexOf('outboxTakeNext(sessionId)')
  assert.ok(statusCheck !== -1 && drain > statusCheck,
    'the drain left the turn-completed branch — the queue has no honest trigger anywhere else')
  assert.equal((turnBranch.match(/outboxTakeNext\(sessionId\)/g) || []).length, 1,
    'exactly one drain site in the listener; a second would race the first')
  const drainer = view.slice(view.indexOf('async function drainOutboxMessage'))
  assert.match(drainer.slice(0, 1200), /outboxRequeueFront\(sessionId, entry\)/,
    'a refused drained send no longer returns to the front of the queue')
  assert.match(view, /data-tree-queue-list/, 'the queue lost its visible strip; a store nobody sees eats words')
})
