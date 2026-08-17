#!/usr/bin/env node

/* THE FOUR THINGS THE OWNER FOUND BY HAND, ASKED THE WAY HE ASKED THEM.
 *
 * "I REFUSE TO BELIEVE YOU THAT ANYTHING WORKS UNTIL YOU CLICK THROUGH IT AND
 * USE IT IN PRODUCTION YOURSELF ... IT HAS TO BE DONE AS A REAL USER WOULD, NOT
 * WITH DOM ELEMENTS, WITH REAL KEYBOARD AND MOUSE CLICKS."
 *
 * So every press in this file is a mouse at a coordinate: move, down, up. There
 * is no el.click(), no dispatchEvent, and nothing is assigned to `.value`.
 * Before every press the point under the cursor is read with
 * document.elementFromPoint and RECORDED, because a press that lands on
 * something else is the finding -- three of the four defects below are exactly
 * that shape, and a harness that clicks by selector cannot see any of them.
 *
 * WHAT IT MEASURES
 *
 *   1  THE EFFORT MENU CAN BE REACHED BY A MOUSE. "How hard should it think?"
 *      resolved through elementFromPoint to div.agent-compose-actions -- the
 *      Start bar was on top of it. Measured at two window sizes, because the
 *      panel is a column in a clipping rail and the overlap is a geometry
 *      question, not a markup question.
 *   2  THE FLEET OVERVIEW COUNTS WHAT IS ACTUALLY THERE. "0 Agents on record"
 *      beside agents that ran.
 *   3  A REFUSAL CARRIES ITS REAL REASON. Starting a Claude tier from a tree
 *      cannot work (shell/agent-host.cjs raises AGENT_TIER_NO_LAUNCHER, and
 *      that is honest); the panel was painting "this copy was not told why" and
 *      telling the person to try again, which can never work.
 *   4  "TURN ON AGENT SESSIONS IN SETTINGS" LANDS ON THE SETTING. It landed at
 *      the top of a 219-control page with the control far below the fold.
 *
 * TWO RUNS, TWO ENVIRONMENTS, AND THE SECOND ONE IS WHY.
 *
 * Run A is providerless: PATH is cut back to the Windows system directories and
 * APPDATA/LOCALAPPDATA/USERPROFILE/CODEX_HOME point into this run's scratch, so
 * no assistant program can be resolved and no provider budget can be spent. The
 * borrowed fence is tools/agent-start-flow-qa.mjs's, measured rather than
 * reasoned. The one Start this file presses names a CLAUDE tier, which the host
 * refuses before anything is spawned, so even a mistake in the fence could not
 * start a paid session.
 *
 * Run B additionally puts a scratch directory on PATH holding a `codex.cmd`
 * that prints a version and exits. shell/agent-host.cjs codexCommandIsMissing()
 * answers PRESENCE by stat, without spawning anything, so this is enough to
 * make the app's own availability probe say the engine is ready -- which is the
 * state the home screen's "Turn on agent sessions in Settings" link exists in.
 * Nothing in run B starts an agent, so the stub is never executed. Without it
 * the link is simply not on the screen and defect 4 could not be driven at all.
 *
 * A HARNESS MISTAKE IS NEVER REPORTED AS A PRODUCT DEFECT. Staging refuses on a
 * stale dist/ (assertRendererMeasurable), the run refuses if the window never
 * mounts a view, and every check that could not be exercised is reported as NOT
 * EXERCISED rather than as a pass or a failure.
 *
 * USAGE
 *   node tools/owner-walkthrough-drive.mjs
 *   node tools/owner-walkthrough-drive.mjs --visible      show the window
 *   node tools/owner-walkthrough-drive.mjs --keep         keep the scratch tree
 *
 * EXIT  0 everything measured passed · 1 a check failed · 2 the harness could
 *       not run · 3 nothing failed but something could not be exercised.
 */

import { createRequire } from 'node:module'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { REPO_ROOT, seedMachineRecord, scratchDirectory, stage } from './test-account-harness.mjs'
import { START_PANEL, START_REFUSAL, TIER_CHOICES } from '../src/fleet-tree-copy.js'
import { UNAVAILABLE_TEXT } from '../src/agent-availability-copy.js'

const SELF = fileURLToPath(import.meta.url)
const VISIBLE = process.argv.includes('--visible')
const KEEP = process.argv.includes('--keep')
const STARTED_AT = Date.now()

/* Playwright lives in the canonical checkout beside this one rather than in
   this repository's own node_modules; the path is overridable so a machine that
   keeps it somewhere else does not have to edit this file. */
const PLAYWRIGHT_ROOT = process.env.MC_PLAYWRIGHT_ROOT
  || 'C:/Users/joshp/Desktop/toolsenabled-current'
const require_ = createRequire(path.join(PLAYWRIGHT_ROOT, 'package.json'))

class HarnessError extends Error {}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

/* ------------------------------------------------------------- the ledger -- */

const checks = []
function check(name, pass, detail = '') {
  checks.push({ name, state: pass === true ? 'pass' : 'fail', detail: String(detail) })
  console.log(`  ${pass === true ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`)
  return pass === true
}
function pending(name, why) {
  checks.push({ name, state: 'pending', detail: String(why) })
  console.log(`  ....  ${name}  -- NOT EXERCISED: ${why}`)
}
function note(text) { console.log(`  --    ${text}`) }

