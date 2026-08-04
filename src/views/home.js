// /home — the giant uptime ring + greyed context feed (expands into a chat).

import { sim, uptimeParts } from '../sim.js'
import { el, uptimeRing, buildChat } from '../components.js'
import '../home.css'

export function homeView() {
  const root = el(`
    <div class="home">
      <div class="home-ring-wrap"></div>
      <div class="home-feed-wrap">
        <span class="brace">{</span>
        <div class="home-feed" tabindex="0" role="button" aria-label="Open fleet chat">
          <div class="feed-lines"></div>
          <div class="feed-hint">click to open fleet chat</div>
        </div>
        <span class="brace">}</span>
      </div>
    </div>
  `)

  /* ---- live totals for the sub-caption (criterion 2) ---- */
  const agentTotal = () => sim.computers.reduce((n, c) => n + c.agents.length, 0)
  const subText = () => {
    const mc = sim.computers.length
    const ac = agentTotal()
    return `${mc} machine${mc === 1 ? '' : 's'} · ${ac} agent${ac === 1 ? '' : 's'} live`
  }

  const ringSize = Math.min(520, Math.max(380, window.innerHeight - 300))
  const ring = uptimeRing({
    size: ringSize,
    epoch: sim.serverEpoch,
    caption: 'Server Uptime',
    sub: subText(),
    crescent: true,          // the sketch's circle + left crescent of light
  })

  /* ---- fleet load drives the crescent's colour (the sketch's whole point:
     green = idling / low, orange = a good few agents and CPU climbing,
     red = full throttle). Load is the worse of two honest signals: mean CPU
     across machines, and how full the agent roster is — a box can be busy
     because it is thinking hard OR because it is running a lot of lanes. ---- */
  const AGENT_CEILING = 16          // sim's own per-machine spawn ceiling
  function loadNow() {
    const comps = sim.computers
    if (!comps.length) return 0
    const cpu = comps.reduce((s, c) => s + (c.stats?.cpu || 0), 0) / comps.length / 100
    const perMachine = comps.map(c => c.agents.length / AGENT_CEILING)
    const roster = Math.max(0, ...perMachine)
    return Math.max(0, Math.min(1, Math.max(cpu, roster * 0.92)))
  }
  const loadRow = el(`<div class="home-load"><i></i><span class="lt">idle</span><span class="lv"></span></div>`)
  const loadLabel = loadRow.querySelector('.lt')
  const loadVal = loadRow.querySelector('.lv')
  function paintLoad() {
    const v = loadNow()
    ring.el.setLoad(v)
    const state = ring.el.dataset.load
    loadLabel.textContent = state === 'peak' ? 'full throttle' : state === 'busy' ? 'busy' : 'idle'
    loadVal.textContent = `${Math.round(v * 100)}%`
    loadRow.style.setProperty('--load-col', getComputedStyle(ring.el).getPropertyValue('--load-col'))
  }

  /* ---- criterion 1: fixed-width crossfading digits, driven from home.js
     (bypasses ring.update()'s innerHTML-replace-on-every-second so the
     minute rollover can crossfade instead of jump) ---- */
  const showDays = true
  const UNITS = showDays
    ? [['d', 'Days'], ['h', 'Hours'], ['m', 'Minutes'], ['s', 'Seconds']]
    : [['h', 'Hours'], ['m', 'Minutes'], ['s', 'Seconds']]
  const partsToValues = (p) => (showDays ? [p.d, p.h, p.m, p.s] : [p.h, p.m, p.s])

  const digitsEl = ring.el.querySelector('.uring-digits')
  digitsEl.innerHTML = UNITS
    .map(([, label]) => `<span class="seg"><span class="n-stack"><span class="n cur"></span></span><span class="u">${label}</span></span>`)
    .join('<span class="colon">:</span>')

  const stacks = [...digitsEl.querySelectorAll('.n-stack')]
  partsToValues(uptimeParts(sim.serverEpoch)).forEach((v, i) => {
    stacks[i].querySelector('.n.cur').textContent = v
  })

  function setDigit(stack, value) {
    // dedupe against the LAST appended span (the value already in flight),
    // not the first '.n.cur' match -- the outgoing span keeps the 'cur'
    // class for its whole fade-out, so matching on '.cur' re-fires every
    // rAF of the crossfade window and leaks a '.n.next' span per frame.
    const last = stack.lastElementChild
    if (!last || last.textContent === value) return
    const cur = stack.querySelector('.n.cur')
    const next = document.createElement('span')
    next.className = 'n next'
    next.textContent = value
    stack.appendChild(next)
    // drop 'cur' as well as adding 'out': the outgoing span used to KEEP
    // .cur for its whole fade, so a crossfade starting before the previous
    // one finished captured the same element again and orphaned a span —
    // under a main-thread stall those piled up permanently over the readout
    if (cur) { cur.classList.add('out'); cur.classList.remove('cur') }
    requestAnimationFrame(() => requestAnimationFrame(() => next.classList.add('in')))
    const finish = () => {
      if (cur) cur.remove()
      stack.querySelectorAll('.n.out').forEach(n => n.remove())   // sweep any interrupted fade
      next.classList.remove('next', 'in'); next.classList.add('cur')
    }
    const tid = setTimeout(finish, 420)
    next.addEventListener('transitionend', () => { clearTimeout(tid); finish() }, { once: true })
  }

  /* The hero is the sketch's crescent now, so there is no progress arc and
     no arc-tip dot to drive — those elements simply do not exist in this
     markup. Everything below is guarded rather than deleted so the ring can
     still be built in its sweeping-arc form elsewhere. */
  const trackEl = ring.el.querySelector('.track')
  const arcEls = [...ring.el.querySelectorAll('.arc, .arc-glow')]
  const arcEl = ring.el.querySelector('circle.arc')
  const hasArc = !!(trackEl && arcEl)

  let circ = 0, rNum = 0, cxNum = 0, cyNum = 0, tipDot = null
  if (hasArc) {
    rNum = parseFloat(trackEl.getAttribute('r'))
    cxNum = parseFloat(trackEl.getAttribute('cx'))
    cyNum = parseFloat(trackEl.getAttribute('cy'))
    circ = 2 * Math.PI * rNum
    const strokeW = parseFloat(arcEl.getAttribute('stroke-width')) || 8
    const gradId = ring.el.querySelector('linearGradient')?.id
    tipDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    tipDot.setAttribute('class', 'uring-tip-dot')
    tipDot.setAttribute('r', String(Math.max(3, strokeW * 0.85)))
    if (gradId) tipDot.setAttribute('fill', `url(#${gradId})`)
    arcEl.parentNode.appendChild(tipDot)
  }

  function renderTick() {
    const p = uptimeParts(sim.serverEpoch)
    if (hasArc) {
      const sweep = circ * p.frac
      arcEls.forEach(a => a.setAttribute('stroke-dasharray', `${sweep} ${circ - sweep}`))
      const t = (sweep / circ) * Math.PI * 2
      tipDot.setAttribute('cx', (cxNum + rNum * Math.cos(t)).toFixed(2))
      tipDot.setAttribute('cy', (cyNum + rNum * Math.sin(t)).toFixed(2))
    }
    partsToValues(p).forEach((v, i) => setDigit(stacks[i], v))
  }
  renderTick()

  root.querySelector('.home-ring-wrap').appendChild(ring.el)

  ring.el.querySelector('.uring-inner').appendChild(loadRow)
  paintLoad()

  /* ---- criterion 2: subscribe to live spawn/reap (+ machine count) ---- */
  const subEl = ring.el.querySelector('.uring-sub')
  const renderSub = () => { if (subEl) subEl.textContent = subText() }
  const bothRender = () => { renderSub(); paintLoad() }
  const unsubSpawn = sim.on('spawn', bothRender)
  const unsubReap = sim.on('reap', bothRender)
  const unsubComputers = sim.on('computers', bothRender)
  const unsubStats = sim.on('stats', paintLoad)      // CPU drift moves the crescent too

  /* ---- criterion 3: feed lines + braces ---- */
  const feedCard = root.querySelector('.home-feed')
  const linesEl = root.querySelector('.feed-lines')
  const braces = [...root.querySelectorAll('.brace')]
  braces.forEach(b => b.addEventListener('animationend', () => b.classList.remove('brace-pulse')))
  const pulseBraces = () => {
    braces.forEach(b => { b.classList.remove('brace-pulse'); void b.offsetWidth; b.classList.add('brace-pulse') })
  }

  const renderLines = () => {
    linesEl.innerHTML = ''
    sim.feed.slice(0, 9).forEach((l, i) => {
      const line = el(`<div class="feed-line ${i > 6 ? 'old' : ''}"><span class="agent">${l.agent}</span> · ${l.text}</div>`)
      linesEl.appendChild(line)
    })
  }
  renderLines()

  const unsubFeed = sim.on('feed', (l) => {
    if (chatOpen) return
    const line = el(`<div class="feed-line fresh"><span class="agent">${l.agent}</span> · ${l.text}</div>`)
    linesEl.prepend(line)
    requestAnimationFrame(() => requestAnimationFrame(() => line.classList.remove('fresh')))
    pulseBraces()

    // oldest fades out instead of being cut instantly
    const active = [...linesEl.children].filter(c => !c.classList.contains('leaving'))
    while (active.length > 9) {
      const last = active.pop()
      last.classList.add('leaving')
      const done = () => last.remove()
      const tid = setTimeout(done, 560)
      last.addEventListener('transitionend', () => { clearTimeout(tid); done() }, { once: true })
    }
    ;[...linesEl.children].forEach((c, i) => c.classList.toggle('old', i > 6 && !c.classList.contains('leaving')))
  })

  // context box → chat window morph (in place, no popup)
  let chatOpen = false
  let chatEl = null
  const feedWrap = root.querySelector('.home-feed-wrap')
  // a click landing in the collapse window used to re-open the chat with a
  // fresh seed, destroying whatever the user had typed (double-clicking the
  // close button did exactly that)
  let closedAt = 0
  feedCard.addEventListener('keydown', (e) => {
    if (chatOpen || (e.key !== 'Enter' && e.key !== ' ')) return
    e.preventDefault(); feedCard.click()
  })
  feedCard.addEventListener('click', () => {
    if (chatOpen || performance.now() - closedAt < 450) return
    chatOpen = true
    const h = feedCard.offsetHeight
    feedCard.style.height = h + 'px'
    void feedCard.offsetWidth
    feedCard.classList.add('as-chat')
    feedWrap.classList.add('chat-open')
    chatEl = buildChat({
      title: 'fleet',
      subtitle: 'coordinator relay · agent-coord',
      roleKey: 'shadow',
      seed: 4,
      onClose: () => {
        chatOpen = false
        closedAt = performance.now()
        feedWrap.classList.remove('chat-open')
        feedCard.style.height = feedCard.offsetHeight + 'px'
        void feedCard.offsetWidth
        feedCard.classList.remove('as-chat')
        chatEl.remove(); chatEl = null
        feedCard.style.height = h + 'px'
        setTimeout(() => { feedCard.style.height = '' }, 500)
        renderLines()
      },
      tall: true,
    })
    // criterion 3: seed messages stagger-in rather than appearing at once.
    // .msg's `animation: msgIn .4s var(--ease-spring)` shorthand resolves
    // fill-mode to 'none', so a delayed message renders at its settled
    // (opacity:1) style for the whole delay, then jumps back to the 0%
    // keyframe when the animation starts -- a flash, not a stagger. Force
    // 'backwards' so the delay window holds the 0% keyframe instead.
    ;[...chatEl.querySelectorAll('.chat-log .msg')].forEach((m, i) => {
      m.style.animationDelay = `${i * 70}ms`
      m.style.animationFillMode = 'backwards'
    })
    feedCard.appendChild(chatEl)
    feedCard.style.height = ''
  })

  let raf
  const loop = () => { renderTick(); raf = requestAnimationFrame(loop) }
  raf = requestAnimationFrame(loop)

  return {
    el: root,
    destroy() {
      cancelAnimationFrame(raf)
      unsubFeed(); unsubSpawn(); unsubReap(); unsubComputers(); unsubStats()
    },
  }
}
