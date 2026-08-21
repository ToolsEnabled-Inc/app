/* THE LIST OF A PERSON'S OWN PROVIDER ACCOUNTS, AND THE THREE WAYS IT COULD DO
 * REAL DAMAGE.
 *
 * WHAT THIS GUARDS. shell/account-registry.cjs is the first thing in this
 * application that WRITES the file the engine's account rotation reads. That
 * file decides which sign-in the next agent runs on. So the failures worth a
 * suite are not cosmetic:
 *
 *   1. IT READS A CREDENTIAL. The module is handed the paths of directories that
 *      hold real sign-in files. It must decide "signed in" from existence alone
 *      and must never open one. Asserted twice below -- once against the source
 *      text, and once behaviourally, against a file layer that fails the test if
 *      a sign-in path is ever opened.
 *   2. IT WRITES A FILE THE ENGINE REFUSES. A Codex entry that names configDir,
 *      a duplicate name, two accounts on one home: each makes the whole registry
 *      unloadable, and the person would see their agents stop with no idea why.
 *   3. IT TURNS "NOTHING TO ROTATE" INTO AN ERROR. An absent file is the normal
 *      state on almost every computer. It must read as an empty list, and
 *      removing the last account must return to it rather than leave an empty
 *      list behind -- which the engine treats as a loud refusal.
 *
 * NOTHING HERE TOUCHES A REAL HOME. Every test runs inside a temporary profile:
 * LOCALAPPDATA is redirected, the home directory is injected, and the sign-in
 * files are bytes this suite wrote itself. The real %LOCALAPPDATA%\ToolsEnabled,
 * the real ~/.codex and the real ~/.claude are never read and never written.
 *
 * Run: node --test tools/test/account-registry.test.mjs
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require_ = createRequire(import.meta.url)
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const MODULE_FILE = path.join(REPO, 'shell', 'account-registry.cjs')
const PAYLOAD = path.join(REPO, 'capability')

const { accountsRegistryFile, createAccountRegistryStore } = require_(MODULE_FILE)

/* A WHOLE MACHINE IN A TEMPORARY DIRECTORY, in the shape
   tools/test/agent-confinement-provider.test.mjs already uses: LOCALAPPDATA
   moved somewhere disposable so the engine's own path resolution can be
   exercised rather than mimicked, plus a throwaway home directory so a relative
   folder like ".codex-school" cannot resolve onto the real one. */
function withScratchProfile(run) {
  const scratch = mkdtempSync(path.join(tmpdir(), 'mc-accounts-'))
  const localAppData = path.join(scratch, 'local')
  const home = path.join(scratch, 'home')
  mkdirSync(path.join(localAppData, 'ToolsEnabled'), { recursive: true })
  mkdirSync(home, { recursive: true })

  const previous = process.env.LOCALAPPDATA
  process.env.LOCALAPPDATA = localAppData
  try {
    const file = accountsRegistryFile()
    const store = createAccountRegistryStore({ file, homedir: () => home })
    return run({ scratch, home, localAppData, file, store })
  } finally {
    if (previous === undefined) delete process.env.LOCALAPPDATA
    else process.env.LOCALAPPDATA = previous
    rmSync(scratch, { recursive: true, force: true })
  }
}

/* A throwaway home for one account, with or without the file that program keeps
   its sign-in in. The bytes are deliberately not credential-shaped: nothing in
   this product ever opens them, and this suite proves it. */
function makeHome(home, leaf, signInFile) {
  const directory = path.join(home, leaf)
  mkdirSync(directory, { recursive: true })
  if (signInFile) writeFileSync(path.join(directory, signInFile), '{"note":"not a credential"}')
  return directory
}

/* ------------------------------------------------------------------
   1. Absence is the normal state, not a fault.
   ------------------------------------------------------------------ */

test('no list on this computer is an empty list and never an error', () => {
  withScratchProfile(({ file, store }) => {
    assert.equal(existsSync(file), false, 'the suite started with a list already written')
    const answer = store.list()
    assert.equal(answer.ok, true)
    assert.deepEqual(answer.accounts, [])
    assert.equal(answer.damaged, false, 'an absent list was reported as a damaged one')
    /* Reading must not create it either. A probe that writes is a probe that
       changes the answer it was asked for. */
    assert.equal(existsSync(file), false)
  })
})

