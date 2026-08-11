# Lane: performance-no-lag

Tree: `C:\Users\joshp\Desktop\wt-capability` (branch `packaging/capability-layer`).
No git write commands were run. Working-tree edits only.

His directive: *"Also make sure the software performs at a high level as in there
is no lag. This could potentially be being used to have many cloud agents work on
a very weak pc, the last thing we want is to be the reason that system
[struggles]."*

## Headline

**The product was spending roughly a third of every launch showing nothing,
waiting for a subsystem the first screen does not read.** `createWindow()` in
`shell/main.cjs` awaited the capability layer — a full Node process that boots
the mission bridge, opens its vault and binds a port — *before* it constructed
the BrowserWindow. The two are independent. They now run at the same time.

Measured, interleaved A/B, 10 paired rounds on the same binary in the same
minutes: **median 599ms off the wait, 8 of 10 rounds faster, and the worst
launch nearly halved (6342ms → 3302ms).**

Everything else I was sent to look for, I measured and did **not** find:
idle CPU is under 1.5% of one core, there is no memory creep over repeated
laps, and the deterministic layout (`src/tree-layout.js`) is sub-millisecond to
N=500. I did not "optimise" any of them. Two real costs I could not fix inside
my fences are named precisely at the bottom, with the exact change.

## The instrument

`tools/performance-budget-qa.mjs` (new). Every existing packaged driver asks
whether a thing WORKS; none asked what it COSTS. This one measures the packaged
window — the working tree staged inside a real packaged artifact, not the dev
server — across six scenarios: `coldstart`, `bridge`, `routes`, `idle`,
`memory` (the default gate), plus `scale` and `weakpc` (investigations, opt-in).

Three decisions worth knowing about:

- **The window is genuinely shown.** `MC_SMOKE_HEADLESS=1` gives the
  BrowserWindow `show:false`, and Chromium throttles `requestAnimationFrame` in
  a hidden window — a headless idle measurement reports a clean 0% for a page
  burning a frame loop forever. That is the defect class the scenario exists to
  find, so it must not be measured headless.
- **"Interactive" means a view, not a document.** The debugger attaches while
  the page is still `about:blank`, which has a documentElement and is perfectly
  quiet. A settle-only wait declared cold start finished before the product had
  loaded a byte. The wait is now *first view mounted into `#stage`*, then quiet.
- **Exit 2 is not a verdict.** 0 = budgets held, 1 = a budget was exceeded (a
  statement about the product), 2 = the harness never measured (a statement
  about the probe).

## What was measured, before any change

Packaged, staged with the current tree, sterile per-run profiles.

| | |
|---|---|
| Cold start, configured profile | median 1503ms, best 1142ms (n=5) |
| — of which, before the renderer exists | median 872ms |
| — renderer's own half (document→load) | **234–349ms** |
| Capability layer boot, measured alone | median 525ms, range 488–626ms (n=5) |
| Route to route, clicking the ring arrow | 295–363ms, all 8 stops |
| Idle, home / computers (35s, whole process tree) | 0.80% / 1.34% of one core |
| Idle working set | 489–533MB across 6 processes |
| Memory over 4 laps of the ring | +0.08MB heap/lap; nodes and listeners fall after GC |
| `layoutTree` at N=5…500 | 0.01–0.86ms — not a bottleneck at any N |

The renderer is not the problem. `spawn → renderer exists` was 58% of the
launch, and the capability layer is the majority of that.

## The change

`shell/main.cjs`, three coupled edits:

1. `createWindow()` starts the capability layer and does **not** await it there;
   it awaits it after `loadURL` resolves. `createWindow()`'s contract is
   unchanged — it still does not resolve until the layer has settled — so every
   caller and startup gate downstream sees exactly what it saw before. What
   changed is only *when the person gets their window*.
2. `startSupervisedCapabilityLayer()` is now idempotent and keeps its in-flight
   promise. **Both readers of the layer's status await it.** This is the whole
   risk of the change and it is this codebase's signature defect pointed at the
   bridge: `capabilityLayerStatus` starts life as `CAPABILITY_NOT_STARTED`, and
   that value is now reachable by a renderer. Handing it out would make a
   healthy install report BRIDGE_UNREACHABLE for the first half-second of every
   launch. A NOT-YET must never be answered as an ABSENT.
