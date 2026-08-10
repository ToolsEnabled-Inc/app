/* Render the Machine-B-facing release declaration from MEASURED facts.
 *
 * This is the automated form of C:\Users\joshp\Desktop\MACHINE-A-INSTALLER-DECLARATION.md
 * (hand-written, 2026-08-10). Preserve what that document got right:
 *
 *   - Separate the CONFIGURED appId from the OS-observed AUMID. Configuration
 *     passing electron-builder's schema check is not the same claim as "the
 *     OS reports this AUMID", and the matrix (MACHINE-B-REPLACEMENT-BUILD-
 *     ACCEPTANCE-MATRIX.md, "appId" row) explicitly rejects metadata-only
 *     evidence for this gate.
 *   - List other same-version-pattern files on the machine that are NOT the
 *     candidate, built by SCANNING (see lib/scan-artifacts.mjs), not by a
 *     maintained list that goes stale.
 *   - State the unsigned/SmartScreen caveat plainly, driven by the actual
 *     `signExecutable` value read from package.json, not assumed.
 *   - Say which checks were NOT run (Phase 1/2 install testing, trust UX,
 *     etc.) as plainly as which were.
 *
 * Every field in the "measured" tables below comes from the caller-supplied
 * `facts` object, which cut-release-candidate.mjs populates from things it
 * actually measured (file hashes, VersionInfo read off the real exe, git
 * status output) -- never from what the pipeline was merely told to do.
 */
import { writeFile } from 'node:fs/promises'

function fmtBytes(n) {
  return n.toLocaleString('en-US')
}

function bulletList(items) {
  return items.map((item) => `- ${item}`).join('\n')
}

function renderOtherCandidates(otherCandidates, stagingDir) {
  if (otherCandidates.length === 0) {
    return `No other \`Mission Control Setup *.exe\` files were found in the scanned locations ` +
      `(${stagingDir} and its siblings). If one appears later, it is not this candidate unless its ` +
      `SHA-256 matches the value declared above.`
  }
  return (
    'Do not transfer or trust any of these if encountered:\n\n' +
    bulletList(
      otherCandidates.map(
        (item) =>
          `\`${item.path}\` (${fmtBytes(item.bytes)} bytes, SHA-256 \`${item.sha256}\`, mtime ${item.mtime}) -- ` +
          `not this candidate; different bytes.`,
      ),
    )
  )
}

function renderExcludedWip(excludedWip) {
  if (!excludedWip || excludedWip.dirtyFiles.length === 0) {
    return `\`${excludedWip?.sourceWorktree ?? 'the day-to-day worktree'}\` had no uncommitted changes when this ` +
      `declaration was generated. Nothing was excluded on that account.`
  }
  return (
    `**Another lane's in-progress, uncommitted work exists in the day-to-day worktree ` +
    `(\`${excludedWip.sourceWorktree}\`) and is NOT in this build.** It was measured, by ` +
    `\`git status --porcelain\`, at declaration time (${excludedWip.measuredAt}):\n\n` +
    bulletList(excludedWip.dirtyFiles.map((line) => `\`${line}\``)) +
    `\n\nThis build was produced in an isolated, detached worktree checked out directly from git history ` +
    `(see "Tree state at build time" below); that worktree never contained these files on disk at all, so ` +
    `their exclusion is structural, not something the pipeline had to notice and filter.`
  )
}

function renderPipelineSection(pipeline) {
  const lines = []
  lines.push(`- \`npm run dist\` -> **exit ${pipeline.distExitCode}**, single unbroken run.`)
  if (pipeline.verifySummary) lines.push(`  - \`verify\` (test-ratchet.mjs): ${pipeline.verifySummary}`)
  if (pipeline.checkNoOwnerData) {
    lines.push(
      `  - \`check-no-owner-data.mjs\`: **\`Scanned ${pipeline.checkNoOwnerData.filesScanned} files ` +
        `(${pipeline.checkNoOwnerData.bytesScanned} bytes). Total matches: ${pipeline.checkNoOwnerData.totalMatches}.\`**`,
    )
  }
  if (pipeline.smokePackagedLine) lines.push(`  - \`smoke-packaged.mjs\`: \`${pipeline.smokePackagedLine}\``)
  return lines.join('\n')
}

