// /ledger — owner requests (R) and owner questions (Q).
// State is deliberately encoded once, at a fixed left rail: a distinct glyph
// plus a themed status colour. Everything after the title is quiet metadata.
//
// ONE RENDER PATH. This page used to keep a second face -- its own markup
// builders, its own richer data shape, an age ticker -- selected by a
// per-view flag. The owner's ruling collapsed that: "all simulated pages ARE
// the UI pages, just mock data." So the register is drawn by one set of
// builders whatever the data's origin. src/data-source.js answers where the
// data comes from ('local', 'relay' or 'mock'), and that answer changes
// exactly two things here: what feeds the render, and whether the page is
// badged as an example. Nothing about HOW it renders.

import { el, attachSeg } from '../components.js'
import { fetchLedger } from '../live-status.js'
/* WHERE THE DATA COMES FROM -- one axis, three answers, resolved async and
   re-resolved whenever the host announces the world changed. The badge rule
   lives there too (sourceIsBadged: mock is badged, real data never is), so
   this page cannot derive a private one and drift from its neighbours. */
import { DATA_SOURCE_EVENT, resolveDataSource, sourceIsBadged } from '../data-source.js'
/* The example fleet's register, ALREADY in the exact shape a validated
   projection's `data` member has -- src/sample-ledger.js's header carries the
   why. It is handed to the very assignment a fetched register lands in, so
   from that line on the render cannot tell the two apart and never needs to:
   the badge, not the code path, is what separates them. */
import { sampleLedgerData } from '../sample-ledger.js'
import { mountLedgerWriteSurface } from '../write-surfaces.js'
import { HIDE_ROW, registerNotice } from '../ledger-copy.js'
/* THE × ON EVERY ROW, AND WHY IT HIDES RATHER THAN DELETES. Plan O6 looked at
   all three lists for an honest "delete" and found none: an owner request is
   retired by APPENDING to a hash-chained overlay and still reaches every
   projected list until three sessions have seen it; an owner question is
   parsed from a planning file the app has no writer for. A × that claimed to
   take a row "out of the list agents read" would see the row come straight
   back on the next load. So the × does the one thing this screen can do
   honestly -- stop drawing the row here -- and says so in every sentence
   beside it (HIDE_ROW). The set lives in this copy's own storage, keyed per
   list so an example R1 never hides a real R1, and nothing is ever sent. */
import { createHiddenRows } from '../hidden-rows.js'
/* Two presses for anything that takes a row away -- the research page's
   measured rule, lifted into a shared helper so the × cannot fire on a pointer
   that was on its way to the scroll bar. */
import { armOnce } from '../arm-press.js'
/* THE DOOR OUT OF THIS SCREEN'S EMPTY STATE. The ledger is one of the four
   screens src/first-run-needs.js names as permanently empty on a copy with no
   agent host, so the honest answer -- there is nothing here and nothing you do
   will fill it -- needs somewhere to send a person who wants to know why. The
   label and the address are imported rather than retyped so this screen and the
   other five point at one page under one name. */
import { GUIDE_ACTION } from '../first-run-needs.js'
import '../ledger.css'

const MODE_KEY = 'mc.ledger.mode'
/* ONE HIDE LIST PER REGISTER. The example register is shaped exactly like a
   real one down to its ids, so the two must never share a set: a row hidden
   while the example toggle was on would otherwise vanish from the real list
   the moment the toggle went off. The suffix follows sourceIsBadged(), which
   is the page's one badge rule. */
const HIDDEN_KEY_LIVE = 'mc.ledger.hidden:live'
const HIDDEN_KEY_EXAMPLE = 'mc.ledger.hidden:example'
const SUMMARY_STATES = ['open', 'in-progress', 'gated', 'done', 'blocked']

const STATE = {
  open: { glyph: '●', label: 'Open' },
  'in-progress': { glyph: '◐', label: 'In progress' },
  gated: { glyph: '■', label: 'Gated' },
  done: { glyph: '✓', label: 'Done' },
  blocked: { glyph: '✕', label: 'Blocked' },
  unknown: { glyph: '?', label: 'Unclassified status' },
}

