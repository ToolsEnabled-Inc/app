/* THE ROW TABLE BEHIND THE ACTIONS POPUP, walked as data.
 *
 * chatActionRowsFor lives inside the computers view's closure, so it cannot be
 * imported. Its `return [ ... ]` is a table of literals over a handful of
 * closure names, and this suite EVALUATES that table under chosen states rather
 * than pattern-matching its text: the array text is lifted out of the source
 * and run with the copy modules it really uses and stubs for the closure names
 * it reads. So "a stopped agent's Stop row says why" is checked against the
 * sentence the row would really carry, and a row that lost its group or its
 * reason fails here whatever it looks like.
 *
 * WHAT IT DEFENDS, in the owner's terms ("more like vscode, much more
 * intuitive"): every action this build performs has a row; the rows are
 * grouped, with the group that ends or forgets something last; every row that
 * can be switched off says why in the state that switches it off; and the
 * cancelled-mention sentence is its own.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { EFFORT_SWITCH, MODEL_PANEL, PALETTE_PANEL, RESUME_PANEL, REWIND_PANEL } from '../../src/fleet-tree-copy.js'

const VIEW = readFileSync(new URL('../../src/views/computers.js', import.meta.url), 'utf8')

/* The table's text, from its own opening bracket to the end of the function. */
function tableSource() {
  const fn = VIEW.slice(VIEW.indexOf('function chatActionRowsFor'), VIEW.indexOf('async function resumeNodeSession'))
  const at = fn.lastIndexOf('return [')
  assert.ok(at > 0, 'chatActionRowsFor no longer ends in a row table')
  const close = fn.indexOf('\n    ]', at)
  assert.ok(close > at, 'the row table has no closing bracket where this suite expects one')
  return fn.slice(at + 'return '.length, close + '\n    ]'.length)
}

const CLOSURE = [
  'PALETTE_PANEL', 'EFFORT_SWITCH', 'RESUME_PANEL', 'REWIND_PANEL', 'MODEL_PANEL',
  'running', 'started', 'canPick', 'pickerWhy', 'turnsSoFar', 'reply', 'current', 'node',
  'transcriptStore', 'conversation', 'agent', 'danger',
  'fresh', 'sinkFor', 'statusSink', 'runPaletteAction', 'effortRows', 'modelRows', 'rewindRows',
  'openComposeFor', 'focusDetailsControl', 'resumeNodeSession',
]

/* Build the rows for one state. Defaults are an idle, never-started node on
   the installed app; each test names only what it changes. */
function rowsFor({
  running = false,
  started = false,
  canPick = true,
  turnsSoFar = 0,
  reply = '',
  message = '',
  saved = false,
} = {}) {
  const pickerWhy = !started ? PALETTE_PANEL.whyNotStarted : (!canPick ? PALETTE_PANEL.whyNoPicker : '')
  const table = new Function(...CLOSURE, `return ${tableSource()}`)
  const stub = () => {}
  return table(
    PALETTE_PANEL, EFFORT_SWITCH, RESUME_PANEL, REWIND_PANEL, MODEL_PANEL,
    running, started, canPick, pickerWhy, turnsSoFar, reply,
    { sessionId: started ? 'chat-a' : null, message }, { id: 'node-a' },
    { has: () => saved }, PALETTE_PANEL.groupConversation, PALETTE_PANEL.groupAgent, PALETTE_PANEL.groupDanger,
    stub, stub, stub, stub, stub, stub, stub, stub, stub, stub,
  )
}

const byId = rows => Object.fromEntries(rows.map(row => [row.id, row]))

test('every action this build performs has a row, including the three doors that were missing', () => {
  const ids = rowsFor().map(row => row.id)
  for (const id of ['attach', 'mention', 'queue']) {
    assert.ok(ids.includes(id), `${id} has a runner in runPaletteAction and no row in the menu -- the door is missing again`)
  }
  for (const id of ['effort', 'model', 'rewind', 'copy-brief', 'copy-reply', 'child', 'move', 'resume', 'interrupt', 'stop', 'clear']) {
    assert.ok(ids.includes(id), `${id} left the menu`)
  }
  assert.equal(new Set(ids).size, ids.length, 'a row id appears twice')
})

