'use strict'

/* WHAT UNINSTALLING THIS PRODUCT LEAVES BEHIND, AND WHO DECIDED THAT.
 *
 * Nobody decided it. Measured on this machine 2026-08-11, against the live
 * %APPDATA%\ToolsEnabled of an installed build: uninstalling removes the
 * install directory and NOTHING ELSE. 92 files, 11.87 MB of the person's data
 * stay on the disk forever. Among them, named because a byte count is not an
 * argument:
 *
 *     capability\vault\secrets.json            the credential vault
 *     capability\vault\secrets.json.access.log every read of it
 *     capability\state\audit.sqlite3 (+ -wal)  the signed audit ledger, 457 KB
 *     capability\state\toolsenabled.sqlite3    durable state, 729 KB
 *     capability\logs\actions.jsonl            every action the product took
 *     capability\config\accounts.json          the linked accounts
 *     agent-spawn-key.enc                      the key that signs run records
 *     agent-spawn-records.jsonl                what has been run here
 *     purchase-catalog.json                    69 KB
 *     shell-state.json, renderer-prefs.json    settings
 *
 * The NSIS uninstaller runs `RMDir /r $INSTDIR` and never looks at %APPDATA%.
 * There was no setting, no prompt, and no sentence anywhere in the product that
 * said so. A person who uninstalls to remove this software from their computer
 * has every reason to believe that is what happened.
 *
 * THIS IS THE ABSENCE-AS-CONSENT DEFECT, IN ITS MOST EXPENSIVE FORM. Every
 * other instance in this codebase turns "nothing specified" into "allowed".
 * This one turns "nobody was asked" into "they wanted to keep their credential
 * vault". Retention is not the wrong answer -- for many people it is the right
 * one, and removing data nobody asked to remove is irreversible. Retention
 * WITHOUT A DECISION is the defect.
 *
 * SO THE RULE THIS FILE ENFORCES IS NARROW AND ABSOLUTE:
 *
 *     A recorded choice is honoured. Anything else is a QUESTION, never a
 *     default. There is no input to this module -- absent file, empty file,
 *     unreadable file, unknown token, wrong type -- that resolves to "keep"
 *     without the person having said so.
 *
 * `ask` is therefore not a fallback that happens to be safe; it is the only
 * value reachable from ignorance, and resolveChoice() below is written so that
 * adding a new failure mode lands there by construction rather than by
 * remembering to add a branch.
 *
 * WHY THE CHOICE IS A ONE-TOKEN TEXT FILE. The uninstaller has to read it, and
 * the uninstaller is NSIS: no JSON parser, no Node, no access to the renderer's
 * settings store. renderer-prefs.json holds the setting for the UI; this file
 * is the same decision written where the uninstaller can actually act on it.
 * shell/renderer-prefs.cjs remains the only writer of ITS record, and this
 * module the only writer of this one, so neither is a second copy of the other's
 * job -- they are one decision rendered for two readers, and recordChoice() is
 * called from the same place the pref is set so they cannot drift apart.
 */

const path = require('node:path')
const fsDefault = require('node:fs')

/* The product's own state files, and the pre-rename directory an install may
   still be carrying. Both are REQUIRED FROM shell/userdata-adoption.cjs rather
   than restated here.

   That is deliberate and it is the same lockstep discipline build/installer.nsh
   documents for RUNTIME_STATE_DIRECTORIES. A second hand-maintained list of
   "the files the product keeps" is a list that goes stale, and the failure is
   invisible in exactly the direction that hurts: a new state file added over
   there and forgotten here would be reported to the person as removed while it
   stayed on their disk. Deriving it means the honest inventory cannot fall
   behind the thing it describes. */
const { PRODUCT_STATE_ENTRIES, LEGACY_USER_DATA_NAMES } = require('./userdata-adoption.cjs')

/* THE VOCABULARY IS SHARED WITH THE UNINSTALLER AND MUST NOT DRIFT.
   build/installer.nsh compares against these exact strings, and
   tools/test/uninstall-retention.test.mjs fails if the two ever disagree --
   a renamed token here with the .nsh unchanged would silently stop matching,
   and a policy file that matches nothing resolves to `ask`, which would look
   like "we asked them" while actually meaning "the control broke". */
const CHOICE_KEEP = 'keep-my-data'
const CHOICE_REMOVE = 'remove-everything'
const CHOICE_ASK = 'ask'

