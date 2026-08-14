/* EVERY WORD OF THE START-AN-AGENT-FROM-THE-TREE FLOW, IN ONE PLACE.
 *
 * THE FLOW THESE WORDS BELONG TO. A fresh computer draws an EMPTY tree. The
 * graph draws empty nodes a person can press. Pressing one opens a panel on the
 * right where they choose a role and say what they want done. Submitting starts
 * a real agent. A computer may hold more than one tree.
 *
 * WHY THE WORDS ARE A MODULE AND NOT SIX FILES' WORTH OF TEMPLATE LITERALS.
 * Six surfaces render one flow: the computers view, the graph, the layout, the
 * tree list, the panel and the declared-fleet adapter. Copy written inline in
 * six places becomes six voices inside a week, and the empty state -- the one
 * screen every new customer sees -- is where a second voice costs the most.
 * src/first-run-needs.js and src/agent-availability-copy.js already work this
 * way for their own screens, and this is the same rule for this flow.
 *
 * THE OWNER'S STANDING COMPLAINT IS THE SPEC: "the wording is dense and not
 * easy to consume or friendly for users." A person decides inside ten minutes
 * whether to trust a program that can reach their files, their mail and their
 * machine, and they decide it from the words. So: short sentences, plain words,
 * one idea per line, and no failure sentence that ends without something to do.
 * tools/check-plain-language.mjs holds every string here to that.
 *
 * FIVE RULES THIS MODULE KEEPS, AND TWO OF THEM ARE KEPT MECHANICALLY.
 *
 *   1. A KEY IS NEVER PUT IN FRONT OF A PERSON. Role keys (`coordinator`,
 *      `shadow`) are join keys in src/vocab.js and mean nothing outside this
 *      repository. roleLabel() is the ONLY way to name a role in this flow, it
 *      reads src/vocab.js ROLES for the label, and a key it does not recognise
 *      comes back as the plain word "Agent" -- never as the key itself. A
 *      caller that interpolates a role key directly is the defect this function
 *      exists to make unnecessary.
 *   2. A REFUSAL NEVER ARRIVES AS A CODE. startRefusalSentence() takes the
 *      whole refusal and returns a sentence. It has no parameter that would let
 *      a caller ask for the identifier, for the same reason
 *      src/refusal-copy.js's refusalSentence() has none.
 *   3. EVERY FAILURE SENTENCE ENDS WITH SOMETHING TO DO. "Every seat is busy"
 *      is a capacity answer and is worded as one -- wait, or stop one -- and
 *      never as "your setup is wrong", because sending somebody to repair a
 *      queue that would have cleared on its own costs them an afternoon.
 *   4. NOTHING HERE CLAIMS THE PRODUCT DOES AN OPERATING-SYSTEM JOB FOR
 *      SOMEBODY. It cannot install Codex and it does not offer to. It says
 *      which window to open and which line to type, and the commands are
 *      imported from src/agent-availability-copy.js rather than retyped,
 *      because the copy that goes stale is always the one nobody is looking at.
 *   5. ONE VOICE. Where this product already has a sentence for a refusal, this
 *      module defers to it instead of writing a second one. The four refusals
 *      below are written here because this panel is a different place to be
 *      standing: the tree is on screen, so "stop one from the tree" is the true
 *      instruction where the shared table has to say "the fleet page".
 *
 * IT TOUCHES NO DOM AND BUILDS NO MARKUP, so a plain `node --test` process can
 * import it and assert on the sentence a state produces. That is the property
 * src/refusal-copy.js and src/agent-availability-copy.js keep for the same
 * reason: a copy test written against source text passes when the table is
 * right and the lookup is wrong.
 */

import { CODEX_SETUP_COMMANDS, UNAVAILABLE_TEXT, unavailableReason } from './agent-availability-copy.js'
import { GENERIC_REMEDY, isBareIdentifier, refusalCodeOf, refusalRemedy, refusalSentence } from './refusal-copy.js'
import { LAUNCH_TIERS } from './orchestration-controls.js'
import { ROLES } from './vocab.js'

