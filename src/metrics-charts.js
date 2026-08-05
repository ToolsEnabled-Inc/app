// The engine charts of #/metrics.
//
// SCOPE — six instances now: the command band (token-flow hero with zoom +
// its crosshair-synced failure strip), the token-routing Sankey, failure-rate
// h-bars, fleet activity heatmap, review-verdict split. The KPI-tile and
// agent-table sparklines stay on components.js/sparkline() on purpose: they
// are glyphs, not charts, and an engine per glyph would be all cost.
//
// The library must be INVISIBLE as a library. Three mechanisms enforce that:
//   1. Tree-shaken imports only, and Legend/Title/Toolbox are never
//      registered — our DOM headers and legend chips stay the only chrome,
//      so the gallery-demo look physically cannot leak in.
//   2. No default palette anywhere: every series colour is an explicit token
//      from the buildTheme() snapshot (echarts-theme.js), so the charts wear
//      the page's exact inks, ramps and status colours on every theme.
//   3. The tooltip is our own skin (.mtip in metrics.css) rendered through a
//      transparent ECharts container — engine positioning, our surface.
//
// What the engine buys over the old hand-rolled SVG: shape-morphing
// transitions when the Range/Machine filters retarget the data (replacing
// the view's lerpData rAF for these charts), a real axis-pointer crosshair,
// and per-series emphasis/blur focus — with SVGRenderer so text stays real
// text nodes (the styles.css tabular-nums rule keeps applying).

import * as echarts from 'echarts/core'
import { LineChart, BarChart, HeatmapChart, SankeyChart } from 'echarts/charts'
// The INSIDE zoom is the only zoom on the page now: the slider strip was
// eliminated in the unboxed redesign (screenshots: even fully restyled it
// read as library chrome pinned under the hero — a grey slab at rest,
// because a full window means "everything selected"). Wheel/drag zooms;
// the band's sub-caption says so in words. Legend/Title/Toolbox stay
// unregistered on purpose (the demo look cannot physically leak in).
import {
  GridComponent, TooltipComponent, VisualMapComponent,
  DataZoomComponent, DataZoomInsideComponent,
} from 'echarts/components'
import { UniversalTransition } from 'echarts/features'
import { SVGRenderer } from 'echarts/renderers'
import { PROVIDERS } from './vocab.js'
import { withAlpha } from './echarts-theme.js'

echarts.use([
  LineChart, BarChart, HeatmapChart, SankeyChart,
  GridComponent, TooltipComponent, VisualMapComponent,
  DataZoomComponent, DataZoomInsideComponent,
  UniversalTransition, SVGRenderer,
])

/* Severity thresholds — the same numbers the failure card's legend chips
   print (<2 / 2–5 / >5) and the agent table's fail column uses. */
const sevColor = (r, th) => r < 2 ? th.good : r < 5 ? th.warn : th.serious
const bandWord = (r) => r < 2 ? 'within budget' : r < 5 ? 'watch' : 'serious'

const pad2 = (n) => String(n).padStart(2, '0')
const N = 24
const CATS = Array.from({ length: N }, (_, i) => String(i))

/* Every tooltip: transparent engine container, content wrapped in .mtip so
   the skin (3px radius, the page's glass surface + shadow token, 13px ink)
   is one CSS rule that follows the theme through the cascade. appendToBody +
   confine clamps against the VIEWPORT — the same semantics the view's old
   hand-rolled viewportTooltip wrapper existed to add, now for free. */
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

/* Motion flags, restated on EVERY setOption: reduced() can flip at any time
   (Settings toggle or the OS query), so the gate is per-payload, not per-init.
   `entrance` gives the one-time build-in the old flattened() boot tween had. */
function anim({ entrance, dur, reduced }) {
  return {
    animation: !reduced,
    animationDuration: entrance && !reduced ? 900 : 0,
    animationEasing: 'cubicOut',
    animationDurationUpdate: reduced ? 0 : dur,
    animationEasingUpdate: 'cubicInOut',
  }
}

