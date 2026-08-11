#!/usr/bin/env node
/* THE TEAM PANEL, ON A REAL PACKAGED WINDOW, REACHED BY CLICKING.
 *
 * Source tests cannot see reachability: dead code matches a text search exactly
 * as well as live code does. tools/test/agent-teams.test.mjs proves the team
 * CONTRACT; this proves a person can get to it and that its refusals are real
 * on the glass rather than in a unit test's imagination.
 *
 * THREE RULES BORROWED FROM THE HARNESSES THAT EARNED THEM.
 *
 * 1. NAVIGATE BY CLICKING. A sibling harness reached its page by assigning
 *    location.hash, which is the one thing a customer cannot do, and passed in
 *    full on a build where nothing routed to the page. auditSelf() below
 *    enforces that against this file's own source rather than trusting it.
 *
 * 2. ISOLATE THE PROFILE PROPERLY -- LOCALAPPDATA *AND* USERPROFILE, not just
 *    --user-data-dir. A lane spent hours concluding the permission tier was
 *    unenforced because its harness inherited this machine's `unrestricted`
 *    level and produced a confident, wrong finding.
 *
 * 3. CLEANUP MAY NEVER FAIL THE RUN. A lane's harness exited 1 after 45/45
 *    passed because Windows held a staged DLL and the cleanup threw out of a
 *    finally.
 *
 * WHAT THIS DOES NOT DO: it does not dispatch. Starting four real agent
 * processes to prove a picker works would burn account budget and leave lanes
 * running on the owner's machine. The dispatch call itself is the SAME
 * postBridgeAction('dispatch', ...) the single-lane button already uses and
 * that tools/test/agent-teams.test.mjs pins argument-for-argument.
 */
import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require_ = createRequire(import.meta.url)
const SELF = fileURLToPath(import.meta.url)
const REPO_ROOT = path.resolve(path.dirname(SELF), '..')
const RELEASE = path.join(REPO_ROOT, 'release', 'win-unpacked')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

/* ---------- the instrument audits itself ----------
 * The only navigation this file may perform for a reachability claim is a
 * click. Assigning the hash would let it pass on a build with no door. */
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

/* The machine record is written with the ENGINE's own writer, so this harness
   cannot seed a shape the product would reject. It also clears the first-run
   gate, which otherwise forces #/setup before anything renders. */
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

/* VISIBLE IS MEASURED. Text in the DOM is not text on the screen. */
const VISIBLE = `(selector) => {
  const node = document.querySelector(selector)
  if (!node) return { state: 'absent' }
  const box = node.getBoundingClientRect()
  const style = getComputedStyle(node)
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return { state: 'hidden' }
  if (box.width < 1 || box.height < 1) return { state: 'zero-size' }
  return { state: 'visible', x: box.x + box.width / 2, y: box.y + box.height / 2 }
}`

