/* WHAT THE METRICS PAGE IS ALLOWED TO SAY ON A COMPUTER THAT HAS ONE.
 *
 * THE DEFECT THIS EXISTS TO CLOSE, in the owner's own words, about his own
 * install: "Metrics not connected? ... why does it not have any data is it also
 * my account like have i just not been able to use it or is something not
 * working?" Every tile on #/metrics read:
 *
 *     unavailable · No local agent fleet host detected on this machine.
 *
 * It was not his account, and no amount of use would ever have changed it. The
 * page reads dist/data/metrics.json, which tools/gen-metrics.mjs writes AT BUILD
 * TIME from the builder's own checkout -- tools/agent-preflight.js, an owner
 * request ledger, a BUILD-QUEUE.md. None of those exist on a customer machine,
 * so every installed copy ships that file with ok:false and a 1970 timestamp,
 * and no process on the machine ever rewrites it. src/first-run-needs.js has
 * said so in plain words for months. The page was reporting the absence of a
 * thing that is never present.
 *
 * WHAT IT READS INSTEAD, AND WHY THAT SOURCE AND NOT ANOTHER. This computer DOES
 * keep a record of agent work: shell/spawn-record.cjs writes a signed,
 * hash-chained, append-only line for every agent session this app starts and a
 * second one for what became of it. It is already exposed to the renderer
 * (mcAgent.history), already the substance behind the home screen, and it is
 * the only agent-activity record on the machine that is BOTH complete and
 * verifiable. So the metrics page reads the same record the home screen does,
 * and this module is the one place that decides what can honestly be said about
 * it.
 *
 * IT DOES NOT PARSE THE LEDGER ITSELF. readLocalSessions() in ./local-activity.js
 * already rejoins start records with their outcome records, already refuses to
 * read an unrecorded outcome as success, and is already walked exhaustively by
 * tools/test/home-screen.test.mjs. A second parser would be a second opinion
 * that can disagree with the first, on the same bytes, on two screens of the
 * same product. This module takes that function's OUTPUT and derives readings
 * from it.
 *
 * THE THREE ABSENCES ARE DIFFERENT AND ARE NEVER COLLAPSED, because the whole
 * defect was one absence printed for all of them:
 *
 *   no record channel   the page is open in a plain web browser. There is no
 *                       computer here keeping a record. Nothing is wrong.
 *   record unreadable   there IS a record and this copy could not open it.
 *                       That is a real fault and says so.
 *   record empty        the record opened and nothing has run here yet. That is
 *                       the ordinary first-day state and it says what to do.
 *
 * AND THE FOURTH STATE, WHICH IS THE ONE THAT MADE THE OLD PAGE A LIE: a panel
 * whose subject this product does not measure at all. Token spend, account
 * balances and machine vitals are not recorded anywhere on a customer's
 * computer, and no setting turns them on. Those panels get a sentence saying so
 * plainly -- not "unavailable", which reads as a fault the reader could clear,
 * and not a zero, which is a claim. See UNMEASURED below.
 *
 * NOTHING HERE TOUCHES THE DOM, fetch, storage or a global, so the whole of the
 * page's judgement is a pure function of one record and one clock, and
 * tools/test/local-metrics.test.mjs can walk it.
 */

import { COPY, ENGINE_REASON, readLocalSessions, whenWords } from './local-activity.js'
/* THE SECOND REASON TABLE, AND WHY BOTH ARE READ RATHER THAN ONE BEING COPIED.
   ./local-activity.js keeps the short home-screen wording; ./agent-availability-copy.js
   keeps the fuller agent-page wording, and each holds codes the other does not
   -- measured on the owner's own record, where AGENT_TOOLS_ALL_DISABLED has a
   sentence in the second table and none in the first, so a run he could have
   fixed in one click read "the record does not say why". Asked in that order,
   never merged into a third copy that can drift from both. */
import { UNAVAILABLE_TEXT } from './agent-availability-copy.js'

/* The window the time-shaped panels cover. Seven days because that is what the
   activity panel's own heading has always promised, and changing the heading to
   match a different number would be changing the page to fit the code. */
