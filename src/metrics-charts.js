// The four hero charts of #/metrics, rebuilt on the ECharts engine.
//
// SCOPE — exactly four: token-flow stacked area, failure-rate h-bars, fleet
// activity heatmap, review-verdict split. The KPI-tile and agent-table
// sparklines stay on components.js/sparkline() on purpose: they are glyphs,
// not charts, and an engine per glyph would be all cost.
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
import { LineChart, BarChart, HeatmapChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, VisualMapComponent } from 'echarts/components'
import { UniversalTransition } from 'echarts/features'
import { SVGRenderer } from 'echarts/renderers'
import { PROVIDERS } from './vocab.js'
import { withAlpha } from './echarts-theme.js'

echarts.use([LineChart, BarChart, HeatmapChart, GridComponent, TooltipComponent, VisualMapComponent, UniversalTransition, SVGRenderer])

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

function tokenOption(P) {
  const { d, R, theme: th } = P
  // canonical ticks stay OURS: d3-array picked d.tokTicks (1/2/5×10ⁿ) and
  // RANGE_META picked R.ticks (clock/weekday/elapsed-days stops); the engine
  // is only allowed to draw them, never to choose them
  const tickSet = new Set(R.ticks.map(t => Math.round(t)))
  const step = d.tokTicks.length > 1 ? d.tokTicks[1] - d.tokTicks[0] : d.tokMax
  return {
    ...anim(P),
    backgroundColor: 'transparent',
    grid: { left: 38, right: 26, top: 10, bottom: 24 },
    xAxis: {
      type: 'category', boundaryGap: false, data: CATS,
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
        return mtip(`<div class="tt-title">${R.xlab(i)}</div>${rows}<div class="tt-row tt-total">Total <b>${Math.round(total)}k</b></div>`)
      },
    },
    series: PROVIDERS.map((p, bi) => ({
      id: p.id, name: p.label, type: 'line', stack: 'tok',
      data: d.tokens[p.id].map(v => +v.toFixed(2)),
      symbol: 'none', smooth: false,
      color: th.prov[p.id],
      lineStyle: { width: 2, color: th.prov[p.id], join: 'round' },
      // per-band vertical fade to transparent at the band's own base — the
      // top alpha is the same --area-a0..a3 ramp the SVG polygons wore
      areaStyle: {
        color: {
          type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: withAlpha(th.prov[p.id], th.areaAlpha[bi]) },
            { offset: 1, color: withAlpha(th.prov[p.id], 0) },
          ],
        },
      },
      // hovering one provider's band recedes the other three; blur strength
      // hand-set — the engine default fades to near-invisible, which reads
      // as data disappearing rather than receding
      emphasis: { focus: 'series' },
      blur: { lineStyle: { opacity: 0.22 }, areaStyle: { opacity: 0.25 } },
      universalTransition: true,
    })),
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
      data: d.fail.map(f => ({
        value: +f.rate.toFixed(2), groupId: f.lane,
        itemStyle: { color: sevColor(f.rate, th) },
      })),
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
 * Init the four instances and return { update, resize, dispose }.
 * `hosts` = { tokens, fail, heat, verdict } — sized by CSS (aspect-ratio for
 * the three plots, fixed 22px for the verdict bar), so the engine only ever
 * fills, never sizes. Payload per update: { d, R, theme, dur, entrance,
 * reduced } plus the static vocab (lanes/days/hourTicks/vsegs) given here.
 */
export function createCharts({ hosts, lanes, days, hourTicks, vsegs }) {
  const opts = { renderer: 'svg' }        // crisp at any DPR, real text nodes
  const inst = {
    tokens: echarts.init(hosts.tokens, null, opts),
    fail: echarts.init(hosts.fail, null, opts),
    heat: echarts.init(hosts.heat, null, opts),
    verdict: echarts.init(hosts.verdict, null, opts),
  }
  const statics = { lanes, days, hourTicks, vsegs }

  return {
    update(payload) {
      const P = { ...payload, ...statics }
      inst.tokens.setOption(tokenOption(P))
      inst.fail.setOption(failOption(P))
      inst.heat.setOption(heatOption(P))
      inst.verdict.setOption(verdictOption(P))
    },
    resize() {
      for (const c of Object.values(inst)) if (!c.isDisposed()) c.resize()
    },
    dispose() {
      for (const c of Object.values(inst)) if (!c.isDisposed()) c.dispose()
    },
  }
}
