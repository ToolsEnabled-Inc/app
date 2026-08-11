'use strict'

/* Runner for tools/steering-controls-e2e.cjs -- same two jobs as
 * tools/run-agent-from-ui-smoke.cjs, and for the same reasons:
 *
 * 1. Strip ELECTRON_RUN_AS_NODE. An agent harness exports it, which turns the
 *    Electron binary into plain Node and makes the app fail in a way that
 *    reads as a product bug.
 * 2. Point the shell at an engine when the caller named one. Unlike the sibling
 *    smoke this does NOT require it: a checkout with a staged capability
 *    payload resolves its own engine, and demanding the variable would make the
 *    packaged case unrunnable.
 *
 * Exit code is the run's own.
 */

const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')

const WATCHDOG_MS = 660_000
const APP_ROOT = path.resolve(__dirname, '..')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_NO_ATTACH_CONSOLE
/* THE CALLER'S APP ROOT WINS, and this line used to overwrite it.
 *
 * `env.MC_APP_ROOT = APP_ROOT` was unconditional, so a run launched with
 * MC_APP_ROOT pointed at release/win-unpacked/resources/app.asar silently
 * measured the CHECKOUT instead -- and passed, which is the worst possible
 * outcome: a green result labelled "packaged" that never opened the package. I
 * did exactly that once during this lane and only caught it by comparing the
 * bundle hash inside the asar against the one on disk.
 *
 * An explicitly set value is a caller who has decided; an unset one is a caller
 * who has not, and only the second gets the default. */
if (!env.MC_APP_ROOT || env.MC_APP_ROOT.trim() === '') env.MC_APP_ROOT = APP_ROOT
console.log(`[runner] app root: ${env.MC_APP_ROOT}`)

const electron = require('electron')
if (typeof electron !== 'string') {
  console.error('Expected the Electron binary path; got an Electron module instead.')
  process.exit(2)
}

const child = spawn(electron, [path.join(__dirname, 'steering-controls-e2e.cjs')], {
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
})

/* A CORRECT PRESS MAY NOT LOG AN ERROR, and only the runner can see this.
 *
 * The renderer swallows a rejected mc-agent call, so nothing user-visible goes
 * wrong -- but Electron prints `Error occurred in handler for '<channel>'` with
 * a full stack from the MAIN process, which is a stream the driver inside that
 * process cannot read about itself. Every Respawn and Terminate over an idle
 * session used to emit one. A product whose ordinary success path writes a
 * stack trace into its own log trains whoever reads that log to skip it, and
 * the next genuine fault goes with it.
 *
 * Bounded, because a wedged run could otherwise stream until memory ran out. */
const HANDLER_ERROR = /Error occurred in handler for '([^']+)'/g
const seen = new Set()
let scanned = 0
function scan(text) {
  if (scanned > 4_000_000) return
  scanned += text.length
  for (const match of text.matchAll(HANDLER_ERROR)) seen.add(match[1])
}
child.stdout.on('data', chunk => { scan(String(chunk)); process.stdout.write(chunk) })
child.stderr.on('data', chunk => { scan(String(chunk)); process.stderr.write(chunk) })

/* The run reaps its own descendants before exiting; this is the case where it
   could not, because it was wedged and never reached that code. */
const watchdog = setTimeout(() => {
  console.error(`[runner] no result after ${WATCHDOG_MS}ms; killing the tree`)
  try { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }) } catch {}
  process.exit(3)
}, WATCHDOG_MS)

child.on('exit', (code, signal) => {
  clearTimeout(watchdog)
  const channels = [...seen].sort()
  if (channels.length > 0) {
    console.log(`FAIL  steering a session logged an error from the main process  :: channels=${JSON.stringify(channels)}`)
  } else {
    console.log('PASS  no main-process handler error was logged during the run')
  }
  const own = signal ? 4 : (code === null ? 5 : code)
  process.exit(own !== 0 ? own : (channels.length > 0 ? 6 : 0))
})
child.on('error', (error) => {
  clearTimeout(watchdog)
  console.error('[runner] failed to launch Electron:', error.message)
  process.exit(2)
})
