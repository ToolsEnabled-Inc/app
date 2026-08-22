/* The words the Agent comms page shows, measured as words.
 *
 * These are the first tests of any rendered sentence on that page: before
 * src/comms-copy.js existed every sentence was composed inside closures in a
 * view that imports a stylesheet, so nothing could load it in node and nothing
 * covered the rail, the board, the segs or a single notice. What is pinned
 * here is what the owner filed: one fact said once (the inventory), plurals
 * spelled right for 0/1/2, no jargon from the plain-language gate's list, every
 * refusal at most 25 words a sentence with a next step in it, and the row
 * model that turns a report message into what a person sees.
 *
 * Run: node --test tools/test/comms-copy.test.mjs
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  COMMS_NAME, MODE_LABELS, RAIL_GROUPS, NO_SERVICES,
  LOADING_LINE, UNREADABLE_SUB, READ_STATE_WORDS, readStateWord, EXAMPLE_BADGE,
  inventoryLine, describe, serviceLine, emptyLine, boardEmptyLine,
  READER_REFUSALS, LOAD_FAILED,
  FOLD_CHARS, shouldFold, foldSummary,
  SENDER_HUES, senderHues, rowModel, KINDS, NO_ANSWER_YET,
  dayLabel, sameDay,
} from '../../src/comms-copy.js'
import { commsQuietNotice, hostAbsentNotice } from '../../src/first-run-needs.js'
import { IDENTIFIER_RE } from '../../src/refusal-copy.js'
import { sentencesOf, wordsOf } from '../lib/user-visible-strings.mjs'

const ROOT = new URL('../../', import.meta.url)
const read = (file) => readFileSync(new URL(file, ROOT), 'utf8')

/* The names the page was cleared of, and the gate's jargon it must not use. */
const BANNED = [/message board/i, /watch board/i, /ops projection/i, /\bprojection\b/i, /\benvelope\b/i, /\bpayload\b/i, /\brenderer\b/i, /seen running/i, /\bMCP\b/]
/* The four nouns the old header used for one count; the inventory line may use none of them. */
const COUNT_NOUNS = [/\bon record\b/i, /\bdeclared\b/i, /separate records/i]
/* The action vocabulary tools/check-plain-language.mjs holds a failure to. */
const ACTION_VERB = /\b(try|press|open|close|choose|pick|refresh|reload|check|look|correct|shorten|stop|start|wait|turn|reinstall|ask|sign|read|change|run|install|move|use|add|remove|answer|come back|go|let|allow|permit|see|show|update|restart)\b/i

const report = ({ services = 2, channels = 3, messages = 5, live = 2, dead = 1, channelsOk = true, messagesOk = true, mcpOk = true } = {}) => ({
  declaredServices: Array.from({ length: services }, (unused, i) => ({ id: `s${i}`, displayName: `service ${i}`, transport: 'relay', port: 61411 + i })),
  channels: channelsOk
    ? { ok: true, reason: null, observedAt: null, value: Array.from({ length: channels }, (unused, i) => ({ id: `c${i}`, name: `c${i}`, state: 'healthy' })) }
    : { ok: false, reason: 'no', observedAt: null, value: null },
  mcp: mcpOk
    ? { ok: true, reason: null, observedAt: null, value: { live: Array.from({ length: live }, (unused, i) => `l${i}`), dead: Array.from({ length: dead }, (unused, i) => `d${i}`) } }
    : { ok: false, reason: 'no', observedAt: null, value: null },
  messages: messagesOk
    ? { ok: true, reason: null, observedAt: null, value: Array.from({ length: messages }, (unused, i) => ({ id: `m${i}`, channelId: 'c0', sender: 'a', at: '2026-08-20T12:00:00.000Z', text: 'x' })) }
    : { ok: false, reason: 'no', observedAt: null, value: null },
})

test('the page has one name and the mode switch names the faces, not the page', () => {
  assert.equal(COMMS_NAME, 'Agent comms')
  assert.deepEqual(MODE_LABELS, { watch: 'Board', channels: 'Channels' })
  assert.deepEqual(RAIL_GROUPS, { services: 'Services', channels: 'Channels' })
  for (const text of [COMMS_NAME, ...Object.values(MODE_LABELS), ...Object.values(RAIL_GROUPS), NO_SERVICES, LOADING_LINE, UNREADABLE_SUB, EXAMPLE_BADGE, ...Object.values(READ_STATE_WORDS)]) {
    for (const banned of BANNED) assert.ok(!banned.test(text), `${JSON.stringify(text)} uses a banned name: ${banned}`)
  }
})

