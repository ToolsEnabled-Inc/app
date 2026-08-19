/* THE OPEN-AGENT DOOR MUST COME BACK WHEN THE SELECTION GOES AWAY.
 *
 * MEASURED on the shipped build, 2026-08-19, driving as a person: on a fresh
 * fleet page the graph bar offers "Open agent detail" (aimed at the first
 * declared seat -- the earlier fix that made the door exist before anything is
 * clicked). Click any node in YOUR OWN tree and onOpenControls aims the door at
 * NOTHING -- setOpenTarget(null), deliberate, a tree node has no drill-in page.
 * Press Back. The rail returns to the overview, and the door NEVER RETURNS:
 * display none, 0x0, for the rest of the visit. The only way to get it back was
 * leaving the page and coming again, which is exactly the "reward for having
 * already found the way in" the mount-time fix was written to end.
 *
 * The contract: the path that RETURNS to the overview re-aims the door the
 * same way mount does. Source-contract test, same idiom and reason as
 * tree-approval-pending.test.mjs: this view cannot be imported into a unit
 * test, so the wiring's shape is pinned where its behaviour cannot be.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const view = readFileSync(path.resolve(HERE, '..', '..', 'src', 'views', 'computers.js'), 'utf8')

test('a tree-node selection still aims the door at nothing, which is why the restore matters', () => {
  const branch = view.slice(view.indexOf('onOpenControls: (agent) =>'))
  const body = branch.slice(0, branch.indexOf('showControls(agent)'))
  assert.match(body, /setOpenTarget\(null\)/,
    'tree nodes now aim the door somewhere; if that is deliberate, rewrite this file around the new rule rather than deleting it')
})

test('returning to the overview re-aims the door instead of leaving it gone', () => {
  const at = view.indexOf('function showStats()')
  assert.ok(at > -1, 'showStats is gone; find where Back lands and pin that instead')
  const body = view.slice(at, view.indexOf('\n  }', at))
  assert.match(body, /setOpenTarget\([^)]*firstDeclaredTarget\(\)\)/,
    'Back from a tree node leaves the Open-agent door hidden for the rest of the visit -- measured display:none 0x0 after one click on an own agent, on the shipped build')
})
