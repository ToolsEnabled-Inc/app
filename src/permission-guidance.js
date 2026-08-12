/* WHAT A SETTING GRANTS, WHAT IT RISKS, AND THE STEP WE WALK YOU THROUGH
 * RATHER THAN TAKE FOR YOU.
 *
 * The owner, R1529, in two messages that are one instruction:
 *
 *   "user settings should restrict and user computer settings should restrict
 *    but users should be prompted and guided through changing the settings and
 *    told what each step does and not pushed to take each step but offered that
 *    its not required and give the additional capabilities vs risks"
 *
 *   "if a user changes a agent setting in our system, and it requires uac
 *    elevtaion we walk them through the way to disable uac checks, we dont do it
 *    for trhem and we let them know the pros and cons and that they dont need to
 *    do it for the setting to be enable but it might not work fully"
 *
 * and then, as an eighth requirement: "additionally we also give them the
 * capabilities and risks granted from each setting of ours" -- not only the ones
 * with an outside step. Every setting.
 *
 * BOTH HALVES ARE BINDING AND NEITHER IS TRADED FOR THE OTHER. The restriction
 * stays real: nothing in this file loosens a default, and nothing here turns
 * anything on. What it does is make every withheld state answer three questions
 * -- what is off, what would turn it on, and what that gains and risks -- so
 * that a person meets an explanation instead of an absence.
 *
 * WHY THIS IS DATA AND NOT COPY WRITTEN AT EACH SURFACE. The product already had
 * one setting whose consequence was written where the choice is made, and it
 * worked; the problem was that it was the only one. A sentence written by hand
 * at each surface is a sentence that exists at whichever surfaces somebody
 * remembered, which is how the same switch came to say one thing on the setup
 * review and nothing at all in Settings. So the statements live here, once, and
 * every surface asks this module rather than authoring its own.
 *
 * THE RISK LINES ARE ALLOWED TO SAY THERE IS NO RISK. Several do. A menacing
 * sentence attached to a row that changes a colour is not caution -- it is how a
 * person learns to skip every risk line in the product, including the ones about
 * sending mail under their name. Where a family of settings genuinely shares one
 * risk (the appearance rows really are all the same), it is declared once as a
 * PROFILE and named by each row, rather than reworded ninety times into ninety
 * slightly different lies.
 *
 * ABSENCE IS NAMED, NEVER FILLED IN. An id with no declaration comes back
 * `declared: false` with a sentence saying so. It does not come back as a
 * setting with no risks, and it does not come back as an empty walkthrough that
 * renders as though a step existed. Absence-as-consent is this codebase's
 * recurring defect and it is not repeated here.
 *
 * NO DOM. Same reason src/setup-profile.js has none: this decides what a
 * stranger is told about their own computer, so it has to be exercisable in
 * `node --test` without a browser.
 */

/* ---------- things outside this product's control ---------- */

/* Each of these is a capability this product DEPENDS ON and DOES NOT PROVIDE.
 * The shape carries the owner's three properties as data rather than as prose,
 * because prose can be rewritten into something else and a literal cannot:
 *
 *   required: false             the in-product setting turns on without this.
 *   neverPerformedForYou: true  we print the step; we do not run it.
 *   withoutIt                   what honestly happens if you decline -- which is
 *                               a partial function stated out loud, never a
 *                               silent failure and never a refusal to save.
 *
 * `elevation: true` marks the ones that need an administrator, which is the case
 * the owner named. This product does not ask Windows for administrator rights,
 * does not weaken any Windows security setting, and does not do either on your
 * behalf. It prints what you would run and leaves the choice with you.
 *
 * ONLY CAPABILITIES THIS PRODUCT ACTUALLY DEPENDS ON APPEAR HERE. There is no
 * entry for a firewall rule or a scheduled task, because nothing this
 * application does needs one: the audited connection it uses is on this computer
 * only. Those two cases are real, and they belong to settings that live in the
 * engine's own catalogue, where they are declared in the same shape. Inventing
 * an app-side one to make this list look complete would be claiming a capability
 * that does not exist. */
