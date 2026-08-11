import { execFile as execFileCallback, spawn as nodeSpawn } from 'node:child_process'
import { access, cp, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

export const APP_EXE = 'Mission Control.exe'
export const APP_MARKER = '<title>Mission Control</title>'
export const DEFAULT_PORTS = Object.freeze(Array.from({ length: 9 }, (_, index) => 4601 + index))

/* WHAT THIS FILE ASSERTS, AND WHY THAT CHANGED.
 *
 * Until now it asserted that a window bound a port and served a title. Both
 * were true of a build in which 87-ish tools could not read a credential, the
 * signed audit ledger the privacy policy promises in writing was never written,
 * and the vault program itself -- tools/secrets.ps1, 57 KB, the single most
 * load-bearing file in the product -- was in no installer at all. The gate was
 * green for every one of those days, because a viewer with nothing behind it
 * still opens a window.
 *
 * So the gate now asks the only question that could have caught it: does a REAL
 * TOOL CALL ROUND-TRIP, AND DOES IT LAND AN AUDIT ROW.
 *
 * Those are one question, not two, and the coupling is what makes this cheap.
 * src/lib/audit.js fetches its Ed25519 signing key out of the vault, and the
 * vault is reached by spawning tools/secrets.ps1. A payload missing that script
 * therefore CANNOT sign an audit row -- measured, in a sterile payload:
 * "ToolsEnabled canonical audit failed: The audit signing key cannot be read in
 * this Windows identity or vault context." One assertion covers the vault, the
 * credential path, the audit ledger, and every helper those two drag in.
 *
 * And note what the same measurement showed about the tool call: system.status
 * still RETURNED SUCCESSFULLY with the audit write failing on stderr. A gate
 * that only checked the round-trip would have stayed green too. The audit row
 * is not a nice-to-have second assertion; it is the one that fails.
 *
 * IT RUNS FROM A COPY, IN A STERILE PROFILE. The payload is copied out of
 * resources/capability into a temporary directory whose LOCALAPPDATA,
 * USERPROFILE and CODEX_HOME point at empty directories, because that -- per
 * tools/capability-manifest.json's own comment -- is how this class of defect is
 * found: "by starting the staged payload in a directory with no checkout and
 * reading what it failed on". The copy is deliberate rather than incidental:
 * the layer writes state/ next to itself, config/payload-boundary.json declares
 * state/ excluded from any payload, and a smoke run that left those files in
 * release/win-unpacked would make a later by-hand check-payload-boundary fail
 * over junk this gate created.
 */
export const CAPABILITY_DIRECTORY = path.join('resources', 'capability')
export const PAYLOAD_RECORD = 'PAYLOAD.json'
export const MCP_ENTRYPOINT_BASENAME = 'mcp-server.js'
// A local-read tool with no arguments, no credentials of its own and no side
// effects -- chosen so that what the assertion proves is the PLATFORM (dispatch,
// policy, vault-backed audit signing), not any one provider's configuration.
export const ROUND_TRIP_TOOL = 'system.status'
export const AUDIT_TAIL_TOOL = 'audit.tail'
export const AUDIT_FAILURE_MARKER = 'canonical audit failed'
const ROUND_TRIP_TIMEOUT_MS = 120_000

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

const makeSmokeProfileDirectory = () => mkdtemp(path.join(tmpdir(), 'mission-control-smoke-'))
const removeSmokeProfileDirectory = (directory) => rm(directory, {
  recursive: true,
  force: true,
  maxRetries: 20,
  retryDelay: 100,
})

async function pathExists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function runPowerShell(command) {
  const { stdout } = await execFile('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    command,
  ], { windowsHide: true, timeout: 10_000 })
  return stdout.trim()
}

async function findExistingInstances() {
  const output = await runPowerShell(
    "@(Get-Process -Name 'Mission Control' -ErrorAction SilentlyContinue | " +
    "Select-Object -ExpandProperty Id) -join ','",
  )
  return output ? output.split(',').map((value) => Number(value)).filter(Number.isInteger) : []
}

async function getWindowTitle(pid) {
  const title = await runPowerShell(
    `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; ` +
    "if ($null -eq $p) { [Console]::Out.Write('__PROCESS_NOT_FOUND__') } " +
    "else { [Console]::Out.Write($p.MainWindowTitle) }; exit 0",
  )
  return title === '__PROCESS_NOT_FOUND__' ? null : title
}

