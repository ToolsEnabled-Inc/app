// /ledger — simulated owner requests (R) and owner questions (Q).
// State is deliberately encoded once, at a fixed left rail: a distinct glyph
// plus a themed status colour. Everything after the title is quiet metadata.

import { el, attachSeg } from '../components.js'
import { R_ITEMS, Q_ITEMS, liveAgeMs, formatLedgerAge } from '../ledger-data.js'
import { isLiveView, LIVE_FLAGS_EVENT } from '../live-flags.js'
import { fetchLedger } from '../live-status.js'
import { mountLedgerWriteSurface } from '../write-surfaces.js'
/* THE DOOR OUT OF THIS SCREEN'S REFUSAL. The ledger is one of the four screens
   src/first-run-needs.js names as permanently empty on a copy with no agent
   host, and "the ledger could not be read yet" is true without being an answer.
   The label and the address are imported rather than retyped so this screen and
   the other five point at one page under one name. */
import { GUIDE_ACTION } from '../first-run-needs.js'
import '../ledger.css'

const MODE_KEY = 'mc.ledger.mode'
const ROOT_KEY = 'mc.ledger.root.'
const SUMMARY_STATES = ['open', 'in-progress', 'gated', 'done', 'blocked']

const STATE = {
  open: { glyph: '●', label: 'Open' },
  'in-progress': { glyph: '◐', label: 'In progress' },
  gated: { glyph: '■', label: 'Gated' },
  done: { glyph: '✓', label: 'Done' },
  blocked: { glyph: '✕', label: 'Blocked' },
  unknown: { glyph: '?', label: 'Unclassified status' },
}

const itemByKey = new Map([
  ...R_ITEMS.map(item => [`r:${item.id}`, item]),
  ...Q_ITEMS.map(item => [`q:${item.id}`, item]),
])

const childrenByParent = new Map()
for (const item of R_ITEMS) {
  const key = item.parent || ''
  if (!childrenByParent.has(key)) childrenByParent.set(key, [])
  childrenByParent.get(key).push(item)
}

const branchRoots = R_ITEMS.filter(item => !item.parent && childrenByParent.has(item.id))

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

function readCollapsed(id) {
  try { return localStorage.getItem(`${ROOT_KEY}${id}`) === 'collapsed' }
  catch { return false }
}

function writeCollapsed(id, collapsed) {
  try {
    if (collapsed) localStorage.setItem(`${ROOT_KEY}${id}`, 'collapsed')
    else localStorage.removeItem(`${ROOT_KEY}${id}`)
  } catch {}
}

function stateFor(item, mode) {
  if (mode === 'q') return item.status === 'answered' ? 'done' : 'open'
  return item.status
}

function liveRequestState(status) {
  if (Object.hasOwn(STATE, status)) return status
  if (status.startsWith('blocked')) return 'blocked'
  return 'unknown'
}

function liveQuestionState(statusClass) {
  return Object.hasOwn(STATE, statusClass) ? statusClass : 'unknown'
}

function descendantCount(id) {
  return (childrenByParent.get(id) || []).reduce(
    (count, child) => count + 1 + descendantCount(child.id), 0,
  )
}

function guideMarkup(depth) {
  return Array.from({ length: depth }, (_, index) =>
    `<i class="ledger-guide" style="--rail-index:${index}" aria-hidden="true"></i>`
  ).join('')
}

