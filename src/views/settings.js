// /settings — progressively disclosed preferences plus the first-run system
// register. Appearance can fail soft; fleet configuration is correctness data
// and uses the durable profile store instead of the cosmetic setting idiom.

import { el, attachSeg } from '../components.js'
import { rangeFill } from './computers.js'
import { sim } from '../sim.js'
import { QUICK_SETTING_EVENT } from '../quick-settings.js'
import {
  FONT_CHOICES,
  FONT_STORAGE_KEY,
  applyFontChoice,
  currentFontChoice,
  fontStack,
  normalizeFontId,
} from '../font-choice.js'
import { LIVE_VIEW_FLAGS, isLiveView, setLiveView } from '../live-flags.js'
import { WRITE_ACTION_FLAGS, isWriteEnabled, setWriteEnabled } from '../write-flags.js'
/* THE TWO ROWS ON THIS PAGE THAT HAD NOWHERE TO BE WRITTEN DOWN. Glow and
   reduce motion were read back off the DOM alone, so both were thrown away
   when the window closed -- measured on the shipped 1.0.20 installer, where 98
   of the other 100 rows survived the same restart. The module writes them
   under this page's own `mc.set.<id>` keys and puts them back at launch, and
   the drawer's copy of the same two controls writes through it as well. */
import {
  GLOW_SETTING_ID,
  REDUCE_MOTION_SETTING_ID,
  applyAppearance,
  rememberAppearance,
} from '../appearance-persistence.js'
import { createLedgerArchiveController } from '../mission-bridge.js'
/* WHAT EVERY ROW GRANTS AND WHAT IT RISKS, stated separately (owner, R1529).
   The statements are data in src/permission-guidance.js and the markup is
   src/guided-step.js, so this page asks for a row's explanation rather than
   carrying ninety of them itself. A row the declarations do not cover is drawn
   saying so, which is why nothing here needs a fallback sentence. */
import { guidanceMarkup } from '../guided-step.js'
import { describeSubject } from '../permission-guidance.js'
import { CAPABILITY_PROBE_EVENT, probe, refreshCapabilityProbes } from '../capability-probes.js'
import {
  FLEET_PROFILE_SETTING_COUNT,
  createFleetProfileSettings,
} from '../fleet-profile-settings.js'
/* The first-run walkthrough's settings. They are a SECTION here rather than a
   screen of their own because the owner's requirement has two halves: the
   walkthrough may infer, and every inferred setting must stay visible and
   editable afterwards. A profile only the walkthrough could edit would satisfy
   the first half and fail the second. */
import {
  SETUP_PROFILE_SETTING_COUNT,
  createSetupProfileSettings,
} from '../setup-profile-settings.js'
/* The first section on this page, and first because the box it governs is the
   first thing in the product: which agents' context appears in the chat box on
   the home screen, and whether agent runs appear there too, not at all, or on
   their own. */
import {
  CHATBOX_SECTION,
  CHATBOX_SETTING_COUNT,
  createChatboxSettings,
} from '../chatbox-settings.js'
/* THE SETTINGS THE INSTALLED APPLICATION ENFORCES, and the reason this is a
   section module rather than five more entries in SETTINGS below.
   Every row in SETTINGS is a preference of this window, stored by this window.
   These are stored beside the program and read by another process -- so they
   are asked for and written through the installed application, and their value,
   their wording and whether anything enforces them all come back from it rather
   than from this file. Which is also why they are the rows that never went
   dead: their enforcer is named in the register and does the reading. */
import {
  RESEARCH_SECTION,
  RESEARCH_SETTING_COUNT,
  PRODUCT_SETTING_IDS,
  createResearchSettings,
} from '../research-settings.js'
/* WHY A SECTION ON THIS PAGE NEEDS A SENTENCE ABOVE ITS SWITCHES.
 *
 * LEGACY-ONB-001, re-measured on a sterile profile: a person whose fleet graph
 * and comms board both say "No local agent fleet host detected on this machine"
 * comes here looking for the switch that fixes it. Under Data and Sim they find
 * six toggles reading "<screen> live data", every one of them already ON, and
 * nothing anywhere on the page telling them that turning them on was never the
 * problem. There is no switch for the thing they are looking for, and the most
 * useful thing this page can do is say so and point at the page that explains it
 * -- otherwise the search ends in them flipping live sources off and concluding
 * the product is fake data. */
import { GUIDE_HREF } from '../first-run-needs.js'
/* HOW THIS PAGE IS ARRANGED, NOT WHAT IT STORES. The first outside user found
   seventeen flat categories hard to read, so they nest under six groups a
   person scans in one glance. The groups, the remembered open-state, the
   truth-first sentence beside a switch and the System refusal translation are
   all data and pure functions in one DOM-free module, where a node test can
   hold them still. Every row id, storage key and default is untouched. */
import {
  SETTINGS_GROUPS,
  groupOfSection,
  groupsOpenOnArrival,
  writeOpenGroups,
  toggleStateSentence,
} from '../settings-presentation.js'
import '../settings.css'
import '../chatbox-settings.css'
import '../fleet-profile-settings.css'
import '../setup.css'
import '../guide.css'

const SECTIONS = [
  CHATBOX_SECTION,
  'System',
  'Setup',
  /* HIGH IN THE LIST ON PURPOSE. This section holds one question -- what happens
     to the person's data when they uninstall -- and until 2026-08-11 the product
     had no answer to it anywhere: uninstalling left 92 files and 11.87 MB,
     including the credential vault and the signed audit ledger, with nothing
     asked and nothing said. A control for that buried below the simulation
     knobs would be a control nobody finds, which is the same outcome. */
  'Data & Privacy',
  /* HIGH, FOR THE SAME REASON 'Data & Privacy' IS. This section answers "may
     anything run on this computer for a research project", and it is the switch
     the research page sends people here to find. A section for that below the
     chart-drawing knobs is a section nobody finds, which is the state this
     product was already in -- the page named a switch that was not anywhere. */
  RESEARCH_SECTION,
  'Appearance',
  'Text & Reading',
  'Motion & Effects',
  'Ledger',
  'Data & Sim',
  'Write',
  /* SIX SECTIONS THAT USED TO BE LISTED HERE ARE GONE, 2026-08-20: Fleet Graph,
     Metrics, Chat & Threads, Comms Board, Performance and Developer. Each was
     inert top to bottom -- every row in them wrote a `mc.set.<id>` key that
     nothing in the product read -- so removing their rows left six titled
     headings with nothing under them, which is its own defect: a person opening
     a group cannot tell an empty section from a broken one. The headings went
     with the rows. Their wording is kept verbatim in
     docs/design/UNBUILT-SETTINGS-ROWS-2026-08-20.md. */
]

