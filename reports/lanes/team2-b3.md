> **TWO SESSIONS WROTE A B3 REPORT. READ BOTH.** A second session also worked
> B3 and its report is `reports/lanes/team2-b3-implementation.md`. Nothing below
> this block has been altered. One correction from that session, because it
> changes what a reader should do: the `changeDisplayName` store function, the
> `mc-account:change-display-name` channel, the preload method, the "Shown as"
> row, `changeDisplayNameMarkup` and the `display-name` submit branch listed
> below as "already built ... by the live Google-sign-in/OAuth lane" were
> written by that second session between 13:22 and 13:40, not by the OAuth lane.
> The OAuth lane's own report (`reports/lanes/oauth-signin.md`) says the same
> from its side: it calls `changeDisplayName` "a concurrent lane's uncommitted
> work". They are B3's repair, they are verified by use, and they are not a
> duplicate of anything.

# TEAM 2 / B3 — the display name a person is stuck with for the life of the account

Tree: `C:\Users\joshp\Desktop\wt-capability` (branch `packaging/capability-layer`).
No git write commands. **No edit was made to any product file by this lane** —
the coordinator issued a stop order mid-task and the work is handed over as a
patch. The only file this lane wrote is this report.

## HEADLINE — DO NOT APPLY A DUPLICATE

**Most of B3 was already built in the working tree while I was reading it, by the
live Google-sign-in/OAuth lane.** As of 13:27 the tree already contains:

| piece | where | state |
|---|---|---|
| `changeDisplayName()` in the store | `shell/product-account.cjs:1280` | built |
| IPC `mc-account:change-display-name` | `shell/main.cjs:1834` | built |
| preload bridge method | `shell/fleet-profile-preload.cjs:225` | built |
| "Shown as" row on the signed-in screen | `src/account-markup.js:327` | built |
| `changeDisplayNameMarkup()` rename form | `src/account-markup.js:445` | built |
| dispatch for `mode === 'display-name'` | `src/account-markup.js:541` | built |
| submit branch + mode preservation | `src/views/account.js:265`, `:139` | built |

I had drafted a near-identical design before I saw theirs. **Anything from me that
re-adds those is a double definition.** The patch below is only the part they did
not touch.

## What is STILL open — and it is the literal first sentence of my brief

`src/views/setup.js` was never touched by that lane (md5 `aa190092…` unchanged
across the whole session). The first-run walkthrough therefore still:

- renders **no** "Shown as" field (`setupAccountStepMarkup` has username +
  password only), and
- hardcodes `displayName: ''` at `src/views/setup.js:451`.

So a person who makes their account **inside first run** — the common path — still
silently gets their username as their label, while a person who makes the same
account later at `#/account` is offered the choice (`formMarkup` has had the field
all along). One act, two different products. That asymmetry is the remaining
defect and the patch closes it.

Adding the field does **not** break the "three questions" promise: `account` is
already declared not-a-question (`QUESTION_STEPS` excludes it, `src/views/setup.js:114`),
and the field is optional.

## The choice the brief asked me to make

Offered: add the field to the walkthrough, **or** make the name changeable later.
Right answer for a commercial product: **changeable later** — adding the field
alone only moves the one-way door, and only a rename reaches accounts that already
exist. That half is now built (by the other lane). The patch adds the field *as
well*, which is only honest **because** the rename exists: the field's copy
promises "nothing you choose here is permanent", and that promise is true only if
the rename lane lands. **If the rename is reverted, revert this patch with it.**

## Evidence

Command: `node apply.mjs && node check.mjs` (isolated copy in scratchpad; the app
tree was never written to). Completed run, immediately before reporting:
**17 passed, 0 failed, 0.11 s**, against tree bytes
`src/account-markup.js` md5 `87B43D6E6BD92CD22CB5989A23902EB2`.
The anchor was re-proved unique (1 occurrence) three times as the file drifted
underneath — 37227 → 37233 bytes — so it is drift-resistant.

**NOT VERIFIED BY USE.** I did not create a test account through the real flow,
because applying the patch was forbidden by the stop order. This is an honest
partial: the patch is proved to apply cleanly and to render correctly, and is
*not* proved by clicking the running app. Whoever applies it must do that.

## The collision, recorded

Baseline md5s were taken before any work. 25 minutes later 5 of the 7 files were
different; `src/account-markup.js` was rewritten 41 s before one of my reads and
again during verification. Had I edited, I would have raced a live writer inside
authentication code. Coordinator confirmed the fence I was briefed against had
gone stale.