function recordMarkup(item, { mode, depth = 0, expanded = false, collapsed = false, branch = false }) {
  const state = stateFor(item, mode)
  const meta = STATE[state]
  const key = `${mode}:${item.id}`
  const detailId = `ledger-detail-${mode}-${item.id.replace(/\./g, '-')}`
  const title = mode === 'q' ? item.question : item.title
  const branchCount = branch && collapsed ? `· ${descendantCount(item.id)} sub-items` : ''
  const answer = mode === 'q' && item.status === 'answered'
    ? `<div class="ledger-answer"><span class="ledger-answer-mark" aria-hidden="true">↳</span><span>${esc(item.answer)}</span></div>`
    : ''
  const gate = item.gate ? `<span class="ledger-gate">${esc(item.gate)}</span>` : ''
  const rootToggle = branch
    ? `<button class="ledger-root-toggle" type="button" data-root="${esc(item.id)}" aria-expanded="${collapsed ? 'false' : 'true'}" aria-label="${collapsed ? 'Expand' : 'Collapse'} ${esc(item.id)}"><span aria-hidden="true">⌄</span></button>`
    : ''

  return `
    <div class="ledger-record ${branch ? 'is-branch-root' : ''} ${mode === 'q' ? 'is-question' : ''}" style="--depth:${depth}" role="${mode === 'r' ? 'treeitem' : 'listitem'}" ${mode === 'r' ? `aria-level="${depth + 1}"` : ''} data-record-key="${key}">
      <div class="ledger-line" data-state="${state}">
        <button class="ledger-row" type="button" data-expand="${key}" aria-expanded="${expanded ? 'true' : 'false'}" aria-controls="${detailId}">
          <span class="ledger-state" title="${meta.label}"><span class="ledger-glyph" aria-hidden="true">${meta.glyph}</span><span class="ledger-sr-only">${meta.label}</span></span>
          <span class="ledger-id-cell">
            <span class="ledger-guides" aria-hidden="true">${guideMarkup(depth)}</span>
            <span class="ledger-id">${esc(item.id)}</span>
          </span>
          <span class="ledger-title">${esc(title)}</span>
          <span class="ledger-meta">
            ${branchCount ? `<span class="ledger-branch-count">${branchCount}</span>` : ''}
            <span class="ledger-agent">${esc(item.agent)}</span>
            <span class="ledger-age" data-ledger-age="${key}">${formatLedgerAge(liveAgeMs(item))}</span>
            ${gate}
          </span>
        </button>
        ${rootToggle}
      </div>
      ${answer}
      <div class="ledger-detail" id="${detailId}" ${expanded ? '' : 'hidden'}>
        <span class="ledger-detail-label">evidence</span>
        <code>${esc(item.evidence)}</code>
        <span class="ledger-detail-sep" aria-hidden="true">·</span>
        <span class="ledger-detail-label">claimed-at</span>
        <time>${esc(item.claimedAt)}</time>
      </div>
    </div>`
}

function liveRequestMarkup(item, { expanded = false }) {
  const state = liveRequestState(item.status)
  const meta = STATE[state]
  const key = `r:${item.id}`
  const detailId = `ledger-detail-r-${item.id.replace(/\./g, '-')}`

  return `
    <div class="ledger-record" style="--depth:0" role="treeitem" aria-level="1" data-record-key="${key}">
      <div class="ledger-line" data-state="${state}">
        <button class="ledger-row" type="button" data-expand="${key}" aria-expanded="${expanded ? 'true' : 'false'}" aria-controls="${detailId}">
          <span class="ledger-state" title="${esc(item.status)}"><span class="ledger-glyph" aria-hidden="true">${meta.glyph}</span><span class="ledger-sr-only">${esc(item.status)}</span></span>
          <span class="ledger-id-cell"><span class="ledger-guides" aria-hidden="true"></span><span class="ledger-id">${esc(item.id)}</span></span>
          <span class="ledger-title">${esc(item.status)}</span>
          <span class="ledger-meta">
            <span class="ledger-agent">gates ${item.gateCount}</span>
            <span class="ledger-age">unmet ${item.unmetGateCount}</span>
          </span>
        </button>
      </div>
      <div class="ledger-detail" id="${detailId}" ${expanded ? '' : 'hidden'}>
        <span class="ledger-detail-label">status</span>
        <code>${esc(item.status)}</code>
        <span class="ledger-detail-sep" aria-hidden="true">·</span>
        <span class="ledger-detail-label">gates</span>
        <code>${item.gateCount}</code>
        <span class="ledger-detail-sep" aria-hidden="true">·</span>
        <span class="ledger-detail-label">unmet</span>
        <code>${item.unmetGateCount}</code>
      </div>
    </div>`
}

