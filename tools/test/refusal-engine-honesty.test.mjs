/* NO REFUSAL MAY SAY THIS BUILD LACKS AN ENGINE THIS BUILD IS CARRYING.
 *
 * THE DEFECT THIS EXISTS FOR, and it reached a customer twice in two days.
 * AGENT_TIER_NO_LAUNCHER's sentence read "this copy of ToolsEnabled does not
 * carry the part that runs Claude or local agents from a tree." It was true when
 * it was written. Then capability/src/lib/agent-engine/claude-cli-process.js
 * shipped in the payload, resolveStartTier() in shell/agent-host.cjs opened the
 * three Claude tiers on a real require() of it -- and the sentence went on
 * telling a person, on a build that runs Claude, that the build could not run
 * Claude. The identical claim had already been corrected in three places on
 * 2026-08-17 while a fourth (tierHelp, help text rather than a refusal) survived
 * because no refusal test looked at it.
 *
 * WHY A COPY TEST CANNOT BE THE GUARD. Every one of those sentences was checked
 * by a test, and every one of those tests REQUIRED the false wording -- a suite
 * pinning /Pick Luna, Terra or Sol/ and /sign-in is fine/ held the lie in place
 * on the exact day the build changed underneath it. A test that asserts a
 * sentence says a particular thing about what a build carries is a test that
 * fails the day the build is right. So this one asserts nothing about wording.
 * It asks the SHELL what this payload can start, and then refuses to find any
 * sentence claiming otherwise.
 *
 * THE AUTHORITY IS THE REAL GATE, NOT A LIST. createAgentHost() is constructed
 * against this checkout's actual payload engine, and startableTiers() runs the
 * SAME resolveStartTier() a press runs -- a require() of the engine module that
 * must export the start function. So "carried" here means exactly what it means
 * to a person pressing Start, and there is no second opinion to drift from it.
 *
 * WHAT IT DOES NOT CLAIM. It says nothing about whether an engine that is
 * carried actually answers, whether the CLI is installed on this computer, or
 * whether a sign-in exists. Those are refusals of their own with their own
 * sentences, and a sentence about the COMPUTER ("Codex is not installed on this
 * computer") is deliberately outside what this reads: the detector below only
 * fires on a claim about THIS COPY.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { UNAVAILABLE_TEXT } from '../../src/agent-availability-copy.js'
import { ENGINE_REASON } from '../../src/local-activity.js'
import { START_REFUSAL, tierNoLauncherSentence } from '../../src/fleet-tree-copy.js'
import { PROVIDER_SETUP } from '../../src/first-run-needs.js'
import { LAUNCH_TIERS } from '../../src/orchestration-controls.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const require_ = createRequire(import.meta.url)
const { createAgentHost } = require_(path.join(ROOT, 'shell', 'agent-host.cjs'))

/* The payload this checkout would ship. Named once: a second path here would be
   a second answer to "what does this build carry", which is the whole disease. */
const PAYLOAD_ENGINE = path.join(ROOT, 'capability', 'src', 'lib', 'agent-engine', 'codex-process.js')

/** Which tier ids this payload can really start, asked of the shell that decides it. */
function startableTierIds() {
  const host = createAgentHost({ enginePath: PAYLOAD_ENGINE, defaultCwd: ROOT })
  const answer = host.startableTiers()
  assert.equal(answer.ok, true, 'the shell could not answer what this build can start')
  return new Set(answer.tiers)
}

const STARTABLE = startableTierIds()
const CARRIED = new Set(LAUNCH_TIERS.filter(tier => STARTABLE.has(tier.id)).map(tier => tier.provider))

/* The word a person would read for each engine. `local` is not here: it is not a
   program with a name, and no build has ever carried a launcher for it -- so it
   can never be the thing a refusal is wrong about in this direction. */
const PROVIDER_WORD = Object.freeze({
  codex: /\bcodex\b/i,
  claude: /\bclaude\b/i,
  gemini: /\bgemini\b/i,
})

/* A CLAIM ABOUT THIS COPY, WHICH IS THE ONLY KIND THAT CAN BE WRONG THIS WAY.
 *
 * "Codex is not installed on this computer" is about the machine and is true or
 * false independently of what the payload carries, so it must not fire this. The
 * subject has to be the build itself, which in this product's voice is always
 * "this copy" / "this build" / "this version" / "this app". */
