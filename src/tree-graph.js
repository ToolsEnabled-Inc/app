import { sim, fmtRuntime } from './sim.js'
import { ROLES } from './vocab.js'
import { el, buildChat, bindRuntime, formatInlineText } from './components.js'
import { layoutTree, TREE_ROLE_RADII, treeNodeRadius } from './tree-layout.js'

const DENSE_AT = 12
const STRUCTURAL_MS = 680
const REMOVE_MS = 150
const SCREEN_CHIP_W = 322
const SCREEN_CHIP_H = 126
const SCREEN_CHAT_W = 360
const SCREEN_EDGE = 8
const SCREEN_TOP = 72
const SCREEN_CHIP_GAP = 5
const ROLE_PRIORITY = { coordinator: 6, helper: 5, shadow: 5, manager: 4, default: 2, spawned: 1 }
/* 2.4x, not 1.7x: the owner's ask was to zoom in far enough to READ a card, and
   1.7 stopped short of that on a 1440-wide window. */
const ZOOM_MIN = 0.5
const ZOOM_MAX = 2.4
// Content may be dragged until only this much of it is left on screen; it can
// never be pushed away entirely, and it is never locked in place either.
const PAN_KEEP = 160
// How far a context block may sit from its own circle before it stops reading
// as that circle's block. Measured against the card, not guessed: a 260px card
// one card-width away still scans as attached; two away does not.
const CHIP_REACH = 380
const HIERARCHY_TYPES = new Set(['manages', 'delegates_to', 'hierarchy'])

const calm = () => document.body.classList.contains('reduce-motion')
  || (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const escapeMarkup = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]))
const overlap = (a, b) => {
  const width = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const height = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return width > 0 && height > 0 ? width * height : 0
}
const center = (box) => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 })
/* Does the segment a→b pass through the disc at c? A leader that crosses a
   third circle on its way to its own card asserts a relationship that is not
   there, which is worse than no leader at all. */
const segmentHitsDisc = (ax, ay, bx, by, cx, cy, radius) => {
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared > 0
    ? Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / lengthSquared))
    : 0
  return Math.hypot(ax + dx * t - cx, ay + dy * t - cy) < radius
}
/* …and the same question for a label box. A leader ruled through another
   node's NAME misattributes just as badly as one ruled through its circle;
   testing only circles let the 1920 layout fill up with crossing leaders. */
const segmentHitsBox = (ax, ay, bx, by, box) => {
  const inside = (x, y) => x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h
  if (inside(ax, ay) || inside(bx, by)) return true
  const cross = (x1, y1, x2, y2, x3, y3, x4, y4) => {
    const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3)
    if (Math.abs(d) < 1e-9) return false
    const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d
    const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d
    return t >= 0 && t <= 1 && u >= 0 && u <= 1
  }
  const { x, y, w, h } = box
  return cross(ax, ay, bx, by, x, y, x + w, y)
    || cross(ax, ay, bx, by, x + w, y, x + w, y + h)
    || cross(ax, ay, bx, by, x + w, y + h, x, y + h)
    || cross(ax, ay, bx, by, x, y + h, x, y)
}

const cubicBezierEase = (x1, y1, x2, y2) => {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by
  const solveX = (t) => ((ax * t + bx) * t + cx) * t
  const slopeX = (t) => (3 * ax * t + 2 * bx) * t + cx
  return (amount) => {
    if (!(amount > 0)) return 0
    if (amount >= 1) return 1
    let t = amount
    for (let index = 0; index < 6; index += 1) {
      const error = solveX(t) - amount
      if (Math.abs(error) < 1e-5) break
      const slope = slopeX(t)
      if (Math.abs(slope) < 1e-6) break
      t -= error / slope
    }
    return ((ay * t + by) * t + cy) * t
  }
}
const structuralEase = cubicBezierEase(0.42, 0, 0.18, 1)

const monitorBrace = (right = false) => `
  <span class="monitor-brace${right ? ' is-right' : ''}" aria-hidden="true">
    <svg width="12" height="14" viewBox="0 0 12 14"><path d="M11.25 1.25 C7.2 1.25 4.25 2.3 4.25 6.3 L4.25 14" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <svg class="monitor-brace-arm" viewBox="0 0 12 8" preserveAspectRatio="none"><rect x="3.625" y="0" width="1.25" height="8" fill="currentColor"/></svg>
    <svg width="12" height="28" viewBox="0 0 12 28"><path d="M4.25 0 L4.25 8 C4.25 12.1 3 13.3 .75 14 C3 14.7 4.25 15.9 4.25 20 L4.25 28" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <svg class="monitor-brace-arm" viewBox="0 0 12 8" preserveAspectRatio="none"><rect x="3.625" y="0" width="1.25" height="8" fill="currentColor"/></svg>
    <svg width="12" height="14" viewBox="0 0 12 14"><path d="M4.25 0 L4.25 7.7 C4.25 11.7 7.2 12.75 11.25 12.75" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </span>`

let probeOwner = null
let chatZ = 20

export class StaticTreeGraph {
  constructor(container, {
    computer,
    rootId = null,
    onRootChange = null,
    onSelect = null,
    onOpenControls = null,
    screenChips = true,
    contextFeed = null,
    edges = null,
    onReparent = null,
    onOverridesChange = null,
  } = {}) {
    this.container = container
    this.computer = computer
    this.rootId = rootId
    this.onRootChange = onRootChange
    this.onSelect = onSelect
    this.onOpenControls = onOpenControls
    this.screenChips = screenChips === true
    this.contextFeed = typeof contextFeed === 'function' ? contextFeed : null
    this.declaredEdges = Array.isArray(edges) ? edges : null
    this.onReparent = typeof onReparent === 'function' ? onReparent : null
    this.onOverridesChange = typeof onOverridesChange === 'function' ? onOverridesChange : null
    this.nodes = new Map()
    this.selectedId = null
    this.layout = 'tree'
    this.editMode = false
    this.unsubs = []
    this._destroyed = false
    this._layoutVisibleIds = new Set()
    this._culled = new Set()
    this._layoutResult = null
    this._dropRec = null
    this._dropRaw = null
    this._animationRaf = 0
    this._addRafs = new Set()
    this._removeTimers = new Set()
    this._chatTimers = new Set()
    this._transitionRevision = 0

    container.classList.add('graph-canvas', 'static-tree-graph', 'zoomable')
    container.dataset.layout = 'tree'
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    this.svg.setAttribute('class', 'links static-tree-links')
    this.svg.setAttribute('aria-hidden', 'true')
    container.appendChild(this.svg)

    this.zoomHost = container.parentElement || container
    this.zoomHost.classList.add('graph-zoom-host', 'static-tree-host')
    this.zoom = 1
    this.panX = 0
    this.panY = 0
    this.W = container.clientWidth || 800
    this.H = container.clientHeight || 600

    if (this.screenChips) this._buildChipOverlay()
    this._buildFitControl()
    this._wireHostInteractions()
    this._onDocumentKeydown = (event) => this._escapeTopChat(event)
    document.addEventListener('keydown', this._onDocumentKeydown)

    this._positions = this._readPositions()
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(container)
    if (this.screenChips && this.zoomHost !== container) this.ro.observe(this.zoomHost)

    this._subscribe()
    this._reconcile({ initial: true })
    this._publishProbe()
  }

  _publishProbe() {
    probeOwner = this
    window.__graphFrameMs = 0
    window.__pageFrameMs = 0
    window.__graphTickMs = 0
    window.__graphNodeCount = this.nodes.size
    window.__graphStress = async () => ({ nodes: this.nodes.size, avgGraphMs: 0, static: true })
  }

  _positionKey() {
    return `mc.tree.pos.${this.computer?.id || 'unknown'}`
  }

  _readPositions() {
    try {
      const raw = localStorage.getItem(this._positionKey())
      if (!raw) return {}
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
      const clean = {}
      for (const [id, value] of Object.entries(parsed)) {
        const dx = Number(value?.dx)
        const dy = Number(value?.dy)
        if (Number.isFinite(dx) && Number.isFinite(dy)) clean[id] = { dx, dy }
      }
      return clean
    } catch {
      return {}
    }
  }

