/* THE NSIS UPGRADE RESCUE, PROVEN WITHOUT A NSIS TOOLCHAIN.
 *
 * build/installer.nsh customInit copies the customer's runtime state -- their
 * vault and the signed audit ledger -- out of the install directory to the
 * per-user state root BEFORE the upgrading installer runs the old uninstaller's
 * `RMDir /r $INSTDIR`. That deletion is the defect these tests exist against:
 * without the hook the vault is gone before the new application's first line
 * runs (check-install-dir-immutable phase D documents exactly this and names
 * this file's customInit as the fix).
 *
 * THE FULL ROUND-TRIP HAS NOW BEEN RUN, and this header used to say it could
 * not be. It claimed "makensis is not installed and there is no electron-builder
 * NSIS cache". Both halves were false when checked on 2026-08-11: the cache holds
 * nsis-3.0.4.1 and nsis-resources-3.4.1, and makensis.exe sits in its Bin/
 * directory. Nobody had looked. The claim was then quoted downstream as a known
 * limitation, which is how an unrun test becomes a documented one.
 *
 * What the round trip proved, on real bytes, with real installers built by
 * electron-builder + makensis from this tree (see tools/nsis-upgrade-roundtrip.ps1,
 * which is how to re-run it):
 *
 *   - makensis compiles build/installer.nsh: no typo'd macro, no undefined symbol.
 *   - Seeded vault, signed ledger and a NESTED file all survived a genuine
 *     upgrade byte-identical, with the old install directory confirmed deleted
 *     by the old uninstaller's `RMDir /r $INSTDIR`.
 *   - MUTATION PROOF: rebuilt with customInit's body removed, the same round trip
 *     lost all three files. The rescue is what saves them, not the ordering.
 *   - The never-overwrite guard holds on real bytes: a stale install-dir vault
 *     did not overwrite a current one already in the state root.
 *   - ${PRODUCT_NAME} resolves to the folder Electron uses for userData -- the
 *     rescue landed in %APPDATA%\<productName>\capability\.
 *   - The shell-var context is `current` at customInit, so $APPDATA is the user's.
 *   - CopyFiles/SHFileOperation really does recurse: the nested file came across.
 *
 * The round trip runs under a DISTINCT product identity by design, so it can
 * never aim `RMDir /r` at the real product's state root; that harness refuses
 * the shipping product name outright.
 *
 * This suite remains the fast, always-run guard. It proves the logic two ways
 * that need no toolchain, so a regression is caught in the ordinary test run
 * rather than only by a build:
 *
 *   1. It reads the REAL build/installer.nsh and asserts the load-bearing
 *      invariants are present in it -- the exact source and destination paths,
 *      the never-overwrite guard, the full runtime-state directory list, and
 *      that the list matches RUNTIME_STATE_DIRECTORIES in the shipped
 *      application module. So the behavioural model below cannot drift away from
 *      the file that actually ships, and a new state directory added on the app
 *      side but forgotten in the installer fails here.
 *
 *   2. It executes a faithful model of the macro's control flow -- the same
 *      per-directory guard (source non-empty AND destination absent-or-empty),
 *      the same recursive copy CopyFiles performs, then the old uninstaller's
 *      RMDir of the whole install directory -- and asserts a seeded vault file
 *      survives, byte for byte, in the state root.
 *
 * WHAT THIS SUITE STILL CANNOT SEE, and the round trip can: everything in the
 * list above depends on a compiler and an installed product, so it is asserted
 * here by construction and by reading the template flow, not executed. Run
 * tools/nsis-upgrade-roundtrip.ps1 before shipping a change to build/installer.nsh
 * or to RUNTIME_STATE_DIRECTORIES -- a green run here is necessary and not
 * sufficient.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const INSTALLER_NSH = path.join(REPO_ROOT, 'build', 'installer.nsh')
const STATE_ROOT_MODULE = path.join(REPO_ROOT, 'capability', 'src', 'lib', 'runtime-state-root.js')

const NSH = fs.readFileSync(INSTALLER_NSH, 'utf8')

/* The directory names the installer rescues, read out of the macro insertions
 * in the real file rather than restated here. */
