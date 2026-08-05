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
const SCREEN_CHIP_W = 300
const SCREEN_CHIP_H = 126
const SCREEN_EDGE = 8
const SCREEN_CHIP_GAP = 10
const SCREEN_SLOT_HYSTERESIS = 52
const SCREEN_PRIORITY = { coordinator: 4, helper: 3, shadow: 3, manager: 2, default: 1, spawned: 0 }

/* ---------- motion weight (see the header block in graph.css) ----------
   Two registers, deliberately not one. The motion audit found a single
   front-loaded curve doing 88% of the work on this surface, so a whole
   subtree re-rooting carried the same weight as a hover. MICRO feedback
   (hover, press, drop-ok) stays on the shared --ease / --ease-spring at
   short durations, in CSS. STRUCTURAL moves — the re-root glide and the
   tree relayout, the two rAF tweens that move fx/fy and therefore cannot
   use a CSS transition at all — run on the ONE curve this lane adds,
   --ease-structural: cubic-bezier(0.42, 0, 0.18, 1). Zero initial velocity
   (mass has to be got moving), then a long settled approach.
   EASE_STRUCTURAL below is that identical curve evaluated in JS. The four
   numbers are duplicated in graph.css by necessity — change both or
   neither. */
const cubicBezierEase = (x1, y1, x2, y2) => {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by
  const solveX = (t) => ((ax * t + bx) * t + cx) * t
  const slopeX = (t) => (3 * ax * t + 2 * bx) * t + cx
  return (u) => {
    if (!(u > 0)) return 0
    if (u >= 1) return 1
    let t = u                                  // Newton — these curves are
    for (let i = 0; i < 6; i++) {               // monotonic in x, ~3 iterations
      const err = solveX(t) - u
      if (Math.abs(err) < 1e-5) break
      const d = slopeX(t)
      if (Math.abs(d) < 1e-6) break
      t -= err / d
    }
    return ((ay * t + by) * t + cy) * t
  }
}
const EASE_STRUCTURAL = cubicBezierEase(0.42, 0, 0.18, 1)
const STRUCTURAL_MS = 680          // re-root glide == tree relayout: one event class
const TIER_GUIDE_BEAT_MS = 60      // guides state a row only after it exists

/* Drag-release settle, scaled by the throw that produced it. FLING_CAP is
   the same px/ms ceiling the ballistic fling clamps to, so "1.0 energy"
   means the same thing to both. */
const FLING_CAP = 2.4
const SETTLE_MIN_MS = 260, SETTLE_MAX_MS = 560
const SETTLE_MIN_AMP = 0.18        // a set-down still ticks; it does not bounce

/* Dense-mode focus ring: a bounded attractor, not an idle loop. */
const FOCUS_PULSE_MS = 1900, FOCUS_PULSES = 3

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

// The graph instance that currently owns the window.__graph*/__pageFrameMs
// perf globals. Module-scoped rather than a window key so a page script can't
// forge ownership and so it dies with the module.
let probeOwner = null

/* The context chip's resting width. It lived as a bare 168 in five places
   (three in here, the CSS rule, and agent.js's placement fallback) and every
   one of them had to agree or the collision placement drifted from the box it
   was placing. It is a constant here and nowhere else -- graph.js writes it
   onto the element, so CSS no longer states a width at all.
   248 (was 224, was 168), because of what the box is FOR: it has to say which agent
   this is and roughly what it is doing. At 168 with the name and the task
   sharing one line, the task truncated to "promotin..." / "watc..." /
   "matchi..." and the box read as broken rather than terse. */
/* Open chat panels stack in the order they were raised. They are 316x368 on a
   canvas that often cannot hold two of them apart, so overlap is not a bug to
   be placed away -- but every panel carrying the same z-index is, because then
   DOM order decides and an earlier chat can sit on top of a later one's
   message input. Measured at 1280: the second panel opened had an input that
   elementFromPoint did not return, i.e. it could not be clicked at all. */
let chatZ = 8

export const CHIP_W = 248
/* The fallback height, used only until the real one can be measured. 74, not
   44: the box is three rows now (name, then two context lines) and this number
   is what the placement reserves. Over-reserving only pushes a box further
   from its node; under-reserving draws it through one. */
export const CHIP_H = 100

export class FleetGraph {
  constructor(container, { computer, rootId = null, onRootChange = null, onSelect = null, onOpenControls = null, chipsFor = CHIP_ROLES, chipPredicate = null, screenChips = false, contextFeed = null }) {
    this.chipPredicate = chipPredicate
    this.screenChips = screenChips === true
    this.contextFeed = typeof contextFeed === 'function' ? contextFeed : null
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
    this.layout = 'force'           // callers opt into 'tree' via setLayout()
    this.editMode = false

    container.classList.add('graph-canvas')
    // State the layout in the DOM from frame one. graph.css keys the tree's
    // SOLID connectors off [data-layout="tree"] and edit mode's DASHED ones
    // off [data-edit-mode], but setLayout() only wrote the attribute when the
    // mode CHANGED — so a canvas that was never toggled carried no attribute
    // at all and the two rules were selecting against an absence. Writing the
    // initial value keeps that distinction assertable at every moment.
    container.setAttribute('data-layout', this.layout)
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
    if (this.screenChips) {
      this._buildScreenChipOverlay()
      this._wrapW = this.zoomHost.clientWidth || this.W
      this._wrapH = this.zoomHost.clientHeight || this.H
      this._screenUiRects = []
      this._screenUiDirty = true
      this._screenUiVersion = 0
      this._screenLayoutKey = ''
      this.ro.observe(this.zoomHost)
    }
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
    // audit #27: Escape closes the topmost open chat. Document-level (the
    // same idiom main.js uses for the drawer) rather than on the container,
    // because the chat panel holds focus in its input — a container keydown
    // still catches that, but NOT the pointer-user case where focus never
    // entered the graph at all. Removed in destroy() like the host listeners.
    this._onKeyDown = (e) => this._escTopChat(e)
    document.addEventListener('keydown', this._onKeyDown)

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
    // Whoever wrote the globals last owns them; destroy() only clears them if
    // it is still the owner. The router mounts the incoming view BEFORE it
    // retires the outgoing one (main.js swapView: destroy runs on a timeout),
    // so a graph→graph navigation would otherwise have the OLD graph erase
    // the NEW graph's readings on its way out.
    probeOwner = this
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

    // A label measured before the real webfont paints captures a fallback-
    // font width, not the final one — force every node to re-measure once
    // fonts are confirmed ready. Cheap (tick()'s pass just skips anything
    // already flagged) and self-limiting; no-op if fonts were already ready.
    document.fonts?.ready.then(() => {
      if (this._destroyed) return
      for (const n of this.nodes.values()) {
        n._labelMeasured = false
        if (this.screenChips) n._chipHMeasured = false
      }
      if (this.screenChips) {
        this._screenUiDirty = true
        this._screenLayoutKey = ''
        this.tick()
      }
    })

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
        if (this.screenChips) {
          // A just-arrived default ranks below every established lane until
          // this state transition. Re-run the option-only budget now rather
          // than leaving its old "spawned = 0" rank cached until some
          // unrelated context or zoom event happens to wake the graph.
          this._screenLayoutKey = ''
          this.tick()
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
        if (this._treeActive()) this._layoutTree(true)
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
    // The estimate above avoids a forced reflow per spawn, but measured
    // against the real rendered block it undershoots by 10-18px on longer
    // role labels ("Shadow Manager", "Coordinator's Helper") — enough that
    // the label-avoid force could settle for clearance narrower than what's
    // actually on screen. An immediate offsetWidth read fixes it for a
    // live spawn (this.container is already attached to the document by
    // then) — but every INITIAL-BUILD node is constructed while the view is
    // still detached (main.js appends the view to the document only after
    // makeView() — and this constructor — return), so offsetWidth reads 0
    // for the entire initial graph and silently falls back to the flawed
    // heuristic forever (root-caused by QA's offline replay against frozen
    // geometry, not guessed). The immediate read below stays as a fast path
    // for the common already-mounted case; _labelMeasured marks whether it
    // actually got a real number, and tick() below self-heals the rest the
    // moment each node truly becomes connected — independent of when or how.
    const realLabelW = Math.max(
      nodeEl.querySelector('.node-name')?.offsetWidth || 0,
      nodeEl.querySelector('.node-role')?.offsetWidth || 0,
    )
    const finalLabelW = realLabelW > 0 ? Math.max(labelW, realLabelW + 6) : labelW

    const restingChipW = this.screenChips ? SCREEN_CHIP_W : CHIP_W
    const rec = {
      id: agent.id, agent, el: nodeEl, r,
      x: cx, y: cy, vx: 0, vy: 0,
      chip: null, chatOpen: false, chipW: restingChipW,
      chipH: this.screenChips ? SCREEN_CHIP_H : CHIP_H,
      // this._labelH — NOT a hardcoded 41: on a compact canvas the role row
      // is hidden, and a node spawned after the mode flipped would otherwise
      // keep reserving the full-label height forever (the flip loop only
      // touches nodes that exist at that instant, and the self-heal loop
      // skips anything already measured). QA measured exactly that: every
      // post-flip spawn stuck at 41 against a real 22px block. It only ever
      // over-reserved, so it never caused overlap — but it silently withheld
      // half the vertical relief compact mode is supposed to deliver.
      labelW: finalLabelW, labelH: this._labelH || 41,
      _labelWHeur: labelW,                 // pre-measurement floor, for re-measure
      _labelMeasured: realLabelW > 0,
      _cx: null, _cy: null,                            // chip's eased slot position
    }
    nodeEl.style.transform = `translate(${cx}px, ${cy}px) translate(-50%,-50%)`
    nodeEl.dataset.agentId = agent.id                  // C8: hierarchy is
    nodeEl.dataset.parentId = agent.parentId || ''     // assertable in the DOM
    // audit #26: the bubble is click-activated but was pointer-only — put it
    // in the tab order at creation so keyboard users can reach what mouse
    // users can. aria-label because the computed name would otherwise be the
    // runtime readout ("0:00:00 Runtime …") before the agent's actual name.
    nodeEl.tabIndex = 0
    nodeEl.setAttribute('role', 'button')
    nodeEl.setAttribute('aria-label', `${agent.name} — ${role.label}`)
    nodeEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      if (e.repeat) return                    // a held Space is one activation
      if (this.editMode) return               // clicks are inert while editing
      e.preventDefault()                      // Space must not scroll the page
      this.handleClick(rec)                   // same path the pointer click takes
    })
    this.nodes.set(agent.id, rec)

