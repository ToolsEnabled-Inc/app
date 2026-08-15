// The durable transcript store (src/session-transcript-store.js).
//
// The assertions worth reading twice:
//
//   1. A damaged RECORD is dropped alone; a damaged ENVELOPE reads as empty.
//      This store deliberately fails at the opposite grain from fleet-trees'
//      all-or-nothing parser, because one oversized conversation must not
//      erase the others — that asymmetry is documented in both headers and a
//      change to either side should have to look here first.
//   2. Every bound is enforced at save, not trusted at read: lines per node,
//      characters per line, records per computer, and the envelope's
//      serialized size — and the record being saved is never evicted to make
//      room for itself.
//   3. The seed text is oldest-first and drops OLDEST lines under its budget,
//      saying so — the newest words are where the work stands.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  TRANSCRIPT_LIMITS,
  createTranscriptStore,
  parseTranscriptRow,
  transcriptSeedText,
  transcriptStorageKey,
} from '../../src/session-transcript-store.js'

const COMPUTER = 'c1'

/* The same face safeTreeStorage presents: read hands back a parsed value,
   write takes one. Deep-copied both ways so a test cannot pass by mutating
   the store's own memory. */
function fakeSeam() {
  const held = new Map()
  return {
    read: key => (held.has(key) ? JSON.parse(JSON.stringify(held.get(key))) : null),
    write: (key, value) => { held.set(key, JSON.parse(JSON.stringify(value))); return true },
    held,
  }
}

const line = (who, text, at = 1000) => ({ who, text, at })

test('nothing stored reads as empty and undamaged', () => {
  assert.deepEqual(parseTranscriptRow(null), { nodes: {}, damaged: false })
  assert.deepEqual(parseTranscriptRow(undefined), { nodes: {}, damaged: false })
})

test('a damaged envelope degrades to empty and says so', () => {
  for (const raw of ['text', 42, [], { v: 2, nodes: {} }, { nodes: {} }]) {
    const parsed = parseTranscriptRow(raw)
    assert.deepEqual(parsed.nodes, {}, `nodes must be empty for ${JSON.stringify(raw)}`)
    assert.equal(parsed.damaged, true, `damaged must be said for ${JSON.stringify(raw)}`)
  }
})

test('a damaged record is dropped alone — the other conversations survive', () => {
  const parsed = parseTranscriptRow({
    v: 1,
    nodes: {
      good: { savedAt: 5, threadId: 't-1', lines: [line('you', 'hello')] },
      noLines: { savedAt: 5, threadId: null, lines: [] },
      badShape: 'not a record',
      badWho: { savedAt: 5, threadId: null, lines: [{ who: 'narrator', text: 'x', at: 1 }] },
    },
  })
  assert.equal(parsed.damaged, false)
  assert.deepEqual(Object.keys(parsed.nodes), ['good'])
  assert.equal(parsed.nodes.good.threadId, 't-1')
})

test('bad wiring throws; a person cannot cause either argument', () => {
  assert.throws(() => createTranscriptStore({ computerId: '', storage: fakeSeam() }), TypeError)
  assert.throws(() => createTranscriptStore({ computerId: COMPUTER, storage: { read() {} } }), TypeError)
})

test('save and read back: lines, threadId, and effort survive the trip', () => {
  const seam = fakeSeam()
  const store = createTranscriptStore({ computerId: COMPUTER, storage: seam })
  assert.equal(store.save('n1', { lines: [line('you', 'do the thing'), line('agent', 'done')], threadId: 'thr-9', effort: 'xhigh' }), true)
  const read = store.get('n1')
  assert.equal(read.threadId, 'thr-9')
  assert.equal(read.effort, 'xhigh')
  assert.deepEqual(read.lines.map(entry => entry.text), ['do the thing', 'done'])
  assert.equal(store.has('n1'), true)
  assert.equal(store.has('n2'), false)
  /* The record landed under this computer's own key. */
  assert.ok(seam.held.has(transcriptStorageKey(COMPUTER)))
})

test('an unknown depth reads as none recorded, never as a value to re-send', () => {
  const store = createTranscriptStore({ computerId: COMPUTER, storage: fakeSeam() })
  store.save('n1', { lines: [line('you', 'hi')], effort: 'ultra' })
  assert.equal(store.get('n1').effort, null)
})

