// /home — the giant hero ring + the coordinator's session thread.
//
// DATA WIRING NOTE: the RING still reads public/data/status.json (written by
// tools/gen-status.mjs from real, read-only ToolsEnabled state) via
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
// the session itself, fully expanded, at rest: the owner's directives, the
// coordinator's reasoning, delegations and report-backs, and the quiet
// tool-action lines a session transcript carries between turns.

import { el, uptimeRing } from '../components.js'
import { fetchStatus, fetchCoordinator, ageMs, fmtAge } from '../live-status.js'
import { isLiveView } from '../live-flags.js'
import { isWriteEnabled } from '../write-flags.js'
import { bridgeStatus, postBridgeAction } from '../mission-bridge.js'
import '../home.css'

const POLL_MS = 45_000
const DASH = '—' // em dash — used for "no reading", never "0"

/* ============================================================
   The session cast. Hues are the site's role palette (vocab.js
   ROLES / the graph nodes), so the same agent wears the same
   colour on every page. The owner has no dot: the owner is not
   a fleet role, and the transcript marks that typographically
   (UI face, full ink) rather than with a badge.
   ============================================================ */
const SPEAKERS = {
  owner: { cls: 'is-owner', label: 'owner' },
  claude: { cls: 'is-coord', label: 'claude · coordinator', hue: 'var(--c-coordinator)' },
  codex: { cls: 'is-coord', label: 'codex · coordinator', hue: 'var(--c-coordinator)' },
  'codex-b': { cls: 'is-agent', label: 'codex-b', hue: 'var(--c-coordinator)' },
  'luna-02': { cls: 'is-agent', label: 'luna-02', hue: 'var(--c-manager)' },
  'terra-01': { cls: 'is-agent', label: 'terra-01', hue: 'var(--c-shadow)' },
  'gem-lane-3': { cls: 'is-agent', label: 'gem-lane-3', hue: 'var(--c-default)' },
  'sandbox-w1': { cls: 'is-agent', label: 'sandbox-w1', hue: 'var(--c-default)' },
  act: { cls: 'is-act', label: '' },
}

/* The seeded session — one morning's thread, oldest first. Written (not
   generated) so it reads as a conversation with an arc: wave report →
   fix-round delegation → the bridge incident → the ledger gap → what is
   left → an owner decision landing in the directive. The register is the
   fleet's own (comms CONV_DEFS / vocab.js): gates, territories, evidence
   packets, checkpoints, leases, fences. */
