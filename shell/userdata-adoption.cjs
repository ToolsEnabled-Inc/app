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
const RECORD_VERSION = 1

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

  let resumingFrom = null
  if (present) {
    if (!record || record.status !== 'in-progress' || typeof record.from !== 'string') {
      /* Complete, or damaged. Either way a decision exists. */
      return { adopted: false, reason: 'ALREADY_DECIDED', entries: [], failures: [] }
    }
    /* A previous attempt died mid-copy. Resume the SAME source only -- picking
       a different one now would mix two installations together. */
    resumingFrom = record.from
  }

  if (!resumingFrom && holdsProductState({ directory: userDataPath, fs, path })) {
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

  const candidates = resumingFrom ? [resumingFrom] : legacyNames.map((name) => path.join(searchRoot, name))
  const source = candidates.find((candidate) => (
    !samePath(candidate, userDataPath) && holdsProductState({ directory: candidate, fs, path })
  ))

  if (!source) {
    try {
      fs.mkdirSync(userDataPath, { recursive: true })
      writeRecord({
        recordPath,
        fs,
        payload: { version: RECORD_VERSION, status: 'complete', adopted: false, reason: 'NO_PRIOR_INSTALL', at: now() },
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