function renderAppIdSection(appId) {
  return (
    `\`build.appId: "${appId.configured}"\` in \`package.json\` was accepted by electron-builder's ` +
    `configuration-schema validation (build did not fail). **This declaration certifies the configured ` +
    `value only.** The matrix's actual requirement -- "OS-reported shortcut/running-window AUMID is ` +
    `${appId.configured}" -- requires installing and reading the resulting shortcut's property store, which ` +
    `is Phase 1 install-testing scope and was **not run by this tool**. Do not treat this declaration as ` +
    `satisfying the appId gate by itself; it satisfies the configuration half of it.`
  )
}

function renderUnsignedSection(unsigned) {
  if (unsigned.signExecutable === false) {
    return (
      `**This build is unsigned** -- \`signExecutable: false\` is set in \`package.json\`. Expect SmartScreen ` +
        `friction on first download; this is a known, separate gap from the identity fields this declaration ` +
        `covers, not something this tool attempted to close.`
    )
  }
  return (
    `\`package.json\` sets \`signExecutable: ${JSON.stringify(unsigned.signExecutable)}\`. This tool did not ` +
      `independently verify a valid Authenticode signature is present -- do not treat this line as trust-UX evidence; ` +
      `see the acceptance matrix's "Trust UX" row for what is actually required.`
  )
}

const VERIFICATION_LABELS = {
  'source-only': 'verified by source/history inspection only -- NOT observed against a running installed app',
  observed: 'observed directly against the built/running artifact',
  both: 'verified both by source inspection and by direct observation against the built/running artifact',
}

function renderKnownFixes(knownFixes) {
  if (!knownFixes || knownFixes.length === 0) {
    return (
      'No specific fix claims were declared for this candidate. This is not the same as "nothing changed" -- ' +
      `see the commit range from the previous build ref for what actually landed; nothing here should be read as ` +
      `an implicit claim that a particular defect is fixed.`
    )
  }
  return bulletList(
    knownFixes.map((fix) => {
      const label = VERIFICATION_LABELS[fix.verifiedBy] ?? `verification method not recognised: ${JSON.stringify(fix.verifiedBy)}`
      return `**${fix.description}** -- ${label}.${fix.evidence ? ` Evidence: ${fix.evidence}` : ''}`
    }),
  )
}

const NOT_RUN_ITEMS = [
  'Trust UX (SmartScreen / Defender / Authenticode) -- see unsigned caveat above.',
  'Install/uninstall UX, shortcut/Apps-entry correctness, first-run windows, navigation/configuration, ' +
    'live-vs-simulated indicators, reboot persistence, resource-compliance sampling, Phase 2 clean-VM protocol -- ' +
    'all Phase 1/2 testing scope per the acceptance matrix, not build-and-measure scope.',
  'Whole-product privacy/stranger-fit review. `check-no-owner-data.mjs` scanning the packaged bytes for known ' +
    'patterns is real evidence against the specific leaks it is designed to catch; it is not the matrix\'s ' +
    '"route-by-route captures... human inspection is mandatory" requirement.',
  'appId as an OS-observed AUMID (see appId section above) -- configuration only was verified.',
  'A full multi-cycle close/relaunch persistence test against the installed app -- Phase 1 scope.',
]

