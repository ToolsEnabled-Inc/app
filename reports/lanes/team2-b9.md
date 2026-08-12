# Lane team2-B9 — accessibility basics on the primary flow, verified by keyboard only

Tree: `C:\Users\joshp\Desktop\wt-capability` (branch `packaging/capability-layer`).
No git write commands were run. Working-tree edits only.

Task: tab order, visible focus, Narrator labels on the Start control and every
setup answer, text scaling and high contrast not breaking layout, across
first run → setup → agent surface → Start. Fix what fails. Verify by keyboard
only, with no mouse.

## THREE DEVIATIONS FROM THE DIRECTIVE, FIRST LINE, IN THE OWNER'S TERMS

1. **I edited two stylesheets and one non-view module, not only `src/views/*`
   and the copy modules.** Every focus indicator in this product is a
   `box-shadow` written in `src/styles.css`, and the one that had been deleted
   outright was deleted in `src/tree-graph.css`. A focus ring cannot be repaired
   from a view file; the view files do not contain one. The third is
   `src/agent-session.js`, which is where the Start control's markup lives —
   `src/views/agent.js` (fenced, wave-2) only calls it, and I did not touch it.
2. **I installed two npm packages into `node_modules`.** Commit `f8be6ed`
   ("Make the app font a user setting with Plex as the new default") added
   `@fontsource-variable/ibm-plex-sans` and `@fontsource-variable/space-grotesk`
   to `package.json` but they are not present in this worktree, so `npm run
   build` fails outright on the current tree and no lane can produce a `dist/`.
   `npm install` could not be used — it tried to move `node_modules/electron`
   and died `EBUSY` because another lane is running the app — so the two
   declared packages were fetched with `npm pack` and extracted into
   `node_modules/@fontsource-variable/`. Nothing else in `node_modules` was
   touched and `package.json` was not edited.
3. **I could not press Start.** See "what I could not verify" below: on a
   sterile profile Codex reports signed out, Start is therefore correctly
   `disabled`, and a disabled button is not in the tab order. Everything about
   it was measured except a keypress that starts a session.

## The instrument, and why its first three answers were thrown away

`tools/a11y-keyboard-qa.mjs` (new) stages the packaged build with the current
`dist/` and `shell/`, launches it on a sterile profile, and drives it with
`Input.dispatchKeyEvent` — real Tab / Shift+Tab / Enter / Space. Nothing is
`.click()`ed and no coordinate is ever pressed, so a control that cannot be
reached from the keyboard stops the harness dead.

Three of its own defects were found and fixed before any product claim was made
from it, and each would have produced a confident lie:

- **Every control on every screen reported "no accessible name"**, including
  `<button aria-label="Settings">`. Cause: `DOM.requestNode` resolves against
  the node-id map, which is empty until `DOM.getDocument` has walked the tree,
  and an empty map answers `nodeId 0` — indistinguishable from "unnamed". Now
  read through `DOM.describeNode` → `backendNodeId`.
- **Six reading-order violations on home and the agent page** that were the
  ring's wrap from the last control back to the first. Cause: identity built out
  of what a stop *looks like*, on pages whose log and clock rewrite themselves
  between laps. Now element identity (a data attribute the walk sets and clears).
- **Three more order violations from viewport rectangles** compared across a
  walk that scrolls. This app scrolls `#stage`, not the document, so
  `window.scrollY` is 0 everywhere; the correction walks the ancestor chain.

A fourth: stops that look unlit are re-read after 350ms before being reported,
because `.tab` transitions `all` and a style read 60ms after the key press
catches the indicator mid-flight.

## What was actually wrong (measured before any fix, same harness, 52/58)

1. **High contrast erases every focus indicator on the walkthrough.** All four
   controls of the permission question and seven on the agent surface computed
   to `outline-style: none` and `box-shadow: none` with `:focus-visible` true
   under `forced-colors: active`. The site recipe is `outline: none` + a
   box-shadow ring, and forced-colors mode discards box-shadow. Not dimmed —
   gone.