test('the list is written where the engine already looks for it', () => {
  withScratchProfile(({ file, localAppData }) => {
    assert.equal(file, path.join(localAppData, 'ToolsEnabled', 'accounts.json'))
  })
})

test('removing the last account restores absence rather than an empty list', () => {
  /* An empty accounts array is ACCOUNTS_REGISTRY_EMPTY in the engine -- a loud
     refusal that means "no account is usable". Removing your second account must
     not put the machine into that state. */
  withScratchProfile(({ home, file, store }) => {
    makeHome(home, '.codex-school', 'auth.json')
    store.add({ name: 'school', provider: 'codex', directory: '.codex-school' })
    assert.equal(existsSync(file), true)
    assert.deepEqual(store.remove({ name: 'school', provider: 'codex' }), { ok: true, removed: true })
    assert.equal(existsSync(file), false, 'an empty list was left behind where absence belongs')
    assert.deepEqual(store.list().accounts, [])
  })
})

/* ------------------------------------------------------------------
   2. Adding, listing and removing.
   ------------------------------------------------------------------ */

test('an account added is an account listed, and removing it takes it away', () => {
  withScratchProfile(({ home, store }) => {
    makeHome(home, '.codex-school', 'auth.json')
    makeHome(home, '.codex-personal', null)

    assert.deepEqual(store.add({ name: 'school', provider: 'codex', directory: '.codex-school' }), { ok: true })
    assert.deepEqual(store.add({ name: 'personal', provider: 'codex', directory: '.codex-personal' }), { ok: true })

    const listed = store.list().accounts
    assert.equal(listed.length, 2)
    assert.deepEqual(listed.map(account => account.name), ['school', 'personal'], 'lowest priority first')
    assert.deepEqual(listed.map(account => account.priority), [1, 2])

    /* The signed-in answer is an existence check on the file that program keeps
       its sign-in in, and it is the only difference between these two homes. */
    assert.equal(listed[0].signedIn, 'yes')
    assert.equal(listed[1].signedIn, 'no')
    assert.equal(listed[0].directory, path.resolve(path.join(home, '.codex-school')))

    assert.deepEqual(store.remove({ name: 'personal', provider: 'codex' }), { ok: true, removed: true })
    assert.deepEqual(store.list().accounts.map(account => account.name), ['school'])
    /* Removing something that is not there is an answer, not a failure. */
    assert.deepEqual(store.remove({ name: 'personal', provider: 'codex' }), { ok: true, removed: false })
  })
})

test('one name may belong to both programs, and never twice to one', () => {
  withScratchProfile(({ home, store }) => {
    makeHome(home, '.codex-school', 'auth.json')
    makeHome(home, '.claude-school', '.credentials.json')
    makeHome(home, '.codex-school-two', null)

    store.add({ name: 'school', provider: 'codex', directory: '.codex-school' })
    /* The same person's school account exists on both programs. Refusing the
       second would be refusing the ordinary case. */
    assert.deepEqual(store.add({ name: 'school', provider: 'claude', directory: '.claude-school' }), { ok: true })

    assert.throws(
      () => store.add({ name: 'school', provider: 'codex', directory: '.codex-school-two' }),
      error => error.code === 'ACCOUNT_NAME_TAKEN',
      'a second Codex account called "school" was accepted, which the engine refuses',
    )

    const names = store.list().accounts.map(account => `${account.provider}:${account.name}`)
    assert.deepEqual(names.sort(), ['claude:school', 'codex:school'])
  })
})

test('two accounts of one program may not share a folder', () => {
  withScratchProfile(({ home, store }) => {
    makeHome(home, '.codex-school', 'auth.json')
    store.add({ name: 'school', provider: 'codex', directory: '.codex-school' })
    assert.throws(
      () => store.add({ name: 'second', provider: 'codex', directory: '.codex-school' }),
      error => error.code === 'ACCOUNT_FOLDER_SHARED',
    )
    /* A DIFFERENT program pointed at the same folder is merely unusual: the two
       read different files inside it, which is the engine's own rule. */
    assert.deepEqual(store.add({ name: 'school', provider: 'claude', directory: '.codex-school' }), { ok: true })
  })
})

