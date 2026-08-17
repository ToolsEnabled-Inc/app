#!/usr/bin/env node

// THE PACKAGED-WINDOW QA DRIVERS, RUN BY SOMETHING OTHER THAN A PERSON.
//
// WHAT WAS MEASURED BEFORE THIS FILE EXISTED. This tree carries thirteen
// harnesses that drive the real packaged application and read what is on the
// glass. Grepped against every automated entry point in package.json --
// `test`, `test:data`, `dist`, `release:cut`, `verify` -- NOT ONE of them was
// invoked. Seven had an `npm run qa:*` alias, which is a thing a person types,
// and six had not even that. The defects they were each written for --
// the operator's purchase list shipped to strangers, an agent page nothing
// routed to, a Recommended answer that led to an installation with no control
// that starts anything, dead steering controls, and a page that printed
// "nothing here is real" over an enabled button that spawned a real session --
// are exactly the class of defect that a source test cannot see and that these
// harnesses do see. They were all found by a person running one by hand.
//
// So this is the automated path. It is deliberately NOT a `node --test` suite:
// each driver owns a real Electron process, a staged copy of the packaged
// build, real wall-clock waits and its own teardown, and the test runner's
// concurrency and reporting would fight all four.
//
// FOUR RULES THIS FILE ENFORCES ON ITSELF.
//
// 1. DISCOVERY, NEVER A LIST. Membership is a glob over tools/ for the naming
//    convention every one of these files already follows. A hand-written list
//    is the defect this repo has already been bitten by (a list of 11 stood in
//    for a glob over 26), and self-selected coverage cannot fail. A driver
//    added tomorrow is picked up with no edit here.
//
// 2. NOTHING IS SKIPPED SILENTLY. Zero drivers discovered is an ERROR, not a
//    pass -- the same rule tools/check-suites-discovered.mjs applies to the
//    unit suites. A driver this file has no per-driver settings for still RUNS,
//    on defaults, and is reported as unregistered; it is never dropped.
//
// 3. A TIMEOUT IS NOT A PASS AND NOT A SKIP. It is TIMEOUT, it is counted with
//    the failures, and the process tree is reaped before the next driver starts.
//
// 4. NO WINDOW, NO CONSOLE, NO STOLEN FOCUS. Every child is spawned with
//    windowsHide, and MC_SMOKE_HEADLESS=1 is put in the environment the drivers
//    inherit and pass to the packaged app, which is what actually keeps the
//    BrowserWindow off the owner's desktop (shell/window-options.cjs).
//    windowsHide alone would not: it only suppresses a console.
//
// USAGE
//   node tools/packaged-qa-suite.mjs                 every free driver
//   node tools/packaged-qa-suite.mjs --list          what would run, and why
//   node tools/packaged-qa-suite.mjs --only home-screen-qa,page2-qa
//   node tools/packaged-qa-suite.mjs --include-costly    also the ones that
//                                                       spend provider budget
//   node tools/packaged-qa-suite.mjs --visible      show the windows (debugging)
//   node tools/packaged-qa-suite.mjs --release <dir>     borrow another build
//   node tools/packaged-qa-suite.mjs --logs <dir>        keep the per-driver logs
//
// Exit code is 0 only when every driver that ran passed.

import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SELF = fileURLToPath(import.meta.url)
const REPO_ROOT = path.resolve(path.dirname(SELF), '..')
const require_ = createRequire(import.meta.url)

/* The naming convention, in one place. Both extensions, because two of these
   harnesses are Electron main-process scripts and must stay .cjs. */
const DRIVER_PATTERN = /-qa\.(mjs|cjs)$/

