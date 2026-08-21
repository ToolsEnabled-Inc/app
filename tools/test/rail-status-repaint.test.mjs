/* A STATUS LANDING MUST NOT REBUILD THE RAIL OUT FROM UNDER A PERSON.
 *
 * THE DEFECT THIS SUITE EXISTS FOR, measured twice on a live drive
 * (2026-08-18): a person has the chat's actions popup open and is typing in
 * its filter when a settling session's status lands. The session-stream
 * subscriber and drainOutboxMessage both answered a status by re-calling
 * showTreeNodeControls -- an innerHTML rebuild of the whole rail. The rebuild
 * disposes the mounted chat (disposeRailChat), and buildChat's dispose closes
 * an open actions popup (closeActionsPop). So the menu vanished mid-word,
 * filter text and cursor with it. A driver can reopen and count; a person
 * just loses the menu.
 *
 * WHAT THOSE CALLERS ACTUALLY NEEDED, read from the rebuild they reached for:
 * the Details tab's status word and note, the activity line, and the settled
 * reply in the said box. Everything else already repaints itself in place --
 * the composer's send/stop face and the queue strip subscribe through the
 * chat config (notifyNodeStatusListeners, SESSION_OUTBOX_EVENT), the canvas
 * chip through scheduleChipRefresh, and the popup's rows are rebuilt from the
 * store at every open. repaintRailStatus updates exactly those hosts, in
 * place, and never touches the chat.
 *
 * WHY SOURCE SLICES AND AN EXTRACTED FUNCTION RATHER THAN A MOUNT. The view is
 * a 5,000-line closure over a live DOM (the same reason
 * tools/test/fleet-page-draws-started-sessions.test.mjs gives); the driven
 * half of this proof is tools/rail-lifecycle-drive.mjs, which types into the
 * real filter on a staged packaged build while a fixture engine lands a real
 * status. What is held here is the wiring: which function each status path
 * calls, and what the repaint does and refuses to do.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const view = readFileSync(join(ROOT, 'src', 'views', 'computers.js'), 'utf8')
const components = readFileSync(join(ROOT, 'src', 'components.js'), 'utf8')

/* Comments are blanked to spaces, newlines kept, so a sentence in a comment can
   never satisfy (or unbalance) an assertion about code. */
