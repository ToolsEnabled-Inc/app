// FIRST-RUN CONTENT IS A PROFILE, NOT A PRODUCT CONSTANT.
//
// This product grew out of one person's two-machine fleet, and the shipped
// build carried the SHAPE of that fleet as its seed data: a retired
// "compatibility host" beside a "canonical" one, the real durable-memory board
// keys, the real request ledger, the real account aliases, the real transport
// ports. The byte-level ship gate (tools/check-no-owner-data.mjs) cannot see
// any of it — none of it is his name, his username, his paths or his LAN. It
// is the SHAPE that identifies, and a stranger opening the app was reading
// somebody else's world with no way to know that is what it was.
//
// So everything site-specific now lives in one record, with two copies of it:
//
//   SHIPPED  SAMPLE_PROFILE below. Deliberately, visibly a sample: every board
//            key is `sample/…`, every evidence path is `sample/…`, the pinned
//            first message says so in words, and no transport is configured.
//            A stranger must never have to wonder whether they are looking at
//            real activity belonging to someone else.
//
//   OWNER    private/fleet-profile.owner.json — the original fleet, verbatim.
//            It sits outside public/ and outside build.files (`dist/**`,
//            `shell/**`), so neither vite nor electron-builder can pack it,
//            which is the same split public/data/research-queue.json and
//            private/research-queue.authored.json already use.
//
// Resolution is SYNCHRONOUS on purpose. src/sim.js builds the fleet during
// module evaluation and eight modules import the result, so an async profile
// would mean rewriting all of them; localStorage is the same mechanism
// src/live-flags.js reads for the same reason, with the same guarded try.

const STORAGE_KEY = 'mc.fleet.profile'

/* Hosts carry RFC 5737 documentation addresses (192.0.2.0/24) ON PURPOSE:
   they can never resolve to a real machine. Do NOT "improve" them into a
   realistic-looking private range like 192.168.x — that ships something that
   reads as a real machine roster while still passing a grep for the owner's
   own address, which is the bug this replaced. `note` says what each host IS,
   and for the sample the honest answer is that it is a sample. */
const SAMPLE_MACHINES = [
  { id: 'c1', name: 'Computer 1', short: '1', ip: '192.0.2.1', note: 'sample host', ageHours: 20 },
  { id: 'c2', name: 'Computer 2', short: '2', ip: '192.0.2.2', note: 'sample host', ageHours: 9 },
]

/* Transports are the operator's own infrastructure, so the sample declares the
   two lanes the product knows how to show and configures neither. `port: null`
   renders as "not configured" rather than as a green light over a port number
   nobody chose — a fresh install claiming a live relay is the same class of
   lie as shipping someone else's roster. */
const SAMPLE_TRANSPORTS = [
  { id: 'relay', label: 'relay', port: null, note: 'not configured' },
  { id: 'tools', label: 'tool lane', port: null, note: 'not configured' },
]

/* Account pools are the operator's own accounts, and a pool record now carries
   its own card copy. It did not: src/views/metrics.js decided what a pool card
   said from its INDEX — pool 0 was a subscription seat, pool 1 a vendor credit
   balance, anything else a dormant single-sign-on account held behind a named
   MFA product. That is one person's account taxonomy asserted about whatever
   pools happen to be loaded, so the strings moved here where a profile can
   replace them.

   `meter` decides how the card and the burn panel read the pool: 'percent' is
   a resetting quota, 'currency' a depleting balance, 'dormant' an account with
   no compute attached (no burn row, no runway). `stats` fills the card's two
   right-hand cells, and {pct} interpolates the used percentage.

   The ids are short by design: they print as the account name on the card and
   as the sankey's pool node, and the widest tooltip in the app is built from
   one (see the viewportTooltip note in metrics.js). */
const SAMPLE_POOLS = [
  { id: 'sample-a', kind: 'Sample pool', desc: 'sample account · seat quota',
    meter: 'percent', burnLabel: 'sample seat', burnWindow: 'quota window, resets monthly',
    caption: 'seat quota', stats: ['{pct}% of seat', '2 surfaces'], tipKind: 'seat quota',
    color: '#008dab', glow: '#45d6ff' },
  { id: 'sample-b', kind: 'Sample pool', desc: 'sample account · prepaid credit',
    meter: 'currency', burnLabel: 'sample credit',
    caption: null, stats: ['no expiry set', 'worker lanes'], tipKind: 'prepaid credit',
    color: '#3e63f0', glow: '#7d9bff' },
  { id: 'sample-c', kind: 'Sample pool', desc: 'sample account · no compute attached',
    meter: 'dormant',
    caption: 'attached, not spending', stats: ['no window', 'no compute'], tipKind: 'dormant account',
    color: '#00956c', glow: '#35eab7' },
]

/* Task and feed lines describe what an agent fleet DOES — claims, phases,
   checkpoints, leases — and nothing about where it runs. The set they replaced
   named this product's own internals (its handshake service, its card store,
   its standing-orders file, its inbox), which told a stranger about a system
   they do not have and cannot see. */
const SAMPLE_TASKS = [
  'Claim the next queued task', 'Reconcile open gates', 'Retry a failed step',
  'Refresh a stale cache entry', 'Re-run checks after a handoff', 'Audit connection health',
  'Promote a verified change', 'Verify the tool profile', 'Regenerate the capability digest',
  'Sweep unclaimed task leases', 'Checkpoint a long-running phase', 'Cross-check the host table',
  'Validate assignment recency', 'Flush buffered audit records', 'Verify the signed audit chain',
  'Re-point a stale test', 'Index the message channels', 'Answer a pending question',
  'Confirm the stop switch is clear', 'Rebuild the tool allowlist', 'Measure cache savings',
  'Archive a finished plan', 'Split the queue into slices', 'Verify workspace isolation',
  'Escalate a stale heartbeat',
]

