// Metrics — account pools, failure rates, token flow, verdicts, activity heat,
// and the full agent table. All simulated, all alive.
//
// T4: a glass filter row (time range × machine) retargets every chart and
// TWEENS to the new simulated dataset; tiles count up; the agent table sorts
// with a FLIP reorder; tooltips cover every mark.

import '../metrics.css'
import { ticks as d3ticks } from 'd3-array'
import { sim, fmtRuntime } from '../sim.js'
import { ROLES, POOLS, PROVIDERS } from '../vocab.js'
import { el, sparkline, makeTooltip, bindRuntime } from '../components.js'

const fmtK = (n) => n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'M' : n + 'k'

/* ---------------- small numeric helpers ---------------- */

const N = 24                                  // buckets on the token chart
const clamp = (lo, hi, v) => Math.max(lo, Math.min(hi, v))
const lerp = (a, b, t) => a + (b - a) * t
const easeInOut = (p) => p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2
const reduced = () => document.body.classList.contains('reduce-motion')

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

/* Sequential single-hue ramp for the heatmap, read from CSS so it follows
   the theme. The previous hardcoded light ramp INVERTED on the black theme:
   its low end (#edf6fa, near-white) became the brightest mark on a #0d0f12
   page, so an idle hour out-glowed a saturated one. Ramps are generated per
   theme in src/glow.css (tools/gen-glow.mjs) and always run low-contrast ->
   high-contrast against that theme's own background. */
const hexToRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
let HEAT_STOPS = []
function readHeatRamp() {
  const cs = getComputedStyle(document.documentElement)
  const out = []
  for (let i = 0; i < 6; i++) {
    const v = cs.getPropertyValue(`--heat-${i}`).trim()
    if (/^#[0-9a-f]{6}$/i.test(v)) out.push(hexToRgb(v))
  }
  HEAT_STOPS = out.length === 6 ? out
    : ['#edf6fa', '#d3ecf5', '#a8dcec', '#6ec4de', '#35a8cc', '#0b86ab'].map(hexToRgb)
}
readHeatRamp()

/* The ramp is read ONCE per theme, into JS, because the cells are painted with
   interpolated rgb() values rather than a CSS variable — a tween between two
   stops has no CSS expression. That made the read a snapshot: switching theme
   left every cell on the previous theme's ramp until the view was rebuilt, so
   the black theme kept painting the near-white light ramp and an idle hour
   out-glowed a saturated one all over again. Re-read on the attribute the
   theme switch actually writes (main.js sets documentElement.dataset.theme);
   each mounted view registers a repaint here and unregisters on destroy. */
const heatSubscribers = new Set()
function onHeatRampChange(fn) {
  heatSubscribers.add(fn)
  return () => heatSubscribers.delete(fn)
}
if (typeof MutationObserver !== 'undefined') {
  new MutationObserver(() => {
    readHeatRamp()
    heatSubscribers.forEach(fn => fn())
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
}
function heatShade(v) {
  const t = clamp(0, 1, v) * (HEAT_STOPS.length - 1)
  const i = Math.min(HEAT_STOPS.length - 2, Math.floor(t)), f = t - i
  const a = HEAT_STOPS[i], b = HEAT_STOPS[i + 1]
  return `rgb(${Math.round(lerp(a[0], b[0], f))},${Math.round(lerp(a[1], b[1], f))},${Math.round(lerp(a[2], b[2], f))})`
}

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
    word: 'last 24 h', unit: '24 h', prev: 'vs yesterday',
    ticks: HOUR_TICKS, xlab: (i) => `${String(Math.round(i)).padStart(2, '0')}:00`,
    failSub: 'rolling 24 h', verdictSub: 'last 24 h', heatSub: 'by hour · 7 days', opsSub: 'counters · 24 h',
    vol: 1, smooth: 0, fail: 1, heat: 1.05, verdicts: 0.16, pool: 0.86, ops: 0.22,
  },
  '7d': {
    word: 'last 7 days', unit: '7 d', prev: 'vs last week',
    ticks: [0, 4, 8, 12, 16, 20, 23], xlab: (i) => DAYS[Math.round((i / (N - 1)) * 6)],
    failSub: 'rolling 7 days', verdictSub: 'this week', heatSub: 'by hour · 7 days', opsSub: 'counters · 7 d',
    vol: 1.17, smooth: 0.45, fail: 0.88, heat: 1, verdicts: 1, pool: 1, ops: 1,
  },
  '30d': {
    word: 'last 30 days', unit: '30 d', prev: 'vs last month',
    ticks: d3ticks(0, 30, 3).slice().reverse().map(idxForDaysAgo),
    xlab: (i) => i >= N - 1 ? 'now' : `−${Math.round((1 - i / (N - 1)) * 30)} d`,
    failSub: 'rolling 30 days', verdictSub: 'this month', heatSub: 'by hour · weekday mean', opsSub: 'counters · 30 d',
    vol: 1.33, smooth: 0.7, fail: 0.79, heat: 0.9, verdicts: 4.1, pool: 1.12, ops: 3.6,
  },
}

const MACHINE_META = {
  all: { share: 1, fail: 1, heat: 1, pool: 1 },
  c1: { share: 0.56, fail: 1.08, heat: 0.86, pool: 0.94 },
  c2: { share: 0.48, fail: 0.9, heat: 0.83, pool: 1.03 },
}

/* ---------------- tile definitions ---------------- */

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
    id: 'agents', l: 'Agents live', tc: '#00a9d8', tg: '#45d6ff', spark: true,
    val: (d) => d.tiles.agents, fmt: (v) => String(Math.round(v)),
    unit: (d) => `of ${Math.round(d.tiles.spawned)} spawned`,
    delta: { kind: 'session', noun: 'live', signed: false },
  },
  {
    id: 'tasks', l: 'Tasks closed', tc: '#00bd8a', tg: '#35eab7', spark: true,
    val: (d) => d.tiles.tasksClosed, fmt: (v) => Math.round(v).toLocaleString('en-US'),
    unit: (d, meta) => meta.word.replace('last ', ''),
    delta: { kind: 'period', mode: 'pct', signed: true },
  },
  {
    id: 'fail', l: 'Failure rate', tc: '#f57b00', tg: '#ffab4d', spark: true,
    val: (d) => d.tiles.failAvg, fmt: (v) => v.toFixed(1), unit: () => '%',
    delta: { kind: 'period', mode: 'pts', signed: true, lowerIsBetter: true },
  },
  {
    id: 'tokens', l: 'Token flow', tc: '#3e63f0', tg: '#7d9bff', spark: true,
    val: (d) => d.tiles.tokTotal, fmt: (v) => fmtK(Math.round(v)), unit: (d, meta) => meta.unit,
    delta: { kind: 'period', mode: 'pct', signed: false },
  },
  {
    id: 'ckpt', l: 'Checkpoints', tc: '#00bd8a', tg: '#35eab7',
    val: (d) => d.tiles.checkpoints, fmt: (v) => String(Math.round(v)), unit: () => 'recorded',
    delta: { kind: 'session', noun: 'new', signed: false },
  },
  {
    id: 'gates', l: 'Gate blocks', tc: '#dba400', tg: '#ffd84d',
    val: (d) => d.tiles.gateBlocks, fmt: (v) => String(Math.round(v)), unit: () => 'held safely',
    delta: { kind: 'session', noun: 'held', signed: false },
  },
]