test('the inventory line counts each noun once, with plurals for 0/1/2', () => {
  const line = inventoryLine(report())
  assert.equal(line, '2 services · 3 channels · 5 messages · tool links: 2 live, 1 not answering')
  for (const banned of [...BANNED, ...COUNT_NOUNS]) assert.ok(!banned.test(line), `inventory uses ${banned}`)
  const one = inventoryLine(report({ services: 1, channels: 1, messages: 1 }))
  assert.match(one, /^1 service · 1 channel · 1 message · /)
  const none = inventoryLine(report({ services: 0, channels: 0, messages: 0 }))
  assert.match(none, /^0 services · 0 channels · 0 messages · /)
  /* each noun exactly once */
  for (const noun of ['service', 'channel', 'message', 'tool links']) {
    assert.equal((line.match(new RegExp(noun, 'g')) || []).length, 1, `${noun} is said once`)
  }
})

test('a part that could not be read says so in its own segment; the messages segment is left to the notice', () => {
  const channels = inventoryLine(report({ channelsOk: false }))
  assert.match(channels, /channels could not be read/)
  assert.doesNotMatch(channels, /\d+ channels?\b/)
  const mcp = inventoryLine(report({ mcpOk: false }))
  assert.match(mcp, /tool links could not be read/)
  const messages = inventoryLine(report({ messagesOk: false }))
  assert.doesNotMatch(messages, /message/, 'the notice above the card says it; the inventory does not repeat it')
  assert.match(messages, /^2 services · 3 channels · tool links: 2 live, 1 not answering$/)
  /* the sub line on a whole-read failure never carries a count */
  assert.doesNotMatch(UNREADABLE_SUB, /\d/)
})

test('every refusal is short, reads as sentences, is not a code, and names a next step', () => {
  const reasons = [
    READER_REFUSALS.NO_READER,
    READER_REFUSALS.NO_ANSWER,
    READER_REFUSALS.READ_THREW(new Error('socket closed')),
    READER_REFUSALS.READ_THREW('plain text'),
    READER_REFUSALS.READ_THREW(undefined),
    LOAD_FAILED(new Error('timed out')),
    LOAD_FAILED(null),
  ]
  for (const reason of reasons) {
    assert.ok(!IDENTIFIER_RE.test(reason.trim()), `${reason} is a bare code`)
    assert.match(reason, /[.!?]$/, `${reason} ends as a sentence`)
    for (const sentence of sentencesOf(reason)) {
      assert.ok(wordsOf(sentence).length <= 25, `${JSON.stringify(sentence)} is ${wordsOf(sentence).length} words`)
    }
    assert.match(reason, ACTION_VERB, `${reason} names nothing to do`)
    for (const banned of BANNED) assert.ok(!banned.test(reason), `${reason} uses ${banned}`)
  }
  assert.match(READER_REFUSALS.READ_THREW(undefined), /\(no reason given\)/)
  assert.match(READER_REFUSALS.READ_THREW(new Error('socket closed')), /\(socket closed\)/)
})

test('the empty lines are answers, distinct from the two whole-page notices', () => {
  for (const line of [emptyLine(), boardEmptyLine(), NO_SERVICES]) {
    assert.doesNotMatch(line, /could not|unavailable|failed/i, 'an empty answer is not a failure')
    assert.notEqual(line, commsQuietNotice().body)
    assert.notEqual(line, hostAbsentNotice().body)
    assert.ok(!commsQuietNotice().body.includes(line))
  }
  assert.notEqual(emptyLine(), boardEmptyLine())
})

test('describe(channel) is "{state} · {detail}", and just the state with no detail', () => {
  assert.equal(describe({ state: 'healthy', detail: 'sample board — demonstration traffic' }), 'healthy · sample board — demonstration traffic')
  assert.equal(describe({ state: 'stale', detail: '' }), 'stale')
  assert.equal(describe({ state: 'stale', detail: null }), 'stale')
  assert.equal(describe({}), 'unknown')
  assert.equal(serviceLine({ displayName: 'sample relay', transport: 'relay', port: 61411 }), 'sample relay · relay · port 61411')
})

test('the read-state word follows the root attribute, one word per state', () => {
  assert.equal(readStateWord('ready'), 'live')
  assert.equal(readStateWord('partial-unavailable'), 'partial')
  assert.equal(readStateWord('unavailable'), 'could not be read')
  assert.equal(readStateWord('simulated'), 'example')
  assert.equal(readStateWord('loading'), 'reading')
  assert.equal(readStateWord('nonsense'), 'reading')
})

test('shouldFold: 280 characters stay open, 281 fold, three line breaks fold', () => {
  assert.equal(shouldFold('x'.repeat(FOLD_CHARS)), false)
  assert.equal(shouldFold('x'.repeat(FOLD_CHARS + 1)), true)
  assert.equal(shouldFold('a\nb\nc'), false)
  assert.equal(shouldFold('a\nb\nc\nd'), true)
  assert.equal(shouldFold(''), false)
  assert.equal(shouldFold(null), false)
})

