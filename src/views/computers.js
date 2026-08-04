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
// Runtime Statistics plot with drawn hairline axes, the controls inside a
// square box, and square legend swatches. Only the board's internal boxes are
// square — the rail glass card keeps its own shape (see board.css).

import { ticks as d3ticks } from 'd3-array'
import { readLayout, writeLayout } from '../layout-pref.js'
import { sim, fmtRuntime } from '../sim.js'
import { ROLES } from '../vocab.js'
import { el, uptimeRing, bindRuntime, countUp, setViewMorph, makeTooltip } from '../components.js'
import { FleetGraph } from '../graph.js'
import '../board.css'

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

const reduceMotion = () => document.body.classList.contains('reduce-motion')
const rectCenter = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 })

/* ---------- board: the per-agent Runtime Statistics plot ---------- */
const CHART_N = 24                 // samples on screen
const CHART_H = 116                // svg height incl. the x-axis label band
const CHART_PAD = { l: 34, r: 10, t: 12, b: 30 }
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

// smooth polyline through the samples — quadratic midpoints, so the curve
// never overshoots past the data the way a spline would
function curveOf(pts) {
  if (pts.length < 2) return ''
  let d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2
    const my = (pts[i].y + pts[i + 1].y) / 2
    d += `Q${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`
  }
  const last = pts[pts.length - 1]
  return `${d}L${last.x.toFixed(1)} ${last.y.toFixed(1)}`
}

/**
 * The board's "Runtime Statistics" box: activity over time for ONE agent,
 * drawn with real hairline x/y axes like the sketch. Single series, so the
 * box header names it and carries the end value instead of a legend.
 * Returns { el, tick(ts), intro(), destroy() } — tick() is driven by the
 * view's existing rAF loop.
 */
