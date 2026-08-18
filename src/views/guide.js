/* /guide — the page every empty screen in this product now points at.
 *
 * WHY THERE IS A PAGE AND NOT A LONGER SENTENCE. The four screens a stranger
 * reaches first (home, the fleet graph, the comms board, settings) each had a
 * true refusal on them and no answer anywhere in the product. The fix cannot be
 * to print the whole explanation on each of the four: it is three paragraphs,
 * the four screens would drift, and the fleet graph would end up as a page of
 * apology with a graph somewhere underneath it. So each screen says the one
 * sentence that belongs to it and offers this door.
 *
 * IT IS DELIBERATELY NOT A RING STOP. The chevrons walk home -> computers ->
 * metrics -> research -> comms -> ledger -> approvals -> checkout, which is the
 * product; a page about the product's prerequisites is not a stop on that tour
 * any more than the sign-in screen is. It behaves like `account`: reached by
 * link, and both arrows return home from it (RING_EXIT in src/main.js).
 *
 * EVERY WORD ON IT COMES FROM src/first-run-needs.js. This file is a renderer.
 * That is the same division of labour src/local-activity.js and the home screen
 * use, and for the same reason: copy that lives inside a render function can only
 * be checked by reading the render function, and tools/test/first-run-needs.test.mjs
 * can only walk sentences if they are values.
 */

import { el } from '../components.js'
import { ACCOUNT_PANEL, CLAUDE_ACCOUNT_RISK } from '../account-panel-copy.js'
import {
  FIRST_RUN_NEEDS,
  PROVIDER_SETUP,
  SETTINGS_HREF,
  WORKS_HERE,
  presenceSentence,
} from '../first-run-needs.js'
import '../guide.css'

const esc = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

/* A step is either a line a person types or a switch a person flips, and the
   two are drawn differently on purpose: a command is monospaced and selectable
   because it is going to be copied, and a switch carries the link to the screen
   that holds it because "in Settings" without a way there is half an
   instruction. A step with no href gets no link rather than a dead one. */
function stepMarkup(step) {
  const isCommand = step.kind === 'command'
  const body = isCommand
    ? `<code class="guide-command">${esc(step.text)}</code>`
    : `<span class="guide-step-do">${esc(step.text)}</span>`
  const link = !isCommand && typeof step.href === 'string' && step.href
    ? `<a class="guide-step-link" href="${esc(step.href)}">Open Settings</a>`
    : ''
  return `<li class="guide-step" data-step-kind="${esc(step.kind)}">
    ${body}
    <span class="guide-step-note">${esc(step.note)}</span>
    ${link}
  </li>`
}

/* `fix` is the honest half of each entry and it is the one thing on this page a
   person must not misread, so it is a visible word and not only a class name.
   "Nothing to turn on" is what stops somebody hunting through Settings for a
   switch that does not exist. */
function needMarkup(need) {
  const fixable = need.fix === 'self'
  return `<section class="guide-need" data-need="${esc(need.id)}" data-fix="${esc(need.fix)}">
    <header class="guide-need-head">
      <h2>${esc(need.title)}</h2>
      <p class="guide-need-tag">${fixable ? 'You can do this now' : 'Nothing to turn on'}</p>
    </header>
    <p class="guide-need-body">${esc(need.body)}</p>
    ${need.quote ? `<p class="guide-quote">If you saw this on another screen, this is what it meant: <q>${esc(need.quote)}</q></p>` : ''}
    <ol class="guide-steps">${need.steps.map(stepMarkup).join('')}</ol>
  </section>`
}

/* THE THREE ASSISTANT PROGRAMS, EACH WITH A STRAIGHT ANSWER ABOUT WHAT IT DOES
   HERE.

   `reach` is drawn as a visible phrase and not only as a class, for the same
   reason `fix` is above it: the one thing a person must not misread on this page
   is what will happen when they finish following the instructions. "Nothing here
   starts it yet" printed beside Gemini is what stops somebody installing a
   program, signing in, and then hunting this window for the switch that would
   use it.

   The word for each reach is here rather than in the data because it is a
   rendering of the value, the way the guide's "You can do this now" is a
   rendering of `fix`. The SENTENCE that explains it lives in the data and is
   asserted there. */
const REACH_WORDS = Object.freeze({
  tree: 'Works here now',
  /* It used to read 'Works on the agent page'. That named a destination the
     reader has no route to -- driven, zero doors from the state this is shown
     in -- so the word now describes the LIMIT, which is the part that is known. */
  'not-from-tree': 'Not from a tree in this copy',
  none: 'Nothing here starts it yet',
})

