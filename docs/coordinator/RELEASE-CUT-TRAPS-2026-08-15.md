# Release-cut traps, measured across four cuts (1.0.10 – 1.0.13, 2026-08-15)

Four release candidates were cut in one day. Each cutter hit the same
mechanics, and by the fourth the pattern was clear enough to write down.
None of these is a product defect; all of them will cost the next person an
hour if unrecorded.

## 1. `npm run release:cut` cannot run as one command from the shared checkout

Its third gate is `node tools/check-renderer-payload.mjs release/win-unpacked`
against the checkout it is run in. The packager (`cut-release-candidate.mjs`)
builds in a throwaway detached worktree, so the shared checkout has never had
a `release/win-unpacked` and never will. The gate refuses there by
construction:

```
check-renderer-payload FAILED:
  - no app.asar at C:\lanes\research-app\release\win-unpacked\resources\app.asar
```

Every cutter since at least 1.0.10 ran the chain member by member (which is
why their declarations read `worktreeRemoved:false`). Nothing was skipped:
each gate was run, and that one against the sealed build. The alias is dead
as a one-liner; the chain is alive. **Do not "fix" this by removing the gate
from the alias** — fix it by pointing the gate at the packager's worktree, or
by running the chain inside that worktree.

## 2. The 1.0.12 version bump lives only on its tag

