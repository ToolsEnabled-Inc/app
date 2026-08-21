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
 *      WHAT PHASE D DOES NOT PROVE, SAID HERE BECAUSE THE PHASE IS NAMED AFTER
 *      IT. It proves the rescue WORKS when the old directory is still there. On
 *      a real NSIS upgrade it is not: node_modules/app-builder-lib/templates/
 *      nsis/include/installUtil.nsh:224 has the new installer run the OLD
 *      uninstaller first, and templates/nsis/uninstaller.nsh:187 is
 *      `RMDir /r $INSTDIR`. The install directory is therefore gone before the
 *      new build's first line executes, so adoptLegacyPayloadState() finds
 *      nothing to adopt and answers 'nothing-to-adopt'. Rescuing that data has
 *      to happen from the INSTALLER (a customInit hook in build/installer.nsh,
 *      which runs before UNINSTALL_PREVIOUS), not from the application. The one
 *      thing the same templates DO guarantee is that userData survives: the
 *      uninstaller is invoked with /KEEP_APP_DATA --updated, and this build
 *      does not set deleteAppDataOnUninstall.
 *   E  THE HALF OF THE PRODUCT THAT IS NOT JAVASCRIPT. A-D all exercise Node,
 *      and Node was already right. The PowerShell helpers are separate programs
 *      that resolve their own directories from $PSScriptRoot, and three of them
 *      were still doing it while every phase above was green. This phase makes
 *      one of them run.
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
/* THE CHEAPEST TOOL THAT MAKES A HELPER PROGRAM RESOLVE A RUNTIME DIRECTORY AND
 * THEN SAY WHERE IT LANDED. Every other phase exercises JavaScript only, which
 * is how three PowerShell helpers stayed defective under a green hash.
 *
 * screen.capture was the obvious choice and is the wrong one: its effect is
 * 'local-write', and a payload started with no setup record runs at the
 * read-only tier, which refuses every write-effect tool. It failed identically
 * on a fixed and a defective payload -- a gate that is red either way. This one
 * is 'local-read', so the tier permits it; it needs no interactive desktop and
 * no browser installed; and it RETURNS the resolved profile directory, so the
 * assertion is on the helper's own answer rather than on a side effect. */
const HELPER_PROBE_TOOL = 'browser.status'
const STATE_ROOT_LEAF = path.join('ToolsEnabled', 'capability')
const REQUEST_TIMEOUT_MS = 120_000
const GUI_TIMEOUT_MS = 90_000

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

/* ------------------------------------------------- phase 0: what did not run
 *
 * THE HASH IS THE REAL ASSERTION, AND IT HAS ONE BLIND SPOT: it can only see
 * what the session executed. A tool nobody called in these four phases -- a
 * screen capture writing to captures/, a browser profile under profiles/, an
 * agent lane writing a console log -- could still be resolving its path against
 * the program directory, and the run would come back clean.
 *
 * So this phase reads the shipped payload's source for the one shape that
 * causes it: a mutable top-level directory joined onto a root that is not the
 * state root. It is explicitly the WEAKER of the two checks -- source text
 * cannot see reachability, and dead code greps identically to live code -- and
 * it exists only to cover what a single session does not reach. Neither check
 * substitutes for the other, which is why both run.
 *
 * MEASURED WORTH: this found eight leaks the four behavioural phases missed --
 * extension packaging into logs/, the agent launch/mailbox/presence records,
 * the multi-account state file, the lane console logs, the state database read
 * path, and the owner request ledger in two tools. Every one of them would have
 * shipped behind a green hash.
 *
 * WHAT IT STILL CANNOT SEE, said plainly rather than left for someone to
 * discover: a root computed inside a function and passed along as a parameter.
 * src/lib/providers/model.js has exactly that shape. Rules that chase it start
 * flagging genuinely caller-supplied roots -- the supervised project's
 * directory, another worktree's -- which are not this defect and whose false
 * positives would get the whole check disabled. The hash is what covers that
 * case, for anything a session executes. */
const RUNTIME_STATE_DIRECTORIES = ['state', 'logs', 'vault', 'captures', 'profiles', 'reports']

/* WHAT THE SWEEP LOOKS FOR IS "DERIVED FROM WHERE THE CODE LIVES", NOT "any
 * identifier". The first version of this flagged every `path.join(x, 'state')`
 * and reported two false positives that taught the real rule:
 * fleet-supervisor's defaultStateFile(repoRoot) is handed the SUPERVISED
 * PROJECT's root, and model.js's commonWorktreeRoot() is deliberately another
 * worktree's directory. Neither is this defect: a caller-supplied root is the
 * caller's question. The defect is a path resolved from the MODULE'S OWN
 * LOCATION, because that is the one thing that becomes the install directory
 * when the code is packaged.
 *
 * So each file is read for the identifiers it assigns from a __dirname
 * expression -- whatever they are named, since ROOT, REPO_ROOT, MODULE_ROOT and
 * DEFAULT_ROOT all appear in this codebase and the next one will be named
 * something else -- and only joins onto those (or onto __dirname directly) are
 * reported. */