function report() {
  const failed = checks.filter(entry => entry.state === 'fail')
  const notRun = checks.filter(entry => entry.state === 'pending')
  console.log(`\n${checks.length - failed.length - notRun.length}/${checks.length} checks passed in ${((Date.now() - STARTED_AT) / 1000).toFixed(1)}s`)
  for (const entry of failed) console.log(`  FAILED:        ${entry.name}  -- ${entry.detail}`)
  for (const entry of notRun) console.log(`  NOT EXERCISED: ${entry.name}  -- ${entry.detail}`)
  if (failed.length > 0) return 1
  if (notRun.length > 0) return 3
  return 0
}

/* ------------------------------------------------------- the environments -- */

function baseEnvironment(profile) {
  const environment = { ...process.env }
  for (const key of Object.keys(environment)) {
    if (/^(path|appdata|localappdata|userprofile|home|homepath|homedrive|codex_home|mission_control_engine)$/i.test(key)) {
      delete environment[key]
    }
  }
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  const systemPath = [
    path.join(systemRoot, 'system32'),
    systemRoot,
    path.join(systemRoot, 'System32', 'Wbem'),
    path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0'),
  ]
  environment.PATH = systemPath.join(';')
  environment.APPDATA = path.join(profile, 'roaming')
  environment.LOCALAPPDATA = path.join(profile, 'local')
  environment.USERPROFILE = path.join(profile, 'home')
  environment.CODEX_HOME = path.join(profile, 'home', '.codex')
  for (const leaf of ['roaming', 'local', 'home', path.join('home', '.codex'), 'userdata']) {
    mkdirSync(path.join(profile, leaf), { recursive: true })
  }
  /* Inherited, the packaged executable starts as a bare Node process with no
     app object and an exit code that reads like an ordinary failure. */
  delete environment.ELECTRON_RUN_AS_NODE
  delete environment.ELECTRON_NO_ATTACH_CONSOLE
  if (VISIBLE) delete environment.MC_SMOKE_HEADLESS
  else environment.MC_SMOKE_HEADLESS = '1'
  return { environment, systemPath }
}

function providerlessEnvironment(profile) {
  return baseEnvironment(profile).environment
}

/* PRESENCE ONLY, AND IT IS NEVER RUN. codexCommandIsMissing() stats
   `codex.cmd` on PATH; nothing in run B starts a session, so this file is
   looked at and not executed. */
function engineReadyEnvironment(profile) {
  const { environment, systemPath } = baseEnvironment(profile)
  const bin = path.join(profile, 'bin')
  mkdirSync(bin, { recursive: true })
  writeFileSync(path.join(bin, 'codex.cmd'), '@echo codex-cli 0.0.0-presence-stub\r\n', 'utf8')
  environment.PATH = [...systemPath, bin].join(';')
  /* AND THE SIGN-IN, WHICH IS ALSO ONLY EVER LOOKED FOR. At an isolated
     permission level the probe refuses unless CODEX_HOME holds an auth.json
     (confinedSessionIsSignedOut in shell/agent-host.cjs). It checks existence
     and nothing else, and this run starts no session, so a placeholder file in
     a scratch directory is enough to put the home screen into the state the
     link under test lives in. It authenticates nothing and is deleted with the
     scratch tree. */
  writeFileSync(path.join(environment.CODEX_HOME, 'auth.json'), '{}\n', 'utf8')
  return environment
}

/* ------------------------------------------------------------- the window -- */

async function openApp(executable, profile, environment) {
  const { _electron } = require_('playwright')
  const userData = path.join(profile, 'userdata')
  const app = await _electron.launch({
    executablePath: executable,
    args: [`--user-data-dir=${userData}`],
    env: environment,
    timeout: 120_000,
  })
  const page = await app.firstWindow({ timeout: 120_000 })
  const thrown = []
  page.on('pageerror', error => { thrown.push(String(error?.message || error)) })
  return { app, page, thrown }
}

async function closeApp(open) {
  if (!open) return
  try { await open.app.close() } catch { /* already gone */ }
}

/** Set the window to a real size, the way a person's window has one. */
async function resizeTo(open, width, height) {
  /* Unmaximised first, deliberately: setContentSize on a MAXIMISED window is
     accepted and does nothing, so the second size in a sweep silently measured
     the first one again -- two identical measurements reported as two sizes. */
  await open.app.evaluate(({ BrowserWindow }, size) => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window) return null
    if (window.isMaximized()) window.unmaximize()
    if (window.isFullScreen()) window.setFullScreen(false)
    window.setContentSize(size.width, size.height)
    return window.getContentSize()
  }, { width, height })
  await delay(900)
  return open.page.evaluate('({ w: innerWidth, h: innerHeight })')
}

async function waitForView(open, budgetMs = 90_000) {
  const until = Date.now() + budgetMs
  while (Date.now() < until) {
    const ready = await open.page.evaluate(`(() => document.readyState === 'complete'
      && Boolean(document.getElementById('stage'))
      && document.getElementById('stage').childElementCount > 0)()`)
    if (ready === true) return true
    await delay(400)
  }
  return false
}