const SAMPLE_FEED = [
  'indexing the message channels', 'running checks from the workspace root',
  'polling the question queue', 'probing the relay lane',
  'probing the tool lane', 'verifying the host handshake',
  'regenerating the tool digest', 're-reading assignments before acting',
  'checking for open gates', 'claiming a task lease',
  'heartbeating before the next checkpoint', 'writing status to durable storage',
  'scanning recent sessions for claims', 'comparing declared and connected servers',
  'reading its role assignment', 'spot-verifying claims against live files',
  'promoting an entry after a freshness check', 'sweeping stale leases from the queue',
  'flushing buffered audit records', 'verifying the audit chain at the latest sequence',
  'checking the stop switch before sending', 'resolving an assignment tie by date',
  'recording a checkpoint before the phase ends', 're-reading the plan after a phase',
  'watching heartbeat freshness', 'matching a workspace against the host table',
  'searching the board for open questions', 'answering a question at its reply key',
  'staging a refresh for a stale entry', 'treating a truncated run as a continuation',
]

const SAMPLE_CHAT = [
  { from: 'them', text: 'claim the next phase; name your files; report evidence, not intent' },
  { from: 'me', text: 'claimed — checks clean, no colliding session, starting the sweep' },
  { from: 'them', text: 'verdict: ACCEPT, 17 checks pass; wire it up' },
  { from: 'me', text: 'fix round posted: the rejected item is addressed, nothing else moved' },
  { from: 'them', text: 'check both lanes independently before you call either one healthy' },
  { from: 'me', text: 'both lanes answered; evidence is in the status probe' },
  { from: 'them', text: 'a truncated run is a continuation, not a completion — checkpoint and resume' },
  { from: 'me', text: 'checkpointed at phase 3 of 5; resuming after the plan re-read' },
  { from: 'them', text: 'a gate is open on this class; hold the send until it clears' },
  { from: 'me', text: 'held until the gate cleared, then sent; receipt logged' },
]

const SAMPLE_CHAT_REPLIES = [
  'ack — evidence is on the board at the reply key',
  'verdict: ACCEPT, 12 checks pass, 41s wall clock',
  'checks clean, no colliding claim; proceeding',
  'checkpointed; resuming after the plan re-read',
  'lease heartbeat fresh; phase 2 of 4 underway',
  'read-only sweep done; 3 entries promoted, 1 staged',
  'holding at the fence; the gate is unmet',
  'two worker lanes started; territories do not overlap',
]

const SAMPLE_CHAT_CONTEXT_REPLIES = {
  coordinator: [
    'assignment read — {{context}}. gates stay closed until the evidence clears; no territory changes from this thread.',
    'coordination pass: {{context}}. the current owners stay in place and I am watching for the next revision.',
    'ack — {{context}}. nothing collides with the named territory, so the lane continues behind its existing fence.',
    'gate check: {{context}}. nothing goes out until the register says clear, then I log the receipt.',
    'territory is stable. {{context}}. if that changes I issue one bounded handoff rather than splitting ownership.',
    'the current assignment is accounted for: {{context}}. the next checkpoint waits on evidence, not on elapsed time.',
    'fleet read: {{context}}. no stale claim is being treated as live; I reconcile before assigning again.',
    'holding the coordination line — {{context}}. owners, gates and open questions stay on separate tracks.',
    'revision checked: {{context}}. the active phase stays fenced; a truncation would checkpoint and resume, never close it.',
    'coordinator answer: {{context}}. I keep the lane scoped and raise only a real decision.',
  ],
  lane: [
    'current lane — {{context}}. the sweep is moving; nothing stuck and no drift out of territory.',
    'working the current item: {{context}}. evidence goes back when the bounded pass closes.',
    'ack — {{context}}. the next check is queued behind this one; replies stay serialized.',
    'current task: {{context}}. heartbeat is fresh, the fence is intact, and I am continuing.',
    'status from {{agent}}: {{context}}. nothing to report as a blocker; the next checkpoint is the natural stop.',
    'still in the same lane — {{context}}. I have not crossed into adjacent files or opened a second phase.',
    'read-only pass first: {{context}}. if the evidence holds I promote it; otherwise it stays staged.',
    'checkpoint view: {{context}}. progress is real, but I am not calling it complete before the last check.',
    'on it — {{context}}. one task, one stream, then the queued turn gets the line.',
    'lane update: {{context}}. no lease contention, no hidden retry, and nothing waiting on a decision.',
  ],
}

/* Channel keys are `sample/…` so that every topic bar, every watch-board box
   header and every rail tooltip on the page says what the data is. The keys
   they replaced were the real durable-memory addresses of a working fleet,
   documented in this file's own comment as "the real stable keys". */