/* ---------------------------------------------------------------
   Roles, by label and never by key.
   --------------------------------------------------------------- */

/* WHAT A PERSON IS CALLED WHEN THIS COPY DOES NOT RECOGNISE THEIR ROLE.
   A tree drawn from a saved organisation can carry a role this build has no
   entry for -- an organisation file written by a newer copy, or one hand-edited
   on this computer. The old shape of that bug is to fall back to `String(role)`
   and print the key. "Agent" is true of every one of them and is a word a
   person already has. */
export const UNKNOWN_ROLE_LABEL = 'Agent'

/** The label for a role, for anywhere a person will read it. Never the key. */
export function roleLabel(role) {
  const key = typeof role === 'string' ? role.trim() : ''
  const entry = key && Object.prototype.hasOwnProperty.call(ROLES, key) ? ROLES[key] : null
  const label = entry && typeof entry.label === 'string' ? entry.label.trim() : ''
  return label || UNKNOWN_ROLE_LABEL
}

/** Is this a role this copy has words for? Used to drop a clause rather than
    print a vague one -- "It will take the Agent role" says nothing. */
export function isKnownRole(role) {
  const key = typeof role === 'string' ? role.trim() : ''
  return Boolean(key) && Object.prototype.hasOwnProperty.call(ROLES, key)
}

/* THE ROLES A PERSON MAY PICK, AND THE ONE THEY MAY NOT.
 *
 * `spawned` is deliberately absent. Its label is "Agent spawned", and that is
 * what an agent BECOMES when another agent starts it -- it is a fact about how
 * something came to exist, not a job anybody hands out. Offering it in a picker
 * would invite a person to choose a state instead of a role. roleLabel() still
 * answers for it, because the graph has to draw those agents.
 *
 * EACH LINE DESCRIBES WHERE THE ROLE SITS IN YOUR TREE, not a guarantee about
 * what the agent will do. What a role is actually ALLOWED to do is set by the
 * organisation declared on this computer (src/org-controls.js shows those rules
 * beside each role), and a picker that promised behaviour this module cannot
 * enforce would be writing a cheque the product does not sign.
 *
 * The label is read from src/vocab.js at load, so a profile that renames a role
 * renames it here too and this file cannot drift from the graph's legend. */
export const ROLE_CHOICES = Object.freeze([
  Object.freeze({ role: 'coordinator', label: roleLabel('coordinator'), summary: 'Sits at the top of the tree and decides what happens next.' }),
  Object.freeze({ role: 'helper', label: roleLabel('helper'), summary: 'Works beside the coordinator and takes work off it.' }),
  Object.freeze({ role: 'shadow', label: roleLabel('shadow'), summary: 'Keeps watch on the work and speaks up when something looks off.' }),
  Object.freeze({ role: 'manager', label: roleLabel('manager'), summary: 'Looks after one branch of the tree and the agents under it.' }),
  Object.freeze({ role: 'default', label: roleLabel('default'), summary: 'Just does the job you describe. Pick this one if you are not sure.' }),
])

/* Offered when the tree is empty, because the first agent on an empty tree is
   the one everything else hangs under. It is a suggestion about SHAPE, which is
   a thing this product really does draw, and not advice about what will run. */
export const FIRST_ROLE_SUGGESTION = Object.freeze({
  role: 'coordinator',
  line: 'A coordinator sits at the top of a tree, so it is an easy first choice.',
})

/* ---------------------------------------------------------------
   The empty tree, and the empty node inside it.
   --------------------------------------------------------------- */

/* THE EMPTY STATE IS THE SHIPPING STATE. Every fresh computer opens here, so
   these three lines are the first thing most people ever read on this page.
   They say what the screen is FOR before they say that it is empty, and they
   say that empty is normal -- a new customer's first question is whether they
   have broken something. */
export const EMPTY_TREE = Object.freeze({
  title: 'Nothing has run on this computer yet',
  body: 'This is where your agents appear once you start one. An empty tree is normal on a new computer.',
  hint: 'Press any empty spot in the tree to start your first agent.',
})

