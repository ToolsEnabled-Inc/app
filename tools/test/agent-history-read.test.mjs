/* The read side of the app's own agent record.
 *
 * The home screen shows a person what has run on their computer, and this is
 * the only path by which that reaches the renderer -- which is to say, the DOM.
 * So the interesting assertions here are not about what it returns but about
 * what it MUST NOT: the working directory of every session it recorded, the
 * signing key's signatures, and the chain hashes. Each is present in the file
 * it reads, each would be trivial to pass along, and each is either a path out
 * of this machine's filesystem or a credential-shaped value that a page has no
 * use for and no way to check.
 *
 * The whole-chain verification result travels instead, computed here, where the
 * key is.
 */
import assert from 'node:assert/strict'
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createSpawnRecorder } from '../../shell/spawn-record.cjs'

function keystore() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (text) => Buffer.from(`enc:${Buffer.from(text, 'utf8').toString('base64')}`, 'utf8'),
    decryptString: (buffer) => {
      const stored = buffer.toString('utf8')
      if (!stored.startsWith('enc:')) throw new Error('not encrypted by this keystore')
      return Buffer.from(stored.slice(4), 'base64').toString('utf8')
    },
  }
}

function workspace(t) {
  const directory = mkdtempSync(join(tmpdir(), 'agent-history-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}

/* A path that is unmistakable in any output it leaks into. */
const SECRET_CWD = 'C:\\Users\\someone\\Documents\\A Private Folder'

test('an empty machine reports no runs rather than an error', (t) => {
  const recorder = createSpawnRecorder({ safeStorage: keystore(), directory: workspace(t) })
  const history = recorder.history()
  assert.equal(history.ok, true)
  assert.equal(history.total, 0)
  assert.deepEqual([...history.entries], [])
  assert.equal(history.verified, true, 'an empty chain is an intact chain')
})

test('runs come back newest first, with a whole-chain verdict', (t) => {
  const recorder = createSpawnRecorder({ safeStorage: keystore(), directory: workspace(t) })
  recorder.record({ action: 'agent_session_start', sessionId: 'one', details: { cwd: SECRET_CWD } })
  recorder.record({ action: 'agent_session_start', sessionId: 'two', details: { cwd: SECRET_CWD } })
  recorder.record({ action: 'agent_session_start', sessionId: 'three', details: { cwd: SECRET_CWD } })

  const history = recorder.history()
  assert.equal(history.ok, true)
  assert.equal(history.total, 3)
  assert.deepEqual(history.entries.map(entry => entry.sequence), [3, 2, 1])
  assert.equal(history.verified, true)
})

test('no working directory reaches the renderer, though every record holds one', (t) => {
  const directory = workspace(t)
  const recorder = createSpawnRecorder({ safeStorage: keystore(), directory })
  recorder.record({ action: 'agent_session_start', sessionId: 'one', details: { cwd: SECRET_CWD } })

  /* Proof the path really is in the file, so the assertion below is testing
     removal and not the absence of an input. */
  assert.match(readFileSync(recorder.ledgerPath, 'utf8'), /A Private Folder/)

  const serialized = JSON.stringify(recorder.history())
  assert.doesNotMatch(serialized, /A Private Folder/)
  assert.doesNotMatch(serialized, /someone/)
  assert.equal(serialized.includes('details'), false, 'the details object is dropped whole, not filtered')
})

test('no signature or chain hash reaches the renderer', (t) => {
  const recorder = createSpawnRecorder({ safeStorage: keystore(), directory: workspace(t) })
  const receipt = recorder.record({ action: 'agent_session_start', sessionId: 'one' })

  const serialized = JSON.stringify(recorder.history())
  assert.doesNotMatch(serialized, /signature/i)
  assert.doesNotMatch(serialized, /eventHash/i)
  assert.doesNotMatch(serialized, /previousHash/i)
  assert.equal(serialized.includes(receipt.eventHash), false)

  for (const entry of recorder.history().entries) {
    assert.deepEqual(Object.keys(entry).sort(), ['action', 'at', 'sequence'])
  }
})

test('a tampered chain is reported, and the runs are still shown', (t) => {
  const directory = workspace(t)
  const recorder = createSpawnRecorder({ safeStorage: keystore(), directory })
  recorder.record({ action: 'agent_session_start', sessionId: 'one' })
  recorder.record({ action: 'agent_session_start', sessionId: 'two' })

  const lines = readFileSync(recorder.ledgerPath, 'utf8').split('\n').filter(Boolean)
  const first = JSON.parse(lines[0])
  first.sessionId = 'someone-elses-session'
  writeFileSync(recorder.ledgerPath, `${JSON.stringify(first)}\n${lines[1]}\n`)

  const reopened = createSpawnRecorder({ safeStorage: keystore(), directory })
  const history = reopened.history()
  assert.equal(history.ok, true)
  assert.equal(history.verified, false, 'an edited record must not report as intact')
  assert.equal(history.entries.length, 2, 'and the evidence that something ran is not destroyed')
})

test('a garbled line is skipped rather than taking the whole screen down', (t) => {
  const directory = workspace(t)
  const recorder = createSpawnRecorder({ safeStorage: keystore(), directory })
  recorder.record({ action: 'agent_session_start', sessionId: 'one' })
  appendFileSync(recorder.ledgerPath, 'this is not json\n')

  const reopened = createSpawnRecorder({ safeStorage: keystore(), directory })
  const history = reopened.history()
  assert.equal(history.ok, true)
  assert.equal(history.entries.length, 1)
  assert.equal(history.verified, false, 'an unparsable line is a broken chain, and is reported as one')
})

test('the returned tail is bounded however large the record grows', (t) => {
  const recorder = createSpawnRecorder({ safeStorage: keystore(), directory: workspace(t) })
  for (let index = 0; index < 40; index += 1) {
    recorder.record({ action: 'agent_session_start', sessionId: `session-${index}` })
  }

  assert.equal(recorder.history({ limit: 5 }).entries.length, 5)
  assert.equal(recorder.history({ limit: 5 }).total, 40, 'the total still describes the whole record')
  assert.equal(recorder.history().entries.length, 20, 'a caller that names no bound gets a bounded answer')
  assert.equal(recorder.history({ limit: 10_000 }).entries.length, 40, 'and an absurd bound is clamped, not honoured')
  for (const limit of [0, -1, 1.5, Number.NaN, 'twenty', null]) {
    assert.equal(recorder.history({ limit }).entries.length, 20, `a nonsense limit falls back: ${String(limit)}`)
  }
})

/* The assertions about the IPC channel itself live in
   tools/test/agent-history-channel.test.mjs, which lands with the two shell
   files it describes. Keeping them here would have made this suite red in any
   tree that has the recorder but not yet the channel. */
