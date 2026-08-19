/* THE APPROVALS SCREEN MARKS ITS DEMONSTRATION, THE WAY EVERY OTHER SCREEN DOES.
 *
 * The paid lane's walk of the vendored simulation build (their commit 36010d5,
 * reassigned to this repository by legal's launch delivery): every landing view
 * labels its own example data -- home's "Example, not your data" badge, the
 * metrics face and its "made-up numbers" note, research's source line -- and
 * the approvals view alone carried no marking of any kind. On the simulation
 * build it showed an unreachable-service state instead, which on a marketing
 * page reads as a broken product, and on any screen leaves a visitor free to
 * read whatever it shows as somebody's real decision queue.
 *
 * WHAT "DEMONSTRATION" MEANS FOR THIS VIEW, precisely. Approvals has no flag of
 * its own in src/live-flags.js, because its data is the audited queue and there
 * is nothing per-view to switch. The one state in which this screen is part of
 * a demonstration is when the WHOLE product's screens are the demonstration --
 * which is exactly what setup's "screens" answer records (every live flag off
 * together) and exactly what the simulation build's demo-mode.js writes (every
 * flag simulated). So the face is derived: every view flag simulated means
 * demonstration; any view live means this screen reads the live queue as it
 * always has. A person who flipped ONE page to the demonstration in Settings
 * kept approvals live on purpose -- their queue is still their queue.
 *
 * The view module imports the DOM-bound component layer and cannot be executed
 * under node:test (the same limit tools/test/first-run-tier-screen.test.mjs
 * records for setup), so the pure half is exercised for real and the view's
 * wiring is source-asserted; the behaviour itself is driven on the packaged
 * build by tools/approvals-example-qa.mjs, in both states, with screenshots.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import {
  APPROVALS_EXAMPLE_MARKING,
  approvalsFace,
  exampleOwnerPrompts,
} from '../../src/approvals-example.js'
import { LIVE_VIEW_FLAGS } from '../../src/live-flags.js'
import { cartSummary } from '../../src/purchase-cart-view.js'
import { sentencesOf, wordsOf } from '../lib/user-visible-strings.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const VIEW = readFileSync(path.join(REPO_ROOT, 'src', 'views', 'approvals.js'), 'utf8')

/* ---------- the face ---------- */

test('every screen on the demonstration means the approvals screen is too', () => {
  assert.equal(approvalsFace({ isLive: () => false }), 'demonstration')
})

test('any screen reading live keeps approvals on the live queue', () => {
  assert.equal(approvalsFace({ isLive: () => true }), 'this-computer')
  for (const liveOne of LIVE_VIEW_FLAGS.map(flag => flag.id)) {
    assert.equal(approvalsFace({ isLive: id => id === liveOne }), 'this-computer',
      `one live view (${liveOne}) still read as a demonstration`)
  }
})

test('the face asks about every declared view, so a new view cannot silently widen the demonstration', () => {
  const asked = []
  approvalsFace({ isLive: id => { asked.push(id); return false } })
  assert.deepEqual(asked.sort(), LIVE_VIEW_FLAGS.map(flag => flag.id).sort())
})

/* ---------- the words ---------- */

test('the marking uses the words the other screens already use, and every sentence is plain', () => {
  assert.equal(APPROVALS_EXAMPLE_MARKING.badge, 'Example, not your data',
    'the badge does not carry the exact words home uses, so the product would label one thing two ways')
  assert.match(APPROVALS_EXAMPLE_MARKING.source, /^example data — turn on Live data in settings/,
    'the source line does not follow the research page’s shape')
  assert.match(APPROVALS_EXAMPLE_MARKING.queueNote, /example/i)
  assert.match(APPROVALS_EXAMPLE_MARKING.cardStatus, /example/i)
  assert.doesNotMatch(APPROVALS_EXAMPLE_MARKING.cardStatus, /unavailable|error|failed/i,
    'an example is a chosen state, not a failure')
  for (const text of Object.values(APPROVALS_EXAMPLE_MARKING)) {
    assert.equal(typeof text, 'string')
    for (const sentence of sentencesOf(text)) {
      assert.ok(wordsOf(sentence).length <= 25, `${wordsOf(sentence).length} words: "${sentence}"`)
    }
  }
})

/* ---------- the example queue ---------- */

