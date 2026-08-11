// THE PRODUCT ACCOUNT: is it actually an auth system, or does it just look
// like one?
//
// The owner ruled that a user login is a launch requirement, and an auth system
// is the one kind of code where "it works when I try it" is worth nothing. All
// three of the ways this can be quietly wrong are silent from the interface:
//
//   1. THE SECRET IS RECOVERABLE. A password stored in the clear, or reversibly,
//      or hashed at parameters cheap enough to brute force. Nothing on screen
//      changes; the failure only appears when the file is stolen.
//   2. IT FAILS OPEN. An unreadable, absent, corrupt, expired or superseded
//      piece of state resolving to SIGNED IN rather than signed out. This is the
//      exact mutant that survived a first mutation round on a peer lane -- an
//      unreadable preference resolving to "use judgement" instead of refusing --
//      so every failure path below is asserted individually rather than trusted
//      to a single happy-path test.
//   3. REVOCATION IS DECORATIVE. Signing out that only deletes a file, so a copy
//      of it taken beforehand still works. An expiry nothing ever checks.
//
// NO ASSERTION HERE COMPARES A SECRET. They assert shape, presence, absence and
// refusal codes. The one place a password value appears is where a test proves
// it is NOT in a file, which is the only honest way to check that.

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  LOCKOUT_MS,
  MAX_FAILED_ATTEMPTS,
  MIN_PASSWORD_LENGTH,
  PRINCIPAL_PREFIX,
  SCRYPT_PARAMETERS,
  UNAUTHENTICATED_PRINCIPAL,
  createAccountStore,
  decodeVerifier,
  normalizeUsername,
  verifyPassword,
} from '../../shell/product-account.cjs'

/* A fake keystore, so these run without Electron. It stands in for
   safeStorage's contract only, and it genuinely transforms the bytes rather
   than prefixing them -- so a test asserting the session is not readable on
   disk is testing THIS MODULE's encryption and not the fake's passthrough. */
function keystore({ available = true, corruptOnRead = false, failOnWrite = false } = {}) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: text => {
      if (failOnWrite) throw new Error('keystore refused')
      return Buffer.from(`enc:${Buffer.from(text, 'utf8').toString('base64')}`, 'utf8')
    },
    decryptString: buffer => {
      if (corruptOnRead) throw new Error('decryption failed')
      const stored = buffer.toString('utf8')
      if (!stored.startsWith('enc:')) throw new Error('not encrypted by this keystore')
      return Buffer.from(stored.slice(4), 'base64').toString('utf8')
    },
  }
}

