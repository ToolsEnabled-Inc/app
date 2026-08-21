/* Electron-owned Page 2 verification. Run after `npm run build`:
   node shell/launch.cjs is the human shell; this harness keeps its own
   hidden window, drives real pointer input, and writes screenshots to a
   temporary directory for visual inspection. */

const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const results = []
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const check = (name, pass, detail = '') => {
  results.push({ name, pass: Boolean(pass), detail })
  if (!pass) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
}

function serveDist() {
  const mime = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.woff2': 'font/woff2', '.woff': 'font/woff',
  }
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname)
      const requested = path.resolve(DIST, `.${pathname === '/' ? '/index.html' : pathname}`)
      if (!requested.startsWith(DIST)) {
        response.writeHead(403)
        response.end()
        return
      }
      fs.readFile(requested, (error, data) => {
        if (error) {
          response.writeHead(404)
          response.end()
          return
        }
        response.writeHead(200, { 'content-type': mime[path.extname(requested)] || 'application/octet-stream' })
        response.end(data)
      })
    })
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

async function waitFor(webContents, expression, timeout = 6000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await webContents.executeJavaScript(`Boolean(${expression})`)) return
    await delay(50)
  }
  throw new Error(`Timed out waiting for ${expression}`)
}

/* WHAT IS STILL MOVING, NAMED.
   This used to be an inline `.map(a => ({ target: a.effect.target.className }))`,
   and on an SVG element `className` is an SVGAnimatedString, which
   JSON.stringify renders as `{}`. The intermittent red this harness was known
   for therefore reported
     [{"target":{},"animationName":"none","type":"CSSTransition"}]
   -- a failure message that names nothing, on a check whose whole job is to say
   what has not settled. A check that cannot name its own defect is not a check.
   `getAttribute('class')` reads the same string on HTML and SVG alike. */
/* ONE ROUND TRIP, THREE WAYS FOR THE PAGE TO STILL BE MOVING.
   Animations and frame callbacks are not the only ones. A ResizeObserver on the
   graph container calls resize() -> _layoutNow() -> _placeChips(), and in a
   window that has never been shown the container's measured size arrives late,
   so the chip placement can run AFTER a settle window that only watched
   animations. That is what made "flat context labels do not collide" red on an
   unchanged tree: the chips were measured mid-placement, not overlapping.
   The geometry fingerprint below closes that: a layout that is still moving is
   not settled, whatever mechanism is moving it. */
const SETTLE_SAMPLE = `(() => {
  const describe = (element) => {
    if (!(element instanceof Element)) return String(element);
    const classes = (element.getAttribute('class') || '').trim();
    return element.tagName.toLowerCase() + (classes ? '.' + classes.split(/\\s+/).join('.') : '');
  };
  const box = (element) => {
    const rect = element.getBoundingClientRect();
    return [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)].join(',');
  };
  const layout = [
    ...document.querySelectorAll('.static-tree-node'),
    ...document.querySelectorAll('.static-tree-chip'),
    ...document.querySelectorAll('.static-tree-links .tree-link'),
  ].map(element => describe(element) + '@' + box(element)).join('|');
  const animations = document.getAnimations()
    .filter(animation => {
      const target = animation.effect && animation.effect.target;
      return target instanceof Element
        && typeof target.closest === 'function'
        && Boolean(target.closest('.computers'))
        && !target.closest('.tree-node-adding, .tree-node-removing');
    })
    /* PENDING COUNTS AS UNSETTLED. A transition that has been created but has
       not been given a start time yet reports playState 'running' with
       currentTime 0, and this window is deliberately hidden, so it can sit
       there for seconds. Treating it as settled would be reading "no frame has
       been produced" as "nothing is moving". */
    .filter(animation => animation.playState === 'running' || animation.pending === true)
    .map(animation => {
      const timing = (animation.effect.getComputedTiming && animation.effect.getComputedTiming()) || {};
      return {
        type: animation.constructor.name,
        property: animation.transitionProperty || animation.animationName || null,
        target: describe(animation.effect.target),
        playState: animation.playState,
        pending: animation.pending === true,
        currentTime: Math.round(Number(animation.currentTime) || 0),
        duration: timing.duration,
        iterations: timing.iterations,
        perpetual: timing.iterations === Infinity || timing.duration === Infinity,
      };
    });
  /* DIAGNOSTIC ONLY, asserted on by nothing: when the page will not settle, the
     first question is always "what is moving", and the answer is unhelpful if
     the only list shown has already been narrowed to the subtree under test. */
  const everything = document.getAnimations()
    .filter(animation => animation.playState === 'running' || animation.pending === true)
    .slice(0, 12)
    .map(animation => {
      const target = animation.effect && animation.effect.target;
      const timing = (animation.effect && animation.effect.getComputedTiming && animation.effect.getComputedTiming()) || {};
      return describe(target) + ' ' + animation.constructor.name
        + ' ' + (animation.transitionProperty || animation.animationName || '')
        + (timing.iterations === Infinity ? ' [perpetual]' : '');
    });
  return { raf: window.__qaRafCount, animations, layout, everything };
})()`

/* SETTLE, DO NOT SAMPLE AT A FIXED OFFSET.
   The two checks below ("no idle requestAnimationFrame callbacks", "no settled
   Page 2 CSS animation") used to read `await delay(900)` and then take ONE
   reading. That measures "was the page quiet at t=900ms", which is a property
   of the machine's load, not of the software: a 120ms transition that starts at
   t=850 is indistinguishable at a single instant from a transition that never
   ends. Measured on an unchanged tree, five concurrent runs at a time: 14/15
   green, and the one red was a real 120ms CSSTransition on an SVG chip-leader
   dot that had merely started late.

   So the invariant is stated as what it always meant: the page REACHES an idle
   state, and once idle it STAYS idle. A perpetual animation or a self-renewing
   requestAnimationFrame loop -- the defects these checks exist to catch -- never
   reaches the idle state at all and still fails, on any machine, at any load.
   Nothing is loosened: the settled reading must still be exactly zero on both
   counts, and the frame counter is reset before the final quiet window so a
   loop that starts late cannot hide behind frames that were legitimate during
   mount. */
