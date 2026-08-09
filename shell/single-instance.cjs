function wireSingleInstance({
  requestLock,
  quit,
  whenReady,
  onSecondInstance,
  getWindow,
  start,
}) {
  const gotLock = requestLock()
  if (!gotLock) {
    quit()
    return false
  }

  whenReady().then(start)
  onSecondInstance(() => {
    const win = getWindow()
    if (win) { if (win.isMinimized()) win.restore(); win.focus() }
  })
  return true
}

module.exports = { wireSingleInstance }
