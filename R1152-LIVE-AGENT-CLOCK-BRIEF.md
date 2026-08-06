# R1152 Phase 3 live-agent runtime clock

You are the bounded Sol manager for one UI defect blocking launch-gate step 3. The seated coordinator retains merge, visual acceptance, live-service, and owner-facing authority.

Dashboard launch record: `launch_j7uRp2OtiikI2MECY7NLLeSQ8G6dm2Xv` (informational; it grants no authority).

## Authority and observed defect

Shadow-manager verbatim finding: "on the live agent page for a genuinely running lane, no `h:mm:ss` string exists anywhere in the DOM" and "in `mission-control/src/views/agent.js` the uptime ring is built inside `if (!live) { ring = uptimeRing(...) }`. It is simulation-only. Live mode never constructs it."

Owner bar from `docs/coordinator/LAUNCH-READINESS-GATE.md`: the live roster must show the spawned lane with a real ticking clock derived from `bornAt`/`startedAt`. This task does not change a data source or fabricate telemetry.

Current territory authorization supersedes the historical manager README's mission-control read-only clause for only the exact worktree paths below: the designer is complete and visual territory has reverted to the coordinator under `agent-coord:coordinator/WORK-AUTHORIZED-live-data-lane-designer-complete`.

## One task

Make the existing uptime ring truthful in live agent-detail mode as well as simulation mode.

- Reuse the existing clock/ring rendering and binding machinery; do not create a second clock model.
- In live mode derive running elapsed time only from finite `bornAt`; when terminal, freeze only from a finite `stoppedAt`; when the source is absent, keep the existing honest unavailable state.
- Preserve simulation controls and behavior.
- Keep Pause and Respawn disabled and preserve the landed two-step real Terminate control exactly.
- Add the smallest focused deterministic regression test or probe that fails before the change and proves: live running time advances, live terminal time freezes, and missing epochs never fabricate a clock.

## Territory

May edit only `src/views/agent.js`, an existing directly related agent-view style file if strictly necessary, the smallest directly related focused test/probe, and `R1152-LIVE-AGENT-CLOCK-REPORT.md`. Do not edit generated data, bridge code, shell, package files, shared ToolsEnabled files, or any other surface. Do not touch `LLMBenchmarking`.

No browser, network, live-service mutation, process control, owner contact, Telegram, JARVIS, push, tag, or remote action. Do not spawn workers; this change is bounded enough for the manager itself.

## Verification and exit

1. Run the focused regression and report its exact assertion count and duration.
2. Run `node --check src/views/agent.js`.
3. Run `npm run test:data` and `npm run build`; report exact pass/module counts, durations, and exit codes.
4. Run `git diff --check` and list the exact changed files.
5. Commit the implementation and report on branch `coordinator/r1152-live-agent-clock`.

The report must use the manager contract sections: VERDICT, EVIDENCE, DECISIONS MADE ALONE, ESCALATIONS, DISSENTS-PRESERVED, GAPS. Visual own-eyes acceptance remains the coordinator/shadow's later duty; do not claim it.

Final console output must be only a concise `VERDICT:` line with commit id, changed-file count, focused assertion count, `test:data` count, build module count, and honest gaps.
