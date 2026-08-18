// Shared UI pieces: uptime ring, chat window, sparkline, tooltip.

import { sim, uptimeParts } from './sim.js'
import { crescentSpec } from './crescent-field.js'
import { mountCrescent } from './crescent-mount.js'
import { CHAT, CHAT_CONTEXT_REPLIES, CHAT_REPLIES, ROLES, pick } from './vocab.js'

export const el = (html) => {
  const t = document.createElement('template')
  t.innerHTML = html.trim()
  return t.content.firstElementChild
}

let gradSeq = 0

/**
 * FNV-1a — a small, stable string hash. Used where a value has to be
 * *arbitrary but the same every time* (see buildChat's seeded history):
 * Math.random() there produced a different past for the same conversation
 * on every open, which reads as data being invented in front of the user.
 */
function hashString(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * Big glowing uptime ring. Returns { el, update, destroy }.
 * update() re-renders digits + arc from the epoch.
 */
export function uptimeRing({ size = 460, epoch, colors = ['#35eab7', '#45d6ff'], caption = 'Server Uptime', sub = '', showDays = true, crescent = false }) {
  const stroke = Math.max(7, size * 0.02)
  const r = (size - stroke * 2 - 14) / 2
  const cx = size / 2
  const gid = `uring-grad-${++gradSeq}`
  const circ = 2 * Math.PI * r

  // The sketch's hero: a plain circle with a crescent of light hugging its
  // OUTSIDE-LEFT edge — an offset shadow made of light rather than a progress
  // sweep. Its colour is the fleet's load: green idle, orange climbing, red
  // full throttle. Three layers — a broad outer haze, a mid halo and a tight
  // bright core — give the falloff, each wider, softer and fainter than the one
  // inside it, and all nudged left so the light reads as coming from beside the
  // circle rather than from the stroke itself.
  //
  // The DESIGN is unchanged. What changed is that it is no longer approximated.
  // These three layers used to be stroked arcs handed to feGaussianBlur, which
  // cost the render four defects that were measured, not guessed: the barely
  // blurred core ended in two blunt linecap tips; the blur radii stepped 5.5x
  // then 2.27x and left a shoulder in the falloff; the haze's filter region
  // cleared its own blur by 0.85px at every size; and stacked 8-bit translucent
  // layers band. src/crescent-field.js evaluates the same light in closed form
  // instead — see its header. The arcs' apertures, widths, blur radii, offset
  // and opacities are all still the numbers below, read from crescentSpec().
  const svgBody = crescent
    ? `<circle class="uring-rim" cx="${cx}" cy="${cx}" r="${crescentSpec(size).r}" fill="none" stroke-width="2"/>`
    : `
        <defs>
          <linearGradient id="${gid}" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="${colors[0]}"/>
            <stop offset="100%" stop-color="${colors[1]}"/>
          </linearGradient>
        </defs>
        <circle class="track" cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke-width="${stroke * 0.55}"/>
        <g transform="rotate(-90 ${cx} ${cx})">
          <circle class="arc-glow" cx="${cx}" cy="${cx}" r="${r}" fill="none"
            stroke="url(#${gid})" stroke-width="${stroke * 1.5}" stroke-linecap="round"
            stroke-dasharray="0 ${circ}"/>
          <circle class="arc" cx="${cx}" cy="${cx}" r="${r}" fill="none"
            stroke="url(#${gid})" stroke-width="${stroke}" stroke-linecap="round"
            stroke-dasharray="0 ${circ}"/>
        </g>`

  const root = el(`
    <div class="uring ${size < 240 ? 'compact' : ''} ${crescent ? 'crescent' : ''}" style="width:${size}px;height:${size}px">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${svgBody}
      </svg>
      <div class="uring-center">
        <div class="uring-inner">
          <div class="uring-digits"></div>
          <div class="uring-caption">${caption}</div>
          ${sub ? `<div class="uring-sub">${sub}</div>` : ''}
        </div>
      </div>
    </div>
  `)

  /* The crescent mounts itself: a GPU corona when WebGL2 is there, the CPU
     masked layers when it is not. Either way it inserts ahead of the SVG so the
     rim stays the topmost drawn line. */
  const crescentMount = crescent ? mountCrescent(root, size) : null
  if (crescentMount) {
    root.crescentMode = crescentMount.mode
    root.redrawCrescent = crescentMount.redraw
    root.destroyCrescent = crescentMount.destroy
  }

  const digitsEl = root.querySelector('.uring-digits')
  const arcs = root.querySelectorAll('.arc, .arc-glow')

  /** Load state drives the crescent's colour. 0..1 → idle | busy | peak. */
  let lastState = ''
  root.setLoad = (v) => {
    const state = v >= 0.72 ? 'peak' : v >= 0.38 ? 'busy' : 'idle'
    if (state !== lastState) { lastState = state; root.dataset.load = state }
  }
  if (crescent) root.setLoad(0)

  const seg = (n, u) => `<span class="seg"><span class="n">${n}</span><span class="u">${u}</span></span>`
  const colon = `<span class="colon">:</span>`

  let lastKey = ''
  function update() {
    const p = uptimeParts(epoch)
    const key = `${p.d}:${p.h}:${p.m}:${p.s}`
    if (key !== lastKey) {
      lastKey = key
      digitsEl.innerHTML = showDays
        ? seg(p.d, 'Days') + colon + seg(p.h, 'Hours') + colon + seg(p.m, 'Minutes') + colon + seg(p.s, 'Seconds')
        : seg(p.h, 'Hours') + colon + seg(p.m, 'Minutes') + colon + seg(p.s, 'Seconds')
    }
    if (!crescent) {
      const sweep = circ * p.frac
      arcs.forEach(a => a.setAttribute('stroke-dasharray', `${sweep} ${circ - sweep}`))
    }
  }
  update()

  return { el: root, update }
}

const CHAT_MINUTE = 60 * 1000
const CHAT_CLUSTER_GAP = 8 * CHAT_MINUTE
const CHAT_CLOCK_ORIGIN = Date.now()
const COORDINATING_CHAT_ROLES = new Set(['coordinator', 'helper', 'shadow', 'manager'])

const liveChats = new Set()
let chatLifecycleObserver = null

const chatDebug = import.meta.env?.DEV && typeof window !== 'undefined'
  ? (window.__chatDebug = {
      activeChats: 0,
      pendingTimers: 0,
      typingIndicators: 0,
      streams: 0,
      queuedTurns: 0,
      completedReplies: 0,
      disposedChats: 0,
    })
  : null

function bumpChatDebug(key, amount) {
  if (!chatDebug) return
  chatDebug[key] = Math.max(0, (chatDebug[key] || 0) + amount)
}

function sweepChatLifecycles() {
  for (const entry of [...liveChats]) {
    if (entry.root.isConnected) {
      entry.seenConnected = true
      entry.morphHost ||= entry.root.closest('.as-chat')
      // Chip and comms chats remain mounted for their closing morph. Their
      // host dropping .as-chat is the actual close signal, so reply work is
      // stopped before that half-second shell animation removes the DOM.
      if (entry.morphHost && !entry.morphHost.classList.contains('as-chat')) entry.dispose()
    } else if (entry.seenConnected) {
      // Full-page and rail chats have no close button. Disconnection is their
      // view/rail teardown, including innerHTML swaps on the computers rail.
      entry.dispose()
    }
  }
  if (!liveChats.size && chatLifecycleObserver) {
    chatLifecycleObserver.disconnect()
    chatLifecycleObserver = null
  }
}

function registerChatLifecycle(entry) {
  liveChats.add(entry)
  if (!chatLifecycleObserver && typeof MutationObserver !== 'undefined') {
    chatLifecycleObserver = new MutationObserver(sweepChatLifecycles)
    chatLifecycleObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    })
  }
  queueMicrotask(sweepChatLifecycles)
  return () => {
    liveChats.delete(entry)
    if (!liveChats.size && chatLifecycleObserver) {
      chatLifecycleObserver.disconnect()
      chatLifecycleObserver = null
    }
  }
}

