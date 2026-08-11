# build/installer.nsh -- custom electron-builder NSIS hooks.
#
# HOW THIS FILE IS WIRED IN. electron-builder resolves the custom include with
# PlatformPackager.getResource(nsis.include, "installer.nsh"). When nsis.include
# is unset (it is), getResource falls back to the buildResources directory --
# `build/` by default -- and picks up any file named installer.nsh there. So this
# file is included automatically, with no package.json change. It is compiled
# into BOTH passes of the generated script: the installer and, under
# BUILD_UNINSTALLER, the uninstaller.
#
# WHERE customInit RUNS, AND WHY THAT IS THE ONE MOMENT THAT CAN SAVE THE DATA.
# The generated .onInit (app-builder-lib templates/nsis/installer.nsi) runs, in
# order: check64BitAndSetRegView -> initMultiUser -> customInit. initMultiUser
# (templates/nsis/multiUser.nsh setInstallModePerUser) has, by the time customInit
# runs, read HKCU Software\<APP_GUID> InstallLocation and set $INSTDIR to the
# EXISTING per-user install directory, and set the shell-var context to `current`.
# Only afterwards does the install Section run:
#     installSection.nsh -> uninstallOldVersion  (runs the OLD uninstaller)
#     old uninstaller     -> `RMDir /r $INSTDIR`  (uninstaller.nsh)
#
# THE DEFECT. A build shipped before the state-root relocation wrote the
# customer's runtime state -- their VAULT (resources\capability\vault\secrets.json)
# and the signed audit ledger (resources\capability\state\audit.sqlite3) -- into
# its own install directory. On upgrade the new installer runs the old uninstaller
# first, and `RMDir /r $INSTDIR` deletes that directory before the new
# application's first line executes. That is why the application-side rescue
# (adoptLegacyPayloadState in capability/src/lib/runtime-state-root.js, exercised
# by check-install-dir-immutable phase D) can never fire on a real NSIS upgrade:
# by the time the app looks, the directory is already gone. The only actor still
# standing between "old build's data is present" and "old build's data is deleted"
# is THIS installer, in customInit, before uninstallOldVersion.
#
# WHAT customInit DOES. It copies the legacy runtime-state directories out of the
# still-present $INSTDIR to the per-user state root the new application reads
# from: <APPDATA>\<PRODUCT_NAME>\capability, which is app.getPath('userData')
# joined with 'capability' (shell/main.cjs CAPABILITY_STATE_ROOT). Electron uses
# productName verbatim for userData, and electron-builder defines PRODUCT_NAME as
# the same productName, so the two name the same directory. The install directory
# is NOT modified -- the old uninstaller deletes it regardless -- so the rescue is
# a pure copy out.
#
# IT NEVER OVERWRITES. A state-root directory that already holds data means the
# customer already ran a fixed build; that data is theirs and current, and it
# outranks anything left in the install directory. So each directory is copied
# only when the source exists AND the destination does not -- create-or-skip, the
# same rule adoptLegacyPayloadState applies per-file with COPYFILE_EXCL. A missing
# source rescues nothing and never fabricates an empty vault (fail closed).

!ifndef TOOLSENABLED_RESCUE_INCLUDED
!define TOOLSENABLED_RESCUE_INCLUDED

# The runtime-state directory names, kept in lockstep with
# RUNTIME_STATE_DIRECTORIES in capability/src/lib/runtime-state-root.js.
# tools/test/nsis-upgrade-rescue.test.mjs fails if the two lists diverge, so a
# new state directory added on the application side cannot be silently forgotten
# here -- which would be exactly this defect again for that directory.
!macro RescueOneStateDir Dir
  # $R4 = legacy source under the (still-present) install directory
  # $R5 = destination under the per-user state root the new app reads
  StrCpy $R4 "$INSTDIR\resources\capability\${Dir}"
  StrCpy $R5 "$APPDATA\${PRODUCT_NAME}\capability\${Dir}"
  # Copy only when the old install has this directory (non-empty) AND the state
  # root does not already have it. The second test is the never-overwrite guard.
  ${If} ${FileExists} "$R4\*.*"
  ${AndIfNot} ${FileExists} "$R5\*.*"
    CreateDirectory "$R5"
    ClearErrors
    # CopyFiles uses SHFileOperation: `\*.*` copies files and subdirectories
    # recursively into $R5. Errors (a locked sqlite sidecar, say) are cleared so
    # a single unreadable file cannot abort the whole rescue or the install.
    CopyFiles /SILENT "$R4\*.*" "$R5"
    ClearErrors
  ${EndIf}
!macroend

!macro RescueLegacyInstallDirState
  Push $R4
  Push $R5
  # $INSTDIR is the existing install location, resolved from the registry by
  # initMultiUser before this runs. No prior payload here means nothing to
  # rescue, and every guarded copy below is skipped.
  ${If} ${FileExists} "$INSTDIR\resources\capability\*.*"
    !insertmacro RescueOneStateDir "state"
    !insertmacro RescueOneStateDir "logs"
    !insertmacro RescueOneStateDir "vault"
    !insertmacro RescueOneStateDir "captures"
    !insertmacro RescueOneStateDir "profiles"
    !insertmacro RescueOneStateDir "reports"
  ${EndIf}
  Pop $R5
  Pop $R4
!macroend

!endif # TOOLSENABLED_RESCUE_INCLUDED

# .onInit, after initMultiUser has resolved $INSTDIR to the existing install and
# before the install Section runs uninstallOldVersion. This is the load-bearing
# path: it is the new installer, running while the old build's data is still on
# disk, one step ahead of the old uninstaller that is about to delete it.
!macro customInit
  !insertmacro RescueLegacyInstallDirState
!macroend

# un.onInit of THIS build's uninstaller. Defense in depth only: on the upgrade
# that migrates a customer off a defective build it is the OLD build's
# uninstaller that runs, and that one does not carry this macro -- so customInit
# above is what actually rescues that customer. This macro only ever runs for
# builds shipped from here on, and is gated on ${isUpdated} so a genuine,
# user-initiated uninstall (not an update) is left to behave normally. Because
# the operation is copy-only and never-overwrite, running it in addition to
# customInit is harmless.
!macro customUnInit
  ${If} ${isUpdated}
    !insertmacro RescueLegacyInstallDirState
  ${EndIf}
!macroend