export const EXTERNAL_CAPABILITIES = Object.freeze({
  'codex-installed': Object.freeze({
    id: 'codex-installed',
    name: 'Codex installed and signed in on this computer',
    whatItDoes: 'Codex is a separate free program from OpenAI. It is the thing that actually runs an assistant; this product drives it.',
    elevation: false,
    required: false,
    neverPerformedForYou: true,
    steps: Object.freeze([
      Object.freeze({
        do: 'Open Windows Terminal and run:  winget install OpenAI.Codex',
        why: 'This installs it under your own account. It does not need an administrator, and this product does not install software on your computer.',
      }),
      Object.freeze({
        do: 'Then sign in to it:  codex login',
        why: 'The sign-in stays inside Codex. This product never sees or stores that account.',
      }),
    ]),
    verify: 'The home screen stops saying "Not ready yet" and says agents can run on this computer.',
    withoutIt: 'The switch stays on and the Start control appears. Pressing it will report that Codex is not installed or not signed in, and name the command to fix it. Nothing fails quietly and nothing is switched back off behind you.',
  }),
  'codex-cloud-account': Object.freeze({
    id: 'codex-cloud-account',
    name: 'A Codex Cloud account this computer can reach',
    whatItDoes: 'Codex Cloud runs a task on OpenAI’s computers instead of yours. It needs an account there and a working internet connection.',
    elevation: false,
    required: false,
    neverPerformedForYou: true,
    steps: Object.freeze([
      Object.freeze({
        do: 'Sign in to Codex on this computer with an account that has Codex Cloud, using  codex login',
        why: 'The sign-in happens inside Codex. This product never asks for that password and never holds it.',
      }),
    ]),
    verify: 'The Codex Cloud panel on the agent page stops saying it cannot reach the service, and a launch returns a task you can watch.',
    withoutIt: 'The switch stays on and the launch form appears. A launch will report that the service could not be reached, and nothing is started or charged. It is not silently retried somewhere else.',
  }),
  'audited-connection': Object.freeze({
    id: 'audited-connection',
    name: 'The audited connection on this computer',
    whatItDoes: 'The audited connection is the part of this product that carries out an action and writes the permanent record of it. It runs on this computer and is not reachable from anywhere else.',
    elevation: false,
    required: false,
    neverPerformedForYou: true,
    steps: Object.freeze([
      Object.freeze({
        do: 'Leave ToolsEnabled open. The connection starts with it.',
        why: 'It is part of this program, not a separate service you have to install or keep running.',
      }),
      Object.freeze({
        do: 'If a panel says it is unavailable, press Retry on that panel.',
        why: 'It is usually still starting. Nothing outside this computer is involved, so there is nothing to sign in to.',
      }),
    ]),
    verify: 'The panel’s own status line reads "audited bridge ready" and its buttons become usable.',
    withoutIt: 'The switch stays on and the controls appear, disabled, with the reason on the panel. Nothing is sent and nothing is recorded until the connection answers.',
  }),
})

/* Has the outside thing actually been found? Three answers, and the third one
 * is the one that matters: a probe that could not run reports UNKNOWN, and a
 * surface built on this says it could not check rather than picking the
 * convenient side. Reporting "missing" would be alarming and unfounded;
 * reporting "available" would be worse. */
export const CAPABILITY_STATES = Object.freeze(['available', 'missing', 'unknown'])

export function capabilityState(probeResult) {
  if (probeResult === true) return 'available'
  if (probeResult === false) return 'missing'
  return 'unknown'
}

export function externalCapability(id) {
  return EXTERNAL_CAPABILITIES[id] || null
}

/* ---------- what a family of settings grants and risks ---------- */

/* A profile is one honest statement shared by rows that genuinely share it.
 * Naming the same truth once is not boilerplate; rewording it ninety times so
 * each row looks bespoke is. Any row that differs declares its own. */
