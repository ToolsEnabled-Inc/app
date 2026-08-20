/* What the home screen is allowed to say, and in whose words.
 *
 * WHY THIS IS A SEPARATE MODULE AND NOT A BLOCK INSIDE home.js.
 *
 * The defect this exists to make impossible was measured on a real installed
 * build: the home screen told one person, in one viewport, both of these.
 *
 *     "No local agent fleet host detected on this machine."   (twice)
 *     "ToolsEnabled already works on this one computer."
 *
 * Nobody wrote that pair. It assembled itself, because five independent pieces
 * of the screen each answered a different question from a different source and
 * none of them could see what the others had already said. A rule that lives
 * inside a render function can only ever be checked by reading the render
 * function. So the decision of WHAT THE SCREEN SAYS is made here, as one pure
 * function over one input, returning one flat list of sentences -- and
 * tools/test/home-screen.test.mjs walks every reachable combination of that
 * input and asserts the list never contradicts itself and never repeats itself.
 * That check is only possible because the sentences are values, not DOM.
 *
 * ON VOCABULARY. The screen this replaced was written from inside the system:
 * "read-only projection", "audited bridge", "coordinator thread", "source
 * unavailable", "last health sweep". Every one of those names a mechanism. A
 * person opening this product owns agents, a computer, and some decisions
 * waiting on them; they do not own a projection. Nothing below names a
 * mechanism, an availability envelope, a transport, or a file. It is also
 * deliberately free of the punctuation a README uses and an interface does not:
 * no interpuncts between clauses, no ellipses on states, no em dash standing in
 * for a value that is simply absent. Where there is no reading, the screen
 * omits the line rather than printing a placeholder for it.
 */

import {
  DEFAULT_RUNS_MODE,
  planChatbox,
} from './chatbox-feed.js'
/* The remedy commands, imported rather than repeated. This screen and the agent
   page both tell a person how to install and sign in to Codex; two copies of a
   command line is two things to get wrong, and the one that goes stale is
   always the one nobody is looking at. That module is pure data and a lookup
   with no imports of its own, so this costs the home screen no module graph. */
import { CODEX_SETUP_COMMANDS } from './agent-availability-copy.js'
/* THE DOOR OUT OF THE TWO DEAD ENDS ON THIS SCREEN, imported for the same
   reason the commands above are: the fleet graph, the comms board and Settings
   offer the same door, and four hand-written labels pointing at one page is four
   things to get wrong. The page behind it carries the explanation this screen is
   not allowed to print -- home's vocabulary rules ban the phrase "fleet host"
   and the fact row under the ring is capped at three, both correctly, and
   neither is a reason to leave a person holding a statement with nowhere to take
   it. */
import { GUIDE_ACTION, GUIDE_HREF } from './first-run-needs.js'
/* THE MODEL ROW'S OWN NAME. `launchTier` is the table the start controls
   already use, so the runs list says "Sonnet" where the record kept the id it
   was started with, and no fourth copy of that mapping can drift from it. The
   module is pure data with no imports of its own. */
import { launchTier } from './orchestration-controls.js'
/* DID THAT TURN SUCCEED, asked once, in the module that measured the answer.
   The two engines do not use the same word for a turn that went well (codex
   says "completed", the Claude CLI says "success"), and a second allowlist here
   is exactly how this screen would come to report a good Claude turn as a
   failure. */
import { sessionTurnSucceeded } from './agent-session-events.js'

/* EVERY REMAINING SENTENCE THE SCREEN CAN PRINT.
 *
 * describeHome() below covers the copy that depends on what is true about the
 * machine. This covers the rest: the states a panel passes through while it
 * loads, the composer's label, and what the reply control says as a message
 * goes out. Those depend on the moment rather than on the state, so they cannot
 * be returned from a pure function of the machine's condition -- but they are
 * still sentences a person reads, and while they sat as literals inside the
 * view they were the one part of this screen no test was looking at.
 *
 * That gap was pointed out by the first-run lane, about its own code, in a form
 * that turned out to describe mine exactly: helpers only help if something
 * asserts the call sites use them, because a helper existing while one caller
 * still names a literal is precisely how the original defect comes back. There
 * were twelve such literals in src/views/home.js. tools/test/home-screen.test.mjs
 * now walks every value here for the same punctuation and vocabulary rules it
 * applies to describeHome(), and separately BANS user-facing string literals in
 * the view, so a thirteenth cannot be added quietly.
 *
 * Functions rather than strings where a name is interpolated: the test calls
 * them with a sample argument and checks the result, so the whole sentence is
 * covered and not just its fixed half. */
