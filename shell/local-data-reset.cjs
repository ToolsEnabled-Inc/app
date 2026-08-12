'use strict'

/* DELETING THIS PRODUCT'S DATA FROM INSIDE THE PRODUCT.
 *
 * WHAT WAS MISSING. shell/uninstall-retention.cjs gave the person a CHOICE
 * about what happens to their data when they uninstall, and build/installer.nsh
 * acts on it. Both of those only exist at uninstall time. Inside the running
 * program there was no control, no channel and no sentence: a person who wanted
 * their credentials, their accounts and the signed record of everything this
 * software did off their computer had to uninstall the program to get it, and
 * had to have set the setting BEFOREHAND. "Reset this thing" was not an
 * available act.
 *
 * SO THIS IS THE SAME REMOVAL, PERFORMED FROM THE APPLICATION. It is
 * deliberately built out of the uninstaller's own measurement -- inventory()
 * and NAMED_SENSITIVE_ENTRIES are REQUIRED from shell/uninstall-retention.cjs
 * rather than restated -- so that the two paths cannot come to disagree about
 * what the product keeps. A second hand-written list of "the person's data" is
 * a list that goes stale in the direction that hurts: a new state file added
 * over there and forgotten here would be reported as removed while it stayed on
 * the disk.
 *
 * THE TWO PROMISES THIS FILE HAS TO KEEP.
 *
 * 1. NOTHING IS DELETED THAT WAS NOT MEASURED AND NAMED FIRST. planReset()
 *    exists so the screen can show what is actually there, at the moment it is
 *    shown, before anything is destroyed. A count is not a decision aid; "your
 *    saved credentials and the signed record of every action taken" is.
 *
 * 2. THE REPORT IS WHAT HAPPENED, NOT WHAT WAS ATTEMPTED. Every entry is
 *    re-checked with lstat AFTER the removal, and an entry that is still on the
 *    disk is reported as kept, with the reason. Windows holds files open; a
 *    running window holds its own browser files open; an antivirus scanner can
 *    hold anything open for a second. A reset that printed "done" over a vault
 *    that is still there would be the worst lie this product could tell, and it
 *    is the DEFAULT outcome of any implementation that trusts its own rm call.
 *
 * WHY WHOLE DIRECTORIES, NOT A CURATED LIST OF NAMES. The delete list is "every
 * entry in the product's own data directories", not PRODUCT_STATE_ENTRIES. That
 * list is maintained for a different job (what a rename must carry over) and it
 * does not name product-accounts.json or product-session.enc -- so a reset built
 * on it would leave every account and sign-in on the disk while saying they were
 * gone. Sweeping the directory cannot miss a file that nobody remembered.
 *
 * WHAT THIS FILE REFUSES TO TOUCH is as much of the design as what it removes:
 * see guardRoot(). A recursive delete pointed at the wrong string is the one bug
 * class here that costs somebody their documents, so the dangerous roots are
 * refused BY NAME and by ancestry, in the module, rather than by the callers
 * being careful.
 */

const os = require('node:os')
const path = require('node:path')
const fsDefault = require('node:fs')

const {
  NAMED_SENSITIVE_ENTRIES,
  inventory,
  describeRetention,
} = require('./uninstall-retention.cjs')

/* The installation directory the engine keeps outside userData:
   %LOCALAPPDATA%\ToolsEnabled -- machine.json (the permission level the person
   chose), machine-record.key, settings.json, agent-home\<tier>. It is a
   SEPARATE root and it has to be named separately, because a "delete
   everything" that leaves the permission level behind would bring the program
   back up already configured, which is the opposite of a reset. The path is
   resolved by the caller from the payload's own resolveServicesRoot(), never
   guessed at here. */
const SERVICES_NAMED_ENTRIES = Object.freeze([
  { rel: 'machine.json', what: 'the permission level you chose for this computer' },
  { rel: 'machine-record.key', what: 'the key that seals that record' },
  { rel: 'settings.json', what: 'this installation’s settings' },
  { rel: 'agent-home', what: 'the home folders agents were given here' },
])

/* Stable codes. A refusal a person is shown has to be distinguishable from a
   refusal a test asserts on, and prose is not. */
