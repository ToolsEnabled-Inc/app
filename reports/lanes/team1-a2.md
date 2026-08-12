# TEAM 1 / A2 — does the packed-payload sync close the gap?

Tree: C:\Users\joshp\Desktop\wt-capability (branch packaging/capability-layer)
Task as given: prove `tools/launch-readiness-sync-packed-payload.mjs`, now wired into
the dist chain before electron-builder, closes the 26-path gap; show 0 stale / 0
missing / 0 differing against a fresh artifact; prove an excluded file cannot survive
a rebuild.

## DEVIATION FROM THE TASK AS WRITTEN — READ THIS FIRST

The task's premise is false, and I could not prove the thing I was asked to prove
because it is not true. **The sync tool is not what closes the gap.** electron-builder
already wipes `release/win-unpacked` on every build in this configuration. The
requested end state (0/0/0, no excluded file surviving) is real and is now proven —
but it is produced by electron-builder, not by the new tool, and it was already being
produced before the tool was added to the chain.

Everything the task wanted demonstrated IS demonstrated below. The attribution is what
changed.

## The premise, and why it does not hold here

`tools/launch-readiness-sync-packed-payload.mjs` states in its own header:

> the default unpack path is `extractArchive(zipPath, appOutDir)` with no emptyDir;
> emptyDir runs only on the custom-electronDist branch

That reading of `app-builder-lib` is correct. What it misses is that **this project is
on the custom-electronDist branch.** `package.json` → `build.electronDist` is
`"node_modules/electron/dist"`.

Walking `node_modules/app-builder-lib/out/electron/ElectronFramework.js`:

- L200-202 `electronDist` is a non-empty string → `selectElectron(...)`.
- L170 not a `.zip` → skip.
- L175 it IS a directory → L177 read it, look for `electron-v43.3.0-win32-x64.zip`.
  That zip is **not** there (measured: `ls node_modules/electron/dist/*.zip` → no
  match; the directory holds the already-unpacked electron.exe, resources/, locales/).
- L183-193 therefore "custom already-unpacked Electron distribution" →
  **L189 `await emptyDir(prepareOptions.appOutDir)`**, then `copyDir`.

`appOutDir` is `release\win-unpacked`. It is emptied in full on every single build.
electron-builder confirms the branch in its own log, every run:

```
• using custom unpacked Electron distribution  electronDist=node_modules\electron\dist
• copying unpacked Electron  source=...\node_modules\electron\dist destination=...\release\win-unpacked
```

So the packed payload is not "the union of every payload ever built". There is no
accumulation to prune.

## The discriminating experiment

Planted two files in the packed payload that are not in the staged closure —
`src/lib/cerberus-correction-loop.js` (the exact file the tool's header cites as having
survived) and `src/lib/zzz-a2-probe-dir/excluded-probe.js` (a directory the payload has
never had). Then ran **electron-builder alone, with the sync never invoked.**

| step | result |
|---|---|
| plant 2 probes, `sync --check` | `stale=2 missing=0 differing=0`, exit 1 — detected |
| `electron-builder --win nsis` **alone, no sync** | exit 0, 48076 ms |
| probe 1 present after? | **False** |
| probe 2 present after? | **False** |
| `sync --check` after | `stale=0 missing=0 differing=0`, exit 0, 116 ms |

An excluded file cannot survive a rebuild. It also could not have survived one before
this tool existed. That is the whole finding.

## The wipe covers the entire artifact, not just the payload

Planted three probes at three depths and ran the chain in its **wired order** (sync,
then electron-builder):

| probe | after the sync | after electron-builder |
|---|---|---|
| `win-unpacked/zzz-a2-root-probe.txt` | **survived** | removed |
| `win-unpacked/resources/zzz-a2-resources-probe.txt` | **survived** | removed |
| `win-unpacked/resources/capability/src/lib/cerberus-correction-loop.js` | removed | removed |

The sync's authority stops at `resources/capability`; it left the other two untouched
and reported success. `emptyDir` is what removes all three. The narrower tool is
strictly dominated by the mechanism already in place.

## Consequence: at its wired position the sync cannot affect the artifact

The chain runs `launch-readiness-sync-packed-payload.mjs && electron-builder --win nsis`.
The sync writes into `release/win-unpacked/resources/capability`; electron-builder then
calls `emptyDir` on `release/win-unpacked`, the parent. Every byte the sync wrote or
removed is deleted microseconds later and rewritten from `capability/`. The tool is a
no-op with respect to the shipped artifact, and its success message describes a
directory that no longer exists by the time the artifact does.

This is not a claim that the tool is wrong — it is careful, it fails closed, and it
would be correct on the default-electronDist branch. It is wired at the one position
where it cannot matter, and its passing report is therefore not evidence about the
artifact.