/* THE WORDS ON THE NODE ITSELF, which have room for about three of them. The
   node is a control, so it says what pressing it does. */
export const EMPTY_NODE = Object.freeze({
  label: 'Empty spot',
  hint: 'Press to start an agent here',
  /* For screen readers, where the label and the hint arrive as one name. */
  ariaLabel: 'Empty spot. Press to start an agent here.',
})

/* ---------------------------------------------------------------
   The panel on the right.
   --------------------------------------------------------------- */

/* TWO FIELDS AND A BUTTON, AND THE INTRO SAYS SO. A person looking at a new
   panel is deciding whether this is a form they can finish; telling them how
   short it is answers that before they start reading the labels.
   The field labels are questions rather than nouns. "Role" and "Message" are
   what the fields are called in the code; "What kind of agent is this?" is what
   a person is actually being asked. */
export const START_PANEL = Object.freeze({
  title: 'Start an agent here',
  intro: 'Two answers and it runs: what this agent is, and what you want done.',
  /* WHERE THE NEW AGENT IS GOING, and there are two of these because a node's
     name is not always known. The named form is a FUNCTION rather than a
     fragment a caller glues a name onto: a fragment invites `${name}` at the
     end of somebody else's sentence, and the first person with an awkward name
     gets a line that does not parse. Passing the name in means the sentence is
     always whole and the name always has words around it.
     A name here is data this repository did not write, so whoever renders it
     puts it on the page as TEXT and never as markup. */
  underNamed: (name) => `This agent will work under ${name}.`,
  underUnnamed: 'This agent joins your tree under the spot you pressed.',
  roleLabel: 'What kind of agent is this?',
  roleHelp: 'Pick where it sits in your tree. You can change this later.',
  /* THE FIRST ROW OF THE ROLE MENU. A menu must have something selected, and
     pre-selecting a real role would answer the panel's own question for the
     person and let a role nobody chose through on a single press. So the first
     row is this prompt, it carries no role, and it is never a valid answer --
     pressing Start on it gets needRole below. A blank first row would do the
     same job for a screen reader, which reads the label, and would read as a
     rendering fault to everybody else. */
  rolePrompt: 'Choose a role',
  /* THE MODEL QUESTION, and it is worded as one. "Tier" is what the wire calls
     it; a person is being asked what their agent runs on. Unlike the role menu
     this one arrives answered: the product has a default engine, so the menu
     preselects it (DEFAULT_TIER below) instead of asking a question the
     product already has an answer to. The Claude rows are offered on purpose
     and refuse by name when picked -- hiding them would make a chosen model
     quietly become Codex, the exact defect the tier channel closed. */
  tierLabel: 'What does it run on?',
  tierHelp: 'Luna is a good default. The Claude choices are listed so you can see them, and picking one tells you it cannot start yet.',
  messageLabel: 'What do you want it to do?',
  messageHelp: 'Write it the way you would ask a person. One clear job is enough to start.',
  messagePlaceholder: 'Read the notes in my documents folder and list what is unfinished.',
  submit: 'Start this agent',
  cancel: 'Not now',
  /* The two ways to press Start too early. Each says what is missing and what
     to do, in that order, and neither of them scolds. */
  needRole: 'Pick a role first, then press Start.',
  needMessage: 'Say what you want done first, then press Start.',
})

/* THE TIER MENU'S ROWS, derived from the one table the dispatch API actually
   honours (src/orchestration-controls.js LAUNCH_TIERS, which the
   orchestration-controls suite pins against the engine). The label names the
   model and what it runs on; the id rides on the option value where only the
   program reads it, the same split the role menu keeps. */
const TIER_PROVIDER_WORDS = Object.freeze({ codex: 'Codex', claude: 'Claude' })
export const TIER_CHOICES = Object.freeze(LAUNCH_TIERS.map(tier => Object.freeze({
  id: tier.id,
  label: `${tier.label} · ${TIER_PROVIDER_WORDS[tier.provider] || tier.provider}`,
})))

