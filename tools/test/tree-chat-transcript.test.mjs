/* THE CONVERSATION A TREE NODE SHOWS, AND THE WAYS IT USED TO LOSE ONE.
 *
 * Owner, on tonight's preview build: "Sometimes the messages in history
 * disappear or combine into each other."
 *
 * WHAT THIS FILE CAN AND CANNOT MEASURE, said plainly. src/views/computers.js
 * imports three stylesheets and reaches echarts, a canvas and a ResizeObserver
 * at module load, so a plain Node process cannot import it at all -- the same
 * measurement tools/two-tree-render-qa.mjs's header records. The parts that
 * ARE importable are tested as behaviour below; the rest is pinned at the
 * source level, the way tools/test/tree-drag-contract.test.mjs pins the drag
 * rules, and the runtime proof is the packaged driver named at the bottom.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { sessionEventTurnId } from '../../src/agent-session-events.js'

const here = fileURLToPath(import.meta.url)
const SRC = join(dirname(dirname(dirname(here))), 'src')
const view = readFileSync(join(SRC, 'views', 'computers.js'), 'utf8')
const components = readFileSync(join(SRC, 'components.js'), 'utf8')
/* The words this view hands the chat live in the copy module, where the
   plain-language gate can hold them; the assertions about the closed line read
   them from there rather than from the view. */
const copy = readFileSync(join(SRC, 'fleet-tree-copy.js'), 'utf8')

/* ---------------------------------------------------------------
   A. The first thing said is recorded like every other thing said.
   --------------------------------------------------------------- */

test('the brief a person types is put into the transcript when the session opens', () => {
  /* It was never appended anywhere. It reached the screen only through
     treeChatConfigFor's `!history.length` fallback, and the first completed
     turn appended an agent line -- after which the fallback never fired again
     and the opening question was gone from the conversation for good. */
  const open = view.slice(view.indexOf('onSessionOpen: ({ sessionId, threadId }) =>'))
  const body = open.slice(0, open.indexOf('refreshTree()'))
  assert.match(
    body,
    /transcriptAppend\(sessionId, \{ who: 'you', text: draft\.message, at: Date\.now\(\) \}\)/,
    'the compose panel brief is not recorded, so it disappears the moment the first reply lands',
  )
})

