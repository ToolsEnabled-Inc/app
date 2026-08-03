// FleetGraph — d3-force physics under HTML liquid-glass bubbles.
// SVG draws only the links; every bubble is a real backdrop-filter element,
// so the glass genuinely refracts the aurora and the links beneath it.

import { forceSimulation, forceLink, forceManyBody, forceCollide, forceX, forceY } from 'd3-force'
import { sim, fmtRuntime } from './sim.js'
import { ROLES } from './vocab.js'
import { el, buildChat, bindRuntime } from './components.js'
import './graph.css'

const RADII = { coordinator: 62, helper: 52, shadow: 52, manager: 47, default: 39 }
const CHIP_ROLES = new Set(['coordinator', 'helper', 'shadow'])
const DENSE_AT = 12

const prefersCalm = () => document.body.classList.contains('reduce-motion')
// axis-aligned rect intersection area (px²) — chip avoidance scoring
const rectOverlap = (ax, ay, aw, ah, bx, by, bw, bh) => {
  const w = Math.min(ax + aw, bx + bw) - Math.max(ax, bx)
  if (w <= 0) return 0
  const h = Math.min(ay + ah, by + bh) - Math.max(ay, by)
  return h > 0 ? w * h : 0
}
const hashStr = (s) => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

export class FleetGraph {
  constructor(container, { computer, rootId = null, onRootChange = null, onSelect = null, onOpenControls = null, chipsFor = CHIP_ROLES, chipPredicate = null }) {
    this.chipPredicate = chipPredicate
    this.container = container
    this.computer = computer
    this.rootId = rootId
    this.onRootChange = onRootChange
    this.onSelect = onSelect
    this.onOpenControls = onOpenControls
    this.chipsFor = chipsFor
    this.nodes = new Map()          // id -> node record
    this.selectedId = null
    this.unsubs = []

    container.classList.add('graph-canvas')
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    this.svg.setAttribute('class', 'links')
    container.appendChild(this.svg)

    this.W = container.clientWidth || 800
    this.H = container.clientHeight || 600
    // the canvas is usually still detached here (so W/H are the 800×600
    // fallbacks); the ResizeObserver's guaranteed initial delivery — after
    // layout, before paint — re-settles the graph at the true size
    this._bootResize = true
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(container)

    // C3 — wheel zoom + pan. The container IS the dedicated zoom layer: it
    // already wraps BOTH the svg link layer and the HTML node/chip layers,
    // so one transform scales everything together. Nodes stay its direct
    // children (agent.js's rim MutationObserver watches container childList).
    // Wheel/pan listeners and the fit control live on the parent panel
    // (.graph-wrap / .agentv-graph), which keeps its full hit area at any
    // zoom and never scales. All sim/clamp math stays in GRAPH coordinates
    // (0..W × 0..H — the container's untransformed layout box); pointer
    // events convert through the transform via _toGraph().
    this.zoom = 1; this.panX = 0; this.panY = 0
    this._zt = 1                       // eased-toward target scale
    this._zoomMode = 'anchor'          // 'anchor' (wheel) | 'fit' (reset)
    container.classList.add('zoomable')
    this.zoomHost = container.parentElement || container
    this.zoomHost.classList.add('graph-zoom-host')
    this._buildFitControl()
    this._onWheel = (e) => this._wheel(e)
    this._onHostDown = (e) => this._panStart(e)
    this._onHostMove = (e) => this._panMove(e)
    this._onHostUp = (e) => this._panEnd(e)
    this.zoomHost.addEventListener('wheel', this._onWheel, { passive: false })
    this.zoomHost.addEventListener('pointerdown', this._onHostDown)
    this.zoomHost.addEventListener('pointermove', this._onHostMove)
    this.zoomHost.addEventListener('pointerup', this._onHostUp)
    this.zoomHost.addEventListener('pointercancel', this._onHostUp)

    this.simulation = forceSimulation([])
      .velocityDecay(0.32)
      // 0.015 → 0.028: the old decay left the layout visibly untangling for
      // 5-12s after every reheat — far too slow for the short agent canvas.
      // Arrival is pre-settled before first paint (see _presettle), so the
      // live decay only has to cover spawns/re-roots, which now cool in
      // ~1.5s instead of ~4s.
      .alphaDecay(0.028)
      .on('tick', () => this.tick())

    // dev perf probe — HONEST numbers. window.__graphFrameMs is a rolling
    // average of the REAL rAF frame interval while this graph is mounted —
    // the number the 60fps criterion gates on. window.__graphTickMs is the
    // JS cost of tick() alone (for attribution), __graphNodeCount the live
    // node count. window.__graphStress(n, ms) raises the graph to n nodes
    // with synthetic probe bubbles, samples, cleans up, and resolves
    // { nodes, avgGraphMs }.
    this._frameAvg = 16.7
    this._tickAvg = 0
    this._tickCost = 0
    this._lastFrameT = 0
    const probe = (t) => {
      if (this._lastFrameT) {
        const dt = t - this._lastFrameT
        if (dt < 250) {                              // ignore tab-hidden gaps
          this._frameAvg += (dt - this._frameAvg) * 0.1
          window.__graphFrameMs = Math.round(this._frameAvg * 100) / 100
          window.__pageFrameMs = window.__graphFrameMs
          this._tickAvg += (this._tickCost - this._tickAvg) * 0.1
          window.__graphTickMs = Math.round(this._tickAvg * 100) / 100
          window.__graphNodeCount = this.nodes.size
        }
      }
      this._tickCost = 0
      this._lastFrameT = t
      this._perfRaf = requestAnimationFrame(probe)
    }
    this._perfRaf = requestAnimationFrame(probe)
    window.__graphStress = (count = 16, ms = 3000) => this._stress(count, ms)

    this.build(true)

    this.unsubs.push(
      sim.on('spawn', ({ comp, agent }) => { if (comp === this.computer) this.addAgent(agent) }),
      sim.on('reap', ({ comp, agent }) => { if (comp === this.computer) this.removeAgent(agent.id) }),
      sim.on('agent-state', ({ comp, agent }) => {
        if (comp !== this.computer) return
        const n = this.nodes.get(agent.id)
        if (!n) return
        if (n.el.classList.contains('spawning')) {
          n.el.classList.remove('spawning')
          n.el.classList.add('bloom')              // graphite → role color, ~900ms + glow burst
          clearTimeout(n._bloomTimer)
          n._bloomTimer = setTimeout(() => n.el.classList.remove('bloom'), 950)
        }
      }),
      sim.on('context', ({ comp, agent }) => {
        if (comp !== this.computer) return
        const n = this.nodes.get(agent.id)
        if (n?.chip && !n.chatOpen) this.renderChipPreview(n)
      }),
      sim.on('reparent', ({ comp, agent }) => {
        if (comp !== this.computer) return
        const n = this.nodes.get(agent.id)
        if (n) n.el.dataset.parentId = agent.parentId || ''
        this.refreshForces()
        if (this.editMode) this._layoutTree(true)
      }),
    )
  }

  /* ---------- membership ---------- */

  visibleAgents() {
    const all = this.computer.agents
    if (!this.rootId) return [...all]
    const keep = new Set([this.rootId])
    let grew = true
    while (grew) {
      grew = false
      for (const a of all) {
        if (a.parentId && keep.has(a.parentId) && !keep.has(a.id)) { keep.add(a.id); grew = true }
      }
    }
    return all.filter(a => keep.has(a.id))
  }

