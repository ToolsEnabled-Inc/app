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

/* THE READ GETS THE RETRY THE WRITE ALREADY HAD.
 *
 * This file documented the Windows transient-handle problem and defended
 * against it in one direction only. That asymmetry mattered far more than it
 * looks: a dropped write loses ONE setting, while a dropped read at startup
 * makes the whole record read as empty, which is the silent factory reset this
 * store exists to end -- and it then let the next write flatten a file that was
 * never actually damaged. Measured: one EBUSY on the startup read was enough,
 * with a single attempt made before this.
 *
 * EEXIST is deliberately not in this set. It belongs to the write path's
 * `openSync(temporary, 'wx')` and means nothing for a read; carrying it over
 * would be widening a rule by copy-paste. ENOENT is not retried either -- a
 * file that is genuinely absent is a first launch, not a transient. */
const RETRYABLE_READ_ERRORS = new Set(['EPERM', 'EACCES', 'EBUSY'])

/* How many damaged records may be set aside before this store stops trying.
   Bounded so a file that is damaged on every launch cannot fill a disk with
   copies of itself; reaching the bound refuses the write, which still does not
   destroy anything. */
const MAX_QUARANTINE_FILES = 8
const QUARANTINE_PREFIX = 'renderer-prefs.damaged'

/* THE SET-ASIDE COPY IS DATED, because the person is going to be told about it
   and "renderer-prefs.damaged-3.json" does not answer the question they will
   actually have, which is WHICH ONE IS MINE. An index only orders the copies
   against each other; a date says whether this is the settings they lost this
   morning or a file from a fault three months ago they already gave up on.
   Colons and dots are illegal in a Windows filename, so the ISO timestamp is
   written with dashes throughout. */
function quarantineFileName(stamp) {
  return `${QUARANTINE_PREFIX}-${stamp.toISOString().replace(/[:.]/g, '-')}.json`
}

function isQuarantineFile(name) {
  /* The dotted form is what builds before the dated name wrote. It is counted
     against the bound so an upgrade cannot restart the budget from zero. */
  return name === `${QUARANTINE_PREFIX}.json` || name.startsWith(`${QUARANTINE_PREFIX}-`)
}

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

