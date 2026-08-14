/* THE UPPER-RIGHT SETTINGS CONTROL, MADE PAGE-AWARE (owner, R1520).
 *
 * The owner's words: "the settings in the software in the upper right corner
 * still goes to show simulation settings, it should show per page settings
 * with a quick move to settings page and then there is a second way to access
 * it by just going through the pages to the settings page".
 *
 * So the drawer the gear opens is built HERE, fresh at every open, from the
 * route that is on screen: first the settings that belong to that page, then
 * the app-wide appearance controls, then the promoted "all settings" action
 * (the quick move; the second way is the ring — #/settings is a ring stop,
 * see RING in src/main.js). The simulation-pace slider that used to sit in
 * this drawer on every page lives on the settings page's Data & Sim section
 * now, stored and re-applied at launch (src/views/settings.js).
 *
 * WHAT COUNTS AS A PAGE SETTING is bounded by the measured fact recorded in
 * src/chatbox-feed.js: a setting is real only when a module reads it and
 * changes behaviour because of it. The per-page settings that exist today are
 * the per-view live-data flags (src/live-flags.js) — one per surface that has
 * a simulated twin. A page without one gets an honest "no settings specific
 * to this page" line, never an invented control (owner, R1502).
 *
 * The markup uses the drawer's existing control language (.set-row, .theme-seg,
 * .toggle) and keeps the historical ids (#theme-seg, #text-seg, #set-glow,
 * #set-motion): the settings page syncs those ids when its own copy of a value
 * changes, and the QA harnesses drive them by id.
 */

import { LIVE_VIEW_FLAGS, isLiveView, setLiveView } from './live-flags.js'
import { rangeFill } from './views/computers.js'
/* WHAT EACH OF THESE GRANTS AND WHAT IT RISKS (owner, R1529). Both surfaces
   show it -- this drawer and the settings page -- and both ask the same module
   for the words, so the two can never describe one control two ways. That is
   the same rule the live-data row's title already follows. */
import { guidanceMarkup } from './guided-step.js'
import {
  FONT_CHOICES,
  FONT_EVENT_ID,
  FONT_STORAGE_KEY,
  applyFontChoice,
  currentFontChoice,
} from './font-choice.js'

/* Announced after this drawer applies a value, so an open settings PAGE can
   re-sync its own copy of the same control. detail: { settingId, value },
   settingId in the settings page's vocabulary (theme, text_size, glow,
   reduce_motion, live_<view>). */
export const QUICK_SETTING_EVENT = 'mc:quick-setting-changed'

/* Which live-data flag belongs to which route. Only routes with a flag appear;
   the flags themselves are the register in src/live-flags.js. */
const PAGE_LIVE_FLAG = Object.freeze({
  home: 'home',
  computers: 'computers',
  agent: 'agent',
  metrics: 'metrics',
  comms: 'comms',
  ledger: 'ledger',
  research: 'research',
})

const esc = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

/* Current values are read from where they actually live — the DOM state the
   rest of the app obeys — never from a private copy that could drift. */
const currentTheme = () => {
  const t = document.documentElement.dataset.theme
  return t === 'tan' || t === 'black' ? t : 'white'
}
const currentText = () => {
  const z = parseFloat(document.body.style.zoom)
  return z === 0.9 || z === 1.12 ? String(z) : '1'
}
const currentGlow = () => {
  const v = parseFloat(document.documentElement.style.getPropertyValue('--glow'))
  return Number.isFinite(v) ? Math.round(v * 100) : 100
}

function announce(settingId, value) {
  window.dispatchEvent(new CustomEvent(QUICK_SETTING_EVENT, {
    detail: Object.freeze({ settingId, value }),
  }))
}

/* Options are [value, text] tuples; an optional third member is an inline
   style for that one segment. The font row uses it to write every option in
   the font it would apply — the control is its own preview (R1523). */
