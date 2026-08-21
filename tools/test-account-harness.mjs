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
import { assertRendererMeasurable, assertStagedRendererConsistent } from './lib/staged-renderer.mjs'

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
  /* THE RENDERER THIS RUN IS ABOUT TO MEASURE MUST BE THE ONE THE SOURCE SAYS.
     Shared with every other dist/-staging harness (tools/lib/staged-renderer.mjs);
     refuses with exit 2 and both timestamps rather than reporting a stale bundle
     as a defect in the product. */
  assertRendererMeasurable({ repoRoot: REPO_ROOT, sourceDist: path.join(REPO_ROOT, 'dist') })
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
  /* ...and the COPY of it must have arrived whole; see the module header for the
     blank-stage, no-exception symptom a torn copy produces. */
  assertStagedRendererConsistent({
    stagedDist: path.join(unpacked, 'dist'),
    sourceDist: path.join(REPO_ROOT, 'dist'),
  })
  cpSync(path.join(REPO_ROOT, 'package.json'), path.join(unpacked, 'package.json'))
  await asar.createPackage(unpacked, path.join(app, 'resources', 'app.asar'))
  /* AND THE CAPABILITY PAYLOAD, WHICH THIS FUNCTION USED TO LEAVE BEHIND.
   *
   * THE GAP, MEASURED ON THE DAY IT MATTERED. dist/ and shell/ were overlaid
   * from this tree and `resources/capability` was whatever the last
   * `npm run dist` happened to leave in release/win-unpacked. On 2026-08-17 that
   * directory was cut at 13:06 and capability/src/lib/agent-engine/ took the
   * Claude engine at 18:55, so every packaged driver in this repo was driving a
   * payload with NO claude-cli-process.js in it. shell/agent-host.cjs gates the
   * Claude tiers on a require() of exactly that file, so every one of those runs
   * would have reported "this copy carries no launcher" -- about a build that
   * ships one. A lane was one report away from certifying a cut against an
   * engine it had never once loaded.
   *
   * IT IS THE SAME PROMISE THE FUNCTION ALREADY MAKES. package.json's
   * electron-builder config maps extraResources capability -> capability, and
   * `npm run dist` runs pack:capability immediately before electron-builder. So
   * these bytes ARE the bytes the installer would carry; copying them here is
   * reproducing the ship path, not stepping around it. The asar is left alone
   * because the payload is a sibling of it, never inside it.
   *
   * NOT CURRENCY-CHECKED HERE, DELIBERATELY. tools/check-payload-current.mjs
   * owns "is capability/ newer than the source it was packed from", it is in the
   * dist chain, and a driver that wants the guarantee runs it. Re-deriving that
   * comparison here would be a second opinion that can disagree with the first. */
  const capability = path.join(REPO_ROOT, 'capability')
  if (existsSync(capability)) {
    const staged = path.join(app, 'resources', 'capability')
    rmSync(staged, { recursive: true, force: true })
    cpSync(capability, staged, { recursive: true })
  }
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

/* IS THIS THE NAME OF SOMETHING THAT COULD PAY FOR A MODEL TURN?
 *
 * Exported so the fence that proves the scrub works asks the SAME question the
 * scrub asks. A second copy of this rule in the test is a second copy that
 * drifts, and it would drift in the direction of passing.
 *
 * IT MATCHES ON THE NAME AND NEVER LOOKS AT A VALUE. A rule that inspected
 * values to decide what is secret would have to read every secret to run.
 *
 * IT IS DELIBERATELY WIDER THAN IT NEEDS TO BE, and the asymmetry is the whole
 * argument: this builds the environment for a TEST child. Over-scrubbing costs a
 * drive that fails loudly and gets fixed in a minute. Under-scrubbing costs the
 * operator's money, silently, and leaves evidence that looks green. So anything
 * name-shaped like a credential goes, and a variable a driver genuinely needs is
 * added back by name here rather than by loosening this.
 *
 * WHAT IT MUST NOT CATCH, checked against a real session's environment: paths
 * and ids that merely live under a vendor prefix -- CLAUDE_CODE_EXECPATH,
 * CLAUDE_CODE_SESSION_ID, CLAUDE_PID, CODEX_HOME, CLAUDE_CONFIG_DIR. Those are
 * how a run is wired, not how it pays. */
