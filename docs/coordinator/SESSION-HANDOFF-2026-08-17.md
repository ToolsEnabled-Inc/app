# Handoff: the night of 2026-08-16 → 17 (research-subsystem lane)

Written so the next session does not re-derive any of it. Every claim below was
measured; where something is unproven it says so.

## What a person gets now

**Installed: 1.0.23**, verified clean on both halves (renderer and engine
payload written in the same second, 1.0.23 marker present, 1.0.22 absent).
The desktop shortcut opens it.

- **Starting an agent from the tree works.** Driven on the installed build with
  `tools/agent-start-flow-qa.mjs --release <installed>`: role, brief and
  "Start this agent" all present and shown. **24/26 checks, zero failures**
  (the two remaining are NOT EXERCISED — the harness cannot substitute a start
  reply through `window.mcAgent`, a non-configurable contextBridge property).
  The same driver reported **14/26 and "no send control in the panel"** before
  this work.
- **The research showing path is unaffected: 23/23** on the same build.
- **The owner's research stage is intact**: 2 projects, 3 experiments, 69 runs,
  61 results, 3 findings — identical before and after install and drive.
- **A real tool call round-trips and lands a signed audit row** on a sterile
  profile (packaged smoke).

## The defect that mattered, and why it shipped twice

The owner reported it twice, months apart: *"I cant scroll down to even press
start"*, then *"there is no way to start an agent"*.

The compose panel holds more than the rail is tall. Whatever sits at the bottom
is invisible at first paint. Fix #1 made the form scroll — Start became
*reachable* and stayed *unseen*; that commit was called "Start is reachable".
Fix #2 pinned Start beside the scroller and pushed the BRIEF BOX out instead:
same defect, one field up. The change that held was **order**: the panel is
"two fields and two buttons", and the assistant/effort choices added later
(two lines of help each) crowded out the brief. Role and brief now come first;
nothing was removed.

**Every unit test stayed green through all of it, because a fake DOM has no
layout.** `node --test` proves a control EXISTS and can never prove a person
can SEE it. See finding 11 for the transferable rule.

## Open, and whose

1. **Merging to main — the owner's/controller's call.** Engine is 12 commits
   ahead of main, app 41; **both are pure fast-forwards with zero conflicts**
   (main is literally the merge base). No gate blocks a local merge. Held back
   because `src/lib/fleet-supervisor/review.js:27-28` and R62 make merging to
   main a controller decision, not a lane's.
2. **GitHub is far behind**: `origin/main` is 11 days stale, **1244 engine** and
   **439 app** commits unpushed. Needs `gh auth login`. The D: mirrors DO carry
   tonight's exact tips (refreshed on demand at 00:37, failures=0), so the
   "single disk" risk is closed even though GitHub is not.
3. **Finding 12 (fleet/onboarding lane)**: after the recommended setup path on a
   fresh profile, three independent drivers agree there is no visible way to
   start — fleet page draws no node, the "Open agent detail" door measures
   zero-size, the agent page carries no start control. 81/85 of first-run
   passes; the setup path itself is in good shape. Qualified: those profiles
   have no Codex installed and the product is honest about that, so some
   missing controls may be correct refusals.
4. **The engine census** (`ENGINE-TEST-CENSUS-TRIAGE-2026-08-16.md`): 15 of 42
   failures fixed tonight and re-measured; the rest are other lanes' uncommitted
   work, their debt, or environmental. **Nothing failing ships.**

## Instruments added tonight (use them; do not re-invent them)

- `tools/compose-start-layout-qa.cjs` — measures real layout: whether Start and
  the brief box are on screen at three window sizes, against the built
  stylesheet. Registered in the packaged QA suite as an **electron** driver.
- `tools/test/agent-compose-panel.test.mjs` pins BOTH panel failure modes at
  once (Start not inside the scroller, Start not unpinned, action row keeps
  `flex: none`). Each assertion alone permits one of the two defects.
- The packager now refuses an unnamed cutter **before** the build
  (`attributionBlocksCommit`), instead of dying at the commit hook minutes in.
  Set `TOOLSENABLED_CUT_MODEL` / `_SESSION` / `_LANE` when cutting.

## Traps this lane paid for, written down so nobody pays twice

- A sealed NSIS installer **cannot be grepped**; extract `$PLUGINSDIR/app-64.7z`
  first, or you will "prove" a good build empty (trap 15).
- The state root is memoised at module load: set `TOOLSENABLED_STATE_ROOT`
  **before the first require** or a probe writes to the owner's real state
  (finding 9 — this cost 76 junk ledger entries, cleaned).
- `ELECTRON_RUN_AS_NODE` is set in this environment; an electron driver run
  without clearing it fails as plain Node with a confusing error.
- `app.exit()` truncates stdout; use `process.stdout.write` + `app.quit()`.