const axisText = (th, color) => ({
  color, fontSize: 12.5, fontFamily: th.font, fontWeight: 400,
})

/* ================= option builders =================
   Each builder returns the COMPLETE option for its chart, every colour
   inlined from the theme snapshot. One builder serves boot, filter flips,
   sim drift and theme flips alike — setOption merges by series id, so a
   re-issue animates rather than rebuilds. */

/* Both command-band charts must plot on IDENTICAL horizontal extents or the
   shared crosshair lies about x — one constant, consumed by both grids. */
const BAND_L = 46
const BAND_R = 26

/* x-axis for the band: the base 24 buckets keep the range's own canonical
   labels; live-appended buckets past them are the stream's continuation and
   are labelled as exactly that ("live +n") rather than borrowing a clock
   stop the range vocabulary never issued for them. */
const bandCats = (len) => len === N ? CATS : Array.from({ length: len }, (_, i) => String(i))
const bandLabel = (R, i) => i >= N ? `live +${i - N + 1}` : R.xlab(i)

function heroOption(P) {
  const { d, R, theme: th, live = [] } = P
  // canonical ticks stay OURS: d3-array picked d.tokTicks (1/2/5×10ⁿ) and
  // RANGE_META picked R.ticks (clock/weekday/elapsed-days stops); the engine
  // is only allowed to draw them, never to choose them
  const tickSet = new Set(R.ticks.map(t => Math.round(t)))
  const step = d.tokTicks.length > 1 ? d.tokTicks[1] - d.tokTicks[0] : d.tokMax
  const len = N + live.length
  const top = PROVIDERS.length - 1
  return {
    ...anim(P),
    backgroundColor: 'transparent',
    grid: { left: BAND_L, right: BAND_R, top: 14, bottom: 28 },
    xAxis: {
      type: 'category', boundaryGap: false, data: bandCats(len),
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: {
        ...axisText(th, th.ink3), interval: 0, margin: 9,
        formatter: (_, i) => tickSet.has(i) ? R.xlab(i) : '',
      },
    },
    yAxis: {
      type: 'value', min: 0, max: d.tokMax, interval: step,
      splitLine: { lineStyle: { color: th.grid, width: 1 } },
      axisLabel: { ...axisText(th, th.ink3), margin: 8, formatter: (v) => String(v) },
    },
    // wheel/drag zoom only — the slider strip is gone (see the import note);
    // connect() mirrors this window into the failure strip below
    dataZoom: [{ type: 'inside', xAxisIndex: 0, filterMode: 'none' }],
    tooltip: {
      ...tipBase(), trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: th.cross, width: 1, type: 'solid' } },
      formatter: (params) => {
        const i = params[0]?.dataIndex ?? 0
        let total = 0
        const rows = params.map(q => {
          total += q.value
          return `<div class="tt-row"><i class="tt-key" style="background:${th.prov[q.seriesId]}"></i>${q.seriesName} <b>${Math.round(q.value)}k</b></div>`
        }).join('')
        return mtip(`<div class="tt-title">${bandLabel(R, i)}</div>${rows}<div class="tt-row tt-total">Total <b>${Math.round(total)}k</b></div>`)
      },
    },
    /* TRUE stacked bands, rebuilt from zero (owner verdict on the old one:
       four independent translucent areas pouring to baseline = mud). Every
       band is a SOLID Carbon categorical fill — bands physically cannot
       overlap, so no boundary can muddy. A 1.5px --bg seam rides each
       band's top line: the page's own colour drawn between fills, which is
       what makes four saturated hues read as machined parts rather than a
       poster. The topmost band's line carries the page's one new glow —
       a ≤8px same-hue breath kept under 0.35 alpha. */
    series: PROVIDERS.map((p, bi) => ({
      id: p.id, name: p.label, type: 'line', stack: 'tok',
      data: d.tokens[p.id].map(v => +v.toFixed(2)).concat(live.map(e => +e.tok[p.id].toFixed(2))),
      symbol: 'none', smooth: 0.25,
      color: th.prov[p.id],
      z: 2 + bi,
      lineStyle: bi === top
        ? {
            width: 2, color: th.prov[p.id], join: 'round',
            shadowBlur: 8, shadowColor: withAlpha(th.prov[p.id], 0.32), shadowOffsetY: -2,
          }
        : { width: 1.5, color: th.bg, join: 'round' },
      areaStyle: { color: th.prov[p.id], opacity: 1 },
      // hovering one provider's band recedes the other three; blur strength
      // hand-set — the engine default fades to near-invisible, which reads
      // as data disappearing rather than receding
      emphasis: { focus: 'series' },
      blur: { lineStyle: { opacity: 0.3 }, areaStyle: { opacity: 0.35 } },
      universalTransition: true,
    })),
  }
}

