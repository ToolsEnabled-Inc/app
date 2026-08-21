// /comms — an agent fleet's message board, rendered as a calm two-pane channel
// view. The discord.send integration is dormant — bot-token auth, no token in
// the vault, zero sends — and is shown honestly as a footer row, never as live.
//
// ONE RENDER PATH, THREE DATA SOURCES. This page used to carry a second,
// simulated render — its own seeded histories, a packet composer, an arrival
// scheduler, conversation boxes fed from the fleet profile — selected by a
// per-view live flag. The owner's ruling collapsed that: "all simulated pages
// ARE the UI pages, just mock data." So the live projection below is the only
// code that draws the page, and src/data-source.js answers the one question
// left: where the envelope it renders comes from. 'local' and 'relay' read
// this machine (or the tunnelled one) exactly as the live face always did;
// 'mock' feeds src/sample-comms.js's example envelope through the SAME
// applyLiveProjection, so the render cannot drift between the demonstration
// and the product — a mock-only render bug is impossible because there is no
// mock-only render. The mock face is badged (sourceIsBadged), because the
// badge follows the SOURCE, never the look of the data.
//
// Any address rendered from the fleet profile — the channel-rail footer below
// is the one surface left that reads it — is RFC 5737 documentation-reserved
// (192.0.2.0/24) ON PURPOSE — it can never be a real host. Do NOT "improve"
// them into a realistic-looking private range like 192.168.x: that ships
// something reading as a real machine roster while still passing a grep for
// the owner's own address, which is the bug this replaced. The footer is
// user-visible chrome, not a fixture.
//
// C7 added the WATCH BOARD as the page default: a board of conversation
// context boxes built from the shared chip component (.chip / .chip-preview /
// .as-chat + buildChat from components.js) — the graph's boxes, laid out as a
// scrollable stack that drag-splits into nested tiles. The projection's
// records — services on record, channels seen running, their status details —
// are those boxes now.

import { el, buildChat, attachSeg } from '../components.js'
import { onNextFrame } from '../page-frames.js'
import { ROLES } from '../vocab.js'
import { FLEET } from '../fleet-profile.js'
import { resolveDataSource, currentDataSource, sourceIsBadged, DATA_SOURCE_EVENT } from '../data-source.js'
import { sampleOpsEnvelope } from '../sample-comms.js'
import { fetchOps } from '../live-status.js'
/* The shared empty-state notice — see projectionUnavailableEl below for why this
   board does not write its own. src/guide.css carries the two placements this
   page needs (`.comms .chip-preview .host-absent`, `.comms .chat-log .host-absent`). */
import { commsQuietMarkup, hostAbsentMarkup } from '../first-run-needs.js'
import '../comms.css'

const pad2 = (n) => String(n).padStart(2, '0')
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const fmtTime = (at) => { const d = new Date(at); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}` }

/* ---------- sender convention: the projection's record kinds ----------
   These are not agents; they are the KINDS of record the ops projection
   renders as conversation boxes — a service on record, a channel seen
   running, and the projection's own status voice. The roles exist so the
   boxes can reuse the graph's role hues (ROLES) and so RANK below can decide
   which side of a pairing reads as dominant. Messages themselves carry their
   sender's name in `sender` and render under the 'observed' kind. */
const SENDERS = {
  declared:   { tag: 'on record',    role: 'default', mach: '—' },
  service:    { tag: 'service',      role: 'default', mach: '—' },
  observed:   { tag: 'seen running', role: 'helper',  mach: '—' },
  channel:    { tag: 'channel',      role: 'helper',  mach: '—' },
  projection: { tag: 'status',       role: 'shadow',  mach: '—' },
}

/* ============================================================
   C7 — WATCH BOARD helpers. A card names two SENDERS keys
   (a/b); rank decides which side a pairing reads as dominant
   and how important a box is when the layout weighs it.
   ============================================================ */

const RANK = { coordinator: 4, helper: 3, shadow: 3, manager: 2, default: 1, spawned: 0 }
const shortName = (k) => SENDERS[k].tag.split('/')[0]
const domOf = (d) => RANK[SENDERS[d.a].role] >= RANK[SENDERS[d.b].role] ? d.a : d.b
const impOf = (d) => Math.max(RANK[SENDERS[d.a].role], RANK[SENDERS[d.b].role])

/* Board layout tree: { t:'leaf', c:convId } | { t:'split', dir, branch?, ch:[a,b] }.
   Module-level so the whole board — tiling, sizes, open chats — persists
   across in-session navigation (C7 layout model). */
const wbLeaf = (c) => ({ t: 'leaf', c })

/* Live cards deliberately keep declared services and observed channels as
   separate records. A matching port, name, or transport is not evidence that
   the two are the same thing, so this view never pairs them as a relationship. */
let LIVE_WATCH = null
const liveCard = (id, kind, key, desc, unavailable = null) => ({
  id,
  a: kind === 'declared' ? 'declared' : kind === 'observed' ? 'observed' : 'projection',
  b: kind === 'declared' ? 'service' : kind === 'observed' ? 'channel' : 'projection',
  key,
  desc,
  hist: [],
  unavailable,
  child: null,
})

function liveWatchInit() {
  if (LIVE_WATCH) return LIVE_WATCH
  const pending = liveCard('ops-projection', 'projection', 'live comms', 'Reading this computer’s live comms data.', 'still reading the live comms data')
  LIVE_WATCH = {
    convs: new Map([[pending.id, pending]]),
    stack: [wbLeaf(pending.id)],
    size: 'm',
    mode: 'watch',
    open: new Set(),
  }
  return LIVE_WATCH
}

/* ---------- DOM builders ---------- */
/* The sentence this board shows while the read is still IN FLIGHT. It is named
   because two places set it and one place below has to recognise it: a read
   that has not answered yet is not a machine with no agent host, and the two
   states must not print the same notice. */
const LIVE_COMMS_LOADING = 'still reading the live comms data'

/* WHAT AN EMPTY BOARD SAYS, and why the words are not this file's.
 *
 * This branch is the shipping state — `dist/data/*.json` are build-time outputs
 * and no process on a customer machine writes them — and the whole of what it
 * used to say was "unavailable — No local agent fleet host detected on this
 * machine." True, and not an explanation: it names a mechanism the reader has
 * never heard of and offers no door. src/first-run-needs.js owns that
 * explanation now, and home, the fleet graph and Settings read the same module,
 * so one condition is described once rather than four ways.
 *
 * THE LOADING CASE KEEPS THE TERSE LINE ON PURPOSE. "Nothing is reporting to
 * this copy yet" is a claim about the person's machine; while the read is still
 * going nobody knows that yet, and printing it early would be a wrong answer
 * that silently corrects itself — which reads as the product changing its mind.
 * An unanswered read is not an absent host.
 *
 * A MISSING reason falls to the full notice, not to the terse line: "we could
 * not read it and cannot say why" is exactly when a person is most lost, so
 * absence removes only the quoted sentence, never the explanation or the door. */
const projectionUnavailableEl = (reason) => {
  if (reason === LIVE_COMMS_LOADING) {
    return el(`<div class="projection-unavailable" data-projection-unavailable="true">unavailable — ${esc(reason)}</div>`)
  }
  const node = el(hostAbsentMarkup(reason, { compact: true }))
  node.dataset.projectionUnavailable = 'true'
  return node
}
const projectionNoticeEl = (note) => el(`<div class="projection-state" data-projection-state="true">${esc(note)}</div>`)

