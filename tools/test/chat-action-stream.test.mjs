/* THE CHAT WAS NOT A CONTEXT WINDOW, AND A FIVE-MINUTE TURN PUT ZERO ROWS IN IT.
 *
 * Owner, item 1 and his biggest ask: he wants to see what the agent is doing,
 * the way an editor shows its tool calls interleaved with its prose.
 *
 * NOTHING WAS MISSING ON THE WIRE. The engine emits tool_call, tool_result and
 * approval_request (engine-contract.js's EVENT_TYPES); the codex adapter puts
 * the command, the exit code and a toolCallId on them, and the Claude CLI
 * adapter puts the tool's own name ("Bash", "Read"), its input, and a
 * tool_use_id that pairs a result with its call. The host, the main process and
 * the preload forward every packet unfiltered, and src/agent-session-events.js
 * already had a reader for them.
 *
 * IT WAS THROWN AWAY AT THE LAST STEP. The single consumer routed the reader's
 * answer to a ONE-LINE OVERWRITTEN status string and a chip, and deleted it on
 * completion. It never reached the chat log, the transcript, or any list of
 * what was done. So a turn that spent five minutes running commands produced no
 * rows at all, by construction.
 *
 * WHAT THIS PINS: the reader carries enough to JOIN a result to its call and to
 * say what was done; a bounded buffer keeps them in arrival order with visible
 * caps rather than silent ones; and the chat has a second door beside openStream
 * that appends and UPDATES rows in the same log.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import {
  ACTION_LIMITS,
  createActionBuffer,
  sessionActivityEvent,
} from '../../src/agent-session-events.js'
import { actionRowWords, foldedActionsLine } from '../../src/fleet-tree-copy.js'

const SRC = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'src')
const components = readFileSync(join(SRC, 'components.js'), 'utf8')
const view = readFileSync(join(SRC, 'views', 'computers.js'), 'utf8')
const styles = readFileSync(join(SRC, 'styles.css'), 'utf8')

/* The two shapes, copied from what the adapters really emit. */
const codexCall = {
  sessionId: 's1',
  event: {
    type: 'tool_call',
    turnId: 'turn-a',
    itemId: 'item-7',
    toolCallId: 'item-7',
    tool: 'commandExecution',
    payload: { command: 'npm test', cwd: 'C:/work' },
  },
}
const codexResult = {
  sessionId: 's1',
  event: {
    type: 'tool_result',
    turnId: 'turn-a',
    itemId: 'item-7',
    toolCallId: 'item-7',
    tool: 'commandExecution',
    payload: { status: 'completed', exitCode: 0, aggregatedOutput: '2295 tests, 0 fail' },
  },
}
const claudeCall = {
  sessionId: 's1',
  event: { type: 'tool_call', toolCallId: 'toolu_9', tool: 'Read', payload: { file_path: 'C:/work/src/app.js' } },
}
const claudeResult = {
  sessionId: 's1',
  event: { type: 'tool_result', toolCallId: 'toolu_9', text: 'export function app() {}', status: 'error' },
}

/* ---------------------------------------------------------------
   A. The reader carries what a row needs, from BOTH engines.
   --------------------------------------------------------------- */

test('a call carries the name the result will be joined on', () => {
  assert.equal(sessionActivityEvent(codexCall, 's1').toolCallId, 'item-7')
  assert.equal(sessionActivityEvent(codexResult, 's1').toolCallId, 'item-7')
  assert.equal(sessionActivityEvent(claudeCall, 's1').toolCallId, 'toolu_9')
  assert.equal(sessionActivityEvent(claudeResult, 's1').toolCallId, 'toolu_9')
})

test('a call says what it is doing, whichever engine phrased it', () => {
  assert.equal(sessionActivityEvent(codexCall, 's1').detail, 'npm test')
  /* Claude names the tool and puts its argument in the input, so the detail is
     the PATH for a read and the command for a shell call. A row that said only
     "Read" would be the one-line status string this replaces. */
  assert.equal(sessionActivityEvent(claudeCall, 's1').detail, 'C:/work/src/app.js')
  assert.equal(sessionActivityEvent(claudeCall, 's1').tool, 'Read')
})

test('a result says how it went, and the two engines say it in different places', () => {
  const codex = sessionActivityEvent(codexResult, 's1')
  assert.equal(codex.exitCode, 0)
  assert.equal(codex.status, 'completed')
  /* The Claude CLI puts status on the EVENT, not in the payload. Reading only
     payload.status called every failed Claude tool call a success. */
  assert.equal(sessionActivityEvent(claudeResult, 's1').status, 'error')
})

