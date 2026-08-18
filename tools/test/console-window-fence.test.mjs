/* NOTHING ON THE AGENT-START PATH MAY PUT A CONSOLE WINDOW ON THE DESKTOP.
 *
 * WHAT WENT WRONG, MEASURED. The installed build popped a black console window
 * every time an agent session started. STANDING-ORDERS.md class LOCAL-WORK rule
 * 3 already forbade exactly that -- "console windows must never flash" -- and
 * the rule had nothing enforcing it, so it was true in a document and false in
 * the product.
 *
 * WHERE THE WINDOW CAME FROM, because the obvious answer was wrong and a future
 * reader will reach for it again. It was NOT a missing `windowsHide`, and NOT a
 * `.cmd` shim going through cmd.exe. Both were measured on 2026-08-17 from an
 * Electron main process owning no console (the installed app's condition), with
 * each child reporting its own GetConsoleWindow():
 *
 *     stdio pipe, no windowsHide .................. no console at all
 *     stdio pipe, windowsHide: true ............... no console at all
 *     shell: true, either way ..................... no console at all
 *     a .cmd shim via shell: true, either way ..... no console at all
 *     stdio: 'inherit', no windowsHide ............ CONSOLE, WINDOW VISIBLE
 *     stdio: 'inherit', windowsHide: true ......... console, window hidden
 *
 * The window belonged to a GRANDCHILD. `codex` is installed by npm as a Node
 * launcher, bin/codex.js, whose last act is
 * `spawn(nativeBinary, argv, { stdio: 'inherit' })` with no windowsHide -- the
 * one row above that shows a window. Our spawn correctly left that launcher
 * with no console, so Windows gave codex.exe a brand new one WITH a window.
 * Observed: a 895x518 ConsoleWindowClass window owned by codex.exe, once per
 * session start; zero after the fix, with the JSON-RPC handshake still
 * completing against codex 0.146.0.
 *
 * THE FIX A FLAG COULD NOT MAKE. A flag we pass cannot reach a grandchild, so
 * the payload resolves the npm launcher to the native executable and starts
 * that directly, under its own windowsHide. That resolution lives in the
 * payload's single spawn seam, src/lib/proc/hidden-spawn.js.
 *
 * WHAT THIS FILE ASSERTS, and why it lives in THIS repo. The engine repo has
 * its own fence over its own sources (tests/agent-engine/hidden-spawn-fence.test.js).
 * This is the repo that CUTS THE INSTALLER, so this asserts the property of the
 * bytes that are about to ship: the staged payload, and shell/, which is the
 * half of the agent-start path the payload does not contain.
 *
 * IT IS CHEAP ON PURPOSE -- it reads files and starts nothing, so it belongs in
 * `npm test` rather than on the release gate.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const SHELL = path.join(REPO, 'shell')
const PAYLOAD = path.join(REPO, 'capability')

/* The payload's agent-start modules, named the same way shell/agent-host.cjs
   names them so the two cannot drift apart silently. */
const PAYLOAD_ENGINE_DIR = 'src/lib/agent-engine'
const PAYLOAD_SEAM = 'src/lib/proc/hidden-spawn.js'

/* shell/launch.cjs is the `npm run app` development launcher, not a shipped
   start path: it deliberately inherits stdio so a developer sees the app's
   output in the terminal they started it from, and in that situation the parent
   already owns the console the child attaches to, so nothing new appears. It is
   named here rather than silently skipped -- an exemption that is not written
   down is an exemption nobody can argue with later. */
const SHELL_EXEMPT = new Set(['launch.cjs'])

/* Blank comments so the rules match CODE, not the prose explaining them.
 *
 * LINE COMMENTS COME OFF FIRST, AND THE ORDER IS LOAD-BEARING. The shape used
 * elsewhere in this directory strips block comments with one whole-file regex
 * before touching line comments. That reads the slash-star inside a glob written
 * in a LINE comment -- `tests/agent-comms/*.js`, and this tree is full of them --
 * as opening a block, finds no close, and blanks everything up to the next one.
 * Measured in the engine repo's sibling fence: it swallowed a plain
 * `require('node:child_process')` fifty lines down and reported zero violations.
 *
 * Removing the line comment first deletes that text before it can be mistaken
 * for anything, and walking line by line means the stripper can never cross a
 * newline it did not intend to. It may under-strip; it must never over-strip. */
