/* THE STRANGER'S RIG: one staged packaged build, sterile profiles, real clicks.
 *
 * WHAT THIS IS FOR. Three drivers in this directory ask the same three questions
 * of the same artifact -- can a second person use this product, can they see the
 * owner's things, and does the account boundary hold. Each of them needs a
 * packaged build staged with this tree's dist/ and shell/ in it, a data
 * directory that is emphatically NOT this machine's real installation, and a
 * debugger attached to the real window. Writing that three times would produce
 * three subtly different rigs and the first disagreement between them would be
 * read as a product defect.
 *
 * IT IS NOT ITSELF A DRIVER. tools/packaged-qa-suite.mjs discovers membership by
 * globbing for `-qa.(mjs|cjs)`; this file deliberately does not match, so the
 * suite runs the three drivers and never tries to run the rig.
 *
 * WHAT IT REFUSES TO DO.
 *
 * - It never touches the real installation. Every launch is given an explicit
 *   --user-data-dir under a scratch directory, and `assertIsolated` afterwards
 *   finds the file the app actually wrote and fails the run if it landed
 *   anywhere else. Overriding APPDATA does NOT move userData (Electron resolves
 *   the Windows known folder), so the switch is the mechanism and the written
 *   file is the proof. A confident finding taken from this machine's own state
 *   would be a finding about the wrong computer.
 *
 * - It never prints a password. `generatedPassword()` returns bytes from
 *   crypto.randomBytes and the only thing that ever happens to the value is
 *   being typed into a field over the debugger. Nothing in this file logs it,
 *   returns it in a result object, or writes it to a log path. A test-account
 *   password in a QA log is a credential in a QA log.
 *
 * - It never claims a launch from an exit code. `openWindow` records a timeline
 *   -- spawn time, pid, the moment a debuggable page answered, exit code and
 *   exit time, and the tail of stdout/stderr -- because the acceptance matrix
 *   this lane reuses (Desktop MACHINE-B-REPLACEMENT-BUILD-ACCEPTANCE-MATRIX.md)
 *   names "exit code 0" and "empty stdout" as evidence that is not sufficient.
 *   A window that never appeared reports `windowAt: null`, not a pass.
 *
 * ELECTRON_RUN_AS_NODE IS DELETED FROM EVERY CHILD ENVIRONMENT. It is set in the
 * environment these drivers are launched from. Inherited, the packaged
 * executable starts as a bare Node process with no `app` object, no window, and
 * an exit code that reads like an ordinary failure.
 */

