// /research — the research workbench: a modular suite for setting up and
// reading research, arranged by the same layout engine the metrics page uses
// (src/metrics-layout.js, storage mc.research.layout) with one layer the
// engine does not have: modules can be switched on and off (Modules button,
// src/research-modules.js, storage mc.research.modules).
//
// THIS PAGE HAS NO CHAT SURFACE. Research workers run as tree nodes on the
// computers page; this page holds specs and results. That is the owner's
// amendment, and tools/test/research-workbench.test.mjs pins it.
//
// The page consumes only the browser-safe research projection.
// Authorization-gated rows are deliberately rendered through a separate
// metadata-only branch: title and authorizationReason are the only payload
// fields that branch reads.

import { el } from '../components.js'
import { fetchResearch } from '../live-status.js'
/* The one door every empty screen in this product offers, imported rather than
   written again here — see src/first-run-needs.js. */
import { GUIDE_ACTION } from '../first-run-needs.js'
import { createMetricsLayout } from '../metrics-layout.js'
import { createResearchRegistry } from '../research-modules.js'
import { isLiveView } from '../live-flags.js'
import '../research.css'

const RESEARCH_QUEUE_URL = '/data/research-queue.json'
const RESEARCH_QUEUE_STATUSES = new Set(['queued', 'in-progress', 'complete'])

const esc = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric', month: 'short', day: '2-digit',
})

function formatDate(value) {
  const at = typeof value === 'string' ? Date.parse(value) : Number.NaN
  return Number.isFinite(at) ? dateFormatter.format(at) : 'unavailable'
}

function formatBytes(value) {
  if (!Number.isSafeInteger(value) || value < 0) return 'unavailable'
  if (value < 1024) return `${value} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`
  return `${(value / 1024 ** 2).toFixed(value < 10 * 1024 ** 2 ? 1 : 0)} MB`
}

function lockedReportMarkup(report) {
  // R198 boundary: do not add a fallback that reads summary/path/bytes/date.
  // A future malformed producer cannot make this branch disclose them.
  const title = report?.title || 'Locked report'
  const reason = report?.authorizationReason || 'This report stays locked until you authorize it.'
  return `
    <li class="research-report is-locked" data-locked-report="true">
      <span class="research-lock" aria-hidden="true">
        <svg viewBox="0 0 20 20"><rect x="4.5" y="8.5" width="11" height="8"/><path d="M7 8.5V6.2a3 3 0 0 1 6 0v2.3"/></svg>
      </span>
      <div class="research-report-body">
        <h3>${esc(title)}</h3>
        <p class="research-authorization">${esc(reason)}</p>
      </div>
    </li>`
}

function safeReportMarkup(report) {
  const date = formatDate(report?.dateObserved)
  const bytes = formatBytes(report?.bytes)
  return `
    <li class="research-report" data-safe-report="true">
      <div class="research-report-body">
        <div class="research-report-head">
          <h3>${esc(report?.title || 'Untitled report')}</h3>
          <dl class="research-report-meta">
            <div><dt>observed</dt><dd><time${date === 'unavailable' ? '' : ` datetime="${esc(report.dateObserved)}"`}>${esc(date)}</time></dd></div>
            <div><dt>size</dt><dd>${esc(bytes)}</dd></div>
          </dl>
        </div>
        <div class="research-context">
          <p>${esc(report?.summary || 'No summary was written for this report.')}</p>
        </div>
      </div>
    </li>`
}

function unavailableMarkup(label, reason) {
  return `<p class="research-unavailable projection-unavailable">${esc(label)} could not be read · ${esc(reason || 'the app was not told why')}</p>`
}

function emptyMarkup(label) {
  return `<p class="research-observed-empty">The research data has no ${esc(label)} in it yet.</p>`
}

function validQueueText(value, maxLength) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength
}

function validQueueItem(item) {
  return invalidQueueItemReason(item) === null
}

