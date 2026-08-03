// Grounded vocabulary — pulled from the real system's operational language.

export const TASKS = [
  'Verify FRA handshake state', 'Reconcile open ledger gates', 'Drain owner inbox backlog',
  'Refresh stale grepsaver cards', 'Re-run preflight after handoff', 'Audit tunnel lane health',
  'Promote pending system cards', 'Verify bridge tool profile', 'Regenerate tool namespace digest',
  'Sweep unclaimed task leases', 'Checkpoint long-running builder phase', 'Cross-check machine ownership table',
  'Validate role directive recency', 'Flush audit spool records', 'Verify signed audit chain',
  'Re-point stale test pin', 'Index memory namespace channels', 'Answer pending help request',
  'Confirm kill switch clear', 'Rebuild lean tool allowlist', 'Measure orientation token savings',
  'Quarantine stale plan corpus', 'Split queue into package slices', 'Verify worktree isolation fences',
  'Escalate stale heartbeat reading',
]

export const FEED = [
  'indexing memory namespace agent-coord', 'running preflight from repo root',
  'polling owner inbox for unread messages', 'probing tunnel lane on 8787',
  'probing bridge lane on 8788', 'verifying FRA handshake on 8790',
  'regenerating per-namespace tool digest', 're-reading standing orders before outward action',
  'checking ledger for open gates', 'claiming task lease on coordination queue',
  'heartbeating claimed task before checkpoint', 'writing builder status to durable memory',
  'scanning recent sessions for territory claims', 'comparing declared vs connected MCP servers',
  'reading role assignment from agent org', 'spot-verifying card claims against live files',
  'promoting card after freshness check', 'sweeping stale leases from task queue',
  'flushing audit spool to signed ledger', 'verifying audit chain at latest sequence',
  'checking kill switch state before egress', 'resolving directive tie-break by date',
  'recording checkpoint before phase fence', 're-reading mission revision after phase',
  'watching heartbeat freshness on fleet supervisor', 'matching repo path against ownership table',
  'searching help-request tags in coordination memory', 'answering help request with keyed reply',
  'staging refresh task for stale card', 'treating truncated run as continuation',
]

export const CHAT = [
  { from: 'them', text: 'claim freshness-automation phase; territory grepsaver tools; report evidence, not intent' },
  { from: 'me', text: 'claimed; preflight clean, no colliding session; starting card sweep' },
  { from: 'them', text: 'verdict: ACCEPT fleet summary, 17 checks pass; wire it' },
  { from: 'me', text: 'handback n=2: rejection addressed, mutation path removed, read-only reader wired' },
  { from: 'them', text: 'blocker check: bridge DEGRADED, tunnel OK; verify lanes independently first' },
  { from: 'me', text: 'bridge restart clean; both lanes OK; evidence in status probe' },
  { from: 'them', text: 'reminder: truncation is continuation, not completion; checkpoint and resume' },
  { from: 'me', text: 'checkpointed at phase 3 of 5; resuming after mission re-read' },
  { from: 'them', text: 'gate open on OUTWARD class; hold send until ledger clears' },
  { from: 'me', text: 'held; gate cleared at revision bump; artifact sent, receipt logged' },
]

export const CHAT_REPLIES = [
  'ack — evidence packet in agent-coord under keyed reply',
  'verdict: ACCEPT, 12 checks pass, 41s wall clock',
  'preflight clean; no colliding territory; proceeding',
  'checkpointed; resuming after mission re-read',
  'lease heartbeat fresh; phase 2 of 4 underway',
  'read-only sweep done; 3 cards promoted, 1 staged for refresh',
  'holding at fence; gate unmet, watching ledger revision',
  'spawned two worker lanes; territories non-overlapping',
]

export const SUBSYSTEMS = [
  'Preflight', 'Standing Orders', 'Ledger Gates', 'Owner Inbox', 'Agent-Coord Memory',
  'Task Queue', 'Tool Registry', 'Audit Ledger', 'Kill Switch', 'Tunnel', 'Bridge',
  'FRA Lane', 'Grepsaver Cards', 'Fleet Supervisor', 'Dashboard', 'Build Queue',
  'Role Operations', 'Sandbox', 'Scheduler',
]

export const ROLES = {
  coordinator: { label: 'Coordinator', color: 'var(--c-coordinator)', hex: '#00a9d8', glow: '#45d6ff' },
  helper: { label: "Coordinator's Helper", color: 'var(--c-helper)', hex: '#f57b00', glow: '#ffab4d' },
  shadow: { label: 'Shadow Manager', color: 'var(--c-shadow)', hex: '#00bd8a', glow: '#35eab7' },
  manager: { label: 'Manager', color: 'var(--c-manager)', hex: '#3e63f0', glow: '#7d9bff' },
  default: { label: 'Default', color: 'var(--c-default)', hex: '#dba400', glow: '#ffd84d' },
  spawned: { label: 'Agent spawned', color: 'var(--c-spawned)', hex: '#26313f', glow: '#93a1af' },
}

export const POOLS = [
  { id: 'jpinckard21', kind: 'Subscription', desc: 'subscription-cli · vertex-seat · antigravity', color: '#00a9d8', glow: '#45d6ff' },
  { id: 'jpinckard95', kind: 'Vertex trial', desc: 'vertex credit · agentic worktree lanes', color: '#3e63f0', glow: '#7d9bff' },
  { id: 'jpinc005', kind: 'University', desc: 'campus SSO · no compute lanes', color: '#00bd8a', glow: '#35eab7' },
]

export const PROVIDERS = [
  { id: 'codex', label: 'Codex', color: '#00a9d8' },
  { id: 'claude', label: 'Claude', color: '#f57b00' },
  { id: 'gemini', label: 'Gemini', color: '#3e63f0' },
  { id: 'local', label: 'Local', color: '#00bd8a' },
]

export function pick(arr, rng = Math.random) {
  return arr[Math.floor(rng() * arr.length)]
}
