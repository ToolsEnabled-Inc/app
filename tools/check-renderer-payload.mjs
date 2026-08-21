#!/usr/bin/env node

/* THE WINDOW HALF OF THE PRODUCT MAY ONLY SHIP WHAT SOMEBODY CLASSIFIED.
 *
 * tools/check-payload-boundary.mjs already refuses an engine payload file that is
 * classified nowhere at all. This is the same rule for the renderer payload, and it
 * exists because the renderer did not have it:
 *
 *   package.json  build.files: ["dist/**", ...]      ship everything built
 *   vite                       public/** -> dist/    copy everything authored
 *
 * Nobody in that chain ever asks whose a file is. So the operator's own purchase list
 * -- authored at public/data/purchase-catalog.json -- travelled into app.asar in every
 * installer, and #/checkout put it one click back from home on a stranger's fresh
 * install. It was read off the packaged window, not inferred: internal repo paths,
 * internal request ids, second-person deliberations addressed to the operator, and a
 * written admission that the installer is unsigned.
 *
 * The defect class this project keeps finding is "absence read as consent": a missing
 * field, an empty list, a falsy check that turns NOTHING SPECIFIED into ALLOWED. This
 * is that shape in the packaging layer, so the fix is the same one the engine payload
 * already uses -- unclassified fails, and the guard refuses to run on an empty manifest
 * rather than reporting a clean sweep of nothing.
 *
 * WHAT IT ASSERTS
 *   1. The manifest is real: present, parseable, and not empty.
 *   2. Every authored file under public/ is classified exactly once.
 *   3. No file classified `operator` exists under public/ (vite would copy it) ...
 *   4. ... nor under dist/ (electron-builder would pack it) ...
 *   5. ... nor inside a packaged app.asar, read out of the archive itself.
 *   6. Every `shipped` path still exists, so a stale manifest cannot rot quietly.
 *
 * Usage: node tools/check-renderer-payload.mjs [packaged-root ...]
 *   with no argument it checks public/ and dist/; a packaged root is a directory like
 *   release/win-unpacked whose resources/app.asar is read directly.
 */

import { existsSync, openSync, readSync, closeSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = path.join(REPO_ROOT, 'config', 'renderer-payload-boundary.json')
const MANIFEST_LABEL = 'config/renderer-payload-boundary.json'
const PUBLIC_ROOT = path.join(REPO_ROOT, 'public')
const DIST_ROOT = path.join(REPO_ROOT, 'dist')
// Where public/ ends up once vite has run and electron-builder has packed it.
const PAYLOAD_PREFIX = 'dist'

function loadManifest() {
  if (!existsSync(MANIFEST)) {
    throw new Error(
      `${MANIFEST_LABEL} is missing. Without it this guard has nothing to compare the payload ` +
        'against, so it would pass any bundle at all.',
    )
  }
  let parsed
  try {
    parsed = JSON.parse(readFileSync(MANIFEST, 'utf8'))
  } catch (error) {
    throw new Error(`${MANIFEST_LABEL} is present but unreadable: ${error.message}`)
  }
  const list = (group) => {
    const value = parsed?.[group]?.paths
    if (!Array.isArray(value)) throw new Error(`${MANIFEST_LABEL} must contain a "${group}.paths" array.`)
    for (const entry of value) {
      if (typeof entry !== 'string' || !entry.trim()) throw new Error(`${MANIFEST_LABEL} has a non-string path in "${group}".`)
      if (entry.includes('\\') || entry.startsWith('/') || entry.includes('..')) {
        throw new Error(`${MANIFEST_LABEL} path ${JSON.stringify(entry)} must be a forward-slash path relative to public/.`)
      }
    }
    return value
  }
  const shipped = list('shipped')
  const operator = list('operator')
  // AN EMPTY MANIFEST MUST NOT PASS. A boundary that was given nothing to enforce
  // reports a clean payload while enforcing nothing, which is the failure this file
  // exists to stop -- one layer up.
  if (shipped.length === 0) {
    throw new Error(`${MANIFEST_LABEL} classifies nothing as shipped. An empty boundary protects nobody.`)
  }
  const overlap = shipped.filter((entry) => operator.includes(entry))
  if (overlap.length > 0) {
    throw new Error(`${MANIFEST_LABEL} classifies these both ways, so neither rule can be applied: ${overlap.join(', ')}`)
  }
  return { shipped, operator }
}

function filesUnder(root) {
  const found = []
  const walk = (directory, relative) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const next = path.join(directory, entry.name)
      const rel = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) walk(next, rel)
      else if (entry.isFile()) found.push(rel)
    }
  }
  if (existsSync(root)) walk(root, '')
  return found
}

/* The asar header is read directly rather than extracted: an extraction step is
 * another tool that can silently truncate, and this only needs the file list. */
