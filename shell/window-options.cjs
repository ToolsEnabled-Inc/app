/* Testing affordance, deliberately narrow.
 *
 * DEFAULT (MC_SMOKE_HEADLESS unset, or any value other than the exact string
 * '1'): returns {} — NOTHING is added to the BrowserWindow options, so shipping
 * behaviour is byte-for-byte what it was before this file existed. The window
 * shows normally. That default is asserted by
 * tools/test/window-options.test.mjs with a deepEqual against {}, so if anyone
 * ever flips it, that test goes red rather than the change reaching a user.
 *
 * WHEN MC_SMOKE_HEADLESS === '1': returns { show: false }, so the packaged
 * smoke gate can start the real application -- HTTP server, port scan, loadURL
 * all unchanged -- without putting a window on the owner's desktop. Node's
 * spawn `windowsHide` only suppresses a child's CONSOLE window and has no
 * effect on a BrowserWindow, which is why this has to live in the app.
 *
 * This is not a supported user-facing mode and is not documented for users.
 */
function headlessWindowOptions(env = process.env) {
  return env && env.MC_SMOKE_HEADLESS === '1' ? { show: false } : {}
}

module.exports = { headlessWindowOptions }