const REFUSED_NO_PATH = 'RESET_NO_DIRECTORY'
const REFUSED_RELATIVE = 'RESET_PATH_NOT_ABSOLUTE'
const REFUSED_ROOT = 'RESET_PATH_IS_A_ROOT'
const REFUSED_WELL_KNOWN = 'RESET_PATH_IS_A_WELL_KNOWN_FOLDER'
const REFUSED_ANCESTOR = 'RESET_PATH_CONTAINS_A_WELL_KNOWN_FOLDER'

function normalisedForCompare(value) {
  return path.resolve(value).replace(/[\\/]+$/, '').toLowerCase()
}

/* Every folder a recursive delete must never be pointed at, taken from the
   environment rather than spelled out, so a relocated profile is protected too.
   `homedir()` is included separately: a machine with no USERPROFILE set still
   has one, and that is exactly the machine where a wrong string would land. */
function wellKnownRoots({ env = process.env, homedir = os.homedir } = {}) {
  const candidates = [
    env.APPDATA,
    env.LOCALAPPDATA,
    env.USERPROFILE,
    env.HOMEPATH && env.HOMEDRIVE ? path.join(env.HOMEDRIVE, env.HOMEPATH) : null,
    env.PUBLIC,
    env.ProgramData,
    env.ProgramFiles,
    env['ProgramFiles(x86)'],
    env.SystemRoot,
    env.windir,
    env.TEMP,
    env.TMP,
  ]
  try { candidates.push(homedir()) } catch { /* a machine with no home is still guarded by the rest */ }
  const roots = []
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate.trim().length === 0) continue
    if (!path.isAbsolute(candidate)) continue
    roots.push(normalisedForCompare(candidate))
  }
  return roots
}

/**
 * May this directory be swept?
 *
 * WRITTEN AS A REFUSAL LIST WITH NO ESCAPE HATCH. There is no options flag that
 * turns a refusal off, because the only caller that would ever want one is a
 * caller that has already made the mistake.
 *
 * The ancestry check is the half that matters. The home directory itself is
 * caught by name, and so is the roaming-app-data folder inside it; but a caller
 * that passed the USERS ROOT -- one segment above a home directory, one typo
 * away -- would be refused only because it CONTAINS the home directory. Both
 * directions are checked for the same reason: a path that is an ancestor of a
 * well-known folder deletes it too.
 *
 * (Written without literal example paths on purpose. This file ships inside
 * app.asar, and tools/check-no-owner-data.mjs scans the built artifact for the
 * users-root prefix as an owner-data pattern. It refused a build over the three
 * placeholder paths that used to be in this paragraph -- the placeholders were
 * harmless, but the guard cannot tell a placeholder from a real home directory
 * and MUST NOT be taught to, because "it looked like an example" is exactly the
 * excuse a real leak would wear. Describe the shape; do not spell one out.)
 */
function guardRoot(directory, { env = process.env, homedir = os.homedir } = {}) {
  if (typeof directory !== 'string' || directory.trim().length === 0) {
    return { ok: false, code: REFUSED_NO_PATH, reason: 'no directory was given' }
  }
  if (!path.isAbsolute(directory)) {
    return { ok: false, code: REFUSED_RELATIVE, reason: 'the directory is not an absolute path' }
  }
  const resolved = path.resolve(directory)
  if (path.dirname(resolved) === resolved) {
    return { ok: false, code: REFUSED_ROOT, reason: 'the directory is the root of a drive' }
  }
  const target = normalisedForCompare(resolved)
  const known = wellKnownRoots({ env, homedir })
  /* EQUALITY IS CHECKED AGAINST ALL OF THEM BEFORE ANCESTRY IS CHECKED AGAINST
     ANY. These folders nest -- the home directory contains AppData, which
     contains Temp -- so a single pass reports the home directory as "contains a
     well-known folder" purely because AppData was earlier in the list. Both are
     refusals and the files are equally safe either way; the CODE is what a
     person and a test read, and "this IS your home folder" is the truer of the
     two sentences. */
  if (known.includes(target)) {
    return { ok: false, code: REFUSED_WELL_KNOWN, reason: 'the directory is one of Windows’ own folders' }
  }
  for (const folder of known) {
    /* The separator is part of the comparison. Without it `...\ToolsEnabledX`
       would read as containing `...\ToolsEnabled`. */
    if (folder.startsWith(`${target}${path.sep}`) || folder.startsWith(`${target}/`)) {
      return { ok: false, code: REFUSED_ANCESTOR, reason: 'the directory contains one of Windows’ own folders' }
    }
  }
  return { ok: true, resolved }
}

