/* HOW THE SETTINGS PAGE PRESENTS ITSELF: the two-level grouping, the sentence
 * beside a switch, and the translation of a System refusal.
 *
 * THIS MODULE DECIDES NO SETTING AND STORES NO SETTING. Every row's id, storage
 * key, default and enforcement are exactly where they were; what lives here is
 * the presentation the first outside user asked for ("the settings menu was
 * hard to read... can we nest the settings menu more and more cleanly"), kept
 * DOM-free so a plain node test can hold it still.
 *
 * WHY THE GROUPS ARE DATA HERE AND NOT MARKUP IN THE VIEW. Twelve category
 * buttons is a list a person reads; four groups is a list a person scans. (It
 * was seventeen under six when this was written; the counts move as sections
 * come and go, and the ratio is the point rather than either number.) The
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
  /* The first-visit spine: joining this computer to an account, what the first
     page shows, what the walkthrough recorded, and this computer's own machines.
   *
   * 'Connect this computer' IS IN THIS ARRAY AS OF NOW, and adding it retired a
   * whole placement mechanism. src/views/settings.js used to hand-place this one
   * section at the top of this group because groupOfSection() answered null for
   * it, and its own comment named the retirement condition: the moment the name
   * appears here, the ordinary path renders it and the branch stops firing. Two
   * ways to place a section on one page is how a page ends up with two ideas of
   * where things go.
   *
   * IT IS FIRST, AND THAT IS THE HALF A READER FEELS. The group head prints
   * `group.sections` while it is CLOSED -- that line exists so anything can be
   * found without opening a thing -- so for as long as this section was outside
   * the model, the closed 'Start here' line read "Home screen · Setup · System"
   * and never said the words "connect this computer". The owner's report was
   * "as a user I dont even see how after signing up that I now connect my
   * computer", and the one line whose job is findability was omitting it. */
  Object.freeze({
    id: 'start',
    label: 'Start here',
    detail: 'Connecting this computer, the first page, and what setup recorded',
    sections: Object.freeze(['Connect this computer', 'Home screen', 'Setup', 'System']),
  }),
  /* THIS GROUP HELD ONE SECTION, AND THAT SECTION HAD THE GROUP'S OWN NAME.
   *
   * MEASURED on a real 1002x650 window: the page drew "DATA & PRIVACY" as the
   * group line and "DATA & PRIVACY" again as the section title directly under
   * it, in the same 11-12px uppercase grey, over a single row. The rail said it
   * twice as well. A category of one is not a category, and a category of one
   * that repeats its own name is the clearest thing on the page telling a reader
   * the nesting is decorative.
   *
   * WHAT JOINED IT, AND WHY THESE THREE ARE ONE QUESTION. 'Ledger' and
   * 'Data & Sim' came from the `screens` group, which is gone (see below). All
   * three answer "what happens to the records this computer holds": what is kept
   * when you uninstall, what is cleared out of the ledger, and which set of
   * records every screen is showing you. Nothing about any row changed.
   *
   * THE LABEL HAD TO MOVE WITH THE CONTENTS. "Data & privacy" over a group that
   * also holds archiving and the example switch would be the group line
   * overclaiming, which is the failure the `screens` subtitle was rewritten for
   * on 2026-08-20. It is also what stops the name being said twice. */
  Object.freeze({
    id: 'privacy',
    label: 'Your data',
    detail: 'What is kept, what is cleared out, and what the screens show',
    sections: Object.freeze(['Data & Privacy', 'Ledger', 'Data & Sim']),
  }),
  Object.freeze({
    id: 'actions',
    label: 'Agents & actions',
    detail: 'What may run, and what may act without you',
    /* 'Research' became 'Research & Agents' on 2026-08-20. The name is the key
       this map is looked up by, so the two must move together: a section whose
       name is not in any group renders UNGROUPED, which on this page means it
       is not on it.

       THIS MAP IS NOT THE ONLY THING A RENAME HAS TO MOVE, and the rest of it
       is easy to miss because none of it is in this file. MEASURED 2026-08-22,
       while the group level above was being reorganised and every reference had
       to be checked: section names are spelled out in SEVENTEEN sentences a
       person reads, across three files -- thirteen turnOnAt paths in
       src/permission-guidance.js, two in src/setup-profile-settings.js, two in
       src/views/setup.js -- plus seven comments elsewhere. Group LABELS appear
       in none of them, which is exactly why relabelling a group costs nothing
       and renaming a section costs a sweep.

       TWO STRINGS WEAR THE SAME SHAPE AND MUST NOT BE RENAMED.
       src/account-reset-copy.js:73 and :270 read "Windows Settings → Apps".
       They say how to uninstall through Windows; they are not a route into this
       page. :73 is split across a concatenation, so a line-based edit sees a
       dangling "Windows Settings → " with "Apps" opening the next line -- the
       shape most likely to be helpfully completed with a section name. Both sit
       on the delete-everything screen, read by somebody who has just wiped
       their data and is trying to finish leaving, which is the worst place in
       this product to be sent somewhere that does not exist. Filter those two
       out before anything pattern-based runs.

       src/permission-guidance.js:514 is the artefact of this going wrong once
       already: a turnOnAt that outlived its section and pointed at
       "Settings → Developer", a heading that was not there. */
    sections: Object.freeze(['Research & Agents', 'Write']),
  }),
  Object.freeze({
    id: 'appearance',
    label: 'Appearance & reading',
    detail: 'Theme, text, and motion',
    sections: Object.freeze(['Appearance', 'Text & Reading', 'Motion & Effects']),
  }),
  /* THE 'screens' GROUP IS GONE, AND ITS OWN COMMENT WROTE THE RULE THAT ENDED
     IT. It lost four of its six sections on 2026-08-20 -- Fleet Graph, Metrics,
     Chat & Threads, Comms Board, Performance and Developer were inert top to
     bottom, every row in them writing a key nothing read
     (docs/design/UNBUILT-SETTINGS-ROWS-2026-08-20.md keeps the wording) -- and
     the rule it recorded was "a group whose every section is gone must go too:
     a group line that opens onto nothing is the same lie one level up".

     What it had left was 'Ledger' and 'Data & Sim': two sections, ONE ROW EACH.
     "Screen by screen · What each page reads, and clearing out old records" is a
     group line promising a per-screen register and opening onto two switches.
     That is the same overclaim one notch quieter, and it was already the second
     rewrite of that subtitle. Both sections moved into 'Your data' above, where
     the question they answer is actually asked. Neither row changed. */
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
 * Collapsed by default: a first visit shows the group lines and nothing
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

