/* WHAT A REFUSAL SAYS WHEN IT IS NOT AN AGENT-START REFUSAL.
 *
 * THE DEFECT THIS EXISTS TO CLOSE. src/agent-availability-copy.js repaired ONE
 * surface -- the agent page's Start control -- by giving every refusal code a
 * sentence that spends its length on the remedy. Every OTHER audited control in
 * this product kept the shape that repair replaced, and did it in nine places:
 *
 *     src/views/computers.js      `refused · ${result.code} · ${result.reason}`
 *     src/write-surfaces.js       `refused · ${result.code} · ${result.reason}`
 *     src/cloud-tasks-controller  `${result.code} · ${result.reason}`   (x5 lines)
 *     src/agent-loops.js          `${result.code}: ${result.reason}`
 *     src/agent-loops.js          `... was NOT confirmed stopped (${code}).`
 *     src/agent-teams.js          `${result.code}: ${result.reason}`   (lead + member)
 *     src/mission-bridge.js       `${code}: ${reason} No stop has been confirmed.`
 *     src/mission-bridge.js       `${result?.code}: ${reason} Nothing moved.` (x2)
 *     src/org-controls.js         `${fallback} (${result.code})`
 *
 * A person reading `BRIDGE_TERMINATE_STALE_PID: ...` is being handed a grep
 * term. It is worse than that on the leading-token sites, because the FIRST
 * thing the eye lands on is the one part of the line that means nothing to
 * anybody who does not have this repository open.
 *
 * TWO RULES, AND THE SECOND IS THE ONE THAT WAS MISSING EVERYWHERE.
 *
 *   1. The identifier does not appear in visible text. It is still carried --
 *      every state object below keeps its `code`, and the DOM nodes carry
 *      `data-refusal-code` -- so a support conversation and a test can still
 *      name the exact refusal. It is a machine field, not a sentence.
 *
 *   2. EVERY refusal ends with something to do. The engine's own `reason` is
 *      good English and it stays on the glass verbatim, but almost all of them
 *      are diagnoses ("The audited dependency refused the action.") and a
 *      diagnosis is not a remedy. So a remedy is always appended, chosen by the
 *      code, and when the code is one nobody wrote a sentence for it is chosen
 *      by the code's FAMILY. There is no path through this module that returns
 *      a diagnosis alone.
 *
 * WHY A FAMILY FALLBACK RATHER THAN ONE MORE BIG TABLE. The bridge's code
 * vocabulary is ~70 identifiers today (`grep -rEo "'[A-Z][A-Z0-9_]{5,}'"` over
 * the engine's src/lib/mission-bridge/) and it grows whenever the engine adds a
 * guard. A table alone fails OPEN on the next one added: the code falls through
 * to `String(code)` and a customer sees the identifier again -- which is exactly
 * how the defect this module repairs got shipped in the first place. Families
 * are closed over the PREFIX, so a code nobody has ever seen still produces a
 * whole sentence with an action in it. The curated table is for the refusals a
 * person actually reaches; the families are the floor, and the floor is what
 * makes the rule hold.
 *
 * THE ABSENCE CASE IS THE POINT, not an edge. `refusalSentence()` is given
 * `undefined`, `null`, `{}`, `{ ok: false }`, a reason that is the empty string,
 * and a reason that is ITSELF an identifier -- the last one really happens, via
 * `reason: error?.message` where the thrown error's message is a code. Each of
 * those must produce a whole sentence with a remedy in it, because "it failed
 * and we cannot say why" is precisely when a person has least to go on. This
 * codebase's signature defect is absence read as consent; here it would be
 * absence read as "say nothing", which on a refusal surface is the same
 * mistake wearing a different hat.
 *
 * It is a separate module from the surfaces for the reason the availability
 * table is: a copy test written against source text passes when the table is
 * right and the lookup is wrong. This module imports no DOM and no view, so
 * `node --test` can hold it and assert the SENTENCE a refusal produces.
 *
 * IT IMPORTS NOTHING AT ALL, and that is a decision rather than an accident.
 * The obvious shape was to read src/agent-availability-copy.js's table from
 * here so an AGENT_* code kept the agent page's own wording; but that module
 * needs refusalRemedy() for ITS unknown-code fallback (see unavailableReason
 * there), and the two importing each other is a cycle whose evaluation order
 * decides whether a frozen table is defined when the other module's top level
 * runs. It would work today and break the first time somebody moves a const.
 * So the dependency runs one way -- availability copy imports this -- and the
 * two tables stay separate: agent-start codes are translated by
 * unavailableReason(), everything else by refusalSentence(). Neither surface
 * can reach the other's codes, so nothing is lost by the split.
 */