3. `will-quit` can now arrive mid-start — a person can close the window while
   the layer is coming up — so the child is held from the moment it *exists*
   (through `startCapabilityLayer`'s own `spawn` seam), not only from the moment
   it speaks. Otherwise that child is an orphan holding a port in the 4610-4619
   discovery range, which is exactly what that handler exists to prevent.

## The absence case, tested from the glass, and proven to have teeth

New scenario `bridge`: ask `window.mcShell.getBridgeEndpoint()` — the way the
renderer asks — from the earliest instant the probe can attach, repeatedly, and
fail if a single answer is a refusal while the layer goes on to come up. There
is no "eventually correct" here; a refusal handed out once has already been
acted on.

    current tree                        exit 0
      0 refusals, became ok: yes
    mutant: handler answers without      exit 1
    awaiting the in-flight start
      3 asks, 2 refusals, both
      "The capability layer has not
       been started yet."

The mutant is the code I would have written without step 2. The hazard was real,
not theoretical: two wrong answers in the first ~120ms of every launch.

## Before / after

Interleaved A/B, same staged binary, arm order alternated each round so warm-up
drift cannot be charged to one side. Control = the serialized ordering (one
`await` restored); treatment = the current tree. This machine was running three
other lanes throughout, which is noise, and also a fair proxy for a weak PC.

    spawn -> renderer exists (the wait this change targets)
      serialized (control)  n=10 best= 945ms median=1939ms mean=1948ms worst=3795ms
      concurrent (current)  n=10 best= 394ms median=1616ms mean=1365ms worst=2443ms

    spawn -> first view settled (what a person waits)
      serialized (control)  n=10 best=1645ms median=2769ms mean=2947ms worst=6342ms
      concurrent (current)  n=10 best=1097ms median=2394ms mean=2219ms worst=3302ms

    paired improvement (control minus current; positive = faster)
      spawn->renderer  median 755ms  mean 583ms
      spawn->settled   median 599ms  mean 728ms   wins 8/10 rounds

Full default gate after the change: **PASS, exit 0, 113s.** Cold start median
1416ms configured / 1064ms first run; worst route move 349ms; idle 0.40% (home)
and 0.45% (computers) of one core; heap +0.11MB/lap with node and listener
counts falling after GC.

## The weak PC, actually simulated

Chromium can slow its own main thread by an exact factor, which is a better
answer than multiplying a fast number by a guess. This slows the renderer only
— not the disk, the OS, or Electron's start — so it is a **floor**, not a
ceiling. The real weak machine is worse.

At **6x slower CPU**, one lap of the ring, clicking:

    home       -> computers    1168ms   script  53ms  style 149ms/8   layout 302ms/7
    computers  -> metrics       961ms   script 126ms  style 186ms/16  layout 215ms/10
    research   -> comms         749ms   script  57ms  style  91ms/9   layout 139ms/4
    comms      -> ledger        581ms   script  43ms  style  68ms/8   layout  79ms/5
    metrics    -> research      515ms   script  31ms  style  99ms/6   layout  79ms/4
    ledger     -> approvals     421ms   script  25ms  style  51ms/7   layout  33ms/3
    approvals  -> home          391ms   script  33ms  style  46ms/7   layout  88ms/7

At **10x**: bundle parse+execute 370ms, reload→settled 1696ms, worst move 1173ms.

**The cost on a weak machine is style recalculation and layout, not JavaScript.**
Script is 4–13% of each move. Anyone reaching for "make the JS faster" is
reaching for the wrong 10%.

## Scale: where it degrades, and the ceiling it cannot pass

Seeding the declared organisation (`<LOCALAPPDATA>/ToolsEnabled/agent-org.json`)
and reading the count back **from the running app** — the first version of this
scenario seeded 400 agents, drew one node, and reported a beautifully flat
curve, because the overlay envelope was wrong and the product ignored it. A
scale test that did not scale is the worst possible result, so a mismatch is now
a NO VERDICT about the probe.

**`capability/src/lib/agent-org.js` refuses a declared org above 64 agents**
("The declared org is bounded to 64 agents."), and the refusal surfaces to the
renderer as *an org that does not exist at all* rather than a truncated one. So
64 — one controller and 63 others — is the largest fleet this surface can ever
be asked to draw through the declared path. "Many cloud agents" is capped there.

Across the whole usable range, the computers page:

    declared agents    build    script   style          layout        DOM
      1               334ms      7ms     21ms/14        27ms/13        490
     16               389ms      9ms     78ms/24        46ms/11       1149
     32               710ms     18ms    156ms/49        56ms/11       1753
     48               702ms     17ms    172ms/52        59ms/13       2444
     63               715ms     16ms    207ms/47        65ms/13       3090

Style recalculation grows 10x across the range; script grows 2x. At 6x CPU that
207ms is over a second of style alone.

**Named exactly**, from a geometry-read counter installed on the live page:
`TreeGraph._placeChips()` performs **566 forced geometry reads per page build**
at 63 agents — 272 `getBoundingClientRect` on `.node-name`/`.node-role`, 136
`offsetHeight` on chips, 136 `getBoundingClientRect` on `.node-labels`, 29
`getComputedStyle`, 23 more — which is roughly **six calls of `_placeChips` per
build, each flushing style and layout over a 3090-element tree**. It has 11 call
sites in `src/tree-graph.js`.

## What I did not fix, and why — routed to the coordinator

**1. `_placeChips` is called ~6 times per fleet-surface build (src/tree-graph.js).**
`src/tree-graph.js` is claimed as territory by the live lane `page2-full-view`
(`reports/lanes/page2-full-view.md`: "Territory: `src/tree-layout.js`,
`src/tree-graph.js`, …") and carries 84 lines of its uncommitted work
(`git diff --ignore-cr-at-eol --stat`), so I did not edit it. **The exact
change:** coalesce `_placeChips()` to at most once per animation frame — a
`_chipFrame` guard around the body, with the 11 call sites scheduling rather
than invoking. The final state is identical because the last call wins; only the
intermediate placements are skipped. Expected effect, from the measurement
above: roughly 5/6 of 566 geometry reads and 5 of ~6 forced style+layout
flushes removed from the fleet-surface build, which at 6x CPU is the difference
between a 1168ms navigation and something near 400ms. Do **not** reorder the
class-toggle loop at the top of `_placeChips` to batch writes after reads:
`record.chip.offsetHeight` genuinely depends on `screen-chip-visible`, so that
"obvious" fix changes measured heights.

**2. The whole application is one 1.30MB JavaScript chunk.**
All twelve views are statically imported by `src/main.js`, so a person who opens
home pays for metrics, comms, checkout and setup. On this machine that costs
~250–350ms and is not worth the risk; at 10x CPU the parse+execute alone is
370ms, and it is the part that scales worst with a weak machine. Route-splitting
means making the router's `render()` async, which changes view-morph timing and
touches `src/views/agent.js` and `approvals.js` imports — both fenced, and three
view lanes are live. **Structural; needs its own lane with the view lanes
quiet.** `vite` prints the recommendation itself on every build.

**3. Idle working set is 489–540MB across 6 processes.** CPU while idle is
fine (<1.5% of one core) and there is no leak. But on the 4GB machine his
directive describes, half a gigabyte resident is the cost that will actually
hurt, and it is Electron's shape rather than a defect in this code. Naming it,
not fixing it.

## Files changed

- `shell/main.cjs` — the concurrency fix, the awaited status readers, the
  mid-start child handle. **Note for the coordinator:** this file also carries
  the Google-OAuth sign-in handlers a fenced lane is building (~line 1917). My
  edits are in `createWindow()`, `startSupervisedCapabilityLayer()`, the two
  `mc-bridge-*` handlers and `will-quit` — all well away from that region, but
  the file has two authors this session.
- `tools/performance-budget-qa.mjs` — new.
- `reports/lanes/performance-no-lag.md` — this file.

Nothing else. `src/tree-graph.js`, `src/views/*`, the settings/appearance/
checkout write paths, `shell/renderer-prefs.cjs`, NSIS, `packaged-qa-suite.mjs`
and `test-ratchet.mjs` were read and left alone.

## Suite state

`npm test` → 1249 pass, **2 fail**, both **pre-existing and not mine**:

- `every harness that launches the packaged app strips ELECTRON_RUN_AS_NODE` —
  fails identically with my file moved out of `tools/` (verified by parking it
  and re-running: still `# fail 1`). Belongs to one of the other lanes'
  unregistered new drivers.
- `contract #7: a real listen error that is not "address in use" propagates
  unchanged` (`shell-port-scan-contract.test.mjs`) — imports only
  `shell/port-scan.cjs`, which I did not touch; the test itself depends on
  finding an OS-reserved TCP port on the host.

`node --test tools/test/capability-layer.test.mjs tools/test/bridge-proof.test.mjs`
→ 23/23 pass, 80ms.

## Reproduce

    node tools/performance-budget-qa.mjs                       # the gate
    node tools/performance-budget-qa.mjs --scenario weakpc --cpu-rates 6
    node tools/performance-budget-qa.mjs --scenario scale --agent-counts 1,16,32,48,63 --profile
    node tools/performance-budget-qa.mjs --scenario bridge

`--stage <dir>` reuses a staged copy (skips a 350MB file copy); `--shell <dir>`
and `--dist <dir>` swap one half of the product, which is what makes an honest
A/B possible on a machine that is doing other work.
