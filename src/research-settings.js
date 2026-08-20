/* THE SWITCHES THE RESEARCH PAGE HAS BEEN POINTING AT.
 *
 * The research page has told people for months that "the research pipeline is
 * switched off in settings", and Settings had no such switch. There was no
 * control anywhere in this product for it, or for the three that decide what a
 * research job may actually do. The rows were declared and the refusals were
 * real; the only way to turn any of them on was to hand-write a file next to
 * the program. For a product people will run studies on, that is the feature
 * being unreachable by the person it belongs to.
 *
 * SO THIS SECTION IS THE THIRD PIECE, and the other two are somewhere else on
 * purpose. The row and its wording live in the program's own settings register,
 * beside every other permission this software asks for; the refusals are
 * enforced by the part that runs the work, in another process, which re-reads
 * the file every time it decides. This file draws the control and reports what
 * the write actually did. Nothing here decides anything.
 *
 * WHY IT DOES NOT LOOK LIKE THE ROWS AROUND IT UNDERNEATH. Every other row on
 * this page is a preference of this window, saved by this window. These four
 * are read by a different program and stored beside the program itself, so they
 * are asked for and set through the installed application rather than through
 * the window's own store. A person cannot tell the difference, which is the
 * point; the difference matters only to what has to be true for the switch to
 * mean anything.
 *
 * WHAT IT SAYS WHEN IT CANNOT DRAW A SWITCH. A copy with no research part
 * carries no register to read and nothing that would act on an answer. It says
 * that, in those words, and draws no switches at all. A dead control with an
 * explanation is still a dead control, and this page has shipped one of those
 * before.
 *
 * THE FIRST SWITCH IS A FENCE, NOT A HINT. With it off, none of the three below
 * it grants anything, whatever they say -- which is what the part that runs the
 * work does, so it is what the section shows: the three read as held, and each
 * says the first one is why.
 */

/* Four rows in the footer's count: the master and the three kinds of work. */
export const RESEARCH_SETTING_COUNT = 4

export const RESEARCH_SECTION = 'Research'

/* The ids this section draws, in the order a person meets them: the fence
   first, then what it fences. They are IDENTIFIERS, never shown as a sentence
   -- each row is titled with the register's own plain label and only carries
   its id in a data attribute, where a person never reads it. */
export const RESEARCH_SETTING_IDS = Object.freeze([
  'research.pipeline',
  'research.runner_agent',
  'research.runner_process',
  'research.runner_http',
])

const MASTER_ID = RESEARCH_SETTING_IDS[0]

const esc = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

/* A row that came back from the installed application with no plain label is
   drawn with its identifier as the title rather than a made-up name. It is the
   only place an id is allowed to reach the glass, and it means the register and
   this section disagree, which a person is better off seeing than not. */
function titleOf(row) {
  return row.label || row.id
}

/* WHAT A PERSON IS TOLD ABOUT PROVENANCE, and why it is on the row at all.
 *
 * The part that runs research work refuses a value that reads as on but was
 * never chosen by anybody -- a built-in default cannot switch a system on. So a
 * row that is on because somebody turned it on and a row that is on because a
 * file said so are different states with the same tick, and only one of them
 * makes anything run. The row says which. */
function provenanceLine(row) {
  if (row.value !== true) return ''
  const source = row.provenance && typeof row.provenance.source === 'string' ? row.provenance.source : 'default'
  if (source === 'user') return 'You turned this on.'
  if (source === 'installer') return 'This was turned on when the program was set up.'
  return 'This reads as on, but nobody chose it, so the work is still held back. Turn it off and on again to choose it.'
}

