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
import { setupAccountStepMarkup } from '../account-markup.js'
import {
  ACCOUNT_QUESTION,
  ACCOUNT_QUESTION_SUB,
  ACCOUNT_SCOPE_LEAD,
  ACCOUNT_SCOPE_NOTICE,
  MIN_PASSWORD_LENGTH,
  accountStep,
  loadGoogleAvailability,
} from '../account-state.js'
import { LIVE_VIEW_FLAGS, setLiveView } from '../live-flags.js'
import { WRITE_ACTION_FLAGS, setWriteEnabled } from '../write-flags.js'
import {
  AUTONOMY_CHOICES,
  PROFILE_INTENT,
  RECOMMENDED_ANSWERS,
  SAFE_ANSWERS,
  SCREENS_CHOICES,
  answersForAutonomy,
  applyProfile,
  autonomyStartsAgents,
  deriveProfile,
  intentField,
  profileCanStartAnAgent,
  readStoredProfile,
  resumeStep,
  stepAfter,
  stepBefore,
  writeStoredProfile,
  INTENT_BANNER_BODY,
  INTENT_BANNER_TITLE,
} from '../setup-profile.js'
/* The remedy commands and the per-code sentences, taken from the module that
   owns them rather than restated here. Setup, the home screen and the agent
   page all tell a person how to get Codex working; three hand-written copies of
   a command line is three chances to ship one that does not run. */
/* The decision itself, DOM-free, so the suite drives it rather than reading it. */
import { codexReadiness } from '../setup-review-readiness.js'
/* WHAT EACH SWITCH GRANTS, WHAT IT RISKS, AND WHAT WAS WITHHELD (owner, R1529).
   The statements are data in src/permission-guidance.js so this screen, the
   settings page and the drawer cannot describe one switch three ways. */
