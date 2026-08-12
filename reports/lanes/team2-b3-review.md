# TEAM 2 / B3 — adversarial review (reviewer session, not the builder)

Tree: `C:\Users\joshp\Desktop\wt-capability` (branch `packaging/capability-layer`).
No git write commands. No product file was edited by this review; the only file
written is this one. Filed under a third name deliberately: `team2-b3.md` and
`team2-b3-implementation.md` are already contested by two sessions and a third
writer in the same file is the collision this repo keeps paying for.

**VERDICT: CONFIRMED.** Reproduced independently by use, not by reading the
builder's code, in a packaged build staged from `release/win-unpacked` with this
tree's `dist/` + `shell/`, a sterile profile with no machine record, real CDP
mouse and keyboard input. 41/41 checks, exit 0, 41.5 s.

## What I reproduced myself

- First run still has **no** "Shown as" field — measured, not read: the account
  step's fields are exactly `["username","password"]`. The builder's stated
  deviation is real and is what the tree does.
- The defect the task is about still occurs on that path: an account created in
  the walkthrough lands on disk with `displayName === username`.
- The repair works: Settings -> Open sign-in -> Change -> typed
  `Ada Lovelace-Ω` -> "Signed in as Ada Lovelace-Ω" / "You are shown as Ada
  Lovelace-Ω now." Store agrees; `id`, `username` and `epoch` unchanged; still
  signed in; survives close-and-reopen.

## Absence cases I attacked, all of which fail closed

Whitespace-only, invisible-characters-only, and an empty box all fall back to
the username and say so on screen — no blank label, nothing invisible stored.
Eight malformed shapes at `mcAccount.changeDisplayName` (no argument, `{}`,
`undefined`, `null`, number, object, array, `true`) are each refused
`ACCOUNT_DISPLAY_NAME_INVALID` with nobody's name changed. A rename with nobody
signed in is refused `ACCOUNT_NOT_SIGNED_IN`. A 500-character name truncates to
the 64-character rule.

## What I found that the builder did not

1. **HEAD says first run asks; it does not.** Commit `95b90ff` is titled "First
   run now asks what you want to be called". `src/views/setup.js:446` now reads
   `[data-setup-account-field="displayName"]`, and `setupAccountStepMarkup` in
   `src/account-markup.js` renders no such field, so the absent element is
   coerced to `''` and the walkthrough lands on the original defect. Inert, as
   the commit body admits — but the subject line is a false record of shipped
   behaviour, and the coercion is the codebase's signature shape.
2. **The new test pin is not bounded when a marker moves.** Measured on the real
   file: with the `/* ------- the account partition` end marker absent,
   `store.slice(start, -1)` runs to end of file (19279 chars vs 3026), still
   counts one `writeStore(`, and every assertion passes — while the assertion
   message claims it catches "empty **or unbounded**; its end marker moved". The
   `changePassword` pin is worse: its end marker is now the *name of another
   function*, so renaming `changeDisplayName` makes it fail with "changePassword
   writes more than once", which is the misdiagnosis the fix was written to end.

## Not proved by use, by anybody

The "Shown as" row for a **Google** account. This copy has no Google sign-in
application id, so that path cannot be driven here.

Evidence driver: `<scratchpad>/adv-b3-review.mjs`; pin measurement:
`<scratchpad>/adv-b3-pin-absence.mjs`.