function invalidQueueItemReason(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return 'queue item must be an object'
  if (!validQueueText(item.id, 120)) return 'missing or invalid id'
  if (!validQueueText(item.title, 240)) return 'missing or invalid title'
  if (!RESEARCH_QUEUE_STATUSES.has(item.status)) return 'unknown status'
  if (!validQueueText(item.provenance, 80)) return 'missing or invalid provenance'
  if (!validQueueText(item.observation, 2000)) return 'missing or invalid observation'
  if (!validQueueText(item.researchQuestion, 1000)) return 'missing or invalid research question'
  return null
}

function queueItemRejection(item, index, seenIds) {
  const id = validQueueText(item?.id, 120) ? item.id : undefined
  const rejected = reason => id === undefined ? { index, reason } : { index, id, reason }
  if (!validQueueItem(item)) return rejected(invalidQueueItemReason(item))
  if (seenIds.has(id)) return rejected('duplicate id')

  seenIds.add(id)
  return null
}

async function fetchResearchQueue({ fetchImpl = fetch } = {}) {
  let response
  try {
    response = await fetchImpl(RESEARCH_QUEUE_URL, { cache: 'no-store' })
  } catch (error) {
    return { ok: false, reason: `network error reaching ${RESEARCH_QUEUE_URL}: ${error?.message || error}` }
  }
  if (!response?.ok) {
    return { ok: false, reason: `${RESEARCH_QUEUE_URL} responded ${response?.status ?? 'without a response'} ${response?.statusText || ''}`.trim() }
  }

  let payload
  try {
    payload = await response.json()
  } catch (error) {
    return { ok: false, reason: `${RESEARCH_QUEUE_URL} did not parse as JSON: ${error?.message || error}` }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || payload.schemaVersion !== 1 || !Array.isArray(payload.items)) {
    return { ok: false, reason: `${RESEARCH_QUEUE_URL} has an unrecognized shape` }
  }
  if (payload.items.length > 1000) {
    return { ok: false, reason: `${RESEARCH_QUEUE_URL} contains more than 1000 queue items` }
  }

  const items = []
  const rejected = []
  const seenIds = new Set()
  payload.items.forEach((item, index) => {
    const rejection = queueItemRejection(item, index, seenIds)
    if (rejection) rejected.push(rejection)
    else items.push(item)
  })
  return { ok: true, items, rejected }
}

function queueItemMarkup(item) {
  const status = item.status === 'in-progress' ? 'in progress' : item.status
  const provenance = item.provenance.replace(/-/g, ' ')
  return `
    <li class="research-report" data-research-queue-item="${esc(item.id)}">
      <div class="research-report-body">
        <div class="research-report-head">
          <h3>${esc(item.title)}</h3>
          <dl class="research-report-meta">
            <div><dt>state</dt><dd>${esc(status)}</dd></div>
            <div><dt>origin</dt><dd>${esc(provenance)}</dd></div>
          </dl>
        </div>
        <div class="research-context">
          <p>${esc(item.observation)}</p>
        </div>
        <p class="research-authorization"><strong>Research:</strong> ${esc(item.researchQuestion)}</p>
      </div>
    </li>`
}

function researchQueueMarkup(result) {
  if (!result?.ok) return unavailableMarkup('Research queue', result?.reason)
  const items = Array.isArray(result.items) ? result.items : []
  const rejected = Array.isArray(result.rejected) ? result.rejected : []
  if (items.length === 0 && rejected.length === 0) {
    return '<p class="research-observed-empty">No research items are queued.</p>'
  }

  const rejectionNotice = rejected.length === 0 ? '' : `
    <aside class="research-unavailable research-queue-rejections" data-research-queue-rejections role="status">
      <p><strong>${esc(items.length === 0
        ? `All ${rejected.length} research queue ${rejected.length === 1 ? 'item was' : 'items were'} rejected.`
        : `${rejected.length} research queue ${rejected.length === 1 ? 'item was' : 'items were'} rejected.`)}</strong></p>
      <ol>${rejected.map(item => `
        <li>Source index ${esc(item?.index)}${typeof item?.id === 'string' ? ` · id ${esc(item.id)}` : ''}: ${esc(item?.reason || 'invalid queue item')}</li>`).join('')}
      </ol>
    </aside>`
  const queueList = items.length === 0
    ? ''
    : `<ol class="research-catalog" data-research-queue-list>${items.map(queueItemMarkup).join('')}</ol>`
  return `${rejectionNotice}${queueList}`
}