export const ACTIVITY_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

/* How many ledger lines are asked for. The writer caps a history() request at
   200 (shell/spawn-record.cjs), so this is the largest honest window; when the
   whole chain is longer than it, `sampled` below says so rather than letting a
   bounded reading pass itself off as a total. */
export const HISTORY_LIMIT = 200

/**
 * WHAT EACH ABSENCE SAYS. Values, not sentences buried in a render function,
 * for the same reason ./local-activity.js keeps its copy this way: a test can
 * walk values.
 */
export const LOCAL_METRICS_COPY = Object.freeze({
  /* No mcAgent at all. A plain browser, or a build older than the channel. */
  noChannel: 'This page is open in a web browser, so there is no computer here keeping a record of agent runs. Open ToolsEnabled on a computer and this fills in as you use it.',
  /* The channel is there and the record would not open. This one IS a fault. */
  unreadable: 'ToolsEnabled could not open its own record of what has run on this computer. Nothing here has been lost; this page simply cannot read it right now.',
  /* The record opened and is empty. The ordinary first-day state. */
  empty: 'Nothing has been started on this computer yet, so there is nothing to measure. Start an agent and it is written down here before it begins, and this page fills in.',
  /* The record opened, has runs, and this particular window of it has none. */
  emptyWindow: 'Nothing has run on this computer in the last seven days. The totals above cover everything ever run here.',
  /* Under the filter row, in place of "demonstration fleet". */
  sourceLive: 'read from this computer’s own signed record of what has run here',
  sourceVerified: 'read from this computer’s own record of what has run here, and the record checks out',
  sourceUnverified: 'read from this computer’s own record of what has run here. That record no longer checks out, so treat these numbers as a report of the file rather than of the machine.',
  sampled: (shown, total) => `Showing the most recent ${shown} of ${total} runs; the totals cover all of them.`,
  /* A refusal the shell recorded with no sentence written for its code, and a
     refusal recorded before reasons were kept. Never a guess at the cause. */
  reasonUnknown: 'The record does not say why',
  reasonUnrecorded: 'Recorded before this copy kept outcomes',
})

/* THE PANELS THIS PRODUCT DOES NOT MEASURE, said once each.
 *
 * Every sentence here was checked against what the machine actually holds
 * before it was written. ToolsEnabled starts agents on the person's OWN
 * assistant sign-in and never proxies their traffic, so it never sees a token
 * count or a bill; it declares an organisation of agents rather than watching a
 * fleet of machines, so it has no vitals to trace. Those are properties of the
 * product, not gaps in this page, and a person who is told so stops looking for
 * the switch.
 *
 * NONE OF THESE MAY SAY "unavailable", and none may offer a remedy. There is no
 * setting that turns any of them on, and inventing one would cost the reader an
 * afternoon -- the exact rule src/first-run-needs.js sets out at length.
 */
export const UNMEASURED = Object.freeze({
  tokenRouting: 'This copy does not count the words your assistant uses. An agent runs on your own Codex or Claude sign-in and talks to them directly. That count lives in your account with them, and never passes through here.',
  tokenFlow: 'There is no word count to plot over time here, for the same reason. This computer records that a session started and how it went, and nothing about what was said in it.',
  pools: 'ToolsEnabled holds no accounts and no balances for you. What a session costs is settled between you and whoever you signed in with.',
  burn: 'With no balances held here there is no spending rate to draw. Your assistant’s own account page is where that number lives.',
  heartbeat: 'This is one computer, and it is the one you are looking at. There is no second machine reporting vitals to draw a trace for.',
  gates: 'Nothing on this computer holds a run back for a decision, so there is no waiting to show. Decisions you are asked for appear on the approvals page.',
})

/* One label per outcome the ledger can record. `unrecorded` is deliberately its
   own segment rather than folded into either of the others: the whole point of
   readLocalSessions is that an unrecorded outcome is not a success, and a chart
   that hid it would put the defect back in a different shape. */
