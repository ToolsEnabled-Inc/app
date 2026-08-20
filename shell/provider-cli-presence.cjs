'use strict'

/* IS THE PROGRAM THAT RUNS AN AGENT ON THIS COMPUTER, AND IS IT SIGNED IN.
 *
 * THE DEFECT THIS EXISTS TO CLOSE. The owner, on what a stranger has to be able
 * to do: "a user needs to be able to easily install, add Claude and Codex and
 * Gemini CLI subscriptions smoothly and easily, then use those CLI for their
 * agents". Measured on the packaged product before this file existed: there is
 * no screen anywhere that reports whether any of those three programs is on the
 * computer, whether any of them is signed in, or what to type if not. The one
 * place the subject comes up is Settings, which says the product "never asks for
 * them" -- true, and read by a person as "there is nothing for me to do here",
 * which is the opposite of the truth. A person whose agent will not start has
 * nowhere in this product to find out why.
 *
 * WHAT IT MAY NEVER DO, and the rule is structural rather than promised. This
 * module resolves PRESENCE and nothing else. It calls fs.statSync and
 * fs.existsSync; it does not call readFile, readFileSync, or anything else that
 * returns bytes, and it never spawns a child. So there is no code path here that
 * could read a credential, and therefore none that could store, log or forward
 * one. The sign-in answer is "a file is where that program keeps its sign-in",
 * never one byte of what is in it. tools/test/provider-cli-presence.test.mjs
 * asserts the absence of every reading call in this source, because a rule about
 * credentials that is only written in a comment is not a rule.
 *
 * IT RETURNS NO PATHS. Every field is a word from a closed set. This is the
 * BLOCKER 2 rule the rest of this shell already follows: an answer that crosses
 * into the renderer must not carry a filesystem path, because that is how a
 * private checkout name reached the DOM. The caller gets `installed: 'yes'` and
 * never the directory that made it true.
 *
 * WHY IT DOES NOT SPAWN, when spawning would give a better answer. Each of the
 * three programs can be asked authoritatively -- `claude auth status` prints
 * JSON, `codex login status` prints a sentence -- and those are the commands
 * this product tells a person to run. But a probe a screen calls on mount must
 * not start three child processes, which is the same rule
 * codexCommandIsMissing() in shell/agent-host.cjs states for the same reason. So
 * this answers what can be answered from the filesystem, and the copy hands the
 * person the official command for the rest. The product asking on their behalf
 * would be a convenience; the product being wrong about their sign-in would be a
 * dead end, and the second costs more than the first is worth.
 *
 * 'unknown' IS A REAL ANSWER AND IS USED. Claude Code can authenticate from the
 * operating system keychain or from a key in the environment, so the absence of
 * its sign-in file does not prove a person is signed out. Reporting 'no' there
 * would be the product telling someone to fix something that is not broken. The
 * three states are therefore: proved present, proved absent from the place that
 * program keeps it, and not determinable from here.
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

/* THE THREE PROGRAMS, AND WHERE EACH KEEPS ITS SIGN-IN.
 *
 * Every value below was MEASURED on a machine with all three installed and
 * signed in, not read off a document:
 *
 *   claude   %APPDATA%\npm\claude.cmd     ~/.claude/.credentials.json
 *   codex    %APPDATA%\npm\codex.cmd      ~/.codex/auth.json
 *   gemini   %APPDATA%\npm\gemini.cmd     ~/.gemini/oauth_creds.json
 *
 * `homeEnv` is the environment variable that RELOCATES that program's
 * configuration directory, and it is read first because a person who set one is
 * telling us where to look. Getting this wrong does not fail loudly -- it
 * reports a signed-in person as signed out, on their own machine, which is the
 * most annoying possible way to be wrong.
 *
 * `signInProves` is the honest half. 'absence' means a missing file is real
 * evidence of a signed-out state for that program; 'presence-only' means the
 * file proves a sign-in when it is there and proves nothing when it is not,
 * because that program has other ways to authenticate. Codex is the one this
 * shell already treats as decisive -- confinedSessionIsSignedOut() in
 * shell/agent-host.cjs refuses a start on exactly this missing file -- so
 * reporting 'no' for it here agrees with what the product already does rather
 * than inventing a second opinion.
 */
const PROVIDERS = Object.freeze([
  Object.freeze({
    id: 'codex',
    command: 'codex',
    homeEnv: 'CODEX_HOME',
    homeDirectory: '.codex',
    signInFile: 'auth.json',
    signInProves: 'absence',
  }),
  Object.freeze({
    id: 'claude',
    command: 'claude',
    homeEnv: 'CLAUDE_CONFIG_DIR',
    homeDirectory: '.claude',
    signInFile: '.credentials.json',
    signInProves: 'presence-only',
  }),
  Object.freeze({
    id: 'gemini',
    command: 'gemini',
    homeEnv: 'GEMINI_DIR',
    homeDirectory: '.gemini',
    signInFile: 'oauth_creds.json',
    signInProves: 'presence-only',
  }),
])

