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
  /* THE LAST PLACE THE DEAD END WAS STILL WRITTEN DOWN.
   *
   * This line read "Claude cannot start from a tree yet; to use Claude, hand the
   * work over on the agent page instead." Both halves were removed everywhere
   * else on 2026-08-17 and this one survived, because it is help text under the
   * menu rather than a refusal, so no test about refusals looked at it. It was
   * found by DRIVING the panel and reading what was actually on the glass.
   *
   * BOTH HALVES WERE WRONG BY THEN. The destination was driven from the state a
   * person reads this in -- a set-up machine, a tree -- and had ZERO doors:
   * no link, no enabled control, and the agent route is not on the ring. And
   * "cannot start from a tree" is now decided per build by the shell, not by
   * this file: tierChoicesFor() labels each row from what
   * mc-agent:startable-tiers actually answered, so a build carrying the engine
   * shows "Sonnet · Claude" while this sentence underneath still said it could
   * not start. The menu and its own help contradicted each other on one screen.
   *
   * So the help says only what is true of every build: which row is a good
   * default. What a given row can do is on the row, where it is computed. */
  tierHelp: 'Luna is a good default. Each row says so if this copy cannot start it.',
  effortLabel: 'How hard should it think?',
  effortHelp: 'Harder thinking is slower and costs more. The tier picks a sensible default; change it here for this agent.',
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
const TIER_PROVIDER_WORDS = Object.freeze({ codex: 'Codex', claude: 'Claude', local: 'your computer' })
/* THE ONE PROVIDER THIS TREE CAN START. shell/agent-host.cjs resolveStartTier()
   refuses every other provider by name (AGENT_TIER_NO_LAUNCHER); the same fact
   is written on the row so a person sees it BEFORE pressing, on every surface
   that draws these rows -- the compose panel and the research designer's tier
   checkboxes both render `label`. The wording matches the running-session
   model menu in src/views/computers.js, so the product says it one way. */
/* WHAT THIS COPY CAN START, WHEN NOBODY HAS ASKED THE SHELL YET.
 *
 * This list used to be the ANSWER -- a frozen ['codex'] that decided the label
 * on every surface drawing these rows. The shell stopped agreeing with it: since
 * the tier gate opens on the payload genuinely carrying an engine (an actual
 * require() that must export a start function), a build WITH the Claude engine
 * would start a Claude tier while these rows went on saying it could not. A menu
 * that contradicts the button is worse than either answer alone.
 *
 * So this is now only the FALLBACK, and it is the pessimistic one on purpose: a
 * renderer with no bridge behind it (a plain browser), a payload older than the
 * channel, or a reply this build cannot parse all land here, and all of them are
 * builds where exactly the three Codex tiers start. Guessing wider would put
 * "startable" under a row that refuses. */
export const TREE_DEFAULT_STARTABLE_TIERS = Object.freeze(['luna', 'terra', 'sol'])
/* "from a tree", not "here". A person reads this row on the tree, where it is
   true, and the same product hands work to a Claude assistant on the agent page,
   where it is not. The old wording made those two screens contradict each other. */
const TIER_CANNOT_START_HERE = 'cannot start from a tree yet'
/**
 * Which tiers this copy can really start, out of what the shell answered.
 *
 * THE SHELL IS THE ONLY PARTY THAT KNOWS. mc-agent:startable-tiers does not
 * keep a list; it runs the SAME resolveStartTier() the press resolves from, so
 * the menu and the button cannot disagree by construction. This function's only
 * job is to refuse to believe anything else.
 *
 * AN EMPTY ARRAY IS AN ANSWER, NOT A FAILURE, and it is the one case worth
 * spelling out. `{ok: true, tiers: []}` means the shell resolved every tier and
 * none of them can start -- so every row says so. It does NOT fall back to the
 * three Codex tiers: that would be this file overruling the shell on the one
 * question the shell was asked, and it would put "startable" under a row that
 * refuses. A reply that is missing, rejected, malformed, or names tiers this
 * build has never heard of is a different thing entirely -- nothing was
 * learned -- and that lands on the pessimistic default above.
 */
export function startableTierIds(reply) {
  if (!reply || typeof reply !== 'object' || reply.ok !== true || !Array.isArray(reply.tiers)) {
    return TREE_DEFAULT_STARTABLE_TIERS
  }
  const known = reply.tiers.filter(id => typeof id === 'string' && LAUNCH_TIERS.some(tier => tier.id === id))
  /* Every entry unrecognised while the list was not empty means this renderer
     and that shell do not share a tier table -- an answer about a product this
     one is not, so it is discarded rather than half-read. */
  if (reply.tiers.length > 0 && known.length === 0) return TREE_DEFAULT_STARTABLE_TIERS
  return Object.freeze(known)
}

