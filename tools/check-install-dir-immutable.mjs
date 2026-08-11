#!/usr/bin/env node

/* DOES A SESSION CHANGE THE DIRECTORY THE PROGRAM IS INSTALLED IN?
 *
 * THE DEFECT THIS GATE EXISTS FOR, measured on the real per-user install at
 * %LOCALAPPDATA%\Programs\toolsenabled on 2026-08-11. The packaged app had been
 * installed at 04:47 and run once. By 05:14 its own installation directory
 * contained, written by the running product:
 *
 *     resources/capability/state/mission-bridge-token.json      a live bearer
 *     resources/capability/state/mission-bridge-bootstrap-proof.json
 *     resources/capability/state/mission-bridge-runtime.json
 *     resources/capability/state/owner-public-prompts.json
 *     resources/capability/state/audit.sqlite3{,-wal,-shm}      the signed ledger
 *     resources/capability/logs/actions.{jsonl,log}
 *     resources/capability/vault/secrets.json{,.access.log}     the credentials
 *
 * Each line is a different failure. An UPDATE REPLACES THE INSTALL DIRECTORY,
 * so the customer's vault and audit ledger were living inside the blast radius
 * of the next version. A PER-MACHINE INSTALL puts that directory under Program
 * Files, where the writes fail or demand an elevation this product has no
 * business asking for. And a PROGRAM DIRECTORY IS WORLD-READABLE by default,
 * which is the wrong ACL for a bearer token however carefully each individual
 * file is locked afterwards.
 *
 * WHY THIS IS A HASH OF A DIRECTORY AND NOT AN ASSERTION ABOUT CODE.
 * A test that greps for the right path helper, or that checks the layer CALLS
 * statePath(), cannot see the write that goes around it -- a sqlite sidecar, a
 * lock file, a PowerShell helper resolving its own location, a temp file from a
 * library nobody edited. Source text cannot observe reachability and cannot
 * observe a program it does not contain. The only question that admits no
 * evasion is the customer's: after using this thing, is the directory it was
 * installed to byte-for-byte what the installer put there? So that is the
 * question asked, by sha256 over every file, before and after.
 *
 * IT RUNS THE PAYLOAD IN PLACE. tools/smoke-packaged.mjs deliberately COPIES
 * resources/capability to a temporary directory before starting it, with a
 * comment naming this very defect as the reason ("a smoke run that left those
 * files in release/win-unpacked would make a later check-payload-boundary fail
 * over junk this gate created"). That copy is what kept the defect invisible to
 * the gate that ran nearest it. This one does the opposite on purpose: it
 * starts the shipped payload from exactly where a customer's copy sits.
 *
 * THREE PHASES, because the product is reachable three ways:
 *   A  The MCP entrypoint, started straight out of the install directory by
 *      something that is not our shell and sets no environment at all. This is
 *      the hardest case: nothing tells the payload where the user's data is, so
 *      it has to work it out from the PAYLOAD.json marker at its own root.
 *   B  The GUI, which is how a customer starts it. The Electron shell states
 *      the state root explicitly, and a relocated profile (--user-data-dir)
 *      proves the layer follows the profile rather than a fixed folder.
 *   C  Phase A again, in the SAME profile. Moving the state out of the install
 *      directory is only half the fix; it has to still be there next time. This
 *      phase reads the audit row phase A wrote, through the product's own tool.
 *   D  THE UPGRADE. A customer who already ran a defective build has real data
 *      in the old place -- a vault they filled in, a signed ledger -- and the
 *      next update DELETES that directory. Fixing where new state goes while
 *      silently abandoning the old is not a fix, it is the same data loss with
 *      better paperwork. This phase plants legacy state in a payload copy,
 *      starts it, and requires the data to arrive in the new home.
 *
 * Usage: node tools/check-install-dir-immutable.mjs [unpacked-app-directory]
 */

import { execFile as execFileCallback, spawn as nodeSpawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const require_ = createRequire(import.meta.url)
const { guiEnvironment } = require_(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'shell', 'capability-layer.cjs'))

const APP_EXE = 'ToolsEnabled.exe'
const CAPABILITY_DIRECTORY = path.join('resources', 'capability')
const PAYLOAD_RECORD = 'PAYLOAD.json'
const MCP_ENTRYPOINT_BASENAME = 'mcp-server.js'
const ROUND_TRIP_TOOL = 'system.status'
const AUDIT_TAIL_TOOL = 'audit.tail'
const STATE_ROOT_LEAF = path.join('ToolsEnabled', 'capability')
const REQUEST_TIMEOUT_MS = 120_000
const GUI_TIMEOUT_MS = 90_000

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