  _writePositions() {
    try {
      if (Object.keys(this._positions).length) {
        localStorage.setItem(this._positionKey(), JSON.stringify(this._positions))
      } else {
        localStorage.removeItem(this._positionKey())
      }
    } catch { /* device-local preference storage is best effort */ }
    this.onOverridesChange?.(this.hasPositionOverrides())
  }

  hasPositionOverrides() {
    return Object.keys(this._positions).length > 0
  }

  resetPositions() {
    this._positions = {}
    this._writePositions()
    this._layoutNow()
  }

  _clearPosition(id) {
    if (!Object.hasOwn(this._positions, id)) return
    delete this._positions[id]
    this._writePositions()
  }

  _subscribe() {
    this.unsubs.push(
      sim.on('spawn', ({ comp, agent }) => {
        if (comp !== this.computer || this._destroyed) return
        this.addAgent(agent)
      }),
      sim.on('reap', ({ comp, agent }) => {
        if (comp !== this.computer || this._destroyed) return
        this.removeAgent(agent.id)
      }),
      sim.on('agent-state', ({ comp, agent }) => {
        if (comp !== this.computer || this._destroyed) return
        const record = this.nodes.get(agent.id)
        if (record) record.el.classList.toggle('spawning', agent.state === 'spawning')
      }),
      sim.on('context', ({ comp, agent }) => {
        if (comp !== this.computer || this._destroyed) return
        const record = this.nodes.get(agent.id)
        if (record?.chip && !record.chatOpen) {
          this._renderChipPreview(record)
          this._placeChips()
        }
      }),
      sim.on('reparent', ({ comp, agent }) => {
        if (comp !== this.computer || this._destroyed) return
        const record = this.nodes.get(agent.id)
        if (record) record.el.dataset.parentId = agent.parentId || ''
        this._layoutNow()
      }),
    )
  }

  visibleAgents(rootId = this.rootId) {
    const agents = Array.isArray(this.computer?.agents) ? this.computer.agents : []
    if (!rootId) return [...agents]
    const keep = new Set([rootId])
    let changed = true
    while (changed) {
      changed = false
      for (const agent of agents) {
        if (agent.parentId && keep.has(agent.parentId) && !keep.has(agent.id)) {
          keep.add(agent.id)
          changed = true
        }
      }
    }
    return agents.filter(agent => keep.has(agent.id))
  }

  ancestryOf(id) {
    const byId = new Map((this.computer?.agents || []).map(agent => [agent.id, agent]))
    const chain = []
    let current = byId.get(id)
    const seen = new Set()
    while (current && !seen.has(current.id) && chain.length < 20) {
      seen.add(current.id)
      chain.unshift({ id: current.id, name: current.name })
      current = current.parentId ? byId.get(current.parentId) : null
    }
    return chain
  }

  renderAncestry() {
    this.onRootChange?.(this.rootId, this.rootId ? this.ancestryOf(this.rootId) : [])
  }

  _agentFor(id) {
    return (this.computer?.agents || []).find(agent => agent.id === id) || null
  }

  _layoutAgents() {
    const agents = this.visibleAgents()
    if (!this.rootId) return agents
    return agents.map(agent => ({
      ...agent,
      parentId: agent.id === this.rootId ? null : agent.parentId,
      tierRank: undefined,
    }))
  }

  _reconcile({ initial = false, addIds = new Set() } = {}) {
    const visible = this.visibleAgents()
    const wanted = new Set(visible.map(agent => agent.id))
    for (const [id, record] of [...this.nodes]) {
      if (!wanted.has(id)) this._removeRecord(record, !initial)
    }
    for (const agent of visible) {
      const existing = this.nodes.get(agent.id)
      if (existing) {
        existing.agent = agent
        existing.el.dataset.parentId = agent.parentId || ''
        continue
      }
      this._createRecord(agent, !initial || addIds.has(agent.id))
    }
    this._layoutNow()
    this._publishNodeCount()
  }

  _publishNodeCount() {
    if (probeOwner === this) window.__graphNodeCount = this.nodes.size
  }

  _createRecord(agent, fadeIn) {
    const role = ROLES[agent.role] || ROLES.default
    const radius = treeNodeRadius(agent)
    const node = el(`
      <div class="node static-tree-node role-${escapeMarkup(agent.role)}${agent.state === 'spawning' ? ' spawning' : ''}${fadeIn ? ' tree-node-adding' : ''}" style="--d:${radius * 2}px">
        <div class="node-glass">
          <div class="node-runtime">
            <div class="rt">0:00:00</div>
            <div class="rl">Runtime</div>
          </div>
        </div>
        <div class="node-labels">
          <span class="node-name" title="${escapeMarkup(agent.name)}"><i></i><span class="nn-t">${escapeMarkup(agent.name)}</span></span>
          <span class="node-role">${escapeMarkup(role.label)}</span>
        </div>
      </div>
    `)
    node.dataset.agentId = agent.id
    node.dataset.parentId = agent.parentId || ''
    node.tabIndex = 0
    node.setAttribute('role', 'button')
    node.setAttribute('aria-label', `${agent.name} — ${role.label}; Shift+Enter opens controls`)
    this.container.appendChild(node)

    const record = {
      id: agent.id,
      agent,
      el: node,
      r: radius,
      x: this.W / 2,
      y: this.H / 2,
      slot: { x: this.W / 2, y: this.H / 2 },
      chip: null,
      chipLeader: null,
      chatOpen: false,
      runtimeUnsub: null,
      chipRuntimeUnsub: null,
      clickTimer: 0,
    }
    this.nodes.set(agent.id, record)

    const runtime = node.querySelector('.rt')
    if (Number.isFinite(agent.bornAt)) {
      if (Number.isFinite(agent.stoppedAt)) {
        runtime.textContent = fmtRuntime(agent.bornAt, agent.stoppedAt)
        node.dataset.runtimeState = 'stopped'
      } else {
        record.runtimeUnsub = bindRuntime(runtime, () => agent.bornAt)
        node.dataset.runtimeState = 'running'
      }
    } else {
      /* An empty circle reads as a broken one. The node still knows something
         true about itself — whether the fleet declares it enabled — so it says
         that instead of showing nothing, in the caps register, and the layout
         sizes it for a word rather than for a clock. */
      node.classList.add('no-telemetry')
      node.dataset.runtimeState = 'unavailable'
      const stateWord = agent.state === 'disabled' ? 'disabled'
        : agent.state === 'enabled' ? 'enabled'
          : 'no signal'
      const label = node.querySelector('.node-runtime')
      label.innerHTML = `<div class="rt-state">${escapeMarkup(stateWord)}</div><div class="rl">no runtime</div>`
      node.title = `Runtime unavailable · ${agent.projectionUnavailableReason || 'not provided'}`
    }

    this._wireNode(record)
    if (this.screenChips) this._makeChip(record)

    if (fadeIn) {
      const raf = requestAnimationFrame(() => {
        this._addRafs.delete(raf)
        if (!this._destroyed) node.classList.remove('tree-node-adding')
      })
      this._addRafs.add(raf)
    }
    return record
  }

  _removeRecord(record, animate = true) {
    this.nodes.delete(record.id)
    record.runtimeUnsub?.()
    record.chipRuntimeUnsub?.()
    clearTimeout(record.clickTimer)
    record.chip?.remove()
    record.chipLeader?.remove()
    record.chipLeaderDot?.remove()
    if (!animate || calm()) {
      record.el.remove()
      return
    }
    record.el.classList.add('tree-node-removing')
    const timer = setTimeout(() => {
      this._removeTimers.delete(timer)
      record.el.remove()
    }, REMOVE_MS + 24)
    this._removeTimers.add(timer)
  }

