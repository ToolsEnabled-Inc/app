/* "NOTHING HERE WILL START AN AGENT" HAS TO BE TRUE OF THE PAGE THAT STARTS THEM.
 *
 * Answer "Nothing yet — let me look around first" in setup and the product says,
 * in its own words on that screen: "With this answer, nothing here will start an
 * agent." It makes that true by leaving `mc.write.agent-session` disabled, and
 * src/agent-session.js asks -- it renders a switched-off surface instead of a
 * Start control.
 *
 * src/views/computers.js never asked. Measured on the packaged build
 * 2026-08-16 on a fresh profile that gave exactly that answer: the dashed "+"
 * opened its panel, "Start this agent" went all the way to the engine, and what
 * came back was an ENGINE refusal about Codex. The promise was kept by the page
 * a fresh install cannot even route to, and broken by the page it opens on.
 *
 * The flag now gates every path on that page that reaches bridge.start: the
 * compose panel, the submit behind it, Resume/restart, "start over", and the
 * dead-session recovery. Each of those is a real child process on the person's
 * computer, and each one of them was reachable.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { AUTONOMY_CHOICES, PROFILE_SCHEMA_VERSION, PROFILE_STORAGE_KEY, START_CONTROL_FLAG, startControlOffBecause } from '../../src/setup-profile.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const view = readFileSync(join(ROOT, 'src', 'views', 'computers.js'), 'utf8')
const session = readFileSync(join(ROOT, 'src', 'agent-session.js'), 'utf8')

const storedProfile = autonomy => ({
  localStorage: {
    getItem: key => (key === PROFILE_STORAGE_KEY
      ? JSON.stringify({ schemaVersion: PROFILE_SCHEMA_VERSION, status: 'complete', step: 'review', answers: { autonomy, screens: 'live' } })
      : null),
    setItem: () => {},
  },
})

test('the flag that decides whether an agent can start has exactly one name', () => {
  assert.equal(START_CONTROL_FLAG, 'agent-session')
})

test('the reason names the answer the person actually gave', () => {
  const observe = AUTONOMY_CHOICES.find(choice => choice.value === 'observe')
  const because = startControlOffBecause(storedProfile('observe'))
  assert.ok(because.includes(observe.label),
    'the explanation does not quote the answer that switched starting off, so it reads as the product deciding by itself')

  /* A machine with no recorded profile turned it off in Settings, and must not
     be told setup did it. */
  const noProfile = startControlOffBecause({ localStorage: { getItem: () => null, setItem: () => {} } })
  assert.doesNotMatch(noProfile, /Setup recorded/,
    'somebody who turned this off themselves is told setup did it')
  assert.ok(noProfile.length > 0)

  /* Storage that throws is not a reason to throw. */
  assert.ok(startControlOffBecause({ localStorage: { getItem() { throw new Error('quota') } } }).length > 0)
})

test('both screens that explain this switch say the same first sentence', () => {
  assert.match(session, /startControlOffBecause\(\)/,
    'the agent page grew its own copy of the explanation again')
  assert.match(view, /startControlOffBecause\(\)/,
    'the fleet page grew its own copy of the explanation again')
})

test('every path on the fleet page that reaches bridge.start asks the flag first', () => {
  /* One assertion per START, because each was independently reachable. */
  const gate = /isWriteEnabled\(START_CONTROL_FLAG\)/

  const panel = view.slice(view.indexOf('function composeUnavailableReason'), view.indexOf('function composeUnavailableReason') + 1600)
  assert.match(panel, gate, 'the compose panel opens with a live Start on a computer that promised none')

  const submit = view.slice(view.indexOf('async function submitCompose'), view.indexOf('async function submitCompose') + 1200)
  assert.match(submit, gate, 'the submit still reaches the engine; the panel alone is paint, not a gate')
  assert.ok(submit.indexOf('isWriteEnabled(START_CONTROL_FLAG)') < submit.indexOf('store.addNode'),
    'the refusal comes after a node has been created, so a switched-off computer collects half-started agents')

  const resume = view.slice(view.indexOf('async function resumeNodeSession'), view.indexOf('async function resumeNodeSession') + 1400)
  assert.match(resume, gate, 'Resume starts a real agent on a computer where starting is switched off')

  const clear = view.slice(view.indexOf("if (id === 'clear')"), view.indexOf("if (id === 'clear')") + 700)
  assert.match(clear, gate, '"Start over" starts a real agent on a computer where starting is switched off')

  const recovery = view.slice(view.indexOf('async function recoverDeadSessionSend'), view.indexOf('async function recoverDeadSessionSend') + 900)
  assert.match(recovery, gate, 'a dead-session send quietly starts a fresh agent where starting is switched off')
})

test('the refusal tells a person where the switch is', () => {
  const reason = view.slice(view.indexOf('function startControlOffReason'), view.indexOf('function startControlOffReason') + 700)
  assert.match(reason, /Settings/, 'the refusal names no place to change it, which is a dead end')
  assert.match(reason, /starts nothing by itself/,
    'the switch is offered with only its benefit named, or with no idea what it does')
})