function codeOnly(source) {
  const lines = []
  let inBlock = false
  for (const original of source.split('\n')) {
    let text = original
    if (inBlock) {
      const close = text.indexOf('*/')
      if (close === -1) { lines.push(''); continue }
      text = text.slice(close + 2)
      inBlock = false
    }
    text = text.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')
    for (let guard = 0; guard < 100; guard += 1) {
      const open = text.indexOf('/*')
      if (open === -1) break
      const close = text.indexOf('*/', open + 2)
      if (close === -1) { text = text.slice(0, open); inBlock = true; break }
      text = `${text.slice(0, open)} ${text.slice(close + 2)}`
    }
    lines.push(text)
  }
  return lines.join('\n')
}

/* Every spawn/spawnSync call in `source`, each read to its balanced closing
   paren so the options object is complete. Strings are tracked so a paren
   inside a literal cannot end the call early. */
function spawnCallsIn(source) {
  const calls = []
  const opener = /\bspawn(?:Sync)?\s*\(/g
  let match
  while ((match = opener.exec(source))) {
    let depth = 0
    let quote = null
    let escaped = false
    for (let i = match.index + match[0].length - 1; i < source.length && i - match.index < 4000; i += 1) {
      const character = source[i]
      if (quote) {
        if (escaped) { escaped = false; continue }
        if (character === '\\') { escaped = true; continue }
        if (character === quote) quote = null
        continue
      }
      if (character === '"' || character === "'" || character === '`') { quote = character; continue }
      if (character === '(') depth += 1
      else if (character === ')') {
        depth -= 1
        if (depth === 0) { calls.push(source.slice(match.index, i + 1)); break }
      }
    }
  }
  return calls
}

function jsFilesIn(directory) {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && /\.(?:c?js|mjs)$/.test(entry.name))
    .map(entry => entry.name)
}

/* capability/ is a gitignored BUILD OUTPUT: a fresh clone has none, and
   `npm run pack:capability` is what produces it. So its absence cannot be a
   test failure in `npm test` without making a clean checkout permanently red.
   The skip carries its reason into the TAP output rather than passing silently
   -- a fence that says nothing when it checked nothing is how "all green" stops
   meaning anything. Absence is
   fatal on the path where it must be: tools/check-asar-manifest.mjs gates every
   declared payload module against the built payload before a cut. */
/* PAYLOAD.json is what the packer writes LAST, so it is the honest "a payload
   is staged" signal. An earlier version of this asked whether capability/src
   existed, which is true of the empty directory a half-finished pack leaves
   behind -- and that reported a missing seam as a product defect.
 *
 * WHY THE CHECK FOLLOWS THE PAYLOAD'S OWN DECLARATION RATHER THAN JUST LOOKING.
 *
 * The payload is packed from a PINNED engine worktree, and this repo cannot
 * advance that pin. A pin older than the console-window fix produces a payload
 * with no seam in it, and a fence that failed on that would paint this repo red
 * over a change nobody working here can make -- which is how a real guard gets
 * deleted for being noisy.
 *
 * So the payload assertions go live exactly when the payload SAYS it carries
 * the seam (tools/capability-manifest.json -> hostModules, copied into
 * PAYLOAD.json by the packer). Until the pin advances and the manifest lists it,
 * they skip and say why. From the moment it is declared, tools/check-asar-manifest.mjs
 * already fails any build that declares a hostModule it does not ship, so the
 * declaration is load-bearing rather than decorative -- and these checks then
 * assert the property of the bytes behind it. */
function payloadRecord() {
  try { return JSON.parse(readFileSync(path.join(PAYLOAD, 'PAYLOAD.json'), 'utf8')) } catch { return null }
}
const declaredModules = payloadRecord()?.hostModules ?? []
const payloadStaged = declaredModules.includes(PAYLOAD_SEAM)
const SKIP_REASON = 'the staged payload does not declare ' + PAYLOAD_SEAM
  + ' -- the engine pin it was packed from predates the console-window fix,'
  + ' so these checks would be measuring a payload that cannot pass them.'
  + ' Advance the pin, add the seam to tools/capability-manifest.json hostModules, and repack.'

