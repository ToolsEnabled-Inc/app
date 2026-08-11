'use strict'

/* WHAT HAPPENS TO A PERSON'S DATA WHEN THE PRODUCT IS RENAMED.
 *
 * Electron derives userData from productName: <appData>/<productName>. The
 * product was called "Mission Control" and is now called "ToolsEnabled", so
 * every existing installation's data sits in %APPDATA%\Mission Control and
 * every new build reads %APPDATA%\ToolsEnabled, which is empty. Nothing errors.
 * The app opens on defaults, and the only available conclusion is that the
 * software threw the person's settings away.
 *
 * THIS IS THE SAME DEFECT AS THE PORT ONE, ONE LEVEL UP. shell/renderer-prefs.cjs
 * exists because settings were keyed to http://127.0.0.1:<port> and a changed
 * port read as a new user. This file exists because settings are keyed to a
 * directory named after the product and a changed name reads as a new user.
 * Both are the house's recurring defect: an ABSENCE -- an empty storage
 * partition, a missing directory -- taken as a statement that there is nothing
 * to keep, when it is really a statement that we are looking in the wrong
 * place. The fix in both cases is the same shape: before concluding "new user",
 * look where the data would be if this were an upgrade.
 *
 * IT RUNS BEFORE ANYTHING READS userData. shell/main.cjs resolves
 * FLEET_PROFILE_FILE, CRASH_DUMP_DIR, WORKSPACE_ROOT and the renderer-prefs
 * store at module scope, so the adoption has to happen above all of them or it
 * would be adopting into a directory the app has already begun writing.
 *
 * IT DECIDES EXACTLY ONCE, AND A DAMAGED RECORD MEANS "DECIDED".
 * The record file below is written before the copy starts, not after. If it is
 * present and unreadable we do NOT adopt: an unparseable record still proves a
 * previous run reached a decision, and re-running the copy could resurrect data
 * the person deliberately deleted. Treating a damaged record as "no record" is
 * exactly the absence-as-consent mistake this file exists to correct, so it is
 * refused here too.
 *
 * WITH ONE EXCEPTION, AND IT IS THE SAME DEFECT ONE LEVEL UP AGAIN.
 * "I adopted" and "somebody is already using this install" are both POSITIVE
 * findings, and recording either once and forever is right. "There was no prior
 * install" is a NEGATIVE one: it says we looked and saw nothing. Writing that
 * down as a permanent decision converts an absence into consent, and it is not
 * hypothetical -- MEASURED on the build machine, 2026-08-11:
 *
 *     %APPDATA%\ToolsEnabled\.userdata-adoption.json
 *       { "status": "complete", "adopted": false, "reason": "NO_PRIOR_INSTALL" }
 *     %APPDATA%\Mission Control\shell-state.json          73 bytes
 *     %APPDATA%\Mission Control\agent-spawn-key.enc      150 bytes
 *     %APPDATA%\Mission Control\agent-spawn-records.jsonl 2584 bytes
 *
 * Run against those exact directories the current module answers ADOPTED, so
 * the verdict on disk disagrees with the code that wrote it -- and because the
 * verdict is honoured, no future version can ever correct it. A person in that
 * state has their previous install sitting beside the new one, permanently
 * unreachable, and nothing tells them.
 *
 * THE RECORD THEREFORE CARRIES ITS EVIDENCE. A negative verdict now names every
 * directory it examined and what it saw there. A later launch honours it only
 * while that evidence still holds; a candidate that has since gained product
 * state, one the record never examined, or a record that states no evidence at
 * all -- every build before this one -- reopens the question exactly once and
 * then writes an evidenced verdict of its own. Absence of evidence is not
 * evidence of absence, which is the whole of the house defect in one line.
 *
 * REOPENING SKIPS THE "ALREADY IN USE" SHORTCUT, DELIBERATELY. A person whose
 * data was stranded by a wrong verdict has since been USING the new install, so
 * that shortcut is exactly what would keep them stranded. The copy below never
 * overwrites, so their current data still wins file by file; what they can get
 * back is only what the new install does not already have.
 *
 * IT NEVER OVERWRITES. Only entries missing from the new userData are copied,
 * which is what makes a resumed adoption safe after a crash mid-copy, and what
 * guarantees a directory that already holds real state is left alone.
 *
 * IT IS NOT A SECURITY BOUNDARY CHANGE. Everything copied is the same user's
 * own data, moving between two directories that user already owns, on one
 * machine. agent-spawn-key.enc travels with the records it decrypts because
 * safeStorage is scoped to the Windows user rather than to a path -- splitting
 * them would leave the person with records nothing can read. No wider read
 * access is created: a process that can read the destination could already read
 * the source.
 */

