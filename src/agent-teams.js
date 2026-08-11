/* TEAMS — sending one intent to several agents, and what that costs.
 *
 * The owner asked for controls for "how their agents ... work together". The
 * dispatch API sends one brief to one tier and returns one launch receipt. A
 * team is therefore not a new engine concept: it is several dispatches that
 * share a parent, which the engine already understands and already bounds.
 *
 * THE TWO BOUNDS THIS FILE EXISTS TO TELL THE TRUTH ABOUT.
 *
 * 1. FOUR IDENTITIES, NOT SIX. The tier table maps six tiers onto four declared
 *    agent identities: luna, terra, sol, and `claude` -- which all three Claude
 *    tiers share (capability/src/lib/mission-bridge/actions.js:53-60). The
 *    presence registry refuses a second live lane for an identity that already
 *    has one: `AGENT_PRESENCE_ACTIVE` at
 *    capability/src/lib/agent-presence.js:568-576, surfaced as
 *    BRIDGE_AGENT_LANE_COLLISION / HTTP 409.
 *
 *    So "run Opus and Sonnet on this together" is not a thing this product can
 *    do, and a team builder that offered it would produce a 409 on the second
 *    member every time. The picker refuses the combination up front and says
 *    why, rather than dispatching one member and failing the next.
 *
 * 2. THE ENGINE'S FAN-OUT CAP IS REAL BUT DORMANT. MAX_FAN_OUT = 8 and
 *    MAX_DEPTH = 3 exist at
 *    capability/src/lib/controller-launch-record.js:50-51, and are enforced at
 *    :781-787 -- but ONLY when the launch names a `parentLaunchId`. No UI has
 *    ever sent one, so every dispatch made so far has been a depth-0 orphan and
 *    the cap has never once applied.
 *
 *    A team here dispatches a LEAD first and nests every other member under its
 *    launch id. That is what makes the engine's own cap engage, and it is also
 *    the honest shape of the thing the owner asked for: members that report to
 *    a lead rather than N unrelated processes that happen to share a brief.
 *
 * WHAT A TEAM DOES NOT DO, said here because the panel must not imply it:
 * `dispatch` returns as soon as the child is RUNNING (it resolves on the first
 * heartbeat with status `running` -- agent-lane-dispatch.js:229-238). The result
 * is never returned to the dispatcher; `actions.js:678` deliberately detaches
 * the completion. So a team collects START receipts, not answers. Anything
 * claiming to "collect the results" would be inventing a channel that does not
 * exist.
 *
 * tools/test/agent-teams.test.mjs parses the engine's own source for both
 * bounds and fails if this file drifts from it.
 */

import { LAUNCH_TIERS } from './orchestration-controls.js'

/* The declared agent identity each tier resolves to.
   Mirrors the frozen TIERS table's `targetAgentId` field at
   capability/src/lib/mission-bridge/actions.js:53. This is NOT cosmetic: it is
   the key the presence registry collides on. */
export const TIER_AGENT_IDENTITY = Object.freeze({
  luna: 'luna',
  terra: 'terra',
  sol: 'sol',
  'claude-fable': 'claude',
  'claude-sonnet': 'claude',
  'claude-opus': 'claude',
})

/** Every distinct identity a team could occupy, in tier order. */
export const TEAM_IDENTITIES = Object.freeze([
  ...new Set(LAUNCH_TIERS.map(tier => TIER_AGENT_IDENTITY[tier.id])),
])

/* Mirrors capability/src/lib/controller-launch-record.js:50-51.
   `maxConcurrent` is NOT from that file: it is the identity count above, which
   is the smaller and therefore governing limit on this machine. Both are stated
   because they fail differently -- exceeding the engine cap is
   LAUNCH_FANOUT_EXCEEDED, exceeding the identity count is a 409 collision. */
export const TEAM_BOUNDS = Object.freeze({
  maxFanOut: 8,
  maxDepth: 3,
  maxConcurrent: TEAM_IDENTITIES.length,
})

/**
 * Can these tiers run at the same time?
 *
 * Returns the conflicts rather than a boolean, because the panel has to be able
 * to say WHICH pair cannot coexist and why. A bare `false` would leave the
 * person to guess, which is the failure mode the unsupported-controls list
 * exists to prevent.
 */
