/* THE RAIL CHATBOX'S DECISIONS — especially the empty ones.
 *
 * Owner, verbatim: "On the right when you click a node there should be a
 * chatbox along with the other buttons."
 *
 * The failure this suite exists to prevent is not a blank screen. It is a box
 * that looks like a working chat and is not one. Two ways that happens:
 *
 *   · a composer that accepts what a person types and has nowhere to send it.
 *     A dispatched lane is handed its whole prompt on stdin at spawn and the
 *     pipe is closed; there is no second write. So for most nodes on page 2
 *     there is NO live channel, and the box has to say so rather than offer an
 *     input field.
 *
 *   · an empty box that reports the wrong emptiness. "Nobody has said
 *     anything" and "you switched every speaker off" look identical and are
 *     not: the second is undone by the person in one click and the first is
 *     not. src/chatbox-feed.js already distinguishes them; this suite proves
 *     the rail does not flatten them back together.
 *
 * WHICH AGENTS AND RUNS APPEAR IS NOT THIS FILE'S DECISION — it belongs to
 * src/chatbox-feed.js, which the settings page owns. These tests drive the
 * rail through that module's real storage keys rather than stubbing its
 * answers, so a rail that stopped honouring the person's settings fails here.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/* chatbox-feed.js reads localStorage directly and falls back to its defaults
   when storage refuses. Under `node --test` there is no storage at all, so
   without this the suite could only ever exercise the default settings — and
   the settings-dependent branches are exactly the ones worth proving. */
const store = new Map()
globalThis.localStorage = {
  getItem: key => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => { store.set(key, String(value)) },
  removeItem: key => { store.delete(key) },
  clear: () => store.clear(),
}

const { planNodeChatbox, channelCaption } = await import('../../src/node-chatbox.js')

const AGENT = { id: 'terra-01', name: 'Terra 01' }
const TURNS = [{ who: 'terra-01', text: 'picking up the lane' }, { who: 'luna-02', text: 'ack' }]
const RUNS = [{ sequence: 4, atMs: 1_700_000_000_000 }]

test.beforeEach(() => store.clear())

/* ---------------------------------------------------------------
   the channel
   --------------------------------------------------------------- */

test('a live node with no app-owned session gets no composer and a stated reason', () => {
  const plan = planNodeChatbox({ agent: AGENT, live: true, turns: TURNS })
  assert.equal(plan.channel.kind, 'none')
  assert.equal(plan.channel.canSend, false)
  assert.ok(plan.composerReason, 'the box refuses to send and does not say why')
})

test('a session this app started is sendable and says so in the caption', () => {
  const plan = planNodeChatbox({
    agent: AGENT, live: true, sessionAvailable: true, sessionAgentId: 'terra-01', turns: TURNS,
  })
  assert.equal(plan.channel.kind, 'session')
  assert.equal(plan.composerReason, null)
  assert.match(channelCaption(plan.channel, 'Manager'), /reaches the running agent/)
})

test('the simulated fleet never claims to reach a process', () => {
  const plan = planNodeChatbox({ agent: AGENT, live: false, turns: TURNS })
  assert.equal(plan.channel.kind, 'simulated')
  assert.match(channelCaption(plan.channel), /simulated/)
  assert.doesNotMatch(channelCaption(plan.channel), /running agent/)
})

/* ---------------------------------------------------------------
   the person's settings, honoured rather than reinvented
   --------------------------------------------------------------- */

test('runs mode "hidden" removes the runs half and leaves the conversation', () => {
  store.set('mc.chat.runs', 'hidden')
  const plan = planNodeChatbox({ agent: AGENT, live: false, turns: TURNS, runs: RUNS })
  assert.equal(plan.showRuns, false)
  assert.equal(plan.runs.length, 0)
  assert.equal(plan.showContext, true)
})

test('runs mode "only" removes the conversation and leaves the runs', () => {
  store.set('mc.chat.runs', 'only')
  const plan = planNodeChatbox({ agent: AGENT, live: false, turns: TURNS, runs: RUNS, runsSupported: true })
  assert.equal(plan.showContext, false)
  assert.equal(plan.turns.length, 0)
  assert.equal(plan.showRuns, true)
  assert.equal(plan.runs.length, 1)
})

test('a chosen-agent selection hides the others and counts what it held back', () => {
  store.set('mc.chat.agents', JSON.stringify(['terra-01']))
  const plan = planNodeChatbox({ agent: AGENT, live: false, turns: TURNS })
  assert.equal(plan.hiddenAgents, 1)
  assert.equal(plan.turns.length, 1)
  assert.equal(plan.turns[0].who, 'terra-01')
})

/* ---------------------------------------------------------------
   availability is about the SOURCE, not about its contents
   --------------------------------------------------------------- */

test('a node with a channel but nothing said still HAS a context source', () => {
  /* The first version of this planner passed `contextAvailable: turns.length > 0`,
     which answers "is it non-empty right now" rather than "does it exist".
     src/chatbox-feed.js's flags are about the source; emptiness is the empty
     state's job, one layer down. */
  const plan = planNodeChatbox({ agent: AGENT, live: false, turns: [], runs: [] })
  assert.equal(plan.showContext, true, 'a simulated node with no turns yet reported no context SOURCE')
  assert.equal(plan.turns.length, 0)
  assert.equal(plan.emptyReason, 'Nothing said yet.')
})

