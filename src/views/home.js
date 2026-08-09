// /home — the giant hero ring + the coordinator's session thread.
//
// DATA WIRING NOTE: the RING still reads public/data/status.json (written by
// tools/gen-status.mjs from real, read-only fleet-host state) via
// src/live-status.js, and still refuses to invent a number when that file is
// missing. The THREAD between the braces is different on purpose: it is the
// PLAN.md simulation — a written coordinator session, like every other page's
// conversations — because the real coordinator's context never leaves its own
// machine. The two do not mix: live numbers feed the ring caption, the thread
// feeds nothing and reads from nothing.
//
// The thread replaced the one-line lane-activity ticker (and its
// click-to-open chat morph). The braces stay — they bracket the session
// context, which is the sketch's whole gesture — but what they bracket is now
// the session itself, fully expanded, at rest: directives, the coordinator's
// reasoning, delegations and report-backs, and the quiet tool-action lines a
// session transcript carries between turns.
//
// THE TRANSCRIPT IS PROFILE DATA (src/fleet-profile.js), and of everything the
// profile carries it is the piece that most needed to be. The set that used to
// sit in this file as literals was a written morning from one real fleet: an
// owner asking why a host went quiet, a coordinator answering with two port
// numbers, a named canonical checkout, real durable-memory keys, and an owner
// decision to retire a real machine at month-end. It shipped inside app.asar
// and it is the first screen a stranger sees. A scripted conversation is the
// hardest thing in this app to ship honestly, because a channel log reads as
// records and a transcript reads as people.

import { el, uptimeRing } from '../components.js'
import { fetchStatus, fetchCoordinator, ageMs, fmtAge } from '../live-status.js'
import { isLiveView } from '../live-flags.js'
import { isWriteEnabled } from '../write-flags.js'
import { bridgeStatus, postBridgeAction } from '../mission-bridge.js'
import { FLEET } from '../fleet-profile.js'
import '../home.css'

const POLL_MS = 45_000
const DASH = '—' // em dash — used for "no reading", never "0"

/* ============================================================
   The session cast. Hues are the site's role palette (vocab.js
   ROLES / the graph nodes), so the same agent wears the same
   colour on every page. The owner has no dot: the owner is not
   a fleet role, and the transcript marks that typographically
   (UI face, full ink) rather than with a badge.

   WHO is in the cast is profile data, because a fleet names its
   own agents. A speaker the profile does not describe still
   renders — addTurn falls back to the agent style and uses the
   speaker's own id as the label, rather than dropping the turn.
   ============================================================ */
const SPEAKERS = FLEET.speakers || {}

/* The seeded session, oldest first, written rather than generated so that it
   reads as a conversation with an arc. Both halves of the pair are deliberate.

   The SAMPLE profile's arc is about this interface: what the ring reads, what
   the thread is, and what replaces it. A demonstration of the product cannot
   be mistaken for a recording of somebody's working day; a generic-sounding
   work transcript can, and that is exactly what shipped before. Its notice is
   the LAST turn, not the first, because the log opens pinned to the newest
   line — anything at the top is scrolled out of sight before it is read.

   A LOADED profile's arc is whatever that fleet's own session was. */
const SESSION = (FLEET.session || []).filter(turn => turn && typeof turn.text === 'string')
const ARRIVALS = (FLEET.arrivals || []).filter(turn => turn && typeof turn.text === 'string')
const REPLIES = (FLEET.replies || []).filter(text => typeof text === 'string' && text)
const REPLY_ACTS = (FLEET.replyActs || []).filter(text => typeof text === 'string' && text)

const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/* Draw from a shuffled bag so the pool is spent before anything repeats —
   the comms board learned this the hard way (see bagDraw there): nothing
   gives a generated transcript away faster than a verbatim repeat two
   messages apart. On refill, the new bag must not open with the line that
   just closed the old one, or the one guarded repeat appears at the seam. */
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

