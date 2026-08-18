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
/* org-controls.js writes rail markup too -- the role library -- and the sweep
   originally read only computers.js, which is exactly how .role-list shipped
   with no rule anywhere (owner walkthrough, iteration 5). Every rail writer
   joins the sweep. */
const orgControls = readFileSync(join(SRC, 'org-controls.js'), 'utf8')

// Elements that are honest with NO styled class: pure mount points whose only
// job is to be found by querySelector and filled. Every entry carries its
// reason; an entry without one is the defect coming back politely.
const HOOK_ONLY_ELEMENTS = new Set([
  'board-org-slot',    // org library mount, filled by mountOrgLibrary
  'board-launch-slot', // launch panel mount
  'board-start-work-slot', // Launch/Team/Loop/Cloud mount on the tree-node rail
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
  for (const source of [view, orgControls]) {
    for (const match of source.matchAll(/className = '([^']+)'/g)) {
      lists.push(match[1].split(/\s+/).filter(Boolean))
    }
    for (const match of source.matchAll(/class="([^"$]+)"/g)) {
      const names = match[1].split(/\s+/).filter(name => name && !name.includes('{'))
      if (names.length) lists.push(names)
    }
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
  // them inert -- the second half of defect 8. The palette page retired with
  // the Actions tab (iteration 6: actions live in the chat composer's popup);
  // the ctl-page is the one board-piece renderer left, and it must keep the
  // class.
  const pages = [...view.matchAll(/class="rail-page([^"]*)"/g)].map(match => match[1])
  assert.ok(pages.length >= 3, `expected the rail's pages, found ${pages.length}`)
  assert.ok(!pages.some(rest => rest.includes('palette-page')), 'the palette page is back; actions belong to the chat popup now')
  const controls = pages.find(rest => rest.includes('ctl-page'))
  assert.ok(controls, 'controls page missing')
  assert.ok(controls.includes('board-page'), 'the controls page lost board-page; board.css is inert on it')
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

test('the rail chat streams once and closes once', () => {
  // 2.3's stream contract, pinned at source level (the geometry and the live
  // turn are the packaged probes' job):
  const components = readFileSync(join(SRC, 'components.js'), 'utf8')
  assert.match(components, /'openStream'/, 'buildChat lost openStream; the rail chat cannot stream a live turn')
  const view = readFileSync(join(SRC, 'views', 'computers.js'), 'utf8')
  // The delta branch pushes the ACCUMULATED text -- push replaces, so a
  // missed frame can never double words.
  assert.match(view, /railChat\.stream\?\.push\(sessionTurnText\.get\(sessionId\)\)/, 'the delta branch no longer pushes the accumulated turn text')
  // The completion's safety close comes AFTER the cardReply call, or a
  // rail-claimed turn prints its reply twice.
  const completionAt = view.indexOf('cardReplies.delete(sessionId)\n        cardReply(')
  const safetyCloseAt = view.indexOf('railChat.sessionId === sessionId && railChat.stream')
  assert.ok(completionAt !== -1 && safetyCloseAt > completionAt, 'the stream safety-close must follow the cardReply call')
  // A controlsPage rebuild disposes the mounted chat FIRST -- never
  // innerHTML='' over a live chat.
  const disposeAt = view.indexOf('disposeRailChat()\n    controlsPage.innerHTML')
  assert.ok(disposeAt !== -1, 'showTreeNodeControls no longer disposes the rail chat before rebuilding its markup')
})

test('two rail tabs, chat first — the Actions page stays retired', () => {
  /* Iteration 6, owner verbatim: "Actions again just shouldnt be its own
     page it should be a button on the chat." The rail is Chat | Details;
     the verbs live in the composer's popup (data-chat-actions in
     components.js) with runPaletteAction still the one engine. */
  const view = readFileSync(join(SRC, 'views', 'computers.js'), 'utf8')
  for (const tab of ['chat', 'details']) {
    assert.match(view, new RegExp(`data-rail-tab="${tab}"`), `the ${tab} tab vanished`)
    assert.match(view, new RegExp(`data-rail-body="${tab}"`), `the ${tab} body vanished`)
  }
  assert.ok(!/data-rail-tab="actions"/.test(view), 'the Actions tab is back as its own page — the owner retired it twice')
  assert.match(view, /chatActionRowsFor/, 'the chat popup lost its action rows; the verbs have no surface')
  // Chat is the default tab: its button carries .on in the markup.
  assert.match(view, /class="on" data-rail-tab="chat"/, 'chat is no longer the default tab (owner defect 7: conversation first)')
  // The setup controls the Actions tab used to hold live on in Details.
  for (const hook of ['data-tree-profile', 'data-tree-move-select']) {
    assert.match(view, new RegExp(hook), `${hook} vanished with the Actions tab instead of moving to Details`)
  }
})

test('the split view is gone, and cannot come back through a saved preference', () => {
  /* Owner, 2026-08-16: "lets throw it away for now" -- his read of the split
     pane was that a page ends up with two views nobody keeps straight. So the
     button, the pane, its switcher and the preference read are all absent from
     the view, and this pins that absence: a stored 'mc.page2.split' key must
     find nothing that reads it. The page is single-pane, the shape every
     harness has always measured it in. */
  const view = readFileSync(join(SRC, 'views', 'computers.js'), 'utf8')
  for (const gone of ['graph-split-btn', 'mc.page2.split', 'function enableSplit', 'function disableSplit', 'splitGraph', 'splitPane', 'buildPaneSwitch']) {
    assert.equal(view.includes(gone), false, `${gone} is back in the computers view; the split pane was removed on the owner's instruction`)
  }
  const css = readFileSync(join(SRC, 'board.css'), 'utf8') + readFileSync(join(SRC, 'tree-graph.css'), 'utf8')
  for (const gone of ['.comp-body.is-split', '.graph-pane-2', '.graph-split-btn']) {
    assert.equal(css.includes(gone), false, `${gone} still has a rule; the split pane it styled is gone`)
  }
})

test('the topbar holds one position on every route', () => {
  const css = readFileSync(join(SRC, 'styles.css'), 'utf8')
  // The chevrons are cross-page chrome: the bar reads its OWN token, never
  // the per-route page width (computers widens --page-max to 1680 and the
  // forward chevron travelled 64px with it -- measured on the installed
  // build, owner walkthrough iteration 5).
  assert.match(css, /--topbar-max: 1240px/, 'the topbar token vanished')
  const topbarAt = css.indexOf('.topbar {')
  const widthLine = css.slice(topbarAt, topbarAt + 2800).match(/width: min\(var\((--[a-z-]+)\)/)
  assert.ok(widthLine, 'the topbar width expression changed shape; re-verify the cross-route geometry')
  assert.equal(widthLine[1], '--topbar-max', 'the topbar follows the page width again; the chevrons move between routes')
  // And no route may override the topbar token.
  assert.ok(!/data-route[^}]*--topbar-max/.test(css), 'a route overrides --topbar-max; the chevrons move again')
})

test('the pane bar scrolls its trees slot and nowhere else', () => {
  /* Iteration 6 (owner): "one nice bar per split and it should have a scroll
     function. you have to place it nicely though." The bar is normal flow
     with three fixed slots, so the strip-over-the-title collision is
     structurally impossible; the SCROLL lives on the trees slot with its
     scrollbar hidden — never inside the seg, whose fixed 32px box rendered
     an inner scrollbar as the squashed glitch strip (iteration 5). */
  const board = readFileSync(join(SRC, 'board.css'), 'utf8')
  const seg = board.slice(board.indexOf('.graph-bar-trees .graph-tree-switch {'), board.indexOf('.graph-bar-trees .graph-tree-switch {') + 700)
  assert.ok(seg.length > 100, 'the switcher seg rules left the trees slot; re-measure this bar contract')
  assert.ok(!/overflow-x:\s*auto/.test(seg.slice(0, seg.indexOf('> button'))), 'the switcher seg regained an inner scroller; the 32px box cannot hold one')
  assert.match(seg, /text-overflow: ellipsis/, 'the switcher buttons lost their ellipsis budget')
  const graphCss = readFileSync(join(SRC, 'tree-graph.css'), 'utf8')
  const bar = graphCss.slice(graphCss.indexOf('.computers .graph-bar {'), graphCss.indexOf('.computers .graph-bar {') + 500)
  assert.ok(!/position:\s*absolute/.test(bar), 'the bar floated over the canvas again; the title collision returns')
  const trees = graphCss.slice(graphCss.indexOf('.computers .graph-bar-trees {'), graphCss.indexOf('.computers .graph-bar-trees {') + 700)
  assert.match(trees, /overflow-x: auto/, "the trees slot lost its scroll — many trees squeeze the bar again")
  assert.match(trees, /scrollbar-width: none/, 'the trees slot shows a raw scrollbar inside the 46px bar')
  const view = readFileSync(join(SRC, 'views', 'computers.js'), 'utf8')
  assert.match(view, /<div class="graph-bar">/, 'the main pane lost its bar')
  /* "One nice bar PER SPLIT" was iteration 6's ask, and its second half was
     pinned here until 2026-08-16, when the owner threw the split pane away
     ("lets throw it away for now"). A contract on a pane that no longer
     exists can only fail, so that one clause retired with the pane; every
     other rule in this test is about the bar that remains and still holds. */
  /* The switcher must build AT MOUNT: every other caller is a change
     handler, and a quietly-loaded page with saved trees stood bare until
     the first store write — found driving the installed build. */
  const mount = view.slice(view.indexOf('function mountGraph'), view.indexOf('REDRAW THE PAGE FROM WHAT IS ACTUALLY SAVED'))
  assert.match(mount, /refreshTreeSwitch\(\)/, 'mountGraph no longer builds the switcher; a quiet load shows an empty trees slot over a forest')
})

test('Details reads as prose, dims really dim, and the boxes have a floor', () => {
  /* Iteration 6: "Details is completely unreadable". Four measured causes,
     four pins: the undefined --mono token (the dim class silently inherited
     its font); the specificity tie that made dimmed lines identical to body
     lines; the mono wall (sentences now speak .rail-prose, the UI voice);
     and box fills that resolved to ~4% white on dark (ink-mix now, so the
     lift survives every theme). */
  const css = readFileSync(join(SRC, 'styles.css'), 'utf8')
  assert.ok(!/font-family: var\(--mono\)/.test(css), 'var(--mono) is back — that token does not exist, the declaration is silently invalid')
  assert.match(css, /\.rail-sub\.projection-unavailable,[\r\n]+\.rail-prose\.is-dim \{/, 'the compound dim rule is gone; dimmed lines tie and lose again')
  assert.match(css, /\.rail-prose \{[^}]*font-family: var\(--font-ui\)/s, 'the rail prose voice is gone; Details is a mono wall again')
  assert.match(css, /\.rail-prose \{[^}]*overflow-wrap: anywhere/s, 'long ids clip against the rail overflow fence again')
  const view = readFileSync(join(SRC, 'views', 'computers.js'), 'utf8')
  const details = view.slice(view.indexOf('data-rail-body="details"'), view.indexOf('data-tree-move-out'))
  assert.ok(!/class="rail-sub"/.test(details), 'a bare rail-sub is back in the Details body; sentences belong to the prose voice')
  const board = readFileSync(join(SRC, 'board.css'), 'utf8')
  const box = board.slice(board.indexOf('.board-page .board-box,'), board.indexOf('.board-page .board-box,') + 1200)
  assert.match(box, /background: color-mix\(in oklab, var\(--ink\)/, 'the box fill rides white-alpha again; on dark themes the boxes vanish')
})

test('the rail never shouts a person\'s own words, and a header outranks its body', () => {
  /* Iteration 7, owner: the pane is "an ugly unreadable mess of nonsense".
     Measured causes, pinned so they cannot come back:
       · the brief was painted in letterspaced CAPITALS by the base .ar rule,
         which the board override restated everything EXCEPT text-transform;
       · the same brief was then printed a second time in its own box;
       · header and body shared one ink token, so nothing read as a heading;
       · .rail-sec was typographically identical to .board-box-h — two
         heading ranks that looked the same;
       · the fleet page overwrote the box fill added for this very page. */
  const board = readFileSync(join(SRC, 'board.css'), 'utf8')
  const arRule = board.slice(board.indexOf('.board-page .agent-head .ar {'), board.indexOf('.board-page .agent-head .ar {') + 400)
  assert.match(arRule, /text-transform: none/, "the rail head shouts again — that line can carry a person's own words")
  const headerRule = board.slice(board.indexOf('.board-page .board-box-h,'), board.indexOf('.board-page .board-box-h,') + 400)
  assert.match(headerRule, /color: var\(--ink\)/, 'the box header shares its body ink again; nothing reads as a heading')
  assert.match(headerRule, /margin-bottom/, 'the box header sits flush on its body again')
  const secRule = board.slice(board.indexOf('.board-page .board-box .rail-sec {'), board.indexOf('.board-page .board-box .rail-sec {') + 400)
  assert.match(secRule, /text-transform: none/, 'the sub-label impersonates a box header again')
  assert.match(board, /\.board-page \.board-box \.rail-said \{[^}]*max-height/s, 'the answer box is unbounded again; Setup falls off the scroller')
  assert.match(board, /\.board-page \.board-box \.board-absent-copy \{/, 'the engine note is unstyled again — it renders as the loudest prose on the rail')
  const graphCss = readFileSync(join(SRC, 'tree-graph.css'), 'utf8')
  assert.ok(!/\.computers \.board-page \.board-box \{[^}]*background: var\(--sheet\)/s.test(graphCss),
    'the fleet page re-flattens the boxes, overwriting the fill that exists for this page')
  /* The brief appears once, as prose — never in the head. */
  const view = readFileSync(join(SRC, 'views', 'computers.js'), 'utf8')
  const details = view.slice(view.indexOf('data-rail-body="details"'), view.indexOf('data-tree-move>'))
  assert.ok(!/class="ar"[^>]*>\$\{escapeMarkup\(treeNodeBrief/.test(details), 'the head prints the brief again, in capitals')
  assert.equal((details.match(/escapeMarkup\(node\.message/g) || []).length, 1, 'the brief is printed more than once in Details')
})

test('every theme block declares its color-scheme', () => {
  const css = readFileSync(join(SRC, 'styles.css'), 'utf8')
  assert.match(css, /color-scheme: light/, 'the light color-scheme vanished; native popups guess again')
  const black = css.slice(css.indexOf(':root[data-theme="black"]'), css.indexOf(':root[data-theme="black"]') + 800)
  assert.match(black, /color-scheme: dark/, "the black theme lost color-scheme: dark; the role dropdown goes unreadable again")
  assert.match(css, /select option,\nselect optgroup \{/, 'the option paint rule vanished; Chromium popups ignore the theme')
})