const blankButNewlines = text => text.replace(/[^\n]/g, ' ')
const stripped = source => source
  .replace(/\/\*[\s\S]*?\*\//g, blankButNewlines)
  .replace(/(^|[^:"'`])\/\/[^\n]*/g, (match, before) => before + blankButNewlines(match.slice(before.length)))

const code = stripped(view)
const componentsCode = stripped(components)

/** Slice a whole function (or block) by its header, brace-balanced. */
function sliceBlock(source, header, what) {
  const at = source.indexOf(header)
  assert.ok(at !== -1, `${what} is gone: ${JSON.stringify(header)} is not in the source`)
  const open = source.indexOf('{', at)
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(at, i + 1)
    }
  }
  assert.fail(`${what} never closes its braces; the slice marker is stale`)
}

/* ------------------------- the mechanism, pinned ------------------------- */

test('POSITIVE CONTROL: a rail rebuild really does close an open actions popup', () => {
  /* If either half of this chain breaks, the suite below is guarding against
     a defect that can no longer happen and must be re-measured. */
  const rebuild = sliceBlock(code, 'function showTreeNodeControls(node) {', 'showTreeNodeControls')
  assert.match(rebuild, /disposeRailChat\(\)/, 'the rail rebuild no longer disposes the mounted chat')
  assert.match(rebuild, /controlsPage\.innerHTML/, 'the rail rebuild no longer swaps innerHTML')
  const dispose = sliceBlock(componentsCode, 'const dispose = () => {', "buildChat's dispose")
  assert.match(dispose, /closeActionsPop\(\)/, "buildChat's dispose no longer closes the popup")
})

/* --------------------- the status paths, repaint only -------------------- */

test('a drained or refused queued message repaints the rail in place, never rebuilds it', () => {
  const drain = sliceBlock(code, 'async function drainOutboxMessage(sessionId, nodeId, entry) {', 'drainOutboxMessage')
  assert.ok(!/showTreeNodeControls\(/.test(drain),
    'drainOutboxMessage rebuilds the rail again -- the rebuild disposes the chat and closes the actions popup out from under a person typing in its filter')
  assert.equal((drain.match(/repaintRailStatus\(/g) || []).length, 2,
    'drainOutboxMessage must repaint the rail status in place on BOTH outcomes (the refusal and the sent-next)')
})

test("a turn completion repaints the rail in place, never rebuilds it", () => {
  const start = code.indexOf('const status = sessionTurnStatus(packet, sessionId)')
  /* The end marker is the view's boot statement — it used to be the liveMode
     fork (`if (liveMode) loadProjection()`), which died with the second
     render; `void bootFromSource()` is the line that replaced it at the same
     tail position. */
  const end = code.indexOf('void bootFromSource()')
  assert.ok(start !== -1 && end > start, 'the turn-completion branch moved; re-aim this slice')
  const completion = code.slice(start, end)
  assert.ok(!/showTreeNodeControls\(/.test(completion),
    "the settling session's status rebuilds the rail again -- measured twice on a live drive, this closes the actions popup mid-word")
  assert.match(completion, /repaintRailStatus\(/,
    'the completion no longer repaints the rail status at all; the Details tab would go stale when a turn ends')
})

test('a genuine open still rebuilds: the press path was not narrowed with it', () => {
  /* The repaint exists so STATUS landings stop rebuilding. Pressing a circle
     is a genuine open and must keep the full rebuild. */
  assert.match(code, /setOpenTarget\(null\)\s*\n\s*showTreeNodeControls\(agent\.treeNode\)/,
    'the circle-press path no longer opens the rail with showTreeNodeControls')
})

/* ---------------------- the repaint, as behaviour ------------------------ */

const repaintSource = () => sliceBlock(code, 'function repaintRailStatus(node) {', 'repaintRailStatus')

test('the repaint never grows into a rebuild', () => {
  const repaint = repaintSource()
  for (const forbidden of ['innerHTML', 'disposeRailChat', 'disposeRailSaid', 'buildChat(', 'showTreeNodeControls(']) {
    assert.ok(!repaint.includes(forbidden),
      `repaintRailStatus contains ${JSON.stringify(forbidden)} -- the in-place repaint has become the rebuild it exists to avoid`)
  }
  assert.match(repaint, /currentRailTreeNode = node/,
    'the repaint no longer updates currentRailTreeNode, so the next status landing compares against a stale node')
})

/** The repaint, instantiated over fakes that support exactly what it uses. */
function instantiateRepaint({ hosts, statusWord, activity, replies, railSaid }) {
  const controlsPage = { querySelector: selector => hosts[selector] || null }
  const factory = new Function(
    'currentRailTreeNode', 'controlsPage', 'treeNodeStatusWord', 'nodeActivity', 'nodeReplies', 'railSaid',
    `${repaintSource()}\nreturn repaintRailStatus`,
  )
  return factory(null, controlsPage, statusWord, activity, replies, railSaid)
}

const host = text => ({ textContent: text, hidden: false })

test('the repaint updates the status word, the note, and the activity line in place', () => {
  const hosts = {
    '[data-tree-status]': host('was'),
    '[data-tree-status-note]': host('old note'),
    '[data-tree-activity]': host('old activity'),
  }
  const repaint = instantiateRepaint({
    hosts,
    statusWord: node => `word:${node.status}`,
    activity: new Map(),
    replies: new Map(),
    railSaid: null,
  })
  repaint({ id: 'n1', status: 'finished', statusNote: '' })
  assert.equal(hosts['[data-tree-status]'].textContent, 'word:finished')
  assert.equal(hosts['[data-tree-status-note]'].hidden, true, 'an empty note must hide its line')
  assert.equal(hosts['[data-tree-activity]'].hidden, true, 'a cleared activity must hide its line')
})

test('the repaint shows a note and an activity line when they exist', () => {
  const hosts = {
    '[data-tree-status]': host(''),
    '[data-tree-status-note]': host(''),
    '[data-tree-activity]': host(''),
  }
  const repaint = instantiateRepaint({
    hosts,
    statusWord: () => 'word',
    activity: new Map([['n1', 'Ran a command']]),
    replies: new Map(),
    railSaid: null,
  })
  repaint({ id: 'n1', status: 'failed', statusNote: 'the engine refused' })
  assert.equal(hosts['[data-tree-status-note]'].textContent, 'the engine refused')
  assert.equal(hosts['[data-tree-status-note]'].hidden, false)
  assert.equal(hosts['[data-tree-activity]'].textContent, 'Ran a command')
  assert.equal(hosts['[data-tree-activity]'].hidden, false)
})

test('a settled reply lands in the said box; a live stream is never overwritten', () => {
  const settled = { '[data-tree-said]': host('streamed so far') }
  const repaintSettled = instantiateRepaint({
    hosts: settled,
    statusWord: () => 'word',
    activity: new Map(),
    replies: new Map([['n1', 'the whole answer']]),
    railSaid: null,
  })
  repaintSettled({ id: 'n1', status: 'finished', statusNote: '' })
  assert.equal(settled['[data-tree-said]'].textContent, 'the whole answer',
    'with the stream settled, the said box must carry the filed reply')

  const streaming = { '[data-tree-said]': host('mid-stream words') }
  const repaintLive = instantiateRepaint({
    hosts: streaming,
    statusWord: () => 'word',
    activity: new Map(),
    replies: new Map([['n1', 'a stale reply']]),
    railSaid: { nodeId: 'n1' },
  })
  repaintLive({ id: 'n1', status: 'running', statusNote: '' })
  assert.equal(streaming['[data-tree-said]'].textContent, 'mid-stream words',
    'a live railSaid owns the said box; the repaint wrote over an open stream')
})

/* ------------------------- the template's hooks -------------------------- */

test('the rail template carries the hooks the in-place repaint writes to', () => {
  const rebuild = sliceBlock(view, 'function showTreeNodeControls(node) {', 'showTreeNodeControls')
  assert.match(rebuild, /data-tree-status[^-]/,
    'the status word lost its data-tree-status hook; the repaint has nothing to write to and the Details tab goes stale on every turn end')
  assert.match(rebuild, /data-tree-status-note/,
    'the status note lost its data-tree-status-note hook (it must render always, hidden when empty, or a note arriving after mount has no host)')
})
