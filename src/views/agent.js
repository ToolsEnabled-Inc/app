// Agent page — the selected agent's branch up top; Chat | Controls panels
// below, horizontally scroll-snapped exactly like the whiteboard.

import { sim } from '../sim.js'
import { ROLES } from '../vocab.js'
import { el, uptimeRing, buildChat } from '../components.js'
import { FleetGraph } from '../graph.js'
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
// Clearance is now a HARD constraint, never a cost: a candidate is only ever
// accepted if it clears every bubble disc and every label rect outright, and
// the search is wide enough to actually find one — a ring sweep outward from
// the node first (nearest, still-attached slots), then an exhaustive 8px grid
// pass over the whole canvas that cannot step past a narrow pocket.
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
const GRID_STEP = 8

/** Bubble disc + node-name/node-role label rects of one graph.nodes record,
 *  in local graph-canvas coordinates, each already inflated by the paint-time
 *  scale and the safety pad. */
function nodeObstacle(rec) {
  const labels = []
  for (const sel of ['.node-name', '.node-role']) {
    const label = rec.el.querySelector(sel)
    const w = label && label.offsetWidth, h = label && label.offsetHeight
    if (!w || !h) continue
    // node-name/node-role are centered under the bubble via left:50% +
    // translateX(-50%) — the translate is paint-only, so their true visual
    // left edge is rec.x - w/2, not anything offsetLeft would report. .node
    // shrink-wraps .node-glass, so offsetTop is measured from rec.y - rec.r.
    const top = rec.y - rec.r + label.offsetTop
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

/** Overlap area, used ONLY to rank the last-resort placement when a canvas
 *  genuinely has no clear pocket left at all (bubble approximated by its
 *  bounding box here — ranking only, never a clearance decision). */
function boxOverlapArea(box, obstacles) {
  let area = 0
  for (const ob of obstacles) {
    const rects = [{ left: ob.cx - ob.cr, top: ob.cy - ob.cr, right: ob.cx + ob.cr, bottom: ob.cy + ob.cr }, ...ob.labels]
    for (const r of rects) {
      if (!rectsOverlap(box, r)) continue
      area += (Math.min(box.right, r.right) - Math.max(box.left, r.left)) *
              (Math.min(box.bottom, r.bottom) - Math.max(box.top, r.top))
    }
  }
  return area
}

const boxAt = (x, y, cw, ch) => ({ left: x, top: y, right: x + cw, bottom: y + ch })

/** Find a slot for one open chip that clears EVERY obstacle. Ring sweep
 *  outward from its own node first (so the chip stays visually attached),
 *  then an exhaustive grid pass, nearest clear box wins. Returns
 *  `{ x, y, clear }`; `clear:false` only when no box anywhere in the canvas
 *  can clear everything at this chip size. */
function findChipSlot(rec, cw, ch, obstacles, canvasW, canvasH) {
  const minX = 6, minY = 6
  const maxX = canvasW - cw - 6, maxY = canvasH - ch - 6
  if (maxX < minX || maxY < minY) return null
  // 1) ring sweep — nearest, still-attached slots first, angular resolution
  //    kept at ~16px of arc so a wide ring cannot stride over a pocket
  const start = rec.r + 14 + Math.min(cw, ch) / 2
  const maxD = Math.hypot(canvasW, canvasH)
  for (let d = start; d <= maxD; d += GRID_STEP) {
    const steps = Math.max(24, Math.min(96, Math.round((2 * Math.PI * d) / 16)))
    for (let k = 0; k < steps; k++) {
      const a = (k / steps) * Math.PI * 2 - Math.PI / 2
      const x = rec.x + Math.cos(a) * d - cw / 2
      const y = rec.y + Math.sin(a) * d - ch / 2
      if (x < minX || x > maxX || y < minY || y > maxY) continue
      if (boxClearsAll(boxAt(x, y, cw, ch), obstacles)) return { x, y, clear: true }
    }
  }
  // 2) exhaustive grid over the whole canvas — nearest clear box to the node
  let best = null, bestD = Infinity
  for (let y = minY; y <= maxY; y += GRID_STEP) {
    for (let x = minX; x <= maxX; x += GRID_STEP) {
      if (!boxClearsAll(boxAt(x, y, cw, ch), obstacles)) continue
      const dist = Math.hypot(x + cw / 2 - rec.x, y + ch / 2 - rec.y)
      if (dist < bestD) { bestD = dist; best = { x, y, clear: true } }
    }
  }
  if (best) return best
  // 3) nothing clears at this size — rank the least-bad box on a coarse pass
  //    (the caller first tries again with the compact .cx-tight chip)
  let fx = minX, fy = minY, fs = Infinity
  for (let y = minY; y <= maxY; y += GRID_STEP * 2) {
    for (let x = minX; x <= maxX; x += GRID_STEP * 2) {
      const s = boxOverlapArea(boxAt(x, y, cw, ch), obstacles)
      if (s < fs) { fs = s; fx = x; fy = y }
    }
  }
  return { x: fx, y: fy, clear: false }
}

export function agentView({ compId, agentId, navigate }) {
  const { computer, agent } = sim.agentOf(compId, agentId)
  if (!computer || !agent) {
    const back = el(`<div class="view-pad"><p style="color:var(--ink-3);padding-top:40px">Agent no longer running.</p></div>`)
    setTimeout(() => navigate('#/computers'), 1200)
    return { el: back, destroy() {} }
  }
  const role = ROLES[agent.role]

  const root = el(`
    <div class="agentv">
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
              <div class="agent-ring-wrap"></div>
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
            </div>
            <div class="ctl-grid ctl-actions">
              <button class="ctl-btn armed">Active</button>
              <button class="ctl-btn">Pause</button>
              <button class="ctl-btn">Respawn</button>
              <button class="ctl-btn danger">Terminate</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  `)

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

  // chipEl -> { x, y, cw, ch, clear, sig, applied, closedAt }. Held across
  // frames so an elected, still-clear slot is never re-searched (no jitter,
  // and the wide search only ever runs when the geometry actually changed).
  const placements = new Map()

  // Runs every frame (see loop() below); no-ops instantly whenever no chip
  // is open, so it costs nothing outside an actual hover/focus reveal.
  function placeOpenChips() {
    // "no-ops instantly" was not quite true: the function still ran a full
    // querySelectorAll over the graph canvas on every one of the sixty frames
    // a second in which nothing at all was revealed. openHint (maintained by
    // the badge's own open/close handlers) plus the placements map together
    // say whether any work can possibly exist, so the resting cost is now two
    // integer reads instead of a DOM query.
    // Chips are visible at rest now (the owner wants the grey context boxes
    // on this page so an agent is identifiable and chattable at a glance),
    // so the loop always has work while any chip exists. The placements map
    // still short-circuits the expensive search when nothing has moved.
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
        placements.delete(chipEl)
      }
    }
    const openChips = canvas.querySelectorAll('.chip:not(.as-chat)')
    // the DOM is the authority: if nothing is actually revealed, drop the hint
    // (this is what clears an entry whose chip was removed or morphed to chat
    // while still open) and let the loop go back to resting
    if (!openChips.length) { openHint.clear(); return }
    const canvasW = canvas.clientWidth, canvasH = canvas.clientHeight
    if (!canvasW || !canvasH) return
    // every node's bubble disc + name/role rows, own node included — the own
    // footprint is a hard constraint here, not a weighted cost
    const obstacles = []
    let sig = `${canvasW}x${canvasH}`
    for (const [, rec] of graph.nodes) {
      obstacles.push(nodeObstacle(rec))
      sig += `|${rec.x.toFixed(1)},${rec.y.toFixed(1)},${rec.r}`
    }
    openChips.forEach((chipEl) => {
      const ownId = chipEl.previousElementSibling?.dataset?.agentId
      const rec = ownId ? graph.nodes.get(ownId) : null
      if (!rec) return
      const cw = chipEl.offsetWidth || 168, ch = chipEl.offsetHeight || 44
      // a sibling chip revealed at the same moment (the pointer travelling
      // between badges) is an obstacle too — rect only, hence cr: 0
      const around = obstacles.slice()
      for (const [other, st] of placements) {
        if (other === chipEl || !st.applied) continue
        around.push({
          cx: 0, cy: 0, cr: 0,
          labels: [{
            left: st.x - CLEAR_PAD, top: st.y - CLEAR_PAD,
            right: st.x + st.cw + CLEAR_PAD, bottom: st.y + st.ch + CLEAR_PAD,
          }],
        })
      }
      const st = placements.get(chipEl)
      const sameSize = st && st.cw === cw && st.ch === ch
      const inBounds = st && st.x >= 6 && st.y >= 6 &&
        st.x <= canvasW - cw - 6 && st.y <= canvasH - ch - 6
      let slot
      if (sameSize && st.applied && st.sig === sig) {
        slot = { x: st.x, y: st.y, clear: st.clear }             // nothing moved
      } else if (sameSize && st.applied && st.clear && inBounds &&
                 boxClearsAll(boxAt(st.x, st.y, cw, ch), around)) {
        slot = { x: st.x, y: st.y, clear: true }                 // still clear
      } else {
        slot = findChipSlot(rec, cw, ch, around, canvasW, canvasH)
      }
      if (!slot) return
      // no pocket anywhere in the canvas fits the full preview: drop to the
      // compact one-line chip (agent.css .cx-tight) and re-elect next frame
      // at its real measured size instead of settling for a known overlap
      const tight = chipEl.classList.contains('cx-tight')
      if (!slot.clear && !tight) chipEl.classList.add('cx-tight')
      const lx = `${slot.x.toFixed(1)}px`, ly = `${slot.y.toFixed(1)}px`
      if (chipEl.style.left !== lx) chipEl.style.left = lx
      if (chipEl.style.top !== ly) chipEl.style.top = ly
      placements.set(chipEl, {
        x: slot.x, y: slot.y, cw, ch, clear: slot.clear, sig, applied: true, closedAt: 0,
      })
      drawLink(chipEl, rec, slot.x, slot.y, cw, ch)
    })
    // drop connectors whose chip is gone
    for (const [key, line] of cxLine) {
      if (!key.isConnected || !placements.has(key)) { line.remove(); cxLine.delete(key) }
    }
  }

  /** One hairline from the box's nearest edge to the bubble's rim. */
  const cxLine = new Map()
  function drawLink(chipEl, rec, x, y, cw, ch) {
    let line = cxLine.get(chipEl)
    if (!line) {
      line = document.createElementNS(SVG_NS, 'line')
      line.setAttribute('class', 'cx-link')
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
    line.style.stroke = getComputedStyle(rec.el).getPropertyValue('--rc') || 'currentColor'
  }

  const rimObserver = new MutationObserver((muts) => {
    for (const m of muts) {
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
  rimObserver.observe(canvas, { childList: true })

  const unsubContext = sim.on('context', ({ comp, agent: a }) => {
    if (comp !== computer) return
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
    seed: 6,
    tall: true,
  })
  root.querySelector('.chat-panel').appendChild(chat)

  // Controls ring. The panel's height is dictated by the viewport (the graph
  // above it has a hard 362px floor, so the panel gets whatever is left), and
  // a 180px dial is taller than the whole scroll window below ~960px of
  // viewport height. The ring cannot simply be scaled: "hh:mm:ss" measures
  // 128px at the compact 27px digit step, so anything under a 160px ring puts
  // the digits outside the disc — the small ring gets its own digit step
  // (.ctl-ring-sm in agent.css, ~95px of digits inside a 100px chord).
  const smallRing = window.innerHeight < 960
  const ring = uptimeRing({ size: smallRing ? 132 : 180, epoch: agent.bornAt, colors: [role.glow, role.hex], caption: 'Runtime', showDays: false })
  if (smallRing) ring.el.classList.add('ctl-ring-sm')
  root.querySelector('.agent-ring-wrap').appendChild(ring.el)

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
  const ctlResize = new ResizeObserver(syncScrollEnd)
  ctlResize.observe(ctlScroll)
  root.querySelectorAll('input[type="range"]').forEach(rangeFill)
  root.querySelectorAll('.ctl-grid .ctl-btn').forEach(btn => btn.addEventListener('click', () => {
    root.querySelectorAll('.ctl-grid .ctl-btn.armed').forEach(b => b.classList.remove('armed'))
    btn.classList.add('armed')
  }))

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
    if (ts - lastRingAt >= 80) { lastRingAt = ts; ring.update() }
    placeOpenChips()
    raf = requestAnimationFrame(loop)
  }
  raf = requestAnimationFrame(loop)

  return {
    el: root,
    destroy() {
      cancelAnimationFrame(raf)
      rimObserver.disconnect()
      ctlResize.disconnect()
      unsubContext()
      graph.destroy()
    },
  }
}
