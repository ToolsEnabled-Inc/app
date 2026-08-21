// THE SAMPLE REGISTER MUST BE SHAPED LIKE THE LIVE ONE, EXACTLY.
//
// src/sample-ledger.js feeds the ledger page's LIVE branch -- the simulated
// branch and its own data shape (R_ITEMS/Q_ITEMS, ageHours, 'pending') are
// being deleted. The projection schema closes every object with
// additionalProperties:false and src/live-status.js validates payloads in the
// browser before the page sees them, so shape drift here does not degrade the
// demonstration -- it deletes it: one stray field and the register renders
// "unreadable". This suite therefore holds the sample to the same contract a
// real projection is held to, plus the demonstration's own promises (every
// summary tile lit, the picker fed, an open question to answer, determinism).
//
// THE FIELD LISTS BELOW ARE HAND-EXTRACTED FROM src/views/ledger.js AND
// public/data/schema/ledger.schema.json. If a failure lands here after an
// edit to either of those, the repair is to re-read them and move BOTH the
// sample and these lists together -- not to widen the assertion.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { validateAgainstSchema } from '../gen-projection-lib.mjs'
import { sampleLedgerData } from '../../src/sample-ledger.js'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = relative => readFileSync(path.join(REPO, relative), 'utf8')

/* A fixed clock. Determinism is the point: no test here may call Date.now()
   to build an expectation. */
const NOW_MS = Date.parse('2026-08-21T17:30:00.000Z')

/* Every field the live branch reads from a REQUEST row, and no others.
   Extracted from src/views/ledger.js: liveRequestMarkup (lines 146-176)
   reads id, status, gateCount, unmetGateCount; the Approve/Decline picker
   (lines 387-390) reads id and status; the live summary (renderSummary via
   liveRequestState, lines 79-83) reads status. The projection schema's
   $defs.request requires exactly these four and forbids the rest. */
const REQUEST_FIELDS = ['gateCount', 'id', 'status', 'unmetGateCount']

/* Every field the live branch reads from a QUESTION row, and no others.
   Extracted from src/views/ledger.js: liveQuestionMarkup (lines 178-210)
   reads id, title, status, statusClass, packageId; the "N open" counter
   (line 373) reads statusClass. Matches the schema's $defs.question. */
const QUESTION_FIELDS = ['id', 'packageId', 'status', 'statusClass', 'title']

/* The questions observation envelope. ledger.js reads .value (line 326),
   .ok (line 332) and .reason (line 338). observedAt is read by NO markup,
   but the schema's $defs.questionsObservation requires it, and
   src/live-status.js rejects the whole payload against that schema before
   the page ever branches -- so the field is load-bearing even though no
   pixel shows it. */
const OBSERVATION_FIELDS = ['observedAt', 'ok', 'reason', 'value']

/* The exact status vocabulary the live code branches on: the STATE table's
   keys (src/views/ledger.js lines 24-31) minus 'unknown', which is the
   fall-through for a status nobody classified (liveRequestState, lines
   79-83). A demonstration must not demonstrate the unclassified glyph.
   These five are also SUMMARY_STATES (line 22), so using all of them is
   what lights every tile. */
const RENDERABLE_REQUEST_STATUSES = ['open', 'in-progress', 'gated', 'done', 'blocked']

/* Question statusClass values: the schema's enum minus 'unknown', for the
   same reason. Note 'gated' is a request state only -- it is absent from
   $defs.question.statusClass, and liveQuestionState (lines 85-87) would
   accept it, so the schema is the narrower gate here. */
const RENDERABLE_QUESTION_CLASSES = ['open', 'in-progress', 'blocked', 'done']

const schema = JSON.parse(read('public/data/schema/ledger.schema.json'))

/* The sample is the `data` member of a projection; the schema describes the
   whole envelope. Wrap it in the smallest valid envelope so validation
   exercises the same $defs path src/live-status.js exercises on a real
   fetch, allOf conditionals included. */
function asEnvelope(data, nowMs) {
  return {
    schemaVersion: 1,
    domain: 'ledger',
    generatedAt: new Date(nowMs).toISOString(),
    ok: true,
    reason: null,
    sources: [],
    data,
  }
}

test('the sample validates against the shipped ledger projection schema', () => {
  const errors = validateAgainstSchema(asEnvelope(sampleLedgerData(NOW_MS), NOW_MS), schema)
  assert.deepEqual(errors, [])
})

test('the top-level shape is the live branch\'s source.data, nothing more', () => {
  const data = sampleLedgerData(NOW_MS)
  assert.deepEqual(Object.keys(data).sort(), ['questions', 'requests'])
  assert.ok(Array.isArray(data.requests))
  assert.deepEqual(Object.keys(data.questions).sort(), OBSERVATION_FIELDS)
  assert.equal(data.questions.ok, true)
  assert.equal(data.questions.reason, null)
  assert.ok(Array.isArray(data.questions.value))
})

test('every request field is one the live markup reads -- no more, no fewer', () => {
  for (const item of sampleLedgerData(NOW_MS).requests) {
    assert.deepEqual(Object.keys(item).sort(), REQUEST_FIELDS, `request ${item.id}`)
  }
})

