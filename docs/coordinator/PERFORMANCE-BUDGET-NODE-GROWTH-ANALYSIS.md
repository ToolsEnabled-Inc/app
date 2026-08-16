# performance-budget-qa's node growth: mostly a harness artifact (2026-08-15)

`performance-budget-qa` reports ~**15,408 DOM nodes retained per navigation
lap** against a budget of 400, plus ~143 listeners. It failed identically on
sealed 1.0.11 and 1.0.12, back to back. Source analysis says most of that
number is the harness measuring the wrong thing, and the teardown paths it
implicates are already correct.

## The artifact, and why it is provable

`measureMemory` (tools/performance-budget-qa.mjs:1143-1191) walks a route
ring until a route repeats **within that lap**, but never adds the STARTING
route to `seen` (lines 1149-1157). So each lap terminates one stop further
along than the last:

- lap 1 starts `home` → ends on `computers`
- lap 2 starts `computers` → ends on `metrics`
- lap 3 starts `metrics` → ends on `research`

The reported figure is `(lastLap.nodes - firstLap.nodes) / (laps - 1)`, so it
is really:

```
(Nodes while RESEARCH is mounted  -  Nodes while COMPUTERS is mounted) / 2
   + any genuine retention
```

The live difference between two fixed pages, halved, is charged to the leak.

Two corroborations:

- **Determinism is evidence FOR the artifact, not for a leak.** Real retention
  varies with GC timing, async loads and timers. A fixed structural difference
  between two fixed pages does not.
- **The verdict has flipped before, with the endpoints.** The same driver
  reported nodes *falling* after GC on 2026-08-11
  (reports/lanes/performance-no-lag.md:65,133). At that commit `settings` was
  not on the ring and the run used 4 laps — so the first/last samples landed
  on a different pair of pages. The pair changed; the verdict changed.

Smaller method issues: `collectGarbage` errors are swallowed and Blink sweeps
Oilpan lazily, so freed-but-unswept nodes still count; and with 3 laps the
"per lap" rate is a 2-point slope, so a ONE-TIME step reads as a permanent
rate.

Note the counter: Chromium's `Nodes` metric counts every live Node instance —
elements plus text nodes, comments and UA shadow trees, including detached
ones still reachable. It is NOT comparable to the `getElementsByTagName('*')`
figure used elsewhere in the same file, which runs 2-3x smaller.

## What the teardown paths actually look like

Every global listener is paired with its removal, every `setInterval` has a
`clearInterval` on a destroy path, every observer is disconnected, every
echarts `init` has a `dispose`, the single-slot globals holding view objects
are cleared by their owner's destroy, and no module-level map caches DOM nodes
or view instances (the ones that exist hold ids, numbers and strings). Every
ring view returns `{ el, destroy }` and the router calls `destroy()` on both
swap paths.

Three genuine weaknesses were found, all far too small to be 15,408 and none
worth touching before the showing:

1. `attachSeg()`'s returned `detach()` is discarded by ledger, settings and
   comms (components.js:873-913). Its observers watch only nodes inside the
   view, so it is a collectable cycle — idle work, not retention.
2. `registerChatLifecycle` (components.js:187) only disposes a disconnected
   entry if a sweep previously saw it connected. A chat destroyed before ever
   being attached would be retained forever. No path does this today.
3. research.js writes `innerHTML` (line ~2013) BEFORE destroying the charts
   in that block (~2017). `dispose()` still runs, but the ordering becomes a
   real leak the first time an early `return` lands between the two.

## What was NOT concluded, on purpose

No ranked list with percentage shares: the evidence supports one proven
contributor and does not support naming the others, and inventing shares
would be a fabricated finding. The honest bound: for the artifact ALONE to
produce 15,408/lap, the research page would need ~30,800 more live Nodes than
the computers page — a lot for one page. So the artifact certainly inflates
the figure and probably does not account for all of it.

## The ten-minute measurement that settles it

`--scenario routes` already prints the live `Nodes` count at every stop
(tools/performance-budget-qa.mjs:715-717). Read `computers` and `research`,
subtract, halve: that is the artifact's exact share. Then
`--scenario memory --laps 6` and read the per-lap series — flat with one step
is the artifact; linear is retention.

**Take that measurement BEFORE changing the harness.** Fixing the lap loop
first would make the number fall and prove nothing about which part was real.

## Verdict for the showing

**It does not threaten a one-hour session with 20-50 navigations.** Taking
15,408/lap at face value, that is ~2.5-6 laps ≈ 38k-92k nodes ≈ 10-30 MB,
against a measured idle working set of 489-533 MB. Detached nodes are neither
styled nor laid out, so they cost memory, not frame time — they cannot cause
the lag the performance requirement is about. The heap budget passing while
nodes fail settles nothing either way: detached DOM lives in Oilpan, not the
V8 heap that `JSHeapUsedSize` reports.

Treat it as a red gate to fix after the showing, measurement first.
