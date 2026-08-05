// Computers — tabs per machine, the liquid agent graph, and the right rail
// that morphs between Runtime Statistics and Agent Controls (dblclick a bubble).
//
// Lane T3 owns the continuity in here: the rail crossfades its blocks in a
// top-to-bottom cascade while the Agent Count hero number FLIPs into the agent
// runtime ring, tab switches dissolve the old graph and stagger the new bubbles
// in by mount order, and "Open full view" hands the shell the node's screen
// position so the outgoing view can scale straight into it.
//
// Lane C2 makes the far side of that morph the whiteboard BOARD: a
// role-coloured agent title over a rule, the circled runtime, a real per-agent
// Runtime Statistics plot with quiet chart chrome, the controls inside a
// square box, and square legend swatches. Only the board's internal boxes are
// square — the rail glass card keeps its own shape (see board.css).

import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import { readLayout, writeLayout } from '../layout-pref.js'
import { sim, fmtRuntime } from '../sim.js'
import { CHAT, ROLES } from '../vocab.js'
import { el, uptimeRing, bindRuntime, countUp, setViewMorph, attachSeg, buildChat } from '../components.js'
import { FleetGraph } from '../graph.js'
import { withAlpha } from '../echarts-theme.js'
import '../board.css'

// Keep this surface on the same tree-shaken ECharts build as Metrics. No
// legend/title/toolbox modules are registered, so the board's DOM header is
// the only chrome the single-series plot can acquire.
echarts.use([LineChart, GridComponent, TooltipComponent, SVGRenderer])

/* The Load bars used to be painted in ROLE hues — CPU in --c-coordinator,
   GPU in --c-helper, Network in --c-shadow, Disk in --c-manager — while the
   Legend forty pixels further down the same rail spells out that those exact
   four hues mean Coordinator / Helper / Shadow / Manager. One palette was
   carrying two unrelated meanings in one scroll, which is the same
   triple-duty collision the metrics lane is splitting.

   Resolution, consistent with that split: colour stays reserved for IDENTITY
   (task chips and the legend keep their role hues, deliberately), and the
   four load bars — which are four samples of one quantity, already told
   apart by their labels — move to the neutral ink ramp. The value comes
   through a --m-* token so that if the metrics lane lands a dedicated
   provider/metric palette the rail joins it by defining one variable,
   without another edit here; until then the fallback is what paints. */
const BAR_DEFS = [
  { key: 'cpu', label: 'CPU' },
  { key: 'gpu', label: 'GPU' },
  { key: 'net', label: 'Network' },
  { key: 'disk', label: 'Disk' },
]
const BAR_C = 'var(--m-load, var(--ink-2))'
const BAR_G = 'var(--m-load-soft, var(--ink-3))'

/* ---------- morph constants (mirrored in morphs.css) ---------- */
const MORPH_EASE = 'cubic-bezier(0.22, 0.9, 0.26, 1)'
const STAGGER_MS = 80        // rail cascade step, top → bottom
const ITEM_IN_MS = 340       // per-item fade in
const ITEM_OUT_MS = 240      // per-item fade out
const FLIP_MS = 460          // hero number ⇄ runtime ring
const GRAPH_FADE_MS = 150    // outgoing graph dissolve
const NODE_STAGGER_MS = 30   // incoming bubble cascade step

const motionQuery = typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null
const reduceMotion = () => document.body.classList.contains('reduce-motion') || !!motionQuery?.matches
const rectCenter = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 })

