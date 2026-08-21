// /home — the hero ring and, between the braces, what is actually happening.
//
// WHAT CHANGED AND WHY, because the previous version of this file argued at
// length for a design that did not survive contact with an installed copy.
//
// It assumed the interesting thing on this screen is a FLEET: other computers,
// a coordinator running on one of them, and a health sweep across all of them.
// On the machine of someone who has just installed this product none of that
// exists, and the screen degraded into five separate notices about the absence
// of a thing that person never had -- a clock reading four dashes, "SOURCE
// UNAVAILABLE", "coordinator thread unavailable", and "No local agent fleet
// host detected on this machine" printed twice -- directly above a banner
// saying "ToolsEnabled already works on this one computer". Those last two
// cannot both be acted on. It was the product's first impression.
//
// The premise was wrong, not the implementation. There IS something real to
// show on one computer with nothing connected: the agents that have run on it.
// Starting an agent from inside ToolsEnabled works now, and every start is
// written to this app's own signed record before the process exists. So home
// reads that record, and a machine with no fleet gets its own history rather
// than a fleet-shaped hole.
//
// THE DIVISION OF LABOUR IN THIS FILE. src/local-activity.js decides WHAT the
// screen says -- one pure function, one flat list of sentences, walked
// exhaustively by tools/test/home-screen.test.mjs to prove the screen can never
// again contradict or repeat itself. This file only renders that decision and
// wires the sources that feed it. Copy does not live here; if a sentence needs
// changing, it changes there, where the test can see it.
//
// WHAT IS STILL SIMULATED, AND SAID SO. The labelled demonstration -- the
// written coordinator session and its cast -- is still here, still reachable
// from Settings, and now the only thing on the screen that carries a badge. It
// never appears unless a person asked for it: the previous version showed a
// header reading "SESSION - SAMPLE TRANSCRIPT" beside a badge reading "LIVE
// SOURCE" on a live screen, which is the same defect in miniature.

import { el, uptimeRing } from '../components.js'
import { onNextFrame } from '../page-frames.js'
import { fetchStatus, fetchCoordinator } from '../live-status.js'
import { ownerPromptSnapshot } from '../mission-bridge.js'
/* A decision the owner made on #/approvals whose answer arrived after he had
   already left that screen. The approvals design nominated this screen as its
   one signal channel ("the only signal that anything is waiting is a count on
   the home view's existing readouts"), so it is also the screen that has to
   carry the case where a decision he made did not land. */
import {
  APPROVAL_OUTCOME_EVENT,
  reconcileUndeliveredDecisions,
  undeliveredDecisionCount,
} from '../approval-outcomes.js'
import { isExampleMode, currentDataSource, resolveDataSource, announceDataSourceChange } from '../data-source.js'
import { isWriteEnabled } from '../write-flags.js'
import { bridgeStatus, postBridgeAction } from '../mission-bridge.js'
import { FLEET, isSampleFleet } from '../fleet-profile.js'
import {
  COPY,
  HOME_MODES,
  describeHome,
  describeRun,
  readAgentEngine,
  readLocalSessions,
  summariseRunWork,
} from '../local-activity.js'
/* One reading of "is anybody signed in", beside the rest of the availability
   vocabulary, so this screen and the setup review cannot drift apart on it. */
import { providerSignInReading } from '../agent-availability-copy.js'
/* THE CONVERSATIONS THIS COMPUTER ALREADY SAVED, read so a run can say which
   agent it was, what it was asked and what it said back. Nothing new is written
   and nothing new is recorded: the trees a person builds on the computers page
   are kept on this machine, keyed by session, and the signed run record carries
   the same key. This screen only joins the two.

   THIS USED TO BE A PRIVATE COPY INSIDE THIS FILE, and that is the whole reason
   it is an import now. src/session-roles.js was extracted from this view's own
   savedConversations() for the metrics page, nine hours after this screen
   shipped its own, and this screen was never switched over. Two byte-identical
   readers of one record is one widening away from a silent divergence, and the
   widening arrived: the owner asked this list to show what each agent SAID, the
   field was already on the node, and adding it to one reader would have left
   the other blind. There is one reader now and this is it. */
import { readSessionRoles } from '../session-roles.js'
/* WHAT EACH RUN ACTUALLY DID, from the per-turn record this app already keeps
   (shell/usage-record.cjs writes one signed line per turn). Read through the
   reader the metrics page already uses, for exactly the reason above: a second
   parser of that record here would be a second opinion about it. */
import { readLocalUsage } from '../local-metrics.js'
/* THE THREE READERS THE AGENT EVENT STREAM IS ALLOWED TO BE READ THROUGH. Every
   surface that listens to a live session uses this same set, and it is a set
   rather than one function because a turn's words, a turn's identity and a
   turn's ending are three separate facts and this row shows all three. */
import {
  sessionEventText,
  sessionEventTurnId,
  sessionTurnStatus,
} from '../agent-session-events.js'
/* The two controls on the settings page that decide what this box contains:
   which agents' context appears in it, and whether agent runs appear too, not
   at all, or on their own. The view reads them and re-reads them on the event,
   exactly as it does the live-source flags above. */
import {
  CHATBOX_FEED_EVENT,
  agentIdsFromTurns,
  filterTurns,
  readAgentSelection,
  readRunsMode,
} from '../chatbox-feed.js'
import '../home.css'

/* The fleet health snapshot changes when a sweep runs, which is minutes apart.
   It is only asked for at all when other computers have actually been
   connected -- an install with none used to run this poll forever against a
   file that always answered the same refusal. */
const HEALTH_POLL_MS = 45_000
/* Decisions appear when an agent enqueues one, so this is a count and not a
   feed. Two cadences on purpose: the fast one once the queue is genuinely
   readable, and a slow heartbeat while it is not, so a screen opened before
   this app's own capability layer has finished starting still picks the queue
   up when it does -- without spending a request every twenty seconds in the
   ordinary case where there is no queue on this machine at all. */
const APPROVALS_POLL_MS = 20_000
const APPROVALS_RETRY_MS = 120_000

/* HOW OFTEN THE SIGNED RECORDS MAY BE RE-READ, and this number is the whole of
 * how the live list keeps the promise the removed focus refresh broke.
 *
 * Reading either record means verifying a hash chain on the Electron main
 * process, which is also the process forwarding output for every live agent
 * session. The performance lane measured the cost of asking carelessly at ~0.9s
 * of whole-app stall on a ledger with ten thousand records, which is why the
 * refresh on window focus was removed rather than tuned: alt-tabbing back to
 * the window charged every running agent for the gesture.
 *
 * So nothing here polls and nothing here reads on focus. A read happens only
 * when the event stream has just said something that CHANGED a record -- a
 * session this list has never seen (a run was written), or a turn that ended (a
 * usage line was written) -- and then at most once in this window, trailing. A
 * turn ends on the order of tens of seconds, so in practice this floor is never
 * the thing doing the limiting; it is there so that an engine emitting a burst
 * of endings cannot turn into a burst of chain verifications.
 *
 * The words on the screen do NOT wait for it. What the agent is saying arrives
 * on the stream and is painted straight away, off no record at all. */
const LEDGER_REREAD_FLOOR_MS = 4_000
/* Words arrive faster than a person reads them. The live line is repainted on a
   trailing timer rather than per delta, so a fast turn is one repaint every
   tenth of a second instead of forty. Deliberately a timer and NOT a frame: a
   covered window is served no frames at all (src/page-frames.js), and this is a
   re-arming update rather than the one-shot settle that module's primitive is
   for. */
const LIVE_REPAINT_MS = 90

