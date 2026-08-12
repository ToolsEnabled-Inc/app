# Lane team4-D10 — onboarding documentation for a stranger

Tree: `C:\Users\joshp\Desktop\wt-capability` (branch `packaging/capability-layer`).
No git write commands. Working-tree edits only.

## What the lane was sent to do

Write the onboarding documentation a real stranger needs — download, install,
first launch, what the permission levels mean, how to reach a running agent,
what to do when a prerequisite is missing, how to get help. Ship it where the
product can link to it. Verify every instruction by following it on a sterile
profile.

## Facts established before a word was written (all measured on this machine)

- Installer: `release\ToolsEnabled Setup 1.0.6.exe`, 101,887,681 bytes, built
  2026-08-11 12:23. `Get-AuthenticodeSignature` → **NotSigned**. So SmartScreen
  is guaranteed on a stranger's machine and the doc must say so.
- NSIS config: `oneClick: true`, `perMachine: false` → per-user install, no UAC.
- Measured on the already-installed copy: install root
  `%LOCALAPPDATA%\Programs\toolsenabled`; Start-Menu shortcut
  `%APPDATA%\...\Start Menu\Programs\ToolsEnabled.lnk`; **no Desktop shortcut**;
  uninstall entry `HKCU:\...\Uninstall` DisplayName `ToolsEnabled`, UninstallString
  `"...\Uninstall ToolsEnabled.exe" /currentuser`, and `InstallLocation` is an
  **empty string**.
- Data locations: `%APPDATA%\ToolsEnabled` (userData: agent-spawn-records.jsonl,
  workspace, renderer-prefs.json, shell-state.json) and `%LOCALAPPDATA%\ToolsEnabled`
  (machine.json, machine-record.key, settings.json, agent-home\<tier>).
- `winget show OpenAI.Codex` → Codex CLI 0.146.1, publisher "OpenAI, Inc.",
  support URL github.com/openai/codex/issues. The install command in the
  product's own copy is real.
- There is **no public download** today: `tools/release-packager/serve-candidate.mjs`
  serves one file over the LAN behind a one-shot bearer token, and
  `verify-candidate.ps1` is the receiver's half.
- There is **no support address**: `SECURITY.md` in the engine tree is a DRAFT
  that says its own §4 contact is still missing.

## What shipped

- `public/help/getting-started.html` — the page. Self-contained: no script, no web
  font, no image host, no external request of any kind, so it works on the machine
  that is not working yet. `vite` copies `public/` verbatim into `dist/` (proved by
  hashing two existing pairs), `dist/**` is in `package.json` `build.files`, and the
  product's own loopback server maps `.html` to `text/html` — so the running product
  serves it at `http://127.0.0.1:<port>/help/getting-started.html`.
- `config/renderer-payload-boundary.json` — `help/getting-started.html` classified
  `shipped`. **This was not optional**: `tools/check-renderer-payload.mjs` fails the
  build on any authored file under `public/` that is classified nowhere, and it did
  fail (`1 unclassified`) until the entry was added. Adding a page to `public/` without
  this line would have broken `npm run dist` for everyone.
- `tools/onboarding-doc-qa.mjs` — re-follows the page's instructions inside the
  packaged window on a sterile profile. Every check is a PAIR: a phrase that must be in
  the page, and a measurement in the product. A claim leaving the page fails the suite
  too, so the suite cannot quietly come to guard nothing.

## The corrections the measurement forced

The first draft was written from the source and was wrong in five places. Each was
found by running the walkthrough, not by re-reading:

| the page claimed | what the screen does |
|---|---|
| "Question 1 of 3" | question 1 carries **no** progress label — `paint()` uses `markup()` alone for the tier step |
| "There is a Skip on the first screen" | there is not; `Skip the rest for now` first appears on question 2 |
| press Continue on question 3 | that button says **See what that sets** |
| installer ~100 MB, unpacks to ~550 MB | 97 MB installer, **355 MB** installed |
| "no desktop icon" | unmeasurable without running the installer (fenced NSIS lane) — claim removed rather than guessed |