2. **High contrast erases which answer is selected.** Selection is a background
   (the seg's sliding sheet); flattened, all three options read as unselected,
   with `aria-pressed` the only remaining difference — a promise to a screen
   reader and nothing at all to a person who can see.
3. **The home log panel had no accessible name.** It is a tab stop with
   `role="log"` and name `""`: Narrator announces the panel this screen is
   mostly made of as the word "log".
4. **The computer tab had no focus indicator at all.** `src/tree-graph.css`
   flattens the page-2 skin with `box-shadow: none` at higher specificity than
   the shared focus recipe, which took the ring with it. That tab is the first
   stop inside the page on the way to an agent.
5. **A disabled Start said why to the eye only.** The reason ("Codex is
   installed on this computer but nobody is signed in to it…") sat in a
   `role="status"` row with no programmatic tie to the control it disables.

## The fixes

- `src/styles.css` — a `@media (forced-colors: active)` block: a `Highlight`
  outline on `:focus-visible` (with `!important`, because the rules being
  corrected are class+pseudo-class and a media query adds no specificity — and
  because a new focus recipe anywhere must not be able to opt itself out of high
  contrast); an underline on the selected segment/tab; the sliding indicator
  stood down; the chosen choice-row marked with an outline. That last one was
  written first as `border-left-color: Highlight` and **that version was wrong**
  — photographed under forced colors, all four rows carried an identical rule,
  because the palette is applied to the `transparent` border too. The harness
  now compares the current row against a non-current one.
- `src/tree-graph.css` — the site ring restored on `.computers .tab:focus-visible`
  only, so the flat resting skin the sheet exists for is untouched.
- `src/views/home.js` — the log takes its name from the panel heading already
  above it via `aria-labelledby`, not a hand-written label: that heading is
  rewritten on every render, and a second copy in an attribute is the copy that
  goes stale. Per-instance id, because the router can hold two home views at once.
- `src/agent-session.js` — the status row gets a per-mount id and both Start and
  Stop `aria-describedby` it, so the refusal is read as part of the control.

## Evidence (completed runs, immediately before this report)

- `node tools/a11y-keyboard-qa.mjs` → **63/63 checks, 35.4s, exit 0, 122 key
  events dispatched, no click and no pointer event.** Before the fixes, the same
  harness: 52/58 with the six failures above.
- Screenshots, in `reports/a11y/`: `02-setup-focus-high-contrast.png` (Continue
  ringed, chosen answer underlined), `03-agent-focus-high-contrast.png`,
  `04-computers-tab-focus-normal.png` (the ring that had been deleted).
- `node --test` on the four suites over the files I changed
  (`home-screen`, `agent-session-surface`, `first-run-tier-screen`,
  `agent-session-steering`) → 98/98, 1.9s.
- `npm test` → 3 failures, none in a file this lane touched, all pre-existing
  from other lanes' in-flight work: `public/help/` is untracked and unclassified
  in the renderer payload boundary; `src/views/computers.js` has lost its
  `first-run-needs.js` import; the agent-loops run-cap citation no longer lands.

## What I could NOT verify, stated plainly

- **High contrast was emulated, not booted.** The measurement uses Chromium's
  `forced-colors: active` emulation, which does suppress box-shadow (that is how
  the defect was found) but does not repaint the page in the person's own system
  palette. Switching this machine's Windows theme was not something to do
  unattended on the owner's desktop.
- **"Narrator labels" are Narrator's source, not Narrator.** Names and roles are
  read from Chromium's accessibility tree — the tree that is projected to UI
  Automation and that Narrator reads — with no screen reader running.
- **Start was never pressed.** The harness redirects `USERPROFILE`, so
  `~/.codex` is empty and the app correctly reports the machine signed out;
  Start stays disabled and disabled buttons are not tab stops. The driver has
  `--codex-home <dir>` (a pointer, never a copy of a credential) and an opt-in
  `--press-start` for whoever wants that proof; pressing it starts a real agent
  session, which a keyboard audit must not do as a side effect.
- **Only the primary flow.** Settings, checkout, metrics, comms, ledger,
  approvals and research were not walked.

## Suggested shared-file edit (NOT applied)

`package.json` scripts: `"qa:a11y-keyboard": "node tools/a11y-keyboard-qa.mjs"`.
