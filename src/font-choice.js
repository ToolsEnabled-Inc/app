/* THE INTERFACE FONT, MADE A CHOICE (owner, R1523).
 *
 * The owner's words: "Also the default font is not my most favorite." Hedged,
 * so per R70 the resolution is judgment, not a gate — and the judgment (per
 * the rules-are-user-settings frame) is that the font becomes a setting with
 * a better default, not a hardcoded swap from one opinion to the next.
 *
 * This register is the single source of the choices. Both surfaces that offer
 * the choice — the per-page drawer (src/quick-settings.js, "Every page" group)
 * and the settings page's Appearance section (src/views/settings.js) — render
 * from here, and each option's control is written IN the font it applies, so
 * the button is its own preview and can never overpromise.
 *
 * WHY THESE FOUR, AND WHY THE WEIGHT AXIS DECIDES. The stylesheet leans on
 * fine-grained variable weights — measured before this change: 88 uses of
 * font-weight 640, plus 620/650/550/660 and friends — so any face offered
 * here must carry a real weight axis or the whole app visibly coarsens to
 * 600/700 snapping. That rules out the classic static system stacks (Corbel,
 * Century Gothic) and is why the two non-system choices ship IN the bundle as
 * variable fonts rather than hoping the machine has them:
 *
 *   plex     IBM Plex Sans (bundled, variable). THE DEFAULT. The app's
 *            severity palette already borrows from IBM's Carbon design
 *            system (see the "Carbon families" notes in styles.css); Plex is
 *            Carbon's own typeface, so the type now matches the color
 *            language it sits in. An engineered, slightly technical voice —
 *            right for a control room — without being the generic
 *            neo-grotesque the owner just declined.
 *   system   The computer's own interface font — Segoe UI Variable on
 *            Windows 11, San Francisco on macOS — via the platform stack.
 *            Free, native rendering, zero bytes shipped.
 *   grotesk  Space Grotesk (bundled, variable). The geometric option, with
 *            enough character to read as a deliberate choice rather than a
 *            fallback.
 *   mono     JetBrains Mono, which the app already bundles for its data
 *            accents, promoted to the whole interface: the terminal look,
 *            taken all the way.
 *
 * OFFLINE IS A HARD RULE. Every stack below is either shipped in the bundle
 * (fontsource imports in src/main.js — no network fetch, ever) or resolved by
 * the operating system. No choice may name a font that would need a network
 * to arrive; the app runs offline and the artifact CSP forbids remote hosts.
 *
 * The applied state lives where the rest of the appearance settings live: the
 * --font-ui custom property on the root element (every sheet already reads
 * it; --font-mono is untouched, so data accents keep their mono voice under
 * every choice). The stored state is localStorage "mc.font", read before
 * first paint by the inline classic script in index.html — same idiom, same
 * reason as mc.theme: a deferred module applying it alone would flash the
 * default at every non-default user.
 */

export const FONT_EVENT_ID = 'ui_font'
export const FONT_STORAGE_KEY = 'mc.font'
export const DEFAULT_FONT = 'plex'

export const FONT_CHOICES = Object.freeze([
  Object.freeze({
    id: 'plex',
    label: 'Plex',
    stack: '"IBM Plex Sans Variable", "IBM Plex Sans", "Segoe UI Variable", system-ui, sans-serif',
  }),
  Object.freeze({
    id: 'system',
    label: 'System',
    stack: '"Segoe UI Variable", system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  }),
  Object.freeze({
    id: 'grotesk',
    label: 'Grotesk',
    stack: '"Space Grotesk Variable", "Space Grotesk", "Segoe UI Variable", system-ui, sans-serif',
  }),
  Object.freeze({
    id: 'mono',
    label: 'Mono',
    stack: '"JetBrains Mono Variable", ui-monospace, "Cascadia Mono", Consolas, monospace',
  }),
])

const byId = new Map(FONT_CHOICES.map(choice => [choice.id, choice]))

export function fontStack(id) {
  return (byId.get(id) || byId.get(DEFAULT_FONT)).stack
}

/** Normalise any stored/announced value to a real choice id. */
export function normalizeFontId(id) {
  return byId.has(id) ? id : DEFAULT_FONT
}

/* The applied value is read from where it actually lives — the root element
   the stylesheets obey — never from a private copy that could drift (same
   principle as currentTheme in src/quick-settings.js). No inline value means
   the stylesheet default is in force, which is DEFAULT_FONT's stack. */
export function currentFontChoice() {
  const applied = document.documentElement.style.getPropertyValue('--font-ui').trim()
  if (!applied) return DEFAULT_FONT
  return FONT_CHOICES.find(choice => choice.stack === applied)?.id || DEFAULT_FONT
}

/** Apply a choice app-wide, live. Returns the id that actually applied. */
export function applyFontChoice(id) {
  const choice = byId.get(id) || byId.get(DEFAULT_FONT)
  /* Setting the inline property even for the default keeps currentFontChoice
     and the pre-paint script trivially consistent: the inline value, when
     present, IS the truth. */
  document.documentElement.style.setProperty('--font-ui', choice.stack)
  /* CANVAS TEXT FOLLOWS, BY THE PATH THAT ALREADY EXISTS. Chart text is
     painted, not styled: every canvas surface snapshots the computed body
     font through buildTheme() and rebuilds that snapshot when data-theme is
     WRITTEN (metrics, computers, approvals, owner-popup each observe exactly
     that attribute). Re-asserting the current theme value is a same-value
     write, which still fires those observers — so one discrete font click
     re-fonts every live chart through the one rebuild path they all already
     have, instead of teaching four observers a second attribute (and the
     glow slider's style writes would then storm them). */
  const theme = document.documentElement.dataset.theme
  if (theme) document.documentElement.dataset.theme = theme
  return choice.id
}
