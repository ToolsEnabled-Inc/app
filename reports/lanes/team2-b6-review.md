# Lane: team2-b6-review (adversarial review of B6, refusal-copy audit)

Reviewer session. **Nothing was edited in the app tree by this lane** — review only.
Tree: `C:\Users\joshp\Desktop\wt-capability` (branch `packaging/capability-layer`).
Instruments written to the scratchpad, not to the repo.

## Verdict: CONFIRMED (partial status is honest), with three latent holes found

Every load-bearing number reproduced against the current tree, taken immediately
before reporting:

| what | mine | theirs |
|---|---|---|
| `node tools/refusal-copy-qa.mjs` | 14/14, 28s, exit 0 | 14/14, 28s |
| 9 focused suites, `--test-concurrency=1` | 177/177, 3.98s | 177/177, 4.2s |
| `npm run test` | 1287 tests, 1284 pass, **2** fail, 1 skipped, 110s | 1284/1283/**3** |
| `check:naming` / `check:renderer` | exit 0 / exit 0 | same wording |

The two full-suite failures are not B6's. I ran the guard alone: its assertion
prints `These files spawn the packaged ToolsEnabled executable without removing
ELECTRON_RUN_AS_NODE: shell/main.cjs.` — B6 touched no `shell/` file, and its new
harness `tools/refusal-copy-qa.mjs` does `delete environment.ELECTRON_RUN_AS_NODE`.
The third failure they reported did not occur in my run, consistent with their
"another lane was writing the file mid-run" explanation.

## Fences: clean
`git status` shows `src/views/agent.js`, `package.json`, `config/*` and
`BUILD-QUEUE.md` **unmodified**. The agent.js fix was correctly returned as an
unapplied `sharedFileEdits` entry. `reports/lanes/page2-full-view.md` explicitly
declares it did NOT touch `src/views/computers.js`, so B6's edit there does not
collide with that lane.

## Coverage I added, which their sweep did not have — all clean
Driven on a sterile profile against the same staged packaged build:
- **5 distinct first-run walkthrough screens** (1337/550/1760/1577/3175 chars) — 0 identifiers.
- **The account page** `#/account` (1820 chars) — 0 identifiers. They reported it unswept.
- **The agent drill-in** `#/agent/this-computer/controller` (2086 chars) — 0 identifiers.
  Reached BY PRESSING the control captioned "Open full view" on page 2.

## Correction to their unresolved item
Their recipe "Press Pause on the agent page with no turn running to see it" is not
executable. On a clean profile the three controls render **"Pause UNAVAILABLE /
Respawn UNAVAILABLE / Terminate UNAVAILABLE" and are `disabled`**;
`runSessionControl` returns before the refusal string is built. `src/views/agent.js:491`
is a real bare-identifier line but it needs a **live Codex session**, not merely an
idle one. Nobody should sign this off by pressing Pause on a fresh machine.

## Three holes in the builder's own work (absence-case class), proven by execution

1. **The identifier filter is whole-string only; an embedded one is printed verbatim.**
   `refusalSentence({code:'ORG_ROLE_CALL_THREW', reason:'The role could not be sent to
   the organisation store: ERR_IPC_CHANNEL_CLOSED'})` returns that sentence with the
   identifier still in it. `diagnosisOf` rejects a reason that IS an identifier but
   passes one that merely contains one, because it has a lower-case letter. The shape
   is not invented: `src/views/computers.js:680/984/1794` and `src/org-controls.js:68`
   all build `reason: <prose> + ${error?.message}`, and `shell/main.cjs:308`
   deliberately produces an error whose MESSAGE IS THE CODE. Untested — their suite
   covers only the whole-string case. I could not drive it to the glass.
2. **`fallback` and `remedy` are unfiltered code-printing parameters**, contradicting
   `src/refusal-copy.js:291` ("HAS NO PARAMETER THAT WOULD LET A CALLER ASK FOR ONE").
   `refusalSentence({},{fallback:'MC_SETUP_SAVE_FAILED'})` prints it;
   `refusalSentence({code:'BRIDGE_UNREACHABLE'},{remedy:'BRIDGE_UNREACHABLE'})` returns
   `"BRIDGE_UNREACHABLE."` — bare and 20 characters, failing their own MUTE bar.
   No current caller does this; the comment is what a future author will trust.
3. **Double full stop in the new absence branch.** `src/views/setup.js:685` appends `.`
   to `unavailableReason(code)`, whose new unknown-code fallback already ends in one:
   `"...on the strength of this screen.."`. New; the old `String(code)` had no period.

## What is genuinely fixed, verified by execution not by reading
`unavailableReason` over 13 absent/hostile inputs (`undefined`, `''`, `'toString'`,
`'__proto__'`, `0`, `false`, `{}`, an unlisted `ERR_IPC_CHANNEL_CLOSED`): 0 bare
identifiers, 0 fragments. The family floor holds — a fabricated
`BRIDGE_QUANTUM_FLUX_REFUSED` still leaves with a whole actionable sentence.

## Limitation of my own measurement
My drivers staged the existing `dist/` (built 16:03). Every B6 source file predates
it, so B6's work IS what I measured; other lanes' later edits (`src/views/setup.js`
16:05) are not. I did not rebuild `dist/`, deliberately, to avoid a partial-build
window for the concurrent wave-2 drivers.