const RECORD_FILE = '.userdata-adoption.json'
/* 2 records the evidence behind a negative verdict; 1 stated the verdict alone.
   The number is not read as a gate -- a version-1 record simply has no evidence
   to check, which is the case the reopen rule below already covers. */
const RECORD_VERSION = 2

/* Every userData directory name this product has ever used, most recent first.
   A rename adds an entry here; it does not get to silently orphan an install
   again. The current productName is NEVER in this list -- it is the
   destination, and adopting a directory into itself is refused below. */
const LEGACY_USER_DATA_NAMES = Object.freeze(['Mission Control'])

/* The product's own state. These are the files whose absence means "this
   person has never run this build", and whose presence in a prior install is
   the thing worth carrying over. Chromium's own files (Cache, Preferences,
   Local State, Network, GPUCache...) are deliberately NOT here: they are
   regenerated on launch, they are the reason a fresh userData is never truly
   empty, and copying a browser's internal state across installations is how
   migrations corrupt profiles. */
const PRODUCT_STATE_ENTRIES = Object.freeze([
  'renderer-prefs.json',
  'shell-state.json',
  'fleet-profile.json',
  'agent-spawn-key.enc',
  'agent-spawn-records.jsonl',
  'workspace',
  /* The operator's own purchase list. It is the newest resident of userData and
     it is exactly the kind of file this defect strands: a document the PERSON
     put there, which the product only shows when it is present, so losing it
     removes a surface rather than resetting a setting. Derived by sweeping every
     getPath('userData') in shell/ rather than by listing the ones already known
     -- the point of this file is that a missed name is invisible until a
     customer loses it. Inert until that lane lands the file; the copy skips
     entries that do not exist. */
  'purchase-catalog.json',
  /* The capability layer's own state root, <userData>/capability: state/ (the
     signed audit ledger and the mission bridge's per-boot records), logs/,
     vault/ (the person's credentials), captures/, profiles/, reports/. It moved
     here from the INSTALL directory, where an update would have deleted it --
     see shell/main.cjs CAPABILITY_STATE_ROOT. Listed for the same reason every
     other name here is: the next rename must carry it, and a missed name is
     invisible until a customer loses the thing it named. */
  'capability',
])

/* Chromium's localStorage partition. It is best-effort rather than required,
   and it is here for one specific population: an install predating
   shell/renderer-prefs.cjs kept EVERY setting the person chose in this
   LevelDB, so skipping it would migrate almost nothing for exactly the users
   who have the most to lose. It is best-effort because it is the one entry
   another process may hold open, and a failed copy of a browser cache must not
   cost the person their workspace. */
const BEST_EFFORT_ENTRIES = Object.freeze(['Local Storage'])

function samePath(a, b) {
  /* Windows paths are case-insensitive; adopting a directory into itself would
     otherwise be reachable by casing alone. */
  return String(a).replace(/[\\/]+$/, '').toLowerCase() === String(b).replace(/[\\/]+$/, '').toLowerCase()
}

function holdsProductState({ directory, fs, path }) {
  return PRODUCT_STATE_ENTRIES.some((entry) => {
    const target = path.join(directory, entry)
    try {
      const stat = fs.statSync(target)
      /* An empty workspace/ is what a first launch creates, so it is not
         evidence that anybody has used this install. */
      if (stat.isDirectory()) return fs.readdirSync(target).length > 0
      return stat.size > 0
    } catch {
      return false
    }
  })
}

/* WHAT WE SAW, WRITTEN DOWN BESIDE WHAT WE CONCLUDED. Directory names and one
   boolean each -- no contents, and nothing that is not already a path this
   process just resolved. */
