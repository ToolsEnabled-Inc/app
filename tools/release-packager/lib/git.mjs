/* Small git helpers shared by the release-packager tools.
 *
 * Deliberately thin: this repo already has a hard-won lesson wired into
 * tools/require-clean-tree.mjs about what "clean" means and why it matters.
 * This file does not reimplement that gate -- it gives the packager the same
 * primitives (status, rev-parse, worktree add/remove) so the packager can
 * build in an ISOLATED checkout and let require-clean-tree.mjs do its real
 * job there, undisturbed, exactly as `npm run dist` already does.
 */
import { spawnSync } from 'node:child_process'

export class GitError extends Error {}

export function git(args, { cwd, allowFailure = false } = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
  if (result.error) throw new GitError(`git ${args.join(' ')} could not start: ${result.error.message}`)
  if (result.status !== 0 && !allowFailure) {
    throw new GitError(`git ${args.join(' ')} failed (exit ${result.status}) in ${cwd}:\n${result.stderr || result.stdout}`)
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

export function porcelainStatus(cwd) {
  const { stdout } = git(['status', '--porcelain'], { cwd })
  return stdout
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
}

export function isClean(cwd) {
  return porcelainStatus(cwd).length === 0
}

export function revParse(cwd, ref = 'HEAD') {
  return git(['rev-parse', ref], { cwd }).stdout.trim()
}

export function showFile(cwd, ref, relativePath) {
  const { status, stdout, stderr } = git(['show', `${ref}:${relativePath}`], { cwd, allowFailure: true })
  if (status !== 0) throw new GitError(`git show ${ref}:${relativePath} failed: ${stderr}`)
  return stdout
}

export function currentBranch(cwd) {
  const { stdout } = git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, allowFailure: true })
  return stdout.trim()
}

/** True only if `descendant` can be reached from `ancestor` -- i.e. building
 * `descendant` did not require abandoning any history `ancestor` already had. */
export function isAncestor(cwd, ancestor, descendant) {
  return git(['merge-base', '--is-ancestor', ancestor, descendant], { cwd, allowFailure: true }).status === 0
}

export function worktreeAddDetached(cwd, worktreePath, ref) {
  git(['worktree', 'add', '--detach', worktreePath, ref], { cwd })
}

export function worktreeRemove(cwd, worktreePath, { force = true } = {}) {
  git(['worktree', 'remove', ...(force ? ['--force'] : []), worktreePath], { cwd })
}

export function worktreeList(cwd) {
  return git(['worktree', 'list', '--porcelain'], { cwd }).stdout
}

/** Files already committed under `pathspec` at the checked-out ref. Used to
 * tell a genuinely untracked, per-builder local input (copy it in) apart
 * from a file that is already committed with its own reviewed content
 * (leave it alone -- overwriting it with whatever is on this one machine
 * right now would silently replace known-good content AND dirty an
 * otherwise-clean isolated worktree, defeating the point of building there). */
export function listTrackedFiles(cwd, pathspec) {
  return git(['ls-files', '--', pathspec], { cwd })
    .stdout.split(/\r?\n/)
    .filter((line) => line.length > 0)
}

/** Commit an explicit, named set of paths -- never `-A`, never a bare dot.
 * message is passed on stdin so multi-line trailers survive shell quoting. */
export function commitPaths(cwd, paths, message) {
  git(['add', '--', ...paths], { cwd })
  const result = spawnSync('git', ['commit', '-F', '-', '--', ...paths], {
    cwd,
    input: message,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.status !== 0) {
    throw new GitError(`git commit failed (exit ${result.status}):\n${result.stderr || result.stdout}`)
  }
  return revParse(cwd)
}

/** Fast-forward-only branch move. Refuses (rather than force-moves) unless
 * newRef is a descendant of the branch's current tip, so this can never
 * discard history other lanes might be relying on. */
export function fastForwardBranch(cwd, branchName, newRef) {
  const currentTip = revParse(cwd, branchName)
  if (!isAncestor(cwd, currentTip, newRef)) {
    throw new GitError(
      `refusing to move ${branchName}: ${newRef} is not a descendant of its current tip ${currentTip}. ` +
        'This would not be a fast-forward.',
    )
  }
  git(['branch', '-f', branchName, newRef], { cwd })
}
