/* The agents on this page, laid out so that they CANNOT collide.
 *
 * ------------------------------------------------------------------
 * WHAT THIS REPLACES, AND WHY REPLACING IT WAS THE FIX
 * ------------------------------------------------------------------
 * The drill-in used to draw its agents as a force/tree-simulated bubble graph
 * (FleetGraph) with a separate floating "context box" per agent, positioned by a
 * ~400-line band solver in views/agent.js. The owner's screenshot shows what that
 * produced: `16:27:58 RUNTIME` printed over `COORDINATOR'S HELPER`, `11:45:26`
 * over `SHADOW MANAGER`, `0:00:34` over `terra-01 MANAGER` -- names unreadable --
 * and the three activity lines floating above the graph with no visual tie to the
 * bubble they described.
 *
 * That was not a tuning failure. Read the history in agent.css and agent.js: a
 * ring sweep, then an exhaustive grid, then closed-form lane runs, then a
 * whole-strip DFS minimising total leader length, then a density policy that
 * RETIRES boxes it cannot place, then a hairline leader per box to answer the
 * "which box is whose" question the layout itself had created. Every round was
 * competent and every round was solving the same self-inflicted problem: text was
 * being positioned ABSOLUTELY, in a coordinate space where nothing prevents two
 * things occupying one point, so every overlap had to be discovered and repaired
 * at runtime. A solver that has to withhold a box (measured: 3 of 5 shown at 1280
 * and 1440) is a layout admitting it does not fit.
 *
 * So the geometry is gone, not tuned. Every agent is one CARD, and every fact
 * about that agent -- name, role, how long it has run, what it is doing -- is a
 * row INSIDE that card, in normal flow, inside a CSS grid cell. Two pieces of
 * text cannot overlap because no piece of text is positioned; the grid gives each
 * card a box and the card stacks its rows. There is no solver, no leader line, no
 * withheld box and no per-frame placement pass, because there is nothing left to
 * decide. Collision-avoidance stopped being a feature and became a property.
 *
 * THE "WHICH AGENT IS DOING WHAT" QUESTION ANSWERS ITSELF for the same reason.
 * The activity line is not near its agent, it is IN its agent's card, under its
 * name. That was the entire purpose of the leader lines, and containment does it
 * without drawing anything.
 *
 * ------------------------------------------------------------------
 * WHAT IS KEPT
 * ------------------------------------------------------------------
 * The house visual identity is not the physics -- it is the round role dial, the
 * monitor braces, the tan/cream sheet and the mono readouts, and all of it stays.
 * The dial keeps its role colour and its minute sweep. What it no longer does is
 * carry TEXT inside a circle: `16:27:58` was set inside a disc whose width shrinks
 * as the layout tightens, which is why it ended up on top of its neighbour's role
 * label. The duration moved to a full-width row of its own, which is also what
 * makes it readable in one glance -- the metric is obvious through LAYOUT rather
 * than through being centred in the most decorative element on the page.
 *
 * FleetGraph is imported by exactly one view (this page), so retiring it here
 * costs no other screen. The computers page draws its own StaticTreeGraph and is
 * untouched.
 */

import { el } from './components.js'
import { ROLES } from './vocab.js'
import { durationLabel, durationSpoken, runtimePhrase, NO_RUNTIME } from './runtime-duration.js'

const SVG_NS = 'http://www.w3.org/2000/svg'

/* The activity feed's own convention, copied from graph.js formatFeed() rather
   than re-decided: the LAST row is what the agent is doing now and the one
   before it is what it just finished. Two readings of one array is how the page
   ends up saying an agent is doing something it stopped doing. */
export function activityOf(agent) {
  const rows = Array.isArray(agent?.context) ? agent.context : []
  const clean = value => (value == null ? '' : String(value).replace(/\s+/g, ' ').trim())
  return { current: clean(rows.at(-1)), previous: clean(rows.at(-2)) }
}

