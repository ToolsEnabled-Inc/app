// THE PACKER MUST NOT DELETE ITS OWN DESTINATION ROOT.
//
// Measured on Windows, 2026-08-11: with a `codex exec --cd <this tree>` process
// running, `rmdir(capability)` fails EBUSY -- but removing all eight children
// individually SUCCEEDS, leaving the root in place and empty. The lock is on the
// directory OBJECT, not on its contents. Any agent working in this tree, any
// editor with the folder open, any shell whose cwd is inside it takes that lock,
// so `npm run dist` failed before writing a byte for reasons that had nothing to
// do with the build.
//
// "Empty the directory, keep the directory" reaches an identical end state and is
// immune to the lock. This test pins that, and it pins it BEHAVIOURALLY: a source
// scan for `rmSync(out` would pass against dead code just as happily as live code.
// birthtime is the evidence -- if the packer ever recreates the root, the
// directory object is new and its creation timestamp moves.

import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const PACKER = path.join(REPO, 'tools', 'pack-capability-layer.mjs')

async function pack(out) {
  return run(process.execPath, [PACKER, '--out', out, '--quiet'], { cwd: REPO, maxBuffer: 64 * 1024 * 1024 })
}

test('the destination root survives -- it is emptied, never recreated', async () => {
  const out = path.join(mkdtempSync(path.join(tmpdir(), 'pack-reuse-')), 'capability')
  try {
    mkdirSync(out, { recursive: true })
    const before = statSync(out).birthtimeMs

    await pack(out)
    const after = statSync(out).birthtimeMs

    assert.equal(
      after,
      before,
      'the destination directory was recreated -- its birthtime moved. A recreate needs rmdir on the ' +
        'root, which fails EBUSY whenever anything holds that directory open, and the build dies there.',
    )
  } finally {
    rmSync(path.dirname(out), { recursive: true, force: true })
  }
})

test('a stale file left in the destination does not survive the next stage', async () => {
  const out = path.join(mkdtempSync(path.join(tmpdir(), 'pack-stale-')), 'capability')
  try {
    mkdirSync(path.join(out, 'nested'), { recursive: true })
    const loose = path.join(out, 'REMOVED-FROM-THE-PAYLOAD.js')
    const nested = path.join(out, 'nested', 'also-gone.js')
    writeFileSync(loose, '// a file a previous cut staged and this one must not\n')
    writeFileSync(nested, '// same, one level down\n')

    await pack(out)

    assert.ok(!existsSync(loose), 'a stale file at the top level was carried into the new stage')
    assert.ok(!existsSync(nested), 'a stale nested directory was carried into the new stage')
    assert.ok(readdirSync(out).length > 0, 'the packer emptied the destination and then staged nothing')
  } finally {
    rmSync(path.dirname(out), { recursive: true, force: true })
  }
})