/* SEVENTY-FOUR ROWS WERE REMOVED FROM THIS CATALOGUE ON 2026-08-20, and the
 * reason is the same one written under `offline_fallback` below.
 *
 * This page built 96 rows and its footer said "116 settings". Seventy-four of
 * them wrote a `mc.set.<id>` key that NOTHING in the product ever read. Six
 * whole sections were inert top to bottom. Every one of those rows moved,
 * filled, reported a percentage and survived a restart, so nothing on screen
 * distinguished them from the twenty-two that worked -- which is the actual
 * harm: a person who moves a control that does nothing stops looking for the
 * real switch, and `contrast_curve` made that promise ("make the lighter,
 * secondary text darker and easier to read") to the person least able to detect
 * that nothing had happened.
 *
 * REMOVING A DEAD ROW IS NOT REMOVING A FEATURE. There was no feature. The
 * behaviours these rows described -- chart quality, a frame cap, a Sankey gap, a
 * thread memory span, a simulation tick bias -- do not exist anywhere in this
 * tree, so "wiring them up" would mean building them.
 *
 * THE WORDING IS NOT LOST. Every removed definition is kept verbatim in
 * docs/design/UNBUILT-SETTINGS-ROWS-2026-08-20.md, with a dated header saying
 * they are unbuilt intentions, so nobody has to re-invent a reviewed sentence
 * when one of these features is actually built.
 *
 * A ROW ADDED HERE WITH NO READER NOW FAILS A TEST.
 * tools/test/settings-rows-do-something.test.mjs derives the dead set from this
 * file at run time and names every offender. There is deliberately no exemption
 * list: if a row acts through a door the test does not know about, teach it the
 * door and the line that reads it. The defect was never that somebody wrote 74
 * bad rows -- it was that nothing could tell a real control from a drawn one. */
export const SETTINGS = [
  /* THE DEFAULT IS "ASK ME", AND THAT IS THE WHOLE POINT OF THIS ENTRY.
   *
   * Uninstalling used to keep everything and say nothing. Setting the default
   * here to "Keep my data" would leave that behaviour exactly as it is and add a
   * control nobody had to touch -- the same silent retention, now with a setting
   * page that appears to have consented on the person's behalf. The default has
   * to be the QUESTION.
   *
   * It also has to be "ask" for a mechanical reason worth stating: setValue()
   * REMOVES the stored key when the chosen value equals `def` (see the
   * localStorage.removeItem branch below), so "ask" is the one value that is
   * indistinguishable from never having chosen. Making it the default aligns the
   * storage model with shell/uninstall-retention.cjs, where absence and `ask`
   * deliberately resolve to the same thing. Any other default would make
   * "never chose" and "chose the default" mean different things to the
   * uninstaller while looking identical on disk.
   *
   * NEITHER REAL OPTION IS MARKED RECOMMENDED. This product has already shipped
   * a setup screen with both answers labelled "Recommended", which is how it
   * ended up with no Start control anywhere. There is no correct answer here --
   * it depends on whether the person is reinstalling or leaving -- and a hint
   * would be this file deciding for them. */
  {
    id: 'uninstall_data',
    section: 'Data & Privacy',
    name: 'When I uninstall ToolsEnabled',
    desc: 'Uninstalling removes the program. It does not remove your saved credentials, '
      + 'your linked accounts, the signed record of every action taken, your agent history '
      + 'or your settings — those stay on this computer so a reinstall picks up where you '
      + 'left off. Choose what should happen to them.',
    depth: 1,
    type: 'seg',
    options: [['ask', 'Ask me then'], ['keep-my-data', 'Keep my data'], ['remove-everything', 'Remove everything']],
    def: 'ask',
  },

  { id: 'theme', section: 'Appearance', name: 'Theme', desc: 'Choose the app’s look: a white, tan, or black background.', depth: 1, type: 'seg', options: [['white', 'White'], ['tan', 'Tan'], ['black', 'Black']], def: 'white' },
  /* The choices live in src/font-choice.js (owner, R1523); each option's
     button is written in the font it applies, here and in the drawer. */
  { id: 'ui_font', section: 'Appearance', name: 'Font', desc: 'Choose the app’s lettering. Each option is written in its own font, so what you see on the button is what you get everywhere.', depth: 1, type: 'seg', options: FONT_CHOICES.map(choice => [choice.id, choice.label]), def: 'plex' },

  { id: 'text_size', section: 'Text & Reading', name: 'Text size', desc: 'Make everything bigger or smaller without changing the layout.', depth: 1, type: 'seg', options: [['0.9', 'Small'], ['1', 'Default'], ['1.12', 'Large']], def: '1' },

  { id: 'reduce_motion', section: 'Motion & Effects', name: 'Reduce motion', desc: 'Turn animation off: things move instantly and nothing pulses in the background.', depth: 1, type: 'toggle', def: false },
  { id: 'glow', section: 'Motion & Effects', name: 'Glow intensity', desc: 'How brightly the glowing status lights shine.', depth: 1, type: 'range', min: 0, max: 200, step: 1, unit: '%', def: 100 },

  { id: 'ledger_archive', section: 'Ledger', name: 'Clean up old R', desc: 'The first click only shows which completed or superseded requests would be archived. A second click moves exactly that list into the archive — nothing is moved without the preview.', depth: 1, type: 'action', def: null },

  { id: 'scenario_tick_rate', section: 'Data & Sim', name: 'Demonstration speed', desc: 'How fast the demonstration fleet generates new activity (its scenario tick rate).', depth: 1, type: 'range', min: 30, max: 300, step: 5, unit: '%', def: 100 },
  /* 'offline_fallback' was removed 2026-08-13 rather than left as a row: it was
     declared here and read by NOTHING in the tree, so the toggle moved and
     changed no behavior — a control that looks real and is not, the exact
     defect class the owner has ruled on ("a user setting needs registry,
     enforcement, and a control, or it's a lie"). If a demonstration fallback
     for unreadable live data is ever wanted, it gets built first and its row
     returns with a reader. */
  ...LIVE_VIEW_FLAGS.map(flag => ({
    id: `live_${flag.id}`,
    section: 'Data & Sim',
    name: `${flag.label} live data`,
    desc: `Show your computer’s own records on this page (read from ${flag.domain}.json). Turn off to see the labelled demonstration instead.`,
    depth: 1,
    type: 'toggle',
    def: true,
  })),
  /* "Synthetic failure rate" was a name written from inside the code. Nothing a
     person owns is synthetic, and the row is about the built-in example. */

  /* The shipped-default sentence moved off the description and into the row's
     STATE line (toggleStateSentence), because here it contradicted the switch:
     driven tonight, a row reading ON carried "This ships switched off" as its
     first claim, and the reader believed the sentence over the switch. The
     state line says the current truth first and the shipped default after. */
  ...WRITE_ACTION_FLAGS.map(flag => ({
    id: `write_${flag.id}`,
    section: 'Write',
    name: flag.label,
    desc: flag.description,
    depth: ['dispatch', 'report-read'].includes(flag.id) ? 1 : 2,
    type: 'toggle',
    def: false,
  })),

]

const byId = new Map(SETTINGS.map(setting => [setting.id, setting]))
const liveSettingViews = new Map(LIVE_VIEW_FLAGS.map(flag => [`live_${flag.id}`, flag.id]))
const writeSettingActions = new Map(WRITE_ACTION_FLAGS.map(flag => [`write_${flag.id}`, flag.id]))
const storageKey = id => `mc.set.${id}`
const escapeHtml = value => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

function optionRecords(setting) {
  return (setting.options || []).map(option => {
    if (Array.isArray(option)) return { value: String(option[0]), label: String(option[1]) }
    const value = String(option)
    return { value, label: value.charAt(0).toUpperCase() + value.slice(1) }
  })
}