/* THE EXAMPLE MARKING, IN HOME'S EXACT WORDS. Every landing view labels its
   own example data and "Example, not your data" is the product's one phrasing
   for it (src/local-activity.js, src/approvals-example.js). It rides in the
   counter line, which sits directly above the register it describes, so the
   label and the rows it disclaims cannot scroll apart. */
const EXAMPLE_COUNT_PREFIX = 'Example, not your data — '

/* The sentence a press on Approve, Decline, Claim or Close gets while the
   register is the example, instead of a write. Tone 'note', never 'refused':
   nothing failed -- there was never anything real to send -- and painting
   "nothing happened, by design" in the failure colour is the register's own
   old defect one level down. */
const EXAMPLE_WRITE_NOTE = 'Nothing was sent. These are example records, not yours, so there is nothing real here to act on. Connect your own computers to act on real work.'

const esc = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

function readMode() {
  try { return localStorage.getItem(MODE_KEY) === 'q' ? 'q' : 'r' }
  catch { return 'r' }
}

function writeMode(mode) {
  try { localStorage.setItem(MODE_KEY, mode) } catch {}
}

function requestState(status) {
  if (Object.hasOwn(STATE, status)) return status
  if (status.startsWith('blocked')) return 'blocked'
  return 'unknown'
}

function questionState(statusClass) {
  return Object.hasOwn(STATE, statusClass) ? statusClass : 'unknown'
}

/* THE CONTROL AT THE ROW'S RIGHT EDGE, in both of its states. It is a SIBLING
   of the row inside `.ledger-line` (position:relative), never a child of it:
   the Q row is itself a <button>, and a button inside a button is invalid
   markup that browsers split unpredictably. A row that is hidden and shown on
   request gets the same control with the opposite verb. */
function hideControl(key, id, { hidden = false } = {}) {
  return hidden
    ? `<button class="ledger-hide" type="button" data-unhide="${key}" aria-label="${esc(HIDE_ROW.putBack(id))}" title="${esc(HIDE_ROW.putBackTitle)}">↩</button>`
    : `<button class="ledger-hide" type="button" data-hide="${key}" aria-label="${esc(HIDE_ROW.aria(id))}" title="${esc(HIDE_ROW.title)}">×</button>`
}

/* Under the row: where the first press says what the second will do. Empty
   and hidden until then, so a register of fifty rows does not carry fifty
   blank paragraphs. */
const ROW_HINT = '<p class="ledger-row-hint" data-row-hint role="status" hidden></p>'

function requestMarkup(item, { hidden = false } = {}) {
  const state = requestState(item.status)
  const meta = STATE[state]
  const key = `r:${item.id}`

  /* THE R ROW IS NOT A BUTTON ANY MORE, AND ITS DETAIL IS GONE. The detail it
     used to open (status / gates / unmet, as <code>) repeated the row above it
     word for word -- zero information behind a control that looked like it
     held some. A row that expands to nothing is a lie about the row, so the
     row is a plain div now and the only control on it is the × beside it. The
     Q row keeps its expansion, because its detail adds what the row lacks
     (statusClass, packageId). */
  return `
    <div class="ledger-record" style="--depth:0" role="treeitem" aria-level="1" data-record-key="${key}"${hidden ? ' data-hidden' : ''}>
      <div class="ledger-line" data-state="${state}">
        <div class="ledger-row">
          <span class="ledger-state" title="${esc(item.status)}"><span class="ledger-glyph" aria-hidden="true">${meta.glyph}</span><span class="ledger-sr-only">${esc(item.status)}</span></span>
          <span class="ledger-id-cell"><span class="ledger-guides" aria-hidden="true"></span><span class="ledger-id">${esc(item.id)}</span></span>
          <span class="ledger-title">${esc(item.status)}</span>
          <span class="ledger-meta">
            <span class="ledger-agent">gates ${item.gateCount}</span>
            <span class="ledger-age">unmet ${item.unmetGateCount}</span>
          </span>
        </div>
        ${hideControl(key, item.id, { hidden })}
      </div>
      ${ROW_HINT}
    </div>`
}