async function terminateProcessTree(child) {
  if (!child?.pid) return

  if (process.platform === 'win32') {
    try {
      await execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        timeout: 10_000,
      })
      return
    } catch (error) {
      if (child.exitCode !== null) return
      try {
        child.kill()
        await Promise.race([
          new Promise((resolve) => child.once('exit', resolve)),
          delay(5_000),
        ])
      } catch {
        // The process may have exited between taskkill and the direct fallback.
      }
      if (child.exitCode !== null) return
      try {
        process.kill(child.pid, 0)
      } catch {
        return
      }
      throw new Error(`Could not terminate packaged application tree (PID ${child.pid}): ${error.message}`)
    }
  }

  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    if (child.exitCode === null) child.kill('SIGTERM')
  }
}

function watchdogTerminateProcessTree(child, log) {
  if (!child?.pid) return

  if (process.platform === 'win32') {
    try {
      const killer = nodeSpawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        detached: false,
        stdio: 'ignore',
        windowsHide: true,
      })
      killer.once('error', (error) => {
        log(`[smoke-packaged] watchdog could not start taskkill for PID ${child.pid}: ${error.message}`)
      })
    } catch (error) {
      log(`[smoke-packaged] watchdog could not start taskkill for PID ${child.pid}: ${error.message}`)
    }
    return
  }

  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    try {
      child.kill('SIGKILL')
    } catch {
      // The process may already have exited.
    }
  }
}

async function fetchCandidate(fetchImpl, port, requestTimeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs)
  try {
    const response = await fetchImpl(`http://127.0.0.1:${port}/`, { signal: controller.signal })
    const body = await response.text()
    if (response.status >= 200 && response.status < 300 && body.includes(APP_MARKER)) {
      return { port, status: response.status, markerFound: true }
    }
  } catch {
    // A refused connection is the expected state while Electron is starting.
  } finally {
    clearTimeout(timer)
  }
  return null
}

function capturedOutput(stdout, stderr) {
  return [
    `stdout:\n${stdout.trim() || '(no output captured)'}`,
    `stderr:\n${stderr.trim() || '(no output captured)'}`,
  ].join('\n')
}

