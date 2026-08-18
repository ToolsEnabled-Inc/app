'use strict'

/* An app-local, signed, append-only record of every agent session this app
 * starts.
 *
 * WHAT THIS IS NOT: it is not the canonical external audit chain. It does
 * not share that chain's key, sequence space, or anchor, and it must never be
 * described as if it does. Naming it precisely is the whole point -- a record
 * that overstates itself is worse than no record.
 *
 * WHY IT EXISTS ANYWAY: starting an agent from the interface previously wrote
 * nothing at all, while the audited dispatch action next to it REFUSES without
 * a durable receipt. That asymmetry meant a session could be started with no
 * trace. The canonical writer cannot close it here: the shipped payload has no
 * vault (AUDIT_SIGNING_KEY_UNAVAILABLE) and the engine chain has been observed
 * in AUDIT_ANCHOR_INTEGRITY_ALARM. This writer depends on neither. It needs
 * only the OS keystore, so it works on a clean installation with nothing else
 * configured.
 *
 * PROPERTIES:
 *   - Signed with an ed25519 key generated on first run and stored encrypted
 *     by the OS keystore (Electron safeStorage -> DPAPI on Windows), so the
 *     key is bound to the OS user and is not readable as plain bytes on disk.
 *   - Hash-chained: every record commits to its predecessor, so removing or
 *     editing an earlier line breaks verification of every later one.
 *   - Durable before the caller proceeds: appended and fsync'd, so a record
 *     cannot be lost by a crash between "recorded" and "spawned".
 *
 * WHAT IT DOES NOT PROVE: the key lives on the same machine as the ledger, so
 * anyone who is already that OS user can rewrite the whole chain from scratch.
 * This is tamper-EVIDENT against edits, not tamper-PROOF against the user.
 * It is a local accountability record, not a remote attestation.
 *
 * Every dependency is injected so this is testable without Electron.
 */

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const KEY_FILE = 'agent-spawn-key.enc'
const LEDGER_FILE = 'agent-spawn-records.jsonl'
const GENESIS = '0'.repeat(64)
const MAX_DETAIL_LENGTH = 4096

class SpawnRecordError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'SpawnRecordError'
    this.code = code
  }
}

function sha256Hex(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex')
}

/* Key order is fixed rather than taken from the object, because the hash is a
   commitment: if two callers serialise the same record with different key
   order they produce different hashes for identical facts. */
function canonicalJson(record) {
  const fields = [
    record.sequence,
    record.at,
    record.action,
    record.sessionId,
    record.principal,
    record.details,
    record.previousHash,
  ]
  /* THE EIGHTH FIELD IS APPENDED ONLY WHEN IT EXISTS, and that conditional is
     what makes recording an outcome possible without invalidating a ledger
     somebody already has.
   *
   * An unconditional eighth element -- even `record.outcome ?? null` -- changes
   * the commitment for EVERY record ever written, including the ones already on
   * disk with no outcome. Re-verifying them would recompute a different hash,
   * verify() would report the chain broken, and the home screen would tell an
   * existing user their record no longer checks out. A truthful new feature
   * that makes the product accuse itself of tampering is not a truthful
   * feature.
   *
   * IT IS STILL UNAMBIGUOUS, which is the property a conditional commitment has
   * to earn. Presence is committed to, not just content: a record written WITH
   * an outcome hashes over eight fields, so stripping the field yields seven and
   * fails; a record written WITHOUT one hashes over seven, so adding a field
   * yields eight and fails. Neither direction is forgeable, so nothing is
   * weakened by the field being optional -- only old records are left alone. */
  if (record.outcome !== undefined && record.outcome !== null) fields.push(record.outcome)
  /* THE NINTH FIELD, ADDED THE SAME WAY AND FOR THE SAME REASON. What a turn
   * cost is a second optional commitment, and it must not disturb the eighth.
   *
   * THE `null` IS LOAD-BEARING AND IS NOT A PLACEHOLDER FOR NOTHING. Without
   * it, a record carrying usage and no outcome would serialise to eight fields
   * whose eighth is the usage -- structurally indistinguishable, by POSITION,
   * from a record carrying an outcome. Two different facts hashing over the
   * same shape is exactly the ambiguity the eighth field's own note says a
   * conditional commitment has to earn its way out of. Pushing the empty
   * outcome slot first means the count says which fields are present: seven is
   * neither, eight is an outcome, nine is usage with the outcome slot stated.
   *
   * OLD RECORDS ARE STILL LEFT ALONE, which was the whole point of making the
   * eighth conditional: nothing that has ever been written carries this field,
   * so nothing already on disk changes shape or hash. */
  if (record.usage !== undefined && record.usage !== null) {
    if (fields.length === 7) fields.push(null)
    fields.push(record.usage)
  }
  return JSON.stringify(fields)
}

