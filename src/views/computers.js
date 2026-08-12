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
import { fetchFleet, fetchAgents } from '../live-status.js'
import {
  LAUNCH_TIERS, launchTier, tierArgvFragment, UNSUPPORTED_CONTROLS,
  CAP_BOUNDS, clampCapMs, capMinutes, sandboxLevel,
} from '../orchestration-controls.js'
import {
  TIER_AGENT_IDENTITY, TEAM_BOUNDS, planTeam, createTeamController,
} from '../agent-teams.js'
import {
  LOOP_BOUNDS, LOOP_OVERRUN, LOOP_RUN_CAP, planLoop, createLoopController,
} from '../agent-loops.js'
import { planNodeChatbox, channelCaption, onChatboxSettingsChanged } from '../node-chatbox.js'
/* COPY and readLocalSessions are borrowed rather than rewritten: the home
   screen already says these sentences, and a second wording for "some agents
   are hidden" would let page 1 and page 2 describe the same setting
   differently. src/local-activity.js is the shared owner of both. */
import { COPY, readLocalSessions } from '../local-activity.js'
import { isWriteEnabled } from '../write-flags.js'
import { cloudControlsBox } from '../cloud-tasks.js'
import { bridgeReachable, bridgeStatus, postBridgeAction } from '../mission-bridge.js'
/* The other source of computers, and on a customer machine the only one that
   can ever answer. See the header of src/declared-fleet.js for the measurement:
   the fleet projection is a BUILD-TIME file and ships `ok:false` forever. */
import { declaredFleetData } from '../declared-fleet.js'
/* The editing surface for the DECLARED organisation. It is a separate module
   for the reason given at the top of that file: it is the only part of this
   page that writes, and it is the only part that has to keep a role's wording
   and the role's enforcement side by side. */
import {
  ORG_ABSENT_REASON, REVISION_CONFLICT_ADVICE,
  buildRoleAssignBox, buildRoleLibraryBox, failureSentence, isRevisionConflict,
  orgBridge, orgNoticeMarkup, readOrg,
} from '../org-controls.js'
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
      projectionUnavailableReason: 'not part of this computer’s fleet record',
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
    /* THE FAST, LOCAL HALF OF A DRAG. It is not the authority — the
       organisation store behind window.mcOrg is, and computersView sends every
       accepted move there — but a drag needs an answer in the same frame as the
       pointer, and these are the guards that drive the .drop-ok highlight and
       the .refuse shake. The engine's own cycle check is the one that decides
       whether the move is KEPT; this one only decides what the cursor does. */
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
      /* The declared edge list moves with the node. Left alone, the edge that
         named the FORMER manager stays in graphEdges, and src/tree-graph.js
         draws every declared edge that is not already covered by a parent link
         — so the canvas kept asserting a management relationship the person had
         just dragged away from, as a second and softer line. */
      for (let index = edges.length - 1; index >= 0; index -= 1) {
        if (edges[index].to === agentId && HIERARCHY_EDGE_TYPES.has(edges[index].type)) edges.splice(index, 1)
      }
      edges.push({ from: parent.id, to: agentId, type: 'manages', sourceKind: 'declared' })
      return true
    },
  }
}

/* WHY THE SAVED ORGANISATION IS LAID OVER THE GENERATED FILE.
 *
 * public/data/fleet.json is produced by tools/gen-fleet.mjs from
 * config/agent-org.json — the SHIPPED baseline. A person's own edits live in an
 * overlay behind window.mcOrg, and the generator never sees them. Without this
 * merge a reparent could be written to disk correctly and still be absent from
 * the page on the next load, which a person cannot tell apart from not having
 * been written at all.
 *
 * IT APPLIES ONLY WHEN THERE IS SOMETHING TO APPLY. `source === 'baseline'`
 * means the store is serving the same shipped file the projection was generated
 * from, so there is nothing to overlay and the projection is returned untouched
 * — including when the overlay was DAMAGED, where the shipped default is
 * genuinely what the person is looking at and the rail says so.
 *
 * Within an agent the saved org is authoritative for hierarchy: it is the
 * owner-authored management graph, it is what this page's drag control writes,
 * and a page that edited one graph while drawing another would be editing
 * something invisible. Agents the saved org does not declare keep every edge
 * the projection gave them, observed ones included.
 */
const HIERARCHY_EDGE_TYPES = new Set(['manages', 'delegates_to'])

function mergeOrgIntoProjection(graph, org) {
  if (org?.source !== 'overlay' || !Array.isArray(org.agents) || !Array.isArray(org.relationships)) return graph
  const declared = new Map(org.agents.map(agent => [agent.id, agent]))
  const nodes = graph.nodes.map(node => {
    const agent = declared.get(node.id)
    return agent ? { ...node, role: agent.role, enabled: agent.enabled } : node
  })
  const present = new Set(nodes.map(node => node.id))
  const edges = graph.edges
    .filter(edge => !(HIERARCHY_EDGE_TYPES.has(edge.type) && declared.has(edge.to)))
    .concat(org.relationships
      .filter(relation => relation.type === 'manages' && present.has(relation.from) && present.has(relation.to))
      .map(relation => ({ from: relation.from, to: relation.to, type: 'manages', sourceKind: 'declared' })))
  return { ...graph, nodes, edges, revision: org.revision ?? graph.revision }
}

