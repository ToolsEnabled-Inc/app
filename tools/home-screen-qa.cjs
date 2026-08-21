'use strict'

/* Read the home screen of the INSTALLED application and check the properties
 * the owner reported broken, on the rendered DOM rather than on the source.
 *
 * WHY THIS EXISTS SEPARATELY FROM tools/test/home-screen.test.mjs.
 *
 * That suite proves the DECISION is sound: it walks every reachable input to
 * describeHome() and asserts the sentence set never contradicts, repeats, or
 * talks like a README. What it cannot see -- and a mutation round proved this,
 * it is not a theoretical gap -- is a RENDERER that has stopped rendering that
 * decision. Blanking the facts on their way to the screen left every source
 * pattern that suite looks for still present in the file, and it stayed green
 * over a home screen with nothing under the ring.
 *
 * So this reads what is actually on the glass. It launches the packaged
 * application against a throwaway profile, drives it over the DevTools
 * protocol, and asserts against `document` -- which is the only place the
 * question "does this screen contradict itself" can honestly be answered.
 *
 * THREE TRAPS THIS HANDLES, EACH OF WHICH HAS COST THIS PROJECT HOURS:
 *   1. ELECTRON_RUN_AS_NODE is stripped. Inherited, it turns the Electron
 *      binary into headless Node that exits 0 with no window, which looks
 *      exactly like a crash.
 *   2. Electron's single-instance lock is app-wide. This refuses to run while
 *      any process from THIS EXECUTABLE PATH is alive, and never kills a
 *      process it did not start -- that process may be someone using the
 *      product.
 *   3. It uses its own --user-data-dir, so it never reads or writes the
 *      profile of a real installation.
 *
 * Usage:  node tools/home-screen-qa.cjs [path to win-unpacked]
 * Exit 0 = every check passed. Exit 1 = a check failed. Exit 2 = could not run.
 */

const { execFileSync, spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const APP_EXE = 'ToolsEnabled.exe'
/* THE DEBUG PORT IS ASSIGNED BY THE OS, NOT BY THIS FILE.
 *
 * It was the literal 9411. Two runs at once -- this harness against one build
 * while any other CDP-driven harness or a second unpacked copy ran against
 * another -- both asked Chromium for 9411. The second launch gets the port
 * refused, exposes no page, and this file's launch loop then times out with
 * "the application did not present a home screen within 60000ms", which reads
 * as a STARTUP CRASH IN THE PRODUCT. It is not: it is two harnesses fighting
 * over one number. The setup-walkthrough harness removed the same pattern after
 * measuring a 1-in-4 flake from it.
 *
 * `--remote-debugging-port=0` makes Chromium bind an ephemeral port and write
 * the real one as the first line of DevToolsActivePort inside the user-data-dir
 * -- which is already per-run (mkdtemp), so two runs cannot collide on it
 * either. The port is therefore read back rather than assumed, and a run that
 * cannot read it says so instead of blaming the application.
 */
const CDP_PORT_REQUEST = 0
const LAUNCH_TIMEOUT_MS = 60_000
let cdpPort = null

function readDevToolsPort(profileDir) {
  try {
    const first = fs.readFileSync(path.join(profileDir, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim()
    const port = Number(first)
    return Number.isInteger(port) && port > 0 ? port : null
  } catch { return null }
}

const unpacked = path.resolve(process.argv[2] || path.join(__dirname, '..', 'release', 'win-unpacked'))
const exe = path.join(unpacked, APP_EXE)

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const problems = []
const checks = []

function check(name, ok, detail) {
  checks.push({ name, ok })
  if (!ok) problems.push(`${name}${detail ? ` -- ${detail}` : ''}`)
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n        ${detail}`}`)
}

/* Match by executable PATH, never by process name: another copy of Mission
   Control may legitimately be running from somewhere else, and it is not ours
   to touch. */
function instancesOfThisExecutable() {
  const script = `@(Get-Process -Name 'ToolsEnabled' -ErrorAction SilentlyContinue `
    + `| Where-Object { $_.Path -eq '${exe.replace(/'/g, "''")}' } `
    + `| Select-Object -ExpandProperty Id) -join ','`
  try {
    const out = execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true, timeout: 20_000, encoding: 'utf8',
    }).trim()
    return out ? out.split(',').filter(Boolean) : []
  } catch { return [] }
}

async function evaluate(expression) {
  if (!cdpPort) throw new Error('the application has not published a DevTools port yet')
  const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()
  const page = list.find((target) => target.type === 'page' && !String(target.url).startsWith('devtools://'))
  if (!page) throw new Error('the application exposed no page to inspect')
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  try {
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', () => reject(new Error('could not attach to the page')), { once: true })
    })
    const reply = await new Promise((resolve) => {
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(event.data)
        if (message.id === 1) resolve(message)
      })
      socket.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }))
    })
    if (reply.result?.exceptionDetails) {
      throw new Error(reply.result.exceptionDetails.exception?.description || 'evaluation threw')
    }
    return reply.result?.result?.value
  } finally { socket.close() }
}

