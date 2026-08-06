# VERDICT

PASS — Phase 2 read-surface wiring is complete on `phase2/wire-read-surfaces`. All six ring pages default to their validated live projections, Settings exposes six independent rollback flags, and every flag changes the active surface to/from the preserved simulation immediately. Current unavailable observations are rendered honestly (`source-unreadable-safely` for coordinator thread and ops messages); no simulated history, runtime, task count, time series, identity mapping, or zero is presented as live. The required battery, data tests, production build, live-wiring probe, and screenshot wave are green. Ready for coordinator own-eyes review and merge.

# EVIDENCE

## Delivered wiring

- Shared flag register: six default-live flags with `mc.live.<view>` storage and one change event in `src/live-flags.js:5`; active-route rebuild in `src/main.js:206`; six inline Data & Sim controls in `src/views/settings.js:102` and `src/views/settings.js:418`.
- Home: `coordinator.json` is read at `src/views/home.js:321`; the current unavailable thread reason and six observed-session summary replace the simulated transcript in live mode. The composer is read-only. The detached-DOM/font-swap pin fix is in `src/views/home.js:304` and the shared chat contract in `src/components.js:455`.
- Computers: `fleet.json` adapters start at `src/views/computers.js:87`; the protected graph receives all 13 declared nodes and 19 exact declared edges through `src/graph.js:138`/`src/graph.js:878`; services and graph facts render in the existing rail at `src/views/computers.js:938`. Runtime/tasks/failure/messages are explicit unavailable facts, and Edit reparenting remains a local layout draft without rewriting declared edges (`src/graph.js:2769`).
- Agent: declared topology and relationships are mapped without inventing a session-to-agent join at `src/views/agent.js:50`; live graph/control/chat assembly begins at `src/views/agent.js:492`; local draft chat starts with zero simulated messages at `src/views/agent.js:1181`.
- Metrics: aggregate-only tiles are declared at `src/views/metrics.js:317`; protected module hosts and standard layout remain intact while unsupported series render unavailable and initialize no ECharts/timer loop in live mode (`src/views/metrics.js:1732`, `src/views/metrics.js:1774`).
- Comms: live board construction begins at `src/views/comms.js:748`; declared services and observed channels stay separate; every message-bearing surface uses the reason-bearing unavailable element at `src/views/comms.js:781`; projection application is at `src/views/comms.js:1438` and live simulation arrival timers are suppressed.
- Ledger: privacy-minimized request rows use only projected ID/status/gate counts at `src/views/ledger.js:137`; live fetch/async guards are at `src/views/ledger.js:399`; the current projection renders 449 request rows and an honest Q-source unavailable state when applicable.
- Shared presentation hooks are token-only and serially owned in `src/styles.css:392`–`src/styles.css:461`. `src/vocab.js`, payload schemas/shapes, generators, `package.json`, `index.html`, shell code, and `p2-console.log` were not changed.

## Verification against this worktree

The worktree production preview ran on `127.0.0.2:4600`; the owner's existing `:4600` listeners on `::1`/`127.0.0.1` were not rebuilt or restarted. Browser probes used `CONTROLLER_DELEGATED=1` plus a preload that resolved `localhost` to the worktree preview. Protected-mechanics probes used the six rollback flags in simulated mode; the separate live probe exercised all live/default paths and live↔simulation flips.

