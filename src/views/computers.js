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
import {
  LAUNCH_TIERS, launchTier, tierArgvFragment, UNSUPPORTED_CONTROLS,
  CAP_BOUNDS, clampCapMs, capMinutes, sandboxLevel,
} from '../orchestration-controls.js'
import { planNodeChatbox, channelCaption, onChatboxSettingsChanged } from '../node-chatbox.js'
/* COPY and readLocalSessions are borrowed rather than rewritten: the home
   screen already says these sentences, and a second wording for "some agents
   are hidden" would let page 1 and page 2 describe the same setting
   differently. src/local-activity.js is the shared owner of both. */
import { COPY, readLocalSessions } from '../local-activity.js'
import { isWriteEnabled } from '../write-flags.js'
import { bridgeReachable, bridgeStatus, postBridgeAction } from '../mission-bridge.js'
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

/* WHAT USED TO BE HERE, AND WHY IT IS GONE.
 *
 * Three sliders — "Context budget", "Wake interval", "Autonomy" — and four
 * buttons — Pause, Resume, Respawn, Terminate. Every one of them was inert.
 * The sliders' entire click handler wrote a formatted string into the <span>
 * beside them; the buttons' entire click handler moved an `armed` CSS class
 * from one button to the next. Nothing was stored, nothing was sent, and the
 * page reported no failure because nothing had been attempted.
 *
 * The owner named this class of defect exactly: "dont lie like we cant control
 * temperature". A control that moves and reports success while changing
 * nothing is worse than a missing control, because a missing control can be
 * asked for and a lying one is believed.
 *
 * They are replaced by src/orchestration-controls.js, where every knob carries
 * the file:line that proves it reaches the child process, and the knobs that
 * do not exist are NAMED as not existing rather than quietly left out. */

const escapeMarkup = (value) => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]))
/* Colour follows entity: the shadow manager is the SHADOW hue on every
   surface, and the coordinator's assistant is the helper hue the legend
   already names "Coordinator's Helper". Before this, shadow-manager fell
   through to the default bucket and then had its role overwritten entirely,
   so the fleet's own shadow manager printed as a grey "AGENT SPAWNED". */
