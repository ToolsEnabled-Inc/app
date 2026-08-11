/* THE PERMISSION-LEVEL SCREEN.
 *
 * docs/design/INSTALLER-EXPERIENCE.md 2.1 calls this the product's first
 * impression and specifies its wording. It also names the control: "the `seg`
 * control from src/views/settings.js ... because the owner named that surface
 * as the model". So nothing here is new visual language. The question and the
 * three options are `.settings-row` copy; the choice is the same
 * `.seg.settings-seg` the whole settings surface uses, indicator and all; the
 * disclosure is `.fleet-profile-status.is-warn`, which is already this app's
 * pattern for correctness data carrying a severity; the button is `.ctl-btn`.
 * src/setup.css adds layout for a full-page question and no colours.
 *
 * WHY THE THREE DESCRIPTIONS STAY ON SCREEN AT ONCE. Showing only the selected
 * one would be tidier and would defeat the design: 2.1 states that each option
 * describes what happens to the COMPUTER rather than rating the reader, "so a
 * modest expert and an overconfident beginner both land correctly". That only
 * works if all three can be compared without clicking.
 */

import { el, attachSeg } from '../components.js'
import {
  DEFAULT_TIER,
  SETUP_RESOLUTION,
  TIER_CHOICES,
  TIER_IDS,
  TIER_LIMIT_LEAD,
  TIER_LIMIT_NOTICE,
  TIER_QUESTION,
  TIER_QUESTION_SUB,
  noteTierRecorded,
} from '../setup-state.js'

import '../settings.css'
import '../fleet-profile-settings.css'
import '../setup.css'

const esc = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

export function setupView({ navigate = hash => { location.hash = hash } } = {}) {
  const state = SETUP_RESOLUTION
  let chosen = TIER_IDS.includes(state.tier) ? state.tier : DEFAULT_TIER
  let busy = false
  /* Non-null only when the app cannot record an answer, or a save failed. The
     screen still renders the question in that case -- a reader is entitled to
     see what the levels ARE even where this copy cannot set one -- but the
     button is disabled and says why, rather than failing on click. */
  let refusal = state.available ? null : { code: state.code, reason: state.reason }

  const root = el(`<main class="view-pad setup-page">
    <div class="settings-shell setup-shell">
      <section class="settings-section setup-section" data-setup-section></section>
    </div>
  </main>`)
  const section = root.querySelector('[data-setup-section]')
  let detachSeg = null

  function choiceMarkup(choice) {
    return `<article class="settings-row setup-choice" data-setup-choice="${esc(choice.tier)}" aria-current="${choice.tier === chosen ? 'true' : 'false'}">
      <div class="settings-copy">
        <div class="settings-name">${esc(choice.label)}${choice.note ? ` — ${esc(choice.note)}` : ''}</div>
        <div class="settings-desc">${esc(choice.detail)}</div>
      </div>
    </article>`
  }

  /* is-warn, not is-serious: the enforcement gap is a real limit on what the
     level does and the reader must weigh it, but it is a stated property of a
     working product, not a fault in this installation. A save that FAILED is
     is-serious, because that one is broken. */
  function disclosureMarkup() {
    if (refusal) {
      return `<div class="fleet-profile-status is-serious" data-setup-status role="alert">
        <strong>${esc(refusal.title || 'This copy cannot record a permission level')}</strong>
        <span>${esc(refusal.reason || 'The application did not say why.')}</span>
      </div>`
    }
    return `<div class="fleet-profile-status is-warn" data-setup-status role="status">
      <strong>${esc(TIER_LIMIT_LEAD)}</strong>
      ${TIER_LIMIT_NOTICE.map(paragraph => `<span>${esc(paragraph)}</span>`).join('')}
    </div>`
  }

  function markup() {
    return `<h1 class="setup-title">${esc(TIER_QUESTION)}</h1>
      <div class="settings-section-rows">
        <article class="settings-row fleet-profile-block setup-question">
          <div class="settings-copy">
            <div class="settings-name" id="setup-tier-label">Permission level</div>
            <div class="settings-desc">${esc(TIER_QUESTION_SUB)}</div>
          </div>
          <div class="fleet-profile-fields">
            <div class="seg settings-seg setup-seg" role="group" aria-labelledby="setup-tier-label">
              ${TIER_CHOICES.map(choice => `<button type="button" data-setup-tier="${esc(choice.tier)}" aria-pressed="${choice.tier === chosen ? 'true' : 'false'}" class="${choice.tier === chosen ? 'on' : ''}" ${busy ? 'disabled' : ''}>${esc(choice.label)}</button>`).join('')}
            </div>
          </div>
        </article>
        ${TIER_CHOICES.map(choiceMarkup).join('')}
      </div>
      ${disclosureMarkup()}
      <div class="setup-actions">
        <button type="button" class="ctl-btn" data-setup-continue ${refusal || busy ? 'disabled' : ''}>${busy ? 'Saving…' : 'Continue'}</button>
      </div>`
  }

  function paint() {
    detachSeg?.()
    detachSeg = null
    section.innerHTML = markup()
    const group = section.querySelector('.setup-seg')
    if (group) detachSeg = attachSeg(group)
  }

  /* The selection is local until Continue. Someone comparing the three options
     by clicking between them has not decided anything yet, and writing a
     configuration on every click would record levels nobody chose. */
  function select(tier) {
    if (busy || !TIER_IDS.includes(tier) || tier === chosen) return
    chosen = tier
    paint()
  }

  async function commit() {
    if (busy || refusal) return
    busy = true
    paint()
    let result
    try {
      result = await globalThis.mcSetup.chooseTier(chosen)
    } catch (error) {
      result = { ok: false, reason: error?.message || String(error) }
    }
    busy = false
    if (result?.ok) {
      noteTierRecorded(result.tier || chosen)
      navigate('#/')
      return
    }
    refusal = {
      title: 'That level was not saved',
      code: result?.code || 'MC_SETUP_SAVE_FAILED',
      reason: result?.reason || 'The application did not say why. Nothing on this computer was changed.',
    }
    paint()
  }

  function onClick(event) {
    const option = event.target.closest('[data-setup-tier]')
    if (option) { select(option.dataset.setupTier); return }
    if (event.target.closest('[data-setup-continue]')) commit()
  }

  section.addEventListener('click', onClick)
  paint()

  return {
    el: root,
    destroy() {
      section.removeEventListener('click', onClick)
      detachSeg?.()
      detachSeg = null
    },
  }
}