export const RISK_PROFILES = Object.freeze({
  appearance: Object.freeze({
    capabilities: Object.freeze(['Changes how this app looks on your screen, so you can make it easier on your eyes.']),
    risks: Object.freeze(['None worth the word. This changes what you see, not what this program is allowed to do, what it can reach, or what leaves this computer.']),
  }),
  reading: Object.freeze({
    capabilities: Object.freeze(['Changes how text is sized and spaced, so long screens are easier to read.']),
    risks: Object.freeze(['None worth the word. Nothing about what this program may do changes with it.']),
  }),
  motion: Object.freeze({
    capabilities: Object.freeze(['Changes how much this app animates, which some people find calmer and which uses a little less battery.']),
    risks: Object.freeze(['None worth the word. Turning animation down hides no information; every number it moves is still shown.']),
  }),
  layout: Object.freeze({
    capabilities: Object.freeze(['Changes how a screen arranges what it is already showing you.']),
    risks: Object.freeze(['None worth the word. It rearranges what is on screen and adds or removes nothing.']),
  }),
  performance: Object.freeze({
    capabilities: Object.freeze(['Trades how smooth this app feels against how much battery and processor it uses.']),
    risks: Object.freeze(['None to your files or your privacy. At the cheaper settings screens update more slowly, so what you are looking at can be a few seconds behind.']),
  }),
  demonstration: Object.freeze({
    capabilities: Object.freeze(['Changes the built-in example fleet: how fast it moves and how varied it looks. It is there so you can see what each screen does before you have activity of your own.']),
    risks: Object.freeze(['None. The example is invented data, it is labelled as an example on every screen that shows it, and none of it is ever sent anywhere or mistaken for your own records.']),
  }),
  developer: Object.freeze({
    capabilities: Object.freeze(['Shows extra internal detail, which is useful when you are reporting a problem precisely.']),
    risks: Object.freeze(['None to what this program may do. The extra detail is on your screen only; it is not collected and not sent anywhere.']),
  }),
})

/* Which family each settings section belongs to. A section that is not here has
 * no profile, which is an ABSENCE and is reported as one -- it is not quietly
 * treated as harmless. */
export const SECTION_RISK_PROFILE = Object.freeze({
  Appearance: 'appearance',
  'Text & Reading': 'reading',
  'Motion & Effects': 'motion',
  'Fleet Graph': 'layout',
  Metrics: 'layout',
  'Chat & Threads': 'layout',
  'Comms Board': 'layout',
  Ledger: 'layout',
  Performance: 'performance',
  'Data & Sim': 'demonstration',
  Developer: 'developer',
})

/* ---------- the rows that are not just presentation ---------- */

/* Everything below is a row where the profile above would be a lie, because the
 * row decides something real. Each states its own capabilities and its own
 * risks, and names the outside capability its full function depends on where
 * there is one. */
