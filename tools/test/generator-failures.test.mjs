import assert from 'node:assert/strict'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import { PROJECT_ROOT, readSchema } from '../gen-projection-lib.mjs'
import { fetchProjection } from '../../src/live-status.js'

// WHERE THE REAL FIXTURE READER COMES FROM, AND WHY THIS IS NOT CANONICAL_ROOT.
//
// These tests either copy the REAL agent-org reader out of the ToolsEnabled checkout
// or pass that checkout to a generator as its canonical fixture. That is worth keeping:
// the failure cases exercise the actual parsing code rather than a re-implementation.
//
// This location is independent of the generator library's CANONICAL_ROOT, which means
// "the root THIS GENERATOR RUN must read" and deliberately fails closed when unset.
// Borrowing that value as a test-fixture location would couple the tests to generator
// configuration and undo the removal of one developer's Desktop default.
//
// So the real fixture checkout is resolved RELATIVELY: the two trees are siblings in a
// normal layout and no account name is embedded here. MC_CANONICAL_ROOT still wins for
// machines that arrange the checkouts differently.
const REAL_CANONICAL =
  process.env.MC_CANONICAL_ROOT?.trim() || resolve(PROJECT_ROOT, '..', 'toolsenabled-current')

// A SKIP MUST BE LOUD, AND MUST NOT BE THE NORMAL CASE.
//
// Someone cloning only this repo does not have the real reader fixture and should get a
// stated skip instead of failures they cannot act on. The reason is always printed; in
// the normal sibling layout these tests RUN and continue protecting the failure paths.
function canonicalReadersMissing() {
  return !existsSync(join(REAL_CANONICAL, 'src', 'lib', 'agent-org.js'))
}

const SKIP_REASON =
  `ToolsEnabled checkout not found at ${REAL_CANONICAL}: these tests use its real ` +
  'reader modules as fixtures. Set MC_CANONICAL_ROOT to that checkout to run them.'

const FIXED_NOW = '2026-08-05T12:00:00.000Z'

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, 'utf8')
}

function copyAgentOrgReader(root) {
  const target = join(root, 'src', 'lib', 'agent-org.js')
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(join(REAL_CANONICAL, 'src', 'lib', 'agent-org.js'), target)
}

function runGenerator(domain, { outputRoot, canonicalRoot = REAL_CANONICAL, liveRoot, schemaRoot } = {}) {
  const env = {
    ...process.env,
    MC_NOW: FIXED_NOW,
    MC_OUTPUT_ROOT: outputRoot,
    MC_CANONICAL_ROOT: canonicalRoot,
    ...(liveRoot ? { MC_LIVE_ROOT: liveRoot } : {}),
    ...(schemaRoot ? { MC_SCHEMA_ROOT: schemaRoot } : {}),
  }
  return spawnSync(process.execPath, [join(PROJECT_ROOT, 'tools', `gen-${domain}.mjs`)], {
    cwd: PROJECT_ROOT,
    env,
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  })
}

function readOutput(root, domain) {
  return JSON.parse(readFileSync(join(root, `${domain}.json`), 'utf8'))
}

function fileFetch(domain, payload) {
  const schema = readSchema(domain)
  return async url => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    async json() { return structuredClone(url.includes('/schema/') ? schema : payload) },
  })
}

function fixedLiveRoot(root) {
  write(join(root, 'tools', 'agent-preflight.js'), `
const value = {
  generatedAt: '2026-08-05T12:00:00.000Z',
  repo: 'fixture-live-root',
  machine: { letter: 'A', role: 'fixture-observed-host' },
  mcp: { live: ['toolsenabled-readonly'], dead: [] },
  otherAgents: {
    codex: [{ id: '019fd391-2fb3-7790-b530-5fa99fddcf72', ageMs: 60000 }],
    claude: [{ id: 'b5345074-17db-4d74-9865-d1bbee818636', ageMs: 120000 }],
    activeWindowMinutes: 90
  },
  inFlight: { fleetSupervisor: { alive: true, running: 3, items: { idle: 2, parked: 1 } } },
  localServices: [{ name: 'health-observer snapshot', kind: 'heartbeat', ageSec: 5, stale: false, detail: 'owned / healthy' }]
};
process.stdout.write(JSON.stringify(value));
`)
  return root
}

