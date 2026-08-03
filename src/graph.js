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
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(container)

    this.simulation = forceSimulation([])
      .velocityDecay(0.32)
      .alphaDecay(0.015)
      .on('tick', () => this.tick())

    // dev perf probe — rolling average frame time (ms) at window.__graphFrameMs
    this._frameAvg = 16.7
    this._lastFrameT = 0
    const probe = (t) => {
      if (this._lastFrameT) {
        const dt = t - this._lastFrameT
        if (dt < 250) {                              // ignore tab-hidden gaps
          this._frameAvg += (dt - this._frameAvg) * 0.1
          window.__graphFrameMs = Math.round(this._frameAvg * 100) / 100
        }
      }
      this._lastFrameT = t
      this._perfRaf = requestAnimationFrame(probe)
    }
    this._perfRaf = requestAnimationFrame(probe)

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
  }

  spawnNode(agent, initial) {
    const r = RADII[agent.role] || 39
    const role = ROLES[agent.role]
    const parent = this.nodes.get(agent.parentId)
    let cx = parent ? parent.x + (Math.random() - 0.5) * 160 : this.W / 2
    let cy = parent ? parent.y + 90 + Math.random() * 60 : this.H / 2
    cx = Math.max(r + 34, Math.min(this.W - r - 34, cx))
    cy = Math.max(r + 64, Math.min(this.H - r - 58, cy))

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
    }
    nodeEl.style.transform = `translate(${cx}px, ${cy}px) translate(-50%,-50%)`
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
  }

  removeNode(rec, animate, delay = 0) {
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
  }

  removeAgent(id) {
    const rec = this.nodes.get(id)
    if (!rec) return
    if (rec.chatOpen) this.closeChat(rec)
    this.removeNode(rec, true)
    this.refreshForces()
    this.updateDensity()
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
      .force('x', forceX(this.W / 2).strength(n => (this.isRoot(n) ? 0.16 : 0.045)))
      .force('y', forceY(n => (this.isRoot(n) ? this.H * 0.42 : this.H * 0.55)).strength(n => (this.isRoot(n) ? 0.16 : 0.05)))
    this.simulation.alpha(hard ? 1 : 0.7).restart()
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
    const padX = 34, padTop = 64, padBot = 58
    const cx0 = this.W / 2, cy0 = this.H / 2
    for (const n of this.nodes.values()) {
      n.x = Math.max(n.r + padX, Math.min(this.W - n.r - padX, n.x))
      n.y = Math.max(n.r + padTop, Math.min(this.H - n.r - padBot, n.y))
      n.el.style.transform = `translate(${n.x}px, ${n.y}px) translate(-50%,-50%)`
      if (n.chip) {
        // place the chip radially OUTWARD from the cluster so it never sits on
        // top of inner nodes/labels
        const dx = n.x - cx0, dy = n.y - cy0
        const len = Math.hypot(dx, dy) || 1
        const ux = dx / len, uy = dy / len
        const cw = n.chatOpen ? 316 : n.chipW
        const ch = n.chatOpen ? 368 : n.chipH
        let px = n.x + ux * (n.r + 20)
        if (ux < 0) px -= cw
        let py = n.y + uy * (n.r + 20) - ch / 2
        px = Math.max(8, Math.min(this.W - cw - 8, px))
        py = Math.max(8, Math.min(this.H - ch - 8, py))
        n.chip.style.transform = `translate(${px}px, ${py}px)`
      }
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
      pid = e.pointerId
      elm.setPointerCapture(pid)
      startX = e.clientX; startY = e.clientY; moved = false
      samples = [{ x: e.clientX, y: e.clientY, t: performance.now() }]
      const cr = this.container.getBoundingClientRect()
      offX = rec.x - (e.clientX - cr.left)
      offY = rec.y - (e.clientY - cr.top)
    })

    elm.addEventListener('pointermove', (e) => {
      if (pid === null) return
      samples.push({ x: e.clientX, y: e.clientY, t: performance.now() })
      if (samples.length > 6) samples.shift()
      const dx = e.clientX - startX, dy = e.clientY - startY
      if (!moved && Math.hypot(dx, dy) > 5) {
        moved = true
        elm.classList.add('dragging')
        this.simulation.alphaTarget(0.28).restart()
      }
      if (moved) {
        const cr = this.container.getBoundingClientRect()
        rec.fx = Math.max(rec.r, Math.min(this.W - rec.r, e.clientX - cr.left + offX))
        rec.fy = Math.max(rec.r, Math.min(this.H - rec.r, e.clientY - cr.top + offY))
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
        elm.classList.add('settling')                  // brief ~0.97 overshoot
        clearTimeout(rec._settleTimer)
        rec._settleTimer = setTimeout(() => elm.classList.remove('settling'), 600)
        rec.fx = null; rec.fy = null
        // transfer pointer velocity into the simulation (fling)
        let vx = 0, vy = 0
        if (!prefersCalm()) {
          const tN = performance.now()
          const recent = samples.filter(s => tN - s.t < 160)
          if (recent.length >= 2) {
            const a = recent[0], b = recent[recent.length - 1]
            const dt = Math.max(16, b.t - a.t)
            vx = ((b.x - a.x) / dt) * 15               // px/ms → px/frame
            vy = ((b.y - a.y) / dt) * 15
            const sp = Math.hypot(vx, vy), cap = 40
            if (sp > cap) { vx *= cap / sp; vy *= cap / sp }
          }
        }
        rec.vx = vx; rec.vy = vy
        this.simulation.alphaTarget(0)
        if (Math.hypot(vx, vy) > 2) this.simulation.alpha(Math.max(this.simulation.alpha(), 0.5)).restart()
        samples = []
        return
      }
      rec.fx = null; rec.fy = null
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
    const rec = this.nodes.get(id)
    if (rec) this.glideToRoot(rec)
    this.onRootChange?.(id, this.ancestryOf(id))   // extra arg is additive
    this.renderAncestry()
  }

  /** Tween the newly-chosen root into the root slot (arrives ≤800ms). */
  glideToRoot(rec) {
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
    this.onRootChange?.(null, [])
  }

  resize() {
    this.W = this.container.clientWidth || this.W
    this.H = this.container.clientHeight || this.H
    for (const n of this.nodes.values()) {
      n.x = Math.max(n.r + 34, Math.min(this.W - n.r - 34, n.x))
      n.y = Math.max(n.r + 64, Math.min(this.H - n.r - 58, n.y))
    }
    this.refreshForces()
  }

  destroy() {
    this.simulation.stop()
    this.ro.disconnect()
    if (this._glideRaf) cancelAnimationFrame(this._glideRaf)
    if (this._perfRaf) cancelAnimationFrame(this._perfRaf)
    this.unsubs.forEach(u => u())
    this.container.innerHTML = ''
    this.container.classList.remove('graph-canvas')
  }
}