function workspace(t) {
  const directory = mkdtempSync(join(tmpdir(), 'product-account-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}

const PASSWORD = 'correct horse battery staple'
const OTHER_PASSWORD = 'a different set of words entirely'

function store(directory, options = {}) {
  return createAccountStore({ safeStorage: keystore(options.keystore), directory, ...options.store })
}

async function withAccount(directory, options = {}) {
  const account = store(directory, options)
  const created = await account.createAccount({ username: 'josh', displayName: 'Josh P', password: PASSWORD })
  assert.equal(created.ok, true, 'the fixture account must be creatable')
  return account
}

/* ------------------------------ the secret ------------------------------ */

test('the password is not on disk, in any form, anywhere in the account directory', async (t) => {
  const directory = workspace(t)
  const account = await withAccount(directory)
  assert.equal((await account.signIn({ username: 'josh', password: PASSWORD })).ok, true)

  /* Every file the store touched, not just the one it is expected to write.
     A password leaking into a stray temp file is still a leak. */
  const files = readdirSync(directory)
  assert.ok(files.length > 0, 'the store must have written something')
  for (const name of files) {
    const bytes = readFileSync(join(directory, name))
    const text = bytes.toString('utf8')
    const base64 = bytes.toString('base64')
    assert.ok(!text.includes(PASSWORD), `${name} contains the password in the clear`)
    assert.ok(!text.includes(Buffer.from(PASSWORD, 'utf8').toString('base64')), `${name} contains the password base64-encoded`)
    assert.ok(!base64.includes(Buffer.from(PASSWORD, 'utf8').toString('base64')), `${name} contains the password base64-encoded`)
    /* A single word of it is enough to lose. */
    assert.ok(!text.includes('staple'), `${name} contains part of the password`)
  }
})

test('the stored verifier is scrypt at the shipped parameters, with a per-account random salt', async (t) => {
  const directory = workspace(t)
  const account = store(directory)
  assert.equal((await account.createAccount({ username: 'ann', password: PASSWORD })).ok, true)
  assert.equal((await account.createAccount({ username: 'bea', password: PASSWORD })).ok, true)

  const written = JSON.parse(readFileSync(account.accountsPath, 'utf8'))
  assert.equal(written.accounts.length, 2)

  const salts = new Set()
  for (const entry of written.accounts) {
    const decoded = decodeVerifier(entry.verifier)
    assert.ok(decoded, 'the verifier must be in the documented scrypt form')
    assert.equal(decoded.parameters.N, SCRYPT_PARAMETERS.N)
    assert.equal(decoded.parameters.r, SCRYPT_PARAMETERS.r)
    assert.equal(decoded.parameters.p, SCRYPT_PARAMETERS.p)
    assert.ok(decoded.salt.length >= 16, 'the salt must be at least 16 bytes')
    assert.equal(decoded.digest.length, SCRYPT_PARAMETERS.keyLength)
    salts.add(decoded.salt.toString('hex'))
  }
  /* Two accounts with the SAME password must not produce the same verifier.
     A shared or absent salt is what makes one cracked password crack every
     account at once, and it is invisible from the interface. */
  assert.equal(salts.size, 2, 'each account must have its own salt')
  assert.notEqual(written.accounts[0].verifier, written.accounts[1].verifier)
})

/* The cost is the security property. It is asserted as an exact value, not a
   floor, because a "tuning" commit that lowers it is a security change and must
   read as one in review rather than passing as a performance tweak.
   N=2^17, r=8, p=1 is the configuration OWASP lists first for scrypt. */
test('the shipped scrypt cost is the OWASP configuration and cannot be lowered silently', () => {
  assert.deepEqual({ ...SCRYPT_PARAMETERS }, { N: 131072, r: 8, p: 1, keyLength: 64 })
  assert.equal(SCRYPT_PARAMETERS.N, 2 ** 17)
  assert.ok(128 * SCRYPT_PARAMETERS.N * SCRYPT_PARAMETERS.r >= 128 * 1024 * 1024,
    'the memory cost must stay at or above 128 MiB')
})

test('no reply from any channel carries a password, a verifier, a salt or a token', async (t) => {
  const directory = workspace(t)
  const account = store(directory)

  const replies = [
    account.availability(),
    await account.createAccount({ username: 'josh', displayName: 'Josh P', password: PASSWORD }),
    await account.signIn({ username: 'josh', password: PASSWORD }),
    account.current(),
    await account.signIn({ username: 'josh', password: 'wrong wrong wrong wrong' }),
    await account.changePassword({ currentPassword: PASSWORD, newPassword: OTHER_PASSWORD }),
    account.signOut(),
    account.signOutEverywhere(),
  ]
  for (const reply of replies) {
    const encoded = JSON.stringify(reply)
    assert.ok(!encoded.includes(PASSWORD), `a reply carried the password: ${encoded}`)
    assert.ok(!encoded.includes(OTHER_PASSWORD), `a reply carried the new password: ${encoded}`)
    assert.ok(!encoded.includes('scrypt$'), `a reply carried the verifier: ${encoded}`)
    assert.ok(!/"(verifier|salt|token|digest|epoch)"/.test(encoded), `a reply carried an internal secret field: ${encoded}`)
  }
})

/* The defensive branch inside verifyPassword, exercised directly.
 *
 * In normal operation `readStore` refuses a malformed verifier long before this
 * function sees one, so a mutation that made it ADMIT on an unreadable verifier
 * survived the entire suite: the branch was real, the coverage was not. An
 * unreachable fail-open is a fail-open waiting for the guard in front of it to
 * be changed by somebody who does not know it was load-bearing. */
test('an unreadable verifier is never a match, whatever the password', async () => {
  for (const stored of [
    undefined, null, 42, '', 'nonsense', 'scrypt$', 'scrypt$N=1$$', 'bcrypt$N=131072,r=8,p=1$c2FsdA==$ZGlnZXN0',
    'scrypt$N=0,r=8,p=1$c2FsdA==$ZGlnZXN0', 'scrypt$N=131072,r=8,p=1$c2E=$ZGln',
  ]) {
    assert.equal(await verifyPassword(PASSWORD, stored), false,
      `an unreadable verifier (${JSON.stringify(stored)}) must never verify`)
    assert.equal(await verifyPassword('', stored), false)
  }
})

test('a well-formed verifier matches its own password and nothing else', async (t) => {
  const directory = workspace(t)
  const account = await withAccount(directory)
  const stored = JSON.parse(readFileSync(account.accountsPath, 'utf8')).accounts[0].verifier
  assert.equal(await verifyPassword(PASSWORD, stored), true)
  assert.equal(await verifyPassword(OTHER_PASSWORD, stored), false)
  assert.equal(await verifyPassword(`${PASSWORD} `, stored), false, 'a trailing space is a different password')
})

/* ---------------------- create, sign in, out, again ---------------------- */

test('a person can create an account, sign in, and be named by the principal', async (t) => {
  const directory = workspace(t)
  const account = store(directory)

  assert.equal(account.principal(), UNAUTHENTICATED_PRINCIPAL)
  assert.equal(account.current().signedIn, false)

  const created = await account.createAccount({ username: 'Josh', displayName: 'Josh P', password: PASSWORD })
  assert.equal(created.ok, true)
  assert.equal(created.account.username, 'josh', 'the username is normalized to lower case')

  /* Creating does NOT sign anyone in. The two are separate actions, so an
     account file appearing on disk can never by itself produce a signed-in
     user. */
  assert.equal(account.principal(), UNAUTHENTICATED_PRINCIPAL)

  const signedIn = await account.signIn({ username: 'JOSH', password: PASSWORD })
  assert.equal(signedIn.ok, true)
  assert.equal(signedIn.persisted, true)

  const state = account.current()
  assert.equal(state.signedIn, true)
  assert.equal(state.account.displayName, 'Josh P')
  assert.match(state.principal, new RegExp(`^${PRINCIPAL_PREFIX}[0-9a-f]{32}$`))
  assert.equal(account.principal(), state.principal)
})

test('the sign-in survives a relaunch, and signing out ends it', async (t) => {
  const directory = workspace(t)
  const first = await withAccount(directory)
  const signedIn = await first.signIn({ username: 'josh', password: PASSWORD })
  assert.equal(signedIn.ok, true)
  const principal = first.principal()

  /* A SECOND STORE over the same directory is what a relaunch is: new process,
     new in-memory state, same files. */
  const relaunched = store(directory)
  assert.equal(relaunched.current().signedIn, true)
  assert.equal(relaunched.principal(), principal, 'the same person must be named after a relaunch')

  relaunched.signOut()
  assert.equal(relaunched.principal(), UNAUTHENTICATED_PRINCIPAL)

  const afterSignOut = store(directory)
  assert.equal(afterSignOut.current().signedIn, false)
  assert.equal(afterSignOut.principal(), UNAUTHENTICATED_PRINCIPAL)
})

test('the persisted session is encrypted, not readable JSON on disk', async (t) => {
  const directory = workspace(t)
  const account = await withAccount(directory)
  assert.equal((await account.signIn({ username: 'josh', password: PASSWORD })).ok, true)

  const raw = readFileSync(account.sessionPath, 'utf8')
  assert.match(raw, /^enc:/, 'the session must go through the keystore')
  assert.ok(!raw.includes('accountId'), 'the session must not be readable as plain JSON')
  assert.ok(!raw.includes('sessionId'), 'the session must not be readable as plain JSON')
})

/* ------------------------------ fails closed ------------------------------ */
//
// Each of these plants ONE broken thing and asserts the answer is SIGNED OUT.
// They are separate tests on purpose: a single test covering all of them can be
// satisfied by a single early return, which is exactly the shape that hides a
// fail-open branch behind a fail-closed one.

test('fails closed: a session file that cannot be decrypted', async (t) => {
  const directory = workspace(t)
  const account = await withAccount(directory)
  assert.equal((await account.signIn({ username: 'josh', password: PASSWORD })).ok, true)

  const broken = createAccountStore({ safeStorage: keystore({ corruptOnRead: true }), directory })
  assert.equal(broken.current().signedIn, false)
  assert.equal(broken.principal(), UNAUTHENTICATED_PRINCIPAL)
})

test('fails closed: a session file of garbage bytes', async (t) => {
  const directory = workspace(t)
  const account = await withAccount(directory)
  assert.equal((await account.signIn({ username: 'josh', password: PASSWORD })).ok, true)

  writeFileSync(account.sessionPath, Buffer.from('not encrypted by anything'))
  assert.equal(store(directory).principal(), UNAUTHENTICATED_PRINCIPAL)
})

test('fails closed: a session file that decrypts to a valid-looking but wrong shape', async (t) => {
  const directory = workspace(t)
  const account = await withAccount(directory)
  assert.equal((await account.signIn({ username: 'josh', password: PASSWORD })).ok, true)

  /* Encrypted correctly by the same keystore, so decryption SUCCEEDS -- the
     refusal has to come from validating the contents, which is the check most
     easily left out. */
  const forged = keystore().encryptString(JSON.stringify({
    sessionId: 'f'.repeat(32),
    accountId: 'a'.repeat(32),
    issuedAtMs: Date.now(),
    expiresAtMs: Date.now() + 86_400_000,
    epoch: 1,
  }))
  writeFileSync(account.sessionPath, forged)
  assert.equal(store(directory).principal(), UNAUTHENTICATED_PRINCIPAL,
    'a session naming an account that does not exist must not sign anyone in')
})

test('fails closed: an expired session', async (t) => {
  const directory = workspace(t)
  const account = await withAccount(directory, { store: { sessionLifetimeMs: 1000 } })
  assert.equal((await account.signIn({ username: 'josh', password: PASSWORD })).ok, true)
  assert.equal(account.current().signedIn, true)

  /* Time moves, nothing else does. */
  let clock = Date.now() + 60_000
  const later = createAccountStore({ safeStorage: keystore(), directory, now: () => clock })
  assert.equal(later.current().signedIn, false)
  assert.equal(later.principal(), UNAUTHENTICATED_PRINCIPAL)
})

test('fails closed: a session that expires while the window is still open', async (t) => {
  const directory = workspace(t)
  let clock = Date.now()
  const account = createAccountStore({ safeStorage: keystore(), directory, now: () => clock, sessionLifetimeMs: 60_000 })
  assert.equal((await account.createAccount({ username: 'josh', password: PASSWORD })).ok, true)
  assert.equal((await account.signIn({ username: 'josh', password: PASSWORD })).ok, true)
  assert.equal(account.current().signedIn, true)

  /* The same live store, no relaunch. An expiry only checked at startup is an
     expiry a long-running window never reaches. */
  clock += 120_000
  assert.equal(account.current().signedIn, false)
  assert.equal(account.principal(), UNAUTHENTICATED_PRINCIPAL)
})

test('fails closed: an unreadable account file refuses rather than offering a fresh start', async (t) => {
  const directory = workspace(t)
  const account = await withAccount(directory)
  writeFileSync(account.accountsPath, '{ this is not json')

  const damaged = store(directory)
  const availability = damaged.availability()
  assert.equal(availability.ok, false)
  assert.equal(availability.code, 'ACCOUNT_STORE_CORRUPT')
  assert.equal(damaged.current().signedIn, false)
  assert.equal(damaged.principal(), UNAUTHENTICATED_PRINCIPAL)

  /* And it must not quietly let a new account be written over the one it could
     not read. */
  const created = await damaged.createAccount({ username: 'someone', password: PASSWORD })
  assert.equal(created.ok, false)
  assert.equal(created.code, 'ACCOUNT_STORE_CORRUPT')
})

test('fails closed: an account file whose entry is missing its verifier', async (t) => {
  const directory = workspace(t)
  const account = await withAccount(directory)
  const written = JSON.parse(readFileSync(account.accountsPath, 'utf8'))
  delete written.accounts[0].verifier
  writeFileSync(account.accountsPath, JSON.stringify(written))

  const damaged = store(directory)
  assert.equal(damaged.availability().ok, false)
  assert.equal(damaged.principal(), UNAUTHENTICATED_PRINCIPAL)
  /* An entry with no verifier must never be signable-into with any password. */
  const attempt = await damaged.signIn({ username: 'josh', password: PASSWORD })
  assert.equal(attempt.ok, false)
})

test('fails closed: no keystore means signed out after relaunch, not signed in', async (t) => {
  const directory = workspace(t)
  const account = createAccountStore({ safeStorage: keystore({ available: false }), directory })
  assert.equal((await account.createAccount({ username: 'josh', password: PASSWORD })).ok, true)

  const availability = account.availability()
  assert.equal(availability.ok, true, 'a missing keystore must not make the product unusable')
  assert.equal(availability.canPersistSession, false, 'and it must say so rather than pretend')

  const signedIn = await account.signIn({ username: 'josh', password: PASSWORD })
  assert.equal(signedIn.ok, true, 'sign-in still works for this run')
  assert.equal(signedIn.persisted, false, 'and reports that it will not survive a relaunch')
  assert.equal(account.current().signedIn, true)

  const relaunched = createAccountStore({ safeStorage: keystore({ available: false }), directory })
  assert.equal(relaunched.principal(), UNAUTHENTICATED_PRINCIPAL)
})

test('fails closed: a store with no safeStorage at all', async (t) => {
  const directory = workspace(t)
  const account = createAccountStore({ safeStorage: undefined, directory })
  assert.equal(account.availability().canPersistSession, false)
  assert.equal(account.principal(), UNAUTHENTICATED_PRINCIPAL)
  assert.equal((await account.createAccount({ username: 'josh', password: PASSWORD })).ok, true)
  assert.equal((await account.signIn({ username: 'josh', password: PASSWORD })).ok, true)
  assert.equal(account.current().signedIn, true, 'this run signs in')
  assert.equal(createAccountStore({ safeStorage: undefined, directory }).principal(), UNAUTHENTICATED_PRINCIPAL)
})

/* ------------------------------- revocation ------------------------------- */

test('signing out everywhere refuses a session file copied beforehand', async (t) => {
  const directory = workspace(t)
  const account = await withAccount(directory)
  assert.equal((await account.signIn({ username: 'josh', password: PASSWORD })).ok, true)

  /* The backup a real attacker takes: the exact bytes, while they were valid. */
  const stolen = readFileSync(account.sessionPath)

  const revoked = account.signOutEverywhere()
  assert.equal(revoked.ok, true)
  assert.equal(revoked.revoked, true)

  writeFileSync(account.sessionPath, stolen)
  const replayed = store(directory)
  assert.equal(replayed.current().signedIn, false, 'a revoked session must not be replayable')
  assert.equal(replayed.principal(), UNAUTHENTICATED_PRINCIPAL)
})

test('changing the password ends every session and only the new password works', async (t) => {
  const directory = workspace(t)
  const account = await withAccount(directory)
  assert.equal((await account.signIn({ username: 'josh', password: PASSWORD })).ok, true)
  const stolen = readFileSync(account.sessionPath)

  const wrongCurrent = await account.changePassword({ currentPassword: 'not the password', newPassword: OTHER_PASSWORD })
  assert.equal(wrongCurrent.ok, false)
  assert.equal(wrongCurrent.code, 'ACCOUNT_CREDENTIALS_REJECTED')
  assert.equal(account.current().signedIn, true, 'a refused change must not sign anyone out')

  const changed = await account.changePassword({ currentPassword: PASSWORD, newPassword: OTHER_PASSWORD })
  assert.equal(changed.ok, true)
  assert.equal(changed.signedOut, true)
  assert.equal(account.principal(), UNAUTHENTICATED_PRINCIPAL, 'changing the password signs this window out')

  writeFileSync(account.sessionPath, stolen)
  assert.equal(store(directory).principal(), UNAUTHENTICATED_PRINCIPAL,
    'a session from before the password change must not be replayable')

  assert.equal((await account.signIn({ username: 'josh', password: PASSWORD })).ok, false, 'the old password must stop working')
  assert.equal((await account.signIn({ username: 'josh', password: OTHER_PASSWORD })).ok, true, 'the new password must work')
})

test('changing the password requires being signed in', async (t) => {
  const directory = workspace(t)
  const account = await withAccount(directory)
  const refused = await account.changePassword({ currentPassword: PASSWORD, newPassword: OTHER_PASSWORD })
  assert.equal(refused.ok, false)
  assert.equal(refused.code, 'ACCOUNT_NOT_SIGNED_IN')
})

/* ------------------------------- refusals ------------------------------- */

test('a wrong password and an unknown username are indistinguishable', async (t) => {
  const directory = workspace(t)
  const account = await withAccount(directory)

  const wrongPassword = await account.signIn({ username: 'josh', password: 'wrong wrong wrong wrong' })
  const noSuchUser = await account.signIn({ username: 'nobody', password: 'wrong wrong wrong wrong' })

  /* Identical code AND identical wording. Two different messages enumerate the
     account list to anyone willing to read them. */
  assert.equal(wrongPassword.ok, false)
  assert.equal(wrongPassword.code, 'ACCOUNT_CREDENTIALS_REJECTED')
  assert.equal(noSuchUser.code, wrongPassword.code)
  assert.equal(noSuchUser.reason, wrongPassword.reason)
  assert.ok(!wrongPassword.reason.includes('josh'), 'the refusal must not confirm the username exists')
})

/* Identical WORDING is not enough on its own. If an unknown username returns in
   microseconds while a wrong password takes about a second, the account list is
   enumerable with a stopwatch regardless of what the message says -- and no
   assertion on the message can see that.

   The bound is a floor, not a comparison between the two timings. A test that
   asserted the two durations were close would be flaky on a loaded machine; a
   floor is not, because the only way to come in under it is to skip the
   derivation entirely, which is exactly the defect. The real work is ~450ms
   here, so 100ms is far below the true cost and far above any code path that
   does not hash. */
test('an unknown username costs the same work as a real one, so the account list is not enumerable', async (t) => {
  const directory = workspace(t)
  const account = await withAccount(directory)

  const started = process.hrtime.bigint()
  const unknown = await account.signIn({ username: 'nobodyhere', password: 'wrong wrong wrong wrong' })
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6

  assert.equal(unknown.code, 'ACCOUNT_CREDENTIALS_REJECTED')
  assert.ok(elapsedMs >= 100,
    `an unknown username answered in ${elapsedMs.toFixed(1)}ms, fast enough to distinguish it from a real one`)
})

test('a malformed sign-in request also costs the work, rather than returning instantly', async (t) => {
  const directory = workspace(t)
  const account = await withAccount(directory)
  const started = process.hrtime.bigint()
  const refused = await account.signIn({ username: 'josh', password: null })
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6
  assert.equal(refused.code, 'ACCOUNT_CREDENTIALS_REJECTED')
  assert.ok(elapsedMs >= 100, `a malformed request answered in ${elapsedMs.toFixed(1)}ms`)
})

test('repeated wrong passwords lock the account, and the lock survives a relaunch', async (t) => {
  const directory = workspace(t)
  let clock = Date.now()
  const account = createAccountStore({ safeStorage: keystore(), directory, now: () => clock })
  assert.equal((await account.createAccount({ username: 'josh', password: PASSWORD })).ok, true)

  for (let attempt = 1; attempt < MAX_FAILED_ATTEMPTS; attempt += 1) {
    const result = await account.signIn({ username: 'josh', password: 'wrong wrong wrong wrong' })
    assert.equal(result.code, 'ACCOUNT_CREDENTIALS_REJECTED', `attempt ${attempt} should not lock yet`)
  }
  const locked = await account.signIn({ username: 'josh', password: 'wrong wrong wrong wrong' })
  assert.equal(locked.code, 'ACCOUNT_LOCKED')

  /* THE RIGHT password is refused while locked, or the lock buys nothing. */
  const whileLocked = await account.signIn({ username: 'josh', password: PASSWORD })
  assert.equal(whileLocked.code, 'ACCOUNT_LOCKED')

  /* A new process must not clear it -- otherwise the lock is bypassed by
     closing the window. */
  const relaunched = createAccountStore({ safeStorage: keystore(), directory, now: () => clock })
  assert.equal((await relaunched.signIn({ username: 'josh', password: PASSWORD })).code, 'ACCOUNT_LOCKED')

  clock += LOCKOUT_MS + 1000
  const afterWait = createAccountStore({ safeStorage: keystore(), directory, now: () => clock })
  assert.equal((await afterWait.signIn({ username: 'josh', password: PASSWORD })).ok, true, 'the lock must expire')
})

test('a successful sign-in clears the failed-attempt count', async (t) => {
  const directory = workspace(t)
  const account = await withAccount(directory)
  for (let attempt = 0; attempt < MAX_FAILED_ATTEMPTS - 1; attempt += 1) {
    await account.signIn({ username: 'josh', password: 'wrong wrong wrong wrong' })
  }
  assert.equal((await account.signIn({ username: 'josh', password: PASSWORD })).ok, true)
  /* If the counter had not been cleared, this run of wrong attempts would lock. */
  for (let attempt = 0; attempt < MAX_FAILED_ATTEMPTS - 1; attempt += 1) {
    const result = await account.signIn({ username: 'josh', password: 'wrong wrong wrong wrong' })
    assert.equal(result.code, 'ACCOUNT_CREDENTIALS_REJECTED')
  }
})

test('the password rules are enforced where they can be, and stated as they are', async (t) => {
  const directory = workspace(t)
  const account = store(directory)

  const short = await account.createAccount({ username: 'josh', password: 'a'.repeat(MIN_PASSWORD_LENGTH - 1) })
  assert.equal(short.code, 'ACCOUNT_PASSWORD_TOO_SHORT')

  const long = await account.createAccount({ username: 'josh', password: 'a'.repeat(5000) })
  assert.equal(long.code, 'ACCOUNT_PASSWORD_TOO_LONG')

  const common = await account.createAccount({ username: 'josh', password: 'PasswordPassword' })
  assert.equal(common.code, 'ACCOUNT_PASSWORD_COMMON', 'the screen must be case-insensitive')

  const sameAsName = await account.createAccount({ username: 'josharchibald', password: 'josharchibald' })
  assert.equal(sameAsName.code, 'ACCOUNT_PASSWORD_IS_USERNAME')

  const blank = await account.createAccount({ username: 'josh', password: '            ' })
  assert.equal(blank.code, 'ACCOUNT_PASSWORD_BLANK')

  /* Nothing was written by any of those. */
  assert.equal(account.availability().accountCount, 0)
})

test('usernames are bounded, normalized, unique, and free of confusables', async (t) => {
  assert.equal(normalizeUsername('  JoSh  '), 'josh')
  assert.equal(normalizeUsername('a.b_c-d'), 'a.b_c-d')
  assert.equal(normalizeUsername('ab'), null, 'too short')
  assert.equal(normalizeUsername('a'.repeat(65)), null, 'too long')
  assert.equal(normalizeUsername('.leading'), null)
  assert.equal(normalizeUsername('trailing.'), null)
  assert.equal(normalizeUsername('has space'), null)
  assert.equal(normalizeUsername('раssword'), null, 'Cyrillic look-alikes must be refused')
  assert.equal(normalizeUsername('josh\n'), 'josh')
  assert.equal(normalizeUsername(null), null)
  assert.equal(normalizeUsername(123), null)

  const directory = workspace(t)
  const account = store(directory)
  assert.equal((await account.createAccount({ username: 'josh', password: PASSWORD })).ok, true)
  const duplicate = await account.createAccount({ username: 'JOSH', password: OTHER_PASSWORD })
  assert.equal(duplicate.code, 'ACCOUNT_USERNAME_TAKEN', 'case must not create a second account')
})

test('a display name cannot smuggle control characters into the interface', async (t) => {
  const directory = workspace(t)
  const account = store(directory)
  /* Escapes, not literal characters: a test file containing a real bidi
     override displays its own source misleadingly, which is the attack. */
  const hostile = 'Josh\u202e gnihtemos\u0000\r\n\u200b '
  const created = await account.createAccount({ username: 'josh', displayName: hostile, password: PASSWORD })
  assert.equal(created.ok, true)
  const name = created.account.displayName
  assert.ok(!/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/.test(name),
    'control, zero-width and bidi characters must be stripped from a display name')
  assert.equal(name, 'Josh gnihtemos')

  /* And the stripped name is what is stored and read back, not just what the
     create call returned. */
  assert.equal((await account.signIn({ username: 'josh', password: PASSWORD })).ok, true)
  assert.equal(account.current().account.displayName, 'Josh gnihtemos')
})

/* The product's own source must not contain what it strips from user input.
   An invisible bidi override in a reviewed file is a known supply-chain trick:
   the reviewer reads one order of statements and the compiler reads another. */
test('the account source files contain no invisible control or bidi characters', () => {
  for (const relative of ['shell/product-account.cjs', 'src/account-state.js', 'src/views/account.js']) {
    const source = readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8')
    const found = [...source].filter(character => /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/.test(character))
    assert.equal(found.length, 0,
      `${relative} contains ${found.length} invisible character(s): ${found.map(c => `U+${c.codePointAt(0).toString(16).padStart(4, '0')}`).join(', ')}`)
  }
})

test('an empty display name falls back to the username rather than to nothing', async (t) => {
  const directory = workspace(t)
  const account = store(directory)
  assert.equal((await account.createAccount({ username: 'josh', displayName: '   ', password: PASSWORD })).ok, true)
  assert.equal((await account.signIn({ username: 'josh', password: PASSWORD })).ok, true)
  assert.equal(account.current().account.displayName, 'josh')
})

test('signing out when nobody is signed in is a no-op that still reports success', async (t) => {
  const directory = workspace(t)
  const account = await withAccount(directory)
  assert.equal(account.signOut().ok, true)
  const everywhere = account.signOutEverywhere()
  assert.equal(everywhere.ok, true)
  assert.equal(everywhere.revoked, false)
  assert.equal(account.principal(), UNAUTHENTICATED_PRINCIPAL)
})

test('the principal is always a bounded non-empty string the spawn record accepts', async (t) => {
  const directory = workspace(t)
  const account = await withAccount(directory)

  for (const value of [account.principal(), (await account.signIn({ username: 'josh', password: PASSWORD })) && account.principal()]) {
    assert.equal(typeof value, 'string')
    assert.ok(value.length > 0 && value.length <= 200,
      'shell/spawn-record.cjs refuses a principal outside 1..200 characters')
  }
  assert.equal(UNAUTHENTICATED_PRINCIPAL, 'unauthenticated')
})