export const OUTCOME_SEGMENTS = Object.freeze([
  Object.freeze({ key: 'started', label: 'Started' }),
  Object.freeze({ key: 'refused', label: 'Did not start' }),
  Object.freeze({ key: 'unrecorded', label: 'Not recorded' }),
])

const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const count = value => (Number.isSafeInteger(value) && value >= 0 ? value : null)

/**
 * The plain sentence for one recorded refusal code, or the honest placeholder.
 *
 * The agent page's table holds sentence FRAGMENTS -- they are composed after
 * "Nothing was started." on that page -- so the first letter is raised here.
 * Nothing else about the wording is touched: the remedy inside it is the one
 * that screen already gives, and two screens must not offer a person two
 * different fixes for one code.
 *
 * unavailableReason() from that module is deliberately NOT used: its fallback
 * invents "this copy could not work out why", which is a claim about a run
 * rather than an absence of one -- the distinction ./local-activity.js records
 * at length beside COPY.runReason, and the reason this function has its own
 * last resort.
 */
export function refusalSentenceFor(code) {
  if (typeof code !== 'string' || code.length === 0) return LOCAL_METRICS_COPY.reasonUnrecorded
  const short = COPY.runReason(code)
  if (short) return short
  if (Object.prototype.hasOwnProperty.call(UNAVAILABLE_TEXT, code)) {
    const fragment = UNAVAILABLE_TEXT[code]
    return fragment.charAt(0).toUpperCase() + fragment.slice(1)
  }
  return LOCAL_METRICS_COPY.reasonUnknown
}

/**
 * Read the signed record, through exactly the three cases the home screen
 * distinguishes -- see loadSessions() in src/views/home.js for why conflating
 * the last two would make a screen lie to somebody sitting in front of the
 * application.
 *
 * `agent` is injected so a test never needs a global, matching the
 * `{ postAction = postBridgeAction }` shape every research client module uses.
 */
export async function readLocalRuns({ agent = globalThis.mcAgent, limit = HISTORY_LIMIT } = {}) {
  let raw
  if (!agent) raw = undefined
  else if (typeof agent.history !== 'function') raw = null
  else {
    try { raw = await agent.history({ limit }) } catch { raw = null }
  }
  return readLocalSessions(raw)
}

/* HOW MANY RUNS THE WHOLE RECORD HOLDS, WHICH IS NOT WHAT `sessions.total` IS.
 *
 * MEASURED, NOT ASSUMED, and it would have shipped a doubled number on every
 * tile. readLocalSessions().total is the count of LEDGER LINES when the writer
 * supplies no whole-chain tally -- and every run is two lines, a start and the
 * outcome that resolves it. Nine runs would have been reported as eighteen.
 * When the writer DOES supply a tally, `starts` is already a run count and that
 * is the number to trust, because it covers runs older than the 200-line window
 * this page can see.
 *
 * So the two cases are told apart by whether the tally is there at all, and the
 * bounded window is the floor in both: a total below the number of runs already
 * on the page would be a total contradicted by the list under it.
 */
function runTotals(sessions) {
  const started = count(sessions.started)
  const refused = count(sessions.refused)
  const windowRuns = Array.isArray(sessions.runs) ? sessions.runs.length : 0
  const tallied = started !== null && refused !== null
  const chainRuns = tallied ? count(sessions.total) : null
  const total = Math.max(chainRuns ?? 0, windowRuns, (started ?? 0) + (refused ?? 0))
  return {
    total,
    windowRuns,
    started: started ?? (Array.isArray(sessions.runs) ? sessions.runs.filter(run => run.result === 'started').length : 0),
    refused: refused ?? (Array.isArray(sessions.runs) ? sessions.runs.filter(run => run.result === 'refused').length : 0),
  }
}

/** Which of the three absences a reading is in, or null when there is data. */
function absenceOf(sessions) {
  if (!sessions || sessions.supported !== true) return LOCAL_METRICS_COPY.noChannel
  if (sessions.readable !== true) return LOCAL_METRICS_COPY.unreadable
  if (!Array.isArray(sessions.runs) || sessions.runs.length === 0) return LOCAL_METRICS_COPY.empty
  return null
}