function liveQuestionMarkup(item, { expanded = false }) {
  const state = liveQuestionState(item.statusClass)
  const meta = STATE[state]
  const key = `q:${item.id}`
  const detailId = `ledger-detail-q-${item.id.replace(/\./g, '-')}`
  const packageId = item.packageId ?? '—'

  return `
    <div class="ledger-record is-question" role="listitem" data-record-key="${key}">
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
      </div>
      <div class="ledger-detail" id="${detailId}" ${expanded ? '' : 'hidden'}>
        <span class="ledger-detail-label">status-class</span>
        <code>${esc(item.statusClass)}</code>
        <span class="ledger-detail-sep" aria-hidden="true">·</span>
        <span class="ledger-detail-label">package-id</span>
        <code>${esc(packageId)}</code>
      </div>
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
          <p class="ledger-register-note" aria-live="polite"><span data-visible-count>0</span></p>
        </div>

        <section class="ledger-register" aria-live="polite"></section>
      </div>
    </main>`)

  const register = root.querySelector('.ledger-register')
  const destroyWriteSurface = mountLedgerWriteSurface(root)
  const modeGroup = root.querySelector('.ledger-mode')
  const collapsedRoots = new Set(branchRoots.filter(item => readCollapsed(item.id)).map(item => item.id))
  const expandedRows = new Set()
  let mode = readMode()
  let source = null
  let ageTimer = null
  let requestVersion = 0
  let destroyed = false

  function syncModeButtons() {
    for (const button of modeGroup.querySelectorAll('button[data-mode]')) {
      const on = button.dataset.mode === mode
      button.classList.toggle('on', on)
      button.setAttribute('aria-pressed', on ? 'true' : 'false')
    }
  }

  function renderSummary(items, { unavailable = false, live = false } = {}) {
    const counts = Object.fromEntries(SUMMARY_STATES.map(state => [state, 0]))
    for (const item of items) {
      const state = live
        ? (mode === 'r' ? liveRequestState(item.status) : liveQuestionState(item.statusClass))
        : stateFor(item, mode)
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
      note.textContent = unavailable ? '· unavailable' : (live ? '· your records' : '· this session')
    }
  }

  function renderRBranch(item, depth, output) {
    const children = childrenByParent.get(item.id) || []
    const branch = !item.parent && children.length > 0
    const collapsed = branch && collapsedRoots.has(item.id)
    output.push(recordMarkup(item, {
      mode: 'r', depth, branch, collapsed, expanded: expandedRows.has(`r:${item.id}`),
    }))
    if (collapsed) return
    for (const child of children) renderRBranch(child, depth + 1, output)
  }

  function renderRegister({ focusRoot = null } = {}) {
    const rows = []

    if (source.kind === 'loading' || source.kind === 'unavailable') {
      const reason = source.kind === 'loading' ? 'still reading the ledger' : source.reason
      renderSummary([], { unavailable: true, live: true })
      register.removeAttribute('role')
      register.setAttribute('aria-label', 'The ledger could not be read')
      /* The door is offered only once the read has ANSWERED. While it is still
         in flight nothing is known to be missing, and a "what this copy needs"
         link under a spinner invites a person to go solve a problem they may
         not have. */
      const door = source.kind === 'unavailable'
        ? `<p class="ledger-empty"><a class="host-absent-action" href="${esc(GUIDE_ACTION.href)}">${esc(GUIDE_ACTION.label)}</a></p>`
        : ''
      register.innerHTML = `<p class="ledger-empty projection-unavailable">the ledger could not be read yet · ${esc(reason)}</p>${door}`
      root.querySelector('[data-visible-count]').textContent = source.kind === 'loading' ? 'reading…' : 'could not be read'
      root.dataset.projectionState = source.kind
      return
    }

    const live = source.kind === 'live'
    const rItems = live ? source.data.requests : R_ITEMS
    const qObservation = live ? source.data.questions : null
    const qItems = live ? qObservation?.value : Q_ITEMS

    if (mode === 'q' && live && !qObservation.ok) {
      renderSummary([], { unavailable: true, live: true })
      register.removeAttribute('role')
      register.setAttribute('aria-label', 'The questions could not be read')
      register.innerHTML = `<p class="ledger-empty projection-unavailable">the questions could not be read · ${esc(qObservation.reason)}</p>`
      root.querySelector('[data-visible-count]').textContent = 'questions could not be read'
      root.dataset.projectionState = 'questions-unavailable'
      return
    }

    renderSummary(mode === 'r' ? rItems : qItems, { live })

    if (mode === 'r') {
      if (live) {
        for (const item of rItems) rows.push(liveRequestMarkup(item, { expanded: expandedRows.has(`r:${item.id}`) }))
      } else {
        for (const item of childrenByParent.get('') || []) renderRBranch(item, 0, rows)
      }
      register.setAttribute('role', 'tree')
      register.setAttribute('aria-label', live ? 'Your requests' : 'Owner request outline')
      register.innerHTML = rows.length
        ? rows.join('')
        : '<p class="ledger-empty">no requests in this list · the ledger is quiet</p>'
      root.querySelector('[data-visible-count]').textContent = live
        ? `${rItems.length} requests · with their status and gates`
        : `${R_ITEMS.length} requests · 3 decomposed roots`
    } else {
      for (const item of qItems) {
        rows.push(live
          ? liveQuestionMarkup(item, { expanded: expandedRows.has(`q:${item.id}`) })
          : recordMarkup(item, { mode: 'q', expanded: expandedRows.has(`q:${item.id}`) }))
      }
      register.setAttribute('role', 'list')
      register.setAttribute('aria-label', live ? 'Your questions' : 'Questions to the owner')
      register.innerHTML = rows.length
        ? rows.join('')
        : '<p class="ledger-empty">no owner questions in this list · nothing waiting on a decision</p>'
      const open = live
        ? qItems.filter(item => item.statusClass === 'open').length
        : Q_ITEMS.filter(item => item.status === 'pending').length
      root.querySelector('[data-visible-count]').textContent = live
        ? `${qItems.length} questions · ${open} open`
        : `${Q_ITEMS.length} questions · ${open} pending`
    }

    root.dataset.projectionState = live ? 'ready' : 'simulated'
    if (focusRoot) register.querySelector(`[data-root="${focusRoot}"]`)?.focus()
  }

  function updateAges() {
    if (source.kind !== 'simulated') return
    const now = Date.now()
    for (const node of root.querySelectorAll('[data-ledger-age]')) {
      const item = itemByKey.get(node.dataset.ledgerAge)
      if (item) node.textContent = formatLedgerAge(liveAgeMs(item, now))
    }
  }

  modeGroup.addEventListener('click', event => {
    const button = event.target.closest('button[data-mode]')
    if (!button || button.dataset.mode === mode) return
    mode = button.dataset.mode
    writeMode(mode)
    syncModeButtons()
    renderRegister()
  })

  register.addEventListener('click', event => {
    const rootToggle = event.target.closest('button[data-root]')
    if (rootToggle) {
      const id = rootToggle.dataset.root
      if (collapsedRoots.has(id)) collapsedRoots.delete(id)
      else collapsedRoots.add(id)
      writeCollapsed(id, collapsedRoots.has(id))
      renderRegister({ focusRoot: id })
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

  syncModeButtons()
  const detachSeg = attachSeg(modeGroup)

  function stopAgeUpdates() {
    if (ageTimer != null) clearInterval(ageTimer)
    ageTimer = null
  }

  function showSimulation() {
    requestVersion += 1
    stopAgeUpdates()
    source = { kind: 'simulated' }
    root.dataset.liveMode = 'simulated'
    renderRegister()
    ageTimer = setInterval(updateAges, 30_000)
  }

  function showLive() {
    const version = ++requestVersion
    stopAgeUpdates()
    source = { kind: 'loading' }
    root.dataset.liveMode = 'live'
    renderRegister()
    fetchLedger().then(result => {
      if (destroyed || version !== requestVersion) return
      source = result.ok ? { kind: 'live', data: result.data.data } : { kind: 'unavailable', reason: result.reason }
      renderRegister()
    }, error => {
      if (destroyed || version !== requestVersion) return
      source = { kind: 'unavailable', reason: error?.message || String(error) }
      renderRegister()
    })
  }

  function onLiveFlagsChanged(event) {
    if (event.detail?.view !== 'ledger') return
    if (event.detail.live) showLive()
    else showSimulation()
  }

  window.addEventListener(LIVE_FLAGS_EVENT, onLiveFlagsChanged)
  if (isLiveView('ledger')) showLive()
  else showSimulation()

  return {
    el: root,
    destroy() {
      destroyWriteSurface()
      destroyed = true
      requestVersion += 1
      stopAgeUpdates()
      window.removeEventListener(LIVE_FLAGS_EVENT, onLiveFlagsChanged)
      detachSeg()
    },
  }
}
