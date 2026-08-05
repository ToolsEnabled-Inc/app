// Shared UI pieces: uptime ring, chat window, sparkline, tooltip.

import { uptimeParts } from './sim.js'
import { CHAT, CHAT_REPLIES, ROLES, pick } from './vocab.js'

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

/** Build a chat window element (used inside chips, home feed, agent page). */
export function buildChat({ title, subtitle = '', roleKey = 'coordinator', seed = 3, onClose = null, tall = false }) {
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
  // The seeded excerpt is the conversation's *past*, so it must not change
  // between opens: the title is the conversation's identity, so the window
  // into CHAT is derived from it rather than re-rolled with Math.random().
  // Re-opening the same agent's chat now replays the same history.
  const span = Math.max(1, CHAT.length - seed)
  const start = hashString(String(title ?? '')) % span
  const history = CHAT.slice(start, start + seed)

  const addMsg = (from, text, who) => {
    const m = el(`<div class="msg ${from}">${who ? `<span class="who">${who}</span>` : ''}${text}</div>`)
    log.appendChild(m)
    log.scrollTop = log.scrollHeight
    return m
  }
  history.forEach((m, i) => addMsg(m.from, m.text, i === 0 ? (m.from === 'them' ? title : 'you') : null))
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
  const anchorRo = new ResizeObserver(() => {
    if (pinned && log.scrollHeight) log.scrollTop = log.scrollHeight
  })
  anchorRo.observe(log)
  // content growth (a new message wrapping taller) moves scrollHeight without
  // resizing the box — the same pin applies
  new MutationObserver(() => {
    if (pinned && log.scrollHeight) log.scrollTop = log.scrollHeight
  }).observe(log, { childList: true })

  const send = () => {
    const v = input.value.trim()
    if (!v) return
    input.value = ''
    addMsg('me', v)
    setTimeout(() => addMsg('them', pick(CHAT_REPLIES)), 900 + Math.random() * 1200)
  }
  root.querySelector('.chat-send').addEventListener('click', send)
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send() })
  if (onClose) root.querySelector('.chat-close').addEventListener('click', (e) => { e.stopPropagation(); onClose() })

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
