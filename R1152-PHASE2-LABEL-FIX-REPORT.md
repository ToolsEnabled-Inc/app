# R1152 Phase 2 spawned-label fix

## VERDICT

READY FOR SHADOW VISUAL GATE. The bottom-tier role row now consumes the same per-tier pitch budget already assigned to the node-name row. This prevents the seven repeated `AGENT SPAWNED` sublabels from painting wider than their slots without hiding the role or changing the live projection. The exact commit containing this report is recorded in the coordinator handoff.

## EVIDENCE

- Cause: `_setLabelBudget()` in `src/graph.js` calculates a collision-safe `--nn-max` from the tier pitch. The name row consumed it, but the role row retained the wider global `calc(var(--d) + 96px)` cap. Higher tiers have fewer nodes and enough pitch; the seven-node grey tier does not, so its identical long role strings collided while its names remained bounded.
- Fix: `src/graph.css` adds a graph-scoped override using `min(calc(var(--d) + 96px), var(--nn-max, 9999px))` for `.node-role`. Full role text remains in the DOM and in each node's `aria-label`; only the painted width is bounded.
- Telemetry: `src/graph.js` and `src/views/computers.js` are unchanged. Finite `bornAt` ticking, finite `stoppedAt` freezing, and `origin` / `tasksDone` / `failRate` consumption remain intact. The complete data suite passed.
- Baselines: both `b24d8c1` and designer pin `e984815` are ancestors of the starting HEAD (ancestry checks exited 0).
- Syntax: `node --check` passed 3/3 files, aggregate exit 0 in 161 ms (`src/graph.js` 44 ms, `src/views/computers.js` 43 ms, focused test 65 ms).
- Focused regression: exit 0; 1 passed, 0 failed; Node runner 69.2224 ms, PowerShell wall 122 ms.
- `npm run test:data`: successful PowerShell invocation via `npm.cmd` exited 0; 30 passed, 0 failed, 0 skipped/cancelled/todo (25 top-level tests plus 5 nested); Node runner 2290.1503 ms, PowerShell wall 2670 ms.
- `npm run build`: final required run exited 0; 729 modules transformed; Vite build 6.37 s, PowerShell wall 7015 ms. The isolated worktree had no dependencies, so the run used a verified temporary `node_modules` junction to the read-only main-worktree dependency tree; the junction was removed immediately and package manifests were untouched.
- Preliminary environment attempts are preserved honestly: PowerShell `& npm run test:data` resolved incorrectly and exited 1 in 340 ms (`Unknown command: pm`), then `npm.cmd` passed. Build without dependencies exited 1 in 375 ms (`vite` unavailable); a PATH/NODE_PATH-only retry exited 1 in 605 ms because Rollup could not resolve `@fontsource-variable/inter`; the verified junction run above passed.

## DECISIONS MADE ALONE

- Reused the existing tier-pitch budget instead of hiding role identity, changing node data, changing the view source, or altering tree/cull behavior.
- Added one browser-independent source-contract test that proves the role row consumes the pitch budget while the full DOM and accessible role strings remain present.
- Reused installed dependencies transiently rather than installing packages or modifying manifests in this bounded lane.

## ESCALATIONS

- None. No false premise was found in the bounded defect statement.

## DISSENTS-PRESERVED

- Shadow-manager evidence says no user-spawned node exists yet, so user-before-self cull ordering remains unexercised and is not claimed as visually passed.
- The honest `2 TASKS / 100% FAIL` Sol Coordinator telemetry is not treated as a defect.

## GAPS

- No own-eyes/browser claim is made. Per assignment, the shadow manager remains the visual gate on the live tan fleet page.
- No Playwright/browser access was pursued.
- The successful build retained Vite's pre-existing warning that one minified chunk exceeds 500 kB; this bounded CSS fix does not address bundle splitting.
