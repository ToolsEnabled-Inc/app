// /research — an owner-scoped catalog of curated local reports. The page
// consumes only the browser-safe research projection. Authorization-gated
// rows are deliberately rendered through a separate metadata-only branch:
// title and authorizationReason are the only payload fields that branch reads.

import { el } from '../components.js'
import { fetchResearch } from '../live-status.js'
import '../research.css'

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

        <div class="research-loading projection-state is-loading" data-research-state role="status">
          <strong>Loading research projection</strong>
          <span>Reading the browser-safe catalog and authorization boundaries.</span>
        </div>
      </div>
    </main>`)

  const shell = root.querySelector('.research-shell')
  let destroyed = false

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
