# R1152 live-agent render crash repair

## Result

The live control rail now recreates its own `.agent-ring-wrap` after
`rail.replaceChildren()`. Both that insertion and the later runtime-ring
insertion use a guarded append helper. A missing node or an `appendChild` that
throws now disables only the decorative runtime ring; it cannot escape
`buildAgentView` and replace the whole page with the projection-error fallback.

The existing runtime-source normalization and Terminate controller flow were
not changed. Running and stopped live clocks still use the same epochs and
update rules, simulated clocks still use their original mount and heartbeat,
and absent runtime telemetry still produces no control-panel ring while the
graph retains its existing unavailable state.

## Changed files

- `src/views/agent.js`
  - retains a runtime-ring mount reference;
  - recreates the mount inside the rebuilt live control rail;
  - contains missing/corrupt append targets and stops ring updates when mount
    insertion fails.
- `tools/test/live-agent-clock.test.mjs`
  - adds an executable fake-rail/fake-mount regression covering rail clearing,
    mount restoration, successful ring insertion, the exact legacy null append,
    and an `appendChild` implementation that throws.
- `R1152-AGENT-VIEW-CRASH-REPORT.md`
  - records cause, repair, and verification evidence.

## Regression proof

Before the production fix, the focused test was run while both scoped source
files still matched baseline `ae7b51b` (verified by
`git diff --exit-code ae7b51b..7b4281a -- src/views/agent.js tools/test/live-agent-clock.test.mjs`,
exit 0). That run exited 1 with 2 tests, 1 pass, 1 failure, and a TAP duration of
70.3042 ms because the guarded mount path was absent.

The final test executes the mount operations rather than relying only on source
patterns: it clears a fake live rail, appends a replacement mount, mounts the
ring into it, executes the legacy `null.appendChild(...)` shape and observes its
`TypeError`, then verifies that the production helper returns `false` for both a
null mount and a throwing/corrupt mount. Source assertions additionally bind
that tested helper to both append sites in `buildAgentView`.

## Verification

| Command | Exit | Tests / build | Duration |
|---|---:|---:|---:|
| `node --test tools/test/live-agent-clock.test.mjs` | 0 | 2/2 pass | 75.2455 ms TAP (128 ms process) |
| `npm run test:data` | 0 | 58/58 pass | 2612.0156 ms TAP |
| `npm run build` | 0 | 729 modules transformed | 6.21 s Vite (7.1 s process) |

The fresh worktree initially had no `node_modules`, so the first build attempt
could not resolve `vite`. `npm ci` restored the locked dependencies without
changing package files; the table records the successful required rerun. The
successful build retained the existing warning that its main minified chunk is
larger than 500 kB.

## Honest gaps

- Visual acceptance is pending for the shadow manager; it is not claimed here.
- No browser was driven, as required by the repair brief.
- The shadow manager still owns the live Terminate click and OS-level PID
  recheck. The existing Terminate implementation was preserved, and the full
  data suite's Terminate-flow tests pass.
