import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import { PROJECT_ROOT, assertValidProjection } from '../gen-projection-lib.mjs'

const FIXED_NOW = '2026-08-07T18:00:00.000Z'
const FIXED_MTIME = new Date('2026-08-06T12:00:00.000Z')
const SAFE_PATHS = Object.freeze([
  'TOOLSENABLED-MACHINE-B-STATUS-REPORT-2026-08-01.md',
  'ToolsEnabled-COORDINATOR-AUDIT-2026-08-04.md',
  'ToolsEnabled-FULL-AUDIT-2026-08-03.md',
  'ToolsEnabled-Issues-Report-2026-08-04.md',
  'ToolsEnabled-PLAN-AUDIT-2026-08-04.md',
  'ToolsEnabled-Report-Corpus-Research-Audit-2026-08-06.md',
  'HANDOFF.md',
])
const FLAGGED_PATHS = Object.freeze([
  'currentWork86/AI-Research-Initiatives-Full-Corpus-Audit-2026-08-06.md',
  'currentWork86/LLMBenchmarking-current-iteration-report.md',
  'currentWork86/Cerberus-research-extension-report.md',
  'LEAN-BENCH-AUDIT.md',
  'LEAN-BENCH-AUDIT.html',
  'LEAN-BENCH-AUDIT.pdf',
  'currentWork86/ToolsEnabled-current-iteration-report.md',
])
const FLAGGED_SENTINEL = 'FLAGGED-CONTENT-MUST-NOT-APPEAR'

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, 'utf8')
  utimesSync(path, FIXED_MTIME, FIXED_MTIME)
}

function seedResearchRoot(root) {
  SAFE_PATHS.forEach((relativePath, index) => {
    write(join(root, relativePath), `# Fixture safe report ${index + 1}\n\nA bounded ToolsEnabled fixture.\n`)
  })
  FLAGGED_PATHS.forEach(relativePath => {
    write(join(root, relativePath), `${FLAGGED_SENTINEL}\nLLMBenchmarking fixture content\n`)
  })
}

function runGenerator({ outputRoot, researchRoot }) {
  return spawnSync(process.execPath, [join(PROJECT_ROOT, 'tools', 'gen-research.mjs')], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      MC_NOW: FIXED_NOW,
      MC_OUTPUT_ROOT: outputRoot,
      MC_RESEARCH_ROOT: researchRoot,
    },
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  })
}

function readOutput(root) {
  return JSON.parse(readFileSync(join(root, 'research.json'), 'utf8'))
}

test('missing report emits a valid unavailable research payload', t => {
  const fixture = mkdtempSync(join(tmpdir(), 'mc-research-missing-'))
  t.after(() => rmSync(fixture, { recursive: true, force: true }))
  const researchRoot = join(fixture, 'reports')
  const outputRoot = join(fixture, 'output')
  seedResearchRoot(researchRoot)
  rmSync(join(researchRoot, SAFE_PATHS[0]))

  const run = runGenerator({ outputRoot, researchRoot })
  assert.equal(run.status, 0, run.stderr)
  const payload = readOutput(outputRoot)
  assert.equal(payload.ok, false)
  assert.equal(payload.reason, 'source-missing')
  assert.equal(payload.data, null)
  assert.doesNotThrow(() => assertValidProjection('research', payload))
})

test('malformed safe report emits source-malformed without a throw', t => {
  const fixture = mkdtempSync(join(tmpdir(), 'mc-research-malformed-'))
  t.after(() => rmSync(fixture, { recursive: true, force: true }))
  const researchRoot = join(fixture, 'reports')
  const outputRoot = join(fixture, 'output')
  seedResearchRoot(researchRoot)
  write(join(researchRoot, SAFE_PATHS[0]), 'This source has no Markdown title.\n')

  const run = runGenerator({ outputRoot, researchRoot })
  assert.equal(run.status, 0, run.stderr)
  const payload = readOutput(outputRoot)
  assert.equal(payload.ok, false)
  assert.equal(payload.reason, 'source-malformed')
  assert.doesNotThrow(() => assertValidProjection('research', payload))
})

test('research generator is byte-idempotent and keeps flagged content metadata-only', t => {
  const fixture = mkdtempSync(join(tmpdir(), 'mc-research-idempotent-'))
  t.after(() => rmSync(fixture, { recursive: true, force: true }))
  const researchRoot = join(fixture, 'reports')
  const outputRoot = join(fixture, 'output')
  seedResearchRoot(researchRoot)

  const first = runGenerator({ outputRoot, researchRoot })
  assert.equal(first.status, 0, first.stderr)
  const before = readFileSync(join(outputRoot, 'research.json'), 'utf8')
  const second = runGenerator({ outputRoot, researchRoot })
  assert.equal(second.status, 0, second.stderr)
  const after = readFileSync(join(outputRoot, 'research.json'), 'utf8')
  assert.equal(after, before)

  const payload = JSON.parse(after)
  assert.equal(payload.ok, true)
  assert.doesNotThrow(() => assertValidProjection('research', payload))
  assert.equal(payload.data.ownerScope, 'local-owner')
  assert.deepEqual(payload.data.findingsRegister.value, [])
  assert.equal(payload.data.failureTaxonomy.ok, false)
  assert.equal(payload.data.openQuestions.ok, false)

  const entries = payload.data.corpusCatalog.value
  const safe = entries.filter(entry => !Object.hasOwn(entry, 'needsOwnerAuthorization'))
  const flagged = entries.filter(entry => entry.needsOwnerAuthorization === true)
  assert.equal(safe.length, 7)
  assert.equal(flagged.length, 7)
  assert.ok(entries.every(entry => entry.ownerScope === 'local-owner'))
  assert.ok(safe.every(entry => typeof entry.summary === 'string' && entry.summary.length > 0))
  assert.ok(flagged.every(entry => !Object.hasOwn(entry, 'summary') && typeof entry.authorizationReason === 'string'))
  assert.equal(after.includes(FLAGGED_SENTINEL), false)
})
