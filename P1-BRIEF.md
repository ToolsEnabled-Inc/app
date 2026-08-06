# M-P1 — Phase 1: the data contract (mission-control projection layer)

**You are:** `codex-manager-p1`, a **gpt-5.6-sol** (xhigh) manager under owner
directive **R1135** (2026-08-05, verbatim): *"you are coordinator. use codex
subagents only. assign 3 sol ultra maangers, each with 5 luna/teera\ max
workers available to them"*. The coordinator is the Claude Fable session
(b5345074); you report to it via your committed report, nothing else.

**Program authority:** owner directive R1134 — the program handoff at
`C:\Users\joshp\Desktop\toolsenabled-current\docs\coordinator\PROGRAM-HANDOFF-R1134.md`.
Read **Part I §1–§3, Phase 1, and Part III** of that file before anything else.
Your contract is
`C:\Users\joshp\Desktop\toolsenabled-current\docs\coordinator\managers\README.md`
(read it in full; its escalation boundary, anti-flattening rule, and report
format all bind you). Where that contract lists `mission-control` as read-only,
R1134/R1135 amend it FOR THIS LANE ONLY: the designer's work is complete and
handed off; this worktree of mission-control is your write territory.

## Mission

The dashboard at `C:\Users\joshp\Desktop\mission-control` is design-complete
and **entirely a simulation**. Phase 1 builds the real data layer under it.

The pattern already exists and is good — copy it, don't invent one:
`tools/gen-status.mjs` writes a read-only snapshot to `public/data/status.json`;
`src/live-status.js` fetches it and **never invents a number** — network
failure, missing file, or malformed payload all resolve to
`{ ok: false, reason }`, and callers branch on `ok`. Hold that line everywhere.
A dashboard that quietly shows a plausible zero is worse than one that says it
cannot see.

Generalize it into a projection layer covering every surface the UI has:

1. **fleet/computers** (the graph board)
2. **per-agent detail** (the agent drill-in)
3. **metrics panel**
4. **ops-channel board** (comms)
5. **R/Q ledger**
6. **coordinator thread** (home)

One generator per domain (`tools/gen-<domain>.mjs`), one **versioned schema**
each, validated on BOTH sides (generator refuses to emit an invalid payload;
reader refuses to consume one — resolving to `{ok:false, reason}`, never a
crash, never an invented value).

## Sources (all read-only, in the ToolsEnabled trees)

Canonical tree `C:\Users\joshp\Desktop\toolsenabled-current`:
- `reports/OWNER-REQUEST-LEDGER.json` (R/Q ledger; prefer `tools/ledger-query.js`)
- `BUILD-QUEUE.md` + package queue slices (prefer `src/lib/build-queue-slice.js`)
- `config/agent-org.json` (declared org; prefer `src/lib/agent-org.js`)
- service registry / config as found

Live-state tree `C:\Users\joshp\Desktop\ToolsEnabled` (the retired tree runs
every live service — **READ-ONLY, no exceptions**):
- `state/` (task/lease state, audit store, durable memory sqlite)
- prefer that tree's own reader libraries/CLIs run **from that tree** over
  hand-parsing its files; never open its sqlite for write, never take a lock a
  live service could be waiting on. If a source can only be read raciliy or by
  hand-parsing, emit `{ok:false, reason:"source-unreadable-safely"}` for that
  field and record it in GAPS — honest unavailable beats invented data.

Prefer existing reader functions and CLIs over hand-parsing everywhere.
`LLMBenchmarking` is off-limits (R198). No pushes to any remote. No
credentials in any file, message, or command line. Nothing leaves this machine.

## Territory

**May edit (this worktree only):** `tools/gen-*.mjs` (new, one per domain),
`src/live-status.js` (extend; keep its existing contract intact),
`public/data/**` (payloads + `schema/` files), new test files (use `node
--test`, e.g. `tools/test/*.test.mjs`), `P1-REPORT.md`.

**May NOT touch:** `styles.css`, `src/views/**`, `src/main.js`, `src/graph.js`,
`src/components.js`, `src/vocab.js`, `shell/**`, `index.html`, `package.json`
(propose any needed script additions as a diff in your report). Wiring the
views is Phase 2, a different lane, later. If you believe a view file must
change for Phase 1 to make sense, that is an ESCALATION, not an edit.

## Workers

You may spawn up to **5** workers total (R1135), tiered:
`codex exec --dangerously-bypass-approvals-and-sandbox -m gpt-5.6-terra -c model_reasoning_effort="high" -C C:\Users\joshp\Desktop\wt-p1-data "<task>"`
or `-m gpt-5.6-luna -c model_reasoning_effort="medium"` for lighter tasks.
A worker never spawns a tier above itself. Natural split: one worker per
domain generator; you design the shared schema/validation core yourself first
so the domains don't diverge. If nested `codex exec` fails in your
environment, do the work yourself at your own tier and say so in the report —
a silent tier change is a violation.

## Exit criteria (demonstrate with real numbers in your report)

- Every one of the six domains has a real, schema-versioned payload with an
  explicit unavailable-state, generated from the real sources.
- Generators are idempotent (run twice, diff — identical except honest
  timestamps), cheap enough for a timer (measure and report per-generator
  wall-clock), and covered by tests (`node --test` — report suite counts and
  duration).
- Deliberate failure cases proven: missing source file, malformed source,
  unreachable live-state → `{ok:false, reason}` end to end, never a throw,
  never a fabricated number. Show the actual outputs.

## Report

`P1-REPORT.md` at this worktree root, committed to `phase1/data-contract`
with your work. Sections per the contract: VERDICT / EVIDENCE (commands, real
exit codes, counts, durations, file:line) / DECISIONS MADE ALONE /
ESCALATIONS / DISSENTS-PRESERVED / GAPS. Commit with explicit paths (never
`git add -A`), essay-length message with the measured numbers,
`Co-Authored-By: codex-cli`. Your final console message = your VERDICT
section only.
