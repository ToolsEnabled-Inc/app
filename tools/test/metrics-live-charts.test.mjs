/* THE FENCE BETWEEN THE MADE-UP NUMBERS AND THE MEASURED ONES.
 *
 * WHY THIS SUITE EXISTS AT ALL. The metrics page has two faces: a demonstration
 * whose series come from src/sim.js, and a face that reads this computer's own
 * signed records. For months the second face had no charts, and the reason was a
 * rule a person had to remember -- "never initialise the chart engine in live
 * mode" -- written to stop a SIMULATED series being drawn on a panel a reader
 * takes for a measurement. In a research product that would be data fraud by
 * accident: a shape nobody measured, on a page whose whole promise is that it
 * only shows what happened here.
 *
 * The charts are back on both faces, so the rule is replaced by two structural
 * facts that a person cannot forget to apply, and this file is what makes them
 * facts rather than intentions:
 *
 *   1. src/metrics-live-charts.js cannot SEE the simulation. The first test
 *      walks its whole import graph and fails if any path reaches src/sim.js,
 *      src/vocab.js, src/fleet-profile.js or src/metrics-charts.js.
 *   2. A measured host cannot be handed anything else. Every option the measured
 *      feeders build carries a mark from a Symbol private to that module, and
 *      draw() refuses an option without it -- so a simulated option reaching a
 *      measured panel is an exception, not a picture.
 *
 * BOTH GUARDS WERE PROVED RED BEFORE THEY WERE TRUSTED, in a detached worktree
 * that was thrown away: adding `import { sim } from './sim.js'` to the live
 * module failed test 1 naming the path, and drawing an option built anywhere
 * else failed test 2. A guard nobody has seen fail is a guard nobody has tested.
 *
 * The rest of the file is about the other half of the same promise: the numbers
 * a measured chart draws must be traceable to the record, a cumulative reading
 * must never be summed, and the Range control must genuinely re-project.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  activityMatrix,
  activityOption,
  burnOption,
  createLiveCharts,
  isMeasuredOption,
  liveWindow,
  outcomeOption,
  refusalOption,
  routingFlows,
  routingOption,
  tokenBandOption,
  tokenBands,
  turnCounts,
  turnStripOption,
  turnsInWindow,
} from '../../src/metrics-live-charts.js'
import { usageByAccount, usageByAgent, usageByProvider } from '../../src/local-metrics.js'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SOURCE_ROOT = path.join(REPO_ROOT, 'src')

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/* ================= 1. the import fence ================= */

/* The four modules a measured chart must not be able to reach. sim.js builds the
   demonstration's series; vocab.js and fleet-profile.js are the declared fleet it
   builds them out of; metrics-charts.js is the demonstration's own option
   builders. A path to any of them is a path a series could travel. */
const FORBIDDEN = ['sim.js', 'vocab.js', 'fleet-profile.js', 'metrics-charts.js']

/* Relative imports only -- a bare specifier is a package, and no package in this
   tree is one of the four. The regular expression covers `import x from`,
   `import {a} from`, bare `import` and `export ... from`. */
function relativeImports(file) {
  const source = readFileSync(file, 'utf8')
  const found = new Set()
  const pattern = /(?:^|\n)\s*(?:import|export)\b[^'"\n]*?['"](\.[^'"]+)['"]/g
  for (const match of source.matchAll(pattern)) found.add(match[1])
  /* Dynamic import is a path too, and a fence that only reads static imports is
     a fence with a gate in it. */
  for (const match of source.matchAll(/import\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g)) found.add(match[1])
  return [...found]
}

function walkImports(entry) {
  const seen = new Set()
  const paths = new Map()
  const queue = [[entry, [path.relative(REPO_ROOT, entry)]]]
  while (queue.length > 0) {
    const [file, trail] = queue.shift()
    if (seen.has(file)) continue
    seen.add(file)
    paths.set(file, trail)
    for (const specifier of relativeImports(file)) {
      const next = path.resolve(path.dirname(file), specifier)
      if (!next.startsWith(SOURCE_ROOT)) continue
      queue.push([next, [...trail, path.relative(REPO_ROOT, next)]])
    }
  }
  return paths
}

test('the measured chart module cannot reach the simulation, at any depth', () => {
  const reached = walkImports(path.join(SOURCE_ROOT, 'metrics-live-charts.js'))
  /* The walk must have actually walked. A fence that resolves nothing passes
     every time, which is the same defect tools/check-suites-discovered.mjs
     exists to stop one level up. */
  assert.ok(reached.size > 1, 'the import walk found no imports at all, so it proved nothing')
  for (const [file, trail] of reached) {
    const name = path.basename(file)
    assert.ok(
      !FORBIDDEN.includes(name),
      `a measured chart can reach the simulation through ${trail.join(' -> ')}`,
    )
  }
})

