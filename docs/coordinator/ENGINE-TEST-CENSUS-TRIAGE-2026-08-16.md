# Engine test census, triaged file by file (2026-08-16)

Owner asked, mid-session: *"are we regressing at all? are we making sure we are
making things actually work?"* This is the measured answer, not an impression.

**Census: 758 of 804 engine test files pass** (`node tools/test-run.js --all`,
58m37s, written to a scratchpad rather than the engine's `state/`). The previous
record was 97.5 hours stale, which is why the chain's final step had been
refusing to rule.

Every one of the 44 non-passing files was then run individually and diagnosed,
and any file claimed to be a **real defect in committed code** was handed to a
second agent whose instructions were to REFUTE it. The decisive technique those
verifiers used, and the reason this list can be trusted: `git archive HEAD |
tar -x` into a scratch directory, then run the test against that pristine
committed tree. A failure that survives there cannot be blamed on the ~61 dirty
paths other lanes have in the shared checkout.

## The headline

**Nothing that reaches a customer is broken.** All 12 confirmed defects are in
builder-only tooling and gates. `affectsShippedProduct` is false for every one,
and the two suites that guard what actually ships — `agent-onboarding` and
`r-ledger` — pass.

| Category | Files | Reaches a customer |
|---|---|---|
| Real defect in committed code (confirmed, 12/12 survived refutation) | 12 | **No** — builder tooling only |
| Another lane's uncommitted work | 6 | No |
| Test bug (stale fixture or expectation) | 11 | No |
| Machine environment (absent local config/service) | 12 | No |
| Passes when run alone | 3 | No |

## The 12 confirmed defects, in four clusters

**1. FRA manifests pin a stale tool-registry digest (4 files).**
`fra-endpoint-manifests`, `r204-fra-surface-security`, `full-remote-access-bridge`,
`fra-manifest-repin`. Both machine manifests pin a digest of an older registry,
so every manifest load fails closed at `src/lib/fra-capability-manifest.js:176`
and the security suite dies at module load before a single assertion runs. The
re-pin guard is doing its job; nobody re-pinned. **This is the highest-value fix
in the list** — a security suite that cannot start is not a passing security
suite.

**2. Package/charter manifests are behind committed source (4 files).**
`package-check` (+ its shim), `package-charters`, `provider-charters`. The
manifest no longer claims 14 source files committed between 2026-08-11 and
2026-08-16, and the billing charter omits two dependencies its source really
imports. Note the honest nuance the triage found: several charters state *in
writing* that they leave a dependency undeclared on purpose, so this gate is
partly reporting a deliberate choice.

**3. Spawn/console hygiene regressed on committed code (3 files).**
`spawn-env-scrub-gate`, `spawn-hygiene`, `terminal-suppression`. Five call sites
added since the 2026-08-11 baseline hand a child process an unscrubbed
environment, and two owner-operations CLIs (`tools/owner-spool-draft.js:260`,
`tools/r-ledger.js:54`) call `execFileSync` without `windowsHide`. That second
one matters to the owner directly: it is the quiet-desktop rule, and these are
tools he runs.

**4. The unwired-test ratchet is over its ceiling (1 file).**
`test-census.test.js`: 15 against a ceiling of 9. Three are other lanes'
untracked files, but three test files were committed in the last two days
without being wired into any aggregate, so the committed tree alone stands at
12. Tests that run in no script are tests nobody is running.

## What is NOT a defect, and why it looked like one

- **6 files fail only because of other lanes' uncommitted edits.** The clearest:
  an in-flight `actions.js` hunk references `CONFINED_LANE_DISALLOWED_TOOLS`,
  which is defined nowhere — a half-finished rename beside a differently-named
  `CONFINED_LANE_TOOLS`. It throws a ReferenceError through `claudeArgs`, taking
  down `mission-bridge`, `agent-session-confinement` and
  `loop-guided-child-confinement` with it. Proof it is theirs and not ours:
  `git show HEAD:` has neither name, and the same suite passes on this lane's
  clean merge worktree. (This was finding 1 in OPEN-FINDINGS, now confirmed by a
  second, independent method.)
- **Two settings suites** fail on a pinned catalogue size of 60 because an
  uncommitted lane added two depth-1 rows (`startup.services_at_logon`,
  `agent.blocking_prompt_gate`). HEAD is exactly 60. The ratchet is working.
- **11 test bugs** are stale fixtures, mostly one root cause: schema fixtures
  that fake an old database by dropping a hardcoded table list that was never
  updated for schema V21's `research_*` tables. Four files are two-line shims
  inheriting their parent suite's failure.
- **3 files pass when run alone** and failed only inside the census's batch
  runner on a dirty tree.

## Method notes worth keeping

- A census taken on a shared checkout with other lanes' uncommitted work will
  over-report. Say so with the number, or the report reads as product rot.
- `git archive HEAD | tar -x` into a scratch dir is the cheap way to separate
  "committed code is broken" from "someone is mid-edit". Prefer it to reasoning
  about `git status`.
- Compatibility shims (`tests/X.js` requiring `tests/dir/X.js`) double-count in
  any census; four of the 44 are shims of another failing file.

## Recommended order, for whoever picks this up

1. Re-pin the FRA manifests (unblocks 4 files including a security suite).
2. `windowsHide` on the two owner CLIs (quiet-desktop rule, owner-facing).
3. Scrub the five new spawn sites, or allowlist them deliberately.
4. Update the package manifest for the 14 unclaimed files; wire the 3 unwired
   test files.
5. Refresh the stale schema fixtures to V21.

None of this blocks the 1.0.21 candidate: none of it ships.
