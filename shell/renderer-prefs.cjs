'use strict'

/* WHERE A PERSON'S SETTINGS ACTUALLY LIVE.
 *
 * Everything the renderer persisted -- theme, text size, mc.live.*, mc.write.*,
 * the first-run profile, the chatbox settings -- was browser storage, and
 * browser storage is partitioned by ORIGIN. The origin of this application is
 * http://127.0.0.1:<port>, and shell/port-scan.cjs chooses <port> by scanning
 * 4601-4609 at launch. So the settings were, without anyone deciding this,
 * keyed to whichever port happened to be free the first time somebody opened
 * the app. Relaunch with that port held -- a lingering process, a QA build, a
 * second install, a fast restart -- and the app comes up one port along, which
 * is a different origin, which is an empty partition. Every choice the person
 * made is gone, there is no error, and the only available conclusion is that
 * the software is broken. Measured on the packaged build: a run that chose
 * black theme on 4603 painted white on 4604 with all six probe keys reading
 * null.
 *
 * This file is the fix: the settings live in ONE file in userData, which no
 * port can partition. The renderer keeps calling localStorage; what changed is
 * what localStorage IS (see public/durable-storage.js and the mcPrefs bridge in
 * shell/fleet-profile-preload.cjs).
 *
 * ONE STORE, NOT TWO. The repeated defect in this codebase is a second copy
 * that drifts from the first, so this file is deliberately the only writer of
 * its record, and the browser copy it migrates from is drained exactly once per
 * origin and then never consulted again. `drainedOrigins` is what makes that
 * true, and it is why a key the person DELETED after migrating cannot come back
 * from the stale browser copy on the next launch.
 *
 * IT IS NOT A SECURITY BOUNDARY, AND IT DOES NOT WEAKEN ONE. The origin
 * partition was never doing security work for these keys: src/checkout-principal.js
 * states plainly that anything with devtools could write a different name into
 * localStorage, which is why identity is NOT taken from it. Nothing secret is
 * stored here -- no password, no token, no account principal -- and the IPC in
 * front of it is gated on the application's own main frame at its own origin,
 * the same check the fleet profile uses. Moving preferences out of the browser
 * partition and into a per-user file under userData does not widen who can read
 * them: a process that can read this file could already read the LevelDB the
 * browser partition was kept in.
 */

const STORAGE_VERSION = 1
const RECORD_FILE = 'renderer-prefs.json'

/* Bounds exist so a page cannot turn a preferences file into unbounded disk.
   They are generous against real settings -- the whole shipped set is a few
   hundred bytes -- and the largest single value the product stores is a graph
   position map. */
const MAX_KEYS = 512
const MAX_KEY_LENGTH = 256
const MAX_VALUE_LENGTH = 64 * 1024
const MAX_RECORD_BYTES = 1024 * 1024
const MAX_DRAINED_ORIGINS = 32

/* See the note in persist(): a Windows replace can fail transiently because
   another process is briefly holding the file. Four short waits totalling 15ms
   in the worst case, which is under a rendered frame. */
const PERSIST_ATTEMPTS = 5
const PERSIST_BACKOFF_MS = Object.freeze([1, 2, 4, 8])
const RETRYABLE_WRITE_ERRORS = new Set(['EPERM', 'EACCES', 'EBUSY', 'EEXIST'])

/* A synchronous pause. The whole store is synchronous on purpose -- it stands
   in for localStorage, which is durable when the setter returns -- so the retry
   cannot hand control back to the event loop and let a second write interleave
   with this one. */
function pauseSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