test('the fence would catch a path to the simulation if one appeared', () => {
  /* THE RED PROOF, RUN EVERY TIME rather than remembered from the day it was
     written. The same walk, from the demonstration's own chart module, MUST
     find the simulation -- through its import of vocab.js. If this assertion
     ever passes silently, the walk has stopped detecting anything and the test
     above is green for the wrong reason. */
  const reached = walkImports(path.join(SOURCE_ROOT, 'metrics-charts.js'))
  const names = [...reached.keys()].map(file => path.basename(file))
  assert.ok(
    names.some(name => FORBIDDEN.includes(name)),
    'the walk found no forbidden module from the demonstration chart module, so it cannot be detecting them',
  )
})

/* ================= 2. the mint ================= */

/* A host resolver that answers nothing: draw() checks the mark BEFORE it looks
   for an element, so the refusal is measurable with no browser at all. */
const noHosts = () => createLiveCharts({ resolve: () => null })

test('a chart this module did not build is refused rather than drawn', () => {
  const charts = noHosts()
  /* Shaped exactly like a demonstration option: a real series, real numbers, a
     real id. Nothing about it looks wrong. That is the point -- the mark is what
     tells them apart, not the shape. */
  const simulatedLooking = {
    series: [{ id: 'routing', type: 'line', data: [12.4, 18.1, 22.9] }],
    xAxis: { type: 'category', data: ['0', '1', '2'] },
  }
  assert.equal(isMeasuredOption(simulatedLooking), false)
  assert.throws(() => charts.draw('hero', simulatedLooking), /measured panel/)
  charts.dispose()
})

test('the mark cannot be forged by copying the fields of a measured option', () => {
  const window = liveWindow('7d', Date.UTC(2026, 7, 18, 12))
  const option = tokenBandOption({ bands: tokenBands(sampleTurns(), window), window, theme: THEME })
  assert.equal(isMeasuredOption(option), true)
  /* A spread copies enumerable own properties. The mark is not one, so the copy
     is refused -- which is what stops "I rebuilt the option over there" from
     becoming a way past the fence. */
  assert.equal(isMeasuredOption({ ...option }), false)
  const charts = noHosts()
  assert.throws(() => charts.draw('hero', { ...option }), /measured panel/)
  /* And the real one is accepted: with no host it simply draws nothing, which
     is a different outcome from being refused. */
  assert.equal(charts.draw('hero', option), null)
  charts.dispose()
})

/* ================= 3. nothing measured, nothing drawn ================= */

const THEME = {
  ink: '#0e1726', ink2: '#4f5f70', ink25: '#5a6876', ink3: '#64727f',
  grid: '#eeeeee', cross: '#cccccc', track: '#f0f0f0',
  good: '#0a6d3c', warn: '#8f5902', serious: '#b23811',
  bg: '#ffffff', sheet: '#ffffff', poolAccent: '#5c6b7a', signal: '#34495e',
  heat: ['#f4f4f4', '#d0e2ff', '#a6c8ff', '#78a9ff', '#4589ff', '#0f62fe'],
  prov: { codex: '#0f62fe', claude: '#8a3ffc', gemini: '#007d79', local: '#6f6f6f' },
  font: 'sans-serif', mono: 'monospace', dark: false,
  sankeyRest: 0.24, sankeyMid: 0.31, sankeyHover: 0.58,
}

test('an empty record draws no chart at all', () => {
  const window = liveWindow('7d', Date.UTC(2026, 7, 18, 12))
  const bands = tokenBands([], window)
  const counts = turnCounts([], window)
  const activity = activityMatrix([], window)
  const flows = routingFlows([])
  assert.equal(bands.ok, false)
  assert.equal(counts.ok, false)
  assert.equal(activity.ok, false)
  assert.equal(flows.ok, false)
  /* Every feeder answers null rather than an option with a zero in it. A pretty
     empty chart is a shape a person reads as a measurement of nothing. */
  assert.equal(tokenBandOption({ bands, window, theme: THEME }), null)
  assert.equal(turnStripOption({ counts, window, theme: THEME }), null)
  assert.equal(activityOption({ activity, theme: THEME, hourTicks: [0, 6, 12, 18] }), null)
  assert.equal(routingOption({ flows, theme: THEME }), null)
  assert.equal(burnOption({ bands, window, theme: THEME }), null)
  assert.equal(outcomeOption({ outcomes: { ok: true, total: 0, segments: [] }, theme: THEME }), null)
  assert.equal(refusalOption({ refusals: { ok: true, rows: [] }, theme: THEME }), null)
})