  depthOf(a) {
    let d = 0, cur = a
    const byId = new Map(this.computer.agents.map(x => [x.id, x]))
    while (cur?.parentId && d < 10) { cur = byId.get(cur.parentId); d++ }
    return d
  }

  build(initial = false) {
    const agents = this.visibleAgents()
    const wanted = new Set(agents.map(a => a.id))

    for (const [id, n] of [...this.nodes]) {
      if (!wanted.has(id)) this.removeNode(n, true, this._staggerDelays?.get(id) || 0)
    }
    for (const a of agents) {
      if (!this.nodes.has(a.id)) this.spawnNode(a, initial)
    }
    this.refreshForces(initial)
    this.updateDensity()
    // first paint must be legible: settle the physics before the user ever
    // sees it (re-roots keep their live cinematic — they reuse warm positions)
    if (initial) this._presettle()
  }

  /** Run the simulation to (near) rest synchronously, then draw once.
      Manual simulation.tick() dispatches no events, so this is a few ms of
      pure math with no intermediate frames — the graph ARRIVES settled
      instead of untangling itself in front of the user (the rejected
      30-42px bubble-on-bubble overlaps still visible at t=8s). Called at
      construction and again on the ResizeObserver's initial delivery. */
  _presettle() {
    let guard = 0
    while (this.simulation.alpha() > 0.03 && guard++ < 360) this.simulation.tick()
    this._snapChips = true                       // chips land, not glide, on reveal
    this.tick()                                  // paint the resolved layout now
    this._snapChips = false
  }

  spawnNode(agent, initial) {
    const r = RADII[agent.role] || 39
    const role = ROLES[agent.role]
    const parent = this.nodes.get(agent.parentId)
    // spawned bubbles used to drop straight onto occupied space (worker-13
    // popping in on top of existing bubbles) — pick the clearest ring slot
    const [cx, cy] = this._spawnSpot(r, parent)
    // label-block metrics, estimated from text length (no forced reflow):
    // the name/role rows hang ~41px below the bubble and are physical for
    // both the label-avoid force and chip placement
    const labelW = Math.max(
      70,
      agent.name.length * 7.6 + 18,                    // 12.5px/600 name + status dot
      Math.min(role.label.length * 7.4, r * 2 + 68),   // role row is CSS-capped at --d+68
    )

    const nodeEl = el(`
      <div class="node role-${agent.role} ${agent.state === 'spawning' ? 'spawning' : ''} ${initial ? '' : 'enter'}" style="--d:${r * 2}px">
        <div class="node-glass">
          <div style="text-align:center">
            <div class="rt">0:00:00</div>
            <div class="rl">Runtime</div>
          </div>
        </div>
        <span class="node-name"><i></i>${agent.name}</span>
        <span class="node-role">${role.label}</span>
      </div>
    `)
    this.container.appendChild(nodeEl)

    const rec = {
      id: agent.id, agent, el: nodeEl, r,
      x: cx, y: cy, vx: 0, vy: 0,
      chip: null, chatOpen: false, chipW: 168, chipH: 44,
      labelW, labelH: 41,
      _cx: null, _cy: null,                            // chip's eased slot position
    }
    nodeEl.style.transform = `translate(${cx}px, ${cy}px) translate(-50%,-50%)`
    nodeEl.dataset.agentId = agent.id                  // C8: hierarchy is
    nodeEl.dataset.parentId = agent.parentId || ''     // assertable in the DOM
    this.nodes.set(agent.id, rec)

    this.unsubs.push(bindRuntime(nodeEl.querySelector('.rt'), () => agent.bornAt))
    this.wireInteractions(rec)

    const wantsChip = this.chipPredicate ? this.chipPredicate(agent) : this.chipsFor.has(agent.role)
    if (wantsChip) this.makeChip(rec)
    return rec
  }

  makeChip(rec) {
    const chip = el(`<div class="chip role-${rec.agent.role}"><div class="chip-preview"></div></div>`)
    this.container.appendChild(chip)
    rec.chip = chip
    this.renderChipPreview(rec)
    chip.addEventListener('click', () => { if (!rec.chatOpen) this.openChat(rec) })
  }

  renderChipPreview(rec) {
    const pv = rec.chip.querySelector('.chip-preview')
    pv.innerHTML = rec.agent.context.map((c, i) =>
      `<div class="cl">${i === 0 ? `<b>${rec.agent.name}</b> · ` : ''}${c}</div>`).join('')
    rec.chipH = rec.chip.offsetHeight || 44
    // context arrives while the sim sleeps too — without a live tick the
    // grown preview would quietly expand over a neighbour (the rejected
    // "persisting past t=8s" overlaps) or past the canvas edge; re-place now
    if (this.simulation.alpha() < 0.02) this.tick()
  }

  openChat(rec) {
    const chip = rec.chip
    clearTimeout(rec._chipTimer)
    chip.querySelector('.chat')?.remove()
    rec.prevH = chip.offsetHeight
    chip.style.width = chip.offsetWidth + 'px'
    chip.style.height = rec.prevH + 'px'
    void chip.offsetWidth
    chip.classList.add('as-chat')
    if (rec._chipDim) { rec._chipDim = false; chip.classList.remove('chip-dim') }
    rec.chatOpen = true
    rec.chipW = 316; rec.chipH = 368

    const chat = buildChat({
      title: rec.agent.name,
      subtitle: `${ROLES[rec.agent.role].label} · context`,
      roleKey: rec.agent.role,
      onClose: () => this.closeChat(rec),
    })
    chip.appendChild(chat)

    chip.style.width = '316px'
    chip.style.height = '368px'
    rec._chipTimer = setTimeout(() => { if (rec.chatOpen) { chip.style.width = ''; chip.style.height = '' } }, 520)
    // the sim may be asleep — re-place now (snapped: a lone tick's ease
    // would strand the chat mid-glide) so the 316×368 chat is clamped and
    // slotted for its real size instead of the old preview's
    if (this.simulation.alpha() < 0.02) {
      this._snapChips = true; this.tick(); this._snapChips = false
    }
  }

  closeChat(rec) {
    const chip = rec.chip
    clearTimeout(rec._chipTimer)
    chip.style.width = chip.offsetWidth + 'px'
    chip.style.height = chip.offsetHeight + 'px'
    void chip.offsetWidth
    chip.classList.remove('as-chat')
    rec.chatOpen = false
    chip.style.width = '168px'
    chip.style.height = (rec.prevH || 44) + 'px'
    rec._chipTimer = setTimeout(() => {
      chip.querySelector('.chat')?.remove()
      chip.style.width = ''; chip.style.height = ''
      this.renderChipPreview(rec)
    }, 500)
    rec.chipW = 168; rec.chipH = rec.prevH || 44
    if (this.simulation.alpha() < 0.02) {             // asleep sim: re-place now
      this._snapChips = true; this.tick(); this._snapChips = false
    }
  }

  removeNode(rec, animate, delay = 0) {
    if (rec._flingRaf) { cancelAnimationFrame(rec._flingRaf); rec._flingRaf = null }
    this.nodes.delete(rec.id)
    if (rec.chip) { rec.chip.remove() }
    if (animate) {
      const go = () => {
        rec.el.classList.add('leave')
        setTimeout(() => rec.el.remove(), 520)
      }
      if (delay > 0) setTimeout(go, delay)
      else go()
    } else rec.el.remove()
  }

