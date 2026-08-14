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
])

const BY_NAME = new Map(SLASH_COMMANDS.map(command => [command.name, command]))

export function slashHelpSentence() {
  return `Commands here: ${SLASH_COMMANDS.map(command => `/${command.name}`).join(', ')} and /help. Everything else sends as a message.`
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
  /* Path-shaped input ("/usr/bin/thing" fails the regex on the second slash
     already); a lone unknown word is most likely a typo of a command. */
  return {
    kind: 'unknown',
    sentence: `“/${word}” is not a command here, so nothing was sent. ${slashHelpSentence()}`,
  }
}
