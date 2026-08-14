import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

import { sessionUsageEvent } from '../../src/agent-session-events.js'
import { usageSentence } from '../../src/fleet-tree-copy.js'
import { parseSlashCommand, slashHelpSentence, SLASH_COMMANDS } from '../../src/slash-commands.js'

const ROOT = resolve(import.meta.dirname, '..', '..')
const read = file => readFileSync(resolve(ROOT, file), 'utf8')

/* C1: what the session says and what it costs; C2: the console vocabulary.
   The usage events crossed the wire from day one and were dropped; the card
   opened empty over nodes that had plainly spoken. These pin the repairs. */

test('the usage reader admits numbers from its own session and nothing else', () => {
  const packet = {
    sessionId: 'chat-1',
    event: { type: 'usage', turnId: 'turn-9', usage: { input_tokens: 1200, output_tokens: 300, note: 'prose', path: 'C:/x', nested: { a: 1 }, bad: Infinity } },
  }
  const reading = sessionUsageEvent(packet, 'chat-1')
  assert.deepEqual(reading, { turnId: 'turn-9', usage: { input_tokens: 1200, output_tokens: 300 } },
    'only finite numeric fields may survive — prose or a path in a usage record must never reach a screen')
  assert.equal(sessionUsageEvent(packet, 'chat-2'), null, 'another session\'s usage is not yours')
  assert.equal(sessionUsageEvent({ sessionId: 'chat-1', event: { type: 'assistant_text' } }, 'chat-1'), null)
})

test('the reader unwraps the engine\'s measured nested shape (total + modelContextWindow)', () => {
  /* Captured live from codex 0.146 app-server, 2026-08-14. */
  const packet = {
    sessionId: 'chat-1',
    event: {
      type: 'usage', turnId: 'turn-2',
      usage: {
        total: { totalTokens: 28246, inputTokens: 28180, cachedInputTokens: 23040, cacheWriteInputTokens: 0, outputTokens: 66, reasoningOutputTokens: 31 },
        last: { totalTokens: 14133, inputTokens: 14127, cachedInputTokens: 13056, cacheWriteInputTokens: 0, outputTokens: 6, reasoningOutputTokens: 0 },
        modelContextWindow: 258400,
      },
    },
  }
  const reading = sessionUsageEvent(packet, 'chat-1')
  assert.equal(reading.usage.totalTokens, 28246, 'the session-lifetime total is the reading')
  assert.equal(reading.usage.inputTokens, 28180)
  assert.equal(reading.usage.modelContextWindow, 258400)
  assert.equal(reading.usage.last, undefined, 'nested records do not ride whole')
  const sentence = usageSentence(reading.usage)
  assert.match(sentence, /28 thousand tokens/, 'the lifetime total renders in words')
  assert.match(sentence, /window holds/, 'the context window is worth a sentence')
})

test('the usage sentence is words, never bare token codes, and admits ignorance', () => {
  const sentence = usageSentence({ input_tokens: 52_000, output_tokens: 900, cached_input_tokens: 21_000 })
  assert.match(sentence, /thousand tokens/, 'counts render as words')
  assert.match(sentence, /read/, 'input renders as reading')
  assert.match(sentence, /cache/, 'cache savings are worth a clause')
  assert.ok(!/input_tokens|output_tokens/.test(sentence), 'field names are not sentences')
  assert.match(usageSentence({ mystery_field: 5 }), /does not recognise/, 'an unrecognised shape says so instead of inventing a number')
})

test('slash commands map only onto actions the palette already binds', () => {
  const view = read('src/views/computers.js')
  for (const command of SLASH_COMMANDS) {
    assert.ok(view.includes(`'${command.action}'`), `/${command.name} names palette action ${command.action}, which the view does not bind`)
  }
  assert.deepEqual(parseSlashCommand('/interrupt'), { kind: 'action', action: 'interrupt', rest: '' })
  assert.deepEqual(parseSlashCommand('/queue check the tests'), { kind: 'action', action: 'queue', rest: 'check the tests' })
  assert.equal(parseSlashCommand('/help').kind, 'help')
  assert.match(slashHelpSentence(), /\/interrupt/, 'help names the real commands')
})

