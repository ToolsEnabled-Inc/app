# Page 2: subagent-thread collapse + split-view drilldown — requirements addendum

**Source:** owner live feedback (R1162, 2026-08-08), a follow-on idea after seeing the just-shipped page-2 tree. Addendum to `docs/coordinator/R1162-AGENT-CHAT-TREE-DESIGN-SPEC.md` (Task 1's d3-hierarchy layout) — not a replacement, an additional interaction on top of it.

## What the owner said, verbatim

*"ok i figured out an upgrade for pg 2. Let the subagents of any single agent thread be hidden with a small + icon on the lower right of that agent. Pressing the + expands all sub agents, and splits the view into 2 pieces, the main view becomes the subagent tree with all of its roles and then the layover/small view is like a map that shows the regular tree but like a small layover"*

## Interpretation (design-input, not a final spec — whoever picks this up should confirm with a design pass, not implement blind)

1. **Collapse indicator**: any agent node that has spawned its own subagents (a real thread of dispatched work — e.g., a manager that spawned workers, a coordinator that spawned lanes) shows a small `+` badge in its lower-right corner when those subagents are currently hidden/collapsed. This is a *different* relationship than the existing org-chart parent/child edges already rendered in the tree — it's specifically about an agent's own dispatched subagent thread (matching the real `dispatcher`/`reportsTo` data already in `state/agent-launch/*.json` and `config/agent-org.json`, not just visual tree position).
2. **Expand interaction**: clicking the `+` triggers a view split, not an inline expand:
   - **Main view** (the larger pane) switches to show the *subagent tree* rooted at that agent — that agent and all of its spawned subagents, with their roles visible, laid out with the same mechanical tree renderer as the rest of page 2 (reuse Task 1's `d3-hierarchy` work, don't build a second layout system).
   - **Overlay/minimap** (a small, fixed-position secondary view, likely a corner) keeps showing the *regular* full tree for orientation — literally a minimap pattern, common in map/graph UIs: small, non-interactive or lightly-interactive, oriented the same way, showing where the current focus sits within the whole.
3. **Closing/returning**: needs a defined interaction (not specified by the owner — recommend closing the split returns to the regular full tree, consistent with the existing breadcrumb/drill-down-back pattern from Task 1's spec).

## Real data this needs

Confirm before designing: does `state/agent-launch/*.json`'s `dispatcher` field (and/or `agent-coord`'s launch records) already capture "which agent dispatched which subagent" cleanly enough to build a real subagent-thread tree, or does this require new instrumentation? This is a real, answerable question — check it, don't assume either way. The provisioning-requirements work already done for the agent-comms buildout (`R1162-AGENTCOMMS-PROVISIONING-REQUIREMENTS.md`) may have adjacent findings about identity/dispatch relationships worth checking first.

## Scope relationship to Task 1

This is layered on top of the already-specified d3-hierarchy renderer, not a competing design. The `+` badge is a new per-node UI element; the split-view is a new interaction mode; both should reuse the existing tree renderer for both panes (main subagent-tree view and the minimap), just at different scales/interactivity levels, rather than building two separate rendering systems.

## Process note

This came in as a follow-on idea, not urgent/blocking anything currently in flight (the agent-comms buildout work). Relayed to the coordinator to fold into the existing mission-control chat-tree design/implementation track at whatever point makes sense — not requesting a context-switch away from current priority work.