test('every row belongs to a group, and the group that ends or forgets something is last', () => {
  const rows = rowsFor()
  for (const row of rows) {
    assert.equal(typeof row.group, 'string', `${row.id} has no group; the list is flat again`)
    assert.ok(row.group.length > 0, `${row.id} has an empty group`)
  }
  const groups = [...new Set(rows.map(row => row.group))]
  assert.equal(groups.length, 3, `expected three groups, found ${JSON.stringify(groups)}`)
  assert.equal(groups[groups.length - 1], PALETTE_PANEL.groupDanger, 'the destructive group is not last')
  const danger = rows.filter(row => row.group === PALETTE_PANEL.groupDanger).map(row => row.id).sort()
  assert.deepEqual(danger, ['clear', 'interrupt', 'stop'], 'the destructive group does not hold exactly the three rows that stop or forget')
  /* Consecutive: a group is a heading, so its rows sit together. */
  const seen = new Set()
  let last = null
  for (const row of rows) {
    if (row.group !== last) {
      assert.ok(!seen.has(row.group), `${row.group} appears in two separate runs; its heading would print twice`)
      seen.add(row.group)
      last = row.group
    }
  }
})

test('a row that is switched off says why, in every state that switches it off', () => {
  /* Never started, on the installed app. */
  const idle = byId(rowsFor())
  for (const id of ['attach', 'mention', 'effort', 'model', 'rewind', 'clear']) {
    assert.equal(idle[id].enabled, false, `${id} is pressable before the agent has started`)
    assert.equal(idle[id].disabledHint, PALETTE_PANEL.whyNotStarted, `${id} is switched off and does not say the agent has not started`)
  }
  for (const id of ['interrupt', 'stop']) {
    assert.equal(idle[id].enabled, false)
    assert.equal(idle[id].disabledHint, PALETTE_PANEL.whyNotRunning, `${id} is switched off and does not say the agent is not running`)
  }
  assert.equal(idle['copy-brief'].disabledHint, PALETTE_PANEL.whyNoBrief)
  assert.equal(idle['copy-reply'].disabledHint, PALETTE_PANEL.whyNoReply)
  assert.equal(idle.resume.disabledHint, PALETTE_PANEL.whyNoSaved)

  /* Started, idle, no turns yet: rewind's reason changes to the one that is
     now true. */
  const quiet = byId(rowsFor({ started: true, turnsSoFar: 0 }))
  assert.equal(quiet.rewind.enabled, false)
  assert.equal(quiet.rewind.disabledHint, PALETTE_PANEL.whyNoTurns, 'a started agent with no turns is told it has not started')

  /* Running: resume is refused for being busy, and says so in RESUME_PANEL's
     own words rather than a new sentence. */
  const busy = byId(rowsFor({ started: true, running: true, saved: true }))
  assert.equal(busy.resume.enabled, false)
  assert.equal(busy.resume.disabledHint, RESUME_PANEL.busy)
  assert.equal(busy.interrupt.enabled, true)
  assert.equal(busy.stop.enabled, true)

  /* A page with no picker: attach and mention say the real reason. */
  const preview = byId(rowsFor({ started: true, canPick: false }))
  assert.equal(preview.attach.enabled, false)
  assert.equal(preview.attach.disabledHint, PALETTE_PANEL.whyNoPicker)
  assert.equal(preview.mention.disabledHint, PALETTE_PANEL.whyNoPicker)

  /* And every disabled row, in every state above, carries SOME reason. */
  for (const rows of [idle, quiet, busy, preview]) {
    for (const row of Object.values(rows)) {
      if (row.enabled === false) {
        assert.equal(typeof row.disabledHint, 'string', `${row.id} is switched off with no reason`)
        assert.ok(row.disabledHint.length > 0, `${row.id} is switched off with an empty reason`)
      }
    }
  }
})

