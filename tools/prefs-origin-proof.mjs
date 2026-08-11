/* DOES A SETTING SURVIVE A PORT CHANGE? Measured on the packaged application.
 *
 * The defect this gate exists for: everything the renderer persists -- theme,
 * text size, mc.live.*, mc.write.*, the first-run profile, chatbox settings --
 * was browser storage keyed to the ORIGIN, and the origin is
 * http://127.0.0.1:<port> where shell/port-scan.cjs picks <port> by scanning
 * 4601-4609 at launch. Relaunch while the previous port is held -- a lingering
 * process, a QA app, a second install, a fast restart -- and the application
 * comes up on the next port, which is a different origin, which is a different
 * storage partition. Every setting the person chose is gone, silently, and it
 * looks exactly like a factory reset.
 *
 * WHY THIS IS NOT A UNIT TEST. The whole defect lives in the gap between the
 * storage module and how the application is launched. A unit test over the
 * store passes in both the broken and the fixed build, because in a unit test
 * there is no port, no origin and no second launch. So this gate launches the
 * REAL PACKAGED EXECUTABLE TWICE, with the first launch's port deliberately
 * held by a socket, and asks the second launch's renderer what it can still
 * read. Nothing here inspects source text; every assertion is behaviour
 * observed through the Chrome DevTools Protocol in the running renderer.
 *
 * IT FORCE-KILLS BETWEEN LAUNCHES, ON PURPOSE. A graceful quit would let a
 * shutdown hook flush state and make a store that is only durable at exit look
 * durable. Killing the process tree proves the write was durable when the
 * setter returned, which is the property that makes the fix true.
 *
 * THE ORIGIN IS READ, NOT ASSUMED. The bound port comes from the page target's
 * own URL over CDP, so a run that failed to move the origin reports that it
 * did not move instead of quietly asserting nothing. A proof whose premise
 * silently stopped holding is worse than no proof.
 */
import { spawn, execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

export const APP_EXE = 'ToolsEnabled.exe'
const APP_ORIGIN_PATTERN = /^http:\/\/127\.0\.0\.1:(\d+)\//

/* The settings written in launch one and demanded back in launch two. They are
   deliberately spread across the storage families this product actually uses,
   because a fix that rescued only the key it was written against would pass a
   narrower list: an appearance key read before first paint by the inline script
   in index.html, a numeric one, a live/simulated flag, a write-enable flag, a
   JSON-valued chatbox setting, and a per-computer graph position. */
export const PROBE_SETTINGS = Object.freeze([
  { key: 'mc.theme', value: 'black' },
  { key: 'mc.text', value: '1.12' },
  { key: 'mc.live.fleet', value: 'live' },
  { key: 'mc.write.ledger', value: 'enabled' },
  { key: 'mc.chatbox.runs', value: 'mine' },
  { key: 'mc.tree.pos.c1', value: '{"a1":{"dx":12,"dy":-8}}' },
])

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function occupy(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

function releaseAll(servers) {
  return Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))))
}

/* A killed process does not release its listening socket the instant taskkill
   returns. Grabbing the port immediately raced that release and failed the
   scenario with EADDRINUSE -- a fault in the harness, reported as though the
   product had failed. Wait for the port the way the next launch would. */
async function occupyWhenFree(port, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try { return await occupy(port) } catch (error) {
      lastError = error
      if (error?.code !== 'EADDRINUSE') throw error
      await sleep(250)
    }
  }
  throw new Error(`Port ${port} never became free within ${timeoutMs}ms, so this scenario could not hold it (${lastError?.code}).`)
}

/* Hold the port the shell WOULD have taken, whichever that is. Hardcoding 4601
   made this file fail on the machine it was written for, because a second
   ToolsEnabled was already serving there -- which is the very condition the
   product is being fixed for. The scenario needs "the first port the scan would
   pick is unavailable", not "4601 specifically". */
async function occupyFirstFreePort(min = 4601, max = 4609) {
  for (let port = min; port <= max; port++) {
    try { return { server: await occupy(port), port } } catch (error) {
      if (error?.code !== 'EADDRINUSE' && error?.code !== 'EACCES') throw error
    }
  }
  throw new Error(`Every port from ${min} to ${max} is already in use, so this scenario cannot arrange its precondition.`)
}

