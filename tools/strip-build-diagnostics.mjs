/* Remove electron-builder's diagnostic sidecar from the release directory.
 *
 * builder-debug.yml is written by electron-builder alongside the installer. It
 * is NOT part of the installer and never reaches a user who runs the .exe --
 * but it records the BUILD MACHINE's absolute paths (NSIS include directories,
 * %TEMP% paths, the electron-builder cache), which on this machine means the
 * owner's home directory. Anyone who shipped or published the whole release
 * folder would hand those over.
 *
 * Note carefully what this is NOT: it is not a way to make the owner-data
 * guard pass. The guard's patterns were deliberately left untouched. The
 * product was already clean -- 0 matches across the app.asar and the installer
 * .exe -- and only the output FOLDER was dirty, because of this one build
 * byproduct. Deleting a file that should not be distributed is the honest fix;
 * loosening the guard to stop it reporting would have been the
 * fix-that-satisfies-its-own-test trap, and the guard is the only thing
 * standing between us and shipping his home directory again.
 */
import { rm } from 'node:fs/promises'
import path from 'node:path'

const DIAGNOSTIC_FILES = ['builder-debug.yml']

async function stripBuildDiagnostics(releaseDirectory) {
  const directory = path.resolve(releaseDirectory)
  const removed = []
  for (const name of DIAGNOSTIC_FILES) {
    const target = path.join(directory, name)
    await rm(target, { force: true })
    removed.push(name)
  }
  return { directory, removed }
}

const invokedDirectly = process.argv[1]
  && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href

if (invokedDirectly || process.argv[2]) {
  const target = process.argv[2] || 'release'
  const { directory, removed } = await stripBuildDiagnostics(target)
  console.log(`[strip-build-diagnostics] ${directory} -> removed ${removed.join(', ')}`)
}

export { stripBuildDiagnostics, DIAGNOSTIC_FILES }
