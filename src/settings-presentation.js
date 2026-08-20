/* HOW THE SETTINGS PAGE PRESENTS ITSELF: the two-level grouping, the sentence
 * beside a switch, and the translation of a System refusal.
 *
 * THIS MODULE DECIDES NO SETTING AND STORES NO SETTING. Every row's id, storage
 * key, default and enforcement are exactly where they were; what lives here is
 * the presentation the first outside user asked for ("the settings menu was
 * hard to read... can we nest the settings menu more and more cleanly"), kept
 * DOM-free so a plain node test can hold it still.
 *
 * WHY THE GROUPS ARE DATA HERE AND NOT MARKUP IN THE VIEW. Seventeen category
 * buttons is a list a person reads; six groups is a list a person scans. The
 * mapping has two failure modes that only a table can be tested against: a
 * section in no group silently vanishes from the page, and a section in two
 * renders twice. tools/test/settings-presentation.test.mjs holds both.
 *
 * THE ORDER KEEPS THE PAGE'S OLD PROMISES. The chat box section stays first
 * because the box it governs is the first thing in the product; Data & Privacy
 * and Research stay above the appearance knobs for the reasons written where
 * those sections are declared in src/views/settings.js. Nesting must not
 * quietly demote what the flat list deliberately promoted.
 */

export const SETTINGS_GROUPS = Object.freeze([
  /* The first-visit spine: what the first page shows, what the walkthrough
     recorded, and this computer's own machines and account. */
  Object.freeze({
    id: 'start',
    label: 'Start here',
    detail: 'The first page, what setup recorded, and this computer',
    sections: Object.freeze(['Home screen', 'Setup', 'System']),
  }),
  Object.freeze({
    id: 'privacy',
    label: 'Data & privacy',
    detail: 'What stays on this computer when you leave',
    sections: Object.freeze(['Data & Privacy']),
  }),
  Object.freeze({
    id: 'actions',
    label: 'Agents & actions',
    detail: 'What may run, and what may act without you',
    sections: Object.freeze(['Research', 'Write']),
  }),
  Object.freeze({
    id: 'appearance',
    label: 'Appearance & reading',
    detail: 'Theme, text, and motion',
    sections: Object.freeze(['Appearance', 'Text & Reading', 'Motion & Effects']),
  }),
  Object.freeze({
    id: 'screens',
    label: 'Screen by screen',
    detail: 'Each page’s own knobs, and what each page reads',
    sections: Object.freeze(['Fleet Graph', 'Metrics', 'Chat & Threads', 'Comms Board', 'Ledger', 'Data & Sim']),
  }),
  Object.freeze({
    id: 'advanced',
    label: 'Advanced',
    detail: 'Performance and developer readouts',
    sections: Object.freeze(['Performance', 'Developer']),
  }),
])

const GROUP_BY_SECTION = new Map(
  SETTINGS_GROUPS.flatMap(group => group.sections.map(section => [section, group])),
)
const GROUP_IDS = new Set(SETTINGS_GROUPS.map(group => group.id))

/** The group a section renders inside, or null for a section this model
 *  does not know — which the caller treats as "render it ungrouped" rather
 *  than dropping it, so a new section can never silently vanish. */
export function groupOfSection(section) {
  return GROUP_BY_SECTION.get(section) || null
}

/* ---------- remembered open-state ----------
 *
 * Collapsed by default: a first visit shows the six group lines and nothing
 * else, which is the "scan in one glance" the nesting exists for. What a
 * person opens stays open across visits and restarts. This is remembered UI
 * posture like a scroll position, not a user setting: it grants nothing,
 * gates nothing, and the settings footer does not count it. */

export const OPEN_GROUPS_KEY = 'mc.settings.open-groups'

export function readOpenGroups(storage) {
  try {
    const raw = storage?.getItem?.(OPEN_GROUPS_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter(id => GROUP_IDS.has(id)))
  } catch {
    return new Set()
  }
}

