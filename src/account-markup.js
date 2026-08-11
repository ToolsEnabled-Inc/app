/* THE SIGN-IN SCREEN'S MARKUP, SEPARATED SO IT CAN BE RUN.
 *
 * WHY THIS FILE EXISTS, and it is not tidiness. Every assertion about this
 * screen used to search src/views/account.js for strings. Two planted defects
 * survived the entire suite: making the form return an empty string, and making
 * the scope notice return an empty string. Either ships a sign-in screen with no
 * fields, or one that never tells anybody there is no password reset and that
 * this is not a provider login -- the SHIPMENT-PLAN B14 disclosure -- and every
 * test stayed green, because the strings they searched for still existed in the
 * file.
 *
 * Then the SECOND attempt failed too. Narrowing the search to the function's own
 * source slice also survived, because the plant was an early `return ''` with the
 * real markup left below it: dead code still matches a source search. No
 * assertion over TEXT can see reachability. The markup has to be CALLED and its
 * output inspected, and that cannot happen in src/views/account.js because that
 * file imports stylesheets and cannot be loaded outside a browser.
 *
 * So the builders live here: no DOM, no stylesheet, no closure. Every value they
 * need arrives as an argument, which is what makes them callable from a test and
 * is the same reason src/setup-state.js holds the first-run gate's logic.
 *
 * NOTHING HERE HOLDS A SECRET. These functions render field DEFINITIONS, never
 * field values -- there is no parameter on any of them that a password could
 * arrive in. The password is read from the DOM at submit and dropped; see
 * src/views/account.js.
 */

import {
  ACCOUNT_QUESTION,
  ACCOUNT_QUESTION_SUB,
  ACCOUNT_SCOPE_LEAD,
  ACCOUNT_SCOPE_NOTICE,
  MIN_PASSWORD_LENGTH,
} from './account-state.js'

export const esc = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

export function expiryText(expiresAtMs, now = Date.now()) {
  if (!Number.isSafeInteger(expiresAtMs)) return ''
  const days = Math.max(0, Math.round((expiresAtMs - now) / 86_400_000))
  if (days <= 0) return 'This sign-in expires today.'
  return `This sign-in expires in ${days} day${days === 1 ? '' : 's'}, and you sign in again then.`
}

