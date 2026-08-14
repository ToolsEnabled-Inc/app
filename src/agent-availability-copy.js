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

/* One direction only: this reads the shared remedy table, and that module
   imports nothing. See the note at the head of src/refusal-copy.js for why the
   dependency is not mutual. */
import { refusalRemedy } from './refusal-copy.js'

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

/* WHICH PART OF THE BUILD IS MISSING, KEPT AS DATA RATHER THAN IN THE SENTENCE.
 *
 * Two entries in the table below used to name a module in brackets, mid-sentence,
 * to a customer: "(agent-session-confinement)" and "(subscription-launch-env)".
 * tools/test/agent-session-surface.test.mjs required them to be there, and its
 * reason was right -- the main-process message that names the missing module ALSO
 * names an absolute engine root, so it can never cross the bridge, and if the
 * name is nowhere then a support conversation about an incomplete build has
 * nothing to go on.
 *
 * The reason was right and the place was wrong. That is the same fact
 * src/refusal-copy.js established for codes: the identifier is a MACHINE FIELD,
 * carried on `data-refusal-code` where a support conversation and a driver can
 * read it, and never in the prose. This is the same rule applied to the module
 * name, and the suite now asserts both halves -- that the name is here, and that
 * it is NOT in the sentence.
 *
 * A person who cannot start an agent because their download was incomplete needs
 * to reinstall. That is the whole of what the sentence has to carry. */
export const MISSING_MODULE = Object.freeze({
  AGENT_CONFINEMENT_UNAVAILABLE: 'agent-session-confinement',
  AGENT_LAUNCH_ENVIRONMENT_UNAVAILABLE: 'subscription-launch-env',
})