/* ============================================================
   The demonstration's cast and script. Profile data, because a
   fleet names its own agents; untouched by this rewrite except
   that it now renders only when a person has asked for it.
   ============================================================ */
const SPEAKERS = FLEET.speakers || {}
const SESSION = (FLEET.session || []).filter(turn => turn && typeof turn.text === 'string')
const ARRIVALS = (FLEET.arrivals || []).filter(turn => turn && typeof turn.text === 'string')
const REPLIES = (FLEET.replies || []).filter(text => typeof text === 'string' && text)
const REPLY_ACTS = (FLEET.replyActs || []).filter(text => typeof text === 'string' && text)

const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/* Draw from a shuffled bag so the pool is spent before anything repeats — the
   comms board learned this the hard way: nothing gives a generated transcript
   away faster than a verbatim repeat two messages apart. On refill the new bag
   must not open with the line that just closed the old one, or the one guarded
   repeat appears at the seam. */
function makeBag(items) {
  let bag = []
  let last = null
  return () => {
    if (!bag.length) {
      bag = items.slice()
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[bag[i], bag[j]] = [bag[j], bag[i]]
      }
      if (bag.length > 1 && bag[bag.length - 1] === last) {
        ;[bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]]
      }
    }
    last = bag.pop()
    return last
  }
}

const BRACE_SVG = `<svg width="22" height="26" viewBox="0 0 22 26"><path d="M20.5 1.5 C13 1.5 8 3.6 8 10.8 L8 26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><svg class="brace-arm" viewBox="0 0 22 10" preserveAspectRatio="none"><rect x="7.25" y="0" width="1.5" height="10" fill="currentColor"/></svg><svg width="22" height="56" viewBox="0 0 22 56"><path d="M8 0 L8 16 C8 24 5.6 26.4 1.5 28 C5.6 29.6 8 32 8 40 L8 56" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><svg class="brace-arm" viewBox="0 0 22 10" preserveAspectRatio="none"><rect x="7.25" y="0" width="1.5" height="10" fill="currentColor"/></svg><svg width="22" height="26" viewBox="0 0 22 26"><path d="M8 0 L8 15.2 C8 22.4 13 24.5 20.5 24.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`

/* One per mounted home view, so the panel heading's id is unique even while the
   router briefly holds two of them. */
let panelInstances = 0

