/* THE EXAMPLE FLEET'S OWN REQUEST REGISTER, IN THE LIVE SHAPE.
 *
 * The ledger page is losing its separate simulated render: the live branch of
 * renderRegister becomes the only render, and this module is what feeds it
 * when the demonstration is on screen. That means the data here must be in
 * EXACTLY the shape the live branch consumes -- the `source.data` member of a
 * validated ledger projection -- and not in the simulated branch's own richer
 * shape (R_ITEMS/Q_ITEMS with titles, agents, ageHours and 'pending'
 * statuses). Those two shapes look like cousins and are not: the projection
 * schema (public/data/schema/ledger.schema.json) closes every object with
 * additionalProperties:false, and src/live-status.js validates the whole
 * payload in the browser before the page sees it, so a single extra field
 * would not render as clutter -- it would turn the entire register
 * "unreadable". Substitution has to be exact or it is suppression with more
 * steps.
 *
 * WHAT THE LIVE SHAPE KEEPS AND WHAT IT DROPS, deliberately mirrored here:
 *
 *   - Requests carry NO title and NO timestamp. The live face of a request is
 *     its id, its status, and its gate arithmetic (src/views/ledger.js,
 *     liveRequestMarkup): the row reads "R3 · blocked · gates 1 · unmet 1".
 *     So the prose of the old sample outline survives only as structure --
 *     the ids, the status mix, and gate counts taken from the gates the
 *     outline declared (LOCAL-WORK, IRREVERSIBLE, OUTWARD).
 *
 *   - Question statuses are TWO fields, not one: a free-text `status` a
 *     person reads, and a machine `statusClass` the page branches on. The
 *     simulated vocabulary ('pending'/'answered') does not exist on this
 *     side; the enum is open | in-progress | blocked | done | unknown, and
 *     the register's "N open" counter keys on statusClass === 'open'.
 *
 *   - The one timestamp in the whole shape is the questions observation's
 *     `observedAt` -- when the sweep that produced the list ran -- not a
 *     per-item age. The live page never computes ages at all.
 *
 * The content stays unmistakably the sample fleet's world -- connecting THIS
 * install, describing machines, deciding gates -- reusing the intent of
 * src/fleet-profile.js's SAMPLE_REQUESTS/SAMPLE_QUESTIONS, so nothing here
 * can be mistaken for a real machine's spending or decisions. The statuses
 * cover all five states the register's summary tiles paint (open,
 * in-progress, gated, done, blocked), because a demonstration with three
 * tiles stuck at zero reads as a worse product, and one question ships a
 * null packageId because that is a state the real projection produces and
 * the row must render its '—' honestly.
 *
 * DETERMINISTIC ON PURPOSE, same convention as src/sample-activity.js: no
 * Math.random and no persisted state -- the same nowMs produces deep-equal
 * output every call, so screenshots compare and the register does not
 * reshuffle itself on navigation. Objects are built fresh per call so no
 * caller's mutation can poison the next render.
 */

/* Six requests, five distinct statuses. Ids and gates follow the old sample
 * outline's roots: R1 connect-this-install (LOCAL-WORK, met, underway),
 * R1.1 detect-a-host (finished), R2 describe-your-machines (two gates, one
 * still unmet, moving on the ungated parts), R3 decide-what-runs-unasked
 * (IRREVERSIBLE gate unmet, so blocked), R4 point-at-your-own-register
 * (nothing gates it; nobody has picked it up), R6 review-what-leaves-this-
 * machine (OUTWARD gate unmet, waiting at it). unmetGateCount never exceeds
 * gateCount, because "gates 1 · unmet 2" reads as a broken register. */
const SAMPLE_LIVE_REQUESTS = Object.freeze([
  Object.freeze({ id: 'R1', status: 'in-progress', gateCount: 1, unmetGateCount: 0 }),
  Object.freeze({ id: 'R1.1', status: 'done', gateCount: 0, unmetGateCount: 0 }),
  Object.freeze({ id: 'R2', status: 'in-progress', gateCount: 2, unmetGateCount: 1 }),
  Object.freeze({ id: 'R3', status: 'blocked', gateCount: 1, unmetGateCount: 1 }),
  Object.freeze({ id: 'R4', status: 'open', gateCount: 0, unmetGateCount: 0 }),
  Object.freeze({ id: 'R6', status: 'gated', gateCount: 1, unmetGateCount: 1 }),
])

/* Three questions, keeping the old sample's numbering where a question
 * survives (Q1, Q2, Q7), so anyone comparing the two sets can see the
 * lineage. The free-text status is written as English because it renders in
 * the row's meta slot; the statusClass beside it is what the page branches
 * on. Q1 is the required open one -- an unanswered question is the state the
 * Q register exists for -- and it carries the null packageId. */
const SAMPLE_LIVE_QUESTIONS = Object.freeze([
  Object.freeze({
    id: 'Q1',
    title: 'Which machines should this install treat as one fleet?',
    status: 'waiting on an owner decision',
    statusClass: 'open',
    packageId: null,
  }),
  Object.freeze({
    id: 'Q2',
    title: 'Should idle lanes be reaped automatically, or held for review?',
    status: 'answered — reap them automatically',
    statusClass: 'done',
    packageId: 'sample/lane-policy',
  }),
  Object.freeze({
    id: 'Q7',
    title: 'Which actions may never run without a decision first?',
    status: 'being drafted into the gate policy',
    statusClass: 'in-progress',
    packageId: 'sample/gate-policy',
  }),
])

/* How long before nowMs the sample's question sweep "ran". Small and fixed:
 * recent enough to read as a live record, non-zero so observedAt and any
 * caller's own clock visibly disagree the way two real clocks do. */
const QUESTIONS_OBSERVED_AGO_MS = 4 * 60_000

const iso = (ms) => new Date(ms).toISOString()

/**
 * The example fleet's R/Q register, in exactly the shape the ledger page's
 * live branch consumes: the `data` member of a valid ledger projection,
 * `{ requests, questions: { ok, reason, observedAt, value } }`. Hand it to
 * the same render path a real projection feeds; do not add fields for other
 * surfaces -- the projection schema closes every object, so an addition here
 * must land in public/data/schema/ledger.schema.json first.
 */
export function sampleLedgerData(nowMs = Date.now()) {
  return {
    requests: SAMPLE_LIVE_REQUESTS.map(item => ({ ...item })),
    /* The observation envelope exists because the questions half can fail
       independently of the requests half; the demonstration shows the
       ordinary case -- a sweep that worked -- because the failure faces are
       different screens that deserve their own demonstrations. */
    questions: {
      ok: true,
      reason: null,
      observedAt: iso(nowMs - QUESTIONS_OBSERVED_AGO_MS),
      value: SAMPLE_LIVE_QUESTIONS.map(item => ({ ...item })),
    },
  }
}
