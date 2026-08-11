/* THE FIRST-RUN WALKTHROUGH: three questions, then what they add up to.
 *
 * This screen began as the permission-level question of
 * docs/design/INSTALLER-EXPERIENCE.md 2.1 and nothing else. The owner then asked
 * for the rest of it: "Any important user settings should be shown in setup and
 * walked through. Even a basic user in relatively few steps we should have a very
 * good sense of exactly what they want from the product almost like the game 21
 * questions and we end up on exactly the right user settings profile or near it
 * at least."
 *
 * The mechanism of that game, not just its name, is the specification. Twenty
 * questions works because each question eliminates a large part of the space; a
 * form that enumerates every setting is its exact opposite. So this asks THREE
 * questions and lands on nineteen settings, and the derivation from one to the
 * other lives in src/setup-profile.js where it can be tested without a browser.
 *
 *   1. How much should the assistant be allowed to do?   -> the permission level
 *   2. Which folder may it work in?                      -> the workspace roots
 *   3. How much should it do without asking you?         -> six write-action
 *      flags, and the four settings the approvals, attach, editor-import and
 *      multiple-account lanes are building enforcement for
 *
 *   4. ...and then a review, which is not a question. It shows every setting the
 *      three answers produced, lets each be changed, and only then writes
 *      anything. "Or near it at least" is the owner's own acknowledgement that
 *      inference will not be exact, so the walkthrough must never be a one-way
 *      door and inference the person cannot see is not allowed to exist.
 *
 * WHY THE FOURTH QUESTION IS ON THE REVIEW AND NOT ITS OWN STEP. Whether the
 * screens read this computer or the labelled demonstration is a real setting --
 * six flags -- but it is the one choice nobody can make well without looking at
 * the screens it changes. Putting it on the review shows it and walks through it
 * without spending a step on it. Section 1 of the design promises a beginner
 * "a total of three questions"; this keeps that promise for every level.
 *
 * NOTHING IS WRITTEN UNTIL FINISH, WITH ONE EXCEPTION THAT PREDATES THIS.
 * The permission level is recorded when its own Continue is pressed, because the
 * first-run gate is built on it: an app that reached step 2 without recording a
 * level would send the person back to step 1 on the next launch. Everything else
 * is held in memory and applied in one pass at the end, so a window closed
 * halfway through leaves a machine configured exactly as it was.
 *
 * WHAT SKIP DOES, MEASURABLY. It applies SAFE_ANSWERS, which resolve to the
 * state a machine that never ran setup is already in: every write action off,
 * every screen live, the workspace left exactly as recorded. Skipping is
 * therefore provably not a half-configured state -- it is the shipped default,
 * declared rather than implied.
 *
 * The visual language is unchanged and none of it is new: the `seg` control, the
 * `.settings-row` copy pattern, `.fleet-profile-status` for state that carries a
 * severity, and `.ctl-btn`. src/setup.css adds layout and no colour.
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
import {
  ACCOUNT_QUESTION,
  ACCOUNT_QUESTION_SUB,
  ACCOUNT_SCOPE_LEAD,
  ACCOUNT_SCOPE_NOTICE,
  MIN_PASSWORD_LENGTH,
  accountStep,
} from '../account-state.js'
import { LIVE_VIEW_FLAGS, setLiveView } from '../live-flags.js'
import { WRITE_ACTION_FLAGS, setWriteEnabled } from '../write-flags.js'
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
  resumeStep,
  stepAfter,
  stepBefore,
  writeStoredProfile,
} from '../setup-profile.js'

import '../settings.css'
import '../fleet-profile-settings.css'
import '../setup.css'

const esc = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

/* The order is the flow. `resumeStep` reads it, the step counter counts it, and
   Back walks it, so there is one place that decides what "next" means. */
/* `account` is in STEPS but deliberately NOT in QUESTION_STEPS. The walkthrough
   is three questions that land on nineteen settings; signing in sets none of
   them, so counting it as "Question 3 of 4" would inflate the promise this
   screen makes. It is a step the person walks through, not a question that
   derives a profile. */
const STEPS = Object.freeze(['tier', 'workspace', 'account', 'autonomy', 'review'])
const QUESTION_STEPS = Object.freeze(['tier', 'workspace', 'autonomy'])

const WRITE_FLAG_IDS = WRITE_ACTION_FLAGS.map(flag => flag.id)
const LIVE_FLAG_IDS = LIVE_VIEW_FLAGS.map(flag => flag.id)

