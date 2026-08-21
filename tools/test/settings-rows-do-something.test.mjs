/* EVERY ROW ON THE SETTINGS PAGE HAS TO DO SOMETHING.
 *
 * Written failing-first for the settings-truth lane, 2026-08-20. Before the
 * change this suite reported 74 dead rows out of 96; after it, none.
 *
 * WHAT WAS MEASURED. The page built 96 rows and its own footer said "116
 * settings". Seventy-four of them wrote a `mc.set.<id>` key that nothing in the
 * product ever read. Six whole sections were inert top to bottom -- Fleet
 * Graph, Metrics, Chat & Threads, Comms Board, Performance and Developer -- and
 * every one of those rows moved, filled, reported a percentage and survived a
 * restart, so nothing on screen distinguished them from the twenty-two that
 * worked. `contrast_curve` promised "Make the lighter, secondary text darker
 * and easier to read" to the person least able to detect that nothing happened.
 * `drawer_width` offered 280-440px against a drawer hardcoded `width: 320px`
 * (src/styles.css:2684). `brace_stroke_width` declared a default of 1.25px
 * while the shipped braces draw at a hardcoded 1.5 (src/views/home.js:186), so
 * it misreported the current value as well as failing to change it.
 *
 * WHY THE RULE IS EXPRESSED THIS WAY. A row's value can reach behaviour by
 * exactly two doors, and this test walks both rather than searching for ninety
 * strings:
 *
 *   1  A branch in `applyValue()` in src/views/settings.js. Everything that
 *      does not match a branch falls to `else { writeStored(setting, value) }`
 *      and stops there.
 *   2  Some other file reading the row's storage key. The whole product
 *      contains exactly one such literal (`mc.set.uninstall_data`, read by
 *      shell/uninstall-retention.cjs) and two templated readers
 *      (src/appearance-persistence.js, for glow and reduce_motion).
 *
 * (`scenario_tick_rate` used to be licensed through a third path,
 * applyStoredSimPace() re-applying it to the simulation clock at launch. The
 * row and the clock are gone -- the example the product shows now is data fed
 * through the ordinary screens -- so the path is gone with them. The
 * `example_mode` row that replaced the per-view family acts through door 1,
 * and its ENFORCEMENT is asserted by name below: src/data-source.js owns the
 * stored choice and answers 'mock' for every screen while it is on.)
 *
 * THIS IS A RATCHET, NOT A SNAPSHOT. It is derived from the source at run time,
 * so a row added tomorrow with no consumer fails it on the day it is added,
 * named. That is the whole point: the defect was not that somebody wrote 74 bad
 * rows, it was that nothing could tell a real control from a drawn one.
 *
 * ADDING A ROW THEREFORE MEANS ADDING ITS READER. If a row genuinely acts
 * through a door this test does not know about, teach the test the door -- with
 * the file and line that reads it. Do not add the id to an exemption list;
 * there deliberately is not one.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = relative => readFileSync(path.join(ROOT, ...relative.split('/')), 'utf8')

const settingsSource = read('src/views/settings.js')

/* The declared rows, taken from the source so the test cannot hold a stale
   copy of the catalogue it is judging. */
