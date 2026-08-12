# TEAM 1 / A3 — does the shipped artifact carry tools/lib/vault-acl.ps1?

Tree: C:\Users\joshp\Desktop\wt-capability (branch packaging/capability-layer)
Payload source (private/capability-source.owner.json): C:/Users/joshp/Desktop/toolsenabled-current

## DEVIATION, FIRST LINE

I was asked to FIX the packaging so `tools/lib/` ships. I did not change the
packaging, because it was not broken. The packer already stages that directory
by rule, the newest installer on disk already contains it, and a vault operation
run against bytes taken out of that installer works. What I did instead is prove
all three, plus prove the ship chain refuses an artifact missing the file.

The premise sentence "every vault operation in the installed product fails
before reading anything" is TRUE OF A STATE THAT NO SHIPPED ARTIFACT WAS EVER
IN. The details are below, because the difference decides whether anyone needs
to do anything.

## What the four artifacts actually contain

| artifact | built | secrets.ps1 dot-sources lib/? | lib/ present | vault works |
|---|---|---|---|---|
| installed product `%LOCALAPPDATA%\Programs\toolsenabled` | 04:47 | **no** | no | yes (nothing to miss) |
| `release/win-unpacked` | 12:22 | yes | **yes** | yes — measured |
| `ToolsEnabled Setup 1.0.6.exe` | 12:23 | yes | **yes** | yes — measured |
| the harness's hybrid (see below) | n/a | yes | no | **no** — this is the failure that was measured |

The installed product predates the dependency. `tools/lib/vault-acl.ps1` and the
`. (Join-Path $PSScriptRoot 'lib/vault-acl.ps1')` line in secrets.ps1 were both
created in the engine tree at 2026-08-11 08:43 (f0b25c7). The installer that
produced the installed copy was built at 04:47, five hours earlier, and its
secrets.ps1 contains zero occurrences of the string `vault-acl`. A script that
does not dot-source a file cannot fail to find it.

## Where the "measured" broken state came from

tools/owner-account-packaged-qa.mjs:107 copies the TREE's staged `secrets.ps1`
into the already-packed artifact before driving it. Until `'lib'` was added
beside `'secrets.ps1'` in that copy list, the harness placed a NEW secrets.ps1
next to an OLD payload that had no lib/ — and then reported the resulting
CommandNotFoundException as a defect in the shipped artifact. The hybrid was
constructed by the harness. The comment at that line states the artifact
"carries tools/secrets.ps1 but NOT tools/lib/", which was true of that artifact
and irrelevant, because that artifact's own secrets.ps1 did not want the file.

## Why lib/ ships, and since when

pack-capability-layer.mjs `computePowerShellClosure()` walks the dot-source
graph of every declared helper program and stages what it finds. It landed in
7b1e346 ("Ship the vault program..."), which predates vault-acl.ps1's existence
entirely — so the day the dot-source was added, the file began shipping with no
manifest edit. `helperPrograms` in tools/capability-manifest.json still names
only `tools/secrets.ps1`; lib/vault-acl.ps1 is derived, exactly as designed.

config/payload-boundary.json:470 classifies it (a5be8ed, 09:40), which is the
other gate it had to pass.

## Evidence — vault operations, BY USE, against built artifacts

Runner: scratchpad/a3-vault-probe.ps1. `TOOLSENABLED_VAULT_PATH` redirected to a
scratch directory, so the vault file, its lock, its .bak and its access log all
land outside the artifact; nothing under release/ was written. No secret value
printed; the probe key is `a3-packaging-probe` holding a literal placeholder.

**release/win-unpacked** (6,284 ms):
`exists`→1 (absent) · `set-stdin`→0 · `exists`→0 (present) · `list`→0, 1 key,
contains probe · `del`→0 · `exists`→1 (absent again).

