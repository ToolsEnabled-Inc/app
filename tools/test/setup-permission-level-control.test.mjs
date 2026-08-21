/* THE PERMISSION LEVEL BUTTONS, PRESSED.
 *
 * WHAT THIS SUITE EXISTS TO CATCH, and why the suite next door could not.
 * tools/test/setup-profile.test.mjs proves the row is RENDERED: it calls
 * markup() and reads the result, and it greps the source for `chooseTier`. Both
 * were green for the whole life of a defect that made the control worse than
 * missing. `chooseTier` referenced `isWriteEnabled`, which the file never
 * imported, so every press: wrote the new level to the machine record on disk,
 * threw a ReferenceError one line later, and never repainted -- leaving the row
 * showing the OLD level, the whole section painted `disabled`, and nothing on
 * screen saying anything had happened. The identifier shipped unbound in the
 * renderer bundle of every build that ever carried this row.
 *
 * Presence is what a source match sees, and presence is exactly what survives
 * this family of defect. So this suite PRESSES THE BUTTON: it binds the real
 * controller to a root, dispatches the click the browser would dispatch, and
 * reads the markup the controller paints afterwards. A handler that throws
 * fails here in the only way that matters -- the screen stops telling the truth
 * about the machine.
 *
 * The module reads its bridge and its storage from globals while its module
 * graph evaluates (SETUP_RESOLUTION in src/setup-state.js), so both are
 * installed BEFORE the dynamic import below. Node runs each test file in its
 * own process, so nothing here leaks into another suite.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

/* ---------- the machine this page is talking to ---------- */

const machine = { tier: 'guided', writes: [] }
const store = new Map()

globalThis.localStorage = {
  getItem: key => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => { store.set(key, String(value)) },
  removeItem: key => { store.delete(key) },
}

/* Every event this module dispatches goes through here, so a test can make the
   step AFTER the disk write fail -- which is exactly the shape of the shipped
   defect -- without editing the module. */
let dispatchThrows = false
globalThis.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => {
    if (dispatchThrows) throw new Error('this window cannot take an event')
    return true
  },
}

globalThis.mcSetup = {
  bootstrap: { ok: true, available: true, configured: true, tier: machine.tier },
  chooseTier: async (tier, consent) => {
    /* The real handler writes to disk before it answers, and that ordering is
       the whole reason the defect was dangerous rather than merely broken.
       Since X4 it also refuses the widest level without a confirmed consent
       (shell/tier-consent.cjs); the stub does the same so this suite presses
       the confirm control the way a person has to. */
    if (tier === 'unrestricted' && consent?.confirmed !== true) {
      return { ok: false, code: 'SETUP_UNRESTRICTED_UNCONFIRMED', reason: 'refused by the stub shell' }
    }
    machine.tier = tier
    machine.writes.push(tier)
    return { ok: true, tier }
  },
  tierConsent: async () => ({ ok: true, recorded: false }),
}

const { createSetupProfileSettings } = await import('../../src/setup-profile-settings.js')
const { SETUP_RESOLUTION } = await import('../../src/setup-state.js')

/* ---------- the smallest DOM the controller actually uses ---------- */

/* bind() attaches one click listener; refresh() looks for its own section and
   replaces its outerHTML. That is the entire DOM surface of this module, so
   this is the entire DOM. Painted markup is kept, because the painted markup is
   what a person reads. */
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
    painted,
    last: () => painted[painted.length - 1] || '',
    /* The click a browser dispatches when one of the level buttons is pressed:
       the button carries the two data attributes the markup gives it, and
       closest() answers with the button itself. */
    press(tier) {
      assert.ok(listener, 'the controller never bound a click listener, so no button on it can ever be pressed')
      listener({
        target: {
          closest: selector => (selector === '[data-setup-profile-set]'
            ? { dataset: { setupProfileSet: 'tier', setupProfileValue: tier } }
            : null),
        },
      })
    },
    /* The confirm control on the risk block the widest level opens (X4). The
       block itself is the subject of tools/test/setup-unrestricted-gate.test.mjs;
       here it is only the extra press a person makes on the way to the disk. */
    confirm() {
      listener({ target: { closest: selector => (selector === '[data-unrestricted-confirm]' ? { dataset: {} } : null) } })
    },
  }
}

/* The handler is async and nothing awaits it -- a click handler cannot -- so
   the assertions wait for the microtasks it schedules, the same way the screen
   does. */
const settle = async () => { for (let turn = 0; turn < 8; turn += 1) await Promise.resolve() }

const pressedIn = (markup, tier) => new RegExp(`data-setup-profile-value="${tier}"[^>]*aria-pressed="true"`).test(markup)

function mounted() {
  const controller = createSetupProfileSettings()
  const host = fakeHost()
  controller.bind(host.root)
  controller.afterRender(host.root)
  return { controller, host }
}

test('pressing a permission level records it AND says so on the row that was pressed', async () => {
  machine.writes.length = 0
  const { host } = mounted()

  host.press('unrestricted')
  await settle()
  host.confirm()
  await settle()

  assert.deepEqual(machine.writes, ['unrestricted'], 'the level was not recorded on the machine exactly once')
  assert.equal(SETUP_RESOLUTION.tier, 'unrestricted', 'the screen still believes in the level the machine no longer holds')

  const painted = host.last()
  assert.ok(painted.length > 0, 'the section never repainted, so the row still shows the level the machine no longer has')
  assert.ok(pressedIn(painted, 'unrestricted'), 'the row that was pressed does not read as chosen after the press')
  assert.ok(!pressedIn(painted, 'guided'), 'the row still reads as the old level after the machine moved to a new one')
  assert.ok(!painted.includes('disabled'), 'the section repainted with its controls still switched off, so nothing here can be pressed again')
  assert.match(painted, /Permission level changed/, 'nothing on screen says the level changed')
})

test('a press while a press is still in flight cannot write a second level', async () => {
  machine.writes.length = 0
  const { host } = mounted()

  host.press('standard')
  host.press('guided')
  await settle()

  assert.deepEqual(machine.writes, ['standard'], 'a second press during the first wrote another level to the machine')
})

test('a failure after the disk write leaves the screen honest and the section usable', async () => {
  machine.writes.length = 0
  const { host } = mounted()
  /* persist() dispatches through window on its way to the write flags, so this
     makes a step AFTER the machine has already moved throw -- the exact shape
     of the shipped ReferenceError, without pretending to be it. */
  dispatchThrows = true
  try {
    host.press('unrestricted')
    await settle()
    host.confirm()
    await settle()
  } finally {
    dispatchThrows = false
  }

  assert.deepEqual(machine.writes, ['unrestricted'], 'the machine write is the step that did happen')
  const painted = host.last()
  assert.ok(painted.length > 0, 'a failed step left the section painted disabled with no repaint to come')
  assert.ok(pressedIn(painted, 'unrestricted'), 'the row does not show the level this computer now records')
  assert.ok(!painted.includes('disabled'), 'the controls stayed switched off, so the section is dead until the page is left')
  assert.match(painted, /could not finish the change/, 'the failure is not stated anywhere a person can read it')

  /* And the section is genuinely usable afterwards: the next press works. */
  machine.writes.length = 0
  host.press('guided')
  await settle()
  assert.deepEqual(machine.writes, ['guided'], 'the section stopped accepting presses after a failure')
  assert.ok(pressedIn(host.last(), 'guided'), 'the row does not follow the machine after a recovery')
})
