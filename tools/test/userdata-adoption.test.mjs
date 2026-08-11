/* AN EMPTY userData DIRECTORY IS NOT A STATEMENT THAT THERE IS NOTHING TO KEEP.
 *
 * Electron keys userData on productName. Renaming the product to "ToolsEnabled"
 * pointed every build at %APPDATA%\ToolsEnabled while every existing customer's
 * settings, workspace and spawn records stayed in %APPDATA%\Mission Control.
 * Both directories exist on Machine A right now; the new one was created empty
 * and the old one has never been read since.
 *
 * These run against real directories under a real temp root -- no mocked fs.
 * The behaviour being asserted is what ends up on disk.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const {
  RECORD_FILE,
  PRODUCT_STATE_ENTRIES,
  adoptLegacyUserData,
} = require('../../shell/userdata-adoption.cjs')

function makeAppData() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'te-userdata-'))
  return {
    root,
    legacy: path.join(root, 'Mission Control'),
    current: path.join(root, 'ToolsEnabled'),
  }
}

function seedLegacyInstall(legacy, { theme = 'black' } = {}) {
  fs.mkdirSync(path.join(legacy, 'workspace'), { recursive: true })
  fs.writeFileSync(path.join(legacy, 'renderer-prefs.json'), JSON.stringify({
    storageVersion: 1,
    values: { 'mc.theme': theme },
    drainedOrigins: [],
  }))
  fs.writeFileSync(path.join(legacy, 'shell-state.json'), JSON.stringify({ bounds: { width: 1440 } }))
  fs.writeFileSync(path.join(legacy, 'agent-spawn-records.jsonl'), '{"id":"one"}\n')
  fs.writeFileSync(path.join(legacy, 'agent-spawn-key.enc'), 'not-a-real-key')
  fs.writeFileSync(path.join(legacy, 'workspace', 'notes.md'), '# the persons work\n')
  fs.writeFileSync(path.join(legacy, 'purchase-catalog.json'), JSON.stringify({ items: [] }))
  /* Chromium noise that a fresh launch recreates anyway. */
  fs.mkdirSync(path.join(legacy, 'Cache'), { recursive: true })
  fs.writeFileSync(path.join(legacy, 'Cache', 'data_0'), 'x'.repeat(1024))
}

function adopt(paths) {
  return adoptLegacyUserData({
    userDataPath: paths.current,
    searchRoot: paths.root,
    fs,
    path,
    legacyNames: ['Mission Control'],
  })
}

test('a renamed install adopts the previous one instead of opening on defaults', () => {
  const paths = makeAppData()
  seedLegacyInstall(paths.legacy)

  const result = adopt(paths)

  assert.equal(result.adopted, true)
  const prefs = JSON.parse(fs.readFileSync(path.join(paths.current, 'renderer-prefs.json'), 'utf8'))
  assert.equal(prefs.values['mc.theme'], 'black', 'the person chose black; a fresh install would paint white')
  assert.equal(
    fs.readFileSync(path.join(paths.current, 'workspace', 'notes.md'), 'utf8'),
    '# the persons work\n',
  )
  assert.equal(fs.existsSync(path.join(paths.current, 'agent-spawn-key.enc')), true)
  assert.equal(
    fs.existsSync(path.join(paths.current, 'agent-spawn-records.jsonl')), true,
    'records without their key would be unreadable; they travel together',
  )
})

