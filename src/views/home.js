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
import { isLiveView } from '../live-flags.js'
import { isWriteEnabled } from '../write-flags.js'
import { bridgeStatus, postBridgeAction } from '../mission-bridge.js'
import { FLEET, isSampleFleet } from '../fleet-profile.js'
import {
  COPY,
  HOME_MODES,
  describeHome,
  readAgentEngine,
  readLocalSessions,
  whenWords,
} from '../local-activity.js'
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
  /* A person chose the demonstration in Settings, or they did not. This is the
     ONLY thing that puts sample content on this screen, and it is the only
     thing that puts a badge on it. */
  const sample = !isLiveView('home')
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
    firstPinFrame = requestAnimationFrame(() => {
      settledPinFrame = requestAnimationFrame(pinToBottom)
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
  let runsSignature = null
  function renderRuns(view) {
    /* An empty runs half that is standing beside a conversation says so in the
       notice slot, not by replacing the list; an empty runs half on its own IS
       the box, and the notice is the whole of it. Either way the list itself is
       what this renders. */
    const listed = view.panel.runs && !view.panel.empty ? state.sessions.runs : []
    /* The outcome is part of the signature, not just the sequence. A run's row
       changes when its outcome lands, and a signature built from sequences
       alone would decide nothing had changed and leave the stale row up. */
    const signature = `${view.panel.runs}|${listed.map(run => `${run.sequence}:${run.result || ''}`).join(',')}`
    if (runsSignature === signature) return
    runsSignature = signature
    runsSlot.replaceChildren()
    if (!listed.length) return
    const list = el('<ol class="home-runs"></ol>')
    for (const run of listed) {
      /* The run's own number, not a decorative index. It is the position in
         this computer's record, so it stays the same on every later visit and
         still means something after the list is truncated to its newest twenty.
         It also stops three runs started within a minute of each other from
         rendering as three identical rows reading "just now", which is honest
         and useless. */
      const row = el('<li class="home-run"><span class="run-what"></span><span class="run-result"></span><span class="run-when"></span></li>')
      row.querySelector('.run-what').textContent = COPY.runLabel(run.sequence)
      /* Empty string for a run whose outcome was never recorded, and the
         data-attribute is set from the same value so the stylesheet cannot
         colour a row the copy declined to label. */
      const result = COPY.runResult(run.result)
      row.querySelector('.run-result').textContent = result
      if (result) row.dataset.result = run.result
      row.querySelector('.run-when').textContent = whenWords(state.nowMs - run.atMs) || COPY.runWhenUnknown
      list.appendChild(row)
    }
    runsSlot.appendChild(list)
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
    if (first) settle()
    else apply()
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

  /* THERE IS DELIBERATELY NO REFRESH ON WINDOW FOCUS, and it was removed rather
     than never written.
   *
     Reading the record means checking a signed chain, on the Electron main
     process, which is also what forwards output for every live agent session.
     Refreshing on focus therefore charged every running agent for the act of
     alt-tabbing back to the window -- measured by the performance lane at ~0.9s
     of whole-app stall on a ledger with ten thousand records. The cache in
     shell/spawn-record.cjs takes most of that cost away, but the honest fix is
     not to ask the question when there is no reason to.

     And there is no reason to: a run can only start from this application, from
     the agent page, which is a different route -- so this view is not mounted
     while one is being started, and its next mount reads the record fresh.
     Nothing can be missed by not asking on focus. */

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
  void loadSessions(true)
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
      timers.forEach(clearTimeout)
      anchorRo.disconnect()
      anchorMo.disconnect()
      cancelAnimationFrame(firstPinFrame)
      cancelAnimationFrame(settledPinFrame)
      window.removeEventListener(CHATBOX_FEED_EVENT, onChatboxSettings)
      window.removeEventListener(APPROVAL_OUTCOME_EVENT, onApprovalOutcome)
      document.fonts?.removeEventListener?.('loadingdone', onFontsLoaded)
    },
  }
}