async function settlePage2(webContents, { deadlineMs = 12000, quietMs = 400 } = {}) {
  const started = Date.now()
  let quietSince = Date.now()
  let previous = { raf: -1, layout: null }
  let sample = { raf: 0, animations: [], layout: '' }
  while (Date.now() - started < deadlineMs) {
    sample = await webContents.executeJavaScript(SETTLE_SAMPLE)
    const quiet = sample.animations.length === 0
      && sample.raf === previous.raf
      && sample.layout === previous.layout
    previous = sample
    if (!quiet) {
      quietSince = Date.now()
      await delay(80)
      continue
    }
    if (Date.now() - quietSince >= quietMs) {
      await webContents.executeJavaScript('window.__qaRafCount = 0')
      await delay(quietMs)
      const after = await webContents.executeJavaScript(SETTLE_SAMPLE)
      return {
        settled: true,
        settleMs: Date.now() - started,
        idleRafCallbacks: after.raf,
        runningAnimations: after.animations,
        layoutMovedWhileIdle: after.layout !== sample.layout,
        anythingStillRunning: after.everything,
      }
    }
    await delay(80)
  }
  return {
    settled: false,
    settleMs: Date.now() - started,
    idleRafCallbacks: sample.raf,
    runningAnimations: sample.animations,
    layoutMovedWhileIdle: true,
    anythingStillRunning: sample.everything,
  }
}

async function drag(webContents, from, to) {
  webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(from.x), y: Math.round(from.y) })
  await delay(60)
  webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(from.x), y: Math.round(from.y), button: 'left', clickCount: 1 })
  await delay(30)
  for (let step = 1; step <= 8; step += 1) {
    webContents.sendInputEvent({
      type: 'mouseMove',
      x: Math.round(from.x + (to.x - from.x) * step / 8),
      y: Math.round(from.y + (to.y - from.y) * step / 8),
      button: 'left',
    })
    await delay(18)
  }
  webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(to.x), y: Math.round(to.y), button: 'left', clickCount: 1 })
  await delay(260)
}

