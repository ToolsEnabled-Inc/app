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

# =============================================================================
# UNINSTALL DATA RETENTION
# =============================================================================
#
# WHAT THIS UNINSTALLER USED TO DO WITH THE PERSON'S DATA: nothing, and never
# said so. `RMDir /r $INSTDIR` removes the program. %APPDATA%\<PRODUCT_NAME> was
# never touched, never mentioned and never configurable. Measured on a live
# install 2026-08-11: 92 files, 11.87 MB survived an uninstall, including the
# credential vault (capability\vault\secrets.json), the signed audit ledger
# (capability\state\audit.sqlite3, 457 KB), the action log, the linked-accounts
# file and the key that signs agent run records.
#
# Retention is not the wrong answer. Deleting somebody's credentials and history
# because they removed a program is irreversible and frequently NOT what they
# want. Retention WITHOUT A DECISION is the defect: "nobody was asked" was being
# read as "they chose to keep it", which is this codebase's absence-as-consent
# shape applied to the most sensitive data it holds.
#
# THE DECISION TABLE. shell/uninstall-retention.cjs is the source of truth for
# the token strings and resolves them identically; tools/test/uninstall-retention.test.mjs
# fails if this file and that module ever disagree, because a renamed token on
# one side only would stop matching here and silently take the `ask` branch --
# which would look like correct behaviour while meaning the control had broken.
#
#   recorded "remove-everything"  ->  remove the data. They asked.
#   recorded "keep-my-data"       ->  keep it, say nothing. They asked.
#   anything else                 ->  NOT A DEFAULT. See below.
#
# "Anything else" is every absence: no file, empty file, unreadable file, a
# token from a newer build, a hand-edit. It splits on whether there is anyone to
# ask:
#
#   interactive  ->  ASK, with both options stated plainly and neither preselected
#                    as "recommended". /SD IDNO is set so that if this dialog is
#                    ever reached non-interactively despite the ${Silent} guard
#                    below, the answer is KEEP -- the non-destructive direction.
#   silent (/S)  ->  keep, and WRITE DATA-KEPT-AFTER-UNINSTALL.txt into the
#                    directory naming what was kept and where. The bytes on disk
#                    are the same as the old behaviour; the difference is that
#                    the person can find out. That is the whole fix.
#
# A silent uninstall must never open a dialog. This build already has a defect
# where the uninstaller ignores /S, opens a modal and blocks forever while
# returning success to its caller; putting an unguarded MessageBox here would
# deepen exactly that. ${Silent} is checked before any UI.
#
# AND THIS NEVER RUNS DURING AN UPGRADE. ${isUpdated} is checked first: an
# update runs the uninstaller as an implementation detail, and a person clicking
# "install the new version" has not asked to be questioned about their data, let
# alone to lose it.

!macro TE_RemoveAllUserData Root Legacy
  RMDir /r "${Root}"
  # The pre-rename directory. shell/userdata-adoption.cjs declares
  # %APPDATA%\Mission Control to be THIS product's earlier userData and adopts
  # from it, so leaving it behind would make "remove everything" untrue by
  # 23.71 MB. Guarded on existence so a fresh install removes nothing extra.
  ${If} ${FileExists} "${Legacy}\*.*"
    RMDir /r "${Legacy}"
  ${EndIf}
!macroend

