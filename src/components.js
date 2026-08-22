// Shared UI pieces: uptime ring, chat window, sparkline, tooltip.

import { uptimeParts } from './runtime-clock.js'
import { crescentSpec } from './crescent-field.js'
import { mountCrescent } from './crescent-mount.js'
import { onNextFrame } from './page-frames.js'
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
  /* The roster comes from the CALLER's agents, full stop. This used to also
     walk sim.computers, which meant every live chat's @-mention highlighting
     was built partly from the demonstration engine's invented fleet -- live
     text lit up for agents that never existed on this machine. The literal
     fallback patterns below still cover the example world's names, so the
     example loses nothing. */
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

/* WHICH FOLDS A PERSON HAS OPENED, REMEMBERED PER KEY.
 *
 * Extracted from addContext below, byte-for-byte in behaviour, because the home
 * screen's run rows now fold the same way the chat's context block does and
 * the owner asked for exactly that: "collapse the context and such as it goes
 * like we do in chat." One memory with two prefixes is one rule; a second copy
 * inside home.js would be the version that drifts.
 *
 * `recall` answers 'open' | 'closed' | null, where null is "nobody has said"
 * and the caller picks its own default -- a row that should open because it
 * is the newest, say. `remember` writes the choice. Both swallow a storage
 * that refuses (private mode, a shim that throws): a fold that cannot be
 * remembered is still a fold that opens for this sitting. No key means no
 * memory rather than a shared one, the same rule addContext always had. */
export function openMemory(prefix) {
  const base = typeof prefix === 'string' ? prefix : ''
  return {
    recall(key) {
      if (!key) return null
      try {
        const value = localStorage.getItem(base + key)
        return value === 'open' || value === 'closed' ? value : null
      } catch { return null }
    },
    remember(key, open) {
      if (!key) return
      try { localStorage.setItem(base + key, open ? 'open' : 'closed') } catch { /* session-only is still a real change */ }
    },
  }
}

/* THE OWNED DISCLOSURE GESTURE, for a <details> whose whole row should open.
 *
 * MEASURED on a staged packaged build (the reasoning is at makeAction below):
 * document.elementFromPoint over any part of a collapsed row answers the
 * DETAILS element rather than the SUMMARY inside it, so a press beside the
 * triangle is not a press on the disclosure and nothing opens. The row looked
 * pressable and was not. So the native toggle is cancelled and redone by hand,
 * which also stops a press on the summary toggling twice.
 *
 * THE ONE NARROWING, which is why the home rows cannot simply reuse addContext's
 * handler: a run row's open body holds text a person selects and a link they
 * follow, and a gesture that folds the row on every press inside it would take
 * both away. `within` is the element whose presses toggle (the summary); a
 * press whose target is the details itself -- the elementFromPoint case on a
 * collapsed row -- still toggles, and a press inside the open body is left
 * alone. Keyboard needs nothing extra: the summary is natively focusable and
 * Enter or Space fire a click on it. With no `within`, every press toggles,
 * which is the behaviour addContext has always had. */
