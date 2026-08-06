# R1152 Phase 3 agent control data report

Date: 2026-08-06

Branch: `coordinator/r1152-agent-control-data`

True base: `91ea2e893a84eb63db38f15908b89ad4cbf6054b` (`Brief exact observed agent control target`)

## Result

- Every declared row in the `agents` projection now has a required `controlTarget` property.
- The value is `null` unless the canonical normalized `agent-presence` registry contains a record at the exact declared id and that record's `agentId` exactly matches it.
- A non-null target contains only `agentId`, `runId`, `pid`, `status`, `recordRevision`, `startedAt`, and `lastHeartbeat`.
- The projection preserves all five canonical statuses: `starting`, `running`, `stale`, `finished`, and `failed`. It does not infer liveness or collapse terminal state.
- Presence still loads exclusively through `src/lib/agent-presence.js#normalizeRegistry`; malformed input leaves the optional projection available, marks the existing `agent-presence` source envelope `source-malformed`, and gives every declared row a null target.
- The fleet projection and fleet schema were not changed and do not contain `controlTarget`.
- No backend fence was weakened, no opaque Codex/Claude session id was correlated, and no ToolsEnabled source or live process/task/service was mutated.

## Strict contract and fixtures

`agents.schema.json` requires `controlTarget` on each declared agent. Its non-null object is `additionalProperties: false`, requires all seven fields, accepts only the canonical run-id pattern and status enum, requires positive integer revisions and non-negative epoch milliseconds, and accepts `pid: null` or a positive integer only.

Focused fixtures cover:

- a running record with a positive PID;
- a starting record with a null PID;
- exact `finished`, `failed`, and `stale` status preservation;
- missing declared-id presence producing null;
- an undeclared registry record being ignored;
- malformed registry input failing closed through the existing source envelope;
- exact target keys and absence of fixture values from worktree, brief, console log, launch spec, checkpoint, prompt, task handle, verdict, mailbox, path, command, and other registry-only fields;
- schema rejection of an extra target field, malformed run id, zero/negative/string PID, unknown status, missing/array target shapes, null non-nullable fields, and fractional revision.

## Generation

Exact command:

```text
node tools/gen-agents.mjs
```

The command wrote `public/data/agents.json` and `dist/data/agents.json`. The public file is tracked; `dist/` is intentionally ignored. After the production build, both files had identical SHA-256 `6dfe57bb34bc95630415f87c08d6890f055834201efb71c03c64669ec504c46b`.

The retained snapshot was generated at `2026-08-06T18:11:25.351Z`: 17 declared agents, 6 exact control targets, 11 null targets, and 1 `running` target with a positive PID. Every non-null target had exactly the seven allowed keys.

No other projection was regenerated.

## Verification

| Check | Exit and count | Duration |
| --- | --- | ---: |
| Baseline `npm run test:data` | exit 0; 30/30 tests passed, 25 top-level | 2.3925198 s Node / 2.760 s wrapper |
| Focused `node --test tools/test/agent-control-target.test.mjs` | exit 0; 18/18 tests passed, 3 top-level | 0.4994751 s Node |
| First post-change `npm run test:data` | exit 1; 47/48 passed | 0.980929 s Node / 1.427 s wrapper |
| Final post-change `npm run test:data` retry | exit 0; 48/48 tests passed, 28 top-level | 2.3367668 s Node / 2.719 s wrapper |
| Initial `npm run build` before dependency install | exit 1; Vite executable absent | 0.311 s wrapper |
| `npm ci` | exit 0; 41 packages installed, 0 vulnerabilities | 4.774 s wrapper |
| Final `npm run build` | exit 0; 729 modules transformed | 6.46 s Vite / 7.248 s wrapper |
| `git diff --check` | exit 0 | green |

The first post-change data run hit the pre-existing byte-idempotence test while the canonical presence writer advanced `state/agent-presence.json` between its two reads; the only difference was that source's `observedAt` mtime. The immediate complete retry passed without code or fixture changes. The production build retained Vite's existing non-blocking large-chunk advisory.

## True-base changed files

- `R1152-AGENT-CONTROL-DATA-REPORT.md`
- `public/data/agents.json`
- `public/data/schema/agents.schema.json`
- `tools/gen-agents.mjs`
- `tools/gen-projection-lib.mjs`
- `tools/test/agent-control-target.test.mjs`

The pre-existing untracked zero-byte `control-data-console.log` was preserved and excluded.

## Deliberately open gap

The canonical registry still represents one current presence record per agent id. The separate concurrent-dispatch/one-agent-id issue was not widened into this lane and remains unresolved.

The launch gate was not evaluated and is not claimed as passed.