function clampNumber(setting, value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return setting.def
  return Math.min(setting.max, Math.max(setting.min, number))
}

function readStored(setting) {
  try {
    const raw = localStorage.getItem(storageKey(setting.id))
    if (raw === null) return setting.def
    if (setting.type === 'toggle') return raw === 'true' ? true : raw === 'false' ? false : setting.def
    if (setting.type === 'range' || setting.type === 'stepper') return clampNumber(setting, raw)
    return optionRecords(setting).some(option => option.value === raw) ? raw : setting.def
  } catch { return setting.def }
}

function readValue(setting) {
  const liveView = liveSettingViews.get(setting.id)
  if (liveView) return isLiveView(liveView)
  const writeAction = writeSettingActions.get(setting.id)
  if (writeAction) return isWriteEnabled(writeAction)
  if (setting.id === 'theme') {
    const current = document.documentElement.dataset.theme
    return current === 'tan' || current === 'black' ? current : 'white'
  }
  /* Like theme: the applied state on the root element is the truth, not a
     stored copy (src/font-choice.js reads the inline --font-ui property). */
  if (setting.id === 'ui_font') return currentFontChoice()
  if (setting.id === 'text_size') {
    const zoom = parseFloat(document.body.style.zoom)
    return zoom === 0.9 || zoom === 1.12 ? String(zoom) : '1'
  }
  if (setting.id === 'glow') {
    /* The applied value lives on the root element; the drawer's slider is a
       COPY of it and only exists once the drawer has rendered (it is built
       per page since R1520), so the variable is the source and the slider
       only a fallback. */
    const applied = parseFloat(document.documentElement.style.getPropertyValue('--glow'))
    if (Number.isFinite(applied)) return Math.round(applied * 100)
    const drawerValue = Number(document.getElementById('set-glow')?.value)
    return Number.isFinite(drawerValue) ? drawerValue : setting.def
  }
  if (setting.id === 'reduce_motion') return document.body.classList.contains('reduce-motion')
  return readStored(setting)
}

function sameValue(left, right) {
  return String(left) === String(right)
}

function writeStored(setting, value) {
  try {
    if (sameValue(value, setting.def)) localStorage.removeItem(storageKey(setting.id))
    else localStorage.setItem(storageKey(setting.id), String(value))
  } catch {}
}

function setDrawerSegment(selector, dataName, value) {
  for (const button of document.querySelectorAll(`${selector} button`)) {
    const on = sameValue(button.dataset[dataName], value)
    button.classList.toggle('on', on)
    button.setAttribute('aria-pressed', on ? 'true' : 'false')
  }
}