test('1. the packed payload carries the single spawn seam', { skip: !payloadStaged && SKIP_REASON }, () => {
  /* ABSENCE OF THE SEAM INSIDE A STAGED PAYLOAD IS THE FAILURE MODE THAT
     MATTERS. If the payload were packed from an engine pin that predates the
     seam, test 2 would pass over a set of files that never reach it and report
     success about a build that still pops a window on every session start. */
  const seam = path.join(PAYLOAD, PAYLOAD_SEAM)
  assert.ok(
    existsSync(seam),
    `the staged payload has no ${PAYLOAD_SEAM}. The engine pin this payload was packed from predates the `
    + 'console-window fix, so the shipped agent path can still pop a console window per session start.',
  )
  const source = codeOnly(readFileSync(seam, 'utf8'))
  assert.match(source, /windowsHide:\s*true/, 'the spawn seam must always set windowsHide')
  assert.match(source, /shell:\s*false/, 'the spawn seam must never use a shell')
  assert.match(
    source,
    /codex\.exe/,
    'the seam must resolve the Codex npm launcher to its native executable; without that resolution the '
    + "launcher's own stdio:'inherit' spawn allocates a VISIBLE console window on every session start",
  )
})

test('2. every agent-engine module in the payload launches through the seam', { skip: !payloadStaged && SKIP_REASON }, () => {
  const directory = path.join(PAYLOAD, PAYLOAD_ENGINE_DIR)
  const files = jsFilesIn(directory)
  assert.ok(files.length > 0, `the staged payload carries no ${PAYLOAD_ENGINE_DIR}; the agent path is not in this build`)

  const offenders = []
  for (const name of files) {
    const source = codeOnly(readFileSync(path.join(directory, name), 'utf8'))
    if (/require\(\s*['"](?:node:)?child_process['"]\s*\)/.test(source)) {
      offenders.push(`${PAYLOAD_ENGINE_DIR}/${name}: requires child_process directly instead of the ${PAYLOAD_SEAM} seam`)
    }
    if (/\bshell\s*:\s*true\b/.test(source)) {
      offenders.push(`${PAYLOAD_ENGINE_DIR}/${name}: passes shell: true`)
    }
    if (/\bwindowsHide\s*:\s*false\b/.test(source)) {
      offenders.push(`${PAYLOAD_ENGINE_DIR}/${name}: passes windowsHide: false`)
    }
    if (/\bstdio\s*:\s*['"]inherit['"]/.test(source)) {
      offenders.push(`${PAYLOAD_ENGINE_DIR}/${name}: inherits stdio, the one combination measured to show a console`)
    }
  }
  assert.deepEqual(offenders, [], offenders.join('\n'))
})

test('3. no shipped shell module spawns a child that can show a console', () => {
  const offenders = []
  for (const name of jsFilesIn(SHELL)) {
    if (SHELL_EXEMPT.has(name)) continue
    const source = codeOnly(readFileSync(path.join(SHELL, name), 'utf8'))
    if (/\bshell\s*:\s*true\b/.test(source)) offenders.push(`shell/${name}: passes shell: true`)
    if (/\bwindowsHide\s*:\s*false\b/.test(source)) offenders.push(`shell/${name}: passes windowsHide: false`)
    if (/\bstdio\s*:\s*['"]inherit['"]/.test(source)) {
      offenders.push(`shell/${name}: inherits stdio, the one combination measured to show a console`)
    }
    /* A spawn in the shell that names no windowsHide at all. Matched on the
       call rather than the file so a module that merely mentions spawn in a
       comment is not accused, and read to its BALANCED closing paren -- a lazy
       `.{0,600}?\)` stops at the first `)` inside the options object and
       reported capability-layer.cjs, which sets the flag two lines later. */
    for (const call of spawnCallsIn(source)) {
      if (/windowsHide/.test(call)) continue
      /* A call that forwards an options object it was handed cannot state the
         flag itself; the seam it forwards to is what must set it. */
      if (/\.\.\.\s*options/.test(call)) continue
      offenders.push(`shell/${name}: spawns without windowsHide -> ${call.replace(/\s+/g, ' ').slice(0, 90)}`)
    }
  }
  assert.deepEqual(offenders, [], offenders.join('\n'))
})

test('4. the exemption list names only files that exist', () => {
  /* A stale exemption is an exemption for a file nobody can find, which is how
     a real offender gets quietly forgiven under an old name. */
  const present = new Set(jsFilesIn(SHELL))
  const stale = [...SHELL_EXEMPT].filter(name => !present.has(name))
  assert.deepEqual(stale, [], `exempted shell files that no longer exist: ${stale.join(', ')}`)
})