/* What a run actually DID, in a shape that can never carry a path.
 *
 * WHY THIS IS NOT IN `details`. `details` is dropped outright by history() and
 * the comment there says why: it carries the session's working directory, and a
 * filter over a path-bearing field "is a thing someone widens later". That rule
 * is right and is not being bent -- so the outcome gets its own field, designed
 * from the start to be renderer-bound, and `details` keeps leaving nothing.
 *
 * THE VALIDATION IS THE GUARANTEE, not the convention. `reason` is constrained
 * to /^[A-Z][A-Z0-9_]{0,63}$/, which structurally CANNOT hold a Windows path: no
 * backslash, no colon, no dot, no space, no lower case. So the promise that this
 * field is safe to render is enforced by the writer rather than trusted from the
 * caller, and a future caller that passes an error message instead of a code is
 * refused rather than published. */
const OUTCOME_RESULTS = Object.freeze(['started', 'refused'])
const OUTCOME_REASON_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/

function boundedOutcome(outcome) {
  if (outcome === undefined || outcome === null) return undefined
  if (typeof outcome !== 'object' || Array.isArray(outcome)) {
    throw new SpawnRecordError('SPAWN_RECORD_INVALID_OUTCOME', 'Record outcome must be a plain object')
  }
  if (!OUTCOME_RESULTS.includes(outcome.result)) {
    throw new SpawnRecordError('SPAWN_RECORD_INVALID_OUTCOME', 'Record outcome.result must be "started" or "refused"')
  }
  if (!Number.isSafeInteger(outcome.resolves) || outcome.resolves < 1) {
    throw new SpawnRecordError('SPAWN_RECORD_INVALID_OUTCOME', 'Record outcome.resolves must be the sequence it resolves')
  }
  const reason = outcome.reason === undefined || outcome.reason === null ? null : outcome.reason
  if (reason !== null && (typeof reason !== 'string' || !OUTCOME_REASON_PATTERN.test(reason))) {
    throw new SpawnRecordError('SPAWN_RECORD_INVALID_OUTCOME', 'Record outcome.reason must be a bare upper-case code')
  }
  /* Constructed in a fixed key order for the same reason canonicalJson fixes
     its own: the hash commits to the serialisation, and an object whose keys
     arrive in a caller's order would hash differently for identical facts. */
  return { result: outcome.result, resolves: outcome.resolves, reason }
}

/* The same constraint, applied to bytes rather than to a caller, and answering
   null instead of throwing. history() must never throw (its rule 3), so a
   malformed outcome has to degrade to "this run does not say", which is the
   same honest answer an older record without the field gives. */
function readableOutcome(value) {
  try {
    return boundedOutcome(value) || null
  } catch {
    return null
  }
}

/* WHAT A TURN COST, in a shape that -- like `outcome` above and unlike
 * `details` -- can never carry a path.
 *
 * WHY THIS IS A FIELD AND NOT `details`. Same answer as the outcome's: `details`
 * is dropped outright by history() because it carries the session's working
 * directory, and the rule that a filter over a path-bearing field "is a thing
 * someone widens later" is not being bent. A figure that has to reach a screen
 * gets its own field, designed renderer-bound from the start.
 *
 * THE VALIDATION IS THE GUARANTEE. Every numeric field is a non-negative safe
 * integer or absent; every string field matches a pattern with no backslash, no
 * colon and no space in it, so none of them can structurally hold a Windows
 * path. A caller that passes a working directory as a `tier` is REFUSED at the
 * write rather than published to the page.
 *
 * ABSENT IS NOT ZERO, and the distinction is the whole honesty of the feature.
 * An engine that reports no total has no total; writing 0 there would be this
 * program inventing a figure and signing it with the engine's authority. Every
 * field is therefore nullable and a null means "the engine did not say". */
const USAGE_NUMBER_FIELDS = Object.freeze([
  'inputTokens',
  'cachedInputTokens',
  'cacheCreationInputTokens',
  'outputTokens',
  'reasoningOutputTokens',
  'totalTokens',
  'contextWindow',
  'sessionTotalTokens',
])

const USAGE_STRING_FIELDS = Object.freeze([
  /* The engine's own id for the turn. Bounded to a charset that cannot spell a
     path; it names nothing outside the session it belongs to. */
  ['turnId', /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/],
  /* Which model row the session was started under -- `luna`, `claude-sonnet`.
     The renderer maps it to a provider and a model through its own table
     (src/orchestration-controls.js) rather than a fourth copy of that table
     living here. */
  ['tier', /^[a-z][a-z0-9-]{0,63}$/],
  /* WHICH SIGN-IN SERVED, by the name the person gave it. A name, never a
     credential -- the same value startSession() already reports back. */
  ['account', /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/],
  /* The engine's own word for how the turn ended. Each provider has its own
     (`completed` for codex, `success` for the Claude CLI) and both are carried
     unaltered; see sessionTurnSucceeded() in src/agent-session-events.js. */
  ['status', /^[a-z][a-z_]{0,31}$/],
  /* WHETHER THESE FIGURES ARE THE TURN'S OR THE SESSION'S RUNNING TOTAL. A
     reader that summed a cumulative reading once per turn would multiply a
     session's spend by its number of turns, so which one this is has to be
     recorded, not guessed downstream. */
  ['basis', /^(turn|session-total)$/],
])

