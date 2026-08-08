# Mission-control: real agent chat, mechanical hierarchy, role management — requirements

**Source:** owner live feedback (R1162, 2026-08-08, revisions 591-593), given directly against the page-2 tree redesign that just shipped, with reference screenshots. Captured verbatim in `reports/OWNER-REQUEST-LEDGER.json`. Relayed to the fable5-coordinator per the owner's explicit instruction ("relay to coordinator essentially helping it with your judgement"); this document is that relay, with the requesting session's own diagnosis attached so the coordinator isn't starting from raw screenshots.

## What the owner said, in order

1. *"ok page 2 overall look like the bubbles are nice the windows are nice but when i press an agent the window goes bad. Why cant we go online and maybe get something to help us. it really needs to be more mecanical and consistent and reliable and the lines need to not be so angled instead it needs to show the hiearchy maybe look online for a good tool to help you and then download it (relay to coordinator essentially helping it with your judgement. Those boxes are supposed to contain real conversations and such. Help wire up the site too along with youur assistant duties"*
2. *"also the right hand side where its projection register is supposed to be context window nothing is more helpful than this section of what an agent is syaing"*
3. *"all the boxes are context window and open to chatboxes same on the right its supposed to be able to be quickly easy to talk to specific agents and subagents and to manage roles and swap them in a tree"*

## Diagnosis (already done — verified against live source, not guessed)

**"The window goes bad" when clicking an agent** is TWO distinct real defects, both confirmed in source:

1. **`src/views/computers.js:653-683` (`showProjectionControls`)** — the side panel shown for a "declared" (non-live) node is a sparse metadata card (ID, provider, state, origin, runtime, task count) ending in a line like `chat, tuning, activity unavailable · not provided by fleet projection`. This is an honest empty-state, same pattern as the Sankey chart before its own fix — but the owner's screenshots show this text **visually truncated/cut off** inside its container (`chat, tuning, act...`, `Ru...`, `4 t...`) — a real CSS overflow bug in `.projection-unavailable`/`.rail-sub`, independent of the content question below.
2. **Clicking "Open full view" navigates to `#/agent/<id>/<id>`, which is `src/views/agent.js` + `src/graph.js`** — the pre-existing `FleetGraph` **d3-force physics view**, deliberately left untouched by the just-shipped page-2 redesign (its own brief explicitly scoped `graph.js` as out-of-bounds since `agent.js` depends on it). This is the "angled lines" the owner is looking at — it never got the tree-layout treatment page 2 just got. The owner is right that it's inconsistent: two different visual languages for what should be one coherent hierarchy view.

**"Those boxes are supposed to contain real conversations"** — confirmed, this is not a data-availability problem so much as a **wrong content model**, and where content does render, it's fake:

- `src/components.js:330` `buildChat()` — its own comment states the "seeded excerpt is the conversation's *past*" using a seeded `Math.random()` — **the chat content rendered anywhere in this app today is simulated, not real**, including in `agent.js:1251`'s existing chat mount.
- `src/views/comms.js` already exists (1836 lines) — a full "fleet discord" watch-board UI reading the **real** `agent-coord` durable-memory board (real channel keys: `directive/current`, `builder/status`, `help-request`, etc.) — but its own header comment says content is "a self-contained simulation." The scaffolding (chip components, `buildChat`, drag-split tiles) is well-built; the message content behind it is not real.
- **Real backend exists and is reachable.** `toolsenabled-current/src/lib/agent-comms/` (broker, fabric, history, delivery, transport-relay) is a genuinely operational messaging fabric, exposed as MCP tools `agent_comms.send` / `agent_comms.read` / `agent_comms.acknowledge` (`src/lib/tool-registry.js:1151-1166`, authenticated, transport-bound). Separately, every dispatched lane already has a real, growing console log at `logs/lane-consoles/<agentId>-<timestamp>.log` and a launch record at `state/agent-launch/<agentId>.json` declaring its role. **Real "what is this agent saying" data exists on disk today; nothing in mission-control reads it.**

## What the owner is actually asking for (synthesized from all three messages)

Not a chat *history viewer* — an **interactive chat surface**: every context box in the tree (and the right-hand panel) should be able to open into a real chatbox, scoped to that specific agent or subagent, for **quick two-way conversation** — and the same tree UI should support **managing and swapping roles** for nodes directly (reassign which role a subagent holds, from the tree, not a separate settings page).

This has two layers, and they should probably ship in that order:

