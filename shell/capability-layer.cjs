'use strict'

/* Starts the half of the product that is not the viewer.
 *
 * ToolsEnabled discovers an action bridge on 127.0.0.1:4610-4619 and, until
 * now, something else had to have started it -- in practice a developer, by
 * hand, out of a checkout. On a customer's machine nothing did, so discovery
 * found nothing and every write action answered BRIDGE_UNREACHABLE. This module
 * is the missing supervisor: the installed app starts its own capability layer
 * from its own resources.
 *
 * THE RUNTIME QUESTION, ANSWERED WITHOUT SHIPPING A SECOND RUNTIME.
 * The capability layer is Node code, and the obvious reading of "package the
 * capability layer" is "bundle a Node runtime too", which is another ~50 MB to
 * ship, sign and update. It is unnecessary: the Electron binary already IS a
 * Node runtime, and setting ELECTRON_RUN_AS_NODE=1 makes it behave as one. So
 * the layer runs on process.execPath -- the same executable the user launched.
 *
 * That variable is load-bearing in BOTH directions, which is why it is set
 * explicitly here and deleted explicitly below. Set, it gives the child a Node.
 * Inherited by the GUI process, it turns Electron into a headless Node that
 * exits 0 with no output and no window -- the "silent exit" that cost this
 * project two wrong root causes in one day. A supervisor that spawns Node from
 * a GUI app touches both edges of that trap, so neither is left to chance:
 * the child gets the variable, and nothing else inherits it.
 */

