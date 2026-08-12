# Lane team2-B10 — adversarial review (window-size sweep, 1024/1280/1440/1600/1920)

Tree: `C:\Users\joshp\Desktop\wt-capability` (branch `packaging/capability-layer`).
No git write commands. No file in the tree was modified by this review; every
probe ran from a scratchpad copy of the sweep tool.

## VERDICT: CONFIRMED

The product claim was reproduced here, by use, on the current tree — not read
off the builder's transcripts.

### 1. The fix is load-bearing, proved by a run-time counterfactual

One app launch, one page, 1024x768, live agent route
`#/agent/this-computer/controller` (the customer state — `src/live-flags.js:37`
makes a MISSING preference mean LIVE, so this is the default a stranger lands in):

| state | wrapper height | `.view` scroll/client | clipped | 12 real wheel notches |
|---|---|---|---|---|
| A rule active | 650px | 650 / 650 | 0 | lowest text 679px below fold → **25px ABOVE** |
| B rule neutralised at run time (`height:auto !important`, same selector) | 1310px | 1310 / 650 | 1 — `div.view` y+660, ink 636px past | **moved 0px, still 636px below** |
| C rule restored | 650px | 650 / 650 | 0 | reached |

B is the pre-fix page recreated without touching the repository, so the repair
is causally attributed to the one rule and to nothing else that moved in this
shared tree.

### 2. The sweep result reproduces

`node tools/window-size-sweep-qa.mjs` (all five widths, sterile/live state,
current tree): **281/286 checks passed, 281.7s**, realized innerWidth exactly
1024/1280/1440/1600/1920, 11 surfaces x 5 sizes. Zero sideways page scroll,
zero past-the-edge, zero clipping. The agent surface ends 25–45px ABOVE the fold
after wheeling at every size. The only 5 failures are the empty `div.chat-log`
the builder disclosed. Zero horizontal scrollers anywhere at any size, so
"wide content scrolls in its own container" really is vacuous, as stated.

### 3. The absence case I attacked, and its answer

At the app's DECLARED MINIMUM window (980x640 — below the swept floor) the
lowest text starts 1085px below the fold, and 10 real wheel notches bring it to
5px above it. The bounded column does not trap content at the smallest window a
person can make. Acquitted.

## DEFECTS FOUND IN THE BUILDER'S OWN WORK (the instrument, not the product)

1. **`tools/window-size-sweep-qa.mjs` reads the ABSENCE of the drill-in door as
   a pass.** If the agent surface cannot be opened, line ~1204 emits a note and
   records no check. Proved by use: the current file, with the door selectors
   renamed in a scratchpad copy, prints **"52/52 checks passed" and EXIT=0**
   with the product's main screen never measured. The builder's own shipped
   artifact `artifacts/b10/before.log` is a completed run of the same shape:
   **"256/256 checks passed"** with "the agent surface was not measured" at all
   five sizes. Same construct for the settings drawer (~line 1173) and for the
   chevron into computers (~line 1181).
2. **The reachability check passes on any movement.**
   `check(..., reached || wheel.moved > 20)` — in the pre-fix state the wheel
   moved 44px with 975px still unreachable, which this check calls ok. The
   defect was caught by the clipping check, not by the check written to answer
   "can a person reach it".
3. **No regression guard.** No test references `src/agent.css`; the sweep tool
   is untracked, lives outside `tools/test/`, and nothing in the repo invokes
   it. The rule's selector depends on a mount shape created in
   `src/views/agent.js`, which is fenced to another lane — if that lane rewraps
   the view, the defect returns silently and every suite stays green.
4. **The before/after full sweeps are not like-for-like.** The agent page's own
   text changed between them (1024 agent: 1924 chars before, 1491 after — my run
   also reads 1491), so another lane's edit landed mid-lane. The paired sweeps
   alone cannot attribute the improvement; the run-time counterfactual above can.
5. **A quoted number is stale**: `artifacts/b10` is 54.7 MB (292 PNGs, 52.9 MB),
   not the 41 MB reported.

## NOT INDEPENDENTLY REPRODUCED

The `--demonstration` (loaded) pass, its 283/283, and the 5px fleet-graph label
clip were not re-run here; only the sterile/live sweep was.