test('only Codex and Claude accounts exist here', () => {
  withScratchProfile(({ home, store }) => {
    makeHome(home, '.gemini-school', null)
    for (const provider of ['gemini', 'gpt', '', null, 'CODEX']) {
      assert.throws(
        () => store.add({ name: 'school', provider, directory: '.gemini-school' }),
        error => error.code === 'ACCOUNT_PROVIDER_UNSUPPORTED',
        `provider ${JSON.stringify(provider)} was accepted`,
      )
    }
  })
})

/* ------------------------------------------------------------------
   3. The two folder fields, which are not interchangeable.
   ------------------------------------------------------------------ */

test('a Codex account is written with its own folder field, and a Claude one with its', () => {
  /* THE FAILURE THIS CATCHES IS SILENT AND TOTAL. A Codex entry carrying
     configDir makes the WHOLE registry unloadable -- the engine refuses the file,
     not the entry -- so one wrong field name stops every account on the machine
     and says nothing a person could act on. */
  withScratchProfile(({ home, file, store }) => {
    makeHome(home, '.codex-school', 'auth.json')
    makeHome(home, '.claude-school', '.credentials.json')
    store.add({ name: 'school', provider: 'codex', directory: '.codex-school' })
    store.add({ name: 'school', provider: 'claude', directory: '.claude-school' })

    const written = JSON.parse(readFileSync(file, 'utf8'))
    const codex = written.accounts.find(entry => entry.provider === 'codex')
    const claude = written.accounts.find(entry => entry.provider === 'claude')

    assert.equal(codex.profileDir, '.codex-school')
    assert.equal(Object.hasOwn(codex, 'configDir'), false, 'a Codex entry was given the Claude folder field')
    assert.equal(claude.configDir, '.claude-school')
    assert.equal(Object.hasOwn(claude, 'profileDir'), false, 'a Claude entry was given the Codex folder field')
    assert.equal(written.exhaustedAtPercent, 99)
  })
})

test('an entry that names the other program\'s folder field is not listed as usable', () => {
  withScratchProfile(({ home, file, store }) => {
    makeHome(home, '.codex-school', 'auth.json')
    makeHome(home, '.claude-school', '.credentials.json')
    /* Hand-written by somebody who guessed. Reading it must not report accounts
       that the engine would refuse the file over. */
    writeFileSync(file, JSON.stringify({
      exhaustedAtPercent: 99,
      accounts: [
        { name: 'wrong-codex', provider: 'codex', configDir: '.claude-school', priority: 1 },
        { name: 'wrong-claude', provider: 'claude', profileDir: '.codex-school', priority: 2 },
        { name: 'right', provider: 'codex', profileDir: '.codex-school', priority: 3 },
      ],
    }, null, 2))

    assert.deepEqual(store.list().accounts.map(account => account.name), ['right'])
  })
})

test('the file this writes is one the engine itself can load', () => {
  /* THE POSITIVE CONTROL. Every other assertion here checks this module against
     its own idea of the rules. This one hands the written file to the engine's
     real parser and requires it to come back.

     CODEX ONLY, deliberately: the copy of the engine inside this repository
     predates Claude accounts and refuses that provider outright, so asserting a
     Claude round trip here would measure the age of the payload rather than the
     correctness of the file. */
  withScratchProfile(({ home, file, store }) => {
    makeHome(home, '.codex-school', 'auth.json')
    makeHome(home, '.codex-personal', null)
    store.add({ name: 'school', provider: 'codex', directory: '.codex-school' })
    store.add({ name: 'personal', provider: 'codex', directory: '.codex-personal', priority: 5 })

    const registry = require_(path.join(PAYLOAD, 'src', 'lib', 'multi-account', 'registry.js'))
    const loaded = registry.loadRegistry({ configPath: file })
    assert.deepEqual(loaded.accounts.map(account => account.name), ['school', 'personal'])
    assert.equal(loaded.accounts[1].priority, 5)
    assert.equal(registry.profileProvisioned(loaded.accounts[0], { homeDir: home }), true)
    assert.equal(registry.profileProvisioned(loaded.accounts[1], { homeDir: home }), false)
  })
})

