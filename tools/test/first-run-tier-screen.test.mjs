// The permission-level question: does it get asked, and does it tell the truth?
//
// The owner named "logging in or creating a secure user account or setting up
// anything" as a failure condition, and the permission level is the one thing
// docs/design/INSTALLER-EXPERIENCE.md 2.1 says has to be decided first. It was
// fully specified, fully catalogued, and had never been built: the question
// existed only in tools/mcsetup.js, an interactive command-line program.
//
// These assertions cover the three ways this screen can be quietly wrong:
//
//   1. It is never shown, or is shown when it must not be. The gate decides
//      what a customer sees on the one launch they form an opinion on, and it
//      has to fail OPEN -- a build that cannot record a level must not trap
//      anyone behind a button guaranteed to fail.
//   2. Its words drift from the command line's. Two setup paths asking the
//      same question differently is two products.
//   3. The enforcement disclosure goes missing, or stops being AT the point of
//      choice. That notice is the whole reason this screen can honestly print
//      "cannot reach anything else on this computer" above it, and the one
//      approved disclosed limitation on this product. A screen that keeps the
//      sentence and drops the caveat is worse than no screen.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import {
  DEFAULT_TIER,
  TIER_CHOICES,
  TIER_IDS,
  TIER_LIMIT_NOTICE,
  firstRunPending,
  readSetupState,
} from '../../src/setup-state.js'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = relative => readFileSync(path.join(REPO_ROOT, relative), 'utf8')

const VIEW = read('src/views/setup.js')
const ROUTER = read('src/main.js')
const MCSETUP = (() => {
  /* The command-line question lives in the ENGINE tree, which is a sibling
     checkout and not guaranteed present. When it is, its wording is compared
     byte for byte; when it is not, that single test skips and the rest still
     run. A suite that silently passes because it found nothing is the defect
     tools/check-suites-discovered.mjs exists to prevent, so this reports the
     skip rather than swallowing it. */
  const configured = process.env.TOOLSENABLED_SOURCE
    || path.join(path.dirname(REPO_ROOT), 'toolsenabled-current')
  try {
    return readFileSync(path.join(configured, 'tools', 'mcsetup.js'), 'utf8')
  } catch {
    return null
  }
})()

/* ---------- 1. the gate ---------- */

test('first launch opens on the question when nothing has been recorded', () => {
  const state = readSetupState({ mcSetup: { chooseTier() {}, bootstrap: { ok: true, available: true, configured: false, tier: null } } })
  assert.equal(state.available, true)
  assert.equal(firstRunPending(state), true)
})

test('a recorded level ends the gate', () => {
  const state = readSetupState({ mcSetup: { chooseTier() {}, bootstrap: { ok: true, available: true, configured: true, tier: 'standard' } } })
  assert.equal(state.tier, 'standard')
  assert.equal(firstRunPending(state), false)
})

/* FAILS OPEN. Each of these is a copy that CANNOT write a level. Gating on the
   question would leave the person with one button that always fails and no way
   past it -- a missing payload turned into an unusable app. */
test('the gate fails open where no level can be recorded', () => {
  const browser = readSetupState({})
  assert.equal(browser.available, false)
  assert.equal(browser.code, 'MC_SETUP_SHELL_ABSENT')
  assert.equal(firstRunPending(browser), false)

  const noPayload = readSetupState({ mcSetup: { chooseTier() {}, bootstrap: { ok: false, code: 'SETUP_PAYLOAD_ABSENT', reason: 'no payload' } } })
  assert.equal(noPayload.available, false)
  assert.equal(firstRunPending(noPayload), false)
})

/* A record that exists and cannot be parsed is NOT "not set up yet". Reading it
   that way invites this screen to overwrite a configuration nobody could read,
   which is precisely what readMachineRecord refuses to do. */
test('an unreadable record is never reported as a fresh machine', () => {
  const state = readSetupState({
    mcSetup: { chooseTier() {}, bootstrap: { ok: true, available: true, unreadable: true, code: 'SETUP_MACHINE_RECORD_MALFORMED', reason: 'malformed' } },
  })
  assert.equal(state.configured, false)
  assert.equal(state.available, false)
  assert.equal(state.code, 'SETUP_MACHINE_RECORD_MALFORMED')
  assert.equal(firstRunPending(state), false)
})

/* A `configured: true` carrying a tier this build does not know is a record
   from a different version. Trusting the flag alone would send someone into the
   app at a level nothing here can name. */
test('configured is not believed without a tier this build knows', () => {
  const state = readSetupState({ mcSetup: { chooseTier() {}, bootstrap: { ok: true, available: true, configured: true, tier: 'omnipotent' } } })
  assert.equal(state.tier, null)
  assert.equal(state.configured, false)
  assert.equal(firstRunPending(state), true)
})

