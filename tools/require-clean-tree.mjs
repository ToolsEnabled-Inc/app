/* Refuse to produce a release build from an uncommitted, unreproducible tree.
 *
 * THE INCIDENT THIS CLOSES: two lanes shared one worktree and branch. One
 * lane's uncommitted, unreviewed, in-progress feature (a different agent's
 * WIP, never committed anywhere) got silently bundled into a `npm run dist`
 * run by the OTHER lane -- and it passed every gate in the pipeline,
 * including the privacy scanner, because it was not a privacy leak. It was
 * caught only because someone happened to run `git status --porcelain` by
 * hand at declaration time, immediately before writing up the build. That is
 * luck, not process. A build whose bytes cannot be reproduced from git
 * history is not a release candidate no matter how clean it scans -- "any
 * changed byte is a new candidate" cuts both ways: an uncommitted byte was
 * never a candidate to begin with.
 *
 * WHERE THIS RUNS: between `vite build` and `electron-builder` in the `dist`
 * script. Late enough that dist/ already exists, so the provenance record
 * below can be written INTO it and therefore ships inside the package
 * (dist/** is already in build.files) -- inspectable by anyone holding only
 * the .exe, not just visible in a terminal nobody kept. Early enough that it
 * fails before the two most expensive steps (native module rebuild and NSIS
 * packaging) run against a build nobody can vouch for.
 *
 * THE OVERRIDE IS NOT AN OFF SWITCH. Sometimes packaging deliberately-unclean
 * work is legitimate (testing a WIP feature end to end before it lands). But
 * a gate with a quiet escape hatch is the gate this repo already had before
 * this incident. So: the override must be an explicit, named, non-default
 * environment variable -- never inferred, never a CLI flag someone could
 * leave in a saved command -- and USING it does not silence the fact, it
 * BROADCASTS it: dirty:true and the exact file list are written into
 * dist/build-info.json and ship inside the artifact. The failure mode this
 * guards against is someone overriding once under time pressure and the
 * resulting exe becoming indistinguishable from a clean one a week later.
 * If a build cannot state its own provenance, that has to be visible in the
 * artifact, not just in a terminal.
 *
 * build-info.json intentionally carries no builder identity (no username, no
 * absolute path, no hostname) -- only relative repo paths and a commit SHA.
 * Recording the builder's OS username here would recreate exactly the class
 * of leak this whole rebuild exists to fix (compare: the old build's appId
 * carried the owner's username). check-no-owner-data.mjs, which runs later
 * in the same `dist` chain, would also be the thing to catch it if this ever
 * regressed -- but the right fix is to never write it, not to rely on that.
 */
import { spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const OVERRIDE_VARIABLE = 'MC_ALLOW_DIRTY_BUILD'

// Deliberately process.cwd(), not a path derived from this file's own
// location: npm always runs package.json scripts with cwd already at the
// repo root, so this matches real usage exactly, and it also means this
// script can be pointed at a DIFFERENT checkout for testing (see its own
// tests) without needing to live inside that checkout.
function git(args) {
  const result = spawnSync('git', args, { cwd: process.cwd(), encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed (exit ${result.status}): ${result.stderr || result.stdout}`)
  }
  return result.stdout
}

// Best-effort, informational file list: porcelain v1 status lines are two
// status characters, one space, then the path. This does not attempt to
// unquote paths with special characters or split "R  old -> new" rename
// lines apart -- the GATE DECISION is the boolean (any output at all means
// dirty), which does not depend on parsing the path correctly. The list is
// for the human/audit trail, not the control flow.
function parseDirtyFiles(porcelain) {
  return porcelain
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => line.slice(3))
}

async function writeProvenance(distDirectory, record) {
  const resolved = path.resolve(distDirectory)
  await mkdir(resolved, { recursive: true })
  const target = path.join(resolved, 'build-info.json')
  await writeFile(target, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  return target
}

async function requireCleanTree(distDirectory) {
  const porcelain = git(['status', '--porcelain'])
  const ref = git(['rev-parse', 'HEAD']).trim()
  const checkedAt = new Date().toISOString()
  const dirtyFiles = parseDirtyFiles(porcelain)
  const dirty = dirtyFiles.length > 0

  if (!dirty) {
    const target = await writeProvenance(distDirectory, {
      schemaVersion: 1,
      dirty: false,
      overridden: false,
      ref,
      checkedAt,
      dirtyFiles: [],
    })
    console.log(`[require-clean-tree] tree is clean at ${ref}. Provenance recorded: ${target}`)
    return { ok: true, dirty: false, overridden: false }
  }

  const overridden = process.env[OVERRIDE_VARIABLE] === '1'

  if (!overridden) {
    console.error('[require-clean-tree] REFUSING TO BUILD: the working tree is not clean.')
    console.error('These bytes could not be reproduced from git history alone:')
    for (const file of dirtyFiles) console.error(`  ${file}`)
    console.error('')
    console.error('A release build must be able to state its own provenance. If this is')
    console.error('deliberate -- e.g. packaging reviewed, uncommitted work on purpose --')
    console.error(`set ${OVERRIDE_VARIABLE}=1. That does not silence this: it records`)
    console.error('dirty:true and the exact file list above into dist/build-info.json,')
    console.error('which ships inside the package.')
    return { ok: false, dirty: true, overridden: false }
  }

  console.warn('='.repeat(72))
  console.warn(`[require-clean-tree] ${OVERRIDE_VARIABLE}=1 -- BUILDING FROM A DIRTY TREE.`)
  console.warn('This build is NOT reproducible from git history alone. dirty:true and')
  console.warn('the file list below are recorded in dist/build-info.json and ship')
  console.warn('inside the package so this fact cannot get lost.')
  for (const file of dirtyFiles) console.warn(`  ${file}`)
  console.warn('='.repeat(72))
  const target = await writeProvenance(distDirectory, {
    schemaVersion: 1,
    dirty: true,
    overridden: true,
    ref,
    checkedAt,
    dirtyFiles,
  })
  console.warn(`[require-clean-tree] provenance recorded: ${target}`)
  return { ok: true, dirty: true, overridden: true }
}

const invokedDirectly = process.argv[1]
  && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href

if (invokedDirectly) {
  const distDirectory = process.argv[2] || 'dist'
  const result = await requireCleanTree(distDirectory)
  process.exitCode = result.ok ? 0 : 1
}

export { requireCleanTree, parseDirtyFiles, OVERRIDE_VARIABLE }