    this.unsubs.push(bindRuntime(nodeEl.querySelector('.rt'), () => agent.bornAt))
    this.wireInteractions(rec)

    const wantsChip = this.screenChips
      || (this.chipPredicate ? this.chipPredicate(agent) : this.chipsFor.has(agent.role))
    if (wantsChip) this.makeChip(rec)
    return rec
  }

  makeChip(rec) {
    const chip = el(`<div class="chip role-${rec.agent.role}"><div class="chip-preview"></div></div>`)
    // CSS states no width for .chip (see CHIP_W) -- without this the box would
    // shrink to its text and every placement rectangle would be a fiction
    chip.style.width = (this.screenChips ? SCREEN_CHIP_W : CHIP_W) + 'px'
    ;(this.screenChips ? this.screenOverlay : this.container).appendChild(chip)
    rec.chip = chip
    if (this.screenChips) {
      chip.dataset.agentId = rec.id
      chip.setAttribute('aria-label', `${rec.agent.name} monitoring context; open chat`)
      const leader = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      leader.setAttribute('class', 'graph-chip-leader')
      leader.setAttribute('stroke', ROLES[rec.agent.role]?.hex || ROLES.default.hex)
      leader.setAttribute('data-agent-id', rec.id)
      this.screenLeaderSvg.appendChild(leader)
      rec.chipLeader = leader
    }
    this.renderChipPreview(rec)
    // audit #26: the chip opens a chat on click — keyboard parity. role is
    // swapped off in openChat (an open panel full of inputs is not a button)
    // and back on in closeChat; tabindex STAYS through both states so Escape
    // has a live element to hand focus back to.
    chip.tabIndex = this.screenChips ? (rec._screenPlaced ? 0 : -1) : 0
    chip.setAttribute('role', 'button')
    chip.addEventListener('keydown', (e) => {
      if (rec.chatOpen) return                // open panel: keys belong to the chat
      if (e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault()                      // Space must not scroll the page
      this.openChat(rec)
    })
    chip.addEventListener('click', () => { if (!rec.chatOpen) this.openChat(rec) })
    // raise on the way DOWN, so the click that follows lands on this panel and
    // not on whatever was covering it
    chip.addEventListener('pointerdown', () => {
      if (rec.chatOpen) chip.style.zIndex = String(++chatZ)
    })
  }

  renderChipPreview(rec) {
    if (this.screenChips) {
      this._renderScreenChipPreview(rec)
      return
    }
    const pv = rec.chip.querySelector('.chip-preview')
    /* The name is its own row, not a prefix on the first context line. It is
       the thing the box exists to tell you -- "which agent is this" -- and
       sharing a line meant the ellipsis ate the task instead of the name:
       `claude · promotin...` where the task is the part you cannot guess.
       Split, the name always reads in full and the task gets the whole width. */
    pv.innerHTML = `<div class="cl cl-name"><b>${rec.agent.name}</b></div>`
      + rec.agent.context.map(c => `<div class="cl">${c}</div>`).join('')
    const h = rec.chip.offsetHeight
    rec.chipH = h || CHIP_H
    // a 0 here means "not laid out yet", not "44px tall" — tick() re-measures
    rec._chipHMeasured = h > 0
    // context arrives while the sim sleeps too — without a live tick the
    // grown preview would quietly expand over a neighbour (the rejected
    // "persisting past t=8s" overlaps) or past the canvas edge; re-place now
    if (this.simulation.alpha() < 0.02) this.tick()
  }

  _screenContext(rec) {
    let supplied = null
    try { supplied = this.contextFeed?.(rec.agent) }
    catch { supplied = null }
    const activity = Array.isArray(supplied)
      ? supplied
      : (supplied?.activities || supplied?.context || rec.agent.context || [])
    const rows = Array.isArray(activity) ? activity : [activity]
    const clean = (value) => value == null ? '' : String(value).replace(/\s+/g, ' ').trim()
    return {
      current: clean(supplied?.current ?? rows.at(-1)),
      previous: clean(supplied?.previous ?? rows.at(-2)),
      chat: clean(supplied?.chat?.text ?? supplied?.recentChat?.text
        ?? supplied?.chat ?? supplied?.recentChat),
    }
  }

  _renderScreenChipPreview(rec) {
    const pv = rec.chip.querySelector('.chip-preview')
    if (!pv.querySelector('.chip-monitor-name')) {
      pv.innerHTML = `
        <div class="cl cl-name">
          <i class="chip-role-dot" aria-hidden="true"></i>
          <b class="chip-monitor-name"></b>
          <span class="chip-runtime"></span>
        </div>
        <div class="cl cl-current"></div>
        <div class="cl cl-previous"></div>
        <div class="cl cl-chat"></div>
      `
      pv.querySelector('.chip-monitor-name').textContent = rec.agent.name
      const runtime = pv.querySelector('.chip-runtime')
      runtime.textContent = fmtRuntime(rec.agent.bornAt)
      rec._screenRuntimeUnsub = bindRuntime(runtime, () => rec.agent.bornAt)
    }
    const feed = this._screenContext(rec)
    const update = (selector, text, prefix = '') => {
      const row = pv.querySelector(selector)
      const next = text ? prefix + text : ''
      row.hidden = !next
      if (row.textContent !== next) row.textContent = next
    }
    update('.cl-current', feed.current)
    update('.cl-previous', feed.previous)
    update('.cl-chat', feed.chat, '› ')

    const h = rec.chip.offsetHeight
    if (h > 0 && h !== rec.chipH) rec._screenSlot = null
    rec.chipH = h || SCREEN_CHIP_H
    rec._chipHMeasured = h > 0
    this.tick()
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
    chip.removeAttribute('role')    // it is a panel now, not a button (see makeChip)
    if (rec._chipDim) { rec._chipDim = false; chip.classList.remove('chip-dim') }
    rec.chatOpen = true
    if (this.screenChips) {
      rec._screenSlot = null
      chip.classList.add('screen-chip-visible')
      rec.chipLeader?.classList.add('visible')
    }
    chip.style.zIndex = String(++chatZ)
    /* 368 is the design height, not a promise the canvas can keep. The
       computers graph is ~338px tall at 1280x800, so a fixed 368 panel could
       not fit however it was placed: the clamp put it as high as it could and
       it still hung past the bottom, with its message input measured 104px
       BELOW the viewport -- unclickable, and not because anything covered it.
       Fit the panel to the canvas it lives in and it stays whole. */
    const availableH = this.screenChips ? (this._wrapH || this.H) : this.H
    const chatH = Math.max(240, Math.min(368, availableH - 12))
    rec.chipW = 316; rec.chipH = chatH

    const chat = buildChat({
      title: rec.agent.name,
      subtitle: `${ROLES[rec.agent.role].label} · context`,
      roleKey: rec.agent.role,
      onClose: () => this.closeChat(rec),
    })
    chip.appendChild(chat)

    chip.style.width = '316px'
    chip.style.height = chatH + 'px'
    rec._chipTimer = setTimeout(() => {
      if (!rec.chatOpen) return
      if (this.screenChips) {
        chip.style.width = '316px'
        chip.style.height = chatH + 'px'
      } else {
        chip.style.width = ''
        chip.style.height = ''
      }
    }, 520)
    // the sim may be asleep — re-place now (snapped: a lone tick's ease
    // would strand the chat mid-glide) so the 316×368 chat is clamped and
    // slotted for its real size instead of the old preview's
    if (this.screenChips || this.simulation.alpha() < 0.02) {
      this._snapChips = true; this.tick(); this._snapChips = false
    }
  }

  closeChat(rec) {
    const chip = rec.chip
    const restingW = this.screenChips ? SCREEN_CHIP_W : CHIP_W
    const restingH = this.screenChips ? SCREEN_CHIP_H : CHIP_H
    clearTimeout(rec._chipTimer)
    chip.style.width = chip.offsetWidth + 'px'
    chip.style.height = chip.offsetHeight + 'px'
    void chip.offsetWidth
    chip.classList.remove('as-chat')
    chip.setAttribute('role', 'button')   // resting chip is a button again
    chip.style.zIndex = ''        // back to the resting chip's own stacking
    rec.chatOpen = false
    chip.style.width = restingW + 'px'
    chip.style.height = (rec.prevH || restingH) + 'px'
    rec._chipTimer = setTimeout(() => {
      chip.querySelector('.chat')?.remove()
      /* Back to CHIP_W, not to nothing. Clearing the inline width is the right
         move for .as-chat, which has a 316px width in CSS to fall back on --
         but the RESTING chip deliberately has no CSS width at all (see CHIP_W
         above), so clearing it here let the box grow to whatever its text
         happened to measure. Observed: 224 -> 316 on open -> 342 on close, and
         drifting further on every context update, while placement went on
         reasoning about a 224px rectangle. That is how a closed chat left a
         box printed through the codex bubble and another hanging 26px past the
         panel edge. Height stays cleared -- renderChipPreview re-measures it. */
      chip.style.width = restingW + 'px'
      chip.style.height = ''
      this.renderChipPreview(rec)
    }, 500)
    rec.chipW = restingW; rec.chipH = rec.prevH || restingH
    if (this.screenChips) rec._screenSlot = null
    if (this.screenChips || this.simulation.alpha() < 0.02) { // asleep sim / screen overlay: re-place now
      this._snapChips = true; this.tick(); this._snapChips = false
    }
  }

  /** Escape → close the most recently raised open chat (audit #27). */
  _escTopChat(e) {
    if (e.key !== 'Escape' || this._destroyed) return
    // the settings drawer is modal (page inert behind it) and owns Escape
    // while open — closing a chat underneath it would be action at a distance
    if (document.querySelector('.drawer.open')) return
    let top = null, topZ = -1
    for (const n of this.nodes.values()) {
      if (!n.chatOpen || !n.chip) continue
      // open chats carry ascending inline z-indexes (chatZ, written on open
      // and on pointerdown-raise) — the largest one is the visually topmost
      const z = Number(n.chip.style.zIndex) || 0
      if (z > topZ) { topZ = z; top = n }
    }
    if (!top) return
    this.closeChat(top)
    // hand focus to the surviving chip (tabindex persists through the morph)
    // so a keyboard user is not dropped onto <body> when the chat's input
    // disappears under them
    top.chip.focus()
  }

  removeNode(rec, animate, delay = 0) {
    if (rec._flingRaf) { cancelAnimationFrame(rec._flingRaf); rec._flingRaf = null }
    clearTimeout(rec._ringTimer)                   // bounded pulse / settle timers
    clearTimeout(rec._settleTimer)                 // must not outlive the node
    this.nodes.delete(rec.id)
    rec._screenRuntimeUnsub?.()
    rec._screenRuntimeUnsub = null
    if (rec.chip) { rec.chip.remove() }
    rec.chipLeader?.remove()
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
    if (this._treeActive()) { this.simulation.stop(); this._layoutTree(true) }
  }

  removeAgent(id) {
    const rec = this.nodes.get(id)
    if (!rec) return
    if (rec.chatOpen) this.closeChat(rec)
    this.removeNode(rec, true)
    this.refreshForces()
    this.updateDensity()
    if (this._treeActive()) { this.simulation.stop(); this._layoutTree(true) }
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
      normal (and the label's owner nudged the other way).
      A velocity-only nudge fades as alpha cools (velocityDecay eats it every
      tick), so in a tight, short canvas — the agent page's subtree strip,
      several siblings fighting for ~240px of height — the system could settle
      at rest with a real, measured penetration (up to 25px) instead of a
      resolved one: confirmed by direct QA measurement, not merely theoretical.
      forceCollide avoids exactly this by correcting POSITION directly, not
      only velocity; this force now does the same, in two Gauss-Seidel passes
      per tick (matching forceCollide's own iterations(2) pattern above), so
      the separation actually holds once motion stops, not just while it's
      still moving. Position deltas mutate x/y inside d3's force-application
      phase — before its own fx/fy snap-back and before tick() clamps/renders
      — so pinned nodes (drag, fling, edit mode) are unaffected, same as every
      other d3-force. O(n²) × 2 at n ≤ ~16 — still negligible next to charge. */
  _labelAvoidForce(nodes) {
    const resolve = () => {
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
          // round-4 QA measured this INCREASING margin as the actual cause
          // of a bigger clamp-band deficit on the agent page's short canvas
          // (the extra clearance target didn't fit in the room available,
          // it just raised how much room was being demanded) — reverted.
          const min = b.r + 8           // matches _resolveClampedLabels' target margin
          const d2 = dx * dx + dy * dy
          if (d2 >= min * min) continue
          let d = Math.sqrt(d2)
          if (d < 1e-3) { dx = 0; dy = -1; d = 1 }
          const pen = (min - d) / d
          const push = pen * 0.5
          b.vx += dx * push * 0.6; b.vy += dy * push * 0.6
          a.vx -= dx * push * 0.4; a.vy -= dy * push * 0.4
          const corr = pen * 0.5                   // the part that actually guarantees rest-state clearance
          b.x += dx * corr * 0.6; b.y += dy * corr * 0.6
          a.x -= dx * corr * 0.4; a.y -= dy * corr * 0.4
        }
      }
    }
    return () => { resolve(); resolve() }
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
    // Compact-label mode. QA proved (offline replay on frozen 16-node
    // geometry) that a 294px-tall canvas is GEOMETRICALLY unable to host
    // two labelled bubbles in a vertical stack: separating them needs
    // r_top + labelH + r_bot + 8, and even the smallest radius pair came up
    // 13px short — every pair on that canvas is impossible, so no amount of
    // solver iteration converges. The honest fix is to stop demanding room
    // that doesn't exist: below the threshold the (redundant) role row is
    // dropped, which shrinks the label block on BOTH axes — ~21px less
    // height to clear, and labels roughly half as wide, since the role
    // strings are the long ones. Identity survives on the name row and its
    // role-coloured dot, exactly as the legend already reads them.
    /* ...and the same escalation when the canvas is too NARROW, which a height
       test cannot see at all. The agent page's canvas is 360px tall at 1024,
       1280 and 1440 alike -- identical, all three clear of the height
       threshold -- yet only the narrow ones collide, because what runs out is
       horizontal room for nine full labels. Measured on #/agent at 1024x768:
       bubbles interpenetrating by up to 36px and role labels overlapping by up
       to 47px, worsening as the sim spawns (28 of 28 consecutive samples at
       twelve agents). 1280 (canvas 1214) is marginal, overlapping once the
       fleet passes ten; 1440 (canvas 1374) and up are clean.
       What is tested is therefore demand against supply: the labels sharing a
       row need a certain width, and the canvas either has it or does not. Two
       simpler rules were tried and both were wrong in a way worth recording.
       A residual-overlap detector grades a layout that lives in model
       coordinates while the collision happens in rendered ones, and the two
       disagree in BOTH directions -- it missed the real overlap at 1024 and
       fired on a clean canvas at 1600. A bare width threshold ignores how many
       labels are actually competing, so it compacted the computers page at
       1600, where four labels in its 1130px canvas fit with room to spare.
       Row demand is the thing that genuinely runs out, and it falls as the
       fleet shrinks and rises as it grows, which is the behaviour observed. */
    const compact = this.H < 340 || this._rowDemandExceedsWidth()
    if (compact !== this._compactLabels) {
      this._compactLabels = compact
      this.container.classList.toggle('labels-compact', compact)
      this._labelH = compact ? 24 : 41
      for (const n of this.nodes.values()) {   // widths must be re-measured
        n.labelH = this._labelH
        n.labelW = n._labelWHeur || n.labelW
        n._labelMeasured = false
      }
    }
    // Self-healing label measurement: catches every node the spawn-time
    // read in spawnNode() missed because its container wasn't connected to
    // the document yet (the whole initial graph, always — see the comment
    // there). Cheap: each node is checked once until it succeeds, then never
    // again — not a per-frame cost once the graph has settled.
    for (const n of this.nodes.values()) {
      if (n._labelMeasured || !n.el.isConnected) continue
      const w = Math.max(
        n.el.querySelector('.node-name')?.offsetWidth || 0,
        n.el.querySelector('.node-role')?.offsetWidth || 0,   // 0 when compact hides it
      )
      if (w > 0) {
        n.labelW = Math.max(n._labelWHeur || 0, w + 6)
        n.labelH = this._labelH || 41
        n._labelMeasured = true
      }
    }
    /* The context box needs exactly the same treatment, for exactly the same
       reason. renderChipPreview() reads offsetHeight the moment it writes the
       preview, which for the whole initial graph happens while the view is
       still detached -- so the read returns 0, the box falls back to CHIP_H,
       and _placeChip() then reasons about a 44px rectangle for a box that
       renders 74px tall. That is a 30px overhang, and it is why codex's box
       printed its last line through the top of codex's own bubble. Checked
       once per chip until it succeeds, like the labels above. */
    for (const n of this.nodes.values()) {
      if (n._chipHMeasured || !n.chip || n.chatOpen || !n.chip.isConnected) continue
      const h = n.chip.offsetHeight
      if (h > 0) {
        // Re-elect: _placeChip keeps its chosen slot unless a rival beats it by
        // 900, which is deliberate hysteresis against flicker but also means a
        // slot chosen against the wrong height would simply persist. Dropping
        // the slot is what actually converts a corrected measurement into a
        // corrected position.
        if (h !== n.chipH) {
          if (this.screenChips) n._screenSlot = null
          else n._chipSlot = null
        }
        n.chipH = h; n.prevH = h; n._chipHMeasured = true
      }
    }
    // padTop/padBot were tuned for aesthetic breathing room and never
    // re-examined against how little of it the agent page's short subtree
    // canvas actually has — round-4 QA proved a clamp-to-clamp deficit as
    // large as 17.5-29.8px (63px at 1280x800) between two label-avoiding
    // nodes pinned at opposite Y clamps. Trimmed 10px off each edge, and
    // trimmed harder still on a short canvas where the room is what's
    // actually scarce: aesthetic breathing room is worth less than legible,
    // non-overlapping labels.
    const padX = 34
    const padTop = compact ? 40 : 54, padBot = compact ? 34 : 48
    const cx0 = this.W / 2, cy0 = this.H / 2
    const nodesArr = [...this.nodes.values()]

    for (const n of nodesArr) {
      n.x = Math.max(n.r + padX, Math.min(this.W - n.r - padX, n.x))
      n.y = Math.max(n.r + padTop, Math.min(this.H - n.r - padBot, n.y))
    }
    this._resolveClampedLabels(nodesArr, padX, padTop, padBot)

    // once per tick, not once per chip — every chip reasons about the same set
    if (this.screenChips) {
      for (const n of nodesArr) {
        n.el.style.transform = `translate(${n.x}px, ${n.y}px) translate(-50%,-50%)`
      }
      this._placeScreenChips(nodesArr)
    } else {
      this._uiRects = this._uiObstacles()
      for (const n of nodesArr) {
        n.el.style.transform = `translate(${n.x}px, ${n.y}px) translate(-50%,-50%)`
        if (n.chip) this._placeChip(n, cx0, cy0)
      }
    }
    for (const l of this.links || []) {
      const s = l.source, t = l.target
      const dx = t.x - s.x, dy = t.y - s.y
      const L = Math.hypot(dx, dy) || 1
      // a taut quadratic — 5-10px of bow, down from 12-24. The organic swing
      // read as a mind-map doodle; an engineered diagram keeps its connectors
      // nearly straight and lets the curve be felt, not seen.
      const bendAbs = Math.max(5, Math.min(10, L * 0.05 * (l.bendMul || 1)))
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

  /** The Y clamp above runs strictly AFTER _labelAvoidForce (d3 fires all
      forces, then this listener), with no knowledge of label overlap — so it
      can shove a node straight back into a label the force just cleared it
      from. QA measured this reproducing at up to 41px on the agent page's
      short subtree canvas, which can leave as little as ~78-109px of
      vertical room versus 394-494px on the Computers page: nowhere for a
      vertical correction to land. Resolve any surviving intrusion along X
      instead — that axis still has room — in a few cheap relaxation passes
      (same closest-point math as _labelAvoidForce, X component only). Y is
      deliberately left alone here so this can't re-open the fight the clamp
      above just settled.
      Round 2 (re-verified by QA, ~8-18x smaller but not zero): more passes,
      a larger target margin, and a relaxed intra-loop edge bound.
      Round 3 (re-verified by QA, WORSE at 1600x900 — root-caused by replaying
      the exact frozen geometry offline, not guessed): two bugs, not one.
      (a) The larger margin from round 2 *increased* the vertical clearance
      two opposite-clamped nodes need — QA's own numbers: r+8 needed 148px of
      clamp-to-clamp room, r+12 needed 152px, while only ~134.5px existed on
      the agent page's short canvas. More margin demanded more room the
      canvas didn't have; reverted to +8 (tick()'s padTop/padBot were also
      trimmed 10px each — see above — which is the other side of that ledger:
      actually free the room instead of asking for less of it).
      (b) When the intruding node's centre sits INSIDE the label's horizontal
      span, the old code did `ddx = tieBreak(±1)` and pushed by `ddx * pen` —
      since |ddx| was forced to exactly 1 (a unit step), not the real
      distance, the resulting move was ~0.26px per pass regardless of how far
      the node actually had to travel; QA's offline replay showed a case
      needing ~100px of clearance taking 200-2000 passes at that rate. Fixed
      with the closed form: the exact escape position is the nearer label
      edge plus whatever extra offset clears `min` at the current vertical
      distance (`sqrt(min² - ddy²)`) — one step, not a crawl.
      Remaining case QA proved real: true geometric impossibility (two nodes
      pinned at opposite Y clamps, with no on-canvas X position wide enough
      to clear a long label at all — deficits up to 63px measured). X alone
      cannot solve what X-only math cannot reach; a small, hard-capped 2D
      nudge runs once at the end as the genuine last resort, closing however
      much of the residual it can within its cap rather than leaving 0. */
  /** True when the widest row of nodes needs more horizontal space for its
      labels than the canvas has. Rows are found by clustering y, which is
      exact in tree layout (nodes are placed on shared row Ys) and a fair
      approximation under the force layout, where nodes still band loosely.
      Each node claims the greater of its label width and its own diameter,
      since a bubble occupies space whether or not its label is the wider of
      the two. Measured against the drawable width less the same 34px of edge
      padding the clamp below uses, so this asks precisely the question the
      layout is about to fail to answer. */
  _rowDemandExceedsWidth() {
    /* Bucketing y was the obvious way to find rows and it is not reliable
       here: the label resolver nudges nodes off their tier's exact Y, so two
       bubbles plainly sitting side by side landed in different buckets and
       each row's demand read as half of what it was. What actually matters is
       not "same row" but "must fit beside each other", which is an overlap of
       vertical extents -- so that is what is tested, per node, against every
       other node whose bubble-plus-label band intersects its own. */
    const arr = [...this.nodes.values()]
    const top = (n) => n.y - n.r
    const bot = (n) => n.y + n.r + (n.labelH || 41)
    const span = (n) => Math.max(n.labelW || 100, n.r * 2)
    let worst = 0
    for (const a of arr) {
      let need = 0
      // +8 per node because labels that merely TOUCH are already a defect --
      // the layout needs a gap between them, and without that allowance the
      // test sat exactly on the boundary at 1280 with eleven agents, firing on
      // some frames and letting 4.7px of bubble interpenetration through on
      // others.
      for (const b of arr) if (top(b) < bot(a) && top(a) < bot(b)) need += span(b) + 8
      if (need > worst) worst = need
    }
    return worst > this.W - 68
  }

  _resolveClampedLabels(nodesArr, padX, padTop, padBot) {
    const edgePad = Math.max(4, padX - 12)
    for (let pass = 0; pass < 6; pass++) {
      let moved = false
      for (let i = 0; i < nodesArr.length; i++) {
        const a = nodesArr[i]
        const hw = (a.labelW || 100) / 2
        const top = a.y + a.r + 2
        const bot = a.y + a.r + (a.labelH || 41)
        for (let j = 0; j < nodesArr.length; j++) {
          if (j === i) continue
          const b = nodesArr[j]
          const px = Math.max(a.x - hw, Math.min(a.x + hw, b.x))
          const py = Math.max(top, Math.min(bot, b.y))
          const ddx = b.x - px
          const ddy = b.y - py
          const min = b.r + 8
          const d2 = ddx * ddx + ddy * ddy
          if (d2 >= min * min) continue
          if (Math.abs(ddx) < 0.5) {
            // b's centre is inside a's label span — jump straight to the
            // exact minimum escape position (nearer edge + clearance) rather
            // than nudge by a fixed small step.
            const s = Math.sqrt(Math.max(0, min * min - ddy * ddy))
            const target = b.x >= a.x ? a.x + hw + s : a.x - hw - s
            const deficit = target - b.x
            b.x += deficit * 0.6
            a.x -= deficit * 0.4
          } else {
            const d = Math.sqrt(d2)
            const pen = (min - d) / d
            b.x += ddx * pen * 0.6
            a.x -= ddx * pen * 0.4
          }
          moved = true
        }
      }
      if (!moved) break
      for (const n of nodesArr) n.x = Math.max(n.r + edgePad, Math.min(this.W - n.r - edgePad, n.x))
    }

    // Last resort: a hard-capped 2D nudge for whatever the X-only passes
    // above genuinely could not reach. One pass, small ceiling — this closes
    // the tail of an impossible layout, it does not re-open the fight the
    // outer Y clamp already settled.
    const YIELD_CAP = 14
    for (let i = 0; i < nodesArr.length; i++) {
      const a = nodesArr[i]
      const hw = (a.labelW || 100) / 2
      const top = a.y + a.r + 2
      const bot = a.y + a.r + (a.labelH || 41)
      for (let j = 0; j < nodesArr.length; j++) {
        if (j === i) continue
        const b = nodesArr[j]
        const px = Math.max(a.x - hw, Math.min(a.x + hw, b.x))
        const py = Math.max(top, Math.min(bot, b.y))
        let dx = b.x - px, dy = b.y - py
        const min = b.r + 8
        const d2 = dx * dx + dy * dy
        if (d2 >= min * min) continue
        let d = Math.sqrt(d2)
        if (d < 1e-3) { dx = 0; dy = -1; d = 1 }
        const push = Math.min(YIELD_CAP, min - d)
        const ux = dx / d, uy = dy / d
        b.x += ux * push * 0.6; b.y += uy * push * 0.6
        a.x -= ux * push * 0.4; a.y -= uy * push * 0.4
      }
    }
    // The Y bound here is deliberately RELAXED, not the full aesthetic
    // padTop/padBot. QA caught the strict version cancelling the very nudge
    // above: measured 20.29px deficit → 10.12px after the nudge → 21.19px
    // after this clamp, i.e. the only stage that helped was thrown away on
    // the next line — the same "clamp runs after the fix" bug round 5
    // documented for _labelAvoidForce, reintroduced here. The nudge is
    // capped at YIELD_CAP, so letting Y eat that much aesthetic padding is
    // bounded, and the node stays comfortably on canvas either way.
    const yPad = Math.max(6, YIELD_CAP)
    for (const n of nodesArr) {
      n.x = Math.max(n.r + edgePad, Math.min(this.W - n.r - edgePad, n.x))
      n.y = Math.max(n.r + Math.min(padTop, yPad), Math.min(this.H - n.r - Math.min(padBot, yPad), n.y))
    }
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
  /** The panel chrome overlaid on this canvas, in canvas coordinates.

      The context boxes were placed against nodes and against each other and
      against nothing else, so on #/computers a box would take the top-right
      pocket and print its name and activity line underneath the Tree/Physics
      segment and the Edit button — unreadable, and the toolbar swallowed the
      click that was supposed to open its chat.
      Taken from the DOM rather than from a list of class names, so the next
      overlay someone adds is reserved without anyone remembering to. Divided
      by the zoom because these elements are siblings of the canvas and so sit
      outside its transform, while the boxes are placed inside it. */
  _buildScreenChipOverlay() {
    this.zoomHost.classList.add('screen-chips')
    const layer = document.createElement('div')
    layer.className = 'graph-chip-overlay'
    layer.setAttribute('aria-label', 'Fleet monitoring context')
    const leaders = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    leaders.setAttribute('class', 'graph-chip-leaders')
    leaders.setAttribute('aria-hidden', 'true')
    layer.appendChild(leaders)
    this.zoomHost.appendChild(layer)
    this.screenOverlay = layer
    this.screenLeaderSvg = leaders
  }

  _queueScreenGeometryRefresh() {
    if (!this.screenChips || this._destroyed || this._screenGeometryRaf) return
    this._screenGeometryRaf = requestAnimationFrame(() => {
      this._screenGeometryRaf = null
      if (this._destroyed) return
      this._screenUiDirty = true
      this._screenLayoutKey = ''
      this._placeScreenChips([...this.nodes.values()])
    })
  }

  _refreshScreenUiObstacles() {
    const host = this.zoomHost
    if (!host?.isConnected) return this._screenUiRects || []
    const hb = host.getBoundingClientRect()
    const originX = hb.left + host.clientLeft
    const originY = hb.top + host.clientTop
    const out = []
    for (const ov of host.children) {
      if (ov === this.container || ov === this.screenOverlay) continue
      if (ov === this.fitEl && !ov.classList.contains('show')) continue
      if (ov.classList.contains('graph-hint') && !ov.classList.contains('show')) continue
      if (ov.classList.contains('graph-crumb') && !ov.textContent.trim()) continue
      if (ov.classList.contains('graph-edit-note') && !host.classList.contains('editing')) continue
      const cs = getComputedStyle(ov)
      if (cs.display === 'none' || cs.visibility === 'hidden') continue
      if (parseFloat(cs.opacity) < 0.05 && ov !== this.fitEl) continue
      const r = ov.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) continue
      const pad = 6
      out.push({
        x: r.left - originX - pad,
        y: r.top - originY - pad,
        w: r.width + pad * 2,
        h: r.height + pad * 2,
        weight: 8,
      })
    }
    this._screenUiRects = out
    this._screenUiDirty = false
    this._screenUiVersion = (this._screenUiVersion || 0) + 1
    return out
  }

  _screenNodeObstacles(nodesArr) {
    const z = this.zoom || 1
    const pad = 4
    const out = []
    for (const n of nodesArr) {
      const x = n.x * z + this.panX
      const y = n.y * z + this.panY
      const r = n.r * z
      out.push({ x: x - r - pad, y: y - r - pad, w: r * 2 + pad * 2, h: r * 2 + pad * 2, weight: 3 })
      const lw = Math.max(1, (n.labelW || 100) * z)
      const lh = Math.max(1, (n.labelH || 41) * z)
      out.push({
        x: x - lw / 2 - pad,
        y: y + r + 2 * z - pad,
        w: lw + pad * 2,
        h: lh + pad * 2,
        weight: 4,
      })
    }
    return out
  }

  _screenChipCandidates(n, cw, ch) {
    const W = this._wrapW || this.W
    const H = this._wrapH || this.H
    const maxX = W - cw - SCREEN_EDGE
    const maxY = H - ch - SCREEN_EDGE
    if (maxX < SCREEN_EDGE || maxY < SCREEN_EDGE) return []
    const z = this.zoom || 1
    const sx = n.x * z + this.panX
    const sy = n.y * z + this.panY
    const sr = n.r * z
    const labelH = (n.labelH || 41) * z
    const out = []
    const seen = new Set()
    const add = (key, x, y) => {
      const bx = Math.max(SCREEN_EDGE, Math.min(maxX, x))
      const by = Math.max(SCREEN_EDGE, Math.min(maxY, y))
      const tag = `${Math.round(bx * 2)}:${Math.round(by * 2)}`
      if (seen.has(tag)) return
      seen.add(tag)
      out.push({ key, x: bx, y: by })
    }
    const side = sr + 18
    add('near:right', sx + side, sy - ch / 2)
    add('near:left', sx - side - cw, sy - ch / 2)
    add('near:above', sx - cw / 2, sy - sr - ch - 14)
    add('near:below', sx - cw / 2, sy + sr + labelH + 12)
    add('near:upper-right', sx + sr * 0.55, sy - sr - ch - 8)
    add('near:upper-left', sx - sr * 0.55 - cw, sy - sr - ch - 8)
    add('near:lower-right', sx + side, sy + sr * 0.25)
    add('near:lower-left', sx - side - cw, sy + sr * 0.25)

    const radii = [sr + Math.max(96, Math.min(cw, ch) * 0.78), sr + Math.max(178, cw * 0.72)]
    for (let ring = 0; ring < radii.length; ring++) {
      for (let k = 0; k < 12; k++) {
        const ang = (k / 12) * Math.PI * 2
        add(`ring:${ring}:${k}`,
          sx + Math.cos(ang) * radii[ring] - cw / 2,
          sy + Math.sin(ang) * radii[ring] - ch / 2)
      }
    }

    const cols = Math.max(1, Math.floor((W - SCREEN_EDGE * 2 + SCREEN_CHIP_GAP) / (cw + SCREEN_CHIP_GAP)))
    const rows = Math.max(1, Math.floor((H - SCREEN_EDGE * 2 + SCREEN_CHIP_GAP) / (ch + SCREEN_CHIP_GAP)))
    const dx = cols > 1 ? (W - SCREEN_EDGE * 2 - cw) / (cols - 1) : 0
    const dy = rows > 1 ? (H - SCREEN_EDGE * 2 - ch) / (rows - 1) : 0
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        add(`grid:${row}:${col}`, SCREEN_EDGE + col * dx, SCREEN_EDGE + row * dy)
      }
    }

    // The coarse full-box grid above is an excellent first pass, but a
    // 300px instrument can still fit in a pocket whose left edge lies between
    // those columns. Sample a staggered half-box lattice too. This remains
    // pure arithmetic (no layout reads) and turns the room revealed at low
    // zoom into useful capacity instead of leaving narrow dead strips unused.
    const stepX = Math.max(72, Math.min(108, cw * 0.34))
    const stepY = Math.max(54, Math.min(76, ch * 0.5))
    let latticeRow = 0
    for (let y = SCREEN_EDGE; y <= maxY + 0.5; y += stepY, latticeRow++) {
      const offset = latticeRow % 2 ? stepX / 2 : 0
      for (let x = SCREEN_EDGE + offset; x <= maxX + 0.5; x += stepX) {
        add(`lattice:${latticeRow}:${Math.round(x)}`, x, y)
      }
      add(`lattice:${latticeRow}:edge`, maxX, y)
    }
    for (let x = SCREEN_EDGE; x <= maxX + 0.5; x += stepX) {
      add(`lattice:floor:${Math.round(x)}`, x, maxY)
    }
    add('lattice:floor:edge', maxX, maxY)
    return out
  }

  _screenCandidate(rec, cand, cw, ch, obstacles, placed) {
    let overlap = 0
    for (const o of obstacles) overlap += rectOverlap(cand.x, cand.y, cw, ch, o.x, o.y, o.w, o.h) * (o.weight || 1)
    for (const p of placed) {
      overlap += rectOverlap(
        cand.x, cand.y, cw, ch,
        p.x - SCREEN_CHIP_GAP / 2, p.y - SCREEN_CHIP_GAP / 2,
        p.w + SCREEN_CHIP_GAP, p.h + SCREEN_CHIP_GAP,
      ) * 12
    }
    const z = this.zoom || 1
    const sx = rec.x * z + this.panX
    const sy = rec.y * z + this.panY
    const bx = Math.max(cand.x, Math.min(sx, cand.x + cw))
    const by = Math.max(cand.y, Math.min(sy, cand.y + ch))
    const leader = Math.hypot(sx - bx, sy - by)
    // At low zoom, the transformed canvas exposes a real screen-space margin.
    // Prefer spending that newly available room before covering the topology;
    // this is what makes zooming out reveal more monitoring instruments.
    const canvasArea = z < 1
      ? rectOverlap(cand.x, cand.y, cw, ch, this.panX, this.panY, this.W * z, this.H * z)
      : cw * ch
    const revealedMargin = Math.max(0, cw * ch - canvasArea)
    return { ...cand, overlap, leader, score: overlap * 80 + leader - revealedMargin * 0.012 }
  }

  _chooseScreenSlot(rec, cw, ch, obstacles, placed, allowBuried = false) {
    const evaluated = this._screenChipCandidates(rec, cw, ch)
      .map(c => this._screenCandidate(rec, c, cw, ch, obstacles, placed))
    if (!evaluated.length) return null
    const clear = evaluated.filter(c => c.overlap < 0.01)
    const pool = clear.length ? clear : (allowBuried ? evaluated : [])
    if (!pool.length) return null
    let best = pool[0]
    for (let i = 1; i < pool.length; i++) if (pool[i].score < best.score) best = pool[i]
    if (rec._screenSlot) {
      const prior = pool.find(c => c.key === rec._screenSlot.key)
      if (prior && prior.score <= best.score + SCREEN_SLOT_HYSTERESIS) best = prior
    }
    return best
  }

  _screenPreviewSlots(ranked, obstacles, fixedPlaced) {
    // A one-choice greedy walk can spend the only useful pocket on the first
    // agent and unnecessarily withhold every lower-ranked one. Keep a small,
    // bounded beam of clear arrangements instead: rank order is inviolate and
    // the search still stops at the first agent for which no clear placement
    // exists, but each early box considers the monitoring capacity behind it.
    const BEAM = 36
    const BRANCHES = 16
    let states = [{ placed: fixedPlaced.slice(), picks: [], score: 0 }]

    for (const rec of ranked) {
      const cw = rec.chipW || SCREEN_CHIP_W
      const ch = rec.chipH || SCREEN_CHIP_H
      const base = this._screenChipCandidates(rec, cw, ch)
        .map(c => this._screenCandidate(rec, c, cw, ch, obstacles, []))
        .filter(c => c.overlap < 0.01)
        .map(c => ({
          ...c,
          stableScore: c.score - (rec._screenSlot?.key === c.key ? SCREEN_SLOT_HYSTERESIS : 0),
        }))
        .sort((a, b) => a.stableScore - b.stableScore)
      if (!base.length) break

      const next = []
      for (const state of states) {
        let branches = 0
        for (const cand of base) {
          let blocked = false
          for (const p of state.placed) {
            if (rectOverlap(
              cand.x, cand.y, cw, ch,
              p.x - SCREEN_CHIP_GAP / 2, p.y - SCREEN_CHIP_GAP / 2,
              p.w + SCREEN_CHIP_GAP, p.h + SCREEN_CHIP_GAP,
            ) > 0) { blocked = true; break }
          }
          if (blocked) continue
          next.push({
            placed: state.placed.concat({ x: cand.x, y: cand.y, w: cw, h: ch }),
            picks: state.picks.concat({ rec, slot: cand, cw, ch }),
            score: state.score + cand.stableScore,
          })
          if (++branches >= BRANCHES) break
        }
      }
      if (!next.length) break
      next.sort((a, b) => a.score - b.score)
      const unique = new Set()
      states = next.filter(state => {
        const key = state.picks.map(p => `${p.slot.key}:${p.slot.x.toFixed(0)},${p.slot.y.toFixed(0)}`).join('|')
        if (unique.has(key)) return false
        unique.add(key)
        return true
      }).slice(0, BEAM)
    }
    states.sort((a, b) => b.picks.length - a.picks.length || a.score - b.score)
    return states[0]?.picks || []
  }

  _setScreenChipVisible(rec, visible) {
    if (!rec.chip) return
    rec._screenPlaced = visible
    rec.chip.classList.toggle('screen-chip-visible', visible)
    rec.chip.tabIndex = visible && !this.editMode ? 0 : -1
    rec.chipLeader?.classList.toggle('visible', visible)
  }

  _drawScreenLeader(rec, x, y, cw, ch) {
    const line = rec.chipLeader
    if (!line) return
    const z = this.zoom || 1
    const sx = rec.x * z + this.panX
    const sy = rec.y * z + this.panY
    const bx = Math.max(x, Math.min(sx, x + cw))
    const by = Math.max(y, Math.min(sy, y + ch))
    const dx = sx - bx, dy = sy - by
    const d = Math.hypot(dx, dy) || 1
    const rim = rec.r * z + 3
    const values = {
      x1: bx.toFixed(1), y1: by.toFixed(1),
      x2: (sx - (dx / d) * rim).toFixed(1),
      y2: (sy - (dy / d) * rim).toFixed(1),
    }
    for (const [name, value] of Object.entries(values)) {
      if (line.getAttribute(name) !== value) line.setAttribute(name, value)
    }
  }

  _applyScreenSlot(rec, slot, cw, ch, placed) {
    rec._screenSlot = { key: slot.key }
    rec._screenX = slot.x
    rec._screenY = slot.y
    const transform = `translate3d(${slot.x.toFixed(1)}px, ${slot.y.toFixed(1)}px, 0)`
    if (rec.chip.style.transform !== transform) rec.chip.style.transform = transform
    this._setScreenChipVisible(rec, true)
    this._drawScreenLeader(rec, slot.x, slot.y, cw, ch)
    placed.push({ x: slot.x, y: slot.y, w: cw, h: ch })
  }

  _placeScreenChips(nodesArr) {
    if (!this.screenChips || !this.screenOverlay) return
    if (this._screenUiDirty) this._refreshScreenUiObstacles()
    const rank = (rec) => rec.agent.state === 'spawning'
      ? SCREEN_PRIORITY.spawned
      : (SCREEN_PRIORITY[rec.agent.role] ?? 1)
    const ranked = nodesArr.filter(n => n.chip).sort((a, b) => {
      const delta = rank(b) - rank(a)
      return delta || a.agent.name.localeCompare(b.agent.name)
    })
    if (this.editMode) {
      for (const rec of ranked) this._setScreenChipVisible(rec, false)
      this._screenLayoutKey = 'edit'
      return
    }
    const key = `${this._wrapW || this.W}x${this._wrapH || this.H}`
      + `|${this.zoom.toFixed(4)},${this.panX.toFixed(2)},${this.panY.toFixed(2)}`
      + `|ui${this._screenUiVersion || 0}`
      + ranked.map(n => `|${n.id}:${n.x.toFixed(1)},${n.y.toFixed(1)},${n.r},${n.labelW.toFixed(1)},${n.labelH},${n.chipW},${n.chipH},${n.chatOpen ? 1 : 0}`).join('')
    if (key === this._screenLayoutKey) return
    this._screenLayoutKey = key

    const obstacles = this._screenNodeObstacles(nodesArr).concat(this._screenUiRects || [])
    // The fit control fades in on the same turn that zoom geometry changes.
    // Keep a conservative cached-shape reservation as well as the measured UI
    // obstacle so no chip can win its bottom-right slot during that transition.
    if (this._fitActive) obstacles.push({
      x: (this._wrapW || this.W) - 112,
      y: (this._wrapH || this.H) - 57,
      w: 104,
      h: 49,
      weight: 8,
    })
    const placed = []
    const open = ranked.filter(n => n.chatOpen)
    for (const rec of open) {
      const cw = rec.chipW || 316
      const ch = rec.chipH || 368
      const slot = this._chooseScreenSlot(rec, cw, ch, obstacles, placed, true)
      if (slot) this._applyScreenSlot(rec, slot, cw, ch, placed)
      else this._setScreenChipVisible(rec, false)
    }

    const previews = ranked.filter(n => !n.chatOpen)
    const picks = this._screenPreviewSlots(previews, obstacles, placed)
    const picked = new Map(picks.map(p => [p.rec.id, p]))
    for (const rec of previews) {
      const choice = picked.get(rec.id)
      if (choice) this._applyScreenSlot(rec, choice.slot, choice.cw, choice.ch, placed)
      else this._setScreenChipVisible(rec, false)
    }
  }

  _uiObstacles() {
    if (this.screenChips) {
      return this._screenUiDirty ? this._refreshScreenUiObstacles() : (this._screenUiRects || [])
    }
    const host = this.container.parentElement
    if (!host) return []
    const cb = this.container.getBoundingClientRect()
    const z = this.zoom || 1
    const out = []
    for (const ov of host.children) {
      if (ov === this.container) continue
      const cs = getComputedStyle(ov)
      if (cs.visibility === 'hidden' || cs.pointerEvents === 'none' && cs.opacity === '0') continue
      if (parseFloat(cs.opacity) < 0.05) continue
      const r = ov.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) continue
      // 6px of clearance, so a box parks BELOW the toolbar rather than with its
      // top edge grazing it -- without the pad the solver was content to leave
      // a 1px overlap, which reads as a misalignment even though nothing is
      // actually hidden
      const pad = 6
      out.push({ x: (r.left - cb.left) / z - pad, y: (r.top - cb.top) / z - pad,
                 w: r.width / z + pad * 2, h: r.height / z + pad * 2 })
    }
    return out
  }

  _placeChip(n, cx0, cy0) {
    const cw = n.chatOpen ? 316 : n.chipW
    const ch = n.chipH        // chatOpen already carries the fitted chat height
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
      let s = 0, occ = 0, ui = 0
      for (const o of this.nodes.values()) {
        const bub = rectOverlap(x, y, cw, ch, o.x - o.r, o.y - o.r, o.r * 2, o.r * 2)
        const hw = (o.labelW || 100) / 2
        const lab = rectOverlap(x, y, cw, ch, o.x - hw, o.y + o.r + 2, hw * 2, o.labelH || 41)
        if (o === n) s += bub * 0.6 + lab * 1.8        // own name/role weigh MOST
        else { s += bub + lab * 1.1; occ += bub + lab }
        if (o !== n && o.chip && o._cx != null) {
          s += rectOverlap(x, y, cw, ch, o._cx, o._cy,
            o.chatOpen ? 316 : o.chipW, o.chipH) * 0.5
        }
      }
      // the panel's own chrome is weighted above a neighbouring bubble: a box
      // under a node is merely ugly, a box under the toolbar is unreadable AND
      // unclickable, because the toolbar takes the pointer
      for (const u of this._uiRects || []) {
        const hit = rectOverlap(x, y, cw, ch, u.x, u.y, u.w, u.h)
        s += hit * 6; occ += hit
        ui += hit
      }
      s += Math.hypot(x + cw / 2 - n.x, y + ch / 2 - n.y) * 2   // stay near the node
      return { s, occ, ui }
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
    /* On a canvas with no pocket clear of the toolbar — #/computers at
       1024x768 is one — the least-bad slot is still underneath it. Dimming is
       not the answer there: the chrome paints over the box and takes its
       pointer, so what is left is an illegible smear that cannot even be
       clicked. Withhold it instead. visibility rather than display so the box
       keeps its measured size, and it comes straight back the moment the
       layout offers a slot that clears. */
    const buried = !n.chatOpen && evals[slot].ui > 240
    if (buried !== !!n._chipBuried) {
      n._chipBuried = buried
      n.chip.style.visibility = buried ? 'hidden' : ''
    }
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
        if (this._treeActive()) {
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
        if (this._treeActive()) {
          rec.x = rec.fx; rec.y = rec.fy             // sim is paused: render by hand
          if (this.editMode) this._updateDropTarget(rec)
          this.tick()
        }
      }
    })

    // hover: ONE self-removing ripple ring from the bubble edge
    elm.addEventListener('pointerenter', () => {
      if (prefersCalm()) return
      // a rested focus ring wakes for the hover: the pulse no longer loops
      // forever, so this is where the "hidden branch" affordance gets re-said
      if (elm.classList.contains('focusable')) this._wakeFocusRing(rec)
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
        if (this.layout === 'tree') {                  // tidy view: glide home
          rec._editDragging = false
          rec.fx = null; rec.fy = null
          samples = []
          this._layoutTree(true)
          return
        }
        this._draggingNow = false                      // tick() cools the canvas as alpha decays
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
            const sp = Math.hypot(vx, vy)
            if (sp > FLING_CAP) { vx *= FLING_CAP / sp; vy *= FLING_CAP / sp }
          }
        }
        samples = []
        // The squash-stretch settle rides that SAME measurement (it used to
        // be a fixed 500ms / fixed overshoot, so a careful set-down rebounded
        // exactly as hard as a two-handed throw). Must run after the velocity
        // is known — hence moved below the block above, not before it.
        this._settleRelease(rec, Math.hypot(vx, vy))
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

  /** Release settle, scaled by the throw that caused it.
      The audit finding: `.settling` fired a fixed 500ms animation with a
      fixed ~0.97 overshoot on every single release, so the one moment on
      this surface that is genuinely about physics reported the same number
      whether the bubble was placed or hurled. `speed` is the px/ms release
      velocity already measured for the fling; against FLING_CAP it gives a
      0..1 energy that drives BOTH how far the glass over/undershoots
      (--settle-amp) and how long it takes to stop ringing (--settle-dur) —
      the two things that actually differ between a set-down and a throw.
      graph.css consumes both, with defaults matching the old fixed values.
      Deliberately NOT a class-only change: a duration is not expressible in
      a class without a fresh rule per bucket. */
  _settleRelease(rec, speed) {
    const elm = rec.el
    clearTimeout(rec._settleTimer)
    if (prefersCalm()) { elm.classList.remove('settling'); return }
    const e = Math.max(0, Math.min(1, (speed || 0) / FLING_CAP))
    const dur = Math.round(SETTLE_MIN_MS + (SETTLE_MAX_MS - SETTLE_MIN_MS) * e)
    elm.style.setProperty('--settle-dur', `${dur}ms`)
    elm.style.setProperty('--settle-amp',
      (SETTLE_MIN_AMP + (1 - SETTLE_MIN_AMP) * e).toFixed(3))
    // The duration now varies per release, so a still-running settle must be
    // restarted rather than left to finish on its old timing. The forced
    // reflow is paid ONLY in that re-grab-and-release case — the usual path
    // (class already gone) just adds it, which starts the animation anyway.
    if (elm.classList.contains('settling')) {
      elm.classList.remove('settling')
      void elm.offsetWidth
    }
    elm.classList.add('settling')
    rec._settleTimer = setTimeout(() => elm.classList.remove('settling'), dur + 90)
  }

  /** Dense-mode focus ring: attract, then rest.
      The audit finding: the ring animated `infinite`, i.e. every focusable
      bubble pulsed forever on a canvas that was otherwise completely still.
      Permanent motion is not an attractor, it is wallpaper — and it keeps
      the compositor awake on an idle page. It now runs FOCUS_PULSES cycles
      from the moment a node BECOMES focusable, then stops; pointerenter
      re-arms it, which is precisely when "does this bubble hide a branch?"
      is the question being asked. Re-adding the class after a forced reflow
      restarts the animation instead of resuming a finished one. */
  _wakeFocusRing(rec) {
    if (prefersCalm()) return
    clearTimeout(rec._ringTimer)
    // Only an ALREADY-armed ring needs the remove/reflow/re-add restart
    // dance. The common path — a node that has rested, or a whole graph
    // becoming dense at once — just adds the class, which starts the
    // animation on its own; forcing a synchronous layout per node there
    // would thrash the mount frame for no behavioural gain.
    if (rec.el.classList.contains('ring-awake')) {
      rec.el.classList.remove('ring-awake')
      void rec.el.offsetWidth
    }
    rec.el.classList.add('ring-awake')
    rec._ringTimer = setTimeout(() => rec.el.classList.remove('ring-awake'),
      FOCUS_PULSE_MS * FOCUS_PULSES + 80)
  }

  _sleepFocusRing(rec) {
    clearTimeout(rec._ringTimer)
    rec._ringTimer = null
    rec.el.classList.remove('ring-awake')
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
      const focusable = dense && hasKids && deep
      const was = rec.el.classList.contains('focusable')
      rec.el.classList.toggle('focusable', focusable)
      // The ring is armed on the TRANSITION into focusable, not held on for
      // as long as the state lasts — updateDensity() runs on every spawn and
      // reap, so re-arming unconditionally would restore the old permanent
      // loop by another route.
      if (focusable && !was) this._wakeFocusRing(rec)
      else if (!focusable && was) this._sleepFocusRing(rec)
      if (rec.chip && !this.screenChips) {
        rec.chip.style.opacity = (n >= DENSE_AT && !rec.chatOpen) ? '0' : ''
        rec.chip.style.pointerEvents = (n >= DENSE_AT && !rec.chatOpen) ? 'none' : ''
        // tab order must track visibility: opacity 0 + pointer-events none hides
        // a chip from the eye and the mouse but NOT from Tab (the .graph-fit
        // lesson in graph.css) — a keyboard user would land on nothing
        rec.chip.tabIndex = (n >= DENSE_AT && !rec.chatOpen) ? -1 : 0
      }
    }
    this.onDensity?.(dense)
    if (this.screenChips) this._queueScreenGeometryRefresh()
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
    if (this.screenChips) this._queueScreenGeometryRefresh()
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
    const sx = rec.x, sy = rec.y, dur = STRUCTURAL_MS, t0 = performance.now()
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur)
      // STRUCTURAL register, not the shared front-loaded ease-out cubic this
      // used to share with every micro interaction: a re-root re-arranges the
      // whole graph, and it should read as mass moving, not as a UI response.
      const e = EASE_STRUCTURAL(p)
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
    if (this.screenChips) this._queueScreenGeometryRefresh()
  }

  resize() {
    const w = this.container.clientWidth || this.W
    const h = this.container.clientHeight || this.H
    const wrapW = this.screenChips ? (this.zoomHost.clientWidth || w) : 0
    const wrapH = this.screenChips ? (this.zoomHost.clientHeight || h) : 0
    const screenChanged = this.screenChips && (wrapW !== this._wrapW || wrapH !== this._wrapH)
    if (screenChanged) {
      this._wrapW = wrapW; this._wrapH = wrapH
      this._screenUiDirty = true
      this._screenLayoutKey = ''
      for (const n of this.nodes.values()) {
        n._screenSlot = null
        if (!n.chatOpen) continue
        const chatH = Math.max(240, Math.min(368, wrapH - 12))
        n.chipH = chatH
        n.chip.style.height = chatH + 'px'
      }
    }
    const boot = this._bootResize
    this._bootResize = false
    // the RO's initial delivery at an unchanged size must NOT reheat the
    // just-settled sim (this refresh was part of the slow-arrival churn)
    if (w === this.W && h === this.H) {
      if (screenChanged) this._placeScreenChips([...this.nodes.values()])
      return
    }
    this.W = w; this.H = h
    for (const n of this.nodes.values()) {
      n.x = Math.max(n.r + 34, Math.min(this.W - n.r - 34, n.x))
      n.y = Math.max(n.r + 64, Math.min(this.H - n.r - 58, n.y))
    }
    this._clampPan()
    this._applyZoom()
    this.refreshForces()
    // The tree's tier slots are computed from W/H, and at construction the
    // canvas is still detached (so W/H are the 800x600 fallbacks) — without
    // this the default Tree view laid itself out for a stale size and left
    // ~430px of the panel unused, and never re-fitted on a window resize.
    if (this._treeActive()) { this.simulation.stop(); this._layoutTree(!boot) }
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
    if (this.screenChips) this._placeScreenChips([...this.nodes.values()])
  }

  _syncFit() {
    if (!this.fitEl) return
    const active = Math.abs(this.zoom - 1) > 0.004 || Math.abs(this._zt - 1) > 0.004
      || !!this.panX || !!this.panY
    this.fitEl.classList.toggle('show', active)
    if (this.screenChips && active !== this._fitActive) {
      this._fitActive = active
      this._screenUiDirty = true
      this._screenLayoutKey = ''
    }
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

  /* ---------- layout mode + hierarchy edit mode ----------
     Two independent axes, deliberately separated:
       layout   'tree' = tidy tier rows, physics paused, nodes pinned;
                'force' = the liquid force-directed simulation.
       editMode adds drag-to-re-parent ON TOP of the tree layout.
     Tree is the default view: it reads as an org diagram rather than a
     mobile, which is what the layout is actually communicating. Edit mode
     still forces tree while it's active, and restores whatever layout the
     user had chosen when it exits. */

  /** True whenever nodes should be sitting in tier slots rather than physics. */
  _treeActive() { return this.layout === 'tree' || this.editMode }

  setLayout(mode, { animate = true } = {}) {
    const next = mode === 'tree' ? 'tree' : 'force'
    if (this.layout === next) return
    this.layout = next
    this.container.setAttribute('data-layout', next)
    if (this.editMode) return                    // edit pins tree regardless
    this._applyLayout(animate)
  }

  _applyLayout(animate = true) {
    if (this._treeActive()) {
      for (const n of this.nodes.values()) {
        if (n._flingRaf) { cancelAnimationFrame(n._flingRaf); n._flingRaf = null }
      }
      this.simulation.alphaTarget(0)
      this.simulation.stop()
      this._layoutTree(animate)
    } else {
      this._clearTierGuides()
      if (this._treeRaf) { cancelAnimationFrame(this._treeRaf); this._treeRaf = null }
      for (const n of this.nodes.values()) {
        n.fx = null; n.fy = null; n._editDragging = false
        n.el.classList.remove('drop-ok', 'refuse')
      }
      this.simulation.alpha(0.85).restart()      // melt back into liquid
    }
  }

  setEditMode(on) {
    if (this.editMode === !!on) return
    this.editMode = !!on
    if (on) {
      this.container.setAttribute('data-edit-mode', 'true')
      if (this.screenChips) this.screenOverlay?.setAttribute('data-edit-mode', 'true')
      // graph.css hides every chip while editing (opacity 0 !important) —
      // mirror that in the tab order so focus cannot land on invisible boxes
      for (const n of this.nodes.values()) { if (n.chip) n.chip.tabIndex = -1 }
      if (this._zt !== 1 || this.panX || this.panY) this.resetZoom()
      this._applyLayout(true)                    // _treeActive() is now true
    } else {
      this.container.removeAttribute('data-edit-mode')
      if (this.screenChips) this.screenOverlay?.removeAttribute('data-edit-mode')
      for (const n of this.nodes.values()) {
        n._editDragging = false
        n.el.classList.remove('drop-ok', 'refuse')
        // restore per the same visibility rule updateDensity() enforces
        if (n.chip) n.chip.tabIndex = this.screenChips
          ? (n._screenPlaced ? 0 : -1)
          : ((this.nodes.size >= DENSE_AT && !n.chatOpen) ? -1 : 0)
      }
      this._applyLayout(true)                    // back to the chosen layout
    }
    if (this.screenChips) {
      this._screenLayoutKey = ''
      this._queueScreenGeometryRefresh()
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
    /* The vertical twin of the packing problem below: 104/92 were tuned for
       three tiers, and a fourth (a worker spawning under a default) collapsed
       the row pitch to 47px against 78px bubbles — two ROWS parked 31px into
       each other on a 768px screen. The pads now yield toward floors when the
       tiers need the room: 64 keeps the top tier clear of the crumb/toolbar
       row, 70 keeps the bottom tier's compact name label on the canvas. At
       the floors a 4-tier fleet on a 338px canvas still can't reach tangent
       pitch (68px vs 78) — that residue is focus-mode territory (the density
       hint), not deeper packing. */
    let padT = 104, padB = 92
    if (rows > 1) {
      const deficit = 86 * (rows - 1) - (this.H - padT - padB)
      if (deficit > 0) {
        const gT = Math.min(104 - 64, Math.round(deficit * 0.55))
        padT -= gT
        padB -= Math.min(92 - 70, deficit - gT)
      }
    }
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
      /* Packing a tier is a capacity problem, and the old division-and-clamp
         pretended it wasn't: x = W/(n+1) spreads centres evenly with no idea
         how wide a bubble is, and the 44px edge clamp then shoved the outer
         bubbles INWARD, spending their neighbours' gaps. At eleven-plus
         default bubbles on a ~950px canvas that produced stable 20-36px
         bubble-on-bubble interpenetration — not a transient, two circles
         parked inside each other on the graph's default view.
         Now: keep the airy division layout whenever it genuinely fits, and
         otherwise pack the tier evenly at the widest spacing that does, with
         the degradation explicit and ordered — give up edge margin first
         (44 -> 12), then the breathing gap, and only then admit up to 6px of
         near-tangent overlap, which is the physical floor short of shrinking
         bubbles whose runtime text already fills them. Beyond that the
         designed answer is focus mode, not deeper packing. */
      const step = this.W / (list.length + 1)
      const naive = list.map((n, i) =>
        Math.max(n.r + 44, Math.min(this.W - n.r - 44, step * (i + 1))))
      const naiveOk = naive.every((x, i) =>
        i === 0 || x - naive[i - 1] >= list[i - 1].r + list[i].r + 2)
      let xs = naive
      if (!naiveOk && list.length > 1) {
        for (const [edge, air] of [[44, 10], [12, 10], [12, 0], [12, -6]]) {
          const gaps = list.map((n, i) => i ? list[i - 1].r + n.r + air : 0)
          const span = gaps.reduce((a, b) => a + b, 0)
          const avail = this.W - 2 * edge - list[0].r - list[list.length - 1].r
          if (span <= avail || air === -6) {
            // last resort compresses proportionally — a fleet that outgrows
            // even the overlap floor still never stacks bubbles concentric
            const k = span > avail ? avail / span : 1
            let x = edge + list[0].r + Math.max(0, (avail - span) / 2)
            xs = list.map((n, i) => (x += gaps[i] * k))
            break
          }
        }
      }
      list.forEach((n, i) => slots.set(n.id, { x: xs[i], y }))
    })
    return { slots, rowYs }
  }

  _layoutTree(animate = true) {
    const { slots, rowYs } = this._treeSlots()
    if (this._treeRaf) cancelAnimationFrame(this._treeRaf)
    const starts = new Map()
    for (const n of this.nodes.values()) starts.set(n.id, { x: n.x, y: n.y })
    const t0 = performance.now()
    const D = (animate && !prefersCalm()) ? STRUCTURAL_MS : 0
    // The guides used to fade in on a hardcoded 0.15s delay — i.e. WHILE the
    // bubbles were still flying to the rows the guides were claiming. Keyed
    // to this run's real duration they arrive as a consequence of the layout
    // settling, which is what a tier guide actually means.
    this._renderTierGuides(rowYs, D ? D + TIER_GUIDE_BEAT_MS : 0)
    const step = (t) => {
      const u = D ? Math.min(1, (t - t0) / D) : 1
      // STRUCTURAL register (see EASE_STRUCTURAL): a tree relayout is the
      // heaviest move on this surface — every bubble at once — so it must not
      // share the snappy curve a hover uses.
      const k = EASE_STRUCTURAL(u)
      for (const n of this.nodes.values()) {
        const s = slots.get(n.id)
        if (!s || n._editDragging) continue        // hands off the grabbed bubble
        const st = starts.get(n.id) || s
        n.x = n.fx = st.x + (s.x - st.x) * k
        n.y = n.fy = st.y + (s.y - st.y) * k
      }
      // Land the chips ON the slot _placeChip elected, on the last frame.
      // In tree mode this tween is the ONLY thing calling tick() — the sim is
      // parked — so when the final frame runs, each chip is still easing
      // toward its slot at 0.35/frame and nothing ever moves it again: it
      // parks wherever the ease happened to stop, which is routinely straight
      // over its own node's name/role rows. Bare-text chip on bare-text label
      // is unreadable mush, and it is the graph's DEFAULT view.
      // Same snap idiom openChat/closeChat already use for an asleep sim.
      if (u >= 1) this._snapChips = true
      this.tick()
      if (u >= 1) this._snapChips = false
      if (u < 1 && this._treeActive()) this._treeRaf = requestAnimationFrame(step)
      else this._treeRaf = null
    }
    this._treeRaf = requestAnimationFrame(step)
  }

  /** @param afterMs delay before the hairlines draw in — the caller's live
      layout duration, so the guides state a row only once it exists. */
  _renderTierGuides(rowYs, afterMs = 0) {
    const prev = this._guides || []
    // A relayout that keeps the same number of tiers (the common case: a
    // re-parent inside an unchanged hierarchy depth) should MOVE its guides,
    // not blink them out and re-draw them. Blinking was tolerable at the old
    // fixed 0.15s delay; at a delay keyed to the 680ms layout it would leave
    // the rows unmarked for the whole move. .tier-guide transitions `top`.
    if (prev.length && prev.length === rowYs.length) {
      rowYs.forEach((y, i) => { prev[i].style.top = `${Math.round(y)}px` })
      return
    }
    this._clearTierGuides()
    this._guides = rowYs.map(y => {
      const g = document.createElement('div')
      g.className = 'tier-guide'
      g.style.top = `${Math.round(y)}px`
      g.style.animationDelay = `${Math.round(afterMs)}ms`
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
    // Cancelling the probe rAF stopped the WRITES but left the last values
    // standing, so #/metrics, #/comms and #/ — routes with no graph at all —
    // each reported the graph's final frame time as their own. Measured: a
    // frozen 7.21 read identically on three consecutive graph-less routes
    // whose real frame intervals were 15.24 / 7.01 / 6.91ms, and a frozen 5.55
    // against a measured 20.45ms on #/metrics — 3.7x optimistic. A route with
    // no graph must report NOTHING, not a stale flattering number.
    if (probeOwner === this) {
      probeOwner = null
      window.__graphFrameMs = window.__pageFrameMs =
        window.__graphTickMs = window.__graphNodeCount = undefined
    }
    if (this._zoomRaf) cancelAnimationFrame(this._zoomRaf)
    if (this._screenGeometryRaf) cancelAnimationFrame(this._screenGeometryRaf)
    clearTimeout(this._zoomHotTimer)
    for (const n of this.nodes.values()) {
      if (n._flingRaf) cancelAnimationFrame(n._flingRaf)
      clearTimeout(n._ringTimer); clearTimeout(n._settleTimer)
      n._screenRuntimeUnsub?.()
      n._screenRuntimeUnsub = null
    }
    this.unsubs.forEach(u => u())
    document.removeEventListener('keydown', this._onKeyDown)
    this.zoomHost.removeEventListener('wheel', this._onWheel)
    this.zoomHost.removeEventListener('pointerdown', this._onHostDown)
    this.zoomHost.removeEventListener('pointermove', this._onHostMove)
    this.zoomHost.removeEventListener('pointerup', this._onHostUp)
    this.zoomHost.removeEventListener('pointercancel', this._onHostUp)
    this.zoomHost.classList.remove('graph-zoom-host', 'screen-chips', 'panning', 'zoomed')
    this.fitEl?.remove()
    this.screenOverlay?.remove()
    this.container.style.transform = ''
    this.container.innerHTML = ''
    this.container.classList.remove('graph-canvas', 'zoomable')
  }
}