export function setupView({ navigate = hash => { location.hash = hash } } = {}) {
  const state = SETUP_RESOLUTION
  let chosen = TIER_IDS.includes(state.tier) ? state.tier : DEFAULT_TIER
  let busy = false
  /* Non-null only when the app cannot record an answer, or a save failed. The
     screen still renders the question in that case -- a reader is entitled to
     see what the levels ARE even where this copy cannot set one -- but the
     button is disabled and says why, rather than failing on click. */
  let refusal = state.available ? null : { code: state.code, reason: state.reason }

  const stored = readStoredProfile()
  let answers = stored ? stored.answers : { ...SAFE_ANSWERS, workspaceRoots: [] }
  let step = resumeStep(stored, { tierRecorded: state.configured, steps: STEPS })
  /* The workspace facts come from the shell, so until they arrive the step says
     it is loading rather than showing an empty folder list that looks like an
     answer. `null` means "not asked for yet", which is distinct from a reply
     that came back unavailable. */
  let workspace = null
  let workspaceBusy = false
  let workspaceRefusal = null

  /* The sign-in step's own state. `null` means "not asked yet", which is
     distinct from a reply that came back unavailable -- painting an empty form
     during the read would show "create an account" to somebody who has one.
     No password is ever held here; see submitAccount(). */
  const account = accountStep()
  let accountState = null
  let accountBusy = false
  let accountNotice = null
  let accountMode = 'sign-in'
  let accountPicked = false

  const root = el(`<main class="view-pad setup-page">
    <div class="settings-shell setup-shell">
      <section class="settings-section setup-section" data-setup-section></section>
    </div>
  </main>`)
  const section = root.querySelector('[data-setup-section]')
  let detachSeg = null
  let segCleanups = []
  let destroyed = false

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
    releaseSegs()
    section.innerHTML = step === 'tier'
      ? markup()
      : `${progressMarkup()}${stepMarkup()}`
    wireSegs()
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
      /* The level is the ONLY thing this walkthrough writes before the end, and
         only because the first-run gate is built on it. Advancing to the folder
         question rather than into the app is the change the owner asked for:
         before this, step 1 was the whole of setup. */
      goTo('workspace')
      return
    }
    refusal = {
      title: 'That level was not saved',
      code: result?.code || 'MC_SETUP_SAVE_FAILED',
      reason: result?.reason || 'The application did not say why. Nothing on this computer was changed.',
    }
    paint()
  }

  /* ---------- the derived profile, recomputed rather than cached ---------- */

  function derived() {
    return deriveProfile(answers, {
      tier: recordedTier(),
      writeFlagIds: WRITE_FLAG_IDS,
      liveFlagIds: LIVE_FLAG_IDS,
    })
  }

  function recordedTier() {
    return TIER_IDS.includes(SETUP_RESOLUTION.tier) ? SETUP_RESOLUTION.tier : chosen
  }

  /* ---------- step chrome ---------- */

  function progressMarkup() {
    const index = QUESTION_STEPS.indexOf(step)
    const label = step === 'account'
      ? 'One more thing, and it is not a question'
      : index === -1
        ? 'Everything you just chose'
        : `Question ${index + 1} of ${QUESTION_STEPS.length}`
    return `<p class="setup-progress" data-setup-progress>${esc(label)}</p>`
  }

  function actionsMarkup({ back = null, next = null, nextLabel = 'Continue', nextDisabled = false, skip = true } = {}) {
    return `<div class="setup-actions">
      ${skip ? '<button type="button" class="setup-skip" data-setup-skip>Skip the rest for now</button>' : ''}
      <span class="setup-actions-spacer"></span>
      ${back ? `<button type="button" class="ctl-btn" data-setup-back="${esc(back)}" ${busy ? 'disabled' : ''}>Back</button>` : ''}
      ${next ? `<button type="button" class="ctl-btn" data-setup-next="${esc(next)}" ${busy || nextDisabled ? 'disabled' : ''}>${esc(nextLabel)}</button>` : ''}
    </div>`
  }

  function stepMarkup() {
    if (step === 'workspace') return workspaceMarkup()
    if (step === 'account') return accountMarkup()
    if (step === 'autonomy') return autonomyMarkup()
    return reviewMarkup()
  }

  /* ---------- step 3: signing in ----------
   *
   * docs/design/INSTALLER-EXPERIENCE.md section 3 step 6. It is HERE rather
   * than behind a link from the end, because a walkthrough that finishes with
   * "now go and find the account screen" is the one-way door this design
   * forbids. The same screen also lives at #/account for every later visit;
   * one screen, two entry points.
   *
   * IT FAILS OPEN, exactly like the folder question. No bridge, an unreadable
   * account file, or a refused sign-in all leave Continue working. Signing in
   * is not a wall: a person who skips it is signed out, which is an honest
   * working state, and their assistant's records say `unauthenticated` rather
   * than naming somebody who never signed in.
   *
   * NOTHING HERE TOUCHES `answers`. That object is serialised to localStorage
   * and rendered on the review page, so a password reaching it would be written
   * to disk in the clear. The account is its own durable state, written by the
   * shell at the moment of sign-in, and the only thing this step ever reads
   * back is a display name. */

  function accountMarkup() {
    if (accountState === null) {
      return `<h1 class="setup-title">${esc(ACCOUNT_QUESTION)}</h1>
        <div class="fleet-profile-status is-quiet" role="status">
          <strong>Reading this computer’s accounts…</strong>
        </div>
        ${actionsMarkup({ back: stepBefore(STEPS, 'account') })}`
    }
    if (!accountState.available) {
      return `<h1 class="setup-title">${esc(ACCOUNT_QUESTION)}</h1>
        <div class="fleet-profile-status is-serious" role="alert">
          <strong>This copy cannot hold an account</strong>
          <span>${esc(accountState.reason || 'The application did not say why.')} Nothing on this computer has been changed, and the rest of setup still works. Your assistant’s records will say that nobody was signed in.</span>
        </div>
        ${actionsMarkup({ back: stepBefore(STEPS, 'account'), next: stepAfter(STEPS, 'account') })}`
    }
    if (accountState.signedIn) {
      return `<h1 class="setup-title">Signed in as ${esc(accountState.displayName)}</h1>
        <div class="fleet-profile-status is-good" role="status">
          <strong>From now on, the record of what your assistant does says who asked for it.</strong>
          <span>You can sign out or change this later in Settings.</span>
        </div>
        ${actionsMarkup({ back: stepBefore(STEPS, 'account'), next: stepAfter(STEPS, 'account') })}`
    }

    const creating = accountMode === 'create'
    return `<h1 class="setup-title">${esc(ACCOUNT_QUESTION)}</h1>
      <p class="setup-subtitle">${esc(ACCOUNT_QUESTION_SUB)}</p>
      ${accountNotice ? `<div class="fleet-profile-status is-serious" role="alert">
        <strong>That did not work</strong>
        <span>${esc(accountNotice)}</span>
      </div>` : ''}
      <div class="settings-section-rows">
        <article class="settings-row fleet-profile-block setup-question">
          <div class="settings-copy">
            <div class="settings-name" id="setup-account-name">Name</div>
            <div class="settings-desc">${esc(creating
              ? 'Letters, numbers, and . _ - between them. This is what your assistant’s records will name.'
              : 'The name you chose when you made the account on this computer.')}</div>
          </div>
          <div class="fleet-profile-fields">
            <input class="fleet-profile-input" type="text" data-setup-account-field="username" autocomplete="username" spellcheck="false" autocapitalize="off" aria-labelledby="setup-account-name" ${accountBusy ? 'disabled' : ''}/>
          </div>
        </article>
        <article class="settings-row fleet-profile-block setup-question">
          <div class="settings-copy">
            <div class="settings-name" id="setup-account-password">Password</div>
            <div class="settings-desc">${esc(creating
              ? `At least ${MIN_PASSWORD_LENGTH} characters. A few unrelated words beat a short one with symbols in it. There is no reset, so use your password manager.`
              : 'The password for that account.')}</div>
          </div>
          <div class="fleet-profile-fields">
            <input class="fleet-profile-input" type="password" data-setup-account-field="password" autocomplete="${creating ? 'new-password' : 'current-password'}" aria-labelledby="setup-account-password" ${accountBusy ? 'disabled' : ''}/>
          </div>
        </article>
      </div>
      <div class="fleet-profile-status is-warn" role="status">
        <strong>${esc(ACCOUNT_SCOPE_LEAD)}</strong>
        ${ACCOUNT_SCOPE_NOTICE.map(paragraph => `<span>${esc(paragraph)}</span>`).join('')}
      </div>
      <div class="setup-actions">
        <button type="button" class="setup-skip" data-setup-skip>Skip the rest for now</button>
        <span class="setup-actions-spacer"></span>
        <button type="button" class="ctl-btn" data-setup-account-mode="${creating ? 'sign-in' : 'create'}" ${accountBusy ? 'disabled' : ''}>${creating ? 'I already have one' : 'Create an account'}</button>
        <button type="button" class="ctl-btn" data-setup-back="workspace" ${accountBusy ? 'disabled' : ''}>Back</button>
        <button type="button" class="ctl-btn" data-setup-next="${esc(stepAfter(STEPS, 'account'))}" ${accountBusy ? 'disabled' : ''}>Not now</button>
        <button type="button" class="ctl-btn" data-setup-account-submit="${creating ? 'create' : 'sign-in'}" ${accountBusy ? 'disabled' : ''}>${accountBusy ? 'Working…' : creating ? 'Create and continue' : 'Sign in and continue'}</button>
      </div>`
  }

  async function loadAccount() {
    accountState = await account.load()
    if (destroyed) return
    /* A computer with no account opens on "create"; one that already has
       accounts opens on "sign in". Only on the first read -- after that the
       person's own choice of form stands. */
    if (!accountPicked && accountState.available && accountState.accountCount === 0) accountMode = 'create'
    accountPicked = true
    if (step === 'account') paint()
  }

  /**
   * Create or sign in, then move on.
   *
   * The password is read from the field at the moment this runs, handed to the
   * shell, and the field is cleared on EVERY outcome -- a refused password left
   * sitting in the input is a password left in the DOM of a window somebody may
   * walk away from. Neither value is ever assigned to anything that outlives
   * this function.
   */
  async function submitAccount(kind) {
    if (accountBusy) return
    const usernameField = section.querySelector('[data-setup-account-field="username"]')
    const passwordField = section.querySelector('[data-setup-account-field="password"]')
    const username = usernameField ? usernameField.value : ''
    const password = passwordField ? passwordField.value : ''

    accountBusy = true
    accountNotice = null
    paint()

    let result
    if (kind === 'create') {
      result = await account.create({ username, displayName: '', password })
      /* Created and then signed in, as one action from the person's point of
         view. Making them retype the password they just chose, inside their own
         first run, is friction that buys nothing. */
      if (result.ok) result = await account.signIn({ username, password })
    } else {
      result = await account.signIn({ username, password })
    }
    if (destroyed) return

    accountBusy = false
    const stillThere = section.querySelector('[data-setup-account-field="password"]')
    if (stillThere) stillThere.value = ''
    if (!result.ok) {
      accountNotice = result.reason
      await loadAccount()
      paint()
      return
    }
    await loadAccount()
    goTo('autonomy')
  }

  /* ---------- question 2: the folder ---------- */

  function workspaceRoots() {
    if (answers.workspaceRoots.length) return answers.workspaceRoots
    if (workspace?.roots?.length) return workspace.roots
    return workspace?.suggested ? [workspace.suggested] : []
  }

  function workspaceMarkup() {
    if (workspace === null) {
      return `<h1 class="setup-title">Which folder should your assistant work in?</h1>
        <div class="fleet-profile-status is-quiet" role="status">
          <strong>Reading this computer’s configuration…</strong>
          <span>The folder question needs to know which permission level was recorded, because the level decides which folders can be used.</span>
        </div>
        ${actionsMarkup({ back: stepBefore(STEPS, 'workspace') })}`
    }
    if (workspace.available === false) {
      /* Fails OPEN, exactly like the permission gate. A copy that cannot record
         a folder must not trap anyone on a screen whose only button fails; the
         walkthrough continues and the review states plainly that the folder was
         left as recorded. */
      return `<h1 class="setup-title">Which folder should your assistant work in?</h1>
        <div class="fleet-profile-status is-serious" role="alert">
          <strong>This copy cannot record a folder</strong>
          <span>${esc(workspace.reason || 'The application did not say why.')} Nothing on this computer has been changed, and the rest of setup still works.</span>
        </div>
        ${actionsMarkup({ back: stepBefore(STEPS, 'workspace'), next: stepAfter(STEPS, 'workspace') })}`
    }

    const roots = workspaceRoots()
    const multiple = recordedTier() !== 'guided'
    return `<h1 class="setup-title">Which folder should your assistant work in?</h1>
      <div class="settings-section-rows">
        <article class="settings-row fleet-profile-block setup-question">
          <div class="settings-copy">
            <div class="settings-name">Working folder</div>
            <div class="settings-desc">${esc(multiple
              ? 'Your assistant may read and change things inside these folders. Everything outside them is off limits at the permission level you chose.'
              : 'Your assistant may read and change things inside this one folder. Everything else on this computer is off limits at the permission level you chose.')}</div>
          </div>
          <div class="fleet-profile-fields">
            ${roots.length
              ? roots.map((path, index) => `<div class="setup-root" data-setup-root-index="${index}">
                  <code class="setup-root-path">${esc(path)}</code>
                  ${roots.length > 1 ? `<button type="button" class="ctl-btn danger" data-setup-remove-root="${index}" aria-label="Remove ${esc(path)}" ${busy ? 'disabled' : ''}>Remove</button>` : ''}
                </div>`).join('')
              : '<p class="fleet-profile-empty">No folder chosen yet.</p>'}
            <div class="fleet-profile-actions">
              <button type="button" class="ctl-btn" data-setup-choose-root ${workspaceBusy || busy ? 'disabled' : ''}>${roots.length ? 'Choose a different folder…' : 'Choose a folder…'}</button>
              ${multiple ? `<button type="button" class="ctl-btn" data-setup-add-root ${workspaceBusy || busy ? 'disabled' : ''}>Add another folder</button>` : ''}
            </div>
            <small class="setup-hint">${esc(workspace.chosen || answers.workspaceRoots.length
              ? 'This folder is recorded. Nothing is created or changed until you finish setup.'
              : 'This is a suggestion, not a decision. It is created for you when you finish, and it is given a history so that undoing what an assistant did is a real thing this program can do.')}</small>
          </div>
        </article>
      </div>
      ${workspaceRefusal ? `<div class="fleet-profile-status is-serious" data-setup-status role="alert">
        <strong>That folder cannot be used</strong>
        <span>${esc(workspaceRefusal)}</span>
      </div>` : ''}
      ${actionsMarkup({ back: stepBefore(STEPS, 'workspace'), next: stepAfter(STEPS, 'workspace'), nextDisabled: roots.length === 0 })}`
  }

  /* ---------- question 3: how much it does on its own ---------- */

  function autonomyMarkup() {
    const profile = derived()
    const refused = profile.refusedWriteFlags
      .map(id => WRITE_ACTION_FLAGS.find(flag => flag.id === id)?.label || id)
    return `<h1 class="setup-title">How much should it do without asking you?</h1>
      <div class="settings-section-rows">
        <article class="settings-row fleet-profile-block setup-question">
          <div class="settings-copy">
            <div class="settings-name" id="setup-autonomy-label">Acting on its own</div>
            <div class="settings-desc">This one answer sets every switch that lets this program act rather than read. You can change any of them on the next screen, and afterwards in Settings.</div>
          </div>
          <div class="fleet-profile-fields">
            <div class="seg settings-seg setup-seg" role="group" aria-labelledby="setup-autonomy-label">
              ${AUTONOMY_CHOICES.map(choice => `<button type="button" data-setup-set="autonomy" data-setup-value="${esc(choice.value)}" aria-pressed="${choice.value === answers.autonomy ? 'true' : 'false'}" class="${choice.value === answers.autonomy ? 'on' : ''}" ${busy ? 'disabled' : ''}>${esc(choice.label)}</button>`).join('')}
            </div>
          </div>
        </article>
        ${AUTONOMY_CHOICES.map(choice => `<article class="settings-row setup-choice" aria-current="${choice.value === answers.autonomy ? 'true' : 'false'}">
          <div class="settings-copy">
            <div class="settings-name">${esc(choice.label)}${choice.note ? ` — ${esc(choice.note)}` : ''}</div>
            <div class="settings-desc">${esc(choice.detail)}</div>
          </div>
        </article>`).join('')}
      </div>
      ${refused.length ? `<div class="fleet-profile-status is-warn" role="status">
        <strong>Your permission level does not allow all of that</strong>
        <span>${esc(refused.join(', '))} stays off however this question is answered, because the “${esc(TIER_CHOICES.find(choice => choice.tier === recordedTier())?.label || recordedTier())}” level does not include it. Change the level to change that.</span>
      </div>` : ''}
      ${actionsMarkup({ back: stepBefore(STEPS, 'autonomy'), next: stepAfter(STEPS, 'autonomy'), nextLabel: 'See what that sets' })}`
  }

  /* ---------- the review ---------- */

  function reviewRow(name, desc, control) {
    return `<article class="settings-row">
      <div class="settings-copy">
        <div class="settings-name">${esc(name)}</div>
        <div class="settings-desc">${esc(desc)}</div>
      </div>
      <div class="settings-control">${control}</div>
    </article>`
  }

  /* One attribute pair for every choice control on the review -- `data-setup-set`
     names the answer, `data-setup-value` names the option. Encoding the field in
     the attribute NAME instead looked tidier and was a trap: HTML lowercases
     attribute names, so `data-setup-intent-ideImport` arrives as
     `setupIntentIdeimport` and the camel-cased field ids silently stop matching. */
  function segControl(target, options, current, label) {
    return `<div class="seg settings-seg" role="group" aria-label="${esc(label)}">
      ${options.map(option => `<button type="button" data-setup-set="${esc(target)}" data-setup-value="${esc(option.value)}" aria-pressed="${option.value === current ? 'true' : 'false'}" class="${option.value === current ? 'on' : ''}" ${busy ? 'disabled' : ''}>${esc(option.label)}</button>`).join('')}
    </div>`
  }

  function reviewMarkup() {
    const profile = derived()
    const tierChoice = TIER_CHOICES.find(choice => choice.tier === profile.tier)
    const roots = workspaceRoots()
    const on = WRITE_ACTION_FLAGS.filter(flag => profile.writeFlags[flag.id])
    const off = WRITE_ACTION_FLAGS.filter(flag => !profile.writeFlags[flag.id])

    return `<h1 class="setup-title">Here is what those answers set.</h1>
      <p class="setup-lede">Nothing has been written yet. Change anything here; the switches keep working in Settings afterwards.</p>
      <div class="settings-section-rows">
        ${reviewRow(
          'Permission level',
          `${tierChoice ? tierChoice.detail : 'A permission level is recorded for this computer.'}`,
          `<button type="button" class="ctl-btn" data-setup-back="tier" ${busy ? 'disabled' : ''}>${esc(tierChoice ? tierChoice.label : 'Change')}</button>`,
        )}
        ${reviewRow(
          roots.length > 1 ? 'Working folders' : 'Working folder',
          roots.length
            ? `${roots.join(' · ')}`
            : 'No folder was chosen, so the one already recorded for this computer is kept.',
          `<button type="button" class="ctl-btn" data-setup-back="workspace" ${busy ? 'disabled' : ''}>Change</button>`,
        )}
        ${reviewRow(
          'Acting on its own',
          AUTONOMY_CHOICES.find(choice => choice.value === answers.autonomy)?.detail || '',
          segControl('autonomy', AUTONOMY_CHOICES.map(choice => ({ value: choice.value, label: choice.label })), answers.autonomy, 'Acting on its own'),
        )}
        ${reviewRow(
          'What the screens show',
          SCREENS_CHOICES.find(choice => choice.value === answers.screens)?.detail || '',
          segControl('screens', SCREENS_CHOICES.map(choice => ({ value: choice.value, label: choice.label })), answers.screens, 'What the screens show'),
        )}
      </div>

      <h2 class="setup-subtitle">Switches this turned on</h2>
      <div class="settings-section-rows">
        <article class="settings-row setup-choice">
          <div class="settings-copy">
            <div class="settings-name">${on.length ? esc(on.map(flag => flag.label).join(' · ')) : 'None'}</div>
            <div class="settings-desc">${on.length
              ? 'These are the controls this program will offer you. Every one of them is also a switch in Settings → Write.'
              : 'Nothing that acts is switched on. Every screen still reads and reports; turn on what you want when you want it, here or in Settings → Write.'}</div>
          </div>
        </article>
        ${off.length ? `<article class="settings-row setup-choice">
          <div class="settings-copy">
            <div class="settings-name">Left off — ${esc(off.map(flag => flag.label).join(' · '))}</div>
            <div class="settings-desc">${profile.refusedWriteFlags.length
              ? 'Some of these are off because your permission level does not include them.'
              : 'Off is the shipped default for every one of these.'}</div>
          </div>
        </article>` : ''}
      </div>

      <h2 class="setup-subtitle">Decided for you, and changeable</h2>
      <div class="settings-section-rows">
        ${PROFILE_INTENT.map(field => reviewRow(
          field.name,
          field.desc,
          segControl(`intent:${field.id}`, field.order.map(value => ({ value, label: field.labels[value] })), profile.intent[field.id], field.name),
        )).join('')}
      </div>

      <div class="fleet-profile-status is-warn" role="status">
        <strong>What those four do today, stated plainly.</strong>
        <span>They record what you want and this program keeps them; the parts of it that would act on them are still being built, so today they change what is remembered rather than what happens. They are set to the cautious end unless you moved them.</span>
        <span>The only account this setup asks for is the one on this computer, described where it was offered. No subscription, key, or password for Claude, ChatGPT or Google is asked for anywhere in this setup or stored by this program — those stay in their own programs.</span>
      </div>

      ${refusal ? `<div class="fleet-profile-status is-serious" data-setup-status role="alert">
        <strong>${esc(refusal.title || 'That was not saved')}</strong>
        <span>${esc(refusal.reason || 'The application did not say why.')}</span>
      </div>` : ''}

      ${actionsMarkup({ back: stepBefore(STEPS, 'review'), next: 'finish', nextLabel: busy ? 'Saving…' : 'Finish setup' })}`
  }

  /* ---------- moving between steps ---------- */

  function goTo(next) {
    if (!STEPS.includes(next)) return
    step = next
    workspaceRefusal = null
    /* Held, not applied. A person who closes the window here has changed
       nothing on this computer beyond the permission level they explicitly
       saved, and reopening setup resumes on this step. */
    writeStoredProfile({ status: 'in-progress', step, answers })
    paint()
    if ((step === 'workspace' || step === 'review') && workspace === null) loadWorkspace()
  }

  async function loadWorkspace() {
    if (!globalThis.mcSetup?.workspaceState) {
      workspace = { available: false, reason: 'This page is running in a browser rather than the installed application, so there is no computer here to configure.' }
      paint()
      return
    }
    let result
    try {
      result = await globalThis.mcSetup.workspaceState()
    } catch (error) {
      result = { ok: false, available: false, reason: error?.message || String(error) }
    }
    if (destroyed) return
    workspace = result?.ok === false
      ? { available: false, reason: result.reason || 'The application did not say why.' }
      : result
    paint()
  }

  async function pickWorkspace(mode) {
    if (workspaceBusy || !globalThis.mcSetup?.chooseWorkspace) return
    workspaceBusy = true
    workspaceRefusal = null
    paint()
    let result
    try {
      result = await globalThis.mcSetup.chooseWorkspace()
    } catch (error) {
      result = { ok: false, reason: error?.message || String(error) }
    }
    if (destroyed) return
    workspaceBusy = false
    if (result?.canceled) { paint(); return }
    if (!result?.ok) {
      workspaceRefusal = result?.reason || 'The application did not say why.'
      paint()
      return
    }
    const current = mode === 'add' ? workspaceRoots() : []
    answers = { ...answers, workspaceRoots: current.includes(result.path) ? current : [...current, result.path] }
    writeStoredProfile({ status: 'in-progress', step, answers })
    paint()
  }

  function removeRoot(index) {
    const roots = workspaceRoots().slice()
    if (index < 0 || index >= roots.length || roots.length <= 1) return
    roots.splice(index, 1)
    answers = { ...answers, workspaceRoots: roots }
    writeStoredProfile({ status: 'in-progress', step, answers })
    paint()
  }

  /* ---------- writing it down ---------- */

  function applyDerived() {
    return applyProfile(derived(), { setWriteFlag: setWriteEnabled, setLiveFlag: setLiveView })
  }

  /**
   * Finish: the folders first, then the switches.
   *
   * The folder write is the only step that can fail, so it goes first and a
   * failure stops everything. Applying the switches and then failing to record
   * the folder would leave a machine that half-agrees with the screen the person
   * is looking at, which is worse than a refusal they can act on.
   */
  async function finish() {
    if (busy) return
    busy = true
    refusal = null
    paint()

    const roots = workspaceRoots()
    const needsWrite = roots.length > 0 && globalThis.mcSetup?.recordWorkspaces && workspace?.available !== false
    if (needsWrite) {
      let result
      try {
        result = await globalThis.mcSetup.recordWorkspaces(roots)
      } catch (error) {
        result = { ok: false, reason: error?.message || String(error) }
      }
      if (destroyed) return
      if (!result?.ok) {
        busy = false
        refusal = {
          title: 'That folder was not saved',
          code: result?.code || 'MC_SETUP_WORKSPACE_FAILED',
          reason: `${result?.reason || 'The application did not say why.'} Nothing else was changed either.`,
        }
        paint()
        return
      }
      answers = { ...answers, workspaceRoots: result.roots }
    }

    applyDerived()
    writeStoredProfile({ status: 'complete', step: 'review', answers })
    busy = false
    navigate('#/')
  }

  /**
   * Skip: apply the safe answers, explicitly.
   *
   * Writing them rather than leaving storage empty is deliberate. The effective
   * state is identical either way -- src/write-flags.js treats anything but the
   * literal "enabled" as off, and live views default live -- but a declared
   * state can be shown on the review and in Settings, and an implied one cannot.
   * The workspace is left alone: skipping is not an answer to that question.
   */
  function skip() {
    if (busy) return
    answers = { ...SAFE_ANSWERS, workspaceRoots: [] }
    applyDerived()
    writeStoredProfile({ status: 'skipped', step: 'review', answers })
    navigate('#/')
  }

  /* ---------- wiring ---------- */

  function releaseSegs() {
    detachSeg?.()
    detachSeg = null
    for (const cleanup of segCleanups) cleanup()
    segCleanups = []
  }

  function wireSegs() {
    const groups = [...section.querySelectorAll('.seg')]
    if (step === 'tier') {
      const group = section.querySelector('.setup-seg')
      if (group) detachSeg = attachSeg(group)
      return
    }
    for (const group of groups) segCleanups.push(attachSeg(group))
  }

  function onClick(event) {
    const option = event.target.closest('[data-setup-tier]')
    if (option) { select(option.dataset.setupTier); return }
    if (event.target.closest('[data-setup-continue]')) { commit(); return }

    const back = event.target.closest('[data-setup-back]')
    if (back) { goTo(back.dataset.setupBack); return }

    const next = event.target.closest('[data-setup-next]')
    if (next) {
      if (next.dataset.setupNext === 'finish') finish()
      else goTo(next.dataset.setupNext)
      return
    }

    if (event.target.closest('[data-setup-skip]')) { skip(); return }
    if (event.target.closest('[data-setup-choose-root]')) { pickWorkspace('replace'); return }
    if (event.target.closest('[data-setup-add-root]')) { pickWorkspace('add'); return }

    const remove = event.target.closest('[data-setup-remove-root]')
    if (remove) { removeRoot(Number(remove.dataset.setupRemoveRoot)); return }

    const accountSubmit = event.target.closest('[data-setup-account-submit]')
    if (accountSubmit) { submitAccount(accountSubmit.dataset.setupAccountSubmit); return }

    const accountModeButton = event.target.closest('[data-setup-account-mode]')
    if (accountModeButton) {
      if (accountBusy) return
      accountMode = accountModeButton.dataset.setupAccountMode
      accountNotice = null
      accountPicked = true
      paint()
      return
    }

    const setter = event.target.closest('[data-setup-set]')
    if (setter) setAnswer(setter.dataset.setupSet, setter.dataset.setupValue)
  }

  /**
   * Record one answer, refusing anything this build does not recognise.
   *
   * The value arrives from an attribute, so it is treated as untrusted input and
   * checked against the model's own vocabulary rather than assigned. An
   * unrecognised value silently becoming an answer is how a profile ends up
   * holding a setting no part of the product can act on.
   */
  function setAnswer(target, value) {
    if (busy) return
    let next = null
    if (target === 'autonomy') {
      /* A different overall posture resets the four detail settings to that
         posture's own coherent set. Keeping a hand-moved value across a change
         of answer produces a profile nobody chose. */
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
    answers = next
    writeStoredProfile({ status: 'in-progress', step, answers })
    paint()
  }

  section.addEventListener('click', onClick)
  paint()
  if (step === 'workspace' || step === 'review') loadWorkspace()
  /* Read on mount rather than on arrival at the step, so the step paints its
     real state on the first frame instead of flashing "reading accounts". */
  loadAccount()

  return {
    el: root,
    destroy() {
      destroyed = true
      section.removeEventListener('click', onClick)
      releaseSegs()
    },
  }
}
