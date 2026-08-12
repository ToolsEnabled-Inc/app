// THE OTHER ROAD TO THE PUBLIC.
//
// tools/check-payload-boundary.mjs guards the installer payload. The owner's
// ruling is that people may take either road -- download the installer, or take
// the source from GitHub -- and that only the free part travels either one.
// `git push` to a public remote publishes exactly the modules the payload gate
// exists to hold back, and never touches resources/capability on the way.
//
// These tests pin `--source`, and three of them are about the failure the mode
// was written for rather than the happy path:
//
//   * A repository whose TIP is spotless while its HISTORY still carries a paid
//     module must be REFUSED. A gate that reads only the working tree reports
//     "clean" about the one copy that does not matter -- deleting a file in a
//     new commit leaves every earlier commit intact, and `git show <old>:<path>`
//     reads it straight back out. That test builds exactly that repository.
//
//   * `pending` must REFUSE here, where the payload mode tolerates it. The two
//     verdicts differ on purpose and the difference is easy to "fix" wrongly.
//
//   * Untracked files must be IGNORED and tracked-but-deleted files must still
//     COUNT, because the publish set is what git tracks, not what is on disk.
//     A filesystem walk gets both of these backwards.

import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const GATE = path.join(REPO, 'tools', 'check-payload-boundary.mjs')
const MANIFEST = path.join(REPO, 'config', 'payload-boundary.json')

// Run the gate and return BOTH streams and the real exit code. Never read an
// exit code through a pipe: `node gate.mjs | tail` reports tail's status, which
// is how a broken run reads as a pass.
function gate(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [GATE, ...args], { cwd: REPO, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => resolve({ code: error?.code ?? 0, out: `${stdout}${stderr}` }))
  })
}

function run(cwd, ...args) {
  execFileSync('git', ['-C', cwd, ...args], { stdio: 'ignore' })
}

// A throwaway git repository. Identity and hooks are set locally so the test
// cannot depend on -- or be broken by -- the machine's global git config, and
// so a repo hook from this project never fires on a fixture commit.
function repository() {
  const dir = mkdtempSync(path.join(tmpdir(), 'boundary-source-'))
  run(dir, 'init', '--quiet', '--initial-branch', 'main')
  run(dir, 'config', 'user.email', 'fixture@example.invalid')
  run(dir, 'config', 'user.name', 'Boundary Fixture')
  run(dir, 'config', 'core.hooksPath', path.join(dir, '.no-hooks'))
  run(dir, 'config', 'commit.gpgsign', 'false')
  return dir
}

function write(dir, relative, body) {
  mkdirSync(path.join(dir, path.dirname(relative)), { recursive: true })
  writeFileSync(path.join(dir, relative), body)
}

function commit(dir, message) {
  run(dir, 'add', '-A')
  run(dir, 'commit', '--quiet', '--no-verify', '-m', message)
}

// A manifest written for the test. The live one is deliberately NOT used for
// the pass/fail fixtures: its `pending` block is legitimately empty and its open
// list names 250-odd real paths, so a fixture built against it would go red the
// next time either changed, with nothing about the gate having moved. The live
// manifest is still exercised by the last test in this file, which is where a
// real drift should surface.
function fixtureManifest(dir, { pending = {}, open = [], paid = [], excluded = [] } = {}) {
  const file = path.join(path.dirname(dir), `${path.basename(dir)}-manifest.json`)
  writeFileSync(file, `${JSON.stringify({
    schemaVersion: 1,
    status: 'proposed',
    excluded: { paths: excluded, prefixes: [] },
    paid: { paths: paid, prefixes: [] },
    pending,
    open: { paths: ['README.md', ...open] },
  }, null, 2)}\n`)
  return file
}

