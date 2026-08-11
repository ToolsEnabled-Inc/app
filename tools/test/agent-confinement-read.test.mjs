/* The confinement reading, and the copy it produces.
 *
 * WHAT THIS SUITE IS FOR. The agent page carried a sentence that went false when
 * tier confinement landed underneath it. Replacing it with a better sentence
 * would only reset the fuse, so the sentence is now COMPUTED from a reading of
 * this install. This suite exists to keep both halves honest:
 *
 *   1. the reading matches what the REAL confinement module does, and
 *   2. the copy never renders a claim the reading did not support.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not assert that a source file
 * contains a string. A copy test written against source text passes when the
 * table is right and the lookup is wrong -- the same shape of defect as an
 * availability check nothing reads -- so every assertion below runs the real
 * function and reads its real return value.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import {
  confinementNote,
  toolsSentence,
  SANDBOX_EFFECT,
  RECORD_CLAUSE,
  FAIL_CLOSED_CLAUSE,
  UNKNOWN_CONFINEMENT,
} from '../../src/agent-confinement-copy.js'

const require_ = createRequire(import.meta.url)
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const PAYLOAD = path.join(REPO, 'capability')

const confinement = require_(path.join(PAYLOAD, 'src', 'lib', 'agent-session-confinement.js'))
const machineRecord = require_(path.join(PAYLOAD, 'src', 'lib', 'setup', 'machine-record.js'))
const { readAgentConfinement, resetToolCountsCache } = require_(path.join(REPO, 'shell', 'agent-confinement-read.cjs'))

/** A services root with a real, valid machine record at `tier`. */
function stageRecord(scratch, tier) {
  const servicesRoot = path.join(scratch, `svc-${tier}`)
  const workspace = path.join(scratch, `ws-${tier}`)
  mkdirSync(servicesRoot, { recursive: true })
  mkdirSync(workspace, { recursive: true })
  const record = machineRecord.buildMachineRecord({
    tier,
    servicesRoot,
    installRoot: PAYLOAD,
    nodePath: process.execPath,
    workspaceRoots: [workspace],
  })
  machineRecord.writeMachineRecord(record, { servicesRoot })
  return servicesRoot
}

/* ---------------------------------------------------------------------------
   THE MEASUREMENT THE WHOLE REPAIR RESTS ON.

   If this ever goes green with one sandbox word for every tier, the page is
   back to describing a product that does not confine anything.
   --------------------------------------------------------------------------- */
test('each recorded level resolves to its OWN sandbox, and the tier is the only variable', () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'mc-conf-tier-'))
  try {
    const seen = {}
    for (const tier of ['guided', 'standard', 'unrestricted']) {
      const resolved = confinement.resolveAgentConfinement({ servicesRoot: stageRecord(scratch, tier) })
      seen[tier] = resolved.sandbox
      assert.equal(resolved.tier, tier, `${tier} must resolve as itself`)
      assert.equal(resolved.recorded, true)
      assert.equal(resolved.failedClosed, false)
    }
    assert.deepEqual(seen, {
      guided: 'read-only',
      standard: 'workspace-write',
      unrestricted: 'danger-full-access',
    })
    assert.equal(new Set(Object.values(seen)).size, 3, 'three levels must not collapse to one confinement')
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})

test('an absent record fails CLOSED to the most restrictive level, not open', () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'mc-conf-absent-'))
  try {
    const resolved = confinement.resolveAgentConfinement({ servicesRoot: path.join(scratch, 'never-written') })
    assert.equal(resolved.tier, 'guided')
    assert.equal(resolved.sandbox, 'read-only')
    assert.equal(resolved.failedClosed, true)
    assert.notEqual(resolved.sandbox, 'danger-full-access',
      'a machine that has never been set up must not run an agent unconfined')
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})

