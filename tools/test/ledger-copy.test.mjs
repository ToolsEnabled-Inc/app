// THE LEDGER PAGE TELLS ONE STORY PER STATE, AND THE STATES ARE NOT THE SAME.
//
// The owner: the R-ledger panel "is a mess (not human friendly)". What he was
// looking at was one state told three ways at once -- "could not be read" in
// the register's accessible name and in its counter, a calm "this copy does not
// keep one, so there is nothing here to show" in the paragraph between them,
// and below that two forms whose fields described themselves in terms of a list
// that was not on the screen.
//
// The cause was a half-applied repair. Commit 1bdcce7 rewrote ONE line -- the
// body paragraph -- and left the failure chrome around it alone. Nothing could
// catch that, because nothing could see the paragraph and the chrome at the
// same time: they were both composed inside a closure in a view that imports a
// stylesheet.
//
// So this suite holds the two things that had to become true:
//   1. EMPTY and UNREADABLE are different states with different words, and the
//      page can tell them apart from what src/live-status.js already returns;
//   2. every part of one state comes from ONE object, so the paragraph, the
//      accessible name, the counter and the totals cannot disagree again.
//
// The composed panel as a whole is measured by tools/check-composed-output.mjs.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/* The same extractor the plain-language gate uses: comments blanked, template
   literals split at their values. A comment in this codebase QUOTES the
   sentence it replaced, so a raw text search finds the defect inside the note
   explaining that the defect was removed. */
import { visibleTextFrom } from '../lib/user-visible-strings.mjs'

import {
  DECISION_FORM,
  DECISION_OFF,
  LEDGER_EMPTY,
  LEDGER_LOADING,
  LEDGER_UNREADABLE,
  QUESTIONS_EMPTY,
  QUESTIONS_UNREADABLE,
  QUEUE_FORM,
  REGISTER_NOTICE_STATES,
  decisionOff,
  queueSnapshotLine,
  registerNotice,
} from '../../src/ledger-copy.js'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = relative => readFileSync(path.join(REPO, relative), 'utf8')

const FAILURE_WORDS = /\b(could not|cannot|unavailable|refused|failed|went wrong)\b/i
const EMPTY_WORDS = /\b(nothing here to show|there is nothing|there are none)\b/i

test('every declared no-rows state has a notice, and every notice is declared', () => {
  for (const kind of REGISTER_NOTICE_STATES) {
    const notice = registerNotice({ kind })
    assert.ok(notice, `no notice for the declared state ${kind}`)
    assert.equal(notice.state, kind, `${kind} answers with a notice for ${notice.state}`)
  }
  assert.equal(registerNotice({ kind: 'live' }), null, 'a register with rows draws rows, not a notice')
  assert.equal(registerNotice({ kind: 'simulated' }), null,
    'so does the example register — it goes through the same render path and draws the same rows')
  assert.equal(registerNotice(null), null)
})

test('an empty register and an unreadable one do not share a single word of their verdict', () => {
  assert.ok(EMPTY_WORDS.test(LEDGER_EMPTY.body), 'the empty state must say there is nothing')
  assert.ok(!FAILURE_WORDS.test(LEDGER_EMPTY.body), `the empty state must not read as a failure: ${LEDGER_EMPTY.body}`)
  assert.ok(!FAILURE_WORDS.test(LEDGER_EMPTY.label), `the accessible name too: ${LEDGER_EMPTY.label}`)
  assert.ok(!FAILURE_WORDS.test(LEDGER_EMPTY.count), `and the counter: ${LEDGER_EMPTY.count}`)
  assert.equal(LEDGER_EMPTY.tone, 'note', 'nothing is wrong, so nothing is painted as wrong')
  assert.equal(LEDGER_EMPTY.countsKnown, true, 'the totals for an empty list are known, and they are zero')

  assert.ok(FAILURE_WORDS.test(LEDGER_UNREADABLE.body), 'the unreadable state must say so')
  assert.ok(!EMPTY_WORDS.test(LEDGER_UNREADABLE.body), 'and must not also claim there is simply nothing')
  assert.equal(LEDGER_UNREADABLE.tone, 'refused')
  assert.equal(LEDGER_UNREADABLE.countsKnown, false, 'a read that failed knows no totals')
})

