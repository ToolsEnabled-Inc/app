#!/usr/bin/env node

// Stages the capability layer -- the half of this product that is not the
// viewer -- into `capability/`, from where electron-builder ships it as an
// extraResource. See tools/capability-manifest.json for what is staged and
// why. Two rules govern this file:
//
//   1. The payload is DERIVED. Nothing is hand-listed except the closure roots
//      and the runtime resources a require() walk provably cannot see -- the
//      JSON in `dataFiles` and the spawned .ps1/.cmd/.py in `helperPrograms`.
//      A hand-maintained file list drifts from the code the day someone adds
//      a require, and drifts silently, because the missing file only shows
//      up on a customer's machine where nobody is watching.
//
//   2. The guard is FAIL-CLOSED. The source tree this payload is cut from is
//      the builder's working tree and currently contains the builder's name,
//      home-directory paths and LAN addresses. Staging runs
//      check-no-owner-data.mjs over the result and exits 1 on any hit.
//      --allow-owner-data exists for engineering runs that must exercise the
//      RUNTIME path before that source is purged; it does not weaken the ship
//      path, because `npm run dist` runs the same guard again over
//      release/win-unpacked, where extraResources have already been copied.

import { createHash } from 'node:crypto'
import { execFile as execFileCallback } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const require_ = createRequire(import.meta.url)
const BUILTINS = new Set(require_('node:module').builtinModules)

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST_FILE = path.join(REPO_ROOT, 'tools', 'capability-manifest.json')
const DEFAULTS_DIR = path.join(REPO_ROOT, 'capability-defaults')
const DEFAULT_OUT = path.join(REPO_ROOT, 'capability')
const PAYLOAD_RECORD = 'PAYLOAD.json'
const UNSHIPPABLE_MARKER = 'UNSHIPPABLE-OWNER-DATA.txt'

// THE VAULT SCRIPT IS A PROGRAM; THE VAULT IS ITS CONTENTS. Shipping
// tools/secrets.ps1 is the fix this file exists to carry. Shipping
// vault/secrets.json would be handing every customer the builder's credentials,
// and the two live one directory apart under names that differ by four
// characters. So the rule is stated mechanically rather than left to whoever
// edits the manifest next: no staged path may sit under any of these roots, and
// no staged file may carry one of these names, whatever list declared it.
//
// state/ is here for a second reason as well -- the bridge writes per-boot
// bearer tokens into it when started out of the payload directory, so a hand-
// copied payload can carry live tokens (config/payload-boundary.json's
// `excluded` rule catches the same case at the other end of the build).
const SECRET_MATERIAL_PREFIXES = ['vault/', 'state/', 'private/', 'reports/', 'logs/', '.git/']
const SECRET_MATERIAL_BASENAMES = new Set(['secrets.json', 'auth.json', '.env', 'credentials.json'])
const SECRET_MATERIAL_EXTENSIONS = new Set(['.pem', '.key', '.pfx', '.p12', '.sqlite', '.sqlite3'])
// What a helperProgram is allowed to be. A helper program is spawned, so an
// entry here that is not executable is either a mistake or an attempt to move
// a data file past the rules that apply to data files.
const HELPER_PROGRAM_EXTENSIONS = new Set(['.ps1', '.cmd', '.bat', '.py'])

// WHERE THE SOURCE TREE IS, IS A SETTING -- NOT A CONSTANT IN THIS FILE.
//
// The obvious convenience here is a default list of sibling directory names to
// try. It was written that way first, and it was wrong for the same reason the
// owner-data guard exists: the name of the private working tree this product is
// built from is itself one of that guard's forbidden patterns, and hardcoding
// it would have committed a fresh copy of exactly the leak the project is
// trying to remove. The exposure from a tracked source file is not the shipped
// artifact -- `!tools/**` keeps this file out of the asar -- it is that tracked
// source publishes on any push.
//
// So the mechanism is code and the location is configuration, resolved in this
// order, all of which keep the path out of git:
//   1. --source <path>
//   2. TOOLSENABLED_SOURCE
//   3. private/capability-source.owner.json  { "path": "..." }   (/private/ is
//      gitignored, and is where this repo already keeps builder-specific
//      settings such as owner-data-patterns.owner.json)
const SOURCE_SETTING_FILE = path.join(REPO_ROOT, 'private', 'capability-source.owner.json')

