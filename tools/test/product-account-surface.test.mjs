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
import { readFileSync, readdirSync } from 'node:fs'
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
  changeDisplayNameMarkup,
  esc,
  formMarkup,
  googleOptionMarkup,
  scopeMarkup,
  screenMarkup,
  setupAccountStepMarkup,
  signedInMarkup,
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
  /* The three google* entries take NO ARGUMENTS, which is why they are safe
     additions to a seam whose whole purpose is having nowhere to put a
     credential: there is no parameter on any of them for one to arrive in. The
     identity is decided in the main process from a token Google signed. */
  assert.deepEqual(Object.keys(step).sort(),
    ['available', 'create', 'googleAvailability', 'googleCancel', 'googleSignIn', 'load', 'signIn', 'signOut'])
  for (const name of ['googleSignIn', 'googleCancel', 'googleAvailability']) {
    assert.equal(step[name].length, 0, `${name} takes an argument, so a page could aim the sign-in`)
  }
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
  /* The second way in has to be described where the first one is, or the
     screen offers a Google button the copy never explains. */
  assert.ok(notice.includes('google'), 'it must say what signing in with Google does')
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

/* THE FILE SET IS DISCOVERED, NOT LISTED, and this is the third time tonight
 * that a hand-written list turned out to be the defect. The first version named
 * three files. Then I extracted the markup into src/account-markup.js to make it
 * testable -- a fix for a coverage hole -- and every form field moved OUT of the
 * listed set. Planted afterwards: an email field, a network call and a provider
 * key hint in the new module all survived, 0 of 5 killed. The guards stayed
 * pointed at the file the code had left.
 *
 * Coverage that is written down does not follow the code. So the set is derived
 * from the tree: everything under src/ and shell/ whose name contains "account",
 * plus the view. A new account-*.js file is covered the moment it exists, and
 * the floor below fails if discovery ever returns less than the tree holds. */
function discoverAccountSources() {
  const found = {}
  for (const directory of ['src', 'shell', 'src/views']) {
    const absolute = path.join(REPO_ROOT, directory)
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      if (!/account/i.test(entry.name)) continue
      if (!/\.(js|cjs|mjs)$/.test(entry.name)) continue
      const relative = `${directory}/${entry.name}`
      found[relative] = stripComments(read(relative))
    }
  }
  return found
}

const ACCOUNT_SOURCES = discoverAccountSources()

