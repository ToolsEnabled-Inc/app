# Mission Control — website development handoff

You are taking over development of this dashboard entirely. This document is
the transfer of everything the previous manager learned — about the product,
the owner, the codebase, and the mistakes already paid for. Read it before
touching anything. The git log is the deep documentation: every commit
message carries its rationale, measurements, and the failures en route.

---

## 1. What this is

A dashboard (Vite, vanilla JS, no framework) visualizing the owner's
multi-agent fleet: coordinator chat home, computers graph board, per-agent
drill-in, metrics instrument panel, ops-channel watch board, an R/Q request
ledger (those six loop on the nav-arrow ring), plus a `#/settings` page
outside the ring (entry: the drawer's "all settings" link). **Everything is
simulation** — the owner's standing rule: "you dont have to worry about
wiring any functionality at all, only make it look like it works." One
parallel workstream (live-status.js, by another session) feeds real data to
the home hero only; do not extend live wiring without an explicit owner ask
("dont worry about the wiring into my software").

It ships two ways:
- **Browser**: `npm run preview` → port 4600. The server binds **IPv6
  localhost only** — `http://localhost:4600`, never 127.0.0.1.
- **Desktop app** (the ToolsEnabled packaging): `npm run app` or the
  "Mission Control" shortcut on the Desktop. An Electron shell in `shell/`
  hosts the same dist/ — frameless window, the app draws a 36px titlebar
  strip, Windows draws native min/max/close recolored to the live theme.
  The app source knows nothing about the shell: every piece of chrome is
  injected from `shell/preload.cjs`, so the browser build stays
  byte-identical. See §7a.

## 2. The owner's laws (taste doctrine, ranked, their words)

1. **"Super minimalistic, almost medical-clinic clean"** · "minimalist but
   fancy — very few details but the pieces that exist need to be
   ridiculously nice" · professional, **not childish, not AI-generated
   looking**.
2. **The glance doctrine**: "a haiku agent should be able to 1-shot what the
   metric is telling it exactly… maybe even lower tier than haiku" — BUT
   "its more about formatting and layout than color… i want the color and
   visuals to be really nice, not muted by haiku feedback. i want the actual
   metrics to be obvious." Clarity comes from STRUCTURE (fixed slots:
   claim/value/verdict; charts carry their own thresholds; state = glyph
   whose SHAPE and colour both differ — never colour alone; captions speak
   in the same nouns the legend teaches). Beauty is never muted in
   legibility's name.
3. **No boxes behind everything.** Page 1 (home) is the reference register:
   bare text on the page, hairlines, whitespace. The site's signature
   container is the **brace** `{ }` — when grouping is needed, brackets, not
   cards. Page-2 monitoring blocks are brace-framed (5-piece SVG: fixed
   curls + stretching arms; opaque stroke colour with GROUP opacity —
   per-piece alpha beads at the joins).
4. **Square corners, 3px** (`--r-md`). The one blessed exception: the
   settings toggle capsule (commented in styles.css). 2px is the sub-tier
   for micro-elements; no pills, no big radii.
5. **Type floors**: 13px reading text, 12.5px data labels/registers, 11px
   only for uppercase tracked micro-caps. The owner has vision issues but
   explicitly traded box-content size for density on page 2 — and a
   user-facing **text-size setting** exists (drawer, body zoom).
