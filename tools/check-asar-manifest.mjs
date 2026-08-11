#!/usr/bin/env node

/* Assert that the built application actually contains what it declares.
 *
 * WHY THIS EXISTS. On 2026-08-10 a shipped build was diagnosed as missing its
 * own entry point -- "the app has no entry point", "shell/main.cjs IS NOT IN
 * THE ARCHIVE" -- and the diagnosis was wrong. The archive was correct. The
 * reader used to inspect it printed a header count of 51 and then listed only
 * the first 40 entries, and the 11 it never printed were exactly the 11
 * declared missing. A tool that silently truncates its own output produced a
 * false root cause that a second person then acted on.
 *
 * So this gate does two things, and the second one is not optional decoration:
 *
 *   1. It checks that every file the build declares is in the archive, and
 *      that the archive's declared `main` resolves to an entry that exists.
 *      That is the cheap check nobody was running.
 *
 *   2. It checks ITSELF. The walk's entry count must equal the header's own
 *      file count before any conclusion is drawn from the listing. A reader
 *      that stops early can no longer report a clean or a dirty result -- it
 *      reports that it cannot be trusted, which is the only honest output of a
 *      measurement that did not finish.
 *
 * The asar format is documented and node reads it directly: 4 bytes, 4 bytes
 * pickle size, 4 bytes string size, 4 bytes JSON length, the JSON header, then
 * the file bytes at 4-byte alignment. No extraction tool is required, and the
 * absence of one is not a reason to leave a packaged artifact unverified.
 */

