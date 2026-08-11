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

export const UNAVAILABLE_TEXT = Object.freeze({
  AGENT_ENGINE_UNAVAILABLE: 'no agent engine is configured on this installation',
  AGENT_CONFINEMENT_UNAVAILABLE: 'this copy shipped without the permission-level enforcement a session needs (agent-session-confinement), so it will not start one at a level it cannot hold; reinstall Mission Control from a complete build',
  AGENT_LAUNCH_ENVIRONMENT_UNAVAILABLE: 'this copy shipped without the protection that keeps a session off your billed API account (subscription-launch-env), so it will not start one; reinstall Mission Control from a complete build',
  AGENT_HOST_INVALID_CWD: 'Mission Control cannot use its own workspace folder, so an agent session has nowhere to run',
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
  SPAWN_RECORD_NO_DIRECTORY: 'Mission Control has nowhere to keep its record of what runs here, and a start that cannot be recorded does not happen',
  SPAWN_RECORD_KEYSTORE_UNAVAILABLE: 'Windows will not let Mission Control protect its record of what runs here, so it will not start an agent',
  SPAWN_RECORD_KEY_UNREADABLE: 'the key that signs the record of what runs here cannot be opened, so Mission Control will not add to it',
  SPAWN_RECORD_LEDGER_CORRUPT: 'the record of what has run here does not read back as a record, so Mission Control will not append to it until that is resolved',
  SPAWN_RECORD_UNAVAILABLE: 'the record of what runs here cannot be opened, and a start that cannot be recorded does not happen',
})

/* An unknown code is shown verbatim -- codes are short, fixed identifiers,
   never paths. It is a copy gap, not a reason to enable anything: the caller
   branches on `ok`, never on whether this returned a sentence. */
export function unavailableReason(code) {
  return UNAVAILABLE_TEXT[code] || String(code || 'unavailable')
}