export const SUBJECTS = Object.freeze({
  /* --- the write actions. src/write-flags.js owns the ids; these explain them. --- */
  'write_dispatch': Object.freeze({
    whatItDoes: 'Shows the form that hands a job to an assistant and starts it working in your folder.',
    capabilities: Object.freeze([
      'You can hand a written job to an assistant and have it work on it in the folder you chose.',
      'Every hand-off is written into this computer’s permanent record, so you can see afterwards exactly what was asked for.',
    ]),
    risks: Object.freeze([
      'An assistant given a job will read and change files inside your chosen folder without asking again for each one.',
      'A job written loosely can be read more broadly than you meant, and the work is done before you see it.',
    ]),
    turnOnAt: 'Settings → Write → Hand out work to agents',
    externalCapability: 'audited-connection',
  }),
  'write_decision': Object.freeze({
    whatItDoes: 'Shows Approve and Decline buttons on the requests in your ledger.',
    capabilities: Object.freeze([
      'You can approve or decline a request from this screen instead of somewhere else.',
      'Each decision is written down and kept, with your reason attached to it.',
    ]),
    risks: Object.freeze([
      'An approval recorded here is what other parts of the system act on, so an approval given by mistake is acted on.',
    ]),
    turnOnAt: 'Settings → Write → Approve or decline',
    externalCapability: 'audited-connection',
  }),
  'write_queue': Object.freeze({
    whatItDoes: 'Shows the controls that take a waiting piece of work or mark one finished.',
    capabilities: Object.freeze([
      'You can claim a queued item so nobody else picks it up, and close it when it is done.',
    ]),
    risks: Object.freeze([
      'Closing an item tells everything else that the work is finished. If it was not, the rest of the system now believes it was.',
    ]),
    turnOnAt: 'Settings → Write → Take or finish queued work',
    externalCapability: 'audited-connection',
  }),
  'write_thread-reply': Object.freeze({
    whatItDoes: 'Lets you type replies into the conversation with your coordinator.',
    capabilities: Object.freeze([
      'You can answer a question from this screen instead of waiting until you are somewhere else.',
    ]),
    risks: Object.freeze([
      'A reply is sent and recorded as soon as you send it, and assistants act on what it says. There is no draft step.',
    ]),
    turnOnAt: 'Settings → Write → Reply to your coordinator',
    externalCapability: 'audited-connection',
  }),
  'write_report-read': Object.freeze({
    whatItDoes: 'Shows an assistant’s written reports on its page.',
    capabilities: Object.freeze([
      'You can read what an assistant wrote about its own work, from inside this app.',
    ]),
    risks: Object.freeze([
      'Very little. This reads a file in your chosen folder and changes nothing. It is here as a switch because reading a file is still reaching your disk, and this product does not do that without being asked.',
    ]),
    turnOnAt: 'Settings → Write → Read agent reports',
    externalCapability: 'audited-connection',
  }),
  'write_agent-session': Object.freeze({
    whatItDoes: 'Puts the Start control on the agent page, so an assistant can be started, watched and stopped from here.',
    capabilities: Object.freeze([
      'A control that starts an assistant exists. Without this there is none anywhere in the program.',
      'You can watch a running session as it works and stop it at any point.',
    ]),
    risks: Object.freeze([
      'A running assistant reads and changes files inside the folder you chose, and does so while you are watching rather than asking about each one.',
      'Turning this on starts nothing by itself. It puts the control there; you decide what to run.',
    ]),
    turnOnAt: 'Settings → Write → Run an agent session',
    externalCapability: 'codex-installed',
  }),
  'write_cloud-launch': Object.freeze({
    whatItDoes: 'Lets you start a task on Codex Cloud, which runs on OpenAI’s computers rather than this one, and watch it from the agent page.',
    capabilities: Object.freeze([
      'Work can run somewhere else while this computer is busy, asleep or switched off.',
      'You can watch a cloud task from the agent page alongside everything running here.',
    ]),
    risks: Object.freeze([
      'A cloud task is real, billable work on someone else’s computers, and once it has been accepted it cannot be cancelled.',
      'Whatever the task is given to work on leaves this computer.',
      'Each launch still asks you for approval first, so nothing starts without a second press.',
    ]),
    turnOnAt: 'Settings → Write → Launch Codex Cloud tasks',
    externalCapability: 'codex-cloud-account',
  }),

  /* --- the rows that decide what a screen is showing you --- */
  'live_view': Object.freeze({
    whatItDoes: 'Decides whether this screen shows your computer’s own records or the built-in example.',
    capabilities: Object.freeze([
      'On, the screen shows what has actually happened on this computer.',
      'Off, it shows the labelled example instead, which is useful on a new install where your own records are still empty.',
    ]),
    risks: Object.freeze([
      'None to your computer. The only cost is confusion, and the product spends it for you: a screen showing the example says so on the screen.',
    ]),
    turnOnAt: 'Settings → Data & Sim',
  }),

  /* --- the rows that decide something durable --- */
  'uninstall_data': Object.freeze({
    whatItDoes: 'Decides what happens to your saved sign-ins, your permanent record of what was done, and your settings when you uninstall this program.',
    capabilities: Object.freeze([
      'On "keep my data", reinstalling later picks up exactly where you left off.',
      'On "remove everything", uninstalling actually removes it, rather than leaving it on the disk after the program is gone.',
    ]),
    risks: Object.freeze([
      'On "keep my data", your saved sign-ins and the permanent record stay on this computer after the program is gone, where anyone using the computer could find them.',
      'On "remove everything", it is gone. There is no undo and no copy kept anywhere else.',
    ]),
    turnOnAt: 'Settings → Data & Privacy',
  }),
  'ledger_archive': Object.freeze({
    whatItDoes: 'Moves finished or superseded requests out of the main list and into the archive.',
    capabilities: Object.freeze([
      'A long list becomes readable again without anything being deleted.',
    ]),
    risks: Object.freeze([
      'Very little. The first press only shows you what would move; nothing moves until you press again, and archiving hides items rather than deleting them.',
    ]),
    turnOnAt: 'Settings → Ledger',
  }),
  'mock_failures': Object.freeze({
    whatItDoes: 'Lets practice error states appear on screens that are actually healthy, so you can see what a failure looks like.',
    capabilities: Object.freeze([
      'You can see how the app reports a problem without waiting for a real one.',
    ]),
    risks: Object.freeze([
      'A screen can show an alarming state that is not real. Leave this on and you will eventually not believe a real one.',
    ]),
    turnOnAt: 'Settings → Developer',
  }),
})

