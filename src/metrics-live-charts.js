/* THE CHARTS ON THE MEASURED FACE OF #/metrics, AND NOTHING ELSE.
 *
 * WHY THIS IS A SEPARATE FILE AND MUST STAY ONE.
 *
 * The metrics page has two faces behind one flag: a demonstration built from
 * src/sim.js, and a face that reads this computer's own signed records. The
 * demonstration owns eight ECharts instruments (../metrics-charts.js). The
 * measured face owned none, because the rule that kept it safe was "never
 * initialise the chart engine in live mode" -- a rule written to stop a
 * SIMULATED series being handed to a panel a person reads as a measurement.
 * That rule worked and it cost the page every chart on it, which is what the
 * owner asked about: "what happened to all the charts".
 *
 * The rule is replaced here by something a person cannot forget to apply. This
 * module can see the readings in ../local-metrics.js and the design tokens in
 * ../echarts-theme.js. It CANNOT see ../sim.js, ../vocab.js, ../fleet-profile.js
 * or ../metrics-charts.js, directly or through any import of an import, and
 * tools/test/metrics-live-charts.test.mjs walks the graph and fails if a path to
 * any of them ever appears. There is therefore no expression anywhere in this
 * file that can evaluate to a simulated number.
 *
 * AND THE ENGINE SIDE IS FENCED THE SAME WAY. createLiveCharts().draw() accepts
 * only an option object minted by one of the feeders below -- the mark is a
 * Symbol private to this module, so an option built anywhere else, including the
 * demonstration's own builders, is refused with an exception rather than drawn.
 * A refactor that wires a simulated option into a measured host does not produce
 * a plausible-looking chart; it produces a crash, in a test, before it ships.
 *
 * WHAT IS STILL NEVER DRAWN. A reading that is absent, unreadable or empty gets
 * no chart at all: the feeders answer null, and the view writes the sentence
 * that says which of those it is. An empty pretty chart is a shape a person
 * reads as a measurement of nothing, and on a research page that is worse than
 * a sentence admitting there is nothing yet.
 */

import * as echarts from 'echarts/core'
import { BarChart, HeatmapChart, LineChart, SankeyChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, VisualMapComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import { withAlpha } from './echarts-theme.js'
/* The one table that says which assistant a model row belongs to. The same
   import ../local-metrics.js makes, for the same reason: a second copy of this
   mapping is how a chart comes to disagree with the panel beside it. */
import { LAUNCH_TIERS } from './orchestration-controls.js'

echarts.use([
  BarChart, HeatmapChart, LineChart, SankeyChart,
  GridComponent, TooltipComponent, VisualMapComponent,
  SVGRenderer,
])

/* ================= the mint =================
   Private by construction. Nothing outside this module can put this mark on an
   object, so draw() can tell a measured option from every other option in the
   program without trusting anybody to remember the difference. */
const MEASURED = Symbol('measured-series')

function mint(option) {
  if (!option) return null
  Object.defineProperty(option, MEASURED, { value: true, enumerable: false })
  return option
}

/** Was this option built by one of the feeders in this file? */
export function isMeasuredOption(option) {
  return Boolean(option) && typeof option === 'object' && option[MEASURED] === true
}

/* ================= windows =================
   The Range control on this page names three windows. On the measured face they
   are honoured literally: every series below is built from the records that fall
   inside the chosen window, so pressing 7d draws seven days of what happened
   here rather than moving a highlight over a picture that never changes. */

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

const HOUR_LABEL = (at) => `${String(new Date(at).getHours()).padStart(2, '0')}:00`
const DAY_NAME = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
const DATE_NAME = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })

const dayStart = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime() }
const hourStart = (ms) => { const d = new Date(ms); d.setMinutes(0, 0, 0); return d.getTime() }

export const LIVE_RANGES = Object.freeze({
  '24h': Object.freeze({ id: '24h', word: 'last 24 hours', unit: 'hour', buckets: 24, every: 6 }),
  '7d': Object.freeze({ id: '7d', word: 'last 7 days', unit: 'day', buckets: 7, every: 1 }),
  '30d': Object.freeze({ id: '30d', word: 'last 30 days', unit: 'day', buckets: 30, every: 5 }),
})

/**
 * The buckets one range covers, newest last, on this computer's own clock.
 * `startMs` is the first instant any panel on the measured face will count.
 */