Two more were corrected against Windows itself rather than the app: the registry claim
(there are **two** HKCU keys, not one — `Software\<GUID>` as well as the uninstall
entry) and the SmartScreen claim (it depends on the file carrying a mark-of-the-web,
which a LAN or USB hand-off may not; the page now says so and says its absence is not
evidence the build is signed).

In every case the fix was the page. The product's behaviour was defensible each time —
question 1 has no Skip *because* the level is the gate everything after it depends on.

## Verified externally

`github.com/orgs/ToolsEnabled/repositories` holds exactly one public repository,
`.github` (the profile). No product repository, no releases, no issue tracker. That is
what makes "there is no download page" and "there is no support address" statements of
fact rather than modesty.

## HANDOVER: the one line that makes the product link to it

The page is served and a link to it demonstrably works — measured, not assumed:
`window.open('/help/getting-started.html')` from the app produced two page targets,
`.../help/getting-started.html` and `.../`, so the document opens and the application
window survives. **This lane did not add the anchor.** The natural home is the guide
page, and `src/views/guide.js` / `src/first-run-needs.js` are team2-B5's *untracked*,
under-review work with two open defects (`reports/lanes/team2-b5-review.md`). Editing
another lane's uncommitted files is a collision failure even when the change is right.

For whoever owns that file, in `guideView()`'s `<footer class="guide-foot">`:

```html
<a class="guide-foot-link" href="/help/getting-started.html" target="_blank">Full setup instructions</a>
```

`target="_blank"` is load-bearing. Without it the frame navigates off the single-page
app and there is no chrome to come back with — the application menu is
`Menu.setApplicationMenu(null)` and the two arrows are hash-router controls, so a person
would be stranded with no route home but closing the window.

What was **not** measured: what that second window looks like. It was opened 1×1 at
(-4000, -4000) on purpose, so as not to flash a window onto whatever the owner was
looking at. Whoever lands the anchor should look at the result with their own eyes.

## Evidence, all off completed runs immediately before reporting

| command | result |
|---|---|
| `node tools/onboarding-doc-qa.mjs` | **43/43, exit 0**, 18.8s, 0 FAIL lines |
| `node tools/check-renderer-payload.mjs` | 22 classified, 0 unclassified, **exit 0** (was exit 1, `1 unclassified`, before the manifest entry) |
| `node tools/check-no-owner-data.mjs dist` | 37 files, **0 matches**, exit 0 |
| `node tools/check-product-naming.mjs` | 6 documents, 2 plans, consistent, exit 0 |
| `node --test checkout-privacy + empty-envelopes + data-schema-coverage` | 18 pass / 0 fail / 1 skip, exit 0, 4.9s |
| `winget show OpenAI.Codex` | Codex CLI 0.146.1, "OpenAI, Inc." |
| `codex login --help` | subcommand `status` exists — the page's `codex login status` is real |
| `Get-FileHash '…Setup 1.0.6.exe' -Algorithm SHA256` | `E560856C…F058`, 181ms — the page's own verification command, run verbatim |

## BLOCKER FOUND, not mine, affects everybody in this tree

`npm run build` and therefore `npm run dist` **cannot run in wt-capability right now**.
`node_modules/.bin` is absent, `node_modules/@electron/asar` is absent, and
`node_modules/@rollup/` is absent, so `vite` is unresolvable and rollup throws
`MODULE_NOT_FOUND` on its native binding. `node_modules` was last written 16:34 today,
six minutes after the last successful build at 16:28 — consistent with an `npm install`
that was interrupted or is in flight. **This lane did not run `npm install`**: that is
shared state in a tree with six live lanes.

Consequences for this work, stated plainly rather than glossed:
- `dist/help/getting-started.html` was staged by copying `public/help/getting-started.html`
  byte-for-byte, which is exactly what vite's `publicDir` copy does (proved by hashing
  `public/brand-icon.svg` and `public/data/fleet.json` against their `dist/` twins).
- `tools/onboarding-doc-qa.mjs` therefore runs the payload as `resources/app/` with the
  copy's `app.asar` removed, instead of repacking the archive. Same shell, same
  renderer, same binary — but **not** a measurement of an archive `electron-builder`
  produced. Nobody should read this lane as evidence that a fresh installer contains the
  page; it is evidence that the page is in `dist/`, that `dist/**` is packed, and that
  the product serves it.
