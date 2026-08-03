// Computers — tabs per machine, the liquid agent graph, and the right rail
// that morphs between Runtime Statistics and Agent Controls (dblclick a bubble).
//
// Lane T3 owns the continuity in here: the rail crossfades its blocks in a
// top-to-bottom cascade while the Agent Count hero number FLIPs into the agent
// runtime ring, tab switches dissolve the old graph and stagger the new bubbles
// in by mount order, and "Open full view" hands the shell the node's screen
// position so the outgoing view can scale straight into it.

import { sim, fmtRuntime } from '../sim.js'
import { ROLES } from '../vocab.js'
import { el, uptimeRing, bindRuntime, countUp, setViewMorph } from '../components.js'
import { FleetGraph } from '../graph.js'

const BAR_DEFS = [
  { key: 'cpu', label: 'CPU', c: 'var(--c-coordinator)', g: 'var(--g-coordinator)' },
  { key: 'gpu', label: 'GPU', c: 'var(--c-helper)', g: 'var(--g-helper)' },
  { key: 'net', label: 'Network', c: 'var(--c-shadow)', g: 'var(--g-shadow)' },
  { key: 'disk', label: 'Disk', c: 'var(--c-manager)', g: 'var(--g-manager)' },
]

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
        </div>
        <aside class="rail glass">
          <div class="rail-page stats-page"></div>
          <div class="rail-page ctl-page off-r"></div>
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
    renderCrumb(null)
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
    railTimeout(() => { ctlRing = null }, FLIP_MS + 120)
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
              <div class="bar-track"><div class="bar-fill" style="--bc:${b.c};--bg-glow:${b.g};width:0%"></div></div>
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

  function updateTasks() {
    const list = statsPage.querySelector('.task-list')
    if (!list) return
    list.innerHTML = ''
    for (const t of computer.tasks.slice(0, 8)) {
      const r = ROLES[t.role]
      list.appendChild(el(`<span class="task-chip ${t.done ? 'done' : ''}" style="--tc:${r.hex};--tg:${r.glow}"><i></i>${t.text}</span>`))
    }
  }

  /* ---------- rail: agent controls (the morph) ---------- */
  let ctlRing = null
  function showControls(agent) {
    clearRailTimers()
    const role = ROLES[agent.role]

    // the shared element's starting geometry, measured before the swap
    const heroEl = statsPage.querySelector('#agent-count')
    const heroRect = (heroEl && !statsPage.classList.contains('off-l'))
      ? heroEl.getBoundingClientRect() : null

    ctlPage.innerHTML = `
      <div class="rail-title">
        <button class="rail-back">‹ Statistics</button>
        <span class="spacer"></span>Agent Controls
      </div>
      <div class="rail-scroll">
        <div class="agent-head">
          <span class="role-dot" style="background:${role.hex};box-shadow:0 0 calc(10px*var(--glow)) ${role.glow}"></span>
          <div><div class="an">${agent.name}</div><div class="ar">${role.label}</div></div>
        </div>
        <div class="agent-ring-wrap"></div>
        <div class="rail-sub" style="text-align:center">model ${agent.model} · pool ${agent.pool} · ${agent.tasksDone} tasks · ${agent.failRate}% fail</div>
        <div class="rail-sec">Controls</div>
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
        <div class="ctl-row"><span class="cl">Context budget</span><input type="range" min="0" max="100" value="62"/><span class="cv">124k</span></div>
        <div class="ctl-row"><span class="cl">Wake interval</span><input type="range" min="0" max="100" value="35"/><span class="cv">20m</span></div>
        <div class="ctl-row"><span class="cl">Autonomy</span><input type="range" min="0" max="100" value="80"/><span class="cv">high</span></div>
        <div class="rail-sec">Session</div>
        <button class="ctl-btn" style="width:100%" data-a="open">
          <svg viewBox="0 0 24 24"><path d="M7 17 17 7M9 7h8v8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Open full view</button>
      </div>
    `
    const ringWrap = ctlPage.querySelector('.agent-ring-wrap')
    ctlRing = uptimeRing({
      size: 190, epoch: agent.bornAt,
      colors: [role.glow, role.hex],
      caption: 'Runtime', showDays: false,
    })
    ringWrap.appendChild(ctlRing.el)

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

    // the ring is the shared element — the FLIP owns it, so it stays out of
    // the cascade; everything else crossfades top-to-bottom around it
    const doFlip = !!heroRect && heroRect.height > 0 && !reduceMotion()
    cascadeIn(ctlPage, doFlip ? ringWrap : null)
    if (doFlip) flipHeroToRing({ heroEl, heroRect, ringEl: ctlRing.el })

    hidePage(statsPage, 'off-l')
  }

  /* ---------- boot ---------- */
  renderTabs()
  mountGraph()
  showStats()

  unsubs.push(sim.on('stats', updateBars))
  unsubs.push(sim.on('tasks', updateTasks))
  unsubs.push(sim.on('spawn', ({ comp }) => { if (comp === computer) updateBars() }))

  let raf
  const loop = () => { ctlRing?.update(); raf = requestAnimationFrame(loop) }
  raf = requestAnimationFrame(loop)

  return {
    el: root,
    destroy() {
      cancelAnimationFrame(raf)
      heroCount?.()
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
