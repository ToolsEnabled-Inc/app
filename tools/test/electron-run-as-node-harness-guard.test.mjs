// ELECTRON_RUN_AS_NODE harness guard.
//
// WHAT WENT WRONG, and why folklore was not enough.
//
// Agent harnesses and some host terminals export ELECTRON_RUN_AS_NODE=1. That
// turns the Electron binary into plain Node. Launched with no script it reads
// stdin, hits EOF, and exits 0 -- silently, with no window. That signature is
// indistinguishable from a crash, and it cost this team an entire afternoon:
// it produced a confident and completely wrong "the product silently exits on
// launch" root cause, and it is very likely the original Machine-B launch
// blocker that drove days of work across two machines.
//
// The product itself was never exposed. shell/launch.cjs strips the variable
// before handing off to Electron, and tools/smoke-packaged.mjs strips it before
// spawning the packaged exe. The ship path was immune the whole time. The only
// exposed party was a human or an agent invoking the exe path DIRECTLY, which
// is exactly what everyone did.
//
// So the defence already existed in two files and existed nowhere as a RULE.
// A third harness written next week would not inherit it. Both existing strips
// have their own regression tests (tools/test/smoke-packaged-contract.test.mjs
// "C5", tools/test/capability-layer.test.mjs), but a per-file test only proves
// the file it names; it cannot notice a file that does not exist yet. This
// guard is the rule: it derives the set of harnesses that launch the GUI app
// and fails if any one of them does not neutralise the variable.
//
// WHAT COUNTS AS LAUNCHING THE GUI APP. A file qualifies when it both spawns a
// process and names the packaged executable. Naming it means a "Mission
// Control.exe" literal, the APP_EXE constant, or importing 'electron' (in a
// plain-Node context require('electron') returns the binary path, which is
// precisely how shell/launch.cjs obtains it).
//
// WHAT COUNTS AS NEUTRALISING IT. Three idioms are accepted because all three
// are in use and all three are correct:
//   1. `delete <env>.ELECTRON_RUN_AS_NODE`  -- shell/launch.cjs:9,
//                                              tools/smoke-packaged.mjs:200
//   2. `guiEnvironment(...)`                -- the shared helper exported from
//                                              shell/capability-layer.cjs:86,
//                                              used by capability-acceptance
//   3. a prefix scrub, `startsWith('ELECTRON_')` -- used by ToolsEnabled's
//                                              clean-env-launch harness
//
// WHAT IS DELIBERATELY NOT FLAGGED. shell/capability-layer.cjs SETS
// ELECTRON_RUN_AS_NODE=1 on purpose (line 78): it reuses Electron's own binary
// as the Node runtime for the capability layer, so no second Node ships. It
// spawns process.execPath and never names the GUI exe, so it does not match,
// which is the correct answer rather than a suppression. If a future file both
// names the GUI exe and sets the variable, it will be reported -- that
// combination is the actual bug this guard exists to catch.
//
// FAIL-CLOSED. A scan that matches nothing must never read as a pass; that is
// the same rule tools/check-suites-discovered.mjs applies to the test glob and
// tools/check-no-owner-data.mjs applies to itself. So this asserts that files
// were actually read, that at least one launcher was found, and that the two
// launchers the ship path depends on are among them.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCAN_ROOTS = ['shell', 'tools', 'src']
const SKIP_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'release', 'artifacts'])
const SOURCE_EXTENSIONS = new Set(['.js', '.cjs', '.mjs'])

// The two strips the shipped launch path depends on. Anchoring on them is what
// stops this guard from going green after a rename by scanning nothing useful.
// If either file is legitimately renamed, update this list in the same commit;
// that edit is the point, because it forces the rename to be seen.
const REQUIRED_LAUNCHERS = ['shell/launch.cjs', 'tools/smoke-packaged.mjs']

const SPAWNS_A_PROCESS = /(?:^|[^\w.])(?:spawn|spawnSync|execFile|execFileSync)\s*\(|\.\s*spawn\s*\(/
const NAMES_THE_GUI_EXE = [
  /(['"`])ToolsEnabled\.exe\1/,
  /\bAPP_EXE\b/,
  /require\(\s*['"]electron['"]\s*\)/,
  /from\s+['"]electron['"]/,
]
const NEUTRALISES_THE_VARIABLE = [
  /delete\s+[A-Za-z_$][\w$.]*\.ELECTRON_RUN_AS_NODE/,
  /guiEnvironment\s*\(/,
  /startsWith\(\s*['"]ELECTRON_/,
]

function toPosix(absolute) {
  return path.relative(REPO_ROOT, absolute).split(path.sep).join('/')
}

async function walk(directory, found = []) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry.name)) await walk(absolute, found)
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      found.push(absolute)
    }
  }
  return found
}

async function scan() {
  const files = []
  for (const root of SCAN_ROOTS) files.push(...(await walk(path.join(REPO_ROOT, root))))

  const launchers = []
  for (const absolute of files.sort()) {
    const source = await readFile(absolute, 'utf8')
    if (!SPAWNS_A_PROCESS.test(source)) continue
    if (!NAMES_THE_GUI_EXE.some((pattern) => pattern.test(source))) continue
    launchers.push({
      file: toPosix(absolute),
      neutralised: NEUTRALISES_THE_VARIABLE.some((pattern) => pattern.test(source)),
    })
  }
  return { scannedCount: files.length, launchers }
}

test('the scan actually reads this repo (a vacuous pass is not a pass)', async () => {
  const { scannedCount, launchers } = await scan()
  assert.ok(
    scannedCount > 0,
    `scanned 0 files under ${SCAN_ROOTS.join(', ')} -- this guard would pass while checking nothing`,
  )
  assert.ok(
    launchers.length > 0,
    'found no file that launches the packaged GUI app. Either the harnesses moved out of ' +
      `${SCAN_ROOTS.join('/, ')}/ or the detection patterns drifted; both make this guard silently useless.`,
  )
})

test('every harness that launches the packaged app is still detected', async () => {
  const { launchers } = await scan()
  const detected = new Set(launchers.map((entry) => entry.file))
  const missing = REQUIRED_LAUNCHERS.filter((file) => !detected.has(file))
  assert.deepEqual(
    missing,
    [],
    `these launch the packaged app and the guard no longer sees them: ${missing.join(', ')}. ` +
      'If a file was renamed, update REQUIRED_LAUNCHERS in this test in the same commit.',
  )
})

test('every harness that launches the packaged app strips ELECTRON_RUN_AS_NODE', async () => {
  const { launchers } = await scan()
  const offenders = launchers.filter((entry) => !entry.neutralised).map((entry) => entry.file)
  assert.deepEqual(
    offenders,
    [],
    'These files spawn the packaged ToolsEnabled executable without removing ' +
      `ELECTRON_RUN_AS_NODE from the child environment: ${offenders.join(', ')}.\n` +
      'Under an agent harness that variable is exported as 1, and the app will then start as ' +
      'plain Node, read stdin, hit EOF and exit 0 with no window -- which reads as a product ' +
      'crash and has already cost this team a full afternoon of wrong diagnosis.\n' +
      'Fix it with one of: `const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE`, ' +
      "or `env: guiEnvironment(process.env)` from shell/capability-layer.cjs (preferred -- do not " +
      'reimplement it from memory).',
  )
})
