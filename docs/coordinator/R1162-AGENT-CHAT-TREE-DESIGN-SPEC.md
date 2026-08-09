# R1162 Agent-chat-tree design spec (fable5-designer, worktree `r1162/agent-chat-design`)

All source read before designing: the requirements brief and both page-2 docs; `HANDOFF.md`; `vocab.js`, `tree-layout.js`, `tree-graph.js` (all 1310 lines), `computers.js`, `graph.js` (front 700 + full method map), `agent.js` (all 1347 lines), `components.js`, `comms.js` (structure + seeded content), `live-status.js`, `live-flags.js`, `mission-bridge.js`, `write-surfaces.js`, `write-flags.js`, `tools/gen-agents.mjs`, `tools/gen-projection-lib.mjs`; toolsenabled-current's `config/agent-org.json` (rev 17), `src/lib/agent-org.js` role enum, `src/lib/mission-bridge/` (server + actions), `tools/mission-bridge.js`, `state/agent-launch/coordinator-sol.json`, a live lane console log, the agent-comms tool definitions at `tool-registry.js:1151-1170`, the bounded-reader exemplar `usage-attribution-query.js` (found in the `wt-r1162-*` worktrees, not toolsenabled-current — noted below), the custom-roles evidence (D16, `R1162-DIRECTIVE-COHERENCE-LIST.md:126-129`), and the whiteboards (IMG_7101, page 3.jpeg, IMG_7107).

---

## 0. Verified ground the design hangs on