export function isProviderCredentialName(name) {
  const upper = String(name || '').toUpperCase()
  if (/^(CODEX_HOME|CLAUDE_CONFIG_DIR)$/.test(upper)) return false
  return /(API_KEY|ACCESS_KEY|PRIVATE_KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)/.test(upper)
    || /_KEY$/.test(upper)
}

/**
 * The environment a drive's child gets.
 *
 * THE PROMISE THIS FUNCTION MAKES is the module header's: a run never touches
 * the real installation. LOCALAPPDATA, APPDATA, USERPROFILE and CODEX_HOME are
 * redirected into scratch for exactly that reason -- so a drive cannot read the
 * machine's own Codex sign-in and report a finding about the wrong computer.
 *
 * IT WAS BREAKING THAT PROMISE FOR ONE PROVIDER, AND THE GAP WAS A VARIABLE
 * RATHER THAN A DIRECTORY. This function began `{ ...process.env }` and deleted
 * two Electron flags, so a drive launched from a session that holds
 * ANTHROPIC_API_KEY handed that key to the packaged app and every child it
 * spawned. Measured 2026-08-20, end to end, names and lengths only:
 *
 *   environmentFor() put into a drive child   ANTHROPIC_API_KEY (108 chars)
 *   a real child spawned with it reported     ANTHROPIC_API_KEY (108 chars)
 *   while CODEX_HOME and USERPROFILE were correctly in scratch
 *
 * TWO COSTS, and the second is the one that outlives the fix. A drive that
 * presses a Claude tier authenticates as the operator and bills them. And any
 * drive that reported a Claude session STARTING may have measured the inherited
 * key rather than the sign-in path a customer's machine would use -- a green
 * about something other than the product, the same shape as measuring a working
 * tree and calling it a commit.
 *
 * CLAUDE_CONFIG_DIR IS REDIRECTED, NOT DELETED, for the same reason CODEX_HOME
 * is set rather than unset: presence checks read a directory, and an operator
 * who has that variable pointing at their real ~/.claude would otherwise hand a
 * drive their Claude sign-in through the door Codex's was already closed at. On
 * a machine that does not set it, this lands on exactly the path the homedir
 * fallback already resolved to, so no drive changes behaviour.
 */