function providerMarkup(provider) {
  /* The status line is EMPTY until the machine answers, never "checking..." and
     never a guess. A page that paints "Not installed" for a moment and corrects
     itself has told a person something false, and on a slow disk they will read
     it and act on it before it changes. So the slot is here, holds nothing, and
     is filled once by fillPresence() below -- or stays empty forever, which is
     the honest state when the read is unavailable. */
  return `<section class="guide-provider" data-provider="${esc(provider.id)}" data-reach="${esc(provider.reach)}">
    <header class="guide-need-head">
      <h3>${esc(provider.name)}</h3>
      <p class="guide-need-tag">${esc(REACH_WORDS[provider.reach] || '')}</p>
    </header>
    <p class="guide-presence" data-presence="pending" hidden></p>
    <p class="guide-need-body">${esc(provider.doesHere)}</p>
    <ol class="guide-steps">${provider.steps.map(stepMarkup).join('')}</ol>
    ${claudeRiskMarkup(provider)}
    ${accountsSlotMarkup(provider)}
  </section>`
}

/* THE PROGRAMS THAT CAN HOLD MORE THAN ONE ACCOUNT HERE, and it is not all
   three. The engine's account list understands Codex and Claude only, so a
   Gemini panel would be a control writing a file nothing reads. Gemini already
   says "nothing here starts it"; offering it accounts would contradict that on
   the same screen. */
const ACCOUNT_PROVIDERS = Object.freeze(new Set(['codex', 'claude']))

/* THE WARNING SHIPS WITH THE SURFACE, NOT WITH THE READ.
 *
 * It is drawn here, in the static markup, and NOT by the asynchronous fill
 * below. That is the whole difference between a warning and a decoration: the
 * fill can fail silently -- no bridge, a browser with no preload, a read that
 * never answers -- and every one of those cases still shows a person the four
 * things they are owed before they run Claude on their own account. A warning
 * that only appears when a read succeeds is a warning that is absent exactly
 * when something is already wrong.
 *
 * It sits ABOVE the account list on purpose. A person reads it before they add
 * a second Claude account, not after. */
function claudeRiskMarkup(provider) {
  if (provider.id !== 'claude') return ''
  return `<section class="guide-risk" data-risk="claude">
    <h4 class="guide-risk-head">${esc(CLAUDE_ACCOUNT_RISK.heading)}</h4>
    <ol class="guide-risk-points">${CLAUDE_ACCOUNT_RISK.points.map(point => `<li>${esc(point)}</li>`).join('')}</ol>
    <p class="guide-risk-today">${esc(CLAUDE_ACCOUNT_RISK.today)}</p>
  </section>`
}

/* An EMPTY, HIDDEN slot, filled once by fillAccounts() or left as it is.
 *
 * Same rule as the presence line above it, and for the same reason. `npm run
 * dev` serves this page in a plain browser with no preload, so there is no
 * bridge to answer; a build with the channel removed looks identical. Drawing
 * the add row statically would put a name field and a button in front of a
 * person in both cases, and pressing it would do nothing at all. So the controls
 * arrive only with the answer that proves they can work. */
function accountsSlotMarkup(provider) {
  if (!ACCOUNT_PROVIDERS.has(provider.id)) return ''
  return `<div class="guide-accounts-panel"
    data-accounts-provider="${esc(provider.id)}"
    data-accounts-program="${esc(provider.name)}" hidden></div>`
}

function accountRowMarkup(account, activeName) {
  const inUse = Boolean(activeName) && String(account.name).toLowerCase() === activeName.toLowerCase()
  const signedIn = account.signedIn === 'yes' ? ACCOUNT_PANEL.signedIn : ACCOUNT_PANEL.notSignedIn
  return `<li class="guide-account" data-account="${esc(account.name)}" data-signed-in="${esc(account.signedIn)}">
    <p class="guide-account-line">
      <b class="guide-account-name">${esc(account.name)}</b>
      ${inUse ? `<span class="guide-account-tag" data-account-active="yes">${esc(ACCOUNT_PANEL.inUse)}</span>` : ''}
      <span class="guide-account-state">${esc(signedIn)}</span>
    </p>
    <p class="guide-account-folder">${esc(account.directory)}</p>
    <p class="guide-step-note">${esc(ACCOUNT_PANEL.commandLead)}</p>
    <code class="guide-command">${esc(account.command || '')}</code>
    <p class="guide-step-note">${esc(ACCOUNT_PANEL.commandNote)}</p>
    <button class="guide-account-btn" type="button" data-account-remove="${esc(account.name)}">${esc(ACCOUNT_PANEL.remove)}</button>
  </li>`
}

