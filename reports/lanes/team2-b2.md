# TEAM 2 / B2 — every `if (destroyed)` site in src/, swept

Tree: `C:\Users\joshp\Desktop\wt-capability` (branch `packaging/capability-layer`).
No git write commands were run. Working-tree edits only.

## THE COUNT IS NOT 49

`grep -rn "if (destroyed)" src/ | wc -l` = **60** in the tree as it stands. Two of
those are prose inside comments (`src/approval-outcomes.js:11`,
`src/views/approvals.js:42`), both written by B1 describing the defect. So there
are **58 real guard sites**, not 49; the tree grew since the task was written.
Every one of the 58 is classified below. Nothing is "assumed like its neighbour".

**Census: 50 safe, 8 were losing a real outcome. All 8 are fixed.**
The one fenced site (`src/views/agent.js:191`, wave-2) was read rather than
edited, and it turns out to need no edit: it guards a READ.

## What "losing a real outcome" means, and what it does not

The defect B1 measured is: something was SPENT — a process started, a record
written, a file moved, a remote task created — and then the answer to it was
dropped because `if (destroyed) return` sat above the line that reads the
result. `destroyed` means this instance has no DOM left to write into. It says
nothing about whether the thing happened.

A guard is **safe** when one of these is true, and each entry below says which:

- **paint-only** — the code after it only repaints; nothing was written.
- **read-only** — the awaited call was a read (status, availability, a snapshot,
  a catalog, a history list). A dropped read costs nothing: the next mount reads
  it again.
- **prevents-work** — the guard stops a write from being STARTED. That is the
  opposite of the defect and is kept.
- **compensating** — the write happened and the guard undoes it (or reports it
  through a return value the caller receives).
- **state-authoritative** — a real write, but the shell/engine holds the result
  and the next mount re-reads it, so the outcome is re-derivable rather than
  lost. Only the transient sentence goes.

---

## THE EIGHT THAT WERE LOSING AN OUTCOME

| # | site | what had already been spent |
|---|---|---|
| 1 | `src/cloud-tasks-controller.js:374` `confirm()` | a **Codex Cloud launch** — real, billable, remote work the product's own copy says "cannot be cancelled once it is accepted". Dropped with it: the **task id**, the only handle on work being paid for; and the UNKNOWN branch's "a task may or may not have been created — refresh the list before trying again rather than launching a second time", whose loss is how one press becomes two real cloud tasks. |
| 2 | `src/mission-bridge.js:446` `execute()` | `ledger-archive` with **dryRun:false** — owner requests actually moved between two durable ledgers. "Archive verified for R54, R241" and "the result did not match the confirmed preview, preview again before any retry" both came out as silence. |
| 3 | `src/agent-loops.js:424` `stop()` | a **terminate sent at a real PID**. Its receipt is the only thing separating "PID is gone, with its process tree" from "**was NOT confirmed stopped** … it is still bounded". Absence read as the reassuring one. |
| 4 | `src/agent-teams.js:253` `run()` | the **lead lane's dispatch receipt**, carrying the launch id every member is nested under. A started lane nobody is told about keeps running. |
| 5 | `src/agent-teams.js:274` `run()` | the same, per **member** lane. |
| 6 | `src/write-surfaces.js:163` dispatch form | `postBridgeAction('dispatch')` — a real audited agent lane; `confirmed · <launchId>` dropped. |
| 7 | `src/write-surfaces.js:238` decision form | `postBridgeAction('decision')` — a **durable decision record** at a named revision. |
| 8 | `src/write-surfaces.js:258` queue form | `postBridgeAction('queue')` — a **BUILD-QUEUE phase claimed or closed**, strictly against an observed hash. |

### The fix

- **NEW `src/write-outcomes.js`** — the generalisation of B1's
  `src/approval-outcomes.js`: a module-level store of write outcomes that reached
  no screen, keyed per surface, outliving any view or controller instance.
  Absence rules, all tested: no usable key **or** no usable message ⇒ **not
  filed** (an entry nothing can attribute is an entry nothing can clear); a
  missing or unrecognised tone reads as **refused**, never confirmed; only a
  **delivered** later outcome on the same surface supersedes an earlier missed
  one — nothing is pruned on the strength of a reading that did not happen.
- Each of the eight fixed sites now ends in a `settle…` helper that **always**
  updates its own state, paints only when there is a panel, and files the
  sentence when there is not. The `if (destroyed)` that dropped the answer is
  gone; where a guard was genuinely preventing further work (a status watch, an
  extra bridge read, the next member dispatch) it is **kept**, moved below the
  point where the outcome is recorded.
