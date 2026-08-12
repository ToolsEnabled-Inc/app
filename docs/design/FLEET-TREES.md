# More than one tree per computer

**Owner's words:** "they should also be able to have more than 1 tree per computer",
alongside: the tree is empty until a session is started, empty nodes are drawn and
pressed to extend the structure, and pressing one opens a right-side panel for role
and message.

This is a specification, not an implementation. Every decision below is a decision,
not an option. Where a choice is genuinely the owner's it is marked in section 6.

---

## 1. What already exists (measured, not assumed)

Five facts the implementation has to build on. Nothing below invents a new engine
concept, and nothing below needs one.

1. **One computer, on a real install.** `src/declared-fleet.js` builds exactly one
   computer (`THIS_COMPUTER_ID`) from the declared organisation. The two-computer
   roster in `src/fleet-profile.js` is sample data. So "per computer" today means
   "on this computer", and the storage must still be keyed by computer so a second
   one never inherits the first one's trees.

2. **The engine already has trees.** `capability/src/lib/controller-launch-record.js`
   gives every launch a `parentLaunchId` and a `depth`, and enforces
   `MAX_FAN_OUT = 8` children per parent and `MAX_DEPTH = 3` (root is depth 0, so
   four levels). `src/agent-teams.js` already nests members under a lead to make
   that cap engage.

3. **Dispatch takes a fixed set of fields.** `actions.js` `dispatch` calls
   `exact(input, ['rootId','tier','objectiveRef','brief','cap','parentLaunchId'], …)`
   and refuses anything else. **A tree id cannot be sent to the engine.** Tree
   membership therefore lives in the app, and its durable spine in the engine is
   `parentLaunchId` and nothing else.

4. **Seats are a pool per kind, and the pool is small.** `actions.js` `TIERS`:
   the three Codex tiers hold one seat each (`luna`, `terra`, `sol`); all three
   Claude tiers share `claude`, `claude-2`, `claude-3`, `claude-4`.
   `capability-defaults/config/agent-org.json` declares exactly those seven plus the
   controller. **Seven agents can run at once on a fresh install, and no more.**
   `declaredLane()` allocates a free seat and refuses with `BRIDGE_ALL_SEATS_BUSY`
   (HTTP 409) when there is none.

5. **A live session does not survive the window.** `src/agent-session-registry.js`
   holds one app-owned session and deliberately persists nothing, because "a live
   session cannot outlive the window that owns it".

---

## 2. What a tree is, and what makes two of them different

**A tree is one piece of work.** One tree, one job: the thing a person would name
in a sentence if you asked what they are doing.

Two trees on one computer are told apart by **the name a person gives them**, and by
nothing else. Not by structure — two trees can be the same shape — and never by an id.

**Trees separate work, not files.** See section 8: every agent on this computer runs in
one shared folder, and no tree owns one.

- **Name.** Editable at any time. Until it is edited, the name is the first line of
  the first message sent in that tree, trimmed to one short line. Before any message
  exists, the name is **New tree**. Two trees are allowed to end up with the same
  name; the tab also shows how many agents are running, which separates them. Never
  disambiguate by numbering an id.

  **Settled.** Three naming schemes turned up at once — `treeName(position)` in
  `src/fleet-tree-copy.js` answering *Tree 1*, `addNode()` naming a tree after its
  first role, and this doc naming it after the first message. The coordinator decided
  the order: the name the person typed, then the first message they sent, then a
  count. `store.treeLabel(treeId)` is the single source and `tree.name` stays null
  until somebody renames it. A count is not an internal id and no gate would ever have
  caught it — but *Tree 1* beside *Tree 2* tells a person nothing about which job is
  which, and that is the only reason to have two.

---

## 3. Create, switch, remove

**Create.** A strip of tree tabs sits under the computer tabs, ending in **New tree**.
Pressing it makes an empty tree and switches to it. An empty tree is exactly the
first-run screen: one empty node and one line of explanation. No dialog, no name
prompt, no step before anything happens.

**At most one empty tree exists at a time.** Asking for a second while an empty one is
open switches to the empty one instead and says why. An unbounded pile of empty trees
is the same noise as an unbounded pile of empty nodes.

**Switch.** Press the tab. The right-side panel closes on switch — a panel belongs to
one node in one tree. Which node was selected is remembered per tree while the app is
open.

**Remove.** "Remove this tree" lives in the tree's own tab menu.

- A tree with nothing running is removed at once.
- A tree with running agents is removed only after they are stopped, and the ask says
  how many: *"Three agents are still running in this tree. Removing it stops them."*
- **If a stop is not confirmed, the tree is not removed, and the screen says so.** A
  removed tree whose agents are still running would leave work going with nothing on
  screen naming it — the exact failure `src/agent-teams.js` already refuses to allow.

**The tab strip only appears when there are two or more trees.** A tab strip with one
unnamed tab is furniture.

---

## 4. A tree whose agents have all finished

**It stays, in place, unchanged, until the person removes it.** It does not vanish and
there is no archive.

