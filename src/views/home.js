// /home — the giant hero ring + a real recent-activity panel.
//
// DATA WIRING NOTE: this view no longer reads src/sim.js at all. Every
// number here comes from public/data/status.json (written by
// tools/gen-status.mjs from real, read-only ToolsEnabled state on this
// machine) via src/live-status.js. If that file is missing, unreachable, or
// malformed, this view says so in words — it never falls back to a
// plausible-looking placeholder number. Every reading also carries its own
// "as of" age, because the snapshot's sections can each be a different age
// (a health sweep from 14 hours ago next to a cross-machine handshake from
// 2 minutes ago is normal, and hiding that difference would be a lie).
//
// Every other page in this app (computers/agent/metrics/comms) is still the
// PLAN.md simulation and is unaffected by this file.

import { el, uptimeRing } from '../components.js'
import { fetchStatus, ageMs, fmtAge } from '../live-status.js'
import '../home.css'

const POLL_MS = 45_000
const DASH = '—' // em dash — used for "no reading", never "0"

export function homeView() {
  const root = el(`
    <div class="home">
      <div class="home-ring-wrap"></div>
      <div class="home-feed-wrap">
        <span class="brace" aria-hidden="true"><svg width="22" height="26" viewBox="0 0 22 26"><path d="M20.5 1.5 C13 1.5 8 3.6 8 10.8 L8 26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><svg class="brace-arm" viewBox="0 0 22 10" preserveAspectRatio="none"><rect x="7.25" y="0" width="1.5" height="10" fill="currentColor"/></svg><svg width="22" height="56" viewBox="0 0 22 56"><path d="M8 0 L8 16 C8 24 5.6 26.4 1.5 28 C5.6 29.6 8 32 8 40 L8 56" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><svg class="brace-arm" viewBox="0 0 22 10" preserveAspectRatio="none"><rect x="7.25" y="0" width="1.5" height="10" fill="currentColor"/></svg><svg width="22" height="26" viewBox="0 0 22 26"><path d="M8 0 L8 15.2 C8 22.4 13 24.5 20.5 24.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        <div class="home-feed">
          <div class="feed-lines"></div>
          <div class="feed-hint">recent lane activity — read-only</div>
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

  /* ---- feed: real recent lane activity, newest first ---- */
  const linesEl = root.querySelector('.feed-lines')
  const feedHint = root.querySelector('.feed-hint')
  const braces = [...root.querySelectorAll('.brace')]
  braces.forEach(b => b.addEventListener('animationend', () => b.classList.remove('brace-pulse')))
  const pulseBraces = () => {
    braces.forEach(b => { b.classList.remove('brace-pulse'); void b.offsetWidth; b.classList.add('brace-pulse') })
  }

  function describeLane(item) {
    const age = fmtAge(ageMs(item.at))
    const ageTxt = age ? ` · ${age}` : ''
    if (item.event === 'lane-end') {
      const outcome = item.outcome || 'ended'
      const exit = item.exitCode != null ? ` (exit ${item.exitCode})` : ''
      return `${outcome}${exit}${ageTxt}`
    }
    return `started${ageTxt}`
  }

  let lastFeedKey = ''
  function renderFeed(recentLanes) {
    if (!recentLanes || !recentLanes.available) {
      linesEl.innerHTML = `<div class="feed-line">lane activity log unavailable${recentLanes?.error ? `: ${recentLanes.error}` : ''}</div>`
      feedHint.textContent = 'source: state/agent-churn-ledger.jsonl (unreachable)'
      lastFeedKey = ''
      return
    }
    if (!recentLanes.items.length) {
      linesEl.innerHTML = `<div class="feed-line">no recorded lane activity</div>`
      feedHint.textContent = 'source: state/agent-churn-ledger.jsonl (0 events)'
      lastFeedKey = ''
      return
    }
    const key = recentLanes.items[0].at + recentLanes.items[0].event
    const isNew = key !== lastFeedKey && lastFeedKey !== ''
    lastFeedKey = key
    linesEl.innerHTML = ''
    recentLanes.items.slice(0, 9).forEach((item, i) => {
      const line = el(`<div class="feed-line ${i > 6 ? 'old' : ''}"><span class="agent">${item.laneId || 'unknown-lane'}</span> · ${describeLane(item)}</div>`)
      linesEl.appendChild(line)
    })
    const newestAge = fmtAge(ageMs(recentLanes.items[0].at))
    feedHint.textContent = `source: ${recentLanes.path} · newest event ${newestAge || 'unknown age'}`
    if (isNew) pulseBraces()
  }

  /* ---- apply a fetched (or failed) status result to every widget ---- */
  function applyResult(result) {
    if (!result.ok) {
      ring.el.dataset.load = 'unknown'
      loadLabel.textContent = 'source unavailable'
      loadVal.textContent = ''
      const subEl = ring.el.querySelector('.uring-sub')
      if (subEl) subEl.textContent = result.reason
      renderFeed(null)
      epochMs = null
      return
    }
    const { health, peerLink, recentLanes } = result.data
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

    renderFeed(recentLanes)
  }

  let destroyed = false
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
    },
  }
}
