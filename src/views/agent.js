// Agent page — the selected agent's branch up top; Chat | Controls panels
// below, horizontally scroll-snapped exactly like the whiteboard.

import { sim } from '../sim.js'
import { ROLES } from '../vocab.js'
import { el, uptimeRing, buildChat } from '../components.js'
import { FleetGraph, CHIP_W, CHIP_H } from '../graph.js'
import { readLayout } from '../layout-pref.js'
import { isLiveView } from '../live-flags.js'
import { createTerminateController } from '../mission-bridge.js'
import { mountAgentWriteSurface } from '../write-surfaces.js'
import { mountAgentSessionSurface } from '../agent-session.js'
import { fetchAgents } from '../live-status.js'
import { rangeFill } from './computers.js'
import '../agent.css'

const SVG_NS = 'http://www.w3.org/2000/svg'
// three short arcs scattered around the rim, matching the sketch's marks —
// each pair is [startDeg, endDeg] measured from the box center (0deg = +x axis)
const RIM_ARCS = [[-52, -30], [122, 144], [212, 234]]

// Module-level (not per-view-instance) so once the user scrolls the panel
// row once, the scroll cue stays gone across navigating away from and back
// to any agent page — criterion 2 requires "permanently", not per-visit.
let panelsCueDismissed = false

/* Normalize the one runtime source shared by FleetGraph and the controls
   ring. A terminal control target without its exact stop epoch fails closed;
   a finite stoppedAt is the only value allowed to freeze elapsed time. */
export function liveAgentRuntimeSource(agent, observedAt = Date.now()) {
  const bornAt = Number.isFinite(agent?.bornAt) ? agent.bornAt : null
  if (bornAt === null) return null
  const stoppedAt = Number.isFinite(agent?.stoppedAt) ? agent.stoppedAt : null
  const terminalWithoutStop = (agent?.controlTarget?.status === 'finished'
    || agent?.controlTarget?.status === 'failed') && stoppedAt === null
  if (terminalWithoutStop) return null
  return {
    bornAt,
    stoppedAt,
    elapsedMs: Math.max(0, (stoppedAt ?? observedAt) - bornAt),
    running: stoppedAt === null,
  }
}

/* Runtime telemetry is optional, and its decorative ring must be optional too.
   Keep a missing or malformed mount from aborting the rest of the agent view,
   especially the live controls that own the Terminate action. */
export function appendAgentRingNode(parent, child) {
  try {
    if (!parent || !child || typeof parent.appendChild !== 'function') return false
    parent.appendChild(child)
    return true
  } catch {
    return false
  }
}

/* The agent projection deliberately separates declared topology from observed
   sessions.  Session ids are opaque and the contract gives us no safe bridge
   from one to a declared agent, so this adapter never turns one into a
   per-agent runtime, chat, task count, or zero.  FleetGraph still owns the
   tree/physics/edit interaction; it receives only an in-memory, declared
   topology for this one drill-in. */
function projectionRole(role) {
  return ({ controller: 'coordinator', 'coordinator-assistant': 'helper', manager: 'manager' })[role]
    || (Object.hasOwn(ROLES, role) ? role : 'default')
}

function relationshipLabel(relationship, id, declaredById) {
  const outgoing = relationship.from === id
  const otherId = outgoing ? relationship.to : relationship.from
  const other = declaredById.get(otherId)
  if (!other) return null
  const name = other.displayName
  const labels = {
    manages: outgoing ? `manages ${name}` : `managed by ${name}`,
    reviews: outgoing ? `reviews ${name}` : `reviewed by ${name}`,
    delegates_to: outgoing ? `delegates to ${name}` : `delegated by ${name}`,
    escalates_to: outgoing ? `escalates to ${name}` : `escalated by ${name}`,
  }
  return labels[relationship.type] || null
}

function declaredAgentProjection(compId, agentId, data) {
  const declared = Array.isArray(data?.declared) ? data.declared : []
  const declaredById = new Map(declared.map(agent => [agent.id, agent]))
  const selected = declaredById.get(agentId)
  if (!selected) return null

  const relationships = (Array.isArray(data?.relationships) ? data.relationships : [])
    .filter(relationship => (relationship.from === agentId || relationship.to === agentId)
      && declaredById.has(relationship.from) && declaredById.has(relationship.to))
  const relatedIds = [...new Set(relationships.map(relationship => (
    relationship.from === agentId ? relationship.to : relationship.from
  )))]
  const labelsFor = (id) => relationships
    .map(relationship => relationshipLabel(relationship, id, declaredById))
    .filter(Boolean)

  const asGraphAgent = (declaredAgent, parentId = null) => {
    const labels = labelsFor(declaredAgent.id)
    const runtime = liveAgentRuntimeSource(declaredAgent)
    return {
      id: declaredAgent.id,
      name: declaredAgent.displayName,
      // FleetGraph's role vocabulary is visual-only here. The exact declared
      // role remains in the strip, controls rail, and the node's visible row.
      role: projectionRole(declaredAgent.role),
      declaredRole: declaredAgent.role,
      parentId,
      state: declaredAgent.enabled ? 'active' : 'inactive',
      bornAt: runtime?.bornAt ?? null,
      stoppedAt: runtime?.stoppedAt ?? null,
      projectionUnavailableReason: 'not provided by agents projection',
      model: declaredAgent.provider,
      pool: 'declared',
      // Preserve only the selected declared agent's exact schema-validated
      // target. Related nodes stay topology-only, and no runtime target is
      // synthesized from their ids, declared state, or observed sessions.
      ...(declaredAgent.id === agentId ? { controlTarget: declaredAgent.controlTarget } : {}),
      context: [
        `Declared · ${declaredAgent.enabled ? 'enabled' : 'disabled'} · ${declaredAgent.provider}`,
        labels.length ? `Relationship · ${labels.join('; ')}` : 'No declared relationship',
      ],
    }
  }

  const agent = asGraphAgent(selected)
  const computer = {
    // `compId` is retained as the route scope only. agents.json does not
    // declare a computer mapping, so this does not invent one.
    id: compId,
    name: `${compId} · declared topology`,
    agents: [agent, ...relatedIds.map(id => asGraphAgent(declaredById.get(id), agent.id))],
  }
  return {
    computer,
    agent,
    relationshipCount: relationships.length,
    sessionState: data?.observedSessions?.ok ? 'unmapped' : 'unavailable',
  }
}

function arcPath(cx, cy, r, a0, a1) {
  const rad = (d) => (d * Math.PI) / 180
  const sx = cx + r * Math.cos(rad(a0)), sy = cy + r * Math.sin(rad(a0))
  const ex = cx + r * Math.cos(rad(a1)), ey = cy + r * Math.sin(rad(a1))
  return `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${r} ${r} 0 0 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`
}

/** Build the small orange rim-activity-arc overlay for one child bubble. */
function buildRim() {
  const wrap = document.createElement('div')
  wrap.className = 'node-rim'
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 100 100')
  svg.setAttribute('class', 'rim-svg')
  for (const [a0, a1] of RIM_ARCS) {
    const p = document.createElementNS(SVG_NS, 'path')
    p.setAttribute('class', 'rim-arc')
    p.setAttribute('d', arcPath(50, 50, 54, a0, a1))
    svg.appendChild(p)
  }
  wrap.appendChild(svg)
  return wrap
}

// --- criterion 1 (ESC fix round): the revealed chip must never overlap ANY
// node's bubble or its name/role labels — its own node very much included.
// graph.js's own per-tick placement (read-only this wave) only reasons about
// the canvas edges, so once a chip is revealed (agent.css opacity + the badge
// below) this module places exactly that chip itself, every frame.
//
// The previous round fed every footprint — own node included — into a single
// "whichever candidate overlaps least wins" score over eight compass slots.
// In this page's ~240px-tall strip a 168x56 chip collides with all eight, so
// it silently settled on a visibly overlapping slot (chips sitting on their
// own COORDINATOR'S HELPER role row, or on a neighbour's name+role block).
// Clearance became a HARD constraint, never a cost, and stays one here: a
// candidate is only ever accepted if it clears every bubble disc and every
// label rect outright.
//
// Everything is measured in the graph's own untransformed local coordinates —
// bubble center/radius come straight from graph.nodes (never re-derived from
// a transform string), label extents from offsetWidth/offsetTop (transform-
// immune) — so this stays correct at any C3 zoom/pan level, not only at rest.
// graph.js's own radial math is never edited; while a chip is open it is
// simply positioned in left/top instead, and agent.css parks the transform
// for that one element so the two writers cannot race within a frame.
function rectsOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