1. **Two layout systems exist today.** Page 2 ships `StaticTreeGraph` (`src/tree-graph.js`) over the pure `layoutTree()` (`src/tree-layout.js`) — deterministic, no d3-force, 28/28 QA green. The agent drill-in (`src/views/agent.js`) still runs `FleetGraph` (`src/graph.js`, d3-force) plus its own ~700-line band/lane chip solver and a perpetual rAF loop.
2. **`layoutTree()` distributes each row's nodes evenly across the full width** (`packedXs`: `step = width/(n+1)`), sorted by parent x — children are *near* their parent but **not centered under it**. That, plus links drawn from wherever the even packing lands, is the geometric source of "the lines are so angled." d3-hierarchy's tidy tree is exactly the missing property: subtrees group, parents sit centered over their children, sibling subtrees never interleave.
3. **Real activity data exists on disk and nothing reads it**: `state/agent-presence.json` (runId/pid/status/heartbeat, already normalized by `agentControlTarget()` in `tools/gen-projection-lib.mjs:305`), `state/agent-launch/<agentId>.json` (role, tier, lane, territory, dispatcher, and the **absolute `consoleLog` path**), `logs/lane-consoles/<agentId>-<ts>.log` (real codex/claude transcripts).
4. **A real authenticated write path already exists and mission-control already uses it**: the mission bridge (`toolsenabled-current/src/lib/mission-bridge/`, loopback 127.0.0.1:4610-4619, bearer token, durable audit receipts) with actions `dispatch / report-read / queue / thread-reply / decision / terminate / ledger-archive`, consumed via `src/mission-bridge.js` + `src/write-flags.js` + `src/write-surfaces.js`. The home view already posts real `thread-reply` writes. **This, not a new channel, is the write spine for Tasks 3 and 4.**
5. **`agent_comms.send` refuses local recipients by contract** (`tool-registry.js:1153`: "The local machine is refused; keep using agent-coord for local compatibility traffic") and machine B is disconnected (R1131). So on today's topology, `agent_comms.send` can deliver to *nobody*. Any design that says "chat routes through agent_comms.send" would ship a dead button. Task 3 below is written for the real topology, with agent_comms reserved for the cross-machine case and labeled honestly (legacy plaintext shared-key, per the security synthesis).
6. **Declared roles ≠ visual roles.** `agent-org.js:23` enum: `controller, shadow-manager, manager, coordinator-assistant, builder, reviewer, worker, observer` (+ orthogonal classifiers). `vocab.js` ROLES are the six visual identities. Two *different* declared→visual maps exist today (`computers.js:36` maps `coordinator-assistant→shadow`; `agent.js:63` maps it `→helper`) — a colour-follows-entity violation to fix in passing.
7. **Custom roles are a real queued owner feature** (D16, ACTIVE: "users should be able to edit role rules … create their own custom roles … with a way to roll back to default", R1162 appends). Nothing is built yet. Task 4 must therefore render the role list *from data*, never hardcode the enum.
8. The bounded-reader exemplar `tools/usage-attribution-query.js` lives in the `wt-r1162-*` worktrees (integration branch), **not yet in `toolsenabled-current\tools\`**. The pattern is: read-only, hard caps (≤200 events), typed refusals, JSON out, no SQLite opened directly. Task 2's new CLI follows it; the implementation lane should confirm whether the integration branch has landed by build time and place the new CLI beside whatever exists.

---

# TASK 1 — One d3-hierarchy renderer for page 2 and the agent view

## 1.1 Library choice: `d3.tree()`, not `d3.cluster()`

`d3.cluster()` is a dendrogram: **all leaves are forced to the deepest row**. In this org a manager with no workers must sit on the manager tier, not be dragged to the bottom; the live projection's `tierRank` (controller 0 / org tier 1 / grey pool 2) makes mixed-depth rows the normal case. `d3.tree()` (Reingold–Tilford tidy layout) keeps nodes at their own depth, centers every parent over its children, separates sibling subtrees without interleaving, and is deterministic for a deterministically ordered hierarchy. Same ecosystem as the already-present `d3-force` (which this migration ultimately deletes), tiny surface (`d3-hierarchy` is dependency-free, ~10 KB).

**Dependency change (`package.json`):** add `"d3-hierarchy": "^3.1.2"`. Remove `"d3-force"` in the *second* commit of the wave (after `graph.js` is unreferenced), so the revert path stays one `git revert` wide.

## 1.2 Architecture: keep the shipped contract, swap the geometry core

Do **not** restart `StaticTreeGraph`. The migration is three bounded moves:

**(a) `src/tree-layout.js` — MODIFY (geometry core only; public contract unchanged).**
`layoutTree({nodes, edges, W, H}) → { slots, rowYs, culled, drillRequired, labels }` keeps its exact signature, its input tolerance, and its guarantees (new Maps/Sets every call, no input mutation, no DOM, no `Math.random`). Interior changes:

1. Keep `hierarchyParents()` verbatim (its observed-first edge ordering, dedupe, and cycle guard are shipped, tested behavior).
2. Build a `d3.hierarchy` from the parents map; multiple roots get one synthetic root (id `"\0forest"`, never emitted). Children sorted by `id` (localeCompare) for determinism.
3. Run `d3.tree().nodeSize([1, 1]).separation((a, b) => a.data.r + b.data.r + (a.parent === b.parent ? 44 : 64))` — separation in radius units so big coordinator bubbles get proportional air; extra air between different subtrees is what makes sibling groups *read* as groups.
4. **Row assignment stays ours, not d3's**: `row = tierRank ?? depthFor()` exactly as today (d3's structural depth is overridden so the live projection's tier rows survive). `rowYs`, adaptive `padTop/padBottom`, and the row-height math at `tree-layout.js:165-191` are unchanged.
5. Per row: take d3's x order and positions, scale the row's span to fit `[edge, W-edge]`. If the scaled positions violate `r_i + r_j + 2` for any adjacent pair, run the existing `PACKING_LADDER` fallback **in d3's left-to-right order** (which by construction follows parent grouping). If the ladder fails or naive readable radius < 34px: `drillRequired = true`, cull via the existing `keepReadable()` (cullable/cullRank priority), re-run on the survivors. Nothing about culling, drill signaling, or `labelFor()` pitch budgeting changes.
6. New unit tests in `tools/test/tree-layout.test.mjs`: (i) parent-centered invariant — for every parent, `|parent.x − mean(children.x)| < 1px` on an uncrowded canvas; (ii) no subtree interleaving — the x-intervals of two sibling subtrees on the same row do not overlap; (iii) all existing cases (determinism, tiers, crowding, declared edges, cyclic input) still pass byte-for-byte on the contract fields.

**(b) `src/tree-graph.js` — MODIFY (small additions, no rewrite).**
- New constructor option `chipPredicate` (function, default null = chip every visible node), mirroring FleetGraph's: the agent view chips only the focused agent + direct children.
- New constructor option `chatBuilder` (defaults to `buildChat`) — the seam Task 2 uses; see §2.4.
- `openChat()` height/width math already adapts to short hosts; verify at the agent strip's ~240-360px height in QA, no code change expected.
- Everything else — probe globals, chip overlay, beam-search slot election, edit drag, drill transition — is reused as-is.

**(c) `src/views/agent.js` — MODIFY (the actual complaint).**
Replace the FleetGraph mount (`agent.js:704-719`) and delete the entire private placement machinery — `rectsOverlap` through `solveBands` (lines 143-491) and `placeOpenChips`/`drawLink`/caches (lines 694-1213) — with a `StaticTreeGraph` mount rooted at the focused agent, chipping only itself + direct children, wired to the live projection's relationship edges (reviews/escalates render dashed), and re-rooting navigation on click.

Mappings for what agent.js does today that `StaticTreeGraph` doesn't:

| agent.js today | in the unified renderer |
|---|---|
| `graph.setLayout(readLayout())` + physics default | gone; the tree is the only layout. `src/layout-pref.js` loses its last reader — retire the file in the cleanup commit |
| Tree/Physics toggle sticky pref | none on this page (page 2 already removed it, planner-verified §11.1; the owner's newest words — "more mechanical and consistent and reliable" against this exact view — are the authority for extending the removal here; flag restated in §5) |
| own band/lane chip solver + per-frame rAF placement | `StaticTreeGraph._placeChips()` beam search (obstacle-aware, extend selector list for this page's crumb) — runs on layout/zoom/chat events only, never per frame |
| rim activity arcs matched by `.node-name` text | keep `buildRim()`; attach via `record.el.dataset.agentId` (StaticTreeGraph sets it at creation — the fragile text-matching hack dies). Pulse stays event-driven one-shot ≤900 ms, no-op under reduce-motion |
| declared-role label rewrite | keep: after mount, set `.node-role` text to `agent.declaredRole` per node |
| 80 ms rAF loop for ring + chips | delete. The runtime ring joins the existing central 1 s clock (`bindRuntime`/`tickRuntimes` in `components.js`) — a dial whose arc moves 6°/minute does not need 12 Hz |
| `cx-links` leader SVG + `--rc` stroke resolution | `StaticTreeGraph`'s `.graph-chip-leaders` layer (neutral hairline). Delete `.cx-*` rules from `src/agent.css`; keep `.node-rim` rules |

Untouched: the Chat/Controls scroll-snapped panels, panel dots, scroll cue, terminate controller, write surface, uptime ring sizing, breadcrumb.

**(d) Retirement of `src/graph.js`** — commit 1 leaves it in-tree but unimported (Vite tree-shakes it and d3-force out of the bundle; instant revert stays possible); commit 2, after the owner has seen the new agent view, deletes `graph.js`, `graph.css`'s force-only registers, `layout-pref.js`, and the `d3-force` dependency. Solver-only imports in agent.js die with the solver.

## 1.3 Preserved DOM/probe contracts (verifier checklist, exhaustive)

On **both** routes (`#/computers`, `#/agent/<comp>/<id>`): `data-agent-id` + `data-parent-id` on every `.node`; `data-layout="tree"` on the canvas; `data-edit-mode` present exactly when editing (computers only); `window.__mcGraph` set on mount, cleared on destroy; `window.__graphFrameMs === 0`, `__graphNodeCount` live, `__graphStress` resolving `{static: true}`; `tabIndex=0`, `role="button"`, aria-labels on nodes; chip `role="button"`/tabindex swap through open/close; Escape closes topmost chat; `Shift+Enter` opens controls (computers); reduce-motion collapses every transition to instant; `mc.tree.pos.<computerId>` offset persistence and Reset positions (computers).

