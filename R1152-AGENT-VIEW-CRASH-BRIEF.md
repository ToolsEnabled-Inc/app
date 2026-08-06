# R1152 live-agent render crash — bounded repair brief

You are the sole builder for this urgent regression. Work only in this worktree. Read the canonical continuation brief at `C:\Users\joshp\Desktop\toolsenabled-current\docs\coordinator\COORDINATOR-RUN7-BRIEF.md` before editing; treat it as read-only authority.

Dashboard launch record: `launch_Pu7-5nthWJXI-SwiQs1MpPBiaKsmixmT` (audit sequence 3981; `gpt-5.6-sol`, premium, 40 turns, 1,800,000 ms cap).

## Objective

Repair the live agent page so a genuinely running agent cannot crash the whole view when the runtime ring is mounted. The observed failure is:

> Agent projection unavailable — Cannot read properties of null (reading 'appendChild')

At baseline `ae7b51b`, `src/views/agent.js` declares `.agent-ring-wrap` inside `.ctl-panel > .rail-scroll`, live mode destroys it with `rail.replaceChildren()`, and the later runtime-ring append dereferences the now-missing node. This regression removed the Terminate control from the only moment it is needed.

## Territory

May edit only:

- `src/views/agent.js`
- `tools/test/live-agent-clock.test.mjs`
- `R1152-AGENT-VIEW-CRASH-REPORT.md`

The brief itself is coordinator-owned and already committed. Do not edit styles, generated data, package files, other tests, or anything outside this worktree. Do not drive a browser or contact the owner.

## Required behavior

1. Live-mode rail replacement must leave or recreate a valid `.agent-ring-wrap` owned by the live control panel before a runtime ring is mounted.
2. A missing/corrupt ring mount must not throw out of `buildAgentView`; one bad append may cost the runtime-ring panel, never the entire agent view or Terminate controls.
3. Simulated mode, running live clocks, stopped live clocks, and `RUNTIME UNAVAILABLE` semantics must remain unchanged.
4. Add a focused executable regression test that exercises the mount behavior; do not rely only on source-regex assertions. No new dependency.
5. Preserve the existing truthful Terminate flow. Do not broaden this task into the launch gate or any other open item.

## Verification and report

Run from PowerShell and record command, exit code, test count, and duration for:

- `node --test tools/test/live-agent-clock.test.mjs`
- `npm run test:data`
- `npm run build`

Demonstrate that the new focused regression fails against the baseline behavior or otherwise explain mechanically why it would have caught the exact null-append path. Write `R1152-AGENT-VIEW-CRASH-REPORT.md` with the changed-file list, causal fix, evidence, and any honest gaps. Visual acceptance remains pending for the shadow manager; do not label it verified.

Commit only the permitted files on this branch. End your response with one line beginning `VERDICT:` that includes the commit id and real test/build numbers.