function argument(name, fallback = null) {
  const inline = process.argv.find(value => value.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const at = process.argv.indexOf(name)
  return at === -1 ? fallback : (process.argv[at + 1] ?? fallback)
}

const LIST_ONLY = process.argv.includes('--list')
const INCLUDE_COSTLY = process.argv.includes('--include-costly')
const VISIBLE = process.argv.includes('--visible')
const ONLY = (argument('--only') || '').split(',').map(value => value.trim()).filter(Boolean)
const RELEASE = argument('--release')
/* LOGS GO OUTSIDE THE REPOSITORY BY DEFAULT, and that is not tidiness.
 *
 * `npm run dist` runs tools/require-clean-tree.mjs, which REFUSES to build from
 * a tree with uncommitted files -- an untracked byte was never a release
 * candidate. artifacts/ is not in .gitignore (checked: `git check-ignore`
 * reports nothing), so a gate that wrote its own logs there would fail the ship
 * path every time it ran, and the fix a hurried session would reach for is
 * deleting the gate. So the default is a per-run directory under the OS temp
 * dir, and `--logs <dir>` puts them wherever an operator actually wants them. */
const LOG_DIR = path.resolve(argument('--logs') || path.join(tmpdir(), 'packaged-qa-logs'))

/* ---------- per-driver settings ----------
 *
 * These are SETTINGS, not membership. A driver absent from this map still runs;
 * it just runs on the defaults and is flagged so somebody records what it needs.
 * An entry here naming a file that no longer exists is a stale setting and is
 * reported as such -- both directions are checked, because a registry that can
 * only be wrong in one direction rots in the other.
 *
 *   runner       'node' (default) | 'electron' -- Electron main-process scripts
 *                cannot run under node, they need the Electron binary.
 *   timeoutMs    hard ceiling for one driver. Generous: several of these stage a
 *                full copy of a 225 MB packaged build before they start.
 *   costly       true = spends real provider budget or needs the public network.
 *                Excluded unless --include-costly. Loud in --list either way.
 *   needs        extra argv the driver requires to be runnable at all.
 */
const SETTINGS = new Map([
  ['home-screen-qa.cjs', { runner: 'node', timeoutMs: 240_000 }],
  ['page2-qa.cjs', { runner: 'electron', timeoutMs: 300_000 }],
  ['owner-popup-qa.cjs', { runner: 'electron', timeoutMs: 300_000 }],
  ['checkout-privacy-packaged-qa.mjs', { runner: 'node', timeoutMs: 600_000 }],
  ['owner-account-packaged-qa.mjs', { runner: 'node', timeoutMs: 600_000 }],
  ['test-account-journey-qa.mjs', { runner: 'node', timeoutMs: 600_000 }],
  ['account-isolation-leak-qa.mjs', { runner: 'node', timeoutMs: 900_000 }],
  ['account-isolation-session-qa.mjs', { runner: 'node', timeoutMs: 900_000 }],
  ['team-panel-packaged-qa.mjs', { runner: 'node', timeoutMs: 600_000 }],
  ['loop-packaged-qa.mjs', { runner: 'node', timeoutMs: 900_000 }],
  ['example-page-write-fence-qa.mjs', { runner: 'node', timeoutMs: 600_000 }],
  ['chatbox-settings-qa.mjs', { runner: 'node', timeoutMs: 900_000 }],
  ['agent-subpage-qa.mjs', { runner: 'node', timeoutMs: 1_200_000 }],
  ['setup-walkthrough-qa.mjs', { runner: 'node', timeoutMs: 900_000 }],
  ['recommended-path-packaged-qa.mjs', { runner: 'node', timeoutMs: 900_000 }],
  ['stranger-onboarding-qa.mjs', { runner: 'node', timeoutMs: 1_200_000 }],
  ['first-run-contract-qa.mjs', { runner: 'node', timeoutMs: 1_200_000 }],
  /* CAN A PERSON START AN AGENT AT ALL? Drives the fleet page on a fresh
     profile and presses the empty node, the panel and the send control, then
     rebuilds three versions of the defect and requires itself to go red against
     each. Measured at 16.7s end to end (staging a packaged copy, re-staging the
     capability payload, one window, five view builds), so the ceiling is
     deliberately close rather than the 900s default: this one running long
     means the app did not come up, and waiting a quarter of an hour to be told
     that helps nobody. It spends no provider budget by construction -- PATH is
     cut to the Windows system directories and the profile directories are
     empty, so the start travels the whole way and stops at the last gate. */
  ['agent-start-flow-qa.mjs', { runner: 'node', timeoutMs: 300_000 }],
  /* The research workbench, walked live on a fresh universe: supervised
     capability layer (with the CURRENT capability/ payload staged in), live
     page mount, account creation and sign-in, a project and a grid experiment
     through the page's own controls, and the research.pipeline settings gate
     refusing the submit AND the worker start by name. Spends nothing by
     construction: the gate holds every run in the isolated universe, which is
     precisely what it asserts. */
  ['research-walkthrough-qa.mjs', { runner: 'node', timeoutMs: 900_000 }],
  /* Google sign-in against a LOOPBACK test provider (never Google): stages the
     packaged window, plants a userData test-provider config, and drives the
     button through PKCE, id-token verification, account mint, and restart
     survival, plus the refusal lanes and cancelled-sign-in cleanliness. It
     spends nothing and touches no network by construction. This was the one
     flow a release could break with no gate noticing -- the shipped config
     carrier (config/google-signin.json) is enforced by check-asar-manifest,
     and THIS enforces that the machinery behind it still signs somebody in. */
  ['google-signin-packaged-qa.mjs', { runner: 'node', timeoutMs: 900_000 }],
  /* The only driver here that opens no window: it starts the shipped payload's
     own capability layer and POSTs real dispatches to it. Measured at ~102s
     (twelve audited dispatches plus a second bridge for the negative control),
     so the ceiling is deliberately close rather than the 900s default -- this
     one hanging means a bridge did not come up, and waiting a quarter of an hour
     to be told that helps nobody. It spends no provider budget by construction;
     see the environment fence in its header. */
  ['agent-dispatch-packaged-qa.mjs', { runner: 'node', timeoutMs: 300_000 }],
  /* Launches a real Codex Cloud task and follows it to a terminal state. Real
     provider budget, real network. Never in the default set. */
  ['cloud-launch-packaged-qa.mjs', { runner: 'node', timeoutMs: 1_500_000, costly: true }],
])

const DEFAULT_SETTINGS = Object.freeze({ runner: 'node', timeoutMs: 900_000, costly: false, needs: [] })

/* Which drivers accept `--release <dir>`. Passing it to one that does not would
   be read as an unknown positional, so it is asked of the file rather than
   assumed. */
function acceptsRelease(source) {
  return /--release/.test(source)
}

export function discoverDrivers(toolsDirectory = path.join(REPO_ROOT, 'tools')) {
  const names = readdirSync(toolsDirectory, { withFileTypes: true })
    .filter(entry => entry.isFile() && DRIVER_PATTERN.test(entry.name))
    .map(entry => entry.name)
    .sort()
  return names
}

export function planFor(names) {
  return names.map(name => {
    const settings = { ...DEFAULT_SETTINGS, ...(SETTINGS.get(name) || {}) }
    return {
      name,
      key: name.replace(/\.(mjs|cjs)$/, ''),
      file: path.join(REPO_ROOT, 'tools', name),
      registered: SETTINGS.has(name),
      ...settings,
    }
  })
}

/* Stale settings: an entry whose file is gone. Exported so the guard suite can
   assert it without launching anything. */
export function staleSettings(names) {
  const present = new Set(names)
  return [...SETTINGS.keys()].filter(name => !present.has(name))
}

/* THE VERDICT, AS A FUNCTION RATHER THAN AN EXPRESSION BURIED IN THE RUNNER.
 *
 * A timeout is a CONTINUATION, never a result, and it is decided BEFORE the
 * exit code is looked at: a reaped process reports a code that reads exactly
 * like an ordinary failure -- and on some shapes like a success. Exported so
 * the guard suite can exercise the decision instead of grepping this file for
 * the shape of it, which is the kind of instrument that goes green on prose.
 *
 * AN EXIT CODE IS A CLAIM, NOT A RESULT (2026-08-16).
 * Measured: test-account-journey-qa reported PASS while its own log carried
 * eleven FAIL lines -- the driver stopped part-way, so createLedger's finish()
 * never ran, so nothing ever set process.exitCode, so the corpse said 0 and
 * this suite believed it. A gate that believes a half-finished driver is worse
 * than no gate, because every other green in the release is measured by it.
 *
 * So exit 0 is now cross-examined against what the driver actually said:
 *   - it summarised, and the summary is short of total  -> FAIL, whatever the
 *     code says. The driver counted its own failures and exited 0 anyway.
 *   - it started a check ledger and never summarised    -> INCONCLUSIVE. It
 *     stopped somewhere in the middle; the checks it never reached are
 *     unmeasured, and unmeasured is not passed.
 *   - it said nothing this function recognises          -> the exit code, as
 *     before.
 *
 * HONEST LIMIT, stated rather than implied: the shapes below are the shared
 * ledger's (tools/test-account-harness.mjs createLedger). A driver that prints
 * neither is still judged on its exit code alone and can still lie the same
 * way. Closing that needs every driver to declare an end, which is a contract
 * change across ~44 drivers and belongs in its own commit -- not a silent
 * widening of this one.
 */

/* THE SUMMARY VOCABULARY IS MEASURED, NOT DECREED. Replaying 37 real driver
   logs found three closing conventions in use, and a rule that knew only the
   first would have marked research-walkthrough-qa and setup-walkthrough-qa red
   for the crime of ending differently. A gate that cries wolf gets switched
   off, so the vocabulary matches what the drivers already write:
     `1/2 checks passed`        createLedger's finish()
     `research walkthrough: 23/23 checks`  the walkthrough drivers
     `4 of 85 CHECK(S) FAILED`  first-run-contract-qa
   Adding a fourth convention means adding it here, with a log that shows it. */
const RATIO_SUMMARY = /^[^\n]*?(\d+)\s*\/\s*(\d+)\s+checks?\b[^\n]*$/gm
const FAILED_COUNT = /^[^\n]*?(\d+) of (\d+) CHECK\(S\) FAILED/gim
/* `  ok  <name>` / `  FAIL <name>`, as createLedger's check() writes it. The
   two leading spaces are load-bearing: they keep prose that merely contains the
   word FAIL from being read as a failing check. */
const CHECK_LINE = /^ {2}(?:ok {2}|FAIL )/m

/* The last match, not the first: a driver may summarise a sub-phase before it
   summarises itself, and the closing count is the one that speaks. */
function lastMatch(text, pattern) {
  const all = [...text.matchAll(pattern)]
  return all.length ? all[all.length - 1] : null
}

export function verdictFor({ timedOut, code, output = '' }) {
  if (timedOut) return 'TIMEOUT'
  if (code !== 0) return 'FAIL'

  const text = typeof output === 'string' ? output : ''

  /* A driver that counted its own failures has already answered, and exiting 0
     afterwards does not withdraw the count. */
  const failedCount = lastMatch(text, FAILED_COUNT)
  if (failedCount) return Number(failedCount[1]) > 0 ? 'FAIL' : 'PASS'

  const ratio = lastMatch(text, RATIO_SUMMARY)
  if (ratio) return ratio[1] === ratio[2] ? 'PASS' : 'FAIL'

  /* Checks ran and nothing closed them out: the driver stopped somewhere in the
     middle. What it never reached is unmeasured, and unmeasured is not passed. */
  if (CHECK_LINE.test(text)) return 'INCONCLUSIVE'

  return 'PASS'
}

function electronBinary() {
  /* Derived from the installed package, never a path typed into this file --
     this is a product repository and a named path would be wrong on any other
     machine. */
  const resolved = require_('electron')
  if (typeof resolved !== 'string' || resolved.length === 0) {
    throw new Error('the electron package did not resolve to an executable path')
  }
  if (!existsSync(resolved)) throw new Error(`electron resolved to ${resolved}, which is not on disk`)
  return resolved
}

function reap(pid) {
  if (!pid) return
  try {
    spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 30_000 })
  } catch { /* the tree is already gone */ }
}

