// THE SIGN-IN SURFACE, AND THE WIRING BEHIND IT.
//
// The store itself is covered by product-account.test.mjs. These are the two
// ways a correct store still ships a broken product:
//
//   1. THE RENDERER DECIDES IT IS SIGNED IN WHEN IT IS NOT. src/account-state.js
//      turns a shell reply into what the screen shows. Every malformed, absent
//      or surprising reply has to resolve to SIGNED OUT, and each is asserted
//      separately -- one test covering all of them can be satisfied by one early
//      return, which is the shape that hides a fail-open branch behind a
//      fail-closed one.
//   2. THE WIRING IS NOT THERE. A store nothing calls, a bridge nothing exposes,
//      or -- the one that matters most -- an audit principal the PAGE can name.
//
// The wiring assertions read source text, and that is a weaker instrument than
// running the code, so they are deliberately written to catch REMOVAL rather
// than to certify behaviour: shell/main.cjs cannot be imported without Electron,
// and a channel that has been deleted is exactly what a source match can see.
// The behavioural half lives in product-account.test.mjs, which runs for real.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  ACCOUNT_SCOPE_NOTICE,
  MIN_PASSWORD_LENGTH,
  accountBridge,
  accountStep,
  loadAccountState,
  readAccountState,
  readActionResult,
} from '../../src/account-state.js'
import { MIN_PASSWORD_LENGTH as SHELL_MIN_PASSWORD_LENGTH } from '../../shell/product-account.cjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = relative => readFileSync(path.join(REPO_ROOT, relative), 'utf8')

/**
 * The source with its comments removed.
 *
 * WITHOUT THIS, EVERY PROHIBITION BELOW IS SATISFIED BY ITS OWN DOCUMENTATION.
 * These files explain at length why there is no channel that sets the principal
 * and why the sign-in screen touches no web storage -- and a search for
 * `setPrincipal` or `localStorage` then matches the sentence saying it must
 * never appear. Both assertions failed exactly that way when first written, on
 * prose rather than on code, which is the same defect class as a vacuous green:
 * the test would have passed forever while the real thing was added.
 *
 * A character scanner rather than a regex, because a regex that strips comments
 * eats the contents of any string containing `//` -- including a URL -- and
 * would quietly delete the code being examined.
 */
function stripComments(source) {
  let output = ''
  let index = 0
  let state = 'code'
  let quote = ''
  while (index < source.length) {
    const character = source[index]
    const next = source[index + 1]
    if (state === 'code') {
      if (character === '/' && next === '/') { state = 'line'; index += 2; continue }
      if (character === '/' && next === '*') { state = 'block'; index += 2; continue }
      if (character === '"' || character === "'" || character === '`') { state = 'string'; quote = character }
      output += character
      index += 1
      continue
    }
    if (state === 'string') {
      output += character
      if (character === '\\') { output += next ?? ''; index += 2; continue }
      if (character === quote) state = 'code'
      index += 1
      continue
    }
    if (state === 'line') {
      if (character === '\n') { state = 'code'; output += character }
      index += 1
      continue
    }
    if (character === '*' && next === '/') { state = 'code'; index += 2; continue }
    /* Newlines are kept so a reported line number still means something. */
    if (character === '\n') output += character
    index += 1
  }
  return output
}

test('the comment stripper removes comments and keeps code, including strings that look like comments', () => {
  assert.equal(stripComments('const a = 1 // no\nconst b = 2'), 'const a = 1 \nconst b = 2')
  assert.equal(stripComments('/* no */const a = 1'), 'const a = 1')
  assert.equal(stripComments('const url = "https://example.com/x"'), 'const url = "https://example.com/x"')
  assert.equal(stripComments("const s = 'a /* b */ c'"), "const s = 'a /* b */ c'")
  assert.equal(stripComments('const s = "he said \\" // "'), 'const s = "he said \\" // "')
  /* The property this whole helper exists for. */
  assert.ok(!stripComments('// never call setPrincipal\nconst a = 1').includes('setPrincipal'))
  assert.ok(stripComments('setPrincipal() // do not').includes('setPrincipal'))
})