/* Preselected, not prompted: the engine has a default, so the menu states it.
   An empty first row here would be a question the product already answers. */
export const DEFAULT_TIER = 'luna'

/* ---------------------------------------------------------------
   Starting, and running.
   --------------------------------------------------------------- */

/* THE ANSWER, ON THE SAME PAGE THE QUESTION WAS ASKED. Measured 2026-08-13 on
   the installed 1.0.7: a tree-started agent ran, the engine answered, and no
   surface on the tree page rendered a word of it -- the person read "starting"
   forever and concluded agents do not respond. The agent page repaired this
   exact defect once already (see the CORRECTED note beside its onEvent
   listener); this is the same repair for the tree rail, with its own register.
   The empty-turn sentence follows rule 3: it ends with something to do. */
export const SAID_PANEL = Object.freeze({
  title: 'What it said',
  waiting: 'No answer yet. Words appear here as the agent writes them.',
  emptyTurn: 'The turn finished without any words back. Ask again, or ask for something smaller.',
})

/* MOVING AN AGENT, in words. The owner's ask, verbatim: "there needs to be a
   way to quickly connect nodes and change hierarchies too". The picker offers
   only what the store's movePoints() would accept, so every sentence here is
   about a legal move or the reason there is none — the menu and the refusal
   can never disagree. */
export const MOVE_PANEL = Object.freeze({
  title: 'Reports to',
  help: 'Pick which agent this one works under — in this tree or another. Everything under it moves with it.',
  prompt: 'Choose a new parent',
  save: 'Save',
  needChoice: 'Pick a parent first, then press Save.',
  empty: 'Every agent this one could work under is already full or sits below it, so there is nowhere else to move it.',
  staleChoice: 'The tree changed while this menu was open. Close and reopen this agent, then pick again.',
  notSaved: 'The move was not saved. Pick another parent and try again.',
  saved: (name, parent) => `Saved. ${name} now reports to ${parent}.`,
  mixed: 'Your own tree agents and the declared fleet stay separate. Drag a tree agent onto a tree agent, or a fleet agent onto a fleet agent.',
})

/* THE ACTIONS PALETTE. Every row is an action this build really performs on
   this node, today. What the product cannot do is one honest sentence in the
   footer, never a disabled control pretending — the temperature-slider rule.
   Refusal/confirmation sentences follow the house register. */
export const PALETTE_PANEL = Object.freeze({
  title: 'Actions',
  filter: 'Filter actions…',
  back: '‹ Agent',
  none: 'No action matches that. Clear the filter to see them all.',
  footer: 'Not possible yet, so not listed: rewinding a conversation, changing the model mid-session, attaching file contents. For a different model, start a new agent.',
  interrupt: 'Interrupt the running turn',
  interruptHint: 'Stops what it is writing now. The session stays open.',
  interruptDone: 'Interrupted.',
  interruptMissed: 'Nothing was interrupted; the turn may already be over.',
  stop: 'Stop this agent',
  stopHint: 'Closes the session. Queued messages are dropped; the reply it already gave stays.',
  stopped: 'Stopped. The session is closed.',
  child: 'Start an agent under this one',
  childHint: 'Opens the start panel with this agent as the parent.',
  queueFocus: 'Queue a message',
  queueFocusHint: 'Goes to the queue box on the agent page.',
  moveFocus: 'Change who it reports to',
  moveFocusHint: 'Goes to the Reports-to menu on the agent page.',
  copyBrief: 'Copy what you asked for',
  copyReply: 'Copy what it said',
  copied: 'Copied.',
  nothingToCopy: 'There is nothing to copy yet.',
  clipboardRefused: 'Select the text on the agent page instead — the clipboard refused this copy.',
})

/* THE QUEUE'S WORDS. The owner's ask: "can we add a que/unque for messages."
   A busy agent refuses an overlapping send by design; the queue is where the
   next message waits, visibly, until the turn completes and the view sends
   exactly one. Renderer memory only — a draft does not outlive the window,
   and the strip says so. */
