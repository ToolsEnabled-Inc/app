import { sim, fmtRuntime } from './sim.js'
import { ROLES } from './vocab.js'
import { el, buildChat, bindRuntime, formatInlineText } from './components.js'
import { layoutTree, TREE_ROLE_RADII, TREE_LABEL_STACK, treeNodeRadius, hierarchyParents } from './tree-layout.js'
/* THE WORDS ON AN EMPTY SLOT ARE NOT WRITTEN HERE. src/fleet-tree-copy.js owns
   every sentence in the start-an-agent-from-the-tree flow — the panel, the
   refusals, the tree names and these two — and it says at length why one flow
   rendered by six files needs one voice. A second wording invented in this file
   would be the exact defect that module exists to prevent, and it would be the
   one on the screen every new customer opens. */
import { EMPTY_NODE, SECOND_TREE } from './fleet-tree-copy.js'

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
/* ZOOM-TO-FOCUS (owner defect 1b: "if you zoom too far in, it should focus on
   the tree that descends from the node closest to your cursor"). Crossing
   ZOOM_DRILL_AT while zooming IN drills into the record nearest the cursor
   (within DRILL_RADIUS graph px — past that the wheel is aimed at empty
   canvas, and drilling into something offscreen would be a jump nobody
   steered). Falling below ZOOM_DRILL_OUT_AT zooms back OUT of the drill.
   The two thresholds are apart on purpose — hysteresis is not optional: one
   shared threshold makes the boundary oscillate drill-in/drill-out on every
   wheel notch that straddles it. The wheel path resets zoom to 1 after a
   drill — 1 sits between the thresholds, so the freshly-fitted branch shows
   whole and neither rule re-fires without a deliberate crossing. */
const ZOOM_DRILL_AT = 1.6
const ZOOM_DRILL_OUT_AT = 1.28
const DRILL_RADIUS = 220
// Content may be dragged until only this much of it is left on screen; it can
// never be pushed away entirely, and it is never locked in place either.
const PAN_KEEP = 160
// How far a context block may sit from its own circle before it stops reading
// as that circle's block. Measured against the card, not guessed: a 260px card
// one card-width away still scans as attached; two away does not.
const CHIP_REACH = 380
const HIERARCHY_TYPES = new Set(['manages', 'delegates_to', 'hierarchy'])

/* ============================================================================
   EMPTY SLOTS — the pressable holes in the tree.

   THE STATE THIS EXISTS FOR. A fresh install has started nothing, so this
   canvas has nothing to draw, and a canvas with nothing on it teaches nobody
   what it is for. The owner's instruction: "we should essentially draw EMPTY
   nodes, and the user just presses them to extend their existing structure."
   So absence is drawn as an offer rather than as blankness — a dashed circle
   hanging where the next agent would go, and one at the top for a tree that
   does not exist yet, because a computer may hold MORE THAN ONE tree.

   WHAT A SLOT IS NOT. It is not an agent, it is not in `this.nodes`, it is not
   in the node count the performance probe publishes, it carries no runtime, no
   role hue, no context card, and it is not a drop target in edit mode. Nothing
   in this file starts anything when one is pressed: the press is reported and
   that is all it does. Two other surfaces own what happens next.

   AND IT IS NOT `.static-tree-node`. That class means "a running agent" to
   nine QA harnesses on this tree — they count it, click the first one to open
   the rail, and assert that every one of them carries a role- token whose hue
   matches its ring (tools/page2-qa.cjs). A slot wearing that class would make
   all nine quietly measure something that is not an agent, and the role-token
   assertion would go red on a circle that correctly has no role. So a slot
   shares no class, no data attribute and no map with an agent node. The only
   thing the two share is the canvas they are positioned on.
   ============================================================================ */

/* The floor src/tree-layout.js already calls readable, which is also the
   SMALLEST a node on this canvas is allowed to be: a slot is subordinate to
   every agent around it by construction, and cannot be shrunk further. */
const EMPTY_SLOT_RADIUS = 34
/* The drop threshold's slack beyond exact circle contact. Must keep the hit
   distance >= the packed non-overlap distance (MIN_AIR in tree-layout.js is
   2), or an annulus reappears where two nodes visually touch and a release
   registers on neither. */
const DROP_SLOP = 8
/* Sorted out of a crowded rank before any agent (see keepReadable), and placed
   after its own siblings inside its family (see orderHint). An offer is the
   first thing a rank should drop and the last thing a family should list. */
const EMPTY_SLOT_CULL_RANK = 9000
const EMPTY_SLOT_ORDER_HINT = 1
const NEW_TREE_SLOT_ID = 'empty:new-tree'
const CHILD_SLOT_PREFIX = 'empty:child:'

/* The DOM event a slot press dispatches on the graph container, bubbling, in
   addition to the onEmptyPress callback. Two ways in because the two consumers
   are different shapes: the view that constructs this graph has the callback,
   and anything upstream that only has the wrap element can listen. */
export const TREE_EMPTY_PRESS_EVENT = 'tree-empty-press'

/* A SLOT DRAWS A "+" AND NO TEXT, SO ITS ACCESSIBLE NAME IS ALL IT SAYS.
   A dashed ring with a plus is read by a sighted person in a glance and by a
   screen reader as nothing at all, so the name is not decoration here — it is
   the entire label of a button. Both strings below are src/fleet-tree-copy.js's
   own, used verbatim.

   The two cases are not the same sentence. "Start another tree" is true beside
   a tree that already exists and false on a canvas where nothing has ever run,
   where the honest reading of the one circle on screen is the same offer every
   other slot makes: an empty spot, press it. So the top-rank slot borrows the
   ordinary empty-spot wording until this computer has a tree to be another one
   of. The tooltip carries the hint, which is what a hint is for. */
const slotWords = (kind, hasTree) => kind === 'new-tree' && hasTree
  ? { name: SECOND_TREE.action, hint: SECOND_TREE.help }
  : { name: EMPTY_NODE.ariaLabel, hint: EMPTY_NODE.hint }

const calm = () => document.body.classList.contains('reduce-motion')
  || (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const escapeMarkup = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]))
/* A NUMBER SOMEBODY MEASURED, OR NOTHING. NEVER ZERO FOR "NOBODY SAID".
 *
 * `Number(null)` is 0 and `Number('')` is 0, and the chip preview used to run
 * both of those through `Number()`. src/declared-fleet.js deliberately omits
 * tasksDone and failRate -- a declared organisation says what is CONFIGURED,
 * not what has run -- and projectedComputer() normalises that absence to null.
 * The coercion then turned it into a measurement, so the one node on the fleet
 * graph of a copy with no agent host read "0 tasks · 0% fail" beside a rail
 * saying "runtime, load, tasks, and messages unavailable · not provided by
 * fleet projection". Measured in the packaged window on a sterile profile
 * (tools/offline-routes-qa.mjs, artifacts/b7/connected-computers.png).
 *
 * A numeric string is still accepted, because a projection is JSON written by
 * something else and "12" is a number somebody wrote down. An empty string is
 * not: it is the same absence with a different spelling. */
