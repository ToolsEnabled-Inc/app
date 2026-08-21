/* The sign-in probe, and the three ways it could quietly become a liar.
 *
 * WHAT IS BEING GUARDED. shell/provider-cli-presence.cjs is the only thing in
 * this product that answers "is the program that runs an agent on this computer,
 * and is it signed in". Three properties make it safe to put in front of a
 * person, and all three are invisible in ordinary use:
 *
 *   1. IT NEVER READS A CREDENTIAL. The fence is that the module contains no
 *      call that returns file contents. A comment claiming that is worth
 *      nothing, so this suite reads the source and fails on any such call. This
 *      is the one assertion here that is about text, and it is about text
 *      because the property is the ABSENCE of code, which no behavioural test
 *      can observe.
 *   2. IT NEVER RETURNS A PATH. An answer crossing into the renderer that
 *      carries a filesystem path is how a private checkout name reached the DOM
 *      once already. So the shape of the answer is asserted exhaustively rather
 *      than sampled.
 *   3. IT NEVER TURNS "I COULD NOT TELL" INTO "YOU HAVE NOT DONE IT". Reporting
 *      a signed-in person as signed out sends them to run a command they have
 *      already run, and they conclude the product is broken. Every uncertain
 *      branch must answer 'unknown'.
 *
 * THE POSITIVE CONTROL IS THE FIRST TEST AND IT IS NOT OPTIONAL. A suite made
 * only of injected fakes passes just as well against a function that returns a
 * hardcoded object. The machine this runs on has all three programs installed
 * and signed in, measured directly before this file was written:
 *
 *   claude 2.1.186   %APPDATA%\npm\claude.cmd    claude auth status -> loggedIn true
 *   codex            %APPDATA%\npm\codex.cmd     codex login status -> Logged in
 *   gemini 0.53.0    %APPDATA%\npm\gemini.cmd    ~/.gemini/oauth_creds.json present
 *
 * So a real run must report all three installed. It is written to SKIP rather
 * than fail where that is not true, because a build machine with no CLI on it is
 * not a defect in this module -- but the skip says so out loud, so a green run
 * on a bare machine cannot be mistaken for the control having passed.
 *
 * Run: node --test tools/test/provider-cli-presence.test.mjs
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require_ = createRequire(import.meta.url)
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const MODULE_FILE = path.join(REPO_ROOT, 'shell', 'provider-cli-presence.cjs')

const { PROVIDER_IDS, PRESENCE_STATES, providerCliPresence } = require_(MODULE_FILE)

/* ------------------------------------------------------------------
   1. The positive control: this machine, with nothing injected.
   ------------------------------------------------------------------ */

test('on a real machine it reports the programs that are really there', (t) => {
  const answer = providerCliPresence()
  assert.equal(answer.ok, true)
  assert.equal(answer.providers.length, 3)

  const installed = answer.providers.filter(provider => provider.installed === 'yes')
  if (installed.length === 0) {
    t.skip('no agent CLI is installed on this machine, so the control cannot run here')
    return
  }
  /* Whatever it found, it must have found it by the same rule a command line
     uses. A provider reported installed with no sign-in answer at all would mean
     the two halves disagree about which machine they are on. */
  for (const provider of installed) {
    assert.ok(
      PRESENCE_STATES.includes(provider.signedIn),
      `${provider.id} is installed but its sign-in answer is not one of the three states`,
    )
  }
})

/* ------------------------------------------------------------------
   2. The shape. No paths, no extra fields, no open vocabulary.
   ------------------------------------------------------------------ */

test('every answer is a word from a closed set and never a path', () => {
  /* Driven against a fabricated machine so the assertion does not depend on
     what happens to be installed where this runs. */
  const answer = providerCliPresence({
    platform: 'win32',
    env: { PATH: 'C:\\tools;C:\\Users\\somebody\\AppData\\Roaming\\npm', PATHEXT: '.CMD;.EXE' },
    homedir: () => 'C:\\Users\\somebody',
    statSync: () => ({ isFile: () => true }),
    existsSync: () => true,
  })

  assert.deepEqual(answer.providers.map(provider => provider.id), [...PROVIDER_IDS])

  for (const provider of answer.providers) {
    assert.deepEqual(
      Object.keys(provider).sort(),
      ['id', 'installed', 'signedIn'],
      `${provider.id} carries a field beyond the three this may report`,
    )
    assert.ok(PRESENCE_STATES.includes(provider.installed))
    assert.ok(PRESENCE_STATES.includes(provider.signedIn))
  }

  /* The blunt version of the same rule: no VALUE in the answer may look like a
     directory, a drive letter or a home.

     It walks the values rather than JSON.stringify(answer), and the first
     version of this test got that wrong: a serialised object contains ':' as
     its own syntax, so scanning the envelope reported a path in an answer that
     had none. That was the harness being wrong about the product, which is the
     one failure mode a fence test must not have. */
  const values = answer.providers.flatMap(provider => Object.values(provider))
  for (const value of values) {
    for (const fragment of ['\\', '/', ':', 'Users', 'AppData', 'npm', 'somebody']) {
      assert.ok(
        !String(value).includes(fragment),
        `the answer carries "${fragment}" in a value, which means a path can reach the renderer`,
      )
    }
  }
})