/* An identifier as this product writes them: SCREAMING_SNAKE, at least one
   underscore, no lower case and no spaces. Used two ways -- to recognise a
   `reason` that is secretly a code (and must therefore not be shown as prose),
   and by the suites to assert that no visible string is one. Anchored, so a
   sentence that happens to quote a code is not mistaken for one. */
export const IDENTIFIER_RE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/

/** Does this whole string read as a bare identifier rather than as English? */
export function isBareIdentifier(value) {
  return typeof value === 'string' && IDENTIFIER_RE.test(value.trim())
}

/* THE LAST LINE OF DEFENCE, and the only remedy that is true of every refusal
   in the product without knowing anything about it. Reached only when a code is
   absent or matches no family, which is why it says nothing specific: a remedy
   that guessed would send somebody to a switch that has nothing to do with
   their problem. It still names an ACTION and states what did not happen, which
   is the whole contract. */
export const GENERIC_REMEDY = 'Nothing was changed by this attempt. Try it once more, and if it refuses again, close ToolsEnabled and open it a second time before deciding anything on the strength of this screen.'

/* THE ONE FACT ABOUT THIS PRODUCT'S PLUMBING A PERSON NEEDS, said once. Every
   audited control in the window talks to a background service the app starts
   for itself; when that service is not answering, every one of them refuses,
   and the cure is the same for all of them. Naming a port or a URL here would
   be the BLOCKER-2 defect (a machine detail rendered into the DOM) in its other
   costume, so this says what to DO and never where it listens. */
const RESTART_REMEDY = 'Nothing was sent. ToolsEnabled talks to a background service that starts with this window; close the whole app and open it again, and if it still refuses, reinstall from a complete build.'

/* WRITTEN FOR THE REFUSALS A PERSON ACTUALLY REACHES, not for the whole
   vocabulary. Each is one sentence that says what did not happen and then
   spends the rest of its length on what to do about it -- the pattern
   src/agent-availability-copy.js set. Where the engine's own `reason` is
   already the better half of the answer it is shown too (see composition in
   refusalSentence); these are the REMEDY half. */
