'use strict'

/* THE PRODUCT ACCOUNT: who is using this installation.
 *
 * WHAT THIS IS. An account for this product, held entirely on this computer. A
 * person creates one, signs in, and stays signed in across relaunches until
 * they sign out or the session expires. Its whole job is to turn "a session
 * started on this device" into "this person started it", which is the sentence
 * shell/spawn-record.cjs could not previously write.
 *
 * WHAT THIS IS EMPHATICALLY NOT, and the distinction is a terms condition and
 * not a stylistic one: it is NOT a login to the user's Anthropic, OpenAI or
 * Google account, and it must never be presented as one or accept those
 * credentials. docs/design/SHIPMENT-PLAN.md blocker B14 records that taking a
 * Claude subscription login inside a third-party product is barred by provider
 * terms, and src/lib/setup/provider-auth.js in the engine already refuses to
 * build that form. Provider credentials stay in the provider CLIs, where the
 * provider put them. This file never reads them, never stores them, and never
 * asks for them.
 *
 * WHY LOCAL AND NOT HOSTED. A hosted identity service would mean a server, an
 * uptime obligation, and a database of other people's email addresses and
 * password hashes -- a data-protection surface that does not exist today.
 * docs/design/LAUNCH-PURCHASES.md records hosting at $0 precisely because
 * everything shipped is static, and it warns against adding a hosting line
 * "until there is an actual server". A local account needs no server, so that
 * $0 stays true and no new purchase is created. The cost of that choice is
 * stated plainly to the user rather than hidden: see WHAT IT DOES NOT PROVE.
 *
 * WHAT IT DOES NOT PROVE. The verifier lives on the same computer as the person
 * typing the password, so anyone who is already this Windows user can delete the
 * account file and make a new account. This is an ATTRIBUTION record among the
 * people who share a machine and a deliberate, revocable gate on the product's
 * own surfaces -- it is not an attestation to a remote party, and nothing here
 * may be described as if it were. shell/spawn-record.cjs states the same limit
 * about its own ledger, for the same reason.
 *
 * HOW THE SECRET IS HELD. The password is never stored, never logged, and never
 * leaves the main process. Only a scrypt verifier is written, with a per-account
 * 16-byte random salt, at the parameters OWASP names first for scrypt
 * (N=2^17, r=8, p=1). Verification is constant-time. A sign-in attempt against a
 * username that does not exist still performs the full derivation, so the reply
 * time does not disclose which usernames are real.
 *
 * HOW THE SESSION IS HELD. There is no bearer token, because there is nothing to
 * bear it to: the authoritative session lives in this process's memory and the
 * renderer only ever asks who it is. What persists across relaunch is one
 * record, encrypted by the OS keystore (Electron safeStorage -> DPAPI), so it is
 * bound to this Windows user and is not readable as plain bytes on disk. It
 * carries an absolute expiry and an epoch. Signing out deletes it; signing out
 * everywhere, or changing a password, advances the account's epoch so that any
 * copy of the file taken beforehand is refused rather than replayed.
 *
 * FAIL CLOSED, EVERYWHERE. Absent, unreadable, corrupt, expired, superseded, or
 * pointing at an account that no longer exists all resolve to SIGNED OUT. There
 * is no branch in this file on which an unreadable byte produces a signed-in
 * user. That is the specific mutant this module is tested against.
 *
 * Every dependency is injected so this is testable without Electron.
 */

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ACCOUNTS_FILE = 'product-accounts.json'
const SESSION_FILE = 'product-session.enc'
const STORE_VERSION = 1

/* OWASP Password Storage Cheat Sheet's first-listed scrypt configuration
   (N=2^17, r=8, p=1). Memory is 128*N*r = 134 MB, which is the point: it is
   what makes a stolen verifier expensive to attack offline. `maxmem` must be
   raised explicitly because Node's default cap is 32 MB and scrypt throws
   rather than quietly weakening itself.

   These are exported and asserted by the test suite. Weakening them is a
   security change, so it must fail a test rather than pass review as a tuning
   tweak. */
const SCRYPT_PARAMETERS = Object.freeze({ N: 131072, r: 8, p: 1, keyLength: 64 })
const SCRYPT_MAXMEM = 320 * 1024 * 1024
const SALT_BYTES = 16
const VERIFIER_SCHEME = 'scrypt'

const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000

const MIN_PASSWORD_LENGTH = 12
/* Bounded because the password is an untrusted input to a deliberately
   expensive function. Without a ceiling, a long string is a local denial of
   service against the process that must hash it. */
