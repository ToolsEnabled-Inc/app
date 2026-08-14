// THE GUARD THIS FILE IS: the engine existing but not being found must never
// come back.
//
// After the 2026-08-14 Desktop reorg, three suites resolved the engine as a
// sibling that no longer existed. Measured cost: 30 tests -> 15, and the two
// survivors FAILED in a way indistinguishable from a fresh regression, while
// the ratchet's headline number stayed green because a skipped test still
// counts. tools/canonical-root.mjs is the fix; this file pins its contract so
// the fix cannot silently rot.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import {
  ENGINE_MARKER,
  candidateRoots,
  discoverCanonicalRoot,
} from '../canonical-root.mjs'

// ---------------------------------------------------------------------------
// Pure ordering contract -- runs on every machine, engine or not.
// ---------------------------------------------------------------------------

test('an explicit MC_CANONICAL_ROOT wins unconditionally, even when stale', () => {
  const env = { MC_CANONICAL_ROOT: 'Z:\\somewhere\\that\\does\\not\\exist' }
  const result = discoverCanonicalRoot({ env, probe: () => false })
  assert.equal(result.source, 'env:MC_CANONICAL_ROOT')
  // The override is honoured verbatim; `found` tells the truth so a caller
  // (the doctor) can warn instead of the env var silently lying.
  assert.equal(result.found, false)
  assert.match(result.root, /somewhere/)
})

test('without the env var, the first candidate holding the marker wins, in declared order', () => {
  const candidates = candidateRoots({ env: {} })
  assert.equal(candidates[0].source, 'sibling')
  assert.equal(candidates[1].source, 'reorg-bucket')
  assert.equal(candidates[2].source, 'desktop')

  // Only the post-reorg layout holds the marker -> it must be chosen.
  const bucketRoot = candidates[1].root
  const result = discoverCanonicalRoot({
    env: {},
    probe: (path) => path === join(bucketRoot, ENGINE_MARKER),
  })
  assert.equal(result.source, 'reorg-bucket')
  assert.equal(result.root, bucketRoot)
  assert.equal(result.found, true)
})

test('sibling still beats the bucket when both exist (pre-reorg layouts keep working)', () => {
  const result = discoverCanonicalRoot({ env: {}, probe: () => true })
  assert.equal(result.source, 'sibling')
  assert.equal(result.found, true)
})

test('when nothing holds the marker, the sibling default returns with found:false so skips stay loud', () => {
  const result = discoverCanonicalRoot({ env: {}, probe: () => false })
  assert.equal(result.source, 'sibling-default-unfound')
  assert.equal(result.found, false)
  // The unfound fallback is the sibling path -- the shape every suite's
  // printed skip reason has always described.
  assert.equal(result.root, candidateRoots({ env: {} })[0].root)
})

// ---------------------------------------------------------------------------
// The layout guard -- the reason this file exists.
//
// On a machine where the engine exists in ANY known layout, discovery with the
// env var UNSET must find it. If this fails, the phantom-failure trap is back:
// three suites will skip or fail while the headline number stays green. On a
// clone with no engine anywhere, this skips with a stated reason -- same
// doctrine as the suites it protects.
// ---------------------------------------------------------------------------

test('discovery finds the engine with MC_CANONICAL_ROOT unset whenever any layout holds it', (t) => {
  const anyLayoutHasEngine = candidateRoots({ env: {} }).some((candidate) =>
    existsSync(join(candidate.root, ENGINE_MARKER)),
  )
  if (!anyLayoutHasEngine) {
    return t.skip(
      'No engine checkout in any known layout; nothing to discover. On the owner machine this test RUNS.',
    )
  }
  const result = discoverCanonicalRoot({ env: {} })
  assert.equal(result.found, true, 'the engine exists but discovery did not find it -- the exact defect this guard pins')
  assert.ok(
    existsSync(join(result.root, ENGINE_MARKER)),
    `discovered root ${result.root} does not hold ${ENGINE_MARKER}`,
  )
})