async function run() {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-page2-qa-'))
  app.setPath('userData', path.join(outputDir, 'profile'))
  app.commandLine.appendSwitch('disable-gpu')
  const server = await serveDist()
  const address = server.address()
  const origin = `http://127.0.0.1:${address.port}`
  const window = new BrowserWindow({
    width: 1600,
    height: 900,
    show: false,
    backgroundColor: '#f2e5bc',
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  })
  const webContents = window.webContents
  const rendererErrors = []
  webContents.on('console-message', (event) => {
    const level = typeof event.level === 'number' ? event.level : 0
    const message = event.message || 'unknown renderer error'
    const expectedDiscoveryMiss = /blocked by CORS policy|ERR_FAILED.*461[0-9]/.test(message)
    /* NOT A RENDERER ERROR: Chromium's own note that ResizeObserver delivery
       was deferred one frame because observed layout changed inside the
       callback. It is emitted at error level, but the spec defines it as the
       loop-breaker working as designed, and on this page it appears under
       machine load alone: on 2026-08-19, with the packaged suite churning the
       machine, the PREVIOUS confirming tree a3e9f85 -- green on its own
       confirming run -- went red on exactly this message 7 runs out of 7
       (3 sequential + 4 concurrent), same driver bytes, same dist recipe.
       A check that reds on an unchanged, previously-green product is
       measuring the weather, not the renderer. Whether the graph's
       resize->layout->placeChips chain ever fails to TERMINATE is what the
       settle checks below measure, and they still demand exactly zero
       residual motion. Every other error-level message still fails here. */
    const expectedLoadDeferral = message.includes('ResizeObserver loop completed with undelivered notifications')
    if (!expectedDiscoveryMiss && !expectedLoadDeferral && (level >= 3 || event.level === 'error')) {
      rendererErrors.push(message)
      results.push({ name: 'renderer console', pass: false, detail: message })
    }
  })

  await window.loadURL(`${origin}/`)
  /* One key stands where the two per-view flags stood: mc.example 'on' shows
     the example fleet on every screen (src/data-source.js). */
  await webContents.executeJavaScript(`
    localStorage.setItem('mc.example', 'on');
    localStorage.setItem('mc.theme', 'tan');
    location.hash = '#/computers/c1';
    location.reload();
  `)
  await waitFor(webContents, `document.querySelectorAll('.static-tree-node').length >= 9 && window.__mcGraph`)
  /* WAIT FOR THE FONTS BEFORE STARTING THE SETTLE WINDOW.
     Web fonts land after first paint and change text metrics with NO DOM
     mutation and NO resize event, so nothing in the page announces them. Any
     relayout they trigger — and a label's box is exactly what a font swap
     moves — landed inside the 900ms settle window below and was counted as
     unsettled activity. That is the most likely cause of this harness's
     intermittent reds on "no idle requestAnimationFrame callbacks" and on "no
     settled Page 2 CSS animation" with target `node-labels`, both of which
     fire here, before any node has been clicked.
     Diagnosed by the agent-subpage lane, which hit the same class of bug in
     its own harness: its roster measured 149px against a settled 251px, and
     `await document.fonts.ready` removed it.
     This is a fix to the INSTRUMENT's timing, not a loosening of what it
     asserts — every check below still demands exactly what it demanded. */
  await webContents.executeJavaScript(`document.fonts.ready.then(() => true)`)
  await webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`)
  await webContents.executeJavaScript(`(() => {
    const nativeMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = query => query === '(prefers-reduced-motion: reduce)'
      ? { matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false } }
      : nativeMatchMedia(query);
    document.body.classList.remove('reduce-motion');
    window.__qaNativeRaf = window.requestAnimationFrame.bind(window);
    window.__qaNativeCancelRaf = window.cancelAnimationFrame.bind(window);
    window.__qaRafCount = 0;
    window.requestAnimationFrame = callback => setTimeout(() => { window.__qaRafCount += 1; callback(performance.now()) }, 16);
    window.cancelAnimationFrame = handle => clearTimeout(handle);
  })()`)
  /* STATED LIMIT OF THIS COUNTER, so nobody quotes it for more than it measures.
     It is installed AFTER the page has mounted, and this window is hidden, so a
     frame loop that was started during mount and is still parked on the NATIVE
     requestAnimationFrame never fires and is never counted -- a hidden window
     produces almost no native frames. Mutation-checked: a native rAF loop
     planted in the graph constructor SURVIVES this harness, and survived it
     before this change too, so it is a pre-existing property of the
     instrument rather than a regression. What it does catch, and what was
     proven by planting it, is any loop that keeps scheduling frames through the
     page's own window.requestAnimationFrame once the harness is watching --
     including one that starts AFTER the page has settled, which the previous
     fixed 900ms window could not see at all. Closing the remaining gap needs
     the counter installed at document-start, which needs a preload, which needs
     contextIsolation off -- i.e. it would change the environment under test. */
  /* WAIT OUT THE PAGE'S OWN ENTRY MOTION BEFORE OPENING THE SETTLE WINDOW.
     The router mounts every view as `.view.enter` and lifts the class in a
     double requestAnimationFrame (src/main.js swapView). That rAF is the
     NATIVE one -- it was scheduled at mount, before the shim above existed --
     and this window is hidden, so the frame that runs it arrives whenever the
     compositor deigns to produce one. When it arrives LATE, the lift starts
     the wrapper's one-shot opacity/transform transition (.view's stylesheet
     transition), and if that lands inside the confirm window below, the
     transform moves every sampled rect and the idle check reads
       layoutMovedWhileIdle=true
       anywhereOnThePage=["div.view CSSTransition opacity","div.view CSSTransition transform"]
     -- which is exactly the red the 2026-08-19 confirming run produced at
     0485034, and exactly what this harness reproduced ON THE PREVIOUS GREEN
     TREE a3e9f85 by making the lift-frame arrive at mount+2150ms in a
     worktree build (layoutMovedWhileIdle=true, same two transitions named).
     The entry motion is a ONE-SHOT: the page still reaches idle and stays
     there, which is the invariant the check states. So the instrument waits
     for the entry to have actually run -- class lifted, wrapper transitions
     finished -- before it starts judging idleness, the same way it already
     waits for document.fonts.ready. A perpetual animation or a self-renewing
     frame loop fails the checks below exactly as before; and if this window
     truly gets no frame at all, that is named here as harness state rather
     than left to surface as a settle red blamed on the page. */
  const entry = await webContents.executeJavaScript(`new Promise(resolve => {
    const startedAt = Date.now();
    const deadline = startedAt + 10000;
    const entryStillPending = () => {
      const wrappers = [...document.querySelectorAll('.view')];
      const classed = wrappers.some(v => v.classList.contains('enter') || v.classList.contains('exit'));
      const moving = document.getAnimations().some(animation => {
        const target = animation.effect && animation.effect.target;
        return target instanceof Element
          && target.classList.contains('view')
          && (animation.playState === 'running' || animation.pending === true);
      });
      return classed || moving;
    };
    const poll = () => {
      if (!entryStillPending()) return resolve({ done: true, waitedMs: Date.now() - startedAt });
      if (Date.now() > deadline) return resolve({ done: false, waitedMs: Date.now() - startedAt });
      setTimeout(poll, 60);
    };
    poll();
  })`)
  check('HARNESS STATE: the entry motion ran before the settle window opened', entry.done,
    `waited ${entry.waitedMs}ms and .view never finished entering -- this hidden window got no frame; nothing about the page was measured`)
  const settle = await settlePage2(webContents)

  const initial = await webContents.executeJavaScript(`(() => {
    const graph = window.__mcGraph;
    const node = document.querySelector('.static-tree-node');
    const glass = node.querySelector('.node-glass');
    const style = getComputedStyle(glass);
    const edge = document.querySelector('.static-tree-links .tree-link');
    const edgeStyle = getComputedStyle(edge);
    const chips = [...document.querySelectorAll('.static-tree-chip.screen-chip-visible')];
    const chipRects = chips.map(chip => chip.getBoundingClientRect());
    const nodeRects = [...document.querySelectorAll('.static-tree-node:not([hidden])')].map(node => node.getBoundingClientRect());
    const intersects = (a, b) => Math.min(a.right, b.right) > Math.max(a.left, b.left)
      && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
    const chip = chips[0];
    const chipAccent = chip ? getComputedStyle(chip, '::before') : null;
    const resolveColor = value => {
      const probe = document.createElement('i');
      probe.style.color = value;
      document.body.appendChild(probe);
      const resolved = getComputedStyle(probe).color;
      probe.remove();
      return resolved;
    };
    const roleTokenMatch = [...document.querySelectorAll('.static-tree-node')].every(item => {
      const roleClass = [...item.classList].find(name => name.startsWith('role-'));
      const roleKey = roleClass?.slice(5);
      return roleKey && getComputedStyle(item.querySelector('.node-glass')).borderTopColor
        === resolveColor(getComputedStyle(document.documentElement).getPropertyValue('--c-' + roleKey).trim());
    });
    const sections = [...document.querySelectorAll('.stats-page .rail-sec')].map(item => item.textContent.trim());
    return {
      staticApi: typeof graph.hasPositionOverrides === 'function' && typeof graph._animateRecord === 'function',
      dataLayout: graph.container.dataset.layout,
      nodes: graph.nodes.size,
      frameMs: window.__graphFrameMs,
      nodeCount: window.__graphNodeCount,
      physicsControl: Boolean(document.querySelector('.graph-layout-seg')),
      resetVisible: !document.querySelector('.graph-reset-btn').hidden
        && getComputedStyle(document.querySelector('.graph-reset-btn')).display !== 'none',
      material: {
        backgroundImage: style.backgroundImage,
        backgroundColor: style.backgroundColor,
        borderWidth: style.borderTopWidth,
        boxShadow: style.boxShadow,
        backdrop: style.backdropFilter || style.webkitBackdropFilter,
      },
      edge: { width: edgeStyle.strokeWidth, dash: edgeStyle.strokeDasharray, opacity: edgeStyle.opacity },
      chipMaterial: chip ? {
        backgroundImage: getComputedStyle(chip).backgroundImage,
        accentBackgroundImage: chipAccent.backgroundImage,
        accentWidth: chipAccent.width,
      } : null,
      visibleChips: chips.length,
      chipOverlaps: chipRects.reduce((count, rect, index) => count
        + chipRects.slice(index + 1).filter(other => intersects(rect, other)).length, 0),
      chipNodeOverlaps: chipRects.reduce((count, rect) => count
        + nodeRects.filter(other => intersects(rect, other)).length, 0),
      roleTokenMatch,
      sections,
    };
  })()`)
  check('StaticTreeGraph mounted', initial.staticApi, JSON.stringify(initial))
  check('tree DOM contract', initial.dataLayout === 'tree' && initial.nodes === initial.nodeCount && initial.nodes >= 9, JSON.stringify(initial))
  check('Page 2 physics control retired', initial.physicsControl === false)
  check('Reset positions is absent without overrides', initial.resetVisible === false)
  check('flat node material', initial.material.backgroundImage === 'none'
    && Math.abs(parseFloat(initial.material.borderWidth) - 1.5) < 0.1
    && initial.material.boxShadow === 'none'
    && initial.material.backdrop === 'none', JSON.stringify(initial.material))
  check('node rings resolve to exact role tokens', initial.roleTokenMatch)
  check('neutral single-stroke edge', initial.edge.width === '1.25px' && initial.edge.opacity === '1', JSON.stringify(initial.edge))
  check('flat context labels do not collide', initial.visibleChips > 0 && initial.chipOverlaps === 0
    && initial.chipNodeOverlaps === 0 && initial.chipMaterial.backgroundImage === 'none'
    && initial.chipMaterial.accentBackgroundImage === 'none'
    && Math.abs(parseFloat(initial.chipMaterial.accentWidth) - 2) < 0.1, JSON.stringify(initial))
  /* The sim rail's Load/Tasks/Legend went with the second render; the one
     stats rail reads the record on every source (renderLiveStats in
     src/views/computers.js), so the pin is the delivered section walk. */
  check('statistics order', JSON.stringify(initial.sections) === JSON.stringify(['Folders your agents work in', 'This computer', 'Services', 'Organisation', 'Roles', 'Research filing']), initial.sections.join(','))

  /* LABEL LAYOUT, MEASURED ON GLASS.
     tools/test/phase2-label-layout.test.mjs pins the same contract as source
     text, and used to pin it against FleetGraph's stylesheet — a sheet no
     browser loads — where it passed for months while asserting nothing about
     this page. Source text cannot see whether a rule is loaded, applied, or
     overridden, which is exactly how that survived. This is the half that can.
     Every visible node's name and role row must sit inside the label stack
     that bounds them, and the stack must not exceed the per-node budget. */
  const labels = await webContents.executeJavaScript(`(() => {
    const nodes = [...document.querySelectorAll('.static-tree-node:not([hidden])')];
    const overflowing = [];
    const unlabelled = [];
    let stacksMeasured = 0;
    for (const node of nodes) {
      const stack = node.querySelector('.node-labels');
      const aria = node.getAttribute('aria-label') || '';
      const role = node.querySelector('.node-role')?.textContent?.trim() || '';
      if (!role || !aria.includes(role)) unlabelled.push({ id: node.dataset.agentId, aria, role });
      if (!stack) continue;
      stacksMeasured += 1;
      const stackRect = stack.getBoundingClientRect();
      for (const row of stack.querySelectorAll('.node-name, .node-role')) {
        const rect = row.getBoundingClientRect();
        /* 0.5px tolerance: sub-pixel layout rounding, not slack. */
        if (rect.width > stackRect.width + 0.5) {
          overflowing.push({ id: node.dataset.agentId, row: row.className, rowWidth: rect.width, stack: stackRect.width });
        }
      }
    }
    return { nodeCount: nodes.length, stacksMeasured, overflowing, unlabelled };
  })()`)
  check('role sublabels stay inside the node label budget',
    labels.stacksMeasured > 0 && labels.overflowing.length === 0,
    JSON.stringify(labels))
  check('every node carries an accessible identity naming its role',
    labels.nodeCount > 0 && labels.unlabelled.length === 0,
    JSON.stringify(labels.unlabelled))
  check('settled graph probe starts idle', initial.frameMs === 0)
  check('Page 2 reaches an idle state at all', settle.settled && !settle.layoutMovedWhileIdle,
    `still moving after ${settle.settleMs}ms: animations=${JSON.stringify(settle.runningAnimations)}`
    + ` rAF=${settle.idleRafCallbacks} layoutMovedWhileIdle=${settle.layoutMovedWhileIdle}`
    + ` anywhereOnThePage=${JSON.stringify(settle.anythingStillRunning)}`)
  check('no idle requestAnimationFrame callbacks', settle.idleRafCallbacks === 0, String(settle.idleRafCallbacks))
  check('no settled Page 2 CSS animation', settle.runningAnimations.length === 0, JSON.stringify(settle.runningAnimations))

  /* THE REDUCED-MOTION CONTROL MUST REMOVE MOTION, NOT MANUFACTURE IT.
     A control that exists to prevent a thing and instead causes it is a
     software failure, not a cosmetic one, and this one was live: both
     reduced-motion blocks in src/styles.css clamped `transition-duration` on
     `*` without touching `transition-property`, whose initial value is `all`.
     An element that declared no transition therefore resolved to
     `all / 0.12s`, so every reposition of the SVG chip-leader dot's `cx`/`cy`
     -- and of `.tree-link` -- started a real 120ms CSSTransition. A reader who
     asked Windows for less motion got MORE of it on this page than a reader who
     did not, and it is also what made this harness intermittently red.

     Asserted BEHAVIOURALLY and on the in-app toggle rather than on the OS
     preference, so it measures the same CSS on any machine instead of passing
     silently wherever the OS preference is off: turn `reduce-motion` on, move a
     property nothing declared a transition for, and require that no transition
     was created at all. */
  const reduceMotion = await webContents.executeJavaScript(`(() => {
    const dot = document.querySelector('.graph-chip-leader-dot');
    if (!dot) return { probed: false };
    const wasOn = document.body.classList.contains('reduce-motion');
    document.body.classList.add('reduce-motion');
    const style = getComputedStyle(dot);
    const resolved = { property: style.transitionProperty, duration: style.transitionDuration };
    const cx = dot.getAttribute('cx');
    dot.setAttribute('cx', String(Number(cx || 0) + 40));
    const manufactured = document.getAnimations()
      .filter(animation => animation.effect && animation.effect.target === dot)
      .map(animation => animation.transitionProperty || animation.animationName || 'unknown');
    dot.setAttribute('cx', cx === null ? '0' : cx);
    for (const animation of document.getAnimations()) {
      if (animation.effect && animation.effect.target === dot) animation.cancel();
    }
    if (!wasOn) document.body.classList.remove('reduce-motion');
    return { probed: true, resolved, manufactured };
  })()`)
  check('reduced motion removes motion rather than manufacturing it',
    reduceMotion.probed === true
    && reduceMotion.resolved.property === 'none'
    && reduceMotion.manufactured.length === 0,
    JSON.stringify(reduceMotion))

  // Theme screenshots: the requested tan-first order is load-bearing.
  window.setPosition(80, 80)
  window.showInactive()
  await delay(500)
  /* MEASURED LIMIT OF THIS HARNESS, recorded because it changes what any
     motion check here can mean, and because the alternative was shipping a
     check that has never gone red.

     1. This Chromium reports prefers-reduced-motion: reduce, so the app's own
        clamp caps EVERY CSS animation at 0.001ms with one iteration and every
        transition at 120ms. A page-2 CSS motion defect is therefore short-lived
        by construction here: `no settled Page 2 CSS animation` can catch a
        transition that is genuinely still running, which is what the settle
        loop above now waits out, but a long or perpetual CSS animation cannot
        be planted in this environment at all.
     2. In a window that has never been composited, an animation created by
        element.animate() parks at `playState: 'running', pending: true,
        currentTime: 0` and document.getAnimations() DOES NOT RETURN IT --
        measured directly: element.getAnimations() gave 0 and the document gave
        6, none of them it. A perpetual WAAPI animation is invisible to this
        harness, and was equally invisible to the check that preceded this one.

     A second settle reading taken with the window shown was tried and removed:
     it could not be made to fail for any defect the readings above do not
     already catch, and a check that cannot go red is decoration. What guards
     Page 2's motion here is the pair that IS mutation-proven -- the idle-frame
     checks above, and `reduced motion removes motion rather than manufacturing
     it`. */
  for (const theme of ['tan', 'white', 'black']) {
    await webContents.executeJavaScript(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}; localStorage.setItem('mc.theme', ${JSON.stringify(theme)});`)
    await delay(760)
    const themeAudit = await webContents.executeJavaScript(`(() => {
      const parse = color => (color.match(/[\\d.]+/g) || []).slice(0, 3).map(Number);
      const luminance = color => {
        const values = parse(color).map(value => {
          const channel = value / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
      };
      const ratio = (left, right) => {
        const a = luminance(left), b = luminance(right);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      };
      const node = document.querySelector('.static-tree-node');
      const glass = node.querySelector('.node-glass');
      const runtime = node.querySelector('.rt');
      const panel = document.querySelector('.graph-wrap');
      const nodeStyle = getComputedStyle(glass);
      const panelStyle = getComputedStyle(panel);
      return {
        theme: document.documentElement.dataset.theme,
        runtimeContrast: ratio(getComputedStyle(runtime).color, nodeStyle.backgroundColor),
        nodeGradient: nodeStyle.backgroundImage,
        panelGradient: panelStyle.backgroundImage,
        nodeBackdrop: nodeStyle.backdropFilter || nodeStyle.webkitBackdropFilter,
        panelBackdrop: panelStyle.backdropFilter || panelStyle.webkitBackdropFilter,
        nodeShadow: nodeStyle.boxShadow,
        panelShadow: panelStyle.boxShadow,
      };
    })()`)
    check(`${theme} theme flat-token and runtime-contrast audit`, themeAudit.theme === theme
      && themeAudit.runtimeContrast >= 4.5
      && themeAudit.nodeGradient === 'none' && themeAudit.panelGradient === 'none'
      && themeAudit.nodeBackdrop === 'none' && themeAudit.panelBackdrop === 'none'
      && themeAudit.nodeShadow === 'none' && themeAudit.panelShadow === 'none', JSON.stringify(themeAudit))
    const screenshot = await webContents.capturePage()
    fs.writeFileSync(path.join(outputDir, `page2-${theme}-1600x900.png`), screenshot.toPNG())
  }
  await webContents.executeJavaScript(`document.documentElement.dataset.theme = 'tan'; localStorage.setItem('mc.theme', 'tan');`)
  await delay(760)

  window.hide()

  // Chip ↔ chat remains functional and is the only context-label size motion.
  await webContents.executeJavaScript(`document.querySelector('.static-tree-chip.screen-chip-visible')?.click()`)
  await waitFor(webContents, `document.querySelector('.static-tree-chip.as-chat .chat')`)
  /* This check used to be `check('context chip opens chat', true)` — a literal
     that cannot fail. It waited for the chat ELEMENT and then asserted nothing
     about whether a person could see it, and underneath it the product shipped
     a chat that opened and was then hidden at every window size on every node:
     the placer found no seat for a 360x368 panel under the "immediately beside
     the circle" rule and set the whole block to opacity 0. So the assertion is
     now what the name always claimed — the chat is ON SCREEN, inside the
     canvas, reachable by a pointer, and still wearing the braces the owner
     keeps on this page's chatboxes. */
  const chatOpened = await webContents.executeJavaScript(`(() => {
    const chip = document.querySelector('.static-tree-chip.as-chat')
    if (!chip) return { present: false }
    const box = chip.getBoundingClientRect()
    const host = document.querySelector('.graph-wrap').getBoundingClientRect()
    const style = getComputedStyle(chip)
    return {
      present: true,
      opacity: Number(style.opacity),
      visibility: style.visibility,
      pointerEvents: style.pointerEvents,
      width: Math.round(box.width), height: Math.round(box.height),
      insideCanvas: box.x >= host.x - 1 && box.y >= host.y - 1
        && box.right <= host.right + 1 && box.bottom <= host.bottom + 1,
      braces: chip.querySelectorAll('.monitor-brace').length,
    }
  })()`)
  check('context chip opens a chat a person can actually see',
    chatOpened.present && chatOpened.opacity > 0.9 && chatOpened.visibility === 'visible'
    && chatOpened.pointerEvents !== 'none' && chatOpened.width > 200 && chatOpened.height > 200
    && chatOpened.insideCanvas && chatOpened.braces === 2, JSON.stringify(chatOpened))
  await webContents.executeJavaScript(`document.querySelector('.static-tree-chip.as-chat .chat-close')?.click()`)
  await waitFor(webContents, `!document.querySelector('.static-tree-chip.as-chat')`)

  /* SINGLE CLICK OPENS THE RAIL — with real pointer input, not a synthetic
     .click(). This is the check the owner's request actually turns on: the
     chatbox and the controls were already built, and the only gesture that
     opened them was a double click nobody discovers. A dispatched MouseEvent
     would not prove it, because the click path runs through a 260ms timer that
     the real dblclick cancels; only driving the OS-level buttons exercises the
     same race a person does. */
  const singleClickTarget = await webContents.executeJavaScript(`(() => {
    const record = [...window.__mcGraph.nodes.values()].find(item => !item.el.hidden && !item.el.classList.contains('focusable'));
    const rect = record.el.getBoundingClientRect();
    return { id: record.id, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`)
  webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(singleClickTarget.x), y: Math.round(singleClickTarget.y) })
  await delay(40)
  webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(singleClickTarget.x), y: Math.round(singleClickTarget.y), button: 'left', clickCount: 1 })
  webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(singleClickTarget.x), y: Math.round(singleClickTarget.y), button: 'left', clickCount: 1 })
  await waitFor(webContents, `document.querySelector('.ctl-page.is-active .board-chat-box')`, 3000)
  const singleClick = await webContents.executeJavaScript(`(() => {
    const page = document.querySelector('.ctl-page.is-active');
    const chat = page?.querySelector('.board-chat-box');
    return {
      railOpen: Boolean(page),
      chatPresent: Boolean(chat),
      chatChannel: chat?.dataset?.chatChannel || null,
      chatVisible: chat ? getComputedStyle(chat).display !== 'none' && chat.getBoundingClientRect().height > 20 : false,
      namesTheAgent: page?.querySelector('.board-head .an')?.textContent?.trim() || null,
    };
  })()`)
  check('a single click opens the rail', singleClick.railOpen, JSON.stringify(singleClick))
  check('the rail a single click opens contains a chatbox', singleClick.chatPresent && singleClick.chatVisible, JSON.stringify(singleClick))
  check('the chatbox declares which channel it is on', Boolean(singleClick.chatChannel), JSON.stringify(singleClick))
  check('the rail names the clicked agent', Boolean(singleClick.namesTheAgent), JSON.stringify(singleClick))

  /* THE CONTROLS MUST NOT LIE. The three sliders that used to sit here —
     "Context budget", "Wake interval", "Autonomy" — moved, reported a value,
     and changed nothing. Their absence is asserted, and so is the presence of
     the replacement: a tier whose REAL argv fragment is printed, and a list of
     the knobs that do not exist with a reason for each. */
  const controls = await webContents.executeJavaScript(`(() => {
    const page = document.querySelector('.ctl-page.is-active');
    /* The stated absence lives inside the Start-work group now, behind the
       what-is-on-record box -- ask for it by its own class, not for the first
       .board-ctl-box on the rail. */
    const box = page?.querySelector('.board-ctl-absent');
    return {
      inertSliders: page ? page.querySelectorAll('.ctl-row[data-t]').length : -1,
      sliderLabels: [...(page?.querySelectorAll('.cl') || [])].map(node => node.textContent.trim()),
      /* The demonstration board must carry NO control that reaches a real
         session: launch, team and loop are ABSENT here by design and replaced
         by a stated-absence box. */
      steeringControls: page ? page.querySelectorAll('[data-launch], [data-team], [data-loop]').length : -1,
      absent: Boolean(box),
      absentCopy: box?.textContent?.replace(/\\s+/g, ' ').trim() || '',
    };
  })()`)
  check('no inert tuning slider survives on page 2', controls.inertSliders === 0
    && !controls.sliderLabels.includes('Context budget')
    && !controls.sliderLabels.includes('Wake interval')
    && !controls.sliderLabels.includes('Autonomy'), JSON.stringify(controls))
  /* RECONCILED 2026-08-11. These three checks used to demand a LIVE launch box
     on the simulated board -- the tier dropdown offering the engine tiers, the
     printed argv, the run-cap control, the unsupported-control citations. That
     is exactly the control dd01899 removed and tools/example-page-write-fence-qa.mjs
     (green) forbids on the example copy of page 2, whose own banner says nothing
     on it is real: a Dispatch/tier control here reaches the audited bridge from a
     demonstration screen. The launch box's real content is proven on the LIVE
     board -- present there by example-page-write-fence-qa's live half, exercised
     by tools/team-panel-packaged-qa.mjs and tools/loop-packaged-qa.mjs -- and the
     engine tiers, argv fragments and caps are pinned by
     tools/test/orchestration-controls.test.mjs, tools/test/agent-teams.test.mjs
     and tools/test/agent-loops.test.mjs. So the invariant asserted here is the
     safe one: on the demonstration board those controls are absent, and the
     absence is stated rather than left as a hole. */
  check('the demonstration board mounts no launch, team or loop control',
    controls.steeringControls === 0, JSON.stringify(controls))
  check('and it states that absence rather than leaving a hole',
    controls.absent && /nothing here starts anything/i.test(controls.absentCopy), JSON.stringify(controls))

  /* A dead button must say it is dead. Pause/Resume/Respawn have no bridge
     action behind them; they used to move an `armed` class between each other
     and look alive. */
  const deadButtons = await webContents.executeJavaScript(`(() => {
    const buttons = [...document.querySelectorAll('.ctl-page.is-active .board-actions .ctl-btn[data-a]')];
    return buttons.filter(button => button.dataset.a !== 'open').map(button => ({
      id: button.dataset.a, disabled: button.disabled, reason: (button.getAttribute('aria-label') || '').length,
    }));
  })()`)
  check('every action with nothing behind it is disabled and says why',
    deadButtons.length > 0 && deadButtons.every(button => button.disabled && button.reason > 20),
    JSON.stringify(deadButtons))

  await webContents.executeJavaScript(`document.querySelector('.ctl-page .rail-back').click()`)
  await waitFor(webContents, `document.querySelector('.stats-page.is-active')`)

  // Double-click contract and board order.
  await webContents.executeJavaScript(`document.querySelector('.static-tree-node').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))`)
  await waitFor(webContents, `document.querySelector('.ctl-page.is-active .board-chat-box .chat')`)
  const board = await webContents.executeJavaScript(`(() => {
    const page = document.querySelector('.ctl-page');
    /* The one rail per node (showProjectionControls): head, chat, the
       what-is-on-record box, the Start-work group, actions. The sim rail's
       uptime ring and synthesised activity chart went with the second render,
       so what is asserted about them below is their absence, not their
       styling. */
    const order = ['.board-head', '.board-chat-box', '.board-ctl-box', '[data-start-work-group]', '.board-actions']
      .map(selector => page.querySelector(selector));
    return {
      order: order.every(Boolean) && order.every((item, index) => index === 0
        || Boolean(order[index - 1].compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING)),
      chartPresent: Boolean(page.querySelector('.board-chart-box')),
      ringPresent: Boolean(page.querySelector('.agent-ring-wrap, .uring')),
    };
  })()`)
  check('double-click opens agent board in required order', board.order)
  check('the sim rail furniture stays gone: no synthesised chart, no uptime ring',
    board.chartPresent === false && board.ringPresent === false, JSON.stringify(board))
  await webContents.executeJavaScript(`document.querySelector('.ctl-page .rail-back').click()`)
  await waitFor(webContents, `document.querySelector('.stats-page.is-active')`)

  // Edit: empty-space offsets persist, Reset positions appears, and reset clears.
  await webContents.executeJavaScript(`(() => {
    const graph = window.__mcGraph;
    graph.__qaAddAgent = graph.addAgent.bind(graph);
    graph.__qaRemoveAgent = graph.removeAgent.bind(graph);
    graph.addAgent = () => {};
    graph.removeAgent = () => {};
  })()`)
  await webContents.executeJavaScript(`document.querySelector('.graph-edit-btn').click()`)
  await waitFor(webContents, `window.__mcGraph.editMode && window.__mcGraph.container.dataset.editMode === 'true'`)
  const blankDrag = await webContents.executeJavaScript(`(() => {
    const graph = window.__mcGraph;
    const records = [...graph.nodes.values()].filter(record => !record.el.hidden);
    const moving = records.find(record => record.agent.role === 'default');
    const fromRect = moving.el.getBoundingClientRect();
    const hostRect = graph.zoomHost.getBoundingClientRect();
    const from = { x: fromRect.left + fromRect.width / 2, y: fromRect.top + fromRect.height / 2 };
    const direction = from.x + 32 < hostRect.right - 24 ? 1 : -1;
    return {
      id: moving.id,
      from,
      to: { x: from.x + direction * 32, y: from.y },
      before: records.map(record => ({ id: record.id, x: record.x, y: record.y })),
    };
  })()`)
  let offsetState = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await drag(webContents, blankDrag.from, blankDrag.to)
    offsetState = await webContents.executeJavaScript(`(() => ({
      stored: JSON.parse(localStorage.getItem('mc.tree.pos.c1') || '{}'),
      resetVisible: !document.querySelector('.graph-reset-btn').hidden,
      positions: [...window.__mcGraph.nodes.values()].map(record => ({ id: record.id, x: record.x, y: record.y })),
    }))()`)
    if (offsetState.stored[blankDrag.id]) break
    const retry = await webContents.executeJavaScript(`(() => {
      const moving = window.__mcGraph.nodes.get(${JSON.stringify(blankDrag.id)});
      const rect = moving.el.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`)
    blankDrag.from = retry
    await delay(140)
  }
  const movedOnly = offsetState.positions.filter(after => {
    const before = blankDrag.before.find(item => item.id === after.id)
    return before && Math.hypot(after.x - before.x, after.y - before.y) > 1
  })
  check('empty-space drag stores slot offset', Boolean(offsetState.stored[blankDrag.id]) && offsetState.resetVisible, JSON.stringify(offsetState))
  check('empty-space drag moves only one node', movedOnly.length === 1 && movedOnly[0].id === blankDrag.id, JSON.stringify(movedOnly))
  await webContents.executeJavaScript(`document.querySelector('.graph-reset-btn').click()`)
  const resetState = await webContents.executeJavaScript(`({ stored: localStorage.getItem('mc.tree.pos.c1'), hidden: document.querySelector('.graph-reset-btn').hidden })`)
  check('Reset positions clears override and hides', resetState.stored === null && resetState.hidden, JSON.stringify(resetState))

  // Real pointer reparent onto a valid node, with cycle guard still in path.
  const reparent = await webContents.executeJavaScript(`(() => {
    const graph = window.__mcGraph;
    const finish = graph._finishEditDrag.bind(graph);
    graph._finishEditDrag = (record, start) => {
      window.__qaDrop = { child: record.id, target: graph._dropRec?.id || null, raw: graph._dropRaw?.id || null, x: record.x, y: record.y };
      return finish(record, start);
    };
    const records = [...graph.nodes.values()].filter(record => !record.el.hidden);
    let pair = null;
    let pairDistance = Infinity;
    for (const child of records) {
      for (const parent of records) {
        if (child === parent || child.agent.role === 'coordinator' || child.agent.parentId === parent.id) continue;
        if (graph._wouldCycle(child.agent, parent.agent)) continue;
        const childRect = child.el.getBoundingClientRect();
        const parentRect = parent.el.getBoundingClientRect();
        const distance = Math.hypot(
          childRect.left + childRect.width / 2 - parentRect.left - parentRect.width / 2,
          childRect.top + childRect.height / 2 - parentRect.top - parentRect.height / 2,
        );
        if (distance < pairDistance) { pair = { child, parent }; pairDistance = distance; }
      }
    }
    const childRect = pair.child.el.getBoundingClientRect();
    const parentRect = pair.parent.el.getBoundingClientRect();
    return {
      id: pair.child.id,
      parent: pair.parent.id,
      from: { x: childRect.left + childRect.width / 2, y: childRect.top + childRect.height / 2 },
      to: { x: parentRect.left + parentRect.width / 2, y: parentRect.top + parentRect.height / 2 },
    };
  })()`)
  let reparentState = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await drag(webContents, reparent.from, reparent.to)
    reparentState = await webContents.executeJavaScript(`({
      parent: document.querySelector('[data-agent-id=${JSON.stringify(reparent.id)}]').dataset.parentId,
      drop: window.__qaDrop,
      reverseWouldCycle: window.__mcGraph._wouldCycle(
        window.__mcGraph.nodes.get(${JSON.stringify(reparent.parent)}).agent,
        window.__mcGraph.nodes.get(${JSON.stringify(reparent.id)}).agent,
      ),
      hasOverride: window.__mcGraph.hasPositionOverrides(),
    })`)
    if (reparentState.parent === reparent.parent) break
    if (reparentState.hasOverride) await webContents.executeJavaScript(`window.__mcGraph.resetPositions()`)
    const retry = await webContents.executeJavaScript(`(() => {
      const child = window.__mcGraph.nodes.get(${JSON.stringify(reparent.id)}).el.getBoundingClientRect();
      const parent = window.__mcGraph.nodes.get(${JSON.stringify(reparent.parent)}).el.getBoundingClientRect();
      return {
        from: { x: child.left + child.width / 2, y: child.top + child.height / 2 },
        to: { x: parent.left + parent.width / 2, y: parent.top + parent.height / 2 },
      };
    })()`)
    reparent.from = retry.from
    reparent.to = retry.to
    await delay(140)
  }
  check('drag-onto-node reparents', reparentState.parent === reparent.parent, `${JSON.stringify(reparentState)} expected ${reparent.parent}`)
  check('cycle guard rejects reverse ancestry', reparentState.reverseWouldCycle === true)
  await webContents.executeJavaScript(`document.querySelector('.graph-edit-btn').click()`)

  // Raise the simulated fleet to the dense threshold, then exercise drill and return.
  await webContents.executeJavaScript(`(() => {
    const graph = window.__mcGraph;
    graph.addAgent = graph.__qaAddAgent;
    graph.removeAgent = graph.__qaRemoveAgent;
    for (const agent of graph.computer.agents) {
      if (!graph.nodes.has(agent.id)) graph.addAgent(agent);
    }
    let index = 0;
    while (graph.computer.agents.length < 12) {
      const parent = graph.computer.agents.find(agent => agent.role === 'manager');
      const agent = {
        id: 'qa-drill-' + index, name: 'qa drill ' + index, role: 'default', parentId: parent.id,
        bornAt: Date.now(), state: 'active', model: 'qa', pool: 'qa', context: [], tasksDone: 0, failRate: 0,
      };
      index += 1;
      graph.computer.agents.push(agent);
      graph.addAgent(agent);
    }
    graph.updateDensity();
  })()`)
  await waitFor(webContents, `document.querySelector('.static-tree-node.focusable')`)
  window.setPosition(-2400, -1400)
  window.showInactive()
  await delay(120)
  /* RE-ESTABLISH THE PRECONDITION AFTER THE ACTION THAT INVALIDATES IT.
     Showing and moving the window gives the graph container a real measured
     size for the first time in this run, which re-runs the layout: culling and
     `_layoutVisibleIds` change, so `updateDensity()` recomputes `active`,
     `candidates` and `deepest` and can take the `focusable` class off every
     node for a moment. The old code waited for `.focusable` BEFORE the show and
     then read it AFTER, so it depended on a fact the intervening action was
     free to invalidate -- measured as a null querySelector on 1 run in 15 under
     five-way concurrency. Waiting again here asserts the state at the moment it
     is used. */
  await waitFor(webContents, `document.querySelector('.static-tree-node.focusable')`)
  /* READ THE NODE AND CLICK IT IN ONE EVALUATION.
     These were two separate executeJavaScript round-trips, each running its own
     `document.querySelector('.static-tree-node.focusable')`. Between them the
     simulated fleet can tick: updateDensity() re-toggles the `focusable` class
     and _removeRecord() clears a node's pending click timer, so the id that was
     read and the node that was clicked were not required to be the same node --
     and if the clicked one was re-rendered inside the 260ms single-click timer,
     no click landed at all. Either way the wait below timed out with
     "Timed out waiting for window.__mcGraph.rootId === ..." and nothing said
     why. One evaluation makes the id and the gesture the same node by
     construction, which is a fix to the race rather than a retry around it. */
  const drill = await webContents.executeJavaScript(`(() => {
    const node = document.querySelector('.static-tree-node.focusable');
    const graph = window.__mcGraph;
    /* Diagnostics either way: a null here used to surface as a bare TypeError
       on .dataset, or as a rootId timeout with nothing said about density. */
    const state = {
      nodes: graph.nodes.size,
      agents: graph.computer.agents.length,
      focusableCount: document.querySelectorAll('.static-tree-node.focusable').length,
      drillRequired: Boolean(graph._layoutResult && graph._layoutResult.drillRequired),
      rootId: graph.rootId,
    };
    if (!node) return { id: null, state };
    const id = node.dataset.agentId;
    node.click();
    return { id, state };
  })()`)
  const drillId = drill.id
  check('the dense fleet offers a focusable node to drill into', Boolean(drillId), JSON.stringify(drill.state))
  await waitFor(webContents, `window.__mcGraph.rootId === ${JSON.stringify(drillId)}`)
  await delay(760)
  const drillState = await webContents.executeJavaScript(`({
    root: window.__mcGraph.rootId,
    crumb: document.querySelector('.graph-crumb').textContent.trim(),
    frameMs: window.__graphFrameMs,
    rerooting: Boolean(document.querySelector('.node.rerooting')),
  })`)
  /* R1198: the 680ms re-root glide is gone. The owner asked for no required
     motion, and that glide re-ran the chip placement search on every frame to
     decorate a click. The drill now lands immediately, so the assertion is
     that it settles at once — frameMs stays 0 because no frame loop runs. */
  check('drill-down lands immediately and settles', drillState.root === drillId && drillState.crumb && drillState.frameMs === 0 && !drillState.rerooting, JSON.stringify(drillState))
  const crumbClicked = await webContents.executeJavaScript(`(() => { const button = document.querySelector('.graph-crumb button'); if (!button) return false; button.click(); return true })()`)
  check('breadcrumb return control is clickable', crumbClicked)
  await waitFor(webContents, `window.__mcGraph.rootId === null`)
  await delay(760)
  const reducedMotion = await webContents.executeJavaScript(`(() => {
    const graph = window.__mcGraph;
    document.body.classList.add('reduce-motion');
    const target = ${JSON.stringify(drillId)};
    graph.setRoot(target);
    const instant = graph.rootId === target && graph._animationRaf === 0 && !document.querySelector('.node.rerooting');
    graph.clearRoot();
    document.body.classList.remove('reduce-motion');
    return { target, instant, returned: graph.rootId === null && graph._animationRaf === 0 };
  })()`)
  check('reduce-motion makes drill and return instant', Boolean(reducedMotion.target) && reducedMotion.instant && reducedMotion.returned, JSON.stringify(reducedMotion))
  window.hide()

  /* THE SEAM BETWEEN PAGE 2 AND THE DRILL-IN, which is all this block is for.
     Page 2's "Open full view" navigates to #/agent/<compId>/<agentId>, so this
     harness has to know that the route still lands on something. It used to
     assert FleetGraph and a .graph-canvas node; the drill-in was rewritten and
     no longer mounts FleetGraph at all, so that contract was checking for a
     thing that is deliberately gone. Measured RED on an unchanged tree before
     this lane changed anything — an instrument asserting a retired contract
     manufactures a kill, so it is corrected rather than carried.

     What is asserted is only what the drill-in promises: the route resolves and
     the roster mounts with at least one card. `selected` is captured as
     DIAGNOSTIC DETAIL and deliberately not asserted — which card the drill-in
     selects is that page's decision, not this seam's, and asserting it from
     here would plant a red in someone else's territory. */
  await webContents.executeJavaScript(`location.hash = '#/agent/c1/codex'`)
  await waitFor(webContents, `document.querySelector('.agentv .ar-card')`)
  await delay(500)
  const agentView = await webContents.executeJavaScript(`({
    rosterMounted: Boolean(document.querySelector('.agentv .agent-roster')),
    cardCount: document.querySelectorAll('.agentv .ar-card').length,
    selected: document.querySelector('.agentv .ar-card.is-selected')?.dataset?.agentId || null,
  })`)
  check('page 2 "Open full view" still lands on a mounted agent detail',
    agentView.rosterMounted && agentView.cardCount >= 1, JSON.stringify(agentView))
  fs.writeFileSync(path.join(outputDir, 'agent-detail-tan-1600x900.png'), (await webContents.capturePage()).toPNG())

  check('renderer emitted no errors', rendererErrors.length === 0, rendererErrors.join(' | '))
  window.destroy()
  server.close()
  server.closeAllConnections?.()
  return { outputDir, results }
}

app.whenReady().then(async () => {
  try {
    const report = await run()
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    app.quit()
  } catch (error) {
    process.stderr.write(`${error.stack || error}\n${JSON.stringify(results, null, 2)}\n`)
    app.exit(1)
  }
})
