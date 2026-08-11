#!/usr/bin/env node

// CAN A PERSON GET TO THE AGENT DETAIL PAGE? DRIVEN BY CLICKS, IN A REAL WINDOW.
//
// WHAT CHANGED, AND WHY THE FRESH-INSTALL CHECKS BELOW ARE NOT THE ONES THIS
// FILE SHIPPED WITH.
//
// This suite was written against a fresh install that drew NO computers at all,
// and it pinned that: `nodeCount === 0`, an explanation panel, and one door
// leading to the DEMONSTRATION copy of the drill-in. Every one of those checks
// passed, and a customer still could not open a real agent on their own machine
// — because the page's only source of computers was /data/fleet.json, a
// BUILD-TIME file that ships `ok:false` on every install and can never say
// anything else. Measured on this build, fresh profile: fleet.json ok:false,
// agents.json ok:false, and `window.mcOrg.read()` ok:true with a declared
// organisation sitting right there unread. See src/declared-fleet.js.
//
// So the machine now appears, drawn from the organisation this copy declares,
// and these checks assert THAT. The suite's rules are unchanged and are the
// reason the old pass was not worth much: reachability is claimed only for
// navigation performed by clicking a visible, named control, and a control that
// leads nowhere is a defect rather than a pass. What moved is the destination —
// the drill-in a fresh install can reach is now the LIVE page for an agent this
// machine really declares, not a labelled demonstration whose controls are
// deliberately inert.
//
// The empty state did not disappear and is not untested: it is now the answer
// for a copy with no organisation store behind it (a plain browser), and
// `declaredFleetData()` returning null for that case is pinned by name in
// tools/test/declared-fleet.test.mjs. What cannot be produced in a packaged
// window is not asserted here as though it had been.
//
// WHY THIS EXISTS AND WHY IT IS NOT tools/agent-subpage-qa.mjs. That harness
// checks the agent page renders correctly, and it reaches the page by doing
//     location.hash = '#/agent/c1/codex'
// which is the one thing a customer cannot do. It therefore passes in full on a
// build where NOTHING ROUTES TO THAT PAGE AT ALL -- which is exactly the state
// this tree was in: `agent` is not on the nav ring (it cannot be; the ring is
// parameterless and this route needs a computer id and an agent id), and the
// shipped public/data/fleet.json is `{"ok": false, "data": null}`, so a fresh
// install drew an empty page with no node to click and no control naming the
// drill-in. Three lanes had just finished rebuilding that page. Every one of
// those fixes sat behind a door that did not exist.
//
// So this suite asserts REACHABILITY, and it earns the word:
//   * It never assigns location.hash to satisfy a reachability check. Navigation
//     happens by clicking elements, the way a person does. There is a self-audit
//     below that reads this file's own source and fails if that rule is broken,
//     so the instrument cannot quietly start cheating. The ONE state check that
//     needs a deep link says so in its name and is not a reachability claim.
//   * Every control it clicks must first be VISIBLE (a real box, not
//     display:none, not visibility:hidden) and NAMED (a non-empty accessible
//     name). A control you cannot see or cannot read is not a way in.
//   * A control that leads nowhere counts as a defect, not a pass. The empty
//     state is checked for the ABSENCE of a dead button as well as the presence
//     of an explanation.
//
// ISOLATION -- each mechanism for a measured reason, taken from
// tools/agent-subpage-qa.mjs which learned them the hard way:
//   --user-data-dir  Electron resolves userData through the Windows known-folder
//                    API, not the environment; this is the supported override and
//                    it moves the single-instance lock so this runs alongside a
//                    copy someone is using.
//   LOCALAPPDATA     our OWN code (resolveServicesRoot) reads the environment, so
//                    the machine record lands in scratch. Load-bearing: without
//                    it this harness reads the OWNER'S recorded permission level.
//                    A lane that isolated only the user-data dir measured
//                    `unrestricted` on this machine and concluded from it that
//                    the tier was not enforced at all. It was wrong, and the
//                    wrong answer was repeated to the owner for hours.
//   USERPROFILE      so the Codex-home probe reads scratch, not a real profile.
// ELECTRON_RUN_AS_NODE is stripped: set, the binary runs headless as Node, exits
// 0, and is indistinguishable from a crash.
//
// RUN IT:
//   node tools/agent-route-reachability.mjs                 (all three tiers)
//   node tools/agent-route-reachability.mjs --tier guided
//   node tools/agent-route-reachability.mjs --keep          (keep the scratch dir)