function declaredRows() {
  const start = settingsSource.indexOf('export const SETTINGS = [')
  const end = settingsSource.indexOf('\nconst byId = new Map')
  assert.ok(start >= 0 && end > start, 'the SETTINGS catalogue is where this test expects it')
  const block = settingsSource.slice(start, end)
  const literal = [...block.matchAll(/^\s*\{\s*id:\s*'([^']+)',\s*section:\s*'([^']+)'/gm)]
    .map(match => ({ id: match[1], section: match[2] }))

  /* The one family still built by `.map()` over a flag table rather than
     written out, which a regex over this block cannot see. (The live-view
     family this used to add collapsed into the literal `example_mode` row,
     which the regex above sees directly.) */
  const write = [...read('src/write-flags.js').matchAll(/id:\s*'([^']+)'/g)]
    .map(match => ({ id: `write_${match[1]}`, section: 'Write' }))
  assert.ok(write.length > 0, 'the flag table was read')
  return [...literal, ...write]
}

/* DOOR 1: the rows `applyValue` treats specially. Read out of the function's
   own text, so deleting a branch retires its row's licence in the same edit. */
function rowsAppliedInPlace() {
  const start = settingsSource.indexOf('function applyValue(setting, value)')
  const end = settingsSource.indexOf('function syncSectionDepth', start)
  assert.ok(start >= 0 && end > start, 'applyValue is where this test expects it')
  const body = settingsSource.slice(start, end)
  const ids = new Set([...body.matchAll(/setting\.id === '([^']+)'/g)].map(match => match[1]))
  if (/writeSettingActions\.has\(setting\.id\)/.test(body)) {
    for (const match of read('src/write-flags.js').matchAll(/id:\s*'([^']+)'/g)) ids.add(`write_${match[1]}`)
  }
  return ids
}

/* DOOR 2: a row whose stored key is read somewhere else in the product. Named
   with the reader, because "trust me, something reads it" is the claim this
   whole suite exists to refuse. */
const READ_ELSEWHERE = Object.freeze({
  uninstall_data: 'shell/uninstall-retention.cjs — RETENTION_PREF_KEY',
  glow: 'src/appearance-persistence.js — GLOW_KEY, applied at launch',
  reduce_motion: 'src/appearance-persistence.js — REDUCE_MOTION_KEY, applied at launch',
})

/* A row that stores no value at all: it runs something when pressed. */
function actionRows() {
  const start = settingsSource.indexOf('export const SETTINGS = [')
  const end = settingsSource.indexOf('\nconst byId = new Map')
  const block = settingsSource.slice(start, end)
  return new Set([...block.matchAll(/id:\s*'([^']+)'[^}]*type:\s*'action'/g)].map(match => match[1]))
}

test('no row on the settings page writes a value nothing reads', () => {
  const rows = declaredRows()
  const applied = rowsAppliedInPlace()
  const actions = actionRows()

  const dead = rows.filter(row => !applied.has(row.id)
    && !Object.prototype.hasOwnProperty.call(READ_ELSEWHERE, row.id)
    && !actions.has(row.id))

  const bySection = new Map()
  for (const row of dead) {
    if (!bySection.has(row.section)) bySection.set(row.section, [])
    bySection.get(row.section).push(row.id)
  }
  const report = [...bySection.entries()]
    .map(([section, ids]) => `  ${section}: ${ids.join(', ')}`)
    .join('\n')

  assert.equal(
    dead.length,
    0,
    `${dead.length} of ${rows.length} settings rows write a key nothing reads.\n`
      + 'Each one draws a working control and changes nothing:\n'
      + `${report}\n`
      + 'Either wire the row to something that reads it, or remove the row. A control '
      + 'that moves and does nothing is worse than an absent one, because a person '
      + 'stops looking for the real switch.',
  )
})

test('every claimed reader still exists, so the licences above cannot go stale', () => {
  /* The other half of the ratchet. Without this, deleting a reader would
     silently leave its row exempt and dead -- the exemption list becoming the
     very thing this suite refuses. */
  assert.match(read('shell/uninstall-retention.cjs'), /'mc\.set\.uninstall_data'/)
  const appearance = read('src/appearance-persistence.js')
  assert.match(appearance, /GLOW_KEY = `mc\.set\.\$\{GLOW_SETTING_ID\}`/)
  assert.match(appearance, /REDUCE_MOTION_KEY = `mc\.set\.\$\{REDUCE_MOTION_SETTING_ID\}`/)
})

test('the example row has its registry, its enforcement, and its control, by name', () => {
  /* The owner's doctrine -- "a user setting needs registry, enforcement, and
     a control, or it's a lie" -- asserted for the one row that replaced the
     per-view family, because a toggle claiming to change EVERY screen is the
     most expensive place a dead control could sit.
       REGISTRY     src/data-source.js owns the stored choice (`mc.example`).
       ENFORCEMENT  resolveDataSource() consults the toggle first and answers
                    'mock' for every screen while it is on.
       CONTROL      the settings row writes through setExampleMode (door 1,
                    already walked above) and reads back through
                    isExampleMode, never through a private copy. */
  const dataSource = read('src/data-source.js')
  assert.match(dataSource, /const EXAMPLE_KEY = 'mc\.example'/, 'data-source.js no longer owns the stored example choice')
  assert.match(dataSource, /if \(isExampleMode\(\)\)/, 'resolveDataSource no longer consults the example toggle')
  assert.match(settingsSource, /setExampleMode\(Boolean\(value\)\)/, 'the settings row no longer writes through setExampleMode')
  assert.match(settingsSource, /if \(setting\.id === 'example_mode'\) return isExampleMode\(\)/, 'the settings row no longer reads back the applied state')
  assert.match(settingsSource, /from '\.\.\/data-source\.js'/, 'the settings page no longer imports the one source module')
})

test('the sections the page lists are exactly the sections its rows are in', () => {
  /* An empty heading is its own defect: a person opens a group, finds a
     titled section with nothing under it, and cannot tell whether it is broken
     or merely collapsed. Removing rows must remove the headings they leave
     behind. */
  const start = settingsSource.indexOf('const SECTIONS = [')
  const end = settingsSource.indexOf('export const SETTINGS = [')
  const block = settingsSource.slice(start, end)
  const listed = [...block.matchAll(/^\s*'([^']+)',/gm)].map(match => match[1])

  /* Four sections draw their rows from a module instead of from SETTINGS --
     the chat box, Research, System and Setup. `sectionNodeMarkup` is the single
     place that routes a section to its module, so the set is read from there
     rather than restated: a section that stops being module-rendered and keeps
     no rows of its own then shows up here, which is the point. */
  const router = settingsSource.slice(
    settingsSource.indexOf('function sectionNodeMarkup(section)'),
    settingsSource.indexOf('function sectionShownCount(section)'),
  )
  assert.ok(router.length > 0, 'the section router is where this test expects it')
  /* Only the quoted names are needed: `listed` above reads quoted entries out
     of SECTIONS, so the two that arrive as imported constants (the chat box and
     Research) are not in it to begin with. */
  const moduleRendered = new Set([...router.matchAll(/section === '([^']+)'/g)].map(match => match[1]))
  assert.ok(moduleRendered.size >= 2, `the module-rendered sections were found (${[...moduleRendered]})`)

  const populated = new Set(declaredRows().map(row => row.section))
  const empty = listed.filter(section => !populated.has(section) && !moduleRendered.has(section))
  assert.deepEqual(
    empty,
    [],
    `these sections are listed on the page and have no rows: ${empty.join(', ')}`,
  )
})
