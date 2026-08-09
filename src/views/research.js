// /research — an owner-scoped catalog of curated local reports. The page
// consumes only the browser-safe research projection. Authorization-gated
// rows are deliberately rendered through a separate metadata-only branch:
// title and authorizationReason are the only payload fields that branch reads.

import { el } from '../components.js'
import { fetchResearch } from '../live-status.js'
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
  const title = report?.title || 'Authorization-gated report'
  const reason = report?.authorizationReason || 'Owner authorization is required before content use.'
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
          <span aria-hidden="true">{</span>
          <p>${esc(report?.summary || 'Curated summary unavailable.')}</p>
          <span aria-hidden="true">}</span>
        </div>
      </div>
    </li>`
}

function unavailableMarkup(label, reason) {
  return `<p class="research-unavailable projection-unavailable">${esc(label)} unavailable · ${esc(reason || 'projection did not supply a reason')}</p>`
}

function emptyMarkup(label) {
  return `<p class="research-observed-empty">No ${esc(label)} were supplied by this projection.</p>`
}

function validQueueText(value, maxLength) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength
}

function validQueueItem(item) {
  return item && typeof item === 'object' && !Array.isArray(item)
    && validQueueText(item.id, 120)
    && validQueueText(item.title, 240)
    && RESEARCH_QUEUE_STATUSES.has(item.status)
    && validQueueText(item.provenance, 80)
    && validQueueText(item.observation, 2000)
    && validQueueText(item.researchQuestion, 1000)
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
  if (payload.items.length > 1000 || !payload.items.every(validQueueItem)) {
    return { ok: false, reason: `${RESEARCH_QUEUE_URL} contains an invalid queue item` }
  }
  if (new Set(payload.items.map(item => item.id)).size !== payload.items.length) {
    return { ok: false, reason: `${RESEARCH_QUEUE_URL} contains duplicate queue item IDs` }
  }
  return { ok: true, items: payload.items }
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
          <span aria-hidden="true">{</span>
          <p>${esc(item.observation)}</p>
          <span aria-hidden="true">}</span>
        </div>
        <p class="research-authorization"><strong>Research:</strong> ${esc(item.researchQuestion)}</p>
      </div>
    </li>`
}

function researchQueueMarkup(result) {
  if (!result?.ok) return unavailableMarkup('Research queue', result?.reason)
  if (!Array.isArray(result.items) || result.items.length === 0) {
    return '<p class="research-observed-empty">No research items are queued.</p>'
  }
  return `<ol class="research-catalog" data-research-queue-list>${result.items.map(queueItemMarkup).join('')}</ol>`
}

function findingMarkup(item) {
  return `<li><span>${esc(item?.status || 'unclassified')}</span><p>${esc(item?.claim || 'Finding text unavailable.')}</p></li>`
}

function taxonomyMarkup(item) {
  const count = Number.isSafeInteger(item?.count) ? String(item.count) : '—'
  return `<li><span>${esc(count)}</span><p>${esc(item?.label || 'Failure category unavailable.')}</p></li>`
}

function questionMarkup(item) {
  return `<li><p>${esc(item?.question || 'Question unavailable.')}</p><small>${esc(item?.methodToClose || 'Method to close unavailable.')}</small></li>`
}

function observationMarkup(observation, { label, emptyLabel, itemMarkup }) {
  if (!observation?.ok) return unavailableMarkup(label, observation?.reason)
  if (!Array.isArray(observation.value) || observation.value.length === 0) return emptyMarkup(emptyLabel)
  return `<ol class="research-register-list">${observation.value.map(itemMarkup).join('')}</ol>`
}

