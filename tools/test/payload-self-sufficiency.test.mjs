/* The packer's three new refusals, exercised in isolation.
 *
 * Each assertion below names the exact rule it protects, because these guards
 * all fail the build with the same coarse outcome (a thrown Error) and a shared
 * message would let a mutant that broke the vault rule die looking like one that
 * broke the extension rule. */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  HELPER_PROGRAM_EXTENSIONS,
  assertHelperProgramsAreExecutable,
  assertNoSecretMaterial,
  computePowerShellClosure,
} from '../pack-capability-layer.mjs'

async function temporaryTree(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'pack-guard-'))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10 }))
  return root
}

test('S1 - the vault CONTENTS are refused while the vault SCRIPT is allowed', () => {
  assert.doesNotThrow(
    () => assertNoSecretMaterial(['tools/secrets.ps1', 'tools/owner-prompt-theme.ps1', 'config/model-floor.json']),
    'tools/secrets.ps1 is a program and must be stageable; refusing it would re-break the installer this guard exists to fix',
  )

  assert.throws(
    () => assertNoSecretMaterial(['tools/secrets.ps1', 'vault/secrets.json']),
    (error) => {
      assert.match(error.message, /vault\/secrets\.json/, 'the offending path must be named')
      assert.match(error.message, /under vault\//, 'the reason must say which rule refused it')
      return true
    },
    'vault/secrets.json must never be stageable: shipping it hands every customer the builder credentials',
  )
})

test('S2 - runtime state and other credential-shaped paths are refused whatever list named them', () => {
  const refused = [
    ['state/mission-bridge-token.json', /under state\//],
    ['private/capability-source.owner.json', /under private\//],
    ['reports/OWNER-REQUEST-LEDGER.json', /under reports\//],
    ['config/auth.json', /named auth\.json/],
    ['certs/server.pem', /\.pem file/],
    ['state/audit.sqlite3', /under state\//],
  ]
  for (const [candidate, reason] of refused) {
    assert.throws(
      () => assertNoSecretMaterial([candidate]),
      (error) => {
        assert.match(error.message, reason, `${candidate} must be refused for the stated reason, not incidentally`)
        return true
      },
      `${candidate} must be refused by assertNoSecretMaterial`,
    )
  }
})

test('S3 - a helperPrograms entry that is not an executable helper is refused', () => {
  assert.doesNotThrow(
    () => assertHelperProgramsAreExecutable(['tools/secrets.ps1', 'tools/playwright-mcp.cmd', 'research/extract.py']),
    'the three helper kinds this payload actually ships must all be accepted',
  )

  assert.throws(
    () => assertHelperProgramsAreExecutable(['config/settings-registry.json']),
    (error) => {
      assert.match(error.message, /config\/settings-registry\.json/)
      assert.match(error.message, /dataFiles/, 'the refusal must point at the category the file does belong in')
      return true
    },
    'JSON must not be smuggled through helperPrograms, where the data-file rules would not apply to it',
  )

  assert.throws(
    () => assertHelperProgramsAreExecutable(['src/job-runner.js']),
    (error) => {
      assert.match(error.message, /spawnedPrograms/, 'JavaScript must be redirected to the list whose closure is walked')
      return true
    },
    'JavaScript in helperPrograms would be copied without walking its require() graph',
  )

  assert.ok(HELPER_PROGRAM_EXTENSIONS.has('.ps1'), 'PowerShell must remain an accepted helper kind')
})

test('S4 - the PowerShell closure follows a dot-source written as Join-Path $PSScriptRoot', async (t) => {
  const root = await temporaryTree(t)
  await mkdir(path.join(root, 'tools'), { recursive: true })
  // The exact spelling secrets.ps1 uses at line 736. A walk that matched only
  // `$PSScriptRoot\name` reported a clean pack over this file.
  await writeFile(
    path.join(root, 'tools', 'seed.ps1'),
    ". (Join-Path $PSScriptRoot 'theme.ps1')\n",
  )
  await writeFile(path.join(root, 'tools', 'theme.ps1'), '# shared theme\n')

  const closure = computePowerShellClosure(root, ['tools/seed.ps1'])
  assert.deepEqual(closure.unresolved, [], 'a dot-source that exists on disk must not be reported unresolved')
  assert.deepEqual(
    closure.files,
    ['tools/seed.ps1', 'tools/theme.ps1'],
    'Join-Path $PSScriptRoot dot-sourcing must be followed, or the vault ships without the file it dot-sources',
  )
})

test('S5 - the PowerShell closure also follows the $PSScriptRoot\\name form, and transitively', async (t) => {
  const root = await temporaryTree(t)
  await mkdir(path.join(root, 'tools'), { recursive: true })
  await writeFile(path.join(root, 'tools', 'seed.ps1'), '. "$PSScriptRoot\\middle.ps1"\n')
  await writeFile(path.join(root, 'tools', 'middle.ps1'), ". (Join-Path $PSScriptRoot 'leaf.ps1')\n")
  await writeFile(path.join(root, 'tools', 'leaf.ps1'), '# leaf\n')

  const closure = computePowerShellClosure(root, ['tools/seed.ps1'])
  assert.deepEqual(
    closure.files,
    ['tools/leaf.ps1', 'tools/middle.ps1', 'tools/seed.ps1'],
    'the PowerShell walk must be transitive; a helper two dot-sources deep is as absent as one',
  )
})

test('S6 - a dot-source that does not exist is reported, never silently dropped', async (t) => {
  const root = await temporaryTree(t)
  await mkdir(path.join(root, 'tools'), { recursive: true })
  await writeFile(path.join(root, 'tools', 'seed.ps1'), ". (Join-Path $PSScriptRoot 'absent.ps1')\n")

  const closure = computePowerShellClosure(root, ['tools/seed.ps1'])
  assert.deepEqual(
    closure.unresolved,
    [{ from: 'tools/seed.ps1', spec: 'tools/absent.ps1' }],
    'an unresolvable dot-source must fail the pack, not ship a helper that throws CommandNotFoundException',
  )
})

test('S7 - non-PowerShell helpers are carried without being walked', async (t) => {
  const root = await temporaryTree(t)
  await mkdir(path.join(root, 'tools'), { recursive: true })
  await writeFile(path.join(root, 'tools', 'shim.cmd'), '@echo off\n')

  const closure = computePowerShellClosure(root, ['tools/shim.cmd', 'research/extract.py'])
  assert.deepEqual(closure.files, [], 'a .cmd or .py has no dot-source graph to walk and must not be treated as a seed')
  assert.deepEqual(closure.unresolved, [], 'skipping a non-PowerShell helper is not an unresolved reference')
})
