/* THE GUARD THAT KEEPS THE PACKAGED-WINDOW DRIVERS WIRED.
 *
 * WHAT THIS IS FOR. Thirteen harnesses that drive the real packaged window sat
 * in tools/ invoked by NO automated path -- not `npm test`, not `dist`, not
 * `release:cut`. They are the instruments that saw the checkout privacy leak,
 * the unreachable agent page, the Recommended dead end, the dead steering
 * controls and the demonstration page that spawned a real session. Every one of
 * those was found by a person running one by hand.
 *
 * tools/packaged-qa-suite.mjs is now the automated path. This suite is what
 * stops it rotting, and it is deliberately CHEAP: it launches no window and
 * starts no Electron process, so it can live in `npm test` alongside everything
 * else. The expensive part is the suite itself, which belongs on the release
 * gate.
 *
 * WHAT IT ASSERTS, and why each one is a way this has already gone wrong here:
 *
 *   1. Discovery finds something. A glob that matches nothing exits 0 and
 *      reports success -- the exact defect tools/check-suites-discovered.mjs
 *      exists for on the unit suites. Zero drivers is an ERROR.
 *   2. Every driver on disk is in the plan. Not a list -- the plan is derived
 *      from the same glob, so this asserts the derivation, and it catches a
 *      driver that was renamed out of the convention.
 *   3. Settings never name a file that is gone (stale entry) and never decide
 *      membership (an unregistered driver still gets a runnable plan).
 *   4. Every driver's source spawns the packaged app with windowsHide, and none
 *      of them re-introduces `windowsHide: false`.
 *   5. The runner puts the exact string '1' in MC_SMOKE_HEADLESS -- the only
 *      value shell/window-options.cjs hides the window for. ABSENCE CASE: an
 *      unset or empty value SHOWS the window, so inheriting it is not enough.
 *   6. The runner never treats a timeout as a pass.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { discoverDrivers, planFor, staleSettings, verdictFor } from '../packaged-qa-suite.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const TOOLS = path.join(REPO_ROOT, 'tools')
const RUNNER = path.join(TOOLS, 'packaged-qa-suite.mjs')
const runnerSource = readFileSync(RUNNER, 'utf8')

/* Read independently of the runner's own glob, so this is a second opinion
   rather than a restatement of the thing under test. */
function driversOnDisk() {
  return readdirSync(TOOLS, { withFileTypes: true })
    .filter(entry => entry.isFile() && /-qa\.(mjs|cjs)$/.test(entry.name))
    .map(entry => entry.name)
    .sort()
}

test('1. discovery finds drivers at all -- zero is an error, never a pass', () => {
  const discovered = discoverDrivers()
  assert.ok(discovered.length > 0,
    'no packaged-window QA driver was discovered under tools/. A gate that finds nothing reports success; ' +
    'either the harnesses moved or the -qa.{mjs,cjs} convention changed.')
  assert.ok(runnerSource.includes('discovered NO drivers'),
    'the runner must fail loudly on an empty discovery rather than exiting 0')
})

test('2. every driver on disk is in the plan the runner would execute', () => {
  const onDisk = driversOnDisk()
  const planned = new Set(planFor(discoverDrivers()).map(entry => entry.name))
  const missing = onDisk.filter(name => !planned.has(name))
  assert.deepEqual(missing, [],
    `these packaged-window QA drivers exist and would not run: ${missing.join(', ')}`)
})

test('3a. settings never name a driver that is not on disk', () => {
  const stale = staleSettings(discoverDrivers())
  assert.deepEqual(stale, [],
    `tools/packaged-qa-suite.mjs carries settings for files that no longer exist: ${stale.join(', ')}`)
})

test('3b. an UNREGISTERED driver still gets a runnable plan -- settings are not membership', () => {
  const plan = planFor([...discoverDrivers(), 'invented-never-registered-qa.mjs'])
  const invented = plan.find(entry => entry.name === 'invented-never-registered-qa.mjs')
  assert.ok(invented, 'a driver with no settings entry was dropped from the plan')
  assert.equal(invented.registered, false, 'it must be reported as unregistered')
  assert.equal(invented.runner, 'node', 'it must still get a default runner')
  assert.ok(invented.timeoutMs > 0, 'it must still get a default timeout')
})

/* Strip comments before scanning.
 *
 * Measured, not assumed: the first version of the check below read the WORD
 * `show: true` out of a comment that explained why the code no longer does it,
 * and reported the file as an offender. An instrument that cannot tell code
 * from prose manufactures both false reds and, in the other direction, green
 * over a rule restated in a comment and dropped from the code. */