/** Elapsed milliseconds and whether the clock is still moving, from the same
 *  fields the view's liveAgentRuntimeSource() validates. Returns null when this
 *  page was given no epoch -- which the card states, rather than showing `0s`. */
export function runtimeOf(agent, observedAt = Date.now()) {
  const bornAt = Number.isFinite(agent?.bornAt) ? agent.bornAt : null
  if (bornAt === null) return null
  const stoppedAt = Number.isFinite(agent?.stoppedAt) ? agent.stoppedAt : null
  return { elapsedMs: Math.max(0, (stoppedAt ?? observedAt) - bornAt), running: stoppedAt === null }
}

/* The dial: a role-coloured ring whose sweep is the fraction of the current
   minute, so a running agent visibly ticks. Decorative and labelled as such --
   the duration beside it is the fact, and this is the texture. A stopped agent's
   sweep is parked rather than frozen mid-arc, so "not moving" reads as a state
   and not as a stalled render. */
function buildDial(role, { running }) {
  const wrap = document.createElement('div')
  wrap.className = 'ar-dial'
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 48 48')
  svg.setAttribute('aria-hidden', 'true')
  const track = document.createElementNS(SVG_NS, 'circle')
  track.setAttribute('class', 'ar-dial-track')
  for (const [k, v] of [['cx', 24], ['cy', 24], ['r', 20], ['fill', 'none']]) track.setAttribute(k, v)
  const sweep = document.createElementNS(SVG_NS, 'circle')
  sweep.setAttribute('class', 'ar-dial-sweep')
  for (const [k, v] of [['cx', 24], ['cy', 24], ['r', 20], ['fill', 'none']]) sweep.setAttribute(k, v)
  sweep.style.stroke = role.hex
  svg.append(track, sweep)
  wrap.appendChild(svg)
  wrap.dataset.running = running ? 'true' : 'false'
  return { el: wrap, sweep }
}

const CIRCUMFERENCE = 2 * Math.PI * 20

/**
 * Build the roster.
 *
 * `onSelect` is given an agent id when a card is activated. The card is a real
 * <button>, not a div with a click handler: this is the page's only way to move
 * between agents, and the previous one -- a DOUBLE-CLICK on a simulated bubble --
 * was reachable by mouse only, announced to no screen reader, and discoverable by
 * nobody. A button is focusable, has a name, and works from the keyboard for free.
 */
