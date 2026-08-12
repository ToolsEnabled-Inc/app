# Harvest patches

Repository: `C:\Users\joshp\Desktop\wt-capability`

Initial tree state: clean (`git status --porcelain=v2 --branch` showed only branch metadata). Neither patch overlapped another session's modified file, so no file content needed to be saved aside or restored.

## `r1531-w2-bug-hunt.patch`

- Source: `C:\Users\joshp\Desktop\wt-r1531-w2-bughunt\r1531-w2-bug-hunt.patch`
- Application: plain `git apply --check` exited 1 at `src/comms.css:118`; the instructed 3-way fallback applied all five paths cleanly (exit 0).
- Integrity: reverse apply check exit 0; `git diff --check` exit 0; no unmerged paths; conflict-marker `rg` exit 1 (no matches).
- Bare affected suite: `node --test tools/test/brand-mark.test.mjs tools/test/first-run-needs.test.mjs tools/test/metrics-usage-attribution.test.mjs tools/test/settings-recovery-notice.test.mjs` — exit 0, 45 passed, 0 failed.
- Bare production build: `node node_modules/vite/bin/vite.js build` — exit 0.
- Additional non-acceptance attempt: `node --test --test-concurrency=1 tools/test/*.test.mjs` — exit 124 after the 600-second execution bound. Before timeout, unrelated `process-tree.test.mjs` test 924 failed because sandboxed `Get-CimInstance Win32_Process` returned Access denied. This run is recorded but is not treated as patch evidence.
- Commit SHA: **not created**. The workspace sandbox permits source writes but denies the linked worktree Git metadata (`...mission-control\.git\worktrees\wt-capability\index.lock`). Explicit-path `git add` exited 128. The audited owner-context host execution needed to write the index was requested twice and cancelled both times.
- Not landed: the five source-file changes remain applied and unstaged solely because Git metadata is not writable in this session. No patch content was deliberately omitted.

## `r1531-w1-release-cut.patch`

- Source: `C:\Users\joshp\Desktop\r1531-w1-app\r1531-w1-release-cut.patch`
- Application: plain `git apply --check` exited 1 at `tools/test/release-packager.test.mjs:12`; the instructed 3-way fallback applied all four paths cleanly (exit 0), with the new `staging-collision.mjs` added.
- Integrity: reverse apply check exit 0; `git diff --check` exit 0; no unmerged paths; conflict-marker `rg` exit 1 (no matches). All four resulting files byte-match the source worktree versions.
- Bare affected suite: `node --test tools/test/release-packager.test.mjs` — exit 0, 29 passed, 0 failed.
- Bare syntax checks: `node --check` on `cut-release-candidate.mjs`, `staging-collision.mjs`, `stranger-onboarding-qa.mjs`, and `release-packager.test.mjs` — exit 0 for each.
- Bare packaged QA harness: `node tools/stranger-onboarding-qa.mjs` — exit 2 with `NO VERDICT`; Electron exited before publishing a debugger port because the sandboxed launch received an invalid ICU data file descriptor. This is an environment startup failure, not a measured product failure, and is not treated as acceptance evidence.
- Commit SHA: **not created**, for the same linked-worktree Git metadata denial above.
- Not landed: the four patch paths remain applied and unstaged solely because Git metadata is not writable in this session. No patch content was deliberately omitted.

## Required commit identities prepared

The exact explicit-path commits are prepared with these trailers once owner-context Git metadata access is available:

```text
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Lane: coordinator-harvest r1531-w2-bug-hunt (session local-codex-sol)
```

```text
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Lane: coordinator-harvest r1531-w1-release-cut (session local-codex-sol)
```