function boundedUsage(usage) {
  if (usage === undefined || usage === null) return undefined
  if (typeof usage !== 'object' || Array.isArray(usage)) {
    throw new SpawnRecordError('SPAWN_RECORD_INVALID_USAGE', 'Record usage must be a plain object')
  }
  /* Built in a fixed key order for the same reason canonicalJson fixes its own:
     the hash commits to the serialisation, and a caller's key order would hash
     differently for identical facts. */
  const entry = {}
  for (const [field, pattern] of USAGE_STRING_FIELDS) {
    const value = usage[field]
    if (value === undefined || value === null) { entry[field] = null; continue }
    if (typeof value !== 'string' || !pattern.test(value)) {
      throw new SpawnRecordError('SPAWN_RECORD_INVALID_USAGE', `Record usage.${field} is not the bounded shape this record admits`)
    }
    entry[field] = value
  }
  let figures = 0
  for (const field of USAGE_NUMBER_FIELDS) {
    const value = usage[field]
    if (value === undefined || value === null) { entry[field] = null; continue }
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new SpawnRecordError('SPAWN_RECORD_INVALID_USAGE', `Record usage.${field} must be a non-negative whole number`)
    }
    entry[field] = value
    figures += 1
  }
  /* A usage record with no figure in it is not a reading, and recording one
     would put a row on a page that says a turn cost nothing. */
  if (figures === 0) {
    throw new SpawnRecordError('SPAWN_RECORD_INVALID_USAGE', 'Record usage carries no token figure, so there is nothing to record')
  }
  return entry
}

/* The same constraint applied to bytes rather than to a caller, answering null
   instead of throwing -- history() must never throw (its rule 3), so a
   malformed usage record degrades to "this run does not say". */
function readableUsage(value) {
  try {
    return boundedUsage(value) || null
  } catch {
    return null
  }
}

/* THE SESSION THIS RECORD IS ABOUT, so a screen can say WHICH agent and WHAT
 * it was asked instead of "Agent run 37".
 *
 * WHY THIS IS NOT IN THE SAME CLASS AS `details`, which stays dropped. `details`
 * carries the session's working directory -- a path out of this machine's
 * filesystem -- and the rule that a filter over a path-bearing field "is a thing
 * someone widens later" is not being bent here. A session id is the opposite
 * kind of value: the RENDERER minted it (`chat-<uuid>`, generated in the page
 * before the start was ever requested), the page already holds every id it
 * started, and it names nothing outside this app. Passing it back tells a screen
 * nothing it did not already know about its own sessions; it only lets a screen
 * MATCH a ledger line to the conversation it already has on disk.
 *
 * AND IT IS BOUNDED, for the same reason `principal` is. These are bytes off a
 * file this function deliberately returns even when the chain does NOT verify,
 * so anything that could append a line could otherwise put an arbitrary string
 * next to somebody's history. The shape admitted is the shape the app writes:
 * lower-case ASCII, digits and dashes, at most 128 characters. Anything else is
 * null -- "this record does not say" -- which every reader downstream already
 * has to handle. */
const SESSION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/

function readableSessionId(value) {
  if (typeof value !== 'string') return null
  return SESSION_ID_PATTERN.test(value) ? value : null
}

/* The identity on a record, re-derived from the bytes rather than trusted.
 *
 * Only the two shapes the writer can produce are admitted: `account:` followed
 * by an account id, or the stated word for "nobody was signed in". A record
 * carrying anything else answers null -- "this record does not say" -- which is
 * the same degradation an old record written before accounts existed gets, and
 * is the only honest answer for a string this function does not recognise.
 *
 * WHY IT MATTERS THAT THIS IS NARROW. A screen filters on this value to decide
 * which runs are the signed-in person's. If an arbitrary string came through,
 * anything that could write a line into this file could write itself a name --
 * and a name that renders next to somebody's own history is an accusation. */
function readablePrincipal(value) {
  if (typeof value !== 'string') return null
  if (value === 'unauthenticated') return value
  return /^account:[0-9a-f]{32}$/.test(value) ? value : null
}

function writeFileDurable(filePath, contents) {
  const handle = fs.openSync(filePath, 'w', 0o600)
  try {
    fs.writeFileSync(handle, contents)
    fs.fsyncSync(handle)
  } finally {
    fs.closeSync(handle)
  }
}

function appendDurable(filePath, line) {
  const handle = fs.openSync(filePath, 'a', 0o600)
  try {
    fs.writeFileSync(handle, line)
    /* fsync before the caller is told the record exists. Without it a crash
       between "recorded" and "spawned" loses exactly the record that proves a
       process was started. */
    fs.fsyncSync(handle)
  } finally {
    fs.closeSync(handle)
  }
}