async function runDriver(entry, environment) {
  const command = entry.runner === 'electron' ? electronBinary() : process.execPath
  const argv = [entry.file, ...entry.needs]
  if (RELEASE) argv.push('--release', RELEASE)

  const startedAt = Date.now()
  const output = []
  const child = spawn(command, argv, {
    cwd: REPO_ROOT,
    env: environment,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8')
    stream.on('data', chunk => { output.push(chunk); while (output.length > 4000) output.shift() })
  }
  child.on('error', error => output.push(`[spawn error] ${error.message}\n`))

  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; reap(child.pid) }, entry.timeoutMs)
  const code = await new Promise(resolve => {
    child.on('close', value => resolve(value))
  })
  clearTimeout(timer)
  reap(child.pid)

  const durationMs = Date.now() - startedAt
  const text = output.join('')
  mkdirSync(LOG_DIR, { recursive: true })
  const logPath = path.join(LOG_DIR, `${entry.key}.log`)
  writeFileSync(logPath, text, 'utf8')

  const verdict = verdictFor({ timedOut, code, output: text })
  return { ...entry, verdict, exitCode: code, durationMs, logPath, tail: text.trim().split('\n').slice(-4).join(' | ') }
}

async function main() {
  const names = discoverDrivers()
  if (names.length === 0) {
    console.error('packaged-qa-suite: discovered NO drivers under tools/. That is an error, not a pass:')
    console.error(`  nothing in ${path.join(REPO_ROOT, 'tools')} matches ${DRIVER_PATTERN}.`)
    console.error('  Either the harnesses moved or the convention changed. A gate that found nothing reports success; this one does not.')
    process.exit(2)
  }

  const stale = staleSettings(names)
  if (stale.length > 0) {
    console.error(`packaged-qa-suite: settings name ${stale.length} driver(s) that are not on disk: ${stale.join(', ')}`)
    process.exit(2)
  }

  const plan = planFor(names).map(entry => ({ ...entry, source: '' }))
  /* Read each driver once, for the --release question. Cheap, and it keeps the
     answer a property of the file rather than of this file's memory of it. */
  const { readFileSync } = await import('node:fs')
  for (const entry of plan) entry.source = readFileSync(entry.file, 'utf8')

  /* --release must reach EVERY driver or none. A driver that does not read the
     flag would quietly measure the default build instead -- a run that reported
     a verdict about a build the operator did not ask about, which is worse than
     refusing. So the mismatch is named and the run stops. */
  if (RELEASE) {
    const deaf = plan.filter(entry => !acceptsRelease(entry.source))
    if (deaf.length > 0) {
      console.error(`packaged-qa-suite: --release was given, but these drivers do not read it and would silently measure their default build: ${deaf.map(e => e.key).join(', ')}`)
      console.error('  Run them individually, or teach them --release. A partial answer about the wrong artifact is not an answer.')
      process.exit(2)
    }
  }

  const selected = plan.filter(entry => {
    if (ONLY.length > 0) return ONLY.includes(entry.key) || ONLY.includes(entry.name)
    return true
  })
  if (ONLY.length > 0 && selected.length === 0) {
    console.error(`packaged-qa-suite: --only ${ONLY.join(',')} matched no driver. Known: ${plan.map(e => e.key).join(', ')}`)
    process.exit(2)
  }

  const costlyHeld = selected.filter(entry => entry.costly && !INCLUDE_COSTLY)
  const toRun = selected.filter(entry => !entry.costly || INCLUDE_COSTLY)

  console.log(`packaged QA drivers discovered: ${names.length}`)
  for (const entry of plan) {
    const marks = [
      entry.registered ? null : 'UNREGISTERED (running on defaults)',
      entry.costly ? 'COSTLY (spends provider budget)' : null,
    ].filter(Boolean)
    console.log(`  ${entry.key.padEnd(36)} ${entry.runner.padEnd(8)} ${String(Math.round(entry.timeoutMs / 1000)).padStart(4)}s  ${marks.join(' ')}`)
  }
  if (costlyHeld.length > 0) {
    console.log(`\nheld back (pass --include-costly to run): ${costlyHeld.map(e => e.key).join(', ')}`)
  }
  if (LIST_ONLY) return 0

  const environment = { ...process.env }
  /* The exact string '1'. shell/window-options.cjs matches nothing else, and
     an empty or absent value SHOWS the window -- absence is not consent here
     either, so it is set explicitly rather than assumed to be inherited. */
  if (VISIBLE) delete environment.MC_SMOKE_HEADLESS
  else environment.MC_SMOKE_HEADLESS = '1'
  delete environment.ELECTRON_RUN_AS_NODE

  const results = []
  for (const entry of toRun) {
    process.stdout.write(`\n---- ${entry.key} ----\n`)
    const result = await runDriver(entry, environment)
    results.push(result)
    console.log(`${result.verdict}  ${entry.key}  exit=${result.exitCode}  ${(result.durationMs / 1000).toFixed(1)}s  log=${result.logPath}`)
    if (result.verdict !== 'PASS') console.log(`      ${result.tail}`)
  }

  console.log('\n================ packaged QA drivers ================')
  for (const result of results) {
    console.log(`${result.verdict.padEnd(8)} ${result.key.padEnd(36)} ${(result.durationMs / 1000).toFixed(1)}s`)
  }
  for (const entry of costlyHeld) console.log(`${'HELD'.padEnd(8)} ${entry.key.padEnd(36)} costly, not run`)

  const failed = results.filter(result => result.verdict !== 'PASS')
  console.log(`\n${results.length - failed.length}/${results.length} drivers passed` +
    (costlyHeld.length ? `, ${costlyHeld.length} held back` : ''))
  return failed.length === 0 ? 0 : 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(SELF)) {
  main().then(
    code => { process.exit(code) },
    error => { console.error(error?.stack || String(error)); process.exit(2) },
  )
}
