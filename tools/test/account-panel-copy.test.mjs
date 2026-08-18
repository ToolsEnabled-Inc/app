/* THE WORDS ON THE ACCOUNTS PANEL, AND THE WARNING THAT HAS TO SHIP WITH IT.
 *
 * WHY THE WARNING GETS A SUITE OF ITS OWN. The legal position on running Claude
 * from a shipped product dropped every cap and every restriction: the person
 * decides. The four-point warning is the ONLY instrument standing in place of
 * those restrictions, which makes it a shipped obligation rather than a nicety.
 * It fails in three ways worth a test, and all three are quiet:
 *
 *   1. IT GOES MISSING. Somebody moves it behind the asynchronous read, and it
 *      disappears on exactly the machines where the read does not answer.
 *   2. IT TURNS INTO BOILERPLATE. The four specifics are replaced by one
 *      sentence about "usage limits", which warns nobody of anything.
 *   3. IT OFFERS A DOOR THAT IS NOT THERE. The position says to name key-based
 *      sign-in as the alternative. This build does not carry that transport, and
 *      a screen that offered it would be untrue -- which is a worse failure than
 *      the one the warning exists to prevent.
 *
 * Run: node --test tools/test/account-panel-copy.test.mjs
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ACCOUNT_PANEL, CLAUDE_ACCOUNT_RISK } from '../../src/account-panel-copy.js'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const GUIDE_VIEW = path.join(REPO, 'src', 'views', 'guide.js')
const PRELOAD = path.join(REPO, 'shell', 'fleet-profile-preload.cjs')
const MAIN = path.join(REPO, 'shell', 'main.cjs')

function everyPanelSentence() {
  return Object.values(ACCOUNT_PANEL)
    .map(value => (typeof value === 'function' ? value('Codex') : value))
    .filter(value => typeof value === 'string')
}

/* ------------------------------------------------------------------
   1. The four specifics, in the order they matter.
   ------------------------------------------------------------------ */

test('the warning carries four points and not a paragraph', () => {
  assert.equal(CLAUDE_ACCOUNT_RISK.points.length, 4)
  for (const point of CLAUDE_ACCOUNT_RISK.points) {
    assert.equal(typeof point, 'string')
    assert.ok(point.trim().length > 30, `"${point}" is too short to be one of the four specifics`)
  }
})

test('whose account carries the consequence is said FIRST', () => {
  /* The order is the argument. A person is being asked to accept a risk on
     their own account, so the first thing they read must be that it is their
     account -- not ours, and not the product's. */
  const first = CLAUDE_ACCOUNT_RISK.points[0].toLowerCase()
  assert.match(first, /your own account/, 'the first point does not name the reader\'s own account')
  assert.match(first, /not on ours/, 'the first point does not say the risk is not ours')

  const later = CLAUDE_ACCOUNT_RISK.points.slice(1).join(' ').toLowerCase()
  assert.ok(!later.includes('your own account'), 'the point that must come first is repeated later instead')
})

test('the provider being able to change this without notice is point two', () => {
  const second = CLAUDE_ACCOUNT_RISK.points[1].toLowerCase()
  assert.match(second, /anthropic/, 'the second point does not name who can change it')
  assert.match(second, /change|shut it off|block/, 'the second point does not say it can be changed or stopped')
  assert.match(second, /tell you first|without notice|any time/, 'the second point does not say it can happen unannounced')
})

test('point three says volume is the signal, not the program', () => {
  /* The finding this is drawn from: the classifier keys on request velocity and
     not on third-party software -- it false-positived on the provider's own
     tool. So a person who reads "do not use this product" has been misinformed;
     what they can act on is how much they run. */
  const third = CLAUDE_ACCOUNT_RISK.points[2].toLowerCase()
  assert.match(third, /how much you run|volume/, 'the third point does not name volume as the signal')
  assert.match(third, /signal/, 'the third point does not say what the signal is')
  assert.match(third, /heavy|unattended/, 'the third point does not say what heavy use looks like')
})

test('point four names the one correlation a person can actually avoid', () => {
  const fourth = CLAUDE_ACCOUNT_RISK.points[3].toLowerCase()
  assert.match(fourth, /plan/, 'the fourth point does not mention changing a plan')
  assert.match(fourth, /automation|running/, 'the fourth point does not mention running automation at the time')
  assert.match(fourth, /payment|plan change/, 'the fourth point does not say what the reported blocks followed')
})

test('the alternative offered is one this build really has', () => {
  /* THE DELIBERATE DEPARTURE FROM THE ADVICE, and it is recorded here rather
     than only in a report. The position says to name key-based sign-in in the
     same breath. That transport is not in this build. Naming it would put a door
     on screen with nothing behind it, so the alternative named is the one that
     exists today: do the work by hand, outside this window. */
  const today = CLAUDE_ACCOUNT_RISK.today.toLowerCase()
  for (const absent of ['api key', 'api-key', 'your key', 'a key instead', 'console']) {
    assert.ok(!today.includes(absent), `the warning offers "${absent}", which this build does not carry`)
  }
  assert.match(today, /by hand|outside this window/, 'the warning names no alternative at all')
})

/* ------------------------------------------------------------------
   2. What the panel may never say.
   ------------------------------------------------------------------ */