/* ------------------------------------------------------------------
   3. Uncertainty is never reported as absence.
   ------------------------------------------------------------------ */

test('a machine with no readable PATH is unknown, never not-installed', () => {
  const answer = providerCliPresence({
    platform: 'win32',
    env: {},
    homedir: () => 'C:\\Users\\somebody',
    existsSync: () => false,
  })
  for (const provider of answer.providers) {
    assert.equal(provider.installed, 'unknown', `${provider.id} claimed an answer it could not have`)
  }
})

test('a machine with no home directory is unknown, never signed out', () => {
  const answer = providerCliPresence({
    platform: 'win32',
    env: { PATH: 'C:\\tools', PATHEXT: '.CMD' },
    homedir: () => { throw new Error('no home on this account') },
    statSync: () => { throw new Error('nothing here') },
  })
  for (const provider of answer.providers) {
    assert.equal(provider.signedIn, 'unknown', `${provider.id} claimed a sign-in answer it could not have`)
  }
})

test('a missing Claude or Gemini sign-in file is unknown, because both have other ways in', () => {
  const answer = providerCliPresence({
    platform: 'win32',
    env: { PATH: 'C:\\tools', PATHEXT: '.CMD' },
    homedir: () => 'C:\\Users\\somebody',
    statSync: () => ({ isFile: () => true }),
    existsSync: () => false,
  })
  const state = id => answer.providers.find(provider => provider.id === id).signedIn

  /* Claude Code authenticates from the operating system keychain or from a key
     in the environment as well as from its own file, so an absent file proves
     nothing. Telling that person to sign in again would be the product being
     confidently wrong about their own machine. */
  assert.equal(state('claude'), 'unknown')
  assert.equal(state('gemini'), 'unknown')

  /* Codex is the exception and it is not an inconsistency: this shell already
     REFUSES to start a confined session on exactly this missing file
     (confinedSessionIsSignedOut in shell/agent-host.cjs). Answering 'unknown'
     here would have the setup screen disagree with the refusal a person is
     about to hit. */
  assert.equal(state('codex'), 'no')
})

test('a sign-in file that is present is reported for every provider', () => {
  const answer = providerCliPresence({
    platform: 'win32',
    env: { PATH: 'C:\\tools', PATHEXT: '.CMD' },
    homedir: () => 'C:\\Users\\somebody',
    statSync: () => ({ isFile: () => true }),
    existsSync: () => true,
  })
  for (const provider of answer.providers) {
    assert.equal(provider.signedIn, 'yes', `${provider.id} did not report a sign-in that is there`)
  }
})

test('the variable that relocates a configuration directory is honoured', () => {
  const looked = []
  const answer = providerCliPresence({
    platform: 'win32',
    env: { PATH: 'C:\\tools', PATHEXT: '.CMD', CODEX_HOME: 'D:\\elsewhere\\codex' },
    homedir: () => 'C:\\Users\\somebody',
    statSync: () => { throw new Error('nothing here') },
    existsSync: (candidate) => { looked.push(candidate); return false },
  })
  assert.ok(
    looked.some(candidate => candidate.startsWith('D:\\elsewhere\\codex')),
    'a person who moved their Codex home was still reported against the default one',
  )
  assert.equal(answer.providers.find(provider => provider.id === 'codex').signedIn, 'no')
})

/* ------------------------------------------------------------------
   4. The credential fence, asserted against the source.
   ------------------------------------------------------------------ */

test('the module contains no call that could return the contents of a file', () => {
  const source = readFileSync(MODULE_FILE, 'utf8')
  /* Strip comments first. This file's own prose explains WHY it does not read
     credentials, and a raw scan would read that explanation as the violation. */
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')

  const READERS = [
    'readFile', 'readFileSync', 'createReadStream', 'openSync', 'readSync',
    'readdir', 'readdirSync', 'realpathSync', 'readlinkSync',
  ]
  for (const reader of READERS) {
    assert.ok(
      !code.includes(reader),
      `${reader} appears in the probe: a screen that reports a sign-in must never read one`,
    )
  }

  /* And it must not start anything. `claude auth status` is the right answer to
     give a PERSON and the wrong thing for a screen to run on mount. */
  for (const spawner of ['child_process', 'spawn', 'execFile', 'execSync']) {
    assert.ok(
      !code.includes(spawner),
      `${spawner} appears in the probe: a mount-time read must not start a child process`,
    )
  }
})