/* The setup walkthrough's own answers. Kept here with everything else so the
   walkthrough, the settings page and the agent page cannot describe one choice
   three ways -- which is precisely what happened before this file existed. */
export const ANSWER_SUBJECTS = Object.freeze({
  observe: Object.freeze({
    whatItDoes: 'Switches on nothing that acts. Every screen still reads and reports.',
    capabilities: Object.freeze([
      'You can look at every screen and read everything before anything is able to run.',
    ]),
    risks: Object.freeze([
      'Nothing on this computer will be able to start an assistant while this is the answer, so there is no Start control to find.',
    ]),
    turnOnAt: 'Settings → Setup → Acting on its own',
  }),
  assisted: Object.freeze({
    whatItDoes: 'Switches on the controls you press yourself, and leaves off everything that would act without you.',
    capabilities: Object.freeze([
      'You can start an assistant, hand it work, read its reports, and start a cloud task.',
      'It stops and asks you whenever it reaches something it needs permission for.',
    ]),
    risks: Object.freeze([
      'An assistant you start reads and changes files inside the folder you chose.',
      'Nothing runs until you press something, and approving, closing queue items and replying stay off.',
    ]),
    turnOnAt: 'Settings → Setup → Acting on its own',
  }),
  autonomous: Object.freeze({
    whatItDoes: 'Switches on everything your permission level allows, including approving and replying.',
    capabilities: Object.freeze([
      'Assistants can approve items, close queued work and reply on your behalf without stopping for you.',
    ]),
    risks: Object.freeze([
      'When an assistant reaches something it needs permission for it uses its own judgement instead of waiting, so work can travel a long way before you read it.',
      'Approvals and replies made this way are recorded as yours.',
    ]),
    turnOnAt: 'Settings → Setup → Acting on its own',
  }),
})

/* ---------- resolving ---------- */

const ABSENT = Object.freeze({
  declared: false,
  whatItDoes: '',
  capabilities: Object.freeze([]),
  risks: Object.freeze([]),
  required: false,
  turnOnAt: '',
  externalCapability: null,
  /* THE SENTENCE FOR AN UNDECLARED SETTING, and it says the true thing rather
     than the reassuring one. "We have not written this yet" is honest; "there
     are no risks" is a claim nobody checked. */
  absenceNote: 'Nobody has written down yet what this one grants and what it risks. Until somebody does, treat that as unknown rather than as nothing.',
})

function frozenGuidance(source) {
  return Object.freeze({
    declared: true,
    whatItDoes: source.whatItDoes || '',
    capabilities: source.capabilities || Object.freeze([]),
    risks: source.risks || Object.freeze([]),
    /* NEVER ANYTHING BUT FALSE, and it is a literal rather than a field a
       caller passes in. No setting in this product is allowed to describe
       itself as required, because the whole directive is that a person is
       offered a step and not pushed into one. */
    required: false,
    turnOnAt: source.turnOnAt || '',
    externalCapability: source.externalCapability || null,
    absenceNote: '',
  })
}