import { existsSync, openSync, readSync, closeSync, readFileSync, statSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function readArchive(archivePath) {
  const fd = openSync(archivePath, 'r')
  try {
    const head = Buffer.alloc(16)
    readSync(fd, head, 0, 16, 0)
    const jsonLength = head.readUInt32LE(12)
    const jsonBuffer = Buffer.alloc(jsonLength)
    readSync(fd, jsonBuffer, 0, jsonLength, 16)
    const header = JSON.parse(jsonBuffer.toString('utf8'))
    const baseOffset = 16 + Math.ceil(jsonLength / 4) * 4

    const entries = []
    const walk = (node, prefix) => {
      for (const [name, child] of Object.entries(node.files || {})) {
        const full = prefix ? `${prefix}/${name}` : name
        if (child.files) walk(child, full)
        else entries.push({ path: full, size: child.size, offset: Number(child.offset) })
      }
    }
    walk(header, '')

    const countHeaderFiles = (node) => Object.values(node.files || {})
      .reduce((total, child) => total + (child.files ? countHeaderFiles(child) : 1), 0)

    return { entries, headerCount: countHeaderFiles(header), baseOffset, fd: null, archivePath, jsonLength }
  } finally {
    closeSync(fd)
  }
}

function readEntry(archivePath, entry, baseOffset) {
  const fd = openSync(archivePath, 'r')
  try {
    const buffer = Buffer.alloc(entry.size)
    if (entry.size > 0) readSync(fd, buffer, 0, entry.size, baseOffset + entry.offset)
    return buffer
  } finally {
    closeSync(fd)
  }
}

function filesUnder(directory, prefix) {
  const out = []
  const walk = (current, relative) => {
    for (const item of readdirSync(current, { withFileTypes: true })) {
      const next = path.join(current, item.name)
      const rel = relative ? `${relative}/${item.name}` : item.name
      if (item.isDirectory()) walk(next, rel)
      else out.push(`${prefix}/${rel}`)
    }
  }
  if (existsSync(directory)) walk(directory, '')
  return out
}

/* What the build declares it ships. Only the unambiguous half of the
 * electron-builder `files` grammar is enforced: a `dir/**` pattern means every
 * file under dir/ on disk, and a bare path means that exact file. Negations
 * and anything cleverer are skipped rather than guessed at -- an over-strict
 * gate that rejects correct builds gets deleted, and then nothing is checked. */
function declaredFiles(buildFiles, sourceRoot) {
  const expected = new Set()
  const skipped = []
  for (const pattern of buildFiles || []) {
    if (typeof pattern !== 'string' || pattern.startsWith('!')) { skipped.push(pattern); continue }
    const globSuffix = /^([^*?]+)\/\*\*$/.exec(pattern)
    if (globSuffix) {
      const directory = path.join(sourceRoot, globSuffix[1])
      for (const file of filesUnder(directory, globSuffix[1])) expected.add(file)
      continue
    }
    if (!/[*?]/.test(pattern)) {
      if (existsSync(path.join(sourceRoot, pattern))) expected.add(pattern)
      continue
    }
    skipped.push(pattern)
  }
  return { expected: [...expected].sort(), skipped }
}

function main() {
  const target = process.argv[2] || path.join(REPO_ROOT, 'release', 'win-unpacked')
  const unpacked = path.resolve(target)
  const archivePath = path.join(unpacked, 'resources', 'app.asar')
  const problems = []

  if (!existsSync(archivePath)) {
    console.error(`check-asar-manifest: no archive at ${archivePath}`)
    process.exitCode = 1
    return
  }

  const archive = readArchive(archivePath)

  // Self-check first. Nothing below may be believed until this passes.
  if (archive.entries.length !== archive.headerCount) {
    console.error(
      `check-asar-manifest: REFUSING TO REPORT. The walk produced ${archive.entries.length} entries but the ` +
        `header declares ${archive.headerCount}. This reader did not finish, so neither a pass nor a fail ` +
        'from it would mean anything. Fix the walk before trusting any result.',
    )
    process.exitCode = 2
    return
  }
  console.log(`check-asar-manifest: read ${archive.entries.length} entries (header agrees) from ${archivePath}`)

  const present = new Set(archive.entries.map((entry) => entry.path))

  // 1. The declared main must exist inside the archive.
  const packageEntry = archive.entries.find((entry) => entry.path === 'package.json')
  if (!packageEntry) problems.push('the archive contains no package.json, so it declares no entry point')
  else {
    const packaged = JSON.parse(readEntry(archivePath, packageEntry, archive.baseOffset).toString('utf8'))
    const main = packaged.main || 'index.js'
    if (!present.has(main)) problems.push(`the archive declares "main": "${main}" but contains no such entry -- Electron would exit silently with code 0`)
    else console.log(`check-asar-manifest: declared main ${main} is present`)
  }

  // 2. Everything the build config declares must be in the archive.
  const buildConfig = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).build || {}
  const { expected, skipped } = declaredFiles(buildConfig.files, REPO_ROOT)
  const missing = expected.filter((file) => !present.has(file))
  if (missing.length) {
    problems.push(`${missing.length} declared file(s) are absent from the archive:\n    ${missing.join('\n    ')}`)
  } else {
    console.log(`check-asar-manifest: all ${expected.length} declared files are present`)
  }
  if (skipped.length) console.log(`check-asar-manifest: patterns not enforced (negations/complex globs): ${skipped.join(', ')}`)

  // 3. The capability layer is an extraResource, so it is NOT in the archive --
  //    it sits beside it. A build that ships the viewer alone is the exact
  //    defect this whole lane exists to close, so its absence is a failure
  //    here rather than something discovered on a customer's machine.
  const capabilityRoot = path.join(unpacked, 'resources', 'capability')
  const payloadFile = path.join(capabilityRoot, 'PAYLOAD.json')
  if (!existsSync(payloadFile)) {
    problems.push(`no capability payload at ${payloadFile} -- this build ships the viewer with nothing behind it`)
  } else {
    const payload = JSON.parse(readFileSync(payloadFile, 'utf8'))
    const entry = path.join(capabilityRoot, payload.bridgeEntrypoint || '')
    if (!payload.bridgeEntrypoint || !existsSync(entry)) {
      problems.push(`the capability payload names bridge entrypoint "${payload.bridgeEntrypoint}", which is not present`)
    } else {
      const size = statSync(entry).size
      console.log(`check-asar-manifest: capability payload present -- ${payload.fileCount} files, bridge entrypoint ${payload.bridgeEntrypoint} (${size} bytes)`)
    }

    // hostModules is the same kind of claim as bridgeEntrypoint -- a relative
    // path the payload asserts is really staged under capabilityRoot -- and
    // gets the same check. Without this, PAYLOAD.json could list a module
    // (e.g. the setup screen's machine-record.js/workspace.js) that never
    // actually got staged, and nothing before a customer's own require()
    // would have noticed.
    const hostModules = Array.isArray(payload.hostModules) ? payload.hostModules : []
    const missingHostModules = hostModules.filter((relative) => !existsSync(path.join(capabilityRoot, relative)))
    if (missingHostModules.length) {
      problems.push(`the capability payload declares hostModules not present on disk:\n    ${missingHostModules.join('\n    ')}`)
    } else if (hostModules.length) {
      console.log(`check-asar-manifest: all ${hostModules.length} declared hostModules are present`)
    }

    if (payload.ownerDataClean !== true) {
      problems.push('the capability payload is marked ownerDataClean:false; it carries builder-identifying data and must not ship')
    }
  }

  if (problems.length) {
    console.error('\ncheck-asar-manifest FAILED:')
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exitCode = 1
    return
  }
  console.log('check-asar-manifest: OK')
}

main()