test('a result carries the output a person can open, bounded', () => {
  assert.equal(sessionActivityEvent(codexResult, 's1').output, '2295 tests, 0 fail')
  const huge = {
    sessionId: 's1',
    event: { type: 'tool_result', toolCallId: 'x', payload: { aggregatedOutput: 'y'.repeat(ACTION_LIMITS.maxOutputChars + 500) } },
  }
  assert.equal(sessionActivityEvent(huge, 's1').output.length, ACTION_LIMITS.maxOutputChars)
})

test('the old fields are untouched, so the status line and the chip keep working', () => {
  assert.equal(sessionActivityEvent(codexCall, 's1').kind, 'call')
  assert.equal(sessionActivityEvent(codexCall, 's1').command, 'npm test')
  assert.equal(sessionActivityEvent(codexResult, 's1').kind, 'result')
  assert.equal(sessionActivityEvent({ sessionId: 's1', event: { type: 'usage' } }, 's1'), null)
  assert.equal(sessionActivityEvent(codexCall, 's2'), null)
})

/* ---------------------------------------------------------------
   B. The buffer: arrival order, one row per call, visible caps.
   --------------------------------------------------------------- */

test('a result updates the row its call opened; it never appends a second one', () => {
  const buffer = createActionBuffer()
  const opened = buffer.add(sessionActivityEvent(codexCall, 's1'), { turnId: 'turn-a', at: 10 })
  assert.equal(opened.change, 'added')
  const closed = buffer.add(sessionActivityEvent(codexResult, 's1'), { turnId: 'turn-a', at: 20 })
  assert.equal(closed.change, 'updated')
  assert.equal(buffer.list().length, 1, 'the result appended a second row instead of closing the first')
  const row = buffer.list()[0]
  assert.equal(row.tool, 'commandExecution')
  assert.equal(row.detail, 'npm test')
  assert.equal(row.state, 'done')
  assert.equal(row.output, '2295 tests, 0 fail')
  assert.equal(row.at, 10, 'the row jumped to the end of the conversation when its result landed')
})

test('a result that failed says so on the row it belongs to', () => {
  const buffer = createActionBuffer()
  buffer.add(sessionActivityEvent(claudeCall, 's1'), { turnId: 'turn-a', at: 10 })
  buffer.add(sessionActivityEvent(claudeResult, 's1'), { turnId: 'turn-a', at: 20 })
  assert.equal(buffer.list()[0].state, 'undone')
})

test('a result with no call before it still gets a row rather than being dropped', () => {
  const buffer = createActionBuffer()
  const only = buffer.add(sessionActivityEvent(codexResult, 's1'), { turnId: 'turn-a', at: 5 })
  assert.equal(only.change, 'added')
  assert.equal(buffer.list().length, 1)
})

test('an engine that names no call keeps every row separate', () => {
  /* Joining on an EMPTY id would fold every unnamed action into one row. */
  const buffer = createActionBuffer()
  const nameless = { kind: 'call', toolCallId: '', tool: 'fileChange', detail: 'a.js', command: '', exitCode: null, status: '', output: '' }
  buffer.add(nameless, { turnId: 't', at: 1 })
  buffer.add({ ...nameless, detail: 'b.js' }, { turnId: 't', at: 2 })
  assert.equal(buffer.list().length, 2)
})

test('the per-turn cap folds rather than drops, and the fold is countable', () => {
  const buffer = createActionBuffer({ maxPerTurn: 3, maxPerSession: 50 })
  for (let i = 0; i < 9; i += 1) {
    buffer.add({ kind: 'call', toolCallId: `c${i}`, tool: 'commandExecution', detail: `step ${i}`, command: '', exitCode: null, status: '', output: '' }, { turnId: 'turn-a', at: i })
  }
  assert.equal(buffer.list().length, 3, 'the per-turn cap does not hold; a long turn can push thousands of rows')
  assert.equal(buffer.folded('turn-a'), 6, 'the actions beyond the cap vanished with no count, which is a silent cap')
  assert.match(foldedActionsLine(6), /6/, 'the fold has no words, so a person is never told there is more')
})

test('the per-session cap drops the OLDEST and says how many', () => {
  const buffer = createActionBuffer({ maxPerTurn: 100, maxPerSession: 4 })
  for (let i = 0; i < 10; i += 1) {
    buffer.add({ kind: 'call', toolCallId: `c${i}`, tool: 'commandExecution', detail: `step ${i}`, command: '', exitCode: null, status: '', output: '' }, { turnId: `turn-${i}`, at: i })
  }
  assert.equal(buffer.list().length, 4)
  assert.equal(buffer.list()[0].detail, 'step 6', 'the newest rows were dropped instead of the oldest')
  assert.equal(buffer.dropped, 6)
})