test('the loading state is neither of the other two', () => {
  assert.ok(!FAILURE_WORDS.test(LEDGER_LOADING.body), `a read in flight is not a failure: ${LEDGER_LOADING.body}`)
  assert.ok(!FAILURE_WORDS.test(LEDGER_LOADING.label), LEDGER_LOADING.label)
  assert.equal(LEDGER_LOADING.tone, 'note')
  assert.equal(LEDGER_LOADING.door, false, 'a “what this copy needs” link under a spinner sends somebody to solve a problem they may not have')
})

test('every notice answers with a whole set, so nothing can be drawn from a different state', () => {
  const keys = ['state', 'tone', 'label', 'className', 'body', 'count', 'countsKnown', 'door']
  for (const notice of [LEDGER_LOADING, LEDGER_EMPTY, LEDGER_UNREADABLE, QUESTIONS_EMPTY, QUESTIONS_UNREADABLE]) {
    for (const key of keys) {
      assert.ok(Object.hasOwn(notice, key), `${notice.state} has no ${key}`)
    }
    assert.ok(Object.isFrozen(notice), `${notice.state} is not frozen`)
  }
})

test('the questions half speaks the same two states, not a third vocabulary of its own', () => {
  assert.equal(registerNotice({ kind: 'empty' }, { mode: 'q' }), QUESTIONS_EMPTY)
  assert.equal(registerNotice({ kind: 'unreadable' }, { mode: 'q' }), QUESTIONS_UNREADABLE)
  assert.ok(!FAILURE_WORDS.test(QUESTIONS_EMPTY.body), QUESTIONS_EMPTY.body)
  assert.ok(FAILURE_WORDS.test(QUESTIONS_UNREADABLE.body), QUESTIONS_UNREADABLE.body)
})

test('no notice, label or hint sends the reader to a list', () => {
  const pointsAtAList = /\b(as shown in the (list|table|register)|in the list above|from the list)\b/i
  const strings = [
    ...[LEDGER_LOADING, LEDGER_EMPTY, LEDGER_UNREADABLE, QUESTIONS_EMPTY, QUESTIONS_UNREADABLE]
      .flatMap(notice => [notice.body, notice.label, notice.count]),
    ...Object.values(DECISION_FORM),
    ...Object.values(QUEUE_FORM),
    ...Object.values(DECISION_OFF).map(entry => entry.text),
  ]
  for (const value of strings) {
    assert.ok(!pointsAtAList.test(String(value)), `still points at a list: ${value}`)
  }
})

test('the Approve/Decline form is off for a reason, and the reason names the state', () => {
  assert.equal(decisionOff({ kind: 'loading', items: [] }), DECISION_OFF.loading)
  assert.equal(decisionOff({ kind: 'empty', items: [] }), DECISION_OFF.empty)
  assert.equal(decisionOff({ kind: 'unreadable', items: [] }), DECISION_OFF.unreadable)
  assert.equal(decisionOff({ kind: 'live', items: [] }), DECISION_OFF.empty, 'a live read with no rows is empty, not broken')
  assert.equal(decisionOff({ kind: 'live', items: [{ id: 'R1' }] }), null, 'with rows it simply works')
  /* The example register never turns the control off: the picker fills from
     the example rows so a person can see what this surface does. What keeps a
     press from becoming a write is the view's own fence (src/views/ledger.js
     stops it before the surface's handler runs), not a disabled control --
     so the OFF table must stay out of the way in both example states. */
  assert.equal(decisionOff({ kind: 'simulated', items: [] }), null,
    'the example register does not turn the control off')
  assert.equal(decisionOff({ kind: 'simulated', items: [{ id: 'R1' }] }), null,
    'and stays out of the way with the example rows in the picker')

  /* THE COLOUR COMES WITH THE SENTENCE. "There is nothing to approve" is not a
     failure, and painting it as one is the register's own defect one level
     down: words that say nothing is here inside chrome that says something went
     wrong. Only the unreadable case has earned the failure colour. */
  assert.equal(DECISION_OFF.empty.tone, 'note')
  assert.equal(DECISION_OFF.loading.tone, 'note')
  assert.equal(DECISION_OFF.unreadable.tone, 'unavailable')
  for (const entry of Object.values(DECISION_OFF)) {
    assert.ok(entry.text.length >= 40, `too short to act on: ${entry.text}`)
    assert.match(entry.text, /[.!?]$/, `not a sentence: ${entry.text}`)
  }
})