function parseArgs(argv) {
  const options = { source: null, out: DEFAULT_OUT, allowOwnerData: false, quiet: false }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--allow-owner-data') { options.allowOwnerData = true; continue }
    if (flag === '--quiet') { options.quiet = true; continue }
    const value = argv[index + 1]
    if (flag === '--source') { options.source = value; index += 1; continue }
    if (flag === '--out') { options.out = value; index += 1; continue }
    throw new Error(`unknown flag ${flag}`)
  }
  return options
}

function configuredSource() {
  if (!existsSync(SOURCE_SETTING_FILE)) return null
  let parsed
  try {
    parsed = JSON.parse(readFileSync(SOURCE_SETTING_FILE, 'utf8'))
  } catch (error) {
    throw new Error(`private/capability-source.owner.json is present but unreadable: ${error.message}`)
  }
  if (typeof parsed?.path !== 'string' || !parsed.path.trim()) {
    throw new Error('private/capability-source.owner.json must contain a non-empty "path" string.')
  }
  return parsed.path.trim()
}

function resolveSource(explicit) {
  const candidates = [explicit, process.env.TOOLSENABLED_SOURCE, configuredSource()].filter(Boolean)
  const tried = []
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate)
    tried.push(resolved)
    if (existsSync(path.join(resolved, 'tools', 'mission-bridge.js'))) return resolved
  }
  throw new Error(
    'the capability-layer source tree is not configured. Set it one of three ways:\n' +
      '  --source <path>\n' +
      '  TOOLSENABLED_SOURCE=<path>\n' +
      '  private/capability-source.owner.json  ->  { "path": "<path>" }\n' +
      (tried.length
        ? `Tried, and none contained tools/mission-bridge.js:\n  ${tried.join('\n  ')}`
        : 'None of the three was set.'),
  )
}

// Is byte `index` inside a comment? Used ONLY to decide whether an
// *unresolvable* require mention is real code or prose. This codebase
// documents its own module graph in prose -- src/lib/providers/code-intel.js
// contains the sentence "directly through `require('./module').name(...)` in
// this codebase" -- and a raw text scan reads that as a broken dependency.
//
// The direction of this check is deliberate and load-bearing: it can only
// ever SUPPRESS AN ERROR about a specifier that already failed to resolve on
// disk. It is never consulted to decide that something is not a dependency,
// so a mis-parse here can only turn a hard failure into a hard failure
// somewhere more obvious -- never into a silently missing file. Any mention
// that DOES resolve is staged regardless of whether it sits in a comment;
// over-including a file that already exists costs bytes, and under-including
// one costs a customer a product that does not start.
function insideComment(source, index) {
  let line = false
  let block = false
  let quote = null
  for (let position = 0; position < index; position += 1) {
    const character = source[position]
    const next = source[position + 1]
    if (line) { if (character === '\n') line = false; continue }
    if (block) { if (character === '*' && next === '/') { block = false; position += 1 } continue }
    if (quote) {
      if (character === '\\') { position += 1; continue }
      if (character === quote) quote = null
      continue
    }
    if (character === '"' || character === "'" || character === '`') { quote = character; continue }
    if (character === '/' && next === '/') { line = true; position += 1; continue }
    if (character === '/' && next === '*') { block = true; position += 1 }
  }
  return line || block
}

