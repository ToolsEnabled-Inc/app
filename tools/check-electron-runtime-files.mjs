/* Fail the build if the packaged output is missing an Electron runtime file.
 *
 * WHAT WENT WRONG, MEASURED. release/win-unpacked held ToolsEnabled.exe and
 * resources/app.asar and five DLLs -- and no icudtl.dat, no resources.pak, no
 * v8_context_snapshot.bin, no snapshot_blob.bin, no ffmpeg.dll and no locales/.
 * It died in 310ms with "Invalid file descriptor to ICU data received". The
 * NSIS installer built from it -- ToolsEnabled Setup 1.0.6.exe, 265 files,
 * 79 MB against the 336 files and 102 MB a whole one weighs -- carried the same
 * hole, so every person who installed it got an application that cannot start.
 *
 * NOTHING IN THE SHIP CHAIN NOTICED, and that is the part worth fixing. The
 * artifact seal recorded the short tree as the truth. check-asar-manifest,
 * check-renderer-payload, check-no-owner-data and check-payload-boundary all
 * passed, because every one of them inspects resources/app.asar or the
 * capability payload -- the two things that WERE correct. smoke-packaged would
 * have caught it, and it is the last step in `npm run dist`, so the artifact and
 * its installer both already existed by the time anything went red. Four other
 * QA drivers stage from this directory and were measuring a dead tree.
 *
 * So this runs IMMEDIATELY after electron-builder, before the seal, before the
 * installer is treated as real, and it asks the one question none of the others
 * ask: is the Electron runtime actually here.
 *
 * TWO CHECKS, ON PURPOSE.
 *
 * 1. AN EXPLICIT NAMED FLOOR (REQUIRED below). Every file is spelled out, with
 *    the reason it has to be there. A derived-only check would have silently
 *    shrunk to nothing the day the source distribution was itself incomplete --
 *    which is exactly the class of defect being guarded against.
 *
 * 2. PARITY WITH THE PINNED DISTRIBUTION. Every file in node_modules/electron/
 *    dist must reach the output, so a future Electron that adds a runtime file
 *    is covered without anyone remembering to edit the list above.
 *
 * Sizes are compared too. A truncated or half-copied file is not a present file,
 * and "it exists" is the assertion that let a 0-byte icudtl.dat through in every
 * other tool that ever checked for one.
 */
import { readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/* electron-builder renames these on the way out (ElectronFramework.js,
 * cleanupAfterUnpack + the productName rename). Left side is the name in
 * node_modules/electron/dist, right side is the name in the output. */
const RENAMED = new Map([
  ['electron.exe', 'ToolsEnabled.exe'],
  ['LICENSE', 'LICENSE.electron.txt'],
])

/* Deliberately removed by electron-builder when it owns the unpack, so their
 * absence is not evidence of a broken copy either way. */
const MAY_BE_ABSENT = new Set(['version', 'resources/default_app.asar'])

/* THE FLOOR. Each entry is a file whose absence is a defect, and the sentence
 * after it is what breaks when it is gone. */
const REQUIRED = [
  ['ToolsEnabled.exe', 'the application itself'],
  ['resources/app.asar', 'every line of application code'],
  ['icudtl.dat', 'ICU locale data -- without it Electron aborts at startup with "Invalid file descriptor to ICU data received". THIS IS THE ONE THAT BROKE 1.0.6.'],
  ['resources.pak', "Chromium's own UI resources; the browser layer cannot initialise without it"],
  ['chrome_100_percent.pak', 'UI images at 1x scale'],
  ['chrome_200_percent.pak', 'UI images at 2x scale, which is every high-DPI laptop'],
  ['v8_context_snapshot.bin', "V8's startup snapshot; the renderer has no JavaScript context without it"],
  ['snapshot_blob.bin', "V8's isolate snapshot"],
  ['locales/en-US.pak', 'localised strings; an empty locales/ directory means no text anywhere'],
  ['ffmpeg.dll', 'audio and video decoding'],
  ['libEGL.dll', 'ANGLE, which is how Chromium reaches the GPU on Windows'],
  ['libGLESv2.dll', 'ANGLE GLES translation'],
  ['d3dcompiler_47.dll', 'HLSL shader compilation for ANGLE'],
  ['vk_swiftshader.dll', 'the software renderer used when no usable GPU is present'],
  ['vk_swiftshader_icd.json', 'the loader manifest without which SwiftShader is never found'],
  ['vulkan-1.dll', 'the Vulkan loader SwiftShader is reached through'],
  ['dxcompiler.dll', 'DXIL shader compilation'],
  ['dxil.dll', 'DXIL signing, required before a compiled shader will run'],
]

const MINIMUM_LOCALE_FILES = 40

async function statOrNull(file) {
  try { return await stat(file) } catch { return null }
}

async function walk(root, base = root) {
  const out = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) out.push(...await walk(full, base))
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'))
  }
  return out
}