const MAX_PASSWORD_LENGTH = 200
const MIN_USERNAME_LENGTH = 3
const MAX_USERNAME_LENGTH = 64
const MAX_DISPLAY_NAME_LENGTH = 64
const MAX_ACCOUNTS = 16
const MAX_STORE_BYTES = 256 * 1024

/* scrypt already costs about a second, which is itself a rate limit. The
   lockout exists for the case that cost does not cover: an unattended machine
   and someone with time. It is per-account and it is recorded, so it cannot be
   cleared by closing the window. */
const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_MS = 15 * 60 * 1000

/* The principal written to the spawn ledger when nobody is signed in.
 *
 * It is a stated word rather than `null` ON PURPOSE. Before an account system
 * existed, `null` meant "this product cannot know who this was". It now would
 * mean either that or "somebody chose not to sign in", and a record whose one
 * identity field is ambiguous between a capability gap and a user action is
 * worse than one that says which. */
const UNAUTHENTICATED_PRINCIPAL = 'unauthenticated'
const PRINCIPAL_PREFIX = 'account:'

/* The one signed-out answer, built once.
 *
 * Every refusal path in `current()` returns THIS rather than composing its own
 * object. Hand-written duplicates drift: one of six would eventually be written
 * with `signedIn: false` and no `principal`, and the spawn record would then
 * take `undefined` as the identity of whoever started an agent. */
const SIGNED_OUT_STATE = Object.freeze({
  signedIn: false,
  principal: UNAUTHENTICATED_PRINCIPAL,
  account: null,
})

/* Rejected outright, and NOT presented as a strength meter. NIST SP 800-63B
   discourages composition rules and encourages screening against known-common
   secrets; this is a deliberately short list of the passwords that a local
   attacker guesses first, not a breach corpus, and the UI says so rather than
   implying screening it does not do. */
const REFUSED_PASSWORDS = Object.freeze([
  '123456789012', '111111111111', '000000000000', '123456123456',
  'password1234', 'passwordpassword', 'qwertyqwerty', 'qwerty123456',
  'letmein12345', 'iloveyou1234', 'adminadmin12', 'welcome12345',
  /* The product's own on-screen name is here because people reach for it, and
     it is exactly MIN_PASSWORD_LENGTH characters, so length alone will not
     refuse it. The product and the COMPANY are now the same word, so this one
     entry covers both -- it used to be 'missioncontrol', and the company name
     had to be left out because tools/test/chat-agent-bridge-gated.test.mjs
     forbade it anywhere under src/ or shell/. That clause was written when
     "ToolsEnabled" was only an internal tree name; it is the shipped product
     name now, and the gate has been narrowed to the internal-path forms it was
     always aiming at. */
  'toolsenabled', 'abcdefghijkl', 'aaaaaaaaaaaa',
])

class AccountError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'AccountError'
    this.code = code
  }
}

function refusal(code, reason) {
  return Object.freeze({ ok: false, code, reason })
}

function scryptDerive(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      Buffer.from(password, 'utf8'),
      salt,
      SCRYPT_PARAMETERS.keyLength,
      { N: SCRYPT_PARAMETERS.N, r: SCRYPT_PARAMETERS.r, p: SCRYPT_PARAMETERS.p, maxmem: SCRYPT_MAXMEM },
      (error, derived) => { if (error) reject(error); else resolve(derived) },
    )
  })
}

/* The stored form carries its own parameters. A verifier that only recorded the
   digest could never be re-read after the cost is raised, which is how a product
   ends up unable to strengthen its hashing without locking everyone out. */
