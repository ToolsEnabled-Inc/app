# lane steering-controls

Goal: Pause / Respawn / Terminate must steer a REAL running agent session,
proven by process/PID evidence from the running product, not UI state.

## Harvest of the prior lane (2026-08-11)
- `C:\Users\joshp\Desktop\wt-r1152-terminate-control` is a worktree of the
  ENGINE repo (toolsenabled), not the app. Its uncommitted diff is only
  `reports/OPEN-GATES.md`, `reports/OWNER-REQUEST-LEDGER.json[.bak]` plus two
  terminate console logs — no code. The real prior work is COMMITTED there as
  `e54dddc Add audited Mission Bridge terminate control`
  (`src/lib/mission-bridge/termination.js`, +actions/server/tests), and
  `git merge-base --is-ancestor e54dddc HEAD` in
  `toolsenabled-current` = YES: it is ALREADY MERGED into the engine branch
  `coordinator/r1161-interactive-bridge-run9`. Nothing to re-apply.
- That work is the REMOTE bridge terminate (agentId/runId/PID over HTTP). It is
  not the app-owned session path, which is what the app's three buttons drive.

## Baseline in wt-capability (HEAD 7326f0c)
- `27f5922` already added `src/agent-session-registry.js`,
  `src/agent-session-controls.js` and the arbitration in `src/views/agent.js`.
  `node --test tools/test/agent-session-steering.test.mjs` -> 17/17 pass, 103 ms.
- So the question is no longer "is it wired" but "does it steer a real process".

## Notes
- Probe: engine `startCodexSession()` under plain node, close() -> the codex.exe
  grandchild DID die (measured 23.1 s run, SURVIVORS_AFTER_10S=[]).

## Verified BY USE (real window, real Codex child, PID evidence)
New harness: `tools/steering-controls-e2e.cjs` + `tools/run-steering-controls-e2e.cjs`.
Boots shell/main.cjs, navigates the real renderer to the live agent drill-in,
presses Start / Pause / Respawn / Terminate as DOM clicks, and checks every
claim against the Windows process table by pid.

Run 3 (after both fixes), `node tools/run-steering-controls-e2e.cjs`:
24/24 PASS, 63.1 s. Pid evidence:
- Pause: codex pid 53364 still ALIVE, transcript frozen at 202 chars over 8 s.
- Respawn: 53364 dead, 12208 alive (different pid).
- Terminate: 12208 dead. leftovers=[] (nothing orphaned).

## Defects found and fixed
1. `sessionControlFace()` checked `enabled` before `step === 'pending'`, and the
   only caller passes `pending` for exactly the control that
   `sessionControlAvailability({busy})` answers off() for -- so the "Working…"
   branch was UNREACHABLE and every press painted "Unavailable" for the whole
   of the action. A unit test had asserted it green by calling the function
   with a state the product cannot produce. Ordering now: pending -> unavailable
   -> confirm. Confirm stays subordinate (it invites a press); pending does not
   (it reports an action already sent). Nothing becomes clickable.
2. `closeSession()` in src/agent-session.js called `bridge.interrupt`
   unconditionally and swallowed the rejection, so Electron printed
   `Error occurred in handler for 'mc-agent:interrupt'` with a stack on EVERY
   Stop/Respawn/Terminate over an idle session -- an error logged on the correct
   path. Now asked only when a turn is running; close() ends the child either
   way, so a wrong reading costs politeness, never a surviving process.
3. The steering suite header named `tools/agent-steering-packaged-qa.mjs` as the
   reachability half. That file does not exist. Header now names the harness
   that does.

## The SHIPPED artifact, measured (release/win-unpacked, app.asar 07:27)
`MC_APP_ROOT=<release>\resources\app.asar MC_RESOURCES_PATH=<release>\resources
 node tools/run-steering-controls-e2e.cjs` -> 22/23 in 29.9 s.

The three controls ALREADY steer a real process in the packaged build:
Pause left pid 33100 alive with output frozen at 259 chars, Respawn killed
33100 and started 44168, Terminate killed 44168, leftovers=[].

The 1 failure + the log gate are exactly the two defects fixed in this lane
(pending face unreachable; `mc-agent:interrupt` stack on the correct path), and
they are still present in the artifact because it predates the fixes. Whoever
owns packaging must re-run `npm run dist` for them to reach an installer; I did
not, because release/ is shared and another lane was writing it during this run.

## Repo gates
- `node --test --test-concurrency=1` over the 5 suites covering the changed
  files: 84/84 pass, 9.3 s.
- `node tools/check-suites-discovered.mjs` -> 89/89 reached, exit 0.
- `node tools/check-renderer-payload.mjs` -> OK, 0 operator files, exit 0.
- `git diff --check` over my files -> exit 0.
- Full `npm test` -> 1091 pass / 27 fail. All 27 are pre-existing and unrelated
  (shell-port-scan / smoke-packaged / pack-out-directory-reuse, failing with
  `EADDRINUSE 127.0.0.1:4601` because a peer lane's first-run-contract QA keeps
  an installed copy on the shell port range). None import the changed files.