const SESSION = [
  ['act', 'resumed coordinator session — read STANDING-ORDERS.md in full · ledger query: 9 gates open, none blocking this lane'],
  ['owner', 'Morning. Where did the overnight wave land? I want the quality pass wrapped before anything new starts — and if the scheduler fence repro is still flaking, that outranks cosmetics.'],
  ['codex', 'Overnight wave: six of eight lanes closed clean. luna-02 landed the metrics sweep (41/41 green, 2m18s), terra-01 accepted reviews 12 and 14. The two still open are the scheduler fence repro — deterministic now, 20/20 runs — and the board morph polish, checkpointed at phase 3 of 5. Nothing regressed; evidence paths are in every packet. Holding new spawns until the fix round closes.'],
  ['act', 'ran node tools/agent-preflight.js — clean, no colliding session · territory map current'],
  ['codex', 'Delegating the fix round now: gem-lane-3 takes criterion 3 only — the type floor on the metrics ticks — territory scoped to the two files named in the rejection. luna-02 keeps metrics.css; nobody else touches it this wave.'],
  ['luna-02', 'claim acknowledged. preflight clean, no colliding session. metrics.css stays mine through the wave; phase 1 of 3 underway, checkpoint before the fence.'],
  ['gem-lane-3', 'fix scoped to criterion 3 — shared tick component untouched. ticks raised to 12px and the floor measured off the rendered box, not the stylesheet. handback posted, re-review requested.'],
  ['act', 'memory.set agent-coord builder/handback/9 — 412 chars · lease heartbeat fresh'],
  ['terra-01', 're-review of 9: ACCEPT — floor verified at 1600×900 and 1280×800, 11/11 criteria green, 38s wall clock. evidence: artifacts/r191/review.md. closing the round.'],
  ['codex', 'Round closed in one pass — that is the contract working. Rolling the verdict into the ledger and releasing the spawn hold; cap back to 20.'],
  ['owner', 'Good. What about the cross-machine link? B went quiet for a stretch yesterday and I never got a straight answer on whether that was the tunnel or the bridge.'],
  ['codex', 'It was the bridge, not the tunnel. The :8788 probe timed out twice while :8787 stayed clean, so the chat relay never dropped — only the bounded tool lane did. codex-b restarted the bridge on B and both lanes have been green for fourteen hours. I have split the two lanes apart in the status packet so the next report cannot blur them.'],
  ['act', 'ran node tools/bridge-status.js — tunnel :8787 OK · bridge :8788 OK · auth verified'],
  ['codex-b', 'confirming from B: both lanes green since the restart. canonical checkout verified against the ownership table; mirror check clean, both machines read map rev 6.'],
  ['owner', "While you're in there — the churn ledger keeps showing lanes that end with no outcome recorded. Is that real, or a reporting gap?"],
  ['codex', 'Mostly a reporting gap. Three of those lanes were truncated mid-phase and resumed correctly — a truncation is a continuation, so no outcome line is the right record for them. But two lanes genuinely exited without writing a packet, which is a contract violation. The watchdog now flags any lane-end without a matching evidence path, and sandbox-w1 is sweeping the ledger for older cases.'],
  ['sandbox-w1', 'ledger sweep done — 214 lane-end events checked, 9 missing packets, all older than the current contract revision. tagged for backfill; none from active lanes. evidence: reports/q57-ledger-sweep.md'],
  ['act', 'checkpoint written — sweep lane phase 2 of 4 · resuming after mission re-read'],
  ['terra-01', 'controller/review/16 pre-read: charter scope confirmed, evidence tree spot-checked. capture rig pinned to both sizes; verdict lands within one phase.'],
  ['owner', 'One more thing. I saw a help-request on the board older than a day. Whose queue does that die in?'],
  ['codex', 'Mine, ultimately — unanswered asks escalate to the coordinator at 24 hours, and this one slipped because it arrived tagged to a retired key. I answered it this morning at the original key and taught the watchdog the retired-key case, so that class of miss should not recur.'],
  ['act', 'memory.set help-request-044-answer — 268 chars · original key notified'],
  ['gem-lane-3', 'picking the board morph lane back up from its phase-3 checkpoint. nothing re-run; resumed exactly at the fence. FLIP reorder next.'],
  ['luna-02', 'phase 2 complete — 18/18 tests green, 1m26s. evidence: reports/q58-metrics-close.md. lease heartbeat fresh; phase 3 of 3 underway.'],
  ['codex', "Status roll-up: four lanes active, every lease fresh, no open blockers. Reviews 15 and 16 are queued behind terra-01's capture rig — capture is not interruptible, so they land this afternoon. The fence repro packet is the model I want the other lanes copying: repro, timings, evidence, nothing else."],
  ['owner', "What's actually left before I can call this wave done?"],
  ['codex', "Three things. terra-01's two queued verdicts. The board morph lane's last two phases, which are mechanical. And one decision that is yours, not mine: whether the retired compatibility host keeps its mirror duty or we cut over to canonical-only. Everything else is closed with evidence."],
  ['owner', 'Keep the mirror through the end of the month, then cut it. Put that in the directive so nobody relitigates it in three weeks.'],
  ['codex', 'Written as directive rev 45 with the date and the cutover condition — newest wins, so the standing mirror-duty note is superseded cleanly rather than argued with. Both machines acked inside a minute.'],
  ['act', 'memory.set agent-coord directive/current rev 45 — acks: codex-b, luna-02, gem-lane-3'],
  ['codex-b', 'rev 45 acked on B. mirror duty scheduled through month-end, cutover condition recorded; nothing else outstanding on my side.'],
  ['terra-01', 'controller/review/15: ACCEPT — 13/13 criteria pass, 44s wall clock. evidence: artifacts/r193/review.md'],
  ['act', 'ledger updated — review/15 verdict recorded · OUTWARD class untouched'],
  ['codex', "That clears one of the three. I'll bring review/16 and the morph close-out when they land — nothing needs you before the month-end cutover."],
]

/* Live continuation of the same morning — a session breathes in minutes, not
   the old ticker's seconds, so these land rarely and carry whole messages. */
