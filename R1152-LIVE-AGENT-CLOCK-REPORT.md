# R1152 Phase 3 live-agent runtime clock report

## VERDICT

PASS. Live agent detail now sends the projection's finite `bornAt` and
`stoppedAt` through one normalized runtime source shared by the existing graph
clock and uptime ring. Running clocks advance, exact terminal clocks freeze,
and absent or incomplete terminal epochs remain unavailable.

## EVIDENCE

- Focused regression: `node --test tools/test/live-agent-clock.test.mjs`
  passed 1/1 test with exactly 10 assertions in 82.9204 ms, exit 0. Before the
  implementation, the same probe failed 0/1 in 60.447 ms because the live
  runtime normalizer did not exist.
- Syntax: `node --check src/views/agent.js` exited 0.
- Data suite: the final `npm run test:data` stability run passed 57/57 tests in
  2351.4646 ms, exit 0. It followed three other consecutive 57/57 passes.
- Production build: `npm run build` transformed 729 modules and completed in
  5.86 s, exit 0.
- Diff hygiene: `git diff --check` exited 0.
- Exact changed files:
  - `src/views/agent.js`
  - `tools/test/live-agent-clock.test.mjs`
  - `R1152-LIVE-AGENT-CLOCK-REPORT.md`

## DECISIONS MADE ALONE

- Preserved `uptimeRing` as the sole controls-ring renderer. For an exact
  stopped duration, the adapter translates that duration into the ring's
  existing epoch coordinate once and disables its heartbeat; running and
  simulated clocks retain their real epoch and existing heartbeat.
- Reused the same normalized `bornAt`/`stoppedAt` source for `FleetGraph`, so
  the bubble runtime and controls ring cannot disagree about availability or
  terminal state.
- Failed closed when a selected `finished` or `failed` control target lacks a
  finite `stoppedAt`; no live ring is constructed in that case.

## ESCALATIONS

None. No owner, coordinator, Telegram, JARVIS, browser, network, service,
process-control, push, tag, or remote action was used.

## DISSENTS-PRESERVED

- Pause and Respawn remain disabled.
- The landed two-step real Terminate controller and its target binding were not
  changed.
- Simulation controls and runtime behavior were preserved.
- No projection generator, schema, bridge, style, shell, package, generated
  data, shared ToolsEnabled file, or LLMBenchmarking surface was changed.

## GAPS

- Visual own-eyes acceptance was not performed; it remains explicitly reserved
  for the coordinator/shadow.
- The build retains Vite's existing warning that a minified chunk exceeds 500
  kB; this bounded task did not alter chunking.
- The first full-suite attempt reported 56/57 with exit 1 in 940.3044 ms, but
  the tail-only capture did not retain the failing subtest identity. Four
  immediate full-suite reruns passed 57/57; the final result reported above is
  the last of those passes.
