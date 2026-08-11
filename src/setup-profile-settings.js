/* SETTINGS -> SETUP: everything the walkthrough decided, where it can be found.
 *
 * The owner's requirement has a second half that is easy to miss: the
 * walkthrough may infer, but "inference the user cannot see or correct is a
 * trust problem". So every setting the three questions produce has to be
 * reachable afterwards, including the ones nobody was asked about.
 *
 * Most of them already are. The six write-action flags are rows in Settings ->
 * Write and the six live-view flags are rows in Settings -> Data & Sim; both
 * shipped before this walkthrough existed and neither is duplicated here. What
 * had no home at all is this section:
 *
 *   - THE PERMISSION LEVEL. src/setup-state.js tells every reader "You can
 *     change it later in Settings." That sentence was not true: the level was
 *     writable only from the first-run screen, which a configured machine never
 *     shows again. It is a row here now, and that is the sentence becoming true
 *     rather than a new feature.
 *   - THE WORKING FOLDERS, which decide what an assistant may touch and which
 *     were previously chosen silently by shell/setup-record.cjs.
 *   - THE FOUR SETTINGS OTHER LANES ARE BUILDING ENFORCEMENT FOR. The
 *     walkthrough sets these from one question, so they are exactly the settings
 *     a person is most likely to want to correct and least likely to remember
 *     answering.
 *
 * THE FOUR SAY WHAT THEY DO TODAY. Each is marked `enforced: false` in
 * src/setup-profile.js and the notice below says so in the same words
 * src/setup-state.js uses about the permission level's own enforcement gap: this
 * records what you want, the part that acts on it is still being built. A
 * settings row that silently does nothing is worse than no row; a settings row
 * that says what it does not do yet is how this product has already chosen to
 * handle exactly this situation. Their defaults are the cautious end of each
 * axis, so an intent nothing reads yet cannot do harm while it waits.
 *
 * CHANGING THE LEVEL DOWNWARD RE-CLAMPS. Moving from `unrestricted` to `guided`
 * here re-derives the profile against the new ceiling and turns off every write
 * action the smaller level does not permit. Leaving them on would produce a
 * machine whose recorded level and whose actual controls disagree, which is the
 * failure the tier is supposed to prevent.
 */

import { TIER_CHOICES, TIER_IDS, noteTierRecorded, SETUP_RESOLUTION } from './setup-state.js'
import { LIVE_VIEW_FLAGS, setLiveView } from './live-flags.js'
import { WRITE_ACTION_FLAGS, setWriteEnabled } from './write-flags.js'
import {
  AUTONOMY_CHOICES,
  PROFILE_INTENT,
  SAFE_ANSWERS,
  SCREENS_CHOICES,
  answersForAutonomy,
  applyProfile,
  deriveProfile,
  intentField,
  readStoredProfile,
  writeStoredProfile,
} from './setup-profile.js'

/* Counted for the settings footer, which states how many settings exist. The
   permission level, the folders, the two derived answers and the four intent
   fields: eight rows a person can move. */
export const SETUP_PROFILE_SETTING_COUNT = 8

const WRITE_FLAG_IDS = WRITE_ACTION_FLAGS.map(flag => flag.id)
const LIVE_FLAG_IDS = LIVE_VIEW_FLAGS.map(flag => flag.id)

const esc = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