/* Local calendar days, newest last, so a row of them reads left to right the
   way the week does. Local rather than UTC deliberately: a person reading "when
   did I run things" means their own midnight, and a chart drawn on UTC days
   puts a late-evening run on tomorrow. */
function dayStart(ms) {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

const DAY_LABEL = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
const DATE_LABEL = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })

/**
 * Runs by hour of the day across the last seven days -- the shape the "Fleet
 * activity · by hour · 7 days" panel has always drawn, now from runs that
 * genuinely happened on this computer.
 *
 * `max` travels with it so a caller shades against the busiest real hour rather
 * than against an invented ceiling. A grid whose busiest cell is one run is a
 * true picture of a quiet week, and normalising it to look full would be the
 * same class of lie as a zero.
 */
export function activityGrid(sessions, nowMs = Date.now()) {
  const absence = absenceOf(sessions)
  const today = dayStart(nowMs)
  const days = []
  for (let offset = ACTIVITY_DAYS - 1; offset >= 0; offset -= 1) {
    const startMs = today - offset * DAY_MS
    days.push({
      startMs,
      label: DAY_LABEL.format(new Date(startMs)),
      dateLabel: DATE_LABEL.format(new Date(startMs)),
      hours: new Array(24).fill(0),
    })
  }
  if (absence) return Object.freeze({ ok: false, absence, days: Object.freeze([]), max: 0, total: 0 })

  const earliest = days[0].startMs
  let total = 0
  let max = 0
  for (const run of sessions.runs) {
    if (!Number.isFinite(run?.atMs) || run.atMs < earliest) continue
    const index = Math.floor((dayStart(run.atMs) - earliest) / DAY_MS)
    if (index < 0 || index >= days.length) continue
    const hour = new Date(run.atMs).getHours()
    days[index].hours[hour] += 1
    total += 1
    if (days[index].hours[hour] > max) max = days[index].hours[hour]
  }
  const frozen = Object.freeze(days.map(day => Object.freeze({ ...day, hours: Object.freeze(day.hours) })))
  /* An empty WINDOW is not an empty record, and saying "nothing has run here"
     over a page whose tiles show nineteen runs would be the contradiction the
     home screen's own test exists to prevent. */
  if (total === 0) {
    return Object.freeze({ ok: false, absence: LOCAL_METRICS_COPY.emptyWindow, days: frozen, max: 0, total: 0 })
  }
  return Object.freeze({ ok: true, absence: null, days: frozen, max, total })
}

/**
 * What became of every run this record holds. Whole-chain counts where the
 * writer supplies them (they cover runs older than the window this page reads),
 * falling back to the window itself when it does not.
 */
export function outcomeBreakdown(sessions) {
  const absence = absenceOf(sessions)
  if (absence) return Object.freeze({ ok: false, absence, segments: Object.freeze([]), total: 0 })

  const { total, started, refused } = runTotals(sessions)
  const unrecorded = Math.max(0, total - started - refused)
  const values = { started, refused, unrecorded }
  return Object.freeze({
    ok: true,
    absence: null,
    total,
    segments: Object.freeze(OUTCOME_SEGMENTS.map(segment => Object.freeze({
      key: segment.key,
      label: segment.label,
      count: values[segment.key],
      /* A share of nothing is not zero percent, it is no share at all. */
      share: total > 0 ? values[segment.key] / total : null,
    }))),
    /* The sentence ./local-activity.js already writes for this exact tally, so
       two screens of one product cannot summarise one record differently. */
    sentence: COPY.runOutcomes(started, refused, total),
  })
}

/**
 * Why runs did not start, grouped, most common first -- the panel that used to
 * be "Failure by lane" over a fleet that does not exist here.
 *
 * The reason is rendered as the SENTENCE the shell's own code maps to, never as
 * the bare code: an upper-case identifier in front of a person is the thing
 * src/refusal-copy.js and tools/check-plain-language.mjs both exist to stop. A
 * code nobody has written a sentence for gets an honest placeholder rather than
 * a guess, exactly as COPY.runReason does on the home screen.
 */