test('a new turn gets its own allowance, so one busy turn cannot mute the next', () => {
  const buffer = createActionBuffer({ maxPerTurn: 2, maxPerSession: 50 })
  for (const turnId of ['turn-a', 'turn-b']) {
    for (let i = 0; i < 4; i += 1) {
      buffer.add({ kind: 'call', toolCallId: `${turnId}-${i}`, tool: 'x', detail: 'y', command: '', exitCode: null, status: '', output: '' }, { turnId, at: i })
    }
  }
  assert.equal(buffer.list().length, 4)
  assert.equal(buffer.folded('turn-a'), 2)
  assert.equal(buffer.folded('turn-b'), 2)
})

test('an approval is a row too, and it is the one row that is waiting', () => {
  const packet = {
    sessionId: 's1',
    event: { type: 'approval_request', approval: { approvalId: 'ap-1', kind: 'command', availableDecisions: ['allow'], details: { command: 'rm -rf build' } } },
  }
  const buffer = createActionBuffer()
  buffer.add(sessionActivityEvent(packet, 's1'), { turnId: 'turn-a', at: 1 })
  assert.equal(buffer.list()[0].state, 'waiting')
  assert.equal(buffer.list()[0].detail, 'rm -rf build')
})

/* ---------------------------------------------------------------
   C. The words, where the plain-language gate can hold them.
   --------------------------------------------------------------- */

test('a row says what was done in words a person reads, never a status key', () => {
  const words = actionRowWords({ kind: 'result', tool: 'commandExecution', detail: 'npm test', state: 'done', output: '' })
  assert.equal(typeof words.tool, 'string')
  assert.ok(words.tool.length > 0)
  assert.equal(words.detail, 'npm test')
  assert.ok(!/^(done|undone|waiting|working)$/.test(words.state), 'the row shows the internal key rather than a word')
  for (const state of ['working', 'done', 'undone', 'waiting']) {
    assert.ok(actionRowWords({ kind: 'call', tool: 'x', detail: 'y', state, output: '' }).state.length > 0, `${state} has no words`)
  }
})

/* ---------------------------------------------------------------
   D. The chat's second door.
   --------------------------------------------------------------- */

/* SLICED BY STRUCTURE: the door is everything between its own heading and the
   actions popup that follows it. A fixed byte window would report a live
   behaviour as missing the first time somebody adds a note. */
const door = components.slice(
  components.indexOf('---- THE SECOND DOOR'),
  components.indexOf('---- THE ACTIONS POPUP'),
)

