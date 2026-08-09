// Metrics — the Swiss instrument panel. Unboxed: no glass cards, no tile
// grid — whitespace and hairlines do all separation, the homepage's own
// language. Bands top to bottom: filter row · bare stat strip · the
// token-routing sankey promoted to page hero · the token-flow band rebuilt
// as solid stacked Carbon bands with its crosshair-synced failure strip ·
// three bare supporting instruments (heat, verdicts, failure by lane) ·
// pools as bare columns · the unboxed agent table.
//
// The filter row (time range × machine) retargets every chart and TWEENS to
// the new simulated dataset; stats count up; the agent table sorts with a
// FLIP reorder; tooltips cover every mark.
//
// The engine charts render through ECharts — metrics-charts.js owns the
// option builders, echarts-theme.js snapshots the design tokens the engine
// cannot read through var() (including the Carbon categorical / alert /
// sequential re-steps scoped on .metrics). This view still owns the DATA
// (buildData, buildSankey and their deterministic noise) and the DOM
// numbers; the engine owns geometry, morph animation, the crosshair, zoom
// and per-series focus. Stats, pools, sparklines and the agent table stay
// hand-rolled — they were already right.

import '../metrics.css'
import { ticks as d3ticks } from 'd3-array'
import { sim, fmtRuntime } from '../sim.js'
import { ROLES, POOLS, PROVIDERS } from '../vocab.js'
import { el, sparkline, makeTooltip, bindRuntime, attachSeg } from '../components.js'
import { buildTheme } from '../echarts-theme.js'
import { createCharts, createLiveUsageSankey } from '../metrics-charts.js'
import { createMetricsLayout } from '../metrics-layout.js'
import { isLiveView, setLiveView } from '../live-flags.js'
import { fetchMetrics } from '../live-status.js'

const fmtK = (n) => n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'M' : n + 'k'

/* ---------------- small numeric helpers ---------------- */

const N = 24                                  // buckets on the token chart
const clamp = (lo, hi, v) => Math.max(lo, Math.min(hi, v))
const lerp = (a, b, t) => a + (b - a) * t
const easeInOut = (p) => p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2
const HEART_PATTERN = [0, 0.015, 0, 0.07, -0.11, 0.94, -0.34, 0.17, 0.035, 0, 0, 0]
const beatClock = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
})
/* The OS preference counts, not just the Settings toggle.
   Every JS motion gate on the site reads body.reduce-motion, and the only
   writer of that class is the Settings checkbox — the media query never sets
   it. So under prefers-reduced-motion: reduce the CSS half stopped (the
   @media block in styles.css) while the JS half kept running: the tile
   count-up still stepped through 8 intermediate values instead of snapping,
   and every tween ran full length. Read the query directly here so this
   view is honest on its own; the site-wide fix is one line in main.js
   (sync the class from the query OR the checkbox), which is another lane's
   file this wave — this OR matches that semantic exactly, so the two
   compose rather than fight. */
const motionQuery = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null
const reduced = () => document.body.classList.contains('reduce-motion') || !!motionQuery?.matches

/** Stable 0..1 hash noise so a filter combination always regenerates the same shape. */
function noise(key) {
  let h = 2166136261 >>> 0
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619) }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

function smoothArr(a, k) {
  const out = a.slice()
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < out.length; i++) {
      const p = out[Math.max(0, i - 1)], n = out[Math.min(out.length - 1, i + 1)]
      out[i] = out[i] * (1 - k) + ((p + n) / 2) * k
    }
  }
  return out
}

/* The heat ramp machinery that lived here (readHeatRamp / HEAT_STOPS /
   heatShade / the module-level repaint subscriber) is gone: cells are painted
   by the engine's visualMap from the same --heat-0..5 stops, snapshotted by
   buildTheme(), and each mounted view watches data-theme itself — one
   observer per view, disconnected on destroy, instead of a process-lifetime
   one fanning out to subscribers. */

/** Same geometry components.js/sparkline() uses, so the path can be redrawn per frame. */
function sparkGeom(points, w, h) {
  const min = Math.min(...points), max = Math.max(...points)
  const nx = (i) => (i / (points.length - 1)) * (w - 8) + 4
  const ny = (v) => h - 5 - ((v - min) / (max - min || 1)) * (h - 10)
  return {
    d: points.map((v, i) => `${i ? 'L' : 'M'}${nx(i).toFixed(1)} ${ny(v).toFixed(1)}`).join(' '),
    lx: nx(points.length - 1), ly: ny(points[points.length - 1]),
  }
}

/* ---------------- provider series colour ----------------
   PROVIDERS in src/vocab.js carry the same five hexes as ROLES and POOLS, so
   the token chart's bands and the agent table's role dots were literally the
   same cyan/orange/blue/green. Colour has to follow ONE entity. The role and
   pool palettes stay as they are (they are the shell's shared identity
   system); the provider series get their own muted categorical set, defined
   as --prov-* on .metrics in src/metrics.css and resolved through the
   cascade so the black theme can re-step them. p.color is deliberately not
   read here. The fallback keeps a provider added to vocab.js later visible
   rather than transparent. */
const provInk = (id) => `var(--prov-${id}, var(--ink-3))`

/* ---------------- viewport-clamped tooltip ----------------
   makeTooltip() in src/components.js clamps a tip against its CONTAINER's
   right edge and its container's top — never against the window — so at
   1280x800 the pool meter tip, the widest in the app (272 px), flips left
   and lands at x = −44, eating the first ~5 characters of 'northwind21 ·
   subscription'. It is clean at 1920x1080, which is why a container-relative
   clamp looked right.

   This wrapper serves the pool meters and the DOM-native gates timeline; the
   engine charts use appendToBody + confine for the same viewport clamp
   natively, which deleted the tall token-flow case that used to live here.
   The real fix is four lines inside makeTooltip.show, but components.js is
   another lane's file this wave, so this wrapper re-clamps after the shared
   code has positioned the element: same math it uses (container rect +
   offsetWidth/offsetHeight, so the reveal's translateY does not perturb the
   reading), just measured against the window. It is idempotent — when that
   lane lands the same clamp, every branch here becomes a no-op. */
const EDGE = 8
function viewportTooltip(container) {
  const tip = makeTooltip(container)
  const node = container.querySelector(':scope > .tooltip')
  return {
    show(html, x, y) {
      tip.show(html, x, y)
      if (!node) return
      const r = container.getBoundingClientRect()
      const tw = node.offsetWidth, th = node.offsetHeight
      let lx = parseFloat(node.style.left) || 0
      let ly = parseFloat(node.style.top) || 0
      lx = Math.max(EDGE - r.left, Math.min(lx, innerWidth - EDGE - tw - r.left))
      if (r.top + ly + th > innerHeight - EDGE) {
        const above = y - r.top - th - 10                  // flip back above the cursor
        ly = r.top + above >= EDGE ? above : innerHeight - EDGE - th - r.top
      }
      ly = Math.max(EDGE - r.top, ly)
      node.style.left = `${lx}px`
      node.style.top = `${ly}px`
    },
    hide() { tip.hide() },
  }
}

/* ---------------- filter vocabulary ---------------- */

const RANGES = [['24h', '24h'], ['7d', '7d'], ['30d', '30d']]
const MACHINES = [['all', 'All'], ['c1', 'Computer 1'], ['c2', 'Computer 2']]

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/* AXIS RULE, applied everywhere a scale is drawn in this view:
     · continuous QUANTITATIVE domain → d3-array ticks(), which picks the
       canonical 1/2/5×10ⁿ stops. Used for the token chart's y axis, the
       failure chart's x axis, and the '30d' elapsed-time x axis below.
     · clock / weekday BAND axis → that unit's own canonical stops, because
       d3ticks targets continuous domains and would answer 0,5,10,15,20 for a
       24-hour day — not clock stops. Hours therefore step by 6 (00/06/12/18)
       and weekdays label all seven bands.
   The trailing `23` the hour axes used to carry is gone with that: it sat 5
   cells after 18 where every other stop was 6 apart, so the axis metered
   itself irregularly. */
const HOUR_TICKS = [0, 6, 12, 18]
/* '30d' IS continuous (days elapsed), so d3 picks the stops — 30/20/10/0 days
   ago — and each is mapped back to its bucket position. The old rule labelled
   five evenly-spaced buckets with whatever day number they happened to land
   on: −30, −22, −15, −7, now. */
const idxForDaysAgo = (a) => (1 - a / 30) * (N - 1)

const RANGE_META = {
  '24h': {
    word: 'last 24 h', unit: '24 h', prev: 'vs yesterday', days: 1,
    timeline: ['−24 h', '−12 h', 'now'],
    ticks: HOUR_TICKS, xlab: (i) => `${String(Math.round(i)).padStart(2, '0')}:00`,
    failSub: 'rolling 24 h', verdictSub: 'last 24 h', heatSub: 'by hour · 7 days',
    vol: 1, smooth: 0, fail: 1, heat: 1.05, verdicts: 0.16, pool: 0.86, ops: 0.22,
  },
  '7d': {
    word: 'last 7 days', unit: '7 d', prev: 'vs last week', days: 7,
    timeline: ['Mon', 'Thu', 'now'],
    ticks: [0, 4, 8, 12, 16, 20, 23], xlab: (i) => DAYS[Math.round((i / (N - 1)) * 6)],
    failSub: 'rolling 7 days', verdictSub: 'this week', heatSub: 'by hour · 7 days',
    vol: 1.17, smooth: 0.45, fail: 0.88, heat: 1, verdicts: 1, pool: 1, ops: 1,
  },
  '30d': {
    word: 'last 30 days', unit: '30 d', prev: 'vs last month', days: 30,
    timeline: ['−30 d', '−15 d', 'now'],
    ticks: d3ticks(0, 30, 3).slice().reverse().map(idxForDaysAgo),
    xlab: (i) => i >= N - 1 ? 'now' : `−${Math.round((1 - i / (N - 1)) * 30)} d`,
    failSub: 'rolling 30 days', verdictSub: 'this month', heatSub: 'by hour · weekday mean',
    vol: 1.33, smooth: 0.7, fail: 0.79, heat: 0.9, verdicts: 4.1, pool: 1.12, ops: 3.6,
  },
}

const MACHINE_META = {
  all: { share: 1, fail: 1, heat: 1, pool: 1 },
  c1: { share: 0.56, fail: 1.08, heat: 0.86, pool: 0.94 },
  c2: { share: 0.48, fail: 0.9, heat: 0.83, pool: 1.03 },
}

/* ---------------- tile definitions ---------------- */

/* TILE ACCENT — one neutral, not six hues.
   The six dots were drawing from the five ROLE hexes, which the agent table
   500 px below spends on role identity, so a cyan tile dot and a cyan role
   dot claimed a relationship that does not exist. They did not even identify
   within their own row: 'Tasks closed' and 'Checkpoints' were both #00bd8a.
   A tile is already labelled in words, so the dot is a bullet and the
   sparkline's end point is a position marker — neither encodes a category,
   and neither should spend a hue. --tile-mark (metrics.css) is the ink ramp,
   which keeps the end point clearly stronger than the --chart-spark line it
   sits on, on every theme. */
const TILE_MARK = 'var(--tile-mark, currentColor)'

/* Every tile's delta row is a MEASURED comparison, never a caption.
   `period`  — this period's value against the previous equivalent period,
               built by the same generator one period back in the seed
               (buildData(1)); the printed number is (cur − prev).
   `session` — the change observed live since the baseline was taken, printed
               WITH the length of that window so the claim stays true when a
               filter change rebaselines it. Used where the figure comes
               straight off sim state and is therefore identical in both
               periods by construction, so a period delta would be a
               fabricated one.
   `signed`  — colour the row good/bad. Only where direction genuinely means
               better/worse; `false` prints the same signed number in neutral
               ink instead of asserting a judgement the data doesn't carry.
   The previous version printed `+${Math.round(4 + n*18)}%` from a hash of the
   filter name: a plausible-looking number with no relationship to the value
   above it. */
const TILE_DEFS = [
  {
    id: 'agents', l: 'Agents live', spark: true,
    val: (d) => d.tiles.agents, fmt: (v) => String(Math.round(v)),
    unit: (d) => `of ${Math.round(d.tiles.spawned)} spawned`,
    delta: { kind: 'session', noun: 'live', signed: false },
  },
  {
    id: 'tasks', l: 'Tasks closed', spark: true,
    val: (d) => d.tiles.tasksClosed, fmt: (v) => Math.round(v).toLocaleString('en-US'),
    unit: (d, meta) => meta.word.replace('last ', ''),
    delta: { kind: 'period', mode: 'pct', signed: true },
  },
  {
    id: 'fail', l: 'Failure rate', spark: true,
    val: (d) => d.tiles.failAvg, fmt: (v) => v.toFixed(1), unit: () => '%',
    delta: { kind: 'period', mode: 'pts', signed: true, lowerIsBetter: true },
  },
  {
    id: 'tokens', l: 'Token flow', spark: true,
    val: (d) => d.tiles.tokTotal, fmt: (v) => fmtK(Math.round(v)), unit: (d, meta) => meta.unit,
    delta: { kind: 'period', mode: 'pct', signed: false },
  },
  {
    /* spark like the other four: these two were the only tiles without one,
       leaving a 46px hollow that read as half-loaded rather than as a
       different kind of tile */
    id: 'ckpt', l: 'Checkpoints', spark: true,
    val: (d) => d.tiles.checkpoints, fmt: (v) => String(Math.round(v)), unit: () => 'recorded',
    delta: { kind: 'session', noun: 'new', signed: false },
  },
  {
    id: 'gates', l: 'Gate blocks', spark: true,
    val: (d) => d.tiles.gateBlocks, fmt: (v) => String(Math.round(v)), unit: () => 'held · by design',
    delta: { kind: 'session', noun: 'held', signed: false },
  },
]