test('the router mounts the setup route and gates on it', () => {
  assert.match(ROUTER, /parts\[0\] === 'setup'/, 'src/main.js parses no #/setup route')
  assert.match(ROUTER, /case 'setup': return setupView/, 'src/main.js never mounts the setup view')
  assert.match(ROUTER, /firstRunPending\(SETUP_RESOLUTION\)/, 'src/main.js never consults the first-run gate')
  assert.match(ROUTER, /location\.hash = '#\/setup'/, 'src/main.js never redirects a first launch to the question')
})

/* ---------- 2. the words ---------- */

test('the three levels are the three the command line offers, in order', () => {
  assert.deepEqual(TIER_IDS, ['guided', 'standard', 'unrestricted'])
  // preselected first, so the least confident reader can proceed by not deciding
  assert.equal(DEFAULT_TIER, 'guided')
  assert.equal(TIER_CHOICES[0].note, 'Recommended')
})

test('every level says what happens to the computer', { skip: MCSETUP ? false : 'engine tree not present beside this checkout' }, () => {
  for (const choice of TIER_CHOICES) {
    /* Compared with straight quotes because the command line prints ASCII and
       this screen sets typographic ones; the SENTENCE has to match, not the
       apostrophe. */
    const plain = choice.detail.replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    assert.ok(
      MCSETUP.includes(plain),
      `the screen describes "${choice.tier}" in words tools/mcsetup.js does not use; two setup paths asking one question differently is two products`,
    )
  }
})

test('the screen renders the levels through the settings surface, not a new one', () => {
  assert.match(VIEW, /seg settings-seg/, 'the choice does not use the seg control section 2.1 names')
  assert.match(VIEW, /class="settings-row setup-choice"/, 'the options are not settings rows')
  assert.match(VIEW, /class="ctl-btn"/, 'the button is not the house button')
})

/* ---------- 3. the disclosure, AT the point of choice ---------- */

test('the enforcement gap is disclosed in the words that admit it', () => {
  const notice = TIER_LIMIT_NOTICE.join(' ')
  assert.match(notice, /does not yet confine an assistant once that assistant is running/)
  assert.match(notice, /not a limit enforced while the assistant works/)
  assert.match(notice, /not built yet/)
})

/* The clause "and setup shows you the set it wrote" is TRUE of the command
   line, which generates the configuration in the same run and prints it, and
   FALSE of this screen, which records the level and generates nothing. A
   disclosure that overclaims in its own reassuring half is not a disclosure. */
test('the disclosure does not claim this screen wrote a configuration', () => {
  const notice = TIER_LIMIT_NOTICE.join(' ')
  assert.doesNotMatch(notice, /shows you the set it wrote/)
  assert.doesNotMatch(VIEW, /shows you the set it wrote/)
})

/* AT the point of selection. The notice being somewhere in the bundle is not
   the requirement -- it has to be on this screen, beside the choice, in the
   pattern this app already uses for correctness data carrying a severity. */
test('the disclosure is on the screen, warn-toned, and next to the choice', () => {
  assert.match(VIEW, /fleet-profile-status is-warn/, 'the disclosure does not use the house severity pattern')
  assert.match(VIEW, /TIER_LIMIT_NOTICE\.map/, 'the disclosure text is not rendered on this screen')

  /* Read the TEMPLATE, not the file. Offsets over the whole source measure the
     order the helpers happen to be declared in, which is not the order anything
     appears on screen -- an earlier version of this test passed on exactly that
     coincidence. markup() is the one function whose text is the page. */
  const start = VIEW.indexOf('function markup()')
  assert.notEqual(start, -1, 'src/views/setup.js no longer builds its page in markup()')
  const template = VIEW.slice(start, VIEW.indexOf('function paint()', start))

  const seg = template.indexOf('seg settings-seg')
  const disclosure = template.indexOf('${disclosureMarkup()}')
  const button = template.indexOf('data-setup-continue')
  assert.ok(seg !== -1, 'the page template renders no seg control')
  assert.ok(disclosure !== -1, 'the page template renders no disclosure')
  assert.ok(button !== -1, 'the page template renders no continue button')
  assert.ok(
    seg < disclosure && disclosure < button,
    'the disclosure must sit between the choices and the button; buried after the button it is not at the point of selection',
  )
})

/* ---------- the choice actually leaves the screen ---------- */

test('continuing sends the level to the shell rather than only repainting', () => {
  assert.match(VIEW, /mcSetup\.chooseTier\(chosen\)/, 'the screen never hands the chosen level to the shell')
  assert.match(VIEW, /noteTierRecorded\(/, 'a saved level never updates the gate, so the app would bounce back to the question')
})

/* Comparing the three options by clicking between them is reading, not
   deciding. Writing on every click would record levels nobody chose. */
test('clicking a level does not record it; Continue does', () => {
  const select = VIEW.slice(VIEW.indexOf('function select('), VIEW.indexOf('async function commit('))
  assert.doesNotMatch(select, /chooseTier/, 'selecting an option writes a configuration before the person has decided')
})
