// WHO IS CONFIRMING, and the two separate questions behind that.
//
// The owner's constraint, verbatim: "if i am not logged in as a real user with
// my vault and such attached correctly i refuse to finish the form. it must be
// correct and secure and safe."
//
// That sentence contains TWO conditions and they are kept apart all the way
// down this file, because they have different owners, different failure modes
// and different fixes:
//
//   1. Logged in as a real user  -- answered by window.mcAccount, which
//      product-login-build owns. Real, live, and checked here.
//   2. Vault attached correctly  -- NOT answered by anything in this build.
//      product-login-build explicitly refused to put a `vaultVerified` boolean
//      on the account object, and was right to: a module that has never looked
//      at the vault cannot report on it, and a hardcoded true would be a vault
//      claim with nothing behind it. So this build cannot verify condition 2,
//      and the screen says exactly that rather than letting a green "signed in"
//      badge imply both.
//
// WHAT SIGNING IN HERE IS, AND IS NOT. It names the person on the record and
// gates the action. It is not an attestation: there is no server, and someone
// already signed in to Windows as this user can remove the account and make a
// new one. The surface must not let a sign-in read as more than attribution.
//
// AND THE LIMIT THIS MODULE CANNOT FIX, stated because it would otherwise be
// implied away: the decision record this gate protects is composed and stored
// IN THE RENDERER. That makes it a durable note of what he chose, for him. It
// is not an audit record and this lane does not call it one -- an identity a
// page can choose is not an identity, and anything with devtools could write a
// different name into localStorage. The gate below is a real guard against the
// ordinary case (nobody is signed in, so nothing gets recorded in his name by
// whoever is sitting at the machine). It is not evidence, and the screen says
// so where the record is shown.
//
// EVERY UNKNOWN IS A REFUSAL. There is no branch here that returns an approver
// from a missing, malformed, slow or throwing source.

import { readAccountState } from './account-state.js'

const CALL_TIMEOUT_MS = 5_000

/**
 * The vault half of the owner's condition, answered honestly.
 *
 * There is no vault-verification call in this build. This is a product fact,
 * true on every machine, and NOT a claim about the state of any particular
 * vault on disk -- reporting a measured ACL from here would bake one machine's
 * configuration into shipped product copy.
 */
export const VAULT_VERIFICATION_UNAVAILABLE = Object.freeze({
  verified: false,
  code: 'VAULT_VERIFICATION_UNAVAILABLE',
  summary: 'Signing in names you on this record. It does not check your vault.',
  detail: 'This build has no way to verify that the vault is attached and protected, so it does not claim to have checked. An approval is only ever as strong as the vault underneath it. Nothing here reads, writes or unlocks the vault.',
})

function refusal(code, reason, detail, { canSignIn = false } = {}) {
  return Object.freeze({ ok: false, code, reason, detail, canSignIn })
}

function withTimeout(promise) {
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => { setTimeout(() => reject(new Error('timeout')), CALL_TIMEOUT_MS) }),
  ])
}

function boundedString(value, maximum = 200) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum ? value : null
}

/**
 * Decide, from the two shell replies, whether a decision may be recorded and
 * against whom.
 *
 * Exported separately from the call so the whole decision table is testable
 * without a shell: every one of these branches is a refusal that a person will
 * read on a checkout screen, and the wording of a refusal is part of it working.
 */
export function approvalIdentityFrom(availability, current) {
  // Their normalizer, not a second opinion. It already fails closed on every
  // malformed shape, and duplicating that judgement here is how two modules
  // start disagreeing about who is signed in.
  const state = readAccountState(availability, current)

  if (!state.available) {
    return refusal(
      state.code || 'MC_ACCOUNT_UNAVAILABLE',
      state.reason || 'This copy cannot read its accounts, so there is nobody to record a decision against.',
      'Confirming is unavailable rather than anonymous. Nothing has been recorded.',
    )
  }
  if (!state.signedIn) {
    return refusal(
      'MC_ACCOUNT_SIGNED_OUT',
      'You are not signed in, so this decision would be recorded against nobody.',
      state.accountCount > 0
        ? 'Sign in from Settings, then come back to this page. Nothing has been recorded and your choices are still here.'
        : 'There is no account on this computer yet. Create one from Settings, then come back. Nothing has been recorded and your choices are still here.',
      { canSignIn: true },
    )
  }

  // Signed in. The id is what goes in the record: product-login-build's rule is
  // that the id is stable across a display-name change and the username is not,
  // so a record keyed on the username would silently re-attribute itself.
  const id = boundedString(current?.account?.id)
  if (!id) {
    return refusal(
      'MC_ACCOUNT_ID_MISSING',
      'The application reported someone signed in but did not say which account.',
      'A decision that names nobody in particular is exactly what this gate exists to prevent. Nothing has been recorded.',
    )
  }

  return Object.freeze({
    ok: true,
    principal: Object.freeze({
      id,
      displayName: state.displayName || state.username,
      username: state.username,
      // Carried so the confirmed record can state, in its own words, that the
      // vault half of the owner's condition was never verified. A record that
      // silently omitted this would read as though both halves had passed.
      vault: VAULT_VERIFICATION_UNAVAILABLE,
    }),
  })
}

/**
 * Ask the shell who is signed in. Never throws.
 *
 * The timeout matters: without it a hung shell leaves the confirm button
 * pending forever, and a gate that appears broken is a gate somebody removes.
 */
export async function readApprovalIdentity(scope = typeof window === 'undefined' ? undefined : window) {
  const bridge = scope?.mcAccount
  if (!bridge || typeof bridge.current !== 'function' || typeof bridge.availability !== 'function') {
    return refusal(
      'MC_ACCOUNT_SHELL_ABSENT',
      'This page is running in a browser rather than the installed application, so there is no account to sign in to.',
      'Confirming is unavailable here. Everything else on this page works normally, and your choices are saved.',
    )
  }
  let availability = null
  let current = null
  try {
    availability = await withTimeout(bridge.availability())
  } catch (error) {
    return refusal(
      'MC_ACCOUNT_READ_FAILED',
      error?.message === 'timeout'
        ? 'The application did not answer in time about who is signed in.'
        : 'The application did not report whether this computer holds an account.',
      'Confirming is unavailable rather than assumed. Nothing has been recorded.',
    )
  }
  try {
    current = await withTimeout(bridge.current())
  } catch {
    current = null
  }
  return approvalIdentityFrom(availability, current)
}