test('a row that is on carries its hint and never a reason', () => {
  const live = byId(rowsFor({ started: true, running: true, turnsSoFar: 2, reply: 'Done.', message: 'Do it.', saved: false }))
  for (const id of ['attach', 'mention', 'effort', 'model', 'rewind', 'copy-brief', 'copy-reply', 'interrupt', 'stop', 'clear', 'queue', 'child', 'move']) {
    assert.equal(live[id].enabled, true, `${id} is off on a running agent that has said something`)
  }
  assert.equal(live.attach.hint, PALETTE_PANEL.attachHint)
  assert.equal(live.mention.hint, PALETTE_PANEL.mentionHint)
  assert.equal(live.queue.hint, PALETTE_PANEL.queueFocusHint)
})

test('the three restored rows reach the runners that already existed', () => {
  const src = tableSource()
  assert.match(src, /id: 'attach'[^\n]*runPaletteAction\('attach'/, 'the attach row does not reach the attach runner')
  assert.match(src, /id: 'mention'[^\n]*runPaletteAction\('mention'/, 'the mention row does not reach the mention runner')
  assert.match(src, /id: 'queue'[^\n]*runPaletteAction\('queue'/, 'the queue row does not reach the queue runner')
  const runners = VIEW.slice(VIEW.indexOf('async function runPaletteAction'))
  for (const id of ['attach', 'mention', 'queue']) {
    assert.ok(runners.includes(`if (id === '${id}')`), `runPaletteAction has no branch for ${id}; the row would press into nothing`)
  }
})

/* THE SENTENCE ABOUT THE WRONG ACTION. A cancelled mention said "Nothing was
   attached." -- PALETTE_PANEL.attachCancelled, reused from a different branch. */
test('a cancelled mention says a sentence about mentioning, not about attaching', () => {
  assert.notEqual(PALETTE_PANEL.mentionCancelled, PALETTE_PANEL.attachCancelled, 'the two cancel sentences are one sentence')
  assert.match(PALETTE_PANEL.mentionCancelled, /mention/i, 'the mention-cancel sentence does not say what was not done')
  const runners = VIEW.slice(VIEW.indexOf('async function runPaletteAction'))
  const mention = runners.slice(runners.indexOf("if (id === 'mention')"), runners.indexOf("if (id === 'copy-brief'"))
  assert.ok(mention.length > 100, 'the mention runner could not be found')
  assert.match(mention, /PALETTE_PANEL\.mentionCancelled/, 'the mention runner does not use its own cancel sentence')
  assert.doesNotMatch(mention, /attachCancelled/, 'the mention runner still says "Nothing was attached." on cancel')
  const attach = runners.slice(runners.indexOf("if (id === 'attach')"), runners.indexOf("if (id === 'clear')"))
  assert.match(attach, /PALETTE_PANEL\.attachCancelled/, 'the attach runner lost its own cancel sentence')
})

/* Every disabled reason is a sentence a person can read, under the same rules
   the rest of the product's copy takes: no identifiers, no shouting, no
   README punctuation. */
test('every reason and every group heading reads as a sentence', () => {
  const words = Object.entries(PALETTE_PANEL).filter(([key]) => key.startsWith('why') || key.startsWith('group'))
  assert.ok(words.length >= 10, `expected the reasons and headings, walked ${words.length}`)
  for (const [key, sentence] of words) {
    assert.equal(typeof sentence, 'string')
    assert.ok(sentence.length > 0, `${key} is empty`)
    assert.doesNotMatch(sentence, /\b[A-Z][A-Z0-9_]{4,}\b/, `${key} carries an identifier: ${sentence}`)
    for (const bad of ['·', '…', '—', '|']) assert.ok(!sentence.includes(bad), `${key} carries README punctuation: ${sentence}`)
  }
})