const graphRole = (role) => ({
  controller: 'coordinator',
  'shadow-manager': 'shadow',
  'coordinator-assistant': 'helper',
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

  const tier = { controller: 0, manager: 1, 'coordinator-assistant': 1, 'shadow-manager': 1 }
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

/* Every live card used to read "role: manager / state: disabled" — the same two
   lines on every block, and the role is already the caption under the circle
   and the colour of the brace. The card now carries what the projection
   actually observed, and where the projection carries no activity it SAYS so
   once, in the dim register, instead of padding itself with declared facts.
   The missing thing is real: fleet.json has no per-agent transcript or
   activity feed, so there is nothing truthful to put on those lines today. */
function projectionMonitorContext(agent) {
  const origin = agent.origin === 'user' ? 'owner-started'
    : agent.origin === 'self' ? 'self-started'
      : null
  return {
    current: [agent.state, origin].filter(Boolean).join(' · ') || null,
    previous: null,
    chat: null,
    // Short, because it repeats on every card. The rail's DECLARED GRAPH block
    // already carries the full reason once, where a reason belongs.
    unavailable: 'no activity observed',
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
  /* The runs half of the chatbox. Read once per view from the same spawn
     record the home screen reads, never per node click, and left as an empty
     list when this copy has no computer to ask — readLocalSessions() already
     distinguishes "no runs" from "could not read" from "nobody to ask", so
     this view does not get to invent a fourth answer. */
  let railRuns = []
  /* Whether a run record can be READ AT ALL, kept separate from whether it
     currently holds anything. `supported: false` means there was nobody to ask
     — a browser with no shell behind it — and that is not the same fact as an
     empty list. src/chatbox-feed.js's availability flags are about the source,
     so the source's existence is what has to be passed to them. */
  let railRunsSupported = false
  let railChatUnsub = null

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
    /* The rail's chat re-plans on a window event. Every node click builds a new
       one, so the previous node's listener has to go with the previous panel or
       a session spent clicking around the tree leaves one attached per click. */
    railChatUnsub?.()
    railChatUnsub = null
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

  /* The three lifecycle buttons this page cannot perform, rendered as disabled
     with the reason on each one. They are kept rather than deleted because the
     owner asked for the buttons, and because a person who remembers a Pause
     button and now finds nothing will assume the page is broken. Saying "there
     is no bridge action for this" is the honest version of showing a button
     that quietly rearranges a CSS class. This is the same posture the agent
     drill-in already ships (src/views/agent.js). */
  const DEAD_ACTIONS = Object.freeze([
    Object.freeze({ id: 'pause', label: 'Pause', why: 'Pause unavailable: the audited bridge has no pause action, and a running lane cannot be suspended.' }),
    Object.freeze({ id: 'resume', label: 'Resume', why: 'Resume unavailable: nothing can be paused, so nothing can be resumed.' }),
    Object.freeze({ id: 'respawn', label: 'Respawn', why: 'Respawn unavailable from this page: respawn is performed by the supervisor sweep from a persisted checkpoint, not by a click here.' }),
  ])

  function deadActionButtons() {
    return DEAD_ACTIONS.map(action => `<button class="ctl-btn" type="button" disabled data-a="${action.id}" title="${escapeMarkup(action.why)}" aria-label="${escapeMarkup(action.why)}">${escapeMarkup(action.label)}</button>`).join('')
  }

  /* One bridge preparation per view, not one per node click. bridgeStatus()
     parses every root's queue and writes durable audit receipts (~12s measured,
     see src/write-surfaces.js), so calling it from a click handler that fires
     every time somebody selects a node would turn a cheap gesture into a
     repeated expensive one. */
  let bridgePrep = null
  function prepareBridgeOnce() {
    if (!bridgePrep) {
      bridgePrep = (async () => {
        const reach = await bridgeReachable()
        if (!reach.ok) return reach
        return bridgeStatus()
      })().catch(error => ({ ok: false, reason: error?.message || 'action bridge unreachable' }))
    }
    return bridgePrep
  }

  const launchKey = () => `mc.page2.launch.${computer?.id || 'unknown'}`
  function readLaunchSettings() {
    let stored = null
    try { stored = JSON.parse(localStorage.getItem(launchKey()) || 'null') } catch { stored = null }
    const tierId = launchTier(stored?.tier) ? stored.tier : LAUNCH_TIERS[0].id
    return { tier: tierId, capMs: clampCapMs(stored?.capMs ?? CAP_BOUNDS.defaultMs) }
  }
  function writeLaunchSettings(next) {
    try { localStorage.setItem(launchKey(), JSON.stringify(next)) } catch { /* session-only is still a real change */ }
  }

  /**
   * The control panel that replaced "Tuning".
   *
   * Every row here is either a knob that provably reaches the child process, or
   * a knob that does not exist and says so. There is deliberately no third
   * category. The argv line is not decoration: it is the actual fragment
   * capability/src/lib/mission-bridge/actions.js builds for the selected tier,
   * so a person can read what their choice does instead of trusting a label.
   */
  function launchControlsBox(agent) {
    const settings = readLaunchSettings()
    const dispatchEnabled = isWriteEnabled('dispatch')
    const box = el(`
      <div class="board-box board-ctl-box">
        <div class="board-box-h"><span class="bh-t">Launch controls</span></div>
        <div class="board-cap">what a lane started under this agent would run with</div>
        <label class="ctl-field"><span class="cl">Engine &amp; effort</span>
          <select class="ctl-select" data-launch="tier" aria-label="Launch tier">
            ${LAUNCH_TIERS.map(tier => `<option value="${escapeMarkup(tier.id)}"${tier.id === settings.tier ? ' selected' : ''}>${escapeMarkup(tier.label)} · ${escapeMarkup(tier.provider)}${tier.effort ? ` · ${escapeMarkup(tier.effort)}` : ''}</option>`).join('')}
          </select>
        </label>
        <div class="ctl-argv" data-launch="argv"></div>
        <label class="ctl-field"><span class="cl">Time cap</span>
          <input class="ctl-num" type="number" data-launch="cap" min="${capMinutes(CAP_BOUNDS.minMs)}" max="${capMinutes(CAP_BOUNDS.maxMs)}" step="1" value="${capMinutes(settings.capMs)}" aria-label="Run time cap in minutes"/>
          <span class="cv">min</span>
        </label>
        <div class="rail-sub" data-launch="cap-note">The lane's process tree is killed when this elapses.</div>
        <div class="ctl-field"><span class="cl">Sandbox</span><span class="cv" data-launch="sandbox">reading this computer's permission level…</span></div>
        <div class="rail-sub" data-launch="sandbox-note"></div>
        <div class="ctl-unsupported">
          <div class="cl">Not controllable, and why</div>
          ${UNSUPPORTED_CONTROLS.map(item => `<div class="ctl-unsupported-row"><b>${escapeMarkup(item.label)}</b><span>${escapeMarkup(item.reason)}</span><code>${escapeMarkup(item.evidence)}</code></div>`).join('')}
        </div>
        <div class="ctl-dispatch">
          <button class="ctl-btn" type="button" data-launch="dispatch"${dispatchEnabled ? '' : ' disabled'} title="${dispatchEnabled ? 'Start an audited lane nested under this agent' : 'Dispatch is switched off. Turn on “Dispatch agent lanes” in Settings to use it.'}">Dispatch a lane under ${escapeMarkup(agent.name)}</button>
          <output class="ctl-out" data-launch="out" role="status">${dispatchEnabled ? '' : 'dispatch is off in Settings'}</output>
        </div>
      </div>`)

    const tierSelect = box.querySelector('[data-launch="tier"]')
    const capInput = box.querySelector('[data-launch="cap"]')
    const argvLine = box.querySelector('[data-launch="argv"]')
    const output = box.querySelector('[data-launch="out"]')

    const paintArgv = () => {
      const fragment = tierArgvFragment(tierSelect.value) || []
      argvLine.textContent = fragment.join(' ')
    }
    const persist = () => {
      writeLaunchSettings({ tier: tierSelect.value, capMs: clampCapMs(Number(capInput.value) * 60_000) })
    }
    tierSelect.addEventListener('change', () => { paintArgv(); persist() })
    capInput.addEventListener('change', () => {
      capInput.value = String(capMinutes(clampCapMs(Number(capInput.value) * 60_000)))
      persist()
    })
    paintArgv()

    /* The sandbox is REPORTED, not chosen. Dispatch derives it from the
       machine's recorded install permission level and has no field for an
       explicit one, so a dropdown here would be a control the call cannot
       carry. What it can honestly do is tell the person which level they are
       on and what that level refuses. */
    void (async () => {
      const raw = await globalThis.mcAgent?.confinement?.().catch(() => null)
      if (!box.isConnected) return
      const level = sandboxLevel(raw?.level)
      const target = box.querySelector('[data-launch="sandbox"]')
      const note = box.querySelector('[data-launch="sandbox-note"]')
      if (!level) {
        target.textContent = 'not resolved'
        note.textContent = 'This copy could not read the computer’s permission level, so the sandbox a lane would run under is unknown.'
        return
      }
      target.textContent = `${raw.level} · ${level.codex}`
      note.textContent = level.summary
    })()

    const dispatchButton = box.querySelector('[data-launch="dispatch"]')
    if (dispatchEnabled) {
      dispatchButton.addEventListener('click', async () => {
        dispatchButton.disabled = true
        output.textContent = 'checking audited bridge…'
        const status = await prepareBridgeOnce()
        if (!box.isConnected) return
        const rootId = Array.isArray(status?.roots) ? status.roots[0] : null
        if (!status?.ok || !rootId) {
          output.textContent = `unavailable · ${status?.reason || 'no declared worktree root'}`
          dispatchButton.disabled = false
          return
        }
        output.textContent = 'dispatching…'
        const result = await postBridgeAction('dispatch', {
          rootId,
          tier: tierSelect.value,
          objectiveRef: `page2-${String(agent.id).replace(/[^a-z0-9_-]/gi, '-').slice(0, 60)}`,
          brief: `Lane requested from the fleet page, nested under ${agent.name}.`,
          cap: { kind: 'turns', value: 8, capMs: clampCapMs(Number(capInput.value) * 60_000) },
        })
        if (!box.isConnected) return
        dispatchButton.disabled = false
        output.textContent = result.ok
          ? `started · ${result.receipt.launchId}`
          : `refused · ${result.code || 'BRIDGE_REFUSED'} · ${result.reason}`
      })
    }
    return box
  }

  /**
   * The chatbox the owner asked for, in the rail, for the clicked node.
   *
   * What appears is decided by src/node-chatbox.js, which in turn defers to the
   * person's own chat settings (which agents, and whether runs appear) rather
   * than inventing a second filter that could disagree with the settings page.
   */
  function mountRailChat(agent, role) {
    const host = controlsPage.querySelector('.board-chat-box')
    if (!host) return
    const render = () => {
      if (!host.isConnected) return
      const plan = planNodeChatbox({
        agent,
        live: liveMode,
        sessionAvailable: false,
        sessionAgentId: null,
        turns: liveMode ? [] : [{ who: agent.id }],
        runs: railRuns,
        runsSupported: railRunsSupported,
      })
      host.innerHTML = ''
      host.dataset.chatChannel = plan.channel.kind
      if (plan.channel.kind === 'simulated' && plan.showContext) {
        host.appendChild(buildChat({
          title: agent.name,
          subtitle: channelCaption(plan.channel, role.label),
          roleKey: agent.role,
          seed: 6,
        }))
      } else {
        host.appendChild(el(`
          <div class="chat chat-readonly">
            <div class="chat-head"><span class="role-dot" style="background:${role.hex}"></span><div><div class="t">${escapeMarkup(agent.name)}</div><div class="s">${escapeMarkup(channelCaption(plan.channel, role.label))}</div></div></div>
            <div class="chat-log"></div>
            <div class="chat-nosend">${escapeMarkup(plan.composerReason || plan.contextHiddenReason || 'No channel to this agent.')}</div>
          </div>`))
      }
      const log = host.querySelector('.chat-log')
      if (plan.showRuns && plan.runs.length && log) {
        const runs = el('<div class="chat-runs"><div class="chat-runs-h">Runs on this computer</div></div>')
        for (const run of plan.runs.slice(-6)) {
          runs.appendChild(el(`<div class="chat-run"><b>#${escapeMarkup(String(run.sequence))}</b><span>${escapeMarkup(new Date(run.atMs).toLocaleString())}</span></div>`))
        }
        log.appendChild(runs)
      }
      /* "Everyone here is switched off" is not "nobody is talking", and the
         box must not draw one as the other. The wording and the way out are
         the home screen's own, so both screens describe this one setting
         identically.

         GATED ON showContext. `filteredToNothing` is a fact about the
         SELECTION and stays true when the conversation half is switched off
         entirely — so in "show only runs" this appended a complaint about the
         context filter to a box that was deliberately not showing context, and
         swallowed the runs-only sentence in the branch below. */
      if (plan.showContext && plan.filteredToNothing && log) {
        const chosen = COPY.chatboxNoAgentsChosen
        log.appendChild(el(`<div class="chat-empty"><b>${escapeMarkup(chosen.title)}</b><span>${escapeMarkup(chosen.body)}</span><a href="${escapeMarkup(chosen.action.href)}">${escapeMarkup(chosen.action.label)}</a></div>`))
      } else if (plan.emptyReason && !plan.turns.length && !plan.runs.length && log && !log.childElementCount) {
        log.appendChild(el(`<div class="chat-empty"><span>${escapeMarkup(plan.emptyReason)}</span></div>`))
      }
      /* heldAgents, not hiddenAgents: same gating. With the conversation half
         switched off, nobody is being "kept out by your own choice" — the
         whole half is gone, and saying otherwise blames the wrong setting. */
      if (plan.heldAgents > 0) {
        host.appendChild(el(`<div class="chat-hidden-note">${escapeMarkup(COPY.chatboxAgentsHeld(plan.heldAgents))}</div>`))
      }
    }
    host.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && event.target.closest?.('.chat-input')) {
        event.stopPropagation()
        event.target.blur()
      }
    })
    render()
    railChatUnsub?.()
    railChatUnsub = onChatboxSettingsChanged(render)
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
        <div class="board-box board-ctl-box"></div>
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
          ${deadActionButtons()}
        </div>
        <button class="ctl-btn" data-a="open">Open full view</button>
      </div>`

    mountRailChat(agent, role)
    controlsPage.querySelector('.board-ctl-box').replaceWith(launchControlsBox(agent))

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
    /* `chat` and `tuning` have left this list. They were correct while the rail
       had neither; now the rail has a chatbox that states its own channel, and
       a control box whose knobs are real. Leaving them here would have the
       panel report two things missing while they sit above it. */
    const missing = [runtime === null ? 'runtime' : null, taskSummary === null ? 'task telemetry' : null, 'activity'].filter(Boolean)
    controlsPage.innerHTML = `
      <div class="rail-title"><button class="rail-back" type="button">‹ Fleet projection</button><span class="spacer"></span>Declared node</div>
      <div class="rail-scroll" data-live-mode="live" data-projection-state="available">
        <div class="agent-head board-head"><span class="role-dot"></span><div><div class="an">${escapeMarkup(agent.name)}</div><div class="ar">${escapeMarkup(agent.declaredRole)}</div></div></div>
        <div class="board-box board-chat-box"></div>
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
        <div class="board-launch-slot"></div>
      </div>
      <div class="board-actions">
        <div class="ctl-grid">${deadActionButtons()}</div>
        <button class="ctl-btn" data-a="open">Open full view</button>
      </div>`
    mountRailChat(agent, role)
    controlsPage.querySelector('.board-launch-slot').replaceWith(launchControlsBox(agent))
    controlsPage.querySelector('.rail-back').addEventListener('click', showStats)
    controlsPage.querySelector('[data-a="open"]').addEventListener('click', () => navigate(`#/agent/${computer.id}/${agent.id}`))
    activateRail(controlsPage)
  }

  function loadRailRuns() {
    void (async () => {
      const raw = await globalThis.mcAgent?.history?.({}).catch(() => null)
      if (destroyed) return
      const local = readLocalSessions(raw ?? undefined)
      railRuns = local.runs
      railRunsSupported = local.supported
    })()
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

  loadRailRuns()
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