/* The companion strip: failure-% on the hero's exact time axis. Its own axis
   chrome is nearly silent (the hero directly above carries the time labels);
   what it adds is the severity story — a hidden piecewise visualMap splits
   the line at the same 2/5 thresholds the failure card's legend prints, so
   the strip and the bars speak one language. */
function stripOption(P) {
  const { d, theme: th, live = [] } = P
  const series = d.failSeries.concat(live.map(e => e.fail))
  return {
    ...anim(P),
    backgroundColor: 'transparent',
    grid: { left: BAND_L, right: BAND_R, top: 5, bottom: 5 },
    xAxis: {
      type: 'category', boundaryGap: false, data: bandCats(series.length),
      axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false },
    },
    yAxis: {
      type: 'value', min: 0, max: 10, interval: 5,
      splitLine: { lineStyle: { color: th.grid, width: 1 } },
      axisLabel: { ...axisText(th, th.ink3), margin: 8, formatter: (v) => v === 10 ? '10%' : String(v) },
    },
    // no slider of its own: connect() mirrors the hero's zoom into this
    // inside component, and wheel/drag here mirrors back
    dataZoom: [{ type: 'inside', xAxisIndex: 0, filterMode: 'none' }],
    visualMap: {
      show: false, type: 'piecewise', seriesIndex: 0, dimension: 1,
      pieces: [
        { lt: 2, color: th.good },
        { gte: 2, lt: 5, color: th.warn },
        { gte: 5, color: th.serious },
      ],
    },
    tooltip: {
      ...tipBase(), trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: th.cross, width: 1, type: 'solid' } },
      formatter: (params) => {
        const q = params[0]
        if (!q) return ''
        const v = Array.isArray(q.value) ? q.value[1] : q.value
        return mtip(`<div class="tt-title">${bandLabel(P.R, q.dataIndex)}</div><b>${v.toFixed(1)}%</b> failure · ${bandWord(v)}`)
      },
    },
    series: [{
      id: 'fail-strip', type: 'line',
      data: series.map((v, i) => [i, +v.toFixed(2)]),   // pairs so the visualMap reads dim 1
      symbol: 'none', smooth: false,
      lineStyle: { width: 2 },
      // a whisper of area so the strip reads as a chart, not a stray wire;
      // neutral ink, not a severity wash — the LINE carries the judgement
      areaStyle: {
        color: {
          type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: withAlpha(th.ink, 0.05) },
            { offset: 1, color: withAlpha(th.ink, 0) },
          ],
        },
      },
      universalTransition: true,
    }],
  }
}

/* ---------- token routing sankey — THE HERO ----------
   The one chart with an explicit owner verdict ("cool"), promoted to the
   page's centerpiece: full column, 430px, bare on the page. The view
   derives the flows (metrics.js buildSankey — data stays with the data
   owner); this builder only dresses them. Centerpiece dress: slim 3px-
   cornered node bars, generous vertical rhythm, gradient links resting at
   0.28 that lift to 0.55 with a soft same-hue glow on hover — the place
   the page spends its "kind of glowy" budget at data scale. Provider
   nodes wear the Carbon categorical hues; pools stay the one neutral;
   roles keep their site-wide identity hexes. layoutIterations: 0 keeps
   OUR declared node order; the solver's reshuffles read as the library
   deciding the page. */