export const COPY = Object.freeze({
  conversationLoading: Object.freeze({
    title: 'Loading',
    body: 'Reading the conversation from the computer that holds it.',
  }),
  conversationUnreachable: Object.freeze({
    title: 'This conversation is on another computer',
    body: 'ToolsEnabled could not reach the computer that holds it.',
  }),
  conversationEmpty: Object.freeze({
    title: 'Nothing has been said yet',
    body: 'When your coordinator starts talking, it appears here.',
  }),
  sampleEmpty: Object.freeze({
    title: 'This example has no conversation in it',
    body: 'Nothing was written for this profile to show here.',
  }),
  /* IT USED TO STOP THERE. "This example has no reply written for that." is
     true, and it leaves a person who has just typed something with nothing to
     do about it. The second half is the whole repair. */
  sampleNoReply: 'The example has no reply written for that one. Ask it something else, or turn the example off in Settings to use your own computer.',
  runLabel: (sequence) => `Agent run ${sequence}`,
  runWhenUnknown: 'at a time this record does not give',
  /* WHAT THE RUN DID, per row, and the empty string is load-bearing.
     A run whose outcome was never recorded gets NO word rather than a
     reassuring one: the whole defect being repaired here is a screen that
     turned silence into success, and "started" printed on a run nobody
     recorded would be the same lie in a smaller font. The row still shows its
     number and time, so the person sees the run and simply is not told
     something the computer does not know. */
  runResult: (result) => (result === 'refused' ? 'did not start' : (result === 'started' ? 'started' : '')),
  /* WHY IT DID NOT START, from the code the record already held.
     The recorder writes a bare code on every refusal and readLocalSessions used
     to drop it, so a person whose every start was refused read "did not start"
     nine times over a record that knew the answer. The sentences are
     ENGINE_REASON's -- the same table this screen already uses for whether an
     agent could be started at all -- so the two halves of the screen cannot
     give one machine two different explanations, and the honesty guard that
     walks that table (tools/test/refusal-engine-honesty.test.mjs) covers this
     surface for free.
     THE EMPTY STRING IS THE POINT for a code nobody wrote a sentence for, and
     for a run recorded before reasons were kept. A row then says what it always
     said -- the number, the outcome, the time -- rather than being handed a
     guess. Falling back to unavailableReason() was considered and refused: its
     own fallback INVENTS "this copy could not work out why", which is a claim
     about a run, not an absence of one. */
  runReason: (code) => (typeof code === 'string' && Object.prototype.hasOwnProperty.call(ENGINE_REASON, code)
    ? ENGINE_REASON[code]
    : ''),
  /* WHAT IT WAS ASKED, labelled. The words after the label are the person's
     own brief, never this module's, and they are clipped rather than wrapped
     because the runs list is a column beside a conversation. */
  runAsked: (brief) => `Asked: ${brief}`,
  /* WHAT IT SAID BACK, labelled the way the brief is so the pair reads as a
     pair. The words after the label are the agent's own, never this module's,
     and they are clipped for the same reason the brief is.

     THE FIELD WAS THERE THE WHOLE TIME. `reply` is kept on the tree node
     precisely so a screen can show what an agent answered, and the two readers
     of that record both took `role` and `message` and dropped it. The owner's
     report on this list was that it shows no outputs, and this is the line that
     was missing rather than a new thing to record. */
  runSaid: (said) => `Said back: ${said}`,
  /* WHAT IT DID, COMPACTLY, and every figure in it was already on disk.
   *
   * The per-turn record (shell/usage-record.cjs) writes one signed line each
   * time a turn ends, carrying the turn, the model row, how the engine said
   * that turn ended, and the token figures. So a run can say how much work it
   * was without this screen timing anything or guessing anything.
   *
   * WHAT IT DELIBERATELY DOES NOT SAY. No duration, and no "it finished". The
   * run record holds the intent and the start and has no line for an ending, so
   * a length here could only be this window subtracting one clock from another
   * and calling it a measurement. Turns are counted, an ending nobody recorded
   * is not.
   *
   * Each part appears only if the record carries it, so a turn with no token
   * figure shortens the sentence instead of printing a zero. */
  runDid: ({ turns = 0, model = null, tokens = null, unfinished = 0 } = {}) => {
    if (!Number.isSafeInteger(turns) || turns < 1) return ''
    const counted = countOf(turns, 'turn', 'turns')
    const opening = model ? `${counted} on ${model}` : counted
    const spent = Number.isSafeInteger(tokens) && tokens > 0 ? `${opening} and ${groupDigits(tokens)} tokens` : opening
    if (Number.isSafeInteger(unfinished) && unfinished > 0) {
      return `${spent}, and ${countOf(unfinished, 'turn', 'turns')} did not finish.`
    }
    return `${spent}.`
  },
  /* THE ABSENCES, IN WORDS. The owner asked for a flow of what the agents did
     and said, and the honest answer for some runs is that nobody wrote it down.
     A blank row reads as a screen that is broken; these say which of the three
     absences it really is, and none of them invents an ask that was not
     recorded. */
  runNothingSaved: 'No brief and no answer were saved here for this one, so the record is all there is.',
  runNoAnswerYet: 'It has not answered yet.',
  runNoAnswerSaved: 'Nothing it said was saved here.',
  runNoTurns: 'No turns were recorded for it.',
  /* Observed on the live stream by this window, right now, and it is the one
     state on the row that is not read back off a record. It says what is
     happening and never how long it has been happening. */
  runWorkingNow: 'Working now',
  /* SAID ONCE, UNDER THE LIST, because it is true of every row and belongs to
     the record rather than to any run. ToolsEnabled writes two lines per run:
     what it was about to start, and whether the start took. There is no third
     line for the ending, so a duration or a finished state on these rows could
     only be this window guessing. */
  runEndingsNotKept: 'Each start is written down and no ending is, so this list never says how long a run took.',
  /* The aggregate, in the panel footer, under the record's own integrity line.
     Returns null when the ledger says nothing either way, which is exactly the
     state every record written before outcomes existed is in -- an older
     ledger therefore reads as it always did rather than acquiring a made-up
     summary. */
  runOutcomes: (started, refused, total) => {
    const unknown = Math.max(0, total - started - refused)
    if (unknown === total) return null
    if (refused > 0 && started === 0 && unknown === 0) {
      return total === 1 ? 'It did not start.' : 'None of them started.'
    }
    if (refused > 0) return `${refused} of ${total} did not start.`
    if (unknown > 0) return `${started} of ${total} started; the rest were recorded before this copy kept outcomes.`
    return total === 1 ? 'It started.' : 'All of them started.'
  },
  /* The two settings the owner asked for, in the words the box uses when they
     leave it holding something back. Each one names the setting that caused it
     and offers the way to it, because a box that is empty for a reason the
     person cannot see is the failure this whole feature could most easily
     become. */
  chatboxNothingChosen: Object.freeze({
    title: 'This box is set to show nothing',
    body: 'Agent runs are switched off for it and there is no conversation on this computer to put here instead.',
    action: Object.freeze({ label: 'Choose what appears in it', href: '#/settings' }),
  }),
  chatboxNoAgentsChosen: Object.freeze({
    title: 'None of the agents talking are ones you picked',
    body: 'Somebody is saying something on this computer, and every one of them is switched off for this box.',
    action: Object.freeze({ label: 'Pick which agents appear', href: '#/settings' }),
  }),
  chatboxAgentsHeld: (count) => `${count} ${String(count) === '1' ? 'agent is' : 'agents are'} being kept out of this box by your own choice.`,
  composerSample: (target) => `Try writing to ${target}`,
  composerLive: (target) => `Message ${target}`,
  replyChecking: 'Checking whether replies can be sent',
  replyUnavailable: 'Replies cannot be sent right now',
  /* SENDING REPLIES SHIPS OFF, and until this sentence existed the box did not
     say so. It asked whether the message could be carried, was told yes, and
     enabled the input with "Replies will be sent and recorded" over it -- while
     the send itself returned early on a switch nobody had turned on. Typing and
     pressing Enter did nothing at all, silently, on a machine with the shipped
     defaults. That is the exact thing this screen refuses to do: an input that
     accepts nothing is worse than no input. */
  replyDisabled: 'Sending replies is switched off. Turn it on in Settings and this box will send and record them.',
  replyReady: 'Replies will be sent and recorded',
  replyReadyOneChannelOffline: 'Replies will be sent and recorded. One message channel is offline.',
  replySending: 'Sending',
  replySent: 'Sent and recorded',
  replyRefused: 'That message was not sent. Nothing was recorded.',
  /* THE ONLY DOOR TO THE PAGE THAT TAKES A SUBSCRIPTION.
   *
   * The subscribe surface was routed and linked from nowhere at all: a person
   * could only reach it by typing the address, which nobody does. So the page
   * that sells the hosted side of this product existed and had no customers by
   * construction.
   *
   * IT IS NOT WRITTEN AS AN UPGRADE PROMPT, and that is the whole of why the
   * wording is this flat. The product is free and stays free -- the page itself
   * opens by saying a subscription buys infrastructure rather than unlocking
   * anything -- so a door captioned "unlock", "upgrade" or "go pro" would
   * contradict the page behind it before the reader arrived. It states what is
   * through the door and makes no claim about what is on this side of it. */
  subscribeDoor: Object.freeze({
    label: 'See the plans and prices',
    href: '#/subscribe',
  }),
})

