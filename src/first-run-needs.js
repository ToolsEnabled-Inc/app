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
    body: 'This screen draws a report written by an agent host: a program that watches the agents running on a group of computers and writes down what they are doing. No agent host has reported to this copy, so there is nothing here to draw. Nothing on this computer is broken, and nothing is missing from the install.',
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
    body: 'ToolsEnabled does not contain the program that runs an agent. Codex does, and it is a separate install. Once it is on this computer and signed in, the agent page can start a session and every run is written down on this computer before it begins.',
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
    body: 'The box on the first page has no place to type because sending replies is switched off, and because there is no coordinator on this computer to send one to. Turning the switch on is worth doing so the box is ready, and it will stay quiet until an agent host reports here.',
    steps: Object.freeze([
      Object.freeze({ kind: 'switch', text: 'Turn on "Coordinator replies"', note: 'in Settings, under Write.', href: SETTINGS_HREF }),
    ]),
  }),
])

/* What DOES work on one computer with nothing connected. A page of things that
   are missing, and nothing else, reads as a broken product; these are real, they
   are reachable from this window, and each one was checked on a sterile profile
   rather than remembered. */
export const WORKS_HERE = Object.freeze([
  'Every agent run started from this window is written down on this computer, signed, and listed on the first page.',
  'The fleet graph draws the organisation this copy declares, and each agent on it opens a page of its own.',
  'The permission level you chose during setup is what a session is built from, and it can be changed in Settings.',
])
