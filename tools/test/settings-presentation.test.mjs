/* THE SETTINGS PAGE'S TWO-LEVEL SHAPE, AND THE SENTENCES ON ITS ROWS.
 *
 * Written failing-first for the settings-ia lane. Three families:
 *
 *   1  THE GROUPS. The seventeen flat categories nest under a handful of
 *      top-level groups a person can scan in one glance. The registry and the
 *      section names do not change -- grouping is presentation -- so the model
 *      is a pure mapping, and the one thing that must never happen is a section
 *      falling out of every group (it would silently vanish from the page) or
 *      into two (it would render twice). The section list asserted here is
 *      cross-checked against src/views/settings.js by the source test below.
 *
 *   2  THE STATE SENTENCES. Measured tonight on the driven build: a Write row
 *      whose switch read ON carried the sentence "This ships switched off",
 *      and the reader believed the sentence over the switch. The rule under
 *      test: the sentence says the CURRENT truth first, and never contradicts
 *      the visible control.
 *
 *   3  THE SYSTEM REFUSALS. "machines[0].ip address is required" is a machine
 *      word on the glass. The translation keeps the precise field named while
 *      leading with a human sentence.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  FIRST_VISIT_SECTION,
  SETTINGS_GROUPS,
  groupOfSection,
  groupsOpenOnArrival,
  readOpenGroups,
  writeOpenGroups,
  toggleStateSentence,
  humanizeProfileError,
  humanizeProfileErrors,
} from '../../src/settings-presentation.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/* The seventeen sections the page renders today, in its own order. If the page
   gains or loses one, this list and the groups must move together -- the source
   assertions below are what notice the drift. */
const SECTIONS = [
  'Home screen', 'System', 'Setup', 'Data & Privacy', 'Research',
  'Appearance', 'Text & Reading', 'Motion & Effects',
  'Fleet Graph', 'Metrics', 'Chat & Threads', 'Comms Board', 'Ledger',
  'Performance', 'Data & Sim', 'Write', 'Developer',
]

test('every section lives in exactly one group', () => {
  const seen = new Map()
  for (const group of SETTINGS_GROUPS) {
    for (const section of group.sections) {
      assert.equal(seen.has(section), false, `${section} is in ${seen.get(section)} and ${group.id}`)
      seen.set(section, group.id)
    }
  }
  for (const section of SECTIONS) {
    assert.ok(seen.has(section), `${section} is in no group and would vanish from the page`)
  }
  assert.equal(seen.size, SECTIONS.length, 'a group names a section the page does not render')
})

test('the groups are few enough to scan, and each names itself in plain words', () => {
  assert.ok(SETTINGS_GROUPS.length >= 4 && SETTINGS_GROUPS.length <= 7,
    `${SETTINGS_GROUPS.length} top-level groups is not a glanceable set`)
  for (const group of SETTINGS_GROUPS) {
    assert.ok(group.id && /^[a-z][a-z-]*$/.test(group.id), `group id ${group.id}`)
    assert.ok(group.label && group.label.length <= 28, `label "${group.label}" is not glanceable`)
  }
})

test('groupOfSection answers for every section and refuses the unknown', () => {
  for (const section of SECTIONS) {
    const group = groupOfSection(section)
    assert.ok(group, `${section} has no group`)
    assert.ok(group.sections.includes(section))
  }
  assert.equal(groupOfSection('No Such Section'), null)
})

/* ---------- remembered open-state ---------- */

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)) },
    removeItem: key => { map.delete(key) },
  }
}

test('groups are collapsed by default: an empty store opens nothing', () => {
  const open = readOpenGroups(memoryStorage())
  assert.equal(open.size, 0)
})

test('open-state round-trips, and unknown ids are dropped rather than kept', () => {
  const storage = memoryStorage()
  const first = SETTINGS_GROUPS[0].id
  const second = SETTINGS_GROUPS[1].id
  writeOpenGroups([first, second, 'no-such-group'], storage)
  const open = readOpenGroups(storage)
  assert.ok(open.has(first) && open.has(second))
  assert.equal(open.has('no-such-group'), false)
})

test('a corrupt store reads as the default, never as a throw', () => {
  const storage = memoryStorage()
  writeOpenGroups([SETTINGS_GROUPS[0].id], storage)
  storage.setItem('mc.settings.open-groups', '{not json')
  assert.equal(readOpenGroups(storage).size, 0)
  assert.equal(readOpenGroups(null).size, 0)
})

