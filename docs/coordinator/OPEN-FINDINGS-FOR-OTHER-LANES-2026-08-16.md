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

## 11. FIXED — "there is no way to start an agent", and why two fixes missed it

The owner reported this twice, months apart: *"I cant scroll down to even press
start"*, then *"there is no way to start an agent"*. Both times the panel was
correct in the DOM and wrong on the glass.

**The shape of it.** The compose panel holds more than the rail is tall (~765px
of form against 560-700px of rail). Whatever sits at the bottom of that column
is invisible at first paint. Fix #1 made the form scroll, which made Start
*reachable* and left it *unseen* — that commit was called "Start is reachable".
Fix #2 (mine) pinned Start beside the scroller, which fixed the button and
pushed the BRIEF BOX below the fold instead: same defect, one field up. Only
the third change held, and it was not a layout trick — it was ORDER. The panel
is designed as "two fields and two buttons"; the assistant and effort choices
added later carried two lines of help each and crowded out the one thing a
person opens the panel to write. Role and brief now come first.

**Why every test stayed green through all of it.** A fake DOM has no layout.
`node --test` can prove a control EXISTS and can never prove a person can SEE
it. 53 panel tests passed while the button was off-screen, twice.

**What now exists so it cannot recur quietly:**

- `tools/compose-start-layout-qa.cjs` — measures the real built stylesheet
  against the real panel structure in a rail-sized box at three window heights,
  and PRINTS which sizes actually overflowed, so a green run cannot be mistaken
  for coverage it did not have.
- `tools/test/agent-compose-panel.test.mjs` now pins BOTH failure modes
  together: Start must not be inside the scroller (falls below the fold) and
  must not be unpinned (clipped by the rail), and the action row must keep
  `flex: none`. Each assertion alone permits one of the two defects — which is
  exactly how the first fix traded one for the other.

**The transferable lesson for any rail surface:** if a panel can be taller than
its container, the control that completes the task must live OUTSIDE the
scroller, and something with layout has to measure it. A unit test cannot.

**Verified on the installed build**, not in a harness:
`node tools/agent-start-flow-qa.mjs --release <installed 1.0.23>` reports role,
brief and "Start this agent" all present and shown — 24/26 checks, zero
failures. The same driver reported 14/26 and "no send control in the panel"
before the work. The two remaining checks are NOT EXERCISED because the harness
cannot substitute a start reply through `window.mcAgent`, a non-configurable
contextBridge property; that is the sandbox working.

Shipped in 1.0.23 (`094d0d5`, `0369dcf`).

## 12. Finding 7 confirmed by three independent drivers: after setup, a stranger has no visible way to start anything

Filed originally as "no click path to the hand-off form on a fresh install".
Three packaged drivers, run against installed 1.0.23, now say it harder and
from three different directions:

- `first-run-contract-qa`: *"the recommended path draws this computer on the
  fleet page"* — **nodes=0**; *"the door into the agent page can be pressed"* —
  **zero-size**; *"THE RECOMMENDED PATH LEAVES A START CONTROL ON THE AGENT
  PAGE"* — **present=false visible=false**, with `mc.write.agent-session`
  reported as `"enabled"`, so the write flag is NOT the reason.
- `stranger-onboarding-qa`: *"the door into the agent page can be pressed"* —
  **not-visible**; *"the agent page is reachable by clicking"* — fails;
  *"a start control is on the page it reached"* — `startControls: 0`.
- `refusal-copy-qa`: two driven refusal paths report **UNMEASURED — the control
  could not be reached**.

**A door that is zero-size is the same defect class as the Start button
(finding 11): present in the DOM, absent on the glass.** That is now three
surfaces in one night with the same shape, which makes it a pattern rather
than a coincidence, and worth a rule: any door this product ships should be
measured for SIZE and VISIBILITY, not for existence.

**Two honest qualifications**, so nobody over-reads this:

1. These drivers run sterile profiles where **Codex is not installed**, and
   the same runs show the product being truthful about that — home says *"Codex
   is not installed on this computer, and it is the program that runs agents"*,
   gives the exact `winget install` command, and readiness answers
   `AGENT_CODEX_CLI_NOT_INSTALLED`. Some of the missing controls may be correct
   refusals rather than gaps. The drivers assert they are contract violations;
   the fleet/onboarding lane owns that judgement.
2. Everything above pre-dates tonight's compose-panel work and is not caused by
   it: the string "compose" appears **zero** times in either failing log.

Owner: fleet/onboarding lane. Setup itself is in good shape — the whole
stranger path (permission question, folder, autonomy, review, accept, land in
the app) passes, and names Codex before it finishes.

### Correction to finding 12: it is not established as a product defect

Read further before acting on the above. `src/tree-graph.js:67-75` says, in
capitals and for a documented reason, that an empty slot **is not**
`.static-tree-node`:

> AND IT IS NOT `.static-tree-node`. That class means "a running agent" to nine
> QA harnesses on this tree [...] A slot wearing that class would make all nine
> quietly measure something that is not an agent.

`first-run-contract-qa.mjs:984` counts exactly that class:
`document.querySelectorAll('.computers .static-tree-node').length`, and asserts
`>= 1` under the name *"the recommended path draws this computer on the fleet
page"*. On a fresh profile there are **no running agents**, so 0 is the correct
answer to what it measures, and the page may well be showing the empty slot it
is supposed to show. `extensionPoints()` (`src/fleet-trees.js:628-644`) always
offers a `kind:'tree'` point while under the tree cap, so a fresh profile HAS a
new-tree slot to draw.

