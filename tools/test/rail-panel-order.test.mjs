// WHERE THE FOLDER IS ON THE RAIL, HELD IN PLACE.
//
// Owner, 2026-08-19: "also what happened to sessions and choosing a folder for
// each tree and such? ther right panel on page 2 is still so complicated i
// think its in there maybe somewhere". It WAS in there. Driven on the packaged
// build (tools/rail-inventory-drive.mjs, 2026-08-20) before this change:
//
//   overview rail, 1440x900   "Session profiles" 1152px down a 1524px scroll
//   overview rail, 1024x768   "Session profiles" 1042px down a 1339px scroll
//   tree node, Details tab    the "Works in" select 614px down a 3825px scroll,
//                             elementFromPoint says NOT in the viewport at
//                             1024 or 1440, fifth of nine stacked panels
//
// Below the fold at every width this product supports, under two headings --
// "Session profiles" and "Setup > Works in" -- neither of which contains the
// word he was hunting for.
//
// WHY A SOURCE TEST BESIDE A DRIVER. The driver measures pixels on real glass
// and is the evidence; it also needs a packaged build, five minutes and a
// staged profile. This holds the ORDER and the NAMING that produce those
// pixels, in the suite, so the arrangement cannot quietly go back. Neither
// replaces the other: this one cannot see a panel that renders 900px tall, and
// the driver cannot run on every commit.
//
// IT ALSO GUARDS AGAINST THE WRONG FIX. The owner's standing rule is that a
// misbehaving feature gets guarded or fixed, never removed to reach a goal. So
// every assertion about placement is paired with an assertion that the thing
// placed is still THERE: all four start-work builders still called, every
// data-tree-profile hook still written, the profile panel still mounted.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(import.meta.url)
const SRC = join(dirname(dirname(dirname(here))), 'src')
const view = readFileSync(join(SRC, 'views', 'computers.js'), 'utf8')
const copy = readFileSync(join(SRC, 'fleet-tree-copy.js'), 'utf8')
const board = readFileSync(join(SRC, 'board.css'), 'utf8')

/* The renderLiveStats template only -- the overview rail's own markup. Slicing
   it out means "before Services" cannot be satisfied by some other Services
   elsewhere in a 6000-line file. */
function overviewTemplate() {
  const start = view.indexOf('function renderLiveStats()')
  assert.notEqual(start, -1, 'renderLiveStats() is the overview rail builder and it is gone')
  const end = view.indexOf('mountResearchScopeControl()', start)
  assert.ok(end > start, 'renderLiveStats() no longer ends where this test expects')
  return view.slice(start, end)
}

/* The Details tab of the tree node's rail: showTreeNodeControls' template. */
function treeNodeTemplate() {
  const start = view.indexOf('function showTreeNodeControls(node)')
  assert.notEqual(start, -1, 'showTreeNodeControls() is the tree node rail builder and it is gone')
  const end = view.indexOf(".querySelector('.rail-back')", start)
  assert.ok(end > start, 'showTreeNodeControls() no longer ends where this test expects')
  return view.slice(start, end)
}

test('the overview rail names a folder, in a heading with the word in it', () => {
  assert.match(copy, /overviewTitle: '[^']*[Ff]olders?[^']*'/, 'PROFILE_PANEL.overviewTitle must say "folder" -- "Session profiles" is what he could not find')
  assert.match(copy, /nodeTitle: '[^']*[Ff]olders?[^']*'/, 'PROFILE_PANEL.nodeTitle must say "folder" -- "Works in" is what he could not find')
  assert.ok(
    overviewTemplate().includes('PROFILE_PANEL.overviewTitle'),
    'the overview rail must head its folder section with PROFILE_PANEL.overviewTitle',
  )
})