export function liveWindow(range, nowMs = Date.now()) {
  const spec = LIVE_RANGES[range] || LIVE_RANGES['24h']
  const step = spec.unit === 'hour' ? HOUR_MS : DAY_MS
  const last = spec.unit === 'hour' ? hourStart(nowMs) : dayStart(nowMs)
  const buckets = []
  for (let index = spec.buckets - 1; index >= 0; index -= 1) {
    const startMs = last - index * step
    buckets.push(Object.freeze({
      startMs,
      endMs: startMs + step,
      label: spec.unit === 'hour' ? HOUR_LABEL(startMs) : DAY_NAME.format(new Date(startMs)),
      dateLabel: DATE_NAME.format(new Date(startMs)),
    }))
  }
  return Object.freeze({
    range: spec.id,
    word: spec.word,
    unit: spec.unit,
    every: spec.every,
    startMs: buckets[0].startMs,
    endMs: buckets[buckets.length - 1].endMs,
    buckets: Object.freeze(buckets),
  })
}

const inWindow = (atMs, window) => Number.isFinite(atMs) && atMs >= window.startMs && atMs < window.endMs

const bucketIndex = (atMs, window) => {
  const step = window.unit === 'hour' ? HOUR_MS : DAY_MS
  const index = Math.floor((atMs - window.startMs) / step)
  return index >= 0 && index < window.buckets.length ? index : -1
}

/** The runs this window covers. A record with no timestamp is never placed. */
export function runsInWindow(runs, window) {
  if (!Array.isArray(runs)) return []
  return runs.filter(run => inWindow(run?.atMs, window))
}

/**
 * The recorded turns this window covers.
 *
 * A `session-total` row is a running total for a whole session, so it is never
 * placed on an hour or a day -- the rule ../local-metrics.js states at length
 * beside usageByDay, kept here because a time series is exactly where breaking
 * it would spike one bucket with tokens spent across many.
 */
export function turnsInWindow(turns, window) {
  if (!Array.isArray(turns)) return []
  return turns.filter(turn => turn?.basis !== 'session-total' && inWindow(turn?.atMs, window))
}

/* ================= assistants =================
   The label a person sees for the assistant that answered, from the table the
   start control itself uses. `null` is a row of its own and never a guess. */

const PROVIDER_LABELS = Object.freeze({ codex: 'Codex', claude: 'Claude', local: 'On this computer' })
const UNRECORDED = 'Not recorded'
const UNNAMED = 'Not named on this computer'

export function providerOfTier(tier) {
  if (typeof tier !== 'string' || tier.length === 0) return null
  const row = LAUNCH_TIERS.find(candidate => candidate.id === tier)
  return row ? row.provider : null
}

const providerLabel = (provider) => (provider ? (PROVIDER_LABELS[provider] || provider) : UNRECORDED)

/* ================= series derivation ================= */

/**
 * Tokens per bucket, split by the assistant that reported them.
 *
 * Only assistants that actually reported something in this window get a band. A
 * flat zero band for an assistant a person has never run would be this page
 * drawing a claim about an account that does not exist.
 */
export function tokenBands(turns, window) {
  const scoped = turnsInWindow(turns, window)
  const bands = new Map()
  let total = 0
  let derived = 0
  for (const turn of scoped) {
    if (turn.totalTokens === null) continue
    const index = bucketIndex(turn.atMs, window)
    if (index < 0) continue
    const provider = providerOfTier(turn.tier)
    const key = provider || 'unrecorded'
    let band = bands.get(key)
    if (!band) {
      band = { key, label: providerLabel(provider), values: new Array(window.buckets.length).fill(0), tokens: 0 }
      bands.set(key, band)
    }
    band.values[index] += turn.totalTokens
    band.tokens += turn.totalTokens
    total += turn.totalTokens
    if (turn.derivedTotal) derived += 1
  }
  const rows = [...bands.values()].sort((a, b) => b.tokens - a.tokens || a.label.localeCompare(b.label))
  const stacked = window.buckets.map((_, index) => rows.reduce((sum, band) => sum + band.values[index], 0))
  return Object.freeze({
    ok: total > 0,
    bands: Object.freeze(rows.map(row => Object.freeze({ ...row, values: Object.freeze(row.values) }))),
    total,
    derived,
    turns: scoped.length,
    max: stacked.reduce((high, value) => Math.max(high, value), 0),
    stacked: Object.freeze(stacked),
  })
}