const MAIN = read('shell/main.cjs')
const PRELOAD = read('shell/fleet-profile-preload.cjs')
const VIEW = read('src/views/account.js')
const ROUTER = read('src/main.js')
const SETTINGS = read('src/fleet-profile-settings.js')

const READY = Object.freeze({ ok: true, code: 'ACCOUNT_READY', accountCount: 1, canPersistSession: true })
const SIGNED_IN = Object.freeze({
  signedIn: true,
  principal: 'account:0123456789abcdef0123456789abcdef',
  account: { id: '0123456789abcdef0123456789abcdef', username: 'josh', displayName: 'Josh P' },
  session: { issuedAtMs: 1, expiresAtMs: 2 },
})

/* ------------------------- the renderer fails closed ------------------------- */

test('a signed-in reply is read as signed in', () => {
  const state = readAccountState(READY, SIGNED_IN)
  assert.equal(state.available, true)
  assert.equal(state.signedIn, true)
  assert.equal(state.displayName, 'Josh P')
  assert.equal(state.username, 'josh')
})

for (const [name, reply] of [
  ['undefined', undefined],
  ['null', null],
  ['an array', []],
  ['a string', 'signed in'],
  ['a number', 1],
  ['true', true],
  ['an empty object', {}],
  ['signedIn as the string "true"', { signedIn: 'true', account: { username: 'josh' } }],
  ['signedIn as 1', { signedIn: 1, account: { username: 'josh' } }],
  ['signedIn true with no account', { signedIn: true }],
  ['signedIn true with a null account', { signedIn: true, account: null }],
  ['signedIn true with an array account', { signedIn: true, account: [] }],
  ['signedIn true with no username', { signedIn: true, account: { displayName: 'Josh P' } }],
  ['signedIn true with a blank username', { signedIn: true, account: { username: '   ' } }],
  ['signedIn true with a non-string username', { signedIn: true, account: { username: 42 } }],
]) {
  test(`fails closed: current() as ${name} reads as signed out`, () => {
    const state = readAccountState(READY, reply)
    assert.equal(state.signedIn, false, `${name} must not read as signed in`)
    assert.equal(state.displayName, null)
  })
}

for (const [name, reply] of [
  ['undefined', undefined],
  ['null', null],
  ['an array', []],
  ['a string', 'ready'],
  ['ok as the string "true"', { ok: 'true', accountCount: 1 }],
  ['ok missing', { accountCount: 1 }],
  ['ok false', { ok: false, code: 'ACCOUNT_STORE_CORRUPT', reason: 'unreadable' }],
]) {
  test(`fails closed: availability() as ${name} makes the surface unavailable`, () => {
    const state = readAccountState(reply, SIGNED_IN)
    assert.equal(state.available, false, `${name} must not read as available`)
    assert.equal(state.signedIn, false, `${name} must not read as signed in`)
    assert.ok(typeof state.code === 'string' && state.code.length > 0, 'it must carry a code')
  })
}

test('a corrupt store still reports that accounts exist, so nothing offers a fresh start', () => {
  const state = readAccountState({ ok: false, code: 'ACCOUNT_STORE_CORRUPT', reason: 'unreadable', accountCount: 3 }, null)
  assert.equal(state.available, false)
  assert.equal(state.accountCount, 3,
    'a surface that showed "create your first account" here would invite overwriting the unreadable one')
})

test('a bridge that throws reads as signed out with a code, not as a crash', async () => {
  const scope = { mcAccount: { current: async () => SIGNED_IN, signIn: async () => ({ ok: true }), availability: async () => { throw new Error('gone') } } }
  const state = await loadAccountState(scope)
  assert.equal(state.signedIn, false)
  assert.equal(state.available, false)
  assert.equal(state.code, 'MC_ACCOUNT_READ_FAILED')
})

test('a bridge whose current() throws is signed out, not signed in from a stale read', async () => {
  const scope = { mcAccount: { availability: async () => READY, current: async () => { throw new Error('gone') }, signIn: async () => ({}) } }
  const state = await loadAccountState(scope)
  assert.equal(state.available, true)
  assert.equal(state.signedIn, false)
})