/* Everything the screen can be in. Named states rather than booleans checked in
   sequence: a boolean ladder is exactly how the contradictory pair got in, and
   a state machine makes the illegal pair unreachable instead of unlikely. */
export const HOME_MODES = Object.freeze({
  /* Other computers are connected and answering. The fleet reading is the
     valuable one, so it gets the hero. */
  FLEET: 'fleet',
  /* Other computers are connected and NOT answering. Worth saying, once. */
  FLEET_UNREACHABLE: 'fleet-unreachable',
  /* This computer only, and agents have run here. Their record is the hero. */
  LOCAL: 'local',
  /* This computer only, and nothing has run here yet. Not an error. */
  LOCAL_IDLE: 'local-idle',
  /* The labelled demonstration, reachable from Settings. */
  SAMPLE: 'sample',
  /* Not the installed application: a plain browser pointed at the same build.
     There is no computer here to report on, which is a different thing from a
     computer with nothing on it, and must not be reported as a fault. */
  NO_HOST: 'no-host',
})

/* ---------------------------------------------------------------
   Reading the shell's reply.
   --------------------------------------------------------------- */

const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/**
 * Normalize `mcAgent.history()` into something a view can render without
 * re-validating it.
 *
 * THREE OUTCOMES, NOT TWO, and the third is the one worth naming. "No runs
 * yet", "the record could not be read", and "this copy cannot see a computer at
 * all" are three different sentences, and collapsing the third into the second
 * would have this page report a fault against a browser that is behaving
 * correctly. `undefined` means nobody could be asked; anything malformed means
 * somebody was asked and the answer did not parse.
 */
export function readLocalSessions(raw) {
  const nothing = { total: 0, runs: Object.freeze([]), verified: null, started: null, refused: null }
  if (raw === undefined) {
    return Object.freeze({ supported: false, readable: false, ...nothing })
  }
  if (!isRecord(raw) || raw.ok !== true || !Array.isArray(raw.entries)) {
    return Object.freeze({ supported: true, readable: false, ...nothing })
  }
  const usable = raw.entries.filter(entry => isRecord(entry)
    && typeof entry.at === 'string'
    && Number.isFinite(Date.parse(entry.at))
    && Number.isSafeInteger(entry.sequence))

  /* An outcome is a SEPARATE record naming the start it resolves, so the two
     have to be rejoined here. Keyed on `resolves` rather than paired by
     adjacency because concurrent starts interleave in the ledger, and the first
     one wins because the list arrives newest-first and a duplicate must not be
     able to overwrite the outcome already read. */
  const resultBySequence = new Map()
  for (const entry of usable) {
    const outcome = entry.outcome
    if (!isRecord(outcome)) continue
    if (outcome.result !== 'started' && outcome.result !== 'refused') continue
    if (!Number.isSafeInteger(outcome.resolves)) continue
    if (resultBySequence.has(outcome.resolves)) continue
    /* THE REASON RIDES WITH THE RESULT, and it used to be dropped here.
       The recorder writes it (shell/main.cjs recordSpawnOutcome, bounded to a
       bare upper-case code by the writer AND re-validated on the way out), and
       this function threw it away -- so a person whose every start was refused
       read "did not start" nine times and was never told why, on a screen
       holding the answer. `reason` is null on a start that worked and on every
       refusal recorded before the field existed; null is "this record does not
       say" and must never be rendered as a reason. */
    resultBySequence.set(outcome.resolves, {
      result: outcome.result,
      reason: typeof outcome.reason === 'string' && outcome.reason ? outcome.reason : null,
    })
  }

  /* A run is a START. Outcome records are ledger lines too, and counting them
     as runs would report twice as many agents as ever ran. An entry with NO
     action is still treated as a run: every reply from the recorder carries
     one, so the only things that reach this branch are older records and the
     hand-built fixtures the suite uses, and silently dropping those would make
     this function report zero runs on a ledger full of them. */
  const runs = usable
    .filter(entry => entry.action === undefined || entry.action === 'agent_session_start')
    .map(entry => {
      const outcome = resultBySequence.get(entry.sequence) || null
      return Object.freeze({
        sequence: entry.sequence,
        atMs: Date.parse(entry.at),
        /* null is "this record does not say", NEVER "it worked". Every screen
           below has to keep that distinction: an unrecorded outcome is exactly
           the state that used to be displayed as success. */
        result: outcome ? outcome.result : null,
        /* The bare code the shell recorded, or null. Turned into a sentence by
           runReason() below; never rendered raw. */
        reason: outcome ? outcome.reason : null,
        /* THE JOIN KEY, and the whole of the owner's second report. Without it
           a row can only ever say "Agent run 37"; with it a screen can find the
           conversation this app already saved for that session and say WHICH
           agent and WHAT it was asked. null when the record does not say, and
           an unmatched run simply renders as it always did. */
        sessionId: typeof entry.sessionId === 'string' && entry.sessionId ? entry.sessionId : null,
      })
    })

  const tally = isRecord(raw.outcomes) ? raw.outcomes : null
  const counted = tally && Number.isSafeInteger(tally.starts) ? tally.starts : null
  const total = counted !== null && counted >= runs.length
    ? counted
    : (Number.isSafeInteger(raw.total) && raw.total >= runs.length ? raw.total : runs.length)

  return Object.freeze({
    supported: true,
    readable: true,
    total,
    runs: Object.freeze(runs),
    verified: raw.verified === true ? true : (raw.verified === false ? false : null),
    /* Whole-chain counts, or null when this copy's recorder does not report
       them. null must read as "unknown" everywhere downstream, not as zero --
       zero refusals is a claim, and this is an absence of one. */
    started: tally && Number.isSafeInteger(tally.started) ? tally.started : null,
    refused: tally && Number.isSafeInteger(tally.refused) ? tally.refused : null,
  })
}

/**
 * Can an agent be started on this computer at all? `mcAgent.availability()`
 * answers `{ok, code}`; the code is a fixed identifier, never a path, but it is
 * still a code, so it is translated here and never rendered raw.
 */
