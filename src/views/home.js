// /home — the giant uptime ring + greyed context feed (expands into a chat).

import { sim } from '../sim.js'
import { el, uptimeRing, buildChat } from '../components.js'

export function homeView() {
  const root = el(`
    <div class="home">
      <div class="home-ring-wrap"></div>
      <div class="home-feed-wrap">
        <span class="brace">{</span>
        <div class="home-feed glass">
          <div class="feed-title"><span class="dot"></span>Context · Fleet</div>
          <div class="feed-lines"></div>
          <div class="feed-hint">click to open fleet chat</div>
        </div>
        <span class="brace">}</span>
      </div>
    </div>
  `)

  const ringSize = Math.min(520, Math.max(380, window.innerHeight - 300))
  const ring = uptimeRing({
    size: ringSize,
    epoch: sim.serverEpoch,
    colors: ['#35eab7', '#45d6ff'],
    caption: 'Server Uptime',
    sub: '2 machines · fleet nominal',
  })
  root.querySelector('.home-ring-wrap').appendChild(ring.el)

  const feedCard = root.querySelector('.home-feed')
  const linesEl = root.querySelector('.feed-lines')

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
    while (linesEl.children.length > 9) linesEl.lastElementChild.remove()
    ;[...linesEl.children].forEach((c, i) => c.classList.toggle('old', i > 6))
  })

  // context box → chat window morph (in place, no popup)
  let chatOpen = false
  let chatEl = null
  const feedWrap = root.querySelector('.home-feed-wrap')
  feedCard.addEventListener('click', () => {
    if (chatOpen) return
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
    feedCard.appendChild(chatEl)
    feedCard.style.height = ''
  })

  let raf
  const loop = () => { ring.update(); raf = requestAnimationFrame(loop) }
  raf = requestAnimationFrame(loop)

  return {
    el: root,
    destroy() { cancelAnimationFrame(raf); unsubFeed() },
  }
}
