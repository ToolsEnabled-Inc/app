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

See PERFORMANCE-BUDGET-NODE-GROWTH-ANALYSIS.md. Known-red for a measured
reason; take the routes-scenario reading before touching the harness.