Three reasons:

1. The agents' work is why the person started it. Vanishing deletes their result.
2. History cannot be re-derived reliably. `defaultCountChildren` scans the audit tail
   with a limit of 200 events, so a tree the app throws away is not always
   reconstructable.
3. "Empty until a session is started" is about the first tree appearing when work
   starts. It says nothing about trees disappearing when work ends.

A finished tree reads **Finished** on its tab. Its nodes keep their names, roles and
last messages, and it still has empty nodes — so pressing one starts a new agent in
the same tree. That is what makes archiving unnecessary: a finished tree is a tree you
can pick back up.

**Across a restart, shape is saved and running is not.** The tree's nodes, names,
roles and messages are saved on this computer. No node is ever drawn as
running on the strength of a saved file. On start-up every saved node's state is
unknown until the engine answers, and a node the engine does not report as running
reads **not running now**. This follows `src/agent-session-registry.js`'s own rule:
persisting a claim that is false on the next launch is absence read as consent.

---

## 5. Trees share the seat pool, and what a person sees when it runs out

**Trees share one pool per computer. Nothing is reserved per tree.** Reserving would
idle a seat somebody could be using, and a person cannot see a reservation — so a
reserved-but-idle machine just looks broken.

So yes: **tree A can hold every seat and tree B cannot start.** That is the honest
consequence and the screen has to carry it.

**Before pressing.** The panel's kind chooser shows how many of that kind are free —
*"2 of 4 free"* — derived from what the engine reports. If the engine has not answered,
it shows nothing rather than a guess.

**The start button is never disabled on that count.** The count can be stale, and a
disabled button that was never pressed produces no truth at all. The person presses,
the engine answers, and the answer is what is shown.

**When the answer is the seat refusal**, the panel prints two lines.

*Line one is the shipped sentence, unchanged*, from `REFUSAL_REMEDY` in
`src/refusal-copy.js`:

> Nothing new was started, and nothing is wrong: every agent this copy can run at
> this level is already working. Wait for one of them to finish, or stop one from the
> fleet page, and then start this again.

Do not fork this wording. Four screens describing one condition four ways is a defect
this codebase has already paid for.

*Line two names who is holding them*, and it is the whole point of the change:

| Situation | Line two |
| --- | --- |
| Other trees hold them | Two other trees are holding them: "Ship the installer" has three, "Fix the login bug" has one. |
| This tree holds them all | This tree is already holding every agent this computer can run. |
| The app did not start them | This app did not start them, so it cannot say what has them. Wait, or stop one from the list below. |

Trees are named in that sentence, never identified. A tree's id must not appear in any
string a person reads.

**Drawing is not running.** A tree can be drawn wider than seven nodes. Empty nodes are
still offered, because planning past current capacity is legitimate; what is refused is
starting an eighth agent, and it is refused by the engine with the sentence above.

**Positions the engine would refuse are not drawn.** No empty node is offered as the
ninth child of a node, and none is offered below the fourth level. A node that can only
refuse is worse than no node.

---

## 6. What the owner decides, and nothing else here does

One thing, and it is small:

- **Whether the number of trees is capped at all.** This spec caps only empty trees
  (one), not filled ones.

Everything else above is a build decision and was made here. Section 8 is the one
thing this design does not decide, because it is not a design question: it is a
limitation to be weighed, and weighing it costs money and time that are the owner's.

---

## 7. The contract the tests hold

`src/fleet-trees.js` shipped while this was being written, and it is the store this
section describes. It is pure — no DOM, no view, no engine imports — so `node --test`
can hold it. Its own shape stands: one store per computer, a flat node list, and a
`{ ok, problems }` result on every write.

What that store already gets right, and what this design relies on:

- a fresh computer holds no trees and no agents, and nothing is seeded;
- `addNode()` with nothing passed makes a new tree, so a second tree costs one press;
- `extensionPoints()` answers *where a placeholder may be pressed* in one place;
- `moveNode()` refuses to drag a branch between two trees;
- `removeTree()` takes its agents with it rather than orphaning them;
- every refusal is a sentence, not a code.

**Five mismatches were found and closed:** the engine's caps adopted as `TREE_BOUNDS`,
a saved `running` demoted on load, `removeTree()` returning the removed records so the
caller can still stop what it removed, `seatShortageSentence()` added, and the
one-empty-tree rule moved into `createTree()` — which now calls `planTreeAdd()` rather
than remembering the rule separately, so the planner and the store agree by
construction. The suite that found them still guards each one.

### The record: there is one, and it is the store's

**This doc originally specified a second record shape, and that was a mistake it is
retracting.** It described nodes nested inside the tree with `agent: null` for an empty
one. The store already had a flat node list with a `draft` state, and `draft` is not a
detail — the owner's flow is *press the placeholder, **then** fill in role and
message*, so an agent exists, holding the person's typing, before any session does. The
nested shape cannot say that. Bridging the two (`treeNodesOf()`) has to map
*draft-with-typing* onto `state: 'unknown'`, which loses the one fact that state exists
to carry.