/* Windows only kills the named process, and Electron's renderer and GPU
   children keep the listening socket alive if the parent alone is signalled.
   The port must actually be free for the next step of the scenario, so the
   whole tree goes. */
async function killTree(child) {
  if (!child || child.exitCode !== null || !child.pid) return
  try { await execFile('taskkill', ['/pid', String(child.pid), '/T', '/F']) } catch { /* already gone */ }
  const deadline = Date.now() + 10_000
  while (child.exitCode === null && Date.now() < deadline) await sleep(100)
}

/* THE DEBUGGING PORT COMES FROM THIS CHILD'S OWN STDERR, NOT FROM THE PROFILE.
   Chromium also writes it to <profile>/DevToolsActivePort, and reading it there
   is how this file wasted two runs: the second launch reuses the same profile
   directory, so until Chromium rewrites that file it still holds the FIRST
   launch's port. The probe then polled a dead endpoint for sixty seconds and
   reported "the application never showed a page" about an application that was
   in fact running and serving. The banner on stderr belongs to exactly one
   process and cannot be stale. */
function devToolsPortFromOutput(text) {
  const match = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(text)
  return match ? Number(match[1]) : null
}

async function waitForDevToolsPort(readOutput, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const port = devToolsPortFromOutput(readOutput())
    if (port) return port
    if (child.exitCode !== null) {
      throw new Error(`The application exited with code ${child.exitCode} before announcing a debugging endpoint.`)
    }
    await sleep(100)
  }
  throw new Error(`The application never announced a debugging endpoint within ${timeoutMs}ms.`)
}

/* The page target is the application's own main frame. A target list can
   briefly contain only the about:blank shell before loadURL settles, so this
   waits for a target whose URL is an origin the shell could have bound rather
   than taking the first entry and reporting a nonsense origin. */
