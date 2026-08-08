import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import { sim, fmtRuntime } from '../sim.js'
import { CHAT, ROLES } from '../vocab.js'
import { el, uptimeRing, setViewMorph, buildChat } from '../components.js'
import { StaticTreeGraph } from '../tree-graph.js'
import { withAlpha } from '../echarts-theme.js'
import { isLiveView, LIVE_FLAGS_EVENT } from '../live-flags.js'
import { fetchFleet } from '../live-status.js'
import '../board.css'
import '../tree-graph.css'

echarts.use([LineChart, GridComponent, TooltipComponent, SVGRenderer])

const BAR_DEFS = [
  { key: 'cpu', label: 'CPU' },
  { key: 'gpu', label: 'GPU' },
  { key: 'net', label: 'Network' },
  { key: 'disk', label: 'Disk' },
]
const BAR_C = 'var(--m-load, var(--ink-2))'
const ROLE_LOAD = { coordinator: 68, helper: 57, shadow: 41, manager: 52, default: 34, spawned: 22 }
const CHART_N = 24
const CHART_SPAN_MIN = 30
const TUNING = {
  ctx: (value) => `${Math.round(40 + value * 1.6)}k`,
  wake: (value) => `${Math.max(1, Math.round(value * 0.6))}m`,
  auto: (value) => value < 34 ? 'low' : value < 67 ? 'med' : 'high',
}

const escapeMarkup = (value) => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]))
const graphRole = (role) => ({
  controller: 'coordinator',
  'coordinator-assistant': 'shadow',
  manager: 'manager',
  worker: 'spawned',
  builder: 'helper',
}[role] || 'default')

function projectedComputer(computer, projection) {
  const byId = new Map(projection.nodes.map(node => {
    const bornAt = Number.isSafeInteger(node.bornAt) && node.bornAt >= 0 ? node.bornAt : null
    const stoppedAt = bornAt !== null && Number.isSafeInteger(node.stoppedAt) && node.stoppedAt >= bornAt
      ? node.stoppedAt
      : null
    return [node.id, {
      id: node.id,
      name: node.label,
      role: graphRole(node.role),
      declaredRole: node.role,
      provider: node.provider,
      model: node.provider,
      state: node.enabled ? 'enabled' : 'disabled',
      origin: node.origin === 'user' || node.origin === 'self' ? node.origin : null,
      bornAt,
      stoppedAt,
      tasksDone: Number.isSafeInteger(node.tasksDone) && node.tasksDone >= 0 ? node.tasksDone : null,
      failRate: Number.isFinite(node.failRate) && node.failRate >= 0 && node.failRate <= 100 ? node.failRate : null,
      context: [],
      projectionUnavailableReason: 'not provided by fleet projection',
    }]
  }))
  const edges = projection.edges.map(edge => ({ ...edge }))

  const wouldCycle = (child, parent) => {
    let current = parent
    const seen = new Set()
    while (current?.parentId && !seen.has(current.id)) {
      if (current.id === child.id) return true
      seen.add(current.id)
      current = byId.get(current.parentId)
    }
    return current?.id === child.id
  }
  const layoutEdges = [...edges].sort((left, right) =>
    (left.sourceKind === 'observed' ? 0 : 1) - (right.sourceKind === 'observed' ? 0 : 1))
  for (const edge of layoutEdges) {
    if (edge.type !== 'manages' && edge.type !== 'delegates_to') continue
    const parent = byId.get(edge.from)
    const child = byId.get(edge.to)
    if (!parent || !child || child.parentId || parent.id === child.id || wouldCycle(child, parent)) continue
    child.parentId = parent.id
  }

  const tier = { controller: 0, manager: 1, 'coordinator-assistant': 1 }
  for (const agent of byId.values()) {
    agent.tierRank = tier[agent.declaredRole] ?? 2
    if (agent.tierRank === 2) agent.role = 'spawned'
    agent.cullable = agent.tierRank === 2
    const originRank = agent.origin === 'user' ? 0 : agent.origin === 'self' ? 2 : 1
    agent.cullRank = originRank * 2 + (agent.state === 'enabled' ? 0 : 1)
  }

  const agents = [...byId.values()]
  return {
    id: computer.id,
    name: computer.label,
    ip: `${computer.services.length} services`,
    note: computer.sourceKind,
    spawnedTotal: agents.length,
    agents,
    services: computer.services,
    graphEdges: edges,
    graphRevision: projection.revision,
    projection: true,
    reparentAgent(agentId, parentId) {
      const agent = byId.get(agentId)
      const parent = byId.get(parentId)
      if (!agent || !parent || agent === parent || agent.role === 'coordinator') return false
      let current = parent
      const seen = new Set()
      while (current && !seen.has(current.id)) {
        if (current.id === agent.id) return false
        seen.add(current.id)
        current = current.parentId ? byId.get(current.parentId) : null
      }
      agent.parentId = parent.id
      return true
    },
  }
}

