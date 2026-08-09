// Deterministic, simulated request/question ledger. The records stay fixed;
// only their displayed ages advance from the moment this module is loaded.

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export const LEDGER_STARTED_AT = Date.now()

export const R_ITEMS = [
  { id: 'R1', title: 'Cut the canonical host over without mirror drift', status: 'in-progress', agent: 'codex', ageMs: 3 * HOUR + 18 * MINUTE, gate: 'IRREVERSIBLE', evidence: 'reports/r1/cutover-register.md', claimedAt: '17:08:12Z' },
  { id: 'R1.1', parent: 'R1', title: 'Freeze machine ownership at the current revision', status: 'done', agent: 'claude', ageMs: 4 * HOUR + 7 * MINUTE, evidence: 'fleet-board/directive/current@45', claimedAt: '16:19:44Z' },
  { id: 'R1.1.1', parent: 'R1.1', title: 'Compare preflight with the ownership table', status: 'done', agent: 'terra-01', ageMs: 4 * HOUR + 31 * MINUTE, evidence: 'reports/r1/ownership-diff.txt', claimedAt: '15:56:08Z' },
  { id: 'R1.1.2', parent: 'R1.1', title: 'Publish the cutover condition to directive/current', status: 'gated', agent: 'codex', ageMs: 2 * HOUR + 42 * MINUTE, gate: 'OUTWARD', evidence: 'packets/r1/directive-rev-46.json', claimedAt: '17:44:03Z' },
  { id: 'R1.2', parent: 'R1', title: 'Retire the compatibility mirror after month-end', status: 'gated', agent: 'claude', ageMs: 1 * DAY + 6 * HOUR, gate: 'IRREVERSIBLE', evidence: 'reports/r1/mirror-retirement.md', claimedAt: '15:12:19Z' },
  { id: 'R1.2.1', parent: 'R1.2', title: 'Capture the final mirror checksum evidence', status: 'open', agent: 'sandbox-w1', ageMs: 51 * MINUTE, evidence: 'artifacts/r1/final-mirror.sha256', claimedAt: '—' },
  { id: 'R1.2.2', parent: 'R1.2', title: 'Fence writes on the retired host', status: 'open', agent: 'luna-02', ageMs: 37 * MINUTE, gate: 'LOCAL-WORK', evidence: 'reports/r1/write-fence-plan.md', claimedAt: '—' },
  { id: 'R1.3', parent: 'R1', title: 'Verify the first canonical-only morning wake', status: 'open', agent: 'gem-lane-2', ageMs: 24 * MINUTE, evidence: 'artifacts/r1/morning-wake.txt', claimedAt: '—' },

  { id: 'R2', title: 'Close the scheduler fence repro with replayable evidence', status: 'blocked', agent: 'luna-02', ageMs: 2 * DAY + 3 * HOUR, evidence: 'reports/r2/fence-repro.md', claimedAt: '14:02:51Z' },
  { id: 'R2.1', parent: 'R2', title: 'Reproduce the cold-store remove-path failure', status: 'done', agent: 'sandbox-w1', ageMs: 1 * DAY + 20 * HOUR, evidence: 'artifacts/r2/cold-store-repro.json', claimedAt: '14:17:03Z' },
  { id: 'R2.1.1', parent: 'R2.1', title: 'Pin the empty lease-table seed', status: 'done', agent: 'sandbox-w1', ageMs: 1 * DAY + 19 * HOUR, evidence: 'artifacts/r2/seed-2048.txt', claimedAt: '15:04:21Z' },
  { id: 'R2.1.2', parent: 'R2.1', title: 'Measure the cold and warm failure split', status: 'done', agent: 'terra-01', ageMs: 1 * DAY + 17 * HOUR, evidence: 'reports/r2/temperature-matrix.csv', claimedAt: '17:26:39Z' },
  { id: 'R2.2', parent: 'R2', title: 'Guard remove when the lease table is empty', status: 'in-progress', agent: 'luna-02', ageMs: 6 * HOUR + 11 * MINUTE, gate: 'LOCAL-WORK', evidence: 'packets/r2/remove-guard.diff', claimedAt: '14:14:09Z' },
  { id: 'R2.2.1', parent: 'R2.2', title: 'Run two hundred cold and warm iterations', status: 'in-progress', agent: 'gem-lane-4', ageMs: 2 * HOUR + 26 * MINUTE, evidence: 'artifacts/r2/iteration-log.ndjson', claimedAt: '17:59:42Z' },
  { id: 'R2.2.2', parent: 'R2.2', title: 'Record the remove-before-create verdict', status: 'open', agent: 'terra-01', ageMs: 16 * MINUTE, evidence: 'reports/r2/verdict.md', claimedAt: '—' },
  { id: 'R2.3', parent: 'R2', title: 'Promote the accepted packet into the request ledger', status: 'gated', agent: 'codex', ageMs: 5 * HOUR + 49 * MINUTE, gate: 'OUTWARD', evidence: 'packets/r2/promotion.json', claimedAt: '14:36:37Z' },

  { id: 'R3', title: 'Restore the bounded bridge lane without hiding tunnel health', status: 'in-progress', agent: 'codex', ageMs: 9 * HOUR + 3 * MINUTE, evidence: 'reports/r3/lane-recovery.md', claimedAt: '11:22:14Z' },
  { id: 'R3.1', parent: 'R3', title: 'Probe tunnel and bridge as independent lanes', status: 'done', agent: 'claude', ageMs: 8 * HOUR + 42 * MINUTE, evidence: 'artifacts/r3/lane-probes.json', claimedAt: '11:43:26Z' },
  { id: 'R3.1.1', parent: 'R3.1', title: 'Verify tunnel auth on port 8787', status: 'done', agent: 'terra-01', ageMs: 8 * HOUR + 30 * MINUTE, evidence: 'artifacts/r3/tunnel-8787.txt', claimedAt: '11:55:10Z' },
  { id: 'R3.1.2', parent: 'R3.1', title: 'Verify bridge tool roundtrip on port 8788', status: 'done', agent: 'gem-lane-3', ageMs: 8 * HOUR + 12 * MINUTE, evidence: 'artifacts/r3/bridge-8788.txt', claimedAt: '12:13:48Z' },
  { id: 'R3.2', parent: 'R3', title: 'Rebuild the stale bridge mirror from canonical state', status: 'in-progress', agent: 'claude', ageMs: 3 * HOUR + 56 * MINUTE, evidence: 'packets/r3/bridge-mirror.json', claimedAt: '16:29:07Z' },
  { id: 'R3.2.1', parent: 'R3.2', title: 'Reconcile the remote capability manifest', status: 'in-progress', agent: 'gem-lane-2', ageMs: 1 * HOUR + 48 * MINUTE, evidence: 'reports/r3/capability-diff.txt', claimedAt: '18:37:31Z' },
  { id: 'R3.2.2', parent: 'R3.2', title: 'Clear the stale owner-host fence', status: 'blocked', agent: 'sandbox-w1', ageMs: 1 * HOUR + 21 * MINUTE, evidence: 'reports/r3/owner-host-fence.md', claimedAt: '19:04:02Z' },
  { id: 'R3.3', parent: 'R3', title: 'Hold cutover until the remote receipt matches', status: 'gated', agent: 'codex', ageMs: 3 * HOUR + 14 * MINUTE, gate: 'OUTWARD', evidence: 'packets/r3/receipt-compare.json', claimedAt: '17:11:50Z' },

  { id: 'R8', title: 'Backfill evidence paths for legacy lane-end events', status: 'open', agent: 'sandbox-w1', ageMs: 5 * DAY + 2 * HOUR, evidence: 'reports/r8/lane-end-backfill.md', claimedAt: '—' },
  { id: 'R12', title: 'Refresh grepsaver cards that fail the freshness probe', status: 'in-progress', agent: 'gem-lane-4', ageMs: 7 * HOUR + 34 * MINUTE, gate: 'LOCAL-WORK', evidence: 'reports/r12/card-sweep.md', claimedAt: '12:51:28Z' },
  { id: 'R19', title: 'Drain the owner inbox under the current directive', status: 'gated', agent: 'codex', ageMs: 46 * MINUTE, gate: 'OUTWARD', evidence: 'packets/r19/inbox-drain.json', claimedAt: '19:39:11Z' },
  { id: 'R27', title: 'Quarantine the retired plan corpus from live routing', status: 'blocked', agent: 'terra-01', ageMs: 3 * DAY + 11 * HOUR, gate: 'IRREVERSIBLE', evidence: 'reports/r27/quarantine-map.md', claimedAt: '10:06:53Z' },
]