/** Recorded turns per bucket -- the companion strip under the token bands. */
export function turnCounts(turns, window) {
  const scoped = turnsInWindow(turns, window)
  const values = new Array(window.buckets.length).fill(0)
  for (const turn of scoped) {
    const index = bucketIndex(turn.atMs, window)
    if (index >= 0) values[index] += 1
  }
  const total = values.reduce((sum, value) => sum + value, 0)
  return Object.freeze({ ok: total > 0, values: Object.freeze(values), total, max: Math.max(...values, 0) })
}

/**
 * Runs by hour of the day, one row per calendar day the window touches.
 *
 * Shaded against the busiest REAL hour rather than an invented ceiling: a week
 * whose busiest cell is one run draws as the quiet week it was.
 */
export function activityMatrix(runs, window) {
  const scoped = runsInWindow(runs, window)
  const firstDay = dayStart(window.startMs)
  const lastDay = dayStart(window.endMs - 1)
  const rows = []
  for (let at = firstDay; at <= lastDay; at += DAY_MS) {
    rows.push({ startMs: at, label: DAY_NAME.format(new Date(at)), dateLabel: DATE_NAME.format(new Date(at)) })
  }
  const counts = rows.map(() => new Array(24).fill(0))
  let max = 0
  for (const run of scoped) {
    const index = Math.round((dayStart(run.atMs) - firstDay) / DAY_MS)
    if (index < 0 || index >= rows.length) continue
    const hour = new Date(run.atMs).getHours()
    counts[index][hour] += 1
    if (counts[index][hour] > max) max = counts[index][hour]
  }
  return Object.freeze({
    ok: scoped.length > 0,
    rows: Object.freeze(rows.map(row => Object.freeze(row))),
    counts: Object.freeze(counts.map(row => Object.freeze(row))),
    total: scoped.length,
    max,
  })
}

/* ---------- token routing ----------
   THE ONE COLLAPSE RULE, RESTATED HERE AND PINNED BY A TEST.
   ../local-metrics.js collapses a session's turns before grouping them, because
   a cumulative row is a running total rather than a helping. This file needs the
   same collapse over a JOINT key (sign-in, assistant, agent) that no export over
   there answers, so the rule is repeated -- and
   tools/test/metrics-live-charts.test.mjs asserts, over a record containing a
   cumulative row, that every column of this routing adds up to exactly what
   usageByAccount / usageByProvider / usageByAgent answer for the same record. A
   divergence is a failing test, not a wrong picture. */
function collapseForRouting(turns) {
  const sessions = new Map()
  for (const turn of turns) {
    const key = turn.sessionId || `turn:${turn.sequence}`
    let row = sessions.get(key)
    if (!row) {
      row = { key, sessionId: turn.sessionId, turns: 0, cumulative: null, tokens: null, tiers: new Set(), accounts: new Set() }
      sessions.set(key, row)
    }
    if (turn.tier) row.tiers.add(turn.tier)
    if (turn.account) row.accounts.add(turn.account)
    if (turn.basis === 'session-total') {
      if (turn.totalTokens !== null && (row.cumulative === null || turn.totalTokens > row.cumulative)) {
        row.cumulative = turn.totalTokens
      }
      continue
    }
    row.turns += 1
    if (turn.totalTokens !== null) row.tokens = (row.tokens ?? 0) + turn.totalTokens
  }
  for (const row of sessions.values()) {
    if (row.turns === 0 && row.cumulative !== null) { row.tokens = row.cumulative; row.turns = 1 }
  }
  return [...sessions.values()]
}

/**
 * Which sign-in, through which assistant, to which agent -- as flows a Sankey
 * can draw, from the sessions this computer recorded.
 */
