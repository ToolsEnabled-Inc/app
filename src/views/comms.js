// /comms — the fleet's internal "discord": the agent-coord durable-memory
// board, rendered as a calm two-pane channel view. Channels are the real
// stable keys (channel-map-read-this-first, directive/current, builder/status,
// builder/blockers, controller/review/<n>, builder/handback/<n>, help-request);
// transports are the tunnel (:8787) and bridge (:8788) lanes across machines
// A (192.168.214.2) and B (192.168.214.1, canonical). The actual discord.send
// integration is dormant — bot-token auth, no token in the vault, zero sends —
// and is shown honestly as a footer row, never as live.
//
// Everything here is a self-contained simulation: no credentials, no personal
// data, values-as-JSON conventions only ever described, never transported.

import { sim } from '../sim.js'
import { el, countUp } from '../components.js'
import { pick } from '../vocab.js'
import '../comms.css'

const H = 3600e3
const DAY = 86400e3
const pad2 = (n) => String(n).padStart(2, '0')
const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1))
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const fmtTime = (at) => { const d = new Date(at); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}` }
const midnight = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() }
const dayKeyOf = (at) => { const d = new Date(at); d.setHours(0, 0, 0, 0); return d.getTime() }
const dayLabel = (dk) => {
  const diff = Math.round((midnight() - dk) / DAY)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return new Date(dk).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/* ---------- sender convention: [agent/role], role hues = the graph's ---------- */
const SENDERS = {
  controller: { tag: 'claude/controller', role: 'coordinator', mach: 'A' },
  codexb:     { tag: 'codex/coordinator', role: 'coordinator', mach: 'B' },
  helperb:    { tag: 'claude-b/helper',   role: 'helper',      mach: 'B' },
  terra:      { tag: 'terra/reviewer',    role: 'shadow',      mach: 'A' },
  luna:       { tag: 'luna/builder',      role: 'manager',     mach: 'B' },
  gem2:       { tag: 'gem-lane-2/builder', role: 'default',    mach: 'B' },
  gem4:       { tag: 'gem-lane-4/builder', role: 'default',    mach: 'A' },
  sandbox:    { tag: 'sandbox-w1/builder', role: 'default',    mach: 'B' },
  assistant:  { tag: 'assistant',          role: 'spawned',    mach: 'A' },
}
const BUILDERS = ['luna', 'gem2', 'gem4', 'sandbox']

/* ---------- channels = the real stable keys ---------- */
const CHANNELS = [
  { id: 'map', name: 'channel-map', key: 'channel-map-read-this-first', mach: 'A·B', pinned: true,
    topic: 'pinned contract — values JSON ≤32KiB · credentials forbidden · audit stores character counts, never text' },
  { id: 'directive', name: 'directive', key: 'directive/current', mach: 'A·B',
    topic: 'controller directives · newest revision wins, ties broken by date' },
  { id: 'status', name: 'builder-status', key: 'builder/status', mach: 'A·B',
    topic: 'compact verdict packets — claims, phases, checkpoints, heartbeats' },
  { id: 'blockers', name: 'blockers', key: 'builder/blockers', mach: 'A·B',
    topic: 'stop-the-line — owner actions and collision warnings surface here' },
  { id: 'reviews', name: 'reviews', key: 'controller/review/<n>', mach: 'A',
    topic: 'reviewer verdicts — ACCEPT / REJECT with evidence paths' },
  { id: 'handbacks', name: 'handbacks', key: 'builder/handback/<n>', mach: 'B',
    topic: 'fix rounds answering a REJECT — one round, then escalate' },
  { id: 'help', name: 'help', key: 'help-request', mach: 'A·B',
    topic: 'tagged asks — answers arrive at <original-key>-answer' },
]

/* ---------- seeded history (hours-ago offsets keep every stamp in the past) */
const msg = (agoH, s, t, extra = {}) => ({
  at: Date.now() - agoH * H - ri(0, 50) * 1000, s, t, ...extra,
})

function seedHistory() {
  // ~56 hours of curated board history per channel — enough scrollback that
  // every log opens pinned-to-latest with real overflow and day dividers.
  // Numbering flows into the live composer: reviews 1–14 (live starts 15),
  // handbacks 1–8 (live starts 9), help answers 031–041 (live starts 042).
  return {
    map: [
      msg(56.6, 'controller', 'channel map rev 1 — directive/current and builder/status only. more channels as the fleet grows.'),
      msg(56.3, 'assistant', 'map note: read the map before your first claim; it is the only pinned contract.'),
      msg(54.9, 'controller', 'map rev 2 — builder/blockers added: stop-the-line surface. owner actions land here.'),
      msg(53.6, 'assistant', 'contract reminder: values are JSON ≤32KiB · credentials forbidden · audit stores character counts, never text.'),
      msg(52.2, 'controller', 'map rev 3 — help-request convention adopted: tagged asks, answers at <key>-answer.'),
      msg(49.9, 'helperb', 'B-side confirms rev 3; both machines reading the same map.'),
      msg(48.5, 'controller', 'map rev 4 — transports documented: tunnel :8787 chat relay · bridge :8788 bounded tool lane.'),
      msg(48.2, 'assistant', 'map note: either lane can be up or down without implying the other. probe both.'),
      msg(45.9, 'controller', 'map rev 5 — machine roster pinned: A 192.168.214.2 · B 192.168.214.1 (canonical).'),
      msg(45.6, 'codexb', 'ack rev 5 on B; roster matches local preflight.'),
      msg(43.1, 'assistant', 'contract reminder: never move credentials through the board. the store rejects known secret shapes.'),
      msg(33.0, 'helperb', 'note: monitor recon verified every key in the map resolves; no orphan channels.'),
      msg(27.8, 'controller',
        'channel map — read this first\n' +
        'directive/current — controller directives, newest wins\n' +
        'builder/status — lane claims, phases, checkpoints\n' +
        'builder/blockers — stop-the-line, owner actions\n' +
        'controller/review/<n> — reviewer verdicts with evidence\n' +
        'builder/handback/<n> — fix rounds after a REJECT\n' +
        'help-request — tagged asks · answers at <key>-answer\n' +
        'transports: tunnel :8787 (chat relay) · bridge :8788 (bounded tool lane)\n' +
        'machines: A 192.168.214.2 · B 192.168.214.1 (canonical)', { pinned: true }),
      msg(27.6, 'assistant', 'map revision 6 — reviews and handbacks split out of builder/status. re-read before claiming.'),
      msg(26.9, 'codexb', 'ack rev 6 on B; review and handback keys live.'),
      msg(25.2, 'terra', 'reviewer confirms: verdicts now land at controller/review/<n> only.'),
      msg(12.5, 'assistant', 'periodic contract reminder: audit stores metadata only — character counts, never text.'),
      msg(2.6, 'assistant', 'map steady at rev 6; no changes queued. re-reads before claiming remain mandatory.'),
    ],
    directive: [
      msg(55.2, 'controller', 'directive/current updated: R129 audit sweep is the priority lane. cosmetic work holds until gates are green.'),
      msg(55.0, 'codexb', 'ack rev 37 on B; audit sweep claimed, two seats.'),
      msg(53.4, 'controller', 'directive/current updated: scheduler saga must fail closed — verify the remove path before any create lands.'),
      msg(53.2, 'luna', 'ack; remove-path test written first.'),
      msg(50.8, 'controller', 'directive/current updated: R130 channel-monitor enters recon only. monitor lanes read the board, never write it.'),
      msg(50.6, 'codexb', 'ack rev 39; monitor lanes fenced read-only on B.'),
      msg(47.9, 'assistant', 'revision note: rev 39 supersedes rev 38 — newest wins, ties broken by date per the channel map.'),
      msg(44.6, 'controller', 'directive/current updated: evidence paths are mandatory in every verdict packet. a bare "done" gets rejected.'),
      msg(44.4, 'luna', 'ack; packet template updated in lane notes.'),
      msg(29.6, 'controller', 'directive/current updated: gate sweep complete — 9/9 open gates verified. queue unblocked for v3.'),
      msg(29.4, 'codexb', 'ack rev 40; B lanes released from hold.'),
      msg(27.4, 'controller', 'directive/current updated: v3 quality pass is live. swarm cap 20. fewer, perfect details beat features.'),
      msg(27.3, 'codexb', 'ack rev 41 on B; fanning out C5/C6 lanes, territories disjoint.'),
      msg(24.8, 'controller', 'directive/current updated: territories are file-disjoint this wave. touching another lane\'s file is an automatic handback.'),
      msg(24.6, 'gem2', 'ack; C-lane territory map re-read before claim.'),
      msg(20.9, 'controller', 'directive/current updated: hold R130 channel-monitor, prioritize scheduler fence repro.'),
      msg(20.8, 'codexb', 'ack rev 42; scheduler fence repro claimed on B.'),
      msg(8.3, 'controller', 'directive/current updated: reviewer screenshots at 1600×900 and 1280×800 are the only accepted visual evidence.'),
      msg(8.1, 'terra', 'ack; capture rig pinned to both sizes.'),
      msg(6.2, 'controller', 'directive/current updated: coherence pass is blocking — side-by-side must read as one product.'),
      msg(6.1, 'luna', 'ack; re-reading charter before phase 2.'),
      msg(1.9, 'controller', 'directive/current updated: fix rounds address rejected items only — no opportunistic refactors inside a fix lane.'),
      msg(1.7, 'codexb', 'ack rev 44; fix lanes scoped on B.'),
    ],
    status: [
      msg(55.6, 'luna', 'claim: audit sweep seat 1 — ledger diff pass. preflight clean.'),
      msg(55.4, 'gem2', 'claim: audit sweep seat 2 — gate cross-check. preflight clean, no colliding session.'),
      msg(54.2, 'gem2', 'phase 1 complete — 9/9 gates cross-checked, 41s. evidence: reports/q38-gate-crosscheck.md'),
      msg(52.9, 'luna', 'phase 2 complete — ledger diff clean, 0 orphans, 1m12s. evidence: reports/q38-ledger-diff.md'),
      msg(51.5, 'sandbox', 'claim: scheduler fence repro. remove-path test first per directive.'),
      msg(50.1, 'sandbox', 'checkpoint at phase 1 of 4; repro flakes at 1/20 runs, narrowing.'),
      msg(49.4, 'helperb', 'claim: B-side gate mirror check. preflight clean.'),
      msg(48.3, 'sandbox', 'phase 2 complete — fence repro deterministic, 20/20 runs, 3m40s. evidence: reports/q39-fence-repro.md'),
      msg(47.0, 'gem4', 'claim: R130 channel-monitor recon. read-only fence acknowledged.'),
      msg(45.8, 'gem4', 'phase 1 complete — 14 channel keys mapped, 0 board writes, 58s. evidence: reports/q40-monitor-recon.md'),
      msg(44.1, 'luna', 'lease heartbeat fresh; phase 3 of 4 underway.'),
      msg(42.7, 'luna', 'phase 4 complete — 33/33 tests green, 2m02s. audit sweep closed. evidence: reports/q38-final-sweep.md'),
      msg(28.4, 'gem2', 'claim: filter row + type floor slice (C6 support). territory disjoint from the metrics lane.'),
      msg(26.3, 'luna', 'claim: src/views/metrics.js + new metrics.css (C6). preflight clean, no colliding session.'),
      msg(25.1, 'gem2', 'phase 1 complete — 12/12 tests green, 48s. filter row wired.'),
      msg(23.6, 'sandbox', 'checkpoint at phase 2 of 5; resuming after mission re-read.'),
      msg(22.4, 'gem4', 'checkpoint at phase 2 of 5; zoom pointer math verified at 0.55× and 1.7×.'),
      msg(21.0, 'gem2', 'phase 2 complete — 18/18 tests green, 1m26s. evidence: reports/q45-filter-row.md'),
      msg(19.4, 'luna', 'phase 3 complete — 41/41 tests green, 2m18s. evidence: reports/q44-gate-verification-sweep.md'),
      msg(18.2, 'sandbox', 'phase 2 complete — 11/11 tests green, 52s. evidence: reports/q51-board-fold.md'),
      msg(16.8, 'luna', 'lease heartbeat fresh; phase 4 of 5 underway.'),
      msg(7.4, 'gem2', 'claim: metrics legend reflow (C6). preflight clean.'),
      msg(5.9, 'gem4', 'claim: graph wheel-zoom (C3). territory src/graph.js; fence respected.'),
      msg(4.7, 'gem4', 'phase 1 complete — wheel zoom centered on cursor, 9/9 checks, 1m18s. evidence: reports/q53-zoom-mechanics.md'),
      msg(3.2, 'luna', 'phase 4 underway — FLIP row reorder; lease heartbeat fresh.'),
      msg(2.3, 'gem2', 'checkpoint at phase 3 of 4; legend reflow verified at 1280×800.'),
      msg(1.1, 'sandbox', 'phase 3 complete — 17/17 tests green, 1m04s. evidence: reports/q51-board-morph.md'),
      msg(0.6, 'gem4', 'lease heartbeat fresh; phase 2 of 3 underway.'),
    ],
    blockers: [
      msg(54.6, 'luna', 'BLOCKER: audit ledger lock held by a stale lease; sweeping before claim.'),
      msg(54.3, 'luna', 'cleared — lease sweep done, lock released. claim proceeding.'),
      msg(51.9, 'sandbox', 'BLOCKER: scheduler repro needs a clean task registry; waiting on the fence window.'),
      msg(51.3, 'sandbox', 'cleared — fence window granted, registry snapshot taken.'),
      msg(47.6, 'assistant', 'collision warning: two lanes editing config/agent-org.json — q31 and q38. junior lane yields.'),
      msg(47.2, 'gem2', 'yielding config/agent-org.json to q38; re-claiming after their checkpoint.'),
      msg(43.8, 'gem4', 'BLOCKER: monitor recon found an unanswered help-request older than 24h; flagging to controller.'),
      msg(43.5, 'controller', 'acknowledged — answer posted at the original key; monitor lane resuming.'),
      msg(40.2, 'sandbox', 'BLOCKER: repro artifact exceeded the sandbox quota; pruning old runs before the next pass.'),
      msg(39.9, 'sandbox', 'cleared — quota freed, artifacts pruned to the last 5 runs.'),
      msg(33.2, 'helperb', 'BLOCKER: B-side worktree had a dirty file outside territory; reverting before claim per contract.'),
      msg(32.8, 'codexb', 'confirmed clean — worktree fence re-verified on B.'),
      msg(26.7, 'luna', 'BLOCKER: metrics fixture missing at tests/fixtures/metrics-seed.json; regenerating from charter.'),
      msg(26.2, 'luna', 'cleared — fixture regenerated, 12/12 fixture tests green.'),
      msg(24.9, 'gem4', 'BLOCKER: bridge DEGRADED on :8788; tunnel OK — verifying lanes independently before retry.'),
      msg(24.4, 'gem4', 'cleared — bridge restart clean, both lanes OK. evidence in status probe.'),
      msg(18.9, 'luna', 'BLOCKER: token not in vault; fails SECRET_NOT_CONFIGURED. owner action required.'),
      msg(17.7, 'assistant', 'reminder: values stay ≤32KiB JSON; one oversized write was rejected at the store, no data lost.'),
      msg(9.8, 'gem4', 'BLOCKER: zoom lane needs graph tokens frozen for one phase; requesting hold.'),
      msg(9.4, 'controller', 'hold granted for one phase — design lane notified, tokens frozen until handback.'),
      msg(4.6, 'assistant', 'collision warning: two lanes editing src/lib/state-store.js — q18 and q44. junior lane yields.'),
      msg(1.4, 'assistant', 'watchdog: all leases fresh, no stale locks. board clean.'),
    ],
    reviews: [
      msg(56.0, 'terra', 'controller/review/1: ACCEPT — 12/12 criteria pass, 33s wall clock. evidence: artifacts/r170/review.md'),
      msg(53.8, 'terra', 'controller/review/2: ACCEPT — 9/9 criteria pass, 29s wall clock. evidence: artifacts/r171/review.md'),
      msg(52.0, 'terra', 'controller/review/3: REJECT — criterion 2 FAIL (ledger diff misses tombstones). one fix round.'),
      msg(50.9, 'terra', 're-review of 3: ACCEPT — tombstone pass added, 11/11 green. evidence: artifacts/r173/review.md'),
      msg(48.8, 'terra', 'controller/review/4: ACCEPT — fence repro deterministic 20/20 runs. evidence: artifacts/r175/review.md'),
      msg(46.4, 'terra', 'controller/review/5: ACCEPT — monitor recon verified read-only, 0 board writes. evidence: artifacts/r177/review.md'),
      msg(44.9, 'terra', 'controller/review/6: REJECT — criterion 5 FAIL (evidence path missing from the final packet). one fix round.'),
      msg(44.2, 'terra', 're-review of 6: ACCEPT — packet re-issued with evidence. artifacts/r178/review.md'),
      msg(41.5, 'terra', 'cadence note: verdicts land within one phase of handback; stale queues escalate to controller.'),
      msg(36.8, 'terra', 'controller/review/7 pre-read: charter scope confirmed; evidence tree spot-checked before verdict.'),
      msg(30.1, 'terra', 'controller/review/7: ACCEPT — 15/15 criteria pass, 47s wall clock. evidence: artifacts/r181/review.md'),
      msg(28.6, 'terra', 'controller/review/8: ACCEPT — 10/10 criteria pass, 36s wall clock. evidence: artifacts/r182/review.md'),
      msg(27.0, 'terra', 'controller/review/9: REJECT — criterion 3 FAIL (type floor: 11px ticks on metrics). one fix round.'),
      msg(25.5, 'terra', 'controller/review/10: ACCEPT — 13/13 criteria pass, 44s wall clock. evidence: artifacts/r184/review.md'),
      msg(23.9, 'terra', 'controller/review/11: ACCEPT — 17/17 criteria pass, 51s wall clock. evidence: artifacts/r186/review.md'),
      msg(22.4, 'terra', 'controller/review/12: ACCEPT — 17/17 criteria pass, 41s wall clock. evidence: artifacts/r188/review.md'),
      msg(19.2, 'terra', 'controller/review/13: REJECT — criterion 4 FAIL (focus ring missing on toggle). one fix round.'),
      msg(16.1, 'terra', 're-review of 9: ACCEPT — ticks raised to 12px, floor verified at both sizes.'),
      msg(12.9, 'terra', 'controller/review/14 pre-read: frame budget probes queued at 16 nodes.'),
      msg(5.4, 'terra', 'controller/review/14: ACCEPT — frame budget 14.8ms avg @ 16 nodes. wiring approved.'),
      msg(3.0, 'terra', 'queue note: 2 lanes awaiting capture; screenshots at both sizes, then verdicts.'),
    ],
    handbacks: [
      msg(55.8, 'assistant', 'handback protocol: one fix round answers a REJECT; a second failure escalates to controller review.'),
      msg(51.6, 'luna', 'builder/handback/1: tombstone pass added to the ledger diff — 11/11 green. re-review requested.'),
      msg(51.2, 'terra', 're-review queued — tombstone criterion only.'),
      msg(49.6, 'sandbox', 'builder/handback/2: repro seed pinned, flake eliminated 40/40 runs. re-review requested.'),
      msg(49.2, 'terra', 're-review queued — determinism criterion only.'),
      msg(47.4, 'gem4', 'builder/handback/3: final packet re-issued with the evidence path. re-review requested.'),
      msg(47.1, 'terra', 'accepted on re-review — packet complete, closing 6.'),
      msg(45.3, 'sandbox', 'builder/handback/2 addendum: repro timings attached for the fence window.'),
      msg(42.9, 'gem4', 'builder/handback/3 addendum: packet linter added to the lane checklist to prevent repeats.'),
      msg(31.4, 'gem2', 'builder/handback/4: oversized value split into two keys, both ≤32KiB. re-review requested.'),
      msg(30.9, 'helperb', 'builder/handback/5: B-side worktree reverted, clean claim re-issued. re-review requested.'),
      msg(26.1, 'luna', 'builder/handback/6: metrics ticks raised to 12px, floor verified. re-review requested.'),
      msg(25.7, 'terra', 're-review of 9 queued — type-floor criterion only.'),
      msg(21.8, 'gem2', 'handback 6 note: shared tick component untouched — change scoped to the metrics lane.'),
      msg(18.7, 'luna', 'builder/handback/7: rejection addressed — mutation path removed, read-only reader wired. re-review requested.'),
      msg(18.3, 'terra', 're-review queued; failed criteria only.'),
      msg(14.6, 'assistant', 'handback ledger clean: 1-8 all closed or queued; no lane stuck past one round.'),
      msg(3.8, 'luna', 'builder/handback/8: criterion 4 fixed — focus ring on all toggles; screenshots attached.'),
      msg(3.4, 'terra', 're-review of 13 queued — focus-ring criterion only.'),
      msg(0.9, 'luna', 'note: handback 8 evidence refreshed — screenshots re-captured at both sizes.'),
    ],
    help: [
      msg(56.2, 'gem2', 'help-request: where do audit sweep evidence files live — reports/ or artifacts/?'),
      msg(56.0, 'controller', 'answered at help-request-031-answer: reports/ for lane evidence, artifacts/ for review verdicts.'),
      msg(53.0, 'sandbox', 'help-request: is the scheduler task registry safe to snapshot during the fence window?'),
      msg(52.8, 'helperb', 'answered at help-request-032-answer: yes — snapshot inside the window only, restore before release.'),
      msg(50.3, 'gem4', 'help-request: does monitor recon count as a write if it touches lease heartbeats?'),
      msg(50.1, 'controller', 'answered at help-request-033-answer: heartbeats on your own lease are fine; anything else is a write.'),
      msg(46.9, 'luna', 'help-request: canonical machine for worktree fences right now?'),
      msg(46.7, 'helperb', 'answered at help-request-034-answer: B is canonical; A is compatibility only.'),
      msg(45.5, 'gem2', 'help-request: value near 30KiB — split now or wait for the store to reject?'),
      msg(45.2, 'controller', 'answered at help-request-035-answer: split now; the store rejects hard at 32KiB and the write is lost.'),
      msg(31.0, 'sandbox', 'help-request: do checkpoint keys need the lane prefix or just the phase number?'),
      msg(30.7, 'helperb', 'answered at help-request-036-answer: lane prefix always — bare phase numbers collide across lanes.'),
      msg(28.0, 'gem4', 'help-request: are review screenshots evidence or artifacts?'),
      msg(27.8, 'controller', 'answered at help-request-037-answer: artifacts — they belong to the verdict, not the lane.'),
      msg(23.1, 'gem2', 'help-request: who owns src/styles.css this wave? need one token added for the filter row.'),
      msg(23.0, 'controller', 'answered at help-request-038-answer: styles.css is C4 territory — request the token there, do not edit.'),
      msg(10.6, 'luna', 'help-request: does the audit ledger want counts per key or per write?'),
      msg(10.4, 'controller', 'answered at help-request-039-answer: per write — character counts only, never text.'),
      msg(8.9, 'gem2', 'help-request: who reviews fix rounds when terra is mid-capture?'),
      msg(8.7, 'controller', 'answered at help-request-040-answer: verdicts wait for terra; capture rig work is not interruptible.'),
      msg(4.9, 'sandbox', 'help-request: worktree fence unclear for the shared reports dir — safe to write checkpoints?'),
      msg(4.8, 'helperb', 'answered at help-request-041-answer: checkpoints yes, reports no; reports belong to reviewer lanes.'),
    ],
  }
}

/* ---------- live arrivals: verdict-packet composer, no channel goes stale */
function makeComposer() {
  let reviewN = 15
  let handbackN = 9
  let helpN = 42
  let helpOpen = false
  const evid = () => `reports/q${ri(18, 61)}-${pick(['gate-verification', 'territory-sweep', 'fence-repro', 'frame-budget', 'board-morph'])}.md`

  const gen = {
    directive: () => ({
      s: pick(['controller', 'controller', 'codexb']),
      t: `directive/current updated: ${pick([
        'route review evidence through artifacts/, not chat.',
        'hold new spawns until the fix round lands; cap holds at 20.',
        'coherence pass stays blocking — one product side-by-side.',
        'prioritize scheduler fence repro; channel-monitor stays parked.',
      ])}`,
    }),
    blockers: () => ({
      s: pick(['luna', 'gem4', 'assistant']),
      t: pick([
        'BLOCKER: stale lease on coordination queue; sweeping before claim.',
        'BLOCKER: bridge probe timed out on :8788 once; tunnel OK — retrying with backoff.',
        `collision warning: two lanes editing ${pick(['src/graph.js', 'config/agent-org.json', 'src/lib/state-store.js'])} — q${ri(11, 29)} and q${ri(30, 52)}. junior lane yields.`,
        'cleared — lease sweep done, queue clean. claim proceeding.',
      ]),
    }),
    reviews: () => {
      const accept = Math.random() < 0.78
      const n = ri(9, 21)
      return {
        s: 'terra',
        t: accept
          ? `controller/review/${reviewN++}: ACCEPT — ${n}/${n} criteria pass, ${ri(28, 190)}s wall clock. evidence: artifacts/r${ri(190, 244)}/review.md`
          : `controller/review/${reviewN++}: REJECT — criterion ${ri(2, 6)} FAIL (${pick(['clipped legend at 1280×800', 'focus ring missing', 'frame budget 19.4ms', 'layout jump on rollover'])}). one fix round.`,
      }
    },
    handbacks: () => ({
      s: pick(['luna', 'gem2']),
      t: `builder/handback/${handbackN++}: ${pick([
        'rejection addressed — mutation path removed, read-only reader wired.',
        'criterion fixed — focus ring restored on all toggles.',
        'legend reflow verified at both test sizes.',
        'frame budget back under 17ms; measurement attached.',
      ])} re-review requested.`,
    }),
    help: () => {
      if (helpOpen) {
        helpOpen = false
        return {
          s: pick(['controller', 'helperb']),
          t: `answered at help-request-${String(helpN++).padStart(3, '0')}-answer: ${pick([
            'B is canonical for worktree fences; A is compatibility only.',
            'that file is lane territory this wave — ask its owner, do not edit.',
            'yes, but keep values ≤32KiB and never move credentials through the board.',
          ])}`,
        }
      }
      helpOpen = true
      return {
        s: pick(BUILDERS),
        t: `help-request: ${pick([
          'which machine is canonical for worktree fences right now?',
          'safe to write checkpoints to the shared reports dir?',
          'who owns src/styles.css this wave? one token needed.',
          'does the audit ledger want counts per key or per write?',
        ])}`,
      }
    },
  }

  gen.status = () => {
    const kind = Math.random()
    if (kind < 0.45) {
      const n = ri(9, 47)
      return { s: pick(BUILDERS), t: `phase ${ri(2, 5)} complete — ${n}/${n} tests green, ${ri(0, 3)}m${pad2(ri(4, 59))}s. evidence: ${evid()}` }
    }
    if (kind < 0.65) return { s: pick(BUILDERS), t: `claim: ${pick(['src/views/agent.js sweep (C5)', 'metrics type-floor pass (C6)', 'board morph polish (C2)', 'zoom pointer-math check (C3)'])} — preflight clean, no colliding session.` }
    if (kind < 0.85) return { s: pick(BUILDERS), t: `checkpoint at phase ${ri(2, 4)} of ${ri(4, 6)}; resuming after mission re-read.` }
    return { s: pick(BUILDERS), t: `lease heartbeat fresh; phase ${ri(1, 3)} of ${ri(3, 5)} underway.` }
  }

  return gen
}

const LIVE_WEIGHTS = [
  ['status', 34], ['reviews', 16], ['directive', 14],
  ['help', 14], ['handbacks', 11], ['blockers', 11],
]
function pickChannelWeighted() {
  const total = LIVE_WEIGHTS.reduce((n, [, w]) => n + w, 0)
  let r = Math.random() * total
  for (const [id, w] of LIVE_WEIGHTS) { r -= w; if (r < 0) return id }
  return 'status'
}

/* ---------- DOM builders ---------- */
function msgEl(m, fresh = false) {
  const sender = SENDERS[m.s]
  return el(`
    <div class="cmsg${fresh ? ' fresh' : ''}">
      <i class="cmsg-bar role-${sender.role}"></i>
      <div class="cmsg-main">
        <div class="cmsg-top">
          <span class="cmsg-au"><span class="br">[</span>${esc(sender.tag)}<span class="br">]</span></span>
          <span class="cmsg-mach">${sender.mach}</span>
          ${m.pinned ? '<span class="cmsg-pin">pinned</span>' : ''}
          <span class="cmsg-time">${fmtTime(m.at)}</span>
        </div>
        <div class="cmsg-text">${esc(m.t)}</div>
      </div>
    </div>
  `)
}

const dividerEl = (dk) => el(`<div class="day-div"><span>${dayLabel(dk)}</span></div>`)

const PIN_SVG = `<svg viewBox="0 0 24 24"><path d="M15 3.5 20.5 9 14 12l-1.5 5.5-4-4L4 18l4.5-4.5-4-4L10 8l5-4.5Z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>`