- The surface restates it **the next time it is built**, on itself: the cloud
  panel's launch line, the archive control's message, the loop and team panel
  messages, and a dedicated `.write-restated` line on each audited form. It is
  prefixed "While you were on another screen: " so it can never be mistaken for
  news from now.
- The restated line on the audited forms is its **own node**, not the form's
  `<output>`. The output is rewritten by the bridge handshake and by
  `configureQueueSnapshots` a fraction of a second after mount; a restatement put
  there would have been erased by a race. The QA run below proves that directly.

### Deliberate limits, stated rather than buried

- **Renderer memory, not durable.** Close the window between the missed outcome
  and the next look and it is gone. Restart-durability would mean writing this
  into preference storage, which is a wave-2 write path and not this lane's.
- **Superseded, not acknowledged.** A missed outcome is cleared by the next
  outcome the person actually sees on that surface. It is not cleared by merely
  being rendered, and there is no dismiss control.
- Team dispatch files **one summary per run**, not one per lane. The summary
  names the lead launch id and counts started/refused/never-dispatched.

---

## THE 50 THAT ARE SAFE, EACH WITH ITS REASON

**src/agent-teams.js** — 271 `prevents-work`: stops the loop dispatching ANOTHER
member. Kept; the run now still reports what did start.

**src/agent-session.js** (4) — 386 `read-only` (availability). 458
`compensating`: the child process was started, and this branch calls
`closeSession()` and returns `AGENT_SESSION_VIEW_CLOSED` — the write is undone,
not dropped. 500 `paint-only`: `closeSession()` already ran; only "stopped ·
session closed" is skipped, and the session registry is authoritative on the next
mount. 545 `compensating`: `respawn()` returns `{ok:false,
code:'AGENT_SESSION_VIEW_CLOSED'}` — the outcome is handed to the caller.

**src/agent-loops.js** (2) — 370 `prevents-work` (a destroyed controller never
starts a stop; `destroy()` clears the timer itself). 379 `prevents-work`: after
the observe READ, before any terminate is sent.

**src/cloud-tasks-controller.js** (4) — 244 `read-only` (cloud-accounts). 282
`read-only` (cloud-tasks). 444 `prevents-work` (entry guard on the status check).
486 `paint-only` (`disarm()` already cleared the arming).

**src/mission-bridge.js** (1) — 412 `read-only`: the preview is `dryRun:true`,
nothing moved.

**src/owner-popup.js** (1) — 643 `read-only` (snapshot poll).

**src/write-surfaces.js** (3) — 149 and 224 `paint-only`: DOM cleanup, removing
the surface if the view went while `prepareSurface` was in flight. 183
`read-only`: `report-read` is a bounded file read; nothing was written.

**src/views/account.js** (7) — 95 `paint-only`. 126, 148, 154, 159 `read-only`
(account state, Google availability, belongings, history). 199 and 326
`state-authoritative`: create / sign-in / change-password / Google sign-in are
real writes, but the shell holds who is signed in and `refresh()` re-reads it on
the next mount, so the outcome is re-derivable; a refused change-password leaves
you signed IN, a successful one signs every session OUT. Only the sentence is
lost. `clearPasswords()` being skipped is covered: `destroy()` calls it.

**src/views/setup.js** (9) — 384, 396, 419, 425, 797, 819 `read-only`. 414 and
459 `state-authoritative` (the same account writes as above). 837
`prevents-work`, and unreachable in practice: `dialog.showOpenDialog(win, …)` in
`shell/main.cjs:1748` is parented to the window, so no input can reach the
renderer to navigate away while the folder picker is up; the only way to reach
this guard is window teardown, when there is no surface to lose anything to.

**src/views/agent.js** (1) — 191 `read-only`. **This is the one fenced file**
(wave-2), so it was read and not edited. It guards
`agentsProjection().then(…)` — `fetchAgents()` with the organisation store as a
fallback — which is a READ. Nothing is written on that path, so no edit is
needed there today, and none was made.

**src/views/computers.js** (2) — 546 `read-only`, and it still `return next` so
the caller gets the reading. 1777 `read-only` (agent history).

**src/views/research.js** (1) — 331 `read-only`.
**src/views/metrics.js** (1) — 1927 `read-only`.
**src/views/comms.js** (1) — 1065 `paint-only`.

**src/views/home.js** (5) — 731, 774, 787, 799 `read-only` (status, history,
availability, owner-prompt snapshot). 837 `paint-only` (settings-changed
handler).

