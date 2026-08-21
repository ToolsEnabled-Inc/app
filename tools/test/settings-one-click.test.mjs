/* THE ONE-PRESS PASS, HELD TO ITS OWN SAFETY ARGUMENT.
 *
 * The ask (first outside user, via the owner): "Can we make anything more one
 * click". The boundary (legal architecture): the unrestricted risk gate and
 * the consent surfaces are never one-clicked past. So every press this lane
 * added is tested for BOTH halves: it does its whole job in one press, and it
 * cannot reach anything a consent surface guards.
 *
 *   1  "Use recommended answers" on Settings -> Setup applies the recommended
 *      answer set in one press and NEVER writes a permission level. The level
 *      is the one row in that section behind a consent gate; the press test
 *      asserts the machine saw zero level writes.
 *
 *   2  "Skip the rest for now" on the walkthrough's FIRST screen records the
 *      lit level with whatever consent belongs to it, and is not rendered at
 *      all while the risk words are open. Source-pinned, because the view
 *      imports stylesheets and cannot load under node; the packaged drivers
 *      prove the behaviour on glass.
 *
 *   3  The Write section's bulk control turns things OFF only. A one-press
 *      bulk GRANT of the acting switches is refused on purpose -- the
 *      walkthrough's one-answer grant, with its consequence sentences, is the
 *      sanctioned bulk path. The source pin keeps the refusal refused.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/* ---------- the machine and window the controller talks to ---------- */

const machine = { tier: 'guided', writes: [] }
const store = new Map()

globalThis.localStorage = {
  getItem: key => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => { store.set(key, String(value)) },
  removeItem: key => { store.delete(key) },
}

globalThis.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
}

globalThis.mcSetup = {
  bootstrap: { ok: true, available: true, configured: true, tier: machine.tier },
  chooseTier: async tier => {
    machine.writes.push(tier)
    return { ok: true, tier }
  },
  tierConsent: async () => ({ ok: true, recorded: false }),
}

const { createSetupProfileSettings } = await import('../../src/setup-profile-settings.js')
const { RECOMMENDED_ANSWERS } = await import('../../src/setup-profile.js')

function fakeHost() {
  const painted = []
  let listener = null
  const section = {
    querySelector: () => null,
    set outerHTML(value) { painted.push(String(value)) },
  }
  const root = {
    addEventListener: (type, fn) => { if (type === 'click') listener = fn },
    removeEventListener: () => {},
    contains: () => true,
    querySelector: selector => (selector === '[data-setup-profile-system]' ? section : null),
  }
  return {
    root,
    last: () => painted[painted.length - 1] || '',
    pressAction(action) {
      assert.ok(listener, 'the controller never bound a click listener')
      listener({
        target: {
          closest: selector => (selector === '[data-setup-profile-action]'
            ? { dataset: { setupProfileAction: action } }
            : null),
        },
      })
    },
  }
}

const settle = async () => { for (let turn = 0; turn < 8; turn += 1) await Promise.resolve() }
const pressedIn = (markup, value) => new RegExp(`data-setup-profile-value="${value}"[^>]*aria-pressed="true"`).test(markup)

test('the recommended-answers press is offered, applies the set, and says so', async () => {
  machine.writes.length = 0
  const controller = createSetupProfileSettings()
  const host = fakeHost()
  controller.bind(host.root)
  controller.afterRender(host.root)

  const before = controller.markup()
  assert.ok(before.includes('data-setup-profile-action="recommended"'),
    'the Setup section offers no one-press recommended control')

  host.pressAction('recommended')
  await settle()

  const painted = host.last()
  assert.ok(painted.length > 0, 'the press painted nothing')
  assert.ok(pressedIn(painted, RECOMMENDED_ANSWERS.autonomy),
    `the autonomy row does not read as "${RECOMMENDED_ANSWERS.autonomy}" after the press`)
  assert.ok(pressedIn(painted, RECOMMENDED_ANSWERS.screens),
    `the screens row does not read as "${RECOMMENDED_ANSWERS.screens}" after the press`)
  assert.match(painted, /Recommended answers applied/, 'nothing on screen says what the press did')
})

test('the recommended-answers press never writes a permission level', async () => {
  machine.writes.length = 0
  const controller = createSetupProfileSettings()
  const host = fakeHost()
  controller.bind(host.root)
  controller.afterRender(host.root)

  host.pressAction('recommended')
  await settle()

  assert.deepEqual(machine.writes, [],
    'the one-press control reached the permission level, which only the consent-gated row may touch')
})

test('search finds the one-press control', () => {
  const controller = createSetupProfileSettings()
  assert.equal(controller.matches('recommended'), true)
})

/* ---------- source pins for the two views node cannot import ---------- */

