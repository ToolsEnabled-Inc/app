# Mission-control page-2 redesign spec (Fable5 designer, redo pass)

**Status:** design spec only, not yet implemented. Awaiting fable5-planner cross-check against session history (owner-requested), then a Codex implementation lane. Authorized by the owner: "try redoing the page 2 module entirely."

---

# TASK 1 — Page 2 (`computers.js`) full redesign spec

## 0. Whiteboard read (source of truth, all 9 images read directly)

- **IMG_7101 / IMG_7105 ("Pg 2" — THE page-2 sketch):** Tabs across the top: `Computer 1 | Computer 2 | ... | +`, heading "Computer 1", back/forward chevrons, settings star top-right. Left: a **static layered tree** of circular nodes, each containing only a runtime (`1:10:15 Runtime`) — root is Coordinator (light blue outline), children below it: Shadow Manager (green, `15:10:01`), Coordinator's Helper (orange, `59:55`), two Managers (dark blue), two Defaults (yellow) at the bottom tier. Nodes are **outline circles, not filled glowing spheres**. Each node has a **grey brace-framed context label** `{context, characters, gray}` beside it. Straight-ish clean connecting lines. Right panel: **"Runtime Statistics"** — bar chart (CPU / GPU / Network …), "Agent Count: 52", then **"Tasks:"** as a list of small outline-boxed task descriptions color-coded by role, then a **legend of small colored squares**: Coordinator (light blue), Coordinator's Helper (orange), Shadow Manager (green), Manager (blue), Default (yellow), Agent spawned (black/grey).
- **page 3.jpeg:** browser frame, same tree (root `1:10:05 runtime`, children `5:33:10` and `0:00:01`), explicit note `{grey} {content}` on the context labels, right side **two stacked panels: "Controls" on top, "Chat" below**, purple "scroll" arrows on the graph area (horizontal) and inside the panel column.
- **IMG_7107 (upside-down purple note):** "**2 ⇒ Double clicking on agent morphs the agent section into agent controls**." This is the trigger contract for the right rail.
- **agent transition.jpeg / IMG_7102:** the morphed state — "Coordinator" title, the agent's runtime in a circled ring (`06:51:12 Runtime`), a "Runtime Statistics" axes chart, an "Agent Controls" box, and a vertical stack of **small colored square status icons** (blue, orange, green, ⋮).
- **scroll down until graph.jpeg (verbatim):** "Scroll down until the graph is too wide and the bubbles are too small to look good, then require a user to select one of the bottom nodes and let that node smoothly become the new parent node. After this happens once…" (repeats recursively).
- **IMG_7100 / IMG_7104 ("Pg 1 /home"):** uptime circle + brace `{context, type feed, characters, gray}` with the purple law "**greyed text for context boxes**" — the grey-text convention that page 2's context labels must follow (they already use `--ink-3`, documented at `src/styles.css:73` as "greyed context text — still AA").

Controller's readings confirmed; the additions that matter: **role colors are part of his original design** (the legend squares and colored circle outlines are his own drawing) — "less childishly colored" means kill the glow/gradients/liquid-glass/saturated fills, **not** role color-coding itself; and the rail morph trigger is **double-click**, which the current code already honors.

## 1. What exactly produces the "moving" behavior (name-level removal list)

All in `C:\Users\joshp\Desktop\mission-control\src\graph.js` (3084 lines) unless noted:

1. **The d3-force physics simulation itself** — `forceSimulation` built in the constructor (~line 231) with `forceLink / forceManyBody / forceCollide / forceX / forceY` plus the custom `_labelAvoidForce` (line 977), rewired in `refreshForces()` (line 917). The **"Physics" layout toggle** (`computers.js` lines 571–574, `layout-pref.js`) exposes it as a mode.
2. **Ballistic flings and drag physics** — `_flingRaf` exponential-friction throw (~line 2140), squash-stretch settle (`graph.css` `.node.settling`, `--settle-amp/--settle-dur`).
3. **Structural glides even in Tree mode** — `_layoutTree()` animates every relayout over 680 ms (`STRUCTURAL_MS`, `EASE_STRUCTURAL`), with a 3-shot re-verify series that can re-glide; `glideToRoot()` 680 ms re-root cinematic.
4. **Entrance choreography** — `staggerNodesIn()` in `computers.js` (30 ms/node cascade), `.node.enter` `nodeIn .7s` scale bloom + `nodeTextIn`, spawn graphite→color bloom + `bloomBurst` ring (`graph.css` ~96–120), tab-switch dissolve (`GRAPH_FADE_MS` + stagger).
5. **Idle/hover flourishes** — `nodeRipple 0.9s` hover ring, dense-mode focus pulse (`FOCUS_PULSE_MS` 1900 × 3), chip slot easing (0.35/frame glide toward `_cx/_cy`), brace pulse.
6. **Rail choreography** (`computers.js`) — the cascade morph system (`markStagger/cascadeIn/cascadeOut`, `STAGGER_MS` 80), and the FLIP flights `flipHeroToRing`/`flipRingToHero` (460 ms ghost animations).

## 2. What produces the "childish" coloring (name-level)

1. **Liquid-glass bubbles**: `.node-glass` gradient fill + backdrop-filter refraction, rim at 70 %/84 % role dose (`--rim-role`, `styles.css:378/685`).
2. **The bright glow siblings**: `--g-coordinator #45d6ff`, `--g-helper #ffab4d`, `--g-shadow #35eab7`, `--g-manager #7d9bff`, `--g-default #ffd84d` (`styles.css:173-177`; also `ROLES[].glow` in `vocab.js`), and the generated glow stacks `--rg-soft/--rg-loud` (`glow.css`, `gen-glow.mjs`) on selection/drop/arrival.
3. **Role-colored curved links**: per-link 6 px `link-under` halo stroke + 1.6 px top stroke in the target role's hex, hash-seeded curvature (`renderLinkEls`, graph.js ~1053-1082).
4. **Gradient uptime ring** in the rail board: `colors: [role.glow, role.hex]`.

The base role hexes themselves (`vocab.js` ROLES: coordinator `#008dab`, helper `#c85900`, shadow `#00956c`, manager `#3e63f0`, default `#9d7900`, spawned `#697077` — derived at oklch L 0.595, AA-checked, mirrored as `--c-*` in `styles.css:159-164`) are **already the professional palette and stay**. They match the whiteboard legend one-for-one. Do not invent new hues.

## 3. What stays (do not throw away this plumbing)

- **Data wiring, both sources**: `sim.js` events (`spawn/reap/agent-state/context/reparent`), and the whole live-projection path — `fetchFleet`/`live-status.js`, `projectedComputer()` (tier ranks, cull ranks, `reparentAgent` cycle guard), `live-flags.js` switching, `renderTabs()` per-computer tabs (whiteboard has these tabs verbatim).
- **`_treeSlots()`** (graph.js 2647-2818): the deterministic tier-slot layout with capacity-aware packing, label budgets (`_setLabelBudget`), and owner-ruled culling. This is the layout core of the redo — extract it, don't rewrite it.
- **Edit mode** (protected surface: "we have to keep edit so users can manage the work tree"): the Edit/Done button, dashed-link edit register (`[data-edit-mode]` CSS), drag-onto-parent reparent with `wouldCycle` validation.
- **Drill-down machinery**: `setRoot/clearRoot/ancestryOf/renderAncestry` breadcrumb, `visibleAgents()` subtree filter, the `.graph-hint` density hint. This IS the whiteboard's "select a bottom node → new parent" interaction; it needs retuning, not rebuilding.
- **Brace-framed screen-space monitoring blocks** (protected: "go back to the boxes… I wanted the brackets like on page 1 and like in the original image"): `monitorBrace()` 5-piece SVG, `screenChips` overlay, chip→chat morph (`openChat/closeChat`, `buildChat`), Escape handling, grey `--ink-25/--ink-3` text.
- **Right-rail content blocks**: `renderStats()` (Agent Count hero, neutral-ink Load bars, role-colored task chips, square-swatch legend — all match IMG_7101), `agentChartBox()` ECharts activity plot, `uptimeRing`, tuning sliders, action buttons, "Open full view" → `#/agent/…` navigation, `showProjectionControls` live branch.
- **Contracts probes depend on**: `data-agent-id`, `data-parent-id`, `data-layout`, `data-edit-mode`, `window.__mcGraph`, `__graphFrameMs/__graphNodeCount`, keyboard a11y (tabIndex, `role="button"`, aria-labels), reduce-motion honoring. Keep all names stable; ToolsEnabled `.mc-*.mjs` probes match on them.
- **Zoom/pan + fit control**: user-initiated, not "moving on its own" — keep.