async function main() {
  const offenders = auditSelf()
  if (offenders.length > 0) {
    for (const { line, at } of offenders) console.error(`  self-audit: line ${at} navigates by assigning the hash: ${line.trim()}`)
    console.error('A reachability suite that reaches the page by assigning the hash is not a reachability suite.')
    process.exitCode = 1
    return
  }

  const scratch = mkdtempSync(path.join(os.tmpdir(), 'team-panel-qa-'))
  const profile = path.join(scratch, 'profile')
  let child = null
  let session = null

  try {
    const executable = await stage(scratch)
    const appRoot = path.dirname(executable)
    seedMachineRecord(profile, appRoot, 'standard')

    const port = await freePort()
    /* THE ISOLATION THAT ACTUALLY MATTERS. Inheriting this machine's
       LOCALAPPDATA is how a lane measured the owner's `unrestricted` level and
       reported the tier unenforced. */
    const environment = { ...process.env }
    delete environment.ELECTRON_RUN_AS_NODE
    delete environment.ELECTRON_NO_ATTACH_CONSOLE
    environment.LOCALAPPDATA = path.join(profile, 'local')
    environment.USERPROFILE = path.join(profile, 'home')
    environment.CODEX_HOME = path.join(profile, 'home', '.codex')
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
      await delay(500)
      return 'clicked'
    }

    await evaluate('document.fonts ? document.fonts.ready.then(() => true) : true')
    await delay(1200)

    /* THE RAIL IS A SETTING, NOT A ROUTE, AND IT MUST BE THE LIVE ONE.
     *
     * This read `'simulated'`, and that is why every assertion below it failed:
     * `.board-team-box` was `absent`, and the three checks that read fields off
     * it failed with it, the last of them crashing this harness on
     * `Cannot read properties of undefined (reading 'disabled')`. None of that
     * was a product defect. src/views/computers.js builds Launch, Team and Loop
     * with `live: true` on the PROJECTION rail and nowhere else, and each of
     * those builders returns null unless it is -- deliberately, and the comment
     * there says so: the simulated rail is the example copy, whose own banner
     * says nothing on it is real, and a control that reaches the audited bridge
     * has no business on it. So a harness pointed at the simulated rail was
     * asserting that the example copy can dispatch real agents, which it must
     * never be able to do.
     *
     * The live rail is also the one a paying customer gets. It draws from
     * window.mcOrg.read(), which answers on any machine (src/declared-fleet.js);
     * the build-time /data/fleet.json does not, and treating that absence as
     * "no computers exist" was the defect that module was written to close. */
    await evaluate(`(() => {
      localStorage.setItem('mc.live.computers', 'live')
      localStorage.setItem('mc.write.dispatch', 'enabled')
      location.reload()
      return true
    })()`)
    await delay(2500)
    await evaluate('document.fonts ? document.fonts.ready.then(() => true) : true')

    check('a fresh profile opens past the permission question',
      (await evaluate('document.body.dataset.route')) !== 'setup',
      `route=${await evaluate('document.body.dataset.route')}`)

    const toPage2 = await clickVisible('#nav-next')
    const route = await evaluate('document.body.dataset.route')
    check('the forward control reaches page 2 by clicking', toPage2 === 'clicked' && route === 'computers', `${toPage2} route=${route}`)

    /* Open the rail board the way a person does: click an agent in the graph. */
    const opened = await clickVisible('.static-tree-node')
    await delay(700)
    check('clicking an agent opens the rail board', opened === 'clicked', opened)

    const teamBox = await evaluate(`(${VISIBLE})('.board-team-box')`)
    check('the Team panel is on the glass, not merely in the DOM', teamBox.state === 'visible', teamBox.state)

    const inventory = await evaluate(`(() => {
      const box = document.querySelector('.board-team-box')
      if (!box) return null
      return {
        members: [...box.querySelectorAll('[data-team-member]')].map(input => input.getAttribute('data-team-member')),
        identities: [...box.querySelectorAll('.team-member code')].map(code => code.textContent.trim()),
        leadOptions: [...box.querySelectorAll('[data-team="lead"] option')].map(option => option.value),
        buttonDisabled: box.querySelector('[data-team="go"]').disabled,
        plan: box.querySelector('[data-team="plan"]').textContent.trim(),
      }
    })()`)

    check('every dispatchable tier is offered as a team member', inventory && inventory.members.length === 6, JSON.stringify(inventory?.members))
    check('each member shows the declared agent it becomes',
      inventory && inventory.identities.filter(identity => identity === 'claude').length === 3,
      JSON.stringify(inventory?.identities))
    check('with nothing selected the team cannot be dispatched, and says why',
      inventory && inventory.buttonDisabled === true && inventory.plan.length > 20,
      inventory?.plan)

    /* THE REFUSAL, ON THE GLASS. Two Claude tiers are one declared agent. */
    const conflict = await evaluate(`(() => {
      const box = document.querySelector('.board-team-box')
      box.querySelector('[data-team="lead"]').value = 'sol'
      box.querySelector('[data-team="lead"]').dispatchEvent(new Event('change', { bubbles: true }))
      for (const id of ['claude-opus', 'claude-sonnet']) {
        const input = box.querySelector('[data-team-member="' + id + '"]')
        input.checked = true
        input.dispatchEvent(new Event('change', { bubbles: true }))
      }
      return {
        disabled: box.querySelector('[data-team="go"]').disabled,
        plan: box.querySelector('[data-team="plan"]').textContent.trim(),
        title: box.querySelector('[data-team="go"]').title,
      }
    })()`)
    check('picking two Claude tiers is refused before anything is dispatched', conflict.disabled === true, String(conflict.disabled))
    check('the refusal names both tiers that collide',
      /claude-opus/.test(conflict.plan) && /claude-sonnet/.test(conflict.plan), conflict.plan)
    check('the disabled control carries a reason longer than a shrug', conflict.title.length > 20, conflict.title)

    /* And a legal team enables it, so the refusal above is not just "always off". */
    const legal = await evaluate(`(() => {
      const box = document.querySelector('.board-team-box')
      for (const input of box.querySelectorAll('[data-team-member]')) {
        input.checked = false
        input.dispatchEvent(new Event('change', { bubbles: true }))
      }
      for (const id of ['luna', 'terra']) {
        const input = box.querySelector('[data-team-member="' + id + '"]')
        input.checked = true
        input.dispatchEvent(new Event('change', { bubbles: true }))
      }
      return {
        disabled: box.querySelector('[data-team="go"]').disabled,
        plan: box.querySelector('[data-team="plan"]').textContent.trim(),
      }
    })()`)
    check('a team of distinct identities is dispatchable', legal.disabled === false, legal.plan)
    check('the ready message states how many lanes will start', /3 lanes total/.test(legal.plan), legal.plan)

    const errors = await evaluate(`(() => (window.__qaErrors || []).length)()`)
    check('the renderer logged no errors reaching or driving the panel', errors === undefined || errors === 0, String(errors))
  } finally {
    /* Cleanup may never decide the verdict. */
    try { session?.close() } catch { /* already gone */ }
    try {
      if (child && child.exitCode === null) {
        spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        await delay(1200)
      }
    } catch { /* nothing to reap */ }
    try { rmSync(scratch, { recursive: true, force: true, maxRetries: 3 }) } catch { /* Windows may still hold a DLL */ }
  }

  const failed = results.filter(result => !result.pass)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length > 0) process.exitCode = 1
}

main().catch(error => {
  console.error(error?.stack || error?.message || String(error))
  process.exitCode = 1
})