function questionMarkup(item, { expanded = false, hidden = false } = {}) {
  const state = questionState(item.statusClass)
  const meta = STATE[state]
  const key = `q:${item.id}`
  const detailId = `ledger-detail-q-${item.id.replace(/\./g, '-')}`
  const packageId = item.packageId ?? '—'

  return `
    <div class="ledger-record is-question" role="listitem" data-record-key="${key}"${hidden ? ' data-hidden' : ''}>
      <div class="ledger-line" data-state="${state}">
        <button class="ledger-row" type="button" data-expand="${key}" aria-expanded="${expanded ? 'true' : 'false'}" aria-controls="${detailId}">
          <span class="ledger-state" title="${esc(item.status)}"><span class="ledger-glyph" aria-hidden="true">${meta.glyph}</span><span class="ledger-sr-only">${esc(item.status)}</span></span>
          <span class="ledger-id-cell"><span class="ledger-guides" aria-hidden="true"></span><span class="ledger-id">${esc(item.id)}</span></span>
          <span class="ledger-title">${esc(item.title)}</span>
          <span class="ledger-meta">
            <span class="ledger-agent">${esc(item.status)}</span>
            <span class="ledger-age">${esc(packageId)}</span>
          </span>
        </button>
        ${hideControl(key, item.id, { hidden })}
      </div>
      <div class="ledger-detail" id="${detailId}" ${expanded ? '' : 'hidden'}>
        <span class="ledger-detail-label">status-class</span>
        <code>${esc(item.statusClass)}</code>
        <span class="ledger-detail-sep" aria-hidden="true">·</span>
        <span class="ledger-detail-label">package-id</span>
        <code>${esc(packageId)}</code>
      </div>
      ${ROW_HINT}
    </div>`
}

