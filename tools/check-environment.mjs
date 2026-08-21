// npm run doctor -- the first command to run in this checkout, and the one
// that would have saved a debugging cycle on 2026-08-14, when a Desktop
// reorganization left node_modules an empty real directory and moved the
// engine out of the sibling layout. Every check reports a sentence; every
// failure prints the command that fixes it. Exit code = number of failures.
import { existsSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { discoverCanonicalRoot, ENGINE_MARKER } from './canonical-root.mjs'
import { DEFAULT_STAGING_ROOT } from './release-packager/cut-release-candidate.mjs'

const here = fileURLToPath(import.meta.url)
const REPO = dirname(dirname(here))

const lines = []
let failures = 0
function ok(sentence) {
  lines.push(`  ok    ${sentence}`)
}
function warn(sentence) {
  lines.push(`  WARN  ${sentence}`)
}
function fail(sentence, fix) {
  lines.push(`  FAIL  ${sentence}`)
  if (fix) lines.push(`        fix: ${fix}`)
  failures += 1
}

// 1. node_modules is populated. An interrupted move or clone leaves an EMPTY
//    REAL DIRECTORY here, which fails every build, test and Electron launch
//    with errors that never name the actual cause.
const nodeModules = join(REPO, 'node_modules')
if (!existsSync(nodeModules)) {
  fail('node_modules does not exist; nothing can build or test.', 'npm ci')
} else {
  const entries = readdirSync(nodeModules).filter((name) => !name.startsWith('.'))
  if (entries.length === 0) {
    fail(
      'node_modules exists but is EMPTY -- the signature a relocation leaves behind. Every build, test and launch fails until it is restored.',
      'npm ci',
    )
  } else if (!existsSync(join(nodeModules, 'electron')) || !existsSync(join(nodeModules, 'vite'))) {
    fail(
      `node_modules has ${entries.length} entries but is missing electron or vite -- a partial install.`,
      'npm ci',
    )
  } else {
    ok(`node_modules is populated (${entries.length} entries, electron and vite present).`)
  }
}

// 2. The canonical engine root resolves, and the report says WHERE. Three
//    suites read the engine as a fixture source; when it exists but is not
//    found they half-skip and the survivors fail like fresh regressions,
//    while the ratchet headline stays green.
const discovery = discoverCanonicalRoot()
if (discovery.source === 'env:MC_CANONICAL_ROOT' && !discovery.found) {
  fail(
    `MC_CANONICAL_ROOT is set to ${discovery.root}, which does not hold ${ENGINE_MARKER} -- a stale override beats correct discovery and makes three suites skip or fail.`,
    'unset MC_CANONICAL_ROOT, or point it at the real engine checkout',
  )
} else if (discovery.found) {
  ok(`canonical engine root: ${discovery.root} (via ${discovery.source}).`)
} else {
  warn(
    `no engine checkout found in any known layout; the three canonical-reader suites will skip with a stated reason. On a machine that has the engine, set MC_CANONICAL_ROOT to it.`,
  )
}

// 3. The release staging root exists and is writable. The old default was a
//    bare Desktop child the reorg emptied, so a plain cut silently recreated
//    a stray folder; the corrected default is pinned by test.
if (!existsSync(DEFAULT_STAGING_ROOT)) {
  fail(
    `release staging root ${DEFAULT_STAGING_ROOT} does not exist; a cut would recreate it somewhere you did not intend.`,
    `mkdir "${DEFAULT_STAGING_ROOT}"`,
  )
} else {
  try {
    const probe = join(DEFAULT_STAGING_ROOT, `.doctor-probe-${process.pid}`)
    writeFileSync(probe, 'probe')
    rmSync(probe)
    ok(`release staging root is writable: ${DEFAULT_STAGING_ROOT}.`)
  } catch {
    fail(
      `release staging root ${DEFAULT_STAGING_ROOT} exists but is not writable.`,
      'check permissions on the folder',
    )
  }
}

// 4. The pinned payload source exists at its recorded ref. The payload the
//    installer ships is cut from this snapshot; if it is gone the build input
//    is gone, and if its HEAD drifted from the recorded pin the next cut
//    ships bytes nobody adopted.
const pinFile = join(REPO, 'private', 'capability-source.owner.json')
if (!existsSync(pinFile)) {
  warn('private/capability-source.owner.json is absent; pack:capability is unavailable on this machine (expected on a contributor clone).')
} else {
  let pin
  try {
    pin = JSON.parse(readFileSync(pinFile, 'utf8'))
  } catch {
    fail('private/capability-source.owner.json is not valid JSON.', 'restore it from the last good commit')
  }
  if (pin?.path) {
    if (!existsSync(pin.path)) {
      fail(
        `pinned payload source ${pin.path} does not exist -- the build input for every cut is missing.`,
        'restore the worktree (git -C <engine> worktree add <path> <ref>) or repoint the pin file',
      )
    } else {
      const recordedRef = pin.$comment?.match(/\b[0-9a-f]{7,40}\b/)?.[0]
      const head = spawnSync('git', ['-C', pin.path, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
      if (head.status !== 0) {
        warn(`pinned payload source exists at ${pin.path} but git could not read its HEAD; ref check skipped.`)
      } else if (recordedRef && !head.stdout.trim().startsWith(recordedRef)) {
        fail(
          `pinned payload source is at ${head.stdout.trim().slice(0, 12)} but the pin records ${recordedRef} -- the snapshot drifted from the adopted ref.`,
          `git -C "${pin.path}" checkout ${recordedRef}  (or update the pin deliberately, flipping capability-manifest.json with it)`,
        )
      } else {
        ok(`pinned payload source: ${pin.path} at ${head.stdout.trim().slice(0, 12)}${recordedRef ? ` (matches recorded ${recordedRef})` : ''}.`)
      }
    }
  }
}

console.log('Environment doctor:')
for (const line of lines) console.log(line)
console.log(
  failures === 0
    ? 'Everything this checkout needs is in place.'
    : `${failures} problem${failures === 1 ? '' : 's'} need${failures === 1 ? 's' : ''} fixing before this checkout can be trusted.`,
)
process.exitCode = failures
