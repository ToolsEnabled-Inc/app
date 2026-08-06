/** Generate the declared-agent and observed-session projection. */
import {
  CANONICAL_ROOT,
  LIVE_ROOT,
  available,
  availableEnvelope,
  emitProjection,
  loadReader,
  readJsonFile,
  runJsonCli,
  source,
  sourceFromResult,
  timestampFromAge,
  unavailable,
  unavailableEnvelope,
} from './gen-projection-lib.mjs'

const DOMAIN = 'agents'
const SESSION_ID = /^[A-Za-z0-9-]{8,80}$/

function sessionObservation(preflight) {
  if (!preflight.ok) return unavailable(preflight.reason || 'source-unreachable', preflight.observedAt)

  const report = preflight.value
  const reference = report?.generatedAt
  const groups = report?.otherAgents
  if (!Number.isFinite(Date.parse(reference))
    || !groups
    || typeof groups !== 'object'
    || Array.isArray(groups)
    || !Array.isArray(groups.codex)
    || !Array.isArray(groups.claude)) {
    return unavailable('source-malformed', preflight.observedAt)
  }

  const sessions = []
  for (const [provider, rows] of [['codex', groups.codex], ['claude', groups.claude]]) {
    for (const row of rows) {
      const sessionId = typeof row?.id === 'string' ? row.id : ''
      if (!SESSION_ID.test(sessionId)) continue
      sessions.push({
        provider,
        sessionId,
        updatedAt: timestampFromAge(reference, Number(row.ageMs)),
      })
    }
  }
  return available(sessions, preflight.observedAt)
}

await emitProjection(DOMAIN, async at => {
  const reader = loadReader(CANONICAL_ROOT, 'src/lib/agent-org.js', 'canonical-agent-org-reader')
  const config = readJsonFile(CANONICAL_ROOT, 'config/agent-org.json', 'canonical-agent-org')
  const sources = [sourceFromResult(reader, 'canonical-reader'), sourceFromResult(config, 'canonical-config')]

  if (!reader.ok || !config.ok || typeof reader.value?.normalizeOrg !== 'function') {
    return unavailableEnvelope(DOMAIN, !config.ok ? config.reason : 'source-reader-failed', sources, at)
  }

  let org
  try {
    org = reader.value.normalizeOrg(config.value)
  } catch {
    sources[1] = source({
      id: config.sourceId,
      kind: 'canonical-config',
      path: config.path,
      ok: false,
      reason: 'source-malformed',
    })
    return unavailableEnvelope(DOMAIN, 'source-malformed', sources, at)
  }

  const preflight = runJsonCli(LIVE_ROOT, 'tools/agent-preflight.js', ['--json'], 'live-agent-preflight')
  const sessions = sessionObservation(preflight)
  sources.push(source({
    id: preflight.sourceId,
    kind: 'live-cli',
    path: preflight.path,
    ok: sessions.ok,
    observedAt: preflight.observedAt,
    reason: sessions.reason,
  }))

  return availableEnvelope(DOMAIN, {
    revision: org.revision,
    contentHash: org.contentHash,
    declared: org.agents.map(agent => ({
      id: agent.id,
      displayName: agent.displayName,
      role: agent.role,
      provider: agent.provider,
      enabled: agent.enabled,
      assignedPhase: agent.assignedPhase,
      phasePriority: [...agent.phasePriority],
    })),
    relationships: org.relationships.map(({ from, to, type }) => ({ from, to, type })),
    observedSessions: sessions,
  }, sources, at)
})
