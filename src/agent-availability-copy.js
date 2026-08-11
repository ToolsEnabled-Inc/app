/* What the agent page says when a start is refused, one sentence per code.
 *
 * WHY THIS IS ITS OWN MODULE. The shell answers availability with {ok, code}
 * and nothing else: the main-process message names the missing module AND the
 * manifest that should have staged it -- which is exactly the right diagnosis
 * -- but it also names an absolute engine root, and rendering a filesystem path
 * into the DOM is the defect (BLOCKER 2) that removed the message from this
 * path in the first place. So the CODE carries the message's surviving
 * specificity, and this table is where that specificity is spent. A generic
 * "not set up to run agents" beside a disabled control would give a person
 * nothing to do, which is only marginally better than the enabled control it
 * replaced.
 *
 * It is separated from src/agent-session.js so the suite can assert the
 * SENTENCE a code produces rather than that a source file contains a string: a
 * copy test written against source text passes when the table is right and the
 * lookup is wrong, which is the same shape of defect as an availability check
 * nothing reads. src/agent-session.js reaches the DOM through components.js,
 * whose module graph starts the demonstration simulator's timers on import and
 * never lets a plain-node test process exit -- so importing it from a test is
 * not available, and asserting on its text is what a test would fall back to.
 *
 * shell/agent-host.cjs exports AVAILABILITY_CODES; the suite walks that list
 * against this table, so a precondition added to the probe cannot land here as
 * silence.
 */

/* The two commands that clear the two blockers a person can actually clear,
   written once so the disabled control, the home screen and the setup screen
   cannot drift into giving three different instructions.

   BOTH WERE RUN BEFORE THEY WERE WRITTEN DOWN. `winget install OpenAI.Codex`
   resolves to Codex CLI 0.146.1, publisher "OpenAI, Inc.", a portable-zip
   installer -- which matters more than it looks: winget ships with Windows and
   needs NO Node, so it is the only one of the two a genuinely bare machine can
   follow. The npm form is kept as the second line because a machine that
   already has Node has usually already got npm's global bin on PATH, and
   because it is the layout the engine's own resolver prefers
   (%APPDATA%\npm\node_modules\@openai\codex). `codex login` and `codex login
   status` are both real subcommands of that binary, checked with --help rather
   than assumed.

   THE ORDER IS NOT COSMETIC. `codex login` is a subcommand of the program the
   first line installs, so these can only ever be followed in this order; see
   codexCommandIsMissing() in shell/agent-host.cjs, which reports them in that
   order for the same reason. */
export const CODEX_SETUP_COMMANDS = Object.freeze({
  install: 'winget install OpenAI.Codex',
  installWithNode: 'npm install -g @openai/codex',
  signIn: 'codex login',
})