function boundedDetails(details) {
  const value = details === undefined ? {} : details
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SpawnRecordError('SPAWN_RECORD_INVALID_DETAILS', 'Record details must be a plain object')
  }
  const encoded = JSON.stringify(value)
  if (encoded === undefined || encoded.length > MAX_DETAIL_LENGTH) {
    throw new SpawnRecordError('SPAWN_RECORD_INVALID_DETAILS', 'Record details are not serialisable within the bound')
  }
  return JSON.parse(encoded)
}

/* `ledgerFile` is an option so a SECOND chain can be kept beside the first with
 * one implementation, and it exists because of a measured collision rather than
 * for symmetry.
 *
 * history() reads at most 200 LINES. Per-turn usage records are written many
 * times per session, so putting them in the run ledger would push the runs
 * themselves out of the only window the home screen and the metrics page can
 * see: a person with one busy session would open the product and be told
 * nothing had ever run here. Its own file keeps the run record's window intact
 * and lets the usage record be read, bounded and verified on its own terms.
 *
 * THE KEY IS DELIBERATELY SHARED (`keyFile` is not an option). One OS-keystore
 * blob per installation, one identity signing both chains: a second key would
 * be a second thing that can fail to decrypt, and an installation whose runs
 * verify while its usage does not is a state nobody can act on. The chains stay
 * independent -- each has its own genesis, sequence space and head -- because
 * they are separate files, which is where a chain's identity actually lives. */