test('what the product added about the tree is recorded too, and separately', () => {
  const open = view.slice(view.indexOf('onSessionOpen: ({ sessionId, threadId }) =>'))
  const body = open.slice(0, open.indexOf('refreshTree()'))
  assert.match(
    body,
    /transcriptAppend\(sessionId, \{ who: 'you', text: nodeManagerContext\(briefContext\)/,
    'the tree context is sent to the agent and not shown; this page does not send what it will not show',
  )
  assert.ok(
    body.indexOf('text: draft.message') < body.indexOf('nodeManagerContext(briefContext)'),
    'the context is recorded before the person own words',
  )
})

test('the tree context is drawn as the tree words, not as a second dark YOU bubble', () => {
  /* The address block is recorded who:'you' — the side it was sent from — and
     both surfaces therefore painted it as three hundred pixels of plumbing in
     the person's own colour, the loudest thing in the conversation (measured
     on a staged packaged build, 2026-08-20). It is recognised at draw time by
     the SAME contract shell/agent-host.cjs reads the address back out of
     (readTreeAddress), never by guessing at prose, and the record itself is
     untouched. */
  assert.match(view, /function markTreeContext/, 'nothing renames the tree context at draw time')
  assert.match(view, /readTreeAddress\(entry\.text\)/, 'the context is recognised by something other than the address contract')
  assert.match(view, /mergeActionsIntoHistory\(markTreeContext\(history/, 'the chat config draws the raw history, so the context wears YOU again')
  assert.match(components, /entry\.who === 'context'/, 'buildChat does not know the context entry; it would fall through as a them-bubble')
})

test('the tree context is folded shut, and the closed line earns the press', () => {
  /* Quiet was only half of it. MEASURED on a staged packaged build: the aside
     still drew 298px in a 371px log, so a first-timer's first screen of their
     first conversation was internal plumbing. Folding it is not truncating it
     -- the entry stays whole inside -- but a fold whose label says nothing is
     one nobody opens, so the closed line has to say WHAT is behind it and HOW
     MUCH, in the person's own words. */
  assert.match(components, /const addContext = /, 'the context is drawn as a plain bubble again, so it is a wall of text on open')
  const draw = components.slice(components.indexOf('const addContext = '), components.indexOf('/* ---- THE SECOND DOOR'))
  assert.match(draw, /createElement\('details'\)/, 'the aside is not a disclosure; there is nothing to press')
  assert.ok(!/wrap\.open = true/.test(draw), 'the aside is forced open, which is the defect this closes')
  assert.match(draw, /entry\.summary/, 'the closed line carries no sentence, so the fold is a mystery box')
  /* THE SIZE IS THE HALF THAT EARNS THE PRESS, and it is the caller's word. */
  assert.match(view, /treeContextSummary\(entry\.text\)/, 'nothing composes the closed line from the entry it is folding')
  assert.match(copy, /export function treeContextSummary/, 'the closed line has no copy of its own')
  assert.match(copy, /\$\{words\} words/, 'the closed line does not say how much is behind it')

  /* PER CONVERSATION, NEVER GLOBALLY. Somebody who opens this wants it open for
     the thread they are reading. A shared default is the thing being avoided. */
  assert.match(view, /openKey: typeof sessionId === 'string'/, 'the open state is not keyed to a conversation')
  assert.match(draw, /entry\.openKey/, 'the component ignores the key, so the memory is global')
  assert.match(draw, /rememberContext\(key, wrap\.open\)/, 'opening it is forgotten the moment the panel rebuilds')
})

test('the manager named in the brief is the name on the circle', () => {
  /* MEASURED, not guessed: on a staged build with a real Codex session, a child
     under a circle drawn "Manager" was told its manager was "Agent", and it
     said so back. composeParentFor() hands over `{ id, name }` -- a projection
     whose name has ALREADY been through treeNodeName -- and re-running
     treeNodeName over it finds no `role`, so roleLabel returns its generic
     word. The parent's name must be read off the projection, never recomputed
     from it. */
  const helper = view.slice(view.indexOf('function briefContextFor'), view.indexOf('function briefContextFor') + 1400)
  assert.match(helper, /parentName: parent \? \(parent\.name \|\| null\) : null/, 'the parent name is recomputed from a projection that has no role; the brief will name a generic label')
  assert.match(helper, /selfName: treeNodeName\(node\)/, 'the node is a real store record and must keep its computed name')
  /* And the projection it reads really does carry one. */
  const projection = view.slice(view.indexOf('function composeParentFor'), view.indexOf('function composeParentFor') + 400)
  assert.match(projection, /name: treeNodeName\(node\)/, 'composeParentFor stopped carrying a name, so the brief has nothing true to read')
})

test('the durable half is written from the same lines, so a resume carries the brief', () => {
  const append = view.slice(view.indexOf('function transcriptAppend'), view.indexOf('function persistTranscript'))
  assert.match(append, /persistTranscript\(sessionId\)/, 'appends no longer reach the durable excerpt')
})

test('and the durable half is READ BACK, so a restart shows the conversation rather than rebuilding one', () => {
  /* THE MEASUREMENT THIS PINS. On a staged packaged build, a node holding five
     recorded lines drew TWO bubbles after the app was restarted -- the first
     question above the second answer -- on both the rail chat and the compact
     card. `sessionTranscripts` is window memory; a new window has none; so the
     `!history.length` fallback composed node.message with node.reply and
     produced a conversation that never happened.
     This asserts the store is consulted BEFORE that fallback, and that the
     fallback is still there for a node whose conversation was never recorded. */
  const config = view.slice(view.indexOf('function treeChatConfigFor'), view.indexOf('function treeChatConfigFor') + 6400)
  const live = config.indexOf('sessionTranscripts.get(node.sessionId)')
  const stored = config.indexOf('transcriptStore.get(node.id)')
  const fallback = config.indexOf('nodeReplies.get(node.id) || node.reply', live)
  assert.ok(live > -1, 'the live map read is gone; this test is pinned to the wrong function')
  assert.ok(stored > -1, 'a session with no window memory never reads the durable record, so a restart rebuilds the conversation from the brief and the latest reply')
  assert.ok(stored > live, 'the durable record must be the fallback for an empty window, not the first source')
  assert.ok(fallback > stored, 'the brief-plus-latest-reply fallback must come AFTER the record, or it will keep standing in for one that exists')
})

/* ---------------------------------------------------------------
   B. Where one turn ends and the next begins.
   --------------------------------------------------------------- */

test('a packet names its turn, or names nothing', () => {
  const id = 'turn-7f3a'
  assert.equal(sessionEventTurnId({ sessionId: 's1', event: { type: 'assistant_text_delta', turnId: id } }, 's1'), id)
  assert.equal(sessionEventTurnId({ sessionId: 's2', event: { turnId: id } }, 's1'), null)
  assert.equal(sessionEventTurnId({ sessionId: 's1', event: { type: 'assistant_text_delta' } }, 's1'), null)
  assert.equal(sessionEventTurnId({ sessionId: 's1', event: { turnId: 7 } }, 's1'), null)
  assert.equal(sessionEventTurnId({ sessionId: 's1', event: { turnId: '' } }, 's1'), null)
  assert.equal(sessionEventTurnId({ sessionId: 's1', event: { turnId: 'x'.repeat(513) } }, 's1'), null)
  assert.equal(sessionEventTurnId(null, 's1'), null)
})

test('a delta naming a new turn settles the old one before it adds a word', () => {
  /* The accumulator and the open bubble were released ONLY by turn_completed.
     A turn that ended any other way left both standing, and the next turn's
     first delta appended to the last turn's answer inside the same bubble --
     "combine into each other". */
  const delta = view.slice(view.indexOf('const text = sessionEventText(packet, sessionId)'))
  const settleAt = delta.indexOf('settleTurnBoundary(sessionId, sessionEventTurnId(packet, sessionId))')
  const accumulateAt = delta.indexOf("sessionTurnText.set(sessionId, (sessionTurnText.get(sessionId) || '') + text)")
  assert.ok(settleAt !== -1, 'the delta branch no longer settles the turn boundary')
  assert.ok(settleAt < accumulateAt, 'the boundary is settled after the new words are added, which merges them')

  const settle = view.slice(view.indexOf('function settleTurnBoundary'), view.indexOf('function transcriptAppend'))
  assert.match(settle, /if \(!open \|\| open === turnId\) return/, 'the settler no longer distinguishes a new turn from the open one')
  assert.match(settle, /sessionTurnText\.delete\(sessionId\)/, 'the accumulator survives a turn boundary; the next turn inherits these words')
  assert.match(settle, /transcriptAppend\(sessionId, \{ who: 'agent'/, 'an unfinished turn words are dropped instead of recorded')
  assert.match(settle, /railChat\.stream\.close/, 'the previous turn bubble is never ended, so the next turn repaints it')
})

test('a completed turn clears the open-turn mark, so the next delta opens a fresh bubble', () => {
  /* SLICED BY STRUCTURE, NOT BY BYTE COUNT: a note added above the needle used
     to push it out of a fixed 900-character window, and the test then reported
     a live behaviour as missing. */
  const completion = view.slice(view.indexOf('const status = sessionTurnStatus(packet, sessionId)'))
  const branch = completion.slice(0, completion.indexOf('nodeActivity.delete(nodeId)'))
  assert.match(branch, /sessionOpenTurns\.delete\(sessionId\)/, 'the open-turn mark outlives the turn')
})

/* ---------------------------------------------------------------
   C. Every surface waiting on a turn is answered.
   --------------------------------------------------------------- */

test('the reply wrapper answers its own chat, never whichever one is mounted now', () => {
  /* The wrapper read the live `railChat` variable, which is reassigned on
     every rail rebuild -- so a reply arriving after a rebuild closed a
     DIFFERENT node's bubble with this node's words. */
  const mount = view.slice(view.indexOf("const chatHost = controlsPage.querySelector('[data-rail-chat-host]')"))
  const block = mount.slice(0, mount.indexOf('railChat = mine') + 40)
  assert.match(block, /const mine = \{ sessionId: node\.sessionId/, 'the rail chat is no longer captured before the chat is built')
  assert.match(block, /if \(railChat === mine && mine\.stream\)/, 'the wrapper reads the live railChat again; a reply can land in another node chat')
})

/* ---------------------------------------------------------------
   D. Never innerHTML over a mounted chat.
   --------------------------------------------------------------- */

test('every rail rebuild disposes the mounted chat first', () => {
  /* The rule is stated where railChat is declared and only one of the four
     rebuild sites obeyed it. After the others, railChat survived pointing at a
     detached root whose sessionId still matched, so every delta was pushed
     into a chat log that was not in the document. */
  let from = 0
  let sites = 0
  for (;;) {
    const at = view.indexOf('controlsPage.innerHTML', from)
    if (at === -1) break
    sites += 1
    const before = view.slice(Math.max(0, at - 1400), at)
    assert.ok(
      before.includes('disposeRailChat()'),
      `a controlsPage rebuild at offset ${at} wipes the rail without disposing the chat mounted in it`,
    )
    from = at + 1
  }
  assert.ok(sites >= 4, `expected every rail rebuild to be checked; found ${sites}`)
})

test('the settings-driven chat box disposes before it re-renders', () => {
  const mount = view.slice(view.indexOf('function mountRailChat'))
  const render = mount.slice(0, 4000)
  assert.match(render, /mounted\?\.dispose\?\.\(\)/, 'a chatbox setting change drops a mounted chat on the floor')
})

/* ---------------------------------------------------------------
   E. Neither surface may fall through to the demonstration excerpt.
   --------------------------------------------------------------- */

test('the shared chat config pins seed 0, so no surface can fabricate a conversation', () => {
  /* buildChat's rule: `history.length ? [] : CHAT.slice(start, start + seed)`,
     with seed defaulting to 3. The card pinned 0 and the rail did not, so the
     rail rendered three canned bubbles over any empty transcript and dropped
     them on the next rebuild: messages that appear, then disappear. */
  assert.match(components, /const seeded = Array\.isArray\(history\) && history\.length \? \[\] : CHAT\.slice/, 'the seeding rule moved; re-derive this guard')
  const configFn = view.slice(view.indexOf('function treeChatConfigFor'), view.indexOf('function chatActionRowsFor'))
  const seeds = configFn.match(/^ +seed: 0,$/gm) || []
  assert.equal(seeds.length, 2, 'both of treeChatConfigFor returns must pin seed 0; one of them can fabricate history')
})

/* ---------------------------------------------------------------
   F. Recovery deletes a transcript only when it is really the same line.
   --------------------------------------------------------------- */

test('the dead-session recovery matches the whole line, not a prefix of it', () => {
  /* `tail.text === text.slice(0, tail.text.length)` matched any shorter
     earlier "you" line that happened to start the same way, and the branch it
     guards deletes the node's entire saved conversation. */
  assert.ok(
    !/tail\.text === text\.slice\(0, tail\.text\.length\)/.test(view),
    'the loose prefix match is back; typing a short line that starts an earlier one erases the saved conversation',
  )
  const recovery = view.slice(view.indexOf('const durable = transcriptStore ? transcriptStore.get(node.id) : null'))
  const block = recovery.slice(0, recovery.indexOf('const seeded ='))
  assert.match(block, /tail\.text\.length === TRANSCRIPT_LIMITS\.maxLineChars/, 'the only legitimate prefix -- a line the store truncated -- is no longer the only one admitted')
  assert.match(block, /tail\.text === text \|\| wasTruncated/, 'the whole-line comparison is gone')
})

/* THE RUNTIME PROOF is tools/tree-chat-transcript-drive.mjs: a staged packaged
   build, a real agent, two consecutive turns, and both surfaces read. Nothing
   above can observe a bubble; that driver can, and it is the discriminating
   check this area never had. */
