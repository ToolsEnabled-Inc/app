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
    if (!expectedDiscoveryMiss && (level >= 3 || event.level === 'error')) {
      rendererErrors.push(message)
      results.push({ name: 'renderer console', pass: false, detail: message })
    }
  })

  await window.loadURL(`${origin}/`)
  await webContents.executeJavaScript(`
    localStorage.setItem('mc.live.computers', 'simulated');
    localStorage.setItem('mc.live.agent', 'simulated');
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
  await delay(900)

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
      idleRafCallbacks: window.__qaRafCount,
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
      runningAnimations: document.getAnimations().filter(animation => animation.playState === 'running'
        && animation.effect?.target instanceof Element
        && animation.effect.target.closest?.('.computers')
        && !animation.effect.target.closest('.tree-node-adding, .tree-node-removing')).map(animation => ({
          target: animation.effect.target.className,
          animationName: getComputedStyle(animation.effect.target).animationName,
          type: animation.constructor.name,
        })),
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
  check('statistics order', JSON.stringify(initial.sections) === JSON.stringify(['Load', 'Tasks', 'Legend']), initial.sections.join(','))

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
  check('no idle requestAnimationFrame callbacks', initial.idleRafCallbacks === 0, String(initial.idleRafCallbacks))
  check('no settled Page 2 CSS animation', initial.runningAnimations.length === 0, JSON.stringify(initial.runningAnimations))

  // Theme screenshots: the requested tan-first order is load-bearing.
  window.setPosition(80, 80)
  window.showInactive()
  await delay(500)
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
  check('context chip opens chat', true)
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
    const box = page?.querySelector('.board-ctl-box');
    return {
      inertSliders: page ? page.querySelectorAll('.ctl-row[data-t]').length : -1,
      sliderLabels: [...(page?.querySelectorAll('.cl') || [])].map(node => node.textContent.trim()),
      /* The demonstration board must carry NO control that reaches a real
         session: launch, team and loop are ABSENT here by design and replaced
         by a stated-absence box. */
      steeringControls: page ? page.querySelectorAll('[data-launch], [data-team], [data-loop]').length : -1,
      absent: Boolean(box?.classList.contains('board-ctl-absent')),
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
    const order = ['.board-head', '.agent-ring-wrap', '.board-chat-box', '.board-chart-box', '.board-ctl-box', '.board-actions']
      .map(selector => page.querySelector(selector));
    return {
      order: order.every(Boolean) && order.every((item, index) => index === 0
        || Boolean(order[index - 1].compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING)),
      chartGradientCount: page.querySelectorAll('.board-chart-box linearGradient, .board-chart-box radialGradient').length,
      ringGlowDisplay: getComputedStyle(page.querySelector('.uring .arc-glow')).display,
    };
  })()`)
  check('double-click opens agent board in required order', board.order)
  check('board chart is flat and ring glow is removed', board.chartGradientCount === 0 && board.ringGlowDisplay === 'none', JSON.stringify(board))
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
  const drillId = await webContents.executeJavaScript(`document.querySelector('.static-tree-node.focusable').dataset.agentId`)
  await webContents.executeJavaScript(`document.querySelector('.static-tree-node.focusable').click()`)
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