export function routingFlows(turns, { conversations = null } = {}) {
  if (!Array.isArray(turns) || turns.length === 0) {
    return Object.freeze({ ok: false, nodes: Object.freeze([]), links: Object.freeze([]), total: 0, sessions: 0 })
  }
  const nodes = new Map()
  const links = new Map()
  let total = 0
  const node = (kind, label, depth) => {
    const name = `${kind} ${label}`
    if (!nodes.has(name)) nodes.set(name, { name, label, kind, depth, inbound: 0, outbound: 0, routed: 0 })
    return name
  }
  const link = (source, target, tokens) => {
    const key = `${source}${target}`
    const edge = links.get(key) || { source, target, value: 0 }
    edge.value += tokens
    links.set(key, edge)
  }
  const rows = collapseForRouting(turns)
  for (const row of rows) {
    const tokens = row.tokens ?? 0
    if (tokens <= 0) continue
    const account = row.accounts.size === 1 ? [...row.accounts][0] : null
    const tier = row.tiers.size === 1 ? [...row.tiers][0] : null
    const said = row.sessionId && conversations && typeof conversations.get === 'function'
      ? conversations.get(row.sessionId)
      : null
    const role = said && typeof said.role === 'string' && said.role ? said.role : null
    const from = node('sign-in', account || UNRECORDED, 0)
    const via = node('assistant', providerLabel(providerOfTier(tier)), 1)
    const to = node('agent', role || UNNAMED, 2)
    link(from, via, tokens)
    link(via, to, tokens)
    total += tokens
  }
  for (const edge of links.values()) {
    nodes.get(edge.source).outbound += edge.value
    nodes.get(edge.target).inbound += edge.value
  }
  for (const entry of nodes.values()) entry.routed = Math.max(entry.inbound, entry.outbound)
  const listed = [...nodes.values()].sort((a, b) => a.depth - b.depth || b.routed - a.routed)
  /* HOW TALL THE DIAGRAM SHOULD BE, decided by how much there is to draw.
     A Sankey scales its nodes to fill whatever box it is given, so ONE measured
     session in a 430px panel draws as a full-height grey slab rather than as a
     flow -- which is what it looked like on the packaged build the first time
     this was driven. The tallest column decides the height instead. */
  const tallest = [0, 1, 2].reduce(
    (high, depth) => Math.max(high, listed.filter(entry => entry.depth === depth).length), 0)
  return Object.freeze({
    ok: total > 0,
    total,
    sessions: rows.length,
    tallest,
    height: Math.max(132, Math.min(430, tallest * 74 + 56)),
    nodes: Object.freeze(listed),
    links: Object.freeze([...links.values()]),
  })
}

/* ================= option feeders =================
   Each returns the COMPLETE option for one host, every colour taken from the
   theme snapshot, or null when there is nothing measured to draw. */

const tipBase = () => ({
  appendToBody: true,
  confine: true,
  transitionDuration: 0,
  padding: 0,
  borderWidth: 0,
  backgroundColor: 'transparent',
  extraCssText: 'box-shadow:none;',
})
const mtip = (html) => `<div class="mtip">${html}</div>`
const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;')

const whole = (value) => Math.round(value).toLocaleString('en-US')

function anim({ entrance = false, dur = 0, reduced = false }) {
  return {
    animation: !reduced,
    animationDuration: entrance && !reduced ? 800 : 0,
    animationEasing: 'cubicOut',
    animationDurationUpdate: reduced ? 0 : dur,
    animationEasingUpdate: 'cubicInOut',
  }
}

const axisText = (theme, color) => ({ color, fontSize: 12.5, fontFamily: theme.font, fontWeight: 400 })
const axisNumberText = (theme, color) => ({ color, fontSize: 12.5, fontFamily: theme.mono, fontWeight: 450 })

const BAND_L = 52
const BAND_R = 26

const bandInk = (theme, key) => theme.prov[key] || theme.ink3

/** Token flow: what each assistant used, per bucket, over the chosen window. */
export function tokenBandOption({ bands, window, theme, ...motion }) {
  if (!bands?.ok) return null
  const cats = window.buckets.map(bucket => bucket.label)
  const top = bands.bands.length - 1
  return mint({
    ...anim(motion),
    backgroundColor: 'transparent',
    grid: { left: BAND_L, right: BAND_R, top: 14, bottom: 28 },
    xAxis: {
      type: 'category', boundaryGap: false, data: cats,
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: {
        ...axisNumberText(theme, theme.ink3), interval: 0, margin: 9,
        formatter: (value, index) => (index % window.every === 0 ? value : ''),
      },
    },
    yAxis: {
      type: 'value', min: 0,
      splitLine: { lineStyle: { color: theme.grid, width: 1 } },
      axisLabel: { ...axisNumberText(theme, theme.ink3), margin: 8, formatter: (v) => whole(v) },
    },
    tooltip: {
      ...tipBase(), trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: theme.cross, width: 1, type: 'solid' } },
      formatter: (params) => {
        const index = params[0]?.dataIndex ?? 0
        const bucket = window.buckets[index]
        let sum = 0
        const rows = params.map(entry => {
          sum += entry.value
          return `<div class="tt-row"><i class="tt-key" style="background:${bandInk(theme, entry.seriesId)}"></i>${escapeHtml(entry.seriesName)} <b>${whole(entry.value)}</b></div>`
        }).join('')
        return mtip(`<div class="tt-title">${escapeHtml(bucket?.dateLabel || '')} ${escapeHtml(bucket?.label || '')}</div>${rows}<div class="tt-row tt-total">Recorded here <b>${whole(sum)}</b></div>`)
      },
    },
    series: bands.bands.map((band, index) => ({
      id: band.key, name: band.label, type: 'line', stack: 'measured',
      data: band.values.slice(),
      symbol: 'none', smooth: 0.25,
      color: bandInk(theme, band.key),
      z: 2 + index,
      lineStyle: index === top
        ? {
            width: 2, color: bandInk(theme, band.key), join: 'round',
            shadowBlur: 8, shadowColor: withAlpha(bandInk(theme, band.key), 0.32), shadowOffsetY: -2,
          }
        : { width: 1.5, color: theme.bg, join: 'round' },
      areaStyle: { color: bandInk(theme, band.key), opacity: 1 },
      emphasis: { focus: 'series' },
      blur: { lineStyle: { opacity: 0.3 }, areaStyle: { opacity: 0.35 } },
    })),
  })
}

