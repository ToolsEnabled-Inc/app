// Desktop shell: serves the built dist/ over loopback HTTP (file:// would
// break fetch() and the router's absolute asset paths) and hosts it in a
// frameless window with native Windows caption buttons drawn over our own
// titlebar strip — the VSCode arrangement: the app owns the top strip, the
// OS owns min/max/close (which keeps Win11 snap layouts on the maximize
// button for free).
const { app, BrowserWindow, ipcMain, nativeTheme, Menu } = require('electron')
const http = require('http')
const path = require('path')
const fs = require('fs')
const { randomUUID } = require('crypto')
const { createAgentHost } = require('./agent-host.cjs')

const DIST = path.join(__dirname, '..', 'dist')
const TITLEBAR_H = 36
/* Fixed, not ephemeral: the action bridge authorizes by exact origin, and a
   listen(0) port gave the app a different origin every launch (R1137 known
   issue). EADDRINUSE is a loud failure by design — a silent fallback port
   would just recreate the drifting-origin bug with extra steps. */
const SHELL_PORT = 4601

const AGENT_EVENT_CHANNEL = 'mc-agent:event'
const MAX_AGENT_SESSIONS = 8
const MAX_SESSION_ID_LENGTH = 128
const MAX_CWD_LENGTH = 32_768
const MAX_SURFACE_LENGTH = 64
const MAX_TURN_TEXT_LENGTH = 200_000

const agentSessions = new Map()
const boundAgentOwners = new WeakSet()
let agentHost = null
let removeAgentEventListener = null
let agentShutdownPromise = null
let agentShutdownComplete = false

function agentIpcError(code, message) {
  const error = new Error(message)
  error.code = code
  throw error
}

function agentPayload(value, allowedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    agentIpcError('MC_AGENT_INVALID_PAYLOAD', 'Agent IPC payload must be an object')
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      agentIpcError('MC_AGENT_INVALID_PAYLOAD', 'Unexpected agent IPC field: ' + key)
    }
  }
  return value
}

function boundedAgentString(value, name, maxLength) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength || value.includes('\0')) {
    agentIpcError(
      'MC_AGENT_INVALID_PAYLOAD',
      name + ' must be a non-empty string of at most ' + maxLength + ' characters',
    )
  }
  return value
}

function parseAgentStart(value) {
  const payload = agentPayload(value, ['sessionId', 'cwd', 'surface'])
  const sessionId = Object.prototype.hasOwnProperty.call(payload, 'sessionId')
    ? payload.sessionId
    : `chat-${randomUUID()}`
  const result = {
    sessionId: boundedAgentString(sessionId, 'sessionId', MAX_SESSION_ID_LENGTH),
  }
  if (payload.cwd !== undefined) {
    result.cwd = boundedAgentString(payload.cwd, 'cwd', MAX_CWD_LENGTH)
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'surface')) {
    boundedAgentString(payload.surface, 'surface', MAX_SURFACE_LENGTH)
  }
  return result
}

function parseAgentSend(value) {
  const payload = agentPayload(value, ['sessionId', 'text'])
  return {
    sessionId: boundedAgentString(payload.sessionId, 'sessionId', MAX_SESSION_ID_LENGTH),
    text: boundedAgentString(payload.text, 'text', MAX_TURN_TEXT_LENGTH),
  }
}

function parseAgentSessionCommand(value) {
  const payload = agentPayload(value, ['sessionId'])
  return {
    sessionId: boundedAgentString(payload.sessionId, 'sessionId', MAX_SESSION_ID_LENGTH),
  }
}

function ownedAgentSession(sender, sessionId) {
  const session = agentSessions.get(sessionId)
  if (!session || session.owner !== sender) {
    agentIpcError('MC_AGENT_UNKNOWN_SESSION', 'Unknown sessionId: ' + sessionId)
  }
  return session
}

function reportOwnerCloseFailure(sessionId, error) {
  console.error('Failed to close Codex session ' + sessionId + ':', error)
}

function bindAgentOwner(owner) {
  if (boundAgentOwners.has(owner)) return
  boundAgentOwners.add(owner)
  owner.once('destroyed', () => {
    const closing = []
    for (const [sessionId, session] of agentSessions) {
      if (session.owner !== owner) continue
      agentSessions.delete(sessionId)
      if (agentHost) {
        closing.push(
          agentHost.closeSession({ sessionId })
            .catch(error => reportOwnerCloseFailure(sessionId, error)),
        )
      }
    }
    if (closing.length) void Promise.allSettled(closing)
  })
}

function getAgentHost() {
  if (agentHost) return agentHost
  const host = createAgentHost({ defaultCwd: path.join(__dirname, '..') })
  removeAgentEventListener = host.onEvent((packet) => {
    const session = agentSessions.get(packet.sessionId)
    if (!session || session.owner.isDestroyed()) return
    try {
      session.owner.send(AGENT_EVENT_CHANNEL, packet)
    } catch {
      // Destruction can race this check; the owner cleanup closes the session.
    }
  })
  agentHost = host
  return host
}

ipcMain.handle('mc-agent:start', async (event, value) => {
  const request = parseAgentStart(value)
  if (agentSessions.has(request.sessionId)) {
    agentIpcError('MC_AGENT_SESSION_EXISTS', 'Session already exists: ' + request.sessionId)
  }
  if (agentSessions.size >= MAX_AGENT_SESSIONS) {
    agentIpcError('MC_AGENT_SESSION_LIMIT', 'At most ' + MAX_AGENT_SESSIONS + ' agent sessions may be open')
  }

  const session = { owner: event.sender, state: 'starting' }
  agentSessions.set(request.sessionId, session)
  bindAgentOwner(event.sender)
  try {
    const result = await getAgentHost().startSession(request)
    session.state = 'ready'
    return result
  } catch (error) {
    if (error && error.code === 'AGENT_SESSION_CLEANUP_FAILED') {
      session.state = 'close-failed'
    } else if (agentSessions.get(request.sessionId) === session) {
      agentSessions.delete(request.sessionId)
    }
    throw error
  }
})