test('every question field is one the live markup reads -- no more, no fewer', () => {
  for (const item of sampleLedgerData(NOW_MS).questions.value) {
    assert.deepEqual(Object.keys(item).sort(), QUESTION_FIELDS, `question ${item.id}`)
  }
})

test('request statuses stay inside the vocabulary the register can paint', () => {
  const statuses = sampleLedgerData(NOW_MS).requests.map(item => item.status)
  for (const status of statuses) {
    assert.ok(RENDERABLE_REQUEST_STATUSES.includes(status), `unrenderable status: ${status}`)
  }
  /* All five, so no summary tile sits at zero and the register shows every
     glyph it owns. This is deliberately stronger than the contract's
     "at least two distinct statuses". */
  assert.deepEqual(
    [...new Set(statuses)].sort(),
    [...RENDERABLE_REQUEST_STATUSES].sort(),
  )
})

test('question statusClasses stay inside the schema enum, and one is open', () => {
  const items = sampleLedgerData(NOW_MS).questions.value
  for (const item of items) {
    assert.ok(RENDERABLE_QUESTION_CLASSES.includes(item.statusClass),
      `unrenderable statusClass: ${item.statusClass}`)
  }
  /* The Q register's counter is "N questions · M open" and the page exists
     to surface undecided questions; a sample with zero open would
     demonstrate a register with nothing to decide. */
  assert.ok(items.some(item => item.statusClass === 'open'))
})

test('the register and picker both have something to show', () => {
  const data = sampleLedgerData(NOW_MS)
  assert.ok(data.requests.length >= 4 && data.requests.length <= 6)
  assert.ok(data.questions.value.length >= 2 && data.questions.value.length <= 3)
  /* The Approve/Decline picker is built as `${id} · ${status}` keyed by id
     (ledger.js lines 387-390): ids must be unique and both fields non-empty. */
  const ids = data.requests.map(item => item.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const item of data.requests) {
    assert.ok(item.id.length > 0 && item.status.length > 0)
  }
})

test('gate arithmetic is coherent: unmet never exceeds declared gates', () => {
  for (const item of sampleLedgerData(NOW_MS).requests) {
    assert.ok(Number.isInteger(item.gateCount) && item.gateCount >= 0, item.id)
    assert.ok(Number.isInteger(item.unmetGateCount) && item.unmetGateCount >= 0, item.id)
    assert.ok(item.unmetGateCount <= item.gateCount,
      `${item.id} shows "gates ${item.gateCount} · unmet ${item.unmetGateCount}"`)
  }
})

test('one question exercises the null packageId path', () => {
  /* liveQuestionMarkup renders a null packageId as '—' (ledger.js line 183);
     a real projection produces nulls, so the demonstration must show one. */
  const values = sampleLedgerData(NOW_MS).questions.value.map(item => item.packageId)
  assert.ok(values.includes(null))
  for (const value of values) {
    if (value !== null) assert.ok(typeof value === 'string' && value.length > 0)
  }
})

test('same nowMs, same record -- deterministic to deep equality', () => {
  assert.deepEqual(sampleLedgerData(NOW_MS), sampleLedgerData(NOW_MS))
})

test('nowMs actually feeds the record, and calls do not share mutable state', () => {
  const earlier = sampleLedgerData(NOW_MS - 60 * 60_000)
  const now = sampleLedgerData(NOW_MS)
  assert.notEqual(earlier.questions.observedAt, now.questions.observedAt)

  /* Fresh objects per call: a caller mutating its copy must not poison the
     next render. */
  const first = sampleLedgerData(NOW_MS)
  first.requests[0].status = 'vandalized'
  first.questions.value[0].statusClass = 'vandalized'
  assert.deepEqual(sampleLedgerData(NOW_MS), now)
})

test('every timestamp in the record is a valid date-time at or before nowMs', () => {
  /* Walk every string in the payload rather than naming observedAt, so a
     future timestamp field is caught the day it is added. A timestamp after
     nowMs would render as a record from the future. */
  const stamps = []
  const walk = value => {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) stamps.push(value)
    else if (Array.isArray(value)) value.forEach(walk)
    else if (value && typeof value === 'object') Object.values(value).forEach(walk)
  }
  walk(sampleLedgerData(NOW_MS))
  assert.ok(stamps.length >= 1, 'expected at least the questions observedAt')
  for (const stamp of stamps) {
    const ms = Date.parse(stamp)
    assert.ok(Number.isFinite(ms), `unparseable date-time: ${stamp}`)
    assert.ok(ms <= NOW_MS, `timestamp after nowMs: ${stamp}`)
  }
})

test('the module never imports the modules being deleted', () => {
  const source = read(path.join('src', 'sample-ledger.js'))
  assert.doesNotMatch(source, /from\s+['"][^'"]*\b(sim|vocab|ledger-data)\.js['"]/,
    'src/sim.js, src/vocab.js and src/ledger-data.js are being deleted; the sample must not lean on them')
})

test('the sample world is the example fleet\'s, not anybody\'s spending', () => {
  /* The prose surface of the live shape is small -- question titles and
     statuses -- but it is rendered as English. Everything must stay in the
     sample fleet's own vocabulary; money words would read as a real
     machine's decisions. */
  const serialized = JSON.stringify(sampleLedgerData(NOW_MS))
  assert.doesNotMatch(serialized, /\$|\bUSD\b|price|invoice|payment|purchase/i)
})