export async function main(directory = 'release/win-unpacked', overrides = {}) {
  const dependencies = {
    spawn: nodeSpawn,
    fetch: globalThis.fetch,
    sleep: delay,
    now: Date.now,
    findExistingInstances,
    getWindowTitle,
    terminateProcessTree,
    watchdogTerminateProcessTree,
    makeSmokeProfileDirectory,
    removeSmokeProfileDirectory,
    timeoutMs: 40_000,
    watchdogGraceMs: 15_000,
    pollIntervalMs: 250,
    requestTimeoutMs: 1_000,
    ports: DEFAULT_PORTS,
    log: console.log,
    ...overrides,
  }

  const appDirectory = path.resolve(directory)
  if (!(await pathExists(appDirectory))) {
    throw new Error(`Packaged app directory does not exist: ${appDirectory}`)
  }
  if (!(await stat(appDirectory)).isDirectory()) {
    throw new Error(`Packaged app path is not a directory: ${appDirectory}`)
  }

  const executable = path.join(appDirectory, APP_EXE)
  if (!(await pathExists(executable))) {
    throw new Error(`Packaged executable does not exist: ${executable}`)
  }

  let existingInstances
  try {
    existingInstances = await dependencies.findExistingInstances()
  } catch (error) {
    throw new Error(`Could not check for another Mission Control instance: ${error.message}`)
  }
  if (existingInstances.length > 0) {
    throw new Error(
      `another instance is running; close it and re-run (PID${existingInstances.length === 1 ? '' : 's'} ${existingInstances.join(', ')})`,
    )
  }

  const childEnvironment = { ...process.env }
  delete childEnvironment.ELECTRON_RUN_AS_NODE
  delete childEnvironment.ELECTRON_NO_ATTACH_CONSOLE
  childEnvironment.MC_SMOKE_HEADLESS = '1'

  let child
  let smokeProfileDirectory
  let ownsSmokeProfileDirectory = false
  let watchdogTimer
  let stdout = ''
  let stderr = ''
  let exited = null
  let launchError = null
  let windowTitleCheckUnavailable = null
  let smokeError = null

  try {
    if (childEnvironment.MC_SMOKE_PROFILE_DIR) {
      smokeProfileDirectory = path.resolve(childEnvironment.MC_SMOKE_PROFILE_DIR)
    } else {
      smokeProfileDirectory = await dependencies.makeSmokeProfileDirectory()
      ownsSmokeProfileDirectory = true
    }
    child = dependencies.spawn(executable, [
      `--user-data-dir=${smokeProfileDirectory}`,
      '--disable-gpu',
      '--disable-gpu-sandbox',
    ], {
      cwd: appDirectory,
      detached: false,
      env: childEnvironment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    if (!child.pid) throw new Error('Packaged application did not return a process ID')

    watchdogTimer = setTimeout(() => {
      watchdogTimer = undefined
      dependencies.watchdogTerminateProcessTree(child, dependencies.log)
    }, dependencies.timeoutMs + dependencies.watchdogGraceMs)

    child.stdout?.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString() })
    child.once('exit', (code, signal) => { exited = { code, signal } })
    child.once('error', (error) => { launchError = error })

    const assertNoErrorWindow = async () => {
      if (windowTitleCheckUnavailable) return
      let title
      try {
        title = await dependencies.getWindowTitle(child.pid)
      } catch (error) {
        windowTitleCheckUnavailable = error.message
        return
      }
      if (title === null) {
        windowTitleCheckUnavailable = `launched PID ${child.pid} was not present when window titles were enumerated`
        return
      }
      const normalizedTitle = title.trim().toLowerCase()
      if (normalizedTitle === 'error' || normalizedTitle === 'mission control could not start') {
        throw new Error(
          `Packaged application opened a fatal startup window (${JSON.stringify(title)}, PID ${child.pid}).\n` +
          capturedOutput(stdout, stderr),
        )
      }
    }

    const deadline = dependencies.now() + dependencies.timeoutMs
    while (dependencies.now() < deadline) {
      if (launchError) throw new Error(`Could not launch packaged application: ${launchError.message}`)
      if (exited) {
        throw new Error(
          `Packaged application exited before binding (code ${exited.code ?? 'null'}, signal ${exited.signal ?? 'none'}).\n` +
          capturedOutput(stdout, stderr),
        )
      }

      const candidates = await Promise.all(
        dependencies.ports.map((port) => fetchCandidate(dependencies.fetch, port, dependencies.requestTimeoutMs)),
      )
      const match = candidates.find(Boolean)
      if (match) {
        await assertNoErrorWindow()
        if (exited) {
          throw new Error(
            `Packaged application exited during the smoke check (code ${exited.code ?? 'null'}, signal ${exited.signal ?? 'none'}).\n` +
            capturedOutput(stdout, stderr),
          )
        }
        dependencies.log(
          `[smoke-packaged] PASS port=${match.port} http_status=${match.status} ` +
          `marker_found=true ` +
          (windowTitleCheckUnavailable
            ? `window_title_check=unavailable (${windowTitleCheckUnavailable})`
            : 'window_title_error=false'),
        )
        return match
      }

      if (exited) {
        throw new Error(
          `Packaged application exited before binding (code ${exited.code ?? 'null'}, signal ${exited.signal ?? 'none'}).\n` +
          capturedOutput(stdout, stderr),
        )
      }

      await assertNoErrorWindow()
      await dependencies.sleep(dependencies.pollIntervalMs)
    }

    throw new Error(
      `Timed out after ${dependencies.timeoutMs}ms waiting for the packaged application on ports ` +
      `${dependencies.ports[0]}-${dependencies.ports.at(-1)}.\n${capturedOutput(stdout, stderr)}`,
    )
  } catch (error) {
    smokeError = error
    throw error
  } finally {
    let treeTerminated = false
    try {
      try {
        if (child) {
          await dependencies.terminateProcessTree(child)
          treeTerminated = true
        }
      } catch (cleanupError) {
        if (!smokeError) throw cleanupError
        smokeError.message += `\nCleanup also failed: ${cleanupError.message}`
      }
    } finally {
      if (treeTerminated && watchdogTimer) {
        clearTimeout(watchdogTimer)
        watchdogTimer = undefined
      }
      try {
        if (ownsSmokeProfileDirectory) await dependencies.removeSmokeProfileDirectory(smokeProfileDirectory)
      } catch (cleanupError) {
        if (!smokeError) throw cleanupError
        smokeError.message += `\nProfile cleanup also failed: ${cleanupError.message}`
      }
    }
  }
}

/* The environment the shipped capability layer is given, with every path that
 * could carry a developer's state pointed at an empty directory. Constructed
 * explicitly rather than spread-and-patched from process.env for the reason
 * shell/capability-layer.cjs gives for the same choice: what the child gets
 * must be readable in one place. Inheriting the parent environment here would
 * be the whole bug -- a builder's LOCALAPPDATA, USERPROFILE or CODEX_HOME can
 * supply, by accident, exactly the state a customer will not have. */