const measuredNumber = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : NaN
  }
  return NaN
}
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
    treeChat = null,
    onOverridesChange = null,
    emptySlots = true,
    onEmptyPress = null,
    canExtend = null,
    canDrag = null,
    onDropRefused = null,
    onDetachToNewTree = null,
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
    this.treeChat = typeof treeChat === 'function' ? treeChat : null
    this.onOverridesChange = typeof onOverridesChange === 'function' ? onOverridesChange : null
    this.emptySlotsEnabled = emptySlots !== false
    this.onEmptyPress = typeof onEmptyPress === 'function' ? onEmptyPress : null
    /* (agent | null) => boolean — "may a child hang here?", asked of the model
       before a slot is drawn, with null meaning "may a new tree begin?". Absent
       on a mount that has no such rule, in which case every position is drawn.
       See _planEmptySlots for why the rule is injected and not imported. */
    this.canExtend = typeof canExtend === 'function' ? canExtend : null
    /* (agent) => boolean — "may this node be picked up at all?". Injected
       because the graph cannot know the answer: the old inline rule was
       `role !== 'coordinator'`, and TREE roles are free text — a node a
       person happened to NAME "coordinator" was silently undraggable. The
       view owns the data model, so the view supplies the rule; absent, every
       node drags, which is the honest default for a canvas about moving
       things. */
    this.canDrag = typeof canDrag === 'function' ? canDrag : null
    /* (sentence) => void — where the drag refusals speak. A drop the model
       refuses says WHY in the page's own status line; a wiggle with no words
       reads as a bug, not a rule. */
    this.onDropRefused = typeof onDropRefused === 'function' ? onDropRefused : null
    /* (nodeId) => boolean — the new-tree slot's drop: detach this branch into
       its own tree. Injected like onReparent, and for the same reason: the
       store is the only author of tree shape. */
    this.onDetachToNewTree = typeof onDetachToNewTree === 'function' ? onDetachToNewTree : null
    /* Deliberately a second map, never merged into `this.nodes`. Everything
       that reads `this.nodes` — the chips, the runtime bindings, the drag and
       reparent path, the selection, the published node count — is written
       against a record that HAS an agent. A slot has no agent, and the way to
       keep that true is for it to be somewhere else. */
    this.emptySlots = new Map()
    this.nodes = new Map()
    this.selectedId = null
    this.layout = 'tree'
    this.editMode = false
    this.unsubs = []
    this._destroyed = false
    this._layoutVisibleIds = new Set()
    this._culled = new Set()
    this._layoutResult = null
    /* A nudge saved or cleared is a geometry change the structure key cannot
       see from the agent list, so the store bumps this counter. */
    this._positionsRevision = 0
    this._layoutKey = null
    /* Density is a fact about the FLEET, so it is measured on a layout of the
       fleet alone — see _layoutNow for the loop this closes. */
    this._realDrillRequired = false
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
        /* v2 ONLY — an override is a nudge RELATIVE TO a slot, and the slot
           follows the node's parent. A v1 entry {dx,dy} recorded no parent,
           so after any reparent it displaced the node from its NEW slot by a
           vector measured against the OLD one: the saved-drag defect behind
           the stale connector lines (owner defect 2). It cannot be validated
           retroactively — the parent it was measured under is gone — and
           keeping it preserves exactly the displacement being fixed, so v1
           blobs are discarded on read. Costs any hand-arrangement once, said
           plainly in the release note. */
        if (value?.v !== 2) continue
        if (Number.isFinite(dx) && Number.isFinite(dy)) {
          clean[id] = { v: 2, dx, dy, parentId: value.parentId ?? null, at: Number(value.at) || 0 }
        }
      }
      return clean
    } catch {
      return {}
    }
  }

  _writePositions() {
    /* Every save and every clear passes through here, so this is the one
       place the structure key needs to hear about a nudge. */
    this._positionsRevision += 1
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
        /* THE CIRCLE FOLLOWS THE RECORD IT ALREADY HAS. Measured 2026-08-13 on
           the installed build: this branch swapped `agent` and stopped, so a
           node created as a draft kept "no signal / no runtime" for the life of
           the mount while its real session started, ran and finished -- the
           status transitions only ever appeared after a full remount. The
           renderers below skip work when nothing they draw from has changed. */
        this._renderRuntime(existing)
        if (!existing.chatOpen) this._renderChipPreview(existing)
        continue
      }
      this._createRecord(agent, !initial || addIds.has(agent.id))
    }
    /* GEOMETRY FOLLOWS STRUCTURE, NOT TICKS (owner, iteration 7: "the tree
       action is a mess like the way it moves and such").
       Every reply, usage reading and status change reached this line, and
       _layoutNow re-runs the packers AND the vertical fitter — which is
       allowed to rescale every radius in the tree. Nodes carry no transition
       on left/top, so each of those re-packs was an instant jump: circles
       moving and changing size while the person watched an agent talk.
       Nothing about a status word can change where a circle belongs, so the
       layout is skipped unless the SHAPE changed. The renderers above have
       already refreshed what those events actually alter — the ring, the
       runtime, the chip preview. */
    if (this._layoutResult && this._layoutKey === this._structureKey()) {
      this._publishNodeCount()
      return
    }
    this._layoutNow()
    this._publishNodeCount()
  }

  /* What a layout is a function of. Two passes with the same key must produce
     the same geometry, so everything the placement reads is in here — and
     nothing that merely changes what a node SAYS. */
  _structureKey() {
    const shape = this._layoutAgents()
      .map(agent => `${agent.id}|${agent.parentId || ''}|${agent.role || ''}|${agent.name || ''}`)
      .join(';')
    const edges = (this.declaredEdges || [])
      .map(edge => `${edge.from || edge.source || ''}>${edge.to || edge.target || ''}`)
      .join(',')
    return [
      this.rootId || '',
      this.editMode ? 'edit' : 'view',
      Math.round(this.W),
      Math.round(this.H),
      this._positionsRevision,
      edges,
      shape,
    ].join('~')
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
      chatHeight: 0,
      runtimeUnsub: null,
      chipRuntimeUnsub: null,
      clickTimer: 0,
    }
    this.nodes.set(agent.id, record)

    this._renderRuntime(record)

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
      /* The LIVE drag obeys the same corridor the release applies. The old
         live clamp knew only the canvas, so a drag rode free and then
         jumped into the corridor on release — a snap the hand never asked
         for. What the person sees while dragging is where the node stays. */
      const slotX = record.slot?.x ?? record.x
      record.x = clamp(point.x + offset.x, Math.min(record.r + 12, slotX), Math.max(this.W - record.r - 12, slotX))
      record.y = clamp(point.y + offset.y, ...this._rankCorridor(record, this._layoutResult))
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
    /* hierarchyParents is the SAME resolver the layout uses, declared edges
       included — the old inline walk only followed parentId, so a cycle
       created through a declared manages/delegates_to edge slipped past this
       check while the layout saw it plainly. One resolver, one answer. */
    const parents = hierarchyParents(this.computer?.agents || [], this.declaredEdges || [])
    let current = String(parent.id)
    const seen = new Set()
    while (current && !seen.has(current)) {
      if (current === String(child.id)) return true
      seen.add(current)
      current = parents.get(current) ?? null
    }
    return false
  }

  /* The vertical band a nudged record may occupy without leaving its rank:
     [low, high] around its own row's y, HALF THE PITCH to each neighbouring
     row — the band boundary is the midline between ranks, so a top circle
     cannot be dragged into its children's band, while a drag INSIDE the
     band stays free. The precise label-collision veto below is what refuses
     genuine overlaps, not this coarse fence: the earlier version also
     subtracted the label stack here and floored at zero, which made tight
     rows refuse every vertical nudge — the snap-back feel the owner called
     a regression (iteration 6: "keep the new version but make it act and
     feel like before"). The outermost rows get a fixed 40px outward since
     no neighbour bounds them.

     THE BAND ALWAYS CONTAINS THE RECORD'S OWN SLOT. The corridor constrains
     nudges, never the layout's resting position — the canvas-edge floor
     (r + 64) disagrees with the layout's own padTop for big circles, and
     letting it move un-nudged nodes pushed the whole top row down into its
     label reservation. That at-rest shift IS the mess the owner
     screenshotted; a node nobody dragged sits exactly where the layout put
     it, always. Falls back to canvas bounds when the layout carries no
     rows (single-rank canvases). */
  _rankCorridor(record, result, slotY = record.slot?.y ?? record.y) {
    const canvasLow = record.r + 64
    const canvasHigh = this.H - record.r - 58
    const rowIndex = result?.rowOf?.get(record.id)
    const rowYs = result?.rowYs
    if (!Number.isFinite(rowIndex) || !Array.isArray(rowYs) || rowYs.length < 2) {
      return [Math.min(canvasLow, slotY), Math.max(canvasHigh, slotY)]
    }
    const rowY = rowYs[rowIndex]
    const up = rowIndex > 0 ? (rowY - rowYs[rowIndex - 1]) / 2 : 40
    const down = rowIndex + 1 < rowYs.length ? (rowYs[rowIndex + 1] - rowY) / 2 : 40
    return [
      Math.min(Math.max(canvasLow, rowY - up), slotY),
      Math.max(Math.min(canvasHigh, rowY + down), slotY),
    ]
  }

  /* One label rectangle for every rule that needs it — the drop hit test and
     the override-overlap veto must agree about where a node's words are, or
     a drop can land where a veto later fires. Geometry mirrors the CSS
     EXACTLY: the stack hangs 7px under the circle, TREE_LABEL_STACK tall,
     and .node-labels is min(var(--d) + 118px, var(--nn-max)) wide, centred —
     half is min(r + 59, labelMax / 2). The first version spanned
     max(r, 35) + 12, half the real width, so the veto measured half the
     words and missed half the collisions. labelMax is recorded at layout
     time beside the --nn-max write. */
  _labelBox(record) {
    const half = Math.min(record.r + 59, (record.labelMax || Infinity) / 2)
    return {
      left: record.x - half,
      right: record.x + half,
      top: record.y + record.r + 7,
      bottom: record.y + record.r + 7 + TREE_LABEL_STACK,
    }
  }

  /* The record nearest a graph-space point, within a bound. Serves the
     zoom-to-focus drill: past the bound the wheel is aimed at empty canvas,
     and the honest answer is "nothing to focus", not the least-far node. */
  _nearestRecordTo(graphX, graphY, within = Infinity) {
    let nearest = null
    let best = within
    for (const record of this.nodes.values()) {
      if (record.el.hidden || this._culled.has(record.id)) continue
      const distance = Math.hypot(record.x - graphX, record.y - graphY)
      if (distance < best) {
        best = distance
        nearest = record
      }
    }
    return nearest
  }

  /* Whether the dragged record, at its current position, is "on" the
     candidate — the circle, or the LABEL BOX hanging under it. The label is
     part of what a person sees as the node; a drop released over the name
     used to fall into dead space and read as a rejected drop. */
  _dropHit(candidate, record) {
    const circle = Math.hypot(candidate.x - record.x, candidate.y - record.y)
      - (candidate.r + record.r + DROP_SLOP)
    if (circle < 0) return circle
    const box = this._labelBox(candidate)
    if (record.x >= box.left && record.x <= box.right && record.y >= box.top - candidate.r && record.y <= box.bottom) return -1
    return circle
  }

  _updateDropTarget(record) {
    /* NEAREST wins, not first-in-insertion-order: with the old first-match
       loop, two nodes standing close meant the drop target was decided by
       Map insertion order, and the ring lit on a circle the pointer was not
       even nearest to. And the threshold is candidate.r + record.r +
       DROP_SLOP — AT LEAST the packed non-overlap distance — so no annulus
       exists where two nodes visually touch yet nothing registers: the old
       `record.r * 0.55` factor left exactly that dead ring, which is what
       made dropping a child on its parent land in nothing (owner defect 3:
       a MISSED drop, not an accepted one). */
    let raw = null
    let best = Infinity
    for (const candidate of this.nodes.values()) {
      if (candidate === record || this._culled.has(candidate.id) || candidate.el.hidden) continue
      const score = this._dropHit(candidate, record)
      if (score < 0 && score < best) {
        best = score
        raw = candidate
      }
    }
    /* SLOTS ARE DROP TARGETS TOO (owner defect 4). A child slot means "join
       this family" — the same move as dropping on the parent circle, said at
       the exact spot the child would land. The new-tree slot is the drag OUT:
       this branch becomes its own tree. Slots compete in the same
       nearest-wins field as circles, so whichever target the node is actually
       closest to lights up. */
    for (const slot of this.emptySlots.values()) {
      if (slot.hidden) continue
      const score = this._dropHit(slot, record)
      if (score < 0 && score < best) {
        best = score
        raw = slot
      }
    }
    const draggable = this.canDrag ? this.canDrag(record.agent) : true
    const isSlot = raw && !raw.agent
    const slotValid = isSlot && (
      raw.kind === 'new-tree'
        ? true
        : raw.parentId !== record.agent.parentId
          && raw.parentId !== record.agent.id
          && !(this.nodes.get(raw.parentId) && this._wouldCycle(record.agent, this.nodes.get(raw.parentId).agent))
    )
    const valid = raw
      && draggable
      && (isSlot
        ? slotValid
        : raw.id !== record.agent.parentId && !this._wouldCycle(record.agent, raw.agent))
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

    if (target && !target.agent) {
      /* A slot drop. The child slot is the same move as dropping on its
         parent circle; the new-tree slot detaches the branch into its own
         tree. Both go through injected callbacks so the STORE stays the only
         author of tree shape, exactly as onReparent already works. */
      const changed = target.kind === 'new-tree'
        ? this.onDetachToNewTree?.(record.id)
        : this.onReparent?.(record.id, target.parentId)
      if (changed) {
        this._clearPosition(record.id)
        this._layoutNow()
        return
      }
    } else if (target) {
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
      /* A refused drop names its rule. The wiggle alone taught nothing —
         "possible to drop a child directly on its parent" (owner defect 3)
         was in fact this branch snapping back wordlessly, which read as an
         accepted drop that mysteriously changed nothing. */
      if (this.onDropRefused) {
        const nameOf = (rec) => rec?.agent?.name || rec?.agent?.id || 'this agent'
        const rawIsSlot = !raw.agent
        const rawParentName = rawIsSlot ? nameOf(this.nodes.get(raw.parentId)) : nameOf(raw)
        if (this.canDrag && !this.canDrag(record.agent)) {
          this.onDropRefused('notDraggable', { name: nameOf(record) })
        } else if (rawIsSlot ? raw.parentId === record.agent.parentId : raw.id === record.agent.parentId) {
          this.onDropRefused('alreadyUnder', { name: nameOf(record), parent: rawParentName })
        } else if (rawIsSlot
          ? (this.nodes.get(raw.parentId) && this._wouldCycle(record.agent, this.nodes.get(raw.parentId).agent))
          : this._wouldCycle(record.agent, raw.agent)) {
          this.onDropRefused('wouldCycle', { name: nameOf(record), target: rawParentName })
        }
      }
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

    /* v2: the nudge remembers WHICH PARENT'S SLOT it was measured against,
       so a later reparent by any route invalidates it wholesale instead of
       displacing the node from a slot it was never dragged from. */
    this._positions[record.id] = {
      v: 2,
      dx: Math.round((record.x - record.slot.x) * 100) / 100,
      dy: Math.round((record.y - record.slot.y) * 100) / 100,
      parentId: record.agent.parentId ?? null,
      at: Date.now(),
    }
    this._writePositions()
    this._renderLinks()
  }

  /* WHICH SLOTS THIS TREE IS OFFERING RIGHT NOW.
     Derived from the fleet and from a layout of the fleet ALONE, never from a
     layout that already contains slots. That is not fastidiousness, it is the
     one rule that makes this terminate: if the presence of slots could change
     whether slots are offered, adding them would crowd the canvas, the crowding
     would withdraw them, the canvas would relax, and they would come back — a
     graph that flickers forever on a static fleet.

     THE TWO OFFERS.
     1. A NEW TREE. One slot with no parent, so the existing model puts it in
        the top rank beside whatever roots already exist. With no agents at all
        it is the only thing on the canvas and lands dead centre, which is the
        first-run screen: one circle, press it. It is withheld while the view
        is drilled into one branch, because "start a new tree" is not an offer
        that belongs inside somebody else's tree.
     2. A CHILD, under every agent the fleet layout actually placed. A culled
        agent is not on the canvas, so a slot hanging off it would hang off
        nothing.

     WHY THE CHILD OFFERS STOP AT DENSE_AT. Past that count the page's own
     verdict is already "this is too much to read, drill in" — it says so in
     the hint updateDensity drives. Answering a canvas that is too crowded to
     read by adding one more circle per agent helps nobody, and drilling in
     brings every slot back for the branch actually being read.

     AND WHY A SLOT CAN BE REFUSED BEFORE IT IS DRAWN. The store that accepts
     these presses has limits of its own — a fan-out cap and a depth cap in
     src/fleet-trees.js — so there are positions in a legal tree where a child
     simply cannot go. A dashed circle at one of those positions is a button
     that is guaranteed to fail, and a person only finds out after choosing a
     role and writing out what they wanted done. Drawing an offer that cannot
     be accepted is a rendering defect, and it is this file's defect, so the
     answer is to not draw it.
     The RULE, though, is not this file's to know: fan-out and depth belong to
     whoever owns the model, and hard-wiring an import of it here would put a
     copy of somebody else's cap inside the renderer, where it would go stale
     the first time they changed it. So the caller injects the question as
     `canExtend`, this file only asks it, and a mount that passes nothing keeps
     drawing every slot exactly as before. */
  _canExtend(target) {
    if (!this.canExtend) return true
    try {
      return this.canExtend(target) !== false
    } catch {
      /* NOT A SILENT SWALLOW. The predicate belongs to another module and may
         be reading a store that is mid-write; a thrown answer is "I do not
         know", never "no". Withholding a slot on an unknown is how a person
         loses the only way to extend their tree because something unrelated
         glitched, so an unknown falls back to the behaviour of a mount that
         passes no predicate at all: draw it, and let the store refuse the
         submission in its own words if it must. */
      return true
    }
  }

  _planEmptySlots(agents, fleetLayout) {
    /* editMode deliberately NOT in this guard any more — see setEditMode. */
    if (!this.emptySlotsEnabled || this._destroyed) return []
    const plans = []
    const hasTree = agents.length > 0
    const describe = (kind) => slotWords(kind, hasTree)
    if (!this.rootId && this._canExtend(null)) {
      plans.push({
        id: NEW_TREE_SLOT_ID,
        kind: 'new-tree',
        parentId: null,
        ...describe('new-tree'),
      })
    }
    const placed = agents.filter(agent =>
      fleetLayout.slots.has(agent.id) && !fleetLayout.culled.has(agent.id))
    if (placed.length < DENSE_AT) {
      for (const agent of placed) {
        if (!this._canExtend(agent)) continue
        plans.push({
          id: `${CHILD_SLOT_PREFIX}${agent.id}`,
          kind: 'child',
          parentId: agent.id,
          ...describe('child'),
        })
      }
    }
    return plans
  }

  /* A slot, expressed in the only vocabulary src/tree-layout.js speaks. It is
     an ordinary node to that file: an id, a parent, an explicit radius, and the
     two ranking fields that say "drop me first, and list me last". Nothing in
     the layout engine knows what a slot is, which is why none of this needed
     the layout engine to change. */
  _emptyLayoutNode(plan) {
    return {
      id: plan.id,
      name: '',
      role: 'default',
      parentId: plan.parentId,
      r: EMPTY_SLOT_RADIUS,
      cullable: true,
      cullRank: EMPTY_SLOT_CULL_RANK,
      orderHint: EMPTY_SLOT_ORDER_HINT,
    }
  }

  /* A SLOT NEVER COSTS AN AGENT ITS PLACE.
     The rank packer culls to keep what is left readable, and it is told to drop
     slots first — but "first" is not "only". Two ranks are packed by two
     different routines here (see packGroupedXs and packedXs in
     src/tree-layout.js), and the cull path is entered on a count-based test
     that slots contribute to: a rank of eight agents packs without a murmur,
     and the same eight agents plus eight slots trip the readability test and
     send the WHOLE rank — agents included — through the culler. An agent that
     was on the canvas a moment ago vanishing so that an empty circle can be
     drawn is the worst trade this feature could make, and to a person watching
     it is indistinguishable from an agent having died.
     So the offer is withdrawn wholesale and the fleet is drawn exactly as it
     would have been drawn if this feature did not exist. Fewer places to press
     is a disappointment; a disappeared agent is a lie. */
  _slotsDisplaceAnAgent(agents, fleetLayout, withSlots) {
    return agents.some(agent =>
      fleetLayout.slots.has(agent.id) && !withSlots.slots.has(agent.id))
  }

  _layoutNow({ preserve = new Set() } = {}) {
    if (this._destroyed) return
    const agents = this._layoutAgents()
    const edges = this.declaredEdges || []
    /* THE FLEET IS LAID OUT FIRST, AND ON ITS OWN.
       Two things are read from this pass and from nothing else: whether the
       tree is too dense to read (the drill hint), and which agents fit. Both
       are claims about the fleet, and a slot must not be able to make either
       of them true. */
    const fleetLayout = layoutTree({ nodes: agents, edges, W: this.W, H: this.H })
    this._realDrillRequired = fleetLayout.drillRequired

    let result = fleetLayout
    let plans = this._planEmptySlots(agents, fleetLayout)
    if (plans.length) {
      const withSlots = layoutTree({
        nodes: [...agents, ...plans.map(plan => this._emptyLayoutNode(plan))],
        edges,
        W: this.W,
        H: this.H,
      })
      if (this._slotsDisplaceAnAgent(agents, fleetLayout, withSlots)) plans = []
      else result = withSlots
    }

    this._layoutResult = result
    this._culled = result.culled
    this._layoutVisibleIds = new Set(agents.map(agent => agent.id))
    /* Stamped by the layout itself, so every route into here — a drag, a
       resize, a drill, a direct call — leaves the skip-check above holding
       the key of the geometry actually on screen. */
    this._layoutKey = this._structureKey()

    /* BELOW THE RADIUS FLOOR, THE ONLY HONEST ANSWER IS MORE HEIGHT.
       The layout says how much (minHeight, from the vertical fitter's own
       arithmetic); the wrap asks for it and the page scrolls -- the same cure
       .comp-body's static min-height already applies in styles.css. The
       subtlety is CLEARING the ask: with the ask applied, this.H is the
       inflated height, so "the tree fits now" cannot be read from the current
       pass -- that misread would clear, shrink, refit, re-ask, forever. The
       natural height is remembered from the last un-asked layout, and the ask
       is dropped only when a probe at THAT height fits. One extra layoutTree
       call, only while an ask is active, DOM-free by contract. */
    const layoutNodes = plans.length && result !== fleetLayout
      ? [...agents, ...plans.map(plan => this._emptyLayoutNode(plan))]
      : agents
    if (!this._heightAsk) this._naturalH = this.H
    if (Number.isFinite(result.minHeight) && result.minHeight > this.H) {
      this._heightAsk = result.minHeight
      this.container.style.minHeight = `${result.minHeight}px`
    } else if (this._heightAsk) {
      const probe = layoutTree({ nodes: layoutNodes, edges, W: this.W, H: this._naturalH })
      if (!Number.isFinite(probe.minHeight)) {
        this._heightAsk = null
        this.container.style.minHeight = ''
      }
    }

    /* The layout is allowed to shrink the circles so the tiers clear each
       other on a short canvas (src/tree-layout.js, vertical fitter). It hands
       back what it decided, and every consumer of the radius has to move with
       it — the drawn diameter (--d), the clamp that keeps a node on the
       canvas below, the leader-line origins and the obstacle boxes in
       _placeChips all read record.r. Recomputed from the role on every
       layout, never from the last shrunk value, so a window that grows gives
       the circles their full size back instead of ratcheting down. */
    for (const record of this.nodes.values()) {
      const radius = result.radii?.get(record.id)
      if (!Number.isFinite(radius) || radius === record.r) continue
      record.r = radius
      record.el.style.setProperty('--d', `${radius * 2}px`)
    }

    for (const record of this.nodes.values()) {
      const slot = result.slots.get(record.id)
      const hidden = !slot || result.culled.has(record.id)
      record.el.hidden = hidden
      record.chip?.classList.toggle('screen-chip-visible', !hidden && !this.editMode)
      record.chipLeader?.classList.toggle('visible', !hidden && !this.editMode)
      record.chipLeaderDot?.classList.toggle('visible', !hidden && !this.editMode)
      if (hidden || preserve.has(record.id)) continue
      record.slot = slot
      /* An override is a nudge against THIS parent's slot. If the record's
         parent has changed since the nudge was saved — reparent by drag, by
         the Move picker, by the store, any route at all — the override is
         meaningless and dies here, without each route having to remember to
         clear it. This is the fix for the stale connector lines (owner
         defect 2): the line was drawn to slot+offset where offset belonged
         to a layout that no longer exists. */
      let offset = this._positions[record.id] || { dx: 0, dy: 0 }
      if (offset.v === 2 && (offset.parentId ?? null) !== (record.agent.parentId ?? null)) {
        this._clearPosition(record.id)
        offset = { dx: 0, dy: 0 }
      }
      /* THE NUDGE IS WHAT GETS CLAMPED, NEVER THE LAYOUT'S OWN POSITION.
         Both bounds contain the slot, so an un-nudged record (dx = dy = 0)
         lands exactly where the layout put it — the old clamps moved big
         circles even at rest, and that push-down was the overlap the owner
         called a regression. Vertically the nudge also stays in its own
         rank corridor (owner, iteration 5: "the top circles should stay at
         the top — not overlap ever"): the midline between rows is the
         fence, and the label-collision veto below is the precise check. */
      record.x = clamp(slot.x + offset.dx, Math.min(record.r + 12, slot.x), Math.max(this.W - record.r - 12, slot.x))
      record.y = clamp(slot.y + offset.dy, ...this._rankCorridor(record, result, slot.y))
      const label = result.labels.get(record.id)
      const text = record.el.querySelector('.nn-t')
      if (text && label) text.textContent = label.text
      if (label?.title) record.el.querySelector('.node-name')?.setAttribute('title', label.title)
      if (label?.maxWidth) record.el.style.setProperty('--nn-max', `${label.maxWidth}px`)
      else record.el.style.removeProperty('--nn-max')
      record.labelMax = label?.maxWidth || null
      this._positionRecord(record)
    }
    /* An override may not recreate the overlap the packer just removed: a
       nudged node that would come within MIN_AIR of any other placed record
       or of an offered slot loses its nudge and returns to its own slot.
       Checked after every record has its position, because the collision is
       between FINAL positions, not slots. */
    const rectsMeet = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top)
    const circleMeetsRect = (cx, cy, r, box) => {
      const px = Math.max(box.left, Math.min(cx, box.right))
      const py = Math.max(box.top, Math.min(cy, box.bottom))
      return Math.hypot(cx - px, cy - py) < r - 2
    }
    for (const record of this.nodes.values()) {
      if (record.el.hidden || !this._positions[record.id]) continue
      let collides = false
      const recordBox = this._labelBox(record)
      for (const other of this.nodes.values()) {
        if (other === record || other.el.hidden) continue
        /* Circle-vs-circle, and now ALSO the words: a nudge that leaves the
           circles clear but drops this node's label onto a neighbour's label
           or circle is the overlap the owner sees, and it was invisible to
           the old circle-only test. */
        const otherBox = this._labelBox(other)
        if (Math.hypot(other.x - record.x, other.y - record.y) < record.r + other.r + 2
          || rectsMeet(recordBox, otherBox)
          || circleMeetsRect(other.x, other.y, other.r, recordBox)
          || circleMeetsRect(record.x, record.y, record.r, otherBox)) {
          collides = true
          break
        }
      }
      if (!collides) {
        for (const plan of plans) {
          const slot = result.slots.get(plan.id)
          if (slot && Math.hypot(slot.x - record.x, slot.y - record.y) < record.r + EMPTY_SLOT_RADIUS + 2) {
            collides = true
            break
          }
        }
      }
      if (collides) {
        this._clearPosition(record.id)
        /* Back to the layout's own position VERBATIM — clamping the return
           trip was the same at-rest shift the apply above just stopped
           doing, and a "reverted" node that lands somewhere the layout
           never chose reads as random. */
        record.x = record.slot.x
        record.y = record.slot.y
        this._positionRecord(record)
      }
    }
    this._syncEmptySlots(plans, result)
    this._renderLinks()
    this.updateDensity()
    this._placeChips()
    this._publishNodeCount()
  }

  /* Reconcile the drawn slots against the plan, by id, the same way
     _reconcile does for agents. Rebuilding the elements every layout would be
     shorter and would throw away keyboard focus on every resize — a person who
     has tabbed to a slot and then widened the window would find the focus back
     at the top of the page. An id that survives keeps its element. */
  _syncEmptySlots(plans, result) {
    const wanted = new Map(plans.map(plan => [plan.id, plan]))
    for (const [id, slot] of [...this.emptySlots]) {
      if (wanted.has(id)) continue
      slot.el.remove()
      this.emptySlots.delete(id)
    }
    for (const plan of plans) {
      const slot = this.emptySlots.get(plan.id) || this._createEmptySlot(plan)
      slot.kind = plan.kind
      slot.parentId = plan.parentId
      if (slot.el.getAttribute('aria-label') !== plan.name) {
        slot.el.setAttribute('aria-label', plan.name)
        slot.el.setAttribute('title', plan.hint)
      }
      const point = result?.slots.get(plan.id)
      slot.hidden = !point || result.culled.has(plan.id)
      slot.el.hidden = slot.hidden
      if (slot.hidden) continue
      /* The vertical fitter may have shrunk the whole tree; a slot is already
         at the floor, but read the radius back rather than assume it, for the
         same reason the agent records do — the drawn diameter, the leader
         origin and the obstacle box all have to be the same number. */
      const radius = result.radii?.get(plan.id)
      slot.r = Number.isFinite(radius) ? radius : EMPTY_SLOT_RADIUS
      slot.el.style.setProperty('--d', `${slot.r * 2}px`)
      /* Layout positions verbatim, same rule as the agent records above: a
         slot nobody can drag has no nudge to clamp, and the old edge clamps
         pulled clipped rows back INTO view on short canvases — parked on
         top of the row above. Clipped below the fold beats overlapped. */
      slot.x = point.x
      slot.y = point.y
      slot.el.style.left = `${slot.x}px`
      slot.el.style.top = `${slot.y}px`
    }
  }

  /* A REAL BUTTON, not a div wearing role="button".
     The node records above are divs with role and tabindex and a hand-written
     keydown branch for Enter and Space, because they carry a second gesture
     (Shift+Enter opens the controls) and a drag. A slot carries one gesture and
     nothing else, so it can be the element the platform already implements:
     focusable in the tab order, announced as a button, activated by Enter AND
     by Space, with no keyboard code in this file to get wrong. */
  _createEmptySlot(plan) {
    const button = el(`
      <button type="button" class="tree-empty-node" data-empty-kind="${escapeMarkup(plan.kind)}">
        <span class="tree-empty-ring" aria-hidden="true"><span class="tree-empty-mark">+</span></span>
      </button>
    `)
    button.dataset.emptySlot = plan.id
    if (plan.parentId) button.dataset.parentId = plan.parentId
    button.style.setProperty('--d', `${EMPTY_SLOT_RADIUS * 2}px`)
    button.setAttribute('aria-label', plan.name)
    button.setAttribute('title', plan.hint)
    const slot = {
      id: plan.id,
      kind: plan.kind,
      parentId: plan.parentId,
      el: button,
      x: this.W / 2,
      y: this.H / 2,
      r: EMPTY_SLOT_RADIUS,
      hidden: true,
    }
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      /* A click synthesised by Enter or Space on a native button reports
         detail 0; a real pointer click reports at least 1. That is the whole
         difference, and it is worth carrying because whoever opens a panel in
         response needs to know whether to move focus into it. */
      this._pressEmptySlot(slot, event.detail === 0 ? 'keyboard' : 'pointer')
    })
    this.container.appendChild(button)
    this.emptySlots.set(slot.id, slot)
    return slot
  }

  /* REPORT THE PRESS. START NOTHING.
     This file draws a tree; it does not own what an empty slot means. It says
     which slot was pressed, under which parent, in which of this computer's
     trees, and stops. No panel is opened here, no agent is created here, and
     no state on this graph changes — a slot that has been pressed looks exactly
     like a slot that has not, until whoever owns the model changes the model
     and this graph is asked to draw it again. */
  _pressEmptySlot(slot, via) {
    if (this._destroyed) return
    const parent = slot.parentId ? this._agentFor(slot.parentId) : null
    // The parent went away between the draw and the press. Reporting a child
    // of nothing is worse than reporting nothing.
    if (slot.kind === 'child' && !parent) return
    const detail = {
      kind: slot.kind,
      slotId: slot.id,
      parentId: parent ? parent.id : null,
      parent,
      // Which of this computer's trees is being extended: the root the pressed
      // parent hangs from. A new tree has no root yet, so it has no treeId.
      treeId: parent ? (this.ancestryOf(parent.id)[0]?.id ?? parent.id) : null,
      computerId: this.computer?.id ?? null,
      via,
    }
    this.onEmptyPress?.(detail)
    this.container.dispatchEvent(new CustomEvent(TREE_EMPTY_PRESS_EVENT, {
      detail,
      bubbles: true,
    }))
  }

  /* Turn the offer off and on without rebuilding the graph — a mount that has
     no way to act on a press should not draw one. */
  setEmptySlots(on) {
    const next = on !== false
    if (next === this.emptySlotsEnabled) return
    this.emptySlotsEnabled = next
    this._layoutNow()
  }

  /* REDRAW FROM THE MODEL AS IT NOW STANDS.
     The public name for what _reconcile already does, and the answer to "an
     agent was just added, how do I show it": not by rebuilding the graph.
     A rebuild would take the zoom, the pan, the drilled-in root and the
     keyboard focus with it — every one of which the person set on purpose,
     and none of which the new agent is a reason to discard. */
  refresh() {
    if (this._destroyed) return
    this._reconcile()
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
    /* A slot is joined to its parent by the same orthogonal trunk its real
       siblings use, in the same style, in a lighter dashed weight. It has to
       be the same shape of line or the slot stops reading as part of that
       family and starts reading as loose furniture near it; and it has to be
       visibly lighter or it reads as a relationship that exists. Not `soft`:
       soft is the declared-edge whisper, drawn as a straight diagonal, and a
       diagonal here would be the only diagonal on a canvas of elbows. */
    for (const slot of this.emptySlots.values()) {
      if (slot.hidden || !slot.parentId) continue
      const parent = this.nodes.get(slot.parentId)
      if (!paintable(parent)) continue
      links.push({ from: parent, to: slot, soft: false, empty: true, type: 'empty' })
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
      element.setAttribute('class', `tree-link link-top${link.soft ? ' link-soft' : ''}${link.empty ? ' link-empty' : ''}`)
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
    /* From the FLEET layout, never from the drawn one. The drawn layout may
       have culled a handful of empty slots to keep a rank readable, which sets
       its drillRequired flag; reading it here would put "this tree is too big
       to read, drill in" on the screen of somebody whose tree fits perfectly
       and who is only being offered fewer places to extend it. */
    const densityRequiresDrill = !!this._realDrillRequired || active.length >= DENSE_AT
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

  /* ONE CLICK OPENS THE PANEL.
     The rail — the agent's chat, its runtime, and its controls — used to be
     reachable only by DOUBLE clicking a node. A single click drew a selection
     ring and did nothing else, so the owner asking for "a chatbox on the right
     when you click a node" was asking for something that was already built and
     had no discoverable way in. Three fully-built surfaces on this project have
     shipped with nothing routing to them; this was a fourth.
     The double click still opens the rail (src/tree-graph.js _wireNode) and is
     now simply a duplicate of the single click rather than the only way.
     A dense-mode `focusable` node ALSO re-roots, because drilling is what that
     node is for — but it opens the rail too, so the rule a person learns is
     uniform: clicking any node shows that node on the right. */
  handleClick(record) {
    const drills = record.el.classList.contains('focusable')
    if (drills) this.setRoot(record.id)
    else this.select(record.id)
    this.onOpenControls?.(record.agent)
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
    let targetSlot = focusRecord ? this._layoutResult?.slots.get(focusId) : null
    if (focusRecord && !targetSlot) {
      /* The focus record earned NO slot in the new layout (culled, or
         filtered out of the subtree). Preserving it anyway froze it at its
         old coordinates while every connector repainted around it — a stale
         line to a position no layout owns. Re-lay without the preserve so it
         is placed or hidden like any other record; the animation below is
         skipped (no target), and the single _renderLinks at the end paints
         the truth. */
      this._layoutNow()
      targetSlot = this._layoutResult?.slots.get(focusId) ?? null
    }
    const targetOffset = focusId ? this._positions[focusId] || { dx: 0, dy: 0 } : { dx: 0, dy: 0 }
    const target = focusRecord && targetSlot
      ? {
          /* Same containment-and-corridor as _layoutNow — the focus
             animation must land where the next layout would put it, or the
             settle jumps; and an un-nudged focus target is the slot
             itself, exactly. */
          x: clamp(targetSlot.x + targetOffset.dx, Math.min(focusRecord.r + 12, targetSlot.x), Math.max(this.W - focusRecord.r - 12, targetSlot.x)),
          y: clamp(targetSlot.y + targetOffset.dy, ...this._rankCorridor(focusRecord, this._layoutResult, targetSlot.y)),
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
      /* Slots STAY in edit mode (owner defect 4: "keep the gray + nodes").
         The old withdrawal's stated reason — "a slot cannot be dropped on" —
         stopped being true when slot drops became real moves: a child slot
         accepts a node as moveNode(id, slot.parentId), and the new-tree slot
         is the drag-out-to-its-own-tree gesture. Withdrawing them would now
         remove the mode's best drop targets. */
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
      tasks: measuredNumber(supplied?.tasks ?? record.agent.tasksDone),
      failRate: measuredNumber(supplied?.failRate ?? record.agent.failRate),
      model: clean(supplied?.model ?? record.agent.model),
    }
  }

  /* Draw the circle's runtime face from record.agent, idempotently. Called at
     creation AND from _reconcile's existing-node branch, so a status change
     reaches the glass without a remount. The key skips redraws when nothing
     this face reads has changed -- _reconcile runs on every store write, and
     tearing down a ticking clock to rebuild the identical clock would fight
     the very liveness this exists to show. bindRuntime reads record.agent at
     tick time, never the creation-time object: the reconciled agent is the one
     whose clock this is. */
  _renderRuntime(record) {
    const agent = record.agent
    const node = record.el
    const key = `${agent.bornAt}|${agent.stoppedAt}|${agent.state}|${agent.projectionUnavailableReason || ''}`
    if (record.runtimeKey === key) return
    record.runtimeKey = key
    record.runtimeUnsub?.()
    record.runtimeUnsub = null
    const holder = node.querySelector('.node-runtime')
    if (!holder) return
    node.classList.toggle('spawning', agent.state === 'spawning')
    if (Number.isFinite(agent.bornAt)) {
      node.classList.remove('no-telemetry')
      node.removeAttribute('title')
      holder.innerHTML = '<div class="rt">0:00:00</div><div class="rl">Runtime</div>'
      const runtime = holder.querySelector('.rt')
      if (Number.isFinite(agent.stoppedAt)) {
        runtime.textContent = fmtRuntime(agent.bornAt, agent.stoppedAt)
        node.dataset.runtimeState = 'stopped'
      } else {
        record.runtimeUnsub = bindRuntime(runtime, () => record.agent.bornAt)
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
          : agent.state === 'finished' ? 'finished'
            : agent.state === 'failed' ? 'failed'
              : 'no signal'
      holder.innerHTML = `<div class="rt-state">${escapeMarkup(stateWord)}</div><div class="rl">no runtime</div>`
      node.title = `Runtime unavailable · ${agent.projectionUnavailableReason || 'not provided'}`
    }
  }

  /* Repaint ONE chip from the current feed, without the full reconcile.
     refresh() re-lays the whole canvas — the right tool for structure, far too
     heavy per streamed token. The caller frame-batches; this stays narrow. */
  refreshChip(agentId) {
    if (this._destroyed) return
    const record = this.nodes.get(agentId)
    if (!record || !record.chip || record.chatOpen) return
    this._renderChipPreview(record)
    this._placeChips()
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
    /* THE MODEL RIDES WITH THE TELEMETRY; IT DOES NOT STAND IN FOR IT.
       `[tasks, failure, model].filter(Boolean)` meant one declared attribute --
       the provider, which is "none" in the shipped organisation -- was enough to
       make `facts` truthy, so the "telemetry unavailable" line below could never
       be reached on the copy that needs it. Whether this chip has a MEASUREMENT
       is now decided by the measurements alone. */
    const measured = [tasks, failure].filter(Boolean)
    const facts = measured.length ? [...measured, feed.model].filter(Boolean).join(' · ') : ''
    preview.innerHTML = `
      <div class="cl cl-name"><b>${formattedName}</b><span class="chip-runtime"></span></div>
      ${/* THREE WORDS, NOT FIVE. This fallback was unreachable until the line
            above stopped letting the provider stand in for a measurement, so
            nobody had ever seen it rendered: "telemetry unavailable · fleet
            projection" overran the 322px chip and clipped mid-word to
            "TELEMETRY UNAVAILABLE · FLEET PROJECT…". The dropped half is on the
            same screen twice already -- the rail says "not provided by fleet
            projection" in full -- and the chip's own last line says "no
            activity observed". Caught in artifacts/b7, not by an assertion. */''}
      ${facts ? `<div class="cl cl-facts">${escapeMarkup(facts)}</div>` : (feed.chat || feed.previous ? '' : '<div class="cl cl-facts">telemetry unavailable</div>')}
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
    /* A PERSON'S OWN AGENT GETS NO SIMULATOR. buildChat's seeded path was
       measured 2026-08-13 opening on a REAL node: a fabricated conversation
       painted over a genuinely running session. The tree-node card exists
       ONLY when the view supplies a real config (treeChat) whose onSend rides
       the real session — passing onSend is what makes the simulator
       unreachable inside buildChat, the same way the agent page does it. With
       no config, the chip still routes to the rail and fabricates nothing. */
    if (record.agent.treeNode) {
      const config = this.treeChat ? this.treeChat(record.agent) : null
      if (!config || typeof config.onSend !== 'function') {
        this.onOpenControls?.(record.agent)
        return
      }
      /* ONE CHAT OPEN AT A TIME, enforced here because this is the one door.
         Two open cards each guaranteed a slot can cover half the canvas, and
         Escape closing "the topmost" of several was a guess about intent. */
      for (const other of this.nodes.values()) {
        if (other !== record && other.chatOpen) this.closeChat(other)
      }
      this._openChatCard(record, {
        title: config.title,
        subtitle: config.subtitle || '',
        roleKey: config.roleKey || record.agent.role,
        seed: 0,
        history: Array.isArray(config.history) ? config.history : [],
        onSend: config.onSend,
        onAttach: typeof config.onAttach === 'function' ? config.onAttach : null,
        onMention: typeof config.onMention === 'function' ? config.onMention : null,
      })
      return
    }
    this._openChatCard(record, {
      title: record.agent.name,
      subtitle: `${ROLES[record.agent.role]?.label || 'Agent'} · context`,
      roleKey: record.agent.role,
      context: () => record.agent.context,
    })
  }

  /* The card mechanics, shared by the simulated path above and the real
     tree-node path: expand the chip, mount buildChat with whatever config the
     caller vouches for, and let closeChat undo all of it. */
  _openChatCard(record, chatOptions) {
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
    record.chatHeight = chatHeight
    const chat = buildChat({
      ...chatOptions,
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
    record.chatHeight = 0
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
    /* An empty slot is an obstacle exactly like a circle, because it IS a
       circle on this canvas and it is pressable. A context card parked over
       one would both hide it and eat its clicks. */
    for (const slot of this.emptySlots.values()) {
      if (slot.hidden) continue
      const x = this.panX + slot.x * this.zoom
      const y = this.panY + slot.y * this.zoom
      const radius = slot.r * this.zoom
      obstacles.push(expand({ x: x - radius, y: y - radius, w: radius * 2, h: radius * 2 }, 5, 5))
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
      /* offsetHeight is measured DURING the open transition, so an opening
         chat reports the collapsed block's height and the placer sizes a
         368px panel as a 126px one. openChat records the height it asked for;
         that number is what the panel will actually be. */
      const target = record.chatOpen
        ? (record.chatHeight || record.chip.offsetHeight || 368)
        : (record.chip.offsetHeight || SCREEN_CHIP_H)
      const height = Math.min(target, hostHeight - SCREEN_TOP - SCREEN_EDGE)
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
    // …and a leader ruled through an empty slot misattributes the same way one
    // ruled through an agent does, so slots join the discs a leader must clear.
    for (const slot of this.emptySlots.values()) {
      if (slot.hidden) continue
      discs.push({
        id: slot.id,
        x: this.panX + slot.x * this.zoom,
        y: this.panY + slot.y * this.zoom,
        r: slot.r * this.zoom + 4,
      })
    }
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
      /* AN OPEN CHAT IS NEVER WITHHELD.
         Withholding a COLLAPSED monitoring block the placer cannot attach
         cleanly is right, and _chipCandidates explains why. An open chat is
         not an annotation the reader has to attribute — it is the panel a
         person just clicked for, it carries the agent's name in its own
         title, and it draws a leader to its own circle.
         Measured on the shipped build, by OS-level click rather than a
         synthetic one, at 1360x700 and at 1024x700, on every node tried:
         clicking a monitoring block built the chat and then left the whole
         block at opacity 0 / visibility hidden / pointer-events none. The
         click looked like it did nothing. A 360x368 panel simply does not fit
         the "immediately beside the circle, clear of every obstacle" rule the
         126px-tall collapsed block is placed by, so election returned no slot
         and the branch below hid it. The page's own driver could not catch it:
         it waited for the chat ELEMENT and then passed a hardcoded true for
         whether anyone could see it (tools/page2-qa.cjs).
         So an open chat gets a guaranteed seat instead of no seat. It may
         cover a neighbour; that is what a panel opened on purpose is allowed
         to do, and it closes on its own button or on Escape. */
      let selected = slots.get(record.id)
      if (!selected && record.chatOpen) {
        selected = this._forcedChatSlot(record, dimensions.get(record.id), hostWidth, hostHeight)
      }
      if (!selected) {
        chip.classList.remove('screen-chip-visible')
        record.chipLeader.classList.remove('visible')
        record.chipLeaderDot?.classList.remove('visible')
        continue
      }
      chip.classList.add('screen-chip-visible')
      record.chipLeader.classList.add('visible')
      record.chipLeaderDot?.classList.add('visible')
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

  /* The seat an open chat gets when election found none: the side of its own
     node with more room, vertically centred on it, clamped inside the canvas
     so no part of the panel can land off-screen. Deliberately NOT a search —
     a search is what already failed, and a panel the person is waiting for is
     owed a definite answer rather than a better-placed absence. */
  _forcedChatSlot(record, dimension, hostWidth, hostHeight) {
    const width = Math.min(dimension?.width || SCREEN_CHAT_W, Math.max(120, hostWidth - SCREEN_EDGE * 2))
    const height = Math.min(
      dimension?.height || record.chatHeight || 368,
      Math.max(120, hostHeight - SCREEN_TOP - SCREEN_EDGE),
    )
    const x = this.panX + record.x * this.zoom
    const y = this.panY + record.y * this.zoom
    const radius = record.r * this.zoom
    const maxX = Math.max(SCREEN_EDGE, hostWidth - width - SCREEN_EDGE)
    const maxY = Math.max(SCREEN_TOP, hostHeight - height - SCREEN_EDGE)
    const rightEdge = x + radius + 14
    const leftEdge = x - radius - 14 - width
    const roomRight = hostWidth - SCREEN_EDGE - rightEdge
    const roomLeft = leftEdge - SCREEN_EDGE
    return {
      x: clamp(roomRight >= roomLeft ? rightEdge : leftEdge, SCREEN_EDGE, maxX),
      y: clamp(y - height / 2, SCREEN_TOP, maxY),
      w: width,
      h: height,
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
       on the last tier's labels at 1440 and read as debris on the tree. The
       row lives in the pane BAR now, a sibling of the canvas slot this graph
       zooms in — so the lookup climbs to the pane (.graph-wrap) first and
       falls back to the host for embedders with no bar. */
    const pane = this.zoomHost.closest('.graph-wrap')
    const tools = (pane || this.zoomHost).querySelector('.graph-tools')
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
      const previous = this.zoom
      const next = clamp(this.zoom * Math.exp(-delta * 0.0022), ZOOM_MIN, ZOOM_MAX)
      this.zoom = next
      this.panX = screenX - graphX * next
      this.panY = screenY - graphY * next
      this._clampPan()
      this._applyZoom()
      /* Zoom-to-focus: see the constants' comment. Crossings only, so holding
         the wheel above the threshold does not re-drill on every notch. */
      if (next >= ZOOM_DRILL_AT && previous < ZOOM_DRILL_AT && !this.rootId) {
        const nearest = this._nearestRecordTo(graphX, graphY, DRILL_RADIUS)
        if (nearest) {
          this.setRoot(nearest.id)
          this.resetZoom()
        }
      } else if (next <= ZOOM_DRILL_OUT_AT && previous > ZOOM_DRILL_OUT_AT && this.rootId) {
        this.clearRoot()
        this.resetZoom()
      }
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
    for (const slot of this.emptySlots.values()) slot.el.remove()
    this.emptySlots.clear()
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
