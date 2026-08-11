#!/usr/bin/env node
/* A LOOP THAT ACTUALLY LOOPED AND ACTUALLY STOPPED, ON A PACKAGED WINDOW,
 * REACHED BY CLICKING.
 *
 * tools/test/agent-loops.test.mjs proves the loop CONTRACT against injected
 * timers. That cannot see whether a person can get to the control, and a loop
 * driven by a fake clock has not demonstrated the one property that matters
 * most: that leaving it alone produces another run, and that pressing stop ends
 * it. So this harness clicks Start on a real packaged build, WAITS OUT REAL
 * WALL-CLOCK INTERVALS, and counts what arrived at the other end.
 *
 * WHY A CONTROLLED BRIDGE RATHER THAN THE REAL ENGINE.
 *
 * Proving a loop with live agents would spawn real Codex/Claude processes on the
 * owner's machine, burn account budget, and -- this being a LOOP -- do it
 * repeatedly and leave lanes running if the harness died mid-run. That is not a
 * cost a test may impose. So the engine is replaced by a bridge stub that speaks
 * the real protocol, and everything ABOVE it is the shipped product: the real
 * discovery scan, the real bootstrap-proof exchange, the real bearer auth, the
 * real postBridgeAction, the real controller, real setTimeout intervals, and a
 * real click on real glass.
 *
 * The half this deliberately does not cover -- that a spawned child is confined
 * to the installed tier -- is covered where it can be done honestly, by spawning
 * REAL child processes and reading the argv the child itself recorded:
 * toolsenabled-current/tests/loop-guided-child-confinement.test.js.
 *
 * THE THREE RULES BORROWED FROM THE HARNESSES THAT EARNED THEM.
 *
 * 1. NAVIGATE BY CLICKING. A sibling harness reached its page by assigning
 *    location.hash and passed in full on a build where nothing routed to the
 *    page. auditSelf() enforces that against this file's own source.
 * 2. ISOLATE LOCALAPPDATA *AND* USERPROFILE, not just --user-data-dir.
 * 3. CLEANUP MAY NEVER FAIL THE RUN.
 *
 * This takes a little over two minutes: it is mostly spent waiting for time to
 * pass, which is the only way to prove that time passing produces another run.
 */
import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require_ = createRequire(import.meta.url)
const SELF = fileURLToPath(import.meta.url)
const REPO_ROOT = path.resolve(path.dirname(SELF), '..')
const RELEASE = path.join(REPO_ROOT, 'release', 'win-unpacked')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

/* The interval the loop is driven at. One minute is the product's own floor
   (LOOP_BOUNDS.minIntervalMs), so this is the fastest a real person could run
   one -- the harness gets no special speed the customer does not have. */
const INTERVAL_MINUTES = 1
const INTERVAL_WAIT_MS = 68_000

function auditSelf() {
  return readFileSync(SELF, 'utf8')
    .split('\n')
    .map((line, index) => ({ line, at: index + 1 }))
    .filter(({ line }) => /location\.hash\s*=/.test(line))
    .filter(({ line }) => !/^\s*(\/\/|\*|\/\*)/.test(line))
}

const results = []
function check(name, pass, detail = '') {
  results.push({ name, pass, detail })
  console.log(`${pass ? '  ok  ' : '  FAIL'} ${name}${detail ? `  ${detail}` : ''}`)
}

function appExecutable(appRoot) {
  const executables = readdirSync(appRoot).filter(entry => entry.toLowerCase().endsWith('.exe'))
  if (executables.length === 1) return path.join(appRoot, executables[0])
  const launcher = executables.find(entry => !/^(elevate|squirrel|crashpad)/i.test(entry))
  if (!launcher) throw new Error(`cannot tell which of these is the launcher: ${executables.join(', ')}`)
  return path.join(appRoot, launcher)
}

