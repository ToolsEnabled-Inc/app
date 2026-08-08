import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..', '..')
const read = path => readFileSync(resolve(ROOT, path), 'utf8')

test('research is an independent ring route backed by the research projection', () => {
  const main = read('src/main.js')
  const liveStatus = read('src/live-status.js')

  assert.match(main, /const ORDER = \['home', 'computers', 'metrics', 'research', 'comms', 'ledger'\]/)
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

  const envelope = JSON.parse(read('public/data/research.json'))
  const catalog = envelope.data.corpusCatalog.value
  const safe = catalog.filter(item => item.needsOwnerAuthorization !== true)
  const locked = catalog.filter(item => item.needsOwnerAuthorization === true)
  assert.equal(safe.length, 7)
  assert.equal(locked.length, 7)
  assert.equal(envelope.data.methodNotes.value.length, 7)
  for (const item of locked) {
    assert.equal(typeof item.title, 'string')
    assert.equal(typeof item.authorizationReason, 'string')
    assert.equal(Object.hasOwn(item, 'summary'), false)
  }
})

test('research view distinguishes unavailable observations from observed-empty data', () => {
  const view = read('src/views/research.js')
  const envelope = JSON.parse(read('public/data/research.json'))

  assert.match(view, /if \(!observation\?\.ok\) return unavailableMarkup/)
  assert.match(view, /observation\.value\.length === 0\) return emptyMarkup/)
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
