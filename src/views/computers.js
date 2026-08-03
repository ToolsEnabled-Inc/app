// Computers — tabs per machine, the liquid agent graph, and the right rail
// that morphs between Runtime Statistics and Agent Controls (dblclick a bubble).

import { sim, fmtRuntime } from '../sim.js'
import { ROLES } from '../vocab.js'
import { el, uptimeRing, bindRuntime } from '../components.js'
import { FleetGraph } from '../graph.js'

const BAR_DEFS = [
  { key: 'cpu', label: 'CPU', c: 'var(--c-coordinator)', g: 'var(--g-coordinator)' },
  { key: 'gpu', label: 'GPU', c: 'var(--c-helper)', g: 'var(--g-helper)' },
  { key: 'net', label: 'Network', c: 'var(--c-shadow)', g: 'var(--g-shadow)' },
  { key: 'disk', label: 'Disk', c: 'var(--c-manager)', g: 'var(--g-manager)' },
]

export function computersView({ initialComputer = null, navigate }) {
  let computer = sim.computers.find(c => c.id === initialComputer) || sim.computers[0]
  let graph = null
  let ringLoop = null
  const unsubs = []

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

  function switchComputer(c) {
    if (c === computer) return
    computer = c
    renderTabs()
    mountGraph()
    showStats(true)
  }

  /* ---------- graph ---------- */
  let canvas = null
  function mountGraph() {
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
  }

  function renderCrumb(rootId) {
    crumbEl.innerHTML = ''
    if (!rootId) return
    const back = el(`<button>← ${computer.name}</button>`)
    back.addEventListener('click', () => graph.clearRoot())
    const agent = computer.agents.find(a => a.id === rootId)
    crumbEl.appendChild(back)
    crumbEl.appendChild(el(`<span class="sep">/</span>`))
    crumbEl.appendChild(el(`<span><b style="color:var(--ink-2)">${agent?.name || ''}</b></span>`))
  }

  /* ---------- rail: runtime statistics ---------- */
  function showStats(immediate = false) {
    renderStats()
    statsPage.classList.remove('off-l')
    ctlPage.classList.add('off-r')
    if (immediate) { statsPage.style.transition = 'none'; void statsPage.offsetWidth; statsPage.style.transition = '' }
  }

  function renderStats() {
    const active = computer.agents.length
    statsPage.innerHTML = `
      <div class="rail-title">Runtime Statistics</div>
      <div class="rail-scroll">
        <div class="stat-hero"><span class="v" id="agent-count">${computer.spawnedTotal}</span><span class="l">Agent Count</span></div>
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
    if (ac) ac.textContent = computer.spawnedTotal
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
    const role = ROLES[agent.role]
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

    ctlPage.querySelector('.rail-back').addEventListener('click', () => {
      statsPage.classList.remove('off-l'); ctlPage.classList.add('off-r'); ctlRing = null
    })
    ctlPage.querySelector('[data-a="open"]').addEventListener('click', () => navigate(`#/agent/${computer.id}/${agent.id}`))
    ctlPage.querySelectorAll('.ctl-btn[data-a]:not([data-a="open"])').forEach(btn => {
      btn.addEventListener('click', () => {
        ctlPage.querySelectorAll('.ctl-btn.armed').forEach(b => b.classList.remove('armed'))
        btn.classList.add('armed')
      })
    })
    ctlPage.querySelectorAll('input[type="range"]').forEach(rangeFill)

    statsPage.classList.add('off-l')
    ctlPage.classList.remove('off-r')
  }

  /* ---------- boot ---------- */
  renderTabs()
  mountGraph()
  showStats(true)

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
      graph?.destroy()
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