6. **Three themes**: `white | black | tan` (tan = Gruvbox Light Soft — the
   owner's daily theme; ALWAYS eyeball tan). Set via
   `document.documentElement.dataset.theme`. Everything themes through
   tokens; hardcoded colours are bugs (the audit found four; all fixed).
7. **Colour follows entity.** A role hue means the same agent-role on every
   surface; providers likewise (Carbon categorical); severity likewise
   (Carbon alert steps at the sitewide 2/5 thresholds). Never repaint
   survivors on filter; never reuse status colours for series. The role
   palette is ONE hex per role (vocab.js ROLES), derived at oklch L 0.595 —
   the max-chroma row clearing 3:1 on all three surfaces. There are no
   per-theme role hexes (ROLES[].hex bakes into inline styles at view
   build); themes adapt through recipes instead — rim dose 70%/84%, hover
   brightening.
8. **No popups. Ever.** Drawers, inline reveals, trays — never modals or
   toasts.
9. **Effects smooth**; reduced-motion always honoured; idle pages must not
   burn CPU (see perf discipline, §7).

## 3. Protected surfaces (break these and the owner will notice in minutes)

- **Home page** — "almost exactly what I want." The braces bracketing the
  coordinator's full session thread, the crescent hero. Touch only on
  explicit instruction. `.mc-brace.mjs` (dTop 0/dBottom 0) and
  `.mc-thread.mjs` are its guards.
- **Token routing sankey** ("in fact cool") and **token flow stacked bands**
  ("i like token flow and token routing a lot now") — detail craft only.
- **The tree layout** ("dont change the tree idea though") and **Edit mode**
  ("we have to keep edit so users can manage the work tree") — physics mode
  also STAYS by explicit reversal ("keep the physics. fix the lag").
- **Brace-framed page-2 blocks** — the owner reversed an unboxed experiment
  back to these ("go back to the boxes… i wanted the brackets like on page
  1 and like in the original image"). They are settled law now.
- **Metrics standard layout** — hash-asserted byte-identical for untouched
  users; new modules start in the layout-builder tray, never in the default.
- Review-verdicts and failure-lanes modules passed the cold-read test
  perfectly on first exposure — they are the grammar's reference
  implementations.

## 4. State at handoff — FINAL, everything committed

The tree is clean at `ee36b85`. The last four commits are the closing arc:
`c6f73aa` (cold-read loop closed on the final metrics modules) → `14aad6b`
(this document) → `2e6d937` (the settings page) → `ee36b85` (the desktop
shell). The arc from `b153556` to here is: audited-fix phases
A–F → feature wave (streaming chat `776e2fd`, screen-space monitoring
blocks `a9905a6`, text-size `5f32b2f`, ledger page `e044c10`, metrics
beauty + tray modules `c936d8e`) → brace framing `de51078` → first
cold-read fixes `7cd0558` → perf surgery `aaab9d4` → the owner-sanctioned
final Opus wave in three lanes (comms/ledger typesetting `0fbb589`,
palette + shell unification `7fc9a95`, graph surfaces `8c36829`) →
cold-read closure `c6f73aa`.

What the final wave and closure delivered, beyond the earlier arc:
- Role palette moved site-wide through vocab.js; seven controls unified off
  untokenised cyan onto `--c-coordinator`; focus ring `#007d98` solved per
  theme; topbar captions resurrected (a specificity bug had kept them
  never-rendered).
- Comms/ledger typesetting: eased 24px dissolve, right-aligned name rail,
  purpose lines; watch-board `setSize` re-pins in TWO passes (rAF + 520ms
  settle — pane heights transition 0.45s, one frame is not enough).
- Graph surfaces: opaque brace strokes + group opacity, ellipse wash,
  `[opacity="0"]` leader guard (CSS was defeating JS's setAttribute),
  shadow tokens, tier guides.
- Metrics glance closure (cold-read-driven): gates timeline shows ALL
  events (a silent six-mark cap had dropped 11 of 17) across three
  collision rows, held gate keeps a persistent halo, caption counts in the
  legend's nouns ("14 ckpt · 3 gates", sub carries "1 still held");
  token-flow legend carries per-provider WINDOW TOTALS so ranking is
  stated, not guessed; pool burn distinguishes rolling seat windows
  (headroom, resets monthly) from spend-down $ pools (runway math only
  there — it once printed a false "~1 d" crisis on a quota pool); sankey
  pool/provider labels carry conserved magnitudes, roles stay name-only.
- Perf discipline held: settled pages at single-digit layouts/s; honest
  p95 floors measured — wheel 22.4ms, drag 27.9ms is the paint floor of
  moving DOM, not a bug to chase. (A phantom "regression" was chased once:
  pre-surgery baseline was bimodal 2.6–10.5 with sim worker-spawn bursts.
  A/B against a stash-rebuilt baseline before believing any perf delta.)
- **Settings page** (owner-ordered, last wave): 80 settings / 11 sections /
  4 depth tiers. Depth 1 shows by default; each section drills
  "N more ⌄" → "advanced" → "everything", indented behind brace rails,
  depth-4 names in mono (the register is dry specificity — "Brace stroke
  width … at subpixel precision"). Search reaches ALL depths and shows
  matches flat with a SECTION · DEPTH prefix. Four settings are REAL and
  mirror the drawer bidirectionally (theme / text size / glow / reduce
  motion — same storage keys, both UIs stay in sync live); everything else
  persists to `mc.set.<id>` and only looks alive. Casual users always land
  on the clean depth-1 page; reveal state is deliberately ephemeral.
- **Desktop shell** (owner-ordered, last wave): see §1 and §7a.

**Known opens — documented, deliberately unfixed:**
- Graph agent strip places 3 of 5 chips at rest: pre-existing placement
  budget behaviour, not a regression. Revisit only as a design decision.
- Board rail would benefit from an `.at-end` hook for its activity feed.
- Stale pre-palette hex references live in COMMENTS only: graph.css ~:779,
  agent.css ~:133, views/metrics.js ~:212, components.js ~:662. Tidy
  opportunistically.
- Smoke's home feed-truncation subprobe reads 0/0 — `.feed-line` was
  retired; re-point or delete that subprobe.
- Black-theme node sphere-vs-flat divergence: flagged to the owner as a
  design call, no ruling yet.
- Metrics one-frame sort slip during rank lerp: transient, cosmetic, noted
  in commit history.
- `artifacts/` (untracked) holds codex/Opus wave evidence — screenshots and
  audit reports. Keep or prune at your discretion; nothing depends on it.

## 5. How to work (the owner's standing orders + earned practice)

- **Delegate implementation through Codex CLI** — owner's order: "codex cli
  for all subagents from now on." `codex exec --full-auto -C <repo> -` with
  the brief on stdin, run in background. Write briefs like the ones in this
  project's history: verbatim owner quotes, explicit territory (files it
  may edit / may only read), the design, self-verification requirements
  with numbers, "do NOT git commit." One spent exception: the owner granted
  a one-time Opus-model visual wave for the final pass ("Use only opus5 for
  your final visual pass… one time wave") — that grant was consumed; the
  codex default stands unless they re-issue it.
- **You gate everything yourself.** Codex builds; the manager verifies with
  own probes and eyes, then commits. Verification is never delegated. Codex
  sandbox has no browser — visual QA is always yours.
- **Territory discipline**: concurrent codex lanes only on disjoint FILES.
  styles.css is the shared hub — never two lanes in it. Build races on
  dist/ are tolerated (each lane rebuilds) but re-verify at gate time; the
  owner's open tab sees dist churn — after landing, suggest a hard refresh.
- **Commits**: explicit paths only — `git add -A` once swept another
  session's uncommitted work into a mislabeled commit (had to be split).
  Commit messages are essays: what, why, the failures on the way, and the
  MEASURED numbers. Codex-built work gets `Co-Authored-By: codex-cli`.
- **Show-before-commit** applies to visually contested changes: capture
  honest before/after builds (stash → build → shoot → pop → build → shoot),
  present both, wait. The owner reverses decisions — that is normal, treat
  the newest instruction as final, preserve reversibility (nothing visual
  lands while a review is pending).
- **No regressions**: every pass ends with the battery (§8) green plus
  screenshots compared against current state. Ambiguous = revert, not argue.
- **The owner communicates in rapid bursts**, mid-task, sometimes
  contradicting a minute-old message. Fold new direction in immediately
  (restart in-flight runs if the spec materially changed — cheap early).
  They grant latitude explicitly ("you can implement this in a different
  way if you see a more obvious solution") — take it at gate time, on
  screenshot evidence, and say what you changed.

## 6. Environment gotchas (each of these burned a session once)

- `http://localhost:4600` (IPv6 only). If down: `npm run preview` in the
  repo (port 4600 strict).
- Theme values are exactly `white|black|tan` — "light"/"dark" silently
  no-op and you'll test one theme three times.
- The agent route needs the full form `#/agent/c1/codex` — bare `#/agent`
  silently falls back to home (a smoke suite once "passed" testing home
  three times).
- Playwright lives in `C:\Users\joshp\Desktop\ToolsEnabled`, not this repo —
  run probe scripts from there (module resolution follows the script's dir).
- Probe harness inventory (ToolsEnabled `.mc-*.mjs`): `smoke` (18 route ×
  theme combos), `collide`/`comp`/`ui` (box placement), `label`/`overlap`
  (graph labels/bubbles, age-filtered rerun variants), `brace`/`thread`
  (home), `dupes`/`visiblerepeats`/`comms-behave` (comms), `layout-verify`
  (43-gate metrics builder), `contrast`/`solve` (theme ratios), `role-hue`
  (101 cross-surface palette assertions), `closechat`, `capcheck` (metrics
  caption render + crop recapture), `gallery` (routes × themes × widths +
  sanity probes), `idleperf`/`layoutcount` (CDP LayoutCount). Extend, don't
  rewrite; keep output lines stable.
- Metrics tray chips are `.m-tray .m-chip` matched by TEXT (no data
  attribute) — a probe once no-opped silently on `[data-mc-chip]` and the
  module under test never left the tray. Guard crop clips with sane-bounds
  checks (x > -1000) — stashed modules park at x=-100000.
- Playwright viewport height: interactions below the fold NEED a tall
  viewport (mouse events past the window edge silently do nothing — a drag
  "failed" twice for this before the harness was blamed).
- Measure truncation with clone-probes, never scrollWidth — line-clamp
  doesn't trip scrollWidth (this masked real truncation once).
- The sim seeds per load — screenshots differ in DATA between runs;
  geometry parity is the deterministic comparison.
- Transient single-sample probe failures during spawn glides are a known
  class — re-run twice before believing them; age-filtered probes exist.

## 7. Architecture map (where things live, and the lessons encoded in them)

- `src/main.js` — hash router, ring nav (modular ORDER, loops both ways),
  view transitions, drawer (theme/text-size/motion/glow). `src/vocab.js` —
  ROLES/PROVIDERS/POOLS: the entity → hex source of truth.
  `src/components.js` — buildChat (streaming replies, typing indicator,
  queue, optional context supplier, PIN CONTRACT: scroll-threshold + RO +
  MO + fonts.ready), the shared escape-first inline formatter
  (numbers/units, role-hued agent names, paths and R/Q ids), sparkline,
  uptimeRing, attachSeg (the ONE segmented control; MutationObserver-driven
  indicator).
- `src/graph.js` — FleetGraph: force sim + tree layout (`_treeSlots`
  capacity-aware packing, adaptive row pads), chips (CHIP_W constant —
  placement and CSS must agree THROUGH it), screen-space overlay
  (`screenChips` option, computers only: constant-size brace-framed blocks,
  budget = rank-ordered placement until nothing fits clear; agent page has
  its own external lane-solver in `views/agent.js`), `_uiObstacles` chrome
  reservation, DENSE budget, zoom/pan (transform-only frames), sim
  lifecycle parking at TRUE zero alpha. `graph.css` — motion registers
  (micro vs structural), edit-mode dashes.
- `src/views/agent.js` — the lane solver (bands/closed-form runs,
  whole-set solve, cull-before-compact density policy, E1 geometry caching:
  **the settled frame reads NO live layout**).
- `src/views/metrics.js` + `metrics-charts.js` + `metrics-layout.js` +
  `echarts-theme.js` — the instrument panel; ECharts 6.1.0 imported ONLY
  via echarts/core (never Legend/Title/Toolbox — that's how the library
  look is structurally excluded); @carbon/colors is the skin; theming is
  snapshot-based (buildTheme reads computed tokens; --prov-* live in
  .metrics scope); the layout builder registry (rows model, standard
  layout = key-absence in `mc.metrics.layout`, tray for unplaced modules,
  move+resize — never dispose/rebuild).
- `src/views/comms.js` — watch board (splits/branch/weights, two-pass
  setSize re-pin), bagDraw **partition** sampler (recent lines to the
  draw-last end — its guarantee is structural; a "deeper guard" once
  degenerated it, see commit history).
- `src/views/ledger.js` + `ledger-data.js` — R/Q outline (R1 → R1.1 →
  R1.1.1), fixed glyph rail optically sized per state, three fixed
  metadata tracks.
- **Recurring bug class, learn it**: measuring DOM while detached (initial
  build) returns 0 — labels, chip heights, chat scroll anchoring all hit
  this; the cures are self-heal re-measure loops + `document.fonts.ready`
  re-checks + slot re-election on corrected measurements. Fonts change
  metrics with NO mutation and NO resize — the one growth path observers
  can't see.
- **Perf discipline** (fought for, must hold): settled pages at single-digit
  layouts/s (baseline ~3, bimodal to ~10 during sim worker spawns); no
  per-frame getBoundingClientRect/offsetWidth on settled paths; width
  tweens are scaleX; infinite idle animations are banned (breathing effects
  gate on state, not `infinite` on rest).

## 7a. The desktop shell (`shell/` — how the packaging works)

- `shell/main.cjs` — Electron main: serves dist/ over loopback HTTP
  (file:// would break fetch and absolute asset paths; SPA-fallback to
  index.html), frameless BrowserWindow with `titleBarOverlay` (native
  caption buttons at 36px), bounds/maximize persistence in userData,
  single-instance lock, F12/Ctrl+R kept via before-input-event.
- `shell/preload.cjs` — ALL the chrome: injects the titlebar strip + the
  three CSS offsets (`#stage` height, `.topbar`/`.drawer` top) and watches
  `data-theme` to report the page's real composited surface/ink to main,
  which recolors the native buttons + window background. The strip's own
  background is transparent — the themed body shows through, so it CANNOT
  mismatch. Boot flash is prevented by a measured per-theme seed persisted
  from the last run.
- `shell/launch.cjs` — strips `ELECTRON_RUN_AS_NODE` before spawning.
  **Gotcha that burned this session**: VSCode extension hosts and agent
  harnesses export that variable; with it set, the Electron binary is plain
  Node and `require('electron')` returns a path string (the symptom:
  `ipcMain` undefined). `npm run app` goes through the launcher; the
  Desktop shortcut targets the exe directly (Explorer's env is clean).
- Repo files are CJS (`.cjs`) because package.json is `"type": "module"`.
- Electron's npm postinstall sometimes skips the binary download — if
  `node_modules/electron/dist/` is missing, run
  `node node_modules/electron/install.js`.
- Probes: `.mc-app.mjs` (boot + bridge + theme flip), `.mc-app3.mjs`
  (three themes: window bg + strip offsets). They pass `executablePath` and
  a cleaned env to Playwright's `_electron`.

## 8. The gate battery (run before every commit; all must pass)

`smoke` (18/18) → route-relevant placement probes (`collide` 0/30, `comp`
0/24, `ui` 0/64 for graph work) → page-specific (`brace`+`thread` for home,
`layout-verify` 43/43 for metrics, `dupes`+`visiblerepeats`+`comms-behave`
for comms, `settingsgate` 18/18 for settings, `app`/`app3` for shell work)
→ `contrast` (braces 2.10 ±0.02 all themes — the token-bleed canary) →
`role-hue` after any colour work (101 assertions) → screenshots of every
changed surface in all three themes, looked at with your own eyes → for
perf-adjacent work, CDP LayoutCount settled. Full `gallery` at wave ends.

Commit-message hygiene: write long messages to a temp file and use
`git commit -F <file>` — a PowerShell 5.1 here-string once silently
shredded a `-m` message into pathspecs and the follow-up commit swept two
changesets into one (caught and split immediately; `git reset --soft` is
the cure when nothing is pushed).

## 9. The cold-read loop (the glance doctrine's enforcement — run to closure)

After visual work on any metric/module: crop it, spawn a **Haiku-model
agent** with zero context, ask (1) what is this measuring (2) exact current
values (3) good or bad and how the visual says so — "if anything requires
guessing, SAY SO." Its uncertainties are the fix list; its "no guessing
needed" is the pass. Fix, re-crop, RE-READ — the proof is the same
instrument that found the bug.

Full-suite results this project: verdicts ✓ lanes ✓ ledger ✓ on first
exposure; heartbeat, stats, tokenflow, gates, burn, sankey each produced
findings → all fixed → re-reads pass (final round: ranking stated from
legend totals with exact values; 16–17 of 17 events counted with the held
gate identified by glyph + caption). Two patterns to keep: modules built
under the full grammar pass cold on first exposure; and the reader's
residual HEDGES ("appears to be", "likely") are caption-vocabulary bugs —
fix the wording until the hedge disappears.

## 10. Working with the owner (read this twice)

They review live, in their browser, on tan, and react fast and bluntly
("the ugliest shit ive ever seen") — blunt criticism is DATA, not conflict;
the same hour produced "really good job." Praise names specifics; so do
their complaints — quote them verbatim in briefs and commits, they are the
requirements. When they repeat an ask you believe is done, it means the
result didn't LOOK done — believe their eyes over your receipts (the
metrics engine-swap taught this: correct and invisible = not done). When
they propose a mechanism ("maybe smaller font or something"), they usually
want the GOAL (more info), and they've said explicitly: "you can implement
this in a different way if you see a more obvious solution… i think i had a
crude solution to be honest." Solve the actual issue; tell them what you
did differently. Reversals are decisions, not noise. When usage limits
loom they'll say so — pause cleanly (stop in-flight runs pre-edit if
possible, RESUME STATE into the plan file, memory pointer updated).

## 11. Records

- **Git log** — the true documentation; read the last ~40 commit messages
  end to end before your first change. `ee36b85` is the handoff point.
- `C:\Users\joshp\.claude\plans\mossy-humming-mochi.md` — the audited-fix
  plan arc (complete) with its RESUME STATE pattern worth copying.
- Memory files (`…\memory\`): `mission-control-dashboard`,
  `codex-cli-subagents`, `glance-doctrine` — keep them current.
- `V1safe` on the Desktop — frozen runnable snapshot at `3992fa8` with its
  own node_modules + dist; the owner's fallback. Never build on it.
- ToolsEnabled `.shots/` — screenshot history of every gate this project;
  `.shots/gallery/` is the final 90-shot route × theme × width sweep.
- `artifacts/` in this repo (untracked) — codex/Opus wave evidence.

Run the battery once before your first change to establish YOUR baseline.
Then keep the streak: nothing lands unverified, nothing verified only by
the agent that built it.
