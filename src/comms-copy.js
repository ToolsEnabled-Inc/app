/* THE WORDS THE AGENT COMMS PAGE USES, IN THE ONE FILE THAT HAS NO BROWSER IN IT.
 *
 * WHY THESE STRINGS LEFT THE VIEW. src/views/comms.js imports a stylesheet, so
 * a plain `node` run cannot load it, and every sentence the page shows was
 * composed inside closures in there -- which is how the page came to say the
 * same fact four to six times at once ("on record", "declared", "separate
 * records", "services on record" for ONE count, in ONE header row) and how one
 * thirty-three-word refusal got stamped into every tile, the topic bar and the
 * rail foot (N+1 copies of one failure). Every sentence, read on its own, was
 * defensible; the panel as a whole was not readable, and a gate that reads
 * string literals one at a time cannot see that. So the strings live here,
 * where tools/check-composed-output.mjs can build the WHOLE panel for a state
 * and measure it as one thing (tools/lib/composed-panels.mjs), the same move
 * src/ledger-copy.js made for the ledger.
 *
 * ONE NAME. The page had six -- "message board", "watch board", "Ops
 * projection", Watch/Channels, the `.ch-*`/`.wb-*` class families and the
 * route `comms`. The only name printed now is COMMS_NAME. The route and the
 * crumb in src/main.js keep the word "comms" (tools/test/research-view.test.mjs
 * pins the ring), and the mode switch says what each face IS -- a board of
 * tiles, a list of channels -- rather than naming the page twice more.
 *
 * WHAT THE PAGE IS FOR, in one sentence, because the owner's finding was that
 * nobody could say: Agent comms shows the messages your agents send each
 * other, channel by channel, and which services and channels exist on this
 * computer.
 *
 * EACH FACT ONCE. The inventory (how many services, channels, messages, tool
 * links) is said in the one line under the title and nowhere else. A
 * channel's state and detail are said by `describe`, and the tile line and the
 * topic bar both read it, so the two can never drift the way `desc` and
 * `topic` had ("Service on record · relay · :61411" beside "… · port 61411").
 *
 * NO JARGON. "projection", "envelope", "payload", "renderer" are on the gate's
 * list (tools/check-plain-language.mjs JARGON) and none of them is a word a
 * person who has never read this codebase would have. The thing the page reads
 * is "the comms report"; the thing that reads it is "this copy of the program".
 *
 * DOM-FREE ON PURPOSE: imported by node tests and by the composed-output gate.
 * Nothing in here may touch `document` or `window`, and nothing may import a
 * module that does (src/vocab.js resolves the whole fleet profile at load, so
 * the six role hues are copied below and pinned to it by a test instead). */

export const COMMS_NAME = 'Agent comms'

/* The two faces. `watch` and `channels` stay as the data-wmode values (the
   stylesheet's [data-mode] rules key on them); only the words a person reads
   changed. "Board | Channels" says what each face shows. */
export const MODE_LABELS = Object.freeze({ watch: 'Board', channels: 'Channels' })

/* The two groups in the rail, in the order they are drawn. Services are not
   channels -- a service on record is a thing this computer is configured to
   run; a channel is a place messages land -- so they are listed apart and the
   service rows are not buttons (there is nothing to open on one). */
export const RAIL_GROUPS = Object.freeze({ services: 'Services', channels: 'Channels' })
export const NO_SERVICES = 'No services on record.'

/* The word beside the dot in the header. One word per state, the same five
   states the root's data-projection-state carries, so the word and the
   attribute can never disagree. */
export const READ_STATE_WORDS = Object.freeze({
  loading: 'reading',
  ready: 'live',
  'partial-unavailable': 'partial',
  unavailable: 'could not be read',
  simulated: 'example',
})
export function readStateWord(state) {
  return READ_STATE_WORDS[state] || READ_STATE_WORDS.loading
}

export const EXAMPLE_BADGE = 'Example, not your data'

/* Shown while the first read is in flight -- not a failure and not an empty
   answer, the third thing, and it is on screen for a moment. It is named
   because the view has to recognise it: a read that has not answered yet is
   not a computer with nothing to say. */
export const LOADING_LINE = 'Reading this computer’s messages…'