async function findPageTarget(devToolsPort, timeoutMs, child) {
  const deadline = Date.now() + timeoutMs
  let lastSeen = '(no targets)'
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${devToolsPort}/json/list`)
      const targets = await response.json()
      lastSeen = targets.map((target) => `${target.type}:${target.url}`).join(', ') || '(no targets)'
      const page = targets.find((target) => target.type === 'page' && APP_ORIGIN_PATTERN.test(target.url || ''))
      if (page) return page
    } catch { /* endpoint not up yet */ }
    /* An application that EXITED is a different finding from one that is slow,
       and the two looked identical until this check: a second launch that loses
       the single-instance lock quits immediately, having already printed a
       DevTools endpoint, and the old code reported that as a 60s timeout. */
    if (child && child.exitCode !== null) {
      throw new Error(`The application exited with code ${child.exitCode} before showing a page. Last saw: ${lastSeen}`)
    }
    await sleep(150)
  }
  throw new Error(`No application page target on the debugging endpoint within ${timeoutMs}ms. Last saw: ${lastSeen}`)
}

class DevToolsSession {
  constructor(socket) {
    this.socket = socket
    this.nextId = 1
    this.pending = new Map()
    socket.addEventListener('message', (event) => {
      let packet
      try { packet = JSON.parse(event.data) } catch { return }
      const entry = this.pending.get(packet.id)
      if (!entry) return
      this.pending.delete(packet.id)
      if (packet.error) entry.reject(new Error(packet.error.message || 'DevTools command failed'))
      else entry.resolve(packet.result)
    })
  }

  static async open(webSocketDebuggerUrl) {
    const socket = new WebSocket(webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', () => reject(new Error('Could not open a DevTools session on the application page.')), { once: true })
    })
    return new DevToolsSession(socket)
  }

  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  /* Every probe returns a value BY VALUE. Returning a remote object handle and
     describing it would let a probe report a shape while the page holds
     something else. */
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (result.exceptionDetails) {
      throw new Error(`Page evaluation threw: ${result.exceptionDetails.text} ${result.exceptionDetails.exception?.description || ''}`.trim())
    }
    return result.result?.value
  }

  /* WAIT FOR THE APPLICATION'S OWN DOCUMENT, NOT WHATEVER IS THERE NOW.
     A session can attach while the window still holds the initial empty
     document that precedes loadURL. Storage on that document is opaque, and
     touching it throws "Access is denied" -- which an earlier version of this
     file reported as a finding about the product. It was a finding about the
     probe. Polling until the origin, the ready state and a reachable storage
     object all agree removes the transient instead of racing it. */
  async waitForDocument(origin, timeoutMs) {
    const deadline = Date.now() + timeoutMs
    let last = 'never evaluated'
    const expression = `(() => {
      try {
        return JSON.stringify({
          origin: location.origin,
          ready: document.readyState,
          storage: typeof window.localStorage,
        })
      } catch (error) { return JSON.stringify({ error: String(error && error.message || error) }) }
    })()`
    while (Date.now() < deadline) {
      try {
        last = await this.evaluate(expression)
        const state = JSON.parse(last)
        if (state.origin === origin && state.ready === 'complete' && state.storage === 'object') return
      } catch (error) { last = `evaluation failed: ${error.message}` }
      await sleep(200)
    }
    throw new Error(`The application document never settled at ${origin} within ${timeoutMs}ms. Last state: ${last}`)
  }

  close() {
    try { this.socket.close() } catch { /* already closing */ }
  }
}

/* One launch of the real executable, attached to and ready to be asked
   questions. `expectDocumentReady` waits for the renderer to have finished
   evaluating its scripts, so a probe cannot read storage before the store has
   been installed and report an empty result as a defect. */
async function launchApp({ executable, appDirectory, profileDirectory, timeoutMs, log }) {
  const environment = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  delete environment.ELECTRON_NO_ATTACH_CONSOLE
  environment.MC_SMOKE_HEADLESS = '1'

  let stdout = ''
  let stderr = ''
  const child = spawn(executable, [
    `--user-data-dir=${profileDirectory}`,
    '--remote-debugging-port=0',
    '--disable-gpu',
    '--disable-gpu-sandbox',
  ], {
    cwd: appDirectory,
    detached: false,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  child.stdout?.on('data', (chunk) => { stdout += chunk.toString() })
  child.stderr?.on('data', (chunk) => { stderr += chunk.toString() })
  if (!child.pid) throw new Error('Packaged application did not return a process ID')

  try {
    const devToolsPort = await waitForDevToolsPort(() => `${stdout}\n${stderr}`, child, timeoutMs)
    const target = await findPageTarget(devToolsPort, timeoutMs, child)
    const session = await DevToolsSession.open(target.webSocketDebuggerUrl)
    const origin = new URL(target.url).origin
    const port = Number(new URL(target.url).port)
    await session.waitForDocument(origin, timeoutMs)
    log(`[prefs-origin-proof] launched pid=${child.pid} origin=${origin}`)
    return { child, session, origin, port, output: () => `stdout:\n${stdout}\nstderr:\n${stderr}` }
  } catch (error) {
    await killTree(child)
    throw new Error(`${error.message}\nstdout:\n${stdout}\nstderr:\n${stderr}`)
  }
}

const readProbe = `(() => {
  const out = {}
  for (const key of ${JSON.stringify(PROBE_SETTINGS.map((setting) => setting.key))}) {
    try { out[key] = localStorage.getItem(key) } catch (error) { out[key] = 'THREW:' + error.message }
  }
  out['__paintedTheme'] = document.documentElement.dataset.theme || null
  return out
})()`

function writeProbe(settings) {
  return `(() => {
    for (const [key, value] of ${JSON.stringify(settings.map((setting) => [setting.key, setting.value]))}) {
      localStorage.setItem(key, value)
    }
    return true
  })()`
}

function compare(observed, label) {
  const missing = []
  for (const setting of PROBE_SETTINGS) {
    if (observed[setting.key] !== setting.value) {
      missing.push(`${setting.key}: expected ${JSON.stringify(setting.value)}, ${label} ${JSON.stringify(observed[setting.key])}`)
    }
  }
  return missing
}

/* THE THEME THE PAGE ACTUALLY ENDED UP ON, which is a different claim from
   "the key round-tripped": it fails if a setting survives in storage but never
   reaches the surface a person looks at.

   WHAT IT DOES NOT COVER, measured rather than assumed: this reads the SETTLED
   theme, and src/main.js applies the stored theme when it evaluates. A packaged
   app built with the durable store installed BELOW the inline pre-paint read
   still passed this check, because the page corrects itself before anything can
   observe it. The cost of that regression is a white flash on one frame, which
   no assertion here can see. Document order is therefore asserted directly, in
   tools/test/durable-storage.test.mjs.

   Checked only on the RELAUNCH, because the first launch writes storage
   directly without asking the app to re-theme itself. */
function paintedThemeFailures(observed) {
  const expected = PROBE_SETTINGS.find((setting) => setting.key === 'mc.theme').value
  if (observed.__paintedTheme === expected) return []
  return [`the page painted the ${JSON.stringify(observed.__paintedTheme)} theme while the stored theme is ${JSON.stringify(expected)}: the setting survived the port change but the pre-paint read did not see it`]
}

/* SCENARIO ONE -- AN EXISTING INSTALL. Settings already chosen under the port
   the application happened to bind first, then a relaunch with that port held.
   This is the measured customer story: nothing was uninstalled, nothing was
   reset, and the product forgot who they were. */
async function existingInstallScenario(context) {
  const { executable, appDirectory, timeoutMs, log } = context
  const profileDirectory = await mkdtemp(path.join(tmpdir(), 'te-prefs-existing-'))
  const occupied = []
  let first = null
  let second = null
  try {
    first = await launchApp({ executable, appDirectory, profileDirectory, timeoutMs, log })
    await first.session.evaluate(writeProbe(PROBE_SETTINGS))
    const writtenBack = await first.session.evaluate(readProbe)
    const writeFailures = compare(writtenBack, 'read back as')
    if (writeFailures.length) {
      return { name: 'existing install', ok: false, reason: `the FIRST launch could not even store its own settings, so this run proves nothing about the second:\n  ${writeFailures.join('\n  ')}` }
    }
    const firstOrigin = first.origin
    const firstPort = first.port
    first.session.close()
    await killTree(first.child)
    first = null

    occupied.push(await occupyWhenFree(firstPort))
    log(`[prefs-origin-proof] holding port ${firstPort} so the next launch cannot have it`)

    second = await launchApp({ executable, appDirectory, profileDirectory, timeoutMs, log })
    if (second.origin === firstOrigin) {
      return { name: 'existing install', ok: false, reason: `the premise did not hold: the second launch bound ${second.origin} again, so the origin never changed and nothing was tested. The occupied socket on ${firstPort} did not force a move.` }
    }
    const observed = await second.session.evaluate(readProbe)
    const failures = [...compare(observed, 'the second launch sees'), ...paintedThemeFailures(observed)]
    const detail = `first origin ${firstOrigin} -> second origin ${second.origin}; painted theme ${JSON.stringify(observed.__paintedTheme)}`
    if (failures.length) {
      return { name: 'existing install', ok: false, reason: `${detail}\n  ${failures.join('\n  ')}` }
    }
    return { name: 'existing install', ok: true, detail }
  } finally {
    if (first) { first.session.close(); await killTree(first.child) }
    if (second) { second.session.close(); await killTree(second.child) }
    await releaseAll(occupied)
    await rm(profileDirectory, { recursive: true, force: true }).catch(() => {})
  }
}

/* SCENARIO TWO -- A FRESH INSTALL THAT NEVER SAW THE FIRST PORT. Nothing is
   stored yet AND the usual port is already taken, so this install's first ever
   origin is the second port. Then that port is taken too. A fix that only
   migrated an old copy forward would pass scenario one and fail here, because
   here there is nothing to migrate -- the store simply has to not be keyed to
   the origin. */
async function freshInstallScenario(context) {
  const { executable, appDirectory, timeoutMs, log } = context
  const profileDirectory = await mkdtemp(path.join(tmpdir(), 'te-prefs-fresh-'))
  const occupied = []
  let first = null
  let second = null
  try {
    const held = await occupyFirstFreePort()
    occupied.push(held.server)
    log(`[prefs-origin-proof] holding port ${held.port} before this install has ever run`)

    first = await launchApp({ executable, appDirectory, profileDirectory, timeoutMs, log })
    if (first.port === held.port) {
      return { name: 'fresh install', ok: false, reason: `the premise did not hold: the application bound ${held.port} while this run was holding it.` }
    }
    const cleanSlate = await first.session.evaluate(readProbe)
    const preexisting = PROBE_SETTINGS.filter((setting) => cleanSlate[setting.key] !== null)
    if (preexisting.length) {
      return { name: 'fresh install', ok: false, reason: `this was supposed to be a fresh install but it already had ${preexisting.map((setting) => setting.key).join(', ')}. The profile directory was not clean, so the run proves nothing.` }
    }
    await first.session.evaluate(writeProbe(PROBE_SETTINGS))
    const firstOrigin = first.origin
    const firstPort = first.port
    first.session.close()
    await killTree(first.child)
    first = null

    occupied.push(await occupyWhenFree(firstPort))
    log(`[prefs-origin-proof] now holding ${firstPort} as well`)

    second = await launchApp({ executable, appDirectory, profileDirectory, timeoutMs, log })
    if (second.origin === firstOrigin) {
      return { name: 'fresh install', ok: false, reason: `the premise did not hold: the second launch bound ${second.origin} again.` }
    }
    const observed = await second.session.evaluate(readProbe)
    const failures = [...compare(observed, 'the second launch sees'), ...paintedThemeFailures(observed)]
    const detail = `first origin ${firstOrigin} -> second origin ${second.origin}; painted theme ${JSON.stringify(observed.__paintedTheme)}`
    if (failures.length) {
      return { name: 'fresh install', ok: false, reason: `${detail}\n  ${failures.join('\n  ')}` }
    }
    return { name: 'fresh install', ok: true, detail }
  } finally {
    if (first) { first.session.close(); await killTree(first.child) }
    if (second) { second.session.close(); await killTree(second.child) }
    await releaseAll(occupied)
    await rm(profileDirectory, { recursive: true, force: true }).catch(() => {})
  }
}

existingInstallScenario.scenarioName = 'existing install'
freshInstallScenario.scenarioName = 'fresh install'

export async function main(directory = 'release/win-unpacked', overrides = {}) {
  const log = overrides.log || console.log
  const timeoutMs = overrides.timeoutMs || 60_000
  const appDirectory = path.resolve(directory)
  const executable = path.join(appDirectory, APP_EXE)
  const context = { executable, appDirectory, timeoutMs, log }

  /* A scenario that THREW is a failed scenario, not a reason to lose the other
     one's verdict. An earlier version let an EADDRINUSE while arranging the
     second scenario propagate out of main(), which discarded the first
     scenario's already-computed result and printed nothing at all. */
  const run = async (scenario) => {
    try { return await scenario(context) } catch (error) {
      return { name: scenario.scenarioName, ok: false, reason: `the scenario could not complete: ${error.message}` }
    }
  }
  const results = []
  results.push(await run(existingInstallScenario))
  results.push(await run(freshInstallScenario))

  for (const result of results) {
    if (result.ok) log(`[prefs-origin-proof] PASS ${result.name}: ${result.detail}`)
    else log(`[prefs-origin-proof] FAIL ${result.name}: ${result.reason}`)
  }
  const failed = results.filter((result) => !result.ok)
  if (failed.length) {
    throw new Error(`A setting did not survive a port change in ${failed.length} of ${results.length} scenarios. This is the silent factory-reset defect.`)
  }
  log('[prefs-origin-proof] PASS settings survived a port change on both a fresh and an existing install.')
  return results
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (invokedPath === import.meta.url) {
  main(process.argv[2] || 'release/win-unpacked').catch((error) => {
    console.error(`[prefs-origin-proof] ${error.message}`)
    process.exitCode = 1
  })
}