/* ---------------------------------------------------------------------------
   THE SIGN-IN PRECONDITION, pinned against the module rather than assumed.

   shell/agent-confinement-read.cjs checks for `auth.json` in the user's Codex
   home WITHOUT running prepareConfinedCodexHome(), because that function is not
   a read. This test runs the real one both ways, so if the module ever looks for
   a different credential the coupling breaks HERE instead of the page quietly
   promising a start that will refuse.
   --------------------------------------------------------------------------- */
test('a confined level with no Codex credential refuses, and names why', () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'mc-conf-signin-'))
  try {
    const servicesRoot = stageRecord(scratch, 'guided')
    const emptyHome = path.join(scratch, 'codex-empty')
    mkdirSync(emptyHome, { recursive: true })

    const refused = confinement.confinedSessionPlan({ servicesRoot, userCodexHome: emptyHome })
    assert.equal(refused.ok, false, 'a confined level with no sign-in must not start')
    assert.equal(refused.code, 'AGENT_CONFINEMENT_SIGNED_OUT')

    const signedIn = path.join(scratch, 'codex-signed-in')
    mkdirSync(signedIn, { recursive: true })
    writeFileSync(path.join(signedIn, 'auth.json'), '{"probe":"not-a-credential"}')
    const allowed = confinement.confinedSessionPlan({ servicesRoot, userCodexHome: signedIn })
    assert.equal(allowed.ok, true, 'the credential is the only variable between these two')
    assert.equal(allowed.code, 'AGENT_CONFINEMENT_RESOLVED')

    assert.equal(existsSync(path.join(signedIn, 'auth.json')), true)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})

test('the reading reports the recorded level, its sandbox, and a measured tool count', () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'mc-conf-read-'))
  try {
    resetToolCountsCache()
    const reading = readAgentConfinement({
      capabilityRoot: PAYLOAD,
      servicesRoot: stageRecord(scratch, 'guided'),
    })
    assert.equal(reading.ok, true)
    assert.equal(reading.tier, 'guided')
    assert.equal(reading.sandbox, 'read-only')
    assert.equal(reading.isolated, true)
    assert.equal(Number.isInteger(reading.toolsTotal), true, 'the total must be measured, not guessed')
    assert.equal(Number.isInteger(reading.toolsAllowed), true)
    assert.ok(reading.toolsAllowed < reading.toolsTotal,
      'a confining level must be offered fewer tools than the whole surface')

    const unrestricted = readAgentConfinement({
      capabilityRoot: PAYLOAD,
      servicesRoot: stageRecord(scratch, 'unrestricted'),
    })
    assert.equal(unrestricted.toolsAllowed, null,
      'a level that narrows nothing has no allowlist, and null is that fact rather than a missing value')
    assert.equal(unrestricted.isolated, false)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})

test('the reading carries no filesystem path, at any tier and on failure', () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'mc-conf-nopath-'))
  try {
    const readings = [
      readAgentConfinement({ capabilityRoot: PAYLOAD, servicesRoot: stageRecord(scratch, 'standard') }),
      readAgentConfinement({ capabilityRoot: path.join(scratch, 'no-payload-here') }),
      readAgentConfinement({}),
    ]
    for (const reading of readings) {
      const serialized = JSON.stringify(reading)
      assert.equal(/[A-Za-z]:\\|\/Users\/|\/tmp\//.test(serialized), false,
        `a reply rendered into the DOM must name no path: ${serialized}`)
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})

/* ---------------------------------------------------------------------------
   THE COPY. Every assertion is on the SENTENCES a reading produces.
   --------------------------------------------------------------------------- */
test('the retired claim is not reachable from ANY reading', () => {
  const readings = [
    null,
    undefined,
    { ok: false, code: 'AGENT_CONFINEMENT_UNAVAILABLE' },
    { ok: true, tier: 'guided', sandbox: 'read-only', failedClosed: false, toolsAllowed: 109, toolsTotal: 265 },
    { ok: true, tier: 'standard', sandbox: 'workspace-write', failedClosed: false, toolsAllowed: 256, toolsTotal: 265 },
    { ok: true, tier: 'unrestricted', sandbox: 'danger-full-access', failedClosed: false, toolsAllowed: null, toolsTotal: 265 },
    { ok: true, tier: 'guided', sandbox: 'read-only', failedClosed: true, toolsAllowed: 109, toolsTotal: 265 },
    { ok: true, tier: 'guided', sandbox: 'a-word-this-renderer-has-never-heard-of' },
  ]
  for (const reading of readings) {
    const text = confinementNote(reading).sentences.join(' ')
    assert.equal(/No permission tier limits a running session/i.test(text), false,
      `the false clause must be unreachable, but this reading produced: ${text}`)
  }
})

