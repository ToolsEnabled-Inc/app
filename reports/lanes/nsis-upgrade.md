# Lane: nsis-upgrade (session 6e870ec4)

Tree: `C:\Users\joshp\Desktop\wt-capability` (branch `packaging/capability-layer`).
No git write commands. Working-tree edits only.

Task: the upgrade deletes the user's vault. installUtil.nsh runs the old
uninstaller first; uninstaller.nsh does `RMDir /r $INSTDIR`; a defective build
wrote the vault into `$INSTDIR\resources\capability\vault`, so the next upgrade
wipes it. Add a customInit/customUnInit hook (build/installer.nsh) that preserves
user data across upgrade.

## What I found (NSIS flow, read from node_modules/app-builder-lib templates)

- `.onInit` (installer.nsi): `check64BitAndSetRegView` -> `initMultiUser` ->
  `customInit`. By the time customInit runs, `initMultiUser`
  (multiUser.nsh setInstallModePerUser) has read HKCU InstallLocation and set
  `$INSTDIR` to the EXISTING install dir, and set shell-var context `current`.
- The install Section (installSection.nsh:52) then runs `uninstallOldVersion`,
  which invokes the OLD uninstaller with `/KEEP_APP_DATA --updated`; that
  uninstaller's Section reaches `RMDir /r $INSTDIR` (uninstaller.nsh:187).
- So customInit is the last moment the old build's data is still on disk and the
  new installer is running. The app-side rescue (adoptLegacyPayloadState,
  capability/src/lib/runtime-state-root.js) cannot help: `$INSTDIR` is gone
  before the new app's first line runs. check-install-dir-immutable phase D says
  exactly this and names build/installer.nsh customInit as the fix.
- electron-builder auto-includes `build/installer.nsh`: NsisTarget.js:600
  `getResource(this.options.include, "installer.nsh")`; with `nsis.include`
  unset, getResource falls back to the buildResources dir (`build/`). So NO
  package.json change is required to wire the hook.
- Destination = `$APPDATA\${PRODUCT_NAME}\capability`. That equals
  `app.getPath('userData')\capability` (shell/main.cjs:125 CAPABILITY_STATE_ROOT):
  Electron uses productName verbatim for userData, electron-builder defines
  PRODUCT_NAME as the same productName ("ToolsEnabled").

## What I changed

- **build/installer.nsh (NEW):** `customInit` copies each runtime-state
  directory (state, logs, vault, captures, profiles, reports) from
  `$INSTDIR\resources\capability\<d>` to `$APPDATA\${PRODUCT_NAME}\capability\<d>`,
  guarded so it copies only when the source exists AND the destination does not
  (never-overwrite: a fixed build's current data outranks a stale install-dir
  copy). `customUnInit` repeats it as defense-in-depth for future builds, gated
  on `${isUpdated}` so a genuine uninstall is untouched. Copy-only; the install
  dir is never modified (the old uninstaller deletes it anyway).
- **tools/test/nsis-upgrade-rescue.test.mjs (NEW):** proves the logic without a
  NSIS toolchain (makensis is not installed here; no electron-builder NSIS
  cache). It (1) asserts the real build/installer.nsh has the exact source/dest
  paths, the never-overwrite guard, and a rescue list that equals
  RUNTIME_STATE_DIRECTORIES in the shipped module; (2) runs a faithful model of
  the macro across the full sequence -- rescue, then `RMDir /r $INSTDIR` -- and
  asserts a seeded vault survives byte-for-byte in the state root, plus
  never-overwrite, fail-closed-on-absence, and fresh-install cases.

## Reasoning re check-install-dir-immutable (the gate)

- The gate is orthogonal to this hook and is not regressed by it. build/ is NOT
  in package.json `files`/`extraResources`, so installer.nsh is never packaged
  into `resources/capability`; the gate's phase-0 source sweep of the payload
  cannot see it. The rescue writes only to `$APPDATA\...`, never to the install
  dir, so the gate's before/after hash of the install dir is unaffected.
- The gate reaching exit 0 on a rebuilt artifact is governed by the state-root
  relocation + the .ps1 helper fixes (staged by the upgrade-path lane, which
  measured exit 0 on the rebuilt/fixed artifact and exit 1 on the shipped stale
  one). Rebuilding is the coordinator's `npm run dist` step, outside this lane's
  no-build/no-git scope. This hook does not change that outcome.

## Evidence (re-run against the current tree immediately before reporting)

- `node --test tools/test/nsis-upgrade-rescue.test.mjs` (PowerShell): 8/8 pass,
  exit 0, ~222 ms.
- `node --test` nsis-upgrade + userdata-adoption + installer-product-identity +
  durable-storage: 64/64 pass, exit 0, ~859 ms.
- `node tools/check-suites-discovered.mjs`: 92/92 suites reached, exit 0
  (new suite is discovered by the runner glob).
- List parity dumped: installer ["state","logs","vault","captures","profiles",
  "reports"] == app RUNTIME_STATE_DIRECTORIES (identical).

## What a real round-trip would still need (not runnable here)

makensis actually compiling installer.nsh (no undefined symbol / typo);
${PRODUCT_NAME} expanding to the same folder Electron uses for userData; the
shell-var context being `current` at customInit; and CopyFiles/SHFileOperation
copying subdirectories as the model assumes. Those are asserted by construction
and by reading the template flow, not executed. A genuine proof is:
`npm run dist` on a machine with the electron-builder NSIS toolchain, install
v1.0.5-defective, seed a vault under the install dir, then install v1.0.6 over
it and confirm the vault appears under `%APPDATA%\ToolsEnabled\capability\vault`.