export function statusMarkup({ notice = null, state = null } = {}) {
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

export function scopeMarkup() {
  return `<div class="fleet-profile-status is-warn" role="status">
    <strong>${esc(ACCOUNT_SCOPE_LEAD)}</strong>
    ${ACCOUNT_SCOPE_NOTICE.map(paragraph => `<span>${esc(paragraph)}</span>`).join('')}
  </div>`
}

export function loadingMarkup() {
  return `<h1 class="setup-title">${esc(ACCOUNT_QUESTION)}</h1><p class="setup-subtitle">Reading this computer’s accounts…</p>`
}

export function unavailableMarkup({ state = null } = {}) {
  return `<h1 class="setup-title">${esc(ACCOUNT_QUESTION)}</h1>
    <div class="fleet-profile-status is-serious" role="alert">
      <strong>There is no account on this page to sign in to.</strong>
      <span>${esc(state?.reason || 'The application did not say why.')}</span>
    </div>
    <div class="setup-actions">
      <div class="setup-actions-spacer"></div>
      <button type="button" class="ctl-btn" data-account-home>Back to ToolsEnabled</button>
    </div>`
}

function dateText(atMs) {
  if (!Number.isSafeInteger(atMs) || atMs <= 0) return ''
  try {
    return new Date(atMs).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
  } catch {
    return ''
  }
}

/* WHAT IS YOURS ON THIS COMPUTER, said in the three sentences the product can
 * actually stand behind.
 *
 * SETTINGS. A count and, when it happened, the fact that they were adopted from
 * this computer when the account was made. That second sentence exists because
 * a person who has been using this program for months and then creates an
 * account needs to know that what was already here became THEIRS, rather than
 * wondering whether it was thrown away or is still shared with whoever else
 * signs in.
 *
 * HISTORY. Counted from the ledger's own records by principal. It says "of N on
 * this computer" so the number is honest about being a slice: the ledger is one
 * signed append-only file per device and is deliberately not partitioned, so
 * some of the runs on this machine are not yours and the screen says so.
 *
 * THE CARD. Three states, never two. "On file", "attached but this
 * installation's vault does not hold it", and "could not check" are different
 * facts and the middle one is REAL on this machine. Collapsing any of them into
 * "no card on file" would be the product making a claim about his money that it
 * did not verify.
 *
 * NOTHING RENDERED HERE IS A CARD DETAIL. The only payment value in scope is the
 * vault KEY NAME, and the only thing done with it is to say a record is on file
 * -- there is no number, no expiry, no last-four and no token anywhere in this
 * function or in the object it is given. */
export function belongingsMarkup({ data = null, payment = null, history = null } = {}) {
  const rows = []

  if (data && data.ok === true) {
    const adopted = data.adopted && data.adopted.count > 0
      ? ` They were already on this computer when you made this account, and became yours on ${esc(dateText(data.adopted.atMs))}.`
      : ''
    rows.push(`<article class="settings-row" data-account-data-settings>
      <div class="settings-copy">
        <div class="settings-name">Your settings</div>
        <div class="settings-desc">${data.settingCount === 0
          ? 'Nothing recorded against this account yet. Choices you make — theme, first-run answers, what your assistant may do without asking — are kept for you and not for whoever else uses this computer.'
          : `${esc(String(data.settingCount))} recorded against this account, kept for you and not for whoever else uses this computer.${adopted}`}</div>
      </div>
    </article>`)
  } else {
    rows.push(`<article class="settings-row" data-account-data-settings>
      <div class="settings-copy">
        <div class="settings-name">Your settings</div>
        <div class="settings-desc">Could not be read on this computer, so this does not say how many there are. ${esc((data && data.reason) || '')}</div>
      </div>
    </article>`)
  }

  if (history && Number.isSafeInteger(history.mine)) {
    rows.push(`<article class="settings-row" data-account-data-history>
      <div class="settings-copy">
        <div class="settings-name">Your history</div>
        <div class="settings-desc">${history.mine === 0
          ? `Nothing recorded against you yet. This computer has ${esc(String(history.total))} recorded run${history.total === 1 ? '' : 's'} in total; runs started from now on will say your name.`
          : `${esc(String(history.mine))} of the ${esc(String(history.total))} run${history.total === 1 ? '' : 's'} recorded on this computer were started by you. The record is one signed file for the whole computer, so the rest were started by another sign-in or before anybody signed in — it is not split up, and no account can quietly remove its own.`}</div>
      </div>
    </article>`)
  }

  if (payment && payment.ok === true && payment.attached === true) {
    if (payment.present === true) {
      rows.push(`<article class="settings-row" data-account-data-payment data-payment-state="on-file">
        <div class="settings-copy">
          <div class="settings-name">Your payment method</div>
          <div class="settings-desc">A card is on file for this account. It is held encrypted by Windows in this installation’s own vault, under <code>${esc(payment.vaultKey)}</code>, and this screen has not read it — no number, expiry or security code is shown here or anywhere else in this program.</div>
        </div>
      </article>`)
    } else if (payment.checked === true) {
      /* THE MIDDLE STATE, and the reason this function has three branches. The
         binding exists and this installation's vault does not hold the record.
         "No card on file" would be false; so would "on file". */
      rows.push(`<article class="settings-row" data-account-data-payment data-payment-state="attached-not-here">
        <div class="settings-copy">
          <div class="settings-name">Your payment method</div>
          <div class="settings-desc">A card is attached to this account under <code>${esc(payment.vaultKey)}</code>, but this installation’s own vault does not hold that record, so it cannot be used from here yet. This is not the same as having no card.</div>
        </div>
      </article>`)
    } else {
      rows.push(`<article class="settings-row" data-account-data-payment data-payment-state="unknown">
        <div class="settings-copy">
          <div class="settings-name">Your payment method</div>
          <div class="settings-desc">A card is attached to this account under <code>${esc(payment.vaultKey)}</code>. This computer could not read its vault just now, so whether the record is there is unknown — which is not the same as it being gone. ${esc(payment.detail || '')}</div>
        </div>
      </article>`)
    }
  } else if (payment && payment.ok === true) {
    rows.push(`<article class="settings-row" data-account-data-payment data-payment-state="none">
      <div class="settings-copy">
        <div class="settings-name">Your payment method</div>
        <div class="settings-desc">No card is attached to this account. Nothing in this program can charge anything without one, and attaching one is not a payment.</div>
      </div>
    </article>`)
  } else {
    rows.push(`<article class="settings-row" data-account-data-payment data-payment-state="unknown">
      <div class="settings-copy">
        <div class="settings-name">Your payment method</div>
        <div class="settings-desc">This copy could not check whether a card is attached, so it does not say. Unknown is not the same as none.</div>
      </div>
    </article>`)
  }

  return rows.join('')
}

export function signedInMarkup({ state, busy = false, notice = null, now = Date.now(), data = null, payment = null, history = null } = {}) {
  return `<h1 class="setup-title">Signed in as ${esc(state.displayName)}</h1>
    ${statusMarkup({ notice, state })}
    <div class="settings-section-rows">
      <article class="settings-row">
        <div class="settings-copy">
          <div class="settings-name">Account</div>
          <div class="settings-desc">${esc(state.username)} — an account on this computer only. Work your assistant does is recorded against it. ${esc(expiryText(state.expiresAtMs, now))}</div>
        </div>
      </article>
      ${belongingsMarkup({ data, payment, history })}
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
      <button type="button" class="ctl-btn" data-account-home>Back to ToolsEnabled</button>
    </div>`
}

export function changePasswordMarkup({ state, busy = false, notice = null } = {}) {
  return `<h1 class="setup-title">Change your password</h1>
    ${statusMarkup({ notice, state })}
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

export function formMarkup({ mode = 'sign-in', busy = false, notice = null, state = null } = {}) {
  const creating = mode === 'create'
  return `<h1 class="setup-title">${esc(ACCOUNT_QUESTION)}</h1>
    <p class="setup-subtitle">${esc(ACCOUNT_QUESTION_SUB)}</p>
    ${statusMarkup({ notice, state })}
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

/* The one place that decides which of the above a given state paints.
 *
 * It is HERE rather than in the view for the reason the whole file exists: a
 * dispatcher inside the view can only be checked by reading it, and reading is
 * what missed the last two defects. This one is called by the tests with each
 * state in turn. */
export function screenMarkup({ state = null, mode = 'sign-in', busy = false, notice = null, now = Date.now(), data = null, payment = null, history = null } = {}) {
  if (state === null) return loadingMarkup()
  if (!state.available) return unavailableMarkup({ state })
  if (state.signedIn) {
    return mode === 'change-password'
      ? changePasswordMarkup({ state, busy, notice })
      : signedInMarkup({ state, busy, notice, now, data, payment, history })
  }
  return formMarkup({ mode, busy, notice, state })
}

/* ---- the first-run step ----
 *
 * The same question, asked inside the walkthrough. It is HERE and not in
 * src/views/setup.js for the reason the rest of this file exists: that file
 * imports three stylesheets and touches the DOM, so nothing can render it in a
 * test, and a plant proved the consequence -- the step could return an empty
 * string, and the scope notice could be deleted outright, with the whole suite
 * still green. That is the SHIPMENT-PLAN B14 disclosure disappearing from the
 * screen where a first-time user creates an account.
 *
 * The step keeps its own shape rather than reusing formMarkup(): the walkthrough
 * has a step counter, Back/Not-now/Skip actions and the `fleet-profile-fields`
 * layout, and pretending the two screens are one would bend both. What they DO
 * share is the copy, imported from the same constants, so the two can never
 * disagree about what an account is.
 *
 * `actions` arrives as a rendered string. The walkthrough owns its own action
 * bar and its own idea of which step comes next; this builder does not need to
 * know, and taking it as a parameter is what keeps this file free of the
 * walkthrough's state.
 */
export function setupAccountStepMarkup({
  accountState = null,
  mode = 'sign-in',
  busy = false,
  notice = null,
  actions = '',
} = {}) {
  if (accountState === null) {
    return `<h1 class="setup-title">${esc(ACCOUNT_QUESTION)}</h1>
      <div class="fleet-profile-status is-quiet" role="status">
        <strong>Reading this computer’s accounts…</strong>
      </div>
      ${actions}`
  }
  if (!accountState.available) {
    return `<h1 class="setup-title">${esc(ACCOUNT_QUESTION)}</h1>
      <div class="fleet-profile-status is-serious" role="alert">
        <strong>This copy cannot hold an account</strong>
        <span>${esc(accountState.reason || 'The application did not say why.')} Nothing on this computer has been changed, and the rest of setup still works. Your assistant’s records will say that nobody was signed in.</span>
      </div>
      ${actions}`
  }
  if (accountState.signedIn) {
    return `<h1 class="setup-title">Signed in as ${esc(accountState.displayName)}</h1>
      <div class="fleet-profile-status is-good" role="status">
        <strong>From now on, the record of what your assistant does says who asked for it.</strong>
        <span>You can sign out or change this later in Settings.</span>
      </div>
      ${actions}`
  }

  const creating = mode === 'create'
  return `<h1 class="setup-title">${esc(ACCOUNT_QUESTION)}</h1>
    <p class="setup-subtitle">${esc(ACCOUNT_QUESTION_SUB)}</p>
    ${notice ? `<div class="fleet-profile-status is-serious" role="alert">
      <strong>That did not work</strong>
      <span>${esc(notice)}</span>
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
          <input class="fleet-profile-input" type="text" data-setup-account-field="username" autocomplete="username" spellcheck="false" autocapitalize="off" aria-labelledby="setup-account-name" ${busy ? 'disabled' : ''}/>
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
          <input class="fleet-profile-input" type="password" data-setup-account-field="password" autocomplete="${creating ? 'new-password' : 'current-password'}" aria-labelledby="setup-account-password" ${busy ? 'disabled' : ''}/>
        </div>
      </article>
    </div>
    ${scopeMarkup()}
    ${actions}`
}