**Bytes extracted from `ToolsEnabled Setup 1.0.6.exe`** (6,272 ms) — installer →
`$PLUGINSDIR\app-64.7z` → `resources\capability\tools\` (19 files), unpacked with
node_modules/electron-winstaller/vendor/7z.exe. Same six steps, same results.
sha256 of both files identical to the staged tree copy:
secrets.ps1 `DBB7F667…`, lib\vault-acl.ps1 `6DBA4851…`.

vault-acl.ps1 did not merely load, it FUNCTIONED: the vault directory it created
carries a PROTECTED DACL — exactly three explicit ACEs (SYSTEM, Administrators,
the owning account), no `(I)` inherited ACE anywhere. That is the defect that
file exists to fix, observed working out of the installer.

**Negative control** — the artifact's .ps1 files copied to scratch WITHOUT lib/:
`CommandNotFoundException … lib\vault-acl.ps1 is not recognized`, exit 1, before
reading anything. The failure mode in the task description is real; the artifact
is simply not in it.

## Evidence — the ship chain is fail-closed on this, A/B controlled

One disposable copy of release/win-unpacked (354.9 MB, 332 files → 331 with the
file removed), same path both runs, only variable is lib/vault-acl.ps1:

- lib/ REMOVED  → `node tools/smoke-packaged.mjs <copy>` **bare exit 1**, 12,498 ms.
  `FAIL: The audit ledger could not be read on a fresh install` /
  `The audit signing key cannot be read in this Windows identity or vault context.`
- lib/ RESTORED → **bare exit 0**, 9,380 ms.
  `CAPABILITY PASS tool=system.status audit_sequence=1 audit_action=mcp.tool.succeeded signed_by=audit-ed25519-4f43cd74da… sterile_profile=yes`

Gate 20 of `npm run dist` therefore refuses a build whose vault script cannot
start. No new guard is needed at artifact level; one already fires.

## Finding I did NOT act on: the pack-time walk is fail-OPEN

Measured by calling the real `computePowerShellClosure()` (not a re-typed regex)
against seven dot-source spellings — scratchpad/a3-closure-probe.mjs:

| spelling | staged? | reported? |
|---|---|---|
| `. (Join-Path $PSScriptRoot 'lib/vault-acl.ps1')` — today's | YES | — |
| `. "$PSScriptRoot\lib\vault-acl.ps1"` | YES | — |
| `. (Join-Path $PSScriptRoot "lib/vault-acl.ps1")` | YES | — |
| `. (Join-Path (Join-Path $PSScriptRoot 'lib') 'vault-acl.ps1')` | no | **silent** |
| dir hoisted into a variable first | no | **silent** |
| `. "${PSScriptRoot}/lib/vault-acl.ps1"` | no | **silent** |
| `Import-Module (Join-Path (Join-Path $PSScriptRoot 'lib') 'x.psm1')` | no | **silent** |

A reference the walk cannot parse is skipped, not reported — absence read as
consent, in the packer that ships the vault. No shipped .ps1 uses any of those
four forms today (all three dot-sources in the artifact resolve), and gate 20
catches the consequence downstream, so this is a lateness cost rather than a
ship risk: the build would die at gate 20 after electron-builder instead of at
gate 6. Closing it means a new fail-closed guard, which is not what I was asked
for and would collide with nobody but was not mine to decide. Reporting, not
doing.

## Caveats a reviewer should hold me to

- I did not build the artifact I verified. `Setup 1.0.6.exe` @ 12:23 and
  win-unpacked @ 12:22 were produced by another run after A1's 11:59 build
  (different byte count: 101,887,681 vs A1's 101,871,016). I made no source
  change, so there was nothing to rebuild for, and re-running `npm run dist`
  would have destroyed release/ underneath a wave-2 lane driving it.
- That installer is a MEASUREMENT artifact, not a release candidate. I read its
  stamp myself out of the packed asar: `dirty:true, overridden:true`.
  cut-release-candidate.mjs:356 refuses any artifact with that stamp.
- I did not install the .exe. Install and upgrade behaviour is the wave-2 NSIS
  lane's. I unpacked the installer's payload instead and ran the vault out of
  those exact bytes.
- The DACL evidence is from a vault created under a scratch path, not under an
  installed program directory.

## Territory

Edited: this file only. No packaging file changed. No wave-2 file touched. No
git write command run. Nothing under release/ or capability/ was modified;
every fixture lived in the session scratchpad and the large ones were deleted.
