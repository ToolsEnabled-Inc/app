/* WHICH RULE-SCOPES AN AGENT IN A TREE IS ACTUALLY UNDER, and the words the
 * surface uses to say so.
 *
 * THE CONTRACT THIS FILE EXISTS TO HOLD. Two things in this product decide
 * what a tree agent is told at boot, and until now only one of them was
 * written down:
 *
 *   the START carries `requestKeys` — treeAnchors and threadId — and the
 *   engine's onboarding injects those ledgers beside the global layer
 *   the RAIL shows a person the rules this circle carries
 *
 * If those two derive their scopes separately they drift, and the drift is
 * invisible in the worst direction: the panel shows a person rules their
 * agents are not getting, or hides rules they are. So the derivation lives
 * here, in a module with no DOM and no stylesheet, both callers use it, and
 * tools/test/tree-standing-requests.test.mjs runs it.
 *
 * WHY IT IS NOT IN src/views/computers.js. That file imports board.css, so
 * `node --test` cannot load it at all — a rule proven only by reading the
 * view is a rule nothing checks.
 */

/* THE ORDER IS THE PRECEDENCE, and it is stated rather than implied.
 *
 * Broadest first, narrowest last: what the whole computer is told, then the
 * tree from its top down to this circle, then this circle's own thread, then
 * its running session. A rule written closer to the agent is the more
 * specific instruction, which is the ordinary reading of instructions and the
 * order the engine's own onboarding lays them out in. */
export const SCOPE_ORDER = Object.freeze(['global', 'tree', 'thread', 'session'])

/**
 * The scopes one circle's agents are under, in precedence order.
 *
 * @param node     the tree node — its id is the thread anchor, its sessionId
 *                 the session anchor when one is really running.
 * @param anchors  the tree anchors for this node, from the SAME derivation a
 *                 start uses (treeAnchorsFor in src/views/computers.js).
 *
 * A SESSION SCOPE ONLY WHEN A SESSION EXISTS. Filing a session rule against a
 * circle with no session is already refused by the filing path with its own
 * sentence; offering to READ one would promise a ledger that cannot exist.
 */
export function standingRequestScopesFor(node = {}, { anchors = [] } = {}) {
  const scopes = [{ scope: 'global', key: null }]
  for (const anchor of anchors) {
    if (typeof anchor === 'string' && anchor !== '') scopes.push({ scope: 'tree', key: anchor })
  }
  if (typeof node.id === 'string' && node.id !== '') scopes.push({ scope: 'thread', key: node.id })
  if (typeof node.sessionId === 'string' && node.sessionId !== '') {
    scopes.push({ scope: 'session', key: node.sessionId })
  }
  return scopes
}

/* THE WORDS. Every sentence this surface says lives here for the same reason
   src/fleet-tree-copy.js exists: one flow rendered in more than one place
   becomes more than one voice inside a week. */
export const REQUEST_PANEL = Object.freeze({
  title: 'Instructions these agents follow',
  /* THE PRECEDENCE, IN ONE SENTENCE — the brief's statement 5. It says what
     the product DOES rather than what it intends, and it is the same order
     SCOPE_ORDER above performs. */
  precedence: 'Every agent here is told all of these when it starts, widest first. A rule written for this circle is read last, so it refines the ones above it.',
  scopeLabel: Object.freeze({
    global: 'Everywhere on this computer',
    tree: 'This tree',
    thread: 'This circle and everything under it',
    session: 'The session running now',
  }),
  /* WRITING one is the command a person already has. The panel does not
     duplicate the composer; it names the command and gets out of the way. */
  howToAdd: 'Add one by typing /RequestTree followed by the rule in the message box.',
  /* AND REMOVING ONE IS A HAND EDIT, said plainly because the ledger file's
     own header — the owner's design, written by the engine module — says
     "edit or delete any entry by hand ... no tool rewrites them". A Remove
     button here would contradict the file it edits. */
  howToRemove: 'These are plain text files you own. To change or remove a rule, edit the ledger file by hand — nothing in the product rewrites your words.',
  /* The box is drawn with its heading before the read answers, so the panel
     never flashes in as a new box under the person's eye. This is what the
     body says for that instant, and it is a statement about THIS COPY rather
     than about the rules — "none" has not been established yet. */
  reading: 'Reading the rules these agents are given.',
  empty: 'No rules written for these agents yet. They still get the standing requests for the whole computer.',
  unavailable: 'This copy could not read your standing requests, so this is not a list of none.',
  /* An id is shown because it is how a person finds the entry in the file
     they are being told to edit. It is the ONE identifier on this panel, and
     it is the owner's own numbering, not an internal key. */
  entryHint: id => `Filed as ${id}`,
})