const SAMPLE_CHANNELS = [
  { id: 'notices', name: 'notices', key: 'sample/notices', mach: '1·2', pinned: true,
    topic: 'sample board — demonstration traffic, not a live fleet' },
  { id: 'assignments', name: 'assignments', key: 'sample/assignments', mach: '1·2',
    topic: 'sample assignments — newest revision wins' },
  { id: 'status', name: 'status', key: 'sample/status', mach: '1·2',
    topic: 'sample status packets — claims, phases, checkpoints, heartbeats' },
  { id: 'blockers', name: 'blockers', key: 'sample/blockers', mach: '1·2',
    topic: 'sample stop-the-line notices' },
  { id: 'reviews', name: 'reviews', key: 'sample/reviews', mach: '1',
    topic: 'sample review verdicts — ACCEPT / REJECT with an evidence path' },
  { id: 'questions', name: 'questions', key: 'sample/questions', mach: '2',
    topic: 'sample questions — answers arrive at the reply key' },
]

/* Seeded board history. `agoH` is hours before load, so every stamp is in the
   past and the log opens with real scrollback and day dividers.

   These lines are SHORT, and that is a reversal of the previous set's stated
   goal. That set was written to read as genuine — 56 hours of curated traffic,
   full-packet register, no line repeated — because the aim then was for the
   demo to be indistinguishable from a real board. That aim is exactly the
   defect now: sample data that reads as real activity is sample data a
   stranger will mistake for someone's real activity. Plain, plainly-generic
   lines are the requirement, not a shortcut. */
const SAMPLE_BOARD = {
  notices: [
    { agoH: 30, s: 'assistant', pinned: true, t: 'This board is sample data shipped with the app. Nothing here was sent by anyone. Connect a fleet host, or load a saved profile, to see real traffic in its place.' },
    { agoH: 29.4, s: 'controller', t: 'sample notice: channel keys on this board all start with sample/ so the demonstration data is always distinguishable from a live board.' },
    { agoH: 24.1, s: 'assistant', t: 'sample notice: no transport is configured in this profile, so the lanes below the channel list read as not configured rather than as up.' },
    { agoH: 18.6, s: 'controller', t: 'sample notice: agents, machines and accounts on this board are placeholders. None of them correspond to a real host or a real account.' },
    { agoH: 9.2, s: 'assistant', t: 'sample notice: the live views read from a local fleet host. With no host detected they report that plainly instead of falling back to this data.' },
    { agoH: 2.4, s: 'controller', t: 'sample notice: everything on this page can be replaced by loading your own profile. The sample stays available as the demonstration.' },
  ],
  assignments: [
    { agoH: 28.7, s: 'controller', t: 'sample assignment: the checks lane is the priority this round. Cosmetic work waits until the gates read green.' },
    { agoH: 28.5, s: 'codexb', t: 'ack on the second host; two seats claimed.' },
    { agoH: 22.0, s: 'controller', t: 'sample assignment: evidence paths are required in every packet. A bare "done" is rejected unread.' },
    { agoH: 21.8, s: 'luna', t: 'ack; the packet template is updated.' },
    { agoH: 12.5, s: 'controller', t: 'sample assignment: territories are file-disjoint this round. Touching another lane\'s file is an automatic hand-back.' },
    { agoH: 12.3, s: 'gem2', t: 'ack; territory re-read before claiming.' },
    { agoH: 3.1, s: 'controller', t: 'sample assignment: fix rounds address the rejected item only. A wider diff reopens the whole review.' },
  ],
  status: [
    { agoH: 27.9, s: 'luna', t: 'claim: seat 1, the checks pass. No colliding claim; territory named file by file.' },
    { agoH: 27.6, s: 'gem2', t: 'claim: seat 2, the cross-check. Territory is disjoint from seat 1.' },
    { agoH: 25.2, s: 'gem2', t: 'phase 1 complete — 9 of 9 checks pass in 41s. Evidence: sample/evidence/cross-check.md' },
    { agoH: 20.4, s: 'sandbox', t: 'checkpoint at phase 1 of 4; resume state written.' },
    { agoH: 15.8, s: 'luna', t: 'lease heartbeat fresh; phase 3 of 4 underway.' },
    { agoH: 8.3, s: 'gem4', t: 'phase 2 complete — 18 of 18 checks pass in 1m26s. Evidence: sample/evidence/phase-2.md' },
    { agoH: 1.7, s: 'sandbox', t: 'phase 3 complete — 17 of 17 checks pass in 1m04s. Evidence: sample/evidence/phase-3.md' },
    { agoH: 0.4, s: 'luna', t: 'lease heartbeat fresh; phase 4 of 5 underway.' },
  ],
  blockers: [
    { agoH: 26.5, s: 'luna', t: 'BLOCKER: a stale lease is holding the queue lock — the heartbeat is 40 minutes old. Sweeping it before the claim.' },
    { agoH: 26.2, s: 'luna', t: 'cleared — lease swept, lock released, eight minutes lost.' },
    { agoH: 19.1, s: 'assistant', t: 'collision warning: two lanes named the same file. The later claim yields and re-claims after the first checkpoint.' },
    { agoH: 18.8, s: 'gem2', t: 'yielding the file; my edit rebases onto theirs.' },
    { agoH: 10.6, s: 'gem4', t: 'BLOCKER: one lane probe timed out; the other stayed clean. Verifying the two independently before calling it an outage.' },
    { agoH: 10.1, s: 'gem4', t: 'cleared — the retry answered in 210ms; both lanes healthy.' },
    { agoH: 2.0, s: 'assistant', t: 'watchdog: all leases fresh, no stale locks, board clean.' },
  ],
  reviews: [
    { agoH: 29.0, s: 'terra', t: 'sample/reviews/1: ACCEPT — 12 of 12 criteria pass, 33s. Every path in the evidence tree resolves.' },
    { agoH: 23.4, s: 'terra', t: 'sample/reviews/2: REJECT — criterion 2 fails: the check skips deleted entries, so the clean verdict was unearned. One fix round, that criterion only.' },
    { agoH: 22.6, s: 'terra', t: 're-review of 2: ACCEPT — the missing case is covered, 11 of 11 pass.' },
    { agoH: 14.2, s: 'terra', t: 'sample/reviews/3: ACCEPT — 15 of 15 criteria pass, 47s.' },
    { agoH: 7.5, s: 'terra', t: 'sample/reviews/4: REJECT — criterion 4 fails: the focus ring never paints on the third control. Scoped to that criterion.' },
    { agoH: 1.2, s: 'terra', t: 'queue note: two lanes are waiting on captures; verdicts follow in claim order.' },
  ],
  questions: [
    { agoH: 28.2, s: 'gem2', t: 'question: where do evidence files belong — the reports tree or the artifacts tree?' },
    { agoH: 27.9, s: 'controller', t: 'answered at the reply key: reports for lane evidence, artifacts for review verdicts.' },
    { agoH: 16.4, s: 'sandbox', t: 'question: does a heartbeat on my own lease count as a write while the fence is read-only?' },
    { agoH: 16.1, s: 'helperb', t: 'answered at the reply key: your own liveness is fine; the fence covers the shared surface.' },
    { agoH: 5.8, s: 'gem4', t: 'question: who owns the shared stylesheet this round? I need one token added.' },
    { agoH: 5.5, s: 'controller', t: 'answered at the reply key: request the token from its owner. A one-line edit to a shared file is still a fence break.' },
  ],
}

