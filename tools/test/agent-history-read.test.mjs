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
import { appendFileSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
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

/* ------------------------------------------------------------------
   Not re-checking bytes already checked.

   The screen asks this question repeatedly, on the Electron main process, which
   is also what forwards output for every live agent session -- so the cost is
   not the home screen's, it is every running agent's. The cache exists for
   that. These tests exist because a cache over a tamper-evidence check is
   exactly the kind of optimisation that quietly turns the property into
   decoration, and because "it got faster" is not evidence that it still works.
   ------------------------------------------------------------------ */

/* COUNTED, NOT TIMED. The first version of this asserted that the repeat read
   was three times faster, and it was flaky: during a mutation round it went red
   after a byte-identical restore, which means it accused correct code. A test
   that can do that is worse than no test. What is actually being claimed is
   "the signature work is not repeated", so that is what is measured. */
test('an unchanged record is not re-verified, and a changed one always is', (t) => {
  const directory = workspace(t)
  const recorder = createSpawnRecorder({ safeStorage: keystore(), directory })
  for (let index = 0; index < 40; index += 1) {
    recorder.record({ action: 'agent_session_start', sessionId: `session-${index}` })
  }

  const first = recorder.history({ limit: 5 })
  assert.equal(first.verified, true)
  assert.equal(recorder.stats().signatureChecks, 40, 'the first read checks every signature once')

  const second = recorder.history({ limit: 5 })
  assert.equal(second.verified, true)
  assert.equal(second.total, 40)
  assert.equal(recorder.stats().signatureChecks, 40, 'and the second read checks none of them again')

  /* Appending does NOT serve the old answer, and does NOT re-check the old
     records either: one new record, one new signature check. */
  recorder.record({ action: 'agent_session_start', sessionId: 'session-40' })
  const third = recorder.history({ limit: 5 })
  assert.equal(third.total, 41)
  assert.equal(third.verified, true)
  assert.equal(recorder.stats().signatureChecks, 41, 'an append costs one check, not another whole pass')
})

test('SECURITY: a same-length edit to an old record is caught, not served from the cache', (t) => {
  const directory = workspace(t)
  const recorder = createSpawnRecorder({ safeStorage: keystore(), directory })
  for (let index = 0; index < 20; index += 1) {
    recorder.record({ action: 'agent_session_start', sessionId: `aaaaaaaa-${index}` })
  }

  assert.equal(recorder.history().verified, true, 'the chain checks out and the verdict is now cached')

  /* The attack a size-and-timestamp cache key cannot see: one old record edited
     in place, the file's length unchanged, the timestamp put back. Every field
     such a key compares is identical to what was verified a moment ago. */
  const before = readFileSync(recorder.ledgerPath)
  const stat = statSync(recorder.ledgerPath)
  const lines = before.toString('utf8').split('\n').filter(Boolean)
  const target = JSON.parse(lines[3])
  assert.equal(target.sessionId.length, 'aaaaaaaa-3'.length)
  target.sessionId = 'zzzzzzzz-3'
  lines[3] = JSON.stringify(target)
  const after = Buffer.from(`${lines.join('\n')}\n`, 'utf8')
  assert.equal(after.length, before.length, 'the tampered file is the same length, or this tests nothing')
  writeFileSync(recorder.ledgerPath, after)
  utimesSync(recorder.ledgerPath, stat.atime, stat.mtime)

  /* The SIZE is asserted and the timestamp is not, and that is a correction
     rather than a shortcut. An earlier draft asserted the restored mtime
     equalled the original to the millisecond; it failed roughly two runs in
     five, because utimesSync loses the sub-millisecond fraction and the
     filesystem rounds where the assertion floored. A test that accuses correct
     code two times in five is worse than no test, and it cost a mutation round
     to find.
     Dropping it costs nothing, because the timestamp was never the point: the
     cache does not read it. It compares the file's bytes, so an attacker with a
     PERFECT mtime restore gains nothing either -- a stronger claim than this
     assertion was making, and one proved by planting the size-keyed cache and
     watching this test go red. */
  assert.equal(statSync(recorder.ledgerPath).size, stat.size, 'the tampered file is the same size on disk')

  assert.equal(recorder.history().verified, false, 'an edited record must not be reported as intact')
  assert.equal(recorder.verify().ok, false, 'and the independent check agrees')
})

test('SECURITY: a rewritten prefix under an appended record takes the full check', (t) => {
  const directory = workspace(t)
  const recorder = createSpawnRecorder({ safeStorage: keystore(), directory })
  for (let index = 0; index < 10; index += 1) {
    recorder.record({ action: 'agent_session_start', sessionId: `bbbbbbbb-${index}` })
  }
  assert.equal(recorder.history().verified, true)

  /* The file GROWS, which is the shape the incremental path is for, and its
     prefix is NOT the prefix that was verified. Chaining onto the remembered
     head here would check the new record and wave the edited one through.
     THE EDIT MUST PRESERVE THE PREFIX'S LENGTH, or this proves nothing: a
     length-changing edit moves the append boundary, the incremental split lands
     mid-record, and the read fails as corrupt for an entirely different reason.
     A first version of this test did exactly that and passed while the prefix
     check was planted out -- green over the hole it was written to guard. */
  const before = readFileSync(recorder.ledgerPath)
  const lines = before.toString('utf8').split('\n').filter(Boolean)
  const target = JSON.parse(lines[2])
  assert.equal(target.sessionId, 'bbbbbbbb-2')
  target.sessionId = 'cccccccc-2'
  lines[2] = JSON.stringify(target)
  const tampered = Buffer.from(`${lines.join('\n')}\n`, 'utf8')
  assert.equal(tampered.length, before.length, 'the rewritten prefix is the same length, or this tests nothing')
  writeFileSync(recorder.ledgerPath, tampered)

  recorder.record({ action: 'agent_session_start', sessionId: 'bbbbbbbb-10' })

  assert.equal(
    recorder.history().verified, false,
    'a record edited underneath an append must not be waved through by the incremental path',
  )
})

test('SECURITY: a truncated record is caught rather than read as a shorter chain', (t) => {
  const directory = workspace(t)
  const recorder = createSpawnRecorder({ safeStorage: keystore(), directory })
  for (let index = 0; index < 8; index += 1) {
    recorder.record({ action: 'agent_session_start', sessionId: `session-${index}` })
  }
  assert.equal(recorder.history().verified, true)

  const lines = readFileSync(recorder.ledgerPath, 'utf8').split('\n').filter(Boolean)
  writeFileSync(recorder.ledgerPath, `${lines.slice(0, 4).join('\n')}\n`)

  const history = recorder.history()
  assert.equal(history.total, 4, 'the shorter file is read as it is')
  assert.equal(history.verified, true, 'a prefix of a valid chain is itself a valid chain, and saying otherwise would be false')

  /* But the records that were removed are gone from the count, which is the
     evidence a reader actually has. Stated here so nobody later mistakes the
     line above for "deletion is undetectable and we do not care". Deletion of a
     TAIL is not detectable by a self-contained chain -- only an external anchor
     can do that, and shell/spawn-record.cjs says plainly that it is not one. */
  assert.equal(recorder.verify().count, 4)
})

test('the independent check is never answered from the cache', (t) => {
  const directory = workspace(t)
  const recorder = createSpawnRecorder({ safeStorage: keystore(), directory })
  recorder.record({ action: 'agent_session_start', sessionId: 'one' })
  assert.equal(recorder.history().verified, true, 'the verdict is cached')

  const lines = readFileSync(recorder.ledgerPath, 'utf8').split('\n').filter(Boolean)
  const target = JSON.parse(lines[0])
  target.at = new Date(Date.parse(target.at) + 60_000).toISOString()
  writeFileSync(recorder.ledgerPath, `${JSON.stringify(target)}\n`)

  assert.equal(recorder.verify().ok, false, 'verify() re-reads and re-checks every time it is called')
})

/* The assertions about the IPC channel itself live in
   tools/test/agent-history-channel.test.mjs, which lands with the two shell
   files it describes. Keeping them here would have made this suite red in any
   tree that has the recorder but not yet the channel. */
