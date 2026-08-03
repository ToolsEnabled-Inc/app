# Mission Control — Upgrade Plan (v2)

Goal: close the gap to the whiteboard vision + Apple liquid-glass feel.
Every lane has BINARY acceptance criteria; a lane ships only when its reviewer
marks every criterion PASS with evidence. One fix round, then escalate.

## North-star criteria (apply to every lane)
- N1 Whiteboard fidelity: nothing from the sketches regresses (uptime ring, tabs,
  role colors/legend, runtime-in-bubble, context braces, chat|controls split,
  re-rooting, settings gear).
- N2 Liquid glass: every surface refracts the aurora (no flat opaque cards);
  rim light + specular + depth shadows everywhere.
- N3 Motion: every state change animates 200–800 ms, spring/ease, in place.
  No popups, no layout jumps, no white flashes.
- N4 Clinical minimalism: white space, hairline borders, grey context text,
  validated palette tokens only, two fonts only.
- N5 Aliveness: timers tick, feeds stream, stats drift — nothing static.
- N6 Zero console errors; `npm run build` clean; no renamed public classes/APIs.

## Lanes, difficulty, assignment

| Lane | Scope (file territory) | Difficulty | Agent |
|---|---|---|---|
| T1 Glass material v2 | `src/styles.css`, `index.html` | hardest | fable · xhigh |
| T2 Graph motion | `src/graph.js`, + new `src/graph.css` | hardest | fable · xhigh |
| T3 Shared-element morphs | `src/views/computers.js`, `src/main.js`, `src/components.js`, + new `src/morphs.css` | hard | opus · xhigh |
| T4 Metrics interactivity | `src/views/metrics.js`, + new `src/metrics.css` | medium | opus · high |
| T5 Home polish | `src/views/home.js`, + new `src/home.css` | medium | sonnet · xhigh |
| T6 Agent page | `src/views/agent.js`, + new `src/agent.css` | medium | sonnet · xhigh |
| Reviewers (per lane) | read-only + screenshots | — | opus · xhigh |
| Integrator | build + trivial fixes only | — | sonnet · high |

Territories are disjoint. New CSS files are imported from the lane's own JS
module. Additive changes only — no renames, no new dependencies, no dev servers.

## Acceptance criteria

### T1 Glass material v2
1. Aurora bleed visible through every card (screenshot evidence on all 4 pages).
2. `.glass` gains hover specular sweep (animated gradient, ~700 ms), rim light,
   inner bottom shadow — CSS only.
3. `.node-glass` reads as a lens: layered radial highlights + subtle 1 px
   spectral inner ring + stronger backdrop blur/saturation; 60 fps with 16 nodes.
4. Aurora: 6 slow blobs (add violet), 45–70 s drift, honors reduce-motion.
5. Every interactive element (buttons, tabs, sliders, toggle, inputs) has liquid
   press (scale + glow bloom) and a neon `:focus-visible` ring.
6. Palette hues unchanged; text stays on ink tokens; build clean.

### T2 Graph motion
1. Links are organic quadratic curves (bend 12–24 px), still trimmed to bubble
   edges, glow underlay intact.
2. Drag release flings with pointer velocity; grab/release squash-stretch.
3. Pointerenter ripple ring, self-removing.
4. Spawn: graphite → role-color bloom + one glow burst (~900 ms); reap:
   deflate-fade (~500 ms).
5. Re-root cinematic ≤800 ms: target glides to root slot, non-subtree stagger
   fades (~40 ms/node); breadcrumb works ≥2 levels, each ancestor clickable.
6. Focusable pulse only when dense; never clips labels.
7. Click-select, manual dblclick→controls, chip→chat morph, radial chips all
   still work.
8. Measured avg frame < 17 ms @ 16 nodes (report the number).
9. Build clean; constructor opts/methods unchanged.

### T3 Shared-element morphs
1. Rail stats↔controls: staggered crossfade (~80 ms cascade); Agent Count hero
   morphs continuously into the agent runtime ring (no blank frame).
2. Tab switch: graph crossfade + staggered node entry; agent count counts up.
3. "Open full view": outgoing view scales toward the node (transform-origin at
   node), agent view fades up, ~500 ms, no flash.
4. `countUp()` exported from components.js (additive).
5. No popups; hash routes unchanged; build clean.

### T4 Metrics interactivity
1. Glass filter row: 24h/7d/30d + machine All/C1/C2; charts TWEEN between
   simulated ranges (no snap).