/* ---------------------------------------------------------------- hashing */

async function hashTree(root) {
  const files = new Map()
  async function walk(directory) {
    let entries
    try { entries = await readdir(directory, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) { await walk(full); continue }
      if (!entry.isFile()) continue
      const relative = path.relative(root, full).split(path.sep).join('/')
      try {
        files.set(relative, createHash('sha256').update(await readFile(full)).digest('hex'))
      } catch (error) {
        files.set(relative, `UNREADABLE:${error.code || error.message}`)
      }
    }
  }
  await walk(root)
  return files
}

/* Names every difference. A count would be a summary of the set, and the set is
   what a reader has to act on. */
function treeDifferences(before, after) {
  const added = []
  const removed = []
  const changed = []
  for (const [file, digest] of after) {
    if (!before.has(file)) added.push(file)
    else if (before.get(file) !== digest) changed.push(file)
  }
  for (const file of before.keys()) if (!after.has(file)) removed.push(file)
  return { added: added.sort(), removed: removed.sort(), changed: changed.sort() }
}

/* ------------------------------------------------------------ MCP client */

function jsonRpcClient(child, timeoutMs) {
  const pending = new Map()
  let nextId = 1
  let buffered = ''
  child.stdout.on('data', (chunk) => {
    buffered += chunk.toString()
    const lines = buffered.split('\n')
    buffered = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      let message
      try { message = JSON.parse(line) } catch { continue }
      const settle = pending.get(message.id)
      if (settle) { pending.delete(message.id); settle(message) }
    }
  })
  return {
    notify(method, params) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
    },
    request(method, params) {
      const id = nextId
      nextId += 1
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`the capability layer did not answer ${method} within ${timeoutMs}ms`))
        }, timeoutMs)
        pending.set(id, (message) => { clearTimeout(timer); resolve(message) })
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
      })
    },
  }
}

function firstTextContent(result) {
  const block = result?.content?.find((entry) => entry?.type === 'text')
  return typeof block?.text === 'string' ? block.text : null
}

/* A profile that has never seen this project: no checkout to fall back on, no
   existing state anywhere, and -- deliberately -- NO TOOLSENABLED_STATE_ROOT.
   Whatever the payload writes, it decided where on its own. */
function sterileEnvironment(profile) {
  const base = process.env
  return {
    SystemRoot: base.SystemRoot,
    windir: base.windir,
    ComSpec: base.ComSpec,
    PATHEXT: base.PATHEXT,
    NUMBER_OF_PROCESSORS: base.NUMBER_OF_PROCESSORS,
    PROCESSOR_ARCHITECTURE: base.PROCESSOR_ARCHITECTURE,
    Path: [
      path.join(base.SystemRoot || 'C:\\Windows', 'System32'),
      base.SystemRoot || 'C:\\Windows',
      path.join(base.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0'),
    ].join(';'),
    LOCALAPPDATA: profile.localAppData,
    APPDATA: profile.appData,
    USERPROFILE: profile.userProfile,
    CODEX_HOME: profile.codexHome,
    TEMP: profile.temp,
    TMP: profile.temp,
    ELECTRON_RUN_AS_NODE: '1',
  }
}

async function terminateTree(child) {
  if (!child?.pid) return
  try {
    await execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 15_000 })
  } catch {
    try { child.kill() } catch { /* already gone */ }
  }
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(5_000)])
}

/* --------------------------------------------------------------- phase A/C */

