/* WHAT THE METRICS PAGE MAY SAY ABOUT TOKENS, now that this computer keeps a
 * record of them.
 *
 * The panels under test used to print one sentence: that this product never
 * sees a token count. That was true of the RECORD and false of the PRODUCT --
 * both engines report usage per turn, the main process has always had it, and
 * nothing wrote it down. shell/usage-record.cjs writes it down; these are the
 * rules for reading it back, and every one of them is about not turning a
 * measured figure into a claim.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  LOCAL_USAGE_COPY,
  UNMEASURED,
  describeLocalMetrics,
  readLocalUsage,
  usageByAgent,
  usageByDay,
  usageByProvider,
  usageByRun,
  usageTotals,
} from '../../src/local-metrics.js'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/* A reply in the exact shape mc-agent:usage returns -- entries newest first,
   each carrying the bounded `usage` object the writer admits. */
function reply(turns, { verified = true, ok = true, total = null } = {}) {
  const entries = turns.map((turn, index) => ({
    sequence: turns.length - index,
    at: new Date(turn.atMs).toISOString(),
    action: 'agent_turn_usage',
    principal: 'unauthenticated',
    sessionId: turn.sessionId,
    outcome: null,
    usage: {
      turnId: turn.turnId || `turn-${index}`,
      tier: turn.tier === undefined ? 'luna' : turn.tier,
      account: turn.account === undefined ? null : turn.account,
      status: turn.status === undefined ? 'completed' : turn.status,
      basis: turn.basis || 'turn',
      inputTokens: turn.inputTokens ?? null,
      cachedInputTokens: turn.cachedInputTokens ?? null,
      cacheCreationInputTokens: turn.cacheCreationInputTokens ?? null,
      outputTokens: turn.outputTokens ?? null,
      reasoningOutputTokens: turn.reasoningOutputTokens ?? null,
      totalTokens: turn.totalTokens ?? null,
      contextWindow: turn.contextWindow ?? null,
      sessionTotalTokens: turn.sessionTotalTokens ?? null,
    },
  }))
  return { ok, total: total ?? entries.length, verified, entries }
}

const agentWith = (value) => ({ usage: async () => value, history: async () => ({ ok: true, total: 0, entries: [], verified: true }) })

/* ------------------------------------------------------------------
   THE THREE ABSENCES, WHICH ARE NOT ONE ABSENCE.
   ------------------------------------------------------------------ */

test('a plain web browser is told there is no computer here keeping a record', async () => {
  const reading = await readLocalUsage({ agent: undefined })
  assert.equal(reading.supported, false)
  assert.equal(usageTotals(reading).absence, LOCAL_USAGE_COPY.noChannel)
})

test('a build older than the usage channel says THAT, not that the record is broken', async () => {
  const reading = await readLocalUsage({ agent: { history: async () => ({ ok: true }) } })
  assert.equal(reading.supported, false)
  assert.equal(reading.tooOld, true)
  assert.equal(usageTotals(reading).absence, LOCAL_USAGE_COPY.noUsageChannel)
})

test('a record that will not open is a fault and says so', async () => {
  const reading = await readLocalUsage({ agent: agentWith({ ok: false, code: 'SPAWN_RECORD_UNAVAILABLE' }) })
  assert.equal(reading.supported, true)
  assert.equal(reading.readable, false)
  assert.equal(usageTotals(reading).absence, LOCAL_USAGE_COPY.unreadable)
})

test('an empty record is the ordinary first-day state, never a zero', async () => {
  const reading = await readLocalUsage({ agent: agentWith(reply([])) })
  const totals = usageTotals(reading)
  assert.equal(totals.ok, false)
  assert.equal(totals.absence, LOCAL_USAGE_COPY.empty)
  /* THE DEFECT THIS PINS. A page that printed 0 here would be claiming the
     turns on this computer cost nothing, which is a different statement from
     "no turn has reported a figure yet". */
  assert.equal(totals.tokens, null)
})

/* ------------------------------------------------------------------
   THE FIGURES.
   ------------------------------------------------------------------ */

