/* REMOVING A NODE FROM THE TREE — the missing leg the owner named, verbatim:
 * "there was also no way to remove an old node you wanted to delete."
 *
 * Trees could create agents, drag them between slots and trees, rename them,
 * start and stop them — and never remove one. This suite holds the leg that
 * closes that, and the three promises that make it safe:
 *
 *   1. ONE AGENT, NEVER A SURPRISE BRANCH. The store refuses a parent until
 *      its agents are moved or removed, and refuses a live agent until it is
 *      stopped — and the palette row shows THE SAME sentences, because they
 *      are one exported table (NODE_REMOVE_REFUSALS). One truth, two readers.
 *   2. WHAT GOES AND WHAT STAYS IS SAID BEFORE IT HAPPENS. The confirm stage
 *      names the agent and its saved conversation; the signed run records are
 *      the permanent record and are never touched. The view deletes the
 *      transcript through session-transcript-store's OWN remove(), never raw
 *      key surgery.
 *   3. NO GHOST. The window's node- and session-keyed caches are emptied on
 *      the same beat, so no stale reply can resurface on a later node.
 *
 * The store rules run against the real store (tools/test/fleet-trees.test.mjs
 * holds the rest of that contract); the view wiring is pinned against the
 * source the same way tools/test/palette-rows.test.mjs pins its table, because
 * chatActionRowsFor and performNodeRemoval live inside the view's closure.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { NODE_REMOVE_REFUSALS, createFleetTreeStore } from '../../src/fleet-trees.js'
import { REMOVE_PANEL } from '../../src/fleet-tree-copy.js'
import { createTranscriptStore } from '../../src/session-transcript-store.js'

const VIEW = readFileSync(new URL('../../src/views/computers.js', import.meta.url), 'utf8')

/* ------------------------------------------------------------- the words -- */

test('the refusal sentences are the store’s own, and the palette shows the same strings', () => {
  assert.equal(NODE_REMOVE_REFUSALS.running, 'Stop this agent first.')
  assert.equal(NODE_REMOVE_REFUSALS.children(2), 'Move or remove its two agents first.')
  assert.equal(NODE_REMOVE_REFUSALS.children(1), 'Move or remove its one agent first.')
  /* IDENTITY, not equality of copies: the palette keys ARE the store's table,
     so a rewording in either place is a rewording in both. */
  assert.equal(REMOVE_PANEL.whyRunning, NODE_REMOVE_REFUSALS.running)
  assert.equal(REMOVE_PANEL.whyChildren, NODE_REMOVE_REFUSALS.children)
})

test('the confirm stage names what goes and what is kept, in the decided words', () => {
  assert.equal(REMOVE_PANEL.action, 'Remove this agent')
  assert.equal(REMOVE_PANEL.go, 'Remove')
  assert.equal(
    REMOVE_PANEL.confirm('Manager'),
    'This removes Manager and its saved conversation here. The signed run records are kept.',
  )
  /* The success sentence keeps the same two facts: gone here, kept forever. */
  assert.match(REMOVE_PANEL.done('Manager'), /Manager/)
  assert.match(REMOVE_PANEL.done('Manager'), /signed run records are kept/i)
})

/* ------------------------------------------------------------- the store -- */

function memoryStorage() {
  const cells = new Map()
  return {
    read(key) { return cells.has(key) ? JSON.parse(cells.get(key)) : null },
    write(key, value) { cells.set(key, JSON.stringify(value)); return true },
  }
}

const storeOf = () => {
  let count = 0
  let tick = 0
  return createFleetTreeStore({
    computerId: 'c1',
    storage: memoryStorage(),
    now: () => `2026-08-19T00:00:${String((tick += 1)).padStart(2, '0')}.000Z`,
    makeId: kind => `${kind}-${(count += 1)}`,
  })
}

test('the store refuses with exactly the sentences the row shows', () => {
  const store = storeOf()
  const top = store.addNode({ role: 'top' }).node
  const child = store.addNode({ parentId: top.id }).node

  assert.deepEqual([...store.removeNode(top.id).problems], [NODE_REMOVE_REFUSALS.children(1)])

  store.attachSession(child.id, 'run-1')
  assert.deepEqual([...store.removeNode(child.id).problems], [NODE_REMOVE_REFUSALS.running])
  store.setNodeStatus(child.id, 'running')
  assert.deepEqual([...store.removeNode(child.id).problems], [NODE_REMOVE_REFUSALS.running])

  store.setNodeStatus(child.id, 'finished')
  assert.equal(store.removeNode(child.id).ok, true)
  const emptied = store.removeNode(top.id)
  assert.equal(emptied.ok, true)
  assert.equal(emptied.removedTreeId, top.treeId, 'the emptied tree goes with its last agent')
})

