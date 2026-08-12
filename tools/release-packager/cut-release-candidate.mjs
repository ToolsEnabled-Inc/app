#!/usr/bin/env node
/* THE ONE COMMAND: produce a declarable ToolsEnabled release candidate.
 *
 * Owner's ask, verbatim: "we should have a packager that makes sending them
 * the new version easy." Today that means a full session by hand -- a build
 * from a dirty tree that had to be thrown away, and a near-miss where an
 * unrelated agent's uncommitted work was baked into a release candidate,
 * caught only because someone happened to run `git status` by hand right
 * before writing the declaration up. This script is that hand process,
 * mechanised, so the same mistakes cannot recur silently:
 *
 *   1. NEVER build in the shared day-to-day worktree. It has another lane's
 *      live, claimed, uncommitted work in it (codex-popup-1). This script
 *      always builds in a throwaway `git worktree add --detach` checkout,
 *      which by construction cannot contain anything not already committed.
 *      require-clean-tree.mjs (already wired into `npm run dist`) is the
 *      real gate; this script does not duplicate it, it just guarantees the
 *      tree that gate inspects is trustworthy in the first place.
 *   2. NEVER let the version number lie. Two different binaries must never
 *      silently share "1.0.1" -- see lib/version-bump.mjs.
 *   3. COPY THE ARTIFACT OUT BEFORE CLEANING UP. A previous run destroyed a
 *      freshly built exe by removing its worktree first. Ordering here is:
 *      build -> copy to durable staging -> re-hash the staged copy -> ONLY
 *      THEN remove the worktree. Every failure path leaves the worktree in
 *      place for postmortem rather than guessing it's safe to delete.
 *   4. DECLARE ONLY WHAT WAS MEASURED. generate-declaration.mjs takes real
 *      hashes, real VersionInfo off the real exe, and real pipeline output
 *      -- never intent, never package.json's say-so alone.
 *
 * What this script deliberately does NOT do: transfer the candidate to
 * Machine B, or advance the shared `installer/nsis` branch, unless asked
 * with --advance-branch. Both are separate, explicit decisions -- see
 * serve-candidate.mjs / verify-candidate.ps1 for the transfer half.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  commitPaths,
  currentBranch,
  fastForwardBranch,
  isClean,
  listTrackedFiles,
  porcelainStatus,
  revParse,
  showFile,
  worktreeAddDetached,
  worktreeRemove,
} from './lib/git.mjs'
import { measureFile, sameBytes } from './lib/hash.mjs'
import { provisionNodeModules } from './lib/node-modules-reuse.mjs'
import { assertStagingFree } from './lib/staging-collision.mjs'
import { findOtherCandidates } from './lib/scan-artifacts.mjs'
import { readExeVersionInfo } from './lib/version-info.mjs'
import { computeNextVersion, writePackageVersion } from './lib/version-bump.mjs'
import { toDeclarableFacts, portablePath } from './lib/portable-paths.mjs'
import { assertNoOwnerData } from '../check-declaration-privacy.mjs'
import { writeDeclaration } from './generate-declaration.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_REPO = path.resolve(HERE, '..', '..') // wt-installer
// Derived from the running account's home directory rather than written out.
// The literal that used to be here named the owner in this file's own source,
// which is the leak this lane exists to close one step further upstream: a
// hardcoded home path is owner data in the tool as well as in what it emits.
const DEFAULT_STAGING_ROOT = path.join(os.homedir(), 'Desktop', 'MACHINE-A-INSTALLER-CANDIDATE')
const DEFAULT_TEST_STAGING_ROOT = path.join(os.tmpdir(), 'release-packager-test-candidates')

function parseArgs(argv) {
  const args = { bump: 'patch', advanceBranch: false, keepWorktree: false, test: false, allowSameVersion: false, replaceStaged: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--bump') args.bump = argv[++i]
    else if (arg === '--version') args.explicitVersion = argv[++i]
    else if (arg === '--allow-same-version') args.allowSameVersion = true
    else if (arg === '--replace-staged') args.replaceStaged = true
    else if (arg === '--source-ref') args.sourceRef = argv[++i]
    else if (arg === '--repo') args.repo = argv[++i]
    else if (arg === '--staging') args.staging = argv[++i]
    else if (arg === '--build-dir') args.buildDir = argv[++i]
    else if (arg === '--advance-branch') args.advanceBranch = true
    else if (arg === '--keep-worktree') args.keepWorktree = true
    else if (arg === '--test') args.test = true
    else if (arg === '--other-candidate-root') (args.otherCandidateRoots ??= []).push(argv[++i])
    else if (arg === '--known-fix') (args.knownFixes ??= []).push(parseKnownFixArg(argv[++i]))
    else if (arg === '--help' || arg === '-h') args.help = true
    else throw new Error(`unrecognised argument: ${arg}`)
  }
  return args
}

// --known-fix "description::verifiedBy[::evidence]" -- `::` rather than a
// single colon so a Windows path or a URL in the evidence text doesn't get
// mis-split. verifiedBy must be one of generate-declaration.mjs's
// VERIFICATION_LABELS keys (source-only / observed / both) so the caller is
// forced to say which kind of claim this is, not just that a fix exists --
// see that file's comment for why that distinction is the point.
export function parseKnownFixArg(raw) {
  if (!raw) throw new Error('--known-fix requires a value: "description::verifiedBy[::evidence]"')
  const [description, verifiedBy, ...evidenceParts] = raw.split('::')
  if (!description || !verifiedBy) {
    throw new Error(`--known-fix value must be "description::verifiedBy[::evidence]", got: ${JSON.stringify(raw)}`)
  }
  return { description: description.trim(), verifiedBy: verifiedBy.trim(), evidence: evidenceParts.join('::').trim() || undefined }
}

function printHelp() {
  console.log(`usage: node tools/release-packager/cut-release-candidate.mjs [options]

Produces a declarable ToolsEnabled release candidate end to end: version
bump -> isolated clean build -> staged artifact -> re-hashed -> declaration.

  --bump <patch|minor|major>   default: patch
  --version <X.Y.Z>            explicit version instead of --bump
  --allow-same-version         allow reusing the current version (loud, logged)
  --replace-staged             overwrite a candidate ALREADY staged at this version (loud, logged).
                                Without it, an occupied staging slot refuses before anything is built --
                                package.json's version does not move unless --advance-branch is used, so
                                back-to-back cuts from different tips otherwise compute the same number.
  --source-ref <ref>           default: current tip of the checked-out branch
  --repo <path>                default: ${DEFAULT_REPO}
  --staging <dir>              default: ${portablePath(DEFAULT_STAGING_ROOT)}\\<version>  (or a scratch dir with --test)
  --build-dir <dir>            override the isolated worktree location
  --advance-branch             fast-forward the source branch to the build commit on success
  --keep-worktree              do not remove the isolated worktree on success
  --test                       mark this as a test run: forces branch advance off, stages to a
                                scratch directory, and prints the declaration as TEST/NOT FOR TRANSFER
  --other-candidate-root <dir> extra directory to scan for stray same-name installers (repeatable)
  --known-fix "<description>::<source-only|observed|both>[::evidence]"
                                declare a specific fix in this candidate and how it was verified (repeatable) --
                                renders in the declaration's "Known fixes" section instead of being silently omitted
`)
}

function runCapturing(command, args, options) {
  return new Promise((resolve, reject) => {
    // shell: true is required here, not optional: Node's spawn() (without a
    // shell) fails with EINVAL for a .cmd file on Windows in this Node/OS
    // combination -- hit for real on the first end-to-end test run of this
    // script. test-ratchet.mjs's own runSuite() uses the same shell: true
    // shape for the same reason (spawning "npm test").
    const child = spawn(command, args, { ...options, shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk)
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk)
      stderr += chunk.toString()
    })
    child.once('error', reject)
    child.once('close', (code) => resolve({ code, stdout, stderr }))
  })
}

function extractPipelineFacts(combinedOutput) {
  const verifyMatch = /Ran (\d+) tests: (\d+) pass, (\d+) fail \(suite exit (\d+)\)\./.exec(combinedOutput)
  const ownerDataMatch = /Scanned (\d+) files \((\d+) bytes\)\. Total matches: (\d+)\./.exec(combinedOutput)
  const smokeMatch = /\[smoke-packaged\] (PASS[^\n\r]*)/.exec(combinedOutput)

  return {
    verifySummary: verifyMatch
      ? `${verifyMatch[1]} tests, ${verifyMatch[2]} pass, ${verifyMatch[3]} fail (suite exit ${verifyMatch[4]}).`
      : null,
    checkNoOwnerData: ownerDataMatch
      ? { filesScanned: Number(ownerDataMatch[1]), bytesScanned: Number(ownerDataMatch[2]), totalMatches: Number(ownerDataMatch[3]) }
      : null,
    smokePackagedLine: smokeMatch ? smokeMatch[1].trim() : null,
  }
}

// Copy ONLY the private/ files that are genuinely untracked -- e.g. the
// per-builder identity profile private/owner-data-patterns.owner.json.
// private/fleet-profile.owner.json and private/research-queue.authored.json
// are, despite living under the same gitignored-looking directory, actually
// committed to this repo with their own reviewed content (confirmed with
// `git ls-files`; .gitignore's blanket `/private/` rule does not retroactively
// untrack a file already committed). A first real test run of this script
// copied the whole directory wholesale, overwrote those two tracked files
// with this machine's live copies, and correctly tripped the dirty-tree
// check it was supposed to sail through -- exactly the bug this function
// exists to prevent from recurring.
export async function copyPrivateInputs(repo, worktreePath, { log = console.log } = {}) {
  const sourcePrivate = path.join(repo, 'private')
  const targetPrivate = path.join(worktreePath, 'private')
  if (!existsSync(sourcePrivate)) return { copied: [], skippedTracked: [] }

  const tracked = new Set(
    listTrackedFiles(worktreePath, 'private').map((relPath) => relPath.split('/').join(path.sep)),
  )

  const entries = await readdir(sourcePrivate, { withFileTypes: true, recursive: true })
  const copied = []
  const skippedTracked = []

  for (const entry of entries) {
    if (!entry.isFile()) continue
    const entryDir = entry.parentPath ?? entry.path
    const sourceFile = path.join(entryDir, entry.name)
    const relativeFromPrivate = path.relative(sourcePrivate, sourceFile)
    const relativeFromRepo = path.join('private', relativeFromPrivate)

    if (tracked.has(relativeFromRepo)) {
      skippedTracked.push(relativeFromPrivate)
      continue
    }

    const targetFile = path.join(targetPrivate, relativeFromPrivate)
    await mkdir(path.dirname(targetFile), { recursive: true })
    await cp(sourceFile, targetFile)
    copied.push(relativeFromPrivate)
  }

  log(`[private-inputs] copied (untracked, per-builder): ${copied.join(', ') || '(none)'}`)
  if (skippedTracked.length > 0) {
    log(`[private-inputs] left as git-tracked content, NOT overwritten with the local copy: ${skippedTracked.join(', ')}`)
  }
  return { copied, skippedTracked }
}

/* The two provenance documents, written as a pair or not at all.
 *
 * EXPORTED BECAUSE THE WIRING IS THE THING THAT BREAKS. The redaction and the
 * scan both had unit tests while this sequence lived inline in main(), and a
 * planted mutant that serialised the RAW facts into declaration-facts.json
 * survived the whole suite -- reintroducing, in one line, exactly the leak in the
 * shipped 1.0.2 and 1.0.4 files. Nothing could reach it: main() runs a build.
 * Pulling the four steps out makes the order testable, and the order is the
 * property: redact once, scan BOTH documents, then write.
 *
 * The facts file is scanned before the declaration is written so that a failure
 * cannot leave one half of a matched pair sitting in the transfer directory --
 * a lone DECLARATION.md next to an installer reads like a complete, declared
 * candidate.
 */