import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SELF = fileURLToPath(import.meta.url)
const REPO_ROOT = path.resolve(path.dirname(SELF), '..')
const require_ = createRequire(import.meta.url)

function argument(name, fallback = null) {
  const at = process.argv.indexOf(name)
  return at === -1 ? fallback : process.argv[at + 1]
}

const RELEASE = path.resolve(argument('--release', path.join(REPO_ROOT, 'release', 'win-unpacked')))
const KEEP = process.argv.includes('--keep')
const TIERS = argument('--tier') ? [argument('--tier')] : ['guided', 'standard', 'unrestricted']

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

/* ---------- the instrument audits itself ----------
 * A reachability suite that reaches the page by assigning the hash is not a
 * reachability suite, and the failure mode is silent: it goes green and reports
 * that a missing door is present. The only navigation this file is allowed to do
 * for a reachability claim is a click, so the rule is enforced against the
 * source rather than trusted. The single permitted deep link is tagged with the
 * marker below and is used by a check whose NAME says it is a state check. */
const DEEP_LINK_MARKER = 'DEEP-LINK-STATE-CHECK'
function auditSelf() {
  const source = readFileSync(SELF, 'utf8')
  const offenders = source
    .split('\n')
    .map((line, index) => ({ line, at: index + 1 }))
    .filter(({ line }) => /location\.hash\s*=/.test(line))
    .filter(({ line }) => !line.includes(DEEP_LINK_MARKER))
    /* prose ABOUT the rule is not a breach of it */
    .filter(({ line }) => !/^\s*(\/\/|\*)/.test(line))
  return offenders
}

/* ---------- stage a real packaged copy ----------
 * Borrows the built binary and the capability payload and swaps in the CURRENT
 * dist/ and shell/, so this measures the working tree rather than whenever
 * release/ was last built. Writes nothing under release/. */
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
    /* ~10 lanes share this worktree, so `shell/` or `dist/` can be mid-edit and
       fail to boot for reasons that have nothing to do with what is under test.
       --dist/--shell point the stage at a copy of your own; the DEFAULT is still
       the working tree, so an unqualified run measures what is actually here. */
    const from = path.resolve(argument(`--${directory}`, path.join(REPO_ROOT, directory)))
    if (!existsSync(from)) throw new Error(`${directory}/ is missing; run \`npm run build\` first`)
    rmSync(path.join(unpacked, directory), { recursive: true, force: true })
    cpSync(from, path.join(unpacked, directory), { recursive: true })
  }
  cpSync(path.join(REPO_ROOT, 'package.json'), path.join(unpacked, 'package.json'))
  await asar.createPackage(unpacked, path.join(app, 'resources', 'app.asar'))
  return appExecutable(app)
}

/* Pick the launcher by SHAPE, not by spelling: the product is mid-rename, so a
   hardcoded executable name is guaranteed to be wrong for somebody. */
function appExecutable(appRoot) {
  const executables = readdirSync(appRoot).filter(entry => entry.toLowerCase().endsWith('.exe'))
  if (executables.length === 1) return path.join(appRoot, executables[0])
  if (executables.length === 0) throw new Error(`no .exe in the staged app at ${appRoot}`)
  const launcher = executables.find(entry => !/^(elevate|squirrel|crashpad)/i.test(entry))
  if (launcher) return path.join(appRoot, launcher)
  throw new Error(`cannot tell which of these is the launcher: ${executables.join(', ')}`)
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
        if (child.exitCode !== null) {
          throw new Error(`the app exited with code ${child.exitCode} before the debugger answered; this is a startup failure, not a slow paint`)
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
            return
          }
        } catch { /* not listening yet */ }
        await delay(500)
      }
      throw new Error('no debuggable page appeared within 30s, and the app is still running')
    },
    send(method, params = {}) {
      const id = nextId++
      socket.send(JSON.stringify({ id, method, params }))
      return new Promise(resolve => pending.set(id, resolve))
    },
    close() { try { socket?.close() } catch { /* already gone */ } },
  }
}