test('foldSummary ends with the size in words and opens with the first sentence, cut at 90', () => {
  const summary = foldSummary('First sentence here. Second sentence is longer and says more.\nThird.')
  assert.match(summary, /· 11 words$/)
  assert.equal(summary, 'First sentence here… · 11 words')
  const long = foldSummary(`${'word '.repeat(40)}end. tail`)
  const head = long.split(' · ')[0]
  assert.ok(head.length <= 91, `${head.length} characters before the cut`)
  assert.ok(head.endsWith('…'))
  assert.match(long, /· 42 words$/)
  assert.match(foldSummary(''), /0 words$/)
})

test('rowModel: a notice prints no tag, an answer names its parent, an orphan prints nothing, an ask with no answer says so', () => {
  const messages = [
    { id: 'a1', sender: 'luna', at: '2026-08-20T10:00:00.000Z', text: 'Is the lock free?', kind: 'ask' },
    { id: 'n1', sender: 'controller', at: '2026-08-20T10:01:00.000Z', text: 'noted' },
    { id: 'r1', sender: 'codexb', at: '2026-08-20T10:02:00.000Z', text: 'Yes.', kind: 'answer', causalParent: 'a1', recipient: 'luna', senderMachine: 'host-b' },
    { id: 'o1', sender: 'codexb', at: '2026-08-20T10:03:00.000Z', text: 'orphan', kind: 'answer', causalParent: 'elsewhere' },
    { id: 'a2', sender: 'luna', at: '2026-08-20T10:04:00.000Z', text: 'And the lease?', kind: 'ask' },
  ]
  const byId = new Map(messages.map(m => [m.id, m]))
  const notice = rowModel(messages[1], byId)
  assert.equal(notice.kind, 'notice')
  assert.equal(notice.tag, '')
  assert.equal(notice.replyTo, '')
  assert.equal(notice.recipient, '')
  assert.equal(notice.machine, '')
  assert.equal(notice.noAnswer, false)
  const answered = rowModel(messages[0], byId)
  assert.equal(answered.tag, 'asked')
  assert.equal(answered.noAnswer, false, 'r1 answers a1')
  const reply = rowModel(messages[2], byId)
  assert.equal(reply.tag, 'answered')
  assert.equal(reply.replyTo, 'replying to luna')
  assert.equal(reply.parentId, 'a1')
  assert.equal(reply.recipient, 'luna')
  assert.equal(reply.machine, 'host-b')
  assert.equal(reply.at, Date.parse('2026-08-20T10:02:00.000Z'))
  const orphan = rowModel(messages[3], byId)
  assert.equal(orphan.replyTo, '', 'a parent outside the channel is a link to nowhere')
  assert.equal(orphan.parentId, '')
  const unanswered = rowModel(messages[4], byId)
  assert.equal(unanswered.noAnswer, true)
  assert.equal(NO_ANSWER_YET, 'no answer yet')
  /* an unknown kind is a notice; a missing map is tolerated */
  assert.equal(rowModel({ id: 'x', sender: 's', text: 't', kind: 'shout' }).kind, 'notice')
  assert.ok(Object.isFrozen(notice))
  assert.deepEqual(KINDS, ['ask', 'answer', 'notice'])
})

test('senderHues are stable by first appearance and cycle the six role hues', () => {
  const hues = senderHues([{ sender: 'b' }, { sender: 'a' }, { sender: 'b' }, { sender: 'c' }])
  assert.equal(hues.get('b'), SENDER_HUES[0])
  assert.equal(hues.get('a'), SENDER_HUES[1])
  assert.equal(hues.get('c'), SENDER_HUES[2])
  assert.equal(hues.size, 3)
  const many = senderHues(Array.from({ length: 8 }, (unused, i) => ({ sender: `s${i}` })))
  assert.equal(many.get('s6'), SENDER_HUES[0], 'the seventh sender wraps to the first hue')
  assert.equal(senderHues(null).size, 0)
})

test('SENDER_HUES are the ROLES hexes from src/vocab.js, in ROLES order', () => {
  const vocab = read('src/vocab.js')
  const start = vocab.indexOf('export const ROLES')
  const block = vocab.slice(start, vocab.indexOf('\n}', start))
  const hexes = [...block.matchAll(/hex: '(#[0-9a-f]{6})'/g)].map(m => m[1])
  assert.deepEqual([...SENDER_HUES], hexes)
})

test('dayLabel across midnight on the local calendar', () => {
  const now = new Date(2026, 7, 22, 0, 10).getTime()           // 00:10 on 22 Aug
  assert.equal(dayLabel(now, now), 'Today')
  assert.equal(dayLabel(now - 20 * 60_000, now), 'Yesterday')   // 23:50 on 21 Aug
  assert.equal(dayLabel(new Date(2026, 7, 20, 23, 59).getTime(), now), '20 Aug')
  assert.equal(sameDay(now, now - 20 * 60_000), false)
  assert.equal(sameDay(now, now + 60_000), true)
})