/** The strip under the bands: how many recorded turns landed in each bucket. */
export function turnStripOption({ counts, window, theme, ...motion }) {
  if (!counts?.ok) return null
  return mint({
    ...anim(motion),
    backgroundColor: 'transparent',
    grid: { left: BAND_L, right: BAND_R, top: 5, bottom: 5 },
    xAxis: {
      type: 'category', boundaryGap: false, data: window.buckets.map(bucket => bucket.label),
      axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false },
    },
    yAxis: {
      type: 'value', min: 0, minInterval: 1,
      splitLine: { lineStyle: { color: theme.grid, width: 1 } },
      axisLabel: { ...axisNumberText(theme, theme.ink3), margin: 8, formatter: (v) => whole(v) },
    },
    tooltip: {
      ...tipBase(), trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: theme.cross, width: 1, type: 'solid' } },
      formatter: (params) => {
        const entry = params[0]
        if (!entry) return ''
        const bucket = window.buckets[entry.dataIndex]
        const value = Number(entry.value)
        return mtip(`<div class="tt-title">${escapeHtml(bucket?.dateLabel || '')} ${escapeHtml(bucket?.label || '')}</div><b>${whole(value)}</b> recorded ${value === 1 ? 'turn' : 'turns'}`)
      },
    },
    series: [{
      id: 'measured-turns', type: 'line',
      data: counts.values.slice(),
      symbol: 'none', smooth: false,
      lineStyle: { width: 2, color: theme.signal },
      areaStyle: {
        color: {
          type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: withAlpha(theme.signal, 0.16) },
            { offset: 1, color: withAlpha(theme.signal, 0) },
          ],
        },
      },
    }],
  })
}

