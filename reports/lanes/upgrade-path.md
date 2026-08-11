# Lane: upgrade-path (session 6e870ec4)

Task: verify BY USE (1) settings persistence across port change + unreadable settings
file, (2) no runtime writes into the install directory, (3) the upgrade path itself.
Measure the ARTIFACT (app.asar / release), not the tree.

## Progress
- [start] Oriented: wt-capability @ packaging/capability-layer, HEAD 7326f0c.
  Prior lane commits found: b3af448 (NSIS GUID pin), 3e49cf1 (version 1.0.6 guard),
  482bed8/fc3dbb2 (port-independent settings), 38fa86c/945281e (unreadable settings),
  d4f16a9/dec34d9 (userData carry-over), 3da63c1 (install-dir immutability gate).

- [measure 1] ARTIFACT release/win-unpacked (built 07:27) FAILS
  `node tools/check-install-dir-immutable.mjs release/win-unpacked` (exit 1, 36.6s):
  phase 0 helper sweep + phase E behavioural both red. browser.status resolved its
  profile to release/win-unpacked/resources/capability/profiles/chrome — INSIDE the
  install dir. Cause: the artifact ships PRE-FIX .ps1 helpers.
  source(toolsenabled-current/tools/*.ps1): fix PRESENT (07:56)
  staging(wt-capability/capability/tools/*.ps1): fix PRESENT (repacked 08:27 by another lane)
  packaged(release/win-unpacked/resources/capability/tools/*.ps1): fix ABSENT
  => "fix in source, absent from the artifact", exactly as the lane brief warned.
- [measure 2] `node tools/check-payload-current.mjs capability` exit 1: staged
  src/lib/providers/chrome-web-store.js differs from source. Staging is ALSO not current.
- [measure 3] REAL machine: %APPDATA%\ToolsEnabled\.userdata-adoption.json =
  {status:complete, adopted:false, reason:NO_PRIOR_INSTALL} while %APPDATA%\Mission Control
  still holds shell-state.json(73) + agent-spawn-key.enc(150) + agent-spawn-records.jsonl(2584).
  Dry-run of the CURRENT module against the real layout decides ADOPTED — but the poisoned
  record makes it ALREADY_DECIDED forever.

## Verdicts (measured, this tree, 2026-08-11)

CLAIM 1 — settings across a port change and across an unreadable settings file: TRUE.
  `node tools/prefs-origin-proof.mjs release/win-unpacked` exit 0, 15,988 ms.
  fresh install 4603->4604 and existing install 4602->4603 both painted "black";
  the unreadable record survived byte-identical as
  renderer-prefs.damaged-2026-08-11T15-49-39-706Z.json and the window said so.
  REMAINING HALF: the tool itself reports "NOT RUN: upgrade from the old build.
  Set MC_PREFS_LEGACY_BUILD=<pre-fix win-unpacked>" — the localStorage->durable
  MIGRATION from a genuinely pre-fix build is not measured; no pre-fix unpacked
  build exists on disk to point it at.

CLAIM 2 — no runtime writes into the install directory: FALSE ON THE ARTIFACT,
  TRUE once the artifact is rebuilt.
  shipped release/win-unpacked: exit 1 (36,639 ms) — phase 0 helper sweep names
  tools/browser.ps1:369, tools/desktop.ps1:205, tools/owner-prompt-queue.ps1:37,
  and phase E behaviourally resolved a browser profile INSIDE the install dir.
  isolated copy with resources/capability refreshed from the staged payload:
  exit 0 (61,023 ms), "the install directory is byte-unchanged (356 entries)".

CLAIM 3 — the upgrade path: PARTLY FALSE. Two defects found; one fixed here.
  (a) FIXED: an unevidenced NO_PRIOR_INSTALL verdict stranded a prior install
      permanently. Measured on this machine and now reproduced in the packaged app.
  (b) OPEN, not fixed here: node_modules/app-builder-lib/templates/nsis/
      uninstaller.nsh:187 `RMDir /r $INSTDIR`. The upgrading installer runs the
      OLD uninstaller first, so the install-directory rescue in
      runtime-state-root.js (gate phase D) can never fire on a real NSIS upgrade.

## What I changed
- shell/userdata-adoption.cjs — a NO_PRIOR_INSTALL verdict now records the evidence
  behind it (`searched: [{directory, holdsProductState}]`, RECORD_VERSION 2) and is
  honoured only while that evidence holds. No evidence, an empty/ill-shaped list, an
  unexamined candidate, or a candidate that has since gained product state reopens the
  question exactly once. ADOPTED / TARGET_ALREADY_IN_USE / damaged stay permanent.
- tools/test/userdata-adoption.test.mjs — 7 new tests. Mutation-verified: with
  negativeVerdictIsStale() forced to `return false` in a sha256-identical throwaway
  copy, 5 of them fail and all 14 pre-existing ones still pass.
- tools/userdata-adoption-packaged-proof.mjs — second scenario: plant the exact
  evidence-free verdict measured on this machine plus settings of the person's own,
  launch the packaged exe, require the rescue AND require their current settings
  untouched. Also removed a race I introduced (the Cache assertion now keys on a
  marker filename Chromium never writes).
- tools/check-install-dir-immutable.mjs — phase D comment now states what it does not
  prove, with the NSIS line numbers.

## Final evidence (current tree)
- node --test (userdata-adoption + renderer-prefs + installer-product-identity):
  61/61 pass, 3,484 ms. check-suites-discovered: 89/89, exit 0.
- packaged proof on the isolated artifact carrying the fix: exit 0, 7,533 ms.
- same proof on the shipped pre-fix release/win-unpacked: exit 1, 63,741 ms,
  "the application never replaced the verdict ... carries no evidence".
- prefs-origin-proof on the fixed artifact: exit 0, 13,353 ms (no regression).
- check-install-dir-immutable on the fixed artifact: exit 0, 39,608 ms.