const routeOf = open => open.page.evaluate('document.body.dataset.route || ""')

/* ------------------------------------------------- real presses, recorded -- */

/**
 * Where a control is, and WHAT IS ACTUALLY UNDER THAT POINT.
 *
 * The second half is the whole instrument. A bounding box says the control is
 * laid out; elementFromPoint says a mouse would reach it. Three of the four
 * findings this file drives are the difference between those two sentences.
 */
const AT_POINT = `(selector) => {
  const node = document.querySelector(selector)
  if (!node) return { state: 'absent' }
  const style = getComputedStyle(node)
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
    return { state: 'hidden' }
  }
  const box = node.getBoundingClientRect()
  if (box.width < 1 || box.height < 1) return { state: 'zero-size' }
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  const viewport = { w: innerWidth, h: innerHeight }
  const geometry = { x: box.x, y: box.y, w: box.width, h: box.height }
  if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) {
    return { state: 'offscreen', box: geometry, viewport, x, y }
  }
  const hit = document.elementFromPoint(x, y)
  const describe = element => element
    ? element.tagName.toLowerCase()
      + (element.id ? '#' + element.id : '')
      + (element.className && typeof element.className === 'string'
        ? '.' + element.className.trim().split(/\\s+/).join('.')
        : '')
    : 'nothing'
  const mine = Boolean(hit) && (hit === node || node.contains(hit))
  return {
    state: mine ? 'reachable' : 'covered',
    under: describe(hit),
    self: describe(node),
    box: geometry,
    viewport,
    x,
    y,
  }
}`

async function at(open, selector) {
  return open.page.evaluate(`(${AT_POINT})(${JSON.stringify(selector)})`)
}

/* WAITED FOR, NOT SAMPLED ONCE, and this cost the first two runs of this file.
 *
 * MEASURED: the window mounts its first view and the topbar's own layout is not
 * final for another second or so; elementFromPoint at the forward arrow's
 * centre returned <html> at 2.4s and the arrow itself at 6s, with nothing about
 * the product different between the two. A single sample there reported "the
 * forward arrow could not be pressed", which is a serious-sounding finding
 * about the harness. So reachability is polled, and the LAST state seen is what
 * gets reported when it never becomes reachable -- a control still covered
 * after the whole budget is a real finding, and it reads the same. */
async function reachable(open, selector, budgetMs = 6000) {
  const until = Date.now() + budgetMs
  let last = await at(open, selector)
  while (last?.state !== 'reachable' && Date.now() < until) {
    await delay(300)
    last = await at(open, selector)
  }
  return last
}

/**
 * A press: move the cursor there, put the button down, lift it up.
 *
 * The point under the cursor is recorded FIRST and returned with the result, so
 * a press that landed on the wrong thing is visible in the evidence rather than
 * inferred from what did not happen afterwards.
 */
async function press(open, selector, { settleMs = 500, waitMs = 6000 } = {}) {
  const spot = await reachable(open, selector, waitMs)
  if (spot?.state !== 'reachable') return { pressed: false, spot }
  await open.page.mouse.move(spot.x, spot.y)
  await delay(60)
  await open.page.mouse.down()
  await delay(60)
  await open.page.mouse.up()
  await delay(settleMs)
  return { pressed: true, spot }
}

/** Scroll the way a person scrolls: the wheel, over the thing being read. */
async function wheelOver(open, selector, deltaY, times = 1) {
  const spot = await at(open, selector)
  if (spot?.state === 'absent' || spot?.state === 'hidden' || spot?.state === 'zero-size') return spot
  await open.page.mouse.move(spot.x, spot.y)
  for (let step = 0; step < times; step += 1) {
    await open.page.mouse.wheel(0, deltaY)
    await delay(140)
  }
  await delay(320)
  return spot
}

/**
 * Change a menu with the keyboard, which is what a person does after the menu
 * has focus -- and the one way to work a native <select> without asking the
 * operating system to draw a popup this run cannot see.
 */