/* The Discipline counters card is retired with the unboxed redesign: the
   supporting-instrument row is heat · verdicts · failure-by-lane, and the
   two counters the stat strip already carries (checkpoints, gate blocks)
   keep their R.ops scaling below. */

/* ================================================================== */

/* A stable, agent-specific series seeded only from values the sim already
   owns (id, task count, failure rate). The table sparklines used to be
   Array.from({length:10}, () => 20 + Math.random()*60) — fresh noise on
   every repaint, representing nothing, on a page whose header says "live".
   This is deterministic per agent and genuinely reflects its throughput. */
function agentSeries(a) {
  let h = 0
  for (let i = 0; i < a.id.length; i++) h = (h * 31 + a.id.charCodeAt(i)) | 0
  const base = Math.max(2, (a.tasksDone || 0) / 8)
  const out = []
  for (let i = 0; i < 10; i++) {
    h = (h * 1103515245 + 12345) & 0x7fffffff
    const wobble = ((h % 1000) / 1000 - 0.5) * base * 0.5
    out.push(Math.max(0, base + wobble - (a.failRate || 0) * 0.6))
  }
  return out
}

export function metricsView() {
  const liveMode = isLiveView('metrics')
  const m = sim.metrics
  const unsubs = []
  const timers = new Set()
  const after = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn() }, ms); timers.add(t); return t }
  let destroyed = false
  let projection = liveMode ? { ok: false, reason: 'loading projection' } : null

  const state = { range: '24h', machine: 'all', laneFilter: null, editing: false }
  const meta = () => RANGE_META[state.range]

  /* Live metrics deliberately consume only the aggregate facts their
     projection declares. The existing simulation remains intact below and is
     selected by one flag flip; no live branch borrows its series, roster, or
     derived claims from the sim. */
  const LIVE_TILES = [
    { id: 'agents', label: 'Codex sessions', field: 'sessions', key: 'codex', unit: 'observed' },
    { id: 'tasks', label: 'Claude sessions', field: 'sessions', key: 'claude', unit: 'observed' },
    { id: 'fail', label: 'Services', field: 'services', key: 'total', unit: (v) => `${v.stale} stale` },
    { id: 'tokens', label: 'Requests', field: 'requests', key: 'total', unit: 'total' },
    { id: 'ckpt', label: 'Open requests', field: 'requests', key: 'open', unit: 'open' },
    { id: 'gates', label: 'Queue', field: 'queue', key: 'total', unit: (v) => `${v.blocked} blocked · ${v.done} done` },
  ]

  function liveObservation(field) {
    if (!projection?.ok || !projection.data?.data) {
      return { ok: false, reason: projection?.reason || 'projection unavailable', value: null }
    }
    return projection.data.data[field] || { ok: false, reason: 'observation missing from projection', value: null }
  }

  function liveTile(tile) {
    const observation = liveObservation(tile.field)
    const value = observation?.value
    const number = observation?.ok && Number.isFinite(value?.[tile.key]) ? value[tile.key] : null
    return { observation, number, value }
  }

  function liveUsageAttribution() {
    const observation = liveObservation('usageAttribution')
    if (!observation?.ok || !observation.value) {
      return { state: 'unavailable', reason: observation?.reason || 'usage attribution unavailable', value: null }
    }
    if (!['complete', 'empty', 'partial'].includes(observation.state)) {
      return { state: 'unavailable', reason: 'usage attribution state invalid', value: null }
    }
    return { state: observation.state, reason: null, value: observation.value }
  }

  /* This is intentionally shape-free. It lets the shared mount plumbing keep
     its element identities without inventing a chart or a zero while the
     aggregate projection is loading or unavailable. */
  function buildLiveData() {
    return {
      live: true,
      tiles: Object.fromEntries(LIVE_TILES.map(tile => [tile.id, liveTile(tile).number])),
      spark: Object.fromEntries(LIVE_TILES.map(tile => [tile.id, []])),
    }
  }

  /* live-pulse buffer: buckets appended to the command band since the last
     filter settle. Kept OUT of buildData so the settled dataset stays pure
     (tiles, deltas and the sankey all reconcile against the base 24) — the
     charts compose base + extras at option-build time. Capped: past 12
     appends the oldest extra falls off, so a page left open all day cannot
     compress the hero into a ribbon. */
  const liveExtras = []
  let liveN = 0
  const machineName = () => state.machine === 'all'
    ? 'all machines'
    : (sim.computers.find(c => c.id === state.machine)?.name || state.machine)
  const machineSuffix = () => state.machine === 'all' ? '' : ` · ${machineName()}`
  const machineComputers = () => state.machine === 'all'
    ? sim.computers
    : sim.computers.filter(c => c.id === state.machine)

  /* ---------------- machine heartbeat ----------------
     A rolling, data-owned EKG trace for the two simulated machines. Live
     hiccups are derived only from state the sim already exposes: a spawning
     lane or an extreme CPU/network/disk reading. Seed history includes one
     short deterministic held interval per machine so a fresh screenshot
     demonstrates the flatline grammar without waiting for a random walk to
     cross a threshold. */
  const HEART_POINTS = 72
  const HEART_CADENCE = 520
  const HEART_WINDOW_SECONDS = Math.round(((HEART_POINTS - 1) * HEART_CADENCE) / 1000)
  const heartbeatHiccup = (c) => c.agents.some(a => a.state === 'spawning')
    || c.stats.net < 12 || c.stats.cpu > 90 || c.stats.disk > 56
  const heartbeatPoint = (c, machineIndex, sequence, at, forcedHiccup = null) => {
    const hiccup = forcedHiccup ?? heartbeatHiccup(c)
    const phase = (sequence + machineIndex * 3) % HEART_PATTERN.length
    const amplitude = 0.76 + c.stats.cpu * 0.002 + c.stats.net * 0.0008
    const baseline = HEART_PATTERN[phase] === 0
      ? (noise(`${c.id}|heart|${sequence}`) - 0.5) * 0.012
      : 0
    return {
      value: +(hiccup ? 0 : HEART_PATTERN[phase] * amplitude + baseline).toFixed(4),
      at, hiccup,
      beat: !hiccup && phase === 5,
    }
  }
  const heartNow = Date.now()
  const heartbeat = {
    cadence: HEART_CADENCE,
    sequence: HEART_POINTS,
    machines: sim.computers.slice(0, 2).map((c, machineIndex) => {
      const points = []
      let lastBeat = heartNow
      const heldAt = 20 + Math.floor(noise(`${c.id}|heart|held`) * 28)
      for (let i = 0; i < HEART_POINTS; i++) {
        const at = heartNow - (HEART_POINTS - 1 - i) * HEART_CADENCE
        const point = heartbeatPoint(c, machineIndex, i, at, i >= heldAt && i < heldAt + 6)
        if (point.beat) lastBeat = at
        points.push(point)
      }
      return {
        id: c.id, name: c.name, points, lastBeat, hiccup: false,
        holdRemaining: 0, cooldown: machineIndex * 4,
      }
    }),
  }

  /* lane display order is fixed once (severity-descending) so bars can tween in place */
  const LANES = [...m.failureByLane].sort((a, b) => b.rate - a.rate).map(l => l.lane)

  /* .seg is the shared skin + indicator (styles.css / attachSeg); .pill-group
     and .pill stay in the markup as this view's click-delegation hooks. */
  const pillGroup = (name, items, label) => `
    <div class="seg pill-group" data-group="${name}" role="group" aria-label="${label}">
      ${items.map(([id, txt], i) => `<button type="button" class="pill${i === 0 ? ' on' : ''}" data-v="${id}" aria-pressed="${i === 0}">${txt}</button>`).join('')}
    </div>`

  const root = el(`
    <div class="view-pad">
      <div class="metrics">
        <div class="m-filter" id="m-filter">
          <span class="mf-label">Range</span>
          ${pillGroup('range', RANGES, 'Time range')}
          <span class="mf-sep"></span>
          <span class="mf-label">Machine</span>
          ${pillGroup('machine', MACHINES, 'Machine')}
          <span class="spacer"></span>
          <span class="mf-note" id="mf-note">simulated fleet · <i class="live-dot" aria-hidden="true"></i><b>live</b></span>
          <button type="button" class="m-edit-btn" id="m-edit" aria-pressed="false">Edit layout</button>
        </div>
        <div class="m-strip" id="tiles" data-mc="stats"></div>
        <section class="m-sec m-sankey" data-mc="sankey">
          <div class="m-head"><span class="mt">Token routing</span><span class="ms" id="sankey-sub">pools → providers → roles</span></div>
          <div class="echart" id="sankey-chart" role="img" aria-label="Token routing from account pools through providers to agent roles"></div>
        </section>
        <section class="m-sec m-band" data-mc="tokenflow">
          <div class="m-head"><span class="mt">Token flow</span><span class="ms" id="tokens-sub">last 24 h · thousands</span>
            <span class="spacer"></span>
            <span class="chart-legend token-legend"><span class="ck-cap">window totals</span>${PROVIDERS.map(p => `<span class="ck" data-token-provider="${p.id}" style="--kc:${provInk(p.id)}"><i></i><span class="ck-name">${p.label}</span><span class="ck-value">—</span></span>`).join('')}</span>
          </div>
          <div class="echart" id="hero-chart" role="img" aria-label="Token flow by provider, solid stacked bands with wheel zoom"></div>
          <div class="band-cap"><span>failure %</span><span class="bc-note">same window · crosshair synced</span></div>
          <div class="echart" id="strip-chart" role="img" aria-label="Failure percent over the same time axis"></div>
        </section>
        <section class="m-sec" data-mc="heatmap">
          <div class="m-head"><span class="mt">Fleet activity</span><span class="ms" id="heat-sub">by hour · 7 days</span>
            <span class="spacer"></span>
            <span class="heat-key" id="heat-key"></span>
          </div>
          <div class="echart" id="heat-chart" role="img" aria-label="Fleet activity heatmap"></div>
        </section>
        <section class="m-sec" data-mc="verdicts">
          <div class="m-head"><span class="mt">Review verdicts</span><span class="ms" id="verdict-sub">this week</span></div>
          <div id="verdict-chart"></div>
        </section>
        <section class="m-sec" data-mc="lanes">
          <div class="m-head"><span class="mt">Failure by lane</span><span class="ms" id="fail-sub">rolling 24 h</span>
            <span class="spacer"></span>
            <span class="chart-legend">
              <span class="ck" style="--kc:var(--sev-good)"><i></i>&lt; 2%</span>
              <span class="ck" style="--kc:var(--sev-warn)"><i></i>2–5%</span>
              <span class="ck" style="--kc:var(--sev-serious)"><i></i>&gt; 5%</span>
            </span>
          </div>
          <div class="echart" id="fail-chart" role="img" aria-label="Failure rate by lane, percent — click a bar to filter the agent table"></div>
        </section>
        <section class="m-sec m-heartbeat" data-mc="heartbeat">
          <div class="m-head"><span class="mt">Machine heartbeat</span><span class="ms" id="heartbeat-sub">two machines · rolling live signal</span></div>
          <div class="heartbeat-stage">
            ${heartbeat.machines.map((machine, i) => `
              <div class="hb-meta" data-hb="${machine.id}" style="--hb-row:${i}">
                <span class="hb-name"><i aria-hidden="true"></i>${machine.name}</span>
                <span class="hb-last">last beat —</span>
              </div>
              <i class="hb-signal-tip" data-hb-tip="${machine.id}" aria-hidden="true"></i>`).join('')}
            <div class="echart" id="heartbeat-chart" role="img" aria-label="Live EKG-style machine heartbeat traces"></div>
          </div>
        </section>
        <section class="m-sec m-burn" data-mc="burn">
          <div class="m-head"><span class="mt">Pool burn</span><span class="ms" id="burn-sub">last 24 h · per machine-day</span></div>
          <div class="burn-stage">
            ${POOLS.slice(0, 2).map((pool, i) => `
              <div class="burn-meta" data-burn="${pool.id}" style="--burn-row:${i}">
                <div class="burn-line"><span class="burn-name">${pool.id}</span><span class="burn-rate">—</span></div>
                <div class="burn-figure">—</div>
              </div>`).join('')}
            <div class="echart" id="burn-chart" role="img" aria-label="Spend rate for the two active account pools"></div>
          </div>
        </section>
        <section class="m-sec m-gates" data-mc="gates">
          <div class="m-head"><span class="mt">Gates &amp; checkpoints</span><span class="ms" id="gates-sub">last 24 h · event log</span><span class="spacer"></span><span class="gate-counts" id="gate-counts"></span></div>
          <div class="gate-stage">
            <div class="gate-track" role="list" aria-label="Checkpoint and gate events over the selected range"></div>
            <div class="gate-axis-labels"><span></span><span></span><span></span></div>
            <div class="gate-legend" aria-hidden="true">
              <span><i class="is-checkpoint"></i>checkpoint</span>
              <span><i class="is-open"></i>open</span>
              <span><i class="is-held"></i>held</span>
            </div>
          </div>
        </section>
        <div class="m-row m-pools" id="pools" data-mc="pools"></div>
        <section class="m-sec m-agents" data-mc="agents">
          <div class="m-head"><span class="mt">Agents</span><span class="ms" id="table-sub">all machines · live</span>
            <span class="spacer"></span>
            <button type="button" class="lane-clear" id="lane-clear" hidden></button>
          </div>
          <div style="overflow-x:auto"><table class="mtable" id="agent-table"></table></div>
        </section>
      </div>
    </div>
  `)
  const metricsSurface = root.querySelector('.metrics')
  root.dataset.liveMode = liveMode ? 'live' : 'simulated'
  metricsSurface.dataset.liveMode = liveMode ? 'live' : 'simulated'
  if (!liveMode) root.dataset.projectionState = metricsSurface.dataset.projectionState = 'simulated'

  /* ================= layout customization =================
     The registry: each band is a movable module. `full` must span the
     column; `slot` can share a row up to 3-up. tokenflow is ONE component
     (hero + synced failure strip) — the crosshair sync is their point, so
     they move as a unit. pools clamps to 2-up: measured at 1280, a 3-up
     pools column is ~360px, and even the slim single-column card stack
     cannot hold "$xx.xx of $300 left" beside its caption without clipping.
     The engine only moves DOM nodes — every echarts instance rides its
     element, and onArrange resizes them in place (verified: reparenting
     an initialized instance keeps series state, connect groups and the
     view's ResizeObserver subscriptions — element identity never changes). */
  const layout = createMetricsLayout({
    container: root.querySelector('.metrics'),
    filterRow: root.querySelector('#m-filter'),
    editBtn: root.querySelector('#m-edit'),
    components: [
      { id: 'stats', title: 'Stats', el: root.querySelector('[data-mc="stats"]'), size: 'full' },
      { id: 'sankey', title: 'Token routing', el: root.querySelector('[data-mc="sankey"]'), size: 'full' },
      { id: 'tokenflow', title: 'Token flow', el: root.querySelector('[data-mc="tokenflow"]'), size: 'full' },
      { id: 'heatmap', title: 'Fleet activity', el: root.querySelector('[data-mc="heatmap"]'), size: 'slot', weight: 1.25 },
      { id: 'verdicts', title: 'Review verdicts', el: root.querySelector('[data-mc="verdicts"]'), size: 'slot' },
      { id: 'lanes', title: 'Failure by lane', el: root.querySelector('[data-mc="lanes"]'), size: 'slot' },
      { id: 'pools', title: 'Account pools', el: root.querySelector('[data-mc="pools"]'), size: 'slot', maxShare: 2, slimClass: 'm-pools--slim' },
      { id: 'agents', title: 'Agents', el: root.querySelector('[data-mc="agents"]'), size: 'full' },
      { id: 'heartbeat', title: 'Machine heartbeat', el: root.querySelector('[data-mc="heartbeat"]'), size: 'slot', optional: true },
      { id: 'burn', title: 'Pool burn', el: root.querySelector('[data-mc="burn"]'), size: 'slot', optional: true },
      { id: 'gates', title: 'Gates & checkpoints', el: root.querySelector('[data-mc="gates"]'), size: 'slot', optional: true },
    ],
    standard: [['stats'], ['sankey'], ['tokenflow'], ['heatmap', 'verdicts', 'lanes'], ['pools'], ['agents']],
    reduced,
    onEditChange: (on) => {
      state.editing = on
      /* exiting edit un-pauses the page: one drift retarget resumes the
         breathing the pulse gate held back (the pulse chain itself never
         stopped scheduling — it just skipped appends) */
      if (!on && charts) retarget(420)
    },
    /* moving a component reparents live echarts hosts — resize every
       instance in place; dispose/rebuild measured unnecessary (report) */
    onArrange: () => {
      charts?.resize()
      if (!charts) return
      syncOptionalChrome()
      if (componentPlaced('heartbeat')) {
        syncHeartbeatMeta()
        moveHeartbeatTips()
        charts.updateHeartbeat({
          heartbeat, theme, dur: 0, entrance: false, reduced: reduced(), machine: state.machine,
        })
      }
      if (componentPlaced('burn')) {
        applyBurn(target)
        charts.updateBurn({
          d: target, R: meta(), theme, dur: 0, entrance: false, reduced: reduced(),
        })
      }
      if (componentPlaced('gates')) applyTimeline(target)
    },
  })
  unsubs.push(() => layout.destroy())

  /* ================= dataset generation ================= */

  function buildBurn(pools, key, R) {
    /* The selected range and selected machines define the observed exposure
       in machine-days. That denominator already belongs to the page (rather
       than inventing an account age from a caption), and keeps the figure
       legible immediately after a fresh sim boot: two machines over 24 h =
       two observed machine-days. Each displayed runway is then exactly
       remaining / the mean of the visible rate samples. */
    const machineDays = Math.max(0.25, R.days * Math.max(1, machineComputers().length))
    const vertexTotal = m.spend.vertexTotal
    const defs = [
      { id: 'northwind21', label: 'subscription seat', kind: 'percent', total: 100, used: pools[0], window: 'seat window, resets monthly' },
      { id: 'northwind95', label: 'vertex trial', kind: 'currency', total: vertexTotal, used: vertexTotal * pools[1] / 100 },
    ]
    const rows = defs.map((def) => {
      const pace = Math.max(0.01, def.used / machineDays)
      const raw = Array.from({ length: 18 }, (_, i) =>
        pace * (0.72 + 0.56 * noise(`${key}|burn|${def.id}|${i}`)))
      const series = smoothArr(raw, 0.58).map(v => +Math.max(0.01, v).toFixed(3))
      const recent = series.slice(-6)
      const rate = recent.reduce((sum, v) => sum + v, 0) / recent.length
      const remaining = Math.max(0, def.total - def.used)
      /* A percent seat quota is a resetting window, not a depleting asset.
         Only the true dollar budget gets remaining/rate runway math. */
      const runway = def.kind === 'currency' && rate ? remaining / rate : null
      return { ...def, remaining, rate, runway, series }
    })
    return { rows, machineDays }
  }

  function buildTimeline(tiles, key, R) {
    const checkpointTotal = Math.max(0, Math.round(tiles.checkpoints))
    const gateTotal = Math.max(0, Math.round(tiles.gateBlocks))
    /* The summary and the marks are the same population. The former sqrt/
       max caps turned 14 checkpoints into six dots, so a cold read could
       never reconcile the stated count with the strip. */
    const checkpointMarks = checkpointTotal
    const gateMarks = gateTotal
    const order = []
    let ci = 0, gi = 0
    while (ci < checkpointMarks || gi < gateMarks) {
      if (ci < checkpointMarks) order.push({ kind: 'checkpoint', ordinal: ci++ })
      if (gi < gateMarks) order.push({ kind: 'gate', ordinal: gi++ })
    }
    /* Events are recorded at bucket precision, so up to three may share one
       time-x. Give every colliding event its own row instead of painting the
       last one over the first; ceil(count / 3) keeps the beeswarm to exactly
       the strip's three available rows. */
    const slotCount = Math.max(1, Math.ceil(order.length / 3))
    const events = order.map((event, i) => {
      const slot = Math.floor(i / 3)
      const at = clamp(0.035, 0.965, (slot + 1) / (slotCount + 1))
      const row = i % 3
      if (event.kind === 'checkpoint') {
        const number = Math.max(1, checkpointTotal - checkpointMarks + event.ordinal + 1)
        return {
          ...event, at, row, atLabel: R.xlab(at * (N - 1)),
          label: `Checkpoint ${number}`, state: 'recorded', level: 'checkpoint',
        }
      }
      const number = Math.max(1, gateTotal - gateMarks + event.ordinal + 1)
      const held = (event.ordinal + gateTotal) % 2 === 0
      const level = held && noise(`${key}|event|severity|${event.ordinal}`) > 0.68 ? 'serious' : held ? 'held' : 'open'
      return {
        ...event, at, row, atLabel: R.xlab(at * (N - 1)), held,
        label: `Gate ${number}`, state: 'resolved', level,
      }
    }).sort((a, b) => a.at - b.at)
    /* A current hold is the latest held gate in the selected event data.
       Earlier held marks explicitly say they resolved; the current one gets
       its own persistent halo and supplies the caption count. */
    const heldEvents = events.filter(event => event.kind === 'gate' && event.held)
    heldEvents.forEach((event, i) => {
      event.ongoing = i === heldEvents.length - 1
      event.state = event.ongoing ? 'still held' : 'resolved after hold'
    })
    const ongoingTotal = events.filter(event => event.ongoing).length
    return { checkpointTotal, gateTotal, ongoingTotal, events }
  }

  /* `back` shifts the seed one equivalent period into the past, so the tile
     delta rows can print a comparison the generator actually produced rather
     than a decorative string. Same range, same machine, same live sim
     figures — only the period differs, which is exactly what "vs last week"
     claims to be measuring. */
  function buildData(back = 0) {
    const key = `${state.range}|${state.machine}${back ? `|back${back}` : ''}`
    const R = meta(), M = MACHINE_META[state.machine]

    /* token flow — 24 buckets whatever the range, so shapes can interpolate */
    const tokens = {}
    for (const p of PROVIDERS) {
      const base = m.tokensByProvider[p.id]
      let a = base.map((v, i) => v * M.share * R.vol * (0.74 + 0.52 * noise(`${key}|tok|${p.id}|${i}`)))
      if (R.smooth) a = smoothArr(a, R.smooth)
      tokens[p.id] = a.map(v => Math.max(2, v))
    }
    let peak = 0
    for (let i = 0; i < N; i++) peak = Math.max(peak, PROVIDERS.reduce((s, p) => s + tokens[p.id][i], 0))
    // d3-array picks human-canonical ticks (1/2/5 x 10^n). The old rule
    // (round the peak up to a multiple of 50, then cut it in four) printed
    // labels that were NOT the gridline's value whenever tokMax/50 was odd —
    // e.g. peak 42 rendered "0,13,25,38,50" for true stops 0,12.5,25,37.5,50.
    // Count 4, not 5: the redesign holds the hero to at most ~5 printed
    // y labels (screenshot-measured: 5 landed 8 lines at a 350 peak).
    const tokTicks = d3ticks(0, Math.max(50, peak * 1.06), 4)
    // The axis ceiling is the next STEP MULTIPLE above the padded peak, not
    // the raw padded peak: the engine labels its axis max, so a non-multiple
    // ceiling printed the float itself (measured: "332.4637058685107") where
    // the hand-rolled chart just left it as silent headroom. Rounding the
    // ceiling up keeps "the label IS the gridline" true for every line, top
    // included.
    const tokStep = tokTicks.length > 1 ? tokTicks[1] - tokTicks[0] : 50
    const tokMax = Math.max(tokTicks[tokTicks.length - 1],
      Math.ceil(Math.max(50, peak * 1.06) / tokStep) * tokStep)
    const tokTotal = PROVIDERS.reduce((s, p) => s + tokens[p.id].reduce((a, b) => a + b, 0), 0)

    /* failure rates (live sim drift is the base, so bars keep breathing) */
    const fail = LANES.map(lane => {
      const live = m.failureByLane.find(l => l.lane === lane)
      const j = 0.82 + 0.36 * noise(`${key}|fail|${lane}`)
      return { lane, rate: clamp(0.2, 9.9, live.rate * R.fail * M.fail * j) }
    })
    const failAvg = fail.reduce((s, f) => s + f.rate, 0) / fail.length

    /* the band strip: failure-% over the hero's 24 buckets, seeded from the
       same live lane rates the bars draw (failAvg carries the sim drift), so
       the strip's level and the bars' centre of mass always agree */
    const failSeries = smoothArr(
      Array.from({ length: N }, (_, i) =>
        clamp(0.2, 9.9, failAvg * (0.55 + 0.9 * noise(`${key}|fs|${i}`)))), 0.35)

    /* activity heat */
    const heat = m.heat.map((row, d) => row.map((v, h) =>
      clamp(0, 1, v * R.heat * M.heat * (0.74 + 0.54 * noise(`${key}|heat|${d}|${h}`)))))

    /* verdicts */
    const vs = R.verdicts * M.share
    const v = m.verdicts
    const verdicts = {
      accept: Math.max(1, v.accept * vs * (0.93 + 0.14 * noise(`${key}|va`))),
      retry: Math.max(1, v.retry * vs * (0.88 + 0.26 * noise(`${key}|vr`))),
      reject: Math.max(1, v.reject * vs * (0.9 + 0.22 * noise(`${key}|vj`))),
    }

    /* account pools */
    const vertexUsed = ((m.spend.vertexTotal - m.spend.vertexRemaining) / m.spend.vertexTotal) * 100
    const pf = R.pool * M.pool
    const pools = [
      clamp(3, 99, m.spend.subSeatPct * pf),
      clamp(3, 99, vertexUsed * pf),
      clamp(1, 99, m.spend.uniPct * pf * (state.range === '30d' ? 1.7 : 1)),
    ]

    /* the ops scale still feeds two stat-strip counters below */
    const os = R.ops * M.share

    const comps = machineComputers()
    const agents = comps.reduce((s, c) => s + c.agents.length, 0)
    const spawned = comps.reduce((s, c) => s + c.spawnedTotal, 0)
    const tiles = {
      agents, spawned,
      tasksClosed: verdicts.accept + verdicts.reject,
      failAvg,
      tokTotal,
      checkpoints: m.checkpoints * os,
      gateBlocks: m.gateBlocks * os,
    }
    const burn = buildBurn(pools, key, R)
    const timeline = buildTimeline(tiles, key, R)

    const sparkFor = (name, end) => {
      const pts = []
      for (let i = 0; i < 11; i++) {
        pts.push(Math.max(0.01, end * (0.52 + 0.55 * noise(`${key}|sp|${name}|${i}`)) * (0.72 + 0.28 * (i / 10))))
      }
      pts.push(Math.max(0.01, end))
      return pts
    }
    const spark = {
      agents: sparkFor('agents', tiles.agents),
      tasks: sparkFor('tasks', tiles.tasksClosed),
      fail: sparkFor('fail', tiles.failAvg),
      tokens: sparkFor('tokens', tiles.tokTotal / 24),
      ckpt: sparkFor('ckpt', tiles.checkpoints),
      gates: sparkFor('gates', tiles.gateBlocks),
    }

    return {
      tokens, tokMax, tokTicks, tokTotal, fail, failSeries, heat, verdicts,
      pools, tiles, spark, burn, timeline, sankey: buildSankey(tokens, pools),
    }
  }

  /* ---------------- token routing (sankey data) ----------------
     Flows are DERIVED, never invented: provider column totals are the exact
     sums of the token chart's own series (so the sankey's grand total equals
     the Token-flow tile by construction), and each provider's split across
     pools and roles is weighted by its own agents' throughput series — the
     same agentSeries the table sparklines draw. Nothing new is asserted;
     the diagram only re-arranges numbers already on the page. */
  const ROLE_ORDER = ['coordinator', 'helper', 'shadow', 'manager', 'default']
  const provOf = (a) => a.model.startsWith('gemini') ? 'gemini'
    : a.model === 'local' ? 'local'
    : a.model.startsWith('fable') ? 'claude' : 'codex'

  function buildSankey(tokens, pools) {
    const agents = machineComputers().flatMap(c => c.agents)
    const meanW = (a) => { const s = agentSeries(a); return s.reduce((x, y) => x + y, 0) / s.length }

    const links = []
    const poolFlow = {}          // poolId -> provider label -> value
    const roleFlow = {}          // roleKey -> value per provider handled inline
    const rolesSeen = new Set()

    for (const p of PROVIDERS) {
      const total = tokens[p.id].reduce((a, b) => a + b, 0)
      const mine = agents.filter(a => provOf(a) === p.id)
      let wsum = 0
      const byPool = {}, byRole = {}
      for (const a of mine) {
        const w = meanW(a); wsum += w
        byPool[a.pool] = (byPool[a.pool] || 0) + w
        byRole[a.role] = (byRole[a.role] || 0) + w
      }
      /* every current agent on a provider can be reaped between drifts; the
         flow must not vanish with them — fall back to the sub pool and the
         default role rather than dropping a column total */
      if (!wsum) { byPool.northwind21 = 1; byRole.default = 1; wsum = 1 }

      /* university carve-out: north005 spawns no compute lanes, so no agent
         weight ever routes it — but its pool card reports a small used-%
         (SSO checks riding the local lane), and that same page number is the
         share drawn here. Carved out of the subscription pool's local flow
         so the three totals stay conserved. */
      if (p.id === 'local' && byPool.northwind21) {
        const uni = clamp(0.01, 0.2, pools[2] / 100)
        const carve = wsum * uni
        byPool.northwind21 = Math.max(0.001, byPool.northwind21 - carve)
        byPool.north005 = (byPool.north005 || 0) + carve
        wsum = Object.values(byPool).reduce((a, b) => a + b, 0)
      }

      for (const [pool, w] of Object.entries(byPool)) {
        poolFlow[pool] = poolFlow[pool] || {}
        poolFlow[pool][p.label] = (poolFlow[pool][p.label] || 0) + total * (w / wsum)
      }
      const rsum = Object.values(byRole).reduce((a, b) => a + b, 0)
      for (const [role, w] of Object.entries(byRole)) {
        rolesSeen.add(role)
        links.push({ source: p.label, target: ROLES[role].label, value: total * (w / rsum) })
      }
    }
    for (const pool of Object.keys(poolFlow)) {
      for (const [prov, v] of Object.entries(poolFlow[pool])) {
        links.unshift({ source: pool, target: prov, value: v })
      }
    }

    const providerTotals = Object.fromEntries(PROVIDERS.map(p => [
      p.id, tokens[p.id].reduce((sum, value) => sum + value, 0),
    ]))
    const nodes = [
      /* pools keep POOLS' declared order; a pool with zero routed flow this
         instant is omitted (a zero-height bar with a floating label reads as
         a rendering bug, not as "dormant") */
      ...POOLS.filter(p => poolFlow[p.id]).map(p => ({
        name: p.id, depth: 0, kind: 'pool',
        routed: Object.values(poolFlow[p.id]).reduce((sum, value) => sum + value, 0),
      })),
      ...PROVIDERS.map(p => ({
        name: p.label, depth: 1, kind: 'prov', ref: p.id, routed: providerTotals[p.id],
      })),
      /* role hexes are the shell's fixed identity system (identical across
         themes — the table dots inline them), so they may travel with the
         data; pool/provider colours resolve from the theme snapshot at
         option-build time instead */
      ...ROLE_ORDER.filter(r => rolesSeen.has(r))
        .map(r => ({ name: ROLES[r].label, depth: 2, kind: 'role', color: ROLES[r].hex })),
    ]
    return { nodes, links }
  }

  /* Interpolates only what the rAF tween still paints: DOM numbers and the
     tile sparklines. The chart keys (tokens/tokMax/tokTicks/fail/heat) left
     with the hand-rolled charts — the engine tweens its own shapes from one
     settled dataset to the next, which also retired the tokTicks-blackout
     carry this function used to need. verdicts stays: the hero number,
     legend counts and vfoot rows are DOM and still ride these frames. */
  function lerpData(a, b, t) {
    const L = (x, y) => lerp(x, y, t)
    const arr = (x, y) => x.map((v, i) => L(v, y[i]))
    const obj = (x, y) => Object.fromEntries(Object.keys(x).map(k => [k, L(x[k], y[k])]))
    return {
      verdicts: obj(a.verdicts, b.verdicts),
      pools: arr(a.pools, b.pools),
      tiles: obj(a.tiles, b.tiles),
      spark: Object.fromEntries(Object.keys(a.spark).map(k => [k, arr(a.spark[k], b.spark[k])])),
    }
  }

  let current = liveMode ? buildLiveData() : buildData()
  let target = current
  let prevPeriod = liveMode ? current : buildData(1) // the same period, one period back
  let sessionBase = null                 // tile values at mount / last filter change

  /* ================= tiles ================= */

  const tilesEl = root.querySelector('#tiles')
  const tileRefs = []

  function buildTiles() {
    tilesEl.innerHTML = ''
    for (const t of TILE_DEFS) {
      /* a bare figure, not a card: 11px caps label above, big tabular value,
         the measured delta line, the sparkline glyph under — no box, no
         fill, no bullet dot (the label already identifies the figure) */
      const tile = el(`
        <div class="stat" data-tile="${t.id}">
          <div class="tl">${t.l}</div>
          <div class="tv"><span class="tvn">—</span><span class="unit"></span></div>
          <div class="td flat"></div>
        </div>
      `)
      const ref = { def: t, el: tile, label: tile.querySelector('.tl'), num: tile.querySelector('.tvn'), unit: tile.querySelector('.unit'), tv: tile.querySelector('.tv'), delta: tile.querySelector('.td') }
      if (t.spark) {
        const svg = sparkline({ points: [1, 2, 3], color: TILE_MARK })
        const tip = svg.querySelector('circle')
        tip.setAttribute('class', 'spark-tip')
        const halo = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
        halo.setAttribute('class', 'spark-halo')
        halo.setAttribute('r', '5.5')
        halo.setAttribute('fill', TILE_MARK)
        svg.insertBefore(halo, tip)
        tile.appendChild(svg)
        ref.path = svg.querySelector('path')
        ref.tip = tip
        ref.halo = halo
      }
      tilesEl.appendChild(tile)
      tileRefs.push(ref)
    }
  }

  function applyLiveTiles() {
    for (const ref of tileRefs) {
      const tile = LIVE_TILES.find(item => item.id === ref.def.id)
      if (!tile) continue
      const { observation, number, value } = liveTile(tile)
      const unavailable = number == null
      ref.label.textContent = tile.label
      ref.el.classList.toggle('projection-unavailable', unavailable)
      ref.num.textContent = unavailable ? '—' : Math.round(number).toLocaleString('en-US')
      ref.unit.textContent = unavailable
        ? 'unavailable'
        : (typeof tile.unit === 'function' ? tile.unit(value) : tile.unit)
      ref.delta.textContent = unavailable
        ? `unavailable · ${observation.reason || 'projection unavailable'}`
        : 'aggregate projection · no series'
      ref.delta.className = `td flat${unavailable ? ' projection-unavailable' : ''}`
      /* A sparkline asserts a sequence. The aggregate contract supplies none,
         so preserve this protected stat-strip DOM while clearing its path. */
      ref.path?.setAttribute('d', '')
      ref.tip?.setAttribute('opacity', '0')
      ref.halo?.setAttribute('opacity', '0')
    }
  }

  /* Units and sparklines still ride the page tween's frames; the NUMBER does
     not — tickTileNums below owns it. Two writers on one text node meant the
     tween's 780ms count could overwrite the tick's 300ms count mid-flight,
     and the slower writer always won the last frame. One owner per readout. */
  function applyTiles(d) {
    if (liveMode) { applyLiveTiles(); return }
    const R = meta()
    for (const ref of tileRefs) {
      ref.unit.textContent = ref.def.unit(d, R)
      if (ref.path) {
        const g = sparkGeom(d.spark[ref.def.id], 150, 34)
        ref.path.setAttribute('d', g.d)
        ref.tip.setAttribute('cx', g.lx.toFixed(1)); ref.tip.setAttribute('cy', g.ly.toFixed(1))
        ref.halo.setAttribute('cx', g.lx.toFixed(1)); ref.halo.setAttribute('cy', g.ly.toFixed(1))
      }
    }
  }

  /* Only failure rate has an absolute site-wide verdict. Keep the class on
     the value wrapper so the number itself uses the same text-safe severity
     steps as the agent table; the percent unit remains in the quiet register. */
  function paintTileValue(ref, value) {
    ref.num.textContent = ref.def.fmt(value)
    if (liveMode || ref.def.id !== 'fail') return
    const cls = value < 2 ? 'fail-ok' : value <= 5 ? 'fail-warn' : 'fail-bad'
    if (ref.failCls === cls) return
    if (ref.failCls) ref.tv.classList.remove(ref.failCls)
    ref.tv.classList.add(cls)
    ref.failCls = cls
  }

  /* Number craft: a ~300ms count on the value itself, engine-free (plain
     rAF), one atomic textContent swap per frame — never two glyphs blended
     or overlapped, so the readout is a legal reading at every instant (the
     rail badge lesson: decorative motion must not make a readout lie).
     reduced() snaps to the final value in one swap. */
  function tickTileNums(next) {
    if (liveMode) { applyLiveTiles(); return }
    for (const ref of tileRefs) {
      const to = ref.def.val(next)
      const from = ref.lastVal ?? 0
      ref.lastVal = to
      ref.cancelTick?.()
      if (reduced() || from === to) { paintTileValue(ref, to); continue }
      const t0 = performance.now()
      let raf = 0
      const step = (now) => {
        const p = Math.min(1, (now - t0) / 300)
        const e = 1 - Math.pow(1 - p, 3)                // out-cubic, settles quietly
        paintTileValue(ref, from + (to - from) * e)
        if (p < 1) raf = requestAnimationFrame(step)
      }
      raf = requestAnimationFrame(step)
      ref.cancelTick = () => cancelAnimationFrame(raf)
    }
  }

  /** Count-up cue: flash the tile value + ping the sparkline tip when a target moves. */
  function pulseTiles(prev, next) {
    for (const ref of tileRefs) {
      const a = ref.def.val(prev), b = ref.def.val(next)
      if (Math.abs(b - a) < Math.max(0.05, Math.abs(a) * 0.002)) continue
      ref.tv.classList.remove('bump')
      void ref.tv.offsetWidth
      ref.tv.classList.add('bump')
      after(() => ref.tv.classList.remove('bump'), 620)
      if (ref.halo) {
        ref.halo.classList.remove('ping')
        void ref.halo.getBoundingClientRect()
        ref.halo.classList.add('ping')
        after(() => ref.halo.classList.remove('ping'), 850)
      }
    }
  }

  function captureSessionBase(d) {
    sessionBase = { at: Date.now(), vals: Object.fromEntries(TILE_DEFS.map(t => [t.id, t.val(d)])) }
  }

  /* `−` is U+2212, not a hyphen: it is the same width as `+` in tabular
     figures, so a delta row does not shift when its sign flips. */
  const signed = (v, digits = 0) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(digits)}`

  /** Delta rows, measured. `d` is the settled dataset the tiles are heading to. */
  function applyTileDeltas(d) {
    if (liveMode) return
    const R = meta()
    for (const ref of tileRefs) {
      const spec = ref.def.delta
      const now = ref.def.val(d)
      let text, cls = 'flat'

      if (spec.kind === 'period') {
        const then = ref.def.val(prevPeriod)
        if (spec.mode === 'pts') {
          const diff = now - then
          text = Math.abs(diff) < 0.05
            ? `level ${R.prev}`
            : `${signed(diff, 1)} pts ${R.prev}`
          if (spec.signed && Math.abs(diff) >= 0.05) {
            const better = spec.lowerIsBetter ? diff < 0 : diff > 0
            cls = better ? 'up' : 'down'
          }
        } else {
          const pct = then ? ((now - then) / then) * 100 : 0
          text = Math.abs(pct) < 0.5
            ? `steady ${R.prev}`
            : `${signed(pct)}% ${R.prev}`
          if (spec.signed && Math.abs(pct) >= 0.5) cls = pct > 0 ? 'up' : 'down'
        }
      } else {
        /* Nothing to diff until the first settled dataset lands, and a filter
           change rebaselines — otherwise switching machines would report the
           difference between two fleets as if agents had spawned. */
        if (!sessionBase) {
          /* Before the first settled dataset there is genuinely nothing to
             diff, and the old wording said so in the least legible way it
             could: three tiles reading "no change · 0s" at once, which is a
             true statement that looks exactly like a stalled widget. Name the
             state instead — the number above is the reading, this is the note
             that a comparison does not exist yet. */
          text = `session baseline`
        } else {
          /* "this session", not an elapsed count. The count was a stuck clock:
             this caption is only re-rendered when the tile's VALUE changes, so
             on a metric that is holding steady — which is exactly the metric
             showing this branch — the number froze at whatever it read on the
             last update. Sampled at 0.6s / 2.4s / 4.2s after load it went
             0s, 2s, 2s. A frozen timer is worse than no timer: it invites the
             reader to trust a number that stopped being true, and the tile
             already carries its own live reading directly above. */
          const base = sessionBase.vals[ref.def.id]
          const n = Math.round(now - base)
          text = n === 0 ? `no change · this session` : `${signed(n)} ${spec.noun} · this session`
          if (spec.signed && n !== 0) cls = n > 0 ? 'up' : 'down'
        }
      }

      ref.delta.textContent = text
      ref.delta.className = `td ${cls}`
    }
  }

  /* ================= account pools ================= */

  const poolsEl = root.querySelector('#pools')
  const poolRefs = []

  function buildPools() {
    poolsEl.innerHTML = ''
    POOLS.forEach((p) => {
      /* p.color / p.glow are deliberately NOT read (same rule the provider
         series follow above): POOLS in src/vocab.js carries the ROLE hexes
         verbatim — northwind21 IS the Coordinator dot, northwind95 the
         Manager, north005 the Shadow Manager — and both sets are on screen
         in one scroll. Colour follows one entity; a pool card is identified
         by its mono account name and its kind badge, so it takes the single
         neutral --pool-accent and the collision is gone by construction.
         The fill is scaleX, not width: see .metrics .meter .mf. */
      const card = el(`
        <div class="pool" style="--pc:var(--pool-accent)">
          <div class="pool-head"><span class="pn">${p.id}</span><span class="pt">${p.kind}</span></div>
          <div class="pool-sub">${p.desc}</div>
          <div class="meter"><div class="mf" style="transform:scaleX(0)"></div></div>
          <div class="meter-caption"><b>0% used</b><span class="pcap"></span></div>
          <div class="pool-stats">
            <div class="pool-stat"><div class="v pa">—</div><div class="l">active</div></div>
            <div class="pool-stat"><div class="v pb">—</div><div class="l">window</div></div>
            <div class="pool-stat"><div class="v pc">—</div><div class="l">mode</div></div>
          </div>
        </div>
      `)
      poolsEl.appendChild(card)
      const tip = viewportTooltip(card)
      const meter = card.querySelector('.meter')
      const ref = {
        pool: p, el: card, meter,
        fill: card.querySelector('.mf'),
        pct: card.querySelector('.meter-caption b'),
        cap: card.querySelector('.pcap'),
        a: card.querySelector('.pa'), b: card.querySelector('.pb'), c: card.querySelector('.pc'),
        tipText: '',
      }
      meter.addEventListener('pointermove', (e) => tip.show(ref.tipText, e.clientX, e.clientY))
      meter.addEventListener('pointerleave', () => tip.hide())
      poolRefs.push(ref)
    })
  }

  function applyPools(d) {
    const comps = machineComputers()
    poolRefs.forEach((ref, i) => {
      const pct = d.pools[i]
      /* composited: scaleX on a full-width fill, never an animated width */
      ref.fill.style.transform = `scaleX(${(pct / 100).toFixed(4)})`
      ref.pct.textContent = `${Math.round(pct)}% used`
      const lanes = comps.reduce((s, c) => s + c.agents.filter(x => x.pool === ref.pool.id).length, 0)
      if (i === 0) {
        ref.cap.textContent = 'seat + CLI quota'
        ref.a.textContent = `${lanes} lanes`; ref.b.textContent = `${Math.round(pct)}% seat`; ref.c.textContent = '3 surfaces'
        ref.tipText = `<div class="tt-title">${ref.pool.id} · subscription</div><b>${Math.round(pct)}%</b> of seat quota used · <b>${Math.round(100 - pct)}%</b> headroom`
      } else if (i === 1) {
        const total = m.spend.vertexTotal
        const left = total * (1 - pct / 100)
        ref.cap.textContent = `$${left.toFixed(2)} of $${total} left`
        ref.a.textContent = `${lanes} lanes`; ref.b.textContent = 'exp. Oct 25'; ref.c.textContent = 'worktrees'
        ref.tipText = `<div class="tt-title">${ref.pool.id} · vertex trial</div><b>$${(total - left).toFixed(2)}</b> burned · <b>$${left.toFixed(2)}</b> left of $${total}`
      } else {
        ref.cap.textContent = 'SSO only · dormant'
        ref.a.textContent = `${lanes} lanes`; ref.b.textContent = 'Duo held'; ref.c.textContent = 'no compute'
        ref.tipText = `<div class="tt-title">${ref.pool.id} · university</div><b>${Math.round(pct)}%</b> used · SSO only, <b>0</b> compute lanes`
      }
    })
  }

  /* ================= optional instruments ================= */

  const componentPlaced = (id) => !root.querySelector(`.m-stash > [data-mc="${id}"]`)

  const heartbeatMachinesInScope = () => state.machine === 'all'
    ? heartbeat.machines
    : heartbeat.machines.filter(machine => machine.id === state.machine)

  function heartbeatHiccupSummary() {
    let count = 0
    let lastAt = 0
    for (const machine of heartbeatMachinesInScope()) {
      let held = false
      for (const point of machine.points) {
        if (point.hiccup && !held) {
          count += 1
          lastAt = Math.max(lastAt, point.at)
        }
        held = point.hiccup
      }
    }
    return count
      ? `${count} hiccup${count === 1 ? '' : 's'} · last ${beatClock.format(lastAt)}`
      : 'no hiccups'
  }

  function syncHeartbeatChrome() {
    const sub = root.querySelector('#heartbeat-sub')
    if (!sub) return
    const caption = `last ${HEART_WINDOW_SECONDS} s · ${HEART_CADENCE} ms samples · ${heartbeatHiccupSummary()}${machineSuffix()}`
    if (sub.textContent !== caption) sub.textContent = caption
    const host = root.querySelector('#heartbeat-chart')
    if (host) host.setAttribute('aria-label', `Machine heartbeat traces, ${caption}`)
  }

  const heartbeatRefs = new Map(heartbeat.machines.map(machine => [
    machine.id,
    root.querySelector(`[data-hb="${machine.id}"]`),
  ]))
  const heartbeatTipRefs = new Map(heartbeat.machines.map(machine => [
    machine.id,
    root.querySelector(`[data-hb-tip="${machine.id}"]`),
  ]))

  function moveHeartbeatTips() {
    heartbeat.machines.forEach((machine, i) => {
      const tip = heartbeatTipRefs.get(machine.id)
      const point = machine.points[machine.points.length - 1]
      if (!tip || !point) return
      /* Mirrors heartbeatOption's y grids: top 22/114, height 60, domain
         −0.42..1.02. This transform-only tip follows every 520ms sample
         without asking the SVG renderer to lay out all 72 points. */
      const y = 22 + i * 92 + ((1.02 - point.value) / 1.44) * 60
      tip.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`
      tip.classList.toggle('is-muted', state.machine !== 'all' && state.machine !== machine.id)
      tip.classList.toggle('is-hiccup', machine.hiccup)
    })
  }

  function syncHeartbeatMeta() {
    for (const machine of heartbeat.machines) {
      const ref = heartbeatRefs.get(machine.id)
      if (!ref) continue
      const selected = state.machine === 'all' || state.machine === machine.id
      ref.classList.toggle('is-muted', !selected)
      ref.classList.toggle('is-hiccup', machine.hiccup)
      const last = `last beat ${beatClock.format(machine.lastBeat)}`
      const lastEl = ref.querySelector('.hb-last')
      if (lastEl.textContent !== last) lastEl.textContent = last
    }
  }

  function heartbeatTick() {
    const at = Date.now()
    let metaDirty = false
    let signalDirty = false
    heartbeat.machines.forEach((machine, machineIndex) => {
      const computer = sim.computers.find(c => c.id === machine.id)
      if (!computer) return
      const signal = heartbeatHiccup(computer)
      if (machine.cooldown > 0) machine.cooldown -= 1
      if (signal && machine.holdRemaining === 0 && machine.cooldown === 0) {
        machine.holdRemaining = 6                 // 3.1 s: a brief held trace
        machine.cooldown = 24                     // do not pin flat on a long sim state
      }
      const held = machine.holdRemaining > 0
      const point = heartbeatPoint(computer, machineIndex, heartbeat.sequence, at, held)
      if (held) machine.holdRemaining -= 1
      machine.points.push(point)
      if (machine.points.length > HEART_POINTS) machine.points.shift()
      if (machine.hiccup !== point.hiccup) signalDirty = true
      machine.hiccup = point.hiccup
      if (point.beat) { machine.lastBeat = point.at; metaDirty = true }
    })
    heartbeat.sequence += 1
    if (!state.editing && componentPlaced('heartbeat')) {
      moveHeartbeatTips()
      if (metaDirty || signalDirty) syncHeartbeatMeta()
      /* Sampling continues every 520ms, but the SVG trace rolls once per
         completed waveform (or at a held-signal edge). Re-optioning 72
         points every sample kept the SVG renderer in continuous layout;
         this cadence preserves the live monitor while leaving the page at
         its established settled layout rate. */
      const waveformComplete = heartbeat.sequence % HEART_PATTERN.length === 0
      if (waveformComplete || signalDirty) {
        /* Keep the measured sub-caption on the same snapshot as the trace;
           otherwise a rolled-out hiccup could disappear from the counter up
           to one waveform before its warning band left the SVG. */
        syncHeartbeatChrome()
        charts?.updateHeartbeat({
          heartbeat, theme, dur: 0, entrance: false,
          reduced: reduced(), machine: state.machine,
        })
      }
    }
    after(heartbeatTick, HEART_CADENCE)
  }

  const burnRefs = new Map([...root.querySelectorAll('[data-burn]')].map(node => [node.dataset.burn, node]))

  function applyBurn(d) {
    if (!d?.burn) return
    for (const row of d.burn.rows) {
      const ref = burnRefs.get(row.id)
      if (!ref) continue
      const runway = row.runway == null ? '—' : `~${Math.max(1, Math.round(row.runway))} d`
      ref.querySelector('.burn-rate').textContent = row.kind === 'currency'
        ? `$${row.rate.toFixed(2)} / machine-day`
        : `${row.rate.toFixed(1)} pts / machine-day`
      ref.querySelector('.burn-figure').textContent = row.kind === 'currency'
        ? `$${row.remaining.toFixed(0)} of $${row.total.toFixed(0)} · ${runway} at current burn`
        : `${row.remaining.toFixed(0)}% headroom · ${row.window}`
    }
  }

  const gateStage = root.querySelector('.gate-stage')
  const gateTrack = gateStage.querySelector('.gate-track')
  const gateTip = viewportTooltip(gateStage)

  function gateTipHtml(mark) {
    return `<div class="tt-title">${mark.dataset.label}</div><b>${mark.dataset.at}</b> · ${mark.dataset.state}`
  }
  gateStage.addEventListener('pointermove', (e) => {
    const mark = e.target.closest('.gate-event')
    if (!mark || !gateTrack.contains(mark)) { gateTip.hide(); return }
    gateTip.show(gateTipHtml(mark), e.clientX, e.clientY)
  })
  gateStage.addEventListener('pointerleave', () => gateTip.hide())
  gateStage.addEventListener('focusin', (e) => {
    const mark = e.target.closest('.gate-event')
    if (!mark) return
    const r = mark.getBoundingClientRect()
    gateTip.show(gateTipHtml(mark), r.left + r.width / 2, r.top)
  })
  gateStage.addEventListener('focusout', () => gateTip.hide())

  function applyTimeline(d) {
    if (!d?.timeline) return
    const R = meta()
    /* count in the legend's own nouns — "blocks" made a cold reader hunt for
       a third mark family that doesn't exist (gates = the open + held glyphs) */
    root.querySelector('#gate-counts').textContent = `${d.timeline.checkpointTotal} ckpt · ${d.timeline.gateTotal} gates`
    syncGatesChrome(d, R)
    const axis = root.querySelectorAll('.gate-axis-labels span')
    R.timeline.forEach((label, i) => { axis[i].textContent = label })
    gateTrack.innerHTML = d.timeline.events.map(event => `
      <button type="button" role="listitem" class="gate-event is-${event.level}${event.ongoing ? ' is-ongoing' : ''}"
        style="--event-x:${(event.at * 100).toFixed(2)}%;--event-row:${event.row}"
        data-label="${event.label}" data-at="${event.atLabel}" data-state="${event.state}"
        aria-label="${event.label}, ${event.state}, ${event.atLabel}"><i aria-hidden="true"></i></button>
    `).join('')
  }

  /* ================= hero charts (engine-rendered) =================
     buildTokens/applyTokens/applyTokenChrome, buildFail/applyFail and
     buildHeat/applyHeat are gone — metrics-charts.js renders all four hero
     charts from the settled dataset. The canonical tick maths stayed HERE
     (d.tokTicks from d3-array in buildData, R.ticks/R.xlab in RANGE_META,
     HOUR_TICKS) and is fed to the engine as data, so the axis language is
     still ours. The engine owns geometry, morph animation, the crosshair
     and hover focus. */

  let charts = null
  let liveSankey = null
  let theme = null

  const tokenLegendRefs = new Map([...root.querySelectorAll('[data-token-provider]')]
    .map(node => [node.dataset.tokenProvider, node]))

  function syncTokenLegend(d) {
    if (!d?.tokens) return
    for (const provider of PROVIDERS) {
      const ref = tokenLegendRefs.get(provider.id)
      if (!ref) continue
      /* heroOption rounds each plotted point to two decimals before the
         tooltip sums it; mirror that exact series population here. */
      const base = d.tokens[provider.id]
        .reduce((sum, value) => sum + Number(value.toFixed(2)), 0)
      const appended = liveExtras
        .reduce((sum, event) => sum + Number(event.tok[provider.id].toFixed(2)), 0)
      const value = fmtK(Math.round(base + appended))
      ref.querySelector('.ck-value').textContent = value
      ref.setAttribute('aria-label', `${provider.label}, ${value} tokens in selected window`)
    }
  }

  function updateCharts(d, dur, entrance = false) {
    /* The DOM ranking rides every existing chart update path: boot, filter
       retargets, sim drift, theme flips and live bucket appends. */
    syncTokenLegend(d)
    if (!charts || !theme) return
    charts.update({
      d, R: meta(), theme, dur, entrance, reduced: reduced(),
      live: liveExtras, selectedLane: state.laneFilter,
      heartbeat, machine: state.machine,
      placed: {
        heartbeat: componentPlaced('heartbeat'),
        burn: componentPlaced('burn'),
      },
    })
  }

  /* The sequential key mirrors the exact stops the visualMap interpolates —
     regenerated with the theme snapshot so it never advertises the previous
     theme's ramp. */
  function syncHeatKey() {
    if (!theme) return
    root.querySelector('#heat-key').innerHTML =
      `<em>low</em>${theme.heat.map(c => `<i style="background:${c}"></i>`).join('')}<em>high</em>`
  }

  /* ================= verdict split =================
     Was a donut. Three parts of a whole encoded as arc angle, with the total
     hidden in the hole and an arc solver (circumference, dasharray, running
     dashoffset, a fudge subtracted from every arc length to fake the gaps)
     doing the work. Angle is the least accurately judged visual channel, and
     the two small slices — the ones a review dashboard exists to show — were
     the ones it degraded most.

     One horizontal 100% stacked bar instead: parts of a whole on a common
     baseline, compared by LENGTH. The total stops being a hole and becomes
     the hero number beside it. No trigonometry survives — a segment is
     `left: acc%` / `width: frac%`, which is also what makes it tween for
     free. Status colours are unchanged (a verdict IS a good/warn/serious
     state, so it wears the reserved status scale, not categorical hues), and
     each one ships with a label and its value, never colour alone. */

  /* `c` (a var() string) skins the DOM legend chips through the cascade;
     `tone` names the theme-snapshot key the engine paints the segment with —
     same status token, two consumers. */
  const VSEGS = [
    { k: 'Accept', key: 'accept', c: 'var(--sev-good)', tone: 'good' },
    { k: 'Retry', key: 'retry', c: 'var(--sev-warn)', tone: 'warn' },
    { k: 'Reject', key: 'reject', c: 'var(--sev-serious)', tone: 'serious' },
  ]
  const verdict = { vals: [], pcts: [] }

  function buildVerdicts() {
    const host = root.querySelector('#verdict-chart')
    host.innerHTML = ''
    const wrap = el(`
      <div class="vwrap">
        <div class="vhero">
          <div class="vh-n" id="verdict-total">0</div>
          <div class="vh-l">verdicts</div>
        </div>
        <div class="vsplit">
          <div class="vbar echart" role="img" aria-label="Review verdict split"></div>
          <div class="vlegend">
            ${VSEGS.map(s => `<span class="vk" style="--vc:${s.c}"><i></i><span class="vk-label">${s.k}</span><b class="vn-${s.key}">0</b><em class="vp-${s.key}">0%</em></span>`).join('')}
          </div>
        </div>
      </div>
    `)
    host.appendChild(wrap)
    /* The card used to end at the legend and stretch to the heat card's
       height, leaving ~48% blank glass. Rather than shrink the card, the
       home page's language fills it: one hairline, bare text rows, no
       sub-boxes. Each row is a rate the bar cannot show directly (share,
       ratio, count) with a measured previous-period delta — same doctrine
       as the tile delta rows, never a caption. */
    const foot = el(`
      <div class="vfoot">
        <div class="vf-row"><span class="vf-l">acceptance</span><span class="vf-v"><b id="vf-acc">0%</b><em id="vf-accd"></em></span></div>
        <div class="vf-row"><span class="vf-l">retries per accept</span><span class="vf-v"><b id="vf-rr">0</b><em id="vf-rrd"></em></span></div>
        <div class="vf-row"><span class="vf-l">rejected</span><span class="vf-v"><b id="vf-rej">0</b><em id="vf-rejd"></em></span></div>
      </div>
    `)
    host.appendChild(foot)
    verdict.total = wrap.querySelector('#verdict-total')
    verdict.vals = VSEGS.map(s => wrap.querySelector(`.vn-${s.key}`))
    verdict.pcts = VSEGS.map(s => wrap.querySelector(`.vp-${s.key}`))
    verdict.acc = foot.querySelector('#vf-acc'); verdict.accd = foot.querySelector('#vf-accd')
    verdict.rr = foot.querySelector('#vf-rr'); verdict.rrd = foot.querySelector('#vf-rrd')
    verdict.rej = foot.querySelector('#vf-rej'); verdict.rejd = foot.querySelector('#vf-rejd')
    /* the bar itself (and its tooltip) is engine-rendered now — this builder
       owns only the DOM that was already right: hero, legend, vfoot */
  }

  /* DOM numbers only — the bar's segments tween in the engine from the same
     d.verdicts, so the legend count and the segment length always agree at
     settle (both read the identical generator output). */
  function applyVerdicts(d) {
    if (!verdict.total) return            // built on the frame after mount
    const v = d.verdicts
    const total = v.accept + v.retry + v.reject
    VSEGS.forEach((s, i) => {
      const frac = total ? v[s.key] / total : 0
      verdict.vals[i].textContent = Math.round(v[s.key]).toLocaleString('en-US')
      verdict.pcts[i].textContent = `${(frac * 100).toFixed(1)}%`
    })
    verdict.total.textContent = Math.round(total).toLocaleString('en-US')

    /* Footer rows — derived from the same d.verdicts the bar paints, so the
       acceptance share here always agrees with the Accept legend entry. The
       deltas diff against prevPeriod (rebuilt in retarget()), the identical
       generator one period back — a measured comparison, like the tiles.
       During a tween the values ride the interpolated frames and settle on
       the target's, same as every other mark in the card. */
    const R = meta()
    const p = prevPeriod.verdicts
    const pTotal = p.accept + p.retry + p.reject
    const accPct = total ? (v.accept / total) * 100 : 0
    const pAccPct = pTotal ? (p.accept / pTotal) * 100 : 0
    const rr = v.accept ? v.retry / v.accept : 0
    const pRr = p.accept ? p.retry / p.accept : 0
    const dAcc = accPct - pAccPct, dRr = rr - pRr, dRej = Math.round(v.reject) - Math.round(p.reject)
    verdict.acc.textContent = `${accPct.toFixed(1)}%`
    verdict.accd.textContent = Math.abs(dAcc) < 0.05 ? `level ${R.prev}` : `${signed(dAcc, 1)} pts ${R.prev}`
    verdict.rr.textContent = rr.toFixed(2)
    verdict.rrd.textContent = Math.abs(dRr) < 0.005 ? `level ${R.prev}` : `${signed(dRr, 2)} ${R.prev}`
    verdict.rej.textContent = Math.round(v.reject).toLocaleString('en-US')
    verdict.rejd.textContent = dRej === 0 ? `level ${R.prev}` : `${signed(dRej)} ${R.prev}`
  }

  /* ================= agent table (sortable + FLIP) ================= */

  const COLS = [
    { key: 'name', label: 'Agent', sort: (r) => r.meta.name.toLowerCase(), num: false },
    { key: 'machine', label: 'Machine', sort: (r) => r.meta.machine.toLowerCase(), num: false },
    { key: 'role', label: 'Role', sort: (r) => r.meta.role.toLowerCase(), num: false },
    { key: 'pool', label: 'Pool', sort: (r) => r.meta.pool.toLowerCase(), num: false },
    { key: 'model', label: 'Model', sort: (r) => r.meta.model.toLowerCase(), num: false },
    { key: 'tasks', label: 'Tasks', sort: (r) => r.meta.tasks, num: true },
    { key: 'fail', label: 'Fail', sort: (r) => r.meta.fail, num: true },
    { key: 'runtime', label: 'Runtime', sort: (r) => -r.meta.bornAt, num: true },
  ]
  const ARROW = `<span class="sarr"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 3 9.7 8.4H2.3z"/></svg></span>`

  const tableRows = []
  let sortKey = null, sortDir = 1
  let tbody = null

  function buildTable() {
    const table = root.querySelector('#agent-table')
    table.innerHTML = `
      <thead><tr>
        ${COLS.map(c => `<th class="sortable${c.num ? ' num' : ''}" data-key="${c.key}" tabindex="0" role="button" aria-label="Sort by ${c.label}"><span class="th-in">${c.label}${ARROW}</span></th>`).join('')}
        <th class="num trend-head">Trend</th>
      </tr></thead><tbody></tbody>`
    tbody = table.querySelector('tbody')

    // One ceiling shared by every row, so the sparklines are comparable:
    // self-scaling made a flat agent and a busy one draw identical amplitude.
    const seriesCeiling = Math.max(1, ...sim.computers.flatMap(
      c => c.agents.map(a => Math.max(...agentSeries(a)))))

    for (const c of sim.computers) {
      for (const a of c.agents) {
        const role = ROLES[a.role]
        const failCls = a.failRate < 2 ? 'fail-ok' : a.failRate < 5 ? 'fail-warn' : 'fail-bad'
        const tr = el(`<tr>
          <td><span class="aname" style="--rc:${role.hex};--gc:${role.glow}"><i></i>${a.name}</span></td>
          <td>${c.name}</td>
          <td>${role.label}</td>
          <td style="font-family:var(--font-mono);font-size:13px">${a.pool}</td>
          <td style="font-family:var(--font-mono);font-size:13px">${a.model}</td>
          <td class="num">${a.tasksDone}</td>
          <td class="num ${failCls}">${a.failRate}%</td>
          <td class="num rt-cell">—</td>
          <td class="trend-cell"></td>
        </tr>`)
        unsubs.push(bindRuntime(tr.querySelector('.rt-cell'), () => a.bornAt))
        // A per-render Math.random() series is decoration wearing a chart's
        // clothes — it moves every repaint and represents nothing. Derive a
        // stable series from the agent's own simulated figures instead, and
        // hold every row to ONE shared scale so a flat agent looks flat and
        // a busy one looks busy (self-scaling made all rows equally dramatic).
        tr.lastElementChild.appendChild(sparkline({
          points: agentSeries(a), w: 90, h: 24, color: role.hex, scaleMax: seriesCeiling,
        }))
        tbody.appendChild(tr)
        tableRows.push({
          tr,
          meta: { name: a.name, machine: c.name, comp: c.id, role: role.label, pool: a.pool, model: a.model, tasks: a.tasksDone, fail: a.failRate, bornAt: a.bornAt },
        })
      }
    }

    table.querySelectorAll('th.sortable').forEach(th => {
      const go = () => setSort(th.dataset.key)
      th.addEventListener('click', go)
      th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go() } })
    })
  }

  function setSort(key) {
    if (sortKey === key) sortDir = -sortDir
    else { sortKey = key; sortDir = 1 }
    root.querySelectorAll('#agent-table th.sortable').forEach(th => {
      const on = th.dataset.key === sortKey
      th.classList.toggle('sorted', on)
      th.classList.toggle('desc', on && sortDir === -1)
      th.setAttribute('aria-sort', on ? (sortDir === 1 ? 'ascending' : 'descending') : 'none')
    })
    relayoutRows(applySortOrder)
  }

  function applySortOrder() {
    if (!sortKey) return
    const col = COLS.find(c => c.key === sortKey)
    const ordered = [...tableRows].sort((a, b) => {
      const va = col.sort(a), vb = col.sort(b)
      if (va < vb) return -1 * sortDir
      if (va > vb) return 1 * sortDir
      return a.meta.name.localeCompare(b.meta.name)
    })
    for (const r of ordered) tbody.appendChild(r.tr)
  }

  /* ---------------- failure-lane ↔ table linking ----------------
     A failure lane is a MODEL lane (the sim names them after the models that
     run them), so membership is matched on the row's model string — the same
     fact the table already prints in its Model column. "looks-like-it-works"
     level: shadow-mgr rides the 0.5x lane with terra because both run the
     0.5x model, which is exactly what the lane's own name claims. */
  const LANE_MATCH = {
    'gemini worktree': (mdl) => mdl.startsWith('gemini'),
    'luna 0.2x': (mdl) => mdl.includes('0.2x'),
    'terra 0.5x': (mdl) => mdl.includes('0.5x'),
    'codex 1.0x': (mdl) => mdl.includes('1.0x'),
    'claude': (mdl) => mdl.startsWith('fable'),
    'jarvis local': (mdl) => mdl === 'local',
  }

  function applyTableFilter() {
    const match = state.laneFilter ? LANE_MATCH[state.laneFilter] : null
    for (const r of tableRows) {
      const machineOut = state.machine !== 'all' && r.meta.comp !== state.machine
      const laneIn = !match || match(r.meta.model)
      r.tr.classList.toggle('row-hidden', machineOut || !laneIn)
      r.tr.classList.toggle('lane-filtered', !!match && laneIn && !machineOut)
    }
  }

  /** Click a failure bar → the table narrows to that lane's agents; click the
      same bar (or the header chip) again → full table. The bar's selected
      state rides the next option re-issue (selectedLane in the payload). */
  function setLaneFilter(lane) {
    state.laneFilter = state.laneFilter === lane ? null : lane
    syncLaneChrome()
    relayoutRows(() => { applyTableFilter(); applySortOrder() })
    updateCharts(target, 240)
  }

  function syncLaneChrome() {
    const btn = root.querySelector('#lane-clear')
    if (state.laneFilter) {
      btn.hidden = false
      btn.innerHTML = `lane: <b>${state.laneFilter}</b><span class="lc-x" aria-hidden="true">×</span>`
      btn.setAttribute('aria-label', `Clear lane filter: ${state.laneFilter}`)
    } else {
      btn.hidden = true
    }
  }

  /** FLIP: measure first → mutate (sort / filter) → invert → play. */
  function relayoutRows(mutate) {
    const first = new Map()
    for (const r of tableRows) {
      if (!r.tr.classList.contains('row-hidden')) first.set(r.tr, r.tr.getBoundingClientRect().top)
    }
    mutate()
    if (reduced()) return

    const moved = []
    for (const r of tableRows) {
      if (r.tr.classList.contains('row-hidden')) continue
      const was = first.get(r.tr)
      if (was === undefined) continue                       // row just became visible
      const dy = was - r.tr.getBoundingClientRect().top
      if (!dy) continue
      r.tr.style.transition = 'none'
      r.tr.style.transform = `translateY(${dy}px)`
      r.tr.classList.add('flip')
      moved.push(r.tr)
    }
    if (!moved.length) return
    requestAnimationFrame(() => {
      for (const tr of moved) {
        tr.style.transition = 'transform .55s var(--ease-spring), background .2s var(--ease)'
        tr.style.transform = ''
      }
    })
    after(() => moved.forEach(tr => { tr.classList.remove('flip'); tr.style.transition = ''; tr.style.transform = '' }), 640)
  }

  /* ================= chrome (labels that follow the filter) ================= */

  function applyChrome() {
    if (liveMode) { applyLiveProjection(); return }
    const R = meta()
    /* the zoom hint lives in words because the slider chrome is gone —
       wheel/drag inside the plot is the only zoom, and an instrument
       states its controls instead of hiding them */
    root.querySelector('#tokens-sub').textContent = `${R.word} · thousands${machineSuffix()} · wheel to zoom`
    root.querySelector('#sankey-sub').textContent = `pools → providers → roles · ${R.word}${machineSuffix()}`
    root.querySelector('#fail-sub').textContent = `${R.failSub}${machineSuffix()}`
    root.querySelector('#heat-sub').textContent = `${R.heatSub}${machineSuffix()}`
    root.querySelector('#verdict-sub').textContent = `${R.verdictSub}${machineSuffix()}`
    syncOptionalChrome(R)
    root.querySelector('#table-sub').textContent = `${machineName()} · live`
    root.querySelector('#mf-note').innerHTML = `${R.word} · ${machineName()} · <i class="live-dot" aria-hidden="true"></i><b>live</b>`
    applyTileDeltas(target)
    /* the token chart's x-axis language (00:00 / weekday / −N d) rides the
       chart update itself now — retarget() re-issues options with R in them */
  }

  function syncOptionalChrome(R = meta()) {
    if (componentPlaced('heartbeat')) syncHeartbeatChrome()
    if (componentPlaced('burn')) root.querySelector('#burn-sub').textContent = `${R.word} · per machine-day${machineSuffix()}`
    if (componentPlaced('gates')) syncGatesChrome(target, R)
  }

  function syncGatesChrome(d = target, R = meta()) {
    const ongoing = d?.timeline?.ongoingTotal || 0
    root.querySelector('#gates-sub').textContent = `${R.word} · event log${machineSuffix()}${ongoing ? ` · ${ongoing} still held` : ''}`
  }

  /* ================= live aggregate projection =================
     These modules keep their registered hosts and layout identities. Their
     charts are intentionally never initialized in live mode: a simulated
     shape, even for a frame, would be a false live claim and would leave
     idle ECharts/rAF work behind for information the projection lacks. */
  function projectionReason(field, absent) {
    const observation = field ? liveObservation(field) : null
    if (observation && !observation.ok) return `${absent} · ${observation.reason}`
    if (!projection?.ok) return `unavailable · ${projection?.reason || 'projection unavailable'}`
    return `unavailable · ${absent}`
  }

  function setProjectionUnavailable(componentId, subId, detail, hosts = []) {
    const component = root.querySelector(`[data-mc="${componentId}"]`)
    component?.classList.add('projection-unavailable')
    const sub = root.querySelector(subId)
    if (sub) sub.textContent = detail
    for (const hostId of hosts) {
      const host = root.querySelector(hostId)
      if (!host) continue
      host.classList.add('projection-unavailable')
      host.setAttribute('aria-label', detail)
      host.replaceChildren(document.createTextNode(detail))
    }
  }

  function setSankeyUnavailable() {
    liveSankey?.dispose()
    liveSankey = null
    const component = root.querySelector('[data-mc="sankey"]')
    const host = root.querySelector('#sankey-chart')
    component?.classList.add('projection-unavailable')
    if (!host) return

    const sentence = projection?.ok
      ? 'Live token routing is unavailable because measured usage is not attributed across pools, providers, and agent roles.'
      : `Live token routing is unavailable because ${projection?.reason || 'the metrics projection could not be read'}.`
    const sub = root.querySelector('#sankey-sub')
    if (sub) sub.textContent = 'pools → providers → roles · unavailable'

    const panel = el(`
      <div class="m-sankey-empty" data-sankey-empty="true">
        <span class="m-sankey-empty-brace" aria-hidden="true">{</span>
        <div class="m-sankey-empty-copy">
          <span class="m-sankey-empty-label">live observation unavailable</span>
          <p></p>
          <button type="button" class="m-sankey-sim">View simulated</button>
        </div>
        <span class="m-sankey-empty-brace is-right" aria-hidden="true">}</span>
      </div>`)
    panel.querySelector('p').textContent = sentence
    panel.querySelector('button').addEventListener('click', () => setLiveView('metrics', false))

    host.classList.add('projection-unavailable', 'm-sankey-empty-host')
    host.setAttribute('role', 'group')
    host.setAttribute('aria-live', 'polite')
    host.setAttribute('aria-label', sentence)
    host.replaceChildren(panel)
  }

  function setSankeyStatePanel(label, sentence, sub) {
    setSankeyUnavailable()
    const panel = root.querySelector('[data-sankey-empty="true"]')
    if (panel) {
      panel.querySelector('.m-sankey-empty-label').textContent = label
      panel.querySelector('p').textContent = sentence
    }
    const subNode = root.querySelector('#sankey-sub')
    if (subNode) subNode.textContent = sub
    const host = root.querySelector('#sankey-chart')
    if (host) host.setAttribute('aria-label', sentence)
  }

  function applyLiveSankey() {
    const usage = liveUsageAttribution()
    if (usage.state === 'unavailable') {
      setSankeyStatePanel(
        'live observation unavailable',
        `Live token routing is unavailable because ${usage.reason}.`,
        'pools → providers → roles · unavailable',
      )
      return
    }
    if (usage.state === 'empty') {
      setSankeyStatePanel(
        'observed empty',
        'The bounded signed audit window was completely observed and contains no attributed usage.',
        'pools → providers → roles · observed empty',
      )
      return
    }
    if (usage.state === 'partial') {
      const { totals } = usage.value
      setSankeyStatePanel(
        'partial observation',
        `A complete total is unavailable. Measured lower bound: ${totals.measuredLowerBoundTokens.toLocaleString('en-US')} tokens across ${totals.calls.toLocaleString('en-US')} calls.`,
        'pools → providers → roles · partial lower bound',
      )
      return
    }

    const component = root.querySelector('[data-mc="sankey"]')
    const host = root.querySelector('#sankey-chart')
    if (!host) return
    component?.classList.remove('projection-unavailable')
    host.classList.remove('projection-unavailable', 'm-sankey-empty-host')
    host.setAttribute('role', 'img')
    host.setAttribute('aria-live', 'polite')
    host.setAttribute('aria-label', `Measured token routing: ${usage.value.totals.tokens.toLocaleString('en-US')} tokens across ${usage.value.totals.calls.toLocaleString('en-US')} calls.`)
    root.querySelector('#sankey-sub').textContent = `pools → providers → roles · measured complete · ${usage.value.totals.tokens.toLocaleString('en-US')} tokens`
    if (!liveSankey) {
      host.replaceChildren()
      theme = buildTheme(root.querySelector('.metrics'))
      liveSankey = createLiveUsageSankey(host)
    }
    liveSankey.update({ rows: usage.value.rows, theme, dur: 240, reduced: reduced() })
  }

  function applyLiveProjection() {
    root.dataset.liveMode = 'live'
    metricsSurface.dataset.liveMode = 'live'
    root.dataset.projectionState = projection?.ok ? 'aggregate' : 'unavailable'
    metricsSurface.dataset.projectionState = root.dataset.projectionState
    root.querySelector('#mf-note').textContent = projection?.ok
      ? 'live aggregate projection'
      : `live projection unavailable · ${projection?.reason || 'projection unavailable'}`
    applyLiveTiles()

    applyLiveSankey()
    setProjectionUnavailable('tokenflow', '#tokens-sub',
      projectionReason(null, 'aggregate projection has no token-flow time series'), ['#hero-chart', '#strip-chart'])
    setProjectionUnavailable('heatmap', '#heat-sub',
      projectionReason(null, 'aggregate projection has no fleet-activity time series'), ['#heat-chart'])
    setProjectionUnavailable('verdicts', '#verdict-sub',
      projectionReason('audit', 'audit unavailable'), ['#verdict-chart'])
    setProjectionUnavailable('lanes', '#fail-sub',
      projectionReason(null, 'aggregate projection has no failure-lane observation'), ['#fail-chart'])
    setProjectionUnavailable('heartbeat', '#heartbeat-sub',
      projectionReason('fleetSupervisor', 'fleet supervisor unavailable'), ['#heartbeat-chart'])
    setProjectionUnavailable('burn', '#burn-sub',
      projectionReason('memory', 'durable memory unavailable'), ['#burn-chart'])
    setProjectionUnavailable('gates', '#gates-sub',
      projectionReason(null, 'aggregate projection has no checkpoint event timeline'))
    setProjectionUnavailable('pools', null,
      projectionReason(null, 'aggregate projection has no account-pool observation'), ['#pools'])
    setProjectionUnavailable('agents', '#table-sub',
      projectionReason(null, 'aggregate projection has no agent roster'), ['#agent-table'])

    /* The static optional-instrument labels originate in the simulation.
       Clear them rather than let two simulated machine identities remain
       beside the fleet-supervisor unavailable result. */
    root.querySelectorAll('.hb-meta').forEach(node => { node.textContent = '' })
    root.querySelectorAll('.hb-signal-tip').forEach(node => { node.hidden = true })
    root.querySelector('.gate-track')?.replaceChildren(document.createTextNode(
      projectionReason(null, 'aggregate projection has no checkpoint event timeline')))
    root.querySelector('.gate-legend')?.replaceChildren()
    root.querySelectorAll('.gate-axis-labels span').forEach(node => { node.textContent = '' })
  }

  async function loadLiveProjection() {
    let result
    try {
      result = await fetchMetrics()
    } catch (err) {
      result = { ok: false, reason: `metrics projection failed: ${err?.message || err}` }
    }
    if (destroyed) return
    projection = result
    current = target = buildLiveData()
    prevPeriod = current
    applyLiveProjection()
  }

  /* ================= tween engine ================= */

  let rafId = 0

  function applyAll(d) {
    if (liveMode) { applyLiveProjection(); return }
    applyTiles(d); applyPools(d); applyVerdicts(d)
  }

  function tweenTo(next, dur) {
    if (liveMode) { current = target = next; applyLiveProjection(); return }
    const from = current
    target = next
    const ms = reduced() ? 120 : dur
    const t0 = performance.now()
    cancelAnimationFrame(rafId)
    const step = (now) => {
      const p = Math.min(1, (now - t0) / ms)
      current = p >= 1 ? next : lerpData(from, next, easeInOut(p))
      applyAll(current)
      if (p < 1) rafId = requestAnimationFrame(step)
    }
    rafId = requestAnimationFrame(step)
  }

  function retarget(dur) {
    if (liveMode) return
    const next = buildData()
    prevPeriod = buildData(1)
    if (!sessionBase) captureSessionBase(next)      // first settle, or post-filter rebaseline
    pulseTiles(target, next)
    tickTileNums(next)
    tweenTo(next, dur)
    /* charts get the SETTLED dataset, never lerp frames — the engine runs
       its own morph over the same duration the DOM tween uses, so both
       halves of the page arrive together */
    updateCharts(next, dur)
    if (componentPlaced('burn')) applyBurn(next)
    if (componentPlaced('gates')) applyTimeline(next)
    if (componentPlaced('heartbeat')) { syncHeartbeatMeta(); moveHeartbeatTips() }
    applyTileDeltas(next)
  }

  /* ================= live pulse =================
     The command band appends a bucket every 4–8 s — the cadence the filter
     row's `live` badge already promises. Values continue the same generator
     the base buckets came from (the sim's daily wave through the same range/
     machine transform), so the stream reads as the day continuing, not as
     new noise. reduced(): the point still appends (data must not stall), the
     600ms slide is gated off inside anim(). */
  function pulse() {
    if (liveMode) return
    /* edit mode stills the stream: appends hold (a chart must not reflow
       under a drag), but the chain keeps scheduling so exiting edit resumes
       the cadence without a restart */
    if (state.editing) { schedulePulse(); return }
    const R = meta(), M = MACHINE_META[state.machine]
    const key = `${state.range}|${state.machine}`
    const n = liveN++
    const tok = {}
    for (const p of PROVIDERS) {
      const base = m.tokensByProvider[p.id][(N + n) % N]
      tok[p.id] = Math.max(2, base * M.share * R.vol * (0.74 + 0.52 * noise(`${key}|tok|${p.id}|live${n}`)))
    }
    const failPt = clamp(0.2, 9.9, target.tiles.failAvg * (0.55 + 0.9 * noise(`${key}|fs|live${n}`)))
    liveExtras.push({ tok, fail: failPt })
    if (liveExtras.length > 12) liveExtras.shift()
    updateCharts(target, 600)
    schedulePulse()
  }
  function schedulePulse() { if (!liveMode) after(pulse, 4000 + Math.random() * 4000) }

  /* ================= filter row wiring ================= */

  const filterEl = root.querySelector('#m-filter')

  /* the shared helper owns indicator geometry now — its MutationObserver
     follows the .on toggles below, and its ResizeObserver replaces the old
     window-resize + RO + boot-frame syncIndicators() plumbing */
  filterEl.querySelectorAll('.seg').forEach(g => unsubs.push(attachSeg(g)))

  filterEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.pill')
    if (!btn) return
    const group = btn.closest('.pill-group')
    const key = group.dataset.group
    const v = btn.dataset.v
    if (state[key] === v) return
    state[key] = v
    group.querySelectorAll('.pill').forEach(p => {
      const on = p === btn
      p.classList.toggle('on', on)
      p.setAttribute('aria-pressed', String(on))
    })
    sessionBase = null                 // a new filter is a new baseline, not a jump
    liveExtras.length = 0; liveN = 0   // a new window restarts the live stream
    applyChrome()
    if (key === 'machine') relayoutRows(() => { applyTableFilter(); applySortOrder() })
    retarget(780)
  })

  /* the header chip is the always-reachable exit from a lane filter — the
     bar that set it may have scrolled off-screen by the time the reader is
     at the table */
  root.querySelector('#lane-clear').addEventListener('click', () => {
    if (state.laneFilter) setLaneFilter(state.laneFilter)
  })

  /* ================= boot ================= */

  /** Flattened twin of a dataset — the DOM numbers grow out of it on first
      paint. Chart keys are carried through untouched: the engine plays its
      own build-in (`entrance`), so flattening tokens/fail/heat here would
      only make the first setOption animate twice. */
  function flattened(d) {
    return {
      ...d,
      verdicts: { accept: 1, retry: 1, reject: 1 },
      pools: d.pools.map(() => 0),
      tiles: Object.fromEntries(Object.keys(d.tiles).map(k => [k, 0])),
      spark: Object.fromEntries(Object.keys(d.spark).map(k => [k, d.spark[k].map(() => 0.01)])),
    }
  }

  /* TWO-STAGE MOUNT — the top strip in this task, the rest on the next frame.
     Every route swap stalled the main thread for 100–190 ms building the
     incoming view, and #/metrics is the worst of them: 3713 DOM nodes against
     1962 on #/comms. It is not View Transitions — removing the API entirely
     measured the same or slightly worse (6891 ms of cumulative stall vs 6645
     with it) — it is one long synchronous construction task.
     So stage 1 builds only what the reader lands on: the filter row (static
     markup), the tile row and the pool row. Stage 2 builds the four chart
     cards, the agent table and the engine instances in a post-paint rAF —
     which is also the earliest the theme snapshot is safe: buildTheme reads
     .metrics-scoped custom properties, and those only resolve once the view
     is in the document. Every apply*() below is a no-op until its own refs
     exist, so a sim retarget landing inside that one-frame window is
     harmless. */
  buildTiles()
  let bootRaf = 0

  if (liveMode) {
    applyLiveProjection()
    loadLiveProjection()
  } else {
    buildPools()
    captureSessionBase(current)
    applyChrome()
    const settled = current
    current = flattened(settled)
    applyAll(current)

    bootRaf = requestAnimationFrame(() => {
    bootRaf = 0
    buildVerdicts(); buildTable()
    theme = buildTheme(root.querySelector('.metrics'))
    charts = createCharts({
      hosts: {
        hero: root.querySelector('#hero-chart'),
        strip: root.querySelector('#strip-chart'),
        sankey: root.querySelector('#sankey-chart'),
        fail: root.querySelector('#fail-chart'),
        heat: root.querySelector('#heat-chart'),
        verdict: root.querySelector('.vbar'),
        heartbeat: root.querySelector('#heartbeat-chart'),
        burn: root.querySelector('#burn-chart'),
      },
      lanes: LANES, days: DAYS, hourTicks: HOUR_TICKS, vsegs: VSEGS,
      onLaneClick: setLaneFilter,
    })
    syncHeatKey()
    if (componentPlaced('burn')) applyBurn(target)
    if (componentPlaced('gates')) applyTimeline(target)
    if (componentPlaced('heartbeat')) { syncHeartbeatMeta(); moveHeartbeatTips() }
    applyAll(current)                  // paint the late panels at the frame the tiles are on
    /* one observer for eight instances — hosts are CSS-sized (fixed heights /
       aspect-ratio / fixed bar height), the engine only ever fills them */
    const ro = new ResizeObserver(() => charts?.resize())
    for (const id of ['#hero-chart', '#strip-chart', '#sankey-chart', '#fail-chart', '#heat-chart', '.vbar', '#heartbeat-chart', '#burn-chart']) {
      ro.observe(root.querySelector(id))
    }
    unsubs.push(() => ro.disconnect())
    /* if a sim event already retargeted inside the gap, that tween owns the
       data now — do not restart the arrival one on top of it. The charts'
       first options always aim at whatever the current target is. */
    updateCharts(target, 900, true)
    tickTileNums(target)               // no-op if a gap retarget already ticked
    if (target === settled) tweenTo(settled, 900)
    schedulePulse()                    // the band starts breathing after arrival
      after(heartbeatTick, HEART_CADENCE)
    })
  }

  /* Theme switch: main.js writes documentElement.dataset.theme; rebuild the
     token snapshot from the NEW computed values, regenerate the heat key, and
     re-issue full options — colours, ramps and gradients glide to the new
     theme on live instances instead of waiting for a remount. */
  if (typeof MutationObserver !== 'undefined') {
    const themeMO = new MutationObserver(() => {
      theme = buildTheme(root.querySelector('.metrics'))
      if (liveMode) { applyLiveSankey(); return }
      syncHeatKey()
      updateCharts(target, 240)
    })
    themeMO.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    unsubs.push(() => themeMO.disconnect())
  }

  /* live drift keeps every mark breathing — a short tween, never a snap.
     Edit mode gates it (with the pulse): a page being rearranged must not
     move under the pointer; onEditChange fires one retarget on exit. */
  if (!liveMode) {
    unsubs.push(sim.on('metrics', () => { if (!state.editing) retarget(420) }))
    unsubs.push(sim.on('spawn', () => { if (!state.editing) retarget(520) }))
    unsubs.push(sim.on('reap', () => { if (!state.editing) retarget(520) }))
  }

  return {
    el: root,
    destroy() {
      destroyed = true
      cancelAnimationFrame(rafId)
      if (bootRaf) cancelAnimationFrame(bootRaf)     // a route swap inside the mount gap
      timers.forEach(t => clearTimeout(t))           // includes the pulse chain
      timers.clear()
      tileRefs.forEach(r => r.cancelTick?.())        // tile counts hold their own rAFs
      unsubs.forEach(u => u())
      /* engine instances hold their own rAF + DOM (and the body-appended
         tooltip) — dispose is what releases them on route cycling */
      charts?.dispose()
      charts = null
      liveSankey?.dispose()
      liveSankey = null
    },
  }
}