export function refusalBreakdown(sessions) {
  const absence = absenceOf(sessions)
  if (absence) return Object.freeze({ ok: false, absence, rows: Object.freeze([]), total: 0 })

  const refused = sessions.runs.filter(run => run.result === 'refused')
  if (refused.length === 0) {
    return Object.freeze({
      ok: true, absence: null, rows: Object.freeze([]), total: 0,
      sentence: sessions.runs.length === 1
        ? 'The one run recorded here started.'
        : 'Every run recorded here started.',
    })
  }
  const groups = new Map()
  for (const run of refused) {
    const code = typeof run.reason === 'string' && run.reason ? run.reason : null
    const key = code || 'no code recorded'
    const sentence = refusalSentenceFor(code)
    const existing = groups.get(key)
    if (existing) existing.count += 1
    else groups.set(key, { sentence, count: 1 })
  }
  const rows = [...groups.values()]
    .sort((a, b) => b.count - a.count || a.sentence.localeCompare(b.sentence))
    .map(row => Object.freeze({
      sentence: row.sentence,
      count: row.count,
      share: row.count / refused.length,
    }))
  return Object.freeze({
    ok: true, absence: null, total: refused.length, rows: Object.freeze(rows),
    sentence: refused.length === 1
      ? 'One run did not start, and this is what the record says about it.'
      : `${refused.length} runs did not start, grouped by what the record says about them.`,
  })
}

/**
 * The runs themselves, newest first -- what the agent table shows on a page
 * about one computer. `conversations` is the same optional join the home screen
 * makes (session id to what was asked); an unmatched run simply renders without
 * it, which is why this is a join and never a required field on disk.
 */
export function runRows(sessions, { nowMs = Date.now(), conversations = null, limit = 40 } = {}) {
  const absence = absenceOf(sessions)
  if (absence) return Object.freeze({ ok: false, absence, rows: Object.freeze([]), total: 0 })

  const rows = sessions.runs.slice(0, limit).map(run => {
    const said = run.sessionId && conversations && typeof conversations.get === 'function'
      ? conversations.get(run.sessionId)
      : null
    return Object.freeze({
      sequence: run.sequence,
      when: whenWords(nowMs - run.atMs) || COPY.runWhenUnknown,
      at: Number.isFinite(run.atMs) ? new Date(run.atMs).toLocaleString() : '',
      atMs: run.atMs,
      result: run.result,
      /* '' for a run whose outcome was never recorded. The empty string is
         load-bearing here for the same reason it is in COPY.runResult: silence
         must never be rendered as success. */
      resultWord: COPY.runResult(run.result),
      why: run.result === 'refused' ? refusalSentenceFor(run.reason) : '',
      asked: said && typeof said.asked === 'string' ? said.asked : '',
      agent: said && typeof said.role === 'string' ? said.role : '',
    })
  })
  return Object.freeze({ ok: true, absence: null, total: sessions.runs.length, rows: Object.freeze(rows) })
}

/* THE SIX NUMBERS IN THE STAT STRIP, in the strip's own fixed slot ids.
 *
 * The ids are the page's existing DOM identities (src/views/metrics.js
 * TILE_DEFS) and are kept so the strip's protected markup, its sparkline nodes
 * and its edit-layout registry are untouched by this repair. Only what they
 * MEAN changed, and every one of them now means something this computer wrote
 * down.
 *
 * A count is a count and never a rate: the strip used to carry "Failure rate ·
 * %", which over 19 runs would print a decisive-looking 21% that is four
 * events. Whole numbers, with the denominator beside them in the unit line.
 */