async function chooseByKeyboard(open, selector, wantedValue) {
  const before = await open.page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.value ?? null`)
  await open.page.keyboard.press('Home')
  for (let step = 0; step < 24; step += 1) {
    const current = await open.page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.value ?? null`)
    if (current === wantedValue) return { ok: true, before, after: current, presses: step }
    await open.page.keyboard.press('ArrowDown')
    await delay(90)
  }
  const after = await open.page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.value ?? null`)
  return { ok: after === wantedValue, before, after, presses: 24 }
}

const textOf = (open, selector) =>
  open.page.evaluate(`(document.querySelector(${JSON.stringify(selector)})?.textContent || '').trim()`)

/* --------------------------------------------------------- getting about --- */

/** The route stamp, once it has stopped moving. */
async function settledRoute(open, from = null, budgetMs = 8000) {
  const until = Date.now() + budgetMs
  let seen = await routeOf(open)
  while (Date.now() < until) {
    await delay(250)
    const now = await routeOf(open)
    /* Two agreeing reads AND a change from where we started. `from` is null on
       the first read of a run, where any settled value is the answer. */
    if (now === seen && (from === null || now !== from)) return now
    seen = now
  }
  return seen
}

/**
 * Walk the ring by pressing the forward arrow, like a person with a mouse.
 *
 * ONE PRESS PER STOP, AND THE STOP IS WAITED FOR. src/main.js swaps views
 * inside document.startViewTransition, and `document.body.dataset.route` is
 * only stamped when that swap runs -- so the stamp lags the press by most of a
 * second. A loop that re-read the stamp on a fixed settle pressed the arrow a
 * SECOND time while the first press was still in flight and sailed past the
 * fleet page into metrics: measured, `route: "metrics", board: false`, reported
 * as "no empty node on the page". That was a finding about this file, not about
 * the product, and it is the reason the wait below is on the route CHANGING
 * rather than on a duration.
 */
async function walkTo(open, wanted, limit = 12) {
  let here = await settledRoute(open)
  for (let step = 0; step < limit; step += 1) {
    if (here === wanted) return true
    const pressed = await press(open, '#nav-next', { settleMs: 250 })
    if (!pressed.pressed) {
      note(`  the forward arrow could not be pressed from ${here}: ${JSON.stringify(pressed.spot)}`)
      return false
    }
    const next = await settledRoute(open, here)
    if (next === here) {
      note(`  the forward arrow was pressed on ${here} and the page did not move`)
      return false
    }
    here = next
  }
  note(`  walked ${limit} stops and never reached ${wanted}; last stop ${here}`)
  return here === wanted
}

/* ============================== run A ====================================== */

const EFFORT = '[data-compose-field="effort"]'
const ROLE = '[data-compose-field="role"]'
const TIER = '[data-compose-field="tier"]'
const MESSAGE = '[data-compose-field="message"]'
const SUBMIT = '[data-compose-action="submit"]'
const NOTICE = '[data-compose-notice="panel"]'
const BODY = '[data-compose-body="form"]'

/** Press an empty spot in the tree, which is how the compose panel opens. */
/* THE PANEL'S OWN GEOMETRY, because "the menu is covered" and "the menu is
   below the fold" and "the menu is fine" are three different products and the
   difference is arithmetic. Reports the scroller's real overflow behaviour --
   the class the panel asks for (.rail-scroll) is only ever DEFINED under
   .board-page and .agentv-panels in this tree, and the compose page is
   neither -- so whether it scrolls at all is a measurement, not a reading. */
const PANEL_GEOMETRY = `(() => {
  const panel = document.querySelector('.agent-compose')
  const body = document.querySelector('[data-compose-body="form"]')
  const actions = document.querySelector('.agent-compose-actions')
  const effort = document.querySelector('[data-compose-field="effort"]')
  if (!panel || !body) return { present: false }
  const box = node => {
    if (!node) return null
    const r = node.getBoundingClientRect()
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) }
  }
  const style = getComputedStyle(body)
  const effortBox = effort ? effort.getBoundingClientRect() : null
  const centre = effortBox ? { x: effortBox.x + effortBox.width / 2, y: effortBox.y + effortBox.height / 2 } : null
  const hit = centre ? document.elementFromPoint(centre.x, centre.y) : null
  const name = el => el
    ? el.tagName.toLowerCase() + (el.id ? '#' + el.id : '')
      + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : '')
    : 'nothing'
  return {
    present: true,
    viewport: { w: innerWidth, h: innerHeight },
    panel: box(panel),
    body: box(body),
    actions: box(actions),
    effort: box(effort),
    scroller: {
      overflowY: style.overflowY,
      flex: style.flex,
      minHeight: style.minHeight,
      scrollHeight: body.scrollHeight,
      clientHeight: body.clientHeight,
      scrollTop: Math.round(body.scrollTop),
      scrollable: body.scrollHeight > body.clientHeight + 1,
    },
    /* The band between the bottom of what the scroller shows and the top of
       the Start bar is where a half-clipped control appears to be and is not. */
    effortCentreUnder: name(hit),
    effortCentreInsideScroller: Boolean(centre && body.getBoundingClientRect().bottom >= centre.y),
    /* WHERE THE PANEL'S HEIGHT COMES FROM. The panel can only be as tall as the
       rail page it is mounted in; if there is unused room between the panel's
       bottom and the rail's, that room is the difference between a form that
       fits and a control cut in half, and it is worth knowing whose padding it
       is before anything is changed. */
    ancestry: (() => {
      const chain = []
      let node = panel
      while (node && node !== document.body) {
        const r = node.getBoundingClientRect()
        const s = getComputedStyle(node)
        chain.push({
          name: name(node),
          top: Math.round(r.top),
          bottom: Math.round(r.bottom),
          display: s.display,
          overflow: s.overflowY,
          padding: s.padding,
          position: s.position,
        })
        node = node.parentElement
      }
      return chain
    })(),
  }
})()`

async function panelGeometry(open) {
  return open.page.evaluate(PANEL_GEOMETRY)
}

const EMPTY_NODE_SELECTOR = 'button.tree-empty-node[data-empty-slot]'

/* NOT MARKED WITH AN ATTRIBUTE FIRST, and that was a harness bug worth naming.
   The tree canvas rebuilds its slot buttons on every layout pass, so a
   data-attribute stamped on the node in one evaluate was gone by the next one
   and the press reported "absent" about a node that was on the glass. The
   selector is resolved and the point taken in the SAME read, and the press is
   a mouse at that point. */
async function openComposePanel(open) {
  const spot = await reachable(open, EMPTY_NODE_SELECTOR, 15_000)
  if (spot?.state === 'absent') {
    /* WHAT THE PAGE WAS SHOWING INSTEAD. Without this, "no empty node" is the
       same sentence for a live board with no slots, a board still loading, and
       a page showing the worked example -- three different problems. */
    const why = await open.page.evaluate(`(() => {
      const root = document.querySelector('.computers')
      return {
        route: document.body.dataset.route,
        board: Boolean(root),
        liveMode: root ? root.getAttribute('data-live-mode') : null,
        slots: document.querySelectorAll('.tree-empty-node').length,
        nodes: document.querySelectorAll('.static-tree-node, .tree-node').length,
        text: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 240),
      }
    })()`)
    return { opened: false, why: `no empty node on the page; ${JSON.stringify(why)}` }
  }
  if (spot?.state !== 'reachable') {
    return { opened: false, why: `the empty node is on the page and not reachable: ${JSON.stringify(spot)}` }
  }
  await open.page.mouse.move(spot.x, spot.y)
  await delay(80)
  await open.page.mouse.down()
  await delay(80)
  await open.page.mouse.up()
  for (let step = 0; step < 20; step += 1) {
    await delay(300)
    const isOpen = await open.page.evaluate('Boolean(document.querySelector(\'[data-agent-compose="open"]\'))')
    if (isOpen === true) return { opened: true, why: '', spot }
  }
  return { opened: false, why: `the press landed on ${spot.under} and no panel appeared`, spot }
}

async function driveComposePanel(open, sizes) {
  const reached = await walkTo(open, 'computers')
  if (!reached) {
    pending('the effort menu can be reached by a mouse', 'the fleet page was never reached by pressing the arrow')
    pending('a refusal names its real reason', 'the fleet page was never reached by pressing the arrow')
    return { started: false }
  }
  note(`on ${await routeOf(open)}`)

  let panelState = null
  for (const size of sizes) {
    const viewport = await resizeTo(open, size.width, size.height)
    note(`window ${size.width}x${size.height} -> viewport ${JSON.stringify(viewport)}`)

    /* The panel is rebuilt per press, so it is opened fresh at each size --
       a panel laid out at one size and measured at another would be a finding
       about the harness. */
    const opened = await openComposePanel(open)
    if (!opened.opened) {
      pending(`the effort menu can be reached by a mouse at ${size.width}x${size.height}`, opened.why)
      continue
    }
    panelState = 'open'

    const first = await at(open, EFFORT)
    note(`  effort at first paint: ${first.state}${first.under ? ` (under the cursor: ${first.under})` : ''} box=${JSON.stringify(first.box || null)}`)
    note(`  panel at first paint: ${JSON.stringify(await panelGeometry(open))}`)

    /* AND IN THE STATE A PERSON IS ACTUALLY IN WHEN THEY REACH THIS MENU.
       Nobody opens the panel and goes straight for the last field: they answer
       the role first, which paints that role's summary line under the menu and
       makes everything below it taller. A measurement taken on an untouched
       panel is a measurement of a screen nobody is looking at. */
    const rolePrime = await press(open, ROLE, { settleMs: 300 })
    await open.page.keyboard.press('Escape')
    const primeChoice = await open.page.evaluate(`(() => {
      const menu = document.querySelector(${JSON.stringify(ROLE)})
      return menu ? [...menu.options].map(option => option.value).filter(Boolean)[0] || null : null
    })()`)
    if (rolePrime.pressed && primeChoice) await chooseByKeyboard(open, ROLE, primeChoice)
    const withRole = await at(open, EFFORT)
    note(`  effort once a role is chosen: ${withRole.state}${withRole.under ? ` (under the cursor: ${withRole.under})` : ''}`)
    const geometry = await panelGeometry(open)
    note(`  panel once a role is chosen: ${JSON.stringify(geometry)}`)

    check(`the compose panel's form really scrolls at ${size.width}x${size.height}`,
      geometry.present === true
        && (geometry.scroller.overflowY === 'auto' || geometry.scroller.overflowY === 'scroll'),
      geometry.present
        ? `overflow-y=${geometry.scroller.overflowY} flex=${geometry.scroller.flex} content=${geometry.scroller.scrollHeight}px in ${geometry.scroller.clientHeight}px`
        : 'the panel was not on the page to measure')

    check(`the effort menu is never hidden under the Start bar at ${size.width}x${size.height}`,
      geometry.present === true && !/agent-compose-actions/.test(String(geometry.effortCentreUnder)),
      `elementFromPoint at its centre returns ${geometry.effortCentreUnder}`)

    /* A person who cannot see the control scrolls to it. The wheel is the
       gesture; the form scrolls, and where it stops is what a mouse can reach. */
    await wheelOver(open, BODY, 240, 6)
    const after = await at(open, EFFORT)

    check(`the effort menu can be reached by a mouse at ${size.width}x${size.height}`,
      after.state === 'reachable',
      after.state === 'covered'
        ? `elementFromPoint at its own centre returns ${after.under}, not the menu`
        : `${after.state}${after.box ? ` box=${JSON.stringify(after.box)} viewport=${JSON.stringify(after.viewport)}` : ''}`)

    if (after.state === 'reachable') {
      const pressed = await press(open, EFFORT, { settleMs: 400 })
      /* A native menu may have opened over the window; Escape closes it and
         leaves the control focused, which is the state the keyboard works in. */
      await open.page.keyboard.press('Escape')
      await delay(200)
      const focused = await open.page.evaluate(`document.activeElement === document.querySelector(${JSON.stringify(EFFORT)})`)
      const changed = await chooseByKeyboard(open, EFFORT, 'high')
      check(`the effort menu actually changes value when worked at ${size.width}x${size.height}`,
        changed.ok && changed.before !== changed.after,
        `pressed at (${Math.round(pressed.spot.x)},${Math.round(pressed.spot.y)}); focus landed on it: ${focused === true}; ${changed.before} -> ${changed.after}`)
    } else {
      pending(`the effort menu actually changes value when worked at ${size.width}x${size.height}`,
        'the menu could not be reached, so there was nothing to work')
    }
  }

  if (panelState !== 'open') return { started: false }

  /* ---- the refusal, on the panel the person is looking at ---- */
  const claudeRow = TIER_CHOICES.find(choice => /claude/i.test(choice.id))
  if (!claudeRow) {
    pending('a refusal names its real reason', 'this build offers no Claude tier to refuse')
    return { started: false }
  }

  /* Back to the top of the form before filling it in. The size sweep above
     left the scroller at the bottom, and a press aimed at the role menu from
     there is a press at whatever the scroll left in that spot. */
  await wheelOver(open, BODY, -240, 8)
  const rolePress = await press(open, ROLE, { settleMs: 300 })
  await open.page.keyboard.press('Escape')
  const roleChoice = await open.page.evaluate(`(() => {
    const menu = document.querySelector(${JSON.stringify(ROLE)})
    return menu ? [...menu.options].map(option => option.value).filter(Boolean)[0] || null : null
  })()`)
  const rolePicked = roleChoice ? await chooseByKeyboard(open, ROLE, roleChoice) : { ok: false }
  note(`  role: pressed=${rolePress.pressed} picked=${rolePicked.after ?? 'none'}`)

  const messagePress = await press(open, MESSAGE, { settleMs: 300 })
  if (messagePress.pressed) {
    await open.page.keyboard.type('Read the notes in my documents folder and list what is unfinished.', { delay: 12 })
  }

  await wheelOver(open, BODY, 240, 4)
  const tierPress = await press(open, TIER, { settleMs: 300 })
  await open.page.keyboard.press('Escape')
  const tierPicked = await chooseByKeyboard(open, TIER, claudeRow.id)
  note(`  tier: pressed=${tierPress.pressed} ${tierPicked.before} -> ${tierPicked.after}`)

  if (tierPicked.after !== claudeRow.id) {
    pending('a refusal names its real reason', `the tier menu could not be moved to ${claudeRow.id}`)
    return { started: false }
  }

  const submitted = await press(open, SUBMIT, { settleMs: 1200 })
  if (!submitted.pressed) {
    pending('a refusal names its real reason', `Start could not be pressed: ${JSON.stringify(submitted.spot)}`)
    return { started: false }
  }
  /* A start crosses the IPC boundary, the spawn recorder and the host. */
  for (let step = 0; step < 40; step += 1) {
    const shown = await textOf(open, NOTICE)
    if (shown) break
    await delay(500)
  }
  const sentence = await textOf(open, NOTICE)
  note(`  the panel says: "${sentence}"`)

  const real = UNAVAILABLE_TEXT.AGENT_TIER_NO_LAUNCHER
  const realFragment = real.split(/[.,]/)[0].trim().toLowerCase()
  check('a refusal names its real reason',
    Boolean(sentence) && sentence.toLowerCase().includes(realFragment),
    sentence ? `it said: "${sentence}"` : 'the panel said nothing at all')
  check('a refusal that cannot be retried does not tell the person to retry',
    Boolean(sentence) && !sentence.includes(START_REFUSAL.noReasonGiven),
    sentence.includes(START_REFUSAL.noReasonGiven)
      ? 'it painted the "this copy was not told why · try once more" sentence'
      : 'no "try once more" for a refusal that retrying cannot clear')

  /* THE SECOND PROVIDER THE TREE CANNOT START, pressed rather than reasoned
     about. `local` reaches the same refusal in shell/agent-host.cjs by a
     different branch of the same check, and a run that measured only the Claude
     rows would not have shown that the sentence names both. */
  const localRow = TIER_CHOICES.find(choice => choice.id === 'local')
  if (!localRow) {
    pending('the same refusal answers the other engine a tree cannot start', 'this build offers no local tier')
    return { started: true }
  }
  await wheelOver(open, BODY, 240, 4)
  const secondTier = await press(open, TIER, { settleMs: 300 })
  await open.page.keyboard.press('Escape')
  const secondPicked = await chooseByKeyboard(open, TIER, 'local')
  if (!secondTier.pressed || secondPicked.after !== 'local') {
    pending('the same refusal answers the other engine a tree cannot start',
      `the tier menu could not be moved to local (${secondPicked.before} -> ${secondPicked.after})`)
    return { started: true }
  }
  const secondSubmit = await press(open, SUBMIT, { settleMs: 1200 })
  if (!secondSubmit.pressed) {
    pending('the same refusal answers the other engine a tree cannot start',
      `Start could not be pressed: ${JSON.stringify(secondSubmit.spot)}`)
    return { started: true }
  }
  let secondSentence = ''
  for (let step = 0; step < 40; step += 1) {
    secondSentence = await textOf(open, NOTICE)
    if (secondSentence) break
    await delay(500)
  }
  note(`  on the local engine the panel says: "${secondSentence}"`)
  check('the same refusal answers the other engine a tree cannot start',
    Boolean(secondSentence)
      && secondSentence.toLowerCase().includes(realFragment)
      && !secondSentence.includes(START_REFUSAL.noReasonGiven),
    secondSentence ? `it said: "${secondSentence}"` : 'the panel said nothing at all')

  return { started: true }
}