/** The menu rows, labelled by what this copy can actually start. */
export function tierChoicesFor(startable = TREE_DEFAULT_STARTABLE_TIERS) {
  const canStart = new Set(Array.isArray(startable) ? startable : TREE_DEFAULT_STARTABLE_TIERS)
  return Object.freeze(LAUNCH_TIERS.map(tier => {
    const provider = TIER_PROVIDER_WORDS[tier.provider] || tier.provider
    return Object.freeze({
      id: tier.id,
      label: canStart.has(tier.id)
        ? `${tier.label} · ${provider}`
        : `${tier.label} · ${provider} — ${TIER_CANNOT_START_HERE}`,
    })
  }))
}

/* WHAT A NODE'S ENGINE ROW SAYS, DERIVED RATHER THAN DECLARED.
 *
 * THE SENTENCE THIS REPLACES, and the owner's report about it: the tree node
 * panel's Setup box carried a hardcoded `TREE_ENGINE_LABEL = 'Codex'` and a
 * note reading "Agents you start from this tree run on Codex. You pick the
 * model in the start panel; the Claude choices are listed there and say so
 * when they cannot start yet." Both were written when Codex was the only
 * engine in the payload. capability/src/lib/agent-engine/claude-cli-process.js
 * ships now, resolveStartTier() stops refusing the Claude tiers, and the panel
 * went on naming Codex as THE engine on a build that starts Claude.
 *
 * IT IS TRUE BY CONSTRUCTION NOW, not by upkeep -- the same discipline
 * tierChoicesFor() already applies to the start menu. The words come from what
 * mc-agent:startable-tiers actually answered, which is the SAME
 * resolveStartTier() a press runs, so this row and the button cannot disagree.
 * A build that gains or loses an engine changes this sentence with no edit
 * here, and there is no argument that makes it name a provider the shell did
 * not list.
 *
 * A node that HAS run says what it ran on instead, from the tier recorded on
 * it -- that is history, and it stays true after the payload changes. */
export function tierProviderWord(tierId) {
  const row = LAUNCH_TIERS.find(candidate => candidate.id === tierId)
  if (!row) return null
  return TIER_PROVIDER_WORDS[row.provider] || row.provider
}

/** The distinct provider words behind a set of startable tier ids, in menu order. */
export function startableProviderWords(startable = TREE_DEFAULT_STARTABLE_TIERS) {
  const ids = new Set(Array.isArray(startable) ? startable : TREE_DEFAULT_STARTABLE_TIERS)
  const words = []
  for (const tier of LAUNCH_TIERS) {
    if (!ids.has(tier.id)) continue
    const word = TIER_PROVIDER_WORDS[tier.provider] || tier.provider
    if (!words.includes(word)) words.push(word)
  }
  return Object.freeze(words)
}

export const TREE_ENGINE = Object.freeze({
  /* An older record has no tier on it. "Not recorded", never a guess: naming
     the default here would put a provider on a run that may not have used it. */
  unrecorded: 'not recorded',
  /* The shell resolved every type and can start none of them. Said plainly,
     because the start panel is about to refuse and this is the warning. */
  none: 'nothing yet',
  noneNote: 'This copy cannot start any agent type from a tree yet. The start panel marks every type, and says so before you press.',
  note: words => `Agents you start from this tree run on the type you pick in the start panel. This copy can start ${listWords(words)}.`,
  /* For a node that already ran: what it ran on, not what this copy could
     start today. */
  ran: word => `This agent ran on ${word}.`,
})

/* "Codex and Claude", not "Codex, Claude" -- the panel is prose, and a comma
   list of two reads as a fragment beside the sentences around it. */
function listWords(words) {
  const list = Array.isArray(words) ? words.filter(Boolean) : []
  if (list.length === 0) return 'nothing'
  if (list.length === 1) return list[0]
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}

/* The rows a surface gets when it has not asked. Same value this constant has
   always had, so every existing importer is unchanged. */
export const TIER_CHOICES = tierChoicesFor()

/* Preselected, not prompted: the engine has a default, so the menu states it.
   An empty first row here would be a question the product already answers. */
export const DEFAULT_TIER = 'luna'

/* EFFORT, IN WORDS A PERSON WEIGHS. The engine's four keys are a real
   difference paid for in time and money, so each row says what it costs
   rather than leaving a bare key on the glass (write-surfaces.js already set
   this register: "thinks a little / harder / hardest"). The menu defaults
   from the chosen tier's own effort, so leaving it alone means the tier's
   judgment, not a hidden fifth value. */
