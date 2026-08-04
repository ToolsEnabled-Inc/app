// /home — the giant uptime ring + greyed context feed (expands into a chat).

import { sim, uptimeParts } from '../sim.js'
import { el, uptimeRing, buildChat } from '../components.js'
import '../home.css'

export function homeView() {
  const root = el(`
    <div class="home">
      <div class="home-ring-wrap"></div>
      <div class="home-feed-wrap">
        <span class="brace">{<i class="brace-strut" aria-hidden="true"></i></span>
        <div class="home-feed" tabindex="0" role="button" aria-expanded="false" aria-label="Open fleet chat">
          <div class="feed-lines"></div>
          <div class="feed-hint">click to open fleet chat</div>
        </div>
        <span class="brace">}<i class="brace-strut" aria-hidden="true"></i></span>
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

  /* setLoad()'s bands are bare thresholds (0.38 busy, 0.72 peak), and the
     value crossing them is live: CPU drifts continuously on every 'stats'
     tick and the roster term steps by 1/16 of a machine on every spawn/reap.
     A fleet parked on a boundary therefore strobed — a reading wobbling
     0.379/0.381 flipped the crescent, the dot and the caption on every tick,
     and each flip drags a 1.4s colour transition behind it, so the hero was
     permanently mid-crossfade between two states. Latch it: a band must be
     over-run by 5% to be entered and under-run by 5% to be left, so noise of
     that amplitude cannot move the state at all while a genuine change of
     load still lands immediately. The percentage readout stays the raw
     number — the hysteresis governs which state we are IN, never what we
     report the load to be. */
  const BUSY = 0.38, PEAK = 0.72, HYST = 0.05
  let loadState = 'idle'
  function stateFor(v) {
    if (loadState === 'peak') return v >= PEAK - HYST ? 'peak' : (v >= BUSY ? 'busy' : 'idle')
    if (loadState === 'busy') return v >= PEAK ? 'peak' : (v >= BUSY - HYST ? 'busy' : 'idle')
    return v >= PEAK ? 'peak' : (v >= BUSY ? 'busy' : 'idle')
  }
  function paintLoad() {
    const v = loadNow()
    loadState = stateFor(v)
    // components.setLoad() owns the data-load attribute (and so the crescent
    // colour), but its thresholds have no memory. Hand it a value parked in
    // the middle of the band we just latched rather than the raw reading, so
    // the decision made above is the one that reaches the DOM.
    ring.el.setLoad(loadState === 'peak' ? 1 : loadState === 'busy' ? 0.55 : 0)
    loadLabel.textContent = loadState === 'peak' ? 'full throttle' : loadState === 'busy' ? 'busy' : 'idle'
    loadVal.textContent = `${Math.round(v * 100)}%`
    // --load-col is NOT copied down here any more: loadRow lives inside
    // .uring-inner, so it already inherits the ring's value. Snapshotting it
    // into an inline style pinned the dot to whichever theme was active at
    // the last paint, so switching theme left the dot on the old palette
    // until the next sim event happened to repaint it.
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
    // dedupe against the LAST appended span — the value already in flight —
    // rather than against whichever span currently answers to '.cur'. This
    // runs on every rAF, so anything that can disagree with the value being
    // animated towards re-fires the whole crossfade each frame and leaks a
    // '.n.next' span per frame. lastElementChild always IS that value.
    const last = stack.lastElementChild
    if (!last || last.textContent === value) return
    // Fade out EVERYTHING already painted, not just the one span wearing
    // '.cur'. The class is stripped the moment a fade starts (below), so a
    // second change arriving inside the 420ms window found querySelector
    // ('.n.cur') empty: the still-visible span was never given '.out', never
    // swept, and its own finish() promoted it back to '.cur' — two live
    // digits stacked on one another. Capturing the children is exact and
    // cannot miss an element whatever state its classes are in.
    const outgoing = [...stack.children]
    const next = document.createElement('span')
    next.className = 'n next'
    next.textContent = value
    stack.appendChild(next)
    // drop 'cur' as well as adding 'out': the outgoing span used to KEEP
    // .cur for its whole fade, so a crossfade starting before the previous
    // one finished captured the same element again and orphaned a span —
    // under a main-thread stall those piled up permanently over the readout
    outgoing.forEach(n => { n.classList.remove('cur', 'next', 'in'); n.classList.add('out') })
    requestAnimationFrame(() => requestAnimationFrame(() => next.classList.add('in')))
    const finish = () => {
      outgoing.forEach(n => n.remove())
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
    feedCard.setAttribute('aria-expanded', 'true')
    feedWrap.classList.add('chat-open')
    chatEl = buildChat({
      title: 'fleet',
      subtitle: 'coordinator relay · agent-coord',
      roleKey: 'shadow',
      seed: 4,
      onClose: () => {
        chatOpen = false
        closedAt = performance.now()
        // hand focus back to the control that opened this, but only if it is
        // still inside the chat — collapsing must never yank the caret away
        // from wherever a keyboard user has since moved to
        const returnFocus = chatEl && chatEl.contains(document.activeElement)
        feedCard.setAttribute('aria-expanded', 'false')
        feedWrap.classList.remove('chat-open')
        feedCard.style.height = feedCard.offsetHeight + 'px'
        void feedCard.offsetWidth
        feedCard.classList.remove('as-chat')
        chatEl.remove(); chatEl = null
        feedCard.style.height = h + 'px'
        setTimeout(() => { feedCard.style.height = '' }, 500)
        renderLines()
        if (returnFocus) feedCard.focus({ preventScroll: true })
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
    // the card stops being a button the moment it becomes a chat, so focus
    // moves to the thing the user came here to use; without this a keyboard
    // user who pressed Enter was left focused on a container with no visible
    // ring (the :focus-visible rule excludes .as-chat) and had to tab in.
    chatEl.querySelector('.chat-input input')?.focus({ preventScroll: true })
  })

  /* ---- brace fitting: the bracket has to span the thing it brackets ----
     .brace's height came entirely from font-size, which paints a FIXED ink
     shape (~122px at the 156px set in home.css) regardless of how tall the
     context block underneath it is — so the braces enclosed the middle third
     of the feed and nothing else. home.css explains why the fix is scaleY
     rather than a bigger font-size (width) or an SVG path (a second drawing
     of a glyph the font already ships).
     The stretch factor is measured, not assumed: canvas actualBoundingBox*
     gives the real painted ink extents of '{' in whatever font actually
     resolved, so this stays correct across the webfont swap, a theme change,
     and both breakpoints instead of encoding one screenshot's ratio. */
  const feedHint = root.querySelector('.feed-hint')
  let inkCtx
  const INK_FALLBACK = { asc: 0.76, desc: 0.02 }   // '{' ink extents in em, if the UA has no ink metrics
  const braceInk = (b) => {
    const cs = getComputedStyle(b)
    const size = parseFloat(cs.fontSize) || 0
    if (!size) return null
    try {
      inkCtx = inkCtx || document.createElement('canvas').getContext('2d')
      inkCtx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
      const m = inkCtx.measureText(b.textContent || '{')
      const asc = m.actualBoundingBoxAscent, desc = m.actualBoundingBoxDescent
      // sanity-gate the reading rather than trusting it blind: a font still
      // loading, or a UA without actualBoundingBox*, must not be allowed to
      // stretch the brace across the page on the strength of a bad number
      if (asc > size * 0.3 && asc < size * 1.5 && Math.abs(desc) < size) return { asc, desc }
    } catch { /* no 2d context — fall through to the em ratios */ }
    return { asc: size * INK_FALLBACK.asc, desc: size * INK_FALLBACK.desc }
  }
  let braceFitted = false
  const fitBraces = () => {
    // while the card is a chat the lines are display:none (offsets 0) and the
    // braces are hidden anyway — measuring then would only record a zero
    if (chatOpen || !feedHint) return
    // a departing line is still in flow for its 560ms fade, so on every single
    // arrival the column is briefly ten lines tall. Re-fitting to that would
    // stretch both braces a step and let them relax back once a second — a
    // breathing bracket, which is exactly the kind of idle motion this page
    // has been stripping out. Sit the transient out; removing the line fires
    // the observer again and the fit lands on the settled height.
    if (linesEl.querySelector('.feed-line.leaving')) return
    const top = feedCard.offsetTop + linesEl.offsetTop
    const bottom = feedCard.offsetTop + feedHint.offsetTop + feedHint.offsetHeight
    if (bottom - top <= 0) return
    braces.forEach(b => {
      const strut = b.querySelector('.brace-strut')
      const ink = braceInk(b)
      if (!strut || !ink) return
      /* Where the ink actually sits is taken from the DOM and the font, not
         re-derived from font tables: .brace-strut is a zero-height
         inline-block, so it sits exactly ON the baseline and its offsetTop IS
         the baseline; canvas supplies the ink extents either side of it. Doing
         it the other way (half-leading arithmetic from fontBoundingBox*) put
         the answer 7px out against the measured screenshot, which is the whole
         defect in miniature. */
      const baseline = strut.offsetTop
      const inkTop = baseline - ink.asc
      const inkH = ink.asc + ink.desc
      if (inkH <= 0) return
      const k = Math.max(1, Math.min(6, (bottom - top) / inkH))
      // transform-origin stays 50% 50% (the chat-open scaleX in styles.css
      // shares it), so the residual offset after scaling is solved for
      const c = b.offsetTop + b.offsetHeight / 2
      const shift = top - (c + k * (inkTop - c))
      const nextK = k.toFixed(3), nextShift = `${Math.round(shift)}px`
      if (b.style.getPropertyValue('--brace-stretch') === nextK &&
          b.style.getPropertyValue('--brace-shift') === nextShift) return
      // the very first fit lands after mount, and .brace transitions transform
      // at --dur-3 — without this the braces would visibly unfurl on every
      // arrival at #/, an entrance animation nobody asked for
      if (!braceFitted) b.style.transition = 'none'
      b.style.setProperty('--brace-stretch', nextK)
      b.style.setProperty('--brace-shift', nextShift)
    })
    if (!braceFitted) {
      void braces[0]?.offsetWidth
      braces.forEach(b => { b.style.transition = '' })
      braceFitted = true
    }
  }
  fitBraces()
  // re-fit on anything that moves the block: viewport resize, the webfont
  // swapping in under the measurement, the chat collapsing back to a feed
  const fitObserver = new ResizeObserver(fitBraces)
  fitObserver.observe(feedCard)
  document.fonts?.ready.then(fitBraces).catch(() => {})

  let raf
  /* Throttled to ~12Hz, the gate computers.js and agent.js already carry and
     this loop was simply missed by. renderTick() redraws a clock whose digits
     change once a second (and, in the sweeping-arc form of the ring, an arc
     that advances 6deg per minute, so the tip moves well under a pixel per
     step at 12Hz) — ungated it ran ~180x/s, and measured at rest on #/ it was
     176-180 style recalcs/s and 45% of the page's CPU to redraw the same
     frame. Suppressing it alone took recalcs to 29.5/s and CPU 13.5% -> 7.4%. */
  let lastTickAt = 0
  const loop = (ts) => {
    if (ts - lastTickAt >= 80) { lastTickAt = ts; renderTick() }
    raf = requestAnimationFrame(loop)
  }
  raf = requestAnimationFrame(loop)

  return {
    el: root,
    destroy() {
      cancelAnimationFrame(raf)
      fitObserver.disconnect()
      unsubFeed(); unsubSpawn(); unsubReap(); unsubComputers(); unsubStats()
    },
  }
}
