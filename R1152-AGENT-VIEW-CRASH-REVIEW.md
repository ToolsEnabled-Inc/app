# R1152 independent review — live agent render crash repair

## GO

Reviewed `25f9c6b42092938c7c7a20b3cb9d0cc4ca0a10bc` against
`ae7b51ba9bf3cf9c23c057c9d8c9a50ecdb59150` (launch record
`launch_v1a3k9dNzl5gzpg4sioogC-7W9ctEv3e`, audit sequence 4125).

## Findings by severity

- Critical: none.
- High: none.
- Medium: none.
- Low: none.
- Informational: the focused regression uses fake DOM-like append targets and
  source wiring assertions rather than constructing the complete browser view.
  It nevertheless executes the append behavior, including null and throwing
  mounts, and binds that helper to both production append sites.

## Evidence

- Baseline clears `.rail-scroll`, which destroys the original
  `.agent-ring-wrap`, then directly appends to a fresh query result. The
  resulting null dereference is the reported crash path.
- The repair keeps a `runtimeRingMount` reference, recreates and appends it
  after the live rail rebuild, then guards both that append and the runtime
  ring append. A failed ring append sets `ring = null`; therefore the existing
  animation loop cannot call `ring.update()`. `uptimeRing` owns no independent
  updater, and the view's existing `destroy()` still cancels its rAF and
  disconnects observers. The failed detached ring has no retained reference.
- Running live agents retain ring updates; stopped live agents still render a
  frozen ring; unavailable telemetry produces no live ring; simulation keeps
  its existing ring path. The combined tests preserve the truthful Terminate
  availability, confirmation, receipt, stale-target, and simulated-mode
  behavior.
- The focused test passed on the candidate. Applying that same test body
  in-memory to the baseline agent source failed as expected: 2 tests, 1 pass,
  1 fail, 9.9558 ms TAP. The failure is the absent guarded appender; baseline
  also contains the direct null `appendChild` path which the test reproduces.
- Diff territory is exact: `src/views/agent.js`, its focused clock test, and
  the builder report. No source behavior outside runtime-ring mounting changed.

## Required verification

| Command | Exit | Count | Duration |
|---|---:|---:|---:|
| `node --test tools/test/live-agent-clock.test.mjs tools/test/terminate-ui.test.mjs` | 0 | 10/10 pass | 85.3294 ms TAP; 149.6556 ms process |
| `npm run build` | 0 | 729 modules transformed | 6.30 s Vite; 7071.9076 ms process |

The first build invocation exited 1 in 427.1421 ms because this clean review
worktree had no `node_modules` and could not find `vite`. `npm ci` exited 0 in
5707.2295 ms, made no tracked package-file change, and the table records the
successful required rerun. The known chunk-size warning remains.

## Honest gaps

- No browser was driven. Visual acceptance remains pending for the shadow
  manager and is not verified by this review.
- This review did not inspect or interact with the dashboard launch record; it
  reviewed only the specified implementation and test artifacts.