export const UNAVAILABLE_TEXT = Object.freeze({
  AGENT_ENGINE_UNAVAILABLE: 'no agent engine is configured on this installation',
  /* THE BLOCKER A STRANGER ACTUALLY HITS, and for one release the product did
     not even detect it -- it reported ready, enabled Start, and refused every
     press with a bare identifier. Like the sign-out below this is not a fault
     in the install, so the sentence spends its length on the command rather
     than on an apology. */
  AGENT_CODEX_CLI_NOT_INSTALLED: 'Codex is not installed on this computer, and Codex is the program that actually runs an agent; open Windows Terminal and run "winget install OpenAI.Codex" (or "npm install -g @openai/codex" if you have Node), then run "codex login"',
  AGENT_CONFINEMENT_UNAVAILABLE: 'this copy shipped without the permission-level enforcement a session needs (agent-session-confinement), so it will not start one at a level it cannot hold; reinstall ToolsEnabled from a complete build',
  /* NOT A PACKAGING FAULT, and the copy must not read like one. The install is
     complete; the assistant is signed out, and a confined level builds its
     session from that sign-in. This is the one refusal on this list the person
     in front of the screen can actually clear themselves, so it is the one that
     most needs to say what to do. It reaches this table by BOTH routes -- the
     probe returns it, and a start that gets past the probe raises the same code
     through plan.code -- which is why the press used to show the bare
     identifier here too. */
  AGENT_CONFINEMENT_SIGNED_OUT: 'Codex is installed on this computer but nobody is signed in to it, and the permission level recorded here builds each session from that sign-in; open Windows Terminal, run "codex login", then come back to this screen',
  AGENT_LAUNCH_ENVIRONMENT_UNAVAILABLE: 'this copy shipped without the protection that keeps a session off your billed API account (subscription-launch-env), so it will not start one; reinstall ToolsEnabled from a complete build',
  AGENT_HOST_INVALID_CWD: 'ToolsEnabled cannot use its own workspace folder, so an agent session has nowhere to run',
  AGENT_HOST_INVALID_ARGUMENT: 'the agent host refused the availability request',
  AGENT_HOST_CLOSED: 'the agent host is shutting down',
  MC_AGENT_INVALID_PAYLOAD: 'the agent host refused the availability request',

  /* THE OTHER HALF OF THE ANSWER. mc-agent:availability composes the recorder's
     verdict with the engine's, and a start that cannot be RECORDED does not
     happen -- so these codes reach this control exactly as often as the engine
     ones do. Until now this table had a sentence for none of them and the page
     showed the bare identifier beside a disabled button, which is the same
     unactionable refusal the engine half was just repaired for.
     shell/spawn-record.cjs exports RECORD_AVAILABILITY_CODES; the suite walks
     it against this table. */
  SPAWN_RECORD_NO_KEYSTORE: 'this copy cannot reach the Windows keystore that protects the record of what runs here, and a start that cannot be recorded does not happen',
  SPAWN_RECORD_NO_DIRECTORY: 'ToolsEnabled has nowhere to keep its record of what runs here, and a start that cannot be recorded does not happen',
  SPAWN_RECORD_KEYSTORE_UNAVAILABLE: 'Windows will not let ToolsEnabled protect its record of what runs here, so it will not start an agent',
  SPAWN_RECORD_KEY_UNREADABLE: 'the key that signs the record of what runs here cannot be opened, so ToolsEnabled will not add to it',
  SPAWN_RECORD_LEDGER_CORRUPT: 'the record of what has run here does not read back as a record, so ToolsEnabled will not append to it until that is resolved',
  SPAWN_RECORD_UNAVAILABLE: 'the record of what runs here cannot be opened, and a start that cannot be recorded does not happen',

  /* THE THIRD HALF OF THE ANSWER, and the one that reached a customer as a bare
     `AGENT_SESSION_FAILED`.

     These are raised by confinedSessionPlan() at START time, not by the
     availability probe, because building a confined session's home is not a read
     -- it mkdirs the isolated assistant home, links the Codex credential into it
     and writes config.toml -- and availability must start nothing. So a level
     that confines (guided, standard) can pass every readiness check and still
     refuse on the press, and until now this table had a sentence for none of it.

     MEASURED, isolated to one variable: with no Codex sign-in under USERPROFILE,
     availability answered {ok:true, AGENT_ENGINE_READY}, Start rendered ENABLED,
     and the press refused with a message that never mentioned signing in. That is
     the refusal in the owner's screenshot. Each sentence below therefore names
     the ACTION, not the fault: "sign in" and "choose a folder" are things a
     person can go and do, where "confinement could not be prepared" is not.

     AGENT_CONFINEMENT_SIGNED_OUT IS DELIBERATELY NOT REPEATED HERE. It is the
     one code on this list the availability probe now answers directly
     (engineAvailability -> confinedSessionIsSignedOut), so it has a sentence
     above, beside the other codes that disable the control rather than explain a
     press. A second entry here would not be a second opinion -- a duplicate key
     in an object literal silently wins on source order, so the later one would
     have replaced the earlier one and whichever lane edited last would own the
     copy without either noticing. */
  AGENT_CONFINEMENT_RECORD_ABSENT: 'this computer has not been set up yet, so a session would run at the most restrictive level; open Settings and choose a permission level',
  AGENT_CONFINEMENT_RECORD_UNREADABLE: 'the permission level recorded on this computer cannot be read, and ToolsEnabled will not start a session at a level it cannot confirm; re-choose the level in Settings',
  AGENT_CONFINEMENT_TIER_REFUSED: 'the permission level recorded on this computer is not one this copy recognises, so no session can be started under it; re-choose the level in Settings',
  AGENT_CONFINEMENT_TIER_UNMAPPED: 'the permission level recorded on this computer has no session rules in this copy, so it will not start one; re-choose the level in Settings',
  AGENT_CONFINEMENT_HOME_UNAVAILABLE: 'the protected home your permission level runs an assistant in could not be prepared, so no session was started',
  AGENT_CONFINEMENT_HOME_UNWRITABLE: 'a folder name on this computer contains a character ToolsEnabled will not write into an assistant configuration, so it will not start a session it cannot confine',
  AGENT_CONFINEMENT_NOT_ISOLATED: 'this session was prepared for a permission level that does not match the one recorded here, so it was not started',
  SETUP_MACHINE_RECORD_INVALID: 'the setup recorded on this computer is incomplete, so the tools your level allows cannot be worked out; run through Settings again',
  SETUP_NODE_NOT_FOUND: 'the program ToolsEnabled recorded for running its tools is no longer on this computer; run through Settings again',
  SETUP_TIER_PROFILE_EMPTY: 'the set of tools allowed at your permission level worked out to nothing at all, which would be read as no limit, so no session was started',
  SETUP_TIER_PROFILE_UNAVAILABLE: 'the set of tools allowed at your permission level could not be worked out on this computer, so ToolsEnabled will not start a session that only claims to be limited',
  SETUP_READ_ONLY_PROFILE_EMPTY: 'the read-only assistant profile worked out to nothing at all, which would be read as no limit, so no session was started',

  /* THE FOURTH HALF, raised by the ENGINE rather than by this shell, and the
     residual the availability probe deliberately does not cover.

     codexCommandIsMissing() answers PRESENCE without spawning anything, because
     a probe that runs on every home mount must not start a child process. So a
     `codex` that resolves on PATH but cannot execute -- a broken install, a
     shim pointing at a Node that was uninstalled, a half-extracted portable zip
     -- passes readiness and fails on the press. These are the codes that press
     raises, from detectCodexVersion() in the payload's codex-process.js, and
     they are the reason that residual is a worse SENTENCE rather than a bare
     identifier.

     CODEX_CLI_NOT_FOUND is here as well as its probe-time twin above because
     the engine can still reach it: the session spawns with a scrubbed
     environment, so a PATH this shell can read is not proof of a PATH the child
     gets. Same fault, two vantage points, one instruction. */
  CODEX_CLI_NOT_FOUND: 'the Codex program could not be found when the session tried to start it; open Windows Terminal and run "winget install OpenAI.Codex" (or "npm install -g @openai/codex" if you have Node), then run "codex login"',
  CODEX_VERSION_DETECTION_FAILED: 'Codex is installed on this computer but did not answer when asked its version, so ToolsEnabled will not build a session on it; run "codex --version" in Windows Terminal to see what it reports, and "codex doctor" if that does not explain it',

  /* THE LAST RESORT, WHICH IS NOT MEANT TO BE REACHED and until now was reached
     by EVERY refusal. src/agent-session.js falls back to this identifier when a
     rejected start carries no code it recognises; the boundary that dropped the
     code has been repaired (rendererSafeAgentError in shell/main.cjs), so this
     should now mean what it says rather than standing in for all of the above.
     It gets a sentence anyway, because the one thing this table must never do
     again is put a bare constant in front of a person. */
  AGENT_SESSION_FAILED: 'the session did not start and this copy could not work out why, which is itself a fault worth reporting; try once more, and if it repeats, reinstall ToolsEnabled from a complete build',
})

