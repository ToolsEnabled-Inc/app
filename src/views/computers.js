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
  MOVE_PANEL,
  PALETTE_PANEL,
  QUEUE_PANEL,
  SAID_PANEL,
  START_REFUSAL,
  APPROVAL_PANEL, approvalDecisionWord,
  MODEL_PANEL,
  REWIND_PANEL,
  activityLine,
  refusalNeedsAssistantProgram, roleLabel, runningLine, startRefusalSentence, startingLine,
  usageSentence,
} from '../fleet-tree-copy.js'
/* The owner's queue: messages written while the agent is busy, drained one
   per completed turn by this view's own listener. The store holds words; this
   file holds the wire. */
import {
  SESSION_OUTBOX_EVENT,
  cancel as outboxCancel,
  clearSession as outboxClearSession,
  enqueue as outboxEnqueue,
  list as outboxList,
  requeueFront as outboxRequeueFront,
  takeNext as outboxTakeNext,
} from '../session-outbox.js'
import { WRITE_OUTCOME_KEYS, recordUndeliveredWrite } from '../write-outcomes.js'
/* The readers that decide what a session event is allowed to put on a screen.
   Same set the agent page uses; a second reading of the same stream is how one
   surface comes to be wrong without anybody noticing. */
import { sessionActivityEvent, sessionEventText, sessionTurnStatus, sessionUsageEvent } from '../agent-session-events.js'
import { parseSlashCommand } from '../slash-commands.js'
/* The frame-batched appender the Controls panel already streams through --
   measured there, reused here so the rail's "What it said" moves while the
   turn runs instead of sitting silent until the end. */
import { createTranscriptAppender } from '../agent-session-transcript.js'
/* THE TREE A PERSON BUILDS, and the panel they build it in. Neither is this
   file's to own: src/fleet-trees.js holds the structure and its rules, and
   src/agent-compose-panel.js holds the form and its refusals. This view is the
   join between them and the agent bridge — a press goes in one end and a running
   session comes out the other. */