test('a typo is caught, a path is not eaten, plain text passes through', () => {
  const typo = parseSlashCommand('/interupt')
  assert.equal(typo.kind, 'unknown')
  assert.match(typo.sentence, /not a command here, so nothing was sent/)
  assert.equal(parseSlashCommand('/usr/bin/thing --flag'), null, 'a path sends as text')
  assert.equal(parseSlashCommand('read C:/data/notes.md'), null)
  assert.equal(parseSlashCommand('  plain words  '), null)
})

test('the view intercepts the vocabulary at both inputs, before anything sends', () => {
  const view = read('src/views/computers.js')
  const card = view.slice(view.indexOf('function treeCardSend'))
  assert.ok(card.indexOf('parseSlashCommand') !== -1
    && card.indexOf('parseSlashCommand') < card.indexOf('outboxEnqueue'),
    'the card parses commands after it queues — /interrupt while busy is exactly when it matters')
  const queue = view.slice(view.indexOf('const submitQueued'))
  assert.ok(queue.indexOf('parseSlashCommand') !== -1
    && queue.indexOf('parseSlashCommand') < queue.indexOf('outboxEnqueue'),
    'the queue box no longer understands the vocabulary')
})

test('the conversation is kept and the card opens over it, never empty and never simulated', () => {
  const view = read('src/views/computers.js')
  assert.match(view, /sessionTranscripts/, 'the transcript map is gone')
  for (const anchor of ['transcriptAppend(node.sessionId', 'transcriptAppend(sessionId']) {
    assert.ok(view.includes(anchor), `sends or completions no longer file into the transcript (${anchor})`)
  }
  assert.match(view, /history = sessionTranscripts\.get\(node\.sessionId\)/, 'the card no longer reads the real transcript')
  assert.match(view, /turnLogAppend/, 'the turn log (the rewind anchor) is gone')
  const components = read('src/components.js')
  assert.ok(components.indexOf('Array.isArray(history) && history.length') !== -1,
    'buildChat no longer renders caller-supplied history')
  assert.match(components, /seeded = Array\.isArray\(history\) && history\.length \? \[\]/,
    'real history must silence the simulated excerpt entirely')
  const graph = read('src/tree-graph.js')
  assert.match(graph, /history: Array\.isArray\(config\.history\)/, 'the graph drops the history on the way to the card')
})

test('clear starts the conversation over for real: close, fresh session, nothing re-sent', () => {
  const view = read('src/views/computers.js')
  const clear = view.slice(view.indexOf(`if (id === 'clear')`))
  assert.ok(clear.length > 400, 'the clear action left the palette')
  assert.ok(clear.indexOf('await bridge.close(') !== -1 && clear.indexOf('await bridge.close(') < clear.indexOf('await bridge.start('),
    'clear must close the old session before starting the fresh one')
  assert.ok(!/bridge\.send/.test(clear.slice(0, clear.indexOf('if (id ==='))),
    'clear re-sends the brief — re-running the original ask uninvited could redo real work')
  for (const wiped of ['sessionTranscripts.delete', 'sessionTurnLog.delete', 'sessionUsage.delete', 'sessionModelOverride.delete']) {
    assert.ok(clear.includes(wiped), `clear no longer wipes ${wiped.split('.')[0]} — a forgotten agent with a remembered screen is a lie in one direction or the other`)
  }
  assert.match(view, /tier: draft\.tier/, 'the compose panel no longer records the tier a restart honestly reuses')
  const store = read('src/fleet-trees.js')
  assert.match(store, /tier: typeof entry\.tier === 'string'/, 'the store no longer reads the recorded tier forgivingly')
})

test('the usage row exists in the rail and fills from the live ear', () => {
  const view = read('src/views/computers.js')
  assert.match(view, /data-tree-usage/, 'the rail lost its usage row')
  assert.match(view, /sessionUsageEvent\(packet, sessionId\)/, 'the ear no longer reads usage events')
  assert.match(view, /usageSentence\(/, 'usage renders as fields, not words')
})