const fmtFlow = (v) => v >= 1000 ? (v / 1000).toFixed(1) + 'M' : Math.round(v) + 'k'

function sankeyOption(P) {
  const { d, theme: th } = P
  /* pool and provider node colours resolve from the THEME SNAPSHOT here (the
     --prov-* set re-steps on black, the pool neutral is the columns' own
     slate); role hexes are theme-constant and travel with the data. The map
     also feeds each link's hover glow — the glow is the target's hue, so a
     lifted link answers "flowing INTO what?" */
  const nodeColor = (n) => n.kind === 'pool' ? th.poolAccent
    : n.kind === 'prov' ? th.prov[n.ref] : n.color
  const cmap = new Map(d.sankey.nodes.map(n => [n.name, nodeColor(n)]))
  return {
    ...anim(P),
    backgroundColor: 'transparent',
    tooltip: {
      ...tipBase(), trigger: 'item',
      formatter: (q) => q.dataType === 'edge'
        ? mtip(`<div class="tt-title">${q.data.source} → ${q.data.target}</div><b>${fmtFlow(q.value)}</b> tokens`)
        : mtip(`<div class="tt-title">${q.name}</div><b>${fmtFlow(q.value)}</b> routed`),
    },
    series: [{
      id: 'routing', type: 'sankey',
      left: 6, right: 12, top: 18, bottom: 14,
      nodeWidth: 12, nodeGap: 26,
      layoutIterations: 0,
      emphasis: { focus: 'adjacency' },
      data: d.sankey.nodes.map(n => ({
        name: n.name, depth: n.depth,
        itemStyle: { color: nodeColor(n), borderWidth: 0, borderRadius: 3 },
        // the last column's labels sit LEFT of their bars, inside the plot —
        // nothing may clip against the column edge at 1280
        label: n.depth === 2 ? { position: 'left' } : { position: 'right' },
      })),
      links: d.sankey.links.map(l => ({
        source: l.source, target: l.target, value: +l.value.toFixed(1),
        lineStyle: { color: 'gradient', opacity: 0.28, curveness: 0.5 },
        emphasis: {
          lineStyle: { opacity: 0.55, shadowBlur: 10, shadowColor: withAlpha(cmap.get(l.target) || th.ink3, 0.35) },
        },
      })),
      label: { fontSize: 13, color: th.ink2, fontFamily: th.font, fontWeight: 550 },
      blur: {
        itemStyle: { opacity: 0.35 },
        lineStyle: { opacity: 0.06 },
        label: { opacity: 0.4 },
      },
    }],
  }
}