export const Q_ITEMS = [
  { id: 'Q61', question: 'Keep the compatibility mirror through month-end, then cut it?', status: 'answered', answer: 'Keep the mirror through month-end; canonical-only starts on the first morning wake after.', agent: 'codex', ageMs: 2 * DAY + 4 * HOUR, evidence: 'fleet-board/directive/current@45', claimedAt: '18:04:09Z' },
  { id: 'Q62', question: 'May the bridge recovery clear the stale owner-host fence locally?', status: 'pending', agent: 'claude', ageMs: 3 * HOUR + 6 * MINUTE, evidence: 'owner-inbox/Q62.json', claimedAt: '17:19:31Z' },
  { id: 'Q63', question: 'Should a lane with no outcome packet be treated as failed?', status: 'answered', answer: 'Only if it ended; a truncated lane is continuation and keeps its checkpoint open.', agent: 'terra-01', ageMs: 1 * DAY + 9 * HOUR, evidence: 'fleet-board/help-request-044-answer', claimedAt: '12:27:44Z' },
  { id: 'Q64', question: 'Which host owns write-path decisions during the mirror window?', status: 'pending', agent: 'gem-lane-2', ageMs: 2 * HOUR + 18 * MINUTE, evidence: 'owner-inbox/Q64.json', claimedAt: '18:07:20Z' },
  { id: 'Q65', question: 'Can the scheduler guard ship before the two-hundred-run sweep closes?', status: 'pending', agent: 'luna-02', ageMs: 1 * HOUR + 52 * MINUTE, evidence: 'owner-inbox/Q65.json', claimedAt: '18:33:05Z' },
  { id: 'Q66', question: 'Do tunnel and bridge health belong in one combined metric?', status: 'answered', answer: 'No; show them as independent lanes because either can fail while the other stays green.', agent: 'claude', ageMs: 3 * DAY + 1 * HOUR, evidence: 'fleet-board/directive/current@44', claimedAt: '09:46:18Z' },
  { id: 'Q67', question: 'May a reviewer accept a criterion from screenshot evidence alone?', status: 'pending', agent: 'terra-01', ageMs: 58 * MINUTE, evidence: 'owner-inbox/Q67.json', claimedAt: '19:27:16Z' },
  { id: 'Q68', question: 'Should unanswered retired-key help requests escalate to the coordinator?', status: 'answered', answer: 'Yes; retired keys do not waive the twenty-four-hour coordinator escalation.', agent: 'sandbox-w1', ageMs: 4 * DAY + 7 * HOUR, evidence: 'fleet-board/help-request-044-answer', claimedAt: '13:41:27Z' },
  { id: 'Q69', question: 'Can the final mirror checksum be captured before the month-end fence?', status: 'pending', agent: 'gem-lane-4', ageMs: 43 * MINUTE, evidence: 'owner-inbox/Q69.json', claimedAt: '19:42:50Z' },
  { id: 'Q70', question: 'Does the inbox drain need an outward receipt for every answer?', status: 'pending', agent: 'codex', ageMs: 31 * MINUTE, evidence: 'owner-inbox/Q70.json', claimedAt: '19:54:32Z' },
  { id: 'Q71', question: 'Should stale cards stay visible while a refresh is staged?', status: 'answered', answer: 'Yes; mark them stale and keep them visible until the verified replacement is promoted.', agent: 'gem-lane-3', ageMs: 2 * DAY + 13 * HOUR, evidence: 'fleet-board/directive/current@43', claimedAt: '09:18:40Z' },
  { id: 'Q72', question: 'May the retired plan corpus remain searchable after quarantine?', status: 'pending', agent: 'terra-01', ageMs: 19 * MINUTE, evidence: 'owner-inbox/Q72.json', claimedAt: '20:06:01Z' },
]

export function liveAgeMs(item, now = Date.now()) {
  return item.ageMs + Math.max(0, now - LEDGER_STARTED_AT)
}

export function formatLedgerAge(ms) {
  const minutes = Math.max(1, Math.floor(ms / MINUTE))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ${minutes % 60}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}