function createSpawnRecorder({ safeStorage, directory, ledgerFile = LEDGER_FILE, now = () => new Date().toISOString() } = {}) {
  if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function') {
    throw new SpawnRecordError('SPAWN_RECORD_NO_KEYSTORE', 'A keystore with isEncryptionAvailable() is required')
  }
  if (typeof directory !== 'string' || directory.length === 0) {
    throw new SpawnRecordError('SPAWN_RECORD_NO_DIRECTORY', 'A record directory is required')
  }

  const keyPath = path.join(directory, KEY_FILE)
  const ledgerPath = path.join(directory, ledgerFile)
  let privateKey = null
  let head = null

  function loadOrCreateKey() {
    if (privateKey) return privateKey
    if (!safeStorage.isEncryptionAvailable()) {
      throw new SpawnRecordError(
        'SPAWN_RECORD_KEYSTORE_UNAVAILABLE',
        'The OS keystore is unavailable, so a signing key cannot be protected',
      )
    }
    fs.mkdirSync(directory, { recursive: true })

    if (fs.existsSync(keyPath)) {
      let pem
      try {
        pem = safeStorage.decryptString(fs.readFileSync(keyPath))
      } catch (error) {
        /* A key that cannot be decrypted is NOT replaced. Regenerating would
           silently orphan every existing record's signature and read as a
           successful fresh start -- the failure mode most worth refusing. */
        throw new SpawnRecordError(
          'SPAWN_RECORD_KEY_UNREADABLE',
          `The existing signing key could not be decrypted: ${error.code || error.message}`,
        )
      }
      privateKey = crypto.createPrivateKey(pem)
      return privateKey
    }

    const generated = crypto.generateKeyPairSync('ed25519')
    const pem = generated.privateKey.export({ type: 'pkcs8', format: 'pem' })
    writeFileDurable(keyPath, safeStorage.encryptString(pem.toString()))
    privateKey = generated.privateKey
    return privateKey
  }

  /* The head is recovered from the ledger itself rather than cached in a
     separate file. A cached head that disagrees with the ledger is a second
     source of truth, and the one that silently breaks the chain. */
  function loadHead() {
    if (head) return head
    if (!fs.existsSync(ledgerPath)) {
      head = { sequence: 0, hash: GENESIS }
      return head
    }
    const lines = fs.readFileSync(ledgerPath, 'utf8').split('\n').filter(line => line.trim().length > 0)
    if (lines.length === 0) {
      head = { sequence: 0, hash: GENESIS }
      return head
    }
    let last
    try {
      last = JSON.parse(lines[lines.length - 1])
    } catch {
      throw new SpawnRecordError('SPAWN_RECORD_LEDGER_CORRUPT', 'The final ledger record is not readable JSON')
    }
    if (!Number.isSafeInteger(last.sequence) || last.sequence < 1 || typeof last.eventHash !== 'string') {
      throw new SpawnRecordError('SPAWN_RECORD_LEDGER_CORRUPT', 'The final ledger record has no usable sequence or hash')
    }
    head = { sequence: last.sequence, hash: last.eventHash }
    return head
  }

  /* Reports whether a record COULD be written, without writing one. The spawn
     surface calls this before offering a Start control, so an installation
     that cannot record says so up front instead of failing at the click. */
  function availability() {
    try {
      loadOrCreateKey()
      loadHead()
      return Object.freeze({ ok: true, code: 'SPAWN_RECORD_READY' })
    } catch (error) {
      return Object.freeze({
        ok: false,
        code: typeof error?.code === 'string' ? error.code : 'SPAWN_RECORD_UNAVAILABLE',
      })
    }
  }

  function record({ action, sessionId, principal = null, details, outcome, usage } = {}) {
    if (typeof action !== 'string' || action.length === 0 || action.length > 128) {
      throw new SpawnRecordError('SPAWN_RECORD_INVALID_ACTION', 'action must be a bounded non-empty string')
    }
    if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 128) {
      throw new SpawnRecordError('SPAWN_RECORD_INVALID_SESSION', 'sessionId must be a bounded non-empty string')
    }
    if (principal !== null && (typeof principal !== 'string' || principal.length === 0 || principal.length > 200)) {
      throw new SpawnRecordError('SPAWN_RECORD_INVALID_PRINCIPAL', 'principal must be null or a bounded string')
    }

    const key = loadOrCreateKey()
    const previous = loadHead()
    const entry = {
      sequence: previous.sequence + 1,
      at: now(),
      action,
      sessionId,
      /* Supplied by the MAIN process from the product account store, never by
         the renderer, because an identity a page can choose is not an identity.
         It stays nullable here on purpose: this writer is used by callers that
         legitimately have no account concept, and a null is an honest "this
         record cannot say who". shell/main.cjs passes a stated word rather than
         a null, so its own records are never ambiguous. */
      principal,
      details: boundedDetails(details),
      previousHash: previous.hash,
    }
    /* Assigned rather than declared in the literal so the key is ABSENT, not
       present-and-undefined, on a record without an outcome. JSON.stringify
       drops an undefined value anyway, but canonicalJson branches on the
       property and an explicit absence is what that branch is reading. */
    const recordedOutcome = boundedOutcome(outcome)
    if (recordedOutcome !== undefined) entry.outcome = recordedOutcome
    /* Assigned the same way and for the same reason as the outcome above: the
       key must be ABSENT rather than present-and-undefined, because
       canonicalJson branches on the property. */
    const recordedUsage = boundedUsage(usage)
    if (recordedUsage !== undefined) entry.usage = recordedUsage
    const eventHash = sha256Hex(canonicalJson(entry))
    const signature = crypto.sign(null, Buffer.from(eventHash, 'hex'), key).toString('base64')
    const line = JSON.stringify({ ...entry, eventHash, signature }) + '\n'

    fs.mkdirSync(directory, { recursive: true })
    appendDurable(ledgerPath, line)
    /* Only advance the in-memory head after the bytes are durable. If the
       append throws, the next attempt must chain from the same predecessor. */
    head = { sequence: entry.sequence, hash: eventHash }

    return Object.freeze({
      sequence: entry.sequence,
      eventHash,
      at: entry.at,
      durable: true,
      signed: true,
    })
  }

  /* How many signatures this recorder has actually checked.
   *
   * It exists so a test can assert that unchanged bytes are not re-verified
   * WITHOUT measuring elapsed time. A timing assertion for this was written
   * first and was flaky: it went red on a byte-identical restore during a
   * mutation round, which is the worst behaviour a test can have -- it accuses
   * correct code. Counting the work is deterministic, and it is also a stronger
   * claim than "it was faster", because "faster" can be true while the check is
   * quietly being skipped for the wrong reason.
   *
   * A count, never a result. It is not returned by `history()` and crosses no
   * IPC boundary. */
  let signatureChecks = 0

  /* Check a run of records, chaining from a stated predecessor.
   *
   * `alreadyVerified` and `previousHash` are what let this be used both for a
   * whole chain (0, GENESIS) and for records appended since a chain was last
   * checked. Line numbers in a failure are always positions in the WHOLE file,
   * because that is the only number that means anything to whoever reads it. */
  function verifyRun(lines, publicKey, alreadyVerified, previousHash) {
    const total = alreadyVerified + lines.length
    let head = previousHash
    let expectedSequence = alreadyVerified + 1
    for (const [index, line] of lines.entries()) {
      const at = alreadyVerified + index + 1
      let entry
      try { entry = JSON.parse(line) } catch {
        return { ok: false, code: 'SPAWN_RECORD_LEDGER_CORRUPT', line: at, count: total }
      }
      const { eventHash, signature, ...body } = entry
      if (body.sequence !== expectedSequence || body.previousHash !== head) {
        return { ok: false, code: 'SPAWN_RECORD_CHAIN_BROKEN', line: at, count: total }
      }
      if (sha256Hex(canonicalJson(body)) !== eventHash) {
        return { ok: false, code: 'SPAWN_RECORD_HASH_MISMATCH', line: at, count: total }
      }
      let signatureHolds = false
      try {
        signatureChecks += 1
        signatureHolds = crypto.verify(null, Buffer.from(eventHash, 'hex'), publicKey, Buffer.from(signature, 'base64'))
      } catch { signatureHolds = false }
      if (!signatureHolds) {
        return { ok: false, code: 'SPAWN_RECORD_BAD_SIGNATURE', line: at, count: total }
      }
      head = eventHash
      expectedSequence += 1
    }
    return { ok: true, count: total, head }
  }

  const readLedgerBytes = () => (fs.existsSync(ledgerPath) ? fs.readFileSync(ledgerPath) : Buffer.alloc(0))
  const splitRecords = (text) => text.split('\n').filter(line => line.trim().length > 0)

  /* Independent verification: recomputes every hash and checks every signature
     and every link, every time it is called. This is what makes the record
     worth having -- a chain nothing ever checks is decoration.

     DELIBERATELY NOT CACHED, even though it fills the cache below. A function
     named `verify` that can answer from something it decided earlier is not an
     independent check, and the tests that call it are entitled to a real one.
     `history()` is the caller that needs the cheap answer, and it asks for it
     by name. */
  function verify() {
    if (!fs.existsSync(ledgerPath)) return Object.freeze({ ok: true, count: 0 })
    const publicKey = crypto.createPublicKey(loadOrCreateKey())
    const raw = readLedgerBytes()
    const lines = splitRecords(raw.toString('utf8'))
    const outcome = verifyRun(lines, publicKey, 0, GENESIS)
    rememberVerdict(raw, outcome)
    const { head, ...reportable } = outcome
    return Object.freeze(reportable)
  }

  /* ------------------------------------------------------------------
     Not re-checking bytes that have already been checked.

     MEASURED by the performance lane on the real module: verifying the whole
     chain costs ~0.093 ms per record ever written, forever, because the ledger
     is append-only and nothing rotates it. 1,000 sessions is 102 ms; 10,000 is
     912 ms; 50,000 is 4.65 seconds. All of it synchronous, and all of it on the
     Electron MAIN process, which is also what forwards output events for every
     live agent session -- so a home screen that asked this question casually
     could stall every running agent for a second at a time.

     THE CACHE IS KEYED ON THE LEDGER'S CONTENT HASH, AND THAT CHOICE IS THE
     WHOLE SECURITY ARGUMENT. The obvious key is size plus modification time,
     and it is cheaper still, but it is not sound: an in-place edit of one old
     record that preserves the file's length, with the timestamp put back, is
     exactly the tamper this chain exists to make visible, and a size-and-mtime
     key would answer `verified: true` over it. Hashing the bytes cannot be
     fooled that way -- identical hash means identical content means the earlier
     verdict is still the correct verdict, with no assumption about anything.

     THAT IS MEASURED, NOT ARGUED. The performance lane built the attack against
     this module independently and reported the numbers: after editing one old
     record in place, the file's size came back BYTE-IDENTICAL (163892 -> 163892)
     and the restored modification time landed within half a millisecond. Those
     are precisely the two values a size-and-mtime key compares, so that key
     would have found them equal and served a stale `verified: true` over a
     tampered chain. The content hash catches it. Anyone tempted to make this
     cheaper by keying on stat() should read that sentence twice.

     It costs one sha256 pass over the file, which is roughly seventy times
     cheaper than the ed25519 chain it replaces, so this is not a trade of
     safety for speed. The guarantee is unchanged.

     A GROWN LEDGER is the ordinary case: the file gains records and keeps its
     prefix. When the previously-verified bytes are proven byte-identical (same
     hash over the same leading range), the appended records are checked and
     chained onto the head that was already established. Anything else -- the
     file shrank, the prefix moved, the previous check failed, the boundary is
     not a record boundary -- falls through to the full verification.
     ------------------------------------------------------------------ */
  /* HOW MANY RUNS, AND HOW MANY OF THEM WORKED -- counted over the WHOLE chain,
   * because the tail cannot answer it.
   *
   * `entries` is the last 20 records and `total` is the line count, and neither
   * is the number of RUNS any more: an outcome is a second record, so a chain of
   * 6 lines can be 3 runs. A screen that kept reading `total` as a run count
   * would now overstate it, which is the same class of error this whole change
   * is repairing -- so the count a screen needs is computed here rather than
   * guessed there.
   *
   * A FULL PARSE, AND IT IS NOT THE EXPENSIVE PART. verifyRun() already walks
   * every line doing sha256 and an ed25519 verification per record; a JSON.parse
   * over the same lines is a rounding error beside it, and it is cached on the
   * same trigger -- the ledger's bytes -- so an unchanged file is counted once.
   *
   * ONE OUTCOME PER START, ENFORCED HERE RATHER THAN ASSUMED. These are bytes
   * off disk, and history() deliberately still returns records when the chain
   * does NOT verify, so a duplicated or invented outcome line is reachable. The
   * `resolved` set means a second outcome naming a start already counted is
   * ignored, and a run can therefore never be tallied as both started and
   * refused. */
  let tallyCache = null

  function cachedTally(raw, lines) {
    const hash = crypto.createHash('sha256').update(raw).digest('hex')
    if (tallyCache && tallyCache.hash === hash) return tallyCache.tally
    let starts = 0
    let started = 0
    let refused = 0
    const resolved = new Set()
    for (const line of lines) {
      let parsed
      try { parsed = JSON.parse(line) } catch { continue }
      if (parsed?.action === 'agent_session_start') { starts += 1; continue }
      if (parsed?.action !== 'agent_session_outcome') continue
      const outcome = readableOutcome(parsed.outcome)
      if (!outcome || resolved.has(outcome.resolves)) continue
      resolved.add(outcome.resolves)
      if (outcome.result === 'started') started += 1
      else refused += 1
    }
    const tally = Object.freeze({ starts, started, refused })
    tallyCache = { hash, tally }
    return tally
  }

  let verdictCache = null

  function rememberVerdict(raw, outcome) {
    verdictCache = {
      hash: crypto.createHash('sha256').update(raw).digest('hex'),
      byteLength: raw.length,
      outcome,
    }
  }

  /* The caller passes the bytes it has already read. Reading the ledger twice
     for one answer is a whole extra pass over a file that reaches tens of
     megabytes, and it bought nothing -- the caller and this function would have
     been looking at the same bytes anyway, or at two different states of the
     file, which is worse. */
  function cachedVerdict(raw) {
    const hash = crypto.createHash('sha256').update(raw).digest('hex')

    /* Same bytes, same answer. No signature is checked, and none needs to be. */
    if (verdictCache && verdictCache.hash === hash) return verdictCache.outcome

    const publicKey = crypto.createPublicKey(loadOrCreateKey())
    const usable = verdictCache
      && verdictCache.outcome.ok === true
      && raw.length > verdictCache.byteLength
      /* The old end must be a record boundary, or the "appended" region begins
         mid-record and would be split in the wrong place. A ledger whose last
         write was interrupted lands here and takes the full path. */
      && raw[verdictCache.byteLength - 1] === 0x0a
      /* MEASURED, so nobody re-derives it: relaxing the `>` above to `!==` is an
         equivalent mutant, not a hole. A shrunken ledger fails the boundary
         read (the index is past the end) and fails the prefix comparison below
         (a shorter buffer cannot hash to the longer one's hash), so it takes
         the full path either way -- confirmed by planting the change and
         watching a truncated-then-edited ledger still report unverified. The
         `>` stays because it says the intent; the safety is the two lines
         around it. */
      && crypto.createHash('sha256').update(raw.subarray(0, verdictCache.byteLength)).digest('hex') === verdictCache.hash

    const outcome = usable
      ? verifyRun(
        splitRecords(raw.subarray(verdictCache.byteLength).toString('utf8')),
        publicKey,
        verdictCache.outcome.count,
        verdictCache.outcome.head,
      )
      : verifyRun(splitRecords(raw.toString('utf8')), publicKey, 0, GENESIS)

    rememberVerdict(raw, outcome)
    return outcome
  }

  /* The newest records, for the screen that shows a person what has actually
     run on their computer.
   *
   * THREE RULES, AND EACH ONE IS THE REASON A FIELD IS MISSING BELOW.
   *
   * 1. NO PATH LEAVES THIS FUNCTION. `details` carries the session's working
   *    directory, and this reply is bound for the renderer, i.e. the DOM. The
   *    same rule keeps the engine resolver's path-bearing message inside main
   *    (see mc-agent:availability). So `details` is dropped outright rather
   *    than filtered -- a filter is a thing someone widens later.
   * 2. NO SIGNATURE OR HASH LEAVES EITHER. Neither is renderable, both invite a
   *    UI that prints them as if a reader could check them, and the check that
   *    matters has already been done here: `verified` below is this process's
   *    own answer, computed over the WHOLE chain, not over the returned tail.
   * 3. IT NEVER THROWS. A home screen that cannot render because a ledger line
   *    is malformed is a product that cannot be recovered from its own first
   *    screen. Unreadable collapses to `{ok:false, code}` and the screen says
   *    so in one sentence.
   *
   * AND ONE FIELD THAT IS PRESENT, ADDED AGAINST THOSE RULES RATHER THAN
   * AROUND THEM. `outcome` is returned because without it this reply cannot
   * distinguish a run that worked from a run that refused, and a screen built
   * on that reply said "all 3 runs still check out" after three failed starts
   * -- true about the RECORD and read by every person as a statement about
   * their agents. Rule 1 is not bent to fix that: `details` still leaves
   * nothing, because the answer to "this field carries a path" is a different
   * field, not a filter over that one. `outcome` carries a closed vocabulary
   * (`started`/`refused`), an integer, and a bare upper-case code, and
   * readableOutcome() re-imposes that shape on the way out.
   *
   * `total` is the whole chain and `entries` is the tail, deliberately: "3 of
   * 41 sessions" is a true thing a screen can say, and it cannot be said from a
   * truncated list alone. */
  function history({ limit = 20 } = {}) {
    const bounded = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 200) : 20
    let raw
    let lines
    try {
      raw = readLedgerBytes()
      lines = splitRecords(raw.toString('utf8'))
    } catch (error) {
      return Object.freeze({
        ok: false,
        code: typeof error?.code === 'string' ? error.code : 'SPAWN_RECORD_LEDGER_UNREADABLE',
      })
    }

    const entries = []
    for (const line of lines.slice(-bounded)) {
      let parsed
      try { parsed = JSON.parse(line) } catch { continue }
      if (!Number.isSafeInteger(parsed?.sequence) || typeof parsed?.at !== 'string') continue
      if (typeof parsed.action !== 'string' || typeof parsed.sessionId !== 'string') continue
      entries.push(Object.freeze({
        sequence: parsed.sequence,
        at: parsed.at,
        action: parsed.action,
        /* RE-VALIDATED ON THE WAY OUT, not trusted because the writer validated
           it on the way in. These are bytes off disk: the file is signed, but
           this function deliberately does not throw and deliberately still
           returns records when the chain does NOT verify (rule 3, and the
           reasoning under `verified` below) -- so an unverified line reaches
           here by design. Re-applying the writer's own constraint is what keeps
           the promise that this field cannot carry a path even then. */
        outcome: readableOutcome(parsed.outcome),
        /* WHAT THE TURN COST, re-validated on the way out for exactly the
           reason the outcome beside it is: these are bytes off a file this
           function deliberately returns even when the chain does NOT verify, so
           re-imposing the writer's own constraint is what keeps the promise
           that this field cannot carry a path even then. It is null on every
           record in the run ledger, which has never carried one. */
        usage: readableUsage(parsed.usage),
        /* WHOSE RUN THIS WAS. Added so a screen can show a person their OWN
           history instead of everybody's -- until this field crossed, the page
           had the records and no way to tell which of them were the signed-in
           account's, which made "your data" a sentence the product could not
           write.

           This LEDGER is deliberately not partitioned per account (see the
           account-partition note in shell/product-account.cjs): it is one
           hash-chained append-only file, and splitting it would let an account
           delete its own history and break everyone else's chain. Attribution
           is per account; storage is per device; the filtering is a VIEW.

           Re-validated on the way out like every other field here, and bounded
           to the two shapes the writer can produce -- `account:<32 hex>` or the
           stated word. Anything else becomes null rather than being rendered,
           because an identity string off disk is bytes, not a name. */
        principal: readablePrincipal(parsed.principal),
        /* See readableSessionId above for why this crosses and `details` does
           not. Re-validated on the way out like every other field here. */
        sessionId: readableSessionId(parsed.sessionId),
      }))
    }
    entries.reverse() // newest first, which is the order a reader wants

    /* Verification is reported, never assumed, and its failure is NOT this
       function's failure: the records still exist and the person should still
       see them, alongside the fact that the chain no longer checks out.

       `cachedVerdict` rather than `verify` because this is the call a screen
       makes, repeatedly, on the main process -- see the reasoning above it. The
       answer is the same answer; only the bytes it declines to re-check twice
       are different. */
    let verified = null
    try {
      verified = cachedVerdict(raw).ok === true
    } catch { verified = null }

    /* Never fatal: a screen that can list the runs must not be denied the runs
       because the counting threw. An absent tally reads downstream as "this
       record does not say", which is the same honest degradation an old record
       without an outcome gets. */
    let outcomes = null
    try {
      outcomes = cachedTally(raw, lines)
    } catch { outcomes = null }

    return Object.freeze({ ok: true, total: lines.length, entries: Object.freeze(entries), verified, outcomes })
  }

  const stats = () => Object.freeze({ signatureChecks })

  return Object.freeze({ availability, record, verify, history, stats, ledgerPath, keyPath })
}

/* Every code availability() can answer with when a record could not be
 * written, exported for the same reason shell/agent-host.cjs exports its own
 * list: this half of the availability answer reaches the SAME two surfaces,
 * and one of them is the page carrying the Start control. Until this existed
 * that page had copy for none of these and showed the bare identifier beside a
 * disabled button -- a refusal a person cannot act on, which is the defect the
 * engine half was just repaired for, in a smaller size.
 *
 * SPAWN_RECORD_UNAVAILABLE is included because it is the catch-all the wrapper
 * substitutes for any error carrying no string code, so it is reachable by
 * construction and not only by a named throw. */
const RECORD_AVAILABILITY_CODES = Object.freeze([
  'SPAWN_RECORD_NO_KEYSTORE',
  'SPAWN_RECORD_NO_DIRECTORY',
  'SPAWN_RECORD_KEYSTORE_UNAVAILABLE',
  'SPAWN_RECORD_KEY_UNREADABLE',
  'SPAWN_RECORD_LEDGER_CORRUPT',
  'SPAWN_RECORD_UNAVAILABLE',
])

module.exports = { createSpawnRecorder, SpawnRecordError, GENESIS, RECORD_AVAILABILITY_CODES }