## 1.4 Tokens (all pre-existing; zero new colour values)

- Node: circle `background: var(--sheet)`, ring `1.5px solid var(--c-<role>)`; hover `2px` + `color-mix(in oklab, var(--c-<role>) 6%, var(--sheet))`; selected second ring `color-mix(in oklab, var(--c-<role>) 35%, transparent)` — exactly `tree-graph.css` today, now also on the agent route.
- Links: `1.25px` `color-mix(in oklab, var(--ink-3) 45%, transparent)`; declared/soft edges dashed `2 3` at 30%; edit mode dashes via `[data-edit-mode]` (unchanged selectors).
- Text: runtime digits `var(--ink)` mono tabular; "Runtime" caption 11px caps `var(--ink-3)`; name `var(--ink-2)`; role `var(--ink-3)`; context blocks `var(--ink-25)`/`var(--ink-3)` with the 2px muted role accent — all as shipped.
- Radius `--r-md` 3px everywhere; brace chrome via `monitorBrace()` unchanged.

## 1.5 Motion budget (both pages, exhaustive)

Identical to the page-2 shipped budget: (1) drill/re-root glide 680 ms `--ease-structural`, one node moving; (2) rail crossfade 180 ms; (3) chip↔chat size morph (existing); (4) hover transitions ≤200 ms; (5) add/remove 150 ms opacity; (6) rim pulse one-shot ≤900 ms on a real context/console event only. **Nothing animates at rest; no rAF loop exists at rest on either page.** Reduce-motion: all six collapse to instant/none.