/* ------------------------------------------------------ the record count --- */

async function driveFleetOverview(open) {
  /* Back to the fleet page, and to the rail's own first page. */
  const closed = await press(open, '[data-compose-action="cancel"]', { settleMs: 900 })
  note(`  compose panel closed by pressing Cancel: ${closed.pressed}`)

  const ledger = await open.page.evaluate(`(async () => {
    const bridge = globalThis.mcAgent
    if (!bridge || typeof bridge.history !== 'function') return { bridge: false }
    try { return { bridge: true, reply: await bridge.history({ limit: 20 }) } }
    catch (error) { return { bridge: true, threw: String(error && error.message || error) } }
  })()`)
  const recorded = ledger?.reply?.outcomes?.starts ?? null
  note(`  the signed record holds ${recorded === null ? 'an unknown number of' : recorded} start(s); verified=${ledger?.reply?.verified}`)

  const shown = await textOf(open, '#agent-count')
  const label = await textOf(open, '.stat-hero .l')
  note(`  the fleet overview shows "${shown}" under "${label}"`)

  if (recorded === null) {
    pending('the fleet overview counts what is actually on record',
      'this copy could not read its own spawn record, so there is no true number to compare against')
    return
  }
  if (!shown) {
    pending('the fleet overview counts what is actually on record',
      'the fleet overview hero was not on the page to read')
    return
  }
  check('the fleet overview counts what is actually on record',
    Number(shown) === recorded,
    `the screen says ${shown}; the signed record holds ${recorded} start(s)`)
}

