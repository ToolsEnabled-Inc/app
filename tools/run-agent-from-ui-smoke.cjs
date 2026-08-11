'use strict'

/* Runner for tools/agent-from-ui-smoke.cjs.
 *
 * Two jobs, both of which the smoke cannot do for itself:
 *
 * 1. Strip ELECTRON_RUN_AS_NODE. Agent harnesses and VS Code extension hosts
 *    export it, which turns the Electron binary into plain Node and makes the
 *    app fail in a way that looks like a product bug. shell/launch.cjs strips
 *    it for `npm run app`; this is the same guard for the smoke.
 * 2. Point the shell at an engine. Without MISSION_CONTROL_ENGINE the app is
 *    working correctly when it reports no engine -- the smoke would then be
 *    measuring a fail-closed path, not the spawn path.
 *
 * Exit code is the smoke's own. Usage:
 *   MISSION_CONTROL_ENGINE=<path to the engine module directory> \
 *   node tools/run-agent-from-ui-smoke.cjs
 */

const path = require('node:path')
const { spawn } = require('node:child_process')

const APP_ROOT = path.resolve(__dirname, '..')

if (!process.env.MISSION_CONTROL_ENGINE) {
  console.error(
    'MISSION_CONTROL_ENGINE is not set.\n' +
    'This smoke measures the spawn path end to end and needs a real engine to spawn.\n' +
    'Set it to the directory containing the engine module and run again.',
  )
  process.exit(2)
}

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_NO_ATTACH_CONSOLE
env.MC_APP_ROOT = APP_ROOT

const electron = require('electron')
if (typeof electron !== 'string') {
  console.error('Expected the Electron binary path; got an Electron module instead.')
  process.exit(2)
}

/* Piped, not inherited. Electron starts GPU and crashpad helpers that inherit
   an inherited stdout handle and outlive the main process, so `npm run` sat
   waiting on a pipe that never closed even after the smoke had finished and
   exited 0. Forwarding the streams ourselves and exiting on the main child's
   code keeps the reported exit honest and prompt. */
const child = spawn(electron, [path.join(__dirname, 'agent-from-ui-smoke.cjs')], {
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
})
child.stdout.on('data', (chunk) => process.stdout.write(chunk))
child.stderr.on('data', (chunk) => process.stderr.write(chunk))
child.on('exit', (code) => process.exit(code ?? 1))
