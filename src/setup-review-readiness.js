/* CAN AN AGENT ACTUALLY START WHEN THIS PERSON PRESSES FINISH.
 *
 * THE SENTENCE THIS EXISTS TO STOP THE PRODUCT SAYING. The last screen of setup
 * read "Codex is installed on this computer and signed in, so an agent can start
 * when you finish here" on a machine with no Codex on PATH and nobody signed in
 * to it (measured on the packaged build 2026-08-16). It was not a typo: the
 * screen branched on mcAgent.availability(), which answers "can this
 * installation start ANY agent", and rendered that answer as a fact about one
 * named program. With Claude installed and Codex absent, availability says yes
 * -- correctly, deliberately (d1eb2a5) -- and the sentence flipped on whether
 * CLAUDE was there.
 *
 * The cost was not only a false sentence. It made the not-installed branch --
 * the one carrying the line a person can paste into a terminal -- unreachable
 * for precisely the people who needed it, which is every stranger this product
 * is meant for.
 *
 * TWO SOURCES, TWO QUESTIONS, AND NEITHER SPEAKS FOR THE OTHER:
 *   engine  mcAgent.availability()      can this installation start anything
 *   codex   mcProviders.presence()      is the Codex program here, and signed in
 *
 * The engine's verdict goes first and only when it is BOTH known and negative
 * for a reason that is not about Codex itself -- a build with no engine payload
 * refuses whatever is installed, and that is worth saying. Its two Codex-shaped
 * codes are deliberately left to the provider branches, which say the same
 * thing in the program's own terms and hand over the command that fixes it.
 *
 * 'unknown' IS A REAL ANSWER AND IS NEVER ROUNDED UP. Both sources can answer
 * "I could not tell", and this says so rather than printing a tick. A green
 * claim that turns out to be false is the one failure this whole screen is
 * about.
 *
 * It builds no markup and touches no DOM, so the suite drives the real decision
 * instead of matching the source of it.
 */

import { CODEX_SETUP_COMMANDS, unavailableReason } from './agent-availability-copy.js'

export const READINESS_HEADING = 'Before an agent can run'

const CODEX_CODES = new Set(['AGENT_CODEX_CLI_NOT_INSTALLED', 'AGENT_CONFINEMENT_SIGNED_OUT'])

const FINISH_LATER = 'You can finish setup first and do this afterwards. Everything you chose is still saved.'

/**
 * What the review says about starting an agent.
 *
 * @param engine  `{ known, ok, code }` from mcAgent.availability(), or null
 *                while it has not answered yet.
 * @param codex   `{ known, installed, signedIn }` from mcProviders.presence()
 *                for the codex row, or null while it has not answered yet.
 * @returns `{ tone, heading, lines }` — tone is the status block's modifier,
 *          '' for a plain statement and 'is-warn' for something left to do.
 */
export function codexReadiness({ engine = null, codex = null } = {}) {
  const block = (tone, lines) => Object.freeze({ tone, heading: READINESS_HEADING, lines: Object.freeze(lines) })

  if (engine && engine.known === true && engine.ok === false && !CODEX_CODES.has(engine.code)) {
    return block('is-warn', [`An agent cannot start on this computer yet: ${unavailableReason(engine.code)}.`])
  }
  if (codex === null) {
    return block('', ['Checking whether Codex is installed and signed in on this computer.'])
  }
  if (codex.known !== true || codex.installed === 'unknown') {
    return block('is-warn', [
      'This copy could not check whether Codex is installed here, so it will not tell you either way.',
      `Codex is the program that runs an agent. If it is not installed, run "${CODEX_SETUP_COMMANDS.install}" in Windows Terminal, then "${CODEX_SETUP_COMMANDS.signIn}" in a new terminal window.`,
    ])
  }
  if (codex.installed !== 'yes') {
    return block('is-warn', [
      'Codex is not installed on this computer. It is a separate free program from OpenAI, and it is the thing that actually runs an agent; ToolsEnabled drives it.',
      `Open Windows Terminal and run: ${CODEX_SETUP_COMMANDS.install}`,
      `If you already have Node, this works too: ${CODEX_SETUP_COMMANDS.installWithNode}`,
      /* A NEW window, or the sign-in lands in the one the install ran in,
         which cannot see the new program yet -- the first external user's
         exact dead end; src/first-run-needs.js carries the full account. */
      `Then sign in to it, in a new terminal window: ${CODEX_SETUP_COMMANDS.signIn}`,
      FINISH_LATER,
    ])
  }
  if (codex.signedIn === 'no') {
    return block('is-warn', [
      'Codex is installed on this computer, but nobody is signed in to it, and the permission level you chose builds each session from that sign-in.',
      `Open Windows Terminal and run: ${CODEX_SETUP_COMMANDS.signIn}`,
      FINISH_LATER,
    ])
  }
  if (codex.signedIn !== 'yes') {
    return block('is-warn', [
      'Codex is installed on this computer. This copy could not tell whether anybody is signed in to it, so it will not say either way.',
      `If an agent will not start, open Windows Terminal and run: ${CODEX_SETUP_COMMANDS.signIn}`,
    ])
  }
  return block('', ['Codex is installed on this computer and signed in, so an agent can start when you finish here.'])
}