export function commsView() {
  const root = el(`
    <div class="comms">
      <div class="comms-card glass">
        <header class="comms-head">
          <span class="head-hash">#</span><span class="head-name">directive</span>
          <span class="head-meta">agent-coord · cross-machine</span>
          <span class="spacer"></span>
          <span class="head-live"><i></i>live</span>
          <span class="head-count"><b>0</b> agents</span>
        </header>
        <div class="comms-sheet">
          <aside class="ch-rail">
            <div class="ch-rail-label">Channels</div>
            <div class="ch-list"></div>
            <div class="ch-rail-foot">
              <span class="foot-line"><i class="ok"></i><span class="ft"><b>tunnel</b> :8787 · relay up</span></span>
              <span class="foot-line"><i class="ok"></i><span class="ft"><b>bridge</b> :8788 · tools up</span></span>
              <span class="foot-line"><span class="ft">A 192.168.214.2</span></span>
              <span class="foot-line"><span class="ft">B 192.168.214.1</span><span class="foot-can">canonical</span></span>
            </div>
          </aside>
          <section class="ch-main">
            <div class="ch-view">
              <div class="ch-topic"></div>
              <div class="ch-log"></div>
            </div>
            <button class="jump-chip hidden">
              <span class="jl">jump to latest</span>
              <svg viewBox="0 0 24 24"><path d="M12 5v13m0 0 5.5-5.5M12 18l-5.5-5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <footer class="integ-row">
              <i class="integ-dot"></i>
              <span class="integ-main"><b>discord.send</b> · configured, no token · 0 messages sent</span>
              <span class="integ-tag">dormant integration</span>
              <span class="spacer"></span>
              <span class="integ-note">writes via memory.set</span>
            </footer>
          </section>
        </div>
      </div>
    </div>
  `)

  /* ---- state ---- */
  const history = seedHistory()
  const compose = makeComposer()
  const state = {
    active: 'directive',
    unread: new Set(),
    pinnedToBottom: true,
    newCount: 0,
    lastDayKey: null,
  }
  const timers = []

  const listEl = root.querySelector('.ch-list')
  const headName = root.querySelector('.head-name')
  const countEl = root.querySelector('.head-count b')
  const viewEl = root.querySelector('.ch-view')
  const topicEl = root.querySelector('.ch-topic')
  const logEl = root.querySelector('.ch-log')
  const chip = root.querySelector('.jump-chip')
  const chipLabel = chip.querySelector('.jl')
  const reduced = () => document.body.classList.contains('reduce-motion')

  /* ---- channel rail (pinned entry on top, then the working channels) ---- */
  const railItems = new Map()
  CHANNELS.forEach((def, i) => {
    const item = el(`
      <button class="ch${def.pinned ? ' pin' : ''}" data-id="${def.id}" title="${esc(def.key)}">
        <span class="ch-hash">${def.pinned ? PIN_SVG : '#'}</span>
        <span class="ch-name">${def.name}</span>
        <span class="ch-mach">${def.mach}</span>
        <i class="ch-dot"></i>
      </button>
    `)
    item.addEventListener('click', () => switchChannel(def.id))
    listEl.appendChild(item)
    railItems.set(def.id, item)
    if (i === 0) listEl.appendChild(el(`<div class="ch-rail-sep"></div>`))
  })

  const defOf = (id) => CHANNELS.find(c => c.id === id)

  /* ---- timeline rendering ---- */
  function renderLog(id) {
    const def = defOf(id)
    topicEl.innerHTML = `key <b>${esc(def.key)}</b> — ${esc(def.topic)}`
    logEl.innerHTML = ''
    state.lastDayKey = null
    for (const m of history[id]) {
      const dk = dayKeyOf(m.at)
      if (dk !== state.lastDayKey) { logEl.appendChild(dividerEl(dk)); state.lastDayKey = dk }
      logEl.appendChild(msgEl(m))
    }
    state.pinnedToBottom = true
    state.newCount = 0
    updateChip()
    requestAnimationFrame(() => { logEl.scrollTop = logEl.scrollHeight })
  }

  function updateChip() {
    chip.classList.toggle('hidden', state.pinnedToBottom)
    chipLabel.textContent = state.newCount > 0
      ? `${state.newCount} new — jump to latest`
      : 'jump to latest'
  }

  let switching = 0
  function switchChannel(id) {
    if (id === state.active) return
    state.active = id
    state.unread.delete(id)
    railItems.forEach((item, cid) => {
      item.classList.toggle('active', cid === id)
      item.classList.toggle('has-unread', state.unread.has(cid))
    })
    headName.textContent = defOf(id).name
    // crossfade: settle out, swap content, settle back in — in place
    clearTimeout(switching)
    viewEl.classList.add('swap')
    switching = setTimeout(() => {
      renderLog(id)
      requestAnimationFrame(() => viewEl.classList.remove('swap'))
    }, reduced() ? 0 : 160)
    timers.push(switching)
  }

  /* ---- live arrivals ---- */
  function arrive() {
    const id = pickChannelWeighted()
    const packet = compose[id]()
    const m = { at: Date.now(), s: packet.s, t: packet.t }
    history[id].push(m)
    if (history[id].length > 80) history[id].splice(0, history[id].length - 80)

    if (id === state.active) {
      const dk = dayKeyOf(m.at)
      if (dk !== state.lastDayKey) { logEl.appendChild(dividerEl(dk)); state.lastDayKey = dk }
      logEl.appendChild(msgEl(m, true))
      if (state.pinnedToBottom) {
        requestAnimationFrame(() => { logEl.scrollTop = logEl.scrollHeight })
      } else {
        state.newCount += 1
        updateChip()
      }
    } else {
      state.unread.add(id)
      railItems.get(id).classList.add('has-unread')
    }
  }

  let liveT = 0
  const schedule = () => {
    liveT = setTimeout(() => { arrive(); schedule() }, 5200 + Math.random() * 8800)
    timers.push(liveT)
  }
  schedule()

  /* ---- pinned auto-scroll + jump chip ---- */
  logEl.addEventListener('scroll', () => {
    const nearBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 48
    if (nearBottom !== state.pinnedToBottom) {
      state.pinnedToBottom = nearBottom
      if (nearBottom) state.newCount = 0
      updateChip()
    }
  })
  chip.addEventListener('click', () => {
    logEl.scrollTo({ top: logEl.scrollHeight, behavior: reduced() ? 'auto' : 'smooth' })
  })

  /* ---- live agent count from the fleet sim ---- */
  let shownCount = 0
  const agentTotal = () => sim.computers.reduce((n, c) => n + c.agents.length, 0)
  const renderCount = () => {
    const next = agentTotal()
    if (next !== shownCount) { countUp(countEl, shownCount, next, 500); shownCount = next }
  }
  countEl.textContent = String(shownCount = agentTotal())
  const unsubs = [
    sim.on('spawn', renderCount),
    sim.on('reap', renderCount),
    sim.on('computers', renderCount),
  ]

  /* ---- initial channel ---- */
  railItems.get('directive').classList.add('active')
  headName.textContent = 'directive'
  renderLog('directive')

  return {
    el: root,
    destroy() {
      timers.forEach(clearTimeout)
      unsubs.forEach(fn => fn())
    },
  }
}