function findingMarkup(item) {
  return `<li><span>${esc(item?.status || 'unclassified')}</span><p>${esc(item?.claim || 'Finding text unavailable.')}</p></li>`
}

function taxonomyMarkup(item) {
  const count = Number.isSafeInteger(item?.count) ? String(item.count) : '—'
  return `<li><span>${esc(count)}</span><p>${esc(item?.label || 'Failure category unavailable.')}</p></li>`
}

function questionMarkup(item) {
  return `<li><p>${esc(item?.question || 'Question unavailable.')}</p><small>${esc(item?.methodToClose || 'No way to answer it was recorded.')}</small></li>`
}

function observationMarkup(observation, { label, emptyLabel, itemMarkup }) {
  if (!observation?.ok) return unavailableMarkup(label, observation?.reason)
  if (!Array.isArray(observation.value) || observation.value.length === 0) return emptyMarkup(emptyLabel)
  return `<ol class="research-register-list">${observation.value.map(itemMarkup).join('')}</ol>`
}

/* ---------- the sample face ----------
   Shown only when the page's Live data flag is off (quick settings / settings
   page). Every value below is invented for the demonstration and the mast
   says so — no file on this computer is read for it. */

const SAMPLE_QUEUE = Object.freeze({
  ok: true,
  rejected: [],
  items: [
    {
      id: 'sample-tokenizer-drift',
      title: 'Tokenizer drift between checkpoints',
      status: 'in-progress',
      provenance: 'owner-observation',
      observation: 'Two checkpoints of the same model disagree on 3% of tokenizations in the eval set.',
      researchQuestion: 'Does the drift move benchmark scores, or only token counts?',
    },
    {
      id: 'sample-judge-agreement',
      title: 'Judge model agreement on borderline answers',
      status: 'queued',
      provenance: 'run-report',
      observation: 'Two judge models agreed on 91% of clear answers but only 64% of borderline ones.',
      researchQuestion: 'Which judge disagreements predict a human overturn?',
    },
  ],
})

const SAMPLE_PROJECTION = Object.freeze({
  generatedAt: '2026-08-01T12:00:00.000Z',
  corpusCatalog: {
    ok: true,
    value: [
      {
        title: 'Example benchmark sweep — 3 models, 200 items',
        dateObserved: '2026-07-28T09:00:00.000Z',
        bytes: 48213,
        summary: 'A demonstration report: per-model scores with judge notes for each miss.',
      },
      { needsOwnerAuthorization: true, title: 'Example locked report', authorizationReason: 'This example stays locked until you authorize it — exactly how a private report behaves.' },
    ],
  },
  methodNotes: {
    ok: true,
    value: [
      { title: 'Hold the prompt fixed', guidance: 'Change one variable per cell. A prompt edit mid-sweep makes every earlier cell incomparable.' },
      { title: 'Judge twice on borderline', guidance: 'Send low-margin answers to a second judge before counting them.' },
    ],
  },
  findingsRegister: { ok: true, value: [{ status: 'supported', claim: 'Retrying after a timeout recovered nine of eleven failed runs in this example.' }] },
  failureTaxonomy: { ok: true, value: [{ count: 7, label: 'judge timeout (example category)' }] },
  openQuestions: { ok: true, value: [{ question: 'Does temperature zero flatten judge disagreement in this example set?', methodToClose: 'Re-run the borderline set at temperature zero and compare.' }] },
})

/* ---------- the workbench ---------- */

