// Agent page — the agents on this computer as a roster of cards, then the
// session control, then Chat | Controls side by side.
//
// REDONE, not tuned. The previous version drew this page's agents as a
// physics-simulated bubble graph with separately-solved floating context boxes.
// See the header of src/agent-roster.js for the full account of why that was
// replaced rather than adjusted; the short version is that it positioned text
// absolutely, so every overlap had to be discovered and repaired at runtime, and
// after five rounds of increasingly clever solvers it still printed `16:27:58`
// across `COORDINATOR'S HELPER` and still withheld 2 of 5 boxes at 1280px.
// Cards in a grid cannot overlap, so there is nothing left to solve.

import { sim } from '../sim.js'
import { ROLES } from '../vocab.js'
import { el, uptimeRing, buildChat } from '../components.js'
import { isLiveView } from '../live-flags.js'
import { createTerminateController } from '../mission-bridge.js'
import { mountAgentWriteSurface } from '../write-surfaces.js'
import { mountAgentSessionSurface } from '../agent-session.js'
import { mountCloudTaskSurface } from '../cloud-tasks.js'
import { liveSessionFor, onLiveSession } from '../agent-session-registry.js'
import {
  CONFIRMED_CONTROLS,
  SESSION_CONTROL_IDS,
  sessionControlAvailability,
  sessionControlFace,
} from '../agent-session-controls.js'
import { fetchAgents } from '../live-status.js'
import { readOrg } from '../org-controls.js'
import { declaredAgentsData, THIS_COMPUTER_ID, THIS_COMPUTER_LABEL } from '../declared-fleet.js'
import { buildAgentRoster } from '../agent-roster.js'
import { rangeFill } from './computers.js'
import '../agent.css'

/* Normalize the one runtime source shared by the roster and the controls ring.
   A terminal control target without its exact stop epoch fails closed; a finite
   stoppedAt is the only value allowed to freeze elapsed time. */
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
   per-agent runtime, chat, task count, or zero. */
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
      role: projectionRole(declaredAgent.role),
      declaredRole: declaredAgent.role,
      parentId,
      state: declaredAgent.enabled ? 'active' : 'inactive',
      bornAt: runtime?.bornAt ?? null,
      stoppedAt: runtime?.stoppedAt ?? null,
      projectionUnavailableReason: 'not part of this computer’s agent record',
      model: declaredAgent.provider,
      pool: 'declared',
      ...(declaredAgent.id === agentId ? { controlTarget: declaredAgent.controlTarget } : {}),
      context: [
        labels.length ? `Relationship · ${labels.join('; ')}` : 'No recorded relationship',
        `On record · ${declaredAgent.enabled ? 'enabled' : 'disabled'} · ${declaredAgent.provider}`,
      ],
    }
  }

  const agent = asGraphAgent(selected)
  const computer = {
    id: compId,
    /* The machine this copy runs on has a name a person recognises; a route
       segment is not it. Everything else keeps the id it arrived with. */
    name: `${compId === THIS_COMPUTER_ID ? THIS_COMPUTER_LABEL : compId} · as recorded here`,
    agents: [agent, ...relatedIds.map(id => asGraphAgent(declaredById.get(id), agent.id))],
  }
  return {
    computer,
    agent,
    relationshipCount: relationships.length,
    sessionState: data?.observedSessions?.ok ? 'unmapped' : 'unavailable',
  }
}

