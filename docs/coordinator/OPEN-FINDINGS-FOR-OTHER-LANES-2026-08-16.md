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

## 4. A refused start still litters the tree (page 2)

Driven on installed 1.0.17: pressing Start with a Claude tier refuses correctly
("Nothing was started. This copy starts Codex agents from the tree…", zero
processes spawned, audit records `result: refused`) — but the page leaves a
node reading **"Default 2 / FAILED / NO RUNTIME"** and renames the original to
"Default 1". It is in-memory only (graph revision unchanged, no launch files
written), so nothing is persisted; the tree still shows a failure for something
that never started.

Owner: page-2 / fleet-tree lane.

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

Owner: copy/fleet lane, alongside finding 4.

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