import { spawn, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require_ = createRequire(import.meta.url)
const SELF = fileURLToPath(import.meta.url)
export const REPO_ROOT = path.resolve(path.dirname(SELF), '..')

export const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

export function argument(name, fallback = null) {
  const inline = process.argv.find(value => value.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const at = process.argv.indexOf(name)
  return at === -1 ? fallback : (process.argv[at + 1] ?? fallback)
}

/* --release is read here so every driver in this family answers it identically.
   packaged-qa-suite refuses to run with --release if any driver would silently
   measure its own default build instead. */
export function releaseDirectory() {
  return path.resolve(argument('--release') || path.join(REPO_ROOT, 'release', 'win-unpacked'))
}

export const VISIBLE = process.argv.includes('--visible')

/* ---------------------------------------------------------------- results -- */

export function createLedger() {
  const results = []
  return {
    results,
    check(name, pass, detail = '') {
      results.push({ name, pass: pass === true, detail: String(detail) })
      console.log(`${pass === true ? '  ok  ' : '  FAIL'} ${name}${detail ? `  ${detail}` : ''}`)
      return pass === true
    },
    /* A fact worth preserving that is not itself a pass/fail. Kept out of the
       count so an observation cannot pad the score. */
    note(text) { console.log(`  --    ${text}`) },
    finish(label) {
      const failed = results.filter(result => !result.pass)
      console.log(`\n${results.length - failed.length}/${results.length} checks passed${label ? ` (${label})` : ''}`)
      if (failed.length > 0) {
        console.log('FAILING CHECKS:')
        for (const result of failed) console.log(`  - ${result.name}${result.detail ? `  ${result.detail}` : ''}`)
        process.exitCode = 1
      }
      return failed.length
    },
  }
}

/* ---------------------------------------------------------------- secrets -- */

/* Bytes, not a phrase. Long enough to clear MIN_PASSWORD_LENGTH with room, and
   never derived from anything in this file, so a reader of this source cannot
   reconstruct the account it creates. The value is returned to the caller and
   goes exactly one place: an Input.insertText over the local debugger. */
export function generatedPassword() {
  return crypto.randomBytes(24).toString('base64url')
}

/* --------------------------------------------------------------- staging -- */

function appExecutable(appRoot) {
  const executables = readdirSync(appRoot).filter(entry => entry.toLowerCase().endsWith('.exe'))
  if (executables.length === 1) return path.join(appRoot, executables[0])
  const launcher = executables.find(entry => !/^(elevate|squirrel|crashpad)/i.test(entry))
  if (!launcher) throw new Error(`cannot tell which of these is the launcher: ${executables.join(', ')}`)
  return path.join(appRoot, launcher)
}

/**
 * A real packaged build carrying THIS tree's renderer and shell.
 *
 * Rebuilding the installer per run costs minutes and an electron-builder lock,
 * and `npm run dist` is shared with other lanes; repacking the archive keeps the
 * artifact real -- same exe, same resources/capability, same asar -- while
 * measuring the code under test. This is the same staging the sibling checkout
 * driver uses, so a disagreement between them is about the product.
 */
export async function stage(scratch, release = releaseDirectory()) {
  const asar = require_(path.join(REPO_ROOT, 'node_modules', '@electron', 'asar'))
  const app = path.join(scratch, 'app')
  const unpacked = path.join(scratch, 'asar-stage')
  if (!existsSync(path.join(release, 'resources', 'app.asar'))) {
    throw new Error(`no packaged build at ${release}. Run \`npm run dist\` first.`)
  }
  cpSync(release, app, { recursive: true, dereference: true })
  asar.extractAll(path.join(app, 'resources', 'app.asar'), unpacked)
  for (const directory of ['dist', 'shell']) {
    const from = path.join(REPO_ROOT, directory)
    if (!existsSync(from)) throw new Error(`${directory}/ is missing; run \`npm run build\` first`)
    rmSync(path.join(unpacked, directory), { recursive: true, force: true })
    cpSync(from, path.join(unpacked, directory), { recursive: true })
  }
  cpSync(path.join(REPO_ROOT, 'package.json'), path.join(unpacked, 'package.json'))
  await asar.createPackage(unpacked, path.join(app, 'resources', 'app.asar'))
  return { executable: appExecutable(app), appRoot: app, archive: path.join(app, 'resources', 'app.asar') }
}

/** The permission-level record a fresh install would otherwise stop to ask for. */
export function seedMachineRecord(profile, appRoot, tier = 'standard') {
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
}

/* --------------------------------------------------------------- profiles -- */

export const userDataFor = profile => path.join(profile, 'userdata')
export const accountsFileFor = profile => path.join(userDataFor(profile), 'product-accounts.json')
export const sessionFileFor = profile => path.join(userDataFor(profile), 'product-session.enc')
export const prefsFileFor = profile => path.join(userDataFor(profile), 'renderer-prefs.json')

export function environmentFor(profile) {
  const environment = { ...process.env }
  /* Both deleted deliberately. ELECTRON_RUN_AS_NODE turns the packaged
     executable into a Node process with no app object; the console flag makes a
     child steal a console window on a machine somebody is working on. */
  delete environment.ELECTRON_RUN_AS_NODE
  delete environment.ELECTRON_NO_ATTACH_CONSOLE
  if (VISIBLE) delete environment.MC_SMOKE_HEADLESS
  else environment.MC_SMOKE_HEADLESS = '1'
  environment.LOCALAPPDATA = path.join(profile, 'local')
  environment.APPDATA = path.join(profile, 'roaming')
  environment.USERPROFILE = path.join(profile, 'home')
  environment.CODEX_HOME = path.join(profile, 'home', '.codex')
  mkdirSync(environment.APPDATA, { recursive: true })
  mkdirSync(environment.CODEX_HOME, { recursive: true })
  return environment
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

/* ------------------------------------------------------------------- CDP -- */

function createSession(port, child, timeline) {
  let socket = null
  let nextId = 1
  const pending = new Map()
  return {
    async open() {
      /* 90s. This machine routinely has other Electron windows up from peer
         lanes, and a harness that gives up early reports a busy machine as a
         broken build. */
      for (let attempt = 0; attempt < 180; attempt += 1) {
        if (child.exitCode !== null) {
          throw new Error(`the app exited with code ${child.exitCode} before the debugger answered`)
        }
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
            timeline.windowAt = Date.now()
            timeline.pageUrl = page.url || null
            return
          }
        } catch { /* not listening yet */ }
        await delay(500)
      }
      throw new Error('no debuggable page appeared within 90s')
    },
    send(method, params = {}) {
      const id = nextId++
      socket.send(JSON.stringify({ id, method, params }))
      return new Promise(resolve => pending.set(id, resolve))
    },
    close() { try { socket?.close() } catch { /* already gone */ } },
  }
}

/* VISIBLE IS MEASURED, because text in the DOM is not text on the screen.
 *
 * AND OFFSCREEN IS NOT VISIBLE EITHER, which cost this rig its first run. The
 * obvious version of this function returns the centre of the bounding box and
 * calls anything with a non-zero box visible. A closed settings drawer parked
 * to the right of the viewport, and a Finish button below the fold of a long
 * review page, both satisfy that -- so the harness dispatched clicks at
 * coordinates outside the window, hit nothing, read "clicked", and reported the
 * product as having a walkthrough that cannot be finished and a preference that
 * does not persist. Two false REDs from one missing comparison.
 *
 * So the element is scrolled into view the way a person scrolls to it, the box
 * is re-measured AFTER the scroll, and the point that will be clicked must be
 * inside the viewport and must be the element itself (or one of its own
 * children) under `elementFromPoint`. A control another layer is covering is
 * not clickable, and saying so is the whole job. */
const VISIBLE_FN = `(selector) => {
  const node = document.querySelector(selector)
  if (!node) return { state: 'absent' }
  const style = getComputedStyle(node)
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return { state: 'hidden' }
  try { node.scrollIntoView({ block: 'center', inline: 'center' }) } catch (error) { /* detached */ }
  const box = node.getBoundingClientRect()
  if (box.width < 1 || box.height < 1) return { state: 'zero-size' }
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) {
    return { state: 'offscreen', box: { x: box.x, y: box.y, w: box.width, h: box.height }, viewport: { w: innerWidth, h: innerHeight } }
  }
  const hit = document.elementFromPoint(x, y)
  if (!hit || !(hit === node || node.contains(hit) || hit.contains(node))) {
    return { state: 'covered', by: hit ? (hit.tagName + (hit.className ? '.' + String(hit.className).split(' ')[0] : '')) : 'nothing' }
  }
  return { state: 'visible', x, y }
}`

/**
 * Start the packaged application on a sterile profile and attach to its window.
 *
 * Returns the driving surface AND the timeline. Every caller that asserts "it
 * launched" is expected to quote the timeline rather than the absence of an
 * error.
 */
export async function openWindow(executable, profile, { extraArgs = [] } = {}) {
  const port = await freePort()
  const timeline = {
    spawnedAt: Date.now(), pid: null, windowAt: null, exitCode: null, exitedAt: null,
    stdout: '', stderr: '',
  }
  const child = spawn(executable, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataFor(profile)}`,
    ...extraArgs,
  ], { env: environmentFor(profile), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  timeline.pid = child.pid
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => { timeline.stdout = (timeline.stdout + chunk).slice(-8000) })
  child.stderr.on('data', chunk => { timeline.stderr = (timeline.stderr + chunk).slice(-8000) })
  child.on('exit', code => { timeline.exitCode = code; timeline.exitedAt = Date.now() })

  const session = createSession(port, child, timeline)
  await session.open()

  const evaluate = async expression => {
    const packet = await session.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (packet?.result?.exceptionDetails) {
      return { __evaluateThrew: String(packet.result.exceptionDetails.exception?.description || 'exception') }
    }
    return packet?.result?.result?.value
  }
  /* Measured TWICE with a pause between, because the first call is what does the
     scrolling and a page with CSS `scroll-behavior: smooth` has not arrived yet
     when the first rect is taken. The second measurement is the one that
     decides. */
  const visibility = async selector => {
    const first = await evaluate(`(${VISIBLE_FN})(${JSON.stringify(selector)})`)
    if (first?.state === 'absent' || first?.state === 'hidden') return first
    await delay(260)
    return evaluate(`(${VISIBLE_FN})(${JSON.stringify(selector)})`)
  }
  /* WAITED FOR, NOT SAMPLED ONCE.
   *
   * Measured on this build, headless: the settings drawer takes the `open`
   * class in the same frame as the click and its computed transform is still at
   * the parked translateX(342px) 700ms later, arriving at translateX(0)
   * somewhere before 1500ms -- with a transition duration of 0.12s. A window
   * started with `show: false` is not compositing, so style and transition work
   * is deferred, and a harness that measured once at 450ms would have reported
   * "the settings drawer opens off the right edge of the window", which is a
   * serious-sounding RED about the harness. So the state is polled until the
   * element is genuinely on screen, and the last state seen is what gets
   * returned when it never is. */
  const waitForVisible = async (selector, timeoutMs = 8000) => {
    const until = Date.now() + timeoutMs
    let last = null
    for (;;) {
      last = await visibility(selector)
      if (last?.state === 'visible' || Date.now() >= until) return last
      await delay(250)
    }
  }
  const clickVisible = async (selector, { timeoutMs = 8000 } = {}) => {
    const spot = await waitForVisible(selector, timeoutMs)
    /* A refusal says WHAT refused. "covered" on its own sent a lane looking for
       a routing defect when the answer was the name of the element sitting on
       top of the control. */
    if (spot?.state === 'covered') return `covered-by-${spot.by}`
    if (spot?.state === 'offscreen') return `offscreen-${JSON.stringify(spot.box)}-in-${JSON.stringify(spot.viewport)}`
    if (spot?.state !== 'visible') return spot?.state || 'unknown'
    for (const type of ['mousePressed', 'mouseReleased']) {
      await session.send('Input.dispatchMouseEvent', { type, x: spot.x, y: spot.y, button: 'left', clickCount: 1 })
    }
    await delay(450)
    return 'clicked'
  }
  /* Typing, not assignment. A value assigned to `input.value` fires no events;
     a form that reads its fields on submit would still see it, but a form that
     validated as you type would not, and the difference is exactly the kind of
     thing a harness must not paper over. The field is focused by clicking it. */
  const typeInto = async (selector, text) => {
    const clicked = await clickVisible(selector)
    if (clicked !== 'clicked') return clicked
    await session.send('Input.insertText', { text })
    await delay(120)
    return 'typed'
  }
  await delay(2400)
  await evaluate('document.fonts ? document.fonts.ready.then(() => true) : true')
  return { child, session, timeline, evaluate, visibility, waitForVisible, clickVisible, typeInto, port }
}

export function reap(pid) {
  if (!pid) return
  try {
    spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 30_000 })
  } catch { /* the tree is already gone */ }
}

/**
 * Close the window the way a person closes it, and wait for the process to go.
 *
 * `window.close()` from the page runs the app's own close path -- which is what
 * a normal close/relaunch cycle has to exercise -- and the reap is the backstop
 * for a build that ignores it. Which of the two ended it is recorded, because
 * "the app would not close on its own" is a finding, not a detail.
 */
export async function closeWindow(window, { graceful = true, waitMs = 9000 } = {}) {
  if (!window) return null
  const { timeline, child } = window
  if (graceful) {
    try { await window.evaluate('window.close()') } catch { /* the page may already be gone */ }
  }
  const until = Date.now() + waitMs
  while (child.exitCode === null && Date.now() < until) await delay(250)
  timeline.closedGracefully = child.exitCode !== null
  try { window.session?.close() } catch { /* already gone */ }
  if (child.exitCode === null) {
    reap(child.pid)
    await delay(1200)
  }
  return timeline
}

export function describeTimeline(timeline) {
  if (!timeline) return 'no timeline'
  const window = timeline.windowAt ? `${timeline.windowAt - timeline.spawnedAt}ms` : 'NEVER'
  const exit = timeline.exitedAt ? `${timeline.exitCode} after ${timeline.exitedAt - timeline.spawnedAt}ms` : 'still running'
  return `pid=${timeline.pid} window=${window} exit=${exit} graceful=${timeline.closedGracefully === true}`
}

/**
 * Prove this run is reading a sterile data directory rather than the machine's
 * own installation. The app writes renderer-prefs.json into userData at startup,
 * so the file's location is the answer. Belief is not accepted here: a lane once
 * spent hours on a confident, wrong finding taken from inherited state.
 */
export function assertIsolated(profile) {
  const prefs = prefsFileFor(profile)
  if (!existsSync(prefs)) {
    throw new Error(`the app did not write ${prefs}; refusing to report on a data directory this run cannot locate`)
  }
  const real = path.join(process.env.APPDATA || '', 'ToolsEnabled')
  if (real && path.resolve(prefs).toLowerCase().startsWith(path.resolve(real).toLowerCase())) {
    throw new Error('this run is reading the real installation; refusing to continue')
  }
  return prefs
}

/* ------------------------------------------------------- driving the app -- */

export async function route(window) {
  return window.evaluate('document.body.dataset.route')
}

/** Everything the window is actually showing, as text, for a privacy read. */
export async function screenText(window) {
  const value = await window.evaluate('document.body.innerText || ""')
  return typeof value === 'string' ? value : ''
}

/**
 * Walk the ring forward by clicking the arrow, recording every stop.
 *
 * NAVIGATION IS BY CLICKING. A sibling harness reached its page by assigning
 * location.hash and passed on a build where nothing routed there.
 */
export async function walkRing(window, steps = 10) {
  const visited = []
  for (let step = 0; step < steps; step += 1) {
    const clicked = await window.clickVisible('#nav-next')
    if (clicked !== 'clicked') return { visited, clicked }
    await delay(400)
    visited.push({ route: await route(window), text: await screenText(window) })
  }
  return { visited, clicked: 'clicked' }
}

/* ---------------------------------------------------- getting about ------- *
 *
 * THE ONLY NAVIGATION THIS PRODUCT HAS IS TWO ARROWS, A GEAR, AND THE LINKS ON
 * THE PAGES. These helpers use exactly those. They live here rather than in each
 * driver because two copies of "how to reach the sign-in screen" is two copies
 * that disagree the first time the route changes, and the disagreement would be
 * reported as a product defect.
 *
 * THE DRAWER IS A MODAL AND IT COVERS THE TOOLBAR IT WAS OPENED FROM. It is
 * `role="dialog" aria-modal="true"`, and the shell parks the header and the
 * stage behind it with `inert`. A run that opened it to change a theme and then
 * walked away had every later click land on the drawer's backdrop -- which
 * reported as "the purchase screen is not on the ring" and ten other findings
 * that were about the harness. So its state is asked, never assumed.
 */

export async function drawerIsOpen(window) {
  return (await window.evaluate('Boolean(document.querySelector("#drawer.open"))')) === true
}

export async function openDrawer(window) {
  if (await drawerIsOpen(window)) return 'already-open'
  const clicked = await window.clickVisible('#open-settings')
  await delay(900)
  return clicked
}

export async function closeDrawer(window) {
  if (!(await drawerIsOpen(window))) return 'already-closed'
  const clicked = await window.clickVisible('#close-settings', { timeoutMs: 4000 })
  await delay(800)
  /* The drawer's state, not the click, is the answer: navigating away closes it
     on its own and the close button goes offstage with it. */
  return (await drawerIsOpen(window)) ? `still-open:${clicked}` : 'closed'
}

/** Back to the home screen from wherever this is, by clicking only. */
export async function gotoHome(window) {
  await closeDrawer(window)
  const here = await route(window)
  if (here === 'home') return 'already-there'
  if (here === 'account' || here === 'setup') {
    const back = await window.clickVisible('[data-account-home]', { timeoutMs: 5000 })
    if (back === 'clicked') { await delay(1100); if ((await route(window)) === 'home') return 'clicked' }
  }
  for (let step = 0; step < 12; step += 1) {
    if ((await route(window)) === 'home') return 'clicked'
    const next = await window.clickVisible('#nav-next')
    if (next !== 'clicked') return `arrow:${next}`
    await delay(420)
  }
  return `stuck-on-${await route(window)}`
}

/* Reach the full settings page: toolbar gear, then "all settings".
 *
 * FROM HOME, DELIBERATELY. Measured on this build: on the settings route the
 * floating `a.fleet-profile-notice` is painted over the bottom-right corner
 * where the drawer's own "all settings" link sits, so `elementFromPoint` there
 * returns the notice. home.css hides that notice on the home route, so the same
 * gesture works from home every time. Drivers that care about the overlap
 * measure it on its own rather than inferring it from a navigation failure. */
export async function gotoSettings(window) {
  if ((await route(window)) === 'settings') {
    await closeDrawer(window)
    return 'already-there'
  }
  const home = await gotoHome(window)
  if (home !== 'clicked' && home !== 'already-there') return `home:${home}`
  const opened = await openDrawer(window)
  if (opened !== 'clicked' && opened !== 'already-open') return `gear:${opened}`
  const all = await window.clickVisible('.drawer-all')
  if (all !== 'clicked') return `all-settings:${all}`
  await delay(1800)
  await closeDrawer(window)
  const landed = await route(window)
  return landed === 'settings' ? 'clicked' : `landed-on-${landed}`
}

/** Reach the sign-in surface: settings, then "Open sign-in". */
export async function gotoAccount(window) {
  if ((await route(window)) === 'account') return 'already-there'
  const settings = await gotoSettings(window)
  if (settings !== 'clicked' && settings !== 'already-there') return `settings:${settings}`
  const link = await window.clickVisible('a.ctl-btn[href="#/account"]')
  if (link !== 'clicked') return `sign-in-link:${link}`
  /* The account view paints a loading state first and repaints when the shell
     answers, so the form is waited for rather than assumed to be there. */
  await delay(1800)
  const landed = await route(window)
  if (landed !== 'account') return `landed-on-${landed}`
  await window.waitForVisible('[data-account-home]', 6000)
  return 'clicked'
}

/* ------------------------------------------- the account forms, by hand --- *
 *
 * EVERY STEP REPORTS WHICH STEP IT WAS. The first version of these collapsed
 * "reach the screen, switch the form, type, submit" into one boolean; when it
 * went red the report said only that something in a four-step sequence had not
 * worked, which is a fault report nobody can act on.
 *
 * The password is a parameter and goes exactly one place: an Input.insertText
 * over the local debugger. Nothing here logs it or returns it.
 */

export async function createAccountOnScreen(window, person, password) {
  const reached = await gotoAccount(window)
  if (reached !== 'clicked' && reached !== 'already-there') return `reach-account:${reached}`
  const creating = await window.evaluate('Boolean(document.querySelector(\'[data-account-form="create"]\'))')
  if (creating !== true) {
    const swap = await window.clickVisible('[data-account-mode="create"]')
    if (swap !== 'clicked') return `switch-to-create:${swap}`
    await delay(800)
  }
  const name = await window.typeInto('[data-account-form="create"] [name="username"]', person.username)
  if (name !== 'typed') return `username:${name}`
  if (person.displayName) {
    const shown = await window.typeInto('[data-account-form="create"] [name="displayName"]', person.displayName)
    if (shown !== 'typed') return `displayName:${shown}`
  }
  const secret = await window.typeInto('[data-account-form="create"] [name="password"]', password)
  if (secret !== 'typed') return `password-field:${secret}`
  const submitted = await window.clickVisible('[data-account-form="create"] button[type="submit"]')
  if (submitted !== 'clicked') return `submit:${submitted}`
  /* scrypt at N=2^17 twice -- once to create, once to sign in. */
  await delay(11000)
  return 'submitted'
}

export async function signInOnScreen(window, person, password) {
  const reached = await gotoAccount(window)
  if (reached !== 'clicked' && reached !== 'already-there') return `reach-account:${reached}`
  const signingIn = await window.evaluate('Boolean(document.querySelector(\'[data-account-form="sign-in"]\'))')
  if (signingIn !== true) {
    const swap = await window.clickVisible('[data-account-mode="sign-in"]')
    if (swap !== 'clicked') return `switch-to-sign-in:${swap}`
    await delay(800)
  }
  const name = await window.typeInto('[data-account-form="sign-in"] [name="username"]', person.username)
  if (name !== 'typed') return `username:${name}`
  const secret = await window.typeInto('[data-account-form="sign-in"] [name="password"]', password)
  if (secret !== 'typed') return `password-field:${secret}`
  const submitted = await window.clickVisible('[data-account-form="sign-in"] button[type="submit"]')
  if (submitted !== 'clicked') return `submit:${submitted}`
  await delay(7000)
  return 'submitted'
}

export async function signOutOnScreen(window, { everywhere = false } = {}) {
  const reached = await gotoAccount(window)
  if (reached !== 'clicked' && reached !== 'already-there') return `reach-account:${reached}`
  const selector = everywhere ? '[data-account-sign-out-everywhere]' : '[data-account-sign-out]'
  const clicked = await window.clickVisible(selector)
  if (clicked !== 'clicked') return `sign-out-button:${clicked}`
  await delay(2200)
  return 'clicked'
}

export async function changePasswordOnScreen(window, currentPassword, newPassword) {
  const reached = await gotoAccount(window)
  if (reached !== 'clicked' && reached !== 'already-there') return `reach-account:${reached}`
  const onForm = await window.evaluate('Boolean(document.querySelector(\'[data-account-form="change-password"]\'))')
  if (onForm !== true) {
    const swap = await window.clickVisible('[data-account-mode="change-password"]')
    if (swap !== 'clicked') return `switch-to-change:${swap}`
    await delay(900)
  }
  const now = await window.typeInto('[data-account-form="change-password"] [name="currentPassword"]', currentPassword)
  if (now !== 'typed') return `current-password-field:${now}`
  const next = await window.typeInto('[data-account-form="change-password"] [name="newPassword"]', newPassword)
  if (next !== 'typed') return `new-password-field:${next}`
  const submitted = await window.clickVisible('[data-account-form="change-password"] button[type="submit"]')
  if (submitted !== 'clicked') return `submit:${submitted}`
  await delay(11000)
  return 'submitted'
}

/** The account state as the page itself sees it -- the same read the view does. */
export async function accountState(window) {
  return window.evaluate(`(async () => {
    const bridge = globalThis.mcAccount
    if (!bridge) return { bridge: false }
    const [availability, current] = await Promise.all([
      bridge.availability().catch(error => ({ threw: String(error && error.message) })),
      bridge.current().catch(error => ({ threw: String(error && error.message) })),
    ])
    return { bridge: true, availability, current }
  })()`)
}

/* -------------------------------------------------------------- scratch --- */

export function scratchDirectory(prefix) {
  /* Under the OS temp dir, never under the repository. artifacts/ is not
     gitignored, tools/require-clean-tree.mjs refuses to build from a dirty tree,
     and a harness that wrote its own evidence in-tree would break `npm run dist`
     every time it ran. */
  const base = process.env.TEST_ACCOUNT_QA_SCRATCH || os.tmpdir()
  mkdirSync(base, { recursive: true })
  const directory = path.join(base, `${prefix}-${crypto.randomBytes(5).toString('hex')}`)
  mkdirSync(directory, { recursive: true })
  return directory
}

export function writeEvidence(scratch, name, body) {
  const file = path.join(scratch, name)
  writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body, null, 2), 'utf8')
  return file
}

export function readJsonIfPresent(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null }
}
