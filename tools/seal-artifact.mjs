#!/usr/bin/env node
/* SEAL THE BUILT ARTIFACT, THEN PROVE THE REST OF THE CHAIN DID NOT TOUCH IT.
 *
 * THE DEFECT THIS EXISTS TO CATCH, measured on this repo on 2026-08-11. The
 * artifact at release/win-unpacked was built at 02:59. Its
 * resources/capability/state/ directory -- a live mission-bridge BEARER TOKEN,
 * a bootstrap proof, a runtime record, and audit.sqlite3 -- was written at
 * 04:11. Nothing had gone wrong with the packer. The BUILD CHAIN ITSELF wrote
 * those files, because its last two steps start the packaged application
 * against release/win-unpacked, and at the time the layer wrote its runtime
 * state next to itself.
 *
 * The ordering is what made it invisible. `npm run dist` ran
 * check-payload-boundary against resources/capability, and THEN ran
 * smoke-packaged and check-install-dir-immutable, both of which execute the
 * app. So the chain's own final steps contaminated the artifact that the
 * chain had already certified, after the certificate was issued. Every gate
 * was correct and every gate was green; a planted token makes all three refuse
 * the payload, naming `MUST NOT SHIP AT ALL (excluded): state/...`. They just
 * ran too early to see it.
 *
 * WHY THE EXISTING BYTE-COMPARISON DOES NOT COVER THIS.
 * tools/check-install-dir-immutable.mjs already hashes the install directory
 * and compares before against after -- but it takes its BEFORE hash at its own
 * start, which is after smoke-packaged has already run. Anything smoke left
 * behind is baked into that baseline, the final diff comes back empty, and the
 * check prints "the install directory is byte-unchanged after the session"
 * over a tree that was contaminated a minute earlier. It is a correct check of
 * its own phases and blind to everything before them. This file is the wider
 * span: sealed once when the artifact is finished, verified once when the
 * chain is finished, covering every step in between including ones nobody has
 * written yet.
 *
 * PREVENTING AND DETECTING ARE DIFFERENT AND THIS IS ONLY THE SECOND.
 * src/lib/runtime-state-root.js is the prevention: a payload carrying
 * PAYLOAD.json resolves state/, logs/, vault/, captures/, profiles/ and
 * reports/ to a per-user root instead of to itself, so the writes no longer
 * land in the artifact at all. That fix is why a run passes today. This file
 * asserts it is STILL true, on every build, and fails naming the exact files if
 * it ever stops being -- so the next person to reintroduce the defect is told
 * what happened rather than left to discover it in a shipped installer.
 *
 * WHY A WHOLE-TREE HASH RATHER THAN A LIST OF FORBIDDEN NAMES. A name list
 * only catches the contamination someone already thought of; state/ and
 * *.sqlite3 were not the whole of it even in the measured case (logs/, vault/
 * and captures/ were also live write targets). A seal catches any byte that
 * changes for any reason, which is the actual requirement: a finished artifact
 * must be finished. It costs about a second -- the tree is 356 MB across 325
 * files -- which is not a meaningful price next to shipping a bearer token.
 */

import { createHash } from 'node:crypto'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const SEAL_VERSION = 1

/* THE SEAL LIVES BESIDE THE ARTIFACT, NEVER INSIDE IT. A manifest written into
 * release/win-unpacked would be one more file the artifact did not have when it
 * was built -- this check would then be its own first offender, and worse, the
 * seal would be sealing itself. release/ is gitignored, so the sibling location
 * adds nothing to the repository either. */
export function sealPathFor(artifactDirectory) {
  const resolved = path.resolve(artifactDirectory)
  return path.join(path.dirname(resolved), `.artifact-seal-${path.basename(resolved)}.json`)
}

/* Directories the running product writes into, from the same list that
 * src/lib/runtime-state-root.js redirects. Used ONLY to explain a failure in
 * the language of the defect -- the seal itself compares bytes and needs no
 * such list, so a write to a directory that is not on it still fails. */
const RUNTIME_STATE_DIRECTORIES = new Set(['state', 'logs', 'vault', 'captures', 'profiles', 'reports'])