function lstatSafe(fs, target) {
  try { return fs.lstatSync(target) } catch { return null }
}

/**
 * How much is in a directory, counted now.
 *
 * Symbolic links are counted as themselves and never followed, for the same
 * reason the sweep never follows them: a junction in userData pointing at
 * Documents must not make this report -- or the removal it precedes -- reach
 * data the person never put here.
 */
function measureRoot({ directory, fs = fsDefault } = {}) {
  const result = { present: false, files: 0, bytes: 0 }
  if (typeof directory !== 'string' || directory.trim().length === 0) return result
  const rootStat = lstatSafe(fs, directory)
  if (!rootStat || !rootStat.isDirectory()) return result
  result.present = true
  const walk = (current) => {
    let entries
    try { entries = fs.readdirSync(current, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isSymbolicLink()) { result.files += 1; continue }
      if (entry.isDirectory()) { walk(full); continue }
      if (!entry.isFile()) continue
      result.files += 1
      const stat = lstatSafe(fs, full)
      result.bytes += stat ? stat.size : 0
    }
  }
  walk(directory)
  return result
}

function namedPresent({ directory, entries, fs = fsDefault } = {}) {
  const found = []
  for (const entry of entries) {
    const stat = lstatSafe(fs, path.join(directory, entry.rel))
    if (stat) found.push({ rel: entry.rel, what: entry.what, bytes: stat.isFile() ? stat.size : 0 })
  }
  return found
}

/**
 * WHAT IS ON THIS COMPUTER RIGHT NOW, measured at the moment the person asks.
 *
 * Two roots, reported separately and never summed into one comforting number,
 * because they fail differently and a person may find one of them unreadable
 * while the other is fine. `guard` travels with each root: a root this module
 * refuses to touch is shown as refused rather than silently dropped, which is
 * the difference between "there was nothing there" and "we would not look".
 *
 * The userData root's named list comes from the uninstaller's own
 * NAMED_SENSITIVE_ENTRIES through inventory(), so the sentence the reset screen
 * shows and the sentence the uninstaller shows are the same sentence.
 */
