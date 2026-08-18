/* WHICH AGENT A SESSION WAS, from the page's own saved conversations.
 *
 * The signed record on this computer is deliberately about the MACHINE: it
 * carries a session id, a model row and a sign-in name, and nothing about the
 * role a person typed into a tree node. That is the right split -- a role is a
 * thing the page invented and the page keeps -- but it means any screen that
 * wants to say "the planner used 12,000 tokens" has to JOIN the two, on the
 * session id both sides already hold.
 *
 * This is that join's left-hand side, and it is its own module for one reason:
 * src/local-metrics.js is a pure function of records and a clock, on purpose,
 * and reaching into localStorage from inside it would break the property that
 * makes it testable without a browser. So the reading lives here, the view calls
 * it, and the decisions stay in the module that has no storage.
 *
 * IT NEVER THROWS AND IT NEVER PARTIALLY ANSWERS. A storage that is missing,
 * locked or full of somebody else's keys yields null -- "this page cannot say
 * which agent" -- which every caller already renders as an absence rather than
 * as a name.
 */

import { fleetTreesStorageKey, parseFleetTrees } from './fleet-trees.js'

/**
 * A Map of sessionId to `{ role, asked }`, or null when there is nothing to
 * read. The shape matches the `conversations` join src/local-metrics.js already
 * documents for runRows(), so one reader serves both the run table and the
 * token panels.
 */
export function readSessionRoles(storage = (typeof window === 'undefined' ? null : window.localStorage)) {
  if (!storage || typeof storage.key !== 'function' || typeof storage.getItem !== 'function') return null
  const found = new Map()
  const prefix = fleetTreesStorageKey('')
  let count = 0
  try { count = Number(storage.length) || 0 } catch { return null }
  for (let index = 0; index < count; index += 1) {
    let key = null
    try { key = storage.key(index) } catch { continue }
    if (typeof key !== 'string' || !key.startsWith(prefix)) continue
    let raw = null
    try { raw = storage.getItem(key) } catch { continue }
    const record = parseFleetTrees(raw)
    for (const node of record.nodes) {
      if (!node.sessionId) continue
      found.set(node.sessionId, { role: node.role, asked: node.message })
    }
  }
  return found
}