export function researchView() {
  const liveMode = isLiveView('research')

  const root = el(`
    <main class="view-pad research-page" aria-busy="true" data-live-mode="${liveMode ? 'live' : 'simulated'}">
      <div class="research-shell">
        <header class="research-mast">
          <div>
            <p class="research-eyebrow">your private research workbench</p>
            <h1>Research</h1>
          </div>
          <p class="research-source" data-research-source>${liveMode ? 'reading your research…' : 'example data — turn on Live data in settings to read your own'}</p>
        </header>

        <div class="research-modules" data-research-modules>
          <section class="research-section" aria-labelledby="research-queue-title" data-mc="queue" data-research-queue-section>
            <div class="research-section-head">
              <h2 id="research-queue-title">Research queue</h2>
              <p>Things you noticed that are waiting to be researched, each with its status and where it came from.</p>
            </div>
            <div data-research-queue data-queue-state="loading" aria-busy="true" aria-live="polite">
              <p class="research-observed-empty">Reading the research queue.</p>
            </div>
          </section>

          <section class="research-section" aria-labelledby="research-corpus-title" data-mc="library">
            <div class="research-section-head">
              <h2 id="research-corpus-title">Report library</h2>
              <p>Reports kept on this computer. Locked ones show only their title until you authorize them.</p>
            </div>
            <div data-research-library aria-live="polite">
              <p class="research-observed-empty">Reading the report catalog.</p>
            </div>
          </section>

          <section class="research-section" aria-labelledby="research-method-title" data-mc="methods">
            <div class="research-section-head">
              <h2 id="research-method-title">Method notes</h2>
              <p>The rules this research follows, written down alongside the reports rather than guessed from them.</p>
            </div>
            <div data-research-methods aria-live="polite">
              <p class="research-observed-empty">Reading the method notes.</p>
            </div>
          </section>

          <section class="research-section research-registers" aria-labelledby="research-registers-title" data-mc="worklists">
            <div class="research-section-head">
              <h2 id="research-registers-title">Working lists</h2>
              <p>What the research has found so far. A list that could not be read says so — it is never quietly shown as empty.</p>
            </div>
            <div data-research-worklists aria-live="polite">
              <p class="research-observed-empty">Reading the working lists.</p>
            </div>
          </section>

          <p class="research-observed-empty research-none-enabled" data-research-none hidden>
            Every module is switched off. Press Modules and switch one on.
          </p>
        </div>
      </div>
    </main>`)

  const shell = root.querySelector('.research-shell')
  const container = root.querySelector('[data-research-modules]')

  /* The bar and the popover are their own small templates: short button
     labels carry no sentence punctuation, and a page template that runs them
     into its prose reads as one impossible sentence to the language gate —
     and to a screen reader's continuous-read for that matter. */
  const bar = el(`
    <div class="research-bar" data-research-bar>
      <button type="button" class="m-edit-btn" data-modules-btn aria-expanded="false" aria-haspopup="true">Modules</button>
      <span class="spacer"></span>
      <button type="button" class="m-edit-btn" data-research-edit>Edit layout</button>
    </div>`)
  const popover = el(`
    <div class="research-popover" data-modules-popover hidden>
      <h3 id="research-popover-title">Workbench modules</h3>
      <div class="research-popover-list" data-modules-list role="group" aria-labelledby="research-popover-title"></div>
      <div class="research-popover-all">
        <button type="button" data-modules-all-on>All on</button>
        <button type="button" data-modules-all-off>All off</button>
      </div>
    </div>`)
  container.prepend(popover)
  container.prepend(bar)
  const editBtn = bar.querySelector('[data-research-edit]')
  const modulesBtn = bar.querySelector('[data-modules-btn]')
  const noneNote = root.querySelector('[data-research-none]')
  let destroyed = false
  let layout = null

  /* ---------- module registry ---------- */

  const MODULES = [
    { id: 'queue', title: 'Research queue', size: 'full', el: root.querySelector('[data-mc="queue"]') },
    { id: 'library', title: 'Report library', size: 'full', el: root.querySelector('[data-mc="library"]') },
    { id: 'methods', title: 'Method notes', size: 'full', el: root.querySelector('[data-mc="methods"]') },
    { id: 'worklists', title: 'Working lists', size: 'full', el: root.querySelector('[data-mc="worklists"]') },
  ]
  const STANDARD = [['queue'], ['library'], ['methods'], ['worklists']]

  const registry = createResearchRegistry({
    modules: MODULES,
    storage: typeof window === 'undefined' ? null : window.localStorage,
    onChange: () => { if (!destroyed) { remount(); syncPopover() } },
  })

  /* ---------- layout mount ----------
     Only enabled modules are handed to the engine; the standard arrangement
     is the committed order filtered to what is enabled. Toggling a module
     changes the component set, so the persisted arrangement may no longer
     validate — the engine then falls back to this filtered standard, which
     is the honest reset rather than a guessed repair. */

  function mountLayout() {
    const enabled = registry.enabled()
    noneNote.hidden = enabled.length > 0
    editBtn.hidden = enabled.length === 0
    if (enabled.length === 0) return
    const enabledIds = new Set(enabled.map(module => module.id))
    const standard = STANDARD.map(row => row.filter(id => enabledIds.has(id))).filter(row => row.length)
    for (const module of enabled) container.appendChild(module.el)
    layout = createMetricsLayout({
      container,
      filterRow: bar,
      editBtn,
      components: enabled.map(module => ({ id: module.id, title: module.title, el: module.el, size: module.size })),
      standard,
      storageKey: 'mc.research.layout',
    })
  }

  function unmountLayout() {
    layout?.destroy()
    layout = null
    container.classList.remove('m-editing')
    for (const chrome of container.querySelectorAll(':scope > .m-tray, :scope > .m-stash, :scope > .m-srow')) chrome.remove()
    for (const module of registry.all()) module.el.remove()
  }

  function remount() {
    unmountLayout()
    mountLayout()
  }

  /* ---------- the Modules popover ---------- */

  function syncPopover() {
    const list = popover.querySelector('[data-modules-list]')
    list.innerHTML = registry.all().map(module => `
      <label class="research-popover-row">
        <input type="checkbox" data-module-toggle="${esc(module.id)}" ${registry.isEnabled(module.id) ? 'checked' : ''}/>
        <span>${esc(module.title)}</span>
      </label>`).join('')
  }

  function setPopoverOpen(open) {
    popover.hidden = !open
    modulesBtn.setAttribute('aria-expanded', open ? 'true' : 'false')
    if (open) syncPopover()
  }

  modulesBtn.addEventListener('click', () => setPopoverOpen(popover.hidden))
  popover.addEventListener('change', event => {
    const id = event.target?.dataset?.moduleToggle
    if (id) registry.setEnabled(id, event.target.checked)
  })
  popover.querySelector('[data-modules-all-on]').addEventListener('click', () => registry.setAll(true))
  popover.querySelector('[data-modules-all-off]').addEventListener('click', () => registry.setAll(false))
  const onDocPointer = event => {
    if (popover.hidden) return
    if (popover.contains(event.target) || modulesBtn.contains(event.target)) return
    setPopoverOpen(false)
  }
  const onDocKey = event => { if (event.key === 'Escape' && !popover.hidden) setPopoverOpen(false) }
  document.addEventListener('pointerdown', onDocPointer)
  document.addEventListener('keydown', onDocKey)

  /* ---------- module renderers ----------
     Renderers write into their module's element whether or not it is mounted:
     a disabled module keeps its element alive off-DOM, so switching it back
     on shows the data that already arrived instead of a stuck loading line. */

  function renderResearchQueue(result) {
    const host = root.querySelector('[data-research-queue]') || MODULES[0].el.querySelector('[data-research-queue]')
    if (!host) return
    host.dataset.queueState = result?.ok ? 'ready' : 'unavailable'
    host.setAttribute('aria-busy', 'false')
    host.innerHTML = researchQueueMarkup(result)
  }

  function renderLibrary(catalog) {
    const host = MODULES[1].el.querySelector('[data-research-library]')
    host.innerHTML = !catalog?.ok
      ? unavailableMarkup('Corpus catalog', catalog?.reason)
      : !Array.isArray(catalog.value) || catalog.value.length === 0
        ? emptyMarkup('reports')
        : `<ol class="research-catalog">${catalog.value.map(report => report?.needsOwnerAuthorization === true
            ? lockedReportMarkup(report)
            : safeReportMarkup(report)).join('')}</ol>`
  }

  function renderMethods(notes) {
    const host = MODULES[2].el.querySelector('[data-research-methods]')
    host.innerHTML = !notes?.ok
      ? unavailableMarkup('Method notes', notes?.reason)
      : !Array.isArray(notes.value) || notes.value.length === 0
        ? emptyMarkup('method notes')
        : `<ol class="research-method-list">${notes.value.map((note, index) => `
            <li>
              <span class="research-method-index">${String(index + 1).padStart(2, '0')}</span>
              <div><h3>${esc(note?.title || 'Untitled method note')}</h3><p>${esc(note?.guidance || 'Guidance unavailable.')}</p></div>
            </li>`).join('')}</ol>`
  }

  function renderWorklists(data) {
    const host = MODULES[3].el.querySelector('[data-research-worklists]')
    host.innerHTML = `
      <div class="research-register-row">
        <h3>Findings</h3>
        <div>${observationMarkup(data.findingsRegister, { label: 'The findings list', emptyLabel: 'findings', itemMarkup: findingMarkup })}</div>
      </div>
      <div class="research-register-row">
        <h3>Failure categories</h3>
        <div>${observationMarkup(data.failureTaxonomy, { label: 'The failure-category list', emptyLabel: 'failure categories', itemMarkup: taxonomyMarkup })}</div>
      </div>
      <div class="research-register-row">
        <h3>Open questions</h3>
        <div>${observationMarkup(data.openQuestions, { label: 'The open-question list', emptyLabel: 'open questions', itemMarkup: questionMarkup })}</div>
      </div>`
  }

  function renderUnavailable(reason) {
    root.setAttribute('aria-busy', 'false')
    root.dataset.projectionState = 'unavailable'
    root.querySelector('[data-research-source]').textContent = 'could not be read'
    shell.insertAdjacentHTML('beforeend', `
      <section class="research-envelope-unavailable projection-state projection-unavailable" data-research-unavailable role="status">
        <strong>Your research could not be loaded</strong>
        <span>${esc(reason || 'The app was not told why.')}</span>
        <a class="host-absent-action" href="${esc(GUIDE_ACTION.href)}">${esc(GUIDE_ACTION.label)}</a>
      </section>`)
  }

  function renderProjection(envelope) {
    const data = envelope.data
    root.setAttribute('aria-busy', 'false')
    root.dataset.projectionState = 'ready'
    if (liveMode) {
      root.querySelector('[data-research-source]').textContent = `catalog generated ${formatDate(envelope.generatedAt)}`
    }
    renderLibrary(data.corpusCatalog)
    renderMethods(data.methodNotes)
    renderWorklists(data)
  }

  /* ---------- boot ---------- */

  mountLayout()

  if (liveMode) {
    fetchResearchQueue().then(result => {
      if (!destroyed) renderResearchQueue(result)
    }, error => {
      if (!destroyed) renderResearchQueue({ ok: false, reason: error?.message || String(error) })
    })

    fetchResearch().then(result => {
      if (destroyed) return
      if (!result.ok) { renderUnavailable(result.reason); return }
      renderProjection(result.data)
    }, error => {
      if (!destroyed) renderUnavailable(error?.message || String(error))
    })
  } else {
    renderResearchQueue(SAMPLE_QUEUE)
    renderProjection({ data: SAMPLE_PROJECTION })
    root.dataset.projectionState = 'simulated'
    root.setAttribute('aria-busy', 'false')
  }

  return {
    el: root,
    destroy() {
      destroyed = true
      document.removeEventListener('pointerdown', onDocPointer)
      document.removeEventListener('keydown', onDocKey)
      layout?.destroy()
    },
  }
}