## What IS proven about the artifact now on disk

Artifact: `release\ToolsEnabled Setup 1.0.6.exe` 101,887,681 bytes @ 2026-08-11 12:23:34,
`release\win-unpacked` sealed at 19:25:04Z.

- `sync --check`: `staged 251 files / packed 251 files / stale=0 missing=0 differing=0`,
  exit 0, 142 ms — the requested measurement.
- **Independent of that tool**, a PowerShell SHA256 diff of the two directories:
  `staged=251 packed=251 onlyPacked=0 onlyStaged=0 hashMismatch=0`.
- **Inside the installer .exe**, not merely win-unpacked. Extracted
  `$PLUGINSDIR\app-64.7z` (101,359,666 bytes, stamped 12:23:30) and unpacked
  `resources/capability` from it: `staged=251 inInstaller=251 onlyInstaller=0
  onlyStaged=0 hashMismatch=0`. The excluded `cerberus-correction-loop.js` is absent
  from the installer. `src/lib/runtime.js`, `src/lib/tool-registry.js` and
  `src/lib/cloud-agent/codex-cloud-launch.js` are present and byte-identical to staged.
  This is the direct answer to "nothing verified exists in any installable artifact":
  it does now.
- Post-build gates re-run green: strip-build-diagnostics 0, check-asar-manifest 0
  (250 payload files + PAYLOAD.json = the 251 on disk), check-renderer-payload 0,
  check-license-notices 0, check-payload-boundary 0, check-product-naming 0,
  check-no-owner-data 332 files / 372,140,802 bytes / **0 matches** on every pattern.
- **By use**: `smoke-packaged` launched the built artifact — `port=4601 http_status=200
  marker_found=true window_title_error=false`, then round-tripped a real capability call
  `tool=system.status audit_sequence=1 audit_action=mcp.tool.succeeded` signed,
  `sterile_profile=yes`. Exit 0, 20423 ms.
- `seal-artifact --verify`: 332 files byte-identical after the app had been run.

## Absence case (the tool deletes files, so this matters)

Run against a throwaway copy of the packed payload, 251 files before:

| case | result |
|---|---|
| `--staged <path that does not exist>` | refused, exit 2, "an absent payload is not an empty one" |
| `--staged <existing empty directory>` | refused, exit 2, "Refusing rather than treating it as the truth" |
| files in the victim copy afterwards | 251 — **delta 0** |

Absence is handled correctly: it refuses and deletes nothing. No absence-as-consent
defect in this tool.

## Two things found while measuring, for the coordinator

**1. `vite build` from a concurrent lane silently strips the artifact's provenance.**
`dist/build-info.json` was absent when I went to rebuild. `dist/assets/*` and
`dist/index.html` were rewritten at 12:22:10, after my 12:21:12 build finished — another
lane ran `npm run build`, and vite empties `dist/` on the way, taking the provenance
record with it. In a serial `npm run dist` the order (build at gate 4, require-clean-tree
at gate 10) makes this impossible; it only bites under concurrent lanes. I re-ran
`require-clean-tree.mjs dist` and rebuilt, so the artifact on disk does carry its record.
Not a chain defect — a shared-`dist/` collision, worth knowing while six lanes are live.

**2. `src/lib/status-injection.js` does not ship.** A wave-2 engine lane is editing it
(21,724 bytes, modified 11:45, in the engine tree). It is not in the staged capability
closure and therefore not in the artifact — confirmed absent from the installer payload.
This may well be intentional. Flagging it because a fix landing in a file outside the
payload closure will not reach the desktop artifact, and that is the exact failure this
wave exists to stop.

## Provenance of this build

Stamped `dirty:true, overridden:true` via `MC_ALLOW_DIRTY_BUILD=1` — the tree carries
live wave-2 work in both repos (app `c6a8170b1e23`, payload `7ff4fc2496bb`; note the
payload ref has moved since A1's `0c1ba0651f9b`, so this artifact carries newer engine
work than A1's did). `cut-release-candidate.mjs:356` refuses any artifact whose
build-info reports `dirty !== false`, so this cannot be promoted to a release candidate
by any path. It is a MEASUREMENT ARTIFACT, same status as A1's. It also embeds the
wave-2 NSIS lane's in-flight `build/installer.nsh` and whatever renderer state the
concurrent `dist/` build left, exactly as A1 disclosed.

## Territory

Edited: this file only. Regenerated (all gitignored, Team-1 territory): `dist/build-info.json`,
`release/`. No wave-2 file touched, no `package.json` edit applied (returned as a shared-file
edit instead). No git write command run. Probe files were all created inside `release/`
and are gone — the final artifact was verified clean by full-directory hash after them.