/* ============================== run B ====================================== */

const SETTINGS_LINK = 'a.home-next[href^="#/settings"]'

async function driveSettingsLink(open) {
  const home = await routeOf(open)
  note(`run B opened on ${home}`)
  const present = await at(open, SETTINGS_LINK)
  if (present.state === 'absent') {
    const engine = await open.page.evaluate(`(async () => {
      const bridge = globalThis.mcAgent
      if (!bridge) return { bridge: false }
      try { return { bridge: true, availability: await bridge.availability() } }
      catch (error) { return { bridge: true, threw: String(error && error.message || error) } }
    })()`)
    pending('"Turn on agent sessions in Settings" lands on the setting',
      `the link was not on the home screen; availability=${JSON.stringify(engine)}`)
    return
  }
  const label = await textOf(open, SETTINGS_LINK)
  const href = await open.page.evaluate(`document.querySelector(${JSON.stringify(SETTINGS_LINK)})?.getAttribute('href') || ''`)
  note(`  the link reads "${label}" and points at ${href}`)

  const pressed = await press(open, SETTINGS_LINK, { settleMs: 2500 })
  if (!pressed.pressed) {
    pending('"Turn on agent sessions in Settings" lands on the setting',
      `the link could not be pressed: ${JSON.stringify(pressed.spot)}`)
    return
  }
  /* The route stamp lands when the view swap completes, and the swap runs
     inside a View Transition; sampling once at the press reported "landed on
     home" about a window that was on the settings page a second later. */
  let landed = await routeOf(open)
  for (let step = 0; step < 20 && landed !== 'settings'; step += 1) {
    await delay(400)
    landed = await routeOf(open)
  }
  check('pressing the link reaches the settings page', landed === 'settings', `landed on ${landed}`)

  /* Where the person is now, measured the way a person judges it: is the
     control they were sent to actually on the screen in front of them? */
  await delay(1500)
  const landing = await open.page.evaluate(`(() => {
    const row = document.querySelector('[data-setting-id="write_agent-session"]')
    if (!row) return { present: false }
    const box = row.getBoundingClientRect()
    const inert = Boolean(row.closest('[inert]'))
    /* THE VISIBLE SWITCH, NOT THE INPUT. A toggle row is a label.settings-toggle
       wrapping a hidden checkbox and an i element; the i is the thing a person
       sees and presses, and the label carries the press to the input. Measuring
       the INPUT's centre reports the i sitting on top of it and reads like a
       covered control -- which is this harness misreading a perfectly ordinary
       styled checkbox, not a defect. So the label is the control here. */
    const control = row.querySelector('.settings-toggle, .settings-seg, select, .settings-range, button')
    const controlBox = control ? control.getBoundingClientRect() : null
    const point = controlBox
      ? document.elementFromPoint(controlBox.x + controlBox.width / 2, controlBox.y + controlBox.height / 2)
      : null
    return {
      present: true,
      inert,
      top: box.y,
      onScreen: box.y >= 0 && box.y <= innerHeight && box.height > 0,
      viewport: innerHeight,
      name: (row.querySelector('.settings-name')?.textContent || '').trim(),
      controlReachable: Boolean(control && point && (point === control || control.contains(point))),
      under: point ? point.tagName.toLowerCase() + (point.className && typeof point.className === 'string' ? '.' + point.className.trim().split(/\\s+/)[0] : '') : 'nothing',
    }
  })()`)
  note(`  landing: ${JSON.stringify(landing)}`)

  if (landing?.present !== true) {
    pending('"Turn on agent sessions in Settings" lands on the setting',
      'the settings page has no row for the agent-session switch at all')
    return
  }
  check('"Turn on agent sessions in Settings" lands on the setting',
    landing.onScreen === true && landing.inert === false,
    landing.inert
      ? `the row exists but is inside a collapsed tier (inert), ${Math.round(landing.top)}px from the top of the viewport`
      : `the row "${landing.name}" sits at y=${Math.round(landing.top)} in a ${landing.viewport}px viewport`)
  check('and the switch it landed on can be reached by a mouse',
    landing.controlReachable === true,
    landing.controlReachable === true
      ? `elementFromPoint returns ${landing.under}, inside the control`
      : `elementFromPoint returns ${landing.under}`)

  /* AND IT IS A SWITCH, NOT A PICTURE OF ONE. Landing on the row is only half
     the promise the sentence made; the other half is that the person can turn
     the thing on from where they were sent. Pressed with the mouse, and the
     answer is read from the product's own stored flag rather than from the
     checkbox's own property. */
  const before = await open.page.evaluate(`(() => {
    const input = document.querySelector('[data-setting-id="write_agent-session"] .settings-toggle input')
    return { checked: input ? input.checked : null, stored: localStorage.getItem('mc.write.agent-session') }
  })()`)
  const flipped = await press(open, '[data-setting-id="write_agent-session"] .settings-toggle', { settleMs: 900 })
  const after = await open.page.evaluate(`(() => {
    const input = document.querySelector('[data-setting-id="write_agent-session"] .settings-toggle input')
    return { checked: input ? input.checked : null, stored: localStorage.getItem('mc.write.agent-session') }
  })()`)
  check('and agent sessions can actually be turned on from where the link landed',
    flipped.pressed && before.checked === false && after.checked === true && after.stored === 'enabled',
    `pressed=${flipped.pressed} checked ${before.checked} -> ${after.checked}; stored ${before.stored} -> ${after.stored}`)
}