/* THE PROVIDER'S OWN DEPTHS, IN THE PROVIDER'S OWN WORDS.
 *
 * Owner, iteration 7: "there are STANDARD per provider effort names. Use
 * those" — and he was right that these had been invented here. What stood
 * in this list was four made-up labels ("Quick — thinks briefly, cheapest")
 * over four of the eight values codex accepts, which meant the product could
 * not even ask for the other four. `ultra` was the costly one to miss: it is
 * not a bigger number, it is the switch for automatic task delegation, and
 * his own ~/.codex/config.toml runs it.
 *
 * Ids and descriptions below are transcribed from `model/list` on
 * codex-cli 0.146.0 (gpt-5.6 line, 2026-08-16). This list is the FALLBACK:
 * a running session lets the app ask the engine what the chosen model
 * really supports, and that answer wins — see readEngineCatalog in
 * src/views/computers.js. The name is the label; the provider's sentence is
 * the help text beside it. */
export const EFFORT_CHOICES = Object.freeze([
  Object.freeze({ id: 'low', label: 'low', description: 'Fast responses with lighter reasoning' }),
  Object.freeze({ id: 'medium', label: 'medium', description: 'Balances speed and reasoning depth for everyday tasks' }),
  Object.freeze({ id: 'high', label: 'high', description: 'Greater reasoning depth for complex problems' }),
  Object.freeze({ id: 'xhigh', label: 'xhigh', description: 'Extra high reasoning depth for complex problems' }),
  Object.freeze({ id: 'max', label: 'max', description: 'Maximum reasoning depth for the hardest problems' }),
  Object.freeze({ id: 'ultra', label: 'ultra', description: 'Maximum reasoning with automatic task delegation' }),
])

/** One depth, as a menu row reads it: the provider's name, then the
 *  provider's own sentence. Composed HERE rather than in the panel, because
 *  this module owns every word the start flow puts on screen — a panel that
 *  assembles its own line is a second voice, which is the drift this file
 *  exists to prevent. */
export function effortOptionLabel(choice) {
  if (!choice || typeof choice !== 'object') return ''
  const name = typeof choice.label === 'string' && choice.label ? choice.label : String(choice.id || '')
  const description = typeof choice.description === 'string' ? choice.description.trim() : ''
  return description ? `${name} — ${description}` : name
}

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
  /* "Its latest answer", because that is what the box holds: the reply is
     overwritten every turn, while the brief box above it shows the message
     written once at start. "What it said" read as the other half of one
     exchange, and the pairing was false. */
  title: 'Its latest answer',
  waiting: 'No answer yet. Words appear here as the agent writes them.',
  emptyTurn: 'The turn finished without any words back. Ask again, or ask for something smaller.',
})

/* A TURN THAT FAILED, ON A SESSION THAT REALLY STARTED. Measured on the
   2026-08-18 fresh-install walkthrough: a real Fable turn ended in the
   engine's own sentence -- "You're out of usage credits · resets Aug 25,
   12am" -- and the card said "The turn finished without any words back" while
   the chip said "did not start", over a session whose start the signed spawn
   record shows. Two lies from one gap: the failure's sentence never left the
   engine, and the only failure word the store had was the start-failure one.

   These are the words for the state that was missing. 'turn-failed' is a
   store status beside 'finished' (see NODE_STATUS_WORDS below); the reply
   carries the engine's sentence verbatim, because the provider's own words
   are the ones a person can act on. */
export const TURN_FAILED = Object.freeze({
  word: 'the last turn failed',
  reply: sentence => `The last turn failed: ${sentence}`,
})

/* THE CHIP WORD FOR EVERY STATUS THE STORE ACCEPTS -- one table, read by the
   chip on the canvas, the rail behind it, and the tooltip, so no surface can
   invent its own word for a state. 'failed' is a START that never happened
   ("did not start"); 'turn-failed' is a TURN that ended badly on a session
   that genuinely ran. Collapsing those two into one word is the measured
   defect this table exists to keep fixed: the card un-said a start the
   signed record shows. */
export const NODE_STATUS_WORDS = Object.freeze({
  draft: 'not started yet',
  starting: 'starting',
  running: 'running',
  finished: 'finished',
  failed: 'did not start',
  'turn-failed': TURN_FAILED.word,
})

/* THE WORDS ONE COMPLETED TURN LEAVES ON THE NODE, decided in one place.
 *
 * `spoken` is what the agent really streamed; it is never discarded. The
 * engine's sentence is what a FAILED turn ended with -- often the only human
 * sentence the whole turn produced (a refused model answers with no assistant
 * text at all). A failed turn that streamed nothing shows the failure
 * sentence; one that streamed words keeps them and the sentence both, because
 * dropping either would hide something that happened. Only when there is
 * genuinely nothing -- no words, no sentence -- does the honest empty-turn
 * line show. */
export function turnCompletionWords({ succeeded, spoken = '', engineSentence = null }) {
  const said = typeof spoken === 'string' ? spoken.trim() : ''
  const sentence = !succeeded && typeof engineSentence === 'string' ? engineSentence.trim() : ''
  if (sentence) return said ? `${said}\n\n${TURN_FAILED.reply(sentence)}` : TURN_FAILED.reply(sentence)
  return said || SAID_PANEL.emptyTurn
}

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
  /* The drag refusals. A drop that cannot be accepted says WHY in a sentence,
     never a silent snap-back — a wiggle animation with no words reads as a
     bug, not a rule. */
  alreadyUnder: (name, parent) => `${name} already reports to ${parent} — dropping it there changes nothing.`,
  wouldCycle: (name, target) => `${target} works under ${name}, so ${name} cannot also report to ${target}.`,
  notDraggable: (name) => `${name} is this tree's coordinator and stays at the top. Move its agents instead.`,
})

