/* THE SIGN-IN QUESTION: its words, and what the shell answered.
 *
 * This module holds no DOM and touches no stylesheet, for the same reason
 * src/setup-state.js does not: the sign-in surface decides what a customer sees
 * on the launch they form their opinion on, and a gate that can only be tested
 * by matching source text is a gate that can silently stop existing. Both were
 * tried on the tier screen; the source-matched one slipped through.
 *
 * WHAT THIS ACCOUNT IS, said here because the interface has to say it
 * too. It is an account on THIS computer. It is not a login to Claude, ChatGPT
 * or Google, it does not carry a subscription, and it never asks for a provider
 * password -- docs/design/SHIPMENT-PLAN.md blocker B14 records that taking a
 * provider subscription login inside a third-party product is barred by those
 * providers' terms. Signing in here answers "who is using this copy", which is
 * what the agent record needs and could not previously say.
 *
 * NOTHING IN THIS FILE HOLDS A SECRET. A password is read from a field, handed
 * straight to the shell, and dropped. It is never stored in a variable that
 * outlives the call, never put in `answers`, never written to localStorage, and
 * never included in a message. The state below is status words only.
 *
 * FAIL CLOSED. Every unrecognised, absent, or malformed reply resolves to
 * SIGNED OUT. There is no branch here on which a shape this module does not
 * understand produces a signed-in user.
 */

/* The password rule is ENFORCED IN THE MAIN PROCESS, in
   shell/product-account.cjs. The copy below exists so the form can say the rule
   before someone types a password that gets refused, and it is deliberately
   phrased as guidance. A renderer-side length check is a courtesy; it is not
   the check, and the shell refuses regardless of what this file believes. */
export const MIN_PASSWORD_LENGTH = 12

export const ACCOUNT_QUESTION = 'Who is using this copy?'
export const ACCOUNT_QUESTION_SUB = 'Sign in so the record of what your assistant does says who asked for it.'

/* Shown on the sign-in surface itself, not only in a policy document.
 *
 * Both sentences exist because a person reading the words "create an account"
 * in 2026 will assume a cloud service, an email address and a password reset --
 * and every one of those assumptions is wrong here. Correcting them where the
 * choice is made is the same rule the tier screen's limit notice follows. */
export const ACCOUNT_SCOPE_LEAD = 'What this account is, before you make one.'
export const ACCOUNT_SCOPE_NOTICE = Object.freeze([
  'It is an account on this computer. Nothing is sent anywhere, no email address is asked for, and no server holds it — so there is also no password reset. If you forget it, the account cannot be recovered and you make a new one.',
  'It is not a login to Claude, ChatGPT or Google, and it does not carry a subscription. Those stay in their own programs; this one only answers who is using this copy.',
  'It records who asked for a piece of work. It is not a lock on this computer: anyone already signed in to Windows as you can remove it.',
])

const SIGNED_OUT = Object.freeze({
  available: false,
  signedIn: false,
  accountCount: 0,
  displayName: null,
  username: null,
  expiresAtMs: null,
  canPersistSession: false,
  code: 'MC_ACCOUNT_SHELL_ABSENT',
  reason: 'This page is running in a browser rather than the installed application, so there is no account on it to sign in to.',
})

export function accountBridge(scope = globalThis) {
  const bridge = scope?.mcAccount
  if (!bridge || typeof bridge.current !== 'function' || typeof bridge.signIn !== 'function') return null
  return bridge
}

/* Exported ONLY so its array guard can be tested directly.
 *
 * Mutation testing showed that removing `!Array.isArray(value)` changes no
 * observable behaviour through the public API: both call sites compare against
 * the literal `true`, so an array -- which answers `undefined` to every field --
 * is refused anyway. The guard is kept because src/setup-state.js documents this
 * exact trap on the sibling channel, where an array DID read as "available,
 * nothing recorded yet". Depth that no test can see is depth nobody can tell
 * from an accident, so it is tested here rather than left to survive a mutant
 * and be reported as "equivalent".
 */
export function isPlainObject(value) {
  /* Arrays are rejected explicitly. `typeof [] === 'object'`, so the obvious
     guard lets one through and an array then answers `undefined` to every field
     -- which reads as "available, nobody signed in yet" and would offer a
     button guaranteed to fail. src/setup-state.js rejects arrays for the same
     reason; this is the same rule on a different channel. */
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function boundedName(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, 64)
}

/**
 * Normalize an `availability()` and a `current()` reply into one state.
 *
 * Either argument being absent, malformed, or an error resolves to signed out
 * WITH the reason, rather than to a cheerful default. `available: false` means
 * the surface states why and offers no button; it never means "assume fine".
 */
