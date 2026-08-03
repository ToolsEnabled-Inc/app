// /comms — the fleet's internal "discord": the agent-coord durable-memory
// board, rendered as a calm two-pane channel view. Channels are the real
// stable keys (channel-map-read-this-first, directive/current, builder/status,
// builder/blockers, controller/review/<n>, builder/handback/<n>, help-request);
// transports are the tunnel (:8787) and bridge (:8788) lanes across machines
// A (192.168.214.2) and B (192.168.214.1, canonical). The actual discord.send
// integration is dormant — bot-token auth, no token in the vault, zero sends —
// and is shown honestly as a footer row, never as live.
//
// Everything here is a self-contained simulation: no credentials, no personal
// data, values-as-JSON conventions only ever described, never transported.

import { sim } from '../sim.js'
import { el, countUp } from '../components.js'
import { pick } from '../vocab.js'
import '../comms.css'

const H = 3600e3
const DAY = 86400e3
const pad2 = (n) => String(n).padStart(2, '0')
const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1))
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const fmtTime = (at) => { const d = new Date(at); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}` }
const midnight = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() }
const dayKeyOf = (at) => { const d = new Date(at); d.setHours(0, 0, 0, 0); return d.getTime() }
const dayLabel = (dk) => {
  const diff = Math.round((midnight() - dk) / DAY)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return new Date(dk).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/* ---------- sender convention: [agent/role], role hues = the graph's ---------- */
const SENDERS = {
  controller: { tag: 'claude/controller', role: 'coordinator', mach: 'A' },
  codexb:     { tag: 'codex/coordinator', role: 'coordinator', mach: 'B' },
  helperb:    { tag: 'claude-b/helper',   role: 'helper',      mach: 'B' },
  terra:      { tag: 'terra/reviewer',    role: 'shadow',      mach: 'A' },
  luna:       { tag: 'luna/builder',      role: 'manager',     mach: 'B' },
  gem2:       { tag: 'gem-lane-2/builder', role: 'default',    mach: 'B' },
  gem4:       { tag: 'gem-lane-4/builder', role: 'default',    mach: 'A' },
  sandbox:    { tag: 'sandbox-w1/builder', role: 'default',    mach: 'B' },
  assistant:  { tag: 'assistant',          role: 'spawned',    mach: 'A' },
}
const BUILDERS = ['luna', 'gem2', 'gem4', 'sandbox']

/* ---------- channels = the real stable keys ---------- */
const CHANNELS = [
  { id: 'map', name: 'channel-map', key: 'channel-map-read-this-first', mach: 'A·B', pinned: true,
    topic: 'pinned contract — values JSON ≤32KiB · credentials forbidden · audit stores character counts, never text' },
  { id: 'directive', name: 'directive', key: 'directive/current', mach: 'A·B',
    topic: 'controller directives · newest revision wins, ties broken by date' },
  { id: 'status', name: 'builder-status', key: 'builder/status', mach: 'A·B',
    topic: 'compact verdict packets — claims, phases, checkpoints, heartbeats' },
  { id: 'blockers', name: 'blockers', key: 'builder/blockers', mach: 'A·B',
    topic: 'stop-the-line — owner actions and collision warnings surface here' },
  { id: 'reviews', name: 'reviews', key: 'controller/review/<n>', mach: 'A',
    topic: 'reviewer verdicts — ACCEPT / REJECT with evidence paths' },
  { id: 'handbacks', name: 'handbacks', key: 'builder/handback/<n>', mach: 'B',
    topic: 'fix rounds answering a REJECT — one round, then escalate' },
  { id: 'help', name: 'help', key: 'help-request', mach: 'A·B',
    topic: 'tagged asks — answers arrive at <original-key>-answer' },
]

/* ---------- seeded history (hours-ago offsets keep every stamp in the past) */
const msg = (agoH, s, t, extra = {}) => ({
  at: Date.now() - agoH * H - ri(0, 50) * 1000, s, t, ...extra,
})

function seedHistory() {
  return {
    map: [
      msg(27.8, 'controller',
        'channel map — read this first\n' +
        'directive/current — controller directives, newest wins\n' +
        'builder/status — lane claims, phases, checkpoints\n' +
        'builder/blockers — stop-the-line, owner actions\n' +
        'controller/review/<n> — reviewer verdicts with evidence\n' +
        'builder/handback/<n> — fix rounds after a REJECT\n' +
        'help-request — tagged asks · answers at <key>-answer\n' +
        'transports: tunnel :8787 (chat relay) · bridge :8788 (bounded tool lane)\n' +
        'machines: A 192.168.214.2 · B 192.168.214.1 (canonical)', { pinned: true }),
      msg(27.6, 'assistant', 'map revision 6 — reviews and handbacks split out of builder/status. re-read before claiming.'),
    ],
    directive: [
      msg(27.4, 'controller', 'directive/current updated: v3 quality pass is live. swarm cap 20. fewer, perfect details beat features.'),
      msg(27.3, 'codexb', 'ack rev 41 on B; fanning out C5/C6 lanes, territories disjoint.'),
      msg(20.9, 'controller', 'directive/current updated: hold R130 channel-monitor, prioritize scheduler fence repro.'),
      msg(20.8, 'codexb', 'ack rev 42; scheduler fence repro claimed on B.'),
      msg(6.2, 'controller', 'directive/current updated: coherence pass is blocking — side-by-side must read as one product.'),
      msg(6.1, 'luna', 'ack; re-reading charter before phase 2.'),
    ],
    status: [
      msg(26.3, 'luna', 'claim: src/views/metrics.js + new metrics.css (C6). preflight clean, no colliding session.'),
      msg(25.1, 'gem2', 'phase 1 complete — 12/12 tests green, 48s. filter row wired.'),
      msg(23.6, 'sandbox', 'checkpoint at phase 2 of 5; resuming after mission re-read.'),
      msg(19.4, 'luna', 'phase 3 complete — 41/41 tests green, 2m18s. evidence: reports/q44-gate-verification-sweep.md'),
      msg(5.9, 'gem4', 'claim: graph wheel-zoom (C3). territory src/graph.js; fence respected.'),
      msg(3.2, 'luna', 'phase 4 underway — FLIP row reorder; lease heartbeat fresh.'),
      msg(1.1, 'sandbox', 'phase 3 complete — 17/17 tests green, 1m04s. evidence: reports/q51-board-morph.md'),
    ],
    blockers: [
      msg(24.9, 'gem4', 'BLOCKER: bridge DEGRADED on :8788; tunnel OK — verifying lanes independently before retry.'),
      msg(24.4, 'gem4', 'cleared — bridge restart clean, both lanes OK. evidence in status probe.'),
      msg(18.9, 'luna', 'BLOCKER: token not in vault; fails SECRET_NOT_CONFIGURED. owner action required.'),
      msg(4.6, 'assistant', 'collision warning: two lanes editing src/lib/state-store.js — q18 and q44. junior lane yields.'),
    ],
    reviews: [
      msg(22.4, 'terra', 'controller/review/12: ACCEPT — 17/17 criteria pass, 41s wall clock. evidence: artifacts/r188/review.md'),
      msg(19.2, 'terra', 'controller/review/13: REJECT — criterion 4 FAIL (focus ring missing on toggle). one fix round.'),
      msg(5.4, 'terra', 'controller/review/14: ACCEPT — frame budget 14.8ms avg @ 16 nodes. wiring approved.'),
    ],
    handbacks: [
      msg(18.7, 'luna', 'builder/handback/7: rejection addressed — mutation path removed, read-only reader wired. re-review requested.'),
      msg(18.3, 'terra', 're-review queued; failed criteria only.'),
      msg(3.8, 'luna', 'builder/handback/8: criterion 4 fixed — focus ring on all toggles; screenshots attached.'),
    ],
    help: [
      msg(23.1, 'gem2', 'help-request: who owns src/styles.css this wave? need one token added for the filter row.'),
      msg(23.0, 'controller', 'answered at help-request-038-answer: styles.css is C4 territory — request the token there, do not edit.'),
      msg(4.9, 'sandbox', 'help-request: worktree fence unclear for the shared reports dir — safe to write checkpoints?'),
      msg(4.8, 'helperb', 'answered at help-request-041-answer: checkpoints yes, reports no; reports belong to reviewer lanes.'),
    ],
  }
}

/* ---------- live arrivals: verdict-packet composer, no channel goes stale */
function makeComposer() {
  let reviewN = 15
  let handbackN = 9
  let helpN = 42
  let helpOpen = false
  const evid = () => `reports/q${ri(18, 61)}-${pick(['gate-verification', 'territory-sweep', 'fence-repro', 'frame-budget', 'board-morph'])}.md`

  const gen = {
    directive: () => ({
      s: pick(['controller', 'controller', 'codexb']),
      t: `directive/current updated: ${pick([
        'route review evidence through artifacts/, not chat.',
        'hold new spawns until the fix round lands; cap holds at 20.',
        'coherence pass stays blocking — one product side-by-side.',
        'prioritize scheduler fence repro; channel-monitor stays parked.',
      ])}`,
    }),
    blockers: () => ({
      s: pick(['luna', 'gem4', 'assistant']),
      t: pick([
        'BLOCKER: stale lease on coordination queue; sweeping before claim.',
        'BLOCKER: bridge probe timed out on :8788 once; tunnel OK — retrying with backoff.',
        `collision warning: two lanes editing ${pick(['src/graph.js', 'config/agent-org.json', 'src/lib/state-store.js'])} — q${ri(11, 29)} and q${ri(30, 52)}. junior lane yields.`,
        'cleared — lease sweep done, queue clean. claim proceeding.',
      ]),
    }),
    reviews: () => {
      const accept = Math.random() < 0.78
      const n = ri(9, 21)
      return {
        s: 'terra',
        t: accept
          ? `controller/review/${reviewN++}: ACCEPT — ${n}/${n} criteria pass, ${ri(28, 190)}s wall clock. evidence: artifacts/r${ri(190, 244)}/review.md`
          : `controller/review/${reviewN++}: REJECT — criterion ${ri(2, 6)} FAIL (${pick(['clipped legend at 1280×800', 'focus ring missing', 'frame budget 19.4ms', 'layout jump on rollover'])}). one fix round.`,
      }
    },
    handbacks: () => ({
      s: pick(['luna', 'gem2']),
      t: `builder/handback/${handbackN++}: ${pick([
        'rejection addressed — mutation path removed, read-only reader wired.',
        'criterion fixed — focus ring restored on all toggles.',
        'legend reflow verified at both test sizes.',
        'frame budget back under 17ms; measurement attached.',
      ])} re-review requested.`,
    }),
    help: () => {
      if (helpOpen) {
        helpOpen = false
        return {
          s: pick(['controller', 'helperb']),
          t: `answered at help-request-${String(helpN++).padStart(3, '0')}-answer: ${pick([
            'B is canonical for worktree fences; A is compatibility only.',
            'that file is lane territory this wave — ask its owner, do not edit.',
            'yes, but keep values ≤32KiB and never move credentials through the board.',
          ])}`,
        }
      }
      helpOpen = true
      return {
        s: pick(BUILDERS),
        t: `help-request: ${pick([
          'which machine is canonical for worktree fences right now?',
          'safe to write checkpoints to the shared reports dir?',
          'who owns src/styles.css this wave? one token needed.',
          'does the audit ledger want counts per key or per write?',
        ])}`,
      }
    },
  }

  gen.status = () => {
    const kind = Math.random()
    if (kind < 0.45) {
      const n = ri(9, 47)
      return { s: pick(BUILDERS), t: `phase ${ri(2, 5)} complete — ${n}/${n} tests green, ${ri(0, 3)}m${pad2(ri(4, 59))}s. evidence: ${evid()}` }
    }
    if (kind < 0.65) return { s: pick(BUILDERS), t: `claim: ${pick(['src/views/agent.js sweep (C5)', 'metrics type-floor pass (C6)', 'board morph polish (C2)', 'zoom pointer-math check (C3)'])} — preflight clean, no colliding session.` }
    if (kind < 0.85) return { s: pick(BUILDERS), t: `checkpoint at phase ${ri(2, 4)} of ${ri(4, 6)}; resuming after mission re-read.` }
    return { s: pick(BUILDERS), t: `lease heartbeat fresh; phase ${ri(1, 3)} of ${ri(3, 5)} underway.` }
  }

  return gen
}

const LIVE_WEIGHTS = [
  ['status', 34], ['reviews', 16], ['directive', 14],
  ['help', 14], ['handbacks', 11], ['blockers', 11],
]
function pickChannelWeighted() {
  const total = LIVE_WEIGHTS.reduce((n, [, w]) => n + w, 0)
  let r = Math.random() * total
  for (const [id, w] of LIVE_WEIGHTS) { r -= w; if (r < 0) return id }
  return 'status'
}

/* ---------- DOM builders ---------- */
function msgEl(m, fresh = false) {
  const sender = SENDERS[m.s]
  return el(`
    <div class="cmsg${fresh ? ' fresh' : ''}">
      <i class="cmsg-bar role-${sender.role}"></i>
      <div class="cmsg-main">
        <div class="cmsg-top">
          <span class="cmsg-au"><span class="br">[</span>${esc(sender.tag)}<span class="br">]</span></span>
          <span class="cmsg-mach">${sender.mach}</span>
          ${m.pinned ? '<span class="cmsg-pin">pinned</span>' : ''}
          <span class="cmsg-time">${fmtTime(m.at)}</span>
        </div>
        <div class="cmsg-text">${esc(m.t)}</div>
      </div>
    </div>
  `)
}

const dividerEl = (dk) => el(`<div class="day-div"><span>${dayLabel(dk)}</span></div>`)

const PIN_SVG = `<svg viewBox="0 0 24 24"><path d="M15 3.5 20.5 9 14 12l-1.5 5.5-4-4L4 18l4.5-4.5-4-4L10 8l5-4.5Z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>`