export async function writeDeclarationArtifacts(stagingDir, measuredFacts, { test = false } = {}) {
  const declarableFacts = toDeclarableFacts(measuredFacts)
  const declarationPath = path.join(stagingDir, test ? 'TEST-DECLARATION.md' : 'DECLARATION.md')
  const factsPath = path.join(stagingDir, 'declaration-facts.json')
  const factsJson = `${JSON.stringify(declarableFacts, null, 2)}\n`

  assertNoOwnerData(factsPath, factsJson)
  await writeDeclaration(declarationPath, declarableFacts)
  await writeFile(factsPath, factsJson, 'utf8')

  return { declarationPath, factsPath, declarableFacts }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }

  const repo = path.resolve(args.repo ?? DEFAULT_REPO)
  const sourceRef = args.sourceRef ?? revParse(repo, 'HEAD')
  const branch = currentBranch(repo)

  console.log(`[cut-release-candidate] repo=${repo} sourceRef=${sourceRef} branch=${branch} test=${args.test}`)

  // --- version -------------------------------------------------------------
  const packageJsonAtRef = JSON.parse(showFile(repo, sourceRef, 'package.json'))
  const currentVersion = packageJsonAtRef.version
  const version = computeNextVersion({
    currentVersion,
    explicitVersion: args.explicitVersion,
    bump: args.bump,
    allowSameVersion: args.allowSameVersion,
  })
  console.log(`[cut-release-candidate] version: ${currentVersion} -> ${version}${args.allowSameVersion && version === currentVersion ? ' (--allow-same-version)' : ''}`)

  // --- staging ---------------------------------------------------------------
  const stagingRoot = args.staging ?? (args.test ? DEFAULT_TEST_STAGING_ROOT : DEFAULT_STAGING_ROOT)
  const stagingDir = path.join(stagingRoot, version)

  /* BEFORE the directory is created, before a worktree exists, before anything
   * is built: is this version's slot already taken by a candidate cut from a
   * different commit? computeNextVersion() cannot answer that -- it only
   * compares against package.json, and package.json does not advance unless
   * --advance-branch was used, so every cut from a non-advancing branch
   * computes the same "next" number. Refusing here costs a wasted argument;
   * refusing after the build would already have overwritten the installer and
   * the declaration that describes it. */
  assertStagingFree({ stagingDir, version, sourceRef, replaceStaged: args.replaceStaged, log: console.log })

  await mkdir(stagingDir, { recursive: true })

  // --- isolated build worktree ------------------------------------------------
  const worktreePath = args.buildDir ?? path.join(path.dirname(repo), `wt-release-build-${version}${args.test ? '-test' : ''}`)
  if (existsSync(worktreePath)) {
    throw new Error(`build directory already exists: ${worktreePath}. Remove it or pass --build-dir.`)
  }

  console.log(`[cut-release-candidate] creating isolated detached worktree at ${worktreePath} from ${sourceRef}`)
  worktreeAddDetached(repo, worktreePath, sourceRef)

  let worktreeRemoved = false
  try {
    if (!isClean(worktreePath)) {
      throw new Error('freshly created worktree is not clean -- this should be impossible; aborting without touching anything else.')
    }
    console.log('[cut-release-candidate] fresh worktree confirmed clean.')

    const privateInputs = await copyPrivateInputs(repo, worktreePath, { log: console.log })

    // STAGE THE CAPABILITY PAYLOAD BEFORE `npm run dist` RUNS ITS VERIFY GATE.
    //
    // This script always builds in a fresh detached worktree, and capability/ is
    // gitignored -- a checkout never materialises it. The dist chain's verify
    // gate runs first (ship-path.test.mjs pins that ordering on purpose), and
    // verify now contains payload-reading tests that FAIL CLOSED when no payload
    // root exists, printing `run node tools/pack-capability-layer.mjs first` as
    // their own remedy. Found on the 2026-08-11 cut attempt: 34 such tests went
    // red in a clean worktree that the day-to-day tree sailed through on a stale
    // leftover payload, so THE ONE COMMAND could not cut any tip anywhere, by
    // construction. Staging here -- right after the private inputs the packer's
    // source-tree setting lives in -- is that remedy, run by the repo's own tool
    // in the same worktree the build will use. capability/ is gitignored, so the
    // clean checks before and inside the build are not perturbed, and the
    // packer's own fail-closed guards stand: no engine source, or owner data in
    // the staged payload, aborts the cut loudly before anything is built.
    console.log('[cut-release-candidate] staging the capability payload (pack-capability-layer.mjs) before the dist verify gate ...')
    const pack = await runCapturing('node', ['tools/pack-capability-layer.mjs'], { cwd: worktreePath, windowsHide: true })
    if (pack.code !== 0) {
      throw new Error(
        `pack-capability-layer.mjs failed (exit ${pack.code}) in ${worktreePath}, so the payload-reading verify ` +
          `gates would have nothing real to check. Nothing was built. The worktree was left in place for postmortem: ${worktreePath}`,
      )
    }

    const packageJsonPath = path.join(worktreePath, 'package.json')
    await writePackageVersion(packageJsonPath, version)

    const buildRef = commitPaths(
      worktreePath,
      ['package.json'],
      `package.json: bump version to ${version} for release candidate\n\n` +
        `Automated by tools/release-packager/cut-release-candidate.mjs. Built from ${sourceRef} in an isolated, ` +
        `detached worktree; the day-to-day worktree (with another lane's uncommitted work in it) was never entered.\n\n` +
        `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>\n` +
        `Lane: release-packager (session 6f84bf9b)\n`,
    )
    console.log(`[cut-release-candidate] version-bump commit: ${buildRef}`)

    const preBuildClean = isClean(worktreePath)
    console.log(`[cut-release-candidate] git status --porcelain empty before npm run dist: ${preBuildClean}`)
    if (!preBuildClean) throw new Error('worktree is dirty immediately before the build -- refusing to proceed.')

    await provisionNodeModules(repo, worktreePath, { log: console.log })

    // Never inherit MC_ALLOW_DIRTY_BUILD from this process's environment.
    // require-clean-tree.mjs's own gate (already wired into `npm run dist`,
    // between vite build and electron-builder) is the real defence, but it
    // trusts whatever the child process's environment says -- and Node's
    // spawn() inherits process.env by default. A stray MC_ALLOW_DIRTY_BUILD=1
    // left set in a shell (e.g. from testing require-clean-tree.mjs directly)
    // would otherwise silently make this "clean isolated build" accept a
    // dirty one without this script ever noticing, since require-clean-tree.mjs
    // still exits 0 when overridden. Delete it explicitly rather than trust
    // that it happens not to be set.
    const buildEnv = { ...process.env }
    delete buildEnv.MC_ALLOW_DIRTY_BUILD

    console.log('[cut-release-candidate] running `npm run dist` (verify -> build -> require-clean-tree -> electron-builder -> strip-diagnostics -> check-no-owner-data -> smoke) ...')
    const { code, stdout, stderr } = await runCapturing('npm.cmd', ['run', 'dist'], { cwd: worktreePath, env: buildEnv, windowsHide: true })
    const combinedOutput = `${stdout}\n${stderr}`

    if (code !== 0) {
      throw new Error(
        `npm run dist failed (exit ${code}) in ${worktreePath}. The worktree was left in place for postmortem: ${worktreePath}`,
      )
    }
    console.log('[cut-release-candidate] npm run dist: exit 0.')

    // Independent cross-check: don't just trust `npm run dist`'s exit code.
    // require-clean-tree.mjs writes dist/build-info.json INSIDE this exact
    // worktree recording what IT measured (dirty/overridden), between vite
    // build and electron-builder. Reading it back is a second, independent
    // confirmation from the pipeline's own gate -- not a duplicate of this
    // script's own pre-build isClean() check above, which only proves the
    // tree was clean before the pipeline started, not that it stayed that
    // way or that the gate wasn't overridden by something in the environment.
    const buildInfoPath = path.join(worktreePath, 'dist', 'build-info.json')
    if (!existsSync(buildInfoPath)) {
      throw new Error(
        `dist/build-info.json is missing after a successful npm run dist -- require-clean-tree.mjs should always ` +
          `write it. Refusing to trust this build's provenance. Worktree kept for inspection: ${worktreePath}`,
      )
    }
    const buildInfo = JSON.parse(await (await import('node:fs/promises')).readFile(buildInfoPath, 'utf8'))
    if (buildInfo.dirty !== false || buildInfo.overridden !== false) {
      throw new Error(
        `require-clean-tree.mjs's own record says dirty=${buildInfo.dirty}, overridden=${buildInfo.overridden} ` +
          `for this build -- this tool only ever produces declarable candidates from a build that gate independently ` +
          `confirms was clean. Worktree kept for inspection: ${worktreePath}`,
      )
    }
    console.log(`[cut-release-candidate] require-clean-tree.mjs independently confirms dirty:false, overridden:false (ref ${buildInfo.ref}).`)

    const pipelineFacts = extractPipelineFacts(combinedOutput)

    // --- locate + copy the built artifact BEFORE any cleanup ------------------
    const releaseDir = path.join(worktreePath, 'release')
    const exeName = `ToolsEnabled Setup ${version}.exe`
    const builtExePath = path.join(releaseDir, exeName)
    const builtBlockmapPath = `${builtExePath}.blockmap`
    if (!existsSync(builtExePath)) {
      throw new Error(`expected build output not found: ${builtExePath}. Worktree kept for inspection: ${worktreePath}`)
    }

    const builtMeasured = await measureFile(builtExePath)
    console.log(`[cut-release-candidate] built artifact: ${builtMeasured.bytes} bytes, SHA-256 ${builtMeasured.sha256}`)

    const stagedExePath = path.join(stagingDir, exeName)
    await cp(builtExePath, stagedExePath)
    if (existsSync(builtBlockmapPath)) await cp(builtBlockmapPath, `${stagedExePath}.blockmap`)

    const stagedMeasured = await measureFile(stagedExePath)
    if (!sameBytes(builtMeasured, stagedMeasured)) {
      throw new Error(
        `staged copy is NOT byte-identical to the built artifact (built ${builtMeasured.bytes}b/${builtMeasured.sha256} vs ` +
          `staged ${stagedMeasured.bytes}b/${stagedMeasured.sha256}). Worktree kept for inspection: ${worktreePath}. ` +
          `Staged copy NOT declared.`,
      )
    }
    console.log('[cut-release-candidate] staged copy re-hashed: byte-identical to the build.')

    // --- only now is it safe to clean up the worktree --------------------------
    if (!args.keepWorktree) {
      worktreeRemove(repo, worktreePath)
      worktreeRemoved = true
      console.log(`[cut-release-candidate] removed build worktree: ${worktreePath}`)
    } else {
      console.log(`[cut-release-candidate] --keep-worktree: leaving ${worktreePath} in place.`)
    }

    // --- optionally advance the shared branch -----------------------------------
    //
    // A FAILURE HERE MUST NOT COST THE DECLARATION. Advancing the branch is
    // bookkeeping; the declaration is the artifact's only record of what it is.
    // On the 1.0.3 cut this step threw AFTER a fully successful, fully verified
    // build, and because it threw, control jumped to the catch and the
    // declaration was never written -- leaving a 101 MB installer on disk with
    // no filename/bytes/sha256/build-ref record beside it, and a build ref that
    // no branch pointed at and gc was free to delete. The build was fine. The
    // evidence that it was fine is what got lost.
    //
    // So: capture the error, finish writing the declaration (which records the
    // failure in branchAdvanceError so nobody reads branchAdvanced:false as a
    // deliberate choice), and only then rethrow.
    let branchAdvanced = false
    let branchAdvanceError = null
    if (args.advanceBranch && !args.test) {
      try {
        fastForwardBranch(repo, branch, buildRef)
        branchAdvanced = true
        console.log(`[cut-release-candidate] fast-forwarded ${branch} -> ${buildRef}`)
      } catch (error) {
        branchAdvanceError = error instanceof Error ? error.message : String(error)
        console.error(
          `[cut-release-candidate] branch advance FAILED (the build itself is fine and is staged): ${branchAdvanceError}`,
        )
        console.error(
          `[cut-release-candidate] the declaration will still be written. To put ${buildRef} on a branch by hand:\n` +
            `    cd <the worktree that has ${branch} checked out> && git merge --ff-only ${buildRef}\n` +
            `  Do this promptly: until some ref reaches it, ${buildRef} is unreachable and gc may delete the ` +
            `provenance this candidate depends on.`,
        )
      }
    } else if (args.advanceBranch && args.test) {
      console.log('[cut-release-candidate] --test overrides --advance-branch: the shared branch was NOT moved.')
    }

    // --- read real VersionInfo off the staged artifact --------------------------
    const versionInfo = await readExeVersionInfo(stagedExePath)

    // --- what's uncommitted in the day-to-day worktree right now, for the declaration ---
    //
    // `sourceWorktree: repo` used to be here. The file list is the information
    // -- it says what is NOT in the build -- and it is already repo-relative;
    // the checkout's absolute location added nothing except the builder's
    // account name, in a document written to be sent elsewhere.
    const sourceDirtyFiles = porcelainStatus(repo)
    const excludedWip = {
      measuredAt: new Date().toISOString(),
      dirtyFiles: sourceDirtyFiles,
    }

    // --- scan for other same-named installers so B is told what to ignore -------
    const otherCandidateRoots = [
      releaseDirIfStillPresent(repo),
      stagingRoot,
      ...(args.otherCandidateRoots ?? []),
    ].filter(Boolean)
    const otherCandidates = await findOtherCandidates(otherCandidateRoots, stagedExePath)

    const packageJsonBuilt = JSON.parse(showFile(repo, buildRef, 'package.json'))

    const facts = {
      test: args.test,
      date: new Date().toISOString().slice(0, 10),
      version,
      previousVersion: currentVersion,
      // No `repo` and no `treeState.worktreePath`. Both were absolute paths on
      // the build machine, both were rendered into the declaration verbatim, and
      // neither told a recipient anything: they name directories on a machine
      // that recipient does not have. What identifies the source is `buildRef`,
      // which is true on every clone. toDeclarableFacts() strips them again
      // below if a future edit puts them back -- but not putting them in the
      // object at all is the fix, and the stripper is the net under it.
      branch,
      sourceRef,
      buildRef,
      branchAdvanced,
      branchAdvanceError,
      candidate: { filename: exeName, bytes: stagedMeasured.bytes, sha256: stagedMeasured.sha256 },
      treeState: {
        worktreeRemoved: !args.keepWorktree,
        buildInfoConfirmedClean: buildInfo.dirty === false && buildInfo.overridden === false,
      },
      versionInfo,
      appId: { configured: packageJsonBuilt.build?.appId ?? '(not set)' },
      unsigned: { signExecutable: packageJsonBuilt.build?.win?.signExecutable ?? null },
      pipeline: { ...pipelineFacts, distExitCode: code },
      excludedWip,
      otherCandidates,
      stagingDir,
      privateInputsCopied: privateInputs.copied,
      privateInputsSkippedTracked: privateInputs.skippedTracked,
      knownFixes: args.knownFixes,
    }

    // THE FACTS OBJECT IS ITSELF A PUBLISHED ARTIFACT: declaration-facts.json is
    // written into the same transfer directory as the installer and the
    // declaration, and the shipped 1.0.2 and 1.0.4 copies each carry the
    // builder's account name 7 times. A renderer-only fix would produce a
    // declaration that reads clean sitting next to a JSON file that is not.
    const { declarationPath } = await writeDeclarationArtifacts(stagingDir, facts, { test: args.test })

    console.log('')
    console.log('='.repeat(72))
    console.log(`[cut-release-candidate] ${args.test ? 'TEST candidate' : 'CANDIDATE'} ready.`)
    console.log(`  file:        ${stagedExePath}`)
    console.log(`  bytes:       ${stagedMeasured.bytes}`)
    console.log(`  sha256:      ${stagedMeasured.sha256}`)
    console.log(`  build ref:   ${buildRef}${branchAdvanced ? ` (now tip of ${branch})` : ` (NOT yet on ${branch})`}`)
    console.log(`  declaration: ${declarationPath}`)
    console.log('='.repeat(72))
    if (args.test) {
      console.log('This was a --test run. Nothing was sent anywhere and the shared branch was not moved.')
    }
    if (branchAdvanceError) {
      throw new Error(
        `candidate is staged and declared, but advancing ${branch} to ${buildRef} failed: ${branchAdvanceError}`,
      )
    }
  } catch (error) {
    if (!worktreeRemoved && existsSync(worktreePath) && !args.keepWorktree) {
      console.error(`[cut-release-candidate] leaving build worktree in place for postmortem: ${worktreePath}`)
      const leftoverNodeModules = path.join(worktreePath, 'node_modules')
      if (existsSync(leftoverNodeModules)) {
        console.error(
          `[cut-release-candidate] WARNING: ${leftoverNodeModules} may be a junction into the shared source ` +
            `node_modules, not a real copy. Do NOT run a recursive delete (rm -rf / Remove-Item -Recurse) on ` +
            `${worktreePath} without first checking: PowerShell \`(Get-Item '${leftoverNodeModules}').LinkType\` -- ` +
            `if it says "Junction", remove only that node_modules entry itself (e.g. \`(Get-Item '${leftoverNodeModules}').Delete()\` ` +
            `or \`rmdir\` without /s) BEFORE deleting the rest of the directory, or a naive recursive delete can ` +
            `follow the link and destroy the real, shared node_modules other lanes are using.`,
        )
      }
    }
    throw error
  }
}

function releaseDirIfStillPresent(repo) {
  const dir = path.join(repo, 'release')
  return existsSync(dir) ? dir : null
}

const invokedDirectly = process.argv[1]
  && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`[cut-release-candidate] FAILED: ${error.message}`)
    process.exitCode = 1
  })
}
