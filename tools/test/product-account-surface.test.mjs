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
  ACCOUNT_SCOPE_LEAD,
  ACCOUNT_SCOPE_NOTICE,
  MIN_PASSWORD_LENGTH,
  accountBridge,
  accountStep,
  isPlainObject,
  loadAccountState,
  readAccountState,
  readActionResult,
} from '../../src/account-state.js'
import {
  esc,
  formMarkup,
  scopeMarkup,
  screenMarkup,
} from '../../src/account-markup.js'
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

test('an array is not a plain object, on this channel as on the setup channel', () => {
  /* `typeof [] === 'object'`, so the obvious guard lets one through, and an
     array then answers `undefined` to every field -- which on the sibling setup
     channel read as "available, nothing recorded yet" and opened a question with
     a button guaranteed to fail. */
  assert.equal(isPlainObject([]), false)
  assert.equal(isPlainObject([1, 2]), false)
  assert.equal(isPlainObject(null), false)
  assert.equal(isPlainObject(undefined), false)
  assert.equal(isPlainObject('text'), false)
  assert.equal(isPlainObject(0), false)
  assert.equal(isPlainObject({}), true)
  assert.equal(isPlainObject({ signedIn: true }), true)
})

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

/* ---------------- every absolute promise, and what pins it true ----------------
 *
 * WHY THIS EXISTS AS A TABLE AND NOT AS FIVE ASSERTIONS. The sign-in copy makes
 * promises of the strongest possible shape -- "nothing", "never", "nowhere", "no
 * server" -- because the honest description of a local account IS a list of
 * things that do not happen. Every one of them was true when written and none
 * was checked by anything, which is the exact shape of promise that a later lane
 * falsifies without ever reading the sentence: somebody adds a telemetry ping,
 * or an email field, or a password-reset flow, and the screen goes on
 * reassuring the user in words that have quietly become lies.
 *
 * The pattern is borrowed from setup-profile-build's walkthrough rules, and the
 * reason it is HERE is the lesson that produced them: they fixed the two
 * sentences a test happened to name and then found twenty-nine more unwatched in
 * the same file. One instance is not a class. Their rules walk
 * src/views/setup.js; these sentences live in src/account-state.js and
 * src/fleet-profile-settings.js, which their walker does not cover, so the same
 * gap existed in my files until this table.
 *
 * EACH ENTRY REGISTERS THE CLAIM WITH THE MECHANICAL FACT THAT KEEPS IT TRUE.
 * The claim text is asserted to still be on screen, so the registry cannot rot
 * into a list of sentences nobody ships; and the pin is asserted to still hold,
 * so the sentence cannot outlive its own truth. Changing the copy fails this
 * test until somebody re-registers it, which is the two-minute speed bump that
 * is the whole point.
 *
 * SCOPE, STATED RATHER THAN IMPLIED: the pins scan the three account modules.
 * They do not prove the rest of the application sends nothing -- that is not
 * what the sentence claims. It claims the ACCOUNT does not, and that is what is
 * checked. */

const ACCOUNT_SOURCES = Object.freeze({
  'shell/product-account.cjs': stripComments(read('shell/product-account.cjs')),
  'src/account-state.js': stripComments(read('src/account-state.js')),
  'src/views/account.js': stripComments(VIEW),
})

/* Every file the user reads words from. The store is in here because its
   refusal messages ARE user-facing copy -- "This computer could not protect
   the password, so no account was created" is a sentence a person reads at
   the moment their account is not created, and it makes a promise about what
   was written. Leaving the store out was how two real promises sat
   unregistered. */
const SHIPPED_COPY = [
  read('src/account-state.js'),
  SETTINGS,
  VIEW,
  read('shell/product-account.cjs'),
].join('\n')