async function runPayloadInPlace(executable, capabilityRoot, profile, { label }) {
  let record
  try { record = JSON.parse(await readFile(path.join(capabilityRoot, PAYLOAD_RECORD), 'utf8')) } catch (error) {
    throw new Error(`${label}: ${PAYLOAD_RECORD} is unreadable at ${capabilityRoot} (${error.message}).`)
  }
  const entrypoint = (Array.isArray(record?.entrypoints) ? record.entrypoints : [])
    .find((entry) => path.basename(entry) === MCP_ENTRYPOINT_BASENAME)
  if (!entrypoint) throw new Error(`${label}: the payload declares no ${MCP_ENTRYPOINT_BASENAME} entrypoint.`)

  let stderr = ''
  const child = nodeSpawn(executable, [path.join(capabilityRoot, entrypoint)], {
    cwd: profile.temp,
    env: sterileEnvironment(profile),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  child.stderr?.on('data', (chunk) => { stderr += chunk.toString() })

  try {
    const client = jsonRpcClient(child, REQUEST_TIMEOUT_MS)
    const initialized = await client.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'check-install-dir-immutable', version: '1' },
    })
    if (!initialized.result) {
      throw new Error(`${label}: the payload refused the MCP handshake: ${JSON.stringify(initialized.error)}\n${stderr.trim()}`)
    }
    client.notify('notifications/initialized')

    const called = await client.request('tools/call', { name: ROUND_TRIP_TOOL, arguments: {} })
    if (!called.result || called.result.isError) {
      throw new Error(
        `${label}: ${ROUND_TRIP_TOOL} did not complete: ` +
        `${firstTextContent(called.result) || JSON.stringify(called.error)}\n${stderr.trim()}`,
      )
    }

    const tailed = await client.request('tools/call', { name: AUDIT_TAIL_TOOL, arguments: { limit: 50 } })
    if (!tailed.result || tailed.result.isError) {
      throw new Error(
        `${label}: the audit ledger could not be read: ` +
        `${firstTextContent(tailed.result) || JSON.stringify(tailed.error)}\n${stderr.trim()}`,
      )
    }
    let rows
    try {
      const parsed = JSON.parse(firstTextContent(tailed.result) ?? 'null')
      rows = Array.isArray(parsed) ? parsed : parsed?.entries
    } catch (error) {
      throw new Error(`${label}: the audit ledger returned unparseable content (${error.message}).`)
    }
    if (!Array.isArray(rows)) throw new Error(`${label}: the audit ledger returned no entry list.`)
    return { rows, stderr }
  } finally {
    await terminateTree(child)
  }
}

/* ----------------------------------------------------------------- phase B */