test('the queue line says what is off and what to do, and carries the layer’s own words when there are any', () => {
  const ready = queueSnapshotLine({ ok: true, hash: 'a'.repeat(64) })
  assert.equal(ready.ready, true)
  assert.equal(ready.tone, 'ready')
  assert.ok(!FAILURE_WORDS.test(ready.text), ready.text)

  const refused = queueSnapshotLine({ ok: false, reason: 'That folder has no work list to read' })
  assert.equal(refused.ready, false)
  assert.match(refused.text, /Claim and Close are off/)
  assert.match(refused.text, /That folder has no work list to read\./, 'the layer’s own reason is shown, and punctuated')
  assert.match(refused.text, /Choose another folder, or press Retry above\./, 'and there is always something to do')

  /* THE SIX WORDS THAT USED TO BE HERE, EVERY TIME. Before the engine's
     typedError() kept the real message, this line ended in "The audited
     dependency refused the action." whatever had actually happened. A reason
     that is not English is dropped rather than pasted in. */
  const noReason = queueSnapshotLine({ ok: false })
  assert.match(noReason.text, /Claim and Close are off/)
  assert.match(noReason.text, /Choose another folder, or press Retry above\./)
  assert.ok(!/undefined|null/.test(noReason.text), noReason.text)
  const codeReason = queueSnapshotLine({ ok: false, reason: 'BRIDGE_GUARD_REFUSED' })
  assert.ok(!/BRIDGE_GUARD_REFUSED/.test(codeReason.text), `an identifier reached the glass: ${codeReason.text}`)

  /* A hash that is not a hash is not a read list. */
  assert.equal(queueSnapshotLine({ ok: true, hash: 'short' }).ready, false)
  assert.equal(queueSnapshotLine(undefined).ready, false)
})

test('the view and the surface read their words from here rather than keeping their own', () => {
  const view = read('src/views/ledger.js')
  const surface = read('src/write-surfaces.js')
  assert.match(view, /from '\.\.\/ledger-copy\.js'/, 'the view must import the copy module')
  assert.match(surface, /from '\.\/ledger-copy\.js'/, 'so must the write surface')
  /* The two sentences the owner was shown, gone from the source that drew them.
     Asserted against the FILES because a constant can be replaced while the
     view goes on composing its own string beside it -- which is exactly how the
     half-applied repair happened. */
  const spoken = source => visibleTextFrom(source).visible.map(entry => entry.text).join(' | ')
  const viewSays = spoken(view)
  const surfaceSays = spoken(surface)
  assert.ok(!viewSays.includes('the ledger could not be read yet'), 'the old loading line is still drawn by the view')
  assert.ok(!viewSays.includes('the questions could not be read'), 'the questions half still has its own accent')
  assert.ok(!surfaceSays.includes('its number, as shown in the list'), 'the old placeholder is still drawn by the surface')
  assert.ok(!surfaceSays.includes('Observed queue SHA-256'), 'the hash field is still asking a person to read a hash')
})

/* THE ANCHORS BELOW USED TO POINT AT THE SIMULATED RENDER, which is gone: one
   render path, fed by a fetched register or by src/sample-ledger.js, per the
   owner's ruling that the simulated pages ARE the UI pages with mock data.
   What this suite can hold without a browser is the wiring: the view draws
   its data through the source axis, its example marking follows the axis's
   one badge rule, and nothing leans on the modules being deleted. */
test('the view draws through the source axis, and its example marking follows the one badge rule', () => {
  const view = read('src/views/ledger.js')
  assert.match(view, /from '\.\.\/data-source\.js'/, 'the view must resolve where its data comes from')
  assert.match(view, /resolveDataSource\(/, 'and actually ask, in its load path')
  assert.match(view, /DATA_SOURCE_EVENT/, 'and re-resolve when the host announces the world changed')
  assert.match(view, /from '\.\.\/sample-ledger\.js'/, 'the example register feeds the same render path')
  assert.match(view, /sourceIsBadged/,
    'the badge is keyed to the axis in one place; a view deriving its own is how a screen disagrees with its neighbour')
  assert.doesNotMatch(view, /live-flags/, 'the per-view flag is being deleted; nothing here may lean on it')
  assert.doesNotMatch(view, /ledger-data/, 'so is the simulated data module')
  /* The marking a person actually sees, in home’s exact words -- the one
     phrasing the product uses for data that is not theirs. */
  assert.match(view, /Example, not your data/, 'the example register must be unmistakably labelled')
})