// styles.css grows the PAINTED bubble under the pointer (.node:hover
// .node-glass → scale(1.045), .node.dragging → 1.07) and revealing a chip
// ALWAYS hovers its own node, since the .cx-badge lives inside .node — so
// the disc to clear is the grown one, never the unscaled rec.r (that gap is
// exactly the ~1.2px grazes the gate measured on otherwise clear slots).
// CLEAR_PAD then keeps a hairline of air so "just touching" still reads as
// clear at any device pixel ratio.
const BUBBLE_SCALE = 1.07
const CLEAR_PAD = 3

/** Bubble disc + node-name/node-role label rects of one graph.nodes record,
 *  in local graph-canvas coordinates, each already inflated by the paint-time
 *  scale and the safety pad.
 *
 *  `labelMetrics` (idle-burn audit): offsetWidth/offsetHeight/offsetTop are
 *  live layout reads, and this used to pay up to six of them per node per
 *  FRAME to rebuild rects for labels whose text never changes while the node
 *  stands — most of the forced synchronous layout the audit measured on this
 *  page. The measured w/h/offsetTop go in a per-view cache keyed by node id +
 *  bubble radius (offsetTop is measured from the bubble box, so a radius
 *  change re-measures); positions stay live because rec.x/y are plain JS
 *  state from graph.js — a moving node still tracks per frame for free. */
function nodeObstacle(rec, labelMetrics) {
  const key = `${rec.id}@${rec.r}`
  let m = labelMetrics.get(key)
  if (!m) {
    m = []
    // only cache a COMPLETE measurement — a detached/not-yet-laid-out label
    // reads 0, and freezing that would blind the solver to it forever
    let complete = true
    for (const sel of ['.node-name', '.node-role']) {
      const label = rec.el.querySelector(sel)
      if (!label) continue
      const w = label.offsetWidth, h = label.offsetHeight
      if (!w || !h) { complete = false; continue }
      // node-name/node-role are centered under the bubble via left:50% +
      // translateX(-50%) — the translate is paint-only, so their true visual
      // left edge is rec.x - w/2, not anything offsetLeft would report. .node
      // shrink-wraps .node-glass, so offsetTop is measured from rec.y - rec.r.
      m.push({ w, h, top: label.offsetTop })
    }
    if (complete) labelMetrics.set(key, m)
  }
  // The bubble's own SQUARE box as well as its disc. .node shrink-wraps
  // .node-glass, so that square is the element's real hit box — the corners
  // outside the circle are still part of the bubble as far as anything reading
  // the DOM is concerned, and a box tucked into one reads as touching even
  // when the painted circle is technically clear. The disc stays because it is
  // wider than the square at the midpoints once the hover scale is applied.
  const labels = [{
    left: rec.x - rec.r - CLEAR_PAD, right: rec.x + rec.r + CLEAR_PAD,
    top: rec.y - rec.r - CLEAR_PAD, bottom: rec.y + rec.r + CLEAR_PAD,
  }]
  for (const { w, h, top: ot } of m) {
    const top = rec.y - rec.r + ot
    labels.push({
      left: rec.x - w / 2 - CLEAR_PAD, right: rec.x + w / 2 + CLEAR_PAD,
      top: top - CLEAR_PAD, bottom: top + h + CLEAR_PAD,
    })
  }
  return { cx: rec.x, cy: rec.y, cr: rec.r * BUBBLE_SCALE + CLEAR_PAD, labels }
}

/** True when `box` clears one obstacle: circle-aware against the painted
 *  bubble disc (a rect corner may legitimately sit inside the disc's bounding
 *  box), plain rect-vs-rect against the label rows. */
function boxClearsObstacle(box, ob) {
  const nx = Math.max(box.left, Math.min(ob.cx, box.right))
  const ny = Math.max(box.top, Math.min(ob.cy, box.bottom))
  const dx = ob.cx - nx, dy = ob.cy - ny
  if (dx * dx + dy * dy < ob.cr * ob.cr) return false
  for (const lb of ob.labels) if (rectsOverlap(box, lb)) return false
  return true
}

function boxClearsAll(box, obstacles) {
  for (const ob of obstacles) if (!boxClearsObstacle(box, ob)) return false
  return true
}

const boxAt = (x, y, cw, ch) => ({ left: x, top: y, right: x + cw, bottom: y + ch })

/* ---------------------------------------------------------------------------
   BAND placement.

   The search this replaces was a ring sweep outward from each node, then an
   exhaustive grid, first-clear-wins, one box at a time in left-to-right node
   order. It was collision-correct and spatially poor, for two reasons that are
   both about the SHAPE of the free space rather than about the search:

     · A ring sweep asks "how far from my bubble is the nearest hole", so an
       early box happily takes a hole in the middle of a run and cuts that run
       in two — leaving two 100px gaps where one 224px box would have fit. At
       1440 and 1280 the last two boxes then had nowhere to go at all and were
       withheld: 3 of 5 shown, which is the visible symptom.
     · Greedy in order cannot trade. The box that reaches a hole first keeps
       it even when a later box needed it far more, so total leader length was
       whatever the arrival order happened to produce — 244px mean, 482px max.

   This is a TREE layout, and that is worth exploiting. Every bubble sits on
   one of a handful of tier rows, so the canvas's free space is not a scatter
   of pockets: it is a few horizontal BANDS, each interrupted at known x by the
   bubbles and labels of the rows it passes. Measured on this page the only
   band tall enough for a 224x74 box is the one above the top tier — roughly
   6..134 at every viewport — and the boxes are competing for lanes inside it.

   So: scan the canvas as horizontal lanes, solve each lane's free x-runs in
   closed form, and choose all the boxes' slots TOGETHER, minimising total
   leader length. Since the free space is described as runs rather than sampled
   points, boxes pack against each other instead of stranding gaps, and a box
   is only withheld when the arithmetic says no arrangement fits it.
   --------------------------------------------------------------------------- */
const EDGE = 6           // canvas margin no box crosses
const LANE_STEP = 6      // vertical resolution of the lane scan
const CHIP_GAP = 10      // air between two boxes sharing a lane
// A run's edge is, by construction, the exact point where a box grazes an
// obstacle — and `sqrt` then square does not round-trip, so a slot clamped to
// that edge can fail the very clearance test that produced it. Half a pixel of
// slack on every blocked span keeps the closed-form answer on the safe side of
// the check that ultimately decides whether a box paints.
const SPAN_EPS = 0.5
// Withholding a box is a legal move, not a failure state — it has to be, on a
// canvas with four pockets and five boxes. Priced above any real leader the
// 360px-tall strip can produce, so the solver spends it only when it must.
const WITHHOLD_COST = 4000
// Past roughly its own width, a box stops reading as attached to a bubble and
// starts being something you have to trace a line to. Used as the bar the full
// preview has to clear before the strip is allowed to keep it (see below).
/* The leader length past which a box counts as stranded from its bubble and
   the strip is better off compact. Deliberately NOT CHIP_W any more.
   At CHIP_W (224) this fired at every width below 1920, and measured against
   what the box is for that was the wrong trade: it bought a mean leader of
   117px and paid for it by cutting EVERY activity line to about half
   ("probing tunnel lan...", "indexing memory namespac..."), while letting it
   ride cost mean 174 and cut none. A reader who can see the whole sentence
   knows what the agent is doing; 174px of hairline to the bubble directly
   below is not a hunt. 1.6x still catches a genuinely stranded box, and the
   other trigger — a box withheld entirely — is untouched, so a canvas that
   really cannot hold five full boxes still compacts rather than losing one. */
const ATTACHED_REACH = Math.round(CHIP_W * 1.6)

/** The x-interval of box LEFT edges that `ob` forbids for a row spanning
 *  [y, y+ch]. The box width is folded in, so the result is directly a
 *  forbidden range for x. null when the row misses the obstacle entirely.
 *  The bubble term is the exact circle-vs-row chord, not the disc's bounding
 *  box: near the top of the band the root bubble only steals about half the
 *  width its bbox would claim, and that half is the difference between three
 *  boxes fitting to the left of it and two. */
