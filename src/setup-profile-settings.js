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
/* The same three answers this lane owes every withheld switch -- what is off,
   what would turn it on, what that gains and risks -- reached from the place a
   person arrives at LATER, rather than only on the walkthrough they may have
   taken weeks ago (owner, R1529). */
import { withheldMarkup } from './guided-step.js'
import { LIVE_VIEW_FLAGS, setLiveView } from './live-flags.js'
import { WRITE_ACTION_FLAGS, isWriteEnabled, setWriteEnabled } from './write-flags.js'
/* THE MOMENT OF CHOOSING FULL ACCESS (owner, X4, 2026-08-15). The widest level
   is not written on the press: the risk is stated in the Terms' own words, on
   this row, and the person is asked. The words, the gate and the sentence about
   what the record holds all come from one module, so this row and the
   walkthrough cannot describe the same choice two ways. */
import {
  createRiskGate,
  describeConsentRecord,
  requiresRiskConsent,
  unrestrictedRiskMarkup,
} from './unrestricted-consent.js'
import {
  AUTONOMY_CHOICES,
  PROFILE_INTENT,
  SAFE_ANSWERS,
  SCREENS_CHOICES,
  answersForAutonomy,
  applyProfile,
  deriveProfile,
  intentField,
  profileCanStartAnAgent,
  readStoredProfile,
  writeStoredProfile,
  INTENT_BANNER_BODY,
  INTENT_BANNER_TITLE,
  INTENT_IN_USE,
  INTENT_RECORDED_ONLY,
} from './setup-profile.js'

/* Counted for the settings footer, which states how many settings exist. The
   permission level, the folders, the two derived answers and the four intent
   fields: eight rows a person can move. */
export const SETUP_PROFILE_SETTING_COUNT = 8

/* WHY THE FOLDER WAS REFUSED, WHICHEVER WAY THE SHELL SAID IT.
 *
 * `mcSetup.chooseWorkspace()` answers a refusal in two different shapes, and
 * both screens that ask the folder question used to read only the first:
 *
 *   a folder the check refused   { ok: false, code, reason, resolved }
 *   anything that THREW inside   { ok: false, error: { code, message } }
 *
 * The second is what `withFleetProfileSender` in shell/main.cjs returns for
 * every exception in that handler, so it is not an exotic path. MEASURED while
 * driving the shipped 1.0.20 build on a fresh profile: pressing "Choose a
 * different folder..." answered
 *     { ok: false, error: { code: 'MC_FLEET_PROFILE_ACTION_FAILED',
 *                           message: "Failed to get 'documents' path" } }
 * and the screen read "That folder cannot be used -- The application did not say
 * why." It had been told why, in a sentence, and dropped it.
 *
 * capability/src/lib/setup/workspace.js states the rule this broke, in its own
 * words: every refusal here has to be explainable to the person who chose the
 * folder, because "that folder cannot be used" with no reason is the shape that
 * makes someone pick a worse one.
 *
 * A BARE IDENTIFIER IS NOT A SENTENCE. src/refusal-copy.js refuses those for a
 * reason a person meets rather than a rule: MC_FLEET_PROFILE_ACTION_FAILED on
 * the glass is a code with no reader, and printing it would technically satisfy
 * "say why" while telling nobody anything. Same test here, same outcome: fall
 * through to the sentence that at least admits the silence.
 *
 * It lives in this module, and the walkthrough imports it, so the two screens
 * cannot drift into explaining the same refusal two different ways -- which is
 * exactly how one of them came to miss a shape the other would have shown. */
const BARE_IDENTIFIER = /^[A-Z][A-Z0-9_]*$/