export const QUEUE_PANEL = Object.freeze({
  title: 'Waiting to send',
  placeholder: 'Write the next message…',
  queue: 'Queue',
  unqueue: 'Unqueue',
  note: 'Sends by itself when the agent finishes its current turn. Kept only while this window is open.',
  sentNext: 'Sent the next queued message.',
  notSent: 'The queued message did not reach the agent, so it is back at the front of the queue. It will try again after the next turn, or unqueue it.',
})

/* THE RUNNING NARRATION, one line at a time. The engine says what it is doing
   -- a command starts, a command finishes, a file changes, an approval is
   wanted -- and this turns that data (sessionActivityEvent in
   src/agent-session-events.js) into one plain line for the rail. A command is
   the person's own machine doing something, so the command TEXT rides in the
   line as data, bounded so a long script cannot swallow the rail. */
const ACTIVITY_COMMAND_MAX = 120
export function activityLine(activity) {
  if (!activity || typeof activity !== 'object') return ''
  if (activity.kind === 'call') {
    if (activity.command) {
      const command = activity.command.length > ACTIVITY_COMMAND_MAX
        ? `${activity.command.slice(0, ACTIVITY_COMMAND_MAX)}…`
        : activity.command
      return `Running a command: ${command}`
    }
    if (activity.tool === 'fileChange') return 'Editing files.'
    return 'Using a tool.'
  }
  if (activity.kind === 'result') {
    if (activity.exitCode === 0) return 'The last command finished.'
    /* Action first, failure second — and not only for the reader: the checker
       scans template fragments separately, so a sentence that OPENS with the
       failure clause presents a dead-end fragment no trailing words can cure. */
    if (typeof activity.exitCode === 'number') return `Watch here for what the agent tries next — its last command failed with exit code ${activity.exitCode}.`
    return 'The last step finished.'
  }
  if (activity.kind === 'approval') return 'Waiting for an approval before going further.'
  return ''
}

/* THE WAIT IS THE PART PEOPLE DISTRUST. A start crosses a background service
   and a program that is not this one, so it is not instant; a spinner with no
   words beside it is where somebody presses the button a second time. These say
   that waiting is expected, and the running line says where to go next rather
   than leaving a person on a screen with nothing left to do. */
export const START_PROGRESS = Object.freeze({
  starting: 'Starting your agent. This takes a few seconds.',
  running: 'Your agent is running. Open it any time to see what it is doing.',
})

/** What the panel says while the agent is starting. */
export function startingLine(role) {
  if (!isKnownRole(role)) return START_PROGRESS.starting
  return `Starting your agent. It will take the ${roleLabel(role)} role in this tree.`
}

/** What the panel says once it is running. */
export function runningLine(role) {
  if (!isKnownRole(role)) return START_PROGRESS.running
  return `Your agent is running in the ${roleLabel(role)} role. Open it any time to see what it is doing.`
}

/* ---------------------------------------------------------------
   Refusals. Four of them, and each one ends somewhere.
   --------------------------------------------------------------- */

/* The half of a refusal only this flow knows: whatever else happened, no agent
   is running from this press. Composed in front of a curated diagnosis by
   startRefusalSentence() below, never shown on its own. */
const NOTHING_STARTED = 'Nothing was started.'