const ARRIVALS = [
  { who: 'terra-01', text: 'controller/review/16: ACCEPT — 15/15 criteria pass, 52s wall clock. evidence: artifacts/r194/review.md' },
  { who: 'codex', text: 'Both queued verdicts are in; the wave is down to the morph close-out. The cutover note stands — nothing needs a decision before month-end.' },
  { who: 'gem-lane-3', text: 'checkpoint at phase 4 of 5 — FLIP reorder verified at both test sizes. resuming after mission re-read.' },
  { who: 'act', text: 'ran node tools/bridge-status.js — tunnel :8787 OK · bridge :8788 OK' },
  { who: 'codex-b', text: 'mirror sweep clean on B — ownership table matches preflight, map rev steady at 6.' },
  { who: 'luna-02', text: 'phase 3 complete — 24/24 tests green, 1m41s. evidence: reports/q58-metrics-close.md. lane released.' },
  { who: 'act', text: 'lease sweep — four lanes active, all heartbeats fresh, no stale locks' },
  { who: 'sandbox-w1', text: 'backfill packet 3 of 9 posted — older lane-ends gaining evidence paths; none from active lanes.' },
  { who: 'codex', text: 'Watchdog is quiet and every lease is fresh. Next roll-up lands at the top of the hour unless a blocker surfaces first.' },
  { who: 'act', text: 'memory.set builder/status roll-up — 388 chars · acks pending' },
  { who: 'luna-02', text: 'note: metrics.css territory released — nothing held past the wave.' },
  { who: 'act', text: 'ledger query — 9 gates open, 0 blocking active lanes' },
  { who: 'gem-lane-3', text: 'phase 5 underway — final polish only; no shared files touched.' },
  { who: 'terra-01', text: 'queue note: capture rig idle — no verdicts pending.' },
  { who: 'codex-b', text: 'B-side heartbeats all fresh; no colliding sessions in preflight.' },
  { who: 'act', text: 'checkpoint written — morph lane phase 4 of 5' },
]

/* Replies to the owner typing into the composer — the coordinator's voice,
   full messages (the one-line CHAT_REPLIES pool belongs to the small chip
   chats, not to a session transcript). */
const REPLIES = [
  'Noted — writing it into the directive so the next wake reads it from the board, not from memory. Both machines will ack within the minute.',
  "On it. Preflight first, then I'll scope the territory and name the files in the claim so nothing collides.",
  "Checked just now: all leases fresh, no open blockers, two verdicts queued behind the capture rig. I'll report when they land.",
  'That one needs an owner decision at the gate, so I am holding it rather than guessing — the deadline does not override the ledger.',
  'Good catch. I have flagged it to the watchdog and asked sandbox-w1 for a sweep; the evidence packet will name whatever it finds.',
  'Delegating that to luna-02 with the territory scoped to two files. One fix round; if it fails twice it escalates back to me.',
  'The honest answer is it is mid-phase — checkpointed, resumable, and I would rather land it clean than call it done early.',
  "Done, and recorded with an evidence path — a bare 'done' would not survive terra-01's review anyway.",
  "I'll fold that into the next roll-up. If you want it sooner, say so and I will interrupt the phase at its checkpoint.",
  'Understood — treating that as the priority lane. Everything cosmetic holds until it closes.',
]

/* A reply is sometimes preceded by the tool line the coordinator actually ran
   to answer — the transcript register where work shows itself. */
const REPLY_ACTS = [
  'ran node tools/agent-preflight.js — clean, no colliding session',
  'ledger query — 9 gates open, none blocking active lanes',
  'memory.search agent-coord — 3 fresh packets since last read',
  'ran node tools/bridge-status.js — both lanes OK',
]

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
  const root = el(`
    <div class="home" data-live-mode="${liveMode ? 'live' : 'simulated'}">
      <div class="home-ring-wrap"></div>
      <div class="home-feed-wrap">
        <span class="brace" aria-hidden="true"><svg width="22" height="26" viewBox="0 0 22 26"><path d="M20.5 1.5 C13 1.5 8 3.6 8 10.8 L8 26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><svg class="brace-arm" viewBox="0 0 22 10" preserveAspectRatio="none"><rect x="7.25" y="0" width="1.5" height="10" fill="currentColor"/></svg><svg width="22" height="56" viewBox="0 0 22 56"><path d="M8 0 L8 16 C8 24 5.6 26.4 1.5 28 C5.6 29.6 8 32 8 40 L8 56" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><svg class="brace-arm" viewBox="0 0 22 10" preserveAspectRatio="none"><rect x="7.25" y="0" width="1.5" height="10" fill="currentColor"/></svg><svg width="22" height="26" viewBox="0 0 22 26"><path d="M8 0 L8 15.2 C8 22.4 13 24.5 20.5 24.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        <div class="home-feed">
          <div class="session-head"><span data-session-title>session — codex/coordinator · owner channel</span><span class="projection-mode">${liveMode ? 'live source' : 'simulated source'}</span></div>
          <div class="session-view">
            <div class="session-log" tabindex="0" role="log" aria-label="Coordinator session transcript"></div>
          </div>
          <div class="chat-input session-input">
            <input type="text" placeholder="Message codex…" aria-label="Message codex" />
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
  if (!liveMode) SESSION.forEach(([who, text]) => addTurn(who, text))

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
  if (!liveMode) scheduleArrival(true)

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
        addTurn(result.receipt.actor || 'codex', v, true)
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
    const withAct = Math.random() < 0.35
    const replyAt = 1100 + Math.random() * 1100
    if (withAct) timers.push(setTimeout(() => addTurn('act', drawReplyAct(), true), replyAt - 550))
    timers.push(setTimeout(() => {
      addTurn('codex', drawReply(), true)
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
