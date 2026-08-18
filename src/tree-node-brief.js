/* WHAT AN AGENT STARTED FROM THE TREE IS TOLD ABOUT ITS PLACE IN IT.
 *
 * THE DEFECT THIS EXISTS FOR, in the owner's words: "This one is not realizing
 * and not able to contact its manager." He had a node called Default hanging
 * under one called Manager, and the agent inside it answered: "I don't
 * currently have a manager agent or report content specified -- send me the
 * manager's identifier." It was right. The tree held the relationship and the
 * session was never told.
 *
 * WHY THE MESSAGE TEXT AND NOT AN ENGINE OPTION. The neutral engine contract
 * has a field for exactly this -- `developerInstructions` -- and it is not
 * usable here. Measured on this tree: the Codex adapter refuses it on a turn
 * (capability/src/lib/agent-engine/codex-adapter.js, "turn/start does not
 * accept the engine-neutral developerInstructions option") and the Claude
 * adapter's startThread validates it and then throws it away -- that function
 * only mints an id. So the same code would carry the brief on one provider and
 * silently drop it on the other, which is the shape that produces a feature
 * that works for whoever tested it. The message text reaches both engines, and
 * it has the property no side channel has: the person can see it.
 *
 * WHAT IT MAY NOT SAY. There is no direct message channel between two agents on
 * one computer, and this file is not allowed to imply one. The product ships a
 * cross-machine messenger, and it refuses a recipient on the local machine BY
 * DESIGN -- see capability/src/lib/providers/agent-comms.js, which answers
 * `accepted:false` with a code meaning "pick a recipient on another machine",
 * and whose own description says to use the coordination board for local
 * traffic instead. Telling a child to message its manager would be telling it
 * to call a number that does not ring. So the honest instruction is the one
 * that is true on every tier and every engine: what you say IS your report,
 * and it lands on the tree where your manager and the person read it.
 *
 * AND THERE IS NO SECOND CHANNEL TO OFFER INSTEAD. The one local board two
 * agents could share is a namespace of the builder's own coordination system,
 * and tools/test/chat-agent-bridge-gated.test.mjs forbids its name anywhere
 * under src/ or shell/ -- it is classed with the owner's private account
 * aliases, because it is an internal arrangement and not a product a customer
 * was sold. A draft of this file offered it and that gate caught it, which is
 * the gate working: the honest answer to "how do I reach my manager" on one
 * computer is the one sentence below, and a second sentence would have been
 * this file inventing a capability rather than reporting one.
 */

const line = value => (typeof value === 'string' ? value.trim() : '')

/**
 * The block appended to a tree start, as text.
 *
 * @param selfName    what the circle is called on the canvas — the same string
 *                    the person reads, never an internal id.
 * @param parentName  the manager's circle, or null for a node at the top.
 */
export function nodeManagerContext({ selfName, parentName = null } = {}) {
  const me = line(selfName) || 'this agent'
  const manager = line(parentName)
  const said = []
  said.push(`You are ${me} on this computer's agent tree.`)
  if (manager) {
    said.push(`Your manager is ${manager}.`)
    said.push('There is no direct message channel to another agent on this computer.')
    said.push(`What you say back is your report. It appears on the tree under your circle, where ${manager} and the person running this tree read it.`)
    said.push(`Begin your report with "${manager}:" so it is clear who it is for.`)
  } else {
    said.push('You are at the top of your tree, so no agent manages you.')
    said.push('You report to the person running this tree.')
    said.push('What you say back appears on the tree under your circle, where they read it.')
  }
  return said.join(' ')
}

/**
 * The words actually sent to a session started from a tree node.
 *
 * THE PERSON'S OWN WORDS COME FIRST AND ARE NOT TOUCHED. Everything this file
 * adds is a separate paragraph after them, so an agent reading the brief reads
 * the job before it reads the plumbing, and so the two can be told apart on
 * screen — src/views/computers.js files the context as its own entry in the
 * conversation rather than folding it into what the person typed.
 *
 * A missing message is not an error here: the panel already refuses an empty
 * brief. If one arrives anyway, the context still goes, because an agent that
 * knows who it reports to and nothing else is better off than one that knows
 * neither.
 */
export function composeNodeBrief({ message = '', selfName, parentName = null } = {}) {
  const words = typeof message === 'string' ? message : ''
  const context = nodeManagerContext({ selfName, parentName })
  return words.trim().length === 0 ? context : `${words}\n\n${context}`
}
