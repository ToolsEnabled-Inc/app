# P1 report — Mission Control data contract

## VERDICT

- **PASS:** Phase 1 now has six real, schema-versioned projections for fleet, agent detail, metrics, ops, R/Q ledger, and coordinator home/thread.
- Every generator validates before an atomic write; the browser reader independently fetches the same schema and returns `{ok:false, reason}` on network, JSON, schema, payload, or explicit-source failure.
- Real snapshots contain 1 observed computer, 13 declared agents/19 relations, 5 observed services, 449 R records, 68 Q records, 7 declared ops services, and 6 observed coordinator sessions.
- Missing source, malformed source, and unreachable live-state fixtures each emitted `data:null` and reached the reader unchanged as `ok:false`; no zero or empty fallback was fabricated.
- All six generators were byte-identical against fixed fixtures and identical on real sources after removing only honest `*At` timestamps.
- Timer cost is 110.232–186.026 ms per real dual-target run; snapshots refresh both `public/data` and an already-built `dist/data`, matching the established status-generator behavior.
- Final verification passed: 17/17 Node tests, production build (725 modules), 10 syntax/diff checks, and 18/18 route/theme smoke cases.
- Audit, durable memory, live ops messages, and coordinator-thread contents remain explicitly `source-unreadable-safely`; no live SQLite file was opened or locked.
- The preferred strict queue-slice reader rejects the current canonical queue; the projection uses the existing corpus + phase readers instead and preserves that verified source conflict below.
- No view, simulation, owner-ledger, shared package/config, live service, scheduled task, remote, or FRA-pinned file was changed; Phase 2 can wire these contracts without undoing simulation yet.

## EVIDENCE

### Contract and implementation

- `tools/gen-projection-lib.mjs:164` runs bounded existing JSON CLIs without a shell; `:233` rejects unrecognized/invalid schema contracts; `:265` validates before writing; `:282` is the common fail-closed emitter.
- `tools/gen-fleet.mjs:125`, `tools/gen-agents.mjs:51`, `tools/gen-metrics.mjs:130`, `tools/gen-ops.mjs:124`, `tools/gen-ledger.mjs:153`, and `tools/gen-coordinator.mjs:20` are the six domain entry points.
- `src/live-status.js:47` implements schema-first `fetchProjection`; `:91-96` exposes one reader per domain while the original `fetchStatus` contract remains intact.
- Public schema anchors are `public/data/schema/fleet.schema.json:7`, `agents.schema.json:6`, `metrics.schema.json:3`, `ops.schema.json:3`, `ledger.schema.json:3`, and `coordinator.schema.json:3`.
- Failure/idempotence fixtures are at `tools/test/generator-failures.test.mjs:85`, `:118`, and `:151`; browser acceptance for all six real payloads is `tools/test/projection-contract.test.mjs:129`.
- Before edits, `TOP_LEVEL_FILES` was checked in canonical `src/lib/fra-runtime-integrity.js:46-83`; none of the Phase 1 paths is FRA-pinned.

### Real generation

Command (exit 0):

```text
node tools/gen-fleet.mjs; node tools/gen-agents.mjs; node tools/gen-metrics.mjs;
node tools/gen-ops.mjs; node tools/gen-ledger.mjs; node tools/gen-coordinator.mjs
```

The measured checked-in payloads reported:

| Domain | Real values projected | Explicit unavailable state |
| --- | --- | --- |
| fleet | 1 computer; 3 active sessions; 5 services; 13 graph nodes; 19 edges | stale/unknown/conflict service states remain named, never collapsed to zero |
| agents | 13 declared agents; 19 relations; 14 observed session records | observed sessions become an unavailable observation if preflight fails |
| metrics | sessions 8 Codex/6 Claude; services 5 total/1 stale; requests 449 total/399 open; queue 68 total (22 blocked, 21 done, 16 open, 9 in progress) | dead fleet supervisor, audit, and memory are unavailable with reasons |
| ops | 7 declared services; 5 observed channels; MCP 4 live/1 dead | messages are `source-unreadable-safely` |
| ledger | 449 R rows; 68 Q rows | Q rows become a nested unavailable observation if queue readers fail |
| coordinator | controller `claude`; 6 observed sessions | thread is `source-unreadable-safely` |

The R projection contains only `id`, `status`, `gateCount`, and `unmetGateCount`; no owner verbatim is copied. Agent-preflight intent/name text is likewise excluded.

### Failure behavior, end to end

The deliberate fixture probe exited 0 and printed the actual generator and reader results:

```json
{"case":"missing-source","generator":{"ok":false,"reason":"source-missing","data":null},"reader":{"ok":false,"reason":"source-missing"}}
{"case":"malformed-source","generator":{"ok":false,"reason":"source-malformed","data":null},"reader":{"ok":false,"reason":"source-malformed"}}
{"case":"unreachable-live","generator":{"ok":false,"reason":"source-unreachable","data":null},"reader":{"ok":false,"reason":"source-unreachable"}}
```

The suite also changed the coordinator schema fixture so a normal payload was invalid. The generator exited nonzero and left no output file, proving the generator refuses invalid emission rather than writing a best-effort payload.

### Tests and gates

