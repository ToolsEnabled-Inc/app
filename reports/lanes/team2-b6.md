# TEAM 2 / B6 — refusal-copy audit: no bare identifier in front of a person

Tree: `C:\Users\joshp\Desktop\wt-capability` (branch `packaging/capability-layer`).
No git write commands. Working-tree edits only.

Fences honoured: `src/views/agent.js`, `src/views/setup.js`, `src/views/account.js`,
`src/account-state.js`, `src/account-markup.js`, `shell/*`, NSIS,
`tools/packaged-qa-suite.mjs`, the loop/page2/team-panel/owner-popup/agent-subpage QA
drivers. The one fenced site B6 needs is routed as an exact edit, not applied.

## The inventory, found by scanning for a code reaching a rendered string

Ten sites, nine found by `${...code...}` interpolation and one (mission-bridge 741)
written as a LITERAL identifier, which is why an interpolation scan missed it:

| file | shape |
|---|---|
| `src/views/computers.js` | `refused · ${result.code} · ${result.reason}` |
| `src/write-surfaces.js` | `refused · ${result.code} · ${result.reason}` |
| `src/cloud-tasks-controller.js` | `${result.code} · ${result.reason}` (5 messages) |
| `src/agent-loops.js` | `${result.code}: ${result.reason}` |
| `src/agent-loops.js` | `... was NOT confirmed stopped (${code}).` |
| `src/agent-teams.js` | `${result.code}: ${result.reason}` (lead + member) |
| `src/mission-bridge.js` | `${code}: ${reason} No stop has been confirmed.` |
| `src/mission-bridge.js` | `${result?.code}: ${reason}` (archive preview + execute) |
| `src/mission-bridge.js` | `BRIDGE_IDEMPOTENCY_UNAVAILABLE: ...` (literal) |
| `src/org-controls.js` | `${fallback} (${result.code})` |
| `src/views/agent.js` **FENCED** | `${id} did not happen · ${result?.code}` |

Plus the prior-art module's own escape hatch: `unavailableReason()` ended
`|| String(code)`, so any code with no table entry was printed verbatim.

## What changed

- NEW `src/refusal-copy.js` — curated remedy table + prefix FAMILIES (so a code the
  engine adds next month cannot reach a customer bare) + `refusalSentence()`,
  `refusalRemedy()`, `refusalCodeOf()`, `markRefusalCode()`.
- The ten in-territory sites rewired. The identifier is kept as a machine field
  (`state.code`, `data-refusal-code`) and never in visible text.
- `src/agent-availability-copy.js` — sentences for the eleven session-steering codes
  the agent page renders; `unavailableReason()`'s bare-code fallback closed.
- NEW `tools/test/refusal-copy.test.mjs`, NEW `tools/refusal-copy-qa.mjs`.

## Progress log

### 2026-08-11 16:0x — verified

- `node --test` over the 9 affected suites: **177/177 pass, 4.1s** (completed run).
- `node tools/refusal-copy-qa.mjs`: **13/13 checks, 23-27s** across four runs, on a
  sterile packaged profile. Ring walk = 7 screens, 0 identifiers. Three refusals DRIVEN
  by pressing: fleet Dispatch (`BRIDGE_AGENT_DECLARATION_MISSING`), Codex Cloud Refresh
  and the automatic environments read (both `ACCOUNTS_REGISTRY_MISSING`). Codes carried
  as `data-refusal-code`, absent from visible text, every line ends with an action.
- `npm run check:naming` OK; `npm run check:renderer` OK.
- Full `npm run test`: 1283/1287. The 3 failures are outside this diff —
  `shell/main.cjs` (ELECTRON_RUN_AS_NODE, oauth lane, edited 13:23),
  `shell-port-scan-contract` #7, and one product-account assertion that PASSES
  standalone and whose files were being edited by the oauth lane at 16:04 mid-run.

### Found only by driving, not by reading
`ACCOUNTS_REGISTRY_MISSING` and `BRIDGE_AGENT_DECLARATION_MISSING` are what a clean
machine actually returns; neither appears in any code list in this repository. Both fell
to the generic remedy until the driver surfaced them, and "try once more" is the wrong
advice for a missing account registry. Both now curated.

### Adjacent finding, NOT fixed (out of B6's scope, reported not silently repaired)
`src/views/computers.js` builds `reason: \`... ${error?.message || error}\`` for
ORG_REPARENT_THREW / ORG_ROLE_CALL_THREW / ORG_ASSIGN_ROLE_THREW. That is a raw IPC
error message rendered into the DOM and it can name a filesystem path — the BLOCKER-2
class, not the bare-identifier class. Left alone deliberately.

### Final runs (taken immediately before the report)
- `node --test --test-concurrency=1` over 9 suites: **177/177, 4.2s**.
- `node tools/refusal-copy-qa.mjs`: **14/14, 28s**. Nine screens swept (home,
  computers, metrics, research, comms, ledger, approvals, guide, settings — settings
  alone is 15,470 visible characters), 0 identifiers. Three refusals driven by pressing.
  The account page had no door on the screen the sweep looked from, so it is NOT covered
  by the sweep; the agent drill-in and checkout are not covered either.

### Line endings, for the coordinator's diff review
`git diff --stat` reports whole-file changes for `src/views/computers.js`,
`src/write-surfaces.js` and `tools/test/terminate-ui.test.mjs`. That is line-ending
noise, not content: `--ignore-cr-at-eol` reduces them to 66 / 132 / 15 lines. It is NOT
from this lane — `src/views/ledger.js`, which B6 never touched, shows the same
(888 plain vs 12 with the flag), and of the four test files B6 edited only one shows it.
Review this diff with `git diff --ignore-cr-at-eol`.