/* The one line under the title when the whole read failed. Never a count: a
   page whose every readout says "could not be read" must not also claim a
   number of anything (tools/offline-routes-qa.mjs pins the contradiction). */
export const UNREADABLE_SUB = 'The comms report could not be read.'

const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`

/**
 * The inventory, said once. `data` is the `$defs/data` layer of the comms
 * report: { declaredServices, channels, mcp, messages }. A part that could not
 * be read says so in its own segment; the messages segment is left out when
 * messages.ok is false, because the notice above the card already says it and
 * the same failure in two places is the defect this file exists to remove.
 */
export function inventoryLine(data) {
  const services = Array.isArray(data?.declaredServices) ? data.declaredServices.length : 0
  const channels = data?.channels?.ok && Array.isArray(data.channels.value) ? data.channels.value : null
  const messages = data?.messages?.ok && Array.isArray(data.messages.value) ? data.messages.value : null
  const mcp = data?.mcp?.ok && data.mcp.value ? data.mcp.value : null
  const parts = [plural(services, 'service')]
  parts.push(channels ? plural(channels.length, 'channel') : 'channels could not be read')
  if (messages) parts.push(plural(messages.length, 'message'))
  parts.push(mcp
    ? `tool links: ${(mcp.live || []).length} live, ${(mcp.dead || []).length} not answering`
    : 'tool links could not be read')
  return parts.join(' · ')
}

/** "{state} · {detail}" -- the one sentence a tile and the topic bar share. */
export function describe(channel) {
  const state = typeof channel?.state === 'string' && channel.state ? channel.state : 'unknown'
  const detail = typeof channel?.detail === 'string' && channel.detail.trim() ? channel.detail.trim() : ''
  return detail ? `${state} · ${detail}` : state
}

/** A service row in the rail. Prose, not a button. */
export function serviceLine(service) {
  return `${service?.displayName || service?.id || 'service'} · ${service?.transport || 'transport not named'} · port ${service?.port ?? '—'}`
}

/* Empty is an ANSWER, not a failure -- the read worked and found nothing.
   These two never say "could not". They are also deliberately distinct from
   the host-absent and quiet notices in src/first-run-needs.js, which explain a
   whole page with nothing on it; these are for one channel, or one board,
   when the rest of the page is fine. */
export const emptyLine = () => 'No messages on this channel yet.'
export const boardEmptyLine = () => 'No channels to show yet.'

/* EVERY FAILURE NAMES A NEXT STEP. A sentence that ends at the failure is what
   the owner filed as a finding in its own right ("passive dead ends"). Each
   reason below is at most 25 words a sentence, names what did not happen, and
   says the one thing that would tell the reader whether their agents are
   silent or the page is. The reader is the bridge on window.mcAgent
   (shell `mc-agent:local-messages`). */
export const READER_REFUSALS = Object.freeze({
  NO_READER: 'This copy of the program cannot read messages between agents yet. Update it. Until then, each agent’s own conversation is on the Computers page.',
  NO_ANSWER: 'The program did not answer when asked for messages between agents. Start an agent from the tree; if this keeps happening, restart the program.',
  READ_THREW: (error) => `Messages between agents could not be read (${errorText(error)}). This page will try again in a few seconds. The Computers page still shows each agent’s own conversation.`,
})

/** The whole read fell over (the request itself, not one part of it). */
export const LOAD_FAILED = (error) => `This page could not read the comms report (${errorText(error)}). It will try again in a few seconds.`

function errorText(error) {
  const text = error && typeof error === 'object' && 'message' in error ? error.message : error
  const trimmed = String(text ?? '').trim()
  return trimmed || 'no reason given'
}

/* ---------------------------------------------------------------- rows -- */

/* WHEN A MESSAGE FOLDS. 280 characters is about four lines at the board's
   column width, and two line breaks is a message with structure (a list, a
   report) rather than a line of talk. Either one makes the row a block a
   reader has to choose to read, so it opens on a press the way the chat's
   context block does (components.js addContext / ownDisclosure). */
export const FOLD_CHARS = 280
export const FOLD_BREAKS = 2
export function shouldFold(text) {
  const value = String(text ?? '')
  if (value.length > FOLD_CHARS) return true
  return (value.match(/\n/g) || []).length > FOLD_BREAKS
}

/* THE CLOSED LINE says what is inside in the message's own first words and
   how much of it there is -- the size in WORDS because that is the unit a
   person reads in (the rule src/fleet-tree-copy.js treeContextSummary holds).
   The sender is NOT repeated here: every surface this fold sits on already
   names the sender on the line above it, and saying it twice on one row is
   the restating this page was cleared of. */
export function foldSummary(text) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim()
  const words = value ? value.split(' ').length : 0
  const stop = value.search(/[.!?…](\s|$)/)
  let first = stop >= 0 ? value.slice(0, stop + 1) : value
  if (first.length > 90) first = `${first.slice(0, 90).trimEnd()}…`
  else if (first.length < value.length) first = `${first.replace(/[.!?…]$/, '')}…`
  return `${first} · ${plural(words, 'word')}`
}

/* The six role hues, in the order senders are coloured by first appearance.
   COPIED from src/vocab.js ROLES (coordinator, helper, shadow, manager,
   default, spawned) and pinned to it by tools/test/comms-copy.test.mjs;
   vocab.js cannot be imported here (see the header). A sender is not a role
   -- the hue only keeps one voice recognisable down a channel. */
export const SENDER_HUES = Object.freeze(['#008dab', '#c85900', '#00956c', '#3e63f0', '#9d7900', '#697077'])

/** sender -> hex, stable by first appearance in `messages` (oldest first). */
export function senderHues(messages) {
  const hues = new Map()
  for (const message of messages || []) {
    const sender = String(message?.sender ?? '')
    if (!sender || hues.has(sender)) continue
    hues.set(sender, SENDER_HUES[hues.size % SENDER_HUES.length])
  }
  return hues
}

export const KINDS = Object.freeze(['ask', 'answer', 'notice'])
export const KIND_TAGS = Object.freeze({ ask: 'asked', answer: 'answered' })
export const NO_ANSWER_YET = 'no answer yet'
export const replyingTo = (name) => `replying to ${name}`
export const toRecipient = (name) => `→ ${name}`

/**
 * One row, for all three surfaces (the log, the expanded tile, the preview).
 * `byId` is the channel's messages keyed by id, oldest first. Everything that
 * is not on the message is simply absent from the model -- a notice prints no
 * tag, a message with no recipient prints no arrow, a reply whose parent is
 * not in this channel prints no "replying to" (it would be a link to nowhere).
 * Today the live reader provides none of kind/causalParent/recipient/
 * senderMachine (capability agent-comms-local.js drops them), so live rows
 * render as plain notices until that is re-cut; the sample carries none
 * either because the report's schema closes the message shape. The model is
 * ready for both.
 */
export function rowModel(message, byId) {
  const map = byId instanceof Map ? byId : new Map()
  const kind = KINDS.includes(message?.kind) ? message.kind : 'notice'
  const parentId = typeof message?.causalParent === 'string' && map.has(message.causalParent) ? message.causalParent : ''
  const parent = parentId ? map.get(parentId) : null
  let noAnswer = false
  if (kind === 'ask') {
    noAnswer = true
    for (const other of map.values()) {
      if (other?.kind === 'answer' && other.causalParent === message.id) { noAnswer = false; break }
    }
  }
  return Object.freeze({
    id: String(message?.id ?? ''),
    sender: String(message?.sender ?? ''),
    recipient: typeof message?.recipient === 'string' && message.recipient ? message.recipient : '',
    kind,
    tag: KIND_TAGS[kind] || '',
    parentId,
    replyTo: parent ? replyingTo(String(parent.sender ?? '')) : '',
    noAnswer,
    machine: typeof message?.senderMachine === 'string' && message.senderMachine ? message.senderMachine : '',
    at: Number.isFinite(Date.parse(message?.at)) ? Date.parse(message.at) : 0,
    text: String(message?.text ?? ''),
  })
}

/* ---------------------------------------------------------------- days -- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dayStart = (ms) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() }

/** "Today" / "Yesterday" / "21 Aug", measured on the reader's local calendar. */
export function dayLabel(at, now = Date.now()) {
  const days = Math.round((dayStart(now) - dayStart(at)) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  const d = new Date(at)
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`
}

/** Same local calendar day? The log draws a divider where this flips. */
export function sameDay(a, b) {
  return dayStart(a) === dayStart(b)
}