2. Tooltips everywhere: failure bars, donut segments, heat cells, token chart,
   pool meters.
3. Tiles count up on change; sparkline end-point pulses.
4. Table sortable (numeric cols + name), sort arrow, FLIP row reorder.
5. Dataviz spec intact: ≤24 px bars, rounded data-end/square baseline, hairline
   solid grids, text on ink tokens, legends for ≥2 series, direct labels kept.
6. Build clean.

### T5 Home polish
1. Ring breathes (5–7 s glow), arc tip has a glowing dot, minute rollover fades
   (no jump); digits never shift layout.
2. Sub-caption = LIVE machine + agent totals from sim.
3. Feed lines slide in / fade out; braces flex on arrival; chat-open glides
   braces away with message stagger-in.
4. Build clean.

### T6 Agent page
1. Child bubbles: small orange rim activity arcs that pulse on that agent's
   context event (the sketch's orange marks).
2. Chat • Controls dot indicator synced to scroll-snap; cue hides after first
   scroll.
3. Panels fill height at 100% and 80% viewport height; chat input pinned.
4. Grey mono header strip: name · role · pool · model.
5. Build clean.

## Gate protocol
Reviewer per lane: verify EVERY criterion → PASS/FAIL + one-line evidence
(code cite or screenshot path). ACCEPT only if all PASS. REJECT → same-tier
fixer gets the FAIL list, one round; rebuild; re-review failed criteria only.
Still failing → escalate to the controller with evidence.

---

# v3 — Final quality pass (quality over quantity)

Owner directives: swarm OK (~20 agents); agents' Discord channel gets a page
("really cool clean minimalistic, slightly more professional, mostly
white/black, tasteful neon — not too much"); the missed square-box board stays
FOLDED in the rail but done properly; fonts big enough for vision issues;
scroll-wheel zoom mechanics on the graph.

## Lanes

| Lane | Territory | Agent |
|---|---|---|
| C1 Comms page (Discord) | `src/views/comms.js`, new `src/comms.css` | fable · xhigh |
| C2 Folded square-box board | `src/views/computers.js`, new `src/board.css` | opus · xhigh |
| C3 Wheel zoom + pan | `src/graph.js`, `src/graph.css` | fable · xhigh |
| C4 Design pass (type floor, contrast, neon restraint) | `src/styles.css`, `index.html` | opus · xhigh |
| C5 Agent page sweep | `src/views/agent.js`, `src/agent.css` | sonnet · xhigh |
| C6 Metrics polish | `src/views/metrics.js`, `src/metrics.css` | sonnet · xhigh |

## Criteria

### C1 Comms
1. Faithful to the real mechanism (recon brief in the lane prompt): channel
   identity, sender model, message shape rendered as a clean timeline.
2. White/black-first professional design: flat white surfaces, hairline
   separators, generous whitespace; neon only as tiny accents (live dot, role
   markers, hover). Crisp corners (≤8px).
3. Every font on the page ≥13px; timestamps mono; day dividers.
4. Alive: messages stream in with subtle entrances; pinned auto-scroll with a
   "jump to latest" chip when scrolled up. No popups.
5. COHERENCE (owner directive): the page must read as THIS site in a calmer
   register — existing tokens/fonts only, the shared topbar/aurora shell kept,
   at least the page's container surface uses the site's glass language, role
   colors identical to the graph's, motion uses the shared eases. A side-by-side
   with the other pages must look like one product. Verified by the holistic
   design reviewer as a blocking criterion.

### C2 Folded board
1. The dblclick rail morph becomes the whiteboard board: agent title, runtime
   ring, per-agent Runtime Statistics mini-chart WITH axes, Agent Controls in a
   SQUARE box (radius ≤4px, hairline border), legend with square swatches.
2. Only the board's internal boxes go square; the rail card itself unchanged.
3. Board fonts ≥12.5px, labels ≥ --ink-2 contrast.
4. Morph continuity (FLIP/stagger) preserved; ring digits stay inside the panel.

### C3 Zoom
1. Wheel zoom 0.55–1.7× centered on cursor, smooth; zoom layer transform keeps
   pointer math correct — drag/click/dblclick/chips work at every zoom.
2. Zoomed-in empty-canvas drag pans; a "fit" reset appears when ≠1×.
3. Works on both graph pages; reduce-motion = instant; no interaction
   regressions (each verified explicitly).

### C4 Design pass
1. Type floor: nothing below 11px (uppercase micro-labels only); interface text
   ≥12px; reading content ≥13px. Coherent scale bump, no layout breakage.
2. Informational text ≥4.5:1 contrast on white (decorative grey stays allowed).
3. Neon restraint: glow weight down ~20–25%, aurora slightly quieter; site
   reads white/black-first. Hues unchanged.
4. Screenshot-verified at 1600×900 and 1280×800 across all five pages.

### C5 Agent page
1. Chips never overlap bubbles/labels at both test sizes (strategy free).
2. Type floor compliance; keep orange arcs, dots indicator; spacing polish.

### C6 Metrics
1. Type floor (ticks ≥11px, labels ≥12px); restraint aligned with C4.
2. No clipped labels/legends at both test sizes; dataviz specs intact.

## Gate protocol
Same as v2 (per-criterion PASS/FAIL with evidence, one fix round), plus one
holistic design reviewer judging the whole site against: clinical, professional,
white/black-first, tasteful neon, whiteboard fidelity, big readable type —
returning a must-fix shortlist that feeds the fix round.

### C7 Watch board (owner addition, follows C1)
The comms page's centerpiece: "really smoothly useful for watching multiple
chat faces… have the multi agent chat view revolve around the context boxes."
1. A Watch mode (default) alongside the C1 channel timeline mode: a board of
   live CONTEXT BOXES — one per active conversation (controller↔builder,
   reviewer↔builder, cross-machine coordinator pair…), each streaming grey
   context lines exactly in the graph chips' visual language, with the agent
   pair + role dots in the header.
2. Box size is user-settable on the page: a size control (S / M / L at minimum,
   or continuous) that smoothly re-flows the whole board; per-box expand into a
   full chat in place (no popups), collapse back.
3. Branches: a conversation that has deeper sub-conversations shows a branch
   affordance; opening it slides the child conversation in SIDE-BY-SIDE with
   its parent, visually paired (shared accent tick/connector, dismiss returns
   the space smoothly). At least two branch levels demonstrable.
4. Smoothly useful for WATCHING: new activity gives a quiet pulse on the box,
   auto-following scroll inside each box, a pause-on-hover so text never moves
   under the cursor, and the board never reflows in a way that loses the box
   you're reading (stable positions on stream updates).
5. Coherence: same tokens/fonts/glass shell; white/black-first, tasteful neon
   accents only; type floor respected (≥13px reading text).

#### C7 amendment (owner): reuse, don't rebuild
The watch board is not a new widget system. It is the EXISTING context-box
component reused: the same `.chip` / chip-preview / `.as-chat` classes and the
shared `buildChat()` from components.js, laid out as a board. Same grey preview
lines, same FLIP expand-to-chat, same close morph. C7.1–C7.4 are read through
this lens — a reviewer seeing a bespoke parallel box implementation instead of
the shared component language FAILS criterion 1. (Territory unchanged:
comms.js/comms.css may USE the global chip classes and components.js exports;
graph.js and styles.css stay untouched.)

#### C7 layout model (owner refinement — replaces any conflicting C7 wording)
- Default state: the context boxes sit FIXED in a vertical stack you scroll
  down through (they do not float or follow anything).
- Dragging a box over another region shows quiet drop indicators on the target
  halves: left/right → side-by-side split; top/bottom → up-and-down split.
  Releasing performs the split smoothly (no popups, ghost follows the cursor).
- Splits NEST and the operation is repeatable MULTIPLE times (verify ≥3
  successive splits building a tiled layout); every tile is the same reused
  context-box component (preview or expanded chat), individually scrollable.
- Removing/dragging a box out of a split collapses that split smoothly and
  returns the space. The size control from C7.2 still applies to stack mode;
  inside splits, tiles share the pane.
- Layout persists in memory while navigating within the session; reduce-motion
  = instant snaps. The whole mechanism verified at 1600×900 and 1280×800.

#### C7 importance sizing (owner)
In EVERY section/pane the user opens (the base stack and each split tile
group), the context box of the MOST IMPORTANT agent present is the biggest
panel in that section — visibly dominant (roughly 1.5–2× the area, e.g. full
row width or the larger split share). Importance = role rank
(coordinator > helper = shadow > manager > default); within a branch pairing
the parent conversation dominates. The dominance re-computes smoothly whenever
boxes are dragged between sections. Reviewer verifies by opening ≥2 different
sections with mixed roles.
