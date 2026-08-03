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
      <div class="agentv-panels">
        <div class="panel-dots">
          <button type="button" class="pdot active" data-i="0"><span></span>Chat</button>
          <button type="button" class="pdot" data-i="1"><span></span>Controls</button>
        </div>
        <div class="scroll-cue">scroll<svg width="14" height="14" viewBox="0 0 24 24"><path d="M9.5 5.5 16 12l-6.5 6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></div>
        <section class="apanel glass chat-panel"><div class="apanel-title">Chat</div></section>
        <section class="apanel glass ctl-panel">
          <div class="apanel-title">Controls</div>
          <div class="rail-scroll">
            <div class="agent-head">
              <span class="role-dot" style="background:${role.hex};box-shadow:0 0 calc(10px*var(--glow)) ${role.glow}"></span>
              <div><div class="an">${agent.name}</div><div class="ar">${role.label}</div></div>
            </div>
            <div class="agent-ring-wrap"></div>
            <div class="rail-sub" style="text-align:center">model ${agent.model} · pool ${agent.pool}</div>
            <div class="ctl-grid" style="margin-top:8px">
              <button class="ctl-btn armed">Active</button>
              <button class="ctl-btn">Pause</button>
              <button class="ctl-btn">Respawn</button>
              <button class="ctl-btn danger">Terminate</button>
            </div>
            <div class="rail-sec">Tuning</div>
            <div class="ctl-row"><span class="cl">Context budget</span><input type="range" min="0" max="100" value="62"/><span class="cv">124k</span></div>
            <div class="ctl-row"><span class="cl">Wake interval</span><input type="range" min="0" max="100" value="35"/><span class="cv">20m</span></div>
            <div class="ctl-row"><span class="cl">Verbosity</span><input type="range" min="0" max="100" value="20"/><span class="cv">low</span></div>
          </div>
        </section>
      </div>
    </div>
  `)

  // subtree graph, rooted at this agent, chips on every bubble
  const canvas = el(`<div style="position:absolute;inset:0"></div>`)
  const gwrap = root.querySelector('.agentv-graph')
  gwrap.insertBefore(canvas, gwrap.firstChild)
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
  const rimObserver = new MutationObserver((muts) => {
    for (const m of muts) {
      m.addedNodes.forEach((n) => { if (n.nodeType === 1) attachRim(n) })
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
  const panelsEl = root.querySelector('.agentv-panels')
  const panelEls = [...panelsEl.querySelectorAll('.apanel')]
  const dotEls = [...panelsEl.querySelectorAll('.pdot')]
  const scrollCue = panelsEl.querySelector('.scroll-cue')

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

  let scrolledOnce = false
  panelsEl.addEventListener('scroll', () => {
    syncDots()
    if (!scrolledOnce) { scrolledOnce = true; scrollCue.classList.add('gone') }
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

  // controls ring
  const ring = uptimeRing({ size: 180, epoch: agent.bornAt, colors: [role.glow, role.hex], caption: 'Runtime', showDays: false })
  root.querySelector('.agent-ring-wrap').appendChild(ring.el)
  root.querySelectorAll('input[type="range"]').forEach(rangeFill)
  root.querySelectorAll('.ctl-grid .ctl-btn').forEach(btn => btn.addEventListener('click', () => {
    root.querySelectorAll('.ctl-grid .ctl-btn.armed').forEach(b => b.classList.remove('armed'))
    btn.classList.add('armed')
  }))

  let raf
  const loop = () => { ring.update(); raf = requestAnimationFrame(loop) }
  raf = requestAnimationFrame(loop)

  return {
    el: root,
    destroy() {
      cancelAnimationFrame(raf)
      rimObserver.disconnect()
      unsubContext()
      graph.destroy()
    },
  }
}