/* SESSION PROFILES, in words. A profile is a name and a folder; agents in a
   tree assigned one wake up in that folder, which is where their instructions
   live -- so "different onboarding for different work" is a folder choice,
   said plainly. The renderer never invents or displays a path of its own; the
   folder in a row is the one the person picked in the system dialog. */
export const PROFILE_PANEL = Object.freeze({
  title: 'Works in',
  help: 'A profile is a name and a folder. Agents in a tree that uses a profile start in that folder and read its instructions, so different kinds of work stay apart.',
  treeHelp: 'Where agents in THIS TREE start. Applies to agents started after you change it.',
  productWorkspace: 'The product’s own workspace',
  none: 'No profiles yet. Name one and pick its folder.',
  namePlaceholder: 'Name the profile…',
  add: 'Pick a folder…',
  remove: 'Remove',
  nameFirst: 'Name the profile first, then pick its folder.',
  cancelled: 'No folder was picked, so nothing was saved.',
  refused: 'That profile could not be saved. Try another name.',
  needsApp: 'Profiles need the installed app, and this window cannot reach it.',
  assigned: (name) => `Agents in this tree now start in ${name}.`,
  cleared: 'Agents in this tree now start in the product’s own workspace.',
  /* The mid-conversation half of the owner's ask ("change session profiles
     halfway through - with a warning because of possible token burn"): the
     assignment itself only touches FUTURE starts, so moving the agent on
     screen is a separate, warned press. */
  switchOffer: 'This agent keeps its current folder until it restarts. Restarting re-sends its saved conversation, which costs tokens.',
  switchGo: 'Restart it in the new folder',
})

/* RESUMING A DEAD SESSION (iteration 5 W7). A session cannot be reopened —
   the engine process is gone — so resume is honest about what it does: a
   FRESH agent starts and its first message is the saved conversation. The
   hint carries the token cost, because the press re-sends every saved word. */
export const RESUME_PANEL = Object.freeze({
  action: 'Resume with a fresh agent',
  hint: 'Starts a new agent whose first message is the saved conversation. Re-sending it costs tokens.',
  nothing: 'Nothing is saved here to resume from.',
  busy: 'This agent is still running — stop it first, or just keep talking to it.',
  failed: 'The resume did not happen. The saved conversation is untouched; press again to retry.',
  done: 'Resumed. A fresh agent is reading the conversation and will pick it up from there.',
  /* The real one: the engine still held the thread, so the SAME agent came
     back with its own memory. Nothing was re-sent and nothing was charged,
     which is the difference worth saying out loud. */
  continued: 'Back. This is the same agent, with everything it already remembered — nothing had to be re-sent.',
  marker: 'Resumed — the saved conversation above was sent to a fresh agent.',
})

/* A CHAT OVER AN AGENT THAT IS NOT RUNNING, WHICH IS STILL A CHAT.
 *
 * WHAT THIS REPLACED, and why it was the owner's report. Both chat surfaces on
 * the tree -- the compact card on the canvas and the rail's Chat tab -- were
 * gated on the node holding a session id, so a node whose START WAS REFUSED
 * opened nothing at all. That is not a rare state: submitCompose() marks a
 * refused start `failed` and leaves the session id null, so on a build that
 * cannot start the picked engine EVERY node a person makes is one of these, and
 * "the chatboxes dont open" is the exact and correct description of it.
 *
 * IT DOES NOT BECOME A TEXT BOX THAT SWALLOWS WORDS. src/node-chatbox.js's
 * header states the rule this obeys: a composer must never pretend to reach a
 * process that cannot hear it. So the chat opens over the real conversation --
 * what the person asked for, and the reply if there ever was one -- with the
 * message box disabled and one of these sentences in its place. The actions
 * button stays, because the things that CAN still be done to an agent that
 * never started (start one under it, move it, copy its brief) all live there.
 *
 * The refusal is not rewritten here. `refused` composes the node's OWN
 * statusNote, which is the sentence the start path already wrote, so this
 * surface and the panel that reported the refusal cannot drift apart. */
export const CHAT_NOT_RUNNING = Object.freeze({
  subtitle: 'your agent · not running',
  /* Composed after the node's own refusal sentence. */
  refused: reason => `${reason} Nothing can be sent to an agent that did not start.`,
  /* No refusal on file: the start was never attempted, or the record predates
     status notes. Never says the start failed, because nothing says it did. */
  neverStarted: 'This agent is not running, so there is nothing here to send a message to. What you asked for is above, and its answer arrives here when it runs.',
})

