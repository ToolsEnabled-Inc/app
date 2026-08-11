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
import { fetchAgents } from '../live-status.js'
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
      projectionUnavailableReason: 'not provided by agents projection',
      model: declaredAgent.provider,
      pool: 'declared',
      ...(declaredAgent.id === agentId ? { controlTarget: declaredAgent.controlTarget } : {}),
      context: [
        labels.length ? `Relationship · ${labels.join('; ')}` : 'No declared relationship',
        `Declared · ${declaredAgent.enabled ? 'enabled' : 'disabled'} · ${declaredAgent.provider}`,
      ],
    }
  }

  const agent = asGraphAgent(selected)
  const computer = {
    id: compId,
    name: `${compId} · declared topology`,
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
  showState('Declared agent projection', 'reading live projection…', true)
  let destroyed = false
  let current = null
  void fetchAgents().then((result) => {
    if (destroyed) return
    const projection = result.ok ? declaredAgentProjection(args.compId, args.agentId, result.data?.data) : null
    if (!projection) {
      showState(
        result.ok ? 'Declared agent unavailable' : 'Agent projection unavailable',
        result.ok ? `no declared agent matches ${args.agentId}` : result.reason,
      )
      return
    }
    current = buildAgentView(args, projection)
    root.replaceChildren(current.el)
  }).catch((error) => {
    if (!destroyed) showState('Agent projection unavailable', error?.message || String(error))
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
    provenance.textContent = 'Declared topology read from this computer.'
  } else {
    provenance.dataset.kind = 'example'
    provenance.textContent = 'Example data. These are not your agents — nothing here is running, and no control on this page reaches a real session.'
  }

  const destroyWriteSurface = mountAgentWriteSurface(root, { agentId })
  const destroyAgentSession = mountAgentSessionSurface(root, { agentId })
  const terminateButton = root.querySelector('[data-control="terminate"]')
  const terminateLabel = terminateButton.querySelector('.ctl-label')
  const terminateNote = terminateButton.querySelector('.ctl-note')
  const terminateResult = root.querySelector('.ctl-result')
  const renderTerminateState = (state) => {
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
  const onTerminateClick = () => { void terminateController.click() }
  terminateButton.addEventListener('click', onTerminateClick)
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
    rail.appendChild(el('<div class="rail-sec">Projection</div>'))
    const rows = [
      ['Declared state', agent.state === 'active' ? 'enabled' : 'disabled'],
      ['Provider', agent.model],
      ['Relationships', `${projection.relationshipCount} declared`],
      ['Observed sessions', sessionState],
    ]
    for (const [label, value] of rows) {
      const row = el('<div class="ctl-row"><span class="cl"></span><span class="cv"></span></div>')
      row.querySelector('.cl').textContent = label
      row.querySelector('.cv').textContent = value
      if (label === 'Observed sessions') {
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
    context: () => live ? 'local draft; no observed session is mapped to this agent' : agent.context,
  })
  if (live) chat.querySelector('.chat-head .s').textContent = `local draft · observed session ${sessionState}`
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
      clearInterval(tick)
      terminateButton.removeEventListener('click', onTerminateClick)
      terminateController.destroy()
      destroyWriteSurface()
      /* Closes any open session. Navigating away from the page must not leave
         a CLI child running with nothing on screen that can stop it. */
      destroyAgentSession()
      ctlResize.disconnect()
      unsubContext()
    },
  }
}
