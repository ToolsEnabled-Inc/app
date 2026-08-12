# Lane team2-B8 — uninstall and reset from inside the product

Tree: `C:\Users\joshp\Desktop\wt-capability` (branch `packaging/capability-layer`).
No git write commands. Working-tree edits only.

Task: sign out everywhere, delete local data, and honest copy about what
survives and what does not. Destructive choices clear, reversible where they
can be, honest where they cannot.

## What was already there before I changed a line (all read from this tree)

- **Sign out everywhere IS real.** `src/views/account.js` renders the button,
  `shell/product-account.cjs signOutEverywhere()` advances the account's epoch
  (not merely deleting the session file), and `tools/account-isolation-session-qa.mjs`
  copies the sealed session off, revokes, relaunches and proves the copy is
  refused. That claim is not mine to re-make; I do not touch it.
- **There is NO way to delete local data from inside the product.** Searched
  the whole tree for an erase/reset/wipe path: the only thing that removes user
  data is the NSIS uninstaller's `remove-everything` branch (build/installer.nsh,
  gated by `shell/uninstall-retention.cjs`). Inside the running program there
  is no control, no channel, and no sentence about it.
- `shell/uninstall-retention.cjs` already measures the userData tree honestly
  (`inventory()`, `NAMED_SENSITIVE_ENTRIES`) for the uninstaller's question.
  That measurement is reused here rather than restated, so the two can never
  disagree about what the product keeps.
- The settings page carries `uninstall_data` ("When I uninstall ToolsEnabled"),
  default `ask`. It decides what happens AT UNINSTALL TIME. It is not a reset,
  and pressing nothing in it deletes nothing.

## Lookup-ladder note (STANDING-ORDERS LOCAL-WORK rule 0)

`code.*` is unusable in this session: `mcp__toolsenabled-remote__code_status`
reports `NO_LANGUAGE_SERVER_FOUND` for typescript and python, and it resolves
paths on the REMOTE host (`rootError: No directory at C:\Users\joshp\Desktop\wt-capability`),
so it cannot see this tree at all. Symbol lookups below fell through the ladder
to ripgrep/grep, reported here rather than done silently.

## Progress

- [built] `shell/local-data-reset.cjs` (new) — the mechanism. `planReset()` measures,
  `eraseLocalData()` sweeps entry by entry and RE-STATS each entry after removing
  it, so the report is what happened rather than what was attempted. `guardRoot()`
  refuses a relative path, a drive root, any of Windows' own folders by name from
  the environment, and any directory that CONTAINS one. Reuses
  `shell/uninstall-retention.cjs`'s `inventory()` and `NAMED_SENSITIVE_ENTRIES`
  so the reset and the uninstaller cannot disagree about what the product keeps.
- [built] `src/account-reset-copy.js` (new) — the words, plus the defensive readers
  for the two replies. Named `account-*` on purpose: the promise register in
  `tools/test/product-account-surface.test.mjs` discovers account modules by
  filename, so this copy is under that guard automatically.
- [wired] `shell/main.cjs` — `mc-reset:plan` (measures, deletes nothing) and
  `mc-reset:erase` (revoke every session → stop the capability layer → sweep →
  report). Plus `localDataErased`, which stops `writeState()` and the three
  `mc-prefs:*` writers from recreating the folder that was just emptied.
- [wired] `shell/fleet-profile-preload.cjs` — `mcLocalData` with the two methods.
  Neither takes a path.
- [screen] `src/account-markup.js` + `src/views/account.js` — four phases; the
  first press only measures, the second is the only one that destroys. Rendered
  signed-in, signed-out AND on the store-unavailable screen.
- [measured] 27/27 `tools/test/local-data-reset.test.mjs`; 242/242 across every
  suite that covers a file I touched; 31/31 `tools/uninstall-reset-packaged-qa.mjs`
  against the packaged build on a sterile profile.
- [checked] `node tools/account-isolation-session-qa.mjs` still 28/28 (201.1s) with
  these changes in the tree — including the damaged-account-file screen, which now
  also carries the removal control and still shows no create form.
- [honest] The packaged run ends on `outcome=warn`, not `good`: 48 of the 126
  files under userData survive the sweep because the window holding the screen has
  them open (Chromium's own `Cache/`, `Network/`, `GPUCache/`). The screen names
  them and says closing the program releases them. Every planted file of the
  person's data — vault, access log, audit ledger, action log, linked accounts,
  spawn records, purchase list — and the whole installation root were gone,
  measured on the disk after the press.