const PROVIDER_IDS = Object.freeze(PROVIDERS.map(provider => provider.id))
const PRESENCE_STATES = Object.freeze(['yes', 'no', 'unknown'])

/* Is a program of this name runnable from a command line on this computer?
 *
 * MIRRORED FROM codexCommandIsMissing() IN shell/agent-host.cjs, deliberately,
 * including the part that looks like an oversight. The extension list IS the
 * resolution on Windows: %APPDATA%\npm ships THREE files per program -- `codex`,
 * `codex.cmd` and `codex.ps1` -- and only the second of those is a thing cmd.exe
 * can run. A check for a bare `codex` passes on the extensionless shim, which is
 * a bash script, and reports a program that the shell cannot start.
 *
 * IT PROVES PRESENCE OR IT SAYS NOTHING. A machine whose PATH this process
 * cannot read has taught us nothing about what is installed on it, so that
 * returns 'unknown' rather than 'no'. Turning "I could not tell" into "you have
 * not installed it" would put an install command in front of somebody who
 * already ran it.
 */
function commandPresence(command, { env, platform, statSync }) {
  const extensions = platform === 'win32'
    ? (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').map(value => value.trim()).filter(Boolean)
    : ['']
  /* npm's global directory is checked DIRECTLY, before PATH, because a program
     installed a minute ago is real before any shell can see it: the installer
     writes %APPDATA%\npm and the PATH entry pointing there may predate this
     process -- or, on a machine where Node itself just arrived, not be in this
     process's PATH at all. That second case is the friend's machine, and
     answering 'no' there tells a person to redo an install that worked. */
  if (platform === 'win32' && typeof env.APPDATA === 'string' && env.APPDATA) {
    for (const extension of extensions) {
      try {
        if (statSync(path.join(env.APPDATA, 'npm', `${command}${extension}`)).isFile()) return 'yes'
      } catch {
        /* Not installed by npm is not an answer about PATH. */
      }
    }
  }
  const rawPath = env.PATH || env.Path
  if (!rawPath) return 'unknown'
  for (const directory of rawPath.split(path.delimiter)) {
    if (!directory) continue
    for (const extension of extensions) {
      try {
        if (statSync(path.join(directory, `${command}${extension}`)).isFile()) return 'yes'
      } catch {
        /* One unreadable directory is not an answer about the others. */
      }
    }
  }
  return 'no'
}

/* Where a program keeps its configuration, honouring the variable that moves it.
 * Returns null when there is no home directory to build a path from, which is
 * the case a container or a service account actually hits. */
function configurationDirectory(provider, { env, homedir }) {
  const relocated = env[provider.homeEnv]
  if (typeof relocated === 'string' && relocated.trim().length > 0) return relocated.trim()
  let home
  try {
    home = homedir()
  } catch {
    return null
  }
  if (typeof home !== 'string' || home.length === 0) return null
  return path.join(home, provider.homeDirectory)
}

function signInPresence(provider, { env, homedir, existsSync }) {
  const directory = configurationDirectory(provider, { env, homedir })
  if (!directory) return 'unknown'
  let present
  try {
    present = existsSync(path.join(directory, provider.signInFile))
  } catch {
    return 'unknown'
  }
  if (present) return 'yes'
  /* The honest half. Only Codex treats a missing file as proof, because this
     shell already refuses a start on exactly that basis. */
  return provider.signInProves === 'absence' ? 'no' : 'unknown'
}

/**
 * What each of the three programs looks like on this computer.
 *
 * Returns `{ ok: true, providers: [{ id, installed, signedIn }] }`. Every value
 * is a word from a closed set; there is no path, no version, no account and no
 * credential anywhere in the answer. `ok` is always true because there is no
 * failure this can suffer that is not already expressed as 'unknown' on one
 * provider -- a caller branching on `ok` would be branching on nothing.
 *
 * The injected `fs`, `os` and `platform` are how the suite drives a machine it
 * is not running on. Nothing here caches: a person who signs in and comes back
 * to this screen must see the new answer, and a cache is how they would not.
 */
function providerCliPresence(options = {}) {
  const env = options.env || process.env
  const platform = options.platform || process.platform
  const statSync = options.statSync || fs.statSync
  const existsSync = options.existsSync || fs.existsSync
  const homedir = options.homedir || os.homedir

  return Object.freeze({
    ok: true,
    providers: Object.freeze(PROVIDERS.map(provider => Object.freeze({
      id: provider.id,
      installed: commandPresence(provider.command, { env, platform, statSync }),
      signedIn: signInPresence(provider, { env, homedir, existsSync }),
    }))),
  })
}

module.exports = {
  PROVIDER_IDS,
  PRESENCE_STATES,
  providerCliPresence,
}
