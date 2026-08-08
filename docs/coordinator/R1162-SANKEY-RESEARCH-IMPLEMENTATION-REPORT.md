# R1162 Sankey / research implementation report

**VERDICT: PARTIAL — implementation complete; rendered three-theme browser verification unavailable in this session.**

## Scope guard

This lane implemented TASK 2 and TASK 3 only. It did not modify `src/views/computers.js`, `src/graph.js`, `src/tree-layout.js`, or `src/tree-graph.js`. The final protected-path check was:

```powershell
git diff --quiet HEAD -- src/views/computers.js src/graph.js src/tree-layout.js src/tree-graph.js
```

Result: exit `0` (no changes).

## TASK 2 — Sankey / metrics

### Real-data option (a): not implemented, because the required attribution does not exist

The checked generator currently reads the live preflight, canonical request ledger summary, and canonical build-queue summary. None carries a token-routing observation.

The closest existing safe usage surface preserves provider totals and some account/lane totals, but it cannot conserve a pool → provider → agent-role flow:

- the durable meter contract records `provider`, `accountAlias`, `lane`, and `requestClass`, but no agent role;
- local Codex/Claude session usage is intentionally aggregated by provider before it reaches the browser-safe projection;
- the browser-safe provider and account-lane totals are separate aggregates, not a joinable per-operation routing record.

Assigning those totals to Coordinator / Helper / Shadow Manager / Manager / Default would therefore be invented routing. `tools/gen-metrics.mjs` was left honest and unchanged.

### Implemented option (b)

The live Sankey host now keeps its full 430 px hero slot and renders a deliberate brace-framed empty state instead of a bare text node. It contains one clear reason: the live projection does not attribute measured usage across pools, providers, and agent roles.

The panel includes an explicit **View simulated** button. That button calls the existing source flag API (`setLiveView('metrics', false)`), so simulation appears only after an owner action and never under a live label.

Metrics otherwise remains the same page and data path. Changes are limited to the Sankey unavailable branch in `src/views/metrics.js` and its scoped styles in `src/metrics.css`.

## TASK 3 — independent research page

The worktree was cut from `main` before the already-built research data lane landed. I imported the exact prepared prerequisite commit `10675e9` (`r1162/research-page-data`) without redesigning that backend. This supplied the existing generator, schema, checked-in projection, `fetchResearch`, and generator tests described by the brief.

Implemented:

- new `src/views/research.js` and `src/research.css`;
- `research` added to the ring after metrics and before comms;
- direct `#/research` parsing, `makeView`, and breadcrumb cases;
- catalog rows with title, observed date, byte size, and brace-framed curated summary in the grey context register;
- a separate authorization-gated render branch that reads and renders only `title` and `authorizationReason`;
- Method notes with the seven current guidance entries;
- Findings register observed-empty copy (never a numeric zero);
- Failure taxonomy and Open questions unavailable states with the real `source-out-of-scope` reason;
- standard whole-envelope unavailable handling;
- square, unboxed, hairline-driven styling using only shared theme tokens.

Actual checked-in `public/data/research.json` content verified:

- 14 catalog rows total;
- 7 safe rows;
- 7 `needsOwnerAuthorization: true` rows;
- 7 method notes;
- Findings register: available empty array;
- Failure taxonomy: unavailable, `source-out-of-scope`;
- Open questions: unavailable, `source-out-of-scope`.

Every current locked JSON entry was also checked to confirm it has no `summary` property. The UI contract test additionally verifies that the locked render function does not read `summary`, `path`, `bytes`, `dateObserved`, `source`, or `id`.

## Verification

### Dependency/setup observations

- The first `npm run build` could not find Vite because this fresh worktree had no `node_modules`.
- `npm ci` completed: 41 packages installed. npm reported one high-severity dependency advisory; no audit fix was run because that would be an unrelated dependency mutation.
- A preliminary `npm test -- --test-name-pattern ...` did not run because this package has no `test` script. The repository-defined suite is `test:data`, used below.

### Focused tests

```powershell
node --test tools/test/research-generator.test.mjs
```

Result: 3/3 passed, including missing/malformed source handling, byte idempotence, and metadata-only flagged content.

```powershell
node --test tools/test/research-view.test.mjs
```

Result: 5/5 passed. Contracts cover independent routing, locked-row field isolation, unavailable-vs-observed-empty behavior, white/tan/black theme-token use, the 430 px Sankey slot, and the explicit simulation switch.

### Existing repository suite

```powershell
npm run test:data
```

Final result: **66 tests passed, 0 failed, 0 skipped** in 3,233 ms wall-clock (Node reported 2,773 ms test duration).

### Production build

```powershell
npm run build
```

Result: success; 731 modules transformed in 6,456 ms wall-clock (Vite reported 5.88 s). Vite retained the existing warning that the main minified chunk exceeds 500 kB.

### Direct local-server probe

Vite port 4600 was already occupied, so the worktree was served on port 4612. `Invoke-WebRequest` checks returned HTTP 200 for:

- `/#/metrics`
- `/#/research`
- `/src/main.js`
- `/src/views/metrics.js`
- `/src/views/research.js`
- `/data/metrics.json`
- `/data/research.json`

The same probe parsed the served research payload and confirmed `safe=7`, `locked=7`, `methods=7`, no locked-row summary fields, Findings `ok=true` with an empty array, and both unavailable registers with `source-out-of-scope`.

### Theme and rendered UI verification

The theme contract passed for white, tan, and black: the research stylesheet contains no literal hex/RGB/HSL colours and uses the shared ink, line, brace, and typography tokens defined by all three themes.

Rendered screenshot/interaction verification could not be run. The required in-app Browser workflow initialized, but browser discovery returned an empty backend list (`[]`). Per that workflow's safety rule, I did not substitute an unrelated browser driver. Consequently, the direct rendered checks of arrow-click navigation, the View simulated click, and visual appearance in all three themes remain the only incomplete verification item.

## Open issues

1. A real live Sankey still requires upstream instrumentation that preserves a measured per-operation mapping from account pool through provider to agent role. Provider totals alone are insufficient.
2. Rendered browser QA remains outstanding because no browser backend was available to this session.
3. Baseline tooling notices remain: npm reports one high-severity dependency advisory, and Vite reports a >500 kB minified chunk. Neither was introduced or changed in this lane.