/* Watch-board conversations. Ten lines per side is not decoration: the bag
   draw in comms.js partitions each side's pool into recent and non-recent
   halves, and its worst-case spacing guarantee is (pool − recent) side-draws
   with recent fixed at 4. Shorten a pool below ten and the two halves stop
   being halves, and the repeat the partition exists to prevent comes back. */
const SAMPLE_CONVERSATIONS = [
  {
    id: 'fleet-sync', a: 'controller', b: 'codexb', key: 'sample/fleet-sync', child: 'work-brief',
    desc: 'sample conversation — cross-host sync',
    lines: {
      a: [
        'assignments are mirrored to both hosts; fan your lanes out after the ack.',
        'the gate sweep is clean here: 9 of 9 re-verified, no disputes.',
        'hold new lanes until the open fix round lands.',
        'the relay probe answered from this side; take the tool lane on yours.',
        'the territory map is re-pinned. Every lane is file-disjoint this round.',
        'the question queue is drained: three items, all informational.',
        'restating ownership for the new lanes before anyone claims.',
        'do not answer on the owner\'s behalf; surface the question and hold.',
        'the map is authority, not memory — re-read it before every claim.',
        'if the two hosts disagree on a revision, stop and raise it here first.',
      ],
      b: [
        'ack — the revision matches here. Four seats claimed, territories named.',
        'the tool lane answered in 210ms; with your relay result both are green.',
        'checks came back clean: no colliding sessions, no stale claims.',
        'host identity confirmed mechanically rather than from memory.',
        'swept a stale lease off the queue; the seat behind it re-claimed cleanly.',
        'mirror check done: both hosts read the same revision, byte for byte.',
        'question queue drained here: one ack, two status packets, no replies owed.',
        'holding new lanes as asked; two are queued and can start within a phase.',
        're-read the map before the last two claims. Both are still disjoint.',
        'one lease looked live in my view but was stale when I checked directly.',
      ],
    },
  },
  {
    id: 'work-brief', a: 'controller', b: 'luna', key: 'sample/work-brief', child: 'lane-detail',
    desc: 'sample conversation — assignment and packets',
    lines: {
      a: [
        'the lane is yours. Name your files in the claim itself.',
        'the consistency pass is blocking: any two pages must read as one product.',
        'fix rounds address rejected items only — no opportunistic refactors.',
        'visual evidence is captures at both test sizes, every time.',
        'checkpoint before the phase ends, not after you hit the fence.',
        'name the files exactly; the next lane routes around your claim.',
        'a green build is not evidence. Exercise the route and say what you saw.',
        'if a criterion cannot be measured, rewrite it until a number falls out.',
        'flag early if the long phase runs over. I would rather re-fence than rush.',
        'route the packet through status and stop while the verdict is out.',
      ],
      b: [
        'claimed. Checks clean, territory named as two files and nothing else.',
        'phase 3 complete: 41 of 41 pass in 2m18s, no flakes across three runs.',
        'checkpoint written at phase 4 of 5 with the resume state attached.',
        'lease heartbeat fresh. The reorder pass is underway.',
        're-read the territory map before claiming, as directed.',
        'exercised every route after the build rather than trusting the render.',
        'the packet carries an evidence path for every claim in it.',
        'stopping at the fence with phase 5 open rather than half-landed.',
        'one deviation to flag: I took the extra space from a local token.',
        'timing note: the first phases came in under estimate, this one is over.',
      ],
    },
  },
  {
    id: 'lane-detail', a: 'luna', b: 'sandbox', key: 'sample/lane-detail', child: null,
    desc: 'sample conversation — worker brief',
    lines: {
      a: [
        'take the seat; the failing path gets its test written first.',
        'keep stored values under the size ceiling and split anything close.',
        'report evidence, not intent. Verdict, numbers, paths, in that order.',
        'snapshot inside the window only, and restore before it closes.',
        'start at the step that has been flaking rather than at the top.',
        'twenty runs minimum before you call the flake narrowed.',
        'do not widen the seat to chase the bug into another lane\'s files.',
        'ask here before sweeping shared state; the window costs others nothing.',
        'prune your artifacts as you go — the quota is shared.',
        'when the seat closes, the reproduction goes in the packet, not a summary.',
      ],
      b: [
        'seat claimed. The flake reproduces once in twenty runs on a cold start.',
        'it is deterministic now: 20 of 20 fail the same way from a cold start.',
        'artifacts pruned to the last five runs; the quota is back to 40% free.',
        'checkpoint at phase 2 of 4; the snapshot restored against its checksum.',
        'my largest value is close to the ceiling, so I am splitting it now.',
        'confirmed: the failing path is the one that never guarded the empty case.',
        'the snapshot was taken inside the window and nothing was read after it.',
        'seat released. The reproduction is replayable from the packet.',
        'two early runs hit the shared quota; both are marked tainted, not deleted.',
        'asked for the window here rather than sweeping the state myself.',
      ],
    },
  },
  {
    id: 'review', a: 'terra', b: 'gem2', key: 'sample/review', child: 'fix-round',
    desc: 'sample conversation — review verdicts',
    lines: {
      a: [
        'pre-read done: scope confirmed, three evidence paths spot-checked.',
        'REJECT on one criterion: the measured value misses the floor.',
        're-review queued. I re-check the failed criterion only.',
        'the capture rig stays pinned to both sizes through the whole queue.',
        'ACCEPT — 17 of 17 criteria pass and every path I pulled resolves.',
        'a screenshot is not a measurement. Show me the reading, not the picture.',
        'I read the diff against the charter, not against your last packet.',
        'the evidence is thin for the smaller size. Attach a current run.',
        'one fix round means one. A miss reopens the review in full.',
        'queue status: this one is at the front, two more behind it.',
      ],
      b: [
        'hand-back ready: the value is raised and verified by probe at both sizes.',
        'evidence is attached with the probe output inline, not described.',
        're-review requested. The diff touches the two files named in the claim.',
        'added a check to my lane list so this class of miss stops recurring.',
        'the smaller capture is re-run; the stale one is deleted, not superseded.',
        'withdrawing that criterion rather than defending it — it was eyeballed.',
        'the diff is 41 lines including comments; the shared file is untouched.',
        're-run timing: 38s, no flake across 20 iterations.',
        'the criterion wording moved between revisions; I built against the newer.',
        'holding my side open until the verdict lands. The branch is frozen.',
      ],
    },
  },
  {
    id: 'fix-round', a: 'luna', b: 'gem2', key: 'sample/fix-round', child: null,
    desc: 'sample conversation — one round to answer a rejection',
    lines: {
      a: [
        'scope the fix to the rejected criterion and leave the shared files alone.',
        'verify at both sizes before the hand-back goes up, and verify by probe.',
        'route the packet through the hand-back key and nothing else.',
        'no opportunistic refactors in a fix round, however untidy the neighbours.',
        'the packet answers the rejection, not the neighbourhood around it.',
        'if a second criterion breaks while you fix the first, say so immediately.',
        'the reviewer sees the diff before the summary. Write for that order.',
        'if the shared component has to move, that is a request, not this round.',
        'measure off the rendered box, not off the stylesheet value.',
        'the hand-back closes the round; anything pushed after it opens a new one.',
      ],
      b: [
        'the shared component is untouched — I diffed it to prove it to myself.',
        'both sizes re-captured after the fix; the floor holds at both.',
        'hand-back posted with the measurement, the scoped diff and the captures.',
        'computed off the rendered box as instructed; the two disagreed by a pixel.',
        'the diff stays inside the named files and the packet carries the stat.',
        'caught myself about to reuse a stale measurement and re-measured instead.',
        'the round stays open on my side until the verdict lands. Nothing pushed.',
        'final scope: one file, four lines, including the comment explaining why.',
        'held the hand-back until the second size was measured rather than posting early.',
        're-ran the full sweep locally; nothing else regressed under the fix.',
      ],
    },
  },
  {
    id: 'status-roll', a: 'luna', b: 'gem4', key: 'sample/status-roll', child: null,
    desc: 'sample conversation — status roll-up',
    lines: {
      a: [
        'roll-up is due at the next checkpoint from every open lane.',
        'ran the collision check ahead of your phase; nothing adjacent is claimed.',
        'heartbeat before you sleep. Two quiet intervals and the lease is swept.',
        'a truncated run is a continuation — resume it, do not re-claim it fresh.',
        'if the packet cannot name its evidence, it is not ready. Hold it.',
        'plan long operations around the sweep interval and say so in the claim.',
        'the roll-up is due whether the phase closed or not. Say which it is.',
        'name your territory in the claim, not in a note somewhere else.',
        'evidence paths in every packet, resolvable at the time you post.',
        'if the fence lands mid-work, checkpoint and stop. Do not race it.',
      ],
      b: [
        'lease heartbeat fresh. Phase 2 of 3 underway; the dry run passed.',
        'checkpoint written with the file list and the command to continue.',
        'checks show no colliding claim on any of my three files.',
        'territory claimed on two files, both named and both unclaimed elsewhere.',
        'resumed from the checkpoint cleanly — nothing re-run, no drift.',
        'roll-up posted: two phases closed, one fenced mid-work with a checkpoint.',
        'swept my own stale lease from the last wake before claiming fresh.',
        'the phase hit the fence mid-work, so I checkpointed rather than racing it.',
        'every evidence path was opened and read back before posting.',
        'nothing to report this interval; posting the nothing so the sweep sees life.',
      ],
    },
  },
]

