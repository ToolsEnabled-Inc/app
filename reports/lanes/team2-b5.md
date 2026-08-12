# Lane: team2-B5 — LEGACY-ONB-001, the unavailable-host / first-run dead end

Tree: `C:\Users\joshp\Desktop\wt-capability` (branch `packaging/capability-layer`).
No git write commands were run. Working-tree edits only.

## CORRECTION TO THE FINDING'S PREMISE, FIRST LINE

Machine B reported that **nothing** on Home, Settings, the Fleet Graph or the Comms Board
explains the prerequisite. Measured here on a sterile profile before a line was changed,
that is true of three of the four and **wrong about Home**: Home already carried the
Codex prerequisite in full, with the exact command —

> Codex is not installed on this computer, and it is the program that runs an agent.
> Run "winget install OpenAI.Codex" in Windows Terminal, then "codex login"

What Home actually lacked was a way forward from the *other* two dead ends on it — "This
is the only computer connected" and an empty panel with no control at all. The three
other screens were as reported. Baseline: **7 of 18 checks** passed
(`node tools/first-run-recovery-qa.mjs`, 23.8s, 2026-08-11 14:31).

## The second correction, and it is the one that shaped the fix

The obvious repair — "connect a computer and these screens fill in" — would have been a
**lie**, and the fleet graph was already telling a softer version of it ("It fills in on
its own once a computer here is running an agent host this copy can read").

`dist/data/*.json` are BUILD-TIME outputs of `tools/gen-*.mjs`, which read the builder's
own engine roots (`CANONICAL_ROOT` / `LIVE_ROOT`). They are packed into the read-only
`app.asar` (verified with `asar.listPackage`) and **no process on a customer machine
writes them**. So all seven ship `ok:false` with "No local agent fleet host detected on
this machine." permanently, on every install. Waiting fills in nothing; there is no
setting and no command that changes it.

The guide therefore separates what a person *can* clear (Codex, the write switches, each
with the exact command or switch) from what nobody can clear from this window, and says
the second one flatly. `tools/test/first-run-needs.test.mjs` asserts that separation:
the host section must be `fix: 'none'` and must not match `/fills in on its own/`,
`/connect (a|another|your) computer/` or `/install an agent host/`.

## Scope: SIX screens, not the four the finding named

The finding named Home, Settings, the Fleet Graph and the Comms Board. The directive says
*every* unavailable-host state, so Metrics, Research and the Ledger were walked too — they
reach the identical state on the identical install. All three had bare refusals; all three
now lead somewhere. Metrics carries the **door only** and not the explanation, on purpose:
it reports its absence per component, eight times, and an explanation repeated eight times
would bury the page in the apology the fleet graph was just rescued from.

## What changed

New:

- `src/first-run-needs.js` — the copy, as data, plus `hostAbsentMarkup()` which returns a
  STRING and touches no DOM API, so a plain node test and the packaged driver can both
  import it. One `GUIDE_ACTION`, so six screens cannot offer six differently worded doors.
- `src/views/guide.js`, `src/guide.css` — route `#/guide`, "What this copy needs".
- `tools/test/first-run-needs.test.mjs` — 13 tests, absence cases first.
- `tools/first-run-recovery-qa.mjs` — the packaged driver, sterile profile, clicks only,
  `--shoot` for the screenshots.

Edited:

- `src/main.js` — the route (import, `parse`, `makeView`, `crumbFor`, `RING_EXIT`). Off
  the ring like `account`; both arrows return home.
- `src/local-activity.js` — the peer fact is a link in both terminal states; the empty
  panel offers the guide when the engine is not ready (it offered `null`, which is the
  measured dead end). No sentence changed: they were right.
- `src/views/computers.js` — the rail notice and the empty panel. The rail no longer
  repeats the reason the panel prints.
- `src/views/comms.js` — the whole-projection failure only, in the watch-board preview
  (the default view) as well as the log. The bare line stays for a PARTIAL failure, where
  the person is looking at a working board with one source missing.
- `src/views/research.js`, `src/views/ledger.js` — the whole-projection branch. The
  ledger's loading branch keeps the bare line: a page still reading has established no
  absence.
- `src/views/metrics.js` — the door beside `#mf-note`, added and removed with the state so
  a stale "why is this empty" link cannot sit over a page full of numbers.
- `src/views/settings.js` — `SECTION_NOTES` under Data & Sim and Write. Display only; no
  write path touched.
- `tools/test/home-screen.test.mjs` — 2 tests (25 total, was 23).

## Evidence, all off completed runs against the current tree

| command | result | when |
|---|---|---|
| `node tools/first-run-recovery-qa.mjs` (before) | **7/18**, exit 1, 23.8s | 14:31 |
| `node tools/first-run-recovery-qa.mjs` (after) | **41/41**, exit 0, 24.0s | 15:07 |
| `node --test tools/test/first-run-needs.test.mjs tools/test/home-screen.test.mjs` | 38/38, exit 0, 1.3s | 15:11 |
| `node tools/agent-route-reachability.mjs` | ALL CHECKS PASSED, exit 0 | 15:09 |
| `node tools/stranger-onboarding-qa.mjs` | 65/65, exit 0 | 15:10 |
| `npm test` | 1268 pass / **2 fail**, exit 1, 107s | 15:05 |
| `node tools/check-product-naming.mjs` | exit 0 | 14:45 |
| `node tools/check-suites-discovered.mjs` | 97/97 reached, exit 0 | 14:45 |
| `node tools/check-renderer-payload.mjs` | OK, exit 0 | 14:45 |

Screenshots: `artifacts/b5/` — home, fleet graph, comms board, settings, settings/Data and
Sim, and the guide top and bottom in white, tan and black.

## One intermittent, reported rather than smoothed over

One driver run out of six failed at `setup ends in the app` with `hash=#/setup` — the
first-run walkthrough did not complete. The runs either side of it passed the same step,
and `stranger-onboarding-qa` (which walks the same walkthrough four times per run) was
65/65 twice. This is the double-mount hazard `reports/lanes/setup-deadend.md` documents in
`swapView()`; `src/views/setup.js` is FENCED, so it is reported, not touched.

## The two `npm test` failures are NOT mine

`electron-run-as-node-harness-guard` (names `shell/main.cjs`) and
`shell-port-scan-contract #7`. `git status --porcelain shell/` returns **0 lines** — that
directory is byte-identical to HEAD, so both failures exist on the committed tree and no
working-tree edit of mine reaches them. My own new driver spawns the packaged app and
strips `ELECTRON_RUN_AS_NODE`; the guard did not name it.

## Two things a text-only check would have passed, caught by looking

Both were found in screenshots (`artifacts/b5/`), not by any assertion:

1. The comms notice landed in the `max-content` first track of the preview's two-column
   name-rail grid and ran off the right edge behind a horizontal scrollbar — the
   explanation half-read as "No agent host has repo". Every text assertion passed while
   it was broken, because the words *were* on the page.
2. The floating `.fleet-profile-notice` covered the guide's reading column with a
   two-line version of the paragraph the page exists to give properly. Suppressed on this
   route with `:not(.is-serious)`, matching home.css:532 / agent.css:87 / setup.css:186 —
   the qualifier is load-bearing: a serious notice means the person's own saved profile
   failed to load, which this page has no answer for and no right to hide.

## Where the driver could be accused of grading its own homework, and what stops it

The packaged driver imports `src/first-run-needs.js` and looks for THOSE sentences on the
glass, rather than matching a regex typed into the driver. That is deliberate: the failure
mode in this codebase is a helper that exists while the call site still names a literal —
module right, screen wrong — and a source-text check waves it through. It does mean the
driver cannot judge whether the copy is any good; it judges whether the screens are wired
to it. Three things carry the rest of the weight: the copy-module test forbids the promise
the guide must not make, the screenshots are the taste check, and `EXPLAINS_CLAUSE` is
sliced out of the live value and exits 2 at startup if the module no longer contains it,
so a rewrite that drops the clause fails loudly rather than measuring nothing.

## Left alone deliberately

- `src/views/setup.js` and `src/views/account.js` are FENCED (OAuth lane). The first-run
  gate blocks every route but `#/setup`, so `#/guide` is unreachable during the
  walkthrough — correct, and not changed.
- The per-component refusals on Metrics and Research ("aggregate projection has no
  token-flow time series", "Corpus catalog unavailable"). Those are a page that DID read
  with one part missing, which is a different state from this finding and reads correctly.
- The projections themselves. Making them answerable on a customer machine is an engine
  question, not a screens one — and it is the real fix behind all of this.
