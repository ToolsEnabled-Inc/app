# TEAM 2 / B1 — the approvals screen drops the outcome of a decision the owner made

Tree: C:\Users\joshp\Desktop\wt-capability (branch packaging/capability-layer)
Territory: src/views/* + copy modules. NOT touched: src/views/agent.js, src/views/account.js,
settings/appearance/checkout-selection write paths, shell/renderer-prefs.cjs, NSIS,
tools/packaged-qa-suite.mjs, tools/{loop,page2,team-panel,owner-popup,agent-subpage} QA drivers.

## The defect, read off the source

src/views/approvals.js submit():

    let result
    try { result = await decideOwnerPrompt(body) }
    catch { result = { ok: false } }
    if (destroyed) return          <-- the answer is thrown away here
    card.submitting = false
    if (result?.ok !== true) { ...say nothing was approved, let him retry... }

`destroyed` is set by the router when it retires the outgoing view. On the
view-transition path (src/main.js swapView, `snapshotted === true`) that happens
IMMEDIATELY at the swap, so ONE press of the forward arrow after pressing
"Submit decisions" is enough. The round trip is a real audited bridge call with a
30s budget (src/mission-bridge.js REQUEST_TIMEOUT_MS), so the window is wide.

Consequence on the owner-consent surface: a refusal — whose entire job is to say
"nothing was recorded, nothing was approved, you can try again" — is dropped, and
is then indistinguishable from the success case, which also says nothing once the
screen is gone. Absence read as consent, on the one screen where consent IS the
product.

## The fix

- NEW `src/approval-outcomes.js` — an in-memory store of decisions whose answer
  came back refused, keyed by prompt id, outliving any one view instance.
  Absence rules: a refusal with no reason still yields a whole sentence; a
  failure naming no prompt is not filed; a reconcile that was NOT given a real
  queue reading prunes nothing.
- `src/views/approvals.js` — the outcome is filed BEFORE `if (destroyed) return`.
  A card mounted with an unfiled-away failure restates it (role=alert,
  aria-live=assertive, `data-decision-undelivered`), keeps the retry controls
  live, and the toolbar count line names it. A confirmed decision clears it.
- `src/views/home.js` + `src/local-activity.js` — home's existing approvals row
  says "N decisions you made were not recorded, so nothing was approved" instead
  of the waiting count when that is the case. ONE row, not a fourth: the
  three-fact cap under the ring is a real cap.
- `tools/approvals-decision-outcome-qa.cjs` — real-Electron driver for the whole
  journey (arrow to #/approvals, approve a line, submit, arrow away, bridge
  refuses while off screen, arrow to home, arrow back).

## Evidence (all runs completed; times read off the runs themselves)

BEFORE — the shipped bundle in `dist/` (verified pre-fix: no `decisionUndelivered`):

    electron tools/approvals-decision-outcome-qa.cjs --app dist --mode refuse
    EXIT=1  9.5s
      viewGoneAfterMs 566 / answerArrivedAfterMs 2532 / recordedByEngine false
      home:      "1 decision waiting for you"
      approvals: "Ready for review. Undecided lines are denied when you submit."
      -> the refusal was dropped; the screen shows no trace that he submitted.

AFTER — same harness, bundle built from this tree:

    electron tools/approvals-decision-outcome-qa.cjs --app <built> --mode refuse
    EXIT=0  11.6s
      viewGoneAfterMs 555 / answerArrivedAfterMs 2508 / recordedByEngine false
      home:      "1 decision you made was not recorded, so nothing was approved"
      approvals: "The decision you submitted was not recorded: The decision
                  record could not be written. This request is still waiting, so
                  nothing was approved. You can decide it again below."
                 role=alert aria-live=assertive data-decision-undelivered=true
                 retry enabled; count line "1 request waiting for your decision.
                 1 decision you submitted was not recorded, so it is still here."

ABSENCE CASE — identical journey, bridge ACCEPTS:

    ... --mode accept   EXIT=0
      recordedByEngine true, 0 cards, "Nothing is waiting for you",
      no "not recorded" text anywhere on the page or on home.

    node --test tools/test/approval-outcomes.test.mjs   12/12 pass  181ms
    npm run verify (ratchet)  1191 tests, 1190 pass, 1 known failure  EXIT=0 114s
    node tools/check-suites-discovered.mjs  93/93  EXIT=0
    node tools/check-product-naming.mjs  EXIT=0

Screenshots: `<scratchpad>/shots-final/{home,approvals}-refuse-white.png`.

## Limits, stated rather than buried

- The record is renderer memory. Close the app between the refusal and the next
  look and it is gone. What keeps that safe is that the notice is only ever
  shown against a request the engine still reports as PENDING, so "nothing was
  approved" is corroborated every time it is displayed.
- Home only carries this on the installed-app surface. In the browser fallback
  home states one fact ("running in a browser") and no approvals row at all —
  pre-existing behaviour, unchanged here.
- The harness is not registered in package.json (shared file) or in
  tools/packaged-qa-suite.mjs (wave-2 fence). Both handed to the coordinator.

---

## ADVERSARIAL REVIEW (second agent, independent re-run) — 2026-08-11

Everything below was measured by me against the tree as it stands, driving the
app; nothing is taken from the builder's report.

### What I reproduced (CONFIRMED)

The `dist/` bundle was rebuilt at 12:18 by TEAM 1's dist chain and now CONTAINS
this fix, so the shipped bundle is the fixed one and I drove it directly.

- `electron tools/approvals-decision-outcome-qa.cjs --app dist --mode refuse`
  EXIT=0, 9.9s. viewGoneAfterMs 566 / answerArrivedAfterMs 2513 / off screen
  true / recordedByEngine false. Home: "1 decision you made was not recorded, so
  nothing was approved". Approvals: full sentence, role=alert,
  aria-live=assertive, data-decision-undelivered=true, retry live, count line
  names it. OWN EYES on home-refuse-white.png: the amber row sits inside the
  ring with the other two facts.
- `--mode accept` EXIT=0. And on my own instrumented probe (which asserts WHICH
  ROUTE each measurement was taken on) the accept journey shows no "not
  recorded" text anywhere, on either screen.
- Retry works: the restated card accepts a second decision, the engine records
  it, the card leaves the queue and the notice clears from approvals AND home.
- `node --test tools/test/approval-outcomes.test.mjs` 12/12, 569ms.
  `node --test tools/test/home-screen.test.mjs` 23/23, 1104ms.
  `check-suites-discovered` 93/93, `check-product-naming` consistent.
- Blast radius is exactly the 8 files claimed. No fenced wave-2 file is touched.

### NEW DEFECT — one empty queue reading permanently erases the notice

`reconcileUndeliveredDecisions([])` treats an empty prompts array as a real
reading and prunes. So a single snapshot that answers `{ok:true, prompts:[]}`
while the request is in fact still pending destroys the record for good.

Driven, 3 runs, identical: refuse the decision off screen, serve ONE empty
snapshot, then serve the prompt again. Back on #/approvals:

    status    "Ready for review. Undecided lines are denied when you submit."
    role=status  aria-live=polite  data-decision-undelivered ABSENT
    countNote "1 request waiting for your decision."
    home      "1 decision waiting for you"  (and, after home re-polls during
              the blip, the GREEN "Nothing is waiting for your approval")

That is byte-for-byte the pre-fix screen. The absence case here is an empty
list, and it is being read as "no decision failed".

### Smaller findings

- `tools/approvals-decision-outcome-qa.cjs --mode accept` passed on the WRONG
  SCREENS in one of two runs I did: its home screenshot was the approvals page
  and its `pageText` was the comms board, `homeFacts` came back `[]`. All four
  accept-mode assertions are negative-existence checks, so they pass vacuously
  when the harness is not where it thinks it is. It needs a route assertion
  (`document.body.dataset.route`) before each measurement.
- `describeHome` clamp: with a known failure but `count` absent/undefined/null,
  `Math.min(1, undefined)` is NaN, the branch falls through and home prints the
  GREEN "Nothing is waiting for your approval". Not reachable from today's only
  caller, but it is an all-clear synthesised from a missing field.
- `node tools/test-ratchet.mjs` in the current tree EXIT=1, 127.7s, 1130 tests /
  2 fail: one REGRESSION in `tools/test/product-account-surface.test.mjs`. That
  is the account-isolation lane's file, not B1's. The builder's quoted
  1191/1190 no longer reproduces because the tree moved under it.