function liveMsgEl(m) {
  return el(`
    <div class="cmsg" data-live-mode="live">
      <i class="cmsg-bar role-default"></i>
      <div class="cmsg-main">
        <div class="cmsg-top">
          <span class="cmsg-au"><span class="br">[</span>${esc(m.sender)}<span class="br">]</span></span>
          <span class="cmsg-mach">observed</span>
          <span class="cmsg-time">${fmtTime(m.at)}</span>
        </div>
        <div class="cmsg-text">${esc(m.t)}</div>
      </div>
    </div>
  `)
}

/* The rail footer names the fleet's transports and hosts, and both belong to
   the operator rather than to the product. It used to be four literals: two
   named ports each carrying a green dot and the word "up", and a two-host
   roster with one host labelled canonical. On a fresh install that is a health
   claim about infrastructure the app has never contacted, and a roster of
   machines the reader does not own. A transport with no port says it is not
   configured, and the dot marks "configured", never "reachable". */
function railFootMarkup() {
  const txt = (value) => esc(String(value ?? ''))
  const lines = []
  for (const transport of FLEET.transports || []) {
    const portNumber = Number(transport.port)
    const port = Number.isFinite(portNumber) && transport.port !== null ? ` :${txt(portNumber)}` : ''
    lines.push(`<span class="foot-line">${port ? '<i class="ok"></i>' : ''}<span class="ft"><b>${txt(transport.label || transport.id || 'transport')}</b>${port} · ${txt(transport.note || 'not configured')}</span></span>`)
  }
  for (const machine of FLEET.machines || []) {
    const tag = machine.note ? `<span class="foot-can">${txt(machine.note)}</span>` : ''
    lines.push(`<span class="foot-line"><span class="ft">${txt(machine.name)} ${txt(machine.ip)}</span>${tag}</span>`)
  }
  if (!lines.length) lines.push('<span class="foot-line"><span class="ft">no transports or hosts declared</span></span>')
  return lines.join('')
}

