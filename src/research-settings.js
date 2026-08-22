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
 * this page is a preference of this window, saved by this window. These are
 * read by a different program and stored beside the program itself, so they
 * are asked for and set through the installed application rather than through
 * the window's own store. A person cannot tell the difference, which is the
 * point; the difference matters only to what has to be true for the switch to
 * mean anything.
 *
 * IT IS NOT A RESEARCH SECTION, WHICH IS WHY IT IS NO LONGER CALLED ONE. It
 * draws every setting the installed application will let this window write, and
 * on 2026-08-20 that stopped being only the research family. What binds these
 * rows together is where they live and who enforces them, not what they are
 * about.
 *
 * WHAT IT SAYS WHEN IT CANNOT DRAW A SWITCH. A copy with no research part
 * carries no register to read and nothing that would act on an answer. It says
 * that, in those words, and draws no switches at all. A dead control with an
 * explanation is still a dead control, and this page has shipped one of those
 * before.
 *
 * THE FIRST SWITCH IS A FENCE, NOT A HINT -- AND IT FENCES THREE ROWS, NOT
 * EVERYTHING UNDER IT. With it off, none of the three research runner rows
 * grants anything, whatever they say, which is what the part that runs the work
 * does; so it is what the section shows, and each of the three says the first
 * one is why. It has no authority over anything outside the research family,
 * and until 2026-08-20 this section claimed otherwise about a row it did not
 * govern. See RESEARCH_FENCED_IDS.
 */

/* THE SECTION IS NAMED FOR WHAT IT IS, NOT FOR WHAT IT FIRST HELD.
 *
 * It was called "Research" because the four research rows were all the
 * installed application would let this window write when it was built. It is
 * not a research section; it is every setting that is stored beside the program
 * and enforced by it rather than by this window, and a fifth row -- what each
 * new agent is told about the tools it can reach -- has been in it, drawn and
 * uncounted, the whole time. A person hunting for the agent tool note would not
 * have looked under "Research", and search could not find it either. */
export const RESEARCH_SECTION = 'Research & Agents'

/* EVERY ROW THIS SECTION DRAWS, in the order a person meets them. This must
 * match `WRITABLE_IDS` in shell/product-settings.cjs, which decides what the
 * installed application will actually hand back;
 * tools/test/product-setting-rows.test.mjs asserts the two agree, because the
 * list being SHORT is exactly the defect this replaces: it held four of the
 * five, so the footer's total was one low and `requestedSetting` in
 * src/views/settings.js could not land on the fifth -- making it the one row on
 * the settings page that search could not find.
 *
 * They are IDENTIFIERS, never shown as a sentence: each row is titled with the
 * register's own plain name and carries its id only in a data attribute. */
export const PRODUCT_SETTING_IDS = Object.freeze([
  'research.pipeline',
  'research.runner_agent',
  'research.runner_process',
  'research.runner_http',
  'agent.tool_summary',
])

/* Derived, never counted by hand. The old constant was written as `4` beside a
   list of four and stayed `4` when the list became five. */
export const RESEARCH_SETTING_COUNT = PRODUCT_SETTING_IDS.length

/* THE MASTER SWITCH, EXPORTED BY NAME because two files need to point at it and
 * one of them was pointing at an INDEX. src/views/research.js built its
 * "the research pipeline is switched off in settings" link from
 * `RESEARCH_SETTING_IDS[0]`, which was the master only for as long as this list
 * held nothing but research rows. It now holds a fifth row that is not one, so
 * index 0 became a coincidence the order happens to preserve -- and a reordering
 * would have sent a person to the wrong switch with every test still green,
 * because nothing anywhere asserted which row that link lands on.
 *
 * DECLARED ABOVE RESEARCH_FENCED_IDS, not below it: that list is built at module
 * evaluation and reads this, so the other order is a temporal-dead-zone
 * ReferenceError that takes the whole page down on import. */
export const RESEARCH_MASTER_ID = 'research.pipeline'

const MASTER_ID = RESEARCH_MASTER_ID