test('no bridge at all is signed out and says why', async () => {
  assert.equal(accountBridge({}), null)
  assert.equal(accountBridge({ mcAccount: {} }), null, 'a partial bridge is not a bridge')
  assert.equal(accountBridge({ mcAccount: { current: () => {} } }), null)
  const state = await loadAccountState({})
  assert.equal(state.signedIn, false)
  assert.equal(state.available, false)
  assert.equal(state.code, 'MC_ACCOUNT_SHELL_ABSENT')
})

test('an action reply that is not a well-formed success is a refusal', () => {
  for (const value of [undefined, null, [], 'ok', 1, {}, { ok: 'true' }, { ok: 1 }]) {
    const result = readActionResult(value)
    assert.equal(result.ok, false, `${JSON.stringify(value)} must not read as success`)
    assert.ok(result.reason.length > 0)
  }
  assert.equal(readActionResult({ ok: true }).ok, true)
  assert.equal(readActionResult({ ok: true }).persisted, true)
  assert.equal(readActionResult({ ok: true, persisted: false }).persisted, false)
})

test('the walkthrough seam refuses rather than throwing when there is no bridge', async () => {
  const step = accountStep({})
  assert.equal(step.available, false)
  assert.equal((await step.create({ username: 'josh', password: 'x' })).ok, false)
  assert.equal((await step.signIn({ username: 'josh', password: 'x' })).ok, false)
  assert.equal((await step.signOut()).ok, false)
})

test('the walkthrough seam exposes no field that could carry a credential', () => {
  const step = accountStep({})
  assert.deepEqual(Object.keys(step).sort(), ['available', 'create', 'load', 'signIn', 'signOut'])
  /* src/views/setup.js serialises its answers to localStorage and renders them
     on a review page. A password reaching that object would be written to disk
     in the clear, so the seam must have nowhere to put one. */
  const encoded = JSON.stringify(step)
  assert.ok(!encoded.includes('password'), 'the seam must not carry a password field')
})

/* --------------------------- the copy tells the truth --------------------------- */

test('the renderer and the shell agree on the minimum password length', () => {
  assert.equal(MIN_PASSWORD_LENGTH, SHELL_MIN_PASSWORD_LENGTH,
    'a form that states a different rule than the one enforced refuses passwords it invited')
})

test('the surface says what the account is not, where the account is made', () => {
  const notice = ACCOUNT_SCOPE_NOTICE.join(' ').toLowerCase()
  /* Each of these corrects an assumption the words "create an account" produce
     by default. Dropping one leaves the product implying something untrue. */
  assert.ok(notice.includes('this computer'), 'it must say the account is local')
  assert.ok(/no password reset|there is also no password reset|no server holds it/.test(notice),
    'it must say there is no reset, because there is no server to do one')
  assert.ok(notice.includes('claude') && notice.includes('chatgpt'),
    'it must say this is not a provider login -- SHIPMENT-PLAN B14')
  assert.ok(notice.includes('subscription'), 'it must say it carries no subscription')
  assert.ok(VIEW.includes('ACCOUNT_SCOPE_NOTICE'), 'and the view must actually render it')
})

/* THE PROVIDER-TERMS FENCE. SHIPMENT-PLAN B14: a Claude subscription login
   inside a third-party product is barred. The screen may NAME those providers
   in order to say it is not them; what it must never do is collect for them. */
test('the sign-in screen never asks for a provider credential', () => {
  for (const source of [VIEW, read('src/account-state.js')]) {
    assert.ok(!/anthropic|api[_-]?key|sk-ant|openai/i.test(stripComments(source)),
      'the product sign-in must not touch provider credentials')
  }
  assert.ok(/not a login to Claude/i.test(read('src/account-state.js')),
    'and it must say so where a person reads it')
})