// Static require() walk. Deliberately literal-only: a computed require would
// be an unresolvable dependency at pack time, so it is reported rather than
// guessed at. The capability layer currently has none.
function computeClosure(root, entrypoints, declaredDynamic = []) {
  const seen = new Set()
  const external = new Set()
  const dynamic = []
  const unresolved = []
  const queue = entrypoints.map((entry) => path.resolve(root, entry))
  const declared = new Map(declaredDynamic.map((entry) => [`${entry.from}\0${entry.expression}`, entry.resolvesTo]))
  const usedDeclarations = new Set()

  while (queue.length) {
    const file = queue.pop()
    if (seen.has(file)) continue
    if (!existsSync(file)) { unresolved.push({ from: '<entrypoint>', spec: path.relative(root, file) }); continue }
    seen.add(file)
    if (path.extname(file) === '.json') continue

    const source = readFileSync(file, 'utf8')
    const pattern = /require\(\s*([^)]*?)\s*\)/g
    let match
    while ((match = pattern.exec(source))) {
      const raw = match[1].trim()
      const literal = /^(['"])([^'"]+)\1$/.exec(raw)
      if (!literal) {
        if (insideComment(source, match.index)) continue
        const relative = path.relative(root, file).split(path.sep).join('/')
        const key = `${relative}\0${raw.slice(0, 80)}`
        const targets = declared.get(key)
        if (!targets) { dynamic.push({ from: relative, expression: raw.slice(0, 80) }); continue }
        usedDeclarations.add(key)
        for (const target of targets) queue.push(path.resolve(root, target))
        continue
      }
      const spec = literal[2]
      if (spec.startsWith('node:') || BUILTINS.has(spec)) continue
      if (!spec.startsWith('.')) {
        if (!insideComment(source, match.index)) external.add(spec)
        continue
      }

      const base = path.resolve(path.dirname(file), spec)
      const resolved = [base, `${base}.js`, `${base}.cjs`, `${base}.json`, path.join(base, 'index.js')]
        .find((candidate) => existsSync(candidate) && statSync(candidate).isFile())
      if (resolved) queue.push(resolved)
      else if (!insideComment(source, match.index)) unresolved.push({ from: path.relative(root, file), spec })
    }
  }

  const files = [...seen].map((file) => path.relative(root, file).split(path.sep).join('/')).sort()
  // A declaration that no longer matches anything is a stale claim about the
  // code, and stale claims are how a manifest quietly stops describing what it
  // packs. Surface it rather than carry it.
  const staleDeclarations = [...declared.keys()]
    .filter((key) => !usedDeclarations.has(key))
    .map((key) => key.split('\0').join(': '))
  return { files, external: [...external].sort(), dynamic, unresolved, staleDeclarations }
}

// Refuses to stage credential storage no matter which manifest list named it.
// Deliberately checked against the FINAL staged set rather than each list as it
// is read: the whole point is that it cannot be bypassed by choosing a
// different category, and a per-list check would have to be repeated four times
// and would be forgotten on the fifth list someone adds.
function assertNoSecretMaterial(relativePaths) {
  const offenders = []
  for (const relative of relativePaths) {
    const normalized = relative.split(path.sep).join('/')
    const basename = path.posix.basename(normalized).toLowerCase()
    const extension = path.posix.extname(normalized).toLowerCase()
    const prefix = SECRET_MATERIAL_PREFIXES.find((candidate) => normalized.toLowerCase().startsWith(candidate))
    if (prefix) offenders.push(`${normalized} -- under ${prefix}`)
    else if (SECRET_MATERIAL_BASENAMES.has(basename)) offenders.push(`${normalized} -- named ${basename}`)
    else if (SECRET_MATERIAL_EXTENSIONS.has(extension)) offenders.push(`${normalized} -- ${extension} file`)
  }
  if (!offenders.length) return
  throw new Error(
    'refusing to stage credential or runtime-state material into the capability payload:\n  ' +
      offenders.join('\n  ') +
      '\nThe vault SCRIPT (tools/secrets.ps1) ships; the vault CONTENTS never do. If a program\n' +
      'genuinely needs one of these paths at runtime it creates it on the customer\'s machine.',
  )
}

function assertHelperProgramsAreExecutable(helperPrograms) {
  const wrong = helperPrograms.filter((relative) => !HELPER_PROGRAM_EXTENSIONS.has(path.extname(relative).toLowerCase()))
  if (!wrong.length) return
  throw new Error(
    'tools/capability-manifest.json lists helperPrograms that are not executable helpers:\n  ' +
      wrong.join('\n  ') +
      `\nhelperPrograms is for spawned non-JavaScript programs (${[...HELPER_PROGRAM_EXTENSIONS].join(', ')}).\n` +
      'JavaScript the payload spawns belongs in spawnedPrograms, where its require() graph is walked;\n' +
      'JSON read through a computed path belongs in dataFiles.',
  )
}

// POWERSHELL HAS A DEPENDENCY GRAPH TOO, AND HAND-LISTING IT WOULD REPEAT THE
// BUG THIS FILE JUST FIXED.
//
// tools/secrets.ps1 dot-sources tools/owner-prompt-theme.ps1 at line 736. Ship
// the vault script alone and it still cannot run: PowerShell reports "The term
// '...owner-prompt-theme.ps1' is not recognized as the name of a cmdlet,
// function, script file, or operable program" -- measured, in a sterile payload,
// AFTER secrets.ps1 was added to the manifest and the pack reported clean.
// Declaring the second file by hand would fix today and leave the next
// dot-source to be discovered by a customer, which is exactly how the first
// file went missing. So the .ps1 closure is DERIVED, on the same terms as the
// require() closure: walked from the declared helpers, and fail-closed on a
// reference that does not resolve.
//
// Both $PSScriptRoot-relative forms this tree actually uses, and the reason
// there are two: the first draft of this walk matched only `$PSScriptRoot\x`
// and reported a clean pack over the very file it was written to catch, because
// secrets.ps1 spells it `. (Join-Path $PSScriptRoot 'owner-prompt-theme.ps1')`.
// A scanner that silently matches nothing is worse than no scanner, so both are
// listed explicitly and there is a test that would fail if either stopped
// matching.
//
// References anchored anywhere else -- $RepoRoot, an absolute path, a computed
// name -- are deliberately NOT followed. The one instance in this tree
// (owner-prompt-queue.ps1's Join-Path $RepoRoot 'tools\start-owner-host.ps1')
// is guarded by a Test-Path that returns when the file is absent, so it
// degrades rather than throws; a future unguarded one would surface as a
// runtime failure in the packaged smoke gate, which now exercises a real
// credential-backed call.
const PS_SCRIPT_ROOT_REFERENCES = [
  /\$PSScriptRoot[\\/]([A-Za-z0-9_.\\/-]+?\.(?:ps1|psm1|psd1))/gi,
  /Join-Path\s+\$PSScriptRoot\s+['"]([A-Za-z0-9_.\\/-]+?\.(?:ps1|psm1|psd1))['"]/gi,
]

function computePowerShellClosure(root, seeds) {
  const seen = new Set()
  const unresolved = []
  const queue = seeds.filter((seed) => /\.(ps1|psm1|psd1)$/i.test(seed))

  while (queue.length) {
    const relative = queue.pop()
    if (seen.has(relative)) continue
    const file = path.join(root, relative)
    if (!existsSync(file)) { unresolved.push({ from: '<declared helper>', spec: relative }); continue }
    seen.add(relative)

    const source = readFileSync(file, 'utf8')
    const directory = path.posix.dirname(relative.split(path.sep).join('/'))
    for (const pattern of PS_SCRIPT_ROOT_REFERENCES) {
      pattern.lastIndex = 0
      let match
      while ((match = pattern.exec(source))) {
        const target = path.posix.normalize(path.posix.join(directory, match[1].split('\\').join('/')))
        if (seen.has(target)) continue
        if (!existsSync(path.join(root, target))) { unresolved.push({ from: relative, spec: target }); continue }
        queue.push(target)
      }
    }
  }
  return { files: [...seen].sort(), unresolved }
}

// The guard has THREE outcomes, not two, and collapsing the last two is how a
// payload nobody scanned gets described as a payload somebody scanned.
//
//   exit 0  clean       -- it ran, and found nothing.
//   exit 1  violations  -- it ran, and found offenders it can name.
//   exit 2  COULD NOT RUN -- a setup problem, almost always a missing or
//                            foreign private/owner-data-patterns.owner.json.
//
// Treating 2 as 1 produced a genuinely misleading failure: the packer printed
// "0 file(s) carry builder-identifying data" followed by prose blaming the
// capability-layer SOURCE for carrying the builder's name -- a diagnosis of a
// scan that never happened, sending the builder hunting for data nothing had
// detected. Worse, under --allow-owner-data the same collapse staged an
// UNSCANNED payload and logged it as "DIRTY (0 files)".
//
// tools/check-declaration-privacy.mjs already draws this line correctly
// ("Unchecked is not clean, so nothing was written"); this mirrors it.
const GUARD_SETUP_ERROR = 2

async function runOwnerDataGuard(directory) {
  try {
    const { stdout } = await execFile(process.execPath, [path.join(REPO_ROOT, 'tools', 'check-no-owner-data.mjs'), directory], {
      cwd: REPO_ROOT,
      maxBuffer: 32 * 1024 * 1024,
    })
    return { clean: true, ran: true, report: stdout }
  } catch (error) {
    const report = `${error.stdout || ''}${error.stderr || ''}`
    // A spawn failure (ENOENT, EACCES) has no numeric exit status at all. That
    // is even less evidence than exit 2, so it takes the same fail-closed path
    // rather than the "we found offenders" one.
    const ran = error.code !== GUARD_SETUP_ERROR && typeof error.code === 'number'
    return { clean: false, ran, report, exitCode: error.code }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const log = (message) => { if (!options.quiet) console.log(message) }

  const manifest = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8'))
  const source = resolveSource(options.source)
  const out = path.resolve(options.out)
  log(`capability source: ${source}`)

  // Entrypoints are walked with the host modules the shell require()s directly
  // (see $comment_hostModules in the manifest). Both are closure ROOTS and
  // obey the same fail-closed rules; only entrypoints are startable, which is
  // why PAYLOAD.json keeps them apart.
  const hostModules = manifest.hostModules || []
  // Programs the PAYLOAD spawns (see $comment_spawnedPrograms). They are
  // closure roots for the same reason an entrypoint is: each has its own
  // require() graph, and copying one verbatim would ship a program whose first
  // require() throws on the customer's machine.
  const spawnedPrograms = manifest.spawnedPrograms || []
  const helperPrograms = manifest.helperPrograms || []
  assertHelperProgramsAreExecutable(helperPrograms)
  const closure = computeClosure(source, [...manifest.entrypoints, ...hostModules, ...spawnedPrograms], manifest.dynamicRequires || [])
  if (closure.staleDeclarations.length) {
    throw new Error(
      'tools/capability-manifest.json declares dynamic requires that no longer exist in the source:\n  ' +
        closure.staleDeclarations.join('\n  ') +
        '\nRemove them, or fix the expression they were meant to match.',
    )
  }
  if (closure.unresolved.length) {
    throw new Error(
      'the capability closure has unresolved requires; staging a payload that cannot load is worse than not staging one:\n  ' +
        closure.unresolved.map((entry) => `${entry.from} -> ${entry.spec}`).join('\n  '),
    )
  }
  if (closure.external.length) {
    throw new Error(
      'the capability layer now depends on npm packages, which this payload does not ship:\n  ' +
        closure.external.join('\n  ') +
        '\nEither vendor them into the payload or remove the dependency; do not ship a layer that cannot resolve its own imports.',
    )
  }
  if (closure.dynamic.length) {
    throw new Error(
      'the capability layer contains computed require() expressions that a pack-time walk cannot follow:\n  ' +
        closure.dynamic.map((entry) => `${entry.from}: ${entry.expression}`).join('\n  '),
    )
  }

  const powershell = computePowerShellClosure(source, helperPrograms)
  if (powershell.unresolved.length) {
    throw new Error(
      'a declared helper program references a PowerShell script that is not in the source tree:\n  ' +
        powershell.unresolved.map((entry) => `${entry.from} -> ${entry.spec}`).join('\n  ') +
        '\nStaging a helper that cannot dot-source its own dependencies ships a vault script that throws\n' +
        'CommandNotFoundException on the customer\'s first credential read.',
    )
  }

  const neutral = new Set(manifest.neutralDefaults)
  const staged = [...new Set([...closure.files, ...manifest.dataFiles, ...helperPrograms, ...powershell.files])]
    .filter((file) => !neutral.has(file))
    .sort()
  assertNoSecretMaterial([...staged, ...manifest.neutralDefaults])

  /* EMPTY THE DIRECTORY; DO NOT DELETE IT.
   *
   * This was `rmSync(out, {recursive, force})` followed by `mkdirSync(out)`.
   * Same end state -- an empty destination -- but deleting the ROOT fails with
   * EBUSY whenever any process holds the directory itself, and on Windows a
   * process merely having it as its working directory is enough.
   *
   * That is not hypothetical here: agents are directed to offload read-only
   * analysis to `codex exec --cd <this tree>`, and each such run holds this
   * path for its lifetime. Measured tonight -- `rmdir(capability)` failed
   * EBUSY while removing all eight children INDIVIDUALLY succeeded, which is
   * what proves the lock is on the directory and not its contents. With two
   * such runs alive, `npm run dist` died here before writing a single file,
   * and the count rose from two to four within the hour because every lane is
   * told to work that way.
   *
   * The alternative on the table was freezing that directive across the whole
   * swarm to wait for a natural gap that may never come. This is two lines
   * instead, and it removes the race rather than scheduling around it.
   *
   * `force: true` on each child so a concurrent reader that vanishes between
   * readdir and rm does not fail the build. */
  mkdirSync(out, { recursive: true })
  for (const entry of readdirSync(out)) {
    rmSync(path.join(out, entry), { recursive: true, force: true })
  }

  let bytes = 0
  for (const relative of staged) {
    const from = path.join(source, relative)
    if (!existsSync(from)) throw new Error(`declared payload file is absent from the source tree: ${relative}`)
    const to = path.join(out, relative)
    mkdirSync(path.dirname(to), { recursive: true })
    cpSync(from, to)
    bytes += statSync(to).size
  }

  const defaults = []
  for (const relative of manifest.neutralDefaults) {
    const from = path.join(DEFAULTS_DIR, relative)
    if (!existsSync(from)) throw new Error(`neutral default is missing: capability-defaults/${relative}`)
    const to = path.join(out, relative)
    mkdirSync(path.dirname(to), { recursive: true })
    cpSync(from, to)
    bytes += statSync(to).size
    defaults.push(relative)
  }

  const all = [...staged, ...defaults].sort()
  const digest = createHash('sha256')
  for (const relative of all) {
    digest.update(relative)
    digest.update('\0')
    digest.update(readFileSync(path.join(out, relative)))
  }

  log(`staged ${all.length} files (${(bytes / 1024 / 1024).toFixed(2)} MB) into ${out}`)

  const guard = await runOwnerDataGuard(out)
  // THIS RECORD DELIBERATELY CARRIES NO TIMESTAMP.
  //
  // It used to carry `stagedAt: new Date().toISOString()`, which had a writer
  // and no reader anywhere -- not in shell/capability-layer.cjs, not in
  // check-asar-manifest.mjs, smoke-packaged.mjs, capability-acceptance.mjs or
  // check-payload-current.mjs, which between them consume entrypoints,
  // bridgeEntrypoint, hostModules, fileCount, ownerDataClean and
  // neutralDefaults. It was nonetheless the ONLY thing that stopped two
  // stagings of identical source from producing an identical payload: every
  // other staged file was byte-for-byte the same across rebuilds.
  //
  // docs/REPRODUCIBLE-BUILD.md §5 tells a reader who needs to prove two builds
  // carry the same payload to compare resources/ between them. One unread
  // wall-clock field made that comparison impossible to pass. Removing it costs
  // nothing and makes the payload verifiable.
  //
  // Note payloadSha256 below is computed from `digest`, which was accumulated
  // BEFORE this record exists, so it has always excluded PAYLOAD.json itself by
  // construction -- and fileCount counts `all`, which likewise cannot include
  // the record being written. Neither is a bug; do not "fix" either.
  const record = {
    schemaVersion: 1,
    entrypoints: manifest.entrypoints,
    bridgeEntrypoint: manifest.entrypoints[0],
    hostModules,
    spawnedPrograms,
    helperPrograms,
    fileCount: all.length,
    byteCount: bytes,
    payloadSha256: digest.digest('hex'),
    neutralDefaults: defaults,
    ownerDataClean: guard.clean,
  }
  writeFileSync(path.join(out, PAYLOAD_RECORD), `${JSON.stringify(record, null, 2)}\n`)

  if (guard.clean) {
    rmSync(path.join(out, UNSHIPPABLE_MARKER), { force: true })
    log('owner-data guard: clean')
    return
  }

  // THE GUARD COULD NOT RUN. Say only that, and refuse -- including under
  // --allow-owner-data. That flag means "I know what this payload carries and
  // I am staging it anyway for an engineering run"; its whole contract is the
  // named offender list it writes into the marker. When the scanner never ran
  // there is no such list, so the flag's premise does not hold and honouring it
  // would stage an unscanned payload under a marker claiming 0 offenders.
  if (!guard.ran) {
    writeFileSync(
      path.join(out, UNSHIPPABLE_MARKER),
      'The owner-data guard could not run against this payload, so nothing has checked it.\n' +
        'Unchecked is not clean. This payload must not be shipped.\n',
    )
    console.error('\nOwner-data guard COULD NOT RUN, so this payload is UNCHECKED -- not clean, and not known-dirty.')
    console.error(guard.report.trim() || `check-no-owner-data.mjs exited ${guard.exitCode} without a message.`)
    console.error(
      '\nNothing was scanned, so there is no offender list and no conclusion to draw about the\n' +
        'capability-layer source. Fix the guard\'s setup and re-run; --allow-owner-data will NOT\n' +
        'bypass this, because it accepts KNOWN owner data and nothing here is known.\n' +
        `The staged payload is marked ${UNSHIPPABLE_MARKER}.`,
    )
    process.exitCode = 1
    return
  }

  const summary = guard.report.split('\n').filter((line) => line.includes('Per-pattern matches') || line.startsWith('Scanned')).join('\n')
  const offenders = [...new Set(guard.report.split('\n').filter((line) => line.includes('| pattern=')).map((line) => line.split(' | ')[0]))]

  if (!options.allowOwnerData) {
    writeFileSync(path.join(out, UNSHIPPABLE_MARKER), 'This payload failed the owner-data guard and must not be shipped.\n')
    console.error('\nOwner-data guard FAILED on the staged capability payload.')
    console.error(summary)
    console.error(`\n${offenders.length} file(s) carry builder-identifying data:`)
    for (const file of offenders) console.error(`  ${path.relative(out, file)}`)
    console.error(
      '\nThis is not a packaging defect -- the packaging works. It is the capability-layer SOURCE\n' +
        'carrying the builder\'s name, home paths and LAN addresses (SHIPMENT-PLAN P3.4). Purge those\n' +
        'in the source tree, or re-run with --allow-owner-data to exercise the runtime path only.\n' +
        'The staged payload is marked UNSHIPPABLE-OWNER-DATA.txt and `npm run dist` will refuse it again.',
    )
    process.exitCode = 1
    return
  }

  writeFileSync(
    path.join(out, UNSHIPPABLE_MARKER),
    'This payload was staged with --allow-owner-data for an engineering run.\n' +
      'It carries builder-identifying data and MUST NOT be shipped to anyone.\n' +
      `Offending files (${offenders.length}):\n` +
      offenders.map((file) => `  ${path.relative(out, file)}`).join('\n') +
      '\n',
  )
  log(`owner-data guard: DIRTY (${offenders.length} files) -- staged anyway under --allow-owner-data, marked ${UNSHIPPABLE_MARKER}`)
}

// Run only when invoked as a program. Until this guard existed, importing this
// module STAGED A PAYLOAD as a side effect, so the three refusals above -- the
// ones that decide whether credentials or runtime state can reach a customer --
// were the only rules in the build with no way to test them except by watching
// a full pack fail. A guard nobody can exercise in isolation is a guard nobody
// notices the day it stops firing.
const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(`pack-capability-layer: ${error.message}`)
    process.exitCode = 1
  })
}

export {
  HELPER_PROGRAM_EXTENSIONS,
  SECRET_MATERIAL_PREFIXES,
  assertHelperProgramsAreExecutable,
  assertNoSecretMaterial,
  computeClosure,
  computePowerShellClosure,
  main,
}