test('a rail that can read a run record HAS a runs source, even with zero runs', () => {
  const plan = planNodeChatbox({ agent: AGENT, live: false, turns: [], runs: [], runsSupported: true })
  assert.equal(plan.showRuns, true, 'a readable but empty run record reported no runs SOURCE')
  assert.equal(plan.runs.length, 0)
})

test('a rail with nobody to ask has no runs source at all', () => {
  /* readLocalSessions(undefined).supported === false — a browser with no shell
     behind it. Distinct from "asked, and there are none". */
  const plan = planNodeChatbox({ agent: AGENT, live: false, turns: TURNS, runs: [], runsSupported: false })
  assert.equal(plan.showRuns, false)
})

test('a live node with no channel has no context source', () => {
  const plan = planNodeChatbox({ agent: AGENT, live: true, turns: [], runs: [] })
  assert.equal(plan.channel.kind, 'none')
  assert.equal(plan.showContext, false, 'a node with no channel claimed to have a conversation source')
})

/* ---------------------------------------------------------------
   the four emptinesses, which are four different sentences
   --------------------------------------------------------------- */

test('filtering everyone out is reported as filtering, not as silence', () => {
  store.set('mc.chat.agents', JSON.stringify(['nobody-here']))
  const plan = planNodeChatbox({ agent: AGENT, live: false, turns: TURNS })
  assert.equal(plan.filteredToNothing, true)
  assert.match(plan.emptyReason, /hidden by your chat settings/)
})

test('genuine silence is not reported as filtering', () => {
  const plan = planNodeChatbox({ agent: AGENT, live: false, turns: [], runs: [] })
  assert.equal(plan.filteredToNothing, false)
  assert.equal(plan.emptyReason, 'Nothing said yet.')
})

test('"runs only" with no runs says that, rather than reporting no conversation', () => {
  store.set('mc.chat.runs', 'only')
  const plan = planNodeChatbox({ agent: AGENT, live: false, turns: TURNS, runs: [] })
  assert.match(plan.emptyReason, /show runs only/)
})

test('"runs hidden" with nothing said says that, rather than blaming the runs', () => {
  store.set('mc.chat.runs', 'hidden')
  const plan = planNodeChatbox({ agent: AGENT, live: false, turns: [], runs: RUNS })
  assert.match(plan.emptyReason, /hide runs/)
})

test('the four empty reasons are four distinct sentences', () => {
  const reasons = new Set()
  store.clear(); reasons.add(planNodeChatbox({ agent: AGENT, turns: [], runs: [] }).emptyReason)
  store.set('mc.chat.runs', 'only')
  reasons.add(planNodeChatbox({ agent: AGENT, turns: TURNS, runs: [] }).emptyReason)
  store.clear(); store.set('mc.chat.runs', 'hidden')
  reasons.add(planNodeChatbox({ agent: AGENT, turns: [], runs: RUNS }).emptyReason)
  store.clear(); store.set('mc.chat.agents', JSON.stringify(['nobody-here']))
  reasons.add(planNodeChatbox({ agent: AGENT, turns: TURNS, runs: [] }).emptyReason)
  assert.equal(reasons.size, 4, `collapsed to ${reasons.size} sentences: ${[...reasons].join(' | ')}`)
})

/* ---------------------------------------------------------------
   the rail is actually reachable — the defect that made this lane exist
   --------------------------------------------------------------- */

test('a single click on a node opens the rail, not only a double click', () => {
  /* The rail and its chat were fully built and the only gesture that opened
     them was dblclick. This asserts the source of the fix; tools/page2-qa.cjs
     proves it against a real window with real pointer input, because source
     text cannot see reachability.

     THIS TEST WAS ITSELF A DEFECT ONCE, and the fix is worth keeping written
     down. It used to slice from `graph.indexOf('handleClick(record)')` — which
     matches the CALL SITE `this.handleClick(record)` in _wireNode first, ~300
     lines above the method. The slice therefore swept up _wireNode's dblclick
     handler, which legitimately contains the same onOpenControls call, so
     deleting the line from handleClick left the test green. A mutant caught it.
     The anchor is now the method DEFINITION at its own indentation, the body is
     bounded by its own closing brace, and both the anchor and the bound are
     asserted to exist so a future rename fails loudly instead of checking air. */
  const graph = readFileSync(path.join(ROOT, 'src/tree-graph.js'), 'utf8')
  const start = graph.indexOf('\n  handleClick(record) {')
  assert.notEqual(start, -1, 'handleClick method definition not found — this test is checking air')
  const end = graph.indexOf('\n  }', start)
  assert.notEqual(end, -1, 'handleClick body has no closing brace — this test is checking air')
  const body = graph.slice(start, end)
  assert.ok(!body.includes('dblclick'), 'the slice escaped handleClick — this test is checking air')
  assert.ok(body.includes('this.onOpenControls?.(record.agent)'),
    'a single click no longer opens the rail; the chatbox is undiscoverable again')
})

test('the live rail carries a chatbox rather than listing chat as unavailable', () => {
  const view = readFileSync(path.join(ROOT, 'src/views/computers.js'), 'utf8')
  const projection = view.slice(view.indexOf('function showProjectionControls'))
  assert.ok(projection.includes('board-chat-box'), 'the live rail has no chatbox')
  assert.ok(!/'chat', 'tuning'/.test(projection),
    'the live rail still reports chat and tuning as unavailable while rendering both')
})
