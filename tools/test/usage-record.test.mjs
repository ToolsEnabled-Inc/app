import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createUsageRecorder, turnUsageFrom, USAGE_LEDGER_FILE } from '../../shell/usage-record.cjs'

/* THE SAME FAKE KEYSTORE tools/test/spawn-record.test.mjs uses, and for the same
   reason: these run without Electron, and it genuinely transforms the bytes so a
   test that asserts the key is not plain on disk is testing the module rather
   than a passthrough. */
function keystore({ available = true } = {}) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (text) => Buffer.from(`enc:${Buffer.from(text, 'utf8').toString('base64')}`, 'utf8'),
    decryptString: (buffer) => {
      const stored = buffer.toString('utf8')
      if (!stored.startsWith('enc:')) throw new Error('not encrypted by this keystore')
      return Buffer.from(stored.slice(4), 'base64').toString('utf8')
    },
  }
}

function workspace(t) {
  const directory = mkdtempSync(join(tmpdir(), 'usage-record-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}

/* ------------------------------------------------------------------
   THE READER: what a `usage` event from each engine actually means.

   Both shapes below are the MEASURED ones -- the codex app-server capture
   recorded in src/agent-session-events.js, and the Claude CLI `result` packet
   whose usage the adapter re-emits (shell/../claude-cli-adapter.js handleResult).
   Nothing here is an invented shape.
   ------------------------------------------------------------------ */

test('a codex usage record reads the LAST turn, and carries the session total beside it', () => {
  const reading = turnUsageFrom({
    total: { inputTokens: 12000, cachedInputTokens: 9000, outputTokens: 800, reasoningOutputTokens: 300, totalTokens: 12800 },
    last: { inputTokens: 4000, cachedInputTokens: 3000, outputTokens: 200, reasoningOutputTokens: 100, totalTokens: 4200 },
    modelContextWindow: 272000,
  })
  assert.equal(reading.basis, 'turn')
  assert.equal(reading.inputTokens, 4000)
  assert.equal(reading.cachedInputTokens, 3000)
  assert.equal(reading.outputTokens, 200)
  assert.equal(reading.reasoningOutputTokens, 100)
  assert.equal(reading.totalTokens, 4200)
  assert.equal(reading.contextWindow, 272000)
  /* The cumulative reading is kept so a screen can CHECK the turns it summed
     against what the engine says the session spent, rather than assert them. */
  assert.equal(reading.sessionTotalTokens, 12800)
})

test('a flat Claude CLI usage record is that turn, under its own field names', () => {
  const reading = turnUsageFrom({
    input_tokens: 6,
    output_tokens: 412,
    cache_creation_input_tokens: 18000,
    cache_read_input_tokens: 32000,
  })
  assert.equal(reading.basis, 'turn')
  assert.equal(reading.inputTokens, 6)
  assert.equal(reading.outputTokens, 412)
  assert.equal(reading.cacheCreationInputTokens, 18000)
  assert.equal(reading.cachedInputTokens, 32000)
  /* NOT INVENTED. The CLI reports no total, so there is none -- a sum written
     here would be this module's number wearing the engine's name. */
  assert.equal(reading.totalTokens, null)
})

test('a record with only a cumulative total says so, so nothing sums it twice', () => {
  const reading = turnUsageFrom({ total: { inputTokens: 900, outputTokens: 100, totalTokens: 1000 } })
  assert.equal(reading.basis, 'session-total')
  assert.equal(reading.totalTokens, 1000)
})

test('prose, paths, nested objects and non-finite numbers never survive the reader', () => {
  const reading = turnUsageFrom({
    input_tokens: 10,
    note: 'this is prose',
    cwd: 'C:\\Users\\somebody\\secret',
    nested: { a: 1 },
    broken: Infinity,
    negative: -5,
  })
  assert.equal(reading.inputTokens, 10)
  for (const key of Object.keys(reading)) {
    assert.ok(!['note', 'cwd', 'nested', 'broken', 'negative'].includes(key), `${key} reached the record`)
  }
})

test('a usage record with no token figure at all is not a reading', () => {
  assert.equal(turnUsageFrom({ note: 'nothing here' }), null)
  assert.equal(turnUsageFrom(null), null)
  assert.equal(turnUsageFrom('42'), null)
  assert.equal(turnUsageFrom([1, 2]), null)
})

/* ------------------------------------------------------------------
   THE RECORD: signed, chained, durable, and its own file.
   ------------------------------------------------------------------ */

test('a recorded turn is signed, chained and readable back', (t) => {
  const directory = workspace(t)
  const recorder = createUsageRecorder({ safeStorage: keystore(), directory })

  assert.deepEqual(recorder.availability(), { ok: true, code: 'SPAWN_RECORD_READY' })

  const receipt = recorder.recordTurn({
    sessionId: 'chat-1',
    principal: 'unauthenticated',
    turnId: 'turn-1',
    tier: 'luna',
    account: 'personal',
    status: 'completed',
    usage: turnUsageFrom({ last: { inputTokens: 4000, outputTokens: 200, totalTokens: 4200 }, modelContextWindow: 272000 }),
  })
  assert.equal(receipt.sequence, 1)
  assert.equal(receipt.durable, true)
  assert.equal(receipt.signed, true)

  const read = recorder.usage({ limit: 20 })
  assert.equal(read.ok, true)
  assert.equal(read.verified, true)
  assert.equal(read.total, 1)
  const [entry] = read.entries
  assert.equal(entry.sessionId, 'chat-1')
  assert.equal(entry.usage.turnId, 'turn-1')
  assert.equal(entry.usage.tier, 'luna')
  assert.equal(entry.usage.account, 'personal')
  assert.equal(entry.usage.totalTokens, 4200)
  assert.equal(entry.usage.basis, 'turn')
})

test('the usage ledger is its OWN file, so turns cannot crowd runs out of the run record', (t) => {
  const directory = workspace(t)
  const recorder = createUsageRecorder({ safeStorage: keystore(), directory })
  recorder.recordTurn({
    sessionId: 'chat-1', turnId: 'turn-1', tier: 'luna',
    usage: turnUsageFrom({ last: { totalTokens: 10 } }),
  })
  const lines = readFileSync(join(directory, USAGE_LEDGER_FILE), 'utf8').trim().split('\n')
  assert.equal(lines.length, 1)
  assert.notEqual(USAGE_LEDGER_FILE, 'agent-spawn-records.jsonl')
  assert.equal(JSON.parse(lines[0]).action, 'agent_turn_usage')
})

test('an edited figure breaks verification, and the turns are still returned', (t) => {
  const directory = workspace(t)
  const recorder = createUsageRecorder({ safeStorage: keystore(), directory })
  recorder.recordTurn({ sessionId: 'chat-1', turnId: 'turn-1', usage: turnUsageFrom({ last: { totalTokens: 10 } }) })
  recorder.recordTurn({ sessionId: 'chat-1', turnId: 'turn-2', usage: turnUsageFrom({ last: { totalTokens: 20 } }) })

  const ledger = join(directory, USAGE_LEDGER_FILE)
  const lines = readFileSync(ledger, 'utf8').trim().split('\n')
  const tampered = JSON.parse(lines[0])
  tampered.usage.totalTokens = 999999
  writeFileSync(ledger, [JSON.stringify(tampered), lines[1]].join('\n') + '\n')

  const reopened = createUsageRecorder({ safeStorage: keystore(), directory })
  const read = reopened.usage({ limit: 20 })
  assert.equal(read.ok, true, 'the turns are still returned')
  assert.equal(read.verified, false, 'and the record says it no longer checks out')
})

test('a turn with no usage reading is refused rather than recorded as zero', (t) => {
  const directory = workspace(t)
  const recorder = createUsageRecorder({ safeStorage: keystore(), directory })
  assert.throws(() => recorder.recordTurn({ sessionId: 'chat-1', turnId: 'turn-1', usage: null }), /usage/i)
  assert.equal(recorder.usage({ limit: 20 }).total, 0)
})

test('a tier, account or status that is not the bounded shape becomes an absence, never a path', (t) => {
  const directory = workspace(t)
  const recorder = createUsageRecorder({ safeStorage: keystore(), directory })
  assert.throws(() => recorder.recordTurn({
    sessionId: 'chat-1', turnId: 'turn-1', tier: 'C:\\Users\\joshp\\work',
    usage: turnUsageFrom({ last: { totalTokens: 10 } }),
  }), /tier/i)
})

test('an unavailable keystore reports it rather than writing an unsigned record', (t) => {
  const directory = workspace(t)
  const recorder = createUsageRecorder({ safeStorage: keystore({ available: false }), directory })
  assert.equal(recorder.availability().ok, false)
  assert.equal(recorder.availability().code, 'SPAWN_RECORD_KEYSTORE_UNAVAILABLE')
})
