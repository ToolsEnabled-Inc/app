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
/* Single-line on purpose: research-queue-degradation.test.mjs re-evaluates
   this module with every `^import` LINE stripped, so a wrapped import would
   leave its tail behind as garbage. */
import { RESEARCH_QUEUE_ROW_KEY, advanceItem, buildOwnItem, mergeQueueForRender, nextStatus, parseQueueRow, removeOwnItem } from '../research-queue-store.js'
import { RESEARCH_EXPERIMENTS_EVENT, RESEARCH_EXPERIMENTS_ROW_KEY, buildExperiment, dispatchExperiment, experimentsSnapshot, parseExperimentsRow, removeExperiment, seedExperiments } from '../research-experiments.js'
import { localTiersStatus } from '../mission-bridge.js'
import { TIER_CHOICES, DEFAULT_TIER } from '../fleet-tree-copy.js'
import { startAgentForNode } from './computers.js'
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

function queueItemMarkup(item, controls = '') {
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
        <p class="research-authorization"><strong>Research:</strong> ${esc(item.researchQuestion)}</p>${controls}
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

const SAMPLE_EXPERIMENT = Object.freeze({
  id: 'sample-experiment',
  name: 'Example sweep — two tiers, two runs',
  promptTemplate: 'Summarize the dataset at {dataset} in three sentences.',
  datasetPath: 'C:\\examples\\dataset.jsonl',
  createdAtMs: 0,
  treeId: null,
  cells: [
    { tier: 'luna', run: 1, status: 'finished', sessionId: null, nodeId: null, startedAtMs: 0, endedAtMs: 41000, replyExcerpt: 'The example dataset holds 200 rows of paired prompts and answers.' },
    { tier: 'luna', run: 2, status: 'finished', sessionId: null, nodeId: null, startedAtMs: 0, endedAtMs: 38000, replyExcerpt: 'A second pass reads the same 200 rows and agrees with the first.' },
    { tier: 'terra', run: 1, status: 'failed', sessionId: null, nodeId: null, startedAtMs: 0, endedAtMs: 12000, replyExcerpt: 'This example cell shows what a refused start looks like.' },
    { tier: 'terra', run: 2, status: 'running', sessionId: null, nodeId: null, startedAtMs: 0, endedAtMs: null, replyExcerpt: '' },
  ],
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
          <section class="research-section" aria-labelledby="research-designer-title" data-mc="designer">
            <div class="research-section-head">
              <h2 id="research-designer-title">Experiment designer</h2>
              <p>Define a run: the task each worker gets, the dataset path they read, the model tiers, and runs per tier. Workers start as nodes on the computers page.</p>
            </div>
            <div data-research-designer aria-live="polite">
              <p class="research-observed-empty">Reading your experiments.</p>
            </div>
          </section>

          <section class="research-section" aria-labelledby="research-runboard-title" data-mc="runboard">
            <div class="research-section-head">
              <h2 id="research-runboard-title">Run board</h2>
              <p>Every cell of a running experiment, with its live state. The workers themselves stream on the computers page.</p>
            </div>
            <div data-research-runboard aria-live="polite">
              <p class="research-observed-empty">Nothing is running yet.</p>
            </div>
          </section>

          <section class="research-section" aria-labelledby="research-results-title" data-mc="results">
            <div class="research-section-head">
              <h2 id="research-results-title">Results</h2>
              <p>What each cell answered, with timings. Copy a table out as CSV or JSON when you want it elsewhere.</p>
            </div>
            <div data-research-results aria-live="polite">
              <p class="research-observed-empty">No results have arrived yet.</p>
            </div>
          </section>

          <section class="research-section" aria-labelledby="research-tiers-title" data-mc="tiers">
            <div class="research-section-head">
              <h2 id="research-tiers-title">Local advisory tiers</h2>
              <p>What the two fixed local models on this computer can do right now, and the reason when one cannot.</p>
            </div>
            <div data-research-tiers aria-live="polite">
              <p class="research-observed-empty">Reading the local tiers.</p>
            </div>
          </section>

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
    { id: 'designer', title: 'Experiment designer', size: 'full', el: root.querySelector('[data-mc="designer"]') },
    { id: 'runboard', title: 'Run board', size: 'full', el: root.querySelector('[data-mc="runboard"]') },
    { id: 'results', title: 'Results', size: 'full', el: root.querySelector('[data-mc="results"]') },
    { id: 'tiers', title: 'Local advisory tiers', size: 'full', el: root.querySelector('[data-mc="tiers"]') },
    { id: 'queue', title: 'Research queue', size: 'full', el: root.querySelector('[data-mc="queue"]') },
    { id: 'library', title: 'Report library', size: 'full', el: root.querySelector('[data-mc="library"]') },
    { id: 'methods', title: 'Method notes', size: 'full', el: root.querySelector('[data-mc="methods"]') },
    { id: 'worklists', title: 'Working lists', size: 'full', el: root.querySelector('[data-mc="worklists"]') },
  ]
  const STANDARD = [['designer'], ['runboard'], ['results'], ['tiers'], ['queue'], ['library'], ['methods'], ['worklists']]
  const moduleEl = id => MODULES.find(module => module.id === id).el

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
    const host = root.querySelector('[data-research-queue]') || moduleEl('queue').querySelector('[data-research-queue]')
    if (!host) return
    host.dataset.queueState = result?.ok ? 'ready' : 'unavailable'
    host.setAttribute('aria-busy', 'false')
    host.innerHTML = researchQueueMarkup(result)
  }

  /* ---------- the writable queue (live mode) ----------
     The shipped catalog renders read-only; the researcher's own notes and the
     status overrides for shipped items live in ONE account row
     (research_queue, src/research-queue-store.js). The two halves fail
     independently: a broken shipped file still shows your notes, and a
     signed-out session still shows the shipped catalog with a sentence in
     place of the form. */

  const account = typeof window === 'undefined' ? null : window.mcAccount
  let queueRow = { items: [], statusOverrides: {}, damaged: false }
  let queueSignedOut = false
  let authoredQueue = null

  async function readQueueRow() {
    if (!account?.getSetting) { queueSignedOut = true; return }
    let read = null
    try { read = await account.getSetting(RESEARCH_QUEUE_ROW_KEY) } catch {}
    if (!read || read.ok !== true) {
      queueSignedOut = true
      return
    }
    queueSignedOut = false
    queueRow = parseQueueRow(typeof read.value === 'string' ? read.value : null)
  }

  async function persistQueueRow(serialized) {
    if (!account?.putSetting) return { ok: false, sentence: 'Sign in to keep notes — they belong to your account.' }
    let result = null
    try { result = await account.putSetting(RESEARCH_QUEUE_ROW_KEY, serialized) } catch {}
    if (!result || result.ok !== true) {
      return { ok: false, sentence: 'That was not saved. Sign in, then try it again.' }
    }
    return { ok: true }
  }

  function queueControlsMarkup(item) {
    const to = nextStatus(item.status)
    return `
      <div class="research-queue-controls">
        ${to ? `<button type="button" data-queue-advance="${esc(item.id)}" data-queue-status="${esc(item.status)}" data-queue-own="${item.own ? 'true' : 'false'}">Move to ${esc(to === 'in-progress' ? 'in progress' : to)}</button>` : ''}
        ${item.own ? `<button type="button" data-queue-remove="${esc(item.id)}">Remove</button>` : ''}
      </div>`
  }

  function queueFormMarkup() {
    if (queueSignedOut) {
      return '<p class="research-observed-empty">Sign in to write notes here — they are kept with your account.</p>'
    }
    return `
      <form class="research-queue-form" data-queue-form>
        <input name="title" maxlength="240" placeholder="What did you notice? A short title." aria-label="Title"/>
        <textarea name="observation" maxlength="2000" rows="2" placeholder="The observation, in your words." aria-label="Observation"></textarea>
        <textarea name="researchQuestion" maxlength="1000" rows="2" placeholder="The question that would settle it." aria-label="Research question"></textarea>
        <div class="research-queue-form-row">
          <button type="submit">Add to the queue</button>
          <span class="research-queue-form-status" data-queue-form-status role="status"></span>
        </div>
      </form>`
  }

  function renderQueueModuleLive() {
    const host = moduleEl('queue').querySelector('[data-research-queue]')
    if (!host) return
    const authoredItems = authoredQueue?.ok ? authoredQueue.items : []
    const rejected = authoredQueue?.ok ? authoredQueue.rejected : []
    const merged = mergeQueueForRender(authoredItems, queueRow)
    const shippedNote = authoredQueue && !authoredQueue.ok
      ? unavailableMarkup('The shipped research queue', authoredQueue.reason)
      : ''
    const rejectionNote = rejected.length === 0 ? '' : `
      <aside class="research-unavailable research-queue-rejections" data-research-queue-rejections role="status">
        <p><strong>${esc(`${rejected.length} shipped queue ${rejected.length === 1 ? 'item was' : 'items were'} rejected.`)}</strong></p>
        <ol>${rejected.map(item => `
          <li>Source index ${esc(item?.index)}${typeof item?.id === 'string' ? ` · id ${esc(item.id)}` : ''}: ${esc(item?.reason || 'invalid queue item')}</li>`).join('')}
        </ol>
      </aside>`
    const damagedNote = queueRow.damaged
      ? '<p class="research-unavailable projection-unavailable">Your saved notes could not be read, so only the shipped queue is shown. New notes will overwrite the unreadable ones.</p>'
      : ''
    const list = merged.length === 0
      ? '<p class="research-observed-empty">No research items are queued.</p>'
      : `<ol class="research-catalog" data-research-queue-list>${merged.map(item => queueItemMarkup(item, queueControlsMarkup(item))).join('')}</ol>`
    host.dataset.queueState = 'ready'
    host.setAttribute('aria-busy', 'false')
    host.innerHTML = `${queueFormMarkup()}${damagedNote}${shippedNote}${rejectionNote}${list}`
  }

  moduleEl('queue').addEventListener('submit', async event => {
    if (!event.target?.hasAttribute?.('data-queue-form')) return
    event.preventDefault()
    const form = event.target
    const status = form.querySelector('[data-queue-form-status]')
    const built = buildOwnItem({
      title: form.elements.title.value,
      observation: form.elements.observation.value,
      researchQuestion: form.elements.researchQuestion.value,
    }, queueRow)
    if (!built.ok) { if (status) status.textContent = built.sentence; return }
    const saved = await persistQueueRow(built.serialized)
    if (!saved.ok) { if (status) status.textContent = saved.sentence; return }
    queueRow = { ...built.next, damaged: false }
    renderQueueModuleLive()
  })

  moduleEl('queue').addEventListener('click', async event => {
    const advanceId = event.target?.dataset?.queueAdvance
    const removeId = event.target?.dataset?.queueRemove
    if (!advanceId && !removeId) return
    const result = advanceId
      ? advanceItem(queueRow, {
          id: advanceId,
          own: event.target.dataset.queueOwn === 'true',
          currentStatus: event.target.dataset.queueStatus,
        })
      : removeOwnItem(queueRow, removeId)
    if (!result.ok) { event.target.textContent = result.sentence; return }
    const saved = await persistQueueRow(result.serialized)
    if (!saved.ok) { event.target.textContent = saved.sentence; return }
    queueRow = { ...result.next, damaged: false }
    renderQueueModuleLive()
  })

  function renderLibrary(catalog) {
    const host = moduleEl('library').querySelector('[data-research-library]')
    host.innerHTML = !catalog?.ok
      ? unavailableMarkup('Corpus catalog', catalog?.reason)
      : !Array.isArray(catalog.value) || catalog.value.length === 0
        ? emptyMarkup('reports')
        : `<ol class="research-catalog">${catalog.value.map(report => report?.needsOwnerAuthorization === true
            ? lockedReportMarkup(report)
            : safeReportMarkup(report)).join('')}</ol>`
  }

  function renderMethods(notes) {
    const host = moduleEl('methods').querySelector('[data-research-methods]')
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
    const host = moduleEl('worklists').querySelector('[data-research-worklists]')
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

  /* ---------- the experiment bench ----------
     Specs and results live in the research_experiments account row through
     src/research-experiments.js, which also owns the dispatcher and the
     module-level results listener. This view only renders snapshots and
     forwards presses; nothing here holds worker state of its own. */

  let experimentsSignedOut = false

  async function readExperimentsRow() {
    if (!account?.getSetting) { experimentsSignedOut = true; seedExperiments({ experiments: [], damaged: false }); return }
    let read = null
    try { read = await account.getSetting(RESEARCH_EXPERIMENTS_ROW_KEY) } catch {}
    if (!read || read.ok !== true) {
      experimentsSignedOut = true
      seedExperiments({ experiments: [], damaged: false })
      return
    }
    experimentsSignedOut = false
    seedExperiments(parseExperimentsRow(typeof read.value === 'string' ? read.value : null))
  }

  async function persistExperiments(serialized) {
    if (!account?.putSetting) return { ok: false, sentence: 'Sign in to keep experiments — they belong to your account.' }
    let result = null
    try { result = await account.putSetting(RESEARCH_EXPERIMENTS_ROW_KEY, serialized) } catch {}
    if (!result || result.ok !== true) return { ok: false, sentence: 'That was not saved. Sign in, then try it again.' }
    return { ok: true }
  }

  const CELL_WORD = Object.freeze({ designed: 'designed', starting: 'starting', running: 'running', finished: 'finished', failed: 'failed' })

  function cellDuration(cell) {
    if (!Number.isFinite(cell.startedAtMs) || !Number.isFinite(cell.endedAtMs)) return ''
    const seconds = Math.max(0, Math.round((cell.endedAtMs - cell.startedAtMs) / 1000))
    return `${seconds}s`
  }

  function tierWord(id) {
    return TIER_CHOICES.find(choice => choice.id === id)?.label || id
  }

  function renderDesigner() {
    const host = moduleEl('designer').querySelector('[data-research-designer]')
    if (!host) return
    if (experimentsSignedOut) {
      host.innerHTML = '<p class="research-observed-empty">Sign in to design experiments — they are kept with your account.</p>'
      return
    }
    const { experiments, damaged } = experimentsSnapshot()
    const damagedNote = damaged
      ? '<p class="research-unavailable projection-unavailable">Your saved experiments could not be read. New ones will overwrite the unreadable record.</p>'
      : ''
    const list = experiments.length === 0
      ? '<p class="research-observed-empty">No experiments are designed yet.</p>'
      : `<ol class="research-catalog">${experiments.map(experiment => `
          <li class="research-report" data-research-experiment="${esc(experiment.id)}">
            <div class="research-report-body">
              <div class="research-report-head">
                <h3>${esc(experiment.name)}</h3>
                <dl class="research-report-meta">
                  <div><dt>cells</dt><dd>${experiment.cells.length}</dd></div>
                  <div><dt>tiers</dt><dd>${esc([...new Set(experiment.cells.map(cell => cell.tier))].join(', '))}</dd></div>
                </dl>
              </div>
              <div class="research-context"><p>${esc(experiment.promptTemplate.slice(0, 200))}</p></div>
              ${experiment.datasetPath ? `<p class="research-authorization"><strong>Dataset:</strong> ${esc(experiment.datasetPath)}</p>` : ''}
              <div class="research-queue-controls">
                <button type="button" data-exp-run="${esc(experiment.id)}">Run on the tree</button>
                <button type="button" data-exp-remove="${esc(experiment.id)}">Remove</button>
              </div>
            </div>
          </li>`).join('')}</ol>`
    host.innerHTML = `
      <form class="research-queue-form" data-exp-form>
        <input name="name" maxlength="120" placeholder="Name this experiment." aria-label="Experiment name"/>
        <textarea name="promptTemplate" maxlength="2000" rows="3" placeholder="The task each worker runs. Write {dataset} where the dataset path belongs." aria-label="Task template"></textarea>
        <input name="datasetPath" maxlength="400" placeholder="Dataset path on this computer, if the task reads one. Workers read it under their own permissions." aria-label="Dataset path"/>
        <div class="research-designer-tiers" role="group" aria-label="Model tiers">
          ${TIER_CHOICES.map(choice => `
            <label class="research-popover-row"><input type="checkbox" name="tier" value="${esc(choice.id)}" ${choice.id === DEFAULT_TIER ? 'checked' : ''}/><span>${esc(choice.label)}</span></label>`).join('')}
        </div>
        <div class="research-queue-form-row">
          <label class="research-popover-row">Runs per tier
            <select name="runsPerTier"><option value="1">1</option><option value="2">2</option><option value="3">3</option></select>
          </label>
          <button type="submit">Save the experiment</button>
          <span class="research-queue-form-status" data-exp-form-status role="status"></span>
        </div>
      </form>
      ${damagedNote}${list}`
  }

  function renderRunBoard() {
    const host = moduleEl('runboard').querySelector('[data-research-runboard]')
    if (!host) return
    const { experiments } = experimentsSnapshot()
    const active = experiments.filter(experiment => experiment.cells.some(cell => cell.status !== 'designed'))
    if (active.length === 0) {
      host.innerHTML = '<p class="research-observed-empty">Nothing is running yet. Save an experiment above, then press its Run control.</p>'
      return
    }
    host.innerHTML = active.map(experiment => `
      <div class="research-runboard-exp" data-runboard-exp="${esc(experiment.id)}">
        <h3>${esc(experiment.name)}</h3>
        <div class="research-runboard-cells">
          ${experiment.cells.map(cell => `
            <span class="research-cell is-${esc(cell.status)}">${esc(tierWord(cell.tier))} · run ${cell.run} · ${esc(CELL_WORD[cell.status] || cell.status)}${cellDuration(cell) ? ` · ${cellDuration(cell)}` : ''}</span>`).join('')}
        </div>
        <p class="research-observed-empty">The workers are nodes on the computers page — watch them stream there.</p>
      </div>`).join('')
  }

  function renderResults() {
    const host = moduleEl('results').querySelector('[data-research-results]')
    if (!host) return
    const { experiments } = experimentsSnapshot()
    const finished = experiments.filter(experiment => experiment.cells.some(cell => cell.status === 'finished' || cell.status === 'failed'))
    if (finished.length === 0) {
      host.innerHTML = '<p class="research-observed-empty">No results have arrived yet.</p>'
      return
    }
    host.innerHTML = finished.map(experiment => `
      <div class="research-results-exp" data-results-exp="${esc(experiment.id)}">
        <div class="research-report-head">
          <h3>${esc(experiment.name)}</h3>
          <div class="research-queue-controls">
            <button type="button" data-results-csv="${esc(experiment.id)}">Copy as CSV</button>
            <button type="button" data-results-json="${esc(experiment.id)}">Copy as JSON</button>
          </div>
        </div>
        <div class="research-results-scroll"><table class="research-results-table">
          <thead><tr><th>tier</th><th>run</th><th>state</th><th>took</th><th>answer</th></tr></thead>
          <tbody>
            ${experiment.cells.map(cell => `
              <tr><td>${esc(cell.tier)}</td><td>${cell.run}</td><td>${esc(cell.status)}</td><td>${esc(cellDuration(cell) || '—')}</td><td>${esc(cell.replyExcerpt || '—')}</td></tr>`).join('')}
          </tbody>
        </table></div>
        <p class="research-queue-form-status" data-results-status="${esc(experiment.id)}" role="status"></p>
      </div>`).join('')
  }

  function experimentExport(experiment, format) {
    if (format === 'json') {
      return JSON.stringify({ name: experiment.name, cells: experiment.cells.map(cell => ({ tier: cell.tier, run: cell.run, status: cell.status, startedAtMs: cell.startedAtMs, endedAtMs: cell.endedAtMs, reply: cell.replyExcerpt })) }, null, 2)
    }
    const escape = value => `"${String(value ?? '').replace(/"/g, '""')}"`
    const rows = [['tier', 'run', 'status', 'startedAtMs', 'endedAtMs', 'reply']]
    for (const cell of experiment.cells) rows.push([cell.tier, cell.run, cell.status, cell.startedAtMs, cell.endedAtMs, cell.replyExcerpt])
    return rows.map(row => row.map(escape).join(',')).join('\n')
  }

  function renderExperimentModules() {
    renderDesigner()
    renderRunBoard()
    renderResults()
  }

  moduleEl('designer').addEventListener('submit', async event => {
    if (!event.target?.hasAttribute?.('data-exp-form')) return
    event.preventDefault()
    const form = event.target
    const status = form.querySelector('[data-exp-form-status]')
    const built = buildExperiment({
      name: form.elements.name.value,
      promptTemplate: form.elements.promptTemplate.value,
      datasetPath: form.elements.datasetPath.value,
      tiers: [...form.querySelectorAll('input[name="tier"]:checked')].map(input => input.value),
      runsPerTier: Number(form.elements.runsPerTier.value),
    }, experimentsSnapshot())
    if (!built.ok) { if (status) status.textContent = built.sentence; return }
    const saved = await persistExperiments(built.serialized)
    if (!saved.ok) { if (status) status.textContent = saved.sentence; return }
    seedExperiments({ experiments: built.next.experiments, damaged: false })
    renderExperimentModules()
  })

  moduleEl('designer').addEventListener('click', async event => {
    const runId = event.target?.dataset?.expRun
    const removeId = event.target?.dataset?.expRemove
    if (runId) {
      event.target.disabled = true
      event.target.textContent = 'Starting the workers…'
      const outcome = await dispatchExperiment(runId, {
        agent: typeof window === 'undefined' ? null : window.mcAgent,
        persist: serialized => account.putSetting(RESEARCH_EXPERIMENTS_ROW_KEY, serialized),
        startAgent: startAgentForNode,
      })
      if (!outcome.ok) {
        event.target.disabled = false
        event.target.textContent = outcome.sentence
        return
      }
      renderExperimentModules()
      return
    }
    if (removeId) {
      const result = removeExperiment(experimentsSnapshot(), removeId)
      if (!result.ok) { event.target.textContent = result.sentence; return }
      const saved = await persistExperiments(result.serialized)
      if (!saved.ok) { event.target.textContent = saved.sentence; return }
      seedExperiments({ experiments: result.next.experiments, damaged: false })
      renderExperimentModules()
    }
  })

  moduleEl('results').addEventListener('click', async event => {
    const csvId = event.target?.dataset?.resultsCsv
    const jsonId = event.target?.dataset?.resultsJson
    if (!csvId && !jsonId) return
    const id = csvId || jsonId
    const experiment = experimentsSnapshot().experiments.find(candidate => candidate.id === id)
    if (!experiment) return
    const status = moduleEl('results').querySelector(`[data-results-status="${id}"]`)
    try {
      await navigator.clipboard.writeText(experimentExport(experiment, csvId ? 'csv' : 'json'))
      if (status) status.textContent = 'Copied. Paste it where you need it.'
    } catch {
      if (status) status.textContent = 'Select the table and copy it by hand — the clipboard refused this copy.'
    }
  })

  const onExperimentsChanged = () => { if (!destroyed) renderExperimentModules() }
  window.addEventListener(RESEARCH_EXPERIMENTS_EVENT, onExperimentsChanged)

  /* ---------- the local tiers panel ----------
     Read from the bridge's GET route — the same reading the engine's own MCP
     tool serves. Reason codes are machine identifiers; they render with their
     underscores turned to spaces rather than being hidden, because "another
     local model is resident" is exactly what a researcher needs to know. */

  function tierRowMarkup(word, tier) {
    if (!tier || typeof tier !== 'object') return ''
    const state = tier.enabled !== true
      ? 'switched off in settings'
      : tier.ready === true
        ? 'ready'
        : `not ready · ${esc(String(tier.reason || 'the app was not told why').replace(/_/g, ' '))}`
    return `
      <div class="research-register-row">
        <h3>${esc(word)}</h3>
        <div><p>${esc(tier.model || 'The model name was not reported.')} — ${state}</p></div>
      </div>`
  }

  function renderTiers(result) {
    const host = moduleEl('tiers').querySelector('[data-research-tiers]')
    if (!host) return
    if (!result?.ok || !result.receipt) {
      /* The refusal CODE is the useful half — the message is a scrubbed
         generic by design. MODEL_NO_GPU_PEER_CONFIGURED, rendered in words,
         tells a single-machine researcher exactly what is going on. */
      const reason = result?.code === 'MODEL_NO_GPU_PEER_CONFIGURED'
        ? 'no local model host is set up on this computer yet'
        : typeof result?.code === 'string' && result.code.length > 0
          ? result.code.toLowerCase().replace(/_/g, ' ')
          : result?.reason
      host.innerHTML = unavailableMarkup('The local tiers', reason)
      return
    }
    const receipt = result.receipt
    const facts = [
      Number.isSafeInteger(receipt.freeRamMiB) ? `${Math.round(receipt.freeRamMiB / 1024)} GB RAM free` : null,
      Number.isSafeInteger(receipt.freeVramMiB) ? `${Math.round(receipt.freeVramMiB / 1024)} GB VRAM free` : null,
      Number.isFinite(receipt.gpuTemperatureC) ? `GPU ${receipt.gpuTemperatureC}°C` : null,
      receipt.onBattery === true ? 'on battery — heavy runs pause' : null,
    ].filter(Boolean).join(' · ')
    host.innerHTML = `
      ${facts ? `<p class="research-observed-empty">${esc(facts)}</p>` : ''}
      ${tierRowMarkup('Fast', receipt.fast)}
      ${tierRowMarkup('Strong', receipt.strong)}`
  }

  /* ---------- boot ---------- */

  mountLayout()

  if (liveMode) {
    Promise.all([
      fetchResearchQueue().catch(error => ({ ok: false, reason: error?.message || String(error) })),
      readQueueRow(),
    ]).then(([authored]) => {
      if (destroyed) return
      authoredQueue = authored
      renderQueueModuleLive()
    })

    readExperimentsRow().then(() => {
      if (!destroyed) renderExperimentModules()
    })

    localTiersStatus().then(result => {
      if (!destroyed) renderTiers(result)
    }, error => {
      if (!destroyed) renderTiers({ ok: false, reason: error?.message || String(error) })
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
    seedExperiments({ experiments: [SAMPLE_EXPERIMENT], damaged: false })
    renderRunBoard()
    renderResults()
    renderTiers({
      ok: true,
      receipt: {
        freeRamMiB: 24576, freeVramMiB: 10240, gpuTemperatureC: 41, onBattery: false,
        fast: { model: 'hermes3:8b', enabled: true, ready: true, reason: null },
        strong: { model: 'gpt-oss:20b', enabled: true, ready: false, reason: 'fresh_load_free_vram_below_6.5GiB' },
      },
    })
    const designerHost = moduleEl('designer').querySelector('[data-research-designer]')
    if (designerHost) designerHost.innerHTML = '<p class="research-observed-empty">This is the example face. Turn on Live data in settings to design experiments of your own.</p>'
    root.dataset.projectionState = 'simulated'
    root.setAttribute('aria-busy', 'false')
  }

  return {
    el: root,
    destroy() {
      destroyed = true
      document.removeEventListener('pointerdown', onDocPointer)
      document.removeEventListener('keydown', onDocKey)
      window.removeEventListener(RESEARCH_EXPERIMENTS_EVENT, onExperimentsChanged)
      layout?.destroy()
    },
  }
}