/* CHANGING HOW HARD IT THINKS, MID-CONVERSATION (iteration 5 W10). The wire
   has no mid-session knob — depth is bound when the engine process starts —
   so the menu says what really happens: a restart that re-reads the saved
   conversation at the new depth, warned before it fires. */
export const EFFORT_SWITCH = Object.freeze({
  /* Said when the engine changed a RUNNING thread's depth in place, which is
     the ordinary case now: no restart, nothing re-sent, nothing charged. */
  changed: depth => `Now thinking at ${depth}. Nothing was restarted and nothing was re-sent.`,
  title: 'How hard it thinks',
  help: 'Changing depth restarts this agent: a fresh session reads the saved conversation at the new depth.',
  warn: 'Restarting re-sends the saved conversation, which costs tokens.',
  go: 'Restart at this depth',
  keep: 'Keep its current depth',
})

/* MESSAGING A DEAD AGENT JUST WORKS (iteration 6, owner: "We still get this
   message" — the sessionGone refusal). The send now recovers by itself: a
   fresh agent reads the saved conversation and the typed message waits in
   the queue, visibly, until the reading turn finishes. The sentence says
   all three honest parts: what ended, what it costs, when the words go. */
export const RECOVERED_SESSION = Object.freeze({
  /* Said BEFORE the outcome is known, so it claims nothing about cost. The
     old wording promised a token-burning summary every time, which is now
     the rarer of the two paths — the engine usually still holds the thread
     and brings the same agent back for nothing. */
  reconnecting: 'That agent’s session had ended. Bringing it back now…',
  /* The fallback, said only when it really happened. */
  summarised: 'Its conversation was no longer on this computer, so a fresh agent is reading the saved summary instead — that part costs tokens. Your message goes the moment it catches up.',
  bare: 'That agent’s session had ended, so a fresh one started in its place. Your message is going now.',
})

/* THE STATE AN APP RESTART LEAVES BEHIND.
 *
 * A session is a child process, so closing ToolsEnabled ends it. The RECORD of
 * the node survives, still saying what it was doing at the moment the window
 * went away, and on the next launch that record used to be read as a running
 * agent: a ticking clock, a chip reading "starting", and a Stop button over
 * something that had stopped hours earlier.
 *
 * These are the words for what really happened. They say the session ended,
 * they say why, and each one ends with the thing to do next, because a person
 * looking at this node is looking for the way out of it. */
export const ENDED_SESSION = Object.freeze({
  word: 'stopped',
  subtitle: 'your agent · this session ended when the app closed',
  said: 'The app closed while this agent was working, so its answer was lost. Type a message to bring it back, or use Resume with a fresh agent.',
})

/* THE ACTIONS PALETTE — now the chat composer's popup. Every row is an
   action this build really performs on this node, today. What the product
   cannot do is one honest sentence in the footer, never a disabled control
   pretending — the temperature-slider rule.
   Refusal/confirmation sentences follow the house register. */