export const UNAVAILABLE_TEXT = Object.freeze({
  AGENT_ENGINE_UNAVAILABLE: 'no agent engine is configured on this installation',
  /* THE BLOCKER A STRANGER ACTUALLY HITS, and for one release the product did
     not even detect it -- it reported ready, enabled Start, and refused every
     press with a bare identifier. Like the sign-out below this is not a fault
     in the install, so the sentence spends its length on the command rather
     than on an apology. */
  AGENT_CODEX_CLI_NOT_INSTALLED: 'Codex is not installed on this computer, and Codex is the program that actually runs an agent. Open Windows Terminal and run "winget install OpenAI.Codex". If you already have Node, "npm install -g @openai/codex" does the same job. Then run "codex login"',
  /* THE MODULE NAME CAME OUT OF THE SENTENCE. It read "(agent-session-confinement)"
     -- an internal file name, in brackets, in the middle of a sentence to a
     customer. It is a support detail, and the person holding the repository has
     the code; the person reading this has a reinstall to do. */
  AGENT_CONFINEMENT_UNAVAILABLE: 'this copy of ToolsEnabled was built without the part that holds a session to your permission level. It will not start one at a level it cannot hold. Reinstall ToolsEnabled from a complete build',
  /* NOT A PACKAGING FAULT, and the copy must not read like one. The install is
     complete; the assistant is signed out, and a confined level builds its
     session from that sign-in. This is the one refusal on this list the person
     in front of the screen can actually clear themselves, so it is the one that
     most needs to say what to do. It reaches this table by BOTH routes -- the
     probe returns it, and a start that gets past the probe raises the same code
     through plan.code -- which is why the press used to show the bare
     identifier here too. */
  AGENT_CONFINEMENT_SIGNED_OUT: 'Codex is installed on this computer, but nobody is signed in to it. The permission level recorded here builds each session from that sign-in. Open Windows Terminal, run "codex login", then come back to this screen',
  /* Same repair as the entry above: "(subscription-launch-env)" was a module
     name printed to a customer. The fact that matters to them is the money. */
  AGENT_LAUNCH_ENVIRONMENT_UNAVAILABLE: 'this copy of ToolsEnabled was built without the part that keeps a session off your billed account. It will not start one and risk charging you. Reinstall ToolsEnabled from a complete build',
  AGENT_HOST_INVALID_CWD: 'ToolsEnabled cannot use its own workspace folder, so an agent session has nowhere to run',
  AGENT_HOST_INVALID_ARGUMENT: 'ToolsEnabled could not work out whether an agent can run here, because the question itself was refused. Close ToolsEnabled and open it again',
  AGENT_HOST_CLOSED: 'ToolsEnabled is shutting down, so nothing new will be started. Open it again when you want to start an agent',
  MC_AGENT_INVALID_PAYLOAD: 'ToolsEnabled could not work out whether an agent can run here, because the question itself was refused. Close ToolsEnabled and open it again, and if it keeps refusing, reinstall from a complete build',
  /* Raised by the shell when a send, interrupt or close names a session this
     RUN of the app does not hold. The common way to reach it is honest and
     ordinary: a tree node saved from an earlier run still shows on the canvas,
     but the session behind it ended when ToolsEnabled closed. "Try once more"
     was the old fallback here, and retrying is the one thing that can never
     work -- the truthful move is a fresh agent. */
  MC_AGENT_UNKNOWN_SESSION: 'the session this was meant for is not open in this copy. Sessions end when ToolsEnabled closes, so nothing was delivered. Start a new agent and ask there',
  /* The two refusals the tool checkboxes can raise at a start. Both refuse
     rather than widen: a session that cannot read the limits the person
     recorded must not run without them. */
  AGENT_TOOL_LIMITS_UNREADABLE: 'the tool limits saved for this account could not be read, so no session was started at a wider surface than you chose. Open the research page settings and set the tool checkboxes again',
  AGENT_TOOLS_ALL_DISABLED: 'every tool is switched off for this account, and an agent with no tools cannot do anything. Switch at least one tool on in the research page settings, then start again',
  /* The three Claude rows in the tier menu are offered so a person can see
     they exist, and refused honestly when picked -- silently starting Codex
     instead of a chosen Claude model is the defect this code closed. The
     sentence names what to pick instead, never a module or a path. */
  AGENT_TIER_NO_LAUNCHER: 'this version can only start Codex agents from the tree, so that agent type was not started. Pick Luna, Terra or Sol and it will start now',

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
  AGENT_CONFINEMENT_RECORD_UNREADABLE: 'the permission level recorded on this computer cannot be read. ToolsEnabled will not start a session at a level it cannot confirm. Choose the level again in Settings',
  AGENT_CONFINEMENT_TIER_REFUSED: 'the permission level recorded on this computer is not one this copy recognises. No session can be started under it. Choose the level again in Settings',
  AGENT_CONFINEMENT_TIER_UNMAPPED: 'the permission level recorded on this computer has no session rules in this copy, so it will not start one; re-choose the level in Settings',
  AGENT_CONFINEMENT_HOME_UNAVAILABLE: 'the protected home your permission level runs an assistant in could not be prepared, so no session was started',
  AGENT_CONFINEMENT_HOME_UNWRITABLE: 'a folder name on this computer contains a character ToolsEnabled will not write into an assistant configuration. It will not start a session it cannot hold to your permission level. Choose a different folder in Settings',
  AGENT_CONFINEMENT_NOT_ISOLATED: 'this session was prepared for a permission level that does not match the one recorded here, so it was not started',
  SETUP_MACHINE_RECORD_INVALID: 'the setup recorded on this computer is incomplete, so the tools your level allows cannot be worked out; run through Settings again',
  SETUP_NODE_NOT_FOUND: 'the program ToolsEnabled recorded for running its tools is no longer on this computer; run through Settings again',
  SETUP_TIER_PROFILE_EMPTY: 'the set of tools allowed at your permission level worked out to nothing at all, which would be read as no limit. No session was started. Choose the level again in Settings',
  SETUP_TIER_PROFILE_UNAVAILABLE: 'the set of tools allowed at your permission level could not be worked out on this computer. ToolsEnabled will not start a session that only claims to be limited. Choose the level again in Settings',
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
  CODEX_CLI_NOT_FOUND: 'the Codex program could not be found when the session tried to start it. Open Windows Terminal and run "winget install OpenAI.Codex". If you already have Node, "npm install -g @openai/codex" does the same job. Then run "codex login"',
  CODEX_VERSION_DETECTION_FAILED: 'Codex is installed on this computer but did not answer when asked its version, so ToolsEnabled will not build a session on it. Run "codex --version" in Windows Terminal to see what it reports. If that does not explain it, run "codex doctor"',

  /* THE LAST RESORT, WHICH IS NOT MEANT TO BE REACHED and until now was reached
     by EVERY refusal. src/agent-session.js falls back to this identifier when a
     rejected start carries no code it recognises; the boundary that dropped the
     code has been repaired (rendererSafeAgentError in shell/main.cjs), so this
     should now mean what it says rather than standing in for all of the above.
     It gets a sentence anyway, because the one thing this table must never do
     again is put a bare constant in front of a person. */
  AGENT_SESSION_FAILED: 'the session did not start and this copy could not work out why, which is itself a fault worth reporting. Try once more. If it happens again, reinstall ToolsEnabled from a complete build',

  /* THE FIFTH HALF: THE THREE STEERING CONTROLS, which refuse in their own
     vocabulary and had a sentence for none of it.
     [B6]
     Every code below is raised by control.pause / control.respawn /
     control.terminate in src/agent-session.js, and src/views/agent.js renders
     that refusal as `${id} did not happen · ${result?.code}` -- the bare
     identifier, on the same page and beside the same session the Start control
     was repaired for. Two of them (AGENT_TURN_NONE, AGENT_SESSION_UNKNOWN) are
     not faults at all: they mean the button was pressed for something that had
     already stopped, so those sentences say that rather than apologising.
     The rest are raised by shell/agent-host.cjs and are classified start-only
     in tools/test/agent-session-surface.test.mjs -- start-only means the
     readiness probe cannot resolve them, NOT that nobody reads them.

     They are here rather than in src/refusal-copy.js because refusalCode()
     below recovers a code from a rejected IPC message by testing membership of
     THIS table: a session code with its sentence in another module would be
     rejected as unrecognised and fall back to AGENT_SESSION_FAILED, which is
     the exact bug the note above this table describes. */
  AGENT_TURN_NONE: 'there was nothing running to stop -- the session is open and idle, so a prompt is what it is waiting for',
  AGENT_TURN_ACTIVE: 'this session is already working on a turn; stop that one first, or wait for it to finish',
  AGENT_SESSION_UNKNOWN: 'there is no open session on this screen to act on, so nothing was changed; start one first',
  AGENT_SESSION_EXISTS: 'a session for this agent is already open, so a second was not started; use the one that is running or stop it first',
  AGENT_SESSION_NOT_READY: 'this screen is not in a state where that can be done. Either a session is already open, or this copy is not ready to start one. Reload the page and read what it says before pressing it again',
  AGENT_SESSION_NO_PROMPT: 'nothing was sent because there was nothing to send; type what you want the agent to do and start it again',
  AGENT_SESSION_NO_ID: 'this copy could not generate the secure identifier a session is tracked by, so none was started; close ToolsEnabled and open it again',
  AGENT_SESSION_VIEW_CLOSED: 'this screen was closed while that was in flight, so it was not completed; nothing is running from it',
  AGENT_SESSION_START_CANCELLED: 'the start was called off before the session opened, so nothing is running; start it again when you are ready',
  AGENT_ENGINE_INVALID_SESSION: 'the session this screen was acting on is no longer one the agent engine knows about, so nothing was changed. Reload the page and start again',
  AGENT_ENGINE_INVALID_TURN: 'the piece of work this was acting on is no longer one the agent engine knows about, so nothing was changed. Reload the page and look at what the session is doing',
})