function projectionComputers(data) {
  const graph = data?.graph
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || !Array.isArray(data?.computers)) return []
  return data.computers.map(computer => projectedComputer(computer, graph))
}

function projectionMonitorContext(agent) {
  return {
    current: `role: ${agent.declaredRole}`,
    previous: `state: ${agent.state}`,
    chat: null,
    tasks: agent.tasksDone,
    failRate: agent.failRate,
    model: agent.provider,
  }
}

function monitorContextFor(agent) {
  let hash = 2166136261
  for (let index = 0; index < agent.name.length; index += 1) {
    hash ^= agent.name.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  const seed = 3
  const span = Math.max(1, CHAT.length - seed)
  const start = (hash >>> 0) % span
  const recent = CHAT.slice(start, start + seed).at(-1)
  return {
    current: agent.context?.at(-1),
    previous: agent.context?.at(-2),
    chat: recent?.text || '',
    tasks: agent.tasksDone,
    failRate: agent.failRate,
    model: agent.model,
  }
}

const agentSeries = new Map()
function seriesFor(agent) {
  if (agentSeries.has(agent.id)) return agentSeries.get(agent.id)
  if (agentSeries.size > 240) agentSeries.clear()
  let seed = 2166136261
  for (let index = 0; index < agent.id.length; index += 1) {
    seed ^= agent.id.charCodeAt(index)
    seed = Math.imul(seed, 16777619)
  }
  seed >>>= 0
  const random = () => {
    seed ^= seed << 13; seed >>>= 0
    seed ^= seed >>> 17
    seed ^= seed << 5; seed >>>= 0
    return seed / 4294967296
  }
  const base = ROLE_LOAD[agent.role] ?? 40
  const amplitude = 10 + random() * 13
  const phase = random() * Math.PI * 2
  const values = Array.from({ length: CHART_N }, (_, index) => Math.max(3, Math.min(97,
    base
    + amplitude * Math.sin((index + phase) / 3.4)
    + amplitude * 0.42 * Math.sin((index + phase) / 1.25 + 1.7)
    + (random() - 0.5) * 9)))
  agentSeries.set(agent.id, values)
  return values
}

function agentChartBox(agent) {
  const values = seriesFor(agent)
  const box = el(`
    <div class="board-box board-chart-box">
      <div class="board-box-h">
        <span class="bh-t">Runtime Statistics</span>
        <span class="bh-v"><i></i><span><b class="bc-now">${Math.round(values.at(-1))}</b>%</span></span>
      </div>
      <div class="board-cap">agent activity · last ${CHART_SPAN_MIN} min</div>
      <div class="board-plot"><div class="bc-canvas" role="img" aria-label="${escapeMarkup(agent.name)} activity over the last ${CHART_SPAN_MIN} minutes"></div></div>
    </div>`)
  const canvas = box.querySelector('.bc-canvas')
  let chart = null
  let themeObserver = null

  const theme = () => {
    const rootStyle = getComputedStyle(document.documentElement)
    const scopeStyle = getComputedStyle(box)
    const read = (style, name, fallback) => style.getPropertyValue(name).trim() || fallback
    return {
      role: read(scopeStyle, '--rc', '#008dab'),
      ink2: read(rootStyle, '--ink-2', '#4f5f70'),
      grid: read(rootStyle, '--chart-grid', 'rgba(14,23,38,0.07)'),
      cross: read(rootStyle, '--chart-cross', 'rgba(14,23,38,0.24)'),
      mono: read(rootStyle, '--font-mono', 'ui-monospace, monospace'),
    }
  }
  const data = () => values.map((value, index) => [
    -CHART_SPAN_MIN + index * (CHART_SPAN_MIN / (CHART_N - 1)),
    +value.toFixed(2),
  ])
  const paint = () => {
    if (!chart || chart.isDisposed()) return
    const current = theme()
    chart.setOption({
      animation: false,
      backgroundColor: 'transparent',
      color: [current.role],
      grid: { left: 34, right: 10, top: 12, bottom: 30 },
      xAxis: {
        type: 'value', min: -CHART_SPAN_MIN, max: 0, interval: CHART_SPAN_MIN / 2,
        axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false },
        axisLabel: {
          color: current.ink2, fontFamily: current.mono, fontSize: 12.5, margin: 10,
          formatter: (value) => value === 0 ? 'now' : `${value}m`,
        },
      },
      yAxis: {
        type: 'value', min: 0, max: 100, interval: 50,
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: current.ink2, fontFamily: current.mono, fontSize: 12.5, margin: 8 },
        splitLine: { show: true, lineStyle: { color: current.grid, width: 1 } },
      },
      tooltip: {
        appendToBody: true, confine: true, transitionDuration: 0, padding: 0,
        borderWidth: 0, backgroundColor: 'transparent', extraCssText: 'box-shadow:none;',
        trigger: 'axis',
        axisPointer: { type: 'cross', snap: true, label: { show: false }, lineStyle: { color: current.cross, width: 1 } },
        formatter: (params) => {
          const point = params[0]
          if (!point) return ''
          const [minutes, value] = point.value
          const ago = Math.abs(Math.round(minutes))
          return `<div class="mtip"><div class="tt-title">${escapeMarkup(agent.name)}</div><b>${Math.round(value)}%</b> active · ${ago ? `${ago} min ago` : 'now'}</div>`
        },
      },
      series: [{
        id: 'agent-activity', type: 'line', data: data(), smooth: 0.28,
        symbol: 'none', showSymbol: false,
        lineStyle: { color: current.role, width: 2, cap: 'round', join: 'round' },
        itemStyle: { color: current.role },
        areaStyle: { color: withAlpha(current.role, 0.08) },
      }],
    }, true)
  }

  const resizeObserver = new ResizeObserver(() => chart?.resize())
  resizeObserver.observe(canvas)
  return {
    el: box,
    mount() {
      if (chart) return
      chart = echarts.init(canvas, null, { renderer: 'svg' })
      paint()
      if (typeof MutationObserver !== 'undefined') {
        themeObserver = new MutationObserver(paint)
        themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
      }
    },
    destroy() {
      resizeObserver.disconnect()
      themeObserver?.disconnect()
      if (chart && !chart.isDisposed()) chart.dispose()
      chart = null
    },
  }
}

