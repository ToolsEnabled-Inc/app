/* THE PANEL THAT ASKS A PERSON WHAT THE NEW AGENT IS AND WHAT IT SHOULD DO.
 *
 * Owner, on pressing an empty node in the fleet tree: "then they should be able
 * to assign role and message and such from the right side panel".
 *
 * So this is two fields and two buttons. The whole design argument is about what
 * it deliberately does NOT do, because every one of those omissions is a lie
 * this product has told before in some other shape.
 *
 * 1. IT WRITES NO WORDS OF ITS OWN. Every sentence, label, prompt and refusal in
 *    here comes from src/fleet-tree-copy.js, which owns the copy for this whole
 *    flow -- the empty tree, the empty node, this panel, the start, the four
 *    refusals. Six surfaces render one flow, and copy written inline in six
 *    places becomes six voices inside a week. This file's job is which string
 *    goes where and when, never what the string says. Where the flow needs a
 *    string that module does not have, the answer is to get it added there; the
 *    two places that happens are marked below by name.
 *
 * 2. IT STARTS NOTHING. It collects a role and a brief and hands them to a
 *    callback. It never touches the agent runner, never posts to the audited
 *    connection, never writes a node into the tree. That is not a limitation to
 *    be fixed later: a panel that both collects a draft and spawns a child
 *    process has two failure modes wearing one button, and the person cannot
 *    tell which of them happened. The caller owns starting, owns the draft node,
 *    and owns every sentence about whether starting worked. This file owns the
 *    form. The button says "Start this agent" because that is what the person's
 *    press does END TO END, and the copy module is written for the flow rather
 *    than for this module -- so a caller that will NOT start anything must not
 *    mount this panel at all.
 *
 * 3. IT NEVER SHOWS A ROLE KEY. Role keys are join keys in src/vocab.js and mean
 *    nothing outside this repository. roleLabel() is the only way a role is
 *    named here, and a key it does not recognise comes back as the plain word
 *    "Agent" rather than as the key. The key rides on the option's value, which
 *    is where a key belongs -- between two pieces of program.
 *
 * 4. TWO THINGS ON THIS PANEL COME FROM OUTSIDE THIS REPOSITORY, AND THEY BOTH
 *    ARRIVE THROUGH ONE DOOR EACH. The pressed node's NAME, which is only ever
 *    rendered inside START_PANEL.underNamed() -- a name is never put on the
 *    page bare, because a bare name is a fragment a reader has to guess the
 *    meaning of, and it is put there as TEXT and never as markup. And a REFUSAL
 *    SENTENCE from the caller, which the caller is answerable for under the same
 *    plain-language gate. Nothing else: not an id, and never an Error's own
 *    words, which are written for whoever holds the repository and routinely
 *    carry a path, a code or an internal name.
 *
 * 5. IT CAN BE COMPLETED WITHOUT A MOUSE. Every control is a real focusable
 *    element with a real label bound to it by id. Nothing here is a div wearing
 *    a click handler. Escape cancels, because a panel that opens over a keyboard
 *    user's tree and can only be closed by finding a button with the Tab key is
 *    a trap. The refusals are marked as alerts and named in their own field's
 *    description, so a screen reader reads the problem when focus lands on the
 *    field that has it.
 *
 * WHY THE STYLES ARE NOT IMPORTED HERE. src/agent-compose-panel.css is imported
 * by the VIEW that mounts this, the same way src/views/computers.js imports
 * board.css. A `import './agent-compose-panel.css'` in this file would make the
 * module unloadable in `node --test`, which is where every behaviour below is
 * proven; a component that cannot be tested without a browser gets tested by
 * looking at it, which is how the empty states in this product got wrong twice.
 */

import {
  DEFAULT_TIER,
  FIRST_ROLE_SUGGESTION,
  ROLE_CHOICES,
  START_PANEL,
  START_REFUSAL,
  TIER_CHOICES,
  EFFORT_CHOICES,
  effortOptionLabel,
  roleLabel,
  startingLine,
} from './fleet-tree-copy.js'
import { LAUNCH_TIERS } from './orchestration-controls.js'
import { railTitleRowElement } from './rail-title.js'

const asText = value => (typeof value === 'string' ? value : '')
const asTrimmed = value => asText(value).trim()
const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/* Ids have to be unique on the page for `for`/`aria-describedby` to bind, and
   two of these panels can exist at once -- one being closed by a fade while the
   next node's opens. A counter is enough; nothing persists it and nothing reads
   it back. These ids are never rendered as text. */
