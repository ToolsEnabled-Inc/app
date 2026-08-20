import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import { sim, fmtRuntime } from '../sim.js'
import { CHAT, ROLES } from '../vocab.js'
import { el, uptimeRing, setViewMorph, buildChat } from '../components.js'
import { railTitleRow } from '../rail-title.js'
import { StaticTreeGraph } from '../tree-graph.js'
import { withAlpha } from '../echarts-theme.js'
import { isLiveView, LIVE_FLAGS_EVENT } from '../live-flags.js'
import { fetchFleet, fetchAgents } from '../live-status.js'
import {
  LAUNCH_TIERS, launchTier, tierArgvFragment, UNSUPPORTED_CONTROLS,
  CAP_BOUNDS, clampCapMs, capMinutes, sandboxLevel,
} from '../orchestration-controls.js'
import {
  TIER_SEAT_POOL, TEAM_BOUNDS, planTeam, createTeamController,
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
/* THE EMPTY-STATE NOTICE AND ITS DOOR, borrowed for the same reason COPY above
   is. This page's empty state is the state EVERY fresh install opens on, and
   home, the comms board and Settings are all saying something about the same
   absent agent host at the same time. A second wording here would let four
   screens describe one condition four ways, and the person who reads two of
   them would have to work out whether they are the same problem.
   src/first-run-needs.js owns the sentences; src/guide.css styles this page's
   copy of them (`.computers .graph-empty .host-absent`). */
import { GUIDE_ACTION, hostAbsentMarkup } from '../first-run-needs.js'
/* No bare identifier reaches a person from this page's controls; the code is
   carried as `data-refusal-code` instead. See src/refusal-copy.js. */
import { markRefusalCode, refusalCodeOf, refusalSentence } from '../refusal-copy.js'
/* The sentences for a refused agent START, which are a different table from the
   product-wide remedies above and stay that way — see the note at the head of
   src/refusal-copy.js for why the two do not import each other. UNAVAILABLE_TEXT
   is read only to ASK whether a code has a sentence there; the sentence itself
   always comes back through unavailableReason(). */
import { refusalCode } from '../agent-availability-copy.js'
/* EVERY SENTENCE THIS FLOW SAYS ABOUT A START, written once, in one voice, by
   the lane that owns the words. Nothing in this file rewords a refusal: it hands
   the whole bridge result over and shows what comes back. */
import {
  CHAT_NOT_RUNNING,
  TREE_ENGINE,
  TREE_DEFAULT_STARTABLE_TIERS,
  startableProviderWords,
  tierProviderWord,
  MOVE_PANEL,
  PROFILE_PANEL,
  START_WORK_GROUP,
  PALETTE_PANEL,
  REMOVE_PANEL,
  QUEUE_PANEL,
  SAID_PANEL,
  NODE_STATUS_WORDS,
  TURN_FAILED,
  turnCompletionWords,
  START_REFUSAL,
  APPROVAL_PANEL, approvalDecisionWord,
  MODEL_PANEL,
  REWIND_PANEL,
  RESUME_PANEL,
  RECOVERED_SESSION,
  ENDED_SESSION,
  SECOND_TREE,
  EFFORT_SWITCH,
  EFFORT_CHOICES,
  TIER_CHOICES,
  startableTierIds,
  tierChoicesFor,
  actionRowWords,
  activityLine,
  foldedActionsLine,
  TRANSCRIPT_TRIMMED_NOTE,
  refusalNeedsAssistantProgram, roleLabel, runningLine, startRefusalSentence, startingLine,
  usageSentence,
} from '../fleet-tree-copy.js'
import { createTranscriptStore, TRANSCRIPT_LIMITS, transcriptSeedText } from '../session-transcript-store.js'
/* The owner's queue: messages written while the agent is busy, drained one
   per completed turn by this view's own listener. The store holds words; this
   file holds the wire. */
import {
  SESSION_OUTBOX_EVENT,
  cancel as outboxCancel,
  clearSession as outboxClearSession,
  enqueue as outboxEnqueue,
  list as outboxList,
  moveSession as outboxMoveSession,
  requeueFront as outboxRequeueFront,
  takeNext as outboxTakeNext,
} from '../session-outbox.js'
import { WRITE_OUTCOME_KEYS, recordUndeliveredWrite } from '../write-outcomes.js'
/* The readers that decide what a session event is allowed to put on a screen.
   Same set the agent page uses; a second reading of the same stream is how one
   surface comes to be wrong without anybody noticing. */
import { createActionBuffer, completionSettlesOpenTurn, sessionActivityEvent, sessionEventText, sessionEventTurnId, sessionTurnFailureText, sessionTurnStatus, sessionTurnSucceeded, sessionUsageEvent } from '../agent-session-events.js'
import { parseSlashCommand, requestUsageSentence, requestConfirmationSentence } from '../slash-commands.js'
/* The frame-batched appender the Controls panel already streams through --
   measured there, reused here so the rail's "What it said" moves while the
   turn runs instead of sitting silent until the end. */
import { createTranscriptAppender } from '../agent-session-transcript.js'
/* THE TREE A PERSON BUILDS, and the panel they build it in. Neither is this
   file's to own: src/fleet-trees.js holds the structure and its rules, and
   src/agent-compose-panel.js holds the form and its refusals. This view is the
   join between them and the agent bridge — a press goes in one end and a running
   session comes out the other. */
import { createFleetTreeStore, FLEET_TREE_LIMITS, markTreeStoreLive, NODE_REMOVE_REFUSALS, safeTreeStorage } from '../fleet-trees.js'
/* WHAT A NODE IS TOLD ABOUT ITS PLACE IN THE TREE. The tree holds the
   relationship; before this the session was never told it, and a child asked
   the person for "the manager's identifier" while its manager was drawn one
   circle above it (owner, 2026-08-18). See that file's header for why this
   rides in the message text rather than in an engine option. */
import { composeNodeBrief, nodeManagerContext } from '../tree-node-brief.js'
import { mountAgentComposePanel } from '../agent-compose-panel.js'
import { isWriteEnabled, setWriteEnabled } from '../write-flags.js'
import { START_CONTROL_FLAG, START_CONTROL_ON, startControlOffBecause } from '../setup-profile.js'
/* The one rule for "is there still an agent behind this circle", shared by every
   surface on this page that used to answer it for itself. */
import { nodeIsBusy, sessionEndedWithApp, sessionIsLive, treeNodeClock } from '../tree-session-liveness.js'
import { cloudControlsBox } from '../cloud-tasks.js'
import { bridgeReachable, bridgeStatus, postBridgeAction } from '../mission-bridge.js'
import { readResearchSnapshot } from '../research-projects.js'
import { createAssignmentStore } from '../research-assignments.js'
import { createAssignmentControl } from '../research-assignment-control.js'
/* The other source of computers, and on a customer machine the only one that
   can ever answer. See the header of src/declared-fleet.js for the measurement:
   the fleet projection is a BUILD-TIME file and ships `ok:false` forever. */
import { declaredAgentsData, declaredFleetData } from '../declared-fleet.js'
/* THE OTHER HALF OF declaredFleetData(), AND THE ONE THIS PAGE NEVER HANDED IT.
 *
 * src/declared-fleet.js takes `started` as its second argument and says in its
 * own header why: it is pure, the registry is a live singleton, and "the caller
 * holds the live half and hands it over". This page is that caller, and from
 * 6f0a34a until 2026-08-18 it called `declaredFleetData(org)` at BOTH sites with
 * no second argument at all -- so `started` was null on every call, `running`
 * was always empty, and the declared fallback drew a tree that could never have
 * a node in it no matter what the person did.
 *
 * WHAT THAT COST, and it is not the tree. Press Start on an agent's own page
 * (#/agent/<computer>/<agent>, which src/agent-session.js publishes the live
 * record from) and come back here: "Nothing has run on this computer yet", over
 * a session that is running. And because showProjectionControls() -- the only
 * builder of Dispatch, Team, Loop and Codex Cloud -- is reached by SELECTING A
 * NODE, a page that can never draw a node is a page on which those four
 * controls do not exist. The declared fallback is what every customer install
 * gets (public/data/fleet.json ships ok:false), so that was all of them. */
import { onLiveSession, readLiveSession } from '../agent-session-registry.js'
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
/* The panel's own styles are imported HERE rather than by the module, because
   src/agent-compose-panel.js is proven under `node --test` and a stylesheet
   import inside it would make it unloadable there. Same arrangement as the two
   above. */
import '../agent-compose-panel.css'

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

/* ---------------------------------------------------------------
   STARTING A REAL AGENT, WHICH IS THE ONE THING THIS PAGE COULD NOT DO.
   ---------------------------------------------------------------

 * WHAT THE OWNER ASKED FOR. The tree is empty until a person starts something.
 * The empty places in it are drawn, and pressing one is how the structure grows:
 * the panel on the right asks for a role and a message, and answering it starts
 * a real agent. Not a card that says an agent exists — an actual session, on
 * this computer, that a person can then talk to.
 *
 * THE ONE RULE THIS SECTION EXISTS TO KEEP. Nothing here runs on page load.
 * Every function below is reached from a press and from nothing else, which is
 * why the start lives in a function rather than in a promise chain that a mount
 * could fall into. The page's other live control (Dispatch, above) had this
 * property already; a tree that starts a session because somebody navigated to a
 * fleet page would be a far worse defect than the one this repairs.
 *
 * WHY IT IS TWO CALLS AND NOT ONE. `mcAgent.start()` opens a session and mints
 * its own name for it; `mcAgent.send()` carries the person's words into that
 * session. There is no single call that does both, and there should not be: the
 * two fail in genuinely different ways, and a person who is told "it did not
 * start" when in fact it started and their message did not arrive will go and
 * start a second one. So the two refusals are worded separately below, and the
 * session name is carried out of a failed send rather than thrown away.
 *
 * WHY A REFUSAL IS READ RATHER THAN INFERRED. The bridge answers `{ok:false,
 * code}` for a refusal it can describe, and it REJECTS for a refusal raised
 * before anything was spawned — so a start that never happened arrives here as
 * an ordinary value about half the time. Reading only exceptions would let a
 * draft node sit on the screen looking like a running agent, which is this
 * codebase's signature defect (absence read as consent) in its most expensive
 * costume: a person believing work is under way when nothing is.
 *
 * A successful start carries NO `ok:true`. It answers `{sessionId, threadId,
 * tier}` (shell/agent-host.cjs startSession), so the test below is `ok === false`
 * plus a session name that is really a non-empty string. A truthiness check on
 * `ok` would treat every successful start as a failure. */

/* WHERE THE WORDS COME FROM, AND WHY NONE OF THEM ARE WRITTEN HERE.
 *
 * src/fleet-tree-copy.js owns every sentence this flow says about a start: the
 * four curated refusals, the progress lines, the role labels. It composes the
 * rest through src/agent-availability-copy.js and src/refusal-copy.js, so an
 * engine code nobody has written a sentence for still arrives as English with an
 * action in it. This file therefore holds NO refusal table of its own. It had
 * one for about an hour; a second table is how one product ends up describing a
 * missing assistant program two ways on two screens.
 *
 * THE ONE SENTENCE THIS FILE STILL COMPOSES is the send failure, and only
 * because the shared module has no case for it: every sentence there opens with
 * "Nothing was started", which is exactly the fact that is FALSE when the
 * session opened and the message did not land. Composing it from the product's
 * own shared composer (refusalSentence) rather than writing a second table
 * keeps the vocabulary shared and the fact honest. */

/* WHAT AN EMPTY NODE SAYS WHERE THERE IS NO INSTALLED APP BEHIND THE PAGE.
 *
 * The example fleet, the browser preview and the website's screenshots all run
 * this same view with no agent bridge on `window`. Pressing an empty node there
 * has to explain itself, because the two dishonest options are both worse: a
 * press that silently does nothing reads as a broken product, and a press that
 * reports a refusal reads as a fault on a machine that has none.
 *
 * It names no mechanism and no address. What a person needs is the one fact
 * that this is not the installed application, and the one action that follows
 * from it. It lives here rather than in the shared copy module because it is not
 * a refusal from the engine — nothing was asked of anything. */
const START_NEEDS_APP_TEXT = 'Starting an agent needs the installed ToolsEnabled application. This page is a preview of it, so nothing here can start one. Open ToolsEnabled on your computer to grow a real tree.'

/* THE SENTENCE FOR THE ONE FAILURE THAT IS NOT A FAILED START.
 *
 * The lead states the fact only this file knows — the session opened, the words
 * did not arrive — and refusalSentence() supplies the diagnosis and the remedy
 * from the product's shared tables. It can never return a code and it can never
 * return an empty string, so this is always two whole sentences. */
const SEND_FAILED_LEAD = 'Your agent started, and your message did not reach it.'
function sendRefusalSentence(result) {
  return `${SEND_FAILED_LEAD} ${refusalSentence(result, { fallback: 'The message was not accepted by the session.' })}`
}

/* START AN AGENT FOR ONE NODE OF THE TREE, and report what really happened.
 *
 * Answers one of four states, and the caller has to be able to tell them apart:
 *
 *   { ok: true, sessionId }        a session is open and the words were sent
 *   { ok: false, needsApp: true }  there is no installed app behind this page
 *   { ok: false, sessionId: null } nothing started; the node did not begin
 *   { ok: false, sessionId }       a session IS open and the words did not land
 *
 * The fourth is the one worth the length. Throwing the session name away because
 * the send was refused would leave a real agent running on the person's computer
 * with nothing on screen pointing at it, and the node would invite them to start
 * a second one. So the name comes back, the node keeps it, and the sentence says
 * plainly that the agent is running and the message is not.
 */
/* Exported for the research workbench's dispatcher: an experiment worker is
   started through THIS function — the same contract, the same refusal
   sentences, the same four outcome shapes — so a worker node on the tree is
   indistinguishable from one the compose panel started. */
/* `onSessionOpen` IS CALLED BETWEEN THE TWO CALLS, AND THAT POSITION IS THE
 * WHOLE REASON IT EXISTS.
 *
 * A caller learns the session's name from the value this function returns --
 * which is to say, after the message has been sent. Everything a surface needs
 * in order to RECEIVE that turn is keyed by that name: the fleet tree's event
 * listener drops any packet whose sessionId it has not been told about yet.
 *
 * That ordering held for as long as sending answered immediately. MEASURED
 * 2026-08-17 against both engines, it does not: the Claude CLI reports a turn
 * by streaming it, so its first words -- and, when the answer is short enough
 * to arrive in one read, its completion too -- reach the page before the send
 * is answered. Every one of those packets was dropped, and the node sat at
 * `running` with nothing in it and no error to show for it.
 *
 * So the session is handed over the moment it exists and BEFORE anything is
 * sent into it, when no event for it can possibly have been emitted yet. That
 * is true of every engine rather than of the fast one, which is the property
 * this had to have and did not.
 *
 * A callback that throws must not take the start with it: the session is real
 * by then, and losing it here would leave an agent running with nothing on
 * screen naming it -- the failure the four outcome shapes above exist to
 * prevent. */
export async function startAgentForNode({ text, surface, tier, effort, profileId, requestKeys = null, onSessionOpen }) {
  const bridge = typeof window === 'undefined' ? null : window.mcAgent
  if (!bridge || typeof bridge.start !== 'function' || typeof bridge.send !== 'function') {
    return {
      ok: false,
      needsApp: true,
      sessionId: null,
      code: null,
      sentence: START_NEEDS_APP_TEXT,
      needsAssistantProgram: false,
    }
  }

  let started = null
  try {
    /* The tier rides only when the panel supplied one: agent.js's page start
       sends none and keeps its old shape, and parseAgentStart treats an absent
       tier as the engine's own default rather than a refusal. Two literal
       calls rather than one built object, because the fleet-trees suite
       measures every `.start({...})` in this file mechanically and a request
       assembled elsewhere is a call it cannot read. */
    /* Optional keys ride only when supplied; profileId is an ID the main
       process resolves against folders the person picked in the OS dialog --
       the renderer never handles a path. */
    const startRequest = {
      surface,
      ...(tier ? { tier } : {}),
      ...(effort ? { effort } : {}),
      ...(profileId ? { profileId } : {}),
      /* The standing-request scope keys — tree node ids and the conversation's
         own id, never paths — so the session's first turn can carry the
         person's filed rules. See nodeRequestKeys() and shell/agent-host.cjs. */
      ...(requestKeys ? { requestKeys } : {}),
    }
    started = await bridge.start(startRequest)
  } catch (error) {
    /* A REJECTION IS A REFUSAL WITH ITS CODE IN THE MESSAGE. Electron rebuilds a
       rejected call in this window from the error's name and message; own
       properties do not survive, so `error.code` is undefined for every refusal
       that crossed the boundary and shell/main.cjs makes the MESSAGE the code
       for exactly that reason. refusalCode() reads it back and only ever returns
       a code the shared tables already have a sentence for. */
    const refusal = { ok: false, code: refusalCode(error) }
    return {
      ok: false,
      needsApp: false,
      sessionId: null,
      code: refusal.code,
      /* THE TIER RIDES WITH THE REFUSAL. AGENT_TIER_NO_LAUNCHER is raised for
         whichever provider this build has no launcher for, and only the press
         knows which one was asked for -- see tierNoLauncherSentence(). Every
         other code ignores it. */
      sentence: startRefusalSentence(refusal, { tier }),
      needsAssistantProgram: refusalNeedsAssistantProgram(refusal),
    }
  }
  /* READ, not inferred. `started.ok === false` is the described refusal;
     a missing or empty session name is a reply that cannot be steered even if it
     claims success, and treating it as a start would produce a node pointing at
     a session nothing can send to. */
  if (!started || started.ok === false || typeof started.sessionId !== 'string' || started.sessionId.length === 0) {
    return {
      ok: false,
      needsApp: false,
      sessionId: null,
      code: refusalCodeOf(started),
      sentence: startRefusalSentence(started, { tier }),
      needsAssistantProgram: refusalNeedsAssistantProgram(started),
    }
  }

  const sessionId = started.sessionId
  /* The engine names the thread it opened. Kept and handed to the caller so
     the durable transcript record can carry it — the name a TRUE engine-side
     resume would ask for, saved now so that future has no data gap. */
  const threadId = typeof started.threadId === 'string' && started.threadId.length > 0 ? started.threadId : null
  if (typeof onSessionOpen === 'function') {
    try { onSessionOpen({ sessionId, threadId }) } catch { /* see the note above: the session outlives a caller's bug */ }
  }
  let sent = null
  try {
    sent = await bridge.send({ sessionId, text })
  } catch (error) {
    const refusal = { ok: false, code: refusalCode(error) }
    return {
      ok: false,
      needsApp: false,
      sessionId,
      threadId,
      code: refusal.code,
      sentence: sendRefusalSentence(refusal),
      needsAssistantProgram: false,
    }
  }
  if (sent && sent.ok === false) {
    return {
      ok: false,
      needsApp: false,
      sessionId,
      threadId,
      code: refusalCodeOf(sent),
      sentence: sendRefusalSentence(sent),
      needsAssistantProgram: false,
    }
  }
  return { ok: true, needsApp: false, sessionId, threadId, code: null, sentence: null, needsAssistantProgram: false }
}

/* THE SESSIONS THIS APP RUN REALLY OWNS.
 *
 * MODULE SCOPE IS THE WHOLE POINT: this map lives exactly as long as the
 * renderer does, which is exactly as long as a session can. A child process
 * dies with the application, so a session id read back from storage at the next
 * launch names something that is not there any more, and a map rebuilt from
 * storage cannot tell the two apart.
 *
 * IT REPLACES A PER-VIEW MAP THAT WAS REFILLED FROM THE STORE, and that refill
 * is the defect. It was added for a real reason -- leaving the fleet page and
 * coming back orphaned every session this window still owned, so replies had
 * nowhere to land (measured 2026-08-13) -- but it fixed that by declaring every
 * SAVED session live, including the ones killed when the app last closed. What
 * a person then met, measured on the packaged build 2026-08-16: close the app
 * mid-turn, reopen the same profile, and the circle is blue with a ticking
 * clock over a process that does not exist, the chip says "starting" forever,
 * Stop stands over a corpse, Resume is refused BECAUSE it looks busy, and a
 * typed message answers "Queued -- sends by itself when this turn finishes"
 * into a queue no turn will ever drain.
 *
 * A map that outlives the VIEW but not the PROCESS answers both: a session this
 * run started stays routable across every navigation, and a session from a
 * previous run is absent, which is the truth. nodeBusy() is the reader that
 * matters -- see its note -- and the recovery it hands a stale node to
 * (MC_AGENT_UNKNOWN_SESSION -> recoverDeadSessionSend) was written for exactly
 * this state and has been unreachable since the refill landed. */
const RUN_SESSION_NODES = new Map()

/* THE COMPOSE PANEL THAT MUST SURVIVE ITS OWN SWITCH.
 *
 * MODULE SCOPE FOR ONE MEASURED REASON. src/write-flags.js announces every
 * change, and src/main.js re-renders the whole route when it hears one -- which
 * is right, because a flag flipped anywhere must reach every surface at once.
 * But the panel's own "Turn on running agents" IS such a change, so pressing it
 * destroyed the view the person was looking at, panel and all. Measured
 * 2026-08-18 on a staged build: the flag was written, the switch worked, and
 * the panel simply vanished -- Start "came back" on a page they were no longer
 * on. That is a restart in everything but name, and the owner asked for no
 * restart.
 *
 * So the press records WHICH slot was being composed, the rebuilt view reads it
 * once, and the panel reopens where it was. It holds a slot-press detail and
 * nothing else, it is cleared the moment it is used, and nothing writes it
 * except that one press -- a stale entry could otherwise open a panel over a
 * node on a later visit that nobody asked for. */
let composeToRestore = null

/* WHERE A COMPUTER'S RECORD CAME FROM, in words rather than in the word the
   program uses. `computer.note` is `sourceKind`, which the fleet schema pins to
   exactly two values, so this is a lookup and not a guess -- and an unexpected
   third value falls through to a sentence that claims nothing. */
const RECORD_SOURCE = Object.freeze({
  declared: 'Written down in this computer’s declared organisation.',
  observed: 'Seen running on this computer.',
})

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
  /* THE ENGINE ROWS THE COMPOSE PANEL WILL SHOW. Starts as the module's own
     pessimistic default -- the three Codex tiers -- and is replaced once the
     shell answers. A press that lands before the answer therefore shows what
     every build could always start, never a row that promises more than this
     payload carries. */
  let startableTierChoices = TIER_CHOICES
  /* THE IDS BEHIND THOSE ROWS, kept because two surfaces need two different
     things out of one answer: the start menu needs the labelled rows, and the
     node panel's Engine row needs to name the PROVIDERS this copy can start.
     Deriving the second from the first is not possible -- tierChoicesFor()
     returns every tier, marking the ones that cannot start -- so the answer is
     held in the shape the shell gave it. */
  let startableTierIdList = TREE_DEFAULT_STARTABLE_TIERS
  /* ASK THE SHELL WHICH TIERS THIS COPY CAN REALLY START.
   *
   * THE DEFECT THIS CLOSES. This renderer used to decide startability from a
   * frozen list of provider names, so the menu said "cannot start from a tree
   * yet" on a build that could, and would have gone on saying it after the
   * engine shipped. The shell has always had the real answer:
   * mc-agent:startable-tiers runs the SAME resolveStartTier() the press runs, so
   * the menu and the button cannot disagree by construction.
   *
   * EVERY FAILURE PATH IS THE SAME PATH, and it is the pessimistic one. No
   * bridge (a plain browser during `npm run dev`), a rejected invoke, a reply
   * that is not the shape promised, or an answer that arrives after this view is
   * gone -- all leave the Codex-only default exactly as it is today. The one
   * thing this must never do is guess upward: a row that says "startable" over a
   * press that refuses is the half-start that is worse than an honest refusal.
   * startableTierIds() in src/fleet-tree-copy.js owns that judgement, including
   * the one case worth spelling out -- an EMPTY list is an answer and is
   * honoured, while a malformed one is not.
   *
   * It is fetched once per view rather than per node click: the payload cannot
   * change while the window is open, and a probe per click would be a request
   * per press for an answer that cannot have moved. */
  async function startableTiersNow() {
    let reply = null
    try {
      reply = await window.mcAgent?.startableTiers?.()
    } catch {
      return
    }
    if (destroyed) return
    startableTierIdList = startableTierIds(reply)
    startableTierChoices = tierChoicesFor(startableTierIdList)
  }
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
  /* Research projects, for filing sessions. Read ONCE per mount; the refusal
     is kept so the filing control can render disabled WITH the sentence
     instead of as an empty select pretending no projects exist. */
  let researchService = null
  const researchAssignments = createAssignmentStore({ storage: typeof window === 'undefined' ? null : window.localStorage })
  let railChatUnsub = null

  const root = el(`
    <div class="computers">
      <div class="tabs"></div>
      <div class="comp-body">
        <!-- ONE REAL BAR PER PANE (owner, iteration 6: "it should be one nice
             bar per split and it should have a scroll function. you have to
             place it nicely though"). The title, the tree switcher and the
             tool buttons used to be absolutely positioned siblings sharing one
             band over the canvas, and the strip legally painted across the
             title the moment enough trees existed. The bar is normal flow with
             three FIXED slots — name, trees, tools — so construction order
             stops deciding the visual order, and the trees slot alone scrolls
             sideways (hidden scrollbar, edge fades). -->
        <div class="graph-wrap glass">
          <!-- THE BAR, REBUILT (owner, 2026-08-18: "this bar is still super ugly
               ... start over on just this top bar"). Same three slots, because
               that part was never the complaint; what it lacked was RANK and
               GROUPING, and what it carried was a paragraph.

               RANK. Everything in it was one weight at one size, so the name of
               the computer competed with a zoom percentage. The name is now the
               only thing in the bar with title weight, in its own lead slot, and
               every control is one shared 28px chip.

               GROUPING. Three jobs, in the order they get used, separated by
               hairlines (drawn by the slots themselves, so no divider elements
               exist to fall out of place): WHAT you are looking at, HOW you are
               looking at it (zoom), and WHAT YOU CAN DO with it (edit, and the
               one control that leaves the page).

               AND THE PARAGRAPH IS GONE. "No research projects exist yet. Create
               one on the research page first." was mounted into the tool strip,
               so a sentence about a different page sat in the row of buttons for
               this one. Filing a scope under a project is a fleet-wide setting,
               so it is now a named section of the fleet rail beside Session
               profiles and Roles -- see mountResearchScopeControl. -->
          <div class="graph-bar">
            <div class="graph-bar-lead">
              <div class="graph-title"></div>
            </div>
            <div class="graph-bar-trees"></div>
            <div class="graph-tools">
              <!-- src/tree-graph.js inserts the zoom cluster as this slot's FIRST
                   child, which is why the buttons below live in their own group:
                   without it the zoom controls and the actions were one
                   undifferentiated run of chips. -->
              <div class="graph-tool-set">
                <button class="graph-reset-btn" type="button" hidden>Reset positions</button>
                <button class="graph-edit-btn" type="button" title="Edit the role hierarchy">Edit</button>
                <!-- THE NAMED DOOR TO THE DRILL-IN.
                     src/tree-graph.js already made ONE CLICK on a node open the rail,
                     which fixed the gesture. It did not fix the naming: nothing on
                     this page said the drill-in exists, so reaching it still meant
                     clicking a bubble on the chance that something useful appears,
                     then finding "Open full view" inside the panel that appeared.
                     This button is the same destination said out loud, in the strip
                     that already holds this page's named controls, and it is a
                     sibling of the rail button rather than a replacement for it.
                     It is LAST in the group and the only accented chip, because it
                     is the only one of the three that leaves this page. -->
                <button class="graph-open-btn" type="button" hidden>Open agent detail</button>
              </div>
              <!-- The Split button (owner defect 5's second, view-only pane) stood
                   here until 2026-08-16. Owner: "lets throw it away for now" -- his
                   read was that a page ends up with two views nobody keeps
                   straight. So the button, its pane and its saved preference are
                   gone; the page is single-pane, which is also the shape every
                   harness measured it in. The bar around it is the packaging
                   lane's, which is why this resolution keeps their structure and
                   his removal at once. -->
            </div>
          </div>
          <div class="graph-canvas-slot">
            <div class="graph-crumb"></div>
            <div class="graph-hint">Select a node to focus its branch</div>
            <div class="graph-edit-note">drag onto a parent or into empty space</div>
            <!-- WHAT THE LAST ACTION ON THIS CANVAS DID, and there are two of them
                 now: a drag onto a new manager, and a start from an empty node.
                 A drag has no other place to report from: the rail is showing
                 whichever node was last clicked, which is not necessarily the one
                 being moved, and the canvas itself can only show the node's
                 position. A start needs this line for a different reason — the
                 panel that reported it closes on success, and the person is then
                 looking at the canvas. A refusal stays until the next attempt; a
                 save clears itself, because a persistent "saved" would be
                 indistinguishable from a stale one. -->
            <div class="org-status" data-state="idle" role="status" hidden></div>
          </div>
        </div>
        <aside class="rail glass">
          <div class="rail-page stats-page is-active"></div>
          <div class="rail-page ctl-page board-page"></div>
          <!-- THE RIGHT-SIDE PANEL THE OWNER ASKED FOR, and it is a THIRD page
               rather than a takeover of one of the two above. Both of those are
               about something that already exists — the fleet, or one agent —
               and the person reading either of them may press an empty node
               without meaning to lose it. This page holds the compose panel
               while it is open and hands the rail back to whichever page was
               showing when the panel closes. It is empty until a press: nothing
               is built here on load, because nothing here is a thing to read. -->
          <div class="rail-page compose-page"></div>
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
  const composePage = root.querySelector('.compose-page')
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

  /* THE SENTENCE AND THE IDENTIFIER TRAVEL TOGETHER, and until a driver checked,
     only half of that was true here.
   *
   * The rule src/refusal-copy.js sets has two halves: the code never appears in
   * words a person reads, AND it is still carried where a support conversation
   * can reach it. This line kept the first half and quietly dropped the second —
   * a refused start left a good sentence on screen and nothing on the page
   * anywhere naming which refusal it was. Measured on a packaged window from a
   * fresh profile: querySelectorAll('[data-refusal-code]') returned nothing at
   * all after a refused submit.
   *
   * It is marked HERE rather than at each call site so the attribute cannot
   * outlive the sentence it belongs to. Every path through this function sets or
   * clears it — including the seven-second fade, where a code left behind would
   * describe a message that is no longer on screen. */
  function setOrgStatus(text, state = 'info', { sticky = false, code = null } = {}) {
    clearTimeout(orgStatusTimer)
    orgStatusTimer = 0
    orgStatusElement.textContent = text || ''
    orgStatusElement.dataset.state = text ? state : 'idle'
    orgStatusElement.hidden = !text
    markRefusalCode(orgStatusElement, code ? { code } : null)
    if (text && !sticky) {
      orgStatusTimer = setTimeout(() => {
        orgStatusElement.hidden = true
        orgStatusElement.textContent = ''
        orgStatusElement.dataset.state = 'idle'
        markRefusalCode(orgStatusElement, null)
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
    /* The compose panel is a page here like the other two, so exactly one of the
       three is ever on screen and none of them has to know about the others. */
    composePage.classList.toggle('is-active', page === composePage)
    if (page === statsPage) {
      railDisposeTimer = setTimeout(clearBoard, 200)
      /* RE-READ THE RECORD ON THE WAY BACK. The overview is painted once when
         the board mounts, and coming back to it from the compose panel does not
         re-render it -- so a person who started an agent and pressed Cancel was
         looking at the count as it stood BEFORE they started anything. Measured
         on the packaged build: two starts in the signed ledger, hero still
         reading 0, which is the owner's report exactly. Returning to this page
         is a gesture, not a poll, so this costs one read per visit. */
      void paintAgentsOnRecord()
    }
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
    /* A TREE NODE MOVES IN THE TREE STORE; a fleet agent moves in the declared
       organisation. Before this branch, dragging a node the person had
       CREATED hit the org projection's byId miss and shook with no sentence
       anywhere — an affordance that was visible on their own agents and
       silently did nothing. Mixed drags refuse with words for the same
       reason. The store's own refusals (caps, cycles, cross-tree) come back
       verbatim; the subscription repaints the tree on an accepted move. */
    const dragIsTree = Boolean(treeStore?.getNode(agentId))
    const dropIsTree = Boolean(treeStore?.getNode(parentId))
    if (dragIsTree || dropIsTree) {
      if (dragIsTree !== dropIsTree) {
        setOrgStatus(MOVE_PANEL.mixed, 'refuse', { sticky: true })
        return false
      }
      const moved = treeStore.moveNode(agentId, parentId)
      if (!moved.ok) {
        setOrgStatus(moved.problems[0] || MOVE_PANEL.notSaved, 'refuse', { sticky: true })
        return false
      }
      setOrgStatus(MOVE_PANEL.saved(treeNodeName(moved.node), treeNodeName(treeStore.getNode(parentId))), 'ok')
      return true
    }
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

  /* THE DOOR MUST NOT DEPEND ON THE TREE, BECAUSE THE TREE IS EMPTY BY DESIGN.
   *
   * WHAT WAS MEASURED, on a staged packaged build with a fresh profile, at five
   * window sizes and from the keyboard:
   *   .graph-open-btn      1   (in the DOM)
   *   pressable            no  (hidden)
   *   .static-tree-node    0
   * and, from tools/a11y-keyboard-qa: "an agent can be opened from the keyboard
   * on the computers page -- no Open control was reachable by Tab".
   *
   * WHY. This button was aimed at `computer.agents[0]`, and since 5cc2f09 ("a
   * fleet tree you build, instead of one the app invented") those are the agents
   * this person has STARTED -- correctly empty until they start one. So the
   * button hid itself on every fresh install.
   *
   * AND THAT CLOSED A CIRCLE. #/agent/<computer>/<agent> is where a session is
   * started from a declared seat (src/agent-session.js publishes the live record
   * from there). This button is its only door inside the product. So: no started
   * agent, no door; no door, no way to reach the page that starts one. The page
   * itself was never broken -- src/views/agent.js resolves from
   * declaredAgentsData(), which answers for every declared seat whether or not
   * anything has run -- so the destination was live the whole time with nothing
   * pointing at it.
   *
   * THE TREE STAYS EMPTY. This changes no node, draws no circle and invents no
   * agent: the owner's rule ("the node tree should be empty unless a user has
   * started a session") is the reason the fallback reads DECLARED CAPACITY
   * rather than putting a seat on the canvas. Capacity is what this computer
   * COULD run, it is exactly what the drill-in page reads, and declared-fleet.js
   * keeps the two halves apart on purpose. Nothing is drawn; a door is named. */
  function firstDeclaredTarget() {
    if (!liveMode || !orgReady()) return null
    const seat = declaredAgentsData(orgAvailability.org)?.declared?.[0]
    return seat ? { id: seat.id, name: seat.displayName || seat.id } : null
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

  /* ==========================================================================
     THE TREES THIS COMPUTER HOLDS, AND THE PRESS THAT GROWS ONE.
     ==========================================================================

   * THE OWNER'S FLOW, END TO END, AND WHICH FILE OWNS EACH STEP:
   *
   *   an empty circle is drawn        src/tree-graph.js
   *   it is pressed                   src/tree-graph.js reports it, starts nothing
   *   the right-side panel opens      src/agent-compose-panel.js
   *   role and message are answered   src/agent-compose-panel.js
   *   a DRAFT agent joins the tree    src/fleet-trees.js
   *   a real session starts           window.mcAgent, via startAgentForNode above
   *   the session is attached to it   src/fleet-trees.js
   *
   * Everything between those steps is this file, and it is deliberately nothing
   * but joining: no structure rules, no form, no sentences. Each of those three
   * modules is proven on its own under `node --test`; a rule copied into this
   * view would be a second opinion that no test holds.
   *
   * NOTHING IN HERE RUNS ON MOUNT. The store is read when a computer is drawn,
   * because a tree that was built yesterday has to appear today — that is a
   * READ. The panel is built on a press, the draft is written on a submit, and
   * the bridge is called from that submit and from nowhere else.
   */

  /* One store per computer, because a tree belongs to the machine it runs on and
     the person switching tabs is switching machines. Rebuilt by mountGraph when
     the computer changes; the previous one is dropped with its subscription. */
  let treeStore = null
  /* The durable transcript excerpts for this computer's nodes — opened and
     released in step with the tree store, but failing ALONE: a transcript
     store that cannot open leaves the trees standing and resume disabled. */
  let transcriptStore = null
  let treeStoreUnsub = null
  /* Registered while this view's store instance is live, so the research
     dispatcher's module-level listener never opens a second instance beside
     it — see markTreeStoreLive in src/fleet-trees.js. */
  let treeStoreLiveRelease = null
  let treeStoreId = null
  /* WHOSE ANSWER IS WHOSE. One event stream carries every open session, so the
     tree keeps its own map from session to node, written at the one place a
     session is born (submitCompose), and a per-session turn buffer -- the
     engine emits one delta per token, and a reply is one message, not one
     message per token (the agent page's CORRECTED note is the measured version
     of why). nodeReplies is what the rail renders under "What it said".

     The session map itself is RUN_SESSION_NODES, above: it belongs to the app
     run and not to this view instance, for the reason given there. */
  const sessionNodeIds = RUN_SESSION_NODES
  const sessionTurnText = new Map()
  const nodeReplies = new Map()
  /* The latest narration line per node ("Running a command: …"), cleared when
     the turn completes -- the reply takes over from there. */
  const nodeActivity = new Map()
  /* EVERY SURFACE WAITING ON THIS TURN, not the last one to ask.
   *
   * This was one callback per session, set unconditionally by whichever
   * surface sent. Since 5f394a4 gave the compact card the whole shared config,
   * BOTH the card and the rail's Chat tab can send -- so a second send
   * overwrote the first surface's callback, and that surface's pending bubble
   * was never answered by anything. The person watched a message they had
   * really sent sit unanswered while the reply appeared somewhere else (owner,
   * 2026-08-18: "the messages in history disappear or combine into each
   * other").
   *
   * A set, drained once when the turn completes. A surface that closed in the
   * meantime simply is not in it; the reply still lands on the chip, the store
   * and the transcript, because those are the record and a card is a window. */
  const turnReplies = new Map()
  function awaitTurnReply(sessionId, reply) {
    if (!sessionId || typeof reply !== 'function') return
    const waiting = turnReplies.get(sessionId) || new Set()
    waiting.add(reply)
    turnReplies.set(sessionId, waiting)
  }
  function dropTurnReply(sessionId, reply) {
    const waiting = turnReplies.get(sessionId)
    if (!waiting) return
    waiting.delete(reply)
    if (waiting.size === 0) turnReplies.delete(sessionId)
  }
  /* Taken and cleared in one step, so a reply handler that sends again cannot
     be answered by the turn it is answering. */
  function deliverTurnReply(sessionId, said) {
    const waiting = turnReplies.get(sessionId)
    if (!waiting) return
    turnReplies.delete(sessionId)
    for (const reply of waiting) {
      try { reply(said) } catch { /* one broken surface must not starve the rest */ }
    }
  }
  /* THE CONVERSATION, kept in this window's memory and said to be exactly
     that. The STORE keeps one reply per node (the durable part); these maps
     keep the back-and-forth so the card and the rail can show a real history
     instead of opening empty over a node that has plainly spoken. Bounded per
     session; entries carry the turnId the engine returned so a rewind can one
     day point at "the message where I said …". */
  const TRANSCRIPT_MAX_ENTRIES = 60
  const sessionTranscripts = new Map()
  /* WHAT THE AGENT DID, kept beside what it said and for the same reason: a
     chat opened halfway through a turn must already show the work taken so
     far, and a chat that was never open must show it afterwards. One bounded
     buffer per session -- the caps live in createActionBuffer, and both of
     them are the kind a person can see. */
  const sessionActions = new Map()
  /* EVERY CHAT MOUNTED OVER THIS SESSION. The product mounts two surfaces from
     one config (the rail's Chat tab and the compact card on the canvas), and an
     action that reached only one of them would be exactly the drift the shared
     config exists to prevent. Roots are added by the config's onReady and
     dropped again the moment they leave the document -- a chat that has been
     closed must never be written to, and holding one is how a retired view is
     retained. */
  const chatSurfaces = new Map()
  const sessionTurnLog = new Map()
  /* What the engine says the session has used, latest reading per session —
     the usage events crossed the wire from day one and were dropped here. */
  const sessionUsage = new Map()
  /* The model the person chose for the NEXT message, per session. Rides on
     every send until cleared; the engine accepts it per turn, so the
     conversation continues — this is a real switch, not a respawn. */
  const sessionModelOverride = new Map()
  /* Images picked for the next card send, per session — issued paths only
     (the shell refuses anything the picker did not hand out). */
  const sessionPendingImages = new Map()
  /* What each session started with: the reasoning depth it was bound to at
     spawn (the effort switch shows this as "current"), and the thread name
     the engine reported (saved with the durable transcript so a real
     engine-side resume is possible one day without a data gap). */
  const sessionEfforts = new Map()
  const sessionThreadIds = new Map()

  /* THE TURN EACH SESSION'S OPEN BUBBLE AND ACCUMULATOR BELONG TO. Absent
     means nothing is in flight; an engine that does not name its turns leaves
     it absent forever and behaves exactly as it did before. */
  const sessionOpenTurns = new Map()

  /* SESSIONS WHOSE RUNNING TURN THE PERSON STOPPED, from this window. Both
     interrupt doors — the palette row and the composer's Stop face — reach
     one handler, which records the press only after the engine accepted it;
     the completion that follows consumes the record and says "stopped by
     you" instead of "the last turn failed". Per turn, never sticky: the next
     completion answers for itself. */
  const sessionsInterrupted = new Set()

  /* THE QUESTION AN AGENT IS STILL WAITING ON. sessionId -> the approval
     activity, exactly as the event carried it. MEASURED on the shipped 1.0.20:
     a child called agent_comms.send_local, approval_request fired while the
     person was looking at the tree rather than at that node's rail, and the
     card render below was gated on the rail being open -- so the one event
     that could paint the Approve button passed unrendered, nothing re-read the
     request on a later rail open, and the session sat blocked until
     interrupted. "It stops and asks you" had stopped and asked nobody. The
     event is remembered here, rendered whenever that node's rail opens, and
     forgotten when it is answered or its turn ends. */
  const sessionPendingApprovals = new Map()

  /* A turn that was never formally completed still SAID something, and those
     words are the record. Called when a delta arrives naming a different turn
     than the one still open: the previous answer is filed, its bubble is
     ended, and every surface waiting on it is answered -- then the accumulator
     is cleared so the new turn starts from nothing. */
  function settleTurnBoundary(sessionId, turnId) {
    if (!turnId) return
    const open = sessionOpenTurns.get(sessionId)
    sessionOpenTurns.set(sessionId, turnId)
    if (!open || open === turnId) return
    const spoken = (sessionTurnText.get(sessionId) || '').trim()
    sessionTurnText.delete(sessionId)
    /* The work before the words, because that is the order it happened in. */
    recordTurnActions(sessionId)
    if (spoken) {
      const nodeId = sessionNodeIds.get(sessionId)
      if (nodeId) nodeReplies.set(nodeId, spoken)
      transcriptAppend(sessionId, { who: 'agent', text: spoken, at: Date.now() })
      deliverTurnReply(sessionId, spoken)
    }
    if (railChat && railChat.sessionId === sessionId && railChat.stream) {
      railChat.stream.close(spoken || null)
      railChat.stream = null
    }
  }

  function transcriptAppend(sessionId, entry, { persist = true } = {}) {
    if (!sessionId) return
    /* WINDOW MEMORY AND THE DURABLE RECORD ARE ONE HISTORY, AND UNTIL NOW THEY
     * WERE TWO.
     *
     * THE DEFECT, measured 2026-08-18. treeChatConfigFor reads the record only
     * `if (!history.length)` and deliberately never seeds this map -- reading
     * is reading. But nothing seeded it on the WRITE side either, so the FIRST
     * line appended for a session this window had not held became the whole of
     * `history`, and a five-line saved record was shadowed for the life of the
     * view. That is the owner's screenshot: a panel showing one YOU bubble over
     * a conversation that really happened.
     *
     * So the seed happens HERE, once, before the first append -- which is
     * exactly the moment the map stops being empty and starts standing in for
     * the record. `has`, not `get().length`: a session deliberately set to an
     * empty history (a plain start) has already been decided about, and
     * re-seeding it would resurrect a conversation somebody chose to leave. */
    if (!sessionTranscripts.has(sessionId)) {
      const seedNodeId = sessionNodeIds.get(sessionId)
      const saved = seedNodeId && transcriptStore ? transcriptStore.get(seedNodeId) : null
      sessionTranscripts.set(sessionId, saved && Array.isArray(saved.lines) ? saved.lines.slice() : [])
    }
    const held = sessionTranscripts.get(sessionId) || []
    held.push(entry)
    if (held.length > TRANSCRIPT_MAX_ENTRIES) held.splice(0, held.length - TRANSCRIPT_MAX_ENTRIES)
    sessionTranscripts.set(sessionId, held)
    /* A batch of appends persists ONCE, at its end. Writing the whole record to
       storage per line was fine at one line per turn and is not fine now that a
       turn can also file the dozen things the agent did. */
    if (persist) persistTranscript(sessionId)
  }

  /* ---- WHAT THE AGENT DID: BUFFER, SURFACES, RECORD ----
   *
   * THE DEFECT (owner, item 1). The engine narrates every turn -- tool_call,
   * tool_result, approval_request, each with the command or the path, the exit
   * code, and the name that pairs a result with its call -- and every one of
   * those packets already reached this view. The activity branch below turned
   * them into ONE overwritten status line and a chip, and deleted that on
   * completion. Nothing reached the chat, the record, or any list. A turn that
   * spent five minutes running commands put zero rows in front of a person.
   *
   * These three functions are the missing half, and they are deliberately the
   * same shape the words already have: buffer it, tell both open surfaces, and
   * record it with the conversation. */
  function actionBufferFor(sessionId) {
    let buffer = sessionActions.get(sessionId)
    if (!buffer) {
      buffer = createActionBuffer()
      sessionActions.set(sessionId, buffer)
    }
    return buffer
  }

  /* One buffered row, in the shape a chat log draws: words for the tool and
     the outcome (from the copy module, where the plain-language gate holds
     them), the one-line detail, and the whole command plus its captured output
     for when the row is opened. */
  function actionChatRow(row) {
    const words = actionRowWords(row)
    return {
      id: `action:${row.id}`,
      tool: words.tool,
      detail: words.detail,
      state: words.state,
      stateKey: row.state,
      body: [row.detail, row.output].filter(Boolean).join('\n\n'),
      at: row.at,
    }
  }

  function registerChatSurface(sessionId, root) {
    if (!sessionId || !root) return
    const held = chatSurfaces.get(sessionId) || new Set()
    held.add(root)
    chatSurfaces.set(sessionId, held)
  }

  /* TELL EVERY CHAT THAT IS STILL ON SCREEN, and forget the ones that are not.
     `isConnected` is the test rather than a close callback: a card collapses,
     a rail rebuilds and a view is destroyed by three different mechanisms, and
     a set that only ever grows would hold a detached chat -- and the whole tree
     behind it -- for the life of the page. */
  function broadcastAction(sessionId, chatRow) {
    const held = chatSurfaces.get(sessionId)
    if (!held) return
    for (const root of [...held]) {
      if (!root.isConnected) { held.delete(root); continue }
      try { root.addAction?.(chatRow) } catch { /* one broken surface must not starve the rest */ }
    }
    if (held.size === 0) chatSurfaces.delete(sessionId)
  }

  /* THE RECORD, WRITTEN ONCE PER TURN RATHER THAN ONCE PER EVENT. A busy turn
     emits thousands of tool events and each one used to be a whole-record write
     away from the durable store; the newest handful are filed when the turn
     ends, which is the same moment the agent's words are filed. Rows already
     written are marked, so a second turn never re-files the first turn's work
     out of order. */
  function recordTurnActions(sessionId) {
    const buffer = sessionActions.get(sessionId)
    if (!buffer) return
    const fresh = buffer.list().filter(row => !row.recorded)
    if (fresh.length === 0) return
    for (const row of fresh) row.recorded = true
    for (const row of fresh.slice(-TRANSCRIPT_LIMITS.maxActionLines)) {
      const words = actionRowWords(row)
      /* THE TOOL'S NAME IN ITS OWN SLOT, not folded into the text. Joined into
         one string, a restored row painted with an EMPTY tool chip and the
         whole sentence in the detail -- the same row, two different looks,
         which is the defect items 2 and 4 describe reappearing on the
         restore path. Measured on a staged build before this line changed:
         live rows read Command / "npm test", restored rows read "" /
         "Command npm test". */
      transcriptAppend(sessionId, {
        who: 'action',
        text: words.detail || words.tool,
        tool: words.tool,
        at: row.at,
        state: row.state,
      }, { persist: false })
    }
    persistTranscript(sessionId)
  }

  /* One action line as the record kept it, back in the shape a chat draws. */
  function savedActionRow(entry, index) {
    return {
      who: 'action',
      id: `saved:${index}:${entry.at || 0}`,
      tool: typeof entry.tool === 'string' ? entry.tool : '',
      detail: typeof entry.text === 'string' ? entry.text : '',
      state: actionRowWords(entry).state,
      stateKey: typeof entry.state === 'string' ? entry.state : '',
      body: '',
      at: entry.at,
    }
  }

  /* THE CONVERSATION AND THE WORK, IN ONE LIST, IN THE ORDER THEY HAPPENED.
   *
   * A chat opened mid-turn has to show both halves: the record's own lines
   * (what was said, and the actions of turns that have finished) and the
   * actions of the turn still running, which have not been filed yet.
   *
   * THEY ARE NOT SORTED, AND THAT IS THE POINT. The record's order IS the
   * order things happened -- it was appended one line at a time -- and a sort
   * would need a timestamp on every line, which the brief-and-latest-reply
   * fallback does not have. What is still in flight is by definition the
   * newest, so it goes on the end. The two halves cannot double up either:
   * a buffered row is marked the moment it is filed, and only unfiled rows
   * are added here. */
  function mergeActionsIntoHistory(history, sessionId) {
    const buffer = sessionActions.get(sessionId)
    const held = buffer ? buffer.list() : []
    /* WHILE THIS WINDOW IS OPEN, THE RICHER COPY WINS. The saved record keeps
       the command and not the output it printed -- it is an excerpt, and an
       archive of every command's output is not what belongs in a person's
       settings file. But the buffer still holds that output for as long as the
       window lives, so a row reopened five minutes later can still be opened
       onto what the command said. Joined on the moment the row was opened,
       which is what the record carries. */
    const byMoment = new Map(held.map(row => [row.at, row]))
    const drawn = (Array.isArray(history) ? history : []).map((entry, index) => {
      if (!entry || entry.who !== 'action') return entry
      const richer = byMoment.get(entry.at)
      return richer ? { who: 'action', ...actionChatRow(richer) } : savedActionRow(entry, index)
    })
    const pending = held.filter(row => !row.recorded)
    if (pending.length === 0) return drawn
    return [...drawn, ...pending.map(row => ({ who: 'action', ...actionChatRow(row) }))]
  }

  /* THE DURABLE HALF. Every append lands the bounded excerpt on disk under
     the NODE, because the node is what survives the window and the session
     both — it is the thing on screen a person presses Resume on. A missing
     store (open failed, browser-only window) degrades to exactly the old
     behaviour: window-memory transcripts, resume disabled. */
  function persistTranscript(sessionId) {
    if (!transcriptStore) return
    const nodeId = sessionNodeIds.get(sessionId)
    if (!nodeId) return
    const lines = sessionTranscripts.get(sessionId) || []
    if (lines.length === 0) return
    /* A SAVE MUST NOT NULL WHAT IT DOES NOT KNOW.
     *
     * transcriptStore.save REPLACES a node's record whole -- it has never
     * merged. Both fields below are read from WINDOW memory, and a window that
     * never opened this session holds neither, so a save from such a window
     * wrote null over the engine thread name that makes a real Resume possible
     * and over the reasoning depth the node was started at. The record is
     * therefore read first and its answers kept wherever this window has none;
     * a window that DOES know still wins, because it is the live fact. */
    const kept = transcriptStore.get(nodeId)
    transcriptStore.save(nodeId, {
      lines,
      threadId: sessionThreadIds.get(sessionId) || kept?.threadId || null,
      effort: sessionEfforts.get(sessionId) || kept?.effort || null,
    })
  }

  const tierEffortOf = tierId => LAUNCH_TIERS.find(tier => tier.id === tierId)?.effort || null

  /* WHAT THIS ENGINE REALLY OFFERS, asked once and kept for the window.
     model/list is the provider's own catalog: every model, the reasoning
     efforts it supports, each with the provider's description, and its
     default. Read lazily from any running session — there is nothing to ask
     before one exists — and left empty when the engine cannot answer, in
     which case the menus fall back to the built-in names. */
  let engineModelCatalog = null
  let engineCatalogAsked = false
  function readEngineCatalog(sessionId) {
    if (engineCatalogAsked || !sessionId) return
    const bridge = typeof window === 'undefined' ? null : window.mcAgent
    if (!bridge || typeof bridge.models !== 'function') return
    engineCatalogAsked = true
    void bridge.models({ sessionId }).then(answer => {
      if (!answer || !Array.isArray(answer.models)) return
      engineModelCatalog = answer.models
    }).catch(() => { engineCatalogAsked = false })
  }
  /* Everything a start needs in order to tell the agent where it stands. Built
     from the store, so the name in the brief is the name on the circle.
   *
   * THE PARENT'S NAME IS READ, NOT RECOMPUTED, and getting that wrong is a
   * measured defect rather than a precaution. composeParentFor() hands over a
   * PROJECTION -- `{ id, name }` -- and its `name` has already been through
   * treeNodeName. Passing that projection back into treeNodeName finds no
   * `role` on it, so roleLabel falls through to its generic word: the brief
   * told a child under a circle drawn "Manager" that its manager was "Agent",
   * and the running agent dutifully repeated it (measured 2026-08-18 on a
   * staged build with a real Codex session: "My manager is Agent"). The node
   * itself IS a store record and keeps the computed name. */
  function briefContextFor(node, parent) {
    return {
      selfName: treeNodeName(node),
      parentName: parent ? (parent.name || null) : null,
    }
  }

  /* The efforts for the model this node is actually running, or the widest
     the catalog knows when the model cannot be identified. */
  function engineEffortsFor(node) {
    if (!Array.isArray(engineModelCatalog) || engineModelCatalog.length === 0) return []
    const wanted = sessionModelOverride.get(node?.sessionId) || LAUNCH_TIERS.find(tier => tier.id === node?.tier)?.model || null
    const match = wanted ? engineModelCatalog.find(model => model.id === wanted) : null
    const chosen = match || engineModelCatalog.find(model => Array.isArray(model.efforts) && model.efforts.length > 0)
    return chosen && Array.isArray(chosen.efforts) ? chosen.efforts : []
  }

  /* LIVENESS, NOT JUST STATUS. parseFleetTrees loads a saved 'running' node
     back as 'starting', so after an app restart every mid-turn node reads
     busy FOREVER over a dead session — the stop button would stand over a
     corpse and every send would silently queue into a queue nothing will
     ever drain. sessionNodeIds holds exactly the sessions THIS RUN started
     or reattached (RUN_SESSION_NODES), so status AND membership is the honest
     busy test; a restart-stale node reads idle, its send goes out, the engine
     refuses with MC_AGENT_UNKNOWN_SESSION, and the recovery below takes over.

     EVERY READER OF "IS THIS NODE BUSY" GOES THROUGH HERE. The status field
     alone was still being read in five other places -- the chip's word, the
     rail's waiting line, the graph's clock, the resume verb and the runtime
     face -- and each one of them told the restart-stale story its own way. */
  /* The three readers, bound to THIS run's session map. The rules themselves
     live in src/tree-session-liveness.js, where the suite drives them for
     real -- see the note at the top of that file for the six surfaces that
     each used to answer this question their own way. */
  const nodeSessionLive = node => sessionIsLive(node, sessionNodeIds)
  const nodeBusy = node => nodeIsBusy(node, sessionNodeIds)
  const nodeSessionEnded = node => sessionEndedWithApp(node, sessionNodeIds)

  /* The chat composer's ear on a node's status. Notified from refreshTree(),
     the choke point every status mutation already flows through — no second
     event stream to drift from the first. */
  const nodeStatusListeners = new Map()
  function registerNodeStatusListener(nodeId, listener) {
    const held = nodeStatusListeners.get(nodeId) || new Set()
    held.add(listener)
    nodeStatusListeners.set(nodeId, held)
    return () => {
      const set = nodeStatusListeners.get(nodeId)
      if (!set) return
      set.delete(listener)
      if (set.size === 0) nodeStatusListeners.delete(nodeId)
    }
  }
  function notifyNodeStatusListeners() {
    for (const held of nodeStatusListeners.values()) {
      for (const listener of held) {
        try { listener() } catch { /* a dead listener must not break the tree */ }
      }
    }
  }

  function turnLogAppend(sessionId, turnId, yourText) {
    if (!sessionId || typeof turnId !== 'string' || !turnId) return
    const held = sessionTurnLog.get(sessionId) || []
    held.push({ turnId, yourText: String(yourText || '').slice(0, 200), at: Date.now() })
    if (held.length > TRANSCRIPT_MAX_ENTRIES) held.splice(0, held.length - TRANSCRIPT_MAX_ENTRIES)
    sessionTurnLog.set(sessionId, held)
  }
  let currentRailTreeNode = null
  /* The one live streaming surface: the open rail's "What it said" box, when
     the shown node's session is mid-turn. Torn down on every rail rebuild --
     the box it writes into dies with the innerHTML swap. */
  let railSaid = null
  const scheduleFrame = cb => requestAnimationFrame(cb)
  const cancelFrame = id => cancelAnimationFrame(id)
  function disposeRailSaid() {
    if (!railSaid) return
    railSaid.appender.dispose()
    railSaid = null
  }

  /* THE RAIL'S CHAT TAB — one mounted chat at a time, tracked so the delta
     stream and the turn completion know where to speak. Disposed before any
     controlsPage rebuild: the rule is never innerHTML='' OVER a mounted chat,
     and disposing first is how a rebuild honours it. */
  let railChat = null
  function disposeRailChat() {
    if (!railChat) return
    railChat.stream?.close()
    railChat.root?.dispose?.()
    railChat = null
  }

  /* ONE chat config for a tree node, serving the compact card AND the rail's
     Chat tab. The conversation shown is this window's transcript when it has
     one; else the durable pair the store kept (the ask and the last reply),
     so a chat over a node that has plainly spoken never opens empty.
     Renderer memory only; the store stays the record. */
  function treeChatConfigFor(node) {
    if (!node) return null
    /* A NODE WITH NO SESSION STILL HAS A CONVERSATION, and it used to open
     * nothing. See CHAT_NOT_RUNNING's note in src/fleet-tree-copy.js for the
     * owner report this closes: a refused start leaves the node `failed` with
     * a null session id, so on a build that cannot start the picked engine
     * EVERY node is one of these and both chat surfaces were dead.
     *
     * What opens is the real record and nothing invented: the brief the person
     * typed, the reply if one was ever kept, the actions that still apply, and
     * a disabled message box carrying the node's OWN refusal sentence. No
     * onSend, deliberately -- there is nothing to send to, and composerReason
     * makes buildChat refuse `send` before its seeded simulator can be
     * reached, so this chat cannot answer itself. */
    if (!node.sessionId) {
      const history = []
      if (node.message) history.push({ who: 'you', text: node.message, at: null })
      const kept = nodeReplies.get(node.id) || node.reply
      if (kept) history.push({ who: 'agent', text: kept, at: null })
      const reason = typeof node.statusNote === 'string' ? node.statusNote.trim() : ''
      return {
        title: treeNodeName(node),
        subtitle: CHAT_NOT_RUNNING.subtitle,
        roleKey: node.role,
        history,
        /* NEVER THE SIMULATOR, ON EITHER SURFACE. buildChat's `seed` defaults
           to 3, and its rule is `history.length ? [] : CHAT.slice(start, seed)`
           -- so a chat opened over an EMPTY history renders three canned
           bubbles from the demonstration fixture. The compact card pinned
           `seed: 0` in 5f394a4; the rail's Chat tab spreads this config and
           pinned nothing, so it fabricated a conversation for any node whose
           transcript was empty and then dropped it on the next rebuild. That
           is half of "messages in history disappear" (owner, 2026-08-18). It
           belongs on the config rather than on either mount, because a rule
           kept in two places is a rule that drifts again. */
        seed: 0,
        composerReason: reason ? CHAT_NOT_RUNNING.refused(reason) : CHAT_NOT_RUNNING.neverStarted,
        actions: () => chatActionRowsFor(node),
        actionsNote: PALETTE_PANEL.footer,
      }
    }
    let history = sessionTranscripts.get(node.sessionId) || []
    /* THE RECORD IS READ BACK, AND UNTIL NOW IT NEVER WAS.
     *
     * MEASURED ON A STAGED PACKAGED BUILD, 2026-08-18, three separate runs. A
     * node with two real Codex turns holds five lines in the durable store --
     * the brief, the tree context, "391", the second question, "81". Close the
     * app, open it again, press the circle: BOTH surfaces drew two bubbles, the
     * FIRST question above the SECOND answer. The conversation a person comes
     * back to was not the conversation they had, and it did not merely lose
     * lines -- it paired a question with an answer to a different question. On
     * a research machine that is a fabricated result, not a rendering glitch.
     *
     * THE CAUSE WAS ONE MAP. `sessionTranscripts` is window memory, keyed by
     * session id, and a new window has none. So `history` was empty for every
     * node on every restart and the `!history.length` fallback below fired --
     * that fallback composes `node.message` (the brief) with `node.reply` (the
     * LATEST reply), which is the pairing that was observed. The fallback is
     * right for what it was written for, a node whose conversation was never
     * recorded; it was standing in for a record that exists.
     *
     * IT IS THE SAME READ THE RESUME PATH ALREADY MAKES -- resumeNodeSession()
     * takes `transcriptStore.get(node.id).lines` and seeds the map with it, so
     * the store was already trusted for the harder job of feeding an agent its
     * own past. Reading it to SHOW a person that past is the smaller claim.
     *
     * THE MAP IS NOT SEEDED FROM HERE, deliberately. transcriptAppend() writes
     * whatever the map holds back to the store, so seeding it under a session id
     * this window never opened would put the read back on the write path, and
     * one appended line could then rewrite the record. Reading is reading. */
    if (!history.length) {
      const saved = transcriptStore ? transcriptStore.get(node.id) : null
      const savedLines = saved && Array.isArray(saved.lines) ? saved.lines : []
      if (savedLines.length) history = savedLines
    }
    if (!history.length) {
      history = []
      if (node.message) history.push({ who: 'you', text: node.message, at: null })
      const kept = nodeReplies.get(node.id) || node.reply
      if (kept) history.push({ who: 'agent', text: kept, at: null })
    }
    /* A RECORD THAT LOST LINES SAYS SO, in the conversation, where the gap is.
       A shortened excerpt shown as if it were the whole conversation is the
       kind of quiet loss this whole area is being cured of. */
    const savedRecord = transcriptStore ? transcriptStore.get(node.id) : null
    if (savedRecord && savedRecord.trimmed > 0 && history.length) {
      history = [{ who: 'note', text: TRANSCRIPT_TRIMMED_NOTE, at: null }, ...history]
    }
    return {
      title: treeNodeName(node),
      /* A SESSION ID IS NOT A LIVE SESSION. This header said "live session"
         over a node whose engine child was killed when the app last closed,
         which is the sentence a person believed while typing into it. */
      subtitle: nodeSessionLive(node) ? 'your agent · live session' : ENDED_SESSION.subtitle,
      roleKey: node.role,
      /* THE WORK, MERGED INTO THE WORDS. A chat opened halfway through a turn
         has to show the commands already run, or a person watching a five-
         minute turn sees an empty log and concludes the product is hung -- the
         exact reading the owner reported. */
      history: mergeActionsIntoHistory(history, node.sessionId),
      /* BOTH SURFACES REGISTER THEMSELVES THROUGH THE SHARED CONFIG. The rail's
         Chat tab and the compact card each spread this object, so neither can
         be the one that forgot to. */
      onReady: root => registerChatSurface(node.sessionId, root),
      /* See the note on the other return: seed 0 on the CONFIG, so neither
         surface can fall through to the demonstration excerpt. */
      seed: 0,
      onSend: (text, handlers) => treeCardSend(treeStore ? treeStore.getNode(node.id) || node : node, text, handlers),
      onAttach: async () => {
        const bridge = typeof window === 'undefined' ? null : window.mcAgent
        if (!bridge || typeof bridge.pickAttachment !== 'function') return null
        const picked = await bridge.pickAttachment({ sessionId: node.sessionId }).catch(() => null)
        if (picked && picked.path) {
          const held = sessionPendingImages.get(node.sessionId) || []
          held.push({ path: picked.path })
          sessionPendingImages.set(node.sessionId, held.slice(0, 8))
        }
        return picked
      },
      onMention: async () => {
        const bridge = typeof window === 'undefined' ? null : window.mcAgent
        if (!bridge || typeof bridge.pickMention !== 'function') return null
        return bridge.pickMention({ sessionId: node.sessionId }).catch(() => null)
      },
      /* The composer's four live powers (iteration 6): the busy feed for the
         send↔stop morph, the queue face over this session's outbox (the
         SESSION_OUTBOX_EVENT import finally has its subscriber), the popup's
         rows, and the stop verb. All closures — the component stays
         fleet-agnostic, and agent.js/comms.js pass none of these. */
      status: {
        busy: () => nodeBusy(treeStore ? treeStore.getNode(node.id) || node : node),
        subscribe: listener => registerNodeStatusListener(node.id, listener),
      },
      queue: {
        list: () => outboxList(node.sessionId).map(entry => ({ id: entry.id, text: entry.text })),
        /* The console vocabulary works here too: /interrupt typed while the
           agent is busy is EXACTLY when it matters, and this add is the one
           path a busy composer send takes — parsed before anything queues,
           same rule as treeCardSend's own first line. */
        add: text => {
          const slash = parseSlashCommand(text)
          if (slash) {
            if (slash.kind === 'help' || slash.kind === 'unknown') return { ok: false, sentence: slash.sentence }
            if (slash.kind === 'request') {
              /* A rule typed while the agent is BUSY is exactly when it
                 matters, and it must never queue as a message to the model.
                 This contract is synchronous, so the filing runs async and
                 the one-sentence answer lands on the page status line — the
                 same surface the other busy-path commands report through. */
              if (!slash.rest) return { ok: false, sentence: requestUsageSentence(slash.scope) }
              void fileStandingRequestFor(treeStore ? treeStore.getNode(node.id) || node : node, slash)
                .then(result => setOrgStatus(result.sentence, result.ok ? 'ok' : 'refuse'))
              return { ok: true }
            }
            if (slash.action === 'queue') {
              if (!slash.rest) return { ok: false, sentence: QUEUE_PANEL.emptyQueueCommand }
              return outboxEnqueue(node.sessionId, slash.rest)
            }
            const sink = { textContent: '' }
            void runPaletteAction(slash.action, treeStore ? treeStore.getNode(node.id) || node : node, sink)
            return { ok: true }
          }
          return outboxEnqueue(node.sessionId, text)
        },
        cancel: id => outboxCancel(node.sessionId, id),
        subscribe: listener => {
          const heard = event => { if (event?.detail?.sessionId === node.sessionId) listener() }
          window.addEventListener(SESSION_OUTBOX_EVENT, heard)
          return () => window.removeEventListener(SESSION_OUTBOX_EVENT, heard)
        },
      },
      actions: () => chatActionRowsFor(node),
      actionsNote: PALETTE_PANEL.footer,
      onStop: () => {
        const sink = { textContent: '' }
        return runPaletteAction('interrupt', treeStore ? treeStore.getNode(node.id) || node : node, sink)
          .then(() => sink.textContent || PALETTE_PANEL.interruptDone)
      },
    }
  }
  /* The chip repaints once per frame, never per token — the same batching the
     transcript appender measured its way to. One pending id is enough: one
     turn streams at a time, and a second node's event simply takes the slot. */
  let chipRefreshFrame = 0
  let chipRefreshNodeId = null
  function scheduleChipRefresh(nodeId) {
    chipRefreshNodeId = nodeId
    if (chipRefreshFrame) return
    chipRefreshFrame = requestAnimationFrame(() => {
      chipRefreshFrame = 0
      const id = chipRefreshNodeId
      chipRefreshNodeId = null
      if (!destroyed && graph && typeof graph.refreshChip === 'function') graph.refreshChip(id)
    })
  }
  /* Why the store might not exist at all: it needs an id for the computer, and a
     browser preview with no fleet has no computer to name. That is a real state
     and it must not be an exception on the way to first paint. The sentence goes
     to the panel, so a press still answers. */
  let treeStoreProblem = ''
  let composePanel = null
  /* Which rail page the person was reading when they pressed an empty node, so
     closing the panel puts back what they had rather than resetting the rail. */
  let railBeforeCompose = null

  /* WHY THE EXAMPLE BOARD DOES NOT GROW TREES, and it is the same fence dd01899
     put on this page's Dispatch control.
     `isWriteEnabled` is a question about PERMISSION; this is a question about
     PROVENANCE, and they are not the same question. In the packaged app the
     example fleet has a real agent bridge on `window`, so an empty node pressed
     on the demonstration board would start a real session on this computer from
     a page whose own banner says nothing on it is real. The slots are therefore
     GONE from that board rather than disabled — see mountGraph — and this
     sentence is the belt-and-braces answer if a press reaches here anyway. */
  const EXAMPLE_BOARD_TEXT = 'This is the example fleet, so nothing here can start a real agent. Turn the example off in Settings, under what the screens show, to build a tree on your own computer.'

  /* THE ONE OUTCOME NEITHER SHARED COPY MODULE HAS A SENTENCE FOR, because it is
     not a refusal: the agent started, and the drawing of it could not be saved.
     src/fleet-trees.js reports it as a flag on the snapshot rather than throwing,
     so a caller that never asks never learns — and the person would find their
     tree empty after a reload with a real session still running behind it. */
  const TREE_NOT_SAVED_TEXT = 'Your agent is running. This tree could not be saved on this computer, so it will be gone when you reload the page.'

  function releaseTreeStore() {
    treeStoreUnsub?.()
    treeStoreUnsub = null
    treeStoreLiveRelease?.()
    treeStoreLiveRelease = null
    treeStore = null
    transcriptStore = null
    treeStoreId = null
  }

  /* Open the store for the computer on screen, or make sure there is none.
     The example board keeps no trees at all: see the fence above. */
  function syncTreeStore() {
    if (!liveMode || !computer) {
      releaseTreeStore()
      return null
    }
    return openTreeStore(computer.id)
  }

  /* Open the saved trees for one computer.
   *
   * createFleetTreeStore THROWS for bad wiring on purpose — see its header: a
   * missing storage seam or an id that is not an id is a defect in the code, not
   * something a person did. Caught here all the same, because the alternative is
   * a fleet page that renders nothing at all on a machine whose id this view was
   * handed by a fleet record it did not write. A caught throw leaves the trees
   * unavailable and says so at the one moment it matters, which is a press. */
  function openTreeStore(computerId) {
    if (treeStore && treeStoreId === computerId) return treeStore
    releaseTreeStore()
    treeStoreProblem = ''
    if (!computerId) {
      treeStoreProblem = 'This page is not showing a computer yet, so there is nowhere to start an agent. Wait for your computers to load, then press again.'
      return null
    }
    try {
      treeStore = createFleetTreeStore({
        computerId,
        storage: safeTreeStorage(typeof window === 'undefined' ? null : window.localStorage),
      })
      treeStoreId = computerId
      treeStoreLiveRelease = markTreeStoreLive(computerId)
      /* Its own try: a transcript store that cannot open costs resume, not
         the trees. */
      try {
        transcriptStore = createTranscriptStore({
          computerId,
          storage: safeTreeStorage(typeof window === 'undefined' ? null : window.localStorage),
          /* A SAVE THAT LOSES ANYTHING SAYS SO. The store used to delete a
             whole node's conversation to fit another node's save and return
             true; it now gives up the oldest LINES instead, but "quieter" is
             not "silent" -- on a research machine a lost transcript is lost
             work, and a person is owed the sentence at the moment it happens.
             The record itself also carries the count, so the chat that opens
             it repeats the admission where the gap is. */
          onLoss: () => setOrgStatus(TRANSCRIPT_TRIMMED_NOTE, 'warn'),
        })
      } catch { transcriptStore = null }
      /* THE REPLIES COME BACK; THE SESSIONS DO NOT.
         A saved reply is a fact about a node and is worth re-reading. A saved
         session id is a fact about a PROCESS, and re-registering one here is
         how a session killed at the last shutdown came back as live -- see the
         note on RUN_SESSION_NODES. Sessions this run owns are already in that
         map and need nothing from storage; sessions it does not own are gone,
         and saying so is the point. */
      for (const node of treeStore.snapshot().nodes) {
        if (node.reply) nodeReplies.set(node.id, node.reply)
      }
    } catch {
      treeStore = null
      treeStoreId = null
      treeStoreProblem = 'The trees saved for this computer could not be opened, so nothing can be started here. Reload this page, and if it still refuses, restart ToolsEnabled.'
    }
    return treeStore
  }

  /* A NAME FOR A NODE THAT NOBODY NAMED.
     A person types a role and a job, never a name, so the first line of the job
     is what the circle is called — it is the one string on the record that tells
     two agents apart at a glance. A message that is all whitespace or missing
     falls back to the role's own label rather than to an id. */
  /* A NODE'S NAME IS AN IDENTITY, NOT ITS HOMEWORK. This used to return the
     start brief's first line, so the Details head shouted "Reply with exactly
     the word OMEGA…" as if it were somebody's name (owner walkthrough,
     iteration 5). The name is now the role plus a per-tree ordinal when
     siblings share the role — "Coordinator", "Worker 2" — mirroring the
     ordinal shape treeLabel() already uses for trees. The brief keeps its own
     box and its own helper below; the two never trade places again. */
  function treeNodeName(node) {
    const role = roleLabel(node.role)
    if (!treeStore) return role
    const peers = treeStore.snapshot().nodes.filter(peer => peer.treeId === node.treeId && peer.role === node.role)
    if (peers.length <= 1) return role
    const index = peers.findIndex(peer => peer.id === node.id)
    return index === -1 ? role : `${role} ${index + 1}`
  }

  /* The brief's first line, for the small row under the name and nowhere
     larger. Kept short the way the old name was, because it is a caption. */
  function treeNodeBrief(node) {
    const firstLine = String(node.message || '').split('\n').map(line => line.trim()).find(Boolean) || ''
    return firstLine.length > 60 ? `${firstLine.slice(0, 59).trimEnd()}…` : firstLine
  }

  /* WHAT A TREE NODE LOOKS LIKE TO THE GRAPH.
   *
   * src/tree-graph.js draws agents, and this is a tree node wearing exactly the
   * shape it draws — id, name, role key, parent — with two fields that decide
   * how honest the circle is:
   *
   * `bornAt` IS SET ONLY WHILE A SESSION IS REALLY OPEN. The graph binds a live
   * clock to any node that has one, so a draft or a failed start with a bornAt
   * would tick away on the canvas exactly like a working agent. That is the one
   * outcome this whole lane exists to prevent, so the field is derived from the
   * session and never from the fact that a row exists.
   *
   * `state` DECIDES THE WORD IN THE CIRCLE WHERE THE CLOCK WOULD BE, and the
   * graph's vocabulary for it is the fleet's: 'disabled' means switched off in
   * the fleet record, 'enabled' means declared and live, and anything else
   * renders as "no signal". A draft is none of the first two — calling it
   * disabled would tell a person their brand new agent had been switched off,
   * which is a different and wrong story — so it is deliberately outside that
   * vocabulary and lands on the neutral word, which is also the true one:
   * nothing is coming from it, because nothing is running.
   */
  function treeAgentRecord(node) {
    /* nodeBusy, not the saved status: 'enabled' is the graph's word for a live
       agent, and painting it over a session that ended at the last shutdown is
       how a dead node kept its blue circle. */
    const running = nodeBusy(node)
    /* A node that HELD a session keeps its clock. Measured 2026-08-13: bornAt
       was granted only while running, and stoppedAt was hardcoded null -- so
       the moment a real turn completed, the agent that had just run, replied
       and finished rendered "no signal / no runtime", indistinguishable from
       one that never existed. A session-bearing node now always carries its
       start time, and a terminal one carries its stop time (updatedAt is
       written on the same beat as the terminal status), so the circle shows
       the run's real duration instead of denying the run happened. */
    /* AND THE CLOCK STOPS WHEN THE SESSION DOES, however it ended. A terminal
       status alone left one gap and a person fell straight into it: a node
       saved mid-turn loads back as 'starting', which is neither finished nor
       failed, so it was granted a start time and no stop time -- a clock
       ticking on the canvas over a process killed when the app last closed
       (measured 2026-08-16, 0:00:33 climbing to 0:04:12 on a reopened
       profile). treeNodeClock owns that rule now. */
    const clock = treeNodeClock(node, sessionNodeIds)
    const terminal = clock.terminal
    return {
      id: node.id,
      name: treeNodeName(node),
      role: node.role || 'default',
      declaredRole: node.role || 'default',
      parentId: node.parentId || null,
      /* The graph's state vocabulary is its own (enabled/disabled/finished/
         failed); 'turn-failed' translates to its 'failed' colour here, while
         the chip word — the words a person reads — comes from
         treeNodeStatusWord via the context feed and stays distinct. */
      state: running ? 'enabled' : terminal ? (node.status === 'turn-failed' ? 'failed' : node.status === 'interrupted' ? 'finished' : node.status) : clock.endedWithApp ? ENDED_SESSION.word : 'not started',
      bornAt: clock.bornAt,
      stoppedAt: clock.stoppedAt,
      tasksDone: null,
      failRate: null,
      provider: null,
      model: null,
      context: [],
      /* null ON PURPOSE, and the single line behind owner defect 1a. This used
         to be `node.parentId ? 2 : 0`, and depthFor short-circuits on an
         explicit tierRank -- so child, grandchild and great-grandchild all
         shared rank 2, every root shared rank 0, a four-level tree drew as two
         rows, and a same-row parent/child turned its connector into a straight
         diagonal. With null, the layout walks parentId chains and gives the
         tree its true depth. Drill-in always looked right because
         _layoutAgents strips tierRank when drilled -- that was the tell. The
         FLEET projection's tierRank (a different data model, computers.js
         fleet records) is legitimate and untouched. */
      tierRank: null,
      cullable: Boolean(node.parentId),
      cullRank: 0,
      /* The graph puts this in the circle's tooltip when there is no clock. It
         is the node's own status note — the refusal sentence, for a start that
         did not happen — so hovering a stalled circle answers the question the
         canvas raised. */
      projectionUnavailableReason: node.statusNote || 'this agent has not been started yet',
      /* The record the chip and the rail read back. Carried rather than looked
         up so that the two can never disagree about which node they describe. */
      treeNode: node,
    }
  }

  const treeAgents = () => (treeStore ? treeStore.snapshot().nodes.map(treeAgentRecord) : [])

  /* The computer handed to the graph: the fleet's own agents plus the ones this
     person started. A COPY is only made when there is something to add, because
     the simulated page relies on object identity — src/tree-graph.js subscribes
     to sim events and compares `comp === this.computer` — and a copy handed over
     for nothing would silently stop the example fleet animating. */
  function graphComputer() {
    /* The example board is left byte-for-byte as it was — see EXAMPLE_BOARD_TEXT
       above for the fence, and note that this is the same object identity check
       the sim relies on. */
    if (!liveMode) return computer
    const grown = treeAgents()
    if (grown.length === 0) return computer
    return { ...computer, agents: [...(computer.agents || []), ...grown] }
  }

  /* THE CHIP BESIDE A NODE THIS PERSON STARTED.
     The fleet's own feed describes a fleet record and has nothing true to say
     about a node this page created a second ago, so a tree node answers for
     itself: what it is doing now, and — when it did not start — why not. The
     status word comes first because the chip clips at about 322px, and the
     sentence in full is in the panel and on the tooltip. */
  /* One vocabulary for what a node is doing, read by the chip on the canvas and
     by the rail behind it. Two sets of words for one field is how a screen ends
     up saying "running" in one place and "starting" in another about the same
     circle. */
  function treeNodeStatusWord(node) {
    /* A SAVED 'running' IS NOT A RUNNING AGENT — nodeSessionEnded first, so a
       record orphaned by shutdown says so. The words themselves live in
       NODE_STATUS_WORDS (src/fleet-tree-copy.js), one entry per status the
       store accepts, because an if-chain here is where a failed TURN came to
       read "did not start": the store gained a status the chain had no word
       for, and the fallthrough lied. A shared table cannot fall through — the
       suite checks every NODE_STATUSES entry has its word. */
    if (nodeSessionEnded(node)) return ENDED_SESSION.word
    return NODE_STATUS_WORDS[node.status] || NODE_STATUS_WORDS.draft
  }

  function treeContextFeed(agent) {
    const node = agent.treeNode
    if (!node) return liveMode ? projectionMonitorContext(agent) : monitorContextFor(agent)
    /* THE CONTEXT WINDOW, not a telemetry card. The owner's words for the old
       shape: "I dont see anything just nonsense" — and he was right by
       construction: chat was hardcoded null, statusNote is cleared on success,
       so every successful run printed "nothing has run for this agent yet"
       under "telemetry unavailable". A tree node KNOWS its context: what was
       asked (message), what it is doing right now (nodeActivity), what it is
       saying as it says it (sessionTurnText tail), and what it said
       (node.reply, persisted). That is what the chip shows. The unavailable
       sentence remains only as the last resort for a node with no message and
       no session — a shape addNode cannot produce. */
    const running = nodeBusy(node)
    const streaming = node.sessionId ? sessionTurnText.get(node.sessionId) : null
    const reply = nodeReplies.get(node.id) || node.reply || null
    const asked = String(node.message || '').split('\n').map(line => line.trim()).find(Boolean) || null
    return {
      current: (running && nodeActivity.get(node.id)) || treeNodeStatusWord(node),
      previous: node.statusNote || (asked ? `asked: ${asked}` : null),
      chat: streaming ? streaming.slice(-160) : (reply ? reply.slice(0, 160) : null),
      unavailable: 'nothing has run for this agent yet',
      tasks: null,
      failRate: null,
      model: null,
    }
  }

  /* Redraw from the model as it now stands. refresh() is the graph's own word
     for it and it keeps the zoom, the pan and the drilled-in root — every one of
     which the person set deliberately, and none of which a new agent is a reason
     to discard. The computer object is replaced first because the graph reads
     its agent list on every reconcile. */
  function refreshTree() {
    if (!graph) return
    graph.computer = graphComputer()
    graph.refresh()
    /* Every status mutation flows through here; the chat composers listening
       for their node's busy state hear it here and only here. */
    notifyNodeStatusListeners()
    refreshTreeSwitch()
  }

  /* The second view-only pane stood here until 2026-08-16. Owner: "lets throw
     it away for now". The packaging lane's branch predates that directive, so
     its copy of the pane's enable and disable helpers arrived in this merge
     and is dropped here deliberately; notifyNodeStatusListeners() above is
     theirs and stays, because the chat composers depend on it. */

  /* THE TREE SWITCHER (owner defect 5: "buttons to navigate between them").
     One button per tree, named by treeLabel — the first words the person typed
     into it — plus Every tree to zoom back out. Rendered only when there are
     two or more trees: a switcher over one tree is chrome with no decision in
     it. Rebuilt from listTrees() on every store change, so a tree created,
     detached or emptied updates the row without anyone remembering to. */
  /* Filing a whole scope under a research project: the selected tree files
     each of its sessions; "Every tree" writes the live assign-all rule that
     also covers sessions started later. One shared control (the same factory
     the rail and the research page use), mounted once the projects are read. */
  /* IT LIVES ON THE RAIL NOW, NOT IN THE TOOL STRIP. Mounted into
     `.graph-tools`, this control put "No research projects exist yet. Create one
     on the research page first." between Edit and the zoom buttons -- a sentence
     about a different page, in the row of controls for this one, and the owner's
     first complaint about the bar. Filing is a setting about the whole fleet, so
     it sits beside Session profiles and Roles, which are the other two.

     NOT MOUNTED UNTIL THE SERVICE HAS ANSWERED. `researchService` is null while
     the read is in flight, and an empty project list means "there are none" --
     mounting early would print that sentence about a service nobody has asked
     yet. The slot holds a waiting line until then and this replaces it. */
  function mountResearchScopeControl() {
    const slot = root.querySelector('[data-research-scope-slot]')
    if (!slot || slot.querySelector('[data-assign-control]') || !liveMode || !researchService) return
    slot.innerHTML = ''
    slot.appendChild(createAssignmentControl({
      projects: researchService?.ok ? researchService.projects : [],
      unavailableReason: researchService && !researchService.ok ? researchService.reason : null,
      label: 'File this scope under',
      onAssign: async projectId => {
        const currentTreeId = graph?.rootId ? treeStore?.getNode(graph.rootId)?.treeId ?? null : null
        if (currentTreeId === null) {
          const result = await researchAssignments.assign(projectId, 'all')
          if (result.ok && !result.sentence) result.sentence = 'Every session on this computer is filed there, including ones started later.'
          return result
        }
        const sessions = (treeStore?.listNodes(currentTreeId) || []).filter(node => node.sessionId)
        if (sessions.length === 0) {
          return { ok: false, sentence: 'This tree has no attached sessions to file yet.' }
        }
        let filed = 0
        let pending = false
        for (const node of sessions) {
          const result = await researchAssignments.assign(projectId, 'observed', node.sessionId)
          if (result.ok) { filed += 1; pending = pending || result.pending === true }
        }
        return {
          ok: true,
          sentence: `${filed} session${filed === 1 ? '' : 's'} filed.${pending ? ' The research service has not heard some of them yet.' : ''}`,
        }
      },
    }))
  }

  if (liveMode) {
    readResearchSnapshot().then(result => {
      if (destroyed) return
      researchService = result
      if (result.ok) {
        researchAssignments.adoptServiceRows(result.assignments)
        researchAssignments.flushPending()
      }
      mountResearchScopeControl()
    })
  }

  function refreshTreeSwitch() {
  /* A per-pane tree switcher arrived here in the packaging lane's merge; its
     only caller was the second pane. That pane went out on the owner's
     2026-08-16 direction, so its switcher goes with it rather than sitting
     unreferenced. rail-chrome.test.mjs scans this file for the pane's own
     identifiers, which is why none of them are named here.

     THE SECOND TREE KILLED THE WHOLE PAGE. Measured on the owner's own installed
     build, 2026-08-17, with real mouse input: the pane removal deleted this
     function's `const slot = ...` declaration and left `slot.prepend(host)`
     behind. refreshTreeSwitch() runs at mount, so on any computer holding TWO
     OR MORE trees the ReferenceError aborted the entire computers view before
     it drew anything -- no tree, no nodes, no chips, no empty slot, no zoom
     controls. The page reported "the fleet record could not be fetched: slot is
     not defined" and nothing on it could be pressed, which is why BOTH "agents
     do not launch" and "the chat bubbles do not open" were the same defect.
     The `trees.length < 2` guard below is why it hid: it is invisible until the
     person owns a second tree, and pressing the empty slot beside an existing
     top-level agent silently creates one. The owner's saved state records his
     second tree appearing at 16:12:38Z; his app was dead from that minute.

     Both lookups were also aimed at the wrong element. `.graph-bar-trees` and
     `.graph-tools` are SIBLING slots inside `.graph-bar` (see the markup around
     :737), and board.css:870 styles the switcher as
     `.graph-bar-trees .graph-tree-switch` -- so reading and writing it through
     `.graph-tools` would have produced an unstyled switcher in the wrong place
     even once the crash was gone. */
  const slot = root.querySelector('.graph-bar-trees')
  if (!slot) return
  let host = slot.querySelector('.graph-tree-switch')

    const trees = treeStore ? treeStore.listTrees() : []
    if (trees.length < 2) {
      host?.remove()
      return
    }
    if (!host) {
      host = document.createElement('div')
      host.className = 'seg graph-tree-switch'
      host.setAttribute('role', 'group')
      host.setAttribute('aria-label', 'Trees on this computer')
      slot.prepend(host)
    }
    host.innerHTML = ''
    const current = graph?.rootId ? treeStore.getNode(graph.rootId)?.treeId ?? null : null
    const all = document.createElement('button')
    all.type = 'button'
    all.textContent = 'Every tree'
    all.classList.toggle('on', current === null)
    all.addEventListener('click', () => { graph?.clearRoot() ; refreshTreeSwitch() })
    host.appendChild(all)
    for (const tree of trees) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = treeStore.treeLabel(tree.id)
      button.classList.toggle('on', current === tree.id)
      button.addEventListener('click', () => {
        const treeRoot = treeStore.rootOf(tree.id)
        if (treeRoot) graph?.setRoot(treeRoot.id)
        refreshTreeSwitch()
      })
      host.appendChild(button)
    }
  }

  /* ---------- the press, the panel, and the start ---------- */

  function closeComposePanel() {
    composePanel?.destroy()
    composePanel = null
    composePage.innerHTML = ''
    if (railBeforeCompose) activateRail(railBeforeCompose)
    railBeforeCompose = null
  }

  /* WHICH PARENT THE NEW AGENT REALLY HANGS UNDER.
   *
   * A child slot can be pressed under two very different circles: one this
   * person started, which the tree store knows, and one that came from the
   * fleet record or the declared organisation, which it does not. The store can
   * only hang a node under its own, so a press under a fleet agent begins a NEW
   * tree — and `null` is how the panel is told that, which makes it say so in
   * its own words before anything is typed. Handing over the pressed agent's id
   * would produce a panel promising a place in the tree that the store would
   * then refuse, after the person had written their brief. */
  function composeParentFor(detail) {
    if (!treeStore || !detail || detail.kind !== 'child') return null
    const node = treeStore.getNode(detail.parentId)
    if (!node) return null
    return { id: node.id, name: treeNodeName(node) }
  }

  /* The three facts this owes a person, in the order they need them: what is
     off, that turning it on starts nothing by itself, and where the switch is.
     The first sentence is shared with the agent page's switched-off surface,
     which is the other place this same flag is explained. */
  /* SHORT ON PURPOSE, AND THE COMMENT IS SHORT FOR A REASON TOO: the gate that
     guards this sentence (start-control-flag-gates-the-tree.test.mjs) reads a
     700-character window from this function, so a long note here pushes the
     code out of its own test. The rest of the reasoning is in the commit.

     Four sentences became three (owner, on this panel: "messy"). What went was
     the JOURNEY -- "Settings -> Write -> Run an agent session" -- spelled out in
     prose directly above a button that does it in one press. Settings is still
     named, because a refusal that names nowhere to change a thing is a dead end
     and that gate is right. */
  function startControlOffReason() {
    return `${startControlOffBecause()} Turning it on starts nothing by itself, it just puts the Start control back. You can change this later in Settings.`
  }

  /* THE ONE-PRESS WAY OUT, offered only for the one reason a press can undo.
   *
   * Owner's rule, and it is the reason this is a control and not a default:
   * his recorded answer stays off until HE presses. So nothing here writes
   * anything -- composeUnavailableAction only DESCRIBES a press, and the write
   * happens inside `run`, which is the click handler and nowhere else.
   *
   * It answers null for every other absence. A browser with no application
   * behind it and a saved forest that would not open are both real reasons the
   * panel is switched off, and neither is a thing this button could change; a
   * control that cannot work is worse than the sentence alone.
   *
   * THE SAME WRITE THE SETTINGS CONTROL MAKES, not a second one:
   * setWriteEnabled is the single writer of these rows (src/write-flags.js),
   * which is what makes the two surfaces incapable of disagreeing. */
  function composeUnavailableAction(detail) {
    if (!liveMode || treeStoreProblem) return null
    if (isWriteEnabled(START_CONTROL_FLAG)) return null
    return {
      label: START_CONTROL_ON.label,
      run: () => {
        /* RECORDED BEFORE THE WRITE, because the write is what destroys this
           view. See composeToRestore: the announcement is synchronous, the
           re-render is a microtask behind it, and by the time this function
           returns there may be no panel left to answer. */
        composeToRestore = detail || null
        setWriteEnabled(START_CONTROL_FLAG, true)
        /* READ BACK, never assumed. The flag store can refuse -- a browser with
           storage switched off keeps the old answer -- and reporting a switch
           that did not move would reopen the panel with a live Start control
           over a computer that still refuses every start. */
        if (!isWriteEnabled(START_CONTROL_FLAG)) { composeToRestore = null; return false }
        /* AND THE WHOLE QUESTION IS ASKED AGAIN, not just this half of it.
           composeUnavailableReason() checks the flag BEFORE the bridge, so a
           page open in a browser was showing the flag's sentence over a second,
           equally real absence. Handing that one back means the panel says what
           is true after the press instead of what was true before it. */
        return composeUnavailableReason() || true
      },
    }
  }

  /* WHY THE PANEL IS NEVER WITHHELD.
     A press is a question, and every press gets an answer in the place the
     person is looking. When there is no installed application behind this page,
     or the saved trees could not be opened, the panel opens with its fields
     switched off and the reason printed in it — src/agent-compose-panel.js keeps
     Cancel alive for exactly this. Silently ignoring the press would leave a
     person pressing a circle that does nothing, which is the state this whole
     feature was built to end. */
  function composeUnavailableReason() {
    if (!liveMode) return EXAMPLE_BOARD_TEXT
    if (treeStoreProblem) return treeStoreProblem
    /* THE SWITCH THAT DECIDES WHETHER THIS PRODUCT MAY START AN AGENT, asked
       on the surface that actually starts them.
     *
     * Setup's own words for the cautious answer are "nothing here will start an
     * agent", and it turns this flag off to make that true. It was true of the
     * agent page, which asks -- and only of the agent page. THIS page never
     * asked: the dashed circle opened its panel, "Start this agent" went all
     * the way to the engine, and what came back was an ENGINE refusal about
     * Codex, on a computer whose owner had been promised nothing here would
     * start anything. Measured on the packaged build 2026-08-16 on a fresh
     * profile that answered "Nothing yet -- let me look around first".
     *
     * A promise the product makes in setup is checked where the promise can be
     * broken. The panel still opens and still says why -- see the note above on
     * why the panel is never withheld -- and the sentence names the switch, so
     * a person who wants it can find it. */
    if (!isWriteEnabled(START_CONTROL_FLAG)) return startControlOffReason()
    const bridge = typeof window === 'undefined' ? null : window.mcAgent
    if (!bridge || typeof bridge.start !== 'function') return START_NEEDS_APP_TEXT
    /* THE LIMITS ARE NOT RE-ASKED HERE. src/fleet-trees.js refuses a tree past
       its own cap in its own words, and those words come back from addNode on
       submit. Asking the same question early would put a second wording of one
       rule on the screen, and the two would drift the first time only one was
       edited. */
    return ''
  }

  /* ASK THE SHELL WHICH ENGINES START, ONCE PER MOUNT.
   *
   * The renderer used to answer this itself, from a frozen ['codex'] in
   * src/fleet-tree-copy.js. The shell's tier gate now opens on the payload
   * genuinely carrying an engine -- a require() that must export a start
   * function -- so a build WITH the Claude engine would start a Claude tier
   * while the menu went on saying it could not. A menu that contradicts the
   * button is worse than either answer alone.
   *
   * Read once at mount rather than per press: the answer is a property of the
   * installed payload, which cannot change while this page is open, and a round
   * trip on every press of an empty node would be paid for nothing. Every
   * failure -- no bridge, no channel, a rejected call, an unparseable reply --
   * leaves the pessimistic default in place, because none of them learned
   * anything about what this copy can start.
   */
  /* THE FOLDER A TREE STARTS IN, ASKED WHERE THE PERSON STARTS THE TREE.
   *
   * Owner, 2026-08-16: "when a user starts a tree they should select a folder,
   * they can have a default folder, where the agents spawn"; and again on
   * 2026-08-19, having gone looking for it: "what happened to sessions and
   * choosing a folder for each tree and such?"
   *
   * NOTHING NEW IS BUILT HERE. The named folders already exist in the main
   * process (mcAgent.profiles(), created through the OS dialog by the fleet
   * rail's own panel), a tree already carries one (`setTreeProfile`), and every
   * start already sends it (`profileId`, below). The only thing missing was the
   * QUESTION at the moment a tree is created. This reads the same list once per
   * mount, for the same reason readStartableTiers() does: it is a property of
   * this computer, not of the press.
   *
   * A REFUSAL IS AN EMPTY LIST, NEVER A THROWN ERROR. With no bridge, or a
   * bridge that will not answer, the panel draws its "no folders set up yet"
   * sentence and a start still works -- in the product's own workspace, exactly
   * as it did before folders existed. */
  let composeFolders = []
  async function readComposeFolders() {
    const bridge = typeof window === 'undefined' ? null : window.mcAgent
    if (!bridge || typeof bridge.profiles !== 'function') return
    let answer = null
    try { answer = await bridge.profiles() } catch { answer = null }
    if (destroyed) return
    composeFolders = answer && answer.ok && Array.isArray(answer.profiles)
      ? answer.profiles.map(profile => ({ id: profile.id, name: profile.name }))
      : []
    if (composePanel?.isOpen?.()) composePanel.open({ folders: composeFolders })
  }

  /* Remembered posture, not a setting -- the same rule src/settings-presentation.js
     states for its own open-groups memory: it "grants nothing, gates nothing, and
     the settings footer does not count it". This decides which row a menu OPENS
     on; the person overrides it in the same gesture, and a folder they have since
     removed simply stops matching a row. */
  const LAST_FOLDER_KEY = 'mc.compose.last-folder'
  const lastComposeFolder = () => {
    try { return localStorage.getItem(LAST_FOLDER_KEY) || null } catch { return null }
  }
  const rememberComposeFolder = profileId => {
    try {
      if (profileId) localStorage.setItem(LAST_FOLDER_KEY, profileId)
      else localStorage.removeItem(LAST_FOLDER_KEY)
    } catch { /* session-only is still a real change */ }
  }

  async function readStartableTiers() {
    const bridge = typeof window === 'undefined' ? null : window.mcAgent
    if (!bridge || typeof bridge.startableTiers !== 'function') return
    let reply
    try { reply = await bridge.startableTiers() } catch { reply = null }
    if (destroyed) return
    startableTierIdList = startableTierIds(reply)
    startableTierChoices = tierChoicesFor(startableTierIdList)
    /* A panel already on screen is re-opened over the same node so its menu
       carries the answer, rather than leaving the person reading rows that were
       drawn before the shell replied. */
    if (composePanel?.isOpen?.()) composePanel.open({ tiers: startableTierChoices })
  }

  function openComposeFor(detail) {
    if (destroyed || !computer) return
    syncTreeStore()
    const parent = composeParentFor(detail)
    const unavailable = composeUnavailableReason()

    if (!composePanel) {
      railBeforeCompose = controlsPage.classList.contains('is-active') ? controlsPage : statsPage
    }
    composePanel?.destroy()
    composePage.innerHTML = ''
    composePanel = mountAgentComposePanel({
      container: composePage,
      parent,
      /* NEITHER THE ROLE LIST NOR THE BUTTON'S WORDS ARE PASSED, on purpose. The
         panel's own default is ROLE_CHOICES from src/fleet-tree-copy.js — the
         same list this view would have handed it — and its label is that
         module's too. Passing either from here would be a second place to change
         when the words change, and its refusals name the button by its real
         name. */
      unavailableReason: unavailable,
      /* AND THE WAY OUT OF IT, when this page owns one. See
         composeUnavailableAction(): it is offered for the switched-off flag and
         for nothing else, and it writes only when pressed. */
      unavailableAction: composeUnavailableAction(detail),
      /* WHICH ENGINES THIS COPY CAN REALLY START, asked of the shell rather
         than assumed by the renderer. See startableTiersNow() below. */
      tiers: startableTierChoices,
      /* THE FOLDERS, FROM THE ONE STORE THAT HOLDS THEM. Same list the fleet
         rail's profile panel reads and the tree rail's "Works in" menu is
         built from -- read once at mount by readComposeFolders(), never a
         second register of folders kept beside the first. */
      folders: composeFolders,
      folderSelectedId: lastComposeFolder(),
      onSubmit: draft => submitCompose(draft, detail),
      onCancel: () => closeComposePanel(),
    })
    if (!composePanel) return
    activateRail(composePage)
    /* Focus lands INSIDE the panel either way, or the panel's root-level
       Escape handler is deaf: measured on the packaged build 2026-08-20
       (order-drive), a mouse-opened panel kept focus on the page behind it and
       Escape -- the panel's own documented cancel -- did nothing until a field
       was clicked. A key press still puts the caret in the first field, where
       that person is going next; a pointer press focuses the panel's ROOT
       instead, so no caret jumps into a field out from under the mouse (the
       harm the old keyboard-only condition guarded against). */
    if (detail?.via === 'keyboard') composePanel.focus()
    else composePanel.focusRoot()
  }

  /* ONE SUBMIT, FOUR OUTCOMES, AND THE MODEL TELLS THE TRUTH IN ALL OF THEM.
   *
   *   the draft is refused      nothing is created; the panel says why
   *   the start is refused      the node stays, marked as failed, with the
   *                             reason on it. It is NOT deleted: a person who
   *                             just described a job should not have to type it
   *                             again to find out what went wrong.
   *   the send is refused       a session IS open. It is attached first, so the
   *                             node points at the real thing, and only then
   *                             marked failed with a sentence that says the
   *                             agent is running and the message is not.
   *   everything worked         the session is attached, the node is running,
   *                             and the panel closes itself.
   *
   * IT RETURNS THE PANEL'S OWN REFUSAL SHAPE rather than throwing. A thrown
   * error would be replaced by the panel's fixed sentence — correctly, since an
   * Error's words are written for whoever holds the repository — and the person
   * would lose the specific reason their start did not happen.
   */
  async function submitCompose(draft, detail) {
    const store = treeStore
    if (!store) return { ok: false, message: treeStoreProblem || START_NEEDS_APP_TEXT }
    /* ASKED AGAIN HERE, AND THIS IS THE ONE THAT COUNTS. The panel's disabled
       fields are what a person sees; this is what actually stops a start. The
       flag can be turned off in Settings while this panel stands open, and a
       gate that only paints is not a gate. Nothing is created and nothing is
       sent: the refusal comes before addNode, so a switched-off computer does
       not accumulate half-started agents. */
    if (!isWriteEnabled(START_CONTROL_FLAG)) return { ok: false, message: startControlOffReason() }

    const parent = composeParentFor(detail)
    const added = store.addNode({
      parentId: parent ? parent.id : null,
      role: draft.role,
      message: draft.message,
      /* Recorded so "start this conversation over" can honestly reuse the
         tier the person chose, however much later the restart happens. */
      tier: draft.tier || '',
    })
    /* The store's own sentence, verbatim. It knows what it refused and why —
       a message too long, a branch too deep, a computer already holding as many
       trees as it keeps — and rewording any of that here would be this file
       having a second opinion about a rule it does not own. */
    if (!added.ok) return { ok: false, message: added.problems[0] || START_REFUSAL.noReasonGiven }

    const node = added.node
    /* THE FOLDER THE PERSON CHOSE BECOMES THE TREE'S FOLDER, and it has to
       happen HERE -- between the node existing (so there is a treeId) and the
       start reading `treeProfile(node.treeId)` a few lines below.
       ONLY WHEN A TREE WAS JUST CREATED. `parent` null is what made addNode
       mint a tree; a start UNDER an existing agent joins a tree that already
       has a folder, and writing this there would let one nested start re-point
       every agent in that tree. The compose panel draws no folder menu in that
       case, so draft.profileId is null anyway -- this condition is the second
       lock on the same door, on the side that owns the store. */
    if (!parent && draft.profileId) {
      store.setTreeProfile(node.treeId, draft.profileId)
    }
    if (!parent) rememberComposeFolder(draft.profileId || null)
    /* The draft is on the canvas BEFORE the bridge is called. A start takes
       seconds, and a person who pressed a circle and sees nothing appear will
       press it again — which is how two agents get started for one job. */
    refreshTree()
    /* The one line on this page that survives the panel closing, in the same
       place and the same three states the drag already reports in: busy while it
       is in flight, green when it ran, and a refusal that STAYS until the next
       attempt. A start crosses a background service and another program, so the
       wait is real and a canvas that said nothing during it is where somebody
       presses a second circle for the same job. */
    setOrgStatus(startingLine(draft.role), 'busy', { sticky: true })

    /* THE NODE IS BOUND TO ITS SESSION BEFORE ITS MESSAGE IS SENT, and every
       line of this block used to sit after the send. See the note on
       startAgentForNode's `onSessionOpen`: a turn whose first words arrive
       before the send is answered found no binding here and was dropped whole,
       so the node stayed at `running` for as long as anyone waited. Nothing
       here is optimistic -- the session is open and named by the time this
       runs; only the message is still on its way. */
    let attachProblem = null
    /* WHERE THIS AGENT STANDS IN THE TREE, SENT WITH THE JOB.
     *
     * Owner, 2026-08-18: "This one is not realizing and not able to contact its
     * manager." The tree drew Default under Manager and the session was told
     * neither fact, so the agent asked the person for "the manager's
     * identifier". The names here are treeNodeName's, which is to say the words
     * on the circles -- an agent that answers "Manager: ..." is naming what the
     * person can see, never an internal id. */
    const briefContext = briefContextFor(node, parent)
    const startText = composeNodeBrief({ message: draft.message, ...briefContext })
    const result = await startAgentForNode({
      text: startText,
      surface: 'fleet-tree',
      tier: draft.tier,
      effort: draft.effort,
      /* The tree's assigned session profile rides with every start in it --
         per-tree onboarding, which is the whole point of profiles. Null means
         the product's own workspace, exactly as before profiles existed. */
      profileId: treeStore && node.treeId ? treeStore.treeProfile(node.treeId) : null,
      requestKeys: nodeRequestKeys(node),
      onSessionOpen: ({ sessionId, threadId }) => {
        sessionNodeIds.set(sessionId, node.id)
        sessionEfforts.set(sessionId, draft.effort || tierEffortOf(draft.tier))
        if (threadId) sessionThreadIds.set(sessionId, threadId)
        /* THE FIRST THING SAID IS RECORDED LIKE EVERY OTHER THING SAID, and
         * until now it was the one turn that was not.
         *
         * Owner, 2026-08-18: "Sometimes the messages in history disappear."
         * transcriptAppend was called from three places -- a typed message, a
         * drained queued message, and a completed turn -- and the compose
         * panel's brief was none of them. It survived on screen only through
         * treeChatConfigFor's `!history.length` fallback, and the FIRST reply
         * ended that: one appended agent line made the transcript non-empty,
         * the fallback stopped firing, and the person's own opening question
         * vanished from the conversation for good. The durable excerpt was
         * written from the same lines, so a resumed agent was handed a
         * conversation with no brief in it either.
         *
         * TWO ENTRIES, NOT ONE. The person's words stand alone in the first,
         * exactly as typed. What the product added about the tree is the
         * second, visible and separate -- this page does not send an agent
         * something it will not show. `who: 'you'` for both, which is the same
         * slot the resume marker already uses: it is the side of the
         * conversation these words were sent from, not a claim about who typed
         * them. Ordered before any reply can arrive, because this runs before
         * the send. */
        if (draft.message) transcriptAppend(sessionId, { who: 'you', text: draft.message, at: Date.now() })
        transcriptAppend(sessionId, { who: 'you', text: nodeManagerContext(briefContext), at: Date.now() })
        /* First running session of the window: ask the engine what it offers,
           so every depth menu after this is the provider's list rather than
           ours. */
        readEngineCatalog(sessionId)
        const attached = store.attachSession(node.id, sessionId)
        if (!attached.ok) {
          attachProblem = attached.problems[0] || null
          return
        }
        store.setNodeStatus(node.id, 'running', { note: '' })
        refreshTree()
      },
    })
    if (destroyed) return { ok: false, message: result.sentence || START_NEEDS_APP_TEXT }

    if (!result.ok) {
      /* THE SESSION COMES FIRST WHEN THERE IS ONE. A send that was refused after
         a start that worked leaves a real agent running on this computer;
         attaching it before the node is marked failed means the tree points at
         the thing that exists, instead of leaving it running with nothing on
         screen naming it. */
      if (result.sessionId) store.attachSession(node.id, result.sessionId)
      store.setNodeStatus(node.id, 'failed', { note: statusNote(result.sentence) })
      refreshTree()
      /* The identifier goes on the status line beside the sentence, never into
         it. `result.code` is null for the no-application branch, where there is
         no refusal to name because nothing was asked of anything. */
      setOrgStatus(result.sentence, 'refuse', { sticky: true, code: result.code })
      /* THE SECOND LINE OF ONE ANSWER, and only for the refusal it belongs to.
         A person whose computer has no assistant program is being sent to a
         terminal, and the shared copy keeps the "if you already have Node" route
         apart so a surface can offer it quietly. This panel shows one block of
         words, so quietly means after the sentence rather than beside it. */
      const panelSentence = result.needsAssistantProgram
        ? `${result.sentence} ${START_REFUSAL.assistantProgramNote}`
        : result.sentence
      return { ok: false, message: panelSentence }
    }

    if (attachProblem !== null) {
      /* The session is real and the tree could not record it. Saying "started"
         would leave a person with an agent they cannot find from this page. */
      const sentence = `${attachProblem || 'This tree could not record the session that was started.'} Your agent is running. Reload this page to pick it up again.`
      store.setNodeStatus(node.id, 'failed', { note: statusNote(sentence) })
      refreshTree()
      setOrgStatus(sentence, 'refuse', { sticky: true })
      return { ok: false, message: sentence }
    }
    /* THE AGENT RAN AND THE TREE WAS NOT SAVED IS ITS OWN OUTCOME, and reporting
       it as a plain success would be the worst kind of true: the session really
       is running, and the drawing of it is on screen and nowhere else. The store
       reports this rather than throwing, so a caller that never asked would
       never find out. */
    if (store.snapshot().persistenceFailed) setOrgStatus(TREE_NOT_SAVED_TEXT, 'refuse', { sticky: true })
    else setOrgStatus(runningLine(draft.role), 'ok')
    /* THE PANEL CLOSES ITSELF ON A SUCCESS, AND THE RAIL HAS TO COME BACK WITH
       IT. The panel removes its own root and stops there — correctly, since it
       does not know what was on this rail before it. Without this the person
       would be left looking at the empty page the panel had been sitting in,
       which reads as the rail having broken at the exact moment their agent
       started. */
    closeComposePanel()
    return { ok: true }
  }

  /* The note the tree keeps beside a node is bounded by the store, and a refusal
     sentence can be longer than that bound. Trimmed at a sentence end where
     there is one, so the note is a whole thought rather than a cut-off clause;
     the sentence in full is in the panel, which is where the person is reading.
     A note the store would refuse is worse than a shortened one: the refusal
     would leave the node with no explanation at all. */
  function statusNote(sentence) {
    const max = FLEET_TREE_LIMITS.maxNoteChars
    const text = String(sentence || '').trim()
    if (text.length <= max) return text
    const cut = text.slice(0, max)
    const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
    return lastStop > 40 ? cut.slice(0, lastStop + 1) : `${cut.slice(0, max - 1).trimEnd()}…`
  }

  function mountGraph() {
    clearMountedGraph()
    clearEmptyPanel()
    closeComposePanel()
    if (!computer) {
      releaseTreeStore()
      return
    }
    syncTreeStore()
    graphTitle.textContent = computer.name
    canvas = el('<div class="computer-tree-canvas"></div>')
    /* First child of the canvas slot, under the absolute overlays (crumb,
       hint, status) that follow it in the DOM — the same stacking the old
       insertBefore(title) arrangement produced. The slot, not the wrap: the
       bar above is normal flow, and the graph's zoom host (the canvas's
       parent) must be the area the tree actually owns. */
    graphWrap.querySelector('.graph-canvas-slot').prepend(canvas)
    graph = new StaticTreeGraph(canvas, {
      computer: graphComputer(),
      screenChips: true,
      contextFeed: treeContextFeed,
      edges: liveMode ? computer.graphEdges : null,
      onReparent: liveMode ? handleReparent : null,
      /* The graph asks, the view answers: tree roles are FREE TEXT, so the
         graph's old inline `role !== 'coordinator'` rule silently froze any
         tree node a person happened to name "coordinator". A tree node is
         draggable, full stop — the store refuses bad moves. Fleet records
         keep the old rule: the declared coordinator anchors that canvas. */
      canDrag: agent => Boolean(agent.treeNode) || agent.role !== 'coordinator',
      /* Refusals speak in the page's own status line, in the copy module's
         sentences. */
      onDropRefused: (rule, detail) => {
        const sentence = typeof MOVE_PANEL[rule] === 'function'
          ? MOVE_PANEL[rule](detail.name, detail.parent ?? detail.target)
          : null
        if (sentence) setOrgStatus(sentence, 'warn')
      },
      /* The new-tree slot's drop: this branch becomes its own tree. Tree
         nodes only — the declared fleet has exactly one organisation, and
         detaching a fleet agent into "another organisation" is not a thing
         this product does. */
      onDetachToNewTree: (agentId) => {
        if (!treeStore?.getNode(agentId)) {
          setOrgStatus(MOVE_PANEL.mixed, 'refuse', { sticky: true })
          return false
        }
        const out = treeStore.detachToNewTree(agentId)
        if (!out.ok) {
          setOrgStatus(out.problems[0] || MOVE_PANEL.notSaved, 'refuse', { sticky: true })
          return false
        }
        /* `unchanged` means the store understood the gesture and had nothing
           to do -- the node was already the sole root of its own tree. Saying
           "is now its own tree" there told a person a move had happened. */
        setOrgStatus(
          out.unchanged ? SECOND_TREE.alreadyOwnTree(treeNodeName(out.node)) : SECOND_TREE.detached(treeNodeName(out.node)),
          'ok',
        )
        return true
      },
      /* The compact card: real config or nothing. A node without a session has
         nothing to talk to, so its chip keeps routing to the rail. ONE config
         builder serves both this card and the rail's Chat tab — two copies of
         the attach/mention/send wiring is how the two surfaces drift. */
      treeChat: agent => treeChatConfigFor(agent.treeNode),
      /* A CLICK ON AN AGENT THIS PERSON STARTED IS NOT A CLICK ON A FLEET
         RECORD, and the rail behind this callback is written for a fleet record:
         it prints a provider, an origin and a bridge dispatch, and it would have
         printed this node's internal id at somebody. So a tree node is routed to
         a rail of its own, and the "Open agent detail" button is aimed at
         NOTHING rather than at a drill-in page that reads the fleet and would
         not find it. */
      onOpenControls: (agent) => {
        if (agent?.treeNode) {
          setOpenTarget(null)
          showTreeNodeControls(agent.treeNode)
          return
        }
        setOpenTarget(agent)
        showControls(agent)
      },
      onRootChange: (next, trail) => { renderCrumb(next, trail); refreshTreeSwitch(); railFollowsCanvas(next) },
      onOverridesChange: syncResetButton,
      /* THE OFFER, AND ONLY WHERE IT CAN BE HONOURED. Empty nodes are drawn on
         the board that reads this computer and are absent from the example one,
         the same way the launch controls are — a demonstration screen that could
         start a real session is the defect, not the feature. */
      emptySlots: liveMode === true,
      /* WHERE AN OFFER IS REAL, ASKED OF THE MODEL THAT OWNS THE ANSWER.
         src/fleet-trees.js already knows every position it would accept — its
         extensionPoints() excludes a branch at the engine's fan-out or depth cap
         — and the graph asks rather than importing a copy of a rule that would
         go stale. Without this a dashed circle can be drawn where the store will
         refuse, and the person only finds that out after choosing a role and
         writing out what they wanted done.
         A fleet or declared agent is not in the tree store at all, so no child
         position is offered under one. That is the honest answer rather than a
         lost capability: the store cannot hang a node under an agent it did not
         start, so a slot there was always an offer to do something else. */
      canExtend: (target) => {
        if (!treeStore) return true
        const points = treeStore.extensionPoints()
        if (target === null) return points.some(point => point.kind === 'tree' || point.kind === 'root')
        return points.some(point => point.parentId === target.id)
      },
      /* THE PRESS. src/tree-graph.js starts nothing and decides nothing; it
         reports which circle was pressed and hands over. Everything that happens
         next is above. */
      onEmptyPress: openComposeFor,
    })
    graph.onDensity = (dense) => hintElement.classList.toggle('show', dense)
    graph.updateDensity()
    /* Asked as the board comes up, so the answer is usually in hand before the
       first empty node is pressed. */
    void readStartableTiers()
    void readComposeFolders()
    /* THE PANEL THE PERSON WAS IN, REOPENED AFTER THE SWITCH THEY PRESSED IN IT
       tore this view down. Read once and cleared, so an ordinary visit never
       inherits it. See composeToRestore for the measurement. */
    if (composeToRestore) {
      const resume = composeToRestore
      composeToRestore = null
      queueMicrotask(() => { if (!destroyed) openComposeFor(resume) })
    }
    window.__mcGraph = graph
    renderCrumb(null)
    syncEditButton()
    syncEditAvailability()
    /* One subscription per mount, and the previous one goes first: openTreeStore
       hands back the SAME store when the computer has not changed, so a mount
       that only re-subscribed would leave one listener per remount attached to a
       store that outlives them all. */
    treeStoreUnsub?.()
    treeStoreUnsub = treeStore ? treeStore.subscribe(() => { if (!destroyed) refreshTree() }) : null
    /* A split-pane preference saved before 2026-08-16 is simply not
       read any more: the split pane is gone (owner: "lets throw it away for
       now"), and a key nobody reads is a key that cannot bring it back. */
    /* Aim the button before anything is clicked, so it is a way IN rather than a
       reward for having already found the way in. */
    setOpenTarget(computer.agents?.[0] || firstDeclaredTarget())
    /* The switcher builds AT MOUNT, not on the first store write. Every other
       caller of refreshTreeSwitch is a change handler (store events, root
       drills, compose flows), so a quietly-loaded page with five saved trees
       showed an empty trees slot until something changed — found driving the
       installed iteration-6 build, where the bar stood bare over a forest. */
    refreshTreeSwitch()
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
      ? (declaredFleetData(orgAvailability.org, readLiveSession()) || lastFleetData)
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
      ${railTitleRow({ title: 'Runtime Statistics' })}
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

  /* THE RAIL THE OWNER CALLED HARD TO READ, REBUILT AROUND THREE CHANGES.
   *
   * IT WAS A WALL OF MONO. Every sentence here was a `.rail-sub`, and that
   * class is `font-family: var(--font-mono)` — a paragraph of code type in a
   * 330px column. `.rail-prose` is the rail's reading voice and already exists
   * for exactly this (see its note in styles.css); mono is kept for the values
   * in the fact list, which is what mono is for.
   *
   * IT SAID THINGS IN FRAGMENTS. "This computer · declared source · 0 described
   * in the fleet record · graph revision 4" is four facts wearing one sentence's
   * clothes, and the reader has to do the parsing. Four facts are now four rows
   * with their own labels, and the sentences around them are sentences.
   *
   * THE WARNING LEAKED A HASH. See orgNotices() in src/org-controls.js: the
   * drift notice printed two content hashes, and at this width they truncated
   * mid-hash against the rail's edge. Nothing a person can act on was in them. */
  function renderLiveStats() {
    const services = computer.services || []
    const sourceSentence = RECORD_SOURCE[computer.note] || 'This computer did not say where its record came from.'
    statsPage.innerHTML = `
      ${railTitleRow({ title: 'Fleet overview' })}
      <div class="rail-scroll" data-live-mode="live" data-projection-state="available">
        <div class="stat-hero"><span class="v" id="agent-count" data-record-state="reading">—</span><span class="l">Agents on record</span></div>
        <div class="rail-prose is-dim" data-agent-record-note>Reading this computer’s own record of what has run here.</div>
        ${declaredOnlyReason ? `<div class="rail-note projection-unavailable" data-projection-state="declared">
          <b class="rail-note-h">This is the record, not a live reading</b>
          <span class="rail-note-b">${escapeMarkup(declaredOnlyReason)} So these are the agents this computer has on file, not agents anyone has seen running.</span>
          <a class="rail-note-a host-absent-action" href="${escapeMarkup(GUIDE_ACTION.href)}">${escapeMarkup(GUIDE_ACTION.label)}</a>
        </div>` : ''}
        <!-- THE FOLDER COMES FIRST NOW. It used to be the SEVENTH section, under
             the heading "Session profiles", and tools/rail-inventory-drive.mjs
             measured what that cost on the packaged build: 1152px down a 1524px
             scroll at 1440x900, and 1042px down a 1339px scroll at 1024x768 --
             below the fold at every width this product supports, behind the
             484px, 51-control Role library. The owner went looking for it and
             could not find it ("i think its in there maybe somewhere",
             2026-08-19). Nothing was removed to fix that; the section moved up
             and took a heading with the word "folder" in it.

             IT SITS ABOVE "This computer", NOT BELOW IT, and the difference was
             measured too. Below it the heading landed at 415px, which cleared
             the fold at 1440 and 1920 but left its CONTROLS under the floating
             notice at 1024 -- a heading a person can read over a box they
             cannot reach. Above it the whole section clears at every width.
             It stays BELOW the hero and its "this is the record" caveat,
             because that caveat qualifies the number directly above it and
             separating the two would be trading one defect for another. -->
        <div class="rail-sec">${escapeMarkup(PROFILE_PANEL.overviewTitle)}</div>
        <div class="board-profile-slot" data-profile-slot></div>
        <div class="rail-sec">This computer</div>
        <dl class="rail-facts">
          <div class="rail-fact"><dt>Agents described</dt><dd>${computer.spawnedTotal}</dd></div>
          <div class="rail-fact"><dt>Recorded relationships</dt><dd>${computer.graphEdges.length}</dd></div>
          <div class="rail-fact"><dt>Graph revision</dt><dd>${computer.graphRevision ?? 'not recorded'}</dd></div>
        </dl>
        <p class="rail-prose is-dim">${escapeMarkup(sourceSentence)} Runtime, load, tasks and messages are not kept in it.</p>
        <div class="rail-sec">Services</div>
        ${services.length
          ? `<div class="task-list projection-state">${services.map(service => {
              const meta = [service.state, service.detail].filter(Boolean).join(' · ').replace(/\s--\s/g, ', ')
              return `<div class="task-chip" data-service-id="${escapeMarkup(service.id)}"><i></i><b>${escapeMarkup(service.name)}</b><span class="svc-meta">${escapeMarkup(meta)}</span></div>`
            }).join('')}</div>`
          /* OUTSIDE the .projection-state box, not inside it. That class is a
             96px grid with centred content and 24px of side padding — right for
             a wall of service chips, and wrong for one sentence, which it hung
             in the middle of an empty panel while every other sentence on the
             rail started at the left margin. */
          : '<p class="rail-prose is-dim">No services are on record for this computer.</p>'}
        <div class="rail-sec">Organisation</div>
        ${orgSourceMarkup()}
        <div class="rail-sec">Roles</div>
        <div class="board-org-slot"></div>
        <div class="rail-sec">Research filing</div>
        <p class="rail-prose is-dim">Pick a project and every session in the tree you are looking at gets filed under it. Every tree files the whole computer.</p>
        <div class="rail-research-slot" data-research-scope-slot><p class="rail-prose is-dim">Reading your research projects.</p></div>
      </div>`
    mountOrgLibrary(statsPage.querySelector('.board-org-slot'))
    void mountProfilePanel(statsPage.querySelector('[data-profile-slot]'))
    mountResearchScopeControl()
    void paintAgentsOnRecord()
  }

  /* "AGENTS ON RECORD" NOW COUNTS THE RECORD, WHICH IT DID NOT BEFORE.
   *
   * WHAT WAS MEASURED. Three nodes on the canvas, an agent that really ran, and
   * this hero reading 0. It was printing `computer.spawnedTotal`, which is
   * `agents.length` off the FLEET PROJECTION -- a build-time file that ships
   * `ok:false` and describes nothing on a customer machine, which is the whole
   * argument in the header of src/declared-fleet.js. So the number was not
   * wrong about the record; it was never about the record at all. On the
   * packaged build with two starts in the signed ledger it still said 0.
   *
   * WHERE THE TRUE NUMBER LIVES. The app writes every start into its own
   * hash-chained agent-spawn-records.jsonl before it starts anything
   * (shell/spawn-record.cjs, called by mc-agent:start), and reads it back
   * through mcAgent.history(). src/views/home.js already counts exactly this,
   * through readLocalSessions() -- the same function is used here rather than a
   * second reading of the same file, so the two screens cannot disagree about
   * how many agents this computer has run.
   *
   * AN UNREADABLE RECORD IS NOT ZERO, and that distinction is the reason this
   * is asynchronous rather than a swapped expression. Zero is a claim: it says
   * nothing has ever run here. A record that could not be opened is the absence
   * of a claim, and painting it as 0 would be the same lie this repair is for,
   * wearing the other sign. So the hero starts as an em dash, and every branch
   * below either produces a number it can defend or says in words why there is
   * none.
   *
   * THE PROJECTION'S OWN COUNT IS NOT DELETED. It moved to the line beneath,
   * under a label that says what it actually is -- what the fleet record
   * DESCRIBES, rather than what has run. */
  async function paintAgentsOnRecord() {
    const hero = statsPage.querySelector('#agent-count')
    const note = statsPage.querySelector('[data-agent-record-note]')
    if (!hero || !note) return

    const bridge = typeof window === 'undefined' ? null : window.mcAgent
    let raw
    if (!bridge || typeof bridge.history !== 'function') raw = undefined
    else {
      /* 200 is the recorder's own ceiling. The count itself comes from the
         whole-chain tally rather than from these rows, but when that tally is
         missing the rows are what is left to count, and a bigger page makes
         that fallback less of an understatement. */
      try { raw = await bridge.history({ limit: 200 }) } catch { raw = null }
    }
    if (destroyed || !hero.isConnected) return

    const sessions = readLocalSessions(raw)
    if (!sessions.supported) {
      hero.textContent = '—'
      hero.dataset.recordState = 'unsupported'
      note.textContent = 'This page is not running inside the installed application, so there is no record here to read.'
      return
    }
    if (!sessions.readable) {
      hero.textContent = '—'
      hero.dataset.recordState = 'unreadable'
      note.textContent = 'This copy could not open its record of what has run here, so this is not a count yet. Nothing has been lost and new runs are still written down.'
      return
    }
    /* `started` is null exactly when the recorder returned no whole-chain
       tally, and `total` is only a start count when that tally is present --
       without it the ledger's line count includes the outcome records too and
       would report roughly twice as many agents as ever ran. */
    const tallied = sessions.started !== null
    const count = tallied ? sessions.total : sessions.runs.length
    hero.textContent = String(count)
    hero.dataset.recordState = tallied ? 'counted' : 'partial'
    const verified = sessions.verified === true
      ? 'The record checks out as unbroken.'
      : (sessions.verified === false
        ? 'The record does not check out as unbroken, so treat this count as a floor.'
        : 'This copy did not say whether the record checks out.')
    note.textContent = tallied
      ? `From this computer’s own signed record of every agent it has started. ${verified}`
      : `Counted from the most recent runs this copy could read, so it may be short. ${verified}`
  }

  /* SESSION PROFILES, MANAGED WHERE THE FLEET IS DESCRIBED. A profile is a
     name plus a folder the person picked in the OS dialog -- the renderer
     never types or shows a path it invented; the main process owns the store
     and the picker. Assigning a profile to a tree happens on the tree's own
     Actions tab; this box creates and removes the profiles themselves. */
  async function mountProfilePanel(slot) {
    if (!slot) return
    const bridge = typeof window === 'undefined' ? null : window.mcAgent
    if (!bridge || typeof bridge.profiles !== 'function') {
      slot.innerHTML = `<p class="rail-prose is-dim">${escapeMarkup(PROFILE_PANEL.needsApp)}</p>`
      return
    }
    const answer = await bridge.profiles().catch(() => null)
    const profiles = answer && answer.ok ? answer.profiles : []
    slot.innerHTML = `
      <div class="board-box board-ctl-box">
        <p class="rail-prose is-dim">${escapeMarkup(PROFILE_PANEL.help)}</p>
        <ul class="rail-prose profile-list" data-profile-list>
          ${profiles.map(profile => `<li><b>${escapeMarkup(profile.name)}</b> · <span class="profile-folder">${escapeMarkup(profile.cwd)}</span> <button class="ctl-btn profile-remove" type="button" data-profile-remove="${escapeMarkup(profile.id)}">${escapeMarkup(PROFILE_PANEL.remove)}</button></li>`).join('')
            || `<li>${escapeMarkup(PROFILE_PANEL.none)}</li>`}
        </ul>
        <div class="ctl-row">
          <input class="ctl-select" type="text" data-profile-name placeholder="${escapeMarkup(PROFILE_PANEL.namePlaceholder)}" aria-label="${escapeMarkup(PROFILE_PANEL.namePlaceholder)}">
          <button class="ctl-btn" type="button" data-profile-add>${escapeMarkup(PROFILE_PANEL.add)}</button>
        </div>
        <output class="rail-prose" role="status" data-profile-out></output>
      </div>`
    const out = slot.querySelector('[data-profile-out]')
    slot.querySelector('[data-profile-add]')?.addEventListener('click', async () => {
      const name = slot.querySelector('[data-profile-name]')?.value?.trim()
      if (!name) { out.textContent = PROFILE_PANEL.nameFirst; return }
      const made = await bridge.profileCreate({ name }).catch(error => ({ ok: false, code: refusalCode(error) }))
      if (!made || made.ok !== true) { out.textContent = PROFILE_PANEL.refused; return }
      if (!made.profile) { out.textContent = PROFILE_PANEL.cancelled; return }
      void mountProfilePanel(slot)
    })
    for (const button of slot.querySelectorAll('[data-profile-remove]')) {
      button.addEventListener('click', async () => {
        await bridge.profileRemove({ profileId: button.dataset.profileRemove }).catch(() => null)
        void mountProfilePanel(slot)
      })
    }
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
      ? 'This is the organisation you saved.'
      : 'This is the organisation the app ships with. Nothing has been changed on this computer yet.'
    return `${orgNoticeMarkup(orgAvailability.org)}
      <p class="rail-prose is-dim">${escapeMarkup(source)}</p>
      <dl class="rail-facts">
        <div class="rail-fact"><dt>Revision</dt><dd>${escapeMarkup(String(orgAvailability.org.revision))}</dd></div>
      </dl>`
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
    const box = buildRoleLibraryBox({
      availability: orgAvailability,
      onCreate: (definition) => callRoleBridge('createRole', definition, 'The role was not created.'),
      onEdit: (edit) => callRoleBridge('editRole', edit, 'The role wording was not saved.'),
      onReset: (target) => callRoleBridge('resetRole', target, 'The shipped wording was not restored.'),
    })
    slot.replaceWith(box)
    /* THE PERSON'S OPEN EDITORS AND UNSAVED WORDING, BACK WHERE THEY WERE.
       NOT read-once, deliberately, and this is where it differs from
       composeToRestore above: the live mount can build this box more than once
       while it settles (measured 2026-08-20, two builds 8ms apart on the
       drawer's live-flip -- a read-once restore was consumed by the first
       build and wiped by the second). So the snapshot is re-applied to every
       build until the person touches the restored library; their first input
       or press makes the page the truth, and a later rebuild must not drag it
       back to the snapshot. Each flags capture above overwrites the snapshot
       wholesale, so it can never be older than the last remount. */
    if (roleLibraryToRestore && restoreRoleLibrary(box, roleLibraryToRestore) > 0) {
      const settle = () => { roleLibraryToRestore = null }
      box.addEventListener('input', settle, { once: true, capture: true })
      box.addEventListener('click', settle, { once: true, capture: true })
    }
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
    /* THE DOOR COMES BACK WITH THE OVERVIEW. Selecting a node in your own tree
       aims "Open agent detail" at nothing (a tree node has no drill-in page,
       and the button must not pretend otherwise); this is the other half:
       leaving that selection re-aims it exactly the way mount does. Measured
       before this line existed: one click on an own agent and the door was
       display:none for the rest of the visit -- the "reward for having already
       found the way in" the mount-time aim was written to end. */
    if (!openTarget) setOpenTarget(computer?.agents?.[0] || firstDeclaredTarget())
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
        /* The identifier goes on the node, not into the sentence — see
           src/refusal-copy.js. It is resolved once so the remedy lookup and the
           machine channel cannot disagree about which refusal this was. */
        const refusal = result.ok ? null : { code: refusalCodeOf(result) || 'BRIDGE_REFUSED', reason: result.reason }
        output.textContent = result.ok
          ? `started · ${result.receipt.launchId}`
          : `refused · ${refusalSentence(refusal, { fallback: 'The dispatch was refused with no receipt.' })}`
        markRefusalCode(output, refusal)
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
                <code>${escapeMarkup((TIER_SEAT_POOL[tier.id] || []).length === 1 ? '1 seat' : `${(TIER_SEAT_POOL[tier.id] || []).length} seats`)}</code>
              </label>`).join('')}
          </div>
        </div>
        <div class="rail-sub" data-team="identity-note">Every agent needs its own seat. Some agents share a set of seats, so at most ${TEAM_BOUNDS.maxConcurrent} can run at the same time on this computer.</div>
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
    /* The chat this box built last time. render() runs again whenever the
       person changes a chatbox setting, and the wipe below used to drop a
       mounted buildChat on the floor -- its observers, frames and timers stay
       alive on a detached root. Same rule as railChat: dispose, then wipe. */
    let mounted = null
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
      mounted?.dispose?.()
      mounted = null
      host.innerHTML = ''
      host.dataset.chatChannel = plan.channel.kind
      if (plan.channel.kind === 'simulated' && plan.showContext) {
        mounted = buildChat({
          title: agent.name,
          subtitle: channelCaption(plan.channel, role.label),
          roleKey: agent.role,
          seed: 6,
        })
        host.appendChild(mounted)
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

  /* THE RAIL FOR AN AGENT THIS PERSON STARTED FROM THE TREE.
   *
   * WHY IT IS NOT showProjectionControls. That panel describes a FLEET RECORD:
   * it prints a provider, an origin, an internal id, and it mounts the Dispatch,
   * team, loop and cloud controls onto the agent it is given. Every one of those
   * is wrong here — a node this page started an hour ago has no fleet record, no
   * provider on file, and no business offering to dispatch a lane nested under
   * itself — and printing its id would put a key in front of a person, which the
   * tree model's own contract forbids.
   *
   * So this says the things that are true and stops: what it is, what it is
   * doing, why it is not doing it when that is the case, what was asked of it,
   * and what it runs on. The reason sentence is the store's own `statusNote`,
   * which is where the refusal from a failed start was written, so this rail and
   * the panel that reported it cannot drift apart.
   */
  /* WHAT IT RUNS ON. This used to be a statement instead of a menu, because the
   * channel had no tier parameter and a select here would have been the
   * temperature slider again (f1ce3ec) -- a control that moves and changes
   * nothing. The channel now carries `tier` end to end (parseAgentStart ->
   * startSession -> resolveStartTier), and the CHOICE lives where the start
   * lives: the compose panel's model menu, whose value rides in the draft and
   * onto mcAgent.start(). This rail keeps only the fact. Nothing in this box is
   * focusable.
   *
   * AND THE FACT IS NOW ASKED FOR, NOT DECLARED. What stood here was
   * `TREE_ENGINE_LABEL = 'Codex'` and a note reading "Agents you start from
   * this tree run on Codex. You pick the model in the start panel; the Claude
   * choices are listed there and say so when they cannot start yet." Both
   * halves were true when Codex was the only engine in the payload and both
   * are false today, which is what the owner reported. Measured on a staged
   * packaged build with real presses (the post-cut-truth lane, 2026-08-17):
   * the shell answers luna, terra, sol, claude-fable, claude-sonnet,
   * claude-opus; the menu renders "Sonnet · Claude" with NO marker on it; and
   * a Claude agent started from a tree really answered, on a profile carrying
   * a Claude sign-in and no Codex credential at all.
   *
   * So the words come from `startableTierIdList` -- what mc-agent:startable-tiers
   * answered, which is the same resolveStartTier() a press runs -- and a node
   * that already ran says what IT ran on, from the tier recorded on it. Neither
   * can name a provider the shell did not list, and no edit here is needed when
   * the payload changes. The sentences live in src/fleet-tree-copy.js so a
   * guard can walk them; the fourth copy of this same false claim was found
   * only because it was somewhere a test could reach. */
  function treeEngineFace(node) {
    const ran = node?.tier ? tierProviderWord(node.tier) : null
    if (node?.sessionId) {
      return { label: ran || TREE_ENGINE.unrecorded, note: ran ? TREE_ENGINE.ran(ran) : '' }
    }
    const words = startableProviderWords(startableTierIdList)
    if (words.length === 0) return { label: TREE_ENGINE.none, note: TREE_ENGINE.noneNote }
    return { label: words.join(' · '), note: TREE_ENGINE.note(words) }
  }

  function showTreeNodeControls(node) {
    disposeRailSaid()
    clearBoard()
    currentRailTreeNode = node
    const role = ROLES[node.role] || ROLES.default
    const engineFace = treeEngineFace(node)
    controlsPage.style.setProperty('--rc', role.hex)
    disposeRailChat()
    controlsPage.innerHTML = `
      ${railTitleRow({ back: { aria: 'Back to the fleet overview' }, title: 'Agent in your tree' })}
      <!-- THE VSCODE-SHAPED RAIL, round two (owner, iteration 6: "Actions
           again just shouldnt be its own page it should be a button on the
           chat"). Two PERSISTENT bodies toggled by [hidden] — many selectors
           query controlsPage, and swapping innerHTML per tab would orphan the
           mounted chat and strand every live updater; hidden bodies keep both
           working. The verbs live in the chat composer's actions popup; what
           remains here is the conversation and the agent's facts, with its
           setup (folder, place in the tree) at the bottom of Details. -->
      <div class="seg rail-tabs" data-rail-tabs role="group" aria-label="Agent panels">
        <button type="button" class="on" data-rail-tab="chat">Chat</button>
        <button type="button" data-rail-tab="details">Details</button>
      </div>
      <!-- ONE HOST, EVERY STATE. This used to be a chat host for a node with a
           session and a paragraph of prose for one without -- and the prose
           said "Press its circle on the canvas to start it", which is the
           gesture that opens THIS PANEL and starts nothing. A node with no
           session now mounts the same chat, read-only, carrying its own
           refusal where the message box would be (treeChatConfigFor). -->
      <div class="rail-tab-body rail-chat-body" data-rail-body="chat">
        <div class="rail-chat-host" data-rail-chat-host></div>
      </div>
      <div class="rail-tab-body rail-scroll" data-rail-body="details" hidden>
        <!-- The head names the agent and its ROLE — never its brief. The brief
             is the person's own sentence: it belongs in prose below, once, and
             it was being printed twice (here in letterspaced capitals, and
             again in its own box) which is most of what "unreadable mess"
             meant. -->
        <div class="agent-head board-head"><span class="role-dot"></span><div><div class="an">${escapeMarkup(treeNodeName(node))}</div><div class="ar">${escapeMarkup(roleLabel(node.role))}</div></div></div>
        <!-- THE FOLDER IS THE FIRST THING UNDER THE NAME, and it used to be a
             four-step scavenger hunt: press Details, scroll past three boxes,
             read "Setup" as the place folders live, then read "Works in" as
             meaning a folder. It was the fifth of nine panels
             (tools/rail-inventory-drive.mjs). Owner, 2026-08-19: "what happened
             to sessions and choosing a folder for each tree and such?"

             EVERY DATA HOOK KEEPS ITS EXACT NAME -- data-tree-profile,
             data-tree-profile-out, data-tree-profile-restart-row,
             data-tree-profile-restart. The handlers below query controlsPage,
             not this box, so they moved without a single rewrite. That is what
             makes this placement change safe rather than a rebuild. -->
        <div class="board-box board-ctl-box" data-tree-folder>
          <div class="board-box-h"><span class="bh-t">${escapeMarkup(PROFILE_PANEL.nodeTitle)}</span></div>
          <div class="rail-prose is-dim">${escapeMarkup(PROFILE_PANEL.treeHelp)}</div>
          <div class="ctl-row">
            <select class="ctl-select" data-tree-profile aria-label="${escapeMarkup(PROFILE_PANEL.title)}"></select>
          </div>
          <output class="rail-prose" role="status" data-tree-profile-out></output>
          <div class="ctl-row" data-tree-profile-restart-row hidden>
            <button class="ctl-btn" type="button" data-tree-profile-restart>${escapeMarkup(PROFILE_PANEL.switchGo)}</button>
          </div>
        </div>
        <!-- TWO BOXES, NOT FOUR (iteration 7). Each of the old four carried an
             uppercase header over one word — "finished", "DELTA" — so the tab
             was mostly chrome shouting at its own contents. What it is doing
             now holds the whole run (status, note, narration, usage); the
             conversation holds the brief and the latest answer, which are the
             two halves of one exchange. -->
        <div class="board-box board-ctl-box">
          <div class="board-box-h"><span class="bh-t">What it is doing</span></div>
          <div class="rail-prose" data-tree-status>${escapeMarkup(treeNodeStatusWord(node))}</div>
          <div class="rail-prose is-dim" data-tree-status-note${node.statusNote ? '' : ' hidden'}>${escapeMarkup(node.statusNote || '')}</div>
          <div class="rail-prose is-dim" data-tree-activity${nodeActivity.get(node.id) ? '' : ' hidden'}>${escapeMarkup(nodeActivity.get(node.id) || '')}</div>
          ${node.sessionId ? `
          <div class="rail-prose is-dim" data-tree-usage${sessionUsage.has(node.sessionId) ? '' : ' hidden'}>${escapeMarkup(sessionUsage.has(node.sessionId) ? usageSentence(sessionUsage.get(node.sessionId)) : '')}</div>` : ''}
        </div>
        <div class="board-box board-ctl-box">
          <div class="board-box-h"><span class="bh-t">The conversation</span></div>
          <!-- The brief is written ONCE at start (no setNodeMessage exists);
               the answer below is overwritten every turn. The sub-labels say
               which is which without a second heading rank. -->
          <div class="rail-sec">What you asked for</div>
          <div class="rail-prose">${escapeMarkup(node.message || '')}</div>
          ${node.sessionId ? `
          <div class="rail-sec">${escapeMarkup(SAID_PANEL.title)}</div>
          <div class="rail-prose rail-said" data-tree-said></div>` : ''}
        </div>
        ${node.sessionId ? `
        <div class="board-box board-ctl-box" data-research-file-box>
          <div class="board-box-h"><span class="bh-t">Research project</span></div>
          <div class="rail-prose is-dim" data-research-filed-line>Reading where this session is filed.</div>
          <div data-research-file-mount></div>
        </div>` : ''}
        <!-- SETUP: what describes the node rather than the conversation. The
             FOLDER used to live here too and now stands on its own above -- see
             the comment on [data-tree-folder]. What is left is the engine this
             agent runs on and where it sits in the tree. -->
        <div class="board-box board-ctl-box" data-tree-move>
          <div class="board-box-h"><span class="bh-t">Setup</span></div>
          <div class="ctl-row"><span class="cl">Engine</span><span class="cv">${escapeMarkup(engineFace.label)}</span></div>
          ${engineFace.note ? `<p class="board-absent-copy">${escapeMarkup(engineFace.note)}</p>` : ''}
          <div class="rail-sec">${escapeMarkup(MOVE_PANEL.title)}</div>
          <div class="rail-prose is-dim">${escapeMarkup(MOVE_PANEL.help)}</div>
          <div class="ctl-row" data-tree-move-row hidden>
            <select class="ctl-select" data-tree-move-select aria-label="${escapeMarkup(MOVE_PANEL.title)}"></select>
            <button class="ctl-btn" type="button" data-tree-move-save>${escapeMarkup(MOVE_PANEL.save)}</button>
          </div>
          <output class="rail-prose" role="status" data-tree-move-out></output>
        </div>
        <!-- Launch, Team, Loop and Codex Cloud. See mountStartWorkControls():
             this is the rail a person actually reaches for an agent they
             started on this computer, and until 2026-08-18 those four controls
             were built only on a rail nothing could open. -->
        <div class="board-start-work-slot"></div>
      </div>`
    controlsPage.querySelector('.rail-back').addEventListener('click', showStats)
    mountStartWorkControls(
      { id: node.id, name: treeNodeName(node) },
      controlsPage.querySelector('.board-start-work-slot'),
    )
    /* Filing this session under a research project. The projects list was read
       once at mount; a refusal renders as its sentence, never as an empty
       select. The session reference is the OBSERVED id — the one identity a
       tree node always has once a session is attached. */
    const fileMount = controlsPage.querySelector('[data-research-file-mount]')
    if (fileMount && node.sessionId) {
      const filedLine = controlsPage.querySelector('[data-research-filed-line]')
      const projects = researchService?.ok ? researchService.projects : []
      const projectName = id => projects.find(project => project.projectId === id)?.name || id
      const renderFiledLine = () => {
        const filed = researchAssignments.projectsOfSession('observed', node.sessionId)
        if (filedLine) {
          filedLine.textContent = filed.length === 0
            ? 'Not filed under a research project.'
            : `Filed under: ${filed.map(projectName).join(', ')}.`
        }
      }
      renderFiledLine()
      fileMount.appendChild(createAssignmentControl({
        projects,
        unavailableReason: researchService && !researchService.ok ? researchService.reason : (researchService ? null : 'the projects have not been read yet'),
        currentProjectIds: researchAssignments.projectsOfSession('observed', node.sessionId),
        onAssign: async projectId => {
          const result = await researchAssignments.assign(projectId, 'observed', node.sessionId)
          renderFiledLine()
          return result
        },
      }))
    }
    /* The tabs toggle [hidden] on persistent bodies — see the markup       comment for why nothing is ever re-rendered on a tab press. */
    const railTabs = controlsPage.querySelector('[data-rail-tabs]')
    railTabs?.addEventListener('click', (event) => {
      const pressed = event.target.closest('[data-rail-tab]')
      if (!pressed) return
      for (const button of railTabs.querySelectorAll('[data-rail-tab]')) {
        button.classList.toggle('on', button === pressed)
      }
      for (const body of controlsPage.querySelectorAll('[data-rail-body]')) {
        body.hidden = body.dataset.railBody !== pressed.dataset.railTab
      }
    })
    /* The Chat tab's mount: the same config the compact card uses, tall, over
       the FULL transcript (D9's mechanism — the rail no longer pairs the
       first ask with the latest reply; the whole conversation is here). The
       send wraps the shared handlers so a turn that STREAMED into an open
       bubble closes that bubble instead of printing the reply twice. */
    const chatHost = controlsPage.querySelector('[data-rail-chat-host]')
    if (chatHost) {
      const config = treeChatConfigFor(node)
      if (config) {
        /* The send wrapper exists only for a config that CAN send: a node with
           no session carries composerReason instead, and wrapping an absent
           onSend would put a function where buildChat reads "this chat can
           reach the agent". */
        /* THE CHAT THIS WRAPPER BELONGS TO, CAPTURED, NOT LOOKED UP.
         *
         * The wrapper used to read the live `railChat` variable, and that
         * variable is reassigned every time the rail is rebuilt onto another
         * node. A reply arriving after a rebuild therefore closed a DIFFERENT
         * node's bubble with this node's words, and this node's own handler was
         * never called -- one message merged into another conversation and one
         * vanished (owner, 2026-08-18). The object is built first and compared
         * by identity, so a stale wrapper answers its own chat or nothing. */
        const mine = { sessionId: node.sessionId, nodeId: node.id, root: null, stream: null }
        const chat = buildChat({
          ...config,
          tall: true,
          ...(typeof config.onSend === 'function' ? {
            onSend: (text, handlers) => config.onSend(text, {
              reply: (said) => {
                if (railChat === mine && mine.stream) {
                  mine.stream.close(said)
                  mine.stream = null
                } else {
                  handlers.reply(said)
                }
              },
              fail: handlers.fail,
            }),
          } : {}),
        })
        mine.root = chat
        chatHost.appendChild(chat)
        railChat = mine
      }
    }
    /* THE KEYBOARD HALF OF "quickly connect nodes and change hierarchies".
       Edit-mode drag exists and stays; this menu is the accessible, refusable
       path. It is built from movePoints(), so it can only offer moves the
       store will accept — and the snapshot is RE-READ when Save is pressed,
       because a menu built at open time can go stale while it stands. */
    /* The tree's profile select: options are the main process's own list,
       plus the product workspace as the stated default. A change writes the
       TREE (setTreeProfile) and speaks; it applies to agents started after,
       which the help line says out loud. */
    const profileSelect = controlsPage.querySelector('[data-tree-profile]')
    const profileOut = controlsPage.querySelector('[data-tree-profile-out]')
    if (profileSelect && treeStore && node.treeId) {
      const bridgeForProfiles = typeof window === 'undefined' ? null : window.mcAgent
      const current = treeStore.treeProfile(node.treeId)
      const baseOption = document.createElement('option')
      baseOption.value = ''
      baseOption.textContent = PROFILE_PANEL.productWorkspace
      profileSelect.appendChild(baseOption)
      if (bridgeForProfiles && typeof bridgeForProfiles.profiles === 'function') {
        void bridgeForProfiles.profiles().then(answer => {
          if (!answer || answer.ok !== true) return
          for (const profile of answer.profiles) {
            const option = document.createElement('option')
            option.value = profile.id
            option.textContent = profile.name
            if (profile.id === current) option.selected = true
            profileSelect.appendChild(option)
          }
        }).catch(() => {})
      }
      profileSelect.addEventListener('change', () => {
        const chosen = profileSelect.value || null
        const saved = treeStore.setTreeProfile(node.treeId, chosen)
        if (!saved.ok) { profileOut.textContent = saved.problems[0] || PROFILE_PANEL.refused; return }
        const label = profileSelect.selectedOptions[0]?.textContent || ''
        profileOut.textContent = chosen ? PROFILE_PANEL.assigned(label) : PROFILE_PANEL.cleared
        /* The assignment touched the TREE; this node's live session still
           runs where it started. Moving it now is a warned restart the
           person presses, never a side effect of picking from a menu. */
        const restartRow = controlsPage.querySelector('[data-tree-profile-restart-row]')
        if (restartRow && node.sessionId) {
          profileOut.textContent += ` ${PROFILE_PANEL.switchOffer}`
          restartRow.hidden = false
        }
      })
      controlsPage.querySelector('[data-tree-profile-restart]')?.addEventListener('click', () => {
        void resumeNodeSession(treeStore ? treeStore.getNode(node.id) || node : node, { out: profileOut })
      })
    }
    const moveRow = controlsPage.querySelector('[data-tree-move-row]')
    const moveSelect = controlsPage.querySelector('[data-tree-move-select]')
    const moveSave = controlsPage.querySelector('[data-tree-move-save]')
    const moveOut = controlsPage.querySelector('[data-tree-move-out]')
    if (moveRow && treeStore) {
      const points = treeStore.movePoints(node.id)
      if (points.length === 0) {
        moveOut.textContent = MOVE_PANEL.empty
      } else {
        moveRow.removeAttribute('hidden')
        const placeholder = document.createElement('option')
        placeholder.value = ''
        placeholder.textContent = MOVE_PANEL.prompt
        moveSelect.appendChild(placeholder)
        /* TWO ROWS READING "Manager" ARE A CHOICE NOBODY CAN MAKE. Measured on
           the flagship walkthrough (2026-08-19): two trees each rooted in a
           node named Manager put two indistinguishable rows in this picker.
           The name stays first — it is what the person typed — and the tree's
           own label is appended ONLY when the bare name appears more than
           once, so the common case stays clean and the ambiguous one becomes
           answerable. */
        const seen = new Map()
        for (const point of points) {
          const parent = treeStore.getNode(point.parentId)
          if (!parent) continue
          const name = treeNodeName(parent)
          seen.set(name, (seen.get(name) || 0) + 1)
        }
        for (const point of points) {
          const parent = treeStore.getNode(point.parentId)
          if (!parent) continue
          const option = document.createElement('option')
          option.value = point.parentId
          const name = treeNodeName(parent)
          option.textContent = seen.get(name) > 1
            ? `${name} — ${treeStore.treeLabel(parent.treeId)}`
            : name
          moveSelect.appendChild(option)
        }
        moveSave.addEventListener('click', () => {
          const parentId = moveSelect.value
          if (!parentId) {
            moveOut.textContent = MOVE_PANEL.needChoice
            return
          }
          const stillLegal = treeStore.movePoints(node.id).some(point => point.parentId === parentId)
          const moved = stillLegal
            ? treeStore.moveNode(node.id, parentId)
            : { ok: false, problems: [MOVE_PANEL.staleChoice] }
          if (!moved.ok) {
            moveOut.textContent = moved.problems[0] || MOVE_PANEL.notSaved
            return
          }
          /* The rail is rebuilt around the moved node so every box tells the
             new truth; the saved sentence lands in the fresh rail's output. */
          const parentName = treeNodeName(treeStore.getNode(parentId))
          showTreeNodeControls(treeStore.getNode(node.id))
          const freshOut = controlsPage.querySelector('[data-tree-move-out]')
          if (freshOut) freshOut.textContent = MOVE_PANEL.saved(treeNodeName(moved.node), parentName)
        })
      }
    }
    /* THE SAID BOX IS FILLED HERE, NOT IN THE TEMPLATE, because it has three
       truthful states and two of them are alive: a finished reply (rendered
       once), a mid-turn stream (the appender, seeded with everything the turn
       has said so far -- a person opening the rail late must not miss the
       first half of the answer), and the waiting line for a session that has
       not spoken yet. */
    const saidHost = controlsPage.querySelector('[data-tree-said]')
    if (saidHost) {
      const reply = nodeReplies.get(node.id)
      /* nodeBusy, not the saved status: a stale node opened a stream appender
         and sat under "no answer yet" for a turn that ended at the last
         shutdown. */
      const live = nodeBusy(node)
      if (reply) {
        saidHost.textContent = reply
      } else if (live) {
        const waitingLine = document.createElement('span')
        waitingLine.className = 'projection-unavailable'
        waitingLine.textContent = SAID_PANEL.waiting
        saidHost.appendChild(waitingLine)
        const appender = createTranscriptAppender({
          node: saidHost,
          createTextNode: text => document.createTextNode(text),
          scheduleFrame,
          cancelFrame,
        })
        railSaid = { nodeId: node.id, appender, waitingLine }
        const spokenSoFar = sessionTurnText.get(node.sessionId) || ''
        if (spokenSoFar) {
          waitingLine.remove()
          railSaid.waitingLine = null
          appender.push(spokenSoFar)
        }
      } else if (nodeSessionEnded(node)) {
        /* "No answer yet" is a promise that one is coming. For a node whose
           session died with the app there is no turn left to wait for, so this
           says what happened and what to do instead. */
        saidHost.textContent = ENDED_SESSION.said
      } else {
        saidHost.textContent = SAID_PANEL.waiting
      }
    }
    /* THE QUESTION THAT ARRIVED WHILE THIS RAIL WAS CLOSED. Without this the
       Approve button existed only for a person already looking at the node the
       moment approval_request fired -- see sessionPendingApprovals. */
    const pendingApproval = sessionPendingApprovals.get(node.sessionId)
    if (pendingApproval) renderApprovalCard(node.sessionId, pendingApproval)
    activateRail(controlsPage)
  }

  /* A STATUS LANDING REPAINTS THE WORDS THAT CHANGED, NEVER THE WHOLE RAIL.
   *
   * THE DEFECT, measured twice on a live drive, 2026-08-18: a settling
   * session's status re-called showTreeNodeControls, and that is an innerHTML
   * rebuild -- it disposes the mounted chat, and buildChat's dispose closes an
   * open actions popup. A person typing in the popup's filter lost the menu
   * and their word mid-keystroke every time a turn ended or a queued message
   * drained. The palette driver reopens and counts; a person just loses it.
   *
   * WHAT THOSE CALLERS ACTUALLY NEEDED, read from the rebuild they reached
   * for. The re-calls predate iteration 6 (3887c93): the rail then rendered
   * status and queue as static markup, so a rebuild was the only repaint.
   * Today the composer's send-stop face and the queue strip subscribe through
   * the chat config -- notifyNodeStatusListeners and SESSION_OUTBOX_EVENT --
   * the canvas chip repaints through scheduleChipRefresh, and the popup's rows
   * are rebuilt from the store at every open. What does NOT repaint itself is
   * the static half of the Details tab: the status word, its note, the
   * activity line, and the settled reply in the said box. So this updates
   * exactly those hosts, in place, and the chat -- popup, filter text, cursor
   * and all -- is never torn down by a status. */
  function repaintRailStatus(node) {
    currentRailTreeNode = node
    const statusHost = controlsPage.querySelector('[data-tree-status]')
    if (statusHost) statusHost.textContent = treeNodeStatusWord(node)
    const noteHost = controlsPage.querySelector('[data-tree-status-note]')
    if (noteHost) {
      noteHost.textContent = node.statusNote || ''
      noteHost.hidden = !node.statusNote
    }
    const activityHost = controlsPage.querySelector('[data-tree-activity]')
    if (activityHost) {
      const line = nodeActivity.get(node.id) || ''
      activityHost.textContent = line
      activityHost.hidden = !line
    }
    /* The said box is repainted only when it is settled: a live railSaid is
       mid-write into this host and owns it until the completion flushes it. */
    if (!railSaid) {
      const saidHost = controlsPage.querySelector('[data-tree-said]')
      const reply = nodeReplies.get(node.id)
      if (saidHost && reply) saidHost.textContent = reply
    }
  }

  /* THE RAIL FOLLOWS THE CANVAS ACROSS A TREE SWITCH.
   *
   * THE DEFECT, measured on a live drive, 2026-08-18: switch trees and the
   * rail keeps showing the PREVIOUS tree's chat until another circle is
   * pressed. onRootChange repainted the crumb and the switcher and never
   * consulted what the rail was showing, so the two halves of the page told
   * two different stories about which tree the person was in.
   *
   * WHICH TREE IS ON THE CANVAS: the graph's root is a node id, and that
   * node's own record names its tree. A null root is "Every tree" -- every
   * tree is on the canvas, so whatever the rail shows is still there and it
   * stays. A re-root INSIDE the rail's own tree (a drill, a crumb press)
   * keeps the rail too. Only when the rooted node belongs to a different
   * tree -- or to no tree this store knows, which is what a fleet agent's
   * subtree answers -- does the rail return to the overview, the conservative
   * reading: the node it was showing cannot be on that canvas, and pressing
   * its circle again reopens it whole.
   *
   * NOTHING HERE TOUCHES THE CONVERSATION. The chat stays mounted under the
   * now-hidden page exactly as an ordinary Back press leaves it; transcripts,
   * the turn accumulator and the open stream belong to the session layer and
   * are neither read nor written on this path. tools/chat-history-drive.mjs
   * scenarios E and F hold that shut, and
   * tools/test/rail-follows-canvas.test.mjs refuses any such reference in
   * this function's body. */
  function railFollowsCanvas(rootId) {
    if (!rootId || !currentRailTreeNode || !treeStore) return
    if (!controlsPage.classList.contains('is-active')) return
    const canvasTree = treeStore.getNode(rootId)?.treeId ?? null
    const shown = treeStore.getNode(currentRailTreeNode.id)
    const shownTree = shown?.treeId ?? currentRailTreeNode.treeId ?? null
    if (canvasTree !== null && shownTree !== null && canvasTree === shownTree) return
    showStats()
  }

  /* THE REWIND, AS A NAMED FUNCTION. Its rail select retired with the
     Actions tab (iteration 6); the chat popup's rewind stage is the caller
     now. The body is the old handler's, unchanged: engine rewind first,
     then every screen follows the shortened memory. */
  async function performRewind(node, turnId, out) {
    if (!turnId || !node.sessionId) return false
    if (nodeBusy(node)) { if (out) out.textContent = REWIND_PANEL.busy; return false }
    const bridge = typeof window === 'undefined' ? null : window.mcAgent
    if (!bridge || typeof bridge.rewind !== 'function') return false
    let done = null
    let refusal = null
    try { done = await bridge.rewind({ sessionId: node.sessionId, turnId }) } catch (error) { refusal = error; done = null }
    if (!done || done.turnId !== turnId) {
      /* THE REASON RIDES TO THE PERSON. This catch used to drop the error, so a
         Claude session -- whose engine cannot fork and therefore can never
         rewind (CLAUDE_CLI_FORK_UNSUPPORTED) -- drew "Try once more", forever.
         A permanent refusal says what is true and names the door that works. */
      const words = /CLAUDE_CLI_FORK_UNSUPPORTED/.test(String(refusal?.message || '')) ? REWIND_PANEL.cannotFork : REWIND_PANEL.failed
      if (out) out.textContent = words
      return false
    }
    /* The agent's memory now ends at that turn; every screen follows it.
       The transcript restarts from one truthful line, the kept turn log
       truncates to the turns that still exist, and the stored reply goes
       — it may postdate the point the person just erased. */
    const log = sessionTurnLog.get(node.sessionId) || []
    const keptIndex = log.findIndex(entry => entry.turnId === turnId)
    sessionTurnLog.set(node.sessionId, keptIndex >= 0 ? log.slice(0, keptIndex + 1) : [])
    const kept = keptIndex >= 0 ? log[keptIndex] : null
    sessionTranscripts.set(node.sessionId, [{
      who: 'agent',
      text: kept ? `Rewound. I remember everything up to “${kept.yourText.slice(0, 80)}” and nothing after it.` : REWIND_PANEL.done,
      at: Date.now(),
    }])
    /* The durable excerpt follows the erasure — a resume must not replay
       words the person just made the agent forget. */
    persistTranscript(node.sessionId)
    nodeReplies.delete(node.id)
    nodeActivity.delete(node.id)
    if (treeStore) {
      treeStore.setNodeReply(node.id, '')
      treeStore.setNodeStatus(node.id, 'finished', { note: statusNote(REWIND_PANEL.done) })
      refreshTree()
    }
    if (out) out.textContent = REWIND_PANEL.done
    showTreeNodeControls(treeStore ? treeStore.getNode(node.id) || node : node)
    return true
  }

  /* An outcome reporter that survives the popup. The restart verbs (depth,
     resume, start over) rebuild the rail, which disposes the chat and its
     popup mid-flight — so their sentences land on the canvas status line,
     the reporter that outlives every rail rebuild. */
  function statusSink() {
    return {
      get textContent() { return '' },
      set textContent(value) {
        const sentence = String(value || '')
        if (!sentence) return
        setOrgStatus(sentence, sentence === RESUME_PANEL.done || sentence === PALETTE_PANEL.cleared ? 'ok' : 'refuse', { sticky: sentence !== RESUME_PANEL.done && sentence !== PALETTE_PANEL.cleared })
      },
    }
  }

  /* Focus one of the Details tab's setup controls from anywhere. */
  function focusDetailsControl(node, selector) {
    showTreeNodeControls(treeStore ? treeStore.getNode(node.id) || node : node)
    controlsPage.querySelector('[data-rail-tab="details"]')?.click()
    controlsPage.querySelector(selector)?.focus?.()
  }

  /* THE CHAT'S ACTION ROWS — the palette model, re-homed (owner, iteration
     6: "Actions again just shouldnt be its own page it should be a button
     on the chat"). Same honest rules as the page it replaces: every row is
     something this build really performs on this node today, enabled states
     derive from the node, and runPaletteAction stays the single verb
     engine. Depth, model and rewind are two-stage picks inside the popup
     (ctx.show); the warned-restart contract for depth is unchanged — the
     token-cost sentence stands between the pick and the restart. */
  function chatActionRowsFor(node) {
    const fresh = () => (treeStore ? treeStore.getNode(node.id) || node : node)
    const current = fresh()
    const running = nodeBusy(current)
    const reply = nodeReplies.get(current.id) || current.reply || ''
    const sinkFor = ctx => ({
      get textContent() { return '' },
      set textContent(value) { ctx.say(String(value || '')) },
    })
    const currentEffort = () => sessionEfforts.get(fresh().sessionId)
      || transcriptStore?.get(node.id)?.effort || tierEffortOf(current.tier)
    /* THE DEPTHS ARE THE PROVIDER'S, AND SO ARE THEIR WORDS (owner: "there
       are STANDARD per provider effort names. Use those"). The engine's
       model/list reports what THIS model really supports, each with the
       provider's own description — ultra's is "Maximum reasoning with
       automatic task delegation", which is a different agent, not a bigger
       number. The hand-written table is the fallback for an engine too old
       to answer, and it now carries the provider's names too. */
    const effortRows = () => {
      const catalog = engineEffortsFor(fresh())
      const choices = catalog.length > 0 ? catalog : EFFORT_CHOICES.map(choice => ({ id: choice.id, description: choice.description }))
      return choices.map(choice => ({
        id: `effort-${choice.id}`,
        label: choice.id,
        hint: choice.id === currentEffort() ? `${choice.description || ''} · running at this now`.trim() : (choice.description || null),
        current: choice.id === currentEffort(),
        enabled: true,
        run: async ctx => {
          if (choice.id === currentEffort()) { ctx.say(EFFORT_SWITCH.keep); return }
          const live = fresh()
          const bridgeNow = typeof window === 'undefined' ? null : window.mcAgent
          /* THE ENGINE'S OWN KNOB FIRST: a running thread changes depth in
             place — nothing restarts, nothing is re-sent, nothing is
             charged. The restart below is the fallback for a build whose
             engine cannot do it, and only THERE does the token warning
             belong. */
          if (live.sessionId && nodeBusy(live) === false && bridgeNow && typeof bridgeNow.setEffort === 'function') {
            try {
              const changed = await bridgeNow.setEffort({ sessionId: live.sessionId, effort: choice.id })
              if (changed && changed.effort) {
                sessionEfforts.set(live.sessionId, changed.effort)
                ctx.say(EFFORT_SWITCH.changed(changed.effort))
                return
              }
            } catch { /* falls through to the honest restart below */ }
          }
          ctx.show([{
            id: 'effort-go',
            label: EFFORT_SWITCH.go,
            hint: EFFORT_SWITCH.warn,
            enabled: true,
            run: goCtx => {
              goCtx.close()
              void resumeNodeSession(fresh(), { effort: choice.id, out: statusSink() })
            },
          }], { title: choice.id })
        },
      }))
    }
    const modelRows = () => {
      const override = sessionModelOverride.get(fresh().sessionId) || ''
      const keepRow = {
        id: 'model-keep',
        label: MODEL_PANEL.keep,
        hint: MODEL_PANEL.currentDefault,
        current: !override,
        enabled: true,
        run: ctx => {
          sessionModelOverride.delete(fresh().sessionId)
          ctx.say(MODEL_PANEL.currentDefault)
        },
      }
      return [keepRow, ...LAUNCH_TIERS.map(tier => ({
        id: `model-${tier.model}`,
        label: `${tier.label} · ${tier.provider === 'codex' ? 'Codex' : tier.provider === 'claude' ? 'Claude — cannot start here yet' : 'your computer — cannot start here yet'}`,
        hint: null,
        current: override === tier.model,
        enabled: tier.provider === 'codex',
        run: ctx => {
          sessionModelOverride.set(fresh().sessionId, tier.model)
          ctx.say(MODEL_PANEL.next(tier.model))
        },
      }))]
    }
    const rewindRows = () => (sessionTurnLog.get(fresh().sessionId) || []).map(entry => ({
      id: `rewind-${entry.turnId}`,
      label: entry.yourText.slice(0, 80),
      hint: null,
      enabled: true,
      run: ctx => {
        ctx.show([{
          id: 'rewind-go',
          label: REWIND_PANEL.button,
          hint: REWIND_PANEL.help,
          enabled: true,
          run: goCtx => {
            goCtx.close()
            void performRewind(fresh(), entry.turnId, statusSink())
          },
        }], { title: `“${entry.yourText.slice(0, 60)}”` })
      },
    }))
    /* THE REMOVE CONFIRM — the same sub-stage device as rewind's picker: one
       Remove row plus the popup's own Back, with the sentence naming what
       goes (and that the signed run records stay) carried on the row where a
       hint is read and spoken. The popup is closed BEFORE the removal runs,
       because the removal disposes the chat under it. */
    const removeRows = () => [{
      id: 'remove-go',
      label: REMOVE_PANEL.go,
      hint: REMOVE_PANEL.confirm(treeNodeName(fresh())),
      enabled: true,
      run: goCtx => {
        goCtx.close()
        void performNodeRemoval(fresh())
      },
    }]
    /* THE TABLE, GROUPED, EVERY ROW SAYING WHY WHEN IT CANNOT BE PRESSED.
     *
     * The owner's report on this menu: "more like vscode, much more intuitive
     * preferably". Three things were wrong with the list itself, and each is
     * a field on the row now.
     *
     * `group`: eleven rows of mixed severity in source order put "Stop this
     * agent" directly beside "Copy what it said". Three headings, and the one
     * that ends or forgets something is last, on its own.
     *
     * `disabledHint`: a switched-off row rendered its ordinary hint (or
     * nothing) and would not say why it could not be pressed. Every row that
     * can be disabled now carries the sentence for its own state; the popup
     * shows it in place of the hint and speaks it on Enter.
     *
     * THREE DOORS THAT WERE MISSING. Attach an image, mention a file and queue
     * a message are all things this build genuinely does -- their runners were
     * already in runPaletteAction, reachable from the slash commands and the
     * composer's own buttons -- and the menu simply never built the rows. They
     * are rows now. Nothing here adds a power; it adds the way to reach one.
     *
     * A picker needs the installed application, so attach and mention are
     * enabled only where the bridge really offers one, and say so where it does
     * not, rather than sitting enabled over a call that returns nothing. */
    const bridge = typeof window === 'undefined' ? null : window.mcAgent
    const canPick = Boolean(bridge && typeof bridge.pickAttachment === 'function' && typeof bridge.pickMention === 'function')
    const started = Boolean(current.sessionId)
    const pickerWhy = !started ? PALETTE_PANEL.whyNotStarted : (!canPick ? PALETTE_PANEL.whyNoPicker : '')
    const turnsSoFar = (sessionTurnLog.get(current.sessionId) || []).length
    /* Measured 2026-08-18: after a restart the Rewind row said "You have not
       sent it a message yet." beside a panel showing four sent messages.
       turnsSoFar is window memory and resets with the window; the durable
       transcript does not. So the row consults the record before calling the
       conversation empty: rewind still reaches only turns sent since this
       window opened (performRewind needs the live session's turn log), but the
       REASON tells the truth about the saved messages. */
    const savedConversation = transcriptStore ? transcriptStore.get(node.id) : null
    const sentEarlier = Boolean(savedConversation && Array.isArray(savedConversation.lines)
      && savedConversation.lines.some(line => line && line.who === 'you'))
    /* THE REMOVE ROW'S TWO GATES, judged here so the row and the store agree.
       Direct reports first-class: each one is an agent the person moves out
       through the reports-to picker or the drag, and the reason counts them.
       "A run could be behind it" is the node's own live status — busy, or a
       start still in flight with no session id yet. The one exception is a
       record orphaned by shutdown (live status over a session this run cannot
       reach): there is nothing left to stop, so the row stays pressable and
       the run handler lets that dead session go through the store's own
       detach. */
    const childCount = treeStore ? treeStore.childrenOf(current.id).length : 0
    const removeBlockedByRun = (current.status === 'starting' || current.status === 'running') && !nodeSessionEnded(current)
    const conversation = PALETTE_PANEL.groupConversation
    const agent = PALETTE_PANEL.groupAgent
    const danger = PALETTE_PANEL.groupDanger
    return [
      { id: 'queue', group: conversation, label: PALETTE_PANEL.queueFocus, hint: PALETTE_PANEL.queueFocusHint, enabled: true, run: ctx => { ctx.close(); void runPaletteAction('queue', fresh(), statusSink()) } },
      { id: 'attach', group: conversation, label: PALETTE_PANEL.attach, hint: PALETTE_PANEL.attachHint, enabled: started && canPick, disabledHint: pickerWhy, run: ctx => runPaletteAction('attach', fresh(), sinkFor(ctx)) },
      { id: 'mention', group: conversation, label: PALETTE_PANEL.mention, hint: PALETTE_PANEL.mentionHint, enabled: started && canPick, disabledHint: pickerWhy, run: ctx => runPaletteAction('mention', fresh(), sinkFor(ctx)) },
      { id: 'effort', group: conversation, label: EFFORT_SWITCH.title, hint: EFFORT_SWITCH.help, enabled: started, disabledHint: PALETTE_PANEL.whyNotStarted, run: ctx => ctx.show(effortRows(), { title: EFFORT_SWITCH.title }) },
      { id: 'model', group: conversation, label: PALETTE_PANEL.switchModel, hint: PALETTE_PANEL.switchModelHint, enabled: started, disabledHint: PALETTE_PANEL.whyNotStarted, run: ctx => ctx.show(modelRows(), { title: MODEL_PANEL.title }) },
      { id: 'rewind', group: conversation, label: PALETTE_PANEL.rewind, hint: PALETTE_PANEL.rewindHint, enabled: started && turnsSoFar > 0, disabledHint: started ? (sentEarlier ? PALETTE_PANEL.whyOnlySavedTurns : PALETTE_PANEL.whyNoTurns) : PALETTE_PANEL.whyNotStarted, run: ctx => ctx.show(rewindRows(), { title: REWIND_PANEL.title }) },
      { id: 'copy-brief', group: conversation, label: PALETTE_PANEL.copyBrief, hint: '', enabled: Boolean(current.message), disabledHint: PALETTE_PANEL.whyNoBrief, run: ctx => runPaletteAction('copy-brief', fresh(), sinkFor(ctx)) },
      { id: 'copy-reply', group: conversation, label: PALETTE_PANEL.copyReply, hint: '', enabled: Boolean(reply), disabledHint: PALETTE_PANEL.whyNoReply, run: ctx => runPaletteAction('copy-reply', fresh(), sinkFor(ctx)) },
      { id: 'child', group: agent, label: PALETTE_PANEL.child, hint: PALETTE_PANEL.childHint, enabled: true, run: ctx => { ctx.close(); openComposeFor({ kind: 'child', parentId: node.id }) } },
      { id: 'move', group: agent, label: PALETTE_PANEL.moveFocus, hint: PALETTE_PANEL.moveFocusHint, enabled: true, run: ctx => { ctx.close(); focusDetailsControl(node, '[data-tree-move-select]') } },
      /* Enabled exactly when it can act: a saved conversation exists and no
         session is mid-turn over it. A running agent is resumed by talking
         to it, not by restarting it out from under itself. */
      { id: 'resume', group: agent, label: RESUME_PANEL.action, hint: RESUME_PANEL.hint, enabled: !running && Boolean(transcriptStore && transcriptStore.has(node.id)), disabledHint: running ? RESUME_PANEL.busy : PALETTE_PANEL.whyNoSaved, run: ctx => { ctx.close(); void resumeNodeSession(fresh(), { out: statusSink() }) } },
      { id: 'interrupt', group: danger, label: PALETTE_PANEL.interrupt, hint: PALETTE_PANEL.interruptHint, enabled: running, disabledHint: PALETTE_PANEL.whyNotRunning, run: ctx => runPaletteAction('interrupt', fresh(), sinkFor(ctx)) },
      { id: 'stop', group: danger, label: PALETTE_PANEL.stop, hint: PALETTE_PANEL.stopHint, enabled: running, disabledHint: PALETTE_PANEL.whyNotRunning, run: ctx => runPaletteAction('stop', fresh(), sinkFor(ctx)) },
      { id: 'clear', group: danger, label: PALETTE_PANEL.clear, hint: PALETTE_PANEL.clearHint, enabled: started, disabledHint: PALETTE_PANEL.whyNotStarted, run: ctx => { ctx.close(); void runPaletteAction('clear', fresh(), statusSink()) } },
      /* LAST ON PURPOSE: the one row that ends an agent for good closes the
         destructive group. Its two reasons are the store's own refusals, in
         the design's order — a live run first, then the agents underneath. */
      { id: 'remove', group: danger, label: REMOVE_PANEL.action, hint: REMOVE_PANEL.hint, enabled: !removeBlockedByRun && childCount === 0, disabledHint: removeBlockedByRun ? REMOVE_PANEL.whyRunning : (childCount > 0 ? REMOVE_PANEL.whyChildren(childCount) : ''), run: ctx => ctx.show(removeRows(), { title: REMOVE_PANEL.action }) },
    ]
  }

  /* RESUME, AND EVERY SWITCH THAT IS HONESTLY A RESTART (iteration 5 W7 and
     W10's mid-session half). One flow serves three presses — Resume on a dead
     session, "restart at this depth", "restart in the new folder" — because
     they are the same true mechanism: close whatever is left, start a fresh
     session with the CURRENT tier, depth, and tree profile, and make its
     first message the saved conversation so the new agent picks up where the
     old one stood. The words a person saved are never deleted here; a resume
     that fails leaves the excerpt exactly as it was.

     A node that never spoke resumes as a bare restart (clear-shaped, brief
     NOT re-sent) — there is nothing to read, and re-running the original ask
     uninvited could redo real work. */
  /* `deliverQueued` is false for exactly one caller: the dead-session recovery
     below, which is holding a message of its own and sends it itself. Two
     senders on one idle agent would race, and the engine refuses the loser. */
  async function resumeNodeSession(node, { effort = null, out = null, deliverQueued = true } = {}) {
    const bridge = typeof window === 'undefined' ? null : window.mcAgent
    if (!bridge || typeof bridge.start !== 'function') {
      if (out) out.textContent = START_NEEDS_APP_TEXT
      return false
    }
    /* A resume IS a start -- bridge.start, a real child process -- so the same
       switch decides it. Gating only the compose panel would leave "nothing
       here will start an agent" true of the dashed circle and false of every
       node already on the canvas. */
    if (!isWriteEnabled(START_CONTROL_FLAG)) {
      if (out) out.textContent = startControlOffReason()
      return false
    }
    const oldSessionId = node.sessionId || null
    const profileId = treeStore && node.treeId ? treeStore.treeProfile(node.treeId) : null
    const saved = transcriptStore ? transcriptStore.get(node.id) : null
    const savedLines = saved && Array.isArray(saved.lines) ? saved.lines : []
    /* The depth to resume at: the person's pick first, then whatever the
       session runs at now, then the depth the RECORD remembers (the live map
       is empty after an app restart — the record is why a hand-picked depth
       survives one), then the tier's own default. */
    const chosenEffort = effort
      || (oldSessionId ? sessionEfforts.get(oldSessionId) : null)
      || (saved && saved.effort) || tierEffortOf(node.tier)
    if (oldSessionId) {
      if (typeof bridge.close === 'function') {
        try { await bridge.close({ sessionId: oldSessionId }) }
        catch { /* an already-dead session is the expected state here */ }
      }
      /* THE WAITING WORDS ARE NOT THROWN AWAY HERE. This used to clear the old
         session's outbox, which deleted every queued message the composer had
         already promised to send -- silently, in the middle of an action the
         person took to get that very agent BACK. The queue is
         left standing and moved to the new session below, once there is one;
         a resume that fails leaves it exactly where it was, beside the
         conversation it belongs to. */
      sessionTranscripts.delete(oldSessionId)
      sessionTurnLog.delete(oldSessionId)
      sessionUsage.delete(oldSessionId)
      sessionModelOverride.delete(oldSessionId)
      sessionPendingImages.delete(oldSessionId)
      sessionNodeIds.delete(oldSessionId)
      sessionEfforts.delete(oldSessionId)
      sessionThreadIds.delete(oldSessionId)
    }
    let result
    let engineResumed = null
    /* THE REAL THING FIRST: codex keeps the conversation on disk, so the
       agent can continue ITS OWN memory instead of being handed a summary.
       No seed message, nothing re-sent, nothing charged. The excerpt path
       below stays exactly as it was, for a thread codex no longer has (it
       was pruned, the app moved machines, or the engine is older than the
       resume wiring) — and for a node that never got a thread id at all. */
    const savedThreadId = saved && typeof saved.threadId === 'string' && saved.threadId ? saved.threadId : null
    if (savedThreadId) {
      let started = null
      try {
        started = await bridge.start({
          surface: 'fleet-tree',
          resumeThreadId: savedThreadId,
          ...(node.tier ? { tier: node.tier } : {}),
          ...(chosenEffort ? { effort: chosenEffort } : {}),
          ...(profileId ? { profileId } : {}),
          /* A RESUME CARRIES THE KEYS TOO — the standing-request block rides
             the resumed session's first turn, because a restart is exactly
             when a thread rule must be re-asserted. */
          requestKeys: nodeRequestKeys(node),
        })
      } catch { started = null }
      if (started && typeof started.sessionId === 'string' && started.sessionId) {
        engineResumed = started.resumed || { turns: [], turnCount: 0 }
        result = { ok: true, sessionId: started.sessionId, threadId: started.threadId || savedThreadId, sentence: null }
        if (typeof started.effort === 'string' && started.effort) sessionEfforts.set(started.sessionId, started.effort)
      }
    }
    if (result) {
      /* nothing further: the engine restored the conversation itself */
    } else if (savedLines.length > 0) {
      result = await startAgentForNode({
        text: transcriptSeedText(savedLines),
        surface: 'fleet-tree',
        tier: node.tier,
        effort: chosenEffort,
        profileId,
        requestKeys: nodeRequestKeys(node),
        /* Bound before the seed is sent, for the reason startAgentForNode's
           note gives: a turn that starts answering before the send is answered
           would otherwise arrive for a session this page has never heard of.
           The block below sets the same key again, which costs nothing. */
        onSessionOpen: ({ sessionId }) => { sessionNodeIds.set(sessionId, node.id) },
      })
    } else {
      let started = null
      try {
        started = await bridge.start({
          surface: 'fleet-tree',
          ...(node.tier ? { tier: node.tier } : {}),
          ...(chosenEffort ? { effort: chosenEffort } : {}),
          ...(profileId ? { profileId } : {}),
          requestKeys: nodeRequestKeys(node),
        })
      } catch { started = null }
      result = started && typeof started.sessionId === 'string' && started.sessionId
        ? { ok: true, sessionId: started.sessionId, threadId: typeof started.threadId === 'string' && started.threadId ? started.threadId : null, sentence: null }
        : { ok: false, sessionId: null, threadId: null, sentence: null }
    }
    if (destroyed) return false
    if (!result.ok || !result.sessionId) {
      if (treeStore) {
        treeStore.setNodeStatus(node.id, 'failed', { note: statusNote(result.sentence || RESUME_PANEL.failed) })
        refreshTree()
      }
      if (out) out.textContent = result.sentence || RESUME_PANEL.failed
      return false
    }
    sessionNodeIds.set(result.sessionId, node.id)
    /* The messages that were waiting for the old session are waiting for this
       one: same node, same conversation, same person still expecting them to
       go. Drained by the turn-completed listener like any other queued
       message -- or immediately below, when the agent came back idle and there
       is no turn for them to wait behind. */
    const carriedForward = oldSessionId ? outboxMoveSession(oldSessionId, result.sessionId) : 0
    if (chosenEffort) sessionEfforts.set(result.sessionId, chosenEffort)
    if (result.threadId) sessionThreadIds.set(result.sessionId, result.threadId)
    /* THE CONVERSATION ON SCREEN COMES FROM THE ENGINE WHEN THE ENGINE HAS
       IT. A real resume hands back the thread's own turns — that is the
       authoritative record, and it can be longer and truer than the excerpt
       we kept. The excerpt is used only when the engine could not restore
       the thread, where it is followed by the marker line saying a fresh
       agent read it. */
    const engineLines = engineResumed
      ? engineResumed.turns.flatMap(turn => (turn.said || []).map(line => ({ who: line.who, text: line.text, at: null })))
      : []
    if (engineLines.length > 0) {
      sessionTranscripts.set(result.sessionId, engineLines)
    } else if (savedLines.length > 0) {
      sessionTranscripts.set(result.sessionId, engineResumed
        ? savedLines
        : [...savedLines, { who: 'you', text: RESUME_PANEL.marker, at: Date.now() }])
    } else {
      /* THE THIRD BRANCH -- a plain start, with no engine thread to restore and
         nothing saved to seed from -- set NOTHING, and every later reader had
         to guess what that absence meant. It means this conversation begins
         empty, which is a decision, so it is recorded as one: transcriptAppend
         seeds an unheld session from the durable record, and a session left
         absent here would have been re-seeded from a record this start already
         chose not to use. */
      sessionTranscripts.set(result.sessionId, [])
    }
    nodeActivity.delete(node.id)
    if (treeStore) {
      treeStore.attachSession(node.id, result.sessionId)
      /* An engine-resumed agent is IDLE and waiting — it has its memory and
         was asked nothing. A seeded one is mid-turn, reading the summary. */
      const status = engineResumed ? 'finished' : (savedLines.length > 0 ? 'running' : 'finished')
      treeStore.setNodeStatus(node.id, status, { note: statusNote(engineResumed ? RESUME_PANEL.continued : RESUME_PANEL.done) })
      refreshTree()
    }
    persistTranscript(result.sessionId)
    /* AN IDLE AGENT HAS NO TURN FOR THE QUEUE TO WAIT BEHIND. The drain is
       normally the turn-completed listener's job, because that is the engine's
       only "I am free" signal -- but an engine-resumed agent came back with its
       memory and was asked nothing, so no completion is coming and the words
       would sit there forever. Exactly one goes; its completion drains the
       next, through the one drain site every queued message uses. */
    if (deliverQueued && carriedForward > 0 && engineResumed) {
      const nextQueued = outboxTakeNext(result.sessionId)
      if (nextQueued) void drainOutboxMessage(result.sessionId, node.id, nextQueued)
    }
    if (out) out.textContent = engineResumed ? RESUME_PANEL.continued : RESUME_PANEL.done
    if (controlsPage.classList.contains('is-active') && currentRailTreeNode && currentRailTreeNode.id === node.id) {
      showTreeNodeControls(treeStore ? treeStore.getNode(node.id) || node : node)
    }
    /* The caller needs to know WHICH resume happened: an engine-resumed
       session is idle and takes the person's message directly, while a
       seeded one is busy reading and must queue it. */
    return engineResumed ? 'engine' : true
  }

  async function runPaletteAction(id, node, out) {
    const bridge = typeof window === 'undefined' ? null : window.mcAgent
    if (id === 'child') {
      openComposeFor({ kind: 'child', parentId: node.id })
      return
    }
    /* The four navigational verbs, retargeted for the popup era (iteration
       6): model and rewind open the chat's actions popup straight at their
       stage; queue focuses the composer (the composer IS the queue while
       the agent works); move focuses the Details tab's Reports-to menu. */
    if (id === 'queue') {
      showTreeNodeControls(node)
      controlsPage.querySelector('[data-rail-chat-host] .chat-input input')?.focus?.()
      return
    }
    if (id === 'move') {
      focusDetailsControl(node, '[data-tree-move-select]')
      return
    }
    if (id === 'switch-model' || id === 'rewind') {
      showTreeNodeControls(node)
      railChat?.root?.openActions?.(id === 'rewind' ? 'rewind' : 'model')
      return
    }
    if (id === 'attach') {
      if (!bridge || typeof bridge.pickAttachment !== 'function' || !node.sessionId) return
      let picked = null
      try { picked = await bridge.pickAttachment({ sessionId: node.sessionId }) } catch { picked = null }
      if (!picked || !picked.path) { out.textContent = PALETTE_PANEL.attachCancelled; return }
      const held = sessionPendingImages.get(node.sessionId) || []
      held.push({ path: picked.path })
      sessionPendingImages.set(node.sessionId, held.slice(0, 8))
      out.textContent = PALETTE_PANEL.attachPicked
      return
    }
    if (id === 'clear') {
      if (!bridge || typeof bridge.start !== 'function' || typeof bridge.close !== 'function' || !node.sessionId) return
      /* "Start over" closes one session and starts another, so it is a start
         and the same switch decides it. */
      if (!isWriteEnabled(START_CONTROL_FLAG)) { out.textContent = startControlOffReason(); return }
      const oldSessionId = node.sessionId
      /* Read before the wipe below erases them: the fresh session keeps the
         depth this one ran at, and the folder its tree is assigned to. */
      const keptEffort = sessionEfforts.get(oldSessionId) || tierEffortOf(node.tier)
      const keptProfile = treeStore && node.treeId ? treeStore.treeProfile(node.treeId) : null
      try { await bridge.close({ sessionId: oldSessionId }) }
      catch { /* an already-closed session is the goal state */ }
      outboxClearSession(oldSessionId)
      sessionTranscripts.delete(oldSessionId)
      sessionTurnLog.delete(oldSessionId)
      sessionUsage.delete(oldSessionId)
      sessionModelOverride.delete(oldSessionId)
      sessionPendingImages.delete(oldSessionId)
      sessionNodeIds.delete(oldSessionId)
      sessionEfforts.delete(oldSessionId)
      sessionThreadIds.delete(oldSessionId)
      /* "Start over" means the words are gone — the durable excerpt goes with
         the window's copy, or Resume would offer a past the person erased. */
      transcriptStore?.remove(node.id)
      let started = null
      try {
        /* A start WITHOUT the brief re-sent: re-running the original ask
           uninvited could redo real work. The brief stays on the node; the
           fresh session waits for whatever the person says next. */
        started = await bridge.start({
          surface: 'fleet-tree',
          ...(node.tier ? { tier: node.tier } : {}),
          ...(keptEffort ? { effort: keptEffort } : {}),
          ...(keptProfile ? { profileId: keptProfile } : {}),
        })
      } catch {
        started = null
      }
      if (!started || typeof started.sessionId !== 'string' || !started.sessionId) {
        if (treeStore) {
          treeStore.setNodeStatus(node.id, 'failed', { note: statusNote(PALETTE_PANEL.clearFailed) })
          refreshTree()
        }
        out.textContent = PALETTE_PANEL.clearFailed
        return
      }
      sessionNodeIds.set(started.sessionId, node.id)
      sessionEfforts.set(started.sessionId, keptEffort)
      if (typeof started.threadId === 'string' && started.threadId) sessionThreadIds.set(started.sessionId, started.threadId)
      nodeReplies.delete(node.id)
      nodeActivity.delete(node.id)
      if (treeStore) {
        treeStore.attachSession(node.id, started.sessionId)
        treeStore.setNodeReply(node.id, '')
        treeStore.setNodeStatus(node.id, 'finished', { note: statusNote(PALETTE_PANEL.cleared) })
        refreshTree()
      }
      out.textContent = PALETTE_PANEL.cleared
      if (controlsPage.classList.contains('is-active') && currentRailTreeNode && currentRailTreeNode.id === node.id) {
        showTreeNodeControls(treeStore ? treeStore.getNode(node.id) || node : node)
      }
      return
    }
    if (id === 'resume') {
      /* nodeBusy, not the saved status. "It is busy, wait" over a session that
         died with the last shutdown is the refusal that left a person with no
         way out of this node at all: Resume refused for being busy, Stop
         standing over a corpse. */
      if (nodeBusy(node)) { out.textContent = RESUME_PANEL.busy; return }
      if (!transcriptStore || !transcriptStore.has(node.id)) { out.textContent = RESUME_PANEL.nothing; return }
      await resumeNodeSession(node, { out })
      return
    }
    if (id === 'mention') {
      if (!bridge || typeof bridge.pickMention !== 'function' || !node.sessionId) return
      let picked = null
      try { picked = await bridge.pickMention({ sessionId: node.sessionId }) } catch { picked = null }
      /* ITS OWN SENTENCE. This branch used to reuse the attach branch's cancel
         line, "Nothing was attached.", which is true of a different action. A
         person who had just pressed Mention and closed the picker read a
         sentence about Attach. */
      if (!picked || !picked.path) { out.textContent = PALETTE_PANEL.mentionCancelled; return }
      showTreeNodeControls(node)
      /* Into the chat composer — the queue box retired with the Actions
         tab; the composer is where a mention's path belongs now. */
      const input = controlsPage.querySelector('[data-rail-chat-host] .chat-input input')
      if (input) {
        input.value = input.value ? `${input.value} ${picked.path}` : `Read ${picked.path} and use it for what I ask next.`
        input.focus()
      }
      out.textContent = PALETTE_PANEL.mentionWritten
      return
    }
    if (id === 'copy-brief' || id === 'copy-reply') {
      const text = id === 'copy-brief' ? (node.message || '') : (nodeReplies.get(node.id) || node.reply || '')
      if (!text) { out.textContent = PALETTE_PANEL.nothingToCopy; return }
      try {
        await navigator.clipboard.writeText(text)
        out.textContent = PALETTE_PANEL.copied
      } catch {
        out.textContent = PALETTE_PANEL.clipboardRefused
      }
      return
    }
    if (id === 'interrupt') {
      if (!bridge || typeof bridge.interrupt !== 'function' || !node.sessionId) return
      try {
        await bridge.interrupt({ sessionId: node.sessionId })
        /* Recorded only once the engine ACCEPTED the interrupt, so the
           completion that follows can say "stopped by you" instead of "the
           last turn failed". The missed path below records nothing: there was
           no running turn, so nothing that completes next was stopped. */
        sessionsInterrupted.add(node.sessionId)
        out.textContent = PALETTE_PANEL.interruptDone
      } catch {
        /* AGENT_TURN_NONE and its siblings all mean the same observable thing
           here: there was no running turn left to stop. */
        out.textContent = PALETTE_PANEL.interruptMissed
      }
      return
    }
    if (id === 'stop') {
      if (!bridge || typeof bridge.close !== 'function' || !node.sessionId) return
      try { await bridge.close({ sessionId: node.sessionId }) }
      catch { /* an already-closed session is the goal state */ }
      const dropped = outboxClearSession(node.sessionId)
      if (treeStore) {
        treeStore.setNodeStatus(node.id, 'finished', { note: 'Stopped by you.' })
        refreshTree()
      }
      out.textContent = dropped > 0
        ? `${PALETTE_PANEL.stopped} ${dropped} queued message${dropped === 1 ? ' was' : 's were'} dropped.`
        : PALETTE_PANEL.stopped
    }
  }

  /* THE REMOVAL — the missing leg of the tree verbs (owner finding, verbatim:
   * "there was also no way to remove an old node you wanted to delete").
   *
   * WHAT GOES AND WHAT STAYS IS A FIXED CONTRACT, the one the confirm stage
   * just read out. Goes: the node's record in the tree store (its tree too,
   * when it was the last agent in it), the durable conversation for the node
   * — through session-transcript-store's OWN remove(), never a hand on its
   * key — and this window's node- and session-keyed caches, so no ghost
   * reply can resurface on a later node. Stays: the signed run records. They
   * are the permanent record of what ran on this machine and nothing on this
   * path reaches them.
   *
   * THE STORE IS THE GATE, NOT THIS FUNCTION. removeNode() refuses a live
   * agent and a parent with agents under it, in the same exported sentences
   * the palette row shows — so the re-check here on a race (a queued message
   * put the agent back to work while the confirm stage sat open) speaks the
   * store's words, and any store refusal is reported as it came. The only
   * session this function closes is the removed node's own reachable one; a
   * record orphaned by shutdown is let go through detachSession, the store's
   * documented verb for exactly that state. */
  async function performNodeRemoval(node) {
    if (!treeStore) return false
    const live = treeStore.getNode(node.id) || node
    if (nodeBusy(live)) {
      setOrgStatus(NODE_REMOVE_REFUSALS.running, 'refuse', { sticky: true })
      return false
    }
    const name = treeNodeName(live)
    const sessionId = live.sessionId || null
    if (sessionId) {
      if (nodeSessionLive(live)) {
        const bridge = typeof window === 'undefined' ? null : window.mcAgent
        if (bridge && typeof bridge.close === 'function') {
          try { await bridge.close({ sessionId }) }
          catch { /* an already-closed session is the goal state */ }
        }
      }
      if (live.status === 'starting' || live.status === 'running') treeStore.detachSession(live.id)
    }
    const result = treeStore.removeNode(live.id)
    if (!result.ok) {
      setOrgStatus(result.problems[0] || REMOVE_PANEL.notRemoved, 'refuse', { sticky: true })
      return false
    }
    /* The durable conversation leaves through the store's own door. */
    transcriptStore?.remove(live.id)
    /* This window's caches — node-keyed, then everything keyed by the session
       the node held, so nothing can deliver into a record that is gone. */
    nodeReplies.delete(live.id)
    nodeActivity.delete(live.id)
    if (sessionId) {
      outboxClearSession(sessionId)
      sessionTranscripts.delete(sessionId)
      sessionTurnLog.delete(sessionId)
      sessionTurnText.delete(sessionId)
      sessionUsage.delete(sessionId)
      sessionModelOverride.delete(sessionId)
      sessionPendingImages.delete(sessionId)
      sessionPendingApprovals.delete(sessionId)
      sessionsInterrupted.delete(sessionId)
      sessionNodeIds.delete(sessionId)
      sessionEfforts.delete(sessionId)
      sessionThreadIds.delete(sessionId)
      sessionActions.delete(sessionId)
      chatSurfaces.delete(sessionId)
      turnReplies.delete(sessionId)
    }
    /* The canvas repaints without the node. A drill rooted AT it re-roots on
       its parent — the removed node is always a leaf here — or zooms out when
       it stood alone. */
    if (graph && graph.rootId === live.id) {
      if (live.parentId) graph.setRoot?.(live.parentId)
      else graph.clearRoot?.()
    }
    refreshTree()
    /* The rail: railFollowsCanvas's conservative answer, for the same reason —
       the node it was showing cannot be on any canvas now, so back to the
       overview. */
    if (currentRailTreeNode && currentRailTreeNode.id === live.id && controlsPage.classList.contains('is-active')) {
      showStats()
    }
    setOrgStatus(REMOVE_PANEL.done(name), 'ok')
    return true
  }

  function showControls(agent) {
    if (liveMode) {
      showProjectionControls(agent)
      return
    }
    clearBoard()
    const role = ROLES[agent.role] || ROLES.default
    controlsPage.style.setProperty('--rc', role.hex)
    /* DISPOSE BEFORE THE WIPE. The rule is stated where railChat is declared
       -- never innerHTML over a mounted chat -- and only showTreeNodeControls
       obeyed it. After any of the other three rebuilds, railChat survived
       pointing at a DETACHED root whose sessionId still matched, so the event
       listener kept opening streams and pushing every delta into a chat log
       that was no longer in the document: the answer was recorded and never
       seen (owner, 2026-08-18, "the messages in history disappear"). It also
       leaked that chat's observers, frames and timers. */
    disposeRailSaid()
    disposeRailChat()
    controlsPage.innerHTML = `
      ${railTitleRow({ back: { aria: 'Back to statistics' }, title: 'Agent Controls' })}
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

  /**
   * THE FOUR ANSWERS TO "HOW DOES WORK GET STARTED FROM THIS COMPUTER",
   * MOUNTED ON EVERY RAIL THAT IS ENTITLED TO THEM.
   *
   * WHAT WAS MEASURED, 2026-08-18, on a staged packaged build with a sterile
   * profile, driving with real input:
   *
   *   fleet page, nothing started        .static-tree-node 0, one empty slot
   *   press the slot, pick a role,       a node appears (status "did not start"
   *     write a brief, press Start       -- the engine is signed out) and its
   *                                      rail carries What it is doing / The
   *                                      conversation / Setup and NOTHING ELSE
   *   agent page, press Start            session opens; navigate to the fleet
   *                                      page and the surface's own teardown
   *                                      has closed it again, by design
   *
   * So the projection rail -- the ONLY builder of Launch, Team, Loop and Codex
   * Cloud -- was reached by selecting a node that is drawn only for a LIVE
   * session on a declared seat, and a live session cannot outlive the page that
   * owns it (src/agent-session.js's teardown calls publishLiveSession(null), and
   * src/agent-session-registry.js explains why it must). Those four controls
   * were therefore unreachable on every install, in every state, for anyone.
   * Four packaged drivers had been reporting it from four directions:
   * team-panel ("clicking an agent opens the rail board: absent"), loop, the
   * live half of example-page-write-fence, and refusal-copy's three
   * "UNMEASURED -- the control could not be reached".
   *
   * THE RAIL A PERSON ACTUALLY REACHES IS THE TREE NODE'S. That is the node the
   * fleet page's own start path creates, it is on the board that reads THIS
   * computer, and it is absent from the example board by construction --
   * graphComputer() returns the untouched example computer when the page is not
   * live, so no tree node and no empty slot can appear there. The fence
   * tools/example-page-write-fence-qa measures is structural, not a flag, and it
   * still holds: the example rail goes through showControls(), which builds
   * exampleControlsAbsentBox() and never calls this function.
   *
   * `live: true` is stated HERE and nowhere else, for the reason it was stated
   * on the projection rail: only a rail reading this computer may build a
   * control that reaches the audited bridge. One builder for both rails, so the
   * entitlement rule has one place to be right and the two rails cannot drift
   * into offering different controls for the same computer.
   */
  /* Remembered posture, not a setting. src/settings-presentation.js already
     ruled on this shape for its own open-groups memory: it "grants nothing,
     gates nothing, and the settings footer does not count it". Whether a person
     left a disclosure open is a scroll position, not a permission. */
  const START_WORK_OPEN_KEY = 'mc.rail.start-work-open'
  const startWorkWasOpen = () => {
    try { return localStorage.getItem(START_WORK_OPEN_KEY) === 'open' } catch { return false }
  }
  const rememberStartWork = open => {
    try { localStorage.setItem(START_WORK_OPEN_KEY, open ? 'open' : 'closed') } catch { /* session-only is still a real change */ }
  }

  function mountStartWorkControls(agent, slot) {
    if (!slot) return
    /* ONE GROUP, FOUR PANELS, NOTHING REMOVED. See START_WORK_GROUP in
       src/fleet-tree-copy.js for what was measured and why these four belong
       together. The button is a real button with aria-expanded and a chevron,
       and it names all four panels on its own line -- a disclosure a person
       cannot identify is worse than the scroll it saved. */
    const open = startWorkWasOpen()
    const bodyId = `start-work-${Math.random().toString(36).slice(2, 9)}`
    const group = el(`
      <div class="board-box board-ctl-box rail-group" data-start-work-group>
        <button class="rail-group-toggle" type="button" data-start-work-toggle aria-expanded="${open ? 'true' : 'false'}" aria-controls="${bodyId}">
          <span class="rail-group-chev" aria-hidden="true">⌄</span>
          <span class="rail-group-name">
            <span class="bh-t">${escapeMarkup(START_WORK_GROUP.title)}</span>
            <span class="board-cap">${escapeMarkup(START_WORK_GROUP.contents)}</span>
          </span>
        </button>
        <div class="rail-group-body" id="${bodyId}" data-start-work-body${open ? '' : ' hidden'}></div>
      </div>`)
    slot.replaceWith(group)
    const body = group.querySelector('[data-start-work-body]')
    const toggle = group.querySelector('[data-start-work-toggle]')
    toggle.setAttribute('aria-label', open ? START_WORK_GROUP.collapseLabel : START_WORK_GROUP.expandLabel)

    /* THE FOUR ARE BUILT AND MOUNTED EITHER WAY, open or closed. Building them
       lazily on first press would mean the live updaters that query these boxes
       find nothing until somebody presses, and a control that exists only after
       a gesture is the defect this rail already has a comment about. `hidden`
       is a paint decision; the boxes are real from the moment the rail is. */
    const launchBox = launchControlsBox(agent, { live: true })
    body.appendChild(launchBox)
    const teamBox = teamControlsBox(agent, { live: true })
    body.appendChild(teamBox)
    const loopBox = loopControlsBox(agent, { live: true })
    body.appendChild(loopBox)
    /* Codex Cloud sits with Launch, Team and Loop because it is the fourth
       answer to the same question -- how does work get started from this
       computer -- and the first one whose answer is "somewhere else". */
    boardCloudBox = cloudControlsBox()
    body.appendChild(boardCloudBox)

    toggle.addEventListener('click', () => {
      const nowOpen = toggle.getAttribute('aria-expanded') !== 'true'
      toggle.setAttribute('aria-expanded', nowOpen ? 'true' : 'false')
      toggle.setAttribute('aria-label', nowOpen ? START_WORK_GROUP.collapseLabel : START_WORK_GROUP.expandLabel)
      body.hidden = !nowOpen
      rememberStartWork(nowOpen)
    })
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
    /* DISPOSE BEFORE THE WIPE. The rule is stated where railChat is declared
       -- never innerHTML over a mounted chat -- and only showTreeNodeControls
       obeyed it. After any of the other three rebuilds, railChat survived
       pointing at a DETACHED root whose sessionId still matched, so the event
       listener kept opening streams and pushing every delta into a chat log
       that was no longer in the document: the answer was recorded and never
       seen (owner, 2026-08-18, "the messages in history disappear"). It also
       leaked that chat's observers, frames and timers. */
    disposeRailSaid()
    disposeRailChat()
    controlsPage.innerHTML = `
      ${railTitleRow({ back: { aria: 'Back to the fleet overview' }, title: 'Recorded agent' })}
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
    mountStartWorkControls(agent, controlsPage.querySelector('.board-launch-slot'))
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
    /* There is no computer on this screen any more, so there is nothing for an
       open compose panel to start an agent ON. Leaving it would offer a form
       whose submit could only refuse. */
    closeComposePanel()
    releaseTreeStore()
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
      ${railTitleRow({ title: 'Runtime Statistics' })}
      <div class="projection-unavailable" data-live-mode="live" data-projection-state="${loading ? 'loading' : 'unavailable'}">${loading ? 'Reading your fleet…' : `The live fleet data could not be read · ${escapeMarkup(reason)}`}</div>
      ${loading ? '' : `<div class="rail-scroll rail-org-only">${orgSourceMarkup()}<div class="board-org-slot"></div></div>`}`
    /* DISPOSE BEFORE THE WIPE. The rule is stated where railChat is declared
       -- never innerHTML over a mounted chat -- and only showTreeNodeControls
       obeyed it. After any of the other three rebuilds, railChat survived
       pointing at a DETACHED root whose sessionId still matched, so the event
       listener kept opening streams and pushing every delta into a chat log
       that was no longer in the document: the answer was recorded and never
       seen (owner, 2026-08-18, "the messages in history disappear"). It also
       leaked that chat's observers, frames and timers. */
    disposeRailSaid()
    disposeRailChat()
    controlsPage.innerHTML = ''
    activateRail(statsPage)
    if (!loading) mountOrgLibrary(statsPage.querySelector('.board-org-slot'))

    clearEmptyPanel()
    if (loading) return
    /* The words are src/first-run-needs.js's, not this file's — see the import.
       `reasonClass` keeps `.graph-empty-reason`, which tools/agent-route-reachability.mjs
       reads: dropping the class would not fail that probe, it would make the
       probe quietly record an empty string, which is worse. The reason itself
       is still the projection's own sentence, verbatim. */
    emptyPanel = el(`
      <div class="graph-empty" data-projection-state="unavailable">
        ${hostAbsentMarkup(`The live fleet data could not be read · ${reason}`, { reasonClass: 'graph-empty-reason' })}
        ${emptyStateExample()}
      </div>`)
    /* THE SLOT, NOT THE WRAP — and this line THREW for as long as the graph bar
       has existed.
     *
     * What stood here was `graphWrap.insertBefore(emptyPanel, graphTitle)`, and
     * `.graph-title` has not been a child of `.graph-wrap` since the title, the
     * tree switcher and the tool buttons were gathered into `.graph-bar` (see
     * the markup above). It is a GRANDCHILD, so the browser answered
     * `NotFoundError: Failed to execute 'insertBefore' on 'Node': The node
     * before which the new node is to be inserted is not a child of this node.`
     *
     * MEASURED, 2026-08-18, on a staged packaged build: the throw is raised
     * inside loadProjection()'s `.then`, which sends it to the `.catch` beside
     * it, which calls this same function again, which throws again — an
     * unhandled rejection and NOT ONE WORD PAINTED. This is the branch a fresh
     * customer install reaches every time (public/data/fleet.json ships
     * `ok:false`), so the person whose fleet could not be read was shown a blank
     * area where the sentence explaining that was supposed to be, plus the
     * example that tells them what the page is for.
     *
     * The canvas slot is where the CANVAS goes (mountProjection, above), which
     * is exactly what the declaration of `emptyPanel` promises: "It occupies the
     * same slot the graph canvas does, so the two can never be on screen
     * together." Same slot, same prepend, one rule. */
    graphWrap.querySelector('.graph-canvas-slot').prepend(emptyPanel)
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
        const declared = orgReady() ? declaredFleetData(orgAvailability.org, readLiveSession()) : null
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

  /* A SESSION THAT STARTS WHILE THIS PAGE IS OPEN IS DRAWN WITHOUT A RELOAD.
   *
   * Reading readLiveSession() at the two projection sites is enough for the
   * ordinary journey -- start on the agent page, navigate back, loadProjection()
   * reads the record fresh. It is NOT enough for a session that begins or ends
   * while the fleet page is on screen, and that case is real: the rail's own
   * chat and the compose panel both live here, and the agent page can be open in
   * a second window against the same renderer registry.
   *
   * IT REDRAWS ON THE SET, NOT ON THE PHASE. The registry publishes on every
   * transition (starting -> open -> working -> stopping), and reprojecting on
   * each of those would rebuild the canvas four times for one start -- the node
   * reshuffle src/declared-fleet.js keeps declared order to avoid, done to the
   * whole graph. The only thing that changes what is DRAWN is which agent has a
   * session, so that is what is compared. */
  let lastStartedAgentId = readLiveSession()?.agentId ?? null
  unsubs.push(onLiveSession(record => {
    const agentId = record?.agentId ?? null
    if (agentId === lastStartedAgentId) return
    lastStartedAgentId = agentId
    if (destroyed || !liveMode || !declaredOnlyReason || !orgReady()) return
    reprojectFromOrg()
  }))

  loadRailRuns()
  /* THE COMPACT CARD'S SEND. Busy agent: the words join the queue and the
     card says so — the same one-turn-at-a-time truth the engine enforces.
     Idle agent: the words go now, the node returns to running, and the
     card's reply slot waits for the turn to complete. Either way nothing is
     fabricated: the card only ever shows what was sent and what came back. */
  /* The approval card: mounted into the controls page only while a request is
     pending, torn down by its own answer. The details a person needs are the
     request's own (the command it wants to run); the buttons are exactly the
     decisions the request named, in words. */
  function renderApprovalCard(sessionId, approval) {
    const activityHost = controlsPage.querySelector('[data-tree-activity]')
    if (!activityHost) return
    let card = controlsPage.querySelector('[data-tree-approval]')
    if (!card) {
      card = document.createElement('div')
      card.setAttribute('data-tree-approval', '')
      card.className = 'board-box board-ctl-box'
      activityHost.after(card)
    }
    const command = typeof approval.details?.command === 'string' ? approval.details.command.slice(0, 160) : ''
    const line = approval.approvalKind === 'commandExecution' && command
      ? APPROVAL_PANEL.command(command)
      : approval.approvalKind === 'fileChange'
        ? APPROVAL_PANEL.file
        : APPROVAL_PANEL.generic
    card.innerHTML = `
      <div class="board-box-h"><span class="bh-t">${escapeMarkup(APPROVAL_PANEL.title)}</span></div>
      <div class="rail-sub">${escapeMarkup(line)}</div>
      <div class="ctl-row" data-approval-choices>
        ${approval.availableDecisions.map(decision => `<button class="ctl-btn" type="button" data-approval-decision="${escapeMarkup(decision)}">${escapeMarkup(approvalDecisionWord(decision))}</button>`).join('')}
      </div>
      <output class="rail-sub" role="status" data-approval-out></output>`
    card.querySelector('[data-approval-choices]').addEventListener('click', async event => {
      const decision = event.target?.dataset?.approvalDecision
      if (!decision) return
      const bridge = typeof window === 'undefined' ? null : window.mcAgent
      if (!bridge || typeof bridge.answerApproval !== 'function') return
      let answered = null
      try { answered = await bridge.answerApproval({ sessionId, approvalId: approval.approvalId, decision }) } catch { answered = null }
      if (!answered) {
        const out = card.querySelector('[data-approval-out]')
        if (out) out.textContent = APPROVAL_PANEL.failed
        return
      }
      /* Answered means no longer pending: forgotten here so a later rail open
         cannot offer an Approve button for a decision already made. */
      sessionPendingApprovals.delete(sessionId)
      card.remove()
      setOrgStatus(APPROVAL_PANEL.answered, 'ok')
    })
  }

  /* ---- STANDING REQUESTS FROM THE CHAT BOX (the /Request family) ----
   *
   * THE PRODUCT FILES THE PERSON'S WORDS; the agent needs no tool for it and
   * is never sent the command — both dispatch seams route kind:'request'
   * before anything queues or sends, so "/RequestThread ..." can never reach
   * a model as a message. The engine's r-ledger module holds the owner's
   * design (four hand-editable markdown ledgers); the host appends and
   * answers the minted id for the one-sentence confirmation.
   *
   * SCOPE KEYS ARE IDS THIS VIEW ALREADY HOLDS, never invented: a session
   * rule files under the RUNNING session's id, a tree or thread rule under
   * this node's id (the anchor). The same ids ride every start as
   * requestKeys, so filing and boot carriage cannot disagree about what a
   * scope is called — and because a node's id survives an app restart while
   * a session's does not, a thread rule outlives the restart (the proof this
   * feature is judged by) while a session rule honestly dies with its
   * session. */
  function treeAnchorsFor(node) {
    const chain = []
    const seen = new Set()
    let current = node
    while (current && current.id && !seen.has(current.id)) {
      seen.add(current.id)
      chain.unshift(current.id)
      current = current.parentId && treeStore ? treeStore.getNode(current.parentId) : null
    }
    /* Bounded like the host's parse. An absurd depth keeps the NEAREST
       anchors: a rule anchored close binds tighter than one anchored far. */
    return chain.slice(-16)
  }

  function nodeRequestKeys(node) {
    return { treeAnchors: treeAnchorsFor(node), threadId: node.id }
  }

  const REQUEST_FILE_FAILED = 'That rule was not filed. Try it once more; if it keeps happening, the ledger file could not be written.'

  async function fileStandingRequestFor(node, slash) {
    const bridge = typeof window === 'undefined' ? null : window.mcAgent
    if (!bridge || typeof bridge.request !== 'function') {
      return { ok: false, sentence: START_NEEDS_APP_TEXT }
    }
    if (slash.scope === 'session' && !node.sessionId) {
      return { ok: false, sentence: 'This circle has no running session yet, so a session rule has nowhere to apply. Start the agent first, or use /RequestTree to cover this circle and everything under it.' }
    }
    const key = slash.scope === 'global' ? null
      : slash.scope === 'session' ? node.sessionId
        : node.id
    let filed = null
    try {
      filed = await bridge.request({ scope: slash.scope, ...(key ? { key } : {}), words: slash.rest })
    } catch (error) {
      const code = refusalCode(error)
      if (code === 'AGENT_REQUEST_UNAVAILABLE') {
        return { ok: false, sentence: 'This build cannot file standing requests yet — update ToolsEnabled and try again.' }
      }
      if (code === 'AGENT_REQUEST_WORDS_TOO_LONG') {
        return { ok: false, sentence: 'That rule is too long to file — shorten it and try again.' }
      }
      if (code === 'AGENT_REQUEST_WORDS_HEADING') {
        return { ok: false, sentence: 'A line starting with "## " would read as a new ledger entry — reword the rule and try again.' }
      }
      return { ok: false, sentence: REQUEST_FILE_FAILED }
    }
    if (!filed || filed.ok !== true || typeof filed.id !== 'string' || filed.id.length === 0) {
      return { ok: false, sentence: REQUEST_FILE_FAILED }
    }
    return { ok: true, sentence: requestConfirmationSentence(slash.scope, filed.id) }
  }

  function treeCardSend(node, text, { reply, fail }) {
    /* Slash commands are the console's own vocabulary, parsed BEFORE anything
       is sent or queued — /interrupt while busy is exactly when it matters. */
    const slash = parseSlashCommand(text)
    if (slash) {
      if (slash.kind === 'help' || slash.kind === 'unknown') { reply(slash.sentence); return }
      if (slash.kind === 'request') {
        /* Both outcomes paint through `fail`, and that is a choice about
           HONESTY, not an error path: `fail` renders the product's own note
           kind, and a filing confirmation is not the agent speaking any more
           than a refusal is — the same reasoning src/components.js gives for
           keeping refusals out of the agent's bubble. */
        if (!slash.rest) { fail(requestUsageSentence(slash.scope)); return }
        void fileStandingRequestFor(node, slash).then(result => fail(result.sentence))
        return
      }
      if (slash.action === 'queue') {
        if (!slash.rest) { fail(QUEUE_PANEL.emptyQueueCommand); return }
        const queued = outboxEnqueue(node.sessionId, slash.rest)
        if (!queued.ok) { fail(queued.sentence); return }
        reply(QUEUE_PANEL.cardQueued)
        return
      }
      const sink = { textContent: '' }
      void runPaletteAction(slash.action, node, sink).then(() => {
        reply(sink.textContent || PALETTE_PANEL.done)
      })
      return
    }
    /* nodeBusy, not raw status: a restart-stale node (saved 'running' loads
       as 'starting' forever, over a session this run never owned) must FALL
       THROUGH to the send, meet MC_AGENT_UNKNOWN_SESSION, and recover below
       — the old status-only test parked its messages in a queue that no
       turn-completion would ever drain. */
    if (nodeBusy(node)) {
      const queued = outboxEnqueue(node.sessionId, text)
      if (!queued.ok) { fail(queued.sentence); return }
      reply(QUEUE_PANEL.cardQueued)
      return
    }
    const bridge = typeof window === 'undefined' ? null : window.mcAgent
    if (!bridge || typeof bridge.send !== 'function') { fail(START_NEEDS_APP_TEXT); return }
    awaitTurnReply(node.sessionId, reply)
    transcriptAppend(node.sessionId, { who: 'you', text, at: Date.now() })
    const override = sessionModelOverride.get(node.sessionId)
    const pendingImages = sessionPendingImages.get(node.sessionId)
    sessionPendingImages.delete(node.sessionId)
    bridge.send({
      sessionId: node.sessionId,
      text,
      ...(override ? { model: override } : {}),
      ...(pendingImages && pendingImages.length ? { images: pendingImages } : {}),
    }).then(sent => {
      if (destroyed) return
      turnLogAppend(node.sessionId, sent && sent.turnId, text)
      if (treeStore) {
        treeStore.setNodeStatus(node.id, 'running', { note: '' })
        refreshTree()
      }
    }, error => {
      dropTurnReply(node.sessionId, reply)
      /* A DEAD SESSION IS NOT THE PERSON'S PROBLEM (owner, iteration 6: "We
         still get this message"). The one code that means "this session is
         gone" hands the send to the recovery: a fresh agent reads the saved
         conversation and the typed words wait in the queue, visibly. Every
         other refusal keeps its sentence. */
      if (refusalCode(error) === 'MC_AGENT_UNKNOWN_SESSION') {
        /* THE STRIP HAPPENS HERE, NOT INSIDE THE RECOVERY, AND THE PLACE IS
         * THE WHOLE FIX. The line above appended a "you" bubble BEFORE the
         * send; this send was refused, so that bubble is a phantom -- words on
         * screen and in the saved record that never reached an agent. The
         * strip used to live inside recoverDeadSessionSend, BELOW its three
         * early returns (the start-control switch, the one-per-quarter-minute
         * limiter, the already-recovering guard), so every refused or
         * rate-limited recovery left the orphan standing. Paired with a window
         * memory that had shadowed the durable record, the orphan was then the
         * ONLY thing the panel drew -- the owner's screenshot, a chat showing
         * one YOU bubble and nothing else.
         *
         * A refusal is a refusal whichever way the recovery goes, so the line
         * comes out on all of them, before the recovery is dispatched and so
         * before the resume reads the record it seeds a fresh agent from. */
        stripPhantomYouLine(node, node.sessionId, text)
        void recoverDeadSessionSend(node, text, { reply, fail })
        return
      }
      fail(startRefusalSentence({ ok: false, code: refusalCode(error) }))
    })
  }

  /* TAKE BACK THE LINE THE SEND PUT THERE, from both copies -- the window
     transcript and the durable record. Called once per refused send, from the
     rejection branch above. */
  function stripPhantomYouLine(node, deadSessionId, text) {
    const held = sessionTranscripts.get(deadSessionId) || []
    const last = held[held.length - 1]
    if (last && last.who === 'you' && last.text === text) {
      held.pop()
      sessionTranscripts.set(deadSessionId, held)
    }
    const durable = transcriptStore ? transcriptStore.get(node.id) : null
    if (!durable || !Array.isArray(durable.lines)) return
    const tail = durable.lines[durable.lines.length - 1]
    /* THE SAME LINE, NOT MERELY A LINE THIS ONE STARTS WITH.
     *
     * This compared the stored tail against a PREFIX of the newly typed text,
     * and the durable store is the only reason a prefix was ever involved: it
     * truncates a line at maxLineChars, so the words that were saved can
     * legitimately be the first 600 characters of what was typed. But
     * `text.slice(0, tail.text.length)` matches ANY shorter earlier line that
     * happens to start the same way -- type "ok" after a turn that began
     * "okay, next" and the branch below deleted the node's whole saved
     * conversation. So the prefix is admitted only where it is explained: a
     * tail of exactly the cap, over text longer than the cap. */
    const wasTruncated = tail
      && tail.text.length === TRANSCRIPT_LIMITS.maxLineChars
      && text.length > TRANSCRIPT_LIMITS.maxLineChars
      && tail.text === text.slice(0, TRANSCRIPT_LIMITS.maxLineChars)
    if (!tail || tail.who !== 'you' || !(tail.text === text || wasTruncated)) return
    const trimmed = durable.lines.slice(0, -1)
    if (trimmed.length > 0) {
      transcriptStore.save(node.id, { lines: trimmed, threadId: durable.threadId, effort: durable.effort })
    } else {
      transcriptStore.remove(node.id)
    }
  }

  /* THE RECOVERY: reached exactly once per dead session per send, from the
     rejection branch above. Order matters — the phantom you-line the failed
     send already appended is stripped from the window transcript AND the
     durable record BEFORE the resume reads it, or the words would ride
     twice: once inside the seed the fresh agent reads, once as the queued
     message. The typed message then queues and drains when the seed turn
     completes, through the one drain site every queued message uses. */
  const recoveringNodes = new Set()
  const recentRecoveries = new Map()
  async function recoverDeadSessionSend(node, text, { reply, fail }) {
    /* One recovery per node per quarter-minute. Without this, a fresh
       session that dies instantly would bounce send → unknown-session →
       recover → send forever; after one bounded attempt the honest dead
       end speaks. */
    /* The recovery brings the agent back by STARTING one, so a computer where
       that is switched off is told which switch it was -- not "the session is
       gone", which is true and useless here. */
    if (!isWriteEnabled(START_CONTROL_FLAG)) { fail(startControlOffReason()); return }
    const lastAt = recentRecoveries.get(node.id) || 0
    if (Date.now() - lastAt < 15_000) { fail(START_REFUSAL.sessionGone); return }
    if (recoveringNodes.has(node.id)) {
      /* A second send while the fresh agent still reads: it queues behind
         the first the moment the new session exists; refusing it here would
         lose words the person already typed. */
      const freshNow = treeStore ? treeStore.getNode(node.id) || node : node
      if (freshNow.sessionId && sessionNodeIds.has(freshNow.sessionId)) {
        const queued = outboxEnqueue(freshNow.sessionId, text)
        if (queued.ok) { reply(QUEUE_PANEL.cardQueued); return }
      }
      fail(START_REFUSAL.sessionGone)
      return
    }
    recoveringNodes.add(node.id)
    recentRecoveries.set(node.id, Date.now())
    try {
      /* The phantom you-line is ALREADY GONE: the rejection branch that
         dispatched this recovery strips it, above its own early returns, so
         that a refused or rate-limited recovery leaves nothing orphaned
         either. Doing it again here would take a legitimate line the moment
         somebody typed the same words twice. */
      const seeded = Boolean(transcriptStore && transcriptStore.has(node.id))
      reply(seeded ? RECOVERED_SESSION.reconnecting : RECOVERED_SESSION.bare)
      const ok = await resumeNodeSession(node, { deliverQueued: false })
      if (!ok) { fail(START_REFUSAL.sessionGone); return }
      /* The cost sentence is said only where a cost was really paid: the
         engine usually still holds the thread and brings the same agent back
         for nothing, and claiming otherwise would be charging him in words
         for something that did not happen. */
      if (ok !== 'engine' && seeded) reply(RECOVERED_SESSION.summarised)
      const fresh = treeStore ? treeStore.getNode(node.id) || node : node
      if (!fresh.sessionId) { fail(START_REFUSAL.sessionGone); return }
      if (ok === 'engine' || !seeded) {
        /* The engine restored the thread, so the agent is idle with its own
           memory: the person's message goes straight to it, the same as any
           other message. (The no-transcript case is idle for the different
           reason that there was nothing to read.) One retry only, and the
           honest dead end if that also fails. */
        treeCardSend(fresh, text, {
          reply,
          fail: sentence => fail(sentence || START_REFUSAL.sessionGone),
        })
      } else {
        /* Only the summary path is busy on arrival: the fresh agent is
           reading the excerpt as its first turn, so the person's message
           queues behind it and drains on that turn's completion — visible
           in the strip the whole time. */
        const queued = outboxEnqueue(fresh.sessionId, text)
        if (!queued.ok) fail(queued.sentence)
      }
    } finally {
      recoveringNodes.delete(node.id)
    }
  }

  /* ONE QUEUED MESSAGE GOES OUT, THROUGH THE SAME WIRE A TYPED ONE USES.
     Called from the turn-completed branch below (the engine's only "I am
     free" signal) and from the queue strip when a person queues at an idle
     session. A refusal puts the words back at the FRONT and says so; a view
     that died before the outcome files it with the undelivered-writes store
     rather than swallowing it. */
  async function drainOutboxMessage(sessionId, nodeId, entry) {
    const bridge = typeof window === 'undefined' ? null : window.mcAgent
    if (!bridge || typeof bridge.send !== 'function') {
      outboxRequeueFront(sessionId, entry)
      return
    }
    let drained = null
    const drainOverride = sessionModelOverride.get(sessionId)
    try {
      drained = await bridge.send({
        sessionId,
        text: entry.text,
        ...(drainOverride ? { model: drainOverride } : {}),
      })
    } catch (error) {
      outboxRequeueFront(sessionId, entry)
      if (destroyed) {
        recordUndeliveredWrite(WRITE_OUTCOME_KEYS.SESSION_OUTBOX, 'refused', QUEUE_PANEL.notSent)
        return
      }
      setOrgStatus(QUEUE_PANEL.notSent, 'refuse', { sticky: true, code: refusalCode(error) })
      /* In place, never a rebuild: the person may be typing in the actions
         popup's filter, and the queue strip already repaints itself through
         SESSION_OUTBOX_EVENT. See repaintRailStatus. */
      if (currentRailTreeNode && currentRailTreeNode.id === nodeId && controlsPage.classList.contains('is-active')) {
        repaintRailStatus(currentRailTreeNode)
      }
      return
    }
    if (destroyed) {
      recordUndeliveredWrite(WRITE_OUTCOME_KEYS.SESSION_OUTBOX, 'confirmed', QUEUE_PANEL.sentNext)
      return
    }
    transcriptAppend(sessionId, { who: 'you', text: entry.text, at: Date.now() })
    turnLogAppend(sessionId, drained && drained.turnId, entry.text)
    if (treeStore) {
      treeStore.setNodeStatus(nodeId, 'running', { note: '' })
      refreshTree()
    }
    setOrgStatus(QUEUE_PANEL.sentNext, 'ok')
    if (currentRailTreeNode && currentRailTreeNode.id === nodeId && controlsPage.classList.contains('is-active')) {
      repaintRailStatus({ ...currentRailTreeNode, status: 'running' })
    }
  }

  /* THE TREE'S OWN EAR ON THE SESSION STREAM. Without this, a tree-started
     agent answered into a void: computers.js subscribed to nothing, the rail
     stayed on "starting", and the person concluded agents do not respond --
     measured 2026-08-13 on the installed 1.0.7 while a live codex app-server
     child ran the session. Reads only through sessionEventText/sessionTurnStatus
     (the same pair the agent page uses), touches only sessions this tree
     started (sessionNodeIds), and detaches with the view via unsubs. */
  if (typeof window !== 'undefined' && window.mcAgent && typeof window.mcAgent.onEvent === 'function') {
    unsubs.push(window.mcAgent.onEvent(packet => {
      if (destroyed) return
      const sessionId = packet && typeof packet.sessionId === 'string' ? packet.sessionId : ''
      if (!sessionId || !sessionNodeIds.has(sessionId)) return
      const text = sessionEventText(packet, sessionId)
      if (text) {
        /* WHERE ONE TURN ENDS AND THE NEXT BEGINS, taken from the engine's own
           naming of the turn rather than inferred from a completion packet
           that may never come. Without this the accumulator and the open
           bubble both survived a turn that ended any other way, and the next
           turn's first word was appended to the last turn's answer inside the
           same bubble -- the owner's "combine into each other". */
        settleTurnBoundary(sessionId, sessionEventTurnId(packet, sessionId))
        sessionTurnText.set(sessionId, (sessionTurnText.get(sessionId) || '') + text)
        /* The open rail streams the same delta it buffers. The waiting line
           leaves on the first word -- "no answer yet" beside an answer is the
           kind of stale sentence this page is being cured of. */
        if (railSaid && railSaid.nodeId === sessionNodeIds.get(sessionId)) {
          if (railSaid.waitingLine) {
            railSaid.waitingLine.remove()
            railSaid.waitingLine = null
          }
          railSaid.appender.push(text)
        }
        /* The rail's Chat tab streams the SAME turn: one live bubble, opened
           on the first delta, repainted with the accumulated text (push
           replaces, so a missed frame can never double words), closed by the
           turn completion through the wrapped reply handler. */
        if (railChat && railChat.sessionId === sessionId) {
          if (!railChat.stream) railChat.stream = railChat.root.openStream?.({ at: Date.now() }) ?? null
          railChat.stream?.push(sessionTurnText.get(sessionId))
        }
        scheduleChipRefresh(sessionNodeIds.get(sessionId))
        return
      }
      const used = sessionUsageEvent(packet, sessionId)
      if (used) {
        sessionUsage.set(sessionId, used.usage)
        if (currentRailTreeNode && currentRailTreeNode.id === sessionNodeIds.get(sessionId)) {
          const usageHost = controlsPage.querySelector('[data-tree-usage]')
          if (usageHost) {
            usageHost.textContent = usageSentence(used.usage)
            usageHost.removeAttribute('hidden')
          }
        }
        return
      }
      const activity = sessionActivityEvent(packet, sessionId)
      if (activity) {
        const nodeId = sessionNodeIds.get(sessionId)
        if (activity.kind === 'approval' && activity.approvalId) {
          /* REMEMBERED FIRST, whoever is looking -- see sessionPendingApprovals.
             The render below is the same-moment case; the rail-open path reads
             the map for everyone who arrives later. */
          sessionPendingApprovals.set(sessionId, activity)
          /* EVENT-DRIVEN: the card exists only while a request is pending.
             Buttons offer exactly the decisions the request itself named. */
          if (currentRailTreeNode && currentRailTreeNode.id === nodeId) {
            renderApprovalCard(sessionId, activity)
          }
        }
        /* THE ACTION GOES INTO THE CONVERSATION, and everything this branch
           already did still happens below. The one-line Details string, the
           canvas chip and the approval card were never wrong -- they were
           simply all there was, and each one is overwritten by the next event.
           A row in the chat log is the part that STAYS.
           The turn is named so a busy turn's rows fold under their own count
           rather than under the whole session's. */
        const openTurn = sessionOpenTurns.get(sessionId) || null
        const filed = actionBufferFor(sessionId).add(activity, { turnId: openTurn, at: Date.now() })
        if (filed.row) {
          broadcastAction(sessionId, actionChatRow(filed.row))
        } else if (filed.change === 'folded') {
          /* THE CAP SAYS SO OUT LOUD. One row, repainted with its own count,
             rather than two hundred rows and a silence about the rest. */
          broadcastAction(sessionId, {
            id: `action:more:${openTurn || 'turn'}`,
            tool: '',
            detail: foldedActionsLine(filed.folded),
            state: '',
            stateKey: '',
            body: '',
            at: Date.now(),
          })
        }
        const line = activityLine(activity)
        if (!line) return
        nodeActivity.set(nodeId, line)
        if (currentRailTreeNode && currentRailTreeNode.id === nodeId) {
          const activityHost = controlsPage.querySelector('[data-tree-activity]')
          if (activityHost) {
            activityHost.textContent = line
            activityHost.removeAttribute('hidden')
          }
        }
        scheduleChipRefresh(nodeId)
        return
      }
      const status = sessionTurnStatus(packet, sessionId)
      if (!status) return
      const nodeId = sessionNodeIds.get(sessionId)
      /* WHOSE WORDS THIS COMPLETION MAY TAKE, ASKED BEFORE IT TAKES THEM.
       *
       * THE DEFECT (owner: "combine into each other"). This branch read the
       * status, which does not carry a turn id, and filed whatever was in the
       * accumulator as this completion's answer. Order two turns
       *     delta(turn-a) -> delta(turn-b) -> completed(turn-a)
       * and turn B's partial words were recorded as turn A's answer -- on the
       * node, in the durable record, and in every surface waiting on A -- and
       * B's accumulator was emptied under it, so B then answered with the
       * fragment it had left. settleTurnBoundary guards the opposite order
       * only.
       *
       * A completion for a turn that is no longer the open one therefore ends
       * HERE. Its own words were already filed when the next turn's first
       * delta arrived (settleTurnBoundary does exactly that, closes its bubble
       * and answers everything waiting), so there is nothing of A's left to
       * record and nothing of B's this may touch -- not the accumulator, not
       * the open-turn mark, not the node's status, and not the queue, which
       * drains on the engine saying it is free and it is not free.
       *
       * completionSettlesOpenTurn answers TRUE whenever it cannot tell -- a
       * nameless completion, or nothing else in flight -- so an engine that
       * does not name its turns behaves exactly as it did before. */
      if (!completionSettlesOpenTurn(packet, sessionId, sessionOpenTurns.get(sessionId))) return
      const spoken = (sessionTurnText.get(sessionId) || '').trim()
      /* THE ENGINE'S OWN SENTENCE, WHEN THE TURN FAILED. Measured on the
         2026-08-18 walkthrough: a failed Fable turn ended is_error:true with
         "You're out of usage credits · resets Aug 25, 12am" as its result —
         the only human sentence the turn produced — and this branch printed
         "finished without any words back" because the completion event did not
         carry it. The engine now puts a failed result's sentence on the
         completion's `text` field (engine claude-cli-adapter.js), the shell
         forwards packets verbatim, and this is the read. Success completions
         carry no text by design, so this cannot double-print an answer. */
      const succeeded = sessionTurnSucceeded(status)
      const engineSentence = sessionTurnFailureText(packet, sessionId)
      const said = turnCompletionWords({ succeeded, spoken, engineSentence })
      sessionTurnText.delete(sessionId)
      /* Nothing is in flight for this session any more, so the next delta
         opens a fresh bubble rather than reopening this one. */
      sessionOpenTurns.delete(sessionId)
      nodeActivity.delete(nodeId)
      /* A dead turn's approval is not a pending question: answered or not, the
         work it guarded is over. Forgotten here, and any painted card goes with
         it, so an interrupted agent cannot leave a ghost Approve button behind. */
      sessionPendingApprovals.delete(sessionId)
      if (currentRailTreeNode && currentRailTreeNode.id === nodeId) {
        controlsPage.querySelector('[data-tree-approval]')?.remove()
      }
      if (railSaid && railSaid.nodeId === nodeId) {
        railSaid.appender.flushNow()
        disposeRailSaid()
      }
      /* A turn that ends having said nothing is a real outcome and must read
         as one; silence in this box would read as the product hanging. `said`
         is turnCompletionWords' answer: the streamed words, the engine's
         failure sentence, or the honest empty-turn line — never silence. */
      nodeReplies.set(nodeId, said)
      /* What it DID is filed before what it SAID, in that order, because that
         is the order a person watched it happen in. */
      recordTurnActions(sessionId)
      transcriptAppend(sessionId, { who: 'agent', text: said, at: Date.now() })
      deliverTurnReply(sessionId, said)
      /* A rail-chat stream still open here means the rail was not one of the
         surfaces waiting on this turn (or the turn arrived with no claimant at
         all). The bubble still has to end. After, not before, the delivery
         above: when the rail IS waiting, its wrapped reply closes the stream
         itself, and closing twice would print the reply twice. */
      if (railChat && railChat.sessionId === sessionId && railChat.stream) {
        railChat.stream.close(said)
        railChat.stream = null
      }
      /* 'turn-failed', NEVER 'failed': 'failed' is the start-failure status
         and its chip word is "did not start" — writing it here un-said a start
         the signed spawn record shows (measured 2026-08-18). The note carries
         the engine's sentence so the rail and tooltip explain the failure.
         And a not-successful completion the PERSON asked for — the recorded
         interrupt, consumed here per turn — is 'interrupted', "stopped by
         you": calling a deliberate stop a failure was measured 2026-08-19
         beside a transcript honestly saying "Interrupted." */
      const userStopped = sessionsInterrupted.delete(sessionId)
      const outcome = sessionTurnSucceeded(status) ? 'finished' : userStopped ? 'interrupted' : 'turn-failed'
      if (treeStore) {
        /* The reply outlives this view: the store keeps it on the node, and the
           in-memory map above becomes a cache in front of it. */
        treeStore.setNodeReply(nodeId, said)
        treeStore.setNodeStatus(nodeId, outcome, {
          note: outcome === 'finished' ? ''
            : outcome === 'interrupted' ? statusNote('Stopped by you.')
            : statusNote(engineSentence ? TURN_FAILED.reply(engineSentence) : TURN_FAILED.word),
        })
        refreshTree()
      }
      /* In place, never a rebuild -- the person may be mid-word in the actions
         popup's filter when this lands. See repaintRailStatus. */
      if (currentRailTreeNode && currentRailTreeNode.id === nodeId && controlsPage.classList.contains('is-active')) {
        repaintRailStatus({ ...currentRailTreeNode, status: outcome })
      }
      /* The queue drains here because this is the engine's only "I am free"
         signal. Exactly one message — the next turn's completion drains the
         next. */
      const queuedNext = outboxTakeNext(sessionId)
      if (queuedNext) void drainOutboxMessage(sessionId, nodeId, queuedNext)
    }))
  }

  if (liveMode) loadProjection()
  else mountSimulation()

  /* Asked once, here, and deliberately NOT awaited. The tree must draw whether
     or not the shell ever answers; a panel opened before the reply lands shows
     the pessimistic default, which is what every build could always start. The
     promise is allowed to settle after the view is gone -- startableTiersNow()
     checks `destroyed` before it writes. */
  void startableTiersNow()

  return {
    el: root,
    destroy() {
      destroyed = true
      fetchVersion += 1
      clearTimeout(railDisposeTimer)
      clearTimeout(orgStatusTimer)
      if (chipRefreshFrame) cancelAnimationFrame(chipRefreshFrame)
      disposeRailSaid()
      clearBoard()
      clearSourceUnsubs()
      clearMountedGraph()
      /* The action buffers and the chats they were broadcast to. Holding a
         detached chat root holds its whole log, and this view with it. */
      sessionActions.clear()
      chatSurfaces.clear()
      /* The panel holds a submit that can still be in flight, and the store
         holds a listener that would paint into a rail this view no longer owns.
         A start already sent is NOT cancelled by any of this — it is a real
         session on this computer, and closing a page is not a reason to stop it.
         What stops here is this view's interest in the answer. */
      closeComposePanel()
      releaseTreeStore()
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