export function agentView(args) {
  /* `example` is the route asking for the demonstration copy of this page for
     the length of one visit — see the note in src/main.js parse(). It reads the
     same simulator the no-preference path reads, so it arrives carrying the
     "Example data. These are not your agents" banner below rather than needing
     a second notice of its own. */
  if (args.example || !isLiveView('agent')) return buildAgentView(args)

  const root = el('<div class="data-live-mode" data-live-mode="live"></div>')
  const showState = (title, reason = '', loading = false) => {
    const state = el(`<div class="projection-state ${loading ? 'is-loading' : 'projection-unavailable'}" role="status"><strong></strong><span></span></div>`)
    state.querySelector('strong').textContent = title
    state.querySelector('span').textContent = reason
    /* A DEAD END IS STILL A DEFECT.
       Every branch below this line is reached by a route that resolved — a deep
       link, a restored window, a bookmark — on a machine whose projection has
       nothing to show. Until now all three printed one grey sentence into an
       otherwise empty page: true, and terminal. The two chevrons in the topbar
       are the only other navigation this app has, and neither one names this
       page's way out, so a person who arrived here by link had to guess. The
       loading state gets no link, because it is about to become one of the
       others and a control that vanishes under the pointer is its own defect. */
    if (!loading) {
      state.appendChild(el('<a class="projection-state-out" href="#/computers">Back to computers</a>'))
    }
    root.replaceChildren(state)
  }
  showState('Opening this agent', 'reading what this computer has on record…', true)
  let destroyed = false
  let current = null
  /* THE SAME SOURCE THE GRAPH WAS DRAWN FROM.
     /data/agents.json is a build-time file and ships `ok:false` on every
     customer install, so a drill-in opened from a declared computer resolved to
     "Agent projection unavailable" — a door drawn on a wall. When the generated
     projection has nothing, the organisation store answers instead, exactly as
     it does for the graph on the computers page. If it has nothing either, the
     generated file's own refusal is still what the person is shown: the
     fallback adds a source, it never invents an answer. */
  const agentsProjection = async () => {
    const result = await fetchAgents()
    if (result.ok) return result
    const org = await readOrg()
    const declared = org.state === 'ready' ? declaredAgentsData(org.org) : null
    return declared ? { ok: true, data: { data: declared } } : result
  }
  void agentsProjection().then((result) => {
    if (destroyed) return
    const projection = result.ok ? declaredAgentProjection(args.compId, args.agentId, result.data?.data) : null
    if (!projection) {
      showState(
        result.ok ? 'This agent is not on record here' : 'This agent’s record could not be read',
        result.ok ? `no agent on this computer’s record matches ${args.agentId}` : result.reason,
      )
      return
    }
    current = buildAgentView(args, projection)
    root.replaceChildren(current.el)
  }).catch((error) => {
    if (!destroyed) showState('This agent’s record could not be read', error?.message || String(error))
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
      <div class="agentv-top">
        <div class="graph-crumb"></div>
        <div class="agent-provenance" role="status"></div>
      </div>
      <div class="agentv-roster glass"></div>
      <div class="agent-strip">
        <span class="as-name">${agent.name}</span>
        <span class="as-sep">·</span><span>${role.label}</span>
        <span class="as-sep">·</span><span>${agent.pool}</span>
        <span class="as-sep">·</span><span>${agent.model}</span>
      </div>
      <div class="agentv-panels-wrap">
        <div class="agentv-panels">
          <section class="apanel glass chat-panel"><div class="apanel-title">Chat</div></section>
          <section class="apanel glass ctl-panel">
            <div class="apanel-title">Controls</div>
            <div class="rail-scroll">
              <div class="rail-sec">Tuning</div>
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

  /* WHOSE DATA THIS IS, SAID IN NORMAL FLOW AND BEFORE ANYTHING ELSE.
   *
   * Everything on this page is a demonstration whenever the agent view is in
   * simulated mode, and until now the page said so in exactly one place: a 48px
   * tile in the Controls action row reading "Simulated / No declared state",
   * four columns along and below the fold at two of the three shipping window
   * sizes. The only prominent notice was the app-wide `.fleet-profile-notice`,
   * which is `position: fixed; bottom right; z-index: 190` -- a toast that lands
   * on top of whatever is beneath it (on this page, the Controls panel and the
   * graph's own zoom readout), and which is keyed to the FLEET PROFILE being
   * unconfigured rather than to this view's data being fake, so it is both
   * overlapping and answering a different question.
   *
   * This banner is a normal-flow sibling above the roster. It cannot overlap
   * anything because it participates in layout, and it states this view's own
   * provenance rather than the profile's. The fixed toast is suppressed on this
   * route in agent.css, because two notices that disagree about what is real is
   * worse than either alone. */
  const provenance = root.querySelector('.agent-provenance')
  if (live) {
    provenance.dataset.kind = 'declared'
    provenance.textContent = 'Read from the team record saved on this computer.'
  } else {
    provenance.dataset.kind = 'example'
    provenance.textContent = 'Example data. These are not your agents — nothing here is running, and no control on this page reaches a real session.'
  }

  /* `live` IS PASSED, AND IT IS THE SAME `live` THE BANNER ABOVE IS COMPUTED
     FROM. Both surfaces below mount real controls -- one starts a CLI child
     process on this machine, the other dispatches an audited lane -- and both
     used to be mounted here with only `{ agentId }`, so the provenance this
     function had already worked out four lines earlier was dropped on the way
     in. That is how the page came to print "no control on this page reaches a
     real session" directly above an enabled Start that reached one.
     The Terminate control immediately below has taken `live` since it was
     written; these two were the outliers, not the precedent. */
  const destroyWriteSurface = mountAgentWriteSurface(root, { agentId, live })
  const destroyAgentSession = mountAgentSessionSurface(root, { agentId, live })
  /* Codex Cloud, beside the local session rather than on a page of its own: the
     two are the same act -- start an agent -- differing only in which computer
     runs it. It takes the same `live` fence as the two above, for the strongest
     version of their reason: a launch from here starts real, billable work on a
     remote service that cannot be cancelled. */
  const destroyCloudTasks = mountCloudTaskSurface(root, { live })
  const terminateButton = root.querySelector('[data-control="terminate"]')
  const terminateLabel = terminateButton.querySelector('.ctl-label')
  const terminateNote = terminateButton.querySelector('.ctl-note')
  const terminateResult = root.querySelector('.ctl-result')
  /* Declared above the bridge controller because the controller publishes its
     first state during construction, and that first publish already has to know
     whether this page's controls belong to a session. */
  let sessionBusy = null
  let confirmStep = null
  let sessionOwnsControls = false
  let sessionResult = ''
  let destroyedView = false
  const renderTerminateState = (state) => {
    /* ONE OWNER OF THIS BUTTON AT A TIME. While a session this app owns is
       mapped to this agent, the bridge controller's state is still real and
       still correct about the remote projection -- it simply must not paint. A
       late publish from an in-flight bridge request writing over the session
       controls is exactly how a screen comes to show one state and perform
       another. */
    if (sessionOwnsControls) return
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
  const onTerminateClick = () => {
    if (sessionOwnsControls) return
    void terminateController.click()
  }
  terminateButton.addEventListener('click', onTerminateClick)

  /* ---------- steering a session this app owns ----------
   *
   * THE DEFECT: Pause, Respawn and Terminate reported that no observed control
   * target was mapped to this declared agent WHILE A SESSION WAS RUNNING, six
   * inches above them on this same page. Starting and watching an agent worked;
   * steering one did not. For a product whose selling point is orchestrating
   * fleets, that is a core feature failing.
   *
   * THE TWO KINDS OF TARGET, which were never distinguished. `controlTarget` is
   * a REMOTE observed run carried by the mission-bridge projection -- an agent
   * id, a run id and a PID on some machine -- and it is null on every local
   * install, so the bridge terminate above correctly refused. The session this
   * app started is the other kind entirely: a child process this window owns,
   * reachable through mcAgent with no bridge in the path. Neither half was
   * wrong; nothing joined the second one to the agent whose page started it.
   *
   * ONE ARBITER, and it is here. When this app owns a session for this agent
   * the three controls steer THAT, because it is the thing on this page that
   * genuinely is running. Otherwise the bridge terminate keeps the Terminate
   * button and its own refusals, byte for byte as before. Both are never live
   * at once: two controllers writing one button is how a screen ends up showing
   * one state and performing another. */
  const controlButtons = {
    pause: root.querySelector('[data-control="pause"]'),
    respawn: root.querySelector('[data-control="respawn"]'),
    terminate: terminateButton,
  }
  const renderSessionControl = (id, state, step) => {
    const button = controlButtons[id]
    const face = sessionControlFace(id, state, { step })
    button.disabled = !state.enabled
    button.dataset.phase = face.phase
    button.classList.toggle('is-confirming', face.phase === 'confirm')
    button.classList.toggle('is-pending', face.phase === 'pending')
    button.classList.remove('is-success')
    button.querySelector('.ctl-label').textContent = face.label
    button.querySelector('.ctl-note').textContent = face.note
    button.setAttribute('aria-label', `${face.label}. ${face.message}`)
    return face
  }

  /* WHICH CONTROLLER OWNS THE PANEL WHEN NEITHER HAS ANYTHING RUNNING.
   *
   * MEASURED on the packaged window, and it is the reason this is not simply
   * `availability.mapped`. With no session and no remote run, the bridge
   * controller owned the result line and the only sentence a person saw was
   * "Terminate unavailable: no observed control target is mapped to this
   * declared agent" -- true, internal, and useless: it names a concept the
   * product has never shown them and gives them nothing to do. On every local
   * install `controlTarget` is null, so that was the sentence on the shipped
   * screen.
   *
   * So the bridge keeps the panel only when it actually has a remote observed
   * run to talk about. Otherwise the session controls hold it and say the thing
   * a person can act on: start a session here, and these will steer it. Nothing
   * is taken away -- when a projection does carry a control target, every
   * bridge refusal is shown exactly as before. */
  const bridgeHasTarget = () => Boolean(live && agent.controlTarget && typeof agent.controlTarget === 'object' && !Array.isArray(agent.controlTarget))

  let resultSessionId = null
  const renderSessionControls = () => {
    const session = live ? liveSessionFor(agent.id) : null
    /* The outcome of the last action survives the session it was about -- "Ended
       the session" must not be wiped by the same repaint that observes the
       session ending -- but it must not outlive the NEXT one. */
    if (session && session.sessionId !== resultSessionId) {
      sessionResult = ''
      resultSessionId = null
    }
    const availability = sessionControlAvailability({ live, agentId: agent.id, session, busy: sessionBusy })
    const owns = availability.mapped || !bridgeHasTarget()
    /* HANDING THE TERMINATE BUTTON BACK is as important as taking it. A session
       that ends must return the button to the bridge controller's own state,
       not leave the last sentence this code wrote frozen on a control the
       bridge controller believes it owns. */
    if (sessionOwnsControls && !owns) {
      sessionOwnsControls = false
      confirmStep = null
      sessionResult = ''
      renderTerminateState(terminateController.getState())
    }
    if (!owns) {
      for (const id of ['pause', 'respawn']) renderSessionControl(id, availability[id], 'idle')
      /* The Terminate button and the result line stay with the bridge
         controller, which here has a real remote run to report on. One owner,
         so the two can never print disagreeing sentences. */
      return
    }
    sessionOwnsControls = true
    let message = availability.reason
    for (const id of SESSION_CONTROL_IDS) {
      const step = sessionBusy === id ? 'pending' : (confirmStep === id ? 'confirm' : 'idle')
      const face = renderSessionControl(id, availability[id], step)
      if (step !== 'idle') message = face.message
    }
    terminateResult.dataset.phase = sessionBusy ? 'pending' : 'ready'
    terminateResult.textContent = sessionResult || message
  }

  const runSessionControl = async (id) => {
    const session = live ? liveSessionFor(agent.id) : null
    const availability = sessionControlAvailability({ live, agentId: agent.id, session, busy: sessionBusy })
    if (!availability.mapped || !availability[id].enabled) return
    /* Confirm once for the two that destroy a running child. The first press
       posts nothing; that is the same contract the bridge terminate keeps, and
       it is checked against the availability again after the confirmation so a
       session that ended between the two presses cannot be acted on. */
    if (CONFIRMED_CONTROLS.includes(id) && confirmStep !== id) {
      confirmStep = id
      sessionResult = ''
      renderSessionControls()
      return
    }
    confirmStep = null
    sessionBusy = id
    sessionResult = ''
    renderSessionControls()
    let result
    try {
      result = await session.control[id]()
    } catch (error) {
      result = { ok: false, code: typeof error?.code === 'string' ? error.code : 'AGENT_SESSION_FAILED' }
    }
    sessionBusy = null
    if (destroyedView) return
    sessionResult = result?.ok
      ? { pause: 'Stopped the turn that was running. The session is still open.',
          respawn: 'Ended that session and started a new one for this agent with the same prompt.',
          terminate: 'Ended the session. The child process this app started is closed.' }[id]
      : `${id} did not happen · ${result?.code || 'AGENT_SESSION_FAILED'}`
    /* Read AFTER the action, not before it: respawn's answer is about the
       session that now exists, and terminate's is about no session at all. */
    resultSessionId = (live ? liveSessionFor(agent.id) : null)?.sessionId ?? null
    renderSessionControls()
  }

  const sessionClickHandlers = new Map()
  for (const id of SESSION_CONTROL_IDS) {
    const handler = () => {
      /* The bridge terminate keeps its own click while it owns the button. */
      if (id === 'terminate' && !sessionOwnsControls) return
      void runSessionControl(id)
    }
    sessionClickHandlers.set(id, handler)
    controlButtons[id].addEventListener('click', handler)
  }
  /* Both surfaces that make a claim about the session are repainted from the one
     event, so they cannot fall out of step with each other. The chat panel is
     built further down this function; the listener only ever fires after the
     mount has finished, and the synchronous first paint below is a direct call
     that does not touch it. */
  const unsubscribeSession = onLiveSession(() => {
    renderSessionControls()
    syncChatProvenance()
  })
  renderSessionControls()
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
    rail.appendChild(el('<div class="rail-sec">On record</div>'))
    const rows = [
      ['Recorded state', agent.state === 'active' ? 'enabled' : 'disabled'],
      ['Provider', agent.model],
      ['Relationships', `${projection.relationshipCount} recorded`],
      ['Running sessions', sessionState === 'unavailable' ? 'could not be read' : 'not matched by name'],
    ]
    for (const [label, value] of rows) {
      const row = el('<div class="ctl-row"><span class="cl"></span><span class="cv"></span></div>')
      row.querySelector('.cl').textContent = label
      row.querySelector('.cv').textContent = value
      if (label === 'Running sessions') {
        row.classList.add('projection-state')
        if (sessionState === 'unavailable') row.classList.add('projection-unavailable')
      }
      rail.appendChild(row)
    }
    runtimeRingMount = el('<div class="agent-ring-wrap"></div>')
    if (!appendAgentRingNode(rail, runtimeRingMount)) runtimeRingMount = null
  }

  /* ---------- the roster ----------
   *
   * The selected agent first, then the rest of this computer's agents. The
   * selected one leads rather than being highlighted in place because the reader
   * arrived here by naming it, and a page that opens on the thing you asked for
   * needs no legend explaining which card is yours. */
  const rosterMount = root.querySelector('.agentv-roster')
  const ordered = [
    agent,
    ...computer.agents.filter(candidate => candidate.id !== agent.id),
  ]
  const roster = buildAgentRoster({
    agents: ordered,
    selectedId: agent.id,
    onSelect: (id) => { if (id && id !== agent.id) navigate(`#/agent/${computer.id}/${id}`) },
  })
  const rosterHead = el(`<div class="ar-head-row"><span class="ar-title">Agents on ${computer.name}</span><span class="ar-count"></span></div>`)
  rosterHead.querySelector('.ar-count').textContent = roster.count === 1 ? '1 agent' : `${roster.count} agents`
  rosterMount.append(rosterHead, roster.el)

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
    seed: live ? 0 : 6,
    tall: true,
    /* TWO PANELS ON ONE SCREEN MUST NOT DISAGREE ABOUT WHETHER A SESSION EXISTS.
       This said "no observed session is mapped to this agent" unconditionally,
       which was true while nothing could be mapped. The moment the Controls
       panel beside it began steering a mapped session, the same screen carried
       both sentences at once -- and a reader resolves that contradiction
       themselves, which is the defect however it resolves.
       What does NOT change is the claim about this box: it is still a local
       draft and typing in it still reaches nothing. A composer that quietly
       started reaching a live session because a label was updated would be a
       far worse repair than the contradiction. */
    context: () => (live
      ? (liveSessionFor(agent.id)
        ? 'local draft; a session this app started is running for this agent, and this box does not send to it'
        : 'local draft; no session started from this app is running for this agent')
      : agent.context),
  })
  const chatProvenance = chat.querySelector('.chat-head .s')
  const syncChatProvenance = () => {
    if (!live) return
    chatProvenance.textContent = liveSessionFor(agent.id)
      ? 'local draft · a session is running; this box does not send to it'
      : `local draft · ${sessionState === 'unavailable' ? 'running sessions could not be read' : 'no running session is matched to this agent'}`
  }
  syncChatProvenance()
  root.querySelector('.chat-panel').appendChild(chat)

  // Controls ring.
  let ring = null
  let ringUpdates = false
  const liveRuntime = live ? liveAgentRuntimeSource(agent) : null
  if (!live || liveRuntime) {
    const smallRing = window.innerHeight < 960
    const ringEpoch = live && !liveRuntime.running
      ? Date.now() - liveRuntime.elapsedMs
      : agent.bornAt
    ring = uptimeRing({ size: smallRing ? 132 : 180, epoch: ringEpoch, colors: [role.glow, role.hex], caption: 'Runtime', showDays: false })
    if (smallRing) ring.el.classList.add('ctl-ring-sm')
    if (appendAgentRingNode(runtimeRingMount, ring.el)) ringUpdates = !live || liveRuntime.running
    else ring = null
  }

  const ctlScroll = root.querySelector('.ctl-panel .rail-scroll')
  const syncScrollEnd = () => {
    const atEnd = ctlScroll.scrollTop + ctlScroll.clientHeight >= ctlScroll.scrollHeight - 2
    ctlScroll.classList.toggle('at-end', atEnd)
  }
  ctlScroll.addEventListener('scroll', syncScrollEnd, { passive: true })
  const ctlResize = new ResizeObserver(() => syncScrollEnd())
  ctlResize.observe(ctlScroll)
  root.querySelectorAll('input[type="range"]').forEach(rangeFill)

  /* One second, not one frame.
   *
   * The old view ran a requestAnimationFrame loop for the whole life of the page
   * because the chip solver had to re-place boxes every frame as the physics
   * settled. Nothing on this page moves per frame any more: the smallest unit
   * either readout shows is the second, so a one-second interval writes every
   * value that can have changed and no value that cannot. The roster's update()
   * compares before it writes, so a settled page performs no DOM mutation at all
   * between ticks -- and the ring keeps its own ~12Hz sweep only while it is
   * genuinely running. */
  const tick = setInterval(() => {
    roster.update()
    if (ring && ringUpdates) ring.update()
  }, 1000)

  const unsubContext = live ? () => {} : sim.on('context', ({ comp }) => {
    if (comp !== computer) return
    roster.update()
  })

  return {
    el: root,
    destroy() {
      destroyedView = true
      clearInterval(tick)
      terminateButton.removeEventListener('click', onTerminateClick)
      terminateController.destroy()
      unsubscribeSession()
      for (const [id, handler] of sessionClickHandlers) controlButtons[id].removeEventListener('click', handler)
      destroyWriteSurface()
      /* Closes any open session. Navigating away from the page must not leave
         a CLI child running with nothing on screen that can stop it. */
      destroyAgentSession()
      /* Stops the cloud surface from publishing into a detached DOM. It does
         NOT stop a launched cloud task, and cannot: the provider has no cancel.
         Leaving the page is not a stop, which is why nothing here claims it. */
      destroyCloudTasks()
      ctlResize.disconnect()
      unsubContext()
    },
  }
}