/* THE ONE DOOR THIS MODULE LEFT OPEN, AND B6 CLOSED IT.
 *
 * This used to end `|| String(code || 'unavailable')`: an unknown code was
 * shown VERBATIM, defended on the grounds that codes are short identifiers and
 * never paths. Both halves of that are true and neither is the point. The
 * reason a bare code must not be shown is not that it might be a path, it is
 * that it tells the person nothing and gives them nothing to do -- so a table
 * that answers "the code you have no sentence for" by printing the code is
 * exactly the defect it exists to prevent, kept alive at the one place it is
 * hardest to notice.
 *
 * It is reachable in the shipped product. src/agent-session.js builds
 * `{ ok: false, code: error?.code }` from a rejected availability call, and a
 * platform rejection can carry a `code` of its own (ERR_IPC_CHANNEL_CLOSED and
 * friends) that is in no table here.
 *
 * The code still goes UNSHOWN rather than unused -- callers keep it on the
 * state object -- and an unrecognised one now leaves with the same kind of
 * sentence a recognised one does. It is a copy gap either way, and still not a
 * reason to enable anything: the caller branches on `ok`, never on whether this
 * returned a sentence. */
export function unavailableReason(code) {
  if (Object.prototype.hasOwnProperty.call(UNAVAILABLE_TEXT, code)) return UNAVAILABLE_TEXT[code]
  return `this copy could not work out why, which is itself a fault worth reporting. ${refusalRemedy(code)}`
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