/* ---------- arriving, as opposed to returning ----------
 *
 * WHAT WAS MEASURED, on the 1.0.20 cut, driving the packaged build on a sterile
 * profile (tools/signin-reach-probe.mjs). A person who has just installed this
 * opens Settings and gets SIX GREY HEADINGS AND NOTHING ELSE. Six of the page's
 * 246 controls had a box; the product's own footer said it out loud --
 *
 *     "116 settings · 0 shown · search finds the hidden ones too"
 *
 * -- and the ancestor walk named the mechanism exactly:
 * DIV.settings-group-body#settings-group-start, hidden=true, display=none,
 * box 0x0, with `a.ctl-btn[href="#/account"]` inside it computing display:flex
 * and measuring 0x0. `#/account` has exactly ONE persistent door in this
 * product (src/fleet-profile-settings.js), and it was behind that collapse. So
 * the single most important thing a person with no account can do was not on
 * the screen, and pressing the group header put it there -- proving the
 * collapse was the whole cause rather than occlusion or a broken anchor.
 *
 * THE RULE, AND WHY IT IS NARROW. Remembered posture is not touched:
 * readOpenGroups still opens nothing from an empty store, because "what this
 * person last left open" is a different question from "what should be open for
 * somebody who has never been here". The arrival rule adds one clause to the
 * one that already existed for links, and it applies ONLY when there is no
 * posture to honour -- the first press this person makes on any group is the
 * last time this rule ever runs for them. It opens the group holding the
 * outstanding action rather than a hardcoded index, so if System is ever
 * regrouped the rule follows it instead of quietly opening the wrong thing.
 */

test('a first arrival opens the group holding sign-in, not an empty page', () => {
  const open = groupsOpenOnArrival(memoryStorage())
  const systemGroup = groupOfSection(FIRST_VISIT_SECTION)
  assert.ok(systemGroup, `${FIRST_VISIT_SECTION} is in no group`)
  assert.ok(open.has(systemGroup.id),
    `a first visit left every group shut, so the only door to #/account is 0x0`)
})

test('the arrival rule opens ONE group, so nesting still buys what it costs', () => {
  const open = groupsOpenOnArrival(memoryStorage())
  assert.equal(open.size, 1, `${open.size} groups open on arrival is not a page a person scans`)
})

test('a remembered posture wins over the arrival rule, in both directions', () => {
  /* Somebody who opened Appearance and shut everything else gets exactly that
     back. The arrival rule must not re-open Start here over their decision. */
  const storage = memoryStorage()
  const appearance = SETTINGS_GROUPS.find(group => group.id === 'appearance')
  writeOpenGroups([appearance.id], storage)
  const open = groupsOpenOnArrival(storage)
  assert.deepEqual([...open], [appearance.id],
    'a remembered posture was overwritten by the first-arrival default')
})

test('a link that names a row still opens that row group, arrival rule or not', () => {
  const open = groupsOpenOnArrival(memoryStorage(), 'Developer')
  const developer = groupOfSection('Developer')
  assert.ok(open.has(developer.id), 'following a link no longer opens the row it named')
})

test('the remembered-posture store is not written by merely arriving', () => {
  /* Arriving is not a filing decision -- the same rule the landing clause has
     always kept. If this ever writes, a person who never touched a group would
     have "start" filed as their posture and the rule would stop being able to
     tell a first visit from a returning one. */
  const map = new Map()
  const storage = {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: () => { throw new Error('groupsOpenOnArrival wrote to the posture store') },
    removeItem: () => { throw new Error('groupsOpenOnArrival cleared the posture store') },
  }
  assert.doesNotThrow(() => groupsOpenOnArrival(storage))
})

/* ---------- state sentences: the truth first, never a contradiction ---------- */

test('a toggle that is on never carries a sentence that reads as off', () => {
  for (const def of [true, false]) {
    for (const acts of [true, false]) {
      const on = toggleStateSentence({ value: true, def, acts })
      const off = toggleStateSentence({ value: false, def, acts })
      assert.ok(on.startsWith('On.'), `on sentence leads with the truth: "${on}"`)
      assert.ok(off.startsWith('Off.'), `off sentence leads with the truth: "${off}"`)
      /* The exact defect: "This ships switched off" as the FIRST claim beside a
         switch reading ON. The shipped default may be mentioned, only after. */
      assert.notEqual(on.indexOf('On.'), -1)
      assert.ok(!/^This ships/.test(on) && !/^This ships/.test(off))
    }
  }
})

test('the acting family states the shipped default and what is true right now', () => {
  const on = toggleStateSentence({ value: true, def: false, acts: true })
  const off = toggleStateSentence({ value: false, def: false, acts: true })
  assert.ok(/ships switched off/i.test(on), `the on sentence still names the shipped default: "${on}"`)
  assert.ok(/ships switched off/i.test(off))
  assert.ok(/turned on/i.test(on), `the on sentence says how it came to be on: "${on}"`)
  assert.ok(/nothing acts/i.test(off), `the off sentence keeps the guarantee: "${off}"`)
})

test('a quiet toggle at its shipped value says only the truth', () => {
  assert.equal(toggleStateSentence({ value: true, def: true }), 'On.')
  assert.equal(toggleStateSentence({ value: false, def: false }), 'Off.')
  assert.equal(toggleStateSentence({ value: true, def: false }), 'On. Ships off.')
  assert.equal(toggleStateSentence({ value: false, def: true }), 'Off. Ships on.')
})