test('a fully classified repository with clean history passes', async () => {
  const dir = repository()
  try {
    write(dir, 'README.md', '# open\n')
    commit(dir, 'open only')
    const manifest = fixtureManifest(dir)

    const result = await gate(['--source', dir, '--manifest', manifest])
    assert.equal(result.code, 0, `a wholly-open repository must publish:\n${result.out}`)
    assert.match(result.out, /clean/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a paid module tracked at the tip refuses the publish', async () => {
  const dir = repository()
  try {
    write(dir, 'README.md', '# open\n')
    write(dir, 'src/lib/entitlement.js', '// the commercial tier table\n')
    commit(dir, 'paid module present')
    const manifest = fixtureManifest(dir, { paid: ['src/lib/entitlement.js'] })

    const result = await gate(['--source', dir, '--manifest', manifest])
    assert.equal(result.code, 1, `a paid module in the tree must refuse:\n${result.out}`)
    assert.match(result.out, /SOURCE PUBLISH REFUSED/)
    assert.match(result.out, /src\/lib\/entitlement\.js/, 'the refusal must NAME the file that caused it')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a SPOTLESS TIP over a paid HISTORY is still refused, and says which', async () => {
  // THE TEST THIS MODE EXISTS FOR. Removing a paid module from the tip does not
  // remove it from the repository: the earlier commit is still reachable and
  // still hands the file to every clone. A working-tree-only gate calls this
  // repository clean, which is worse than having no gate -- it is a documented
  // green light over a live leak.
  const dir = repository()
  try {
    write(dir, 'README.md', '# open\n')
    write(dir, 'src/lib/entitlement.js', '// the commercial tier table, with prices\n')
    commit(dir, 'the mistake')

    rmSync(path.join(dir, 'src/lib/entitlement.js'))
    commit(dir, 'the fix that is not a fix')

    const manifest = fixtureManifest(dir, { paid: ['src/lib/entitlement.js'] })

    // Precondition, so a passing test cannot be an accident of the fixture: the
    // file really is gone from the tip, and really is still readable from the
    // parent commit.
    const tracked = execFileSync('git', ['-C', dir, 'ls-files'], { encoding: 'utf8' })
    assert.doesNotMatch(tracked, /entitlement\.js/, 'fixture is wrong: the file is still tracked at the tip')
    const historical = execFileSync('git', ['-C', dir, 'show', 'HEAD~1:src/lib/entitlement.js'], { encoding: 'utf8' })
    assert.match(historical, /with prices/, 'fixture is wrong: the file is not retrievable from history')

    const result = await gate(['--source', dir, '--manifest', manifest])
    assert.equal(result.code, 1, `history alone must refuse the publish:\n${result.out}`)
    assert.match(result.out, /GIT HISTORY/, 'the history finding was not reported')
    assert.match(result.out, /src\/lib\/entitlement\.js/, 'the history finding must NAME the module')
    assert.match(result.out, /HISTORY ONLY/, 'a tip-absent module must be marked as the tip-invisible kind')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an unclassified tracked file refuses the publish', async () => {
  // Rule 2, carried across to the source road. A repository whose publishable
  // set has never been classified must not be publishable by silence.
  const dir = repository()
  try {
    write(dir, 'README.md', '# open\n')
    write(dir, 'src/lib/whatever-someone-adds-next.js', '// named nowhere\n')
    commit(dir, 'an unclassified arrival')
    const manifest = fixtureManifest(dir)

    const result = await gate(['--source', dir, '--manifest', manifest])
    assert.equal(result.code, 1, `an unknown file must refuse:\n${result.out}`)
    assert.match(result.out, /UNCLASSIFIED/)
    assert.match(result.out, /whatever-someone-adds-next\.js/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('pending REFUSES a source publish, where the payload verdict tolerates it', async () => {
  // The two verdicts differ on purpose. pending means "the owner has ruled and
  // the removal has not landed"; the payload mode stays green so ordinary dev
  // builds are not blocked by it. There is no dev build in a publish question,
  // and publishing is the exact event a pending file is waiting to be removed
  // before -- so this mode is strict by construction, not by a flag someone has
  // to remember.
  const dir = repository()
  try {
    write(dir, 'README.md', '# open\n')
    write(dir, 'src/lib/still-here.js', '// decided, not yet removed\n')
    commit(dir, 'a pending file')
    const manifest = fixtureManifest(dir, {
      pending: { 'src/lib/still-here.js': 'owner-ruled paid, decoupling work not landed' },
    })

    const result = await gate(['--source', dir, '--manifest', manifest])
    assert.equal(result.code, 1, `a pending file must refuse a SOURCE publish:\n${result.out}`)
    assert.match(result.out, /PENDING/)
    assert.match(result.out, /still-here\.js/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the publish set is what git TRACKS, not what is on disk', async () => {
  // Both directions in one repository, because getting either backwards is a
  // wrong verdict and a filesystem walk gets BOTH backwards:
  //
  //   untracked-build-output.js  is on disk and is NOT published. A walk would
  //                              indict it and send someone classifying build
  //                              artefacts -- the noise that gets gates ignored.
  //   src/lib/entitlement.js     is deleted from disk and IS still published,
  //                              because it is still in the index. A walk would
  //                              miss the one file that actually leaks.
  const dir = repository()
  try {
    write(dir, 'README.md', '# open\n')
    write(dir, 'src/lib/entitlement.js', '// the tier table\n')
    commit(dir, 'baseline')

    write(dir, 'untracked-build-output.js', '// never committed\n')
    rmSync(path.join(dir, 'src/lib/entitlement.js'))

    const manifest = fixtureManifest(dir, { paid: ['src/lib/entitlement.js'] })
    const result = await gate(['--source', dir, '--manifest', manifest])

    assert.equal(result.code, 1, `a tracked-but-deleted paid module must still refuse:\n${result.out}`)
    assert.match(result.out, /src\/lib\/entitlement\.js/, 'a tracked file deleted from disk is still published')
    assert.doesNotMatch(result.out, /untracked-build-output\.js/, 'an untracked file is not published and must not be reported')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a directory that is not a git repository is a guard error, never a pass', async () => {
  // The absence-as-emptiness trap, in the place it would cost the most: a plain
  // directory yields no history at all, and "no paid module is in history" is
  // the most dangerous sentence this program could print about it.
  const dir = mkdtempSync(path.join(tmpdir(), 'boundary-source-plain-'))
  try {
    writeFileSync(path.join(dir, 'README.md'), '# not a repo\n')
    const result = await gate(['--source', dir, '--manifest', MANIFEST])
    assert.equal(result.code, 2, `a non-repository must be a guard error:\n${result.out}`)
    assert.doesNotMatch(result.out, /clean/, 'a non-repository must never produce a clean verdict')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--source refuses to be combined with a payload run or with --ship', async () => {
  // Each combination LOOKS like it asks two questions and can only answer one.
  // The half that goes unanswered is exactly the half someone believed they had
  // checked, so both are refused loudly rather than resolved quietly.
  const both = await gate(['capability', '--source', '--manifest', MANIFEST])
  assert.equal(both.code, 2, `payload roots plus --source must be refused:\n${both.out}`)

  const ship = await gate(['--source', '.', '--ship', '--manifest', MANIFEST])
  assert.equal(ship.code, 2, `--ship plus --source must be refused:\n${ship.out}`)
  assert.match(ship.out, /already the publish verdict/)
})

test('--source does not swallow a following flag as its path', async () => {
  // `--source --manifest x` must not scan a directory named "--manifest". The
  // path is optional, which is exactly the shape that eats the next token and
  // then reports confidently on nothing.
  const result = await gate(['--source', '--manifest', MANIFEST])
  assert.notEqual(result.code, 0, 'the optional-path parse must not produce a silent pass')
  assert.doesNotMatch(result.out, /--manifest/, 'a flag was consumed as the repository path')
})

test('the LIVE manifest classifies the vendor licence-issuance modules as paid', async () => {
  // A drift test against config/payload-boundary.json itself, not a fixture.
  // Both modules sit in the engine repository and never in the payload, so the
  // payload gate has no opinion about them and their absence from this manifest
  // was invisible until the source road was gated. Both are named in the
  // manifest's own prose, which is what made them look accounted for -- a
  // comment classifies nothing.
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
  for (const paid of ['src/lib/tool-packs/vendor-license-issuance.js', 'tools/entitlement.js']) {
    assert.ok(manifest.paid.paths.includes(paid), `${paid} must be classified paid: it needs the private licence signing key or a paid module`)
    assert.ok(!manifest.open.paths.includes(paid), `${paid} must never be open`)
  }
})
