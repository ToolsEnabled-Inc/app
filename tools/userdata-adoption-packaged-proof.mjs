#!/usr/bin/env node

/* DOES THE REAL, PACKAGED APPLICATION CARRY A RENAMED INSTALL'S DATA ACROSS?
 *
 * tools/test/userdata-adoption.test.mjs proves the module. It cannot prove the
 * module is REACHED: shell/main.cjs resolves userData at module scope in several
 * places, and an adoption wired in below any of them would be dead code that
 * still passes every unit test. Source text cannot see that difference. This
 * launches release/win-unpacked/ToolsEnabled.exe and reads what ends up on disk.
 *
 * IT NEVER TOUCHES THE REAL %APPDATA%. The legacy install it adopts from is
 * seeded in a temp directory, and the app is pointed at a sibling of it with
 * --user-data-dir. That works because shell/userdata-adoption.cjs looks for a
 * prior installation beside wherever userData actually is, rather than in a
 * fixed OS folder -- so this exercise uses invented data, not a person's.
 *
 * USAGE: node tools/userdata-adoption-packaged-proof.mjs [win-unpacked-dir]
 */

import { spawn, execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const execFile = promisify(execFileCb)

const APP_EXE = 'ToolsEnabled.exe'
const READY_TIMEOUT_MS = 60_000
const POLL_INTERVAL_MS = 250
const PROBE_THEME = 'black'
const PROBE_NOTE = '# work that predates the rename\n'

const unpackedDirectory = path.resolve(process.argv[2] || 'release/win-unpacked')
const executable = path.join(unpackedDirectory, APP_EXE)

function fail(message) {
  console.error(`[userdata-adoption-proof] FAIL: ${message}`)
  process.exitCode = 1
}

/* Windows kills only the named process; Electron's renderer and GPU children
   outlive it and keep the port. */
async function killTree(child) {
  if (!child || child.exitCode !== null) return
  try { await execFile('taskkill', ['/pid', String(child.pid), '/T', '/F']) } catch { /* already gone */ }
}

function seedLegacyInstall(directory) {
  fs.mkdirSync(path.join(directory, 'workspace'), { recursive: true })
  fs.writeFileSync(path.join(directory, 'renderer-prefs.json'), JSON.stringify({
    storageVersion: 1,
    values: { 'mc.theme': PROBE_THEME },
    drainedOrigins: [],
  }))
  fs.writeFileSync(path.join(directory, 'shell-state.json'), JSON.stringify({ bounds: { width: 1440, height: 900 } }))
  fs.writeFileSync(path.join(directory, 'workspace', 'notes.md'), PROBE_NOTE)
  /* Chromium noise a real install would also have, to prove it is NOT copied. */
  fs.mkdirSync(path.join(directory, 'Cache'), { recursive: true })
  fs.writeFileSync(path.join(directory, 'Cache', 'data_0'), 'x'.repeat(4096))
}

async function waitForAdoptionRecord(recordPath, child, deadline) {
  while (Date.now() < deadline) {
    if (fs.existsSync(recordPath)) {
      try {
        const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'))
        if (record.status === 'complete') return record
      } catch { /* still being written */ }
    }
    if (child.exitCode !== null && !fs.existsSync(recordPath)) {
      throw new Error(`the application exited (code ${child.exitCode}) before writing an adoption record`)
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  throw new Error(`no completed adoption record at ${recordPath} within ${READY_TIMEOUT_MS}ms`)
}

async function main() {
  if (!fs.existsSync(executable)) {
    fail(`no packaged executable at ${executable} -- build it first (electron-builder --win --dir)`)
    return
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'te-adoption-proof-'))
  const legacy = path.join(root, 'Mission Control')
  const current = path.join(root, 'ToolsEnabled')
  seedLegacyInstall(legacy)

  /* An agent harness or host terminal may export ELECTRON_RUN_AS_NODE=1, which
     turns the Electron binary into plain Node: no window, exit 0, and a
     signature indistinguishable from a crash. See
     tools/test/electron-run-as-node-harness-guard.test.mjs. */
  const environment = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  delete environment.ELECTRON_NO_ATTACH_CONSOLE
  environment.MC_SMOKE_HEADLESS = '1'

  let output = ''
  const child = spawn(executable, [
    `--user-data-dir=${current}`,
    '--disable-gpu',
    '--disable-gpu-sandbox',
  ], {
    cwd: unpackedDirectory,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  child.stdout?.on('data', (chunk) => { output += chunk.toString() })
  child.stderr?.on('data', (chunk) => { output += chunk.toString() })

  try {
    const record = await waitForAdoptionRecord(
      path.join(current, '.userdata-adoption.json'),
      child,
      Date.now() + READY_TIMEOUT_MS,
    )

    if (record.adopted !== true) {
      fail(`the packaged app did not adopt the previous install (reason ${record.reason}). A real customer would see an empty product.`)
      return
    }

    const prefsPath = path.join(current, 'renderer-prefs.json')
    if (!fs.existsSync(prefsPath)) {
      fail('renderer-prefs.json was not carried across; every setting the person chose is gone')
      return
    }
    const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'))
    if (prefs.values?.['mc.theme'] !== PROBE_THEME) {
      fail(`theme did not survive: expected ${PROBE_THEME}, found ${prefs.values?.['mc.theme']}`)
      return
    }

    const notePath = path.join(current, 'workspace', 'notes.md')
    if (!fs.existsSync(notePath) || fs.readFileSync(notePath, 'utf8') !== PROBE_NOTE) {
      fail("the person's workspace did not come across")
      return
    }

    if (fs.existsSync(path.join(current, 'Cache'))) {
      fail("Chromium's cache was copied between installations; only the product's own state should move")
      return
    }

    console.log('[userdata-adoption-proof] PASS: the packaged app adopted the renamed install')
    console.log(`[userdata-adoption-proof]   adopted from: ${path.basename(record.from)}`)
    console.log(`[userdata-adoption-proof]   entries: ${record.entries.join(', ')}`)
  } catch (error) {
    fail(`${error.message}\napp output:\n${output}`)
  } finally {
    await killTree(child)
    await new Promise((resolve) => setTimeout(resolve, 1000))
    try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* temp dir */ }
  }
}

await main()
