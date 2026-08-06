# R1152 truthful terminate UI brief

## Source direction (verbatim)

> In run 4 I asked you to confirm whether the app's Pause/Respawn/Terminate
> controls were wired to real bridge actions. **I verified it myself. They are
> not.** This is now a stated fact with source evidence, not a suspicion.

> It moves an `armed` CSS class. That is all it does.

> A control that silently does nothing is a gap; a control that **falsely confirms** is a defect.

> until a real terminate action exists, the three buttons should be visibly disabled rather than armable. A disabled button tells the truth; an armed one does not.

> `tools/lane-run.js` for every dispatch; single-line prompt; brief in a file; resolved executable. Do not raise anything to the owner. Final message: a short VERDICT with real numbers.

## Ground truth already accepted

- The parent branch includes an exact, schema-validated `controlTarget` on each declared agent. It is either null or contains only `agentId`, `runId`, `pid`, `status`, `recordRevision`, `startedAt`, and `lastHeartbeat`.
- The ToolsEnabled bridge contract implemented by the coordinator is `POST /v1/actions/terminate`; it requires `idempotencyKey`, `agentId`, `expectedRunId`, and `expectedPid`, and returns audited typed refusals or a receipt proving the exact process is gone and the exact run is terminal.
- Pause and Respawn have no bridge actions. They must stay visibly disabled and must never arm.
- A declared agent being enabled is not proof of a running session. The UI must keep declared state distinct from observed control state.

## Bounded territory

Own only:

- `src/mission-bridge.js`
- `src/views/agent.js`
- `src/agent.css` when agent-view-specific disabled/pending/result styling is needed
- focused deterministic probe/test files for this control
- `R1152-TERMINATE-UI-REPORT.md`

Do not change the data generator/schema, ToolsEnabled, unrelated app pages, global design tokens, provider configuration, generated data, or the launch gate evidence. Do not alert the owner and do not claim the gate passed.

## Required behavior

1. Add `terminate` to `ACTION_ROUTES` and give it the measured destructive-action budget of 120 seconds.
2. Preserve the selected declared agent's exact `controlTarget` in the live view adapter. Never synthesize a target from an observed session, declared state, or URL id.
3. Remove the generic handler that toggles `.armed` on every control.
4. Render a truthful four-control row:
   - the first item describes declared state (`Enabled` or `Disabled`) and is not an action or runtime claim;
   - Pause is disabled and explicitly unavailable;
   - Respawn is disabled and explicitly unavailable;
   - Terminate is enabled only for an exact target with `status === 'running'`, a positive integer PID, and non-empty exact agent/run ids. Otherwise it is disabled with honest accessible explanatory text.
5. Terminate requires an explicit two-step confirmation. The confirmation state is a question, never success styling or the word "armed". Clicking once must not post.
6. On confirmation, create one fresh idempotency key for that operator intent, disable the control while pending, and call `postBridgeAction('terminate', { idempotencyKey, agentId, expectedRunId, expectedPid })`. Do not generate a replacement key for the same pending intent.
7. Show success only after validating the returned receipt against the exact requested agent id, run id, and pid, `verifiedGone === true`, and terminal status/exit evidence. A 2xx-shaped but incomplete/mismatched response is failure, not success.
8. Render typed bridge refusals and request failures honestly; restore a safe retryable state only when appropriate. Do not optimistically mutate the projection or imply the agent stopped.
9. Handle teardown safely: no result from an abandoned view may mutate a new view; timers/listeners introduced here must be cleaned up.
10. Keep simulated mode honest. It may display inert simulated controls, but it must not call the live bridge or falsely claim an observed runtime.

## Verification and report

- Add a focused deterministic test/probe covering: no generic armed handler; Pause/Respawn disabled; no-target Terminate disabled; one click posts nothing; confirmation posts the exact body once; pending is not success; mismatched/incomplete receipt is rejected; exact verified receipt is the only success; typed refusal is visible; simulated mode never posts.
- Run the focused test/probe, the existing applicable data/UI tests, `npm run build`, and `git diff --check`.
- Record exact commands, counts, durations, changed files, and deliberately open gaps in `R1152-TERMINATE-UI-REPORT.md`.
- Commit only owned files. End with one single-line `VERDICT:` containing real numbers and the commit hash.