1. **Read layer (lower risk, high value, ships first):** wire real data into the chat surface — a node's box, when opened, shows real recent activity for that agent (its actual console log tail, and/or its real `agent-coord`/`agent_comms` messages if it's a role that uses that channel), not a seeded fake transcript. This alone directly answers "nothing is more helpful than this section of what an agent is saying."
2. **Write layer (real feature, needs its own design pass):** an actual send capability — typing into a node's chatbox and having it reach that agent. For a **currently-running** agent, this plausibly routes through `agent_comms.send` (real, authenticated, already exists) as a message the agent can read via `agent_comms.read` at its next safe boundary. For a **role slot with no agent currently running**, "talking to it" more likely means: composing the next dispatch brief for that role, or queuing a message it'll read from its inbox on the next lane spawn — this needs an explicit design decision, not an assumption, since a codex lane is not a long-running chat partner the way a human expects "quickly easy to talk" to imply.

**Role management/swap in the tree** is a third, separable capability: from a node, reassign its declared role (matching `config/agent-org.json`'s `ROLES` enum, respecting the custom-roles work in progress), with the tree re-rendering the swap. This should reuse `config/agent-org.json` as the source of truth (already the authoritative role store per this whole program's practice), not invent a parallel one.

## Recommended layout-library adoption (owner: "look online for a good tool... download it")

Researched (2026-08-08): **`d3-hierarchy`** is the right pick, not `dagre` or `elkjs`. Reasoning: `d3-force` is already a direct dependency of `graph.js`, so `d3-hierarchy` is the same ecosystem/family (no new heavy dependency surface, consistent API conventions); it's purpose-built for exactly this shape of data (parent/child hierarchies with depth, ancestor/path methods) and offers both `d3.tree()` (clean tidy-tree, non-overlapping, minimal-angle links — directly addresses "not so angled, needs to show the hierarchy") and `d3.cluster()` (aligned-depth variant) layouts out of the box. `dagre` is oriented at general DAG/flowchart layout (more relevant if edges could cross tiers or cycle, which a strict org hierarchy shouldn't); `elkjs` is more powerful but flagged by the research itself as harder to support/maintain — overkill here. **Recommendation: replace both the hand-rolled `tree-layout.js` (page 2, already reasonably good but could simplify) and `graph.js`'s physics layout (agent detail view, the actual complaint) with a shared `d3-hierarchy`-based layout, so the whole app has one consistent, mechanical, reliable hierarchy renderer instead of two different systems (one hand-rolled deterministic tree, one physics simulation).**

## Scope boundaries for whoever picks this up

- This is real product work, not a quick fix — recommend the same quality process as page 2: a design spec pass (Fable 5) covering the unified `d3-hierarchy` layout replacing both `tree-layout.js` and `graph.js`'s physics, the real-data chat-box read layer, the write-capability design question (flagged above, needs an explicit owner-facing design decision on what "talk to a non-running role slot" means), and the role-swap UI — then implementation, following this program's own established pattern (spec → verification → build, own-run-verified, staged/reversible landings).
- **Do not regress what page 2 just shipped.** The static tree, edit-mode drag, drill-down, and DOM contracts (`data-agent-id`, `data-parent-id`, `window.__mcGraph`) are real, tested, shipped work (`R1162-PAGE2-IMPLEMENTATION-REPORT.md`) — a `d3-hierarchy` migration should preserve all of it, not restart from scratch.
- **Security posture applies.** Any write capability that reaches a real running agent process goes through the existing authenticated `agent_comms.send` path, never a new ad hoc channel — matches the settled `SECURITY-POSTURE-DOCTRINE.md` and the security synthesis's existing finding that `agent_comms` is honest-but-legacy-labeled (plaintext, shared-key) until SecureAgentChannel mediation lands; don't oversell what this write capability protects.

## Files

- `mission-control/src/views/computers.js:653-683` — the truncated declared-node panel
- `mission-control/src/views/agent.js`, `mission-control/src/graph.js` — the physics view to replace
- `mission-control/src/components.js:330` — `buildChat`, currently seeded/fake
- `mission-control/src/views/comms.js` — the real-channel-structure, fake-content watch board
- `toolsenabled-current/src/lib/agent-comms/` — the real backend to wire to
- `toolsenabled-current/src/lib/tool-registry.js:1151-1166` — `agent_comms.send`/`.read`/`.acknowledge` tool definitions
- `toolsenabled-current/config/agent-org.json` — role source of truth for the role-swap feature