function encodeVerifier(salt, derived) {
  return [
    VERIFIER_SCHEME,
    `N=${SCRYPT_PARAMETERS.N},r=${SCRYPT_PARAMETERS.r},p=${SCRYPT_PARAMETERS.p}`,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$')
}

function decodeVerifier(value) {
  if (typeof value !== 'string') return null
  const parts = value.split('$')
  if (parts.length !== 4 || parts[0] !== VERIFIER_SCHEME) return null
  const parameters = {}
  for (const pair of parts[1].split(',')) {
    const [key, raw] = pair.split('=')
    const number = Number(raw)
    if (!Number.isSafeInteger(number) || number < 1) return null
    parameters[key] = number
  }
  if (!parameters.N || !parameters.r || !parameters.p) return null
  let salt
  let digest
  try {
    salt = Buffer.from(parts[2], 'base64')
    digest = Buffer.from(parts[3], 'base64')
  } catch { return null }
  if (salt.length < 8 || digest.length < 16) return null
  return { parameters, salt, digest }
}

async function verifyPassword(password, stored) {
  const decoded = decodeVerifier(stored)
  if (!decoded) return false
  let derived
  try {
    derived = await new Promise((resolve, reject) => {
      crypto.scrypt(
        Buffer.from(password, 'utf8'),
        decoded.salt,
        decoded.digest.length,
        { N: decoded.parameters.N, r: decoded.parameters.r, p: decoded.parameters.p, maxmem: SCRYPT_MAXMEM },
        (error, value) => { if (error) reject(error); else resolve(value) },
      )
    })
  } catch { return false }
  if (derived.length !== decoded.digest.length) return false
  return crypto.timingSafeEqual(derived, decoded.digest)
}

/* Spends the same work on a username that does not exist as on one that does.
   Without it, "no such account" returns in microseconds and "wrong password"
   returns in about a second, which enumerates the account list to anyone with a
   stopwatch. */
async function burnEquivalentWork() {
  try {
    await scryptDerive('\u0000decoy', crypto.randomBytes(SALT_BYTES))
  } catch { /* the decoy's only job is to spend time */ }
}

function writeFileDurable(filePath, contents, mode = 0o600) {
  /* Written to a sibling and renamed, so a crash mid-write leaves the previous
     file intact rather than a truncated one. A half-written account store reads
     as corrupt, and corrupt is refused -- which would lock a person out of
     their own product because the power went out. */
  const temporary = `${filePath}.tmp-${crypto.randomBytes(6).toString('hex')}`
  const handle = fs.openSync(temporary, 'w', mode)
  try {
    fs.writeFileSync(handle, contents)
    fs.fsyncSync(handle)
  } finally {
    fs.closeSync(handle)
  }
  fs.renameSync(temporary, filePath)
}

function normalizeUsername(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  if (trimmed.length < MIN_USERNAME_LENGTH || trimmed.length > MAX_USERNAME_LENGTH) return null
  /* ASCII only, and deliberately. A username is the thing two people compare to
     decide whether they are looking at the same person; Unicode confusables
     make two different strings look identical on screen, which is an
     impersonation primitive in an attribution record. */
  if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(trimmed)) return null
  return trimmed
}

function normalizeDisplayName(value, fallback) {
  if (typeof value !== 'string') return fallback
  /* Control characters, zero-width characters and bidi overrides are stripped
     rather than escaped. This string is shown in the interface and written into
     no markup by this file, but a name carrying a newline reads as two lines,
     and a name carrying U+202E reads right-to-left -- so "josh<RLO>nimda" can be
     displayed as if it said something else. In an attribution record, a name
     that renders as a different name is an impersonation primitive.

     WRITTEN AS ESCAPES, NEVER AS THE CHARACTERS THEMSELVES. An earlier version
     of this line contained the literal characters, which made this file read as
     binary to grep and put an invisible bidi override into the product's own
     source -- the precise trick the check exists to defeat. */
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .trim()
  if (!cleaned) return fallback
  return cleaned.slice(0, MAX_DISPLAY_NAME_LENGTH)
}

