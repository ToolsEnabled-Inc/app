// THE × ON EVERY LEDGER ROW, AND THE TWO MODULES BEHIND IT (plan P-O6).
//
// What the owner asked for was a way to take a row off the Ledger page. What
// the three lists can honestly do was measured first (plan O6): an owner
// request lives in an append-only, hash-chained overlay that is never
// shortened and an archived request stays on every projected list until three
// sessions have seen it; an owner question is parsed out of a planning file
// the app has no writer for. So the × hides the row on this screen, in this
// copy's own storage, and every sentence beside it says so.
//
// Three things are held here:
//   1. the row markup -- exactly one × per row, never a button inside a button
//      (the Q row is itself a <button>), the R row no longer pretends to expand;
//   2. createHiddenRows -- round-trips, survives damage, caps, and never shares
//      an id between the live list and the example list;
//   3. armOnce -- false on the first press, true on the second, and a lone press
//      disarms itself.
//
// src/views/ledger.js imports a stylesheet, so a plain `node` run cannot load
// it. The row builders are pure functions of their item and of HIDE_ROW, so
// this suite lifts that stretch of the source (everything between STATE and
// ledgerView) into a module of its own and runs the real builders.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

import { createHiddenRows, HIDDEN_ROWS_CAP } from '../../src/hidden-rows.js'
import { armOnce } from '../../src/arm-press.js'
import { HIDE_ROW } from '../../src/ledger-copy.js'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = relative => readFileSync(path.join(REPO, relative), 'utf8')

async function rowBuilders() {
  const source = read('src/views/ledger.js')
  const start = source.indexOf('const STATE = {')
  const end = source.indexOf('export function ledgerView()')
  assert.ok(start > 0 && end > start, 'the builders no longer sit between STATE and ledgerView; move this extractor')
  const copy = pathToFileURL(path.join(REPO, 'src', 'ledger-copy.js')).href
  const module = `import { HIDE_ROW } from ${JSON.stringify(copy)}\n${source.slice(start, end)}\nexport { requestMarkup, questionMarkup }\n`
  return import(`data:text/javascript;base64,${Buffer.from(module, 'utf8').toString('base64')}`)
}

const REQUEST = Object.freeze({ id: 'R12', status: 'done', gateCount: 2, unmetGateCount: 0 })
const QUESTION = Object.freeze({ id: 'Q7', title: 'Which relay region?', status: 'open', statusClass: 'open', packageId: 'P3' })

/* A tag-stack walk over the markup: the one thing a regex cannot do is tell
   whether a <button> opened inside another that has not closed yet. */
function nestedButtons(markup) {
  const stack = []
  let nested = 0
  for (const match of markup.matchAll(/<(\/?)([a-z][a-z0-9-]*)[^>]*?(\/?)>/gi)) {
    const [, closing, name, selfClosing] = match
    const tag = name.toLowerCase()
    if (closing) {
      const index = stack.lastIndexOf(tag)
      if (index >= 0) stack.splice(index)
      continue
    }
    if (selfClosing || ['br', 'hr', 'img', 'input', 'meta', 'link'].includes(tag)) continue
    if (tag === 'button' && stack.includes('button')) nested += 1
    stack.push(tag)
  }
  return nested
}