## 4. New module architecture

Do **not** modify `graph.js` (the agent page `views/agent.js` still runs FleetGraph and its lane solver; page 2 must stop importing FleetGraph without breaking agent). Build:

- **`src/tree-layout.js`** — pure function extracted from `_treeSlots()` + `_setLabelBudget` logic: `layoutTree({nodes, edges, W, H}) → { slots: Map<id,{x,y}>, rowYs, culled: Set<id>, drillRequired: boolean }`. No DOM, no timers, unit-testable.
- **`src/tree-graph.js`** — new `StaticTreeGraph` class: HTML circle nodes + one SVG layer for straight links, screen-chip overlay reused (import `monitorBrace`/chat pieces from graph.js or lift them into a shared module `src/graph-chrome.js` if import cycles bite). **No d3-force import.** Constructor computes layout once; recomputes only on: data change, resize (via the existing ResizeObserver idiom), drill, edit. No rAF loop at rest — the only per-frame work permitted is an active drag.
- **`src/views/computers.js`** — rebuilt view: tabs + StaticTreeGraph + rail. Same export signature `computersView({ initialComputer, navigate })` so `main.js` routing is untouched.
- `layout-pref.js` and the Tree/Physics seg control on page 2 are **retired** (see §11 flag). The Edit button stays.

## 5. Layout algorithm

**Layered/hierarchical (tidy) top-down tree — not radial, not force.** Exactly the whiteboard geometry: root centered on tier 0, tiers at fixed rows below, children spread under their parents.

