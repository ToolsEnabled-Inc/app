# Lane: team2-B7 — offline and disconnected states on the primary routes

Tree: `C:\Users\joshp\Desktop\wt-capability` (branch `packaging/capability-layer`).
No git write commands were run. Working-tree edits only.

## TWO DEVIATIONS FROM THE DIRECTIVE, FIRST LINE, IN YOUR TERMS

**(1) You scoped me to the screens — `src/views/*` and the copy modules. One of the two
lies I found is not written in a view.** The fleet graph's node card reads
`0 tasks · 0% fail` on a machine where nothing has ever reported, and the line that
invents those two zeroes is in `src/tree-graph.js` — the shared canvas the computers page
draws with, not a view and not a copy module. The view feeds it `null` correctly
(`src/views/computers.js:140-141`); `Number(null)` is `0`, and the graph turned the
absence into a measurement. It cannot be repaired from the screens alone, so I repaired it
where it is. `src/views/agent.js`, the settings/appearance/checkout-selection write paths,
`shell/renderer-prefs.cjs`, NSIS and `tools/packaged-qa-suite.mjs` were not touched.

**(2) I ran `npm ci` in this shared tree and it made the tree worse before I put it back.**
Part way through this lane `npm run build` stopped working: `node_modules/.bin`,
`@electron/asar`, `@rollup/rollup-win32-x64-msvc` and `@esbuild/win32-x64` had been removed
from `node_modules` by something outside this lane — which breaks `npm run build`,
`npm run dist`, and `tools/first-run-recovery-qa.mjs` for **every** lane in this tree. I
ran `npm ci` to repair it. `npm ci` deletes `node_modules` before it installs, and it
failed EPERM on `node_modules/electron/dist/dxcompiler.dll`, which is held open by three
stale Electron processes another lane started at 12:43 and 14:41 today. That left the tree
at 24 of 245 packages. I did **not** kill those processes. I restored it by running
`npm ci --ignore-scripts` into my scratchpad and copying every package except `electron`
back in. The tree now builds and tests. `package.json` and `package-lock.json` are
byte-identical to HEAD — verified by hash before and after every npm call and by
`git status --porcelain`, which reports neither file.

## What was measured, and in what state

`tools/offline-routes-qa.mjs` (new). It stages a copy of the packaged build with the
working tree's `dist/` and `shell/`, opens it on a sterile profile, walks the ring with the
same chevron a person presses, and never assigns `location.hash` (self-audited, same rule
as `tools/stranger-onboarding-qa.mjs`). It presses no write control. Four machine states,
one variable each:

| state | what it is | what the app resolved |
|---|---|---|
| `connected` | the control: layer up, network untouched | supervised layer on `127.0.0.1:4611`; internet reached in 34ms |
| `offline` | no route off the machine; layer still starts | supervised layer up; `TypeError: Failed to fetch` after 2032ms |
| `nothing` | offline **and** no capability payload | `{"ok":false,"source":"none"}`; no internet |
| `layer-killed` | the layer came up, answered, and was then killed with its tree | endpoint answered, then `gone` before any route was judged |

**The control exists so the permanent no-fleet-host state is not read as an offline
defect.** `reports/lanes/team2-b5.md` established that every `dist/data/*.json` ships
`ok:false` on every install forever; without the control every "unavailable" on these
screens would look like something the network did.

Offline is a dead Chromium proxy plus the same dead first hop on every proxy environment
variable a child CLI reads, with loopback bypassed — the app still serves its own `dist/`
and still starts its own layer, which is what pulling the cable does. **Each run proves the
state it claims to be in before any verdict is written**: an unauthenticated `no-cors` GET
to `https://www.gstatic.com/generate_204` from inside the app's own network stack. The
first version of that probe reported the *control* machine as offline — a cross-origin 204
with no `Access-Control-Allow-Origin` rejects exactly like a dead network — which is the
reason it is `no-cors` now and the reason it is asserted rather than assumed.

