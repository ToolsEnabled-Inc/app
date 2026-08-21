// The operator's purchase list is not part of the product.
//
// WHAT SHIPPED, AND WAS READ OFF THE PACKAGED WINDOW. public/data/purchase-catalog.json
// is the operator's own shopping list for launching this product -- 37 items, internal
// repo paths, internal request ids, second-person deliberations addressed to him, and a
// written admission that the installer is unsigned. vite copies public/** into dist/,
// package.json build.files ships "dist/**", and #/checkout was an unconditional stop on
// the navigation ring. So every installer carried it and one click back from home opened
// it on a stranger's fresh install.
//
// The defect class is this project's recurring one: absence read as consent. Nothing in
// the renderer half ever asked whose a file was, so a file nobody classified shipped.
// config/renderer-payload-boundary.json is where that question is now answered and
// tools/check-renderer-payload.mjs is what fails the build when it is not.
//
// WHAT THIS SUITE IS FOR, AND WHAT IT IS NOT. It is the fast half: the payload boundary
// in bytes, and the fail-closed rule the router hangs the surface on. It cannot see
// reachability -- whether a person can get to the screen is a property of the packaged
// window, and tools/checkout-privacy-packaged-qa.mjs is what asserts that, by clicking.
// Neither half is sufficient alone: the source half would pass on a build where the
// route was still live, and the window half would pass on a build that still carried the
// bytes but hid the door.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, openSync, readSync, closeSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import {
  __setCheckoutSurfaceForTest,
  checkoutSurfaceAvailable,
  checkoutSurfaceSettled,
  probeCheckoutSurface,
} from '../../src/checkout-visibility.js'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const PUBLIC_ROOT = path.join(REPO_ROOT, 'public')
const DIST_ROOT = path.join(REPO_ROOT, 'dist')
const PACKAGED_ASAR = path.join(REPO_ROOT, 'release', 'win-unpacked', 'resources', 'app.asar')

/* Strings read off the packaged window on 2026-08-11, before the fix. Each one is a
   different kind of leak, and they are listed separately so a failure names which. */
const LEAK_MARKERS = Object.freeze([
  'config/toolsenabled.policy.json',   // an internal file path, rendered on screen
  'src/lib/providers/pay.js',          // an internal module path, rendered on screen
  'More info then Run anyway',         // the admission that the installer is unsigned
  'R1203',                             // an internal request id
  'You asked the price directly',      // the operator addressed in the second person
])

function filesUnder(root) {
  const found = []
  const walk = (directory, relative) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const next = path.join(directory, entry.name)
      const rel = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) walk(next, rel)
      else if (entry.isFile()) found.push({ relative: rel, absolute: next })
    }
  }
  if (existsSync(root)) walk(root, '')
  return found
}

const TEXTUAL = /\.(js|mjs|cjs|json|html|css|md|txt|svg)$/i

function scanForMarkers(files) {
  const hits = []
  for (const file of files) {
    if (!TEXTUAL.test(file.relative)) continue
    const body = readFileSync(file.absolute, 'utf8')
    for (const marker of LEAK_MARKERS) {
      if (body.includes(marker)) hits.push(`${file.relative} carries ${JSON.stringify(marker)}`)
    }
  }
  return hits
}

/* ---------- the payload, in bytes ---------- */

test('the authored payload carries no purchase list', () => {
  const staged = filesUnder(PUBLIC_ROOT).map(file => file.relative)
  assert.ok(staged.length > 0, 'public/ is empty, so this assertion checked nothing')
  assert.ok(
    !staged.includes('data/purchase-catalog.json'),
    'public/data/purchase-catalog.json is back. vite copies public/** into dist/ verbatim, so it would '
    + 'ship in app.asar again. The operator\'s list belongs in private/purchase-catalog.owner.json and is '
    + 'read at runtime from the install\'s own data directory.',
  )
})

