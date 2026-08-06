// Shared UI pieces: uptime ring, chat window, sparkline, tooltip.

import { sim, uptimeParts } from './sim.js'
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
  const fid = `uring-blur-${gradSeq}`
  const circ = 2 * Math.PI * r

  // The sketch's hero: a plain circle with a crescent of light hugging its
  // OUTSIDE-LEFT edge — an offset shadow made of light rather than a
  // progress sweep. Its colour is the fleet's load: green idle, orange
  // climbing, red full throttle. Two stacked arcs (a wide blurred halo and
  // a tighter core) give the falloff; both are nudged left so the light
  // reads as coming from beside the circle, not from the stroke itself.
  const pt = (deg) => {
    const a = (deg * Math.PI) / 180
    return [cx + r * Math.cos(a), cx + r * Math.sin(a)]
  }
  // A wider sweep than the first pass (118deg->242deg rather than 133->227)
  // so the light genuinely wraps the left flank, and THREE stacked arcs
  // instead of two: a broad outer haze, a mid halo, and a tight bright core.
  // Real light falls off over distance, so each layer is wider, softer and
  // fainter than the one inside it — that gradient is what reads as "glow"
  // rather than "a thick coloured stroke".
  const arcOf = (a0, a1) => {
    const [x0, y0] = pt(a0), [x1, y1] = pt(a1)
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
  }
  const crescentPath = arcOf(118, 242)     // outer haze: the full flank
  const crescentMid = arcOf(126, 234)
  const crescentCore = arcOf(139, 221)     // core: tightest, brightest
  const off = Math.max(4, size * 0.022)

  const svgBody = crescent
    ? `
        <defs>
          <filter id="${fid}" x="-75%" y="-75%" width="250%" height="250%" color-interpolation-filters="sRGB">
            <feGaussianBlur stdDeviation="${(size * 0.05).toFixed(2)}"/>
          </filter>
          <filter id="${fid}-m" x="-70%" y="-70%" width="240%" height="240%" color-interpolation-filters="sRGB">
            <feGaussianBlur stdDeviation="${(size * 0.022).toFixed(2)}"/>
          </filter>
          <filter id="${fid}-c" x="-60%" y="-60%" width="220%" height="220%" color-interpolation-filters="sRGB">
            <feGaussianBlur stdDeviation="${(size * 0.004).toFixed(2)}"/>
          </filter>
        </defs>
        <g transform="translate(${-off} 0)">
          <path class="cres-haze" d="${crescentPath}" fill="none" stroke-linecap="round"
            stroke-width="${(stroke * 3.4).toFixed(1)}" filter="url(#${fid})"/>
          <path class="cres-halo" d="${crescentMid}" fill="none" stroke-linecap="round"
            stroke-width="${(stroke * 1.9).toFixed(1)}" filter="url(#${fid}-m)"/>
          <path class="cres-core" d="${crescentCore}" fill="none" stroke-linecap="round"
            stroke-width="${(stroke * 0.75).toFixed(1)}" filter="url(#${fid}-c)"/>
        </g>
        <circle class="uring-rim" cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke-width="2"/>`
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
export function buildChat({ title, subtitle = '', roleKey = 'coordinator', seed = 3, onClose = null, tall = false, context = null }) {
  const role = ROLES[roleKey] || ROLES.coordinator
  const root = el(`
    <div class="chat" ${tall ? 'style="min-height:0"' : ''}>
      <div class="chat-head">
        <span class="role-dot" style="background:${role.hex}"></span>
        <div>
          <div class="t">${title}</div>
          ${subtitle ? `<div class="s">${subtitle}</div>` : ''}
        </div>
        <span class="spacer"></span>
        ${onClose ? `<button class="chat-close" aria-label="Collapse">
          <svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
        </button>` : ''}
      </div>
      <div class="chat-log"></div>
      <div class="chat-input">
        <input type="text" placeholder="Message ${title}…" />
        <button class="chat-send" aria-label="Send">
          <svg viewBox="0 0 24 24"><path d="M5 12h13M13 6.5 18.8 12 13 17.5" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </div>
  `)

  const log = root.querySelector('.chat-log')
  const input = root.querySelector('input')
  const sendButton = root.querySelector('.chat-send')
  let disposed = false
  let lastTurnAt = null

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
  // The seeded excerpt is the conversation's *past*, so it must not change
  // between opens: the title is the conversation's identity, so the window
  // into CHAT is derived from it rather than re-rolled with Math.random().
  // Re-opening the same agent's chat now replays the same history.
  const titleHash = hashString(String(title ?? ''))
  const span = Math.max(1, CHAT.length - seed)
  const start = titleHash % span
  const history = CHAT.slice(start, start + seed)

  // Give the simulated past a stable rhythm: short exchanges grouped around
  // one real pause. A six-turn direct line therefore reads like a thread,
  // while the compact two-turn comms excerpt does not spend a row on chrome.
  const historyTimes = new Array(history.length)
  const clusterAt = history.length >= 3 ? Math.floor(history.length / 2) : -1
  let historyCursor = CHAT_CLOCK_ORIGIN - (2 + titleHash % 4) * CHAT_MINUTE
  for (let i = history.length - 1; i >= 0; i--) {
    historyTimes[i] = historyCursor
    const shortGap = 1 + ((titleHash >>> (i % 24)) % 4)
    const gap = i === clusterAt ? 9 + (titleHash % 4) : shortGap
    historyCursor -= gap * CHAT_MINUTE
  }
  history.forEach((m, i) => addMsg(
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
    const v = input.value.trim()
    if (!v) return
    input.value = ''
    pinned = true
    const message = addMsg('me', v)
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
    if (onClose) root.querySelector('.chat-close')?.removeEventListener('click', onCloseClick)
    unregisterLifecycle()
    bumpChatDebug('activeChats', -1)
    bumpChatDebug('disposedChats', 1)
  }

  bumpChatDebug('activeChats', 1)
  unregisterLifecycle = registerChatLifecycle({ root, dispose, seenConnected: false, morphHost: null })
  Object.defineProperty(root, 'dispose', { value: dispose })

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

/** Runtime text updater registry — one central clock drives all timers. */
const runtimeEls = new Set()
export function bindRuntime(elm, bornAtFn) {
  const entry = { elm, bornAtFn }
  runtimeEls.add(entry)
  return () => runtimeEls.delete(entry)
}
export function tickRuntimes(fmt) {
  for (const { elm, bornAtFn } of [...runtimeEls]) {
    if (!elm.isConnected) { runtimeEls.forEach(e => { if (e.elm === elm) runtimeEls.delete(e) }); continue }
    elm.textContent = fmt(bornAtFn())
  }
}