/* Read every sentence the home screen is actually showing. Deliberately taken
   from rendered text nodes rather than from any module: this must not be able
   to agree with the decision by construction.
   `visible` is measured, not assumed. Text in the DOM is not text on the glass:
   a stylesheet that hides the fact rows leaves every string exactly where a
   textContent read finds it, and leaves the screen blank. Anything this file
   asserts about what a person can read is therefore gated on a real box. */
const READ_HOME = `(() => {
  const home = document.querySelector('.home')
  if (!home) return { present: false }
  const text = (node) => (node ? node.textContent.replace(/\\s+/g, ' ').trim() : '')
  const shown = (node) => {
    if (!node) return false
    const box = node.getBoundingClientRect()
    return box.width > 0 && box.height > 0 && getComputedStyle(node).visibility !== 'hidden'
  }
  const notice = document.querySelector('.fleet-profile-notice')
  return {
    present: true,
    mode: home.dataset.mode,
    caption: text(home.querySelector('.uring-caption')),
    headline: text(home.querySelector('.uring-sub')),
    headlineVisible: shown(home.querySelector('.uring-sub')),
    facts: [...home.querySelectorAll('.home-fact')].filter(shown).map(node => text(node.querySelector('span'))),
    factsInDom: home.querySelectorAll('.home-fact').length,
    panelBodyVisible: shown(home.querySelector('.session-log')),
    digitsHidden: Boolean(home.querySelector('.uring-digits')?.hidden),
    digits: [...home.querySelectorAll('.uring-digits .n.cur')].map(text),
    panelTitle: text(home.querySelector('[data-panel-title]')),
    panelBadge: home.querySelector('[data-panel-badge]')?.hidden ? '' : text(home.querySelector('[data-panel-badge]')),
    panelBody: text(home.querySelector('.session-log')),
    footer: home.querySelector('[data-panel-foot]')?.hidden ? '' : text(home.querySelector('[data-panel-foot]')),
    composer: Boolean(home.querySelector('.session-input input')),
    composerPlaceholder: home.querySelector('.session-input input')?.placeholder || '',
    composerDisabled: home.querySelector('.session-input input')?.disabled ?? null,
    noticeVisible: Boolean(notice) && getComputedStyle(notice).display !== 'none',
    overflowsHorizontally: document.documentElement.scrollWidth > window.innerWidth,
  }
})()`

const INTERNAL_VOCABULARY = [
  /projection/i, /audited bridge/i, /coordinator thread/i, /health sweep/i,
  /source unavailable/i, /read-only/i, /\bfleet host\b/i, /subsystem/i,
  /localhost|127\.0\.0\.1/,
]
const README_PUNCTUATION = [['·', 'interpunct'], ['…', 'ellipsis'], ['—', 'em dash'], ['●', 'bullet']]

function normalize(sentence) {
  const filler = new Set(['a', 'an', 'the', 'is', 'are', 'has', 'have', 'be', 'to', 'of', 'on', 'in', 'it', 'this', 'that', 'your', 'you', 'and', 'so', 'here'])
  return sentence.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
    .map((word) => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word))
    .filter((word) => !filler.has(word)).join(' ')
}