test('line bounds land at save: newest lines kept, long text cut', () => {
  const store = createTranscriptStore({ computerId: COMPUTER, storage: fakeSeam() })
  const many = Array.from({ length: TRANSCRIPT_LIMITS.maxLines + 10 }, (_, i) => line('you', `m${i}`))
  store.save('n1', { lines: many })
  const read = store.get('n1')
  assert.equal(read.lines.length, TRANSCRIPT_LIMITS.maxLines)
  assert.equal(read.lines[read.lines.length - 1].text, `m${TRANSCRIPT_LIMITS.maxLines + 9}`)
  store.save('n2', { lines: [line('agent', 'x'.repeat(TRANSCRIPT_LIMITS.maxLineChars + 50))] })
  assert.equal(store.get('n2').lines[0].text.length, TRANSCRIPT_LIMITS.maxLineChars)
})

test('a save of nothing is refused rather than recorded', () => {
  const store = createTranscriptStore({ computerId: COMPUTER, storage: fakeSeam() })
  assert.equal(store.save('n1', { lines: [] }), false)
  assert.equal(store.save('', { lines: [line('you', 'hi')] }), false)
  assert.equal(store.has('n1'), false)
})

test('the record cap holds and the newest save always survives it', () => {
  const store = createTranscriptStore({ computerId: COMPUTER, storage: fakeSeam() })
  for (let i = 0; i < TRANSCRIPT_LIMITS.maxNodes + 4; i += 1) {
    assert.equal(store.save(`n${i}`, { lines: [line('you', `hello ${i}`)] }), true)
  }
  /* Count through the public face: has() re-reads the envelope every call. */
  let count = 0
  for (let i = 0; i < TRANSCRIPT_LIMITS.maxNodes + 4; i += 1) if (store.has(`n${i}`)) count += 1
  assert.equal(count, TRANSCRIPT_LIMITS.maxNodes)
  assert.equal(store.has(`n${TRANSCRIPT_LIMITS.maxNodes + 3}`), true, 'the newest save must never be the eviction')
})

test('the envelope size bound evicts others, never the record being saved', () => {
  const store = createTranscriptStore({ computerId: COMPUTER, storage: fakeSeam() })
  const fat = Array.from({ length: TRANSCRIPT_LIMITS.maxLines }, (_, i) =>
    line(i % 2 ? 'you' : 'agent', 'w'.repeat(TRANSCRIPT_LIMITS.maxLineChars)))
  for (let i = 0; i < 6; i += 1) assert.equal(store.save(`fat${i}`, { lines: fat }), true)
  assert.equal(store.has('fat5'), true, 'the last save must have survived its own eviction pass')
})

test('remove forgets one conversation and leaves the rest', () => {
  const store = createTranscriptStore({ computerId: COMPUTER, storage: fakeSeam() })
  store.save('n1', { lines: [line('you', 'a')] })
  store.save('n2', { lines: [line('you', 'b')] })
  assert.equal(store.remove('n1'), true)
  assert.equal(store.has('n1'), false)
  assert.equal(store.has('n2'), true)
  assert.equal(store.remove('n1'), true, 'removing what is absent is already the goal state')
})

test('the seed text is oldest-first inside a frame that names both voices', () => {
  const seed = transcriptSeedText([line('you', 'first ask'), line('agent', 'first answer'), line('you', 'second ask')])
  assert.ok(seed.startsWith('You are taking over from an earlier agent'))
  const askAt = seed.indexOf('The person said: first ask')
  const answerAt = seed.indexOf('The agent before you said: first answer')
  const secondAt = seed.indexOf('The person said: second ask')
  assert.ok(askAt > -1 && answerAt > askAt && secondAt > answerAt, 'lines must read in the order they were spoken')
  assert.ok(seed.includes('do not redo it'))
  assert.equal(transcriptSeedText([]), '')
})

test('a seed over budget drops the OLDEST words and says so', () => {
  const lines = Array.from({ length: 30 }, (_, i) => line('you', `${i}:${'x'.repeat(500)}`))
  const seed = transcriptSeedText(lines)
  assert.ok(seed.length < TRANSCRIPT_LIMITS.seedMaxChars + 600, 'the frame may exceed the budget only by its fixed sentences')
  assert.ok(seed.includes('(Older messages were left out to fit.)'))
  assert.ok(seed.includes('The person said: 29:'), 'the newest line must survive')
  assert.ok(!seed.includes('The person said: 0:'), 'the oldest line must be the one dropped')
})