So: **the store's record is the record**, and its five states — `draft`, `starting`,
`running`, `finished`, `failed` — are the vocabulary. The coordinator ruled the same
way, and kept the nested shape as a **view projection**: `treeNodesOf()` runs one
direction only, stored record to drawn shape, and nothing maps back.

That makes the *draft-with-typing* row **not lossy**, and it must not be "repaired" by
adding a fourth state to the drawn shape. `draft` lives in the stored record and
flattens on the way to the pixels, which is where flattening belongs. Test 16 holds
that seam from the test side and a comment in `src/fleet-trees.js` holds it from the
code side. When the graph reads the store's record directly, `treeRecord()` and
`treeNodesOf()` can go — and test 16 is the thing that should survive that.

### One rule no test here can hold

**A message a person typed is drawn as text, never as markup a browser parses.** This
binds every view that draws one — the graph, the panel, a tab, a tooltip.

It is a requirement rather than a preference because the store deliberately allows
angle brackets in a message: people write `->` and `<see the note>` without meaning
markup, and refusing their typing to protect a view is charging them for that view's
bug. Escaping at rest is not the alternative either — that hands somebody their own
words back with `&amp;` in them.

**No test in this suite holds it, and that is a decision.** Every assertion available
here would check a proxy — that some view calls some helper by some name — and a proxy
fails the day the helper is renamed, which red-lights this suite for an edit that
changed nothing. A gate that cries wolf gets deleted, and it takes the real gates
beside it. Contrast the two guards that *are* here: a quoted sentence drifting, and a
`cwd` in a start call, are each **the fact itself** rather than a stand-in for it.

So this one is prose, and the honest cost is stated: if a view stops escaping, nothing
in this lane catches it. The rule is written where the decision that depends on it is
made, and here, where the feature is specified.

---

## 8. Recorded limitation: two trees can edit the same files

**Shipping this way is decided. Whether to change it later is the owner's, and this
section exists so he can weigh it rather than discover it.**

### What is true today, measured

Every agent started from this page runs in **one shared folder**, and no tree owns one.

- `shell/main.cjs` `parseAgentStart()` accepts an optional `cwd`.
- Every caller in `src/` passes only `sessionId` or `surface` — in `src/agent-session.js`,
  `src/views/agent.js` and `src/views/computers.js`. **None passes a `cwd`.**
- So every session falls back to `getAgentHost()`'s `defaultCwd`, which is the single
  `WORKSPACE_ROOT` prepared by `ensureWorkspaceRoot()`.

**These three bullets are checked, not just written.** A claim about another file's
contents has an expiry date and nothing in a build reads prose, so
`tools/test/fleet-trees-multi.test.mjs` asserts both halves — that `parseAgentStart()`
still accepts a `cwd`, and that no start call in `src/` passes one. The day either stops
being true this section fails a test instead of quietly becoming false. Line numbers are
deliberately absent for the same reason: the first draft of this section cited
`src/views/agent.js:772` and the line had moved to 781 within the hour.

The panel collects a role, a message and a parent. The store's node record has no
folder field, declined deliberately by the lane that owns it: a working folder is a
dispatch input, not tree shape.

### So the product claims nothing about files, on purpose

Trees separate **work**, not **files**. The owner asked for more than one tree per
computer; he did not ask for trees to isolate what they touch. Building that on the
last piece of an integration would be inventing scope.

An earlier decision here — allow sharing, warn on collision — was withdrawn, and the
reason is worth keeping. It described a rare condition that is in fact **universal**,
and pointed at a control that does not exist. A warning that fires every time is not a
warning, and copy about a feature nobody built is the defect this whole product is
organised against.

### The argument for building it, so it can be weighed and not assumed

Two trees running at once are two sets of agents editing one working tree with no
boundary between them. **This project has eight recorded incidents of concurrent lanes
clobbering each other's uncommitted work.** That is the real cost, it is already
measured, and it lands on the person, not on us.

Against it: per-tree folders mean a folder chooser, a story for what a second tree does
to a checkout it does not own, and a `cwd` threaded from the panel through the start
into the engine. None of that is a line of copy; all of it is a feature.

**The owner decides.** Nothing in this release should be read as a promise that two
trees stay out of each other's way, because they do not.

Bounds, restated here so a test can compare them against the engine's own source
rather than against this prose:

```bounds
children-per-node: 8
max-depth-value: 3
levels: 4
agents-at-once: 7
codex-seats: 3
claude-seats: 4
```

`tools/test/fleet-trees-multi.test.mjs` holds this contract. It parses the engine for
every number above, so the doc cannot drift from the product quietly. Until
`src/fleet-trees.js` lands, the contract tests skip **loudly** and name the missing
file; the engine and copy tests run regardless, so the suite is never worth nothing.
Once the module exists, a missing export is a failure, not a skip — at that point the
contract is being broken rather than awaited.
