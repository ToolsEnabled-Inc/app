// Slash commands for the agent console — client-side sugar over actions that
// already exist. The parser maps `/word` onto the SAME palette action ids the
// Actions page binds (src/views/computers.js runPaletteAction), so a command
// can never name something the buttons cannot do. Commands for capabilities
// that arrive in later phases (/model, /attach, /clear, /rewind) join HERE in
// the phase that makes each real — never before.
//
// A message that merely starts with "/" is not swallowed: only `/word` where
// word is a KNOWN command is intercepted; an unknown `/word` gets a sentence
// naming the real ones and is NOT sent (mis-typing /interupt should not send
// the typo to the agent); anything path-shaped (a second "/", a drive colon,
// or no letters) sends as ordinary text.

export const SLASH_COMMANDS = Object.freeze([
  Object.freeze({ name: 'interrupt', action: 'interrupt', help: 'stop the current turn; the agent keeps its memory' }),
  Object.freeze({ name: 'stop', action: 'stop', help: 'end this agent\'s session' }),
  Object.freeze({ name: 'queue', action: 'queue', help: 'queue the words after the command for when the agent is free' }),
  Object.freeze({ name: 'move', action: 'move', help: 'change who this agent reports to' }),
  Object.freeze({ name: 'copy', action: 'copy-reply', help: 'copy the last reply' }),
  Object.freeze({ name: 'model', action: 'switch-model', help: 'pick the model the next message runs on' }),
  Object.freeze({ name: 'attach', action: 'attach', help: 'attach an image to the next message' }),
  Object.freeze({ name: 'mention', action: 'mention', help: 'pick a file and write its path into the message' }),
  Object.freeze({ name: 'clear', action: 'clear', help: 'start this conversation over; the agent forgets everything said here' }),
  Object.freeze({ name: 'rewind', action: 'rewind', help: 'go back to one of your messages; the agent forgets everything after it' }),
])

const BY_NAME = new Map(SLASH_COMMANDS.map(command => [command.name, command]))

/* THE /REQUEST FAMILY — the owner's standing rules, typed where the person is
 * already talking. These are NOT palette actions: nothing on the Actions page
 * files a rule, so they carry a scope instead of an action id and the view
 * routes kind:'request' to the product's own filing seam. The engine's
 * r-ledger module (owner design 2026-08-15) is the ground truth for the four
 * scopes; the words after the command are the rule, verbatim.
 *
 * `word` is what the parser's lowercasing produces; `spoken` is how the
 * command is written everywhere a person reads it. */
export const REQUEST_COMMANDS = Object.freeze([
  Object.freeze({ word: 'request', spoken: '/Request', scope: 'global' }),
  Object.freeze({ word: 'requestsession', spoken: '/RequestSession', scope: 'session' }),
  Object.freeze({ word: 'requesttree', spoken: '/RequestTree', scope: 'tree' }),
  Object.freeze({ word: 'requestthread', spoken: '/RequestThread', scope: 'thread' }),
])

const REQUEST_BY_WORD = new Map(REQUEST_COMMANDS.map(command => [command.word, command]))
const REQUEST_BY_SCOPE = new Map(REQUEST_COMMANDS.map(command => [command.scope, command]))

/* WHO A FILED RULE REACHES, said the same way everywhere. The four scopes are
 * the thing a person will get wrong, so every sentence about a filed rule
 * must state its reach — a confirmation that just says "filed" teaches
 * nothing and lets a thread rule be mistaken for a global one. */
const REQUEST_SCOPE_REACH = Object.freeze({
  global: 'every agent on this computer, until you edit or delete it',
  session: 'this working session and every agent it starts',
  tree: 'this agent and every agent working under it',
  thread: 'this conversation only — every future session of it starts knowing the rule',
})

/** One sentence: nothing was filed, and how to say it so something is. */
export function requestUsageSentence(scope) {
  const command = REQUEST_BY_SCOPE.get(scope)
  const spoken = command ? command.spoken : '/Request'
  return `Nothing was filed — say the rule after the command, like ${spoken} <your words>.`
}

/** The one-sentence confirmation the chat shows after the product files a rule. */
export function requestConfirmationSentence(scope, id) {
  return `Filed ${id} — a standing rule for ${REQUEST_SCOPE_REACH[scope] || scope}.`
}

export function slashHelpSentence() {
  return `Commands here: ${SLASH_COMMANDS.map(command => `/${command.name}`).join(', ')} and /help. File a standing rule with /Request, /RequestSession, /RequestTree, or /RequestThread. Everything else sends as a message.`
}

/**
 * Parse a console input line.
 * Returns null when the text should send as an ordinary message;
 * { kind: 'action', action, rest } for a known command;
 * { kind: 'help', sentence } for /help;
 * { kind: 'unknown', sentence } for an unknown /word (NOT sent).
 */
export function parseSlashCommand(text) {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return null
  const match = /^\/([A-Za-z][A-Za-z-]*)(?:\s+([\s\S]*))?$/.exec(trimmed)
  if (!match) return null
  const word = match[1].toLowerCase()
  const rest = (match[2] || '').trim()
  if (word === 'help') return { kind: 'help', sentence: slashHelpSentence() }
  const command = BY_NAME.get(word)
  if (command) return { kind: 'action', action: command.action, rest }
  const request = REQUEST_BY_WORD.get(word)
  if (request) return { kind: 'request', scope: request.scope, rest }
  /* Path-shaped input ("/usr/bin/thing" fails the regex on the second slash
     already); a lone unknown word is most likely a typo of a command. */
  return {
    kind: 'unknown',
    sentence: `“/${word}” is not a command here, so nothing was sent. ${slashHelpSentence()}`,
  }
}
