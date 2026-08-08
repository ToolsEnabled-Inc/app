# Sankey/metrics fix + new research page — implementation brief

Read `docs/coordinator/R1162-MC-PAGE2-REDESIGN-SPEC.md` in this worktree first — TASK 2 and TASK 3 are your scope (TASK 1, the page-2 tree redesign, is a separate parallel lane in a different worktree; do not touch `src/views/computers.js`, `src/graph.js`, or the tree-layout files — that's out of your territory).

## TASK 2 — Sankey/metrics diagnosis fix

Root cause (already confirmed in code by the design + planner-verification passes, both in this worktree): metrics defaults to live mode (`live-flags.js`, no `defaultLive: false` for the metrics view), and live mode deliberately renders the Sankey chart's host as an "unavailable" text line because `tools/gen-metrics.mjs` never emits token-routing data. This is intentional honesty (never show fake data in live mode), not a bug in the honesty mechanism itself — the actual gap is upstream, in what data exists.

Build **option (a)** from the spec: teach `tools/gen-metrics.mjs` to emit a real token-routing observation (pools → providers → roles), derived from whatever usage/audit data the generator already reads or can reach, so the Sankey lights up honestly in live mode once real data exists. If the generator has no usable source data to derive this from right now, that's a legitimate finding — report it plainly rather than fabricating a shape, and instead build **option (b)**: style the "unavailable" state as a proper designed empty-state panel (keep the 430px hero slot, one clear sentence explaining why, and where relevant a "view simulated" affordance) instead of the current bare text line, which is what currently reads to the owner as "the chart just isn't there." Do BOTH if the data is genuinely available; do (b) alone with an honest note if it isn't.

## TASK 3 — New independent research page

Build exactly what the spec's TASK 3 describes: a new `src/views/research.js`, wired into `src/main.js`'s `ORDER` array, routing `parse()`/`makeView`/`crumbFor` cases for `#/research`, as a ring-nav peer of home/computers/metrics/comms/ledger (NOT a metrics tab, NOT folded into metrics — a fully separate page). It consumes the existing `public/data/research.json` (generator: `tools/gen-research.mjs`, already built, no backend changes needed) via the existing `fetchProjection('research')` path in `src/live-status.js`.

Content, per the spec: a corpus catalog list (title, date observed, size, curated summary in the grey `--ink-3`/`--ink-25` context register for each safe report); flagged reports (`needsOwnerAuthorization: true`) render as locked rows showing only title + `authorizationReason`, never content — this R198 boundary is already enforced on the generator side, your page must not weaken or bypass it; a "Method notes" section; honest "unavailable" rendering for any section without data (never render zero as if it were a real zero). Visual register matches page-1 conventions: bare text, hairlines, brace grouping, no cards, square corners, all three themes.

**Metrics itself must not change at all in this lane's work** — it stays exactly as its own existing page; you are only adding a new independent page alongside it (plus the TASK 2 Sankey fix within metrics' own existing structure).

## Verification (own-run, before you report done)

1. Run the existing test/probe suite (check `package.json` scripts). Report the real command + result.
2. Confirm metrics page still loads and works exactly as before, apart from the Sankey fix itself.
3. Confirm the new research page is reachable via the nav ring and directly via `#/research`, renders the catalog correctly, and correctly locks flagged/authorization-required entries (verify against `public/data/research.json`'s actual current content — check what's really in that file before assuming its shape).
4. All three themes (white/tan/black).

## Process

Single lane, your own worktree already set up. When done, write a report to `docs/coordinator/R1162-SANKEY-RESEARCH-IMPLEMENTATION-REPORT.md` covering: what you built for each task, real verification commands + results, any deviations and why, any open issues (especially if TASK 2's real-data option wasn't achievable and you fell back to the empty-state-only fix). Report VERDICT: DONE (or partial, named) as your final message.
