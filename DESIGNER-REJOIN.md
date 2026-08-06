# Welcome back — state of Mission Control since your handoff (b3670f8)

**For:** the original designer, returning per owner directive R1137
(2026-08-06, verbatim): *"it is supposed to be a software though not a site
any longer. I will send the original designer to come work with you on
finishing it."*
**From:** the R1134 coordinator (Claude Fable session b5345074). I merge,
verify, and run the program; you own the craft. Reach me on the `agent-coord`
durable memory board (write from the retired tree:
`node -e "require('C:/Users/joshp/Desktop/ToolsEnabled/src/lib/providers/memory').set({...})"`,
key prefix `designer/`), or leave notes in your commits — I read every one.

## What changed since b3670f8 — your design register is intact

Nothing visual was redesigned. Every design law, protected surface, probe,
and gate you left is still binding and still green. What changed underneath:

1. **Phase 1 — the simulation has a real data layer** (`7dfaad7`, `ed7ddd6`).
   Six generators (`tools/gen-*.mjs`) project real system state into
   `public/data/*.json` + versioned schemas; `src/live-status.js` grew
   per-domain readers. `npm run data:generate`, `npm run test:data` (17/17).
   Fail-closed everywhere: `{ok:false, reason}`, never an invented number.
2. **Phase 2 — all six ring pages + settings read live by default**
   (`7729f8c`). Per-view rollback flags `mc.live.<view>` (Settings → Data &
   Sim); `simulated` flips a view back instantly. Unavailable truths render
   as honest unavailable states (coordinator thread and ops messages are
   `source-unreadable-safely` today). **Your thread pin-at-load defect is
   fixed** — the 44px short-pin; `.mc-thread` 16/16 now.
3. **Phase 5 — audited write surfaces, default-off** (`ffc2f99`): dispatch +
   report forms on agent, approve/decline + strict queue claim/close on
   ledger, durable-receipt composer on home, a Write section beside Data &
   Sim. They talk to a loopback action bridge (`toolsenabled-current`,
   port 4610) — every action routes through the audited tool paths.
4. **In flight right now** (branch `phase5/write-default-on`, worktree
   `wt-bridge-live-mc`): write flags flipping to on-by-default with instant
   off, bridge auto-discovery, and the launch-rule work on the backend side.
   Merges through me.

## The one directive that changes your world: APP-FIRST (R1137)

The owner's primary surface is **your Electron shell**, not the browser.
Known consequence, unowned as of this writing: `shell/main.cjs` serves
`dist/` on an **ephemeral port** (`listen(0)`), so the app's origin differs
every launch — the action bridge's exact-origin allowlist cannot cover it.
Plan: fixed shell port (proposed 4601; EADDRINUSE = clear failure, not
silent fallback), bridge allowlist gains that origin, `.mc-app`/`.mc-app3`
prove it. This sits squarely in your `shell/` — it can be your first change
or mine, coordinate via agent-coord before either of us touches it.

## Gotchas discovered since your handoff (additions to your §5 list)

- **Four of your probes now need simulated-mode seeding** — `.mc-thread`,
  `.mc-comms-behave`, `.mc-layout-verify`, `.mc-role-hue` assert the
  SIMULATION's content, and live is the default. A bare run failing with
  `turns=0` is the live surface being honest, not a regression. Seed
  `mc.live.<view>='simulated'` via addInitScript (working wrapper pattern:
  `wt-p2-wiring/artifacts/p2/probe-worktree.mjs`; full note:
  `toolsenabled-current/docs/coordinator/PHASE2-POSTMERGE-EVIDENCE-2026-08-05.md`).
- The worktree-preview pattern for verification without touching the owner's
  live :4600: preview on `127.0.0.2:4600` + a host-resolver-rules remap in
  the probe wrapper. Proven twice.
- Known cosmetic opens, owner-visible: dense 13-node fleet graph crowds
  bottom-edge labels at rest (collide probes still 0/30 after settle); the
  metrics token-routing/token-flow charts render honest unavailable states
  because no token-flow source exists yet (a data-source decision, not a
  chart bug); the >500 kB chunk warning persists.

## Working agreement (proposal — push back freely)

- You own: everything visual, `shell/`, `styles.css`, protected-surface
  changes, the probe harness (`.mc-*.mjs` — "extend, don't rewrite" still
  stands, now both ways).
- I own: merges to `main`, verification (battery + own-eyes on tan),
  briefs/lanes on the data/bridge side, and shared authority files.
- Territory before touching: post an agent-coord note naming files, same as
  every lane here. Never two lanes in `styles.css` — your rule, still law.
- Show-before-commit on visually contested changes — your discipline,
  unchanged, and the owner still reviews live on tan and reacts fast.
