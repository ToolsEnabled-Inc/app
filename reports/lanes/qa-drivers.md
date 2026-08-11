# Lane qa-drivers — packaged-window QA drivers, wired and run

Tree: `C:\Users\joshp\Desktop\wt-capability` (branch `packaging/capability-layer`).
Started 2026-08-11.

## What was measured first

Grepped every automated entry point in `package.json` (`test`, `test:data`,
`dist`, `release:cut`, `verify`) against the packaged-window QA drivers in
`tools/`. **Not one driver was invoked by any of them.** Seven had an
`npm run qa:*` alias — a thing a person types, not an automated path — and the
rest had not even that. `tools/test/electron-run-as-node-harness-guard.test.mjs`
lints three of them as SOURCE TEXT; it never runs them.

## Roster (discovered, not listed)

`tools/packaged-qa-suite.mjs` discovers by the `-qa.{mjs,cjs}` convention.
First run of `--list` found 15, two of which were created by concurrent lanes
during this session and were picked up with no edit to the runner
(`first-run-contract-qa`, `setup-deadend-recommended-qa`).

## Changes

- NEW `tools/packaged-qa-suite.mjs` — the automated path. Glob discovery (no
  hand-written membership list), per-driver settings only, zero-discovered is an
  error, timeout is `TIMEOUT` and never a pass, `windowsHide` on every child,
  `MC_SMOKE_HEADLESS=1` in the child environment.
- NEW `tools/test/packaged-qa-suite.test.mjs` — cheap guard under `npm test`.
- `windowsHide` added to the packaged-app spawn in: agent-subpage, chatbox-settings,
  example-page-write-fence, first-run-contract, recommended-path, setup-walkthrough,
  stranger-onboarding. Flipped from `false` to `true` in home-screen and cloud-launch.
  Added to the PowerShell reaper in agent-subpage, chatbox-settings, setup-walkthrough
  and to the `taskkill` in first-run-contract and stranger-onboarding.
- `owner-popup-qa.cjs`: `--theme` was mandatory and pointed at a file that exists
  nowhere in the repo, so no automated path could ever invoke it. It now derives
  the manifest from the shipped `capability/src/lib/owner-prompt-theme.js` when
  `--theme` is absent, and still throws if neither is present. Window was
  `show: true` (stole focus); now `show: false` + `showInactive()`.

## Results — `node tools/packaged-qa-suite.mjs`, 2026-08-11

Three full runs. Per-driver logs land under the OS temp dir by default
(`--logs <dir>` to relocate); the run summaries are kept beside this file as
`qa-drivers-run1.txt`, `-run2.txt`, `-run3.txt`.

**Run 3 (final, current tree): 9/14 passed, 1 held back.**

PASS: chatbox-settings-qa (18.3s), checkout-privacy-packaged-qa (24.4s),
example-page-write-fence-qa (23.7s), first-run-contract-qa (77.1s),
home-screen-qa (4.4s), recommended-path-packaged-qa (33.8s),
setup-deadend-recommended-qa (18.8s), setup-walkthrough-qa (21.6s),
stranger-onboarding-qa (28.2s).
FAIL: agent-subpage-qa (53.2s), loop-packaged-qa (13.4s), owner-popup-qa (20.2s),
page2-qa (3.9s), team-panel-packaged-qa (12.4s).
HELD: cloud-launch-packaged-qa (spends real provider budget; `--include-costly`).

Run 1 was 6/14, run 2 was 8/14. chatbox-settings-qa and first-run-contract-qa
went green on the driver fixes below, not on any product change.
setup-walkthrough-qa went green between run 2 and run 3 on another lane's work.

## Headless did not manufacture any of the reds

Controls run with `--visible`: `loop-packaged-qa` fails identically (14.2s, same
four checks) and `agent-subpage-qa` fails identically (52.4s, same 55 FAIL lines,
same empty tier copy). `owner-popup-qa` fails identically when the PRISTINE
`HEAD` copy of the harness is run with an explicit `--theme` file, so its red
predates every change made here.

## Driver defects found by wiring them and fixed here

- `first-run-contract-qa.mjs:1015` referenced `availabilityCopy`, which was never
  bound. `ReferenceError`, exit 1 at 71.4s, after eighteen green checks and with
  the recommended-path verdict it had just computed thrown away. Now loads
  `src/agent-availability-copy.js` dynamically; a load failure becomes the check
  the author already wrote for it instead of killing the process.
- `chatbox-settings-qa.mjs:491` asserted "the relaunched window came back at the
  same address". That contract is retired — `dist/durable-storage.js` carries
  settings across a port change and `tools/prefs-origin-proof.mjs` is its gate.
  Measured here: the relaunch landed on 4602 because a concurrent lane held
  4601, that assertion went red, and "the choice survives a relaunch" PASSED in
  the same run. Demoted to a printed note; the surviving-setting check still
  carries the address as detail.
- `owner-popup-qa.cjs` could not be invoked at all (mandatory `--theme` at a file
  absent from the repo). See above.

## ELECTRON_RUN_AS_NODE is set in this environment

`ELECTRON_RUN_AS_NODE=1` is present in the ambient environment on this machine.
Any harness that launches Electron and inherits it gets a Node process with no
`app` object. The runner deletes it. Measured: the same command with it set dies
on `Cannot read properties of undefined (reading 'whenReady')`.

## The gate must not write into the repository

`tools/require-clean-tree.mjs` refuses to build from a tree with uncommitted
files, and `artifacts/` is not in `.gitignore` (`git check-ignore` reports
nothing for it). A driver-log directory under the repo would therefore fail
`npm run dist` every time the gate ran. The runner's default log directory is
under the OS temp dir for that reason, asserted by test 7 of the guard suite.
`tools/owner-popup-qa.cjs` still defaults its SCREENSHOTS to `artifacts/`, which
is the same hazard — proposed `.gitignore` edit is in the lane's sharedFileEdits.

## Product reds this wiring surfaced (not this lane's to fix)

- `agent-subpage-qa` — `.agent-session-surface` is **null** on the agent page at
  every window size and every recorded level, so the level name, the refusal
  copy, the tools sentence and Start's disabled reason are all empty strings.
  55 failing checks.
- `page2-qa` — `tierOptions: []`, `sliderLabels: []`, `capPresent: false`: the
  steering controls are inert. (steering-controls lane)
- `loop-packaged-qa` — "the Loop panel is on the glass, not merely in the DOM:
  absent". 3/11 checks. (steering-controls lane)
- `team-panel-packaged-qa` — "each member shows the declared agent it becomes"
  and "with nothing selected the team cannot be dispatched, and says why".
- `setup-walkthrough-qa` — `--mode finish` times out waiting for the app after
  the review is accepted. (setup-deadend lane; their own new
  `setup-deadend-recommended-qa` passes, so the generic finish path is not
  covered by their fix)
- `owner-popup-qa` — the popup never renders its three items. NEW: nothing could
  see this before, because the harness could not be started.

## package.json (shared — NOT edited here, returned to the coordinator)

Add `"qa:packaged": "node tools/packaged-qa-suite.mjs"` and put it in the
`release:cut` chain.