  addAgent(agent) {
    if (this.rootId) {
      const visible = new Set(this.visibleAgents().map(a => a.id))
      if (!visible.has(agent.id)) return
    }
    this.spawnNode(agent, false)
    this.refreshForces()
    this.updateDensity()
    if (this.editMode) { this.simulation.stop(); this._layoutTree(true) }
  }

  removeAgent(id) {
    const rec = this.nodes.get(id)
    if (!rec) return
    if (rec.chatOpen) this.closeChat(rec)
    this.removeNode(rec, true)
    this.refreshForces()
    this.updateDensity()
    if (this.editMode) { this.simulation.stop(); this._layoutTree(true) }
  }

  /* ---------- forces ---------- */

  refreshForces(hard = false) {
    const nodes = [...this.nodes.values()]
    const links = []
    for (const n of nodes) {
      const p = this.nodes.get(n.agent.parentId)
      if (p) links.push({ source: p, target: n })
    }
    this.links = links
    this.renderLinkEls()

    this.simulation.nodes(nodes)
    this.simulation
      .force('link', forceLink(links).distance(l => l.source.r + l.target.r + 74).strength(0.55))
      .force('charge', forceManyBody().strength(-460).distanceMax(520))
      .force('collide', forceCollide().radius(n => n.r + 30).strength(0.95).iterations(2))
      .force('labels', this._labelAvoidForce(nodes))
      .force('x', forceX(this.W / 2).strength(n => (this.isRoot(n) ? 0.16 : 0.045)))
      .force('y', forceY(n => (this.isRoot(n) ? this.H * 0.42 : this.H * 0.55)).strength(n => (this.isRoot(n) ? 0.16 : 0.05)))
    // soft reheat 0.7 → 0.55: with the faster alphaDecay this keeps spawn /
    // re-root churn well under 2s while the glide cinematic (680ms) still
    // has live ticks for its whole run
    this.simulation.alpha(hard ? 1 : 0.55).restart()
  }