test('every row carries exactly one × and no button is nested inside another', async () => {
  const { requestMarkup, questionMarkup } = await rowBuilders()
  const rows = {
    'R row': requestMarkup(REQUEST),
    'R row, hidden and shown': requestMarkup(REQUEST, { hidden: true }),
    'Q row': questionMarkup(QUESTION),
    'Q row, expanded': questionMarkup(QUESTION, { expanded: true }),
    'Q row, hidden and shown': questionMarkup(QUESTION, { hidden: true }),
  }
  for (const [name, markup] of Object.entries(rows)) {
    assert.equal((markup.match(/class="ledger-hide"/g) || []).length, 1, `${name} does not carry exactly one ×`)
    assert.equal(nestedButtons(markup), 0, `${name} nests a button inside a button`)
    assert.match(markup, /data-row-hint/, `${name} has nowhere to put the first press's sentence`)
  }
  /* The control's two states. */
  assert.match(rows['R row'], /data-hide="r:R12"/)
  assert.match(rows['R row'], new RegExp(`aria-label="${HIDE_ROW.aria('R12')}"`))
  assert.doesNotMatch(rows['R row'], /data-hidden/)
  assert.match(rows['R row, hidden and shown'], /data-unhide="r:R12"/)
  assert.match(rows['R row, hidden and shown'], /data-hidden/)
  assert.match(rows['R row, hidden and shown'], new RegExp(`aria-label="${HIDE_ROW.putBack('R12')}"`))
  assert.match(rows['Q row'], /data-hide="q:Q7"/)
})

test('the R row no longer pretends to expand; the Q row still does', async () => {
  const { requestMarkup, questionMarkup } = await rowBuilders()
  const r = requestMarkup(REQUEST)
  /* The R detail repeated the row word for word (status / gates / unmet) --
     zero information behind a control that looked like it held some. */
  assert.doesNotMatch(r, /data-expand/, 'the R row still offers an expansion')
  assert.doesNotMatch(r, /ledger-detail/, 'the R row still carries the empty detail')
  assert.doesNotMatch(r, /<button class="ledger-row"/, 'the R row is still a button')
  assert.match(r, /<div class="ledger-row">/)
  const q = questionMarkup(QUESTION, { expanded: true })
  assert.match(q, /<button class="ledger-row" type="button" data-expand="q:Q7" aria-expanded="true"/)
  assert.match(q, /class="ledger-detail"/)
  assert.match(q, /status-class/)
})

/* ---------------------------------------------------------- hidden rows -- */

function fakeStorage() {
  const map = new Map()
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)) },
    removeItem: key => { map.delete(key) },
    raw: map,
  }
}

test('createHiddenRows round-trips through storage, and a fresh instance on the same key sees the same set', () => {
  globalThis.localStorage = fakeStorage()
  try {
    const hidden = createHiddenRows('mc.ledger.hidden:live')
    assert.equal(hidden.count(), 0)
    assert.equal(hidden.add('r:R12'), true)
    assert.equal(hidden.add('q:Q7'), true)
    assert.equal(hidden.add('r:R12'), true, 'adding twice is still one row')
    assert.equal(hidden.has('r:R12'), true)
    assert.deepEqual(hidden.list(), ['r:R12', 'q:Q7'])
    assert.deepEqual(JSON.parse(globalThis.localStorage.getItem('mc.ledger.hidden:live')), { v: 1, ids: ['r:R12', 'q:Q7'] })
    /* The desktop re-mounts the page on every route change: a new instance
       over the same key must agree without any shared object. */
    assert.deepEqual(createHiddenRows('mc.ledger.hidden:live').list(), ['r:R12', 'q:Q7'])
    assert.equal(hidden.remove('r:R12'), true)
    assert.equal(hidden.remove('r:R12'), false)
    assert.deepEqual(hidden.list(), ['q:Q7'])
    hidden.clear()
    assert.equal(hidden.count(), 0)
    assert.equal(globalThis.localStorage.getItem('mc.ledger.hidden:live'), null, 'an empty set stores as absence')
  } finally {
    delete globalThis.localStorage
  }
})

