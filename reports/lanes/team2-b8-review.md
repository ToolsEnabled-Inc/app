# team2-B8 — adversarial review (uninstall / reset from inside the product)

Reviewer re-ran every load-bearing number against the current tree and attacked the
absence case. Nothing was edited; findings only.

## Reproduced, by use, on this tree

| evidence | result |
| --- | --- |
| `node tools/uninstall-reset-packaged-qa.mjs` | 31/31, exit 0, 48.0s — outcome=warn, 48 Chromium files left, every planted file of the person's data gone, work folder untouched, relaunch signed out on route=setup |
| `node --test tools/test/local-data-reset.test.mjs tools/test/product-account-surface.test.mjs` | 106/106, 0 fail, 0.5s |
| `node tools/account-isolation-session-qa.mjs` | 28/28, exit 0, 202.7s — a session file copied before "sign out everywhere" is refused |
| `npm test` | 1548 tests, 1538 pass, 9 fail, 139.4s — same 9 pre-existing reds; refusal-copy lists 5 offenders, none in B8's files |
| `check-product-naming` + `check-suites-discovered` | both exit 0, 107 suites / 107 files |
| fenced territory | `shell/renderer-prefs.cjs`, `build/`, `src/views/agent.js`, `tools/packaged-qa-suite.mjs`, `package.json`, `config/settings-registry.json`, `BUILD-QUEUE.md` all unmodified. `src/views/settings.js` is dirty but from the guide/first-run lane, not this one. |

## Defects found (absence case), not fixed

1. **An unreadable machine record turns "we do not know which folders you chose"
   into "you chose none", and the screen promises anyway.** Packaged run, two
   launches on one profile with a workspace at `<userData>\my-work`:
   record intact → conflict alert shown; one line of garbage in `machine.json` →
   **no** conflict alert, the screen still prints "Nothing in them is opened,
   moved or deleted here", the person presses delete, and `my-work\my-notes.txt`
   is gone. `localDataResetPlan()` reads `readWorkspaceState().roots` without
   consulting `available`, and `planReset` has no way to say "unmeasured", so the
   copy cannot hedge even if it wanted to.
2. **"They are named below" over an empty list.** Two triggers, both driven
   through the shipped modules: a root whose `readdirSync` throws (vault
   survives, `remainingFiles=0`, `kept=[]`, screen reads "0 files could not be
   deleted"), and a file the still-running window re-creates after the sweep
   (1 file counted, `data-reset-kept` element absent from the done markup). The
   driver's central assertion holds for the staged run, not by construction.
3. **The revocation half is never reported on the warn path** — which is the
   normal path in the packaged app. Rendered done markup mentions no sign-in
   state whether `revoked.ok` is true or false, so a failed
   `signOutEverywhere()` is silent.
4. `guardRoot` builds its refusal list from the environment: with `env {}` and a
   throwing `homedir()` it ALLOWS `C:\Users`, `C:\Program Files` and the home
   directory. Not reachable from product code today; it is the shape the guard
   exists to prevent.
5. `eraseLocalData({roots: []})` returns `complete: true` (with `ok:false`).
   Harmless today because the copy gates on `ran` first; a trap for the next
   caller.