function planReset({ userDataDir, servicesRoot, workspaceRoots = [], installDir = null, fs = fsDefault, env = process.env, homedir = os.homedir } = {}) {
  const roots = []

  const userGuard = guardRoot(userDataDir, { env, homedir })
  if (userGuard.ok) {
    const report = inventory({ userDataDir, fs })
    roots.push({
      kind: 'user-data',
      directory: userGuard.resolved,
      guarded: true,
      present: report.present,
      files: report.files,
      bytes: report.bytes,
      named: report.named.map(entry => ({ rel: entry.rel, what: entry.what, bytes: entry.bytes })),
      describe: describeRetention(report),
      legacy: report.legacy.slice(),
    })
  } else {
    roots.push({ kind: 'user-data', directory: typeof userDataDir === 'string' ? userDataDir : '', guarded: false, refusal: userGuard, present: false, files: 0, bytes: 0, named: [], legacy: [] })
  }

  const servicesGuard = guardRoot(servicesRoot, { env, homedir })
  if (servicesGuard.ok) {
    const measured = measureRoot({ directory: servicesGuard.resolved, fs })
    roots.push({
      kind: 'installation',
      directory: servicesGuard.resolved,
      guarded: true,
      present: measured.present,
      files: measured.files,
      bytes: measured.bytes,
      named: namedPresent({ directory: servicesGuard.resolved, entries: SERVICES_NAMED_ENTRIES, fs }),
      legacy: [],
    })
  } else {
    roots.push({ kind: 'installation', directory: typeof servicesRoot === 'string' ? servicesRoot : '', guarded: false, refusal: servicesGuard, present: false, files: 0, bytes: 0, named: [], legacy: [] })
  }

  /* THE PRE-RENAME DIRECTORY IS PART OF THE ANSWER. This product adopted
     %APPDATA%\Mission Control's data on purpose, so a removal that leaves it
     sitting there is not the removal the person asked for. It is reported as a
     root of its own so it can be named on the screen rather than folded into a
     total. */
  const legacyDirectories = roots.flatMap(root => root.legacy || [])
  for (const directory of legacyDirectories) {
    const guard = guardRoot(directory, { env, homedir })
    if (!guard.ok) continue
    const measured = measureRoot({ directory: guard.resolved, fs })
    if (!measured.present) continue
    roots.push({
      kind: 'earlier-name',
      directory: guard.resolved,
      guarded: true,
      present: true,
      files: measured.files,
      bytes: measured.bytes,
      named: namedPresent({ directory: guard.resolved, entries: NAMED_SENSITIVE_ENTRIES, fs }),
      legacy: [],
    })
  }

  const totals = roots.reduce((sum, root) => ({
    files: sum.files + (root.present ? root.files : 0),
    bytes: sum.bytes + (root.present ? root.bytes : 0),
  }), { files: 0, bytes: 0 })

  /* WHAT IS NOT TOUCHED, measured where it can be measured. The workspace roots
     are the folders the PERSON chose for their assistant to work in; they hold
     that person's own files and this module never enters them. They are listed
     so the screen can say so by name instead of in the abstract, and an
     unreadable machine record produces an empty list rather than a claim. */
  const untouched = []
  const conflicts = []
  if (typeof installDir === 'string' && installDir.trim().length > 0) {
    untouched.push({ kind: 'program', directory: path.resolve(installDir) })
  }
  const sweeping = roots.filter(root => root.guarded && root.present).map(root => normalisedForCompare(root.directory))
  for (const root of Array.isArray(workspaceRoots) ? workspaceRoots : []) {
    if (typeof root !== 'string' || root.trim().length === 0) continue
    const resolved = path.resolve(root)
    const compare = normalisedForCompare(resolved)
    /* A CHOSEN FOLDER CAN BE INSIDE A SWEPT ONE, and the sweep would take it.
       Nothing stops a person pointing their workspace at a folder underneath
       this program's own data directory, and the survivor sentence -- "nothing
       in them is opened, moved or deleted here" -- would then be false for that
       person and true for everybody else. So it is DETECTED and named rather
       than assumed away: a promise that holds in the common case and quietly
       fails in the uncommon one is the same defect as an absence read as
       consent. */
    const inside = sweeping.some(directory => compare === directory || compare.startsWith(`${directory}${path.sep}`) || compare.startsWith(`${directory}/`))
    if (inside) conflicts.push({ kind: 'workspace', directory: resolved })
    else untouched.push({ kind: 'workspace', directory: resolved })
  }

  return { ok: true, roots, totals, untouched, conflicts, measuredAtMs: Date.now() }
}

/**
 * Remove one directory's contents, entry by entry, and report what actually
 * went.
 *
 * TOP-LEVEL ENTRIES, ONE AT A TIME, rather than one rm of the root, because the
 * report is the product here. `rm -r` of the whole tree returns one boolean for
 * ninety-two files, and on Windows -- where one open handle fails one entry --
 * that boolean is false while nearly everything is gone. A person reading that
 * cannot tell whether their vault was removed. Per-entry, they can.
 *
 * A SYMLINK IS UNLINKED, NEVER DESCENDED. `fs.rmSync` already refuses to follow
 * one, and the explicit branch is here so the behaviour is stated rather than
 * inherited from a Node version.
 */