const BUILD_ABSENCE = /\bthis (?:copy|build|version|app)\b[^.]*?(?:carries no|does not carry|has no|was built without|did not ship|will not start|cannot start|is not set up|does not have|no launcher)/i

/** Every sentence a refused person can be shown, with where it came from. */
function refusalSentences() {
  const rows = []
  const push = (where, value) => {
    if (typeof value === 'string' && value.length > 0) rows.push({ where, sentence: value })
  }
  for (const [code, text] of Object.entries(UNAVAILABLE_TEXT)) push(`UNAVAILABLE_TEXT.${code}`, text)
  for (const [code, text] of Object.entries(ENGINE_REASON)) push(`ENGINE_REASON.${code}`, text)
  for (const [key, text] of Object.entries(START_REFUSAL)) push(`START_REFUSAL.${key}`, text)
  /* THE FOURTH SURFACE, and the reason it is in this list rather than in a
     comment. The setup guide is not a refusal -- which is exactly why the last
     sweep of this claim missed the copy living there. A person reads it in the
     same sitting, about the same question, and it makes the same kind of
     statement about what the build contains. */
  for (const provider of PROVIDER_SETUP) push(`PROVIDER_SETUP.${provider.id}.doesHere`, provider.doesHere)
  return rows
}

function namesCarriedEngine(sentence) {
  if (!BUILD_ABSENCE.test(sentence)) return null
  for (const provider of CARRIED) {
    const word = PROVIDER_WORD[provider]
    if (word && word.test(sentence)) return provider
  }
  return null
}

test('the shell answers what this payload can start, and it is not nothing', () => {
  /* A gate that passes because it found nothing is worse than no gate. If the
     host answers an empty set, every assertion below is vacuously true -- so
     this runs first and says so. */
  assert.ok(STARTABLE.size > 0, 'the shell says this payload can start no tier at all; nothing below would be a measurement')
  assert.ok(CARRIED.size > 0, 'no startable tier maps to a provider; the tier table and the shell have drifted')
})

test('the detector fires on the sentence that actually shipped', () => {
  /* THE POSITIVE CONTROL, and it is not optional here: every assertion in this
     file is a NEGATIVE result, and a negative result from a detector nobody
     proved works is not evidence. One synthetic sentence per carried engine,
     each in the shape the real defect took. */
  for (const provider of CARRIED) {
    const fabricated = `this copy of ToolsEnabled does not carry the part that runs ${provider} agents from a tree.`
    assert.equal(namesCarriedEngine(fabricated), provider,
      `the detector missed a refusal claiming this build has no ${provider} launcher, on a build that starts ${provider}`)
  }
  /* And it must NOT fire on a true sentence about the COMPUTER, or this gate
     would force the product to stop saying the one thing a person can act on. */
  assert.equal(namesCarriedEngine('Codex is not installed on this computer, and Codex is the program that actually runs an agent.'), null)
})

test('no refusal claims this build lacks an engine this build carries', () => {
  const offences = []
  for (const { where, sentence } of refusalSentences()) {
    const provider = namesCarriedEngine(sentence)
    if (provider) offences.push(`${where} says this copy has no ${provider} launcher, and this payload starts ${provider}: "${sentence}"`)
  }
  assert.deepEqual(offences, [], offences.join('\n'))
})

test('the tier-specific refusal names a provider this build genuinely cannot start', () => {
  /* The other half of the same rule. tierNoLauncherSentence() DOES name a
     provider -- that is its whole job -- and it is safe only because the shell
     never raises AGENT_TIER_NO_LAUNCHER for a tier it can start. This asserts
     that pairing directly rather than trusting it: every tier the shell refuses
     gets a sentence, and no such sentence names an engine this build carries. */
  let refusedTiers = 0
  for (const tier of LAUNCH_TIERS) {
    if (STARTABLE.has(tier.id)) continue
    refusedTiers += 1
    const sentence = tierNoLauncherSentence(tier.id)
    assert.ok(sentence, `${tier.id} is refused by this build and the tree has no sentence for it`)
    for (const provider of CARRIED) {
      const word = PROVIDER_WORD[provider]
      assert.ok(!word || !word.test(sentence),
        `the refusal for ${tier.id} names ${provider}, which this build starts: "${sentence}"`)
    }
  }
  assert.ok(refusedTiers > 0,
    'this build starts every tier, so nothing exercised the tier-specific refusal; if that is genuinely true this test needs a fixture payload rather than a pass')
})