export function environmentFor(profile) {
  const environment = { ...process.env }
  /* Both deleted deliberately. ELECTRON_RUN_AS_NODE turns the packaged
     executable into a Node process with no app object; the console flag makes a
     child steal a console window on a machine somebody is working on. */
  delete environment.ELECTRON_RUN_AS_NODE
  delete environment.ELECTRON_NO_ATTACH_CONSOLE
  /* And every provider credential, the same way and for a harder reason. See
     isProviderCredentialName() above; tools/test/harness-credential-fence.test.mjs
     spawns a real child and fails if one of these arrives. */
  for (const name of Object.keys(environment)) {
    if (isProviderCredentialName(name)) delete environment[name]
  }
  if (VISIBLE) delete environment.MC_SMOKE_HEADLESS
  else environment.MC_SMOKE_HEADLESS = '1'
  environment.LOCALAPPDATA = path.join(profile, 'local')
  environment.APPDATA = path.join(profile, 'roaming')
  environment.USERPROFILE = path.join(profile, 'home')
  environment.CODEX_HOME = path.join(profile, 'home', '.codex')
  environment.CLAUDE_CONFIG_DIR = path.join(profile, 'home', '.claude')
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
              if (handler) { pending.delete(packet.id); handler.resolve(packet) }
            })
            /* A REPLY THAT CAN NEVER ARRIVE MUST NOT BE WAITED FOR FOREVER.
               When the window closes (which closeWindow ASKS it to do), the
               debugger socket drops before the reply to the very evaluate that
               asked. Un-settled promises here were how the stranger-journey
               driver ended with no summary and exit 0 while carrying four FAIL
               lines (measured 2026-08-18): the last await never settled, the
               event loop drained, node exited "cleanly", and ledger.finish()
               -- the only writer of the `N/M checks passed` verdict line the
               suite reads -- never ran. A dead socket now REJECTS everything
               still pending: closeWindow's try/catch absorbs the expected
               race, and a socket that dies mid-measurement fails the run
               loudly instead of feeding undefined into a check. */
            socket.addEventListener('close', () => {
              for (const [id, handler] of [...pending]) {
                pending.delete(id)
                handler.reject(new Error('the debugger socket closed before this reply arrived'))
              }
            }, { once: true })
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
      /* A send on an already-dead socket rejects immediately for the same
         reason the close handler rejects: a promise nobody can settle is how
         this file once turned four FAILs into an exit-0 with no verdict. */
      if (!socket || socket.readyState !== 1 /* OPEN */) {
        return Promise.reject(new Error('the debugger socket is not open'))
      }
      socket.send(JSON.stringify({ id, method, params }))
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
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
  /* WHO ACTUALLY RECEIVES THE PRESS. A dispatched click goes to \`hit\` and
     bubbles UP from it. So it reaches the target only when hit IS the target or
     one of the target's own descendants. An ANCESTOR hit means the target never
     receives the event -- pointer-events:none, a clip, or the target simply not
     painting at that point -- and the old rule (\`hit.contains(node)\`) accepted
     exactly that and printed "clicked" over a press the control never felt: a
     silent false green in every drive this harness ran (found 2026-08-18 by the
     rotation lane). The one honest exception is kept: a <label> whose control
     IS the target forwards activation by spec, so a press on the label is a
     real press on the control. */
  if (!hit) return { state: 'covered', by: 'nothing' }
  const labelFor = hit.closest ? hit.closest('label') : null
  const receives = hit === node || node.contains(hit) || (labelFor && labelFor.control === node)
  if (!receives) {
    const name = hit.tagName + (hit.className ? '.' + String(hit.className).split(' ')[0] : '')
    return { state: 'covered', by: hit.contains(node) ? ('own-ancestor-' + name) : name }
  }
  return { state: 'visible', x, y }
}`

/* ---- TAKING A PICTURE OF THIS BUILD, AND WHY THE OBVIOUS WAY LIES --------
 *
 * Three lanes lost time to Page.captureScreenshot in one night (2026-08-20), so
 * the readings live here, beside the function every driver in this family goes
 * through, rather than in three separate reports. Every driver rolls its own
 * shoot(); this is the part none of them should have to re-derive.
 *
 * 1 · WAKING THE WINDOW IS MANDATORY. setWebLifecycleState active, then a REAL
 *     input event (a 1px mouseMoved), then two frames. A window opened with
 *     show:false is not compositing, captureScreenshot waits for a frame that
 *     will never come, and requestAnimationFrame alone does not wake it.
 *
 * 2 · fromSurface: false NEVER RETURNS under MC_SMOKE_HEADLESS=1. Measured:
 *     12s deadline, three attempts, on five separate captures in one run --
 *     every single one timed out. A dead path, not a slow one. A driver that
 *     reaches for it (a committed one does) silently loses all its evidence.
 *     Use the default.
 *
 * 3 · THE TELL IS NOT THE IMAGE SIZE, and this is the correction that matters
 *     most, because "check the file came out the right size" is the defence a
 *     reader invents and it does not work. Under an Emulation override the PNG
 *     comes out at EXACTLY the requested width -- 1024x900, 1440x900, 1920x900,
 *     measured -- while the painted CONTENT is the layout the window still has.
 *     Nothing about the file betrays it. One lane's "1920" image showed the
 *     segmented controls clipped mid-word ("Every agent" cut to "Every") beside
 *     a DOM read taken in the same breath reporting horizontalOverflow: false:
 *     two accounts of one window that cannot both be true.
 *
 *     THE RULE: a picture taken under Emulation.setDeviceMetricsOverride cannot
 *     be trusted to agree with a DOM read taken in the same breath. The only
 *     cure is to resize the REAL window. This is also why a before/after pair
 *     taken at the window's own size, with no override at all, is trustworthy
 *     -- not as a detail of one run, but as the general rule.
 *
 * 4 · Browser.setWindowBounds RESIZES THE REAL WINDOW, AND IS NOT AVAILABLE
 *     HERE. It needs a windowId from Browser.getWindowForTarget, and headless
 *     Electron does not give one -- measured by two lanes independently, across
 *     three widths and repeated attempts. So on this build, in a headless run,
 *     there is currently NO working way to take a trustworthy width-labelled
 *     picture through the debugger.
 *
 * 5 · THE WAY THAT DOES WORK, and the better question underneath it.
 *
 *     THE PICTURE: shell/main.cjs restores its window from
 *     <userData>/shell-state.json (shell/window-state.cjs; minimum 980x640), so
 *     seeding that file BEFORE launch opens a real native window at that size.
 *     Surface, layout and photograph are then one thing. One window per width.
 *     Worked example: tools/context-window-drive.mjs, driveAtWidth().
 *
 *     THE BETTER QUESTION: "are the controls cut off at 1920" does not need a
 *     photograph at all. It needs element rectangles measured against the
 *     viewport -- and geometry is exactly what an emulated viewport genuinely
 *     does change. So the measurement is trustworthy precisely where the image
 *     is not, it names the offending element and pixel instead of inviting
 *     somebody to squint at a PNG, and the surface/override disagreement cannot
 *     reach it. Reach for the picture when a person has to SEE it; reach for
 *     the rectangles when the question is whether something fits.
 *
 * 6 · WHICHEVER ROUTE, THE INSTRUMENT STATES ITS OWN MODE. Read innerWidth and
 *     innerHeight back off the page, print them beside what was asked for and
 *     beside which route was used (real window or emulation), and refuse to
 *     label a picture with a width the page never reported. A resize that
 *     silently does not take is the same failure family as everything else
 *     here: an instrument reporting a state it never reached. A self-checking
 *     log beats a correct result somebody has to trust.
 * ------------------------------------------------------------------------- */

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
  /* WAITED FOR, NOT SLEPT THROUGH.
   *
   * This was `await delay(11000)` with the note "scrypt at N=2^17 twice -- once
   * to create, once to sign in". The number was a guess at how long two key
   * derivations take on the machine that happens to be running, and it is the
   * wrong SHAPE of answer: a fixed sleep is right only on a machine exactly as
   * fast as the one it was written on. Measured 2026-08-18 on a staged packaged
   * build, tools/owner-account-packaged-qa read the screen at 11s and found the
   * create question still on it, and reported "the window says who is signed in
   * -- Who is using this copy?" -- four failures, on a run whose OWN later
   * checks proved the account existed, was signed in, and took a payment card.
   * The product had repainted; the harness had stopped looking.
   *
   * So the screen is polled for the outcome the person is waiting for, and the
   * wait ENDS on a refusal too: src/views/account.js paints "That did not work."
   * on a refused create, and a harness that waited out the full budget for that
   * would turn a fast, correct refusal into a slow timeout. */
  const settled = await waitForAccountOutcome(window)
  return settled.signedIn ? 'submitted' : `create-did-not-settle:${settled.detail}`
}

/**
 * Wait until the account screen has an ANSWER on it: signed in, or a refusal.
 *
 * The budget is generous rather than tuned. Two scrypt derivations at the
 * shipped cost are seconds of real work, and a slower machine is not a defect;
 * what would be a defect is the screen never changing, and that is what running
 * out of budget here reports.
 */
export async function waitForAccountOutcome(window, { timeoutMs = 60_000 } = {}) {
  const until = Date.now() + timeoutMs
  let last = null
  for (;;) {
    last = await window.evaluate(`(() => {
      const title = document.querySelector('.setup-title')
      const notice = document.querySelector('[data-account-notice], .setup-notice')
      return {
        title: title ? title.textContent.trim() : '',
        notice: notice ? notice.textContent.trim().slice(0, 160) : '',
        tone: notice ? (notice.getAttribute('data-tone') || notice.className) : '',
      }
    })()`)
    if (/^Signed in as /.test(last?.title || '')) return { signedIn: true, detail: last.title, waitedMs: timeoutMs - (until - Date.now()) }
    if (/did not work/i.test(last?.notice || '')) return { signedIn: false, detail: `refused: ${last.notice}` }
    if (Date.now() >= until) {
      /* SAY WHAT THE SCREEN ACTUALLY HAS ON IT. "the screen still reads X" was
         not enough to act on: it cannot tell a create that was refused in words
         this poll does not recognise from one that never answered at all. */
      const wider = await window.evaluate(`(() => {
        const body = document.querySelector('.setup-shell, .account-page, main') || document.body
        return (body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 400)
      })()`)
      return { signedIn: false, detail: `after ${Math.round(timeoutMs / 1000)}s the screen still reads ${JSON.stringify(last?.title || '(no title)')}; notice=${JSON.stringify(last?.notice || '')}; screen=${JSON.stringify(wider)}` }
    }
    await delay(400)
  }
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
  /* Same reasoning as createAccountOnScreen: one derivation here, not two, but
     a fixed sleep is the wrong shape of answer either way. */
  const settled = await waitForAccountOutcome(window)
  return settled.signedIn ? 'submitted' : `sign-in-did-not-settle:${settled.detail}`
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