test('nothing authored for the payload carries the operator\'s own words', () => {
  const hits = scanForMarkers(filesUnder(PUBLIC_ROOT))
  assert.deepEqual(hits, [], `public/ carries operator data:\n  ${hits.join('\n  ')}`)
})

test('the built payload carries no purchase list and none of its words', (t) => {
  const built = filesUnder(DIST_ROOT)
  if (built.length === 0) return t.skip('no dist/ on this machine; run `npm run build` to include it')
  assert.ok(
    !built.some(file => file.relative === 'data/purchase-catalog.json'),
    'dist/data/purchase-catalog.json exists and electron-builder packs dist/** into app.asar',
  )
  const hits = scanForMarkers(built)
  assert.deepEqual(hits, [], `dist/ carries operator data:\n  ${hits.join('\n  ')}`)
})

/* THE ARTIFACT ON DISK IS ONLY EVIDENCE ABOUT THIS TREE IF IT WAS BUILT FROM IT.
 *
 * release/win-unpacked is whatever `npm run dist` last produced, which on a shared
 * checkout can be hours and several lanes old. Asserting against an older archive would
 * report a defect that has already been fixed, or -- far worse the other way round --
 * clear a build nobody has made yet. So this test refuses to report on an archive that
 * predates dist/, by name, and the unconditional version of the same assertion lives in
 * the two places where the artifact is guaranteed current: `npm run dist` and
 * `npm run release:cut` both run tools/check-renderer-payload.mjs against it. */
function archivePredatesBuild() {
  if (!existsSync(DIST_ROOT)) return false
  const archiveTime = statSync(PACKAGED_ASAR).mtimeMs
  const newestBuilt = filesUnder(DIST_ROOT).reduce((newest, file) => Math.max(newest, statSync(file.absolute).mtimeMs), 0)
  return archiveTime < newestBuilt
}

test('the packaged archive a stranger downloads carries neither', (t) => {
  if (!existsSync(PACKAGED_ASAR)) return t.skip('no packaged build on this machine; run `npm run dist` to include it')
  if (archivePredatesBuild()) {
    return t.skip(
      `${path.relative(REPO_ROOT, PACKAGED_ASAR)} is older than dist/, so it is not a build of this tree and `
      + 'this test would be reporting on the wrong bytes. Re-measure with `npm run dist` (which gates on '
      + 'tools/check-renderer-payload.mjs) or with tools/checkout-privacy-packaged-qa.mjs, which repacks the '
      + 'current tree into a real archive and drives the window.',
    )
  }
  const { entries, headerCount, baseOffset } = readArchive(PACKAGED_ASAR)
  // A reader that stopped early cannot clear a payload, and this project has already
  // had one false root cause from a listing that truncated itself in silence.
  assert.equal(entries.length, headerCount, 'the archive walk disagrees with the archive header; its verdict means nothing')

  const catalogues = entries.filter(entry => /purchase-catalog\.json$/.test(entry.path) && !entry.path.includes('schema'))
  assert.deepEqual(catalogues.map(entry => entry.path), [], 'the installer carries a purchase list')

  const hits = []
  for (const entry of entries) {
    if (!TEXTUAL.test(entry.path)) continue
    const body = readEntry(PACKAGED_ASAR, entry, baseOffset)
    for (const marker of LEAK_MARKERS) {
      if (body.includes(marker)) hits.push(`${entry.path} carries ${JSON.stringify(marker)}`)
    }
  }
  assert.deepEqual(hits, [], `the installer carries operator data:\n  ${hits.join('\n  ')}`)
})

test('the renderer payload boundary guard passes on this tree', () => {
  // Runs the guard itself rather than restating its rules: a second copy of a rule is a
  // copy that drifts, and the guard is what `npm run dist` actually gates on.
  const output = execFileSync(process.execPath, [path.join(REPO_ROOT, 'tools', 'check-renderer-payload.mjs')], {
    cwd: REPO_ROOT, encoding: 'utf8',
  })
  assert.match(output, /check-renderer-payload: OK/)
})