export function homeView() {
  const liveMode = isLiveView('home')
  const writeReplyEnabled = liveMode && isWriteEnabled('thread-reply')
  /* Who the composer addresses is the profile's coordinator, not a hardcoded
     agent name — the placeholder, the aria-label and the voice that answers a
     simulated reply all have to be the same agent, and only one of the three
     used to be. */
  const composerTarget = FLEET.composerTarget || 'coordinator'
  const root = el(`
    <div class="home" data-live-mode="${liveMode ? 'live' : 'simulated'}">
      <div class="home-ring-wrap"></div>
      <div class="home-feed-wrap">
        <span class="brace" aria-hidden="true"><svg width="22" height="26" viewBox="0 0 22 26"><path d="M20.5 1.5 C13 1.5 8 3.6 8 10.8 L8 26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><svg class="brace-arm" viewBox="0 0 22 10" preserveAspectRatio="none"><rect x="7.25" y="0" width="1.5" height="10" fill="currentColor"/></svg><svg width="22" height="56" viewBox="0 0 22 56"><path d="M8 0 L8 16 C8 24 5.6 26.4 1.5 28 C5.6 29.6 8 32 8 40 L8 56" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><svg class="brace-arm" viewBox="0 0 22 10" preserveAspectRatio="none"><rect x="7.25" y="0" width="1.5" height="10" fill="currentColor"/></svg><svg width="22" height="26" viewBox="0 0 22 26"><path d="M8 0 L8 15.2 C8 22.4 13 24.5 20.5 24.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        <div class="home-feed">
          <div class="session-head"><span data-session-title>session — ${escText(FLEET.sessionTitle || 'transcript')}</span><span class="projection-mode">${liveMode ? 'live source' : 'simulated source'}</span></div>
          <div class="session-view">
            <div class="session-log" tabindex="0" role="log" aria-label="Coordinator session transcript"></div>
          </div>
          <div class="chat-input session-input">
            <input type="text" placeholder="Message ${escText(composerTarget)}…" aria-label="Message ${escText(composerTarget)}" />
            <button class="chat-send" aria-label="Send">
              <svg viewBox="0 0 24 24"><path d="M5 12h13M13 6.5 18.8 12 13 17.5" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
        </div>
        <span class="brace is-right" aria-hidden="true"><svg width="22" height="26" viewBox="0 0 22 26"><path d="M20.5 1.5 C13 1.5 8 3.6 8 10.8 L8 26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><svg class="brace-arm" viewBox="0 0 22 10" preserveAspectRatio="none"><rect x="7.25" y="0" width="1.5" height="10" fill="currentColor"/></svg><svg width="22" height="56" viewBox="0 0 22 56"><path d="M8 0 L8 16 C8 24 5.6 26.4 1.5 28 C5.6 29.6 8 32 8 40 L8 56" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><svg class="brace-arm" viewBox="0 0 22 10" preserveAspectRatio="none"><rect x="7.25" y="0" width="1.5" height="10" fill="currentColor"/></svg><svg width="22" height="26" viewBox="0 0 22 26"><path d="M8 0 L8 15.2 C8 22.4 13 24.5 20.5 24.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      </div>
    </div>
  `)

  const ringSize = Math.min(520, Math.max(380, window.innerHeight - 300))
  const ring = uptimeRing({
    size: ringSize,
    epoch: Date.now(),          // placeholder only; real epoch set once data loads
    caption: 'Last Health Sweep',
    sub: 'loading…',
    crescent: true,
  })
  ring.el.dataset.load = 'unknown'
  root.querySelector('.home-ring-wrap').appendChild(ring.el)

  const loadRow = el(`<div class="home-load"><i></i><span class="lt">no data yet</span><span class="lv"></span></div>`)
  const loadLabel = loadRow.querySelector('.lt')
  const loadVal = loadRow.querySelector('.lv')
  ring.el.querySelector('.uring-inner').appendChild(loadRow)

  /* ---- fixed-width crossfading digits (same mechanism as the rest of the
     app used for its clock) — the epoch they read is real once loaded, and
     the digits show DASH (never 0s) until it is. ---- */
  const showDays = true
  const UNITS = showDays
    ? [['d', 'Days'], ['h', 'Hours'], ['m', 'Minutes'], ['s', 'Seconds']]
    : [['h', 'Hours'], ['m', 'Minutes'], ['s', 'Seconds']]

  const digitsEl = ring.el.querySelector('.uring-digits')
  digitsEl.innerHTML = UNITS
    .map(([, label]) => `<span class="seg"><span class="n-stack"><span class="n cur">${DASH}</span></span><span class="u">${label}</span></span>`)
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

  function uptimeParts(epoch) {
    let s = Math.max(0, Math.floor((Date.now() - epoch) / 1000))
    const d = Math.floor(s / 86400); s -= d * 86400
    const h = Math.floor(s / 3600); s -= h * 3600
    const m = Math.floor(s / 60); s -= m * 60
    const pad = (n) => String(n).padStart(2, '0')
    return { d: String(d), h: pad(h), m: pad(m), s: pad(s) }
  }
  const partsToValues = (p) => (showDays ? [p.d, p.h, p.m, p.s] : [p.h, p.m, p.s])

  let epochMs = null   // null until a real health-sweep timestamp is loaded

  let lastTickAt = 0
  function renderTick(ts) {
    if (epochMs != null && ts - lastTickAt >= 80) {
      lastTickAt = ts
      partsToValues(uptimeParts(epochMs)).forEach((v, i) => setDigit(stacks[i], v))
    }
  }

  /* ============================================================
     The session thread between the braces.
     ============================================================ */
  const logEl = root.querySelector('.session-log')
  const input = root.querySelector('.session-input input')
  const sendButton = root.querySelector('.chat-send')
  const writeState = writeReplyEnabled
    ? el('<div class="session-write-state" data-state="checking" role="status">checking audited bridge…</div>')
    : null
  if (writeState) root.querySelector('.session-input').insertAdjacentElement('afterend', writeState)
  const timers = []
  let destroyed = false

  const braces = [...root.querySelectorAll('.brace')]
  braces.forEach(b => b.addEventListener('animationend', () => b.classList.remove('brace-pulse')))
  const pulseBraces = () => {
    braces.forEach(b => { b.classList.remove('brace-pulse'); void b.offsetWidth; b.classList.add('brace-pulse') })
  }

  function addTurn(who, text, fresh = false) {
    const meta = SPEAKERS[who] || { cls: 'is-agent', label: who }
    const dot = meta.hue ? `<i class="turn-dot" style="background:${meta.hue}"></i>` : ''
    const label = meta.label ? `<span class="turn-who">${dot}${escText(meta.label)}</span>` : ''
    const node = el(`<div class="turn ${meta.cls}${fresh ? ' fresh' : ''}">${label}<div class="turn-text">${escText(text)}</div></div>`)
    logEl.appendChild(node)
    return node
  }
  /* A profile that declares no session is a reachable state now, and a blank
     panel between the braces reads as a failed load rather than as an empty
     transcript. showThreadState cannot be used this early — it closes over
     pinAfterMount, which is a const declared further down — so the notice is
     built here in the same shape. */
  if (!liveMode) {
    if (SESSION.length) SESSION.forEach(turn => addTurn(turn.who, turn.text))
    else logEl.innerHTML = '<div class="projection-state" role="status"><strong>no transcript in this profile</strong><span>This profile declares no session, so there is nothing to show between the braces.</span></div>'
  }

  /* The seeded history renders while the view is still DETACHED (the router
     mounts it after assembly), where scrollHeight is 0 and any snap here is a
     no-op. So the thread keeps the standard chat contract from
     components.js buildChat instead: pinned to the newest turn through every
     resize and append, unpinned the moment the reader scrolls up to read
     history, re-pinned when they return to the bottom. */
  let pinned = true
  logEl.addEventListener('scroll', () => {
    pinned = logEl.scrollTop >= logEl.scrollHeight - logEl.clientHeight - 24
  }, { passive: true })
  const pinToBottom = () => {
    if (!destroyed && pinned && logEl.scrollHeight) logEl.scrollTop = logEl.scrollHeight
  }
  const anchorRo = new ResizeObserver(() => {
    pinToBottom()
  })
  anchorRo.observe(logEl)
  const anchorMo = new MutationObserver(() => {
    pinToBottom()
  })
  anchorMo.observe(logEl, { childList: true })
  /* ...and the webfont swap, the one growth path with NO mutation and NO box
     resize. `fonts.ready` may settle while the assembled view is detached,
     so its immediate measurement is still zero. Re-elect the pin after two
     painted frames, and repeat for any later font-loading generation. */
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

  const sessionTitle = root.querySelector('[data-session-title]')
  function showThreadState(title, reason, detail = '', loading = false) {
    logEl.innerHTML = `<div class="projection-state ${loading ? 'is-loading' : 'projection-unavailable'}" role="status"><strong>${escText(title)}</strong><span>${escText(reason)}</span>${detail ? `<small>${escText(detail)}</small>` : ''}</div>`
    pinned = true
    pinAfterMount()
  }

  async function loadCoordinatorThread() {
    const result = await fetchCoordinator()
    if (destroyed) return
    if (!result.ok) {
      showThreadState('coordinator thread unavailable', result.reason)
      return
    }
    const projection = result.data.data
    const identity = projection.identity
    if (sessionTitle) sessionTitle.textContent = `session — ${identity.displayName} · ${writeReplyEnabled ? 'audited write' : 'read-only projection'}`
    const sessions = projection.sessions
    const observed = sessions.ok ? sessions.value : null
    const latestAt = observed?.reduce((latest, session) => {
      const at = Date.parse(session.updatedAt)
      return Number.isFinite(at) ? Math.max(latest, at) : latest
    }, 0) || 0
    const sessionDetail = sessions.ok
      ? `${observed.length} observed session${observed.length === 1 ? '' : 's'}${latestAt ? ` · latest ${fmtAge(ageMs(latestAt))}` : ''}`
      : `sessions unavailable · ${sessions.reason}`
    const thread = projection.thread
    if (!thread.ok) {
      showThreadState('coordinator thread unavailable', thread.reason, sessionDetail)
      return
    }
    logEl.replaceChildren()
    for (const message of thread.value) addTurn(message.sender, message.text)
    if (!thread.value.length) showThreadState('coordinator thread unavailable', 'source returned no messages', sessionDetail)
    else pinAfterMount()
  }

  if (liveMode) {
    showThreadState('coordinator thread', 'reading live projection…', '', true)
    input.disabled = true
    input.placeholder = writeReplyEnabled ? 'Checking audited bridge…' : 'Read-only projection'
    sendButton.disabled = true
    loadCoordinatorThread()
    if (writeReplyEnabled) {
      void bridgeStatus().then(result => {
        if (destroyed) return
        if (!result.ok) {
          writeState.dataset.state = 'unavailable'
          writeState.textContent = `bridge unavailable · ${result.reason}`
          input.placeholder = 'Audited bridge unavailable'
          return
        }
        writeState.dataset.state = 'ready'
        writeState.textContent = result.channels?.discord?.ok === false
          ? 'audited replies ready · discord channel unavailable'
          : 'audited replies ready'
        input.disabled = false
        sendButton.disabled = false
        input.placeholder = 'Reply through audited bridge…'
      })
    }
  }

  /* ---- live continuation: rare, whole-message arrivals ----
     The old ticker re-rendered every 45s poll; a session is quieter. First
     arrival lands inside the first half-minute (so the page visibly lives),
     then one every 24-48s. The brace pulse marks each arrival — the bracket
     reacting to the context it holds growing. */
  const drawArrival = makeBag(ARRIVALS)
  let arrivalT = 0
  const scheduleArrival = (first = false) => {
    arrivalT = setTimeout(() => {
      const t = drawArrival()
      addTurn(t.who, t.text, true)
      pulseBraces()
      scheduleArrival()
    }, first ? 10_000 + Math.random() * 12_000 : 24_000 + Math.random() * 24_000)
    timers.push(arrivalT)
  }
  /* No arrivals declared means a still thread, not a crash: makeBag on an
     empty pool returns undefined and the turn below would read .who off it. */
  if (!liveMode && ARRIVALS.length) scheduleArrival(true)

  /* ---- the composer: the owner speaks, the coordinator answers ---- */
  const drawReply = makeBag(REPLIES)
  const drawReplyAct = makeBag(REPLY_ACTS)
  const send = async () => {
    if (liveMode && !writeReplyEnabled) return
    const v = input.value.trim()
    if (!v) return
    if (liveMode) {
      input.disabled = true
      sendButton.disabled = true
      writeState.dataset.state = 'pending'
      writeState.textContent = 'recording durable reply…'
      const result = await postBridgeAction('thread-reply', {
        idempotencyKey: crypto.randomUUID(),
        threadId: 'owner-thread',
        message: v,
      })
      if (destroyed) return
      if (!result.ok) {
        writeState.dataset.state = 'refused'
        writeState.textContent = `reply refused · ${result.reason}`
      } else {
        input.value = ''
        addTurn(result.receipt.actor || composerTarget, v, true)
        addTurn('act', `durable reply · revision ${result.receipt.revision}`, true)
        pulseBraces()
        writeState.dataset.state = 'confirmed'
        writeState.textContent = 'reply confirmed by audited bridge'
      }
      input.disabled = false
      sendButton.disabled = false
      input.focus()
      return
    }
    input.value = ''
    addTurn('owner', v, true)
    // Sometimes the tool line the coordinator ran to answer arrives first —
    // that beat is what makes the reply read as work done, not text served.
    const withAct = REPLY_ACTS.length > 0 && Math.random() < 0.35
    const replyAt = 1100 + Math.random() * 1100
    if (withAct) timers.push(setTimeout(() => addTurn('act', drawReplyAct(), true), replyAt - 550))
    /* A profile with no replies answers with a stated silence rather than the
       word "undefined", which is what an empty bag draws. */
    timers.push(setTimeout(() => {
      addTurn(composerTarget, REPLIES.length ? drawReply() : 'This profile declares no replies, so there is nothing to answer with.', true)
      pulseBraces()
    }, replyAt + (withAct ? 500 : 0)))
  }
  sendButton.addEventListener('click', send)
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void send() } })

  /* ---- apply a fetched (or failed) status result to the ring widgets ---- */
  function applyResult(result) {
    if (!result.ok) {
      ring.el.dataset.load = 'unknown'
      loadLabel.textContent = 'source unavailable'
      loadVal.textContent = ''
      const subEl = ring.el.querySelector('.uring-sub')
      if (subEl) subEl.textContent = result.reason
      epochMs = null
      return
    }
    const { health, peerLink } = result.data
    const subEl = ring.el.querySelector('.uring-sub')

    if (health && health.available) {
      epochMs = health.observedAtMs
      const c = health.counts
      if (subEl) {
        subEl.textContent =
          `${health.total} subsystems · ${c.OK} ok · ${c.DOWN} down · ${c.STOPPED} stopped${c.UNKNOWN ? ` · ${c.UNKNOWN} unknown` : ''}`
      }
      const severity = c.DOWN > 0 ? 'peak' : (c.UNKNOWN > 0 ? 'busy' : 'idle')
      ring.el.dataset.load = severity
      loadLabel.textContent = c.DOWN > 0 ? `${c.DOWN} subsystem${c.DOWN === 1 ? '' : 's'} down`
        : c.UNKNOWN > 0 ? 'partially verifiable' : 'all subsystems clear'
      const sweepAge = fmtAge(ageMs(health.observedAtMs))
      loadVal.textContent = sweepAge ? `swept ${sweepAge}` : ''
    } else {
      epochMs = null
      if (subEl) subEl.textContent = health?.error || 'health snapshot unavailable'
      ring.el.dataset.load = 'unknown'
      loadLabel.textContent = 'health snapshot unavailable'
      loadVal.textContent = ''
    }

    // second real reading, appended below the load row rather than invented
    // into the same field: cross-machine link freshness (a DIFFERENT age
    // than the health sweep above, on purpose).
    let peerRow = ring.el.querySelector('.home-peer')
    if (!peerRow) {
      peerRow = el(`<div class="home-load home-peer"><i></i><span class="lt"></span><span class="lv"></span></div>`)
      ring.el.querySelector('.uring-inner').appendChild(peerRow)
    }
    const peerLt = peerRow.querySelector('.lt')
    const peerLv = peerRow.querySelector('.lv')
    const peerDot = peerRow.querySelector('i')
    const out = peerLink?.outbound
    // This dot is intentionally coloured independently of the ring's
    // --load-col (which it would otherwise silently inherit): it reports the
    // cross-machine link's OWN freshness, a different signal than the health
    // sweep above, and the two must never be visually conflated.
    if (out?.available) {
      const age = ageMs(out.authenticatedAtMs)
      const age2 = fmtAge(age)
      peerLt.textContent = `link to ${out.peerHost || 'peer'}`
      peerLv.textContent = age2 ? `verified ${age2}` : 'age unknown'
      peerDot.style.background = age != null && age < 30 * 60_000 ? 'var(--s-good)' : 'var(--s-warn)'
    } else {
      peerLt.textContent = 'cross-machine link'
      peerLv.textContent = 'unavailable'
      peerDot.style.background = 'var(--ink-4)'
    }
  }

  async function load() {
    const result = await fetchStatus()
    if (destroyed) return
    applyResult(result)
  }
  load()
  const pollTimer = setInterval(load, POLL_MS)

  let raf
  const loop = (ts) => { renderTick(ts); raf = requestAnimationFrame(loop) }
  raf = requestAnimationFrame(loop)

  return {
    el: root,
    destroy() {
      destroyed = true
      cancelAnimationFrame(raf)
      clearInterval(pollTimer)
      timers.forEach(clearTimeout)
      anchorRo.disconnect()
      anchorMo.disconnect()
      cancelAnimationFrame(firstPinFrame)
      cancelAnimationFrame(settledPinFrame)
      document.fonts?.removeEventListener?.('loadingdone', onFontsLoaded)
    },
  }
}