/* ================================ main ===================================== */

async function main() {
  const scratch = scratchDirectory('owner-walkthrough')
  console.log(`scratch: ${scratch}`)
  let runA = null
  let runB = null
  try {
    const staged = await stage(scratch)
    console.log(`app:     ${staged.executable}`)
    console.log('renderer and shell: this working tree, inside the packaged build')
    console.log('')

    /* ---------- run A ---------- */
    const profileA = path.join(scratch, 'profile-a')
    mkdirSync(profileA, { recursive: true })
    seedMachineRecord(profileA, staged.appRoot)
    runA = await openApp(staged.executable, profileA, providerlessEnvironment(profileA))
    if (!(await waitForView(runA))) {
      throw new HarnessError('run A never mounted a view, so there was nothing to measure')
    }
    console.log('RUN A  the compose panel, and what a refusal says')
    const composed = await driveComposePanel(runA, [
      { width: 1512, height: 945 },
      { width: 1280, height: 800 },
    ])
    if (composed.started) await driveFleetOverview(runA)
    else {
      pending('the fleet overview counts what is actually on record',
        'no start reached the record in this run, so there is nothing the overview could be wrong about')
    }
    if (runA.thrown.length > 0) note(`run A page errors: ${runA.thrown.slice(0, 3).join(' /// ')}`)
    await closeApp(runA)
    runA = null

    /* ---------- run B ---------- */
    console.log('')
    console.log('RUN B  the home screen link into Settings')
    const profileB = path.join(scratch, 'profile-b')
    mkdirSync(profileB, { recursive: true })
    seedMachineRecord(profileB, staged.appRoot)
    runB = await openApp(staged.executable, profileB, engineReadyEnvironment(profileB))
    if (!(await waitForView(runB))) {
      throw new HarnessError('run B never mounted a view, so there was nothing to measure')
    }
    await resizeTo(runB, 1512, 945)
    await driveSettingsLink(runB)
    if (runB.thrown.length > 0) note(`run B page errors: ${runB.thrown.slice(0, 3).join(' /// ')}`)
    await closeApp(runB)
    runB = null

    return report()
  } catch (error) {
    if (error instanceof HarnessError) {
      console.error(`\nHARNESS: ${error.message}`)
      return 2
    }
    console.error(`\nHARNESS: ${error?.stack || error}`)
    return 2
  } finally {
    await closeApp(runA)
    await closeApp(runB)
    if (!KEEP) {
      try { rmSync(scratch, { recursive: true, force: true }) } catch { /* windows holds handles */ }
    } else {
      console.log(`kept: ${scratch}`)
    }
  }
}

main().then(code => { process.exitCode = code }, error => {
  console.error(error)
  process.exitCode = 2
})

void SELF
void REPO_ROOT
void START_PANEL