/* ---------- the surface fails closed ---------- */

test('the checkout surface is unavailable before anything has been measured', () => {
  __setCheckoutSurfaceForTest(false, false)
  assert.equal(checkoutSurfaceAvailable(), false)
  assert.equal(checkoutSurfaceSettled(), false, 'not measured yet is not the same answer as no')
})

test('a served catalogue is the only thing that turns the surface on', async () => {
  __setCheckoutSurfaceForTest(false, false)
  const available = await probeCheckoutSurface({
    fetchImpl: async () => ({ ok: true, headers: { get: () => 'application/json; charset=utf-8' } }),
    dispatch: null,
  })
  assert.equal(available, true)
  assert.equal(checkoutSurfaceAvailable(), true)
  assert.equal(checkoutSurfaceSettled(), true)
})

test('every way the probe can fail leaves the surface off', async () => {
  const refusals = [
    ['a 404 from a copy with no list', async () => ({ ok: false, status: 404, headers: { get: () => 'application/json' } })],
    ['an HTML body arriving with a 200', async () => ({ ok: true, headers: { get: () => 'text/html' } })],
    ['a 200 with no content type at all', async () => ({ ok: true, headers: { get: () => null } })],
    ['a fetch that throws', async () => { throw new Error('offline') }],
    ['a fetch that resolves to nothing', async () => null],
    ['no fetch implementation in this environment', null],
  ]
  for (const [why, fetchImpl] of refusals) {
    __setCheckoutSurfaceForTest(true, true)
    const available = await probeCheckoutSurface({ fetchImpl, dispatch: null })
    assert.equal(available, false, `the surface survived ${why}`)
    assert.equal(checkoutSurfaceAvailable(), false, `the surface survived ${why}`)
    assert.equal(checkoutSurfaceSettled(), true, `${why} left the router waiting forever`)
  }
})

test('a probe that never answers is a closed door rather than an open one', async () => {
  __setCheckoutSurfaceForTest(true, true)
  const available = await probeCheckoutSurface({
    fetchImpl: () => new Promise(() => {}),
    timeoutMs: 30,
    dispatch: null,
  })
  assert.equal(available, false)
  assert.equal(checkoutSurfaceSettled(), true)
})

/* ---------- asar reading, same format as tools/check-asar-manifest.mjs ---------- */

function readArchive(archivePath) {
  const fd = openSync(archivePath, 'r')
  try {
    const head = Buffer.alloc(16)
    readSync(fd, head, 0, 16, 0)
    const jsonLength = head.readUInt32LE(12)
    const jsonBuffer = Buffer.alloc(jsonLength)
    readSync(fd, jsonBuffer, 0, jsonLength, 16)
    const header = JSON.parse(jsonBuffer.toString('utf8'))
    const entries = []
    const walk = (node, prefix) => {
      for (const [name, child] of Object.entries(node.files || {})) {
        const full = prefix ? `${prefix}/${name}` : name
        if (child.files) walk(child, full)
        else entries.push({ path: full, size: child.size, offset: Number(child.offset) })
      }
    }
    walk(header, '')
    const count = (node) => Object.values(node.files || {})
      .reduce((total, child) => total + (child.files ? count(child) : 1), 0)
    return { entries, headerCount: count(header), baseOffset: 16 + Math.ceil(jsonLength / 4) * 4 }
  } finally {
    closeSync(fd)
  }
}

function readEntry(archivePath, entry, baseOffset) {
  const fd = openSync(archivePath, 'r')
  try {
    const buffer = Buffer.alloc(entry.size)
    if (entry.size > 0) readSync(fd, buffer, 0, entry.size, baseOffset + entry.offset)
    return buffer.toString('utf8')
  } finally {
    closeSync(fd)
  }
}