export function writeOpenGroups(openIds, storage) {
  try {
    const kept = [...openIds].filter(id => GROUP_IDS.has(id))
    if (kept.length === 0) storage?.removeItem?.(OPEN_GROUPS_KEY)
    else storage?.setItem?.(OPEN_GROUPS_KEY, JSON.stringify(kept))
  } catch { /* a full or refused store loses only the remembered posture */ }
}

/* ---------- the sentence beside a switch ----------
 *
 * MEASURED tonight on the driven build: a Write row whose switch read ON
 * carried "This ships switched off", and the reader believed the sentence over
 * the switch. The rule: the sentence says the CURRENT truth first — "On." or
 * "Off." — and only then the shipped default, phrased so the two can never
 * disagree. `acts` marks the family whose switches let the program act rather
 * than read; those keep their fuller guarantee. */

export function toggleStateSentence({ value, def = false, acts = false }) {
  const truth = value ? 'On.' : 'Off.'
  if (acts) {
    return value
      ? 'On. This ships switched off; it was turned on on this computer.'
      : 'Off. This ships switched off; nothing acts until you turn it on.'
  }
  if (Boolean(value) === Boolean(def)) return truth
  return value ? 'On. Ships off.' : 'Off. Ships on.'
}

/* ---------- the System refusals, translated ----------
 *
 * The validator in src/fleet-profile.js speaks in field paths — "machines[0].ip
 * address is required" — because it is a validator and the path is its truth.
 * A person counting the machine boxes on the screen counts from one and has
 * never seen the word "machines[0]". The translation leads with the sentence a
 * person can act on and keeps the precise field named at the end, so a report
 * or a screenshot still says exactly which field refused. */

const MACHINE_PATH = /^machines\[(\d+)\]\.(\w+)$/
const TRANSPORT_PATH = /^transports\[(\d+)\]\.(\w+)$/

function fieldNote(path) {
  return ` (the ${path} field)`
}

export function humanizeProfileError(error) {
  const rawPath = typeof error?.path === 'string' ? error.path : '$'
  const message = typeof error?.message === 'string'
    ? error.message
    : 'needs a different value; edit it and save again'

  const machine = MACHINE_PATH.exec(rawPath)
  if (machine) {
    const nth = Number(machine[1]) + 1
    if (machine[2] === 'ip' || machine[2] === 'address') {
      return `Machine ${nth} needs an address — host:port, a URL, an IP, or a hostname${fieldNote(rawPath)}.`
    }
    if (machine[2] === 'name') {
      return `Machine ${nth} needs a name${fieldNote(rawPath)}.`
    }
    return `Machine ${nth}: its ${machine[2]} ${message}${fieldNote(rawPath)}.`
  }

  const transport = TRANSPORT_PATH.exec(rawPath)
  if (transport) {
    const nth = Number(transport[1]) + 1
    if (transport[2] === 'port') {
      return `Connection ${nth}'s port must be a number from 1 through 65535, or left empty${fieldNote(rawPath)}.`
    }
    if (transport[2] === 'endpoint') {
      return `Connection ${nth}'s address must be written as text — a URL or host:port${fieldNote(rawPath)}.`
    }
    return `Connection ${nth}: its ${transport[2]} ${message}${fieldNote(rawPath)}.`
  }

  if (rawPath === 'label' || rawPath === '$.label') {
    return `The profile needs a name — any label you will recognize${fieldNote(rawPath)}.`
  }
  if (rawPath === 'dataSource.path') {
    return `The data folder needs a real folder path${fieldNote(rawPath)}.`
  }

  /* Unknown family: keep the whole refusal rather than dropping it, exactly
     as the raw form did, so nothing a validator can say goes unheard. */
  return `${rawPath} ${message}`
}

export function humanizeProfileErrors(errors, { limit = 5 } = {}) {
  return (errors || []).slice(0, limit).map(humanizeProfileError).join(' ')
}