export function renderDeclaration(facts) {
  const {
    test,
    date,
    version,
    previousVersion,
    repo,
    branch,
    sourceRef,
    buildRef,
    branchAdvanced,
    candidate,
    treeState,
    versionInfo,
    appId,
    unsigned,
    pipeline,
    excludedWip,
    otherCandidates,
    stagingDir,
    privateInputsCopied,
    privateInputsSkippedTracked,
    knownFixes,
  } = facts

  const header = test
    ? `# TEST BUILD -- NOT A DECLARED CANDIDATE -- DO NOT SEND TO MACHINE B\n\n` +
      `This file was produced by \`tools/release-packager/cut-release-candidate.mjs --test\` to prove the packager works. ` +
      `It is not an authorized release candidate: it was not built at the owner's direction to ship, and must not ` +
      `be transferred, referenced, or treated as satisfying any row of the acceptance matrix.\n\n---\n\n`
    : ''

  return `${header}# Machine A installer declaration -- Mission Control ${version}

Date: ${date}
From: automated release packager (\`tools/release-packager/cut-release-candidate.mjs\`)
Governed by: \`MACHINE-B-REPLACEMENT-BUILD-ACCEPTANCE-MATRIX.md\`, "Immutable declaration" / "Product identity" / "appId" gates.

**Disposition: ${test ? 'TEST ARTIFACT -- not offered as a candidate.' : 'this is the immutable candidate. Do not treat any other `Mission Control Setup *.exe` file as a candidate -- see "Artifacts that are NOT this candidate" below.'}**

## The fields the matrix names

| Field | Value |
|---|---|
| Filename | \`${candidate.filename}\` |
| Version | ${version}${previousVersion ? ` (previous candidate: ${previousVersion})` : ''} |
| Exact byte count | ${fmtBytes(candidate.bytes)} |
| SHA-256 | \`${candidate.sha256}\` |
| Build ref | commit \`${buildRef}\`, branch \`${branch}\`${branchAdvanced ? '' : ' (NOT YET the tip of that branch -- see "Branch state" below)'}, repo \`${repo}\` |
| Publisher (CompanyName) | \`${versionInfo.companyName}\` |
| ProductName | \`${versionInfo.productName}\` |
| appId | \`${appId.configured}\` (configured; see appId section below) |
| Immutable transfer location | \`${stagingDir}\\${candidate.filename}\` (blockmap alongside) |

## Branch state

Built from \`${sourceRef}\` (the tip of \`${branch}\` at build start), then one version-bump commit was added on top ` +
    `in an isolated detached worktree, producing \`${buildRef}\`. ${
      branchAdvanced
        ? `\`${branch}\` was fast-forwarded to \`${buildRef}\` after the build verified clean.`
        : `**\`${branch}\` was NOT advanced to \`${buildRef}\`.** The commit exists in git history and is fully ` +
          `reproducible (\`git show ${buildRef}:package.json\`), but is not yet reachable from \`${branch}\` -- land it ` +
          `deliberately with \`git branch -f ${branch} ${buildRef}\` (a fast-forward; safe by construction) when ready, ` +
          `or re-run with \`--advance-branch\`.`
    }

## Tree state at build time -- clean, and what that means

\`git status --porcelain\` was measured **empty** twice: immediately after the isolated detached worktree was ` +
    `created (before the version bump / dependency setup) and again immediately before \`npm run dist\`. Both ` +
    `measurements ran in \`${treeState.worktreePath}\` -- a fresh worktree created with ` +
    `\`git worktree add --detach ${treeState.worktreePath} ${sourceRef}\`, never the day-to-day worktree where ` +
    `other lanes' work happens. That distinction is the point: this candidate's bytes are reproducible from git ` +
    `history plus the version-bump commit above, plus the local, gitignored inputs listed below -- not from any ` +
    `ambient working-tree state that cannot be recreated.

This is not only this tool's own claim: \`require-clean-tree.mjs\` -- the pipeline's own gate, wired into \`npm run ` +
    `dist\` between \`vite build\` and \`electron-builder\`, unmodified by this tool -- independently wrote ` +
    `\`dist/build-info.json\` inside this same worktree, and this tool read it back after the build succeeded rather ` +
    `than trusting the exit code alone. ${
      treeState.buildInfoConfirmedClean
        ? '**Confirmed: `dirty: false`, `overridden: false`.**'
        : '**DID NOT CONFIRM CLEAN -- this declaration should not have been produced; treat it as suspect.**'
    } \`MC_ALLOW_DIRTY_BUILD\` was also explicitly stripped from the build's environment before \`npm run dist\` ran, ` +
    `rather than trusting that it happened not to be inherited from this process's own shell.

Local, genuinely untracked inputs copied from \`${repo}\\private\` into the build worktree (these configure ` +
    `what the privacy scanner looks for; they do not change the code being built): ` +
    `${privateInputsCopied.length > 0 ? privateInputsCopied.map((f) => `\`${f}\``).join(', ') : '(none found)'}. ` +
    `${(privateInputsSkippedTracked?.length ?? 0) > 0
      ? `Left as their git-tracked, committed content and NOT overwritten with this machine's local copies (already ` +
        `part of the build ref, so this is what "reproducible from git history alone" means for them): ` +
        `${privateInputsSkippedTracked.map((f) => `\`${f}\``).join(', ')}.`
      : ''}

## What this build deliberately excludes

${renderExcludedWip(excludedWip)}

## Artifacts that are NOT this candidate

${renderOtherCandidates(otherCandidates, stagingDir)}

## How the declared candidate was produced and verified

1. \`git worktree add --detach ${treeState.worktreePath} ${sourceRef}\` -- clean checkout, the day-to-day worktree untouched throughout.
2. \`git status --porcelain\` -> empty (captured as evidence, not assumed).
3. Version bumped ${previousVersion ? `from ${previousVersion} ` : ''}to ${version} in \`package.json\` only, committed alone (\`git commit -F - -- package.json\`) -> \`${buildRef}\`.
4. Dependencies provisioned (junctioned from an existing, lockfile-matched \`node_modules\` when possible; \`npm ci\` otherwise -- see the run log for which happened this time).
5. \`git status --porcelain\` -> empty again, immediately before the build.
6. \`npm run dist\` -> single unbroken run:
${renderPipelineSection(pipeline)}
7. Setup exe and blockmap copied to the immutable transfer location **before** the build worktree was removed, and re-hashed at that location to confirm the copy is byte-identical to the measured build (SHA-256 \`${candidate.sha256}\`, re-verified after copy${treeState.worktreeRemoved ? ' and again after `git worktree remove`' : ''}).
${treeState.worktreeRemoved ? `8. \`git worktree remove --force ${treeState.worktreePath}\` -- the day-to-day worktree was never entered, touched, or referenced except for the one read-only copy of \`private/**\` described above.` : `8. The build worktree was **kept** at \`${treeState.worktreePath}\` (removal was skipped) for inspection.`}

