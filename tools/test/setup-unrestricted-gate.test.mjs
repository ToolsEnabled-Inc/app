/* THE WIDEST PERMISSION LEVEL, PRESSED, ON THE SETTINGS ROW -- and what has to
 * happen between the press and the machine moving.
 *
 * The owner's X4 ruling (2026-08-15) on the unsandboxed configuration: default
 * off, the risk stated in the Terms' own words at the moment of choosing, the
 * confirmed choice recorded in the audit ledger, re-warned on re-enable.
 * tools/test/setup-permission-level-control.test.mjs proves the row PRESSES;
 * this suite proves that pressing the widest level does not write anything
 * until the words have been on the glass and the person has said yes -- and
 * that saying no leaves the machine exactly where it was.
 *
 * Same rig as the sibling suite, and for the same reason: the module reads its
 * bridge and storage from globals while its module graph evaluates, so both are
 * installed before the import. The bridge here records what it was HANDED, not
 * only which level, because the whole point of the second argument is that the
 * words travel with the choice.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = relative => readFileSync(path.join(REPO_ROOT, relative), 'utf8')

/* ---------- the machine this page is talking to ---------- */

const machine = { tier: 'guided', writes: [], consentReads: 0 }
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
  chooseTier: async (tier, consent) => {
    /* The real shell refuses the widest level without a confirmed consent
       (shell/tier-consent.cjs). Mirrored here so a screen that forgot to send
       it fails the way the product would, not the way a lenient stub would. */
    if (tier === 'unrestricted' && consent?.confirmed !== true) {
      return { ok: false, code: 'SETUP_UNRESTRICTED_UNCONFIRMED', reason: 'refused by the stub shell' }
    }
    machine.tier = tier
    machine.writes.push({ tier, consent: consent ?? null })
    return { ok: true, tier, recorded: { ok: true, sequence: machine.writes.length } }
  },
  tierConsent: async () => {
    machine.consentReads += 1
    return { ok: true, recorded: false }
  },
}

const { createSetupProfileSettings } = await import('../../src/setup-profile-settings.js')
const { SETUP_RESOLUTION } = await import('../../src/setup-state.js')
const {
  UNRESTRICTED_RISK_STATEMENTS,
  UNRESTRICTED_RISK_TEXT,
  UNRESTRICTED_RISK_QUESTION,
} = await import('../../src/unrestricted-consent.js')

/* ---------- the smallest DOM the controller actually uses ---------- */

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
  const click = target => {
    assert.ok(listener, 'the controller never bound a click listener, so no button on it can ever be pressed')
    listener({ target })
  }
  return {
    root,
    painted,
    last: () => painted[painted.length - 1] || '',
    press(tier) {
      click({
        closest: selector => (selector === '[data-setup-profile-set]'
          ? { dataset: { setupProfileSet: 'tier', setupProfileValue: tier } }
          : null),
      })
    },
    /* The two buttons the risk block carries. closest() answers the block's
       own attribute and nothing else, the way a click on that button would. */
    confirm() {
      click({ closest: selector => (selector === '[data-unrestricted-confirm]' ? { dataset: {} } : null) })
    },
    decline() {
      click({ closest: selector => (selector === '[data-unrestricted-decline]' ? { dataset: {} } : null) })
    },
  }
}

const settle = async () => { for (let turn = 0; turn < 8; turn += 1) await Promise.resolve() }
const pressedIn = (markup, tier) => new RegExp(`data-setup-profile-value="${tier}"[^>]*aria-pressed="true"`).test(markup)
const showsTheWords = markup => markup.includes('data-unrestricted-risk')
  && UNRESTRICTED_RISK_STATEMENTS.every(statement => markup.includes(escapeHtml(statement)))
  && markup.includes(escapeHtml(UNRESTRICTED_RISK_QUESTION))
