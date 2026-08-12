#!/usr/bin/env node

// LEGACY-ONB-001 — DOES EVERY UNAVAILABLE-HOST STATE EXPLAIN ITSELF AND OFFER A WAY
// FORWARD? MEASURED IN THE PACKAGED WINDOW, ON A STERILE PROFILE, BY CLICKING.
//
// THE FINDING THIS EXISTS FOR, confirmed on machine B: on a fresh isolated profile a
// person reaches Home with no local fleet host, the coordinator thread unavailable and
// messaging disabled, and NOTHING on Home, Settings, the Fleet Graph or the Comms Board
// explains the prerequisite or offers a recovery path.
//
// WHY THIS IS THE SHIPPING STATE AND NOT AN EDGE CASE. Every projection in
// public/data/*.json is a BUILD-TIME file produced by tools/gen-*.mjs from the
// builder's own engine. On any machine that is not the builder's there is nothing to
// read, so all seven ship as {"ok": false, "reason": "No local agent fleet host
// detected on this machine."} — permanently, on every customer install, forever. The
// unavailable branch of each of these four screens is the only branch a customer will
// ever see.
//
// WHAT COUNTS AS A PASS, stated before anything is measured, because the temptation
// here is to accept a sentence as a remedy:
//   * EXPLAINS  — the screen says what the missing thing IS in words a person who has
//                 never heard the phrase "fleet host" can act on. A refusal that names
//                 the mechanism ("Fleet projection unavailable") is a diagnosis, not an
//                 explanation.
//   * OFFERS    — there is a VISIBLE, NAMED control on the glass leading either to a
//                 least-privilege recovery action or to the in-product guide. Visible
//                 means a real box with non-zero size, not merely present in the DOM.
//
// RULES THIS SUITE HOLDS ITSELF TO, borrowed from tools/stranger-onboarding-qa.mjs
// because they earned their place there:
//   * It never assigns location.hash. A person cannot type a route, and a harness that
//     does passes on a build where nothing routes to the screen. Self-audited below.
//   * Every screen is reached by pressing the same controls a person presses.
//   * The guide is only counted as reached if pressing the link actually lands on it.
//
// ISOLATION — one mechanism per thing that would otherwise read the real machine:
//   --user-data-dir  Electron resolves userData through a Windows known folder, not the
//                    environment; this is the supported override and it moves the
//                    single-instance lock, so this runs alongside a copy in use.
//   LOCALAPPDATA     resolveServicesRoot() reads it, so the machine record lands in
//                    scratch instead of the owner's.
//   USERPROFILE      so a Codex-home probe that falls back to ~ reads scratch.
//   CODEX_HOME       the sign-in this product looks for.
//   APPDATA          shell/agent-host.cjs resolves the npm global install under it.
//   PATH             rebuilt from the Windows system directories alone.
// ELECTRON_RUN_AS_NODE is stripped: set, the binary runs headless as Node and exits 0,
// which is indistinguishable from a crash.
//
// THE OWNER'S LIVE ENGINE IS NEVER TOUCHED. This starts its own packaged copy from a
// staged directory. It presses no dispatch control and no Start control; every press
// below is a navigation.
//
// RUN IT:
//   node tools/first-run-recovery-qa.mjs
//   node tools/first-run-recovery-qa.mjs --keep      (keep the scratch dir)
//   --release <dir>        default release/win-unpacked
//   --open-timeout-ms <n>  how long to wait for the window (default 120000)
//
// EXIT CODE HAS THREE VALUES AND ONLY TWO ARE VERDICTS:
//   0  every check passed
//   1  a check FAILED — a statement about the product
//   2  NO VERDICT: the harness never attached, so nothing was measured.
// Never read this tool's status through a pipe.

import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
/* The words the product is supposed to be saying, read from the same module the
   renderer reads them from. See the note on EXPLANATION below for why this is an
   import and not a regex. Both modules are plain data with no DOM, so a node
   process can hold them. */
import { FIRST_RUN_NEEDS, GUIDE_ACTION, hostAbsentNotice } from '../src/first-run-needs.js'

const SELF = fileURLToPath(import.meta.url)
const REPO_ROOT = path.resolve(path.dirname(SELF), '..')
const require_ = createRequire(import.meta.url)