function rescuedDirsFromNsh(text) {
  const dirs = []
  const re = /!insertmacro\s+RescueOneStateDir\s+"([^"]+)"/g
  let m
  while ((m = re.exec(text)) !== null) dirs.push(m[1])
  return dirs
}

/* RUNTIME_STATE_DIRECTORIES as the shipped application module declares it. */
function appStateDirs() {
  const src = fs.readFileSync(STATE_ROOT_MODULE, 'utf8')
  const block = src.match(/RUNTIME_STATE_DIRECTORIES\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/)
  assert.ok(block, 'RUNTIME_STATE_DIRECTORIES array not found in runtime-state-root.js')
  return [...block[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
}

// --------------------------------------------------------------------------
// 1. The file is wired and shaped the way the fix requires.

test('customInit is defined and runs the rescue', () => {
  assert.match(NSH, /!macro\s+customInit/, 'customInit macro must exist -- it is the load-bearing hook')
  assert.match(
    NSH,
    /!macro\s+customInit\s*\n\s*!insertmacro\s+RescueLegacyInstallDirState/,
    'customInit must insert the rescue',
  )
  // customUnInit exists as defense-in-depth and is gated so a genuine uninstall
  // is not turned into a copy-out.
  assert.match(NSH, /!macro\s+customUnInit/, 'customUnInit macro must exist')
  const unInit = NSH.slice(NSH.indexOf('!macro customUnInit'))
  assert.match(unInit, /\$\{If\}\s+\$\{isUpdated\}/, 'customUnInit must gate the rescue on ${isUpdated}')
})

test('the rescue copies FROM the install dir TO the userData state root', () => {
  assert.match(
    NSH,
    /StrCpy\s+\$R4\s+"\$INSTDIR\\resources\\capability\\\$\{Dir\}"/,
    'source must be $INSTDIR\\resources\\capability\\<dir> -- where the defective build wrote',
  )
  assert.match(
    NSH,
    /StrCpy\s+\$R5\s+"\$APPDATA\\\$\{PRODUCT_NAME\}\\capability\\\$\{Dir\}"/,
    'destination must be $APPDATA\\<PRODUCT_NAME>\\capability\\<dir> -- app.getPath(userData)/capability',
  )
})

test('the rescue never overwrites existing state-root data', () => {
  // The guard: source exists (non-empty) AND destination does not.
  assert.match(NSH, /\$\{If\}\s+\$\{FileExists\}\s+"\$R4\\\*\.\*"/, 'must require the legacy source to exist')
  assert.match(
    NSH,
    /\$\{AndIfNot\}\s+\$\{FileExists\}\s+"\$R5\\\*\.\*"/,
    'must skip when the destination already holds data (never-overwrite)',
  )
})

test('the installer rescues exactly the directories the app treats as state', () => {
  const inInstaller = rescuedDirsFromNsh(NSH)
  const inApp = appStateDirs()
  assert.ok(inInstaller.length > 0, 'installer.nsh must rescue at least one directory')
  assert.deepEqual(
    [...inInstaller].sort(),
    [...inApp].sort(),
    'installer rescue list must match RUNTIME_STATE_DIRECTORIES; a divergence loses a directory on upgrade',
  )
  // vault and state (the audit ledger lives there) are the ones that matter most.
  assert.ok(inInstaller.includes('vault'), 'the vault must be rescued')
  assert.ok(inInstaller.includes('state'), 'state (the audit ledger) must be rescued')
})

// --------------------------------------------------------------------------
// 2. A faithful model of the macro, run end to end across the real sequence.

const RESCUED_DIRS = rescuedDirsFromNsh(NSH)

function dirHasEntries(p) {
  // Models NSIS ${FileExists} "p\*.*": true iff p is a directory with >=1 entry.
  try {
    return fs.statSync(p).isDirectory() && fs.readdirSync(p).length > 0
  } catch {
    return false
  }
}

function copyTree(from, to) {
  // Models CopyFiles /SILENT "from\*.*" "to": recursive copy of the contents of
  // `from` into `to` (SHFileOperation semantics), overwriting within the copy.
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name)
    const t = path.join(to, entry.name)
    if (entry.isDirectory()) copyTree(s, t)
    else if (entry.isFile()) fs.copyFileSync(s, t)
  }
}