test('the settings surface no longer claims there is no account system', () => {
  assert.ok(!/no accounts, sign-in, or licence check/i.test(SETTINGS),
    'that sentence became false the moment the account system existed')
  assert.ok(!/nothing here to log into/i.test(SETTINGS))
  assert.ok(SETTINGS.includes('href="#/account"'), 'settings must reach the sign-in screen')
  /* The search synonyms are what route somebody typing "login" to that row.
     Changing the copy without them makes the new sign-in unfindable. */
  for (const term of ['login', 'password', 'signin', 'sign out']) {
    assert.ok(SETTINGS.includes(term), `settings search must still match "${term}"`)
  }
})

/* ------------------------------- the wiring ------------------------------- */

test('the shell exposes the account bridge, and exposes no way to set the principal', () => {
  assert.ok(PRELOAD.includes("exposeInMainWorld('mcAccount'"), 'the bridge must be exposed')
  for (const channel of ['mc-account:availability', 'mc-account:current', 'mc-account:create',
    'mc-account:sign-in', 'mc-account:sign-out', 'mc-account:change-password']) {
    assert.ok(PRELOAD.includes(channel), `${channel} must be reachable from the page`)
    assert.ok(MAIN.includes(`ipcMain.handle('${channel}'`), `${channel} must be handled in main`)
  }
  /* THE ONE THAT MATTERS. A channel that lets the page name the principal makes
     every record it appears in worthless. It has never existed; this asserts it
     never starts to. */
  assert.ok(!/set-?principal/i.test(stripComments(PRELOAD)), 'the page must not be able to name the principal')
  assert.ok(!/set-?principal/i.test(stripComments(MAIN)), 'nothing may accept a principal over IPC')
  /* And no handler may read a principal out of what the page sent. */
  assert.ok(!/value\??\.principal|request\??\.principal/.test(stripComments(MAIN)),
    'no IPC handler may take the principal from the renderer payload')
})

test('the renderer never receives the session identifier', () => {
  assert.ok(MAIN.includes('currentForRenderer()'),
    'the renderer channel must send the projected reply, not the main-process one')
  assert.ok(!MAIN.includes("withFleetProfileSender(event, () => getAccountStore().current())"),
    'the unprojected reply must not be what crosses to the page')
})

test('the spawn record carries a real principal read in the main process', () => {
  assert.ok(!/principal: null/.test(MAIN),
    'the null principal is the hole this lane was opened to close')
  assert.ok(MAIN.includes('principal: accountPrincipal()'),
    'the record must take its identity from the account store')
  assert.ok(/function accountPrincipal\(\)/.test(MAIN), 'and that function must exist in main')
  /* The store is a singleton for the process. Two instances would each hold
     their own session whenever the OS keystore is unavailable, and the record
     would name whichever one it happened to ask. */
  assert.ok(MAIN.includes('sharedAccountStore({'), 'main must use the shared store')
  assert.ok(!MAIN.includes('createAccountStore({'), 'main must not build a second store')
})

test('the sign-in screen is reachable as its own route', () => {
  assert.ok(ROUTER.includes("import { accountView }"), 'the view must be imported')
  assert.ok(ROUTER.includes("parts[0] === 'account'"), 'the route must parse')
  assert.ok(ROUTER.includes("case 'account': return accountView"), 'the route must build the view')
})

/* ------------------------- the screen holds no secret ------------------------- */

test('the sign-in screen never stores a password anywhere that outlives the call', () => {
  /* Password values are read from the DOM at submit and passed straight on. If
     one were ever written to storage, put on the profile answers, or logged,
     it would appear next to one of these. */
  const code = stripComments(VIEW)
  assert.ok(!/localStorage|sessionStorage/.test(code), 'the sign-in screen must not touch web storage')
  assert.ok(!/console\.(log|warn|error|info)/.test(code), 'nothing on an auth screen may be logged')
  assert.ok(VIEW.includes('clearPasswords()'), 'the password fields must be cleared')
  /* Cleared on refusal too. A wrong password left sitting in the field is a
     password left in the DOM of a window somebody may walk away from. */
  assert.ok(/Cleared on every outcome/.test(VIEW), 'and cleared on failure, not only on success')
  assert.ok(/autocomplete="new-password"/.test(VIEW), 'creation must invite a generated password')
  assert.ok(/autocomplete="current-password"/.test(VIEW), 'sign-in must let a manager fill it')
})
