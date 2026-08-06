# Independent review — live agent render crash repair

Review commit `25f9c6b42092938c7c7a20b3cb9d0cc4ca0a10bc` against baseline `ae7b51ba9bf3cf9c23c057c9d8c9a50ecdb59150`. Read `R1152-AGENT-VIEW-CRASH-BRIEF.md` and `R1152-AGENT-VIEW-CRASH-REPORT.md` first.

Dashboard launch record: `launch_v1a3k9dNzl5gzpg4sioogC-7W9ctEv3e` (audit sequence 4125; `gpt-5.6-terra`, standard, 30 turns, 1,200,000 ms cap).

This is a read-only review of implementation files. You may create and commit only `R1152-AGENT-VIEW-CRASH-REVIEW.md`; do not modify source, tests, generated data, packages, or other reports. Do not drive a browser or contact the owner.

Verify independently:

1. The causal chain is actually closed: live `rail.replaceChildren()` is followed by a valid ring mount, and a missing/corrupt mount cannot throw out of `buildAgentView`.
2. The guarded failure does not leave a running updater, detached DOM leak, or cleanup regression.
3. Simulated/running/stopped/unavailable runtime semantics and truthful Terminate controls remain intact.
4. The focused test exercises behavior rather than merely blessing source text, and it would fail on baseline `ae7b51b` for the reported regression.
5. Territory is exact and no unrelated behavior was changed.

Run from PowerShell with command, exit code, count, and duration recorded:

- `node --test tools/test/live-agent-clock.test.mjs tools/test/terminate-ui.test.mjs`
- `npm run build`

Write a concise report with a clear `GO` or `NO-GO`, findings by severity, evidence, and honest gaps. Visual acceptance remains pending for the shadow manager and must not be called verified. Commit only the review report, then end with one line beginning `VERDICT:` and real numbers.