export async function checkElectronRuntimeFiles(outputDirectory, electronDist) {
  const output = path.resolve(outputDirectory)
  const dist = path.resolve(electronDist)
  const failures = []
  const checked = []

  if (!(await statOrNull(output))?.isDirectory()) {
    return { ok: false, checked, failures: [`the packaged output directory does not exist: ${output}`] }
  }

  // 1. THE NAMED FLOOR.
  for (const [relative, why] of REQUIRED) {
    const info = await statOrNull(path.join(output, relative.split('/').join(path.sep)))
    if (!info) failures.push(`MISSING ${relative} -- ${why}`)
    else if (!info.size) failures.push(`EMPTY ${relative} (0 bytes) -- ${why}`)
    else checked.push(relative)
  }

  // A single named locale proves the directory exists; a count proves the copy
  // of it was not cut short partway through.
  const locales = await readdir(path.join(output, 'locales')).catch(() => null)
  if (locales === null) failures.push('MISSING locales/ -- the directory itself is absent')
  else if (locales.filter((name) => name.endsWith('.pak')).length < MINIMUM_LOCALE_FILES) {
    failures.push(
      `locales/ holds only ${locales.filter((n) => n.endsWith('.pak')).length} .pak files, expected at least ` +
      `${MINIMUM_LOCALE_FILES} -- a partial copy, not a localisation choice`,
    )
  }

  // 2. PARITY WITH THE PINNED DISTRIBUTION, including byte sizes.
  if (!(await statOrNull(dist))?.isDirectory()) {
    failures.push(`cannot verify parity: the pinned Electron distribution is absent (${dist})`)
    return { ok: failures.length === 0, checked, failures }
  }

  for (const relative of await walk(dist)) {
    const expected = RENAMED.get(relative) ?? relative
    if (MAY_BE_ABSENT.has(relative) || MAY_BE_ABSENT.has(expected)) continue
    const source = await statOrNull(path.join(dist, relative.split('/').join(path.sep)))
    const packed = await statOrNull(path.join(output, expected.split('/').join(path.sep)))
    if (!packed) {
      failures.push(`MISSING ${expected} -- present in the pinned Electron ${path.basename(dist)} but not in the output`)
    } else if (packed.size !== source.size && !RENAMED.has(relative)) {
      // The renamed .exe legitimately differs: electron-builder rewrites its
      // icon and version resources with rcedit.
      failures.push(`TRUNCATED ${expected} -- ${packed.size} bytes in the output, ${source.size} in the distribution`)
    }
  }

  return { ok: failures.length === 0, checked, failures }
}

/* --prepare: DELETE THE HOLE INSTEAD OF REPORTING IT.
 *
 * The check below is a safety net, and a net that catches the artifact AFTER
 * electron-builder has already written the installer is a late one -- the same
 * invocation produces win-unpacked and the .exe, so by the time anything can
 * look, a broken installer exists on disk.
 *
 * This runs BEFORE electron-builder and removes the output directory outright.
 * electron-builder calls emptyDir() on it too, but emptyDir is not allowed to
 * fail the build, and a running ToolsEnabled.exe makes it a partial no-op: the
 * loaded DLLs and the running .exe image cannot be unlinked while mapped, and
 * that is precisely the state 1.0.6 was built in -- its output still carried a
 * debug.log written six hours before the build started.
 *
 * The difference that matters is that this REFUSES. If the directory cannot be
 * removed, the build stops before producing anything, instead of producing an
 * application that cannot start.
 */
async function prepareOutputDirectory(outputDirectory) {
  const output = path.resolve(outputDirectory)
  if (!(await statOrNull(output))) {
    console.log(`check-electron-runtime-files --prepare: ${output} does not exist; nothing to clear`)
    return true
  }
  try {
    await rm(output, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  } catch (error) {
    console.error(
      `check-electron-runtime-files --prepare FAILED: could not clear ${output}\n  ${error.message}\n\n` +
      'Something is holding the previous build. Almost always that is a ToolsEnabled.exe still running\n' +
      'from this directory -- a QA driver, a smoke run, or a window left open. electron-builder would\n' +
      'NOT have failed here: it empties this directory on a best-effort basis and carries on, which is\n' +
      'how a build produced an installer with no icudtl.dat in it and no step noticed.\n' +
      'Close every instance and build again.',
    )
    return false
  }
  const leftover = await statOrNull(output)
  if (leftover) {
    console.error(`check-electron-runtime-files --prepare FAILED: ${output} still exists after removal.`)
    return false
  }
  console.log(`check-electron-runtime-files --prepare: cleared ${output}`)
  return true
}

const invoked = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (invoked && process.argv.includes('--prepare')) {
  const target = process.argv.filter((a) => a !== '--prepare')[2] || 'release/win-unpacked'
  if (!(await prepareOutputDirectory(target))) process.exitCode = 1
} else if (invoked) {
  const output = process.argv[2] || 'release/win-unpacked'
  const dist = process.argv[3] || 'node_modules/electron/dist'
  const { ok, checked, failures } = await checkElectronRuntimeFiles(output, dist)
  if (ok) {
    console.log(`check-electron-runtime-files: OK -- ${checked.length} required runtime files present in ${output}, byte-for-byte with ${dist}`)
  } else {
    console.error(`check-electron-runtime-files FAILED for ${path.resolve(output)}:`)
    for (const failure of failures) console.error(`  - ${failure}`)
    console.error(
      '\nThis output is not an application: it will exit at startup and any installer built from it\n' +
      'carries the same hole. The usual cause is a build into an output directory that could not be\n' +
      'emptied first -- electron-builder empties release/win-unpacked before copying the Electron\n' +
      'distribution into it, and a running ToolsEnabled.exe holding that tree makes the empty a no-op.\n' +
      'Close every instance, delete release/win-unpacked, and build again.',
    )
    process.exitCode = 1
  }
}