test('the account file set is discovered, and covers every account module in the tree', () => {
  const names = Object.keys(ACCOUNT_SOURCES).sort()
  /* Named explicitly so that a file DISAPPEARING from discovery is a failure
     rather than a quietly smaller scan. Add to this list when you add a module;
     the discovery above is what makes forgetting it impossible to miss. */
  for (const required of ['src/account-state.js', 'src/account-markup.js', 'shell/product-account.cjs', 'src/views/account.js']) {
    assert.ok(names.includes(required), `${required} is no longer being scanned by the account guards`)
  }
  assert.ok(names.length >= 4, `only ${names.length} account modules were discovered`)
  for (const [name, text] of Object.entries(ACCOUNT_SOURCES)) {
    assert.ok(text.length > 200, `${name} was discovered but read as ${text.length} characters`)
  }
})
const SHIPPED_COPY = [
  read('src/account-state.js'),
  SETTINGS,
  VIEW,
  read('shell/product-account.cjs'),
  read('src/account-markup.js'),
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
    /* RE-REGISTERED, BECAUSE THE PROMISE CHANGED. It used to read "not a login
       to Claude, ChatGPT or Google". Google sign-in now exists, so the old
       sentence would have been false the moment it shipped -- and the pin below
       would NOT have caught it, because a regex for credential names says
       nothing about a sentence's truth. It was changed in the copy first and
       re-registered here, which is the two-minute speed bump working.

       WHAT DID NOT CHANGE is the thing B14 is actually about: no PROVIDER
       SUBSCRIPTION login. Google sign-in asks for `openid email profile`,
       which buys access to nothing and carries no plan anybody pays for. */
    claim: 'not a login to Claude or ChatGPT',
    stillTrueBecause: 'no account module names an Anthropic or OpenAI credential, key format, or auth environment variable, and the only OAuth on the sign-in path asks for openid/email/profile -- scopes that grant access to no service and carry no subscription. SHIPMENT-PLAN B14 bars taking a provider subscription login; it does not reach an identity assertion.',
    pin() {
      /* The providers B14 is about. `oauth`/`access_token` are deliberately
         NOT in this list any more: an identity flow legitimately names them,
         and a guard that fires on correct code gets widened until it catches
         nothing. What must stay absent is a credential belonging to a paid
         plan. */
      /* CREDENTIAL SHAPES, NOT PROVIDER NAMES. The first draft of this list
         included `chatgpt`, and it fired on the sentence it was guarding --
         the copy names those providers precisely in order to say it is not
         them. A guard that refuses its own promise gets deleted by the next
         person. What must stay absent is a KEY. */
      const subscriptionCredential = /anthropic|sk-ant|openai|api[_-]?key|ANTHROPIC_API_KEY|OPENAI_API_KEY/i
      for (const [name, source] of Object.entries(ACCOUNT_SOURCES)) {
        assert.ok(!subscriptionCredential.test(source),
          `${name} touches a provider subscription credential, so "not a login to Claude or ChatGPT" is no longer true`)
      }
      /* And the scopes, checked against the constant the flow actually sends
         rather than against the sentence. A widened scope list is what would
         turn the identity flow into an access grant. */
      const flow = stripComments(read('shell/google-signin.cjs'))
      assert.ok(/SIGNIN_SCOPES = Object\.freeze\(\['openid', 'email', 'profile'\]\)/.test(flow),
        'the Google sign-in scopes are no longer openid/email/profile, so this is no longer only an identity assertion')
      for (const marker of ['drive', 'gmail', 'calendar', 'cloud-platform']) {
        assert.ok(!new RegExp('SIGNIN_SCOPES[^\\n]*' + marker).test(flow),
          `the sign-in scopes now include ${marker}`)
      }
    },
  },
  {
    claim: 'this one never asks for them',
    stillTrueBecause: 'the account flow has no field, channel, or storage key for a Claude or ChatGPT credential, and the Google account record has no token field of any kind -- only a subject identifier and a verified address.',
    pin() {
      const store = ACCOUNT_SOURCES['shell/product-account.cjs']
      /* NARROWED, AND SAID WHY. The old pin refused the bare word "provider"
         anywhere in the store. That was a fine proxy while the store knew about
         no identity provider at all; it is a false alarm now that a record
         legitimately says `provider: 'google'`. The promise was never about the
         WORD -- it is about not asking anybody for a provider's password or key,
         so that is what is checked. */
      const asksForOne = /claude|chatgpt|gemini|anthropic|openai|apiKey|api_key|providerPassword|providerToken/i
      assert.ok(!asksForOne.test(store),
        'the store now names a provider credential, so "this one never asks for them" needs re-checking')
      /* THE GOOGLE RECORD HOLDS NO TOKEN. This is the specific thing that would
         make the sentence false, and it is checked on the field names the
         record could store one in. */
      /* A FIELD, not the word. `REQUIRED_IDENTITY_ASSURANCE = "id_token-verified"`
         is the name of a check that has to have happened -- the opposite of a
         stored token -- and a bare-word scan flags it. What a stored token
         would look like is an assignment, so that is what this matches. */
      const tokenField = /(?:accessToken|access_token|refreshToken|refresh_token|idToken|id_token|bearerToken)\s*[:=]/i
      assert.ok(!tokenField.test(store),
        'the account store now holds a Google token, which it must never do -- the product calls no Google API on anybody\'s behalf')
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
      /* BOUNDED AT BOTH ENDS, and it was not. This used to slice to the end of
         the file, which counted every later `writeStore` as one of
         changePassword's -- correct only for as long as changePassword happened
         to be the last mutation in the file. `changeDisplayName` was added
         after it and the pin failed on code that is not the code it is about.
         An assertion whose subject depends on file order is an assertion that
         reports the wrong function. It is pinned by its own end marker now, and
         changeDisplayName gets its own pin below because it makes the SAME
         promise and therefore owes the same proof. */
      const change = store.slice(store.indexOf('async function changePassword'), store.indexOf('function changeDisplayName'))
      assert.ok(change.length > 400, 'the changePassword slice is empty or unbounded; its end marker moved')
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

      /* THE SAME SENTENCE, SAID BY THE RENAME PATH, PROVED THE SAME WAY.
         `changeDisplayName` refuses with "so nothing was changed" four times.
         Each refusal must return before its single write, or the sentence is
         false on whichever branch does not. */
      const rename = store.slice(store.indexOf('function changeDisplayName'), store.indexOf('/* ------------------------- the account partition'))
      assert.ok(rename.length > 400, 'the changeDisplayName slice is empty; its markers moved')
      assert.equal((rename.match(/writeStore\(/g) || []).length, 1,
        'changeDisplayName writes more than once, so a refusal could leave a partial change')
      const firstWrite = rename.indexOf('writeStore(')
      for (const code of ['ACCOUNT_NOT_SIGNED_IN', 'ACCOUNT_DISPLAY_NAME_INVALID', 'ACCOUNT_STORE_CORRUPT', 'ACCOUNT_DISPLAY_NAME_UNCHANGED']) {
        const at = rename.indexOf(code)
        assert.ok(at !== -1 && at < firstWrite,
          `${code} is gone or now comes after the write, so "nothing was changed" would be false on that branch`)
      }
    },
  },
  {
    /* THE PROMISE THE FIRST-RUN WALKTHROUGH MAKES, added when the "Shown as"
       field landed there. It is the strongest promise on that screen and it is
       made at the worst moment to break one: a person is ninety seconds into
       the product, deciding whether to type a name at all. The walkthrough used
       to pass a hardcoded empty display name, so the USERNAME became the
       permanent label on every record of their work -- the exact defect this
       sentence now promises does not exist. If the rename path ever goes, this
       sentence becomes a lie told to first-time users, so it is pinned to the
       thing that makes it true rather than to its own wording. */
    claim: 'nothing you choose here is permanent',
    stillTrueBecause: 'the walkthrough now passes the typed name (src/views/setup.js hands `displayName` to account.create instead of the empty string it used to hardcode), and changeDisplayName in shell/product-account.cjs is what lets it be changed afterwards -- which is the same mechanism the rename promise above is pinned to.',
    pin() {
      /* READ FROM DISK, NOT FROM ACCOUNT_SOURCES. discoverAccountSources only
         collects files whose NAME matches /account/, so src/views/setup.js is
         not in it -- and the first version of this pin did
         `ACCOUNT_SOURCES['src/views/setup.js'] || ''`, which made the
         hardcoded-empty-name check pass vacuously against an empty string. That
         is the absence-read-as-consent defect this suite exists to catch,
         committed inside a guard written to catch it. Read the file, and fail
         loudly if it is not there. */
      const setupPath = path.join(REPO_ROOT, 'src', 'views', 'setup.js')
      let setupRaw
      try {
        setupRaw = readFileSync(setupPath, 'utf8')
      } catch (error) {
        assert.fail(`src/views/setup.js could not be read (${error.code}), so this promise cannot be checked -- absent is not proof`)
      }
      assert.ok(setupRaw.length > 200,
        `src/views/setup.js read as ${setupRaw.length} characters, which is not the walkthrough`)
      const setup = stripComments(setupRaw)
      assert.ok(!/displayName:\s*''/.test(setup),
        'the walkthrough hardcodes an empty display name again, so the username becomes the permanent label and this promise is false')
      assert.ok(/account\.create\(\{[^)]*displayName[^)]*\)/.test(setup),
        'the walkthrough no longer passes a display name to create, so what the person typed is discarded')
      const markup = ACCOUNT_SOURCES['src/account-markup.js'] || ''
      assert.ok(markup.includes('data-setup-account-field="displayName"'),
        'the "Shown as" field is gone from the walkthrough, so the sentence promises about a field that no longer exists')
      const store = ACCOUNT_SOURCES['shell/product-account.cjs']
      assert.ok(store.includes('function changeDisplayName'),
        'the rename path is gone, so "nothing you choose here is permanent" is no longer true')
    },
  },
  {
    /* THE PROMISE THE RENAME SCREEN MAKES, and the one a person actually acts
       on: they will only press Save if renaming themselves is safe for what
       they already did. */
    claim: 'never re-labels or hides anything you already did',
    stillTrueBecause: 'a run is recorded against `account:<id>` -- shell/spawn-record.cjs writes the principal the main process read from the store -- and changeDisplayName writes exactly one field, `displayName`. It cannot reach `id`, and the account screen counts a person\'s own runs by comparing the id, so no past record changes hands or changes label when the name changes.',
    pin() {
      const store = ACCOUNT_SOURCES['shell/product-account.cjs']
      const rename = store.slice(store.indexOf('function changeDisplayName'), store.indexOf('/* ------------------------- the account partition'))
      assert.ok(rename.length > 400, 'the rename path is gone, so this promise is about nothing')
      /* The write must be a spread that replaces ONE field. A rename that
         assigned a whole record could take the id with it. */
      assert.ok(/\{ \.\.\.entry, displayName: next \}/.test(rename),
        'changeDisplayName no longer writes exactly one field, so it may now touch the id a record is filed under')
      for (const field of ['id:', 'epoch:', 'username:', 'identity:', 'verifier:']) {
        assert.ok(!rename.includes(field),
          `changeDisplayName now writes ${field} -- renaming must not touch the identity a past record is filed under`)
      }
      /* And the page must not be able to name the account it renames. */
      assert.ok(!/accountId|account\.id\s*=/.test(stripComments(ACCOUNT_SOURCES['src/views/account.js']).slice(
        stripComments(ACCOUNT_SOURCES['src/views/account.js']).indexOf("kind === 'display-name'"),
        stripComments(ACCOUNT_SOURCES['src/views/account.js']).indexOf("const currentPassword"),
      )), 'the rename action now sends an account id, which would let a page rename somebody else')
    },
  },
  {
    claim: 'kept for you and not for whoever else uses this computer',
    stillTrueBecause: 'the account partition is one file per account id under <userData>/accounts/, the id comes from the main-process session and never from the page, and no IPC channel in the shell accepts an account id as an argument. A second account therefore cannot be handed the first one\'s file, and a renderer cannot ask for one.',
    pin() {
      const store = ACCOUNT_SOURCES['shell/product-account.cjs']
      /* The file name IS the account id, so the id must be shape-checked
         immediately before it is joined to a path. Without this, a record's own
         field becomes a path traversal. */
      const dataPath = store.slice(store.indexOf('function accountDataPath'))
      assert.ok(/\^\[0-9a-f\]\{32\}\$/.test(dataPath.slice(0, 400)),
        'accountDataPath no longer validates the account id before joining it to a path')
      /* Every partition read and write starts from `current()`, which reads the
         main-process session. A function that took an account id from its
         caller would be one a page could aim. */
      for (const name of ['function accountDataForRenderer', 'function getSetting', 'function putSetting', 'function attachPaymentMethod']) {
        const slice = store.slice(store.indexOf(name), store.indexOf(name) + 300)
        assert.ok(/const state = current\(\)/.test(slice),
          `${name} no longer takes the account from the signed-in session, so a caller could choose whose data it reads`)
      }
      /* And the channel itself: the shell must not accept an account id from
         the renderer on any account channel. */
      const main = stripComments(MAIN)
      const accountChannels = main.match(/ipcMain\.handle\('mc-account:[^)]*\)/g) || []
      assert.ok(accountChannels.length >= 6, 'the account channels are no longer discoverable, so this guard is checking air')
      for (const channel of accountChannels) {
        assert.ok(!/accountId/i.test(channel),
          `an mc-account channel now takes an account id from the page: ${channel.slice(0, 80)}`)
      }
    },
  },
  {
    claim: 'no number, expiry or security code is shown here or anywhere else in this program',
    stillTrueBecause: 'the only payment value any account module holds is a vault KEY NAME. No account module, and no account IPC channel, names a card number, expiry, CVC, PAN, last-four or token field -- there is nowhere for one to arrive from and nowhere to put it.',
    pin() {
      /* A field-name scan, not a value scan: a value cannot be searched for,
         but the FIELD it would have to arrive in can. If none of these names
         exists anywhere in the account surface, no branch can render one. */
      /* FIELD NAMES, not English. The first draft of this list included the
         bare word `expiry`, which matched the very sentence it is guarding --
         "no number, expiry or security code is shown" -- and failed the suite
         on its own copy. Every entry here is a shape a card field would be
         NAMED, and none of them is a word that appears in prose. */
      const cardDetail = /\b(?:cardNumber|card_number|cardnum|pan|cvc|cvv|securityCode|expiryMonth|expiryYear|expMonth|expYear|lastFour|last4|cardToken|paymentToken)\b/i
      for (const [name, source] of Object.entries(ACCOUNT_SOURCES)) {
        assert.ok(!cardDetail.test(stripComments(source)),
          `${name} now names a card-detail field, so "no number, expiry or security code is shown" is no longer true`)
      }
      const main = stripComments(MAIN)
      const paymentChannels = (main.match(/ipcMain\.handle\('mc-account:payment[^;]*\}\)\)/g) || []).join('\n')
      assert.ok(paymentChannels.length > 0, 'the payment channels are no longer discoverable, so this guard is checking air')
      assert.ok(!cardDetail.test(paymentChannels),
        'a payment channel now carries a card detail rather than only a vault key name')
      /* The presence verb answers through an exit code with no stdout, so the
         shell-side reader must not be capturing output either. */
      const presence = stripComments(read('shell/vault-presence.cjs'))
      assert.ok(/stdio: \['ignore', 'ignore', 'ignore'\]/.test(presence),
        'the vault presence check now captures output from the vault program, which is where a value could appear')
    },
  },
  {
    claim: 'Nothing in this program can charge anything without one, and attaching one is not a payment',
    stillTrueBecause: 'attachment writes a vault key name into a JSON file and nothing else. No account module imports or references a payment provider, a charge, a checkout session or a transaction, and the shell attach channel reaches exactly one function whose whole body is a file write.',
    pin() {
      const spend = /\b(?:stripe|paddle|chargeCard|createCharge|createPaymentIntent|captureP(?:ayment|urchase)|billing_checkout|checkout_create|transaction_create|refund)\b/i
      for (const [name, source] of Object.entries(ACCOUNT_SOURCES)) {
        assert.ok(!spend.test(stripComments(source)),
          `${name} can now reach a payment provider, so "attaching one is not a payment" is no longer true`)
      }
      const store = ACCOUNT_SOURCES['shell/product-account.cjs']
      const attach = store.slice(store.indexOf('function attachPaymentMethod'))
      const body = attach.slice(0, attach.indexOf('\n  }\n') + 5)
      assert.ok(!spend.test(body), 'attachPaymentMethod now reaches a payment path')
      /* It must not read the vault either. Attachment names a record; reading
         one is a different capability with a different review. */
      assert.ok(!/getSecret|readSecret|decrypt|Unprotect/i.test(body),
        'attachPaymentMethod now reads the vault record it is only supposed to name')
      /* And the key it will accept is an allowlist, not a pattern -- so a page
         cannot widen what counts as "a payment method". */
      assert.ok(/PAYMENT_VAULT_KEYS\.includes\(vaultKey\)/.test(body),
        'attachPaymentMethod no longer checks the vault key against the fixed allowlist')
      assert.ok(!store.includes("PAYMENT_VAULT_KEYS = Object.freeze(['payment_card_default', 'owner_legal_identity_v1'"),
        'the identity record is now attachable as a payment method')
    },
  },
  {
    /* ---- the three promises Google sign-in adds ---- */
    claim: 'never into this program',
    stillTrueBecause: 'the authorization URL is handed to the operating system\'s browser through shell.openExternal. No account module and no part of the sign-in flow opens a BrowserWindow, a webview or an iframe on a Google address, and there is no password field anywhere on the Google path -- so there is nowhere for a Google password to be typed into this program.',
    pin() {
      const flow = stripComments(read('shell/google-signin.cjs'))
      /* An embedded window showing Google's sign-in page is the exact thing
         this sentence promises does not happen, and it is what Google itself
         refuses. The flow must not be able to build one. */
      assert.ok(!/BrowserWindow|webContents|<webview|createElement\(.iframe.\)/i.test(flow),
        'the Google sign-in flow can now open a window of its own, so the password would be typed into this program after all')
      assert.ok(/openExternal/.test(stripComments(MAIN)),
        'the shell no longer hands the sign-in URL to the system browser')
      /* AND THE GOOGLE OPTION ITSELF COLLECTS NOTHING. Rendered rather than
         searched: the first version of this scanned every source line that
         mentioned Google for the word `password`, and it fired on the sentence
         'there is no password here to change' -- a guard matching the copy that
         states the promise. What it should check is that the option a person
         presses has no field on it, and that can only be seen by building it. */
      for (const google of [null, { available: false, code: 'X', reason: 'no id' }, { available: true, source: 'shipped', testProvider: null }]) {
        for (const busy of [false, true]) {
          const rendered = googleOptionMarkup({ google, busy })
          assert.ok(!/<input|type="password"|autocomplete=/i.test(rendered),
            `the Google option renders an input field when google=${JSON.stringify(google)} busy=${busy}`)
        }
      }
    },
  },
  {
    claim: 'It gets no access to your Drive, your Gmail or your Calendar',
    stillTrueBecause: 'the scope list sent to Google is the frozen constant SIGNIN_SCOPES = openid, email, profile. None of them grants read or write access to any Google service, and the flow refuses to start if the list ever contains a service marker.',
    pin() {
      const flow = stripComments(read('shell/google-signin.cjs'))
      assert.ok(/SIGNIN_SCOPES = Object\.freeze\(\['openid', 'email', 'profile'\]\)/.test(flow),
        'the requested scopes changed, so the promise about Drive, Gmail and Calendar needs re-checking')
      /* The runtime guard, not just the constant: a widened list must stop the
         flow rather than quietly ask for more. */
      assert.ok(/GOOGLE_SIGNIN_SCOPE_REFUSED/.test(flow),
        'the flow no longer refuses to start when the scopes reach a service')
    },
  },
  {
    claim: 'Nothing is signed in until you do',
    stillTrueBecause: 'the view awaits the shell\'s reply and only calls refresh() -- the read that decides what the screen says -- after it. Every failure path repaints from the same read, so a sign-in that did not complete leaves the screen showing signed out.',
    pin() {
      const view = ACCOUNT_SOURCES['src/views/account.js']
      const start = view.slice(view.indexOf('async function startGoogleSignIn'), view.indexOf('function onClick'))
      assert.ok(start.length > 200, 'the Google sign-in action is gone, so this promise is about nothing')
      /* There must be no assignment that makes the screen say signed-in
         without going through the state read. */
      assert.ok(!/states*=s*{/.test(start), 'the Google action now writes the signed-in state directly instead of re-reading it')
      assert.ok(/await refresh\(\)/.test(start), 'the Google action no longer re-reads who is signed in')
      /* And the failure branch must repaint from that read too. */
      const failure = start.slice(start.indexOf('if (!result.ok)'))
      assert.ok(/await refresh\(\)/.test(failure), 'a failed Google sign-in no longer re-reads the account state')
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
  ['This copy cannot hold an account', 'reports that this build has no capability payload or no readable store; the first-run step still lets the person continue, signed out.'],
  ['The password cannot be the same as the username', 'states a rule that IS enforced, and is pinned by the password-rules test.'],
  ['this installation’s own vault does not hold that record', 'reports a vault this copy just read and found the record absent from. It is a measurement, not a promise -- and it is the branch that exists so that state cannot render as "no card on file".'],
  ['This copy could not check whether a card is attached', 'reports that the check itself failed. The sentence exists to refuse the false report; making it a promise would be promising that a read never fails.'],
  ['That email address already identifies a different Google account on this computer', 'reports a collision the store just found between a Google subject identifier and an address already on this computer. It is a refusal that happened, not a promise -- and it is the branch that stops one person being handed another\'s account, pinned behaviourally in google-account.test.mjs.'],
  ['An account on this computer already uses that name', 'reports a name collision the store just found. Same refusal shape as the line above.'],
  ['This copy cannot sign in with Google', 'reports that this build has no Google sign-in channel on its bridge. A fact about the build, said instead of showing a button that would fail.'],
  ['This copy cannot change the name it shows', 'reports that this build has no rename channel on its bridge -- the same shape as the Google line above. It is said instead of a Save that appears to work and changes nothing, which is the failure the sentence exists to refuse.'],
  ['there is no account whose data this would be', 'reports that nobody is signed in. It is the partition refusing to answer rather than answering with somebody else\'s data, which is the behaviour the isolation tests pin.'],
])

test('every absolute-shaped sentence in the account copy is classified', () => {
  const sources = ACCOUNT_SOURCES
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
    'mc-account:sign-in', 'mc-account:sign-out', 'mc-account:change-password',
    'mc-account:change-display-name']) {
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
    ['changing the shown name', { state: SIGNED_IN_VIEW, mode: 'display-name' }, /name="displayName"/],
  ]
  for (const [name, input, expected] of states) {
    const html = screenMarkup(input)
    assert.ok(html.length > 100, `${name} renders ${html.length} characters, which is not a screen`)
    assert.match(html, expected, `${name} does not render its own control`)
  }
})

/* THE NAME A PERSON IS SHOWN AS, AND THAT IT IS NOT A ONE-WAY DOOR.
 *
 * The defect: the first-run walkthrough creates the account with an empty
 * display name, the store falls back to the username, and there was no screen
 * anywhere in the product that could change it afterwards -- so a username
 * typed in the first ninety seconds was the permanent label on every record of
 * that person's work. These render the repair rather than searching for it,
 * for the reason the whole file exists. */
test('the signed-in screen offers a way to change the name it shows', () => {
  const html = signedInMarkup({ state: SIGNED_IN_VIEW })
  assert.match(html, /data-account-shown-as/, 'the signed-in screen no longer says what it calls you')
  assert.match(html, /data-account-mode="display-name"/, 'there is no control that opens the rename form')
  /* A GOOGLE ACCOUNT TOO. Its display name is the verified email address, in
     full, on every record -- the person who most needs this. The password row
     is hidden for them and it would be easy to hide this one by the same
     reflex; there is no password here to change, but there IS a name. */
  const google = signedInMarkup({
    state: { ...SIGNED_IN_VIEW, signInMethod: 'google', username: 'a@example.com', verifiedEmail: 'a@example.com', displayName: 'a@example.com' },
  })
  assert.match(google, /data-account-mode="display-name"/, 'a Google account is not offered the rename it needs most')
})

test('the rename form states what an empty box means, with the username in it', () => {
  const html = changeDisplayNameMarkup({ state: SIGNED_IN_VIEW })
  assert.match(html, /<input[^>]*name="displayName"/, 'the rename form has no field')
  assert.match(html, /value="Josh P"/, 'the field is not prefilled with the current name, so saving would need it retyped')
  assert.match(html, /type="submit"/, 'nothing to submit the rename with')
  /* THE ABSENCE CASE, WHICH IS THIS CODEBASE'S SIGNATURE DEFECT. An empty
     field MEANS something here -- go back to the username -- and a meaning
     that is not printed is a meaning nobody consented to. */
  assert.match(html, /Leave it empty/, 'the form no longer says what an empty box does')
  assert.match(html, /<code>josh<\/code>/, 'the form does not name the username an empty box falls back to')
  /* No password is asked for on this form, and none may be rendered by it. */
  assert.ok(!/type="password"/.test(html), 'the rename form now asks for a password it does not need')
})

test('the rename action sends what was typed, and lets the shell decide what it becomes', () => {
  const view = stripComments(ACCOUNT_SOURCES['src/views/account.js'])
  const action = view.slice(view.indexOf("kind === 'display-name'"), view.indexOf('const currentPassword'))
  assert.ok(action.length > 200, 'the rename action is gone')
  /* Not trimmed, not defaulted, not emptied in the page. Two opinions about
     what a name normalizes to eventually disagree, and the one on screen would
     be the wrong one. Asserted on the READ and on the SEND rather than by
     scanning the whole action for a `||`, because the action legitimately uses
     one to render the result afterwards -- a guard that cannot tell those apart
     is a guard that fires on correct code. */
  assert.match(action, /const displayName = fieldValue\('displayName'\)/,
    'the rename no longer reads the field as typed')
  assert.match(action, /changeDisplayName\(\{ displayName \}\)/,
    'the rename now transforms the name before sending it, so the page and the shell can disagree about what somebody is called')
  /* The sentence shown afterwards must come from the re-read, not from the
     typed string: they differ exactly when the name was emptied or stripped.
     Scoped to what happens AFTER the shell is called -- the refusal branch in
     front of it legitimately writes a notice without reading anything, and an
     unscoped index comparison flags that as the defect it is not. */
  const onSuccess = action.slice(action.indexOf('changeDisplayName({ displayName })'))
  assert.ok(onSuccess.length > 100, 'the success handler is gone')
  assert.ok(onSuccess.indexOf('await refresh()') < onSuccess.indexOf('notice ='),
    'the rename now writes its confirmation before re-reading, so it can claim a name the shell did not store')
  /* And it must not print an empty name when the re-read comes back signed
     out -- the session can expire while the write is in flight. */
  assert.ok(/state\?\.signedIn/.test(onSuccess),
    'the rename no longer checks that the re-read is still signed in before naming somebody')
  /* A build without the channel must say so rather than showing a Save that
     silently does nothing. */
  assert.ok(/typeof bridge\.changeDisplayName !== 'function'/.test(action),
    'the rename no longer checks that this build has the channel')
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
test('the first-run sign-in step renders, in every state it can be in', () => {
  const states = [
    ['reading', { accountState: null }, /Reading this computer/],
    ['unavailable', { accountState: { available: false, reason: 'no payload' } }, /cannot hold an account/],
    ['signed in', { accountState: { available: true, signedIn: true, displayName: 'Josh P' } }, /says who asked for it/],
    ['signed out', { accountState: { available: true, signedIn: false } }, /data-setup-account-field="password"/],
  ]
  for (const [name, input, expected] of states) {
    const html = setupAccountStepMarkup({ ...input, actions: '<div class="setup-actions"></div>' })
    assert.ok(html.length > 80, `${name}: the first-run step renders ${html.length} characters`)
    assert.match(html, expected, `${name}: the first-run step does not render its own content`)
  }
})

test('the first-run step shows the scope notice where the account is created', () => {
  /* This is the SHIPMENT-PLAN B14 disclosure on the screen a first-time user
     actually meets. A plant proved it could vanish silently while the whole
     suite stayed green, which is why it is rendered and read here. */
  const html = setupAccountStepMarkup({ accountState: { available: true, signedIn: false }, mode: 'create' })
  for (const paragraph of ACCOUNT_SCOPE_NOTICE) {
    assert.ok(html.includes(paragraph.slice(0, 60)), 'the first-run step drops one of the scope sentences')
  }
  assert.ok(html.includes(esc(ACCOUNT_SCOPE_LEAD)), 'the first-run notice lost its heading')
  assert.match(html, /no password reset/, 'the first-run step no longer warns that there is no reset')
})

test('the first-run step and the settings screen say the same thing about the account', () => {
  /* Two screens, one set of constants. If they ever drift, one of them is
     telling somebody something the other contradicts. */
  const step = setupAccountStepMarkup({ accountState: { available: true, signedIn: false }, mode: 'create' })
  const screen = formMarkup({ mode: 'create', state: { available: true, signedIn: false } })
  for (const paragraph of ACCOUNT_SCOPE_NOTICE) {
    const fragment = paragraph.slice(0, 60)
    assert.equal(step.includes(fragment), screen.includes(fragment),
      'the walkthrough and the sign-in screen disagree about what this account is')
  }
})

test('the walkthrough delegates its step to the tested builder, and the limit is stated', () => {
  /* WHAT THIS CAN AND CANNOT PROVE, said plainly rather than implied.
     src/views/setup.js imports three stylesheets and touches the DOM, so no
     test can render it. This asserts only that the step DELEGATES; a defect
     planted INSIDE that wrapper -- an early return with the delegation still
     below it -- would survive, because dead code matches a text search.
     Everything the builder renders is covered above; the wiring in setup.js is
     covered only by the packaged run driving the real window. That is a weaker
     guarantee and it is written down as one. */
  const code = stripComments(read('src/views/setup.js'))
  assert.ok(code.includes('setupAccountStepMarkup('), 'the walkthrough no longer paints through the tested builder')
  /* Matches an INPUT ELEMENT, not the attribute name: the walkthrough still
     reads its fields with querySelector('[data-setup-account-field=...]'), and
     banning the selector would ban the event handler that makes the step work.
     The first version of this line did exactly that. */
  const inline = code.match(/<input[^>]*data-setup-account-field/g) || []
  assert.deepEqual(inline, [],
    `the walkthrough has grown ${inline.length} account field(s) of its own that no test can render`)
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
