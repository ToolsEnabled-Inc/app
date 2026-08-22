// /comms — Agent comms: the messages your agents send each other, channel by
// channel, and which services and channels exist on this computer.
//
// WHAT THIS PAGE IS, SAID ONCE. It had six names (two board names, one
// projection name, the mode labels, the class families, the route) and
// was an infrastructure inventory welded to a message log: every service and
// every channel got a tile, a rail row, a detail card and a header count, and
// one read failure was stamped into all of them. The owner's finding was that
// nobody could say what the page was for. Now the title says its name, the
// line under it says the inventory once, the tiles and the channel list are
// CHANNELS only, services are listed by name in the rail and nowhere else, and
// one failure is one notice under the header. The words are all in
// src/comms-copy.js so a plain node run can measure the whole panel per state.
//
// ONE RENDER PATH, THREE DATA SOURCES. The owner's ruling collapsed the old
// simulated render: "all simulated pages ARE the UI pages, just mock data."
// applyLiveProjection below is the only code that draws the page, and
// src/data-source.js answers the one question left: where the report it
// renders comes from. 'local' and 'relay' read this machine (or the tunnelled
// one); 'mock' feeds src/sample-comms.js's example report through the SAME
// function, so a mock-only render bug is impossible because there is no
// mock-only render. The mock face is badged, because the badge follows the
// SOURCE, never the look of the data.
//
// THE BOARD is a stack of channel tiles built from the shared chip component
// (.chip / .chip-preview / .as-chat from styles.css) that drag-splits into
// nested tiles; an expanded tile is a header and a log, nothing else -- there
// is no composer on this page because nothing here can send (the old expanded
// tile borrowed the shared composer, which seeded two canned lines into every
// tile and printed a not-connected refusal on live data).
//
// MESSAGES BETWEEN AGENTS are the one thing on this page that is an
// integration: the messaging the agents do with EACH OTHER over this product's
// own channel (agent_comms.send_local / agent_comms.read). No third-party
// messaging service is named on this page, by the owner's ruling.

import { el, attachSeg, openMemory, ownDisclosure } from '../components.js'
import { onNextFrame } from '../page-frames.js'
import { resolveDataSource, currentDataSource, sourceIsBadged, DATA_SOURCE_EVENT } from '../data-source.js'
import { sampleOpsEnvelope } from '../sample-comms.js'
import { fetchOps } from '../live-status.js'
/* The shared empty-state notices — the host-absent one when the whole read
   failed, the quiet one when the read worked and found nothing. Both are the
   copy module's words; tools/first-run-recovery-qa.mjs reads them off the
   glass. src/guide.css carries the placements this page needs. */
import { commsQuietMarkup, hostAbsentMarkup } from '../first-run-needs.js'
import {
  COMMS_NAME, MODE_LABELS, RAIL_GROUPS, NO_SERVICES, EXAMPLE_BADGE,
  LOADING_LINE, UNREADABLE_SUB, readStateWord,
  inventoryLine, describe, serviceLine, emptyLine, boardEmptyLine,
  READER_REFUSALS, LOAD_FAILED,
  shouldFold, foldSummary, senderHues, rowModel, dayLabel, sameDay,
  NO_ANSWER_YET, toRecipient,
} from '../comms-copy.js'
import '../comms.css'

const pad2 = (n) => String(n).padStart(2, '0')
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
/* Hours and minutes. Seconds were dropped: on a page read by a person, a
   stamp to the second is precision nobody uses and a column that never lines
   up, and the same stamp sits on three surfaces. */