/* ---------- arriving, as opposed to returning ----------
 *
 * COLLAPSED-BY-DEFAULT IS RIGHT FOR SOMEBODY COMING BACK AND WRONG FOR SOMEBODY
 * ARRIVING, and until this existed the page could not tell the two apart.
 *
 * MEASURED on the 1.0.20 cut, driving the packaged build on a sterile profile
 * (tools/signin-reach-probe.mjs). A person who has just installed this product
 * opens Settings and gets SIX GREY HEADINGS AND NOTHING ELSE. Six of the page's
 * 246 controls had a box, and the footer said it in the product's own voice:
 *
 *     "116 settings · 0 shown · search finds the hidden ones too"
 *
 * THAT SENTENCE IS QUOTED AS MEASURED AND IS DELIBERATELY NOT UPDATED. It is
 * what the footer said on the 1.0.20 cut, and it is the evidence for the defect
 * described here; rewriting the number to today's would falsify a measurement to
 * keep a comment tidy. The number has since changed on its own: 74 rows that
 * wrote a key nothing read were removed on 2026-08-20, so the same footer now
 * reads 43. The defect this section describes -- every control hidden behind a
 * collapsed group on a first visit -- is unrelated to that, and the fix below
 * still stands.
 *
 * The sharpest instance, and the one that started the hunt: `#/account` has
 * exactly ONE persistent door in this product -- the "Open sign-in" row in
 * System (src/fleet-profile-settings.js) -- and it was inside
 * `div.settings-group-body[hidden]`, computing display:flex and measuring 0x0.
 * So the single most important action available to somebody with no account was
 * not on the screen at all. A packaged driver had been reporting this for a
 * night as `sign-in-link:zero-size`.
 *
 * WHAT THIS FUNCTION MAY NOT DO, which is most of its design:
 *
 *   - it may not touch remembered posture. readOpenGroups still opens nothing
 *     from an empty store; "what this person last left open" and "what should
 *     be open for somebody who has never been here" are different questions and
 *     answering them in one place is how the first one gets corrupted.
 *   - it may not write. Arriving is not a filing decision -- the same rule the
 *     landing clause has always kept. If it wrote, a person who never touched a
 *     group would have one filed as their posture, and this function would
 *     permanently lose the ability to tell an arrival from a return.
 *   - it may not open more than it has to. Opening all six would undo the
 *     nesting the outside user asked for and hand back the flat wall of
 *     controls that was the original complaint. One group open, five
 *     discoverable.
 *
 * The opened group is DERIVED from the section holding the outstanding action
 * rather than being a hardcoded index, so regrouping System moves the rule with
 * it instead of quietly opening the wrong group.
 */

/* The section whose absence a brand-new person feels first: it holds the
   sign-in row, and that row is the only persistent way to reach #/account. */
export const FIRST_VISIT_SECTION = 'System'

/**
 * Which groups are open for THIS render.
 *
 * @param storage        the posture store, read but never written
 * @param landingSection the section a link named, when a link named one
 */
export function groupsOpenOnArrival(storage, landingSection = null) {
  const open = readOpenGroups(storage)
  const landingGroup = landingSection ? groupOfSection(landingSection) : null
  if (landingGroup) open.add(landingGroup.id)
  if (open.size > 0) return open
  const arrival = groupOfSection(FIRST_VISIT_SECTION)
  if (arrival) open.add(arrival.id)
  return open
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