function codeOnly(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map(line => line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
    .join('\n')
}

test('4. every driver spawns the packaged application with windowsHide, and none opts out', () => {
  const offenders = []
  for (const name of driversOnDisk()) {
    const source = codeOnly(readFileSync(path.join(TOOLS, name), 'utf8'))
    if (/windowsHide\s*:\s*false/.test(source)) offenders.push(`${name}: windowsHide: false`)
    /* Electron main-process harnesses own their BrowserWindow instead of
       spawning the packaged exe; for those the equivalent rule is that the
       window must not be created shown, because show:true steals focus. */
    const spawnsExecutable = /spawn\(\s*execut/.test(source) || /spawn\(exe\b/.test(source)
    if (spawnsExecutable && !/windowsHide\s*:\s*true/.test(source)) {
      offenders.push(`${name}: spawns the packaged app without windowsHide`)
    }
    if (/new BrowserWindow\(/.test(source) && /\bshow:\s*true\b/.test(source)) {
      offenders.push(`${name}: creates its window with show: true, which steals focus`)
    }
  }
  assert.deepEqual(offenders, [], offenders.join('\n'))
})

test("5. the runner sets MC_SMOKE_HEADLESS to the exact string '1' -- absence shows the window", () => {
  assert.match(runnerSource, /MC_SMOKE_HEADLESS\s*=\s*'1'/,
    "the runner must set MC_SMOKE_HEADLESS='1'; shell/window-options.cjs hides the window for that value and no other")
  /* The absence case, asserted against the product rule rather than restated:
     anything other than the exact string leaves the window visible. */
  const { headlessWindowOptions } = require_('../../shell/window-options.cjs')
  assert.deepEqual(headlessWindowOptions({ MC_SMOKE_HEADLESS: '1' }), { show: false })
  for (const value of [undefined, '', '0', 'true', 'yes', 1]) {
    assert.deepEqual(headlessWindowOptions({ MC_SMOKE_HEADLESS: value }), {},
      `MC_SMOKE_HEADLESS=${JSON.stringify(value)} must NOT be read as consent to hide the window`)
  }
})

test('7. the runner does not write into the repository, which would fail require-clean-tree', () => {
  /* tools/require-clean-tree.mjs refuses to build from a tree with uncommitted
     files, and artifacts/ is not ignored. A gate whose own logs block the ship
     path is a gate somebody deletes. */
  assert.match(runnerSource, /tmpdir\(\)/,
    'the default log directory must be outside the repository')
  assert.ok(!/argument\('--logs',\s*path\.join\(REPO_ROOT/.test(runnerSource),
    'the default log directory must not be under REPO_ROOT')
})

test('6. a timeout is reported as TIMEOUT and is never folded into a pass', () => {
  /* The decision is exercised, not grepped. A reaped process reports an exit
     code, and 0 is among the codes it can report -- so the case that matters is
     timedOut with a SUCCESSFUL-looking code. */
  assert.equal(verdictFor({ timedOut: true, code: 0 }), 'TIMEOUT',
    'a driver killed at its ceiling must never be reported as a pass, whatever code the corpse reports')
  assert.equal(verdictFor({ timedOut: true, code: 1 }), 'TIMEOUT')
  assert.equal(verdictFor({ timedOut: true, code: null }), 'TIMEOUT')
  assert.equal(verdictFor({ timedOut: false, code: 0 }), 'PASS')
  assert.equal(verdictFor({ timedOut: false, code: 1 }), 'FAIL')
  /* ABSENCE CASE: a driver that never produced an exit code at all -- the shape
     `close` delivers when the process was signalled -- is not a pass. */
  assert.equal(verdictFor({ timedOut: false, code: null }), 'FAIL')
  assert.equal(verdictFor({ timedOut: false, code: undefined }), 'FAIL')
  /* And the runner must actually use it rather than deciding inline. */
  assert.match(runnerSource, /const verdict = verdictFor\(/,
    'the runner must route its verdict through verdictFor so this test measures what runs')
})

/* The failure this suite was blind to until 2026-08-16: test-account-journey-qa
   reported PASS with eleven FAIL lines in its own log. The driver stopped
   part-way, createLedger's finish() never ran, nothing set process.exitCode,
   and a corpse reporting 0 was read as a green release gate. */
test('7. an exit code of 0 is a CLAIM, and the driver\'s own output is cross-examined against it', () => {
  /* (a) It counted its own failures and exited 0 anyway. */
  assert.equal(verdictFor({ timedOut: false, code: 0, output: '  ok  one\n  FAIL two  detail\n\n1/2 checks passed (journey)\n' }), 'FAIL',
    'a driver that summarised fewer passes than checks must fail however it exited')

  /* (b) The measured shape: checks ran, some failed, and the summary never
     printed because the driver stopped before finish(). Unmeasured is not
     passed, so this is INCONCLUSIVE rather than a quiet green. */
  assert.equal(verdictFor({ timedOut: false, code: 0, output: '  ok  one\n  FAIL two  detail\n' }), 'INCONCLUSIVE',
    'a ledger that started and never summarised leaves its remaining checks unmeasured')

  /* (c) All green and summarised is still a pass -- the fix must not invent
     failures, or it will be turned off. */
  assert.equal(verdictFor({ timedOut: false, code: 0, output: '  ok  one\n  ok  two\n\n2/2 checks passed (journey)\n' }), 'PASS')

  /* (d) The LAST summary decides. A driver may summarise a sub-phase green and
     then summarise itself red; believing the first is the same bug again. */
  assert.equal(verdictFor({ timedOut: false, code: 0, output: '2/2 checks passed (setup)\n  FAIL later\n3/4 checks passed (all)\n' }), 'FAIL')

  /* (e) Prose containing the word FAIL is not a failing check. The two leading
     spaces are the discriminator, and a driver that narrates a refusal it
     EXPECTS -- which several of these drivers exist to do -- must stay green. */
  assert.equal(verdictFor({ timedOut: false, code: 0, output: 'the submit is refused, and a FAIL here would mean the gate is open\n' }), 'PASS')

  /* (e2) THE OTHER TWO CONVENTIONS, taken from real logs. A rule that knew only
     createLedger's wording would have marked these red for ending differently,
     and a gate that cries wolf gets switched off. */
  assert.equal(verdictFor({ timedOut: false, code: 0, output: '  ok  a\n\nresearch walkthrough: 23/23 checks\n\nresearch walkthrough: PASS\n' }), 'PASS',
    'the walkthrough drivers close with "N/N checks" and must not be read as summary-less')
  assert.equal(verdictFor({ timedOut: false, code: 0, output: '  ok  a\n\nskip: 18/18 checks\n\nsetup walkthrough: PASS\n' }), 'PASS')
  assert.equal(verdictFor({ timedOut: false, code: 0, output: '  ok  a\n\n4 of 85 CHECK(S) FAILED\n' }), 'FAIL',
    'first-run-contract-qa counts its own failures in words; exiting 0 afterwards does not withdraw the count')
  assert.equal(verdictFor({ timedOut: false, code: 0, output: '  ok  a\n\n0 of 85 CHECK(S) FAILED\n' }), 'PASS')

  /* (f) A non-zero exit is still a failure whatever the log says, and a timeout
     is still decided first -- neither is reachable through the new branches. */
  assert.equal(verdictFor({ timedOut: false, code: 1, output: '4/4 checks passed\n' }), 'FAIL')
  assert.equal(verdictFor({ timedOut: true, code: 0, output: '4/4 checks passed\n' }), 'TIMEOUT')

  /* (g) Silence is unchanged: a driver this function does not recognise is
     judged on its exit code exactly as before. This is the honest limit of the
     fix, pinned so nobody reads the commit as broader than it is. */
  assert.equal(verdictFor({ timedOut: false, code: 0, output: 'built 42 things\n' }), 'PASS')
  assert.equal(verdictFor({ timedOut: false, code: 0 }), 'PASS')

  /* And the runner must hand it the output, or every branch above is dead code
     in the only place that matters. */
  assert.match(runnerSource, /verdictFor\(\{[^}]*output:/,
    'the runner must pass the driver output to verdictFor, or the cross-examination never runs')
})

test('8. a non-PASS verdict of any kind fails the suite, so INCONCLUSIVE cannot be a quiet green', () => {
  assert.match(runnerSource, /results\.filter\(result => result\.verdict !== 'PASS'\)/,
    'the suite must count anything that is not a PASS as a failure; an allowlist of tolerated verdicts is how ' +
    'INCONCLUSIVE would become the new exit-0')
})

/* require() for the CommonJS product module, from an ESM suite. */
import { createRequire } from 'node:module'
const require_ = createRequire(import.meta.url)