function failOption(P) {
  const { d, R, theme: th, lanes } = P
  return {
    ...anim(P),
    backgroundColor: 'transparent',
    grid: { left: 118, right: 50, top: 6, bottom: 19 },
    xAxis: {
      // fixed 0–10 domain on purpose — bars must not rescale under the
      // reader when the filter changes; 10 is the sim's clamp ceiling
      type: 'value', min: 0, max: 10, interval: 2,
      axisLine: { show: false }, axisTick: { show: false },
      splitLine: { lineStyle: { color: th.grid, width: 1 } },
      axisLabel: { ...axisText(th, th.ink3), formatter: (v) => v === 10 ? '10%' : String(v) },
    },
    yAxis: {
      type: 'category', inverse: true, data: lanes,
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { ...axisText(th, th.ink2), fontWeight: 500, margin: 10 },
    },
    tooltip: {
      ...tipBase(), trigger: 'item',
      formatter: ({ name, value }) =>
        mtip(`<div class="tt-title">${name}</div><b>${value.toFixed(1)}%</b> failure · ${bandWord(value)} · ${R.failSub}`),
    },
    series: [{
      id: 'fail-rate', type: 'bar', barWidth: 14,
      // groupId per lane so a future reorder glides rows rather than swaps
      data: d.fail.map(f => {
        const c = sevColor(f.rate, th)
        const sel = P.selectedLane === f.lane
        return {
          value: +f.rate.toFixed(2), groupId: f.lane,
          /* selection is a state of the DATA, restated on every re-issue so
             sim drift / theme flips cannot wash it away: the chosen lane at
             full saturation with a soft same-hue glow, the others receded —
             the same figure/ground move the token bands make on hover */
          itemStyle: {
            color: c,
            opacity: P.selectedLane && !sel ? 0.35 : 1,
            ...(sel ? { shadowBlur: 9, shadowColor: withAlpha(c, 0.45) } : {}),
          },
        }
      }),
      showBackground: true,
      backgroundStyle: { color: th.track, borderRadius: 2 },
      itemStyle: { borderRadius: [0, 3, 3, 0] },   // square baseline, soft data end
      label: {
        show: true, position: 'right', distance: 8,
        color: th.ink2, fontSize: 12.5, fontWeight: 600, fontFamily: th.font,
        formatter: ({ value }) => `${value.toFixed(1)}%`,
      },
      emphasis: { itemStyle: { opacity: 0.82 } },
      universalTransition: true,
    }],
  }
}

function heatOption(P) {
  const { d, theme: th, days, hourTicks } = P
  const data = []
  for (let dd = 0; dd < 7; dd++) {
    for (let h = 0; h < N; h++) data.push([h, dd, +d.heat[dd][h].toFixed(3)])
  }
  return {
    ...anim(P),
    backgroundColor: 'transparent',
    grid: { left: 36, right: 8, top: 6, bottom: 20 },
    xAxis: {
      type: 'category', data: CATS,
      axisLine: { show: false }, axisTick: { show: false },
      // canonical 6-hour clock stops, not a generic tick picker (AXIS RULE
      // beside RANGE_META in metrics.js)
      axisLabel: {
        ...axisText(th, th.ink3), interval: 0, margin: 8,
        formatter: (_, i) => hourTicks.includes(i) ? pad2(i) : '',
      },
    },
    yAxis: {
      type: 'category', data: days, inverse: true,   // Mon on top, like the page reads
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { ...axisText(th, th.ink3), margin: 8 },
    },
    // the sequential ramp rides visualMap but the CONTROL stays hidden — the
    // heat-key chips in the card header are the only legend this card gets
    visualMap: {
      show: false, type: 'continuous', min: 0, max: 1,
      inRange: { color: th.heat },
      seriesIndex: 0,
    },
    tooltip: {
      ...tipBase(), trigger: 'item',
      formatter: ({ data: [h, dd, v] }) =>
        mtip(`<div class="tt-title">${days[dd]} ${pad2(h)}:00</div><b>${Math.round(v * 100)}%</b> lane activity`),
    },
    series: [{
      id: 'heat', type: 'heatmap', data,
      // 1px --bg borders are the cell gutters: on flat cards the card IS the
      // page background, so the seams read as bare surface, not strokes
      itemStyle: { borderColor: th.bg, borderWidth: 1, borderRadius: 2 },
      emphasis: { itemStyle: { borderColor: th.ink, borderWidth: 1.2 } },
      universalTransition: true,
    }],
  }
}