function argument(name, fallback = null) {
  const at = process.argv.indexOf(name)
  return at === -1 ? fallback : process.argv[at + 1]
}

const RELEASE = path.resolve(argument('--release', path.join(REPO_ROOT, 'release', 'win-unpacked')))
const KEEP = process.argv.includes('--keep')
const OPEN_BUDGET_MS = Number(argument('--open-timeout-ms', 120000))
const SHOOT = argument('--shoot', null) ? path.resolve(argument('--shoot')) : null
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

class HarnessError extends Error {}

/* The instrument audits itself: a suite that reaches a screen by assigning the hash is
   not measuring whether a person can reach it, and the failure is silent. Assignment is
   navigation; comparison is observation, so `===` and `!==` are not caught. */
function auditSelf() {
  const source = readFileSync(SELF, 'utf8')
  const offences = source.split('\n')
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => /location\.hash\s*(\+?=)(?!=)/.test(line))
    .filter(({ line }) => !line.includes('SELF-AUDIT-PATTERN'))
  if (offences.length === 0) return
  console.error('\nNO VERDICT: this suite navigates by assigning location.hash, which is the')
  console.error('one thing a customer cannot do. Offending lines:')
  for (const { line, number } of offences) console.error(`  ${number}: ${line.trim()}`)
  process.exit(2)
}

/* A COPY is run, never release/win-unpacked itself: the GUI starts a supervised
   capability layer that writes state/ next to the binary, so running the artifact in
   place mutates the artifact. dist/ and shell/ come from the working tree so this
   measures what is actually here. */