test('the overview rail puts the folder above Services, Organisation and the Role library', () => {
  const template = overviewTemplate()
  const folder = template.indexOf('data-profile-slot')
  const services = template.indexOf('>Services<')
  const roles = template.indexOf('board-org-slot')
  assert.ok(folder > -1, 'the profile panel mount point is gone from the overview rail')
  assert.ok(services > -1 && roles > -1, 'the overview rail no longer has the sections this order is measured against')
  /* The Role library measured 484px tall with 51 controls, and it sat directly
     above the folder. That single panel is what put the folder off-screen. */
  assert.ok(folder < services, 'the folder section must come before Services on the overview rail')
  assert.ok(folder < roles, 'the folder section must come before the Role library on the overview rail')
})

test('the overview rail still MOUNTS the profile panel it moved', () => {
  assert.ok(
    /mountProfilePanel\(statsPage\.querySelector\('\[data-profile-slot\]'\)\)/.test(view),
    'moving the section must not have unmounted it -- nothing is removed to reach a goal',
  )
})

test('the tree node rail puts the folder first, under the name', () => {
  const template = treeNodeTemplate()
  const head = template.indexOf('agent-head board-head')
  const folder = template.indexOf('data-tree-folder')
  const doing = template.indexOf('>What it is doing<')
  const setup = template.indexOf('data-tree-move')
  const startWork = template.indexOf('board-start-work-slot')
  assert.ok(folder > -1, 'the tree node rail must carry a box of its own for the folder')
  assert.ok(head > -1 && doing > -1 && setup > -1 && startWork > -1, 'the tree node rail no longer has the panels this order is measured against')
  assert.ok(head < folder, 'the folder box belongs under the agent head, not above it')
  assert.ok(folder < doing, 'the folder must come before "What it is doing"')
  assert.ok(folder < setup, 'the folder must come before Setup -- it used to be buried inside it')
  assert.ok(folder < startWork, 'the folder must come before the start-work group')
})

test('every folder hook the handlers query is still written, by its exact name', () => {
  const template = treeNodeTemplate()
  /* The handlers query controlsPage, not the box, which is what made moving
     this markup safe. If a hook is renamed the handler silently stops finding
     it and the control goes dead with no error anywhere. */
  for (const hook of [
    'data-tree-profile',
    'data-tree-profile-out',
    'data-tree-profile-restart-row',
    'data-tree-profile-restart',
  ]) {
    assert.ok(template.includes(hook), `the rail must still write ${hook} -- its handler queries that exact name`)
    assert.ok(view.includes(`[${hook}]`), `something must still query [${hook}]`)
  }
})

test('the four ways to start work are one named disclosure, and all four are still built', () => {
  const start = view.indexOf('function mountStartWorkControls(agent, slot)')
  assert.notEqual(start, -1, 'mountStartWorkControls() is gone')
  const body = view.slice(start, start + 3600)

  /* NOTHING REMOVED. 74% of the Details tab's 3825px scroll was these four
     panels (Launch 963, Loop 699, Codex Cloud 609, Team 550, driven at
     1440x900). Collapsing them is the whole saving -- deleting any of them
     would be the wrong way to the same number. */
  for (const builder of ['launchControlsBox(', 'teamControlsBox(', 'loopControlsBox(', 'cloudControlsBox(']) {
    assert.ok(body.includes(builder), `${builder}) must still be called -- collapsed is not removed`)
  }

  /* A REAL BUTTON, NOT A BARE ROW. A sibling lane measured this week that a
     group collapsing without a clear affordance reads as a missing feature. */
  assert.match(body, /<button[^>]*data-start-work-toggle/, 'the disclosure must be a real <button>')
  assert.match(body, /aria-expanded="\$\{open \? 'true' : 'false'\}"/, 'the toggle must carry aria-expanded reflecting the real state')
  assert.match(body, /aria-controls="\$\{bodyId\}"/, 'the toggle must name the region it controls')
  assert.ok(body.includes('rail-group-chev'), 'the disclosure must carry a chevron')

  /* AND IT MUST SAY WHAT IS INSIDE IT. */
  assert.ok(body.includes('START_WORK_GROUP.contents'), 'the toggle must name its four panels on its own line')
  assert.match(copy, /contents: '[^']*Launch[^']*Team[^']*Loop[^']*Codex Cloud[^']*'/, 'START_WORK_GROUP.contents must name all four panels')
  assert.match(copy, /expandLabel: '[^']+'/, 'the toggle needs an accessible label for the closed state')
  assert.match(copy, /collapseLabel: '[^']+'/, 'the toggle needs an accessible label for the open state')
})