test('no file the product keeps in userData is missing from the carry-over list', () => {
  /* THE ONLY GUARD THAT CAN CATCH THE NEXT ONE.
   *
   * Every other test here derives from PRODUCT_STATE_ENTRIES, so a file nobody
   * remembered to add is invisible to all of them -- the list agrees with
   * itself. That is how purchase-catalog.json came to be missing: it was added
   * to userData by another lane while this list already looked complete, and it
   * was found by sweeping the source by hand, not by a test.
   *
   * So this derives the truth from the SOURCE instead: every filename the shell
   * joins onto userData, and the filename constants owned by the modules that
   * are handed userData as a directory. Anything the product stores there and
   * this file does not carry is named here, at build time, instead of at a
   * customer who upgraded and lost it. */
  const shellDirectory = path.join(REPO_ROOT, 'shell')
  const sources = fs.readdirSync(shellDirectory)
    .filter((name) => name.endsWith('.cjs'))
    .map((name) => ({ name, text: fs.readFileSync(path.join(shellDirectory, name), 'utf8') }))

  const residents = new Set()
  for (const { text } of sources) {
    /* Joined directly onto userData, e.g. path.join(app.getPath('userData'), 'fleet-profile.json') */
    for (const match of text.matchAll(/getPath\(\s*['"]userData['"]\s*\)\s*,\s*['"]([^'"]+)['"]/g)) {
      residents.add(match[1])
    }
  }
  /* Modules handed userData as a `directory` own their own filename, so the
     join above never names them. They are read from their declarations rather
     than copied here, so a rename there surfaces as a failure rather than as a
     stale duplicate. */
  for (const { name, text } of sources) {
    if (name === 'userdata-adoption.cjs') continue
    for (const match of text.matchAll(/^const [A-Z_]*(?:RECORD|KEY|LEDGER)_FILE = ['"]([^'"]+)['"]/gm)) {
      residents.add(match[1])
    }
  }

  assert.ok(sources.length > 0, 'scanned no shell sources -- this guard would pass while checking nothing')
  assert.ok(residents.size > 0, 'found no userData residents at all -- the patterns have drifted from the code')

  const carried = new Set(PRODUCT_STATE_ENTRIES)
  /* Regenerated by Chromium or by the product on launch; carrying them across
     installations is what corrupts a profile. Each is named, not pattern-matched,
     so a new one has to be considered rather than silently swept up. */
  const REGENERATED = new Set(['crash-dumps'])
  const stranded = [...residents].filter((entry) => !carried.has(entry) && !REGENERATED.has(entry))

  assert.deepEqual(
    stranded.sort(),
    [],
    'the product stores these in userData and a renamed install would leave them behind',
  )
})

test('every entry the product claims to own actually gets carried across', () => {
  /* Named against the LIST rather than against a handful of files, because the
     way this defect recurs is a userData file nobody remembered to add. A name
     that is declared but never copied fails here instead of at a customer. */
  const paths = makeAppData()
  seedLegacyInstall(paths.legacy)
  for (const entry of PRODUCT_STATE_ENTRIES) {
    const seeded = path.join(paths.legacy, entry)
    if (!fs.existsSync(seeded)) fs.writeFileSync(seeded, 'seeded-by-test')
  }

  adopt(paths)

  const stranded = PRODUCT_STATE_ENTRIES.filter((entry) => !fs.existsSync(path.join(paths.current, entry)))
  assert.deepEqual(stranded, [], 'these are declared product state and were left in the old install')
})

test('Chromium cache is left behind rather than copied between installations', () => {
  const paths = makeAppData()
  seedLegacyInstall(paths.legacy)

  adopt(paths)

  assert.equal(fs.existsSync(path.join(paths.current, 'Cache')), false)
})

test('an install already in use is never written into', () => {
  const paths = makeAppData()
  seedLegacyInstall(paths.legacy, { theme: 'black' })
  fs.mkdirSync(paths.current, { recursive: true })
  fs.writeFileSync(path.join(paths.current, 'renderer-prefs.json'), JSON.stringify({
    storageVersion: 1, values: { 'mc.theme': 'white' }, drainedOrigins: [],
  }))

  const result = adopt(paths)

  assert.equal(result.adopted, false)
  assert.equal(result.reason, 'TARGET_ALREADY_IN_USE')
  const prefs = JSON.parse(fs.readFileSync(path.join(paths.current, 'renderer-prefs.json'), 'utf8'))
  assert.equal(prefs.values['mc.theme'], 'white', 'the current install had real state and it was overwritten')
})

test('adoption happens once — data deleted after it does not come back', () => {
  const paths = makeAppData()
  seedLegacyInstall(paths.legacy)

  assert.equal(adopt(paths).adopted, true)
  fs.rmSync(path.join(paths.current, 'renderer-prefs.json'))

  const second = adopt(paths)

  assert.equal(second.adopted, false)
  assert.equal(second.reason, 'ALREADY_DECIDED')
  assert.equal(
    fs.existsSync(path.join(paths.current, 'renderer-prefs.json')), false,
    'a deliberate deletion was undone by a second adoption',
  )
})

test('a damaged adoption record still counts as a decision', () => {
  /* THE POINT OF THE WHOLE FILE. The house defect is an absence read as
     consent: unreadable treated as "never happened", missing treated as
     "allowed". A corrupt record here would mean re-running the copy and
     resurrecting whatever the person removed. */
  const paths = makeAppData()
  seedLegacyInstall(paths.legacy)
  fs.mkdirSync(paths.current, { recursive: true })
  fs.writeFileSync(path.join(paths.current, RECORD_FILE), '{ this is not json')

  const result = adopt(paths)

  assert.equal(result.adopted, false)
  assert.equal(result.reason, 'ALREADY_DECIDED')
  assert.equal(fs.existsSync(path.join(paths.current, 'renderer-prefs.json')), false)
})

test('with no previous installation it records the decision and adopts nothing', () => {
  const paths = makeAppData()

  const result = adopt(paths)

  assert.equal(result.adopted, false)
  assert.equal(result.reason, 'NO_PRIOR_INSTALL')
  const record = JSON.parse(fs.readFileSync(path.join(paths.current, RECORD_FILE), 'utf8'))
  assert.equal(record.status, 'complete')
  assert.equal(record.adopted, false)
})

test('an empty previous install is not mistaken for one worth adopting', () => {
  const paths = makeAppData()
  /* What a first launch creates and nothing more: Chromium files and an empty
     workspace. There is no person's data here. */
  fs.mkdirSync(path.join(paths.legacy, 'workspace'), { recursive: true })
  fs.mkdirSync(path.join(paths.legacy, 'Cache'), { recursive: true })

  const result = adopt(paths)

  assert.equal(result.reason, 'NO_PRIOR_INSTALL')
})

test('a directory is never adopted into itself', () => {
  const paths = makeAppData()
  seedLegacyInstall(paths.legacy)

  const result = adoptLegacyUserData({
    userDataPath: paths.legacy,
    searchRoot: paths.root,
    fs,
    path,
    legacyNames: ['Mission Control'],
  })

  assert.equal(result.adopted, false)
  assert.equal(result.reason, 'TARGET_ALREADY_IN_USE')
})

test('a crash mid-copy resumes from the same install rather than stalling', () => {
  const paths = makeAppData()
  seedLegacyInstall(paths.legacy)
  fs.mkdirSync(paths.current, { recursive: true })
  /* Exactly what the module leaves behind when it dies between writing the
     record and finishing the copy. */
  fs.writeFileSync(path.join(paths.current, RECORD_FILE), JSON.stringify({
    version: 1, status: 'in-progress', from: paths.legacy, at: '2026-08-11T00:00:00.000Z',
  }))
  fs.writeFileSync(path.join(paths.current, 'shell-state.json'), '{"bounds":{"width":1440}}')

  const result = adopt(paths)

  assert.equal(result.adopted, true)
  assert.equal(
    fs.existsSync(path.join(paths.current, 'renderer-prefs.json')), true,
    'the half-copied install was abandoned instead of finished',
  )
  const record = JSON.parse(fs.readFileSync(path.join(paths.current, RECORD_FILE), 'utf8'))
  assert.equal(record.status, 'complete')
})

test('an existing file is never replaced by the one being adopted', () => {
  const paths = makeAppData()
  seedLegacyInstall(paths.legacy, { theme: 'black' })
  fs.mkdirSync(paths.current, { recursive: true })
  fs.writeFileSync(path.join(paths.current, RECORD_FILE), JSON.stringify({
    version: 1, status: 'in-progress', from: paths.legacy, at: '2026-08-11T00:00:00.000Z',
  }))
  fs.writeFileSync(path.join(paths.current, 'renderer-prefs.json'), JSON.stringify({
    storageVersion: 1, values: { 'mc.theme': 'tan' }, drainedOrigins: [],
  }))

  adopt(paths)

  const prefs = JSON.parse(fs.readFileSync(path.join(paths.current, 'renderer-prefs.json'), 'utf8'))
  assert.equal(prefs.values['mc.theme'], 'tan')
})