async function stage(scratch) {
  const asar = require_(path.join(REPO_ROOT, 'node_modules', '@electron', 'asar'))
  const app = path.join(scratch, 'app')
  const unpacked = path.join(scratch, 'asar-stage')
  if (!existsSync(path.join(RELEASE, 'resources', 'app.asar'))) {
    throw new Error(`no packaged build at ${RELEASE}. Run \`npm run dist\` first, or pass --release <dir>.`)
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

/* Pick the launcher by SHAPE, not by spelling. */
function appExecutable(appRoot) {
  const executables = readdirSync(appRoot).filter(entry => entry.toLowerCase().endsWith('.exe'))
  if (executables.length === 1) return path.join(appRoot, executables[0])
  if (executables.length === 0) throw new Error(`no .exe in the staged app at ${appRoot}`)
  const launcher = executables.find(entry => !/^(elevate|squirrel|crashpad)/i.test(entry))
  if (launcher) return path.join(appRoot, launcher)
  throw new Error(`cannot tell which of these is the launcher: ${executables.join(', ')}`)
}

/* A PATH with nothing on it but Windows itself, built from a fixed list rather than
   filtered out of the real one: filtering fails OPEN — one unfamiliar directory
   carrying a shim and the run silently measures a machine that has Codex. */
function systemOnlyPath() {
  const root = process.env.SystemRoot || 'C:\\Windows'
  return [
    path.join(root, 'system32'),
    root,
    path.join(root, 'system32', 'Wbem'),
    path.join(root, 'system32', 'WindowsPowerShell', 'v1.0'),
  ].join(path.delimiter)
}

async function openApp(executable, scratch, label) {
  const profile = path.join(scratch, `profile-${label}`)
  for (const leaf of ['userdata', 'local', 'home', 'appdata']) {
    mkdirSync(path.join(profile, leaf), { recursive: true })
  }
  const environment = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  environment.LOCALAPPDATA = path.join(profile, 'local')
  environment.USERPROFILE = path.join(profile, 'home')
  environment.APPDATA = path.join(profile, 'appdata')
  environment.CODEX_HOME = path.join(profile, 'home', '.codex')
  mkdirSync(environment.CODEX_HOME, { recursive: true })
  environment.PATH = systemOnlyPath()
  environment.Path = environment.PATH

  const userData = path.join(profile, 'userdata')
  const child = spawn(executable, [
    `--user-data-dir=${userData}`,
    '--remote-debugging-port=0',
  ], { env: environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  const noise = []
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8')
    stream.on('data', chunk => { noise.push(chunk); while (noise.length > 400) noise.shift() })
  }
  child.on('error', error => noise.push(`[spawn error] ${error.message}\n`))

  const session = createSession(child, userData, message => console.log(`  ..    ${message}`))
  const teardown = async () => {
    session.close()
    try { child.kill() } catch { /* already gone */ }
    if (child.pid) {
      try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }) } catch { /* nothing left */ }
    }
    await delay(400)
  }

  try {
    await session.open(OPEN_BUDGET_MS)
  } catch (error) {
    if (error instanceof HarnessError) {
      const said = noise.join('').trim()
      error.message += said
        ? `\n  the app said:\n${said.split('\n').map(line => `    | ${line}`).join('\n')}`
        : '\n  the app said nothing on stdout or stderr'
    }
    await teardown()
    throw error
  }

  const evaluate = async (expression) => {
    const reply = await session.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    return reply?.result?.result?.value
  }
  /* A CHECK THAT PASSES ON AN UNREADABLE PAGE IS NOT A CHECK. Everything above
     reads text, and text is on the glass whether or not the layout survived it:
     a notice that overflows its rail, a link clipped out of a scrolling preview
     and a paragraph in invisible ink all pass every assertion in this file. So
     --shoot writes the screens out and a person looks. Off by default because it
     is a human step, not an automated verdict. */
  const shoot = async (name, { whole = false } = {}) => {
    if (!SHOOT) return
    /* `whole` captures past the fold. The guide is a reading page and the half of
       it nobody would see in a viewport shot -- what already works, and the way
       back into the product -- is exactly the half a reviewer needs to check, so
       a viewport crop would be a screenshot that proves the top of the page. */
    let options = { format: 'png' }
    if (whole) {
      const metrics = await session.send('Page.getLayoutMetrics')
      const size = metrics?.result?.cssContentSize
      if (size) {
        options = {
          format: 'png',
          captureBeyondViewport: true,
          clip: { x: 0, y: 0, width: size.width, height: size.height, scale: 1 },
        }
      }
    }
    const reply = await session.send('Page.captureScreenshot', options)
    const data = reply?.result?.data
    if (!data) { console.log(`  ..    no screenshot came back for ${name}`); return }
    mkdirSync(SHOOT, { recursive: true })
    const file = path.join(SHOOT, `${name}.png`)
    writeFileSync(file, Buffer.from(data, 'base64'))
    console.log(`  ..    wrote ${file}`)
  }
  const until = async (what, expression, tries = 80) => {
    for (let attempt = 0; attempt < tries; attempt += 1) {
      if (await evaluate(expression)) return true
      await delay(250)
    }
    console.log(`  ..    gave up waiting for ${what}`)
    return false
  }
  /* A control counts only if it is a real box with a name a person could read.
     Returns a WORD so a failure says WHICH of the three ways it failed. */
  const clickVisible = async (selector) => evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)})
    if (!node) return 'absent'
    const box = node.getBoundingClientRect()
    const style = getComputedStyle(node)
    if (!(box.width > 0 && box.height > 0)) return 'not-visible'
    if (style.visibility === 'hidden' || style.display === 'none') return 'not-visible'
    node.click()
    return 'clicked'
  })()`)
  const clickLastVisible = async (selector) => evaluate(`(() => {
    const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})].filter(node => {
      const box = node.getBoundingClientRect()
      const style = getComputedStyle(node)
      return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
    })
    if (!nodes.length) return 'absent'
    nodes[nodes.length - 1].click()
    return 'clicked'
  })()`)

  return { evaluate, until, clickVisible, clickLastVisible, shoot, teardown, noise }
}

function createSession(child, userDataDir, say) {
  let socket = null
  let nextId = 1
  const pending = new Map()
  return {
    async open(budgetMs) {
      const started = Date.now()
      const file = path.join(userDataDir, 'DevToolsActivePort')
      let port = null
      while (Date.now() - started < budgetMs && port === null) {
        if (child.exitCode !== null) {
          throw new HarnessError(`the app exited with code ${child.exitCode} before publishing a debugger port`)
        }
        try {
          const candidate = Number(readFileSync(file, 'utf8').split('\n')[0].trim())
          if (Number.isInteger(candidate) && candidate > 0) port = candidate
        } catch { /* not written yet */ }
        if (port === null) await delay(200)
      }
      if (port === null) throw new HarnessError(`the app never published a debugger port within ${Math.round(budgetMs / 1000)}s`)
      say(`debugger published on 127.0.0.1:${port} after ${Date.now() - started}ms`)

      let lastSeen = 'the debugger endpoint never answered at all'
      while (Date.now() - started < budgetMs) {
        if (child.exitCode !== null) {
          throw new HarnessError(`the app exited with code ${child.exitCode} before the debugger answered`)
        }
        try {
          const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
          const page = targets.find(entry => entry.type === 'page' && entry.webSocketDebuggerUrl)
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
            say(`attached to the window after ${Date.now() - started}ms`)
            return
          }
          lastSeen = targets.length
            ? `${targets.length} target(s) and none a debuggable page`
            : 'an EMPTY target list — the process is up but no window opened'
        } catch (error) {
          lastSeen = `the endpoint refused the connection (${error?.cause?.code || error?.message || error})`
        }
        await delay(500)
      }
      throw new HarnessError(`no debuggable page within ${Math.round(budgetMs / 1000)}s — ${lastSeen}`)
    },
    send(method, params = {}) {
      const id = nextId++
      socket.send(JSON.stringify({ id, method, params }))
      return new Promise(resolve => pending.set(id, resolve))
    },
    close() { try { socket?.close() } catch { /* already gone */ } },
  }
}

/* Everything on the glass, plus the guide links visible on it. innerText, never
   innerHTML: an instruction in the DOM and not on the glass is not an instruction. */
const SCREEN = `(() => {
  const shown = node => {
    if (!node) return false
    const box = node.getBoundingClientRect()
    const style = getComputedStyle(node)
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
  }
  const norm = s => String(s || '').replace(/\\s+/g, ' ').trim()
  return {
    hash: location.hash,
    route: document.body.dataset.route || '',
    screen: norm(document.body.innerText),
    /* Every visible anchor or button that leads somewhere, with its words. This is
       what "offers a recovery path" is measured against. */
    exits: [...document.querySelectorAll('a[href^="#/"], button[data-guide], a[data-guide]')]
      .filter(shown)
      .map(node => ({ text: norm(node.textContent), href: node.getAttribute('href') || '' })),
    guideLinks: [...document.querySelectorAll('a[href="#/guide"]')].filter(shown).length,
  }
})()`

async function walkSetup({ evaluate, until, clickVisible, clickLastVisible }, check) {
  const onSetup = await until('the permission question', `location.hash === '#/setup'`)
  check('a fresh profile opens on the permission question', onSetup, `hash=${await evaluate('location.hash')}`)
  if (!onSetup) return false
  await clickVisible('[data-setup-continue]')
  await until('the folder question', `document.querySelector('[data-setup-section]')?.innerText.includes('Which folder')`)
  await until('the folder to resolve', `document.querySelector('.setup-root-path') !== null`)
  await clickLastVisible('[data-setup-next]')
  await until('the sign-in step',
    `document.querySelector('[data-setup-section]')?.innerText.includes('Who is using this copy') || document.querySelector('[data-setup-section]')?.innerText.includes('Signed in as')`)
  await clickLastVisible('[data-setup-next]')
  await until('the autonomy question', `document.querySelector('[data-setup-section]')?.innerText.includes('without asking')`)
  await clickVisible('[data-setup-set="autonomy"][data-setup-value="assisted"]')
  await clickVisible('[data-setup-next="review"]')
  await until('the review', `document.querySelector('[data-setup-section]')?.innerText.includes('what those answers set')`)
  await until('the readiness answer on the review',
    `!document.querySelector('[data-setup-section]')?.innerText.includes('Checking whether Codex')`)
  await clickVisible('[data-setup-next="finish"]')
  const intoApp = await until('the app itself', `location.hash === '#/' || location.hash === ''`, 120)
  check('setup ends in the app', intoApp, `hash=${await evaluate('location.hash')}`)
  return intoApp
}

/* THE PREREQUISITE, IN A PERSON'S WORDS.
 *
 * THE ASSERTION IS AGAINST THE COPY MODULE, NOT AGAINST A REGEX I TYPED HERE, and
 * that is the difference between this suite and one that cannot fail. The defect
 * class in this codebase is a helper that exists while the call site still names
 * a literal -- the module is right, the screen is wrong, and a source-text check
 * waves it through. So the sentences below are READ FROM src/first-run-needs.js
 * and looked for on the glass. Change the copy and this follows; wire a screen to
 * something else and this goes red.
 *
 * The `mechanismOnly` pattern is the other half. A screen passes only if it has
 * the explanation as well; matching "fleet projection unavailable" alone would
 * pass the exact refusal this finding is about. */
/* A distinctive clause OF the module's own sentence, not a phrase typed here: it
   is sliced out of the live value, so a rewrite of the copy that drops this
   clause fails loudly at startup instead of silently measuring nothing. */
const EXPLANATION = hostAbsentNotice('probe').body
const EXPLAINS_CLAUSE = 'a program that watches the agents running on a group of computers'
if (!EXPLANATION.includes(EXPLAINS_CLAUSE)) {
  console.error('\nNO VERDICT: the clause this suite looks for is no longer in the copy module.')
  console.error(`  looked for: ${JSON.stringify(EXPLAINS_CLAUSE)}`)
  console.error(`  the module says: ${JSON.stringify(EXPLANATION)}`)
  process.exit(2)
}
const MECHANISM_ONLY = /fleet projection unavailable|ops projection unavailable/i

async function main() {
  auditSelf()
  const scratch = mkdtempSync(path.join(tmpdir(), 'first-run-recovery-'))
  const checks = []
  const check = (what, ok, detail = '') => {
    checks.push({ name: what, ok: Boolean(ok) })
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? `  — ${detail}` : ''}`)
  }
  const note = detail => console.log(`  ..    ${detail}`)

  let app = null
  try {
    const executable = await stage(scratch)
    console.log(`staged a copy at ${executable}`)
    app = await openApp(executable, scratch, 'sterile')
    const { evaluate, until, clickVisible, shoot } = app

    console.log('\n== first run, sterile profile, no fleet host, no Codex ==')
    if (!await walkSetup(app, check)) return 1
    await delay(1500)

    /* ---------- HOME ---------- */
    const home = await evaluate(SCREEN)
    note(`home: ${home.screen.slice(0, 400)}`)
    /* Home is the one screen that may NOT carry the long explanation:
       tools/test/home-screen.test.mjs bans the vocabulary it needs and caps the
       fact row at three, both correctly. What it owes is the true short sentence
       and a door. */
    check('home still states plainly that this is the only computer',
      /only computer connected/i.test(home.screen), home.screen.slice(0, 200))
    check('home offers a way to find out what that means',
      home.guideLinks > 0, JSON.stringify(home.exits))
    await shoot('01-home')
    check('home names the door in the words the copy module gives it',
      home.exits.some(exit => exit.text === GUIDE_ACTION.label && exit.href === GUIDE_ACTION.href),
      JSON.stringify(home.exits))

    /* ---------- FLEET GRAPH ---------- */
    const toComputers = await clickVisible('#nav-next')
    check('the forward chevron reaches the fleet graph', toComputers === 'clicked', String(toComputers))
    await until('the computers page', `document.body.dataset.route === 'computers'`)
    await delay(1800)
    const computers = await evaluate(SCREEN)
    note(`fleet graph: ${computers.screen.slice(0, 500)}`)
    check('the fleet graph explains what has not reported, in the copy module\'s words',
      computers.screen.includes(EXPLAINS_CLAUSE), computers.screen.slice(0, 300))
    check('the fleet graph still reports what it looked for, verbatim',
      /No local agent fleet host detected on this machine/i.test(computers.screen),
      computers.screen.slice(0, 300))
    await shoot('02-fleet-graph')
    check('the fleet graph offers the guide',
      computers.guideLinks > 0, JSON.stringify(computers.exits))

    /* ---------- METRICS, RESEARCH, LEDGER on the way round ----------
       The finding named four screens. The directive says EVERY unavailable-host
       state, and these three reach the same one on the same install, so they are
       walked and read rather than assumed. Metrics is reported rather than
       asserted: see the note at the bottom of reports/lanes/team2-b5.md. */
    const onTheWay = {}
    for (const step of ['metrics', 'research', 'comms']) {
      await clickVisible('#nav-next')
      await until(`the ${step} page`, `document.body.dataset.route === '${step}'`)
      await delay(1400)
      onTheWay[step] = await evaluate(SCREEN)
    }
    note(`metrics: ${onTheWay.metrics.screen.slice(0, 260)}`)
    /* Metrics carries the DOOR and not the explanation, on purpose: it reports
       its absence per component, eight times, and an explanation repeated eight
       times would bury the page. So this asserts the way out exists, not that the
       paragraph is on it. */
    check('the metrics page offers the guide',
      onTheWay.metrics.guideLinks > 0, JSON.stringify(onTheWay.metrics.exits))
    check('the research page explains what has not reported',
      onTheWay.research.screen.includes(EXPLAINS_CLAUSE), onTheWay.research.screen.slice(0, 260))
    check('the research page offers the guide',
      onTheWay.research.guideLinks > 0, JSON.stringify(onTheWay.research.exits))
    await delay(1800)
    const comms = await evaluate(SCREEN)
    note(`comms board: ${comms.screen.slice(0, 500)}`)
    check('the comms board explains why there is no traffic, in the copy module\'s words',
      comms.screen.includes(EXPLAINS_CLAUSE), comms.screen.slice(0, 300))
    check('the comms board no longer leaves the bare refusal as the only thing on it',
      !MECHANISM_ONLY.test(comms.screen) || comms.screen.includes(EXPLAINS_CLAUSE),
      comms.screen.slice(0, 300))
    await shoot('03-comms-board')
    check('the comms board offers the guide',
      comms.guideLinks > 0, JSON.stringify(comms.exits))

    /* ---------- LEDGER ---------- */
    await clickVisible('#nav-next')
    await until('the ledger page', `document.body.dataset.route === 'ledger'`)
    await delay(1600)
    const ledger = await evaluate(SCREEN)
    note(`ledger: ${ledger.screen.slice(0, 260)}`)
    check('the ledger explains what has not reported',
      ledger.screen.includes(EXPLAINS_CLAUSE), ledger.screen.slice(0, 260))
    check('the ledger offers the guide', ledger.guideLinks > 0, JSON.stringify(ledger.exits))

    /* ---------- SETTINGS ---------- */
    const gear = await clickVisible('#open-settings')
    check('the gear opens the drawer', gear === 'clicked', String(gear))
    await delay(400)
    const toSettings = await clickVisible('.drawer-all')
    check('the drawer reaches the settings page', toSettings === 'clicked', String(toSettings))
    await until('the settings page', `document.body.dataset.route === 'settings'`)
    await delay(1200)
    const settings = await evaluate(SCREEN)
    /* The specific wrong turn this note exists to stop: six "live data" switches,
       all already on, and a person concluding the product ships fake data. */
    check('settings says the live-source switches are not the missing thing',
      /no switch on this page changes that/i.test(settings.screen), settings.screen.slice(0, 300))
    await shoot('04-settings')
    check('settings offers the guide', settings.guideLinks > 0, JSON.stringify(settings.exits.slice(0, 12)))
    /* The section a person hunting for the missing switch actually opens, reached
       by pressing its own rail button. Shot separately because the note lives
       under that title and the page opens on a different section entirely. */
    const toDataSim = await clickVisible('.settings-rail button[data-category="Data & Sim"]')
    check('the settings rail reaches Data and Sim', toDataSim === 'clicked', String(toDataSim))
    await delay(700)
    await shoot('04b-settings-data-sim')

    /* ---------- AND THE GUIDE IS REACHABLE BY PRESSING THE LINK ---------- */
    const pressed = await clickVisible('a[href="#/guide"]')
    check('the guide link can be pressed', pressed === 'clicked', String(pressed))
    const atGuide = await until('the guide', `document.body.dataset.route === 'guide'`, 40)
    check('pressing it lands on the guide', atGuide, `hash=${await evaluate('location.hash')}`)
    await delay(600)
    const guide = await evaluate(SCREEN)
    note(`guide: ${guide.screen.slice(0, 700)}`)
    /* EVERY SENTENCE THE MODULE DECLARES IS ON THE PAGE. A guide that renders two
       of its three sections is the same defect as no guide, one screen further
       along, and only walking the data catches it. */
    for (const need of FIRST_RUN_NEEDS) {
      check(`the guide renders the "${need.id}" section`, guide.screen.includes(need.title), need.title)
      for (const step of need.steps) {
        check(`the guide shows the step: ${step.text.slice(0, 46)}`,
          guide.screen.includes(step.text), step.text)
      }
    }
    /* The two things a person on a bare machine actually needs, asserted on the
       glass rather than inferred from the section titles above. */
    check('the guide gives the exact command that makes agents work here',
      /winget install OpenAI\.Codex/i.test(guide.screen), guide.screen.slice(0, 240))
    check('the guide says plainly that nothing here connects a host',
      /no setting that connects one and no command that installs one/i.test(guide.screen),
      guide.screen.slice(0, 400))
    check('the guide leads back into the product',
      guide.exits.some(exit => exit.href === '#/settings'), JSON.stringify(guide.exits))
    /* THE GUIDE IN ALL THREE THEMES, pressed from the drawer the way a person
       changes theme. A reading page whose ink comes from theme tokens should
       follow with no rules of its own; the only way to know it does is to look. */
    for (const theme of ['white', 'tan', 'black']) {
      await clickVisible('#open-settings')
      await delay(250)
      const picked = await clickVisible(`#theme-seg button[data-theme="${theme}"]`)
      check(`the guide can be read on the ${theme} theme`, picked === 'clicked', String(picked))
      await delay(250)
      await evaluate(`document.getElementById('close-settings').click()`)
      await delay(400)
      await shoot(`05-guide-${theme}`, { whole: true })
      /* AND THE HALF BELOW THE FOLD. This app scrolls inside its own stage, not
         the document, so captureBeyondViewport returns the viewport and nothing
         more -- the first version of this shot silently proved only the top of
         the page. Scroll the real container and take a second frame. Scrolling
         is not navigation; a person does it with a wheel. */
      const scrolled = await evaluate(`(() => {
        let node = document.querySelector('.guide-shell')
        while (node && node !== document.body) {
          if (node.scrollHeight - node.clientHeight > 40) {
            node.scrollTop = node.scrollHeight
            return node.className || node.id || 'unnamed'
          }
          node = node.parentElement
        }
        return null
      })()`)
      if (theme === 'white') {
        check('the guide is longer than one screen and scrolls', Boolean(scrolled), String(scrolled))
      }
      await delay(350)
      await shoot(`06-guide-${theme}-bottom`)
    }

    /* THE ARROWS MUST NOT STRAND ANYONE ON IT. The guide is off the ring, so a
       person who presses forward has to come back to the product rather than
       walking into a stop that is not there. */
    const forward = await clickVisible('#nav-next')
    check('the forward arrow leaves the guide', forward === 'clicked', String(forward))
    const backHome = await until('home', `document.body.dataset.route === 'home'`, 40)
    check('and it lands on home', backHome, `hash=${await evaluate('location.hash')}`)
  } finally {
    if (app) await app.teardown()
    if (KEEP) console.log(`\nkept the scratch directory at ${scratch}`)
    else {
      try { rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }) }
      catch (error) { console.log(`\ncould not remove the scratch directory (${error.code || error.message}); it is at ${scratch}`) }
    }
  }

  const failed = checks.filter(result => !result.ok)
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
  if (failed.length) {
    console.error(`FAILED: ${failed.map(result => result.name).join('; ')}`)
    return 1
  }
  return 0
}

main().then(
  code => { process.exitCode = code },
  error => {
    if (error instanceof HarnessError) {
      console.error('\nNO VERDICT — nothing about the product was measured.')
      console.error(error.message)
      process.exitCode = 2
      return
    }
    console.error('\nNO VERDICT — the harness failed before it could measure anything.')
    console.error(error?.stack || String(error))
    process.exitCode = 2
  },
)
