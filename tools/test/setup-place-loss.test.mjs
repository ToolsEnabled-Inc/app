/* THE WALKTHROUGH MUST NOT LOSE A PERSON'S PLACE MID-WALK.
 *
 * THE DEFECT, MEASURED ON THE PACKAGED BUILD (fresh profile, machine under
 * load, 2026-08-19, two independent traces in the setup-placeloss lane
 * report): the review drew and was then replaced by the permission question,
 * with no gesture, no hashchange and no reload. Finish never existed.
 *
 * THE TRIGGER, from the trace rather than from a suspect list. Boot render
 * redirects '' -> '#/setup' and returns; the hashchange it fires is a QUEUED
 * task. The checkout-surface probe settled inside that gap (94ms and 96ms in
 * the two traces), and its listener re-entered render() with the hash already
 * naming the walkthrough: setup copy #1 mounted from the probe's event, the
 * queued hashchange then mounted copy #2, and the router's 420ms retirement
 * timer tore copy #1 down. The person's whole walk had happened on copy #1;
 * the glass fell back to copy #2, still sitting on question 1 -- because
 * copy #2 had computed its resume from state that predated every answer.
 *
 * TWO GUARDS, BOTH PINNED HERE BECAUSE NEITHER FILE CAN BE IMPORTED WITHOUT A
 * DOM (the same reason first-run-tier-screen.test.mjs reads source):
 *
 *   1. src/main.js: the checkout settle event must not re-enter render()
 *      while the walkthrough holds the route. It repaints ring surfaces, the
 *      walkthrough shows none, and the re-render is a re-mount.
 *   2. src/views/setup.js: a re-mount inside one page adopts the walk in
 *      progress (`liveWalk`) instead of recomputing from disk state and the
 *      recorded tier -- both of which lag the person mid-walk. Every durable
 *      in-progress write records the live walk in the same breath; finishing
 *      or skipping clears it, so the NEXT launch still resumes from disk.
 *
 * These are deliberately the same kind of assertion the first-run gate uses:
 * a source match cannot prove behaviour, but it can refuse the two exact
 * regressions -- the bare `() => render()` listener and a mount that ignores
 * the live walk -- and the packaged drivers (tools/stranger-onboarding-qa.mjs,
 * tools/first-run-recovery-qa.mjs) prove the behaviour on the real window. */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = relative => readFileSync(path.join(REPO_ROOT, relative), 'utf8')

const ROUTER = read('src/main.js')
const VIEW = read('src/views/setup.js')

test('the checkout settle event does not re-enter render() over the walkthrough', () => {
  const listener = ROUTER.match(/window\.addEventListener\(CHECKOUT_SURFACE_EVENT,[\s\S]*?\n\}\)/)
  assert.ok(listener, 'src/main.js no longer wires the checkout-surface listener at all')
  assert.match(
    listener[0],
    /if \(resolve\(parse\(\)\)\.name === 'setup'\) return/,
    'the checkout-surface listener re-enters render() while the walkthrough holds the route; '
    + 'that re-render mounts a second copy of setup and retires the one the person is walking (measured 2026-08-19)',
  )
})

test('a re-mount adopts the walk in progress instead of recomputing backwards', () => {
  assert.match(VIEW, /let liveWalk = null/, 'src/views/setup.js dropped the live-walk record')
  assert.match(
    VIEW,
    /resumeStep\(stored, \{ tierRecorded: state\.configured, steps: STEPS \}\)\s*\n\s*if \(liveWalk && STEPS\.includes\(liveWalk\.step\)\) \{\s*\n\s*step = liveWalk\.step\s*\n\s*answers = liveWalk\.answers/,
    'the mount no longer adopts the live walk over the recomputed resume; a late tier record or lagging stored profile can yank the person backwards again',
  )
  assert.match(VIEW, /function holdWalk\(\) \{\s*\n\s*liveWalk = \{ step, answers \}/, 'holdWalk no longer records the walk')
  const inProgressWrites = VIEW.match(/writeStoredProfile\(\{ status: 'in-progress', step, answers \}\)\s*\n\s*holdWalk\(\)/g) || []
  assert.equal(
    inProgressWrites.length,
    4,
    'every in-progress durable write must record the live walk in the same breath (goTo, pickWorkspace, removeRoot, setAnswer); '
    + `found ${inProgressWrites.length} of 4`,
  )
  const finishes = VIEW.match(/writeStoredProfile\(\{ status: '(?:complete|skipped)', step: 'review', answers \}\)\s*\n\s*liveWalk = null/g) || []
  assert.equal(finishes.length, 2, 'finish and skip must both close the live walk, or the next visit resumes a walk that ended')
})
