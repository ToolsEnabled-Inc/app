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
  const [ax, ay] = pt(133)
  const [bx, by] = pt(227)
  const crescentPath = `M ${ax.toFixed(2)} ${ay.toFixed(2)} A ${r} ${r} 0 0 1 ${bx.toFixed(2)} ${by.toFixed(2)}`
  const off = Math.max(3, size * 0.016)

  const svgBody = crescent
    ? `
        <defs>
          <filter id="${fid}" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="${(size * 0.026).toFixed(2)}"/>
          </filter>
        </defs>
        <g transform="translate(${-off} 0)">
          <path class="cres-halo" d="${crescentPath}" fill="none" stroke-linecap="round"
            stroke-width="${(stroke * 2.1).toFixed(1)}" filter="url(#${fid})"/>
          <path class="cres-core" d="${crescentPath}" fill="none" stroke-linecap="round"
            stroke-width="${(stroke * 0.9).toFixed(1)}"/>
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
  const start = Math.floor(Math.random() * (CHAT.length - seed))
  const history = CHAT.slice(start, start + seed)

  const addMsg = (from, text, who) => {
    const m = el(`<div class="msg ${from}">${who ? `<span class="who">${who}</span>` : ''}${text}</div>`)
    log.appendChild(m)
    log.scrollTop = log.scrollHeight
    return m
  }
  history.forEach((m, i) => addMsg(m.from, m.text, i === 0 ? (m.from === 'them' ? title : 'you') : null))

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
  const min = scaleMax != null ? 0 : Math.min(...points)
  const max = scaleMax != null ? scaleMax : Math.max(...points)
  const nx = (i) => (i / (points.length - 1)) * (w - 8) + 4
  const ny = (v) => h - 5 - ((v - min) / (max - min || 1)) * (h - 10)
  const d = points.map((v, i) => `${i ? 'L' : 'M'}${nx(i).toFixed(1)} ${ny(v).toFixed(1)}`).join(' ')
  const lx = nx(points.length - 1), ly = ny(points[points.length - 1])
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