test('a confining level never claims full local access, and unrestricted never claims to be confined', () => {
  const guided = confinementNote({ ok: true, tier: 'guided', sandbox: 'read-only', failedClosed: false }).sentences.join(' ')
  assert.match(guided, /Guided/)
  assert.equal(guided.includes(SANDBOX_EFFECT['read-only']), true)
  assert.equal(/full local access/i.test(guided), false)

  const standard = confinementNote({ ok: true, tier: 'standard', sandbox: 'workspace-write', failedClosed: false }).sentences.join(' ')
  assert.equal(standard.includes(SANDBOX_EFFECT['workspace-write']), true)
  assert.equal(/full local access/i.test(standard), false)

  /* The blunt end. A person at unrestricted must not be softened at. */
  const open = confinementNote({ ok: true, tier: 'unrestricted', sandbox: 'danger-full-access', failedClosed: false }).sentences.join(' ')
  assert.equal(open.includes(SANDBOX_EFFECT['danger-full-access']), true)
  assert.match(open, /delete any file/i)
})

test('every reading keeps the one clause that is still true', () => {
  for (const reading of [
    null,
    { ok: true, tier: 'guided', sandbox: 'read-only' },
    { ok: true, tier: 'unrestricted', sandbox: 'danger-full-access' },
    { ok: false, code: 'AGENT_CONFINEMENT_UNAVAILABLE' },
  ]) {
    assert.equal(confinementNote(reading).sentences.includes(RECORD_CLAUSE), true)
  }
})

test('an unreadable level says so instead of guessing', () => {
  for (const reading of [null, undefined, {}, [], { ok: false, code: 'X' }, { ok: true, tier: 'nonsense' }]) {
    const note = confinementNote(reading)
    assert.equal(note.sentences.includes(UNKNOWN_CONFINEMENT), true,
      `an unusable reading must state the absence: ${JSON.stringify(reading)}`)
  }
})

test('a level that could not be read announces that it failed closed', () => {
  const note = confinementNote({ ok: true, tier: 'guided', sandbox: 'read-only', failedClosed: true })
  assert.equal(note.sentences.includes(FAIL_CLOSED_CLAUSE), true)
})

test('the tools sentence is dropped rather than invented when nothing was measured', () => {
  assert.equal(toolsSentence({ allowed: null, total: null }), null)
  assert.equal(toolsSentence({ allowed: 5, total: 0 }), null)
  assert.equal(toolsSentence({ allowed: 400, total: 265 }), null, 'more allowed than exist is not a sentence')
  assert.equal(toolsSentence({ allowed: null, total: 265 }), "It is offered all 265 of this copy's tools.")
  assert.equal(toolsSentence({ allowed: 109, total: 265 }), "It is offered 109 of this copy's 265 tools.")
})

/* NO COUNT IS WRITTEN DOWN IN THE SHIPPED COPY. The numbers differ per payload
   -- this checkout answers 265 total, release/win-unpacked answers 305 -- so a
   literal in the copy module would be true of one install and false of another,
   which is precisely how the sentence being repaired here died. */
test('the copy module hardcodes no tool count', () => {
  const source = require_('node:fs').readFileSync(path.join(REPO, 'src', 'agent-confinement-copy.js'), 'utf8')
  const body = source.replace(/\/\*[\s\S]*?\*\//g, '')
  assert.equal(/\b(109|116|256|265|296|298|305)\b/.test(body), false,
    'a tool count in the shipped copy is a measurement with an expiry date')
})