const MODULE_ROOT_ASSIGNMENT = /(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*path\.(?:resolve|join)\(\s*__dirname/g
/* A module root can also arrive by import: src/lib/providers/extension.js does
   `const { ROOT, ... } = require('../runtime')` and then joins 'logs' onto it.
   That is the same defect wearing a different hat, and the first version of this
   sweep could not see it -- measured, against the pre-fix payload, where it
   found 18 of the 19 sites and missed exactly that one. */
const IMPORTED_ROOT_NAMES = /^(?:ROOT|REPO_ROOT|MODULE_ROOT|PROGRAM_ROOT|DEFAULT_ROOT|REPOSITORY_ROOT)$/
const DESTRUCTURED_REQUIRE = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(/g
const DIRNAME_STATE_JOIN = new RegExp(
  String.raw`path\.(?:join|resolve)\(\s*__dirname\s*(?:,\s*'\.\.'\s*)*,\s*'(?:${RUNTIME_STATE_DIRECTORIES.join('|')})'`,
  'g',
)

/* The resolver itself compares a candidate against the unredirected path, so it
   necessarily contains the shape it forbids. It is the one place allowed to. */
const STATE_ROOT_RESOLVER = new Set(['src/lib/runtime-state-root.js', 'src/lib/runtime.js'])

function moduleRootIdentifiers(text) {
  const names = new Set()
  for (const match of text.matchAll(MODULE_ROOT_ASSIGNMENT)) names.add(match[1])
  for (const match of text.matchAll(DESTRUCTURED_REQUIRE)) {
    for (const part of match[1].split(',')) {
      const name = part.split(':').pop().trim()
      if (IMPORTED_ROOT_NAMES.test(name)) names.add(name)
    }
  }
  return names
}

async function sweepPayloadSource(capabilityRoot) {
  const findings = []
  async function walk(directory) {
    let entries
    try { entries = await readdir(directory, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) { await walk(full); continue }
      if (!entry.isFile() || !entry.name.endsWith('.js')) continue
      const relative = path.relative(capabilityRoot, full).split(path.sep).join('/')
      if (STATE_ROOT_RESOLVER.has(relative)) continue
      let text
      try { text = await readFile(full, 'utf8') } catch { continue }

      const report = (index, matched) => {
        findings.push(`${relative}:${text.slice(0, index).split('\n').length}  ${matched.replace(/\s+/g, ' ')}`)
      }
      for (const match of text.matchAll(DIRNAME_STATE_JOIN)) report(match.index, match[0])
      const roots = moduleRootIdentifiers(text)
      if (roots.size === 0) continue
      const joinOntoModuleRoot = new RegExp(
        String.raw`path\.(?:join|resolve)\(\s*(?:${[...roots].join('|')})\s*,\s*'(?:${RUNTIME_STATE_DIRECTORIES.join('|')})'`,
        'g',
      )
      for (const match of text.matchAll(joinOntoModuleRoot)) report(match.index, match[0])
    }
  }
  await walk(capabilityRoot)
  return findings.sort()
}

/* THE SAME QUESTION, ASKED OF THE PROGRAMS THAT ARE NOT JAVASCRIPT.
 *
 * The sweep above reads `.js` and nothing else. The comment at the top of this
 * file names "a PowerShell helper resolving its own location" as a shape only
 * the hash could catch -- and it was right that the hash was the only thing
 * looking, because the static check was not. The behavioural phases only see a
 * helper the session actually spawns, and none of them spawn one.
 *
 * MEASURED, on this payload, with every phase above green: three shipped
 * helpers resolved a runtime directory from $PSScriptRoot --
 * tools/desktop.ps1 (captures/), tools/browser.ps1 (profiles/) and
 * tools/owner-prompt-queue.ps1 (state/). The first was reproduced end to end:
 * it created captures/ inside the program directory and THEN rejected the
 * per-user path Node had passed it, so a screen capture both wrote where it
 * must not and failed.
 *
 * WHY THE RULE IS "CONSULTS THE VARIABLE" AND NOT "NEVER JOINS ONTO ITSELF".
 * tools/secrets.ps1 does both -- it reads TOOLSENABLED_STATE_ROOT and keeps a
 * <repo> fallback, because a source checkout still has to work. The fallback is
 * correct and unavoidable, so its presence proves nothing in either direction.
 * What separates secrets.ps1 from the three above is that it ASKS. So that is
 * what is checked, and src/lib/runtime.js publishes the answer into the
 * environment of every helper spawn precisely so that asking is possible.
 *
 * This is the WEAKER of the two checks and does not replace the hash: it proves
 * the variable is consulted, not that it is consulted correctly. Correctness is
 * the hash's job, which is why phase E now spawns a real capture. */
const HELPER_PROGRAM_EXTENSIONS = new Set(['.ps1', '.cmd', '.bat', '.py'])
const STATE_ROOT_ENV = 'TOOLSENABLED_STATE_ROOT'
/* Where a helper program can learn its own location, per language. */
const SCRIPT_LOCATION_ANCHOR = /\$PSScriptRoot|\$MyInvocation|%~dp0|__file__/i
/* A quoted runtime-state directory, alone or as the head of a longer path --
   browser.ps1 spells it 'profiles\chrome'. */
const QUOTED_STATE_DIRECTORY = new RegExp(
  String.raw`(['"])(?:${RUNTIME_STATE_DIRECTORIES.join('|')})(?:[\\/][^'"]*)?\1`,
  'gi',
)

async function sweepHelperPrograms(capabilityRoot) {
  const findings = []
  async function walk(directory) {
    let entries
    try { entries = await readdir(directory, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) { await walk(full); continue }
      if (!entry.isFile()) continue
      if (!HELPER_PROGRAM_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue
      let text
      try { text = await readFile(full, 'utf8') } catch { continue }
      /* A helper that never asks where it is cannot resolve anything against
         the install directory, whatever else it names. */
      if (!SCRIPT_LOCATION_ANCHOR.test(text)) continue
      if (text.includes(STATE_ROOT_ENV)) continue
      const relative = path.relative(capabilityRoot, full).split(path.sep).join('/')
      for (const match of text.matchAll(QUOTED_STATE_DIRECTORY)) {
        findings.push(`${relative}:${text.slice(0, match.index).split('\n').length}  ${match[0]}`)
      }
    }
  }
  await walk(capabilityRoot)
  return findings.sort()
}

/* ---------------------------------------------------------------- hashing */

/* DIRECTORIES ARE ENTRIES TOO, AND THAT IS NOT PEDANTRY.
 *
 * This walked files only, and it cost a real detection: with the defective
 * tools/desktop.ps1 in place, the helper created captures/ in the install
 * directory and then threw before writing the PNG into it. An EMPTY directory
 * has no files, so the tree came back "byte-unchanged" while the program had
 * just made a directory inside its own installation. A per-machine install
 * fails on that mkdir exactly as it fails on a write, so it is the same defect
 * and it must be the same finding. */
async function hashTree(root) {
  const files = new Map()
  async function walk(directory) {
    let entries
    try { entries = await readdir(directory, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        files.set(`${path.relative(root, full).split(path.sep).join('/')}/`, 'DIRECTORY')
        await walk(full)
        continue
      }
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

async function runPayloadInPlace(executable, capabilityRoot, profile, { label, probeHelper = false }) {
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

    /* Requested only by phase E; see there for what it proves. */
    let probed = null
    if (probeHelper) {
      const asked = await client.request('tools/call', { name: HELPER_PROBE_TOOL, arguments: {} })
      if (!asked.result) throw new Error(`${label}: ${HELPER_PROBE_TOOL} returned no result: ${JSON.stringify(asked.error)}`)
      probed = { isError: Boolean(asked.result.isError), text: firstTextContent(asked.result) }
    }
    return { rows, stderr, probed }
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
  console.log(`hashed ${before.size} entr(y|ies) — files and directories — before the session`)

  const failures = []
  try {
    // ---- phase 0: the writers this session will not execute.
    const sweep = await sweepPayloadSource(capabilityRoot)
    if (sweep.length) {
      failures.push(
        `phase 0: ${sweep.length} place(s) in the shipped payload still join a runtime-state directory onto a ` +
        'root that is not the state root. The behavioural phases below cannot see these unless the session ' +
        'happens to execute them, which is exactly how they get shipped. Route each through statePath() or ' +
        `programOrStatePath() in src/lib/runtime-state-root.js:\n  ${sweep.join('\n  ')}`,
      )
    } else {
      console.log('phase 0: no payload source joins a runtime-state directory onto the program root')
    }

    const helperSweep = await sweepHelperPrograms(capabilityRoot)
    if (helperSweep.length) {
      failures.push(
        `phase 0: ${helperSweep.length} place(s) in a shipped HELPER PROGRAM name a runtime-state directory, in a ` +
        `file that resolves its own location and never reads ${STATE_ROOT_ENV}. A helper that derives a writable ` +
        'directory from $PSScriptRoot writes into the INSTALL directory, and disagrees with the per-user path the ' +
        'JavaScript half passes it -- which is a capture that both writes where it must not and then fails. Follow ' +
        `tools/secrets.ps1: read ${STATE_ROOT_ENV} first, keep the <repo> fallback for a source checkout:\n  ` +
        helperSweep.join('\n  '),
      )
    } else {
      console.log('phase 0: every shipped helper program that resolves its own location consults the state root')
    }

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

    /* ---- phase E: a HELPER PROGRAM, in the case that tells it nothing.
     *
     * Phases A-D exercise JavaScript, and the JavaScript was already right. The
     * product's other half is a set of PowerShell helpers, which are separate
     * PROGRAMS: they resolve their own directories from $PSScriptRoot, which
     * packaged is the install directory, and no amount of JavaScript being
     * correct changes what they do. Measured on this payload with every phase
     * above green, tools/desktop.ps1 created captures/ inside the program
     * directory and then refused the per-user path Node had passed it -- so
     * screen capture wrote where it must not AND failed, invisibly to this gate.
     *
     * IT RUNS IN THE STERILE PROFILE, so nothing sets TOOLSENABLED_STATE_ROOT.
     * That makes it the only phase that proves the whole chain rather than one
     * link: the payload derives its state root from the PAYLOAD.json marker,
     * src/lib/runtime.js publishes it into the environment, and the helper reads
     * it back. A check that set the variable itself would prove none of that.
     *
     * AN UNAVAILABLE DESKTOP IS A PASS, AND IS NOT A HOLE. A locked, headless or
     * service session has no interactive desktop and the helper says so. What is
     * asserted here is that the two programs AGREE on a directory, and a
     * disagreement cannot present as "unavailable": the helper validates the
     * path before it touches the screen, so disagreement is an error. */
    /* ITS OWN PROFILE, FOR A REASON WORTH WRITING DOWN. Run in phase A's
       profile, this phase failed on "the audit ledger could not be opened" --
       phase C's process had only just been killed and still held the sqlite
       file, so a check about PowerShell was reporting a transient sqlite lock.
       A red gate that names the wrong thing is worse than no gate: it teaches
       people to re-run until it passes. A fresh profile has its own ledger and
       cannot contend with anything, and phase E loses nothing by it -- what it
       proves is the derive/publish/read chain, which is per-profile anyway. */
    const helperProfile = {
      localAppData: path.join(scratch, 'helper', 'localappdata'),
      userProfile: path.join(scratch, 'helper', 'userprofile'),
      codexHome: path.join(scratch, 'helper', 'codexhome'),
      temp: path.join(scratch, 'helper', 'temp'),
      appData: path.join(scratch, 'helper', 'userprofile', 'AppData', 'Roaming'),
    }
    for (const value of Object.values(helperProfile)) await mkdir(value, { recursive: true })
    const helperStateRoot = path.join(helperProfile.appData, STATE_ROOT_LEAF)
    const helperRun = await runPayloadInPlace(executable, capabilityRoot, helperProfile, { label: 'phase E (helper program)', probeHelper: true })
    const probed = helperRun.probed
    let reported = null
    if (!probed || probed.isError) {
      failures.push(
        `phase E: ${HELPER_PROBE_TOOL} did not complete, so nothing was learned about where a helper program ` +
        `resolves its directories.\n${probed ? probed.text : 'no result'}`,
      )
    } else {
      try { reported = JSON.parse(probed.text ?? 'null')?.profile ?? null } catch { /* reported just below */ }
      if (typeof reported !== 'string' || !reported) {
        failures.push(`phase E: ${HELPER_PROBE_TOOL} named no profile directory, so this phase proved nothing.`)
      } else if (!path.relative(unpacked, path.resolve(reported)).startsWith('..')) {
        /* THE DEFECT, STATED AS THE CUSTOMER MEETS IT. The helper resolved a
           directory it intends to use INSIDE the program's own installation. */
        failures.push(
          `phase E: a helper program resolved its profile directory to ${reported}, which is INSIDE the install ` +
          `directory ${unpacked}. It is deriving that path from its own location instead of reading ` +
          `${STATE_ROOT_ENV}, so it will write where the next update deletes and a per-machine install forbids. ` +
          'Follow the ladder in tools/secrets.ps1.',
        )
      } else if (path.relative(helperStateRoot, path.resolve(reported)).startsWith('..')) {
        failures.push(
          `phase E: a helper program resolved its profile directory to ${reported}, which is outside this run's ` +
          `per-user state root ${helperStateRoot}. The JavaScript half and the helper disagree about where the ` +
          'product keeps its data.',
        )
      } else {
        console.log(`phase E: a PowerShell helper independently resolved its directory under ${helperStateRoot}`)
      }
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
      console.log(`the install directory is byte-unchanged after the session (${after.size} entr(y|ies) re-hashed)`)
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
