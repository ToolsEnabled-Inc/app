# Lane: ratchet-regression-fix

Tree: `C:\Users\joshp\Desktop\wt-capability`. No git write commands. Working-tree
edits only. Shared files (`package.json`, `config/*.json`) untouched;
`tools/test-baseline.json` untouched (`git status` clean for it) — the baseline was
never raised and `--update` was never run.

## Verdict

`npm run verify` — **exit 0, 1579 tests, 1579 pass, 0 fail, 296.7s**, bare (no pipe,
no redirect). All seven regressions fixed in the code.

## The root cause behind six of the seven

Not seven independent bugs. `git status` shows `src/mission-bridge.js`,
`src/write-surfaces.js`, `src/views/computers.js`, `src/views/comms.js`,
`src/views/ledger.js`, `src/views/metrics.js`, `src/views/research.js` and
`src/main.js` all **unmodified since HEAD**, while every other file the same two
lanes touched (`src/agent-loops.js`, `src/agent-teams.js`,
`src/cloud-tasks-controller.js`, `src/org-controls.js`, `src/local-activity.js`,
`src/views/settings.js`) is modified. The two lanes' NEW modules and NEW tests
survived as untracked files — `src/refusal-copy.js`, `src/write-outcomes.js`,
`src/first-run-needs.js`, `src/guide.css`, `src/views/guide.js`,
`tools/test/refusal-copy.test.mjs`, `tools/test/write-outcomes.test.mjs` — but
their edits to already-tracked files were clobbered by a later wave's commit.

So the tests were measuring work that had been reverted underneath them.
`reports/lanes/team2-b6.md` documents the lost edits site by site and records
177/177 green when they existed; `src/guide.css` still carries the styling for
integration points (`.computers .graph-empty .host-absent`,
`.comms .chip-preview .host-absent`) whose call sites had vanished. The repair is
re-applying the lost edits, not inventing new behaviour.

## The seven

| # | test | root cause | fix |
|---|---|---|---|
| 1 | the loop cites addresses that exist | `LOOP_RUN_CAP.evidence` cited `agent-lane-dispatch.js:273`; an engine edit moved `function killLaneTree(` to line 272, so the citation landed on the line after it | re-pointed to `:272` in `src/agent-loops.js` |
| 2 | the four screens read the shared copy | the onboarding module landed wired into only 2 of its 9 call sites; `#/guide` had no route at all, so all six doors resolved to home | wired `computers/comms/ledger/metrics/research` and added the `guide` route to `src/main.js` |
| 3 | no view or copy module interpolates a code | 5 surviving `${...code...}` sites in `mission-bridge.js` (×3), `write-surfaces.js`, `views/computers.js` | `refusalSentence()` for the sentence, `state.code` / `markRefusalCode()` for the machine channel |
| 4 | mismatched and incomplete receipts are rejected | `frozenControlState` had no `code` field, so the terminate refusal's identifier was lost entirely | `code` restored as a state field, absent (not blank) when nothing refused |
| 5 | typed bridge refusal is visible | same cause as 4 | same fix; the codes are produced again, not accepted as `undefined` |
| 6 | LEDGER ARCHIVE: answer after the view closes | `if (destroyed) return state` sat above the line reading the move receipt | `settleMove()` files the outcome BEFORE checking whether the screen survived — the `src/approval-outcomes.js` pattern, reused not reinvented |
| 7 | LEDGER ARCHIVE: receipt did not match preview | same cause as 6 | same `settleMove()`, tone `refused` |

## Absence cases held, per file

- `archiveControlState` / `frozenControlState` omit `code` rather than writing
  `code: ''` — a blank code reads as "there is a code and it is blank", which a
  presence assertion passes on.
- `refusalCodeOf(result) || '<specific>'` resolves the code **before** composing the
  sentence: an unresolved code falls to `GENERIC_REMEDY` ("try once more"), which is
  the wrong advice about an owner-gated two-step ledger move.
- The comms board's terse line is kept for the LOADING state only
  (`LIVE_COMMS_LOADING`). "Nothing is reporting to this copy yet" is a claim about
  the person's machine; an unanswered read is not an absent host. A **missing**
  reason falls to the full notice, never to silence.
- The ledger's guide door appears only once the read has answered — a "what this
  copy needs" link under a spinner invites a person to solve a problem they may not
  have.
- The fleet graph's DECLARED state keeps its own sentence rather than the shared
  "there is nothing here to draw": a declared topology IS drawn there, and the
  shared body would be false beside it. It gets the door, not the paragraph.
- `markRefusalCode(node, null)` on the success path REMOVES the attribute.

## Evidence (completed runs, this tree)

| command | result | ms |
|---|---|---|
| `npm run verify` (bare) | exit 0 · 1579 tests · 1579 pass · 0 fail | 296722 |
| `node --test tools/test/agent-loops.test.mjs` | 31/31 | 99 |
| `node --test tools/test/first-run-needs.test.mjs` | 13/13 | 111 |
| `node --test tools/test/refusal-copy.test.mjs` | 14/14 | 3178 |
| `node --test tools/test/terminate-ui.test.mjs` | 8/8 | 188 |
| `node --test tools/test/write-outcomes.test.mjs` | 20/20 | 219 |
| `npm run build` | exit 0 (the router + 5 view edits compile; no unit test imports them) | 12137 |
| `npm run check:naming` | exit 0 | — |
| `npm run check:renderer` | exit 0 | — |

`dist/` is gitignored, so the build left no working-tree change.

## Not run, and why

`tools/refusal-copy-qa.mjs` and `tools/agent-route-reachability.mjs` drive a packaged
sterile profile (~30s each, Electron). Not part of the ratchet and not requested; the
DOM changes here were kept selector-compatible with both instead — `reasonClass:
'graph-empty-reason'` preserves `.graph-empty-reason` for the reachability probe, and
the fleet graph's declared refusal keeps both of its clauses inside one visible
element, which that probe asserts.

## Tooling limitation, stated rather than skipped

The `LOCAL-WORK` rule-0 hook asks for `code.*` (goto_definition, find_references,
workspace_symbols) before ripgrep. Those are the `mcp__toolsenabled-remote__code_*`
tools on the bridge lane and were not loaded in this session, so symbol lookups fell
back to grep. Reporting it rather than letting the fallback pass unremarked.