export function commsView() {
  /* data-live-mode / data-projection-state keep their old vocabulary — other
     surfaces and the QA drivers read these attributes — but the value is now
     DERIVED from the data source once it resolves (markDataSource below):
     'simulated' is what a badged mock source wears, 'live' is real data. The
     mount stamps the loading state; nothing claims a source before one is
     resolved. */
  const W = liveWatchInit()
  const root = el(`
    <div class="comms" data-mode="${W.mode}" data-live-mode="live" data-projection-state="loading">
      <header class="comms-head">
        <span class="head-hash">#</span><span class="head-name"></span>
        <span class="head-meta">message board · cross-machine</span>
        <span class="head-wt">watch board</span>
        <span class="head-wt-meta">message board · live conversations</span>
        <span class="spacer"></span>
        <div class="seg wb-seg size-seg" role="group" aria-label="Box size">
          <button type="button" data-size="s" title="Small boxes">S</button>
          <button type="button" data-size="m" title="Medium boxes">M</button>
          <button type="button" data-size="l" title="Large boxes">L</button>
        </div>
        <div class="seg wb-seg mode-seg" role="group" aria-label="Comms mode">
          <button type="button" data-wmode="watch">Watch</button>
          <button type="button" data-wmode="channels">Channels</button>
        </div>
        <span class="head-live"><i></i>live</span>
        <span class="head-count"><b>0</b> agents</span>
      </header>
      <div class="comms-card glass">
        <div class="comms-body">
          <div class="watch-pane" data-size="${W.size}">
            <div class="watch-stack"></div>
          </div>
          <section class="comms-sheet">
            <aside class="ch-rail">
              <div class="ch-rail-label">Ops projection</div>
              <div class="ch-list"></div>
              <div class="ch-rail-foot" data-projection-foot="true">${railFootMarkup()}</div>
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
                <span class="integ-main"><b>discord.send</b> · configured, no token · 0 messages sent</span>
                <span class="integ-tag">dormant integration</span>
                <span class="spacer"></span>
                <span class="integ-note">writes via durable memory</span>
              </footer>
            </section>
          </section>
        </div>
      </div>
    </div>
  `)

  /* ---- state ---- */
  /* The projection fills these on every application: history keyed by channel
     id, channelDefs describing the rail. Until the first read answers, the
     one channel is the loading card, whose `unavailable` sentence keeps the
     pane honest about a read that has not answered yet. */
  const history = {}
  let channelDefs = [{ id: 'ops-projection', name: 'live comms', key: 'ops', mach: 'live', topic: 'Reading this computer’s live comms data.', unavailable: LIVE_COMMS_LOADING }]
  let liveMessagesReason = LIVE_COMMS_LOADING
  let destroyed = false
  const state = {
    active: channelDefs[0].id,
    unread: new Set(),
    pinnedToBottom: true,
    newCount: 0,
  }
  const timers = []

  const listEl = root.querySelector('.ch-list')
  const railFoot = root.querySelector('[data-projection-foot]')
  const headMeta = root.querySelector('.head-meta')
  const headCount = root.querySelector('.head-count')
  const headName = root.querySelector('.head-name')
  const countEl = root.querySelector('.head-count b')
  const viewEl = root.querySelector('.ch-view')
  const topicEl = root.querySelector('.ch-topic')
  const logEl = root.querySelector('.ch-log')
  const chip = root.querySelector('.jump-chip')
  const chipLabel = chip.querySelector('.jl')
  const reduced = () => document.body.classList.contains('reduce-motion')

  /* ---- channel rail (the projection's records, with their separator) ---- */
  const railItems = new Map()
  function renderRail() {
    listEl.textContent = ''
    railItems.clear()
    channelDefs.forEach((def) => {
      /* The separator marks the seam the projection declares — between the
         services on record and the channels seen running (dividerBefore is
         set where that second block starts). */
      if (def.dividerBefore) listEl.appendChild(el(`<div class="ch-rail-sep"></div>`))
      const item = el(`
        <button class="ch" data-id="${esc(def.id)}" title="${esc(def.key)}">
          <span class="ch-hash">#</span>
          <span class="ch-name">${esc(def.name)}</span>
          <span class="ch-mach">${esc(def.mach)}</span>
          <i class="ch-dot"></i>
        </button>
      `)
      item.addEventListener('click', () => switchChannel(def.id))
      listEl.appendChild(item)
      railItems.set(def.id, item)
    })
  }
  renderRail()

  const defOf = (id) => channelDefs.find(c => c.id === id)

  /* ---- timeline rendering ---- */
  function renderLog(id) {
    const def = defOf(id)
    if (!def) return
    topicEl.innerHTML = `key <b>${esc(def.key)}</b> — ${esc(def.topic)}`
    logEl.innerHTML = ''
    if (def.unavailable || liveMessagesReason) logEl.appendChild(projectionUnavailableEl(def.unavailable || liveMessagesReason))
    else if (!history[id]?.length) logEl.appendChild(projectionNoticeEl('No messages have been seen for this exact channel.'))
    else for (const m of history[id]) logEl.appendChild(liveMsgEl(m))
    state.pinnedToBottom = true
    state.newCount = 0
    updateChip()
    /* PIN AFTER LAYOUT, NOT AFTER A FRAME THAT MAY NEVER COME. A covered
       window gets no frames, so this callback -- and the log it closed
       over -- stayed in the browser's queue for ever (measured: +2 per lap
       of the ring at this site). onNextFrame flushes layout and pins now on
       such a page, and is the ordinary requestAnimationFrame otherwise. */
    onNextFrame(() => { logEl.scrollTop = logEl.scrollHeight })
  }

  function updateChip() {
    chip.classList.toggle('hidden', state.pinnedToBottom)
    /* .hidden only fades it out; a faded-out control is still a tab stop whose
       focus ring paints at opacity 0. Take it out of the tab order and the a11y
       tree while it is hidden — the fade transition is unaffected. */
    chip.inert = state.pinnedToBottom
    chip.tabIndex = state.pinnedToBottom ? -1 : 0
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
    headName.textContent = defOf(id)?.name || ''
    // crossfade: settle out, swap content, settle back in — in place
    clearTimeout(switching)
    viewEl.classList.add('swap')
    switching = setTimeout(() => {
      renderLog(id)
      requestAnimationFrame(() => viewEl.classList.remove('swap'))
    }, reduced() ? 0 : 160)
    timers.push(switching)
  }

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

  /* The header count is written by the projection (services on record); until
     the first application it keeps the mount value. Everything that needs
     undoing at teardown — event listeners, the seg helpers, the poll — goes
     through this one list, the same way destroy() has always drained it. */
  const unsubs = []

  /* ==========================================================
     C7 — WATCH BOARD. Every box is the shared context-box chip
     (.chip / .chip-preview / .as-chat + buildChat) laid out as
     a fixed vertical stack that drag-splits into nested tiles.
     ========================================================== */
  const pane = root.querySelector('.watch-pane')
  const stackEl = root.querySelector('.watch-stack')
  const stackDrop = el(`<div class="wb-stackdrop"></div>`)
  const wtMeta = root.querySelector('.head-wt-meta')
  /* `${n} conversations` read "1 conversations" on a fresh install, which is
     the first line of the first page a person reaches from home's forward
     arrow. Singular/plural is spelled the way the rest of this codebase
     spells it (src/local-activity.js, src/account-markup.js and 18 others). */
  const conversationsMeta = count => `message board · ${count} conversation${count === 1 ? '' : 's'}`
  wtMeta.textContent = conversationsMeta(W.convs.size)
  const EASE = 'cubic-bezier(0.22, 0.9, 0.26, 1)'
  const boxEls = new Map()            // convId -> chip element (this mount)
  let dragTeardown = null
  { const esc = (ev) => { if (ev.key === 'Escape' && drag) dragTeardown?.() }; window.addEventListener('keydown', esc); unsubs.push(() => window.removeEventListener('keydown', esc)) } // audit #27: Escape aborts an in-flight box drag through the SAME teardown destroy() uses (abortDrag + listener cleanup); guarded on `drag` so a stray Escape outside a drag is a no-op

  /* ----- tree helpers ----- */
  function locate(target, list = W.stack, parentSplit = null) {
    for (let i = 0; i < list.length; i++) {
      const n = list[i]
      if (n === target) return { list, index: i, parentSplit }
      if (n.t === 'split') { const r = locate(target, n.ch, n); if (r) return r }
    }
    return null
  }
  function findLeafByConv(cid, list = W.stack) {
    for (const n of list) {
      if (n.t === 'leaf' && n.c === cid) return n
      if (n.t === 'split') { const r = findLeafByConv(cid, n.ch); if (r) return r }
    }
    return null
  }
  function eachSplit(fn, list = W.stack) {
    for (const n of list) if (n.t === 'split') { fn(n); eachSplit(fn, n.ch) }
  }
  const primaryConv = (n) => n.t === 'leaf' ? n.c : primaryConv(n.ch[0])
  function subtreeHas(rootN, target) {
    if (rootN === target) return true
    return rootN.t === 'split' && (subtreeHas(rootN.ch[0], target) || subtreeHas(rootN.ch[1], target))
  }
  function replaceNode(oldN, newN) {
    const loc = locate(oldN)
    if (loc) loc.list[loc.index] = newN
  }
  function detach(node) {
    const loc = locate(node)
    if (!loc) return
    if (!loc.parentSplit) { loc.list.splice(loc.index, 1); return }
    const P = loc.parentSplit
    const sibling = P.ch[loc.index === 0 ? 1 : 0]
    replaceNode(P, sibling)
  }
  /* the draggable unit for a box: a branch parent carries its whole pairing;
     a branch child stays pinned to its parent */
  function findDragNode(cid) {
    let node = findLeafByConv(cid)
    if (!node) return null
    for (;;) {
      const loc = locate(node)
      if (!loc || !loc.parentSplit) return node
      if (loc.parentSplit.branch) {
        if (loc.parentSplit.ch[0] === node) { node = loc.parentSplit; continue }
        return null
      }
      return node
    }
  }
  const dropTargetNode = findDragNode      // same climb: split around branch pairs

  const findBranchByParent = (cid) => {
    let found = null
    eachSplit(s => { if (!found && s.branch && s.ch[0].t === 'leaf' && s.ch[0].c === cid) found = s })
    return found
  }
  const findBranchByChild = (cid) => {
    let found = null
    eachSplit(s => { if (!found && s.branch && primaryConv(s.ch[1]) === cid) found = s })
    return found
  }

  /* ----- box construction (the reused chip component) ----- */
  /* Name and text are separate grid cells (see comms.css): with full 2-3
     sentence messages the old inline "name · text" form buried the speaker
     mid-paragraph on every wrapped line. A shared name column turns the
     senders into a scannable rail — who is talking reads down the pane
     without reading a single message. side-a/side-b lets CSS tint each
     speaker with the same role hue their header dot already wears. */
  function previewLineEl(d, m) {
    const side = m.s === d.a ? 'a' : 'b'
    return el(`<div class="cl side-${side}"><b>${esc(m.sender || shortName(m.s))}</b><span>${esc(m.t)}</span></div>`)
  }
  function chatMsgEl(d, m) {
    const side = m.s === d.a ? 'them' : 'me'
    return el(`<div class="msg ${side}"><span class="who">${esc(m.sender || shortName(m.s))}</span>${esc(m.t)}</div>`)
  }

  function boxOf(cid) {
    let box = boxEls.get(cid)
    if (box) return box
    const d = W.convs.get(cid)
    const dom = domOf(d)
    const ra = ROLES[SENDERS[d.a].role]
    const rb = ROLES[SENDERS[d.b].role]
    box = el(`
      <div class="chip wb-box role-${SENDERS[dom].role}" data-conv="${cid}"
           data-agent="${esc(SENDERS[dom].tag)}" data-importance="${impOf(d)}"
           style="--au-a:${ra.hex};--au-b:${rb.hex}">
        <div class="wb-head">
          <span class="wb-pair">
            <i class="wb-dot" style="background:${ra.hex}"></i><span class="wb-name">${esc(shortName(d.a))}</span>
            <span class="wb-x">↔</span>
            <i class="wb-dot" style="background:${rb.hex}"></i><span class="wb-name">${esc(shortName(d.b))}</span>
          </span>
          <span class="wb-key">${esc(d.key)}</span>
          <span class="spacer"></span>
          <button type="button" class="wb-btn wb-branch" title="Open sub-conversation" aria-pressed="false" ${d.child ? '' : 'hidden'}>
            <svg viewBox="0 0 24 24"><circle cx="7" cy="5" r="1.7" fill="currentColor"/><path d="M7 7v6a4 4 0 0 0 4 4h5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="m13.5 14 3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button type="button" class="wb-btn wb-restack" title="Return to stack">
            <svg viewBox="0 0 24 24"><path d="M5 7h14M5 12h8M5 17h8" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M17.5 17.5v-6m0 0L15 14m2.5-2.5L20 14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button type="button" class="wb-btn wb-dismiss" title="Close sub-conversation">
            <svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="wb-desc">${esc(d.desc)}</div>
        <div class="chip-preview"></div>
        <div class="wb-drop"><i></i></div>
      </div>
    `)
    const pv = box.querySelector('.chip-preview')
    if (d.unavailable) pv.appendChild(projectionUnavailableEl(d.unavailable))
    else if (d.hist.length) for (const m of d.hist.slice(-14)) pv.appendChild(previewLineEl(d, m))
    else pv.appendChild(projectionNoticeEl('No messages have been seen for this exact channel.'))
    onNextFrame(() => { pv.scrollTop = pv.scrollHeight })

    box._pvFollow = true
    box._chatFollow = true
    pv.addEventListener('scroll', () => {
      box._pvFollow = pv.scrollHeight - pv.scrollTop - pv.clientHeight < 36
    })
    // pause-on-hover: text never moves under the cursor
    box.addEventListener('mouseenter', () => { box._hover = true })
    box.addEventListener('mouseleave', () => {
      box._hover = false
      if (box._pvFollow) pv.scrollTop = pv.scrollHeight
      const log = box.querySelector('.chat-log')
      if (log && box._chatFollow) log.scrollTop = log.scrollHeight
    })
    box.querySelector('.wb-branch').addEventListener('click', (e) => {
      e.stopPropagation()
      toggleBranch(cid)
    })
    box.querySelector('.wb-restack').addEventListener('click', (e) => {
      e.stopPropagation()
      const node = findDragNode(cid)
      if (!node) return
      const loc = locate(node)
      if (!loc || !loc.parentSplit) return
      flipBoard(() => { detach(node); W.stack.push(node) })
    })
    box.querySelector('.wb-dismiss').addEventListener('click', (e) => {
      e.stopPropagation()
      const s = findBranchByChild(cid)
      if (s) flipBoard(() => replaceNode(s, s.ch[0]))
    })
    box.addEventListener('pointerdown', (e) => onBoxPointerDown(e, box))

    boxEls.set(cid, box)
    if (W.open.has(cid)) openChatBox(cid, true)
    return box
  }

  /* ----- expand ↔ collapse: the graph chips' FLIP morph, verbatim ----- */
  const stackChatPx = () => Math.min(Math.round(window.innerHeight * 0.48), 460)
  function openChatBox(cid, instant = false) {
    const box = boxEls.get(cid)
    const d = W.convs.get(cid)
    if (!box || box.classList.contains('as-chat')) return
    W.open.add(cid)
    clearTimeout(box._t)
    box.querySelector('.chat')?.remove()
    const inStack = box.classList.contains('stack-leaf')
    if (inStack && !instant && !reduced()) {
      box.style.height = box.offsetHeight + 'px'
      void box.offsetWidth
    }
    box.classList.add('as-chat')
    const chat = buildChat({
      title: `${shortName(d.a)} ↔ ${shortName(d.b)}`,
      subtitle: d.key,
      roleKey: SENDERS[domOf(d)].role,
      seed: 2,
      onClose: () => closeChatBox(cid),
      /* THE MOCK FLEET NEVER CLAIMS TO REACH A PROCESS. On a badged source the
         composer is switched off with the reason said in words (buildChat's
         composerReason: the input disables, the sentence renders above it) —
         never hidden, because a silently missing composer reads as a broken
         page, and never left live, because without a real sender buildChat
         answers itself and an example that talks back claims a process that
         does not exist. Real data — local and relay alike — keeps the
         composer exactly as the live face always had it. */
      composerReason: sourceIsBadged(currentDataSource())
        ? 'An example conversation, not a live one. There is no agent behind it, so nothing can be sent from here.'
        : null,
    })
    box.appendChild(chat)
    const log = chat.querySelector('.chat-log')
    if (d.unavailable) log.appendChild(projectionUnavailableEl(d.unavailable))
    else if (d.hist.length) for (const m of d.hist.slice(-6)) log.appendChild(chatMsgEl(d, m))
    else log.appendChild(projectionNoticeEl('No messages have been seen for this exact channel.'))
    log.scrollTop = log.scrollHeight
    box._chatFollow = true
    log.addEventListener('scroll', () => {
      box._chatFollow = log.scrollHeight - log.scrollTop - log.clientHeight < 36
    })
    if (inStack && !instant && !reduced()) {
      box.style.height = stackChatPx() + 'px'
      box._t = setTimeout(() => { box.style.height = '' }, 520)
      timers.push(box._t)
    }
  }
  function closeChatBox(cid) {
    const box = boxEls.get(cid)
    if (!box || !box.classList.contains('as-chat')) return
    W.open.delete(cid)
    clearTimeout(box._t)
    const inStack = box.classList.contains('stack-leaf')
    if (inStack && !reduced()) {
      box.style.height = box.offsetHeight + 'px'
      void box.offsetWidth
    }
    box.classList.remove('as-chat')
    if (inStack && !reduced()) requestAnimationFrame(() => { box.style.height = '' })
    box._t = setTimeout(() => {
      box.querySelector('.chat')?.remove()
      const pv = box.querySelector('.chip-preview')
      if (box._pvFollow) pv.scrollTop = pv.scrollHeight
    }, 520)
    timers.push(box._t)
  }

  /* ----- board rendering ----- */
  function renderNode(node, top) {
    if (node.t === 'leaf') {
      const box = boxOf(node.c)
      if (top) {
        box.classList.add('stack-leaf')
        box.classList.remove('in-split')
        node._el = box
        return box
      }
      const cell = el(`<div class="wb-cell"></div>`)
      box.classList.add('in-split')
      box.classList.remove('stack-leaf', 'dominant')
      box.style.height = ''
      cell.appendChild(box)
      node._el = cell
      return cell
    }
    const s = el(`<div class="wb-split ${node.dir}${node.branch ? ' branch' : ''}${top ? ' top-split' : ''}"></div>`)
    if (node.branch) {
      const pd = W.convs.get(primaryConv(node))
      s.style.setProperty('--pair', ROLES[SENDERS[domOf(pd)].role].hex)
    }
    const c0 = renderNode(node.ch[0], false)
    const c1 = renderNode(node.ch[1], false)
    if (node.branch) c1.classList.add('pair-b')
    s.append(c0, c1)
    node._el = s
    return s
  }

  function applyMarks() {
    for (const box of boxEls.values()) {
      box.classList.remove('branch-child', 'can-restack', 'dominant')
      const btn = box.querySelector('.wb-branch')
      btn.classList.remove('on')
      btn.setAttribute('aria-pressed', 'false')
    }
    eachSplit((s) => {
      if (!s.branch) return
      const child = boxEls.get(primaryConv(s.ch[1]))
      child?.classList.add('branch-child')
      const parent = boxEls.get(s.ch[0].c)
      const btn = parent?.querySelector('.wb-branch')
      if (btn) { btn.classList.add('on'); btn.setAttribute('aria-pressed', 'true') }
    })
    for (const cid of boxEls.keys()) {
      const box = boxEls.get(cid)
      if (!box.isConnected) continue
      const node = findDragNode(cid)
      if (node) {
        const loc = locate(node)
        if (loc && loc.parentSplit) box.classList.add('can-restack')
      }
    }
    // base-stack dominance: the most important agent's box reads biggest
    let best = null, bestImp = -1
    for (const entry of W.stack) {
      if (entry.t !== 'leaf') continue
      const imp = impOf(W.convs.get(entry.c))
      if (imp > bestImp) { bestImp = imp; best = entry }
    }
    if (best) boxEls.get(best.c)?.classList.add('dominant')
  }

  function applyWeights() {
    // per split: the side holding the most important agent takes the larger
    // share (~1.7×); a branch pairing always favours the parent conversation
    const childEl = (n) => n._el
    // .lead is this function's own mark — cleared wholesale before re-weighing
    // so a box that left its split, or a side whose weight flipped, never
    // keeps yesterday's emphasis
    for (const box of boxEls.values()) box.classList.remove('lead')
    function weigh(node) {
      if (node.t === 'leaf') return impOf(W.convs.get(node.c))
      const ia = weigh(node.ch[0])
      const ib = weigh(node.ch[1])
      let wa = 1, wb = 1
      if (node.branch) wa = 1.65
      else if (ia > ib) wa = 1.7
      else if (ib > ia) wb = 1.7
      childEl(node.ch[0])?.style.setProperty('--w', wa)
      childEl(node.ch[1])?.style.setProperty('--w', wb)
      // the winner also wears the emphasis (.lead): extra width alone reads
      // as layout, not importance — the box must LOOK like the lead too.
      // Only a leaf can wear it; when a whole sub-split wins, its own weigh()
      // pass has already crowned the best box inside it. A tie crowns nobody.
      const win = wa > wb ? node.ch[0] : wb > wa ? node.ch[1] : null
      if (win?.t === 'leaf') boxEls.get(win.c)?.classList.add('lead')
      return Math.max(ia, ib)
    }
    for (const entry of W.stack) if (entry.t === 'split') weigh(entry)
  }

  function saveScrolls() {
    const out = []
    for (const [cid, box] of boxEls) {
      if (!box.isConnected) continue
      const pv = box.querySelector('.chip-preview')
      const log = box.querySelector('.chat-log')
      out.push([cid, pv?.scrollTop ?? 0, log?.scrollTop ?? null])
    }
    return out
  }
  function restoreScrolls(saved) {
    for (const [cid, pvTop, logTop] of saved) {
      const box = boxEls.get(cid)
      if (!box?.isConnected) continue
      const pv = box.querySelector('.chip-preview')
      const log = box.querySelector('.chat-log')
      if (pv) pv.scrollTop = box._pvFollow ? pv.scrollHeight : pvTop
      if (log && logTop != null) log.scrollTop = box._chatFollow ? log.scrollHeight : logTop
    }
  }

  function renderBoard() {
    const saved = saveScrolls()
    stackEl.textContent = ''
    /* An empty board says it is empty: the drop target alone is invisible, so
       a bare pane would read as a rendering failure rather than as a
       projection with no records. The projection always supplies at least one
       card today (even "nothing on record" is a card); this is the honest
       floor under that assumption, not a state anything currently produces. */
    if (!W.stack.length) stackEl.appendChild(projectionNoticeEl('No conversation records to show.'))
    for (const entry of W.stack) stackEl.appendChild(renderNode(entry, true))
    stackEl.appendChild(stackDrop)
    applyMarks()
    applyWeights()
    restoreScrolls(saved)
  }

  function setProjectionFoot(lines) {
    railFoot.innerHTML = lines.map(line => `
      <span class="foot-line"><span class="ft">${esc(line)}</span></span>
    `).join('')
  }

  function projectionDetailCard(parent, kind, unavailable) {
    const detail = liveCard(`${parent.id}:source`, 'projection', `${kind} status`, `${kind} is kept as its own record; the app never guesses that a service on record and a channel seen running are the same thing.`, unavailable)
    parent.child = detail.id
    return detail
  }

  function applyLiveProjection(result) {
    if (destroyed) return
    const envelope = result.ok ? result.data : null
    if (!envelope?.data) {
      const reason = result.reason || 'the live comms data could not be read'
      const unavailable = liveCard('ops-projection', 'projection', 'live comms', 'This computer’s live comms data could not be read.', reason)
      W.convs = new Map([[unavailable.id, unavailable]])
      W.stack = [wbLeaf(unavailable.id)]
      W.open.clear()
      channelDefs = [{ id: unavailable.id, name: 'live comms', key: 'ops', mach: 'unavailable', topic: 'The live comms data could not be read.', unavailable: reason }]
      liveMessagesReason = reason
      root.dataset.projectionState = 'unavailable'
      root.dataset.projectionUnavailable = 'true'
      root.querySelector('.head-live').lastChild.textContent = 'unavailable'
      headMeta.textContent = 'live comms · could not be read'
      /* The watch-board line was left at its mount-time value, so a page whose
         every other readout says "could not be read" still claimed
         "message board · 1 conversations" -- counting the synthetic
         could-not-be-read card as a conversation. Same sentence as headMeta
         above, for the same reason. */
      wtMeta.textContent = 'message board · could not be read'
      countEl.textContent = '—'
      headCount.childNodes[1].textContent = ' record'
      setProjectionFoot([`the live comms data could not be read — ${reason}`])
      state.active = unavailable.id
      state.unread.clear()
      boxEls.clear()
      renderRail()
      railItems.get(state.active)?.classList.add('active')
      headName.textContent = unavailable.name
      renderLog(state.active)
      renderBoard()
      return
    }

    const { data } = envelope
    const services = data.declaredServices
    const observed = data.channels.ok ? data.channels.value : null
    const messages = data.messages
    liveMessagesReason = messages.ok ? null : messages.reason || 'the messages could not be read'
    const rawMessages = messages.ok ? messages.value : []
    const cards = []
    const defs = []
    const messageRows = (sourceId) => rawMessages
      .filter(message => message.channelId === sourceId)
      .map(message => ({ at: new Date(message.at).getTime(), s: 'observed', sender: message.sender, t: message.text }))

    for (const service of services) {
      const id = `declared:${service.id}`
      const card = liveCard(id, 'declared', service.displayName, `Service on record · ${service.transport} · :${service.port} · ${service.resolution}`, liveMessagesReason)
      card.hist = messageRows(service.id)
      cards.push(card, projectionDetailCard(card, 'This service on record', liveMessagesReason))
      defs.push({ id, sourceId: service.id, name: service.displayName, key: `declared/${service.id}`, mach: 'declared', topic: `Service on record · ${service.transport} · port ${service.port} · ${service.resolution}`, unavailable: liveMessagesReason })
      history[id] = card.hist
    }
    if (!services.length) {
      const id = 'declared:empty'
      const card = liveCard(id, 'projection', 'services on record', 'No services are on record for this computer.', liveMessagesReason)
      cards.push(card, projectionDetailCard(card, 'Services on record', liveMessagesReason))
      defs.push({ id, name: 'services on record', key: 'declared', mach: 'empty', topic: 'No services are on record for this computer.', unavailable: liveMessagesReason })
      history[id] = []
    }

    if (observed) {
      for (const item of observed) {
        const id = `observed:${item.id}`
        const detail = item.detail ? ` · ${item.detail}` : ''
        const card = liveCard(id, 'observed', item.name, `Channel seen running · ${item.state}${detail}`, liveMessagesReason)
        card.hist = messageRows(item.id)
        cards.push(card, projectionDetailCard(card, 'This channel seen running', liveMessagesReason))
        defs.push({ id, sourceId: item.id, name: item.name, key: `observed/${item.id}`, mach: item.state, topic: `Channel seen running · ${item.state}${detail}`, unavailable: liveMessagesReason, dividerBefore: defs.length > 0 && !defs.some(def => def.dividerBefore) })
        history[id] = card.hist
      }
    } else {
      const id = 'observed:unavailable'
      const reason = data.channels.reason || 'the channels seen running could not be read'
      const card = liveCard(id, 'projection', 'channels seen running', 'The channels seen running could not be read.', reason)
      cards.push(card, projectionDetailCard(card, 'Channels seen running', reason))
      defs.push({ id, name: 'channels seen running', key: 'observed', mach: 'unavailable', topic: 'The channels seen running could not be read.', unavailable: reason, dividerBefore: defs.length > 0 })
      history[id] = []
    }

    W.convs = new Map(cards.map(card => [card.id, card]))
    W.stack = cards.filter(card => !card.id.endsWith(':source')).map(card => wbLeaf(card.id))
    W.open.clear()
    channelDefs = defs
    state.active = channelDefs[0].id
    state.unread.clear()
    root.dataset.projectionState = liveMessagesReason ? 'partial-unavailable' : 'ready'
    if (liveMessagesReason) root.dataset.projectionUnavailable = 'messages'
    else delete root.dataset.projectionUnavailable
    root.querySelector('.head-live').lastChild.textContent = liveMessagesReason ? 'partial' : 'live'
    headMeta.textContent = `live comms · ${services.length} on record · ${observed ? observed.length : 'unreadable'} seen running`
    countEl.textContent = String(services.length)
    headCount.childNodes[1].textContent = ' declared'
    wtMeta.textContent = `live comms · ${services.length + (observed?.length || 0)} separate records`
    const mcpLine = data.mcp.ok
      ? `Tool links (MCP) · ${data.mcp.value.live.length} live · ${data.mcp.value.dead.length} dead`
      : `Tool links (MCP) could not be read — ${data.mcp.reason || 'no reason given'}`
    setProjectionFoot([
      `${services.length} services on record`,
      observed ? `${observed.length} channels seen running` : `channels seen running could not be read — ${data.channels.reason}`,
      mcpLine,
      liveMessagesReason ? `messages could not be read — ${liveMessagesReason}` : 'messages are being read',
    ])
    boxEls.clear()
    renderRail()
    railItems.get(state.active)?.classList.add('active')
    headName.textContent = channelDefs[0]?.name || ''
    renderLog(state.active)
    renderBoard()
    /* THE QUIET BOARD SAYS WHY IT IS QUIET, AND KEEPS ITS DOOR.
       On a payload that carries the live message reader, a fresh install
       reaches THIS branch -- the read works and answers zero rows -- so the
       host-absent notice above, which used to carry this screen's explanation
       and its guide link, never renders. Measured on the 2026-08-19 re-cut
       confirming run: the board said only "No services are on record for this
       computer. No messages have been seen for this exact channel." and was
       the one screen on the first-run ring without a door to the guide.
       The words are the copy module's (src/first-run-needs.js), the same
       place the host-absent words live, and the packaged driver reads the
       same module. Mount and removal are both here because this runs every
       few seconds: the notice must neither stack on itself nor outlive the
       first message it explained the absence of. It never shows while the
       read itself failed -- that state has its own honest sentence and this
       one would call a refused read a quiet one. */
    const quiet = !services.length && !liveMessagesReason && rawMessages.length === 0
    const quietEl = root.querySelector('[data-comms-quiet]')
    if (quiet && !quietEl) root.querySelector('.comms-body')?.appendChild(el(commsQuietMarkup()))
    else if (!quiet && quietEl) quietEl.remove()
  }

  /* FLIP the whole board through a structural change: measure every box,
     mutate the tree, re-render, then glide each box from where it was. */
  function flipBoard(mutate) {
    if (reduced()) { mutate(); renderBoard(); return }
    const first = new Map()
    for (const [cid, b] of boxEls) if (b.isConnected) first.set(cid, b.getBoundingClientRect())
    pane.classList.add('no-trans')
    mutate()
    renderBoard()
    for (const [cid, b] of boxEls) {
      if (!b.isConnected) continue
      const l = b.getBoundingClientRect()
      const f = first.get(cid)
      if (!f) {
        b.animate([{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'none' }], { duration: 340, easing: EASE })
        continue
      }
      const dx = f.left - l.left, dy = f.top - l.top
      const sx = f.width / Math.max(1, l.width), sy = f.height / Math.max(1, l.height)
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.02 && Math.abs(sy - 1) < 0.02) continue
      b.animate(
        [{ transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
         { transformOrigin: '0 0', transform: 'none' }],
        { duration: 460, easing: EASE },
      )
    }
    requestAnimationFrame(() => pane.classList.remove('no-trans'))
  }

  /* ----- branches: child conversation slides in beside its parent ----- */
  function toggleBranch(cid) {
    const d = W.convs.get(cid)
    if (!d.child) return
    const open = findBranchByParent(cid)
    if (open) {
      flipBoard(() => replaceNode(open, open.ch[0]))
      return
    }
    const L = findLeafByConv(cid)
    if (!L) return
    flipBoard(() => replaceNode(L, { t: 'split', dir: 'row', branch: true, ch: [L, wbLeaf(d.child)] }))
  }

  /* ----- drag-to-split tiling ----- */
  let drag = null
  function onBoxPointerDown(e, box) {
    if (e.button !== 0 || drag) return
    if (e.target.closest('.wb-btn, .chat-close, .chat-log, .chat-input, input, .wb-seg')) return
    const cid = box.dataset.conv
    const sx = e.clientX, sy = e.clientY
    let started = false
    let denied = false
    const move = (ev) => {
      if (started) { dragMove(ev); return }
      if (denied || Math.hypot(ev.clientX - sx, ev.clientY - sy) < 7) return
      const node = findDragNode(cid)
      if (!node) { denied = true; return }
      beginDrag(cid, node, box, ev)
      started = true
    }
    const up = (ev) => {
      if (started) endDrag(ev)
      else if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 7 &&
               !box.classList.contains('as-chat')) openChatBox(cid)
      cleanup()
    }
    const cancel = () => { if (started) abortDrag(); cleanup() }
    function cleanup() {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      dragTeardown = null
    }
    dragTeardown = () => { if (started) abortDrag(); cleanup() }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
  }

  function beginDrag(cid, node, box, ev) {
    const ghost = box.cloneNode(true)
    ghost.querySelector('.chat')?.remove()
    ghost.classList.remove('as-chat', 'dominant', 'lead', 'stack-leaf', 'in-split', 'branch-child', 'can-restack')
    ghost.classList.add('wb-ghost')
    const r = box.getBoundingClientRect()
    ghost.style.width = Math.min(r.width, 320) + 'px'
    ghost.style.height = Math.min(r.height, 180) + 'px'
    document.body.appendChild(ghost)
    const srcEl = node.t === 'leaf' ? box : node._el
    srcEl?.classList.add('drag-src')
    document.body.classList.add('wb-dragging')
    drag = { cid, node, box, srcEl, ghost, pending: null, lastDrop: null }
    dragMove(ev)
  }

  function dragMove(ev) {
    ev.preventDefault()
    const g = drag.ghost
    g.style.transform = `translate(${ev.clientX + 14}px, ${ev.clientY + 12}px)`
    if (drag.lastDrop) { drag.lastDrop.classList.remove('show'); drag.lastDrop = null }
    stackDrop.classList.remove('show')
    drag.pending = null

    const under = document.elementFromPoint(ev.clientX, ev.clientY)
    const tbox = under?.closest('.wb-box')
    if (tbox && tbox !== drag.box && tbox.closest('.watch-pane')) {
      const tnode = dropTargetNode(tbox.dataset.conv)
      if (tnode && tnode !== drag.node &&
          !subtreeHas(drag.node, tnode) && !subtreeHas(tnode, drag.node)) {
        const r = tbox.getBoundingClientRect()
        const dx = (ev.clientX - (r.left + r.width / 2)) / r.width
        const dy = (ev.clientY - (r.top + r.height / 2)) / r.height
        const half = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'top' : 'bottom')
        const overlay = tbox.querySelector('.wb-drop')
        overlay.dataset.half = half
        overlay.classList.add('show')
        drag.lastDrop = overlay
        drag.pending = { type: 'split', tnode, half }
        return
      }
    }
    if (under?.closest('.watch-pane')) {
      stackDrop.classList.add('show')
      drag.pending = { type: 'stack' }
    }
  }

  function endDrag() {
    const p = drag.pending
    settleGhost()
    if (p) {
      const node = drag.node
      flipBoard(() => {
        detach(node)
        if (p.type === 'split') {
          const dir = (p.half === 'left' || p.half === 'right') ? 'row' : 'col'
          const s = {
            t: 'split', dir,
            ch: (p.half === 'left' || p.half === 'top') ? [node, p.tnode] : [p.tnode, node],
          }
          replaceNode(p.tnode, s)
        } else {
          W.stack.push(node)
        }
      })
    }
    drag = null
  }
  function abortDrag() { settleGhost(); drag = null }
  function settleGhost() {
    const { ghost, srcEl, lastDrop } = drag
    lastDrop?.classList.remove('show')
    stackDrop.classList.remove('show')
    srcEl?.classList.remove('drag-src')
    document.body.classList.remove('wb-dragging')
    if (reduced()) { ghost.remove(); return }
    ghost.animate([{ opacity: 0.9 }, { opacity: 0 }], { duration: 150, easing: 'ease-out' })
      .finished.then(() => ghost.remove()).catch(() => ghost.remove())
  }

  /* ----- mode + size controls ----- */
  const modeBtns = [...root.querySelectorAll('.mode-seg button')]
  const sizeBtns = [...root.querySelectorAll('.size-seg button')]
  /* shared seg indicators (styles.css .seg / attachSeg). The size-seg is
     display:none in channels mode; the helper's ResizeObserver re-places its
     indicator on the frame it gets a box back. */
  root.querySelectorAll('.wb-seg').forEach(g => unsubs.push(attachSeg(g)))
  function setMode(m) {
    W.mode = m
    root.dataset.mode = m
    modeBtns.forEach(b => {
      const on = b.dataset.wmode === m
      b.classList.toggle('on', on)
      b.setAttribute('aria-pressed', String(on))   // which one is chosen is state, not paint
    })
    /* The sheet is display:none in watch mode, so the log has no height and
       renderLog's anchor scroll is a no-op — the view would open at the OLDEST
       message with the chip suppressed, then yank to the bottom on the next
       projection application. Re-anchor on the frame the sheet actually has a
       box. */
    if (m === 'channels') {
      requestAnimationFrame(() => {
        if (state.pinnedToBottom) logEl.scrollTop = logEl.scrollHeight
        else updateChip()
      })
    }
  }
  function setSize(s) {
    W.size = s
    pane.dataset.size = s
    sizeBtns.forEach(b => {
      const on = b.dataset.size === s
      b.classList.toggle('on', on)
      b.setAttribute('aria-pressed', String(on))
    })
    /* A size step changes every pane's height, and a followed pane that was
       pinned to its newest line ended up showing a hard mid-line cut at its
       BOTTOM until the next re-render happened to re-pin it (final-wave
       finding). Re-pin followed panes the frame after the new heights land —
       the same _pvFollow/_chatFollow contract restoreScrolls honours, invoked
       from the one mutation that was skipping it. A reader-scrolled pane
       (follow=false) is left exactly where they put it. */
    const repin = () => {
      pane.querySelectorAll('.wb-box').forEach((box) => {
        const pv = box.querySelector('.chip-preview')
        if (box._pvFollow && pv) pv.scrollTop = pv.scrollHeight
        const log = box.querySelector('.chat-log')
        if (box._chatFollow && log) log.scrollTop = log.scrollHeight
      })
    }
    /* twice, deliberately: the pane heights TRANSITION (0.45s), so the
       frame-after pin measures a mid-animation height — fine when growing
       (the gap only closes), wrong when shrinking (the gap keeps opening
       after the pin; measured 72-124px adrift on the S step). The second
       pass lands after the transition settles. */
    onNextFrame(repin)
    clearTimeout(setSize._repinTimer)
    setSize._repinTimer = setTimeout(repin, 520)
  }
  modeBtns.forEach(b => b.addEventListener('click', () => setMode(b.dataset.wmode)))
  sizeBtns.forEach(b => b.addEventListener('click', () => setSize(b.dataset.size)))
  setMode(W.mode)      // initial paint goes through the same path, aria included
  setSize(W.size)

  renderBoard()

  /* ---- initial channel ---- */
  railItems.get(state.active)?.classList.add('active')
  headName.textContent = defOf(state.active)?.name || ''
  renderLog(state.active)

  /* ---- the example marking, derived from the SOURCE, never from the data ----
     A badged source (mock — signed out, or the example toggle) must be
     unmistakable on the glass, and real data — local and relay alike — must
     carry no marking at all. The pass runs after EVERY projection application:
     applyLiveProjection writes the live face's words ("live comms · …", the
     word beside the dot), and on a badged source this corrects them in the
     same breath, so no application leaves example data wearing live words.
     data-live-mode / data-projection-state keep the vocabulary the simulated
     face used ('simulated') so the attribute means the same thing it always
     meant — this page is showing example data — while being derived from the
     one source axis instead of a per-view flag. The visible badge borrows the
     .integ-tag boxed-tag treatment (the page's one machine-token box style;
     this view's stylesheet is out of scope here) and says the same words
     home's example badge says, because one product labelling one state two
     ways teaches people to read neither. */
  const markDataSource = () => {
    const badged = sourceIsBadged(currentDataSource())
    root.dataset.liveMode = badged ? 'simulated' : 'live'
    const badge = root.querySelector('[data-example-badge]')
    if (!badged) { badge?.remove(); return }
    root.dataset.projectionState = 'simulated'
    root.querySelector('.head-live').lastChild.textContent = 'example'
    headMeta.textContent = headMeta.textContent.replace(/^live comms/, 'example comms')
    wtMeta.textContent = wtMeta.textContent.replace(/^live comms/, 'example comms')
    if (!badge) {
      root.querySelector('.comms-head .spacer').before(
        el(`<span class="integ-tag" data-example-badge="true">Example, not your data</span>`))
    }
  }

  {
    /* THE MESSAGE PANE, READ AT RUN TIME INSTEAD OF FROZEN AT BUILD TIME.
     *
     * THE OWNER'S FINDING: "i couldnt verify if the comms page is wired because
     * i couldnt get the agents to communicate." Both halves were real, and this
     * is the second one. Every readout on this page came from
     * public/data/ops.json, which tools/gen-ops.mjs writes on the machine that
     * CUTS THE RELEASE and which then lives inside the application archive.
     * A customer's agent messages do not exist when that runs, and the file
     * cannot be written afterwards -- it is inside the asar. So the message
     * pane could never have shown a message, however well the channel worked,
     * and no amount of work on the channel would have changed that. That is why
     * this needs a second source rather than a better generator.
     *
     * THE STATIC PROJECTION STAYS. Services on record, channels seen running
     * and the tool-link counts are genuinely build-time-and-CLI facts and are
     * still read exactly as before; only the messages are read live, and only
     * they are merged in below. Nothing that legitimately used ops.json lost it.
     *
     * DEGRADES BY SAYING SO. A build whose shell exposes no message reader --
     * an older payload, a window that is not the app -- takes the same path the
     * page already had for an unreadable source, and the pane says the messages
     * could not be read WITH the reason. It never shows an empty conversation
     * as though the agents had nothing to say. */
    const readLiveMessages = async () => {
      const bridge = typeof window !== 'undefined' ? window.mcAgent : null
      /* EVERY SENTENCE BELOW SAYS WHAT TO DO NEXT, and that is a standing bar
         rather than a nicety: a page whose failure text ends at the failure is
         what the owner filed as a finding in its own right. A person reading
         this pane wants to know whether their agents are silent or the page is,
         and each answer points at the one thing that would tell them. */
      if (!bridge || typeof bridge.localMessages !== 'function') {
        return { ok: false, reason: 'this copy of the program cannot read messages between agents yet — update it, and until then read each agent\'s own conversation on the Computers page' }
      }
      try {
        const answer = await bridge.localMessages({ limit: 200 })
        if (!answer || answer.ok !== true || !Array.isArray(answer.messages)) {
          return {
            ok: false,
            reason: (answer && answer.reason)
              || 'the program did not answer when asked for messages between agents. Start an agent from the tree; if this keeps saying so, restart the program.',
          }
        }
        return { ok: true, messages: answer.messages }
      } catch (error) {
        return {
          ok: false,
          reason: `messages between agents could not be read (${error?.message || error}) — this pane will try again on its own in a few seconds, and the Computers page still shows each agent's own conversation`,
        }
      }
    }

    /* The live messages are folded into the SAME envelope shape the projection
       already renders, so applyLiveProjection is unchanged: one code path draws
       the page whether the messages came from a file or from the fabric. */
    const LIVE_CHANNEL_ID = 'agent-tree'
    const withLiveMessages = (result, live) => {
      const envelope = result.ok ? result.data : null
      /* THE STATIC PROJECTION BEING UNREADABLE MUST NOT HIDE A LIVE
         CONVERSATION, and the first version of this let it.
         MEASURED on a driven two-node run: the agents talked, the shell handed
         over both messages, and the page still said "This computer's live comms
         data could not be read" -- because ops.json is UNAVAILABLE on any
         computer that is not the one that cut the release (it is written from a
         builder-side CLI), and an unavailable envelope short-circuits the whole
         page before the messages are looked at. That is the ordinary state of a
         customer's machine, so the failure would have been universal: the exact
         defect the owner filed, reappearing one layer up.
         The two sources are independent, so they fail independently. */
      if (!envelope?.data && !live.ok) return result
      const base = envelope?.data || {
        declaredServices: [],
        channels: { ok: true, reason: null, observedAt: null, value: [] },
        mcp: { ok: false, reason: result.reason || 'the services on record could not be read', observedAt: null, value: null },
        messages: { ok: false, reason: 'not read yet', observedAt: null, value: null },
      }
      const carrier = envelope || { domain: 'ops', ok: true, reason: null, generatedAt: new Date().toISOString() }
      const data = { ...base }
      if (!live.ok) {
        data.messages = { ok: false, reason: live.reason, observedAt: null, value: null }
        return { ok: true, data: { ...carrier, ok: true, data } }
      }
      data.messages = {
        ok: true,
        reason: null,
        observedAt: new Date().toISOString(),
        value: live.messages.map(message => ({ ...message, channelId: LIVE_CHANNEL_ID })),
      }
      /* A message needs a channel to land in -- messageRows() above filters by
         id -- and the agents on this computer are not a declared service and
         not something the preflight CLI can see. They are their own channel. */
      const channels = data.channels.ok && Array.isArray(data.channels.value) ? [...data.channels.value] : []
      if (!channels.some(channel => channel.id === LIVE_CHANNEL_ID)) {
        channels.push({
          id: LIVE_CHANNEL_ID,
          name: 'agents on this computer',
          state: 'healthy',
          observedAt: new Date().toISOString(),
          detail: `${live.messages.length} message${live.messages.length === 1 ? '' : 's'} between agents on this computer's tree`,
        })
      }
      data.channels = { ok: true, reason: null, observedAt: new Date().toISOString(), value: channels }
      return { ok: true, data: { ...carrier, ok: true, data } }
    }

    /* Every application goes through this pair, so the example marking can
       never lag the data it marks. */
    const paintProjection = (result) => {
      applyLiveProjection(result)
      markDataSource()
    }

    const loadLive = () => Promise.all([fetchOps(), readLiveMessages()])
      .then(([ops, live]) => { if (!destroyed) paintProjection(withLiveMessages(ops, live)) })
      .catch((err) => {
        if (!destroyed) paintProjection({ ok: false, reason: `ops projection request failed: ${err?.message || err}` })
      })

    /* WHERE THE ENVELOPE COMES FROM is resolved in the load path, not at
       mount: on a public origin the relay-versus-mock answer needs the host
       asked for its transport, which is async (src/data-source.js). Real
       sources take the live loader above, exactly as before. A mock source
       wraps the example fleet's envelope (src/sample-comms.js) in the same
       one-sentence carrier withLiveMessages synthesizes for a machine with no
       ops.json, and feeds it through the SAME applyLiveProjection — the
       render cannot tell, which is the owner's ruling made structural: the
       example pages ARE the product pages, only the data is mock.

       THE MOCK PATH NEVER TOUCHES THE BRIDGE AND NEVER POLLS. There is no
       process behind the example fleet, so asking mcAgent for its messages
       would be a claim that one exists; and the envelope is a pure function
       of its clock, so a 4-second poll would only rebuild the same board —
       the deterministic demonstration reads still, the way a screenshot of it
       would. A source change (sign-in, sign-out, the example toggle)
       re-resolves below instead. */
    let liveTimer = 0
    const stopLivePoll = () => { if (liveTimer) { clearInterval(liveTimer); liveTimer = 0 } }
    const loadForSource = async ({ reask = false } = {}) => {
      let source
      try {
        source = await resolveDataSource({ reask })
      } catch (err) {
        /* A resolution that failed is not a machine with no host and not the
           example: the pane says the read failed, with the reason, through
           the same unavailable branch every other failed read uses. */
        if (!destroyed) paintProjection({ ok: false, reason: `the data source could not be resolved (${err?.message || err})` })
        return
      }
      if (destroyed) return
      if (source === 'mock') {
        stopLivePoll()
        paintProjection({
          ok: true,
          data: { domain: 'ops', ok: true, reason: null, generatedAt: new Date().toISOString(), data: sampleOpsEnvelope(Date.now()) },
        })
        return
      }
      /* A CONVERSATION IS NOT A SNAPSHOT. The page was fetch-once, which is
         correct for a file that never changes and wrong for the thing the
         owner wanted to watch. The interval is cleared by destroy() through
         the same unsubscribe list every other subscription on this page uses,
         and by the mock branch above when the source flips mid-session. */
      if (!liveTimer) liveTimer = setInterval(loadLive, 4000)
      loadLive()
    }

    loadForSource()
    /* The host says "the world changed" (sign-in, sign-out, the example
       toggle); the event deliberately carries no verdict, so this re-asks —
       reask because a transport may have just appeared — and re-renders from
       whatever source resolves now. */
    const onSourceChanged = () => { void loadForSource({ reask: true }) }
    window.addEventListener(DATA_SOURCE_EVENT, onSourceChanged)
    unsubs.push(() => window.removeEventListener(DATA_SOURCE_EVENT, onSourceChanged))
    unsubs.push(stopLivePoll)
  }

  return {
    el: root,
    destroy() {
      destroyed = true
      dragTeardown?.()
      timers.forEach(clearTimeout)
      clearTimeout(setSize._repinTimer)
      unsubs.forEach(fn => fn())
    },
  }
}
