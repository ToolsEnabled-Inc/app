/* Reuse an already-installed node_modules by junctioning it into the fresh
 * build worktree, instead of paying for a ~0.5 GB `npm ci` on every single
 * candidate cut.
 *
 * This is the pattern already named in agent-coord's mission-control
 * territory claim ("node_modules can be junctioned to the main checkout so a
 * new worktree shares the toolchain without a 500 MB copy"), applied here.
 * It is safe specifically BECAUSE the only edit this tool makes to the
 * source tree is a version-number bump in package.json -- package-lock.json
 * is verified byte-identical before the junction is trusted, so "reused"
 * never means "reused despite a dependency change no one checked."
 *
 * Falls back to a real `npm ci` whenever that identity check fails, or when
 * no source node_modules exists at all -- reuse is an optimisation, not a
 * requirement for correctness.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readlinkSync, rmdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

async function sameLockfile(sourceRepoRoot, worktreePath) {
  const sourceLock = path.join(sourceRepoRoot, 'package-lock.json')
  const worktreeLock = path.join(worktreePath, 'package-lock.json')
  if (!existsSync(sourceLock) || !existsSync(worktreeLock)) return false
  const [a, b] = await Promise.all([readFile(sourceLock, 'utf8'), readFile(worktreeLock, 'utf8')])
  return a === b
}

// The specific shim binaries `npm run dist` actually invokes by name (vite,
// electron-builder). Checking only node_modules/electron/dist (as an earlier
// version of this file did) is not enough: a real end-to-end test run of
// this script found the live wt-installer/node_modules has every package
// directory present but NO node_modules/.bin directory AT ALL (confirmed
// two independent ways -- PowerShell Get-ChildItem and `cmd /c dir /a` both
// report it absent) -- so `vite build` failed with "'vite' is not
// recognized" even though electron/dist existed and looked fine. A
// junctioned node_modules is only as trustworthy as the thing it points at;
// this is what actually verifies that, instead of one proxy signal.
const REQUIRED_BIN_SHIMS = ['vite.cmd', 'electron-builder.cmd']

function hasRequiredBinShims(nodeModulesPath) {
  return REQUIRED_BIN_SHIMS.every((shim) => existsSync(path.join(nodeModulesPath, '.bin', shim)))
}

export async function provisionNodeModules(sourceRepoRoot, worktreePath, { log = console.log } = {}) {
  const sourceNodeModules = path.join(sourceRepoRoot, 'node_modules')
  const targetNodeModules = path.join(worktreePath, 'node_modules')

  if (existsSync(sourceNodeModules) && (await sameLockfile(sourceRepoRoot, worktreePath))) {
    if (!hasRequiredBinShims(sourceNodeModules)) {
      log(
        `[node-modules] ${sourceNodeModules} is missing required node_modules/.bin shims ` +
          `(${REQUIRED_BIN_SHIMS.join(', ')}) -- not trustworthy to junction. Falling back to npm ci.`,
      )
    } else {
      log(`[node-modules] package-lock.json matches ${sourceRepoRoot} and required .bin shims are present; junctioning node_modules instead of npm ci.`)
      const result = spawnSync('cmd.exe', ['/c', 'mklink', '/J', targetNodeModules, sourceNodeModules], {
        windowsHide: true,
        encoding: 'utf8',
      })
      if (result.status === 0 && existsSync(path.join(targetNodeModules, 'electron', 'dist')) && hasRequiredBinShims(targetNodeModules)) {
        log(`[node-modules] junctioned ${targetNodeModules} -> ${sourceNodeModules}`)
        return { method: 'junction', source: sourceNodeModules }
      }
      if (result.status === 0) {
        // The junction itself was created but failed the trust check above.
        // CRITICAL: release it (the reparse point only, never its target)
        // before falling back to npm ci -- an `npm ci` run against a live
        // junction would write THROUGH it into the shared source
        // node_modules other lanes are using, not into this worktree.
        releaseNodeModulesJunction(worktreePath, { log })
      }
      log(`[node-modules] junction failed or incomplete (${result.stderr || result.stdout || 'unknown error'}); falling back to npm ci.`)
    }
  } else {
    log('[node-modules] no reusable node_modules found (missing, or package-lock.json differs); running npm ci.')
  }

  // shell: true: spawning a .cmd file directly without a shell fails with
  // EINVAL on Windows in this Node/OS combination (see cut-release-candidate.mjs's
  // runCapturing for the same fix, hit for real on this script's first
  // end-to-end test run).
  const install = spawnSync('npm.cmd', ['ci'], { cwd: worktreePath, stdio: 'inherit', shell: true, windowsHide: true })
  if (install.status !== 0) {
    throw new Error(`npm ci failed in ${worktreePath} (exit ${install.status})`)
  }

  // electron's postinstall does not always fire under npm ci (observed and
  // worked around in MACHINE-A-INSTALLER-DECLARATION.md); run it directly
  // and only report a real failure if the dist directory still ends up empty.
  const electronDist = path.join(targetNodeModules, 'electron', 'dist')
  if (!existsSync(electronDist)) {
    log('[node-modules] node_modules/electron/dist missing after npm ci; running electron/install.js directly.')
    const electronInstall = spawnSync('node', [path.join(targetNodeModules, 'electron', 'install.js')], {
      cwd: worktreePath,
      stdio: 'inherit',
      windowsHide: true,
    })
    if (electronInstall.status !== 0 || !existsSync(electronDist)) {
      throw new Error('node_modules/electron/dist still missing after npm ci and a direct electron/install.js run.')
    }
  }

  return { method: 'npm-ci', source: null }
}

/** Undo provisionNodeModules's junction BEFORE `git worktree remove` runs.
 *
 * Hit for real on this script's first end-to-end test run: `git worktree
 * remove --force` failed with "Invalid argument" against a worktree whose
 * node_modules was a junction, and left the directory on disk -- still
 * containing the live junction -- even though git had already dropped it
 * from `git worktree list`. That is a real hazard beyond a failed cleanup:
 * anyone who later "just" runs a recursive delete on the orphaned directory
 * risks a Windows recursive-delete implementation that follows the junction
 * into its target and deletes the SHARED node_modules other lanes still use.
 *
 * The fix is to release the junction ourselves, deliberately and narrowly,
 * before asking git to remove anything. `rmdirSync` WITHOUT the `recursive`
 * option removes exactly the reparse-point directory entry and nothing
 * inside the target -- this is the standard, safe way to detach a Windows
 * junction from Node.js. Never call fs.rm/rmSync with `recursive: true` on
 * a path that might be a junction; some Windows/Node combinations have
 * followed the link into the target and deleted real content there. */
export function releaseNodeModulesJunction(worktreePath, { log = console.log } = {}) {
  const target = path.join(worktreePath, 'node_modules')
  if (!existsSync(target)) return false
  /* Only a reparse point may be rmdir'd here. When the reuse fell back to a
     real `npm ci`, node_modules is an ordinary populated directory and
     rmdirSync would throw ENOTEMPTY -- crashing a cut AFTER a fully verified
     build, the exact failure class the 1.0.3 postmortem in this repo warns
     about. readlink succeeds only for symlinks and junctions, so a real
     directory falls through to git's own removal untouched. */
  try {
    readlinkSync(target)
  } catch {
    return false
  }
  rmdirSync(target)
  log(`[node-modules] released junction before worktree removal: ${target} (target directory untouched)`)
  return true
}