/** Token routing: sign-ins, assistants and agents, as measured flows. */
export function routingOption({ flows, theme, ...motion }) {
  if (!flows?.ok) return null
  const nodeInk = (entry) => entry.kind === 'sign-in'
    ? theme.poolAccent
    : entry.kind === 'assistant'
      ? bandInk(theme, String(entry.label).toLowerCase())
      : theme.ink2
  const inks = new Map(flows.nodes.map(entry => [entry.name, nodeInk(entry)]))
  const gradient = (edge, alpha) => ({
    type: 'linear', x: 0, y: 0, x2: 1, y2: 0,
    colorStops: [
      { offset: 0, color: withAlpha(inks.get(edge.source) || theme.ink3, alpha) },
      { offset: 1, color: withAlpha(inks.get(edge.target) || theme.ink3, alpha) },
    ],
  })
  return mint({
    ...anim(motion),
    backgroundColor: 'transparent',
    tooltip: {
      ...tipBase(), trigger: 'item',
      formatter: (q) => (q.dataType === 'edge'
        ? mtip(`<div class="tt-title">${escapeHtml(q.data.sourceLabel)} → ${escapeHtml(q.data.targetLabel)}</div><b>${whole(q.value)}</b> tokens recorded here`)
        : mtip(`<div class="tt-title">${escapeHtml(q.data.label)}</div><b>${whole(q.data.routed)}</b> tokens recorded here`)),
    },
    series: [{
      id: 'measured-routing', type: 'sankey',
      /* The labels sit OUTSIDE the outer columns and carry a figure after the
         name, so the reserved width has to hold "Not recorded · 12,485" and not
         only a word. At 150 it did not: the first column's label was clipped by
         the panel's own left edge, measured on the packaged build. */
      left: 200, right: 200, top: 16, bottom: 12,
      nodeWidth: 12, nodeGap: 26, layoutIterations: 0,
      emphasis: { focus: 'adjacency' },
      data: flows.nodes.map(entry => ({
        name: entry.name, label2: entry.label, depth: entry.depth, kind: entry.kind,
        routed: entry.routed, value: entry.routed,
        itemStyle: { color: nodeInk(entry), borderWidth: 0, borderRadius: 3 },
        label: {
          position: entry.depth === 0 ? 'left' : 'right', distance: 7,
          formatter: `{name|${escapeHtml(entry.label)}}{value| · ${whole(entry.routed)}}`,
          textBorderColor: theme.bg, textBorderWidth: 3,
        },
      })),
      links: flows.links.map(edge => ({
        source: edge.source, target: edge.target, value: edge.value,
        sourceLabel: flows.nodes.find(entry => entry.name === edge.source)?.label || edge.source,
        targetLabel: flows.nodes.find(entry => entry.name === edge.target)?.label || edge.target,
        lineStyle: { color: gradient(edge, theme.sankeyRest), opacity: 1, curveness: 0.5 },
        emphasis: { lineStyle: { color: gradient(edge, theme.sankeyHover), opacity: 1 } },
      })),
      label: {
        fontSize: 12.5, lineHeight: 16, color: theme.ink2, fontFamily: theme.font, fontWeight: 560,
        rich: {
          name: { fontSize: 12.5, lineHeight: 16, color: theme.ink2, fontFamily: theme.font, fontWeight: 560 },
          value: { fontSize: 12.5, lineHeight: 16, color: theme.ink3, fontFamily: theme.mono, fontWeight: 450, padding: [0, 0, 0, 8] },
        },
      },
      blur: { itemStyle: { opacity: 0.35 }, lineStyle: { opacity: 0.06 }, label: { opacity: 0.4 } },
    }],
  })
}

/** Runs by hour, one row per day the window covers. */
export function activityOption({ activity, theme, hourTicks, ...motion }) {
  if (!activity?.ok) return null
  const data = []
  activity.counts.forEach((row, index) => {
    row.forEach((runs, hour) => { data.push([hour, index, runs]) })
  })
  const rowLabel = (index) => {
    const row = activity.rows[index]
    return activity.rows.length > 7 ? row.dateLabel : `${row.label} ${row.dateLabel}`
  }
  return mint({
    ...anim(motion),
    backgroundColor: 'transparent',
    grid: { left: activity.rows.length > 7 ? 52 : 68, right: 8, top: 6, bottom: 20 },
    xAxis: {
      type: 'category', data: Array.from({ length: 24 }, (_, hour) => String(hour)),
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: {
        ...axisNumberText(theme, theme.ink3), interval: 0, margin: 8,
        formatter: (_, index) => (hourTicks.includes(index) ? String(index).padStart(2, '0') : ''),
      },
    },
    yAxis: {
      type: 'category', inverse: true,
      data: activity.rows.map((_, index) => rowLabel(index)),
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: {
        ...axisText(theme, theme.ink3), margin: 8,
        interval: activity.rows.length > 14 ? 4 : 0,
      },
    },
    visualMap: {
      show: false, type: 'continuous', min: 0, max: Math.max(1, activity.max),
      inRange: { color: theme.heat }, seriesIndex: 0,
    },
    tooltip: {
      ...tipBase(), trigger: 'item',
      formatter: ({ data: [hour, index, runs] }) => mtip(
        `<div class="tt-title">${escapeHtml(rowLabel(index))} ${String(hour).padStart(2, '0')}:00</div><b>${runs}</b> ${runs === 1 ? 'run' : 'runs'} started here`),
    },
    series: [{
      id: 'measured-activity', type: 'heatmap', data,
      itemStyle: { borderColor: theme.bg, borderWidth: 1, borderRadius: 2 },
      emphasis: {
        itemStyle: {
          borderColor: theme.ink, borderWidth: 2,
          shadowBlur: 7, shadowColor: withAlpha(theme.ink, theme.dark ? 0.38 : 0.2),
        },
      },
    }],
  })
}