function asarEntries(archivePath) {
  const fd = openSync(archivePath, 'r')
  try {
    const head = Buffer.alloc(16)
    readSync(fd, head, 0, 16, 0)
    const jsonLength = head.readUInt32LE(12)
    const jsonBuffer = Buffer.alloc(jsonLength)
    readSync(fd, jsonBuffer, 0, jsonLength, 16)
    const header = JSON.parse(jsonBuffer.toString('utf8'))
    const entries = []
    const walk = (node, prefix) => {
      for (const [name, child] of Object.entries(node.files || {})) {
        const full = prefix ? `${prefix}/${name}` : name
        if (child.files) walk(child, full)
        else entries.push(full)
      }
    }
    walk(header, '')
    const count = (node) => Object.values(node.files || {})
      .reduce((total, child) => total + (child.files ? count(child) : 1), 0)
    return { entries, headerCount: count(header) }
  } finally {
    closeSync(fd)
  }
}

function main() {
  const { shipped, operator } = loadManifest()
  const shippedSet = new Set(shipped)
  const operatorSet = new Set(operator)
  const problems = []

  // 2. Everything authored is classified.
  const authored = filesUnder(PUBLIC_ROOT)
  if (authored.length === 0) problems.push('public/ has no files in it, so this guard checked nothing; that is not a pass')
  const unclassified = authored.filter((file) => !shippedSet.has(file) && !operatorSet.has(file))
  if (unclassified.length > 0) {
    problems.push(
      `${unclassified.length} file(s) under public/ are classified nowhere in ${MANIFEST_LABEL}. Every one of ` +
        'them would ship. Classify each as shipped (a product asset strangers receive) or operator ' +
        `(this machine's own document, which then must not live under public/):\n    ${unclassified.join('\n    ')}`,
    )
  }

  // 3. Operator data is not staged for the build.
  const stagedOperator = authored.filter((file) => operatorSet.has(file))
  if (stagedOperator.length > 0) {
    problems.push(
      `${stagedOperator.length} operator file(s) are under public/, which vite copies into dist/ verbatim:\n    ` +
        stagedOperator.join('\n    '),
    )
  }

  // 6. The manifest still describes something real.
  const authoredSet = new Set(authored)
  const stale = shipped.filter((file) => !authoredSet.has(file))
  if (stale.length > 0) {
    problems.push(
      `${stale.length} path(s) classified shipped no longer exist under public/. A manifest that has drifted ` +
        `from the tree is not enforcing what its reader thinks it is:\n    ${stale.join('\n    ')}`,
    )
  }

  // 4. Operator data is not in the built payload.
  const built = filesUnder(DIST_ROOT)
  if (built.length > 0) {
    const leaked = built.filter((file) => operatorSet.has(file))
    if (leaked.length > 0) {
      problems.push(`${leaked.length} operator file(s) are in dist/ and would be packed into app.asar:\n    ${leaked.join('\n    ')}`)
    }
    console.log(`check-renderer-payload: dist/ carries ${built.length} files; ${leaked.length} are operator data`)
  } else {
    console.log('check-renderer-payload: no dist/ to check (run `npm run build` to include the built payload)')
  }

  // 5. And not in a packaged archive either. This is the assertion that is about
  //    the artifact a stranger downloads rather than about a directory on this disk.
  for (const root of process.argv.slice(2)) {
    const archivePath = path.join(path.resolve(root), 'resources', 'app.asar')
    if (!existsSync(archivePath)) {
      problems.push(`no app.asar at ${archivePath}, so the packaged payload was not checked`)
      continue
    }
    const { entries, headerCount } = asarEntries(archivePath)
    if (entries.length !== headerCount) {
      problems.push(
        `REFUSING TO REPORT on ${archivePath}: the walk produced ${entries.length} entries but the header ` +
          `declares ${headerCount}. A reader that did not finish cannot clear a payload.`,
      )
      continue
    }
    const leaked = entries.filter((entry) => operatorSet.has(entry.slice(`${PAYLOAD_PREFIX}/`.length))
      && entry.startsWith(`${PAYLOAD_PREFIX}/`))
    if (leaked.length > 0) {
      problems.push(`${leaked.length} operator file(s) are inside ${archivePath}:\n    ${leaked.join('\n    ')}`)
    }
    console.log(`check-renderer-payload: ${archivePath} carries ${entries.length} entries; ${leaked.length} are operator data`)
  }

  console.log(
    `check-renderer-payload: classified ${authored.length} authored file(s) -- ` +
      `${authored.filter((file) => shippedSet.has(file)).length} shipped, ${stagedOperator.length} operator, ` +
      `${unclassified.length} unclassified`,
  )

  if (problems.length > 0) {
    console.error('\ncheck-renderer-payload FAILED:')
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exitCode = 1
    return
  }
  console.log('check-renderer-payload: OK')
}

try {
  main()
} catch (error) {
  console.error(`Renderer payload guard error: ${error.message}`)
  process.exitCode = 2
}