/* Only these two are DECISIONS. `ask` is a recorded preference to be asked
   again, which is not the same thing and must never satisfy "has this person
   chosen?". */
const DECISIONS = Object.freeze([CHOICE_KEEP, CHOICE_REMOVE])
const WRITABLE = Object.freeze([CHOICE_KEEP, CHOICE_REMOVE, CHOICE_ASK])

const POLICY_FILE = 'uninstall-data-policy.txt'

/* The renderer preference this mirrors. src/views/settings.js stores every
   setting as `mc.set.<id>`, and the id there is `uninstall_data`. Named here
   rather than spelled inline in shell/main.cjs so the two sides of the mirror
   cannot be edited apart; tools/test/uninstall-retention.test.mjs asserts that
   the settings page really does declare this id with `ask` as its default. */
const RETENTION_PREF_KEY = 'mc.set.uninstall_data'

/* Written when data is kept and the person could not be asked -- a silent
   uninstall (/S), which has no UI to put a question in. Keeping the data is
   correct there (deleting a vault because a script ran quietly would be far
   worse), but keeping it WITHOUT SAYING SO is the defect this module exists to
   end. So the retention is declared on disk, in plain text, beside the data it
   describes. Capitalised and prefixed so it sorts to the top of the directory a
   person opens when they go looking. */
const DECLARATION_FILE = 'DATA-KEPT-AFTER-UNINSTALL.txt'

/* The files worth naming to a person deciding. A count and a byte total do not
   let anyone make this decision -- "11.87 MB" reads like a cache. "Your saved
   credentials and the signed record of everything this software did" is the
   same data described honestly. Relative to the userData root. */
const NAMED_SENSITIVE_ENTRIES = Object.freeze([
  { rel: path.join('capability', 'vault', 'secrets.json'), what: 'your saved credentials' },
  { rel: path.join('capability', 'state', 'audit.sqlite3'), what: 'the signed record of every action taken' },
  { rel: path.join('capability', 'logs', 'actions.jsonl'), what: 'the action log' },
  { rel: path.join('capability', 'config', 'accounts.json'), what: 'your linked accounts' },
  { rel: 'agent-spawn-key.enc', what: 'the key that signs agent run records' },
  { rel: 'agent-spawn-records.jsonl', what: 'the record of agent sessions run here' },
  { rel: 'purchase-catalog.json', what: 'your purchase list' },
])

/* NORMALISE, THEN MATCH. A token is compared case-insensitively and with
   surrounding whitespace removed because the file is written by us but read
   after a round trip through an editor, a copy, or a CRLF conversion, and
   "Keep-My-Data\r\n" meaning something different from "keep-my-data" would be
   a control that breaks on a detail nobody can see. */
function normaliseToken(raw) {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim().toLowerCase()
  return trimmed.length === 0 ? null : trimmed
}

/* THE ONE FUNCTION THAT MUST NEVER RETURN `keep` FROM IGNORANCE.
 *
 * Written as an allowlist over a normalised token: `ask` is the value on the
 * fall-through, so every input that is not literally one of the recognised
 * decisions -- including inputs nobody has thought of yet -- lands there
 * without a branch having to be added for it. The inverse shape (default keep,
 * with branches that catch the bad cases) is the same code until someone
 * invents a new bad case, and then it silently keeps a stranger's vault.
 *
 * `reason` is returned rather than logged because it is shown to the person and
 * written into the declaration file. "We could not read your choice" and "you
 * have not made one yet" are different sentences and deserve to stay different. */
function resolveChoice(raw) {
  const token = normaliseToken(raw)

  if (token === null) {
    return {
      choice: CHOICE_ASK,
      decided: false,
      reason: 'no choice has been recorded',
    }
  }
  if (token === CHOICE_KEEP || token === CHOICE_REMOVE) {
    return { choice: token, decided: true, reason: 'the person chose this' }
  }
  if (token === CHOICE_ASK) {
    return { choice: CHOICE_ASK, decided: false, reason: 'the person asked to be asked at uninstall time' }
  }
  return {
    choice: CHOICE_ASK,
    decided: false,
    /* The token is quoted back so a corrupted or hand-edited file is
       diagnosable. It is product data, not user content, so there is nothing
       here to leak. */
    reason: `the recorded choice ${JSON.stringify(String(raw).trim().slice(0, 64))} is not one this build understands`,
  }
}

function policyFilePath(userDataDir) {
  return path.join(userDataDir, POLICY_FILE)
}