ipcMain.handle('mc-agent:send', async (event, value) => {
  const request = parseAgentSend(value)
  ownedAgentSession(event.sender, request.sessionId)
  return agentHost.sendTurn(request)
})

ipcMain.handle('mc-agent:interrupt', async (event, value) => {
  const request = parseAgentSessionCommand(value)
  ownedAgentSession(event.sender, request.sessionId)
  return agentHost.interrupt(request)
})

ipcMain.handle('mc-agent:close', async (event, value) => {
  const request = parseAgentSessionCommand(value)
  const session = ownedAgentSession(event.sender, request.sessionId)
  const result = await agentHost.closeSession(request)
  if (agentSessions.get(request.sessionId) === session) {
    agentSessions.delete(request.sessionId)
  }
  return result
})

/* Boot theme for the first frame: the renderer reports live colours the
   moment it paints, but the window background and caption buttons exist
   BEFORE that — read the persisted theme from the shell's own copy so a
   black-theme user never sees a white flash behind the chrome. */
const STATE_FILE = () => path.join(app.getPath('userData'), 'shell-state.json')
const THEME_SEED = {
  // measured from the live page per theme (body bg / ink), not guessed
  white: { bg: '#f7f8fa', ink: '#0e1726' },
  tan: { bg: '#f2e5bc', ink: '#282828' },
  black: { bg: '#0d0f12', ink: '#eef2f6' },
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8')) } catch { return {} }
}
function writeState(patch) {
  try {
    fs.writeFileSync(STATE_FILE(), JSON.stringify({ ...readState(), ...patch }))
  } catch { /* state is comfort, not correctness */ }
}

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon',
}

function serveDist() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent((req.url || '/').split('?')[0])
      let file = path.normalize(path.join(DIST, url === '/' ? 'index.html' : url))
      // the hash router means every real navigation is still index.html
      if (!file.startsWith(DIST)) { res.writeHead(403); return res.end() }
      fs.readFile(file, (err, data) => {
        if (err) {
          // unknown paths fall back to the app shell, same as any SPA host
          return fs.readFile(path.join(DIST, 'index.html'), (e2, index) => {
            if (e2) { res.writeHead(404); return res.end() }
            res.writeHead(200, { 'content-type': 'text/html' })
            res.end(index)
          })
        }
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' })
        res.end(data)
      })
    })
    server.on('error', (err) => {
      const { dialog } = require('electron')
      const detail = err && err.code === 'EADDRINUSE'
        ? `Port ${SHELL_PORT} is already in use — another Mission Control shell (or a stray server) is holding it. Close it and relaunch.`
        : String(err)
      dialog.showErrorBox('Mission Control could not start', detail)
      app.exit(1)
    })
    server.listen(SHELL_PORT, '127.0.0.1', () => resolve(server))
  })
}

let win = null

async function createWindow() {
  const state = readState()
  const seed = THEME_SEED[state.theme] || THEME_SEED.white
  const server = await serveDist()
  const port = server.address().port

  win = new BrowserWindow({
    width: state.width || 1440,
    height: state.height || 900,
    x: state.x, y: state.y,
    minWidth: 980, minHeight: 640,
    backgroundColor: seed.bg,
    icon: path.join(__dirname, 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: seed.bg, symbolColor: seed.ink, height: TITLEBAR_H },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.setMenuBarVisibility(false)
  if (state.maximized) win.maximize()

  // the menu is gone (clean chrome), so keep its two useful accelerators
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return
    if (input.key === 'F12') { win.webContents.toggleDevTools(); e.preventDefault() }
    if (input.control && input.key.toLowerCase() === 'r') { win.webContents.reload(); e.preventDefault() }
  })

  const persistBounds = () => {
    if (!win) return
    const b = win.getNormalBounds()
    writeState({ x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() })
  }
  win.on('resized', persistBounds)
  win.on('moved', persistBounds)
  win.on('maximize', persistBounds)
  win.on('unmaximize', persistBounds)
  win.on('closed', () => { win = null })

  await win.loadURL(`http://127.0.0.1:${port}/`)
}

/* The renderer reports its REAL composited surface colours whenever the
   theme flips — the caption buttons and window background follow the app,
   never the other way round. */
ipcMain.on('mc-theme', (_e, { theme, bg, ink }) => {
  if (!win) return
  try {
    win.setTitleBarOverlay({ color: bg, symbolColor: ink, height: TITLEBAR_H })
    win.setBackgroundColor(bg)
  } catch { /* overlay API can reject mid-close; nothing to recover */ }
  nativeTheme.themeSource = theme === 'black' ? 'dark' : 'light'
  writeState({ theme })
})

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  createWindow()
})

app.on('before-quit', (event) => {
  if (!agentHost || agentShutdownComplete) return
  event.preventDefault()
  if (agentShutdownPromise) return

  const host = agentHost
  agentSessions.clear()
  agentShutdownPromise = host.closeAll()
    .catch(error => console.error('Failed to close all Codex sessions:', error))
    .finally(() => {
      if (removeAgentEventListener) removeAgentEventListener()
      removeAgentEventListener = null
      agentHost = null
      agentShutdownComplete = true
      app.quit()
    })
})
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()
app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus() }
})
app.on('window-all-closed', () => app.quit())