test('the disclosure is built open or closed, never lazily', () => {
  const start = view.indexOf('function mountStartWorkControls(agent, slot)')
  const body = view.slice(start, start + 3600)
  const toggleHandler = body.indexOf("toggle.addEventListener('click'")
  for (const builder of ['launchControlsBox(', 'teamControlsBox(', 'loopControlsBox(', 'cloudControlsBox(']) {
    /* Building on first press would leave every live updater that queries these
       boxes finding nothing until somebody pressed. `hidden` is a paint
       decision; the boxes are real from the moment the rail is. */
    assert.ok(body.indexOf(builder) < toggleHandler, `${builder}) must run at mount, not inside the toggle handler`)
  }
})

test('the classes the disclosure writes have rules', () => {
  for (const cls of ['rail-group-toggle', 'rail-group-chev', 'rail-group-name', 'rail-group-body']) {
    assert.ok(board.includes(`.${cls}`), `.${cls} is written by the rail and styled by nothing`)
  }
})

test('remembering the disclosure is posture, not a setting', () => {
  const start = view.indexOf('function mountStartWorkControls(agent, slot)')
  const region = view.slice(Math.max(0, start - 1200), start + 3600)
  assert.ok(region.includes('mc.rail.start-work-open'), 'the open state is remembered under its own key')
  /* A "user setting" in this product needs a registry row, real enforcement and
     a control in the software, or it is a lie. This is none of those and must
     not pretend to be: it grants nothing and gates nothing, exactly as
     src/settings-presentation.js already ruled for its own open-groups memory. */
  assert.ok(
    !/WRITE_ACTION_FLAGS|setWriteEnabled\(\s*['"]start-work/.test(region),
    'the disclosure must not touch a write flag -- it is posture, not permission',
  )
})

/* ---------------------------------------------------------------------------
 * PART B: THE FOLDER CHOSEN AT TREE START ACTUALLY BECOMES THE TREE'S FOLDER.
 *
 * The compose panel's own suite proves the QUESTION is asked and the answer
 * reaches the caller (tools/test/agent-compose-panel.test.mjs). This pins what
 * the caller then DOES with it, which is the half that can silently rot: the
 * write has to land between the node existing and the start reading the tree's
 * profile, or the first agent of the tree starts in the wrong folder and only
 * the second one is right.
 *
 * The view is an Electron-mounted closure, so this is pinned against its source
 * in the idiom of tools/test/agent-start-chosen-workspace.test.mjs.
 * ------------------------------------------------------------------------- */

function submitComposeSource() {
  const start = view.indexOf('async function submitCompose(draft, detail)')
  assert.notEqual(start, -1, 'submitCompose() is the tree-start path and it is gone')
  const end = view.indexOf('onSessionOpen:', start)
  assert.ok(end > start, 'submitCompose() no longer reaches its start call where this test expects')
  return view.slice(start, end)
}

test('the folder chosen at tree start is written BEFORE the start reads it', () => {
  const body = submitComposeSource()
  const addNode = body.indexOf('store.addNode(')
  const write = body.indexOf('store.setTreeProfile(node.treeId, draft.profileId)')
  const read = body.indexOf('treeStore.treeProfile(node.treeId)')
  assert.ok(addNode > -1, 'the node is no longer created here')
  assert.ok(write > -1, 'the folder the person chose at tree start must be written to the tree')
  assert.ok(read > -1, 'the start no longer reads the tree profile')
  assert.ok(addNode < write, 'the write needs a treeId, so it must come after addNode')
  assert.ok(write < read, 'writing after the start reads it would put the FIRST agent in the wrong folder')
})

test('only a NEW tree takes the folder from the compose panel', () => {
  /* A start under an existing agent joins a tree that already has a folder.
     Writing there would let one nested start re-point every agent in the tree,
     including ones already running. The panel draws no menu in that case; this
     is the second lock, on the side that owns the store. */
  const body = submitComposeSource()
  assert.match(body, /if \(!parent && draft\.profileId\) \{\s*store\.setTreeProfile/,
    'the tree profile must only be written when this start created the tree')
})

test('the compose panel is handed the folders and the remembered choice', () => {
  const start = view.indexOf('function openComposeFor(detail)')
  assert.notEqual(start, -1, 'openComposeFor() is gone')
  const body = view.slice(start, start + 2600)
  assert.ok(body.includes('folders: composeFolders'), 'the panel must be handed this computer’s folders')
  assert.ok(body.includes('folderSelectedId: lastComposeFolder()'), 'the menu must open on the folder used last')
})

test('the folders come from the ONE store that holds them, read once per mount', () => {
  /* Not a second register of folders kept beside the first: the same
     mcAgent.profiles() the fleet rail's own panel reads. */
  assert.match(view, /async function readComposeFolders\(\)/, 'the folders must be read by their own named function')
  const start = view.indexOf('async function readComposeFolders()')
  const body = view.slice(start, start + 900)
  assert.ok(body.includes('bridge.profiles()'), 'the folders must come from the main process store, not from the renderer')
  assert.ok(/composeFolders = \[\]/.test(view.slice(start - 400, start)) || body.includes(': []'),
    'a bridge that will not answer must leave an empty list, never throw')
  assert.ok(view.includes('void readComposeFolders()'), 'the list must be read as the board comes up')
})

test('the remembered folder is posture, not a setting', () => {
  assert.ok(view.includes('mc.compose.last-folder'), 'the last-used folder is remembered under its own key')
  const start = view.indexOf("const LAST_FOLDER_KEY = 'mc.compose.last-folder'")
  assert.notEqual(start, -1, 'the key must be declared once, by name')
  const region = view.slice(start, start + 700)
  assert.ok(
    !/WRITE_ACTION_FLAGS|setWriteEnabled/.test(region),
    'pre-filling a menu grants nothing and gates nothing -- it must not touch a write flag',
  )
})

test('the folder section clears the fold: it sits above "This computer", not below it', () => {
  /* MEASURED, not preferred. Below "This computer" the heading landed at 415px
     of a 1524px scroll -- readable at 1440 and 1920, but at 1024x768 its
     CONTROLS (the name field and "Pick a folder…") fell under the floating
     fleet-profile notice. A heading a person can read over a box they cannot
     reach is not a fix. Above it, the whole section clears at every width.
     It stays BELOW the hero's "this is the record" caveat, which qualifies the
     number directly above it. */
  const template = overviewTemplate()
  const caveat = template.indexOf('projection-unavailable')
  const folder = template.indexOf('data-profile-slot')
  /* Anchored on the facts list rather than the heading text. The heading is no
     longer a constant: driving from a browser, the computer these facts
     describe is somewhere else, so calling it "This computer" invited the exact
     mistake the account page warns about. What this test measures is the ORDER,
     and the facts list sits immediately under that heading in every wording. */
  const thisComputer = template.indexOf('class="rail-facts"')
  assert.ok(caveat > -1 && folder > -1 && thisComputer > -1, 'the overview rail no longer has the sections this order is measured against')
  assert.ok(
    template.includes('thisComputerHeading()'),
    'the heading must still be chosen by the helper that knows whether this computer is the one you are sitting at',
  )
  assert.ok(caveat < folder, 'the record caveat belongs with the number it qualifies, above the folder')
  assert.ok(folder < thisComputer, 'the folder section must clear the fold, which means above "This computer"')
})
