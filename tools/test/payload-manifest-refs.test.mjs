// EVERY PATH THE SHIPPED MANIFEST REFERENCES MUST RESOLVE INSIDE THE PAYLOAD.
//
// Nothing checked this before, and the measured result: the payload shipped
// the engine's package.json byte-identical -- 119 scripts naming 603 test
// files and 17 tools/ paths that do not exist in the payload (no tests/
// directory ships at all). Every npm script in the shipped product failed on
// contact, and the file published ~620 internal engine file names to every
// install. The existing gates each looked elsewhere: check-no-owner-data scans
// for owner identity (there was none -- file NAMES are not owner data),
// check-payload-boundary classifies which files ship (package.json is open),
// and check-payload-current compares bytes against the source (they matched,
// because shipping the wrong file faithfully is still shipping it).
//
// The fix stages a curated capability-defaults/package.json over the engine's
// via neutralDefaults; this test is the guard that keeps it curated. It reads
// the STAGED payload, so it validates whatever the packer actually produced,
// not what any config promises.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const here = fileURLToPath(import.meta.url)
const REPO = dirname(dirname(dirname(here)))
const PAYLOAD = join(REPO, 'capability')
const MANIFEST = join(PAYLOAD, 'package.json')

// Path-like tokens inside script commands: the payload's own top-level trees.
const REF_PATTERN = /(?:src|tools|tests|config|research|schemas|sidecars|bin)\/[A-Za-z0-9._/-]+/g

function stagedPayloadMissing() {
  return !existsSync(MANIFEST)
}

const SKIP = 'capability/ is not staged in this checkout; run `npm run pack:capability` first. On a machine with the pinned source this test RUNS.'

test('every script in the shipped package.json references only files that ship', (t) => {
  if (stagedPayloadMissing()) return t.skip(SKIP)
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
  const missing = []
  for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
    for (const ref of command.match(REF_PATTERN) ?? []) {
      if (!existsSync(join(PAYLOAD, ref))) missing.push(`${name}: ${ref}`)
    }
  }
  assert.deepEqual(
    missing,
    [],
    `shipped scripts reference files absent from the payload -- a customer running them gets MODULE_NOT_FOUND:\n  ${missing.join('\n  ')}`,
  )
})

test('every bin target in the shipped package.json ships', (t) => {
  if (stagedPayloadMissing()) return t.skip(SKIP)
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
  const missing = Object.entries(manifest.bin ?? {})
    .filter(([, target]) => !existsSync(join(PAYLOAD, target)))
    .map(([name, target]) => `${name}: ${target}`)
  assert.deepEqual(missing, [], `shipped bin entries point at absent files:\n  ${missing.join('\n  ')}`)
})

test('the shipped package.json does not enumerate the engine test suite', (t) => {
  if (stagedPayloadMissing()) return t.skip(SKIP)
  const raw = readFileSync(MANIFEST, 'utf8')
  const testRefs = raw.match(/tests\/[A-Za-z0-9._/-]+/g) ?? []
  // No tests/ directory ships, so ANY tests/ reference is a dead one -- and
  // hundreds of them are how ~620 internal engine file names reached every
  // install. Zero is the only honest number.
  assert.equal(
    testRefs.length,
    0,
    `the shipped manifest names ${testRefs.length} tests/ path(s); the payload ships no tests/ directory, so each is a dead reference leaking an internal file name (first: ${testRefs[0]})`,
  )
})

test('the payload manifest stays the curated neutral default, not the engine file', (t) => {
  if (stagedPayloadMissing()) return t.skip(SKIP)
  const defaultsFile = join(REPO, 'capability-defaults', 'package.json')
  assert.ok(existsSync(defaultsFile), 'capability-defaults/package.json is missing; the curated manifest has no source')
  assert.equal(
    readFileSync(MANIFEST, 'utf8'),
    readFileSync(defaultsFile, 'utf8'),
    'capability/package.json differs from capability-defaults/package.json -- the packer staged something other than the curated default (is package.json still in neutralDefaults?)',
  )
})