const { spawn: nodeSpawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const PAYLOAD_RECORD = 'PAYLOAD.json'
const START_TIMEOUT_MS = 30_000
const STOP_TIMEOUT_MS = 5_000

function failure(code, reason) {
  return { ok: false, code, reason }
}

/* Where the payload lives. Packaged, electron-builder places extraResources
 * beside app.asar under resources/. In a checkout it is the staging directory
 * `npm run pack:capability` writes. Both are asked for by existence, not
 * assumed from a flag, so a packaged build with a missing payload reports that
 * plainly instead of silently resolving a path that is not there. */
function resolveCapabilityRoot({
  resourcesPath = process.resourcesPath,
  repoRoot = path.join(__dirname, '..'),
  exists = fs.existsSync,
} = {}) {
  const candidates = []
  if (typeof resourcesPath === 'string' && resourcesPath) candidates.push(path.join(resourcesPath, 'capability'))
  candidates.push(path.join(repoRoot, 'capability'))
  const found = candidates.find((candidate) => exists(path.join(candidate, PAYLOAD_RECORD)))
  return found || null
}

function readPayloadRecord(root, { readFileSync = fs.readFileSync } = {}) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(path.join(root, PAYLOAD_RECORD), 'utf8'))
  } catch (error) {
    return failure('CAPABILITY_PAYLOAD_UNREADABLE', `The capability payload record could not be read: ${error.message}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return failure('CAPABILITY_PAYLOAD_INVALID', 'The capability payload record is not an object.')
  }
  if (typeof parsed.bridgeEntrypoint !== 'string' || !parsed.bridgeEntrypoint) {
    return failure('CAPABILITY_PAYLOAD_INVALID', 'The capability payload record names no bridge entrypoint.')
  }
  return { ok: true, record: parsed }
}

/* The environment handed to the capability layer. Explicitly constructed
 * rather than spread-and-patched so that what the child gets is readable in
 * one place. */
function childEnvironment(base) {
  const environment = { ...base }
  environment.ELECTRON_RUN_AS_NODE = '1'
  delete environment.ELECTRON_NO_ATTACH_CONSOLE
  return environment
}

/* Strip the Node-mode variable from an environment that is about to launch a
 * GUI Electron process. Exported because the acceptance harness needs exactly
 * this and must not reimplement it from memory. */
function guiEnvironment(base = process.env) {
  const environment = { ...base }
  delete environment.ELECTRON_RUN_AS_NODE
  delete environment.ELECTRON_NO_ATTACH_CONSOLE
  return environment
}

/* The bridge prints one JSON line on stdout when it is listening, and that
 * line carries the port it actually bound and the path to this boot's
 * bootstrap proof. Both are needed and neither is guessable: the port is
 * chosen from a range at runtime, and the proof is a fresh secret per boot. */
function startCapabilityLayer({
  root,
  origin,
  workspaceRoot,
  execPath = process.execPath,
  spawn = nodeSpawn,
  env = process.env,
  timeoutMs = START_TIMEOUT_MS,
} = {}) {
  if (!root) {
    return Promise.resolve(failure(
      'CAPABILITY_PAYLOAD_ABSENT',
      'No capability payload is present. A build that ships the viewer alone cannot reach its own capability layer; run `npm run pack:capability` before packaging.',
    ))
  }
  const payload = readPayloadRecord(root)
  if (!payload.ok) return Promise.resolve(payload)

  const entry = path.join(root, payload.record.bridgeEntrypoint)
  if (!fs.existsSync(entry)) {
    return Promise.resolve(failure('CAPABILITY_ENTRYPOINT_ABSENT', `The capability payload names ${payload.record.bridgeEntrypoint}, which is not in the payload.`))
  }

  const args = [entry, '--origin', origin, '--root', `main=${workspaceRoot}`]
  let child
  try {
    child = spawn(execPath, args, { env: childEnvironment(env), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    return Promise.resolve(failure('CAPABILITY_SPAWN_FAILED', `The capability layer could not be started: ${error.message}`))
  }

  return new Promise((resolve) => {
    let settled = false
    let stdout = ''
    let stderr = ''

    const settle = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    const timer = setTimeout(() => {
      try { child.kill() } catch { /* the timeout result is authoritative */ }
      settle(failure('CAPABILITY_START_TIMEOUT', `The capability layer did not report a listening address within ${timeoutMs}ms.`))
    }, timeoutMs)

    child.stdout.on('data', (chunk) => {
      if (settled) return
      stdout += chunk
      const newline = stdout.indexOf('\n')
      if (newline === -1) return
      let announced
      try { announced = JSON.parse(stdout.slice(0, newline)) } catch {
        return settle(failure('CAPABILITY_START_UNREADABLE', 'The capability layer printed a startup line that is not JSON.'))
      }
      if (announced?.ok !== true || typeof announced.baseUrl !== 'string') {
        return settle(failure(announced?.code || 'CAPABILITY_START_REFUSED', announced?.message || 'The capability layer refused to start.'))
      }
      settle({
        ok: true,
        baseUrl: announced.baseUrl,
        port: announced.port,
        pid: announced.pid,
        bootstrapProofFile: announced.bootstrapProofFile,
        child,
      })
    })

    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => settle(failure('CAPABILITY_SPAWN_FAILED', `The capability layer could not be started: ${error.message}`)))
    child.on('exit', (code) => settle(failure(
      'CAPABILITY_EXITED',
      `The capability layer exited with code ${code} before reporting an address.${stderr ? ` ${stderr.trim().split('\n').slice(-3).join(' ')}` : ''}`,
    )))
  })
}

/* The bootstrap proof is a per-boot secret the bridge writes to an owner-ACL'd
 * file; the renderer cannot read files, so the shell reads it and hands it
 * over. Read on demand rather than cached at startup: the file is rewritten
 * whenever the layer restarts, and a cached value would authorize nothing
 * while looking exactly like a value that should work. */
function readCapabilityProof(bootstrapProofFile, { readFileSync = fs.readFileSync } = {}) {
  if (typeof bootstrapProofFile !== 'string' || !bootstrapProofFile) {
    return failure('CAPABILITY_PROOF_UNAVAILABLE', 'The capability layer reported no bootstrap proof file.')
  }
  let record
  try {
    record = JSON.parse(readFileSync(bootstrapProofFile, 'utf8'))
  } catch (error) {
    return failure('CAPABILITY_PROOF_UNAVAILABLE', `The capability layer bootstrap proof could not be read: ${error.message}`)
  }
  if (!record || typeof record.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(record.token)) {
    return failure('CAPABILITY_PROOF_INVALID', 'The capability layer bootstrap proof file is malformed.')
  }
  return { ok: true, proof: record.token }
}

function stopCapabilityLayer(child, { timeoutMs = STOP_TIMEOUT_MS } = {}) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* best effort */ }
      resolve()
    }, timeoutMs)
    child.once('exit', () => { clearTimeout(timer); resolve() })
    try { child.kill() } catch { clearTimeout(timer); resolve() }
  })
}

module.exports = {
  PAYLOAD_RECORD,
  START_TIMEOUT_MS,
  childEnvironment,
  guiEnvironment,
  readCapabilityProof,
  readPayloadRecord,
  resolveCapabilityRoot,
  startCapabilityLayer,
  stopCapabilityLayer,
}