/* An unknown code is shown verbatim -- codes are short, fixed identifiers,
   never paths. It is a copy gap, not a reason to enable anything: the caller
   branches on `ok`, never on whether this returned a sentence. */
export function unavailableReason(code) {
  return UNAVAILABLE_TEXT[code] || String(code || 'unavailable')
}

/* Recover the code from a rejected IPC call, because the property does not
 * survive the trip.
 *
 * THE BUG THIS EXISTS FOR IS NOT A COPY BUG. Electron rebuilds a rejected
 * invoke() in the renderer from the error's name, message and stack; own
 * properties are not carried, so `error.code` is undefined for every refusal
 * that crosses the boundary. The caller's `typeof error?.code === 'string'`
 * test therefore never passed and every single refusal rendered as
 * AGENT_SESSION_FAILED -- which is why the sentences above appeared to be
 * missing when in fact they were unreachable. shell/main.cjs now replaces the
 * error with one whose MESSAGE is the code (and drops the original text, which
 * is the part that could name a path), and this reads it back.
 *
 * IT RETURNS A KEY OF THIS TABLE OR NOTHING, and that is what makes reading a
 * message safe. A candidate has to look like a code -- upper case, digits and
 * underscores only, which no Windows path can be -- AND be a key that already
 * exists here. So the worst a hostile or malformed message can achieve is to
 * name one of our own sentences; it can never get its own text on screen.
 * `error.code` is still preferred when present, so in-process callers and the
 * tests keep working unchanged. */
const CODE_SHAPED = /[A-Z][A-Z0-9_]{2,63}/g

export function refusalCode(error) {
  if (typeof error?.code === 'string' && error.code.length > 0) return error.code
  const message = typeof error?.message === 'string' ? error.message : ''
  for (const candidate of message.match(CODE_SHAPED) || []) {
    if (Object.prototype.hasOwnProperty.call(UNAVAILABLE_TEXT, candidate)) return candidate
  }
  return 'AGENT_SESSION_FAILED'
}