function segMarkup(id, dataName, options, current, label) {
  return `<div class="theme-seg" id="${id}" role="group" aria-label="${esc(label)}">
    ${options.map(([value, text, style]) => `<button type="button" data-${dataName}="${esc(value)}"${style ? ` style="${esc(style)}"` : ''} class="${value === current ? 'on' : ''}" aria-pressed="${value === current ? 'true' : 'false'}">${esc(text)}</button>`).join('')}
  </div>`
}

function groupMarkup(id, label, content) {
  return `<section class="drawer-group" role="group" aria-labelledby="${id}">
    <h3 class="drawer-group-label" id="${id}">${esc(label)}</h3>
    ${content}
  </section>`
}

function pageRows(routeName) {
  const flagId = PAGE_LIVE_FLAG[routeName]
  if (!flagId) return '<div class="drawer-page-empty">No settings specific to this page.</div>'
  const flag = LIVE_VIEW_FLAGS.find(f => f.id === flagId)
  /* The title carries the same sentence the settings page uses for this flag
     (R1522 language pass wording), so the two surfaces can never describe one
     control two ways. */
  /* The disclosure is a SIBLING of the label, never inside it. A <details>
     nested in a <label> makes clicking the summary toggle the checkbox, so
     reading about a setting would change it -- which on this particular row
     would silently swap the page between your own records and the example. */
  const liveRow = `<label class="set-row set-toggle" title="Show your computer's own records on this page (read from ${esc(flag.domain)}.json). Turn off to see the labelled demonstration instead.">
    <span class="set-label">Live data</span>
    <span class="toggle"><input type="checkbox" data-quick-live="${esc(flag.id)}" ${isLiveView(flag.id) ? 'checked' : ''}/><i></i></span>
  </label>
  ${guidanceMarkup(`live_${flag.id}`, { summary: 'What this shows, and what it risks' })}`
  /* The research page's settings additionally carry the agent tool switches.
     The list is async (it comes from the engine registry over IPC), so the
     markup ships a stated loading line and populateResearchTools() replaces
     it — never a control that silently does nothing while it waits. */
  if (routeName !== 'research') return liveRow
  return `${liveRow}
  <div class="drawer-tools" data-drawer-tools>
    <p class="drawer-tools-note">Reading the tool list from this copy's engine.</p>
  </div>`
}

/* ---------- the research page's tool switches ----------
   Persisted as ONE account row, `agent_tools_disabled` (a JSON array of the
   names switched OFF; the row is removed when nothing is). The enforcement is
   not here: shell/main.cjs composes TOOLSENABLED_TOOL_ALLOWLIST from the same
   row at every session start, and the engine's registry enforces it. A
   checkbox that changed nothing would be the defect the settings doctrine
   names, so the two halves land together or not at all. */

const TOOLS_DISABLED_KEY = 'agent_tools_disabled'

