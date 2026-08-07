# R1162 Lane P — Research page data/report folding

**Branch:** `r1162/research-page-data`

**Date:** 2026-08-07

**Scope:** Mission Control data layer only; no research view or package-script edit.

## Verdict

`VERDICT: DONE generator + 7 safe entries + 7 flagged entries, report written`

The seventh Mission Control projection now uses the established v1 fail-closed
contract: `{schemaVersion, domain, generatedAt, ok, reason, sources, data}`.
`research` is registered in the shared domain list and the existing browser-side
projection reader, so it does not create a parallel data path.

## Delivered

- `tools/gen-research.mjs` reads the curated safe reports and emits metadata-only
  records for authorization-gated reports. Any missing, unreadable, or malformed
  required source makes the whole projection an explicit unavailable envelope.
- `public/data/schema/research.schema.json` defines all five Q105 surfaces:
  findings register, failure taxonomy, corpus catalog, open questions, and
  method notes.
- `public/data/research.json` is generated output, not hand-authored.
- `tools/test/research-generator.test.mjs` covers missing source, malformed
  source, byte idempotence, owner scoping, entry counts, and the metadata-only
  boundary for flagged content.
- `ownerScope: "local-owner"` is present at the projection-data level and on
  every corpus entry. The findings-record schema requires the same field, so
  later identity filtering does not require a schema migration.
- The findings register is intentionally empty. None of the bounded report
  reads supplied a complete finding with the design's required command, exit
  code, count, duration, commit evidence, and falsifier; seeding a weaker claim
  would have fabricated confidence.
- Failure taxonomy and open questions are typed `ok:false` observations with
  `reason: "source-out-of-scope"`. Their presence-registry, sweep, and task-store
  adapters remain follow-up data work. Method notes are populated from the Q105
  design discipline.

## Corpus classification

### Safe content entries

| id | source report |
|---|---|
| `toolsenabled-machine-b-status-2026-08-01` | `TOOLSENABLED-MACHINE-B-STATUS-REPORT-2026-08-01.md` |
| `toolsenabled-coordinator-audit-2026-08-04` | `ToolsEnabled-COORDINATOR-AUDIT-2026-08-04.md` |
| `toolsenabled-full-audit-2026-08-03` | `ToolsEnabled-FULL-AUDIT-2026-08-03.md` |
| `toolsenabled-issues-report-2026-08-04` | `ToolsEnabled-Issues-Report-2026-08-04.md` |
| `toolsenabled-plan-audit-2026-08-04` | `ToolsEnabled-PLAN-AUDIT-2026-08-04.md` |
| `toolsenabled-report-corpus-research-audit-2026-08-06` | `ToolsEnabled-Report-Corpus-Research-Audit-2026-08-06.md` |
| `mission-control-handoff-2026-08-07` | `HANDOFF.md` |

Each safe entry carries the generated title, absolute path, observed byte size,
file timestamp, a bounded factual summary, owner scope, and
`source: "desktop-report"`.

### Metadata-only authorization-gated entries

| id | source report |
|---|---|
| `ai-research-initiatives-full-corpus-audit-2026-08-06` | `AI-Research-Initiatives-Full-Corpus-Audit-2026-08-06.md` |
| `llmbenchmarking-current-iteration-report` | `LLMBenchmarking-current-iteration-report.md` |
| `cerberus-research-extension-report` | `Cerberus-research-extension-report.md` |
| `lean-bench-audit-markdown` | `LEAN-BENCH-AUDIT.md` |
| `lean-bench-audit-html` | `LEAN-BENCH-AUDIT.html` |
| `lean-bench-audit-pdf` | `LEAN-BENCH-AUDIT.pdf` |
| `toolsenabled-current-iteration-report` | `ToolsEnabled-current-iteration-report.md` |

These entries contain only configured title, path, byte size, file timestamp,
owner scope, `needsOwnerAuthorization: true`, and a one-line reason. The
generator's flagged-report path uses `statSync` only; it never opens or reads
those files. The LLMBenchmarking corpus directory was never listed, traversed,
or read.

## Needs owner decision

`currentWork86/ToolsEnabled-current-iteration-report.md` was named in the
initial safe list, but the required first-50-lines mechanical screen found the
term `LLMBenchmarking` on line 37. Following the stricter R198 rule, processing
stopped and the file was cataloged as metadata-only. The owner can explicitly
authorize content use in a later thread if this ToolsEnabled report should be
restored to the safe-content set.

No other classification was ambiguous.

## Evidence

| command | result | duration |
|---|---:|---:|
| `node tools/gen-research.mjs` | exit 0; `ok:true`; 14 sources | 119 ms |
| generated projection contract inspection | exit 0; 7 safe, 7 flagged, 0 findings, 14 sources | 91 ms |
| `node --test tools/test/research-generator.test.mjs` | 3 passed, 0 failed | 1,017 ms |
| `node --test tools/test/*.test.mjs` | 61 passed, 0 failed | 4,627 ms |
| `npm run build` | exit 0; 729 modules transformed | 13,940 ms |

The first build attempt found that dependencies were absent (`vite` was not on
PATH). `npm ci` completed with zero reported vulnerabilities, after which the
recorded build passed. The build emitted only Vite's pre-existing large-chunk
warning.

## Package-script proposal (not applied)

Replace the existing line with:

```json
"data:generate": "node tools/gen-fleet.mjs && node tools/gen-agents.mjs && node tools/gen-metrics.mjs && node tools/gen-ops.mjs && node tools/gen-ledger.mjs && node tools/gen-coordinator.mjs && node tools/gen-research.mjs"
```

## Follow-up work

1. Wire the presence registry, sweep, and task-store readers into failure
   taxonomy without turning unavailable observations into zeroes.
2. Derive open questions only from measured data gaps.
3. Seed findings only when complete reproducibility evidence and a falsifier
   are available.
4. Build the separate research-page UI lane against `fetchResearch`; no view was
   added or changed here.