async function stage(scratch) {
  const asar = require_(path.join(REPO_ROOT, 'node_modules', '@electron', 'asar'))
  const app = path.join(scratch, 'app')
  const unpacked = path.join(scratch, 'asar-stage')
  if (!existsSync(path.join(RELEASE, 'resources', 'app.asar'))) {
    throw new Error(`no packaged build at ${RELEASE}. Run \`npm run dist\` first.`)
  }
  cpSync(RELEASE, app, { recursive: true, dereference: true })
  asar.extractAll(path.join(app, 'resources', 'app.asar'), unpacked)
  for (const directory of ['dist', 'shell']) {
    const from = path.join(REPO_ROOT, directory)
    if (!existsSync(from)) throw new Error(`${directory}/ is missing; run \`npm run build\` first`)
    rmSync(path.join(unpacked, directory), { recursive: true, force: true })
    cpSync(from, path.join(unpacked, directory), { recursive: true })
  }
  cpSync(path.join(REPO_ROOT, 'package.json'), path.join(unpacked, 'package.json'))
  await asar.createPackage(unpacked, path.join(app, 'resources', 'app.asar'))
  return appExecutable(app)
}

function seedMachineRecord(profile, appRoot, tier) {
  const servicesRoot = path.join(profile, 'local', 'ToolsEnabled')
  const workspace = path.join(profile, 'home', 'ToolsEnabled')
  mkdirSync(servicesRoot, { recursive: true })
  mkdirSync(workspace, { recursive: true })
  const machineRecord = require_(path.join(appRoot, 'resources', 'capability', 'src', 'lib', 'setup', 'machine-record.js'))
  const record = machineRecord.buildMachineRecord({
    tier,
    servicesRoot,
    installRoot: path.join(appRoot, 'resources', 'capability'),
    nodePath: process.execPath,
    workspaceRoots: [workspace],
  })
  machineRecord.writeMachineRecord(record, { servicesRoot })
  return servicesRoot
}

async function freePort() {
  const net = await import('node:net')
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

/* THE CONTROLLED BRIDGE.
 *
 * Speaks exactly the protocol src/mission-bridge.js requires -- the discovery
 * body is validated field by field by validRuntimeDiscovery(), so a sloppy stub
 * is simply not discovered and the harness fails rather than passing on a
 * fiction. It records every action it is asked to perform, which is what the
 * assertions are made against: what ARRIVED, not what the renderer believes it
 * sent. */
function startBridgeStub(port, proofToken) {
  const received = []
  const bearer = crypto.randomBytes(32).toString('base64url')
  const startedAt = new Date().toISOString()
  let launchSeq = 0

  const server = createServer((request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${port}`)
    /* CORS, mirroring the real bridge (mission-bridge/server.js:211-214). The
       renderer is a different origin from this listener and every audited call
       carries `authorization` and `content-type`, which forces a preflight.
       Without these headers the browser refuses the request before it is sent,
       the stub records nothing at all, and the symptom on the glass is a bare
       "Failed to fetch" that looks exactly like a broken product. */
    const cors = {
      'access-control-allow-origin': request.headers.origin || '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-max-age': '600',
    }
    const reply = (status, body) => {
      const payload = JSON.stringify(body)
      response.writeHead(status, { ...cors, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) })
      response.end(payload)
    }

    if (request.method === 'OPTIONS') {
      response.writeHead(204, cors)
      return response.end()
    }

    if (url.pathname === '/v1/runtime') {
      return reply(200, { ok: true, baseUrl: `http://127.0.0.1:${port}`, port, startedAt, pid: process.pid })
    }
    if (url.pathname === '/v1/bootstrap') {
      if (url.searchParams.get('proof') !== proofToken) return reply(403, { ok: false, error: { code: 'BRIDGE_PROOF_REFUSED', message: 'bad proof' } })
      return reply(200, { ok: true, token: bearer })
    }
    if (request.headers.authorization !== `Bearer ${bearer}`) {
      return reply(401, { ok: false, error: { code: 'BRIDGE_UNAUTHORIZED', message: 'no bearer' } })
    }
    if (url.pathname === '/v1/status') {
      return reply(200, { ok: true, roots: ['isolated'], queue: [] })
    }

    let raw = ''
    request.setEncoding('utf8')
    request.on('data', chunk => { raw += chunk })
    request.on('end', () => {
      let body = null
      try { body = JSON.parse(raw) } catch { body = null }
      received.push({ pathname: url.pathname, body, at: Date.now() })

      if (url.pathname === '/v1/actions/dispatch') {
        launchSeq += 1
        return reply(200, {
          ok: true,
          receipt: {
            action: 'dispatch',
            tier: body?.tier,
            launchId: `launch_stub${String(launchSeq).padStart(4, '0')}`,
            agentId: 'luna',
            auditSequence: launchSeq,
            auditEventHash: crypto.createHash('sha256').update(`dispatch-${launchSeq}`).digest('hex'),
          },
        })
      }
      if (url.pathname === '/v1/actions/terminate') {
        return reply(200, {
          ok: true,
          receipt: {
            action: 'terminate',
            idempotencyKey: body?.idempotencyKey,
            agentId: body?.agentId,
            runId: body?.expectedRunId,
            pid: body?.expectedPid,
            verifiedGone: true,
            terminalStatus: 'failed',
            exitCode: 1,
            verifiedGoneAt: new Date().toISOString(),
            terminalAt: Date.now(),
            auditSequence: 999,
            auditEventHash: crypto.createHash('sha256').update('terminate').digest('hex'),
          },
        })
      }
      return reply(404, { ok: false, error: { code: 'BRIDGE_ROUTE_UNKNOWN', message: url.pathname } })
    })
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve({
      server,
      received,
      dispatches: () => received.filter(entry => entry.pathname === '/v1/actions/dispatch'),
      terminates: () => received.filter(entry => entry.pathname === '/v1/actions/terminate'),
    }))
  })
}

