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

---

# What this lane then fixed (same night, measured after)

The recommended order above was worked top to bottom. The claim of improvement
is a re-measurement, not an impression: the 42 failing files were re-run
individually afterwards, and **15 now pass**. Engine commits, in order:

| # | Commit | What it was |
|---|---|---|
| 1 | `bc307c8` | **FRA manifests re-pinned.** Both machines pinned a digest of a 263-tool registry that no longer existed, so `r204-fra-surface-security` died at module load before asserting anything. Re-pinned through the repo's own authorization tool, which recovered the baseline from history and required the reviewed digest to be named. The delta was 11 added `research.*` tools (this lane's) and 4 removed Stripe tools (owner-directed, 6e906f2); neither set appears in either manifest's allowed/excluded lists, so the surface is unchanged at 37/13. Unblocked 4 files. |
| 2 | `9fd8cae` | **The owner's own two CLIs.** `tools/r-ledger.js` (behind /Request) and `tools/owner-spool-draft.js` called `execFileSync` without `windowsHide` — his R193 quiet-desktop rule, broken in the tools he touches most — and both handed the child the full environment. Now hidden and scrubbed via `safeLaunchEnvironment()`. Unblocked 2 files; env-scrub gate 5 sites → 3. |
| 3 | `5232d0d` | **Four migration fixtures predated research.** Each fakes an old schema by dropping every table a later version added; V21's six `research_*` tables were never added, so migration replayed onto an unexpected shape and threw a DDL fingerprint mismatch that named neither the fixture nor the tables. Unblocked 7 files (4 fixtures + 3 shims). `task-state` now also names anything left behind that a v1 database could not have held, so the next schema addition fails with an instruction instead of rotting silently. |
| 4 | `8aef028` | **Thirteen files claimed.** The research run machinery, the whole R-ledger surface, and the bridge's research actions were in the tree and in no package — so their imports were invisible to the charter checker. Claiming them exposed 8 always-imported, never-declared dependencies, now declared with reasons. Charter omissions **62 → 60** while claiming 13 more files; unclaimed files **16 → 3**. |
| 5 | `48285b2` | **Three committed tests ran in no script.** `r-ledger-check`, `owner-spool-draft` (this lane's, 12h old) and `agent-lane` (26h). All three were run first — wiring a red test into the chain is worse than leaving it orphaned — then wired into `test:red-gates-orphans`. Orphans **15 → 12**. |
| 6 | `13a9ce5` | **A test red over punctuation.** `status-injection` pinned the exact argument `hookEnvelope(event.hook_event_name, rendered)`; `f8f58c1` began prefixing a launch note four days ago, so the test was red while the behaviour it protects was intact. It now pins that `rendered` REACHES the envelope, and the looser pin was proved to still fail when it genuinely does not. |

## The 27 still failing, and whose they are

**Six are other lanes' uncommitted work** and will clear the moment those lanes
commit or revert: the half-finished `CONFINED_LANE_DISALLOWED_TOOLS` rename in
`actions.js` (takes down `mission-bridge`, `agent-session-confinement`,
`loop-guided-child-confinement`), and two extra depth-1 settings rows against a
pinned catalogue of 60 (`settings-registry`, `settings-enforcement-honesty`),
plus the in-flight `no-blocking-prompt-registration` gate that fails by design
until the owner applies its proposed settings file.

**Three are blocked on other lanes' debt, and one of those blocks everyone:**

- `package-check` (+ its shim) cannot go green until
  `tools/no-blocking-prompt-hook.js` is **committed** — it is untracked, so a
  claim for it would resolve to nothing on a clean checkout and turn the gate
  red for everybody. `src/lib/tool-packs/paddle-checkout.js` and
  `tools/settings-set.js` each need one line from their owning lane.
- `package-charters` / `provider-charters` are at 60 omissions across many
  packages. Note they are **themselves orphaned**: the charter gates run only
  when someone remembers to type them. They were deliberately NOT wired here,
  because wiring a red gate trades an over-ceiling ratchet for a permanently
  red chain.
- `spawn-env-scrub-gate` has 3 sites left. Two are `tools/launch-readiness/`
  (launch lane). The third, `src/lib/research/runners.js`, is a genuine
  tension rather than a bug: it never inherits ambient environment (ten OS
  names, or a registered account's launch environment, with credential-shaped
  `envKeys` refused) but it spawns a caller-supplied command, which the
  allowlist's own criterion says is never exempt. Applying the scrub there
  would strip the deliberate codex-account auth seam — removing a feature to
  make a gate green. **This needs the gate owner's ruling, not a unilateral
  edit.**

**The rest are environmental** on this machine: absent local config
(`aicalendar` is explicitly a builder-only fixture), missing project roots, or
services that are not running.

`test-census` remains over its ceiling at 12 against 9 — the residue is the
untracked in-flight files above plus the two orphaned charter gates.

**Nothing in this list ships.** The 1.0.21 candidate is unaffected.

## Correction: one "environmental" dismissal was hiding real work

The triage sent every *defect* claim to a refuter but never checked the
*dismissals*, and dismissals are where errors hide. Spot-checking the
machine-environment bucket afterwards found the label right in effect but
imprecise, with one item of genuine work inside it.

**`smoke.js`, `allowlist.js` and `grepsaver/allowlist.js` share ONE root
cause**, not three environmental quirks: this session's MCP wire exposes a
narrowed tool surface, so tests asserting the full registry (e.g.
`chrome_web_store.upload`) fail. They pass from an unrestricted permission
session.

**The real work hiding there:** `tools/grepsaver-tooldigest.js`'s generated
output is genuinely STALE — it describes **242 tools against a live registry of
270** (the 28 include this lane's 11 `research.*` tools). That digest is the map
agents read *instead of grepping*, so a stale one silently under-reports what
the product can do.

It cannot be regenerated from a narrow session, and the generator knows it:
run from here it exits 3 and refuses, saying regenerating from a partial wire
"would silently drop every missing tool, write-class tools included" — and it
leaves the existing file untouched. That is a fail-closed generator behaving
exactly as it should.

**Action for whoever holds an unrestricted session:** run
`node tools/grepsaver-tooldigest.js`, confirm it reports 270, commit the
regenerated digest. Until then `allowlist.js` stays red for a real reason, not
a machine quirk.
