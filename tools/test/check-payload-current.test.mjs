// Does the staleness guard actually refuse a stale payload?
//
// tools/check-payload-current.mjs was added after the shipped payload was found
// to have drifted from source on three security-critical files while every
// other gate reported clean. It is wired into `npm run dist`. It had no test.
//
// A gate nothing tests is the thing this whole night has been about: it can
// stop guarding silently, and the build keeps printing green. Worse than an
// absent gate, because its green is quoted.
//
// These assertions RUN the tool against real directories and read its real exit
// code. They do not read its source. A source assertion cannot see reachability
// -- dead code matches a text search exactly as well as live code does, which is
// how a lane tonight shipped a repair that emptied a whole settings screen while
// its suite stayed green. The only thing that sees "did it refuse" is running it
// and looking at what came back.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const TOOL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'check-payload-current.mjs')

// The two files the packer deliberately substitutes from capability-defaults/.
// Naming them here rather than reading the manifest keeps this test honest: if
// the manifest gains a third, this fixture will not silently start covering it.
const NEUTRAL = ['config/service-registry.json', 'config/agent-org.json']

function put(root, relative, contents) {
  const target = path.join(root, relative)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, contents)
}

// Builds a source tree and a staged payload that mirrors it, plus the marker
// the source resolver keys on (tools/mission-bridge.js).
function scaffold() {
  const base = mkdtempSync(path.join(os.tmpdir(), 'mc-cpc-'))
  const source = path.join(base, 'engine')
  const staged = path.join(base, 'capability')

  put(source, 'tools/mission-bridge.js', '// resolver marker\n')
  put(source, 'src/lib/thing.js', 'module.exports = 1\n')
  put(source, 'src/lib/providers/scrub.js', '// the scrub\n')

  put(staged, 'tools/mission-bridge.js', '// resolver marker\n')
  put(staged, 'src/lib/thing.js', 'module.exports = 1\n')
  put(staged, 'src/lib/providers/scrub.js', '// the scrub\n')
  // The neutral defaults are copied from the REAL capability-defaults/, because
  // that is what the packer does and what the guard therefore compares against.
  // An invented fixture here mismatches the real defaults and makes the
  // baseline case fail for a fictional reason -- which is exactly what the first
  // draft of this test did, and it took the guard's own correct refusal to show
  // it. The fixture was wrong, not the tool.
  for (const relative of NEUTRAL) {
    put(staged, relative, readFileSync(path.join(REPO_ROOT, 'capability-defaults', relative)))
  }
  put(staged, 'PAYLOAD.json', JSON.stringify({ schemaVersion: 1, neutralDefaults: NEUTRAL }))

  return { base, source, staged }
}

function run(staged, source) {
  const env = { ...process.env }
  delete env.TOOLSENABLED_SOURCE
  if (source) env.TOOLSENABLED_SOURCE = source
  const result = spawnSync(process.execPath, [TOOL, staged], { encoding: 'utf8', env, windowsHide: true })
  return { code: result.status, out: `${result.stdout}${result.stderr}` }
}

function withScaffold(body) {
  const made = scaffold()
  try { body(made) } finally { rmSync(made.base, { recursive: true, force: true }) }
}

/* ---------- the ordinary case ---------- */

test('a payload matching its source passes', () => {
  withScaffold(({ source, staged }) => {
    const { code, out } = run(staged, source)
    assert.equal(code, 0, `a current payload was refused: ${out}`)
    assert.match(out, /is current/, 'a passing run must say what it verified, not just exit 0')
  })
})

/* ---------- the defect it exists for ---------- */

test('one stale file is refused and NAMED', () => {
  withScaffold(({ source, staged }) => {
    // The real incident's shape: the source moved on, the payload did not.
    put(source, 'src/lib/providers/scrub.js', '// the scrub, now case-insensitive\n')

    const { code, out } = run(staged, source)
    assert.equal(code, 1, 'a stale payload was accepted')
    assert.match(out, /src\/lib\/providers\/scrub\.js/,
      'the refusal must name the stale file; a count tells nobody what to re-stage')
    assert.doesNotMatch(out, /src\/lib\/thing\.js/,
      'files that DID match must not be listed, or the real one is lost in noise')
  })
})

/* ---------- the substituted files are verified, not skipped ---------- */

// This is the assertion most likely to be quietly removed by someone "fixing" a
// false positive, and it guards the two files most likely to carry owner data.
test('a neutral-default that drifts from capability-defaults is still caught', () => {
  withScaffold(({ source, staged }) => {
    put(staged, NEUTRAL[0], '{"neutral":false,"leaked":"something"}\n')

    const { code, out } = run(staged, source)
    assert.equal(code, 1, 'a substituted config was skipped rather than verified')
    assert.match(out, new RegExp(NEUTRAL[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      'the refusal must name the drifted neutral default')
  })
})

/* ---------- unknown is not current ---------- */

test('an unresolvable source tree is refused, not reported clean', () => {
  withScaffold(({ base, staged }) => {
    const { code, out } = run(staged, path.join(base, 'no-such-tree'))
    assert.equal(code, 1, 'a payload that could not be compared against anything was accepted')
    assert.match(out, /not configured|Refusing/i, 'the refusal must say it could not compare, not imply a mismatch')
  })
})

test('a staged directory with no PAYLOAD.json cannot state what it is', () => {
  withScaffold(({ source, staged }) => {
    rmSync(path.join(staged, 'PAYLOAD.json'))
    assert.equal(run(staged, source).code, 1, 'a directory that cannot describe itself was accepted')
  })
})

test('a staged file with no counterpart at all is refused', () => {
  withScaffold(({ source, staged }) => {
    put(staged, 'src/lib/orphan.js', '// in the payload, in no source tree\n')
    const { code, out } = run(staged, source)
    assert.equal(code, 1, 'a staged file nothing can vouch for was accepted')
    assert.match(out, /orphan\.js/, 'the orphan must be named')
  })
})