import { createFleetTreeStore, FLEET_TREE_LIMITS, markTreeStoreLive, safeTreeStorage } from '../fleet-trees.js'
import { mountAgentComposePanel } from '../agent-compose-panel.js'
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
export async function startAgentForNode({ text, surface, tier, effort }) {
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
    started = tier && effort ? await bridge.start({ surface, tier, effort })
      : tier ? await bridge.start({ surface, tier })
      : await bridge.start({ surface })
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
      sentence: startRefusalSentence(refusal),
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
      sentence: startRefusalSentence(started),
      needsAssistantProgram: refusalNeedsAssistantProgram(started),
    }
  }

  const sessionId = started.sessionId
  let sent = null
  try {
    sent = await bridge.send({ sessionId, text })
  } catch (error) {
    const refusal = { ok: false, code: refusalCode(error) }
    return {
      ok: false,
      needsApp: false,
      sessionId,
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
      code: refusalCodeOf(sent),
      sentence: sendRefusalSentence(sent),
      needsAssistantProgram: false,
    }
  }
  return { ok: true, needsApp: false, sessionId, code: null, sentence: null, needsAssistantProgram: false }
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
            <!-- SPLIT VIEW (owner defect 5): a second, view-only pane beside
                 this one for side-by-side tree viewing. OFF by default, and
                 that default is a load-bearing contract: nine harnesses run
                 this page single-pane, and page2-qa green with split off is
                 the acceptance bar. -->
            <button class="graph-split-btn" type="button" title="A second pane for viewing side by side">Split</button>
          </div>
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
          <!-- board-page because this rail page renders .board-box, .ctl-btn and
               .ctl-select: without it, board.css's box padding, overflow fence
               and input styling are all inert here. It was the ONLY rail page
               with those pieces and without the class, which is half of why the
               actions palette rendered as unreadable overlap (the other half:
               its row classes had no stylesheet rules at all -- see
               .palette-row in board.css). -->
          <div class="rail-page palette-page board-page"></div>
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
  const palettePage = root.querySelector('.palette-page')
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
    palettePage.classList.toggle('is-active', page === palettePage)
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

  root.querySelector('.graph-split-btn')?.addEventListener('click', () => {
    if (!graph) return
    if (splitGraph) {
      disableSplit()
      writeSplitPref(false)
    } else {
      enableSplit()
      writeSplitPref(true)
    }
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
    disableSplit()
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
     of why). nodeReplies is what the rail renders under "What it said". */
  const sessionNodeIds = new Map()
  const sessionTurnText = new Map()
  const nodeReplies = new Map()
  /* The latest narration line per node ("Running a command: …"), cleared when
     the turn completes -- the reply takes over from there. */
  const nodeActivity = new Map()
  /* The compact card's waiting answer-slot, one per session: registered when
     the card sends at an idle agent, delivered by the turn-completed branch,
     dropped if the card closed first (the reply still lands on the chip, the
     rail and the store — the card is a window, not the record). */
  const cardReplies = new Map()
  /* THE CONVERSATION, kept in this window's memory and said to be exactly
     that. The STORE keeps one reply per node (the durable part); these maps
     keep the back-and-forth so the card and the rail can show a real history
     instead of opening empty over a node that has plainly spoken. Bounded per
     session; entries carry the turnId the engine returned so a rewind can one
     day point at "the message where I said …". */
  const TRANSCRIPT_MAX_ENTRIES = 60
  const sessionTranscripts = new Map()
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

  function transcriptAppend(sessionId, entry) {
    if (!sessionId) return
    const held = sessionTranscripts.get(sessionId) || []
    held.push(entry)
    if (held.length > TRANSCRIPT_MAX_ENTRIES) held.splice(0, held.length - TRANSCRIPT_MAX_ENTRIES)
    sessionTranscripts.set(sessionId, held)
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
    if (!node || !node.sessionId) return null
    let history = sessionTranscripts.get(node.sessionId) || []
    if (!history.length) {
      history = []
      if (node.message) history.push({ who: 'you', text: node.message, at: null })
      const kept = nodeReplies.get(node.id) || node.reply
      if (kept) history.push({ who: 'agent', text: kept, at: null })
    }
    return {
      title: treeNodeName(node),
      subtitle: 'your agent · live session',
      roleKey: node.role,
      history,
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
      /* RE-LEARN WHOSE ANSWER IS WHOSE. sessionNodeIds used to be written at
         exactly one line, inside submitCompose -- so leaving this view and
         coming back orphaned every session this window still owned: the
         listener's own guard dropped their events, the node never left
         "starting", and the reply had nowhere to land. Measured 2026-08-13 on
         the installed build. Every session-bearing node re-registers here; a
         session that is genuinely gone just never emits again, which is the
         same silence it had before and costs nothing. */
      for (const node of treeStore.snapshot().nodes) {
        if (node.sessionId) sessionNodeIds.set(node.sessionId, node.id)
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
    const running = node.status === 'running' || node.status === 'starting'
    /* A node that HELD a session keeps its clock. Measured 2026-08-13: bornAt
       was granted only while running, and stoppedAt was hardcoded null -- so
       the moment a real turn completed, the agent that had just run, replied
       and finished rendered "no signal / no runtime", indistinguishable from
       one that never existed. A session-bearing node now always carries its
       start time, and a terminal one carries its stop time (updatedAt is
       written on the same beat as the terminal status), so the circle shows
       the run's real duration instead of denying the run happened. */
    const held = Boolean(node.sessionId)
    const terminal = node.status === 'finished' || node.status === 'failed'
    const bornAt = held ? Date.parse(node.createdAt) : NaN
    const stoppedAt = held && terminal ? Date.parse(node.updatedAt) : NaN
    return {
      id: node.id,
      name: treeNodeName(node),
      role: node.role || 'default',
      declaredRole: node.role || 'default',
      parentId: node.parentId || null,
      state: running ? 'enabled' : terminal ? node.status : 'not started',
      bornAt: Number.isFinite(bornAt) ? bornAt : null,
      stoppedAt: Number.isFinite(stoppedAt) ? stoppedAt : null,
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
    if (node.status === 'running') return 'running'
    if (node.status === 'starting') return 'starting'
    if (node.status === 'failed') return 'did not start'
    if (node.status === 'finished') return 'finished'
    return 'not started yet'
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
    const running = node.status === 'starting' || node.status === 'running'
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
    /* ONE subscription refreshes every pane: the split pane re-reads the same
       store snapshot here rather than subscribing on its own, so the two
       canvases can never disagree about what the fleet holds. */
    if (splitGraph) {
      splitGraph.computer = graphComputer()
      splitGraph.refresh()
    }
    refreshTreeSwitch()
  }

  /* THE SPLIT PANE (owner defect 5's "split view for side by side viewing").
     A second, VIEW-ONLY StaticTreeGraph over the same computer: it drills,
     zooms and routes clicks to the same rail, but offers no chips, no slots,
     no drags and no chat card — the probe (window.__mcGraph) and the edit
     gestures stay with the first pane, whose harness contracts predate this
     feature. OFF by default; the preference survives reloads in one
     localStorage key (the same storage shape metrics-layout uses, not an
     import of it). */
  const SPLIT_PREF_KEY = 'mc.page2.split'
  let splitGraph = null
  let splitPane = null
  function readSplitPref() {
    try { return localStorage.getItem(SPLIT_PREF_KEY) === 'on' } catch { return false }
  }
  function writeSplitPref(on) {
    try { on ? localStorage.setItem(SPLIT_PREF_KEY, 'on') : localStorage.removeItem(SPLIT_PREF_KEY) } catch { /* best effort */ }
  }
  function enableSplit() {
    if (splitGraph || !graph || !computer) return
    splitPane = el('<div class="graph-wrap glass graph-pane-2"><div class="computer-tree-canvas"></div></div>')
    graphWrap.insertAdjacentElement('afterend', splitPane)
    root.querySelector('.comp-body')?.classList.add('is-split')
    splitGraph = new StaticTreeGraph(splitPane.querySelector('.computer-tree-canvas'), {
      computer: graphComputer(),
      screenChips: false,
      emptySlots: false,
      edges: liveMode ? computer.graphEdges : null,
      canDrag: () => false,
      onOpenControls: (agent) => {
        if (agent?.treeNode) {
          setOpenTarget(null)
          showTreeNodeControls(agent.treeNode)
          return
        }
        setOpenTarget(agent)
        showControls(agent)
      },
    })
    root.querySelector('.graph-split-btn')?.classList.add('on')
  }
  function disableSplit() {
    splitGraph?.destroy()
    splitGraph = null
    splitPane?.remove()
    splitPane = null
    root.querySelector('.comp-body')?.classList.remove('is-split')
    root.querySelector('.graph-split-btn')?.classList.remove('on')
  }

  /* THE TREE SWITCHER (owner defect 5: "buttons to navigate between them").
     One button per tree, named by treeLabel — the first words the person typed
     into it — plus Every tree to zoom back out. Rendered only when there are
     two or more trees: a switcher over one tree is chrome with no decision in
     it. Rebuilt from listTrees() on every store change, so a tree created,
     detached or emptied updates the row without anyone remembering to. */
  function refreshTreeSwitch() {
    const tools = root.querySelector('.graph-tools')
    if (!tools) return
    let host = tools.querySelector('.graph-tree-switch')
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
      tools.prepend(host)
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
    const bridge = typeof window === 'undefined' ? null : window.mcAgent
    if (!bridge || typeof bridge.start !== 'function') return START_NEEDS_APP_TEXT
    /* THE LIMITS ARE NOT RE-ASKED HERE. src/fleet-trees.js refuses a tree past
       its own cap in its own words, and those words come back from addNode on
       submit. Asking the same question early would put a second wording of one
       rule on the screen, and the two would drift the first time only one was
       edited. */
    return ''
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
      onSubmit: draft => submitCompose(draft, detail),
      onCancel: () => closeComposePanel(),
    })
    if (!composePanel) return
    activateRail(composePage)
    /* A press made with the keyboard puts the caret where the person is going
       next; a pointer press leaves focus alone, because moving it out from under
       a mouse is how a page steals a click. */
    if (detail?.via === 'keyboard') composePanel.focus()
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

    const result = await startAgentForNode({ text: draft.message, surface: 'fleet-tree', tier: draft.tier, effort: draft.effort })
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

    sessionNodeIds.set(result.sessionId, node.id)
    const attached = store.attachSession(node.id, result.sessionId)
    if (!attached.ok) {
      /* The session is real and the tree could not record it. Saying "started"
         would leave a person with an agent they cannot find from this page. */
      const sentence = `${attached.problems[0] || 'This tree could not record the session that was started.'} Your agent is running. Reload this page to pick it up again.`
      store.setNodeStatus(node.id, 'failed', { note: statusNote(sentence) })
      refreshTree()
      setOrgStatus(sentence, 'refuse', { sticky: true })
      return { ok: false, message: sentence }
    }
    store.setNodeStatus(node.id, 'running', { note: '' })
    refreshTree()
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
    graphWrap.insertBefore(canvas, graphTitle)
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
        setOrgStatus(SECOND_TREE.detached(treeNodeName(out.node)), 'ok')
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
      onRootChange: (next, trail) => { renderCrumb(next, trail); refreshTreeSwitch() },
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
    /* The split pane returns only when this person switched it on: absence of
       the preference is single-pane, the state every harness contract runs
       in. */
    if (readSplitPref()) enableSplit()
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

  function renderLiveStats() {
    const services = computer.services || []
    statsPage.innerHTML = `
      ${railTitleRow({ title: 'Fleet overview' })}
      <div class="rail-scroll" data-live-mode="live" data-projection-state="available">
        <div class="stat-hero"><span class="v" id="agent-count">${computer.spawnedTotal}</span><span class="l">Agents on record</span></div>
        <div class="rail-sub">${escapeMarkup(computer.name)} · ${escapeMarkup(computer.note)} source · graph revision ${computer.graphRevision ?? 'unavailable'}</div>
        ${declaredOnlyReason ? `<div class="rail-sub projection-unavailable" data-projection-state="declared">The live fleet data could not be read · ${escapeMarkup(declaredOnlyReason)} These are the agents this computer has on record, not agents seen running.</div>
        <a class="rail-sub host-absent-action" href="${escapeMarkup(GUIDE_ACTION.href)}">${escapeMarkup(GUIDE_ACTION.label)}</a>` : ''}
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
   * onto mcAgent.start(). This rail keeps only the fact: sessions started from
   * this tree run on Codex -- a picked Claude row refuses by name at start
   * (AGENT_TIER_NO_LAUNCHER) rather than quietly becoming Codex, so a RUNNING
   * session here is always a Codex one. Nothing in this box is focusable. */
  const TREE_ENGINE_LABEL = 'Codex'
  const TREE_ENGINE_NOTE = 'Agents you start from this tree run on Codex. You pick the model in the start panel; the Claude choices are listed there and say so when they cannot start yet.'

  function showTreeNodeControls(node) {
    disposeRailSaid()
    clearBoard()
    currentRailTreeNode = node
    const role = ROLES[node.role] || ROLES.default
    controlsPage.style.setProperty('--rc', role.hex)
    disposeRailChat()
    controlsPage.innerHTML = `
      ${railTitleRow({ back: { aria: 'Back to the fleet overview' }, title: 'Agent in your tree', forward: { label: PALETTE_PANEL.title, attr: 'data-open-palette' } })}
      <!-- THE VSCODE-SHAPED RAIL (owner defect 7): the conversation first,
           the agent's facts second, the verbs third. One ctl-page with three
           PERSISTENT bodies toggled by [hidden] — roughly forty selectors
           query controlsPage, and swapping innerHTML per tab would orphan the
           mounted chat and strand every live updater; hidden bodies keep both
           working. -->
      <div class="seg rail-tabs" data-rail-tabs role="group" aria-label="Agent panels">
        <button type="button" class="on" data-rail-tab="chat">Chat</button>
        <button type="button" data-rail-tab="details">Details</button>
        <button type="button" data-rail-tab="actions">Actions</button>
      </div>
      <div class="rail-tab-body rail-chat-body" data-rail-body="chat">
        ${node.sessionId ? '<div class="rail-chat-host" data-rail-chat-host></div>' : `
        <div class="board-box board-ctl-box">
          <div class="rail-sub">${escapeMarkup(node.statusNote || 'This agent has not been started yet. Press its circle on the canvas to start it; the conversation opens here.')}</div>
        </div>`}
      </div>
      <div class="rail-tab-body rail-scroll" data-rail-body="details" hidden>
        <!-- Name first, brief as the caption. The name is now the role-ordinal
             identity; the ar row carries the brief's first line so a person
             still sees at a glance what this agent is for — in caption size,
             not shouted as a title. Falls back to the role word when the node
             has no brief yet. -->
        <div class="agent-head board-head"><span class="role-dot"></span><div><div class="an">${escapeMarkup(treeNodeName(node))}</div><div class="ar" title="${escapeMarkup(node.message || '')}">${escapeMarkup(treeNodeBrief(node) || roleLabel(node.role))}</div></div></div>
        <div class="board-box board-ctl-box">
          <div class="board-box-h"><span class="bh-t">What it is doing</span></div>
          <div class="rail-sub">${escapeMarkup(treeNodeStatusWord(node))}</div>
          ${node.statusNote ? `<div class="rail-sub projection-unavailable">${escapeMarkup(node.statusNote)}</div>` : ''}
          <div class="rail-sub projection-unavailable" data-tree-activity${nodeActivity.get(node.id) ? '' : ' hidden'}>${escapeMarkup(nodeActivity.get(node.id) || '')}</div>
        </div>
        <div class="board-box board-ctl-box">
          <!-- "The brief you started it with", not "what you asked for": this
               box shows node.message, which is written ONCE at start (no
               setNodeMessage exists) — while the reply box below shows the
               LATEST answer, overwritten every turn. The old headings implied
               the two were one exchange; these say what each really is. -->
          <div class="board-box-h"><span class="bh-t">The brief you started it with</span></div>
          <div class="rail-sub">${escapeMarkup(node.message || '')}</div>
        </div>
        ${node.sessionId ? `
        <div class="board-box board-ctl-box">
          <div class="board-box-h"><span class="bh-t">${escapeMarkup(SAID_PANEL.title)}</span></div>
          <div class="rail-sub" data-tree-said></div>
        </div>
        <div class="board-box board-ctl-box">
          <div class="board-box-h"><span class="bh-t">What it has used</span></div>
          <div class="rail-sub" data-tree-usage${sessionUsage.has(node.sessionId) ? '' : ' hidden'}>${escapeMarkup(sessionUsage.has(node.sessionId) ? usageSentence(sessionUsage.get(node.sessionId)) : '')}</div>
          <div class="rail-sub"${sessionUsage.has(node.sessionId) ? ' hidden' : ''}>The engine reports usage as the agent works; nothing has been reported yet.</div>
        </div>` : ''}
      </div>
      <div class="rail-tab-body rail-scroll" data-rail-body="actions" hidden>
        ${node.sessionId && (node.status === 'starting' || node.status === 'running') ? `
        <div class="board-box board-ctl-box">
          <div class="board-box-h"><span class="bh-t">While it works</span></div>
          <div class="ctl-row">
            <button class="ctl-btn" type="button" data-tree-interrupt>${escapeMarkup(PALETTE_PANEL.interrupt)}</button>
            <button class="ctl-btn" type="button" data-tree-stop>${escapeMarkup(PALETTE_PANEL.stop)}</button>
          </div>
          <output class="rail-sub" role="status" data-tree-actions-out></output>
        </div>` : ''}
        <!-- SIX BOXES BECAME THREE (owner: "just messy… should be more human
             usable"). The verbs group by what they act on — the conversation
             (rewind, queue) and the machinery (model, placement) — with
             .rail-sec rules inside one box instead of a full box frame per
             verb. Every data hook keeps its name; only the frames merged. -->
        ${node.sessionId ? `
        <div class="board-box board-ctl-box" data-tree-rewind>
          <div class="board-box-h"><span class="bh-t">The conversation</span></div>
          <div class="rail-sec">${escapeMarkup(REWIND_PANEL.title)}</div>
          <div class="rail-sub">${escapeMarkup(REWIND_PANEL.help)}</div>
          ${(sessionTurnLog.get(node.sessionId) || []).length ? `
          <div class="ctl-row">
            <select class="ctl-select" data-tree-rewind-select aria-label="${escapeMarkup(REWIND_PANEL.title)}">
              ${(sessionTurnLog.get(node.sessionId) || []).map(entry => `<option value="${escapeMarkup(entry.turnId)}">${escapeMarkup(entry.yourText.slice(0, 80))}</option>`).join('')}
            </select>
            <button class="ctl-btn" type="button" data-tree-rewind-go>${escapeMarkup(REWIND_PANEL.button)}</button>
          </div>
          <output class="rail-sub" role="status" data-tree-rewind-out></output>` : `
          <div class="rail-sub projection-unavailable">${escapeMarkup(REWIND_PANEL.empty)}</div>`}
          <div data-tree-queue>
            <div class="rail-sec">${escapeMarkup(QUEUE_PANEL.title)}</div>
            <div class="rail-sub">${escapeMarkup(QUEUE_PANEL.note)}</div>
            <ul class="rail-sub tree-queue-list" data-tree-queue-list></ul>
            <div class="ctl-row">
              <input class="ctl-select" type="text" data-tree-queue-input placeholder="${escapeMarkup(QUEUE_PANEL.placeholder)}" aria-label="${escapeMarkup(QUEUE_PANEL.placeholder)}">
              <button class="ctl-btn" type="button" data-tree-queue-add>${escapeMarkup(QUEUE_PANEL.queue)}</button>
            </div>
            <output class="rail-sub" role="status" data-tree-queue-out></output>
          </div>
        </div>` : ''}
        <div class="board-box board-ctl-box" data-tree-move>
          <div class="board-box-h"><span class="bh-t">Engine &amp; placement</span></div>
          <div class="rail-sec">${escapeMarkup(MODEL_PANEL.title)}</div>
          <div class="ctl-row"><span class="cl">Engine</span><span class="cv">${escapeMarkup(TREE_ENGINE_LABEL)}</span></div>
          ${node.sessionId ? `
          <div class="ctl-row">
            <select class="ctl-select" data-tree-model aria-label="${escapeMarkup(MODEL_PANEL.title)}">
              <option value="">${escapeMarkup(MODEL_PANEL.keep)}</option>
              ${LAUNCH_TIERS.map(tier => `<option value="${escapeMarkup(tier.model)}"${tier.provider !== 'codex' ? ' disabled' : ''}${sessionModelOverride.get(node.sessionId) === tier.model ? ' selected' : ''}>${escapeMarkup(tier.label)} · ${escapeMarkup(tier.provider === 'codex' ? 'Codex' : tier.provider === 'claude' ? 'Claude — cannot start here yet' : 'your computer — cannot start here yet')}</option>`).join('')}
            </select>
          </div>
          <div class="rail-sub" data-tree-model-note>${escapeMarkup(sessionModelOverride.has(node.sessionId) ? MODEL_PANEL.next(sessionModelOverride.get(node.sessionId)) : MODEL_PANEL.currentDefault)}</div>` : `
          <p class="board-absent-copy">${escapeMarkup(TREE_ENGINE_NOTE)}</p>`}
          <div class="rail-sec">${escapeMarkup(MOVE_PANEL.title)}</div>
          <div class="rail-sub">${escapeMarkup(MOVE_PANEL.help)}</div>
          <div class="ctl-row" data-tree-move-row hidden>
            <select class="ctl-select" data-tree-move-select aria-label="${escapeMarkup(MOVE_PANEL.title)}"></select>
            <button class="ctl-btn" type="button" data-tree-move-save>${escapeMarkup(MOVE_PANEL.save)}</button>
          </div>
          <output class="rail-sub" role="status" data-tree-move-out></output>
        </div>
      </div>`
    controlsPage.querySelector('.rail-back').addEventListener('click', showStats)
    controlsPage.querySelector('[data-open-palette]')?.addEventListener('click', () => showPalette(node))
    /* The three tabs toggle [hidden] on persistent bodies — see the markup
       comment for why nothing is ever re-rendered on a tab press. */
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
    if (chatHost && node.sessionId) {
      const config = treeChatConfigFor(node)
      if (config) {
        const chat = buildChat({
          ...config,
          tall: true,
          onSend: (text, handlers) => config.onSend(text, {
            reply: (said) => {
              if (railChat?.stream) {
                railChat.stream.close(said)
                railChat.stream = null
              } else {
                handlers.reply(said)
              }
            },
            fail: handlers.fail,
          }),
        })
        chatHost.appendChild(chat)
        railChat = { sessionId: node.sessionId, nodeId: node.id, root: chat, stream: null }
      }
    }
    /* Interrupt and Stop live inline too — the full console's fastest two
       verbs, sharing the palette's handlers so the two surfaces cannot
       drift. */
    const actionsOut = controlsPage.querySelector('[data-tree-actions-out]')
    controlsPage.querySelector('[data-tree-interrupt]')?.addEventListener('click', () => { void runPaletteAction('interrupt', node, actionsOut) })
    controlsPage.querySelector('[data-tree-stop]')?.addEventListener('click', () => { void runPaletteAction('stop', node, actionsOut) })
    /* THE KEYBOARD HALF OF "quickly connect nodes and change hierarchies".
       Edit-mode drag exists and stays; this menu is the accessible, refusable
       path. It is built from movePoints(), so it can only offer moves the
       store will accept — and the snapshot is RE-READ when Save is pressed,
       because a menu built at open time can go stale while it stands. */
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
        for (const point of points) {
          const parent = treeStore.getNode(point.parentId)
          if (!parent) continue
          const option = document.createElement('option')
          option.value = point.parentId
          option.textContent = treeNodeName(parent)
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
    /* THE QUEUE STRIP. Text nodes and listeners, never innerHTML with the
       person's words in it. The list repaints from the store on every change
       this rail itself causes; the drain path re-renders the whole rail, so
       there is no second listener to leak. */
    const queueList = controlsPage.querySelector('[data-tree-queue-list]')
    if (queueList && node.sessionId) {
      const queueOut = controlsPage.querySelector('[data-tree-queue-out]')
      const paintQueue = () => {
        queueList.innerHTML = ''
        for (const entry of outboxList(node.sessionId)) {
          const item = document.createElement('li')
          const words = document.createElement('span')
          words.textContent = entry.text.length > 80 ? `${entry.text.slice(0, 80)}…` : entry.text
          const drop = document.createElement('button')
          drop.className = 'ctl-btn'
          drop.type = 'button'
          drop.textContent = QUEUE_PANEL.unqueue
          drop.addEventListener('click', () => {
            outboxCancel(node.sessionId, entry.id)
            paintQueue()
          })
          item.appendChild(words)
          item.appendChild(drop)
          queueList.appendChild(item)
        }
      }
      paintQueue()
      const queueInput = controlsPage.querySelector('[data-tree-queue-input]')
      const queueAdd = controlsPage.querySelector('[data-tree-queue-add]')
      const submitQueued = () => {
        /* The console vocabulary works here too: /interrupt typed into the
           queue box should act now, not wait its turn in the queue. */
        const slash = parseSlashCommand(queueInput.value)
        if (slash) {
          if (slash.kind === 'help' || slash.kind === 'unknown') { queueOut.textContent = slash.sentence; return }
          if (slash.action === 'queue') {
            queueInput.value = slash.rest
            if (!slash.rest) { queueOut.textContent = QUEUE_PANEL.emptyQueueCommand; return }
          } else {
            queueInput.value = ''
            void runPaletteAction(slash.action, node, queueOut)
            return
          }
        }
        const result = outboxEnqueue(node.sessionId, queueInput.value)
        if (!result.ok) {
          queueOut.textContent = result.sentence
          return
        }
        queueInput.value = ''
        queueOut.textContent = ''
        paintQueue()
        /* An idle agent has no coming turn-completion to drain on, so a
           message queued at one goes now — same wire, same one-at-a-time. */
        if (node.status === 'finished') {
          const next = outboxTakeNext(node.sessionId)
          if (next) void drainOutboxMessage(node.sessionId, node.id, next)
        }
      }
      queueAdd.addEventListener('click', submitQueued)
      queueInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') submitQueued()
      })
    }
    const rewindGo = controlsPage.querySelector('[data-tree-rewind-go]')
    if (rewindGo && node.sessionId) {
      rewindGo.addEventListener('click', async () => {
        const select = controlsPage.querySelector('[data-tree-rewind-select]')
        const rewindOut = controlsPage.querySelector('[data-tree-rewind-out]')
        const turnId = select?.value
        if (!turnId) return
        const live = node.status === 'starting' || node.status === 'running'
        if (live) { if (rewindOut) rewindOut.textContent = REWIND_PANEL.busy; return }
        const bridge = typeof window === 'undefined' ? null : window.mcAgent
        if (!bridge || typeof bridge.rewind !== 'function') return
        let done = null
        try { done = await bridge.rewind({ sessionId: node.sessionId, turnId }) } catch { done = null }
        if (!done || done.turnId !== turnId) {
          if (rewindOut) rewindOut.textContent = REWIND_PANEL.failed
          return
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
        nodeReplies.delete(node.id)
        nodeActivity.delete(node.id)
        if (treeStore) {
          treeStore.setNodeReply(node.id, '')
          treeStore.setNodeStatus(node.id, 'finished', { note: statusNote(REWIND_PANEL.done) })
          refreshTree()
        }
        if (rewindOut) rewindOut.textContent = REWIND_PANEL.done
        showTreeNodeControls(treeStore ? treeStore.getNode(node.id) || node : node)
      })
    }
    const modelSelect = controlsPage.querySelector('[data-tree-model]')
    if (modelSelect && node.sessionId) {
      modelSelect.addEventListener('change', () => {
        const chosen = modelSelect.value
        if (chosen) sessionModelOverride.set(node.sessionId, chosen)
        else sessionModelOverride.delete(node.sessionId)
        const note = controlsPage.querySelector('[data-tree-model-note]')
        if (note) note.textContent = chosen ? MODEL_PANEL.next(chosen) : MODEL_PANEL.currentDefault
      })
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
      const live = node.sessionId && (node.status === 'starting' || node.status === 'running')
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
      } else {
        saidHost.textContent = SAID_PANEL.waiting
      }
    }
    activateRail(controlsPage)
  }

  /* THE ACTIONS PALETTE — the owner's "vscode command types", holding ONLY
     what this build really performs on this node today. What it cannot do is
     one honest sentence in the footer, never a dead control; each row's
     enabled state is derived from the node, and every outcome is a sentence
     in the palette's own output line. Rebuilt fresh per open, like the
     drawer. */
  function showPalette(node) {
    disposeRailSaid()
    clearBoard()
    currentRailTreeNode = node
    const role = ROLES[node.role] || ROLES.default
    palettePage.style.setProperty('--rc', role.hex)
    const running = node.status === 'starting' || node.status === 'running'
    const reply = nodeReplies.get(node.id) || node.reply || ''
    const actions = [
      { id: 'interrupt', label: PALETTE_PANEL.interrupt, hint: PALETTE_PANEL.interruptHint, enabled: running && Boolean(node.sessionId) },
      { id: 'stop', label: PALETTE_PANEL.stop, hint: PALETTE_PANEL.stopHint, enabled: Boolean(node.sessionId) && running },
      { id: 'child', label: PALETTE_PANEL.child, hint: PALETTE_PANEL.childHint, enabled: true },
      { id: 'queue', label: PALETTE_PANEL.queueFocus, hint: PALETTE_PANEL.queueFocusHint, enabled: Boolean(node.sessionId) },
      { id: 'switch-model', label: PALETTE_PANEL.switchModel, hint: PALETTE_PANEL.switchModelHint, enabled: Boolean(node.sessionId) },
      { id: 'clear', label: PALETTE_PANEL.clear, hint: PALETTE_PANEL.clearHint, enabled: Boolean(node.sessionId) },
      { id: 'rewind', label: PALETTE_PANEL.rewind, hint: PALETTE_PANEL.rewindHint, enabled: Boolean(node.sessionId) && (sessionTurnLog.get(node.sessionId) || []).length > 0 },
      { id: 'attach', label: PALETTE_PANEL.attach, hint: PALETTE_PANEL.attachHint, enabled: Boolean(node.sessionId) },
      { id: 'mention', label: PALETTE_PANEL.mention, hint: PALETTE_PANEL.mentionHint, enabled: Boolean(node.sessionId) },
      { id: 'move', label: PALETTE_PANEL.moveFocus, hint: PALETTE_PANEL.moveFocusHint, enabled: true },
      { id: 'copy-brief', label: PALETTE_PANEL.copyBrief, hint: '', enabled: Boolean(node.message) },
      { id: 'copy-reply', label: PALETTE_PANEL.copyReply, hint: '', enabled: Boolean(reply) },
    ]
    palettePage.innerHTML = `
      ${railTitleRow({ back: { aria: 'Back to this agent' }, title: PALETTE_PANEL.title })}
      <div class="rail-scroll">
        <div class="board-box board-ctl-box">
          <input class="ctl-select" type="text" data-palette-filter placeholder="${escapeMarkup(PALETTE_PANEL.filter)}" aria-label="${escapeMarkup(PALETTE_PANEL.filter)}">
        </div>
        <div class="board-box board-ctl-box palette-list" data-palette-list></div>
        <output class="rail-sub" role="status" data-palette-out></output>
        <p class="rail-sub projection-unavailable">${escapeMarkup(PALETTE_PANEL.footer)}</p>
      </div>`
    palettePage.querySelector('.rail-back').addEventListener('click', () => showTreeNodeControls(node))
    const listHost = palettePage.querySelector('[data-palette-list]')
    const out = palettePage.querySelector('[data-palette-out]')
    const paint = query => {
      const wanted = (query || '').trim().toLowerCase()
      listHost.innerHTML = ''
      const visible = actions.filter(action =>
        !wanted || action.label.toLowerCase().includes(wanted) || action.hint.toLowerCase().includes(wanted))
      if (visible.length === 0) {
        const line = document.createElement('p')
        line.className = 'rail-sub'
        line.textContent = PALETTE_PANEL.none
        listHost.appendChild(line)
        return
      }
      for (const action of visible) {
        const row = document.createElement('button')
        row.type = 'button'
        row.className = 'ctl-btn palette-row'
        row.disabled = !action.enabled
        const label = document.createElement('div')
        label.textContent = action.label
        row.appendChild(label)
        if (action.hint) {
          const hint = document.createElement('div')
          // Not .rail-sub: that class carries margin-bottom var(--s4), which
          // inside a button skews every row's baseline downward.
          hint.className = 'palette-hint'
          hint.textContent = action.hint
          row.appendChild(hint)
        }
        row.addEventListener('click', () => { void runPaletteAction(action.id, node, out) })
        listHost.appendChild(row)
      }
    }
    paint('')
    const filter = palettePage.querySelector('[data-palette-filter]')
    filter.addEventListener('input', () => paint(filter.value))
    activateRail(palettePage)
    filter.focus()
  }

  async function runPaletteAction(id, node, out) {
    const bridge = typeof window === 'undefined' ? null : window.mcAgent
    if (id === 'child') {
      openComposeFor({ kind: 'child', parentId: node.id })
      return
    }
    if (id === 'queue' || id === 'move' || id === 'switch-model' || id === 'rewind') {
      showTreeNodeControls(node)
      const target = controlsPage.querySelector(
        id === 'queue' ? '[data-tree-queue-input]'
          : id === 'move' ? '[data-tree-move-select]'
            : id === 'rewind' ? '[data-tree-rewind-select]'
              : '[data-tree-model]',
      )
      target?.focus?.()
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
      const oldSessionId = node.sessionId
      try { await bridge.close({ sessionId: oldSessionId }) }
      catch { /* an already-closed session is the goal state */ }
      outboxClearSession(oldSessionId)
      sessionTranscripts.delete(oldSessionId)
      sessionTurnLog.delete(oldSessionId)
      sessionUsage.delete(oldSessionId)
      sessionModelOverride.delete(oldSessionId)
      sessionPendingImages.delete(oldSessionId)
      sessionNodeIds.delete(oldSessionId)
      let started = null
      try {
        /* A start WITHOUT the brief re-sent: re-running the original ask
           uninvited could redo real work. The brief stays on the node; the
           fresh session waits for whatever the person says next. */
        started = node.tier
          ? await bridge.start({ surface: 'fleet-tree', tier: node.tier })
          : await bridge.start({ surface: 'fleet-tree' })
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
    if (id === 'mention') {
      if (!bridge || typeof bridge.pickMention !== 'function' || !node.sessionId) return
      let picked = null
      try { picked = await bridge.pickMention({ sessionId: node.sessionId }) } catch { picked = null }
      if (!picked || !picked.path) { out.textContent = PALETTE_PANEL.attachCancelled; return }
      showTreeNodeControls(node)
      const input = controlsPage.querySelector('[data-tree-queue-input]')
      if (input) {
        input.value = input.value ? `${input.value} ${picked.path}` : `Read ${picked.path} and use it for what I ask next.`
        input.focus()
      }
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

  function showControls(agent) {
    if (liveMode) {
      showProjectionControls(agent)
      return
    }
    clearBoard()
    const role = ROLES[agent.role] || ROLES.default
    controlsPage.style.setProperty('--rc', role.hex)
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
      card.remove()
      setOrgStatus(APPROVAL_PANEL.answered, 'ok')
    })
  }

  function treeCardSend(node, text, { reply, fail }) {
    /* Slash commands are the console's own vocabulary, parsed BEFORE anything
       is sent or queued — /interrupt while busy is exactly when it matters. */
    const slash = parseSlashCommand(text)
    if (slash) {
      if (slash.kind === 'help' || slash.kind === 'unknown') { reply(slash.sentence); return }
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
    const busy = node.status === 'starting' || node.status === 'running'
    if (busy) {
      const queued = outboxEnqueue(node.sessionId, text)
      if (!queued.ok) { fail(queued.sentence); return }
      reply(QUEUE_PANEL.cardQueued)
      return
    }
    const bridge = typeof window === 'undefined' ? null : window.mcAgent
    if (!bridge || typeof bridge.send !== 'function') { fail(START_NEEDS_APP_TEXT); return }
    cardReplies.set(node.sessionId, reply)
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
      cardReplies.delete(node.sessionId)
      fail(startRefusalSentence({ ok: false, code: refusalCode(error) }))
    })
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
      if (currentRailTreeNode && currentRailTreeNode.id === nodeId && controlsPage.classList.contains('is-active')) {
        showTreeNodeControls(currentRailTreeNode)
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
      showTreeNodeControls({ ...currentRailTreeNode, status: 'running' })
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
          /* EVENT-DRIVEN: the card exists only while a request is pending.
             Buttons offer exactly the decisions the request itself named. */
          if (currentRailTreeNode && currentRailTreeNode.id === nodeId) {
            renderApprovalCard(sessionId, activity)
          }
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
      const spoken = (sessionTurnText.get(sessionId) || '').trim()
      sessionTurnText.delete(sessionId)
      nodeActivity.delete(nodeId)
      if (railSaid && railSaid.nodeId === nodeId) {
        railSaid.appender.flushNow()
        disposeRailSaid()
      }
      /* A turn that ends having said nothing is a real outcome and must read
         as one; silence in this box would read as the product hanging. */
      nodeReplies.set(nodeId, spoken || SAID_PANEL.emptyTurn)
      transcriptAppend(sessionId, { who: 'agent', text: spoken || SAID_PANEL.emptyTurn, at: Date.now() })
      const cardReply = cardReplies.get(sessionId)
      if (cardReply) {
        cardReplies.delete(sessionId)
        cardReply(spoken || SAID_PANEL.emptyTurn)
      }
      /* A rail-chat stream still open here means the compact card, not the
         rail, claimed this turn's reply slot (or the turn arrived with no
         claimant at all). The bubble still has to end. After, not before,
         cardReply: when the rail IS the claimant its wrapped reply closes the
         stream itself, and closing twice would print the reply twice. */
      if (railChat && railChat.sessionId === sessionId && railChat.stream) {
        railChat.stream.close(spoken || SAID_PANEL.emptyTurn)
        railChat.stream = null
      }
      const finished = status === 'completed' ? 'finished' : 'failed'
      if (treeStore) {
        /* The reply outlives this view: the store keeps it on the node, and the
           in-memory map above becomes a cache in front of it. */
        treeStore.setNodeReply(nodeId, spoken || SAID_PANEL.emptyTurn)
        treeStore.setNodeStatus(nodeId, finished, { note: '' })
        refreshTree()
      }
      if (currentRailTreeNode && currentRailTreeNode.id === nodeId && controlsPage.classList.contains('is-active')) {
        showTreeNodeControls({ ...currentRailTreeNode, status: finished })
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
