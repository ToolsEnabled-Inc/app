/* GLOW INTENSITY AND REDUCE MOTION, WRITTEN DOWN.
 *
 * THE DEFECT, DRIVEN ON THE SHIPPED INSTALLER (1.0.20) BEFORE THIS EXISTED.
 * A person set both of them and closed the program:
 *
 *   settings page   Glow intensity dragged to 51 %, Reduce motion switched on.
 *                   Reopened: glow 100, reduce motion off.
 *   gear drawer     the same two controls, which are on EVERY page.
 *                   Pressed, applied, `--glow: 0.36` and body.reduce-motion on
 *                   the page. Reopened: `--glow` unset, the class gone, and
 *                   nothing in localStorage under either name.
 *
 * Ninety-eight other rows on that page survived the same restart. These two did
 * not, because they were the only two whose applied state lived ONLY in the DOM:
 * src/views/settings.js read glow back off the `--glow` custom property and
 * reduce motion off `document.body.classList`, and neither branch of
 * applyValue() ever called writeStored(). The controls were real, they applied
 * instantly, and the choice was thrown away when the window closed -- the exact
 * shape the owner has filed twice ("some of my settings buttons dont work").
 *
 * WHY THE RULES BELOW ARE THE RULES.
 *
 *   the default is not written down. Every other row on that page removes its
 *   key when the value returns to the shipped default, so an untouched install
 *   carries no appearance keys at all and a future change of default is not
 *   pinned by a stale write. These two follow it.
 *
 *   nothing is applied that was not stored. `--glow` unset and `--glow: 1` are
 *   not the same thing to a stylesheet that has its own fallback, so a launch
 *   that found nothing stored must leave the document exactly as it was.
 *
 *   storage that throws is not a crash. localStorage throws in a private
 *   window and when the quota is full; an appearance preference is never worth
 *   taking the program down for.
 *
 * Run: node --test tools/test/appearance-persistence.test.mjs
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  DEFAULT_GLOW,
  DEFAULT_REDUCE_MOTION,
  GLOW_KEY,
  GLOW_SETTING_ID,
  REDUCE_MOTION_KEY,
  REDUCE_MOTION_SETTING_ID,
  applyAppearance,
  rememberAppearance,
  storedAppearance,
} from '../../src/appearance-persistence.js'

/** A localStorage small enough to read, with a switch to make it throw. */
function fakeStorage(seed = {}, { throws = false } = {}) {
  const map = new Map(Object.entries(seed))
  return {
    map,
    getItem(key) { if (throws) throw new Error('storage is not available'); return map.has(key) ? map.get(key) : null },
    setItem(key, value) { if (throws) throw new Error('storage is not available'); map.set(key, String(value)) },
    removeItem(key) { if (throws) throw new Error('storage is not available'); map.delete(key) },
  }
}

/** Only the three things applyAppearance() is allowed to touch. */
function fakeDocument() {
  const classes = new Set()
  const properties = new Map()
  return {
    documentElement: { style: { setProperty(name, value) { properties.set(name, String(value)) } } },
    body: {
      classList: {
        toggle(name, on) { if (on) classes.add(name); else classes.delete(name) },
        contains(name) { return classes.has(name) },
      },
    },
    classes,
    properties,
  }
}

/* ---------------------------------------------------------------- writing -- */

test('a glow that is not the default is written down', () => {
  const storage = fakeStorage()
  assert.equal(rememberAppearance(GLOW_SETTING_ID, 51, storage), 51)
  assert.equal(storage.map.get(GLOW_KEY), '51')
})

test('reduce motion switched on is written down', () => {
  const storage = fakeStorage()
  assert.equal(rememberAppearance(REDUCE_MOTION_SETTING_ID, true, storage), true)
  assert.equal(storage.map.get(REDUCE_MOTION_KEY), 'true')
})