let panelSequence = 0

/**
 * The roles a person may choose from, as `{ id, label, summary }`.
 *
 * THE LIST IS NOT INVENTED HERE. ROLE_CHOICES in src/fleet-tree-copy.js is the
 * product's own pick list: its labels are read from src/vocab.js ROLES at load,
 * so a profile that renames a role renames it here too, and it leaves out the
 * one role nobody hands out -- "Agent spawned" is what an agent BECOMES when
 * another agent starts it, not a job. That reasoning belongs with the copy, and
 * this file defers to it rather than filtering the vocabulary itself.
 *
 * A caller may pass a narrower list, because the tree owner may know something
 * this form does not. Three shapes are accepted, since three already exist on
 * this tree: `{ role, label }` (the copy module's own), `{ id, label }`, and a
 * bare array of role keys. A LABEL IS NEVER REQUIRED and a key is never printed
 * when one is missing: roleLabel() supplies the word, and answers "Agent" for a
 * key it does not know.
 *
 * AN EMPTY RESULT FALLS BACK TO THE PRODUCT'S OWN LIST rather than rendering an
 * empty menu under a live button. A form nobody can complete needs a sentence
 * saying why, that sentence would have to be invented here, and a caller that
 * hands over nothing is a wiring fault rather than a state a person can reach.
 * If a real "no role can be assigned in this tree" state ever exists, it needs
 * its own sentence in src/fleet-tree-copy.js and its own branch here.
 */
export function assignableRoles(source = ROLE_CHOICES) {
  const entries = []
  const seen = new Set()
  const add = (id, label, summary) => {
    const key = asTrimmed(id)
    if (!key || seen.has(key)) return
    seen.add(key)
    entries.push(Object.freeze({ id: key, label: asTrimmed(label) || roleLabel(key), summary: asTrimmed(summary) }))
  }

  if (Array.isArray(source)) {
    for (const entry of source) {
      if (typeof entry === 'string') add(entry, '', '')
      else if (isRecord(entry)) add(entry.role || entry.id || entry.key, entry.label, entry.summary)
    }
  } else if (isRecord(source)) {
    for (const [id, entry] of Object.entries(source)) {
      add(id, isRecord(entry) ? entry.label : entry, isRecord(entry) ? entry.summary : '')
    }
  }

  return Object.freeze(entries.length > 0 ? entries : assignableRoles(ROLE_CHOICES))
}

/**
 * What is wrong with the draft, as one sentence per problem.
 *
 * A pure function, separate from the DOM on purpose: refusals are the part of a
 * form that a screenshot never proves and a unit test proves exactly. Returns an
 * empty list when the draft may be handed over.
 *
 * Both sentences are START_PANEL's, so this file cannot drift from the rest of
 * the flow's voice. A role that is not on the list gets the same sentence as no
 * role at all: it is only reachable when a caller sets a value from outside the
 * menu, the person's next move is identical, and a second sentence for a state
 * nobody can reach by pressing things is a sentence nobody has proofread.
 *
 * @returns [{ field: 'role'|'message', sentence: string }]
 */
export function composeDraftProblems({ role = '', message = '', roles = ROLE_CHOICES } = {}) {
  const choices = assignableRoles(roles)
  const picked = asTrimmed(role)
  const problems = []

  if (!picked || !choices.some(choice => choice.id === picked)) {
    problems.push({ field: 'role', sentence: START_PANEL.needRole })
  }
  if (!asTrimmed(message)) {
    problems.push({ field: 'message', sentence: START_PANEL.needMessage })
  }

  return Object.freeze(problems.map(problem => Object.freeze(problem)))
}

/* Built element by element, never from a markup string, and every string in it
   comes from src/fleet-tree-copy.js. `underLine` is the one place a name the
   caller supplied reaches the page, already wrapped in the copy module's own
   sentence before it gets here. */