/** What became of each run, as one bar split by outcome. */
export function outcomeOption({ outcomes, theme, ...motion }) {
  if (!outcomes?.ok || !(outcomes.total > 0)) return null
  const tones = { started: 'good', refused: 'serious', unrecorded: 'ink3' }
  const drawn = outcomes.segments.filter(segment => segment.count > 0)
  if (drawn.length === 0) return null
  return mint({
    ...anim(motion),
    backgroundColor: 'transparent',
    grid: { left: 0, right: 0, top: 0, bottom: 0 },
    xAxis: { type: 'value', min: 0, max: Math.max(1, outcomes.total), show: false },
    yAxis: { type: 'category', data: [''], show: false },
    tooltip: {
      ...tipBase(), trigger: 'item',
      formatter: ({ seriesName, value }) => {
        const share = outcomes.total ? (value / outcomes.total) * 100 : 0
        return mtip(`<div class="tt-title">${escapeHtml(seriesName)}</div><b>${whole(value)}</b> of ${whole(outcomes.total)} recorded ${outcomes.total === 1 ? 'run' : 'runs'} · <b>${share.toFixed(1)}%</b>`)
      },
    },
    series: drawn.map((segment, index) => ({
      id: segment.key, name: segment.label, type: 'bar', stack: 'outcome', barWidth: 22,
      data: [segment.count],
      itemStyle: {
        color: theme[tones[segment.key]] || theme.ink3,
        borderColor: theme.bg, borderWidth: 1,
        borderRadius: index === 0 ? [3, 0, 0, 3] : index === drawn.length - 1 ? [0, 3, 3, 0] : 0,
      },
      emphasis: { focus: 'series', itemStyle: { borderColor: theme.sheet, borderWidth: 2 } },
      blur: { itemStyle: { opacity: 0.4 } },
    })),
  })
}

/** Why runs did not start, most common first, counted rather than rated. */
export function refusalOption({ refusals, theme, ...motion }) {
  if (!refusals?.ok || refusals.rows.length === 0) return null
  const rows = refusals.rows.slice(0, 6)
  const ceiling = rows.reduce((high, row) => Math.max(high, row.count), 0)
  return mint({
    ...anim(motion),
    backgroundColor: 'transparent',
    grid: { left: 210, right: 34, top: 6, bottom: 19 },
    xAxis: {
      type: 'value', min: 0, max: Math.max(1, ceiling), minInterval: 1,
      axisLine: { show: false }, axisTick: { show: false },
      splitLine: { lineStyle: { color: theme.grid, width: 1 } },
      axisLabel: { ...axisNumberText(theme, theme.ink3), formatter: (v) => whole(v) },
    },
    yAxis: {
      type: 'category', inverse: true, data: rows.map(row => row.sentence),
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: {
        ...axisText(theme, theme.ink2), fontWeight: 500, margin: 10,
        width: 190, overflow: 'truncate', ellipsis: '…',
      },
    },
    tooltip: {
      ...tipBase(), trigger: 'item',
      formatter: ({ name, value }) => mtip(
        `<div class="tt-title">${escapeHtml(name)}</div><b>${whole(value)}</b> ${value === 1 ? 'run' : 'runs'} did not start`),
    },
    series: [{
      id: 'measured-refusals', type: 'bar', barWidth: 14,
      data: rows.map(row => row.count),
      itemStyle: { color: theme.serious, borderRadius: [0, 3, 3, 0] },
      showBackground: true,
      backgroundStyle: { color: theme.track, borderRadius: 2 },
      label: {
        show: true, position: 'right', distance: 6,
        color: theme.ink2, fontSize: 12.5, fontWeight: 600, fontFamily: theme.mono,
        formatter: ({ value }) => whole(value),
      },
      emphasis: { focus: 'series' },
      blur: { itemStyle: { opacity: 0.24 } },
    }],
  })
}