## 1.6 Done =

`npm run test:data` green incl. new tree-layout cases; `tools/page2-qa.cjs` 28/28 unchanged; a new `tools/agent-qa.cjs` (clone of the page2 harness pointed at the agent route) asserting: §1.3 contracts, zero idle rAF ticks over a 2 s settled sample, parent-centered geometry, no `d3-force`/`forceSimulation` match under `src/` (`rg`), straight `line` links only. Screenshots of both routes, three themes, tan eyeballed first, compared against current gallery shots.

---

# TASK 2 — Real data in every context box and the right-hand panel (read layer)

## 2.1 Per-node-type source of truth

Every node resolves to exactly one of three states, decided mechanically, in this order:

| State | Decided by | Box/panel shows |
|---|---|---|
| **A. Live or recently-ended run** | presence record for `agentId` with `status` running/exited and a launch record present | facts row: `tier · lane · status · heartbeat <fmtAge>`; current/previous = last two console-tail lines; opening the box = full bounded activity log |
| **B. Enabled role slot, no current run** | declared in `agent-org.json` with `enabled:true`, no presence record; a *past* launch record may exist | header `no live run`; if a past run exists: `last run ended <fmtAge> · <lane>` + its final tail lines, explicitly labeled `last run`; else state C's register |
| **C. Declared-but-never-run / disabled** | `enabled:false` or no launch record ever | the declared register only: role, provider, enabled state, directive provenance (`$roleDirective.id`), and the honest line `no recorded activity · never dispatched` in the `.projection-unavailable` register. **Never a fabricated conversation.** |

Also, per node, real coordination traffic where the role has any: the coordinator node's panel links the existing coordinator-thread projection (home already renders it live); the shadow-manager node lists its `shadow/*` agent-coord keys if the activity CLI reports them.

## 2.2 The bounded reader CLI (browser never opens files — hard rule)

**NEW `toolsenabled-current/tools/agent-activity-query.js`** — CJS, modeled line-for-line on `usage-attribution-query.js`'s discipline:

- Read-only sources: `src/lib/agent-presence.js` reader over `state/agent-presence.json`; `state/agent-launch/*.json` (schema-checked per file, skip-with-reason on malformed); console tail read **only** from the exact `consoleLog` path recorded inside the launch record, and only after verifying it resolves inside `logs/lane-consoles/` (the `inside()` idiom from `mission-bridge/actions.js:73`). A caller can never supply a path.
- Flags: `--agent <id>` (repeatable, validated), `--tail <1..80>` (default 24), `--pretty`. No flag = all declared agents.
- Hard caps: ≤40 agents, ≤16 KiB tail bytes per agent (tail from EOF), ≤400 chars/line, ANSI stripped, CR/LF normalized. The launch `brief` path is emitted, **its content never is**; env/command args are never emitted.
- Output: `{ schemaVersion: 1, generatedAt, agents: [{ agentId, presence, launch, console: { ok, reason?, observedAt, truncated, lines: [string] } }] }`. Typed exit codes per the exemplar.

