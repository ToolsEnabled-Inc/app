// Metrics — account pools, failure rates, token flow, verdicts, activity heat,
// and the full agent table. All simulated, all alive.

import { sim, fmtRuntime } from '../sim.js'
import { ROLES, POOLS, PROVIDERS } from '../vocab.js'
import { el, sparkline, makeTooltip, bindRuntime } from '../components.js'

const fmtK = (n) => n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'M' : n + 'k'

export function metricsView() {
  const m = sim.metrics
  const unsubs = []
  const root = el(`
    <div class="view-pad">
      <div class="metrics">
        <div class="m-row m-tiles" id="tiles"></div>
        <div class="m-row m-pools" id="pools"></div>
        <div class="m-row m-charts2">
          <div class="chart-card glass" id="tokens-card">
            <div class="chart-head"><span class="ct">Token flow</span><span class="cs">last 24 h · thousands</span>
              <span class="spacer"></span>
              <span class="chart-legend">${PROVIDERS.map(p => `<span class="ck" style="--kc:${p.color}"><i></i>${p.label}</span>`).join('')}</span>
            </div>
            <div class="chart-body" id="tokens-chart"></div>
          </div>
          <div class="chart-card glass" id="fail-card">
            <div class="chart-head"><span class="ct">Failure rate by lane</span><span class="cs">rolling 24 h</span></div>
            <div class="chart-body" id="fail-chart"></div>
          </div>
        </div>
        <div class="m-row m-charts3">
          <div class="chart-card glass">
            <div class="chart-head"><span class="ct">Fleet activity</span><span class="cs">by hour · 7 days</span></div>
            <div class="chart-body" id="heat-chart"></div>
          </div>
          <div class="chart-card glass">
            <div class="chart-head"><span class="ct">Review verdicts</span><span class="cs">this week</span></div>
            <div class="chart-body" id="verdict-chart"></div>
          </div>
          <div class="chart-card glass" id="ops-card">
            <div class="chart-head"><span class="ct">Discipline</span><span class="cs">counters</span></div>
            <div class="chart-body" id="ops-body"></div>
          </div>
        </div>
        <div class="chart-card glass">
          <div class="chart-head"><span class="ct">Agents</span><span class="cs">all machines · live</span></div>
          <div style="overflow-x:auto"><table class="mtable" id="agent-table"></table></div>
        </div>
      </div>
    </div>
  `)

  /* ---------- tiles ---------- */
  const tilesEl = root.querySelector('#tiles')
  function renderTiles() {
    const liveAgents = sim.computers.reduce((s, c) => s + c.agents.length, 0)
    const spawned = sim.computers.reduce((s, c) => s + c.spawnedTotal, 0)
    const v = m.verdicts
    const failAvg = (m.failureByLane.reduce((s, l) => s + l.rate, 0) / m.failureByLane.length)
    const tokTotal = Object.values(m.tokensByProvider).reduce((s, arr) => s + arr.reduce((a, b) => a + b, 0), 0)
    tilesEl.innerHTML = ''
    const tiles = [
      { l: 'Agents live', v: liveAgents, unit: `of ${spawned} spawned`, d: '+3 vs yesterday', dir: 'up', tc: '#00a9d8', tg: '#45d6ff', spark: [8, 9, 9, 11, 10, 12, 13, 12, 14, 13, 15, liveAgents] },
      { l: 'Tasks closed', v: v.accept + v.reject, unit: 'this week', d: '+12% vs last', dir: 'up', tc: '#00bd8a', tg: '#35eab7', spark: [30, 34, 31, 40, 44, 41, 52, 58, 55, 63, 61, 70] },
      { l: 'Failure rate', v: failAvg.toFixed(1), unit: '%', d: '−0.6 pts vs last week', dir: 'up', tc: '#f57b00', tg: '#ffab4d', spark: [6.1, 5.8, 5.2, 5.6, 4.9, 4.4, 4.6, 4.1, 3.9, 3.6, 3.4, failAvg] },
      { l: 'Token flow', v: fmtK(tokTotal), unit: '24 h', d: 'steady', dir: 'flat', tc: '#3e63f0', tg: '#7d9bff', spark: [40, 44, 52, 49, 61, 66, 58, 72, 70, 76, 74, 81] },
      { l: 'Checkpoints', v: m.checkpoints, unit: 'recorded', d: `+${Math.max(1, m.checkpoints - 60)} today`, dir: 'up', tc: '#00bd8a', tg: '#35eab7' },
      { l: 'Gate blocks', v: m.gateBlocks, unit: 'held safely', d: '0 overridden', dir: 'flat', tc: '#dba400', tg: '#ffd84d' },
    ]
    for (const t of tiles) {
      const tile = el(`
        <div class="tile glass" style="--tc:${t.tc};--tg:${t.tg}">
          <div class="tl"><i></i>${t.l}</div>
          <div class="tv">${t.v}<span class="unit">${t.unit}</span></div>
          <div class="td ${t.dir}">${t.d}</div>
        </div>
      `)
      if (t.spark) tile.appendChild(sparkline({ points: t.spark, color: t.tc }))
      tilesEl.appendChild(tile)
    }
  }

  /* ---------- account pools ---------- */
  const poolsEl = root.querySelector('#pools')
  function renderPools() {
    poolsEl.innerHTML = ''
    const usage = [
      { pct: m.spend.subSeatPct, cap: 'seat + CLI quota', a: '2 lanes', b: '71% seat', c: '3 surfaces' },
      { pct: Math.round(((m.spend.vertexTotal - m.spend.vertexRemaining) / m.spend.vertexTotal) * 100), cap: `$${m.spend.vertexRemaining.toFixed(2)} of $${m.spend.vertexTotal} left`, a: `${sim.computers.reduce((s, c) => s + c.agents.filter(x => x.pool === 'jpinckard95').length, 0)} lanes`, b: 'exp. Oct 25', c: 'worktrees' },
      { pct: m.spend.uniPct, cap: 'SSO only · dormant', a: '0 lanes', b: 'Duo held', c: 'no compute' },
    ]
    POOLS.forEach((p, i) => {
      const u = usage[i]
      poolsEl.appendChild(el(`
        <div class="pool glass" style="--pc:${p.color};--pg:${p.glow}">
          <div class="pool-head"><span class="pn">${p.id}</span><span class="pt">${p.kind}</span></div>
          <div class="pool-sub">${p.desc}</div>
          <div class="meter"><div class="mf" style="width:${u.pct}%"></div></div>
          <div class="meter-caption"><b>${u.pct}% used</b><span>${u.cap}</span></div>
          <div class="pool-stats">
            <div class="pool-stat"><div class="v">${u.a}</div><div class="l">active</div></div>
            <div class="pool-stat"><div class="v">${u.b}</div><div class="l">window</div></div>
            <div class="pool-stat"><div class="v">${u.c}</div><div class="l">mode</div></div>
          </div>
        </div>
      `))
    })
  }

  /* ---------- token stacked area ---------- */
  function renderTokens() {
    const host = root.querySelector('#tokens-chart')
    host.innerHTML = ''
    const W = 640, H = 210, L = 34, R = 26, T = 10, B = 24
    const series = PROVIDERS.map(p => ({ ...p, data: m.tokensByProvider[p.id] }))
    const n = 24
    const stacked = []
    let maxY = 0
    for (let i = 0; i < n; i++) {
      let acc = 0
      const col = series.map(s => { const y0 = acc; acc += s.data[i]; return [y0, acc] })
      stacked.push(col); maxY = Math.max(maxY, acc)
    }
    maxY = Math.ceil(maxY / 50) * 50
    const x = (i) => L + (i / (n - 1)) * (W - L - R)
    const y = (v) => T + (1 - v / maxY) * (H - T - B)

    let grid = ''
    for (let g = 0; g <= 4; g++) {
      const gy = y((maxY / 4) * g)
      grid += `<line x1="${L}" y1="${gy}" x2="${W - R}" y2="${gy}" stroke="rgba(14,23,38,0.06)" stroke-width="1"/>
        <text x="${L - 6}" y="${gy + 3.5}" font-size="9.5" fill="var(--ink-4)" text-anchor="end">${(maxY / 4) * g}</text>`
    }
    let areas = '', lines = ''
    series.forEach((s, si) => {
      const top = stacked.map((c, i) => `${x(i).toFixed(1)},${y(c[si][1]).toFixed(1)}`)
      const bot = stacked.map((c, i) => `${x(i).toFixed(1)},${y(c[si][0]).toFixed(1)}`).reverse()
      areas += `<polygon points="${top.join(' ')} ${bot.join(' ')}" fill="${s.color}" opacity="0.1"/>`
      lines += `<polyline points="${top.join(' ')}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`
    })
    const hours = [0, 6, 12, 18, 23]
    const xlabels = hours.map(h => `<text x="${x(h)}" y="${H - 6}" font-size="9.5" fill="var(--ink-4)" text-anchor="middle">${String(h).padStart(2, '0')}:00</text>`).join('')

    const svg = el(`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Token flow by provider">
      ${grid}${areas}${lines}${xlabels}
      <line id="xh" y1="${T}" y2="${H - B}" stroke="rgba(14,23,38,0.22)" stroke-width="1" opacity="0"/>
    </svg>`)
    host.appendChild(svg)

    const tip = makeTooltip(host)
    const xh = svg.querySelector('#xh')
    svg.addEventListener('pointermove', (e) => {
      const r = svg.getBoundingClientRect()
      const px = ((e.clientX - r.left) / r.width) * W
      const i = Math.max(0, Math.min(n - 1, Math.round(((px - L) / (W - L - R)) * (n - 1))))
      xh.setAttribute('x1', x(i)); xh.setAttribute('x2', x(i)); xh.setAttribute('opacity', '1')
      tip.show(`<div class="tt-title">${String(i).padStart(2, '0')}:00</div>` +
        series.map(s => `<div><span style="color:${s.color}">●</span> ${s.label} <b>${s.data[i]}k</b></div>`).join(''),
        e.clientX, e.clientY)
    })
    svg.addEventListener('pointerleave', () => { xh.setAttribute('opacity', '0'); tip.hide() })
  }

  /* ---------- failure bars (status-colored, direct labels) ---------- */
  function renderFail() {
    const host = root.querySelector('#fail-chart')
    host.innerHTML = ''
    const rows = [...m.failureByLane].sort((a, b) => b.rate - a.rate)
    const W = 420, rowH = 30, H = rows.length * rowH + 8
    const L = 118, R = 44
    const maxV = 10
    const sev = (r) => r < 2 ? 'var(--s-good)' : r < 5 ? 'var(--s-warn)' : 'var(--s-serious)'
    const bars = rows.map((r, i) => {
      const y = 6 + i * rowH
      const w = Math.max(3, ((W - L - R) * r.rate) / maxV)
      return `
        <text x="${L - 10}" y="${y + 13.5}" font-size="11" fill="var(--ink-2)" text-anchor="end" font-weight="560">${r.lane}</text>
        <rect x="${L}" y="${y + 3}" width="${W - L - R}" height="14" rx="4" fill="rgba(14,23,38,0.05)"/>
        <path d="M${L} ${y + 3} h${Math.max(0, w - 4)} a4 4 0 0 1 4 4 v6 a4 4 0 0 1 -4 4 h-${Math.max(0, w - 4)} z" fill="${sev(r.rate)}" class="fbar" data-lane="${r.lane}"/>
        <text x="${L + w + 8}" y="${y + 13.5}" font-size="11" fill="var(--ink-2)" font-weight="640" font-variant-numeric="tabular-nums">${r.rate.toFixed(1)}%</text>`
    }).join('')
    host.appendChild(el(`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Failure rate by lane">${bars}</svg>`))
  }

  /* ---------- heatmap (sequential cyan) ---------- */
  function renderHeat() {
    const host = root.querySelector('#heat-chart')
    host.innerHTML = ''
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    const cw = 17, chh = 17, gap = 2, L = 34, T = 6
    const W = L + 24 * (cw + gap), H = T + 7 * (chh + gap) + 20
    const shade = (v) => {
      const stops = ['#edf6fa', '#d3ecf5', '#a8dcec', '#6ec4de', '#35a8cc', '#0b86ab']
      return stops[Math.min(stops.length - 1, Math.floor(v * stops.length))]
    }
    let cells = ''
    m.heat.forEach((row, d) => {
      cells += `<text x="${L - 8}" y="${T + d * (chh + gap) + 12.5}" font-size="9.5" fill="var(--ink-4)" text-anchor="end">${days[d]}</text>`
      row.forEach((v, h) => {
        cells += `<rect x="${L + h * (cw + gap)}" y="${T + d * (chh + gap)}" width="${cw}" height="${chh}" rx="3.5" fill="${shade(v)}" data-d="${d}" data-h="${h}" data-v="${Math.round(v * 100)}"/>`
      })
    })
    const xl = [0, 6, 12, 18, 23].map(h =>
      `<text x="${L + h * (cw + gap) + cw / 2}" y="${H - 4}" font-size="9.5" fill="var(--ink-4)" text-anchor="middle">${String(h).padStart(2, '0')}</text>`).join('')
    const svg = el(`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Fleet activity heatmap">${cells}${xl}</svg>`)
    host.appendChild(svg)
    const tip = makeTooltip(host)
    svg.addEventListener('pointermove', (e) => {
      const t = e.target
      if (t.tagName === 'rect' && t.dataset.v !== undefined) {
        tip.show(`<div class="tt-title">${days[t.dataset.d]} ${String(t.dataset.h).padStart(2, '0')}:00</div><b>${t.dataset.v}%</b> lane activity`, e.clientX, e.clientY)
      } else tip.hide()
    })
    svg.addEventListener('pointerleave', () => tip.hide())
  }

  /* ---------- verdict donut (status colors) ---------- */
  function renderVerdicts() {
    const host = root.querySelector('#verdict-chart')
    host.innerHTML = ''
    const v = m.verdicts
    const total = v.accept + v.reject + v.retry
    const segs = [
      { k: 'Accept', n: v.accept, c: 'var(--s-good)' },
      { k: 'Retry', n: v.retry, c: 'var(--s-warn)' },
      { k: 'Reject', n: v.reject, c: 'var(--s-serious)' },
    ]
    const S = 190, r = 66, cx = S / 2, cy = S / 2 - 4, circ = 2 * Math.PI * r
    let off = 0, arcs = ''
    for (const s of segs) {
      const frac = s.n / total
      const len = Math.max(0, frac * circ - 3)
      arcs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.c}" stroke-width="16"
        stroke-dasharray="${len} ${circ - len}" stroke-dashoffset="${-off}" stroke-linecap="round" transform="rotate(-90 ${cx} ${cy})"/>`
      off += frac * circ
    }
    host.appendChild(el(`
      <div style="display:flex;flex-direction:column;align-items:center">
        <div style="position:relative">
          <svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">${arcs}</svg>
          <div style="position:absolute;inset:0;display:grid;place-items:center;text-align:center">
            <div><div style="font-size:30px;font-weight:660;font-variant-numeric:tabular-nums" id="verdict-total">${total}</div>
            <div style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-4);font-weight:600">verdicts</div></div>
          </div>
        </div>
        <div style="display:flex;gap:14px;margin-top:6px;font-size:11.5px;color:var(--ink-2)">
          ${segs.map(s => `<span style="display:flex;align-items:center;gap:6px"><i style="width:8px;height:8px;border-radius:50%;background:${s.c}"></i>${s.k} <b style="font-variant-numeric:tabular-nums">${s.n}</b></span>`).join('')}
        </div>
      </div>
    `))
  }

  /* ---------- discipline counters ---------- */
  function renderOps() {
    const host = root.querySelector('#ops-body')
    host.innerHTML = ''
    const rows = [
      ['Truncations resumed', m.truncations, 'continuation, never completion'],
      ['Model-floor refusals', m.modelFloorRefusals, 'downgrade = refusal'],
      ['Ledger gates open', 4, 'deadlines never override'],
      ['Preflights run', 96, 'before work, not after'],
      ['Territory collisions', 0, 'claims held'],
    ]
    for (const [l, v, s] of rows) {
      host.appendChild(el(`
        <div style="display:flex;align-items:baseline;justify-content:space-between;padding:9px 2px;border-bottom:1px solid var(--line)">
          <div><div style="font-size:12.5px;font-weight:570;color:var(--ink-2)">${l}</div>
          <div style="font-size:10.5px;color:var(--ink-4)">${s}</div></div>
          <div style="font-size:20px;font-weight:650;font-variant-numeric:tabular-nums">${v}</div>
        </div>`))
    }
  }

  /* ---------- agent table ---------- */
  function renderTable() {
    const table = root.querySelector('#agent-table')
    table.innerHTML = `
      <thead><tr>
        <th>Agent</th><th>Machine</th><th>Role</th><th>Pool</th><th>Model</th>
        <th class="num">Tasks</th><th class="num">Fail</th><th class="num">Runtime</th><th></th>
      </tr></thead><tbody></tbody>`
    const tbody = table.querySelector('tbody')
    for (const c of sim.computers) {
      for (const a of c.agents) {
        const role = ROLES[a.role]
        const failCls = a.failRate < 2 ? 'fail-ok' : a.failRate < 5 ? 'fail-warn' : 'fail-bad'
        const tr = el(`<tr>
          <td><span class="aname" style="--rc:${role.hex};--gc:${role.glow}"><i></i>${a.name}</span></td>
          <td>${c.name}</td>
          <td>${role.label}</td>
          <td style="font-family:var(--font-mono);font-size:11px">${a.pool}</td>
          <td style="font-family:var(--font-mono);font-size:11px">${a.model}</td>
          <td class="num">${a.tasksDone}</td>
          <td class="num ${failCls}">${a.failRate}%</td>
          <td class="num rt-cell">—</td>
          <td></td>
        </tr>`)
        unsubs.push(bindRuntime(tr.querySelector('.rt-cell'), () => a.bornAt))
        tr.lastElementChild.appendChild(sparkline({ points: Array.from({ length: 10 }, () => 20 + Math.random() * 60), w: 90, h: 24, color: role.hex }))
        tbody.appendChild(tr)
      }
    }
  }

  renderTiles(); renderPools(); renderTokens(); renderFail(); renderHeat(); renderVerdicts(); renderOps(); renderTable()

  unsubs.push(sim.on('metrics', () => { renderTiles(); renderFail(); renderVerdicts() }))

  return { el: root, destroy() { unsubs.forEach(u => u()) } }
}
