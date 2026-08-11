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
import { screenMarkup } from '../account-markup.js'
import {
  ACCOUNT_QUESTION,
  ACCOUNT_QUESTION_SUB,
  ACCOUNT_SCOPE_LEAD,
  ACCOUNT_SCOPE_NOTICE,
  MIN_PASSWORD_LENGTH,
  accountBridge,
  loadAccountState,
  loadAccountBelongings,
  readActionResult,
} from '../account-state.js'

import '../settings.css'
import '../fleet-profile-settings.css'
import '../setup.css'

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

  /* The markup lives in src/account-markup.js, called rather than inlined.
     Two planted defects -- an empty form and an empty scope notice -- survived
     every source-searching assertion, including ones narrowed to the function
     slice, because an early `return ''` leaves the real markup below it and
     dead code still matches a text search. Builders that a test can CALL are
     the only thing that catches it. This view now owns state and events; it
     owns no HTML. */
  /* WHAT IS HIS, read separately from WHO HE IS.
   *
   * Two reads rather than one because they fail differently and the screen has
   * to say which failed. A damaged settings partition must not stop the page
   * saying who is signed in, and a vault that cannot be read must not make the
   * account look signed out. `null` here means "not asked yet", exactly like
   * `state`; the markup renders unknown rather than empty for it. */
  let data = null
  let payment = null
  let history = null

  const view = () => ({ state, mode, busy, notice, data, payment, history })

  function paint() {
    if (destroyed) return
    section.innerHTML = screenMarkup(view())
  }

  /* HOW MANY OF THIS COMPUTER'S RUNS ARE YOURS.
   *
   * Counted here, in the page, from the records the shell already returns,
   * because the ledger is deliberately one file for the whole device (see
   * shell/product-account.cjs's partition note) and what a person wants to see
   * is their own slice of it. The principal is compared to `account:<id>` --
   * the SAME string the main process writes into the record, produced there and
   * never here, so the page cannot decide that a record is his.
   *
   * Never throws and never blocks the rest of the screen: a ledger this build
   * cannot read leaves `history` null and the row simply does not appear. */
  async function loadHistory() {
    const agent = globalThis.mcAgent
    if (!agent || typeof agent.history !== 'function' || !state?.signedIn) return null
    let reply
    try { reply = await agent.history({ limit: 200 }) } catch { return null }
    if (!reply || reply.ok !== true || !Array.isArray(reply.entries)) return null
    const accountId = state.accountId
    if (typeof accountId !== 'string' || !accountId) return null
    const wanted = `account:${accountId}`
    const mine = reply.entries.filter(entry => entry && entry.principal === wanted).length
    const total = Number.isSafeInteger(reply.total) ? reply.total : reply.entries.length
    return { mine, total }
  }

  async function refresh() {
    state = await loadAccountState()
    if (destroyed) return
    /* Tell the settings store who is signed in now, so the appearance, the
       settings page and the purchase selection follow the account rather than
       the computer. Optional: absent in a plain browser, and a no-op there. */
    try { if (globalThis.mcDurableStorage) globalThis.mcDurableStorage.onAccountChanged() } catch (error) { /* storage layer is optional */ }
    /* The mode follows the facts on the first read only. A computer with no
       account opens on "create"; one that has accounts opens on "sign in", so
       the common case is one field and a password. */
    if (!state.signedIn && mode !== 'create' && state.available && state.accountCount === 0) mode = 'create'
    if (state.signedIn && mode !== 'change-password') mode = 'signed-in'
    if (!state.signedIn) {
      /* Cleared on sign-out. Leaving the previous account's counts on the
         screen after somebody signs out is the partition failing in the one
         place a person would actually notice it. */
      data = null
      payment = null
      history = null
      paint()
      return
    }
    paint()
    const belongings = await loadAccountBelongings()
    if (destroyed) return
    data = belongings.data
    payment = belongings.payment
    paint()
    history = await loadHistory()
    if (destroyed) return
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