/* The sample register doubles as the setup path. A generic ledger of somebody
   else's engineering work still reads as somebody else's activity; a register
   about connecting THIS install cannot, and it answers the question a first
   run actually raises. Evidence paths stay under sample/ so an expanded row
   says what it is. */
const SAMPLE_REQUESTS = [
  { id: 'R1', title: 'Connect this install to a fleet host', status: 'in-progress', agent: 'codex', ageHours: 3.3, gate: 'LOCAL-WORK', evidence: 'sample/evidence/host-connect.md', claimedAt: '17:08:12Z' },
  { id: 'R1.1', parent: 'R1', title: 'Detect a local agent host', status: 'done', agent: 'claude', ageHours: 4.1, evidence: 'sample/evidence/host-detect.txt', claimedAt: '16:19:44Z' },
  { id: 'R1.2', parent: 'R1', title: 'Confirm each projection reports a source', status: 'open', agent: 'terra-01', ageHours: 0.9, evidence: 'sample/evidence/projection-source.txt', claimedAt: '—' },
  { id: 'R1.3', parent: 'R1', title: 'Choose which views read live data', status: 'open', agent: 'luna-02', ageHours: 0.6, evidence: 'sample/evidence/live-view-flags.md', claimedAt: '—' },

  { id: 'R2', title: 'Describe your machines in a fleet profile', status: 'in-progress', agent: 'luna-02', ageHours: 9.2, evidence: 'sample/evidence/profile-draft.json', claimedAt: '14:02:51Z' },
  { id: 'R2.1', parent: 'R2', title: 'Name each host and give it an address', status: 'done', agent: 'sandbox-w1', ageHours: 20.5, evidence: 'sample/evidence/hosts.json', claimedAt: '14:17:03Z' },
  { id: 'R2.2', parent: 'R2', title: 'Declare the transports the fleet uses', status: 'in-progress', agent: 'gem-lane-4', ageHours: 6.2, gate: 'LOCAL-WORK', evidence: 'sample/evidence/transports.json', claimedAt: '14:14:09Z' },
  { id: 'R2.2.1', parent: 'R2.2', title: 'Leave a transport unset until it is real', status: 'open', agent: 'terra-01', ageHours: 0.3, evidence: 'sample/evidence/unset-transport.md', claimedAt: '—' },
  { id: 'R2.3', parent: 'R2', title: 'Replace the sample board with your own keys', status: 'open', agent: 'gem-lane-2', ageHours: 0.4, evidence: 'sample/evidence/board-keys.md', claimedAt: '—' },

  { id: 'R3', title: 'Decide what the fleet may do without asking', status: 'blocked', agent: 'codex', ageHours: 27.0, gate: 'IRREVERSIBLE', evidence: 'sample/evidence/gate-policy.md', claimedAt: '11:22:14Z' },
  { id: 'R3.1', parent: 'R3', title: 'List the actions that always need a decision', status: 'done', agent: 'claude', ageHours: 8.7, evidence: 'sample/evidence/gated-actions.md', claimedAt: '11:43:26Z' },
  { id: 'R3.2', parent: 'R3', title: 'Set the stop switch and verify it is clear', status: 'gated', agent: 'sandbox-w1', ageHours: 1.4, gate: 'OUTWARD', evidence: 'sample/evidence/stop-switch.txt', claimedAt: '19:04:02Z' },

  { id: 'R4', title: 'Point the app at your own request register', status: 'open', agent: 'sandbox-w1', ageHours: 50.0, evidence: 'sample/evidence/register-source.md', claimedAt: '—' },
  { id: 'R5', title: 'Set the retention window for stored samples', status: 'in-progress', agent: 'gem-lane-4', ageHours: 7.6, gate: 'LOCAL-WORK', evidence: 'sample/evidence/retention.md', claimedAt: '12:51:28Z' },
  { id: 'R6', title: 'Review what leaves this machine before enabling sends', status: 'gated', agent: 'codex', ageHours: 0.8, gate: 'OUTWARD', evidence: 'sample/evidence/outward-review.md', claimedAt: '19:39:11Z' },
]

