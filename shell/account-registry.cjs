'use strict'

/* THE PERSON'S OWN PROVIDER ACCOUNTS, AS THIS MACHINE ALREADY RECORDS THEM.
 *
 * WHAT IT IS FOR. A person can hold more than one Codex or Claude account -- a
 * school one and a personal one is the ordinary case -- and each account keeps
 * its sign-in in a whole home directory of its own, selected by an environment
 * variable. The engine already reads a list of those homes and rotates between
 * them (capability/src/lib/multi-account/*). Until this file there was NO way to
 * see or edit that list from the application: the only way to add a second
 * account was to hand-write JSON into a directory a customer has no reason to
 * know about. This is the main-process half of the screen that fixes it.
 *
 * IT WRITES THE ENGINE'S FILE, NOT A SECOND ONE. The list lives at
 * <LOCALAPPDATA>\ToolsEnabled\accounts.json, beside machine.json, resolved the
 * same way the engine's resolveServicesRoot() resolves it. Keeping a private
 * copy in userData would be two answers to one question -- the rotation would
 * read one file and the screen would show the other -- so there is one file and
 * this module's rules are the engine's rules, restated:
 *
 *   provider is codex or claude, and nothing else
 *   a codex entry names profileDir; a claude entry names configDir
 *   a relative directory resolves against the person's home directory
 *   names are unique PER PROVIDER, so "school" may be both a Codex account
 *     and a Claude account and cannot be two Codex accounts
 *   two accounts of the SAME provider may not share one directory
 *   priority is a positive whole number, lowest first
 *
 * AN ABSENT FILE IS THE NORMAL STATE AND IS NEVER AN ERROR. It means "no
 * rotation": one sign-in on this computer, which is what almost everybody has.
 * The same is true after the last account is removed -- the file is DELETED
 * rather than left holding an empty list, because the engine treats an empty
 * list as a loud refusal (ACCOUNTS_REGISTRY_EMPTY) and absence as the quiet
 * normal state. Writing `{"accounts": []}` would turn "I removed my second
 * account" into "no account is usable", which is the opposite of what happened.
 *
 * WHAT IT MAY NEVER DO, and the rule is structural rather than promised.
 * shell/provider-cli-presence.cjs states this rule for the presence probe; this
 * module is held to it too, and for a harder reason: it is handed the paths of
 * directories that contain real sign-in files. So:
 *
 *   - The ONLY byte-returning call in this file is inside readOwnJson(), and
 *     that function refuses, by construction, any path that is not this
 *     product's own registry file or its own rotation record. A caller cannot
 *     point it at a sign-in file even by mistake, because the check is a value
 *     comparison and not a convention.
 *   - Whether an account is signed in is decided by fs.existsSync ALONE. Not the
 *     size, not the date, not one byte of the contents. "There is a file where
 *     that program keeps its sign-in" is the whole of the answer.
 *   - Nothing here starts a child process. signInCommand() returns the official
 *     command as TEXT for a person to run themselves; this product never runs it
 *     and never reads what it produces.
 *
 * tools/test/account-registry.test.mjs asserts all three against this source and
 * against an injected file layer, because a rule about credentials that is only
 * written in a comment is not a rule.
 *
 * IT DOES CARRY PATHS TO THE SCREEN, WHICH IS A DELIBERATE EXCEPTION. The
 * presence probe returns no path at all, on the BLOCKER 2 rule. Here the person
 * TYPED the directory: it is their own words being read back to them, and the
 * screen cannot show a list of homes without showing which home. The command
 * they must paste contains it too, and a command with the path left out is not a
 * command. Nothing is discovered and returned -- only what was entered here.
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const REGISTRY_LEAF = 'accounts.json'
const STATE_LEAF = 'multi-account-state.json'
const SERVICES_DIRECTORY = 'ToolsEnabled'

const DEFAULT_EXHAUSTED_AT_PERCENT = 99
const MAX_ACCOUNTS = 24
const MAX_NAME_LENGTH = 64
const MAX_DIRECTORY_LENGTH = 1024

/* WHAT EACH PROVIDER CALLS ITS HOME, WHAT MOVES IT, AND WHAT PROVES A SIGN-IN.
 *
 * Copied field for field from the engine's own table
 * (capability/src/lib/multi-account/registry.js) rather than re-derived, because
 * a screen that wrote `configDir` for a Codex account would produce a file the
 * rotation refuses -- and the person would have no way to tell why.
 *
 * The commands were MEASURED on this machine, from each program's own help, and
 * not remembered:
 *
 *   codex-cli 0.146.0        `codex --help`      -> `login`      (a top command)
 *   claude 2.1.186           `claude auth --help`-> `auth login` (there is NO
 *                                                  bare `claude login`)
 */