test('no copy on this surface uses the provider\'s product name for its tool', () => {
  /* A written branding rule, independent of how anything authenticates: the
     product is not named on our screens and its look is not imitated. */
  const prose = [...everyPanelSentence(), ...CLAUDE_ACCOUNT_RISK.points, CLAUDE_ACCOUNT_RISK.today, CLAUDE_ACCOUNT_RISK.heading]
  for (const sentence of prose) {
    assert.ok(!/claude\s*code/i.test(sentence), `"${sentence}" names the provider's own tool`)
  }
})

test('the panel never asks a person for a credential', () => {
  /* The same list tools/test/first-run-needs.test.mjs holds the guide page to.
     This is the screen where somebody is most primed to hand a key over, so it
     is the screen that must never have a field for one. */
  const prose = [...everyPanelSentence(), CLAUDE_ACCOUNT_RISK.today].join(' ').toLowerCase()
  for (const ask of ['paste your', 'enter your key', 'api key here', 'copy your token', 'your password']) {
    assert.ok(!prose.includes(ask), `the panel asks for a credential: "${ask}"`)
  }
})

test('an empty list reads as a working computer, not as a fault', () => {
  /* Almost everybody has exactly one sign-in. That is a complete setup, and a
     screen that greets it with a failure has invented a problem. */
  const none = ACCOUNT_PANEL.none.toLowerCase()
  for (const alarming of ['error', 'failed', 'missing', 'not found', 'problem', 'invalid']) {
    assert.ok(!none.includes(alarming), `the empty state reads as a fault: "${alarming}"`)
  }
  assert.match(none, /one sign-in already on this computer/, 'the empty state does not say what IS being used')
  assert.match(none, /add a name and a folder/, 'the empty state does not say how to add another')
})

/* ------------------------------------------------------------------
   3. Where the words are drawn, which decides whether they ship.
   ------------------------------------------------------------------ */

test('the guide page draws these words from the module rather than retyping them', () => {
  const source = readFileSync(GUIDE_VIEW, 'utf8')
  assert.match(source, /from '\.\.\/account-panel-copy\.js'/, 'the guide view no longer reads this copy module')
  assert.match(source, /CLAUDE_ACCOUNT_RISK\.points/, 'the four points are not rendered by the guide view')
  assert.match(source, /<code class="guide-command">/, 'the sign-in line is not drawn as a command the way the steps are')
})

test('the warning is drawn with the page and not by the read that can fail', () => {
  /* THE FAILURE THIS CATCHES IS THE WHOLE REASON THE FILE IS ARRANGED AS IT IS.
     fillAccounts() degrades silently -- no bridge, a plain browser, a read that
     never answers -- and a warning inside it would be absent on exactly those
     machines. So it must be built by the static markup, beside the commands. */
  const source = readFileSync(GUIDE_VIEW, 'utf8')
  const providerMarkup = source.slice(source.indexOf('function providerMarkup'), source.indexOf('const ACCOUNT_PROVIDERS'))
  assert.match(providerMarkup, /claudeRiskMarkup\(provider\)/, 'the warning is not part of the static provider markup')

  const fill = source.slice(source.indexOf('function paintAccounts'))
  assert.ok(!fill.includes('claudeRiskMarkup'), 'the warning is drawn by the asynchronous read, so it can go missing')
})

test('an absent bridge leaves the page as it was, with no dead controls', () => {
  const source = readFileSync(GUIDE_VIEW, 'utf8')
  const fill = source.slice(source.indexOf('async function fillAccounts'))
  assert.match(fill, /window\.mcProviders\?\.accounts\(\)/, 'the account read no longer guards on the bridge being there')
  assert.match(fill, /catch \{\s*return\s*\}/, 'a failed read no longer leaves the page alone')
  /* The panel ships hidden and is only unhidden by a real answer, which is what
     stops an add button appearing in a window that cannot reach the program. */
  assert.match(source, /data-accounts-program="\$\{esc\(provider\.name\)\}" hidden/, 'the account panel no longer starts hidden')
})

/* ------------------------------------------------------------------
   4. The channel, and the check every agent channel opens with.
   ------------------------------------------------------------------ */

test('the three account calls are on the bridge, and nothing else is added to it', () => {
  const source = readFileSync(PRELOAD, 'utf8')
  const bridge = source.slice(source.indexOf("exposeInMainWorld('mcProviders'"))
  const end = bridge.indexOf('}))')
  const body = bridge.slice(0, end)
  assert.match(body, /accounts: \(\) => ipcRenderer\.invoke\('mc-accounts:list'\)/)
  assert.match(body, /accountAdd: request => ipcRenderer\.invoke\('mc-accounts:add', request\)/)
  assert.match(body, /accountRemove: request => ipcRenderer\.invoke\('mc-accounts:remove', request\)/)
  /* There is still no signIn() beside them, and its absence is the design: this
     product never handles a provider sign-in. */
  assert.ok(!/signIn|credential|token/i.test(body), 'a credential-shaped call appeared on the bridge')
})

test('every account channel opens with the sender check', () => {
  /* `add` writes the file that decides which sign-in the next agent runs on. A
     frame that could reach it could point somebody's agent at an account they
     never chose, so the same test every other agent channel applies is not a
     formality here. */
  const source = readFileSync(MAIN, 'utf8')
  for (const channel of ['mc-accounts:list', 'mc-accounts:add', 'mc-accounts:remove']) {
    const at = source.indexOf(`ipcMain.handle('${channel}'`)
    assert.ok(at > 0, `${channel} is not registered`)
    const opening = source.slice(at, at + 220)
    assert.match(opening, /assertTrustedAgentSender\(event\)/, `${channel} does not check its sender first`)
  }
})
