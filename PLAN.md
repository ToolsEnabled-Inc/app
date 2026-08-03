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