/* READ FAILURES ARE NOT ABSENCES, AND BOTH ARE QUESTIONS.
 *
 * ENOENT genuinely means "never chosen". EACCES/EBUSY/EIO mean "there may be a
 * choice on this disk and we cannot see it". They resolve the same way -- ask --
 * but they are reported differently, because telling someone "you have not
 * chosen yet" when their file is merely locked would invite them to make a
 * choice that then gets overwritten by the one already there. */
function readRecordedChoice({ userDataDir, fs = fsDefault } = {}) {
  if (typeof userDataDir !== 'string' || userDataDir.trim().length === 0) {
    return { choice: CHOICE_ASK, decided: false, reason: 'no user-data directory was given', readError: null }
  }

  let raw
  try {
    raw = fs.readFileSync(policyFilePath(userDataDir), 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { choice: CHOICE_ASK, decided: false, reason: 'no choice has been recorded', readError: null }
    }
    return {
      choice: CHOICE_ASK,
      decided: false,
      reason: `the recorded choice could not be read (${error && error.code ? error.code : 'unknown error'})`,
      readError: error && error.code ? error.code : 'unknown',
    }
  }

  return { ...resolveChoice(raw), readError: null }
}

/* Written with a trailing newline and nothing else. The uninstaller reads one
   line and compares it; anything more -- a comment, a JSON wrapper, a BOM --
   is another thing that can go wrong in a component with no debugger. */
function recordChoice({ userDataDir, choice, fs = fsDefault } = {}) {
  const token = normaliseToken(choice)
  if (token === null || !WRITABLE.includes(token)) {
    return { ok: false, reason: `${JSON.stringify(String(choice))} is not a choice this build can record` }
  }
  try {
    fs.mkdirSync(userDataDir, { recursive: true })
    fs.writeFileSync(policyFilePath(userDataDir), `${token}\n`, 'utf8')
    return { ok: true, choice: token }
  } catch (error) {
    return { ok: false, reason: `the choice could not be saved (${error && error.code ? error.code : 'unknown error'})` }
  }
}

/* MIRROR THE SETTING INTO THE FILE THE UNINSTALLER CAN READ.
 *
 * Called whenever the preference changes. The setting lives in
 * renderer-prefs.json for the UI; the uninstaller is NSIS and can read neither
 * that file's JSON nor the renderer that wrote it, so the same decision is
 * rendered here as one token.
 *
 * NO DECISION MEANS NO FILE, and that is the load-bearing half. The settings
 * page removes the stored key when the person picks the default ("ask"), so
 * "never chose" and "chose to be asked" are already the same state there. If
 * this function wrote the literal token `ask` instead of deleting the file, the
 * two representations would drift the moment one of them changed, and the
 * uninstaller would have two different ways of being told the same thing --
 * which is how a second source of truth starts. One state, one absence.
 *
 * A failed DELETE is reported rather than swallowed. Leaving a stale
 * `remove-everything` on disk after the person switched to "ask" would delete
 * their data on a decision they had withdrawn, so this is the one error here
 * with a destructive consequence. */
function syncRecordedChoice({ userDataDir, value, fs = fsDefault } = {}) {
  const resolved = resolveChoice(value)

  if (resolved.decided) return recordChoice({ userDataDir, choice: resolved.choice, fs })

  try {
    fs.unlinkSync(policyFilePath(userDataDir))
    return { ok: true, choice: CHOICE_ASK, cleared: true }
  } catch (error) {
    if (error && error.code === 'ENOENT') return { ok: true, choice: CHOICE_ASK, cleared: false }
    return {
      ok: false,
      reason: `a previous choice could not be cleared (${error && error.code ? error.code : 'unknown error'}); `
        + 'the uninstaller may still act on it',
    }
  }
}

function statSafe(fs, target) {
  try {
    return fs.statSync(target)
  } catch {
    return null
  }
}

/* WHAT IS ACTUALLY THERE, COUNTED RATHER THAN ASSERTED.
 *
 * The copy shown to a person says how much of their data is at stake, so it has
 * to be measured at the moment it is shown. A hardcoded "about 12 MB" would be
 * wrong for every user but the one whose machine it was measured on, and would
 * go on being confidently wrong forever.
 *
 * Chromium's own caches are counted in the totals (they really are on the disk
 * and really are removed) but are never named, because "GPUCache" is not
 * something anyone is deciding about. The named entries are the ones that carry
 * a consequence. */
