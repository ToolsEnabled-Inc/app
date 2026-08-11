# lane braces-and-taste

Owner's words: "Also no need to keep using braces throughout the site. just on
the page 1 chatbox and the pg 2 chatboxes on the tree. Other than that feel
free to remove them where it isnt tasteful."

## The map, re-measured (2026-08-11)

The prompt's map was stale in one load-bearing way, so it is restated here as
measured against this tree.

There are **two unrelated things called "brace"** in this app, and only the
second family was ever a candidate for removal.

**A. the drawn SVG bracket — SURVIVES, both instances**
- `src/views/home.js:126,141,152` — `BRACE_SVG` + two `.brace` spans. These do
  NOT bracket the retired feed lines: `.home-feed` is the coordinator session
  thread, i.e. the page-1 chatbox (see the header comment at `src/home.css:140`,
  "the coordinator session thread — what the braces bracket now"). The other
  6 hits in home.js are the pulse handler and prose comments.
  => the page-1 chatbox. KEPT, untouched.
- `src/tree-graph.js:94-100` `monitorBrace()`, emitted twice per chip at
  `:941`, styled at `src/tree-graph.css:452-493`. The chip IS the page-2
  chatbox: `_makeChip` binds click/Enter to `openChat(record)` and the CSS has
  `.static-tree-chip.as-chat .monitor-brace`.
  => the page-2 chatboxes on the tree. KEPT, untouched.
  (`src/node-chatbox.js` names no brace at all — it is the geometry planner.)

**B. a Georgia `{` `}` glyph pair — REMOVED, both instances**
- `src/views/metrics.js` `.m-sankey-empty-brace` — the token-routing hero's
  unavailable state.
- `src/views/research.js` (x2 call sites) `.research-context > span` — around
  every curated summary and every queued observation.

Nothing else in the tree emits a brace. The remaining `brace` hits are the
`--brace` colour token, the `brace_stroke_width` Appearance setting (which now
governs exactly the two surviving braces), and prose — including three
"belt and braces" idioms and `src/comms.css:491` "This page has no braces",
all still accurate. `src/fleet-profile.js:512` ships the sentence "Everything
between the braces is sample content", which renders inside a chatbox and so
remains true.

## What replaced each removal (the judgment the owner delegated)

**metrics — the em-dash the page already uses for "no measurement".**
Measured at 1440x900: the copy column was 660px inside a 1704px slot, so each
190px glyph stood ~120px clear of the nearest word, and the gap GREW with the
viewport (the pair sits at the far margins at 1920). They bracketed nothing.
The panel's two hairlines already close the region. The replacement is the
`—` that the six stat tiles overhead put in their value slot when a figure is
unavailable (`metrics.js` `ref.num`), set at 44px: one page, one way of saying
"no measurement", already learned two bands up.

**research — a left rule, because this text is QUOTED.**
The register is full-bleed, so the pair's halves landed 1.6k pixels apart at
1440 (left `{` x=190, right `}` x=1815) around a paragraph that is often one
line; the right glyph also collided with the mono STATE/ORIGIN metadata. A
fixed 38px glyph cannot fit a block that is 1 line in the queue and 2-3 in the
catalog. A left rule plus inset is the mark for held text and is layout, not
ornament: its height IS the paragraph's, at every width, in every theme, with
no JS. It keeps the brackets' tone by reusing `--brace` (the token whose alpha
is solved per theme to composite at the same 2.10 weight on black/tan/white)
rather than `--line-2`, which would say "divider" where this must say "quoted".
Side effect, in the owner's favour: each row lost the 38px glyph's height, so
the register shows 4 catalog entries above the fold at 1920 where it showed 1.

## Evidence

Shot with a copy of the app's own `tools/page2-shoot.cjs` harness
(`artifacts/brace-shoot.cjs`, gitignored), 3 themes x 5 widths, looked at by
eye plus 4 contact sheets in `artifacts/sheets/`.

- BEFORE/AFTER, metrics + research: 30 + 30 shots,
  `artifacts/brace-before/`, `artifacts/brace-after/` (2m48s / 2m15s).
- Regression, the two SURVIVING surfaces: 30 shots. `homeBrace` = 2 on all 15
  home shots; `monitorBrace` = 18-20 on all 15 computers shots.
- Absence complement: metrics in simulated mode still draws the full sankey,
  so the changed CSS is inert on the populated branch
  (`artifacts/brace-after-sim/`).
- Final re-verify off the current tree after the LF fix below:
  `artifacts/brace-final/`, 6 shots, brace counts 0 / context 10.

Two harness facts worth keeping:
1. `ELECTRON_RUN_AS_NODE=1` is set in this environment; the shooter must be
   launched with `env -u ELECTRON_RUN_AS_NODE` or `app` is undefined.
2. The shipped `dist/data/research.json` is `ok:false` on this machine, so the
   populated research branch is unreachable by eye. It was rendered by
   generating a REAL projection through `tools/gen-research.mjs`
   (`MC_RESEARCH_ROOT` + `MC_OUTPUT_ROOT` at stub reports) and serving it as an
   overlay — the real code path with real data, not a DOM hack.

## Two things the coordinator should know

1. **Another lane rebuilds shared `dist/` while you work.** A concurrent
   `npm run build` landed mid-sweep and silently replaced the assets under my
   BEFORE shots. Both sweeps were redone against private outDirs
   (`artifacts/dist-before`, `artifacts/dist-after`) built from a pre-edit
   source copy. Any lane doing before/after visual work in this tree must do
   the same; `dist/` is not a stable baseline here.
2. **CRLF.** My edits rewrote all four files with CRLF although HEAD is LF and
   `core.autocrlf=false`, which made a 40-line change render as a 3790-line
   diff. Normalized back to LF before handing off; the diff is now 50/44.
   Worth checking on any lane that edits this tree from Windows.

## Files changed

- `src/views/metrics.js` — brace spans out, `.m-sankey-empty-mark` in.
- `src/metrics.css` — `.m-sankey-empty` to a centred column, mark rule in,
  `.m-sankey-empty-brace` out.
- `src/views/research.js` — 4 brace spans out (2 call sites).
- `src/research.css` — `.research-context` to a left-ruled inset, glyph rule
  and its narrow-breakpoint override out.

Not touched: `src/views/home.js`, `src/home.css`, `src/tree-graph.js`,
`src/tree-graph.css`, `src/views/computers.js`, `src/node-chatbox.js`,
`src/views/settings.js`, `src/views/checkout.js`.