/* ONE PROGRAM'S ACCOUNTS, PAINTED AND WIRED.
 *
 * The whole panel is redrawn after every change rather than patched, which is
 * the shape mountProfilePanel() in src/views/computers.js already uses: a list
 * whose rows carry buttons has exactly one honest state after a write, and that
 * is whatever the store says next. */
function paintAccounts(root, panel, answer) {
  const providerId = panel.dataset.accountsProvider
  const program = panel.dataset.accountsProgram || providerId
  const mine = answer.accounts.filter(account => account && account.provider === providerId)
  const activeName = answer.active && typeof answer.active.name === 'string' ? answer.active.name : ''

  panel.innerHTML = `
    <h4 class="guide-accounts-head">${esc(ACCOUNT_PANEL.heading)}</h4>
    <p class="guide-step-note">${esc(ACCOUNT_PANEL.help)}</p>
    ${answer.damaged === true ? `<p class="guide-accounts-note">${esc(ACCOUNT_PANEL.unreadable)}</p>` : ''}
    ${mine.length
      ? `<ul class="guide-account-list">${mine.map(account => accountRowMarkup(account, activeName)).join('')}</ul>
         <p class="guide-step-note">${esc(ACCOUNT_PANEL.activeNote)}</p>`
      : `<p class="guide-accounts-note">${esc(ACCOUNT_PANEL.none)}</p>`}
    <div class="guide-account-add">
      <input class="guide-account-field" type="text" data-account-name
        placeholder="${esc(ACCOUNT_PANEL.namePlaceholder)}" aria-label="${esc(ACCOUNT_PANEL.nameLabel)}">
      <input class="guide-account-field" type="text" data-account-folder
        placeholder="${esc(ACCOUNT_PANEL.folderPlaceholder)}" aria-label="${esc(ACCOUNT_PANEL.folderLabel)}">
      <button class="guide-account-btn" type="button" data-account-add>${esc(ACCOUNT_PANEL.add(program))}</button>
    </div>
    <output class="guide-accounts-note" role="status" data-account-out></output>`
  panel.hidden = false

  const out = panel.querySelector('[data-account-out]')
  panel.querySelector('[data-account-add]')?.addEventListener('click', async () => {
    const name = panel.querySelector('[data-account-name]')?.value?.trim() || ''
    const directory = panel.querySelector('[data-account-folder]')?.value?.trim() || ''
    if (!name || !directory) {
      if (out) out.textContent = ACCOUNT_PANEL.needBoth
      return
    }
    const added = await window.mcProviders?.accountAdd({ name, provider: providerId, directory })
      .catch(() => null)
    if (!added || added.ok !== true) {
      if (out) out.textContent = ACCOUNT_PANEL.refused
      return
    }
    void fillAccounts(root)
  })

  for (const button of panel.querySelectorAll('[data-account-remove]')) {
    button.addEventListener('click', async () => {
      const gone = await window.mcProviders?.accountRemove({ name: button.dataset.accountRemove, provider: providerId })
        .catch(() => null)
      if (!gone || gone.ok !== true) {
        if (out) out.textContent = ACCOUNT_PANEL.removeRefused
        return
      }
      void fillAccounts(root)
    })
  }
}

/* THE SECOND READ ON THIS PAGE, held to the first one's rules exactly.
 *
 * Every failure path leaves the panels hidden and the page useful: the commands
 * above them, and the Claude warning beside them, are already drawn and do not
 * depend on this. An absent list is NOT a failure and never paints as one --
 * `accounts: []` is the ordinary answer on a computer with one sign-in, and the
 * panel says so in words rather than reporting nothing. */
async function fillAccounts(root) {
  let answer = null
  try {
    answer = await window.mcProviders?.accounts()
  } catch {
    return
  }
  if (!answer || answer.ok !== true || !Array.isArray(answer.accounts)) return
  if (!root.isConnected) return
  for (const panel of root.querySelectorAll('.guide-accounts-panel')) {
    paintAccounts(root, panel, answer)
  }
}