export const PALETTE_PANEL = Object.freeze({
  title: 'Actions',
  filter: 'Filter actions…',
  back: '‹ Agent',
  none: 'No action matches that. Clear the filter to see them all.',
  footer: 'Not possible yet, so not listed: attaching a text file’s contents — mention the file instead, and the agent reads it itself.',
  rewind: 'Rewind to one of your messages',
  rewindHint: 'Pick one of your messages; the agent forgets everything said after it.',
  switchModel: 'Switch model',
  switchModelHint: 'The change holds until you change it back; the conversation continues.',
  attach: 'Attach an image',
  attachHint: 'Opens a file picker. The picked image rides with your next message.',
  attachPicked: 'Attached. It rides with the next message you send.',
  attachCancelled: 'Nothing was attached.',
  mention: 'Mention a file',
  mentionHint: 'Opens a file picker and writes the path into your message. The agent reads it itself, under its own permissions.',
  /* ITS OWN SENTENCE. A cancelled mention used to say "Nothing was attached."
     which is true of a different action, and a person who had just pressed
     Mention read a sentence about Attach. */
  mentionCancelled: 'No file was mentioned.',
  mentionWritten: 'Written into your message box. Finish the sentence and send it.',
  clear: 'Start this conversation over',
  clearHint: 'The agent forgets everything said here. Its place in your tree and its brief stay.',
  cleared: 'Started over. It remembers nothing from before — say what you want from the message box or the queue.',
  clearFailed: 'The conversation was not restarted. The old session is closed; press this again to try a fresh start.',
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
  queueFocusHint: 'Focuses the message box — while the agent works, a send waits its turn and shows above the box.',
  moveFocus: 'Change who it reports to',
  moveFocusHint: 'Opens the Reports-to menu on the Details tab.',
  copyBrief: 'Copy what you asked for',
  copyReply: 'Copy what it said',
  /* THE GROUPS, because eleven mixed-severity rows in source order put "Stop
     this agent" beside "Copy what it said". Three headings, and the one that
     ends or forgets something is last and on its own. */
  groupConversation: 'This conversation',
  groupAgent: 'This agent',
  groupDanger: 'Stop or start over',
  /* WHY A ROW CANNOT BE PRESSED, one sentence each, shown in place of the hint
     on a row that is switched off. A disabled control that will not say why is
     the exact class of thing the owner keeps filing. Each names the state and
     none of them says what to do about it, because the way out is the row
     itself becoming pressable once the state changes. */
  whyNotRunning: 'This agent is not running right now.',
  whyNotStarted: 'This agent has not started yet.',
  whyNoTurns: 'You have not sent it a message yet.',
  /* Measured 2026-08-18: after a restart this row said "You have not sent it a
     message yet." beside a panel showing four sent messages. The sent-count the
     row read is window memory and resets with the window; the saved
     conversation does not. This is the sentence for that state -- the record is
     real, and rewind's reach is not. */
  whyOnlySavedTurns: 'Your saved messages are from before this window opened, and rewind cannot reach them. Send a new message first.',
  whyNoBrief: 'Nothing was asked here yet.',
  whyNoReply: 'It has not answered yet.',
  whyNoSaved: 'There is no saved conversation to resume from.',
  whyNoPicker: 'This page cannot open a file picker. Use the installed app.',
  copied: 'Copied.',
  nothingToCopy: 'There is nothing to copy yet.',
  clipboardRefused: 'Select the text on the agent page instead — the clipboard refused this copy.',
  done: 'Done.',
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
  cardQueued: 'Queued — sends by itself when this turn finishes.',
  notSent: 'The queued message did not reach the agent, so it is back at the front of the queue. It will try again after the next turn, or unqueue it.',
  emptyQueueCommand: 'Write the message after /queue, and it will wait its turn.',
})

/* THE REWIND MENU. The engine forks the conversation at one of the person's
   own turns — proven live before this shipped (tools/agent-rewind-probe.mjs:
   the fork remembered everything up to the picked turn and nothing after).
   The menu lists the person's own words, which is the only honest way to name
   a point in time they can recognise. */
export const REWIND_PANEL = Object.freeze({
  title: 'Rewind',
  help: 'Pick one of your messages. The agent keeps everything up to it and forgets everything after it.',
  button: 'Rewind',
  done: 'Rewound. The agent remembers everything up to that message and nothing after it.',
  busy: 'Interrupt the running turn first — a rewind needs the agent idle.',
  empty: 'Send a message first; your messages appear here to rewind to.',
  failed: 'The rewind did not happen; the conversation is unchanged. Try once more.',
})

/* THE APPROVAL CARD — rendered only when a request arrives, which today is
   never (approvalPolicy is 'never' at every tier; the reply path shipped
   first, by design). Decisions render in words; the identifiers ride
   underneath as values. */
export const APPROVAL_PANEL = Object.freeze({
  title: 'It is asking permission',
  command: prefix => `It wants to run: ${prefix}`,
  file: 'It wants to change files.',
  generic: 'It is asking to go further.',
  answered: 'Answered. The agent continues from your decision.',
  failed: 'The answer did not land; the agent is still waiting. Press a choice again.',
  words: Object.freeze({
    accept: 'Allow once',
    acceptForSession: 'Allow for this session',
    decline: 'Refuse',
    cancel: 'Cancel this step',
  }),
})