function buildPanel(doc, { choices, newTree, underLine }) {
  const id = `agent-compose-${panelSequence += 1}`

  const root = doc.createElement('section')
  root.className = 'agent-compose'
  root.setAttribute('data-agent-compose', 'open')
  root.setAttribute('aria-labelledby', `${id}-title`)

  /* The nav row first, so Cancel sits in the SAME back slot every rail page
     puts its back button in (owner defect 6: no mouse travel between pages).
     Cancel keeps its honest word -- this button discards a draft, it does not
     merely navigate -- but it lives where the going-back muscle memory already
     points. Same element, same data attribute, same disable wiring as when it
     sat at the bottom. NO aria-label: the visible words ARE the declared copy,
     and an accessible name that differs from them fails both the speech-input
     rule and agent-start-flow-qa's copy check -- measured, not hypothetical.
     The panel's title rides in the row's own title slot rather than a second
     heading element: the row was already there, and the heading's 30px was
     exactly what pushed Start below the fold of an 832px window. */
  const nav = railTitleRowElement(doc, {
    back: { label: START_PANEL.cancel, attrs: { 'data-compose-action': 'cancel' } },
    title: START_PANEL.title,
    titleId: `${id}-title`,
  })
  root.appendChild(nav.row)
  const cancel = nav.backButton

  /* EVERYTHING BELOW THE NAV ROW SCROLLS, and it has to.
     The rail is a fixed box (`.rail { overflow: hidden }`) whose pages are
     `position: absolute; inset: 0`, so this panel can never make the rail
     taller -- it can only overflow it and be clipped. That is exactly what
     happened: the owner reported "I cant scroll down to even press start",
     because this panel wants ~810px and the rail gives 560-700 on an
     ordinary window. The previous answer was to buy 30px by deleting a
     heading, and the next feature (the effort row) spent it 3.6x over.
     A budget is not a fix; a scroller is. `.rail-scroll` is the same class
     the stats page and the Details tab already scroll with, so this panel
     now behaves like every other rail page: the nav row stays put and the
     form scrolls under it. */
  const body = doc.createElement('div')
  body.className = 'rail-scroll agent-compose-body'
  body.setAttribute('data-compose-body', 'form')
  root.appendChild(body)

  /* "Two answers and it runs" -- a person looking at a new panel is deciding
     whether this is a form they can finish, and the length is the answer. */
  const intro = doc.createElement('p')
  intro.className = 'agent-compose-intro'
  intro.textContent = START_PANEL.intro
  body.appendChild(intro)

  /* WHERE THIS AGENT IS GOING, which is the one question a person has after
     pressing a spot in a tree. Absent on an empty tree: there is nothing to go
     under yet, and the suggestion below is the line that belongs there. */
  if (underLine) {
    const under = doc.createElement('p')
    under.className = 'agent-compose-under'
    under.setAttribute('data-compose-under', 'parent')
    /* textContent, so a node named by nobody on this team is characters. */
    under.textContent = underLine
    body.appendChild(under)
  }

  /* THE FIRST AGENT ON AN EMPTY TREE IS THE ONE EVERYTHING ELSE HANGS UNDER, so
     the suggestion is shown only there. On a tree that already has agents the
     person has done this before and does not need it. It is a suggestion about
     SHAPE and it selects nothing: pre-picking a role would answer the panel's
     own question for them. */
  if (newTree) {
    const suggestion = doc.createElement('p')
    suggestion.className = 'agent-compose-suggestion'
    suggestion.setAttribute('data-compose-suggestion', 'first-role')
    suggestion.textContent = FIRST_ROLE_SUGGESTION.line
    body.appendChild(suggestion)
  }

  /* THE PANEL-WIDE LINE, and it carries two different kinds of news. A refusal
     that came back from the caller is an alert, because it is the answer to a
     button the person just pressed. A stated absence handed in by the caller
     before anything is pressed is not urgent and would interrupt a screen
     reader mid-sentence, so the role is set per message rather than fixed
     here. */
  const notice = doc.createElement('p')
  notice.className = 'agent-compose-notice'
  notice.setAttribute('data-compose-notice', 'panel')
  notice.setAttribute('hidden', 'hidden')
  body.appendChild(notice)

  const roleField = doc.createElement('div')
  roleField.className = 'agent-compose-field'
  const roleLabelNode = doc.createElement('label')
  roleLabelNode.className = 'cl'
  roleLabelNode.setAttribute('for', `${id}-role`)
  roleLabelNode.textContent = START_PANEL.roleLabel
  const roleHint = doc.createElement('p')
  roleHint.className = 'agent-compose-hint'
  roleHint.setAttribute('id', `${id}-role-hint`)
  roleHint.textContent = START_PANEL.roleHelp
  const roleSelect = doc.createElement('select')
  roleSelect.className = 'agent-compose-select'
  roleSelect.setAttribute('id', `${id}-role`)
  roleSelect.setAttribute('data-compose-field', 'role')
  /* The problem line is named as a description from the start, empty or not. An
     empty description is ignored by a screen reader, and swapping the attribute
     in and out is one more piece of state to get wrong. */
  roleSelect.setAttribute('aria-describedby', `${id}-role-hint ${id}-role-problem`)
  /* THE FIRST ROW CARRIES NO ROLE. A menu must have something selected, and
     pre-selecting a real role would answer the panel's own question for the
     person and let a role nobody chose through on one press. So the first row
     is the copy module's prompt, its value is empty, and composeDraftProblems()
     below refuses it -- it is a place to stand, never an answer. */
  const placeholder = doc.createElement('option')
  placeholder.value = ''
  placeholder.textContent = START_PANEL.rolePrompt
  roleSelect.appendChild(placeholder)
  for (const choice of choices) {
    const option = doc.createElement('option')
    /* The key rides on the value, where only the program reads it. The label is
       the only part with a reader. */
    option.value = choice.id
    option.textContent = choice.label
    roleSelect.appendChild(option)
  }
  roleSelect.value = ''
  /* WHERE THE ROLE SUMMARIES GO. Each choice carries a line about where that
     role sits in the tree, and a menu cannot show five of them at once. The
     line for the CHOSEN role appears here and changes with the choice, so the
     words are read at the moment they are useful and the rail keeps its
     height. */
  const roleSummary = doc.createElement('p')
  roleSummary.className = 'agent-compose-summary'
  roleSummary.setAttribute('data-compose-summary', 'role')
  roleSummary.setAttribute('hidden', 'hidden')
  const roleProblem = doc.createElement('p')
  roleProblem.className = 'agent-compose-problem'
  roleProblem.setAttribute('id', `${id}-role-problem`)
  roleProblem.setAttribute('data-compose-problem', 'role')
  roleProblem.setAttribute('role', 'alert')
  roleField.appendChild(roleLabelNode)
  roleField.appendChild(roleHint)
  roleField.appendChild(roleSelect)
  roleField.appendChild(roleSummary)
  roleField.appendChild(roleProblem)
  body.appendChild(roleField)

  /* THE MODEL MENU. Unlike the role menu it arrives ANSWERED -- the engine has
     a default, so the default is preselected and there is no placeholder row
     and no problem line: every row is a valid answer, and the three Claude
     rows answer with a refusal sentence from the shell when pressed, which is
     the honest version of a model this build cannot start. */
  const tierField = doc.createElement('div')
  tierField.className = 'agent-compose-field'
  const tierLabelNode = doc.createElement('label')
  tierLabelNode.className = 'cl'
  tierLabelNode.setAttribute('for', `${id}-tier`)
  tierLabelNode.textContent = START_PANEL.tierLabel
  const tierHint = doc.createElement('p')
  tierHint.className = 'agent-compose-hint'
  tierHint.setAttribute('id', `${id}-tier-hint`)
  tierHint.textContent = START_PANEL.tierHelp
  const tierSelect = doc.createElement('select')
  tierSelect.className = 'agent-compose-select'
  tierSelect.setAttribute('id', `${id}-tier`)
  tierSelect.setAttribute('data-compose-field', 'tier')
  tierSelect.setAttribute('aria-describedby', `${id}-tier-hint`)
  for (const choice of TIER_CHOICES) {
    const option = doc.createElement('option')
    /* Same split as the role menu: the id rides on the value, the label is the
       only part with a reader. */
    option.value = choice.id
    option.textContent = choice.label
    tierSelect.appendChild(option)
  }
  tierSelect.value = DEFAULT_TIER
  tierField.appendChild(tierLabelNode)
  tierField.appendChild(tierHint)
  tierField.appendChild(tierSelect)

  /* EFFORT RIDES BESIDE THE TIER (owner, iteration 5: "I need to be able to
     choose effort levels when starting an agent … just like vscode"). The
     menu re-defaults to the tier's own effort whenever the tier changes, so
     an untouched row means the tier's judgment — a person only overrides it
     by choosing. */
  const effortField = doc.createElement('div')
  effortField.className = 'agent-compose-field'
  const effortLabelNode = doc.createElement('label')
  effortLabelNode.className = 'cl'
  effortLabelNode.setAttribute('for', `${id}-effort`)
  effortLabelNode.textContent = START_PANEL.effortLabel
  const effortHint = doc.createElement('p')
  effortHint.className = 'agent-compose-hint'
  effortHint.setAttribute('id', `${id}-effort-hint`)
  effortHint.textContent = START_PANEL.effortHelp
  const effortSelect = doc.createElement('select')
  effortSelect.className = 'agent-compose-select'
  effortSelect.setAttribute('id', `${id}-effort`)
  effortSelect.setAttribute('data-compose-field', 'effort')
  effortSelect.setAttribute('aria-describedby', `${id}-effort-hint`)
  for (const choice of EFFORT_CHOICES) {
    const option = doc.createElement('option')
    option.value = choice.id
    /* The provider's name leads, its own sentence explains — and the line is
       composed in the copy module, which owns every word this panel shows. */
    option.textContent = effortOptionLabel(choice)
    effortSelect.appendChild(option)
  }
  const tierEffort = (tierId) => LAUNCH_TIERS.find(tier => tier.id === tierId)?.effort || 'medium'
  effortSelect.value = tierEffort(DEFAULT_TIER)
  tierSelect.addEventListener('change', () => { effortSelect.value = tierEffort(tierSelect.value) })
  effortField.appendChild(effortLabelNode)
  effortField.appendChild(effortHint)
  effortField.appendChild(effortSelect)

  const messageField = doc.createElement('div')
  messageField.className = 'agent-compose-field'
  const messageLabel = doc.createElement('label')
  messageLabel.className = 'cl'
  messageLabel.setAttribute('for', `${id}-message`)
  messageLabel.textContent = START_PANEL.messageLabel
  const messageHint = doc.createElement('p')
  messageHint.className = 'agent-compose-hint'
  messageHint.setAttribute('id', `${id}-message-hint`)
  messageHint.textContent = START_PANEL.messageHelp
  const messageInput = doc.createElement('textarea')
  messageInput.className = 'agent-compose-text'
  messageInput.setAttribute('id', `${id}-message`)
  messageInput.setAttribute('data-compose-field', 'message')
  messageInput.setAttribute('rows', '4')
  /* An example of a real job, not a label in disguise: the question is in the
     bound label above, which stays on screen once typing starts. */
  messageInput.setAttribute('placeholder', START_PANEL.messagePlaceholder)
  messageInput.setAttribute('aria-describedby', `${id}-message-hint ${id}-message-problem`)
  messageInput.value = ''
  const messageProblem = doc.createElement('p')
  messageProblem.className = 'agent-compose-problem'
  messageProblem.setAttribute('id', `${id}-message-problem`)
  messageProblem.setAttribute('data-compose-problem', 'message')
  messageProblem.setAttribute('role', 'alert')
  messageField.appendChild(messageLabel)
  messageField.appendChild(messageHint)
  messageField.appendChild(messageInput)
  messageField.appendChild(messageProblem)
  /* THE TWO ANSWERS FIRST. This file's own header calls the panel "two fields
     and two buttons": a role and a brief. The assistant and effort choices were
     added later and both carry two lines of help, which pushed the brief -- the
     one thing a person opens this panel to write -- off the bottom of the rail
     at first paint. Measured on installed 1.0.22: role visible, brief not.
     Nothing is removed by this order; the later choices keep their defaults and
     their words, and now sit under the question they qualify. */
  body.appendChild(messageField)
  body.appendChild(tierField)
  body.appendChild(effortField)

  /* START DOES NOT SCROLL. IT IS THE POINT OF THE PANEL.
     Owner, twice, months apart: "I cant scroll down to even press start" and
     then "there is no way to start an agent". The first was answered by making
     the form scroll -- which fixed reachability and NOT visibility, because the
     button went into the scroller with everything else. Measured on the
     installed 1.0.21: the form wants about 765px, the rail gives 560-700, so
     the action row began roughly 100px BELOW the fold and the first thing a
     person saw was a form with no way to finish it. A control that exists but
     is off-screen at first paint is, to the person looking at it, absent.
     So Start lives OUTSIDE the scroller, as a sibling of it, exactly as the
     nav row above does: the form scrolls between them and both ends stay put.
     Keep it here -- moving it back into `body` re-creates the owner's defect
     without changing a single visible pixel in a unit test. */
  const actions = doc.createElement('div')
  actions.className = 'agent-compose-actions'
  const submit = doc.createElement('button')
  submit.className = 'ctl-btn agent-compose-submit'
  submit.type = 'button'
  submit.setAttribute('type', 'button')
  submit.setAttribute('data-compose-action', 'submit')
  submit.textContent = START_PANEL.submit
  /* Cancel is built with the nav row at the top of this function; only Start
     remains down here, full-width in the action row. */
  actions.appendChild(submit)
  root.appendChild(actions)

  /* Progress, not problems, and polite on purpose. The wait is the part people
     distrust: a start crosses a background service and a program that is not
     this one, and a button that goes quiet is where somebody presses it a
     second time. */
  /* The progress line rides WITH the button, outside the scroller, for the same
     reason the button does: it answers the press, and an answer a person has to
     scroll to find reads as no answer at all. */
  const status = doc.createElement('p')
  status.className = 'agent-compose-status'
  status.setAttribute('data-compose-status', 'panel')
  status.setAttribute('role', 'status')
  status.setAttribute('hidden', 'hidden')
  root.appendChild(status)

  return { root, roleSelect, tierSelect, effortSelect, messageInput, roleSummary, roleProblem, messageProblem, notice, status, submit, cancel }
}