test('an unreadable reading draws no chart either', () => {
  assert.equal(outcomeOption({ outcomes: { ok: false, absence: 'not readable' }, theme: THEME }), null)
  assert.equal(refusalOption({ refusals: { ok: false, absence: 'not readable' }, theme: THEME }), null)
  assert.equal(activityOption({ activity: { ok: false }, theme: THEME, hourTicks: [] }), null)
})

/* ================= 4. every number is traceable ================= */

const NOW = Date.UTC(2026, 7, 18, 12, 30)

function sampleTurns() {
  return [
    { sequence: 5, atMs: NOW - 2 * HOUR, sessionId: 's1', tier: 'luna', account: 'work@example.com', basis: 'turn', totalTokens: 900, derivedTotal: false },
    { sequence: 4, atMs: NOW - 3 * HOUR, sessionId: 's1', tier: 'luna', account: 'work@example.com', basis: 'turn', totalTokens: 600, derivedTotal: false },
    { sequence: 3, atMs: NOW - 2 * DAY, sessionId: 's2', tier: 'claude-sonnet', account: 'home@example.com', basis: 'turn', totalTokens: 400, derivedTotal: true },
    { sequence: 2, atMs: NOW - 20 * DAY, sessionId: 's3', tier: 'claude-opus', account: 'home@example.com', basis: 'turn', totalTokens: 250, derivedTotal: false },
  ]
}

test('every value a token band draws is the sum of recorded turns in that bucket', () => {
  const window = liveWindow('7d', NOW)
  const turns = sampleTurns()
  const bands = tokenBands(turns, window)
  const option = tokenBandOption({ bands, window, theme: THEME })
  const drawn = option.series.flatMap(series => series.data)
  const plotted = drawn.reduce((sum, value) => sum + value, 0)
  const scoped = turnsInWindow(turns, window)
  const recorded = scoped.reduce((sum, turn) => sum + turn.totalTokens, 0)
  assert.equal(plotted, recorded)
  assert.equal(bands.total, recorded)
  /* And it is genuinely a subset of the record: the 20-day-old turn is outside
     a seven-day window and is not on the chart. */
  assert.equal(recorded, 900 + 600 + 400)
  /* Each band is one assistant, named from the same table the start control
     uses -- never a hue with no name behind it. */
  assert.deepEqual(option.series.map(series => series.name).sort(), ['Claude', 'Codex'])
})

test('a running total is never added to a bucket', () => {
  /* shell/usage-record.cjs marks a cumulative reading `session-total`. Summing
     one per turn multiplies a session's usage by its number of turns, and
     placing it on a day spikes that day with tokens spent across many. */
  const window = liveWindow('24h', NOW)
  const cumulative = [
    { sequence: 3, atMs: NOW - HOUR, sessionId: 's9', tier: 'luna', account: 'a', basis: 'session-total', totalTokens: 5000 },
    { sequence: 2, atMs: NOW - 2 * HOUR, sessionId: 's9', tier: 'luna', account: 'a', basis: 'session-total', totalTokens: 3000 },
    { sequence: 1, atMs: NOW - 3 * HOUR, sessionId: 's9', tier: 'luna', account: 'a', basis: 'turn', totalTokens: 120 },
  ]
  const bands = tokenBands(cumulative, window)
  assert.equal(bands.total, 120)
  /* The routing diagram may use it -- a session whose only figure is cumulative
     still used something -- but it takes the LARGEST, never the sum. */
  const flows = routingFlows(cumulative.filter(turn => turn.basis === 'session-total'))
  assert.equal(flows.total, 5000)
})

test('runs are counted into the hour they happened, and nothing else is', () => {
  const window = liveWindow('7d', NOW)
  const runs = [
    { atMs: NOW - HOUR, result: 'started' },
    { atMs: NOW - HOUR - 60_000, result: 'started' },
    { atMs: NOW - 3 * DAY, result: 'refused' },
    { atMs: NOW - 40 * DAY, result: 'started' },
    { atMs: null, result: 'started' },
  ]
  const activity = activityMatrix(runs, window)
  assert.equal(activity.total, 3)
  assert.equal(activity.max, 2)
  const option = activityOption({ activity, theme: THEME, hourTicks: [0, 6, 12, 18] })
  const cells = option.series[0].data
  const drawnRuns = cells.reduce((sum, [, , runsHere]) => sum + runsHere, 0)
  assert.equal(drawnRuns, activity.total)
  /* Shaded against the busiest REAL hour: a quiet week must not be normalised
     into a full-looking one. */
  assert.equal(option.visualMap.max, 2)
})

/* ================= 5. the Range control genuinely re-projects ================= */