/* ---------- the System refusals, translated ---------- */

test('the machines[0].ip family becomes a sentence and keeps the field named', () => {
  const said = humanizeProfileError({ path: 'machines[0].ip', message: 'address is required' })
  assert.ok(/Machine 1/.test(said), `names the machine a person counts: "${said}"`)
  assert.ok(/address/.test(said))
  assert.ok(said.includes('machines[0].ip'), `keeps the precise field: "${said}"`)
  assert.ok(!/^machines\[/.test(said), 'does not lead with the machine words')
})

test('the machine name and profile label refusals read as sentences', () => {
  const name = humanizeProfileError({ path: 'machines[1].name', message: 'is required' })
  assert.ok(/Machine 2/.test(name) && /name/.test(name), name)
  const label = humanizeProfileError({ path: 'label', message: 'is required' })
  assert.ok(/profile/i.test(label) && /name/.test(label), label)
})

test('a transport port refusal names the lane and the allowed range', () => {
  const said = humanizeProfileError({ path: 'transports[0].port', message: 'must be null or an integer from 1 through 65535' })
  assert.ok(/1 through 65535/.test(said), said)
  assert.ok(said.includes('transports[0].port'), said)
})

test('an unrecognized refusal still comes out whole, never dropped', () => {
  const said = humanizeProfileError({ path: 'spend.total', message: 'must be a finite number' })
  assert.ok(said.includes('spend.total') && said.includes('must be a finite number'), said)
  assert.equal(humanizeProfileErrors([]), '')
  const joined = humanizeProfileErrors([
    { path: 'machines[0].ip', message: 'address is required' },
    { path: 'label', message: 'is required' },
  ])
  assert.ok(/Machine 1/.test(joined) && /profile/i.test(joined), joined)
})

/* ---------- the page really uses all of it (source assertions, because the
   view imports stylesheets and cannot be loaded under node) ---------- */

test('the settings page renders from the group model, not from a flat list', () => {
  const source = readFileSync(path.join(ROOT, 'src', 'views', 'settings.js'), 'utf8')
  assert.ok(source.includes("from '../settings-presentation.js'"),
    'settings.js imports the shared group model')
  assert.ok(source.includes('SETTINGS_GROUPS'), 'settings.js renders the groups')
  /* The view reads the remembered posture through groupsOpenOnArrival, which is
     the only reader that also knows what to do when there is no posture yet.
     Pinned by INTENT rather than by the old symbol name: what must never
     regress is that the page reads a remembered state and writes it back, not
     which function it spells that with. */
  assert.ok(source.includes('groupsOpenOnArrival') && source.includes('writeOpenGroups'),
    'the open state is remembered, not reset every visit')
  assert.ok(source.includes('toggleStateSentence'), 'rows carry the truth-first state sentence')
})

test('the arrival rule is built ON the remembered posture, never instead of it', () => {
  /* The other half of the pin above. If groupsOpenOnArrival ever stopped
     consulting readOpenGroups it would open its default over somebody's saved
     posture every single visit -- which is the failure the pin above is
     watching for, one module further down. */
  const source = readFileSync(path.join(ROOT, 'src', 'settings-presentation.js'), 'utf8')
  const body = source.slice(source.indexOf('export function groupsOpenOnArrival'))
  assert.ok(body.includes('readOpenGroups('),
    'groupsOpenOnArrival stopped reading the remembered posture')
  assert.ok(!body.includes('writeOpenGroups(') && !body.includes('setItem'),
    'arriving is not a filing decision; groupsOpenOnArrival must not write')
})

test('the System section translates refusals before they reach the glass', () => {
  const source = readFileSync(path.join(ROOT, 'src', 'fleet-profile-settings.js'), 'utf8')
  assert.ok(source.includes('humanizeProfileErrors'),
    'fleet-profile-settings.js speaks the translated refusal')
})

test('the group labels match what the page sections actually are', () => {
  /* CHATBOX_SECTION and RESEARCH_SECTION are constants; if either is renamed,
     the group model must follow. Read from the source of record. */
  const chatbox = readFileSync(path.join(ROOT, 'src', 'chatbox-settings.js'), 'utf8')
  const research = readFileSync(path.join(ROOT, 'src', 'research-settings.js'), 'utf8')
  const chatboxName = chatbox.match(/export const CHATBOX_SECTION = '([^']+)'/)?.[1]
  const researchName = research.match(/export const RESEARCH_SECTION = '([^']+)'/)?.[1]
  assert.ok(chatboxName && groupOfSection(chatboxName), `chatbox section "${chatboxName}" is grouped`)
  assert.ok(researchName && groupOfSection(researchName), `research section "${researchName}" is grouped`)
})