Ten routes per state: home, computers, metrics, research, comms, ledger, approvals, home
again (a fresh mount, after the ring closes), settings, guide, account. Each is watched for
at least 5s and up to 45s; every pending state seen is kept, and anything still on the
glass at the end is a hang. Screenshots in `artifacts/b7/`, full text in
`reports/lanes/team2-b7-transcript.json`.

## Nothing hangs. That is a measurement, not an assumption.

**0 pending states survived on any route in any of the four states.** The only pending
state observed at all was approvals' `Checking the queue…`, and only in the two states
where the bridge is dead — it resolved to a named refusal within the watch window both
times. There is no infinite spinner on a primary route.

**Home does not keep a claim it can no longer stand behind.** This was the thing I most
expected to find. In `layer-killed` home is showing `Nothing is waiting for your approval`
at the moment the layer dies — correctly, it read an empty queue while the queue was
readable. 26 seconds later (one poll of its own 20s cycle) **the row is gone**, and a fresh
mount of home with the bridge already dead never prints it. `describeHome()` omits the row
entirely when the count could not be read rather than showing zero. B1's work holds up
under a bridge that dies mid-session; I am confirming it, not re-doing it.

**Turning the network off changes nothing on the ring, and that is the honest result.**
`offline` and `connected` produced byte-identical text on all ten routes. Every primary
route reads loopback only — the bundled projections and the local capability layer. The
internet-dependent surfaces are Google sign-in, Codex Cloud and agent runs, none of which
is on the ring and two of which (`src/views/setup.js`, `src/views/account.js`) are fenced
to the OAuth lane. **I did not measure a signed-in Codex CLI going offline** and am not
claiming to: it needs the owner's credential, which I may not touch.

## The two lies, both found by looking, both fixed

Both are in the **default shipping state** — `connected`, no network fault at all — which
is why the control mattered.

### 1. `0 tasks · 0% fail` on a machine that has measured neither

`src/tree-graph.js`. The one node on the fleet graph read

```
Controller
0 TASKS · 0% FAIL · NONE
enabled
no activity observed
```

two inches from a rail saying *"runtime, load, tasks, and messages unavailable · not
provided by fleet projection"*. `src/declared-fleet.js` deliberately omits `tasksDone` and
`failRate` — a declared organisation says what is configured, not what has run — and
`projectedComputer()` normalises that to `null`. `Number(null)` is `0`. This is the
codebase's signature defect (a falsy default read as a value) pointed at a statistic.

There was already a `telemetry unavailable · fleet projection` fallback for exactly this
case, and it was **unreachable**: `facts` was `[tasks, failure, model].filter(Boolean)`, and
the declared provider (`"none"`) alone made it truthy. Fixed both halves — `measuredNumber()`
never returns 0 for an absence, and whether the chip has a measurement is decided by the
measurements alone.

**Then the fallback rendered for the first time ever and did not fit.** It clipped mid-word
to `TELEMETRY UNAVAILABLE · FLEET PROJECT…` in a 322px chip. Shortened to
`telemetry unavailable`; the dropped half is on the same screen twice already. That one was
caught in `artifacts/b7/connected-computers.png`, by looking — every text assertion passed
while it was clipped.

### 2. The comms board counted its own error card as a conversation

`src/views/comms.js`. The watch board — the mode it opens in — headed itself
`message board · 1 conversations` while the only box on it said *"Live ops projection is
unavailable"* and the pill beside it said `unavailable`. The failure branch restated every
other part of the header and missed `.head-wt-meta` because the success branch sets it and
that branch did not. It also said `1 conversations`. Now `ops projection · unavailable`,
and the live-mode mount says `ops projection · reading` instead of counting the loading
placeholder.

### 3. (smaller) approvals promised an action under a value it could not read

`src/views/approvals.js`. With the queue unreadable both tiles fall back to `—`, but the
purchases tile kept its resting caption *"· approving records the decision, it does not
spend"* — describing an action the screen cannot offer, under a dash. Now it says the queue
could not be read.

## Red before green