/** The rate: tokens per bucket, said in tokens because money is not measured. */
export function burnOption({ bands, window, theme, ...motion }) {
  if (!bands?.ok) return null
  return mint({
    ...anim(motion),
    backgroundColor: 'transparent',
    grid: { left: 8, right: 8, top: 28, bottom: 22 },
    xAxis: {
      type: 'category', boundaryGap: false, data: window.buckets.map(bucket => bucket.label),
      axisLine: { show: true, lineStyle: { color: theme.grid, width: 1 } },
      axisTick: { show: false },
      axisLabel: {
        ...axisNumberText(theme, theme.ink3), interval: 0, margin: 8,
        formatter: (value, index) => (index % window.every === 0 ? value : ''),
      },
    },
    yAxis: {
      type: 'value', min: 0,
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { show: false }, splitLine: { show: false },
    },
    tooltip: {
      ...tipBase(), trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: theme.cross, width: 1 } },
      formatter: (params) => {
        const entry = params[0]
        if (!entry) return ''
        const bucket = window.buckets[entry.dataIndex]
        return mtip(`<div class="tt-title">${escapeHtml(bucket?.dateLabel || '')} ${escapeHtml(bucket?.label || '')}</div><b>${whole(entry.value)}</b> tokens · not a cost`)
      },
    },
    series: [{
      id: 'measured-burn', type: 'line',
      data: bands.stacked.slice(),
      showSymbol: true, symbol: 'circle',
      symbolSize: (_, q) => (q.dataIndex === bands.stacked.length - 1 ? 3.5 : 0),
      smooth: 0.34,
      lineStyle: { color: theme.signal, width: 1.4, opacity: 0.78 },
      itemStyle: { color: theme.signal, shadowBlur: 5, shadowColor: withAlpha(theme.signal, theme.dark ? 0.5 : 0.26) },
      areaStyle: {
        color: {
          type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: withAlpha(theme.signal, theme.dark ? 0.1 : 0.055) },
            { offset: 1, color: withAlpha(theme.signal, 0) },
          ],
        },
      },
    }],
  })
}

/* ================= the instances =================
   One lazily-created ECharts instance per host, and every one of them refuses
   an option this file did not mint. `release` is how a panel goes back to being
   a sentence: the instance is disposed and the host emptied, so the honest
   absence is never written on top of a chart that stays behind it. */
export function createLiveCharts({ resolve }) {
  /* key -> { host, instance }. The host is looked up on every draw rather than
     captured once, because two of these panels rebuild their surrounding DOM
     (the outcome bar sits inside a panel that carries its own counts). An
     instance whose host has been replaced is disposed and rebuilt on the new
     element instead of drawing into a node nobody can see. */
  const live = new Map()

  const mounted = (key) => {
    const host = resolve(key)
    if (!host) return null
    const existing = live.get(key)
    if (existing) {
      if (existing.host === host && !existing.instance.isDisposed()) return existing.instance
      if (!existing.instance.isDisposed()) existing.instance.dispose()
      live.delete(key)
    }
    const instance = echarts.init(host, null, { renderer: 'svg' })
    live.set(key, { host, instance })
    return instance
  }

  const api = {
    /** Draw one measured option. Throws on anything this file did not mint. */
    draw(key, option) {
      if (!isMeasuredOption(option)) {
        throw new TypeError(
          `A measured panel (${key}) was handed a chart this computer's own record did not produce. `
          + 'Build the option with a feeder in this module, or leave the panel as the sentence that says it has nothing.',
        )
      }
      const instance = mounted(key)
      if (!instance) return null
      instance.setOption(option, { notMerge: true })
      return instance
    },
    /** Is a chart currently mounted on this host? */
    drawn(key) {
      const entry = live.get(key)
      return Boolean(entry) && entry.host === resolve(key) && !entry.instance.isDisposed()
    },
    /** Give the host back, so a sentence can be written where the chart was. */
    release(key) {
      const entry = live.get(key)
      if (!entry) return
      if (!entry.instance.isDisposed()) entry.instance.dispose()
      live.delete(key)
      entry.host.replaceChildren()
    },
    resize() { for (const entry of live.values()) if (!entry.instance.isDisposed()) entry.instance.resize() },
    dispose() {
      for (const entry of live.values()) if (!entry.instance.isDisposed()) entry.instance.dispose()
      live.clear()
      if (typeof window !== 'undefined' && window.__mcLiveCharts === api) delete window.__mcLiveCharts
    },
    /** What each measured panel actually drew, for a driver to read back. */
    seriesOf(key) {
      const entry = live.get(key)
      if (!entry || entry.instance.isDisposed()) return null
      const option = entry.instance.getOption()
      return (option.series || []).map(series => ({
        id: series.id, name: series.name, type: series.type,
        data: Array.isArray(series.data) ? series.data.slice(0, 64) : null,
      }))
    },
  }

  /* Probe hook, NOT app state -- the same one ../metrics-charts.js exposes and
     for the same reason: a packaged driver has to be able to read the series a
     measured panel actually drew, and the bundled module scope is unreachable
     from the page. Nothing in the product reads it. */
  if (typeof window !== 'undefined') window.__mcLiveCharts = api
  return api
}