/**
 * What does this subject grant, and what does it risk?
 *
 * @param id  a settings row id (`theme`, `write_dispatch`, `live_home`), or an
 *            answer value from the walkthrough (`observe`).
 * @param options.section  the settings section the row is in, used to fall back
 *            to that family's shared statement. Omitted or unknown falls
 *            through to the honest absence, never to "harmless".
 */
export function describeSubject(id, { section = null } = {}) {
  if (typeof id !== 'string' || id.trim() === '') return ABSENT
  const direct = SUBJECTS[id] || ANSWER_SUBJECTS[id]
  if (direct) return frozenGuidance(direct)
  /* Every per-view live-data row is one control with one meaning, so they share
     one declaration rather than six copies of it that could drift apart. */
  if (id.startsWith('live_')) return frozenGuidance(SUBJECTS.live_view)
  /* A write flag with no declaration is the case that must NOT fall through to
     a family statement: these are the rows that decide what this program may
     do, and an unexplained one has to be visible as unexplained. */
  if (id.startsWith('write_')) return ABSENT
  const profile = RISK_PROFILES[SECTION_RISK_PROFILE[section]]
  if (profile) return frozenGuidance(profile)
  return ABSENT
}

/**
 * The guided step for a subject, with the outside capability's state applied.
 *
 * @param id  the subject id.
 * @param options.probe  a function (capabilityId) -> true | false | anything
 *            else. Anything else is UNKNOWN, and unknown is reported as unknown.
 *            A missing probe is the same as one that could not answer.
 *
 * Returns null when the subject depends on nothing outside this product, so a
 * caller cannot render an empty walkthrough by accident.
 */
export function guidedStepFor(id, { probe = null } = {}) {
  const guidance = describeSubject(id)
  if (!guidance.declared || !guidance.externalCapability) return null
  const capability = externalCapability(guidance.externalCapability)
  if (!capability) return null
  let probed
  try { probed = typeof probe === 'function' ? probe(capability.id) : undefined } catch { probed = undefined }
  const state = capabilityState(probed)
  return Object.freeze({
    capability,
    state,
    /* WHAT WE SAY AT EACH STATE. `unknown` is a first-class answer with its own
       sentence, because "we could not check" and "it is missing" are different
       facts and a person acts on them differently. */
    headline: state === 'available'
      ? `${capability.name} — found on this computer`
      : state === 'missing'
        ? `${capability.name} — not found on this computer`
        : `${capability.name} — this copy could not check`,
    showSteps: state !== 'available',
    withoutIt: capability.withoutIt,
    verify: capability.verify,
    /* Repeated at the point of the step, not only in the summary above it. A
       person reading a list of commands is at the moment they need to be told
       they can walk away from it.
       IT DOES NOT ASSERT THE SWITCH'S CURRENT STATE. It said "it is already on
       and saved", which was written while looking at a switch that was on, and
       read as a lie on the packaged window the first time it was seen under a
       switch that was off -- a small false sentence sitting directly under a
       true one, which is the fastest way to lose a reader. What is true in both
       states is that the step is not what decides it. */
    optionalNote: 'You do not have to do this for the setting to be on. The setting turns on and saves either way; this is what would make it work fully.',
    neverPerformedForYou: capability.neverPerformedForYou,
  })
}

/**
 * The three questions every withheld state has to answer.
 *
 * What is off, what would turn it on, and what that gains and risks. Built from
 * the declarations above so a refusal cannot go vaguer than the setting it is
 * refusing, and cannot go stale when the setting's own statement changes.
 *
 * @param id      the subject that is off.
 * @param label   what to call it in the sentence, usually the row's own name.
 * @param reason  optional: why it is off, when that is more than "it is off".
 */