/**
 * Put the compose panel on the page and hand back a handle.
 *
 * MOUNTING RENDERS IT AT ONCE, because the gesture that creates this panel is a
 * press on an empty node -- there is no state in which it exists and is not
 * wanted. A caller that would rather keep one panel for the whole page calls
 * `open()` again with the next node and `close()` when it is done.
 *
 * @param doc                the document. Passed in so the whole component runs
 *                           under `node --test` against a small fake.
 * @param container          the element to mount into. Required: a component
 *                           with nowhere to go builds nothing and says so by
 *                           returning null, rather than appending to the body of
 *                           whatever page happens to be loaded.
 * @param parent             the node that was pressed, `{ id, name }`, or null
 *                           when this begins a new tree. The id travels in the
 *                           draft and is never rendered -- an id in a sentence
 *                           is the defect tools/check-plain-language.mjs exists
 *                           to catch. The name is optional and is rendered only
 *                           inside START_PANEL.underNamed(); a node with no name
 *                           gets the sentence written for that case, never a
 *                           blank line.
 * @param roles              the assignable roles. Defaults to the product's own.
 * @param onSubmit           called with `{ role, tier, message, parentId }` when the
 *                           draft is complete. May return nothing, or
 *                           `{ ok: false, message }` to refuse, or a promise of
 *                           either. While a promise is in flight the panel is
 *                           busy and cannot be pressed again.
 * @param onCancel           called when the person discards the draft.
 * @param unavailableReason  a sentence from the caller saying why nothing can be
 *                           started right now -- startRefusalSentence() in
 *                           src/fleet-tree-copy.js produces it. When set, the
 *                           fields and the primary action are switched off and
 *                           the sentence is shown. Cancel stays live, because a
 *                           panel a person cannot close is worse than the
 *                           refusal.
 */