**src/views/checkout.js** (3) — 1059 `paint-only` (store-change repaint). 1070
and 1079 `read-only` (catalog load, failed and succeeded). None of the three is
on the checkout-selection write path.

**src/views/approvals.js** (4) — 218 and 227 already fixed by B1: the outcome is
filed before the guard. 243 `state-authoritative`:
`markOwnerPromptPresented` is recorded by the engine and `confirmPresented`
runs again on the next mount. 340 `read-only` (poll).

That is 1 + 4 + 2 + 4 + 1 + 1 + 3 + 7 + 9 + 1 + 2 + 1 + 1 + 1 + 5 + 3 + 4 = **50**,
and 50 + 8 = 58, the whole set.

---

## Adjacent, reported rather than edited

- **`src/owner-popup.js:510`** — NOT an `if (destroyed)` site, so outside the
  literal sweep, but it is the same defect: `submit()` awaits
  `submitDecision(body)` — the audited owner-prompt decision — and then reads
  `if (current !== session) return`, dropping the refusal exactly the way
  approvals used to. Different guard, same shape, and the popup is the owner
  consent surface. Reported rather than edited: the owner-popup QA driver is a
  wave-2 lane and this is its behaviour.

## Evidence (completed runs, read off the runs themselves, immediately before reporting)

    node --test tools/test/write-outcomes.test.mjs         20/20 pass  EXIT=0    191ms
    node --test --test-concurrency=1 (8 affected suites)  117/117 pass EXIT=0   2106ms
      cloud-launch-binding, agent-teams, agent-loops, ledger-archive-ui,
      mission-bridge, approval-outcomes, approvals-screen, home-screen
    node tools/check-suites-discovered.mjs                 96/96       EXIT=0    108ms
    node tools/check-product-naming.mjs                                EXIT=0
    electron tools/write-outcome-restate-qa.cjs            11/11 ok    EXIT=0   4142ms

The Electron run is the by-use half: a real Chromium, importing
`src/write-surfaces.js` and `src/write-outcomes.js` from the tree and linking
`src/styles.css` unmodified, mounts the real audited-ledger surface, misses an
outcome, rebuilds the surface, and reads the glass — the line is present,
`data-undelivered-outcome`, `role=status`, 562px wide, visible, red
(`rgb(218,30,40)` = `--s-serious`), and still there 4s later after the bridge
handshake and the queue snapshot have both written to the panel. The absence
case in the same run: an empty store renders no such line at all. Own eyes on
`ledger-write-surface-restated.png`.

Not proven by use: the four DOM-free controller journeys. They are driven end to
end in `tools/test/write-outcomes.test.mjs` — send, tear the instance down while
the answer is in flight, build a fresh instance, assert the answer is still
there — but through `node --test`, not by clicking the packaged app. Doing that
for the cloud launch would spend real provider budget, and rebuilding `dist/`
would collide with TEAM 1's live dist chain.

## Pre-existing failure, NOT mine

`node tools/test-ratchet.mjs` EXIT=1, 94.7s, 1252 tests / 1250 pass / 2 fail. One
is the ratchet baseline's known failure. The other is a REGRESSION the ratchet
attributes to `tools/test/electron-run-as-node-harness-guard.test.mjs`. Run
alone, that suite's diff names exactly one offender:

    + actual - expected
    + [ 'shell/main.cjs' ]

`shell/main.cjs` has an **uncommitted** change in the working tree (+265/-36)
adding a `spawnChildProcess` seam, made by another lane; it is outside this
lane's territory and was not edited here. This lane's own new harness,
`tools/write-outcome-restate-qa.cjs`, is NOT in that list — it is an Electron
main script and spawns nothing.

## Files changed

    src/write-outcomes.js                     (new)
    src/cloud-tasks-controller.js
    src/mission-bridge.js
    src/agent-loops.js
    src/agent-teams.js
    src/write-surfaces.js
    src/styles.css                            (.write-restated)
    tools/test/write-outcomes.test.mjs        (new)
    tools/write-outcome-restate-qa.cjs        (new)
    reports/lanes/team2-b2.md                 (this file)

Nothing in wave 2's fenced set is touched: not `src/views/agent.js`, not the
settings/appearance/checkout-selection write paths, not `shell/renderer-prefs.cjs`,
not NSIS, not `tools/packaged-qa-suite.mjs`, and none of the
loop/page2/team-panel/owner-popup/agent-subpage QA drivers.
