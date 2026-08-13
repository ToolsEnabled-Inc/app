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
  assert.match(source, /import \{ sessionEventText, sessionTurnStatus \} from '\.\.\/agent-session-events\.js'/)
  assert.ok(!/packet\.event\.text|packet\.text|packet\.delta/.test(source),
    'computers.js reads raw packet fields instead of the shared readers')
})

test('a session is mapped to its node at the one place a session is born', () => {
  const source = read('src/views/computers.js')
  assert.match(source, /sessionNodeIds\.set\(result\.sessionId, node\.id\)/,
    'the session-to-node map is no longer written on start, so no reply can find its node')
})

test('the reply is delivered once per turn, never once per token', () => {
  const source = read('src/views/computers.js')
  const writes = source.match(/nodeReplies\.set\(/g) || []
  assert.equal(writes.length, 1, 'nodeReplies must be written in exactly one place, after the turn completes')
  const handler = source.slice(source.indexOf('unsubs.push(window.mcAgent.onEvent'))
  const statusCheck = handler.indexOf('sessionTurnStatus(packet, sessionId)')
  const replyWrite = handler.indexOf('nodeReplies.set(')
  assert.ok(statusCheck !== -1 && replyWrite > statusCheck,
    'the reply is written before the turn-completed check, i.e. per delta -- tens of thousands of one-word messages')
})

test('the rail renders the said panel from the copy module, for sessions only', () => {
  const source = read('src/views/computers.js')
  assert.match(source, /SAID_PANEL\.title/, 'the rail no longer renders the "What it said" box')
  assert.match(source, /node\.sessionId \? `/,
    'the said box must exist only for nodes that hold a session; a draft node has nothing to have said')
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