export function approvalDecisionWord(decision) {
  if (APPROVAL_PANEL.words[decision]) return APPROVAL_PANEL.words[decision]
  return String(decision || '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
}

/* THE MODEL MENU on a running conversation. The engine accepts a model per
   turn, so switching is real and the conversation continues — this is not the
   respawn semantics of starting a new agent. Claude rows are shown so a
   person can see they exist, and refused honestly when picked, exactly like
   the start menu. */
export const MODEL_PANEL = Object.freeze({
  title: 'What it runs on',
  currentDefault: 'Runs on the model its tier chose when it started.',
  /* STICKY, and the sentence says so. The override map keeps the choice until
     a person changes it back — "your next message" implied one message and
     then a revert, which is not what the mechanism does, and clearing the map
     after one send to match the words would have made the menu's selected
     state lie in the other direction. The words follow the mechanism. */
  next: model => `Messages run on ${model} until you change it back. The conversation continues.`,
  keep: 'Keep the tier’s model',
})

/* THE RUNNING NARRATION, one line at a time. The engine says what it is doing
   -- a command starts, a command finishes, a file changes, an approval is
   wanted -- and this turns that data (sessionActivityEvent in
   src/agent-session-events.js) into one plain line for the rail. A command is
   the person's own machine doing something, so the command TEXT rides in the
   line as data, bounded so a long script cannot swallow the rail. */
const ACTIVITY_COMMAND_MAX = 120

/* THE SAME NARRATION, AS A ROW RATHER THAN A LINE.
 *
 * activityLine above answers "what is it doing right now" and is overwritten by
 * the next event. A chat row is the opposite: it stays, it is one of many, and
 * it has to keep reading correctly hours later. So it is three short pieces
 * rather than a sentence -- the tool's own name, the thing it was pointed at,
 * and what became of it.
 *
 * THE TOOL NAMES ARE THE ENGINES' OWN and are not shown raw. codex says
 * `commandExecution`; the Claude CLI says `Bash`. Neither is a word a person
 * asked for, so each known one has a plain name here and an unknown one falls
 * back to a word that is true of all of them. */
const ACTION_TOOL_WORDS = Object.freeze({
  commandExecution: 'Command',
  fileChange: 'Edit',
  mcpToolCall: 'Tool',
  dynamicToolCall: 'Tool',
  Bash: 'Command',
  Read: 'Read',
  Edit: 'Edit',
  Write: 'Write',
  Glob: 'Search',
  Grep: 'Search',
  WebFetch: 'Web',
  WebSearch: 'Web',
  Task: 'Helper',
  command: 'Command',
})

const ACTION_STATE_WORDS = Object.freeze({
  working: 'running',
  done: 'finished',
  /* "did not finish" rather than a failure word: this is a row label, and a
     bare failure word with no way forward is the dead end the words gate is
     there to catch. The command and its output are one press away, which is
     where a person can actually see what happened. */
  undone: 'did not finish',
  waiting: 'waiting for you',
})

export function actionRowWords(row) {
  if (!row || typeof row !== 'object') return { tool: 'Step', detail: '', state: '' }
  const tool = ACTION_TOOL_WORDS[row.tool] || (row.kind === 'approval' ? 'Approval' : 'Step')
  const detail = typeof row.detail === 'string' ? row.detail : ''
  return {
    tool,
    detail: detail.length > ACTIVITY_COMMAND_MAX ? `${detail.slice(0, ACTIVITY_COMMAND_MAX)}…` : detail,
    state: ACTION_STATE_WORDS[row.state] || ACTION_STATE_WORDS.done,
  }
}

/* THE RECORD ADMITS WHAT IT COULD NOT KEEP. A saved conversation is an
   excerpt with bounds, and when those bounds really bite the shortened version
   must not be shown as if it were the whole thing. */
export const TRANSCRIPT_TRIMMED_NOTE = 'Some older messages were left out so the newest ones would fit.'

/* WHAT THE CAP TOOK, SAID OUT LOUD. A per-turn cap a person cannot see is a
   cap that lies about how much the agent did. */
export function foldedActionsLine(count) {
  const many = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
  if (many === 0) return ''
  return many === 1 ? 'and 1 more step' : `and ${many} more steps`
}

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

/* WHAT THE SESSION HAS USED, as one sentence. The engine reports token usage
   on every update; the reader (sessionUsageEvent) admits only numeric fields,
   and this turns the common ones into words. Field names vary by engine
   version, so each is looked up by its known spellings and a reading with
   nothing recognisable says so instead of inventing a number. */
function usageNumber(usage, names) {
  for (const name of names) {
    if (Number.isFinite(usage?.[name])) return usage[name]
  }
  return null
}

function tokensWord(count) {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)} million tokens`
  if (count >= 10_000) return `${Math.round(count / 1000)} thousand tokens`
  return `${count} tokens`
}

export function usageSentence(usage) {
  const input = usageNumber(usage, ['input_tokens', 'inputTokens', 'prompt_tokens', 'promptTokens'])
  const output = usageNumber(usage, ['output_tokens', 'outputTokens', 'completion_tokens', 'completionTokens'])
  const cached = usageNumber(usage, ['cached_input_tokens', 'cachedInputTokens', 'cache_read_input_tokens'])
  const total = usageNumber(usage, ['total_tokens', 'totalTokens'])
    ?? (input !== null || output !== null ? (input || 0) + (output || 0) : null)
  if (total === null) return 'The engine reported its usage in a form this copy does not recognise yet.'
  const parts = []
  if (input !== null) parts.push(`${tokensWord(input)} read`)
  if (output !== null) parts.push(`${tokensWord(output)} written`)
  if (cached !== null && cached > 0) parts.push(`${tokensWord(cached)} of the reading served from cache`)
  const window = usageNumber(usage, ['modelContextWindow', 'contextWindow'])
  const windowSentence = window !== null && window > 0
    ? ` The model's window holds ${tokensWord(window)}.`
    : ''
  return (parts.length
    ? `About ${tokensWord(total)} so far — ${parts.join(', ')}.`
    : `About ${tokensWord(total)} so far.`) + windowSentence
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

  /* A NODE THAT OUTLIVED ITS SESSION. The tree is saved on this computer and
     survives closing ToolsEnabled; the agent sessions behind it do not. So a
     spot from an earlier run still shows its ask and its last reply, and a
     message written to it reaches a session this run does not hold. Retrying
     can never deliver it -- the truthful next move is a fresh agent. */
  sessionGone: 'Start a new agent for this spot. The one it was talking to ended when ToolsEnabled closed, so this message was not sent. Sending again cannot reach it.',

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
  MC_AGENT_UNKNOWN_SESSION: START_REFUSAL.sessionGone,
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

