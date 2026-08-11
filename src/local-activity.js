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
  sampleNoReply: 'This example has no reply written for that.',
  runLabel: (sequence) => `Agent run ${sequence}`,
  runWhenUnknown: 'at a time this record does not give',
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
  if (raw === undefined) {
    return Object.freeze({ supported: false, readable: false, total: 0, runs: Object.freeze([]), verified: null })
  }
  if (!isRecord(raw) || raw.ok !== true || !Array.isArray(raw.entries)) {
    return Object.freeze({ supported: true, readable: false, total: 0, runs: Object.freeze([]), verified: null })
  }
  const runs = raw.entries
    .filter(entry => isRecord(entry)
      && typeof entry.at === 'string'
      && Number.isFinite(Date.parse(entry.at))
      && Number.isSafeInteger(entry.sequence))
    .map(entry => Object.freeze({ sequence: entry.sequence, atMs: Date.parse(entry.at) }))
  const total = Number.isSafeInteger(raw.total) && raw.total >= runs.length ? raw.total : runs.length
  return Object.freeze({
    supported: true,
    readable: true,
    total,
    runs: Object.freeze(runs),
    verified: raw.verified === true ? true : (raw.verified === false ? false : null),
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
  AGENT_CONFINEMENT_SIGNED_OUT: 'Sign in to Codex on this computer: the permission level recorded here builds each agent session from that sign-in',
  AGENT_LAUNCH_ENVIRONMENT_UNAVAILABLE: 'This copy did not ship the protection that keeps an agent session off your billed API account, so it will not start one',
  AGENT_HOST_INVALID_CWD: 'ToolsEnabled cannot use its own workspace folder, so an agent has nowhere to run',
  AGENT_HOST_INVALID_ARGUMENT: 'ToolsEnabled could not check whether an agent can run here',
  AGENT_HOST_CLOSED: 'ToolsEnabled is shutting down',
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
 * @param {object|null} input.approvals    {readable, count}
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
      facts.push({ id: 'peer', tone: 'warn', text: 'Nothing has been heard from them recently' })
    } else {
      /* The one true thing to say when there is no fleet. NOT "no fleet host
         was detected", which describes a search this product performed and
         reads as a fault; and never beside a claim that it works here. */
      facts.push({ id: 'peer', tone: 'neutral', text: 'This is the only computer connected' })
    }

    /* Decisions waiting. Omitted entirely when the count could not be read: a
       home screen is not the place that reports why a queue is unreadable, and
       "0 waiting" when eight are queued would be the one wrong thing it could
       say. Zero is stated positively, because "nothing needs you" is
       information a person wants. */
    if (approvals?.readable) {
      facts.push(approvals.count > 0
        ? { id: 'approvals', tone: 'warn', href: '#/approvals', text: `${countOf(approvals.count, 'decision', 'decisions')} waiting for you` }
        : { id: 'approvals', tone: 'good', text: 'Nothing is waiting for your approval' })
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
           worse than clutter. */
        action: engine.ready && !engine.sessionsEnabled
          ? { label: 'Turn on agent sessions in Settings', href: '#/settings' }
          : null,
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
function recordFooter(sessions) {
  const counted = countOf(sessions.total, 'run', 'runs')
  if (sessions.verified === true) return `Written down on this computer as it happened. All ${counted} still check out.`
  if (sessions.verified === false) return `Written down on this computer as it happened. The record no longer checks out, so treat this list as a guide, not a receipt.`
  return `Written down on this computer as it happened, ${counted} in all.`
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
