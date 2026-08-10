import { execFile as execFileCallback, spawn as nodeSpawn } from 'node:child_process'
import { access, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

export const APP_EXE = 'Mission Control.exe'
export const APP_MARKER = '<title>Mission Control</title>'
export const DEFAULT_PORTS = Object.freeze(Array.from({ length: 9 }, (_, index) => 4601 + index))

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

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (invokedPath === import.meta.url) {
  try {
    await main(process.argv[2])
  } catch (error) {
    console.error(`[smoke-packaged] FAIL: ${error.message}`)
    process.exitCode = 1
  }
}