  _wireNode(record) {
    const node = record.el
    node.addEventListener('click', (event) => {
      if (this.editMode || record.dragMoved) {
        record.dragMoved = false
        return
      }
      clearTimeout(record.clickTimer)
      record.clickTimer = setTimeout(() => this.handleClick(record), 260)
      event.stopPropagation()
    })
    node.addEventListener('dblclick', (event) => {
      if (this.editMode) return
      event.preventDefault()
      event.stopPropagation()
      clearTimeout(record.clickTimer)
      this.onOpenControls?.(record.agent)
    })
    node.addEventListener('keydown', (event) => {
      if (this.editMode || event.repeat) return
      if (event.key === 'Enter' && event.shiftKey) {
        event.preventDefault()
        this.onOpenControls?.(record.agent)
        return
      }
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      this.handleClick(record)
    })

    let pointerId = null
    let start = null
    let offset = null
    node.addEventListener('pointerdown', (event) => {
      if (!this.editMode || event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      pointerId = event.pointerId
      start = { x: event.clientX, y: event.clientY, recordX: record.x, recordY: record.y }
      const graphPoint = this._toGraph(event)
      offset = { x: record.x - graphPoint.x, y: record.y - graphPoint.y }
      record.dragMoved = false
      node.setPointerCapture(pointerId)
      node.classList.add('dragging')
    })
    node.addEventListener('pointermove', (event) => {
      if (pointerId !== event.pointerId || !start) return
      if (!record.dragMoved && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) {
        record.dragMoved = true
      }
      if (!record.dragMoved) return
      const point = this._toGraph(event)
      record.x = clamp(point.x + offset.x, record.r + 12, this.W - record.r - 12)
      record.y = clamp(point.y + offset.y, record.r + 64, this.H - record.r - 58)
      this._positionRecord(record)
      this._updateDropTarget(record)
      this._renderLinks()
    })
    const release = (event) => {
      if (pointerId !== event.pointerId || !start) return
      try { node.releasePointerCapture(pointerId) } catch { /* capture may already be gone */ }
      pointerId = null
      node.classList.remove('dragging')
      if (record.dragMoved) this._finishEditDrag(record, start)
      start = null
      offset = null
    }
    node.addEventListener('pointerup', release)
    node.addEventListener('pointercancel', release)
  }

  _wouldCycle(child, parent) {
    const byId = new Map((this.computer?.agents || []).map(agent => [agent.id, agent]))
    let current = parent
    const seen = new Set()
    while (current && !seen.has(current.id)) {
      if (current.id === child.id) return true
      seen.add(current.id)
      current = current.parentId ? byId.get(current.parentId) : null
    }
    return false
  }

  _updateDropTarget(record) {
    let raw = null
    for (const candidate of this.nodes.values()) {
      if (candidate === record || this._culled.has(candidate.id)) continue
      if (Math.hypot(candidate.x - record.x, candidate.y - record.y) < candidate.r + record.r * 0.55) {
        raw = candidate
        break
      }
    }
    const valid = raw
      && record.agent.role !== 'coordinator'
      && raw.id !== record.agent.parentId
      && !this._wouldCycle(record.agent, raw.agent)
      ? raw
      : null
    if (this._dropRec && this._dropRec !== valid) this._dropRec.el.classList.remove('drop-ok')
    if (valid && this._dropRec !== valid) valid.el.classList.add('drop-ok')
    this._dropRec = valid
    this._dropRaw = raw
  }

  _finishEditDrag(record, start) {
    const target = this._dropRec
    const raw = this._dropRaw
    if (target) target.el.classList.remove('drop-ok')
    this._dropRec = null
    this._dropRaw = null

    if (target) {
      const changed = this.onReparent
        ? this.onReparent(record.id, target.id)
        : sim.reparentAgent(this.computer, record.id, target.id)
      if (changed) {
        this._clearPosition(record.id)
        record.el.dataset.parentId = target.id
        if (this.onReparent) this._layoutNow()
        return
      }
    }

    if (raw) {
      record.el.classList.add('refuse')
      const timer = setTimeout(() => {
        this._chatTimers.delete(timer)
        record.el.classList.remove('refuse')
      }, 260)
      this._chatTimers.add(timer)
      record.x = start.recordX
      record.y = start.recordY
      this._positionRecord(record)
      this._renderLinks()
      return
    }

    this._positions[record.id] = {
      dx: Math.round((record.x - record.slot.x) * 100) / 100,
      dy: Math.round((record.y - record.slot.y) * 100) / 100,
    }
    this._writePositions()
    this._renderLinks()
  }

  _layoutNow({ preserve = new Set() } = {}) {
    if (this._destroyed) return
    const agents = this._layoutAgents()
    const result = layoutTree({
      nodes: agents,
      edges: this.declaredEdges || [],
      W: this.W,
      H: this.H,
    })
    this._layoutResult = result
    this._culled = result.culled
    this._layoutVisibleIds = new Set(agents.map(agent => agent.id))

    for (const record of this.nodes.values()) {
      const slot = result.slots.get(record.id)
      const hidden = !slot || result.culled.has(record.id)
      record.el.hidden = hidden
      record.chip?.classList.toggle('screen-chip-visible', !hidden && !this.editMode)
      record.chipLeader?.classList.toggle('visible', !hidden && !this.editMode)
      record.chipLeaderDot?.classList.toggle('visible', !hidden && !this.editMode)
      if (hidden || preserve.has(record.id)) continue
      record.slot = slot
      const offset = this._positions[record.id] || { dx: 0, dy: 0 }
      record.x = clamp(slot.x + offset.dx, record.r + 12, this.W - record.r - 12)
      record.y = clamp(slot.y + offset.dy, record.r + 64, this.H - record.r - 58)
      const label = result.labels.get(record.id)
      const text = record.el.querySelector('.nn-t')
      if (text && label) text.textContent = label.text
      if (label?.title) record.el.querySelector('.node-name')?.setAttribute('title', label.title)
      if (label?.maxWidth) record.el.style.setProperty('--nn-max', `${label.maxWidth}px`)
      else record.el.style.removeProperty('--nn-max')
      this._positionRecord(record)
    }
    this._renderLinks()
    this.updateDensity()
    this._placeChips()
    this._publishNodeCount()
  }

  _positionRecord(record) {
    record.el.style.left = `${record.x}px`
    record.el.style.top = `${record.y}px`
  }

  /* Orthogonal parent->child routing. A starburst of straight centre-to-centre
     lines crosses every card on the canvas and reads as an explosion rather
     than a hierarchy -- the owner's "the lines themselves are just absolutely
     nonsense". Siblings dropping to the same row now share one horizontal bus,
     so a tier reads as one bracket. The segments are axis-aligned, which is
     also what lets the context blocks avoid them EXACTLY (see _placeChips)
     instead of approximately. */
  _elbowRoute(from, to, busY) {
    const startX = from.x
    const startY = from.y + from.r
    const endX = to.x
    const endY = to.y - to.r
    const straight = {
      d: `M ${startX} ${startY} L ${endX} ${endY}`,
      segments: [{ x1: startX, y1: startY, x2: endX, y2: endY }],
    }
    if (!(busY > startY + 2) || !(busY < endY - 2)) return straight
    if (Math.abs(startX - endX) < 1.5) return straight
    const dx = endX - startX
    const sign = dx > 0 ? 1 : -1
    const radius = Math.max(0, Math.min(9, Math.abs(dx) / 2, (busY - startY) / 2, (endY - busY) / 2))
    const d = [
      `M ${startX} ${startY}`,
      `L ${startX} ${busY - radius}`,
      `Q ${startX} ${busY} ${startX + sign * radius} ${busY}`,
      `L ${endX - sign * radius} ${busY}`,
      `Q ${endX} ${busY} ${endX} ${busY + radius}`,
      `L ${endX} ${endY}`,
    ].join(' ')
    return {
      d,
      segments: [
        { x1: startX, y1: startY, x2: startX, y2: busY },
        { x1: startX, y1: busY, x2: endX, y2: busY },
        { x1: endX, y1: busY, x2: endX, y2: endY },
      ],
    }
  }

  _renderLinks() {
    const links = []
    const pairs = new Set()
    const pairKey = (left, right) => `${left}>${right}`
    const paintable = (record) => !!record && !this._culled.has(record.id)
      && this._layoutVisibleIds.has(record.id)
    for (const record of this.nodes.values()) {
      const parent = record.agent.parentId ? this.nodes.get(record.agent.parentId) : null
      if (!paintable(record) || !paintable(parent)) continue
      pairs.add(pairKey(parent.id, record.id))
      pairs.add(pairKey(record.id, parent.id))
      links.push({ from: parent, to: record, soft: false, type: 'hierarchy' })
    }
    for (const edge of this.declaredEdges || []) {
      const fromId = String(edge.from ?? edge.source ?? '')
      const toId = String(edge.to ?? edge.target ?? '')
      /* A declared "escalates_to" is the same relationship the "manages" edge
         already draws, pointing the other way. Drawing both doubled every line
         on the canvas and added no fact: one relationship, one line. */
      if (pairs.has(pairKey(fromId, toId))) continue
      const from = this.nodes.get(fromId)
      const to = this.nodes.get(toId)
      if (!paintable(from) || !paintable(to)) continue
      pairs.add(pairKey(fromId, toId))
      pairs.add(pairKey(toId, fromId))
      links.push({ from, to, soft: true, type: edge.type || 'declared' })
    }

    const buses = new Map()
    for (const link of links) {
      if (link.soft) continue
      const key = `${link.from.id}@${Math.round(link.to.y)}`
      const top = link.from.y + link.from.r
      const bottom = link.to.y - link.to.r
      buses.set(key, Math.min(buses.get(key) ?? Infinity, top + (bottom - top) * 0.55))
      link.busKey = key
    }

    this.svg.innerHTML = ''
    const segments = []
    for (const link of links) {
      const element = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      element.setAttribute('class', `tree-link link-top${link.soft ? ' link-soft' : ''}`)
      const route = link.soft
        ? {
            d: `M ${link.from.x} ${link.from.y} L ${link.to.x} ${link.to.y}`,
            segments: [{ x1: link.from.x, y1: link.from.y, x2: link.to.x, y2: link.to.y }],
          }
        : this._elbowRoute(link.from, link.to, buses.get(link.busKey))
      element.setAttribute('d', route.d)
      element.setAttribute('data-from', link.from.id)
      element.setAttribute('data-to', link.to.id)
      element.setAttribute('data-edge-type', link.type)
      element.setAttribute('vector-effect', 'non-scaling-stroke')
      this.svg.appendChild(element)
      // Only the orthogonal hierarchy segments become placement obstacles: a
      // diagonal whisper's bounding box would reserve a quarter of the canvas.
      if (!link.soft) segments.push(...route.segments)
    }
    this._linkSegments = segments
  }

  updateDensity() {
    const active = [...this.nodes.values()].filter(record =>
      this._layoutVisibleIds.has(record.id) && !this._culled.has(record.id))
    const densityRequiresDrill = !!this._layoutResult?.drillRequired || active.length >= DENSE_AT
    const byParent = new Map()
    for (const record of active) {
      if (!record.agent.parentId) continue
      if (!byParent.has(record.agent.parentId)) byParent.set(record.agent.parentId, [])
      byParent.get(record.agent.parentId).push(record)
    }
    const depth = (record) => {
      let value = 0
      let current = record
      const seen = new Set()
      while (current?.agent.parentId && !seen.has(current.id)) {
        seen.add(current.id)
        current = this.nodes.get(current.agent.parentId)
        value += 1
      }
      return value
    }
    const candidates = active.filter(record => byParent.has(record.id) && record.id !== this.rootId)
    const deepest = candidates.length ? Math.max(...candidates.map(depth)) : -1
    for (const record of this.nodes.values()) {
      const focusable = densityRequiresDrill && candidates.includes(record) && depth(record) === deepest
      record.el.classList.toggle('focusable', focusable)
    }
    this.onDensity?.(densityRequiresDrill)
  }

  handleClick(record) {
    if (record.el.classList.contains('focusable')) {
      this.setRoot(record.id)
      return
    }
    this.select(record.id)
  }

  select(id) {
    this.selectedId = id
    for (const record of this.nodes.values()) record.el.classList.toggle('selected', record.id === id)
    const record = this.nodes.get(id)
    if (record) this.onSelect?.(record.agent)
  }

  setRoot(id) {
    if (!this._agentFor(id) || id === this.rootId) return
    this._transitionRoot(id)
  }

  clearRoot() {
    if (!this.rootId) return
    this._transitionRoot(null)
  }

  _transitionRoot(nextRoot) {
    const transitionRevision = ++this._transitionRevision
    const oldRoot = this.rootId
    const focusId = nextRoot || oldRoot
    const focusRecord = this.nodes.get(focusId)
    const from = focusRecord ? { x: focusRecord.x, y: focusRecord.y } : null
    const wasPainted = new Set([...this.nodes.values()]
      .filter(record => !record.el.hidden && !this._culled.has(record.id))
      .map(record => record.id))
    for (const record of this.nodes.values()) record.el.classList.remove('tree-node-removing')
    this.rootId = nextRoot

    const visible = this.visibleAgents()
    const wanted = new Set(visible.map(agent => agent.id))
    for (const agent of visible) if (!this.nodes.has(agent.id)) this._createRecord(agent, true)

    const outgoing = []
    for (const [id, record] of this.nodes) {
      if (!wanted.has(id)) outgoing.push(record)
    }

    // Focus record is left at its old position while every other retained
    // node snaps invisibly to the new deterministic slots.
    this._layoutNow({ preserve: focusRecord ? new Set([focusId]) : new Set() })
    const targetSlot = focusRecord ? this._layoutResult?.slots.get(focusId) : null
    const targetOffset = focusId ? this._positions[focusId] || { dx: 0, dy: 0 } : { dx: 0, dy: 0 }
    const target = focusRecord && targetSlot
      ? {
          x: clamp(targetSlot.x + targetOffset.dx, focusRecord.r + 12, this.W - focusRecord.r - 12),
          y: clamp(targetSlot.y + targetOffset.dy, focusRecord.r + 64, this.H - focusRecord.r - 58),
        }
      : null

    for (const record of this.nodes.values()) {
      if (record === focusRecord || !wanted.has(record.id)) continue
      record.el.classList.add('tree-branch-entering')
      const raf = requestAnimationFrame(() => {
        this._addRafs.delete(raf)
        record.el.classList.remove('tree-branch-entering')
      })
      this._addRafs.add(raf)
    }
    for (const record of outgoing) {
      if (!wasPainted.has(record.id)) {
        this._removeRecord(record, false)
        continue
      }
      // _layoutNow hides records outside the new subtree. Keep outgoing
      // records paintable for the one permitted removal fade.
      record.el.hidden = false
      record.el.classList.add('tree-node-removing')
      record.chip?.classList.remove('screen-chip-visible')
      record.chipLeader?.classList.remove('visible')
      record.chipLeaderDot?.classList.remove('visible')
      const timer = setTimeout(() => {
        this._removeTimers.delete(timer)
        if (!this._destroyed && transitionRevision === this._transitionRevision
          && !wanted.has(record.id)) this._removeRecord(record, false)
      }, REMOVE_MS + 24)
      this._removeTimers.add(timer)
    }

    if (focusRecord && from && target) {
      focusRecord.slot = targetSlot
      this._animateRecord(focusRecord, from, target)
    }
    this.onRootChange?.(nextRoot, nextRoot ? this.ancestryOf(nextRoot) : [])
    this._layoutVisibleIds = wanted
    this._renderLinks()
    this.updateDensity()
    this._placeChips()
  }

  /* The 680ms re-root glide re-ran the chip beam-search on EVERY frame — the
     most expensive routine on the page, sixty times a second, to decorate a
     click. The owner asked for no required motion and for function over
     decoration; the re-root now lands immediately. */
  _animateRecord(record, from, target) {
    if (this._animationRaf) cancelAnimationFrame(this._animationRaf)
    this._animationRaf = 0
    record.x = target.x
    record.y = target.y
    this._positionRecord(record)
    record.el.classList.remove('rerooting')
    this._renderLinks()
    this._placeChips()
  }

  setLayout() {
    this.layout = 'tree'
    this.container.dataset.layout = 'tree'
  }

  setEditMode(on) {
    const next = !!on
    if (next === this.editMode) return
    this.editMode = next
    if (next) {
      this.container.dataset.editMode = 'true'
      this.screenOverlay?.setAttribute('data-edit-mode', 'true')
      this.resetZoom()
    } else {
      this.container.removeAttribute('data-edit-mode')
      this.screenOverlay?.removeAttribute('data-edit-mode')
      this._dropRec?.el.classList.remove('drop-ok')
      this._dropRec = null
      this._dropRaw = null
      this._layoutNow()
    }
    for (const record of this.nodes.values()) {
      if (record.chip) {
        const visible = !next && !this._culled.has(record.id)
        record.chip.classList.toggle('screen-chip-visible', visible)
        record.chipLeader?.classList.toggle('visible', visible)
        record.chipLeaderDot?.classList.toggle('visible', visible)
        record.chip.tabIndex = visible ? 0 : -1
      }
    }
    this._renderLinks()
    this._placeChips()
  }

  addAgent(agent) {
    if (this.rootId && !this.visibleAgents().some(candidate => candidate.id === agent.id)) return
    this._createRecord(agent, true)
    this._layoutNow()
  }

  removeAgent(id) {
    const record = this.nodes.get(id)
    if (!record) return
    this._removeRecord(record, true)
    this._layoutNow()
  }

  _buildChipOverlay() {
    this.screenOverlay = document.createElement('div')
    this.screenOverlay.className = 'static-tree-chip-overlay'
    this.screenOverlay.setAttribute('aria-label', 'Fleet monitoring context')
    this.screenLeaderSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    this.screenLeaderSvg.setAttribute('class', 'graph-chip-leaders')
    this.screenLeaderSvg.setAttribute('aria-hidden', 'true')
    this.screenOverlay.appendChild(this.screenLeaderSvg)
    this.zoomHost.appendChild(this.screenOverlay)
  }

  _makeChip(record) {
    const chip = el(`<div class="chip static-tree-chip role-${escapeMarkup(record.agent.role)}">
      ${monitorBrace()}<div class="chip-preview"></div>${monitorBrace(true)}
    </div>`)
    chip.dataset.agentId = record.id
    chip.style.width = `${SCREEN_CHIP_W}px`
    chip.setAttribute('role', 'button')
    chip.setAttribute('aria-label', `${record.agent.name} monitoring context; open chat`)
    chip.tabIndex = 0
    this.screenOverlay.appendChild(chip)
    record.chip = chip

    const leader = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    leader.setAttribute('class', `graph-chip-leader role-${escapeMarkup(record.agent.role)}`)
    leader.dataset.agentId = record.id
    leader.setAttribute('vector-effect', 'non-scaling-stroke')
    this.screenLeaderSvg.appendChild(leader)
    record.chipLeader = leader

    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    dot.setAttribute('class', `graph-chip-leader-dot role-${escapeMarkup(record.agent.role)}`)
    dot.setAttribute('r', '2.25')
    dot.dataset.agentId = record.id
    this.screenLeaderSvg.appendChild(dot)
    record.chipLeaderDot = dot

    this._renderChipPreview(record)
    chip.addEventListener('click', (event) => {
      event.stopPropagation()
      if (!record.chatOpen) this.openChat(record)
    })
    chip.addEventListener('keydown', (event) => {
      if (record.chatOpen || (event.key !== 'Enter' && event.key !== ' ')) return
      event.preventDefault()
      this.openChat(record)
    })
    chip.addEventListener('pointerdown', () => {
      if (record.chatOpen) chip.style.zIndex = String(++chatZ)
    })
  }

  _screenContext(record) {
    let supplied = null
    try { supplied = this.contextFeed?.(record.agent) }
    catch { supplied = null }
    const rows = Array.isArray(supplied)
      ? supplied
      : supplied?.activities || supplied?.context || record.agent.context || []
    const values = Array.isArray(rows) ? rows : [rows]
    const clean = (value) => value == null ? '' : String(value).replace(/\s+/g, ' ').trim()
    return {
      current: clean(supplied?.current ?? values.at(-1)),
      previous: clean(supplied?.previous ?? values.at(-2)),
      chat: clean(supplied?.chat?.text ?? supplied?.recentChat?.text ?? supplied?.chat ?? supplied?.recentChat),
      unavailable: clean(supplied?.unavailable),
      tasks: Number(supplied?.tasks ?? record.agent.tasksDone),
      failRate: Number(supplied?.failRate ?? record.agent.failRate),
      model: clean(supplied?.model ?? record.agent.model),
    }
  }

  _renderChipPreview(record) {
    const preview = record.chip?.querySelector('.chip-preview')
    if (!preview) return
    record.chipRuntimeUnsub?.()
    record.chipRuntimeUnsub = null
    const feed = this._screenContext(record)
    const roleKey = record.agent.role
    const formattedName = formatInlineText(record.agent.name, {
      agents: this.computer.agents,
      roleKey,
    })
    const tasks = Number.isFinite(feed.tasks) ? `${Math.max(0, Math.round(feed.tasks))} tasks` : ''
    const failure = Number.isFinite(feed.failRate) ? `${Math.max(0, feed.failRate)}% fail` : ''
    const facts = [tasks, failure, feed.model].filter(Boolean).join(' · ')
    preview.innerHTML = `
      <div class="cl cl-name"><b>${formattedName}</b><span class="chip-runtime"></span></div>
      ${facts ? `<div class="cl cl-facts">${escapeMarkup(facts)}</div>` : '<div class="cl cl-facts">telemetry unavailable · fleet projection</div>'}
      ${feed.current ? `<div class="cl cl-current">${escapeMarkup(feed.current)}</div>` : ''}
      ${feed.previous ? `<div class="cl cl-previous">${escapeMarkup(feed.previous)}</div>` : ''}
      ${feed.chat ? `<div class="cl cl-chat">› ${escapeMarkup(feed.chat)}</div>` : ''}
      ${!feed.chat && !feed.previous && feed.unavailable ? `<div class="cl cl-unavailable">${escapeMarkup(feed.unavailable)}</div>` : ''}
    `
    const runtime = preview.querySelector('.chip-runtime')
    if (Number.isFinite(record.agent.bornAt)) {
      if (Number.isFinite(record.agent.stoppedAt)) {
        runtime.textContent = fmtRuntime(record.agent.bornAt, record.agent.stoppedAt)
      } else {
        record.chipRuntimeUnsub = bindRuntime(runtime, () => record.agent.bornAt)
      }
    } else runtime.hidden = true
  }

  openChat(record) {
    if (!record.chip || record.chatOpen) return
    const chip = record.chip
    const fromWidth = chip.offsetWidth || SCREEN_CHIP_W
    const fromHeight = chip.offsetHeight || SCREEN_CHIP_H
    chip.style.width = `${fromWidth}px`
    chip.style.height = `${fromHeight}px`
    void chip.offsetWidth
    record.chatOpen = true
    chip.classList.add('as-chat')
    chip.removeAttribute('role')
    chip.style.zIndex = String(++chatZ)
    const chatHeight = Math.max(250, Math.min(368, (this.zoomHost.clientHeight || this.H) - 24))
    const chat = buildChat({
      title: record.agent.name,
      subtitle: `${ROLES[record.agent.role]?.label || 'Agent'} · context`,
      roleKey: record.agent.role,
      context: () => record.agent.context,
      onClose: () => this.closeChat(record),
    })
    chip.appendChild(chat)
    chip.style.width = `${Math.min(SCREEN_CHAT_W, (this.zoomHost.clientWidth || this.W) - 16)}px`
    chip.style.height = `${chatHeight}px`
    this._placeChips()
  }

  closeChat(record) {
    if (!record.chip || !record.chatOpen) return
    const chip = record.chip
    record.chatOpen = false
    chip.classList.remove('as-chat')
    chip.setAttribute('role', 'button')
    chip.style.zIndex = ''
    chip.style.width = `${SCREEN_CHIP_W}px`
    chip.style.height = `${SCREEN_CHIP_H}px`
    const timer = setTimeout(() => {
      this._chatTimers.delete(timer)
      chip.querySelector('.chat')?.remove()
      chip.style.height = ''
      this._renderChipPreview(record)
      this._placeChips()
    }, calm() ? 0 : 500)
    this._chatTimers.add(timer)
    this._placeChips()
  }

  _escapeTopChat(event) {
    if (event.key !== 'Escape' || this._destroyed || document.querySelector('.drawer.open')) return
    let top = null
    let topZ = -1
    for (const record of this.nodes.values()) {
      if (!record.chatOpen || !record.chip) continue
      const z = Number(record.chip.style.zIndex) || 0
      if (z > topZ) { top = record; topZ = z }
    }
    if (!top) return
    this.closeChat(top)
    top.chip.focus()
  }

  _placeChips() {
    if (!this.screenChips || !this.screenOverlay || this.editMode) return
    const hostWidth = this.zoomHost.clientWidth || this.W
    const hostHeight = this.zoomHost.clientHeight || this.H
    const visibleRecords = [...this.nodes.values()].filter(record =>
      record.chip && !this._culled.has(record.id) && this._layoutVisibleIds.has(record.id))
    const records = [...visibleRecords].sort((left, right) =>
      Number(right.chatOpen) - Number(left.chatOpen)
      || (ROLE_PRIORITY[right.agent.role] || 0) - (ROLE_PRIORITY[left.agent.role] || 0)
      || left.id.localeCompare(right.id))

    for (const record of this.nodes.values()) {
      const visible = visibleRecords.includes(record)
      record.chip?.classList.toggle('screen-chip-visible', visible)
      record.chipLeader?.classList.toggle('visible', visible)
      record.chipLeaderDot?.classList.toggle('visible', visible)
    }

    const hostRect = this.zoomHost.getBoundingClientRect()
    const originX = hostRect.left + this.zoomHost.clientLeft
    const originY = hostRect.top + this.zoomHost.clientTop
    const expand = (box, pad, weight = 1) => ({
      x: box.x - pad,
      y: box.y - pad,
      w: box.w + pad * 2,
      h: box.h + pad * 2,
      weight,
    })
    const obstacles = []
    for (const record of visibleRecords) {
      const x = this.panX + record.x * this.zoom
      const y = this.panY + record.y * this.zoom
      const radius = record.r * this.zoom
      obstacles.push(expand({ x: x - radius, y: y - radius, w: radius * 2, h: radius * 2 }, 5, 5))
      for (const label of record.el.querySelectorAll('.node-name, .node-role')) {
        const rect = label.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) {
          obstacles.push(expand({
            x: rect.left - originX,
            y: rect.top - originY,
            w: rect.width,
            h: rect.height,
          }, 4, 6))
        }
      }
    }
    /* The connector lanes are obstacles too. Without this the placer happily
       parked a card on top of the fan of edges and the lines ran straight
       through the text — the single ugliest thing on the page. */
    for (const segment of this._linkSegments || []) {
      const x1 = this.panX + segment.x1 * this.zoom
      const y1 = this.panY + segment.y1 * this.zoom
      const x2 = this.panX + segment.x2 * this.zoom
      const y2 = this.panY + segment.y2 * this.zoom
      obstacles.push({
        ...expand({
          x: Math.min(x1, x2),
          y: Math.min(y1, y2),
          w: Math.abs(x2 - x1),
          h: Math.abs(y2 - y1),
        }, 5, 1),
        soft: true,
      })
    }
    for (const selector of ['.graph-title', '.graph-crumb', '.graph-hint.show', '.graph-tools', '.graph-edit-note']) {
      const element = this.zoomHost.querySelector(selector)
      if (!element || element.hidden || getComputedStyle(element).visibility === 'hidden') continue
      const rect = element.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) continue
      obstacles.push(expand({
        x: rect.left - originX,
        y: rect.top - originY,
        w: rect.width,
        h: rect.height,
      }, 6, 9))
    }