export const REFUSAL_REMEDY = Object.freeze({
  /* --- the background service is not there, which is most of a clean machine's
         refusals and the reason the whole family shares one cure --- */
  BRIDGE_UNREACHABLE: RESTART_REMEDY,
  BRIDGE_DISCOVERY_UNAVAILABLE: RESTART_REMEDY,
  BRIDGE_OWN_LAYER_INVALID: RESTART_REMEDY,
  BRIDGE_OWN_LAYER_UNCONFIRMED: 'Nothing was sent, on purpose: ToolsEnabled would not hand its credentials to a service it could not confirm was its own. Close the whole app and open it again; if it keeps refusing, something else on this computer is holding the address it uses.',
  BRIDGE_BOOTSTRAP_PROOF_UNAVAILABLE: 'Nothing was sent. This page can only do audited work inside the installed ToolsEnabled application; open the installed app rather than this page in a browser.',
  BRIDGE_BOOTSTRAP_REFUSED: RESTART_REMEDY,
  BRIDGE_UNAUTHORIZED: 'Nothing was sent. The permission this window holds is no longer being accepted; close ToolsEnabled and open it again to get a fresh one.',
  BRIDGE_TOKEN_INVALID: 'Nothing was sent. The permission this window holds is no longer being accepted; close ToolsEnabled and open it again to get a fresh one.',
  BRIDGE_TIMEOUT: 'Nothing came back in time, so it is not known whether anything happened. Look at the screen this control belongs to before pressing it again — a second press could start a second one.',
  BRIDGE_REQUEST_FAILED: 'Nothing was confirmed. Try once more; if it refuses again, close ToolsEnabled and open it a second time before assuming nothing ran.',
  BRIDGE_REQUEST_REFUSED: 'Nothing was done. Check what you chose above, try once more, and if it keeps refusing leave it alone rather than pressing repeatedly.',
  BRIDGE_REFUSED: 'Nothing was done and this copy was not told why. Try once more, and if it refuses again, close ToolsEnabled and open it a second time.',

  /* --- a reply that arrived but could not be trusted. These must never read as
         "it failed", because the work may well be running; the person's next
         move is to LOOK, not to retry. --- */
  BRIDGE_DISPATCH_RECEIPT_INVALID: 'This may already be running. Do not press it again — open the fleet page and look for it first, and only start another if nothing is there.',
  BRIDGE_TERMINATE_RECEIPT_INVALID: 'Nothing has been confirmed stopped. Refresh this page and look at whether it is still running before pressing stop again.',
  BRIDGE_LEDGER_ARCHIVE_PREVIEW_INVALID: 'Nothing was moved. Ask for the preview again; nothing is retired until a preview you can read has been confirmed.',
  BRIDGE_LEDGER_ARCHIVE_RECEIPT_INVALID: 'Preview it again before any retry, and read the preview: the result did not match what was confirmed, so what moved is not known from this screen.',

  /* --- somebody, or something, is already there --- */
  AGENT_PRESENCE_ACTIVE: 'Nothing new was started, and that is the cap doing its job: this agent already has a session running. Stop the one that is running, or pick a different agent.',
  BRIDGE_AGENT_LANE_COLLISION: 'Nothing new was started, and that is the cap doing its job: this agent already has a lane running. Stop the one that is running, or pick a different agent.',
  LAUNCH_FANOUT_EXCEEDED: 'Nothing new was started. As many agents as this copy will run at once are already running; stop one before starting another.',
  /* A CAPACITY ANSWER, AND IT MUST NOT READ AS A FAULT. The engine allocates a
     free agent from the pool this level shares and refuses only when every one
     of them is carrying work. Nothing is misconfigured, nothing needs fixing,
     and the two things a person can actually do are both about the agents that
     are already running — so this is worded like the cap above it rather than
     like the declaration refusals further down, which ask them to change what
     they chose. Getting that backwards sends somebody to edit their fleet over
     a queue that would have cleared on its own. */
  BRIDGE_ALL_SEATS_BUSY: 'Nothing new was started, and nothing is wrong: every agent this copy can run at this level is already working. Wait for one of them to finish, or stop one from the fleet page, and then start this again.',
  BRIDGE_TERMINATE_IN_PROGRESS: 'A stop for this one is already on its way. Wait for it rather than sending a second.',
  BRIDGE_TERMINATE_ALREADY_TERMINAL: 'There was nothing left to stop — it had already finished. Nothing on this computer is still running from it.',
  BRIDGE_TERMINATE_NOT_ACTIVE: 'There was nothing running to stop. Refresh this page; what it was showing you is out of date.',
  BRIDGE_TERMINATE_STALE_PID: 'Nothing was stopped, because what this page thought was running is not what is running now. Refresh the page and look again before pressing stop.',
  BRIDGE_TERMINATE_STALE_RUN: 'Nothing was stopped, because what this page thought was running is not what is running now. Refresh the page and look again before pressing stop.',

  /* --- refusals that are the product protecting its own record. Each is a
         deliberate stop, so none of them apologises. --- */
  BRIDGE_AUDIT_UNAVAILABLE: 'Nothing was done, deliberately: ToolsEnabled will not take an action it cannot write down. Close the app and open it again, and if it keeps refusing, the record on this computer needs attention before anything else here will work.',
  BRIDGE_GUARD_REFUSED: 'Nothing was done. A rule set on this computer refused it, and the sentence above is that rule speaking — change what you asked for, because nothing else will clear it.',
  BRIDGE_ACTOR_REFUSED: 'Nothing was done. The agent this window is acting as is not the one allowed to do it; pick a different agent, or change which one is in charge from the fleet page.',
  BRIDGE_LEDGER_ARCHIVE_CONFIRMATION_REQUIRED: 'Nothing was moved. Ask for a fresh preview and confirm that, rather than confirming one that has been sitting on screen.',

  /* --- the request itself was wrong, which is the one family where the person
         really can fix it in the box in front of them --- */
  BRIDGE_INPUT_INVALID: 'Nothing was sent. Correct what you typed above and try again.',
  BRIDGE_INPUT_TOO_LARGE: 'Nothing was sent because what you typed is too long. Shorten it and try again.',
  BRIDGE_TARGET_MALFORMED: 'Nothing was sent. Choose the target again from the list rather than typing it.',
  BRIDGE_TIER_REFUSED: 'Nothing was started. Choose one of the agent levels offered in the list above.',
  BRIDGE_ROOT_UNAVAILABLE: 'Nothing was started. The folder this work would run in is not reachable from this computer; pick another from the list.',
  BRIDGE_REPORT_NOT_FOUND: 'Nothing was read, because there is no such report. Check the file name above; only Markdown reports inside a declared folder can be opened here.',
  BRIDGE_REPORT_PATH_REFUSED: 'Nothing was read. Only Markdown reports inside a declared folder can be opened here — a path that points anywhere else is refused on purpose.',

  /* --- Codex Cloud. Money and a remote service, so the reassurance about spend
         comes first and is stated even when the refusal is trivial. --- */
  CLOUD_LAUNCH_SWITCHED_OFF: 'Nothing was launched and nothing was spent. Launching on Codex Cloud is switched off in Settings; turn it on there first.',
  BRIDGE_CLOUD_LAUNCH_DENIED: 'Nothing was launched and nothing was spent, because the approval this launch needed was not given. Open the approvals screen and answer it there, then launch again.',
  BRIDGE_CLOUD_LAUNCH_UNCONFIRMED: 'It is not known whether this launched, so do not press it again yet: open Codex Cloud and look for the task there first.',
  BRIDGE_CLOUD_ENVIRONMENT_NOT_AUTHORIZED: 'Nothing was launched and nothing was spent. The environment chosen above is not one this copy is allowed to launch into; pick another.',
  BRIDGE_CLOUD_REPOSITORY_MISMATCH: 'Nothing was launched and nothing was spent. The environment chosen above belongs to a different repository than the work does; pick the one that matches.',
  BRIDGE_CLOUD_BINDING_UNVERIFIED: 'Nothing was launched and nothing was spent, because this copy could not confirm which cloud account the work would be billed to and it will not guess. Choose the account and environment explicitly above, then try again.',
  /* THESE TWO WERE FOUND BY DRIVING, NOT BY READING. tools/refusal-copy-qa.mjs
     presses the fleet page's Dispatch and the cloud panel's Refresh on a
     sterile profile, and these are the codes that actually come back on a clean
     machine -- neither appears in any list of codes in this repository. Without
     an entry they fell to GENERIC_REMEDY, which is a whole sentence and still
     the wrong advice: "try once more" is useless when what is missing is an
     account registry that no retry will create.

     The engine's own message for ACCOUNTS_REGISTRY_MISSING names the file's
     absolute path. It does NOT reach the glass -- the bridge's typedError()
     replaces the message with "The audited dependency refused the action." and
     keeps only the code -- and this entry must not put it back. */
  ACCOUNTS_REGISTRY_MISSING: 'Nothing was read and nothing was spent: this computer has no list of Codex Cloud accounts, so there is nothing to launch into. Sign in to Codex Cloud on this machine first, then come back to this panel.',
  BRIDGE_AGENT_DECLARATION_MISSING: 'Nothing was started. The engine and effort chosen above is not one this copy has an agent declared for; choose a different one from the list.',

  /* --- REFUSALS FROM THE LAUNCH RECORD, which is the gate a dispatch reaches
         AFTER the bridge has resolved which agent to use.
   *
   * WHY THESE ARE HERE NOW. This table curated exactly one of them, and the
   * other twenty-odd fell through every family to the generic remedy — which
   * tells a stranger to close and reopen the application. Not one of these
   * refusals is cured by restarting anything: each is the product declining to
   * start a particular agent for a stated reason, and the person's next move is
   * to choose differently or to change what their own fleet allows. Advice that
   * confident and that wrong is worse than none, because the reader does it,
   * loses their window, and arrives back at the same refusal.
   *
   * They were unreachable on a customer's machine while the shipped default
   * organisation declared a controller and nothing else: every dispatch died one
   * step earlier, before any of these gates could speak. Now that a fresh
   * install ships agents these become live refusals on real installations.
   *
   * NONE OF THEM NAMES THE AGENT. The engine's own messages do — "Agent
   * \"claude-3\" is disabled in the declared org" — but that text never reaches
   * the glass: the bridge replaces it with a generic diagnosis and keeps only
   * the code. These sentences must not put it back, so each says "the agent
   * chosen above", which is what the person is looking at anyway. --- */
  LAUNCH_DISABLED_AGENT: 'Nothing was started. The agent this would have used is switched off in this copy\'s own list of agents; turn it back on from the fleet page, or choose a different agent here.',
  LAUNCH_UNKNOWN_AGENT: 'Nothing was started, because this copy has no agent by the name this screen asked for — usually because the list on screen is older than the one on this computer. Reload the page and choose again.',
  LAUNCH_PHASE_REJECTED: 'Nothing was started. The agent chosen above is not allowed to take this piece of work; pick a different agent, or change what that one may work on from the fleet page.',
  LAUNCH_SCOPE_ACTIVATION_REQUIRED: 'Nothing was started. This agent is deliberately kept switched off and can only be turned on by a specific written permission, which nothing on this screen can give it; choose a different agent.',
  LAUNCH_SCOPE_PROVENANCE_REQUIRED: 'Nothing was started. This agent is deliberately kept switched off and can only be turned on by a specific written permission, which nothing on this screen can give it; choose a different agent.',

  /* --- the declared organisation --- */
  /* The diagnosis this pairs with (ORG_ABSENT_REASON in src/org-controls.js)
     already names the installed app, so repeating it here would say the same
     thing twice in one breath. What it does not say is the consequence, which
     is the half a person needs before they go looking for a switch. */
  ORG_BRIDGE_ABSENT: 'Nothing has been changed by this attempt, and nothing on this page can be changed until you open it there.',
  ORG_READ_FAILED: 'Nothing was changed. Reload this page; if the hierarchy still will not open, the organisation file on this computer needs attention.',
  ORG_READ_THREW: 'Nothing was changed. Reload this page; if the hierarchy still will not open, the organisation file on this computer needs attention.',
  AGENT_ORG_STORE_REVISION_CONFLICT: 'Nothing was changed. Another window changed the organisation first — this page has re-read it, so look at the current hierarchy and make the change again.',

  /* --- "you would have to be subscribed for this", and the one family whose
         remedy the generic floor got actively WRONG ---
   *
   * Measured before this block existed: every one of these codes fell through
   * to GENERIC_REMEDY, so a person who was refused because they are not
   * subscribed was told to try again and then to close and reopen the
   * application. They can do that all day. Restarting is not merely unhelpful
   * here, it is confident advice pointing away from the only thing that would
   * work, on the refusal that is the product's own best moment to say what a
   * subscription is for.
   *
   * EACH ONE NAMES THE PAGE, and none of them is a link. Every surface that
   * renders a refusal puts these sentences in as TEXT -- refusalSentence()
   * returns a string and the nine call sites assign it to textContent -- so an
   * anchor written here would reach a person as visible markup. The page is
   * named in words instead, and it is genuinely reachable in two presses now
   * that the account screen and the home screen both offer a door to it; before
   * this lane there was nowhere to send anybody, which is the other half of why
   * these entries did not exist.
   *
   * NONE OF THEM SAYS THE PERSON HAS LOST ANYTHING. What a subscription buys is
   * the hosted side of the product, and an install that has paid nothing is a
   * complete, supported, permanent state (the engine's UNLICENSED_INSTALL). A
   * remedy that read as "you are locked out until you pay" would contradict the
   * page it is sending them to. */
  ENTITLEMENT_REQUIRED: 'Nothing was started and nothing was charged. This part runs on our computers rather than yours, and that part is what a subscription pays for; the rest of the product is unaffected. Open the account screen to read what the plans are and what each one costs.',
  ENTITLEMENT_TIER_INSUFFICIENT: 'Nothing was started and nothing was charged. This is included in a different plan from the one this computer has. Open the account screen to read what each plan includes before changing anything.',
  ENTITLEMENT_EXPIRED: 'Nothing was started and nothing was charged. The subscription this computer was using has ended, and none of your own work or settings were touched by that. Open the account screen to look at the plans again.',
  ENTITLEMENT_INACTIVE: 'Nothing was started and nothing was charged. The subscription on this computer is not currently active, and nothing of yours was removed with it. Open the account screen to look at the plans again.',
  ENTITLEMENT_REVOKED: 'Nothing was started and nothing was charged. The subscription this computer was using is no longer valid. Open the account screen to look at the plans, and get in touch if that is not what you expected.',
  ENTITLEMENT_LICENSE_KEY_INVALID: 'Nothing was started and nothing was charged. The key this computer was given is not one that can be read. Check that it was pasted whole, and if it still refuses, get in touch rather than paying for a second one.',
})

