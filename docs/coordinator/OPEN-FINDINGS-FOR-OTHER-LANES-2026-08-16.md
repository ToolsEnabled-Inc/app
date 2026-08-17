# Open findings for other lanes (2026-08-16)

Measured by the research-subsystem lane while shipping 1.0.17. None of these is
this lane's to fix; each is recorded so it is not re-discovered from scratch.
Evidence is file:line or a driven measurement on the installed build.

## 1. `actions.js:802` references a constant that does not exist — BLOCKING for Claude lanes

`src/lib/mission-bridge/actions.js:802` (engine) uses
`CONFINED_LANE_DISALLOWED_TOOLS`, which is defined nowhere on this tree.
`CONFINED_LANE_TOOLS` is defined at `:786-788` and never used. Both are in an
**uncommitted working-tree edit** (`actions.js` was already dirty at the start of
2026-08-15; `git show HEAD:` has neither name). Any guided/standard Claude lane
dispatch will `ReferenceError` when that edit lands as written.

Owner: whoever holds the in-flight `actions.js` change.

## 2. The shipped `claudeArgs` omits the Skill tool

The committed lane argv emits `--tools Read,Edit,Write,Glob,Grep` — no `Skill`.
Observed in the live lane proof on 1.0.17 (the spawned `claude.exe` command
line). The intended removal/addition lives in the same uncommitted `actions.js`
as finding 1.

## 3. `capability.tier` and `capability.workspace_roots` declare no enforcement

`config/settings-registry.json`: both rows have an empty `enforcedBy`, so
`loadSettings().enforcement[id].declared === false` — which by the settings
doctrine (`src/lib/settings.js:106-120`) is a CERTAINTY that nothing reads them.
The machine record IS enforced; these rows are not the thing enforcing it. Per
the owner's standing rule ("a user setting has to be changeable in the software,
with real enforcement, or it is a lie"), either wire them or say plainly on the
surface that they describe rather than control.

Owner: the settings/capability lane.

## 4. WITHDRAWN — the failed node after a refusal is deliberate

Originally filed as "a refused start litters the tree": driven on installed
1.0.17, pressing Start with a Claude tier refuses correctly (zero processes
spawned, audit records `result: refused`) and leaves a node reading
"Default 2 / FAILED / NO RUNTIME".

**That is intended behaviour, documented at `src/views/computers.js:1770-1773`:**
"the start is refused — the node stays, marked as failed, with the reason on
it. It is NOT deleted: a person who just described a job should not have to
type it again to find out what went wrong." The node is in-memory only
(graph revision unchanged, no launch files written).

Left here as a withdrawal so nobody "fixes" a deliberate decision. If the
accumulation of failed nodes across repeated attempts ever becomes the
complaint, that is a separate question about pruning, not about this rule.

## 5. The agent card denies a lane that completed on its own seat

After a lane ran to completion on `#/agent/this-computer/claude` (exit 0,
presence `status:"finished"`), the card still read **"no runtime reported"** and
the chat area **"running sessions could not be read"**. The run happened and the
presence registry says so; the page never admits it.

Owner: agent-page lane.

## 6. The two dispatch surfaces label Claude differently

`#/computers` compose panel: `Fable · Claude — cannot start here yet`.
Agent page "Hand work to an agent": `Fable`, with no qualifier — and that one
**works** (it is the lane path). Each label is correct for its own surface, but
a person reading both sees a contradiction. A one-line pointer on the tree
door ("Claude agents start from the agent page's hand-off form") would close it.

Each label is correct for its own surface — the tree door genuinely cannot
start Claude (licence fence), and the hand-off form genuinely can (lane path).
The gap is that nothing tells a person the second surface exists, which is
really finding 7. Owner: copy/fleet lane.

## 7. No click path to the hand-off form on a fresh install

The only surface that can start a Claude lane (`#/agent/<computer>/claude`) is
reachable by address only until something has already run: the tree is empty by
design on a fresh install, and the recorded-agent rail's "Open full view"
appears only for observed agents. Also, the rail's own "Launch controls" box
dispatches with a **fixed brief** ("Lane requested from the fleet page…") and no
text field.

Owner: fleet/onboarding lane. Relevant to the workbench plan, which adds real
entry points.

## 8. Harness notes (already in RELEASE-CUT-TRAPS)

`Page.captureScreenshot` intermittently hangs >45s in the headless config used
for driving; retries were needed on nearly every shot during the 1.0.17 drive.

## 9. The state root is decided at module load — a probe/test that sets `TOOLSENABLED_STATE_ROOT` too late silently targets the REAL user state

`runtime-state-root.js` memoises `stateRootRecord()` once per process, and the
record is resolved by the time the engine modules finish loading. Consequence,
measured 2026-08-16: a probe that `require()`d the installed payload's
`r-ledger.js` BEFORE setting `TOOLSENABLED_STATE_ROOT` wrote 76 test entries
into the owner's real `%APPDATA%\ToolsEnabled\capability\reports\R-LEDGER.md`
(cleaned the same hour; verified 76/76 entries probe-stamped before deletion).
Four probes confirmed the rule both ways: env set before require → isolated;
require first → real root, regardless of env set later.

Rule for any test or tool touching payload/engine modules: set
`TOOLSENABLED_STATE_ROOT` (and any root overrides) BEFORE the first require,
or use `resetStateRootForTests()` where exported. Worth a guard: a debug-only
warning when the env var changes after memoisation, since the failure is
silent and writes to real user data.

Owner: engine runtime lane; every lane writing tests against the payload.

## 10. FIXED in engine 073ef11 — filed /Requests could brick every agent boot

Follow-on from the install read-root fix: the pinned owner-requests block had
no cap, and the packet fails closed over its ceiling. Measured on installed
1.0.19: ~36 average /Request entries → AGENT_ONBOARDING_PACKET_TOO_LARGE for
EVERY packet, all scopes — no lane could start and every checkout hook
refused, with nothing on any surface saying why. Engine commit `073ef11` caps
the block at 40% of the scope ceiling (withhold thread → trees → session
whole with path-naming notices; global sheds oldest-first, newest always
survives; trim announced in the packet and `unknowns`). The payload source
worktree (`C:\lanes\free-cut-engine-src`) is already advanced to `073ef11`
(clean fast-forward from `8075a8d`, verified by ancestry) — the next cut
ships it with no further action. Until that cut installs, an installed
build carries the vulnerability.
