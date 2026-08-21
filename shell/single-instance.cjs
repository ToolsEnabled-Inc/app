function wireSingleInstance({
  requestLock,
  quit,
  whenReady,
  onSecondInstance,
  getWindow,
  start,
  onStartFailure,
}) {
  const gotLock = requestLock()
  if (!gotLock) {
    quit()
    return false
  }

  void whenReady().then(start).catch(onStartFailure)
  onSecondInstance(() => {
    const win = getWindow()
    if (win) { if (win.isMinimized()) win.restore(); win.focus() }
  })
  return true
}

module.exports = { wireSingleInstance }