export const START_REFUSAL = Object.freeze({
  /* NO ASSISTANT PROGRAM ON THIS COMPUTER. Not a fault in the install and the
     wording must not read like one: ToolsEnabled has never contained the
     program that runs an agent, and Codex is a separate install. It walks the
     person to the two lines they have to type; it does not offer to type them,
     because it cannot. The commands are imported, not retyped. */
  assistantProgramMissing: `Nothing was started. Codex is the program that actually runs an agent, and this computer does not have it yet. Open Windows Terminal and run "${CODEX_SETUP_COMMANDS.install}". Then run "${CODEX_SETUP_COMMANDS.signIn}" in the same window. Come back here and press Start again.`,
  /* The second line of the same answer, kept apart so the panel can show it
     quietly. A machine that already has Node usually has the second route. */
  assistantProgramNote: `If you already have Node, "${CODEX_SETUP_COMMANDS.installWithNode}" does the same job.`,

  /* THE PART THAT STARTS AN AGENT IS NOT IN THIS BUILD. An incomplete download,
     not a mistake the person made, so the sentence spends itself on the one
     thing that clears it. It names no module: the file name is a support
     detail, and the person reading this has a reinstall to do. */
  enginePartMissing: 'Nothing was started. This copy of ToolsEnabled was built without the part that starts an agent. Reinstall ToolsEnabled from a complete build, then open this panel again.',

  /* A CAPACITY ANSWER, AND IT MUST NOT READ AS A FAULT. Every agent this copy
     can run at once is carrying work. Nothing is misconfigured and nothing
     needs repairing, so the two things offered are both about the agents that
     are already running. Wording this as a setup problem would send somebody
     off to edit their fleet over a queue that clears on its own. */
  everyAgentBusy: 'Nothing new was started, and nothing is wrong. Every agent this copy can run at once is already working. Wait for one to finish, or stop one in the tree, and then start this again.',

  /* A START THAT FAILED AND SAID NOTHING. The one case where the product owes
     the most and knows the least, so it admits that plainly and still ends with
     a next move. It does not guess at a cause: advice that confident and that
     wrong costs a person their window and lands them back here. */
  noReasonGiven: 'Nothing was started, and this copy was not told why. Try once more. If it refuses again, close ToolsEnabled, open it, and start from this panel.',

  /* A PANEL WIRED TO NOTHING, AND WHY IT MUST NOT BORROW THE SENTENCE ABOVE.
     noReasonGiven says "Try once more", which is right for a start that failed
     once and might not fail twice. This is the other thing: the panel has no
     receiver at all, so pressing again cannot ever work, and telling somebody
     to retry sends them round a loop with no exit. That is the dead end this
     whole module exists to remove -- technically survivable, practically
     nowhere. It also says whose fault it is, because a person who has just
     pressed a button that did nothing assumes it was theirs. */
  notWired: 'Nothing happened, and it is not something you did. This copy of the app has a fault: this panel is not connected to anything that can start an agent. Close ToolsEnabled and open it again.',
})

/* WHICH REFUSAL FROM THE ENGINE IS WHICH OF THE FOUR ABOVE.
 *
 * Only the codes that mean exactly what one of these sentences says are mapped.
 * Everything else falls through on purpose: src/agent-availability-copy.js has
 * curated, MORE SPECIFIC sentences for the rest of the agent-start vocabulary
 * -- being signed out of Codex, a permission level that cannot be read, a build
 * missing the part that keeps a session off a billed account -- and replacing
 * any of those with a general line here would be trading a good answer for a
 * shorter one. */
const REFUSAL_BY_CODE = Object.freeze({
  AGENT_CODEX_CLI_NOT_INSTALLED: START_REFUSAL.assistantProgramMissing,
  CODEX_CLI_NOT_FOUND: START_REFUSAL.assistantProgramMissing,
  AGENT_ENGINE_UNAVAILABLE: START_REFUSAL.enginePartMissing,
  BRIDGE_ALL_SEATS_BUSY: START_REFUSAL.everyAgentBusy,
  LAUNCH_FANOUT_EXCEEDED: START_REFUSAL.everyAgentBusy,
  AGENT_SESSION_FAILED: START_REFUSAL.noReasonGiven,
})

/** True when the panel should also offer the Node line beside the sentence. */
export function refusalNeedsAssistantProgram(result) {
  const code = refusalCodeOf(result)
  return Boolean(code) && REFUSAL_BY_CODE[code] === START_REFUSAL.assistantProgramMissing
}