export function mountAgentComposePanel({
  doc = typeof document === 'undefined' ? null : document,
  container = null,
  parent = null,
  roles = ROLE_CHOICES,
  onSubmit = null,
  onCancel = null,
  unavailableReason = '',
} = {}) {
  if (!doc || typeof doc.createElement !== 'function' || !container) return null

  let current = { parent, roles, unavailableReason: asTrimmed(unavailableReason) }
  let nodes = null
  let destroyed = false
  let busy = false
  /* Every handover gets a number, and a late answer that does not carry the
     current number is dropped. Without it, a caller that takes four seconds to
     start an agent can paint a refusal onto the panel the person has since
     re-opened over a DIFFERENT node -- a sentence about the wrong tree. */
  let attempt = 0

  const removeRoot = () => {
    if (nodes?.root?.parentNode) nodes.root.parentNode.removeChild(nodes.root)
    nodes = null
    busy = false
  }

  const setLine = (element, sentence, liveRole) => {
    if (!element) return
    const words = asTrimmed(sentence)
    element.textContent = words
    if (words) {
      element.removeAttribute?.('hidden')
      if (liveRole) element.setAttribute('role', liveRole)
    } else {
      element.setAttribute('hidden', 'hidden')
    }
  }

  const markInvalid = (field, invalid) => {
    if (!field) return
    if (invalid) field.setAttribute('aria-invalid', 'true')
    else field.removeAttribute?.('aria-invalid')
  }

  const clearProblems = () => {
    if (!nodes) return
    setLine(nodes.roleProblem, '')
    setLine(nodes.messageProblem, '')
    markInvalid(nodes.roleSelect, false)
    markInvalid(nodes.messageInput, false)
  }

  const paintProblems = (problems) => {
    if (!nodes) return
    const byField = new Map(problems.map(problem => [problem.field, problem.sentence]))
    setLine(nodes.roleProblem, byField.get('role') || '')
    setLine(nodes.messageProblem, byField.get('message') || '')
    markInvalid(nodes.roleSelect, byField.has('role'))
    markInvalid(nodes.messageInput, byField.has('message'))
    /* Focus goes to the first field a person has to fix, in reading order. A
       refusal a keyboard user has to go looking for is a refusal they will read
       as the button being broken. */
    if (byField.has('role')) nodes.roleSelect.focus?.()
    else if (byField.has('message')) nodes.messageInput.focus?.()
  }

  const paintRoleSummary = () => {
    if (!nodes) return
    const picked = asTrimmed(nodes.roleSelect.value)
    const choice = assignableRoles(current.roles).find(entry => entry.id === picked)
    setLine(nodes.roleSummary, choice?.summary || '')
  }

  const setBusy = (working) => {
    busy = working
    if (!nodes) return
    const stopped = current.unavailableReason ? true : working
    nodes.submit.disabled = stopped
    nodes.roleSelect.disabled = stopped
    nodes.tierSelect.disabled = stopped
    nodes.messageInput.disabled = stopped
    /* Cancel goes dead ONLY while a handover is in flight. The caller is part
       way through starting something; a cancel here would discard the draft
       while the work it describes carries on, and the person would be told the
       opposite of what happened. */
    nodes.cancel.disabled = working
    /* Named by role, so the wait says what is being started rather than only
       that something is. */
    setLine(nodes.status, working ? startingLine(asTrimmed(nodes.roleSelect.value)) : '')
  }

  const currentDraft = () => ({
    role: asTrimmed(nodes?.roleSelect?.value),
    /* Always a real row: the menu preselects DEFAULT_TIER and has no empty
       first row. The fallback below is for a hand-broken DOM only, and it
       falls back to the same default the engine would apply, never to
       nothing. */
    tier: asTrimmed(nodes?.tierSelect?.value) || DEFAULT_TIER,
    /* The effort key rides beside the tier; an untouched menu carries the
       tier's own default, so this is never an invented fifth value. */
    effort: asTrimmed(nodes?.effortSelect?.value) || null,
    message: asText(nodes?.messageInput?.value).trim(),
    parentId: isRecord(current.parent) ? asTrimmed(current.parent.id) || null : null,
  })

  const showNotice = (sentence, liveRole) => {
    if (!nodes) return
    setLine(nodes.notice, sentence, liveRole)
  }

  const settle = (outcome, token) => {
    if (destroyed || !nodes || token !== attempt) return
    setBusy(false)
    if (isRecord(outcome) && outcome.ok === false) {
      /* The caller's own sentence, because the caller is the only one who knows
         what went wrong -- startRefusalSentence() turns a refusal of any shape
         into one. A refusal that arrives with no words gets the flow's own
         sentence for a start that failed and said nothing. */
      showNotice(asTrimmed(outcome.message) || START_REFUSAL.noReasonGiven, 'alert')
      return
    }
    close()
  }

  function attemptSubmit() {
    if (!nodes || busy || destroyed) return
    if (current.unavailableReason) {
      showNotice(current.unavailableReason, 'alert')
      return
    }
    const draft = currentDraft()
    const problems = composeDraftProblems({ ...draft, roles: current.roles })
    clearProblems()
    showNotice('')
    if (problems.length > 0) {
      paintProblems(problems)
      return
    }
    if (typeof onSubmit !== 'function') {
      /* Nothing to hand the work to: a fault in this copy of the app, not
         something the person did. Its own sentence rather than the one for a
         start that failed -- that one says "try once more", and pressing again
         here can never work. */
      showNotice(START_REFUSAL.notWired, 'alert')
      return
    }
    const token = attempt += 1
    let outcome
    try {
      outcome = onSubmit(draft)
    } catch (error) {
      /* Deliberately NOT error.message. See point 4 in the header. */
      showNotice(START_REFUSAL.noReasonGiven, 'alert')
      return
    }
    if (!outcome || typeof outcome.then !== 'function') {
      settle(outcome, token)
      return
    }
    setBusy(true)
    outcome.then(
      value => settle(value, token),
      () => {
        if (destroyed || !nodes || token !== attempt) return
        setBusy(false)
        showNotice(START_REFUSAL.noReasonGiven, 'alert')
      },
    )
  }

  function cancel() {
    if (!nodes || busy || destroyed) return
    close()
    if (typeof onCancel === 'function') onCancel()
  }

  function close() {
    removeRoot()
  }

  function render() {
    if (destroyed) return null
    /* EVERY RENDER INVALIDATES WHATEVER IS IN FLIGHT. Re-opening the panel over
       another node is the person moving on, and the answer to the handover they
       started a moment ago is now news about a tree they are no longer looking
       at. Bumping the token here is what makes that answer land nowhere. */
    attempt += 1
    removeRoot()
    /* THE THREE CASES, AND EACH ONE IS A DIFFERENT FACT. An empty tree has
       nothing to go under and gets the suggestion instead. A node with a name
       is named, inside the copy module's sentence. A node this app cannot name
       gets the sentence written for exactly that -- never a blank line, and
       never its id. */
    const parentName = isRecord(current.parent)
      ? asTrimmed(current.parent.name) || asTrimmed(current.parent.label)
      : ''
    let underLine = ''
    if (isRecord(current.parent)) {
      underLine = parentName ? START_PANEL.underNamed(parentName) : START_PANEL.underUnnamed
    }

    nodes = buildPanel(doc, {
      choices: assignableRoles(current.roles),
      newTree: !isRecord(current.parent),
      underLine,
    })

    nodes.submit.addEventListener('click', () => attemptSubmit())
    nodes.cancel.addEventListener('click', () => cancel())
    /* Escape from anywhere inside the panel. The listener sits on the root and
       reads the event that bubbles to it, so it never touches the document and
       cannot swallow a key press meant for the page behind it. */
    nodes.root.addEventListener('keydown', (event) => {
      if (event?.key === 'Escape') {
        event.preventDefault?.()
        cancel()
      }
    })
    /* A refusal about a field stops being true the moment the person edits that
       field. Leaving it on screen teaches people to ignore the red line. */
    nodes.roleSelect.addEventListener('change', () => {
      setLine(nodes.roleProblem, '')
      markInvalid(nodes.roleSelect, false)
      paintRoleSummary()
    })
    nodes.messageInput.addEventListener('input', () => {
      setLine(nodes.messageProblem, '')
      markInvalid(nodes.messageInput, false)
    })

    container.appendChild(nodes.root)

    if (current.unavailableReason) {
      showNotice(current.unavailableReason, 'status')
      nodes.submit.disabled = true
      nodes.roleSelect.disabled = true
      nodes.messageInput.disabled = true
    }
    return nodes.root
  }

  render()

  return {
    element: () => nodes?.root || null,
    isOpen: () => Boolean(nodes),
    /** Point the panel at another node. The previous draft is discarded. */
    open(next = {}) {
      if (destroyed) return null
      current = {
        parent: 'parent' in next ? next.parent : current.parent,
        roles: 'roles' in next ? next.roles : current.roles,
        unavailableReason: 'unavailableReason' in next ? asTrimmed(next.unavailableReason) : current.unavailableReason,
      }
      return render()
    },
    /** Take it off the page and discard the draft. No callback: closing is not cancelling. */
    close,
    /** The draft as it stands, in the shape the callback receives. */
    draft: () => (nodes ? currentDraft() : null),
    /** Move focus to the first field, for a caller that opens this from a key press. */
    focus: () => { nodes?.roleSelect?.focus?.() },
    /**
     * Show the caller's own refusal sentence on the panel.
     *
     * For a caller that reports a failure LATER -- after the panel has already
     * been told the handover was accepted. Produce the sentence with
     * startRefusalSentence() in src/fleet-tree-copy.js; this file will not
     * invent one, and it will not print a code.
     */
    showProblem: (sentence) => {
      if (!nodes) return
      /* This ends the handover it is reporting on. Without the bump, a caller
         that says "this failed" and then lets its own promise resolve happily
         would close the panel out from under the sentence it just showed --
         the person reads a failure and watches the form vanish. */
      attempt += 1
      setBusy(false)
      showNotice(asTrimmed(sentence) || START_REFUSAL.noReasonGiven, 'alert')
    },
    destroy: () => {
      destroyed = true
      removeRoot()
    },
  }
}