test('turn figures are summed, and the engine is never credited with arithmetic it did not do', async () => {
  const now = Date.UTC(2026, 7, 18, 12)
  const reading = await readLocalUsage({
    agent: agentWith(reply([
      { atMs: now - HOUR, sessionId: 'chat-1', inputTokens: 4000, outputTokens: 200, totalTokens: 4200 },
      { atMs: now - 2 * HOUR, sessionId: 'chat-1', inputTokens: 1000, outputTokens: 100, totalTokens: 1100 },
    ])),
  })
  const totals = usageTotals(reading)
  assert.equal(totals.ok, true)
  assert.equal(totals.turns, 2)
  assert.equal(totals.tokens.total, 5300)
  assert.equal(totals.tokens.input, 5000)
  assert.equal(totals.tokens.output, 300)
  assert.equal(totals.derivedTotals, 0, 'both turns reported their own total')
})

test('a turn that reported no total has one derived from its own parts, and the page is told how many', async () => {
  const now = Date.UTC(2026, 7, 18, 12)
  const reading = await readLocalUsage({
    agent: agentWith(reply([
      { atMs: now - HOUR, sessionId: 'chat-1', tier: 'claude-sonnet', inputTokens: 6, outputTokens: 412, cacheCreationInputTokens: 18000, cachedInputTokens: 32000 },
    ])),
  })
  const totals = usageTotals(reading)
  assert.equal(totals.tokens.total, 418, 'the total is the input and output the engine reported, and nothing else')
  assert.equal(totals.derivedTotals, 1)
  assert.equal(totals.tokens.cacheCreation, 18000)
  assert.equal(totals.tokens.cachedInput, 32000)
})

test('a cumulative reading is taken ONCE per session, never added up per turn', async () => {
  const now = Date.UTC(2026, 7, 18, 12)
  const reading = await readLocalUsage({
    agent: agentWith(reply([
      { atMs: now - HOUR, sessionId: 'chat-1', basis: 'session-total', totalTokens: 900 },
      { atMs: now - 2 * HOUR, sessionId: 'chat-1', basis: 'session-total', totalTokens: 500 },
      { atMs: now - 3 * HOUR, sessionId: 'chat-1', basis: 'session-total', totalTokens: 100 },
    ])),
  })
  /* Adding these would print 1,500 for a session the engine says spent 900. */
  assert.equal(usageTotals(reading).tokens.total, 900)
})

/* ------------------------------------------------------------------
   THE FOUR GROUPINGS THE PAGE DRAWS.
   ------------------------------------------------------------------ */

test('per provider, from the model row each session was started under', async () => {
  const now = Date.UTC(2026, 7, 18, 12)
  const reading = await readLocalUsage({
    agent: agentWith(reply([
      { atMs: now - HOUR, sessionId: 'chat-1', tier: 'luna', totalTokens: 4000 },
      { atMs: now - 2 * HOUR, sessionId: 'chat-2', tier: 'claude-sonnet', totalTokens: 1000 },
      { atMs: now - 3 * HOUR, sessionId: 'chat-3', tier: null, totalTokens: 500 },
    ])),
  })
  const rows = usageByProvider(reading)
  assert.equal(rows.ok, true)
  assert.deepEqual(rows.rows.map(row => [row.key, row.tokens]), [
    ['codex', 4000],
    ['claude', 1000],
    ['unrecorded', 500],
  ])
  assert.equal(rows.rows[0].label, 'Codex')
  assert.equal(rows.rows[2].label, LOCAL_USAGE_COPY.providerUnrecorded)
})