import { guidanceMarkup, withheldMarkup } from '../guided-step.js'
import { probe, refreshCapabilityProbes } from '../capability-probes.js'

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
  /* RECOMMENDED_ANSWERS, not SAFE_ANSWERS, and the two are different constants
     for the reason set out at their definitions: this is what the walkthrough
     OFFERS a person who is answering, and skip() below still applies the safe
     ones to a person who is not. Preselecting the answer that switches nothing
     on is how the recommended path came to end at a product with no control
     that starts anything. */
  let answers = stored ? stored.answers : { ...RECOMMENDED_ANSWERS, workspaceRoots: [] }
  let step = resumeStep(stored, { tierRecorded: state.configured, steps: STEPS })
  /* The workspace facts come from the shell, so until they arrive the step says
     it is loading rather than showing an empty folder list that looks like an
     answer. `null` means "not asked for yet", which is distinct from a reply
     that came back unavailable. */
  let workspace = null
  let workspaceBusy = false
  let workspaceRefusal = null

  /* WHETHER AN AGENT CAN ACTUALLY RUN WHEN THIS FINISHES, which setup used not
   * to ask at any point.
   *
   * Setup configured a permission level, a folder and an account, said "Finish
   * setup", and handed the person a home screen reading "Not ready yet -- sign
   * in to Codex on this computer". Nothing in the walkthrough had mentioned
   * Codex, and nothing anywhere in the product said how to get it. A setup that
   * completes successfully and lands on a blocker it never named is a setup that
   * is not finished, whatever it says on the button.
   *
   * `null` means "not asked yet", the same convention the two states above use.
   * It is READ ONLY -- setup does not install anything and does not gate Finish
   * on the answer, because the recorded level, the folder and the account are all
   * still worth saving on a machine where Codex is not installed yet. It tells
   * the person what remains and lets them finish. */
  let agentReadiness = null
  /* What THIS COMPUTER has, per assistant program, from mcProviders.presence().
     null while unasked; `known:false` when it could not be asked, which the
     review says out loud rather than rounding to a tick. */
  let codexPresence = null

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
  /* Whether this copy can sign in with Google. `null` is "not asked yet",
     which the step renders differently from "not available" -- see
     googleOptionMarkup(). */
  let accountGoogle = null

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

  /* The step's markup lives in src/account-markup.js, called rather than
     inlined. This file imports three stylesheets and touches the DOM, so no
     test can render it -- and a plant proved what that costs: accountMarkup()
     could return an empty string, and the scope notice could be deleted
     outright, with the entire suite still green. That notice is the
     SHIPMENT-PLAN B14 disclosure, on the screen where a first-time user
     creates an account. The builder is now callable, so both defects die.

     The action bar is rendered HERE and passed in: the walkthrough owns which
     step comes next, and the builder has no business knowing. */
  function accountMarkup() {
    const back = stepBefore(STEPS, 'account')
    const next = stepAfter(STEPS, 'account')
    if (accountState === null) return setupAccountStepMarkup({ accountState, actions: actionsMarkup({ back }) })
    if (!accountState.available || accountState.signedIn) {
      return setupAccountStepMarkup({ accountState, actions: actionsMarkup({ back, next }) })
    }
    return setupAccountStepMarkup({
      accountState,
      google: accountGoogle,
      mode: accountMode,
      busy: accountBusy,
      notice: accountNotice,
      actions: `<div class="setup-actions">
        <button type="button" class="setup-skip" data-setup-skip>Skip the rest for now</button>
        <span class="setup-actions-spacer"></span>
        <button type="button" class="ctl-btn" data-setup-account-mode="${accountMode === 'create' ? 'sign-in' : 'create'}" ${accountBusy ? 'disabled' : ''}>${accountMode === 'create' ? 'I already have one' : 'Create an account'}</button>
        <button type="button" class="ctl-btn" data-setup-back="${esc(back)}" ${accountBusy ? 'disabled' : ''}>Back</button>
        <button type="button" class="ctl-btn" data-setup-next="${esc(next)}" ${accountBusy ? 'disabled' : ''}>Not now</button>
        <button type="button" class="ctl-btn" data-setup-account-submit="${accountMode === 'create' ? 'create' : 'sign-in'}" ${accountBusy ? 'disabled' : ''}>${accountBusy ? 'Working…' : accountMode === 'create' ? 'Create and continue' : 'Sign in and continue'}</button>
      </div>`,
    })
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
    /* Asked AFTER the step can paint, so the walkthrough never waits on it.
       Only while signed out: a person who is already signed in is not being
       offered a way to sign in. */
    if (accountState.signedIn) return
    accountGoogle = await loadGoogleAvailability()
    if (destroyed) return
    if (step === 'account') paint()
  }

  /* SIGN IN WITH GOOGLE, inside the walkthrough.
   *
   * The same call the account screen makes, and the same rule: nothing is sent
   * from this page, and every failure lands SIGNED OUT with the shell's own
   * sentence. It does not advance the walkthrough on a failure and it does not
   * fall back to the password form on the person's behalf -- the form is
   * already on screen underneath, for them to choose. */
  async function startGoogleSignIn() {
    if (accountBusy) return
    accountBusy = true
    accountNotice = null
    paint()
    let result
    try { result = await account.googleSignIn() } catch { result = { ok: false, reason: 'The application did not answer.' } }
    if (destroyed) return
    accountBusy = false
    if (!result || result.ok !== true) {
      accountNotice = (result && result.reason) || 'The Google sign-in did not complete, so nobody was signed in.'
      await loadAccount()
      if (destroyed) return
      paint()
      return
    }
    accountNotice = null
    await loadAccount()
    if (destroyed) return
    paint()
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
    /* Only rendered on the create form, so it is absent on sign-in -- and absent
       there is not an empty answer, it is no question asked. Either way what is
       handed to the shell is a string, and the shell is the one place that
       decides what an empty one means. */
    const displayNameField = section.querySelector('[data-setup-account-field="displayName"]')
    const username = usernameField ? usernameField.value : ''
    const password = passwordField ? passwordField.value : ''
    const displayName = displayNameField ? displayNameField.value : ''

    accountBusy = true
    accountNotice = null
    paint()

    let result
    if (kind === 'create') {
      /* The name the person typed, not a hardcoded empty string. Passing '' made
         the username the permanent label on their records: the walkthrough never
         asked, and nothing anywhere could change it afterwards. The field above
         asks; changeDisplayName in shell/product-account.cjs is what makes it
         changeable later, and the field's own copy promises exactly that. */
      result = await account.create({ username, displayName, password })
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
              : 'This is a suggestion, not a decision. It is created for you when you finish. It is given a history, so undoing what an assistant did is a real thing this program can do.')}</small>
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

  /* THE CONSEQUENCE OF THE CURRENT ANSWER, STATED WHERE THE ANSWER IS MADE.
   *
   * The defect this repairs was not that `observe` exists -- someone who wants
   * to read before running anything is entitled to that answer. It was that
   * choosing it produced a product with no control anywhere that starts an
   * agent, and said so NOWHERE: the person met an absence and had to work out
   * that it was an answer they had given two screens earlier.
   *
   * It is driven by the DERIVED profile, not by the chosen label. The question
   * is "after these answers, on this permission level, does a control that
   * starts an agent exist?", and that has the ceiling already applied -- so if
   * a level ever stopped permitting the start flag, this block would report it
   * without anyone having to remember to write a second sentence. */
  function consequenceMarkup(profile) {
    if (profileCanStartAnAgent(profile)) return ''
    const tierLabel = TIER_CHOICES.find(choice => choice.tier === recordedTier())?.label || recordedTier()
    const sentence = autonomyStartsAgents(answers.autonomy)
      ? `The “${tierLabel}” permission level does not allow a session to be started on this computer, so the agent page will show no Start control. Change the level to change that.`
      : AUTONOMY_CHOICES.find(choice => choice.value === answers.autonomy)?.consequence
        || 'No control that starts an agent will be shown until this is changed.'
    return `<div class="fleet-profile-status is-warn" role="status" data-setup-consequence>
      <strong>With this answer, nothing here will start an agent</strong>
      <span>${esc(sentence)}</span>
    </div>`
  }

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
            ${choice.consequence ? `<div class="settings-desc setup-consequence">${esc(choice.consequence)}</div>` : ''}
          </div>
        </article>`).join('')}
      </div>
      ${consequenceMarkup(profile)}
      ${refused.length ? `<div class="fleet-profile-status is-warn" role="status">
        <strong>Your permission level does not allow all of that</strong>
        <span>${esc(refused.join(', '))} ${refused.length > 1 ? 'stay' : 'stays'} off however this question is answered, because the “${esc(TIER_CHOICES.find(choice => choice.tier === recordedTier())?.label || recordedTier())}” level does not include ${refused.length > 1 ? 'them' : 'it'}. Change the level to change that.</span>
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

  /* THE STEP THE WALKTHROUGH USED TO LEAVE OUT ENTIRELY.
   *
   * Codex is the program that actually runs an agent, and setup never mentioned
   * it: a person answered three questions, pressed Finish, and met a home screen
   * saying "Not ready yet" about software they had never been told to install.
   * The remedy existed nowhere in the product.
   *
   * IT NAMES THE COMMAND RATHER THAN THE CONCEPT. "Install the Codex CLI" is
   * something a person then has to go and research; a line they can paste is
   * something they can do. The winget form is given first because it needs no
   * Node -- on a machine with nothing installed it is the only one of the two
   * that works -- and both were run on a real machine before being written here.
   *
   * IT DOES NOT BLOCK FINISH, and that is deliberate rather than lax. The level,
   * the folder and the account are all worth recording on a computer that does
   * not have Codex yet, and a walkthrough that refuses to end until an unrelated
   * program is installed is a worse first hour than one that says what is left.
   * The state it reports is read, never written. */
  /* WHICH QUESTION IS BEING ANSWERED, AND BY WHOM.
   *
   * This block makes two claims about CODEX -- that it is installed here, and
   * that somebody is signed in to it -- and it used to read both of them off
   * mcAgent.availability(), which answers a different question: can this
   * installation start ANY agent. That short-circuit is correct and deliberate
   * (d1eb2a5): a person with Claude installed and no Codex is not a broken
   * machine, and telling them so would be the product calling itself broken on
   * a correctly set-up computer.
   *
   * But a provider-agnostic yes rendered as a fact about Codex is how the last
   * screen of setup came to say "Codex is installed on this computer and signed
   * in" on a machine with no Codex on PATH and nobody signed in to it --
   * measured on the packaged build 2026-08-16, where the sentence flipped on
   * whether CLAUDE was installed. Worse than the false sentence: it made the
   * not-installed branch below -- the one carrying the paste-able install
   * command -- unreachable for exactly the person who needed it.
   *
   * So the copy asks the bridge that answers per program. mcProviders.presence()
   * reports `installed` and `signedIn` for codex on their own, from the
   * filesystem, with 'unknown' as a real answer it uses rather than rounding
   * off. The short-circuit is untouched; what changed is that this screen stops
   * quoting it as evidence about a program it never mentioned.
   *
   * A KNOWN-BAD ENGINE STILL SPEAKS, because "Codex is here and signed in" is
   * not the whole of "an agent can start": a build with no engine payload
   * refuses whatever is installed. That answer is availability()'s to give and
   * it keeps its branch, above the provider ones. */
  function codexReadinessMarkup() {
    const block = codexReadiness({ engine: agentReadiness, codex: codexPresence })
    return statusBlock(block.tone, block.heading, block.lines)
  }

  function statusBlock(modifier, heading, lines) {
    return `<div class="fleet-profile-status ${esc(modifier)}" role="status">
        <strong>${esc(heading)}</strong>
        ${lines.map(line => `<span>${esc(line)}</span>`).join('')}
      </div>`
  }

  /* WHAT THE RECOMMENDED PATH WITHHELD, SAID OUT LOUD (owner, R1529).
   *
   * This block used to be one line -- "Off is the shipped default for every one
   * of these" -- under a list of names. That is a true sentence and it is not an
   * answer: a person who took both Recommended answers arrived here, read that
   * their permission level "does not include" four switches, and had no way to
   * learn what any of them would have done, what it would have cost, whether
   * they were supposed to go and get it, or where the switch is. It is the same
   * shape as the defect this walkthrough already fixed once, one level in: an
   * absence a person has to diagnose.
   *
   * So every withheld switch now answers the three questions the directive
   * names -- what is off, what would turn it on, what that gains and risks --
   * and says in as many words that turning it on is optional.
   *
   * IT DOES NOT SWITCH ANYTHING ON, and that is the half worth stating. The
   * recommended answers grant exactly what they granted before this block
   * existed. The repair is guidance; a repair that closed the gap by granting
   * more by default would be the thing the directive forbids.
   *
   * THE REASON IS PER SWITCH, not per section. "Your level does not include it"
   * and "the answer you chose does not ask for it" are different facts with
   * different remedies -- one is changed at the permission question, the other
   * at this one -- and a person given the wrong one goes to the wrong screen. */
  function withheldSectionMarkup(profile, off) {
    if (off.length === 0) return ''
    const tierLabel = TIER_CHOICES.find(choice => choice.tier === profile.tier)?.label || profile.tier
    const refused = new Set(profile.refusedWriteFlags)
    return `<h2 class="setup-subtitle">Left off, and what each one would have given you</h2>
      <p class="setup-lede">None of these is required. This program works as it is; each one is an offer, with what it costs stated beside what it gives.</p>
      ${off.map(flag => withheldMarkup(`write_${flag.id}`, {
        label: flag.label,
        reason: refused.has(flag.id)
          ? `It is off because the “${tierLabel}” permission level does not include it. Choosing a wider level at the permission question is what would change that.`
          : 'It is off because the answer you chose does not ask for it. Changing that answer, or the switch itself in Settings, is what would turn it on.',
      })).join('')}`
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

      ${consequenceMarkup(profile)}

      ${codexReadinessMarkup()}

      <h2 class="setup-subtitle">Switches this turned on</h2>
      <div class="settings-section-rows">
        ${on.length ? on.map(flag => `<article class="settings-row setup-choice">
          <div class="settings-copy">
            <div class="settings-name">${esc(flag.label)}</div>
            <div class="settings-desc">This is a control this program will now offer you. The same switch is in Settings → Write.</div>
            ${guidanceMarkup(`write_${flag.id}`, { probe, summary: 'What this lets happen, and what it risks' })}
          </div>
        </article>`).join('') : `<article class="settings-row setup-choice">
          <div class="settings-copy">
            <div class="settings-name">None</div>
            <div class="settings-desc">Nothing that acts is switched on. Every screen still reads and reports; turn on what you want when you want it, here or in Settings → Write.</div>
          </div>
        </article>`}
      </div>

      ${withheldSectionMarkup(profile, off)}

      <h2 class="setup-subtitle">Decided for you, and changeable</h2>
      <div class="settings-section-rows">
        ${PROFILE_INTENT.map(field => reviewRow(
          field.name,
          field.desc,
          segControl(`intent:${field.id}`, field.order.map(value => ({ value, label: field.labels[value] })), profile.intent[field.id], field.name),
        )).join('')}
      </div>

      <div class="fleet-profile-status is-warn" role="status">
        <strong>${INTENT_BANNER_TITLE}</strong>
        <span>${INTENT_BANNER_BODY}</span>
        <span>The only account this setup asks for is the one on this computer, described where it was offered. Nothing in this setup asks for a subscription, key or password for Claude, ChatGPT or Google, and this program stores none. Those stay in their own programs.</span>
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
    /* Re-asked every time the review step is REACHED, not cached for the life
       of the view: the whole point of naming the commands is that somebody goes
       and runs them, and stepping back and forward is the one gesture available
       to a person who just did. */
    if (step === 'review') loadAgentReadiness()
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

  /* IS THE CODEX PROGRAM ITSELF HERE, asked of the bridge that answers per
     program rather than inferred from "can anything start". Same rule as
     everything else on this screen: an answer that cannot be got stays
     unanswered, and 'unknown' from the shell survives as 'unknown' here. */
  async function loadCodexPresence() {
    if (!globalThis.mcProviders?.presence) {
      codexPresence = { known: false }
      return
    }
    let answer
    try {
      answer = await globalThis.mcProviders.presence()
    } catch {
      answer = null
    }
    if (destroyed) return
    const codex = answer && answer.ok === true && Array.isArray(answer.providers)
      ? answer.providers.find(provider => provider.id === 'codex')
      : null
    codexPresence = codex
      ? { known: true, installed: codex.installed, signedIn: codex.signedIn }
      : { known: false }
  }

  /* Fails to an honest silence, never to a green tick. Every branch that cannot
     get an answer leaves `agentReadiness` reporting `unknown`, and the review
     step then says it could not check rather than implying it passed. */
  async function loadAgentReadiness() {
    /* Asked on the same beat, because the review reads both: the engine's own
       verdict, and what this machine has installed. */
    void loadCodexPresence().then(() => { if (!destroyed) paint() })
    if (!globalThis.mcAgent?.availability) {
      agentReadiness = { known: false }
      paint()
      return
    }
    let reply
    try {
      reply = await globalThis.mcAgent.availability()
    } catch {
      reply = null
    }
    if (destroyed) return
    agentReadiness = reply && typeof reply === 'object' && typeof reply.ok === 'boolean'
      ? { known: true, ok: reply.ok === true, code: typeof reply.code === 'string' ? reply.code : '' }
      : { known: false }
    paint()
    /* The guided steps on this screen ask the same question of a few more
       outside things. Same rule as above: an answer that cannot be got stays
       unanswered and the step says it could not check. */
    await refreshCapabilityProbes()
    if (destroyed) return
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
   *
   * BEING DESTROYED IS NOT A REASON TO DROP THE PRESS, and reading it as one was
   * a dead end at the last click of setup.
   *
   * MEASURED, on the packaged window from a sterile profile: this view can be
   * mounted TWICE -- two [data-setup-section] elements and two Continue buttons
   * exist in the DOM at once -- and the copy a person's eye reaches first is the
   * one the router has already torn down. Every question still answered
   * correctly on it, because each instance wires its own section. Then Finish
   * awaited the folder write, came back to `destroyed === true`, and RETURNED.
   * Nothing was applied, no profile was recorded, nothing navigated. The stored
   * record was still `in-progress` and the walkthrough restarted at question 1,
   * forever. The most important button in the product did precisely nothing and
   * said nothing, which is the worst shape a failure can take.
   *
   * The guard was right about ONE thing: a destroyed instance must not paint,
   * because its section is detached and painting it shows nobody anything. But
   * applying the profile, recording it and navigating are writes to
   * localStorage and to the route -- global, and every bit as correct from an
   * instance that has been torn down as from one that has not. The person
   * pressed Finish. The folder was already written by the time this returns.
   * So the guard now covers only the paint, and the outcome happens either way.
   *
   * The double mount itself is the deeper defect and is not this file's to fix:
   * it is the router that mounts a second copy without removing the first.
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
      if (!result?.ok) {
        busy = false
        refusal = {
          title: 'That folder was not saved',
          code: result?.code || 'MC_SETUP_WORKSPACE_FAILED',
          reason: `${result?.reason || 'The application did not say why.'} Nothing else was changed either.`,
        }
        /* A refusal a torn-down section cannot show is still a refusal, so the
           run stops here rather than completing a setup whose folder failed. */
        if (!destroyed) paint()
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

    if (event.target.closest('[data-google-signin-start]')) { startGoogleSignIn(); return }
    if (event.target.closest('[data-google-signin-cancel]')) {
      try { account.googleCancel() } catch { /* the attempt has already finished */ }
      return
    }

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
  if (step === 'review') loadAgentReadiness()
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
