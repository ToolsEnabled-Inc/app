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
const {
  SHELL_HOST,
  SHELL_PORT_MIN,
  SHELL_PORT_MAX,
  SHELL_PORTS,
  listenOnFirstFreePort,
} = require('./port-scan.cjs')

const DIST = path.join(__dirname, '..', 'dist')
const TITLEBAR_H = 36
/* Bounded, not ephemeral: the action bridge authorizes exact origins only in
   4600-4609. Scanning 4601-4609 is safe because every candidate remains in
   that allowlist; listen(0) could choose an unauthorized, drifting origin
   every launch (R1137 known issue). */

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
    const reportFailure = (err) => {
      const { dialog } = require('electron')
      const detail = err && err.code === 'SHELL_PORT_RANGE_EXHAUSTED'
        ? `All shell ports ${SHELL_PORT_MIN}-${SHELL_PORT_MAX} are in use or unavailable — other Mission Control shells (or stray servers) are holding them. Close them and relaunch.`
        : String(err)
      dialog.showErrorBox('Mission Control could not start', detail)
      app.exit(1)
    }
    listenOnFirstFreePort(server, SHELL_PORTS, SHELL_HOST).then(() => {
      server.on('error', reportFailure)
      resolve(server)
    }, reportFailure)
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
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()
app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus() }
})
app.on('window-all-closed', () => app.quit())