export function createSetupProfileSettings({ navigate = hash => { location.hash = hash } } = {}) {
  const stored = readStoredProfile()
  let answers = stored ? stored.answers : { ...SAFE_ANSWERS, workspaceRoots: [] }
  let status = stored ? stored.status : null
  let hostRoot = null
  let busy = null
  let feedback = null
  let workspace = null
  let loadStarted = false

  function tier() {
    return TIER_IDS.includes(SETUP_RESOLUTION.tier) ? SETUP_RESOLUTION.tier : null
  }

  function derived() {
    return deriveProfile(answers, {
      tier: tier(),
      writeFlagIds: WRITE_FLAG_IDS,
      liveFlagIds: LIVE_FLAG_IDS,
    })
  }

  /* Applied on every change, unlike the walkthrough, which holds everything to
     the end. The difference is deliberate: in a settings screen a control that
     does not take effect when you move it is broken, and there is no Finish
     button here to defer to. */
  function persist(next) {
    answers = next
    status = status === 'complete' ? 'complete' : status || 'skipped'
    applyProfile(derived(), { setWriteFlag: setWriteEnabled, setLiveFlag: setLiveView })
    writeStoredProfile({ status, step: 'review', answers })
  }

  function segMarkup(target, options, current, label) {
    return `<div class="seg settings-seg" role="group" aria-label="${esc(label)}">
      ${options.map(option => `<button type="button" data-setup-profile-set="${esc(target)}" data-setup-profile-value="${esc(option.value)}" aria-pressed="${option.value === current ? 'true' : 'false'}" class="${option.value === current ? 'on' : ''}" ${busy ? 'disabled' : ''}>${esc(option.label)}</button>`).join('')}
    </div>`
  }

  function rowMarkup(name, desc, control, id) {
    return `<article class="settings-row" ${id ? `data-setup-profile-row="${esc(id)}"` : ''}>
      <div class="settings-copy">
        <div class="settings-name">${esc(name)}</div>
        <div class="settings-desc">${esc(desc)}</div>
      </div>
      <div class="settings-control">${control}</div>
    </article>`
  }

  function statusMarkup() {
    if (feedback) {
      return `<div class="fleet-profile-status is-${esc(feedback.tone)}" data-setup-profile-status role="${feedback.tone === 'serious' ? 'alert' : 'status'}">
        <strong>${esc(feedback.title)}</strong>
        <span>${esc(feedback.detail)}</span>
      </div>`
    }
    if (status === null) {
      return `<div class="fleet-profile-status is-quiet" data-setup-profile-status role="status">
        <strong>Setup has not been walked through on this computer</strong>
        <span>These are the shipped defaults: nothing that acts is switched on. Walking through setup asks three questions and sets all of this together.</span>
      </div>`
    }
    if (status === 'skipped') {
      return `<div class="fleet-profile-status is-quiet" data-setup-profile-status role="status">
        <strong>Setup was skipped, so these are the safe defaults</strong>
        <span>Nothing that acts is switched on and the working folder is whatever was already recorded. Change anything here, or walk through setup to set it all together.</span>
      </div>`
    }
    return `<div class="fleet-profile-status is-good" data-setup-profile-status role="status">
      <strong>Setup was completed on this computer</strong>
      <span>Every row below is what you chose, and every row below is still yours to move.</span>
    </div>`
  }

  function workspaceRowMarkup() {
    if (workspace === null) {
      return rowMarkup('Working folders', 'Reading this computer’s configuration…', '<span class="settings-desc">…</span>', 'workspace')
    }
    if (workspace.available === false) {
      return rowMarkup(
        'Working folders',
        `${workspace.reason || 'The application did not say why.'}`,
        '<span class="settings-desc">unavailable</span>',
        'workspace',
      )
    }
    const roots = workspace.roots || []
    return `<article class="settings-row fleet-profile-block" data-setup-profile-row="workspace">
      <div class="settings-copy">
        <div class="settings-name">Working folders</div>
        <div class="settings-desc">The folders an assistant may read and change. Everything outside them is off limits at the level recorded above.${workspace.chosen ? '' : ' Nobody has been asked about this yet, so it is the folder setup would have suggested.'}</div>
      </div>
      <div class="fleet-profile-fields">
        ${roots.length
          ? roots.map(path => `<div class="setup-root"><code class="setup-root-path">${esc(path)}</code></div>`).join('')
          : '<p class="fleet-profile-empty">No folder is recorded.</p>'}
        <div class="fleet-profile-actions">
          <button type="button" class="ctl-btn" data-setup-profile-action="choose-folder" ${busy ? 'disabled' : ''}>Choose a different folder…</button>
        </div>
      </div>
    </article>`
  }

  function markup({ searchResult = false } = {}) {
    const profile = derived()
    const currentTier = tier()
    const tierChoice = TIER_CHOICES.find(choice => choice.tier === currentTier)
    return `<section class="settings-section setup-profile-section" data-settings-section="Setup" data-setup-profile-system>
      ${searchResult ? '<div class="settings-prefix">Setup · permission level, folders, and what it may do</div>' : ''}
      <h2 class="settings-section-title">Setup</h2>
      ${statusMarkup()}
      <div class="settings-section-rows">
        ${rowMarkup(
          'Permission level',
          tierChoice ? tierChoice.detail : 'How much of this computer an assistant may reach. This is the ceiling for everything below it.',
          currentTier
            ? segMarkup('tier', TIER_CHOICES.map(choice => ({ value: choice.tier, label: choice.label })), currentTier, 'Permission level')
            : '<span class="settings-desc">not recorded on this computer</span>',
          'tier',
        )}
        ${workspaceRowMarkup()}
        ${rowMarkup(
          'Acting on its own',
          `${AUTONOMY_CHOICES.find(choice => choice.value === answers.autonomy)?.detail || ''} Switched on now: ${WRITE_ACTION_FLAGS.filter(flag => profile.writeFlags[flag.id]).map(flag => flag.label).join(', ') || 'nothing that acts'}.`,
          segMarkup('autonomy', AUTONOMY_CHOICES.map(choice => ({ value: choice.value, label: choice.label })), answers.autonomy, 'Acting on its own'),
          'autonomy',
        )}
        ${rowMarkup(
          'What the screens show',
          SCREENS_CHOICES.find(choice => choice.value === answers.screens)?.detail || '',
          segMarkup('screens', SCREENS_CHOICES.map(choice => ({ value: choice.value, label: choice.label })), answers.screens, 'What the screens show'),
          'screens',
        )}
        ${PROFILE_INTENT.map(field => rowMarkup(
          field.name,
          `${field.desc} Recorded, not yet acted on.`,
          segMarkup(`intent:${field.id}`, field.order.map(value => ({ value, label: field.labels[value] })), profile.intent[field.id], field.name),
          field.id,
        )).join('')}
        <article class="settings-row">
          <div class="settings-copy">
            <div class="settings-name">Walk through setup again</div>
            <div class="settings-desc">The same three questions, ending on a page that shows everything they set. Nothing is written until you finish it, and leaving partway changes nothing.</div>
          </div>
          <div class="settings-control"><button type="button" class="ctl-btn" data-setup-profile-action="walkthrough">Open setup</button></div>
        </article>
      </div>
      <div class="fleet-profile-status is-warn" role="status">
        <strong>What the last four rows do today.</strong>
        <span>This program records them and keeps them; the parts of it that would act on them are still being built, so today they change what is remembered rather than what happens. Each is set to its cautious end unless you moved it.</span>
        <span>No account, password, or key is asked for on this screen, and none is stored by it. You sign in to an assistant inside that assistant’s own program.</span>
      </div>
    </section>`
  }

  function refresh() {
    if (!hostRoot) return
    const current = hostRoot.querySelector('[data-setup-profile-system]')
    if (!current) return
    const searchResult = current.querySelector('.settings-prefix') !== null
    current.outerHTML = markup({ searchResult })
  }

  async function loadWorkspace() {
    if (loadStarted) return
    loadStarted = true
    if (!globalThis.mcSetup?.workspaceState) {
      workspace = { available: false, reason: 'This page is running in a browser rather than the installed application, so there is no computer here to configure.' }
      refresh()
      return
    }
    let result
    try {
      result = await globalThis.mcSetup.workspaceState()
    } catch (error) {
      result = { ok: false, reason: error?.message || String(error) }
    }
    workspace = result?.ok === false
      ? { available: false, reason: result.reason || 'The application did not say why.' }
      : result
    refresh()
  }

  async function chooseFolder() {
    if (busy || !globalThis.mcSetup?.chooseWorkspace) return
    busy = 'folder'
    feedback = null
    refresh()
    let picked
    try {
      picked = await globalThis.mcSetup.chooseWorkspace()
    } catch (error) {
      picked = { ok: false, reason: error?.message || String(error) }
    }
    if (picked?.canceled) { busy = null; refresh(); return }
    if (!picked?.ok) {
      busy = null
      feedback = { tone: 'serious', title: 'That folder cannot be used', detail: picked?.reason || 'The application did not say why.' }
      refresh()
      return
    }
    let saved
    try {
      saved = await globalThis.mcSetup.recordWorkspaces([picked.path])
    } catch (error) {
      saved = { ok: false, reason: error?.message || String(error) }
    }
    busy = null
    if (!saved?.ok) {
      feedback = { tone: 'serious', title: 'That folder was not saved', detail: `${saved?.reason || 'The application did not say why.'} Nothing on this computer was changed.` }
      refresh()
      return
    }
    workspace = { ...(workspace || {}), available: true, roots: saved.roots, chosen: true }
    answers = { ...answers, workspaceRoots: saved.roots }
    writeStoredProfile({ status: status || 'skipped', step: 'review', answers })
    feedback = { tone: 'good', title: 'Working folder saved', detail: 'An assistant may work inside it and nowhere else at the level recorded above.' }
    refresh()
  }

  async function chooseTier(value) {
    if (busy || !TIER_IDS.includes(value) || value === tier()) return
    if (!globalThis.mcSetup?.chooseTier) {
      feedback = { tone: 'serious', title: 'The permission level was not changed', detail: 'This page is running in a browser rather than the installed application, so there is no computer here to configure.' }
      refresh()
      return
    }
    busy = 'tier'
    feedback = null
    refresh()
    let result
    try {
      result = await globalThis.mcSetup.chooseTier(value)
    } catch (error) {
      result = { ok: false, reason: error?.message || String(error) }
    }
    busy = null
    if (!result?.ok) {
      feedback = { tone: 'serious', title: 'The permission level was not changed', detail: `${result?.reason || 'The application did not say why.'} Nothing on this computer was changed.` }
      refresh()
      return
    }
    /* Read the flags as they ACTUALLY ARE before the level moves.
       Deriving "before" would be wrong twice over: noteTierRecorded has already
       changed the ceiling by the time it ran, so a derived before is a derived
       after; and a flag the person turned on by hand in Settings -> Write is not
       in the derivation at all. What was on is a question only storage can
       answer. */
    const wasOn = new Map(WRITE_ACTION_FLAGS.map(flag => [flag.id, isWriteEnabled(flag.id)]))
    noteTierRecorded(result.tier || value)
    /* Re-derive against the NEW ceiling and write the result. A smaller level
       that left the bigger level's switches on would be a level in name only. */
    persist(answers)
    const after = derived()
    const dropped = WRITE_ACTION_FLAGS
      .filter(flag => wasOn.get(flag.id) && !after.writeFlags[flag.id])
      .map(flag => flag.label)
    feedback = dropped.length
      ? { tone: 'warn', title: 'Permission level changed, and some switches went off with it', detail: `${dropped.join(', ')} ${dropped.length === 1 ? 'is' : 'are'} not part of this level, so ${dropped.length === 1 ? 'it was' : 'they were'} turned off.` }
      : { tone: 'good', title: 'Permission level changed', detail: 'Everything below is unchanged; this level permits all of it.' }
    refresh()
  }

  function setAnswer(target, value) {
    if (busy) return
    if (target === 'tier') { chooseTier(value); return }
    let next = null
    if (target === 'autonomy') {
      if (!AUTONOMY_CHOICES.some(choice => choice.value === value) || value === answers.autonomy) return
      next = answersForAutonomy(value, answers)
    } else if (target === 'screens') {
      if (!SCREENS_CHOICES.some(choice => choice.value === value) || value === answers.screens) return
      next = { ...answers, screens: value }
    } else if (target.startsWith('intent:')) {
      const field = intentField(target.slice('intent:'.length))
      if (!field || !field.order.includes(value) || value === answers[field.id]) return
      next = { ...answers, [field.id]: value }
    }
    if (!next) return
    feedback = null
    persist(next)
    refresh()
  }

  function handleClick(event) {
    const setter = event.target.closest('[data-setup-profile-set]')
    if (setter && hostRoot?.contains(setter)) {
      setAnswer(setter.dataset.setupProfileSet, setter.dataset.setupProfileValue)
      return
    }
    const action = event.target.closest('[data-setup-profile-action]')
    if (!action || !hostRoot?.contains(action)) return
    if (action.dataset.setupProfileAction === 'walkthrough') { navigate('#/setup'); return }
    if (action.dataset.setupProfileAction === 'choose-folder') chooseFolder()
  }

  function matches(query) {
    const normalized = String(query || '').trim().toLowerCase()
    if (!normalized) return true
    const haystack = [
      'setup permission level tier guided standard unrestricted workspace working folder folders autonomy acting on its own approvals attach adopt fork mirror editor import account failover sign in walkthrough first run screens demonstration live',
      ...TIER_CHOICES.map(choice => `${choice.label} ${choice.detail}`),
      ...AUTONOMY_CHOICES.map(choice => `${choice.label} ${choice.detail}`),
      ...SCREENS_CHOICES.map(choice => `${choice.label} ${choice.detail}`),
      ...PROFILE_INTENT.flatMap(field => [field.name, field.desc, ...Object.values(field.labels)]),
      ...(workspace?.roots || []),
    ].join(' ').toLowerCase()
    return haystack.includes(normalized)
  }

  function bind(root) {
    hostRoot = root
    root.addEventListener('click', handleClick)
  }

  function afterRender(root = hostRoot) {
    hostRoot = root
    loadWorkspace()
  }

  function destroy() {
    if (hostRoot) hostRoot.removeEventListener('click', handleClick)
    hostRoot = null
  }

  return Object.freeze({ markup, matches, bind, afterRender, destroy })
}