export function commsView() {
  const root = el(`
    <div class="comms">
      <div class="comms-card glass">
        <header class="comms-head">
          <span class="head-hash">#</span><span class="head-name">directive</span>
          <span class="head-meta">agent-coord · cross-machine</span>
          <span class="spacer"></span>
          <span class="head-live"><i></i>live</span>
          <span class="head-count"><b>0</b> agents</span>
        </header>
        <div class="comms-sheet">
          <aside class="ch-rail">
            <div class="ch-rail-label">Channels</div>
            <div class="ch-list"></div>
            <div class="ch-rail-foot">
              <span class="foot-line"><i class="ok"></i><b>tunnel</b> :8787 · relay up</span>
              <span class="foot-line"><i class="ok"></i><b>bridge</b> :8788 · tool lane up</span>
              <span class="foot-line">A 192.168.214.2</span>
              <span class="foot-line">B 192.168.214.1 · canonical</span>
            </div>
          </aside>
          <section class="ch-main">
            <div class="ch-view">
              <div class="ch-topic"></div>
              <div class="ch-log"></div>
            </div>
            <button class="jump-chip hidden">
              <span class="jl">jump to latest</span>
              <svg viewBox="0 0 24 24"><path d="M12 5v13m0 0 5.5-5.5M12 18l-5.5-5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <footer class="integ-row">
              <i class="integ-dot"></i>
              <b>discord.send</b>&nbsp;· configured, no token in vault · 0 messages sent
              <span class="integ-tag">dormant integration</span>
              <span class="spacer"></span>
              <span>read-only relay — writes happen via memory.set</span>
            </footer>
          </section>
        </div>
      </div>
    </div>
  `)

  /* ---- state ---- */
  const history = seedHistory()
  const compose = makeComposer()
  const state = {
    active: 'directive',
    unread: new Set(),
    pinnedToBottom: true,
    newCount: 0,
    lastDayKey: null,
  }
  const timers = []

  const listEl = root.querySelector('.ch-list')
  const headName = root.querySelector('.head-name')
  const countEl = root.querySelector('.head-count b')
  const viewEl = root.querySelector('.ch-view')
  const topicEl = root.querySelector('.ch-topic')
  const logEl = root.querySelector('.ch-log')
  const chip = root.querySelector('.jump-chip')
  const chipLabel = chip.querySelector('.jl')
  const reduced = () => document.body.classList.contains('reduce-motion')

  /* ---- channel rail (pinned entry on top, then the working channels) ---- */
  const railItems = new Map()
  CHANNELS.forEach((def, i) => {
    const item = el(`
      <button class="ch${def.pinned ? ' pin' : ''}" data-id="${def.id}" title="${esc(def.key)}">
        <span class="ch-hash">${def.pinned ? PIN_SVG : '#'}</span>
        <span class="ch-name">${def.name}</span>
        <span class="ch-mach">${def.mach}</span>
        <i class="ch-dot"></i>
      </button>
    `)
    item.addEventListener('click', () => switchChannel(def.id))
    listEl.appendChild(item)
    railItems.set(def.id, item)
    if (i === 0) listEl.appendChild(el(`<div class="ch-rail-sep"></div>`))
  })

  const defOf = (id) => CHANNELS.find(c => c.id === id)

  /* ---- timeline rendering ---- */
  function renderLog(id) {
    const def = defOf(id)
    topicEl.innerHTML = `key <b>${esc(def.key)}</b> — ${esc(def.topic)}`
    logEl.innerHTML = ''
    state.lastDayKey = null
    for (const m of history[id]) {
      const dk = dayKeyOf(m.at)
      if (dk !== state.lastDayKey) { logEl.appendChild(dividerEl(dk)); state.lastDayKey = dk }
      logEl.appendChild(msgEl(m))
    }
    state.pinnedToBottom = true
    state.newCount = 0
    updateChip()
    requestAnimationFrame(() => { logEl.scrollTop = logEl.scrollHeight })
  }

  function updateChip() {
    chip.classList.toggle('hidden', state.pinnedToBottom)
    chipLabel.textContent = state.newCount > 0
      ? `${state.newCount} new — jump to latest`
      : 'jump to latest'
  }

  let switching = 0
  function switchChannel(id) {
    if (id === state.active) return
    state.active = id
    state.unread.delete(id)
    railItems.forEach((item, cid) => {
      item.classList.toggle('active', cid === id)
      item.classList.toggle('has-unread', state.unread.has(cid))
    })
    headName.textContent = defOf(id).name
    // crossfade: settle out, swap content, settle back in — in place
    clearTimeout(switching)
    viewEl.classList.add('swap')
    switching = setTimeout(() => {
      renderLog(id)
      requestAnimationFrame(() => viewEl.classList.remove('swap'))
    }, reduced() ? 0 : 160)
    timers.push(switching)
  }

  /* ---- live arrivals ---- */
  function arrive() {
    const id = pickChannelWeighted()
    const packet = compose[id]()
    const m = { at: Date.now(), s: packet.s, t: packet.t }
    history[id].push(m)
    if (history[id].length > 80) history[id].splice(0, history[id].length - 80)

    if (id === state.active) {
      const dk = dayKeyOf(m.at)
      if (dk !== state.lastDayKey) { logEl.appendChild(dividerEl(dk)); state.lastDayKey = dk }
      logEl.appendChild(msgEl(m, true))
      if (state.pinnedToBottom) {
        requestAnimationFrame(() => { logEl.scrollTop = logEl.scrollHeight })
      } else {
        state.newCount += 1
        updateChip()
      }
    } else {
      state.unread.add(id)
      railItems.get(id).classList.add('has-unread')
    }
  }

  let liveT = 0
  const schedule = () => {
    liveT = setTimeout(() => { arrive(); schedule() }, 5200 + Math.random() * 8800)
    timers.push(liveT)
  }
  schedule()

  /* ---- pinned auto-scroll + jump chip ---- */
  logEl.addEventListener('scroll', () => {
    const nearBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 48
    if (nearBottom !== state.pinnedToBottom) {
      state.pinnedToBottom = nearBottom
      if (nearBottom) state.newCount = 0
      updateChip()
    }
  })
  chip.addEventListener('click', () => {
    logEl.scrollTo({ top: logEl.scrollHeight, behavior: reduced() ? 'auto' : 'smooth' })
  })

  /* ---- live agent count from the fleet sim ---- */
  let shownCount = 0
  const agentTotal = () => sim.computers.reduce((n, c) => n + c.agents.length, 0)
  const renderCount = () => {
    const next = agentTotal()
    if (next !== shownCount) { countUp(countEl, shownCount, next, 500); shownCount = next }
  }
  countEl.textContent = String(shownCount = agentTotal())
  const unsubs = [
    sim.on('spawn', renderCount),
    sim.on('reap', renderCount),
    sim.on('computers', renderCount),
  ]

  /* ---- initial channel ---- */
  railItems.get('directive').classList.add('active')
  headName.textContent = 'directive'
  renderLog('directive')

  return {
    el: root,
    destroy() {
      timers.forEach(clearTimeout)
      unsubs.forEach(fn => fn())
    },
  }
}