const SAMPLE_QUESTIONS = [
  { id: 'Q1', question: 'Which machines should this install treat as one fleet?', status: 'pending', agent: 'codex', ageHours: 3.1, evidence: 'sample/questions/Q1.json', claimedAt: '17:19:31Z' },
  { id: 'Q2', question: 'Should idle lanes be reaped automatically, or held for review?', status: 'answered', answer: 'Reap them automatically; a held lane that nobody reviews reads as live and is not.', agent: 'terra-01', ageHours: 33.0, evidence: 'sample/questions/Q2-answer.json', claimedAt: '12:27:44Z' },
  { id: 'Q3', question: 'Do the two transport lanes belong in one combined health figure?', status: 'answered', answer: 'No; show them separately, because either can fail while the other stays green.', agent: 'claude', ageHours: 49.0, evidence: 'sample/questions/Q3-answer.json', claimedAt: '09:46:18Z' },
  { id: 'Q4', question: 'May a reviewer accept a criterion from a screenshot alone?', status: 'pending', agent: 'terra-01', ageHours: 1.0, evidence: 'sample/questions/Q4.json', claimedAt: '19:27:16Z' },
  { id: 'Q5', question: 'How long should a lease survive without a heartbeat?', status: 'pending', agent: 'luna-02', ageHours: 1.9, evidence: 'sample/questions/Q5.json', claimedAt: '18:33:05Z' },
  { id: 'Q6', question: 'Should stale entries stay visible while a refresh is staged?', status: 'answered', answer: 'Yes; mark them stale and keep them visible until the verified replacement lands.', agent: 'gem-lane-3', ageHours: 61.0, evidence: 'sample/questions/Q6-answer.json', claimedAt: '09:18:40Z' },
  { id: 'Q7', question: 'Which actions may never run without a decision first?', status: 'pending', agent: 'gem-lane-4', ageHours: 0.7, evidence: 'sample/questions/Q7.json', claimedAt: '19:42:50Z' },
  { id: 'Q8', question: 'Does every answer need a receipt written back to the board?', status: 'pending', agent: 'codex', ageHours: 0.5, evidence: 'sample/questions/Q8.json', claimedAt: '19:54:32Z' },
]

