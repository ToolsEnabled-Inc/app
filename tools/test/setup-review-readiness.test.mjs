/* THE LAST SCREEN OF SETUP MAY NOT CLAIM WHAT IT HAS NOT CHECKED.
 *
 * Two defects on the same block, measured on the packaged build 2026-08-16:
 *
 *   1. The review said "Codex is installed on this computer and signed in" with
 *      Codex not on PATH and nobody signed in to it. It was branching on
 *      mcAgent.availability(), which answers a DIFFERENT question -- can this
 *      installation start any agent at all -- and that answer is yes as soon as
 *      Claude is present. The sentence flipped on the wrong program.
 *
 *   2. Because of 1, the not-installed branch -- the one carrying the line a
 *      person pastes into Windows Terminal -- was unreachable for exactly the
 *      audience it is written for.
 *
 * The short-circuit in shell/agent-host.cjs is correct and is not what changed.
 * What changed is that this block reads mcProviders.presence(), which answers
 * per program, and the tests below are per-combination because the defect was a
 * combination: engine yes, codex no.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { CODEX_SETUP_COMMANDS } from '../../src/agent-availability-copy.js'
import { codexReadiness } from '../../src/setup-review-readiness.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const view = readFileSync(join(ROOT, 'src', 'views', 'setup.js'), 'utf8')

const said = block => block.lines.join(' ')
const CLAIM = /installed on this computer and signed in/

test('the engine saying "something can start" is not Codex saying it is here', () => {
  /* THE EXACT MEASURED STATE: availability ok (a Claude install satisfies it),
     Codex absent and signed out. */
  const block = codexReadiness({
    engine: { known: true, ok: true, code: 'AGENT_ENGINE_READY' },
    codex: { known: true, installed: 'no', signedIn: 'no' },
  })
  assert.doesNotMatch(said(block), CLAIM,
    'the review claims Codex is installed and signed in on a computer that has neither')
  assert.match(said(block), new RegExp(CODEX_SETUP_COMMANDS.install.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    'the install command is still unreachable for the person who needs it')
  assert.equal(block.tone, 'is-warn')
})

test('installed and signed in is said only when both are proved', () => {
  const ready = codexReadiness({
    engine: { known: true, ok: true, code: 'AGENT_ENGINE_READY' },
    codex: { known: true, installed: 'yes', signedIn: 'yes' },
  })
  assert.match(said(ready), CLAIM)
  assert.equal(ready.tone, '', 'a computer that is ready is not a warning')

  for (const codex of [
    { known: true, installed: 'yes', signedIn: 'no' },
    { known: true, installed: 'yes', signedIn: 'unknown' },
    { known: true, installed: 'unknown', signedIn: 'yes' },
    { known: false },
  ]) {
    const block = codexReadiness({ engine: { known: true, ok: true, code: 'AGENT_ENGINE_READY' }, codex })
    assert.doesNotMatch(said(block), CLAIM,
      `the review claims Codex is ready for presence ${JSON.stringify(codex)}`)
    assert.equal(block.tone, 'is-warn')
  }
})

test('signed out is said in the words that fix it', () => {
  const block = codexReadiness({
    engine: { known: true, ok: false, code: 'AGENT_CONFINEMENT_SIGNED_OUT' },
    codex: { known: true, installed: 'yes', signedIn: 'no' },
  })
  /* "Codex is installed" is a fair claim HERE and only here: this module is
     handed a real presence read and this branch requires installed === 'yes'.
     The press-refusal route's copy of this sentence had no probe behind it and
     was measured false on a driven Claude-only machine, so THAT one
     (UNAVAILABLE_TEXT.AGENT_CONFINEMENT_SIGNED_OUT) no longer asserts it. */
  assert.match(said(block), /nobody is signed in to it/)
  assert.match(said(block), new RegExp(CODEX_SETUP_COMMANDS.signIn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})

test('an engine that cannot start anything still speaks, and only for its own reason', () => {
  const dead = codexReadiness({
    engine: { known: true, ok: false, code: 'AGENT_ENGINE_UNAVAILABLE' },
    codex: { known: true, installed: 'yes', signedIn: 'yes' },
  })
  assert.match(said(dead), /An agent cannot start on this computer yet/,
    'a build with no engine reports a ready Codex and nothing about itself')

  /* But the two Codex-shaped codes belong to the provider branches, which say
     the same thing with the command that fixes it. */
  const notInstalled = codexReadiness({
    engine: { known: true, ok: false, code: 'AGENT_CODEX_CLI_NOT_INSTALLED' },
    codex: { known: true, installed: 'no', signedIn: 'no' },
  })
  assert.match(said(notInstalled), /Codex is not installed on this computer/)
  assert.match(said(notInstalled), new RegExp(CODEX_SETUP_COMMANDS.install.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})

test('an unanswered question is neither a tick nor a warning', () => {
  const waiting = codexReadiness({ engine: null, codex: null })
  assert.match(said(waiting), /Checking whether Codex is installed/)
  assert.equal(waiting.tone, '')
  assert.doesNotMatch(said(waiting), CLAIM)
})

test('the review screen asks the per-provider bridge, and does not decide from the engine', () => {
  assert.match(view, /mcProviders\?\.presence/, 'the review no longer asks which programs this computer has')
  const block = view.slice(view.indexOf('function codexReadinessMarkup'), view.indexOf('function codexReadinessMarkup') + 400)
  assert.match(block, /codexReadiness\(\{ engine: agentReadiness, codex: codexPresence \}\)/,
    'the review is deciding its own copy again, which is where the false claim lived')
  assert.ok(!/agentReadiness\.ok === true/.test(view),
    'a Codex sentence is being rendered from the provider-agnostic availability answer again')
})
