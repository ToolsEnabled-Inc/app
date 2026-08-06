# R1152 Phase 2 blocking spawned-label fix

You are `codex-manager-seat-1`, a Sol/xhigh manager reporting to
`coordinator-sol`. Work only in this isolated mission-control worktree and
finish this one bounded visual defect. Do not spawn workers; the change is too
small to benefit from fan-out.

Dashboard launch record: `launch_7w0XNQrDBjPa7VDmjhyLklXINkScvPsj`.

Authority and ground truth:

- Owner R1150: "spawned agents inside can actually function. it must be tested before raising to me."
- Phase 2 cannot close while the live tan fleet page has unreadable text.
- Shadow-manager evidence at `agent-coord` key
  `shadow/phase2-visual-evidence` found the seven bottom-tier grey nodes'
  repeated `AGENT SPAWNED` sublabels overlapping into a smear.
- The owner-approved visual baseline is mission-control commit `b24d8c1`, and
  the final designer pin is `ui-baseline/designer-final-20260806` at
  `e984815`. Preserve the live source, role-ranked tree, grey spawned pool,
  user-before-self cull ordering, and ticking runtime clocks.

Territory:

- MAY EDIT only the smallest necessary subset of `src/graph.js`,
  `src/graph.css`, `src/views/computers.js`, and one focused test under
  `tools/test/` if a browser-independent regression assertion is practical.
- MAY ADD your report at `R1152-PHASE2-LABEL-FIX-REPORT.md`.
- READ ONLY everywhere else. Never touch `public/data/**`, generators,
  schemas, live flags, bridge code, shell code, package manifests, shared
  authority files, credentials, services, scheduled tasks, or any artifact
  under `C:/Users/joshp/Desktop/ToolsEnabled`.
- Do not enumerate, read, or touch `LLMBenchmarking`.

Work:

1. Diagnose why the repeated bottom-tier role sublabels collide in the live
   page while higher-tier labels do not.
2. Implement the narrowest robust fix. Do not merely hide honest node identity
   or switch the view/data source. It is acceptable to suppress a redundant
   repeated role sublabel only if the node name and spawned-pool meaning remain
   unambiguous and accessible; otherwise lay the text out without overlap.
3. Preserve the Phase 2 telemetry contract: finite `bornAt` ticks while
   running and finite `stoppedAt` freezes finished runtimes; `origin`,
   `tasksDone`, and `failRate` consumption stays intact.
4. Add the smallest deterministic regression check available without browser
   automation. Do not chase Playwright/browser access in this lane. Run syntax,
   the focused test if added, `npm run test:data`, and `npm run build` from
   PowerShell. Record exact exit codes, counts, and durations.
5. Commit the implementation and report to this branch. Final console output
   must be one bounded line beginning `VERDICT:` with commit id, files changed,
   test counts, and honest gaps. Visual pass remains the shadow manager's gate;
   do not claim own-eyes success.

Report format: VERDICT, EVIDENCE, DECISIONS MADE ALONE, ESCALATIONS,
DISSENTS-PRESERVED, GAPS. Any false premise is an escalation and stops that
thread. No remote push and no live-service mutation.