export function computersView({ initialComputer = null, navigate }) {
  let liveMode = isLiveView('computers')
  let liveComputers = []
  let computer = liveMode ? null : (sim.computers.find(candidate => candidate.id === initialComputer) || sim.computers[0])
  let graph = null
  let canvas = null
  let boardChart = null
  let boardRing = null
  let boardClock = 0
  let railDisposeTimer = 0
  let destroyed = false
  let fetchVersion = 0
  const unsubs = []
  let sourceUnsubs = []

  const root = el(`
    <div class="computers">
      <div class="tabs"></div>
      <div class="comp-body">
        <div class="graph-wrap glass">
          <div class="graph-title"></div>
          <div class="graph-crumb"></div>
          <div class="graph-hint">Select a node to focus its branch</div>
          <div class="graph-tools">
            <button class="graph-reset-btn" type="button" hidden>Reset positions</button>
            <button class="graph-edit-btn" type="button" title="Edit the role hierarchy">Edit</button>
          </div>
          <div class="graph-edit-note">drag onto a parent or into empty space</div>
        </div>
        <aside class="rail glass">
          <div class="rail-page stats-page is-active"></div>
          <div class="rail-page ctl-page board-page"></div>
        </aside>
      </div>
    </div>`)

  const tabsElement = root.querySelector('.tabs')
  const graphWrap = root.querySelector('.graph-wrap')
  const graphTitle = root.querySelector('.graph-title')
  const crumbElement = root.querySelector('.graph-crumb')
  const hintElement = root.querySelector('.graph-hint')
  const railElement = root.querySelector('.rail')
  const statsPage = root.querySelector('.stats-page')
  const controlsPage = root.querySelector('.ctl-page')
  const editButton = root.querySelector('.graph-edit-btn')
  const resetButton = root.querySelector('.graph-reset-btn')

  function clearBoard() {
    clearInterval(boardClock)
    boardClock = 0
    boardRing = null
    boardChart?.destroy()
    boardChart = null
  }

  function activateRail(page) {
    clearTimeout(railDisposeTimer)
    statsPage.classList.toggle('is-active', page === statsPage)
    controlsPage.classList.toggle('is-active', page === controlsPage)
    if (page === statsPage) railDisposeTimer = setTimeout(clearBoard, 200)
  }

  function syncResetButton() {
    resetButton.hidden = !(graph?.editMode && graph.hasPositionOverrides())
  }

  function syncEditButton() {
    const editing = !!graph?.editMode
    editButton.textContent = editing ? 'Done' : 'Edit'
    editButton.classList.toggle('on', editing)
    editButton.setAttribute('aria-pressed', editing ? 'true' : 'false')
    graphWrap.classList.toggle('editing', editing)
    syncResetButton()
  }

  editButton.addEventListener('click', () => {
    if (!graph) return
    graph.setEditMode(!graph.editMode)
    syncEditButton()
  })
  resetButton.addEventListener('click', () => {
    graph?.resetPositions()
    syncResetButton()
  })

  function renderTabs() {
    tabsElement.innerHTML = ''
    const computers = liveMode ? liveComputers : sim.computers
    for (const candidate of computers) {
      const tab = el(`<button class="tab ${candidate === computer ? 'active' : ''}">${escapeMarkup(candidate.name)}<span class="ip">${escapeMarkup(candidate.ip)}</span></button>`)
      tab.addEventListener('click', () => switchComputer(candidate))
      tabsElement.appendChild(tab)
    }
    if (!liveMode) {
      const add = el('<button class="tab add" type="button" title="Connect a computer">+</button>')
      add.addEventListener('click', () => {
        const next = sim.addComputer()
        switchComputer(next)
      })
      tabsElement.appendChild(add)
    }
  }

  function switchComputer(next) {
    if (!next || next === computer) return
    computer = next
    renderTabs()
    mountGraph()
    showStats()
  }

  function renderCrumb(rootId, chain = []) {
    crumbElement.innerHTML = ''
    if (!rootId) return
    const machine = el('<button type="button"></button>')
    machine.textContent = `← ${computer.name}`
    machine.addEventListener('click', () => graph?.clearRoot())
    crumbElement.appendChild(machine)
    chain.forEach((hop, index) => {
      crumbElement.appendChild(el('<span class="sep">/</span>'))
      if (index < chain.length - 1) {
        const button = el('<button type="button" class="crumb-hop"></button>')
        button.textContent = hop.name
        button.addEventListener('click', () => graph?.setRoot(hop.id))
        crumbElement.appendChild(button)
      } else {
        const current = el('<span><b></b></span>')
        current.querySelector('b').textContent = hop.name
        crumbElement.appendChild(current)
      }
    })
  }

  function clearMountedGraph() {
    graph?.destroy()
    graph = null
    canvas?.remove()
    canvas = null
    if (window.__mcGraph && window.__mcGraph._destroyed) window.__mcGraph = undefined
  }

  function mountGraph() {
    clearMountedGraph()
    if (!computer) return
    graphTitle.textContent = computer.name
    canvas = el('<div class="computer-tree-canvas"></div>')
    graphWrap.insertBefore(canvas, graphTitle)
    graph = new StaticTreeGraph(canvas, {
      computer,
      screenChips: true,
      contextFeed: liveMode ? projectionMonitorContext : monitorContextFor,
      edges: liveMode ? computer.graphEdges : null,
      onReparent: liveMode ? ((agentId, parentId) => computer.reparentAgent(agentId, parentId)) : null,
      onOpenControls: (agent) => showControls(agent),
      onRootChange: renderCrumb,
      onOverridesChange: syncResetButton,
    })
    graph.onDensity = (dense) => hintElement.classList.toggle('show', dense)
    graph.updateDensity()
    window.__mcGraph = graph
    renderCrumb(null)
    syncEditButton()
  }

  function renderStats() {
    if (!computer) return
    if (liveMode) {
      renderLiveStats()
      return
    }
    const active = computer.agents.length
    statsPage.innerHTML = `
      <div class="rail-title">Runtime Statistics</div>
      <div class="rail-scroll">
        <div class="stat-hero"><span class="v" id="agent-count">${computer.spawnedTotal}</span><span class="l">Agent Count</span></div>
        <div class="rail-sub">${active} live now · ${escapeMarkup(computer.name.toLowerCase())} · ${escapeMarkup(computer.note)}</div>
        <div class="rail-sec">Load</div>
        <div class="bars">
          ${BAR_DEFS.map(definition => `
            <div class="bar-row" data-k="${definition.key}">
              <span class="bl">${definition.label}</span>
              <div class="bar-track"><div class="bar-fill" style="--bc:${BAR_C};transform:scaleX(0)"></div></div>
              <span class="bv">0%</span>
            </div>`).join('')}
        </div>
        <div class="rail-sec">Tasks</div>
        <div class="task-list"></div>
        <div class="rail-sec">Legend</div>
        <div class="legend">
          ${Object.entries(ROLES).map(([key, role]) => `
            <div class="leg ${key === 'spawned' ? 'off' : ''}" style="--lc:${role.hex}"><i></i>${escapeMarkup(role.label)}</div>`).join('')}
        </div>
      </div>`
    updateBars()
    updateTasks()
  }

  function renderLiveStats() {
    const services = computer.services || []
    statsPage.innerHTML = `
      <div class="rail-title">Fleet Projection</div>
      <div class="rail-scroll" data-live-mode="live" data-projection-state="available">
        <div class="stat-hero"><span class="v" id="agent-count">${computer.spawnedTotal}</span><span class="l">Declared graph nodes</span></div>
        <div class="rail-sub">${escapeMarkup(computer.name)} · ${escapeMarkup(computer.note)} source · graph revision ${computer.graphRevision ?? 'unavailable'}</div>
        <div class="rail-sec">Services</div>
        <div class="task-list projection-state">
          ${services.length ? services.map(service => {
            const meta = [service.state, service.detail].filter(Boolean).join(' · ').replace(/\s--\s/g, ' — ')
            return `<div class="task-chip" data-service-id="${escapeMarkup(service.id)}"><i></i><b>${escapeMarkup(service.name)}</b><span class="svc-meta">${escapeMarkup(meta)}</span></div>`
          }).join('') : '<div class="rail-sub">No services declared by fleet projection</div>'}
        </div>
        <div class="rail-sec">Declared graph</div>
        <div class="rail-sub">${computer.graphEdges.length} declared relationships · runtime, load, tasks, and messages unavailable · not provided by fleet projection</div>
      </div>`
  }

  function updateBars() {
    if (liveMode || !computer || !statsPage.isConnected) return
    for (const definition of BAR_DEFS) {
      const row = statsPage.querySelector(`.bar-row[data-k="${definition.key}"]`)
      if (!row) continue
      const value = Math.round(computer.stats[definition.key])
      row.querySelector('.bar-fill').style.transform = `scaleX(${(value / 100).toFixed(4)})`
      row.querySelector('.bv').textContent = `${value}%`
    }
    const count = statsPage.querySelector('#agent-count')
    if (count) count.textContent = String(computer.spawnedTotal)
  }

  function updateTasks() {
    if (liveMode || !computer) return
    const list = statsPage.querySelector('.task-list')
    if (!list) return
    const seen = new Set()
    const wanted = computer.tasks.filter(task => !seen.has(task.text) && seen.add(task.text)).slice(0, 8)
    const existing = new Map([...list.children].map(node => [node.dataset.taskId, node]))
    let previous = null
    for (const task of wanted) {
      let node = existing.get(task.id)
      if (node) existing.delete(task.id)
      else {
        const role = ROLES[task.role] || ROLES.default
        node = el(`<span class="task-chip" data-task-id="${task.id}" style="--tc:${role.hex}"><i></i>${escapeMarkup(task.text)}</span>`)
      }
      node.classList.toggle('done', !!task.done)
      const target = previous ? previous.nextSibling : list.firstChild
      if (node !== target) list.insertBefore(node, target)
      previous = node
    }
    for (const node of existing.values()) node.remove()
  }

  function showStats() {
    renderStats()
    activateRail(statsPage)
  }

  function rangeFill(input) {
    const set = () => {
      const percent = ((input.value - input.min) / (input.max - input.min)) * 100
      input.style.setProperty('--fill', `${percent}%`)
    }
    input.addEventListener('input', set)
    set()
  }

  function showControls(agent) {
    if (liveMode) {
      showProjectionControls(agent)
      return
    }
    clearBoard()
    const role = ROLES[agent.role] || ROLES.default
    controlsPage.style.setProperty('--rc', role.hex)
    controlsPage.innerHTML = `
      <div class="rail-title"><button class="rail-back" type="button">‹ Statistics</button><span class="spacer"></span>Agent Controls</div>
      <div class="rail-scroll">
        <div class="agent-head board-head"><span class="role-dot"></span><div><div class="an">${escapeMarkup(agent.name)}</div><div class="ar">${escapeMarkup(role.label)}</div></div></div>
        <div class="agent-ring-wrap"></div>
        <div class="rail-sub board-meta">
          <span>${escapeMarkup(agent.model)} · ${escapeMarkup(agent.pool)}</span>
          <span>${agent.tasksDone} tasks · <em class="sev-${agent.failRate < 2 ? 'good' : agent.failRate < 5 ? 'warn' : 'serious'}">${agent.failRate}% fail</em></span>
        </div>
        <div class="board-box board-chat-box"></div>
        <div class="board-chart-slot"></div>
        <div class="board-box board-ctl-box">
          <div class="board-box-h"><span class="bh-t">Tuning</span></div>
          <div class="ctl-row" data-t="ctx"><span class="cl">Context budget</span><input type="range" min="0" max="100" value="62"/><span class="cv"></span></div>
          <div class="ctl-row" data-t="wake"><span class="cl">Wake interval</span><input type="range" min="0" max="100" value="35"/><span class="cv"></span></div>
          <div class="ctl-row" data-t="auto"><span class="cl">Autonomy</span><input type="range" min="0" max="100" value="80"/><span class="cv"></span></div>
        </div>
        <div class="board-box board-legend-box">
          <div class="board-box-h"><span class="bh-t">Legend</span></div>
          <div class="legend board-legend">
            ${Object.entries(ROLES).map(([key, item]) => `
              <div class="leg ${key === agent.role ? 'is-self' : ''}" style="--lc:${item.hex}"><i></i>${escapeMarkup(item.label)}</div>`).join('')}
          </div>
        </div>
      </div>
      <div class="board-actions">
        <div class="ctl-grid">
          <button class="ctl-btn armed" data-a="pause">Pause</button>
          <button class="ctl-btn" data-a="resume">Resume</button>
          <button class="ctl-btn" data-a="respawn">Respawn</button>
          <button class="ctl-btn danger" data-a="terminate">Terminate</button>
        </div>
        <button class="ctl-btn" data-a="open">Open full view</button>
      </div>`

    const chatBox = controlsPage.querySelector('.board-chat-box')
    chatBox.appendChild(buildChat({
      title: agent.name,
      subtitle: `${role.label} · direct line`,
      roleKey: agent.role,
      seed: 6,
    }))
    chatBox.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && event.target.closest?.('.chat-input')) {
        event.stopPropagation()
        event.target.blur()
      }
    })

    const ringSize = Math.max(180, Math.min(214, (railElement.clientWidth || 320) - 130))
    boardRing = uptimeRing({
      size: ringSize,
      epoch: agent.bornAt,
      colors: [`color-mix(in oklab, ${role.hex} 35%, var(--sheet))`, role.hex],
      caption: 'Runtime',
      showDays: false,
    })
    controlsPage.querySelector('.agent-ring-wrap').appendChild(boardRing.el)
    boardClock = setInterval(() => boardRing?.update(), 1000)

    boardChart = agentChartBox(agent)
    controlsPage.querySelector('.board-chart-slot').replaceWith(boardChart.el)
    boardChart.mount()

    controlsPage.querySelector('.rail-back').addEventListener('click', showStats)
    controlsPage.querySelector('[data-a="open"]').addEventListener('click', () => {
      const record = graph?.nodes.get(agent.id)
      const target = record?.el || boardRing?.el || graphWrap
      const bounds = target.getBoundingClientRect()
      setViewMorph({ kind: 'zoom', x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 })
      navigate(`#/agent/${computer.id}/${agent.id}`)
    })
    controlsPage.querySelectorAll('.ctl-btn[data-a]:not([data-a="open"])').forEach(button => {
      button.addEventListener('click', () => {
        controlsPage.querySelectorAll('.ctl-btn.armed').forEach(item => item.classList.remove('armed'))
        button.classList.add('armed')
      })
    })
    controlsPage.querySelectorAll('input[type="range"]').forEach(rangeFill)
    controlsPage.querySelectorAll('.ctl-row[data-t]').forEach(row => {
      const input = row.querySelector('input')
      const value = row.querySelector('.cv')
      const update = () => { value.textContent = TUNING[row.dataset.t](+input.value) }
      input.addEventListener('input', update)
      update()
    })
    activateRail(controlsPage)
  }

  function showProjectionControls(agent) {
    clearBoard()
    const role = ROLES[agent.role] || ROLES.default
    controlsPage.style.setProperty('--rc', role.hex)
    const runtime = Number.isFinite(agent.bornAt)
      ? fmtRuntime(agent.bornAt, Number.isFinite(agent.stoppedAt) ? agent.stoppedAt : Date.now())
      : null
    const taskSummary = Number.isFinite(agent.tasksDone)
      ? `${agent.tasksDone} tasks${Number.isFinite(agent.failRate) ? ` · ${agent.failRate}% fail` : ''}`
      : null
    const missing = [runtime === null ? 'runtime' : null, taskSummary === null ? 'task telemetry' : null, 'chat', 'tuning', 'activity'].filter(Boolean)
    controlsPage.innerHTML = `
      <div class="rail-title"><button class="rail-back" type="button">‹ Fleet projection</button><span class="spacer"></span>Declared node</div>
      <div class="rail-scroll" data-live-mode="live" data-projection-state="available">
        <div class="agent-head board-head"><span class="role-dot"></span><div><div class="an">${escapeMarkup(agent.name)}</div><div class="ar">${escapeMarkup(agent.declaredRole)}</div></div></div>
        <div class="board-box board-ctl-box projection-state">
          <div class="board-box-h"><span class="bh-t">Projection register</span></div>
          <div class="rail-sub">ID · ${escapeMarkup(agent.id)}</div>
          <div class="rail-sub">Provider · ${escapeMarkup(agent.provider)}</div>
          <div class="rail-sub">State · ${escapeMarkup(agent.state)}</div>
          <div class="rail-sub">Origin · ${escapeMarkup(agent.origin || 'unresolved')}</div>
          ${runtime === null ? '' : `<div class="rail-sub">Runtime · ${escapeMarkup(runtime)}</div>`}
          ${taskSummary === null ? '' : `<div class="rail-sub">${escapeMarkup(taskSummary)}</div>`}
          <div class="projection-unavailable">${escapeMarkup(missing.join(', '))} unavailable · ${escapeMarkup(agent.projectionUnavailableReason)}</div>
        </div>
      </div>
      <div class="board-actions"><button class="ctl-btn" data-a="open">Open full view</button></div>`
    controlsPage.querySelector('.rail-back').addEventListener('click', showStats)
    controlsPage.querySelector('[data-a="open"]').addEventListener('click', () => navigate(`#/agent/${computer.id}/${agent.id}`))
    activateRail(controlsPage)
  }

  function clearSourceUnsubs() {
    sourceUnsubs.forEach(unsubscribe => unsubscribe())
    sourceUnsubs = []
  }

  function mountSimulation() {
    fetchVersion += 1
    clearSourceUnsubs()
    clearMountedGraph()
    liveMode = false
    liveComputers = []
    root.dataset.liveMode = 'simulated'
    root.dataset.projectionState = 'simulated'
    computer = sim.computers.find(candidate => candidate.id === initialComputer) || sim.computers[0]
    renderTabs()
    mountGraph()
    showStats()
    sourceUnsubs.push(sim.on('stats', updateBars))
    sourceUnsubs.push(sim.on('tasks', updateTasks))
    sourceUnsubs.push(sim.on('spawn', ({ comp }) => { if (comp === computer) updateBars() }))
  }

  function showProjectionUnavailable(reason, loading = false) {
    clearSourceUnsubs()
    clearMountedGraph()
    clearBoard()
    liveMode = true
    liveComputers = []
    computer = null
    root.dataset.liveMode = 'live'
    root.dataset.projectionState = loading ? 'loading' : 'unavailable'
    tabsElement.innerHTML = ''
    graphTitle.textContent = ''
    crumbElement.innerHTML = ''
    hintElement.classList.remove('show')
    statsPage.innerHTML = `<div class="projection-unavailable" data-live-mode="live" data-projection-state="${loading ? 'loading' : 'unavailable'}">${loading ? 'Fleet projection loading…' : `Fleet projection unavailable · ${escapeMarkup(reason)}`}</div>`
    controlsPage.innerHTML = ''
    activateRail(statsPage)
  }

  function mountProjection(data) {
    const next = projectionComputers(data)
    if (!next.length) {
      showProjectionUnavailable('fleet projection has no usable computers or declared graph')
      return
    }
    clearSourceUnsubs()
    clearMountedGraph()
    liveMode = true
    liveComputers = next
    root.dataset.liveMode = 'live'
    root.dataset.projectionState = 'available'
    computer = next.find(candidate => candidate.id === initialComputer) || next[0]
    renderTabs()
    mountGraph()
    showStats()
  }

  function loadProjection() {
    const version = ++fetchVersion
    showProjectionUnavailable('', true)
    fetchFleet().then(result => {
      if (destroyed || version !== fetchVersion || !isLiveView('computers')) return
      if (!result.ok) showProjectionUnavailable(result.reason)
      else mountProjection(result.data.data)
    }).catch(error => {
      if (destroyed || version !== fetchVersion || !isLiveView('computers')) return
      showProjectionUnavailable(`fleet projection request failed: ${error?.message || error}`)
    })
  }

  const onLiveFlag = (event) => {
    if (event.detail?.view !== 'computers' || destroyed) return
    if (event.detail.live) loadProjection()
    else mountSimulation()
  }
  window.addEventListener(LIVE_FLAGS_EVENT, onLiveFlag)
  unsubs.push(() => window.removeEventListener(LIVE_FLAGS_EVENT, onLiveFlag))

  if (liveMode) loadProjection()
  else mountSimulation()

  return {
    el: root,
    destroy() {
      destroyed = true
      fetchVersion += 1
      clearTimeout(railDisposeTimer)
      clearBoard()
      clearSourceUnsubs()
      clearMountedGraph()
      unsubs.forEach(unsubscribe => unsubscribe())
    },
  }
}

export function rangeFill(input) {
  const set = () => {
    const percent = ((input.value - input.min) / (input.max - input.min)) * 100
    input.style.setProperty('--fill', `${percent}%`)
  }
  input.addEventListener('input', set)
  set()
}