function eraseDirectory({ directory, fs = fsDefault, env = process.env, homedir = os.homedir, priority = [] } = {}) {
  const guard = guardRoot(directory, { env, homedir })
  if (!guard.ok) return { ok: false, code: guard.code, reason: guard.reason, directory: typeof directory === 'string' ? directory : '', entries: [], removedRoot: false }

  const rootStat = lstatSafe(fs, guard.resolved)
  if (!rootStat || !rootStat.isDirectory()) {
    return { ok: true, directory: guard.resolved, absent: true, entries: [], removedRoot: false, remaining: { present: false, files: 0, bytes: 0 } }
  }

  let names
  try {
    names = fs.readdirSync(guard.resolved)
  } catch (error) {
    return { ok: false, code: 'RESET_DIRECTORY_UNREADABLE', reason: error && error.code ? error.code : 'unknown error', directory: guard.resolved, entries: [], removedRoot: false }
  }

  /* THE PERSON'S OWN DATA GOES FIRST, and the browser's scratch files last.
     If anything is going to fail -- a lock, a scanner, a crash halfway -- the
     vault, the ledger and the accounts must already be gone when it does. */
  const ordered = [
    ...priority.filter(name => names.includes(name)),
    ...names.filter(name => !priority.includes(name)),
  ]

  const entries = []
  for (const name of ordered) {
    const full = path.join(guard.resolved, name)
    const before = lstatSafe(fs, full)
    if (!before) continue
    let error = null
    try {
      if (before.isSymbolicLink()) fs.unlinkSync(full)
      else fs.rmSync(full, { recursive: true, force: true, maxRetries: 4, retryDelay: 120 })
    } catch (raised) {
      error = raised
    }
    /* MEASURED AFTER, NOT ASSUMED. This re-stat is the whole reason the report
       can be trusted: rmSync({force:true}) swallows some failures and raises
       others, and neither tells you what is on the disk now. */
    const after = lstatSafe(fs, full)
    entries.push({
      name,
      removed: after === null,
      reason: after === null
        ? null
        : (error && error.code ? error.code : 'the file is still on this computer and Windows did not say why'),
    })
  }

  let removedRoot = false
  try {
    fs.rmdirSync(guard.resolved)
    removedRoot = lstatSafe(fs, guard.resolved) === null
  } catch {
    /* Expected whenever anything survived. Not an error: the entry report
       already says what stayed, and an empty-directory removal that fails is
       not a fact a person needs a second sentence about. */
    removedRoot = false
  }

  return {
    ok: true,
    directory: guard.resolved,
    absent: false,
    entries,
    removedRoot,
    remaining: measureRoot({ directory: guard.resolved, fs }),
  }
}

/**
 * The whole act: every root in the plan, in order, each one reported.
 *
 * `ok` here means "the sweep ran", NEVER "everything is gone". `complete` is the
 * separate, stricter fact -- nothing remains anywhere -- and the two are kept
 * apart deliberately, because a screen that reads `ok` and prints "your data has
 * been deleted" over a locked vault is exactly the failure this module is built
 * to make impossible.
 */
function eraseLocalData({ roots, fs = fsDefault, env = process.env, homedir = os.homedir, priority = [] } = {}) {
  const results = []
  for (const root of Array.isArray(roots) ? roots : []) {
    const directory = typeof root === 'string' ? root : root && root.directory
    const kind = typeof root === 'string' ? 'user-data' : (root && root.kind) || 'user-data'
    const outcome = eraseDirectory({ directory, fs, env, homedir, priority: kind === 'user-data' ? priority : [] })
    results.push({ kind, ...outcome })
  }
  const swept = results.filter(result => result.ok)
  const complete = swept.length === results.length
    && results.every(result => result.absent === true || (result.remaining && result.remaining.files === 0))
  const remainingFiles = results.reduce((sum, result) => sum + (result.remaining ? result.remaining.files : 0), 0)
  const remainingBytes = results.reduce((sum, result) => sum + (result.remaining ? result.remaining.bytes : 0), 0)
  return { ok: swept.length > 0, complete, results, remainingFiles, remainingBytes }
}

module.exports = {
  REFUSED_NO_PATH,
  REFUSED_RELATIVE,
  REFUSED_ROOT,
  REFUSED_WELL_KNOWN,
  REFUSED_ANCESTOR,
  SERVICES_NAMED_ENTRIES,
  guardRoot,
  measureRoot,
  planReset,
  eraseDirectory,
  eraseLocalData,
}