export function readAgentEngine(raw, sessionsEnabled = false) {
  const enabled = sessionsEnabled === true
  if (raw === undefined) return Object.freeze({ supported: false, ready: false, sessionsEnabled: enabled, why: null })
  if (isRecord(raw) && raw.ok === true) return Object.freeze({ supported: true, ready: true, sessionsEnabled: enabled, why: null })
  const code = isRecord(raw) && typeof raw.code === 'string' ? raw.code : ''
  return Object.freeze({
    supported: true,
    ready: false,
    sessionsEnabled: enabled,
    why: ENGINE_REASON[code] || 'This copy is not set up to run agents yet',
  })
}

/* One sentence per reason a start would be refused, because the fallback below
   ("not set up to run agents yet") is true of a copy with no engine and simply
   WRONG about a copy whose engine is fine and whose payload is missing the
   permission-level enforcement -- a distinction the shell now reports and this
   screen would otherwise throw away. The agent page carries the same map with
   more detail; this one stays at the register of a home screen. */
export const ENGINE_REASON = Object.freeze({
  AGENT_ENGINE_UNAVAILABLE: 'This copy is not set up to run agents yet',
  AGENT_CONFINEMENT_UNAVAILABLE: 'This copy did not ship the permission-level enforcement an agent session needs, so it will not start one',
  /* The one reason on this list that is not a fault at all, and the only one
     the reader can clear themselves -- so it says what to do rather than what
     is wrong. */
  /* THE FIRST THING A STRANGER SEES, and for one release it was a dead end: the
     screen named what was missing and the product contained no button, link or
     instruction anywhere that said how to get it. Both of these now carry the
     command, because the command IS the remedy and a home screen that knows the
     remedy and withholds it is choosing to be tidy over being useful. The
     commands themselves live in agent-availability-copy.js so the three screens
     that give them cannot drift apart. */
  /* The sign-in goes in a NEW window: the one the install ran in cannot see
     the new program and calls it not recognized -- the first external user's
     exact dead end; src/first-run-needs.js carries the full account. */
  AGENT_CODEX_CLI_NOT_INSTALLED: `Codex is not installed on this computer, and it is the program that runs an agent. Run "${CODEX_SETUP_COMMANDS.install}" in Windows Terminal, then "${CODEX_SETUP_COMMANDS.signIn}" in a new terminal window`,
  AGENT_CONFINEMENT_SIGNED_OUT: `Codex is installed but nobody is signed in to it. Run "${CODEX_SETUP_COMMANDS.signIn}" in Windows Terminal, then come back to this screen`,
  CODEX_CLI_NOT_FOUND: `Codex could not be found when a session tried to start it. Run "${CODEX_SETUP_COMMANDS.install}" in Windows Terminal, then "${CODEX_SETUP_COMMANDS.signIn}"`,
  CODEX_VERSION_DETECTION_FAILED: 'Codex is installed here but did not answer when asked its version, so ToolsEnabled will not build a session on it',
  AGENT_SESSION_FAILED: 'A session did not start and this copy could not work out why',
  AGENT_LAUNCH_ENVIRONMENT_UNAVAILABLE: 'This copy did not ship the protection that keeps an agent session off your billed API account, so it will not start one',
  AGENT_HOST_INVALID_CWD: 'ToolsEnabled cannot use its own workspace folder, so an agent has nowhere to run',
  AGENT_HOST_INVALID_ARGUMENT: 'ToolsEnabled could not check whether an agent can run here',
  AGENT_HOST_CLOSED: 'ToolsEnabled is shutting down',
  /* THE SAME FALSE CLAIM LIVED HERE TOO, AND ITS SECOND CORRECTION WAS ALSO
     OVERTAKEN. It has now named Claude as unstartable through three rewrites,
     and the reason it was wrong changed underneath each one. The last version
     read "A Claude or local agent type was chosen, and this copy will not start
     one from the tree." The Claude engine ships in the payload now
     (capability/src/lib/agent-engine/claude-cli-process.js, present in the
     installed 1.0.20), and resolveStartTier() opens the Claude tiers on a
     require() of it -- so the provider this code is actually raised for is
     decided by what a given build carries, and this table cannot know it.
     A home screen has no tier in hand and therefore names no provider at all.
     tools/test/refusal-engine-honesty.test.mjs is what stops a fourth version
     of this sentence from naming an engine the payload is carrying. */
  AGENT_TIER_NO_LAUNCHER: 'An agent type was chosen that this copy carries no launcher for, so it will not start one. The model menu on the tree marks which types this copy can start',
  SPAWN_RECORD_NO_KEYSTORE: 'This copy cannot reach the Windows keystore that protects the record of what runs here, so it will not start an agent',
  SPAWN_RECORD_NO_DIRECTORY: 'ToolsEnabled has nowhere to keep its record of what runs here, so it will not start an agent',
  SPAWN_RECORD_KEYSTORE_UNAVAILABLE: 'Windows will not let ToolsEnabled protect its record of what runs here, so it will not start an agent',
  SPAWN_RECORD_KEY_UNREADABLE: 'The record of what has run here cannot be opened, so ToolsEnabled will not add to it',
  SPAWN_RECORD_LEDGER_CORRUPT: 'The record of what has run here does not read back as a record, so ToolsEnabled will not add to it',
  SPAWN_RECORD_UNAVAILABLE: 'The record of what runs here cannot be opened, so ToolsEnabled will not start an agent',
  MC_AGENT_INVALID_PAYLOAD: 'This copy is not set up to run agents yet',
})

/* ---------------------------------------------------------------
   Time, in words.
   --------------------------------------------------------------- */

/**
 * Plain English, and never a symbol standing in for a number. Returns null for
 * an unreadable input so callers omit the phrase instead of printing a dash.
 */