!macro TE_DeclareRetention Root
  ${If} ${FileExists} "${Root}\*.*"
    ClearErrors
    FileOpen $R4 "${Root}\DATA-KEPT-AFTER-UNINSTALL.txt" w
    ${IfNot} ${Errors}
      FileWrite $R4 "YOUR DATA IS STILL ON THIS COMPUTER$\r$\n$\r$\n"
      FileWrite $R4 "ToolsEnabled has been uninstalled. The program files were removed.$\r$\n"
      FileWrite $R4 "The data in this folder was NOT removed, and this file exists to tell$\r$\n"
      FileWrite $R4 "you so.$\r$\n$\r$\n"
      FileWrite $R4 "Why it was kept: this was a silent uninstall and no choice had been$\r$\n"
      FileWrite $R4 "recorded, so there was nobody to ask. Deleting data nobody asked us to$\r$\n"
      FileWrite $R4 "delete cannot be undone, so it was kept.$\r$\n$\r$\n"
      FileWrite $R4 "Where it is: ${Root}$\r$\n$\r$\n"
      FileWrite $R4 "It includes your saved credentials, the signed record of every action$\r$\n"
      FileWrite $R4 "taken, the action log, your linked accounts, and your settings.$\r$\n$\r$\n"
      FileWrite $R4 "To remove it, delete the folder named above. Nothing else on this$\r$\n"
      FileWrite $R4 "computer depends on it.$\r$\n$\r$\n"
      FileWrite $R4 "If you reinstall ToolsEnabled, this data is picked up again and your$\r$\n"
      FileWrite $R4 "settings, credentials and history will be exactly as you left them.$\r$\n"
      FileClose $R4
    ${EndIf}
  ${EndIf}
!macroend

!macro customUnInstall
  ${IfNot} ${isUpdated}
    Push $R0
    Push $R1
    Push $R2
    Push $R3
    Push $R4

    StrCpy $R0 "$APPDATA\${PRODUCT_NAME}"
    StrCpy $R1 "$APPDATA\Mission Control"
    StrCpy $R2 ""

    # Read the recorded choice, if there is one. A failure to open leaves $R2
    # empty, which falls through to the ask/declare branch -- an unreadable
    # choice is treated as no choice, never as consent to keep.
    ClearErrors
    FileOpen $R3 "$R0\uninstall-data-policy.txt" r
    ${IfNot} ${Errors}
      FileRead $R3 $R2
      FileClose $R3
    ${EndIf}

    # Trim trailing newline and whitespace. The file is written with a trailing
    # newline, and a CRLF round trip must not change what the token means.
    ${Do}
      StrCpy $R3 $R2 1 -1
      ${If} $R3 == "$\r"
      ${OrIf} $R3 == "$\n"
      ${OrIf} $R3 == " "
      ${OrIf} $R3 == "$\t"
        StrCpy $R2 $R2 -1
      ${Else}
        ${ExitDo}
      ${EndIf}
    ${Loop}

    # Exact match only. A differently-cased or unrecognised token resolves to
    # the ask/declare branch, which is the safe direction: the worst outcome of
    # a mismatch is that a person is asked a question they already answered,
    # not that their vault is deleted or silently retained.
    ${If} $R2 == "remove-everything"
      !insertmacro TE_RemoveAllUserData "$R0" "$R1"
    ${ElseIf} $R2 == "keep-my-data"
      # An informed choice to keep. Nothing to do and nothing to announce.
    ${Else}
      ${If} ${Silent}
        !insertmacro TE_DeclareRetention "$R0"
      ${Else}
        MessageBox MB_YESNO|MB_ICONQUESTION \
          "Remove your saved ToolsEnabled data from this computer?$\r$\n$\r$\n\
          This includes your saved credentials, the signed record of every action taken, your linked accounts, your agent history and your settings.$\r$\n$\r$\n\
          Yes  -  delete it permanently. This cannot be undone.$\r$\n\
          No   -  keep it. Reinstalling restores everything as you left it." \
          /SD IDNO IDYES te_remove_user_data IDNO te_keep_user_data

        te_remove_user_data:
          !insertmacro TE_RemoveAllUserData "$R0" "$R1"
          Goto te_user_data_done

        te_keep_user_data:
          # They were asked and said keep. That is a decision, so no declaration
          # file is written -- a person who just chose "keep" does not need a
          # note telling them their data was kept.

        te_user_data_done:
      ${EndIf}
    ${EndIf}

    Pop $R4
    Pop $R3
    Pop $R2
    Pop $R1
    Pop $R0
  ${EndIf}
!macroend