export function setupRefusalDetail(result, fallback = 'The application did not say why.') {
  const candidates = [result?.reason, result?.error?.message, result?.message]
  for (const candidate of candidates) {
    const text = typeof candidate === 'string' ? candidate.trim() : ''
    if (text.length === 0) continue
    if (BARE_IDENTIFIER.test(text)) continue
    if (!/[a-z]/.test(text)) continue
    return text
  }
  return fallback
}

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
  /* The gate for the widest level. `pending` while the words are on the row and
     nobody has answered; the seg keeps showing the level this computer HOLDS the
     whole time, because nothing has moved. */
  const riskGate = createRiskGate({ via: 'settings' })
  /* What the signed record says about the widest level, when that is the level
     recorded here. null until read; {ok:false} when it could not be read; the
     row states each of those differently and never rounds absence up to
     "confirmed". */
  let consentRecord = null

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
        `${setupRefusalDetail(workspace)}`,
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

  /* THE SWITCHES THIS PROFILE IS LEAVING OFF, EXPLAINED HERE TOO.
   *
   * The walkthrough says this at the moment of choosing; this section is where
   * a person arrives afterwards, which is usually much later and usually
   * because something they expected was not there. Saying it in only one of the
   * two places is how the walkthrough came to be the only screen that knew
   * anything, and this section the one people actually reach.
   *
   * Nothing here turns anything on. It states what is off, what it would give,
   * what it would cost, that it is optional, and where the switch is. */
  function withheldSectionMarkup(profile, currentTier) {
    const off = WRITE_ACTION_FLAGS.filter(flag => !profile.writeFlags[flag.id])
    if (off.length === 0) return ''
    const tierLabel = TIER_CHOICES.find(choice => choice.tier === currentTier)?.label || currentTier
    const refused = new Set(profile.refusedWriteFlags)
    return `<div class="settings-section-rows" data-setup-profile-withheld>
      ${off.map(flag => withheldMarkup(`write_${flag.id}`, {
        label: flag.label,
        reason: refused.has(flag.id)
          /* Not escaped here: withheldMarkup escapes what it is given, and
             escaping twice renders the quotation marks as their own source. */
          ? `It is off because the “${tierLabel}” permission level does not include it. Widening the level in the first row above is what would change that.`
          : 'It is off because nothing has asked for it. The switch itself is in Settings → Write, and the row above sets several of them together.',
      })).join('')}
    </div>`
  }

  /* The record's sentence rides on the tier row's own description, so a person
     reading which level this computer holds reads in the same breath whether
     the risk was ever confirmed for it. Empty for every narrower level. */
  function consentSentence(currentTier) {
    if (!requiresRiskConsent(currentTier)) return ''
    if (consentRecord === null) return ' Reading whether the risk was confirmed for this level…'
    const sentence = describeConsentRecord(consentRecord, { tier: currentTier })
    return sentence ? ` ${sentence}` : ''
  }

  async function loadConsentRecord() {
    if (!requiresRiskConsent(tier())) return
    if (!globalThis.mcSetup?.tierConsent) {
      consentRecord = { ok: false }
      refresh()
      return
    }
    let result
    try {
      result = await globalThis.mcSetup.tierConsent()
    } catch {
      result = { ok: false }
    }
    consentRecord = result && typeof result === 'object' ? result : { ok: false }
    refresh()
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
          `${tierChoice ? tierChoice.detail : 'How much of this computer an assistant may reach. This is the ceiling for everything below it.'}${consentSentence(currentTier)}`,
          currentTier
            ? segMarkup('tier', TIER_CHOICES.map(choice => ({ value: choice.tier, label: choice.label })), currentTier, 'Permission level')
            : '<span class="settings-desc">not recorded on this computer</span>',
          'tier',
        )}
        ${riskGate.pending ? unrestrictedRiskMarkup({ id: 'settings-unrestricted-risk', busy: Boolean(busy), declineLabel: `No, keep “${TIER_CHOICES.find(choice => choice.tier === currentTier)?.label || 'the current level'}”` }) : ''}
        ${workspaceRowMarkup()}
        ${rowMarkup(
          'Acting on its own',
          /* The consequence sentence rides here for the same reason it is on the
             walkthrough: this row is where a person who met the absence arrives
             to fix it, and "nothing that acts" does not tell them that the Start
             control they went looking for is the thing this row removed. It is
             gated on the DERIVED profile, so a level that refused the flag would
             show it too. */
          `${AUTONOMY_CHOICES.find(choice => choice.value === answers.autonomy)?.detail || ''} Switched on now: ${WRITE_ACTION_FLAGS.filter(flag => profile.writeFlags[flag.id]).map(flag => flag.label).join(', ') || 'nothing that acts'}.${
            profileCanStartAnAgent(profile)
              ? ''
              : ` ${AUTONOMY_CHOICES.find(choice => choice.value === answers.autonomy)?.consequence || 'No control that starts an agent is shown until this is changed.'}`
          }`,
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
          /* PER ROW, because they are no longer all the same. One of these is
             acted on now and three are not, and printing one sentence over all
             four would make the screen wrong about whichever half it did not
             mean. The row itself is what knows. */
          `${field.desc} ${field.enforced ? INTENT_IN_USE : INTENT_RECORDED_ONLY}`,
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
      ${withheldSectionMarkup(profile, currentTier)}
      <div class="fleet-profile-status is-warn" role="status">
        <strong>${INTENT_BANNER_TITLE}</strong>
        <span>${INTENT_BANNER_BODY}</span>
        <span>This screen asks for no subscription, key or password for Claude, ChatGPT or Google, and this program stores none. Those stay in their own programs. The account for this computer is its own setting, not one of these.</span>
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
      ? { available: false, reason: setupRefusalDetail(result) }
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
      feedback = { tone: 'serious', title: 'That folder cannot be used', detail: setupRefusalDetail(picked) }
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
      feedback = { tone: 'serious', title: 'That folder was not saved', detail: `${setupRefusalDetail(saved)} Nothing on this computer was changed.` }
      refresh()
      return
    }
    workspace = { ...(workspace || {}), available: true, roots: saved.roots, chosen: true }
    answers = { ...answers, workspaceRoots: saved.roots }
    writeStoredProfile({ status: status || 'skipped', step: 'review', answers })
    feedback = { tone: 'good', title: 'Working folder saved', detail: 'An assistant may work inside it and nowhere else at the level recorded above.' }
    refresh()
  }

  /* THE PRESS ON THE WIDEST LEVEL STOPS HERE, EVERY TIME. Nothing is written:
     the words go on the row and the two buttons under them decide what happens
     next. `confirmUnrestricted` is the only way from this function to the disk
     for that level, and it is reached only by the confirm button. A press on
     any narrower level goes straight through, as it always did -- and it also
     closes an open block, because a person who moved to a narrower level has
     answered the question. */
  function requestTier(value) {
    if (busy || !TIER_IDS.includes(value) || value === tier()) return
    const decision = riskGate.request(value)
    if (decision.ask) {
      feedback = null
      refresh()
      return
    }
    chooseTier(value, null)
  }

  function confirmUnrestricted() {
    if (busy) return
    const consent = riskGate.confirm()
    if (!consent) return
    chooseTier('unrestricted', consent)
  }

  function declineUnrestricted() {
    if (busy) return
    riskGate.decline()
    const kept = TIER_CHOICES.find(choice => choice.tier === tier())
    feedback = {
      tone: 'good',
      title: 'Full access was not turned on',
      detail: `The permission level stays at “${kept ? kept.label : tier()}”. Nothing on this computer was changed.`,
    }
    refresh()
  }

  async function chooseTier(value, consent) {
    if (busy || !TIER_IDS.includes(value) || value === tier()) return
    if (!globalThis.mcSetup?.chooseTier) {
      feedback = { tone: 'serious', title: 'The permission level was not changed', detail: 'This page is running in a browser rather than the installed application, so there is no computer here to configure.' }
      refresh()
      return
    }
    busy = 'tier'
    feedback = null
    refresh()
    /* ONE EXIT, AND IT ALWAYS REPAINTS.
     *
     * This body used to clear `busy` in the middle and then return through five
     * separate `refresh()` calls. Measured on the packaged build 2026-08-16: a
     * throw between the disk write and the repaint -- one unbound identifier
     * was enough -- left the machine on its NEW permission level, this row
     * showing the OLD one, and every button in the section painted `disabled`
     * with nothing left to run that could re-enable them. Clearing `busy` early
     * did not help: the flag was already null, so the section was dead only
     * because the DOM still said so, and the next repaint (typing in the
     * settings search) handed back a live control that wrote a further level to
     * disk on every press while still showing the original.
     *
     * So the state is restored and the section repainted in `finally`, for
     * every path including one nobody predicted, and a failure the code did not
     * expect arrives as a sentence rather than as a section that stops
     * answering. */
    try {
      let result
      try {
        /* The consent rides with the level. For the widest level the shell
           refuses without it (SETUP_UNRESTRICTED_UNCONFIRMED), so a screen that
           forgot to ask could not widen anything; for the others it is null. */
        result = await globalThis.mcSetup.chooseTier(value, consent)
      } catch (error) {
        result = { ok: false, reason: error?.message || String(error) }
      }
      if (!result?.ok) {
        feedback = { tone: 'serious', title: 'The permission level was not changed', detail: `${setupRefusalDetail(result)} Nothing on this computer was changed.` }
        return
      }
      /* WHAT THE LEDGER SAYS ABOUT THIS CHANGE, read off the shell's answer and
         never assumed. `recorded.ok` is the signed record; a copy with no
         ledger writer says so; and for the widest level a present-but-refusing
         ledger never gets this far, because the shell refuses the change. */
      const recordedNote = result.recorded?.ok === true
        ? ' The change was recorded in the signed ledger.'
        : result.recorded?.code === 'AUDIT_PAYLOAD_ABSENT'
          ? ' This copy carries no ledger writer, so the change was not recorded.'
          : result.recorded
            ? ' The change could not be recorded in the signed ledger.'
            : ''
      consentRecord = null
      /* THE MACHINE HAS ALREADY MOVED, so the level this screen believes in
         moves FIRST. Everything below is bookkeeping on top of a record that is
         already the new one; a step that failed with the level unrecorded would
         leave the row naming a level this computer no longer has, which is the
         one thing a permission control may never do. */
      noteTierRecorded(result.tier || value)
      /* Read the flags as they ACTUALLY ARE before the derivation moves them.
         Deriving "before" would be wrong twice over: the ceiling has already
         changed by the time this runs, so a derived before is a derived after;
         and a flag the person turned on by hand in Settings -> Write is not in
         the derivation at all. What was on is a question only storage can
         answer, and storage is not affected by the line above. */
      const wasOn = new Map(WRITE_ACTION_FLAGS.map(flag => [flag.id, isWriteEnabled(flag.id)]))
      /* Re-derive against the NEW ceiling and write the result. A smaller level
         that left the bigger level's switches on would be a level in name only. */
      persist(answers)
      const after = derived()
      const dropped = WRITE_ACTION_FLAGS
        .filter(flag => wasOn.get(flag.id) && !after.writeFlags[flag.id])
        .map(flag => flag.label)
      feedback = dropped.length
        ? { tone: 'warn', title: 'Permission level changed, and some switches went off with it', detail: `${dropped.join(', ')} ${dropped.length === 1 ? 'is' : 'are'} not part of this level, so ${dropped.length === 1 ? 'it was' : 'they were'} turned off.${recordedNote}` }
        : { tone: 'good', title: 'Permission level changed', detail: `Everything below is unchanged; this level permits all of it.${recordedNote}` }
    } catch {
      /* The words carry no identifier and no path, the same rule every other
         refusal in this product keeps: what a person can act on is which level
         this computer now holds and which screen shows the switches. */
      feedback = {
        tone: 'serious',
        title: 'The level changed, and this screen could not finish the change',
        detail: 'This computer now records the level shown above. The switches below it may not have been brought into line with it. Open Settings → Write to check them.',
      }
    } finally {
      busy = null
      refresh()
      /* After a move to the widest level, read what the ledger now holds so the
         row's sentence is the record's and not this screen's memory of what it
         just did. */
      loadConsentRecord()
    }
  }

  function setAnswer(target, value) {
    if (busy) return
    if (target === 'tier') { requestTier(value); return }
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
    if (event.target.closest('[data-unrestricted-confirm]')) { confirmUnrestricted(); return }
    if (event.target.closest('[data-unrestricted-decline]')) { declineUnrestricted(); return }
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
    loadConsentRecord()
  }

  function destroy() {
    if (hostRoot) hostRoot.removeEventListener('click', handleClick)
    hostRoot = null
  }

  return Object.freeze({ markup, matches, bind, afterRender, destroy })
}