export function ledgerView() {
  const root = el(`
    <main class="view-pad ledger-page">
      <div class="ledger-shell">
        <h1 class="ledger-sr-only">Ledger</h1>
        <section class="ledger-summary" aria-label="Ledger state totals">
          ${SUMMARY_STATES.map(state => `
            <div class="ledger-stat" data-state="${state}">
              <span class="ledger-stat-value" data-summary="${state}">0</span>
              <span class="ledger-stat-label">${STATE[state].label}</span>
              <span class="ledger-stat-note" data-summary-note>· this session</span>
            </div>`).join('')}
        </section>

        <div class="ledger-toolbar">
          <div class="seg ledger-mode" role="group" aria-label="Ledger item type">
            <button type="button" data-mode="r" aria-pressed="false">R items</button>
            <button type="button" data-mode="q" aria-pressed="false">Q items</button>
          </div>
          <p class="ledger-register-note" aria-live="polite"><span data-visible-count>0</span> <button class="ledger-hidden-toggle" type="button" data-show-hidden hidden>${esc(HIDE_ROW.show)}</button></p>
        </div>
        <p class="ledger-hidden-note" data-hidden-note aria-live="polite" hidden></p>

        <section class="ledger-register" aria-live="polite"></section>
      </div>
    </main>`)

  const register = root.querySelector('.ledger-register')
  /* THE FORMS ARE TOLD WHAT THE LIST IS DOING, which is the whole of finding 11
     part two. The Approve/Decline form asked for "its number, as shown in the
     list" while the list beside it was empty, and it asked in exactly the same
     words whether the list was empty, unreadable or full -- because nothing
     connected the two. Now the register's state and its rows go to the surface
     every time they change, and the form either fills itself from them or turns
     itself off and says why. */
  let showRegisterInForms = () => {}
  const destroyWriteSurface = mountLedgerWriteSurface(root, {
    onMount: api => { showRegisterInForms = api.showRegister },
  })
  const modeGroup = root.querySelector('.ledger-mode')
  const hiddenNote = root.querySelector('[data-hidden-note]')
  const showHiddenToggle = root.querySelector('[data-show-hidden]')
  /* Q rows only: the R row no longer expands (its detail said nothing). */
  const expandedRows = new Set()
  /* THE HIDE SET STARTS ON THE LIVE KEY AND IS RE-CREATED WHEN THE BADGE IS
     KNOWN (see load). Before the source resolves the page draws no rows, so
     the key it holds then is never consulted; the moment `badged` is set the
     set is rebound to the matching list so an example hide can never land on
     a real row. */
  let hidden = createHiddenRows(HIDDEN_KEY_LIVE)
  let showHidden = false
  let mode = readMode()
  let source = null
  /* Whether the register on screen is the example. Set ONLY from
     sourceIsBadged() at each resolution, never inferred from the data --
     the badge follows the source, and the whole point of the example being
     shaped exactly like a real register is that the data cannot tell you. */
  let badged = false
  let requestVersion = 0
  let destroyed = false

  function syncModeButtons() {
    for (const button of modeGroup.querySelectorAll('button[data-mode]')) {
      const on = button.dataset.mode === mode
      button.classList.toggle('on', on)
      button.setAttribute('aria-pressed', on ? 'true' : 'false')
    }
  }

  function renderSummary(items, { unavailable = false } = {}) {
    const counts = Object.fromEntries(SUMMARY_STATES.map(state => [state, 0]))
    for (const item of items) {
      const state = mode === 'r' ? requestState(item.status) : questionState(item.statusClass)
      if (Object.hasOwn(counts, state)) counts[state] += 1
    }
    for (const state of SUMMARY_STATES) {
      const node = root.querySelector(`[data-summary="${state}"]`)
      node.textContent = unavailable ? '—' : counts[state]
      // presentation only: a zero has no state to colour, and the Q register
      // leaves three of the five at zero. See .ledger-stat[data-empty].
      node.closest('.ledger-stat').toggleAttribute('data-empty', !unavailable && counts[state] === 0)
    }
    for (const note of root.querySelectorAll('[data-summary-note]')) {
      /* "your records" over somebody else's example numbers would be the exact
         lie the badge exists to prevent, so the note is keyed to it too. */
      note.textContent = unavailable ? '· unavailable' : (badged ? '· example data' : '· your records')
    }
  }

  function renderRegister() {
    /* ONE NOTICE, ONE STORY. Everything this state paints -- the paragraph, the
       register's accessible name, the counter, the state marker and whether the
       totals above are even knowable -- comes from the one object, so the page
       cannot say "could not be read" in three places while the paragraph
       between them says there is simply nothing here. That contradiction is
       what the owner was reading. */
    const notice = registerNotice(source, { mode })
    if (notice) {
      renderSummary([], { unavailable: !notice.countsKnown })
      register.removeAttribute('role')
      register.setAttribute('aria-label', notice.label)
      const door = notice.door
        ? `<p class="ledger-empty"><a class="host-absent-action" href="${esc(GUIDE_ACTION.href)}">${esc(GUIDE_ACTION.label)}</a></p>`
        : ''
      register.innerHTML = `<p class="ledger-empty ${notice.className}">${esc(notice.body)}</p>${door}`
      /* The reason travels as data, never in the sentence -- the rule
         src/refusal-copy.js sets for a refusal code, applied to a projection
         reason, which can be a schema complaint. */
      if (source.reason) register.dataset.registerReason = String(source.reason).slice(0, 300)
      else delete register.dataset.registerReason
      root.querySelector('[data-visible-count]').textContent = notice.count
      root.dataset.projectionState = notice.state
      showRegisterInForms({ kind: notice.state, items: [] })
      return
    }

    /* Past the notices there is exactly one case left: a register in the
       validated shape -- read from this copy, carried over the relay, or the
       example fleet's. The three were made indistinguishable on purpose, so
       nothing below may branch on where it came from except the badge. */
    const rItems = source.data.requests
    const qObservation = source.data.questions

    /* THE QUESTIONS HALF, IN THE SAME TWO STATES AS THE REQUESTS HALF. It used
       to have a third vocabulary of its own -- "the questions could not be
       read" with the raw reason after a middle dot -- so one page refused in
       three different accents. */
    if (mode === 'q' && !qObservation.ok) {
      const qNotice = registerNotice({ kind: 'unreadable' }, { mode: 'q' })
      renderSummary([], { unavailable: !qNotice.countsKnown })
      register.removeAttribute('role')
      register.setAttribute('aria-label', qNotice.label)
      register.innerHTML = `<p class="ledger-empty ${qNotice.className}">${esc(qNotice.body)}</p>`
      register.dataset.registerReason = String(qObservation.reason || '').slice(0, 300)
      root.querySelector('[data-visible-count]').textContent = qNotice.count
      root.dataset.projectionState = qNotice.state
      showRegisterInForms({ kind: 'unreadable', items: [] })
      return
    }

    const qItems = qObservation.value

    /* THE HIDE SET IS APPLIED HERE AND ONLY HERE. Every reader of the list --
       the totals strip, the counter, the rows, the forms' picker -- takes the
       VISIBLE list, so a hidden row is hidden from all of them at once rather
       than from the rows alone while the counter above still counts it. With
       "Show hidden" on, the hidden rows are drawn dimmed, carry data-hidden,
       and offer the put-back control instead of the ×. */
    const hiddenKeys = new Set(hidden.list())
    const isHidden = key => hiddenKeys.has(key)
    const rShown = rItems.filter(item => !isHidden(`r:${item.id}`))
    const qShown = qItems.filter(item => !isHidden(`q:${item.id}`))
    const rHidden = rItems.length - rShown.length
    const qHidden = qItems.length - qShown.length
    const rList = showHidden ? rItems : rShown
    const qList = showHidden ? qItems : qShown
    const hiddenCount = mode === 'r' ? rHidden : qHidden
    renderSummary(mode === 'r' ? rList : qList)

    const rows = []
    if (mode === 'r') {
      for (const item of rList) rows.push(requestMarkup(item, { hidden: isHidden(`r:${item.id}`) }))
      register.setAttribute('role', 'tree')
      register.setAttribute('aria-label', badged ? 'Example requests — not yours' : 'Your requests')
      register.innerHTML = rows.length
        ? rows.join('')
        : '<p class="ledger-empty">There are no requests in this list.</p>'
      root.querySelector('[data-visible-count]').textContent =
        `${badged ? EXAMPLE_COUNT_PREFIX : ''}${rList.length} requests · with their status and gates${rHidden > 0 ? ` · ${HIDE_ROW.count(rHidden)}` : ''}`
    } else {
      for (const item of qList) rows.push(questionMarkup(item, { expanded: expandedRows.has(`q:${item.id}`), hidden: isHidden(`q:${item.id}`) }))
      register.setAttribute('role', 'list')
      register.setAttribute('aria-label', badged ? 'Example questions — not yours' : 'Your questions')
      register.innerHTML = rows.length
        ? rows.join('')
        : '<p class="ledger-empty">There are no questions waiting on a decision.</p>'
      const open = qList.filter(item => item.statusClass === 'open').length
      root.querySelector('[data-visible-count]').textContent =
        `${badged ? EXAMPLE_COUNT_PREFIX : ''}${qList.length} questions · ${open} open${qHidden > 0 ? ` · ${HIDE_ROW.count(qHidden)}` : ''}`
    }
    /* The toggle exists only while there is something it would show. A button
       reading "Show hidden" over a list with nothing hidden is a control that
       looks real and is not. */
    showHiddenToggle.hidden = hiddenCount === 0
    showHiddenToggle.textContent = showHidden ? HIDE_ROW.hideAgain : HIDE_ROW.show
    showHiddenToggle.setAttribute('aria-pressed', showHidden ? 'true' : 'false')

    /* 'simulated' here is DOM VOCABULARY, not architecture: the attribute's
       two values predate the source axis and tooling reads them, so the words
       stay while the thing that decides them is now the badge alone. There is
       no second render for 'simulated' to name any more. */
    root.dataset.projectionState = badged ? 'simulated' : 'ready'
    /* THE FORMS BELOW ACT ON REQUESTS, so they are given the requests -- in
       both tabs, because Approve and Decline answer a request whichever list
       happens to be on screen. The example rows are offered too, deliberately:
       a picker that empties itself the moment the data is an example would
       hide what this surface does from the one person it is demonstrating to.
       What the example must never do is WRITE, and the fence for that sits on
       the view (see the capture listener below), not on the picker's contents.
       The kind keeps the vocabulary src/ledger-copy.js declares. */
    showRegisterInForms({
      kind: badged ? 'simulated' : 'live',
      items: rShown.map(item => ({ id: item.id, label: `${item.id} · ${item.status}` })),
    })
  }

  /* THE TOOLBAR NOTE: one sentence about the last hide or put-back, with Undo
     beside it. Tone 'note' always -- a row a person hid is not a failure. */
  function paintHiddenNote(text, { undoKey = null } = {}) {
    if (!text) {
      hiddenNote.hidden = true
      hiddenNote.textContent = ''
      return
    }
    hiddenNote.hidden = false
    hiddenNote.dataset.state = HIDE_ROW.tone
    hiddenNote.textContent = text
    if (undoKey) {
      const undo = document.createElement('button')
      undo.type = 'button'
      undo.className = 'ledger-hidden-toggle'
      undo.dataset.undoHide = undoKey
      undo.textContent = HIDE_ROW.undo
      hiddenNote.append(' ', undo)
    }
  }

  /* A record key is 'r:R12' or 'q:Q7'; the id a person reads is the part
     after the colon, and which note to paint follows the prefix. */
  const idOfKey = key => key.slice(2)
  const hiddenSentence = key => (key.startsWith('q:') ? HIDE_ROW.hiddenQ : HIDE_ROW.hiddenR)(idOfKey(key))

  modeGroup.addEventListener('click', event => {
    const button = event.target.closest('button[data-mode]')
    if (!button || button.dataset.mode === mode) return
    mode = button.dataset.mode
    writeMode(mode)
    syncModeButtons()
    /* The note was about a row on the other list; it does not follow. */
    paintHiddenNote(null)
    renderRegister()
  })

  showHiddenToggle.addEventListener('click', () => {
    showHidden = !showHidden
    renderRegister()
  })

  hiddenNote.addEventListener('click', event => {
    const undo = event.target.closest('button[data-undo-hide]')
    if (!undo) return
    const key = undo.dataset.undoHide
    hidden.remove(key)
    renderRegister()
    paintHiddenNote(HIDE_ROW.restored(idOfKey(key)))
  })

  register.addEventListener('click', event => {
    /* THE × AND ITS OPPOSITE, before the expand handler so a press on the
       control never also toggles the Q row it sits beside. */
    const hideButton = event.target.closest('button[data-hide]')
    if (hideButton) {
      const key = hideButton.dataset.hide
      const hint = hideButton.closest('.ledger-record')?.querySelector('[data-row-hint]')
      /* FIRST PRESS ARMS, SECOND ACTS. The hint under the row says what the
         second press will do and what it will not; a lone press disarms and
         the hint goes with it, so the row never sits there threatening. */
      if (!armOnce(hideButton, { onDisarm: () => { if (hint) { hint.hidden = true; hint.textContent = '' } } })) {
        if (hint) {
          hint.dataset.state = HIDE_ROW.tone
          hint.textContent = HIDE_ROW.armed(idOfKey(key))
          hint.hidden = false
        }
        return
      }
      /* NOTHING IS SENT. The key goes into this copy's own storage and the
         list is redrawn from it; the capture fence below never sees this
         press because the × carries neither data-decision nor
         data-queue-operation, and it needs no fence -- there was never a
         write here to stop. */
      hidden.add(key)
      renderRegister()
      paintHiddenNote(hiddenSentence(key), { undoKey: key })
      return
    }
    const unhideButton = event.target.closest('button[data-unhide]')
    if (unhideButton) {
      /* Putting a row back needs no second press: the only thing it can do is
         restore what the person is looking at. */
      const key = unhideButton.dataset.unhide
      hidden.remove(key)
      renderRegister()
      paintHiddenNote(HIDE_ROW.restored(idOfKey(key)))
      return
    }
    const row = event.target.closest('button[data-expand]')
    if (!row) return
    const key = row.dataset.expand
    const detail = row.closest('.ledger-record').querySelector('.ledger-detail')
    const open = !expandedRows.has(key)
    if (open) expandedRows.add(key)
    else expandedRows.delete(key)
    row.setAttribute('aria-expanded', open ? 'true' : 'false')
    detail.hidden = !open
  })

  /* AN EXAMPLE NEVER ISSUES A WRITE. The example register fills the picker so
     a person can see exactly what this surface does -- but a press must not
     become a record. This matters beyond the signed-out page: the example
     toggle works on the desktop too, where the audited connection is real, a
     press really would land, and a picked example id could collide with a
     real request's id. The surface cannot hold this line itself -- it is
     handed a register view, not a data source -- so the fence sits where the
     knowledge is: the press is stopped here in the capture phase, before the
     surface's own handler can run, and the person is told nothing was sent.
     Claim and Close are fenced with Approve and Decline, because a page
     marked as an example must not reach a real process through ANY of its
     buttons -- the same line src/views/agent.js draws for its own page. */
  root.addEventListener('click', event => {
    if (!badged) return
    const button = event.target.closest('button[data-decision], button[data-queue-operation]')
    if (!button) return
    event.preventDefault()
    event.stopPropagation()
    const output = button.closest('form')?.querySelector('[data-action-output]')
    if (output) {
      output.dataset.state = 'note'
      output.textContent = EXAMPLE_WRITE_NOTE
    }
  }, true)

  syncModeButtons()
  const detachSeg = attachSeg(modeGroup)

  async function load({ reask = false } = {}) {
    const version = ++requestVersion
    source = { kind: 'loading' }
    paintHiddenNote(null)
    renderRegister()
    /* Resolution is async because on a public origin the relay-versus-mock
       answer needs the host asked for its transport; the loading notice is
       already on screen, so nothing is blank while the question is out. Note
       data-live-mode is NOT set yet: before the answer arrives the page does
       not know what world it is in, and stamping either word early would be
       a guess -- the same rule currentDataSource() states for its null. */
    let origin
    try {
      origin = await resolveDataSource({ reask })
    } catch (error) {
      /* No verdict at all: the page cannot say where data would even come
         from. That is a read that did not answer, and it wears the words a
         read that did not answer has earned -- never a quiet default to some
         source, which would either badge real data or unbadge the example. */
      if (destroyed || version !== requestVersion) return
      source = { kind: 'unreadable', reason: error?.message || String(error) }
      renderRegister()
      return
    }
    if (destroyed || version !== requestVersion) return
    badged = sourceIsBadged(origin)
    /* The hide set follows the badge: the example list and the real list
       keep separate sets, re-bound here at the one place the badge is set. */
    hidden = createHiddenRows(badged ? HIDDEN_KEY_EXAMPLE : HIDDEN_KEY_LIVE)
    /* 'live'/'simulated' is the attribute's established vocabulary and tools
       key on it, so the words survive -- but they are derived from the source
       axis now, not from a second render path. mock -> 'simulated'. */
    root.dataset.liveMode = badged ? 'simulated' : 'live'
    if (badged) {
      /* The example register lands in the SAME assignment a fetched one does:
         kind 'live', data in the validated shape. Everything downstream of
         this line is shared with the real path, which is what makes the badge
         trustworthy -- it is the only difference left. A fresh Date.now()
         per resolution keeps the sample's observedAt reading as recent. */
      source = { kind: 'live', data: sampleLedgerData(Date.now()) }
      renderRegister()
      return
    }
    fetchLedger().then(result => {
      if (destroyed || version !== requestVersion) return
      /* THE DISTINCTION WAS ALWAYS IN THE ANSWER AND THIS PAGE THREW IT AWAY.
         src/live-status.js validates the projection before returning it: a file
         that ANSWERS "I have nothing" comes back with its envelope attached,
         and a read that fell over -- no file, a bad response, malformed JSON, a
         shape that failed validation -- comes back with nothing attached. One
         is an answer and the other is a fault, they have different repairs, and
         collapsing them into "unavailable" is why this page told a stranger his
         request list could not be read when in truth this copy does not keep
         one. */
      if (result.ok) source = { kind: 'live', data: result.data.data }
      else if (result.data) source = { kind: 'empty', reason: result.reason }
      else source = { kind: 'unreadable', reason: result.reason }
      renderRegister()
    }, error => {
      if (destroyed || version !== requestVersion) return
      source = { kind: 'unreadable', reason: error?.message || String(error) }
      renderRegister()
    })
  }

  /* The event deliberately carries no verdict -- a verdict in an event payload
     is how two views end up in different worlds -- so the whole response is to
     re-resolve and re-render. reask: true because the moment this fires is
     exactly the moment a transport may have just appeared (a sign-in), and it
     is harmless when one is already installed. */
  const onDataSourceChanged = () => { void load({ reask: true }) }
  window.addEventListener(DATA_SOURCE_EVENT, onDataSourceChanged)
  void load()

  return {
    el: root,
    destroy() {
      destroyWriteSurface()
      destroyed = true
      requestVersion += 1
      window.removeEventListener(DATA_SOURCE_EVENT, onDataSourceChanged)
      detachSeg()
    },
  }
}
