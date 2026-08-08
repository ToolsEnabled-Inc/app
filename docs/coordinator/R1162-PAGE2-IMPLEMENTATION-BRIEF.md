# Page 2 (computers.js) full redesign — implementation brief

Read `docs/coordinator/R1162-MC-PAGE2-REDESIGN-SPEC.md` in this worktree first, in full — it is your primary spec, history-verified per `R1162-MC-PAGE2-PLANNER-VERIFICATION.md` (also in this worktree). This brief only adds implementation-process instructions on top of that spec; the spec is the actual design authority.

## Scope: TASK 1 only (the spec's §0-§11)

Build exactly what TASK 1 of the spec describes: a new `src/tree-layout.js` (pure layout function), a new `src/tree-graph.js` (StaticTreeGraph class, no d3-force), and a rebuilt `src/views/computers.js`. Do NOT modify `src/graph.js` — it's still used by `src/views/agent.js` (FleetGraph + physics for the agent detail view), which is explicitly out of scope and must keep working exactly as it does today.

You may read `webimages/*.jpeg` at `C:\Users\joshp\Desktop\webimages\` yourself if you want to double-check the visual target directly rather than relying solely on the spec's description.

## What "done" means

- All 6 sections of motion budget (spec §10) hold: only the drill-down glide, rail crossfade, chip↔chat transition, hover transitions, and node add/remove fade are animated. Nothing else moves at rest — verify by loading the page and confirming no idle rAF loop (check `__graphFrameMs`/`__graphNodeCount` probe globals if they exist, or just watch CPU/repaint activity at rest).
- Visual tokens match spec §6 exactly (flat backgrounds, `--c-<role>` outline rings, no glow/gradient/backdrop-filter, neutral-grey edges).
- Edit mode drag-to-reposition works per spec §7 (localStorage `mc.tree.pos.<computerId>`, offset-from-slot semantics, Reset positions button appears only when overrides exist).
- Drill-down per spec §8 (click a focusable bottom node → becomes new root, one smooth 680ms transition, breadcrumb navigation back).
- Rail per spec §9 (Runtime Statistics default page, dblclick → agent board morph with the chat-under-runtime ordering, simplified to a single 180ms crossfade instead of the FLIP choreography).
- Existing DOM contract names preserved (spec §3's list: `data-agent-id`, `data-parent-id`, `data-layout`, `data-edit-mode`, `window.__mcGraph`, keyboard a11y, reduce-motion honoring) — these are load-bearing for existing test probes.

## Verification (own-run, before you report done)

1. Run the existing test/probe suite for this repo (check `package.json` scripts — likely something like `npm test`, `npm run smoke`, or specific `.mc-*.mjs` probe scripts mentioned in the spec's §11.4: `smoke`, `collide/comp/ui`, `contrast`, `role-hue`). Run whatever exists and report the real command + result, not a summary claim.
2. Visually verify on all three themes (white/tan/black per the CSS custom properties referenced in the spec) — the spec explicitly says "eyeball all three themes on tan first."
3. Confirm `src/views/agent.js` and the agent detail view still work unmodified (since you didn't touch `graph.js`, this should be automatic, but verify by loading that view).
4. Confirm the Edit mode reparent-by-drag-onto-node behavior still works (existing `wouldCycle` cycle-guard logic, ported from the old implementation).

## Process

Single lane, your own worktree already set up. Commit your work incrementally if useful, with clear messages. When done, write a report to `docs/coordinator/R1162-PAGE2-IMPLEMENTATION-REPORT.md` covering: what you built, what verification you ran (real commands + results), any deviations from the spec and why, and any open issues. Report VERDICT: DONE (or partial, named) as your final message.