/* -------------------------------------------------- the durable transcript -- */

test('the transcript record leaves through the store’s own API, and only that node’s', () => {
  const storage = memoryStorage()
  const transcripts = createTranscriptStore({ computerId: 'c1', storage })
  const lines = [{ who: 'you', text: 'do the thing', at: 1 }, { who: 'agent', text: 'done', at: 2 }]
  assert.equal(transcripts.save('node-gone', { lines }), true)
  assert.equal(transcripts.save('node-stays', { lines }), true)

  assert.equal(transcripts.remove('node-gone'), true)
  assert.equal(transcripts.get('node-gone'), null, 'the removed node’s conversation is gone')
  assert.equal(transcripts.has('node-gone'), false)
  assert.ok(transcripts.get('node-stays'), 'nobody else’s conversation went with it')
  assert.equal(transcripts.remove('node-gone'), true, 'removing what is already gone is not an error')
})

/* ------------------------------------------------------------ the wiring -- */

function functionBody(name, until) {
  const at = VIEW.indexOf(name)
  assert.ok(at > 0, `${name} is not in the computers view`)
  const stop = VIEW.indexOf(until, at)
  assert.ok(stop > at, `${until} no longer follows ${name}; the pin needs re-aiming`)
  return VIEW.slice(at, stop)
}

test('the palette row opens a confirm sub-stage and the confirmed press reaches the removal', () => {
  const table = functionBody('function chatActionRowsFor', 'async function resumeNodeSession')
  assert.match(table, /id: 'remove'[^\n]*group: danger/, 'the remove row left the destructive group')
  assert.match(table, /id: 'remove'[^\n]*ctx\.show\(removeRows\(\)/, 'the remove row no longer opens the confirm stage')
  assert.match(table, /REMOVE_PANEL\.confirm\(/, 'the confirm stage lost the sentence naming what goes')
  assert.match(table, /performNodeRemoval\(/, 'the confirmed press does not reach performNodeRemoval')
  /* The confirmed press closes the popup first, the way rewind’s and depth’s
     sub-stages do, because the removal disposes the chat under it. */
  assert.match(table, /goCtx\.close\(\)\s*\n\s*void performNodeRemoval/, 'the confirm press does not close the popup before removing')
})

test('the removal deletes the transcript through the store API and cleans every cache', () => {
  /* The end pin was `function showControls`, which died with the simulated
     second render; the tombstone comment that replaced it is the next stable
     marker after performNodeRemoval's close. */
  const body = functionBody('async function performNodeRemoval', '/* showControls')
  assert.match(body, /treeStore\.removeNode\(/, 'the store’s removeNode is not the thing doing the removing')
  assert.match(body, /transcriptStore\?\.remove\(/, 'the durable conversation is not removed through the store’s own API')
  assert.doesNotMatch(body, /localStorage|storage\.write|setItem/, 'raw key surgery beside the store’s own API')
  for (const cache of ['nodeReplies.delete', 'nodeActivity.delete', 'sessionNodeIds.delete', 'sessionTranscripts.delete', 'sessionTurnLog.delete', 'sessionTurnText.delete', 'turnReplies.delete', 'outboxClearSession']) {
    assert.ok(body.includes(cache), `${cache} is missing -- a ghost of the removed node can resurface`)
  }
  /* The refusal is re-judged at the press and reported in the store's words. */
  assert.match(body, /NODE_REMOVE_REFUSALS\.running/, 'a race to running is not refused in the one-truth words')
  /* The rail returns to the overview, railFollowsCanvas’s conservative answer. */
  assert.match(body, /currentRailTreeNode[\s\S]{0,120}showStats\(\)/, 'a rail left open on the removed node does not return to the overview')
  /* The canvas repaints without the node. */
  assert.match(body, /refreshTree\(\)/, 'the canvas is not repainted after the removal')
  /* WHAT IS KEPT: the signed ledger is never touched from this path. */
  assert.doesNotMatch(body, /spawnRecord|ledger|audit/i, 'the removal path names the signed records; they are read-only history')
})