function formatNumber(value) {
  const number = Number(value)
  return Number.isInteger(number) ? String(number) : number.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

function formatValue(setting, value) {
  if (setting.type === 'select') {
    return optionRecords(setting).find(option => sameValue(option.value, value))?.label || String(value)
  }
  if (setting.type === 'range' || setting.type === 'stepper') {
    const unit = setting.unit || ''
    const join = unit === '%' || unit === 'px' ? '' : unit ? ' ' : ''
    return `${formatNumber(value)}${join}${unit}`
  }
  return String(value)
}

function controlMarkup(setting) {
  const labelId = `setting-label-${setting.id}`

  if (setting.type === 'action') {
    return `<button type="button" class="ctl-btn" data-setting-action="ledger-archive" aria-labelledby="${labelId}">Preview cleanup</button>`
  }
  const value = readValue(setting)

  if (setting.type === 'seg') {
    /* The font row's options preview themselves: each button is set in the
       stack it would apply (R1523). Other segs carry no per-option style. */
    const optionStyle = option => setting.id === 'ui_font'
      ? ` style="font-family:${escapeHtml(fontStack(option.value))}"`
      : ''
    return `<div class="seg settings-seg" role="group" aria-labelledby="${labelId}">
      ${optionRecords(setting).map(option => `<button type="button" data-setting-value="${escapeHtml(option.value)}"${optionStyle(option)} aria-pressed="${sameValue(option.value, value)}" class="${sameValue(option.value, value) ? 'on' : ''}">${escapeHtml(option.label)}</button>`).join('')}
    </div>`
  }
  if (setting.type === 'toggle') {
    return `<label class="toggle settings-toggle"><input type="checkbox" aria-labelledby="${labelId}" ${value ? 'checked' : ''}/><i></i></label>`
  }
  if (setting.type === 'range') {
    return `<div class="settings-range"><input type="range" min="${setting.min}" max="${setting.max}" step="${setting.step}" value="${value}" aria-labelledby="${labelId}"/><output data-setting-output>${escapeHtml(formatValue(setting, value))}</output></div>`
  }

  const isSelect = setting.type === 'select'
  return `<div class="settings-stepper ${isSelect ? 'is-select' : ''}" role="group" aria-labelledby="${labelId}">
    <button type="button" data-step-delta="-1" aria-label="Previous ${escapeHtml(setting.name)}">&lt;</button>
    <output data-setting-output>${escapeHtml(formatValue(setting, value))}</output>
    <button type="button" data-step-delta="1" aria-label="Next ${escapeHtml(setting.name)}">&gt;</button>
  </div>`
}

function searchHaystack(setting) {
  const guidance = describeSubject(setting.id, { section: setting.section })
  return [
    setting.name, setting.desc, setting.section,
    guidance.whatItDoes, ...guidance.capabilities, ...guidance.risks, guidance.absenceNote,
  ].join(' ').toLowerCase()
}

/* WHERE A ROW'S GUIDANCE CAN SEND YOU: the thing the switch actually gates.
 * One press instead of "read the name, work out which page, walk the ring".
 * Only rows whose gated surface has a stable address get a link; the agent
 * drill-ins have no fixed page to name, so their rows carry none rather than
 * a link that lands somewhere the control is not. */
const JUMP_TARGETS = new Map([
  ...LIVE_VIEW_FLAGS.filter(flag => flag.id !== 'agent').map(flag => [
    `live_${flag.id}`,
    { href: flag.id === 'home' ? '#/' : `#/${flag.id}`, label: `Open the ${flag.label.toLowerCase()}` },
  ]),
  ['write_dispatch', { href: '#/computers', label: 'Open the page that shows this control' }],
  ['write_decision', { href: '#/ledger', label: 'Open the ledger this controls' }],
  ['write_queue', { href: '#/ledger', label: 'Open the ledger this controls' }],
  ['write_thread-reply', { href: '#/', label: 'Open the first page, where replies go' }],
])

function jumpMarkup(setting) {
  const target = JUMP_TARGETS.get(setting.id)
  if (!target) return ''
  return `<a class="settings-jump" href="${escapeHtml(target.href)}">${escapeHtml(target.label)}</a>`
}

/* The truth-first sentence beside a switch. Toggles only: every other control
   shows its current value in its own body (the lit option, the number). */
function stateMarkup(setting) {
  if (setting.type !== 'toggle') return ''
  const sentence = toggleStateSentence({
    value: Boolean(readValue(setting)),
    def: setting.def,
    acts: writeSettingActions.has(setting.id),
  })
  return `<div class="settings-state" data-setting-state>${escapeHtml(sentence)}</div>`
}

/* ONE ROW ANATOMY, IN ONE ORDER: name — state sentence — description — control
 * — disclosure. The disclosure is a grid row of its OWN, under both columns,
 * because it used to live beside the control with the row centre-aligned:
 * opening it grew the copy column and slid the control 14 to 81px under the
 * pointer mid-press (measured tonight on the driven build). Below the control,
 * opening it moves nothing a pointer is over. */
function rowMarkup(setting, searchResult = false) {
  return `<article class="settings-row ${setting.depth === 4 ? 'is-engineer' : ''}" data-setting-id="${setting.id}">
    <div class="settings-copy">
      ${searchResult ? `<div class="settings-prefix">${escapeHtml(setting.section)} · depth ${setting.depth}</div>` : ''}
      <div class="settings-name" id="setting-label-${setting.id}">${escapeHtml(setting.name)}</div>
      ${stateMarkup(setting)}
      <div class="settings-desc" data-setting-message>${escapeHtml(setting.desc)}</div>
      ${jumpMarkup(setting)}
    </div>
    <div class="settings-control">${controlMarkup(setting)}</div>
    <div class="settings-disclosure">${guidanceMarkup(setting.id, { section: setting.section, probe })}</div>
  </article>`
}

function revealMarkup(section, depth, count, prefix, open) {
  const controlId = `settings-tier-${SECTIONS.indexOf(section)}-${depth}`
  return `<button class="settings-reveal" type="button" data-reveal-section="${escapeHtml(section)}" data-reveal-depth="${depth}" data-reveal-count="${count}" data-reveal-prefix="${prefix}" aria-controls="${controlId}" aria-expanded="${open ? 'true' : 'false'}">${revealInner(prefix, count, open)}</button>`
}

/* The chevron gets its own element: a cold reader hedged on whether the bare
   "4 more ⌄" line was clickable — the glyph now sits at affordance size and
   answers on hover instead of relying on the reader's faith. */
function revealInner(prefix, count, open) {
  const text = prefix
    ? `${prefix} · ${open ? 'less' : `${count} more`}`
    : `${count} ${open ? 'fewer' : 'more'}`
  return `${escapeHtml(text)}<span class="settings-reveal-glyph" aria-hidden="true">${open ? '⌃' : '⌄'}</span>`
}

function tierMarkup(section, depth, content, open) {
  return `<div class="settings-tier settings-tier-${depth} ${open ? 'is-open' : ''}" id="settings-tier-${SECTIONS.indexOf(section)}-${depth}" data-tier-depth="${depth}" aria-hidden="${open ? 'false' : 'true'}" ${open ? '' : 'inert'}><div class="settings-tier-inner">${content}</div></div>`
}

/* A sentence under a section title, for the two sections whose switches a person
   arrives at with the wrong question. Data, not markup in the render, so the
   words are visible in one place and a third section can be added without
   touching the renderer. A section with no note gets no element at all rather
   than an empty one. */
const SECTION_NOTES = Object.freeze({
  'Data & Sim': Object.freeze({
    text: 'These switches choose between the live reading and a worked example, one screen at a time. They do not connect anything. On a fresh install the live readings are empty, because nothing has reported to this copy yet, and no switch on this page changes that.',
    link: Object.freeze({ label: 'What this copy needs', href: GUIDE_HREF }),
  }),
  Write: Object.freeze({
    text: 'Every action that writes anything ships switched off, so a copy nobody has configured cannot send, start or approve anything by accident. Turning one on here is what makes its control appear.',
    link: Object.freeze({ label: 'What this copy needs', href: GUIDE_HREF }),
  }),
})

function sectionNoteMarkup(section) {
  const note = SECTION_NOTES[section]
  if (!note) return ''
  return `<p class="settings-section-note host-absent-body" data-section-note="${escapeHtml(section)}">${escapeHtml(note.text)}
    <a class="host-absent-action" href="${escapeHtml(note.link.href)}">${escapeHtml(note.link.label)}</a></p>`
}

/* THE TWO SECTION-LEVEL ONE-PRESS CONTROLS, AND THE ASYMMETRY BETWEEN THEM.
 *
 * Data & Sim's switches are genuinely independent screen-source toggles: both
 * directions are equally honest (the example is labelled as an example), so
 * both directions get one press. Write's switches each let the program ACT,
 * and the product deliberately asks for each grant one row at a time -- the
 * walkthrough's one-answer bulk grant is the sanctioned path, with its
 * consequences stated. So Write gets ONE press for the safe direction only:
 * off. There is deliberately no "turn everything on" press here. */
const BULK_ROWS = Object.freeze({
  'Data & Sim': `<article class="settings-row settings-bulk-row">
    <div class="settings-copy">
      <div class="settings-name" id="settings-bulk-live-label">Every screen at once</div>
      <div class="settings-desc">One press sets every switch in this section together. Each switch below stays its own afterwards.</div>
    </div>
    <div class="settings-control">
      <div class="fleet-profile-actions" role="group" aria-labelledby="settings-bulk-live-label">
        <button type="button" class="ctl-btn" data-bulk-live="on">All live</button>
        <button type="button" class="ctl-btn" data-bulk-live="off">All examples</button>
      </div>
    </div>
  </article>`,
  Write: `<article class="settings-row settings-bulk-row">
    <div class="settings-copy">
      <div class="settings-name" id="settings-bulk-write-label">Everything off, in one press</div>
      <div class="settings-desc">Turns every switch in this section off, including the ones under the reveals below. Turning things ON stays one row at a time, so nothing acts without its own choice.</div>
    </div>
    <div class="settings-control">
      <div class="fleet-profile-actions" role="group" aria-labelledby="settings-bulk-write-label">
        <button type="button" class="ctl-btn" data-bulk-write-off>Turn everything off</button>
      </div>
    </div>
  </article>`,
})

function sectionMarkup(section, level) {
  const items = SETTINGS.filter(setting => setting.section === section)
  const at = depth => items.filter(setting => setting.depth === depth)
  const depth4 = tierMarkup(section, 4, at(4).map(setting => rowMarkup(setting)).join(''), level >= 4)
  const depth3Content = [
    ...at(3).map(setting => rowMarkup(setting)),
    revealMarkup(section, 4, at(4).length, 'everything', level >= 4),
    depth4,
  ].join('')
  const depth3 = tierMarkup(section, 3, depth3Content, level >= 3)
  const depth2Content = [
    ...at(2).map(setting => rowMarkup(setting)),
    revealMarkup(section, 3, at(3).length + at(4).length, 'advanced', level >= 3),
    depth3,
  ].join('')
  const depth2 = tierMarkup(section, 2, depth2Content, level >= 2)
  const hidden = items.filter(setting => setting.depth > 1).length

  return `<section class="settings-section" data-settings-section="${escapeHtml(section)}">
    <h2 class="settings-section-title">${escapeHtml(section)}</h2>
    ${sectionNoteMarkup(section)}
    ${BULK_ROWS[section] || ''}
    <div class="settings-section-rows">${at(1).map(setting => rowMarkup(setting)).join('')}</div>
    ${revealMarkup(section, 2, hidden, '', level >= 2)}
    ${depth2}
  </section>`
}

function setTierFocusable(tier, open) {
  tier.toggleAttribute('inert', !open)
  for (const control of tier.querySelectorAll('button, input, select, textarea, [tabindex]')) {
    if (!open) {
      if (control.dataset.settingsTabindex === undefined) {
        control.dataset.settingsTabindex = control.getAttribute('tabindex') ?? ''
        control.setAttribute('tabindex', '-1')
      }
    } else if (control.dataset.settingsTabindex !== undefined) {
      const previous = control.dataset.settingsTabindex
      if (previous === '') control.removeAttribute('tabindex')
      else control.setAttribute('tabindex', previous)
      delete control.dataset.settingsTabindex
    }
  }
}

/**
 * The one row a link asked for, or null.
 *
 * A LINK MAY NAME A SWITCH, AND ONLY A SWITCH THIS PAGE HAS. The id arrives off
 * the address bar, so it is looked up in this page's own table and anything
 * else is ignored -- an unknown id lands the person at the top of Settings,
 * which is exactly where they landed before this existed, rather than throwing
 * an error at somebody who followed a link.
 */
function requestedSetting(query) {
  const id = query && typeof query.get === 'function' ? query.get('setting') : null
  if (typeof id !== 'string' || id.length === 0) return null
  /* THE RESEARCH ROWS ARE LANDABLE TOO, and this is the half that makes the
     research page's sentence true. That page sends a person here for the switch
     that decides whether anything runs; landing needs a section and a depth, and
     these four are not in SETTINGS because they are not this window's own
     preferences. They render at the top of their section, so depth 1 is what
     they are, and the row itself carries data-setting-id like every other row,
     which is what markLanding and scrollToLanding look for. */
  if (PRODUCT_SETTING_IDS.includes(id)) return { id, section: RESEARCH_SECTION, depth: 1 }
  return byId.get(id) || null
}

/* NOT NAMED `query`: this view already has a local `query` holding what is
   typed in the search box, and a parameter of the same name is a redeclaration
   the module would not even parse. */
export function settingsView({ query: routeQuery = null } = {}) {
  const landing = requestedSetting(routeQuery)
  /* WHICH GROUPS ARE OPEN, remembered across visits and restarts, and decided
     in src/settings-presentation.js so a node test can hold the rule still.
     Returning: exactly what this person last left open. Following a link: that
     row's group as well. ARRIVING with no posture at all: the group holding
     sign-in, because a first visit used to render six headings and zero
     controls -- measured, with the only door to #/account 0x0 inside it. None
     of the three writes anything; arriving is not a filing decision. */
  const openGroups = groupsOpenOnArrival(globalThis.localStorage, landing ? landing.section : null)
  const profileController = createFleetProfileSettings()
  const setupController = createSetupProfileSettings()
  const chatboxController = createChatboxSettings()
  const researchController = createResearchSettings()
  /* The rail is the same two levels the page is: six group lines, and the
     familiar seventeen category buttons nested under whichever are open. */
  const railMarkup = () => SETTINGS_GROUPS.map(group => {
    const open = openGroups.has(group.id)
    return `<div class="settings-rail-group ${open ? 'is-open' : ''}" data-rail-group-wrap="${escapeHtml(group.id)}">
      <button type="button" class="settings-rail-head" data-rail-group="${escapeHtml(group.id)}" aria-expanded="${open ? 'true' : 'false'}">${escapeHtml(group.label)}</button>
      <div class="settings-rail-sections" ${open ? '' : 'hidden'}>
        ${group.sections.map(section => `<button type="button" data-category="${escapeHtml(section)}">${escapeHtml(section)}</button>`).join('')}
      </div>
    </div>`
  }).join('')
  const root = el(`<main class="view-pad settings-page">
    <div class="settings-shell">
      <header class="settings-header m-head">
        <h1 class="mt">Settings</h1>
        <span class="spacer"></span>
        <label class="settings-search"><span class="settings-sr-only">Search all settings</span><input type="search" placeholder="search all settings" autocomplete="off" spellcheck="false"/></label>
      </header>
      <div class="settings-layout">
        <nav class="settings-rail" aria-label="Settings categories">${railMarkup()}</nav>
        <div class="settings-main">
          <div class="settings-sections" aria-live="polite"></div>
          <p class="settings-footer"></p>
        </div>
      </div>
    </div>
  </main>`)

  const searchInput = root.querySelector('.settings-search input')
  const sectionsNode = root.querySelector('.settings-sections')
  const footer = root.querySelector('.settings-footer')
  const rail = root.querySelector('.settings-rail')
  const levels = new Map(SECTIONS.map(section => [section, 1]))
  let query = ''
  let shown = 0
  let activeSection = SECTIONS[0]
  let segCleanups = []
  let scrollFrame = 0
  let archiveController

  function syncArchiveControl(state = archiveController?.getState()) {
    if (!state) return
    for (const row of root.querySelectorAll('[data-setting-id="ledger_archive"]')) {
      const button = row.querySelector('button[data-setting-action="ledger-archive"]')
      const message = row.querySelector('[data-setting-message]')
      if (button) {
        button.textContent = state.label
        button.disabled = !state.enabled
        button.title = state.note
        button.setAttribute('aria-label', `${state.label}: ${state.note}`)
        button.classList.toggle('is-confirming', state.phase === 'confirm')
        button.classList.toggle('is-pending', state.phase.startsWith('pending'))
        button.classList.toggle('is-success', state.phase === 'success')
      }
      if (message) message.textContent = state.message
    }
  }

  archiveController = createLedgerArchiveController({ onState: syncArchiveControl })

  function cleanupControls() {
    for (const cleanup of segCleanups) cleanup()
    segCleanups = []
  }

  function wireControls() {
    cleanupControls()
    for (const group of sectionsNode.querySelectorAll('.settings-seg')) segCleanups.push(attachSeg(group))
    for (const input of sectionsNode.querySelectorAll('input[type="range"]')) rangeFill(input)
    syncArchiveControl()
    profileController.afterRender(root)
    setupController.afterRender(root)
    chatboxController.afterRender(root)
    researchController.afterRender(root)
  }

  function updateFooter() {
    footer.textContent = `${SETTINGS.length + FLEET_PROFILE_SETTING_COUNT + SETUP_PROFILE_SETTING_COUNT + CHATBOX_SETTING_COUNT + RESEARCH_SETTING_COUNT} settings · ${shown} shown · search finds the hidden ones too`
  }

  function syncRail() {
    const activeGroup = groupOfSection(activeSection)
    for (const head of rail.querySelectorAll('button[data-rail-group]')) {
      head.classList.toggle('is-active', activeGroup?.id === head.dataset.railGroup)
    }
    for (const button of rail.querySelectorAll('button[data-category]')) {
      const on = button.dataset.category === activeSection
      button.classList.toggle('is-active', on)
      if (on) button.setAttribute('aria-current', 'location')
      else button.removeAttribute('aria-current')
    }
  }

  function sectionNodeMarkup(section) {
    if (section === CHATBOX_SECTION) return chatboxController.markup()
    if (section === RESEARCH_SECTION) return researchController.markup()
    if (section === 'System') return profileController.markup()
    if (section === 'Setup') return setupController.markup()
    return sectionMarkup(section, levels.get(section))
  }

  /* How many rows a person can currently see: rows in open groups, at each
     section's revealed depth. A closed group's rows are counted by the total
     and found by search, exactly as the footer sentence says. */
  function sectionShownCount(section) {
    if (section === CHATBOX_SECTION) return CHATBOX_SETTING_COUNT
    if (section === RESEARCH_SECTION) return RESEARCH_SETTING_COUNT
    if (section === 'System') return FLEET_PROFILE_SETTING_COUNT
    if (section === 'Setup') return SETUP_PROFILE_SETTING_COUNT
    return SETTINGS.filter(setting => setting.section === section && setting.depth <= levels.get(section)).length
  }

  function countShown() {
    return SECTIONS.reduce((total, section) => {
      const group = groupOfSection(section)
      return group && !openGroups.has(group.id) ? total : total + sectionShownCount(section)
    }, 0)
  }

  /* One nest level above the sections. `hidden` on the body is the guard: a
     closed group's controls are out of the layout, the tab order and the
     accessibility tree at once, which is what the tier machinery needs three
     attributes to do -- there is nothing animated here to compensate for. */
  function groupMarkup(group) {
    const open = openGroups.has(group.id)
    return `<section class="settings-group ${open ? 'is-open' : ''}" data-settings-group="${escapeHtml(group.id)}">
      <button type="button" class="settings-group-head" data-group-toggle="${escapeHtml(group.id)}" aria-expanded="${open ? 'true' : 'false'}" aria-controls="settings-group-${escapeHtml(group.id)}">
        <span class="settings-group-name">${escapeHtml(group.label)}<span class="settings-reveal-glyph" aria-hidden="true">${open ? '⌃' : '⌄'}</span></span>
        <span class="settings-group-detail">${escapeHtml(group.detail)}</span>
        <span class="settings-group-list">${group.sections.map(section => escapeHtml(section)).join(' · ')}</span>
      </button>
      <div class="settings-group-body" id="settings-group-${escapeHtml(group.id)}" ${open ? '' : 'hidden'}>
        ${group.sections.map(sectionNodeMarkup).join('')}
      </div>
    </section>`
  }

  function syncGroups() {
    for (const groupNode of sectionsNode.querySelectorAll('.settings-group')) {
      const id = groupNode.dataset.settingsGroup
      const open = openGroups.has(id)
      groupNode.classList.toggle('is-open', open)
      const head = groupNode.querySelector('[data-group-toggle]')
      if (head) {
        head.setAttribute('aria-expanded', open ? 'true' : 'false')
        const glyph = head.querySelector('.settings-reveal-glyph')
        if (glyph) glyph.textContent = open ? '⌃' : '⌄'
      }
      const body = groupNode.querySelector('.settings-group-body')
      if (body) body.hidden = !open
    }
    for (const wrap of rail.querySelectorAll('[data-rail-group-wrap]')) {
      const open = openGroups.has(wrap.dataset.railGroupWrap)
      wrap.classList.toggle('is-open', open)
      wrap.querySelector('[data-rail-group]')?.setAttribute('aria-expanded', open ? 'true' : 'false')
      const list = wrap.querySelector('.settings-rail-sections')
      if (list) list.hidden = !open
    }
    shown = countShown()
    updateFooter()
  }

  function setGroupOpen(id, open, { remember = true } = {}) {
    if (open) openGroups.add(id)
    else openGroups.delete(id)
    if (remember) writeOpenGroups(openGroups, globalThis.localStorage)
    syncGroups()
  }

  function renderSectioned() {
    const grouped = new Set(SETTINGS_GROUPS.flatMap(group => group.sections))
    /* A section the group model does not know renders ungrouped at the end
       rather than vanishing; the presentation suite keeps this branch empty. */
    sectionsNode.innerHTML = SETTINGS_GROUPS.map(groupMarkup).join('')
      + SECTIONS.filter(section => !grouped.has(section)).map(sectionNodeMarkup).join('')
    shown = countShown()
    // `inert` is the primary guard; the explicit tabindex pass keeps closed
    // tiers unreachable in older engines while preserving the CSS reveal.
    for (const section of SECTIONS) syncSectionDepth(section)
    wireControls()
    updateFooter()
    syncRail()
    markLanding()
  }

  function renderSearch() {
    const normalized = query.trim().toLowerCase()
    /* The capabilities and risks are searched too. A person who types "risk" is
       asking the one question this lane exists to answer, and a search that
       matched only the row's own name would send them away empty from a page
       that has the answer on every row. */
    const matches = SETTINGS.filter(setting => searchHaystack(setting).includes(normalized))
    const profileMatches = profileController.matches(normalized)
    const setupMatches = setupController.matches(normalized)
    const chatboxMatches = chatboxController.matches(normalized)
    const researchMatches = researchController.matches(normalized)
    sectionsNode.innerHTML = `<section class="settings-results">
      <h2 class="settings-section-title">Results</h2>
      ${chatboxMatches ? chatboxController.markup({ searchResult: true }) : ''}
      ${researchMatches ? researchController.markup({ searchResult: true }) : ''}
      ${profileMatches ? profileController.markup({ searchResult: true }) : ''}
      ${setupMatches ? setupController.markup({ searchResult: true }) : ''}
      ${matches.map(setting => rowMarkup(setting, true)).join('')}
      ${profileMatches || setupMatches || chatboxMatches || researchMatches || matches.length ? '' : '<p class="settings-empty">No settings match this search.</p>'}
    </section>`
    shown = matches.length
      + (profileMatches ? FLEET_PROFILE_SETTING_COUNT : 0)
      + (setupMatches ? SETUP_PROFILE_SETTING_COUNT : 0)
      + (chatboxMatches ? CHATBOX_SETTING_COUNT : 0)
      + (researchMatches ? RESEARCH_SETTING_COUNT : 0)
    wireControls()
    updateFooter()
  }

  function renderCurrent() {
    if (query.trim()) renderSearch()
    else renderSectioned()
  }

  function syncSetting(id, value = readValue(byId.get(id))) {
    const setting = byId.get(id)
    if (!setting) return
    for (const row of root.querySelectorAll(`[data-setting-id="${id}"]`)) {
      for (const button of row.querySelectorAll('button[data-setting-value]')) {
        const on = sameValue(button.dataset.settingValue, value)
        button.classList.toggle('on', on)
        button.setAttribute('aria-pressed', on ? 'true' : 'false')
      }
      const checkbox = row.querySelector('.settings-toggle input')
      if (checkbox) checkbox.checked = Boolean(value)
      /* The state sentence moves with the switch, in the same frame, so the
         two can never be read disagreeing. */
      const stateNode = row.querySelector('[data-setting-state]')
      if (stateNode && setting.type === 'toggle') {
        stateNode.textContent = toggleStateSentence({
          value: Boolean(value),
          def: setting.def,
          acts: writeSettingActions.has(setting.id),
        })
      }
      const range = row.querySelector('input[type="range"]')
      if (range) {
        range.value = value
        const percent = ((Number(value) - Number(range.min)) / (Number(range.max) - Number(range.min))) * 100
        range.style.setProperty('--fill', `${percent}%`)
      }
      const output = row.querySelector('[data-setting-output]')
      if (output) output.textContent = formatValue(setting, value)
    }
  }

  function applyValue(setting, value) {
    const liveView = liveSettingViews.get(setting.id)
    if (liveView) {
      value = setLiveView(liveView, Boolean(value))
    } else if (writeSettingActions.has(setting.id)) {
      value = setWriteEnabled(writeSettingActions.get(setting.id), Boolean(value))
    } else if (setting.id === 'theme') {
      try { localStorage.setItem('mc.theme', String(value)) } catch {}
      document.documentElement.dataset.theme = String(value)
      setDrawerSegment('#theme-seg', 'theme', value)
    } else if (setting.id === 'ui_font') {
      value = applyFontChoice(normalizeFontId(String(value)))
      try { localStorage.setItem(FONT_STORAGE_KEY, value) } catch {}
      setDrawerSegment('#font-seg', 'font', value)
    } else if (setting.id === 'text_size') {
      try { localStorage.setItem('mc.text', String(value)) } catch {}
      const number = Number(value)
      document.body.style.zoom = number === 1 ? '' : String(number)
      setDrawerSegment('#text-seg', 'text', value)
    } else if (setting.id === 'glow') {
      const number = clampNumber(setting, value)
      /* WRITTEN DOWN, NOT ONLY APPLIED. Without this the slider moved, the page
         changed, and the choice was gone at the next launch. */
      rememberAppearance(GLOW_SETTING_ID, number)
      document.documentElement.style.setProperty('--glow', String(number / 100))
      const drawerRange = document.getElementById('set-glow')
      if (drawerRange) {
        drawerRange.value = number
        const percent = ((number - Number(drawerRange.min)) / (Number(drawerRange.max) - Number(drawerRange.min))) * 100
        drawerRange.style.setProperty('--fill', `${percent}%`)
      }
      value = number
    } else if (setting.id === 'reduce_motion') {
      value = Boolean(value)
      rememberAppearance(REDUCE_MOTION_SETTING_ID, value)
      document.body.classList.toggle('reduce-motion', value)
      const drawerToggle = document.getElementById('set-motion')
      if (drawerToggle) drawerToggle.checked = value
    } else if (setting.id === 'scenario_tick_rate') {
      /* This row is live: it drives the sim clock the way the drawer's pace
         slider used to (R1520 moved that slider out of the drawer and here),
         and unlike that slider the choice persists — applyStoredSimPace()
         re-applies it at launch. */
      const number = clampNumber(setting, value)
      sim.setPace(number / 100)
      writeStored(setting, number)
      value = number
    } else {
      writeStored(setting, value)
    }
    syncSetting(setting.id, value)
  }

  function syncSectionDepth(section) {
    const sectionNode = [...sectionsNode.querySelectorAll('.settings-section')]
      .find(node => node.dataset.settingsSection === section)
    if (!sectionNode) return
    const level = levels.get(section)
    for (let depth = 2; depth <= 4; depth += 1) {
      const tier = sectionNode.querySelector(`[data-tier-depth="${depth}"]`)
      if (!tier) continue
      const open = level >= depth
      tier.classList.toggle('is-open', open)
      tier.setAttribute('aria-hidden', open ? 'false' : 'true')
      setTierFocusable(tier, open)

      const button = sectionNode.querySelector(`button[data-reveal-depth="${depth}"]`)
      if (!button) continue
      const count = button.dataset.revealCount
      const prefix = button.dataset.revealPrefix
      button.setAttribute('aria-expanded', open ? 'true' : 'false')
      button.innerHTML = revealInner(prefix, count, open)
    }
    shown = countShown()
    updateFooter()
  }

  function cycleValue(setting, current, delta) {
    if (setting.type === 'select') {
      const options = optionRecords(setting)
      const index = Math.max(0, options.findIndex(option => sameValue(option.value, current)))
      return options[(index + delta + options.length) % options.length].value
    }
    const next = Number(current) + delta * setting.step
    return clampNumber(setting, Number(next.toFixed(4)))
  }

  sectionsNode.addEventListener('click', event => {
    const groupHead = event.target.closest('button[data-group-toggle]')
    if (groupHead) {
      const id = groupHead.dataset.groupToggle
      setGroupOpen(id, !openGroups.has(id))
      return
    }

    /* The two one-press section controls. Each goes through applyValue, the
       same door every individual switch uses, so the write, the store and the
       row repaint are exactly what a row-by-row walk would have done. */
    const bulkLive = event.target.closest('button[data-bulk-live]')
    if (bulkLive) {
      const live = bulkLive.dataset.bulkLive === 'on'
      for (const flag of LIVE_VIEW_FLAGS) applyValue(byId.get(`live_${flag.id}`), live)
      return
    }
    if (event.target.closest('button[data-bulk-write-off]')) {
      for (const flag of WRITE_ACTION_FLAGS) applyValue(byId.get(`write_${flag.id}`), false)
      return
    }

    const archiveButton = event.target.closest('button[data-setting-action="ledger-archive"]')
    if (archiveButton) {
      archiveController.click()
      return
    }

    const reveal = event.target.closest('button[data-reveal-section]')
    if (reveal) {
      const section = reveal.dataset.revealSection
      const depth = Number(reveal.dataset.revealDepth)
      levels.set(section, levels.get(section) >= depth ? depth - 1 : depth)
      syncSectionDepth(section)
      return
    }

    const valueButton = event.target.closest('button[data-setting-value]')
    if (valueButton) {
      const row = valueButton.closest('[data-setting-id]')
      applyValue(byId.get(row.dataset.settingId), valueButton.dataset.settingValue)
      return
    }

    const stepButton = event.target.closest('button[data-step-delta]')
    if (stepButton) {
      const row = stepButton.closest('[data-setting-id]')
      const setting = byId.get(row.dataset.settingId)
      const next = cycleValue(setting, readValue(setting), Number(stepButton.dataset.stepDelta))
      applyValue(setting, next)
    }
  })

  sectionsNode.addEventListener('input', event => {
    const input = event.target.closest('input[type="range"]')
    if (!input) return
    const row = input.closest('[data-setting-id]')
    applyValue(byId.get(row.dataset.settingId), Number(input.value))
  })

  sectionsNode.addEventListener('change', event => {
    const input = event.target.closest('.settings-toggle input')
    if (!input) return
    const row = input.closest('[data-setting-id]')
    applyValue(byId.get(row.dataset.settingId), input.checked)
  })

  searchInput.addEventListener('input', () => {
    query = searchInput.value
    renderCurrent()
  })

  rail.addEventListener('click', event => {
    const scrollBehavior = () => document.body.classList.contains('reduce-motion') ? 'auto' : 'smooth'
    const head = event.target.closest('button[data-rail-group]')
    if (head) {
      const id = head.dataset.railGroup
      const opening = !openGroups.has(id)
      if (query.trim()) {
        query = ''
        searchInput.value = ''
        renderSectioned()
      }
      setGroupOpen(id, opening)
      if (opening) {
        const group = SETTINGS_GROUPS.find(candidate => candidate.id === id)
        if (group) activeSection = group.sections[0]
        syncRail()
        requestAnimationFrame(() => {
          sectionsNode.querySelector(`.settings-group[data-settings-group="${id}"]`)
            ?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
        })
      }
      return
    }
    const button = event.target.closest('button[data-category]')
    if (!button) return
    activeSection = button.dataset.category
    /* A category press is a statement of destination: its group opens if it
       was closed, so the press always lands somewhere rather than nowhere. */
    const group = groupOfSection(activeSection)
    if (group && !openGroups.has(group.id)) setGroupOpen(group.id, true)
    syncRail()
    if (query.trim()) {
      query = ''
      searchInput.value = ''
      renderSectioned()
    }
    requestAnimationFrame(() => {
      const section = [...sectionsNode.querySelectorAll('.settings-section')]
        .find(node => node.dataset.settingsSection === activeSection)
      section?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
    })
  })

  /* The row a link named, marked so the eye finds it. Re-applied on every
     render rather than only on the first, because the capability probes answer
     a second or two after this page paints and re-render it -- without this the
     mark a person was following vanished under them. */
  function markLanding() {
    if (!landing) return
    const row = sectionsNode.querySelector(`[data-setting-id="${landing.id}"]`)
    if (row) row.classList.add('is-landed')
  }

  /* INSTANT, NOT SMOOTH, and that is a decision rather than an oversight. The
     row this lands on measured 10170px down the page; a smooth scroll over that
     distance is a long animated journey past two hundred controls, which reads
     as the page running away from the person who followed the link. Arriving is
     what was asked for. */
  function scrollToLanding() {
    if (!landing) return
    requestAnimationFrame(() => {
      const row = sectionsNode.querySelector(`[data-setting-id="${landing.id}"]`)
      if (!row) return
      row.scrollIntoView({ behavior: 'auto', block: 'center' })
      /* Focus goes to the CONTROL, so somebody who followed the link with the
         keyboard arrives on the switch itself and can press space. preventScroll
         because the line above is what decides where the page sits; letting
         focus scroll as well moves the row off centre again. */
      const control = row.querySelector('input, select, button')
      control?.focus?.({ preventScroll: true })
    })
  }

  function updateActiveFromScroll() {
    scrollFrame = 0
    if (query.trim()) return
    const top = root.getBoundingClientRect().top + 48
    let next = activeSection
    for (const section of sectionsNode.querySelectorAll('.settings-section')) {
      /* A section inside a closed group has no box; it must not win. */
      if (section.closest('.settings-group-body[hidden]')) continue
      if (section.getBoundingClientRect().top <= top) next = section.dataset.settingsSection
      else break
    }
    if (next !== activeSection) {
      activeSection = next
      syncRail()
    }
  }

  const onScroll = () => {
    if (!scrollFrame) scrollFrame = requestAnimationFrame(updateActiveFromScroll)
  }
  root.addEventListener('scroll', onScroll, { passive: true })

  /* The drawer's controls used to be static nodes this view could bind to by
     id; since R1520 the drawer is rebuilt per page at every open, so a node
     bound here would be a dead reference after the next open. The drawer
     announces every applied value instead (src/quick-settings.js), and this
     page re-syncs its copy of that control. */
  const onQuickSetting = (event) => {
    const id = event?.detail?.settingId
    if (id && byId.has(id)) syncSetting(id)
  }
  window.addEventListener(QUICK_SETTING_EVENT, onQuickSetting)

  /* The guided steps say whether the outside thing a setting depends on was
     actually found. Asking costs a round trip, so the page paints first with
     the honest "this copy could not check" and repaints once when the answer
     arrives. Painting a cheerful default while waiting would be the same defect
     in a different coat: a claim about a computer nobody has looked at yet. */
  const onCapabilityProbes = () => { renderCurrent() }
  window.addEventListener(CAPABILITY_PROBE_EVENT, onCapabilityProbes)

  profileController.bind(root)
  /* MEASURED, NOT ASSUMED: neither of these two was bound. `createSetupProfileSettings`
     builds its own click handler and only `bind` attaches it, so every control
     in Settings -> Setup -- the permission level, the working folder, the four
     recorded intents -- rendered, looked live, and did nothing when clicked.
     The seg indicator moved because attachSeg() runs over every `.settings-seg`
     on the page, which is exactly what made it look like it had worked. */
  setupController.bind(root)
  chatboxController.bind(root)
  researchController.bind(root)

  /* LANDING ON THE SWITCH A LINK NAMED, and the reason this is more than a
     scroll.
     MEASURED on the packaged build, following "Turn on agent sessions in
     Settings" from the home screen with a real mouse press: the row it means
     (write_agent-session, "Run an agent session") sat at y=10170 in a 946px
     viewport AND inside a collapsed depth-2 tier carrying `inert`. So it was
     not merely below the fold -- no amount of scrolling reached it, because the
     tier it lives in renders closed and `inert` removes it from hit testing and
     from the tab order. A person who followed that link had to know to open the
     "Write" section's reveal first, which is the one thing the link did not
     say.
     So the section is opened to the depth the row lives at BEFORE the first
     render, which is what makes the row exist un-inert at all, and the scroll
     happens after. Both halves are required; either alone leaves the link
     landing somewhere the control is not. */
  if (landing) {
    activeSection = landing.section
    levels.set(landing.section, Math.max(levels.get(landing.section) || 1, landing.depth))
  }
  renderSectioned()
  if (landing) scrollToLanding()
  void refreshCapabilityProbes()

  return {
    el: root,
    destroy() {
      cleanupControls()
      archiveController.destroy()
      profileController.destroy()
      setupController.destroy()
      chatboxController.destroy()
      researchController.destroy()
      if (scrollFrame) cancelAnimationFrame(scrollFrame)
      window.removeEventListener(QUICK_SETTING_EVENT, onQuickSetting)
      window.removeEventListener(CAPABILITY_PROBE_EVENT, onCapabilityProbes)
    },
  }
}

/* SIMULATION PACE, THE BOOT HALF. The pace control lives in this page's
   Data & Sim section (scenario_tick_rate) since R1520 retired the drawer's
   per-session slider; the choice is stored like every other row here, and
   main.js calls this at launch so the sim clock actually runs at it. */
export function applyStoredSimPace() {
  const setting = byId.get('scenario_tick_rate')
  if (setting) sim.setPace(Number(readStored(setting)) / 100)
}

/* GLOW AND REDUCE MOTION, THE BOOT HALF AND THE DRAWER HALF.
 *
 * Called once at launch (src/main.js) and it does two things. It puts back
 * whatever was stored, which is what makes the two rows behave like the other
 * ninety-eight. And it listens for the gear drawer applying either of them,
 * because that drawer is on every page and applied both directly: the settings
 * page is only one of the two places a person meets these controls, and the
 * other one is the common one.
 *
 * The drawer already announces what it applied so an open settings PAGE can
 * re-sync its rows; this listens to the same announcement and writes it down.
 * Nothing here touches the document -- the surface that announced has already
 * applied the value -- so there is no second opinion about what is on screen.
 */
export function applyStoredAppearance() {
  const applied = applyAppearance()
  if (typeof window !== 'undefined') {
    window.addEventListener(QUICK_SETTING_EVENT, event => {
      const id = event?.detail?.settingId
      if (id === GLOW_SETTING_ID || id === REDUCE_MOTION_SETTING_ID) {
        rememberAppearance(id, event.detail?.value)
      }
    })
  }
  return applied
}