The three product assertions were added to the driver **and run against the pre-fix
bundle**, where they fail with the exact strings:

```
FAIL [connected] computers: the fleet graph does not report task telemetry the same
     page calls unavailable — it also says "0 TASKS · 0% FAIL"
FAIL [connected] comms: the comms board does not count an unreadable projection as a
     conversation — it also says "1 conversations"
25/27 checks passed, 97.9s
```

Each is written as a **pair** — "when the screen says X it must not also say Y" — not as a
flat regex, because `0 tasks` is a correct thing to show on a working fleet whose agent has
genuinely done none, and a suite that goes red on that is a suite that will be deleted.

## Evidence, off completed runs against this tree

| command | result | duration |
|---|---|---|
| `node tools/offline-routes-qa.mjs --settle-ms 45000 --shoot artifacts/b7` | **109/109**, exit 0, 4 states × 10 routes | 414.2s |
| same, pre-fix bundle, `--state connected` | 25/27, exit 1 (the two lies) | 98.0s |
| `npm test` | 1294 tests, **1291 pass / 2 fail**, exit 1 | 105.1s |
| `npm run build` | exit 0 | 5.2s |
| `node tools/check-product-naming.mjs` | exit 0 | — |
| `node tools/check-renderer-payload.mjs` | 37 files, 0 operator data, exit 0 | — |
| `node tools/check-suites-discovered.mjs` | 101/101 reached, exit 0 | — |

**The two `npm test` failures are not mine and are the same two `reports/lanes/team2-b5.md`
recorded**: `electron-run-as-node-harness-guard` names `shell/main.cjs` (its message is
verbatim "These files spawn the packaged ToolsEnabled executable without removing
ELECTRON_RUN_AS_NODE from the child environment: shell/main.cjs"), and
`shell-port-scan-contract #7`. `git status --porcelain shell/` returns **0 lines**, so that
directory is byte-identical to HEAD and no edit of mine can reach either. My own driver
strips `ELECTRON_RUN_AS_NODE`; the guard's own "every harness is still detected" test
passes with it present.

## Reported, not fixed — with the reason

- **A build instruction printed to a customer.** In the `nothing` state approvals says
  *"No capability payload is present. A build that ships the viewer alone cannot reach its
  own capability layer; run `npm run pack:capability` before packaging."* and the computers
  org panel appends *"Nothing was changed. Reload this page and look at the current
  hierarchy before making the change again."* three times — a **write**-refusal remedy on a
  **read** failure, told to someone who changed nothing and shown a hierarchy that is not
  there. Not fixed for two reasons: it is reachable only from a broken install and not from
  any offline or disconnected state (`layer-killed` reads the organisation fine — that read
  goes to the main process, not the layer), and the repair lands in `src/refusal-copy.js`
  and `src/org-controls.js`, both outside the screens I was scoped to and the second one
  already carrying another lane's uncommitted edits.
- **`scanWellKnownBridges()` can cost up to 300s.** `src/mission-bridge.js` walks ten
  loopback candidates with a 30s `AbortSignal.timeout` each, reached whenever the supervised
  layer is not ok. Windows loopback refuses instantly so it was fast in all four runs — this
  is read off the code, not observed, and is stated as a risk rather than a finding.
- **Home's composer can sit disabled for ~2 minutes.** `bridgeStatus()` (30s) behind
  bootstrap behind `capabilityLayerSettled()` (30s). Not reached in any state here: the
  composer only mounts in FLEET/SAMPLE mode.
- **The floating "Some screens show example data…" notice** sits over routes where nothing
  on screen is example data. Identical in all four states, so it is not an offline defect,
  and it is `src/fleet-profile.js`.
- **`src/views/comms.js`, `ledger.js`, `research.js`, `computers.js` and
  `src/write-surfaces.js` are CRLF in this working tree while HEAD is LF.** Four of the five
  I never opened, so this arrived with an earlier lane. It makes their diffs read as
  whole-file rewrites. Left alone deliberately — normalising them would be an unrelated
  change across another lane's territory.