export function identityConflicts(tierIds) {
  const seen = new Map()
  const conflicts = []
  for (const tierId of tierIds) {
    const identity = TIER_AGENT_IDENTITY[tierId]
    if (!identity) continue
    if (seen.has(identity)) {
      conflicts.push(Object.freeze({
        identity,
        tiers: Object.freeze([seen.get(identity), tierId]),
        reason: `${seen.get(identity)} and ${tierId} are both the declared agent "${identity}", which can only have one live lane at a time.`,
      }))
      continue
    }
    seen.set(identity, tierId)
  }
  return Object.freeze(conflicts)
}

/**
 * Validate a proposed team and say exactly why it is or is not dispatchable.
 *
 * `lead` is dispatched first and every member is nested under its launch, so
 * the lead occupies one of the identities. That is why a 4-identity machine
 * yields a lead plus at most 3 members, not a lead plus 4.
 */
export function planTeam({ lead = null, members = [] } = {}) {
  const problems = []
  const roster = [lead, ...members].filter(tier => typeof tier === 'string' && tier.length > 0)

  if (!lead) problems.push('A team needs a lead. The lead is dispatched first and every other member is nested under its launch.')
  if (members.length === 0) problems.push('A team needs at least one member besides the lead. One agent on its own is an ordinary dispatch.')

  for (const tier of roster) {
    if (!TIER_AGENT_IDENTITY[tier]) problems.push(`"${tier}" is not one of the six dispatchable tiers.`)
  }

  const conflicts = identityConflicts(roster)
  for (const conflict of conflicts) problems.push(conflict.reason)

  /* The engine cap counts SIBLINGS of the parent, so it applies to members
     only -- the lead is the parent, not one of its own children. Matching the
     engine's arithmetic here rather than approximating it is the difference
     between refusing early and being refused by LAUNCH_FANOUT_EXCEEDED after
     some members have already started. */
  if (members.length > TEAM_BOUNDS.maxFanOut) {
    problems.push(`The engine admits at most ${TEAM_BOUNDS.maxFanOut} lanes under one parent (LAUNCH_FANOUT_EXCEEDED); this team names ${members.length}.`)
  }

  return Object.freeze({
    lead,
    members: Object.freeze([...members]),
    size: roster.length,
    identities: Object.freeze(roster.map(tier => TIER_AGENT_IDENTITY[tier]).filter(Boolean)),
    conflicts,
    dispatchable: problems.length === 0,
    problems: Object.freeze(problems),
  })
}

/** The receipt shape a dispatch must return before a member may be called started. */
export function verifiedDispatchReceipt(result, expectedTier) {
  const receipt = result?.receipt
  return result?.ok === true
    && receipt && typeof receipt === 'object' && !Array.isArray(receipt)
    && receipt.action === 'dispatch'
    && receipt.tier === expectedTier
    && typeof receipt.launchId === 'string' && receipt.launchId.length > 0
    && typeof receipt.agentId === 'string' && receipt.agentId.length > 0
    && Number.isSafeInteger(receipt.auditSequence) && receipt.auditSequence > 0
    && /^[a-f0-9]{64}$/.test(String(receipt.auditEventHash || ''))
}

function memberState(tier, phase, detail, receipt = null) {
  return Object.freeze({ tier, identity: TIER_AGENT_IDENTITY[tier] || null, phase, detail, receipt })
}

/**
 * DOM-independent team dispatcher, modelled on createTerminateController in
 * src/mission-bridge.js: the controller owns the sequence and the honesty
 * rules, the view only renders what it publishes.
 *
 * SEQUENCE, and why it is not Promise.all:
 *   1. the lead is dispatched and must return a verified receipt;
 *   2. every member is then dispatched IN SERIES with parentLaunchId set to the
 *      lead's launch id.
 *
 * Series, not parallel, because each member takes a distinct declared identity
 * and a parallel burst races the presence registry's own admission -- two lanes
 * for one identity would be refused by the engine, but the ORDER in which they
 * are refused would be nondeterministic, and a person cannot act on a team that
 * reports a different member failing each time.
 *
 * A member that is refused does NOT abort the team: the remaining members are
 * still attempted and every outcome is reported per member. Aborting would
 * leave already-started lanes running with nothing on screen naming them.
 */