function projectionComputers(data, org = null) {
  const graph = data?.graph
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || !Array.isArray(data?.computers)) return []
  const merged = mergeOrgIntoProjection(graph, org)
  return data.computers.map(computer => projectedComputer(computer, merged))
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
  /* The cloud box's controller outlives its DOM node unless it is told
     otherwise: its bridge calls are in flight while a person clicks the next
     node in the tree, and a publish into a detached box is a listener leak per
     click. clearBoard() below destroys it with the rest of the rail. */
  let boardCloudBox = null
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
            <!-- THE NAMED DOOR TO THE DRILL-IN.
                 src/tree-graph.js already made ONE CLICK on a node open the rail,
                 which fixed the gesture. It did not fix the naming: nothing on
                 this page said the drill-in exists, so reaching it still meant
                 clicking a bubble on the chance that something useful appears,
                 then finding "Open full view" inside the panel that appeared.
                 This button is the same destination said out loud, in the strip
                 that already holds this page's named controls, and it is a
                 sibling of the rail button rather than a replacement for it. -->
            <button class="graph-open-btn" type="button" hidden>Open agent detail</button>
            <button class="graph-edit-btn" type="button" title="Edit the role hierarchy">Edit</button>
          </div>
          <div class="graph-edit-note">drag onto a parent or into empty space</div>
          <!-- WHAT THE ORGANISATION STORE SAID ABOUT THE LAST DRAG.
               A drag has no other place to report from: the rail is showing
               whichever node was last clicked, which is not necessarily the one
               being moved, and the canvas itself can only show the node's
               position. A refusal stays until the next attempt; a save clears
               itself, because a persistent "saved" would be indistinguishable
               from a stale one. -->
          <div class="org-status" data-state="idle" role="status" hidden></div>
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
  const openButton = root.querySelector('.graph-open-btn')
  /* Which agent the named button would open. It follows the rail's selection so
     the two controls can never disagree about what "this agent" means, and it
     falls back to the first agent on the computer so the button is useful before
     anything has been clicked. Null means there is nobody to open, and the
     button is then ABSENT rather than disabled — see syncOpenButton. */
  let openTarget = null
  /* The explanation shown in the central panel when there is no fleet to draw.
     It occupies the same slot the graph canvas does, so the two can never be on
     screen together. */
  let emptyPanel = null
  const orgStatusElement = root.querySelector('.org-status')
  let orgStatusTimer = 0
  /* THE ONE ANSWER EVERY ORGANISATION CONTROL BRANCHES ON.
     Read once per projection load and held here, so the rail's role menu, the
     role library and the drag can never disagree about which revision they are
     editing or about whether there is a store behind them at all. It starts as
     'absent' because that is what a plain browser is, and a control offered
     before the read has answered would be a control with no backend. */
  let orgAvailability = { state: 'absent', code: 'ORG_BRIDGE_ABSENT', reason: ORG_ABSENT_REASON }
  const orgReady = () => orgAvailability.state === 'ready'
  /* The last fleet payload, kept so the projection can be re-derived from the
     saved organisation without a second network read. Every org write goes
     through this: re-deriving is the same path a reload takes, so what the
     person sees after an edit cannot disagree with what they would see after
     restarting the app. */
  let lastFleetData = null
  /* WHY THE GRAPH ON SCREEN IS THE DECLARED ONE, when it is.
     Set to the fleet projection's own refusal sentence whenever the graph was
     built from the declared organisation instead, and printed in the rail. The
     customer is entitled to both facts at once: that these are the agents this
     copy declares, and that no fleet host reported them. Dropping the second one
     to make the page look healthier is how a screen starts lying. */
  let declaredOnlyReason = null

  function setOrgStatus(text, state = 'info', { sticky = false } = {}) {
    clearTimeout(orgStatusTimer)
    orgStatusTimer = 0
    orgStatusElement.textContent = text || ''
    orgStatusElement.dataset.state = text ? state : 'idle'
    orgStatusElement.hidden = !text
    if (text && !sticky) {
      orgStatusTimer = setTimeout(() => {
        orgStatusElement.hidden = true
        orgStatusElement.textContent = ''
        orgStatusElement.dataset.state = 'idle'
      }, 7000)
    }
  }

  const agentNameOf = (agentId) =>
    computer?.agents?.find(entry => entry.id === agentId)?.name || agentId || 'nobody'

  async function refreshOrg() {
    const next = await readOrg()
    if (destroyed) return next
    orgAvailability = next
    syncEditAvailability()
    return next
  }

  function clearBoard() {
    clearInterval(boardClock)
    boardClock = 0
    boardRing = null
    boardChart?.destroy()
    boardChart = null
    boardCloudBox?.__cloudController?.destroy()
    boardCloudBox = null
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

  /* IN LIVE MODE THE EDIT BUTTON IS A DOOR TO A WRITE.
     Editing the hierarchy means dragging a node onto a new manager, and that
     move is only a change if an organisation store accepts it. With no store
     behind this window — a plain browser, or a build whose payload carries no
     organisation modules — every drag would be undone the moment it was tried,
     so the button is disabled and carries the reason instead of opening a mode
     that can only disappoint.
     The SIMULATED fleet is a different case and stays available: its drag moves
     demonstration data around demonstration data, which is exactly what it
     claims to do. */
  function syncEditAvailability() {
    const blocked = liveMode && !orgReady()
      ? failureSentence(orgAvailability, 'The declared organisation could not be read.')
      : null
    editButton.disabled = Boolean(blocked)
    if (blocked) {
      editButton.title = `The hierarchy cannot be edited here. ${blocked}`
      editButton.setAttribute('aria-label', editButton.title)
      if (graph?.editMode) {
        graph.setEditMode(false)
        syncEditButton()
      }
    } else {
      editButton.title = 'Edit the role hierarchy'
      editButton.removeAttribute('aria-label')
    }
  }

  /* THE DRAG, AND WHAT MAKES IT A CHANGE RATHER THAN AN APPEARANCE.
   *
   * src/tree-graph.js asks this question synchronously and commits the visual
   * move on a truthy answer, so the local guards answer first — they are the
   * fast path and they are what drives the drop highlight and the refusal
   * shake. The store's answer arrives afterwards, and if it is a refusal the
   * projection is re-derived from what is actually saved, which puts the node
   * back where it was and leaves the store's own sentence on screen.
   *
   * A move that stays on the canvas after the store refused it is precisely the
   * defect this control existed to have: the page would be drawing an
   * organisation that nobody has. */
  function handleReparent(agentId, parentId) {
    if (!computer?.reparentAgent?.(agentId, parentId)) return false
    void persistReparent(agentId, parentId)
    return true
  }

  async function persistReparent(agentId, parentId) {
    const bridge = orgBridge()
    if (!bridge || !orgReady()) {
      reprojectFromOrg()
      setOrgStatus(failureSentence(orgAvailability, 'The move could not be saved.'), 'refuse', { sticky: true })
      return
    }
    const version = fetchVersion
    setOrgStatus('Saving the new manager…', 'busy', { sticky: true })
    let result
    try {
      result = await bridge.reparent({
        agentId,
        parentId,
        /* A stale window is refused rather than allowed to overwrite whatever a
           second window saved in the meantime. */
        expectedRevision: orgAvailability.org.revision,
      })
    } catch (error) {
      result = { ok: false, code: 'ORG_REPARENT_THREW', reason: `The move could not be sent to the organisation store: ${error?.message || error}` }
    }
    if (destroyed || version !== fetchVersion) return
    if (result?.ok) {
      orgAvailability = { ...orgAvailability, org: result.org }
      setOrgStatus(`Saved. ${agentNameOf(agentId)} now reports to ${agentNameOf(parentId)}.`, 'ok')
      return
    }
    if (isRevisionConflict(result)) {
      await refreshOrg()
      if (destroyed || version !== fetchVersion) return
      reprojectFromOrg()
      setOrgStatus(REVISION_CONFLICT_ADVICE, 'refuse', { sticky: true })
      return
    }
    reprojectFromOrg()
    setOrgStatus(failureSentence(result, 'The move was not saved.'), 'refuse', { sticky: true })
  }

  /* HIDDEN, NOT DISABLED, WHEN THERE IS NOBODY TO OPEN.
     A disabled "Open agent detail" would be a door drawn on a wall: it names a
     destination, invites the click, and refuses — which is the same defect as
     no door with an extra dead end attached. This page already treats absence
     this way (`Reset positions` is `hidden` until there is a position to reset)
     and the empty state below carries the explanation instead, which is where a
     person with no agents actually needs words rather than a control. */
  function syncOpenButton() {
    openButton.hidden = !openTarget
    if (!openTarget) return
    const name = openTarget.name || openTarget.id
    const label = `Open the detail page for ${name}`
    openButton.setAttribute('aria-label', label)
    openButton.setAttribute('title', label)
  }

  function setOpenTarget(agent) {
    openTarget = agent || null
    syncOpenButton()
  }

  openButton.addEventListener('click', () => {
    if (!openTarget || !computer) return
    /* Same zoom morph the rail's own button sets, read from the node when the
       graph still has one. Two controls onto one destination should not arrive
       differently, and a missing node must not stop the navigation. */
    const record = graph?.nodes?.get(openTarget.id)
    const target = record?.el || graphWrap
    const bounds = target.getBoundingClientRect()
    setViewMorph({ kind: 'zoom', x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 })
    navigate(`#/agent/${computer.id}/${openTarget.id}`)
  })

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

  function clearEmptyPanel() {
    emptyPanel?.remove()
    emptyPanel = null
  }

  function mountGraph() {
    clearMountedGraph()
    clearEmptyPanel()
    if (!computer) return
    graphTitle.textContent = computer.name
    canvas = el('<div class="computer-tree-canvas"></div>')
    graphWrap.insertBefore(canvas, graphTitle)
    graph = new StaticTreeGraph(canvas, {
      computer,
      screenChips: true,
      contextFeed: liveMode ? projectionMonitorContext : monitorContextFor,
      edges: liveMode ? computer.graphEdges : null,
      onReparent: liveMode ? handleReparent : null,
      onOpenControls: (agent) => { setOpenTarget(agent); showControls(agent) },
      onRootChange: renderCrumb,
      onOverridesChange: syncResetButton,
    })
    graph.onDensity = (dense) => hintElement.classList.toggle('show', dense)
    graph.updateDensity()
    window.__mcGraph = graph
    renderCrumb(null)
    syncEditButton()
    syncEditAvailability()
    /* Aim the button before anything is clicked, so it is a way IN rather than a
       reward for having already found the way in. A computer with no agents at
       all leaves the target null and the button hidden. */
    setOpenTarget(computer.agents?.[0] || null)
  }

  /**
   * REDRAW THE PAGE FROM WHAT IS ACTUALLY SAVED.
   *
   * Used after every organisation write, successful or refused. It re-derives
   * the projection from the cached fleet payload and the current saved org, so
   * a refused move goes back where it came from and an accepted one is drawn
   * the same way a fresh launch would draw it. Rebuilding rather than patching
   * is the point: a patch is a second renderer, and the second one is the one
   * that ends up showing something the store does not hold.
   *
   * The drill-in root, the edit mode and the selected node are carried across,
   * because none of those are facts about the organisation and losing them
   * would make a correct save feel like a page reset.
   */
  function reprojectFromOrg({ keepAgentId = null } = {}) {
    if (!lastFleetData || !liveMode) return
    const rootId = graph?.rootId || null
    const editing = !!graph?.editMode
    const computerId = computer?.id || null
    /* If the rail was showing an agent, it goes back to showing that agent. A
       refused drag already surprises the person by moving a node back; sending
       the rail to the fleet summary at the same moment would make a refusal
       look like a navigation. */
    const selected = keepAgentId
      || (controlsPage.classList.contains('is-active') ? graph?.selectedId : null)
      || null
    /* A DECLARED GRAPH IS RE-DERIVED FROM THE ORGANISATION, NOT FROM THE COPY
       THAT WAS DRAWN. `lastFleetData` is a projection of the record as it stood
       when the page loaded; re-projecting it after a save would redraw the old
       node set with the new relationships laid over it, which is a second
       renderer of the same fact and the one that drifts. */
    const source = declaredOnlyReason && orgReady()
      ? (declaredFleetData(orgAvailability.org) || lastFleetData)
      : lastFleetData
    mountProjection(source, { preferComputerId: computerId })
    if (rootId && graph?.nodes.has(rootId)) graph.setRoot(rootId)
    if (editing && !editButton.disabled) {
      graph?.setEditMode(true)
      syncEditButton()
    }
    const agent = selected ? computer?.agents?.find(entry => entry.id === selected) : null
    if (!agent) return
    setOpenTarget(agent)
    graph?.select(agent.id)
    showProjectionControls(agent)
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
      <div class="rail-title">Fleet overview</div>
      <div class="rail-scroll" data-live-mode="live" data-projection-state="available">
        <div class="stat-hero"><span class="v" id="agent-count">${computer.spawnedTotal}</span><span class="l">Agents on record</span></div>
        <div class="rail-sub">${escapeMarkup(computer.name)} · ${escapeMarkup(computer.note)} source · graph revision ${computer.graphRevision ?? 'unavailable'}</div>
        ${declaredOnlyReason ? `<div class="rail-sub projection-unavailable" data-projection-state="declared">The live fleet data could not be read · ${escapeMarkup(declaredOnlyReason)} These are the agents this computer has on record, not agents seen running.</div>` : ''}
        <div class="rail-sec">Services</div>
        <div class="task-list projection-state">
          ${services.length ? services.map(service => {
            const meta = [service.state, service.detail].filter(Boolean).join(' · ').replace(/\s--\s/g, ' — ')
            return `<div class="task-chip" data-service-id="${escapeMarkup(service.id)}"><i></i><b>${escapeMarkup(service.name)}</b><span class="svc-meta">${escapeMarkup(meta)}</span></div>`
          }).join('') : '<div class="rail-sub">No services are on record for this computer</div>'}
        </div>
        <div class="rail-sec">Recorded relationships</div>
        <div class="rail-sub">${computer.graphEdges.length} recorded relationships · runtime, load, tasks, and messages are not part of this record</div>
        ${orgSourceMarkup()}
        <div class="rail-sec">Roles</div>
        <div class="board-org-slot"></div>
      </div>`
    mountOrgLibrary(statsPage.querySelector('.board-org-slot'))
  }

  /* WHAT THE PERSON IS LOOKING AT, BEFORE THEY EDIT IT.
     Three facts change what an edit MEANS and none of them is visible unless
     something says it: that their saved organisation could not be loaded and
     this is the shipped default (`damaged`), that the shipped default moved
     under their edits (`baselineDrift`), and that there is no store here at all.
     orgNoticeMarkup carries the first two verbatim from the engine; the third is
     added here because a rail that offers no editing owes a reason. */
  function orgSourceMarkup() {
    if (!orgReady()) {
      return `<div class="org-notice" data-notice="off">${escapeMarkup(failureSentence(orgAvailability, 'The declared organisation could not be read.'))}</div>`
    }
    const source = orgAvailability.org.source === 'overlay'
      ? 'Showing your saved organisation.'
      : 'Showing the organisation this build ships. Nothing has been changed on this computer yet.'
    return `${orgNoticeMarkup(orgAvailability.org)}<div class="rail-sub">${escapeMarkup(source)} Revision ${escapeMarkup(String(orgAvailability.org.revision))}.</div>`
  }

  /* The role library is HIDDEN, not disabled, when there is no bridge at all.
     A whole panel of dead fields is noise in a browser that was never going to
     have an organisation store; the one-line reason above it has already been
     said. A bridge that answered with a FAILURE is different — that copy owes an
     explanation — so the panel is built and renders itself disabled. */
  function mountOrgLibrary(slot) {
    if (!slot) return
    if (orgAvailability.state === 'absent') {
      slot.remove()
      return
    }
    slot.replaceWith(buildRoleLibraryBox({
      availability: orgAvailability,
      onCreate: (definition) => callRoleBridge('createRole', definition, 'The role was not created.'),
      onEdit: (edit) => callRoleBridge('editRole', edit, 'The role wording was not saved.'),
      onReset: (target) => callRoleBridge('resetRole', target, 'The shipped wording was not restored.'),
    }))
  }

  /* One door to the three role-vocabulary calls. Each returns {ok, roles} and
     nothing else changes, so the cached role list is replaced and the graph is
     left alone — a role's WORDING is not a fact the canvas draws. */
  async function callRoleBridge(method, request, fallback) {
    const bridge = orgBridge()
    if (!bridge || typeof bridge[method] !== 'function') {
      return { ok: false, code: 'ORG_BRIDGE_ABSENT', reason: ORG_ABSENT_REASON }
    }
    let result
    try {
      result = await bridge[method](request)
    } catch (error) {
      result = { ok: false, code: 'ORG_ROLE_CALL_THREW', reason: `${fallback} ${error?.message || error}` }
    }
    if (result?.ok && Array.isArray(result.roles) && orgReady()) {
      orgAvailability = { ...orgAvailability, roles: result.roles }
    }
    return result
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
  /* What stands where the launch, team and loop boxes stand on the real board.
   *
   * It is a statement, not a control: no button, nothing focusable, nothing that
   * could be re-enabled by deleting an attribute. It exists because an empty gap
   * is its own kind of dishonesty -- somebody who used this page yesterday and
   * finds Dispatch missing today should be told the board changed and where the
   * working one is, rather than left to wonder whether the product broke.
   *
   * The route it names is the same one the tabs use, so it cannot rot into a
   * link to a page that does not exist. */
  function exampleControlsAbsentBox() {
    return el(`
      <div class="board-box board-ctl-box board-ctl-absent">
        <div class="board-box-h"><span class="bh-t">No launch controls on this board</span></div>
        <div class="board-cap">this is the example fleet, and nothing here starts anything</div>
        <p class="board-absent-copy">Launch, team and loop controls are left out of the example on purpose, so that nothing on a demonstration screen can start a real agent. They appear on the board that reads this computer.</p>
        <p class="board-absent-copy">Turn the example off in Settings, under what the screens show, to see your own computer and its controls.</p>
      </div>`)
  }

  /* THE FENCE, and it is the same one dd01899 put on the example AGENT page.
   *
   * WHAT WAS WRONG. This box, and the team and loop boxes below it, were built
   * for the SIMULATED board as readily as for the live one, gated on nothing but
   * `isWriteEnabled('dispatch')`. So the example copy of page 2 -- the one whose
   * own banner says nothing on it is real, sitting under an app-wide notice
   * saying these screens show example data -- mounted a Dispatch button wired
   * through postBridgeAction() to a real bridge. The write flag is a question
   * about PERMISSION; it was standing in for a question about PROVENANCE, and
   * the two are not the same question.
   *
   * `live` DEFAULTS TO FALSE so a caller that never considered the question
   * cannot accidentally answer yes, and the test is `!== true` rather than a
   * truthy check so a stray string cannot pass. The refusal returns null and the
   * caller renders a stated absence: on this page the controls are GONE from the
   * example board, not greyed out, because a disabled Dispatch button still
   * describes a capability this board does not have.
   *
   * IT IS BELT AND BRACES ON PURPOSE. showControls() below no longer calls these
   * at all for the simulated rail, so this branch should be unreachable; it is
   * here because "unreachable" is a property of today's callers and this file is
   * edited by several lanes. */
  function launchControlsBox(agent, { live = false } = {}) {
    if (live !== true) return null
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
          <button class="ctl-btn" type="button" data-launch="dispatch"${dispatchEnabled ? '' : ' disabled'} title="${dispatchEnabled ? 'Start a recorded work lane nested under this agent' : 'Handing out work is switched off. Turn on “Hand out work to agents” in Settings to use it.'}">Hand work to ${escapeMarkup(agent.name)}</button>
          <output class="ctl-out" data-launch="out" role="status">${dispatchEnabled ? '' : 'switched off in Settings'}</output>
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
        output.textContent = 'checking the audited connection…'
        const status = await prepareBridgeOnce()
        if (!box.isConnected) return
        const rootId = Array.isArray(status?.roots) ? status.roots[0] : null
        if (!status?.ok || !rootId) {
          output.textContent = `unavailable · ${status?.reason || 'no workspace folder is recorded for this computer'}`
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
   * TEAMS — one brief, several agents, nested under a lead.
   *
   * Every control here is backed by the same audited dispatch call the single
   * lane button uses. There is deliberately no new engine concept: a team is a
   * lead dispatch plus one nested dispatch per member, which is why the
   * engine's own fan-out cap (LAUNCH_FANOUT_EXCEEDED) finally applies to it.
   *
   * The two things this panel must not imply, and says out loud instead:
   *   - Six tiers are only FOUR concurrent agents. All three Claude tiers are
   *     the declared agent `claude`, and the presence registry allows one live
   *     lane per identity. A picker that let you tick Opus and Sonnet together
   *     would 409 on the second one every time.
   *   - "Started" is not "answered". Dispatch returns when the child process is
   *     running; the result is never returned to the caller. A panel that said
   *     "collecting results" would be describing a channel that does not exist.
   *
   * No animation is used anywhere in here: page 2 asserts that nothing inside
   * .computers is animating once settled.
   */
  /* Same fence, same reason; see launchControlsBox(). */
  function teamControlsBox(agent, { live = false } = {}) {
    if (live !== true) return null
    const dispatchEnabled = isWriteEnabled('dispatch')
    const box = el(`
      <div class="board-box board-team-box">
        <div class="board-box-h"><span class="bh-t">Team</span></div>
        <div class="board-cap">send one brief to several agents, nested under a lead</div>
        <label class="ctl-field"><span class="cl">Lead</span>
          <select class="ctl-select" data-team="lead" aria-label="Team lead tier">
            ${LAUNCH_TIERS.map(tier => `<option value="${escapeMarkup(tier.id)}">${escapeMarkup(tier.label)} · ${escapeMarkup(tier.provider)}</option>`).join('')}
          </select>
        </label>
        <div class="ctl-field ctl-team-members"><span class="cl">Members</span>
          <div class="team-member-grid" data-team="members">
            ${LAUNCH_TIERS.map(tier => `
              <label class="team-member"><input type="checkbox" data-team-member="${escapeMarkup(tier.id)}"/>
                <span>${escapeMarkup(tier.label)}</span>
                <code>${escapeMarkup(TIER_AGENT_IDENTITY[tier.id] || '?')}</code>
              </label>`).join('')}
          </div>
        </div>
        <div class="rail-sub" data-team="identity-note">The code beside each name is the declared agent it becomes. Two members that resolve to the same agent cannot run at once, so at most ${TEAM_BOUNDS.maxConcurrent} lanes can be live together on this computer.</div>
        <div class="rail-sub" data-team="plan" role="status"></div>
        <div class="ctl-dispatch">
          <button class="ctl-btn" type="button" data-team="go"${dispatchEnabled ? '' : ' disabled'} title="${dispatchEnabled ? 'Start the lead first, then nest each member under its launch' : 'Handing out work is switched off. Turn on “Hand out work to agents” in Settings to use it.'}">Start the team</button>
          <output class="ctl-out" data-team="out" role="status">${dispatchEnabled ? '' : 'switched off in Settings'}</output>
        </div>
        <div class="team-roster" data-team="roster"></div>
        <div class="rail-sub" data-team="honesty">Started means the process is running, not that it has answered. A dispatch returns a launch receipt, never a result.</div>
      </div>`)

    const leadSelect = box.querySelector('[data-team="lead"]')
    const planLine = box.querySelector('[data-team="plan"]')
    const goButton = box.querySelector('[data-team="go"]')
    const output = box.querySelector('[data-team="out"]')
    const roster = box.querySelector('[data-team="roster"]')
    let controller = null

    const selectedMembers = () => [...box.querySelectorAll('[data-team-member]')]
      .filter(input => input.checked)
      .map(input => input.getAttribute('data-team-member'))

    const currentPlan = () => planTeam({ lead: leadSelect.value, members: selectedMembers() })

    /* The plan is recomputed on every change and the button follows it, so an
       undispatchable team is refused BEFORE anything is started rather than
       part-way through. */
    const paintPlan = () => {
      const plan = currentPlan()
      planLine.textContent = plan.dispatchable
        ? `Ready: ${plan.lead} leads ${plan.members.length} member${plan.members.length === 1 ? '' : 's'}; ${plan.size} lanes total.`
        : plan.problems.join(' ')
      goButton.disabled = !dispatchEnabled || !plan.dispatchable
      if (!dispatchEnabled) goButton.title = 'Handing out work is switched off. Turn on “Hand out work to agents” in Settings to use it.'
      else if (!plan.dispatchable) goButton.title = plan.problems.join(' ')
      else goButton.title = 'Start the lead first, then nest each member under its launch'
      return plan
    }

    const paintRoster = state => {
      const rows = [state.lead ? { ...state.lead, lead: true } : null, ...state.members].filter(Boolean)
      roster.replaceChildren(...rows.map(row => el(`
        <div class="team-row" data-phase="${escapeMarkup(row.phase)}">
          <b>${escapeMarkup(row.tier)}${row.lead ? ' · lead' : ''}</b>
          <code>${escapeMarkup(row.identity || '?')}</code>
          <span>${escapeMarkup(row.detail)}</span>
        </div>`)))
    }

    leadSelect.addEventListener('change', paintPlan)
    for (const input of box.querySelectorAll('[data-team-member]')) {
      input.addEventListener('change', paintPlan)
    }
    paintPlan()

    if (dispatchEnabled) {
      goButton.addEventListener('click', async () => {
        const plan = paintPlan()
        if (!plan.dispatchable) return
        goButton.disabled = true
        output.textContent = 'checking the audited connection…'
        const status = await prepareBridgeOnce()
        if (!box.isConnected) return
        const rootId = Array.isArray(status?.roots) ? status.roots[0] : null
        if (!status?.ok || !rootId) {
          output.textContent = `unavailable · ${status?.reason || 'no workspace folder is recorded for this computer'}`
          goButton.disabled = false
          return
        }
        const settings = readLaunchSettings()
        controller?.destroy()
        controller = createTeamController({
          plan,
          dispatchBody: {
            rootId,
            objectiveRef: `page2-team-${String(agent.id).replace(/[^a-z0-9_-]/gi, '-').slice(0, 50)}`,
            brief: `Team requested from the fleet page, led under ${agent.name}.`,
            cap: { kind: 'turns', value: 8, capMs: clampCapMs(settings.capMs) },
          },
          postAction: postBridgeAction,
          onState: state => {
            if (!box.isConnected) return
            output.textContent = state.message
            paintRoster(state)
          },
        })
        await controller.run()
        if (!box.isConnected) return
        goButton.disabled = false
        paintPlan()
      })
    }

    return box
  }

  /**
   * LOOPS — running one agent again and again, with the stop beside the start.
   *
   * The one control on this page a person is meant to start and then WALK AWAY
   * from, which is why the panel spends most of its space on bounds rather than
   * on options. Three sentences are always on screen, not behind a tooltip,
   * because each one is a promise somebody is relying on while not watching:
   * what happens on overrun, what bounds a single run, and the fact that this
   * loop lives only as long as the window does.
   *
   * THE STOP IS RENDERED BESIDE THE START AND IS NEVER HIDDEN. It is disabled
   * when no loop is running and enabled the moment one is, driven by the
   * controller's own `stoppable` flag rather than by this view's opinion of what
   * phase it is in. A stop control that is only reachable from somewhere else,
   * or that appears once a loop is already going, is a stop a panicking person
   * cannot find.
   *
   * `observeLiveTarget` re-reads the agents projection at stop time rather than
   * caching a target at start time: the run in flight when someone presses stop
   * is usually not the run that was in flight when they pressed start, and
   * terminating a stale pid is refused by the engine anyway
   * (BRIDGE_TERMINATE_STALE_PID).
   */
  /* Same fence, same reason; see launchControlsBox(). */
  function loopControlsBox(agent, { live = false } = {}) {
    if (live !== true) return null
    const dispatchEnabled = isWriteEnabled('dispatch')
    const runOptions = []
    for (let runs = 2; runs <= LOOP_BOUNDS.maxIterations; runs += 1) runOptions.push(runs)
    const intervalOptions = [1, 5, 10, 20, 30, 60]

    const box = el(`
      <div class="board-box board-loop-box">
        <div class="board-box-h"><span class="bh-t">Loop</span></div>
        <div class="board-cap">run one agent again and again, bounded and stoppable</div>
        <label class="ctl-field"><span class="cl">Agent</span>
          <select class="ctl-select" data-loop="tier" aria-label="Looped agent tier">
            ${LAUNCH_TIERS.map(tier => `<option value="${escapeMarkup(tier.id)}">${escapeMarkup(tier.label)} · ${escapeMarkup(tier.provider)}</option>`).join('')}
          </select>
        </label>
        <label class="ctl-field"><span class="cl">Runs</span>
          <select class="ctl-select" data-loop="runs" aria-label="How many runs">
            ${runOptions.map(runs => `<option value="${runs}"${runs === LOOP_BOUNDS.maxIterations ? ' selected' : ''}>${runs}</option>`).join('')}
          </select>
        </label>
        <label class="ctl-field"><span class="cl">Every</span>
          <select class="ctl-select" data-loop="every" aria-label="Minutes between runs">
            ${intervalOptions.map(minutes => `<option value="${minutes}"${minutes === 20 ? ' selected' : ''}>${minutes} min</option>`).join('')}
          </select>
        </label>
        <div class="rail-sub" data-loop="bounds">Every run after the first is nested under the first, so the engine's own cap of ${LOOP_BOUNDS.maxFanOut} applies. ${escapeMarkup(LOOP_OVERRUN.sentence)} ${escapeMarkup(LOOP_RUN_CAP.sentence)}</div>
        <div class="rail-sub" data-loop="plan" role="status"></div>
        <div class="ctl-dispatch">
          <button class="ctl-btn" type="button" data-loop="go"${dispatchEnabled ? '' : ' disabled'}>Start loop</button>
          <button class="ctl-btn danger" type="button" data-loop="stop" disabled title="No loop is running.">Stop loop</button>
          <output class="ctl-out" data-loop="out" role="status">${dispatchEnabled ? '' : 'dispatch is off in Settings'}</output>
        </div>
        <div class="team-roster" data-loop="roster"></div>
        <div class="rail-sub" data-loop="honesty">This loop runs while this window is open. It is not durable across a restart, and closing the window ends the schedule — though any run already going is still bounded by its own cap.</div>
      </div>`)

    const tierSelect = box.querySelector('[data-loop="tier"]')
    const runsSelect = box.querySelector('[data-loop="runs"]')
    const everySelect = box.querySelector('[data-loop="every"]')
    const planLine = box.querySelector('[data-loop="plan"]')
    const goButton = box.querySelector('[data-loop="go"]')
    const stopButton = box.querySelector('[data-loop="stop"]')
    const output = box.querySelector('[data-loop="out"]')
    const roster = box.querySelector('[data-loop="roster"]')
    let controller = null

    const currentPlan = () => planLoop({
      tier: tierSelect.value,
      iterations: Number(runsSelect.value),
      intervalMs: Number(everySelect.value) * 60_000,
    })

    const paintPlan = () => {
      const plan = currentPlan()
      planLine.textContent = plan.runnable
        ? `Ready: ${plan.tier} runs up to ${plan.iterations} times, one every ${Math.round(plan.intervalMs / 60_000)} minutes.`
        : plan.problems.join(' ')
      goButton.disabled = !dispatchEnabled || !plan.runnable
      goButton.title = !dispatchEnabled
        ? 'Handing out work is switched off. Turn on “Hand out work to agents” in Settings to use it.'
        : (plan.runnable ? 'Start the loop. The first run starts immediately.' : plan.problems.join(' '))
      return plan
    }

    const paintRuns = state => {
      roster.replaceChildren(...state.runs.map(run => el(`
        <div class="team-row" data-phase="${escapeMarkup(run.phase)}">
          <b>run ${run.index}</b>
          <code>${escapeMarkup(run.phase)}</code>
          <span>${escapeMarkup(run.detail)}</span>
        </div>`)))
    }

    /* Read the agents projection fresh, and hand back only an exactly-shaped
       running target. Anything else is reported by the controller as "nothing
       observed in flight" rather than guessed at. */
    const observeLiveTarget = async identity => {
      const result = await fetchAgents()
      if (!result?.ok) return null
      const rows = Array.isArray(result.data?.data) ? result.data.data : []
      const match = rows.find(row => row?.id === identity && row?.controlTarget)
      return match ? match.controlTarget : null
    }

    for (const control of [tierSelect, runsSelect, everySelect]) control.addEventListener('change', paintPlan)
    paintPlan()

    if (dispatchEnabled) {
      goButton.addEventListener('click', async () => {
        const plan = paintPlan()
        if (!plan.runnable) return
        goButton.disabled = true
        output.textContent = 'checking the audited connection…'
        const status = await prepareBridgeOnce()
        if (!box.isConnected) return
        const rootId = Array.isArray(status?.roots) ? status.roots[0] : null
        if (!status?.ok || !rootId) {
          output.textContent = `unavailable · ${status?.reason || 'no workspace folder is recorded for this computer'}`
          goButton.disabled = false
          return
        }
        const settings = readLaunchSettings()
        controller?.destroy()
        controller = createLoopController({
          plan,
          dispatchBody: {
            rootId,
            objectiveRef: `page2-loop-${String(agent.id).replace(/[^a-z0-9_-]/gi, '-').slice(0, 50)}`,
            brief: `Loop requested from the fleet page, under ${agent.name}.`,
            cap: { kind: 'turns', value: 8, capMs: clampCapMs(settings.capMs) },
          },
          postAction: postBridgeAction,
          observeLiveTarget,
          onState: state => {
            if (!box.isConnected) return
            output.textContent = state.message
            /* The stop follows the controller, not this handler's idea of what
               is happening: it is live exactly while a loop is. */
            stopButton.disabled = !state.stoppable
            stopButton.title = state.stoppable ? 'Stop the loop and terminate the run in flight.' : 'No loop is running.'
            paintRuns(state)
          },
        })
        await controller.start()
        if (!box.isConnected) return
        goButton.disabled = false
        paintPlan()
      })

      stopButton.addEventListener('click', async () => {
        if (!controller) return
        stopButton.disabled = true
        await controller.stop()
        if (!box.isConnected) return
        goButton.disabled = false
        paintPlan()
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
      if (plan.contextFilteredToNothing && log) {
        const chosen = COPY.chatboxNoAgentsChosen
        log.appendChild(el(`<div class="chat-empty"><b>${escapeMarkup(chosen.title)}</b><span>${escapeMarkup(chosen.body)}</span><a href="${escapeMarkup(chosen.action.href)}">${escapeMarkup(chosen.action.label)}</a></div>`))
      } else if (plan.emptyReason && !plan.turns.length && !plan.runs.length && log && !log.childElementCount) {
        log.appendChild(el(`<div class="chat-empty"><span>${escapeMarkup(plan.emptyReason)}</span></div>`))
      }
      /* contextHiddenAgents, not hiddenAgents. With the conversation half
         switched off, nobody is being "kept out by your own choice" — the
         whole half is gone, and saying otherwise blames the wrong setting.
         The name now says which of the two questions it answers, so this is a
         field choice rather than a condition someone has to remember to add. */
      if (plan.contextHiddenAgents > 0) {
        host.appendChild(el(`<div class="chat-hidden-note">${escapeMarkup(COPY.chatboxAgentsHeld(plan.contextHiddenAgents))}</div>`))
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
    /* THE EXAMPLE BOARD GETS NO LAUNCH, TEAM OR LOOP BOX AT ALL.
     *
     * It used to get all three, really wired, gated only on the dispatch write
     * flag -- so the demonstration copy of this page could dispatch a real
     * agent. They are not disabled here, they are ABSENT, for the reason the
     * example agent page settled on in dd01899: a disabled control still
     * advertises a capability, and a disabled button is still something a
     * keyboard can reach and a future refactor can re-enable by deleting one
     * attribute. What replaces them says where the real ones are, because a
     * person who came here looking for Dispatch is owed a direction rather than
     * a hole. */
    controlsPage.querySelector('.board-ctl-box').replaceWith(exampleControlsAbsentBox())

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
    const missing = [runtime === null ? 'runtime' : null, taskSummary === null ? 'task history' : null, 'activity'].filter(Boolean)
    controlsPage.innerHTML = `
      <div class="rail-title"><button class="rail-back" type="button">‹ Fleet overview</button><span class="spacer"></span>Recorded agent</div>
      <div class="rail-scroll" data-live-mode="live" data-projection-state="available">
        <div class="agent-head board-head"><span class="role-dot"></span><div><div class="an">${escapeMarkup(agent.name)}</div><div class="ar">${escapeMarkup(agent.declaredRole)}</div></div></div>
        <div class="board-box board-chat-box"></div>
        <div class="board-box board-ctl-box projection-state">
          <div class="board-box-h"><span class="bh-t">What is on record</span></div>
          <div class="rail-sub">ID · ${escapeMarkup(agent.id)}</div>
          <div class="rail-sub">Provider · ${escapeMarkup(agent.provider)}</div>
          <div class="rail-sub">State · ${escapeMarkup(agent.state)}</div>
          <div class="rail-sub">Origin · ${escapeMarkup(agent.origin || 'unresolved')}</div>
          ${runtime === null ? '' : `<div class="rail-sub">Runtime · ${escapeMarkup(runtime)}</div>`}
          ${taskSummary === null ? '' : `<div class="rail-sub">${escapeMarkup(taskSummary)}</div>`}
          <div class="projection-unavailable">${escapeMarkup(missing.join(', '))} unavailable · ${escapeMarkup(agent.projectionUnavailableReason)}</div>
        </div>
        <div class="board-role-slot"></div>
        <div class="board-launch-slot"></div>
      </div>
      <div class="board-actions">
        <div class="ctl-grid">${deadActionButtons()}</div>
        <button class="ctl-btn" data-a="open">Open full view</button>
      </div>`
    mountRailChat(agent, role)
    mountRoleControl(agent, controlsPage.querySelector('.board-role-slot'))
    /* `live: true` is stated here and nowhere else. This is the projection rail
       -- the one reading declared topology from this computer -- and it is the
       only caller entitled to build a control that reaches the bridge. */
    const projectionLaunchBox = launchControlsBox(agent, { live: true })
    controlsPage.querySelector('.board-launch-slot').replaceWith(projectionLaunchBox)
    const projectionTeamBox = teamControlsBox(agent, { live: true })
    projectionLaunchBox.after(projectionTeamBox)
    const projectionLoopBox = loopControlsBox(agent, { live: true })
    projectionTeamBox.after(projectionLoopBox)
    /* Codex Cloud sits with Launch, Team and Loop because it is the fourth
       answer to the same question -- how does work get started from this
       computer -- and the first one whose answer is "somewhere else".
       ONLY ON THIS RAIL. The simulated rail above gets no cloud box: it is the
       example copy, and its own banner says nothing on it is real. */
    boardCloudBox = cloudControlsBox()
    projectionLoopBox.after(boardCloudBox)
    controlsPage.querySelector('.rail-back').addEventListener('click', showStats)
    controlsPage.querySelector('[data-a="open"]').addEventListener('click', () => navigate(`#/agent/${computer.id}/${agent.id}`))
    activateRail(controlsPage)
  }

  /**
   * THE ROLE OF THE SELECTED AGENT.
   *
   * Same absence rule as the role library: with no bridge at all the control is
   * removed rather than drawn dead, and a bridge that FAILED gets a disabled
   * control carrying its reason. src/org-controls.js decides which of those two
   * shapes to draw; this function owns what happens after a successful write,
   * which is a full re-derivation — a role decides a node's colour, its radius
   * and its tier on the canvas, so it is not a label the rail can repaint.
   */
  function mountRoleControl(agent, slot) {
    if (!slot) return
    if (orgAvailability.state === 'absent') {
      slot.remove()
      return
    }
    slot.replaceWith(buildRoleAssignBox({
      agent,
      availability: orgAvailability,
      onAssign: async (roleId) => {
        const bridge = orgBridge()
        if (!bridge) return { ok: false, code: 'ORG_BRIDGE_ABSENT', reason: ORG_ABSENT_REASON }
        const version = fetchVersion
        let result
        try {
          result = await bridge.assignRole({
            agentId: agent.id,
            role: roleId,
            expectedRevision: orgAvailability.org?.revision,
          })
        } catch (error) {
          result = { ok: false, code: 'ORG_ASSIGN_ROLE_THREW', reason: `The role could not be sent to the organisation store: ${error?.message || error}` }
        }
        if (destroyed || version !== fetchVersion) return result
        if (result?.ok) {
          orgAvailability = { ...orgAvailability, org: result.org }
          setOrgStatus(`Saved. ${agent.name} is now ${roleId}.`, 'ok')
          reprojectFromOrg({ keepAgentId: agent.id })
          return result
        }
        if (isRevisionConflict(result)) {
          await refreshOrg()
          if (destroyed || version !== fetchVersion) return result
          reprojectFromOrg({ keepAgentId: agent.id })
          setOrgStatus(REVISION_CONFLICT_ADVICE, 'refuse', { sticky: true })
        }
        return result
      },
    }))
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

  /* THE EMPTY STATE IS THE SHIPPING STATE.
   *
   * `public/data/fleet.json` ships as `{"ok": false, "data": null}` with the
   * reason "No local agent fleet host detected on this machine." — so this
   * branch, not the graph, is what every fresh install renders on this page.
   * It used to put one grey sentence into the RAIL and leave the whole central
   * panel blank. Every word of that sentence was true and it was still a dead
   * end: it named a failure without saying what the page is for, what would
   * fill it, or that a drill-in exists at all behind it.
   *
   * So the reason stays, verbatim and unsoftened — a fresh customer is entitled
   * to know their machine has no fleet host — and it now arrives inside an
   * explanation, in the central panel where the person is already looking.
   *
   * The one action offered leads to the demonstration copy of the drill-in,
   * which announces itself as such on arrival. It is offered ONLY when the
   * simulator actually has an agent to show: an action that leads nowhere is
   * the same defect as the blank panel it replaced, one screen further along.
   */
  function emptyStateExample() {
    const computer0 = sim.computers?.[0]
    const agent0 = computer0?.agents?.[0]
    if (!computer0 || !agent0) return ''
    return `<a class="graph-empty-action" href="#/agent/${escapeMarkup(computer0.id)}/${escapeMarkup(agent0.id)}/example">See an example agent</a>
            <div class="graph-empty-note">Demonstration data. Nothing in it is running on this computer.</div>`
  }

  function showProjectionUnavailable(reason, loading = false) {
    clearSourceUnsubs()
    clearMountedGraph()
    clearBoard()
    liveMode = true
    liveComputers = []
    computer = null
    declaredOnlyReason = null
    setOpenTarget(null)
    root.dataset.liveMode = 'live'
    root.dataset.projectionState = loading ? 'loading' : 'unavailable'
    tabsElement.innerHTML = ''
    graphTitle.textContent = ''
    crumbElement.innerHTML = ''
    hintElement.classList.remove('show')
    /* THE ROLE LIBRARY OUTLIVES THE FLEET.
       This is the state a fresh install actually opens in — public/data/fleet.json
       ships with ok:false — and roles are not a fact about a running fleet: they
       are the vocabulary an organisation is written in, and they can be prepared
       before any computer reports. Leaving the panel out here would have put the
       only way to reach it behind a host most copies do not have. */
    statsPage.innerHTML = `
      <div class="projection-unavailable" data-live-mode="live" data-projection-state="${loading ? 'loading' : 'unavailable'}">${loading ? 'Reading your fleet…' : `The live fleet data could not be read · ${escapeMarkup(reason)}`}</div>
      ${loading ? '' : `<div class="rail-scroll rail-org-only">${orgSourceMarkup()}<div class="board-org-slot"></div></div>`}`
    controlsPage.innerHTML = ''
    activateRail(statsPage)
    if (!loading) mountOrgLibrary(statsPage.querySelector('.board-org-slot'))

    clearEmptyPanel()
    if (loading) return
    emptyPanel = el(`
      <div class="graph-empty" data-projection-state="unavailable">
        <div class="graph-empty-h">No computers are reporting to this copy</div>
        <div class="graph-empty-reason">The live fleet data could not be read · ${escapeMarkup(reason)}</div>
        <div class="graph-empty-body">This page draws the agents running on each computer in your fleet, and opens any one of them in a detail page with its own chat, runtime and controls. It fills in on its own once a computer here is running an agent host this copy can read.</div>
        ${emptyStateExample()}
      </div>`)
    graphWrap.insertBefore(emptyPanel, graphTitle)
  }

  function mountProjection(data, { preferComputerId = null, declaredReason = declaredOnlyReason } = {}) {
    lastFleetData = data
    declaredOnlyReason = declaredReason
    const next = projectionComputers(data, orgReady() ? orgAvailability.org : null)
    if (!next.length) {
      showProjectionUnavailable('the fleet record lists no usable computers or relationships')
      return
    }
    clearSourceUnsubs()
    clearMountedGraph()
    liveMode = true
    liveComputers = next
    root.dataset.liveMode = 'live'
    root.dataset.projectionState = declaredOnlyReason ? 'declared' : 'available'
    computer = next.find(candidate => candidate.id === preferComputerId)
      || next.find(candidate => candidate.id === initialComputer)
      || next[0]
    renderTabs()
    mountGraph()
    showStats()
  }

  /* The fleet and the saved organisation are read TOGETHER, and the projection
     is not mounted until both have answered. Mounting on the fleet alone would
     draw the shipped hierarchy first and correct itself a moment later, which
     looks exactly like an edit being undone. */
  function loadProjection() {
    const version = ++fetchVersion
    showProjectionUnavailable('', true)
    Promise.all([fetchFleet(), readOrg()]).then(([result, org]) => {
      if (destroyed || version !== fetchVersion || !isLiveView('computers')) return
      orgAvailability = org
      /* THE FLEET PROJECTION IS NOT THE ONLY SOURCE OF COMPUTERS, and on a
         customer machine it is the one that can never answer. When it has
         nothing, the organisation this copy declares is drawn instead — the
         same record this page's own drag and role menu write to — so the
         machine in front of the person appears on their own fleet page and the
         drill-in behind it is a real one. The refusal sentence travels with it
         and is printed in the rail; nothing is hidden by drawing something.
         The empty state below is still reached, and is still right, when there
         is no organisation to draw: a plain browser, or a store that refused. */
      if (result.ok) mountProjection(result.data.data, { declaredReason: null })
      else {
        const declared = orgReady() ? declaredFleetData(orgAvailability.org) : null
        if (declared) mountProjection(declared, { declaredReason: result.reason })
        else showProjectionUnavailable(result.reason)
      }
      syncEditAvailability()
    }).catch(error => {
      if (destroyed || version !== fetchVersion || !isLiveView('computers')) return
      showProjectionUnavailable(`the fleet record could not be fetched: ${error?.message || error}`)
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
      clearTimeout(orgStatusTimer)
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
