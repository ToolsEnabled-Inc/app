# R1152 truthful terminate UI report

## Outcome

Implemented the bounded terminate UI without changing projection generation,
provider configuration, unrelated pages, generated data, or launch-gate
evidence.

- The Mission Bridge client now routes `terminate` to
  `/v1/actions/terminate` with a measured 120,000 ms destructive-action
  budget.
- The live agent adapter retains the selected declared agent's exact
  schema-validated `controlTarget`. It does not derive a target from a route
  id, declared enabled state, or an observed session.
- The Controls panel now has four truthful items: declared state is non-action
  text, Pause and Respawn are visibly and accessibly unavailable, and
  Terminate is enabled only for a matching running target with exact ids and a
  positive integer PID.
- Terminate uses an explicit question/confirmation step. The first click posts
  nothing; confirmation creates one idempotency key and posts the exact fenced
  body once. Pending state is disabled and explicitly says that no stop is
  confirmed.
- Success requires the exact agent id, run id, PID, idempotency key, terminal
  status, integer exit code, `verifiedGone === true`, timestamps, and durable
  audit receipt fields. Incomplete or mismatched 2xx-shaped results fail
  closed. Uncertain retries reuse the same intent key; typed stale-target
  refusals remain visible and disable the stale control.
- View teardown removes the new listener and prevents a late result from
  mutating an abandoned view. Simulated mode is inert and cannot post.

## Changed files

1. `src/mission-bridge.js`
2. `src/views/agent.js`
3. `src/agent.css`
4. `tools/test/terminate-ui.test.mjs`
5. `R1152-TERMINATE-UI-REPORT.md`

## Deterministic verification

All commands ran from PowerShell in
`C:\Users\joshp\Desktop\wt-r1152-terminate-ui`.

| Command | Result | Count | Duration |
|---|---|---:|---:|
| `node --test tools/test/terminate-ui.test.mjs` | PASS | 8 passed, 0 failed | 66.8654 ms runner; 111 ms wall |
| `npm run test:data` | PASS | 56 passed, 0 failed | 2,286.0641 ms runner; 2,703 ms wall |
| `npm run build` | PASS | 729 modules transformed, 0 build errors | 6.03 s Vite; 6,886 ms wall |
| `git diff --check` | PASS | 0 whitespace errors | 26 ms wall |

Language-server diagnostics additionally reported 0 errors, 0 warnings, 0
information items, and 0 hints across `src/mission-bridge.js`,
`src/views/agent.js`, and `tools/test/terminate-ui.test.mjs` in a 29.6 s bounded
combined run.

The first build attempt, before local dependencies existed, failed in 381 ms
because `vite` was not installed. `npm ci --ignore-scripts` then installed 41
locked packages with 0 reported vulnerabilities in 3,795 ms; the recorded
production build above is the successful rerun.

## Deliberately open gaps

- Pause and Respawn still have no bridge actions and remain disabled by design.
- No live destructive terminate request was issued during verification. The
  deterministic controller probe exercises the exact request and receipt
  contract without killing a real agent.
- A definitive target refusal requires a projection refresh before another
  operator intent; the UI does not pretend its current projection changed.
- Vite still reports one existing bundle-size warning for a chunk over 500 kB;
  bundle decomposition is outside this bounded control change.
- Launch-gate evidence was not changed or evaluated, and this report makes no
  launch-gate claim.