/* WHAT THE FIRST SWITCH ACTUALLY FENCES, which is not "everything below it".
 *
 * `heldByMaster` used to mean "any row that is not the master", and the section
 * drew a fifth row the master has no authority over. Measured on a fresh
 * install, where `research.pipeline` is off by default and `agent.tool_summary`
 * ships ON, the agent row rendered with its switch reading on and the sentence
 * "Held back: the first switch in this section is off, so nothing runs for a
 * research project yet." That is a false statement about an unrelated setting,
 * in the default state, and a person would reasonably conclude their tool note
 * was disabled when it was being injected into every session.
 *
 * The registry declares no dependency between them and there is no shared
 * enforcer: `agent.tool_summary` is enforced by src/lib/agent-tool-summary.js,
 * and the research rows by src/lib/research/settings-gate.js, which never
 * mentions it. The fence is a fact about the research family, so it is named as
 * one -- by the register's own namespace, which is the thing that actually
 * decides -- rather than by "is not the first row". */
export const RESEARCH_FENCED_IDS = Object.freeze(
  PRODUCT_SETTING_IDS.filter(id => id.startsWith('research.') && id !== RESEARCH_MASTER_ID),
)

/* Which rows the research settings gate governs -- the ones whose provenance
   rule is real. Same namespace test as the fence, for the same reason: the
   register's own prefix is what decides, not this file's opinion. */
const underResearchGate = id => String(id).startsWith('research.')

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
  /* THE THIRD SENTENCE IS NOT TRUE OF EVERY ROW HERE, and saying it where it is
     false is the same defect as the master fence was.
     src/lib/research/settings-gate.js withholds research work whose value reads
     as on with `default` provenance -- "a control enforcing an agent-invented
     value is a software failure". src/lib/agent-tool-summary.js applies no such
     rule: it enables on `!== false`, so its row shipping ON with nobody having
     chosen it is ON, and the note is being injected. Telling that person their
     setting is "held back" would send them to turn a working switch off and on
     to fix nothing. */
  /* NOT "This is on because it ships on." -- a sentence whose whole content is
     that it is a sentence. It says WHAT ships on and what that means for the
     person, which is the part they were reaching for. */
  if (!underResearchGate(row.id)) return 'On is how this one ships. Nobody has changed it on this computer, and leaving it alone is fine.'
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
    if (!RESEARCH_FENCED_IDS.includes(row.id)) return false
    const master = rowFor(MASTER_ID)
    return Boolean(master && master.present && master.value !== true)
  }

  /* THE ACKNOWLEDGEMENT DOES NOT GET TO DELETE THE FENCE.
   *
   * THE DEFECT, and it is the worst kind: a person granted a permission, was
   * told it had been granted, and it did nothing. `said` holds "this window
   * just wrote that value", and it was returned FIRST -- above the heldByMaster
   * test -- so the act of using a fenced switch erased the one line explaining
   * that the switch is fenced. Before the press: "Held back: the first switch
   * in this section is off, so nothing runs for a research project yet." After
   * the press: "Recorded." And nothing ran.
   *
   * The two facts are both true and neither replaces the other, so they are
   * COMPOSED. The acknowledgement goes first because it answers the press, and
   * the fence follows because it is what the press did not do. */
  function statusFor(row) {
    const spoken = said.get(row.id)
    const held = row.present && heldByMaster(row)
      ? 'Held back: the first switch in this section is off, so nothing runs for a research project yet.'
      : ''
    if (spoken) return held ? `${spoken} ${held}` : spoken
    if (!row.present) return row.reason || ''
    if (held) return held
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
    /* THE SENTENCE STOPS AT THE ROWS IT IS TRUE OF. It used to say the first
       switch governs what is under it, full stop, with a fifth row underneath
       that it does not govern at all. Each family is now described as its own,
       and the last one is called separate in so many words. */
    return `<p class="settings-section-note host-absent-body">These are set on this computer itself, and the part of the program that does the work reads them. The first switch decides whether anything runs for a research project. The three under it decide what kind of work is allowed, and with the first one off none of the three grants anything. The last switch is separate from those four: it decides what every new agent is told about the tools it can reach here.</p>
      ${state.rows.map(rowMarkup).join('')}`
  }

  function markup({ searchResult = false } = {}) {
    return `<section class="settings-section" data-settings-section="${esc(RESEARCH_SECTION)}" data-research-settings>
      ${searchResult ? '<div class="settings-prefix">Research and agents, what may run on this computer</div>' : ''}
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
      /* The words a person types when they are hunting for one of these and do
         not know its name. The agent half is here for the same reason the
         research half is: the tool-note switch was unfindable by search for as
         long as this list described only research. */
      'research runs jobs projects experiments queue pipeline assistants programs web services on this computer',
      'agent agents tool tools note summary what tools exist introduction new session',
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