function failure(code, message) {
  return { ok: false, error: { code, message } }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function emptyRecord() {
  return { storageVersion: STORAGE_VERSION, values: {}, drainedOrigins: [] }
}

/* A malformed or future-versioned record is NOT treated as "no settings and
   carry on quietly". It starts empty so the app still opens, but it does not
   mark anything drained, so a browser copy that is still reachable on this
   origin can be adopted on this very launch and the person gets their settings
   back instead of a silent reset -- which is the entire failure this file
   exists to end. */
function parseRecord(text) {
  let parsed
  try { parsed = JSON.parse(text) } catch {
    return { record: emptyRecord(), damaged: 'the settings file contains malformed JSON' }
  }
  if (!isPlainObject(parsed)) {
    return { record: emptyRecord(), damaged: 'the settings file does not contain a JSON object' }
  }
  if (parsed.storageVersion !== STORAGE_VERSION) {
    return { record: emptyRecord(), damaged: `the settings file has storage version ${JSON.stringify(parsed.storageVersion)}, which this build does not understand` }
  }
  const values = {}
  if (isPlainObject(parsed.values)) {
    for (const [key, value] of Object.entries(parsed.values)) {
      if (typeof key === 'string' && typeof value === 'string') values[key] = value
    }
  }
  const drainedOrigins = Array.isArray(parsed.drainedOrigins)
    ? parsed.drainedOrigins.filter((origin) => typeof origin === 'string').slice(0, MAX_DRAINED_ORIGINS)
    : []
  return { record: { storageVersion: STORAGE_VERSION, values, drainedOrigins }, damaged: null }
}

function validateEntry(key, value) {
  if (typeof key !== 'string' || key.length === 0) return 'a settings key must be a non-empty string'
  if (key.length > MAX_KEY_LENGTH) return `a settings key may not exceed ${MAX_KEY_LENGTH} characters`
  if (typeof value !== 'string') return 'a settings value must be a string'
  if (value.length > MAX_VALUE_LENGTH) return `a settings value may not exceed ${MAX_VALUE_LENGTH} characters`
  return null
}

function createRendererPrefs({ directory, fs, path, randomUUID, pid = process.pid }) {
  if (!directory) throw new TypeError('createRendererPrefs requires a directory')
  const file = path.join(directory, RECORD_FILE)

  let record = null
  let damaged = null

  function load() {
    if (record) return record
    let text
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        record = emptyRecord()
        return record
      }
      /* An unreadable file is NOT an empty one. Returning empty here would
         hand the renderer a blank slate and let the next write flatten
         settings that are still on disk -- a fix that wipes settings is the
         same defect wearing a different hat. The in-memory record stays empty
         for this launch, but `damaged` is reported and nothing is drained. */
      record = emptyRecord()
      damaged = `the settings file could not be read (${error && error.code ? error.code : 'unknown error'})`
      return record
    }
    const parsed = parseRecord(text)
    record = parsed.record
    damaged = parsed.damaged
    return record
  }

  function attemptPersist(text) {
    const temporary = path.join(directory, `.renderer-prefs-${pid}-${randomUUID()}.tmp`)
    let descriptor
    try {
      fs.mkdirSync(directory, { recursive: true })
      descriptor = fs.openSync(temporary, 'wx')
      fs.writeFileSync(descriptor, text, 'utf8')
      /* fsync before rename: the proof for this fix force-kills the process
         between launches precisely so that a store which is only durable at a
         graceful exit cannot pass. */
      fs.fsyncSync(descriptor)
      fs.closeSync(descriptor)
      descriptor = undefined
      fs.renameSync(temporary, file)
      return null
    } catch (error) {
      return error
    } finally {
      if (descriptor !== undefined) {
        try { fs.closeSync(descriptor) } catch { /* closing a failed handle */ }
      }
      try { fs.unlinkSync(temporary) } catch { /* already renamed away */ }
    }
  }

  function persist(next) {
    const text = `${JSON.stringify(next)}\n`
    if (Buffer.byteLength(text, 'utf8') > MAX_RECORD_BYTES) {
      return failure('MC_PREFS_TOO_LARGE', 'The settings file would exceed its size limit.')
    }

    /* WINDOWS WILL REFUSE THIS RENAME AT RANDOM, and it is not a disk problem.
       Measured here rather than reasoned about: writing 512 settings in a row
       through this function failed twice with EPERM. Something else on the
       machine -- Defender and the search indexer are the usual pair -- holds a
       transient handle on a file that was created a millisecond ago, and the
       replace fails while everything about the request is valid.

       Left alone, that is a quiet version of the defect this whole file exists
       to end: the write fails, every call site in src/ already wraps storage in
       try/catch and ignores it, and the person's setting is simply not there
       next time. Retrying a handful of times with a short backoff is the
       standard mitigation for this class, and the total wait is bounded well
       under a frame so a settings click still feels instant.

       Persistent failures still fail. A full disk or a read-only profile must
       be reported, not retried into looking like success. */
    let lastError = null
    for (let attempt = 0; attempt < PERSIST_ATTEMPTS; attempt += 1) {
      lastError = attemptPersist(text)
      if (lastError === null) {
        record = next
        damaged = null
        return { ok: true }
      }
      if (!RETRYABLE_WRITE_ERRORS.has(lastError && lastError.code)) break
      if (attempt < PERSIST_ATTEMPTS - 1) pauseSync(PERSIST_BACKOFF_MS[attempt])
    }
    return failure('MC_PREFS_WRITE_FAILED', `Settings could not be saved (${lastError && lastError.code ? lastError.code : 'unknown error'}).`)
  }

  return {
    file,

    snapshot() {
      const current = load()
      return {
        ok: true,
        values: { ...current.values },
        drainedOrigins: [...current.drainedOrigins],
        damaged,
      }
    },

    isDrained(origin) {
      return load().drainedOrigins.includes(origin)
    },

    set(key, value) {
      const invalid = validateEntry(key, value)
      if (invalid) return failure('MC_PREFS_INVALID_ENTRY', invalid)
      const current = load()
      if (current.values[key] === value) return { ok: true, unchanged: true }
      if (!(key in current.values) && Object.keys(current.values).length >= MAX_KEYS) {
        return failure('MC_PREFS_TOO_MANY_KEYS', `The settings file already holds its limit of ${MAX_KEYS} keys.`)
      }
      return persist({ ...current, values: { ...current.values, [key]: value } })
    },

    remove(key) {
      if (typeof key !== 'string') return failure('MC_PREFS_INVALID_ENTRY', 'a settings key must be a string')
      const current = load()
      if (!(key in current.values)) return { ok: true, unchanged: true }
      const values = { ...current.values }
      delete values[key]
      return persist({ ...current, values })
    },

    clear() {
      const current = load()
      if (Object.keys(current.values).length === 0) return { ok: true, unchanged: true }
      return persist({ ...current, values: {} })
    },

    /* MIGRATION, ONCE PER ORIGIN.
     *
     * `entries` is whatever the browser partition for `origin` still holds.
     * A key already in the durable record WINS -- the durable record is the
     * newer decision by construction, because every write since the fix went
     * there. Only keys the durable record has never heard of are adopted.
     *
     * Marking the origin drained is the half that stops a resurrection bug:
     * without it, a key the person deleted after migrating would be re-adopted
     * from the untouched browser copy on the very next launch, and a setting
     * that comes back from the dead is a worse bug than one that resets.
     *
     * The browser copy is deliberately NOT deleted. If this fix is wrong, the
     * old data is still there to recover; and once the origin is marked, it is
     * provably never read again, so it cannot disagree with anything. */
    drain(origin, entries) {
      if (typeof origin !== 'string' || origin.length === 0) {
        return failure('MC_PREFS_INVALID_ORIGIN', 'a drain requires the origin it is draining')
      }
      const current = load()
      if (current.drainedOrigins.includes(origin)) {
        return { ok: true, migrated: 0, alreadyDrained: true }
      }
      const values = { ...current.values }
      let migrated = 0
      let skipped = 0
      for (const entry of Array.isArray(entries) ? entries : []) {
        if (!Array.isArray(entry) || entry.length !== 2) { skipped += 1; continue }
        const [key, value] = entry
        if (validateEntry(key, value)) { skipped += 1; continue }
        if (key in values) continue
        if (Object.keys(values).length >= MAX_KEYS) { skipped += 1; continue }
        values[key] = value
        migrated += 1
      }
      const drainedOrigins = [...current.drainedOrigins, origin].slice(-MAX_DRAINED_ORIGINS)
      const written = persist({ storageVersion: STORAGE_VERSION, values, drainedOrigins })
      if (!written.ok) return written
      return { ok: true, migrated, skipped }
    },
  }
}

module.exports = {
  MAX_DRAINED_ORIGINS,
  MAX_KEYS,
  MAX_KEY_LENGTH,
  MAX_RECORD_BYTES,
  MAX_VALUE_LENGTH,
  RECORD_FILE,
  STORAGE_VERSION,
  createRendererPrefs,
}