export function createResearchSettings({ shell = typeof window === 'undefined' ? null : window.mcSettings } = {}) {
  let hostRoot = null
  /* `null` means nobody has asked yet, which is not the same as having asked
     and been told there is nothing. The section says which of those it is. */
  let state = null
  let loadStarted = false
  let busy = null
  const said = new Map()

  function rowFor(id) {
    return state?.rows?.find(row => row.id === id) || null
  }

  function heldByMaster(row) {
    if (row.id === MASTER_ID) return false
    const master = rowFor(MASTER_ID)
    return Boolean(master && master.present && master.value !== true)
  }

  function statusFor(row) {
    const spoken = said.get(row.id)
    if (spoken) return spoken
    if (!row.present) return row.reason || ''
    if (heldByMaster(row)) return 'Held back: the first switch in this section is off, so nothing runs for a research project yet.'
    if (row.enforcement && row.enforcement.declared === false) {
      return 'Nothing in this copy of the program reads this yet, so moving it changes nothing.'
    }
    return provenanceLine(row)
  }

  function toggleMarkup(row) {
    if (!row.present) return ''
    const labelId = `research-setting-label-${esc(row.id)}`
    return `<label class="toggle settings-toggle">
      <input type="checkbox" data-research-setting="${esc(row.id)}" aria-labelledby="${labelId}" ${row.value === true ? 'checked' : ''} ${busy === row.id ? 'disabled' : ''}/><i></i>
    </label>`
  }

  function listMarkup(kind, items) {
    if (!Array.isArray(items) || items.length === 0) return ''
    return `<div class="guided-group">
      <span class="guided-label">${esc(kind)}</span>
      <ul class="guided-list">${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul>
    </div>`
  }

  /* THE SAME DISCLOSURE EVERY OTHER ROW ON THIS PAGE CARRIES.
   *
   * src/guided-step.js hangs one of these under every row, and it is not
   * decoration: the product's rule is that a person deciding whether to move a
   * switch is asking two separate questions -- what does this let happen that
   * cannot happen now, and what can go wrong if I do it -- and the row has to
   * answer both, separately, in the same place on every row.
   *
   * These four rows are drawn from the installation's own settings register
   * rather than from the window's declaration table, so the element is built
   * here instead of asked for. The shape is deliberately identical -- same
   * element, same classes, same data attributes -- because a surface that
   * carried its own private variant would be exactly the kind of row a sweep
   * over the page cannot check, and tools/guided-permissions-qa.mjs sweeps
   * every .settings-row[data-setting-id] on the page for precisely this.
   *
   * `declared` is true because these rows ARE declared: the capabilities and
   * risks below are the register's own statements about them. A row the
   * register does not cover says so and declares nothing, rather than showing
   * an empty disclosure that reads as "this one has no risks". */
  function disclosureMarkup(row) {
    const declared = row.present && ((row.capabilities || []).length > 0 || (row.risks || []).length > 0)
    if (!declared) {
      return `<details class="guided-note is-undeclared" data-guided-for="${esc(row.id)}" data-guided-declared="false">
        <summary class="guided-summary">What this does, and what it risks</summary>
        <div class="guided-body">
          <p class="settings-desc">This computer's register says nothing about this switch. This page will not invent it.</p>
        </div>
      </details>`
    }
    return `<details class="guided-note" data-guided-for="${esc(row.id)}" data-guided-declared="true">
      <summary class="guided-summary">What this does, and what it risks</summary>
      <div class="guided-body">
        ${row.consequence ? `<p class="settings-desc">${esc(row.consequence)}</p>` : ''}
        ${listMarkup('What it lets happen', row.capabilities)}
        ${listMarkup('What it risks', row.risks)}
      </div>
    </details>`
  }

  /* The same row anatomy as every other row on the page: name — state
     sentence — description — control — disclosure, with the disclosure on a
     grid row of its own under both columns. Opening it therefore never moves
     the switch under the pointer, which is the measured hazard the settings
     page's own rows were rebuilt around. */
  function rowMarkup(row) {
    const status = statusFor(row)
    return `<article class="settings-row" data-setting-id="${esc(row.id)}" data-research-setting-row="${esc(row.id)}">
      <div class="settings-copy">
        <div class="settings-name" id="research-setting-label-${esc(row.id)}">${esc(titleOf(row))}</div>
        ${status ? `<div class="settings-state" data-research-setting-status="${esc(row.id)}">${esc(status)}</div>` : ''}
        <div class="settings-desc">${esc(row.consequence || row.reason || '')}</div>
      </div>
      <div class="settings-control">${toggleMarkup(row)}</div>
      <div class="settings-disclosure">${disclosureMarkup(row)}</div>
    </article>`
  }

  function bodyMarkup() {
    if (!shell) {
      return `<p class="settings-section-note host-absent-body" data-research-settings-absent>This window could not reach the installed application, so it cannot show these switches. Close it and open it again.</p>`
    }
    if (state === null) {
      return '<p class="settings-section-note host-absent-body">Reading what this computer is set to.</p>'
    }
    if (state.available !== true) {
      return `<p class="settings-section-note host-absent-body" data-research-settings-absent>${esc(state.reason || 'This copy does not carry the part that runs research work, so there is nothing to switch on.')}</p>`
    }
    return `<p class="settings-section-note host-absent-body">The first switch decides whether anything runs for a research project on this computer. The three under it decide what kind of work is allowed. With the first one off, none of the three grants anything.</p>
      ${state.rows.map(rowMarkup).join('')}`
  }

  function markup({ searchResult = false } = {}) {
    return `<section class="settings-section" data-settings-section="${esc(RESEARCH_SECTION)}" data-research-settings>
      ${searchResult ? '<div class="settings-prefix">Research, what may run on this computer</div>' : ''}
      <h2 class="settings-section-title">${esc(RESEARCH_SECTION)}</h2>
      <div class="settings-section-rows">${bodyMarkup()}</div>
    </section>`
  }

  function refresh() {
    if (!hostRoot) return
    const current = hostRoot.querySelector('[data-research-settings]')
    if (!current) return
    const searchResult = current.querySelector('.settings-prefix') !== null
    current.outerHTML = markup({ searchResult })
  }

  async function load({ force = false } = {}) {
    if (!shell) return
    if (loadStarted && !force) return
    loadStarted = true
    let answer = null
    try { answer = await shell.read() } catch (error) { answer = null }
    state = answer && answer.ok
      ? answer
      : { ok: true, available: false, reason: 'This computer did not answer when asked what it is set to. Open Settings again in a moment.', rows: [] }
    refresh()
  }

  /* THE WRITE, AND WHAT IS SAID ABOUT IT.
   *
   * The tick is not moved by the browser and then reconciled: the control is
   * put out of use, the installed application is asked, and whatever comes back
   * is what gets drawn. A switch that flips and then flips back is how a person
   * learns not to trust a settings page, and a switch that flips and stays
   * while nothing changed underneath is worse. */
  async function setValue(id, next) {
    if (!shell || busy) return
    const row = rowFor(id)
    if (!row || !row.present) return
    busy = id
    said.set(id, next ? 'Turning it on.' : 'Turning it off.')
    refresh()
    let result = null
    try { result = await shell.set(id, next) } catch (error) { result = null }
    busy = null
    if (!result || result.ok !== true) {
      said.set(id, result?.reason || 'This computer did not accept the change, so nothing was changed. Try again in a moment.')
      await load({ force: true })
      return
    }
    /* RECORDED, OR SAID NOT TO BE. Turning one of these on is a permission
       being granted, and this product writes those into a signed record. A
       change that could not be written there is still a change the person made
       -- putting it back because a log was unavailable would be the worse lie
       -- so it stands and the row says the record is missing it. */
    const recorded = result.recorded && result.recorded.ok === true
    said.set(id, next
      ? (recorded ? 'Turned on, and written to this computer’s signed record.' : 'Turned on. It could not be written to the signed record.')
      : (recorded ? 'Turned off, and written to this computer’s signed record.' : 'Turned off. It could not be written to the signed record.'))
    await load({ force: true })
  }

  function handleChange(event) {
    const box = event.target.closest('[data-research-setting]')
    if (!box || !hostRoot?.contains(box)) return
    void setValue(box.dataset.researchSetting, box.checked === true)
  }

  function matches(query) {
    const normalized = String(query || '').trim().toLowerCase()
    if (!normalized) return true
    const haystack = [
      'research runs jobs projects experiments queue pipeline assistants programs web services on this computer',
      ...(state?.rows || []).flatMap(row => [
        titleOf(row), row.consequence || '', ...(row.capabilities || []), ...(row.risks || []),
      ]),
    ].join(' ').toLowerCase()
    return haystack.includes(normalized)
  }

  function bind(root) {
    hostRoot = root
    root.addEventListener('change', handleChange)
  }

  function afterRender(root = hostRoot) {
    hostRoot = root
    void load()
  }

  function destroy() {
    if (hostRoot) hostRoot.removeEventListener('change', handleChange)
    hostRoot = null
  }

  return Object.freeze({ markup, matches, bind, afterRender, destroy, load })
}