/* THE HOME SESSION IS THE HARDEST SAMPLE IN THE APP, because a transcript
   reads as an exchange between real people in a way a channel log does not.
   The set this replaced was a written morning from one real fleet: its owner
   asking about a link outage, its coordinator answering with two port numbers,
   a named canonical checkout, real board keys, and an owner decision about
   retiring a real host — the whole of it inside the shipped bundle and on the
   first screen a stranger sees.

   Two things make this version a demonstration instead of a recording. The
   subject is the interface itself: every turn is about what this view shows
   and how to replace it, which no transcript of somebody's working day would
   be. And the notice sits at the END, not the top — the log opens pinned to
   the newest turn, so a first-time reader reads the last lines first, and a
   banner at the top would be scrolled out of sight before anyone saw it. */
const SAMPLE_SPEAKERS = {
  owner: { cls: 'is-owner', label: 'owner' },
  claude: { cls: 'is-coord', label: 'claude · coordinator', hue: 'var(--c-coordinator)' },
  codex: { cls: 'is-coord', label: 'codex · coordinator', hue: 'var(--c-coordinator)' },
  'codex-b': { cls: 'is-agent', label: 'codex-b', hue: 'var(--c-coordinator)' },
  'luna-02': { cls: 'is-agent', label: 'luna-02', hue: 'var(--c-manager)' },
  'terra-01': { cls: 'is-agent', label: 'terra-01', hue: 'var(--c-shadow)' },
  'gem-lane-3': { cls: 'is-agent', label: 'gem-lane-3', hue: 'var(--c-default)' },
  'sandbox-w1': { cls: 'is-agent', label: 'sandbox-w1', hue: 'var(--c-default)' },
  act: { cls: 'is-act', label: '' },
}

const SAMPLE_SESSION = [
  { who: 'act', text: 'sample transcript loaded — no fleet host connected; nothing in this thread was sent by anyone' },
  { who: 'owner', text: 'What am I looking at?' },
  { who: 'codex', text: 'A demonstration of this view. The ring above reads a real health sweep from a local fleet host, and with no host connected it says so rather than showing a number. Everything between the braces is sample content shipped with the app.' },
  { who: 'owner', text: 'So none of these agents exist.' },
  { who: 'codex', text: 'None of them. The roster, the machines, the accounts and this conversation are placeholders from the sample profile. Load a profile of your own and every one of them is replaced.' },
  { who: 'act', text: 'read sample profile — 2 hosts · 3 accounts · 6 channels · 6 conversations' },
  { who: 'owner', text: 'Show me what a working thread looks like.' },
  { who: 'codex', text: 'The lines below are the register a real session uses: a lane claims work and names its files, it reports phases with numbers and an evidence path, a reviewer accepts or rejects one criterion at a time, and quiet tool lines mark what actually ran.' },
  { who: 'luna-02', text: 'claim: the checks lane — no colliding claim, territory named file by file. phase 1 of 3 underway, checkpoint before the fence.' },
  { who: 'gem-lane-3', text: 'fix scoped to the one rejected criterion; the shared component is untouched. measured off the rendered box rather than the stylesheet. hand-back posted.' },
  { who: 'act', text: 'sample/evidence/handback-9.md written — 412 characters · lease heartbeat fresh' },
  { who: 'terra-01', text: 're-review: ACCEPT — 11 of 11 criteria pass, 38s. every path in the evidence tree resolves. evidence: sample/evidence/review-9.md' },
  { who: 'codex', text: 'One round, closed. That is the shape the register exists for: a claim, a measurement, a verdict, and a path somebody else can walk without asking a question.' },
  { who: 'owner', text: 'And when I connect something real?' },
  { who: 'codex', text: 'Switch a view to its live source in settings and it reads the local projection instead of this. If no host answers, that view says so plainly — it never falls back to the sample and lets you read placeholder traffic as real.' },
  { who: 'act', text: 'sample transcript ends here — the composer below still answers, from the same sample' },
]