  /** Bubble collision only kept CIRCLES apart — the name/role block hanging
      ~41px below each bubble had no physical presence, so neighbours settled
      straight through label text ("SHADOW MANAGER" rendered through a
      runtime clock). This pair force makes every label block solid: any
      bubble intruding on the rectangle is pushed out along the closest-point
      normal (and the label's owner nudged the other way). The correction is
      alpha-independent, like forceCollide, so the separation holds all the
      way to rest. O(n²) at n ≤ ~16 — negligible next to charge. */
  _labelAvoidForce(nodes) {
    return () => {
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i]
        const hw = (a.labelW || 100) / 2
        const top = a.y + a.r + 2
        const bot = a.y + a.r + (a.labelH || 41)
        for (let j = 0; j < nodes.length; j++) {
          if (j === i) continue
          const b = nodes[j]
          const px = Math.max(a.x - hw, Math.min(a.x + hw, b.x))
          const py = Math.max(top, Math.min(bot, b.y))
          let dx = b.x - px, dy = b.y - py
          const min = b.r + 8
          const d2 = dx * dx + dy * dy
          if (d2 >= min * min) continue
          let d = Math.sqrt(d2)
          if (d < 1e-3) { dx = 0; dy = -1; d = 1 }
          const push = ((min - d) / d) * 0.5
          b.vx += dx * push * 0.6; b.vy += dy * push * 0.6
          a.vx -= dx * push * 0.4; a.vy -= dy * push * 0.4
        }
      }
    }
  }

  /** Landing spot for a new bubble: ring of candidates around the parent
      (or the canvas centre for a rootless node), each scored against every
      existing bubble AND its label block; the first clear slot — random
      phase, so spawns stay lively — or failing that the least-crowded one.
      Initial builds use it too, so _presettle starts from a sane spread. */
  _spawnSpot(r, parent) {
    const ax = parent ? parent.x : this.W / 2
    const ay = parent ? parent.y : this.H / 2
    const ring = (parent ? parent.r : 0) + r + 52
    const phase = Math.random() * Math.PI * 2
    const cands = parent ? [] : [[ax, ay]]
    for (let k = 0; k < 14; k++) {
      const ang = phase + (k / 14) * Math.PI * 2
      cands.push([ax + Math.cos(ang) * ring, ay + Math.sin(ang) * ring * 0.9 + (parent ? 26 : 0)])
    }
    let best = cands[0], bestCost = Infinity
    for (let [x, y] of cands) {
      x = Math.max(r + 34, Math.min(this.W - r - 34, x))
      y = Math.max(r + 64, Math.min(this.H - r - 58, y))
      let cost = 0
      for (const o of this.nodes.values()) {
        const need = o.r + r + 30
        const d = Math.hypot(x - o.x, y - o.y)
        if (d < need) cost += (need - d) ** 2
        const hw = (o.labelW || 100) / 2
        const px = Math.max(o.x - hw, Math.min(o.x + hw, x))
        const py = Math.max(o.y + o.r + 2, Math.min(o.y + o.r + (o.labelH || 41), y))
        const dl = Math.hypot(x - px, y - py)
        if (dl < r + 8) cost += (r + 8 - dl) ** 2
      }
      if (cost < bestCost) { bestCost = cost; best = [x, y] }
      if (cost === 0 && parent) break
    }
    return best
  }

  isRoot(n) {
    if (this.rootId) return n.id === this.rootId
    return n.agent.role === 'coordinator'
  }

  renderLinkEls() {
    this.svg.innerHTML = ''
    for (const l of this.links) {
      const hex = ROLES[l.target.agent.role].hex
      // deterministic per-link curvature so curves never flip between rebuilds
      const hv = hashStr(`${l.source.id}→${l.target.id}`)
      l.side = hv % 2 ? 1 : -1
      l.bendMul = 0.85 + (hv % 8) * 0.04
      const under = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      under.setAttribute('class', 'link-under')
      under.setAttribute('stroke', hex)
      under.setAttribute('stroke-width', '6')
      const top = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      top.setAttribute('class', 'link-top')
      top.setAttribute('stroke', hex)
      top.setAttribute('stroke-width', '1.6')
      this.svg.appendChild(under); this.svg.appendChild(top)
      l.underEl = under; l.topEl = top
    }
  }

  /* ---------- per-frame ---------- */

  tick() {
    const _t0 = performance.now()
    // hot-state switch: while the sim is energetic (spawns, re-roots, drags)
    // the canvas runs in reduced-fidelity mode; it settles back automatically
    const hot = this._draggingNow || this._zoomHot || this.simulation.alpha() > 0.04
    if (hot !== this._hot) {
      this._hot = hot
      this.container.classList.toggle('interacting', hot)
    }
    const padX = 34, padTop = 64, padBot = 58
    const cx0 = this.W / 2, cy0 = this.H / 2
    for (const n of this.nodes.values()) {
      n.x = Math.max(n.r + padX, Math.min(this.W - n.r - padX, n.x))
      n.y = Math.max(n.r + padTop, Math.min(this.H - n.r - padBot, n.y))
      n.el.style.transform = `translate(${n.x}px, ${n.y}px) translate(-50%,-50%)`
      if (n.chip) this._placeChip(n, cx0, cy0)
    }
    for (const l of this.links || []) {
      const s = l.source, t = l.target
      const dx = t.x - s.x, dy = t.y - s.y
      const L = Math.hypot(dx, dy) || 1
      // organic quadratic bend perpendicular to the chord, 12–24px by distance
      const bendAbs = Math.max(12, Math.min(24, L * 0.11 * (l.bendMul || 1)))
      const bend = bendAbs * (l.side || 1)
      const qx = (s.x + t.x) / 2 + (-dy / L) * bend
      const qy = (s.y + t.y) / 2 + (dx / L) * bend
      // trim endpoints to the bubble edges along the curve's launch direction
      const dsx = qx - s.x, dsy = qy - s.y, dsl = Math.hypot(dsx, dsy) || 1
      const sx = s.x + (dsx / dsl) * (s.r + 2), sy = s.y + (dsy / dsl) * (s.r + 2)
      const dtx = qx - t.x, dty = qy - t.y, dtl = Math.hypot(dtx, dty) || 1
      const tx = t.x + (dtx / dtl) * (t.r + 2), ty = t.y + (dty / dtl) * (t.r + 2)
      const d = `M${sx.toFixed(1)} ${sy.toFixed(1)} Q${qx.toFixed(1)} ${qy.toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)}`
      l.underEl?.setAttribute('d', d)
      l.topEl?.setAttribute('d', d)
    }
    this._tickCost += performance.now() - _t0
  }

  /** Chip placement with avoidance. The old rule ("radially outward from
      the cluster centre, clamp to canvas") wrote chips straight over
      neighbouring bubbles and their own node's name/role rows (40-56px
      measured overlap), and a clamp against a stale W could pin one off the
      panel edge. Now every chip elects the least-occluding slot from a ring
      of candidates around its bubble — scored against every bubble, every
      label block, sibling chips and a live canvas-bounds clamp, all in
      GRAPH coordinates so zoom keeps working — with hysteresis so it never
      flip-flops, easing so a slot change glides, and a last-resort fade
      (.chip-dim) when a crowded small canvas leaves no clear slot at all. */
  _placeChip(n, cx0, cy0) {
    const cw = n.chatOpen ? 316 : n.chipW
    const ch = n.chatOpen ? 368 : n.chipH
    const bx = (x) => Math.max(6, Math.min(this.W - cw - 6, x))
    const by = (y) => Math.max(6, Math.min(this.H - ch - 6, y))
    // slot 0 is the historical radially-outward anchor; the rest are compass
    // fallbacks (the below slot clears the node's own label block)
    const dx = n.x - cx0, dy = n.y - cy0
    const len = Math.hypot(dx, dy) || 1
    const ux = dx / len, uy = dy / len
    let ox = n.x + ux * (n.r + 20)
    if (ux < 0) ox -= cw
    const lh = n.labelH || 41
    const cands = [
      [ox, n.y + uy * (n.r + 20) - ch / 2],
      [n.x + n.r + 16, n.y - ch / 2],                  // right
      [n.x - n.r - 16 - cw, n.y - ch / 2],             // left
      [n.x - cw / 2, n.y - n.r - 14 - ch],             // above
      [n.x - cw / 2, n.y + n.r + lh + 12],             // below own labels
      [n.x + n.r * 0.55, n.y - n.r - 6 - ch],          // above-right
      [n.x - n.r * 0.55 - cw, n.y - n.r - 6 - ch],     // above-left
      [n.x + n.r + 16, n.y + n.r * 0.3],               // low-right
    ]
    // outer ring + edge parking: on a crowded small canvas the near anchors
    // can ALL be occupied — a clear pocket a little further out (still
    // role-tinted and hover-associated) beats writing over a neighbour
    const ring = n.r + 106
    for (let k = 0; k < 10; k++) {
      const ang = (k / 10) * Math.PI * 2
      cands.push([n.x + Math.cos(ang) * ring - cw / 2, n.y + Math.sin(ang) * ring - ch / 2])
    }
    cands.push([8, 8], [this.W - cw - 8, 8], [8, this.H - ch - 8], [this.W - cw - 8, this.H - ch - 8])
    const clamped = cands.map(([x, y]) => [bx(x), by(y)])
    const evals = clamped.map(([x, y]) => {
      let s = 0, occ = 0
      for (const o of this.nodes.values()) {
        const bub = rectOverlap(x, y, cw, ch, o.x - o.r, o.y - o.r, o.r * 2, o.r * 2)
        const hw = (o.labelW || 100) / 2
        const lab = rectOverlap(x, y, cw, ch, o.x - hw, o.y + o.r + 2, hw * 2, o.labelH || 41)
        if (o === n) s += bub * 0.6 + lab * 1.8        // own name/role weigh MOST
        else { s += bub + lab * 1.1; occ += bub + lab }
        if (o !== n && o.chip && o._cx != null) {
          s += rectOverlap(x, y, cw, ch, o._cx, o._cy,
            o.chatOpen ? 316 : o.chipW, o.chatOpen ? 368 : o.chipH) * 0.5
        }
      }
      s += Math.hypot(x + cw / 2 - n.x, y + ch / 2 - n.y) * 2   // stay near the node
      return { s, occ }
    })
    let bestI = 0
    for (let i = 1; i < evals.length; i++) if (evals[i].s < evals[bestI].s) bestI = i
    let slot = n._chipSlot
    if (n.chatOpen) slot = slot ?? bestI               // an open chat never re-elects
    else if (slot == null || evals[slot].s - evals[bestI].s > 900) slot = bestI
    n._chipSlot = slot
    const [tx, ty] = clamped[slot]
    if (this._snapChips || prefersCalm() || n._cx == null) { n._cx = tx; n._cy = ty }
    else {
      n._cx += (tx - n._cx) * 0.35
      n._cy += (ty - n._cy) * 0.35
      if (Math.abs(tx - n._cx) < 1) n._cx = tx
      if (Math.abs(ty - n._cy) < 1) n._cy = ty
    }
    n.chip.style.transform = `translate(${n._cx}px, ${n._cy}px)`
    // fade only as a last resort, with a wide on/off band so it can't flicker
    const dim = !n.chatOpen && (n._chipDim ? evals[slot].occ > 600 : evals[slot].occ > 1500)
    if (dim !== !!n._chipDim) {
      n._chipDim = dim
      n.chip.classList.toggle('chip-dim', dim)
    }
  }

  /** Dev-only (reached via window.__graphStress): raise the graph to `count`
      nodes with synthetic probe agents, keep the sim ticking, sample the
      frame probe for `ms` (after a 400ms EMA warm-up), remove the probes,
      and resolve { nodes, avgGraphMs }. */
  _stress(count = 16, ms = 3000) {
    return new Promise((resolve) => {
      if (this._destroyed) { resolve({ nodes: 0, avgGraphMs: null }); return }
      const parentId = [...this.nodes.keys()][0] || null
      const added = []
      let i = 0
      while (this.nodes.size < count) {
        i++
        const fake = {
          id: `__probe-${Date.now()}-${i}`, name: `probe-${i}`, role: 'default',
          state: 'running', bornAt: Date.now(), parentId, context: [],
        }
        const rec = this.spawnNode(fake, false)
        if (rec.chip) { rec.chip.remove(); rec.chip = null }
        added.push(rec)
      }
      this.refreshForces()
      this.simulation.alphaTarget(0.12).restart()  // keep ticking while sampling
      const t0 = performance.now()
      let sum = 0, n = 0
      const sample = (t) => {
        if (this._destroyed) { resolve({ nodes: count, avgGraphMs: null }); return }
        if (t - t0 > 400) { sum += this._frameAvg; n++ }
        if (t - t0 < ms) { requestAnimationFrame(sample); return }
        this.simulation.alphaTarget(0)
        for (const rec of added) if (this.nodes.has(rec.id)) this.removeNode(rec, false)
        this.refreshForces()
        resolve({ nodes: count, avgGraphMs: Math.round((sum / Math.max(1, n)) * 100) / 100 })
      }
      requestAnimationFrame(sample)
    })
  }

  /* ---------- interaction: drag / click / dblclick ---------- */

  wireInteractions(rec) {
    const elm = rec.el
    let startX = 0, startY = 0, moved = false, pid = null
    let clickTimer = null
    let samples = []                 // recent pointer positions for fling velocity

    let offX = 0, offY = 0
    elm.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      if (rec._flingRaf) { cancelAnimationFrame(rec._flingRaf); rec._flingRaf = null }
      pid = e.pointerId
      elm.setPointerCapture(pid)
      startX = e.clientX; startY = e.clientY; moved = false
      samples = [{ x: e.clientX, y: e.clientY, t: performance.now() }]
      const g = this._toGraph(e)                     // graph coords at any zoom
      offX = rec.x - g.x
      offY = rec.y - g.y
    })

    elm.addEventListener('pointermove', (e) => {
      if (pid === null) return
      samples.push({ x: e.clientX, y: e.clientY, t: performance.now() })
      if (samples.length > 6) samples.shift()
      const dx = e.clientX - startX, dy = e.clientY - startY
      if (!moved && Math.hypot(dx, dy) > 5) {
        moved = true
        elm.classList.add('dragging')
        if (this.editMode) {
          rec._editDragging = true                    // relayout keeps hands off
        } else {
          this._draggingNow = true
          this.container.classList.add('interacting') // immediate; tick() sustains it
          this.simulation.alphaTarget(0.28).restart()
        }
      }
      if (moved) {
        const g = this._toGraph(e)                   // clamp in GRAPH coords
        rec.fx = Math.max(rec.r, Math.min(this.W - rec.r, g.x + offX))
        rec.fy = Math.max(rec.r, Math.min(this.H - rec.r, g.y + offY))
        if (this.editMode) {
          rec.x = rec.fx; rec.y = rec.fy             // sim is paused: render by hand
          this._updateDropTarget(rec)
          this.tick()
        }
      }
    })

    // hover: ONE self-removing ripple ring from the bubble edge
    elm.addEventListener('pointerenter', () => {
      if (prefersCalm()) return
      rec._ripple?.remove()
      const rip = document.createElement('span')
      rip.className = 'node-ripple'
      elm.appendChild(rip)
      rec._ripple = rip
      const gone = () => { rip.remove(); if (rec._ripple === rip) rec._ripple = null }
      rip.addEventListener('animationend', gone, { once: true })
      setTimeout(gone, 900)          // safety net — no element leaks
    })

    const release = (e) => {
      if (pid === null) return
      try { elm.releasePointerCapture(pid) } catch {}
      pid = null
      if (moved) {
        elm.classList.remove('dragging')
        if (this.editMode) {                           // C8: drop = re-parent
          this._editDrop(rec)
          samples = []
          return
        }
        this._draggingNow = false                      // tick() cools the canvas as alpha decays
        elm.classList.add('settling')                  // brief ~0.97 overshoot
        clearTimeout(rec._settleTimer)
        rec._settleTimer = setTimeout(() => elm.classList.remove('settling'), 600)
        this.simulation.alphaTarget(0)
        // fling: recent pointer velocity in px/ms (capped ~2.4 ≈ 40px/frame)
        let vx = 0, vy = 0
        if (!prefersCalm()) {
          const tN = performance.now()
          const recent = samples.filter(s => tN - s.t < 160)
          if (recent.length >= 2) {
            const a = recent[0], b = recent[recent.length - 1]
            const dt = Math.max(16, b.t - a.t)
            vx = (b.x - a.x) / dt / this.zoom        // screen → graph velocity
            vy = (b.y - a.y) / dt / this.zoom
            const sp = Math.hypot(vx, vy), cap = 2.4
            if (sp > cap) { vx *= cap / sp; vy *= cap / sp }
          }
        }
        samples = []
        // Ballistic glide through fx/fy: raw d3 velocity is eaten by the
        // restoring forces the moment alpha rises (link 0.55 + charge -460
        // dwarf a decaying vx), which inverted the throw. Pinning the node to
        // a decaying throw path makes the fling mechanical — forces cannot
        // reverse it — then the residual velocity is handed to the sim.
        if (Math.hypot(vx, vy) > 0.12) this.startFling(rec, vx, vy)
        else { rec.fx = null; rec.fy = null }
        return
      }
      rec.fx = null; rec.fy = null
      if (this.editMode) { this._layoutTree(false); return }  // clicks are inert while editing
      const t = performance.now()
      if (t - (rec._lastClick || 0) < 380) {          // manual dblclick detection —
        rec._lastClick = 0                             // e.detail is unreliable here
        clearTimeout(clickTimer)
        this.onOpenControls?.(rec.agent)
        return
      }
      rec._lastClick = t
      clearTimeout(clickTimer)
      clickTimer = setTimeout(() => this.handleClick(rec), 390)
    }
    elm.addEventListener('pointerup', release)
    elm.addEventListener('pointercancel', release)
  }

  /** Post-drag fling: pin the node to a decaying ballistic path through
      fx/fy (same clamps as tick()) so restoring forces cannot reverse the
      throw, then hand the residual velocity back to the simulation.
      vx/vy in px/ms. */
  startFling(rec, vx, vy) {
    if (rec._flingRaf) cancelAnimationFrame(rec._flingRaf)
    const t0 = performance.now()
    let last = t0
    rec.fx = rec.x; rec.fy = rec.y
    const step = (t) => {
      const dt = Math.min(48, Math.max(0, t - last)); last = t
      rec.fx = Math.max(rec.r + 34, Math.min(this.W - rec.r - 34, rec.fx + vx * dt))
      rec.fy = Math.max(rec.r + 64, Math.min(this.H - rec.r - 58, rec.fy + vy * dt))
      const k = Math.exp(-0.008 * dt)                // exponential friction
      vx *= k; vy *= k
      // keep the sim ticking gently so the pin renders and neighbors yield —
      // never spike alpha (the alpha bump is what let forces eat the fling)
      if (this.simulation.alpha() < 0.1) this.simulation.alpha(0.1)
      this.simulation.restart()
      if (Math.hypot(vx, vy) > 0.04 && t - t0 < 900) {
        rec._flingRaf = requestAnimationFrame(step)
      } else {
        rec._flingRaf = null
        rec.vx = vx * 16.7; rec.vy = vy * 16.7       // px/ms → px/tick residual
        rec.fx = null; rec.fy = null
      }
    }
    rec._flingRaf = requestAnimationFrame(step)
  }

  handleClick(rec) {
    if (rec.el.classList.contains('focusable')) {
      this.setRoot(rec.id)
      return
    }
    this.select(rec.id)
  }

  select(id) {
    this.selectedId = id
    for (const n of this.nodes.values()) n.el.classList.toggle('selected', n.id === id)
    const rec = this.nodes.get(id)
    if (rec) this.onSelect?.(rec.agent)
  }

  /* ---------- density + re-rooting ---------- */

  updateDensity() {
    const n = this.nodes.size
    const dense = !this.rootId && n >= DENSE_AT
    for (const rec of this.nodes.values()) {
      const hasKids = [...this.nodes.values()].some(o => o.agent.parentId === rec.id)
      const deep = this.depthOf(rec.agent) >= 1
      rec.el.classList.toggle('focusable', dense && hasKids && deep)
      if (rec.chip) rec.chip.style.opacity = (n >= DENSE_AT && !rec.chatOpen) ? '0' : ''
      if (rec.chip) rec.chip.style.pointerEvents = (n >= DENSE_AT && !rec.chatOpen) ? 'none' : ''
    }
    this.onDensity?.(dense)
  }

  setRoot(id) {
    const fromRec = this.nodes.get(id)
    this.rootId = id
    // stagger-fade the non-subtree nodes (~40ms apart, nearest first)
    const keep = new Set(this.visibleAgents().map(a => a.id))
    const outgoing = [...this.nodes.values()].filter(n => !keep.has(n.id))
    if (fromRec) outgoing.sort((a, b) =>
      Math.hypot(a.x - fromRec.x, a.y - fromRec.y) - Math.hypot(b.x - fromRec.x, b.y - fromRec.y))
    const calm = prefersCalm()
    this._staggerDelays = new Map(outgoing.map((n, i) => [n.id, calm ? 0 : Math.min(i * 40, 560)]))
    this.build()
    this._staggerDelays = null
    // the re-root cinematic targets the graph-space root slot — glide the
    // viewport back to 1× alongside so the arrival is always on screen
    if (this._zt !== 1 || this.panX || this.panY) this.resetZoom()
    const rec = this.nodes.get(id)
    if (rec) this.glideToRoot(rec)
    this.onRootChange?.(id, this.ancestryOf(id))   // extra arg is additive
    this.renderAncestry()
  }

  /** Tween the newly-chosen root into the root slot (arrives ≤800ms). */
  glideToRoot(rec) {
    if (rec._flingRaf) { cancelAnimationFrame(rec._flingRaf); rec._flingRaf = null }
    if (this._glideRaf) { cancelAnimationFrame(this._glideRaf); this._glideRaf = null }
    if (this._glideRec && this._glideRec !== rec) {
      this._glideRec.fx = null; this._glideRec.fy = null
      this._glideRec.el.classList.remove('rerooting')
    }
    this._glideRec = rec
    rec.el.classList.add('rerooting')
    const tx = this.W / 2, ty = this.H * 0.42
    const done = () => setTimeout(() => {
      rec.fx = null; rec.fy = null
      rec.el.classList.remove('rerooting')
      if (this._glideRec === rec) this._glideRec = null
    }, 220)
    if (prefersCalm()) { rec.fx = tx; rec.fy = ty; done(); return }
    const sx = rec.x, sy = rec.y, dur = 680, t0 = performance.now()
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur)
      const e = 1 - Math.pow(1 - p, 3)               // ease-out cubic
      rec.fx = sx + (tx - sx) * e
      rec.fy = sy + (ty - sy) * e
      if (p < 1) this._glideRaf = requestAnimationFrame(step)
      else { this._glideRaf = null; done() }
    }
    this._glideRaf = requestAnimationFrame(step)
  }

  /** Parent chain (top ancestor → node) as [{ id, name }] — additive contract. */
  ancestryOf(id) {
    const byId = new Map(this.computer.agents.map(a => [a.id, a]))
    const chain = []
    let cur = byId.get(id), guard = 0
    while (cur && guard++ < 12) {
      chain.unshift({ id: cur.id, name: cur.name })
      cur = cur.parentId ? byId.get(cur.parentId) : null
    }
    return chain
  }

  /** Rebuild the sibling .graph-crumb with the full clickable ancestry.
      Runs after onRootChange so the host's own render stays working; every
      ancestor re-roots, the machine name clears the root. */
  renderAncestry() {
    const crumbEl = this.container.parentElement?.querySelector('.graph-crumb')
    if (!crumbEl || !this.rootId) return
    const chain = this.ancestryOf(this.rootId)
    if (!chain.length) return
    crumbEl.innerHTML = ''
    const back = el(`<button>← ${this.computer.name}</button>`)
    back.addEventListener('click', () => this.clearRoot())
    crumbEl.appendChild(back)
    chain.forEach((hop, i) => {
      crumbEl.appendChild(el(`<span class="sep">/</span>`))
      if (i < chain.length - 1) {
        const b = el(`<button class="crumb-hop">${hop.name}</button>`)
        b.addEventListener('click', () => this.setRoot(hop.id))
        crumbEl.appendChild(b)
      } else {
        crumbEl.appendChild(el(`<span><b style="color:var(--ink-2)">${hop.name}</b></span>`))
      }
    })
  }

  clearRoot() {
    if (this._glideRaf) { cancelAnimationFrame(this._glideRaf); this._glideRaf = null }
    if (this._glideRec) {
      this._glideRec.fx = null; this._glideRec.fy = null
      this._glideRec.el.classList.remove('rerooting')
      this._glideRec = null
    }
    this.rootId = null
    this.build()
    if (this._zt !== 1 || this.panX || this.panY) this.resetZoom()
    this.onRootChange?.(null, [])
  }

  resize() {
    const w = this.container.clientWidth || this.W
    const h = this.container.clientHeight || this.H
    const boot = this._bootResize
    this._bootResize = false
    // the RO's initial delivery at an unchanged size must NOT reheat the
    // just-settled sim (this refresh was part of the slow-arrival churn)
    if (w === this.W && h === this.H) return
    this.W = w; this.H = h
    for (const n of this.nodes.values()) {
      n.x = Math.max(n.r + 34, Math.min(this.W - n.r - 34, n.x))
      n.y = Math.max(n.r + 64, Math.min(this.H - n.r - 58, n.y))
    }
    this._clampPan()
    this._applyZoom()
    this.refreshForces()
    // first delivery = the true canvas size, still pre-paint: arrive settled
    if (boot) this._presettle()
  }

  /* ---------- C3: wheel zoom + pan ---------- */

  /** Client → graph coordinates through the live zoom transform. The
      container's rect already carries pan (transform-origin 0 0), so the
      conversion is exact at every zoom/pan — drags, offsets and clamps all
      keep operating on true graph coordinates. */
  _toGraph(e) {
    const cr = this.container.getBoundingClientRect()
    return { x: (e.clientX - cr.left) / this.zoom, y: (e.clientY - cr.top) / this.zoom }
  }

  /** Keep the scaled canvas covering the viewport (zoom > 1) or fully inside
      it (zoom < 1) — nothing can be dragged out of reach or clipped away. */
  _clampPan() {
    const bx = this.W * (1 - this.zoom)
    const by = this.H * (1 - this.zoom)
    this.panX = Math.max(Math.min(0, bx), Math.min(Math.max(0, bx), this.panX))
    this.panY = Math.max(Math.min(0, by), Math.min(Math.max(0, by), this.panY))
  }

  _applyZoom() {
    const idle = this.zoom === 1 && !this.panX && !this.panY
    // identity clears the inline transform entirely — at 1× the canvas keeps
    // its original (non-stacking-context) paint order and zero overhead
    this.container.style.transform = idle ? '' :
      `translate3d(${this.panX}px, ${this.panY}px, 0) scale(${this.zoom})`
    this.zoomHost.classList.toggle('zoomed', Math.abs(this.zoom - 1) > 0.004)
    this._syncFit()
  }

  _syncFit() {
    if (!this.fitEl) return
    const active = Math.abs(this.zoom - 1) > 0.004 || Math.abs(this._zt - 1) > 0.004
      || !!this.panX || !!this.panY
    this.fitEl.classList.toggle('show', active)
    const z = this.fitEl.querySelector('.gf-z')
    const txt = `${this.zoom.toFixed(2)}×`
    if (z && z.textContent !== txt) z.textContent = txt
  }

  _wheel(e) {
    if (this.editMode) return                    // zoom sleeps while editing
    // an open chat morph scrolls its own messages — never hijack that wheel
    if (e.target.closest?.('.chip.as-chat, .chat')) return
    e.preventDefault()
    const cr = this.container.getBoundingClientRect()
    // anchor: the graph point under the cursor + its host-space screen point
    this._ax = (e.clientX - cr.left) / this.zoom
    this._ay = (e.clientY - cr.top) / this.zoom
    this._asx = e.clientX - cr.left + this.panX
    this._asy = e.clientY - cr.top + this.panY
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * this.H : e.deltaY
    this._zt = Math.max(0.55, Math.min(1.7, this._zt * Math.exp(-dy * 0.0022)))
    this._zoomMode = 'anchor'
    if (prefersCalm()) {                       // reduce-motion: land instantly
      this.zoom = this._zt
      this.panX = this._asx - this._ax * this.zoom
      this.panY = this._asy - this._ay * this.zoom
      this._clampPan(); this._applyZoom()
      return
    }
    this._zoomHotOn()
    this._startZoomAnim()
  }

  /** Ease zoom toward its target; keep the wheel's anchor point pinned under
      the cursor ('anchor') or ease pan home too ('fit'). One rAF, self-ends. */
  _startZoomAnim() {
    if (this._zoomRaf) return
    let last = performance.now()
    const step = (t) => {
      const dt = Math.min(48, Math.max(1, t - last)); last = t
      const a = 1 - Math.exp(-dt / 90)           // frame-rate-independent ease
      this.zoom += (this._zt - this.zoom) * a
      if (this._zoomMode === 'fit') {
        this.panX += (0 - this.panX) * a
        this.panY += (0 - this.panY) * a
      } else {
        this.panX = this._asx - this._ax * this.zoom
        this.panY = this._asy - this._ay * this.zoom
      }
      this._clampPan()
      const zDone = Math.abs(this._zt - this.zoom) < 0.002
      const pDone = this._zoomMode !== 'fit'
        || (Math.abs(this.panX) < 0.5 && Math.abs(this.panY) < 0.5)
      if (zDone && pDone) {
        this.zoom = this._zt
        if (this._zoomMode === 'fit') { this.panX = 0; this.panY = 0 }
        this._clampPan(); this._applyZoom()
        this._zoomRaf = null
        this._zoomHotOff()
        return
      }
      this._applyZoom()
      this._zoomRaf = requestAnimationFrame(step)
    }
    this._zoomRaf = requestAnimationFrame(step)
  }

  /** Smoothly reset to 1× / no pan (the "fit" control). Additive API. */
  resetZoom() {
    this._zt = 1
    this._zoomMode = 'fit'
    if (prefersCalm()) {
      this.zoom = 1; this.panX = 0; this.panY = 0
      this._applyZoom()
      return
    }
    this._zoomHotOn()
    this._startZoomAnim()
  }

  /* pan: dragging empty canvas while zoomed moves the viewport (host-level
     listeners; node/chip/button targets are left to their own handlers) */
  _panStart(e) {
    if (e.button !== 0) return
    const t = e.target
    // interactive things own their pointer; only truly empty canvas pans
    if (t.closest?.('.node, .chip, .graph-fit, .graph-crumb, button')) return
    const empty = t === this.zoomHost || t === this.container || t instanceof SVGElement
    if (!empty) return
    if (Math.abs(this.zoom - 1) < 0.001 && Math.abs(this._zt - 1) < 0.001) return
    // a wheel ease in flight hands pan to the drag with zero jump
    if (this._zoomRaf) {
      cancelAnimationFrame(this._zoomRaf); this._zoomRaf = null
      this._zt = this.zoom
    }
    e.preventDefault()
    this._panPid = e.pointerId
    try { this.zoomHost.setPointerCapture(e.pointerId) } catch {}
    this._panSX = e.clientX; this._panSY = e.clientY
    this._panX0 = this.panX; this._panY0 = this.panY
    this._panning = true
    this.zoomHost.classList.add('panning')
    this._zoomHotOn()
  }

  _panMove(e) {
    if (!this._panning || e.pointerId !== this._panPid) return
    this.panX = this._panX0 + (e.clientX - this._panSX)
    this.panY = this._panY0 + (e.clientY - this._panSY)
    this._clampPan(); this._applyZoom()
  }

  _panEnd(e) {
    if (!this._panning || e.pointerId !== this._panPid) return
    this._panning = false; this._panPid = null
    try { this.zoomHost.releasePointerCapture(e.pointerId) } catch {}
    this.zoomHost.classList.remove('panning')
    this._zoomHotOff()
  }

  /* zoom/pan share the drag's hot-state mechanism: reduced-fidelity canvas
     while the transform animates, full fidelity back when it settles */
  _zoomHotOn() {
    clearTimeout(this._zoomHotTimer)
    if (!this._zoomHot) {
      this._zoomHot = true
      this._hot = true
      this.container.classList.add('interacting')
    }
  }

  _zoomHotOff() {
    clearTimeout(this._zoomHotTimer)
    this._zoomHotTimer = setTimeout(() => {
      this._zoomHot = false
      if (!this._draggingNow && !this._panning && this.simulation.alpha() <= 0.04) {
        this._hot = false
        this.container.classList.remove('interacting')
      }
    }, 200)
  }

  _buildFitControl() {
    const b = el(`
      <button class="graph-fit" type="button" title="Reset zoom" aria-label="Reset zoom to fit">
        <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
          <path d="M4 9V6.5A2.5 2.5 0 0 1 6.5 4H9M15 4h2.5A2.5 2.5 0 0 1 20 6.5V9M20 15v2.5a2.5 2.5 0 0 1-2.5 2.5H15M9 20H6.5A2.5 2.5 0 0 1 4 17.5V15"
            fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg><span class="gf-z">1.00×</span>
      </button>
    `)
    b.addEventListener('click', () => this.resetZoom())
    this.zoomHost.appendChild(b)
    this.fitEl = b
  }

  /* ---------- C8: hierarchy edit mode ----------
     Edit locks the fleet into a tidy tier tree (physics paused, every node
     pinned), lets a drag re-parent an agent via sim.reparentAgent, and Done
     melts the tree back into liquid physics with the new hierarchy live. */

  setEditMode(on) {
    if (this.editMode === !!on) return
    this.editMode = !!on
    if (on) {
      this.container.setAttribute('data-edit-mode', 'true')
      if (this._zt !== 1 || this.panX || this.panY) this.resetZoom()
      for (const n of this.nodes.values()) {
        if (n._flingRaf) { cancelAnimationFrame(n._flingRaf); n._flingRaf = null }
      }
      this.simulation.alphaTarget(0)
      this.simulation.stop()
      this._layoutTree(true)
    } else {
      this.container.removeAttribute('data-edit-mode')
      this._clearTierGuides()
      if (this._treeRaf) { cancelAnimationFrame(this._treeRaf); this._treeRaf = null }
      for (const n of this.nodes.values()) {
        n.fx = null; n.fy = null; n._editDragging = false
        n.el.classList.remove('drop-ok', 'refuse')
      }
      this.simulation.alpha(0.85).restart()        // melt back into liquid
    }
  }

  /** Tier slots: rows by hierarchy depth, children spread under their parents. */
  _treeSlots() {
    const nodes = [...this.nodes.values()]
    const byId = new Map(nodes.map(n => [n.id, n]))
    const depthOfNode = (n) => {
      let d = 0, cur = n.agent
      while (cur.parentId && byId.has(cur.parentId) && d < 9) { cur = byId.get(cur.parentId).agent; d++ }
      return d
    }
    const tiers = new Map()
    for (const n of nodes) {
      const d = depthOfNode(n)
      if (!tiers.has(d)) tiers.set(d, [])
      tiers.get(d).push(n)
    }
    const tierKeys = [...tiers.keys()].sort((a, b) => a - b)
    const rows = tierKeys.length
    const padT = 104, padB = 92
    const rowH = rows > 1 ? (this.H - padT - padB) / (rows - 1) : 0
    const slots = new Map()
    const rowYs = []
    tierKeys.forEach((tk, ri) => {
      const list = tiers.get(tk)
      list.sort((a, b) => {                        // stable: under the parent, by name
        const pa = slots.get(a.agent.parentId)?.x ?? this.W / 2
        const pb = slots.get(b.agent.parentId)?.x ?? this.W / 2
        return pa - pb || a.id.localeCompare(b.id)
      })
      const y = rows > 1 ? padT + ri * rowH : this.H / 2
      rowYs.push(y)
      const step = this.W / (list.length + 1)
      list.forEach((n, i) => slots.set(n.id, {
        x: Math.max(n.r + 44, Math.min(this.W - n.r - 44, step * (i + 1))),
        y,
      }))
    })
    return { slots, rowYs }
  }

  _layoutTree(animate = true) {
    const { slots, rowYs } = this._treeSlots()
    this._renderTierGuides(rowYs)
    if (this._treeRaf) cancelAnimationFrame(this._treeRaf)
    const starts = new Map()
    for (const n of this.nodes.values()) starts.set(n.id, { x: n.x, y: n.y })
    const t0 = performance.now()
    const D = (animate && !prefersCalm()) ? 680 : 0
    const ease = (u) => 1 - Math.pow(1 - u, 3)
    const step = (t) => {
      const u = D ? Math.min(1, (t - t0) / D) : 1
      const k = ease(u)
      for (const n of this.nodes.values()) {
        const s = slots.get(n.id)
        if (!s || n._editDragging) continue        // hands off the grabbed bubble
        const st = starts.get(n.id) || s
        n.x = n.fx = st.x + (s.x - st.x) * k
        n.y = n.fy = st.y + (s.y - st.y) * k
      }
      this.tick()
      if (u < 1 && this.editMode) this._treeRaf = requestAnimationFrame(step)
      else this._treeRaf = null
    }
    this._treeRaf = requestAnimationFrame(step)
  }

  _renderTierGuides(rowYs) {
    this._clearTierGuides()
    this._guides = rowYs.map(y => {
      const g = document.createElement('div')
      g.className = 'tier-guide'
      g.style.top = `${Math.round(y)}px`
      this.container.insertBefore(g, this.svg)
      return g
    })
  }
  _clearTierGuides() { (this._guides || []).forEach(g => g.remove()); this._guides = [] }

  _isDescendantOf(n, anc) {
    let cur = n.agent, hops = 0
    while (cur?.parentId && hops++ < 10) {
      if (cur.parentId === anc.id) return true
      cur = this.nodes.get(cur.parentId)?.agent
    }
    return false
  }

  /** Highlight the valid parent under the dragged bubble, if any. */
  _updateDropTarget(rec) {
    let target = null
    if (rec.agent.role !== 'coordinator') {        // the root never moves
      for (const n of this.nodes.values()) {
        if (n === rec) continue
        if (Math.hypot(n.x - rec.x, n.y - rec.y) < n.r + rec.r * 0.5) { target = n; break }
      }
      if (target && (target.id === rec.agent.parentId || this._isDescendantOf(target, rec))) {
        target = null
      }
    }
    if (this._dropRec && this._dropRec !== target) this._dropRec.el.classList.remove('drop-ok')
    if (target && this._dropRec !== target) target.el.classList.add('drop-ok')
    this._dropRec = target
  }

  _editDrop(rec) {
    rec._editDragging = false
    const target = this._dropRec
    if (this._dropRec) { this._dropRec.el.classList.remove('drop-ok'); this._dropRec = null }
    rec.fx = null; rec.fy = null                   // relayout re-pins everything
    if (target && sim.reparentAgent(this.computer, rec.agent.id, target.agent.id)) {
      return                                       // 'reparent' handler relays out
    }
    // refused: released over an invalid perch (or tried to move the root)
    let overNode = false
    for (const n of this.nodes.values()) {
      if (n === rec) continue
      if (Math.hypot(n.x - rec.x, n.y - rec.y) < n.r + rec.r * 0.5) { overNode = true; break }
    }
    if (overNode || rec.agent.role === 'coordinator') {
      rec.el.classList.add('refuse')
      clearTimeout(rec._refuseTimer)
      rec._refuseTimer = setTimeout(() => rec.el.classList.remove('refuse'), 520)
    }
    this._layoutTree(true)                         // glide home
  }

  destroy() {
    this._destroyed = true
    this.simulation.stop()
    this.ro.disconnect()
    if (this._treeRaf) cancelAnimationFrame(this._treeRaf)
    this._clearTierGuides()
    if (this._glideRaf) cancelAnimationFrame(this._glideRaf)
    if (this._perfRaf) cancelAnimationFrame(this._perfRaf)
    if (this._zoomRaf) cancelAnimationFrame(this._zoomRaf)
    clearTimeout(this._zoomHotTimer)
    for (const n of this.nodes.values()) if (n._flingRaf) cancelAnimationFrame(n._flingRaf)
    this.unsubs.forEach(u => u())
    this.zoomHost.removeEventListener('wheel', this._onWheel)
    this.zoomHost.removeEventListener('pointerdown', this._onHostDown)
    this.zoomHost.removeEventListener('pointermove', this._onHostMove)
    this.zoomHost.removeEventListener('pointerup', this._onHostUp)
    this.zoomHost.removeEventListener('pointercancel', this._onHostUp)
    this.zoomHost.classList.remove('graph-zoom-host', 'panning', 'zoomed')
    this.fitEl?.remove()
    this.container.style.transform = ''
    this.container.innerHTML = ''
    this.container.classList.remove('graph-canvas', 'zoomable')
  }
}
