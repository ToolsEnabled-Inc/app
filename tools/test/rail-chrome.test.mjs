// EVERY CLASS THE RAIL WRITES MUST HAVE A RULE SOMEWHERE.
//
// Defect 8's whole category: views/computers.js rendered
// button.ctl-btn.palette-row with .palette-row defined in NO stylesheet, so
// the row inherited a fixed-height centred flex layout meant for something
// else and the actions tab rendered as unreadable overlap. Nothing caught it,
// because no check connected the classes the view writes to the classes the
// sheets define. This is that check.
//
// The honest scope, learned by running the strict version first: a MODIFIER
// class composing with a styled sibling on the same element (board-box
// board-ctl-box) and a child inheriting from a styled parent (.board-box-h's
// .bh-t) are fine without their own rule -- the element still has a visual
// identity. What is NOT fine is an ELEMENT none of whose classes has any rule
// anywhere: that element's entire appearance is an accident of inheritance,
// which is precisely what the palette rows were. So the sweep is per-element,
// with a curated allowlist for mount-point slots whose emptiness is the
// point. Additionally, the classes THIS phase introduced (palette-*,
// rail-title-*) are checked strictly, because for them "some sibling is
// styled" was exactly the defect.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(import.meta.url)
const SRC = join(dirname(dirname(dirname(here))), 'src')

const css = readdirSync(SRC)
  .filter(name => name.endsWith('.css'))
  .map(name => readFileSync(join(SRC, name), 'utf8'))
  .join('\n')

const view = readFileSync(join(SRC, 'views', 'computers.js'), 'utf8')

// Elements that are honest with NO styled class: pure mount points whose only
// job is to be found by querySelector and filled. Every entry carries its
// reason; an entry without one is the defect coming back politely.
const HOOK_ONLY_ELEMENTS = new Set([
  'board-org-slot',    // org library mount, filled by mountOrgLibrary
  'board-launch-slot', // launch panel mount
  'board-role-slot',   // role panel mount
  'board-chart-slot',  // echarts host; the chart engine owns its pixels
  'bc-canvas',         // echarts canvas host, sized by its plot parent
  // Inherit-from-parent text spans: the PARENT owns the look and these carry
  // only its words. Verified rendering correctly on the installed build; if
  // one of these ever needs its own shape, style it and delete the entry.
  'bh-t',                  // heading text inside styled .board-box-h
  'bc-now',                // chart "now" caption inside the styled plot
  'crumb-hop',             // separator glyph inside the styled .crumb
  'computer-tree-canvas',  // graph host; tree-graph.css styles its children
])

function elementClassLists() {
  const lists = []
  for (const match of view.matchAll(/className = '([^']+)'/g)) {
    lists.push(match[1].split(/\s+/).filter(Boolean))
  }
  for (const match of view.matchAll(/class="([^"$]+)"/g)) {
    const names = match[1].split(/\s+/).filter(name => name && !name.includes('{'))
    if (names.length) lists.push(names)
  }
  return lists
}

test('no element the computers view writes is entirely unstyled', () => {
  const offenders = []
  for (const names of elementClassLists()) {
    if (names.some(name => css.includes(`.${name}`))) continue
    if (names.every(name => HOOK_ONLY_ELEMENTS.has(name))) continue
    offenders.push(names.join(' '))
  }
  assert.deepEqual(
    [...new Set(offenders)].sort(),
    [],
    `elements whose every class lacks a stylesheet rule -- their appearance is an accident, the palette-row defect's shape:\n  ${offenders.join('\n  ')}`,
  )
})

test("this phase's own chrome classes are strictly styled", () => {
  // For these, a styled sibling was the DEFECT (ctl-btn styled the wrong
  // shape), so each must have its own rule.
  const missing = ['palette-row', 'palette-hint', 'palette-list',
    'rail-title-row', 'rail-title-slot', 'rail-title-slot-back',
    'rail-title-slot-title', 'rail-title-slot-forward']
    .filter(name => !css.includes(`.${name}`))
  assert.deepEqual(missing, [], `phase-1 chrome classes without their own rule:\n  ${missing.join('\n  ')}`)
})

test('every rail page that renders board pieces carries board-page', () => {
  // board.css scopes its box padding, overflow fence and .ctl-select styling
  // to .board-page. A rail page using those pieces without the class renders
  // them inert -- the second half of defect 8.
  const pages = [...view.matchAll(/class="rail-page([^"]*)"/g)].map(match => match[1])
  assert.ok(pages.length >= 4, `expected the rail's pages, found ${pages.length}`)
  // The palette page is the one that regressed; it must carry the class.
  const palette = pages.find(rest => rest.includes('palette-page'))
  assert.ok(palette, 'palette page missing')
  assert.ok(palette.includes('board-page'), 'the palette page lost board-page; board.css is inert on it again')
})

test('one title-row definition, and no hand-built rail-title markup remains in the view', () => {
  // All title rows go through railTitleRow / railTitleRowElement
  // (src/rail-title.js). A hand-built <div class="rail-title"> is how the
  // back button starts wandering again.
  assert.ok(!/<div class="rail-title">/.test(view), 'a hand-built rail-title row is back in views/computers.js')
  assert.match(view, /railTitleRow\(/, 'the view no longer uses railTitleRow')
  const railTitle = readFileSync(join(SRC, 'rail-title.js'), 'utf8')
  assert.match(railTitle, /BACK_LABEL = '‹ Back'/, 'the constant back label changed; varying labels move the button centre between pages')
})

test('the model panel does not claim a one-message override', () => {
  const copy = readFileSync(join(SRC, 'fleet-tree-copy.js'), 'utf8')
  const start = copy.indexOf('export const MODEL_PANEL')
  assert.ok(start !== -1, 'MODEL_PANEL export not found')
  const block = copy.slice(start, copy.indexOf('})', start) + 2)
  // The one deliberate exception: the explanatory comment QUOTING the old
  // sentence to say why it was wrong. Strip comments before asserting.
  const code = block.replace(/\/\*[\s\S]*?\*\//g, '')
  assert.ok(!/next message/i.test(code), 'MODEL_PANEL claims the override lasts one message; the map is sticky until changed back')
})
