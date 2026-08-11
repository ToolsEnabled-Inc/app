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
  return JSON.stringify([
    record.sequence,
    record.at,
    record.action,
    record.sessionId,
    record.principal,
    record.details,
    record.previousHash,
  ])
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

function createSpawnRecorder({ safeStorage, directory, now = () => new Date().toISOString() } = {}) {
  if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function') {
    throw new SpawnRecordError('SPAWN_RECORD_NO_KEYSTORE', 'A keystore with isEncryptionAvailable() is required')
  }
  if (typeof directory !== 'string' || directory.length === 0) {
    throw new SpawnRecordError('SPAWN_RECORD_NO_DIRECTORY', 'A record directory is required')
  }

  const keyPath = path.join(directory, KEY_FILE)
  const ledgerPath = path.join(directory, LEDGER_FILE)
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

  function record({ action, sessionId, principal = null, details } = {}) {
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
      /* Null until an account exists. When one does, the MAIN process reads it
         and puts it here; it is never accepted from the renderer, because an
         identity a page can choose is not an identity. */
      principal,
      details: boundedDetails(details),
      previousHash: previous.hash,
    }
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

  /* Independent verification: recomputes every hash and checks every signature
     and every link. This is what makes the record worth having -- a chain
     nothing ever checks is decoration. */
  function verify() {
    if (!fs.existsSync(ledgerPath)) return Object.freeze({ ok: true, count: 0 })
    const key = loadOrCreateKey()
    const publicKey = crypto.createPublicKey(key)
    const lines = fs.readFileSync(ledgerPath, 'utf8').split('\n').filter(line => line.trim().length > 0)
    let previousHash = GENESIS
    let expectedSequence = 1
    for (const [index, line] of lines.entries()) {
      let entry
      try { entry = JSON.parse(line) } catch {
        return Object.freeze({ ok: false, code: 'SPAWN_RECORD_LEDGER_CORRUPT', line: index + 1, count: lines.length })
      }
      const { eventHash, signature, ...body } = entry
      if (body.sequence !== expectedSequence || body.previousHash !== previousHash) {
        return Object.freeze({ ok: false, code: 'SPAWN_RECORD_CHAIN_BROKEN', line: index + 1, count: lines.length })
      }
      if (sha256Hex(canonicalJson(body)) !== eventHash) {
        return Object.freeze({ ok: false, code: 'SPAWN_RECORD_HASH_MISMATCH', line: index + 1, count: lines.length })
      }
      let verified = false
      try {
        verified = crypto.verify(null, Buffer.from(eventHash, 'hex'), publicKey, Buffer.from(signature, 'base64'))
      } catch { verified = false }
      if (!verified) {
        return Object.freeze({ ok: false, code: 'SPAWN_RECORD_BAD_SIGNATURE', line: index + 1, count: lines.length })
      }
      previousHash = eventHash
      expectedSequence += 1
    }
    return Object.freeze({ ok: true, count: lines.length })
  }

  return Object.freeze({ availability, record, verify, ledgerPath, keyPath })
}

module.exports = { createSpawnRecorder, SpawnRecordError, GENESIS }