/* ONE RUN, WITH EVERYTHING THIS COMPUTER ACTUALLY WROTE DOWN ABOUT IT.
 *
 * THE REPORT THIS EXISTS FOR. The owner, on the installed build: the activity
 * list shows "Agent run 37 - started" and a relative time, and nothing else. He
 * named the repository whose agent feeds get this right, and what they carry is
 * always the same three things -- which agent, what it was asked, what happened
 * -- never a bare identifier and a verb.
 *
 * WHERE EACH PART HONESTLY COMES FROM, because this is the line where a screen
 * starts inventing.
 *
 *   what happened   the signed record: the outcome, and the bare refusal CODE
 *                   the shell wrote beside it. Turned into a sentence by
 *                   COPY.runReason, which is silent for a code nobody wrote one
 *                   for.
 *   which agent     the person's own saved conversation for that session --
 *                   the ROLE they picked. The ledger does not carry it and must
 *                   not: it is the app's own record of what STARTED, not a copy
 *                   of what was said.
 *   what it asked   the same place: the brief they typed. Deliberately not in
 *                   the ledger either (see shell/agent-launch-audit's rule: a
 *                   launch record is evidence a session started, not a copy of
 *                   its prompt), so this is a JOIN and never a new field on
 *                   disk.
 *
 * AN UNMATCHED RUN LOSES NOTHING. A run started from another surface, from
 * another computer's record, or before session ids crossed, simply has no
 * conversation to find, and its row renders exactly as it always did. That is
 * the whole reason this is a join rather than a requirement.
 *
 * `conversations` is a Map (or any object with .get) from session id to
 * { role, asked }. The view builds it from what the person has saved; this
 * function neither reads storage nor knows where it came from.
 */
export const RUN_BRIEF_CHARS = 96

export const RUN_SAID_CHARS = 200

/* HOW MUCH WORK ONE RUN WAS, out of the per-turn record and nothing else.
 *
 * `turns` is the rows src/local-metrics.js readLocalUsage() already parsed,
 * narrowed to one session by the caller. Pure, so the whole table of shapes can
 * be walked without a browser.
 *
 * THE TWO RULES THAT KEEP THE FIGURE HONEST.
 *
 *   A `session-total` row is the engine's RUNNING total for the session, so the
 *   largest one is the session's spend and adding them would multiply it by the
 *   number of times the engine happened to report. Turn rows are added. A
 *   session with both is counted from its turn rows, exactly as the metrics
 *   page does it, because those are the finer reading.
 *
 *   A turn only counts as unfinished when the engine actually said how it
 *   ended and the word was not one of the success words. A turn with NO status
 *   is a turn nobody wrote an ending for, and calling that a failure is the
 *   same invention this whole screen is being repaired for.
 */
export function summariseRunWork(turns) {
  const rows = Array.isArray(turns) ? turns.filter(row => row && typeof row === 'object') : []
  if (rows.length === 0) return null
  const counted = rows.filter(row => row.basis !== 'session-total')
  const model = launchTier(rows.find(row => typeof row.tier === 'string' && row.tier)?.tier || '')?.label || null

  let tokens = null
  if (counted.length > 0) {
    for (const row of counted) {
      if (Number.isSafeInteger(row.totalTokens)) tokens = (tokens ?? 0) + row.totalTokens
    }
  } else {
    for (const row of rows) {
      if (Number.isSafeInteger(row.totalTokens) && (tokens === null || row.totalTokens > tokens)) tokens = row.totalTokens
    }
  }

  const unfinished = rows.filter(row => typeof row.status === 'string' && row.status
    && !sessionTurnSucceeded(row.status)).length

  return Object.freeze({
    turns: counted.length > 0 ? counted.length : rows.length,
    model,
    tokens,
    unfinished,
  })
}