/* THE FLOOR. Every code that reaches here without a curated sentence still
   leaves with one, chosen by prefix and ordered most-specific-first because
   `BRIDGE_TERMINATE_` and `BRIDGE_CLOUD_` are both `BRIDGE_`. A code that
   matches nothing at all gets GENERIC_REMEDY, which is still a whole sentence
   with an action in it. This array is the reason a code added to the engine
   next month cannot reach a customer as a bare identifier. */
const FAMILY_REMEDY = Object.freeze([
  /* THE PAID SURFACES, whose whole namespaces are about something a
     subscription pays for, so one sentence is true of every code in them --
     including the ones that mean "we could not confirm what you have paid for"
     rather than "you have not paid". Both leave a person in the same place with
     the same next move, and neither is cured by restarting the application,
     which is what the generic floor was telling them. */
  Object.freeze([/^(HOSTED_RELAY_ENTITLEMENT_|PAID_SURFACE_ENTITLEMENT_|ANYWHERE_TRANSPORT_ENTITLEMENT_)/,
    'Nothing was started and nothing was charged. This part runs on our computers rather than yours. That is the part a subscription pays for. Everything that runs on this computer is unaffected. Open the account screen to read the plans and what each one costs.']),
  Object.freeze([/^BRIDGE_TERMINATE_/, 'Nothing has been confirmed stopped. Refresh this page and look at whether it is still running before pressing stop again.']),
  Object.freeze([/^BRIDGE_CLOUD_/, 'Nothing was launched and nothing was spent. Check the account and environment chosen above, then try again.']),
  Object.freeze([/^BRIDGE_AGENT_/, 'Nothing was started. Check the folder and the agent chosen above, then try once more; if it refuses again, look at the fleet page before starting anything else.']),
  /* THE FLOOR UNDER THE LAUNCH RECORD, and the one this table most needed. Its
     vocabulary is over twenty codes — the widest single family the engine has —
     and every one of them means the same thing to a person: this particular
     agent was not started, and no amount of restarting the application will
     change that. So the floor sends them to the two places that CAN change it,
     the choice in front of them and the fleet page, rather than to the restart
     the generic remedy would have offered. */
  Object.freeze([/^LAUNCH_/, 'Nothing was started, and nothing else was changed. Check the agent and the level chosen above and try once more; if it refuses again, open the fleet page and look at what is already running before starting anything else.']),
  Object.freeze([/^BRIDGE_LEDGER_/, 'Nothing was moved. Ask for a fresh preview and read it before confirming anything.']),
  Object.freeze([/^BRIDGE_(BOOTSTRAP|TOKEN|ORIGIN|PORT|BIND|RUNTIME|SETTINGS|DEPENDENCY)_/, RESTART_REMEDY]),
  Object.freeze([/^BRIDGE_(INPUT|BODY|JSON|CONTENT_TYPE|ROUTE)_/, 'Nothing was sent. Correct what you typed above and try again.']),
  Object.freeze([/^BRIDGE_/, 'Nothing was done. Try once more, and if it refuses again, close ToolsEnabled and open it a second time before assuming anything ran.']),
  Object.freeze([/^(AGENT_ORG_|ORG_)/, 'Nothing was changed. Reload this page and look at the current hierarchy before making the change again.']),
  Object.freeze([/^(CLOUD_|CODEX_CLOUD_)/, 'Nothing was launched and nothing was spent. Check the account and environment chosen above, then try again.']),
  Object.freeze([/^LOOP_/, 'Nothing further was started. Look at the fleet page to see what is already running before starting more.']),
  Object.freeze([/^(AGENT_|SETUP_|CODEX_)/, 'Nothing was started. Open the agent page to see what this copy needs before trying again.']),
  Object.freeze([/^(MC_ACCOUNT_|ACCOUNT_)/, 'Nothing was recorded. Open Settings, check who is signed in on this computer, then come back to this page.']),
])

