/* THE SIGN-IN SCREEN.
 *
 * One screen, two entry points: the first-run walkthrough links to it, and it
 * stays reachable afterwards at #/account so a person can sign out, sign in as
 * somebody else, or change a password. Building it twice would produce two
 * sign-in forms that drift, which on an auth surface is not a cosmetic problem.
 *
 * WHAT IT SAYS BEFORE IT ASKS. src/account-state.js holds the three sentences,
 * and they are on the screen rather than in a policy document because every one
 * of them corrects an assumption the words "create an account" produce by
 * default: that there is a server, that there is an email address, and that a
 * forgotten password can be reset. None of those is true here.
 *
 * THE PASSWORD IS READ AND DROPPED. It is taken from the input at the moment of
 * submit, passed to the shell, and the field is cleared. It is never held in
 * the closure between actions, never put in `state`, never written to
 * localStorage, and never included in a status message -- the refusals below
 * render `result.reason`, which comes from the main process and is written not
 * to quote the input.
 *
 * `autocomplete` is set on every field so a password manager fills the right
 * one, and `new-password` on creation so it offers to generate rather than to
 * reuse. A sign-in form that fights the browser's password manager pushes
 * people towards passwords they can remember, which is the opposite of the
 * point.
 */

import { el } from '../components.js'
import {
  ACCOUNT_QUESTION,
  ACCOUNT_QUESTION_SUB,
  ACCOUNT_SCOPE_LEAD,
  ACCOUNT_SCOPE_NOTICE,
  MIN_PASSWORD_LENGTH,
  accountBridge,
  loadAccountState,
  readActionResult,
} from '../account-state.js'

import '../settings.css'
import '../fleet-profile-settings.css'
import '../setup.css'

const esc = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

function expiryText(expiresAtMs) {
  if (!Number.isSafeInteger(expiresAtMs)) return ''
  const days = Math.max(0, Math.round((expiresAtMs - Date.now()) / 86_400_000))
  if (days <= 0) return 'This sign-in expires today.'
  return `This sign-in expires in ${days} day${days === 1 ? '' : 's'}, and you sign in again then.`
}