test('the order is a whole number above zero, and nothing else', () => {
  withScratchProfile(({ home, store }) => {
    makeHome(home, '.codex-school', null)
    for (const priority of [0, -1, 1.5, 'first', Number.NaN]) {
      assert.throws(
        () => store.add({ name: 'school', provider: 'codex', directory: '.codex-school', priority }),
        error => error.code === 'ACCOUNT_PRIORITY_INVALID',
        `priority ${JSON.stringify(priority)} was accepted`,
      )
    }
    assert.deepEqual(store.add({ name: 'school', provider: 'codex', directory: '.codex-school', priority: 4 }), { ok: true })
    assert.equal(store.list().accounts[0].priority, 4)
  })
})

/* ------------------------------------------------------------------
   4. The command a person runs, which this product never runs.
   ------------------------------------------------------------------ */

test('the sign-in command is the official one for each program, with the folder resolved', () => {
  /* MEASURED, NOT REMEMBERED. `codex --help` on codex-cli 0.146.0 lists `login`
     as a top-level command. `claude auth --help` on claude 2.1.186 lists `login`
     under `auth`, and there is NO bare `claude login` -- inventing one would put
     a command on screen that the person cannot run. */
  withScratchProfile(({ home, store }) => {
    const codexHome = path.resolve(path.join(home, '.codex-school'))
    const claudeHome = path.resolve(path.join(home, '.claude-school'))

    assert.equal(
      store.signInCommand({ provider: 'codex', directory: '.codex-school' }),
      `$env:CODEX_HOME='${codexHome}'; codex login`,
    )
    assert.equal(
      store.signInCommand({ provider: 'claude', directory: '.claude-school' }),
      `$env:CLAUDE_CONFIG_DIR='${claudeHome}'; claude auth login`,
    )
    /* An absolute folder is used as given, not joined onto the home again. */
    assert.equal(
      store.signInCommand({ provider: 'codex', directory: codexHome }),
      `$env:CODEX_HOME='${codexHome}'; codex login`,
    )
    assert.throws(
      () => store.signInCommand({ provider: 'gemini', directory: '.gemini' }),
      error => error.code === 'ACCOUNT_PROVIDER_UNSUPPORTED',
    )
  })
})

/* ------------------------------------------------------------------
   5. Which account this computer is on, when it has ever been asked.
   ------------------------------------------------------------------ */

test('the account in use is read from the rotation record, and its absence is not a failure', () => {
  withScratchProfile(({ file, store }) => {
    assert.deepEqual(store.activeAccount(), { name: null, at: null }, 'a missing record was not "not known"')

    const stateFile = path.join(path.dirname(file), 'multi-account-state.json')
    writeFileSync(stateFile, JSON.stringify({
      activeAccount: 'school',
      lastSwitch: { at: '2026-08-18T00:00:00.000Z', from: null, to: 'school' },
      history: [],
    }))
    assert.deepEqual(store.activeAccount(), { name: 'school', at: '2026-08-18T00:00:00.000Z' })

    /* Every field optional, every failure "not known", and never a throw: a
       screen must not go blank because an optional record is malformed. */
    writeFileSync(stateFile, '{ not json at all')
    assert.deepEqual(store.activeAccount(), { name: null, at: null })
    writeFileSync(stateFile, JSON.stringify({ activeAccount: 42, lastSwitch: 'soon' }))
    assert.deepEqual(store.activeAccount(), { name: null, at: null })
  })
})

/* ------------------------------------------------------------------
   6. A damaged list is not an empty one, and must not be overwritten.
   ------------------------------------------------------------------ */

