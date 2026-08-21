import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

import { SAID_PANEL } from '../../src/fleet-tree-copy.js'

/* THE ANSWER MUST REACH THE PAGE THE QUESTION WAS ASKED ON.
 *
 * Measured 2026-08-13 on the installed 1.0.7: a tree-started agent ran on a
 * live codex app-server child, the engine answered, and the tree page rendered
 * none of it -- no onEvent subscription, no reply surface, status frozen on
 * "starting". The owner's words for that state were "the agents dont respond",
 * and he was right about everything a person can see.
 *
 * These are source-shape guards in the same spirit as the fleet-trees suite:
 * each one pins the specific absence that produced that state, so it cannot
 * come back silently. They read the source, not the DOM, because the defect
 * was structural (nothing subscribed) rather than cosmetic.
 */

const ROOT = resolve(import.meta.dirname, '..', '..')
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8')

test('the tree view subscribes to the session stream and detaches with the view', () => {
  const source = read('src/views/computers.js')
  assert.match(source, /window\.mcAgent\.onEvent\(/,
    'computers.js no longer subscribes to session events; tree-started agents answer into a void again')
  assert.match(source, /unsubs\.push\(window\.mcAgent\.onEvent/,
    'the session listener is not registered through unsubs, so closing the view leaks it -- the exact leak the preload comment warns about')
})

test('the tree reads the stream only through the shared readers', () => {
  /* A second parser of the same stream is how one surface comes to be wrong
     without anybody noticing -- the agent page's CORRECTED note is the measured
     case. The tree must use the same two readers, not its own field reads. */
  const source = read('src/views/computers.js')
  /* NAMED RATHER THAN SPELLED OUT IN ORDER: the list grows (the turn-filing
     rule joined it), and pinning the exact line meant an added reader read as
     a defect. What matters is that every one of them comes from the shared
     module and that nothing parses the packet here. */
  const line = source.slice(source.indexOf("} from '../agent-session-events.js'") - 400, source.indexOf("} from '../agent-session-events.js'"))
  const imported = line.slice(line.lastIndexOf('import {') + 8).split(',').map(name => name.trim())
  for (const reader of ['sessionActivityEvent', 'sessionEventText', 'sessionEventTurnId', 'sessionTurnStatus', 'sessionTurnSucceeded', 'sessionUsageEvent']) {
    assert.ok(imported.includes(reader), `${reader} is no longer read through the shared module`)
  }
  assert.ok(!/packet\.event\.text|packet\.text|packet\.delta/.test(source),
    'computers.js reads raw packet fields instead of the shared readers')
})

test('a session is mapped to its node BEFORE its message is sent', () => {
  /* MEASURED 2026-08-17: the Claude CLI streams a turn, so its first words --
     and, for a short answer, its completion too -- reach this page before the
     send is answered. This map is what the listener filters on, so a map
     written after the send dropped that whole turn and left the node at
     `running` with nothing in it. Writing it from onSessionOpen is what makes
     the binding earlier than any event can be, for every engine rather than
     for the fast one. */
  const source = read('src/views/computers.js')
  const bindsOnOpen = source.indexOf("onSessionOpen: ({ sessionId, threadId }) =>")
  assert.ok(bindsOnOpen !== -1, 'the compose start no longer hands the session over as it opens')
  assert.ok(source.slice(bindsOnOpen, bindsOnOpen + 400).includes("sessionNodeIds.set(sessionId, node.id)"),
    'the session-to-node map is not written from onSessionOpen, so a streaming engine answers into a void again')
  const helper = source.slice(source.indexOf('export async function startAgentForNode'))
  const opened = helper.indexOf('onSessionOpen({ sessionId, threadId })')
  const sent = helper.indexOf('await bridge.send(')
  assert.ok(opened !== -1 && sent !== -1 && opened < sent,
    'startAgentForNode hands the session over AFTER it sends -- the binding is racing the engine again')
})

test('the reply is delivered once per turn, never once per token', () => {
  const source = read('src/views/computers.js')
  /* Two writes are legal and each has one meaning: the handler's, after the
     turn completes, and the mount rehydration copying the STORE's persisted
     reply back into the cache. Anything else is a new delivery path. */
  /* THREE, and the third is the turn BOUNDARY. A turn that ends without a
     turn_completed packet still said something, and until 2026-08-18 those
     words were silently carried into the next turn instead of being filed --
     the owner's "combine into each other". settleTurnBoundary files them once,
     when the engine names a different turn. It is a delivery path per TURN,
     which is the property this test exists to hold; a fourth write would not
     be. */
  const writes = source.match(/nodeReplies\.set\(/g) || []
  assert.equal(writes.length, 3, 'nodeReplies is written at exactly three places: turn completion, turn boundary, and store rehydration')
  assert.match(source, /function settleTurnBoundary/, 'the third write is not the turn-boundary settler; a per-delta write may have crept in')
  assert.match(source, /nodeReplies\.set\(node\.id, node\.reply\)/,
    'the rehydration write must copy the store\'s persisted reply, not compute one')
  const handler = source.slice(source.indexOf('unsubs.push(window.mcAgent.onEvent'))
  const statusCheck = handler.indexOf('sessionTurnStatus(packet, sessionId)')
  const replyWrite = handler.indexOf('nodeReplies.set(')
  assert.ok(statusCheck !== -1 && replyWrite > statusCheck,
    'the reply is written before the turn-completed check, i.e. per delta -- tens of thousands of one-word messages')
  /* The stream that MOVES during the turn is the appender, and it must flush
     before the reply takes over -- a truncated stream beside a complete reply
     would read as two different answers. */
  assert.match(handler, /flushNow\(\)/, 'the rail stream is not flushed on turn completion')
  /* Persistence: the turn's reply must reach the store, not only the cache.
     `said` is turnCompletionWords' answer -- streamed words, a failed turn's
     engine sentence, or the honest empty-turn line. */
  assert.match(handler, /setNodeReply\(nodeId, said\)/,
    'the completed reply is no longer persisted on the node')
})

test('the rail renders the said panel from the copy module, for sessions only', () => {
  const source = read('src/views/computers.js')
  assert.match(source, /SAID_PANEL\.title/, 'the rail no longer renders the "What it said" box')
  assert.match(source, /node\.sessionId \? `/,
    'the said box must exist only for nodes that hold a session; a draft node has nothing to have said')
})

test('the chip is a context window, never a telemetry card, for tree nodes', () => {
  /* Owner, 2026-08-13: "I dont see anything just nonsense. Its supposed to be
     a context window." The nonsense was deterministic: chat hardcoded null,
     statusNote cleared on success, so every successful run printed "nothing
     has run for this agent yet" under "telemetry unavailable". These pin the
     repair's three load-bearing pieces. */
  const view = read('src/views/computers.js')
  const feed = view.slice(view.indexOf('function treeContextFeed'), view.indexOf('function treeContextFeed') + 2200)
  assert.ok(!/chat:\s*null/.test(feed), 'treeContextFeed hardcodes chat null again — the context window went dark')
  assert.match(feed, /sessionTurnText\.get\(node\.sessionId\)/, 'the chip no longer streams the turn in flight')
  assert.match(feed, /nodeReplies\.get\(node\.id\) \|\| node\.reply/, 'the chip no longer shows the persisted reply')
  assert.match(feed, /asked: /, 'the chip no longer shows what was asked')

  const graph = read('src/tree-graph.js')
  assert.match(graph, /feed\.chat \|\| feed\.previous \? '' :/,
    'the telemetry-unavailable fallback is unconditional again — it prints over real context')
  assert.match(graph, /refreshChip\(agentId\)/, 'the narrow one-chip repaint is gone; streaming cannot reach the glass')
  assert.match(view, /scheduleChipRefresh\(/, 'nothing schedules chip repaints from the event stream')
  assert.match(view, /requestAnimationFrame\(/, 'chip repaints are not frame-batched')
})

test('the role menu says what a person can observe, not an internal lease', () => {
  const source = read('src/org-controls.js')
  assert.ok(!/reserve work/.test(source.replace(/\/\*[\s\S]*?\*\//g, '')),
    'the option label asserts the reserve-work mechanic again — no customer surface exhibits it')
  assert.match(source, /can be given jobs/, 'the enforced flag lost its observable-consequence label')
})

test('the said panel copy is whole, plain, and actionable', () => {
  for (const [key, sentence] of Object.entries(SAID_PANEL)) {
    assert.equal(typeof sentence, 'string', `${key} is not a sentence`)
    assert.ok(sentence.length > 10, `${key} is too short to mean anything: ${sentence}`)
  }
  /* Rule 3 of the copy module: a failure sentence ends with something to do. */
  assert.match(SAID_PANEL.emptyTurn, /Ask again/,
    'the empty-turn sentence no longer tells the person what to do next')
})