function looksLikeRuntimeState(relativePath) {
  if (/\.sqlite3(-wal|-shm)?$/i.test(relativePath)) return true
  return relativePath.split('/').some((segment) => RUNTIME_STATE_DIRECTORIES.has(segment))
}

async function hashFile(filePath) {
  const hash = createHash('sha256')
  hash.update(await readFile(filePath))
  return hash.digest('hex')
}

/* Entries are keyed by forward-slash relative path so a seal recorded on one
   path separator verifies on another, and sorted so the file diffs readably. */
async function hashTree(root) {
  const entries = new Map()
  async function walk(directory) {
    const listing = await readdir(directory, { withFileTypes: true })
    for (const entry of listing) {
      const full = path.join(directory, entry.name)
      const relative = path.relative(root, full).split(path.sep).join('/')
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      /* Anything that is not a plain file -- a symlink, a junction, a device --
         is recorded by kind rather than skipped. Skipping it would mean a step
         could replace a file with a symlink to somewhere else and the seal
         would call the artifact unchanged. */
      if (!entry.isFile()) {
        entries.set(relative, { kind: entry.isSymbolicLink() ? 'symlink' : 'other', sha256: null, bytes: null })
        continue
      }
      const info = await stat(full)
      entries.set(relative, { kind: 'file', sha256: await hashFile(full), bytes: info.size })
    }
  }
  await walk(root)
  return new Map([...entries].sort((left, right) => (left[0] < right[0] ? -1 : 1)))
}

function describe(entry) {
  if (!entry) return 'absent'
  if (entry.kind !== 'file') return entry.kind
  return `${entry.sha256.slice(0, 12)} (${entry.bytes} bytes)`
}

export function compare(recorded, observed) {
  const added = []
  const removed = []
  const changed = []
  for (const [relative, entry] of observed) {
    const before = recorded.get(relative)
    if (!before) {
      added.push(relative)
      continue
    }
    if (before.kind !== entry.kind || before.sha256 !== entry.sha256 || before.bytes !== entry.bytes) {
      changed.push(`${relative}  ${describe(before)} -> ${describe(entry)}`)
    }
  }
  for (const relative of recorded.keys()) if (!observed.has(relative)) removed.push(relative)
  return { added: added.sort(), removed: removed.sort(), changed: changed.sort() }
}