function describeSearch({ candidates, fs, path }) {
  return candidates.map((directory) => ({
    directory,
    holdsProductState: holdsProductState({ directory, fs, path }),
  }))
}

/* IS A RECORDED "THERE WAS NOTHING TO ADOPT" STILL TRUE?
 *
 * Only asked of a completed NEGATIVE verdict. An adoption that happened, a
 * target that was already in use, and a damaged record are all left alone --
 * they are decisions about something that was observed to exist.
 *
 * Reopens on three shapes, and each of them is an absence that must not read as
 * a finding: a record that states no evidence (every build before this one, and
 * the one on the build machine that disagrees with its own code); a candidate
 * the record never examined (a legacy name added by a later rename); and a
 * candidate the record examined and found empty which now holds product state.
 * A record whose evidence still matches the disk is honoured, so the ordinary
 * fresh install pays one stat per legacy name per launch and nothing else. */
function negativeVerdictIsStale({ record, candidates, fs, path }) {
  if (!record || record.status !== 'complete') return false
  if (record.adopted !== false || record.reason !== 'NO_PRIOR_INSTALL') return false

  const searched = Array.isArray(record.searched) ? record.searched : null
  /* No evidence, or an evidence list that names nothing, is not a negative
     finding about anything. */
  if (!searched || searched.length === 0) return true

  return candidates.some((directory) => {
    const seen = searched.find((entry) => (
      entry
      && typeof entry === 'object'
      && typeof entry.directory === 'string'
      && samePath(entry.directory, directory)
    ))
    if (!seen) return true
    /* Strictly `!== false`: a missing or non-boolean field states nothing, and
       stating nothing must not count as "examined and empty". */
    if (seen.holdsProductState !== false) return true
    return holdsProductState({ directory, fs, path })
  })
}

