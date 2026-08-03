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
export function uptimeRing({ size = 460, epoch, colors = ['#35eab7', '#45d6ff'], caption = 'Server Uptime', sub = '', showDays = true }) {
  const stroke = Math.max(7, size * 0.02)
  const r = (size - stroke * 2 - 14) / 2
  const cx = size / 2
  const gid = `uring-grad-${++gradSeq}`
  const circ = 2 * Math.PI * r

  const root = el(`
    <div class="uring ${size < 240 ? 'compact' : ''}" style="width:${size}px;height:${size}px">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
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
        </g>
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
    const sweep = circ * p.frac
    arcs.forEach(a => a.setAttribute('stroke-dasharray', `${sweep} ${circ - sweep}`))
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
        <span class="role-dot" style="background:${role.hex};box-shadow:0 0 calc(9px * var(--glow)) ${role.glow}"></span>
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
export function sparkline({ points, w = 150, h = 34, color = '#00a9d8' }) {
  const min = Math.min(...points), max = Math.max(...points)
  const nx = (i) => (i / (points.length - 1)) * (w - 8) + 4
  const ny = (v) => h - 5 - ((v - min) / (max - min || 1)) * (h - 10)
  const d = points.map((v, i) => `${i ? 'L' : 'M'}${nx(i).toFixed(1)} ${ny(v).toFixed(1)}`).join(' ')
  const lx = nx(points.length - 1), ly = ny(points[points.length - 1])
  return el(`
    <svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <path d="${d}" fill="none" stroke="rgba(14,23,38,0.18)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
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