export function createTeamController({
  plan,
  dispatchBody,
  postAction,
  onState = () => {},
} = {}) {
  let destroyed = false
  let state = Object.freeze({
    phase: plan?.dispatchable ? 'idle' : 'unavailable',
    enabled: Boolean(plan?.dispatchable),
    lead: plan?.lead ? memberState(plan.lead, 'idle', 'Not dispatched.') : null,
    members: Object.freeze((plan?.members || []).map(tier => memberState(tier, 'idle', 'Not dispatched.'))),
    message: plan?.dispatchable
      ? `Dispatch ${plan.lead} as lead with ${plan.members.length} member${plan.members.length === 1 ? '' : 's'} nested under it.`
      : (plan?.problems || ['No team is selected.']).join(' '),
  })

  const publish = next => {
    state = next
    if (!destroyed) onState(state)
  }
  publish(state)

  const patch = fields => publish(Object.freeze({ ...state, ...fields }))

  const withMember = (tier, next) => Object.freeze(
    state.members.map(member => (member.tier === tier ? next : member)),
  )

  async function send(tier, parentLaunchId) {
    let result
    try {
      result = await postAction('dispatch', {
        ...dispatchBody,
        tier,
        ...(parentLaunchId ? { parentLaunchId } : {}),
      })
    } catch (error) {
      result = { ok: false, code: 'BRIDGE_REQUEST_FAILED', reason: error?.message || 'dispatch request failed' }
    }
    if (verifiedDispatchReceipt(result, tier)) {
      return { ok: true, receipt: result.receipt }
    }
    /* A shaped success with an unverifiable receipt is reported as its own
       failure, not folded into "refused": the lane may well be running, and
       telling the person it was refused would invite a retry that starts a
       second one. dispatch carries no idempotency key. */
    const shapedSuccess = result?.ok === true
    return {
      ok: false,
      code: shapedSuccess ? 'BRIDGE_DISPATCH_RECEIPT_INVALID' : (result?.code || 'BRIDGE_REQUEST_FAILED'),
      reason: shapedSuccess
        ? 'The dispatch response was incomplete or named a different tier. This lane may be running; check the fleet before retrying.'
        : (result?.reason || 'The dispatch was refused with no receipt.'),
    }
  }

  return Object.freeze({
    getState() { return state },
    destroy() { destroyed = true },
    async run() {
      if (destroyed || !state.enabled || state.phase !== 'idle') return state
      patch({
        phase: 'dispatching',
        enabled: false,
        lead: memberState(plan.lead, 'pending', 'Dispatching lead.'),
        message: 'Dispatching the lead. No member has been started yet.',
      })

      const leadResult = await send(plan.lead, dispatchBody?.parentLaunchId || null)
      if (destroyed) return state
      if (!leadResult.ok) {
        patch({
          phase: 'failed',
          enabled: true,
          lead: memberState(plan.lead, 'refused', `${leadResult.code}: ${leadResult.reason}`),
          message: 'The lead was not started, so no member was dispatched. Nothing is running from this team.',
        })
        return state
      }

      const parentLaunchId = leadResult.receipt.launchId
      patch({
        lead: memberState(plan.lead, 'started', `Lead running as launch ${parentLaunchId}.`, leadResult.receipt),
        message: `Lead started. Nesting ${plan.members.length} member${plan.members.length === 1 ? '' : 's'} under launch ${parentLaunchId}.`,
      })

      for (const tier of plan.members) {
        if (destroyed) return state
        patch({ members: withMember(tier, memberState(tier, 'pending', 'Dispatching.')) })
        const result = await send(tier, parentLaunchId)
        if (destroyed) return state
        patch({
          members: withMember(tier, result.ok
            ? memberState(tier, 'started', `Running as launch ${result.receipt.launchId}, nested under ${parentLaunchId}.`, result.receipt)
            : memberState(tier, 'refused', `${result.code}: ${result.reason}`)),
        })
      }

      const started = state.members.filter(member => member.phase === 'started').length
      const refused = state.members.filter(member => member.phase === 'refused').length
      patch({
        phase: refused === 0 ? 'started' : 'partial',
        enabled: true,
        message: [
          `Lead ${plan.lead} and ${started} of ${plan.members.length} member${plan.members.length === 1 ? '' : 's'} started under launch ${parentLaunchId}.`,
          refused > 0 ? ` ${refused} refused; each is named above with its reason.` : '',
          ' Started means the process is running, not that it has answered: a dispatch returns no result.',
        ].join(''),
      })
      return state
    },
  })
}