export function researchView() {
  const root = el(`
    <main class="view-pad research-page" aria-busy="true">
      <div class="research-shell">
        <header class="research-mast">
          <div>
            <p class="research-eyebrow">owner-scoped corpus</p>
            <h1>Research</h1>
          </div>
          <p class="research-source" data-research-source>projection loading</p>
        </header>

        <section class="research-section" aria-labelledby="research-queue-title" data-research-queue-section>
          <div class="research-section-head">
            <h2 id="research-queue-title">Research queue</h2>
            <p>Owner observations awaiting research, with state and provenance kept explicit.</p>
          </div>
          <div data-research-queue data-queue-state="loading" aria-busy="true" aria-live="polite">
            <p class="research-observed-empty">Loading research queue.</p>
          </div>
        </section>

        <div class="research-loading projection-state is-loading" data-research-state role="status">
          <strong>Loading research projection</strong>
          <span>Reading the browser-safe catalog and authorization boundaries.</span>
        </div>
      </div>
    </main>`)

  const shell = root.querySelector('.research-shell')
  let destroyed = false

  function renderResearchQueue(result) {
    const host = root.querySelector('[data-research-queue]')
    if (!host) return
    host.dataset.queueState = result?.ok ? 'ready' : 'unavailable'
    host.setAttribute('aria-busy', 'false')
    host.innerHTML = researchQueueMarkup(result)
  }

  function renderUnavailable(reason) {
    root.setAttribute('aria-busy', 'false')
    root.dataset.projectionState = 'unavailable'
    root.querySelector('[data-research-source]').textContent = 'source unavailable'
    root.querySelector('[data-research-state]')?.remove()
    shell.insertAdjacentHTML('beforeend', `
      <section class="research-envelope-unavailable projection-state projection-unavailable" data-research-unavailable role="status">
        <strong>Research projection unavailable</strong>
        <span>${esc(reason || 'The projection did not supply a reason.')}</span>
      </section>`)
  }

  function renderProjection(envelope) {
    const data = envelope.data
    const catalog = data.corpusCatalog
    const notes = data.methodNotes
    root.setAttribute('aria-busy', 'false')
    root.dataset.projectionState = 'ready'
    root.querySelector('[data-research-source]').textContent = `projection generated ${formatDate(envelope.generatedAt)}`
    root.querySelector('[data-research-state]')?.remove()

    const catalogBody = !catalog?.ok
      ? unavailableMarkup('Corpus catalog', catalog?.reason)
      : !Array.isArray(catalog.value) || catalog.value.length === 0
        ? emptyMarkup('reports')
        : `<ol class="research-catalog">${catalog.value.map(report => report?.needsOwnerAuthorization === true
            ? lockedReportMarkup(report)
            : safeReportMarkup(report)).join('')}</ol>`

    const notesBody = !notes?.ok
      ? unavailableMarkup('Method notes', notes?.reason)
      : !Array.isArray(notes.value) || notes.value.length === 0
        ? emptyMarkup('method notes')
        : `<ol class="research-method-list">${notes.value.map((note, index) => `
            <li>
              <span class="research-method-index">${String(index + 1).padStart(2, '0')}</span>
              <div><h3>${esc(note?.title || 'Untitled method note')}</h3><p>${esc(note?.guidance || 'Guidance unavailable.')}</p></div>
            </li>`).join('')}</ol>`

    shell.insertAdjacentHTML('beforeend', `
      <section class="research-section" aria-labelledby="research-corpus-title">
        <div class="research-section-head">
          <h2 id="research-corpus-title">Corpus catalog</h2>
          <p>Curated local reports; gated entries remain metadata-only.</p>
        </div>
        ${catalogBody}
      </section>

      <section class="research-section" aria-labelledby="research-method-title">
        <div class="research-section-head">
          <h2 id="research-method-title">Method notes</h2>
          <p>Rules carried with the corpus, not inferred from it.</p>
        </div>
        ${notesBody}
      </section>

      <section class="research-section research-registers" aria-labelledby="research-registers-title">
        <div class="research-section-head">
          <h2 id="research-registers-title">Research registers</h2>
          <p>Unavailable evidence stays unavailable; an empty observation is named, never shown as zero.</p>
        </div>
        <div class="research-register-row">
          <h3>Findings register</h3>
          <div>${observationMarkup(data.findingsRegister, { label: 'Findings register', emptyLabel: 'findings', itemMarkup: findingMarkup })}</div>
        </div>
        <div class="research-register-row">
          <h3>Failure taxonomy</h3>
          <div>${observationMarkup(data.failureTaxonomy, { label: 'Failure taxonomy', emptyLabel: 'failure categories', itemMarkup: taxonomyMarkup })}</div>
        </div>
        <div class="research-register-row">
          <h3>Open questions</h3>
          <div>${observationMarkup(data.openQuestions, { label: 'Open questions', emptyLabel: 'open questions', itemMarkup: questionMarkup })}</div>
        </div>
      </section>`)
  }

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

  return {
    el: root,
    destroy() { destroyed = true },
  }
}
