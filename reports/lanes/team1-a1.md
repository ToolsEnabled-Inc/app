# TEAM 1 / A1 — full dist chain, bare exit codes

Tree: C:\Users\joshp\Desktop\wt-capability (branch packaging/capability-layer)
Payload source (private/capability-source.owner.json): C:/Users/joshp/Desktop/toolsenabled-current
Method: every one of the 25 gates in the `dist` script invoked individually with the
PowerShell call operator; `$LASTEXITCODE` read on the very next statement. No pipe,
no Tee-Object, no redirection anywhere in the measurement path. Runner:
scratchpad/run-gates.ps1.

## HEADLINE

The chain is GREEN end to end except for ONE condition, which appears TWICE:
the dirty-tree provenance gate. Gate 10 (`require-clean-tree`) and gate 14
(`check-asar-manifest`) both refuse, both for the same reason, and both are
satisfied by the same `MC_ALLOW_DIRTY_BUILD=1` broadcast override. Nothing else
in the chain refused. There is no second, hidden defect behind the first one.

A NEW INSTALLER NOW EXISTS AND CONTAINS THE WAVE FIXES:
`release\ToolsEnabled Setup 1.0.6.exe` 101,871,016 bytes @ 2026-08-11 11:59:43
(previous: 101,768,764 bytes @ 05:51 — overwritten). It is stamped
`dirty:true, overridden:true` inside `dist/build-info.json`, which ships inside
the package. It is a MEASUREMENT ARTIFACT, not a release candidate — see below.

## Pre-state (read before any gate ran)

- `ToolsEnabled Setup 1.0.3.exe`  Aug 11 04:47
- `ToolsEnabled Setup 1.0.6.exe`  Aug 11 05:51  <- newest installer, pre-run
- `release/win-unpacked/ToolsEnabled.exe` Aug 11 07:27 <- NEWER than any installer

A win-unpacked was produced at 07:27 and no installer ever came out of it.
Confirms the premise the lane exists to change.

## Gate log — all 25, bare exit codes

| # | gate | bare exit | ms |
|---|------|-----------|-----|
| 0 | verify (test-ratchet) | 0 | 95003 |
| 1 | check-research-queue | 0 | 72 |
| 2 | check-data-schemas | 0 | 67 |
| 3 | check-license-notices (repo) | 0 | 46 |
| 4 | build (vite) | 0 | 7236 |
| 5 | check-renderer-payload (dist) | 0 | 89 |
| 6 | pack:capability | 0 | 1288 |
| 7 | check-product-naming | 0 | 63 |
| 8 | check-payload-current | 0 | 136 |
| 9 | check-payload-boundary (staged) | 0 | 86 |
| 10 | **require-clean-tree** | **1** (0 with override) | 353 / 282 |
| 11 | launch-readiness-sync | 0 | 157 |
| 12 | electron-builder (nsis) | 0 | 38994 |
| 13 | strip-build-diagnostics | 0 | 49 |
| 14 | **check-asar-manifest** | **1** (0 with override) | 247 / 135 |
| 15 | check-renderer-payload (packed) | 0 | 48 |
| 16 | check-no-owner-data (win-unpacked) | 0 | 33834 |
| 17 | check-license-notices (packed) | 0 | 81 |
| 18 | check-payload-boundary (packed) | 0 | 90 |
| 19 | seal-artifact --record | 0 | 606 |
| 20 | smoke-packaged | 0 | 10747 |
| 21 | check-install-dir-immutable | 0 | 34626 |
| 22 | seal-artifact --verify | 0 | 642 |
| 23 | check-payload-boundary (packed2) | 0 | 60 |
| 24 | check-no-owner-data (release) | 0 | 54664 |

test-ratchet: 1179 tests, 1178 pass, 1 fail — the single failure is the
adjudicated `contract #7` port-scan case already in tools/test-baseline.json
(ruling: the TEST is wrong, the code is right). Not a masked regression.

## Gate 10/14 diagnosis — exactly which paths, and whose

App repo c6a8170b1e23 — 31 uncommitted. Payload repo 0c1ba0651f9b — 21 uncommitted.

WAVE-2 LANE WORK IN FLIGHT (legitimate, will clear when the coordinator commits):
- app: public/durable-storage.js, src/settings.css, src/views/account.js
  (renderer settings/appearance/checkout-selection lanes)