/* The exact control flow of RescueLegacyInstallDirState / RescueOneStateDir.
 * instDir is $INSTDIR; appData is $APPDATA; the product folder is PRODUCT_NAME. */
function runRescueMacro({ instDir, appData, productName = 'ToolsEnabled' }) {
  const capabilityRoot = path.join(instDir, 'resources', 'capability')
  if (!dirHasEntries(capabilityRoot)) return // top-level ${If} ${FileExists} guard
  for (const dir of RESCUED_DIRS) {
    const src = path.join(capabilityRoot, dir) // $R4
    const dest = path.join(appData, productName, 'capability', dir) // $R5
    if (dirHasEntries(src) && !dirHasEntries(dest)) {
      fs.mkdirSync(dest, { recursive: true }) // CreateDirectory $R5
      copyTree(src, dest) // CopyFiles /SILENT "$R4\*.*" "$R5"
    }
  }
}

function scratch(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function seedDefectiveInstall(instDir, { vaultBytes, ledgerBytes, logBytes }) {
  const cap = path.join(instDir, 'resources', 'capability')
  fs.mkdirSync(path.join(cap, 'vault'), { recursive: true })
  fs.mkdirSync(path.join(cap, 'state'), { recursive: true })
  fs.mkdirSync(path.join(cap, 'logs'), { recursive: true })
  fs.writeFileSync(path.join(cap, 'vault', 'secrets.json'), vaultBytes)
  fs.writeFileSync(path.join(cap, 'state', 'audit.sqlite3'), ledgerBytes)
  fs.writeFileSync(path.join(cap, 'logs', 'actions.jsonl'), logBytes)
  // A nested file proves the copy is recursive, not top-level only.
  fs.mkdirSync(path.join(cap, 'state', 'sub'), { recursive: true })
  fs.writeFileSync(path.join(cap, 'state', 'sub', 'deep.json'), 'deep')
  // A lock file that would be pointless to carry across; the app-side adopter
  // skips these, and the installer copies everything, so its presence must not
  // break the rescue. (Modelled: it simply comes across harmlessly here.)
  fs.writeFileSync(path.join(cap, 'vault', 'secrets.json.lock'), 'held')
}

test('a seeded vault survives the upgrade: rescue, then the old uninstaller RMDirs $INSTDIR', () => {
  const root = scratch('nsis-rescue-')
  try {
    const instDir = path.join(root, 'Programs', 'toolsenabled')
    const appData = path.join(root, 'AppData', 'Roaming')
    const vaultBytes = JSON.stringify({ 'stripe-restricted-key': 'REF:vault/stripe', note: 'the customer typed this' })
    const ledgerBytes = Buffer.from([0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x00, 0x01]) // "SQLite\0\1"
    const logBytes = '{"action":"vault.set","at":"2026-08-11T05:14:00Z"}\n'
    seedDefectiveInstall(instDir, { vaultBytes, ledgerBytes, logBytes })

    // The new installer, in customInit, before uninstallOldVersion.
    runRescueMacro({ instDir, appData })

    // The old uninstaller: `RMDir /r $INSTDIR`. The install dir -- and every
    // copy of the data that lived only there -- is gone.
    fs.rmSync(instDir, { recursive: true, force: true })
    assert.ok(!fs.existsSync(instDir), 'the old uninstaller deletes the whole install directory')

    // The new application reads its state root: the data must be here now.
    const stateRoot = path.join(appData, 'ToolsEnabled', 'capability')
    const rescuedVault = path.join(stateRoot, 'vault', 'secrets.json')
    assert.ok(fs.existsSync(rescuedVault), 'the vault must survive the upgrade in the new state root')
    assert.equal(fs.readFileSync(rescuedVault, 'utf8'), vaultBytes, 'the vault must be byte-identical to the seed')

    // The audit ledger and its nested sidecar, and the action log, too.
    assert.deepEqual(
      fs.readFileSync(path.join(stateRoot, 'state', 'audit.sqlite3')),
      ledgerBytes,
      'the signed audit ledger must survive',
    )
    assert.equal(fs.readFileSync(path.join(stateRoot, 'state', 'sub', 'deep.json'), 'utf8'), 'deep', 'recursive copy')
    assert.equal(fs.readFileSync(path.join(stateRoot, 'logs', 'actions.jsonl'), 'utf8'), logBytes, 'the action log must survive')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('the rescue does not overwrite a fixed build\'s existing state root', () => {
  const root = scratch('nsis-rescue-noclobber-')
  try {
    const instDir = path.join(root, 'Programs', 'toolsenabled')
    const appData = path.join(root, 'AppData', 'Roaming')
    // The install dir holds a STALE vault from the defective build...
    seedDefectiveInstall(instDir, {
      vaultBytes: JSON.stringify({ note: 'stale, from the old install dir' }),
      ledgerBytes: Buffer.from('OLD'),
      logBytes: 'old\n',
    })
    // ...but the customer already ran a fixed build, so the state root holds
    // their CURRENT vault.
    const stateRoot = path.join(appData, 'ToolsEnabled', 'capability')
    fs.mkdirSync(path.join(stateRoot, 'vault'), { recursive: true })
    const current = JSON.stringify({ note: 'current, written by the fixed build' })
    fs.writeFileSync(path.join(stateRoot, 'vault', 'secrets.json'), current)

    runRescueMacro({ instDir, appData })
    fs.rmSync(instDir, { recursive: true, force: true })

    assert.equal(
      fs.readFileSync(path.join(stateRoot, 'vault', 'secrets.json'), 'utf8'),
      current,
      'current state-root data must win; the stale install-dir vault must NOT overwrite it',
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('no legacy state means nothing is rescued and no empty vault is fabricated (fail closed)', () => {
  const root = scratch('nsis-rescue-absent-')
  try {
    const instDir = path.join(root, 'Programs', 'toolsenabled')
    const appData = path.join(root, 'AppData', 'Roaming')
    // A prior install with a payload but NO runtime state written yet -- the
    // clean, relocated build. resources/capability exists (config, tools) but no
    // vault/state/logs.
    fs.mkdirSync(path.join(instDir, 'resources', 'capability', 'config'), { recursive: true })
    fs.writeFileSync(path.join(instDir, 'resources', 'capability', 'config', 'x.json'), '{}')

    runRescueMacro({ instDir, appData })

    const stateRoot = path.join(appData, 'ToolsEnabled', 'capability')
    // The absence of a source vault must not be read as "rescue done" by
    // creating an empty one; the state root simply stays absent.
    assert.ok(!fs.existsSync(path.join(stateRoot, 'vault')), 'no source vault => no destination vault fabricated')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('a completely fresh install (no prior $INSTDIR) rescues nothing and does not throw', () => {
  const root = scratch('nsis-rescue-fresh-')
  try {
    const instDir = path.join(root, 'Programs', 'toolsenabled') // never created
    const appData = path.join(root, 'AppData', 'Roaming')
    assert.doesNotThrow(() => runRescueMacro({ instDir, appData }))
    assert.ok(!fs.existsSync(path.join(appData, 'ToolsEnabled')), 'nothing created on a fresh install')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