function agentChartBox(agent) {
  const s = seriesFor(agent)
  const cur = s.vals.slice()                 // eased values actually on screen
  const box = el(`
    <div class="board-box board-chart-box">
      <div class="board-box-h">
        <span class="bh-t">Runtime Statistics</span>
        <span class="bh-v"><i></i><span><b class="bc-now">0</b>%</span></span>
      </div>
      <div class="board-cap">agent activity · last ${CHART_SPAN_MIN} min</div>
      <div class="board-plot"><div class="bc-canvas"></div></div>
    </div>
  `)

  const plot = box.querySelector('.board-plot')
  const canvas = box.querySelector('.bc-canvas')
  const nowEl = box.querySelector('.bc-now')
  const tip = makeTooltip(plot)

  let W = 0, g = null, p = null
  let frozen = true, lastStep = 0, shown = -1, stopCount = null
  let introDelay = null, introDone = false, safety = 0

  const minsAgo = (i) => Math.round((CHART_N - 1 - i) * (CHART_SPAN_MIN / (CHART_N - 1)))

  // static frame: axes, ticks, labels, hit area — rebuilt only on resize
  function frame(w) {
    W = w
    const x0 = CHART_PAD.l + 0.5
    const x1 = Math.max(x0 + 60, w - CHART_PAD.r) + 0.5
    const yTop = CHART_PAD.t + 0.5
    const yBot = CHART_H - CHART_PAD.b + 0.5
    g = {
      x0, x1, yTop, yBot,
      x: (i) => x0 + (i / (CHART_N - 1)) * (x1 - x0),
      y: (v) => yBot - (Math.max(0, Math.min(100, v)) / 100) * (yBot - yTop),
    }
    const yTick = (v) => `
      <line class="bc-tick" x1="${x0 - 3.5}" y1="${g.y(v)}" x2="${x0}" y2="${g.y(v)}"/>
      <text class="bc-t" x="${x0 - 8}" y="${g.y(v) + 4.5}" text-anchor="end">${v}</text>`

    // The value axis' stops used to be three hand-written calls — yTick(0),
    // yTick(50), yTick(100) — and the single gridline was separately hardcoded
    // at 50, so the label set and the grid were two facts that merely happened
    // to agree, and neither knew how tall the plot actually was. d3-array's
    // ticks() picks canonical 1/2/5 stops for the 0–100 domain, and the count
    // is derived from the real plot height at ~34px per label so the labels can
    // never crowd below the 12.5px type floor (a shorter box now drops a stop
    // instead of overlapping its neighbours). Every gridline is now literally
    // one of the labelled stops, so the grid cannot mean something the axis
    // does not say. At today's 74px plot this still resolves to 0 / 50 / 100.
    const yVals = d3ticks(0, 100, Math.max(1, Math.min(5, Math.round((yBot - yTop) / 34))))
    const gridLines = yVals
      .filter(v => v > 0 && v < 100)
      .map(v => `<line class="bc-gl bc-chrome" x1="${x0}" y1="${g.y(v)}" x2="${x1}" y2="${g.y(v)}"/>`)
      .join('')

    // once the board has drawn itself in, a later resize rebuilds the frame
    // finished — the axes must not re-draw every frame of a window drag
    canvas.innerHTML = `
      <svg class="bchart ${introDone ? 'bc-static' : ''}" width="${w}" height="${CHART_H}" viewBox="0 0 ${w} ${CHART_H}"
           role="img" aria-label="${agent.name} activity over the last ${CHART_SPAN_MIN} minutes">
        ${gridLines}
        <path class="bc-area" d=""/>
        <path class="bc-line" d=""/>
        <circle class="bc-pulse" r="5" cx="${x1}" cy="${g.y(50)}"/>
        <circle class="bc-end" r="4.5" cx="${x1}" cy="${g.y(50)}"/>
        <line class="bc-cross" x1="${x0}" y1="${yTop}" x2="${x0}" y2="${yBot}"/>
        <circle class="bc-dot" r="4" cx="${x0}" cy="${yBot}"/>
        <line class="bc-ax bc-ax-y" x1="${x0}" y1="${yBot}" x2="${x0}" y2="${yTop}" style="--len:${(yBot - yTop).toFixed(1)}px"/>
        <line class="bc-ax bc-ax-x" x1="${x0}" y1="${yBot}" x2="${x1}" y2="${yBot}" style="--len:${(x1 - x0).toFixed(1)}px"/>
        <g class="bc-chrome">
          ${yVals.map(yTick).join('')}
          <text class="bc-t" x="${x0 - 2}" y="${yBot + 20}" text-anchor="start">-${CHART_SPAN_MIN}m</text>
          <text class="bc-t" x="${(x0 + x1) / 2}" y="${yBot + 20}" text-anchor="middle">-${CHART_SPAN_MIN / 2}m</text>
          <text class="bc-t" x="${x1}" y="${yBot + 20}" text-anchor="end">now</text>
        </g>
        <rect class="bc-hit" x="${x0 - 6}" y="${yTop - 8}" width="${x1 - x0 + 12}" height="${yBot - yTop + 16}"/>
      </svg>`

    p = {
      svg: canvas.querySelector('svg'),
      area: canvas.querySelector('.bc-area'),
      line: canvas.querySelector('.bc-line'),
      end: canvas.querySelector('.bc-end'),
      pulse: canvas.querySelector('.bc-pulse'),
      cross: canvas.querySelector('.bc-cross'),
      dot: canvas.querySelector('.bc-dot'),
      hit: canvas.querySelector('.bc-hit'),
    }
    p.hit.addEventListener('pointermove', onHover)
    p.hit.addEventListener('pointerleave', offHover)
    paint()
    runIntro()
  }

  function paint() {
    if (!p || !g) return
    const pts = cur.map((v, i) => ({ x: g.x(i), y: g.y(v) }))
    const d = curveOf(pts)
    p.line.setAttribute('d', d)
    p.area.setAttribute('d', `${d}L${g.x1.toFixed(1)} ${g.yBot.toFixed(1)}L${g.x0.toFixed(1)} ${g.yBot.toFixed(1)}Z`)
    const last = pts[pts.length - 1]
    p.end.setAttribute('cx', last.x.toFixed(1))
    p.end.setAttribute('cy', last.y.toFixed(1))
    p.pulse.setAttribute('cx', last.x.toFixed(1))
    p.pulse.setAttribute('cy', last.y.toFixed(1))
  }

  function onHover(e) {
    if (!p || !g) return
    const r = p.svg.getBoundingClientRect()
    if (!r.width) return
    const x = (e.clientX - r.left) * (W / r.width)
    const i = Math.max(0, Math.min(CHART_N - 1, Math.round((x - g.x0) / (g.x1 - g.x0) * (CHART_N - 1))))
    const v = Math.round(cur[i])
    p.cross.setAttribute('x1', g.x(i).toFixed(1))
    p.cross.setAttribute('x2', g.x(i).toFixed(1))
    p.dot.setAttribute('cx', g.x(i).toFixed(1))
    p.dot.setAttribute('cy', g.y(cur[i]).toFixed(1))
    p.cross.style.opacity = '0.55'
    p.dot.style.opacity = '1'
    const m = minsAgo(i)
    tip.show(`<div class="tt-title">${agent.name}</div><b>${v}%</b> active · ${m ? `${m} min ago` : 'now'}`, e.clientX, e.clientY)
  }

  function offHover() {
    if (!p) return
    p.cross.style.opacity = '0'
    p.dot.style.opacity = '0'
    tip.hide()
  }

  function readout() {
    const v = Math.round(s.vals[CHART_N - 1])
    if (v === shown) return
    stopCount?.()
    stopCount = countUp(nowEl, shown < 0 ? v : shown, v, 600)
    shown = v
  }

  function pulse() {
    if (!p || reduceMotion()) return
    p.pulse.animate(
      [{ transform: 'scale(0.55)', opacity: 0.45 }, { transform: 'scale(2.7)', opacity: 0 }],
      { duration: 900, easing: MORPH_EASE },
    )
  }

  // The line draws itself in behind the rail cascade, like the axes above it.
  // The first frame only exists once the box has been laid out, so the caller's
  // delay is parked here and spent by frame().
  function intro(delay) {
    introDelay = delay
    readout()
    runIntro()
  }

  function runIntro() {
    if (introDone || introDelay == null || !p) return
    introDone = true
    const delay = introDelay
    if (reduceMotion()) { frozen = false; return }
    const len = p.line.getTotalLength() || 1
    p.line.style.strokeDasharray = `${len}`
    const draw = p.line.animate(
      [{ strokeDashoffset: len }, { strokeDashoffset: 0 }],
      { duration: CHART_INTRO_MS, delay, easing: MORPH_EASE, fill: 'backwards' },
    )
    const land = () => {
      if (p) p.line.style.strokeDasharray = ''
      frozen = false
      paint()
    }
    draw.onfinish = land
    // a resize mid-draw can strand the animation on a discarded path, so the
    // plot is never left frozen waiting for a finish event that never comes
    clearTimeout(safety)
    safety = setTimeout(land, delay + CHART_INTRO_MS + 220)
    p.area.animate([{ opacity: 0 }, { opacity: 1 }],
      { duration: 420, delay: delay + 220, easing: MORPH_EASE, fill: 'backwards' })
    p.end.animate([{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
      { duration: 340, delay: delay + CHART_INTRO_MS - 90, easing: 'cubic-bezier(0.34, 1.3, 0.4, 1)', fill: 'backwards' })
  }

  function tick(ts) {
    if (!p || !g) return
    if (ts - lastStep > CHART_STEP_MS) {
      if (lastStep) {
        // The ping marks a MEANINGFUL arrival. It used to fire on every
        // 4.2s step regardless of whether the value moved, which turns an
        // event signal into a metronome — the eye stops reading it as
        // information. Gate it on a real change in the sample.
        const prevV = s.vals[s.vals.length - 1]
        s.advance()
        readout()
        const nextV = s.vals[s.vals.length - 1]
        if (!frozen && Math.abs(nextV - prevV) >= 1.5) pulse()
      }
      lastStep = ts
    }
    const k = reduceMotion() ? 1 : 0.16
    let moved = false
    for (let i = 0; i < CHART_N; i++) {
      const d = s.vals[i] - cur[i]
      if (Math.abs(d) > 0.02) { cur[i] += d * k; moved = true }
    }
    if (moved && !frozen) paint()
  }

  const ro = new ResizeObserver((entries) => {
    const w = Math.round(entries[0].contentRect.width)
    if (w > 80 && w !== W) { frame(w); if (!frozen) paint() }
  })
  ro.observe(plot)

  return {
    el: box,
    tick,
    intro,
    destroy() {
      ro.disconnect()
      clearTimeout(safety)
      stopCount?.()
      tip.hide()
      p?.hit.removeEventListener('pointermove', onHover)
      p?.hit.removeEventListener('pointerleave', offHover)
      p = null
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
          <div class="graph-layout-seg" role="group" aria-label="Graph layout">
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
    let g = -1
    items.forEach((node, i) => {
      const starts = i === 0
        || node.classList.contains('rail-sec')
        || node.classList.contains('stat-hero')
        || node.classList.contains('agent-head')
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
              <div class="bar-track"><div class="bar-fill" style="--bc:${BAR_C};--bg-glow:${BAR_G};width:0%"></div></div>
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
      row.querySelector('.bar-fill').style.width = v + '%'
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
    ctlPage.style.setProperty('--role', role.hex)
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
          <span>${agent.tasksDone} tasks · ${agent.failRate}% fail</span>
        </div>
        <div class="board-box board-ctl-box">
          <div class="board-box-h"><span class="bh-t">Agent Controls</span></div>
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
          <div class="rail-sec">Tuning</div>
          <div class="ctl-row" data-t="ctx"><span class="cl">Context budget</span><input type="range" min="0" max="100" value="62"/><span class="cv">124k</span></div>
          <div class="ctl-row" data-t="wake"><span class="cl">Wake interval</span><input type="range" min="0" max="100" value="35"/><span class="cv">20m</span></div>
          <div class="ctl-row" data-t="auto"><span class="cl">Autonomy</span><input type="range" min="0" max="100" value="80"/><span class="cv">high</span></div>
          <div class="rail-sec">Session</div>
          <button class="ctl-btn" style="width:100%" data-a="open">
            <svg viewBox="0 0 24 24"><path d="M7 17 17 7M9 7h8v8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Open full view</button>
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
    `
    const scroll = ctlPage.querySelector('.rail-scroll')
    const ringWrap = ctlPage.querySelector('.agent-ring-wrap')

    // the ring scales with the rail, but never wider than the panel: at a
    // 320px rail this stays 190px, exactly where the digits already fit
    const ringSize = Math.max(180, Math.min(214, (railEl.clientWidth || 320) - 130))
    ctlRing = uptimeRing({
      size: ringSize, epoch: agent.bornAt,
      colors: [role.glow, role.hex],
      caption: 'Runtime', showDays: false,
    })
    ringWrap.appendChild(ctlRing.el)

    // the per-agent plot sits between the runtime and the controls, exactly
    // where "Runtime Statistics" sits on the sketch
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
  // a pixel per step). The chart is deliberately NOT throttled — its easing is
  // a per-frame fraction, so dropping frames there would change the animation
  // itself and not merely its cost.
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