function createSession(port, child) {
  let socket = null
  let nextId = 1
  const pending = new Map()
  return {
    async open() {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        if (child.exitCode !== null) throw new Error(`the app exited with code ${child.exitCode} before the debugger answered`)
        try {
          const response = await fetch(`http://127.0.0.1:${port}/json/list`)
          const page = (await response.json()).find(entry => entry.type === 'page' && entry.webSocketDebuggerUrl)
          if (page) {
            socket = new WebSocket(page.webSocketDebuggerUrl)
            await new Promise((resolve, reject) => {
              socket.addEventListener('open', resolve, { once: true })
              socket.addEventListener('error', reject, { once: true })
            })
            socket.addEventListener('message', event => {
              const packet = JSON.parse(event.data)
              const handler = pending.get(packet.id)
              if (handler) { pending.delete(packet.id); handler(packet) }
            })
            return
          }
        } catch { /* not listening yet */ }
        await delay(500)
      }
      throw new Error('no debuggable page appeared within 30s')
    },
    send(method, params = {}) {
      const id = nextId++
      socket.send(JSON.stringify({ id, method, params }))
      return new Promise(resolve => pending.set(id, resolve))
    },
    close() { try { socket?.close() } catch { /* already gone */ } },
  }
}

/* VISIBLE IS MEASURED, AND SO IS CLICKABLE.
 *
 * The inherited version of this helper checked size and computed style only. It
 * reported `visible` -- and the click reported `clicked` -- for a control that
 * was scrolled below the fold of the rail, because a synthetic mouse event at
 * viewport coordinates that land outside the window simply hits nothing. This
 * harness spent two full runs believing it had pressed Start.
 *
 * So: scroll the node into view, then refuse any point that falls outside the
 * viewport, and confirm with elementFromPoint that the pixel actually belongs to
 * the node. A click that cannot be shown to have landed is not evidence. */
const VISIBLE = `(selector) => {
  const node = document.querySelector(selector)
  if (!node) return { state: 'absent' }
  node.scrollIntoView({ block: 'center', inline: 'nearest' })
  const box = node.getBoundingClientRect()
  const style = getComputedStyle(node)
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return { state: 'hidden' }
  if (box.width < 1 || box.height < 1) return { state: 'zero-size' }
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
    return { state: 'offscreen', x, y, viewport: [window.innerWidth, window.innerHeight] }
  }
  const hit = document.elementFromPoint(x, y)
  if (!hit || !(hit === node || node.contains(hit) || hit.contains(node))) {
    return { state: 'occluded', by: hit ? (hit.className || hit.tagName) : 'nothing' }
  }
  return { state: 'visible', x, y }
}`