function sterileEnvironment(profile, base = process.env) {
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
    // Node mode. Without it the packaged Electron binary opens a window instead
    // of running the capability layer; this is the same variable, set for the
    // same reason, as shell/capability-layer.cjs childEnvironment().
    ELECTRON_RUN_AS_NODE: '1',
  }
}

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
      // Anything that is not JSON on this stream is runtime noise, not a reply.
      try { message = JSON.parse(line) } catch { continue }
      const settle = pending.get(message.id)
      if (settle) { pending.delete(message.id); settle.resolve(message) }
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
        pending.set(id, { resolve: (message) => { clearTimeout(timer); resolve(message) } })
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
      })
    },
  }
}

function firstTextContent(result) {
  const block = result?.content?.find((entry) => entry?.type === 'text')
  return typeof block?.text === 'string' ? block.text : null
}

/* Assert that the SHIPPED payload can complete a real tool call and record it
 * in the signed audit ledger, on a machine that has never seen this project.
 * Every failure below carries its own message: a mutant that kills this gate
 * for a new reason must not be mistaken for one that kills it for an old one. */
export async function assertCapabilityRoundTrip(directory = 'release/win-unpacked', overrides = {}) {
  const dependencies = {
    spawn: nodeSpawn,
    copyPayload: (from, to) => cp(from, to, { recursive: true }),
    readPayloadRecord: (file) => readFile(file, 'utf8'),
    makeSmokeProfileDirectory,
    removeSmokeProfileDirectory,
    terminateProcessTree,
    timeoutMs: ROUND_TRIP_TIMEOUT_MS,
    log: console.log,
    ...overrides,
  }

  const appDirectory = path.resolve(directory)
  const executable = path.join(appDirectory, APP_EXE)
  if (!(await pathExists(executable))) {
    throw new Error(`Capability round-trip cannot start: the packaged executable is absent (${executable}).`)
  }

  const shippedCapability = path.join(appDirectory, CAPABILITY_DIRECTORY)
  if (!(await pathExists(path.join(shippedCapability, PAYLOAD_RECORD)))) {
    throw new Error(
      `Capability round-trip cannot start: the installer ships no capability payload ` +
      `(${path.join(shippedCapability, PAYLOAD_RECORD)} is absent). A viewer with nothing behind it ` +
      'answers BRIDGE_UNREACHABLE to every write action.',
    )
  }

  let record
  try {
    record = JSON.parse(await dependencies.readPayloadRecord(path.join(shippedCapability, PAYLOAD_RECORD)))
  } catch (error) {
    throw new Error(`Capability round-trip cannot start: ${PAYLOAD_RECORD} is unreadable (${error.message}).`)
  }
  const entrypoints = Array.isArray(record?.entrypoints) ? record.entrypoints : []
  const mcpEntrypoint = entrypoints.find((entry) => path.basename(entry) === MCP_ENTRYPOINT_BASENAME)
  if (!mcpEntrypoint) {
    throw new Error(
      `Capability round-trip cannot start: no payload entrypoint is named ${MCP_ENTRYPOINT_BASENAME} ` +
      `(declared: ${entrypoints.join(', ') || 'none'}). The tool surface this gate exercises is gone or renamed.`,
    )
  }

  const profileRoot = await dependencies.makeSmokeProfileDirectory()
  const profile = {
    localAppData: path.join(profileRoot, 'localappdata'),
    userProfile: path.join(profileRoot, 'userprofile'),
    codexHome: path.join(profileRoot, 'codexhome'),
    temp: path.join(profileRoot, 'temp'),
    appData: path.join(profileRoot, 'userprofile', 'AppData', 'Roaming'),
  }
  const capabilityRoot = path.join(profileRoot, 'capability')

  let child
  let stderr = ''
  let exited = null
  try {
    for (const value of Object.values(profile)) await mkdir(value, { recursive: true })
    await dependencies.copyPayload(shippedCapability, capabilityRoot)

    child = dependencies.spawn(executable, [path.join(capabilityRoot, mcpEntrypoint)], {
      cwd: profileRoot,
      env: sterileEnvironment(profile),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString() })
    child.once('exit', (code, signal) => { exited = { code, signal } })

    const client = jsonRpcClient(child, dependencies.timeoutMs)
    const initialized = await client.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'smoke-packaged', version: '1' },
    })
    if (!initialized.result) {
      throw new Error(
        `The shipped capability layer refused the MCP handshake: ` +
        `${JSON.stringify(initialized.error) || 'no result'}.\n${capturedOutput('', stderr)}`,
      )
    }
    client.notify('notifications/initialized')

    const called = await client.request('tools/call', { name: ROUND_TRIP_TOOL, arguments: {} })
    if (!called.result) {
      throw new Error(
        `The shipped capability layer could not dispatch ${ROUND_TRIP_TOOL} at all: ` +
        `${JSON.stringify(called.error)}.\n${capturedOutput('', stderr)}`,
      )
    }
    if (called.result.isError) {
      throw new Error(
        `A real tool call REFUSED on a fresh install: ${ROUND_TRIP_TOOL} returned ` +
        `${firstTextContent(called.result) || JSON.stringify(called.result)}.\n${capturedOutput('', stderr)}`,
      )
    }

    // The audit ledger, read through the product's own tool rather than by
    // opening the SQLite file, so this asserts what a customer could verify.
    const tailed = await client.request('tools/call', { name: AUDIT_TAIL_TOOL, arguments: { limit: 20 } })
    if (!tailed.result || tailed.result.isError) {
      throw new Error(
        `The audit ledger could not be read on a fresh install: ${AUDIT_TAIL_TOOL} returned ` +
        `${firstTextContent(tailed.result) || JSON.stringify(tailed.error)}.\n` +
        'The privacy policy promises this ledger in writing.\n' +
        capturedOutput('', stderr),
      )
    }

    let rows
    try {
      const parsed = JSON.parse(firstTextContent(tailed.result) ?? 'null')
      rows = Array.isArray(parsed) ? parsed : parsed?.entries
    } catch (error) {
      throw new Error(`The audit ledger returned unparseable content (${error.message}).`)
    }
    if (!Array.isArray(rows)) {
      throw new Error(`The audit ledger returned no entry list; got ${firstTextContent(tailed.result)?.slice(0, 300)}.`)
    }

    const landed = rows.find((row) => row?.target === ROUND_TRIP_TOOL && String(row?.action || '').startsWith('mcp.tool.'))
    if (!landed) {
      throw new Error(
        `A real tool call round-tripped but LANDED NO AUDIT ROW: ${ROUND_TRIP_TOOL} succeeded and the ` +
        `ledger holds ${rows.length} row(s), none of them for it. This is the exact shape of the defect ` +
        'this assertion exists for -- the call returns success while the signed ledger silently refuses ' +
        `every write.\n${capturedOutput('', stderr)}`,
      )
    }
    if (typeof landed.keyId !== 'string' || !landed.keyId) {
      throw new Error(
        `The audit row for ${ROUND_TRIP_TOOL} is UNSIGNED (no keyId). An unsigned ledger is not the ` +
        'tamper-evident record the product claims to keep.',
      )
    }
    if (stderr.includes(AUDIT_FAILURE_MARKER)) {
      throw new Error(
        `The capability layer reported a canonical audit write failure on a fresh install, even though a ` +
        `row was readable:\n${capturedOutput('', stderr)}`,
      )
    }
    if (exited) {
      throw new Error(
        `The capability layer exited mid-round-trip (code ${exited.code ?? 'null'}, signal ${exited.signal ?? 'none'}).\n` +
        capturedOutput('', stderr),
      )
    }

    dependencies.log(
      `[smoke-packaged] CAPABILITY PASS tool=${ROUND_TRIP_TOOL} audit_sequence=${landed.sequence ?? 'unknown'} ` +
      `audit_action=${landed.action} signed_by=${landed.keyId.slice(0, 24)}... sterile_profile=yes`,
    )
    return { tool: ROUND_TRIP_TOOL, auditAction: landed.action, sequence: landed.sequence, keyId: landed.keyId }
  } finally {
    try { if (child) await dependencies.terminateProcessTree(child) } catch { /* the assertion result is authoritative */ }
    try { await dependencies.removeSmokeProfileDirectory(profileRoot) } catch { /* a leftover temp directory is not a smoke failure */ }
  }
}

/* Both halves, in the order a failure is cheapest to read: if the window never
 * appears there is no point asking whether its capability layer can sign an
 * audit row. Exported so the CLI path below is the same code a test can drive;
 * a gate whose real behaviour lives only in an `if (invoked)` block is a gate
 * nobody can prove runs both checks. */
export async function runAll(directory = 'release/win-unpacked', overrides = {}) {
  const runMain = overrides.main || main
  const runCapability = overrides.assertCapabilityRoundTrip || assertCapabilityRoundTrip
  const window = await runMain(directory, overrides)
  const capability = await runCapability(directory, overrides)
  return { window, capability }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (invokedPath === import.meta.url) {
  try {
    await runAll(process.argv[2])
  } catch (error) {
    console.error(`[smoke-packaged] FAIL: ${error.message}`)
    process.exitCode = 1
  }
}
