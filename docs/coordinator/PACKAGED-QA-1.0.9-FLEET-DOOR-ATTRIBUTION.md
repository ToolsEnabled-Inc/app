# Packaged QA 1.0.9 — fleet-door cluster attribution (2026-08-15)

Verdict for the `qa:packaged` 16/37 red run against the sealed 1.0.9
candidate (`ToolsEnabled Setup 1.0.9.exe`, SHA-256
`B383361C2B8931E835511C6065F10A1393FA5FFAF58C854A040AF6B64BCEA9D3`,
sourceRef `184af5d`, buildRef `3902f76`, payload engine `ac97673`):

**The product's computers page (pg2) is NOT broken.** The red cluster is
harness/scenario attribution. Verdict class: MIXED, zero pg2-blocking
product defects.

## Direct measurement of the sealed build

An independent CDP probe drove the sealed unpacked build itself
(`release\win-unpacked\ToolsEnabled.exe` from the kept 1.0.9 build
worktree; headless, isolated profile, ephemeral debug port; no 4610-4619
listener touched; compose cancelled, nothing dispatched):

- Fresh profile: `#/setup` → skip → `#/computers` mounts; the live board
  is the default (owner's 2026-08-06 live-by-default ruling,
  `src/live-flags.js:9-15`).
- The empty state renders in words: "This computer · 0 services … No
  local agent fleet host detected on this machine…" plus FLEET OVERVIEW.
- `.tree-empty-node` is a real BUTTON (67×67, visible, hit-testable,
  aria "Empty spot. Press to start an agent here.").
- Pressing it opens the compose panel: 6-role menu, message textarea,
  "Not now", and an enabled visible `[data-compose-action="submit"]`
  labeled "Start this agent".
- Simulated board: 9 `.static-tree-node`; single click opens the rail
  (AGENT CONTROLS, Runtime Statistics, transcript). `page2-qa` passed
  40/42 against this build (both fails = console-noise gate tripping on
  the benign `ResizeObserver loop completed with undelivered
  notifications` warning); `agent-subpage-qa` passed 65/65.
- `[data-research-file-box]` ("Filed under") IS in the sealed bundle
  (`app.asar` → `dist/assets/index-CGISLT_B.js`), wired in the live
  rail's Details tab, gated on `node.sessionId`
  (`src/views/computers.js:3075-3080`). A session-less node cannot exist
  (compose submit is the only creation path), so the box is only
  visually confirmable with a live provider session — designed gating,
  not a break. The live board mounts research wiring ("No research
  projects exist yet. Create one on the research page first.").

## Per-driver classification of the red cluster

Never measured anything (pre-launch death):

- `approvals-decision-outcome-qa.cjs`, `write-outcome-restate-qa.cjs` —
  crash at load under plain `node` v22.19.0 (`require('electron').app`
  undefined outside Electron). Suite registration gap: Electron-main
  drivers spawned under node. No window, no CDP, no product measurement.
- `google-signin-live-qa` — refused to start:
  `TOOLSENABLED_GOOGLE_CLIENT_ID` unset (known empty clientId).
- `purchase-cart-readable-qa` — precondition absent (empty owner queue);
  its own log says "This is not a pass."

Measured, but the scenario is unsatisfiable by design (fresh LIVE
profile has no agents, so no agent door/rail/Team/Loop panel exists):

- `window-size-sweep` (×5 widths), `team-panel-packaged`,
  `loop-packaged`, `test-account-journey` ("node=absent"),
  `a11y-keyboard`, `refusal-copy`, `stranger-onboarding` broken-cli leg.
  `window-size-sweep`'s own DOM dump shows the intended empty state
  rendered (`.tree-empty-node=1 .graph-open-btn=1`), and its comment
  block (`tools/window-size-sweep-qa.mjs:117`) declares
  `.tree-empty-node` "NOT a door" — the drivers expect an agent door on
  a virgin live board. `team-panel`/`loop` then die in their own
  TypeError (`team-panel-packaged-qa.mjs:316`, `.disabled` of
  undefined) — harness crash, not a finding. Whether a stranger should
  get a door to the example fleet from the live empty state is a
  product-copy question, not a regression.

Contradicted by the sealed-build measurement:

- `agent-start-flow` ("no send control") — that run staged the WORKING
  TREE's `dist/` and `shell/` into the packaged shell (its own log
  header says so), so it measured a stale staged renderer, not the
  sealed 1.0.9. The sealed build has the submit control present,
  enabled, with the exact declared label.

Genuine product measurements in the batch — real, recorded, none
pg2-blocking, owned by other lanes:

- Theme not visually restored across relaunch (`test-account-journey`,
  ×2); owner-account sign-in state failures; settings-drawer /
  example-notice z-order overlap (190 over 80); a11y naming/tab-order of
  the example-data anchor.

## CORRECTION 2026-08-15 (later the same day): this document undercounts

Written around "16/37 red", but the reproducible red set on this machine is
**21**, on BOTH sealed builds. Six failing drivers are absent from the lists
above:

- `agent-dispatch-packaged-qa`
- `example-page-write-fence-qa`
- `first-run-contract-qa`
- `first-run-recovery-qa`
- `onboarding-doc-qa`
- `uninstall-reset-packaged-qa`

They were measured against sealed 1.0.9 AND sealed 1.0.10, same harness, same
machine, minutes apart: **0/6 passed on either**, with the same named checks
failing verbatim. Their signatures are the already-attributed classes —
`503 BRIDGE_LOCAL_RUNTIME_UNAVAILABLE` (no provider CLI present), "Codex is
installed… but nobody is signed in", fresh-live-profile empty boards, and
`signedIn=false`. They are environment and precondition gaps, not defects,
and not regressions.

Recorded because anyone diffing a future run against the original lists would
see six phantom regressions and lose an afternoon to them. When the fleet and
sign-in lanes fix their preconditions, these should turn green with the rest
of their class.

Trap for whoever runs the comparison next: `qa:packaged` writes to a SHARED
`%TEMP%\packaged-qa-logs\`, so running a control against a second build
overwrites the first build's detail logs. Capture the tails before the
control run, or compare from a report rather than from disk.

## Context that made the cluster look scarier than it is

There is no honest baseline: 1.0.7 was cut from a different branch
lineage, so "these passed on 1.0.7" was never a like-for-like claim.
The research packaged driver (`research-walkthrough-qa`) PASSES against
the sealed build.

Probe artifacts were session-temporary (scratchpad `pg2-live-probe.mjs`,
task output `aa45861b21f44a2a5.output`); this document is the durable
record of what they measured.