test('buildChat has a door for actions beside the one for turns', () => {
  assert.match(components, /Object\.defineProperty\(root, 'addAction'/, 'the chat has no way to be told what the agent did')
  assert.ok(door.length > 200, 'the action door is gone; this suite is pinned to nothing')
  assert.match(door, /chat-action/, 'the action row has no class, so it cannot be styled or found')
  assert.match(door, /actionRows\.get\(/, 'rows are not joined on the id, so a result appends a second row')
})

test('the action rows land in the SAME log as the messages, in arrival order', () => {
  assert.match(door, /log\.appendChild/, 'actions are drawn somewhere other than the conversation')
})

test('appends are batched per frame, through the shared primitive', () => {
  /* The log is pinned to its bottom by a ResizeObserver and a MutationObserver
     that fire on every appended row. A busy turn emitting thousands of tool
     events would re-pin thousands of times on the main thread. And raw
     requestAnimationFrame is what src/page-frames.js exists to replace: on a
     covered window a frame never comes, so the pending callback -- and the
     whole view it closed over -- is retained for ever. */
  assert.match(door, /onNextFrame\(/, 'action rows are appended one at a time, or through a frame that may never come')
  assert.match(components, /import \{ onNextFrame \} from '\.\/page-frames\.js'/)
})

test('the row itself owns the press, because that is what a press lands on', () => {
  /* MEASURED on a staged packaged build with real mouse events:
     document.elementFromPoint over any part of a collapsed row -- the heading,
     the tool name, the command text -- answers the DETAILS element, not the
     SUMMARY inside it. So the click's target is the details, a handler bound to
     the summary never sees the event (events travel up, never down), and the
     row looked pressable while nothing opened. Three driven runs said
     "nothing opened" before this moved. */
  assert.match(door, /wrap\.addEventListener\('click'/, 'the disclosure is bound to something a press does not land on')
  assert.ok(!/head\.addEventListener\('click'/.test(door), 'the handler is back on the summary, where the press never arrives')
  assert.match(door, /wrap\.open = !wrap\.open/, 'the row no longer opens by hand, so a press on the summary toggles twice')
  assert.match(door, /is-bare/, 'a row with nothing to show can open onto an empty panel')
})

test('a conversation still open keeps the output its rows printed', () => {
  /* The saved record is an excerpt: it keeps the command and not what the
     command printed, because an archive of every tool's output does not belong
     in a person's settings file. But the window still HOLDS that output, so a
     row reopened five minutes later must still open onto it -- the richer copy
     wins for as long as there is one. */
  const merge = view.slice(view.indexOf('function mergeActionsIntoHistory'))
  const body = merge.slice(0, merge.indexOf('function persistTranscript'))
  assert.match(body, /byMoment/, 'the buffer copy is never consulted, so every reopened row loses its output')
  assert.match(body, /richer \? \{ who: 'action', \.\.\.actionChatRow\(richer\) \} : savedActionRow/, 'the record copy wins over the one that still has the output')
})

test('an action row has a rule, and its opened body has one too', () => {
  assert.match(styles, /\.chat-action\b/, 'the action row has no rule; it paints as bare text like the reply bubbles did')
  assert.match(styles, /\.chat-action-detail\b/, 'the command has no rule of its own, so it cannot be truncated on one line')
})

/* ---------------------------------------------------------------
   E. The view: keeps everything it did, and adds the rows.
   --------------------------------------------------------------- */

test('the activity branch keeps the status line and the chip it always had', () => {
  const branch = view.slice(view.indexOf('const activity = sessionActivityEvent(packet, sessionId)'))
  const body = branch.slice(0, branch.indexOf('const status = sessionTurnStatus(packet, sessionId)'))
  assert.match(body, /nodeActivity\.set\(nodeId, line\)/, 'the one-line activity record was removed rather than added to')
  assert.match(body, /data-tree-activity/, 'the rail Details line stopped being written')
  assert.match(body, /scheduleChipRefresh\(nodeId\)/, 'the canvas chip stopped being refreshed')
})

test('and it now files the action where a person can read it later', () => {
  const branch = view.slice(view.indexOf('const activity = sessionActivityEvent(packet, sessionId)'))
  const body = branch.slice(0, branch.indexOf('const status = sessionTurnStatus(packet, sessionId)'))
  assert.match(body, /actionBufferFor\(sessionId\)/, 'nothing keeps the action, so a chat opened mid-turn shows none of them')
  assert.match(body, /broadcastAction\(/, 'the open chat is never told; the rows only appear on a reopen')
  assert.match(body, /foldedActionsLine\(/, 'the per-turn cap is silent; a person is never told there was more')
})

test('the record is written once per TURN, never once per tool event', () => {
  /* A busy turn emits thousands of tool events, and every append writes the
     whole record to storage. Filing per event would put a hundreds-of-kilobyte
     write on the main thread between every command an agent runs. */
  const branch = view.slice(view.indexOf('const activity = sessionActivityEvent(packet, sessionId)'))
  const body = branch.slice(0, branch.indexOf('const status = sessionTurnStatus(packet, sessionId)'))
  assert.ok(!/transcriptAppend\(/.test(body), 'the activity branch writes the durable record on every tool event')
  const record = view.slice(view.indexOf('function recordTurnActions'), view.indexOf('function savedActionRow'))
  assert.match(record, /transcriptAppend\(sessionId, \{[\s\S]{0,120}who: 'action'/, 'the action is not recorded, so it is gone at the next restart')
  assert.match(record, /\{ persist: false \}/, 'each filed action writes the whole record again')
  assert.match(record, /row\.recorded = true/, 'rows are filed twice, so a restart shows the same command over and over')
  assert.match(record, /TRANSCRIPT_LIMITS\.maxActionLines/, 'the record takes every action a turn produced, unbounded')
  /* And it is called where the words are filed -- both endings a turn has. */
  const settle = view.slice(view.indexOf('function settleTurnBoundary'), view.indexOf('function transcriptAppend'))
  assert.match(settle, /recordTurnActions\(sessionId\)/, 'a turn that ended without a completion loses its actions')
  const completion = view.slice(view.indexOf('const status = sessionTurnStatus(packet, sessionId)'))
  assert.match(completion.slice(0, 4000), /recordTurnActions\(sessionId\)/, 'a completed turn loses its actions')
})

test('the chat a person opens mid-turn already shows what has been done', () => {
  const config = view.slice(view.indexOf('function treeChatConfigFor'), view.indexOf('function chatActionRowsFor'))
  assert.match(config, /mergeActionsIntoHistory\(/, 'a chat opened mid-turn shows the conversation with the work missing from it')
})

test('the two surfaces are told the same way the words are', () => {
  /* The delta branch already pushes to the rail chat AND the open card. An
     action that reached only one of them would be the drift this config
     builder exists to prevent. */
  assert.match(view, /function broadcastAction\(/, 'each surface is told separately; they will drift')
  const broadcast = view.slice(view.indexOf('function broadcastAction('))
  assert.match(broadcast.slice(0, 1200), /isConnected/, 'a chat that has been closed is still written to, which is a retained view')
})
