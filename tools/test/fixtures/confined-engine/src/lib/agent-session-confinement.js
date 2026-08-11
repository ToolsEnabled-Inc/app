'use strict'

// Stands in for the real planner. `confinedSessionPlan` answers whatever the
// test staged in MC_TEST_CONFINEMENT_PLAN, so the host's own resolution path --
// engine root -> hostModule -> confinedSessionPlan -- is the thing exercised.
function confinedSessionPlan() {
  return JSON.parse(process.env.MC_TEST_CONFINEMENT_PLAN || '{"ok":false,"code":"AGENT_CONFINEMENT_UNAVAILABLE"}')
}

/* The READ-ONLY half the availability probe asks about, staged the same way.
 *
 * DEFAULTS TO NOT-ISOLATED ON PURPOSE. `unrestricted` needs no Codex sign-in,
 * so an unstaged fixture answers the question that changes nothing -- every
 * suite written before this export existed keeps measuring what it measured.
 * A default of "isolated" would silently add a sign-in precondition to those
 * tests and make them pass or fail on whether the machine running them happens
 * to have an auth.json, which is ambient state, not behaviour. */
function resolveAgentConfinement() {
  return JSON.parse(process.env.MC_TEST_CONFINEMENT_RESOLVED || '{"tier":"unrestricted","isolated":false}')
}

module.exports = { confinedSessionPlan, resolveAgentConfinement }