/* Join a sentence to what follows it without doubling the full stop. */
function endSentence(text) {
  const value = String(text ?? '').trim()
  if (value.length === 0) return ''
  return /[.!?…]$/.test(value) ? value : `${value}.`
}

/* DID THE PRODUCT ACTUALLY LEARN ANYTHING? The engine's own `reason` is good
   English and worth showing, but two things arrive in that field that are not:
   an empty string, and a `reason` that is itself a machine code, which really
   happens when a thrown error's message is one. Both mean the same thing to the
   person in the panel -- nobody said why. The test for a code is imported from
   src/refusal-copy.js rather than retyped so the two cannot drift. */
function readableReason(result) {
  const value = result && typeof result === 'object' && typeof result.reason === 'string' ? result.reason.trim() : ''
  if (value.length === 0 || isBareIdentifier(value) || !/[a-z]/.test(value)) return ''
  return value
}

/**
 * THE ONLY WAY THIS FLOW SAYS THAT A START DID NOT HAPPEN.
 *
 * Give it the whole refusal, whatever shape it arrived in -- a result object, a
 * rejected call's error, nothing at all -- and it returns one sentence that
 * says what happened and what to do about it. It cannot return a code, it
 * cannot return an empty string, and there is no argument that would let a
 * caller ask for either.
 *
 * The order is most-specific-first, and the LAST branch is the point of the
 * whole function:
 *
 *   1. the four sentences above, for the refusals this panel words itself;
 *   2. this product's own curated answer for the rest of the agent-start
 *      vocabulary, with "Nothing was started" in front of it, because those
 *      sentences are written to be composed and none of them says it;
 *   3. src/refusal-copy.js's shared composer, whenever there is something real
 *      to pass on -- the engine's own English, or a curated remedy for the code.
 *      This branch must NOT prefix anything: a timeout deliberately says it is
 *      not known whether anything happened, and "Nothing was started" in front
 *      of it would be this module inventing a fact it does not have;
 *   4. and when there is neither a reason nor a remedy anybody wrote for this
 *      code, the fourth sentence above -- a start that failed and said nothing.
 *      Falling through to the shared generic remedy here produced two "Nothing"
 *      sentences back to back, which is the density this flow exists to remove.
 */
export function startRefusalSentence(result) {
  const code = refusalCodeOf(result)
  if (code && Object.prototype.hasOwnProperty.call(REFUSAL_BY_CODE, code)) return REFUSAL_BY_CODE[code]
  if (code && Object.prototype.hasOwnProperty.call(UNAVAILABLE_TEXT, code)) {
    return `${NOTHING_STARTED} ${endSentence(unavailableReason(code))}`
  }
  if (readableReason(result) || refusalRemedy(code) !== GENERIC_REMEDY) return refusalSentence(result)
  return START_REFUSAL.noReasonGiven
}

/* ---------------------------------------------------------------
   More than one tree on one computer.
   --------------------------------------------------------------- */

/* WHY "TREE" AND NOT "TEAM". src/agent-teams.js already owns the word team in
   this product, and it means something narrower there: a lead that is
   dispatched first with members nested under its launch. Two meanings for one
   word on adjacent screens is the kind of density this flow exists to avoid.
   A person looking at this page can see a tree, so the tree is what it is
   called. */
export const SECOND_TREE = Object.freeze({
  name: 'Another tree',
  action: 'Start another tree',
  help: 'A tree is one group of agents that work together. Start another when you want to keep two jobs apart.',
  /* A tree added on a computer that already has one. It is not the first-run
     empty state -- this person has done this before -- so it is one line. */
  empty: 'This tree is empty. Press a spot in it to start an agent here.',
})

/**
 * What a tree is called in a tab or a heading.
 *
 * Numbered, because a person with two of them needs to tell them apart and
 * nobody has been asked to name anything yet. A position that is not a counting
 * number returns the plain word rather than "Tree undefined", which is the
 * absence-read-as-a-value mistake this codebase keeps making.
 */
export function treeName(position) {
  return Number.isInteger(position) && position > 0 ? `Tree ${position}` : 'Tree'
}
