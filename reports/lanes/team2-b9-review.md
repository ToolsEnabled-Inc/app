# team2-b9 — adversarial review (keyboard accessibility on the primary flow)

Reviewer ran everything below itself, against the working tree as found, on
Machine A. No product file was edited by this review. Two harness runs and one
full test run were executed; the harness writes its own artifacts, so
`reports/a11y-keyboard-last-run.json` and `reports/a11y/*.png` were overwritten
by those runs (see "artifact state" at the bottom).

## Verdict: REFUTED — the five fixes are real and reproduce exactly, but
## "done-verified" against the directive does not: the one control the directive
## names by name was never measured, and the harness's own check for it FAILS
## the moment that control is enabled (62/63).

## What reproduced exactly

- `node tools/a11y-keyboard-qa.mjs` on the tree as found: **63/63 in 33.4s,
  exit 0, 122 key events, zero FAIL lines.** Matches the reported 63/63 / 30.5s.
- `node --test` on the five named suites: **109 tests, 109 pass, 0 fail (2.5s).**
- `node tools/check-product-naming.mjs`: exit 0, "Checked 6 published documents
  and 2 paid plans. Consistent."
- `git diff --numstat` on the four product files: 27/3, 71/0, 19/0, 63/3 —
  identical to the reported figures. `tree-graph.css` is LF, so the 19-line
  claim is the real change and not a CRLF artefact.
- Fenced territory: `src/views/agent.js`, `shell/renderer-prefs.cjs`, `build/`,
  `tools/packaged-qa-suite.mjs` and `package.json` are all unmodified in
  `git status`. The `package.json` script addition was correctly left in
  `sharedFileEdits` rather than applied.
- Own eyes, `reports/a11y/02-setup-focus-high-contrast.png`: under emulated
  forced colors Continue carries a Highlight ring, the chosen seg answer is
  underlined, and the chosen choice row carries a Highlight box the other three
  rows do not. `04-computers-tab-focus-normal.png`: the computer tab shows the
  site's double ring.

## REFUTED: the Start control's accessible name was never measured, and fails
## the harness's own bar the moment Start is enabled

The directive names Start explicitly ("Narrator labels on the Start control").
The harness contains exactly that check —

    check('Start announces more than the bare word "Start"',
          (start.ax?.name || '').trim().length > 5, ...)

— but it is inside `if (start)`, and `start` is only found when Start is a tab
stop. On the sterile profile Start is disabled, a disabled button is not a tab
stop, so **the check never ran** in the reported 63/63.

Reproduced with the harness's own opt-in pointer, no credential copied and no
session started:

    node tools/a11y-keyboard-qa.mjs --codex-home <scratch dir containing auth.json>

    start probe: {"missing":false,"disabled":false,"text":"Start", ... ,"status":"agent engine ready"}
    ok    Start is reachable by Tab alone  -- after 14 presses
          Start element: {"text":"Start","aria":"","described":"agent-session-status-1"}
    FAIL  Start announces more than the bare word "Start"  -- ax name = "Start"

    62/63 checks passed in 31.3s

The name is a static string in `src/agent-session.js`
(`<button type="submit" data-session-start aria-describedby=... disabled>Start</button>`),
so this is not an artefact of how the control was enabled: on any signed-in
machine Start's accessible name is the five-character word "Start".

`aria-describedby` was added and does resolve, but it carries the *reason*, not
the *name*. The reported 63/63 is green in the one machine state where the
target control is not measurable at all.

## Absence-case defects found in the builder's own work

1. **The audit function reads an empty screen as a passing screen.**
   `auditStops()` computes `unnamed`/`unlit`/`offscreen` by filtering the stop
   list and asserting `length === 0`. On a screen that renders nothing
   focusable the stop list is empty and all four checks pass, detail "0 stops".
   Reproduced with the predicates lifted verbatim: 4/4 pass on zero stops.
   Setup steps are protected upstream by `until(...)` text gates and by
   `tierStops.length === 3` / `autonomyStops.length === 3` / "Continue is
   reachable" / "Finish setup is reachable". **`home` is not**: it is
   `await delay(1500)` then `tabWalk({limit:40})` then `auditStops('home', ...)`
   with no minimum-stop guard and no text gate. Nor is
   `high contrast: every agent-surface stop still shows a focus outline`
   (`hcAgentReal = []` passes). A home screen that failed to render would be
   reported as accessible.