const fmtTime = (at) => { const d = new Date(at); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}` }

/* Board layout tree: { t:'leaf', c:convId } | { t:'split', dir, ch:[a,b] }.
   Module-level so the whole board — tiling, sizes, open tiles — persists
   across in-session navigation. */
const wbLeaf = (c) => ({ t: 'leaf', c })

/* A conversation record: one CHANNEL. `hist` is the channel's messages in
   report order (oldest first), `hues` the sender → colour map by first
   appearance, `desc` the one describe() sentence the tile and the topic bar
   share, `pending` the loading card's mark. */
let LIVE_WATCH = null
const channelCard = (id, name, desc, hist = [], extra = {}) => ({ id, name, desc, hist, hues: senderHues(hist), byId: new Map(hist.map(m => [m.id, m])), ...extra })

/* The sentinel the loading card carries. Two places set it and one place has
   to recognise it: a read that has not answered yet is not a machine with no
   agent host, and the two states must not print the same notice. */
const LIVE_COMMS_LOADING = LOADING_LINE

function liveWatchInit() {
  if (LIVE_WATCH) return LIVE_WATCH
  const pending = channelCard('pending', 'messages', LIVE_COMMS_LOADING, [], { pending: true })
  LIVE_WATCH = {
    convs: new Map([[pending.id, pending]]),
    stack: [wbLeaf(pending.id)],
    size: 'm',
    mode: 'watch',
    open: new Set(),
  }
  return LIVE_WATCH
}

/* WHICH FOLDS A PERSON HAS OPENED, remembered per message id, through the same
   memory the chat's context block and the home screen's run rows use
   (components.js openMemory) -- one rule, three pages, one prefix each. */
const foldOpen = openMemory('mc.comms.fold:')

/* ---------- DOM builders ---------- */

const noteEl = (text) => el(`<div class="projection-state" data-projection-state="true">${esc(text)}</div>`)

/* THE FOLD. A long message (comms-copy.js shouldFold) renders as a
   <details> whose closed line says what is inside and how much of it there
   is, opened by a press anywhere on it. The gesture is owned (components.js
   ownDisclosure) for the reason makeAction documents at length: on a staged
   packaged build elementFromPoint over a collapsed row answers the DETAILS,
   so a press beside the disclosure triangle is not a press on it and nothing
   opens; Enter or Space on the focused summary fire the same click. The
   classes are the chat's (.chat-context, .chat-context-head, .chat-context-
   body), so the styles come free from styles.css and the three pages fold the
   same way. */
function foldEl(model) {
  const wrap = el(`
    <details class="context chat-context">
      <summary class="chat-context-head">
        <span class="chat-action-mark" aria-hidden="true"><svg viewBox="0 0 8 8"><path d="M2.6 1.4 5.4 4 2.6 6.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        <span class="chat-context-line"><span class="chat-context-say"></span></span>
      </summary>
      <div class="chat-context-body cmsg-text"></div>
    </details>
  `)
  wrap.querySelector('.chat-context-say').textContent = foldSummary(model.text)
  wrap.querySelector('.chat-context-body').textContent = model.text
  wrap.open = foldOpen.recall(model.id) === 'open'
  /* `within` the summary: a press on the closed row (which elementFromPoint
     answers as the details) or on the summary toggles; a press inside the open
     body, where a person selects and copies the text, is left alone. */
  ownDisclosure(wrap, { within: wrap.querySelector('summary'), onToggle: (open) => foldOpen.remember(model.id, open) })
  return wrap
}
function bodyEl(model) {
  if (shouldFold(model.text)) return foldEl(model)
  const body = el('<div class="cmsg-text"></div>')
  body.textContent = model.text
  return body
}

/* THE MESSAGE ROW, one model for three surfaces. Line 1 is the sender (UI
   face, hue by first appearance in the channel), then only what the message
   actually carries: "→ recipient" when addressed, "asked"/"answered" when the
   kind says so (a notice prints no tag -- the old constant "observed" on every
   row told the reader nothing), "replying to {name}" when the parent is in
   this channel (a press scrolls to it), "no answer yet" on an ask nothing
   answered, the machine tag when present, and the time. Line 2 is the body,
   folded when long. No delivery column: delivery states live in an in-memory
   map per call in the engine (delivery.js) and can never reach this view. */
function rowEl(model, surface, hues) {
  const hue = hues.get(model.sender) || ''
  const style = hue ? ` style="--rc:${hue}"` : ''
  if (surface === 'cl') {
    const row = el(`<div class="cl"${style}><b></b><span></span></div>`)
    row.querySelector('b').textContent = model.sender
    row.querySelector('span').appendChild(bodyEl(model))
    return row
  }
  if (surface === 'msg') {
    const row = el(`<div class="msg them"${style} data-msg-id="${esc(model.id)}"><span class="who"></span></div>`)
    const who = [model.sender, model.recipient ? toRecipient(model.recipient) : '', model.tag].filter(Boolean).join(' · ')
    row.querySelector('.who').textContent = who
    row.appendChild(bodyEl(model))
    return row
  }
  const row = el(`
    <div class="cmsg"${style} data-msg-id="${esc(model.id)}">
      <i class="cmsg-bar"></i>
      <div class="cmsg-main">
        <div class="cmsg-top">
          <span class="cmsg-au"></span>
          ${model.recipient ? `<span class="cmsg-to">${esc(toRecipient(model.recipient))}</span>` : ''}
          ${model.tag ? `<span class="cmsg-kind">${esc(model.tag)}</span>` : ''}
          ${model.replyTo ? `<button type="button" class="cmsg-reply" data-reply-to="${esc(model.parentId)}">${esc(model.replyTo)}</button>` : ''}
          ${model.noAnswer ? `<span class="cmsg-kind">${esc(NO_ANSWER_YET)}</span>` : ''}
          ${model.machine ? `<span class="cmsg-machine">${esc(model.machine)}</span>` : ''}
          <span class="cmsg-time">${fmtTime(model.at)}</span>
        </div>
      </div>
    </div>
  `)
  row.querySelector('.cmsg-au').textContent = model.sender
  row.querySelector('.cmsg-main').appendChild(bodyEl(model))
  return row
}

/* Fill a surface with a channel's rows: the day dividers (log only), the rows,
   and the one empty line when there are none. `seen` is the set of ids the
   previous paint drew; a row absent from it plays .fresh once. */
function fillRows(target, card, surface, { limit = Infinity, seen = null, now = Date.now(), quiet = false } = {}) {
  target.textContent = ''
  if (card.pending) return
  const rows = limit === Infinity ? card.hist : card.hist.slice(-limit)
  if (!rows.length) {
    if (!quiet) target.appendChild(noteEl(emptyLine()))
    return
  }
  let lastAt = null
  for (const message of rows) {
    const model = rowModel(message, card.byId)
    if (surface === 'cmsg' && (lastAt === null || !sameDay(lastAt, model.at))) {
      target.appendChild(el(`<div class="day-div"><span>${esc(dayLabel(model.at, now))}</span></div>`))
    }
    lastAt = model.at
    const row = rowEl(model, surface, card.hues)
    if (seen && surface === 'cmsg' && !seen.has(model.id)) row.classList.add('fresh')
    target.appendChild(row)
  }
}

export function commsView() {
  /* data-live-mode / data-projection-state keep their old vocabulary — other
     surfaces and the QA drivers read these attributes (offline-routes-qa,
     walk-and-look) — but the value is DERIVED from the data source once it
     resolves (markDataSource below): 'simulated' is what a badged mock source
     wears, 'live' is real data. The mount stamps the loading state; nothing
     claims a source before one is resolved. */
  const W = liveWatchInit()
  const root = el(`
    <div class="comms" data-mode="${W.mode}" data-live-mode="live" data-projection-state="loading">
      <header class="comms-head">
        <h1 class="head-title">${esc(COMMS_NAME)}</h1>
        <p class="head-sub"></p>
        <span class="spacer"></span>
        <div class="seg wb-seg mode-seg" role="group" aria-label="Comms mode">
          <button type="button" data-wmode="watch">${esc(MODE_LABELS.watch)}</button>
          <button type="button" data-wmode="channels">${esc(MODE_LABELS.channels)}</button>
        </div>
        <div class="seg wb-seg size-seg" role="group" aria-label="Tile size">
          <button type="button" data-size="s" title="Small tiles">S</button>
          <button type="button" data-size="m" title="Medium tiles">M</button>
          <button type="button" data-size="l" title="Large tiles">L</button>
        </div>
        <span class="head-live"><i></i>${esc(readStateWord('loading'))}</span>
      </header>
      <div class="comms-card glass">
        <div class="comms-body">
          <div class="watch-pane" data-size="${W.size}">
            <div class="watch-stack"></div>
          </div>
          <section class="comms-sheet">
            <aside class="ch-rail">
              <div class="ch-group-label">${esc(RAIL_GROUPS.services)}</div>
              <div class="ch-services"></div>
              <div class="ch-group-label">${esc(RAIL_GROUPS.channels)}</div>
              <div class="ch-list"></div>
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
            </section>
          </section>
        </div>
      </div>
    </div>
  `)

  /* ---- state ---- */
  let destroyed = false
  const state = {
    active: W.stack.length ? W.stack[0].c : null,
    pinnedToBottom: true,
    newCount: 0,
    /* Message ids drawn by the previous paint of the log, so a row that just
       arrived plays .fresh once and older rows never do. */
    seen: new Set(),
  }
  const timers = []

  const headEl = root.querySelector('.comms-head')
  const subEl = root.querySelector('.head-sub')
  const liveEl = root.querySelector('.head-live')
  const servicesEl = root.querySelector('.ch-services')
  const listEl = root.querySelector('.ch-list')
  const viewEl = root.querySelector('.ch-view')
  const topicEl = root.querySelector('.ch-topic')
  const logEl = root.querySelector('.ch-log')
  const chip = root.querySelector('.jump-chip')
  const chipLabel = chip.querySelector('.jl')
  const reduced = () => document.body.classList.contains('reduce-motion')
  const setLiveWord = (stateName) => { liveEl.lastChild.textContent = readStateWord(stateName) }

  /* THE ONE NOTICE. Created in exactly one place and removed in exactly one
     place: a message-read failure, or the host-absent explanation when the
     whole read failed. It sits under the header, above the card, and nothing
     inside the card repeats it -- the N+1 copies (every tile, the topic bar,
     the rail foot) were the defect. */
  const setNotice = (html) => {
    const old = root.querySelector('[data-comms-notice]')
    if (!html) { old?.remove(); return }
    const node = el(`<div class="comms-notice" data-comms-notice="true">${html}</div>`)
    if (old) old.replaceWith(node)
    else headEl.after(node)
  }

  /* ---- channel rail ---- */
  const railItems = new Map()
  function renderRail(services) {
    servicesEl.textContent = ''
    /* null = nothing is known yet (loading, or the whole read failed): no
       claim either way. An empty array is an answer and says so. */
    if (Array.isArray(services) && !services.length) servicesEl.appendChild(el(`<div class="ch-service" data-empty="true">${esc(NO_SERVICES)}</div>`))
    for (const service of services || []) {
      const row = el('<div class="ch-service"></div>')
      row.textContent = serviceLine(service)
      servicesEl.appendChild(row)
    }
    listEl.textContent = ''
    railItems.clear()
    for (const card of W.convs.values()) {
      const item = el(`
        <button type="button" class="ch" data-id="${esc(card.id)}">
          <span class="ch-hash">#</span>
          <span class="ch-name"></span>
        </button>
      `)
      item.querySelector('.ch-name').textContent = card.name
      item.addEventListener('click', () => switchChannel(card.id))
      listEl.appendChild(item)
      railItems.set(card.id, item)
    }
    railItems.get(state.active)?.classList.add('active')
  }

  /* ---- timeline rendering ---- */
  /* When the notice above the card already explains why every channel is
     empty (a refused message read, or the quiet board), the per-channel and
     per-board empty lines stay off: the notice is the sentence, and the same
     fact twice on one screen is the defect this page was cleared of. */
  let emptyHidden = false
  function renderLog(id) {
    const card = W.convs.get(id)
    if (!card) { topicEl.textContent = ''; logEl.textContent = ''; return }
    topicEl.textContent = card.desc
    const wasPinned = state.pinnedToBottom
    const before = state.seen
    fillRows(logEl, card, 'cmsg', { seen: before.size ? before : null, quiet: emptyHidden })
    const fresh = logEl.querySelectorAll('.cmsg.fresh').length
    state.seen = new Set(card.hist.map(m => m.id))
    if (wasPinned) {
      state.newCount = 0
      /* PIN AFTER LAYOUT, NOT AFTER A FRAME THAT MAY NEVER COME. A covered
         window gets no frames, so this callback -- and the log it closed
         over -- stayed in the browser's queue for ever (measured: +2 per lap
         of the ring at this site). onNextFrame flushes layout and pins now on
         such a page, and is the ordinary requestAnimationFrame otherwise. */
      onNextFrame(() => { logEl.scrollTop = logEl.scrollHeight })
    } else if (before.size) {
      state.newCount += fresh
    }
    updateChip()
  }

  /* "replying to {name}" scrolls the parent row into view and plays its
     arrival light again, so the eye lands on the thing being answered. */
  logEl.addEventListener('click', (event) => {
    const button = event.target.closest('[data-reply-to]')
    if (!button) return
    /* Found by comparing the attribute, not by building a selector: the id
       is data off the wire, and the one way to put data into a selector safely
       is CSS.escape, which the unbound-identifier gate cannot see as a browser
       global. A loop over the rows costs nothing at this size. */
    const wanted = button.dataset.replyTo
    const parent = [...logEl.querySelectorAll('[data-msg-id]')].find((row) => row.dataset.msgId === wanted) || null
    if (!parent) return
    parent.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' })
    parent.classList.remove('fresh')
    void parent.offsetWidth
    parent.classList.add('fresh')
  })

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
    state.seen = new Set()
    state.pinnedToBottom = true
    railItems.forEach((item, cid) => item.classList.toggle('active', cid === id))
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

  /* Everything that needs undoing at teardown — event listeners, the seg
     helpers, the poll — goes through this one list. */
  const unsubs = []

  /* ==========================================================
     THE BOARD. Every tile is the shared context-box chip
     (.chip / .chip-preview / .as-chat) laid out as a vertical
     stack that drag-splits into nested tiles.
     ========================================================== */
  const pane = root.querySelector('.watch-pane')
  const stackEl = root.querySelector('.watch-stack')
  const stackDrop = el(`<div class="wb-stackdrop"></div>`)
  const EASE = 'cubic-bezier(0.22, 0.9, 0.26, 1)'
  const boxEls = new Map()            // convId -> chip element (this mount)
  let dragTeardown = null
  { const esc = (ev) => { if (ev.key === 'Escape' && drag) dragTeardown?.() }; window.addEventListener('keydown', esc); unsubs.push(() => window.removeEventListener('keydown', esc)) } // audit #27: Escape aborts an in-flight tile drag through the SAME teardown destroy() uses (abortDrag + listener cleanup); guarded on `drag` so a stray Escape outside a drag is a no-op

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
  /* the draggable unit for a tile is its own leaf; tiles weigh equally, so
     there is no pairing that drags as one and no dominant side (a tie crowns
     nobody) */
  const findDragNode = (cid) => findLeafByConv(cid)
  const dropTargetNode = findDragNode

  /* ----- tile construction (the reused chip component) ----- */
  function fillPreview(box, card) {
    const pv = box.querySelector('.chip-preview')
    fillRows(pv, card, 'cl', { limit: 14, quiet: emptyHidden })
    onNextFrame(() => { if (box._pvFollow) pv.scrollTop = pv.scrollHeight })
  }

  function boxOf(cid) {
    let box = boxEls.get(cid)
    if (box) return box
    const d = W.convs.get(cid)
    box = el(`
      <div class="chip wb-box" data-conv="${esc(cid)}">
        <div class="wb-head">
          <span class="wb-hash">#</span><span class="wb-name"></span>
          <span class="wb-state"></span>
          <span class="spacer"></span>
          <button type="button" class="wb-btn wb-restack" title="Return to stack">
            <svg viewBox="0 0 24 24"><path d="M5 7h14M5 12h8M5 17h8" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M17.5 17.5v-6m0 0L15 14m2.5-2.5L20 14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
        <div class="wb-desc"></div>
        <div class="chip-preview"></div>
        <div class="wb-drop"><i></i></div>
      </div>
    `)
    box.querySelector('.wb-name').textContent = d.name
    box.querySelector('.wb-state').textContent = d.pending ? '' : `${d.hist.length} message${d.hist.length === 1 ? '' : 's'}`
    box.querySelector('.wb-desc').textContent = d.desc
    box._pvFollow = true
    box._chatFollow = true
    fillPreview(box, d)
    const pv = box.querySelector('.chip-preview')
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
    box.querySelector('.wb-restack').addEventListener('click', (e) => {
      e.stopPropagation()
      const node = findDragNode(cid)
      if (!node) return
      const loc = locate(node)
      if (!loc || !loc.parentSplit) return
      flipBoard(() => { detach(node); W.stack.push(node) })
    })
    box.addEventListener('pointerdown', (e) => onBoxPointerDown(e, box))

    boxEls.set(cid, box)
    if (W.open.has(cid)) openChatBox(cid, true)
    return box
  }

  /* A poll that changed nothing structural repaints each tile's words in
     place: the preview, the count, the open log. The stack, the splits, the
     open set and every fold a person has opened survive the 4-second read. */
  function refreshBoxes() {
    for (const [cid, box] of boxEls) {
      const d = W.convs.get(cid)
      if (!d || !box.isConnected) continue
      box.querySelector('.wb-state').textContent = d.pending ? '' : `${d.hist.length} message${d.hist.length === 1 ? '' : 's'}`
      box.querySelector('.wb-desc').textContent = d.desc
      fillPreview(box, d)
      const log = box.querySelector('.chat-log')
      if (log) {
        fillRows(log, d, 'msg', { quiet: emptyHidden })
        if (box._chatFollow) log.scrollTop = log.scrollHeight
      }
    }
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
    /* A HEADER AND A LOG, NOTHING ELSE. styles.css keys the expanded surface on
       `.chip.as-chat .chat`, so the local markup reuses the chat's own head and
       log classes and leaves out the composer: nothing on this page can send,
       and the shared composer, handed no sender, seeded canned lines and
       printed a refusal into every tile. */
    const chat = el(`
      <div class="chat">
        <div class="chat-head">
          <span class="t"></span><span class="s"></span>
          <span class="spacer"></span>
          <button type="button" class="chat-close" title="Close" aria-label="Close">
            <svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="chat-log"></div>
      </div>
    `)
    chat.querySelector('.t').textContent = d.name
    chat.querySelector('.s').textContent = d.desc
    chat.querySelector('.chat-close').addEventListener('click', (e) => { e.stopPropagation(); closeChatBox(cid) })
    box.appendChild(chat)
    const log = chat.querySelector('.chat-log')
    fillRows(log, d, 'msg', { quiet: emptyHidden })
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
      box.classList.remove('stack-leaf')
      box.style.height = ''
      cell.appendChild(box)
      node._el = cell
      return cell
    }
    const s = el(`<div class="wb-split ${node.dir}${top ? ' top-split' : ''}"></div>`)
    s.append(renderNode(node.ch[0], false), renderNode(node.ch[1], false))
    node._el = s
    return s
  }

  function applyMarks() {
    for (const [cid, box] of boxEls) {
      box.classList.remove('can-restack')
      if (!box.isConnected) continue
      const node = findDragNode(cid)
      if (node) {
        const loc = locate(node)
        if (loc && loc.parentSplit) box.classList.add('can-restack')
      }
    }
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
       a bare pane would read as a rendering failure rather than as a report
       with no channels. */
    if (!W.stack.length && !emptyHidden && root.dataset.projectionState !== 'unavailable') stackEl.appendChild(noteEl(boardEmptyLine()))
    for (const entry of W.stack) stackEl.appendChild(renderNode(entry, true))
    stackEl.appendChild(stackDrop)
    applyMarks()
    restoreScrolls(saved)
  }

  /* ---- the quiet notice: mount and removal in one place ----
     THE QUIET BOARD SAYS WHY IT IS QUIET, AND KEEPS ITS DOOR. On a build whose
     shell carries the live message reader, a fresh install reaches the ready
     branch -- the read works and answers zero rows -- so the host-absent
     notice never renders. Measured on the 2026-08-19 re-cut confirming run:
     the board said only "No services are on record for this computer. No
     messages have been seen for this exact channel." and was the one screen on
     the first-run ring without a door to the guide. The words are the copy
     module's (src/first-run-needs.js); the packaged driver reads the same
     module. It never shows while the read itself failed -- that state has its
     own honest sentence and this one would call a refused read a quiet one. */
  function setQuiet(quiet) {
    const quietEl = root.querySelector('[data-comms-quiet]')
    if (quiet && !quietEl) root.querySelector('.comms-body')?.appendChild(el(commsQuietMarkup()))
    else if (!quiet && quietEl) quietEl.remove()
  }

  /* Replace the board's channels. When the set of channel ids is unchanged the
     layout survives (splits, open tiles, scroll, folds) and only the words are
     repainted; otherwise the stack is rebuilt from the new list. */
  function setChannels(cards) {
    const next = new Map(cards.map(card => [card.id, card]))
    const same = next.size === W.convs.size && [...next.keys()].every(id => W.convs.has(id))
    W.convs = next
    if (same) {
      refreshBoxes()
      return
    }
    W.stack = cards.map(card => wbLeaf(card.id))
    W.open.clear()
    boxEls.clear()
    state.active = cards[0]?.id || null
    state.seen = new Set()
    state.pinnedToBottom = true
    renderBoard()
  }

  function applyLiveProjection(result) {
    if (destroyed) return
    const envelope = result.ok ? result.data : null
    if (!envelope?.data) {
      /* THE WHOLE READ FAILED. No tiles, no rail rows, one notice holding the
         host-absent explanation (with its guide door), the word by the dot
         says so, and the line under the title carries NO count. */
      const reason = result.reason || LOAD_FAILED('no reason given')
      root.dataset.projectionState = 'unavailable'
      root.dataset.projectionUnavailable = 'true'
      setLiveWord('unavailable')
      subEl.textContent = UNREADABLE_SUB
      setNotice(hostAbsentMarkup(reason, { compact: true }))
      emptyHidden = true
      setQuiet(false)
      setChannels([])
      renderRail(null)
      renderLog(null)
      return
    }

    const { data } = envelope
    const services = Array.isArray(data.declaredServices) ? data.declaredServices : []
    const observed = data.channels?.ok && Array.isArray(data.channels.value) ? data.channels.value : []
    const messages = data.messages
    const messagesReason = messages?.ok ? null : (messages?.reason || READER_REFUSALS.NO_ANSWER)
    const rawMessages = messages?.ok && Array.isArray(messages.value) ? messages.value : []

    /* TILES ARE CHANNELS. A service on record is not a place a message lands;
       it is listed by name in the rail and nowhere else. */
    const cards = observed.map((item) => channelCard(
      item.id,
      item.name || item.id,
      describe(item),
      rawMessages.filter(message => message.channelId === item.id),
    ))

    root.dataset.projectionState = messagesReason ? 'partial-unavailable' : 'ready'
    if (messagesReason) root.dataset.projectionUnavailable = 'messages'
    else delete root.dataset.projectionUnavailable
    setLiveWord(messagesReason ? 'partial-unavailable' : 'ready')
    subEl.textContent = inventoryLine(data)
    /* One refusal, once, above the card. Inside the card the tiles and the log
       show no sentence for it -- the notice is the sentence. */
    setNotice(messagesReason ? `<p class="comms-notice-body">${esc(messagesReason)}</p>` : '')
    const quiet = !services.length && !messagesReason && rawMessages.length === 0
    emptyHidden = Boolean(messagesReason) || quiet
    setQuiet(quiet)
    setChannels(cards)
    renderRail(services)
    renderLog(state.active)
  }

  /* FLIP the whole board through a structural change: measure every tile,
     mutate the tree, re-render, then glide each tile from where it was. */
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

  /* ----- drag-to-split tiling ----- */
  let drag = null
  function onBoxPointerDown(e, box) {
    if (e.button !== 0 || drag) return
    if (e.target.closest('.wb-btn, .chat-close, .chat-log, .chat-context, .wb-seg')) return
    /* NARROW SCREENS DO NOT DRAG. Under 720px the sheet stacks and the tiles
       are full width, so there is no half to split into, and a pointer drag
       on a touch screen is the scroll gesture (the stylesheet sets touch-action
       pan-y to match). A press still opens the tile. */
    const narrow = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 720px)').matches
    const cid = box.dataset.conv
    const sx = e.clientX, sy = e.clientY
    let started = false
    let denied = narrow
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
    ghost.classList.remove('as-chat', 'stack-leaf', 'in-split', 'can-restack')
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
    /* The sheet is display:none in board mode, so the log has no height and
       renderLog's anchor scroll is a no-op — the view would open at the OLDEST
       message with the chip suppressed, then yank to the bottom on the next
       read. Re-anchor on the frame the sheet actually has a box. */
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
  renderRail(null)
  renderLog(state.active)

  /* ---- the example marking, derived from the SOURCE, never from the data ----
     A badged source (mock — signed out, or the example toggle) must be
     unmistakable on the glass, and real data — local and relay alike — must
     carry no marking at all. The pass runs after EVERY application:
     applyLiveProjection writes the live face's word beside the dot, and on a
     badged source this corrects it in the same breath, so no application
     leaves example data wearing live words. data-live-mode /
     data-projection-state keep the vocabulary the simulated face used
     ('simulated') so the attribute means the same thing it always meant. The
     badge says the same words home's example badge says, because one product
     labelling one state two ways teaches people to read neither. */
  const markDataSource = () => {
    const badged = sourceIsBadged(currentDataSource())
    root.dataset.liveMode = badged ? 'simulated' : 'live'
    const badge = root.querySelector('[data-example-badge]')
    if (!badged) { badge?.remove(); return }
    root.dataset.projectionState = 'simulated'
    setLiveWord('simulated')
    if (!badge) {
      root.querySelector('.comms-head .spacer').before(
        el(`<span class="comms-badge" data-example-badge="true">${esc(EXAMPLE_BADGE)}</span>`))
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
     * pane could never have shown a message, however well the channel worked.
     *
     * THE STATIC REPORT STAYS. Services on record, channels and the tool-link
     * counts are genuinely build-time-and-CLI facts and are still read exactly
     * as before; only the messages are read live, and only they are merged in
     * below.
     *
     * DEGRADES BY SAYING SO. A build whose shell exposes no message reader --
     * an older build, a window that is not the app -- says the messages could
     * not be read WITH the reason and the next step (comms-copy.js
     * READER_REFUSALS). It never shows an empty conversation as though the
     * agents had nothing to say. */
    const readLiveMessages = async () => {
      const bridge = typeof window !== 'undefined' ? window.mcAgent : null
      if (!bridge || typeof bridge.localMessages !== 'function') {
        return { ok: false, reason: READER_REFUSALS.NO_READER }
      }
      try {
        const answer = await bridge.localMessages({ limit: 200 })
        if (!answer || answer.ok !== true || !Array.isArray(answer.messages)) {
          return { ok: false, reason: (answer && answer.reason) || READER_REFUSALS.NO_ANSWER }
        }
        return { ok: true, messages: answer.messages }
      } catch (error) {
        return { ok: false, reason: READER_REFUSALS.READ_THREW(error) }
      }
    }

    /* The live messages are folded into the SAME report shape the page already
       renders, so applyLiveProjection is unchanged: one code path draws the
       page whether the messages came from a file or from the fabric. */
    const LIVE_CHANNEL_ID = 'agent-tree'
    const withLiveMessages = (result, live) => {
      const envelope = result.ok ? result.data : null
      /* THE STATIC REPORT BEING UNREADABLE MUST NOT HIDE A LIVE CONVERSATION,
         and the first version of this let it. MEASURED on a driven two-node
         run: the agents talked, the shell handed over both messages, and the
         page still said the report could not be read -- because ops.json is
         UNAVAILABLE on any computer that is not the one that cut the release,
         and an unavailable report short-circuits the whole page before the
         messages are looked at. That is the ordinary state of a customer's
         machine. The two sources are independent, so they fail independently. */
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
      /* A message needs a channel to land in, and the agents on this computer
         are not a declared service and not something the preflight CLI can
         see. They are their own channel. */
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
        if (!destroyed) paintProjection({ ok: false, reason: LOAD_FAILED(err) })
      })

    /* WHERE THE REPORT COMES FROM is resolved in the load path, not at
       mount: on a public origin the relay-versus-mock answer needs the host
       asked for its transport, which is async (src/data-source.js). Real
       sources take the live loader above. A mock source wraps the example
       fleet's report (src/sample-comms.js) in the same one-sentence carrier
       withLiveMessages synthesizes for a machine with no ops.json, and feeds
       it through the SAME applyLiveProjection — the render cannot tell.

       THE MOCK PATH NEVER TOUCHES THE BRIDGE AND NEVER POLLS. There is no
       process behind the example fleet, so asking mcAgent for its messages
       would be a claim that one exists; and the report is a pure function of
       its clock, so a 4-second poll would only rebuild the same board. A
       source change (sign-in, sign-out, the example toggle) re-resolves below
       instead. */
    let liveTimer = 0
    const stopLivePoll = () => { if (liveTimer) { clearInterval(liveTimer); liveTimer = 0 } }
    const loadForSource = async ({ reask = false } = {}) => {
      let source
      try {
        source = await resolveDataSource({ reask })
      } catch (err) {
        /* A resolution that failed is not a machine with no host and not the
           example: the page says the read failed, with the reason, through
           the same unavailable branch every other failed read uses. */
        if (!destroyed) paintProjection({ ok: false, reason: LOAD_FAILED(err) })
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
      /* A CONVERSATION IS NOT A SNAPSHOT. The interval is cleared by destroy()
         through the same unsubscribe list every other subscription on this
         page uses, and by the mock branch above when the source flips
         mid-session. */
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