function blockedSpan(ob, y, ch, cw) {
  let lo = Infinity, hi = -Infinity
  if (ob.cr > 0) {
    const dv = Math.max(0, y - ob.cy, ob.cy - (y + ch))
    if (dv < ob.cr) {
      const hx = Math.sqrt(ob.cr * ob.cr - dv * dv)
      lo = ob.cx - hx - cw
      hi = ob.cx + hx
    }
  }
  for (const lb of ob.labels) {
    if (lb.bottom <= y || lb.top >= y + ch) continue
    lo = Math.min(lo, lb.left - cw)
    hi = Math.max(hi, lb.right)
  }
  return hi > lo ? [lo - SPAN_EPS, hi + SPAN_EPS] : null
}

/** Free left-edge runs for a box row at `y`: [a, b] means every x in [a, b]
 *  puts a cw x ch box clear of every obstacle at that height. */
function laneRuns(y, cw, ch, obstacles, minX, maxX) {
  const spans = []
  for (const ob of obstacles) {
    const s = blockedSpan(ob, y, ch, cw)
    if (s) spans.push(s)
  }
  spans.sort((a, b) => a[0] - b[0])
  const runs = []
  let cur = minX
  for (const [lo, hi] of spans) {
    if (cur > maxX) break
    if (lo > cur) runs.push([cur, Math.min(lo, maxX)])
    if (hi > cur) cur = hi
  }
  if (cur <= maxX) runs.push([cur, maxX])
  return runs
}

/** Every lane that can hold a box of this height, top to bottom. */
function buildLanes(cw, ch, obstacles, canvasW, canvasH) {
  const minX = EDGE, maxX = canvasW - cw - EDGE
  const lanes = []
  if (maxX < minX) return lanes
  for (let y = EDGE; y <= canvasH - ch - EDGE; y += LANE_STEP) {
    const runs = laneRuns(y, cw, ch, obstacles, minX, maxX)
    if (runs.length) lanes.push({ y, runs })
  }
  return lanes
}

/** Runs minus the shadow an already-chosen box casts on this lane. */
function subtractSpan(runs, lo, hi) {
  const out = []
  for (const [a, b] of runs) {
    if (hi <= a || lo >= b) { out.push([a, b]); continue }
    if (lo > a) out.push([a, lo])
    if (hi < b) out.push([hi, b])
  }
  return out
}

/** The slots worth trying for one box, given what is already placed.
 *  Three per (lane, run): the position nearest its own bubble, and both ends
 *  of the run. The ends matter more than they look — "shove up against the end
 *  of the run so the next box still has somewhere to go" is a move a
 *  nearest-point-only candidate set cannot express at all, and without it a
 *  box that could have shared the row gets exiled to a far corner that happens
 *  to be free. Deduped and truncated to `limit`, so the branching stays a
 *  handful of genuinely different options rather than a dozen near-copies from
 *  adjacent lanes. */
function slotCandidates(item, lanes, taken, cw, limit, mayWithhold) {
  const out = []
  const seen = new Set()
  for (const lane of lanes) {
    let runs = lane.runs
    for (const t of taken) {
      if (!t.box || t.box.y + t.box.ch <= lane.y || t.box.y >= lane.y + item.ch) continue
      runs = subtractSpan(runs, t.box.x - cw - CHIP_GAP, t.box.x + cw + CHIP_GAP)
      if (!runs.length) break
    }
    for (const [a, b] of runs) {
      for (const x of [Math.min(Math.max(item.idealX, a), b), a, b]) {
        const tag = `${Math.round(x / 8)}:${Math.round(lane.y / 12)}`
        if (seen.has(tag)) continue
        seen.add(tag)
        out.push({
          box: { x, y: lane.y, ch: item.ch },
          cost: Math.hypot(x + cw / 2 - item.rec.x, lane.y + item.ch / 2 - item.rec.y),
        })
      }
    }
  }
  out.sort((p, q) => p.cost - q.cost)
  const picked = []
  for (const c of out) {
    if (picked.some(p => Math.abs(p.box.x - c.box.x) < cw * 0.25 &&
                         Math.abs(p.box.y - c.box.y) < item.ch * 0.5)) continue
    picked.push(c)
    if (picked.length >= limit) break
  }
  if (mayWithhold) picked.push({ box: null, cost: WITHHOLD_COST })
  return picked
}

/** Choose slots for every box at once, minimising total leader length.
 *  Depth-first over the boxes in left-to-right node order (so the packing
 *  inside a run reads in the same order as the bubbles it describes), bounded
 *  by each box's conflict-free floor cost — an admissible bound, so the first
 *  complete arrangement it cannot beat ends the search rather than merely
 *  ranking below it.
 *
 *  Run twice, and in this order deliberately. Withholding is priced high but
 *  it is still a branch, and a branch that constrains nothing below it: with
 *  it available from the start the tree is wide enough that the walk can spend
 *  its whole budget in arrangements that give a box up, and return one of
 *  those. So the first pass simply forbids it — every complete arrangement it
 *  finds shows all five boxes — and only a canvas where that is arithmetically
 *  impossible pays for the second, wider search. */
function solveBands(items, lanesFor, cw) {
  const floors = items.map((it) => {
    let best = WITHHOLD_COST
    for (const lane of lanesFor(it.ch)) {
      for (const [a, b] of lane.runs) {
        const x = Math.min(Math.max(it.idealX, a), b)
        best = Math.min(best, Math.hypot(x + cw / 2 - it.rec.x, lane.y + it.ch / 2 - it.rec.y))
      }
    }
    return best
  })
  const tail = new Array(items.length + 1).fill(0)
  for (let i = items.length - 1; i >= 0; i--) tail[i] = tail[i + 1] + floors[i]

  const search = (mayWithhold, limit) => {
    let bestCost = Infinity, best = null, budget = 8000
    const chosen = []
    const walk = (i, total) => {
      if (total + tail[i] >= bestCost) return
      if (i === items.length) { bestCost = total; best = chosen.map(c => c.box); return }
      if (budget-- <= 0) return
      for (const c of slotCandidates(items[i], lanesFor(items[i].ch), chosen, cw, limit, mayWithhold)) {
        if (total + c.cost + tail[i + 1] >= bestCost) break
        chosen.push(c)
        walk(i + 1, total + c.cost)
        chosen.pop()
      }
    }
    walk(0, 0)
    return best
  }
  return search(false, 6) || search(true, 5) || items.map(() => null)
}

export function agentView(args) {
  if (!isLiveView('agent')) return buildAgentView(args)

  const root = el('<div class="data-live-mode" data-live-mode="live"></div>')
  const showState = (title, reason = '', loading = false) => {
    const state = el(`<div class="projection-state ${loading ? 'is-loading' : 'projection-unavailable'}" role="status"><strong></strong><span></span></div>`)
    state.querySelector('strong').textContent = title
    state.querySelector('span').textContent = reason
    root.replaceChildren(state)
  }
  showState('Declared agent projection', 'reading live projection…', true)
  let destroyed = false
  let current = null
  void fetchAgents().then((result) => {
    if (destroyed) return
    const projection = result.ok ? declaredAgentProjection(args.compId, args.agentId, result.data?.data) : null
    if (!projection) {
      showState(
        result.ok ? 'Declared agent unavailable' : 'Agent projection unavailable',
        result.ok ? `no declared agent matches ${args.agentId}` : result.reason,
      )
      return
    }
    current = buildAgentView(args, projection)
    root.replaceChildren(current.el)
  }).catch((error) => {
    if (!destroyed) showState('Agent projection unavailable', error?.message || String(error))
  })

  return {
    el: root,
    destroy() {
      destroyed = true
      current?.destroy()
    },
  }
}