async function main() {
  const offenders = auditSelf()
  if (offenders.length > 0) {
    for (const { line, at } of offenders) console.error(`  self-audit: line ${at} navigates by assigning the hash: ${line.trim()}`)
    console.error('A reachability suite that reaches the page by assigning the hash is not a reachability suite.')
    process.exitCode = 1
    return
  }

  const scratch = mkdtempSync(path.join(os.tmpdir(), 'loop-qa-'))
  const profile = path.join(scratch, 'profile')
  let child = null
  let session = null
  let bridge = null

  try {
    const executable = await stage(scratch)
    const appRoot = path.dirname(executable)
    seedMachineRecord(profile, appRoot, 'standard')

    /* THE STUB IS PINNED EXPLICITLY, NEVER DISCOVERED.
     *
     * The first version of this harness put the stub on 4610 and let the shipped
     * renderer's discovery scan find it. That is unsafe on a developer machine
     * and it was caught here doing exactly the unsafe thing: this box already
     * runs a real capability layer inside the declared 4610-4619 range, so the
     * scan would have bound the loop to the REAL engine and every iteration
     * would have spawned a real agent on the owner's machine -- repeatedly,
     * which is the whole point of a loop.
     *
     * So the stub listens OUTSIDE the discovery range and is named explicitly
     * with the product's own `?bridge=` developer override, which
     * configuredBaseUrl() honours before it ever scans. A pin cannot fall
     * through to somebody else's bridge; a scan can. */
    const proofToken = crypto.randomBytes(32).toString('base64url')
    const proofFile = path.join(scratch, 'bridge-proof.json')
    writeFileSync(proofFile, JSON.stringify({ token: proofToken }), 'utf8')
    const bridgePort = await freePort()
    if (bridgePort >= 4610 && bridgePort <= 4619) throw new Error('the stub must not sit inside the discovery range')
    bridge = await startBridgeStub(bridgePort, proofToken)

    /* Probe the stub from here before the app is allowed anywhere near it. A
       stub that is silently broken would otherwise be reported as the product
       failing to dispatch, which is the most expensive kind of wrong answer a
       harness can give. */
    const probe = await fetch(`http://127.0.0.1:${bridgePort}/v1/bootstrap?proof=${proofToken}`).then(r => r.json())
    if (probe?.ok !== true || typeof probe.token !== 'string') {
      throw new Error(`the controlled bridge did not answer its own bootstrap: ${JSON.stringify(probe)}`)
    }

    const port = await freePort()
    const environment = { ...process.env }
    delete environment.ELECTRON_RUN_AS_NODE
    delete environment.ELECTRON_NO_ATTACH_CONSOLE
    environment.LOCALAPPDATA = path.join(profile, 'local')
    environment.USERPROFILE = path.join(profile, 'home')
    environment.CODEX_HOME = path.join(profile, 'home', '.codex')
    environment.MC_BRIDGE_PROOF_FILE = proofFile
    mkdirSync(environment.CODEX_HOME, { recursive: true })

    child = spawn(executable, [`--remote-debugging-port=${port}`, `--user-data-dir=${path.join(profile, 'userdata')}`], {
      env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    })
    session = createSession(port, child)
    await session.open()

    const evaluate = async expression => {
      const packet = await session.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      return packet?.result?.result?.value
    }
    const clickVisible = async selector => {
      const spot = await evaluate(`(${VISIBLE})(${JSON.stringify(selector)})`)
      if (spot.state !== 'visible') return spot.state
      for (const type of ['mousePressed', 'mouseReleased']) {
        await session.send('Input.dispatchMouseEvent', { type, x: spot.x, y: spot.y, button: 'left', clickCount: 1 })
      }
      await delay(400)
      return 'clicked'
    }

    await evaluate('document.fonts ? document.fonts.ready.then(() => true) : true')
    await delay(1200)

    /* Reload onto the explicitly pinned bridge. This is app-level setup, not
       route navigation: page 2 is still reached by clicking, below. */
    const bridgeOrigin = `http://127.0.0.1:${bridgePort}`
    await evaluate(`(() => {
      localStorage.setItem('mc.live.computers', 'simulated')
      localStorage.setItem('mc.write.dispatch', 'enabled')
      const url = new URL(window.location.href)
      url.search = 'bridge=${bridgeOrigin}'
      window.location.replace(url.toString())
      return true
    })()`)
    await delay(3000)
    await evaluate('document.fonts ? document.fonts.ready.then(() => true) : true')

    /* ---------- THE SAFETY GATE ----------
     * Nothing below may click Start unless BOTH branch conditions that select
     * the pinned stub are true on the glass. If the shell reported a supervised
     * layer, configuredBaseUrl() pins to THAT and ignores ?bridge= entirely --
     * and this machine has a real one running. Refusing here is the difference
     * between a test and an incident. */
    const binding = await evaluate(`(async () => {
      const endpoint = await window.mcShell?.getBridgeEndpoint?.()
      return { search: window.location.search, source: endpoint?.source ?? 'none' }
    })()`)
    const pinned = binding
      && binding.search.includes(`bridge=${bridgeOrigin}`)
      && binding.source === 'env'
    check('the renderer is bound to the controlled stub, not to any real bridge',
      pinned === true, JSON.stringify(binding))
    if (!pinned) {
      throw new Error(`refusing to dispatch: the renderer is not provably pinned to the stub (${JSON.stringify(binding)}). A loop bound to a real bridge would spawn real agents repeatedly.`)
    }

    /* ---------- reachability, by clicking ---------- */

    const toPage2 = await clickVisible('#nav-next')
    const route = await evaluate('document.body.dataset.route')
    check('the forward control reaches page 2 by clicking', toPage2 === 'clicked' && route === 'computers', `${toPage2} route=${route}`)

    const opened = await clickVisible('.static-tree-node')
    await delay(700)
    check('clicking an agent opens the rail board', opened === 'clicked', opened)

    const loopBox = await evaluate(`(${VISIBLE})('.board-loop-box')`)
    check('the Loop panel is on the glass, not merely in the DOM', loopBox.state === 'visible', loopBox.state)

    /* ---------- the stop is beside the start, before anything runs ---------- */

    const idle = await evaluate(`(() => {
      const box = document.querySelector('.board-loop-box')
      if (!box) return null
      const stop = box.querySelector('[data-loop="stop"]')
      const go = box.querySelector('[data-loop="go"]')
      return {
        stopPresent: Boolean(stop),
        stopDisabled: stop.disabled,
        stopTitle: stop.title,
        goDisabled: go.disabled,
        sameParent: stop.parentElement === go.parentElement,
        bounds: box.querySelector('[data-loop="bounds"]').textContent.trim(),
        honesty: box.querySelector('[data-loop="honesty"]').textContent.trim(),
        runOptions: [...box.querySelectorAll('[data-loop="runs"] option')].map(option => Number(option.value)),
      }
    })()`)

    check('the stop control is rendered beside the start, not on another screen',
      idle && idle.stopPresent && idle.sameParent === true, JSON.stringify({ present: idle?.stopPresent, sameParent: idle?.sameParent }))
    check('with no loop running the stop is disabled and says why', idle && idle.stopDisabled === true && idle.stopTitle.length > 10, idle?.stopTitle)
    check('the panel states the overrun rule where a person can read it', /skipped/i.test(idle?.bounds || ''), idle?.bounds?.slice(0, 90))
    check('the panel states that each run kills its own process tree', /process tree/i.test(idle?.bounds || ''), idle?.bounds?.slice(-90))
    check('the panel admits the loop does not survive a restart', /not durable across a restart/i.test(idle?.honesty || ''), idle?.honesty?.slice(0, 90))
    check('the run count cannot be set past the engine cap',
      Array.isArray(idle?.runOptions) && Math.max(...idle.runOptions) === 8, JSON.stringify(idle?.runOptions))

    /* ---------- start it, for real, at the product's own minimum interval ---------- */

    const configured = await evaluate(`(() => {
      const box = document.querySelector('.board-loop-box')
      const every = box.querySelector('[data-loop="every"]')
      every.value = '${INTERVAL_MINUTES}'
      every.dispatchEvent(new Event('change', { bubbles: true }))
      const runs = box.querySelector('[data-loop="runs"]')
      runs.value = '8'
      runs.dispatchEvent(new Event('change', { bubbles: true }))
      return { plan: box.querySelector('[data-loop="plan"]').textContent.trim(), goDisabled: box.querySelector('[data-loop="go"]').disabled }
    })()`)
    check('a configured loop is startable and says what it will do', configured.goDisabled === false && configured.plan.length > 20, configured.plan)

    const started = await clickVisible('[data-loop="go"]')
    check('the start control accepts a click', started === 'clicked', started)
    await delay(4000)

    const afterStart = await evaluate(`(() => {
      const box = document.querySelector('.board-loop-box')
      return {
        stopDisabled: box.querySelector('[data-loop="stop"]').disabled,
        out: box.querySelector('[data-loop="out"]').textContent.trim(),
        rows: box.querySelectorAll('.team-row').length,
      }
    })()`)
    check('the first run starts immediately, without waiting an interval', bridge.dispatches().length === 1,
      `dispatches=${bridge.dispatches().length} out="${afterStart.out}" stubSaw=${JSON.stringify(bridge.received.map(entry => entry.pathname))}`)
    check('the stop becomes available the moment a loop is running', afterStart.stopDisabled === false, String(afterStart.stopDisabled))

    /* Fail fast rather than spend two more minutes waiting for intervals that
       cannot produce anything. A harness that waits anyway just reports the same
       failure three times and hides which one was first. */
    if (bridge.dispatches().length === 0) {
      throw new Error(`no run reached the controlled bridge, so there is no loop to wait for. panel said: "${afterStart.out}". stub saw: ${JSON.stringify(bridge.received.map(entry => entry.pathname))}`)
    }

    /* ---------- IT LOOPS. Wait out a real interval. ---------- */

    console.log(`  ..  waiting ${Math.round(INTERVAL_WAIT_MS / 1000)}s for the interval to elapse`)
    await delay(INTERVAL_WAIT_MS)

    const dispatches = bridge.dispatches()
    check('leaving the loop alone produces a SECOND run — this is the loop', dispatches.length === 2, `dispatches=${dispatches.length}`)

    const anchorId = 'launch_stub0001'
    check('the second run is nested under the first, which is what arms the engine fan-out cap',
      dispatches[1]?.body?.parentLaunchId === anchorId, String(dispatches[1]?.body?.parentLaunchId))
    check('the first run is a root and names no parent',
      dispatches[0] && !Object.hasOwn(dispatches[0].body, 'parentLaunchId'), JSON.stringify(Object.keys(dispatches[0]?.body || {})))
    /* The positive that makes the comparison below load-bearing. Without it,
       two absent bodies compare equal and this "passes" having inspected
       nothing -- which is exactly what it did on the first run of this harness. */
    check('both runs actually carried a body to compare',
      Boolean(dispatches[0]?.body?.tier) && Boolean(dispatches[1]?.body?.tier),
      JSON.stringify([dispatches[0]?.body?.tier, dispatches[1]?.body?.tier]))
    check('nesting is the only difference between the two runs',
      Boolean(dispatches[0]?.body) && Boolean(dispatches[1]?.body)
      && JSON.stringify({ ...dispatches[1].body, parentLaunchId: undefined }) === JSON.stringify({ ...dispatches[0].body, parentLaunchId: undefined }),
      'bodies otherwise identical')

    /* ---------- IT STOPS. ---------- */

    const stopped = await clickVisible('[data-loop="stop"]')
    check('the stop control accepts a click while the loop is running', stopped === 'clicked', stopped)
    await delay(3000)

    const afterStop = await evaluate(`(() => {
      const box = document.querySelector('.board-loop-box')
      return {
        out: box.querySelector('[data-loop="out"]').textContent.trim(),
        stopDisabled: box.querySelector('[data-loop="stop"]').disabled,
      }
    })()`)
    check('the stop reports that no further run will start', /No further run will start/i.test(afterStop.out), afterStop.out.slice(0, 110))
    check('the stop is no longer offered once the loop is stopped', afterStop.stopDisabled === true, String(afterStop.stopDisabled))

    console.log(`  ..  waiting a further ${Math.round(INTERVAL_WAIT_MS / 1000)}s to prove the stop held`)
    await delay(INTERVAL_WAIT_MS)
    check('after the stop, a further elapsed interval produces NO third run — this is the stop',
      bridge.dispatches().length === 2, `dispatches=${bridge.dispatches().length}`)

    const errors = await evaluate(`(() => (window.__qaErrors || []).length)()`)
    check('the renderer logged no errors reaching or driving the loop', errors === undefined || errors === 0, String(errors))
  } catch (error) {
    check('the harness ran to completion', false, error?.message || String(error))
  } finally {
    /* Cleanup may never decide the verdict. */
    try { session?.close() } catch { /* already gone */ }
    try { bridge?.server?.close() } catch { /* already gone */ }
    try {
      if (child && child.exitCode === null) {
        spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        await delay(1500)
      }
    } catch { /* the OS will reap it */ }
    try { rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) }
    catch { /* a held DLL is not a failed test */ }
  }

  const failed = results.filter(result => !result.pass)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`)
  if (failed.length > 0) {
    for (const result of failed) console.log(`  FAILED: ${result.name} ${result.detail}`)
    process.exitCode = 1
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
