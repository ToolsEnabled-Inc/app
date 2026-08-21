/* File hashing and byte counting for release artifacts.
 *
 * Uppercase hex, no separators -- matches PowerShell's Get-FileHash output
 * exactly, which is what Machine B measures with on the receiving end. A
 * declaration whose own hash format required translation before a stranger
 * could compare it by eye would be a needless source of "is that the same
 * hash" hesitation at the one moment it matters most.
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'

export async function sha256File(filePath) {
  const hash = createHash('sha256')
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', resolve)
    stream.on('error', reject)
  })
  return hash.digest('hex').toUpperCase()
}

export async function measureFile(filePath) {
  const stats = await stat(filePath)
  const sha256 = await sha256File(filePath)
  return { path: filePath, bytes: stats.size, sha256, mtime: stats.mtime.toISOString() }
}

/** Byte-for-byte identity check between two already-measured files -- used to
 * prove a staged copy is identical to what was actually built, not just
 * "probably fine because the copy command didn't error." */
export function sameBytes(measuredA, measuredB) {
  return measuredA.bytes === measuredB.bytes && measuredA.sha256 === measuredB.sha256
}