- app: tools/agent-subpage-qa.mjs, tools/page2-qa.cjs (QA driver lanes)
- app: build/ (installer.nsh — NSIS lane), tools/test/nsis-upgrade-rescue.test.mjs
- payload: src/lib/cloud-agent/codex-cloud-launch.js, src/lib/runtime.js,
  src/lib/status-injection.js, src/lib/tool-registry.js, tools/test-baseline.json,
  src/lib/mission-bridge/actions.js, src/lib/providers/web.js, and their tests

NOT LANE WORK — cruft that gates the ship chain for no benefit:
- app: 20 tracked DELETIONS under artifacts/p5/ and artifacts/phase2-shadow/.
  `/artifacts/` was later added to .gitignore, but these were committed before
  that, so deleting them registers as dirty. They are dead QA output.
- app: main.js at repo root, untracked, 312 lines — it is Electron's stock
  default_app bootstrap, NOT product code (package.json main is shell/main.cjs,
  and build.files ships only dist/** + shell/**, so it does not enter the asar;
  gate 14 confirms 63 declared files, main shell/main.cjs). Stray from some
  `electron .` run. It gates the build and ships nothing.
- payload: `[eval]/`, `mutant`, `canon_ledger.txt`, `context/.prior-work-cache.json`
- app: reports/lanes/*.md — INCLUDING THIS FILE. See the structural note below.

## Structural finding: the lane-report convention blocks its own ship chain

Every agent is instructed to append progress to reports/lanes/<team>-<task>.md.
Those files are untracked, so each one increments the dirty count and helps hold
require-clean-tree shut. .gitignore already carves out exactly this class of
self-inflicted blocker twice — for error.log and for /artifacts/ — with comments
saying so in as many words. reports/lanes/ is the same shape of problem and has
no carve-out. I did NOT apply this: making lane reports invisible to the
provenance gate is a policy call about what "reproducible" means, and the
coordinator may prefer to commit them instead. Recommending, not doing.

## Why the override was used, and why that is safe

`cut-release-candidate.mjs:356` refuses any artifact whose build-info reports
`dirty !== false || overridden !== false`. So this build physically cannot be
promoted into a release candidate by any path — the downstream packager rejects
it. That is what makes using the designed, self-broadcasting override the right
way to get a real measurement of the 14 gates that live behind gate 10, rather
than guessing at them. The override does not silence anything: the full 52-path
list is written into dist/build-info.json and ships inside the .exe, and gate 14
re-prints it as "SHIPPING A DIRTY BUILD".

Note the two gates are independent: setting the variable for gate 10 only is not
enough, gate 14 re-reads the record and refuses again. In a real `npm run dist`
both see one process env, so this only bit the gate-by-gate measurement.

## What gate 11 proved about the OLD artifact

launch-readiness-sync compared the staged payload against what was already inside
release/win-unpacked: **stale=1 missing=6 differing=23** — 30 files out of date,
including runtime.js, tool-registry.js, codex-cloud-launch.js, state-store.js,
audit-store.js, settings-registry.json. Independent mechanical confirmation that
the artifact on disk did not contain the engine fixes.

## Use-level evidence on the artifact just built

- gate 20 smoke-packaged: launched the packaged app, port=4601, http_status=200,
  marker_found=true, window_title_error=false; then round-tripped a real
  capability call — tool=system.status, audit_sequence=1,
  action=mcp.tool.succeeded, signed, sterile_profile=yes.
- gate 21 check-install-dir-immutable: launched the GUI and a PowerShell helper
  across 5 phases; all runtime state landed under AppData, install dir
  byte-unchanged (360 entries re-hashed).
- gate 22 seal-artifact --verify: 332 files byte-identical to the seal.
- gates 16/24 check-no-owner-data: 332 files / 372 MB and 344 files / 577 MB
  scanned, 0 matches on every owner-identity pattern.

NOT done: the .exe installer was not itself run/installed. Install behaviour and
the upgrade path belong to the wave-2 NSIS lane.

## Disclosure: what is inside this installer that is not in git

electron-builder's default buildResources dir is `build/`, and NSIS auto-includes
`build/installer.nsh` when present. That file is the wave-2 NSIS lane's untracked,
in-flight script (modified 11:36). This installer therefore embeds a mid-flight
NSIS script. I did not read past confirming its existence and did not touch it.

## Territory

Edited: this file only. Regenerated (all gitignored, all Team-1 territory):
dist/, capability/, release/. No wave-2 file touched. No git write command run.
