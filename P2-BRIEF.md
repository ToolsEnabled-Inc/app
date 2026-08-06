# M-P2 — Phase 2: wire the read surfaces (simulation → real projections)

**You are:** `codex-manager-p2`, a **gpt-5.6-sol** (xhigh) manager under owner
directive **R1135** (verbatim): *"you are coordinator. use codex subagents
only. assign 3 sol ultra maangers, each with 5 luna/teera\ max workers
available to them"*. Coordinator: the Claude Fable session (b5345074). You
report via your committed report only.

**Read first, in this order:**
1. `C:\Users\joshp\Desktop\toolsenabled-current\docs\coordinator\PROGRAM-HANDOFF-R1134.md`
   — Part I §1–§3, **Phase 2**, Part III, and **ALL of Part II** (design laws,
   protected surfaces, architecture map, gotchas, probe harness, gate
   battery). Part II binds every edit you make.
2. `C:\Users\joshp\Desktop\toolsenabled-current\docs\coordinator\managers\README.md`
   — your contract (escalation boundary, anti-flattening, report format).
3. `P1-REPORT.md` at this worktree root — the data contract you are wiring
   (six domains, versioned schemas, `{ok:false, reason}` discipline).
4. `HANDOFF.md` in this repo and the last ~40 commit messages of its git log —
   the deep documentation.

## Mission

Replace simulated reads with the real Phase 1 projections, **one view per
lane**, each behind a **per-view flag** so anything can fall back instantly.
This is wiring, not redesign. Home is "almost exactly what I want" — touch it
only where wiring requires (plus the one assigned defect below).

Surfaces and their payloads (readers already exist in `src/live-status.js`):
- home / coordinator thread ← `coordinator.json`
- computers graph board ← `fleet.json`
- per-agent drill-in ← `agents.json`
- metrics panel ← `metrics.json`
- ops-channel board ← `ops.json`
- R/Q ledger ← `ledger.json`
- settings: no domain payload; wire only what it genuinely needs (likely
  nothing beyond the flags UI location decision — an inline reveal in the
  existing settings page, never a popup).

Where a payload or sub-surface says `{ok:false, reason}` or
`source-unreadable-safely`, the view shows the **unavailable state the design
already implies** — never a fabricated placeholder that looks like a reading,
never a plausible zero. Simulated data remains reachable via the flag until
the owner retires it; flag default is LIVE for a view once its wiring passes
the battery, SIMULATED until then.

## The one defect fix folded into the home lane

Baseline known-open, deterministic (recorded in
`toolsenabled-current/docs/coordinator/PHASE0-BASELINE-2026-08-05.md`): the
coordinator thread loads **44px short of bottom-pin** — `.mc-thread.mjs`
fails `pinned to bottom at load` (st=2332 vs sh-ch=2376) and `still pinned
after new turn appended`, while all 14 other checks pass (it re-pins after
returning to bottom, stays pinned through send/reply and live arrival). The
PIN CONTRACT is in `src/components.js` `buildChat` (scroll-threshold +
ResizeObserver + MutationObserver + `fonts.ready`). Recurring bug class per
Part II: detached-DOM measurement returning 0 and font metrics changing with
no mutation/resize. Fix belongs to the home lane ONLY (one lane owns
home-adjacent files); acceptance = `.mc-thread.mjs` 16/16 with the rest of
the battery still green.

## Hard territory rules

- **May edit (this worktree only):** `src/views/**`, `src/main.js`,
  `src/graph.js`, `src/components.js`, `src/vocab.js` is READ-ONLY,
  `src/live-status.js` (extend only, never weaken its contract), a new flags
  module (e.g. `src/live-flags.js`), `styles.css` (see below), `P2-REPORT.md`.
- **styles.css is a SINGLE lane** — exactly one worker (or you) may touch it,
  serially. Never two lanes in that file (this has burned the project).
- **Protected surfaces (Part II §3) — break these and the owner notices in
  minutes:** home braces + crescent hero; token routing sankey; token flow
  bands; the tree layout; Edit mode; physics mode; brace-framed page-2
  blocks; the metrics standard layout (hash-asserted byte-identical for
  untouched users — new modules start in the tray, never the default);
  review-verdicts and failure-lanes modules.
- Do NOT touch `tools/gen-*.mjs`, `public/data/**` payload shapes,
  `package.json`, `shell/**`, `index.html` (escalate if wiring truly needs an
  index.html or package.json change).
- The design laws bind: no boxes, brace containers, 3px corners, type floors
  (13px/12.5px/11px caps), three themes via tokens only (no hardcoded
  colours), colour-follows-entity, **no popups ever**, reduced-motion
  honoured, idle pages must not burn CPU (no per-frame layout reads on
  settled paths).

## Verification you must run (real numbers in the report)

The probe harness lives in `C:\Users\joshp\Desktop\ToolsEnabled` (read/run
only; never edit `.mc-*.mjs`). Prefix every probe/browser-driving command
with the delegation signal: bash `CONTROLLER_DELEGATED=1 node .mc-smoke.mjs`,
powershell `$env:CONTROLLER_DELEGATED="1"; node .mc-smoke.mjs`.

Per the battery (Part II §8), route-relevant per lane, full set before your
final commit: `smoke` 18/18 → `collide` 0/30, `comp` 0/24, `ui` 0/64 for
graph work → `brace`+`thread` (16/16 required) for home → `layout-verify`
43/43 for metrics → `dupes`+`visiblerepeats`+`comms-behave` for comms →
`settingsgate` 18/18 → `contrast` (braces 2.10 ±0.02 all themes) →
`role-hue` after any colour work. Build with `npm run build` (worktree needs
its own `npm ci`); test data flows with `npm run test:data` and the dev
server against THIS worktree, never against the owner's live :4600 preview.
Note: the served `:4600` belongs to the main checkout — do not rebuild or
restart it; the coordinator does final visual review there after merge.

Screenshots: capture every changed surface in all three themes (white, black,
tan) to an `artifacts/p2/` directory (untracked is fine) so the coordinator
can eyeball them — the coordinator's own-eyes review on tan is the merge
gate, not your claim.

## Workers

Up to **5** total (R1135): `codex exec --dangerously-bypass-approvals-and-sandbox
-m gpt-5.6-terra -c model_reasoning_effort="high" -C C:\Users\joshp\Desktop\wt-p2-wiring "<task>"`
(or luna/medium for light tasks). One view per worker lane, disjoint files;
you own the shared seams (flags module, live-status extensions, styles.css)
serially. A worker never spawns above its tier; nested-exec failure = do it
yourself at your tier and say so.

## Exit criteria

- All six ring pages plus settings read live payloads behind per-view flags;
  flag flip falls back to simulation instantly.
- Honest unavailable states rendered for every `{ok:false}`/unavailable
  sub-surface actually present in current payloads (thread and ops messages
  are `source-unreadable-safely` today — show the design's unavailable state,
  not fake messages).
- `.mc-thread.mjs` 16/16; full battery green; numbers, exit codes, durations
  in EVIDENCE.
- Screenshots of every changed surface × three themes in `artifacts/p2/`.

## Report

`P2-REPORT.md`: VERDICT / EVIDENCE / DECISIONS MADE ALONE / ESCALATIONS /
DISSENTS-PRESERVED / GAPS. Commit with explicit paths, essay message with
measured numbers, `Co-Authored-By: codex-cli`. Final console message =
VERDICT only.