Another lane committed to `feature/research-projects` while 1.0.12 was
building, so the packager's `--advance-branch` refused (correctly — no
force). The cutter tagged the build ref as `release-candidate/1.0.12` so the
declaration's provenance would not be gc-able. Consequence: the branch's
`package.json` stayed at 1.0.11, and a plain `--bump patch` on the next cut
would have computed **1.0.12 and collided with the staged candidate**. 1.0.13
only worked because `--version 1.0.13` was passed explicitly. **Always pass
--version explicitly**, and check `Desktop\agentwork\MACHINE-A-INSTALLER-CANDIDATE\`
for the highest staged number first.

## 3. The packager's bump commit carries hardcoded, wrong trailers

`cut-release-candidate.mjs` writes its version-bump commit with string-literal
trailers naming `Claude Sonnet 5` and `Lane: release-packager (session
6f84bf9b…)`. Those are byte-identical on 1.0.10, 1.0.11, 1.0.12 and 1.0.13,
and false for every one of them. The provenance hook is satisfied (two
trailers present) but the attribution is fiction. Belongs to the packager's
owner; recorded so nobody reads those commits as evidence of who cut what.

## 4. `qa:packaged` writes to a shared temp log dir

`%TEMP%\packaged-qa-logs\` is shared, so a control run against a second build
overwrites the first build's detail logs. Capture the tails before running
the control, or compare from a report rather than from disk. (Also recorded
in PACKAGED-QA-1.0.9-FLEET-DOOR-ATTRIBUTION.md.)

## 5. Byte-verification needles that already ship

Verifying that a fix reached the sealed installer by grepping the bundle is
only evidence when the needle is ABSENT in the previous build. Across the
four cuts, these looked discriminating and were not: `could not be read`
(100 hits already), `stalled` (100), `axisNames` (2), `with the run service`
(1, in an unrelated pulse sentence), `"unread"` (1, in the cart settings
row), `leased:"claimed"` (1, in the service board's separate map), and
minifier-mangled shapes like `active ? 5000 : 15000` (esbuild writes
`?5e3:15e3`). **Always run the needle against the previous sealed build
first, and prefer whole-function-body or structural comparisons to bare
strings.** Two cutters also found bugs in their own function resolvers that
were silently reporting "not fixed"; a positive control (a needle known to be
present) catches that.

## 6. `qa:packaged` drivers that are flaky, not red

`chatbox-settings-qa`: FAIL / PASS / PASS on three consecutive standalone
runs of the same sealed 1.0.12 build (a persistence race — "the choice
survives a relaunch — stored [...], read back null"). Record as
intermittent, not known-red; carrying it as known-red would silently absorb
a real regression later. `recommended-path-packaged-qa` timed out at 901s
in-suite on 1.0.13 after 25 prior Electron drivers, then passed 21/21
standalone on both 1.0.12 and 1.0.13 — a suite-context hang, not a finding.

## 7. `performance-budget-qa`'s node growth is mostly a harness artifact

See PERFORMANCE-BUDGET-NODE-GROWTH-ANALYSIS.md. It failed on 1.0.11, 1.0.12
and 1.0.13 with an identical number and then PASSED on 1.0.14 with
"-192 nodes/lap" — on a cut that touched only `src/views/research.js`. That
flip is exactly what the analysis predicts: the figure is the live-size
difference between whichever two pages the lap loop happens to end on, so it
moves when the page's mounted size moves. Do not read the pass as "the leak
was fixed" any more than the fail meant "there is a leak". Take the
routes-scenario reading before touching the harness.

## 8. `recommended-path-packaged-qa` hangs on app launch + CDP attach

Timed out in-suite at ~900s on 1.0.13 and 1.0.14, and on 1.0.14 also hung
once STANDALONE (12/21, stuck at a leg boundary with six scratch-copy
ToolsEnabled processes alive) before passing 21/21 in 51s on the next try.
The driver's `send()` has no timeout — only `open()` is bounded — so a lost
CDP reply hangs it for ever. Harness hang class, intermittent; if it hangs,
run it standalone before calling anything a finding, and kill only the
Temp-scratch processes it spawned.

## 10. A driver that exits 0 mid-run is counted PASS (2026-08-16)

`test-account-journey-qa` reported PASS on 1.0.15 while its own log showed
eleven FAIL lines and no ledger summary — the driver exited 0 part-way and
the suite counted a truncated ledger as green. The 1.0.12 copy did the same
once standalone. Until the suite refuses a ledger with no summary line, a
"PASS" from this driver needs its log read before it is believed.

## 11. The fresh-profile sign-in class flipped red machine-wide (2026-08-16)

`account-isolation-session-qa` (and by inspection `account-isolation-leak-qa`)
fail on EVERY sealed build today — including 1.0.12, which passed them on
2026-08-15 — with "creating it signs the person in — signedIn=false" and no
`product-session.enc` written in the scratch profile. Same driver, same
build, different day: machine state changed, not code. The owner's REAL
universe is unaffected (its session file is intact and a DPAPI round-trip
succeeds for the user), so the showing is not at risk; account CREATION in
fresh profiles is what broke. Hypothesis, uncontrolled: the sealed session
is DPAPI-backed and this machine has a recorded DPAPI outage. Someone with
vault context should check before the next fresh-install rehearsal.

## 12. The setup REVIEW step intermittently never renders (2026-08-16, 1.0.16 cut)

A second machine-wide class beside #11, and it is intermittent rather than
red. Four drivers red on 1.0.16 in-suite with one signature: the walkthrough
answers the three questions and then waits for the review that never comes
("gave up waiting for the review" → `setup ends in the app — hash=#/setup`):
`setup-walkthrough-qa` (timed out waiting for the review), `offline-routes-qa`
(78/79), `first-run-recovery-qa`, and three of `stranger-onboarding-qa`'s six
("the review can be accepted — absent" and its two dependents);
`test-account-journey-qa`'s `route=setup` lines are the same thing. Not this
cut: `src/` has changed only under research since 1.0.12, and STANDALONE
against sealed 1.0.15 the same day `setup-walkthrough-qa` failed identically
and `first-run-recovery-qa` failed 1 of 3 (the other two got past setup and
reached the old 38/41). Frequency was uneven — 1.0.16 stalled 4 of 4,
1.0.15 1 of 3, on a machine running other agents' Electron drivers — so it is
recorded as intermittent-both-builds, not as proven equal. On 2026-08-15
(the 1.0.12 logs) `setup-walkthrough-qa` was 18/18 and `offline-routes-qa`
102/102. Whoever owns the setup flow should look at what the review step
waits on before the next fresh-install rehearsal; a slow or absent reply
there is a stranger stuck on the third question.

Also: `chatbox-settings-qa` has a SECOND flaky signature besides #6's
persistence race — 18/21 with "every other agent is still there — []", "the
box says how many agents it is holding back", "…what it is showing instead".
Seen in-suite on 1.0.16 and standalone on 1.0.15 (exit 13); 21/21 standalone
on 1.0.16 a minute later. Same rule: intermittent, not known-red.

## 9. `agent-start-flow-qa`'s 1.0.9 attribution does not transfer

The 1.0.9 document explains its red as "measured a stale working-tree
renderer". On 1.0.14 the same two checks fail ("the send control is not on
the glass") with the SEALED build's own dist swapped in, so that explanation
does not apply any more. Not a research-lane delta (the cut touched only the
research view), but do not quote the 1.0.9 reason for it again; it belongs
to the fleet/compose lane to re-attribute.
