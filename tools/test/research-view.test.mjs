import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { assertValidProjection } from '../gen-projection-lib.mjs'

const ROOT = resolve(import.meta.dirname, '..', '..')
const read = path => readFileSync(resolve(ROOT, path), 'utf8')

// The SHIPPED research envelope. Two clauses in this file used to assert its
// contents -- 7 safe rows, 7 gated rows, 7 method notes, an observed-empty
// findings register. T4c ("ship honest empty data instead of the owner's
// snapshot") replaced every shipped projection with an unavailable envelope,
// because the populated ones carried the titles and absolute paths of ~14 of
// the owner's private reports into the installer. Those assertions then read a
// file that policy requires to be empty.
//
// The counts are properties of the GENERATOR, not of a shipping decision, and
// they now live in research-generator.test.mjs against a fixture that cannot be
// emptied out from under them -- with two clauses that were missing there
// (methodNotes length, and the exact source-out-of-scope reasons) carried over.
//
// What stays here is what this file is actually about: the view's contract, and
// the shipped file's structural honesty in whichever state it ships. These are
// deliberately written to hold BOTH before and after the open question of
// whether real data should ship is settled, so settling it does not turn this
// suite red again.
const shippedEnvelope = () => JSON.parse(read('public/data/research.json'))

function assertHonestEnvelope(envelope) {
  assert.doesNotThrow(() => assertValidProjection('research', envelope))
  if (envelope.ok === true) {
    assert.equal(envelope.reason, null, 'an available envelope states no reason')
    assert.notEqual(envelope.data, null, 'an available envelope carries data')
    return true
  }
  assert.equal(envelope.data, null, 'an unavailable envelope must carry no data at all')
  assert.equal(typeof envelope.reason, 'string')
  assert.notEqual(envelope.reason.length, 0, 'an unavailable envelope must say why')
  return false
}

test('research is an independent ring route backed by the research projection', () => {
  const main = read('src/main.js')
  const liveStatus = read('src/live-status.js')

  // The ring is pinned exactly, not loosely matched, so that adding or moving a
  // route is a visible, reviewed change rather than a silent one. 'approvals'
  // joined it when the owner replaced the interrupting prompt popup with a
  // screen he navigates to; the arrows are the only navigation, so a route
  // absent from ORDER is a route nobody can reach.
  assert.match(main, /const ORDER = \['home', 'computers', 'metrics', 'research', 'comms', 'ledger', 'approvals'\]/)
  assert.match(main, /if \(parts\[0\] === 'research'\) return \{ name: 'research' \}/)
  assert.match(main, /case 'research': return researchView\(\)/)
  assert.match(main, /case 'research': return `\$\{base\} \/ research`/)
  assert.match(liveStatus, /'coordinator', 'research'/)
  assert.match(liveStatus, /export const fetchResearch = options => fetchProjection\('research', options\)/)
})

test('research view keeps authorization-gated rows metadata-only', () => {
  const view = read('src/views/research.js')
  const lockedBranch = view.slice(
    view.indexOf('function lockedReportMarkup'),
    view.indexOf('function safeReportMarkup'),
  )
  assert.match(view, /report\?\.needsOwnerAuthorization === true/)
  assert.match(lockedBranch, /report\?\.title/)
  assert.match(lockedBranch, /report\?\.authorizationReason/)
  assert.doesNotMatch(lockedBranch, /report\?\.(?:summary|path|bytes|dateObserved|source|id)/)

  // The shipped envelope must never contradict that view contract. Counts are
  // proved in research-generator.test.mjs; what is proved here is that no gated
  // row can reach the installer carrying the fields the locked branch refuses
  // to render. When the file ships unavailable this is true because there are
  // no rows at all, which is asserted rather than assumed.
  const envelope = shippedEnvelope()
  if (!assertHonestEnvelope(envelope)) return
  const catalog = envelope.data.corpusCatalog.value
  const locked = catalog.filter(item => item.needsOwnerAuthorization === true)
  for (const item of locked) {
    assert.equal(typeof item.title, 'string')
    assert.equal(typeof item.authorizationReason, 'string')
    assert.equal(Object.hasOwn(item, 'summary'), false)
  }
})

test('research view distinguishes unavailable observations from observed-empty data', () => {
  const view = read('src/views/research.js')

  // The distinction itself: an observation that could not be made renders
  // differently from one that was made and found nothing. This is the clause
  // that matters, and it is a property of the view.
  assert.match(view, /if \(!observation\?\.ok\) return unavailableMarkup/)
  assert.match(view, /observation\.value\.length === 0\) return emptyMarkup/)
  // Order matters: an unavailable observation has no .value to measure, so the
  // ok check must come first or an unavailable section renders as "empty" --
  // which is the exact false-liveness claim T4c was fixing.
  assert.ok(
    view.indexOf('if (!observation?.ok) return unavailableMarkup') < view.indexOf('observation.value.length === 0'),
    'the unavailable check must precede the empty check',
  )

  // The shipped envelope must state its own availability honestly, whichever
  // state it ships in. The generator's observed-empty vs out-of-scope sections
  // are proved in research-generator.test.mjs.
  const envelope = shippedEnvelope()
  if (!assertHonestEnvelope(envelope)) return
  assert.equal(envelope.data.findingsRegister.ok, true)
  assert.deepEqual(envelope.data.findingsRegister.value, [])
  assert.equal(envelope.data.failureTaxonomy.ok, false)
  assert.equal(envelope.data.failureTaxonomy.reason, 'source-out-of-scope')
  assert.equal(envelope.data.openQuestions.ok, false)
  assert.equal(envelope.data.openQuestions.reason, 'source-out-of-scope')
})

test('research styling stays theme-native across white, tan, and black', () => {
  const css = read('src/research.css')
  const shared = read('src/styles.css')

  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i)
  for (const theme of ['white', 'tan', 'black']) {
    assert.match(shared, new RegExp(`:root\\[data-theme="${theme}"\\]`))
  }
  for (const token of ['--ink', '--ink-2', '--ink-3', '--ink-4', '--line', '--line-2', '--brace']) {
    assert.match(css, new RegExp(token))
  }
})

test('live Sankey empty state preserves the hero slot and offers an explicit simulation switch', () => {
  const view = read('src/views/metrics.js')
  const css = read('src/metrics.css')

  assert.match(view, /measured usage is not attributed across pools, providers, and agent roles/)
  assert.match(view, /View simulated/)
  assert.match(view, /setLiveView\('metrics', false\)/)
  assert.match(view, /host\.replaceChildren\(panel\)/)
  assert.match(css, /#sankey-chart\.m-sankey-empty-host[\s\S]*?min-height: 430px/)
})