const PROVIDERS = Object.freeze({
  codex: Object.freeze({
    id: 'codex',
    dirField: 'profileDir',
    homeEnv: 'CODEX_HOME',
    signInFile: 'auth.json',
    signInVerb: 'codex login',
  }),
  claude: Object.freeze({
    id: 'claude',
    dirField: 'configDir',
    homeEnv: 'CLAUDE_CONFIG_DIR',
    signInFile: '.credentials.json',
    signInVerb: 'claude auth login',
  }),
})

const PROVIDER_IDS = Object.freeze(Object.keys(PROVIDERS))

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function refusal(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

/* Where the engine keeps this machine's own state, resolved its way.
   resolveServicesRoot() in capability/src/lib/setup/machine-record.js is the
   original; it honours LOCALAPPDATA first, which is what makes a scratch profile
   in a suite possible without touching a real one. */
function accountsRegistryFile({ env = process.env, homedir = os.homedir } = {}) {
  const localAppData = env.LOCALAPPDATA
  if (typeof localAppData === 'string' && path.isAbsolute(localAppData)) {
    return path.join(localAppData, SERVICES_DIRECTORY, REGISTRY_LEAF)
  }
  return path.join(homedir(), '.toolsenabled', REGISTRY_LEAF)
}

/* THE POWERSHELL FORM, because Windows Terminal opens PowerShell and this string
   exists to be pasted into it. Single quotes are literal there, which is the
   only quoting that survives a Windows path with backslashes in it; a quote
   inside the path is doubled, the one escape PowerShell has. */
function powerShellLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function createAccountRegistryStore({ file, fsImpl = fs, homedir = os.homedir } = {}) {
  if (typeof file !== 'string' || !file) throw new Error('the account registry store needs its file path')

  /* The rotation record the engine's switcher writes, always beside the
     registry. Derived rather than passed so the two cannot be pointed at
     different directories by a caller who only remembered one of them. */
  const stateFile = path.join(path.dirname(file), STATE_LEAF)

  /* THE ONLY CALL IN THIS MODULE THAT RETURNS BYTES.
   *
   * It is bound to this product's own two files by a value comparison, so there
   * is no path -- not a crafted one, not a mistaken one -- by which this module
   * can read a provider's sign-in. Damage and absence are both `null` here; the
   * callers decide what each one means, and they decide differently. */
  function readOwnJson(target) {
    if (target !== file && target !== stateFile) return null
    let raw
    try {
      raw = fsImpl.readFileSync(target, 'utf8')
    } catch {
      return null
    }
    try {
      const parsed = JSON.parse(raw)
      return plainObject(parsed) ? parsed : null
    } catch {
      return null
    }
  }

  function registryFileExists() {
    try {
      return fsImpl.existsSync(file)
    } catch {
      return false
    }
  }

  /* The record as it is on disk, with entries left in the provider's own shape
     so that anything this screen does not understand -- a role, an expected
     email address -- survives an add and a remove untouched. */
  function loadRecord() {
    const parsed = readOwnJson(file)
    if (!parsed || !Array.isArray(parsed.accounts)) return null
    return parsed
  }

  function specFor(provider) {
    return nonEmptyString(provider) && Object.hasOwn(PROVIDERS, provider) ? PROVIDERS[provider] : null
  }

  /* A relative directory means "under my home", which is the contract
     config/codex.json and the engine's resolveProfileDir() already share. */
  function resolveHome(directory) {
    if (!nonEmptyString(directory)) return null
    const trimmed = directory.trim()
    if (path.isAbsolute(trimmed)) return path.resolve(trimmed)
    let home
    try {
      home = homedir()
    } catch {
      return null
    }
    if (!nonEmptyString(home)) return null
    return path.resolve(path.join(home, trimmed))
  }

  /* PRESENCE, AND NOTHING ELSE. One existsSync on the file that program keeps
     its sign-in in. No open, no size, no date, no bytes. */
  function signedInAt(spec, resolved) {
    if (!resolved) return 'no'
    try {
      return fsImpl.existsSync(path.join(resolved, spec.signInFile)) ? 'yes' : 'no'
    } catch {
      return 'no'
    }
  }

  /* Every entry the file holds that this screen can honestly describe. An entry
     naming an unknown provider, or missing the directory its provider requires,
     is skipped rather than shown wrong -- the engine will refuse the whole file
     for it, and the screen saying so is a separate job from this one. */
  function usableEntries(record) {
    if (!record) return []
    const out = []
    record.accounts.forEach((entry, index) => {
      if (!plainObject(entry)) return
      const spec = specFor(entry.provider)
      if (!spec) return
      if (!nonEmptyString(entry.name) || !nonEmptyString(entry[spec.dirField])) return
      out.push({
        entry,
        spec,
        name: entry.name.trim(),
        directory: entry[spec.dirField].trim(),
        priority: Number.isSafeInteger(entry.priority) && entry.priority > 0 ? entry.priority : index + 1,
      })
    })
    return out
  }

  function sameDirectory(left, right) {
    if (!left || !right) return false
    return left.toLowerCase() === right.toLowerCase()
  }

  function writeRecord(record) {
    const temp = `${file}.tmp-${process.pid}`
    fsImpl.mkdirSync(path.dirname(file), { recursive: true })
    fsImpl.writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`)
    fsImpl.renameSync(temp, file)
  }

  /* Removing the last account restores the absent state rather than leaving an
     empty list behind. See the header: an empty list is a refusal in the engine
     and absence is the quiet normal. */
  function forgetRecord() {
    try {
      fsImpl.rmSync(file, { force: true })
    } catch {
      /* Nothing to remove, or nothing that can be removed. Either way the
         person's next read is the honest one. */
    }
  }

  function signInCommandFor(spec, directory) {
    const resolved = resolveHome(directory)
    if (!resolved) {
      throw refusal('ACCOUNT_HOME_UNKNOWN', 'That folder cannot be resolved on this computer.')
    }
    return `$env:${spec.homeEnv}=${powerShellLiteral(resolved)}; ${spec.signInVerb}`
  }

  return {
    /* WHAT IS LISTED, WHERE EACH ONE LIVES, AND WHETHER IT HAS BEEN SIGNED IN.
     *
     * `damaged` is the one thing absence and a broken file do not share. Both
     * show no accounts -- a screen must not fail because an optional file is
     * malformed -- but only one of them means the person's list is still there
     * and unreadable, and add() refuses in that case rather than overwrite it. */
    list() {
      const record = loadRecord()
      const damaged = record === null && registryFileExists()
      const accounts = usableEntries(record)
        .map(item => {
          const resolved = resolveHome(item.directory)
          return {
            name: item.name,
            provider: item.spec.id,
            directory: resolved || item.directory,
            priority: item.priority,
            signedIn: signedInAt(item.spec, resolved),
          }
        })
        .sort((a, b) => (a.priority - b.priority)
          || a.provider.localeCompare(b.provider)
          || a.name.localeCompare(b.name))
      return { ok: true, accounts, damaged }
    },

    add({ name, provider, directory, priority } = {}) {
      const spec = specFor(provider)
      if (!spec) {
        throw refusal('ACCOUNT_PROVIDER_UNSUPPORTED', 'That kind of account cannot be added here.')
      }
      const cleanName = typeof name === 'string' ? name.trim().slice(0, MAX_NAME_LENGTH) : ''
      if (!cleanName) throw refusal('ACCOUNT_NAME_MISSING', 'Give the account a name.')
      if (typeof directory !== 'string' || !directory.trim()
        || directory.length > MAX_DIRECTORY_LENGTH || directory.includes('\0')) {
        throw refusal('ACCOUNT_FOLDER_INVALID', 'That folder cannot be used for an account.')
      }
      const cleanDirectory = directory.trim()
      const resolved = resolveHome(cleanDirectory)
      if (!resolved) {
        throw refusal('ACCOUNT_HOME_UNKNOWN', 'That folder cannot be resolved on this computer.')
      }
      let cleanPriority = null
      if (priority !== undefined && priority !== null && priority !== '') {
        const asNumber = typeof priority === 'number' ? priority : Number(priority)
        if (!Number.isSafeInteger(asNumber) || asNumber <= 0) {
          throw refusal('ACCOUNT_PRIORITY_INVALID', 'The order must be a whole number above zero.')
        }
        cleanPriority = asNumber
      }

      const record = loadRecord()
      if (record === null && registryFileExists()) {
        throw refusal('ACCOUNT_REGISTRY_DAMAGED', 'The list of accounts on this computer cannot be read, so nothing was changed.')
      }
      const existing = usableEntries(record)
      if (existing.length >= MAX_ACCOUNTS) {
        throw refusal('ACCOUNT_LIMIT', `This computer already lists ${MAX_ACCOUNTS} accounts.`)
      }

      /* Unique PER PROVIDER, which is the engine's rule and not a softening of
         it: one person's "school" is a real Codex account and a real Claude
         account, and refusing the second would be refusing the ordinary case. */
      for (const item of existing) {
        if (item.spec.id !== spec.id) continue
        if (item.name.toLowerCase() === cleanName.toLowerCase()) {
          throw refusal('ACCOUNT_NAME_TAKEN', 'That name is already used for this kind of account.')
        }
        if (sameDirectory(resolveHome(item.directory), resolved)) {
          throw refusal('ACCOUNT_FOLDER_SHARED', 'Another account of this kind already uses that folder.')
        }
      }

      const nextPriority = cleanPriority !== null
        ? cleanPriority
        : existing.reduce((highest, item) => Math.max(highest, item.priority), 0) + 1

      const previous = record || {}
      const kept = Array.isArray(previous.accounts) ? previous.accounts : []
      writeRecord({
        ...previous,
        exhaustedAtPercent: Number.isSafeInteger(previous.exhaustedAtPercent)
          && previous.exhaustedAtPercent > 0 && previous.exhaustedAtPercent <= 100
          ? previous.exhaustedAtPercent
          : DEFAULT_EXHAUSTED_AT_PERCENT,
        accounts: [
          ...kept,
          {
            name: cleanName,
            provider: spec.id,
            [spec.dirField]: cleanDirectory,
            priority: nextPriority,
          },
        ],
      })
      return { ok: true }
    },

    remove({ name, provider } = {}) {
      const spec = specFor(provider)
      if (!spec) {
        throw refusal('ACCOUNT_PROVIDER_UNSUPPORTED', 'That kind of account cannot be removed here.')
      }
      const cleanName = typeof name === 'string' ? name.trim() : ''
      if (!cleanName) throw refusal('ACCOUNT_NAME_MISSING', 'Name the account to remove.')

      const record = loadRecord()
      if (record === null) {
        if (registryFileExists()) {
          throw refusal('ACCOUNT_REGISTRY_DAMAGED', 'The list of accounts on this computer cannot be read, so nothing was changed.')
        }
        return { ok: true, removed: false }
      }
      const wanted = cleanName.toLowerCase()
      const next = record.accounts.filter(entry => {
        if (!plainObject(entry) || entry.provider !== spec.id) return true
        return !nonEmptyString(entry.name) || entry.name.trim().toLowerCase() !== wanted
      })
      if (next.length === record.accounts.length) return { ok: true, removed: false }
      if (next.length === 0) forgetRecord()
      else writeRecord({ ...record, accounts: next })
      return { ok: true, removed: true }
    },

    /* WHICH ACCOUNT THIS COMPUTER LAST SWITCHED TO, if it has ever switched.
     *
     * The engine's switcher keeps ONE active name for the machine, not one per
     * provider -- readState() in capability/src/lib/multi-account/switcher.js
     * reads a single `activeAccount` string. So this reports that one name and
     * the screen says no more than the record supports. Every field is optional,
     * every failure is "not known", and this never throws: a screen must not go
     * blank because an optional record is missing or malformed. */
    activeAccount() {
      const state = readOwnJson(stateFile)
      if (!state) return { name: null, at: null }
      const name = nonEmptyString(state.activeAccount) ? state.activeAccount.trim() : null
      const at = plainObject(state.lastSwitch) && nonEmptyString(state.lastSwitch.at)
        ? state.lastSwitch.at.trim()
        : null
      return { name, at }
    },

    /* THE OFFICIAL COMMAND, AS TEXT, FOR THE PERSON TO RUN THEMSELVES.
     *
     * Nothing here runs it and nothing here reads what it leaves behind. Signing
     * in happens inside the provider's own program, in the person's own browser,
     * which is the one arrangement where this product never touches a
     * credential. */
    signInCommand({ provider, directory } = {}) {
      const spec = specFor(provider)
      if (!spec) {
        throw refusal('ACCOUNT_PROVIDER_UNSUPPORTED', 'There is no sign-in command for that kind of account.')
      }
      return signInCommandFor(spec, directory)
    },
  }
}

module.exports = {
  PROVIDER_IDS,
  MAX_ACCOUNTS,
  MAX_NAME_LENGTH,
  accountsRegistryFile,
  createAccountRegistryStore,
}