- Reuse `_treeSlots()` math verbatim: tier rank = `tierRank` (live: controller 0 / org tier 1 / grey pool 2) or parent-walk depth (sim); adaptive row pads (104/92 yielding to 64/70 floors); per-tier capacity ladder (airy division → edge 12 → gap 0 → −6 near-tangent); label pitch budgets with tail-segment truncation; cull-over-budget for the grey tier in live mode.
- **Change**: the two-row "wrap" fallback and deeper packing are replaced by the whiteboard's answer — when a tier cannot be packed at readable size (the ladder fails, or computed diameter of the naive fit would fall below ~34 px radius equivalent), set `drillRequired: true` instead of wrapping/smearing. Rendering then keeps the tier at its readable minimum, culls per the existing cullRank priority, and arms the drill affordance (§8).
- **ECharts question, answered**: ECharts does ship a built-in deterministic tree (`series-tree`, orthogonal layout) and the repo already tree-shakes ECharts (`echarts-theme.js`). **Do not use it for the graph.** The nodes are live HTML components — ticking runtime clocks (`bindRuntime`), brace-framed context blocks, in-place chat panels, drag-to-reparent, keyboard focus — none of which survive inside an ECharts canvas/SVG series, and the metrics lane deliberately excludes ECharts chrome to avoid "the library look." The deterministic layout code already exists in-house (`_treeSlots`). ECharts stays exactly where it is: the rail's Runtime Statistics plot (`agentChartBox`).
- **Determinism rule**: same inputs → same positions, every time. Sort keys already exist (parent x, then id compare). No `Math.random()` anywhere in the layout path (`_spawnSpot`'s random ring phase dies with the physics).

## 6. Node, edge, and label visual spec (concrete tokens)

**Node** (replaces `.node-glass` liquid glass):
- Circle, `background: var(--sheet)` (white `#ffffff`, tan `#fbf1c7`, black `#14171b`) — flat, **no gradient, no backdrop-filter, no glow, no inset highlight**.
- Ring: `border: 1.5px solid var(--c-<role>)` (the vocab.js hex — this is the whiteboard's colored circle outline). Hover: `border-width: 2px` + `background: color-mix(in oklab, var(--c-<role>) 6%, var(--sheet))`. Selected: 2 px ring + a second 1 px offset ring `color-mix(in oklab, var(--c-<role>) 35%, transparent)` — shape+weight, never a blur/glow.
- Contents unchanged: runtime digits `var(--ink)` in `--font-mono` tabular, caption "Runtime" in `var(--ink-3)` 11 px caps. No-telemetry nodes stay bare spheres (existing rule).
- Name label under node: `var(--ink-2)`; role label: `var(--ink-3)` (existing registers, keep).
- Delete from page 2's path: `--gc`, `--rg-soft`, `--rg-loud` usage, `.node.bloom`, `bloomBurst`, `nodeRipple`, `.settling`. (`glow.css` itself stays — other surfaces read it.)

**Edges**: straight lines (or a single-elbow vertical-horizontal-vertical orthogonal route if straight lines cross a tier's labels — implementer's choice, but one style everywhere), **one stroke**: `1.25px solid` at `color-mix(in oklab, var(--ink-3) 45%, transparent)` — neutral grey, not role-colored, no 6 px under-halo, no curvature hashing. Non-hierarchy declared edges (reviews/escalations, live mode) render dashed `2 3` at 30 % of that — annotation whisper, same as today's `link-soft` intent. Edit mode: hierarchy edges dashed (existing convention, keep the exact `[data-edit-mode]` selectors).

**Context labels**: unchanged in register — brace-framed blocks, text `var(--ink-25)`/`var(--ink-3)`, the role's only appearance being the existing 2 px accent bar at the muted `--rim-role` mix. They are already the whiteboard's `{grey content}`. Placement simplifies: with a static layout, chip slots are computed once per layout pass (keep the slot-election code, drop the per-frame easing — chips **place**, they don't glide).

**Legend/status marks**: keep the small square swatches (`.leg i`) but fill them with the flat `--c-*` hex, no `--lg` glow. This is literally the whiteboard legend.

## 7. Edit behavior

Edit button toggles edit mode (unchanged). Within edit mode, two gestures:

1. **Drag onto another node → reparent** (existing: `wouldCycle` guard, `onReparent`, `drop-ok`/`refuse` states — keep, minus the refuse shake animation if reduce-motion is set).
2. **Drag to empty space → position override for that node only.** The node follows the pointer 1:1 (no physics, no neighbors reflowing, no reheating — nothing else on the canvas moves). On release it stays exactly where dropped.

**Persistence**: `localStorage` key **`mc.tree.pos.<computerId>`** → `{ [agentId]: { dx, dy } }`, where `dx/dy` are **offsets from the node's computed slot**, not absolutes — so a resize, a data change, or a re-layout keeps the edit meaningful (the node lands at `slot + offset`, clamped to canvas). Guard every access in try/catch like `layout-pref.js`. A "Reset positions" text button appears in the edit toolbar only when overrides exist for the current computer. Offsets apply in both browse and edit modes; reparenting a node clears its own offset (its slot just changed meaning). Live and sim computers share the mechanism (ids are stable within a source).

## 8. Drill-down / recenter (the "scroll down until…" sketch)

- **Trigger**: `drillRequired` from the layout pass (a tier can't pack readable), OR node count ≥ the existing `DENSE_AT` budget. Bottom-tier nodes with children become `focusable` (existing class), the hint shows: "Select a node to focus its branch" (existing `.graph-hint`). The focus affordance is static — a slightly heavier ring on hover, **no pulse loop**.
- **Action**: click a focusable node → `setRoot(id)`. **This is the one smooth transition on the page** (his word: "smoothly"): the selected node glides to the root slot over the existing `--ease-structural` 680 ms curve while non-subtree nodes fade out (plain 150 ms opacity, no stagger cascade) and the subtree's new slots fade in. One shot, then fully static again. Reduce-motion: instant swap.
- **Return**: breadcrumb `← Computer 1 / manager-2 / worker-5` (existing `renderAncestry`), every ancestor clickable, machine name clears the root. Recursion unlimited (matches "after this happens once" repeating).
- Horizontal scroll arrows from the sketch are satisfied by the existing wheel zoom/pan + fit control; no new scrollbar mechanism.

## 9. Right rail (Controls / Chat, per page 3.jpeg + IMG_7107)

Layout: rail fixed on the right (existing `aside.rail`), two pages.

- **Default page — "Runtime Statistics"** (IMG_7101): keep `renderStats()` content and order exactly: title, Agent Count hero, sub-line, Load bars (neutral ink — the palette split already made these professional), **Tasks** chip list (role-colored, deliberate identity), **Legend** (flat squares per §6). Live mode keeps `renderLiveStats()` (Fleet Projection register) untouched.
- **Double-click a node → morph to the agent board** (IMG_7107's contract; current code already triggers `onOpenControls` from dblclick — verify and keep the dblclick binding in the new TreeGraph's `wireInteractions` equivalent; single click = select/drill only). Board content and order stay as built (they encode the owner's later verbatim "under runtime in that panel should be the chatbox again"): agent head (name + role dot) → runtime ring → **Chat** → Runtime Statistics plot → Tuning box → pinned actions (Pause/Resume/Respawn/Terminate/Open full view). This satisfies page 3.jpeg's stacked Controls+Chat column; the sketch's Controls-above-Chat ordering is superseded by the owner's later explicit instruction — note for planner (§11).
- **Ring restyle**: `uptimeRing` colors become `[var(--c-<role>) at 35% mix, var(--c-<role>)]` — no `glow` hex. Chart single-series color stays `--rc` (now the flat role hex).
- **Motion simplification**: replace the cascade/FLIP choreography (`markStagger/cascadeIn/cascadeOut/flipHeroToRing/flipRingToHero`, ~200 lines) with one 180 ms opacity crossfade between rail pages. `‹ Statistics` back button unchanged. This deletes the largest block of remaining animation code in `computers.js`.

## 10. Motion budget (the whole page, exhaustive)

Permitted: (1) the drill-down/up recenter glide (§8); (2) rail page crossfade 180 ms; (3) chip↔chat open/close size transition (existing, owner-approved surface); (4) hover border/background transitions ≤ 200 ms; (5) node add/remove = 150 ms opacity fade in place. Everything else is static: no entrance staggers, no blooms, no ripples, no settles, no pulses, no per-frame easing, no idle rAF. Target: `__graphFrameMs` probe irrelevant at rest because **no frame loop exists at rest**; settled LayoutCount single-digit (existing discipline, now trivially met).

## 11. Flags for the fable5-planner (check against session history before implementation)

1. **Physics removal supersedes an earlier reversal — planner-verified.** HANDOFF.md §3 records "physics mode also STAYS by explicit reversal ('keep the physics. fix the lag')" — but the newest owner instruction is "getrid of the moving tree bit and such" + "try redoing the page 2 module entirely," and HANDOFF **§5**'s rule is "treat the newest instruction as final" (not §10, corrected per planner check). Stronger authority than either: the owner's own R1162 ratification, "if you built R system right with the 1.1.2 then newer directives overrride older directives which is correct." This spec removes the Physics toggle **from page 2 only**; FleetGraph and its physics survive untouched for the agent view. Planner confirmed no later owner message re-protects physics on page 2, and found owner-era precedent for the professional-not-childish direction (commit `06afdde`: "still looks a bit childish — give it a more professional edge") plus a doubly-superseded counter-signal (R1044's neon-accents ask) that does not change this conclusion. **PLANNER VERIFIED, see `R1162-MC-PAGE2-PLANNER-VERIFICATION.md`.**
2. **Rail cascade/FLIP deletion** (§9) removes owner-era craft that was never explicitly complained about — it's justified by "redo the module entirely" + the mechanical register, but it is a judgment call.
3. **Controls/Chat order** (§9): sketch says Controls above Chat; later verbatim says chat under runtime. Spec follows the later verbatim.
4. Implementation lane must keep the ToolsEnabled probe battery green (`smoke`, `collide/comp/ui`, `contrast`, `role-hue`) and eyeball all three themes on tan first; DOM contract names in §3 are load-bearing for the probes.

---

# TASK 2 — Metrics/Sankey diagnosis (scoped)

**Root cause found, in code, not speculative:** the Sankey renders only in **simulated** mode, and metrics now defaults to **live** mode, where it is deliberately never drawn.

- `src/live-flags.js`: a missing preference means LIVE ("a missing preference means LIVE once that view's wiring has passed its gate battery"), and the `metrics` flag has no `defaultLive: false` — so `isLiveView('metrics')` is `true` for any profile without a stored `mc.live.metrics` key.
- `src/views/metrics.js:1677/1732-1743`: in live mode `applyLiveProjection()` runs and calls `setProjectionUnavailable('sankey', '#sankey-sub', …, ['#sankey-chart'])`, which **replaces the chart host's children with the plain text** "unavailable · aggregate projection has no token-routing observation." Charts are intentionally never initialized in live mode ("a simulated shape, even for a frame, would be a false live claim").
- `tools/gen-metrics.mjs` contains **zero token-routing/sankey output** (grep confirms no match), so the live projection can never satisfy the Sankey. Net effect: the owner opens metrics, gets live mode by default, and where the hero Sankey should be there is one small grey text line — "not seeing the sankey token flow graph," exactly as reported.
- Secondary (less likely) contributors, worth one check each during the fix: a stale `mc.metrics.layout` key in his profile would move the sankey module to the tray (standard layout is key-absence; components absent from stored rows live in the tray — `metrics-layout.js:11-13`); and a stale `dist/` behind the desktop shortcut — unlikely, since even the frozen `V1safe` fallback is at `3992fa8`, which already includes the Sankey hero.
- **Owner's actual words (planner-corrected citation)**: "oon software and local host, maybe its because there isnt data but i dont see like the sankely token flow graph for example" and "there was a sankley chart. maybe its just because theres no data that im not seeing it?" — the diagnosis above was independently spot-checked against this exact text and against the code (`live-flags.js:24`, `metrics.js:1742`, `tools/gen-metrics.mjs`) by the fable5-planner and holds. **PLANNER VERIFIED, see `R1162-MC-PAGE2-PLANNER-VERIFICATION.md`.**

**Fix options to dispatch (either/both, small):** (a) teach `tools/gen-metrics.mjs` to emit a token-routing observation (pools → providers → roles conservation is already derivable from whatever usage data the generator reads), which lights the Sankey up in live mode legitimately; and/or (b) style the live unavailable state as a designed empty-state panel (module keeps its 430 px hero slot with a clear one-line explanation and a "view simulated" affordance) instead of a text line that reads as a missing chart. Do **not** silently render simulated data in live mode — that violates the module's own stated law.

---

# TASK 3 — Research page (separate from metrics, scope statement)

Owner verbatim: "i want research and metrics 2 seperate pages." **Metrics stays exactly as its own page, untouched by this item.** Research becomes a new, independent page:

- **New `src/views/research.js`** + nav/routing: add `research` to `ORDER` in `src/main.js:30`, a `parse()` case for `#/research`, a `makeView` case, and a `crumbFor` entry. It is a ring-nav peer of home/computers/metrics/comms/ledger, not a metrics module or tab.
- **Data**: consumes the existing projection — `fetchProjection('research')` in `src/live-status.js` already supports the domain, and `public/data/research.json` (+ schema) is already generated by `tools/gen-research.mjs`. No new backend work.
- **Content (matching the envelope's actual shape)**: a corpus catalog list — for each safe report: title, date observed, size, and the curated summary in the grey context register; flagged reports (`needsOwnerAuthorization: true`) render as locked rows showing title + `authorizationReason` only, never content (the R198 boundary is already enforced generator-side — the page must not weaken it); a "Method notes" section rendering the seven guidance entries; `findingsRegister`/`failureTaxonomy`/`openQuestions` render their unavailable reasons honestly per the site's unavailable-is-not-zero rule. Visual register: page-1 conventions — bare text, hairlines, brace grouping, no cards, square corners, all three themes. An unavailable envelope renders the standard `projection-unavailable` treatment.

---

**Key file paths:** `C:\Users\joshp\Desktop\mission-control\src\views\computers.js`, `src\graph.js`, `src\vocab.js` (ROLES hexes), `src\styles.css` (tokens §159-177), `src\graph.css`, `src\layout-pref.js`, `src\live-flags.js`, `src\views\metrics.js` (lines 1732-1743), `tools\gen-metrics.mjs`, `tools\gen-research.mjs`, `src\live-status.js`, `HANDOFF.md`; whiteboard sources `C:\Users\joshp\Desktop\webimages\*.jpeg`.