/* ASK THE MACHINE WHAT IT HAS, AND SAY NOTHING IF IT CANNOT BE ASKED.
 *
 * THE ABSENT-BRIDGE CASE IS THE ONE THAT MATTERS, and it is not hypothetical:
 * `npm run dev` serves this page in a plain browser with no preload, so
 * window.mcProviders is undefined every time a designer opens it. It is also
 * what a future build with this channel removed would look like. Both must
 * leave the page exactly as it renders now -- the commands are useful without
 * the status line, and an error banner about a missing bridge would be the
 * product reporting its own plumbing to a person who wanted to install Codex.
 *
 * So every failure path here is the same path: leave the slot hidden. This is
 * the one place in this file that talks to anything outside it, and it is
 * written so that nothing it touches can prevent the page from being useful.
 */
async function fillPresence(root) {
  let answer = null
  try {
    answer = await window.mcProviders?.presence()
  } catch {
    return
  }
  if (!answer || answer.ok !== true || !Array.isArray(answer.providers)) return
  if (!root.isConnected) return

  for (const presence of answer.providers) {
    const sentence = presenceSentence(presence)
    if (!sentence) continue
    const slot = root.querySelector(`.guide-provider[data-provider="${presence.id}"] .guide-presence`)
    if (!slot) continue
    slot.textContent = sentence
    /* The state is carried as data as well as prose so a driver and a support
       conversation can read it without parsing a sentence, which is the same
       rule `data-refusal-code` follows elsewhere. */
    slot.dataset.presence = presence.installed === 'yes' && presence.signedIn === 'yes' ? 'ready' : 'incomplete'
    slot.dataset.installed = presence.installed
    slot.dataset.signedIn = presence.signedIn
    slot.hidden = false
  }
}

export function guideView() {
  const root = el(`
    <main class="view-pad guide-page">
      <div class="guide-shell">
        <header class="guide-mast">
          <p class="guide-eyebrow">first run</p>
          <h1>What this copy needs</h1>
          <p class="guide-lede">ToolsEnabled works on one computer on its own. Some of its screens read reports that a group of computers writes, and on a fresh install nothing has written one yet. Here is what is missing, what you can do about it, and what is already working.</p>
        </header>

        ${FIRST_RUN_NEEDS.map(needMarkup).join('')}

        <section class="guide-need guide-accounts" data-need="provider-accounts">
          <header class="guide-need-head">
            <h2>Your own assistant sign-ins</h2>
            <p class="guide-need-tag">You can do this now</p>
          </header>
          <p class="guide-need-body">An agent runs on one of these programs. Each one is a separate install with its own sign-in. ToolsEnabled never asks for those sign-ins and never keeps one. It starts the program, and the program uses the account you signed in to. Here is what to type, and what this copy can do with each one today.</p>
          ${PROVIDER_SETUP.map(providerMarkup).join('')}
        </section>

        <section class="guide-need guide-works" data-need="works-here">
          <header class="guide-need-head">
            <h2>What already works here</h2>
            <p class="guide-need-tag">No setup</p>
          </header>
          <ul class="guide-works-list">${WORKS_HERE.map(line => `<li>${esc(line)}</li>`).join('')}</ul>
        </section>

        <footer class="guide-foot">
          <a class="guide-foot-link" href="${esc(SETTINGS_HREF)}">All settings</a>
          <a class="guide-foot-link" href="#/">Back to the first page</a>
        </footer>
      </div>
    </main>`)

  /* ONE ASYNCHRONOUS READ, AND IT IS THE ONLY ONE.
   *
   * This page used to be a pure statement about what the build IS. It now also
   * reports one thing about the machine -- whether each assistant program is
   * here and signed in -- because "what does this copy need" cannot be answered
   * honestly without it. Everything else on the page is still static, and
   * deliberately so.
   *
   * NOTHING SUBSCRIBES. It is a single read at mount, not a live feed: a person
   * who installs Codex in another window and comes back gets the new answer by
   * arriving at the page again, which is when they would look. A subscription
   * would be a timer on a page nobody keeps open.
   *
   * destroy() has nothing to release and says so rather than pretending. The
   * read guards on root.isConnected instead, so a person who navigates away
   * before the machine answers cannot have a detached page written into. */
  fillPresence(root)
  /* The second one, added with the account panels. It is a separate read rather
     than a field on the first because they answer different questions and fail
     apart: a machine can report its programs and still have no account list, and
     an account list must not be able to blank the presence line. */
  fillAccounts(root)

  return {
    el: root,
    destroy() {},
  }
}