test('missing canonical source emits a valid unavailable payload and reader returns ok:false', async t => {
  if (canonicalReadersMissing()) return t.skip(SKIP_REASON)
  const fixture = mkdtempSync(join(tmpdir(), 'mc-projection-missing-'))
  t.after(() => rmSync(fixture, { recursive: true, force: true }))
  const canonical = join(fixture, 'canonical')
  const output = join(fixture, 'output')
  copyAgentOrgReader(canonical)

  const run = runGenerator('fleet', { outputRoot: output, canonicalRoot: canonical, liveRoot: fixedLiveRoot(join(fixture, 'live')) })
  assert.equal(run.status, 0, run.stderr)
  const payload = readOutput(output, 'fleet')
  assert.equal(payload.ok, false)
  assert.equal(payload.reason, 'source-missing')

  const read = await fetchProjection('fleet', { fetchImpl: fileFetch('fleet', payload) })
  assert.equal(read.ok, false)
  assert.equal(read.reason, 'source-missing')
})

test('malformed canonical source emits source-malformed without a throw', async t => {
  if (canonicalReadersMissing()) return t.skip(SKIP_REASON)
  const fixture = mkdtempSync(join(tmpdir(), 'mc-projection-malformed-'))
  t.after(() => rmSync(fixture, { recursive: true, force: true }))
  const canonical = join(fixture, 'canonical')
  const output = join(fixture, 'output')
  copyAgentOrgReader(canonical)
  write(join(canonical, 'config', 'agent-org.json'), '{"agents":')

  const run = runGenerator('fleet', { outputRoot: output, canonicalRoot: canonical, liveRoot: fixedLiveRoot(join(fixture, 'live')) })
  assert.equal(run.status, 0, run.stderr)
  const payload = readOutput(output, 'fleet')
  assert.equal(payload.ok, false)
  assert.equal(payload.reason, 'source-malformed')
})

test('unreachable live-state emits an unavailable ops payload end to end', async t => {
  if (canonicalReadersMissing()) return t.skip(SKIP_REASON)
  const fixture = mkdtempSync(join(tmpdir(), 'mc-projection-unreachable-'))
  t.after(() => rmSync(fixture, { recursive: true, force: true }))
  const output = join(fixture, 'output')
  const run = runGenerator('ops', { outputRoot: output, liveRoot: join(fixture, 'missing-live-root') })
  assert.equal(run.status, 0, run.stderr)
  const payload = readOutput(output, 'ops')
  assert.equal(payload.ok, false)
  assert.equal(payload.reason, 'source-unreachable')
  const read = await fetchProjection('ops', { fetchImpl: fileFetch('ops', payload) })
  assert.equal(read.ok, false)
  assert.equal(read.reason, 'source-unreachable')
})

test('generator refuses to emit a payload rejected by its schema', t => {
  if (canonicalReadersMissing()) return t.skip(SKIP_REASON)
  const fixture = mkdtempSync(join(tmpdir(), 'mc-projection-schema-reject-'))
  t.after(() => rmSync(fixture, { recursive: true, force: true }))
  const output = join(fixture, 'output')
  const schemaRoot = join(fixture, 'schema')
  const schema = readSchema('coordinator')
  schema.$defs.data.required.push('fixtureMissingField')
  write(join(schemaRoot, 'coordinator.schema.json'), JSON.stringify(schema))

  const run = runGenerator('coordinator', {
    outputRoot: output,
    liveRoot: fixedLiveRoot(join(fixture, 'live')),
    schemaRoot,
  })
  assert.notEqual(run.status, 0)
  assert.equal(existsSync(join(output, 'coordinator.json')), false)
  assert.match(run.stderr, /PROJECTION_SCHEMA_REJECTED|failed schema validation/)
})

test('all six generators are byte-idempotent against fixed read-only fixtures', t => {
  if (canonicalReadersMissing()) return t.skip(SKIP_REASON)
  const fixture = mkdtempSync(join(tmpdir(), 'mc-projection-idempotent-'))
  t.after(() => rmSync(fixture, { recursive: true, force: true }))
  const output = join(fixture, 'output')
  const live = fixedLiveRoot(join(fixture, 'live'))

  for (const domain of ['fleet', 'agents', 'metrics', 'ops', 'ledger', 'coordinator']) {
    const first = runGenerator(domain, { outputRoot: output, liveRoot: live })
    assert.equal(first.status, 0, `${domain}: ${first.stderr}`)
    const before = readFileSync(join(output, `${domain}.json`), 'utf8')
    const second = runGenerator(domain, { outputRoot: output, liveRoot: live })
    assert.equal(second.status, 0, `${domain}: ${second.stderr}`)
    const after = readFileSync(join(output, `${domain}.json`), 'utf8')
    assert.equal(after, before, domain)
  }
})