**MODIFY `mission-control/tools/gen-agents.mjs` + `public/data/schema/agents.schema.json`**: run the CLI via `runJsonCli` and attach an availability-wrapped `activity` block per declared agent. An unavailable CLI yields `activity: { ok:false, reason }` — the UI renders the reason, never zeros.

**Stage R2 (follow-up, flagged not blocking): on-demand freshness.** New bridge action `console-tail`, same caps as the CLI, durable audit receipt. Opening a chat panel refreshes from the bridge when reachable, else keeps the snapshot with its age label.

## 2.3 What the boxes render (content model)

- **Chip preview**: row 1 name + runtime; row 2 facts `tier · lane · status · <fmtAge>` (replacing `chat, tuning, activity unavailable`); rows 3-4 last console line; row 5 previous line.
- **Opened box / rail board**: a new **activity log** component replaces `buildChat` in live mode — same chrome family, body = timestamp-grouped mono rows, `observed <age>` footer, pinned-to-latest reusing `buildChat`'s existing pin contract. **No typing indicator, no streaming typewriter, no replies**: real lines land whole; simulated streaming on real data would be a false liveness claim.
- **Truncation defect fix (named in the requirements):** `.projection-unavailable`/`.rail-sub` get `overflow-wrap: anywhere; white-space: normal`, verified by clone-probe.

## 2.4 Exact files

NEW `toolsenabled-current/tools/agent-activity-query.js`; MODIFY `mission-control/tools/gen-agents.mjs`, `public/data/schema/agents.schema.json`; NEW `mission-control/src/activity-log.js`; MODIFY `src/tree-graph.js` (chatBuilder seam), `src/views/computers.js`, `src/views/agent.js`, `src/styles.css` (truncation fix).

## 2.5 Done =

With at least one real lane running: its node's box shows the actual last console lines and a live heartbeat age; killing the lane flips to `last run ended <age>`; a never-run declared identity shows the state-C register with zero fabricated content; no live-mode render path imports `buildChat`; the truncated-text defect is unreproducible in all three themes.

---

# TASK 3 — Write capability ("quickly easy to talk to specific agents and subagents")

## 3.1 The design decision, stated plainly

**All writes ride the existing audited mission bridge. No new channel, no new port, no browser-side file or memory writes.** `agent_comms.send` is *not* the local delivery mechanism — it refuses local recipients by contract (§0.5) and every agent on today's topology is local. It remains the designated transport for the cross-machine case only.

**(a) Currently-running agent.** New bridge action **`agent-message`**: input `{agentId, body}` (bounded ≤4000 chars); effect: one durable agent-coord memory write under convention `owner-ui/<agentId>`, matching the `thread-reply` pattern already shipped. **Delivery semantics are board semantics and the UI says so**: sent row shows `queued · read at the agent's next checkpoint`. No simulated reply, ever. If the agent answers (`owner-ui/<agentId>-answer`), it surfaces via the Task 2 read path with its real timestamp.
- **Prerequisite (flagged, coordinator territory):** lanes must actually be briefed to poll `owner-ui/<agentId>` — a one-line brief-template + channel-map change. Until it lands, the composer ships behind a write flag **off by default**.

**(b) Role slot with no running agent — recommendation: "talking to it" = composing for its next dispatch, two distinct affordances, defaulting to the safe one.**
1. **Queue note (default)** — same `agent-message` action; header states `no live run · messages queue for the next <role> dispatch`. Reversible, spawns nothing.
2. **Dispatch with this brief (explicit, separate)** — routes the drafted text into the existing audited dispatch form, pre-filled. Kept separate because dispatch spawns a real process; must never be the accidental meaning of pressing Enter.

## 3.2 UI flow

Chat panel becomes three zones: (1) Task 2's activity log; (2) composer, rendered only when write-enabled and bridge reachable, otherwise a quiet `read-only` line explaining why; (3) a transport footer stating the honest label (audited bridge locally; `agent_comms · legacy plaintext shared-key transport` for the future cross-machine case — never "secure channel").

