# R1152 Phase 2 data projection report

Date: 2026-08-06

Branch: `coordinator/r1152-phase2-data`

Launch record: `launch_vVD3kvnjvmOtFggmb8yXTfg80b4lbJyI` (HTTP 201, signed audit sequence 1047)

## Bounded implementation

- Both generators now load `state/agent-presence.json` and normalize it only through `src/lib/agent-presence.js#normalizeRegistry`.
- Matching declared agents receive exact optional `bornAt` and `origin` values. Declared `enabled` is passed through unchanged.
- Resolvable presence `reportsTo -> agentId` records add observed `delegates_to` relationships. Every relationship carries `sourceKind`; same-endpoint/same-type duplicates retain declared provenance.
- Terminal `codex-agent-lane` task telemetry is read only through `StateStore.listTasks` and `StateStore.getTask`. Reads are bounded to 200 rows for each of `succeeded`, `failed`, `uncertain`, and `cancelled`; a saturated bound or malformed attribution omits all task telemetry.
- Task attribution inspects only the bounded generic `payload.context` string long enough to recover a validated `agentId`. Projections retain no task payload, objective, result, error, checkpoint, task id, or claim-token material.
- Both public schemas accept the four optional agent fields and require declared/observed provenance on relationships.

## Focused fixture coverage

The Phase 2 fixture suite covers:

- exact registry epoch and `user | self` origin projection in both generators;
- omission for unresolved and malformed registry values;
- observed-edge endpoint resolution, provenance, and declared-first deduplication;
- succeeded/failed/uncertain/cancelled aggregation and one-decimal failure rate;
- a cancelled-only zero denominator (`tasksDone` present, `failRate` omitted);
- malformed task attribution and saturated 200-row reads failing closed;
- secret-shaped payload/result/error/claim-token fixture values remaining absent from output.

## Real canonical snapshot inspection

Final retained snapshots were generated at `2026-08-06T11:26:08.198Z` (fleet) and `2026-08-06T11:26:08.409Z` (agents). All six fleet sources reported available.

| Measure | Exact result |
| --- | ---: |
| Graph nodes | 17 |
| Declared edges | 26 |
| Observed edges | 2 |
| Nodes with `bornAt` | 2 |
| `origin: user` nodes | 0 |
| `origin: self` nodes | 2 |
| Nodes with omitted origin | 15 |
| Nodes with complete `tasksDone` telemetry | 17 |
| Attributed terminal tasks on graph nodes | 2 |
| Succeeded | 2 |
| Failed | 0 |
| Uncertain | 0 |
| Cancelled | 0 |

The two observed edges are `coordinator-sol -> codex-manager-seat-1` and `coordinator-sol -> codex-manager-seat-2`, both `delegates_to` with observed provenance.

Exact live-node values:

- `codex-manager-seat-1`: `bornAt=1786014109414`, `origin=self`, `tasksDone=2`, `failRate=0`.
- `codex-manager-seat-2`: `bornAt=1786014898747`, `origin=self`, `tasksDone=0`; `failRate` is honestly omitted because its non-cancelled denominator is zero.

Fleet-node and agent-detail optional fields match for all 17 declared agents. The canonical task aggregate contained no attributed agent id outside the declared graph.

## Verification

| Check | Result | Elapsed |
| --- | --- | ---: |
| `npm run test:data` | 29 passed, 0 failed (24 top-level tests including 5 nested cases) | 2.858 s wrapper / 2.417 s Node test duration |
| `npm run data:generate` | 6/6 domains generated successfully | 1.366 s |
| `npm run build` | 729 modules transformed; build green | 6.680 s wrapper / 5.97 s Vite build |
| `git diff --check` | green | 0.2 s |
| Focused secret scan | 2 files scanned; 0 secret-pattern hits; 0 raw payload/result/error/claim-token keys | green |

The four out-of-territory generated snapshots were restored after the required real generation; only `fleet.json` and `agents.json` are retained. The build emitted Vite's existing non-blocking large-chunk advisory.

## Coordinator follow-up

The real registry currently contains no `origin:user` graph node, so the data projection truthfully reports zero rather than fabricating owner-origin data. Consumer edits, tan own-eyes verification, origin-priority visual proof, stopped-clock proof, merge review, and the Phase 2 verdict remain with the coordinator as assigned.