export function statTiles(sessions, nowMs = Date.now()) {
  const absence = absenceOf(sessions)
  const outcomes = outcomeBreakdown(sessions)
  const runs = absence ? [] : sessions.runs
  const since = (windowMs) => runs.filter(run => Number.isFinite(run.atMs) && nowMs - run.atMs <= windowMs).length
  const distinctDays = new Set(runs.filter(run => Number.isFinite(run.atMs)).map(run => dayStart(run.atMs)))
  const earliest = runs.reduce((low, run) => (Number.isFinite(run.atMs) && run.atMs < low ? run.atMs : low), Infinity)

  const tile = (id, label, value, unit) => Object.freeze({
    id, label, value: absence ? null : value, unit: absence ? null : unit, absence,
  })
  /* A UNIT LINE HAS TO READ CORRECTLY AT ZERO AND AT ONE, and the first version
     of these did not: with nothing refused, "Did not start · 0 · and the record
     says why" promises a reason for a thing that did not happen, and "1 · runs"
     is simply wrong. Both were caught by driving the page on a fresh profile
     rather than by reading the code. */
  const runWord = value => (value === 1 ? 'run' : 'runs')
  const last7 = since(ACTIVITY_DAYS * DAY_MS)
  const last1 = since(DAY_MS)
  return Object.freeze([
    tile('agents', 'Agent runs', outcomes.ok ? outcomes.total : 0, 'started on this computer'),
    tile('tasks', 'Ran', outcomes.ok ? outcomes.segments[0].count : 0, 'of those runs'),
    tile('fail', 'Did not start', outcomes.ok ? outcomes.segments[1].count : 0, 'of those runs'),
    tile('tokens', 'Last 7 days', last7, runWord(last7)),
    tile('ckpt', 'Last 24 hours', last1, runWord(last1)),
    tile('gates', 'Days used', distinctDays.size, Number.isFinite(earliest)
      ? `since ${DATE_LABEL.format(new Date(earliest))}`
      : 'so far'),
  ])
}

/**
 * What the line under the filter row says about where these numbers came from,
 * including whether the signed chain still checks out.
 *
 * A BROKEN CHAIN IS NOT A REFUSAL. The runs still happened and the person should
 * still see them, beside the fact that the file no longer verifies -- the same
 * decision shell/spawn-record.cjs history() makes about its own return value,
 * and for the same reason.
 */
export function sourceLine(sessions) {
  const absence = absenceOf(sessions)
  if (absence) return Object.freeze({ ok: false, absence, verified: null, sampled: false, note: null })
  const { total, windowRuns: shown } = runTotals(sessions)
  const sampled = total > shown
  return Object.freeze({
    ok: true,
    absence: null,
    verified: sessions.verified === true ? true : (sessions.verified === false ? false : null),
    sampled,
    note: sampled ? LOCAL_METRICS_COPY.sampled(shown, total) : null,
    sentence: sessions.verified === true
      ? LOCAL_METRICS_COPY.sourceVerified
      : (sessions.verified === false ? LOCAL_METRICS_COPY.sourceUnverified : LOCAL_METRICS_COPY.sourceLive),
  })
}

/**
 * Everything the page needs, from one record and one clock. Callers render;
 * they do not decide.
 */
export function describeLocalMetrics(sessions, { nowMs = Date.now(), conversations = null } = {}) {
  return Object.freeze({
    source: sourceLine(sessions),
    tiles: statTiles(sessions, nowMs),
    activity: activityGrid(sessions, nowMs),
    outcomes: outcomeBreakdown(sessions),
    refusals: refusalBreakdown(sessions),
    runs: runRows(sessions, { nowMs, conversations }),
    unmeasured: UNMEASURED,
  })
}

/* Exported for the view's own guard: a reading that is not ok must never be
   rendered as an empty chart, so the view asks this rather than testing
   `.rows.length` and getting the wrong answer for an unreadable record. */
export function readingAbsence(reading) {
  if (!isRecord(reading)) return LOCAL_METRICS_COPY.unreadable
  return reading.ok === true ? null : (reading.absence || LOCAL_METRICS_COPY.unreadable)
}

/* Re-exported so the view has one import for everything it prints, and so a
   future caller cannot reach for a second copy of the reason table. */
export { ENGINE_REASON }