const OPS_ROWS = [
  ['Truncations resumed', 'continuation, never completion'],
  ['Model-floor refusals', 'downgrade = refusal'],
  ['Ledger gates open', 'deadlines never override'],
  ['Preflights run', 'before work, not after'],
  ['Territory collisions', 'claims held'],
]

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
  const m = sim.metrics
  const unsubs = []
  const timers = new Set()
  const after = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn() }, ms); timers.add(t); return t }

  const state = { range: '24h', machine: 'all' }
  const meta = () => RANGE_META[state.range]
  const machineName = () => state.machine === 'all'
    ? 'all machines'
    : (sim.computers.find(c => c.id === state.machine)?.name || state.machine)
  const machineSuffix = () => state.machine === 'all' ? '' : ` · ${machineName()}`
  const machineComputers = () => state.machine === 'all'
    ? sim.computers
    : sim.computers.filter(c => c.id === state.machine)

  /* lane display order is fixed once (severity-descending) so bars can tween in place */
  const LANES = [...m.failureByLane].sort((a, b) => b.rate - a.rate).map(l => l.lane)

  const pillGroup = (name, items, label) => `
    <div class="pill-group" data-group="${name}" role="group" aria-label="${label}">
      <span class="pg-ind"></span>
      ${items.map(([id, txt], i) => `<button type="button" class="pill${i === 0 ? ' on' : ''}" data-v="${id}" aria-pressed="${i === 0}">${txt}</button>`).join('')}
    </div>`

  const root = el(`
    <div class="view-pad">
      <div class="metrics">
        <div class="m-filter glass" id="m-filter">
          <span class="mf-label">Range</span>
          ${pillGroup('range', RANGES, 'Time range')}
          <span class="mf-sep"></span>
          <span class="mf-label">Machine</span>
          ${pillGroup('machine', MACHINES, 'Machine')}
          <span class="spacer"></span>
          <span class="mf-note" id="mf-note">simulated fleet · <b>live</b></span>
        </div>
        <div class="m-row m-tiles" id="tiles"></div>
        <div class="m-row m-pools" id="pools"></div>
        <div class="m-row m-charts2">
          <div class="chart-card glass" id="tokens-card">
            <div class="chart-head"><span class="ct">Token flow</span><span class="cs" id="tokens-sub">last 24 h · thousands</span>
              <span class="spacer"></span>
              <span class="chart-legend">${PROVIDERS.map(p => `<span class="ck" style="--kc:${provInk(p.id)}"><i></i>${p.label}</span>`).join('')}</span>
            </div>
            <div class="chart-body" id="tokens-chart"></div>
          </div>
          <div class="chart-card glass" id="fail-card">
            <div class="chart-head"><span class="ct">Failure rate by lane</span><span class="cs" id="fail-sub">rolling 24 h</span>
              <span class="spacer"></span>
              <span class="chart-legend">
                <span class="ck" style="--kc:var(--s-good)"><i></i>&lt; 2%</span>
                <span class="ck" style="--kc:var(--s-warn)"><i></i>2–5%</span>
                <span class="ck" style="--kc:var(--s-serious)"><i></i>&gt; 5%</span>
              </span>
            </div>
            <div class="chart-body" id="fail-chart"></div>
          </div>
        </div>
        <div class="m-row m-charts3">
          <div class="chart-card glass">
            <div class="chart-head"><span class="ct">Fleet activity</span><span class="cs" id="heat-sub">by hour · 7 days</span>
              <span class="spacer"></span>
              <span class="heat-key" id="heat-key"></span>
            </div>
            <div class="chart-body" id="heat-chart"></div>
          </div>
          <div class="chart-card glass">
            <div class="chart-head"><span class="ct">Review verdicts</span><span class="cs" id="verdict-sub">this week</span></div>
            <div class="chart-body" id="verdict-chart"></div>
          </div>
          <div class="chart-card glass" id="ops-card">
            <div class="chart-head"><span class="ct">Discipline</span><span class="cs" id="ops-sub">counters</span></div>
            <div class="chart-body" id="ops-body"></div>
          </div>
        </div>
        <div class="chart-card glass">
          <div class="chart-head"><span class="ct">Agents</span><span class="cs" id="table-sub">all machines · live</span></div>
          <div style="overflow-x:auto"><table class="mtable" id="agent-table"></table></div>
        </div>
      </div>
    </div>
  `)

  /* ================= dataset generation ================= */

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
    const tokTicks = d3ticks(0, Math.max(50, peak * 1.06), 5)
    const tokMax = Math.max(tokTicks[tokTicks.length - 1], Math.max(50, peak * 1.06))
    const tokTotal = PROVIDERS.reduce((s, p) => s + tokens[p.id].reduce((a, b) => a + b, 0), 0)

    /* failure rates (live sim drift is the base, so bars keep breathing) */
    const fail = LANES.map(lane => {
      const live = m.failureByLane.find(l => l.lane === lane)
      const j = 0.82 + 0.36 * noise(`${key}|fail|${lane}`)
      return { lane, rate: clamp(0.2, 9.9, live.rate * R.fail * M.fail * j) }
    })
    const failAvg = fail.reduce((s, f) => s + f.rate, 0) / fail.length

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

    /* discipline counters */
    const os = R.ops * M.share
    const ops = [
      m.truncations * os,
      m.modelFloorRefusals * os,
      state.machine === 'all' ? 4 : 2,
      96 * os,
      0,
    ]

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
    }

    return { tokens, tokMax, tokTicks, tokTotal, fail, heat, verdicts, pools, ops, tiles, spark }
  }

  function lerpData(a, b, t) {
    const L = (x, y) => lerp(x, y, t)
    const arr = (x, y) => x.map((v, i) => L(v, y[i]))
    const obj = (x, y) => Object.fromEntries(Object.keys(x).map(k => [k, L(x[k], y[k])]))
    return {
      tokens: Object.fromEntries(PROVIDERS.map(p => [p.id, arr(a.tokens[p.id], b.tokens[p.id])])),
      tokMax: L(a.tokMax, b.tokMax),
      tokTotal: L(a.tokTotal, b.tokTotal),
      fail: a.fail.map((f, i) => ({ lane: f.lane, rate: L(f.rate, b.fail[i].rate) })),
      heat: a.heat.map((row, d) => arr(row, b.heat[d])),
      verdicts: obj(a.verdicts, b.verdicts),
      pools: arr(a.pools, b.pools),
      ops: arr(a.ops, b.ops),
      tiles: obj(a.tiles, b.tiles),
      spark: Object.fromEntries(Object.keys(a.spark).map(k => [k, arr(a.spark[k], b.spark[k])])),
    }
  }

  let current = buildData()
  let target = current
  let prevPeriod = buildData(1)          // the same period, one period back
  let sessionBase = null                 // tile values at mount / last filter change

  /* ================= tiles ================= */

  const tilesEl = root.querySelector('#tiles')
  const tileRefs = []

  function buildTiles() {
    tilesEl.innerHTML = ''
    for (const t of TILE_DEFS) {
      const tile = el(`
        <div class="tile glass" style="--tc:${t.tc};--tg:${t.tg}" data-tile="${t.id}">
          <div class="tl"><i></i>${t.l}</div>
          <div class="tv"><span class="tvn">—</span><span class="unit"></span></div>
          <div class="td flat"></div>
        </div>
      `)
      const ref = { def: t, el: tile, num: tile.querySelector('.tvn'), unit: tile.querySelector('.unit'), tv: tile.querySelector('.tv'), delta: tile.querySelector('.td') }
      if (t.spark) {
        const svg = sparkline({ points: [1, 2, 3], color: t.tc })
        const tip = svg.querySelector('circle')
        tip.setAttribute('class', 'spark-tip')
        const halo = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
        halo.setAttribute('class', 'spark-halo')
        halo.setAttribute('r', '5.5')
        halo.setAttribute('fill', t.tc)
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

  function applyTiles(d) {
    const R = meta()
    for (const ref of tileRefs) {
      const v = ref.def.val(d)
      ref.num.textContent = ref.def.fmt(v)
      ref.unit.textContent = ref.def.unit(d, R)
      if (ref.path) {
        const g = sparkGeom(d.spark[ref.def.id], 150, 34)
        ref.path.setAttribute('d', g.d)
        ref.tip.setAttribute('cx', g.lx.toFixed(1)); ref.tip.setAttribute('cy', g.ly.toFixed(1))
        ref.halo.setAttribute('cx', g.lx.toFixed(1)); ref.halo.setAttribute('cy', g.ly.toFixed(1))
      }
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

  /** How long the session baseline has been standing — printed, so the claim
      is bounded rather than an open-ended "since open" that a filter change
      would quietly falsify. */
  function fmtWindow(ms) {
    const s = Math.max(0, Math.round(ms / 1000))
    if (s < 60) return `${s}s`
    const mn = Math.round(s / 60)
    return mn < 60 ? `${mn}m` : `${Math.floor(mn / 60)}h${String(mn % 60).padStart(2, '0')}`
  }

  /** Delta rows, measured. `d` is the settled dataset the tiles are heading to. */
  function applyTileDeltas(d) {
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
        const base = sessionBase ? sessionBase.vals[ref.def.id] : now
        const win = fmtWindow(sessionBase ? Date.now() - sessionBase.at : 0)
        const n = Math.round(now - base)
        text = n === 0 ? `no change · ${win}` : `${signed(n)} ${spec.noun} · ${win}`
        if (spec.signed && n !== 0) cls = n > 0 ? 'up' : 'down'
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
      const card = el(`
        <div class="pool glass" style="--pc:${p.color};--pg:${p.glow}">
          <div class="pool-head"><span class="pn">${p.id}</span><span class="pt">${p.kind}</span></div>
          <div class="pool-sub">${p.desc}</div>
          <div class="meter"><div class="mf" style="width:0%;transition:width .3s var(--ease)"></div></div>
          <div class="meter-caption"><b>0% used</b><span class="pcap"></span></div>
          <div class="pool-stats">
            <div class="pool-stat"><div class="v pa">—</div><div class="l">active</div></div>
            <div class="pool-stat"><div class="v pb">—</div><div class="l">window</div></div>
            <div class="pool-stat"><div class="v pc">—</div><div class="l">mode</div></div>
          </div>
        </div>
      `)
      poolsEl.appendChild(card)
      const tip = makeTooltip(card)
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
      ref.fill.style.width = `${pct.toFixed(1)}%`
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

  /* ================= token stacked area ================= */

  const TW = 640, TH = 210, TL = 36, TRr = 26, TT = 10, TB = 24     // C6: TL +2 for 11.5px tick-label margin
  const xTok = (i) => TL + (i / (N - 1)) * (TW - TL - TRr)
  const tok = {}

  function buildTokens() {
    const host = root.querySelector('#tokens-chart')
    host.innerHTML = ''
    let grid = ''
    for (let g = 0; g < 8; g++) {                       // pool; only ticks.length are shown
      grid += `<line class="tk-grid" x1="${TL}" x2="${TW - TRr}" y1="0" y2="0" stroke="var(--chart-grid)" stroke-width="1"/>` +
        `<text class="tk-gl" x="${TL - 8}" y="0" font-size="11.5" fill="var(--ink-3)" text-anchor="end"></text>`
    }
    /* STACK ORDER — fixed, and the legend is printed in the same order:
         band 0  codex   (sits on the baseline, strongest fill)
         band 1  claude
         band 2  gemini
         band 3  local   (rides the total, faintest fill)
       Order is PROVIDERS' own order in src/vocab.js, so it never depends on
       the data and a filtered series never repaints its neighbours. The
       per-band alphas live in metrics.css (--area-a0..a3) so the black theme
       can re-tune them; four uniform 0.1 washes left every boundary to be
       carried by the 2px topline alone. */
    const areas = PROVIDERS.map((p, i) => `<polygon class="tk-area" data-band="${i}" points="" fill="${provInk(p.id)}"/>`).join('')
    const lines = PROVIDERS.map(p => `<polyline class="tk-line" points="" fill="none" stroke="${provInk(p.id)}" stroke-width="2" stroke-linejoin="round"/>`).join('')
    let xl = ''
    for (let t = 0; t < 7; t++) xl += `<text class="tk-xl" x="0" y="${TH - 6}" font-size="11.5" fill="var(--ink-3)" text-anchor="middle"></text>`

    const svg = el(`<svg viewBox="0 0 ${TW} ${TH}" role="img" aria-label="Token flow by provider">
      ${grid}${areas}${lines}${xl}
      <line id="xh" y1="${TT}" y2="${TH - TB}" stroke="var(--chart-cross)" stroke-width="1" opacity="0"/>
    </svg>`)
    host.appendChild(svg)

    tok.svg = svg
    tok.grid = [...svg.querySelectorAll('.tk-grid')]
    tok.glabels = [...svg.querySelectorAll('.tk-gl')]
    tok.areas = [...svg.querySelectorAll('.tk-area')]
    tok.lines = [...svg.querySelectorAll('.tk-line')]
    tok.xl = [...svg.querySelectorAll('.tk-xl')]
    tok.xh = svg.querySelector('#xh')

    const tip = makeTooltip(host)
    svg.addEventListener('pointermove', (e) => {
      const r = svg.getBoundingClientRect()
      const px = ((e.clientX - r.left) / r.width) * TW
      const i = clamp(0, N - 1, Math.round(((px - TL) / (TW - TL - TRr)) * (N - 1)))
      tok.xh.setAttribute('x1', xTok(i)); tok.xh.setAttribute('x2', xTok(i)); tok.xh.setAttribute('opacity', '1')
      /* series identity carried by the swatch, never by coloured text */
      tip.show(`<div class="tt-title">${meta().xlab(i)}</div>` +
        PROVIDERS.map(p => `<div class="tt-row"><i class="tt-key" style="background:${provInk(p.id)}"></i>${p.label} <b>${Math.round(current.tokens[p.id][i])}k</b></div>`).join(''),
        e.clientX, e.clientY)
    })
    svg.addEventListener('pointerleave', () => { tok.xh.setAttribute('opacity', '0'); tip.hide() })
  }

  function applyTokens(d) {
    const maxY = d.tokMax
    const y = (v) => TT + (1 - v / maxY) * (TH - TT - TB)
    const tv = d.tokTicks || []
    for (let g = 0; g < tok.grid.length; g++) {
      const on = g < tv.length
      tok.grid[g].style.display = on ? '' : 'none'
      tok.glabels[g].style.display = on ? '' : 'none'
      if (!on) continue
      const val = tv[g]
      const gy = y(val)
      tok.grid[g].setAttribute('y1', gy.toFixed(1)); tok.grid[g].setAttribute('y2', gy.toFixed(1))
      tok.glabels[g].setAttribute('y', (gy + 3.5).toFixed(1))
      tok.glabels[g].textContent = String(val)     // the label IS the gridline
    }
    const stacked = []
    for (let i = 0; i < N; i++) {
      let acc = 0
      stacked.push(PROVIDERS.map(p => { const y0 = acc; acc += d.tokens[p.id][i]; return [y0, acc] }))
    }
    PROVIDERS.forEach((p, si) => {
      const top = stacked.map((c, i) => `${xTok(i).toFixed(1)},${y(c[si][1]).toFixed(1)}`)
      const bot = stacked.map((c, i) => `${xTok(i).toFixed(1)},${y(c[si][0]).toFixed(1)}`).reverse()
      tok.areas[si].setAttribute('points', `${top.join(' ')} ${bot.join(' ')}`)
      tok.lines[si].setAttribute('points', top.join(' '))
    })
  }

  function applyTokenChrome() {
    const R = meta()
    tok.xl.forEach((t, k) => {
      const i = R.ticks[k]
      if (i === undefined) { t.textContent = ''; return }
      t.setAttribute('x', xTok(i).toFixed(1))
      t.textContent = R.xlab(i)
    })
  }

  /* ================= failure bars ================= */

  const FW = 420, FROW = 30, FL = 118, FR = 50                     // C6: FR +6 headroom for 12.5px value labels
  const FAXH = 19                                                  // bottom band for the x-axis labels
  /* The bar chart had a domain (0–10, the clamp ceiling on a lane's rate) but
     no axis: the reader had only the printed value, so bar LENGTH — the thing
     the chart is made of — meant nothing. Same rule as the token chart's y
     axis: d3-array picks the canonical 1/2/5×10ⁿ stops, and the domain is the
     LAST STOP rather than a hand-rounded number, so every gridline is a real
     labelled value. Fixed rather than data-driven on purpose — bars must not
     rescale under the reader when the filter changes. */
  const FTICKS = d3ticks(0, 10, 5)
  const FMAX = FTICKS[FTICKS.length - 1]
  const fx = (v) => FL + (v / FMAX) * (FW - FL - FR)
  const fbars = []

  function buildFail() {
    const host = root.querySelector('#fail-chart')
    host.innerHTML = ''
    const H = LANES.length * FROW + 8 + FAXH
    const gridTop = 6, gridBot = 6 + LANES.length * FROW
    /* Three explicit layers so the hairline grid sits ON the recessive track
       but UNDER the bars — a gridline crossing a data mark reads as a tick on
       the mark itself. */
    const tracks = LANES.map((_, i) =>
      `<rect x="${FL}" y="${6 + i * FROW + 3}" width="${FW - FL - FR}" height="14" rx="2" fill="var(--chart-track)"/>`).join('')
    const grid = FTICKS.map(t =>
      `<line x1="${fx(t).toFixed(1)}" x2="${fx(t).toFixed(1)}" y1="${gridTop}" y2="${gridBot}" stroke="var(--chart-grid)" stroke-width="1"/>`).join('')
    const axis = FTICKS.map(t =>
      `<text x="${fx(t).toFixed(1)}" y="${H - 6}" font-size="11.5" fill="var(--ink-3)" text-anchor="middle">${t === FMAX ? `${t}%` : t}</text>`).join('')
    const rows = LANES.map((lane, i) => {
      const y = 6 + i * FROW
      return `<g class="f-row" data-i="${i}">
        <text class="flabel" x="${FL - 10}" y="${y + 13.5}" font-size="11.5" fill="var(--ink-2)" text-anchor="end" font-weight="560">${lane}</text>
        <path class="fbar" d="" data-lane="${lane}"/>
        <text class="fval" x="${FL}" y="${y + 13.5}" font-size="12.5" fill="var(--ink-2)" font-weight="640" font-variant-numeric="tabular-nums"></text>
        <rect class="fhit" x="0" y="${y}" width="${FW}" height="${FROW - 2}" fill="transparent"/>
      </g>`
    }).join('')
    const svg = el(`<svg viewBox="0 0 ${FW} ${H}" role="img" aria-label="Failure rate by lane, percent">
      <g class="f-tracks">${tracks}</g><g class="f-grid">${grid}</g>${rows}<g class="f-axis">${axis}</g>
    </svg>`)
    host.appendChild(svg)
    fbars.length = 0
    svg.querySelectorAll('.f-row').forEach((g, i) => {
      fbars.push({ g, i, bar: g.querySelector('.fbar'), val: g.querySelector('.fval') })
    })

    const tip = makeTooltip(host)
    let hot = -1
    svg.addEventListener('pointermove', (e) => {
      const g = e.target.closest('.f-row')
      if (!g) { if (hot >= 0) { fbars[hot].g.classList.remove('hot'); hot = -1 } tip.hide(); return }
      const i = +g.dataset.i
      if (i !== hot) { if (hot >= 0) fbars[hot].g.classList.remove('hot'); hot = i; g.classList.add('hot') }
      const r = current.fail[i]
      tip.show(`<div class="tt-title">${r.lane}</div><b>${r.rate.toFixed(1)}%</b> failure · ${band(r.rate)} · ${meta().failSub}`, e.clientX, e.clientY)
    })
    svg.addEventListener('pointerleave', () => {
      if (hot >= 0) { fbars[hot].g.classList.remove('hot'); hot = -1 }
      tip.hide()
    })
  }

  const sev = (r) => r < 2 ? 'var(--s-good)' : r < 5 ? 'var(--s-warn)' : 'var(--s-serious)'
  const band = (r) => r < 2 ? 'within budget' : r < 5 ? 'watch' : 'serious'

  function applyFail(d) {
    for (const ref of fbars) {
      const rate = d.fail[ref.i].rate
      const y = 6 + ref.i * FROW
      const w = Math.max(3, fx(rate) - FL)
      /* square baseline at x=FL, rounded data-end; bar height 14 px (<= 24) */
      ref.bar.setAttribute('d', `M${FL} ${y + 3} h${Math.max(0, w - 4)} a4 4 0 0 1 4 4 v6 a4 4 0 0 1 -4 4 h-${Math.max(0, w - 4)} z`)
      ref.bar.setAttribute('fill', sev(rate))
      ref.val.setAttribute('x', (FL + w + 8).toFixed(1))
      ref.val.textContent = `${rate.toFixed(1)}%`
    }
  }

  /* ================= heatmap ================= */

  const HCW = 17, HCH = 17, HGAP = 1, HL = 36, HT = 6, HR = 8        // C6: HL/HR margin for 11.5px labels, HGAP -1 to hold canvas width
  const HW = HL + 24 * (HCW + HGAP) + HR, HH = HT + 7 * (HCH + HGAP) + 20
  const heatCells = []

  function buildHeat() {
    const host = root.querySelector('#heat-chart')
    host.innerHTML = ''
    let cells = ''
    for (let d = 0; d < 7; d++) {
      cells += `<text x="${HL - 8}" y="${HT + d * (HCH + HGAP) + 12.5}" font-size="11.5" fill="var(--ink-3)" text-anchor="end">${DAYS[d]}</text>`
      for (let h = 0; h < 24; h++) {
        /* seed fill from the ramp's own low stop, not a light-theme literal —
           applyHeat overwrites it immediately, but a hardcoded near-white was
           the exact bug the per-theme ramp exists to prevent */
        cells += `<rect class="heat-cell" x="${HL + h * (HCW + HGAP)}" y="${HT + d * (HCH + HGAP)}" width="${HCW}" height="${HCH}" rx="2" fill="var(--heat-0)" data-d="${d}" data-h="${h}" data-v="0"/>`
      }
    }
    /* Band axis over 24 hour cells — canonical 6-hour clock stops, not
       d3ticks (see the AXIS RULE beside RANGE_META). */
    const xl = HOUR_TICKS.map(h =>
      `<text x="${HL + h * (HCW + HGAP) + HCW / 2}" y="${HH - 4}" font-size="11.5" fill="var(--ink-3)" text-anchor="middle">${String(h).padStart(2, '0')}</text>`).join('')
    const svg = el(`<svg viewBox="0 0 ${HW} ${HH}" role="img" aria-label="Fleet activity heatmap">${cells}${xl}</svg>`)
    host.appendChild(svg)
    heatCells.length = 0
    svg.querySelectorAll('.heat-cell').forEach(r => heatCells.push(r))

    const tip = makeTooltip(host)
    let hot = null
    svg.addEventListener('pointermove', (e) => {
      const t = e.target
      if (t.classList && t.classList.contains('heat-cell')) {
        if (hot !== t) { hot?.classList.remove('hot'); hot = t; t.classList.add('hot') }
        tip.show(`<div class="tt-title">${DAYS[t.dataset.d]} ${String(t.dataset.h).padStart(2, '0')}:00</div><b>${t.dataset.v}%</b> lane activity`, e.clientX, e.clientY)
      } else { hot?.classList.remove('hot'); hot = null; tip.hide() }
    })
    svg.addEventListener('pointerleave', () => { hot?.classList.remove('hot'); hot = null; tip.hide() })
  }

  /* The sequential key is generated from the same stops the cells interpolate,
     so it re-renders with them on a theme change instead of advertising the
     previous theme's ramp. */
  function syncHeatKey() {
    root.querySelector('#heat-key').innerHTML =
      `<em>low</em>${HEAT_STOPS.map((_, i) => `<i style="background:${heatShade(i / (HEAT_STOPS.length - 1))}"></i>`).join('')}<em>high</em>`
  }

  const heatLast = []
  function applyHeat(d) {
    for (let i = 0; i < heatCells.length; i++) {
      const c = heatCells[i]
      const v = d.heat[(i / 24) | 0][i % 24]
      const fill = heatShade(v)
      if (heatLast[i] !== fill) { c.setAttribute('fill', fill); heatLast[i] = fill }
      const pct = String(Math.round(v * 100))
      if (c.dataset.v !== pct) c.dataset.v = pct
    }
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

  const VSEGS = [
    { k: 'Accept', key: 'accept', c: 'var(--s-good)' },
    { k: 'Retry', key: 'retry', c: 'var(--s-warn)' },
    { k: 'Reject', key: 'reject', c: 'var(--s-serious)' },
  ]
  const VGAP = 2                 // px of bare surface between segments
  const verdict = { segs: [], vals: [], pcts: [] }

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
          <div class="vbar" role="img" aria-label="Review verdict split">
            ${VSEGS.map(s => `<div class="vseg" data-k="${s.key}" style="background:${s.c};left:0;width:0"></div>`).join('')}
          </div>
          <div class="vlegend">
            ${VSEGS.map(s => `<span class="vk" style="--vc:${s.c}"><i></i>${s.k} <b class="vn-${s.key}">0</b> <em class="vp-${s.key}">0%</em></span>`).join('')}
          </div>
        </div>
      </div>
    `)
    host.appendChild(wrap)
    verdict.total = wrap.querySelector('#verdict-total')
    verdict.segs = [...wrap.querySelectorAll('.vseg')]
    verdict.vals = VSEGS.map(s => wrap.querySelector(`.vn-${s.key}`))
    verdict.pcts = VSEGS.map(s => wrap.querySelector(`.vp-${s.key}`))

    const bar = wrap.querySelector('.vbar')
    const tip = makeTooltip(host)
    let hot = null
    bar.addEventListener('pointermove', (e) => {
      const t = e.target.closest('.vseg')
      if (t) {
        if (hot !== t) { hot?.classList.remove('hot'); hot = t; t.classList.add('hot') }
        const key = t.dataset.k
        const v = current.verdicts
        const total = v.accept + v.retry + v.reject
        const s = VSEGS.find(x => x.key === key)
        tip.show(`<div class="tt-title">${s.k}</div><b>${Math.round(v[key])}</b> of ${Math.round(total)} · <b>${((v[key] / total) * 100).toFixed(1)}%</b>`, e.clientX, e.clientY)
      } else { hot?.classList.remove('hot'); hot = null; tip.hide() }
    })
    bar.addEventListener('pointerleave', () => { hot?.classList.remove('hot'); hot = null; tip.hide() })
  }

  function applyVerdicts(d) {
    const v = d.verdicts
    const total = v.accept + v.retry + v.reject
    let acc = 0
    VSEGS.forEach((s, i) => {
      const frac = total ? v[s.key] / total : 0
      const last = i === VSEGS.length - 1
      const seg = verdict.segs[i]
      seg.style.left = `${(acc * 100).toFixed(3)}%`
      /* The gap comes out of each segment's trailing edge, so the segments
         still tile the full 100% and the last one lands flush on the right. */
      seg.style.width = last ? `${(frac * 100).toFixed(3)}%` : `calc(${(frac * 100).toFixed(3)}% - ${VGAP}px)`
      verdict.vals[i].textContent = Math.round(v[s.key]).toLocaleString('en-US')
      verdict.pcts[i].textContent = `${(frac * 100).toFixed(1)}%`
      acc += frac
    })
    verdict.total.textContent = Math.round(total).toLocaleString('en-US')
  }

  /* ================= discipline counters ================= */

  const opsRefs = []

  function buildOps() {
    const host = root.querySelector('#ops-body')
    host.innerHTML = ''
    for (const [l, s] of OPS_ROWS) {
      const row = el(`
        <div style="display:flex;align-items:baseline;justify-content:space-between;padding:9px 2px;border-bottom:1px solid var(--line)">
          <div><div style="font-size:12.5px;font-weight:570;color:var(--ink-2)">${l}</div>
          <div style="font-size:12.5px;color:var(--ink-4)">${s}</div></div>
          <div class="opv" style="font-size:20px;font-weight:650;font-variant-numeric:tabular-nums">0</div>
        </div>`)
      host.appendChild(row)
      opsRefs.push(row.querySelector('.opv'))
    }
  }

  function applyOps(d) {
    opsRefs.forEach((elm, i) => { elm.textContent = String(Math.round(d.ops[i])) })
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
        <th></th>
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
          <td></td>
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

  function applyTableFilter() {
    for (const r of tableRows) {
      r.tr.classList.toggle('row-hidden', state.machine !== 'all' && r.meta.comp !== state.machine)
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
    const R = meta()
    root.querySelector('#tokens-sub').textContent = `${R.word} · thousands${machineSuffix()}`
    root.querySelector('#fail-sub').textContent = `${R.failSub}${machineSuffix()}`
    root.querySelector('#heat-sub').textContent = `${R.heatSub}${machineSuffix()}`
    root.querySelector('#verdict-sub').textContent = `${R.verdictSub}${machineSuffix()}`
    root.querySelector('#ops-sub').textContent = R.opsSub
    root.querySelector('#table-sub').textContent = `${machineName()} · live`
    root.querySelector('#mf-note').innerHTML = `${R.word} · ${machineName()} · <b>live</b>`
    applyTokenChrome()
    applyTileDeltas(target)
  }

  /* ================= tween engine ================= */

  let rafId = 0

  function applyAll(d) {
    applyTiles(d); applyPools(d); applyTokens(d); applyFail(d); applyHeat(d); applyVerdicts(d); applyOps(d)
  }

  function tweenTo(next, dur) {
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
    const next = buildData()
    prevPeriod = buildData(1)
    if (!sessionBase) captureSessionBase(next)      // first settle, or post-filter rebaseline
    pulseTiles(target, next)
    tweenTo(next, dur)
    applyTileDeltas(next)
  }

  /* ================= filter row wiring ================= */

  const filterEl = root.querySelector('#m-filter')

  function syncIndicators() {
    filterEl.querySelectorAll('.pill-group').forEach(group => {
      const on = group.querySelector('.pill.on')
      const ind = group.querySelector('.pg-ind')
      if (!on || !ind) return
      /* Measure against the group's padding edge (the indicator's own containing
         block) and undo any ancestor transform still running on the view. */
      const gr = group.getBoundingClientRect()
      if (!gr.width) return
      const br = on.getBoundingClientRect()
      const bw = parseFloat(getComputedStyle(group).borderLeftWidth) || 0
      const inv = group.offsetWidth / gr.width
      ind.style.width = `${on.offsetWidth}px`
      ind.style.transform = `translateX(${((br.left - gr.left) * inv - bw).toFixed(2)}px)`
      ind.classList.add('ready')
    })
  }

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
    syncIndicators()
    sessionBase = null                 // a new filter is a new baseline, not a jump
    applyChrome()
    if (key === 'machine') relayoutRows(() => { applyTableFilter(); applySortOrder() })
    retarget(780)
  })

  const onResize = () => syncIndicators()
  window.addEventListener('resize', onResize)
  unsubs.push(() => window.removeEventListener('resize', onResize))

  let ro = null
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => syncIndicators())
    ro.observe(filterEl)
    unsubs.push(() => ro.disconnect())
  }

  /* ================= boot ================= */

  /** Flattened twin of a dataset — the charts grow out of it on first paint. */
  function flattened(d) {
    return {
      ...d,
      tokens: Object.fromEntries(PROVIDERS.map(p => [p.id, d.tokens[p.id].map(() => 2)])),
      fail: d.fail.map(f => ({ lane: f.lane, rate: 0.2 })),
      heat: d.heat.map(row => row.map(() => 0)),
      verdicts: { accept: 1, retry: 1, reject: 1 },
      pools: d.pools.map(() => 0),
      ops: d.ops.map(() => 0),
      tiles: Object.fromEntries(Object.keys(d.tiles).map(k => [k, 0])),
      spark: Object.fromEntries(Object.keys(d.spark).map(k => [k, d.spark[k].map(() => 0.01)])),
    }
  }

  /* The ramp was read at module load, which can predate both the theme being
     applied and the stylesheet being injected. Re-read before the key and the
     first cells are painted. */
  readHeatRamp()
  buildTiles(); buildPools(); buildTokens(); buildFail(); buildHeat(); buildVerdicts(); buildOps(); buildTable()
  syncHeatKey()
  captureSessionBase(current)
  applyChrome()
  const settled = current
  current = flattened(settled)
  applyAll(current)
  requestAnimationFrame(() => { syncIndicators(); tweenTo(settled, 900) })

  /* Theme switch: re-read the per-theme --heat-* stops, drop the paint cache
     so every cell is forced through the new ramp, and regenerate the key. */
  unsubs.push(onHeatRampChange(() => {
    heatLast.length = 0
    syncHeatKey()
    applyHeat(current)
  }))

  /* live drift keeps every mark breathing — a short tween, never a snap */
  unsubs.push(sim.on('metrics', () => retarget(420)))
  unsubs.push(sim.on('spawn', () => retarget(520)))
  unsubs.push(sim.on('reap', () => retarget(520)))

  return {
    el: root,
    destroy() {
      cancelAnimationFrame(rafId)
      timers.forEach(t => clearTimeout(t))
      timers.clear()
      unsubs.forEach(u => u())
    },
  }
}
