/* TWO DEFECTS A NEW USER MEETS ON THE WAY TO THEIR FIRST AGENT.
 *
 * Both were found by driving the SHIPPED installer (ToolsEnabled Setup 1.0.20)
 * on a fresh profile, not by reading source, and both are the same mistake in
 * two places: the product knows something and shows the person nothing.
 *
 * ONE -- A BLANK BUTTON IN THE START-AN-AGENT PANEL.
 *
 * src/agent-compose-panel.js builds `unavailableAction` -- the "turn the switch
 * on" way out of a stated absence -- and marks it `hidden` until a caller hands
 * over an action it can actually perform. On a healthy install no caller does,
 * so it must never be seen. MEASURED in the packaged window, on the panel that
 * opens from the "+" node:
 *
 *     hidden attribute .. true
 *     computed display .. flex          <- not none
 *     textContent ...... ""
 *     painted rect ..... 349x40 at (1049, 299)
 *     elementFromPoint . the button itself
 *
 * -- a blank, pressable, full-width control in the middle of the panel a person
 * fills in to start their first agent. The cause is the cascade, not the module:
 * `[hidden] { display: none }` is a USER-AGENT rule, and `.ctl-btn` in
 * src/styles.css sets `display: flex` as an AUTHOR rule, which beats it. The
 * button wears both classes.
 *
 * THIS IS THE THIRD TIME. src/cloud.css and home.css each carry a comment about
 * the same trap and each fixed it for their own corner
 * (`.board-cloud-box .ctl-btn[hidden]`). Fixing it per-corner is why it keeps
 * coming back, so the guard belongs beside the rule that causes it.
 *
 * TWO -- "THE APPLICATION DID NOT SAY WHY", WHEN IT DID.
 *
 * The folder question in setup calls `mcSetup.chooseWorkspace()`. That bridge
 * answers in TWO different shapes and only one of them was ever read:
 *
 *   a refused folder      { ok: false, code, reason, resolved }   <- read
 *   anything that THREW   { ok: false, error: { code, message } } <- dropped
 *
 * The second is what `withFleetProfileSender` (shell/main.cjs) returns for every
 * exception in that handler. MEASURED on a fresh profile: the reply was
 *     { ok: false, error: { code: 'MC_FLEET_PROFILE_ACTION_FAILED',
 *                           message: "Failed to get 'documents' path" } }
 * and the screen said "That folder cannot be used -- The application did not say
 * why." It had been told why, in a sentence, and threw it away.
 *
 * capability/src/lib/setup/workspace.js says the rule this breaks in its own
 * words: "every refusal here has to be explainable to the person who chose the
 * folder. 'That folder cannot be used' with no reason is the shape that makes
 * someone pick a worse one."
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { setupRefusalDetail } from '../../src/setup-profile-settings.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '..', '..', 'src')
const read = name => readFileSync(path.join(SRC, name), 'utf8')

/* ---------- one: the blank button ---------- */

test('the shared button class still sets display, which is why the guard is needed', () => {
  const css = read('styles.css')
  const at = css.indexOf('.ctl-btn {')
  assert.ok(at > -1, '.ctl-btn is gone from styles.css; this whole test is about that rule')
  const rule = css.slice(at, css.indexOf('}', at))
  assert.match(rule, /display:\s*flex/,
    '.ctl-btn no longer sets display. If that is deliberate the guard below may be redundant, but check the packaged panel before deleting it')
})

test('a ctl-btn marked hidden is not painted', () => {
  const css = read('styles.css')
  /* The guard must live in the same file as the rule that defeats [hidden];
     src/cloud.css proves that fixing it one corner at a time does not hold. */
  const guard = /\.ctl-btn\[hidden\][^{]*\{[^}]*display:\s*none/
  assert.match(css, guard,
    'styles.css has no `.ctl-btn[hidden] { display: none }`, so every hidden ctl-btn in the product paints as a blank, pressable box -- measured at 349x40 in the start-an-agent panel of the shipped 1.0.20 build')
})

test('the compose panel really does hide a ctl-btn this way, so the guard is about a real control', () => {
  const source = read('agent-compose-panel.js')
  assert.match(source, /unavailableAction\.className\s*=\s*'ctl-btn agent-compose-enable'/,
    'the compose panel no longer builds its way-out button as a ctl-btn')
  assert.match(source, /unavailableAction\.setAttribute\('hidden', 'hidden'\)/,
    'the compose panel no longer starts that button hidden; if it is shown some other way this test should be rewritten, not deleted')
})

/* ---------- two: the dropped reason ---------- */

test('a refusal that arrives in the shell error shape still says why', () => {
  const shellShape = { ok: false, error: { code: 'MC_FLEET_PROFILE_ACTION_FAILED', message: "Failed to get 'documents' path" } }
  assert.equal(setupRefusalDetail(shellShape), "Failed to get 'documents' path")
})

test('a refusal that arrives in the workspace-check shape still says why', () => {
  const checkShape = { ok: false, code: 'SETUP_WORKSPACE_DRIVE_ROOT_REFUSED', reason: 'That is the top of a whole drive. Choose a folder inside it instead.' }
  assert.equal(setupRefusalDetail(checkShape), 'That is the top of a whole drive. Choose a folder inside it instead.')
})

test('the reason is preferred over the fallback, and the fallback is only for a truly silent refusal', () => {
  assert.equal(setupRefusalDetail({ ok: false }), 'The application did not say why.')
  assert.equal(setupRefusalDetail(null), 'The application did not say why.')
  assert.equal(setupRefusalDetail({ ok: false, error: {} }), 'The application did not say why.')
})

test('a bare identifier is not a sentence, so it does not stand in for one', () => {
  /* src/refusal-copy.js refuses these for the same reason: MC_SOMETHING_FAILED
     on the glass is not an explanation, it is a code with no reader. */
  assert.equal(setupRefusalDetail({ ok: false, error: { message: 'MC_FLEET_PROFILE_ACTION_FAILED' } }), 'The application did not say why.')
  assert.equal(setupRefusalDetail({ ok: false, reason: 'SETUP_WORKSPACE_MISSING' }), 'The application did not say why.')
})

test('both screens that ask the folder question read the refusal the same way', () => {
  const walkthrough = read(path.join('views', 'setup.js'))
  const settings = read('setup-profile-settings.js')
  for (const [name, source] of [['src/views/setup.js', walkthrough], ['src/setup-profile-settings.js', settings]]) {
    assert.match(source, /setupRefusalDetail\(/,
      `${name} reads the chooseWorkspace refusal its own way again; two readers is how one of them came to miss the shell's error shape`)
    assert.ok(!/\?\.reason \|\| 'The application did not say why\.'/.test(source),
      `${name} still falls back straight off .reason, which drops the shell's { error: { message } } shape`)
  }
})