test('a different range is a different projection, not the same picture', () => {
  const turns = sampleTurns()
  const day = tokenBands(turns, liveWindow('24h', NOW))
  const week = tokenBands(turns, liveWindow('7d', NOW))
  const month = tokenBands(turns, liveWindow('30d', NOW))
  assert.equal(day.total, 1500)
  assert.equal(week.total, 1900)
  assert.equal(month.total, 2150)
  assert.equal(day.stacked.length, 24)
  assert.equal(week.stacked.length, 7)
  assert.equal(month.stacked.length, 30)
})

/* ================= 6. the routing agrees with the panels beside it ================= */

/* The same reply shape mc-agent:usage returns, so the two readers under test are
   given identical input rather than two hand-written versions of it. */
function usageRecord(turns) {
  return {
    supported: true, tooOld: false, readable: true, verified: true,
    total: turns.length, turns,
  }
}

test('the routing columns add up to exactly what the readings say', () => {
  /* THE DIVERGENCE THIS PREVENTS. The routing diagram needs a joint key -- which
     sign-in, through which assistant, to which agent -- that no export in
     src/local-metrics.js answers, so the session collapse is repeated in the
     chart module. Two implementations of one rule is how a chart comes to
     disagree with the panel beside it, so they are compared here on a record
     that includes the case they could disagree about: a cumulative row. */
  const turns = [
    ...sampleTurns(),
    { sequence: 6, atMs: NOW - HOUR, sessionId: 's4', tier: 'luna', account: 'work@example.com', basis: 'session-total', totalTokens: 7000 },
  ]
  const record = usageRecord(turns)
  const conversations = new Map([['s1', { role: 'Reader' }], ['s2', { role: 'Writer' }]])
  const flows = routingFlows(turns, { conversations })

  const columnTotal = (kind) => flows.nodes
    .filter(node => node.kind === kind)
    .reduce((sum, node) => sum + node.routed, 0)

  assert.equal(columnTotal('sign-in'), usageByAccount(record).total)
  assert.equal(columnTotal('assistant'), usageByProvider(record).total)
  assert.equal(columnTotal('agent'), usageByAgent(record, { conversations }).total)
  assert.equal(flows.total, usageByAccount(record).total)

  /* And a run this page holds no conversation for gets a row saying so, never a
     made-up name and never a dropped flow. */
  const agents = flows.nodes.filter(node => node.kind === 'agent').map(node => node.label)
  assert.ok(agents.includes('Not named on this computer'))
})

test('the routing option draws only flows the record holds', () => {
  const turns = sampleTurns()
  const flows = routingFlows(turns, { conversations: new Map([['s1', { role: 'Reader' }]]) })
  const option = routingOption({ flows, theme: THEME })
  const drawn = option.series[0].links.reduce((sum, link) => sum + link.value, 0)
  /* Two hops per session (sign-in to assistant, assistant to agent), so the
     drawn edge total is twice the tokens -- and exactly twice, which is what
     says no third flow was invented anywhere. */
  assert.equal(drawn, flows.total * 2)
})

/* ================= 7. the outcome split keeps the third segment ================= */

test('an outcome nobody recorded stays its own segment', () => {
  const outcomes = {
    ok: true,
    total: 10,
    segments: [
      { key: 'started', label: 'Started', count: 6, share: 0.6 },
      { key: 'refused', label: 'Did not start', count: 3, share: 0.3 },
      { key: 'unrecorded', label: 'Not recorded', count: 1, share: 0.1 },
    ],
  }
  const option = outcomeOption({ outcomes, theme: THEME })
  assert.deepEqual(option.series.map(series => series.id), ['started', 'refused', 'unrecorded'])
  assert.deepEqual(option.series.map(series => series.data[0]), [6, 3, 1])
  /* Silence read as success is the defect the run reading exists to prevent, so
     the unrecorded segment wears a neutral rather than a shade of either of the
     other two. */
  const unrecorded = option.series.find(series => series.id === 'unrecorded')
  assert.equal(unrecorded.itemStyle.color, THEME.ink3)
})

test('a refusal is drawn as its sentence and its count, never as a code', () => {
  const refusals = {
    ok: true,
    rows: [
      { sentence: 'No agent host is set up on this computer.', count: 4, share: 0.8 },
      { sentence: 'The record does not say why', count: 1, share: 0.2 },
    ],
  }
  const option = refusalOption({ refusals, theme: THEME })
  assert.deepEqual(option.yAxis.data, refusals.rows.map(row => row.sentence))
  assert.deepEqual(option.series[0].data, [4, 1])
  /* Counts, not rates: the axis steps in whole runs. */
  assert.equal(option.xAxis.minInterval, 1)
})