function buildAgentView({ compId, agentId, navigate }, projection = null) {
  const live = Boolean(projection)
  const { computer, agent } = projection || sim.agentOf(compId, agentId)
  if (!computer || !agent) {
    const back = el(`<div class="view-pad"><p style="color:var(--ink-3);padding-top:40px">Agent no longer running.</p></div>`)
    setTimeout(() => navigate('#/computers'), 1200)
    return { el: back, destroy() {} }
  }
  const role = ROLES[agent.role] || ROLES.default
  const declaredRole = live ? agent.declaredRole : role.label
  const sessionState = projection?.sessionState
  const declaredState = live ? (agent.state === 'active' ? 'Enabled' : 'Disabled') : 'Simulated'
  const declaredStateNote = live ? 'Declared state' : 'No declared state'

  const root = el(`
    <div class="agentv" data-live-mode="${live ? 'live' : 'simulated'}">
      <div class="agentv-graph glass">
        <div class="graph-crumb"></div>
      </div>
      <div class="agent-strip">
        <span class="as-name">${agent.name}</span>
        <span class="as-sep">·</span><span>${role.label}</span>
        <span class="as-sep">·</span><span>${agent.pool}</span>
        <span class="as-sep">·</span><span>${agent.model}</span>
      </div>
      <div class="panel-dots">
        <button type="button" class="pdot active" data-i="0"><span></span>Chat</button>
        <button type="button" class="pdot" data-i="1"><span></span>Controls</button>
      </div>
      <div class="agentv-panels-wrap">
        <div class="scroll-cue${panelsCueDismissed ? ' gone' : ''}">scroll<svg width="14" height="14" viewBox="0 0 24 24"><path d="M9.5 5.5 16 12l-6.5 6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></div>
        <div class="agentv-panels">
          <section class="apanel glass chat-panel"><div class="apanel-title">Chat</div></section>
          <!-- CONTROLS. The panel is ~316px tall at 1600x900 and ~227px at
               1280x800; its content needs 561px, so this panel scrolls at
               every viewport the app ships on — that is a fact of the layout,
               not something to hide. What was broken was that the scroll was
               INVISIBLE: no scrollbar, no mask, no cue, so at 1600x900
               Respawn/Terminate showed 7px of their 40px on the panel's
               bottom edge and at 1280x800 all four buttons sat entirely below
               it — the panel read as a title, a ring and 90px of nothing.
               So the four primary actions leave the scroller and become a
               pinned action row (always whole, never straddling the fold),
               and what remains scrolls behind a thin themed scrollbar and a
               bottom fade. The name/role header and the "model · pool" line
               went with them (82px of the 561): the .agent-strip immediately
               above already reads "name · role · pool · model" and the chat
               panel beside it repeats the name again, so the tightest panel
               on the site was spending a third of its visible height on its
               fourth copy of the same four words. -->
          <section class="apanel glass ctl-panel">
            <div class="apanel-title">Controls</div>
            <div class="rail-scroll">
              <!-- Controls above the dial, on purpose. With the dial first,
                   every viewport below ~1700px opened this panel on a section
                   heading with nothing under it — "TUNING" announcing rows
                   that lived below the fold (201px window vs 341px content at
                   1440/1600; at 1280 the heading itself was under the fold).
                   The sliders are the panel's JOB; the dial is decoration and
                   repeats the runtime the agent's own bubble already shows —
                   so the decoration is what scrolls. -->
              <div class="rail-sec">Tuning</div>
              <!-- The visible name of each slider is a SIBLING span, not a
                   label, so all three reported no accessible name at all —
                   a screen reader announced "slider, 62 / 35 / 20" three
                   times with nothing to tell them apart. A wrapping <label>
                   (the drawer's pattern) would swallow the trailing value
                   span into the name too, so these carry the name outright
                   and leave the value to the slider itself. -->
              <div class="ctl-row"><span class="cl">Context budget</span><input type="range" aria-label="Context budget" min="0" max="100" value="62"/><span class="cv">124k</span></div>
              <div class="ctl-row"><span class="cl">Wake interval</span><input type="range" aria-label="Wake interval" min="0" max="100" value="35"/><span class="cv">20m</span></div>
              <div class="ctl-row"><span class="cl">Verbosity</span><input type="range" aria-label="Verbosity" min="0" max="100" value="20"/><span class="cv">low</span></div>
              <div class="agent-ring-wrap"></div>
            </div>
            <div class="ctl-grid ctl-actions">
              <div class="ctl-btn ctl-declared-state" data-control="declared-state" aria-label="Declared state: ${declaredState}">
                <span class="ctl-label">${declaredState}</span><span class="ctl-note">${declaredStateNote}</span>
              </div>
              <button type="button" class="ctl-btn" data-control="pause" disabled aria-label="Pause unavailable: no bridge action exists.">
                <span class="ctl-label">Pause</span><span class="ctl-note">Unavailable</span>
              </button>
              <button type="button" class="ctl-btn" data-control="respawn" disabled aria-label="Respawn unavailable: no bridge action exists.">
                <span class="ctl-label">Respawn</span><span class="ctl-note">Unavailable</span>
              </button>
              <button type="button" class="ctl-btn danger" data-control="terminate" disabled>
                <span class="ctl-label">Terminate</span><span class="ctl-note">Unavailable</span>
              </button>
            </div>
            <div class="ctl-result" data-phase="unavailable" role="status" aria-live="polite"></div>
          </section>
        </div>
      </div>
    </div>
  `)
  const destroyWriteSurface = mountAgentWriteSurface(root, { agentId })
  const destroyAgentSession = mountAgentSessionSurface(root, { agentId })
  const terminateButton = root.querySelector('[data-control="terminate"]')
  const terminateLabel = terminateButton.querySelector('.ctl-label')
  const terminateNote = terminateButton.querySelector('.ctl-note')
  const terminateResult = root.querySelector('.ctl-result')
  const renderTerminateState = (state) => {
    terminateButton.disabled = !state.enabled
    terminateButton.dataset.phase = state.phase
    terminateButton.classList.toggle('is-confirming', state.phase === 'confirm')
    terminateButton.classList.toggle('is-pending', state.phase === 'pending')
    terminateButton.classList.toggle('is-success', state.phase === 'success')
    terminateLabel.textContent = state.label
    terminateNote.textContent = state.note
    terminateButton.setAttribute('aria-label', `${state.label}. ${state.message}`)
    terminateResult.dataset.phase = state.phase
    terminateResult.textContent = state.message
  }
  const terminateController = createTerminateController({
    live,
    selectedAgentId: agent.id,
    controlTarget: live ? agent.controlTarget : null,
    onState: renderTerminateState,
  })
  const onTerminateClick = () => { void terminateController.click() }
  terminateButton.addEventListener('click', onTerminateClick)
  let runtimeRingMount = root.querySelector('.agent-ring-wrap')

  if (live) {
    root.classList.add('data-live-mode')
    root.dataset.liveMode = 'live'
    const strip = root.querySelector('.agent-strip')
    strip.replaceChildren()
    for (const text of [agent.name, declaredRole, agent.model, agent.state === 'active' ? 'enabled' : 'disabled']) {
      if (strip.childElementCount) {
        const sep = document.createElement('span')
        sep.className = 'as-sep'
        sep.textContent = '·'
        strip.appendChild(sep)
      }
      const field = document.createElement('span')
      if (!strip.childElementCount) field.className = 'as-name'
      field.textContent = text
      strip.appendChild(field)
    }

    const rail = root.querySelector('.ctl-panel .rail-scroll')
    rail.replaceChildren()
    rail.appendChild(el('<div class="rail-sec">Projection</div>'))
    const rows = [
      ['Declared state', agent.state === 'active' ? 'enabled' : 'disabled'],
      ['Provider', agent.model],
      ['Relationships', `${projection.relationshipCount} declared`],
      ['Observed sessions', sessionState],
    ]
    for (const [label, value] of rows) {
      const row = el('<div class="ctl-row"><span class="cl"></span><span class="cv"></span></div>')
      row.querySelector('.cl').textContent = label
      row.querySelector('.cv').textContent = value
      if (label === 'Observed sessions') {
        row.classList.add('projection-state')
        if (sessionState === 'unavailable') row.classList.add('projection-unavailable')
      }
      rail.appendChild(row)
    }
    runtimeRingMount = el('<div class="agent-ring-wrap"></div>')
    if (!appendAgentRingNode(rail, runtimeRingMount)) runtimeRingMount = null
  }

  // subtree graph, rooted at this agent, chips on every bubble
  const canvas = el(`<div style="position:absolute;inset:0"></div>`)
  // A context box placed clear of every bubble can end up far from the agent
  // it describes, which makes "which box is whose" a puzzle. One hairline
  // from the box back to its own bubble answers that instantly, and costs
  // nothing at rest — the layer is empty until a chip is placed.
  const cxLinks = document.createElementNS(SVG_NS, 'svg')
  cxLinks.setAttribute('class', 'cx-links')
  const gwrap = root.querySelector('.agentv-graph')
  gwrap.insertBefore(canvas, gwrap.firstChild)
  canvas.appendChild(cxLinks)
  const graph = new FleetGraph(canvas, {
    computer,
    rootId: agent.id,
    chipPredicate: (a) => a.id === agent.id || a.parentId === agent.id,
    onOpenControls: () => {},
    onRootChange: (id) => { if (id && id !== agent.id) navigate(`#/agent/${computer.id}/${id}`) },
  })
  /* Honour the same sticky Tree/Physics preference the computers page writes.
     This view never called setLayout() at all, so it sat on graph.js's 'force'
     default no matter what the toggle said: you picked Tree, drilled into a
     bubble, and got the tangle back. The links crossed each other and each
     other's labels, which is most of what "the graph styling needs huge work"
     was looking at. animate:false because the view is still off-screen during
     construction -- an animated settle here plays to nobody and lands the
     first paint mid-transition. */
  graph.setLayout(readLayout(), { animate: false })

  if (live) {
    // agents.json has no runtime epoch. FleetGraph renders its shared honest
    // unavailable state; only the exact declared role needs a local label.
    for (const rec of graph.nodes.values()) {
      const declaredRoleLabel = rec.el.querySelector('.node-role')
      if (declaredRoleLabel) declaredRoleLabel.textContent = rec.agent.declaredRole
    }
  }

  const crumb = root.querySelector('.graph-crumb')
  const back = el(`<button>← ${computer.name}</button>`)
  back.addEventListener('click', () => navigate('#/computers'))
  crumb.appendChild(back)
  crumb.appendChild(el(`<span class="sep">/</span>`))
  crumb.appendChild(el(`<span><b style="color:var(--ink-2)">${agent.name}</b></span>`))

  // --- criterion 1: orange rim activity arcs on every child bubble ---------
  // Overlay elements live inside each .node (already the exact bubble box),
  // so they track position for free without ever touching graph.js. Nodes
  // are matched to sim agents by their .node-name text, which graph.js
  // already renders as the exact agent id/name.
  const rimByAgent = new Map()
  function attachRim(nodeEl) {
    if (!nodeEl.classList || !nodeEl.classList.contains('node')) return
    const nameEl = nodeEl.querySelector('.node-name')
    const id = nameEl ? nameEl.textContent.trim() : ''
    if (!id) return
    nodeEl.dataset.agentId = id
    if (id === agent.id) return               // the root bubble gets no rim
    if (nodeEl.querySelector('.node-rim')) return
    const rim = buildRim()
    nodeEl.appendChild(rim)
    rimByAgent.set(id, rim)
  }
  canvas.querySelectorAll('.node').forEach(attachRim)

  // --- criterion 1 (C5): chips must never collide with node bubbles/labels -
  // Chip placement math lives in graph.js (read-only this wave) and only
  // reasons about the canvas edges, not sibling bubbles — in this page's
  // short strip a full context-preview panel can land on a neighbouring
  // node. Fewer chips by default + hover reveal: every chip is invisible
  // at rest (agent.css) — zero rendered pixels, so there is nothing left
  // to ever overlap — and becomes visible only while a small role-coloured
  // badge pinned to ITS OWN node's corner is hovered/focused, so the
  // reveal trigger always tracks that exact bubble instead of floating
  // independently. graph.js always appends a node then, synchronously
  // right after, that node's chip (nothing else appends to the canvas
  // in between — see graph.js spawnNode/makeChip), so a chip's previous
  // DOM sibling reliably is the node to badge. Being visible is not
  // enough on its own though — placeOpenChips() (below) re-anchors the
  // revealed chip every frame so its own position also clears every
  // other node's footprint, not just this page's canvas edges.
  const openHint = new Set()
  function pairChip(chipEl) {
    const nodeEl = chipEl.previousElementSibling
    if (!nodeEl?.classList?.contains('node') || nodeEl.querySelector('.cx-badge')) return
    const badge = document.createElement('div')
    badge.className = 'cx-badge'
    badge.tabIndex = 0
    badge.appendChild(document.createElement('span'))
    nodeEl.appendChild(badge)
    let closeT
    // openHint is only a "there may be work" flag for the frame loop below —
    // the authoritative set is still the live DOM query in placeOpenChips(),
    // so a chip that is removed or morphed while revealed self-heals rather
    // than pinning the loop awake.
    const open = () => { clearTimeout(closeT); chipEl.classList.add('cx-open'); openHint.add(chipEl) }
    const scheduleClose = () => {
      clearTimeout(closeT)
      closeT = setTimeout(() => { chipEl.classList.remove('cx-open'); openHint.delete(chipEl) }, 260)
    }
    badge.addEventListener('mouseenter', open)
    badge.addEventListener('focus', open)
    badge.addEventListener('mouseleave', scheduleClose)
    badge.addEventListener('blur', scheduleClose)
    // keep it open while the pointer travels the short gap onto the
    // now-revealed chip itself, so it can actually be reached and clicked
    chipEl.addEventListener('mouseenter', open)
    chipEl.addEventListener('mouseleave', scheduleClose)
    chipEl.addEventListener('focusin', open)
    chipEl.addEventListener('focusout', scheduleClose)
  }
  canvas.querySelectorAll('.chip').forEach(pairChip)

  // chipEl -> { x, y, cw, ch, applied, closedAt }. Held across frames so a
  // decided slot is never re-searched (no jitter, and the solve only ever runs
  // when the geometry or a box's own size actually changed).
  const placements = new Map()
  // The whole arrangement is one decision, not five, so it is cached as one:
  // `solvedKey` is the geometry plus every box's measured size, and any change
  // to either re-solves all of them together.
  let solvedKey = ''
  let lastGeomSig = ''
  let solvedBoxes = new Map()
  let culledSet = new Set()         // chips the density policy has retired

  /* --- geometry caches (idle-burn audit) ----------------------------------
     placeOpenChips runs in the rAF loop, and its short-circuit key used to be
     COMPUTED from live layout reads — canvas.clientWidth/clientHeight,
     canvas.getBoundingClientRect(), a rect per overlay child, label offsets
     per node and offsetWidth/offsetHeight per chip — so deciding "nothing
     changed" itself forced ~63 synchronous layouts a second while the page
     sat completely idle. Each read now lives behind a cache invalidated by
     the thing that can actually change it:
       · staticGeom (canvas size + overlay rects): the view's ResizeObserver
         watching the canvas, a gwrap overlay-set mutation, or a zoom/pan
         change (the overlay conversion runs through the canvas rect, which
         zoom/pan move without any observer firing).
       · labelMetrics (see nodeObstacle): per-node, DOM-static while a node
         stands; cleared with staticGeom.
       · chipDims (per-chip measured size): dropped whenever something that
         can change a chip's box happens — a context rewrite, a cx-tight
         toggle, the chat morph, a resize — and re-read once, on demand.
     Node positions are deliberately NOT cached: rec.x/y/r are plain JS state
     maintained by graph.js, so the per-frame signature still tracks drags and
     physics settles frame-accurately without touching layout. */
  let staticGeomDirty = true
  let staticGeom = null
  const labelMetrics = new Map()
  const chipDims = new Map()
  const strokeOf = new Map()        // rec.id -> resolved --rc for its leader line
  let obstacles = []
  let obstaclesSig = ''
  let appliedKey = ''               // the solvedKey the DOM currently shows
  const markGeomDirty = () => {
    staticGeomDirty = true
    labelMetrics.clear()
    chipDims.clear()
    // the position signature alone cannot see a metrics-only change (same
    // node positions, different label/chip sizes), so a dirty world must
    // force the obstacle rebuild AND the re-solve explicitly or the cleared
    // caches would sit unread until something happened to move a node
    obstaclesSig = ''
    solvedKey = ''
    appliedKey = ''
  }
  // Web fonts land after first paint and change label widths and preview
  // heights with NO DOM mutation — the one geometry change none of the
  // observers below can see. Baseline code re-measured every frame and so
  // absorbed it silently; the cache must be told. `ready` covers the initial
  // face set, 'loadingdone' any face fetched later.
  const onFontsDone = () => markGeomDirty()
  document.fonts?.ready?.then(onFontsDone)
  document.fonts?.addEventListener?.('loadingdone', onFontsDone)
  // every height change must go through here so the stale measurement dies
  // with the class flip — a cached height surviving a cx-tight toggle would
  // hand the solver 74px boxes that paint 55px, or the reverse
  const setTight = (chipEl, on) => {
    if (chipEl.classList.contains('cx-tight') === on) return
    chipEl.classList.toggle('cx-tight', on)
    chipDims.delete(chipEl)
  }

  /** The ONLY live geometry reads on the placement path — runs on
   *  invalidation, never per settled frame. */
  function refreshStaticGeom(viewSig) {
    const canvasW = canvas.clientWidth, canvasH = canvas.clientHeight
    /* ...and the panel's own chrome. The breadcrumb is an absolutely
       positioned overlay that is a SIBLING of the canvas, so it was invisible
       to a search that only knew about nodes: a chip would happily take the
       top-left pocket and print "claude / heartbeating claimed tas..." straight
       through "← Computer 1 / codex". Anything overlaid on this panel counts,
       not just the crumb, so the reservation is taken from the DOM rather than
       from a list of class names that the next overlay would not be on. */
    const cbox = canvas.getBoundingClientRect()
    const overlayObs = []
    let overlaySig = ''
    for (const ov of gwrap.children) {
      if (ov === canvas) continue
      const r = ov.getBoundingClientRect()
      if (!r.width || !r.height) continue
      overlayObs.push({
        cx: 0, cy: 0, cr: 0,
        labels: [{
          left: r.left - cbox.left - CLEAR_PAD, top: r.top - cbox.top - CLEAR_PAD,
          right: r.right - cbox.left + CLEAR_PAD, bottom: r.bottom - cbox.top + CLEAR_PAD,
        }],
      })
      overlaySig += `|ov${Math.round(r.width)}x${Math.round(r.height)}`
    }
    staticGeom = { canvasW, canvasH, overlayObs, overlaySig, viewSig }
    staticGeomDirty = false
  }

  // Runs every frame (see loop() below). Chips are visible at rest (the owner
  // wants the grey context boxes on this page so an agent is identifiable and
  // chattable at a glance), so the loop always has candidate work while any
  // chip exists — which is why the SETTLED path below must be layout-free:
  // it walks placements, runs two DOM queries (traversal, not layout), builds
  // the position signature from graph.js's plain JS state and compares it to
  // what the DOM already shows. Live geometry is only read when one of the
  // cache invalidations above says it truly changed.
  function placeOpenChips() {
    if (!canvas.querySelector('.chip:not(.as-chat)') && !placements.size) return
    const now = performance.now()
    // hand positioning back to graph.js's own transform once a chip is no
    // longer revealed — immediately if it morphed into the inline chat (which
    // graph.js sizes and places itself), otherwise after the fade-out so the
    // closing chip does not visibly jump mid-fade
    for (const [chipEl, st] of placements) {
      const revealed = chipEl.isConnected && !chipEl.classList.contains('as-chat')
      if (revealed) { st.closedAt = 0; continue }
      if (!st.closedAt) st.closedAt = now
      if (!chipEl.isConnected || chipEl.classList.contains('as-chat') || now - st.closedAt > 400) {
        chipEl.style.left = ''
        chipEl.style.top = ''
        chipEl.classList.remove('cx-tight')
        // the chat morph writes its own inline size, so whatever height was
        // cached is void once the chip comes back from it
        chipDims.delete(chipEl)
        // drop the leader line with the placement — previously it lingered
        // until the next apply pass, which never came if every chip closed
        const line = cxLine.get(chipEl)
        if (line) { line.remove(); cxLine.delete(chipEl) }
        placements.delete(chipEl)
      }
    }
    const openChips = canvas.querySelectorAll('.chip:not(.as-chat)')
    // the DOM is the authority: if nothing is actually revealed, drop the hint
    // (this is what clears an entry whose chip was removed or morphed to chat
    // while still open) and let the loop go back to resting
    if (!openChips.length) { openHint.clear(); return }
    // zoom/pan move the canvas rect the overlay conversion runs through, and
    // no observer fires for them — but the numbers themselves are plain JS on
    // the graph, so comparing them per frame is free and re-reading rects
    // only happens on the frames where they actually moved
    const viewSig = `${graph.zoom || 1},${graph.panX || 0},${graph.panY || 0}`
    if (!staticGeom || staticGeom.viewSig !== viewSig) staticGeomDirty = true
    if (staticGeomDirty) refreshStaticGeom(viewSig)
    const { canvasW, canvasH } = staticGeom
    // a 0 here means "not laid out yet", not a real size — keep asking until
    // the ResizeObserver's initial delivery lands a real one
    if (!canvasW || !canvasH) { staticGeomDirty = true; return }
    let sig = `${canvasW}x${canvasH}${staticGeom.overlaySig}|v${viewSig}`
    for (const [, rec] of graph.nodes) sig += `|${rec.x.toFixed(1)},${rec.y.toFixed(1)},${rec.r}`
    // every node's bubble disc + name/role rows, own node included — the own
    // footprint is a hard constraint here, not a weighted cost. Rebuilt only
    // when the signature moved: at rest this whole block is one string compare.
    if (sig !== obstaclesSig) {
      obstacles = [...staticGeom.overlayObs]
      for (const [, rec] of graph.nodes) obstacles.push(nodeObstacle(rec, labelMetrics))
      obstaclesSig = sig
    }
    /* Left-to-right by node x. The solver is not order-greedy any more, so
       this is no longer about which box gets first pick — it is about the
       packing READING right: boxes sharing a lane come out in the same order
       as the bubbles they describe, so their leader lines run parallel
       instead of crossing each other on the way to their nodes. */
    const items = [...openChips]
      .map(chipEl => ({ chipEl, rec: graph.nodes.get(chipEl.previousElementSibling?.dataset?.agentId) }))
      .filter(o => o.rec)
      .sort((a, b) => a.rec.x - b.rec.x)
    if (!items.length) return
    /* A box only ever escalates to the compact form, so without this it would
       stay compact for the rest of the session — the 1280 viewport that forced
       it would keep costing the box a context line at 1920. Any change to the
       geometry is a fresh question, so every box re-asks it at full height. */
    if (sig !== lastGeomSig) {
      lastGeomSig = sig
      culledSet = new Set()
      for (const it of items) setTight(it.chipEl, false)
    }
    /* Density is uniform across the strip or it reads as a fault, and one box
       can fall out of step on its own: opening the inline chat hands that chip
       back to graph.js, which drops its .cx-tight, so closing the chat returns
       one full-height box to a row of compact ones. Re-asking the question
       from a level start is both the fix and the whole rule — the answer below
       is then a property of the canvas, never of what happened to it. */
    const living = items.filter(it => !culledSet.has(it.chipEl))
    const tight = living.filter(it => it.chipEl.classList.contains('cx-tight')).length
    if (tight && tight < living.length) {
      for (const it of living) setTight(it.chipEl, false)
    }
    /* Sizes come from the chipDims cache; offsetWidth/offsetHeight are read
       only for chips whose entry was dropped by an actual size-changing event
       — at rest this loop is pure Map lookups, no layout. */
    const measure = () => {
      for (const it of items) {
        let d = chipDims.get(it.chipEl)
        if (!d) {
          d = { w: it.chipEl.offsetWidth || CHIP_W, h: it.chipEl.offsetHeight || CHIP_H }
          /* A chip fresh out of the chat morph still carries the morph's
             inline height and is animating toward its resting box for ~500ms
             (graph.js closeChat) — caching a mid-flight interpolation would
             freeze the box at a size it held for one frame. Transient chips
             are re-measured per frame, exactly the old behaviour, until the
             morph timer clears that inline height. */
          if (!it.chipEl.style.height) chipDims.set(it.chipEl, d)
        }
        it.ch = d.h
        it.cwm = d.w
      }
    }
    measure()
    const cw = items[0].cwm || CHIP_W
    for (const it of items) it.idealX = it.rec.x - cw / 2   // vertical-leader slot
    const keyOf = () => items.reduce((k, it) => `${k}|${it.rec.id}:${it.ch}`, `${sig}|w${cw}`)
    if (keyOf() !== solvedKey) {
      let laneCache = new Map()
      const lanesFor = (ch) => {
        if (!laneCache.has(ch)) laneCache.set(ch, buildLanes(cw, ch, obstacles, canvasW, canvasH))
        return laneCache.get(ch)
      }
      const solveFor = (list) => { laneCache = new Map(); return solveBands(list, lanesFor, cw) }
      /* Rank an arrangement the way a reader does: a box that is not shown at
         all is the worst outcome, and after that the one that has to be hunted
         for is. Total length is only the tie-break — five tidy boxes and one
         stranded one is a worse strip than five slightly-longer leaders. */
      const rank = (boxes, list) => {
        let held = 0, worst = 0, total = 0
        boxes.forEach((b, i) => {
          if (!b) { held++; return }
          const d = Math.hypot(b.x + cw / 2 - list[i].rec.x, b.y + list[i].ch / 2 - list[i].rec.y)
          worst = Math.max(worst, d); total += d
        })
        return [held, worst, total]
      }
      const better = (a, b) => a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2]

      let active = items.filter(it => !culledSet.has(it.chipEl))
      let boxes = solveFor(active)
      /* DENSITY IS A WHOLE-STRIP DECISION, not a per-box rescue. The old
         escalation tightened whichever single box happened to lose, which left
         one 55px box in a row of 74px ones — reading as a rendering fault
         rather than as a choice — and, worse, it was decided by DFS order
         rather than by which box could most afford the line.
         Every box carries a name plus two independent activity lines; the
         compact form keeps the name and the current line and drops the
         previous one. That is a real cost, so it is only paid when the full
         box cannot do its job: a box is withheld, or its leader is longer than
         the box itself, at which point the eye has to hunt for which bubble it
         belongs to and a shorter box that is actually beside its bubble says
         more than a taller one stranded across the strip. */
      let score = rank(boxes, active)
      /* FEWER, FULLER — the owner's trade, stated in their own words: the
         boxes should be "decently sized with good amounts of text in them,
         and once the graph gets too dense that's where the chatboxes end."
         The old escalation kept every box by compacting ALL of them to
         one clipped line, which at the new full size meant the whole strip
         degraded everywhere. Now, when full boxes don't fit, the strip
         RETIRES the least important boxes one at a time — role rank decides,
         the page's own agent is never culled — and the boxes that remain say
         everything. Compact-all survives only as the last resort below a
         three-box floor. A retired box is not gone: its bubble, its badge
         and its click-to-chat all still work; only the ambient preview ends. */
      if (score[0] > 0 || score[1] > ATTACHED_REACH) {
        const PRIO = { coordinator: 4, helper: 3, shadow: 3, manager: 2, default: 1, spawned: 0 }
        const prio = (it) => it.rec.id === agent.id ? 9 : (PRIO[it.rec.agent.role] ?? 1)
        while ((score[0] > 0 || score[1] > ATTACHED_REACH) && active.length > 3) {
          let cut = 0
          for (let i = 1; i < active.length; i++) {
            if (prio(active[i]) <= prio(active[cut])) cut = i   // lowest rank; rightmost on ties
          }
          culledSet.add(active[cut].chipEl)
          active = active.filter((_, i) => i !== cut)
          boxes = solveFor(active)
          score = rank(boxes, active)
        }
        if (score[0] > 0 || score[1] > ATTACHED_REACH) {
          const fullBoxes = boxes
          for (const it of active) setTight(it.chipEl, true)
          measure()                                 // one forced reflow, on change only
          const tightBoxes = solveFor(active)
          if (better(rank(tightBoxes, active), score)) { boxes = tightBoxes }
          else {
            for (const it of active) setTight(it.chipEl, false)
            measure()
            boxes = fullBoxes
          }
        }
      }
      solvedBoxes = new Map(active.map((it, i) => [it.chipEl, boxes[i]]))
      solvedKey = keyOf()
    }
    /* Settled fast path (idle-burn audit). solvedKey already encodes the
       canvas box, overlays, zoom/pan, every node position and every box size,
       so when it matches what the DOM last had applied there is nothing to
       write — the accept loop below would only re-derive identical styles and
       identical line endpoints. Returning here is what makes the resting
       frame a string compare instead of five clearance tests and a dozen
       attribute writes. */
    if (solvedKey === appliedKey) return
    /* The lane arithmetic is a proposal, not a licence to paint. Every chosen
       box is re-tested against the real obstacle set (exact circle test for
       bubbles) and against the boxes already accepted this frame, so a bug in
       the closed-form span math can only ever cost a box its slot — it can
       never put one through a bubble. */
    const accepted = []
    for (const { chipEl, rec, ch } of items) {
      const slot = solvedBoxes.get(chipEl)
      const box = slot && boxAt(slot.x, slot.y, cw, ch)
      const clear = !!box && boxClearsAll(box, obstacles) && !accepted.some(a => rectsOverlap(a, box))
      /* No lane anywhere fits this box, even compact: withhold it rather than
         print it through a bubble. A context box exists to say which agent
         this is; one drawn across a node says that less well than not drawing
         it at all. It re-solves on the next tick, so this is a frame-by-frame
         decision, not a permanent removal. */
      if (!clear) {
        chipEl.classList.remove('cx-placed')
        cxLine.get(chipEl)?.setAttribute('opacity', '0')
        placements.set(chipEl, { x: 0, y: 0, cw, ch, applied: false, closedAt: 0 })
        continue
      }
      accepted.push(box)
      const lx = `${slot.x.toFixed(1)}px`, ly = `${slot.y.toFixed(1)}px`
      if (chipEl.style.left !== lx) chipEl.style.left = lx
      if (chipEl.style.top !== ly) chipEl.style.top = ly
      /* Only now is the box allowed to paint. Chips are visible at rest, so
         without this gate all five rendered at the canvas origin -- stacked on
         each other and on the breadcrumb -- for every frame between mount and
         the first placement pass. */
      chipEl.classList.add('cx-placed')
      cxLine.get(chipEl)?.removeAttribute('opacity')
      placements.set(chipEl, { x: slot.x, y: slot.y, cw, ch, applied: true, closedAt: 0 })
      drawLink(chipEl, rec, slot.x, slot.y, cw, ch)
    }
    // drop connectors whose chip is gone
    for (const [key, line] of cxLine) {
      if (!key.isConnected || !placements.has(key)) { line.remove(); cxLine.delete(key) }
    }
    appliedKey = solvedKey
  }

  /** One hairline from the box's nearest edge to the bubble's rim. */
  const cxLine = new Map()
  function drawLink(chipEl, rec, x, y, cw, ch) {
    let line = cxLine.get(chipEl)
    if (!line) {
      line = document.createElementNS(SVG_NS, 'line')
      line.setAttribute('class', 'cx-link')
      /* Resolved once per node, not per draw: getComputedStyle forces a style
         recalc, and the role colour riding in --rc never changes while the
         node lives — during a drag this ran every frame for every line. */
      let stroke = strokeOf.get(rec.id)
      if (!stroke) {
        stroke = getComputedStyle(rec.el).getPropertyValue('--rc') || 'currentColor'
        strokeOf.set(rec.id, stroke)
      }
      line.style.stroke = stroke
      cxLinks.appendChild(line)
      cxLine.set(chipEl, line)
    }
    // start at the point on the box nearest the bubble, end on the bubble rim
    const bx = Math.max(x, Math.min(rec.x, x + cw))
    const by = Math.max(y, Math.min(rec.y, y + ch))
    const dx = rec.x - bx, dy = rec.y - by
    const d = Math.hypot(dx, dy) || 1
    line.setAttribute('x1', bx.toFixed(1))
    line.setAttribute('y1', by.toFixed(1))
    line.setAttribute('x2', (rec.x - (dx / d) * (rec.r + 3)).toFixed(1))
    line.setAttribute('y2', (rec.y - (dy / d) * (rec.r + 3)).toFixed(1))
  }

  const rimObserver = new MutationObserver((muts) => {
    for (const m of muts) {
      // an overlay appearing/disappearing on gwrap changes the reserved
      // chrome rects the placement cache holds — re-read them next frame
      if (m.target === gwrap) { markGeomDirty(); continue }
      // a mutation INSIDE a chip is a preview rewrite (graph.js sets the
      // preview's innerHTML both on 'context' events and on its own initial
      // self-heal, which emits no event at all) — the box's height may have
      // changed, so its cached size dies here and is re-measured once.
      // Without this, chips measured before their first real preview kept
      // their empty-preview height and the solver packed 74px boxes as 44px.
      const inChip = m.target !== canvas && m.target.closest?.('.chip')
      if (inChip) { chipDims.delete(inChip); continue }
      m.addedNodes.forEach((n) => {
        if (n.nodeType !== 1) return
        attachRim(n)
        if (n.classList.contains('chip')) pairChip(n)
      })
      m.removedNodes.forEach((n) => {
        if (n.nodeType === 1 && n.dataset && n.dataset.agentId) rimByAgent.delete(n.dataset.agentId)
      })
    }
  })
  // subtree:true so preview rewrites inside chips are seen (see above); the
  // direct-child add/remove handling filters itself by target === canvas
  rimObserver.observe(canvas, { childList: true, subtree: true })
  rimObserver.observe(gwrap, { childList: true })

  const unsubContext = live ? () => {} : sim.on('context', ({ comp, agent: a }) => {
    if (comp !== computer) return
    // a context rewrite can change the chip preview's height — drop only that
    // chip's cached size so the next placement frame re-measures it once
    const chip = graph.nodes.get(a.id)?.chip
    if (chip) chipDims.delete(chip)
    const rim = rimByAgent.get(a.id)
    if (!rim) return
    rim.classList.remove('pulse')
    void rim.offsetWidth        // restart the animation even on rapid repeats
    rim.classList.add('pulse')
  })

  // --- criterion 2: Chat/Controls dot indicator + one-shot scroll cue ------
  // .panel-dots is its own normal-flow row above the panels (never overlaps
  // panel content) and .scroll-cue lives in the non-scrolling
  // .agentv-panels-wrap (a sibling of the scrolling .agentv-panels, not a
  // descendant of it) so it stays fixed on screen instead of scrolling out
  // of view with the panel content; see agent.css for the wrap/inset-fill +
  // panel-width rules that guarantee .agentv-panels always has real
  // overflow to scroll.
  const panelsWrapEl = root.querySelector('.agentv-panels-wrap')
  const panelsEl = panelsWrapEl.querySelector('.agentv-panels')
  const panelEls = [...panelsEl.querySelectorAll('.apanel')]
  const dotEls = [...root.querySelectorAll('.panel-dots .pdot')]
  const scrollCue = panelsWrapEl.querySelector('.scroll-cue')

  function syncDots() {
    const sl = panelsEl.scrollLeft
    let best = 0, bestDist = Infinity
    panelEls.forEach((p, i) => {
      const dist = Math.abs(p.offsetLeft - sl)
      if (dist < bestDist) { bestDist = dist; best = i }
    })
    dotEls.forEach((d, i) => d.classList.toggle('active', i === best))
  }
  syncDots()

  panelsEl.addEventListener('scroll', () => {
    syncDots()
    if (!panelsCueDismissed) { panelsCueDismissed = true; scrollCue.classList.add('gone') }
  }, { passive: true })

  dotEls.forEach((d, i) => d.addEventListener('click', () => {
    const reduced = document.body.classList.contains('reduce-motion')
    panelEls[i].scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', inline: 'start', block: 'nearest' })
  }))

  // chat panel
  const chat = buildChat({
    title: agent.name,
    subtitle: `${role.label} · direct line`,
    roleKey: agent.role,
    // A live projection has no message payload. Keep the local interaction,
    // but do not seed it with the simulation's invented past.
    seed: live ? 0 : 6,
    tall: true,
    context: () => live ? 'local draft; no observed session is mapped to this agent' : agent.context,
  })
  if (live) chat.querySelector('.chat-head .s').textContent = `local draft · observed session ${sessionState}`
  root.querySelector('.chat-panel').appendChild(chat)

  // Controls ring. The panel's height is dictated by the viewport (the graph
  // above it has a hard 362px floor, so the panel gets whatever is left), and
  // a 180px dial is taller than the whole scroll window below ~960px of
  // viewport height. The ring cannot simply be scaled: "hh:mm:ss" measures
  // 128px at the compact 27px digit step, so anything under a 160px ring puts
  // the digits outside the disc — the small ring gets its own digit step
  // (.ctl-ring-sm in agent.css, ~95px of digits inside a 100px chord).
  let ring = null
  let ringUpdates = false
  const liveRuntime = live ? liveAgentRuntimeSource(agent) : null
  if (!live || liveRuntime) {
    const smallRing = window.innerHeight < 960
    // uptimeRing renders Date.now() - epoch. Translate an exact stopped
    // duration into that coordinate once, then leave the existing ring still;
    // running and simulated clocks keep their real source epoch and heartbeat.
    const ringEpoch = live && !liveRuntime.running
      ? Date.now() - liveRuntime.elapsedMs
      : agent.bornAt
    ring = uptimeRing({ size: smallRing ? 132 : 180, epoch: ringEpoch, colors: [role.glow, role.hex], caption: 'Runtime', showDays: false })
    if (smallRing) ring.el.classList.add('ctl-ring-sm')
    if (appendAgentRingNode(runtimeRingMount, ring.el)) ringUpdates = !live || liveRuntime.running
    else ring = null
  }

  // The Controls scroller keeps a bottom fade while there is more below it
  // (agent.css) — a cue is only honest if it goes away at the end of the
  // scroll, so the class is driven from the real scroll position, and from a
  // ResizeObserver as well because the panel's height moves with the window.
  const ctlScroll = root.querySelector('.ctl-panel .rail-scroll')
  const syncScrollEnd = () => {
    const atEnd = ctlScroll.scrollTop + ctlScroll.clientHeight >= ctlScroll.scrollHeight - 2
    ctlScroll.classList.toggle('at-end', atEnd)
  }
  ctlScroll.addEventListener('scroll', syncScrollEnd, { passive: true })
  // One observer, two jobs: the Controls scroll fade above, and the placement
  // geometry cache — the canvas box is the only resize signal placeOpenChips
  // needs, and hearing it HERE is what lets the settled rAF path stop reading
  // canvas sizes every frame just in case the window moved.
  const ctlResize = new ResizeObserver((entries) => {
    let scroll = false
    for (const e of entries) {
      if (e.target === canvas) markGeomDirty()
      else scroll = true
    }
    if (scroll) syncScrollEnd()
  })
  ctlResize.observe(ctlScroll)
  ctlResize.observe(canvas)
  root.querySelectorAll('input[type="range"]').forEach(rangeFill)

  // The runtime ring is a live clock, so this loop legitimately has to keep a
  // heartbeat — but it does not need sixty of them a second. The sweep
  // advances 6° per minute, so at ~12Hz the arc tip still moves well under a
  // pixel between updates while the two SVG attribute writes per frame drop by
  // five sixths; the digits only change once a second and update() already
  // short-circuits when the second has not rolled. Chip placement, which does
  // need every frame, now only asks for one while a chip is genuinely open
  // (see placeOpenChips) — so at rest this loop does a subtraction and two
  // size checks and nothing else.
  let raf = 0
  let lastRingAt = 0
  const loop = (ts) => {
    if (ring && ringUpdates && ts - lastRingAt >= 80) { lastRingAt = ts; ring.update() }
    placeOpenChips()
    raf = requestAnimationFrame(loop)
  }
  raf = requestAnimationFrame(loop)

  return {
    el: root,
    destroy() {
      terminateButton.removeEventListener('click', onTerminateClick)
      terminateController.destroy()
      destroyWriteSurface()
      /* Closes any open session. Navigating away from the page must not leave
         a CLI child running with nothing on screen that can stop it. */
      destroyAgentSession()
      cancelAnimationFrame(raf)
      rimObserver.disconnect()
      ctlResize.disconnect()
      document.fonts?.removeEventListener?.('loadingdone', onFontsDone)
      unsubContext()
      graph.destroy()
    },
  }
}