/* The availability table's sentences are written lower-case first because two
   of their three surfaces read "unavailable · <phrase>" and "refused ·
   <phrase>" (agent-session.js), where a capital would be wrong. This surface
   is the third, and it puts a full stop in front of them -- which rendered
   "Nothing was started. this copy starts Codex agents…" on the installed
   1.0.17, measured. Capitalise HERE, at the one join that needs it, rather
   than in twenty strings the other two surfaces also read. */
function startCapital(text) {
  const value = String(text ?? '')
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1)
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
/* WHAT IS MISSING FOR THE TIER THAT WAS ACTUALLY REFUSED, AND NOTHING ELSE.
 *
 * THE DEFECT THIS CLOSES. AGENT_TIER_NO_LAUNCHER is raised by resolveStartTier()
 * for whichever provider THIS build carries no launcher for, and the shared
 * table in src/agent-availability-copy.js is keyed by the code alone -- so its
 * sentence had to describe every provider the code could ever be raised for. It
 * named Claude and local together, and then the Claude engine shipped
 * (capability/src/lib/agent-engine/claude-cli-process.js, present in the
 * installed 1.0.20) and the gate stopped raising it for Claude. The sentence
 * went on naming Claude anyway, on a build that runs Claude.
 *
 * THE TREE IS THE ONE SURFACE THAT KNOWS WHICH TIER WAS PICKED, because the
 * press carried it: startAgentForNode() has the tier in hand when it calls this,
 * and passes it back in. So this names the provider of the tier that was
 * refused, which the refusal itself proves has no launcher here, and never a
 * provider that was not asked for.
 *
 * IT IS TRUE BY CONSTRUCTION RATHER THAN BY UPKEEP. The sentence is only ever
 * produced for a tier the shell just refused, and the refusal MEANS this build
 * has no launcher for that tier. A build that gains an engine stops raising the
 * code for it and this sentence stops being said about it, with no edit here.
 * An unknown or absent tier returns null and the caller falls back to the shared
 * table, which names no provider at all.
 */
const TIER_PROVIDER_MISSING = Object.freeze({
  codex: 'the part that runs a Codex agent',
  claude: 'the part that runs a Claude agent',
  /* Not "a local agent": the phrase a person can act on is what the machine
     would be doing, and "on this computer itself" is the distinction from the
     two above -- both of which also run on this computer, through a program
     signed in to a service. */
  local: 'the part that runs an agent on this computer itself',
})

export function tierNoLauncherSentence(tier) {
  const row = LAUNCH_TIERS.find(candidate => candidate.id === tier)
  const missing = row ? TIER_PROVIDER_MISSING[row.provider] : null
  if (!missing) return null
  return `Nothing was started. This copy of ToolsEnabled does not carry ${missing}, and nothing on this computer is broken. The model menu marks every type this copy cannot start; pick one it does not mark.`
}

export function startRefusalSentence(result, { tier = null } = {}) {
  const code = refusalCodeOf(result)
  /* Before the tables, because both of them answer this code without the one
     fact that makes the answer specific. A tier this module does not recognise
     falls through to the shared sentence rather than inventing a provider. */
  if (code === 'AGENT_TIER_NO_LAUNCHER') {
    const named = tierNoLauncherSentence(tier)
    if (named) return named
  }
  if (code && Object.prototype.hasOwnProperty.call(REFUSAL_BY_CODE, code)) return REFUSAL_BY_CODE[code]
  if (code && Object.prototype.hasOwnProperty.call(UNAVAILABLE_TEXT, code)) {
    return `${NOTHING_STARTED} ${startCapital(endSentence(unavailableReason(code)))}`
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
  /* The drag-out gesture's answer, in the move vocabulary the rail already
     speaks. Named with the node so a person who dropped the wrong thing sees
     it immediately. */
  detached: (name) => `${name} is now its own tree. Everything under it came along.`,
  /* THE GESTURE WAS UNDERSTOOD AND NOTHING MOVED, which is a third answer and
     used to be reported as the first. fleet-trees.js accepts a drag-out of a
     node that is ALREADY the sole root of its own tree -- correctly, the
     gesture's meaning is satisfied -- and answers `unchanged: true`. The page
     printed "is now its own tree" over it anyway, so a person was told a move
     had happened when the tree was exactly as before. */
  alreadyOwnTree: (name) => `${name} is already its own tree, so nothing moved.`,
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