// Match buildChat's deterministic per-agent excerpt so the ambient monitor
// can show the newest line from the same thread the click-through opens.
function monitorContextFor(agent) {
  let hash = 2166136261
  for (let i = 0; i < agent.name.length; i++) {
    hash ^= agent.name.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  const seed = 3
  const span = Math.max(1, CHAT.length - seed)
  const history = CHAT.slice((hash >>> 0) % span, (hash >>> 0) % span + seed)
  const recent = history.at(-1)
  return {
    current: agent.context?.at(-1),
    previous: agent.context?.at(-2),
    chat: recent?.text || '',
    tasks: agent.tasksDone,
    failRate: agent.failRate,
    model: agent.model,
  }
}

/* ---------- board: the per-agent Runtime Statistics plot ---------- */
const CHART_N = 24                 // samples on screen
const CHART_SPAN_MIN = 30          // minutes of history the window covers
const CHART_STEP_MS = 4200         // a new sample lands this often
const CHART_INTRO_MS = 620

// resting activity per role — a coordinator is simply busier than a leaf
const ROLE_LOAD = { coordinator: 68, helper: 57, shadow: 41, manager: 52, default: 34, spawned: 22 }

/* Each tuning readout speaks its own unit. The slider itself only knows 0–100;
   without these maps the .cv froze at its markup literal while the fill
   tracked the thumb — the one place on the board where a control admitted it
   was scenery. The glow slider in the settings drawer is the feel to match:
   the readout moves in the same input event as the drag. */
const TUNING = {
  ctx: (v) => `${Math.round(40 + v * 1.6)}k`,
  wake: (v) => `${Math.max(1, Math.round(v * 0.6))}m`,
  auto: (v) => (v < 34 ? 'low' : v < 67 ? 'med' : 'high'),
}

// One series per agent, kept for the life of the session so re-opening the
// same bubble continues its own history instead of inventing a new one.
const agentSeries = new Map()

function seriesFor(agent) {
  const hit = agentSeries.get(agent.id)
  if (hit) return hit
  if (agentSeries.size > 240) agentSeries.clear()          // reaped agents never come back

  let seed = 2166136261
  for (let i = 0; i < agent.id.length; i++) {
    seed ^= agent.id.charCodeAt(i)
    seed = Math.imul(seed, 16777619)
  }
  seed >>>= 0
  const rnd = () => {                                       // xorshift32, seeded by id
    seed ^= seed << 13; seed >>>= 0
    seed ^= seed >>> 17
    seed ^= seed << 5; seed >>>= 0
    return seed / 4294967296
  }

  const base = ROLE_LOAD[agent.role] ?? 40
  const amp = 10 + rnd() * 13
  const phase = rnd() * Math.PI * 2
  const at = (i) => Math.max(3, Math.min(97,
    base
    + amp * Math.sin((i + phase) / 3.4)
    + amp * 0.42 * Math.sin((i + phase) / 1.25 + 1.7)
    + (rnd() - 0.5) * 9))

  let t = 0
  const vals = []
  while (t < CHART_N) vals.push(at(t++))
  const s = { vals, advance() { vals.push(at(t++)); vals.shift() } }
  agentSeries.set(agent.id, s)
  return s
}

/**
 * The board's "Runtime Statistics" box: activity over time for ONE agent,
 * rendered by the same tree-shaken ECharts core as Metrics. Single series,
 * so the box header names it and carries the end value instead of a legend.
 * Returns { el, tick(ts), intro(), destroy() } — tick() is driven by the
 * view's existing rAF loop.
 */
function agentChartBox(agent) {
  const s = seriesFor(agent)
  const box = el(`
    <div class="board-box board-chart-box">
      <div class="board-box-h">
        <span class="bh-t">Runtime Statistics</span>
        <span class="bh-v"><i></i><span><b class="bc-now">0</b>%</span></span>
      </div>
      <div class="board-cap">agent activity · last ${CHART_SPAN_MIN} min</div>
      <div class="board-plot">
        <div class="bc-canvas" role="img" aria-label="${agent.name} activity over the last ${CHART_SPAN_MIN} minutes"></div>
      </div>
    </div>
  `)

  const canvas = box.querySelector('.bc-canvas')
  const nowEl = box.querySelector('.bc-now')
  let chart = null
  let theme = null
  let lastStep = 0
  let shown = -1
  let disposed = false
  let themeMO = null
  let motionMO = null

  // Like echarts-theme.js, snapshot custom properties into literal colours:
  // the SVG renderer cannot resolve var() inside inline attributes or gradient
  // stops. --rc is inherited from the rail and is the single series colour.
  function buildChartTheme() {
    const rootCS = getComputedStyle(document.documentElement)
    const scopeCS = getComputedStyle(box)
    const read = (cs, name, fallback) => cs.getPropertyValue(name).trim() || fallback
    return {
      role: read(scopeCS, '--rc', '#00a9d8'),
      ink2: read(rootCS, '--ink-2', '#4f5f70'),
      grid: read(rootCS, '--chart-grid', 'rgba(14,23,38,0.07)'),
      cross: read(rootCS, '--chart-cross', 'rgba(14,23,38,0.24)'),
      mono: read(rootCS, '--font-mono', 'ui-monospace, monospace'),
    }
  }

  const data = () => s.vals.map((v, i) => [
    -CHART_SPAN_MIN + i * (CHART_SPAN_MIN / (CHART_N - 1)),
    +v.toFixed(2),
  ])

  // The metrics tooltip idiom: ECharts owns placement and confinement; the
  // transparent engine container carries the shared, theme-aware .mtip skin.
  const tipBase = () => ({
    appendToBody: true,
    confine: true,
    transitionDuration: 0,
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    extraCssText: 'box-shadow:none;',
  })

  function option({ entrance = false, delay = 0, duration = 420 } = {}) {
    const th = theme
    const reduced = reduceMotion()
    return {
      animation: !reduced,
      animationDuration: reduced ? 0 : (entrance ? CHART_INTRO_MS : duration),
      animationDelay: reduced || !entrance ? 0 : delay,
      animationEasing: 'cubicOut',
      animationDurationUpdate: reduced ? 0 : duration,
      animationEasingUpdate: 'cubicInOut',
      backgroundColor: 'transparent',
      color: [th.role],
      grid: { left: 34, right: 10, top: 12, bottom: 30 },
      xAxis: {
        type: 'value',
        min: -CHART_SPAN_MIN,
        max: 0,
        interval: CHART_SPAN_MIN / 2,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: {
          color: th.ink2,
          fontFamily: th.mono,
          fontSize: 12.5,
          margin: 10,
          showMinLabel: true,
          showMaxLabel: true,
          hideOverlap: false,
          formatter: (v) => v === 0 ? 'now' : `${v}m`,
        },
        axisPointer: { label: { show: false } },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 100,
        interval: 50,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: th.ink2,
          fontFamily: th.mono,
          fontSize: 12.5,
          margin: 8,
        },
        splitLine: {
          show: true,
          lineStyle: { color: th.grid, width: 1, type: 'solid' },
        },
        axisPointer: { label: { show: false } },
      },
      tooltip: {
        ...tipBase(),
        trigger: 'axis',
        axisPointer: {
          type: 'cross',
          snap: true,
          label: { show: false },
          lineStyle: { color: th.cross, width: 1, type: 'solid' },
          crossStyle: { color: th.cross, width: 1, type: 'solid' },
        },
        formatter: (params) => {
          const q = params[0]
          if (!q) return ''
          const [mins, value] = q.value
          const ago = Math.abs(Math.round(mins))
          return `<div class="mtip"><div class="tt-title">${agent.name}</div><b>${Math.round(value)}%</b> active · ${ago ? `${ago} min ago` : 'now'}</div>`
        },
      },
      series: [{
        id: 'agent-activity',
        name: 'Agent activity',
        type: 'line',
        data: data(),
        smooth: 0.28,
        symbol: 'none',
        showSymbol: false,
        color: th.role,
        lineStyle: { color: th.role, width: 2, cap: 'round', join: 'round' },
        itemStyle: { color: th.role },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: withAlpha(th.role, 0.16) },
              { offset: 1, color: withAlpha(th.role, 0) },
            ],
          },
        },
        emphasis: {
          lineStyle: { color: th.role, width: 2 },
          itemStyle: { color: th.role },
        },
      }],
    }
  }

  function paint(settings) {
    if (!chart || chart.isDisposed()) return
    chart.setOption(option(settings))
  }

  // One plain text swap keeps the header badge on a value the series really
  // contains; it never shows an in-between tween value during the rail morph.
  function readout() {
    const v = Math.round(s.vals[CHART_N - 1])
    if (v === shown) return
    nowEl.textContent = String(v)
    shown = v
  }

  // intro() runs after insertion into the rail. ECharts therefore sees the
  // real ~316x116 host rather than initializing a detached zero-width node;
  // the existing outer box keeps its ~344x190 footprint exactly.
  function intro(delay) {
    if (disposed || chart) return
    readout()
    theme = buildChartTheme()
    chart = echarts.init(canvas, null, { renderer: 'svg' })
    paint({ entrance: true, delay, duration: CHART_INTRO_MS })

    if (typeof MutationObserver !== 'undefined') {
      themeMO = new MutationObserver(() => {
        theme = buildChartTheme()
        paint({ duration: 240 })
      })
      themeMO.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
      })

      // The Settings motion toggle can flip without a data update. Reissuing
      // the full option parks an in-flight engine tween immediately.
      motionMO = new MutationObserver(() => paint({ duration: 0 }))
      motionMO.observe(document.body, {
        attributes: true,
        attributeFilter: ['class'],
      })
    }
    motionQuery?.addEventListener?.('change', onMotionChange)
  }

  function onMotionChange() {
    paint({ duration: 0 })
  }

  function tick(ts) {
    if (!chart || chart.isDisposed()) return
    if (!lastStep) {
      lastStep = ts
      return
    }
    if (ts - lastStep < CHART_STEP_MS) return
    lastStep = ts
    s.advance()
    readout()
    paint({ duration: 600 })
  }

  const ro = new ResizeObserver(() => {
    if (chart && !chart.isDisposed()) chart.resize()
  })
  ro.observe(canvas)

  return {
    el: box,
    tick,
    intro,
    destroy() {
      disposed = true
      ro.disconnect()
      themeMO?.disconnect()
      motionMO?.disconnect()
      motionQuery?.removeEventListener?.('change', onMotionChange)
      if (chart && !chart.isDisposed()) chart.dispose()
      chart = null
    },
  }
}

