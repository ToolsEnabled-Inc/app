# Lane team2-B10 — window-size sweep of the primary routes at 1024/1280/1440/1600/1920

Tree: `C:\Users\joshp\Desktop\wt-capability` (branch `packaging/capability-layer`).
No git write commands were run. Working-tree edits only.

Task: sweep the primary routes at 1024, 1280, 1440, 1600 and 1920 — nothing
clipped, no horizontal page scroll, no empty regions where content should be,
wide content scrolls inside its own container. Fix what breaks, before/after
evidence per size.

## DEVIATION FROM THE DIRECTIVE, FIRST LINE, IN YOUR TERMS

You scoped me to the screens — `src/views/*` and the copy modules. **The one
real defect this sweep found could not be repaired there, so I edited
`src/agent.css` instead: one rule, twenty-eight lines of it comment.** The
element with the missing height is created in `src/views/agent.js`, which is
fenced to a wave-2 lane, so the height is restored from the stylesheet rather
than by giving that element a class of its own. `src/agent.css` is not in
wave 2's fenced set and no lane has it modified.

## WHAT WAS ACTUALLY BROKEN, IN ONE SENTENCE

**On the agent page — the screen the product exists for — a customer could not
reach the bottom half of the page at ANY of the five widths, and only in the
state a customer is actually in.** At 1024x768 the lowest text on the page ("No
session started from this app is running for this agent") sat 1019px below the
bottom of the view, inside a box with `overflow: hidden`, and twelve real
mouse-wheel notches over the middle of the window moved it 44px and left it
975px out of reach. Start an agent, the prompt box, the session controls, the
Codex Cloud launcher: all of it, gone, with no scrollbar to say so.

It is a HEIGHT defect, so a wider window does not help. Measured on the live
agent route, `div.view` (`overflow: hidden`), before the fix:

| window | view content | view box | hidden | ink past the fold |
|---|---|---|---|---|
| 1024x768 | 1650 | 650 | 1000px | **1019px** |
| 1280x800 | 1614 | 682 | 932px | **950px** |
| 1440x900 | 1614 | 782 | 832px | **850px** |
| 1600x1000 | 1732 | 882 | 850px | **805px** |
| 1920x1080 | 1732 | 962 | 770px | **725px** |

**Why nobody had seen it.** `.agentv` is a bounded flex column whose panels
carry their own scrollers — `src/agent.css` already carries a comment saying so,
and a previous lane bounded the roster on exactly that assumption after the
owner reported "CHAT and CONTROLS cut off" at 1280x800. That assumption holds on
the demonstration and `/example` routes, where `agentView()` returns the built
page and it is mounted straight into `.view`. It does not hold on the LIVE
route: `agentView()` returns a `<div class="data-live-mode">` wrapper first and
swaps the built page into it when the projection resolves. `.agentv`'s
`height: 100%` then resolves against a parent with an indefinite height, falls
back to auto, and the column grows to its content instead of to the window.
**The demonstration path is the one QA looks at, and it is the one that works.**
This is the same shape as this codebase's signature defect: a state nobody
measured, passing because it was never the state under test.

The fix (`src/agent.css`):

```css
body[data-route="agent"] #stage > .view > .data-live-mode {
  height: 100%;
  min-height: 0;
}
```

Route-scoped, because `.data-live-mode` is a generic class the comms page also
uses. Before: `.view` scrollHeight 1650 against clientHeight 650. After:
scrollHeight 650 = clientHeight, nothing hidden, the page scrolls.

## The instrument, and why it can be trusted

`tools/window-size-sweep-qa.mjs` (new). It stages a packaged copy of the app
with the CURRENT `dist/` and `shell/`, launches it on a sterile profile,
completes first-run setup by pressing the controls a person presses, then for
each size **resizes the real window** and walks the ring with the chevron.
Nothing assigns `location.hash`; the file audits itself for that at startup.

**The window is really that size.** Electron does not implement CDP's
`Browser.setWindowBounds` (it answers "'Browser.getWindowForTarget' wasn't
found"), so the resize is a Win32 `SetWindowPos` on the app's own top-level
window — the call the window manager makes when you drag a window edge. The
size is calibrated against `devicePixelRatio` and the realized viewport is
printed for every size. All five landed exactly:

| asked | window rect (physical px) | web contents |
|---|---|---|
| 1024x768 | 1426x1064 | **1024x768** |
| 1280x800 | 1778x1108 | **1280x800** |
| 1440x900 | 1998x1246 | **1440x900** |
| 1600x1000 | 2218x1384 | **1600x1000** |
| 1920x1080 | 2658x1493 | **1920x1080** |

`Emulation.setDeviceMetricsOverride` was deliberately NOT used: it changes what
the renderer believes about the viewport and leaves the window alone, so a
defect in how the shell sizes its web contents would be invisible to it by
construction — and the defect above lives exactly there.

**Two data states, because an empty product cannot clip.** On a sterile profile
every screen is an empty state. So the sweep runs twice: once as a stranger
first sees it (which is also the LIVE data path), and once with the six
per-view sources switched to the built-in demonstration **by pressing the six
toggles a person presses** (Settings → Data & Sim → "<page> live data"). Only
the second has a fleet graph with nodes, charts with series, ledger rows and a
comms board with messages. **The defect above is only visible in the first.**

**Surfaces per size (11):** home, computers, metrics, research, comms, ledger,
approvals, settings, home again (fresh mount), the settings drawer open, and
the agent surface reached by drilling in.

**"Can a person reach it" is answered with a wheel, not with `scrollTop`.** A
box with `overflow: hidden` is scrollable from JavaScript and not from a wheel,
a trackpad or a scrollbar, so `scrollHeight > clientHeight` does not settle
whether content is lost. Where something looks cut off the harness dispatches
twelve real `Input.dispatchMouseEvent` wheel notches over the middle of the
window and re-measures where the lowest glyph is. That is how the 44px number
above was obtained.

## The results

| | empty product (live data path) | loaded (demonstration) |
|---|---|---|
| horizontal page scroll (document / body / `#stage` / `.view` / `.view-pad`) | 0 at all 5 sizes | 0 at all 5 sizes |
| elements past the window edge with nothing able to scroll to them | 0 | 0 |
| empty regions (>=24000px^2, no text, no graphic, no control) | **1, see below** | 0 |
| glyphs, images or canvases lost to a clip | **the agent page, all 5 sizes → fixed** | 0 |
| containers that scroll horizontally | 0 | 0 |

Run totals, off completed runs:

| run | data state | result |
|---|---|---|
| `final-loaded` (before) | demonstration | **283/283** |
| `final-empty` (before) | live / empty | **271/281** — the 10 failures are 5 sizes x (agent clipped + agent empty chat log) |
| `after-loaded` | demonstration | **283/283** — no regression from the fix |
| `after-empty` | live / empty | **276/281** — every clipping failure gone at all 5 sizes; the 5 that remain are the empty `.chat-log`, which is not a window-size defect (below) |

**The fix, proved by use rather than by arithmetic.** Same route, same window,
same twelve mouse-wheel notches over the middle of the screen at 1024x768:

| | lowest text starts | after 12 wheel notches | reachable? |
|---|---|---|---|
| before | 1019px below the fold | moved 44px, still **975px** below | **no** |
| after | 679px below the fold | moved 704px, now **25px above** it | **yes** |

**"Wide content scrolls inside its own container" is satisfied vacuously, not by
a working scroller.** There is no horizontally scrolling container anywhere in
this product at any of the five sizes — and nothing that needs one, because
every wide surface reflows instead: the ledger's row grid drops columns at
930px and 680px, the metrics tile row goes 6-across to 3-across at 1100px, the
computers page drops its statistics rail below the graph at 1080px. That is the
better answer to the requirement, but it is a different answer, so it is stated
rather than ticked.

**Dead right margin, per route, measured** (gap between the rightmost thing with
words in it and the right edge of the window):

| width | home | computers | metrics | ledger | approvals | settings |
|---|---|---|---|---|---|---|
| 1024 | 67 | 41 | 24 | 24 | 104 | 24 |
| 1280 | 101 | 41 | 24 | 24 | 108 | 24 |
| 1440 | 148 | 41 | 104 | 104 | 188 | 104 |
| 1600 | 230 | 41 | 184 | 184 | 268 | 184 |
| 1920 | 390 | 145 | 344 | 344 | 428 | 344 |

They grow with the window because the content column is capped
(`--page-max: 1240px`, `1680px` on computers). That is a reading-measure
decision, not a hole: margin on both sides, not an empty panel. The numbers are
here so the judgement can be disputed with data.

## Two findings I did NOT fix, and why

1. **`div.chat-log`, 466x125 of nothing, on the agent surface.** The transcript
   box renders empty with no placeholder line — a blank rectangle above a
   "Message Controller…" input. It is identical at all five widths, so it is not
   a window-size defect; and its markup is `src/components.js`, mounted by the
   agent surface, which is fenced this wave. Reported, not touched.
2. **The fleet graph's outermost node label is clipped by 5px at 1024** (loaded
   state only). `div.graph-wrap` is `overflow: hidden` and the rightmost
   `.node-labels` box reaches 6px past it. **No letter is lost:** measured with
   Range rectangles over the glyphs, ink reaches 0px past the clip. What is cut
   is 4px of padding and a background that is `var(--sheet)` — the same colour
   as the panel underneath. Root cause for later: `src/tree-layout.js` reserves
   a constant edge margin (`RANK_EDGE = 24`) while `.node-labels` is centred on
   the node and up to `min(--d + 118px, --nn-max)` wide, so half a label can
   exceed the reserve. Widening the reserve pushes every outermost node inward
   and shrinks the graph at the width where it is already tightest — a visible
   cost to hide an invisible one. Say the word and it is one constant plus a
   test.

## Five false alarms the instrument produced, and what each would have cost

Each was reported as a defect by an earlier version of this harness. None is a
defect. The difference between them and the agent finding is the whole value of
this lane, so they are listed rather than quietly deleted.

1. **"Content cut off" on ledger, approvals and settings at every size** —
   `h1.ledger-sr-only`, `span.settings-sr-only`: 1x1 boxes with their content
   clipped away. That is the visually-hidden recipe; the text reaches a screen
   reader perfectly. Recognised now by the recipe (a <=1.5px box,
   `clip-path: inset(50%)`, `clip: rect(0 …)`), not by class name.
2. **"An empty region 520px square" on home, 983x559 on computers** — the uptime
   ring and the fleet graph. SVG elements report a LOWERCASE `tagName` while
   HTML elements report uppercase, so an uppercase allow-list misses every
   graphic in the product. This one alone accounted for 15 reported defects.
3. **"An empty region 909x81" on comms** — `i.cmsg-bar`, the painted role bar
   beside a message. An element that paints a bar is a graphic, not a hole.
   "Paints nothing and contains nothing" and "paints something and contains
   nothing" are now separate, and only the first is a defect.
4. **"1087px of the metrics page cut off" at every size** — `div.view` really
   does have 1087px of hidden overflow, and the thing overflowing is an ECharts
   `div.tooltip` parked below the fold at zero opacity. The harness now names
   the descendant that defines an overflow and says whether a person could see
   it.
5. **"1019px of the agent page cut off" — attributed to the wrong element.** The
   first attempt blamed `div.agentv-panels`, which is `position: absolute`
   inside a `position: relative` wrap inside the scrolling `.view-pad`. A scroll
   box only clips what it is the containing block of, and the wrap IS its
   containing block, so that attribution was wrong even though the page really
   was clipped. Chasing it would have produced a layout change to a working
   part of the page while leaving the actual cause — a wrapper with no height —
   in place.

Two more were defects in the harness that would have invented clean results:
PowerShell variable names are case-insensitive, so `foreach ($h in $handles)`
assigned to the same variable as the `-H` height parameter and every
`SetWindowPos` was called with a window handle as its height — Windows obliged
with a window 65535 physical pixels tall and the viewport of THAT was measured
five times. And the window was picked by area, so when a second top-level frame
appeared mid-sweep the resize switched to it; on this machine, with three other
lanes running their own staged copies, that could have resized another lane's
window. The search is now fenced to processes whose image lives under this run's
own staged directory.

## What I could NOT verify

- **Below 1024.** The application declares a minimum window width of 980 CSS px
  (`shell/window-state.cjs`, `DEFAULT_MIN_WIDTH`) and Windows enforces it: the
  window cannot be made narrower. 1024 is 44px above the floor.
- **A second display.** Both panels on this machine run at 137.5% while the
  system DPI is 125%. Moving the window between them crosses a DPI boundary and
  Chromium answered a cross-process resize during that transition with a window
  65535px tall, so the whole sweep is done in place on one display. A person who
  drags this window between two differently scaled monitors is not covered here.
- **A running agent session.** Every measurement of the agent surface is of it
  with no session started (a sterile profile reports Codex signed out). A live
  transcript is longer than an empty one and could reach further.

## Evidence

- `tools/window-size-sweep-qa.mjs` — the harness (new file).
- `src/agent.css` — the one product change.
- `artifacts/b10/final-empty.log` / `.json` — before, empty/live state: the 10
  agent failures at 5 sizes.
- `artifacts/b10/final-loaded.log` / `.json` — before, loaded state: 283/283.
- `artifacts/b10/agent-before.json`, `agent-after.json`,
  `agent-after-wheel.json` — the same route at 1024 either side of the fix,
  including the mouse-wheel reach test.
- `artifacts/b10/after-empty.*` (276/281), `after-loaded.*` (283/283) — the
  five-size re-runs after the fix.
- `artifacts/b10/before2-demo/*` — the loaded-state screenshots the fleet-graph
  label finding is read off.
- Screenshots one per route per size under the matching directories. The two
  earliest screenshot sets (`before/`, `before-demo/`) were deleted to keep this
  directory under 41MB; their `.log` and `.json` measurements are kept in full.

Gates run after the change, on the current tree:

- `node tools/check-suites-discovered.mjs` — passes, 108/108.
- `node tools/check-product-naming.mjs` — passes.
- `npm run build` — passes, 10.8s, and the rule is in the shipped bundle:
  `body[data-route=agent] #stage>.view>.data-live-mode{height:100%;min-height:0}`.
- `npm run test:data` — **1560 pass, 8 fail, 360s.** None of the eight is mine
  and I proved it rather than asserting it: I removed my rule, ran the five
  suites that own those tests, and got the same seven failures (the eighth is
  the renderer-payload boundary, below), then restored `src/agent.css`
  byte-identical. All five of those suite files are other lanes' in-flight work
  (`agent-loops`, `first-run-needs`, `refusal-copy`, `terminate-ui`,
  `write-outcomes`) and none of them reads a stylesheet.
- `node tools/check-renderer-payload.mjs` — FAILS on
  `public/help/getting-started.html`, which is untracked, is not mine, and was
  already failing before this lane touched anything. Flagged so the coordinator
  does not attribute it here.