const REGISTERED_CLAIMS = Object.freeze([
  {
    claim: 'Nothing is sent anywhere',
    stillTrueBecause: 'no account module can reach the network: no fetch, no XHR, no WebSocket, no beacon, and no node networking module is imported anywhere in the three of them.',
    pin() {
      const network = /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|navigator\.connection|require\(\s*['"](?:node:)?(?:http|https|net|dns|tls|dgram)['"]\s*\)|from\s+['"](?:node:)?(?:http|https|net|dns|tls|dgram)['"]/
      for (const [name, source] of Object.entries(ACCOUNT_SOURCES)) {
        assert.ok(!network.test(source), `${name} can reach the network, so "Nothing is sent anywhere" is no longer true`)
      }
    },
  },
  {
    claim: 'no email address is asked for',
    stillTrueBecause: 'no surface in the account flow declares an email input, an email autocomplete hint, or a field named email.',
    pin() {
      const emailField = /type="email"|autocomplete="email"|name="email"|account-field="email"/i
      for (const [name, source] of Object.entries(ACCOUNT_SOURCES)) {
        assert.ok(!emailField.test(source), `${name} collects an email address, so "no email address is asked for" is no longer true`)
      }
      assert.ok(!emailField.test(stripComments(read('src/views/setup.js'))),
        'the first-run step collects an email address, so "no email address is asked for" is no longer true')
    },
  },
  {
    claim: 'there is also no password reset',
    stillTrueBecause: 'the store exposes no reset, recovery or forgotten-password operation, and no mc-account channel offers one. Changing a password requires the current one.',
    pin() {
      /* Deliberately narrow. A first draft matched /reset[A-Z_]/ and flagged
         `resetSharedAccountStoreForTests`, which resets a module singleton and
         has nothing to do with a password -- a guard that cries wolf on correct
         code gets widened by the next person until it catches nothing. */
      const recovery = /resetPassword|resetCredential|recoverAccount|forgotPassword|passwordReset|mc-account:[a-z-]*(?:reset|recover|forgot)/i
      for (const [name, source] of Object.entries(ACCOUNT_SOURCES)) {
        assert.ok(!recovery.test(source), `${name} offers a password recovery path, so "there is also no password reset" is no longer true`)
      }
      assert.ok(!/mc-account:[a-z-]*(?:reset|recover|forgot)/i.test(stripComments(MAIN)),
        'the shell offers an account recovery channel, so "there is also no password reset" is no longer true')
      /* And the one password change that DOES exist still demands the old one. */
      assert.ok(ACCOUNT_SOURCES['shell/product-account.cjs'].includes('currentPassword'),
        'changing a password no longer requires the current one, which would be a reset by another name')
      /* The test-only singleton reset is exported, so it is reachable. Nothing
         in a shipped path may call it: an app that can swap its own account
         store mid-flight is an app whose audit principal can be swapped
         mid-flight. */
      assert.ok(!/resetSharedAccountStoreForTests/.test(stripComments(MAIN)),
        'the shell calls the test-only store reset, which would let the signed-in identity be swapped at runtime')
      assert.ok(!/resetSharedAccountStoreForTests/.test(stripComments(PRELOAD)),
        'the preload exposes the test-only store reset to the page')
    },
  },
  {
    claim: 'It is not a login to Claude, ChatGPT or Google',
    stillTrueBecause: 'no account module names a provider credential, key format, or provider auth environment variable. SHIPMENT-PLAN B14 bars taking a provider subscription login here.',
    pin() {
      const providerCredential = /anthropic|api[_-]?key|sk-ant|openai|oauth|access[_-]?token|refresh[_-]?token/i
      for (const [name, source] of Object.entries(ACCOUNT_SOURCES)) {
        assert.ok(!providerCredential.test(source),
          `${name} touches a provider credential, so "It is not a login to Claude, ChatGPT or Google" is no longer true`)
      }
    },
  },
  {
    claim: 'this one never asks for them',
    stillTrueBecause: 'the same pin as the claim above: the account flow has no field, channel, or storage key for a provider credential.',
    pin() {
      const providerField = /provider|claude|chatgpt|gemini/i
      assert.ok(!providerField.test(ACCOUNT_SOURCES['shell/product-account.cjs']),
        'the store now mentions a provider, so "this one never asks for them" needs re-checking')
    },
  },
  {
    claim: 'so no account was created',
    stillTrueBecause: 'every refusal in createAccount returns before the single writeStore call, so a refused creation leaves the account file byte-identical. Verified behaviourally for every reachable refusal, and by call order for the one that needs a failing keystore to reach.',
    pin() {
      const store = ACCOUNT_SOURCES['shell/product-account.cjs']
      const create = store.slice(store.indexOf('async function createAccount'), store.indexOf('const BAD_CREDENTIALS'))
      assert.equal((create.match(/writeStore\(/g) || []).length, 1, 'createAccount writes more than once, so a refusal could leave a partial account')
      assert.ok(create.indexOf("ACCOUNT_HASH_FAILED") < create.indexOf('writeStore('),
        'the hash-failure refusal now comes after the write, so "no account was created" would be false')
    },
  },
  {
    claim: 'so nothing was changed',
    stillTrueBecause: 'changePassword returns on every refusal before its single writeStore call, so a refused change leaves the old verifier and the old epoch intact. The behavioural half is proved in product-account.test.mjs: after a refused change the old password still works and the session is untouched.',
    pin() {
      const store = ACCOUNT_SOURCES['shell/product-account.cjs']
      const change = store.slice(store.indexOf('async function changePassword'))
      assert.equal((change.match(/writeStore\(/g) || []).length, 1, 'changePassword writes more than once, so a refusal could leave a partial change')
      assert.ok(change.indexOf("ACCOUNT_HASH_FAILED") < change.indexOf('writeStore('),
        'the hash-failure refusal now comes after the write, so "nothing was changed" would be false')
      /* THIS ASSERTION WAS VACUOUS AND MUTATION TESTING CAUGHT IT.
         It used to be `change.includes('currentPassword')`, which stays true
         when the actual proof is deleted -- the name survives in the
         signature and the type check. Planting `|| false` in place of the
         verify call left it green; only the behavioural suite noticed. An
         assertion that cannot fail is worse than none, because it is counted
         as coverage. This one matches the awaited call itself. */
      assert.ok(/await verifyPassword\(currentPassword/.test(change),
        'changePassword no longer proves the current password before changing it')
    },
  },
])

for (const entry of REGISTERED_CLAIMS) {
  test(`the promise "${entry.claim}" is still on screen and still true`, () => {
    assert.ok(SHIPPED_COPY.includes(entry.claim),
      `the copy no longer contains "${entry.claim}". If it was reworded, re-register it here with what keeps it true; if it was dropped, delete the entry.`)
    assert.ok(entry.stillTrueBecause.length > 40, 'a registered claim must record WHY it is still true, not just that it is')
    entry.pin()
  })
}

/* ---- the guard against self-selected coverage ----
 *
 * The first version of this file asserted that five NAMED sentences were
 * registered. That is a hand-written list standing in for the copy, and this
 * repo has already been bitten by exactly that: tools/check-suites-discovered.mjs
 * exists because a hand-written list of 11 test files stood in for a glob over
 * 26, and its comment states the rule -- self-selected coverage cannot fail.
 * My list could not fail either. Measured against the real sources it covered
 * 3 of 13 absolute-shaped sentences.
 *
 * So the sentences are DERIVED from the shipped sources now, and every one must
 * be classified. Two kinds, because collapsing them would be its own lie:
 *
 *   PINNED    - a promise about what this product does or does not do. Needs a
 *               mechanical fact that keeps it true.
 *   REPORTED  - a description of what just happened or what this build cannot
 *               do. "This computer cannot remember a sign-in" is a report about
 *               a keystore, not a promise we could break by writing code.
 *
 * A sentence in neither list fails the suite. Adding copy therefore costs a
 * classification, which is the two-minute speed bump, and the alternative --
 * loosening the pattern until nothing matches -- is the failure mode both lanes
 * hit tonight from opposite directions.
 */

function proseLiterals(source) {
  const code = stripComments(source)
  const found = new Set()
  /* Built with RegExp() rather than written as literals: these patterns need a
     backslash class and a newline class, and every attempt to author them
     inline went through a shell heredoc that ate the escapes and produced a
     regex spanning two lines. Constructing them from strings is escaping I can
     read. The third is a plain literal because it needs neither. */
  const SINGLE_QUOTED = new RegExp("'([^'\\\\\\n]{25,})'", 'g')
  const DOUBLE_QUOTED = new RegExp('"([^"\\\\\\n]{25,})"', 'g')
  const BETWEEN_TAGS = />([^<>{}`$]{25,})</g
  for (const pattern of [SINGLE_QUOTED, DOUBLE_QUOTED, BETWEEN_TAGS]) {
    for (const match of code.matchAll(pattern)) {
      const text = (match[1] || '').trim()
      if (text && /\s/.test(text) && /[a-z]/i.test(text)) found.add(text)
    }
  }
  return [...found]
}

/* A word list and `includes`, deliberately, instead of a regex.
 *
 * The regex version of this line silently became a LITERAL BACKSPACE
 * CHARACTER where a word-boundary escape was meant -- authored through a
 * shell heredoc that ate the backslash. It compiled, it ran, and it matched
 * nothing, so the guard reported ZERO absolute sentences in copy that has
 * thirteen. The "checking air" assertion below is the only reason that was
 * caught instead of shipping as a green test over nothing, which is the exact
 * defect this file exists to prevent.
 *
 * A list needs no escapes, so it cannot be corrupted that way. It over-matches
 * slightly ("none" inside "nonetheless"), and that is the safe direction: an
 * over-match costs somebody a classification, an under-match costs a promise
 * nobody is watching. */
const ABSOLUTE_WORDS = Object.freeze([
  'never', 'nothing', 'nowhere', 'no server', 'no email', 'no account', 'anywhere',
  'cannot', 'no password reset', 'no licence check', 'no subscription', 'not a login',
  'none', 'no one',
])

const isAbsoluteShaped = (sentence) => {
  const lower = sentence.toLowerCase()
  return ABSOLUTE_WORDS.some(word => lower.includes(word))
}

test('the absolute-shape detector detects, and is not silently inert', () => {
  /* Pinned because the detector it replaces was inert and looked correct. */
  assert.equal(isAbsoluteShaped('Nothing is sent anywhere'), true)
  assert.equal(isAbsoluteShaped('this one never asks for them'), true)
  assert.equal(isAbsoluteShaped('It is not a login to Claude'), true)
  assert.equal(isAbsoluteShaped('This computer cannot remember a sign-in.'), true)
  assert.equal(isAbsoluteShaped('Sign in, sign out, or change your password.'), false)
  assert.equal(isAbsoluteShaped('Choose a folder for your assistant.'), false)
})

/* Reports, not promises. Each says why it is one. */
const REPORTED_STATE = Object.freeze([
  ['This page is running in a browser rather than the installed application', 'reports where the page is running; there is genuinely no shell to hold an account.'],
  ['This copy cannot read its accounts', 'reports a damaged account file. It is the fail-closed message, not a promise.'],
  ['This computer cannot remember a sign-in', 'reports that the OS keystore is unavailable. A fact about Windows, not about our code.'],
  ['This computer cannot remember the sign-in, so you will be asked again next time', 'same keystore report, said where the person just signed in.'],
  ['There is no account on this page to sign in to', 'reports the absent shell bridge.'],
  ['The account file on this computer contains an entry this version cannot read', 'reports a corrupt record; the refusal itself is pinned by the fail-closed tests.'],
  ['The password cannot be the same as the username', 'states a rule that IS enforced, and is pinned by the password-rules test.'],
])

test('every absolute-shaped sentence in the account copy is classified', () => {
  const sources = {
    'src/account-state.js': read('src/account-state.js'),
    'src/views/account.js': VIEW,
    'shell/product-account.cjs': read('shell/product-account.cjs'),
  }
  const unclassified = []
  let seen = 0
  for (const [name, source] of Object.entries(sources)) {
    for (const sentence of proseLiterals(source)) {
      if (!isAbsoluteShaped(sentence)) continue
      seen += 1
      const pinned = REGISTERED_CLAIMS.some(entry => sentence.includes(entry.claim))
      const reported = REPORTED_STATE.some(([text]) => sentence.includes(text))
      if (!pinned && !reported) unclassified.push(`${name}: ${sentence.slice(0, 120)}`)
    }
  }
  /* A guard that finds nothing is checking air -- the rule
     tools/check-no-owner-data.mjs applies to itself. */
  assert.ok(seen >= 10, `only ${seen} absolute-shaped sentences were found; the scanner has stopped seeing the copy`)
  assert.deepEqual(unclassified, [],
    'these sentences make absolute-shaped statements and are neither pinned as promises nor classified as reports')
})

test('the shared settings row is classified too', () => {
  const row = SETTINGS.match(/<div class="settings-desc">[^<]*account lives on this computer[^<]*<\/div>/)
  assert.ok(row, 'the account settings row is gone or reworded; re-register its promises')
  assert.ok(REGISTERED_CLAIMS.some(entry => row[0].includes(entry.claim)),
    'the account settings row makes an absolute promise that nothing pins')
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

/* ---- what the screen RENDERS, proved by rendering it ----
 *
 * THREE ATTEMPTS, AND THE FIRST TWO WERE BOTH WRONG. Two planted defects --
 * an empty sign-in form, and an empty scope notice -- ship a screen with no
 * fields, or one that never says there is no password reset and that this is
 * not a provider login (the SHIPMENT-PLAN B14 disclosure).
 *
 *   Attempt 1 searched the whole file for strings. Survived: the strings live
 *   in the change-password form too.
 *   Attempt 2 searched the function's own source slice. Survived as well,
 *   because the plant was an early `return ''` with the real markup still
 *   below it -- DEAD CODE MATCHES A TEXT SEARCH.
 *
 * No assertion over source text can see reachability. So the builders moved to
 * src/account-markup.js, which imports no stylesheet and holds no DOM, and
 * these tests CALL them and read the output. That is the only instrument that
 * can see the defect -- the rule homescreen-fix stated tonight: ask what your
 * instrument shows if the thing you are checking for is present. */

const SIGNED_OUT_VIEW = Object.freeze({ available: true, signedIn: false, accountCount: 0, canPersistSession: true })
const SIGNED_IN_VIEW = Object.freeze({
  available: true, signedIn: true, accountCount: 1, canPersistSession: true,
  username: 'josh', displayName: 'Josh P', expiresAtMs: Date.now() + 5 * 86400000,
})

test('the sign-in form renders its fields', () => {
  for (const mode of ['sign-in', 'create']) {
    const html = formMarkup({ mode, state: SIGNED_OUT_VIEW })
    assert.match(html, /<input[^>]*name="username"/, `${mode}: no name field is rendered`)
    assert.match(html, /<input[^>]*name="password"[^>]*type="password"|<input[^>]*type="password"[^>]*name="password"/,
      `${mode}: no password field is rendered`)
    assert.match(html, /type="submit"/, `${mode}: nothing to submit the form with`)
    assert.ok(html.length > 800, `${mode}: the form collapsed to ${html.length} characters`)
  }
  assert.match(formMarkup({ mode: 'create', state: SIGNED_OUT_VIEW }), /name="displayName"/,
    'creating an account no longer offers a display name')
})

test('the scope notice is rendered, and reaches the person creating an account', () => {
  const notice = scopeMarkup()
  for (const paragraph of ACCOUNT_SCOPE_NOTICE) {
    assert.ok(notice.includes(paragraph.slice(0, 60)),
      'scopeMarkup does not render one of the sentences it exists to show')
  }

  /* And it must reach BOTH readers: the one creating an account and the one
     signing in. A notice rendered only on one path is a notice half the
     product never shows. */
  for (const mode of ['create', 'sign-in']) {
    const html = formMarkup({ mode, state: SIGNED_OUT_VIEW })
    assert.ok(html.includes(ACCOUNT_SCOPE_NOTICE[0].slice(0, 60)),
      `${mode}: the scope notice never reaches the screen`)
    assert.ok(html.includes(esc(ACCOUNT_SCOPE_LEAD)), `${mode}: the notice lost its heading`)
  }
})

test('every state the screen can be in renders something a person can act on', () => {
  const states = [
    ['reading', { state: null }, /Reading this computer/],
    ['unavailable', { state: { available: false, signedIn: false, reason: 'no shell here' } }, /no account on this page/],
    ['signed out', { state: SIGNED_OUT_VIEW }, /name="password"/],
    ['signed in', { state: SIGNED_IN_VIEW }, /data-account-sign-out/],
    ['changing password', { state: SIGNED_IN_VIEW, mode: 'change-password' }, /name="currentPassword"/],
  ]
  for (const [name, input, expected] of states) {
    const html = screenMarkup(input)
    assert.ok(html.length > 100, `${name} renders ${html.length} characters, which is not a screen`)
    assert.match(html, expected, `${name} does not render its own control`)
  }
})

test('the keystore warning appears exactly when the keystore is missing', () => {
  const withKeystore = screenMarkup({ state: SIGNED_OUT_VIEW })
  const without = screenMarkup({ state: { ...SIGNED_OUT_VIEW, canPersistSession: false } })
  assert.ok(!withKeystore.includes('cannot remember a sign-in'), 'the warning shows when it should not')
  assert.ok(without.includes('cannot remember a sign-in'), 'the warning is missing when the keystore is unavailable')
})

test('no rendered screen can carry a password value', () => {
  /* The builders take no parameter a password could arrive in, so this is
     structural rather than hopeful: a value cannot be rendered that cannot be
     passed. Asserted against every state anyway. */
  const secret = "hunter2-correct-horse"
  for (const input of [
    { state: SIGNED_OUT_VIEW }, { state: SIGNED_IN_VIEW },
    { state: SIGNED_IN_VIEW, mode: 'change-password' },
    { state: SIGNED_OUT_VIEW, mode: 'create', notice: { tone: 'bad', title: 'x', detail: 'y' } },
  ]) {
    assert.ok(!screenMarkup(input).includes(secret))
    assert.ok(!/value="[^"]*password/i.test(screenMarkup(input)), 'a password field renders a value attribute')
  }
})

test('the view owns no markup of its own', () => {
  /* If HTML creeps back into the view it becomes untestable again, which is
     how this defect existed in the first place. */
  const code = stripComments(VIEW)
  assert.ok(code.includes('screenMarkup(view())'), 'the view no longer paints through the tested builder')
  const inlineTags = code.match(/<(form|input|button|article|h1)\b/g) || []
  assert.deepEqual(inlineTags, [],
    `the view has grown ${inlineTags.length} copy- or control-bearing element(s) that no test can render`)
  /* The root shell (<main>/<div>/<section>) is deliberately allowed: it is
     the container the view mounts into and carries no words. */
  assert.ok(code.includes('data-account-section'), 'the view no longer mounts a section to paint into')
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
  /* Asserted on the RENDERED output now, not on the file: these moved to
     src/account-markup.js with the rest of the markup, and a file search
     could not tell a rendered hint from a dead one anyway. */
  assert.match(formMarkup({ mode: 'create', state: { available: true, signedIn: false } }),
    /autocomplete="new-password"/, 'creation must invite a generated password')
  assert.match(formMarkup({ mode: 'sign-in', state: { available: true, signedIn: false } }),
    /autocomplete="current-password"/, 'sign-in must let a password manager fill it')
})