/* Written with the ENGINE'S OWN writer, so a record this harness creates is one
   the product would accept, and a schema change breaks the harness rather than
   letting it seed something the app quietly ignores. Seeding it also clears the
   first-run permission question, which otherwise holds every route at #/setup
   and would time this suite out on a screen that is not the one under test. */
function seedMachineRecord(profile, appRoot, tier) {
  const servicesRoot = path.join(profile, 'local', 'ToolsEnabled')
  const workspace = path.join(profile, 'home', 'ToolsEnabled')
  mkdirSync(servicesRoot, { recursive: true })
  mkdirSync(workspace, { recursive: true })
  const machineRecord = require_(path.join(REPO_ROOT, 'capability', 'src', 'lib', 'setup', 'machine-record.js'))
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

/* ---------- what is on the glass ----------
 * `visible` is MEASURED. Text in the DOM is not text on the screen, and a
 * control in the DOM is not a control a person can press. */
const PROBE = `(() => {
  const shown = node => {
    if (!node) return false
    const box = node.getBoundingClientRect()
    const style = getComputedStyle(node)
    if (!(box.width > 0 && box.height > 0)) return false
    return style.visibility !== 'hidden' && style.display !== 'none'
  }
  const norm = node => (node ? node.textContent.replace(/\\s+/g, ' ').trim() : '')
  /* The accessible name a screen reader would announce, in the order the
     accname spec resolves it. A button with a box but no name is not a door
     anyone can find. */
  const name = node => (node
    ? (node.getAttribute('aria-label') || norm(node) || node.getAttribute('title') || '')
    : '')
  const one = selector => document.querySelector(selector)
  const read = selector => {
    const node = one(selector)
    return { present: Boolean(node), visible: shown(node), name: name(node), text: norm(node) }
  }
  return {
    hash: location.hash,
    route: document.body.dataset.route || '',
    title: document.title,
    empty: read('.computers .graph-empty'),
    emptyHeading: read('.computers .graph-empty-h'),
    emptyReason: read('.computers .graph-empty-reason'),
    emptyBody: read('.computers .graph-empty-body'),
    emptyAction: read('.computers .graph-empty-action'),
    emptyNote: read('.computers .graph-empty-note'),
    openButton: read('.computers .graph-open-btn'),
    railUnavailable: read('.computers .stats-page .projection-unavailable'),
    projectionState: (document.querySelector('.computers') || {}).dataset?.projectionState || '',
    nodeCount: document.querySelectorAll('.computers .static-tree-node').length,
    agentView: read('.agentv'),
    agentLiveMode: (document.querySelector('.agentv') || {}).dataset?.liveMode || '',
    provenance: read('.agent-provenance'),
    cardCount: document.querySelectorAll('.ar-card').length,
    stateOut: read('.projection-state-out'),
    stateTitle: read('.projection-state strong'),
  }
})()`

async function drive(executable, scratch, tier) {
  const port = await freePort()
  const checks = []
  const check = (name, ok, detail = '') => {
    checks.push({ name, ok: Boolean(ok) })
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`)
  }

  const profile = path.join(scratch, `profile-${tier}`)
  for (const leaf of ['userdata', 'local', 'home']) mkdirSync(path.join(profile, leaf), { recursive: true })
  seedMachineRecord(profile, path.join(scratch, 'app'), tier)

  const environment = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  environment.LOCALAPPDATA = path.join(profile, 'local')
  environment.USERPROFILE = path.join(profile, 'home')
  environment.CODEX_HOME = path.join(profile, 'home', '.codex')
  mkdirSync(environment.CODEX_HOME, { recursive: true })

  const child = spawn(executable, [
    `--user-data-dir=${path.join(profile, 'userdata')}`,
    `--remote-debugging-port=${port}`,
  ], { env: environment, stdio: 'ignore' })

  const session = createSession(port, child)
  try {
    await session.open()
    await session.send('Runtime.enable')
    const evaluate = async expression => {
      const packet = await session.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (packet.result?.exceptionDetails) {
        throw new Error(packet.result.exceptionDetails.exception?.description || 'evaluate failed')
      }
      return packet.result?.result?.value
    }
    const until = async (label, expression, attempts = 60) => {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (await evaluate(expression)) return true
        await delay(250)
      }
      return false
    }
    /* Click by SELECTOR, and refuse to click what a person could not.
       Returns why it refused, so a failure names the reason rather than just
       reporting that nothing happened. */
    const clickVisible = async selector => evaluate(`(() => {
      const node = document.querySelector(${JSON.stringify(selector)})
      if (!node) return 'absent'
      const box = node.getBoundingClientRect()
      const style = getComputedStyle(node)
      if (!(box.width > 0 && box.height > 0)) return 'zero-size'
      if (style.visibility === 'hidden' || style.display === 'none') return 'hidden'
      node.click()
      return 'clicked'
    })()`)

    await until('the application origin',
      `location.protocol === 'http:' && Boolean(document.querySelector('#stage'))`)
    await delay(900)

    /* ---------- 1. THE FRESH INSTALL, WALKED FROM FIRST PAINT ---------- */
    const first = await evaluate(PROBE)
    check(`${tier}: a fresh install opens past the permission question`,
      first.route !== 'setup', `route=${first.route || '(none)'}`)

    /* home -> computers is one press of the forward chevron. This is the only
       navigation chrome the app has, so it is also the only way a person
       reaches this page at all. */
    const toComputers = await clickVisible('#nav-next')
    check(`${tier}: the computers page is reached by clicking the forward chevron`,
      toComputers === 'clicked', `#nav-next: ${toComputers}`)
    await until('the computers page', `document.body.dataset.route === 'computers'`)
    await delay(1400)

    const empty = await evaluate(PROBE)

    /* THE CHECK THAT WOULD HAVE CAUGHT IT. A fresh install has no fleet host and
       never will have one from a build-time file, so this is the state every
       customer opens on. The machine in front of the person must be ON their own
       fleet page. `0` here is the exact defect this repair closes. */
    check(`${tier}: a fresh install draws this computer on the fleet page`,
      empty.nodeCount >= 1, `tree nodes on screen = ${empty.nodeCount}`)
    check(`${tier}: and says the graph is the declared one, not an observed fleet`,
      empty.projectionState === 'declared', `data-projection-state=${JSON.stringify(empty.projectionState)}`)

    /* ---------- 2. DRAWING SOMETHING MUST NOT HIDE ANYTHING ----------
       The fleet projection's own refusal is a fact the customer is entitled to,
       and the easiest way to make this page look healthy would be to drop it.
       It has to survive, verbatim, beside the graph. */
    check(`${tier}: the page still states the fleet projection's own reason verbatim`,
      empty.railUnavailable.visible && /no local agent fleet host detected/i.test(empty.railUnavailable.text),
      JSON.stringify(empty.railUnavailable.text.slice(0, 140)))
    /* ...and says what a declared agent is, so a configured agent is never read
       as a running one. */
    check(`${tier}: and distinguishes declared agents from observed ones`,
      /not agents observed running/i.test(empty.railUnavailable.text),
      JSON.stringify(empty.railUnavailable.text.slice(0, 160)))

    /* ---------- 3. NO DEAD CONTROLS, AND NO EMPTY PANEL OVER A GRAPH ---------- */
    check(`${tier}: the "no computers are reporting" panel is gone now that one is`,
      !empty.empty.visible, `.graph-empty visible=${empty.empty.visible}`)

    /* ---------- 4. THE DOOR IS VISIBLE AND NAMED ---------- */
    check(`${tier}: the fleet page offers a visible, named way into the drill-in`,
      empty.openButton.visible && empty.openButton.name.trim().length > 0,
      `visible=${empty.openButton.visible} name=${JSON.stringify(empty.openButton.name)}`)

    /* ---------- 5. IT ACTUALLY GOES THERE, AND WHAT IT REACHES IS REAL ---------- */
    const opened = await clickVisible('.computers .graph-open-btn')
    check(`${tier}: the door can be pressed`, opened === 'clicked', `.graph-open-btn: ${opened}`)
    const arrived = await until('the agent detail page', `Boolean(document.querySelector('.agentv'))`)
    await delay(900)
    const detail = await evaluate(PROBE)
    check(`${tier}: pressing it lands on the agent detail page`,
      arrived && detail.agentView.visible, `hash=${detail.hash} agentv=${detail.agentView.visible}`)
    /* Reaching a page that renders nothing is the defect one layer along again. */
    check(`${tier}: the page it lands on has agents on it`,
      detail.cardCount >= 1, `roster cards = ${detail.cardCount}`)
    /* THE POINT OF THE WHOLE REPAIR. The drill-in a fresh install can reach must
       be the LIVE page for an agent this machine declares — not the labelled
       demonstration, whose controls are deliberately inert and which therefore
       cannot be a route to using the product. */
    check(`${tier}: what it reaches is this machine's own agent, not a demonstration`,
      detail.agentLiveMode === 'live' && !/\/example$/.test(detail.hash),
      `hash=${detail.hash} data-live-mode=${JSON.stringify(detail.agentLiveMode)}`)
    check(`${tier}: and the page says whose data it is`,
      detail.provenance.visible && /declared topology read from this computer/i.test(detail.provenance.text),
      JSON.stringify(detail.provenance.text.slice(0, 110)))

    /* ---------- 6. THE DEEP-LINK STATE IS NOT TERMINAL ---------- */
    /* NAMED AS A STATE CHECK, NOT A REACHABILITY CHECK. This is the one place a
       hash is assigned, and it is deliberate: the state under test is what a
       RESTORED WINDOW or a bookmark lands on when the projection has nothing,
       which is by definition arrived at without a click. What is asserted is
       that the state offers a way out, not that anything routes to it. */
    await evaluate(`location.hash = '#/agent/nobody/nobody'`) // DEEP-LINK-STATE-CHECK
    /* Wait for the RESOLVED state, not merely for a state: the loading state is
       also a .projection-state and deliberately carries no way out, so waiting
       on the class alone would sample the one case exempt from this check and
       report a defect that is not there. */
    await until('the resolved projection state',
      `Boolean(document.querySelector('.projection-state:not(.is-loading)'))`)
    await delay(400)
    const stranded = await evaluate(PROBE)
    check(`${tier}: a deep link into an empty projection is not a dead end (state check)`,
      stranded.stateOut.visible && stranded.stateOut.name.trim().length > 0,
      `out=${JSON.stringify(stranded.stateOut.name)} title=${JSON.stringify(stranded.stateTitle.text)}`)
    const escaped = await clickVisible('.projection-state-out')
    await until('the computers page again', `document.body.dataset.route === 'computers'`)
    const back = await evaluate(PROBE)
    check(`${tier}: and the way out actually returns to the computers page`,
      escaped === 'clicked' && back.route === 'computers', `${escaped}, route=${back.route}`)

    return checks
  } finally {
    session.close()
    try { child.kill() } catch { /* already gone */ }
    await delay(400)
  }
}

async function main() {
  const offenders = auditSelf()
  if (offenders.length) {
    console.error('This suite assigns location.hash outside the tagged state check, so its')
    console.error('reachability claims are not reachability claims. Offending lines:')
    for (const { line, at } of offenders) console.error(`  ${at}: ${line.trim()}`)
    process.exitCode = 1
    return
  }
  console.log('self-audit ok: navigation for every reachability check is by click\n')

  const scratch = mkdtempSync(path.join(tmpdir(), 'agent-route-'))
  let failures = 0
  try {
    console.log(`staging a packaged copy from ${RELEASE}`)
    const executable = await stage(scratch)
    console.log(`staged: ${executable}\n`)
    for (const tier of TIERS) {
      console.log(`--- permission level: ${tier} ---`)
      const checks = await drive(executable, scratch, tier)
      failures += checks.filter(entry => !entry.ok).length
      console.log('')
    }
  } finally {
    /* CLEANUP MUST NOT BE ABLE TO FAIL THE RUN.
       Windows holds the staged Electron's DLLs for a moment after the process
       exits, so `rm -rf` on scratch throws EPERM on d3dcompiler_47.dll. The
       first version of this let that escape the finally: 45 of 45 checks passed
       and the suite still exited 1, which is the same class of lie as reading an
       exit code through a pipe -- a green run reported as a failure, and next
       time a red run would be indistinguishable from it. Retry briefly, then say
       what was left behind and carry on; the verdict below is the checks. */
    if (KEEP) {
      console.log(`scratch kept at ${scratch}`)
    } else {
      let removed = false
      for (let attempt = 0; attempt < 5 && !removed; attempt += 1) {
        try { rmSync(scratch, { recursive: true, force: true }); removed = true } catch { await delay(600) }
      }
      if (!removed) console.log(`(could not remove the scratch copy at ${scratch}; it is safe to delete)`)
    }
  }
  console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`)
  process.exitCode = failures === 0 ? 0 : 1
}

await main()