function inventory({ userDataDir, fs = fsDefault } = {}) {
  const result = { present: false, files: 0, bytes: 0, named: [], productState: [], legacy: [] }
  if (typeof userDataDir !== 'string' || userDataDir.trim().length === 0) return result

  const rootStat = statSafe(fs, userDataDir)
  if (!rootStat || !rootStat.isDirectory()) return result
  result.present = true

  const walk = (directory) => {
    let entries
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(directory, entry.name)
      /* Never follow a link out of the tree being described. A symlink in
         userData pointing at Documents would otherwise make this report -- and
         a remove-everything acting on it -- reach data the person never put
         here. */
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile()) {
        const stat = statSafe(fs, full)
        result.files += 1
        result.bytes += stat ? stat.size : 0
      }
    }
  }
  walk(userDataDir)

  for (const entry of NAMED_SENSITIVE_ENTRIES) {
    const stat = statSafe(fs, path.join(userDataDir, entry.rel))
    if (stat) result.named.push({ ...entry, bytes: stat.isFile() ? stat.size : 0 })
  }

  for (const name of PRODUCT_STATE_ENTRIES) {
    if (statSafe(fs, path.join(userDataDir, name))) result.productState.push(name)
  }

  /* The pre-rename directory. "Remove everything" that leaves %APPDATA%\Mission
     Control untouched is not everything, and this product adopted that data on
     purpose, so it is this product's to account for. */
  const searchRoot = path.dirname(userDataDir)
  for (const name of LEGACY_USER_DATA_NAMES) {
    const candidate = path.join(searchRoot, name)
    if (candidate.toLowerCase() === userDataDir.toLowerCase()) continue
    const stat = statSafe(fs, candidate)
    if (stat && stat.isDirectory()) result.legacy.push(candidate)
  }

  return result
}

/* The sentence a person is actually shown. Built from the measurement so it can
   never claim more or less than is there, and it names the consequence rather
   than the byte count. */
function describeRetention(report) {
  if (!report || !report.present || report.files === 0) {
    return 'There is no saved data from this product on this computer.'
  }
  const megabytes = report.bytes / (1024 * 1024)
  const size = megabytes >= 0.1 ? `${megabytes.toFixed(2)} MB` : `${report.bytes} bytes`
  const head = `${report.files} file${report.files === 1 ? '' : 's'} (${size}) of your data are saved on this computer.`
  if (report.named.length === 0) return head
  return `${head} They include ${report.named.map((entry) => entry.what).join(', ')}.`
}

/* THE HALF THAT MAKES RETENTION NOT-SILENT.
 *
 * Called when data is kept and nobody could be asked. This is the difference
 * between the defect and the fixed behaviour: the bytes on disk are identical,
 * and the person's ability to find out is not. */
function writeDeclaration({ userDataDir, fs = fsDefault, report = null, reason = 'no choice was recorded' } = {}) {
  const measured = report || inventory({ userDataDir, fs })
  const lines = [
    'YOUR DATA IS STILL ON THIS COMPUTER',
    '',
    'ToolsEnabled has been uninstalled. The program files were removed.',
    'The data below was NOT removed, and this file exists to tell you so.',
    '',
    `Why it was kept: ${reason}.`,
    'Deleting data nobody asked us to delete cannot be undone, so it was kept.',
    '',
    `Where it is: ${userDataDir}`,
    '',
    describeRetention(measured),
    '',
    'To remove it, delete the folder named above. Nothing else on this',
    'computer depends on it.',
    '',
    'If you reinstall ToolsEnabled, this data is picked up again and your',
    'settings, credentials and history will be exactly as you left them.',
    '',
  ]
  try {
    fs.mkdirSync(userDataDir, { recursive: true })
    fs.writeFileSync(path.join(userDataDir, DECLARATION_FILE), `${lines.join('\r\n')}`, 'utf8')
    return { ok: true, file: path.join(userDataDir, DECLARATION_FILE) }
  } catch (error) {
    return { ok: false, reason: error && error.code ? error.code : 'unknown error' }
  }
}

module.exports = {
  CHOICE_KEEP,
  CHOICE_REMOVE,
  CHOICE_ASK,
  DECISIONS,
  WRITABLE,
  POLICY_FILE,
  DECLARATION_FILE,
  NAMED_SENSITIVE_ENTRIES,
  RETENTION_PREF_KEY,
  resolveChoice,
  readRecordedChoice,
  recordChoice,
  syncRecordedChoice,
  policyFilePath,
  inventory,
  describeRetention,
  writeDeclaration,
}