test('the walkthrough offers skip on its first screen, outside the risk words', () => {
  const source = readFileSync(path.join(ROOT, 'src', 'views', 'setup.js'), 'utf8')
  assert.ok(source.includes('data-setup-skip-first'), 'the first screen has no skip')
  /* Not rendered while the risk question is open: the consent surface keeps
     exactly its own two answers. */
  assert.match(source, /riskGate\.pending \|\| refusal \? '' : `<button[^`]*data-setup-skip-first/,
    'the first-screen skip renders while the risk words are open')
  /* It records the LIT level with the consent that belongs to it -- never a
     level the words were not answered for. */
  assert.match(source, /skipFromFirstQuestion[\s\S]*?chooseTier\(chosen, consent\)/,
    'the first-screen skip does not record the lit level with its own consent')
  assert.match(source, /async function skipFromFirstQuestion\(\) \{\s*\n\s*if \(busy \|\| refusal \|\| riskGate\.pending\) return/,
    'the first-screen skip does not refuse to run while the risk words are open')
})

test('the choice cards are pressable through the same handler as the seg', () => {
  const source = readFileSync(path.join(ROOT, 'src', 'views', 'setup.js'), 'utf8')
  assert.match(source, /setup-choice is-pressable" data-setup-choice="\$\{esc\(choice\.tier\)\}" data-setup-tier=/,
    'the level cards do not press')
  assert.match(source, /setup-choice is-pressable" data-setup-set="autonomy"/,
    'the autonomy cards do not press')
})

test('the review carries the quick standing-requests brief, scoped as the skills define', () => {
  /* Owner, 2026-08-19: a QUICK brief about /Request in setup. One card on the
     review, not a step. Each scope sentence was verified against the request
     skills' own SKILL.md files rather than remembered; these pins hold the
     four scope truths and the single concrete example. */
  const source = readFileSync(path.join(ROOT, 'src', 'views', 'setup.js'), 'utf8')
  assert.ok(source.includes('data-setup-request-brief'), 'the brief card is gone from setup')
  assert.match(source, /\$\{requestBriefMarkup\(\)\}/, 'the card is not rendered on the review')
  assert.ok(source.includes('/Request — for everyone'))
  assert.ok(source.includes('every agent, everywhere, until you edit or delete it'),
    'the global scope stopped saying it stands until the owner edits or deletes it')
  assert.ok(source.includes('/RequestSession — for one working session'))
  assert.ok(source.includes('every agent it starts. Other sessions never see it'),
    'the session scope stopped covering the session and what it spawns, and only that')
  assert.ok(source.includes('/RequestTree — for one agent and its helpers'))
  assert.ok(source.includes('never reaches its neighbours or its manager'),
    'the tree scope stopped refusing sideways and upward reach')
  assert.ok(source.includes('/RequestThread — for one conversation'))
  assert.ok(source.includes('cannot forget it'),
    'the thread scope stopped saying the rule survives a long conversation')
  assert.ok(source.includes('/Request Always ask before spending money'),
    'the one concrete example is gone')
})

test('the review card teaches the two spoken conventions and links the guide', () => {
  /* Owner, 2026-08-19, verbatim: "with the /request info we should also hand
     them a line like 'ask the agent to use toolsenabled!'" and "i think both
     user and agent probably need to know about /request always." The card
     stays QUICK — these pins hold the two lines and the door to the longer
     story, not a sixth paragraph. */
  const source = readFileSync(path.join(ROOT, 'src', 'views', 'setup.js'), 'utf8')
  const card = source.slice(source.indexOf('function requestBriefMarkup'), source.indexOf('function reviewMarkup'))
  assert.ok(card.includes('use ToolsEnabled and'),
    'the owner\'s tip is gone: the card must teach saying "Ok, use ToolsEnabled and …" to point an agent at this computer\'s tools')
  assert.ok(card.includes('right in the chat box'),
    'the card stopped saying /Request works right in the chat box, where the person already talks to the agent')
  assert.ok(card.includes('#/guide'),
    'the card no longer links to the guide\'s Standing requests section')

  const guide = readFileSync(path.join(ROOT, 'src', 'views', 'guide.js'), 'utf8')
  assert.ok(guide.includes('Standing requests'),
    'the guide has no Standing requests section for the card to link to')
  for (const command of ['/Request', '/RequestSession', '/RequestTree', '/RequestThread']) {
    assert.ok(guide.includes(command), `the guide section never names ${command}`)
  }
  assert.ok(guide.includes('use ToolsEnabled and'),
    'the guide never teaches the spoken "use ToolsEnabled" convention')
})

test('the settings page bulk control for the acting switches is off-only', () => {
  const source = readFileSync(path.join(ROOT, 'src', 'views', 'settings.js'), 'utf8')
  assert.ok(source.includes('data-bulk-write-off'), 'the one-press off control is gone')
  assert.ok(!source.includes('data-bulk-write-on') && !/data-bulk-write="on"/.test(source),
    'a one-press bulk GRANT of the acting switches exists; that press is refused by design')
  /* The screen-source pair (`data-bulk-live`) this used to require is GONE ON
     PURPOSE, and its absence is now the pin: the seven per-view switches it
     bulk-set collapsed into the one example toggle, which reaches every
     screen by construction -- a bulk press over one switch would be a second
     button doing what the switch already does. */
  assert.ok(!source.includes('data-bulk-live'),
    'a bulk pair exists over the one example toggle; one switch needs no second button')
})