**Files:** MODIFY `mission-bridge/actions.js`/`server.js`, `mission-control/src/mission-bridge.js`, `src/write-flags.js`; NEW `src/agent-composer.js`; MODIFY `src/tree-graph.js`, `src/views/computers.js`, `src/views/agent.js`. Sim mode untouched.

## Done =

With the bridge up and flag on: a send produces a durable agent-coord entry + audit receipt + a `queued` row that survives reload (from the read layer, not local state); with the bridge down, composer is absent with the reason stated; transport footer never oversells `agent_comms`.

---

# TASK 4 — Role management/swap in the tree

## 4.1 Source of truth and mechanism

`config/agent-org.json`, validated by `agent-org.js`, edited **only** through a new audited bridge action.

New `agent-org.js` export `assignRole(config, {agentId, role, reason, updatedBy, now})` — refuses unknown agent, refuses any change violating the single-controller invariant, bumps revision, round-trips `normalizeOrg` before returning (fail-closed).

New bridge action **`role-assign`**, two-step like `ledger-archive`: dry-run returns a preview receipt; confirm requires `expectedRevision` still matching (optimistic concurrency), writes atomically, returns a durable audit receipt.

Projection carries `roles: <lib ROLES>` — **the UI renders the picker from this list, never a hardcoded enum** (custom-roles readiness).

## 4.2 UI in the tree

Entry point: the node's rail board. Declared-role line becomes a Role register row with a `change` button (write-flag + bridge-reachable gated). Activating opens an inline reveal (no popup): flat role list with hue dots from a new shared `DECLARED_TO_VISUAL` map in `vocab.js` (fixing the existing computers.js/agent.js map mismatch), current role marked, disabled roles shown with their reason. Two-step confirm with real dry-run preview text (`Reassign: manager → reviewer · rev 17 → 18 · select again to confirm`). On confirm, node re-renders from the receipt's authoritative record — new hue, new label, tier-move glide if applicable.

**Out of scope, named so nobody conflates it:** relationship/edge editing is a separate future action; this task changes role only.

**Files:** MODIFY `agent-org.js`, `mission-bridge/actions.js`, `server.js`, `mission-control/src/mission-bridge.js`, `src/write-flags.js`, `src/vocab.js` (shared map), `src/views/computers.js`, `src/views/agent.js`, `tools/gen-agents.mjs` + schema.

## Done =

Round-trip test green; UI probe: picker lists exactly the projection's `roles` (proving no hardcode), two-step confirm carries real from/to/rev values, stale-revision path refuses correctly, node hue+row update without reload, flag-off/bridge-down state is read-only with reason stated.

---

# 5. Cross-cutting: landing order, and flags for whoever implements this

**Landing order (each independently revertable):**
1. **T2 stage R1** (activity CLI + projection + read-layer render + truncation fix) — highest owner-visible value ("nothing is more helpful than … what an agent is saying"), zero risk to shipped geometry.
2. **T1** (d3-hierarchy core swap, then agent.js migration, then graph.js retirement in its own commit).
3. **T3** (`agent-message` bridge action + composer), gated behind the brief-template prerequisite.
4. **T4** (role-assign), reuses T3's bridge muscle memory.

**Flags requiring explicit acknowledgment before build:**
1. **Physics removal now extends to the agent view.** HANDOFF §3 once protected physics; the page-2 planner verification already established supersession for page 2, and R1162 rev 591-593 (spoken against this exact view) is newer authority again. A planner cross-check against session history should confirm no later re-protection, as was done for page 2.
2. **T3's delivery promise depends on a coordinator-side brief-template + channel-map change.** The composer ships dark until it lands.
3. **`coordinator-assistant` hue change on the agent page** — deliberate coherence fix, visible.
4. `usage-attribution-query.js` exists on the `wt-r1162-*` integration worktrees, not yet in `toolsenabled-current\tools\` — the T2 lane should confirm landing state.
5. Stage R2 of T2 (bridge `console-tail`) is recommended but severable.