test('damage reads as an empty set, never as an error, and the cap holds', () => {
  globalThis.localStorage = fakeStorage()
  try {
    for (const damaged of ['not json', '{"v":2,"ids":["r:R1"]}', '{"v":1,"ids":"r:R1"}', '[]', '{"v":1,"ids":[1,null,{}]}']) {
      globalThis.localStorage.setItem('k', damaged)
      const hidden = createHiddenRows('k')
      assert.deepEqual(hidden.list(), [], `damaged value was read as rows: ${damaged}`)
      assert.equal(hidden.has('r:R1'), false)
    }
    const hidden = createHiddenRows('k')
    hidden.clear()
    for (let index = 0; index < HIDDEN_ROWS_CAP; index += 1) assert.equal(hidden.add(`r:R${index}`), true)
    assert.equal(hidden.add('r:one-too-many'), false, 'the cap must refuse rather than grow without bound')
    assert.equal(hidden.count(), HIDDEN_ROWS_CAP)
    /* Storage that throws (quota, a sandbox with none) must not take the
       register down with it. */
    globalThis.localStorage = { getItem() { throw new Error('no') }, setItem() { throw new Error('no') }, removeItem() { throw new Error('no') } }
    const silent = createHiddenRows('k')
    assert.deepEqual(silent.list(), [])
    assert.doesNotThrow(() => silent.add('r:R1'))
    assert.doesNotThrow(() => silent.remove('r:R1'))
  } finally {
    delete globalThis.localStorage
  }
})

test('the live list and the example list never share an id', () => {
  globalThis.localStorage = fakeStorage()
  try {
    const live = createHiddenRows('mc.ledger.hidden:live')
    const example = createHiddenRows('mc.ledger.hidden:example')
    example.add('r:R1')
    assert.equal(live.has('r:R1'), false, 'an example R1 hid a real R1')
    live.add('r:R2')
    assert.equal(example.has('r:R2'), false)
    assert.deepEqual(live.list(), ['r:R2'])
    assert.deepEqual(example.list(), ['r:R1'])
  } finally {
    delete globalThis.localStorage
  }
  assert.throws(() => createHiddenRows(''), TypeError)
})

test('the view keys the set by the badge and the research queue by its own key', () => {
  const view = read('src/views/ledger.js')
  assert.match(view, /'mc\.ledger\.hidden:live'/)
  assert.match(view, /'mc\.ledger\.hidden:example'/)
  assert.match(view, /createHiddenRows\(badged \? HIDDEN_KEY_EXAMPLE : HIDDEN_KEY_LIVE\)/, 'the set must be re-bound where the badge is set')
  assert.match(view, /armOnce\(/, 'the × must go through the shared two-press helper')
  assert.match(view, /HIDE_ROW\.armed\(/, 'the first press must say what the second does')
  assert.doesNotMatch(view, /postBridgeAction|postAction/, 'hiding a row must never post anything')
})

/* ------------------------------------------------------------ arm press -- */

function fakeButton() {
  const attrs = new Map()
  return {
    dataset: {},
    isConnected: true,
    setAttribute: (name, value) => attrs.set(name, value),
    getAttribute: name => attrs.get(name) ?? null,
  }
}

test('armOnce is false on the first press, true on the second, and a lone press disarms', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const button = fakeButton()
  assert.equal(armOnce(button, { ms: 4000 }), false, 'the first press must arm, not act')
  assert.equal(button.dataset.armed, 'true')
  assert.equal(button.getAttribute('aria-pressed'), 'true')
  assert.equal(armOnce(button, { ms: 4000 }), true, 'the second press acts')
  assert.equal(button.dataset.armed, undefined, 'and leaves the control disarmed')
  assert.equal(button.getAttribute('aria-pressed'), 'false')

  const lone = fakeButton()
  let disarmed = 0
  assert.equal(armOnce(lone, { ms: 4000, onDisarm: () => { disarmed += 1 } }), false)
  t.mock.timers.tick(3999)
  assert.equal(lone.dataset.armed, 'true', 'still armed inside the window')
  t.mock.timers.tick(1)
  assert.equal(lone.dataset.armed, undefined, 'a lone press must disarm itself so the label never lies')
  assert.equal(disarmed, 1)
  /* After the disarm the next press is a first press again. */
  assert.equal(armOnce(lone, { ms: 4000 }), false)

  /* A control that left the page is not touched. */
  const gone = fakeButton()
  armOnce(gone, { ms: 10 })
  gone.isConnected = false
  t.mock.timers.tick(10)
  assert.equal(gone.dataset.armed, 'true')
  assert.equal(armOnce(null), false)
})