    const dimensions = new Map(records.map(record => {
      const width = Math.min(record.chatOpen ? SCREEN_CHAT_W : SCREEN_CHIP_W, hostWidth - SCREEN_EDGE * 2)
      const height = Math.min(
        record.chip.offsetHeight || (record.chatOpen ? 368 : SCREEN_CHIP_H),
        hostHeight - SCREEN_TOP - SCREEN_EDGE,
      )
      return [record.id, { width, height }]
    }))
    // Every visible circle in screen space — the leader must not cross any of
    // them except its own.
    const discs = visibleRecords.map(record => ({
      id: record.id,
      x: this.panX + record.x * this.zoom,
      y: this.panY + record.y * this.zoom,
      r: record.r * this.zoom + 4,
    }))
    const labelBoxes = []
    for (const record of visibleRecords) {
      const stack = record.el.querySelector('.node-labels')
      if (!stack) continue
      const rect = stack.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) continue
      labelBoxes.push({
        id: record.id,
        x: rect.left - originX,
        y: rect.top - originY,
        w: rect.width,
        h: rect.height,
      })
    }
    const slots = this._electChipSlots(records, dimensions, obstacles, hostWidth, hostHeight, discs, labelBoxes)

    for (const record of records) {
      const chip = record.chip
      const selected = slots.get(record.id)
      if (!selected) {
        chip.classList.remove('screen-chip-visible')
        record.chipLeader.classList.remove('visible')
        record.chipLeaderDot?.classList.remove('visible')
        continue
      }
      const { width } = dimensions.get(record.id)
      const x = this.panX + record.x * this.zoom
      const y = this.panY + record.y * this.zoom
      const radius = record.r * this.zoom
      chip.style.left = `${selected.x}px`
      chip.style.top = `${selected.y}px`
      if (!record.chatOpen) chip.style.width = `${width}px`

      /* Attribution: a card floating near a circle is not attached to it, and
         with seventeen nodes the reader's guess is usually wrong. The leader
         lands on the card's NEAR EDGE (not an arbitrary clamped point) and
         wears the node's own role hue, so card and circle read as one object. */
      const c = center(selected)
      const angle = Math.atan2(c.y - y, c.x - x)
      const startX = x + Math.cos(angle) * radius
      const startY = y + Math.sin(angle) * radius
      const endX = c.x >= x
        ? selected.x
        : selected.x + selected.w
      const endY = clamp(startY, selected.y + 8, selected.y + selected.h - 8)
      record.chipLeader.setAttribute('x1', String(startX))
      record.chipLeader.setAttribute('y1', String(startY))
      record.chipLeader.setAttribute('x2', String(endX))
      record.chipLeader.setAttribute('y2', String(endY))
      record.chipLeaderDot?.setAttribute('cx', String(startX))
      record.chipLeaderDot?.setAttribute('cy', String(startY))
    }
  }

  /* ONE rule the reader can learn in a second: a node's context block sits
     immediately to its RIGHT, vertically centred on it; if the right is taken,
     immediately to its LEFT; otherwise the block is withheld. The previous
     free search found clever pockets — above-left here, above-right there —
     and the reader paid a beat of "whose card is this?" at every one of them.
     A few tolerated pixels of vertical give let a block clear a neighbour's
     label without leaving its own lane. */
  _chipCandidates(record, width, height, hostWidth, hostHeight) {
    const x = this.panX + record.x * this.zoom
    const y = this.panY + record.y * this.zoom
    const radius = record.r * this.zoom
    const maxX = Math.max(SCREEN_EDGE, hostWidth - width - SCREEN_EDGE)
    const maxY = Math.max(SCREEN_TOP, hostHeight - height - SCREEN_EDGE)
    const candidates = []
    const seen = new Set()
    const add = (left, top, rank) => {
      const cx = clamp(left, SCREEN_EDGE, maxX)
      const cy = clamp(top, SCREEN_TOP, maxY)
      const key = `${Math.round(cx)}:${Math.round(cy)}`
      if (seen.has(key)) return
      seen.add(key)
      const box = { x: cx, y: cy, w: width, h: height }
      const boxCenter = center(box)
      candidates.push({ ...box, rank, distance: Math.hypot(boxCenter.x - x, boxCenter.y - y) })
    }
    const gap = radius + 20
    /* rank 0 = the convention (right), rank 1 = the one sanctioned fallback.
       The block may slide vertically to clear a neighbour's label — it is still
       beside its node, which is the part the reader learns — but it never
       moves above or below into another rank's column. */
    const nudges = [0, -34, 34, -68, 68, -102, 102, -136, 136]
    for (const nudge of nudges) add(x + gap, y - height / 2 + nudge, 0)
    for (const nudge of nudges) add(x - gap - width, y - height / 2 + nudge, 1)
    return candidates
  }

  _chipCandidatesFree(record, width, height, hostWidth, hostHeight) {
    const x = this.panX + record.x * this.zoom
    const y = this.panY + record.y * this.zoom
    const radius = record.r * this.zoom
    const maxX = Math.max(SCREEN_EDGE, hostWidth - width - SCREEN_EDGE)
    const maxY = Math.max(SCREEN_TOP, hostHeight - height - SCREEN_EDGE)
    const candidates = []
    const seen = new Set()
    const add = (left, top) => {
      const cx = clamp(left, SCREEN_EDGE, maxX)
      const cy = clamp(top, SCREEN_TOP, maxY)
      const key = `${Math.round(cx)}:${Math.round(cy)}`
      if (seen.has(key)) return
      seen.add(key)
      const box = { x: cx, y: cy, w: width, h: height }
      const boxCenter = center(box)
      candidates.push({ ...box, distance: Math.hypot(boxCenter.x - x, boxCenter.y - y) })
    }
    const side = radius + 18
    add(x + side, y - height / 2)
    add(x - side - width, y - height / 2)
    add(x - width / 2, y + radius + 36)
    add(x - width / 2, y - radius - height - 16)
    add(x + radius * 0.62, y - radius - height - 10)
    add(x - radius * 0.62 - width, y - radius - height - 10)
    add(x + side, y + radius * 0.35)
    add(x - side - width, y + radius * 0.35)

    /* Finer candidate grid: the coarse one missed real pockets and the page lost
       four context blocks at 1440. The search is no longer per-frame, so it can
       afford to look properly. */
    const stepX = Math.max(34, Math.min(52, width * 0.18))
    const stepY = Math.max(26, Math.min(42, height * 0.3))
    let row = 0
    for (let top = SCREEN_TOP; top <= maxY + 0.5; top += stepY, row += 1) {
      const offset = row % 2 ? stepX / 2 : 0
      for (let left = SCREEN_EDGE + offset; left <= maxX + 0.5; left += stepX) add(left, top)
      add(maxX, top)
    }
    for (let left = SCREEN_EDGE; left <= maxX + 0.5; left += stepX) add(left, maxY)
    add(maxX, maxY)
    return candidates
  }

  _electChipSlots(records, dimensions, obstacles, hostWidth, hostHeight, discs = [], labelBoxes = []) {
    const BEAM = 32
    const BRANCHES = 14
    let states = [{ placed: [], slots: new Map(), score: 0 }]
    for (const record of records) {
      const { width, height } = dimensions.get(record.id)
      const nodeX = this.panX + record.x * this.zoom
      const nodeY = this.panY + record.y * this.zoom
      const base = this._chipCandidates(record, width, height, hostWidth, hostHeight)
        .map(candidate => {
          const c = center(candidate)
          const crossings = discs.reduce((count, disc) => count
            + (disc.id !== record.id && segmentHitsDisc(nodeX, nodeY, c.x, c.y, disc.x, disc.y, disc.r) ? 1 : 0), 0)
            + labelBoxes.reduce((count, box) => count
              + (box.id !== record.id && segmentHitsBox(nodeX, nodeY, c.x, c.y, box) ? 1 : 0), 0)
          return { ...candidate, leaderCrossings: crossings }
        })
        /* Two classes of obstacle, not one. A circle, a label or a piece of
           chrome underneath a card is a hard collision — the card is withheld
           rather than painted over it. A CONNECTOR underneath a card is not:
           the card paints on the panel's own ground, so the line simply passes
           behind it. Treating lanes as hard rejects starved the canvas down to
           two visible blocks; as a ranked preference it keeps the density and
           still lands cards in clear lanes wherever clear lanes exist. */
        .map(candidate => ({
          ...candidate,
          obstacleOverlap: obstacles.reduce((sum, obstacle) =>
            sum + (obstacle.soft ? 0 : overlap(candidate, obstacle) * obstacle.weight), 0),
          laneOverlap: obstacles.reduce((sum, obstacle) =>
            sum + (obstacle.soft ? overlap(candidate, obstacle) : 0), 0),
        }))
        // The convention outranks everything: a block only leaves the right
        // side when the right side genuinely cannot hold it.
        .sort((left, right) => left.rank - right.rank
          || left.obstacleOverlap - right.obstacleOverlap
          || left.leaderCrossings - right.leaderCrossings
          || left.laneOverlap - right.laneOverlap
          || left.distance - right.distance || left.y - right.y || left.x - right.x)
      const next = []
      for (const state of states) {
        let branches = 0
        for (const candidate of base) {
          if (candidate.obstacleOverlap > 0.01) continue
          // A card parked across the canvas from its node is not attribution,
          // it is a puzzle. Withhold it rather than run a long leader.
          if (candidate.distance > CHIP_REACH || candidate.leaderCrossings > 0) continue
          const padded = {
            x: candidate.x - SCREEN_CHIP_GAP / 2,
            y: candidate.y - SCREEN_CHIP_GAP / 2,
            w: candidate.w + SCREEN_CHIP_GAP,
            h: candidate.h + SCREEN_CHIP_GAP,
          }
          if (state.placed.some(other => overlap(padded, other) > 0.01)) continue
          const slots = new Map(state.slots)
          slots.set(record.id, candidate)
          next.push({
            placed: [...state.placed, padded],
            slots,
            score: state.score + candidate.distance,
          })
          branches += 1
          if (branches >= BRANCHES) break
        }
      }
      if (!next.length) {
        // A very small viewport may have no mathematically clear pocket. Keep
        // the topology readable: the lower-priority context block is withheld
        // rather than painted across a node or another block.
        continue
      }
      next.sort((left, right) => right.slots.size - left.slots.size || left.score - right.score)
      states = next.slice(0, BEAM)
    }
    return states[0]?.slots || new Map()
  }

  /* The old control appeared only once the view was already displaced, which
     is the moment it stops being a control and becomes an apology. The cluster
     is always present, states the factor, and its middle button is the way
     back to the overview. */
  _buildFitControl() {
    const cluster = el(`
      <div class="graph-zoomer" role="group" aria-label="Zoom">
        <button class="gz-out" type="button" title="Zoom out" aria-label="Zoom out">&#8722;</button>
        <button class="graph-fit static-tree-fit gz-level" type="button" title="Reset to overview" aria-label="Reset zoom to overview"><span class="gf-z">1.00&#215;</span></button>
        <button class="gz-in" type="button" title="Zoom in" aria-label="Zoom in">+</button>
      </div>`)
    cluster.querySelector('.gz-out').addEventListener('click', () => this.zoomBy(1 / 1.25))
    cluster.querySelector('.gz-in').addEventListener('click', () => this.zoomBy(1.25))
    cluster.querySelector('.graph-fit').addEventListener('click', () => this.resetZoom())
    /* In the tool row, not floating over the canvas: parked bottom-left it sat
       on the last tier's labels at 1440 and read as debris on the tree. */
    const tools = this.zoomHost.querySelector('.graph-tools')
    if (tools) tools.insertBefore(cluster, tools.firstChild)
    else this.zoomHost.appendChild(cluster)
    this.zoomerEl = cluster
    this.fitEl = cluster.querySelector('.graph-fit')
  }

  /* Zoom about a point. Without an anchor it holds the centre of the visible
     area, so the thing being read stays where it is being read. */
  zoomBy(factor, anchorX = null, anchorY = null) {
    const hostWidth = this.zoomHost.clientWidth || this.W
    const hostHeight = this.zoomHost.clientHeight || this.H
    const screenX = anchorX == null ? hostWidth / 2 : anchorX
    const screenY = anchorY == null ? hostHeight / 2 : anchorY
    const graphX = (screenX - this.panX) / this.zoom
    const graphY = (screenY - this.panY) / this.zoom
    this.zoom = clamp(this.zoom * factor, ZOOM_MIN, ZOOM_MAX)
    this.panX = screenX - graphX * this.zoom
    this.panY = screenY - graphY * this.zoom
    this._clampPan()
    this._applyZoom()
  }

  /* Put a node under the reader's eye at the current zoom. This is what
     "control where on the tree you end up" means when the tree outgrows the
     panel: pick a branch, land on it. */
  focusNode(id, { zoom = null } = {}) {
    const record = this.nodes.get(id)
    if (!record) return
    if (zoom != null) this.zoom = clamp(zoom, ZOOM_MIN, ZOOM_MAX)
    const hostWidth = this.zoomHost.clientWidth || this.W
    const hostHeight = this.zoomHost.clientHeight || this.H
    this.panX = hostWidth / 2 - record.x * this.zoom
    this.panY = hostHeight / 2 - record.y * this.zoom
    this._clampPan()
    this._applyZoom()
  }

  _wireHostInteractions() {
    this._onWheel = (event) => {
      if (this.editMode || event.target.closest?.('.chip.as-chat, .chat')) return
      event.preventDefault()
      const rect = this.zoomHost.getBoundingClientRect()
      const screenX = event.clientX - rect.left - this.zoomHost.clientLeft
      const screenY = event.clientY - rect.top - this.zoomHost.clientTop
      const graphX = (screenX - this.panX) / this.zoom
      const graphY = (screenY - this.panY) / this.zoom
      const delta = event.deltaMode === 1 ? event.deltaY * 33 : event.deltaY
      const next = clamp(this.zoom * Math.exp(-delta * 0.0022), ZOOM_MIN, ZOOM_MAX)
      this.zoom = next
      this.panX = screenX - graphX * next
      this.panY = screenY - graphY * next
      this._clampPan()
      this._applyZoom()
    }
    this.zoomHost.addEventListener('wheel', this._onWheel, { passive: false })

    this._onPanDown = (event) => {
      if (event.button !== 0 || this.editMode) return
      if (event.target.closest?.('.node, .chip, .graph-fit, .graph-zoomer, .graph-crumb, button')) return
      this._panState = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        panX: this.panX,
        panY: this.panY,
      }
      try { this.zoomHost.setPointerCapture(event.pointerId) } catch { /* optional */ }
      this.zoomHost.classList.add('panning')
    }
    this._onPanMove = (event) => {
      if (!this._panState || event.pointerId !== this._panState.id) return
      this.panX = this._panState.panX + event.clientX - this._panState.x
      this.panY = this._panState.panY + event.clientY - this._panState.y
      this._clampPan()
      this._applyZoom()
    }
    this._onPanEnd = (event) => {
      if (!this._panState || event.pointerId !== this._panState.id) return
      this._panState = null
      this.zoomHost.classList.remove('panning')
      try { this.zoomHost.releasePointerCapture(event.pointerId) } catch { /* optional */ }
    }
    this.zoomHost.addEventListener('pointerdown', this._onPanDown)
    this.zoomHost.addEventListener('pointermove', this._onPanMove)
    this.zoomHost.addEventListener('pointerup', this._onPanEnd)
    this.zoomHost.addEventListener('pointercancel', this._onPanEnd)

    /* Keyboard peers for every pointer gesture: +/- zoom, 0 returns to the
       overview, arrows pan, and F centres the focused node. */
    this._onHostKeydown = (event) => {
      if (this.editMode || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.target.closest?.('input, textarea, .chat')) return
      const step = event.shiftKey ? 120 : 48
      if (event.key === '+' || event.key === '=') { event.preventDefault(); this.zoomBy(1.25); return }
      if (event.key === '-' || event.key === '_') { event.preventDefault(); this.zoomBy(1 / 1.25); return }
      if (event.key === '0') { event.preventDefault(); this.resetZoom(); return }
      if (event.key === 'f' || event.key === 'F') {
        const node = event.target.closest?.('.node')
        if (!node?.dataset.agentId) return
        event.preventDefault()
        this.focusNode(node.dataset.agentId)
        return
      }
      const pan = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[event.key]
      if (!pan) return
      event.preventDefault()
      this.panX += pan[0]
      this.panY += pan[1]
      this._clampPan()
      this._applyZoom()
    }
    this.zoomHost.addEventListener('keydown', this._onHostKeydown)
  }

  _toGraph(event) {
    const rect = this.zoomHost.getBoundingClientRect()
    return {
      x: (event.clientX - rect.left - this.zoomHost.clientLeft - this.panX) / this.zoom,
      y: (event.clientY - rect.top - this.zoomHost.clientTop - this.panY) / this.zoom,
    }
  }

  /* The old clamp allowed no pan at all at or below 1x — the view could not be
     moved, only reset, which is exactly the viewport fighting the reader. Now
     the content may be dragged anywhere that keeps a usable piece of it on
     screen, at any zoom. */
  _clampPan() {
    const hostWidth = this.zoomHost.clientWidth || this.W
    const hostHeight = this.zoomHost.clientHeight || this.H
    const contentWidth = this.W * this.zoom
    const contentHeight = this.H * this.zoom
    const keepX = Math.min(PAN_KEEP, contentWidth)
    const keepY = Math.min(PAN_KEEP, contentHeight)
    this.panX = clamp(this.panX, keepX - contentWidth, hostWidth - keepX)
    this.panY = clamp(this.panY, keepY - contentHeight, hostHeight - keepY)
  }

  _applyZoom() {
    const identity = Math.abs(this.zoom - 1) < 0.001 && !this.panX && !this.panY
    this.container.style.transform = identity ? ''
      : `translate3d(${this.panX}px, ${this.panY}px, 0) scale(${this.zoom})`
    this.zoomHost.classList.toggle('zoomed', !identity)
    this.fitEl?.classList.toggle('show', true)
    this.fitEl?.classList.toggle('is-off', !identity)
    const readout = this.fitEl?.querySelector('.gf-z')
    if (readout) readout.textContent = `${this.zoom.toFixed(2)}×`
    this._placeChips()
  }

  resetZoom() {
    this.zoom = 1
    this.panX = 0
    this.panY = 0
    this._applyZoom()
  }

  resize() {
    if (this._destroyed) return
    const width = this.container.clientWidth || this.W
    const height = this.container.clientHeight || this.H
    if (width === this.W && height === this.H) {
      this._placeChips()
      return
    }
    this.W = width
    this.H = height
    this._clampPan()
    this._applyZoom()
    this._layoutNow()
  }

  destroy() {
    this._destroyed = true
    this.ro.disconnect()
    if (this._animationRaf) cancelAnimationFrame(this._animationRaf)
    for (const raf of this._addRafs) cancelAnimationFrame(raf)
    for (const timer of this._removeTimers) clearTimeout(timer)
    for (const timer of this._chatTimers) clearTimeout(timer)
    for (const record of this.nodes.values()) {
      record.runtimeUnsub?.()
      record.chipRuntimeUnsub?.()
      clearTimeout(record.clickTimer)
    }
    this.unsubs.forEach(unsub => unsub())
    document.removeEventListener('keydown', this._onDocumentKeydown)
    this.zoomHost.removeEventListener('wheel', this._onWheel)
    this.zoomHost.removeEventListener('keydown', this._onHostKeydown)
    this.zoomHost.removeEventListener('pointerdown', this._onPanDown)
    this.zoomHost.removeEventListener('pointermove', this._onPanMove)
    this.zoomHost.removeEventListener('pointerup', this._onPanEnd)
    this.zoomHost.removeEventListener('pointercancel', this._onPanEnd)
    this.zoomHost.classList.remove('graph-zoom-host', 'static-tree-host', 'panning', 'zoomed')
    this.zoomerEl?.remove()
    this.screenOverlay?.remove()
    this.container.innerHTML = ''
    this.container.removeAttribute('data-layout')
    this.container.removeAttribute('data-edit-mode')
    this.container.classList.remove('graph-canvas', 'static-tree-graph', 'zoomable')
    if (probeOwner === this) {
      probeOwner = null
      window.__graphFrameMs = window.__pageFrameMs = window.__graphTickMs = window.__graphNodeCount = undefined
      window.__graphStress = undefined
    }
  }
}