test('a list that cannot be read is reported as unread, and adding refuses rather than replaces it', () => {
  withScratchProfile(({ home, file, store }) => {
    makeHome(home, '.codex-school', null)
    writeFileSync(file, '{ "accounts": [ this is not json')

    const answer = store.list()
    assert.equal(answer.ok, true, 'a damaged list threw instead of degrading')
    assert.deepEqual(answer.accounts, [])
    assert.equal(answer.damaged, true, 'a damaged list was reported as an absent one')

    assert.throws(
      () => store.add({ name: 'school', provider: 'codex', directory: '.codex-school' }),
      error => error.code === 'ACCOUNT_REGISTRY_DAMAGED',
      'an unreadable list was silently replaced, losing whatever it held',
    )
    assert.equal(readFileSync(file, 'utf8'), '{ "accounts": [ this is not json')
  })
})

/* ------------------------------------------------------------------
   7. The credential fence, asserted twice.
   ------------------------------------------------------------------ */

test('the store never opens a sign-in file, proved against the file layer it uses', () => {
  /* THE BEHAVIOURAL HALF, and it is the one that would catch a rewrite. The
     injected layer fails the test the moment anything asks to read a path that
     looks like a provider's sign-in, and records every existence check so the
     positive control is visible: the answer really did come from looking. */
  withScratchProfile(({ home, file }) => {
    const signInHome = makeHome(home, '.codex-school', 'auth.json')
    makeHome(home, '.claude-school', '.credentials.json')

    const opened = []
    const probed = []
    const guardedFs = {
      readFileSync(target, encoding) {
        opened.push(target)
        return readFileSync(target, encoding)
      },
      existsSync(target) {
        probed.push(target)
        return existsSync(target)
      },
      mkdirSync(target, options) { mkdirSync(target, options) },
      writeFileSync(target, contents) { writeFileSync(target, contents) },
      renameSync(from, to) { rmSync(to, { force: true }); writeFileSync(to, readFileSync(from)); rmSync(from, { force: true }) },
      rmSync(target, options) { rmSync(target, options) },
    }
    const store = createAccountRegistryStore({ file, fsImpl: guardedFs, homedir: () => home })

    store.add({ name: 'school', provider: 'codex', directory: '.codex-school' })
    store.add({ name: 'school', provider: 'claude', directory: '.claude-school' })
    const listed = store.list().accounts
    store.activeAccount()

    assert.equal(listed.length, 2)
    assert.deepEqual(listed.map(account => account.signedIn), ['yes', 'yes'])

    for (const target of opened) {
      assert.ok(
        !target.endsWith('auth.json') && !target.endsWith('.credentials.json'),
        `the store opened ${target}: a screen that reports a sign-in must never read one`,
      )
    }
    /* THE POSITIVE CONTROL. "Nothing was opened" is only meaningful if the
       sign-in answer was reached at all, so the existence check must be there. */
    assert.ok(
      probed.some(target => target === path.join(signInHome, 'auth.json')),
      'nothing ever checked for the sign-in file, so "yes" was not a reading of the disk',
    )
  })
})

test('the module contains no call that could return the contents of a sign-in', () => {
  /* THE SOURCE HALF, copied from tools/test/provider-cli-presence.test.mjs. Its
     own prose explains why it does not read credentials, so the comments are
     stripped before the scan -- a raw scan would read the explanation as the
     violation. */
  const source = readFileSync(MODULE_FILE, 'utf8')
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')

  const BANNED = [
    'createReadStream', 'openSync', 'readSync',
    'readdir', 'readdirSync', 'realpathSync', 'readlinkSync',
    'child_process', 'spawn', 'execFile', 'execSync',
  ]
  for (const banned of BANNED) {
    assert.ok(!code.includes(banned), `${banned} appears in the account store`)
  }

  /* THE ONE READER THAT HAS TO EXIST, because this module owns a JSON file of
     its own -- and it is allowed exactly once, inside the function that refuses
     every path except this product's own two files. A second occurrence is a
     second door, and there is no honest reason for one. */
  const occurrences = code.split('readFileSync').length - 1
  assert.equal(occurrences, 1, 'the account store has more than one call that returns bytes')
  const body = code.slice(code.indexOf('function readOwnJson'))
  assert.ok(body.includes('readFileSync'), 'the one reader is no longer inside readOwnJson')
  assert.ok(
    body.slice(0, body.indexOf('readFileSync')).includes('target !== file'),
    'the reader is no longer fenced to this product\'s own files',
  )
})