export function accountView({ navigate = hash => { location.hash = hash } } = {}) {
  const root = el(`<main class="view-pad setup-page">
    <div class="settings-shell setup-shell">
      <section class="settings-section setup-section" data-account-section></section>
    </div>
  </main>`)
  const section = root.querySelector('[data-account-section]')
  let destroyed = false

  /* `null` means "not asked yet", which is distinct from a reply that came back
     unavailable. Painting an empty form during the read would show a
     create-account screen to somebody who already has one. */
  let state = null
  let busy = false
  let notice = null
  /* Which form is showing. `mode` is only ever set from this file's own
     buttons, never from a reply, so a malformed shell answer cannot select a
     form. */
  let mode = 'sign-in'

  function statusMarkup() {
    if (notice) {
      return `<div class="fleet-profile-status ${notice.tone === 'good' ? 'is-good' : notice.tone === 'warn' ? 'is-warn' : 'is-serious'}" role="${notice.tone === 'good' ? 'status' : 'alert'}">
        <strong>${esc(notice.title)}</strong>
        <span>${esc(notice.detail)}</span>
      </div>`
    }
    /* is-warn, not is-serious: a sign-in that cannot be remembered across a
       relaunch is a working product with a stated limit, not a fault. */
    if (state?.available && state.canPersistSession === false) {
      return `<div class="fleet-profile-status is-warn" role="status">
        <strong>This computer cannot remember a sign-in.</strong>
        <span>Windows did not offer the protected storage this uses, so signing in will last until you close the program and you will be asked again next time. Everything else works normally.</span>
      </div>`
    }
    return ''
  }

  function scopeMarkup() {
    return `<div class="fleet-profile-status is-warn" role="status">
      <strong>${esc(ACCOUNT_SCOPE_LEAD)}</strong>
      ${ACCOUNT_SCOPE_NOTICE.map(paragraph => `<span>${esc(paragraph)}</span>`).join('')}
    </div>`
  }

  function unavailableMarkup() {
    return `<h1 class="setup-title">${esc(ACCOUNT_QUESTION)}</h1>
      <div class="fleet-profile-status is-serious" role="alert">
        <strong>There is no account on this page to sign in to.</strong>
        <span>${esc(state?.reason || 'The application did not say why.')}</span>
      </div>
      <div class="setup-actions">
        <div class="setup-actions-spacer"></div>
        <button type="button" class="ctl-btn" data-account-home>Back to Mission Control</button>
      </div>`
  }

  function signedInMarkup() {
    return `<h1 class="setup-title">Signed in as ${esc(state.displayName)}</h1>
      ${statusMarkup()}
      <div class="settings-section-rows">
        <article class="settings-row">
          <div class="settings-copy">
            <div class="settings-name">Account</div>
            <div class="settings-desc">${esc(state.username)} — an account on this computer only. Work your assistant does is recorded against it. ${esc(expiryText(state.expiresAtMs))}</div>
          </div>
        </article>
        <article class="settings-row">
          <div class="settings-copy">
            <div class="settings-name">Change password</div>
            <div class="settings-desc">Changing it signs you out here and ends every other sign-in to this account, including any that was copied off this computer.</div>
          </div>
          <div class="settings-control fleet-inline-control">
            <button type="button" class="ctl-btn" data-account-mode="change-password" ${busy ? 'disabled' : ''}>Change password</button>
          </div>
        </article>
        <article class="settings-row">
          <div class="settings-copy">
            <div class="settings-name">Sign out</div>
            <div class="settings-desc">“Sign out” ends this sign-in on this computer. “Sign out everywhere” also refuses any saved sign-in taken from this computer earlier — use it if you think a copy of it exists.</div>
          </div>
          <div class="settings-control fleet-inline-control">
            <button type="button" class="ctl-btn" data-account-sign-out ${busy ? 'disabled' : ''}>${busy ? 'Working…' : 'Sign out'}</button>
            <button type="button" class="ctl-btn" data-account-sign-out-everywhere ${busy ? 'disabled' : ''}>Sign out everywhere</button>
          </div>
        </article>
      </div>
      <div class="setup-actions">
        <div class="setup-actions-spacer"></div>
        <button type="button" class="ctl-btn" data-account-home>Back to Mission Control</button>
      </div>`
  }

  function changePasswordMarkup() {
    return `<h1 class="setup-title">Change your password</h1>
      ${statusMarkup()}
      <form class="settings-section-rows" data-account-form="change-password" autocomplete="on">
        <input type="text" name="username" value="${esc(state.username)}" autocomplete="username" hidden readonly aria-hidden="true" tabindex="-1"/>
        <article class="settings-row">
          <div class="settings-copy">
            <div class="settings-name" id="account-current-label">Current password</div>
            <div class="settings-desc">Asked for even though you are signed in, so an unlocked window left alone is not enough to take the account over.</div>
          </div>
          <div class="settings-control fleet-inline-control">
            <input class="fleet-profile-input" type="password" name="currentPassword" autocomplete="current-password" aria-labelledby="account-current-label" ${busy ? 'disabled' : ''}/>
          </div>
        </article>
        <article class="settings-row">
          <div class="settings-copy">
            <div class="settings-name" id="account-new-label">New password</div>
            <div class="settings-desc">At least ${MIN_PASSWORD_LENGTH} characters. Length is what makes a password hard to guess — a few unrelated words beat a short one with symbols in it.</div>
          </div>
          <div class="settings-control fleet-inline-control">
            <input class="fleet-profile-input" type="password" name="newPassword" autocomplete="new-password" aria-labelledby="account-new-label" ${busy ? 'disabled' : ''}/>
          </div>
        </article>
        <div class="setup-actions">
          <button type="button" class="ctl-btn" data-account-mode="signed-in" ${busy ? 'disabled' : ''}>Back</button>
          <div class="setup-actions-spacer"></div>
          <button type="submit" class="ctl-btn" ${busy ? 'disabled' : ''}>${busy ? 'Saving…' : 'Change password'}</button>
        </div>
      </form>`
  }

  function formMarkup() {
    const creating = mode === 'create'
    return `<h1 class="setup-title">${esc(ACCOUNT_QUESTION)}</h1>
      <p class="setup-subtitle">${esc(ACCOUNT_QUESTION_SUB)}</p>
      ${statusMarkup()}
      <form class="settings-section-rows" data-account-form="${creating ? 'create' : 'sign-in'}" autocomplete="on">
        <article class="settings-row">
          <div class="settings-copy">
            <div class="settings-name" id="account-username-label">Name</div>
            <div class="settings-desc">${creating
              ? 'Letters, numbers, and . _ - between them. This is what the record of your assistant’s work will name.'
              : 'The name you chose when you made the account on this computer.'}</div>
          </div>
          <div class="settings-control fleet-inline-control">
            <input class="fleet-profile-input" type="text" name="username" autocomplete="username" spellcheck="false" autocapitalize="off" aria-labelledby="account-username-label" ${busy ? 'disabled' : ''}/>
          </div>
        </article>
        ${creating ? `<article class="settings-row">
          <div class="settings-copy">
            <div class="settings-name" id="account-display-label">Shown as</div>
            <div class="settings-desc">Optional. How the program greets you. Leave it blank to be greeted by the name above.</div>
          </div>
          <div class="settings-control fleet-inline-control">
            <input class="fleet-profile-input" type="text" name="displayName" autocomplete="nickname" aria-labelledby="account-display-label" ${busy ? 'disabled' : ''}/>
          </div>
        </article>` : ''}
        <article class="settings-row">
          <div class="settings-copy">
            <div class="settings-name" id="account-password-label">Password</div>
            <div class="settings-desc">${creating
              ? `At least ${MIN_PASSWORD_LENGTH} characters. Length is what makes a password hard to guess — a few unrelated words beat a short one with symbols in it. There is no reset, so use your password manager.`
              : 'The password for that account.'}</div>
          </div>
          <div class="settings-control fleet-inline-control">
            <input class="fleet-profile-input" type="password" name="password" autocomplete="${creating ? 'new-password' : 'current-password'}" aria-labelledby="account-password-label" ${busy ? 'disabled' : ''}/>
          </div>
        </article>
        ${creating ? scopeMarkup() : ''}
        <div class="setup-actions">
          <button type="button" class="ctl-btn" data-account-mode="${creating ? 'sign-in' : 'create'}" ${busy ? 'disabled' : ''}>${creating
            ? 'I already have an account'
            : 'Create an account'}</button>
          <div class="setup-actions-spacer"></div>
          <button type="button" class="ctl-btn" data-account-home ${busy ? 'disabled' : ''}>Not now</button>
          <button type="submit" class="ctl-btn" ${busy ? 'disabled' : ''}>${busy ? 'Working…' : creating ? 'Create account' : 'Sign in'}</button>
        </div>
      </form>
      ${creating ? '' : scopeMarkup()}`
  }

  function paint() {
    if (destroyed) return
    if (state === null) {
      section.innerHTML = `<h1 class="setup-title">${esc(ACCOUNT_QUESTION)}</h1><p class="setup-subtitle">Reading this computer’s accounts…</p>`
      return
    }
    if (!state.available) { section.innerHTML = unavailableMarkup(); return }
    if (state.signedIn) {
      section.innerHTML = mode === 'change-password' ? changePasswordMarkup() : signedInMarkup()
      return
    }
    section.innerHTML = formMarkup()
  }

  async function refresh() {
    state = await loadAccountState()
    if (destroyed) return
    /* The mode follows the facts on the first read only. A computer with no
       account opens on "create"; one that has accounts opens on "sign in", so
       the common case is one field and a password. */
    if (!state.signedIn && mode !== 'create' && state.available && state.accountCount === 0) mode = 'create'
    if (state.signedIn && mode !== 'change-password') mode = 'signed-in'
    paint()
  }

  /* ---------- actions ----------
   *
   * Each one reads its inputs at the moment it runs, hands them to the shell,
   * and clears the password fields before painting. The values are function-
   * local; nothing here closes over a password. */

  function passwordFields() {
    return [...section.querySelectorAll('input[type="password"]')]
  }

  function clearPasswords() {
    for (const field of passwordFields()) field.value = ''
  }

  function fieldValue(name) {
    const field = section.querySelector(`[name="${name}"]`)
    return field ? field.value : ''
  }

  async function run(action, onSuccess) {
    if (busy) return
    const bridge = accountBridge()
    if (!bridge) {
      notice = { tone: 'bad', title: 'This page is not the installed application.', detail: 'There is no computer here to sign in to.' }
      paint()
      return
    }
    busy = true
    notice = null
    paint()
    let result
    try {
      result = readActionResult(await action(bridge))
    } catch (error) {
      result = readActionResult(null)
    }
    if (destroyed) return
    busy = false
    /* Cleared on every outcome, not only on success. A refused sign-in that
       leaves the password sitting in the field leaves it in the DOM of a window
       somebody may walk away from. */
    clearPasswords()
    if (!result.ok) {
      notice = { tone: 'bad', title: 'That did not work.', detail: result.reason }
      await refresh()
      paint()
      return
    }
    await onSuccess(result)
  }

  function submit(kind) {
    if (kind === 'create') {
      const username = fieldValue('username')
      const displayName = fieldValue('displayName')
      const password = fieldValue('password')
      return run(
        bridge => bridge.create({ username, displayName, password }),
        async () => {
          /* Created and then signed in, as one action from the person's point
             of view. Making them type the password twice in a row to get
             through their own first run is friction that buys nothing. */
          let signedIn
          try {
            signedIn = readActionResult(await accountBridge().signIn({ username, password }))
          } catch { signedIn = readActionResult(null) }
          await refresh()
          notice = signedIn.ok
            ? {
              tone: 'good',
              title: 'Account created, and you are signed in.',
              detail: signedIn.persisted
                ? 'Work your assistant does is now recorded against this account. You will stay signed in when you reopen the program.'
                : 'Work your assistant does is now recorded against this account. This computer cannot remember the sign-in, so you will be asked again next time.',
            }
            : { tone: 'warn', title: 'The account was created.', detail: 'Signing in did not complete, so sign in below.' }
          paint()
        },
      )
    }
    if (kind === 'sign-in') {
      const username = fieldValue('username')
      const password = fieldValue('password')
      return run(
        bridge => bridge.signIn({ username, password }),
        async result => {
          await refresh()
          notice = {
            tone: 'good',
            title: 'Signed in.',
            detail: result.persisted
              ? 'Work your assistant does is recorded against this account.'
              : 'Work your assistant does is recorded against this account. This computer cannot remember the sign-in, so you will be asked again next time.',
          }
          paint()
        },
      )
    }
    const currentPassword = fieldValue('currentPassword')
    const newPassword = fieldValue('newPassword')
    return run(
      bridge => bridge.changePassword({ currentPassword, newPassword }),
      async () => {
        mode = 'sign-in'
        await refresh()
        notice = {
          tone: 'good',
          title: 'Password changed, and every sign-in was ended.',
          detail: 'Sign in with the new password. Any sign-in saved elsewhere from this computer is now refused.',
        }
        paint()
      },
    )
  }

  function onSubmit(event) {
    const form = event.target.closest('[data-account-form]')
    if (!form) return
    event.preventDefault()
    submit(form.dataset.accountForm)
  }

  function onClick(event) {
    if (event.target.closest('[data-account-home]')) { navigate('#/'); return }

    const next = event.target.closest('[data-account-mode]')
    if (next) {
      if (busy) return
      mode = next.dataset.accountMode
      notice = null
      paint()
      return
    }

    if (event.target.closest('[data-account-sign-out-everywhere]')) {
      run(bridge => bridge.signOutEverywhere(), async () => {
        mode = 'sign-in'
        await refresh()
        notice = { tone: 'good', title: 'Signed out everywhere.', detail: 'Any saved sign-in taken from this computer earlier is now refused.' }
        paint()
      })
      return
    }
    if (event.target.closest('[data-account-sign-out]')) {
      run(bridge => bridge.signOut(), async () => {
        mode = 'sign-in'
        await refresh()
        notice = { tone: 'good', title: 'Signed out.', detail: 'Work started from now on is recorded without a name until somebody signs in.' }
        paint()
      })
    }
  }

  section.addEventListener('click', onClick)
  section.addEventListener('submit', onSubmit)
  paint()
  refresh()

  return {
    el: root,
    destroy() {
      destroyed = true
      section.removeEventListener('click', onClick)
      section.removeEventListener('submit', onSubmit)
      /* The last thing this view does is clear any password still in a field.
         A destroyed view's nodes can outlive it in a morph snapshot. */
      clearPasswords()
    },
  }
}