async function runGuiSession(executable, userDataDirectory, stateRoot) {
  /* guiEnvironment(), not a hand-rolled delete. Under an agent harness
     ELECTRON_RUN_AS_NODE is exported as 1, and an Electron binary that
     inherits it starts as plain Node, reads stdin, hits EOF and exits 0 with
     no window -- a silent non-start that reads exactly like a product crash.
     tools/test/electron-run-as-node-harness-guard.test.mjs fails any harness in
     this repo that spawns the app without stripping it, and it names this
     function as the one implementation rather than letting each harness carry
     its own copy. */
  const child = nodeSpawn(executable, [`--user-data-dir=${userDataDirectory}`], {
    env: { ...guiEnvironment(process.env), MC_SMOKE_HEADLESS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let stderr = ''
  child.stderr?.on('data', (chunk) => { stderr += chunk.toString() })
  let stdout = ''
  child.stdout?.on('data', (chunk) => { stdout += chunk.toString() })

  /* Wait for the capability layer to have STARTED, observed the only way that
     is not a guess: the bridge writes its runtime discovery record as soon as
     it is listening. Under the defect this file appeared in the install
     directory; the point of waiting for it HERE is that its arrival at the new
     address is the same event. */
  const runtimeRecord = path.join(stateRoot, 'state', 'mission-bridge-runtime.json')
  const deadline = Date.now() + GUI_TIMEOUT_MS
  let seen = false
  while (Date.now() < deadline) {
    if (existsSync(runtimeRecord)) { seen = true; break }
    if (child.exitCode !== null) break
    await delay(250)
  }
  /* Give the layer a moment past "listening" to do the writes that follow it,
     so the hash comparison covers more than the first millisecond of the boot. */
  if (seen) await delay(3_000)
  await terminateTree(child)
  return { seen, runtimeRecord, stdout, stderr }
}

/* -------------------------------------------------------------------- main */

async function main() {
  const unpacked = path.resolve(process.argv[2] || path.join('release', 'win-unpacked'))
  const executable = path.join(unpacked, APP_EXE)
  const capabilityRoot = path.join(unpacked, CAPABILITY_DIRECTORY)
  for (const required of [executable, path.join(capabilityRoot, PAYLOAD_RECORD)]) {
    if (!existsSync(required)) throw new Error(`Not an unpacked ToolsEnabled build: ${required} is missing.`)
  }

  const scratch = await mkdtemp(path.join(tmpdir(), 'toolsenabled-installdir-'))
  const profile = {
    localAppData: path.join(scratch, 'localappdata'),
    userProfile: path.join(scratch, 'userprofile'),
    codexHome: path.join(scratch, 'codexhome'),
    temp: path.join(scratch, 'temp'),
    appData: path.join(scratch, 'userprofile', 'AppData', 'Roaming'),
  }
  const guiUserData = path.join(scratch, 'gui-userdata')
  for (const value of [...Object.values(profile), guiUserData]) await mkdir(value, { recursive: true })

  const payloadStateRoot = path.join(profile.appData, STATE_ROOT_LEAF)
  const guiStateRoot = path.join(guiUserData, 'capability')

  console.log(`install directory: ${unpacked}`)
  const before = await hashTree(unpacked)
  console.log(`hashed ${before.size} file(s) before the session`)

  const failures = []
  try {
    // ---- phase A: the payload, in place, told nothing.
    const first = await runPayloadInPlace(executable, capabilityRoot, profile, { label: 'phase A (payload in place)' })
    const landed = first.rows.find((row) => row?.target === ROUND_TRIP_TOOL && String(row?.action || '').startsWith('mcp.tool.'))
    if (!landed) failures.push(`phase A: ${ROUND_TRIP_TOOL} succeeded but landed no audit row, so this phase proved nothing about where state goes.`)
    console.log(`phase A: ${ROUND_TRIP_TOOL} round-tripped and the ledger holds ${first.rows.length} row(s)`)

    if (!existsSync(path.join(payloadStateRoot, 'state', 'audit.sqlite3'))) {
      failures.push(
        `phase A: no audit ledger at ${path.join(payloadStateRoot, 'state', 'audit.sqlite3')}. ` +
        'The payload either wrote it somewhere else or did not write it at all; either way the per-user state root is not being used.',
      )
    } else {
      console.log(`phase A: state landed under ${payloadStateRoot}`)
    }

    // ---- phase B: the GUI, with a relocated profile.
    const gui = await runGuiSession(executable, guiUserData, guiStateRoot)
    if (!gui.seen) {
      failures.push(
        `phase B: the capability layer never wrote ${gui.runtimeRecord} within ${GUI_TIMEOUT_MS}ms. ` +
        `Either it did not start, or it wrote its runtime record somewhere else.\n${gui.stderr.trim().slice(-2000)}`,
      )
    } else {
      console.log(`phase B: the GUI's capability layer wrote its runtime record under ${guiStateRoot}`)
    }

    // ---- phase D: an upgrade from a build that had the defect.
    const legacyProfile = {
      localAppData: path.join(scratch, 'legacy', 'localappdata'),
      userProfile: path.join(scratch, 'legacy', 'userprofile'),
      codexHome: path.join(scratch, 'legacy', 'codexhome'),
      temp: path.join(scratch, 'legacy', 'temp'),
      appData: path.join(scratch, 'legacy', 'userprofile', 'AppData', 'Roaming'),
    }
    for (const value of Object.values(legacyProfile)) await mkdir(value, { recursive: true })
    /* A payload copy stands in for the old install: it carries PAYLOAD.json, so
       the running code cannot tell it from one, and copying 5 MB rather than the
       whole 1 GB application keeps this phase affordable enough to actually run
       in the pipeline. */
    const legacyInstall = path.join(scratch, 'legacy-install', 'capability')
    await cp(capabilityRoot, legacyInstall, { recursive: true })
    /* MARKER FILES, NOT REAL ONES, AND THAT IS THE POINT. Planting a fake
       vault/secrets.json tests what the vault does with a corrupt file, not
       whether the directory was carried across -- the product opened it,
       could not read it, and wrote a real one over the top, so the assertion
       failed for a reason that had nothing to do with migration. A file the
       product never touches isolates the one question this phase asks: did
       each runtime directory move, byte for byte. */
    const planted = [
      { file: path.join(legacyInstall, 'vault', 'legacy-marker.json'), body: '{"legacy-vault-marker":"phase-d"}\n' },
      { file: path.join(legacyInstall, 'reports', 'legacy-marker.json'), body: '{"legacy-reports-marker":"phase-d"}\n' },
      { file: path.join(legacyInstall, 'state', 'legacy-marker.json'), body: '{"legacy-state-marker":"phase-d"}\n' },
      { file: path.join(legacyInstall, 'logs', 'legacy-marker.log'), body: 'legacy-logs-marker phase-d\n' },
    ]
    for (const entry of planted) {
      await mkdir(path.dirname(entry.file), { recursive: true })
      await writeFile(entry.file, entry.body, 'utf8')
    }
    const legacyBefore = await hashTree(legacyInstall)
    await runPayloadInPlace(executable, legacyInstall, legacyProfile, { label: 'phase D (upgrade)' })

    const adoptedRoot = path.join(legacyProfile.appData, STATE_ROOT_LEAF)
    const stranded = []
    for (const entry of planted) {
      const relative = path.relative(legacyInstall, entry.file)
      const carried = path.join(adoptedRoot, relative)
      if (!existsSync(carried)) { stranded.push(relative.split(path.sep).join('/')); continue }
      if (await readFile(carried, 'utf8') !== entry.body) stranded.push(`${relative.split(path.sep).join('/')} (contents differ)`)
    }
    if (stranded.length) {
      failures.push(
        `phase D: an upgrade stranded the previous install's data. Not carried into ${adoptedRoot}:\n  ${stranded.join('\n  ')}\n` +
        'The next update deletes the old directory, so this is the only chance to move it and these files would simply be gone.',
      )
    } else {
      console.log(`phase D: an existing install's vault, ledger and state were carried into ${adoptedRoot}`)
    }
    const legacyDifferences = treeDifferences(legacyBefore, await hashTree(legacyInstall))
    if (legacyDifferences.added.length || legacyDifferences.removed.length || legacyDifferences.changed.length) {
      failures.push(
        'phase D: adopting the previous install\'s data MODIFIED the old install directory. The migration must read ' +
        'and copy only -- deleting the legacy copy is itself a write to a program directory, and one of these files ' +
        `is audit history.\nADDED: ${legacyDifferences.added.join(', ') || 'none'}\n` +
        `CHANGED: ${legacyDifferences.changed.join(', ') || 'none'}\nREMOVED: ${legacyDifferences.removed.join(', ') || 'none'}`,
      )
    }

    // ---- phase C: the state is still there next time.
    const second = await runPayloadInPlace(executable, capabilityRoot, profile, { label: 'phase C (relaunch)' })
    const survived = second.rows.filter((row) => row?.target === ROUND_TRIP_TOOL && String(row?.action || '').startsWith('mcp.tool.'))
    if (survived.length < 2) {
      failures.push(
        `phase C: after a relaunch the ledger holds ${survived.length} ${ROUND_TRIP_TOOL} row(s), expected at least 2 ` +
        '(one from phase A, one from this phase). Moving state out of the install directory is only half the fix; ' +
        'a state root the product cannot find again next time is the same data loss by another route.',
      )
    } else {
      console.log(`phase C: ${survived.length} ${ROUND_TRIP_TOOL} row(s) in the ledger — phase A's row survived the relaunch`)
    }
  } finally {
    const after = await hashTree(unpacked)
    const { added, removed, changed } = treeDifferences(before, after)
    if (added.length || removed.length || changed.length) {
      const detail = [
        added.length ? `ADDED (${added.length}):\n  ${added.join('\n  ')}` : null,
        changed.length ? `CHANGED (${changed.length}):\n  ${changed.join('\n  ')}` : null,
        removed.length ? `REMOVED (${removed.length}):\n  ${removed.join('\n  ')}` : null,
      ].filter(Boolean).join('\n')
      failures.unshift(
        'THE INSTALL DIRECTORY CHANGED DURING A SESSION. A customer\'s next update deletes this directory, ' +
        'and a per-machine install makes it unwritable, so anything the product puts here is both lost and ' +
        `unable to be written in the first place on a normal deployment.\n${detail}`,
      )
    } else {
      console.log(`the install directory is byte-unchanged after the session (${after.size} file(s) re-hashed)`)
    }
    await rm(scratch, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }).catch(() => {})

    if (failures.length) {
      console.error(`\ninstall-directory state check FAILED (${failures.length}):\n`)
      for (const failure of failures) console.error(`- ${failure}\n`)
      process.exitCode = 1
      return
    }
    console.log('\ninstall-directory state check: clean.')
  }
}

main().catch((error) => {
  console.error(`install-directory state check could not run: ${error.message}`)
  process.exitCode = 1
})