const SAMPLE_ARRIVALS = [
  { who: 'luna-02', text: 'phase 2 complete — 18 of 18 checks pass, 1m26s. evidence: sample/evidence/phase-2.md' },
  { who: 'terra-01', text: 'sample/reviews/5: ACCEPT — 15 of 15 criteria pass, 52s. evidence tree complete.' },
  { who: 'codex', text: 'Roll-up: every lease fresh, no open blockers, one verdict queued. Sample readings throughout.' },
  { who: 'gem-lane-3', text: 'checkpoint at phase 4 of 5 — resuming after the plan re-read. nothing re-run.' },
  { who: 'act', text: 'lease sweep — four sample lanes active, all heartbeats fresh, no stale locks' },
  { who: 'sandbox-w1', text: 'sample backfill 3 of 9 posted — no lane left without an evidence path.' },
  { who: 'act', text: 'sample/evidence/roll-up.md written — 388 characters' },
  { who: 'codex', text: 'Nothing here needs a decision. The sample never asks for one — it only shows where one would land.' },
  { who: 'luna-02', text: 'lane released — nothing held past the sample wave.' },
  { who: 'act', text: 'sample transport check — none configured on this install' },
]

const SAMPLE_REPLIES = [
  'Noted. On a connected fleet this would go to the board and both hosts would ack it; here it stops at the sample.',
  'Checks first, then the territory gets scoped and the files named in the claim, so nothing collides.',
  'Every lease fresh, no open blockers, one verdict queued. Sample readings, but that is the shape of the answer.',
  'That one needs a decision at a gate, so it holds rather than guessing — a deadline never outranks the register.',
  'Flagged for a sweep. The evidence packet would name whatever it found, including nothing.',
  'Delegated with the territory scoped to two files. One fix round; a second failure escalates instead of retrying.',
  'The honest answer is mid-phase — checkpointed and resumable. Better landed clean than called done early.',
  'Recorded with an evidence path. A bare "done" would not survive a review anyway.',
]

const SAMPLE_REPLY_ACTS = [
  'checked the sample roster — no colliding claim',
  'sample register — 3 open gates, none blocking a lane',
  'read sample/notices — nothing new since the last read',
  'sample transports — none configured on this install',
]

export const SAMPLE_PROFILE = Object.freeze({
  schemaVersion: 1,
  id: 'sample',
  label: 'Sample fleet',
  machines: SAMPLE_MACHINES,
  transports: SAMPLE_TRANSPORTS,
  /* Named for what they measure, not for one vendor's product and one kind of
     account: these were vertexRemaining / vertexTotal / subSeatPct / uniPct,
     and the values were a real balance to the cent. */
  spend: { creditRemaining: 180, creditTotal: 300, seatPct: 60, dormantPct: 5 },
  pools: SAMPLE_POOLS,
  tasks: SAMPLE_TASKS,
  feed: SAMPLE_FEED,
  chat: SAMPLE_CHAT,
  chatReplies: SAMPLE_CHAT_REPLIES,
  chatContextReplies: SAMPLE_CHAT_CONTEXT_REPLIES,
  channels: SAMPLE_CHANNELS,
  board: SAMPLE_BOARD,
  conversations: SAMPLE_CONVERSATIONS,
  ledger: { requests: SAMPLE_REQUESTS, questions: SAMPLE_QUESTIONS },
  speakers: SAMPLE_SPEAKERS,
  session: SAMPLE_SESSION,
  arrivals: SAMPLE_ARRIVALS,
  replies: SAMPLE_REPLIES,
  replyActs: SAMPLE_REPLY_ACTS,
  sessionTitle: 'sample transcript · demonstration of this view',
  composerTarget: 'codex',
})

/* A stored profile is merged SECTION BY SECTION over the sample, and a section
   is taken only if it is the right shape and non-empty. A half-written profile
   must degrade to the sample it replaced, never to a view with nothing in it:
   an empty array here would reach the views as "the fleet is quiet", which is
   the absence-as-emptiness failure this codebase has already found repeatedly
   (see tools/check-research-queue.mjs on why an empty authored set is an
   error, not a state). */
const ARRAY_SECTIONS = ['machines', 'transports', 'pools', 'tasks', 'feed', 'chat', 'chatReplies',
  'channels', 'conversations', 'session', 'arrivals', 'replies', 'replyActs']
const OBJECT_SECTIONS = ['spend', 'chatContextReplies', 'board', 'speakers']
const TEXT_SECTIONS = ['id', 'label', 'sessionTitle', 'composerTarget']

function usableArray(value) {
  return Array.isArray(value) && value.length > 0
}

function usableObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0
}

function mergeProfile(stored) {
  if (!usableObject(stored)) return SAMPLE_PROFILE
  const merged = { ...SAMPLE_PROFILE }
  for (const key of ARRAY_SECTIONS) if (usableArray(stored[key])) merged[key] = stored[key]
  for (const key of OBJECT_SECTIONS) if (usableObject(stored[key])) merged[key] = stored[key]
  if (usableObject(stored.ledger)) {
    merged.ledger = {
      requests: usableArray(stored.ledger.requests) ? stored.ledger.requests : SAMPLE_PROFILE.ledger.requests,
      questions: usableArray(stored.ledger.questions) ? stored.ledger.questions : SAMPLE_PROFILE.ledger.questions,
    }
  }
  for (const key of TEXT_SECTIONS) {
    if (typeof stored[key] === 'string' && stored[key].trim()) merged[key] = stored[key]
  }
  return Object.freeze(merged)
}

function loadStoredProfile() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? mergeProfile(JSON.parse(raw)) : SAMPLE_PROFILE
  } catch {
    // A malformed or unreadable profile is the sample, silently: the views
    // behind this call have no error channel at module-evaluation time, and a
    // fleet that refuses to boot is worse than a fleet showing its sample.
    return SAMPLE_PROFILE
  }
}

export const FLEET = loadStoredProfile()

export const isSampleFleet = () => FLEET.id === SAMPLE_PROFILE.id