function passwordRefusal(password, username) {
  if (typeof password !== 'string' || password.length === 0) {
    return refusal('ACCOUNT_PASSWORD_MISSING', 'Enter a password.')
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return refusal(
      'ACCOUNT_PASSWORD_TOO_SHORT',
      `Use at least ${MIN_PASSWORD_LENGTH} characters. Length is what makes a password hard to guess; mixing in symbols is not required.`,
    )
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return refusal('ACCOUNT_PASSWORD_TOO_LONG', `Use at most ${MAX_PASSWORD_LENGTH} characters.`)
  }
  if (password.trim().length === 0) {
    return refusal('ACCOUNT_PASSWORD_BLANK', 'A password of only spaces is not accepted.')
  }
  const folded = password.toLowerCase()
  if (REFUSED_PASSWORDS.includes(folded)) {
    return refusal('ACCOUNT_PASSWORD_COMMON', 'That is one of the first passwords anyone would try. Choose another.')
  }
  if (username && folded === username.toLowerCase()) {
    return refusal('ACCOUNT_PASSWORD_IS_USERNAME', 'The password cannot be the same as the username.')
  }
  return null
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Create the account store.
 *
 * `safeStorage` is required for SESSION PERSISTENCE only. A build where the OS
 * keystore is unavailable can still create accounts and sign in -- it simply
 * cannot carry the session across a relaunch, and says so, rather than either
 * refusing to work or writing a bearer record in the clear.
 */
function createAccountStore({
  safeStorage,
  directory,
  now = () => Date.now(),
  sessionLifetimeMs = SESSION_LIFETIME_MS,
} = {}) {
  if (typeof directory !== 'string' || directory.length === 0) {
    throw new AccountError('ACCOUNT_NO_DIRECTORY', 'An account directory is required')
  }
  if (!Number.isSafeInteger(sessionLifetimeMs) || sessionLifetimeMs < 1) {
    throw new AccountError('ACCOUNT_BAD_LIFETIME', 'The session lifetime must be a positive whole number of milliseconds')
  }

  const accountsPath = path.join(directory, ACCOUNTS_FILE)
  const sessionPath = path.join(directory, SESSION_FILE)

  /* The one piece of authoritative signed-in state. It is in memory, in the
     main process, and it is never assigned from anything the renderer sends. */
  let activeSession = null
  let sessionRestored = false

  function keystoreAvailable() {
    try {
      return Boolean(safeStorage) && typeof safeStorage.isEncryptionAvailable === 'function'
        && safeStorage.isEncryptionAvailable() === true
    } catch { return false }
  }

  /* ---------------------------- the account file ---------------------------- */

  function emptyStore() {
    return { version: STORE_VERSION, accounts: [] }
  }

  function validateAccount(value) {
    if (!isPlainObject(value)) return null
    if (typeof value.id !== 'string' || !/^[0-9a-f]{32}$/.test(value.id)) return null
    const username = normalizeUsername(value.username)
    if (!username) return null
    if (!decodeVerifier(value.verifier)) return null
    if (!Number.isSafeInteger(value.createdAtMs) || value.createdAtMs < 0) return null
    if (!Number.isSafeInteger(value.epoch) || value.epoch < 1) return null
    const failedAttempts = Number.isSafeInteger(value.failedAttempts) && value.failedAttempts >= 0 ? value.failedAttempts : 0
    const lockedUntilMs = Number.isSafeInteger(value.lockedUntilMs) && value.lockedUntilMs >= 0 ? value.lockedUntilMs : 0
    return {
      id: value.id,
      username,
      displayName: normalizeDisplayName(value.displayName, username),
      verifier: value.verifier,
      createdAtMs: value.createdAtMs,
      epoch: value.epoch,
      failedAttempts,
      lockedUntilMs,
    }
  }

  /**
   * Read the accounts, or refuse.
   *
   * A file that exists and cannot be understood THROWS. It is never silently
   * replaced with an empty store: doing that would present the first-run
   * "create your account" screen to somebody who already has one, and the first
   * thing they did on it would overwrite the account they could not read.
   */
  function readStore() {
    let raw
    try {
      raw = fs.readFileSync(accountsPath)
    } catch (error) {
      if (error && error.code === 'ENOENT') return emptyStore()
      throw new AccountError('ACCOUNT_STORE_UNREADABLE', 'The account file could not be read on this computer.')
    }
    if (raw.length > MAX_STORE_BYTES) {
      throw new AccountError('ACCOUNT_STORE_UNREADABLE', 'The account file is larger than this product will read.')
    }
    let parsed
    try {
      parsed = JSON.parse(raw.toString('utf8'))
    } catch {
      throw new AccountError('ACCOUNT_STORE_CORRUPT', 'The account file on this computer is not readable.')
    }
    if (!isPlainObject(parsed) || parsed.version !== STORE_VERSION || !Array.isArray(parsed.accounts)) {
      throw new AccountError('ACCOUNT_STORE_CORRUPT', 'The account file on this computer is not in a form this version understands.')
    }
    const accounts = []
    for (const entry of parsed.accounts) {
      const account = validateAccount(entry)
      /* One unreadable entry condemns the file. Skipping it would silently drop
         a person's account and let the rest of the product carry on as though
         they had never existed. */
      if (!account) throw new AccountError('ACCOUNT_STORE_CORRUPT', 'The account file on this computer contains an entry this version cannot read.')
      if (accounts.some(other => other.username === account.username || other.id === account.id)) {
        throw new AccountError('ACCOUNT_STORE_CORRUPT', 'The account file on this computer lists the same account twice.')
      }
      accounts.push(account)
    }
    return { version: STORE_VERSION, accounts }
  }

  function writeStore(store) {
    fs.mkdirSync(directory, { recursive: true })
    writeFileDurable(accountsPath, `${JSON.stringify(store, null, 2)}\n`)
  }

  /* ------------------------------ the session ------------------------------ */

  function clearPersistedSession() {
    try {
      fs.rmSync(sessionPath, { force: true })
    } catch { /* a session that cannot be deleted is handled by the epoch check */ }
  }

  function persistSession(session) {
    if (!keystoreAvailable()) return false
    try {
      fs.mkdirSync(directory, { recursive: true })
      writeFileDurable(sessionPath, safeStorage.encryptString(JSON.stringify(session)))
      return true
    } catch {
      /* An unwritable session file means "you will have to sign in again next
         time", not "you are not signed in now". The in-memory session stands. */
      return false
    }
  }

  function sessionUsable(session, store) {
    if (!isPlainObject(session)) return false
    if (typeof session.sessionId !== 'string' || !/^[0-9a-f]{32}$/.test(session.sessionId)) return false
    if (typeof session.accountId !== 'string' || !/^[0-9a-f]{32}$/.test(session.accountId)) return false
    if (!Number.isSafeInteger(session.issuedAtMs) || session.issuedAtMs < 0) return false
    if (!Number.isSafeInteger(session.expiresAtMs) || session.expiresAtMs <= 0) return false
    if (!Number.isSafeInteger(session.epoch) || session.epoch < 1) return false
    if (now() >= session.expiresAtMs) return false
    const account = store.accounts.find(entry => entry.id === session.accountId)
    if (!account) return false
    /* The epoch is what makes signing out everywhere, and changing a password,
       mean something. A session file copied before either event decrypts fine
       and is still refused here. */
    if (account.epoch !== session.epoch) return false
    return true
  }

  /**
   * LOAD the session left by the previous run. It does not judge it.
   *
   * This function decrypts and parses; `sessionUsable` decides. The split is
   * deliberate and mutation testing is what forced it: when this function
   * ALSO validated, the validation in `current()` covered for it and the check
   * here could be deleted outright with every test still green. A rule enforced
   * in two places is a rule with no test coverage in either.
   *
   * It still fails closed on its own terms -- every path that cannot produce a
   * candidate returns null, and none of them returns a session.
   */
  function restoreSession() {
    if (sessionRestored) return activeSession
    sessionRestored = true
    activeSession = null

    if (!keystoreAvailable()) return null

    let raw
    try {
      raw = fs.readFileSync(sessionPath)
    } catch {
      return null
    }
    let session
    try {
      session = JSON.parse(safeStorage.decryptString(raw))
    } catch {
      /* Undecryptable or unparseable is signed out, and the useless file is
         removed so it cannot be retried forever. */
      clearPersistedSession()
      return null
    }
    if (!isPlainObject(session)) {
      clearPersistedSession()
      return null
    }
    activeSession = Object.freeze({
      sessionId: session.sessionId,
      accountId: session.accountId,
      issuedAtMs: session.issuedAtMs,
      expiresAtMs: session.expiresAtMs,
      epoch: session.epoch,
    })
    return activeSession
  }

  /* --------------------------------- reads --------------------------------- */

  /**
   * What the interface may show before anybody has done anything.
   *
   * Never throws. A screen that cannot render because the account file is
   * damaged is a product that cannot be repaired from its own interface.
   */
  function availability() {
    let store = null
    let storeError = null
    try {
      store = readStore()
    } catch (error) {
      storeError = error
    }
    if (storeError) {
      return Object.freeze({
        ok: false,
        code: storeError.code || 'ACCOUNT_STORE_CORRUPT',
        reason: storeError.message,
        accountCount: 0,
        canPersistSession: keystoreAvailable(),
      })
    }
    return Object.freeze({
      ok: true,
      code: 'ACCOUNT_READY',
      accountCount: store.accounts.length,
      /* False means sign-in works but will not survive a relaunch. The screen
         states that where the person can see it, instead of surprising them
         with a sign-in prompt they thought they had already answered. */
      canPersistSession: keystoreAvailable(),
      sessionLifetimeMs,
      minimumPasswordLength: MIN_PASSWORD_LENGTH,
    })
  }

  /**
   * Who is signed in. The single read the rest of the shell uses.
   *
   * Synchronous, because shell/main.cjs must answer it inside the spawn path,
   * and NEVER carries a secret: there is no token, no verifier and no password
   * in the returned object, so it is safe to log and safe to send to the page.
   */
  function current() {
    const session = restoreSession()
    if (!session) return SIGNED_OUT_STATE

    /* ONE AUTHORITY, RE-ASKED ON EVERY READ.
     *
     * `sessionUsable` is the only thing in this file that decides whether a
     * session is good, and it is asked again here rather than trusted from
     * restore time. Both halves of that matter, and mutation testing is what
     * proved it:
     *
     * An earlier version checked expiry, epoch and existence AGAIN here, in
     * line, duplicating `sessionUsable`. Every one of those duplicated checks
     * was individually deletable with the tests still green, because whichever
     * copy was left standing covered for the other. Three mutants survived that
     * way. Duplicated validation does not double the safety; it halves the
     * evidence that either copy works.
     *
     * And it is RE-ASKED rather than cached because a window left open past its
     * expiry, or open while another window signs out everywhere, must stop
     * being signed in without anything happening to trigger a re-read. */
    let store
    try {
      store = readStore()
    } catch {
      activeSession = null
      return SIGNED_OUT_STATE
    }
    if (!sessionUsable(session, store)) {
      activeSession = null
      clearPersistedSession()
      return SIGNED_OUT_STATE
    }
    const account = store.accounts.find(entry => entry.id === session.accountId)
    return Object.freeze({
      signedIn: true,
      principal: `${PRINCIPAL_PREFIX}${account.id}`,
      account: Object.freeze({
        id: account.id,
        username: account.username,
        displayName: account.displayName,
        createdAtMs: account.createdAtMs,
      }),
      session: Object.freeze({
        /* MAIN-PROCESS CONSUMERS ONLY. A decision record that wants to say
           which sign-in approved something reads it here. It is projected OUT
           by the IPC boundary in shell/main.cjs rather than reaching the page:
           nothing accepts it as proof of anything, so it is not a bearer
           token, but a page has no use for it and the smallest surface that
           works is the one to expose. */
        id: session.sessionId,
        issuedAtMs: session.issuedAtMs,
        expiresAtMs: session.expiresAtMs,
      }),
    })
  }

  /**
   * The same answer, minus everything a page has no use for.
   *
   * The renderer boundary sends THIS, never `current()`. Two shapes rather than
   * one because the alternative -- remembering to delete a field at the IPC
   * handler -- is a rule that holds until somebody adds a field, and the field
   * they add will be the one that should not have crossed.
   */
  function currentForRenderer() {
    const state = current()
    if (!state.signedIn) return state
    return Object.freeze({
      signedIn: true,
      principal: state.principal,
      account: state.account,
      session: Object.freeze({ issuedAtMs: state.session.issuedAtMs, expiresAtMs: state.session.expiresAtMs }),
    })
  }

  /**
   * The value shell/spawn-record.cjs writes.
   *
   * A bounded string, always -- either this installation's account id or the
   * stated `unauthenticated`. It is read HERE, in the main process, and is
   * never accepted from the renderer, because an identity a page can choose is
   * not an identity.
   */
  function principal() {
    return current().principal
  }

  /* -------------------------------- mutations ------------------------------- */

  async function createAccount({ username, displayName, password } = {}) {
    const normalized = normalizeUsername(username)
    if (!normalized) {
      return refusal(
        'ACCOUNT_USERNAME_INVALID',
        `Use ${MIN_USERNAME_LENGTH}-${MAX_USERNAME_LENGTH} characters: letters, numbers, and . _ - between them.`,
      )
    }
    const badPassword = passwordRefusal(password, normalized)
    if (badPassword) return badPassword

    let store
    try {
      store = readStore()
    } catch (error) {
      return refusal(error.code || 'ACCOUNT_STORE_CORRUPT', error.message)
    }
    if (store.accounts.length >= MAX_ACCOUNTS) {
      return refusal('ACCOUNT_LIMIT_REACHED', `This computer already holds the maximum of ${MAX_ACCOUNTS} accounts.`)
    }
    if (store.accounts.some(entry => entry.username === normalized)) {
      return refusal('ACCOUNT_USERNAME_TAKEN', 'That name is already used on this computer.')
    }

    const salt = crypto.randomBytes(SALT_BYTES)
    let derived
    try {
      derived = await scryptDerive(password, salt)
    } catch {
      return refusal('ACCOUNT_HASH_FAILED', 'This computer could not protect the password, so no account was created.')
    }

    const account = {
      id: crypto.randomBytes(16).toString('hex'),
      username: normalized,
      displayName: normalizeDisplayName(displayName, normalized),
      verifier: encodeVerifier(salt, derived),
      createdAtMs: now(),
      epoch: 1,
      failedAttempts: 0,
      lockedUntilMs: 0,
    }
    try {
      writeStore({ version: STORE_VERSION, accounts: [...store.accounts, account] })
    } catch {
      return refusal('ACCOUNT_STORE_WRITE_FAILED', 'The account could not be saved on this computer.')
    }
    return Object.freeze({ ok: true, account: Object.freeze({ id: account.id, username: account.username, displayName: account.displayName }) })
  }

  /* One message for "no such account" and for "wrong password", because two
     messages tell an attacker which usernames exist. The lockout is reported,
     because withholding it just leaves a person retrying a password that was
     right. */
  const BAD_CREDENTIALS = Object.freeze(
    refusal('ACCOUNT_CREDENTIALS_REJECTED', 'That username and password do not match an account on this computer.'),
  )

  async function signIn({ username, password } = {}) {
    const normalized = normalizeUsername(username)
    if (typeof password !== 'string' || password.length === 0 || password.length > MAX_PASSWORD_LENGTH) {
      await burnEquivalentWork()
      return BAD_CREDENTIALS
    }
    let store
    try {
      store = readStore()
    } catch (error) {
      return refusal(error.code || 'ACCOUNT_STORE_CORRUPT', error.message)
    }
    const account = normalized ? store.accounts.find(entry => entry.username === normalized) : null
    if (!account) {
      await burnEquivalentWork()
      return BAD_CREDENTIALS
    }
    const at = now()
    if (account.lockedUntilMs > at) {
      return refusal(
        'ACCOUNT_LOCKED',
        `Too many wrong passwords. Try again in ${Math.ceil((account.lockedUntilMs - at) / 60000)} minute(s).`,
      )
    }

    const matched = await verifyPassword(password, account.verifier)
    if (!matched) {
      const failedAttempts = account.failedAttempts + 1
      const locked = failedAttempts >= MAX_FAILED_ATTEMPTS
      try {
        writeStore({
          version: STORE_VERSION,
          accounts: store.accounts.map(entry => (entry.id === account.id
            ? { ...entry, failedAttempts: locked ? 0 : failedAttempts, lockedUntilMs: locked ? at + LOCKOUT_MS : entry.lockedUntilMs }
            : entry)),
        })
      } catch { /* a failure to record the attempt must not report a successful sign-in */ }
      if (locked) {
        return refusal('ACCOUNT_LOCKED', `Too many wrong passwords. Try again in ${Math.ceil(LOCKOUT_MS / 60000)} minute(s).`)
      }
      return BAD_CREDENTIALS
    }

    if (account.failedAttempts !== 0 || account.lockedUntilMs !== 0) {
      try {
        writeStore({
          version: STORE_VERSION,
          accounts: store.accounts.map(entry => (entry.id === account.id ? { ...entry, failedAttempts: 0, lockedUntilMs: 0 } : entry)),
        })
      } catch { /* the counter is a convenience; a correct password still signs in */ }
    }

    const session = {
      sessionId: crypto.randomBytes(16).toString('hex'),
      accountId: account.id,
      issuedAtMs: at,
      expiresAtMs: at + sessionLifetimeMs,
      epoch: account.epoch,
    }
    activeSession = Object.freeze({ ...session })
    sessionRestored = true
    const persisted = persistSession(session)
    return Object.freeze({
      ok: true,
      /* False means this sign-in is good for this run only. Said here so the
         screen can tell the person, rather than letting them discover it at the
         next launch. */
      persisted,
      account: Object.freeze({ id: account.id, username: account.username, displayName: account.displayName }),
      expiresAtMs: session.expiresAtMs,
    })
  }

  function signOut() {
    activeSession = null
    sessionRestored = true
    clearPersistedSession()
    return Object.freeze({ ok: true })
  }

  /**
   * End every session for this account, including ones this process did not
   * issue and any copy of the session file taken earlier.
   *
   * Advancing the epoch is what does it. Deleting the file alone would leave a
   * backup of it replayable, which is the difference between tidying up and
   * revoking.
   */
  function signOutEverywhere() {
    const state = current()
    if (!state.signedIn) {
      signOut()
      return Object.freeze({ ok: true, revoked: false })
    }
    let store
    try {
      store = readStore()
    } catch (error) {
      return refusal(error.code || 'ACCOUNT_STORE_CORRUPT', error.message)
    }
    try {
      writeStore({
        version: STORE_VERSION,
        accounts: store.accounts.map(entry => (entry.id === state.account.id ? { ...entry, epoch: entry.epoch + 1 } : entry)),
      })
    } catch {
      return refusal('ACCOUNT_STORE_WRITE_FAILED', 'The sessions could not be ended on this computer.')
    }
    signOut()
    return Object.freeze({ ok: true, revoked: true })
  }

  /**
   * Change the password, which also ends every existing session.
   *
   * The current password is required even though the person is already signed
   * in: an unattended unlocked window must not be enough to take an account
   * over permanently.
   */
  async function changePassword({ currentPassword, newPassword } = {}) {
    const state = current()
    if (!state.signedIn) return refusal('ACCOUNT_NOT_SIGNED_IN', 'Sign in before changing the password.')

    let store
    try {
      store = readStore()
    } catch (error) {
      return refusal(error.code || 'ACCOUNT_STORE_CORRUPT', error.message)
    }
    const account = store.accounts.find(entry => entry.id === state.account.id)
    if (!account) return refusal('ACCOUNT_NOT_SIGNED_IN', 'That account no longer exists on this computer.')

    if (typeof currentPassword !== 'string' || currentPassword.length === 0 || currentPassword.length > MAX_PASSWORD_LENGTH
      || !(await verifyPassword(currentPassword, account.verifier))) {
      return refusal('ACCOUNT_CREDENTIALS_REJECTED', 'The current password is not right.')
    }
    const badPassword = passwordRefusal(newPassword, account.username)
    if (badPassword) return badPassword
    if (newPassword === currentPassword) {
      return refusal('ACCOUNT_PASSWORD_UNCHANGED', 'The new password is the same as the current one.')
    }

    const salt = crypto.randomBytes(SALT_BYTES)
    let derived
    try {
      derived = await scryptDerive(newPassword, salt)
    } catch {
      return refusal('ACCOUNT_HASH_FAILED', 'This computer could not protect the new password, so nothing was changed.')
    }
    try {
      writeStore({
        version: STORE_VERSION,
        accounts: store.accounts.map(entry => (entry.id === account.id
          ? { ...entry, verifier: encodeVerifier(salt, derived), epoch: entry.epoch + 1, failedAttempts: 0, lockedUntilMs: 0 }
          : entry)),
      })
    } catch {
      return refusal('ACCOUNT_STORE_WRITE_FAILED', 'The new password could not be saved on this computer.')
    }
    /* Every session, including this window's, is now on the previous epoch. The
       person signs in again with the password they just chose, which is how
       they find out it took effect. */
    signOut()
    return Object.freeze({ ok: true, signedOut: true })
  }

  return Object.freeze({
    availability,
    current,
    currentForRenderer,
    principal,
    createAccount,
    signIn,
    signOut,
    signOutEverywhere,
    changePassword,
    accountsPath,
    sessionPath,
  })
}

/* ONE STORE PER DIRECTORY, FOR THE WHOLE MAIN PROCESS.
 *
 * Two consumers each calling createAccountStore() over the same userData look
 * harmless, because both read the same files. They are not, and the failure is
 * exactly the one an auth bug is made of: the authoritative session lives in
 * MEMORY. When the OS keystore is unavailable, a sign-in is deliberately not
 * written to disk at all, so a second instance built afterwards would answer
 * "signed out" while the first answers "signed in" -- and whichever one the
 * audit record happened to ask would decide whose name went on it.
 *
 * Every main-process consumer must come through here. The first caller decides
 * the directory; later callers naming a different one are refused rather than
 * silently handed the first, because that would be a consumer reading an
 * account file it did not ask for.
 */
let shared = null
function sharedAccountStore(options = {}) {
  if (shared) {
    if (typeof options.directory === 'string' && options.directory !== shared.directory) {
      throw new AccountError(
        'ACCOUNT_STORE_ALREADY_BOUND',
        'The account store is already bound to a different directory in this process',
      )
    }
    return shared.store
  }
  const store = createAccountStore(options)
  shared = { directory: options.directory, store }
  return store
}

/* Tests only. Nothing in the shipped paths calls this: a running app that could
   swap its own account store mid-flight is a running app whose audit principal
   can be swapped mid-flight. */
function resetSharedAccountStoreForTests() {
  shared = null
}

module.exports = {
  createAccountStore,
  sharedAccountStore,
  resetSharedAccountStoreForTests,
  AccountError,
  SCRYPT_PARAMETERS,
  SCRYPT_MAXMEM,
  SESSION_LIFETIME_MS,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  MIN_USERNAME_LENGTH,
  MAX_USERNAME_LENGTH,
  MAX_ACCOUNTS,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_MS,
  UNAUTHENTICATED_PRINCIPAL,
  PRINCIPAL_PREFIX,
  REFUSED_PASSWORDS,
  encodeVerifier,
  decodeVerifier,
  normalizeUsername,
  /* Exported so the DEFENSIVE branch inside it can be tested directly. In
     normal operation `readStore` refuses a malformed verifier before this is
     ever reached, which means a mutation that made this function ADMIT on an
     unreadable verifier survived the whole suite -- the branch was real, the
     coverage was not. An unreachable fail-open is still a fail-open waiting for
     the guard in front of it to change. */
  verifyPassword,
}