export function describeRun(run, conversations = null, nowMs = Date.now(), { work = null, live = null } = {}) {
  const said = run && run.sessionId && conversations && typeof conversations.get === 'function'
    ? conversations.get(run.sessionId)
    : null
  const clip = (value, limit = RUN_BRIEF_CHARS) => {
    const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
    if (text.length === 0) return ''
    return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`
  }

  /* WHAT IT SAID BACK, from the three places it can honestly come from, newest
     first. The live stream is this window watching the turn happen; `reply` is
     the answer the tree kept on the node; `said` is the last agent line in the
     saved conversation, which outlives a node whose reply was cleared. Nothing
     is assembled and nothing is summarised. These are the agent's own words or
     there are none. */
  const working = Boolean(live && live.working)
  const streaming = clip(live && typeof live.text === 'string' ? live.text : '', RUN_SAID_CHARS)
  const kept = clip(said && typeof said.reply === 'string' ? said.reply : '', RUN_SAID_CHARS)
  const spoken = clip(said && typeof said.said === 'string' ? said.said : '', RUN_SAID_CHARS)
  const answer = streaming || kept || spoken

  /* WHICH ABSENCE THIS ROW IS IN, and there are four of them. They are ordered
     so the row names the outermost missing thing: a run with no saved
     conversation at all cannot also be missing an answer, and a run that was
     refused is not waiting for one. Exactly one sentence, or none. */
  let gap = ''
  /* AN ANSWER OUTRANKS EVERY ABSENCE, and this order is the repair for a
     contradiction measured on the packaged build. A run started from the tree
     is written to the signed record the instant it starts, and its NODE reaches
     saved storage a beat later, so for that beat the list holds a run with a
     live answer streaming into it and no saved conversation to join to. The
     absences were asked first, so the row printed the agent's actual words above
     a sentence saying no answer had been saved for it. Both were true of
     different sources and together they were nonsense, which is precisely the
     failure this screen was rewritten to make unreachable. */
  if (answer) gap = ''
  else if (!said) gap = COPY.runNothingSaved
  else if (working || said.status === 'starting' || said.status === 'running') gap = COPY.runNoAnswerYet
  else if (run.result !== 'refused') gap = COPY.runNoAnswerSaved

  /* AND THE SECOND ABSENCE, WHICH IS ABOUT THE WORK RATHER THAN THE WORDS. Only
     said of a run that really started: a run that was refused has no turns by
     definition, and printing that under a refusal reason would be the screen
     explaining itself twice.

     GATED ON THE SENTENCE AND NOT ON THE READING, deliberately. runDid() is
     silent for a reading it cannot describe, and testing `work` here instead
     would let a row that produced no sentence render a blank line -- which is
     the exact thing this row is being repaired for. Whatever makes the sentence
     empty, the row says the turns were not recorded. */
  const did = work ? COPY.runDid(work) : ''
  /* AND NOT WHILE THE TURN IS STILL HAPPENING. Read off the packaged build with
     a real agent: a row said "Working now" in green and, one line below, "No
     turns were recorded for it." Both were true -- the turn record is written
     when a turn ENDS, and that one had not -- and together they read as the
     screen arguing with itself about an agent the person can watch typing. A
     turn in progress is not a turn nobody recorded. */
  const noWork = !did && !working && run.result === 'started' ? COPY.runNoTurns : ''

  return Object.freeze({
    sequence: run.sequence,
    result: run.result,
    /* Separately-absent facts, and each absence is rendered by leaving the line
       out rather than by printing a stand-in. */
    resultWord: COPY.runResult(run.result),
    why: run.result === 'refused' ? COPY.runReason(run.reason) : '',
    agent: clip(said && typeof said.role === 'string' ? said.role : ''),
    asked: clip(said && typeof said.asked === 'string' ? said.asked : ''),
    said: answer,
    /* True only while this window is watching the stream carry that session.
       It is an observation, not a reading of a record, and it is the only
       liveness claim this row makes. */
    working,
    did,
    noWork,
    gap,
    when: whenWords(nowMs - run.atMs) || COPY.runWhenUnknown,
    /* The exact instant, for the row's own tooltip. A list that only ever says
       "3 days ago" cannot be lined up against anything else that happened. */
    at: Number.isFinite(run.atMs) ? new Date(run.atMs).toLocaleString() : '',
  })
}

export function whenWords(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null
  const seconds = Math.floor(ms / 1000)
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return minutes <= 1 ? 'a minute ago' : `${minutes} minutes ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return hours === 1 ? 'an hour ago' : `${hours} hours ago`
  const days = Math.round(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  const months = Math.round(days / 30)
  if (months < 12) return months === 1 ? 'last month' : `${months} months ago`
  const years = Math.round(months / 12)
  return years === 1 ? 'last year' : `${years} years ago`
}

const countOf = (n, one, many) => `${n} ${n === 1 ? one : many}`

/* Thousands separated, and written here rather than taken from
   Number.toLocaleString(): that function answers differently depending on the
   machine's language settings, so the same record would read one way on this
   computer and another way on the next, and no test could pin either. */
function groupDigits(value) {
  const digits = String(Math.trunc(value))
  let out = ''
  for (let index = 0; index < digits.length; index += 1) {
    if (index > 0 && (digits.length - index) % 3 === 0) out += ','
    out += digits[index]
  }
  return out
}

/* ---------------------------------------------------------------
   The decision.
   --------------------------------------------------------------- */

/**
 * @param {object} input
 * @param {boolean} input.sample          the labelled demonstration is showing
 * @param {boolean} input.fleetConfigured other computers have been connected
 * @param {object|null} input.fleetHealth  {available, total, ok, down, unknown, atMs}
 * @param {object|null} input.peer         {reachable, name, atMs}
 * @param {object} input.sessions          from readLocalSessions
 * @param {object} input.engine            from readAgentEngine
 * @param {object|null} input.approvals    {readable, count, undelivered}
 * @param {object} input.chatbox           {runsMode, selection, agentsInSource}
 * @param {number} input.nowMs
 *
 * @returns a description, never a rendering. `clock` is null whenever there is
 * no real instant to count from -- the screen then shows no digits at all,
 * because four dashes under the word SECONDS is a broken clock and a person
 * reads it as one.
 */
export function describeHome(input) {
  const {
    sample = false,
    fleetConfigured = false,
    fleetHealth = null,
    peer = null,
    sessions = readLocalSessions(null),
    engine = readAgentEngine(null),
    approvals = null,
    chatbox = null,
    nowMs = Date.now(),
  } = input || {}

  const mode = pickMode({ sample, fleetConfigured, fleetHealth, sessions })
  const newestRun = sessions.runs.length ? Math.max(...sessions.runs.map(run => run.atMs)) : null

  /* ---- the hero ---- */
  let clock = null
  let caption = 'This computer'
  let headline = null

  if (mode === HOME_MODES.FLEET) {
    clock = fleetHealth.atMs
    caption = 'Last checked'
    headline = fleetHeadline(fleetHealth)
  } else if (mode === HOME_MODES.FLEET_UNREACHABLE) {
    caption = 'Your computers'
    headline = 'The computers you connected could not be reached'
  } else if (mode === HOME_MODES.LOCAL) {
    clock = newestRun
    caption = 'Last agent run'
    headline = `${countOf(sessions.total, 'agent run', 'agent runs')} on this computer`
  } else if (mode === HOME_MODES.SAMPLE) {
    caption = 'Example fleet'
    headline = 'Everything on this screen is an example, not your data'
  } else if (mode === HOME_MODES.NO_HOST) {
    caption = 'ToolsEnabled'
    headline = 'Open ToolsEnabled on your computer to see what has run there'
  } else if (!sessions.readable) {
    caption = 'This computer'
    headline = 'The record of what has run here could not be read'
  } else {
    /* Deliberately NOT a second "nothing has run here". The panel two inches to
       the right already says that, and it is the panel's job to; a hero
       repeating it in almost the same words was the first thing wrong with this
       screen when it was looked at rather than reasoned about. The hero answers
       a different question -- what state is this computer in -- and on a fresh
       install the honest answer is a good one. */
    caption = 'This computer'
    headline = engine.ready ? 'Ready when you are' : 'Not ready yet'
  }

  /* ---- the short true statements under the hero ----
     Assembled in one place so the whole set is visible at once. This is the
     list the contradiction test walks. */
  const facts = []

  if (mode === HOME_MODES.SAMPLE) {
    facts.push({ id: 'sample', tone: 'neutral', text: 'Turn this off in Settings to see your own computer' })
  } else if (mode === HOME_MODES.NO_HOST) {
    facts.push({ id: 'engine', tone: 'neutral', text: 'This page is running in a browser, not the installed app' })
  } else {
    /* Whether agents can run here. Stated once, positively when it is true --
       a person needs to know this either way, and it is the single most
       load-bearing fact about the product on a machine with nothing connected. */
    facts.push(engine.ready
      ? { id: 'engine', tone: 'good', text: 'Agents can run on this computer' }
      : { id: 'engine', tone: 'warn', text: engine.why })

    /* The other computers. Exactly one sentence, and only one of these three
       branches can ever be taken, which is the whole point of the mode. */
    if (mode === HOME_MODES.FLEET && peer?.reachable) {
      const when = whenWords(nowMs - peer.atMs)
      facts.push({
        id: 'peer',
        tone: 'good',
        text: when ? `Connected to ${peer.name}, checked ${when}` : `Connected to ${peer.name}`,
      })
    } else if (mode === HOME_MODES.FLEET) {
      /* Health read, link unread. NOTHING is said, deliberately: a fleet whose
         services just reported in is plainly answering, so "your computers are
         not answering" would be flatly contradicted by the headline directly
         above it. The link's own freshness is a detail for the computers page,
         not a headline claim on home. */
    } else if (mode === HOME_MODES.FLEET_UNREACHABLE) {
      facts.push({ id: 'peer', tone: 'warn', href: GUIDE_HREF, text: 'Nothing has been heard from them recently' })
    } else {
      /* The one true thing to say when there is no fleet. NOT "no fleet host
         was detected", which describes a search this product performed and
         reads as a fault; and never beside a claim that it works here.

         IT NOW LEADS SOMEWHERE, and that is the whole of LEGACY-ONB-001 as it
         lands on this screen. The sentence was correct and terminal: a person
         who wanted to know what a second computer would add, or whether they had
         missed a step, had nowhere in the product to find out. The words do not
         change -- they were right -- but the row is a link now. */
      facts.push({ id: 'peer', tone: 'neutral', href: GUIDE_HREF, text: 'This is the only computer connected' })
    }

    /* Decisions waiting. Omitted entirely when the count could not be read: a
       home screen is not the place that reports why a queue is unreadable, and
       "0 waiting" when eight are queued would be the one wrong thing it could
       say. Zero is stated positively, because "nothing needs you" is
       information a person wants. */
    if (approvals?.readable) {
      /* Decisions he ALREADY MADE that did not land -- src/approval-outcomes.js.
         Absence reads as zero, which is the only reading of a missing field that
         cannot invent a failure, and it is clamped to the pending count so this
         row can never claim more failures than there are requests left to fail.
         That clamp is also what makes "nothing was approved" corroborated rather
         than asserted: a decision that HAD landed would have taken its request
         out of the queue, so a failure that is still counted here is a failure
         the engine is still confirming by keeping the request pending. */
      const undelivered = Number.isSafeInteger(approvals.undelivered) && approvals.undelivered > 0
        ? Math.min(approvals.undelivered, approvals.count)
        : 0

      /* ONE row, not two. The cap under the ring is three facts and it is a real
         cap (tools/test/home-screen.test.mjs), because five notices in a
         viewport is what made this screen unreadable. So when a decision he made
         did not land, that DISPLACES the waiting count rather than joining it:
         both are true, the failed request is itself one of the waiting ones, and
         only one of them corrects something he currently believes. The count is
         one click away on the screen this row links to. */
      facts.push(
        undelivered > 0
          ? {
            id: 'approvals',
            tone: 'warn',
            href: '#/approvals',
            text: `${countOf(undelivered, 'decision', 'decisions')} you made ${undelivered === 1 ? 'was' : 'were'} not recorded, so nothing was approved`,
          }
          : approvals.count > 0
            ? { id: 'approvals', tone: 'warn', href: '#/approvals', text: `${countOf(approvals.count, 'decision', 'decisions')} waiting for you` }
            : { id: 'approvals', tone: 'good', text: 'Nothing is waiting for your approval' },
      )
    }
  }

  const panel = Object.freeze(describePanel(mode, sessions, engine, chatbox))

  return Object.freeze({
    mode,
    clock,
    caption,
    headline,
    facts: Object.freeze(facts.map(Object.freeze)),
    panel,
    /* An input a person can type into but that accepts nothing is worse than no
       input at all, so the composer exists only where it does something. A
       conversation the person has switched OFF for this box is one of the
       places it does nothing: the reply would be accepted, recorded, and never
       appear. */
    composer: (mode === HOME_MODES.SAMPLE || mode === HOME_MODES.FLEET) && panel.context,
    /* Every sentence this screen will print, flattened. The test walks this. */
    statements: Object.freeze([headline, ...facts.map(fact => fact.text), ...panelStatements(panel)].filter(Boolean)),
  })
}

function pickMode({ sample, fleetConfigured, fleetHealth, sessions }) {
  if (sample) return HOME_MODES.SAMPLE
  /* Checked before the fleet, because a browser cannot report on a fleet
     either -- the projections it can read are the ones bundled in the build. */
  if (!sessions.supported) return HOME_MODES.NO_HOST
  if (fleetConfigured) {
    return fleetHealth?.available && Number.isFinite(fleetHealth.atMs)
      ? HOME_MODES.FLEET
      : HOME_MODES.FLEET_UNREACHABLE
  }
  return sessions.readable && sessions.runs.length > 0 ? HOME_MODES.LOCAL : HOME_MODES.LOCAL_IDLE
}

function fleetHeadline(health) {
  const { total, ok, down, unknown } = health
  if (down > 0) return `${down} of ${total} ${down === 1 ? 'service is' : 'services are'} down`
  if (unknown > 0) return `${ok} of ${total} services are running and ${unknown} could not be checked`
  return total === 1 ? 'The one service you run is up' : `All ${total} services are running`
}

/* ---------------------------------------------------------------
   The panel between the braces.
   --------------------------------------------------------------- */

/* TWO HALVES, NOT ONE OF THREE KINDS.
 *
 * This function used to answer "which single thing is in the box" from the
 * state of the machine alone: a demonstration, a conversation, or a list of
 * runs, never two at once. The owner asked for the two to be independently
 * controlled -- which agents' context appears, and whether runs appear too, not
 * at all, or on their own -- so the box now has a context half and a runs half
 * and this decides each one separately.
 *
 * WHAT THE MACHINE STILL DECIDES, and what it no longer decides. The machine
 * decides what is AVAILABLE: only the demonstration and a reachable coordinator
 * have a conversation to show, and only a computer has a record of runs (the
 * demonstration is a labelled example, and mixing this computer's real run
 * record into a box badged as an example would make half of it true). The
 * settings decide, out of what is available, what a person actually sees.
 */
function describePanel(mode, sessions, engine, chatbox) {
  const contextAvailable = mode === HOME_MODES.SAMPLE || mode === HOME_MODES.FLEET
  const runsAvailable = mode !== HOME_MODES.SAMPLE
  const plan = planChatbox({
    contextAvailable,
    runsAvailable,
    runsMode: chatbox?.runsMode ?? DEFAULT_RUNS_MODE,
    selection: chatbox?.selection ?? null,
    agentsInSource: chatbox?.agentsInSource ?? [],
  })

  const panel = {
    /* Which conversation the renderer should load, or none. NOT "what is in the
       box": `runs` is its own flag now, because both can be true. */
    kind: plan.showContext ? (mode === HOME_MODES.SAMPLE ? 'sample' : 'conversation') : 'none',
    context: plan.showContext,
    runs: plan.showRuns,
    title: panelTitle(mode, plan),
    /* A demonstration is badged whatever it is showing, and real data never is.
       The badge follows the MODE and not the contents, so no combination of
       these two settings can produce an example that is not labelled. */
    badge: mode === HOME_MODES.SAMPLE ? 'Example, not your data' : null,
    empty: null,
    contextEmpty: null,
    footer: null,
    /* The GATED count, because this number becomes a sentence a person reads.
       It was the raw one, and in "show only runs" that printed "3 agents are
       being kept out of this box by your own choice" beside a list of runs and
       no conversation at all -- a complaint about a filter over a half that is
       not on screen. The raw count is still on the plan for anyone who wants to
       ask what widening the selection would bring back. */
    hiddenAgents: plan.contextHiddenAgents,
  }

  /* Nothing at all was chosen. Said plainly, with the way back to the choice,
     rather than quietly putting one of the halves back. */
  if (!plan.showContext && !plan.showRuns) {
    panel.empty = { ...COPY.chatboxNothingChosen, action: { ...COPY.chatboxNothingChosen.action } }
    return panel
  }

  if (plan.contextFilteredToNothing) {
    panel.contextEmpty = { ...COPY.chatboxNoAgentsChosen, action: { ...COPY.chatboxNoAgentsChosen.action } }
  }

  if (plan.showRuns) {
    if (mode === HOME_MODES.NO_HOST) {
      panel.empty = {
        title: 'Nothing to show in a browser',
        body: 'ToolsEnabled shows the agents that have run on a computer. Open the installed app to see them.',
      }
    } else if (!sessions.readable) {
      /* FLEET_UNREACHABLE, LOCAL and LOCAL_IDLE all show the same thing: what
         has run on THIS computer. A fleet that is not answering does not stop
         the machine in front of the person from having a history. */
      panel.empty = {
        title: 'The record could not be read',
        body: 'ToolsEnabled keeps a record of every agent it starts here, and this copy could not open it. Nothing has been lost; new runs are still recorded.',
      }
    } else if (sessions.runs.length === 0) {
      panel.empty = {
        title: 'No agents have run here yet',
        body: engine.ready
          ? 'When you start an agent, every run shows up here. ToolsEnabled writes each one down on this computer before it starts.'
          : 'When this copy can run agents, every run will show up here.',
        /* The one next step, and only when it is genuinely the next step.
           Running an agent from this window is a control a person switches on
           themselves, so an installation that has not switched it on is told
           where the switch is. An installation that has is told nothing here,
           because a button that repeats what the person already did is
           clutter, and a button pointing at a screen that cannot help them is
           worse than clutter.

           THE THIRD BRANCH IS THE ONE THAT WAS MISSING, and it is the branch a
           stranger lands on. An engine that is NOT ready got `null` here: the
           box said "When this copy can run agents, every run will show up here"
           and offered nothing, on the exact screen where the person has just
           been told their computer cannot run one. The fact row above already
           names the cause and gives the command; this control leads to the page
           that says what the whole product needs, which is the question a person
           in that state is actually asking. */
        action: engine.ready
          /* THE ADDRESS NAMES THE SWITCH, because the page it opens has 219
             controls on it. `engine.sessionsEnabled` is isWriteEnabled('agent-session'),
             so the row this sentence is about is `write_agent-session` -- "Run
             an agent session", in the Write section. Measured on the packaged
             build before this carried the id: following this link put a person
             at the top of Settings with that row 10170px below them AND inside
             a collapsed tier carrying `inert`, so scrolling could not reach it
             either. src/views/settings.js reads the id, opens the section to the
             depth the row lives at, and scrolls to it. */
          ? (engine.sessionsEnabled ? null : { label: 'Turn on agent sessions in Settings', href: '#/settings?setting=write_agent-session' })
          : { ...GUIDE_ACTION },
      }
    } else {
      panel.footer = recordFooter(sessions)
    }
  }

  /* An empty runs half is not an empty BOX when a conversation is beside it,
     and the renderer needs to know which of the two it is. */
  if (panel.empty && plan.showContext && !plan.contextFilteredToNothing) {
    panel.runsEmptyBesideContext = true
  }

  if (plan.contextHiddenAgents > 0) {
    const held = COPY.chatboxAgentsHeld(plan.contextHiddenAgents)
    panel.footer = panel.footer ? `${panel.footer} ${held}` : held
  }
  return panel
}

function panelTitle(mode, plan) {
  if (plan.showContext && plan.showRuns) return 'Your coordinator, and what has run here'
  if (plan.showContext) return mode === HOME_MODES.SAMPLE ? 'Example conversation' : 'Your coordinator'
  return 'Activity on this computer'
}

/* What the record is worth, said exactly and not one word further. It is signed
   on this machine with a key held on this machine, so it proves the list has not
   been quietly edited; it does not prove who ran anything, and this product has
   no accounts, so it never will from here. Both halves ship or neither does. */
/* TWO SENTENCES ABOUT TWO DIFFERENT THINGS, and running them together is what
 * made this footer mislead.
 *
 * "All 3 runs still check out" was never a claim about the agents. It is the
 * hash chain and the signatures verifying -- a statement about the RECORD. But
 * it sat directly under "3 agent runs on this computer", and a person reading
 * the two together was told, in the product's own voice, that their three runs
 * were fine. All three had refused to start. That is the worst way for a screen
 * to be wrong: it does not look broken, it looks reassuring, and it costs the
 * reader the one signal that would have sent them to fix it.
 *
 * So the integrity sentence now names its own subject -- "the record of all 3
 * still checks out" -- and the outcome gets a sentence of its own instead of
 * being inferred from silence. When the ledger has nothing to say about
 * outcomes, which is every record written before they existed, the second
 * sentence is omitted rather than guessed. */
function recordFooter(sessions) {
  const counted = countOf(sessions.total, 'run', 'runs')
  const integrity = sessions.verified === true
    ? `Written down on this computer as it happened, and the record of all ${counted} still checks out.`
    : sessions.verified === false
      ? 'Written down on this computer as it happened. The record no longer checks out, so treat this list as a guide, not a receipt.'
      : `Written down on this computer as it happened, ${counted} in all.`
  const outcomes = Number.isSafeInteger(sessions.started) && Number.isSafeInteger(sessions.refused)
    ? COPY.runOutcomes(sessions.started, sessions.refused, sessions.total)
    : null
  /* AND THE THIRD SENTENCE, WHICH IS ABOUT WHAT THIS RECORD DOES NOT HOLD.
   *
   * The owner asked for a flow, and the first thing a person wants from a flow
   * is how long each thing took. It cannot be answered. The recorder writes
   * exactly two lines per run -- the intent before the process exists, and
   * started or refused the instant the start resolved -- and there is no line
   * for an ending anywhere in the chain. A duration here could therefore only
   * be this window subtracting one clock from another and presenting it as a
   * measurement, which is the class of thing this whole screen was rewritten to
   * stop doing. So the list says what it has and says, once, what it has not. */
  return [integrity, outcomes, COPY.runEndingsNotKept].filter(Boolean).join(' ')
}

function panelStatements(panel) {
  const out = [panel.title]
  if (panel.badge) out.push(panel.badge)
  for (const notice of [panel.empty, panel.contextEmpty]) {
    if (!notice) continue
    out.push(notice.title, notice.body)
    if (notice.action) out.push(notice.action.label)
  }
  if (panel.footer) out.push(panel.footer)
  return out
}
