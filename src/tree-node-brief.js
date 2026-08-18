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
 * WHAT IT USED TO SAY, AND WHY THAT SENTENCE IS GONE.
 *
 *     'There is no direct message channel to another agent on this computer.'
 *
 * That was TRUE when it was written and it is the second half of the owner's
 * later finding: "i couldnt verify if the comms page is wired because i couldnt
 * get the agents to communicate". The product shipped a messenger that refuses
 * a local recipient BY DESIGN, on an installation whose service registry
 * declares exactly one machine -- so the only recipient the tool could name was
 * the one it refused. A child told to message its manager was calling a number
 * that did not ring, and this file was right to say so.
 *
 * THE CHANNEL NOW EXISTS, so this file says what it is. Not the cross-machine
 * messenger, which is unchanged and still refuses a local recipient: a local
 * sibling, agent_comms.send_local, which addresses both ends by the name on the
 * circle and delivers through the engine's own durable message fabric. It
 * carries a message from a running child to its running manager, and the
 * manager's answer back, and both appear in both transcripts.
 *
 * THE ADDRESS LINE IS A CONTRACT, NOT DECORATION. `Tree address: you are "X",
 * and your manager is "Y".` is read back out by shell/agent-host.cjs to learn
 * which running session is which circle -- the join that did not exist before,
 * and the reason the tree's manager/child relationship was invisible to
 * anything that could deliver. tools/test/tree-address-contract.test.mjs runs
 * this function and that expression together, so the two cannot drift apart by
 * one of them being edited alone. It is also the sentence the agent itself
 * reads to know what to put in `from`, which is why it is a sentence a person
 * can read rather than an id: the same string does both jobs.
 *
 * WHAT IS STILL NOT OFFERED, so nobody re-adds it. The builder's own
 * coordination namespace is not a product a customer was sold, and
 * tools/test/chat-agent-bridge-gated.test.mjs forbids its name anywhere under
 * src/ or shell/. A draft of this file offered it and that gate caught it. The
 * channel described below is the product's own; nothing here names that one.
 */

const line = value => (typeof value === 'string' ? value.trim() : '')

/* The name of the tool the sentences below tell an agent to call. Written once
   so the copy and any surface that explains it cannot disagree; it is the name
   the engine registers in src/lib/tool-registry.js. */
export const LOCAL_MESSAGE_TOOL = 'agent_comms.send_local'

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
  /* THE ADDRESS IS ITS OWN LINE, and that is not typography.
   *
   * MEASURED: the first version pushed it into the same run of sentences as
   * everything else, and `said.join(' ')` put it mid-line -- so the expression
   * shell/agent-host.cjs uses to read it back, which anchors at the start of a
   * line, found nothing at all. Every tree session would have registered no
   * address and the whole channel would have been silently unreachable, while
   * every sentence about it read correctly to a person. Caught by
   * tools/test/tree-address-contract.test.mjs running both halves rather than
   * comparing them by eye, which is exactly why that test exists. */
  /* A NAME CANNOT CARRY THE QUOTE THAT ENDS ITS OWN FIELD. The address is a
     sentence in text the model also reads, and a circle called
     `Default", and your manager is "Somebody Else` would otherwise parse into a
     second, forged clause -- the reader would recover a manager the person never
     drew. Stripping the delimiter from the ADDRESS only (the prose below still
     shows the person's name as they typed it) means a crafted name recovers as
     one long name that matches no circle, and the directory refuses it by name.
     Caught by tools/test/tree-address-contract.test.mjs. */
  const field = value => value.split('"').join('').split('\n').join(' ').split('\r').join(' ')
  const address = manager
    ? `Tree address: you are "${field(me)}", and your manager is "${field(manager)}".`
    : `Tree address: you are "${field(me)}", at the top of your tree.`
  said.push(`You are ${me} on this computer's agent tree.`)
  if (manager) {
    said.push(`You can message ${manager} directly: call ${LOCAL_MESSAGE_TOOL} with from "${me}", to "${manager}", and what you want to say. It arrives in ${manager}'s own session and ${manager} can answer you the same way.`)
    /* THE LIMIT IS STATED BECAUSE IT IS REAL. The channel is the line the person
       drew and nothing wider: a permission level that allows no local writes
       (Guided) does not offer the tool at all, and there is no route to an agent
       the tree does not connect you to. Saying so here costs one sentence and
       saves an agent from reporting a refusal as a product fault. */
    said.push(`That reaches ${manager} and any agents that report to you, and nobody else. If the tool is not offered to you, this computer's permission level does not allow it — say so rather than trying another route.`)
    said.push(`What you say back is also your report: it appears on the tree under your circle, where ${manager} and the person running this tree read it.`)
  } else {
    said.push('No agent manages you. You report to the person running this tree.')
    said.push(`If agents are started under you, you can message them and they can message you: call ${LOCAL_MESSAGE_TOOL} with from "${me}", to their circle's name, and what you want to say.`)
    said.push('What you say back appears on the tree under your circle, where they read it.')
  }
  return `${address}
${said.join(' ')}`
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

/**
 * READ AN ADDRESS BACK OUT OF A BRIEF — the other half of the contract above.
 *
 * This is exported so a test can prove the two halves agree by RUNNING them,
 * rather than by a reader comparing a regular expression in shell/agent-host.cjs
 * against a template literal here and believing they match. The host keeps its
 * own copy of the expression because it is a CommonJS file in the shell and
 * cannot import this module; the test is what stops the two from drifting.
 *
 * Returns null for text that carries no address, which is every brief from
 * every surface that is not the tree.
 */
export function readTreeAddress(text) {
  const match = /^Tree address: you are "([^"\n]{1,120})"(?:, and your manager is "([^"\n]{1,120})")?/m
    .exec(typeof text === 'string' ? text : '')
  if (!match) return null
  return { selfName: match[1], parentName: match[2] || null }
}