export function buildAgentRoster({ agents = [], selectedId = null, onSelect = () => {} } = {}) {
  const root = el(`<div class="agent-roster" role="list"></div>`)
  const cards = []

  for (const agent of agents) {
    const role = ROLES[agent.role] || ROLES.default
    const runtime = runtimeOf(agent)
    const activity = activityOf(agent)
    const selected = agent.id === selectedId

    const card = el(`<button type="button" class="ar-card" role="listitem"></button>`)
    card.dataset.agentId = agent.id
    card.dataset.role = agent.role
    card.style.setProperty('--rc', role.hex)
    card.style.setProperty('--rg', role.glow)
    if (selected) card.classList.add('is-selected')
    if (runtime && !runtime.running) card.classList.add('is-stopped')

    const dial = buildDial(role, { running: Boolean(runtime?.running) })

    /* THE HEAD ROW: dial, then name and role stacked beside it. `min-width: 0`
       on the text column (agent.css) is what lets a long name ellipsis instead
       of pushing the card wider than its grid track -- the flexbox default is
       `min-width: auto`, which refuses to shrink below the longest word and is
       how a grid layout starts overflowing its own columns. */
    const head = el(`<span class="ar-head"></span>`)
    const text = el(`<span class="ar-text"></span>`)
    const name = el(`<span class="ar-name"></span>`)
    name.textContent = agent.name
    name.title = agent.name
    const roleRow = el(`<span class="ar-role"></span>`)
    roleRow.textContent = role.label
    text.append(name, roleRow)
    head.append(dial.el, text)

    /* THE RUNTIME ROW, and the reason it is a row. It used to be centred inside
       the dial, where its available width is the disc's chord and shrinks with
       every layout tightening. Here it owns the card's full width, so it never
       competes with anything for space, and it carries its own units so it
       cannot be read as a time of day. */
    const runtimeRow = el(`<span class="ar-runtime"></span>`)
    const runtimeValue = el(`<span class="ar-runtime-value"></span>`)
    const runtimeNote = el(`<span class="ar-runtime-note"></span>`)
    runtimeRow.append(runtimeValue, runtimeNote)

    /* THE STATUS ROW -- the thing that used to float unanchored above the graph.
       It is inside its own agent's card, so which agent is doing what needs no
       leader line and no inference. Clamped to two lines in CSS so one long
       sentence cannot make one card taller than its neighbours. */
    const status = el(`<span class="ar-status"></span>`)
    const statusCurrent = el(`<span class="ar-status-current"></span>`)
    status.appendChild(statusCurrent)
    if (activity.previous) {
      const previous = el(`<span class="ar-status-previous"></span>`)
      previous.textContent = activity.previous
      status.appendChild(previous)
    }

    card.append(head, runtimeRow, status)
    card.addEventListener('click', () => onSelect(agent.id))
    root.appendChild(card)

    cards.push({ agent, card, dial, runtimeValue, runtimeNote, statusCurrent, name, roleLabel: role.label })
  }

  /** Repaint the moving parts. Called on a one-second interval by the view --
   *  a second is the resolution the smallest unit shown actually changes at, so
   *  a faster tick would write identical text. Every write is guarded by a
   *  compare, so a settled roster performs no DOM mutation at all. */
  function update(now = Date.now()) {
    for (const entry of cards) {
      const runtime = runtimeOf(entry.agent, now)
      const phrase = runtime ? runtimePhrase({ elapsedMs: runtime.elapsedMs, running: runtime.running }) : null
      const value = runtime ? durationLabel(runtime.elapsedMs) : null

      if (value === null) {
        if (entry.runtimeValue.textContent !== NO_RUNTIME) {
          entry.runtimeValue.textContent = NO_RUNTIME
          entry.runtimeValue.classList.add('is-absent')
          entry.runtimeNote.textContent = ''
        }
      } else {
        if (entry.runtimeValue.textContent !== value) entry.runtimeValue.textContent = value
        entry.runtimeValue.classList.remove('is-absent')
        /* The verb, not a colour, carries whether this is still moving. */
        const note = runtime.running ? 'running' : 'stopped'
        if (entry.runtimeNote.textContent !== note) entry.runtimeNote.textContent = note
        entry.card.dataset.runtimeState = note
      }

      /* One accessible name per card carrying every fact in it, so a screen
         reader gets the card as a sentence instead of four unlabelled fragments
         in reading order. */
      const spoken = runtime ? `${phrase.startsWith('running') ? 'running for' : 'ran for'} ${durationSpoken(runtime.elapsedMs)}` : NO_RUNTIME
      const activity = activityOf(entry.agent)
      const label = `${entry.agent.name}, ${entry.roleLabel}, ${spoken}${activity.current ? `. ${activity.current}` : ''}`
      if (entry.card.getAttribute('aria-label') !== label) entry.card.setAttribute('aria-label', label)

      if (entry.statusCurrent.textContent !== activity.current) entry.statusCurrent.textContent = activity.current

      const frac = runtime && runtime.running ? (now % 60000) / 60000 : 0
      const drawn = CIRCUMFERENCE * frac
      const dash = `${drawn.toFixed(2)} ${(CIRCUMFERENCE - drawn).toFixed(2)}`
      if (entry.dial.sweep.getAttribute('stroke-dasharray') !== dash) {
        entry.dial.sweep.setAttribute('stroke-dasharray', dash)
      }
      entry.dial.el.dataset.running = runtime?.running ? 'true' : 'false'
    }
  }

  update()
  return { el: root, update, count: cards.length }
}