function chatReducedMotion() {
  return document.body.classList.contains('reduce-motion')
    || Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
}

function chatTime(at) {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function normalizeChatContext(value) {
  const parts = []
  const add = (candidate) => {
    if (Array.isArray(candidate)) { candidate.forEach(add); return }
    if (typeof candidate !== 'string' && typeof candidate !== 'number') return
    const text = String(candidate).replace(/\s+/g, ' ').trim()
    if (text) parts.push(text)
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const preferred = ['activity', 'activities', 'task', 'status', 'progress', 'current']
      .filter(key => Object.hasOwn(value, key))
    ;(preferred.length ? preferred.map(key => value[key]) : Object.values(value)).forEach(add)
  } else add(value)

  let text = parts.join(' · ').replace(/[\s,;:.!?—–-]+$/u, '')
  if (text.length > 190) text = `${text.slice(0, 187).trimEnd()}…`
  return text
}

const INLINE_AGENT_ROLES = Object.freeze({
  codex: 'coordinator',
  claude: 'helper',
  jarvis: 'coordinator',
  'shadow-mgr': 'shadow',
})

const escapeInlineHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

const escapeInlineRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Escape-safe quiet emphasis for operational prose. The source string is
 * escaped in full before the one combined token pass adds the only markup
 * this function can emit; callers can therefore assign the result to
 * innerHTML without making activity/context text an HTML surface.
 */
export function formatInlineText(value, { agents = [], roleKey = 'default' } = {}) {
  const escaped = escapeInlineHtml(value)
  if (!escaped) return ''

  const roster = []
  const seen = new Set()
  const addAgent = (agent) => {
    if (!agent?.name) return
    const key = String(agent.name).toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    roster.push(agent)
  }
  for (const computer of sim.computers || []) {
    for (const agent of computer.agents || []) addAgent(agent)
  }
  for (const agent of agents || []) addAgent(agent)

  const literalNames = roster
    .map(agent => escapeInlineRegex(escapeInlineHtml(agent.name)))
    .sort((a, b) => b.length - a.length)
  const agentPattern = [
    ...literalNames,
    'gem-lane-[a-z0-9_-]+',
    'sandbox-w\\d+',
    'luna-\\d+',
    'terra-\\d+',
    'shadow-mgr',
    'jarvis',
    'codex',
    'claude',
  ].join('|')
  const tokenPattern = new RegExp(
    `(?<path>(?:[a-z]:[\\\\/])?(?:[a-z0-9_.-]+[\\\\/])+[a-z0-9_.-]*[a-z0-9_-])`
      + `|(?<request>\\b[qr]\\d+(?:\\.\\d+)*\\b)`
      + `|(?<agent>(?<![\\w-])(?:${agentPattern})(?![\\w-]))`
      + '|(?<number>(?<![\\w.#])\\d+(?:\\.\\d+)?(?:\\s+(?:seconds?|minutes?|hours?|days?|tasks?|checks?|tokens?|of\\s+\\d+)|\\s*(?:%|ms|s|m|h)(?!\\w))?(?![\\w.]))',
    'giu',
  )

  return escaped.replace(tokenPattern, (token, ...args) => {
    const groups = args.at(-1) || {}
    if (groups.path || groups.request) return `<span class="inline-register">${token}</span>`
    if (groups.number) return `<span class="inline-number">${token}</span>`
    if (groups.agent) {
      const folded = token.toLowerCase()
      const match = roster.find(agent => escapeInlineHtml(agent.name).toLowerCase() === folded)
      const fallback = folded.startsWith('sandbox-') ? 'spawned'
        : folded.startsWith('shadow-') ? 'shadow'
          : INLINE_AGENT_ROLES[folded] || roleKey
      const resolved = match?.role || fallback
      const role = Object.hasOwn(ROLES, resolved) ? resolved : 'default'
      return `<span class="inline-agent role-${role}">${token}</span>`
    }
    return token
  })
}

/** Build a chat window element (used inside chips, home feed, agent page). */
/* Text, never markup a browser parses. Each view in this app carries its own
   copy of this rather than importing a shared one; following that convention
   rather than introducing a shared module mid-sprint. */
const escapeMarkup = value => String(value ?? '').replace(/[&<>"']/g, character => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]
))

/* `title` USED to be product-controlled -- sim agents and fleet-record labels --
   which is why it reached innerHTML raw for so long without anyone being wrong.
   A tree node is now named from the first line of the person's own brief, so
   `run <the migration>` breaks the chat head and a single `"` escapes the
   placeholder attribute on the line below. The label stays verbatim on purpose
   (mangling somebody's words in the one place they compare them against what
   they typed is worse), so every sink escapes instead. */
/* Four OPTIONAL powers a live-agent caller may hand this composer (every
   existing caller compiles unchanged; the component stays outbox- and
   fleet-agnostic — the closures own the mechanisms):
     status  — { busy(), subscribe(onChange) → unsubscribe }: whether the
               agent is mid-turn. Drives the send↔stop morph.
     queue   — { list(), add(text) → {ok, sentence?}, cancel(id),
               subscribe(onChange) → unsubscribe }: messages waiting to send.
               While busy, a typed send QUEUES — no "me" bubble, because the
               strip above the composer is the preview and a bubble would
               claim the words were sent.
     actions — () → rows of { id, label, hint, enabled, run(ctx) }: the
               popup's content, built FRESH at every open. run's ctx has
               say(sentence), close(), and show(rows, {title}) for two-stage
               quick-picks (effort, model, rewind) inside one popup.
     onStop  — () → Promise<sentence|void>: pressed as the STOP face of the
               send button (busy + empty input). The sentence lands as an
               agent bubble.
     composerReason
             — a sentence, when this conversation CANNOT be spoken to. The
               log stays real and readable; the message box and the send
               button are disabled and the sentence sits above them saying
               why. It is how a chat opens over an agent that never started
               without becoming a text box that swallows what a person types
               (the defect src/node-chatbox.js's header names). It also makes
               the seeded simulator below structurally unreachable for such a
               caller: `send` is refused before it can reach the fake path,
               so an honest read-only chat can never answer itself. */
export function buildChat({ title, subtitle = '', roleKey = 'coordinator', seed = 3, onClose = null, tall = false, context = null, onSend = null, history = null, onAttach = null, onMention = null, status = null, queue = null, actions = null, actionsNote = null, onStop = null, composerReason = null }) {
  const cannotSend = typeof composerReason === 'string' && composerReason.trim().length > 0
  const role = ROLES[roleKey] || ROLES.coordinator
  const root = el(`
    <div class="chat${cannotSend ? ' chat-cannot-send' : ''}" ${tall ? 'style="min-height:0"' : ''}>
      <div class="chat-head">
        <span class="role-dot" style="background:${role.hex}"></span>
        <div>
          <div class="t">${escapeMarkup(title)}</div>
          ${subtitle ? `<div class="s">${escapeMarkup(subtitle)}</div>` : ''}
        </div>
        <span class="spacer"></span>
        ${onClose ? `<button class="chat-close" aria-label="Collapse">
          <svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
        </button>` : ''}
      </div>
      <div class="chat-log"></div>
      <div class="chat-attach-strip" hidden></div>
      ${queue ? '<div class="chat-queue-strip" hidden></div>' : ''}
      ${cannotSend ? `<div class="chat-nosend">${escapeMarkup(composerReason)}</div>` : ''}
      <div class="chat-input">
        ${onAttach ? `<button class="chat-tool" data-chat-attach aria-label="Attach an image" title="Attach an image — it rides with your next message">
          <svg viewBox="0 0 24 24"><path d="M8 12.5 15.2 5.3a3.4 3.4 0 0 1 4.8 4.8l-8.5 8.5a5.4 5.4 0 0 1-7.6-7.6L11 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>` : ''}
        ${onMention ? `<button class="chat-tool" data-chat-mention aria-label="Mention a file" title="Mention a file — its path is written into your message">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M16.2 12v1.8a2.4 2.4 0 0 0 4.8 0V12a9 9 0 1 0-3.5 7.1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>` : ''}
        ${actions ? `<button class="chat-tool" data-chat-actions aria-haspopup="true" aria-expanded="false" aria-label="Actions" title="Actions for this agent — stop, thinking depth, model, rewind and more">
          <svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="9.2" cy="7" r="2.1" fill="var(--sheet, #fff)" stroke="currentColor" stroke-width="1.8"/><circle cx="15" cy="12" r="2.1" fill="var(--sheet, #fff)" stroke="currentColor" stroke-width="1.8"/><circle cx="8" cy="17" r="2.1" fill="var(--sheet, #fff)" stroke="currentColor" stroke-width="1.8"/></svg>
        </button>` : ''}
        <input type="text" placeholder="${cannotSend ? 'Not now' : `Message ${escapeMarkup(title)}…`}"${cannotSend ? ' disabled' : ''} />
        <button class="chat-send" aria-label="Send"${cannotSend ? ' disabled' : ''}>
          <svg class="chat-send-go" viewBox="0 0 24 24"><path d="M5 12h13M13 6.5 18.8 12 13 17.5" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <svg class="chat-send-halt" viewBox="0 0 24 24"><rect x="6.5" y="6.5" width="11" height="11" rx="1.6" fill="currentColor"/></svg>
        </button>
      </div>
    </div>
  `)

  const log = root.querySelector('.chat-log')
  const input = root.querySelector('input')
  const sendButton = root.querySelector('.chat-send')
  let disposed = false
  let lastTurnAt = null

  /* The picker buttons: the handlers own the mechanism (and any state); this
     component only shows what they answered. An attach names its file in the
     strip above the input; a mention writes the path INTO the input, which is
     the whole point of a mention. */
  const attachStrip = root.querySelector('.chat-attach-strip')
  root.querySelector('[data-chat-attach]')?.addEventListener('click', async () => {
    const picked = await Promise.resolve(onAttach()).catch(() => null)
    if (disposed || !picked || !picked.path) return
    const name = String(picked.path).split(/[\\/]/).pop()
    attachStrip.textContent = `${name} — rides with your next message.`
    attachStrip.hidden = false
  })
  root.querySelector('[data-chat-mention]')?.addEventListener('click', async () => {
    const picked = await Promise.resolve(onMention()).catch(() => null)
    if (disposed || !picked) return
    const path = typeof picked === 'string' ? picked : picked.path
    if (!path) return
    input.value = input.value ? `${input.value} ${path}` : `Read ${path} and use it for what I ask next.`
    input.focus()
  })

  /* ---- the live composer state machine (status/queue/onStop callers) ----
     One repaint function decides the trailing button's face and the queue
     strip's contents. The rules, exactly as the owner spoke them: stop
     replaces send while the agent is replying; the moment the person types,
     it turns back into send; a send while busy queues, and the waiting words
     are PREVIEWED in the strip rather than claimed as sent. */
  const queueStrip = root.querySelector('.chat-queue-strip')
  const actionsButton = root.querySelector('[data-chat-actions]')
  const isBusy = () => {
    try { return Boolean(status && typeof status.busy === 'function' && status.busy() === true) }
    catch { return false }
  }
  const paintQueueStrip = () => {
    if (!queueStrip || !queue) return
    let entries = []
    try { entries = queue.list() || [] } catch { entries = [] }
    queueStrip.hidden = entries.length === 0
    queueStrip.textContent = ''
    for (const entry of entries) {
      const row = document.createElement('div')
      row.className = 'chat-queue-row'
      const text = document.createElement('span')
      text.className = 'chat-queue-text'
      /* The person's own words: textContent, never markup. */
      text.textContent = entry.text
      text.title = entry.text
      const cancel = document.createElement('button')
      cancel.type = 'button'
      cancel.className = 'chat-queue-cancel'
      cancel.textContent = 'Unqueue'
      cancel.setAttribute('aria-label', 'Remove this waiting message')
      cancel.addEventListener('click', () => {
        try { queue.cancel(entry.id) } catch { /* an already-sent entry is the goal state */ }
        paintQueueStrip()
        syncComposer()
      })
      row.append(text, cancel)
      queueStrip.appendChild(row)
    }
  }
  const syncComposer = () => {
    if (disposed) return
    const stopMode = isBusy() && !input.value.trim() && typeof onStop === 'function'
    sendButton.classList.toggle('is-stop', stopMode)
    sendButton.setAttribute('aria-label', stopMode ? 'Stop this reply' : 'Send')
    sendButton.title = stopMode ? 'Stop what it is writing now — the session stays open' : ''
    paintQueueStrip()
  }
  let stopping = false
  const runStop = async () => {
    if (stopping || typeof onStop !== 'function') return
    stopping = true
    sendButton.disabled = true
    try {
      const said = await onStop()
      if (!disposed && said) addMsg(roleKey, String(said))
    } catch {
      if (!disposed) addMsg(roleKey, 'Nothing was stopped; the turn may already be over.')
    }
    sendButton.disabled = false
    stopping = false
    syncComposer()
  }

  const addTimeDivider = (at) => {
    const divider = document.createElement('time')
    divider.className = 'chat-time-divider'
    divider.dateTime = new Date(at).toISOString()
    divider.textContent = chatTime(at)
    divider.setAttribute('aria-label', `Conversation resumed at ${chatTime(at)}`)
    log.appendChild(divider)
  }

  const makeMsg = (from, text, who, at) => {
    const m = document.createElement('div')
    m.className = `msg ${from}`
    m.title = chatTime(at)
    if (who) {
      const sender = document.createElement('span')
      sender.className = 'who'
      sender.textContent = who
      m.appendChild(sender)
    }
    const body = document.createElement('span')
    body.className = 'chat-msg-text'
    body.innerHTML = formatInlineText(text, { agents: [{ name: title, role: roleKey }], roleKey })
    m.appendChild(body)
    return { m, body }
  }

  const addMsg = (from, text, who, at = Date.now()) => {
    if (lastTurnAt !== null && at - lastTurnAt > CHAT_CLUSTER_GAP) addTimeDivider(at)
    lastTurnAt = at
    const { m } = makeMsg(from, text, who, at)
    log.appendChild(m)
    log.scrollTop = log.scrollHeight
    return m
  }
  /* REAL HISTORY, WHEN THE CALLER HAS ONE. The tree card passes the actual
     conversation (this window's transcript, or the node's stored ask+reply),
     rendered verbatim — the simulated excerpt below never runs for a caller
     that provided real entries, whatever its seed. */
  if (Array.isArray(history) && history.length) {
    for (const entry of history) {
      if (!entry || typeof entry.text !== 'string' || !entry.text) continue
      addMsg(
        entry.who === 'you' ? 'me' : 'them',
        entry.text,
        entry.who === 'you' ? 'you' : title,
        Number.isFinite(entry.at) ? entry.at : Date.now(),
      )
    }
  }
  // The seeded excerpt is the conversation's *past*, so it must not change
  // between opens: the title is the conversation's identity, so the window
  // into CHAT is derived from it rather than re-rolled with Math.random().
  // Re-opening the same agent's chat now replays the same history.
  const titleHash = hashString(String(title ?? ''))
  const span = Math.max(1, CHAT.length - seed)
  const start = titleHash % span
  const seeded = Array.isArray(history) && history.length ? [] : CHAT.slice(start, start + seed)

  // Give the simulated past a stable rhythm: short exchanges grouped around
  // one real pause. A six-turn direct line therefore reads like a thread,
  // while the compact two-turn comms excerpt does not spend a row on chrome.
  const historyTimes = new Array(seeded.length)
  const clusterAt = seeded.length >= 3 ? Math.floor(seeded.length / 2) : -1
  let historyCursor = CHAT_CLOCK_ORIGIN - (2 + titleHash % 4) * CHAT_MINUTE
  for (let i = seeded.length - 1; i >= 0; i--) {
    historyTimes[i] = historyCursor
    const shortGap = 1 + ((titleHash >>> (i % 24)) % 4)
    const gap = i === clusterAt ? 9 + (titleHash % 4) : shortGap
    historyCursor -= gap * CHAT_MINUTE
  }
  seeded.forEach((m, i) => addMsg(
    m.from,
    m.text,
    i === 0 ? (m.from === 'them' ? title : 'you') : null,
    historyTimes[i],
  ))
  /* The seeded history above is written while the panel is still DETACHED
     (the agent view assembles its chat before mount), where scrollHeight is 0
     and the per-message snap inside addMsg is a no-op — the pane then sat
     anchored to its OLDEST message, with the newest sliding under the
     composer and reading as clipped text. A one-shot snap on first layout was
     tried and was not enough: the panel keeps resizing after mount (fonts,
     the strip settling), and any growth after the snap unseated it again.
     So the pane keeps the standard chat contract instead: pinned to the
     newest message through every resize until the reader scrolls away, and
     re-pinned the moment they return to the bottom. */
  let pinned = true
  log.addEventListener('scroll', () => {
    pinned = log.scrollTop >= log.scrollHeight - log.clientHeight - 24
  }, { passive: true })
  const pinToBottom = () => {
    if (!disposed && pinned && log.scrollHeight) log.scrollTop = log.scrollHeight
  }
  const anchorRo = new ResizeObserver(() => {
    pinToBottom()
  })
  anchorRo.observe(log)
  // content growth (a new message wrapping taller) moves scrollHeight without
  // resizing the box — the same pin applies
  const contentObserver = new MutationObserver(() => {
    pinToBottom()
  })
  contentObserver.observe(log, { childList: true })
  // The webfont swap grows text with no mutation and no box resize. `ready`
  // can also settle while this chat is still detached, so doing the write in
  // that promise callback is another zero-measurement no-op. Re-elect the pin
  // after two painted frames, and listen for later font generations too.
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

  const pinGrowingReply = () => {
    if (pinned && log.scrollHeight) log.scrollTop = log.scrollHeight
  }

  const timers = new Set()
  const schedule = (fn, ms) => {
    if (disposed) return null
    let timer = null
    timer = setTimeout(() => {
      if (timers.delete(timer)) bumpChatDebug('pendingTimers', -1)
      if (!disposed) fn()
    }, ms)
    timers.add(timer)
    bumpChatDebug('pendingTimers', 1)
    return timer
  }
  const clearTimers = () => {
    for (const timer of timers) {
      clearTimeout(timer)
      bumpChatDebug('pendingTimers', -1)
    }
    timers.clear()
  }

  const replyQueue = []
  let replying = false
  let typingEl = null
  let currentStream = null

  const replyTextFor = (prompt) => {
    const kind = COORDINATING_CHAT_ROLES.has(roleKey) ? 'coordinator' : 'lane'
    const pool = CHAT_CONTEXT_REPLIES[kind] || CHAT_REPLIES
    const template = pick(pool)
    let supplied = ''
    try {
      supplied = normalizeChatContext(typeof context === 'function'
        ? context({ title, roleKey, prompt })
        : context)
    } catch {
      // A live activity reader is an enhancement, never a send blocker.
    }
    const fallback = kind === 'coordinator'
      ? 'the directive queue is checked and no gate or territory change is pending'
      : 'the assigned task is moving through its current sweep'
    return template
      .replaceAll('{{context}}', supplied || fallback)
      .replaceAll('{{agent}}', String(title || role.label).toLowerCase())
      .replaceAll('{{role}}', role.label.toLowerCase())
  }

  const makeTyping = () => {
    const row = document.createElement('div')
    row.className = 'chat-typing'
    row.setAttribute('role', 'status')
    row.setAttribute('aria-label', `${title} is thinking`)

    const name = document.createElement('span')
    name.className = 'chat-typing-name'
    name.textContent = title
    const sep = document.createElement('span')
    sep.className = 'chat-typing-sep'
    sep.setAttribute('aria-hidden', 'true')
    sep.textContent = '·'
    const dots = document.createElement('span')
    dots.className = 'chat-typing-dots'
    dots.setAttribute('aria-hidden', 'true')
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('i')
      dot.textContent = '·'
      dots.appendChild(dot)
    }
    row.append(name, sep, dots)
    return row
  }

  const insertAfter = (node, anchor) => {
    if (anchor?.parentNode === log) log.insertBefore(node, anchor.nextSibling)
    else log.appendChild(node)
  }

  const takeTyping = () => {
    const row = typingEl
    if (row) bumpChatDebug('typingIndicators', -1)
    typingEl = null
    return row
  }

  let pumpReplies = () => {}
  const finishReply = () => {
    if (currentStream) {
      currentStream.message.removeAttribute('aria-busy')
      currentStream = null
      bumpChatDebug('streams', -1)
    }
    replying = false
    log.removeAttribute('aria-busy')
    bumpChatDebug('completedReplies', 1)
    pumpReplies()
  }

  const startReply = (item) => {
    const fullText = replyTextFor(item.prompt)
    const replyAt = Date.now()
    const { m, body } = makeMsg('them', '', null, replyAt)
    m.setAttribute('aria-busy', 'true')
    lastTurnAt = replyAt

    const marker = takeTyping()
    if (marker?.parentNode) marker.replaceWith(m)
    else insertAfter(m, item.message)
    pinGrowingReply()

    if (chatReducedMotion()) {
      body.innerHTML = formatInlineText(fullText, { agents: [{ name: title, role: roleKey }], roleKey })
      m.removeAttribute('aria-busy')
      finishReply()
      return
    }

    const words = fullText.match(/\S+\s*/g) || [fullText]
    let index = 0
    let streamedText = ''
    currentStream = { message: m, body, fullText }
    bumpChatDebug('streams', 1)

    const streamWord = () => {
      streamedText += words[index++] || ''
      body.innerHTML = formatInlineText(streamedText, { agents: [{ name: title, role: roleKey }], roleKey })
      pinGrowingReply()
      if (index >= words.length) {
        finishReply()
        return
      }
      schedule(streamWord, 30 + Math.random() * 30)
    }
    streamWord()
  }

  pumpReplies = () => {
    if (disposed || replying || !replyQueue.length) return
    replying = true
    const item = replyQueue.shift()
    bumpChatDebug('queuedTurns', -1)
    typingEl = makeTyping()
    insertAfter(typingEl, item.message)
    bumpChatDebug('typingIndicators', 1)
    log.setAttribute('aria-busy', 'true')
    pinGrowingReply()
    // The old 0.9–2.1s canned delay read as latency. This shorter beat reads
    // as thought, then hands off to the word stream for the visible work.
    schedule(() => startReply(item), 560 + Math.random() * 360)
  }

  const send = () => {
    if (disposed) return
    /* THE FIRST LINE, so that no later branch can be reached by a caller that
       said it cannot send. Without it a disabled input is only a suggestion:
       Enter on a disabled field does nothing today, but the seeded simulator
       is one refactor away from being reachable again, and the whole point of
       composerReason is that this chat can never answer itself. */
    if (cannotSend) return
    const v = input.value.trim()
    /* Empty input while the agent writes: this press IS the stop button —
       the same physical button, wearing its stop face. */
    if (!v) {
      if (isBusy() && typeof onStop === 'function') void runStop()
      return
    }
    /* Typed words while the agent writes: they QUEUE, visibly. No "me"
       bubble — the strip above the composer is the preview, and a bubble
       here would claim the words already reached the agent. A caller
       without a queue (the sample surfaces, the agent page) keeps its
       old behavior below. */
    if (isBusy() && queue) {
      let queued = null
      try { queued = queue.add(v) } catch { queued = null }
      if (queued && queued.ok) {
        input.value = ''
        syncComposer()
      } else {
        addMsg(roleKey, (queued && queued.sentence) || 'That was not queued. Try it again in a moment.')
      }
      return
    }
    input.value = ''
    pinned = true
    if (attachStrip && !attachStrip.hidden) {
      /* The pending attachment rides THIS send (the handler that issued it
         holds it); the strip's promise is kept, so it empties here. */
      attachStrip.hidden = true
      attachStrip.textContent = ''
    }
    const message = addMsg('me', v)

    // A REAL SENDER REPLACES THE SIMULATION ENTIRELY.
    //
    // Without `onSend` this composer answers itself: it pushes the turn onto
    // replyQueue and a canned reply streams back. That is right for the sample
    // surfaces that exist to show what the product looks like, and wrong on the
    // agent page, where the same widget made a person believe they had started
    // work. The page's own note admitted it -- "typing in it still reaches
    // nothing" -- which is honest about the wiring and no help at all to
    // somebody trying to start an agent.
    //
    // So a caller that CAN reach a real agent passes onSend, and the fake path
    // is not merely bypassed but unreachable: no queue push, no canned reply, no
    // simulated latency. Anything else would leave two sources of truth about
    // whether a turn was real.
    //
    // onSend owns the reply. It gets `reply` to append the agent's words and
    // `fail` to say why nothing happened -- a sender that throws silently would
    // reproduce the original defect in a new place.
    if (typeof onSend === 'function') {
      bumpChatDebug('sentTurns', 1)
      Promise.resolve()
        .then(() => onSend(v, {
          reply: text => { if (!disposed) addMsg(roleKey, String(text)) },
          fail: text => { if (!disposed) addMsg(roleKey, String(text)) }
        }))
        .catch(() => {
          if (disposed) return
          /* THE ERROR'S MESSAGE IS NOT SHOWN, and that is not caution -- on this
             product's agent channel the message IS the machine code
             (shell/main.cjs replaces a rejected call's error with one whose
             message is its identifier, so that nothing path-bearing crosses).
             Printing it here put a bare identifier in front of a person, which
             is the one thing src/refusal-copy.js exists to prevent, by the one
             route its scan cannot see. A sender that means to explain a refusal
             says so through `fail`, where the sentence is written. */
          addMsg(roleKey, 'That did not send, and this screen was not told why. Try once more; if it keeps happening, reload the page.')
        })
      return
    }

    replyQueue.push({ prompt: v, message })
    bumpChatDebug('queuedTurns', 1)
    pumpReplies()
  }

  const onInputKeydown = (e) => { if (e.key === 'Enter') send() }
  const onCloseClick = (e) => {
    e.stopPropagation()
    dispose()
    onClose()
  }

  sendButton.addEventListener('click', send)
  input.addEventListener('keydown', onInputKeydown)
  if (onClose) root.querySelector('.chat-close').addEventListener('click', onCloseClick)

  /* The composer repaints when the person types (stop⇄send), when the
     caller's status changes (turn started or ended), and when the queue
     changes from ANY surface — all three feeds land on one function. */
  const onInputTyped = () => syncComposer()
  input.addEventListener('input', onInputTyped)
  let statusUnsub = null
  let queueUnsub = null
  if (status && typeof status.subscribe === 'function') {
    try { statusUnsub = status.subscribe(() => syncComposer()) } catch { statusUnsub = null }
  }
  if (queue && typeof queue.subscribe === 'function') {
    try { queueUnsub = queue.subscribe(() => syncComposer()) } catch { queueUnsub = null }
  }
  syncComposer()

  let unregisterLifecycle = () => {}
  const dispose = () => {
    if (disposed) return
    disposed = true
    clearTimers()
    if (replyQueue.length) bumpChatDebug('queuedTurns', -replyQueue.length)
    replyQueue.length = 0
    const marker = takeTyping()
    marker?.remove()
    if (currentStream) {
      currentStream.message.removeAttribute('aria-busy')
      currentStream = null
      bumpChatDebug('streams', -1)
    }
    replying = false
    log.removeAttribute('aria-busy')
    anchorRo.disconnect()
    contentObserver.disconnect()
    cancelAnimationFrame(firstPinFrame)
    cancelAnimationFrame(settledPinFrame)
    document.fonts?.removeEventListener?.('loadingdone', onFontsLoaded)
    sendButton.removeEventListener('click', send)
    input.removeEventListener('keydown', onInputKeydown)
    input.removeEventListener('input', onInputTyped)
    try { statusUnsub?.() } catch { /* a dead subscription is the goal state */ }
    try { queueUnsub?.() } catch { /* likewise */ }
    closeActionsPop()
    if (onClose) root.querySelector('.chat-close')?.removeEventListener('click', onCloseClick)
    unregisterLifecycle()
    bumpChatDebug('activeChats', -1)
    bumpChatDebug('disposedChats', 1)
  }

  bumpChatDebug('activeChats', 1)
  unregisterLifecycle = registerChatLifecycle({ root, dispose, seenConnected: false, morphHost: null })
  Object.defineProperty(root, 'dispose', { value: dispose })

  /* A LIVE TURN, STREAMED INTO THE LOG BY THE CALLER. The simulated
     word-stream above answers PROMPTS this component invented; openStream is
     the real thing's door: the caller opens one bubble when the engine starts
     speaking, pushes the accumulated turn text as deltas arrive, and closes
     it with the final words. push REPLACES the bubble's text (the caller owns
     accumulation — the engine's delta events are already summed by the view),
     so a missed frame can never double words. One stream at a time is the
     caller's contract, same as cardReplies being single-slot per session. */
  Object.defineProperty(root, 'openStream', {
    value: ({ at = Date.now() } = {}) => {
      const { m, body } = makeMsg('them', '', null, at)
      m.setAttribute('aria-busy', 'true')
      lastTurnAt = at
      log.appendChild(m)
      log.scrollTop = log.scrollHeight
      let closed = false
      const paint = (text) => {
        body.innerHTML = formatInlineText(String(text ?? ''), { agents: [{ name: title, role: roleKey }], roleKey })
        log.scrollTop = log.scrollHeight
      }
      return {
        push: (text) => { if (!disposed && !closed) paint(text) },
        flush: () => { if (!disposed && !closed) { log.scrollTop = log.scrollHeight } },
        close: (finalText) => {
          if (closed) return
          closed = true
          if (!disposed && finalText != null) paint(finalText)
          m.removeAttribute('aria-busy')
        },
      }
    },
  })

  /* ---- THE ACTIONS POPUP: a quick-pick anchored over the composer. ----
     Rows come from the caller's actions() — built FRESH at every open, so
     enabled states are never stale. A row's run(ctx) may repaint the popup
     in place with ctx.show(rows, {title}) — that is how thinking depth,
     model and rewind are two-stage picks inside ONE panel — and may speak
     an outcome through ctx.say, which lands on the status line at the
     bottom. Escape and any press outside close it; so does dispose. */
  let popEl = null
  let popStack = []
  let popTopRows = []
  const onDocPointer = (event) => {
    if (!popEl) return
    if (popEl.contains(event.target)) return
    if (actionsButton && (event.target === actionsButton || actionsButton.contains(event.target))) return
    closeActionsPop()
  }
  const onPopKeydown = (event) => { if (event.key === 'Escape') closeActionsPop() }
  function closeActionsPop() {
    if (!popEl) return
    popEl.remove()
    popEl = null
    popStack = []
    popTopRows = []
    actionsButton?.setAttribute('aria-expanded', 'false')
    document.removeEventListener('pointerdown', onDocPointer, true)
    document.removeEventListener('keydown', onPopKeydown, true)
  }
  const renderPopStage = () => {
    if (!popEl) return
    const list = popEl.querySelector('.chat-actions-list')
    const filter = popEl.querySelector('.chat-actions-filter')
    const titleLine = popEl.querySelector('.chat-actions-title')
    const stage = popStack.length ? popStack[popStack.length - 1] : null
    /* The filter belongs to the top stage; a sub-stage is a short pick
       list with a Back row instead. */
    filter.hidden = Boolean(stage)
    titleLine.hidden = !stage?.title
    if (stage?.title) titleLine.textContent = stage.title
    list.textContent = ''
    const wanted = stage ? '' : filter.value.trim().toLowerCase()
    const rows = stage ? stage.rows : popTopRows.filter(row =>
      !wanted || row.label.toLowerCase().includes(wanted) || String(row.hint || '').toLowerCase().includes(wanted))
    if (stage) {
      const back = document.createElement('button')
      back.type = 'button'
      back.className = 'chat-actions-row chat-actions-back'
      back.textContent = '‹ Back'
      back.addEventListener('click', () => { popStack.pop(); renderPopStage() })
      list.appendChild(back)
    }
    if (!rows.length && !stage) {
      const none = document.createElement('p')
      none.className = 'chat-actions-hint'
      none.textContent = 'No action matches that. Clear the filter to see them all.'
      list.appendChild(none)
    }
    const out = popEl.querySelector('.chat-actions-out')
    const ctx = {
      say: sentence => { if (out) out.textContent = String(sentence ?? '') },
      close: closeActionsPop,
      show: (nextRows, { title: stageTitle = null } = {}) => {
        popStack.push({ rows: Array.isArray(nextRows) ? nextRows : [], title: stageTitle })
        renderPopStage()
      },
    }
    for (const row of rows) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'chat-actions-row'
      button.disabled = row.enabled === false
      const label = document.createElement('div')
      label.textContent = row.label
      button.appendChild(label)
      if (row.hint) {
        const hint = document.createElement('div')
        hint.className = 'chat-actions-hint'
        hint.textContent = row.hint
        button.appendChild(hint)
      }
      if (row.current) button.classList.add('is-current')
      button.addEventListener('click', () => {
        if (typeof row.run !== 'function') return
        Promise.resolve()
          .then(() => row.run(ctx))
          .then(said => { if (said && out && popEl) out.textContent = String(said) })
          .catch(() => { if (out && popEl) out.textContent = 'That did not happen. Try it again.' })
      })
      list.appendChild(button)
    }
  }
  const openActions = (sectionId = null) => {
    if (typeof actions !== 'function' || disposed) return
    closeActionsPop()
    popEl = el(`
      <div class="chat-actions-pop" aria-label="Actions">
        <div class="chat-actions-title" hidden></div>
        <input type="text" class="chat-actions-filter" placeholder="Filter actions…" aria-label="Filter actions">
        <div class="chat-actions-list"></div>
        ${actionsNote ? `<p class="chat-actions-hint chat-actions-note">${escapeMarkup(actionsNote)}</p>` : ''}
        <output class="chat-actions-out" role="status"></output>
      </div>`)
    root.appendChild(popEl)
    actionsButton?.setAttribute('aria-expanded', 'true')
    try { popTopRows = actions() || [] } catch { popTopRows = [] }
    popStack = []
    renderPopStage()
    const filter = popEl.querySelector('.chat-actions-filter')
    filter.addEventListener('input', () => renderPopStage())
    document.addEventListener('pointerdown', onDocPointer, true)
    document.addEventListener('keydown', onPopKeydown, true)
    if (sectionId) {
      const target = popTopRows.find(row => row.id === sectionId && row.enabled !== false && typeof row.run === 'function')
      if (target) {
        const out = popEl.querySelector('.chat-actions-out')
        void Promise.resolve().then(() => target.run({
          say: sentence => { if (out && popEl) out.textContent = String(sentence ?? '') },
          close: closeActionsPop,
          show: (nextRows, { title: stageTitle = null } = {}) => {
            popStack.push({ rows: Array.isArray(nextRows) ? nextRows : [], title: stageTitle })
            renderPopStage()
          },
        })).catch(() => {})
        return
      }
    }
    filter.focus()
  }
  actionsButton?.addEventListener('click', () => { popEl ? closeActionsPop() : openActions() })
  Object.defineProperty(root, 'openActions', { value: openActions })

  return root
}

/** Tiny sparkline (single series, de-emphasis hue, accent on last point). */
export function sparkline({ points, w = 150, h = 34, color = '#00a9d8', scaleMax = null }) {
  // scaleMax lets a set of sparklines share one ceiling. Without it every
  // spark normalises to its own extremes, so a flat series and a volatile
  // one render identical amplitude — shape without magnitude.
  const DOT_R = 4, DOT_RING = 2                    // end marker radius + its ring
  const series = (Array.isArray(points) ? points : [])
    .map(v => (Number.isFinite(v) ? v : 0))
  if (!series.length) series.push(0)
  const min = scaleMax != null ? 0 : Math.min(...series)
  const max = scaleMax != null ? scaleMax : Math.max(...series)
  const spread = (max - min) || 1
  // Vertical padding is the end marker's own footprint, not a magic 5. On a
  // shared ceiling a quiet series sits on the baseline (t≈0) and its marker
  // used to reach exactly h — the outer half of the ring fell off the bottom
  // of the viewBox (SVG clips by default), so the flattest agent in the table
  // looked like a shaved dot rather than a low line. Same at the top for the
  // series that defines the ceiling.
  const padY = Math.min(h / 2, DOT_R + DOT_RING / 2 + 0.5)
  const nx = (i) => (series.length > 1 ? (i / (series.length - 1)) * (w - 8) : (w - 8) / 2) + 4
  const ny = (v) => {
    // clamp so a point above scaleMax (or below a zero floor) bends to the
    // edge of the box instead of drawing outside it and being cut off
    const t = Math.min(1, Math.max(0, (v - min) / spread))
    return h - padY - t * (h - padY * 2)
  }
  const d = series.map((v, i) => `${i ? 'L' : 'M'}${nx(i).toFixed(1)} ${ny(v).toFixed(1)}`).join(' ')
  const lx = nx(series.length - 1), ly = ny(series[series.length - 1])
  return el(`
    <svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <path d="${d}" fill="none" stroke="var(--chart-spark)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${lx}" cy="${ly}" r="4" fill="${color}" stroke="var(--surface)" stroke-width="2"/>
    </svg>
  `)
}

/** Shared tooltip per container. */
export function makeTooltip(container) {
  const tip = el(`<div class="tooltip"></div>`)
  container.appendChild(tip)
  return {
    show(html, x, y) {
      tip.innerHTML = html
      tip.classList.add('show')
      const r = container.getBoundingClientRect()
      const tw = tip.offsetWidth, th = tip.offsetHeight
      let lx = x - r.left + 14, ly = y - r.top - th - 10
      if (lx + tw > r.width - 8) lx = x - r.left - tw - 14
      if (ly < 4) ly = y - r.top + 16
      tip.style.left = `${lx}px`; tip.style.top = `${ly}px`
    },
    hide() { tip.classList.remove('show') },
  }
}

/* Segmented-control indicator. Idempotent; call once per .seg after mount.
   Uses offsetLeft/offsetWidth (layout values, immune to the view-enter
   transform that forced metrics' old getBoundingClientRect inverse math).
   Returns a detach() for the view's cleanup list. */
export function attachSeg(group) {
  let ind = group.querySelector(':scope > .seg-ind')
  if (!ind) {
    ind = document.createElement('span')
    ind.className = 'seg-ind'
    ind.setAttribute('aria-hidden', 'true')
    group.prepend(ind)
  }
  /* The 'ready' writes are guarded because the indicator itself sits inside
     the observed subtree and a same-value classList.add/remove still queues a
     mutation record (measured in Chromium), so an unguarded write here is a
     MutationObserver feeding itself — an infinite microtask loop that hangs
     the page. Written only on actual change, the observer goes quiet once
     the indicator is settled. (style.width/transform are exempt: the
     observer filters on 'class' alone.) */
  const sync = () => {
    if (!group.offsetWidth) return       // hidden (comms size-seg in channels
                                         // mode): re-syncs via RO on show
    const on = group.querySelector(':scope > button.on')
    if (!on) {
      if (ind.classList.contains('ready')) ind.classList.remove('ready')
      return
    }
    /* offsetLeft, with NO clientLeft correction: measured in Chromium, a
       button 4px from the group's border edge (1px border + 3px padding)
       reports offsetLeft 3 — i.e. the value is already relative to the
       padding edge, which is exactly where the absolutely-positioned
       indicator's left:0 sits. Subtracting the border again shifted every
       indicator 1px left of its button. */
    ind.style.width = `${on.offsetWidth}px`
    ind.style.transform = `translateX(${on.offsetLeft}px)`
    if (!ind.classList.contains('ready')) ind.classList.add('ready')
  }
  const mo = new MutationObserver(sync)
  mo.observe(group, { attributes: true, attributeFilter: ['class'], subtree: true })
  const ro = new ResizeObserver(sync)
  ro.observe(group)
  document.fonts?.ready?.then(sync)
  sync()
  return () => { mo.disconnect(); ro.disconnect() }
}

/**
 * Count a readout from one number to another, in place (no layout jump).
 * Used by every morph that swaps a live figure — rail hero, metric tiles.
 * Returns a cancel function; honours body.reduce-motion by snapping.
 */
export function countUp(el, from, to, ms = 700) {
  if (!el) return () => {}
  const a = Number(from), b = Number(to)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return () => {}
  const decimals = Math.max(decimalsOf(a), decimalsOf(b))
  const fmt = (v) => decimals ? v.toFixed(decimals) : String(Math.round(v))
  if (a === b || !(ms > 0) || document.body.classList.contains('reduce-motion')) {
    el.textContent = fmt(b)
    return () => {}
  }
  let raf = 0
  const t0 = performance.now()
  const ease = (t) => 1 - Math.pow(1 - t, 3)          // out-cubic, settles quietly
  const step = (now) => {
    const t = Math.min(1, (now - t0) / ms)
    el.textContent = fmt(a + (b - a) * ease(t))
    if (t < 1) raf = requestAnimationFrame(step)
    else el.textContent = fmt(b)
  }
  raf = requestAnimationFrame(step)
  return () => cancelAnimationFrame(raf)
}

function decimalsOf(n) {
  const s = String(n)
  const i = s.indexOf('.')
  return i < 0 ? 0 : Math.min(3, s.length - i - 1)
}

/**
 * One-shot channel for shared-element view transitions: a view announces the
 * screen point the next navigation should morph from, the shell consumes it.
 * Nothing here changes a route — the hash router stays exactly as it was.
 */
let pendingViewMorph = null
export function setViewMorph(morph) {
  pendingViewMorph = morph ? { ...morph, at: performance.now() } : null
}
export function takeViewMorph() {
  const m = pendingViewMorph
  pendingViewMorph = null
  return m
}

/** Runtime text updater registry — one central clock drives all timers.
 *  Implemented in ./runtime-clock.js (dependency-free so it can be tested
 *  without importing sim.js, which schedules timers at import time) and
 *  re-exported here so every existing call site is unchanged. */
export { bindRuntime, tickRuntimes } from './runtime-clock.js'