async function populateResearchTools(host) {
  const agent = typeof window === 'undefined' ? null : window.mcAgent
  const account = typeof window === 'undefined' ? null : window.mcAccount
  if (!agent?.tools || !account?.getSetting) {
    host.innerHTML = `<p class="drawer-tools-note">This copy cannot list agent tools. Open ToolsEnabled from its installed app to change them.</p>`
    return
  }
  let listed = null
  let saved = null
  try { [listed, saved] = await Promise.all([agent.tools(), account.getSetting(TOOLS_DISABLED_KEY)]) } catch {}
  if (!listed || listed.ok !== true) {
    host.innerHTML = `<p class="drawer-tools-note">The tool list could not be read from this copy's engine, so nothing here was changed.</p>`
    return
  }
  const signedOut = Boolean(saved && saved.ok === false && saved.code === 'ACCOUNT_NOT_SIGNED_IN')
  const disabled = new Set()
  if (saved && saved.ok === true && typeof saved.value === 'string') {
    try {
      const parsed = JSON.parse(saved.value)
      if (Array.isArray(parsed)) for (const name of parsed) if (typeof name === 'string') disabled.add(name)
    } catch {}
  }
  const withheld = listed.tools.filter(tool => !tool.allowed)
  const switchable = listed.tools.filter(tool => tool.allowed)

  function render() {
    const offCount = switchable.filter(tool => disabled.has(tool.name)).length
    host.innerHTML = `
      <div class="drawer-tools-head">
        <span class="set-label">Agent tools</span>
        <span class="drawer-tools-count">${switchable.length} tools · ${offCount} off</span>
      </div>
      ${signedOut ? '<p class="drawer-tools-note">Sign in to change these. Tool switches belong to your account, and agents started while signed out get the full surface.</p>' : ''}
      <div class="drawer-tools-all">
        <button type="button" data-tools-all-on ${signedOut ? 'disabled' : ''}>Enable all</button>
        <button type="button" data-tools-all-off ${signedOut ? 'disabled' : ''}>Disable all</button>
      </div>
      <div class="drawer-tools-list" role="group" aria-label="Agent tools">
        ${switchable.map(tool => `
          <label class="drawer-tools-row">
            <input type="checkbox" data-tool-name="${esc(tool.name)}" ${disabled.has(tool.name) ? '' : 'checked'} ${signedOut ? 'disabled' : ''}/>
            <span>${esc(tool.name)}</span>
          </label>`).join('')}
      </div>
      ${withheld.length ? `<p class="drawer-tools-note">${withheld.length} more ${withheld.length === 1 ? 'tool is' : 'tools are'} withheld by this computer's permission level and cannot be switched on here.</p>` : ''}
      <p class="drawer-tools-note" data-tools-status>Changes apply to agents you start afterwards. Running sessions keep the tools they started with.</p>`
  }

  async function persist() {
    const status = host.querySelector('[data-tools-status]')
    const value = disabled.size === 0 ? null : JSON.stringify([...disabled])
    let result = null
    try { result = await account.putSetting(TOOLS_DISABLED_KEY, value) } catch {}
    if (!result || result.ok !== true) {
      if (status) status.textContent = 'That change was not saved. Sign in, then set it again.'
      return false
    }
    if (status) status.textContent = 'Saved. Applies to agents you start afterwards; running sessions keep the tools they started with.'
    announce('agent_tools_disabled', [...disabled].join(','))
    return true
  }

  host.addEventListener('change', async event => {
    const name = event.target?.dataset?.toolName
    if (!name) return
    if (event.target.checked) disabled.delete(name)
    else disabled.add(name)
    const savedNow = await persist()
    if (!savedNow) { event.target.checked = !event.target.checked; disabled[event.target.checked ? 'delete' : 'add'](name) }
    const count = host.querySelector('.drawer-tools-count')
    if (count) count.textContent = `${switchable.length} tools · ${switchable.filter(tool => disabled.has(tool.name)).length} off`
  })
  host.addEventListener('click', async event => {
    if (event.target?.hasAttribute?.('data-tools-all-on')) {
      disabled.clear()
      if (await persist()) render()
    } else if (event.target?.hasAttribute?.('data-tools-all-off')) {
      for (const tool of switchable) disabled.add(tool.name)
      if (await persist()) render()
    }
  })
  render()
}

/* Each drawer row names the SAME setting id the settings page uses, so both
   surfaces resolve to one statement rather than two that drift. */
function appRows() {
  const motion = document.body.classList.contains('reduce-motion')
  const note = (id, section) => guidanceMarkup(id, { section, summary: 'What this changes, and what it risks' })
  return `<div class="set-row">
    <span class="set-label">Theme</span>
    ${segMarkup('theme-seg', 'theme', [['white', 'White'], ['tan', 'Tan'], ['black', 'Black']], currentTheme(), 'Theme')}
  </div>
  ${note('theme', 'Appearance')}
  <div class="set-row">
    <span class="set-label">Font</span>
    ${segMarkup('font-seg', 'font', FONT_CHOICES.map(choice => [choice.id, choice.label, `font-family:${choice.stack}`]), currentFontChoice(), 'Font')}
  </div>
  ${note('ui_font', 'Appearance')}
  <div class="set-row">
    <span class="set-label">Text size</span>
    ${segMarkup('text-seg', 'text', [['0.9', 'Small'], ['1', 'Default'], ['1.12', 'Large']], currentText(), 'Text size')}
  </div>
  ${note('text_size', 'Text & Reading')}
  <label class="set-row">
    <span class="set-label">Glow intensity</span>
    <input type="range" id="set-glow" min="0" max="200" value="${currentGlow()}" />
  </label>
  ${note('glow', 'Motion & Effects')}
  <label class="set-row set-toggle">
    <span class="set-label">Reduce motion</span>
    <span class="toggle"><input type="checkbox" id="set-motion" ${motion ? 'checked' : ''}/><i></i></span>
  </label>
  ${note('reduce_motion', 'Motion & Effects')}`
}

function wire(body) {
  const themeSeg = body.querySelector('#theme-seg')
  themeSeg?.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-theme]')
    if (!b) return
    const t = b.dataset.theme
    try { localStorage.setItem('mc.theme', t) } catch {}
    document.documentElement.dataset.theme = t
    for (const btn of themeSeg.querySelectorAll('button')) {
      const on = btn.dataset.theme === t
      btn.classList.toggle('on', on)
      btn.setAttribute('aria-pressed', on ? 'true' : 'false')
    }
    announce('theme', t)
  })

  const fontSeg = body.querySelector('#font-seg')
  fontSeg?.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-font]')
    if (!b) return
    const id = applyFontChoice(b.dataset.font)
    try { localStorage.setItem(FONT_STORAGE_KEY, id) } catch {}
    for (const btn of fontSeg.querySelectorAll('button')) {
      const on = btn.dataset.font === id
      btn.classList.toggle('on', on)
      btn.setAttribute('aria-pressed', on ? 'true' : 'false')
    }
    announce(FONT_EVENT_ID, id)
  })

  const textSeg = body.querySelector('#text-seg')
  textSeg?.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-text]')
    if (!b) return
    const v = parseFloat(b.dataset.text)
    try { localStorage.setItem('mc.text', String(v)) } catch {}
    document.body.style.zoom = v === 1 ? '' : String(v)
    for (const btn of textSeg.querySelectorAll('button')) {
      const on = parseFloat(btn.dataset.text) === v
      btn.classList.toggle('on', on)
      btn.setAttribute('aria-pressed', on ? 'true' : 'false')
    }
    announce('text_size', String(v))
  })

  const glow = body.querySelector('#set-glow')
  if (glow) {
    glow.addEventListener('input', () => {
      document.documentElement.style.setProperty('--glow', String(glow.value / 100))
      announce('glow', Number(glow.value))
    })
    rangeFill(glow)
  }

  body.querySelector('#set-motion')?.addEventListener('change', (e) => {
    document.body.classList.toggle('reduce-motion', e.target.checked)
    announce('reduce_motion', e.target.checked)
  })

  for (const input of body.querySelectorAll('input[data-quick-live]')) {
    input.addEventListener('change', () => {
      /* setLiveView announces LIVE_FLAGS_EVENT itself, which is what rebuilds
         the (inert) page behind this drawer — the toggle is visibly real. */
      const enabled = setLiveView(input.dataset.quickLive, input.checked)
      input.checked = enabled
      announce(`live_${input.dataset.quickLive}`, enabled)
    })
  }
}

/** Rebuild the drawer body for the page the person is on. */
export function renderQuickSettings(body, routeName) {
  if (!body) return
  body.innerHTML = [
    groupMarkup('drawer-group-page', `This page · ${routeName}`, pageRows(routeName)),
    groupMarkup('drawer-group-app', 'Every page', appRows()),
    '<div class="drawer-note">Set here, applied now — the fleet keeps running.</div>',
  ].join('')
  wire(body)
  const toolsHost = body.querySelector('[data-drawer-tools]')
  if (toolsHost) populateResearchTools(toolsHost)
}