- `node --test tools/test/*.test.mjs` — exit 0; 17 tests passed, 0 failed, 0 skipped; final duration 2335.0652 ms. Coverage includes six schemas, six real browser reads, legacy `fetchStatus`, missing/malformed/network failure, schema rejection, and six-generator fixture idempotence.
- Ten `node --check` invocations plus `git diff --check` — exit 0. The only message was Git's pre-existing LF→CRLF worktree warning for `src/live-status.js`.
- `npm run build` — exit 0; 725 modules transformed in 5.67 s. The pre-existing >500 kB chunk warning remains a gap, not a Phase 1 regression.
- `node .mc-smoke.mjs` from the read-only live ToolsEnabled tree — exit 0 in 59.2 s; `SMOKE PASS: 18 route/theme combinations, 0 errors` and 0 truncations at 1440/1600/1920.
- Initial `npm run build` exited 1 because this fresh worktree had no local Vite install; `npm ci` exited 0 (41 packages, 0 vulnerabilities), after which both baseline and final builds exited 0.

### Timer cost and idempotence

One real run per generator, including both `public/data` and `dist/data`, measured:

| Generator | Wall-clock |
| --- | ---: |
| fleet | 160.756 ms |
| agents | 186.026 ms |
| metrics | 175.813 ms |
| ops | 162.752 ms |
| ledger | 110.232 ms |
| coordinator | 155.230 ms |

A separate real two-run probe exited 0 for all six and reported `idempotentExceptTimestamps:true` for every domain. Its two sample ranges were 113.736–245.873 ms, and payload byte sizes were stable: fleet 7,193; agents 8,582; metrics 2,322; ops 4,295; ledger 71,001; coordinator 2,223.

### Worker verification

Five bounded `gpt-5.6-terra`/high Codex workers were used, one non-overlapping generator lane each (fleet, agents, metrics, ops, ledger); the manager built the shared core, coordinator generator, reader, tests, schemas, and performed all final verification. No worker spawned another worker, no worker committed, and no tier was silently changed.

## DECISIONS MADE ALONE

- Made the public JSON schema the single domain contract and implemented the same bounded JSON-Schema subset in Node and browser runtimes, avoiding a forbidden `package.json` dependency change.
- Standardized every payload as a v1 envelope with `ok`, `reason`, `sources`, and `data`; a whole-surface failure uses `data:null`, while independently unavailable sub-surfaces use `{ok:false, reason, observedAt, value:null}`.
- Kept declared org state and observed session/service state separate; neither is presented as the other.
- Projected privacy-minimized metadata only: no owner prose, agent intent text, credentials, token-key metadata, machine role/address assertion, or raw live-state record enters browser data.
- Used only the live tree's existing `agent-preflight --json` CLI. Audit/memory providers were not required because their current state-store path can initialize/migrate SQLite and violate the no-lock brief.
- Used `build-queue-corpus.readQueueCorpus` plus `build-queue-projection.parseQueuePhases` independently on the root and slices, with slice records winning duplicate Q ids.
- Matched established `gen-status` timer semantics by atomically refreshing `public/data` and `dist/data` on real runs; `MC_OUTPUT_ROOT` keeps tests single-target and isolated.
- Did not wire any view. Phase 1 supplies readers and payloads only; simulation removal remains Phase 2 territory.

## ESCALATIONS

1. **Boundary rule 5 — false premise/source conflict:** the preferred `src/lib/build-queue-slice.js` reader is not usable against the current canonical `BUILD-QUEUE.md`. The verified call exited 1 with `QUEUE_SLICE_INSTRUCTION_MALFORMED: Verbatim instruction payload does not end at its declared byte boundary.` I stopped that reader thread, did not edit shared queue authority, and used the existing corpus/projection readers, which produced 68 validated Q rows.
2. **Boundary rule 5 — false live metadata:** live-tree `node tools/agent-preflight.js --json` still describes Machine B as canonical and Machine A as retired, conflicting with R1134's one-machine state and current canonical orientation. The projection deliberately omits preflight machine role/address and uses only the observed local letter, services, MCP, and session facts. The coordinator should repair that metadata in its owning repo/lane, not in this worktree.
3. **Boundary rule 6 / shared-authority territory — `package.json`:** convenience scripts are useful but forbidden in this lane. Proposed coordinator-serial diff (not applied):

```diff
 "scripts": {
+  "data:generate": "node tools/gen-fleet.mjs && node tools/gen-agents.mjs && node tools/gen-metrics.mjs && node tools/gen-ops.mjs && node tools/gen-ledger.mjs && node tools/gen-coordinator.mjs",
+  "test:data": "node --test tools/test",
   "dev": "vite --port 4600 --strictPort",
```

No live timer was registered: doing so would trip boundary rule 3 (scheduled-task/live-service mutation), and Phase 1 only required measured timer suitability.

## DISSENTS-PRESERVED

No worker dissented. All five worker lanes reported no disagreement with the fail-closed contract. The queue-reader incompatibility and safe-unavailable SQLite judgment were reported by workers as gaps and are preserved above rather than flattened into success.

## GAPS

- Audit metrics, durable memory metrics, ops messages, and coordinator-thread messages are unavailable because this session had no callable already-running safe reader for them. Starting another MCP process or importing the live providers would open a store whose current constructor can initialize/migrate or request SQLite locks. Payloads say `source-unreadable-safely`; they do not say the services are down.
- The observed fleet supervisor was dead at generation time, so its last idle/parked/running counts were rejected as stale and emitted unavailable rather than displayed.
- The preflight-derived agent session list is observable but does not safely map opaque live session ids to declared org agent ids; the projection keeps the two lists separate.
- No view consumes these files yet and simulations remain untouched by design; that is Phase 2, not evidence that Phase 1 is running in the UI.
- No scheduler was installed. Real dual-target generator cost is below 187 ms each, so the coordinator can schedule the composed command after shared-authority review.
- Production build still warns that the main JS chunk exceeds 500 kB; Phase 1 neither caused nor addressed that pre-existing packaging issue.
