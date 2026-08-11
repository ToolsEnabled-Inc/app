# Lane: page2-full-view (session 6e870ec4)

Owner's words: "I think the full view pg2 looked like it might need work still."

Tree: `C:\Users\joshp\Desktop\wt-capability` (branch `packaging/capability-layer`).
Territory: `src/tree-layout.js`, `src/tree-graph.js`, the page-2 blocks of
`src/styles.css`, `tools/test/tree-layout.test.mjs`, `tools/page2-qa.cjs`.
NOT touched: `src/views/computers.js` (no edit was needed), `src/views/agent.js`,
`src/views/approvals.js`, settings/appearance/checkout write paths,
`shell/renderer-prefs.cjs`, NSIS, `tools/packaged-qa-suite.mjs`,
`tools/test-ratchet.mjs`, `src/lib/*`, any Google-OAuth path.

## Reading of the directive

"Full view" on page 2 is the maximised tree — the `#/computers` canvas at real
window sizes. The button literally captioned "Open full view" leads to
`#/agent/...` (`src/views/agent.js`), which is fenced to another wave, so it was
read, not touched.

## What was measured BEFORE any change

Drove `dist/` through `tools/page2-shoot.cjs` — the shooter that serves the
build exactly as the shell does — across black/tan/white at 1024, 1280, 1440,
1600, 1920, in both the simulated fleet and the shipping empty state. 30 shots,
`probe.json` per sweep.

| width | canvas | node overlaps | monitors placed |
|---|---|---|---|
| 1024x768 | 985 x 339 | **6** | 0 / 9 |
| 1280x800 | 827 x 646 | 0 | 2 / 9 |
| 1440x900 | **827** x 745 | 0 | 2 / 9 |
| 1600x900 | **827** x 745 | 0 | 2 / 9 |
| 1920x1080 | **827** x 926 | 0 | 5 / 9 |

Four defects, all seen with my own eyes in the shots before they were named:

1. **The full view was width-frozen.** The canvas is 827px wide at 1280 and
   still 827px at 1920 — the page column is capped at the global 1240px token.
   At 1920 that leaves 342px of bare sheet down each side and withholds 4 of
   the 9 monitoring blocks for want of room to seat them.
2. **1024x768 draws the tiers through each other.** 339px of canvas, three
   tiers, an 85px row pitch carrying 114px of circle: six overlapping pairs and
   three agent names painted underneath a neighbouring bubble.
3. **Clicking a monitoring block on the tree did nothing visible.** Verified by
   OS-level pointer input, not a synthetic click, at 1360x700 and 1024x700 on
   every node tried: the chat is built and the whole block is then left at
   `opacity: 0; visibility: hidden; pointer-events: none`. A 360x368 panel does
   not fit the "immediately beside the circle" rule the 126px collapsed block
   is placed by, so slot election returned nothing and the block was withheld.
   The page's own driver could not catch it — `check('context chip opens
   chat', true)` is a literal that cannot fail.
4. **The shipping empty state was two voids.** `public/data/fleet.json` ships
   `ok:false`, so this is what a fresh install renders. At 1920x1080 it was an
   860x980 card holding three sentences beside a 400x980 card holding two.

## What changed

- `src/tree-layout.js`
  - **Vertical fitter.** The horizontal axis had pack → cull → drill; the
    vertical axis had nothing. Circles now shrink together (roles stay in
    proportion) to clear the row pitch, floored at the same 34px the packer
    calls readable, and the chosen radii are returned so the canvas can draw
    what was packed.
  - **A rank under ONE parent is packed under it.** `groups.length < 2` sent
    the commonest shape there is — one coordinator, four managers — to the
    even-spread fallback the grouped packer exists to prevent. Widening the
    canvas would have smeared that rank across it.
  - **Sibling air is earned, not constant.** The largest air up to 68px that
    the rank can afford, with the between-groups gap holding a 3.5x ratio to
    it, so "tight siblings, wide gap between families" survives every width.
- `src/tree-graph.js`
  - applies the returned radii to `record.r` and the drawn `--d` (recomputed
    from role each layout, so a window that grows gives the size back).
  - **an open chat is never withheld** — `_forcedChatSlot` gives it a definite
    seat on the roomier side of its node, clamped inside the canvas.
  - placement uses the chat's target height (`record.chatHeight`) instead of
    an `offsetHeight` read mid-transition.
- `src/styles.css` (page-2-scoped only; another lane is editing this file)
  - `body[data-route="computers"] { --page-max: 1680px }` — the token is
    redefined on the route, so the topbar travels with the page edge and no
    other surface moves. The rail stays capped at 400px; every extra pixel
    goes to the canvas.
  - `.comp-body { min-height: 520px }` + `.computers { overflow-y: auto }` —
    a window can be dragged shorter than the tree needs at any width.
  - stacked-breakpoint graph row `minmax(340px)` → `minmax(560px)`.
  - empty state gets a `min(52vh, 460px)` band, `align-content: center`.
- `tools/page2-qa.cjs` — the vacuous chat check now asserts the chat is on
  screen, inside the canvas, pointer-reachable and still wearing its 2 braces.
- `tools/test/tree-layout.test.mjs` — three tests added: single-parent rank
  packing, short-canvas shrink-and-restore, and the absence case (no nodes, no
  argument at all, one lone node).

**Braces kept.** The owner named the page-2 tree chatboxes as one of two places
braces survive. Counted at every step of a resize ladder and after opening a
chat: 18 (9 blocks x 2) / 20 (10 x 2), never fewer, `openChatBraces = 2`.

## Verified BY USE and BY EYE (this tree, freshly built dist)

- 30-shot sweep, 3 themes x 5 widths x 2 modes: **node overlaps 0 everywhere**
  (was 6 at 1024). Canvas 837 / 989 / 1157 / **1256** at 1280 / 1440 / 1600 /
  1920 (was 827 at all four). Monitors placed 2 → 6 at 1920.
- `tools/page2-qa.cjs`: **38/38 pass**, including the strengthened chat check
  (`opacity 1, visibility visible, pointerEvents auto, 360x368, insideCanvas
  true, braces 2`).
- One window driven through a resize ladder 1360 → 980 → 1360 → 1100 → 1360:
  radii return to 62/39 every time, `drawn == layout` at every stop, 0 overlaps
  at every stop (1102x381 was 6 before the min-height).
- Real OS-level click on a monitoring block at 1920x1000, 1360x700, 1024x700,
  tan and black: chat visible and readable every time.
- Empty state probed at 1024/1440/1920: explanation intact, "See an example
  agent" href intact, rail keeps the sentence
  `tools/agent-route-reachability.mjs` reads, Edit button `disabled: true`
  carrying its full reason.
- `node --test tools/test/tree-layout.test.mjs`: 7/7.

## Not mine, seen in passing

`npm run test` = 1229/1232 with 2 failures, both pre-existing in this shared
tree and in files this lane never opened:
`tools/test/electron-run-as-node-harness-guard.test.mjs` (points at
`shell/main.cjs`) and `tools/test/shell-port-scan-contract.test.mjs`.

## Known limit, stated rather than hidden

The layout's radius floor is 34px. Below roughly 300px of canvas height a
three-tier tree cannot clear itself even at the floor; the honest answer there
is height, which is why the page now asks for 520px and scrolls for the rest
rather than stacking circles.