const escapeHtml = value => String(value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function mounted() {
  const controller = createSetupProfileSettings()
  const host = fakeHost()
  controller.bind(host.root)
  controller.afterRender(host.root)
  return { controller, host }
}

function reset(tier = 'guided') {
  machine.tier = tier
  machine.writes.length = 0
  SETUP_RESOLUTION.tier = tier
  SETUP_RESOLUTION.configured = true
}

test('pressing the widest level writes NOTHING and puts the risk, in the Terms’ words, on the row', async () => {
  reset('guided')
  const { host } = mounted()

  host.press('unrestricted')
  await settle()

  assert.deepEqual(machine.writes, [], 'the machine moved on the press alone -- before any words were shown or confirmed')
  const painted = host.last()
  assert.ok(painted.length > 0, 'nothing repainted, so no words could be on the glass')
  assert.ok(showsTheWords(painted), 'the risk block with the Terms’ sentences is not on the row after the press')
  assert.ok(pressedIn(painted, 'guided'), 'the row stopped showing the level this computer actually holds')
  assert.ok(!pressedIn(painted, 'unrestricted'), 'the row already reads as the widest level before anyone confirmed it')
  assert.match(painted, /data-unrestricted-confirm/, 'there is no confirm control')
  assert.match(painted, /data-unrestricted-decline/, 'there is no decline control')
})

test('confirming writes the level ONCE, with the words attached, and says it was recorded', async () => {
  reset('guided')
  const { host } = mounted()

  host.press('unrestricted')
  await settle()
  host.confirm()
  await settle()

  assert.equal(machine.writes.length, 1, `expected exactly one write, saw ${machine.writes.length}`)
  assert.equal(machine.writes[0].tier, 'unrestricted')
  const consent = machine.writes[0].consent
  assert.ok(consent, 'the choice reached the shell without any consent object')
  assert.equal(consent.confirmed, true)
  assert.equal(consent.riskShown, true)
  assert.equal(consent.riskText, UNRESTRICTED_RISK_TEXT, 'the words recorded are not the words that were shown')
  assert.equal(consent.via, 'settings')
  assert.equal(SETUP_RESOLUTION.tier, 'unrestricted', 'the screen does not believe in the level the machine now holds')

  const painted = host.last()
  assert.ok(pressedIn(painted, 'unrestricted'), 'the row does not read as the confirmed level')
  assert.ok(!showsTheWords(painted), 'the risk block is still open after the choice was confirmed')
  assert.match(painted, /Permission level changed/, 'nothing on screen says the level changed')
  assert.match(painted, /recorded/i, 'nothing on screen says whether the choice was recorded')
})

test('declining writes nothing, closes the block, and the row still shows the level it had', async () => {
  reset('standard')
  const { host } = mounted()

  host.press('unrestricted')
  await settle()
  assert.ok(showsTheWords(host.last()), 'precondition: the block opened')
  host.decline()
  await settle()

  assert.deepEqual(machine.writes, [], 'declining still wrote a level to the machine')
  assert.equal(SETUP_RESOLUTION.tier, 'standard', 'declining moved the level the screen believes in')
  const painted = host.last()
  assert.ok(!showsTheWords(painted), 'the block is still open after the person declined')
  assert.ok(pressedIn(painted, 'standard'), 'the row no longer shows the level this computer kept')
  assert.ok(!pressedIn(painted, 'unrestricted'))
  assert.match(painted, /not (turned on|changed)/i, 'nothing on screen says the level was kept')
})

test('going down and back up asks again: a confirmation a moment ago does not silence the words', async () => {
  reset('guided')
  const { host } = mounted()

  host.press('unrestricted'); await settle()
  host.confirm(); await settle()
  assert.equal(machine.tier, 'unrestricted', 'precondition: the first confirmation took')

  host.press('guided'); await settle()
  assert.equal(machine.tier, 'guided', 'moving down did not write the narrower level')
  assert.ok(!showsTheWords(host.last()), 'moving DOWN showed the risk block, which is for the widest level only')

  host.press('unrestricted'); await settle()
  assert.equal(machine.tier, 'guided', 'the second press wrote the widest level without asking again')
  assert.ok(showsTheWords(host.last()), 'the words were not shown the second time')
  assert.deepEqual(machine.writes.map(write => write.tier), ['unrestricted', 'guided'],
    'the writes are not exactly the two confirmed-or-narrower moves')

  host.confirm(); await settle()
  assert.deepEqual(machine.writes.map(write => write.tier), ['unrestricted', 'guided', 'unrestricted'])
  assert.equal(machine.writes[2].consent.confirmed, true)
})

test('a narrower level never opens the block and writes as before', async () => {
  reset('unrestricted')
  const { host } = mounted()
  host.press('standard'); await settle()
  assert.deepEqual(machine.writes.map(write => write.tier), ['standard'])
  assert.ok(!showsTheWords(host.last()))
  assert.equal(machine.writes[0].consent, null, 'a narrower level travelled with a consent object it does not need')
})

test('the shell’s refusal of an unconfirmed widest level is shown, not swallowed', async () => {
  /* Belt and braces: the screen never sends an unconfirmed choice, but if the
     shell refuses for any reason the screen has to say so rather than repaint
     the new level. Simulated by making the stub refuse the confirmed one too. */
  reset('guided')
  const original = globalThis.mcSetup.chooseTier
  globalThis.mcSetup.chooseTier = async () => ({ ok: false, code: 'SETUP_AUDIT_UNAVAILABLE', reason: 'The choice was not recorded in the signed ledger, so this computer was left as it was.' })
  try {
    const { host } = mounted()
    host.press('unrestricted'); await settle()
    host.confirm(); await settle()
    assert.equal(SETUP_RESOLUTION.tier, 'guided')
    assert.match(host.last(), /was not changed/, 'the refusal is not stated on the row')
    assert.match(host.last(), /not recorded in the signed ledger/, 'the shell’s reason did not reach the glass')
  } finally {
    globalThis.mcSetup.chooseTier = original
  }
})

/* ---------- the walkthrough, which cannot be executed here ----------
 *
 * src/views/setup.js imports the DOM-bound component module and so cannot be
 * called from node:test; tools/test/first-run-tier-screen.test.mjs explains the
 * same limit. What CAN be held here is the wiring: that the walkthrough routes
 * the widest level through the same gate, paints the same block, and hands the
 * shell the same consent. The behaviour itself is driven on the packaged build
 * by tools/unrestricted-consent-qa.mjs. */
test('the walkthrough imports the one gate and paints the one block', () => {
  const view = read('src/views/setup.js')
  assert.match(view, /from '\.\.\/unrestricted-consent\.js'/, 'src/views/setup.js does not import the consent module')
  assert.match(view, /createRiskGate\(/, 'the walkthrough does not create the risk gate')
  assert.match(view, /unrestrictedRiskMarkup\(/, 'the walkthrough does not paint the risk block')
  assert.match(view, /data-unrestricted-confirm/, 'the walkthrough never listens for the confirm control')
  assert.match(view, /data-unrestricted-decline/, 'the walkthrough never listens for the decline control')
  /* Continue must hand the shell the consent, and only a confirmed one. */
  assert.match(view, /mcSetup\.chooseTier\(chosen,\s*consent\)/, 'Continue does not pass the consent to the shell')
})

test('the walkthrough preselects the narrowest level and never the widest', () => {
  const view = read('src/views/setup.js')
  assert.match(view, /TIER_IDS\.includes\(state\.tier\) \? state\.tier : DEFAULT_TIER/,
    'the walkthrough no longer falls back to DEFAULT_TIER for an unconfigured machine')
})