export function readAccountState(availability, current) {
  if (!isPlainObject(availability)) return SIGNED_OUT
  if (availability.ok !== true) {
    return Object.freeze({
      ...SIGNED_OUT,
      code: typeof availability.code === 'string' ? availability.code : 'MC_ACCOUNT_UNAVAILABLE',
      reason: typeof availability.reason === 'string' && availability.reason
        ? availability.reason
        : 'This copy cannot read its accounts.',
      /* Deliberately kept even on the failure path: an account file that cannot
         be read still means accounts EXIST, and a surface that showed "create
         your first account" here would invite someone to overwrite the one they
         could not read. */
      accountCount: Number.isSafeInteger(availability.accountCount) && availability.accountCount > 0 ? availability.accountCount : 0,
    })
  }

  const accountCount = Number.isSafeInteger(availability.accountCount) && availability.accountCount >= 0
    ? availability.accountCount
    : 0
  const base = {
    available: true,
    accountCount,
    canPersistSession: availability.canPersistSession === true,
    code: null,
    reason: null,
  }

  /* Anything other than a well-formed object saying `signedIn: true` is signed
     out. The comparison is to the literal `true` rather than truthy, so a
     string, a number, or the object itself cannot stand in for it. */
  if (!isPlainObject(current) || current.signedIn !== true || !isPlainObject(current.account)) {
    return Object.freeze({ ...SIGNED_OUT, ...base, signedIn: false })
  }
  const username = boundedName(current.account.username)
  if (!username) {
    return Object.freeze({ ...SIGNED_OUT, ...base, signedIn: false })
  }
  return Object.freeze({
    ...base,
    signedIn: true,
    username,
    displayName: boundedName(current.account.displayName) || username,
    expiresAtMs: Number.isSafeInteger(current.session?.expiresAtMs) ? current.session.expiresAtMs : null,
  })
}

/**
 * Ask the shell, and never throw at the caller.
 *
 * A rejected invoke -- a closed window, a refused sender, a channel that does
 * not exist in this build -- resolves to signed out with a code, because a
 * sign-in surface that crashes on a failed read is a surface nobody can use to
 * recover.
 */
export async function loadAccountState(scope = globalThis) {
  const bridge = accountBridge(scope)
  if (!bridge) return SIGNED_OUT
  let availability = null
  let current = null
  try {
    availability = await bridge.availability()
  } catch {
    return Object.freeze({ ...SIGNED_OUT, code: 'MC_ACCOUNT_READ_FAILED', reason: 'The application did not report whether this computer holds an account.' })
  }
  try {
    current = await bridge.current()
  } catch {
    current = null
  }
  return readAccountState(availability, current)
}

/**
 * Normalize any reply to an action into something a surface can render.
 *
 * The shell already answers `{ok, code, reason}`. This exists for the shapes it
 * cannot answer with: a rejected promise, a bridge that is not there, and a
 * reply from a build that predates the channel. All three become a refusal with
 * a code, never a silent success.
 */
export function readActionResult(value) {
  if (!isPlainObject(value)) {
    return Object.freeze({ ok: false, code: 'MC_ACCOUNT_NO_REPLY', reason: 'The application did not answer.' })
  }
  if (value.ok !== true) {
    return Object.freeze({
      ok: false,
      code: typeof value.code === 'string' ? value.code : 'MC_ACCOUNT_REFUSED',
      reason: typeof value.reason === 'string' && value.reason ? value.reason : 'The application refused, and did not say why.',
    })
  }
  return Object.freeze({
    ok: true,
    code: null,
    reason: null,
    /* False means the sign-in is good for this run only, because the OS
       keystore would not hold it. Carried through so the surface can say so
       rather than letting the person discover it at the next launch. */
    persisted: value.persisted !== false,
  })
}

/**
 * The seam the first-run walkthrough uses.
 *
 * Deliberately narrow: promises in, status words out, no DOM, and no field that
 * could carry a credential. src/views/setup.js serialises its answers to
 * localStorage and shows them on a review page, so a password reaching that
 * object would be written to disk in the clear. Nothing returned here can be
 * one -- there is no field for it.
 */
export function accountStep(scope = globalThis) {
  const bridge = accountBridge(scope)
  return Object.freeze({
    available: Boolean(bridge),
    load: () => loadAccountState(scope),
    create: async request => {
      if (!bridge) return readActionResult(null)
      try { return readActionResult(await bridge.create(request)) } catch { return readActionResult(null) }
    },
    signIn: async request => {
      if (!bridge) return readActionResult(null)
      try { return readActionResult(await bridge.signIn(request)) } catch { return readActionResult(null) }
    },
    signOut: async () => {
      if (!bridge) return readActionResult(null)
      try { return readActionResult(await bridge.signOut()) } catch { return readActionResult(null) }
    },
  })
}