function createRendererPrefs({ directory, fs, path, randomUUID, pid = process.pid, now = () => new Date() }) {
  if (!directory) throw new TypeError('createRendererPrefs requires a directory')
  const file = path.join(directory, RECORD_FILE)

  let record = null
  let damaged = null
  /* WHERE THE UNREADABLE FILE WENT, kept so the product can say it out loud.
     Preserving the bytes and not telling anybody is only half a fix: the person
     still sees every setting they chose replaced by defaults, and a silent
     recovery is indistinguishable from the silent factory reset it replaced.
     This is the fact src/settings-recovery-notice.js turns into a sentence. */
  let preservedAt = null

  function readFileWithRetry() {
    let lastError = null
    for (let attempt = 0; attempt < PERSIST_ATTEMPTS; attempt += 1) {
      try {
        return { text: fs.readFileSync(file, 'utf8'), error: null }
      } catch (error) {
        lastError = error
        if (!RETRYABLE_READ_ERRORS.has(error && error.code)) break
        if (attempt < PERSIST_ATTEMPTS - 1) pauseSync(PERSIST_BACKOFF_MS[attempt])
      }
    }
    return { text: null, error: lastError }
  }

  function load() {
    if (record) return record
    const read = readFileWithRetry()
    if (read.error) {
      const error = read.error
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
    const parsed = parseRecord(read.text)
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

  /* A NAME NOTHING IS ALREADY USING, RESERVED BEFORE THE MOVE.
     `wx` fails rather than clobbering, so a previous quarantine cannot be
     overwritten by the next one. The reservation is then replaced by the
     rename, which is why creating the empty file first is not a wasted step.

     THE BOUND IS COUNTED, NOT WALKED. While the names were an index sequence,
     trying them in order both found a free name and enforced the limit. A dated
     name has no order to walk, so the copies already on disk are counted
     directly -- and a directory that cannot be listed REFUSES rather than
     counting zero, because "I could not check the limit" must not read as
     "the limit is clear". */
  function reserveQuarantineName() {
    let existing
    try {
      existing = fs.readdirSync(directory).filter(isQuarantineFile).length
    } catch (error) {
      return { path: null, error, atLimit: false }
    }
    if (existing >= MAX_QUARANTINE_FILES) return { path: null, error: null, atLimit: true }

    /* Two damaged records inside one millisecond would collide on the dated
       name. `wx` catches that instead of one silently replacing the other, and
       the suffix disambiguates them without losing the date. */
    const stamp = now()
    for (let attempt = 0; attempt < MAX_QUARANTINE_FILES; attempt += 1) {
      const name = quarantineFileName(stamp)
      const candidate = path.join(directory, attempt === 0 ? name : name.replace(/\.json$/, `-${attempt}.json`))
      try {
        fs.closeSync(fs.openSync(candidate, 'wx'))
        return { path: candidate, error: null, atLimit: false }
      } catch (error) {
        if (error && error.code === 'EEXIST') continue
        return { path: null, error, atLimit: false }
      }
    }
    return { path: null, error: null, atLimit: true }
  }

  /* WHAT A WRITE MUST NOT DO TO A RECORD IT COULD NOT READ.
   *
   * The comment in load() states that an unreadable file is not an empty one
   * and that the next write must not flatten it. That was the stated
   * invariant; it was not implemented, and the two sibling stores in this same
   * repository DO implement it -- durable-memory-file.js refuses with
   * DURABLE_MEMORY_DAMAGED at two sites and agent-org-store.js refuses with
   * AGENT_ORG_STORE_DAMAGED. This store was copied from the first of those and
   * the check did not come with the comment.
   *
   * MEASURED, on this file before this function existed: a settings file
   * holding mc.theme/mc.text/mc.live.fleet plus a drained-origin history, made
   * unparseable, was reported as `damaged`, read as zero values, and the very
   * next set() returned {ok:true} having replaced the whole file with the one
   * key just written. Nothing was recoverable anywhere on disk. That is the
   * same silent factory reset the port-origin fix exists to end, one layer
   * down, and it survived that fix.
   *
   * IT SETS ASIDE RATHER THAN REFUSING OUTRIGHT, which is the one place this
   * deliberately differs from its two siblings, and the reason is a rescue path
   * that already exists here and does not exist there: a damaged record leaves
   * every origin undrained ON PURPOSE, so that the browser copy of a pre-fix
   * install can still be adopted on this very launch. A flat refusal would
   * close that rescue and would also leave a person permanently unable to
   * change a setting. Moving the unreadable bytes aside keeps both properties:
   * nothing is destroyed, and the application still works.
   *
   * A quarantine that cannot be taken REFUSES. That is the case where the file
   * is held by something else, and it is exactly when destroying it would be
   * worst -- the next launch, whose read now retries, is very likely to recover
   * the record intact. */
  function quarantineDamaged() {
    const reserved = reserveQuarantineName()
    if (!reserved.path) {
      const detail = reserved.atLimit
        ? `${MAX_QUARANTINE_FILES} damaged copies have already been set aside`
        : `a copy could not be set aside (${reserved.error && reserved.error.code ? reserved.error.code : 'unknown error'})`
      return failure('MC_PREFS_DAMAGED', `Refusing to overwrite settings that could not be read (${damaged}): ${detail}.`)
    }
    let lastError = null
    for (let attempt = 0; attempt < PERSIST_ATTEMPTS; attempt += 1) {
      try {
        fs.renameSync(file, reserved.path)
        preservedAt = reserved.path
        return { ok: true, preservedAt: reserved.path }
      } catch (error) {
        lastError = error
        /* The record was damaged because the read failed, and the file has
           since gone. There is nothing left to preserve and nothing to
           destroy, so the write may proceed -- but the name reserved for it
           does not get to stay. An empty file left here would spend one of the
           eight slots and, now that the product POINTS A PERSON AT THESE
           FILES, would offer them a zero-byte "recovered copy" of settings
           that were never in it. */
        if (error && error.code === 'ENOENT') {
          try { fs.unlinkSync(reserved.path) } catch { /* nothing was promised by the reservation */ }
          return { ok: true, preservedAt: null }
        }
        if (!RETRYABLE_WRITE_ERRORS.has(error && error.code)) break
        if (attempt < PERSIST_ATTEMPTS - 1) pauseSync(PERSIST_BACKOFF_MS[attempt])
      }
    }
    try { fs.unlinkSync(reserved.path) } catch { /* the reservation is not worth a second failure */ }
    return failure('MC_PREFS_DAMAGED', `Refusing to overwrite settings that could not be read (${damaged}): a copy could not be set aside (${lastError && lastError.code ? lastError.code : 'unknown error'}).`)
  }

  function persist(next) {
    const text = `${JSON.stringify(next)}\n`
    if (Buffer.byteLength(text, 'utf8') > MAX_RECORD_BYTES) {
      return failure('MC_PREFS_TOO_LARGE', 'The settings file would exceed its size limit.')
    }

    /* Every mutator funnels through here, so the damaged-record rule is
       enforced once rather than at four call sites that can drift apart. */
    let setAside = null
    if (damaged) {
      const preserved = quarantineDamaged()
      if (!preserved.ok) return preserved
      setAside = preserved.preservedAt
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
        /* `preservedAt` deliberately survives `damaged` being cleared. The
           record is healthy again from this line on, but the person's OLD
           settings are still sitting in that dated file and they have not been
           told yet -- the write that clears the damage is the very call that
           carries the news back to the renderer. */
        return setAside ? { ok: true, preservedAt: setAside } : { ok: true }
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
        /* Null until a write has actually moved the file. Saying where a copy
           WILL go is a promise; this field is only ever a report of something
           that has happened. */
        preservedAt,
      }
    },

    isDrained(origin) {
      return load().drainedOrigins.includes(origin)
    },

    /* THE `unchanged` SHORTCUTS BELOW ARE GUARDED ON `damaged`, ALL THREE.
       "Nothing to do" is a claim about the file, and while the record is
       damaged this store does not know what the file says -- values reads
       empty, so `clear()` reported that it had emptied a record that was in
       fact full, and `remove()` reported that a key was already gone while it
       sat on disk. Reporting success from an absence we could not read is the
       same mistake as flattening it, minus the data loss. */
    set(key, value) {
      const invalid = validateEntry(key, value)
      if (invalid) return failure('MC_PREFS_INVALID_ENTRY', invalid)
      const current = load()
      if (!damaged && current.values[key] === value) return { ok: true, unchanged: true }
      if (!(key in current.values) && Object.keys(current.values).length >= MAX_KEYS) {
        return failure('MC_PREFS_TOO_MANY_KEYS', `The settings file already holds its limit of ${MAX_KEYS} keys.`)
      }
      return persist({ ...current, values: { ...current.values, [key]: value } })
    },

    remove(key) {
      if (typeof key !== 'string') return failure('MC_PREFS_INVALID_ENTRY', 'a settings key must be a string')
      const current = load()
      if (!damaged && !(key in current.values)) return { ok: true, unchanged: true }
      const values = { ...current.values }
      delete values[key]
      return persist({ ...current, values })
    },

    clear() {
      const current = load()
      if (!damaged && Object.keys(current.values).length === 0) return { ok: true, unchanged: true }
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
      /* The drain is usually the FIRST write of a launch, so it is usually the
         call that sets a damaged record aside. Dropping `preservedAt` here
         would lose the news on the one path most likely to carry it. */
      return written.preservedAt
        ? { ok: true, migrated, skipped, preservedAt: written.preservedAt }
        : { ok: true, migrated, skipped }
    },
  }
}

module.exports = {
  MAX_DRAINED_ORIGINS,
  MAX_KEYS,
  MAX_KEY_LENGTH,
  MAX_QUARANTINE_FILES,
  MAX_RECORD_BYTES,
  MAX_VALUE_LENGTH,
  QUARANTINE_PREFIX,
  RECORD_FILE,
  STORAGE_VERSION,
  createRendererPrefs,
  isQuarantineFile,
}