export function computersView({ initialComputer = null, navigate }) {
  let computer = sim.computers.find(c => c.id === initialComputer) || sim.computers[0]
  let graph = null
  const unsubs = []

  // two timer pools: rail morph timers are cancelled whenever the rail morphs
  // again; view timers only die with the view.
  let railTimers = []
  let viewTimers = []
  const railTimeout = (fn, ms) => { railTimers.push(setTimeout(fn, ms)); }
  const viewTimeout = (fn, ms) => { viewTimers.push(setTimeout(fn, ms)); }
  const clearRailTimers = () => { railTimers.forEach(clearTimeout); railTimers = [] }

  const root = el(`
    <div class="computers">
      <div class="tabs"></div>
      <div class="comp-body">
        <div class="graph-wrap glass">
          <div class="graph-crumb"></div>
          <div class="graph-hint glass">Graph is getting dense — select a bottom node to focus its branch</div>
          <div class="seg graph-layout-seg" role="group" aria-label="Graph layout">
            <button type="button" data-layout="tree" title="Tidy hierarchy view">Tree</button>
            <button type="button" data-layout="force" title="Live force-directed view">Physics</button>
          </div>
          <button class="graph-edit-btn" type="button" title="Edit the role hierarchy">Edit</button>
          <div class="graph-edit-note">drag a bubble onto its new parent</div>
        </div>
        <aside class="rail glass">
          <div class="rail-page stats-page"></div>
          <div class="rail-page ctl-page board-page off-r"></div>
        </aside>
      </div>
    </div>
  `)

  const tabsEl = root.querySelector('.tabs')
  const graphWrap = root.querySelector('.graph-wrap')
  const crumbEl = root.querySelector('.graph-crumb')
  const hintEl = root.querySelector('.graph-hint')
  const railEl = root.querySelector('.rail')
  const statsPage = root.querySelector('.stats-page')
  const ctlPage = root.querySelector('.ctl-page')
  const editBtn = root.querySelector('.graph-edit-btn')
  const layoutSeg = root.querySelector('.graph-layout-seg')
  /* shared seg indicator (styles.css .seg); syncLayoutSeg keeps toggling .on
     below and the helper's MutationObserver follows it */
  unsubs.push(attachSeg(layoutSeg))

  // Sticky across sessions AND across pages — see layout-pref.js for why it
  // no longer lives here.
  let layoutPref = readLayout()

  function syncLayoutSeg() {
    for (const b of layoutSeg.querySelectorAll('button')) {
      const on = b.dataset.layout === layoutPref
      b.classList.toggle('on', on)
      b.setAttribute('aria-pressed', on ? 'true' : 'false')
    }
    // while editing, the tree is forced — say so instead of showing a lie
    layoutSeg.classList.toggle('locked', !!graph?.editMode)
  }
  layoutSeg.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-layout]')
    if (!btn || !graph || graph.editMode) return
    layoutPref = btn.dataset.layout === 'force' ? 'force' : 'tree'
    writeLayout(layoutPref)
    graph.setLayout(layoutPref)
    syncLayoutSeg()
  })

  // C8 — hierarchy edit mode: Edit locks the tree, Done restores the choice
  function syncEditBtn() {
    const on = !!graph?.editMode
    editBtn.textContent = on ? 'Done' : 'Edit'
    editBtn.classList.toggle('on', on)
    graphWrap.classList.toggle('editing', on)
    syncLayoutSeg()
  }
  editBtn.addEventListener('click', () => {
    if (!graph) return
    graph.setEditMode(!graph.editMode)
    syncEditBtn()
  })

  /* ---------- tabs ---------- */
  function renderTabs() {
    tabsEl.innerHTML = ''
    for (const c of sim.computers) {
      const t = el(`<button class="tab ${c === computer ? 'active' : ''}">${c.name}<span class="ip">${c.ip}</span></button>`)
      t.addEventListener('click', () => switchComputer(c))
      tabsEl.appendChild(t)
    }
    const add = el(`<button class="tab add" title="Connect a computer">+</button>`)
    add.addEventListener('click', () => { const c = sim.addComputer(); switchComputer(c); renderTabs() })
    tabsEl.appendChild(add)
  }

  // Tab switch: dissolve the outgoing graph, cascade the incoming bubbles in,
  // and count the Agent Count hero from the old machine's total to the new one.
  function switchComputer(c) {
    if (c === computer) return
    const prevTotal = computer.spawnedTotal
    computer = c
    renderTabs()
    swapGraph()
    showStats({ countFrom: prevTotal })
  }

  /* ---------- graph ---------- */
  let canvas = null
  let fadingGraph = null       // the machine being dissolved out on a tab switch

  function mountGraph({ stagger = false } = {}) {
    graph?.destroy()
    canvas?.remove()
    canvas = el(`<div style="position:absolute;inset:0"></div>`)
    graphWrap.insertBefore(canvas, crumbEl)
    graph = new FleetGraph(canvas, {
      computer,
      screenChips: true,
      contextFeed: monitorContextFor,
      onSelect: () => {},
      onOpenControls: (agent) => showControls(agent),
      onRootChange: (id) => renderCrumb(id),
    })
    graph.onDensity = (dense) => hintEl.classList.toggle('show', dense)
    graph.updateDensity()
    // apply the sticky layout preference to every freshly-mounted graph
    // (initial mount and each tab switch), un-animated so it arrives settled
    if (layoutPref === 'tree') graph.setLayout('tree', { animate: false })
    renderCrumb(null)
    syncEditBtn()                                  // a fresh graph mounts un-edited
    if (stagger) staggerNodesIn(graph)
  }

  // The outgoing graph fades for GRAPH_FADE_MS before the new one is built, so
  // the two machines never occupy the same frame.
  function swapGraph() {
    const oldGraph = graph, oldCanvas = canvas
    crumbEl.innerHTML = ''
    // a dissolve already in flight will mount whatever machine is current
    if (!canvas && fadingGraph) return
    if (!oldCanvas) { mountGraph({ stagger: true }); return }
    graph = null; canvas = null
    fadingGraph = oldGraph
    oldCanvas.classList.add('mc-graph-out')
    viewTimeout(() => {
      if (fadingGraph === oldGraph) fadingGraph = null
      oldGraph?.destroy()
      oldCanvas.remove()
      mountGraph({ stagger: true })
    }, GRAPH_FADE_MS)
  }

  // graph.js owns the bubble entry animation; this only drives WHEN each one
  // plays, using the graph's own mount order (Map insertion order).
  function staggerNodesIn(g) {
    if (!g || reduceMotion()) return
    const touched = []
    let i = 0
    for (const rec of g.nodes.values()) {
      const d = i * NODE_STAGGER_MS
      rec.el.style.setProperty('--mc-sd', `${d}ms`)
      rec.el.classList.add('mc-stagger', 'enter')
      const glass = rec.el.querySelector('.node-glass')
      if (glass) { glass.style.animationDelay = `${d}ms`; glass.style.animationFillMode = 'backwards' }
      if (rec.chip) {
        rec.chip.style.setProperty('--mc-sd', `${d + 140}ms`)
        rec.chip.classList.add('mc-stagger')
      }
      touched.push(rec)
      i++
    }
    viewTimeout(() => {
      for (const rec of touched) {
        rec.el.classList.remove('mc-stagger')
        rec.el.style.removeProperty('--mc-sd')
        const glass = rec.el.querySelector('.node-glass')
        if (glass) { glass.style.animationDelay = ''; glass.style.animationFillMode = '' }
        rec.chip?.classList.remove('mc-stagger')
        rec.chip?.style.removeProperty('--mc-sd')
      }
    }, i * NODE_STAGGER_MS + 900)
  }

  function renderCrumb(rootId) {
    crumbEl.innerHTML = ''
    if (!rootId) return
    const back = el(`<button>← ${computer.name}</button>`)
    back.addEventListener('click', () => graph?.clearRoot())
    const agent = computer.agents.find(a => a.id === rootId)
    crumbEl.appendChild(back)
    crumbEl.appendChild(el(`<span class="sep">/</span>`))
    crumbEl.appendChild(el(`<span><b style="color:var(--ink-2)">${agent?.name || ''}</b></span>`))
  }

  /* ---------- rail morph plumbing ---------- */

  // Tag the rail page's blocks with a cascade group so they crossfade
  // top-to-bottom one STAGGER_MS step apart instead of all at once.
  function markStagger(page, exclude = null) {
    const items = []
    const title = page.querySelector('.rail-title')
    if (title) items.push(title)
    const scroll = page.querySelector('.rail-scroll')
    if (scroll) items.push(...scroll.children)
    // the pinned actions bar sits OUTSIDE the scroller (it must not scroll
    // away), but it still belongs to the same morph: left out of this list it
    // would hang fully opaque over the crossfade and then pop off with the
    // page, the one block moving on a different clock from the cascade
    const pinned = page.querySelector('.board-actions')
    if (pinned) items.push(pinned)
    let g = -1
    items.forEach((node, i) => {
      const starts = i === 0
        || node.classList.contains('rail-sec')
        || node.classList.contains('stat-hero')
        || node.classList.contains('agent-head')
        || node.classList.contains('board-actions')
        || node.classList.contains('board-box')   // each board box is its own cascade step
      if (starts) g++
      node.style.setProperty('--mi', String(g))
      if (node !== exclude) node.classList.add('mc-stag')
    })
    return { items, groups: Math.max(0, g) }
  }

  const clearStagger = (page) =>
    page.querySelectorAll('.mc-stag').forEach(n => n.classList.remove('mc-stag'))

  // Class flip with the panel transition suppressed for that one frame, so the
  // cascade is the only thing the eye sees (never a slab fade underneath it).
  function snap(page, mutate) {
    page.style.transition = 'none'
    mutate()
    void page.offsetWidth
    page.style.transition = ''
  }

  function cascadeIn(page, exclude = null) {
    const { groups } = markStagger(page, exclude)
    snap(page, () => {
      page.classList.remove('off-l', 'off-r', 'mc-out')
      page.classList.add('mc-in')
    })
    railTimeout(() => {
      page.classList.remove('mc-in')
      clearStagger(page)
    }, ITEM_IN_MS + STAGGER_MS * groups + 60)
    return groups
  }

  // Hide a rail page with the same cascade — unless it is already parked off
  // screen, in which case cascading it out would flash it back into view.
  function hidePage(page, offClass, exclude = null) {
    if (page.classList.contains(offClass)) {
      page.classList.remove('mc-in', 'mc-out')
      clearStagger(page)
      return 0
    }
    return cascadeOut(page, offClass, exclude)
  }

  function cascadeOut(page, offClass, exclude = null) {
    const { groups } = markStagger(page, exclude)
    snap(page, () => {
      page.classList.remove('mc-in')
      page.classList.add('mc-out')
    })
    railTimeout(() => {
      snap(page, () => {
        page.classList.remove('mc-out')
        page.classList.add(offClass)
      })
      clearStagger(page)
    }, ITEM_OUT_MS + STAGGER_MS * groups + 40)
    return groups
  }

  // A ghost of the hero figure, parked exactly over `rect` inside the rail.
  function makeGhost(srcEl, rect) {
    const railRect = railEl.getBoundingClientRect()
    const cs = getComputedStyle(srcEl)
    const ghost = el(`<div class="rail-morph-ghost"></div>`)
    ghost.textContent = srcEl.textContent
    // absolute children sit in the rail's padding box — discount its hairline
    ghost.style.left = `${rect.left - railRect.left - railEl.clientLeft}px`
    ghost.style.top = `${rect.top - railRect.top - railEl.clientTop}px`
    ghost.style.width = `${rect.width}px`
    ghost.style.height = `${rect.height}px`
    ghost.style.fontSize = cs.fontSize
    ghost.style.fontWeight = cs.fontWeight
    ghost.style.color = cs.color
    railEl.appendChild(ghost)
    return ghost
  }

  // FLIP the ring so it *starts* life as the hero number (same place, same
  // size) and expands into its slot while the ghost of the number rides the
  // identical path and dissolves into it — continuous, no blank frame.
  function flipHeroToRing({ heroEl, heroRect, ringEl }) {
    const digits = ringEl?.querySelector('.uring-digits')
    if (!ringEl || !digits) return
    const ringRect = ringEl.getBoundingClientRect()
    const dRect = digits.getBoundingClientRect()
    if (!dRect.height || !heroRect.height || !ringRect.height) return

    const H = rectCenter(heroRect), D = rectCenter(dRect), C = rectCenter(ringRect)
    const ghost = makeGhost(heroEl, heroRect)
    heroEl.style.opacity = '0'

    const grow = dRect.height / heroRect.height
    const flight = ghost.animate([
      { transform: 'translate(0px, 0px) scale(1)', opacity: 1, offset: 0 },
      { opacity: 0.85, offset: 0.45 },
      { transform: `translate(${D.x - H.x}px, ${D.y - H.y}px) scale(${grow})`, opacity: 0, offset: 1 },
    ], { duration: FLIP_MS, easing: MORPH_EASE, fill: 'both' })
    flight.onfinish = () => ghost.remove()

    // invert: ring pinned over the hero at the hero's scale, then played home
    const k = heroRect.height / dRect.height
    const tx = H.x - C.x - k * (D.x - C.x)
    const ty = H.y - C.y - k * (D.y - C.y)
    ringEl.animate([
      { transform: `translate(${tx}px, ${ty}px) scale(${k})`, opacity: 0, offset: 0 },
      { opacity: 1, offset: 0.55 },
      { transform: 'none', opacity: 1, offset: 1 },
    ], { duration: FLIP_MS, easing: MORPH_EASE })
  }

  // The same flight, reversed: the ring collapses toward the hero slot while
  // the number grows out of it and lands as the real element.
  function flipRingToHero({ ringEl, ringRect, digitsRect, heroEl, heroHost }) {
    if (!ringEl || !heroEl || !ringRect || !digitsRect) return
    const heroRect = heroEl.getBoundingClientRect()
    if (!heroRect.height || !digitsRect.height) return

    const H = rectCenter(heroRect), D = rectCenter(digitsRect), C = rectCenter(ringRect)
    const ghost = makeGhost(heroEl, heroRect)
    heroEl.style.opacity = '0'
    // the block itself only fades — it must not move, the flight lands on it
    heroHost?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: MORPH_EASE })

    const grow = digitsRect.height / heroRect.height
    const flight = ghost.animate([
      { transform: `translate(${D.x - H.x}px, ${D.y - H.y}px) scale(${grow})`, opacity: 0, offset: 0 },
      { opacity: 1, offset: 0.45 },
      { transform: 'translate(0px, 0px) scale(1)', opacity: 1, offset: 1 },
    ], { duration: FLIP_MS, easing: MORPH_EASE, fill: 'both' })
    flight.onfinish = () => { heroEl.style.opacity = ''; ghost.remove() }

    const k = heroRect.height / digitsRect.height
    const tx = H.x - C.x - k * (D.x - C.x)
    const ty = H.y - C.y - k * (D.y - C.y)
    ringEl.animate([
      { transform: 'none', opacity: 1, offset: 0 },
      { opacity: 0, offset: 0.6 },
      { transform: `translate(${tx}px, ${ty}px) scale(${k})`, opacity: 0, offset: 1 },
    ], { duration: FLIP_MS, easing: MORPH_EASE, fill: 'forwards' })
  }

  /* ---------- rail: runtime statistics ---------- */
  let heroCount = null       // cancel handle for the running count-up

  function showStats({ flip = false, countFrom = null } = {}) {
    clearRailTimers()

    // measure the ring BEFORE anything re-renders, while it is still on screen
    const ringEl = flip ? ctlPage.querySelector('.uring') : null
    const digitsEl = ringEl?.querySelector('.uring-digits')
    const ringRect = ringEl?.getBoundingClientRect()
    const digitsRect = digitsEl?.getBoundingClientRect()

    renderStats()
    const heroEl = statsPage.querySelector('#agent-count')
    const heroHost = statsPage.querySelector('.stat-hero')
    const doFlip = flip && !reduceMotion() && !!ringEl && !!digitsRect?.height

    // when the ring is flying home the hero block must sit at its resting
    // position (the flight lands on it), so it sits out the cascade
    cascadeIn(statsPage, doFlip ? heroHost : null)

    if (heroEl && countFrom != null) {
      heroCount?.()
      heroCount = countUp(heroEl, countFrom, computer.spawnedTotal, 720)
    }

    // the controls page always leaves through the same cascade (the ring sits
    // it out when it is flying back into the hero figure)
    hidePage(ctlPage, 'off-r', doFlip ? ctlPage.querySelector('.agent-ring-wrap') : null)
    if (doFlip) flipRingToHero({ ringEl, ringRect, digitsRect, heroEl, heroHost })
    // the board keeps ticking until it is genuinely off screen
    railTimeout(() => { ctlRing = null; chart?.destroy(); chart = null }, FLIP_MS + 120)
  }

  function renderStats() {
    const active = computer.agents.length
    statsPage.innerHTML = `
      <div class="rail-title">Runtime Statistics</div>
      <div class="rail-scroll">
        <div class="stat-hero"><span class="v" id="agent-count" data-v="${computer.spawnedTotal}">${computer.spawnedTotal}</span><span class="l">Agent Count</span></div>
        <div class="rail-sub">${active} live now · ${computer.name.toLowerCase()} · ${computer.note}</div>
        <div class="rail-sec">Load</div>
        <div class="bars">
          ${BAR_DEFS.map(b => `
            <div class="bar-row" data-k="${b.key}">
              <span class="bl">${b.label}</span>
              <div class="bar-track"><div class="bar-fill" style="--bc:${BAR_C};--bg-glow:${BAR_G};transform:scaleX(0)"></div></div>
              <span class="bv">0%</span>
            </div>`).join('')}
        </div>
        <div class="rail-sec">Tasks</div>
        <div class="task-list"></div>
        <div class="rail-sec">Legend</div>
        <div class="legend">
          ${Object.entries(ROLES).map(([k, r]) => `
            <div class="leg ${k === 'spawned' ? 'off' : ''}" style="--lc:${r.hex};--lg:${r.glow}">
              <i></i>${r.label}
            </div>`).join('')}
        </div>
      </div>
    `
    updateBars(); updateTasks()
  }

  function updateBars() {
    if (!statsPage.isConnected) return
    for (const b of BAR_DEFS) {
      const row = statsPage.querySelector(`.bar-row[data-k="${b.key}"]`)
      if (!row) continue
      const v = Math.round(computer.stats[b.key])
      /* composited: scaleX on a full-width fill, never an animated width —
         the width tween kept a layout running per frame at idle (see
         .bar-fill in styles.css and the .meter .mf precedent in metrics.css) */
      row.querySelector('.bar-fill').style.transform = `scaleX(${(v / 100).toFixed(4)})`
      row.querySelector('.bv').textContent = v + '%'
    }
    const ac = statsPage.querySelector('#agent-count')
    if (ac) {
      const shown = Number(ac.dataset.v ?? ac.textContent) || 0
      if (shown !== computer.spawnedTotal) {
        ac.dataset.v = String(computer.spawnedTotal)
        heroCount?.()
        heroCount = countUp(ac, shown, computer.spawnedTotal, 700)
      }
    }
  }

  // Task chips stay ROLE-coloured — they are the identity half of the palette
  // split above, and that is deliberate, not an oversight.
  //
  // What changed is the churn: this used to do `list.innerHTML = ''` and
  // rebuild all eight chips on every 'tasks' event (~5s), so styles.css's
  // chipIn spring entrance — which is declared on .task-chip itself and
  // therefore plays once per ELEMENT — replayed on every chip every time,
  // making the whole block hop on a timer even when the only thing that had
  // happened was one task being ticked off. Reconciling by task id makes the
  // entrance event-driven again: a new element exists only when a genuinely
  // new task arrives, a completed task just gains .done in place, and a tick
  // where nothing moved touches no DOM at all.
  function updateTasks() {
    const list = statsPage.querySelector('.task-list')
    if (!list) return
    // The sim draws task texts with replacement, so the queue routinely holds
    // the same sentence as two distinct objects — and two chips reading
    // "Promote pending system cards" side by side breaks the fiction faster
    // than any missing feature. The queue itself is left alone; the rail just
    // shows each text once. Tasks arrive by unshift, so the first occurrence
    // in queue order is the newest and is the one that keeps its chip.
    const seen = new Set()
    const want = computer.tasks
      .filter(t => !seen.has(t.text) && seen.add(t.text))
      .slice(0, 8)
    const have = new Map()
    for (const node of list.children) have.set(node.dataset.taskId, node)
    let prev = null
    for (const t of want) {
      let node = have.get(t.id)
      if (node) {
        have.delete(t.id)
      } else {
        const r = ROLES[t.role] || ROLES.default
        node = el(`<span class="task-chip" data-task-id="${t.id}" style="--tc:${r.hex};--tg:${r.glow}"><i></i>${t.text}</span>`)
      }
      node.classList.toggle('done', !!t.done)
      // a no-op when the chip is already in position, so an unchanged tick
      // performs zero insertions
      const at = prev ? prev.nextSibling : list.firstChild
      if (node !== at) list.insertBefore(node, at)
      prev = node
    }
    for (const node of have.values()) node.remove()
  }

  /* ---------- rail: the board (the morph target) ---------- */
  let ctlRing = null
  let chart = null

  function showControls(agent) {
    clearRailTimers()
    chart?.destroy(); chart = null
    const role = ROLES[agent.role] || ROLES.default

    // the shared element's starting geometry, measured before the swap
    const heroEl = statsPage.querySelector('#agent-count')
    const heroRect = (heroEl && !statsPage.classList.contains('off-l'))
      ? heroEl.getBoundingClientRect() : null

    // one role variable feeds the title, ring, plot, armed control and legend
    ctlPage.style.setProperty('--rc', role.hex)
    ctlPage.style.setProperty('--role-glow', role.glow)

    ctlPage.innerHTML = `
      <div class="rail-title">
        <button class="rail-back">‹ Statistics</button>
        <span class="spacer"></span>Agent Controls
      </div>
      <div class="rail-scroll">
        <div class="agent-head board-head">
          <span class="role-dot"></span>
          <div><div class="an">${agent.name}</div><div class="ar">${role.label}</div></div>
        </div>
        <div class="agent-ring-wrap"></div>
        <div class="rail-sub board-meta">
          <span>${agent.model} · ${agent.pool}</span>
          <span>${agent.tasksDone} tasks · <em class="sev-${agent.failRate < 2 ? 'good' : agent.failRate < 5 ? 'warn' : 'serious'}">${agent.failRate}% fail</em></span>
        </div>
        <div class="board-box board-ctl-box">
          <div class="board-box-h"><span class="bh-t">Tuning</span></div>
          <div class="ctl-row" data-t="ctx"><span class="cl">Context budget</span><input type="range" min="0" max="100" value="62"/><span class="cv">124k</span></div>
          <div class="ctl-row" data-t="wake"><span class="cl">Wake interval</span><input type="range" min="0" max="100" value="35"/><span class="cv">20m</span></div>
          <div class="ctl-row" data-t="auto"><span class="cl">Autonomy</span><input type="range" min="0" max="100" value="80"/><span class="cv">high</span></div>
        </div>
        <div class="board-box board-legend-box">
          <div class="board-box-h"><span class="bh-t">Legend</span></div>
          <div class="legend board-legend">
            ${Object.entries(ROLES).map(([k, r]) => `
              <div class="leg ${k === agent.role ? 'is-self' : ''}" style="--lc:${r.hex};--lg:${r.glow}">
                <i></i>${r.label}
              </div>`).join('')}
          </div>
        </div>
      </div>
      <div class="board-actions">
        <div class="ctl-grid">
          <button class="ctl-btn armed" data-a="pause">
            <svg viewBox="0 0 24 24"><path d="M9 6v12M15 6v12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>Pause</button>
          <button class="ctl-btn" data-a="resume">
            <svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>Resume</button>
          <button class="ctl-btn" data-a="respawn">
            <svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.3-5.6M6 3v4h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>Respawn</button>
          <button class="ctl-btn danger" data-a="terminate">
            <svg viewBox="0 0 24 24"><rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>Terminate</button>
        </div>
        <button class="ctl-btn" data-a="open">
          <svg viewBox="0 0 24 24"><path d="M7 17 17 7M9 7h8v8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Open full view</button>
      </div>
    `
    const scroll = ctlPage.querySelector('.rail-scroll')
    const ringWrap = ctlPage.querySelector('.agent-ring-wrap')

    // The owner's direction, verbatim: "under runtime in that panel should be
    // the chatbox again. it can still have a full view available." So the
    // agent's OWN chat — the same seeded, working buildChat every other
    // surface uses — sits directly under the runtime block. The title is the
    // agent's name on purpose: buildChat derives its seeded history from the
    // title, so each agent replays its own thread and switching bubbles
    // genuinely switches conversations.
    const chatBox = el(`<div class="board-box board-chat-box"></div>`)
    chatBox.appendChild(buildChat({
      title: agent.name,
      subtitle: `${role.label} · direct line`,
      roleKey: agent.role,
      seed: 6,
    }))
    // Escape while typing here belongs to this chat: without the stop, the
    // graph's document-level Escape handler would close the topmost open
    // CHIP chat from a keystroke aimed at the rail's input.
    chatBox.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && e.target.closest?.('.chat-input')) {
        e.stopPropagation()
        e.target.blur()
      }
    })
    scroll.insertBefore(chatBox, scroll.querySelector('.board-ctl-box'))

    // the ring scales with the rail, but never wider than the panel: at a
    // 320px rail this stays 190px, exactly where the digits already fit
    const ringSize = Math.max(180, Math.min(214, (railEl.clientWidth || 320) - 130))
    ctlRing = uptimeRing({
      size: ringSize, epoch: agent.bornAt,
      colors: [role.glow, role.hex],
      caption: 'Runtime', showDays: false,
    })
    ringWrap.appendChild(ctlRing.el)

    // the per-agent plot follows the chat: the rail now reads ring → chat →
    // activity → tuning, with the actions bar pinned under the scroller
    chart = agentChartBox(agent)
    scroll.insertBefore(chart.el, ctlPage.querySelector('.board-ctl-box'))

    ctlPage.querySelector('.rail-back').addEventListener('click', () => showStats({ flip: true }))
    ctlPage.querySelector('[data-a="open"]').addEventListener('click', () => {
      // hand the shell the node's screen position so the outgoing view can
      // scale straight into the bubble that was opened
      const rec = graph?.nodes?.get(agent.id)
      const target = rec?.el || ctlRing?.el || graphWrap
      const r = target.getBoundingClientRect()
      setViewMorph({ kind: 'zoom', x: r.left + r.width / 2, y: r.top + r.height / 2 })
      navigate(`#/agent/${computer.id}/${agent.id}`)
    })
    ctlPage.querySelectorAll('.ctl-btn[data-a]:not([data-a="open"])').forEach(btn => {
      btn.addEventListener('click', () => {
        ctlPage.querySelectorAll('.ctl-btn.armed').forEach(b => b.classList.remove('armed'))
        btn.classList.add('armed')
      })
    })
    ctlPage.querySelectorAll('input[type="range"]').forEach(rangeFill)
    ctlPage.querySelectorAll('.ctl-row[data-t]').forEach(row => {
      const input = row.querySelector('input')
      const cv = row.querySelector('.cv')
      const fmt = TUNING[row.dataset.t]
      // 'input' fires for drags AND arrow keys, so one listener covers both;
      // run it once now so the resting readout agrees with the same map the
      // drag will use instead of the markup's hand-written literal
      const set = () => { cv.textContent = fmt(+input.value) }
      input.addEventListener('input', set)
      set()
    })

    // the ring is the shared element — the FLIP owns it, so it stays out of
    // the cascade; everything else crossfades top-to-bottom around it
    const doFlip = !!heroRect && heroRect.height > 0 && !reduceMotion()
    cascadeIn(ctlPage, doFlip ? ringWrap : null)
    if (doFlip) flipHeroToRing({ heroEl, heroRect, ringEl: ctlRing.el })

    // the plot draws itself in on ITS step of the cascade (--mi is the group
    // index markStagger just assigned), so the board reads as one move
    const mi = Number(getComputedStyle(chart.el).getPropertyValue('--mi')) || 0
    chart.intro(mi * STAGGER_MS + 110)

    hidePage(statsPage, 'off-l')
    startLoop()          // the board is the only thing that needs a frame loop
  }

  /* ---------- boot ---------- */
  renderTabs()
  mountGraph()
  showStats()

  unsubs.push(sim.on('stats', updateBars))
  unsubs.push(sim.on('tasks', updateTasks))
  unsubs.push(sim.on('spawn', ({ comp }) => { if (comp === computer) updateBars() }))

  // The rAF used to be started at boot and never stopped, so on the DEFAULT
  // rail state — Runtime Statistics, where both ctlRing and chart are null —
  // it woke sixty times a second, forever, to do exactly nothing. It now runs
  // only while the board is genuinely mounted, and parks itself on the first
  // frame after the board is torn down; showControls() restarts it.
  //
  // The runtime ring is additionally throttled to ~12Hz: its sweep advances
  // 6° per minute, so rewriting two SVG stroke-dasharray attributes every
  // frame bought no visible smoothness (at 12Hz the arc tip moves well under
  // a pixel per step). chart.tick() is only a cheap interval gate now;
  // ECharts owns the 600ms data morph when the next sample actually lands.
  let raf = 0
  let lastRingAt = 0
  const loop = (ts) => {
    if (!ctlRing && !chart) { raf = 0; return }             // rest, don't spin
    if (ctlRing && ts - lastRingAt >= 80) { lastRingAt = ts; ctlRing.update() }
    chart?.tick(ts)
    raf = requestAnimationFrame(loop)
  }
  const startLoop = () => { if (!raf) raf = requestAnimationFrame(loop) }

  return {
    el: root,
    destroy() {
      cancelAnimationFrame(raf)
      heroCount?.()
      chart?.destroy(); chart = null
      clearRailTimers()
      viewTimers.forEach(clearTimeout); viewTimers = []
      graph?.destroy()
      fadingGraph?.destroy()
      unsubs.forEach(u => u())
    },
  }
}

export function rangeFill(input) {
  const set = () => {
    const pct = ((input.value - input.min) / (input.max - input.min)) * 100
    input.style.setProperty('--fill', pct + '%')
  }
  input.addEventListener('input', set)
  set()
}
