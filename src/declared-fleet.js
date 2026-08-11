/* THIS COMPUTER, DRAWN FROM WHAT THIS COPY ACTUALLY DECLARES.
 *
 * THE DEFECT THIS EXISTS TO CLOSE, measured on the packaged build with a fresh
 * profile (release/win-unpacked, isolated LOCALAPPDATA/USERPROFILE, permission
 * level `standard`):
 *
 *     /data/fleet.json    ok:false  "No local agent fleet host detected on this machine."
 *     /data/agents.json   ok:false  same reason
 *     window.mcOrg.read() ok:true   source "baseline", 1 declared agent, 9 roles
 *     .static-tree-node on the computers page: 0
 *
 * Both projections are BUILD-TIME files. tools/gen-fleet.mjs reads the engine's
 * own config and presence state at package time, and on any machine that is not
 * the developer's there is nothing to read, so the shipped answer is `ok:false`
 * — permanently, on every customer install, forever. The computers page treated
 * that one file as the only possible answer to "which computers exist", so it
 * drew nothing and said the machine had no fleet host.
 *
 * Meanwhile the same page had already read, in the same `Promise.all`, a live
 * per-machine description of the organisation this copy declares — the one the
 * page's own hierarchy drag and role menu WRITE to — and used it only to render
 * a role library. The absence of the OBSERVED source was read as the absence of
 * every source. That is this project's recurring shape wearing a different hat:
 * nothing specified, so nothing exists.
 *
 * WHAT THIS MODULE IS AND IS NOT. It is a pure adapter: it reshapes an
 * organisation record into the two projection shapes the views already consume,
 * so both surfaces keep exactly one renderer and exactly one set of edit rules.
 * It INVENTS NOTHING. No runtime, no task count, no failure rate, no service is
 * synthesised — every field the organisation does not carry is simply absent,
 * and the views already print "not provided by fleet projection" for those.
 * A declared agent is a configured agent, never an observed one, and nothing
 * here may make it look like one.
 */

/* The identity of the machine the app is running on. It is a route segment
   (`#/agent/<computer>/<agent>`), so it has to be stable across launches or a
   bookmark to a drill-in would rot; and it must not be derived from the host
   name, which would put an owner-identifying string into a URL and into every
   screenshot of one. */
export const THIS_COMPUTER_ID = 'this-computer'
export const THIS_COMPUTER_LABEL = 'This computer'

const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** The declared agents of an organisation record, or [] when there are none. */
function declaredAgents(org) {
  if (!isRecord(org) || !Array.isArray(org.agents)) return []
  return org.agents.filter(agent => isRecord(agent) && typeof agent.id === 'string' && agent.id.length > 0)
}

/** The management edges, in the projection's own edge vocabulary. */
function declaredEdges(org, present) {
  if (!isRecord(org) || !Array.isArray(org.relationships)) return []
  return org.relationships
    .filter(relation => isRecord(relation)
      && relation.type === 'manages'
      && present.has(relation.from)
      && present.has(relation.to))
    .map(relation => ({ from: relation.from, to: relation.to, type: 'manages', sourceKind: 'declared' }))
}

/**
 * The fleet projection's `data` shape, built from a declared organisation.
 *
 * Returns null when there is nothing to draw, and NULL IS THE IMPORTANT HALF:
 * a caller must be able to tell "this copy declares an organisation" from "it
 * declares none", because the second one is the empty state and the empty state
 * is a correct answer. An organisation with zero agents produces null rather
 * than a computer with no agents on it — a node you cannot open is the same
 * dead end as no node at all, one screen further along.
 */
export function declaredFleetData(org) {
  const agents = declaredAgents(org)
  if (!agents.length) return null
  const present = new Set(agents.map(agent => agent.id))
  return {
    computers: [{
      id: THIS_COMPUTER_ID,
      label: THIS_COMPUTER_LABEL,
      /* Empty on purpose. Services are things a fleet host REPORTS, and there is
         no fleet host here; the rail already prints "No services declared by
         fleet projection" for this case rather than inventing one. */
      services: [],
      sourceKind: 'declared',
    }],
    graph: {
      nodes: agents.map(agent => ({
        id: agent.id,
        label: typeof agent.displayName === 'string' && agent.displayName ? agent.displayName : agent.id,
        role: agent.role,
        provider: agent.provider,
        enabled: agent.enabled !== false,
        /* bornAt / stoppedAt / tasksDone / failRate / origin are DELIBERATELY
           ABSENT. The organisation says what is configured, not what has run,
           and projectedComputer() already turns a missing one into null with
           the reason "not provided by fleet projection" printed beside it. */
      })),
      edges: declaredEdges(org, present),
      revision: Number.isSafeInteger(org?.revision) ? org.revision : null,
    },
  }
}

/**
 * The agents projection's `data` shape, built from the same record, so the
 * drill-in resolves from the same source the graph was drawn from.
 *
 * Without this the fix would be half a fix: a node would appear, "Open full
 * view" would be offered, and the page behind it would read "Agent projection
 * unavailable" — a door drawn on a wall, which is the defect this whole repair
 * is about, moved one screen along.
 */
export function declaredAgentsData(org) {
  const agents = declaredAgents(org)
  if (!agents.length) return null
  const present = new Set(agents.map(agent => agent.id))
  return {
    revision: Number.isSafeInteger(org?.revision) ? org.revision : 1,
    declared: agents.map(agent => ({
      id: agent.id,
      displayName: typeof agent.displayName === 'string' && agent.displayName ? agent.displayName : agent.id,
      role: agent.role,
      provider: agent.provider,
      enabled: agent.enabled !== false,
    })),
    relationships: (Array.isArray(org?.relationships) ? org.relationships : [])
      .filter(relation => isRecord(relation) && present.has(relation.from) && present.has(relation.to))
      .map(relation => ({ from: relation.from, to: relation.to, type: relation.type })),
    /* The observed half is genuinely unavailable, and says so in the projection's
       own vocabulary. src/views/agent.js reads `observedSessions.ok` to decide
       between "unmapped" and "unavailable"; claiming ok here would have the page
       report that sessions were observed and simply not matched. */
    observedSessions: { ok: false, reason: 'No local agent fleet host detected on this machine.' },
  }
}