export function explainWithheld(id, { label = '', reason = '' } = {}) {
  const guidance = describeSubject(id)
  const name = label || id
  if (!guidance.declared) {
    return Object.freeze({
      declared: false,
      what: `${name} is switched off.`,
      whatItDoes: '',
      why: reason || '',
      turnOnAt: '',
      capabilities: Object.freeze([]),
      risks: Object.freeze([]),
      optional: 'It is off, and leaving it off is a complete answer.',
      absenceNote: guidance.absenceNote,
    })
  }
  return Object.freeze({
    declared: true,
    /* The heading is the STATE only. It carried the state and the description in
       one bolded run-on, which read as a paragraph shouted rather than a
       heading; the description is its own line below, where it is read. */
    what: `${name} is switched off.`,
    whatItDoes: guidance.whatItDoes,
    why: reason || '',
    turnOnAt: guidance.turnOnAt,
    capabilities: guidance.capabilities,
    risks: guidance.risks,
    /* THE SENTENCE THE DIRECTIVE IS ABOUT. It is generated for every withheld
       state rather than written per surface, because the one thing a person
       must never have to infer is whether they are being pushed. */
    optional: 'Turning it on is optional. Nothing else stops working while it is off, and you can turn it on later from the place named above.',
    absenceNote: '',
  })
}

/* ---------- the guarantees, checkable ---------- */

/**
 * Every declaration in this file, checked for the properties the directive
 * turns on. Exported so the test suite asserts the real exported values rather
 * than a regex over this file, and so a declaration added later cannot skip it.
 */
export function validateGuidance() {
  const errors = []
  const text = (value) => typeof value === 'string' && value.trim() !== ''
  const list = (value) => Array.isArray(value) && value.length > 0 && value.every(text)

  for (const [id, subject] of [...Object.entries(SUBJECTS), ...Object.entries(ANSWER_SUBJECTS)]) {
    if (!text(subject.whatItDoes)) errors.push(`${id}: whatItDoes must say plainly what it does`)
    if (!list(subject.capabilities)) errors.push(`${id}: capabilities must be a non-empty list of statements`)
    if (!list(subject.risks)) errors.push(`${id}: risks must be a non-empty list of statements`)
    if (!text(subject.turnOnAt)) errors.push(`${id}: turnOnAt must name where the switch is`)
    if (Object.prototype.hasOwnProperty.call(subject, 'required')) errors.push(`${id}: no setting may declare itself required`)
    if (subject.externalCapability && !EXTERNAL_CAPABILITIES[subject.externalCapability]) {
      errors.push(`${id}: names an outside capability that is not declared: ${subject.externalCapability}`)
    }
  }
  for (const [id, profile] of Object.entries(RISK_PROFILES)) {
    if (!list(profile.capabilities)) errors.push(`profile ${id}: capabilities must be a non-empty list`)
    if (!list(profile.risks)) errors.push(`profile ${id}: risks must be a non-empty list`)
  }
  for (const [section, profileId] of Object.entries(SECTION_RISK_PROFILE)) {
    if (!RISK_PROFILES[profileId]) errors.push(`section ${section}: names a profile that does not exist: ${profileId}`)
  }
  for (const [id, capability] of Object.entries(EXTERNAL_CAPABILITIES)) {
    if (capability.id !== id) errors.push(`${id}: declared under a different id than it carries`)
    if (!text(capability.name)) errors.push(`${id}: needs a name`)
    if (!text(capability.whatItDoes)) errors.push(`${id}: needs a plain statement of what it does`)
    if (capability.required !== false) errors.push(`${id}: an outside step may never be required`)
    if (capability.neverPerformedForYou !== true) errors.push(`${id}: must declare that this product never performs the step`)
    if (typeof capability.elevation !== 'boolean') errors.push(`${id}: must say whether the step needs an administrator`)
    if (!text(capability.withoutIt)) errors.push(`${id}: must say what still works without the step`)
    if (!text(capability.verify)) errors.push(`${id}: must say how the person knows it worked`)
    if (!Array.isArray(capability.steps) || capability.steps.length === 0) errors.push(`${id}: needs at least one step`)
    else for (const [index, step] of capability.steps.entries()) {
      if (!text(step.do)) errors.push(`${id}: step ${index} has nothing to do`)
    }
  }
  return { ok: errors.length === 0, errors }
}

/** Ids from a settings catalogue that this file has nothing to say about. */
export function unexplainedSettingIds(settings) {
  if (!Array.isArray(settings)) return []
  return settings
    .filter(setting => !describeSubject(setting?.id, { section: setting?.section }).declared)
    .map(setting => setting?.id)
    .sort()
}