async function record(artifactDirectory) {
  const resolved = path.resolve(artifactDirectory)
  const tree = await hashTree(resolved)
  const seal = sealPathFor(resolved)
  await writeFile(
    seal,
    `${JSON.stringify(
      {
        version: SEAL_VERSION,
        artifact: resolved,
        recordedAt: new Date().toISOString(),
        files: Object.fromEntries(tree),
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  console.log(`sealed ${tree.size} file(s) in ${resolved}`)
  console.log(`seal: ${seal}`)
  console.log(
    'Every step after this point must leave the artifact byte-identical. Run --verify once the\n' +
      'last step that starts the packaged application has finished.',
  )
}

async function verify(artifactDirectory) {
  const resolved = path.resolve(artifactDirectory)
  const seal = sealPathFor(resolved)

  /* FAIL CLOSED WHEN THE SEAL IS MISSING OR UNREADABLE. A verify with nothing
   * to compare against has not checked the artifact, and "could not check" must
   * never render as "checked and fine" -- that is the same defect class as the
   * owner-data guard that reported 0 offenders from a scan it never ran
   * (tools/pack-capability-layer.mjs). The realistic way to get here is someone
   * reordering the chain so --verify runs without its --record, which is
   * exactly the mistake this must shout about rather than absorb. */
  let parsed
  try {
    parsed = JSON.parse(await readFile(seal, 'utf8'))
  } catch (error) {
    console.error(`Artifact seal VERIFY COULD NOT RUN: ${seal} could not be read (${error.message}).`)
    console.error(
      '\nNothing was compared, so this says nothing about the artifact. The seal is written by\n' +
        '`node tools/seal-artifact.mjs --record <artifact>`, which must run immediately after the\n' +
        'last packaging step and before any step that starts the packaged application.',
    )
    process.exitCode = 1
    return
  }

  if (parsed?.version !== SEAL_VERSION || !parsed?.files || typeof parsed.files !== 'object') {
    console.error(`Artifact seal VERIFY COULD NOT RUN: ${seal} is not a version ${SEAL_VERSION} seal.`)
    console.error('Nothing was compared. Delete it and re-record.')
    process.exitCode = 1
    return
  }

  /* A seal recorded against a DIFFERENT artifact directory is also "could not
     run": it would compare this tree against a stranger's manifest and report a
     torrent of meaningless differences, which reads as a broken check and gets
     the check disabled. */
  if (path.resolve(parsed.artifact || '') !== resolved) {
    console.error(`Artifact seal VERIFY COULD NOT RUN: ${seal} was recorded against ${parsed.artifact}, not ${resolved}.`)
    console.error('Nothing was compared. Re-record the seal against the artifact you mean to verify.')
    process.exitCode = 1
    return
  }

  const recorded = new Map(Object.entries(parsed.files))
  const observed = await hashTree(resolved)
  const { added, removed, changed } = compare(recorded, observed)

  if (!added.length && !removed.length && !changed.length) {
    console.log(`artifact seal: ${observed.size} file(s) byte-identical to the seal recorded at ${parsed.recordedAt}`)
    console.log('no step after packaging modified the artifact.')
    return
  }

  const contamination = [...added, ...changed.map((line) => line.split('  ')[0])].filter(looksLikeRuntimeState)

  console.error('\nTHE BUILD CHAIN MODIFIED THE ARTIFACT IT HAD ALREADY CERTIFIED.')
  console.error(
    `\nThe artifact was sealed at ${parsed.recordedAt}, after packaging and after the boundary gates\n` +
      'passed. It is no longer what was sealed. Every gate that ran before this point passed against\n' +
      'a tree that no longer exists, so their green means nothing about what would ship.',
  )
  if (added.length) console.error(`\nADDED (${added.length}):\n  ${added.join('\n  ')}`)
  if (changed.length) console.error(`\nCHANGED (${changed.length}):\n  ${changed.join('\n  ')}`)
  if (removed.length) console.error(`\nREMOVED (${removed.length}):\n  ${removed.join('\n  ')}`)

  if (contamination.length) {
    console.error(
      `\n${contamination.length === 1 ? 'One of these is' : `${contamination.length} of these are`} RUNTIME STATE, which means the packaged application wrote its own\n` +
        'state into its installation directory. That is the defect src/lib/runtime-state-root.js exists to\n' +
        'prevent: a payload carrying PAYLOAD.json must resolve state/, logs/, vault/, captures/, profiles/\n' +
        'and reports/ to a per-user root. Check whether a new write path bypassed statePath(), or whether\n' +
        'PAYLOAD.json is missing from the staged payload so the layer no longer knows it is installed.\n' +
        'These files can carry live bearer tokens, the vault, and the audit ledger. Do not ship this build.',
    )
  } else {
    console.error(
      '\nNone of these look like runtime state, so this is some other post-packaging write. Whatever wrote\n' +
        'it, the artifact is not what the gates certified; find the step and make it work on a copy.',
    )
  }
  console.error(
    '\nThe steps that run between the seal and this check are the ones to look at: they start the packaged\n' +
      'application against the artifact directory itself.',
  )
  process.exitCode = 1
}

function usage() {
  console.error('usage: node tools/seal-artifact.mjs --record|--verify <artifact-directory>')
  process.exitCode = 1
}

async function main() {
  const [mode, directory] = process.argv.slice(2)
  if (!directory || (mode !== '--record' && mode !== '--verify')) return usage()

  const resolved = path.resolve(directory)
  let info
  try {
    info = await stat(resolved)
  } catch {
    throw new Error(`artifact directory does not exist: ${resolved}`)
  }
  if (!info.isDirectory()) throw new Error(`artifact path is not a directory: ${resolved}`)

  if (mode === '--record') return record(resolved)
  return verify(resolved)
}

main().catch((error) => {
  /* No mode of this tool has a benign failure: a record that did not happen
     leaves the next verify with nothing, and a verify that threw compared
     nothing. Both are exit 1. */
  console.error(`artifact seal could not run: ${error.message}`)
  process.exitCode = 1
})
