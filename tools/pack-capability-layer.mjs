#!/usr/bin/env node

// Stages the capability layer -- the half of this product that is not the
// viewer -- into `capability/`, from where electron-builder ships it as an
// extraResource. See tools/capability-manifest.json for what is staged and
// why. Two rules govern this file:
//
//   1. The payload is DERIVED. Nothing is hand-listed except the two
//      entrypoints and the data files a require() walk provably cannot see.
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
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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

async function runOwnerDataGuard(directory) {
  try {
    const { stdout } = await execFile(process.execPath, [path.join(REPO_ROOT, 'tools', 'check-no-owner-data.mjs'), directory], {
      cwd: REPO_ROOT,
      maxBuffer: 32 * 1024 * 1024,
    })
    return { clean: true, report: stdout }
  } catch (error) {
    return { clean: false, report: `${error.stdout || ''}${error.stderr || ''}`, exitCode: error.code }
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
  const closure = computeClosure(source, [...manifest.entrypoints, ...hostModules], manifest.dynamicRequires || [])
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

  const neutral = new Set(manifest.neutralDefaults)
  const staged = [...new Set([...closure.files, ...manifest.dataFiles])].filter((file) => !neutral.has(file)).sort()

  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })

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
  const record = {
    schemaVersion: 1,
    stagedAt: new Date().toISOString(),
    entrypoints: manifest.entrypoints,
    bridgeEntrypoint: manifest.entrypoints[0],
    hostModules,
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

main().catch((error) => {
  console.error(`pack-capability-layer: ${error.message}`)
  process.exitCode = 1
})