| Command / probe | Exit | Measured result | Wall time |
| --- | ---: | --- | ---: |
| `npm ci` | 0 | 41 packages; 0 vulnerabilities | 5,886 ms |
| baseline `npm run build` | 0 | 725 modules; Vite 6.12 s | 6,919 ms |
| final `npm run build` | 0 | 726 modules; Vite 5.99 s | 6,630 ms |
| `npm run test:data` | 0 | 17 passed, 0 failed; test duration 2,411.3908 ms | 2,899 ms |
| final `.mc-smoke.mjs` (live/default) | 0 | 18/18 route-theme combinations; 0 page errors | 57,762 ms |
| `artifacts/p2/live-wiring-probe.mjs` | 0 | 81/81: all live sources, honest unavailable states, 21 theme shots, six instant fallback/restore pairs, 0 page errors | 55,313 ms |
| `.mc-collide.mjs` (protected simulation) | 0 | 0/30 visible-chip collision samples | 32,744 ms |
| `.mc-comp.mjs` | 0 | 0/24 box-over-bubble/label/edge samples | 31,800 ms |
| `.mc-ui.mjs` | 0 | 0/64 context-box-under-chrome samples | 72,650 ms |
| `.mc-brace.mjs` | 0 | dTop 0; dBottom 0; overflow 0; symmetric; centers both y=491; 0 page errors | 31,070 ms |
| final `.mc-thread.mjs` | 0 | 16/16; load pin exact (`scrollTop=2376`, `scrollHeight-clientHeight=2376`); send/reply/live-arrival pins green; 0 clipped turns; 0 page errors | 18,164 ms |
| `.mc-layout-verify.mjs` | 0 | 43/43; standard rows exact; layout persistence/reset/keyboard/reduced-motion green; heap 9.5→9.5 MB (0.0%); 0 page errors | 102,714 ms |
| `.mc-dupes.mjs` | 0 | 40 panes; worst same-line count 2; repeats within 2/4/6 lines = 0/0/0 | 15,459 ms |
| `.mc-visiblerepeats.mjs` | 0 | 15 visible panes across 3 loads; 0 in-view verbatim repeats | 15,569 ms |
| `.mc-comms-behave.mjs` | 0 | 11/11 board behavior checks | 21,770 ms |
| `.mc-settingsgate.mjs` | 0 | Current harness: all 16 assertions PASS; 42 visible / 86 total settings; deep tiers/search/persistence/drawer green | 11,801 ms |
| `.mc-contrast.mjs` | 0 | brace contrast white 2.10, black 2.11, tan 2.10 | 3,984 ms |
| `.mc-role-hue.mjs` | 0 | 101 assertions passed; 6 explicitly not-on-screen informational recipes; all themes and live theme flip green | 95,613 ms |
| `.mc-gallery.mjs` | 0 | 75 screenshots; sanity probes all clean | 203,082 ms |
| final live `.mc-collide.mjs` | 0 | 0/30 visible-chip collision samples on projection graph | 24,806 ms |
| `node --check` on all 11 changed/new JS modules + `git diff --check` | 0 | syntax clean; no whitespace errors (Git emitted only LF→CRLF notices) | 800 ms |

The recurring pin defect was reproduced before the fix (`scrollTop=2332` vs `scrollHeight-clientHeight=2376`). After the fix, `.mc-thread.mjs` passed three consecutive pre-final runs at 24,156 ms, 22,076 ms, and 18,962 ms, then the final 16/16 run above.

Final current screenshots are untracked in `artifacts/p2/`: `home`, `computers`, `agent`, `metrics`, `comms`, `ledger`, and `settings` × `white`, `black`, and `tan` (21 images). Manager own-eyes review covered representative surfaces in every theme and all seven tan surfaces; the coordinator's tan own-eyes review remains the merge gate.

# DECISIONS MADE ALONE

- Missing per-view storage means live; only the explicit `simulated` value disables a view. This makes Phase 2 the default while leaving each rollback one toggle away.
- A flag change rebuilds the active non-Settings route on a microtask. This gives an immediate source-boundary reset and lets each existing view destructor clean up timers, observers, charts, and async work.
- Whole-envelope and sub-surface failures remain visibly distinct. Available aggregate facts render normally; unsupported details are unavailable, never borrowed from simulation.
- Fleet roles are mapped only to existing visual role hues while exact declared roles stay visible in projection registers. All declared edges render; the single-parent tree is only a layout projection. Live Edit changes that local layout only.
- Opaque observed sessions are not joined to declared agents. Live agent chat is explicitly a local draft with zero seeded history; no runtime epoch is synthesized.
- Metrics preserves every protected module identity/host and the byte-stable default layout. Unsupported charts are not initialized in live mode, eliminating both false shapes and idle chart work.
- Ops declared services and observed channels remain separate records even where names/ports appear related. No relationship is inferred without contract evidence.
- Ledger request titles/ages/agents are not reconstructed from legacy data; request rows expose only the privacy-minimized live contract.
- The current fleet source is a 13-node/19-edge star-heavy topology. The protected Tree renders it faithfully and enters its existing dense/focus state; Physics, Edit, focus hint, screen instruments, and local reparent mechanics remain available.

# ESCALATIONS

None. No protected file boundary, package/index change, payload-shape change, destructive action, live-owner-preview mutation, or owner-only decision was required.

# DISSENTS-PRESERVED

None. Five bounded Terra/high lanes (computers+graph, agent, metrics, comms, ledger) reported no dissent. Each worker deliberately left build/browser verification to the manager; those lane gaps were closed by the measured battery above.

# GAPS

- Current source gap, rendered by design: `coordinator.thread` and `ops.messages` are unavailable with reason `source-unreadable-safely`. The UI does not fabricate replacements.
- The coordinator's own-eyes tan review and merge are external gates and remain to be performed after this commit.
- Vite still emits the existing warning that the 1,064.72 kB minified JS chunk exceeds 500 kB. This wiring phase did not change package/build architecture.