The two downstream failures inherit the same doubt: `.graph-open-btn` ships
`hidden` and is revealed by selecting an agent node, so with no agent nodes it
is correctly hidden and correctly measures zero-size.

**Corroborating evidence the page is not empty:** on the SAME installed build,
`agent-start-flow-qa` found an empty node, pressed it, and opened the compose
panel — *"the fleet page offers at least one EMPTY node — 1 found (declared)"*.

So finding 12 stands only as **"three harnesses disagree with the product's own
documented design"**, which is a harness question first. What would settle it:
count slots by their real selector in those drivers, or drive a press. Until
then nobody should go fix a fleet page that may be behaving correctly.

Recorded rather than deleted, because the original reading was mine and a lane
reading only the first version would chase a defect that may not exist.

### Finding 12 CLOSED — measured, not argued: the canvas is not bare

Instrumented `first-run-contract-qa` to print the empty-slot count beside the
agent-node count and re-ran it against installed 1.0.23. The failing line now
reads:

> `FAIL the recommended path draws this computer on the fleet page --
> nodes=0; empty slots on the canvas=1 -- the canvas is NOT bare: a slot is
> there to press`

So after the recommended setup path, on a fresh profile, the fleet page **does**
offer a pressable slot. And in the SAME run, this passes:

> `ok the recommended path reaches a startable agent within 12 clicks --
> 7 clicks including Start; budget 12`

**A stranger can start an agent in seven clicks from first paint.** The three
failures are the harness asserting on `.static-tree-node` — the running-agent
class that `src/tree-graph.js:67-75` deliberately withholds from slots — and the
two downstream checks that depend on an agent node existing to reveal
`.graph-open-btn`.

Nothing for the fleet/onboarding lane to fix here. What remains is a harness
question for whoever owns `first-run-contract-qa`: decide whether "draws this
computer" means an agent node (then a fresh profile can never satisfy it) or a
canvas a person can act on (then count slots too). The diagnosis is now printed
either way, so the next reader gets the answer instead of the ambiguity.

## 13. UNRESOLVED, for the settings lane: can a write action be switched on from Settings?

`refusal-copy-qa` against installed 1.0.23 reported:

```
write toggles: {"pressed":["Dispatch agent lanes: no control",
                           "Launch Codex Cloud tasks: pressed"],
                "dispatch":"enabled","cloud":"disabled"}
```

Two things in one line: it found **no control** in the Dispatch row, and it
**pressed** the Codex Cloud control and the flag **stayed disabled**. Its
"Dispatch can be switched on" check then PASSED only because that flag was
already enabled — so that pass proves nothing about switchability.

This matters because of the owner's own doctrine: a user setting needs a row,
real enforcement, AND a control in the software, or it is a lie.
`setWriteEnabled` (`src/write-flags.js:42-51`) has no refusal path — it always
writes — so a correctly wired toggle should have taken effect.

**NOT ESTABLISHED, deliberately.** Two probes of my own failed to settle it and
neither failure was the product's: the first assigned `location.hash` without a
reload and measured the home page (the router reads the hash at boot); the
second found the label inside a `div.fleet-profile-status` — a status line, not
a settings row — and a third attempt timed out scanning the DOM. So I cannot
say whether those rows carry a working control, and the harness's own selector
(`row.querySelector('button, input[type=checkbox], [role=switch]')`) may be
missing it exactly as mine did.

**What would settle it in one pass:** open `#/settings` in the packaged app
(set the hash then RELOAD), locate the write-action rows by whatever selector
`src/views/settings.js` actually renders, and report their controls. If a
control exists and pressing it leaves the flag disabled, that is a real defect
against the doctrine. If no control is rendered at all, that is a bigger one.
If the harness was simply looking in the wrong place, fix the harness — three
false defects were nearly filed tonight on exactly that mistake.

Owner: settings lane. Recorded as a question, not as a defect, on purpose.

### Finding 13, the likely cause — read this before suspecting the product

The harness finds a settings row like this
(`tools/refusal-copy-qa.mjs:497-501`):

```js
const row = [...document.querySelectorAll('*')].find(node =>
  node.children.length <= 6
  && (node.innerText || '').trim().startsWith(label)
  && node.querySelector('button, input[type=checkbox], [role=switch]'))
const control = row?.querySelector('button, input[type=checkbox], [role=switch]')
```

`querySelectorAll('*')` is in **document order**, so `.find()` returns the
**outermost** element that matches — an ancestor container, not the row — as
long as that container has ≤6 children and starts with the same text. Its first
control in document order can then be something else entirely (a section reveal
button, for instance). That fits the observed report exactly: *"Launch Codex
Cloud tasks: pressed"* with the flag unchanged, and *"Dispatch agent lanes: no
control"*.

The product's own markup argues the same way: `src/views/settings.js:395-403`
renders each row as `article.settings-row[data-setting-id]` with the control in
`div.settings-control`, and a toggle is a real
`<input type="checkbox">` (`:372`). The row carries **no button** — the guidance
beside it is `<details>/<summary>` (`src/guided-step.js`) — so a correct row
lookup would find the checkbox, and `setWriteEnabled` has no refusal path.

**The one-line fix to try first:** select by
`article[data-setting-id="write_cloud-launch"]` and click its
`input[type=checkbox]`. If the flag then flips, the harness was pressing the
wrong element and there is no product defect.

I could not run that myself: a fresh profile boots into the setup flow and my
probes never reached `#/settings` (route came back empty every time), while
these harnesses complete the walkthrough first. Recorded as evidence, not as a
verdict.