export function homeView() {
  /* The SOURCE decides what this screen shows, and it alone puts the badge on.
     `sample` is baked into this view's closures (the send fork, the arrivals,
     the write gate), so it is fixed at construction from what is known
     synchronously: the example toggle, or an already-resolved verdict. On a
     public page the first-ever mount may not know yet -- the relay probe is
     async -- so the resolution below runs once, and if the settled verdict
     disagrees with the construction guess it announces the change, which
     remounts this view through main.js's DATA_SOURCE_EVENT hook. One honest
     rebuild beats a screen whose closures disagree with its badge. */
  const sample = isExampleMode() || currentDataSource() === 'mock'
  void resolveDataSource().then((settled) => {
    if ((settled === 'mock') !== sample) announceDataSourceChange('first-resolution')
  }).catch(() => {})
  const fleetConfigured = !isSampleFleet()
  const writeReplyEnabled = !sample && isWriteEnabled('thread-reply')
  const composerTarget = FLEET.composerTarget || 'coordinator'

  /* THE PANEL'S OWN TITLE IS THE PANEL'S ACCESSIBLE NAME.
   *
   * The log is a tab stop (it scrolls, so a keyboard user has to be able to
   * reach it) and it is a live region, and it had no name at all: measured with
   * Tab on the packaged build, Chromium's accessibility tree gave it role "log"
   * and name "" -- Narrator announces that as the word "log" and nothing else,
   * on the one panel this screen is mostly made of.
   *
   * It is `aria-labelledby` pointing at the heading already above it, not a
   * hand-written aria-label, because that heading is REWRITTEN on every render
   * ("No agents have run here yet", "This box is set to show nothing", the
   * conversation's own title...). A second copy of that sentence in an
   * attribute would be the version that goes stale.
   *
   * The id is per-instance. The router can have two home views mounted at once
   * during a transition -- src/views/setup.js records that measurement -- and
   * two elements sharing one id makes the reference ambiguous exactly when a
   * screen reader is most likely to be reading it. */
  const panelTitleId = `home-panel-title-${panelInstances += 1}`
  const root = el(`
    <div class="home" data-mode="loading">
      <div class="home-ring-wrap"></div>
      <div class="home-feed-wrap">
        <span class="brace" aria-hidden="true">${BRACE_SVG}</span>
        <div class="home-feed">
          <div class="session-head">
            <span data-panel-title id="${panelTitleId}"></span>
            <span class="panel-badge" data-panel-badge hidden></span>
          </div>
          <div class="session-view">
            <div class="session-log" tabindex="0" role="log" aria-labelledby="${panelTitleId}"></div>
          </div>
          <div class="session-foot" data-panel-foot hidden></div>
          <!-- THE DOOR TO THE SUBSCRIPTION PAGE, and the only one on this
               screen. #/subscribe was routed and linked from nowhere, so the
               page that takes a subscription could only be reached by typing
               its address. It sits inside the panel rather than beside the
               ring because the ring is what this copy is doing right now and
               this is not that; and it is unconditional, because a door that
               appears only in some states is one a person cannot learn. Its
               words come from COPY like every other sentence here. -->
          <div class="home-doors">
            <a class="home-door" data-door-subscribe></a>
          </div>
        </div>
        <span class="brace is-right" aria-hidden="true">${BRACE_SVG}</span>
      </div>
    </div>
  `)

  const feed = root.querySelector('.home-feed')
  const logEl = root.querySelector('.session-log')
  /* THE BOX HAS TWO HALVES NOW, so the log has a slot for each rather than one
     body that every renderer wipes. The runs half and the conversation half are
     independently switchable, and they update at different rates: a rebuild of
     the whole log on every arriving message would fight the scroll pin and
     re-animate lines a person is in the middle of reading. */
  const noticeSlot = el('<div class="log-notices"></div>')
  const runsSlot = el('<div class="log-runs"></div>')
  const turnsSlot = el('<div class="log-turns"></div>')
  logEl.append(noticeSlot, runsSlot, turnsSlot)
  const panelTitle = root.querySelector('[data-panel-title]')
  const panelBadge = root.querySelector('[data-panel-badge]')
  const panelFoot = root.querySelector('[data-panel-foot]')

  const subscribeDoor = root.querySelector('[data-door-subscribe]')
  subscribeDoor.href = COPY.subscribeDoor.href
  subscribeDoor.textContent = COPY.subscribeDoor.label

  /* ------------------------------------------------------------------
     The hero ring.
     ------------------------------------------------------------------ */
  const ringSize = Math.min(520, Math.max(380, window.innerHeight - 300))
  const ring = uptimeRing({ size: ringSize, epoch: Date.now(), caption: '', sub: '', crescent: true })
  ring.el.dataset.load = 'unknown'
  root.querySelector('.home-ring-wrap').appendChild(ring.el)

  const captionEl = ring.el.querySelector('.uring-caption')
  const digitsEl = ring.el.querySelector('.uring-digits')
  const innerEl = ring.el.querySelector('.uring-inner')
  /* uptimeRing only emits `.uring-sub` when it is given text at construction,
     and this view has none until a source answers. Create it once here rather
     than passing placeholder text that would paint and then be replaced. */
  const subEl = el('<div class="uring-sub"></div>')
  innerEl.appendChild(subEl)

  const factsEl = el('<div class="home-facts"></div>')
  innerEl.appendChild(factsEl)

  const UNITS = [['d', 'Days'], ['h', 'Hours'], ['m', 'Minutes'], ['s', 'Seconds']]
  digitsEl.innerHTML = UNITS
    .map(([, label]) => `<span class="seg"><span class="n-stack"><span class="n cur">0</span></span><span class="u">${label}</span></span>`)
    .join('<span class="colon">:</span>')
  const stacks = [...digitsEl.querySelectorAll('.n-stack')]

  function setDigit(stack, value) {
    const last = stack.lastElementChild
    if (!last || last.textContent === value) return
    const outgoing = [...stack.children]
    const next = document.createElement('span')
    next.className = 'n next'
    next.textContent = value
    stack.appendChild(next)
    outgoing.forEach(n => { n.classList.remove('cur', 'next', 'in'); n.classList.add('out') })
    requestAnimationFrame(() => requestAnimationFrame(() => next.classList.add('in')))
    const finish = () => {
      outgoing.forEach(n => n.remove())
      stack.querySelectorAll('.n.out').forEach(n => n.remove())
      next.classList.remove('next', 'in'); next.classList.add('cur')
    }
    const tid = setTimeout(finish, 420)
    next.addEventListener('transitionend', () => { clearTimeout(tid); finish() }, { once: true })
  }

  function elapsedParts(epoch) {
    let s = Math.max(0, Math.floor((Date.now() - epoch) / 1000))
    const d = Math.floor(s / 86400); s -= d * 86400
    const h = Math.floor(s / 3600); s -= h * 3600
    const m = Math.floor(s / 60); s -= m * 60
    const pad = (n) => String(n).padStart(2, '0')
    return [String(d), pad(h), pad(m), pad(s)]
  }

  /* ------------------------------------------------------------------
     The braces.
     ------------------------------------------------------------------ */
  const braces = [...root.querySelectorAll('.brace')]
  braces.forEach(b => b.addEventListener('animationend', () => b.classList.remove('brace-pulse')))
  const pulseBraces = () => {
    braces.forEach(b => { b.classList.remove('brace-pulse'); void b.offsetWidth; b.classList.add('brace-pulse') })
  }

  /* ------------------------------------------------------------------
     Scroll pinning for the panel. The seeded history renders while the view is
     still DETACHED (the router mounts it after assembly), where scrollHeight is
     0 and any snap is a no-op — so the panel keeps the standard chat contract
     instead: pinned to the newest line through every resize and append,
     unpinned the moment the reader scrolls up, re-pinned on return.
     ------------------------------------------------------------------ */
  let destroyed = false
  let pinned = true
  logEl.addEventListener('scroll', () => {
    pinned = logEl.scrollTop >= logEl.scrollHeight - logEl.clientHeight - 24
  }, { passive: true })
  const pinToBottom = () => {
    if (!destroyed && pinned && logEl.scrollHeight) logEl.scrollTop = logEl.scrollHeight
  }
  const anchorRo = new ResizeObserver(pinToBottom)
  anchorRo.observe(logEl)
  const anchorMo = new MutationObserver(pinToBottom)
  anchorMo.observe(logEl, { childList: true })
  /* ...and the webfont swap, the one growth path with NO mutation and NO box
     resize. `fonts.ready` may settle while the assembled view is detached, so
     its immediate measurement is still zero. Re-elect the pin after two painted
     frames, and repeat for any later font-loading generation. */
  let firstPinFrame = 0
  let settledPinFrame = 0
  const pinAfterMount = () => {
    /* ONE HANDLE SLOT, THREE CALLERS -- and on a frameless page that was a
       leak with a number. pinAfterMount runs immediately, again from
       fonts.ready, and again on every later loadingdone; each call overwrites
       these two slots, so destroy() below can only cancel the LAST pair and
       any earlier frame stays queued holding this whole view. On a page that
       never gets a frame nothing ever drains that queue: measured at +3
       pending frames per lap of the ring, the last site still accumulating
       after the other four were fixed. onNextFrame queues nothing on such a
       page -- it pins at once off a flushed layout -- and is the ordinary
       requestAnimationFrame, handles and all, when the page can draw. */
    firstPinFrame = onNextFrame(() => {
      settledPinFrame = onNextFrame(pinToBottom)
    })
  }
  const onFontsLoaded = () => pinAfterMount()
  document.fonts?.addEventListener?.('loadingdone', onFontsLoaded)
  document.fonts?.ready?.then(pinAfterMount)
  pinAfterMount()

  /* ------------------------------------------------------------------
     Everything this screen knows. One object, so describeHome() sees the whole
     picture at once and no part of the screen can answer from a source the rest
     cannot see — which is precisely how the contradictory pair got in.
     ------------------------------------------------------------------ */
  const state = {
    sample,
    fleetConfigured,
    fleetHealth: null,
    peer: null,
    /* `undefined` is the honest starting value: nobody has been asked yet, and
       it is NOT the same as having asked and been refused. Nothing renders
       until the first answers land (see `settle` below), so this state is never
       painted -- but it must still be truthful, because a source that never
       answers leaves it in place. */
    sessions: readLocalSessions(undefined),
    engine: readAgentEngine(undefined),
    /* Null until loadProviders() answers, and null means "not asked" rather than
       "nobody is signed in" -- so the first paint says exactly what it said
       before this screen learned to ask, instead of a verdict nothing measured. */
    providers: null,
    approvals: null,
    /* What the person chose on the settings page, plus who is actually talking
       in whatever conversation this screen has. The decision needs both: the
       first says which agents may appear, the second is what it is filtering,
       and only their combination can tell "nobody is talking" apart from
       "everybody talking is switched off". */
    chatbox: {
      runsMode: readRunsMode(),
      selection: readAgentSelection(),
      agentsInSource: [],
    },
    nowMs: Date.now(),
  }

  /* The conversation, held rather than painted straight into the log, so that
     changing the agent selection re-filters what is already here instead of
     needing the source read again. */
  let contextTurns = []

  /* WHAT EACH SESSION'S TURNS COST, from the signed per-turn record, grouped by
     the key the run record is keyed on. Empty until the record answers, and an
     empty map simply renders the rows this screen rendered before it existed. */
  const usageBySession = new Map()
  /* WHAT THIS WINDOW IS WATCHING HAPPEN, per session: the turn the engine named,
     the words of it so far, and whether it is still going. Nothing in here is
     read off a record and nothing in here is written to one. It is this window's
     own observation of the stream, and it is gone when the view is. */
  const liveSessions = new Map()

  function noteContext(turns) {
    contextTurns = Array.isArray(turns) ? turns : []
    state.chatbox = { ...state.chatbox, agentsInSource: agentIdsFromTurns(contextTurns) }
  }

  function readChatboxSettings() {
    state.chatbox = {
      ...state.chatbox,
      runsMode: readRunsMode(),
      selection: readAgentSelection(),
    }
  }

  const timers = []
  let clockEpoch = null
  let raf = 0
  let lastTickAt = 0
  let renderedPanelKind = null

  function stopClock() {
    if (raf) { cancelAnimationFrame(raf); raf = 0 }
  }
  /* The clock runs only when it has a real instant to count from. Four dashes
     under the word SECONDS is a broken clock, and a person reads it as one. */
  function startClock(epoch) {
    clockEpoch = epoch
    if (epoch == null) {
      stopClock()
      digitsEl.hidden = true
      return
    }
    digitsEl.hidden = false
    if (raf) return
    const loop = (ts) => {
      if (clockEpoch != null && ts - lastTickAt >= 250) {
        lastTickAt = ts
        elapsedParts(clockEpoch).forEach((v, i) => setDigit(stacks[i], v))
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
  }

  const TONE_COLOR = { good: 'var(--s-good)', warn: 'var(--s-warn)', neutral: 'var(--ink-4)' }

  /* Nothing is painted until the two local reads have answered.
   *
   * Not a nicety: this screen's whole job is to say one true thing, and for the
   * first few hundred milliseconds of a launch it does not yet know which one
   * that is. Rendering an interim guess means flashing "the record could not be
   * read" at a person whose record is about to load perfectly -- which is the
   * same class of defect as the pair this rewrite exists to remove, just
   * shorter-lived. The ring holds its rim and the panel holds its frame; both
   * are already the screen's real furniture, so the wait reads as the page
   * arriving rather than as a spinner. */
  let awaitingFirstAnswers = 2
  function settle() {
    if (awaitingFirstAnswers > 0) awaitingFirstAnswers -= 1
    apply()
  }

  function apply() {
    if (destroyed || awaitingFirstAnswers > 0) return
    state.nowMs = Date.now()
    const view = describeHome(state)
    root.dataset.mode = view.mode
    /* Two layout signals, not decoration. A panel holding an empty state must
       shrink to it, or the braces bracket six hundred pixels of nothing and the
       calm empty state reads as a container that failed to fill. Likewise the
       ring gives its middle back to the headline when there are no digits in
       it. Both are stated here because only this function knows. */
    root.dataset.panel = view.panel.empty ? 'empty' : view.panel.kind
    root.dataset.clock = view.clock == null ? 'none' : 'running'

    captionEl.textContent = view.caption
    subEl.textContent = view.headline || ''
    startClock(view.clock)

    /* The crescent's colour is the only thing on this page that carries state by
       hue, so it answers the same question the sentences do rather than a
       second one: something needs attention, something is working, or there is
       nothing to report. */
    ring.el.dataset.load = ringLoad(view)

    factsEl.replaceChildren(...view.facts.map(fact => {
      const node = el(fact.href
        ? `<a class="home-fact" href="${fact.href}"><i></i><span></span></a>`
        : `<div class="home-fact"><i></i><span></span></div>`)
      node.querySelector('i').style.background = TONE_COLOR[fact.tone] || TONE_COLOR.neutral
      node.querySelector('span').textContent = fact.text
      return node
    }))

    panelTitle.textContent = view.panel.title
    panelBadge.hidden = !view.panel.badge
    if (view.panel.badge) panelBadge.textContent = view.panel.badge
    panelFoot.hidden = !view.panel.footer
    if (view.panel.footer) panelFoot.textContent = view.panel.footer

    renderPanel(view)
    ensureComposer(view)
  }

  function ringLoad(view) {
    if (view.mode === HOME_MODES.FLEET) {
      const { down, unknown } = state.fleetHealth
      return down > 0 ? 'peak' : (unknown > 0 ? 'busy' : 'idle')
    }
    if (view.mode === HOME_MODES.FLEET_UNREACHABLE) return 'busy'
    if (!state.engine.ready) return 'busy'
    return view.mode === HOME_MODES.LOCAL ? 'idle' : 'unknown'
  }

  /* ------------------------------------------------------------------
     The panel body. Only re-rendered when the KIND changes; a runs list that
     rebuilt itself on every poll would fight the scroll pin and re-animate
     lines a person is reading.
     ------------------------------------------------------------------ */
  function renderPanel(view) {
    renderNotices(view)
    renderRuns(view)
    renderContext(view)
  }

  /* ---- the notices, which belong to the box rather than to either half ---- */
  let noticeSignature = null
  function renderNotices(view) {
    const notices = [view.panel.contextEmpty, view.panel.empty].filter(Boolean)
    const signature = notices.map(notice => notice.title).join('/')
    if (noticeSignature === signature) return
    noticeSignature = signature
    noticeSlot.replaceChildren()
    for (const notice of notices) showNotice(notice.title, notice.body, false, notice.action)
  }

  /* ---- the runs half ---- */
  /* WHAT THIS COMPUTER SAVED ABOUT EACH SESSION, keyed the way the run record
   * is keyed. This is the join behind "which agent, and what was it asked".
   *
   * READ, NEVER WRITTEN, AND NEVER REQUIRED. Every failure here -- no storage,
   * a key that will not parse, a record from a build with a different shape --
   * costs this list its two extra lines and nothing more; parseFleetTrees
   * refuses a record whole rather than repairing it, and an empty map simply
   * renders the rows this screen has always rendered. So a person whose trees
   * are damaged still sees their run history.
   *
   * THE PREFIX COMES FROM THE MODULE THAT OWNS THE KEY. fleetTreesStorageKey('')
   * is that module's own answer to "where do these live", so this file holds no
   * second copy of a storage key to go stale.
   *
   * `length`/`key(i)` AND NOT Object.keys, and this is the line that was
   * measured wrong first. In this application `localStorage` is not Storage:
   * public/durable-storage.js replaces the global with a durable shim over the
   * settings file, because the origin here carries a scanned port number and a
   * relaunch on a different port looked exactly like a factory reset. The shim
   * exposes the Storage METHODS and nothing else -- so `Object.keys(store)`
   * answers ["getItem","setItem","removeItem","clear","key","length"] and finds
   * no saved conversation ever. Every row silently lost its two extra lines,
   * and every unit test passed, because in a plain browser the global is left
   * alone and Object.keys is right there. Caught only by driving the packaged
   * build: tools/home-activity-substance-qa.mjs.
   *
   * Re-read on every repaint rather than cached: the computers page writes to
   * this same storage in another view of the same window, and a map captured at
   * mount would go stale the first time somebody started an agent. It is a
   * handful of small keys parsed at most once a repaint, and the repaint is
   * already gated by the signature above. */
  /* Re-read when a record changed and not on every repaint. The computers page
     writes these keys from another view of the same window, so a map captured
     once at mount would go stale the first time somebody started an agent --
     but that page is not on screen while this one is, so the moments it can
     change are exactly the moments this screen re-reads the ledger anyway.
     `transcripts: true` is what makes "what it said" reachable for a node whose
     own reply field is empty. */
  let conversations = null
  function readConversations() {
    conversations = readSessionRoles(typeof window === 'undefined' ? null : window.localStorage, { transcripts: true })
  }

  /* ---- ONE RUN, AS A FLOW RATHER THAN AS A LINE IN A LOG ----
   *
   * THE REPORT THIS IS FOR, in the owner's words: "on page 1 this is supposed
   * to be a context flow of all the agents and such we want to see their
   * outputs cleanly." What was there was a row per run carrying a number, a
   * verb and a relative time, and it could not have carried an output however
   * long anybody waited: the join took the role and the brief off the node and
   * never read `reply`, which is the field that exists on the node for exactly
   * this purpose.
   *
   * SO EACH ROW NOW ANSWERS FOUR QUESTIONS, and every one of them is read off
   * something already written down:
   *
   *   what was asked   the brief the person typed into the node
   *                    (src/session-roles.js, the saved conversations)
   *   what it did      turns, model and tokens from the per-turn record
   *                    (shell/usage-record.cjs, read through readLocalUsage)
   *   what it said     the live stream while a turn is running, then the node's
   *                    own reply, then the last agent line in the saved
   *                    conversation
   *   what happened    the signed run record, exactly as before
   *
   * AND WHERE A PIECE GENUINELY IS NOT THERE THE ROW SAYS SO. A run started
   * from the agent page mints a session and writes it to the record and creates
   * no node at all, so it has no brief and no answer to join to -- that row says
   * that in one sentence rather than showing a gap that reads as a fault, and it
   * still shows what the turn record knows about it. Nothing here invents an ask
   * that was never recorded.
   *
   * THE ROW IS BUILT ONCE AND REPAINTED IN PLACE. Every line exists in the
   * markup and is hidden when there is nothing for it, so a word arriving from a
   * live agent is a textContent write on one span rather than a rebuild of the
   * list -- which would fight the scroll pin and re-animate rows a person is
   * reading. */
  function buildRunRow() {
    const row = el(`<li class="home-run">
      <span class="run-head"><span class="run-what"></span><span class="run-result"></span><span class="run-live" hidden></span></span>
      <span class="run-when"></span>
      <span class="run-agent" hidden></span>
      <span class="run-asked" hidden></span>
      <span class="run-did" hidden></span>
      <span class="run-said" hidden></span>
      <span class="run-why" hidden></span>
      <span class="run-gap" hidden></span>
    </li>`)
    return {
      el: row,
      what: row.querySelector('.run-what'),
      result: row.querySelector('.run-result'),
      live: row.querySelector('.run-live'),
      when: row.querySelector('.run-when'),
      agent: row.querySelector('.run-agent'),
      asked: row.querySelector('.run-asked'),
      did: row.querySelector('.run-did'),
      said: row.querySelector('.run-said'),
      why: row.querySelector('.run-why'),
      gap: row.querySelector('.run-gap'),
    }
  }

  /* A line carries its value or it is not there. `hidden` rather than removal so
     the row keeps its shape across repaints and a live word lands on a span that
     already exists. */
  function setLine(node, value) {
    node.textContent = value || ''
    node.hidden = !value
  }

  function paintRunRow(parts, run) {
    /* The run's own number, not a decorative index. It is the position in this
       computer's record, so it stays the same on every later visit and still
       means something after the list is truncated to its newest twenty. It also
       stops three runs started within a minute of each other from rendering as
       three identical rows reading "just now", which is honest and useless. */
    const live = run.sessionId ? liveSessions.get(run.sessionId) || null : null
    const work = run.sessionId ? summariseRunWork(usageBySession.get(run.sessionId)) : null
    const said = describeRun(run, conversations, state.nowMs, { work, live })

    parts.what.textContent = COPY.runLabel(said.sequence)
    /* Empty string for a run whose outcome was never recorded, and the
       data-attribute is set from the same value so the stylesheet cannot colour
       a row the copy declined to label. */
    parts.result.textContent = said.resultWord
    if (said.resultWord) parts.el.dataset.result = run.result
    else delete parts.el.dataset.result
    /* The one claim on this row that is not read back off a record: this window
       is watching that session's turn arrive, right now. It says what is
       happening and never how long it has been happening, because nothing
       writes down when a run ends. */
    setLine(parts.live, said.working ? COPY.runWorkingNow : '')
    parts.when.textContent = said.when
    /* The exact instant on hover. The row itself stays relative, because a
       column of timestamps is a log and this is a list of what happened. */
    if (said.at) parts.when.title = said.at
    setLine(parts.agent, said.agent)
    setLine(parts.asked, said.asked ? COPY.runAsked(said.asked) : '')
    setLine(parts.did, said.did || said.noWork)
    setLine(parts.said, said.said ? COPY.runSaid(said.said) : '')
    setLine(parts.why, said.why)
    setLine(parts.gap, said.gap)
  }

  let runsSignature = null
  /* The rows on the glass, by the run's own number, so a live word can find the
     one row it belongs to without walking the list. */
  const runRows = new Map()

  function renderRuns(view) {
    /* An empty runs half that is standing beside a conversation says so in the
       notice slot, not by replacing the list; an empty runs half on its own IS
       the box, and the notice is the whole of it. Either way the list itself is
       what this renders. */
    const listed = view.panel.runs && !view.panel.empty ? state.sessions.runs : []
    /* The outcome is part of the signature, not just the sequence. A run's row
       changes when its outcome lands, and a signature built from sequences
       alone would decide nothing had changed and leave the stale row up.
       WHAT IS DELIBERATELY NOT IN IT: anything that arrives on the live stream.
       A signature carrying the words an agent is saying would rebuild the whole
       list on every delta, which is the churn this gate exists to prevent. Those
       land through paintRunRow on the row they belong to. */
    const signature = `${view.panel.runs}|${listed.map(run => `${run.sequence}:${run.result || ''}`).join(',')}`
    if (runsSignature !== signature) {
      runsSignature = signature
      runRows.clear()
      runsSlot.replaceChildren()
      if (listed.length) {
        const list = el(`<ol class="home-runs"></ol>`)
        for (const run of listed) {
          const parts = buildRunRow()
          runRows.set(run.sequence, parts)
          list.appendChild(parts.el)
        }
        runsSlot.appendChild(list)
      }
    }
    for (const run of listed) {
      const parts = runRows.get(run.sequence)
      if (parts) paintRunRow(parts, run)
    }
  }

  /* ---- THE FLOW'S LIVE HALF ----
   *
   * One repaint of the rows a live session touched, on a trailing timer, so a
   * turn arriving forty words a second is a handful of repaints rather than
   * forty. Nothing is read off a record here. */
  let liveRepaintTimer = 0
  const dirtySessions = new Set()
  function paintLiveSoon(sessionId) {
    dirtySessions.add(sessionId)
    if (liveRepaintTimer) return
    liveRepaintTimer = setTimeout(() => {
      liveRepaintTimer = 0
      if (destroyed) return
      const touched = new Set(dirtySessions)
      dirtySessions.clear()
      for (const run of state.sessions.runs) {
        if (!run.sessionId || !touched.has(run.sessionId)) continue
        const parts = runRows.get(run.sequence)
        if (parts) paintRunRow(parts, run)
      }
    }, LIVE_REPAINT_MS)
  }

  /* ---- the conversation half ----
     `contextNotice` is what the SOURCE has to say for itself while it loads,
     fails, or turns out to be empty. Deliberately not part of the decision:
     those states depend on the moment rather than on what is true of the
     machine, which is why this copy has always lived in the view. */
  let contextNotice = null
  function renderContext(view) {
    const kind = view.panel.kind
    if (renderedPanelKind !== kind) {
      renderedPanelKind = kind
      turnsSignature = null
      contextNotice = null
      if (kind === 'sample') {
        noteContext(SESSION)
        if (!SESSION.length) contextNotice = COPY.sampleEmpty
        if (ARRIVALS.length) scheduleArrival(true)
      } else if (kind === 'conversation') {
        noteContext([])
        contextNotice = { ...COPY.conversationLoading, loading: true }
        void loadCoordinatorThread()
      } else {
        noteContext([])
      }
    }
    paintTurns(kind)
    pinAfterMount()
  }

  /* Repainted from the held conversation whenever the agent selection moves, so
     the setting takes effect on what is already on the screen rather than only
     on whatever arrives next. */
  let turnsSignature = null
  function paintTurns(kind) {
    const shown = kind === 'none' ? [] : filterTurns(contextTurns, state.chatbox.selection)
    const signature = [kind, contextNotice ? contextNotice.title : '', ...shown.map(turn => turn.id || turn.text)].join()
    if (turnsSignature === signature) return
    turnsSignature = signature
    const wasAt = logEl.scrollTop
    turnsSlot.replaceChildren()
    if (kind !== 'none' && !shown.length && contextNotice) {
      turnsSlot.appendChild(noticeNode(contextNotice.title, contextNotice.body, contextNotice.loading === true, null))
    }
    for (const turn of shown) {
      addTurn(turn.who || turn.sender, turn.text, turn.fresh === true)
      if (turn.fresh) delete turn.fresh
    }
    if (kind === 'none') {
      /* A list reads from the top; a transcript reads from the bottom. */
      pinned = false
      logEl.scrollTop = 0
      return
    }
    if (!pinned) logEl.scrollTop = wasAt
  }

  function noticeNode(title, body, loading = false, action = null) {
    return el(
      `<div class="projection-state${loading ? ' is-loading' : ''}" role="status">`
      + `<strong>${escText(title)}</strong><span>${escText(body)}</span>`
      + (action ? `<a class="home-next" href="${escText(action.href)}">${escText(action.label)}</a>` : '')
      + '</div>',
    )
  }

  function showNotice(title, body, loading = false, action = null) {
    noticeSlot.appendChild(noticeNode(title, body, loading, action))
    pinned = true
  }

  function addTurn(who, text, fresh = false) {
    const meta = SPEAKERS[who] || { cls: 'is-agent', label: who }
    const dot = meta.hue ? `<i class="turn-dot" style="background:${meta.hue}"></i>` : ''
    const label = meta.label ? `<span class="turn-who">${dot}${escText(meta.label)}</span>` : ''
    const node = el(`<div class="turn ${meta.cls}${fresh ? ' fresh' : ''}">${label}<div class="turn-text">${escText(text)}</div></div>`)
    turnsSlot.appendChild(node)
    return node
  }

  /* One arriving line, added to the held conversation and then painted through
     the same filter as everything else: an agent the person switched off does
     not get to appear merely because it spoke recently. */
  function receiveTurn(who, text) {
    noteContext([...contextTurns, { who, text, fresh: true }])
    contextNotice = null
    apply()
  }

  /* ------------------------------------------------------------------
     The composer. It exists only where it does something: a person can type
     into it and a message goes somewhere. An input that accepts nothing is
     worse than no input, which is what "Read-only projection" was — a
     placeholder describing the reason the box in front of you is inert.
     ------------------------------------------------------------------ */
  let composerEl = null
  let writeStateEl = null
  let inputEl = null
  let sendButtonEl = null

  function ensureComposer(view) {
    const wanted = view.composer
    if (!wanted) {
      if (composerEl) { composerEl.remove(); composerEl = null }
      if (writeStateEl) { writeStateEl.remove(); writeStateEl = null }
      inputEl = null
      sendButtonEl = null
      return
    }
    if (composerEl) return
    const placeholder = view.mode === HOME_MODES.SAMPLE
      ? COPY.composerSample(composerTarget)
      : COPY.composerLive(composerTarget)
    composerEl = el(`
      <div class="chat-input session-input">
        <input type="text" placeholder="${escText(placeholder)}" aria-label="${escText(placeholder)}" />
        <button class="chat-send" aria-label="Send">
          <svg viewBox="0 0 24 24"><path d="M5 12h13M13 6.5 18.8 12 13 17.5" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>`)
    feed.insertBefore(composerEl, panelFoot)
    inputEl = composerEl.querySelector('input')
    sendButtonEl = composerEl.querySelector('.chat-send')
    sendButtonEl.addEventListener('click', () => { void send() })
    inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void send() } })

    if (view.mode !== HOME_MODES.SAMPLE) {
      /* The audited path. Until the bridge confirms it will take a message the
         controls are disabled and say why in one short sentence — not in the
         placeholder, which is a label for the box and not a status line. */
      writeStateEl = el(`<div class="session-write-state" data-state="checking" role="status">${escText(COPY.replyChecking)}</div>`)
      composerEl.insertAdjacentElement('afterend', writeStateEl)
      inputEl.disabled = true
      sendButtonEl.disabled = true
      /* THE SWITCH IS ASKED ABOUT FIRST, and it was not before.
         `send()` has always returned early when replying is switched off, but
         the enable below was gated only on whether the message could be
         CARRIED. So with the shipped defaults the box asked the bridge, was
         told yes, enabled the input and printed "Replies will be sent and
         recorded" over a control that discarded every keystroke. Found by the
         page 2 lane asking what this composer actually posts into. */
      if (!writeReplyEnabled) {
        writeStateEl.dataset.state = 'off'
        writeStateEl.textContent = COPY.replyDisabled
        return
      }
      void bridgeStatus().then(result => {
        if (destroyed || !writeStateEl) return
        if (!result.ok) {
          writeStateEl.dataset.state = 'unavailable'
          writeStateEl.textContent = COPY.replyUnavailable
          return
        }
        writeStateEl.dataset.state = 'ready'
        writeStateEl.textContent = result.channels?.discord?.ok === false
          ? COPY.replyReadyOneChannelOffline
          : COPY.replyReady
        inputEl.disabled = false
        sendButtonEl.disabled = false
      })
    }
  }

  const drawReply = makeBag(REPLIES)
  const drawReplyAct = makeBag(REPLY_ACTS)

  async function send() {
    if (!inputEl) return
    const v = inputEl.value.trim()
    if (!v) return

    if (!sample) {
      if (!writeReplyEnabled || inputEl.disabled) return
      inputEl.disabled = true
      sendButtonEl.disabled = true
      writeStateEl.dataset.state = 'pending'
      writeStateEl.textContent = COPY.replySending
      const result = await postBridgeAction('thread-reply', {
        idempotencyKey: crypto.randomUUID(),
        threadId: 'owner-thread',
        message: v,
      })
      if (destroyed || !writeStateEl) return
      if (!result.ok) {
        writeStateEl.dataset.state = 'refused'
        writeStateEl.textContent = COPY.replyRefused
      } else {
        inputEl.value = ''
        receiveTurn(result.receipt.actor || composerTarget, v)
        pulseBraces()
        writeStateEl.dataset.state = 'confirmed'
        writeStateEl.textContent = COPY.replySent
      }
      inputEl.disabled = false
      sendButtonEl.disabled = false
      inputEl.focus()
      return
    }

    inputEl.value = ''
    receiveTurn('owner', v)
    /* Sometimes the tool line the coordinator ran to answer arrives first —
       that beat is what makes the reply read as work done, not text served. */
    const withAct = REPLY_ACTS.length > 0 && Math.random() < 0.35
    const replyAt = 1100 + Math.random() * 1100
    if (withAct) timers.push(setTimeout(() => receiveTurn('act', drawReplyAct()), replyAt - 550))
    timers.push(setTimeout(() => {
      receiveTurn(composerTarget, REPLIES.length ? drawReply() : COPY.sampleNoReply)
      pulseBraces()
    }, replyAt + (withAct ? 500 : 0)))
  }

  /* ---- the demonstration's live continuation: rare, whole-message arrivals ---- */
  const drawArrival = makeBag(ARRIVALS)
  const scheduleArrival = (first = false) => {
    const t = setTimeout(() => {
      if (destroyed || renderedPanelKind !== 'sample') return
      const turn = drawArrival()
      receiveTurn(turn.who, turn.text)
      pulseBraces()
      scheduleArrival()
    }, first ? 10_000 + Math.random() * 12_000 : 24_000 + Math.random() * 24_000)
    timers.push(t)
  }

  /* ------------------------------------------------------------------
     Sources.
     ------------------------------------------------------------------ */
  async function loadCoordinatorThread() {
    const result = await fetchCoordinator()
    if (destroyed || renderedPanelKind !== 'conversation') return
    if (!result.ok) {
      contextNotice = COPY.conversationUnreachable
      apply()
      return
    }
    const thread = result.data.data.thread
    if (!thread.ok || !thread.value.length) {
      contextNotice = COPY.conversationEmpty
      apply()
      return
    }
    /* Held rather than painted: the agent selection is applied to it on the way
       to the screen, and re-applied whenever that selection moves, without this
       source being read again. */
    contextNotice = null
    noteContext(thread.value)
    pinned = true
    apply()
    pinAfterMount()
  }

  async function loadHealth() {
    const result = await fetchStatus()
    if (destroyed) return
    if (!result.ok) {
      state.fleetHealth = null
      state.peer = null
      apply()
      return
    }
    const { health, peerLink } = result.data
    state.fleetHealth = health?.available
      ? {
        available: true,
        atMs: health.observedAtMs,
        total: health.total,
        ok: health.counts.OK,
        down: health.counts.DOWN + health.counts.STOPPED,
        unknown: health.counts.UNKNOWN + health.counts.OTHER,
      }
      : null
    const out = peerLink?.outbound
    state.peer = out?.available
      ? { reachable: true, name: out.peerHost || 'your other computer', atMs: out.authenticatedAtMs }
      : null
    apply()
  }

  /* Both of these always report, including "there was nobody to ask" — a load
     that returns early without touching state would leave the first-paint gate
     closed forever, and the screen would never appear at all. */
  async function loadSessions(first = false) {
    /* Three cases, and conflating the last two would make this screen lie.
       No bridge at all is a plain browser: there is no computer here to report
       on. A bridge WITHOUT this channel is an installed copy older than the
       channel -- there is a computer, its record exists, and this copy cannot
       read it. Saying "you are in a browser" to someone sitting in front of the
       application would be the same class of untrue statement this rewrite
       exists to remove. */
    const bridge = globalThis.mcAgent
    let raw
    if (!bridge) raw = undefined
    else if (typeof bridge.history !== 'function') raw = null
    else {
      try { raw = await bridge.history({ limit: 20 }) } catch { raw = null }
    }
    if (destroyed) return
    state.sessions = readLocalSessions(raw)
    /* Read beside the ledger and never inside a repaint. The two are one join,
       so reading them at different moments is how a row comes to show a run
       whose conversation this screen has not looked for yet. */
    readConversations()
    if (first) settle()
    else apply()
  }

  /* THE PER-TURN RECORD, WHICH IS WHERE "WHAT IT DID" COMES FROM.
   *
   * Deliberately NOT part of the first-paint gate. This screen's job is to say
   * one true thing quickly, and a row without its turn line is a row that is
   * merely shorter -- holding the whole screen back for it would trade a real
   * defect for a slower launch. It lands, the rows repaint, and a copy whose
   * shell is older than this record simply never gets the line.
   *
   * Grouped by session here rather than in the reader, because the reader is
   * shared with the metrics page and that page groups the same rows four other
   * ways. */
  async function loadUsage() {
    const read = await readLocalUsage({ agent: globalThis.mcAgent })
    if (destroyed) return
    usageBySession.clear()
    if (read.readable === true) {
      for (const turn of read.turns) {
        if (!turn.sessionId) continue
        const rows = usageBySession.get(turn.sessionId)
        if (rows) rows.push(turn)
        else usageBySession.set(turn.sessionId, [turn])
      }
    }
    apply()
  }

  async function loadEngine() {
    const bridge = globalThis.mcAgent
    let raw
    if (!bridge || typeof bridge.availability !== 'function') raw = undefined
    else {
      try { raw = await bridge.availability() } catch (error) { raw = { ok: false, code: error?.code } }
    }
    if (destroyed) return
    state.engine = readAgentEngine(raw, isWriteEnabled('agent-session'))
    settle()
  }

  /* IS ANYBODY ACTUALLY SIGNED IN TO THE PROGRAM THAT RUNS AN AGENT.
   *
   * availability() above answers whether this INSTALLATION can start anything,
   * and shell/agent-host.cjs opens that on a Claude start being possible --
   * proved as the payload carrying the engine plus the `claude` program
   * resolving, never on a sign-in. Home was rendering that as a fact about the
   * computer, so a machine with nothing signed in to either provider showed a
   * green tick while the setup review one screen earlier said an agent could not
   * yet run and the press then refused for exactly that reason.
   *
   * NOTHING NEW IS PROBED. mcProviders.presence() is already on this preload and
   * src/setup-review-readiness.js already asks it one screen earlier; home is
   * the surface that never asked. The judgement lives in providerSignInReading()
   * beside the rest of the availability vocabulary, so there is one reading of
   * "signed in" rather than one per screen.
   *
   * A REFUSAL IS SILENCE, NOT A VERDICT. No bridge, a rejected call, a reply of
   * the wrong shape: all leave `known:false`, and describeHome then says exactly
   * what it said before anyone asked. Never a warning built out of a failed
   * request. */
  async function loadProviders() {
    const bridge = globalThis.mcProviders
    let raw = null
    if (bridge && typeof bridge.presence === 'function') {
      try { raw = await bridge.presence() } catch { raw = null }
    }
    if (destroyed) return
    state.providers = providerSignInReading(raw)
    /* apply(), NOT settle(), and the difference is a race rather than a taste.
       `awaitingFirstAnswers` is a countdown of the TWO sources the first paint
       waits for; a third caller decrementing it would let whichever two answered
       first release the paint, so a slow loadSessions would be painted around
       instead of waited for. apply() early-returns while the count is still
       above zero, leaving this reading in `state` for the paint that does
       happen, and repaints if the answer lands later. It also declines to become
       a third way for a hung IPC to leave this screen blank forever. */
    apply()
  }

  /* Self-pacing rather than a fixed interval, so a machine with no queue is not
     charged twenty seconds of request forever, and a machine whose capability
     layer is still starting still picks the queue up once it answers. */
  let approvalsTimer = 0
  async function loadApprovals() {
    let raw
    try { raw = await ownerPromptSnapshot() } catch { raw = null }
    if (destroyed) return
    const readable = raw?.ok === true && Array.isArray(raw.prompts)
    /* Reconciled ONLY against a queue this call genuinely read. An unreadable
       snapshot prunes nothing and claims nothing: not knowing what is pending is
       not the same as knowing nothing is, and treating it as the latter would
       erase the record of a refused decision on the strength of a failed
       request. */
    state.approvals = readable
      ? {
        readable: true,
        count: raw.prompts.length,
        undelivered: reconcileUndeliveredDecisions(raw.prompts.map(prompt => prompt.id)),
      }
      : { readable: false, count: 0, undelivered: 0 }
    apply()
    approvalsTimer = setTimeout(() => { void loadApprovals() }, readable ? APPROVALS_POLL_MS : APPROVALS_RETRY_MS)
  }

  /* THERE IS STILL DELIBERATELY NO REFRESH ON WINDOW FOCUS, AND STILL NO POLL.
   *
     Reading the record means checking a signed chain, on the Electron main
     process, which is also what forwards output for every live agent session.
     Refreshing on focus therefore charged every running agent for the act of
     alt-tabbing back to the window -- measured by the performance lane at ~0.9s
     of whole-app stall on a ledger with ten thousand records. The cache in
     shell/spawn-record.cjs takes most of that cost away, but the honest fix is
     not to ask the question when there is no reason to.

     WHAT CHANGED, AND WHY IT DOES NOT BRING THAT COST BACK. The owner asked for
     a flow rather than a photograph, and the second half of the reasoning above
     turned out to be the part that was wrong: a run started on the computers
     page keeps running when a person walks back to this screen, so this view IS
     mounted while agents work, and the list simply never moved again.

     The repair is a SUBSCRIPTION, not a cadence. The window is already told
     every packet of every live session, and that stream carries the two things
     that change a record: a session nobody here has seen (a run was written
     down) and a turn that ended (a usage line was written down). So the records
     are read when one of those has just happened, at most once every four
     seconds, and at no other time. Alt-tabbing still costs nothing, an idle
     computer still costs nothing, and the words an agent is saying do not wait
     for a record at all -- they are painted off the stream. */

  /* The coalescing gate. Both reads are asked for by name so a burst of turn
     endings cannot turn into a burst of chain verifications, and so a new
     session does not drag the usage record along with it for no reason. */
  let ledgerTimer = 0
  let ledgerReadAt = 0
  let wantRuns = false
  let wantUsage = false
  function askForLedger({ runs = false, usage = false }) {
    wantRuns = wantRuns || runs
    wantUsage = wantUsage || usage
    if (ledgerTimer || (!wantRuns && !wantUsage)) return
    const wait = Math.max(0, LEDGER_REREAD_FLOOR_MS - (Date.now() - ledgerReadAt))
    ledgerTimer = setTimeout(() => {
      ledgerTimer = 0
      if (destroyed) return
      ledgerReadAt = Date.now()
      const runsWanted = wantRuns
      const usageWanted = wantUsage
      wantRuns = false
      wantUsage = false
      /* THE SAVED CONVERSATIONS MOVE WITH EITHER READ, and they did not, which
         cost a real run its brief on the glass. A run started from the tree
         writes its node a beat after the signed record has it, so the read that
         picks the RUN up is usually too early for the node -- and the only later
         read was the one that follows a turn ending, which used to fetch the
         turn record alone. The row therefore kept its answer and never gained
         the question. This is a walk of a handful of small keys on this
         computer, not a chain verification, so it costs nothing to do on both. */
      readConversations()
      if (runsWanted) void loadSessions()
      if (usageWanted) void loadUsage()
      if (!runsWanted && !usageWanted) apply()
    }, wait)
  }

  /* THE EAR ON THE SESSION STREAM. Read only through the shared readers, which
     is what stops this screen from having its own opinion about a packet shape
     it does not own. Every session is watched, not only ones this screen
     started, because this screen started none of them. */
  const onAgentPacket = (packet) => {
    if (destroyed) return
    const sessionId = packet && typeof packet.sessionId === 'string' ? packet.sessionId : ''
    if (!sessionId) return

    /* A session this list has never heard of means a run was written to the
       record after this screen last read it. That is the one thing that adds a
       row, so it is the one thing that asks for the run record again. */
    if (!state.sessions.runs.some(run => run.sessionId === sessionId)) askForLedger({ runs: true })

    const text = sessionEventText(packet, sessionId)
    const status = sessionTurnStatus(packet, sessionId)
    if (text === null && status === null) return

    const turnId = sessionEventTurnId(packet, sessionId)
    let live = liveSessions.get(sessionId)
    /* WHERE ONE TURN ENDS AND THE NEXT BEGINS, taken from the engine's own
       naming of the turn. Without it the previous turn's words survive into the
       next one and the row shows two answers run together -- the defect the
       tree page measured and fixed in its own transcript. */
    if (!live || (turnId && live.turnId && live.turnId !== turnId)) {
      live = { turnId: turnId || null, text: '', working: false }
      liveSessions.set(sessionId, live)
    }
    if (turnId && !live.turnId) live.turnId = turnId
    if (text !== null) {
      live.text += text
      live.working = true
    }
    if (status !== null) {
      /* The turn is over. The words STAY on the row -- they are what it said --
         and only the claim that it is still working is withdrawn. The figures
         for that turn have just been written down, so this is also the moment
         the usage record has something new in it. */
      live.working = false
      askForLedger({ usage: true })
    }
    paintLiveSoon(sessionId)
  }
  const detachAgentEvents = typeof window !== 'undefined'
    && window.mcAgent && typeof window.mcAgent.onEvent === 'function'
    ? window.mcAgent.onEvent(onAgentPacket)
    : null

  /* The two settings are changed on another screen, and this one is left
     mounted behind it, so the box has to re-read them when they move rather
     than only at mount. Same mechanism the live-source flags use. */
  const onChatboxSettings = () => {
    if (destroyed) return
    readChatboxSettings()
    apply()
  }
  window.addEventListener(CHATBOX_FEED_EVENT, onChatboxSettings)

  /* The case this exists for: he pressed Submit on #/approvals, pressed the
     arrow, and landed HERE — and only then did the bridge refuse. Waiting out
     this screen's own 20s poll before saying so would leave him looking at a
     screen that knows his decision did not land and is not telling him.
     Clamped to the count this screen actually read, so it can never report
     more failures than there are requests waiting. */
  const onApprovalOutcome = () => {
    if (destroyed || !state.approvals?.readable) return
    const undelivered = Math.min(undeliveredDecisionCount(), state.approvals.count)
    if (undelivered === state.approvals.undelivered) return
    state.approvals = { ...state.approvals, undelivered }
    apply()
  }
  window.addEventListener(APPROVAL_OUTCOME_EVENT, onApprovalOutcome)

  void loadEngine()
  void loadProviders()
  void loadSessions(true)
  void loadUsage()
  void loadApprovals()
  let healthTimer = 0
  if (fleetConfigured) {
    void loadHealth()
    healthTimer = setInterval(() => { void loadHealth() }, HEALTH_POLL_MS)
  }

  return {
    el: root,
    destroy() {
      destroyed = true
      stopClock()
      clearInterval(healthTimer)
      clearTimeout(approvalsTimer)
      clearTimeout(ledgerTimer)
      clearTimeout(liveRepaintTimer)
      timers.forEach(clearTimeout)
      /* The stream outlives this view: the sessions it carries belong to the
         shell, not to the page. A listener left attached here would keep the
         whole view alive for as long as any agent kept talking. */
      detachAgentEvents?.()
      anchorRo.disconnect()
      anchorMo.disconnect()
      cancelAnimationFrame(firstPinFrame)
      cancelAnimationFrame(settledPinFrame)
      window.removeEventListener(CHATBOX_FEED_EVENT, onChatboxSettings)
      window.removeEventListener(APPROVAL_OUTCOME_EVENT, onApprovalOutcome)
      document.fonts?.removeEventListener?.('loadingdone', onFontsLoaded)
      /* THE CRESCENT, WHICH NOTHING HAD EVER TAKEN DOWN.
       *
       * uptimeRing() mounts the corona and hands its teardown back as
       * root.destroyCrescent (src/components.js). Grepped across this tree
       * before this line existed, that property was written in exactly one
       * place and READ in none -- so every visit to this page built a corona
       * that was never dismantled.
       *
       * WHAT ONE UNCLOSED MOUNT LEAVES BEHIND, read off a staged packaged
       * build by instrumenting the page from before its first line ran
       * (tools/dom-retention-probe.mjs): two MutationObservers still watching
       * documentElement and body -- neither of which is ever collected, so
       * neither are their closures -- a transitionstart and a transitionend
       * listener on the colour probe, a webglcontextlost listener on the
       * canvas, and a WebGL context nobody released. Holding any node of a
       * tree holds the whole tree, so those observers kept a 132-node detached
       * copy of this ring alive, one more on every lap of the ring.
       *
       * MEASURED BEFORE AND AFTER THIS LINE, same probe, three laps:
       *   before  88 -> 94 -> 100 listeners, 4 -> 6 retained detached trees,
       *           8 observers nobody had disconnected and climbing
       *   after   76 / 76 / 76 listeners, 2 / 2 / 2 trees, 5 observers, flat
       *
       * IT IS ONE CALL, and the reason it was missing is that nothing forced
       * it: a teardown handed back as a property on a DOM element is a
       * teardown a caller can forget. Nothing in the unit suites can catch it
       * coming back -- this file needs a real document and a real GL context to
       * be wrong in this way -- so the probe above is the instrument that
       * would, and it is why that file exists. */
      ring.el.destroyCrescent?.()
    },
  }
}