test('every example prompt is shaped like the wire’s own prompts, and says it is an example', () => {
  const now = Date.UTC(2026, 7, 18, 12, 0, 0)
  const prompts = exampleOwnerPrompts(now)
  assert.ok(prompts.length >= 2, 'fewer than two example requests cannot show a purchase and a confirmation')
  const ids = new Set()
  for (const prompt of prompts) {
    assert.match(prompt.id, /^example-/, 'an example id that could collide with a real request id')
    assert.ok(!ids.has(prompt.id)); ids.add(prompt.id)
    assert.ok(['purchase_batch', 'confirmation', 'notice'].includes(prompt.kind))
    assert.equal(prompt.state, 'pending')
    assert.equal(new Date(Date.parse(prompt.createdAt)).toISOString(), prompt.createdAt, 'createdAt is not canonical')
    assert.equal(new Date(Date.parse(prompt.expiresAt)).toISOString(), prompt.expiresAt, 'expiresAt is not canonical')
    assert.ok(Date.parse(prompt.expiresAt) > Date.parse(prompt.createdAt))
    assert.match(`${prompt.title} ${prompt.message}`, /example/i, 'a prompt that does not say it is an example')
    for (const sentence of [...sentencesOf(prompt.title), ...sentencesOf(prompt.message)]) {
      assert.ok(wordsOf(sentence).length <= 25, sentence)
    }
    if (prompt.kind === 'purchase_batch') {
      assert.equal(prompt.items.reduce((sum, item) => sum + item.amountCents, 0), prompt.totalCents,
        'the example total is not the sum of its own lines -- the defect the live screen refuses')
      assert.ok(prompt.items.every(item => item.currency === prompt.currency))
      assert.equal(prompt.defaultDecision, 'deny')
    }
  }
  assert.ok(prompts.some(prompt => prompt.kind === 'purchase_batch'))
  assert.ok(prompts.some(prompt => prompt.kind !== 'purchase_batch'))
})

test('the example queue is stable for a given clock, so the screen cannot invent data on every paint', () => {
  const now = Date.UTC(2026, 7, 18, 12, 0, 0)
  assert.deepEqual(exampleOwnerPrompts(now), exampleOwnerPrompts(now))
})

test('the derived layer the live screen uses digests the example queue whole', () => {
  const now = Date.UTC(2026, 7, 18, 12, 0, 0)
  const summary = cartSummary(exampleOwnerPrompts(now), now)
  assert.equal(summary.readable, true)
  assert.ok(summary.cartCount >= 1)
  assert.ok(summary.soonest !== null, 'no deadline tile could be painted from the example queue')
  assert.ok(Number.isSafeInteger(summary.totalCents) && summary.totalCents > 0)
})

/* ---------- the view’s wiring, which cannot be executed here ---------- */

test('the view derives its face from the one module and stamps it, the metrics way', () => {
  assert.match(VIEW, /from '\.\.\/approvals-example\.js'/, 'src/views/approvals.js does not import the example module')
  assert.match(VIEW, /approvalsFace\(/, 'the view never asks which face it is showing')
  assert.match(VIEW, /dataset\.face = face/, 'the view does not stamp data-face the way metrics does')
})

test('the demonstration face never touches the bridge, the stores, or the theme call', () => {
  assert.ok(VIEW.includes('function paintExample'), 'there is no paintExample')
  const mount = VIEW.slice(VIEW.lastIndexOf('themeObserver.observe'))
  assert.match(mount, /face === 'demonstration'\s*\)\s*\{?\s*paintExample\(\)/, 'the demonstration face does not paint the example')
  assert.match(mount, /else\s*\{[\s\S]*?void poll\(\)[\s\S]*?setInterval/, 'the live face no longer polls')
  const example = VIEW.slice(VIEW.indexOf('function paintExample'), VIEW.indexOf('async function poll'))
  for (const forbidden of ['ownerPromptSnapshot', 'markOwnerPromptPresented', 'decideOwnerPrompt', 'recordCartReading', 'recordUndeliveredDecision', 'applyOwnerPopupTheme']) {
    assert.ok(!example.includes(forbidden), `the example painter reaches ${forbidden}, which files or fetches real state`)
  }
})

test('the marking is painted visibly: badge, source line, and disabled example cards', () => {
  assert.match(VIEW, /data-approvals-badge/, 'no badge element exists for the marking')
  assert.match(VIEW, /data-approvals-source/, 'no source line element exists')
  assert.match(VIEW, /APPROVALS_EXAMPLE_MARKING\.badge/, 'the badge does not carry the shared words')
  assert.match(VIEW, /APPROVALS_EXAMPLE_MARKING\.source/, 'the source line does not carry the shared words')
  const example = VIEW.slice(VIEW.indexOf('function paintExample'), VIEW.indexOf('async function poll'))
  assert.match(example, /surface: 'screen'/, 'example cards are not rendered through the one card renderer')
  assert.match(example, /APPROVALS_EXAMPLE_MARKING\.cardStatus/, 'example cards do not say they are examples')
})
