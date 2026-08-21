/* DOES A REAL TURN'S TOKENS REACH THE METRICS PAGE?
 *
 * Green unit tests over shell/usage-record.cjs and src/local-metrics.js say the
 * writer and the readings are correct. They cannot say the engine reports what
 * this code expects, and that is the one thing this whole feature rests on: the
 * shape of a codex `usage` event was READ off a capture, and a capture is a
 * claim until a live turn agrees with it. So this drives one real Codex `luna`
 * session, on the owner's own sign-in, through the packaged shell, and then asks
 * the page itself what it shows.
 *
 * WHAT IS STAGED AND WHAT IS NOT, said out loud rather than implied. The app
 * under the window is the BUILT renderer (dist/) and the shipped shell (shell/)
 * copied into a scratch root, run by the Electron binary this build pins, with a
 * fresh user-data directory. That is the same staging shape
 * tools/agent-start-flow-qa.mjs documents for its fallback, and it measures the
 * code that ships. It does NOT measure asar packing, the renamed launcher, the
 * installer or the signature -- those belong to tools/check-asar-manifest.mjs
 * and tools/smoke-packaged.mjs, and this run says so instead of quietly implying
 * otherwise. Nothing is written to any installed copy.
 *
 * Usage:
 *   node tools/metrics-usage-live-qa.mjs --engine <path to the engine checkout>
 */

import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/* THE SHARED STALENESS GUARD, and it is not optional for a driver that stages
   dist/. A harness that copies a dist/ older than the source measures a bundle
   from before the change it is reporting on, and then reports PASS about code
   that was never in the window. tools/test/staged-renderer-guard.test.mjs sweeps
   every harness for these two calls precisely so a new driver cannot arrive
   without them -- which is how this one was caught. */
import { assertRendererMeasurable, assertStagedRendererConsistent } from './lib/staged-renderer.mjs'

const require_ = createRequire(import.meta.url)
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const argv = process.argv.slice(2)
const engineFlag = argv.indexOf('--engine')
const ENGINE = engineFlag > -1 ? argv[engineFlag + 1] : process.env.MISSION_CONTROL_ENGINE
if (!ENGINE) {
  console.error('This driver measures a REAL agent turn and needs a real engine to run one.')
  console.error('Pass --engine <path to the engine checkout or its codex-process.js>.')
  process.exit(2)
}

if (!existsSync(path.join(REPO_ROOT, 'shell'))) {
  console.error('shell/ is missing from this checkout.')
  process.exit(2)
}
/* BEFORE anything is copied: is the built renderer even worth measuring? */
assertRendererMeasurable({ repoRoot: REPO_ROOT })

const scratch = mkdtempSync(path.join(os.tmpdir(), 'metrics-usage-live-'))
const staged = path.join(scratch, 'app')
mkdirSync(staged, { recursive: true })
for (const directory of ['dist', 'shell']) {
  cpSync(path.join(REPO_ROOT, directory), path.join(staged, directory), { recursive: true })
}
cpSync(path.join(REPO_ROOT, 'package.json'), path.join(staged, 'package.json'))
/* AND AFTER: a dist/ rewritten mid-copy stages an index.html pointing at assets
   that are not there, which fails as a blank page rather than as a stale one. */
assertStagedRendererConsistent({
  stagedDist: path.join(staged, 'dist'),
  sourceDist: path.join(REPO_ROOT, 'dist'),
})

const userData = path.join(scratch, 'userdata')
mkdirSync(userData, { recursive: true })

const electron = require_('electron')
if (typeof electron !== 'string') {
  console.error('Expected the Electron binary path; got an Electron module instead.')
  process.exit(2)
}

const environment = { ...process.env }
/* Both are exported by agent harnesses and both turn the Electron binary into
   plain Node, which fails in a way that reads as a product bug. */
delete environment.ELECTRON_RUN_AS_NODE
delete environment.ELECTRON_NO_ATTACH_CONSOLE
environment.MC_APP_ROOT = staged
environment.MISSION_CONTROL_ENGINE = ENGINE

const child = spawn(electron, [
  path.join(REPO_ROOT, 'tools', 'metrics-usage-live-probe.cjs'),
  `--user-data-dir=${userData}`,
], { env: environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })

child.stdout.on('data', chunk => process.stdout.write(chunk))
child.stderr.on('data', chunk => process.stderr.write(chunk))

const watchdog = setTimeout(() => {
  console.error('\nUNMEASURED: the probe did not finish within 6 minutes; killing it.')
  try { child.kill() } catch { /* already gone */ }
  process.exitCode = 3
}, 360_000)

child.on('exit', (code) => {
  clearTimeout(watchdog)
  console.log(`\nstaged app root: ${staged}`)
  console.log(`user data:       ${userData}`)
  if (process.env.MC_KEEP_SCRATCH !== '1') {
    try { rmSync(scratch, { recursive: true, force: true }) } catch { /* the temp root can wait for the OS */ }
  }
  process.exit(code === null ? 3 : code)
})
