/* Read Windows VersionInfo off a real .exe -- never from package.json.
 *
 * The whole point of a build declaration is that its fields are MEASURED,
 * not intended: package.json says what electron-builder was TOLD to embed,
 * this reads what actually landed in the compiled resource section. The two
 * have already disagreed once in this project's history (see the
 * build.win.publisherName incident, commit ab495f3) -- that class of bug is
 * exactly what a config-only declaration would miss.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export async function readExeVersionInfo(exePath) {
  // -LiteralPath so a filename containing brackets or wildcards (unlikely,
  // but "ToolsEnabled Setup 1.0.1.exe" is user-visible product naming,
  // not a controlled identifier) is read literally, not glob-expanded.
  // PowerShell's default console output encoding on Windows is a legacy
  // codepage, not UTF-8 -- without forcing it, non-ASCII bytes (e.g. the "©"
  // in LegalCopyright) get mangled between here and Node's utf8 stdout
  // decode. Force it before anything is written.
  const script =
    `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ` +
    `$ErrorActionPreference = 'Stop'; ` +
    `$info = (Get-Item -LiteralPath '${exePath.replace(/'/g, "''")}').VersionInfo; ` +
    `$info | Select-Object CompanyName,ProductName,FileVersion,ProductVersion,FileDescription,LegalCopyright,OriginalFilename | ConvertTo-Json -Compress`

  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true, timeout: 20_000, maxBuffer: 1024 * 1024 },
  )

  const parsed = JSON.parse(stdout.trim())
  return {
    companyName: parsed.CompanyName ?? null,
    productName: parsed.ProductName ?? null,
    fileVersion: parsed.FileVersion ?? null,
    productVersion: parsed.ProductVersion ?? null,
    fileDescription: parsed.FileDescription ?? null,
    legalCopyright: parsed.LegalCopyright ?? null,
    originalFilename: parsed.OriginalFilename ?? null,
  }
}
