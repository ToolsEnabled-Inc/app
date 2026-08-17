/* WHAT THIS COPY NEEDS, AND WHY SOME SCREENS ARE EMPTY — said once, here.
 *
 * THE DEFECT THIS EXISTS TO CLOSE (LEGACY-ONB-001, confirmed on machine B and
 * re-measured here on a sterile profile before a line was changed). A person who
 * installs this product and walks the ring is told, in the product's own voice:
 *
 *     home           "This is the only computer connected"          (and nothing more)
 *     fleet graph    "Fleet projection unavailable · No local agent fleet host
 *                     detected on this machine."
 *     comms board    "Channels unavailable — projection" / "Live ops projection is
 *                     unavailable." / "unavailable — No local agent fleet host
 *                     detected on this machine."
 *     settings       nothing at all about any of it
 *
 * Every one of those sentences is TRUE and not one of them is an explanation.
 * Three of them name a mechanism the reader has never heard of, none says what an
 * agent host is, none says whether the person did something wrong, and there is
 * no control anywhere on those four screens that leads to an answer. That is a
 * dead end, and it is the first thing a stranger sees.
 *
 * WHY IT IS THE SHIPPING STATE AND NOT AN EDGE CASE. `dist/data/*.json` — the
 * files these screens read — are BUILD-TIME outputs of tools/gen-*.mjs, which
 * read the builder's own engine roots. They are packed into the read-only asar
 * and no process on a customer machine writes them. So all seven ship as
 * `{"ok": false, "reason": "No local agent fleet host detected on this
 * machine."}` and STAY that way, on every install, forever. The unavailable
 * branch of those screens is the only branch a customer will ever see.
 *
 * WHAT THIS MODULE MAY NOT DO, and the reason it is data rather than prose in
 * four render functions. It may not promise a remedy that does not exist. There
 * is no control in this product that connects an agent host, and writing "connect
 * a computer and this fills in" would be a lie told four times in four different
 * wordings. So the copy below separates the two honestly:
 *
 *   - the things a person CAN clear today, each with the exact command or the
 *     exact switch (`fix: 'self'`); and
 *   - the thing nobody can clear from this window yet, said plainly, so the
 *     reader stops looking for the switch instead of hunting for it in Settings
 *     (`fix: 'none'`).
 *
 * A guide that overstated the second would be worse than the dead end it
 * replaces: a dead end costs a person a minute, and a false remedy costs them an
 * afternoon.
 *
 * THE VOCABULARY IS NOT THE SCREENS'. tools/test/home-screen.test.mjs bans
 * "fleet host", "projection" and the rest of that register from the home screen,
 * and rightly. But a person who has ALREADY READ "No local agent fleet host
 * detected on this machine" on the fleet graph needs those words translated, not
 * withheld — so the guide quotes the sentence verbatim once, and answers it. The
 * copy that goes back onto home and into the empty panels does not.
 */

import { CODEX_SETUP_COMMANDS } from './agent-availability-copy.js'

/** The one address. Every screen that links to the guide reads it from here. */
export const GUIDE_HREF = '#/guide'
export const SETTINGS_HREF = '#/settings'

/* The control that appears on an empty screen. One object, so the fleet graph,
   the comms board, home and settings cannot end up offering four differently
   worded doors to the same page. */
export const GUIDE_ACTION = Object.freeze({
  label: 'What this copy needs',
  href: GUIDE_HREF,
})

/**
 * What an empty live screen says, in place of a refusal on its own.
 *
 * `reason` is the projection's own sentence and is passed in rather than
 * assumed: it is the product's honest report of what it looked for and it stays
 * on the glass, verbatim and unsoftened. What changes is that it now arrives
 * INSIDE an explanation and above a door, instead of alone.
 *
 * The absence case is the one that matters here. A caller with no reason at all
 * — a fetch that threw, a malformed envelope, a `reason` field that is an empty
 * string — must still get the explanation, because "we could not read it and
 * cannot say why" is exactly when a person is most lost. So `reason` is
 * OPTIONAL and its absence removes only the quoted line, never the paragraph or
 * the door.
 */
export function hostAbsentNotice(reason) {
  const quoted = typeof reason === 'string' && reason.trim().length > 0 ? reason.trim() : null
  return Object.freeze({
    title: 'Nothing is reporting to this copy yet',
    reason: quoted,
    body: 'This screen draws a report written by an agent host. An agent host is a program that watches the agents running on a group of computers and writes down what they are doing. No agent host has reported to this copy, so there is nothing here to draw. Nothing on this computer is broken, and nothing is missing from the install.',
    action: GUIDE_ACTION,
  })
}