test('per run, newest first, with what the run was asked when the page knows it', async () => {
  const now = Date.UTC(2026, 7, 18, 12)
  const reading = await readLocalUsage({
    agent: agentWith(reply([
      { atMs: now - HOUR, sessionId: 'chat-1', totalTokens: 4000 },
      { atMs: now - 2 * HOUR, sessionId: 'chat-1', totalTokens: 200 },
      { atMs: now - 3 * HOUR, sessionId: 'chat-2', totalTokens: 900 },
    ])),
  })
  const conversations = new Map([['chat-1', { role: 'planner', asked: 'read the file' }]])
  const rows = usageByRun(reading, { conversations })
  assert.equal(rows.rows.length, 2)
  assert.equal(rows.rows[0].sessionId, 'chat-1')
  assert.equal(rows.rows[0].tokens, 4200)
  assert.equal(rows.rows[0].turns, 2)
  assert.equal(rows.rows[0].asked, 'read the file')
  assert.equal(rows.rows[1].asked, '', 'a run the page has no conversation for renders without one')
})

test('per agent, and a record that cannot name the agent says so instead of inventing one', async () => {
  const now = Date.UTC(2026, 7, 18, 12)
  const reading = await readLocalUsage({
    agent: agentWith(reply([
      { atMs: now - HOUR, sessionId: 'chat-1', totalTokens: 4000 },
      { atMs: now - 2 * HOUR, sessionId: 'chat-2', totalTokens: 900 },
    ])),
  })
  const named = usageByAgent(reading, { conversations: new Map([['chat-1', { role: 'planner' }]]) })
  assert.deepEqual(named.rows.map(row => [row.label, row.tokens]), [
    ['planner', 4000],
    [LOCAL_USAGE_COPY.agentUnnamed, 900],
  ])
})

test('per day, across the window the activity panel already promises', async () => {
  const now = new Date(2026, 7, 18, 12).getTime()
  const reading = await readLocalUsage({
    agent: agentWith(reply([
      { atMs: now, sessionId: 'chat-1', totalTokens: 400 },
      { atMs: now - DAY, sessionId: 'chat-1', totalTokens: 300 },
      { atMs: now - 30 * DAY, sessionId: 'chat-1', totalTokens: 999 },
    ])),
  })
  const days = usageByDay(reading, now)
  assert.equal(days.days.length, 7)
  assert.equal(days.days[6].tokens, 400, 'today is the last column')
  assert.equal(days.days[5].tokens, 300)
  assert.equal(days.max, 400)
  /* A run older than the window is still in the totals above the chart and is
     simply not in the chart -- the same rule activityGrid already follows. */
  assert.equal(days.windowTokens, 700)
})

/* ------------------------------------------------------------------
   WHAT THE PAGE IS STILL NOT ALLOWED TO CLAIM.
   ------------------------------------------------------------------ */

test('a record that no longer verifies is shown, and said to be a report of the file', async () => {
  const now = Date.UTC(2026, 7, 18, 12)
  const reading = await readLocalUsage({
    agent: agentWith(reply([{ atMs: now, sessionId: 'chat-1', totalTokens: 10 }], { verified: false })),
  })
  assert.equal(usageTotals(reading).verified, false)
  assert.equal(usageTotals(reading).ok, true, 'the turns happened; the page still shows them')
})

test('money is still not measured here, and the token panels do not pretend otherwise', () => {
  /* The product holds no prices and no balances, so no arrangement of token
     counts becomes a cost. This sentence must survive the panels being lit. */
  assert.match(UNMEASURED.pools, /balances/i)
  assert.ok(!/token/i.test(UNMEASURED.pools) || /cost|spend|balance/i.test(UNMEASURED.pools))
})

test('describeLocalMetrics carries the usage reading, so the view decides nothing', async () => {
  const now = Date.UTC(2026, 7, 18, 12)
  const usage = await readLocalUsage({ agent: agentWith(reply([{ atMs: now, sessionId: 'chat-1', totalTokens: 4200 }])) })
  const described = describeLocalMetrics({ supported: true, readable: true, runs: [], started: 0, refused: 0, total: 0 }, { usage, nowMs: now })
  assert.equal(described.usage.totals.tokens.total, 4200)
  assert.equal(described.usage.byProvider.rows[0].key, 'codex')
  assert.equal(described.usage.byDay.days.length, 7)
  assert.ok(described.usage.byRun.rows.length >= 1)
})