function verdictOption(P) {
  const { d, theme: th, vsegs } = P
  const total = vsegs.reduce((s, v) => s + d.verdicts[v.key], 0)
  return {
    ...anim(P),
    backgroundColor: 'transparent',
    grid: { left: 0, right: 0, top: 0, bottom: 0 },
    // axes exist only as the coordinate frame; max = total makes the bar a
    // true 100% split, and animating max is what tweens the shares
    xAxis: { type: 'value', min: 0, max: Math.max(1, total), show: false },
    yAxis: { type: 'category', data: [''], show: false },
    tooltip: {
      ...tipBase(), trigger: 'item',
      formatter: ({ seriesId, value }) => {
        const s = vsegs.find(x => x.key === seriesId)
        const pct = total ? (value / total) * 100 : 0
        return mtip(`<div class="tt-title">${s.k}</div><b>${Math.round(value)}</b> of ${Math.round(total)} · <b>${pct.toFixed(1)}%</b>`)
      },
    },
    series: vsegs.map(s => ({
      id: s.key, name: s.k, type: 'bar', stack: 'v', barWidth: 22,
      data: [+d.verdicts[s.key].toFixed(2)],
      // 1px --bg border per segment = the 2px bare-surface gap the DOM
      // version cut out of each trailing edge; radius matches --r-sm
      itemStyle: { color: th[s.tone], borderColor: th.bg, borderWidth: 1, borderRadius: 2 },
      emphasis: { itemStyle: { borderColor: th.sheet, borderWidth: 2 } },
      universalTransition: true,
    })),
  }
}

/* ================= lifecycle ================= */

/**
 * Init the six instances and return { update, resize, dispose }.
 * `hosts` = { hero, strip, sankey, fail, heat, verdict } — sized by CSS
 * (fixed heights for the band and sankey, aspect-ratio for the plots, 22px
 * for the verdict bar), so the engine only ever fills, never sizes.
 * Payload per update: { d, R, theme, dur, entrance, reduced, live,
 * selectedLane } plus the static vocab (lanes/days/hourTicks/vsegs) here.
 * `onLaneClick(lane)` fires when a failure bar is clicked — the view owns
 * what "select a lane" means (table filter + selectedLane round-trip).
 */
export function createCharts({ hosts, lanes, days, hourTicks, vsegs, onLaneClick }) {
  const opts = { renderer: 'svg' }        // crisp at any DPR, real text nodes
  const inst = {
    hero: echarts.init(hosts.hero, null, opts),
    strip: echarts.init(hosts.strip, null, opts),
    sankey: echarts.init(hosts.sankey, null, opts),
    fail: echarts.init(hosts.fail, null, opts),
    heat: echarts.init(hosts.heat, null, opts),
    verdict: echarts.init(hosts.verdict, null, opts),
  }
  const statics = { lanes, days, hourTicks, vsegs }

  /* the command band is ONE reading instrument in two panes: connect()
     mirrors axisPointer moves and dataZoom windows between them, so the
     crosshair draws on both charts at the same x and zooming either zooms
     both. The group id is constant — dispose() empties it and disconnects. */
  inst.hero.group = 'mc-band'
  inst.strip.group = 'mc-band'
  echarts.connect('mc-band')

  if (onLaneClick) {
    inst.fail.on('click', (q) => {
      if (q.componentType === 'series' && q.seriesId === 'fail-rate') onLaneClick(q.name)
    })
  }

  /* Probe hook, NOT app state: the Playwright verification scripts must
     assert zoom-window equality and live-append counts, and the tree-shaken
     module scope is unreachable from the page console. Nothing in the app
     reads this; dispose() removes it. */
  window.__mcCharts = inst

  return {
    update(payload) {
      const P = { ...payload, ...statics }
      inst.hero.setOption(heroOption(P))
      inst.strip.setOption(stripOption(P))
      inst.sankey.setOption(sankeyOption(P))
      inst.fail.setOption(failOption(P))
      inst.heat.setOption(heatOption(P))
      inst.verdict.setOption(verdictOption(P))
    },
    resize() {
      for (const c of Object.values(inst)) if (!c.isDisposed()) c.resize()
    },
    dispose() {
      for (const c of Object.values(inst)) if (!c.isDisposed()) c.dispose()
      echarts.disconnect('mc-band')
      if (window.__mcCharts === inst) delete window.__mcCharts
    },
  }
}