function readRecord({ recordPath, fs }) {
  let raw
  try {
    raw = fs.readFileSync(recordPath, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return { present: false, record: null }
    /* Present but unreadable. See the header: this is a decision, not an
       absence. */
    return { present: true, record: null }
  }
  try {
    const parsed = JSON.parse(raw)
    return { present: true, record: parsed && typeof parsed === 'object' ? parsed : null }
  } catch {
    return { present: true, record: null }
  }
}

function writeRecord({ recordPath, fs, payload }) {
  fs.writeFileSync(recordPath, `${JSON.stringify(payload, null, 2)}\n`)
}

function copyEntry({ from, to, fs }) {
  fs.cpSync(from, to, { recursive: true, force: false, errorOnExist: false })
}

/* Adopt a prior installation's userData into this one.
 *
 * Every path is injected so this is testable against real directories rather
 * than against a description of directories. Returns a plain record of what it
 * decided; it never throws for an ordinary miss, because a failed carry-over
 * must not stop the application from starting. */
function adoptLegacyUserData({
  userDataPath,
  /* The directory a previous installation's userData would be a sibling in.
     In production this IS appData -- Electron defines userData as
     <appData>/<productName>, so the caller passes dirname(userData) and gets
     exactly appData. It is expressed as "where userData lives" rather than
     "the OS roaming folder" for two reasons: it stays correct for someone who
     relocated their profile with --user-data-dir, where the fixed OS folder
     would be the wrong place to look; and it is what allows the packaged proof
     to exercise this against a temporary root instead of against the real
     %APPDATA%, so the test never has to read a person's actual data. */
  searchRoot,
  fs,
  path,
  legacyNames = LEGACY_USER_DATA_NAMES,
  now = () => new Date().toISOString(),
} = {}) {
  if (!userDataPath || !searchRoot) {
    return { adopted: false, reason: 'PATHS_NOT_RESOLVED', entries: [], failures: [] }
  }

  const recordPath = path.join(userDataPath, RECORD_FILE)
  const { present, record } = readRecord({ recordPath, fs })
  const legacyCandidates = legacyNames.map((name) => path.join(searchRoot, name))

  let resumingFrom = null
  /* A negative verdict whose evidence no longer holds. See the header: this is
     the one decision this module is allowed to take a second look at. */
  let reopening = false
  if (present) {
    if (record && record.status === 'in-progress' && typeof record.from === 'string') {
      /* A previous attempt died mid-copy. Resume the SAME source only -- picking
         a different one now would mix two installations together. */
      resumingFrom = record.from
    } else if (negativeVerdictIsStale({ record, candidates: legacyCandidates, fs, path })) {
      reopening = true
    } else {
      /* Complete, or damaged. Either way a decision exists. */
      return { adopted: false, reason: 'ALREADY_DECIDED', entries: [], failures: [] }
    }
  }

  if (!resumingFrom && !reopening && holdsProductState({ directory: userDataPath, fs, path })) {
    /* Somebody has already used this install. Their data wins; record the
       decision so we never look again. */
    try {
      fs.mkdirSync(userDataPath, { recursive: true })
      writeRecord({
        recordPath,
        fs,
        payload: { version: RECORD_VERSION, status: 'complete', adopted: false, reason: 'TARGET_ALREADY_IN_USE', at: now() },
      })
    } catch { /* a record we could not write is not worth failing a launch for */ }
    return { adopted: false, reason: 'TARGET_ALREADY_IN_USE', entries: [], failures: [] }
  }

  const candidates = resumingFrom ? [resumingFrom] : legacyCandidates
  const source = candidates.find((candidate) => (
    !samePath(candidate, userDataPath) && holdsProductState({ directory: candidate, fs, path })
  ))

  if (!source) {
    try {
      fs.mkdirSync(userDataPath, { recursive: true })
      writeRecord({
        recordPath,
        fs,
        payload: {
          version: RECORD_VERSION,
          status: 'complete',
          adopted: false,
          reason: 'NO_PRIOR_INSTALL',
          /* The evidence, so the next version can tell this verdict from one
             that was simply never checked. */
          searched: describeSearch({ candidates, fs, path }),
          at: now(),
        },
      })
    } catch { /* see above */ }
    return { adopted: false, reason: 'NO_PRIOR_INSTALL', entries: [], failures: [] }
  }

  try {
    fs.mkdirSync(userDataPath, { recursive: true })
    /* The record goes down BEFORE the first byte is copied, so a crash halfway
       through is resumable rather than invisible. */
    writeRecord({
      recordPath,
      fs,
      payload: { version: RECORD_VERSION, status: 'in-progress', from: source, at: now() },
    })
  } catch (error) {
    return { adopted: false, reason: 'RECORD_NOT_WRITABLE', entries: [], failures: [{ entry: RECORD_FILE, message: String(error && error.message || error) }] }
  }

  const entries = []
  const failures = []

  for (const entry of PRODUCT_STATE_ENTRIES) {
    const from = path.join(source, entry)
    const to = path.join(userDataPath, entry)
    if (!fs.existsSync(from) || fs.existsSync(to)) continue
    try {
      copyEntry({ from, to, fs })
      entries.push(entry)
    } catch (error) {
      failures.push({ entry, message: String(error && error.message || error) })
    }
  }

  for (const entry of BEST_EFFORT_ENTRIES) {
    const from = path.join(source, entry)
    const to = path.join(userDataPath, entry)
    if (!fs.existsSync(from) || fs.existsSync(to)) continue
    try {
      copyEntry({ from, to, fs })
      entries.push(entry)
    } catch (error) {
      failures.push({ entry, message: String(error && error.message || error), bestEffort: true })
    }
  }

  const requiredFailed = failures.some((failure) => !failure.bestEffort)
  if (requiredFailed) {
    /* Leave the record at in-progress. The next launch resumes the same source
       and copies whatever is still missing. */
    return { adopted: entries.length > 0, reason: 'INCOMPLETE', from: source, entries, failures }
  }

  try {
    writeRecord({
      recordPath,
      fs,
      payload: { version: RECORD_VERSION, status: 'complete', adopted: true, from: source, entries, failures, at: now() },
    })
  } catch { /* the copy succeeded; a missing record only costs us a re-check */ }

  return { adopted: true, reason: 'ADOPTED', from: source, entries, failures }
}

module.exports = {
  RECORD_FILE,
  RECORD_VERSION,
  LEGACY_USER_DATA_NAMES,
  PRODUCT_STATE_ENTRIES,
  BEST_EFFORT_ENTRIES,
  adoptLegacyUserData,
}
