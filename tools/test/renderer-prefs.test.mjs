/* The durable settings store, which exists because browser storage is keyed to
   an origin and this application's origin is a scanned port. These are unit
   tests over the record; they are NECESSARY AND NOT SUFFICIENT, and the file
   that decides whether the defect is actually fixed is
   tools/prefs-origin-proof.mjs, which launches the packaged application twice
   with the first port held. A store can be perfect here and still be bypassed
   by how the app is launched, which is exactly where this defect lived. */
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  MAX_KEYS,
  MAX_KEY_LENGTH,
  MAX_VALUE_LENGTH,
  RECORD_FILE,
  STORAGE_VERSION,
  createRendererPrefs,
} = require('../../shell/renderer-prefs.cjs')

function freshStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'te-prefs-unit-'))
  const prefs = createRendererPrefs({ directory, fs, path, randomUUID })
  return { directory, prefs, file: path.join(directory, RECORD_FILE) }
}

function readRecord(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

test('a saved setting is readable by a store that never saw the write', () => {
  const { directory, prefs, file } = freshStore()

  assert.equal(prefs.set('mc.theme', 'black').ok, true)

  // A SECOND store over the same directory is the point: it stands in for the
  // next launch of the application, which shares nothing but the file.
  const relaunched = createRendererPrefs({ directory, fs, path, randomUUID })
  assert.equal(relaunched.snapshot().values['mc.theme'], 'black')
  assert.equal(readRecord(file).storageVersion, STORAGE_VERSION)
})

test('a setting is on disk when set() returns, not at some later flush', () => {
  const { prefs, file } = freshStore()

  prefs.set('mc.text', '1.12')

  // No close, no flush, no exit hook: read the bytes immediately.
  assert.equal(readRecord(file).values['mc.text'], '1.12')
})

test('removing a setting removes it from the record', () => {
  const { directory, prefs } = freshStore()
  prefs.set('mc.live.fleet', 'live')

  assert.equal(prefs.remove('mc.live.fleet').ok, true)

  const relaunched = createRendererPrefs({ directory, fs, path, randomUUID })
  assert.equal('mc.live.fleet' in relaunched.snapshot().values, false)
})

test('clear empties the values but keeps the drain history', () => {
  const { prefs } = freshStore()
  prefs.drain('http://127.0.0.1:4601', [['mc.theme', 'tan']])

  assert.equal(prefs.clear().ok, true)

  const snapshot = prefs.snapshot()
  assert.deepEqual(snapshot.values, {})
  // Forgetting the drain history here would let the stale browser copy be
  // adopted all over again on the next launch, undoing the person's reset.
  assert.deepEqual(snapshot.drainedOrigins, ['http://127.0.0.1:4601'])
})

test('a value that is not a string is refused rather than coerced', () => {
  const { prefs } = freshStore()

  const result = prefs.set('mc.theme', 42)

  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'MC_PREFS_INVALID_ENTRY')
})

test('an oversized value is refused and does not corrupt the record', () => {
  const { prefs } = freshStore()
  prefs.set('mc.theme', 'black')

  const result = prefs.set('mc.big', 'x'.repeat(MAX_VALUE_LENGTH + 1))

  assert.equal(result.ok, false)
  assert.equal(prefs.snapshot().values['mc.theme'], 'black')
})

test('an oversized key is refused', () => {
  const { prefs } = freshStore()

  const result = prefs.set('k'.repeat(MAX_KEY_LENGTH + 1), 'v')

  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'MC_PREFS_INVALID_ENTRY')
})

test('the key count is bounded, and an existing key can still be updated at the limit', () => {
  const { prefs } = freshStore()
  for (let index = 0; index < MAX_KEYS; index += 1) prefs.set(`mc.k${index}`, 'v')

  const added = prefs.set('mc.one.too.many', 'v')
  const updated = prefs.set('mc.k0', 'changed')

  assert.equal(added.ok, false)
  assert.equal(added.error.code, 'MC_PREFS_TOO_MANY_KEYS')
  assert.equal(updated.ok, true)
  assert.equal(prefs.snapshot().values['mc.k0'], 'changed')
})

/* ---------- migration ---------- */

test('a legacy browser copy is adopted on an origin that has never been drained', () => {
  const { prefs } = freshStore()

  const result = prefs.drain('http://127.0.0.1:4601', [
    ['mc.theme', 'black'],
    ['mc.text', '1.12'],
  ])

  assert.equal(result.ok, true)
  assert.equal(result.migrated, 2)
  assert.equal(prefs.snapshot().values['mc.theme'], 'black')
})

test('the durable value wins over the legacy copy, because it is the newer decision', () => {
  const { prefs } = freshStore()
  prefs.set('mc.theme', 'tan')

  prefs.drain('http://127.0.0.1:4601', [['mc.theme', 'black']])

  assert.equal(prefs.snapshot().values['mc.theme'], 'tan')
})

test('a key deleted after migrating does not come back from the stale browser copy', () => {
  const { prefs } = freshStore()
  const legacy = [['mc.theme', 'black']]
  prefs.drain('http://127.0.0.1:4601', legacy)
  prefs.remove('mc.theme')

  // The browser copy still holds mc.theme -- it is deliberately never deleted.
  // The next launch on the SAME origin offers it again.
  const second = prefs.drain('http://127.0.0.1:4601', legacy)

  assert.equal(second.alreadyDrained, true)
  assert.equal('mc.theme' in prefs.snapshot().values, false)
})