test('a value returned to the shipped default removes its key', () => {
  const storage = fakeStorage({ [GLOW_KEY]: '51', [REDUCE_MOTION_KEY]: 'true' })
  rememberAppearance(GLOW_SETTING_ID, DEFAULT_GLOW, storage)
  rememberAppearance(REDUCE_MOTION_SETTING_ID, DEFAULT_REDUCE_MOTION, storage)
  assert.equal(storage.map.has(GLOW_KEY), false)
  assert.equal(storage.map.has(REDUCE_MOTION_KEY), false)
})

test('a glow outside the slider is brought back inside it', () => {
  const storage = fakeStorage()
  assert.equal(rememberAppearance(GLOW_SETTING_ID, 4000, storage), 200)
  assert.equal(rememberAppearance(GLOW_SETTING_ID, -8, storage), 0)
  assert.equal(storage.map.get(GLOW_KEY), '0')
})

test('a glow that is not a number is refused rather than stored', () => {
  const storage = fakeStorage({ [GLOW_KEY]: '51' })
  assert.equal(rememberAppearance(GLOW_SETTING_ID, 'bright', storage), null)
  assert.equal(storage.map.get(GLOW_KEY), '51')
})

test('a setting this module does not own is left alone', () => {
  const storage = fakeStorage()
  assert.equal(rememberAppearance('theme', 'tan', storage), null)
  assert.equal(storage.map.size, 0)
})

test('storage that throws does not throw out', () => {
  const storage = fakeStorage({}, { throws: true })
  assert.equal(rememberAppearance(GLOW_SETTING_ID, 51, storage), 51)
  assert.deepEqual(storedAppearance(storage), { glow: null, reduceMotion: null })
})

/* ---------------------------------------------------------------- reading -- */

test('nothing stored reads as nothing chosen', () => {
  assert.deepEqual(storedAppearance(fakeStorage()), { glow: null, reduceMotion: null })
})

test('what was stored is what comes back', () => {
  const storage = fakeStorage({ [GLOW_KEY]: '51', [REDUCE_MOTION_KEY]: 'true' })
  assert.deepEqual(storedAppearance(storage), { glow: 51, reduceMotion: true })
})

test('a stored value that is not readable reads as nothing chosen', () => {
  const storage = fakeStorage({ [GLOW_KEY]: 'bright', [REDUCE_MOTION_KEY]: 'perhaps' })
  assert.deepEqual(storedAppearance(storage), { glow: null, reduceMotion: null })
})

/* ---------------------------------------------------------------- applying - */

test('a launch with nothing stored leaves the document alone', () => {
  const documentRef = fakeDocument()
  const applied = applyAppearance({ documentRef, storage: fakeStorage() })
  assert.deepEqual(applied, { glow: null, reduceMotion: null })
  assert.equal(documentRef.properties.size, 0)
  assert.equal(documentRef.classes.size, 0)
})

test('a launch with both stored applies both', () => {
  const documentRef = fakeDocument()
  const storage = fakeStorage({ [GLOW_KEY]: '51', [REDUCE_MOTION_KEY]: 'true' })
  const applied = applyAppearance({ documentRef, storage })
  assert.deepEqual(applied, { glow: 51, reduceMotion: true })
  assert.equal(documentRef.properties.get('--glow'), '0.51')
  assert.equal(documentRef.body.classList.contains('reduce-motion'), true)
})

test('reduce motion stored as off is applied as off', () => {
  const documentRef = fakeDocument()
  documentRef.body.classList.toggle('reduce-motion', true)
  const applied = applyAppearance({ documentRef, storage: fakeStorage({ [REDUCE_MOTION_KEY]: 'false' }) })
  assert.equal(applied.reduceMotion, false)
  assert.equal(documentRef.body.classList.contains('reduce-motion'), false)
})

test('a document that is not there is not a crash', () => {
  assert.deepEqual(applyAppearance({ documentRef: null, storage: fakeStorage({ [GLOW_KEY]: '51' }) }), { glow: null, reduceMotion: null })
})