async function main() {
  if (!fs.existsSync(exe)) {
    console.error(`No packaged application at ${exe}. Build it first (npm run build && npx electron-builder --win dir).`)
    process.exit(2)
  }
  const running = instancesOfThisExecutable()
  if (running.length) {
    console.error(
      `REFUSING: ${running.length} process(es) from this executable are already running (PIDs ${running.join(', ')}).\n`
      + 'Electron\'s single-instance lock is app-wide, so a second launch would quit instantly and silently.\n'
      + 'Close ToolsEnabled and run again. This tool never kills a process it did not start.',
    )
    process.exit(2)
  }

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'toolsenabled-home-qa-'))
  const environment = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  delete environment.ELECTRON_NO_ATTACH_CONSOLE

  const child = spawn(exe, [`--user-data-dir=${profile}`, `--remote-debugging-port=${CDP_PORT_REQUEST}`], {
    /* windowsHide suppresses the CONSOLE window only; the BrowserWindow is
       hidden by MC_SMOKE_HEADLESS=1 in the inherited environment (see
       shell/window-options.cjs), which tools/packaged-qa-suite.mjs sets. It was
       `false` here, so every automated run flashed a console on the desktop. */
    env: environment, stdio: 'ignore', windowsHide: true,
  })

  let home = null
  try {
    const deadline = Date.now() + LAUNCH_TIMEOUT_MS
    for (;;) {
      if (Date.now() > deadline) {
        throw new Error(cdpPort
          ? `the application did not present a home screen within ${LAUNCH_TIMEOUT_MS}ms (DevTools port ${cdpPort})`
          : `the application never wrote DevToolsActivePort into ${profile} within ${LAUNCH_TIMEOUT_MS}ms, so this run never inspected it`)
      }
      await delay(700)
      if (!cdpPort) cdpPort = readDevToolsPort(profile)
      try {
        const reading = await evaluate(READ_HOME)
        /* Wait for the first-paint gate: the screen deliberately renders
           nothing until its local reads answer, so an empty caption here is
           "not ready yet", not a failure. */
        if (reading?.present && reading.caption) { home = reading; break }
      } catch { /* the window is not up yet */ }
    }

    console.log(`\nhome screen read from ${exe}\n  mode: ${home.mode}\n`)

    const sentences = [home.headline, ...home.facts, home.panelTitle, home.panelBadge, home.footer]
      .map((value) => String(value || '').trim()).filter(Boolean)
    const everything = [...sentences, home.panelBody].join('\n')

    check('the screen rendered at all', home.present && Boolean(home.caption))
    check('the ring states one headline, and it is on the glass',
      Boolean(home.headline) && home.headlineVisible === true,
      `${JSON.stringify(home.headline)} visible=${home.headlineVisible}`)
    check('at least one fact is VISIBLY stated under the ring, and never more than three',
      home.facts.length >= 1 && home.facts.length <= 3,
      `${home.facts.length} visible of ${home.factsInDom} in the DOM: ${JSON.stringify(home.facts)}`)
    check('the panel is titled', Boolean(home.panelTitle), JSON.stringify(home.panelTitle))
    check('the panel body is on the glass', home.panelBodyVisible === true)

    /* The reported defect, measured on the glass. */
    const worksHere = sentences.filter((s) => /already works on this/i.test(s))
    const nothingHere = sentences.filter((s) => /no local agent fleet host|cannot run agents|not set up to run agents/i.test(s))
    check('the screen does not both claim and deny that it works on this computer',
      worksHere.length === 0 || nothingHere.length === 0,
      `${JSON.stringify(worksHere)} vs ${JSON.stringify(nothingHere)}`)

    const duplicates = []
    for (let i = 0; i < sentences.length; i += 1) {
      for (let j = i + 1; j < sentences.length; j += 1) {
        if (normalize(sentences[i]) === normalize(sentences[j])) duplicates.push([sentences[i], sentences[j]])
      }
    }
    check('the screen does not say the same thing twice', duplicates.length === 0, JSON.stringify(duplicates))

    const vocabulary = INTERNAL_VOCABULARY.filter((pattern) => pattern.test(everything)).map(String)
    check('the screen names no mechanism a person does not have', vocabulary.length === 0, vocabulary.join(', '))

    const punctuation = README_PUNCTUATION.filter(([character]) => sentences.some((s) => s.includes(character)))
    check('the screen does not punctuate like a README', punctuation.length === 0, punctuation.map(([, name]) => name).join(', '))

    check('the clock shows real numbers or is not shown at all',
      home.digitsHidden || (home.digits.length > 0 && home.digits.every((digit) => /^[0-9]+$/.test(digit))),
      `hidden=${home.digitsHidden} digits=${JSON.stringify(home.digits)}`)

    check('no input is offered that cannot accept anything',
      !home.composer || home.composerDisabled === false || home.mode === 'fleet',
      `composer=${home.composer} disabled=${home.composerDisabled} placeholder=${JSON.stringify(home.composerPlaceholder)}`)

    check('a demonstration is badged, and real data is not',
      home.mode === 'sample' ? Boolean(home.panelBadge) : home.panelBadge === '',
      `mode=${home.mode} badge=${JSON.stringify(home.panelBadge)}`)

    check('the floating example-data banner does not sit under home\'s own statement',
      home.noticeVisible === false, `notice visible=${home.noticeVisible}`)

    check('the page does not scroll sideways', home.overflowsHorizontally === false)
  } catch (error) {
    check('the check ran to completion', false, error.message)
  } finally {
    try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 20_000, stdio: 'ignore' }) } catch { /* already gone */ }
    await delay(1500)
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 150 }) } catch { /* a locked profile is not a product failure */ }
  }

  const passed = checks.filter((entry) => entry.ok).length
  console.log(`\n${passed}/${checks.length} checks passed`)
  if (problems.length) {
    console.error(`\n${problems.length} problem(s):`)
    for (const problem of problems) console.error(`  - ${problem}`)
  }
  process.exit(problems.length === 0 ? 0 : 1)
}

main().then(
  () => {},
  (error) => { console.error(error); process.exit(2) },
)