/* THE SAME NOTICE AS MARKUP, because four screens draw it and four hand-rolled
 * templates is four things to get wrong.
 *
 * IT RETURNS A STRING AND TOUCHES NO DOM API, deliberately: this module is
 * imported by a plain node test and by tools/first-run-recovery-qa.mjs, and one
 * `document.createElement` in here would make both of them impossible. The two
 * callers that need an Element wrap it in their own `el()`.
 *
 * The escaper is local rather than imported from a view for the same reason.
 *
 * `alongside` goes INSIDE the refusal paragraph rather than after it, and that
 * placement has a test behind it. On the fleet graph the refusal and "these are
 * the agents this copy declares, not agents observed running" are one claim:
 * separated, a person can read the first without the second and take a
 * configured agent for a running one. tools/agent-route-reachability.mjs asserts
 * both are in the same visible element, and the first version of this repair
 * split them and turned that suite red.
 *
 * `reasonClass` exists so a host page can keep a selector an existing probe
 * reads. Dropping such a class does not fail the probe -- it makes the probe
 * quietly record nothing, which is worse. */
const ESCAPES = Object.freeze({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })
const escapeMarkup = value => String(value ?? '').replace(/[&<>"']/g, character => ESCAPES[character])

export function hostAbsentMarkup(reason, { compact = false, alongside = '', reasonClass = '' } = {}) {
  const notice = hostAbsentNotice(reason)
  const classes = ['host-absent-reason', 'projection-unavailable', reasonClass].filter(Boolean).join(' ')
  const rest = alongside ? ` ${alongside}` : ''
  return `<div class="host-absent${compact ? ' is-compact' : ''}" data-host-absent="true">`
    + `<p class="host-absent-title">${escapeMarkup(notice.title)}</p>`
    + (notice.reason ? `<p class="${classes}">${escapeMarkup(notice.reason)}${escapeMarkup(rest)}</p>` : '')
    + `<p class="host-absent-body">${escapeMarkup(notice.body)}</p>`
    + `<a class="host-absent-action" href="${escapeMarkup(notice.action.href)}">${escapeMarkup(notice.action.label)}</a>`
    + `</div>`
}

/* The three things a person on a bare machine will notice, in the order they
 * will notice them. Read by src/views/guide.js and asserted by
 * tools/test/first-run-needs.test.mjs.
 *
 * `fix` is the honest half:
 *   'self' — the reader can clear this themselves, and `steps` says exactly how.
 *   'none' — nobody can clear it from this window, and saying so IS the help.
 */
export const FIRST_RUN_NEEDS = Object.freeze([
  Object.freeze({
    id: 'codex',
    fix: 'self',
    title: 'Running an agent on this computer',
    /* Two switches and a program, and the order is not cosmetic: `codex login`
       is a subcommand of the program the first line installs, so these can only
       be followed in this order. The commands are imported, never retyped —
       three screens give them now and the one that goes stale is always the one
       nobody is looking at. */
    body: 'ToolsEnabled does not contain the program that runs an agent. Codex does, and it is a separate install. Once it is on this computer and signed in, the agent page can start a session. Every run is written down here before it begins.',
    steps: Object.freeze([
      Object.freeze({ kind: 'command', text: CODEX_SETUP_COMMANDS.install, note: 'in Windows Terminal. If you already have Node, "' + CODEX_SETUP_COMMANDS.installWithNode + '" does the same thing.' }),
      Object.freeze({ kind: 'command', text: CODEX_SETUP_COMMANDS.signIn, note: 'in the same window, once the install finishes.' }),
      Object.freeze({ kind: 'switch', text: 'Turn on "Run an agent session"', note: 'in Settings, under Write. Every action that writes anything ships switched off.', href: SETTINGS_HREF }),
    ]),
  }),
  Object.freeze({
    id: 'host',
    fix: 'none',
    title: 'Why the fleet graph, comms board, metrics and ledger are empty',
    /* THE ONE THAT MUST NOT BE OVERSOLD. Measured, not assumed: the files these
       screens read are packed into the read-only application archive at build
       time. No process on this machine writes them, so no action the reader
       takes will change them. */
    body: 'Those screens read a report written by an agent host, and this copy of ToolsEnabled does not include one. There is no setting that connects one and no command that installs one, so nothing you do will fill those screens today. They say so rather than showing numbers that are not yours. This is the honest state of the product, not a fault on your computer.',
    quote: 'No local agent fleet host detected on this machine.',
    steps: Object.freeze([
      Object.freeze({ kind: 'switch', text: 'To see what one of those screens looks like with data in it, turn its live source off', note: 'in Settings, under Data and Sim. Each screen then shows a worked example, labelled as an example.', href: SETTINGS_HREF }),
    ]),
  }),
  Object.freeze({
    id: 'messaging',
    fix: 'self',
    title: 'Sending a message to a coordinator',
    /* Both halves, because the switch alone is not the whole answer and a guide
       that gave only the switch would send a person to turn it on and watch
       nothing happen. */
    body: 'The box on the first page has no place to type. Sending replies is switched off, and there is no coordinator on this computer to send one to. Turning the switch on is worth doing so the box is ready. It will stay quiet until an agent host reports here.',
    steps: Object.freeze([
      Object.freeze({ kind: 'switch', text: 'Turn on "Coordinator replies"', note: 'in Settings, under Write.', href: SETTINGS_HREF }),
    ]),
  }),
])

/* THE THREE ASSISTANT PROGRAMS, WHAT EACH ONE COSTS A PERSON TO SET UP, AND
 * WHAT THIS COPY CAN ACTUALLY DO WITH IT.
 *
 * THE DEFECT. The owner's requirement is that a person can add their Claude,
 * Codex and Gemini sign-ins easily and then have agents run on them. Measured on
 * the packaged product: Codex was the only one of the three named anywhere in
 * the product, Gemini appeared nowhere at all, and the only sentence about
 * sign-ins was in Settings, saying this product never asks for them. That is
 * true and it reads as "there is nothing here for you to do". A person then
 * meets a tier menu where every Claude row says it cannot start, with no screen
 * anywhere that explains what Claude CAN do here or how to set it up.
 *
 * `reach` IS THE HONEST FIELD AND IT IS WHY THIS IS DATA. It says what this copy
 * does with the program TODAY, and the three values are different in kind:
 *
 *   'tree'     the research page starts one from a tree. Codex only.
 *   'handover' work handed over on the agent page runs on it, and a tree start
 *              refuses. Claude. MEASURED on the installed build: that hand-over
 *              spawns the official claude program on the person's own sign-in.
 *   'none'     nothing in this copy starts it. Gemini. Signing in changes
 *              nothing here, and saying so is the whole of the help.
 *
 * A MENU ENTRY THAT CANNOT START IS THE THING THIS MUST NOT BECOME. Gemini is
 * listed because a person comparing the three deserves a straight answer about
 * the third, and the straight answer is "not built". It is not offered as a
 * choice anywhere, and it must not be until something can start it.
 *
 * EVERY COMMAND BELOW WAS RUN OR READ OFF THE PROGRAM'S OWN HELP, never
 * remembered. `claude auth login` and `claude auth status` are subcommands of
 * claude 2.1.186, read from `claude auth --help`. `codex login status` is
 * checked the same way. Gemini 0.53.0 has NO sign-in subcommand at all -- its
 * help lists mcp, extensions, skills, hooks and gemma and nothing else -- so its
 * entry says to run the program, because inventing a command a person cannot run
 * is worse than the silence this replaces.
 */
export const PROVIDER_SETUP = Object.freeze([
  Object.freeze({
    id: 'codex',
    name: 'Codex',
    reach: 'tree',
    /* The only one that runs work from start to finish inside this window, so it
       is first. The commands are imported rather than retyped for the reason the
       guide entry below already gives: three screens print them now. */
    doesHere: 'Starts an agent from the research page and runs the work here. This is the one that works end to end in this copy today.',
    steps: Object.freeze([
      Object.freeze({ kind: 'command', text: CODEX_SETUP_COMMANDS.install, note: 'in Windows Terminal. If you already have Node, "' + CODEX_SETUP_COMMANDS.installWithNode + '" does the same thing.' }),
      Object.freeze({ kind: 'command', text: CODEX_SETUP_COMMANDS.signIn, note: 'in the same window, once the install finishes.' }),
      Object.freeze({ kind: 'command', text: 'codex login status', note: 'tells you whether you are signed in. Nothing here reads your sign-in.' }),
    ]),
  }),
  Object.freeze({
    id: 'claude',
    name: 'Claude',
    reach: 'not-from-tree',
    /* BOTH HALVES, AND THE ORDER MATTERS. The product used to say only the
       second half, on the tier menu, with nowhere to read the first. A person
       was told Claude does not work and sent away from the one screen where it
       already does. */
    /* "It cannot be started from a tree in this copy yet" was the first version
       and it named the wrong thing. Beside the sign-in readout -- which now says
       Claude is installed here and signed in -- "cannot ... yet" reads as a
       fault in the program the person just installed. The constraint is in THIS
       BUILD: the part that drives Claude from a tree is not shipped in it. Said
       that way it stays true the day somebody ships that part, and it stops
       sending a person to check an install that is already correct. */
    /* THIS SENTENCE HAS NOW BEEN WRONG TWICE, IN OPPOSITE DIRECTIONS.
       First it said Claude "cannot start from a tree yet", which read as a fault
       in the program the person had just installed. Then it said Claude "runs
       the work you hand over on the agent page" -- and that page was DRIVEN on
       2026-08-17 and found to have no door from where a refused person stands:
       zero links, zero enabled controls, and `agent` is not on the ring.
       Whether the hand-over itself works is still NOT MEASURED by anyone.
       So it now claims only what is known: the tree cannot start Claude in this
       build, and the person's own sign-in is not the problem. */
    doesHere: 'This copy does not carry the part that starts Claude from a tree. Your sign-in is fine; it is this build that cannot drive it.',
    steps: Object.freeze([
      Object.freeze({ kind: 'command', text: 'npm install -g @anthropic-ai/claude-code', note: 'in Windows Terminal. This one needs Node on the computer first.' }),
      Object.freeze({ kind: 'command', text: 'claude auth login', note: 'in the same window. It opens your browser and signs in to your own account.' }),
      Object.freeze({ kind: 'command', text: 'claude auth status', note: 'tells you whether you are signed in, and on which plan.' }),
    ]),
  }),
  Object.freeze({
    id: 'gemini',
    name: 'Gemini',
    reach: 'none',
    /* THE ONE THAT MUST NOT BE OVERSOLD, and the reason this list is not a menu.
       The program is real and installs fine. Nothing in ToolsEnabled starts it.
       Saying so is the help; offering it would be the defect. */
    doesHere: 'Nothing in this copy starts Gemini yet. You can install it and sign in, and no screen here will use it. It is listed so you are not left guessing.',
    steps: Object.freeze([
      Object.freeze({ kind: 'command', text: 'npm install -g @google/gemini-cli', note: 'in Windows Terminal, if you want it for your own use outside this window.' }),
      Object.freeze({ kind: 'command', text: 'gemini', note: 'run it once. It asks how you want to sign in the first time it starts.' }),
    ]),
  }),
])

/* WHAT THE MACHINE ACTUALLY SAYS ABOUT ONE PROGRAM, IN ONE SENTENCE.
 *
 * THE GAP THIS CLOSES. The list above tells a person what to type. It could not
 * tell them whether they had already typed it, so somebody who installed Codex
 * last week still met three commands and no acknowledgement. shell/provider-cli-presence.cjs
 * answers presence; this turns that answer into the sentence beside the name.
 *
 * 'unknown' GETS A SENTENCE OF ITS OWN AND IS NOT ROUNDED DOWN. Claude and
 * Gemini can both authenticate in ways a file check cannot see -- the operating
 * system keychain, a key in the environment -- so "no sign-in file here" is not
 * "you are signed out". Printing the confident version would tell somebody to
 * re-run a command that already worked, and they would conclude the product is
 * broken. So the uncertain case says what IS known, and points at the one
 * command that answers it properly.
 *
 * IT NEVER CONTRADICTS THE COMMANDS BELOW IT. A program reported installed and
 * signed in still shows its install line, because that line is also the answer
 * to "how do I get this on my other computer". What changes is the sentence at
 * the top, which is the part a person reads first.
 */
export function presenceSentence(presence) {
  /* An ARRAY reaches this branch too, and the first version let it through:
     `typeof [] === 'object'` is true, its `installed` is undefined, and the
     function answered "could not tell whether it is installed" about a value
     that was not a presence record at all. A malformed answer must produce
     NOTHING, so the page hides the line, rather than a sentence that reads like
     a real reading of the machine. The field is checked rather than the shape,
     because that is the thing actually being relied on. */
  if (!presence || typeof presence !== 'object' || Array.isArray(presence)) return null
  const { installed, signedIn } = presence
  if (typeof installed !== 'string' || installed.length === 0) return null
  if (installed === 'no') return 'Not on this computer yet.'
  if (installed !== 'yes') return 'This copy could not tell whether it is installed here.'
  if (signedIn === 'yes') return 'Installed here, and signed in.'
  if (signedIn === 'no') return 'Installed here, but nobody is signed in to it.'
  return 'Installed here. Run the last command below to see whether you are signed in.'
}

/* What DOES work on one computer with nothing connected. A page of things that
   are missing, and nothing else, reads as a broken product; these are real, they
   are reachable from this window, and each one was checked on a sterile profile
   rather than remembered. */
export const WORKS_HERE = Object.freeze([
  'Every agent run started from this window is written down on this computer, signed, and listed on the first page.',
  'The fleet graph draws the organisation this copy declares, and each agent on it opens a page of its own.',
  'The permission level you chose during setup is what a session is built from, and it can be changed in Settings.',
])
