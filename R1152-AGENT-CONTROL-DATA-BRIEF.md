# R1152 Phase 3 manager brief — exact observed control target

## Authority and problem

Owner R1150: *"in which spawned agents inside can actually function. it must
be tested before raising to me"*. Owner R1151: *"begin to use the program
yourself literally spawning agents inside the program"*.

The coordinator has landed an audited `/v1/actions/terminate` backend. It
requires `idempotencyKey`, `agentId`, `expectedRunId`, and `expectedPid`. That
fence is deliberate: an app may never kill by a stale agent label or arbitrary
PID.

Mission Control's live agent detail projection intentionally maps declared
agents only. It projects telemetry such as `bornAt`, but omits the exact current
presence run and says observed sessions are unmapped. Therefore the UI cannot
construct a safe Terminate request. Do not weaken the backend or invent a
mapping. Add the smallest fail-closed data contract for the current canonical
presence record whose `agentId` exactly equals the declared agent id.

This is coordinator delegation, not new owner input. Do not capture it as an
owner request and do not contact the owner.

## Required contract

- In `agents.json`, every declared agent gets `controlTarget`.
- `controlTarget` is `null` when no canonical normalized presence record exists
  for that exact declared id.
- Otherwise it is an additional-properties-false object containing only the
  exact bounded fields the UI needs to decide and fence a request:
  `agentId`, `runId`, `pid`, `status`, `recordRevision`, `startedAt`, and
  `lastHeartbeat`. `pid` may be null only where the canonical record permits it.
- Derive exclusively through the canonical `agent-presence` reader already
  used by the projection layer. Never read raw state ad hoc and never correlate
  opaque Codex/Claude session ids.
- Preserve truthful status; do not collapse `starting`, `running`, `finished`,
  `failed`, or `stale`. The later UI enables Terminate only for `running` plus
  a positive PID, but it needs honest disabled-state context for the others.
- Do not expose worktree, brief, console-log, launch-spec, checkpoint, prompt,
  task handle, verdict, mailbox, path, command, or other registry fields.
- Do not add this destructive-control target to the fleet graph contract in
  this lane. The coordinator's separate population decision is that the fleet
  page will eventually show declared structure plus visually distinct observed
  lanes; that work is not needed to build this exact agent-detail fence and is
  not authorized here.
- Update the strict `agents` schema and focused data tests. The schema must
  refuse an extra controlTarget field, malformed run id, nonpositive PID,
  unknown status, and wrong/nullability shapes.
- Add fixtures for: running record, starting/null PID, each terminal/stale
  status, missing record → null, undeclared registry record ignored, malformed
  registry fail-closed through the existing source envelope, and serialized
  output containing none of the forbidden registry fields.
- Regenerate only what the normal data contract requires. Do not rewrite other
  projections just because their timestamps changed. Record the exact command
  and changed generated files.

## Territory

May edit only in this isolated Mission Control worktree:

- `tools/gen-agents.mjs`
- `tools/gen-projection-lib.mjs`
- `public/data/schema/agents.schema.json`
- focused tests/fixtures for the agents projection
- `public/data/agents.json` and `dist/data/agents.json` only if normal verified
  generation requires those artifacts
- `R1152-AGENT-CONTROL-DATA-REPORT.md`

Read-only: `src/views/**`, `src/mission-bridge.js`, all CSS/shell/probe harness,
every ToolsEnabled source file, shared authority files, owner ledger/verbatim,
JARVIS, Telegram, coordinator assistant, retired tree, FRA-pinned files, and
LLMBenchmarking. No live process/task/service mutation, no remote push, no
owner contact.

Stop and report a false premise or authority ambiguity. Do not widen scope to
the concurrent-dispatch/one-agent-id issue; record it as a gap if relevant.

## Evidence and exit

1. Baseline `npm run test:data` with real exit/count/duration.
2. Focused schema/generator tests for every case above.
3. Post-change `npm run test:data`, production build if the normal contract
   requires it, and `git diff --check`.
4. True-base changed-file list and a committed report.
5. Final console output exactly one physical line beginning `VERDICT:`.

Do not claim the launch gate passed.
