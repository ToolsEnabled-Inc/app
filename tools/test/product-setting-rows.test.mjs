/* THE ROWS THE INSTALLED APPLICATION ENFORCES, AND THE PAGE'S COPY OF THAT LIST.
 *
 * Written failing-first for the settings-truth lane, 2026-08-20.
 *
 * WHAT WAS MEASURED. shell/product-settings.cjs decides what this window is
 * allowed to write, in `WRITABLE_IDS`. The section that draws those rows kept
 * its own copy of the list -- and the copy was SHORT. It held the four
 * `research.*` ids; `WRITABLE_IDS` held those plus `agent.tool_summary`. The
 * section rendered five rows (it maps whatever the shell hands back) while the
 * page believed there were four. Three things followed:
 *
 *   1  the footer's total was one low -- "116 settings" over 117 rows;
 *   2  `requestedSetting()` in src/views/settings.js could not resolve
 *      `agent.tool_summary` to a section and a depth, so it was THE ONE ROW ON
 *      THE SETTINGS PAGE THAT SEARCH COULD NOT FIND -- and it is the switch the
 *      owner asked for by name;
 *   3  the count was the literal `4` written beside a list of four, so it did
 *      not move when the list became five.
 *
 * (3) is why the count is now derived and this test exists. A hand-kept mirror
 * of somebody else's list is not wrong on the day it is written; it is wrong on
 * the day the other list changes, silently, which is the day nobody is looking.
 *
 * THE FENCE IS TESTED HERE TOO, because it had the same shape of bug: the
 * section treated "not the master" as "fenced by the master", so a fresh
 * install -- where `research.pipeline` is off by default and
 * `agent.tool_summary` ships ON -- drew the agent row with its switch reading on
 * and the sentence "Held back: the first switch in this section is off, so
 * nothing runs for a research project yet." The research gate has no authority
 * over that row: the registry declares no dependency, and its enforcer
 * (src/lib/agent-tool-summary.js) is not the research gate
 * (src/lib/research/settings-gate.js), which never mentions it.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
process.env.TOOLSENABLED_STATE_ROOT = path.join(os.tmpdir(), 'mc-product-setting-rows')

const require_ = createRequire(import.meta.url)
const PAYLOAD_ROOT = path.join(ROOT, 'capability')
const shell = require_(path.join(ROOT, 'shell', 'product-settings.cjs'))
const section = await import('../../src/research-settings.js')

/* One row shape per id, at its registry default and chosen by nobody -- which
   is the state a person meets on a first install, and the state both bugs
   above appeared in. */
function freshInstallRows() {
  const real = shell.readProductSettings({ root: PAYLOAD_ROOT, fresh: true })
  assert.equal(real.available, true, real.reason || 'the checkout payload is readable')
  return real.rows.map(row => ({ ...row, value: row.default, provenance: undefined }))
}

function render(rows) {
  const controller = section.createResearchSettings({
    shell: { read: async () => ({ ok: true, available: true, rows }), set: async () => ({ ok: false }) },
  })
  return controller.load().then(() => controller.markup())
}

function statusOf(html, id) {
  const match = html.match(
    new RegExp(`data-research-setting-status="${id.replace('.', '\\.')}">([^<]*)<`),
  )
  return match ? match[1] : ''
}

test('the page draws exactly the rows the installed application will write', () => {
  assert.deepEqual(
    [...section.PRODUCT_SETTING_IDS],
    [...shell.WRITABLE_IDS],
    'the section\'s list and shell/product-settings.cjs WRITABLE_IDS are the same list, in the same order',
  )
})

test('the count is derived from that list, never written beside it', () => {
  assert.equal(section.RESEARCH_SETTING_COUNT, section.PRODUCT_SETTING_IDS.length)
  const source = readFileSync(path.join(ROOT, 'src', 'research-settings.js'), 'utf8')
  assert.doesNotMatch(
    source,
    /RESEARCH_SETTING_COUNT\s*=\s*\d/,
    'the count must not be a literal number: that is exactly how it stayed at 4 for a list of 5',
  )
})

test('every drawn row can be landed on by search', async () => {
  const settings = readFileSync(path.join(ROOT, 'src', 'views', 'settings.js'), 'utf8')
  assert.match(
    settings,
    /if \(PRODUCT_SETTING_IDS\.includes\(id\)\) return \{ id, section: RESEARCH_SECTION, depth: 1 \}/,
    'requestedSetting resolves every row this section draws, not just the research ones',
  )
  const html = await render(freshInstallRows())
  for (const id of section.PRODUCT_SETTING_IDS) {
    assert.ok(
      html.includes(`data-setting-id="${id}"`),
      `${id} is drawn with the data-setting-id that markLanding and scrollToLanding look for`,
    )
  }
})

test('the research fence holds back only what it actually governs', async () => {
  const rows = freshInstallRows()
  assert.equal(rows.find(row => row.id === 'research.pipeline').value, false, 'the master ships off')
  assert.equal(rows.find(row => row.id === 'agent.tool_summary').value, true, 'the agent note ships on')

  const html = await render(rows)
  const held = 'Held back: the first switch in this section is off'

  for (const id of section.RESEARCH_FENCED_IDS) {
    assert.ok(statusOf(html, id).startsWith(held), `${id} is held back by the master, and says so`)
  }
  const agent = statusOf(html, 'agent.tool_summary')
  assert.ok(
    !agent.startsWith(held),
    `agent.tool_summary must not claim the research fence holds it back; it said: "${agent}"`,
  )
  assert.ok(
    !/held back/i.test(agent),
    `agent.tool_summary ships on and IS on, so nothing may tell a person it is withheld; it said: "${agent}"`,
  )
})

test('the section is named for both families it holds', () => {
  assert.match(section.RESEARCH_SECTION, /agent/i, 'the heading names the agent rows it draws')
  assert.match(section.RESEARCH_SECTION, /research/i, 'and still names the research rows')
})