/**
 * The remedy half of a refusal: what to do about it, always a whole sentence.
 *
 * Never returns an empty string and never returns the code. An unknown or
 * absent code lands on GENERIC_REMEDY rather than on nothing, because the
 * caller composes this into a sentence and a blank half would produce copy that
 * trails off mid-thought.
 */
export function refusalRemedy(code) {
  const key = typeof code === 'string' ? code.trim() : ''
  if (key && Object.prototype.hasOwnProperty.call(REFUSAL_REMEDY, key)) return REFUSAL_REMEDY[key]
  if (key) {
    for (const [pattern, remedy] of FAMILY_REMEDY) {
      if (pattern.test(key)) return remedy
    }
  }
  return GENERIC_REMEDY
}

/* Pull a code out of a refusal without inventing one. A non-string, an empty
   string, or something that is not shaped like one of this product's
   identifiers is ABSENT, not a code -- otherwise a stray sentence in `.code`
   would be looked up as a key, miss, and be shown as prose. */
export function refusalCodeOf(result) {
  const value = result && typeof result === 'object' && typeof result.code === 'string' ? result.code.trim() : ''
  return IDENTIFIER_RE.test(value) ? value : null
}

/* Pull the DIAGNOSIS out of a refusal, and only if it reads as English.
 *
 * Two things are rejected here and both of them really occur. A `reason` that
 * is itself an identifier arrives through `reason: error?.message` when the
 * thrown error's message is a code -- showing it would put the bare identifier
 * back on the glass through the one door this module left open. A `reason` with
 * no lower-case letter at all is the same problem in a different shape.
 * Everything else is the engine's own English and is shown verbatim: it is the
 * product's honest report of what it looked for. */