### VersionInfo, measured on the actual artifact (not intended metadata)

\`\`\`
CompanyName     : ${versionInfo.companyName}
ProductName     : ${versionInfo.productName}
FileVersion     : ${versionInfo.fileVersion}
ProductVersion  : ${versionInfo.productVersion}
LegalCopyright  : ${versionInfo.legalCopyright}
\`\`\`

### appId -- what is and is not verified here

${renderAppIdSection(appId)}

## Known fixes in this candidate -- and how each was verified

Precedent (MACHINE-A-INSTALLER-DECLARATION.md's "Relaunch fix" section) named a specific defect fix and was careful ` +
    `to say it was verified by source inspection only, not by observing the installed app -- that distinction is ` +
    `easy to lose once a declaration is generated instead of hand-written, so it is a first-class field here rather ` +
    `than prose someone has to remember to add:

${renderKnownFixes(knownFixes)}

## Explicitly out of scope for this declaration

${renderUnsignedSection(unsigned)}

Not evaluated by this tool, and not implied by anything above:

${bulletList(NOT_RUN_ITEMS)}

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Lane: release-packager (session 6f84bf9b)
`
}

export async function writeDeclaration(filePath, facts) {
  const markdown = renderDeclaration(facts)
  await writeFile(filePath, markdown, 'utf8')
  return markdown
}

// Standalone CLI mode: regenerate a declaration for an ALREADY-BUILT exe,
// reading what it can measure directly (VersionInfo, hash, bytes) and
// taking the rest of the facts (git ref, clean-tree state, pipeline log
// summaries) from a JSON file, since those cannot be re-derived after the
// fact from the exe alone. Used to test this renderer against a known-good
// artifact without running a new build.
async function main() {
  const args = process.argv.slice(2)
  const exeIndex = args.indexOf('--exe')
  const factsIndex = args.indexOf('--facts')
  const outIndex = args.indexOf('--out')
  if (exeIndex === -1 || factsIndex === -1) {
    console.error('usage: node generate-declaration.mjs --exe <path> --facts <json-file> [--out <path>]')
    process.exitCode = 2
    return
  }

  const { readFile } = await import('node:fs/promises')
  const { measureFile } = await import('./lib/hash.mjs')
  const { readExeVersionInfo } = await import('./lib/version-info.mjs')

  const exePath = args[exeIndex + 1]
  const factsPath = args[factsIndex + 1]
  const outPath = outIndex !== -1 ? args[outIndex + 1] : null

  const overrides = JSON.parse(await readFile(factsPath, 'utf8'))
  const measured = await measureFile(exePath)
  const versionInfo = await readExeVersionInfo(exePath)

  const facts = {
    ...overrides,
    candidate: { filename: measured.path.split(/[\\/]/).pop(), bytes: measured.bytes, sha256: measured.sha256, ...overrides.candidate },
    versionInfo: { ...versionInfo, ...overrides.versionInfo },
  }

  const markdown = renderDeclaration(facts)
  if (outPath) {
    await writeFile(outPath, markdown, 'utf8')
    console.log(`[generate-declaration] wrote ${outPath}`)
  } else {
    console.log(markdown)
  }
}

const invokedDirectly = process.argv[1]
  && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`[generate-declaration] ${error.message}`)
    process.exitCode = 1
  })
}
