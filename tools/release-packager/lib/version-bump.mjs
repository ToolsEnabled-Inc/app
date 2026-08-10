/* Version bump logic, kept separate from npm's own `npm version` command.
 *
 * `npm version` is avoidable complexity here: it wants to manage its own git
 * commit/tag (turned off with --no-git-tag-version, but then it still
 * shells out and can behave differently across npm versions), and this only
 * needs to change one field in one JSON file. Doing it directly means the
 * exact bytes written are visible in this file, not implied by a flag.
 *
 * THE POINT OF THIS FILE: two different binaries must never silently share
 * a version number. B's acceptance matrix treats "any changed byte is a new
 * candidate" as a rule specifically because a same-version rebuild already
 * caused real confusion once (see MACHINE-A-INSTALLER-DECLARATION.md,
 * "Artifacts that are NOT this candidate"). So computeNextVersion() always
 * changes the version unless the caller passes allowSameVersion explicitly
 * -- the same "explicit override, never a silent default" shape as
 * require-clean-tree.mjs's MC_ALLOW_DIRTY_BUILD.
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/

export function parseSemver(version) {
  const match = SEMVER_PATTERN.exec(version.trim())
  if (!match) throw new Error(`not a plain major.minor.patch version: ${JSON.stringify(version)}`)
  const [, major, minor, patch] = match
  return { major: Number(major), minor: Number(minor), patch: Number(patch) }
}

export function formatSemver({ major, minor, patch }) {
  return `${major}.${minor}.${patch}`
}

export function bumpSemver(version, kind) {
  const { major, minor, patch } = parseSemver(version)
  if (kind === 'major') return formatSemver({ major: major + 1, minor: 0, patch: 0 })
  if (kind === 'minor') return formatSemver({ major, minor: minor + 1, patch: 0 })
  if (kind === 'patch') return formatSemver({ major, minor, patch: patch + 1 })
  throw new Error(`unknown bump kind: ${JSON.stringify(kind)} (expected major, minor, or patch)`)
}

/**
 * Decide the version for the new candidate. Never returns the same string as
 * currentVersion unless allowSameVersion is true -- and when it is, the
 * caller is expected to log that just as loudly as require-clean-tree.mjs
 * logs MC_ALLOW_DIRTY_BUILD, because a same-version rebuild is exactly the
 * "second, different 1.0.1" this whole file exists to prevent by default.
 */
export function computeNextVersion({ currentVersion, explicitVersion, bump, allowSameVersion }) {
  const nextVersion = explicitVersion ? explicitVersion.trim() : bumpSemver(currentVersion, bump ?? 'patch')

  if (!SEMVER_PATTERN.test(nextVersion)) {
    throw new Error(`computed/explicit version ${JSON.stringify(nextVersion)} is not major.minor.patch`)
  }

  if (nextVersion === currentVersion && !allowSameVersion) {
    throw new Error(
      `next version (${nextVersion}) is identical to the current version (${currentVersion}). ` +
        'Two different builds must never silently share a version number -- pass --allow-same-version ' +
        'if this is deliberate (e.g. re-cutting after fixing a build-only defect with no source change), ' +
        'and expect the declaration to say so explicitly.',
    )
  }

  return nextVersion
}

/** Rewrite package.json's "version" field in place, preserving the file's
 * existing 2-space indent and trailing newline rather than reformatting the
 * whole file (a reformat would make the commit diff misleading about what
 * actually changed). */
export async function writePackageVersion(packageJsonPath, newVersion) {
  const raw = await readFile(packageJsonPath, 'utf8')
  const parsed = JSON.parse(raw)
  const previousVersion = parsed.version
  parsed.version = newVersion
  const trailingNewline = raw.endsWith('\n') ? '\n' : ''
  await writeFile(packageJsonPath, `${JSON.stringify(parsed, null, 2)}${trailingNewline}`, 'utf8')
  return { previousVersion, newVersion, path: path.resolve(packageJsonPath) }
}