function diagnosisOf(result) {
  const value = result && typeof result === 'object' && typeof result.reason === 'string' ? result.reason.trim() : ''
  if (value.length === 0) return null
  if (isBareIdentifier(value)) return null
  if (!/[a-z]/.test(value)) return null
  return value
}

/* Join a diagnosis to a remedy as prose rather than by concatenation, so a
   diagnosis that already ends in a full stop does not get a second one and one
   that ends in no punctuation at all still reads as a sentence. */
function joinSentences(...parts) {
  return parts
    .map(part => (typeof part === 'string' ? part.trim() : ''))
    .filter(part => part.length > 0)
    .map(part => (/[.!?…]$/.test(part) ? part : `${part}.`))
    .join(' ')
}

/**
 * THE ONE FUNCTION EVERY REFUSING SURFACE CALLS.
 *
 * Composition, in order:
 *   diagnosis (the engine's English, verbatim, when there is any)
 *   + remedy   (always, chosen by code, then by family, then generic)
 *
 * `fallback` is what to say when the engine gave no readable diagnosis at all.
 * Callers pass the one sentence only they know -- "The dispatch was refused
 * with no receipt", "The preview receipt was incomplete" -- and it takes the
 * diagnosis slot. With neither a diagnosis nor a fallback the remedy stands
 * alone, which is still a whole sentence about what to do, and is the reason
 * this can never return nothing.
 *
 * `remedy` overrides the table for the rare caller that knows better than it
 * does: the loop panel's stop control, which can honestly add that the run is
 * still bounded by its own cap.
 *
 * IT IS NOT GIVEN THE CODE TO PRINT AND HAS NO PARAMETER THAT WOULD LET A
 * CALLER ASK FOR ONE. That is deliberate: the nine call sites this replaced all
 * printed the code because printing it was the easiest thing to reach for, and
 * an option to do so would be reached for again.
 */
export function refusalSentence(result, { fallback = '', remedy = '' } = {}) {
  const code = refusalCodeOf(result)
  const diagnosis = diagnosisOf(result) || (typeof fallback === 'string' ? fallback.trim() : '')
  const advice = (typeof remedy === 'string' && remedy.trim()) || refusalRemedy(code)
  /* A curated remedy that repeats the diagnosis word for word is shown once. */
  if (diagnosis && advice && diagnosis.includes(advice)) return joinSentences(diagnosis)
  return joinSentences(diagnosis, advice)
}

/**
 * Carry the identifier where a person will not read it but a support
 * conversation and a driver can.
 *
 * Returns the node so it can be used inline. An absent code REMOVES the
 * attribute rather than writing an empty one: `data-refusal-code=""` reads as
 * "there is a code and it is blank", which is the absence-as-value mistake this
 * codebase keeps making, and a probe asserting on presence would pass on it.
 */
export function markRefusalCode(node, result) {
  if (!node || typeof node !== 'object' || typeof node.setAttribute !== 'function') return node
  const code = refusalCodeOf(result)
  if (code) node.setAttribute('data-refusal-code', code)
  else if (typeof node.removeAttribute === 'function') node.removeAttribute('data-refusal-code')
  return node
}
