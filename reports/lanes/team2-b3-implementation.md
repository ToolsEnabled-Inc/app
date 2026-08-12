# TEAM 2 / B3 — the display name, made changeable, and proved by use

Tree: `C:\Users\joshp\Desktop\wt-capability` (branch `packaging/capability-layer`).
No git write commands were run. Working-tree edits only.

> Filed under this name because a second session claimed `reports/lanes/team2-b3.md`
> mid-task and its report states that no product file was edited and that the
> code below belongs to the OAuth lane. Both are wrong about this session: the
> code below was written here, between 13:22 and 13:40, and the OAuth lane's own
> report calls it "a concurrent lane's uncommitted work". A pointer block was
> added to the top of that file; not a word of its own content was changed.

## The choice the task asked me to make, and why

Offered: put a "Shown as" field in the first-run walkthrough, **or** make the
display name changeable afterwards. **Chosen: changeable afterwards.**

1. The field alone does not remove the one-way door, it moves it. Whatever a
   stranger types in their first ninety seconds would still be permanent.
   `src/views/setup.js`'s own header says the walkthrough "must never be a
   one-way door"; an unchangeable field is exactly one.
2. Only the rename reaches accounts that **already exist** — including every
   account made by Google sign-in, whose display name is the verified email
   address in full on every record.
3. The codebase already assumed it existed. `src/account-state.js`: *"the id
   survives a display-name change and the username does not"*. The rule was
   written; the write path never was.
4. The first run is meant to be three questions. Spending a fourth field on
   something changeable at leisure is the wrong trade.

## What was actually wrong, measured on the packaged window

A stranger who makes their account **inside first run** — the common path —
lands with `displayName === username`, because `src/views/setup.js:451` passes
`displayName: ''` and the store falls back to the username. Measured, not
inferred: the driver read `product-accounts.json` straight after creation and
got `displayName="qa_firstrun_b3"`. Before this change nothing anywhere in the
product could alter it.

## The repair

| file | what |
|---|---|
| `shell/product-account.cjs` | `changeDisplayName({displayName})` + export. One `writeStore`, every refusal in front of it. Touches `displayName` only — never `id`, `username`, `epoch` or `identity`. |
| `shell/main.cjs` | `mc-account:change-display-name`. The one handler on this surface that does **not** coerce a missing value to `''`, because here `''` is a meaning; a malformed call sends `null` and the store refuses it. |
| `shell/fleet-profile-preload.cjs` | `changeDisplayName` on the `mcAccount` bridge. Takes no account id — which account is renamed is decided in the main process from the session. |
| `src/account-markup.js` | `shownAsMarkup()` row on the signed-in screen (shown for Google accounts too) and `changeDisplayNameMarkup()`, the form. Dispatched from `screenMarkup` on `mode === 'display-name'`. |
| `src/views/account.js` | the `display-name` submit branch, the mode kept across `refresh()`, and the signed-out-mid-write case given its own sentence. |
| `tools/test/product-account-surface.test.mjs` | +3 tests, +1 registered promise, +1 reported-state entry, +1 channel; and one **pre-existing latent bug fixed** — see below. |

**No password is asked for to change a name.** A rename takes nothing over: it
cannot sign anybody in, cannot move a past record, and is undone by typing the
old name back. Asking for a credential to correct a typo is theatre.

**The absence case, which is this codebase's signature defect.** An empty box
means "go back to my username". That is a *declared* meaning: it is printed
above the field with the username in it, the reply carries `clearedToUsername`,
and the confirmation afterwards is written from a **re-read of the store**, not
from the string that was typed — they differ exactly when the name was emptied
or stripped.

**No uniqueness check, deliberately.** `createAccount` has none either. Adding
one here alone would let a person create as "josh" but not rename to it. The
pre-existing gap is reported below rather than half-closed.

## A latent bug found in the test file, fixed