2. **`a disabled Start says WHY through its own accessible description` passes
   on an empty description.** The check is `tied.resolves`, i.e.
   `targets.length > 0` — the referenced element merely has to *exist*. A
   status row whose `textContent` is `''` satisfies it while telling a screen
   reader nothing. The row's text is read into `says:` and then not asserted on.

3. **The log's accessible name is empty for the whole of home's first paint.**
   `src/views/home.js` renders `<span data-panel-title id="..."></span>` empty
   and `<div class="session-log" tabindex="0" role="log" aria-labelledby="...">`
   pointing at it. `panelTitle.textContent` is only written inside `apply()`,
   and there is no synchronous `apply()` at mount — `homeView()` ends with
   `void loadEngine(); void loadSessions(true); void loadApprovals()` and
   returns. So between mount and the first async resolution the log is a focusable
   live region whose `aria-labelledby` resolves to an element with no text:
   accessible name `""`, which is precisely the defect this change was made to
   fix. The rejected alternative (a hand-written `aria-label`) would not have
   this window. The harness cannot see it because it sleeps 1500ms first.
   NOT driven — established from the markup and the absence of a synchronous
   `apply()`, not observed live.

4. **`.computers .tab:focus-visible` has no fallback for its custom properties.**
   The restored ring is
   `box-shadow: 0 0 0 1.5px rgba(255,255,255, calc(0.95 * var(--wa))), 0 0 0 3.5px var(--focus-ring)`.
   If either token fails to resolve at that element the whole declaration is
   invalid at computed-value time and `box-shadow` falls back to `none` — and
   the shared recipe still supplies `outline: none`, so the indicator is absent
   rather than degraded. That is the same failure mode the fix exists to
   correct. The harness's own comment names this risk; the fix does not guard
   it with `var(--wa, 1)` / `var(--focus-ring, currentColor)`. It resolves today
   in the theme the harness runs in; only one theme was walked.

## Pre-existing absence defect found by use (not this lane's, not fixed here)

`shell/agent-host.cjs` decides sign-in with
`return !fs.existsSync(path.join(codexHome, 'auth.json'))`. A two-byte
`auth.json` containing `{}` — no credential of any kind — was enough to make the
product report "agent engine ready" and render **Start enabled**. Presence of a
file read as permission. Reproduced above; that is how the enabled Start was
measured.

## Numbers checked

- `npm test` did **not** reproduce as reported. Reported: "855 tests, 3
  failures". Measured now, completed run, 219.7s: **1548 tests, 1538 pass,
  9 fail, 1 skipped.** The three reported failures are all still there
  (#41 agent-loops citation, #337 renderer payload boundary, #514
  `first-run-needs.test.mjs:164` naming `src/views/computers.js`), plus six
  more that landed since: #1041 `refusal-copy.test.mjs:350` (names
  `src/mission-bridge.js`, `src/write-surfaces.js`, `src/views/computers.js`),
  #1238, #1408, #1410, #1500, #1502. The tree is moving under six lanes, so the
  drift is explainable rather than dishonest — and the substantive claim still
  holds: **none of the nine names `src/views/home.js`, `src/agent-session.js`,
  `src/styles.css` or `src/tree-graph.css`.** The count does not describe this
  tree any more; the conclusion drawn from it does.

## Coverage the report states and the reviewer confirms is real

Emulated forced-colors, not a booted Windows High Contrast theme; only the
primary flow walked; Start never pressed. All three are in `unresolved` and all
three are accurate.

## Artifact state after this review

`reports/a11y-keyboard-last-run.json` and `reports/a11y/*.png` were rewritten by
the reviewer's runs. The JSON currently holds the **62/63** `--codex-home` run
(the one containing the Start-label FAIL), not the 63/63 default run. Re-run
`node tools/a11y-keyboard-qa.mjs` with no arguments to restore it.