export function ownDisclosure(details, { within = null, onToggle = null } = {}) {
  details.addEventListener('click', (event) => {
    if (within && event.target !== details && !within.contains(event.target)) return
    event.preventDefault()
    details.open = !details.open
    if (typeof onToggle === 'function') onToggle(details.open)
  })
}

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
export function buildChat({ title, subtitle = '', roleKey = 'coordinator', seed = 3, onClose = null, tall = false, context = null, onSend = null, history = null, onAttach = null, onMention = null, status = null, queue = null, actions = null, actionsNote = null, onStop = null, composerReason = null, onReady = null, sampleConversation = false }) {
  /* SELF-ANSWERING IS OPT-IN NOW. Without `onSend` this composer used to push
     the turn onto replyQueue and stream a canned reply back -- right for the
     one labelled demonstration surface that exists to show what a conversation
     looks like, and a lie everywhere else: the comms watch-boards reached it on
     LIVE sources, and the agent page's box answered itself under a caption
     reading "typing in it still reaches nothing". Found independently by two
     lanes during the one-render cutover. A caller that wants the demonstration
     says `sampleConversation: true`; a caller with a real sender passes
     `onSend`; anyone with neither gets a switched-off composer that says why,
     through the same composerReason mechanism refusals already use. */
  if (typeof onSend !== 'function' && sampleConversation !== true
      && !(typeof composerReason === 'string' && composerReason.trim().length > 0)) {
    composerReason = 'Nothing is connected to this box, so nothing typed here is sent.'
  }
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
        <input type="text" ${cannotSend
          /* "NOT NOW" WAS NOT A LEAKED LABEL (owner: "why is it saying not
             now?"). It was typed here, and it is the whole of what a disabled
             box says for itself: two words that read like a button, sitting
             under a sentence that has already explained the situation
             properly. The identical words in src/fleet-tree-copy.js are the
             compose panel's cancel button and are a coincidence; nothing joins
             the two.
             The input carries no label of any kind, so this placeholder is
             also its entire accessible name -- which is why the switched-off
             state gets the REASON as an aria-label rather than nothing. */
          ? `placeholder="You cannot send a message here" aria-label="${escapeMarkup(composerReason)}" disabled`
          : `placeholder="Message ${escapeMarkup(title)}…" aria-label="Message ${escapeMarkup(title)}"`} />
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
      if (!disposed && said) addMsg('note', String(said))
    } catch {
      if (!disposed) addMsg('note', 'Nothing was stopped; the turn may already be over.')
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

  /* AN EMPTY LOG SAYS SO, IN WORDS. A live agent page over a declared seat
     that has never run seeds nothing and has no history, so the log rendered
     as a bare box -- roughly 600x125px of nothing, over a composer whose
     reason line explains only the COMPOSER. tools/window-size-sweep-qa.mjs
     flags exactly that shape ("no empty region where content should be --
     div.chat-log") at every width, and it is right: a hole reads as broken,
     a sentence reads as a fact. The note is styled inline (muted ink, own
     margins) rather than in styles.css, and it leaves the moment the first
     real message lands. */
  const emptyNote = document.createElement('div')
  emptyNote.className = 'chat-log-empty'
  emptyNote.textContent = 'Nothing has been said here yet.'
  emptyNote.style.cssText = 'margin:auto;padding:var(--s3) 0;color:var(--ink-25);font-size:12.5px;text-align:center;'

  /* WHO IS SPEAKING, AND WHEN THE LOG SAYS SO.
   *
   * THE DEFECT (owner, items 2 and 4: the messages "pile"). Live messages
   * passed no label at all while restored history passed one for every entry,
   * so the same conversation carried names on its past and none on its
   * present, and a person reading it could not tell whose words were whose.
   * MEASURED on a staged packaged build: hasWho false on the live row, true on
   * the restored row directly above it.
   *
   * So the rule lives HERE rather than at each call site: a label whenever the
   * speaker changes, whichever path appended the row. A caller may still force
   * one (pass a name) or forbid one (pass null); `undefined` means "you
   * decide", which is what every real path now says. */
  let lastLabelled = null
  const labelFor = (from) => {
    if (from === 'me') return 'you'
    /* The product's own notes are not a speaker, so they are not named. */
    if (from === 'note') return null
    return title
  }
  /* The two paths that build their own bubble rather than going through
     addMsg -- the live stream and the simulated reply -- still take the shared
     rule, so a turn being written and a turn already written are the same
     bubble with the same label. */
  const streamLabel = (at) => {
    const divided = lastTurnAt !== null && at - lastTurnAt > CHAT_CLUSTER_GAP
    const label = (lastLabelled === 'them' && !divided) ? null : labelFor('them')
    lastLabelled = 'them'
    return label
  }
  const addMsg = (from, text, who, at = Date.now()) => {
    if (emptyNote.parentNode) emptyNote.remove()
    const divided = lastTurnAt !== null && at - lastTurnAt > CHAT_CLUSTER_GAP
    if (divided) addTimeDivider(at)
    lastTurnAt = at
    /* A time divider is a fresh start, so the speaker is named again beneath
       one even when it is the same speaker. */
    const decided = who === undefined
      ? ((lastLabelled === from && !divided) ? null : labelFor(from))
      : who
    const { m } = makeMsg(from, text, decided, at)
    lastLabelled = from
    log.appendChild(m)
    log.scrollTop = log.scrollHeight
    return m
  }
  /* THE TREE'S OWN WORDS, FOLDED AWAY BUT NEVER CUT.
   *
   * THE DEFECT. The address block rides with every tree start as its own
   * transcript entry, and giving it a quiet dress was only half the fix:
   * MEASURED on a staged packaged build, it still drew 298px in a 371px log,
   * so the first thing a first-timer saw of their first conversation was a
   * screen and a half of internal plumbing. Quiet plumbing is still plumbing.
   *
   * A DISCLOSURE, NOT A TRUNCATION, and the distinction is the whole design.
   * Nothing is removed, shortened or summarised away: the entry stays whole
   * inside, one press away, and the press is the one a person has already
   * learned from the action rows two inches down the same panel.
   *
   * THE CLOSED LINE HAS TO EARN THE PRESS. A fold labelled with plumbing is
   * how you get somebody who never opens it, so the caller supplies a sentence
   * in the person's own words AND the size -- this component stays copy-free,
   * so both ride on the entry.
   *
   * REMEMBERED PER CONVERSATION. Somebody who opens this wants it open for the
   * thread they are reading, not for every thread they ever open, so the key
   * is the caller's (`openKey`, the session). No key means no memory rather
   * than a shared one -- a global default is the thing being avoided. */
  const contextOpen = openMemory('mc.chat.context-open:')

  const addContext = (entry) => {
    if (emptyNote.parentNode) emptyNote.remove()
    const at = Number.isFinite(entry.at) ? entry.at : Date.now()
    const key = typeof entry.openKey === 'string' ? entry.openKey : ''
    const wrap = document.createElement('details')
    wrap.className = 'msg context chat-context'
    wrap.title = chatTime(at)
    wrap.open = contextOpen.recall(key) === 'open'
    const head = document.createElement('summary')
    head.className = 'chat-context-head'
    const mark = document.createElement('span')
    mark.className = 'chat-action-mark'
    mark.setAttribute('aria-hidden', 'true')
    mark.innerHTML = '<svg viewBox="0 0 8 8"><path d="M2.6 1.4 5.4 4 2.6 6.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    const words = document.createElement('span')
    words.className = 'chat-context-line'
    /* The heading names WHO, the sentence says WHAT and HOW MUCH. Both are the
       caller's words. */
    const who = document.createElement('span')
    who.className = 'who'
    who.textContent = typeof entry.label === 'string' ? entry.label : ''
    const say = document.createElement('span')
    say.className = 'chat-context-say'
    say.textContent = typeof entry.summary === 'string' ? entry.summary : ''
    words.append(who, say)
    head.append(mark, words)
    const body = document.createElement('div')
    body.className = 'chat-context-body'
    body.innerHTML = formatInlineText(entry.text, { agents: [{ name: title, role: roleKey }], roleKey })
    wrap.append(head, body)
    /* The gesture is owned here for the reason makeAction documents at length:
       elementFromPoint over a collapsed row answers the DETAILS, so a press
       beside the disclosure triangle is not a press on it and nothing opens. */
    wrap.addEventListener('click', (event) => {
      event.preventDefault()
      wrap.open = !wrap.open
      contextOpen.remember(key, wrap.open)
    })
    lastTurnAt = at
    log.appendChild(wrap)
    log.scrollTop = log.scrollHeight
    return wrap
  }

  /* ---- THE SECOND DOOR: WHAT THE AGENT DID, BESIDE WHAT IT SAID. ----
   *
   * THE DEFECT THIS CLOSES (owner, item 1, and his biggest ask). The engine
   * narrates every turn -- tool_call, tool_result, approval_request, each
   * carrying the command or the path and the name that pairs a result with its
   * call -- and every one of those packets already reached this window. They
   * went to a ONE-LINE status string that the next event overwrote, and were
   * deleted when the turn ended. So a turn that spent five minutes running
   * commands put ZERO rows in the chat, by construction, and the product looked
   * hung while it worked.
   *
   * openStream is the door for what the agent SAYS; this is the door for what
   * it DOES, and they append into the SAME log so the two interleave in arrival
   * order the way an editor interleaves its tool calls with its prose.
   *
   * A ROW IS COLLAPSED AND PRESSABLE. `details`/`summary` rather than a button
   * and a class toggle: the open/closed state, the keyboard, and the screen
   * reader all come from the element, and nothing here has to reimplement them.
   *
   * A RESULT UPDATES ITS CALL'S ROW. The id is the caller's join key (both
   * engines put one on the event), so a command that finishes repaints the row
   * it started rather than adding a second one beneath it.
   *
   * APPENDS ARE BATCHED PER FRAME, and that is not a micro-optimisation. This
   * log is pinned to its bottom by a ResizeObserver AND a MutationObserver, both
   * of which fire on every appended child; a busy turn would re-pin thousands of
   * times on the main thread. onNextFrame rather than requestAnimationFrame for
   * the reason src/page-frames.js exists: on a window the machine has covered
   * there is no next frame, so the callback -- and this whole chat with it --
   * would be retained for ever.
   *
   * THE WORDS ARE THE CALLER'S. This component is used by three pages and must
   * stay copy-free; the tool names and outcome words live in
   * src/fleet-tree-copy.js, where the plain-language gate can hold them. */
  const actionRows = new Map()
  let pendingActions = []
  let actionFrame = 0

  const makeAction = (row) => {
    const wrap = document.createElement('details')
    wrap.className = 'chat-action'
    const head = document.createElement('summary')
    head.className = 'chat-action-head'
    const tool = document.createElement('span')
    tool.className = 'chat-action-tool'
    const detail = document.createElement('span')
    detail.className = 'chat-action-detail'
    const state = document.createElement('span')
    state.className = 'chat-action-state'
    /* THE ROW SAYS WHETHER IT OPENS. Expandable rows and bare rows (a
       conversation restored from the excerpt keeps the command, not its
       output) drew identically, so a person pressing a bare row got nothing
       and learned the rows were broken. The disclosure mark is the
       difference: drawn on a row with something to open, blank on one
       without — the mark's SPACE is kept either way so the columns align.
       Decorative only (the details element already announces its state), so
       it is hidden from the accessibility tree. */
    const mark = document.createElement('span')
    mark.className = 'chat-action-mark'
    mark.setAttribute('aria-hidden', 'true')
    mark.innerHTML = '<svg viewBox="0 0 8 8"><path d="M2.6 1.4 5.4 4 2.6 6.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    head.append(mark, tool, detail, state)
    /* A command and its output are machine text: textContent, never markup. */
    const body = document.createElement('pre')
    body.className = 'chat-action-body'
    wrap.append(head, body)
    /* THE ROW OPENS ON A PRESS ANYWHERE ON IT, AND THAT IS NOT WHAT `details`
     * GAVE US FOR FREE.
     *
     * MEASURED on a staged packaged build with real mouse events at coordinates
     * taken from the element's own box: document.elementFromPoint over any part
     * of a collapsed row -- the heading, the tool name, the command text --
     * answers the DETAILS element rather than the SUMMARY inside it, and a press
     * that lands on the details' own area is not a press on the disclosure, so
     * nothing opened. The row looked pressable and was not.
     *
     * So the gesture is owned here instead of inherited: the native toggle is
     * cancelled and the row is opened by hand, which makes a press anywhere on
     * the heading work exactly as it looks like it should. `details` is kept for
     * what it is genuinely good at -- the open/closed state, the keyboard, and
     * what a screen reader announces.
     *
     * A ROW WITH NOTHING TO OPEN DOES NOT OPEN. A conversation restored from an
     * excerpt the window no longer holds carries the command and not the output
     * it printed, and expanding onto an empty panel reads as the product having
     * lost something. */
    wrap.addEventListener('click', (event) => {
      /* ON THE ROW, NOT ON ITS HEADING, and the difference is the whole reason
         the first version of this did nothing. The press lands on the DETAILS
         element -- that is what elementFromPoint answers over every part of a
         collapsed row -- so the click's target IS the details and a handler
         bound to the summary inside it never sees the event. Events travel up,
         never down. */
      if (wrap.classList.contains('is-bare')) { event.preventDefault(); return }
      /* The native toggle is cancelled and redone by hand so that a press on
         the summary and a press beside it behave identically rather than
         toggling twice. */
      event.preventDefault()
      wrap.open = !wrap.open
    })
    wrap.addEventListener('toggle', () => {
      if (wrap.open && wrap.classList.contains('is-bare')) wrap.open = false
    })
    return { wrap, tool, detail, state, body }
  }

  const paintAction = (row) => {
    let held = actionRows.get(row.id)
    if (!held) {
      if (emptyNote.parentNode) emptyNote.remove()
      held = makeAction(row)
      actionRows.set(row.id, held)
      log.appendChild(held.wrap)
    }
    held.wrap.dataset.actionState = String(row.stateKey || '')
    held.tool.textContent = String(row.tool || '')
    held.detail.textContent = String(row.detail || '')
    held.detail.title = String(row.body || row.detail || '')
    held.state.textContent = String(row.state || '')
    const body = String(row.body || '')
    held.body.textContent = body
    /* Nothing to open is said by the row itself rather than by an empty panel. */
    held.wrap.classList.toggle('is-bare', body.length === 0)
  }

  const flushActions = () => {
    actionFrame = 0
    if (disposed || pendingActions.length === 0) return
    const batch = pendingActions
    pendingActions = []
    for (const row of batch) paintAction(row)
    pinToBottom()
  }

  Object.defineProperty(root, 'addAction', {
    value: (row) => {
      if (disposed || !row || typeof row !== 'object' || !row.id) return
      pendingActions.push(row)
      if (!actionFrame) actionFrame = onNextFrame(flushActions)
    },
  })

  /* REAL HISTORY, WHEN THE CALLER HAS ONE. The tree card passes the actual
     conversation (this window's transcript, or the node's stored ask+reply),
     rendered verbatim — the simulated excerpt below never runs for a caller
     that provided real entries, whatever its seed. */
  if (Array.isArray(history) && history.length) {
    for (const entry of history) {
      /* AN ACTION IS PART OF THE HISTORY TOO, and it is painted by the SAME
         function the live stream uses -- so a conversation reopened tomorrow
         shows the commands where they happened, in the same rows, rather than
         showing only the words and pretending the work was instantaneous. */
      if (entry && entry.who === 'action') { paintAction(entry); continue }
      if (!entry || typeof entry.text !== 'string' || !entry.text) continue
      /* The product's own aside inside a restored conversation -- how it came
         to be shorter than the conversation really was. Same kind, same rule,
         same look as one spoken live. */
      if (entry.who === 'note') { addMsg('note', entry.text, undefined, Number.isFinite(entry.at) ? entry.at : Date.now()); continue }
      /* WORDS THE PRODUCT SENT FROM THE PERSON'S SIDE -- the tree's context
         block. The caller marks it (this component stays copy-free, so the
         label rides on the entry) and it renders on the sent side in the
         aside family's quiet dress, so the person's own words stay the only
         thing wearing their colour. */
      if (entry.who === 'context') {
        addContext(entry)
        continue
      }
      /* The label is left to addMsg -- the SAME rule the live path takes, so a
         restored conversation and the turn that continues it cannot disagree
         about whose words are whose. */
      addMsg(
        entry.who === 'you' ? 'me' : 'them',
        entry.text,
        undefined,
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
  /* Only a log that ends this constructor with nothing in it gets the note;
     the first addMsg from any path removes it again. */
  if (log.childElementCount === 0) log.appendChild(emptyNote)
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
    /* Two frames because the webfont swap grows the text a frame after it
       lands. On a page that gets NO frames both callbacks were pending for
       ever and held this chat's whole tree -- the largest single contributor
       at +3 per lap of the ring, measured. onNextFrame applies the pin at
       once on such a page (off a flushed layout, so the height is the real
       one) and behaves exactly as requestAnimationFrame when the page can
       draw. The handles are still stored, so the existing teardown that
       cancels them keeps working unchanged. */
    firstPinFrame = onNextFrame(() => {
      settledPinFrame = onNextFrame(pinToBottom)
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
    const { m, body } = makeMsg('them', '', streamLabel(replyAt), replyAt)
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
        addMsg('note', (queued && queued.sentence) || 'That was not queued. Try it again in a moment.')
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
          /* THE AGENT'S ANSWER PAINTS AS THE AGENT, and until now it painted
             as its ROLE KEY -- `class="msg helper"`, for which no rule exists
             in any stylesheet. Measured on a staged packaged build: background
             rgba(0,0,0,0), border 0px, no shadow, align-self auto (the full
             width of the log, on neither side) and no sender label, directly
             beneath a restored `msg them` bubble carrying all of it. One
             conversation, the same agent, painted two ways.
             A refusal is NOT the agent speaking, so it keeps a kind of its own
             rather than being dressed as words the agent said. */
          reply: text => { if (!disposed) addMsg('them', String(text)) },
          fail: text => { if (!disposed) addMsg('note', String(text)) }
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
          addMsg('note', 'That did not send, and this screen was not told why. Try once more; if it keeps happening, reload the page.')
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
    /* A batch waiting on a frame outlives the log it would draw into. */
    if (actionFrame) { cancelAnimationFrame(actionFrame); actionFrame = 0 }
    pendingActions = []
    actionRows.clear()
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

  /* WHO TO TELL WHEN SOMETHING HAPPENS IN THIS CONVERSATION. A caller that
     streams a live turn into a chat has to be able to find that chat again --
     and the two surfaces this product mounts (the rail's Chat tab and the
     compact card on the canvas) are built from ONE shared config, spread by
     both, so a hand-off written on either mount would have to be written twice
     and would drift. It goes on the config instead, and both get it for free.
     A caller that throws here is a caller defect and must not cost the chat. */
  if (typeof onReady === 'function') {
    try { onReady(root) } catch { /* a broken handler never costs the chat */ }
  }

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
      const { m, body } = makeMsg('them', '', streamLabel(at), at)
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
     Rows come from the caller's actions() -- built FRESH at every open, so
     enabled states are never stale. A row's run(ctx) may repaint the popup
     in place with ctx.show(rows, {title}) -- that is how thinking depth,
     model and rewind are two-stage picks inside ONE panel -- and may speak
     an outcome through ctx.say, which lands on the status line at the
     bottom. Escape and any press outside close it; so does dispose.

     KEYBOARD-FIRST, WHICH IS THE SUBSTANCE OF "MORE LIKE VSCODE". The
     owner's report on this menu was that it should be more like VS Code and
     more intuitive. What VS Code's quick pick has that this did not is not
     a look: it is that the whole thing is driven from the filter box. Type
     to narrow, Up and Down to move, Enter to run, Escape to leave, and the
     row under the cursor announced to assistive tech as you move. This
     popup's entire keyboard handler was one line for Escape; the rows were
     plain buttons reachable only by Tab or mouse; the filter carried no
     aria-controls, no aria-activedescendant, no arrow keys.

     So the filter is now a combobox over a listbox: focus stays in the
     input, aria-activedescendant names the active row, and every row is an
     option with a stable id for this opening. A sub-stage keeps the same
     model with the list itself as the focus target, since its filter is
     hidden.

     ROWS ARE GROUPED, and the group that ends or forgets something is last.
     A row's `group` is a heading; consecutive rows sharing one sit under it.
     Arrow keys walk the row array, never the DOM, so headings are skipped by
     construction.

     A DISABLED ROW SAYS WHY. A row carrying `disabledHint` shows that
     sentence in place of its hint when it is switched off, and Enter on it
     speaks the same sentence, so a keyboard user gets a reason where they
     used to get silence. */
  let popEl = null
  let popStack = []
  let popTopRows = []
  /* The rows on the glass right now, in walk order, and which is active.
     Rebuilt by renderPopStage; the index survives a repaint so the cursor
     does not jump while a person types. */
  let popRendered = []
  let popActive = -1
  /* One id family per OPENING, so the ids are stable for as long as the
     popup is up and cannot collide with a second chat's popup. */
  let popSerial = 0
  const onDocPointer = (event) => {
    if (!popEl) return
    if (popEl.contains(event.target)) return
    if (actionsButton && (event.target === actionsButton || actionsButton.contains(event.target))) return
    closeActionsPop()
  }
  /* Kept at the document, in capture, so Escape closes the popup from
     wherever focus has wandered -- the row model below is a superset of
     this, not a replacement for it. */
  const onPopKeydown = (event) => { if (event.key === 'Escape') closeActionsPop() }
  /* Focus left the popup for somewhere that is not the popup and not the
     button that opens it. VS Code's quick pick closes on exactly this, and
     it is what lets a row that hands focus to the composer (Mention a file)
     get out of the way. Deferred a tick because hiding the filter on a
     sub-stage blurs it with no relatedTarget BEFORE the list is focused. */
  const onPopFocusOut = () => {
    setTimeout(() => {
      if (!popEl) return
      const active = document.activeElement
      if (popEl.contains(active)) return
      if (actionsButton && (active === actionsButton || actionsButton.contains(active))) return
      closeActionsPop()
    }, 0)
  }
  function closeActionsPop() {
    if (!popEl) return
    popEl.remove()
    popEl = null
    popStack = []
    popTopRows = []
    popRendered = []
    popActive = -1
    actionsButton?.setAttribute('aria-expanded', 'false')
    document.removeEventListener('pointerdown', onDocPointer, true)
    document.removeEventListener('keydown', onPopKeydown, true)
  }
  const popCtx = () => {
    const out = popEl?.querySelector('.chat-actions-out')
    return {
      say: sentence => { if (out && popEl) out.textContent = String(sentence ?? '') },
      close: closeActionsPop,
      show: (nextRows, { title: stageTitle = null } = {}) => {
        popStack.push({ rows: Array.isArray(nextRows) ? nextRows : [], title: stageTitle })
        popActive = -1
        renderPopStage()
      },
    }
  }
  const runPopRow = (entry) => {
    if (!entry || !popEl) return
    const out = popEl.querySelector('.chat-actions-out')
    if (entry.enabled === false) {
      /* Enter on a row that cannot be pressed: the reason, on the status
         line, rather than nothing. */
      if (out && entry.disabledHint) out.textContent = entry.disabledHint
      return
    }
    if (typeof entry.run !== 'function') return
    Promise.resolve()
      .then(() => entry.run(popCtx()))
      .then(said => { if (said && out && popEl) out.textContent = String(said) })
      .catch(() => { if (out && popEl) out.textContent = 'That did not happen. Try it again.' })
  }
  /* Move the cursor and say so: the class for the eye, aria-selected and
     aria-activedescendant for the ear, and the row scrolled into the list's
     box so the cursor never leaves the visible rows. */
  const paintPopActive = () => {
    if (!popEl) return
    const filter = popEl.querySelector('.chat-actions-filter')
    const list = popEl.querySelector('.chat-actions-list')
    if (popActive >= popRendered.length) popActive = popRendered.length - 1
    let activeId = ''
    popRendered.forEach((entry, index) => {
      const on = index === popActive
      entry.button.classList.toggle('is-active', on)
      entry.button.setAttribute('aria-selected', on ? 'true' : 'false')
      if (on) {
        activeId = entry.button.id
        entry.button.scrollIntoView?.({ block: 'nearest' })
      }
    })
    for (const owner of [filter, list]) {
      if (!owner) continue
      if (activeId) owner.setAttribute('aria-activedescendant', activeId)
      else owner.removeAttribute('aria-activedescendant')
    }
  }
  const movePopActive = (delta) => {
    if (!popRendered.length) return
    if (popActive < 0) popActive = delta > 0 ? 0 : popRendered.length - 1
    else popActive = (popActive + delta + popRendered.length) % popRendered.length
    paintPopActive()
  }
  const firstEnabledPopRow = () => {
    const index = popRendered.findIndex(entry => entry.enabled !== false)
    return index === -1 ? (popRendered.length ? 0 : -1) : index
  }
  /* The keyboard model, bound to the popup so it hears the filter and, on a
     sub-stage, the list. Escape is left to the document handler above. */
  const onPopKeys = (event) => {
    if (!popEl) return
    if (event.key === 'ArrowDown') { event.preventDefault(); movePopActive(1); return }
    if (event.key === 'ArrowUp') { event.preventDefault(); movePopActive(-1); return }
    if (event.key === 'Home') { event.preventDefault(); popActive = popRendered.length ? 0 : -1; paintPopActive(); return }
    if (event.key === 'End') { event.preventDefault(); popActive = popRendered.length - 1; paintPopActive(); return }
    if (event.key === 'Enter') {
      event.preventDefault()
      const entry = popActive >= 0 ? popRendered[popActive] : popRendered[firstEnabledPopRow()]
      runPopRow(entry)
    }
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
    popRendered = []
    const wanted = stage ? '' : filter.value.trim().toLowerCase()
    const rows = stage ? stage.rows : popTopRows.filter(row =>
      !wanted || row.label.toLowerCase().includes(wanted) || String(row.hint || '').toLowerCase().includes(wanted))
    const optionId = index => `chat-actions-opt-${popSerial}-${index}`
    const addOption = (entry) => {
      const index = popRendered.length
      entry.button.id = optionId(index)
      entry.button.setAttribute('role', 'option')
      entry.button.setAttribute('aria-selected', 'false')
      /* Hovering moves the cursor, as it does in VS Code, so mouse and
         keyboard never disagree about which row Enter would run. */
      entry.button.addEventListener('mousemove', () => {
        if (popActive === index) return
        popActive = index
        paintPopActive()
      })
      popRendered.push(entry)
      list.appendChild(entry.button)
    }
    if (stage) {
      const back = document.createElement('button')
      back.type = 'button'
      back.className = 'chat-actions-row chat-actions-back'
      back.textContent = '‹ Back'
      const leave = () => { popStack.pop(); popActive = -1; renderPopStage() }
      back.addEventListener('click', leave)
      addOption({ button: back, enabled: true, run: leave })
    }
    if (!rows.length && !stage) {
      const none = document.createElement('p')
      none.className = 'chat-actions-hint'
      none.textContent = 'No action matches that. Clear the filter to see them all.'
      list.appendChild(none)
    }
    let lastGroup = null
    for (const row of rows) {
      /* A heading when the group changes. role="presentation" so the listbox
         still counts only options; the eye gets the heading, the ear gets the
         option that follows it. */
      const group = typeof row.group === 'string' && row.group ? row.group : null
      if (group && group !== lastGroup) {
        const heading = document.createElement('div')
        heading.className = 'chat-actions-group'
        heading.setAttribute('role', 'presentation')
        heading.textContent = group
        list.appendChild(heading)
      }
      lastGroup = group
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'chat-actions-row'
      const disabled = row.enabled === false
      button.disabled = disabled
      if (disabled) button.setAttribute('aria-disabled', 'true')
      const label = document.createElement('div')
      label.textContent = row.label
      button.appendChild(label)
      /* The hint, or the reason it cannot be pressed. Never both, and the
         reason gets its own class so the eye can tell them apart too. */
      const why = disabled && typeof row.disabledHint === 'string' ? row.disabledHint : ''
      if (why || row.hint) {
        const hint = document.createElement('div')
        hint.className = why ? 'chat-actions-hint chat-actions-why' : 'chat-actions-hint'
        hint.textContent = why || row.hint
        button.appendChild(hint)
      }
      if (row.current) button.classList.add('is-current')
      const entry = { button, enabled: !disabled, disabledHint: why, run: row.run }
      button.addEventListener('click', () => runPopRow(entry))
      addOption(entry)
    }
    if (popActive < 0 || popActive >= popRendered.length) {
      /* First press of Enter runs the obvious thing: the first row that can
         be pressed, or Back's neighbour on a sub-stage. */
      popActive = stage ? Math.min(1, popRendered.length - 1) : firstEnabledPopRow()
    }
    paintPopActive()
    /* Where the keys go. The top stage types into the filter; a sub-stage
       has no filter, so its list takes focus. Only moved when focus is
       inside the popup and on the wrong half of it, so a person mid-word in
       the filter is never interrupted. */
    const focused = document.activeElement
    if (stage) {
      if (focused !== list) list.focus({ preventScroll: true })
    } else if (focused === list || (focused && popEl.contains(focused) && focused !== filter && focused.tagName !== 'BUTTON')) {
      filter.focus({ preventScroll: true })
    }
  }
  const openActions = (sectionId = null) => {
    if (typeof actions !== 'function' || disposed) return
    closeActionsPop()
    popSerial += 1
    const listId = `chat-actions-list-${popSerial}`
    popEl = el(`
      <div class="chat-actions-pop" aria-label="Actions">
        <div class="chat-actions-title" hidden></div>
        <input type="text" class="chat-actions-filter" placeholder="Filter actions…" aria-label="Filter actions"
          role="combobox" aria-expanded="true" aria-autocomplete="list" aria-haspopup="listbox" aria-controls="${listId}" autocomplete="off">
        <div class="chat-actions-list" id="${listId}" role="listbox" aria-label="Actions" tabindex="-1"></div>
        ${actionsNote ? `<p class="chat-actions-hint chat-actions-note">${escapeMarkup(actionsNote)}</p>` : ''}
        <output class="chat-actions-out" role="status"></output>
      </div>`)
    root.appendChild(popEl)
    actionsButton?.setAttribute('aria-expanded', 'true')
    try { popTopRows = actions() || [] } catch { popTopRows = [] }
    popStack = []
    popActive = -1
    renderPopStage()
    const filter = popEl.querySelector('.chat-actions-filter')
    filter.addEventListener('input', () => { popActive = -1; renderPopStage() })
    popEl.addEventListener('keydown', onPopKeys)
    popEl.addEventListener('focusout', onPopFocusOut)
    document.addEventListener('pointerdown', onDocPointer, true)
    document.addEventListener('keydown', onPopKeydown, true)
    if (sectionId) {
      const target = popTopRows.find(row => row.id === sectionId && row.enabled !== false && typeof row.run === 'function')
      if (target) {
        void Promise.resolve().then(() => target.run(popCtx())).catch(() => {})
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