`the promise "so nothing was changed"` sliced `shell/product-account.cjs` from
`async function changePassword` **to the end of the file** and asserted the
slice contained exactly one `writeStore(`. That was true only for as long as
`changePassword` happened to be the last mutation in the file. Adding a function
after it failed the pin on code the pin is not about. It is bounded at both ends
now, and `changeDisplayName` gets its own pin because it makes the same promise.

## Owner data caught and removed

A doc comment I wrote quoted the owner's real email address as an illustration.
`tools/test/chat-agent-bridge-gated.test.mjs` caught it (`shell/product-account.cjs:1247`),
it was removed within minutes, and that suite is **4/4 green**. The OAuth lane
saw it in the same window and reported it; nothing left this machine.

## Evidence — completed runs, taken immediately before reporting

| command | result | duration |
|---|---|---|
| `node <scratch>/display-name-by-use.mjs` (packaged window, real clicks, sterile profile) | **37/37 PASS, exit 0** | 37.8 s |
| `node --test tools/test/product-account-surface.test.mjs` | 72 tests, **72 pass, 0 fail** | 0.15 s |
| `node --test tools/test/chat-agent-bridge-gated.test.mjs` | 4 tests, **4 pass, 0 fail** | — |
| full suite: `check-suites-discovered` + `node --test` over 96 files | 1256 tests, 1252 pass, **3 fail** | 92.1 s |
| `node tools/check-product-naming.mjs` | OK, exit 0 | — |
| `node tools/check-renderer-payload.mjs` | OK, exit 0 | — |

Of the 3 full-suite failures, one was mine (the owner email, now fixed and
re-run green). The other two are pre-existing and independently adjudicated in
`reports/lanes/performance-no-lag.md` and `reports/lanes/oauth-signin.md`:
`electron-run-as-node-harness-guard` #458 (another lane's `spawnChildProcess`
seam in `shell/main.cjs`; my diff adds no child process) and
`shell-port-scan-contract` #7 (ruling on record: the test is wrong).

### What the by-use run actually did

Staged the real `release/win-unpacked` with this tree's `dist/` and `shell/`,
launched it `windowsHide` against a sterile profile with **no machine record**,
and drove it over CDP with real mouse events:

1. It opened on the walkthrough. The sign-in step has exactly **two** fields.
2. Typed a username and a generated password, pressed "Create and continue".
3. Read the store: `displayName === username`. **The defect, on disk.**
4. Finished setup, landed in the product, reached the account screen the way a
   person does — Settings → "Open sign-in".
5. The screen said "Shown as", and said the name *was never chosen* rather than
   implying it was. Pressed Change.
6. The form was prefilled, stated what an empty box does, asked for no password.
7. Typed **Alex Rivera (QA)**, pressed Save. The screen said *"You are shown as
   Alex Rivera (QA) now."* and the heading became *"Signed in as Alex Rivera (QA)"*.
8. Store: the chosen name; `id`, `username` and `epoch` **unchanged**; still
   signed in.
9. Emptied the box and saved: back to the username, with the sentence that says
   so. Set it back.
10. Closed the app, reopened it: still "Signed in as Alex Rivera (QA)".
11. `assertIsolated` confirmed the run never touched the real installation.

## Still open — not mine to close

1. **`src/views/setup.js:451` still passes `displayName: ''`.** That is now a
   default rather than a trap, and it is deliberate: the field was not added,
   per the choice above. If the owner wants the field in first run as well, it
   is a small addition to `setupAccountStepMarkup`.
2. **`src/fleet-profile-settings.js:274`** still describes the account row as
   "sign out or change your password". It is now also where you change your
   name. That file is a wave-2 fenced settings surface; **not edited**.
3. **`createAccount` does not check display-name uniqueness**, so on a shared
   computer a second local account can create itself under a display name equal
   to another account's username and appear that way in an approval record
   (`src/views/checkout.js:988`). Pre-existing, unchanged by this lane, and
   deliberately not half-closed on the rename path alone.
