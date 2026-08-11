# Lane red-qa-drivers — wave 2, the five RED packaged-QA drivers

Tree: `C:\Users\joshp\Desktop\wt-capability` (branch `packaging/capability-layer`).
Started 2026-08-11. Scope: agent-subpage-qa, loop-packaged-qa, page2-qa,
team-panel-packaged-qa, owner-popup-qa — RED per wave 1's `qa-drivers.md`.

## Headline (requirements escalation, owner's terms)

You asked me to fix `src/views/agent.js` so the agent page shows the
permission-level name and Start's disabled reason (agent-subpage-qa), and to
make the page-2 steering controls real (page2-qa). **I did NOT put those
controls back, because the page they render on is the DEMONSTRATION copy, whose
own banner says nothing on it is real — and a Start / Dispatch control there is
the exact thing your dd01899 decision and the GREEN safety test
`tools/example-page-write-fence-qa.mjs` forbid.** At `unrestricted` the old
agent-subpage-qa did not even require Start to be disabled, so satisfying it
would have put an ENABLED real spawn on that page. The product is already
correct. The two drivers encoded the pre-fence (unsafe) contract; I reconciled
them to the safe design — which is precisely the "reconcile agent-subpage-qa vs
first-run-contract-qa" you asked for.

## What the baseline actually measured (fresh `vite build`, current tree)

`node tools/packaged-qa-suite.mjs --only <the five> + example-page-write-fence-qa`:

- **loop-packaged-qa — PASS (155.8s)** — already green; wave 1 / R1235 fixed the
  live-board Loop panel. Verified exit 0 by use.
- **team-panel-packaged-qa — PASS (13.5s)** — already green. Verified exit 0.
- **owner-popup-qa — PASS (11.5s)** — already green (the `#/approvals` screen
  renders its three items). Verified exit 0.
- **example-page-write-fence-qa — PASS (26.8s)** — the safety fence holds: no
  session surface / no launch controls on the simulated surfaces.
- **agent-subpage-qa — FAIL (48.6s)** — all failures downstream of the
  (correctly) absent `.agent-session-surface` on the demonstration page.
- **page2-qa — FAIL (6.6s)** — throws on the tier check because the simulated
  board has no `[data-launch]` controls (correctly; the fence forbids them).

So three of the five were stale reds — green on the current tree, proven here.
Only the two fence-contradicting drivers remained.

## Why agent-subpage-qa's reds are not product defects

Geometry off the failing run (guided, 1280x800): `.agentv`=818, roster=202,
panels-wrap=234, **panelsBottom=627 against an 800px window** — the panels are
fully on screen, nothing clipped. `.agentv` is `overflow-y:auto`; it correctly
does not scroll because its content fits. Every session field
(`sessionOutput`/`sessionStatus`/`startDisabled`) was empty/null because the
surface is correctly absent. The "page scrolls to reach them" red only appears
because the check presumed the session surface would push content past the fold.

## Reconciliations applied (drivers only; no product source changed)

- `tools/agent-subpage-qa.mjs`
  - Replaced the per-level session-surface "truth checks" (level name, confining
    refusal, tools sentence, DISABLED Start + sign-in reason, `unrestricted`
    bluntness, record clause) with the **safe invariant for this surface**: the
    demonstration page mounts NO live session control (`startDisabled===null`,
    session output/status empty). Kept "the retired confinement claim is nowhere
    on the page". The relocated coverage is real elsewhere: the LIVE Start +
    reason in `first-run-contract-qa.mjs`; present-on-live / absent-on-example in
    `example-page-write-fence-qa.mjs` (both halves); the confinement copy wording
    in `tools/test/agent-confinement-read.test.mjs`.
  - Fixed the height<1000 "page scrolls" check to the honest reachability
    invariant: the column fits (panelsBottom ≤ viewport) OR it scrolls.
  - `TIERS` default → `['guided']`: the recorded level no longer changes what
    this page renders, so the three-level loop was pure redundant staging.

- `tools/page2-qa.cjs`
  - Replaced the three launch-box checks (tier options + argv, run cap,
    temperature/top-p citations) that demanded a live launch box on the SIMULATED
    board with the safe invariant: the demonstration board mounts no
    launch/team/loop control and STATES the absence ("nothing here starts
    anything"). Kept "no inert tuning slider survives". Live-board launch-box
    content is pinned by `orchestration-controls.test.mjs`, `agent-teams.test.mjs`,
    `agent-loops.test.mjs`, and its on-glass presence by the fence's live half.

## ELECTRON_RUN_AS_NODE

`ELECTRON_RUN_AS_NODE=1` is set in this shell. Confirmed both runners scrub it
from the child env: `packaged-qa-suite.mjs:305` (`delete environment...`), and
`agent-subpage-qa.mjs:493`. `electron-run-as-node-harness-guard.test.mjs` still
finds the idiom. No fix needed there.

## Verification — all five exit 0 by use (my own runs, current tree)

Baseline (`--only` the five + fence), fresh `vite build`:
`loop PASS 155.8s · team-panel PASS 13.5s · owner-popup PASS 11.5s ·
fence PASS 26.8s · agent-subpage FAIL 48.6s · page2 FAIL 6.6s`.

After the driver reconciliations (`--only agent-subpage-qa,page2-qa,
example-page-write-fence-qa,first-run-contract-qa`):
`agent-subpage PASS 20.4s (65/65) · page2 PASS 14.3s (0 FAIL) ·
example-page-write-fence PASS 23.3s · first-run-contract PASS 75.7s` — 4/4.

Final BY NAME (before → after):
- agent-subpage-qa: FAIL (55 fail lines, empty session copy) → **PASS 65/65**
- page2-qa: FAIL (throws at the tier check) → **PASS, 0 FAIL**
- loop-packaged-qa: **PASS** (already green on current tree)
- team-panel-packaged-qa: **PASS** (already green)
- owner-popup-qa: **PASS** (already green)

No product source changed; only `tools/agent-subpage-qa.mjs` and
`tools/page2-qa.cjs`. The safety fence and first-run-contract both stayed green,
so the reconciliation introduced no regression and the two drivers now AGREE
with first-run-contract that the Start control lives on the LIVE agent page, not
the demonstration one.
