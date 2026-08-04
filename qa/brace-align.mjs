import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1600, height: 900 } })
const errs = []
p.on('pageerror', e => errs.push(String(e)))
await p.goto('http://127.0.0.1:4173/#/', { waitUntil: 'networkidle' })
await p.waitForTimeout(1400)
const m = await p.evaluate(() => {
  const R = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), b: Math.round(r.bottom) } }
  const q = s => document.querySelector(s)
  return {
    ring: R(q('.uring')),
    wrap: R(q('.home-feed-wrap')),
    feed: R(q('.home-feed')),
    lines: R(q('.feed-lines')),
    hint: R(q('.feed-hint')),
    braces: [...document.querySelectorAll('.brace')].map(R),
    tag: q('.brace')?.tagName,
  }
})
console.log(JSON.stringify(m, null, 1))
const [L, Rt] = m.braces
console.log('\nbrace vs feed  dTop:', L.y - m.feed.y, ' dBottom:', L.b - m.feed.b)
console.log('brace vs lines dTop:', L.y - m.lines.y, ' dBottom:', L.b - m.hint.b)
console.log('overflow past wrap:', Math.max(0, L.b - m.wrap.b), 'symmetric:', L.y === Rt.y && L.h === Rt.h)
console.log('ring center y:', m.ring.y + m.ring.h/2, ' wrap center y:', m.wrap.y + m.wrap.h/2)
console.log('pageerrors:', errs)
await b.close()
