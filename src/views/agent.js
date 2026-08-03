// Agent page — the selected agent's branch up top; Chat | Controls panels
// below, horizontally scroll-snapped exactly like the whiteboard.

import { sim } from '../sim.js'
import { ROLES } from '../vocab.js'
import { el, uptimeRing, buildChat } from '../components.js'
import { FleetGraph } from '../graph.js'
import { rangeFill } from './computers.js'

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
        <div class="scroll-cue">scroll<svg width="14" height="14" viewBox="0 0 24 24"><path d="M9.5 5.5 16 12l-6.5 6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></div>
      </div>
      <div class="agentv-panels">
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
    destroy() { cancelAnimationFrame(raf); graph.destroy() },
  }
}