test('each origin is drained on its own, so an old port is still rescued later', () => {
  const { prefs } = freshStore()
  // The fix first runs on a moved port, whose partition is empty.
  prefs.drain('http://127.0.0.1:4602', [])
  assert.deepEqual(prefs.snapshot().values, {})

  // A later launch lands back on the original port, which still has everything.
  const rescue = prefs.drain('http://127.0.0.1:4601', [['mc.theme', 'black']])

  assert.equal(rescue.migrated, 1)
  assert.equal(prefs.snapshot().values['mc.theme'], 'black')
})

test('a drain without an origin is refused, so nothing is marked on a guess', () => {
  const { prefs } = freshStore()

  const result = prefs.drain('', [['mc.theme', 'black']])

  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'MC_PREFS_INVALID_ORIGIN')
  assert.deepEqual(prefs.snapshot().drainedOrigins, [])
})

test('malformed legacy entries are skipped without losing the sound ones', () => {
  const { prefs } = freshStore()

  const result = prefs.drain('http://127.0.0.1:4601', [
    ['mc.theme', 'black'],
    ['mc.bad', 7],
    'not-a-pair',
    ['mc.text', '1.12'],
  ])

  assert.equal(result.migrated, 2)
  assert.equal(result.skipped, 2)
  assert.equal(prefs.snapshot().values['mc.text'], '1.12')
})

/* ---------- damaged records ---------- */

test('a malformed settings file reports damage and does not mark anything drained', () => {
  const { directory, file } = freshStore()
  fs.writeFileSync(file, '{ this is not json')

  const prefs = createRendererPrefs({ directory, fs, path, randomUUID })
  const snapshot = prefs.snapshot()

  assert.deepEqual(snapshot.values, {})
  assert.match(snapshot.damaged, /malformed JSON/)
  // Because nothing is marked drained, the browser copy can still be adopted
  // on this very launch -- the person gets their settings back instead of a
  // silent reset, which is the whole failure this store exists to end.
  assert.deepEqual(snapshot.drainedOrigins, [])
})

test('a settings file from an unknown future version is not silently accepted', () => {
  const { directory, file } = freshStore()
  fs.writeFileSync(file, JSON.stringify({ storageVersion: STORAGE_VERSION + 1, values: { 'mc.theme': 'black' } }))

  const snapshot = createRendererPrefs({ directory, fs, path, randomUUID }).snapshot()

  assert.deepEqual(snapshot.values, {})
  assert.match(snapshot.damaged, /storage version/)
})

test('non-string values in a hand-edited file are dropped, not surfaced', () => {
  const { directory, file } = freshStore()
  fs.writeFileSync(file, JSON.stringify({
    storageVersion: STORAGE_VERSION,
    values: { 'mc.theme': 'black', 'mc.rogue': { nested: true } },
    drainedOrigins: [],
  }))

  const snapshot = createRendererPrefs({ directory, fs, path, randomUUID }).snapshot()

  assert.equal(snapshot.values['mc.theme'], 'black')
  assert.equal('mc.rogue' in snapshot.values, false)
})

/* WINDOWS REFUSES THIS REPLACE AT RANDOM. Filling the store to its key limit
   through the real filesystem failed twice out of 512 with EPERM, because
   something else on the machine held a momentary handle on a file created a
   millisecond earlier. Without a retry the setting is silently not saved --
   every caller in src/ wraps storage in try/catch and ignores it -- which is a
   quieter version of the defect this store exists to end. */
test('a transient EPERM on the replace is retried instead of losing the setting', () => {
  const { directory } = freshStore()
  let attempts = 0
  const flaky = {
    ...fs,
    renameSync(from, to) {
      attempts += 1
      if (attempts <= 2) throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
      return fs.renameSync(from, to)
    },
  }
  const prefs = createRendererPrefs({ directory, fs: flaky, path, randomUUID })

  const result = prefs.set('mc.theme', 'black')

  assert.equal(result.ok, true)
  assert.equal(attempts, 3)
  assert.equal(createRendererPrefs({ directory, fs, path, randomUUID }).snapshot().values['mc.theme'], 'black')
})

test('a replace that never succeeds is reported, not retried into looking fine', () => {
  const { directory } = freshStore()
  let attempts = 0
  const broken = {
    ...fs,
    renameSync() { attempts += 1; throw Object.assign(new Error('EPERM'), { code: 'EPERM' }) },
  }
  const prefs = createRendererPrefs({ directory, fs: broken, path, randomUUID })

  const result = prefs.set('mc.theme', 'black')

  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'MC_PREFS_WRITE_FAILED')
  assert.ok(attempts > 1 && attempts <= 8, `expected a bounded number of attempts, saw ${attempts}`)
})

test('a failure that retrying cannot help is not retried', () => {
  const { directory } = freshStore()
  let attempts = 0
  const full = {
    ...fs,
    openSync() { attempts += 1; throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }) },
  }
  const prefs = createRendererPrefs({ directory, fs: full, path, randomUUID })

  const result = prefs.set('mc.theme', 'black')

  assert.equal(result.ok, false)
  assert.equal(attempts, 1, 'a full disk is not a transient lock; retrying it just delays the honest answer')
})

test('a write failure is reported rather than swallowed', () => {
  const { directory } = freshStore()
  const exploding = {
    ...fs,
    openSync() { throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' }) },
  }
  const prefs = createRendererPrefs({ directory, fs: exploding, path, randomUUID })

  const result = prefs.set('mc.theme', 'black')

  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'MC_PREFS_WRITE_FAILED')
  assert.match(result.error.message, /ENOSPC/)
})

test('no temporary file is left behind after a successful write', () => {
  const { directory, prefs } = freshStore()

  prefs.set('mc.theme', 'black')

  const leftovers = fs.readdirSync(directory).filter((name) => name.startsWith('.renderer-prefs-'))
  assert.deepEqual(leftovers, [])
})
