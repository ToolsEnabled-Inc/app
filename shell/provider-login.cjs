'use strict'

/* START THE PROVIDER'S OWN SIGN-IN PROGRAM FOR A PERSON, AND ONLY THAT.
 *
 * THE DEFECT THIS EXISTS TO CLOSE. The first external user of 1.0.20 followed
 * the guide: `winget install OpenAI.Codex`, then `codex login` "in the same
 * window". The same window answered "'codex' is not recognized" -- winget
 * records the new program's location in the registry and a shell that is
 * already open never re-reads it -- and they were stuck at the exact step the
 * owner predicted would be the frustrating one. Reproduced 2026-08-19 against
 * a PATH snapshotted before the install.
 *
 * The copy fix says "a new terminal window". This module removes the terminal
 * from the path altogether: the product resolves the program FRESH, every
 * press, and starts the program's own login command. A stale window cannot
 * exist because no window is involved.
 *
 * WHAT SIGNING IN ACTUALLY IS HERE, measured on this machine 2026-08-19:
 *
 *   codex-cli 0.146.0    `codex login`       prints an https line, opens the
 *                                            person's browser, finishes by its
 *                                            own local callback, writes its own
 *                                            auth.json. Piped and hidden, it
 *                                            still prints the https line.
 *   claude 2.1.186       `claude auth login` prints an https line, opens the
 *                                            browser, and offers a paste-back
 *                                            prompt. Whether its browser flow
 *                                            completes without the paste was
 *                                            NOT proven here -- completing it
 *                                            means signing in a real account,
 *                                            which no test on this machine may
 *                                            do. If the flow does want the
 *                                            paste, it CANNOT pass through
 *                                            this product (the stdin rule);
 *                                            the terminal command printed on
 *                                            the guide stays the fallback.
 *   gemini 0.53.0        has no sign-in subcommand at all (its own --help), so
 *                        it is not in the table and asking is refused.
 *
 * THE RULES, each held by tools/test/provider-login.test.mjs against this
 * source because most of them are absences of code:
 *
 *   1. STDIN IS 'ignore'. The login flows have a paste-a-code fallback; a code
 *      pasted into this product would be a credential-shaped secret passing
 *      through our hands. There is no pipe to write into, so it cannot.
 *   2. NOTHING HERE READS A FILE'S CONTENTS. statSync existence checks only.
 *      The program writes its own sign-in store; this module never learns
 *      where, let alone what.
 *   3. EVERY SPAWN GOES THROUGH THE HIDDEN SEAM (capability's spawnHidden), so
 *      no console window can reach the desktop. The seam also resolves the npm
 *      codex launcher to the native binary, exactly as agent sessions do.
 *   4. THE ENVIRONMENT IS THE PERSON'S OWN. No CODEX_HOME, no
 *      CLAUDE_CONFIG_DIR, no redirection: the sign-in lands where the program
 *      always keeps it, the same as running the command by hand.
 *   5. WHAT CROSSES TO THE RENDERER IS BOUNDED PROSE AND ONE KIND OF LINK.
 *      Colour codes stripped, lines capped, and only an https URL may become a
 *      link event. Exit is a number. No path, no environment, no code the
 *      person did not already see in their own browser.
 */

const path = require('node:path')

/* `npmPackage` is the name the OFFICIAL install command takes. The programs
 * are never bundled into this product -- Claude Code's licence grants no
 * redistribution (measured: its LICENSE.md is all-rights-reserved), and the
 * legal record REQ-engine-bundle-provider-clis.md settles the question with
 * fetch-on-demand -- so the install button runs `npm install -g <package>` and
 * the person's own machine fetches the program from the provider's own
 * channel. Not a byte of either program passes through or ships with us. */
const LOGIN_PROVIDERS = Object.freeze({
  codex: Object.freeze({
    id: 'codex',
    command: 'codex',
    argv: Object.freeze(['login']),
    npmPackage: '@openai/codex',
    /* npm's launcher re-spawns the native binary with inherited stdio and no
       windowsHide; the seam resolves it away. Segments, not a joined string,
       so the join happens against the injected APPDATA. */
    npmLauncher: Object.freeze(['npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js']),
  }),
  claude: Object.freeze({
    id: 'claude',
    command: 'claude',
    argv: Object.freeze(['auth', 'login']),
    npmPackage: '@anthropic-ai/claude-code',
    /* The npm package's bin maps straight to a native exe (read from its own
       package.json, 2.1.186), so there is no launcher to resolve away -- the
       exe is started directly. */
    npmNativeExe: Object.freeze(['npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe']),
  }),
})

const LOGIN_PROVIDER_IDS = Object.freeze(Object.keys(LOGIN_PROVIDERS))

/* Forwarding caps. A login prints a screenful; thousands of lines is a
   malfunction being relayed to a renderer, and the cap is the mercy. */
const LINE_LIMIT = 400
const LINE_LENGTH_LIMIT = 500
const TIMEOUT_MS = 15 * 60 * 1000

/* Colour and cursor codes, stripped so the panel shows words. The codex
   banner arrives wrapped in them. */
const ANSI_PATTERN = /\[[0-9;?]*[ -/]*[@-~]/g

const HTTPS_PATTERN = /https:\/\/[^\s"'<>\])]+/

function fileExists(statSync, target) {
  try {
    return statSync(target).isFile()
  } catch {
    return false
  }
}

/* The same fresh PATH walk the presence probe uses, and for the same reason it
 * must be fresh: this answer is taken at the moment of the press, so a person
 * who installed a minute ago is found a minute later, with no window to
 * restart. */
function commandOnPath(command, { env, platform, statSync }) {
  const rawPath = env.PATH || env.Path
  if (!rawPath) return null
  const extensions = platform === 'win32'
    ? (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').map(value => value.trim()).filter(Boolean)
    : ['']
  for (const directory of rawPath.split(path.delimiter)) {
    if (!directory) continue
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`)
      if (fileExists(statSync, candidate)) return candidate
    }
  }
  return null
}

/* What one press should execute, decided fresh each press.
 * Returns { command, args } or null when the program is not on this machine. */
function resolveLogin(provider, { env, platform, statSync, execPath }) {
  const appData = env.APPDATA
  if (provider.npmLauncher && appData) {
    const launcher = path.join(appData, ...provider.npmLauncher)
    if (fileExists(statSync, launcher)) {
      /* The seam resolves this launcher to the native binary. If this machine's
         layout has none, the launcher itself runs under our own binary as a
         script host, which needs the one flag that makes Electron be Node. */
      return { command: execPath, args: [launcher, ...provider.argv], launcher: true }
    }
  }
  if (provider.npmNativeExe && appData) {
    const native = path.join(appData, ...provider.npmNativeExe)
    if (fileExists(statSync, native)) {
      return { command: native, args: [...provider.argv], launcher: false }
    }
  }
  const found = commandOnPath(provider.command, { env, platform, statSync })
  if (found) return { command: found, args: [...provider.argv], launcher: false }
  return null
}

/**
 * The service the shell owns. Everything a test needs to vary is injected;
 * production passes the capability payload's spawnHidden and
 * resolveHiddenInvocation and nothing else unusual.
 *
 * start(providerId, emit) -> { ok: true } | { ok: false, code, reason }
 *   emit receives, in order, any of:
 *     { kind: 'line', text }   one readable line the program printed
 *     { kind: 'url', url }     an https line, also kept for lastUrl()
 *     { kind: 'exit', code }   the program finished; code is null on a kill
 * stop(providerId)  -> { ok: true, stopped }   stopped=false when idle
 * stopAll()         -> kills every flight; for the app quitting
 * running(providerId) -> boolean
 * lastUrl(providerId) -> the newest https line this flight printed, or null
 */
function createProviderLoginService(options = {}) {
  const {
    spawnHidden,
    resolveHiddenInvocation,
    env = process.env,
    platform = process.platform,
    statSync = require('node:fs').statSync,
    execPath = process.execPath,
    timers = { setTimeout, clearTimeout },
    timeoutMs = TIMEOUT_MS,
  } = options
  if (typeof spawnHidden !== 'function') {
    throw new TypeError('createProviderLoginService requires the hidden-spawn seam')
  }

  /* providerId -> { child, timer, op, url, lines, remainder }. One flight per
     provider, whatever its kind: an install and a login racing each other over
     the same program is two writers to one layout. */
  const flights = new Map()

  function finish(providerId, flight, code, emit) {
    if (flights.get(providerId) !== flight) return
    flights.delete(providerId)
    if (flight.timer) timers.clearTimeout(flight.timer)
    /* A prompt with no newline ("Paste code here if prompted > ") must not
       vanish with the child. */
    const rest = flight.remainder.replace(ANSI_PATTERN, '').trim()
    if (rest && flight.lines < LINE_LIMIT) emit({ kind: 'line', op: flight.op, text: rest.slice(0, LINE_LENGTH_LIMIT) })
    emit({ kind: 'exit', op: flight.op, code: typeof code === 'number' ? code : null })
  }

  function forward(flight, chunk, emit) {
    flight.remainder += String(chunk)
    let cut = flight.remainder.indexOf('\n')
    while (cut !== -1) {
      const raw = flight.remainder.slice(0, cut)
      flight.remainder = flight.remainder.slice(cut + 1)
      cut = flight.remainder.indexOf('\n')
      const text = raw.replace(ANSI_PATTERN, '').replace(/\r$/, '').trim()
      if (!text) continue
      if (flight.lines >= LINE_LIMIT) continue
      flight.lines += 1
      emit({ kind: 'line', op: flight.op, text: text.slice(0, LINE_LENGTH_LIMIT) })
      /* Only a LOGIN flight's https line becomes a link event. npm prints
         advisory and funding links mid-install, and surfacing one of those as
         "open the sign-in page" would send a person to a page that signs
         nobody in. Install output keeps its links as plain lines. */
      if (flight.op === 'login') {
        const url = HTTPS_PATTERN.exec(text)
        if (url) {
          flight.url = url[0]
          emit({ kind: 'url', op: flight.op, url: url[0] })
        }
      }
    }
  }

  /* The one place a child is attached to a flight, shared by both kinds so the
     stdin rule, the watchdog and the caps cannot drift apart. */
  function fly(providerId, op, command, args, childEnv, emit) {
    let child
    try {
      child = spawnHidden(command, args, {
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch {
      return {
        ok: false,
        code: 'PROVIDER_LOGIN_SPAWN_FAILED',
        reason: 'The program could not be started. Running its command in a new terminal window still works.',
      }
    }
    const flight = { child, timer: null, op, url: null, lines: 0, remainder: '' }
    flights.set(providerId, flight)
    flight.timer = timers.setTimeout(() => {
      try { child.kill() } catch { /* already gone */ }
    }, timeoutMs)
    /* The watchdog must never be the thing keeping the process alive -- not
       the app at quit, and not a test runner whose fake child never exits. */
    if (flight.timer && typeof flight.timer.unref === 'function') flight.timer.unref()
    if (child.stdout) child.stdout.on('data', chunk => forward(flight, chunk, emit))
    if (child.stderr) child.stderr.on('data', chunk => forward(flight, chunk, emit))
    child.on('error', () => finish(providerId, flight, null, emit))
    child.on('exit', code => finish(providerId, flight, code, emit))
    return { ok: true }
  }

  return Object.freeze({
    start(providerId, emit) {
      const provider = LOGIN_PROVIDERS[providerId]
      if (!provider) {
        return {
          ok: false,
          code: 'PROVIDER_LOGIN_UNKNOWN',
          reason: 'That program has no sign-in this product can start.',
        }
      }
      if (typeof emit !== 'function') throw new TypeError('start() requires a listener')
      if (flights.has(providerId)) {
        return {
          ok: false,
          code: 'PROVIDER_LOGIN_RUNNING',
          reason: 'A sign-in for this program is already running. Finish it in your browser, or press Stop.',
        }
      }
      const resolved = resolveLogin(provider, { env, platform, statSync, execPath })
      if (!resolved) {
        return {
          ok: false,
          code: 'PROVIDER_LOGIN_NOT_INSTALLED',
          reason: 'That program is not on this computer yet. Follow its install line above first.',
        }
      }

      /* ELECTRON_RUN_AS_NODE only when our own binary really will host the
         launcher script -- decided against what the seam will actually run,
         the same decision capability's codex-process.js makes and documents. */
      let childEnv = env
      if (resolved.launcher) {
        const executed = typeof resolveHiddenInvocation === 'function'
          ? resolveHiddenInvocation(resolved.command, resolved.args, env)
          : { command: resolved.command }
        if (executed.command === execPath) childEnv = { ...env, ELECTRON_RUN_AS_NODE: '1' }
      }

      return fly(providerId, 'login', resolved.command, resolved.args, childEnv, emit)
    },

    /* THE INSTALL, over the same plumbing and under the same rules. It runs
       the OFFICIAL package install -- `npm install -g <package>` -- so this
       machine fetches the program from the provider's own channel; nothing is
       bundled and nothing passes through this product. npm is resolved fresh
       from PATH at the press, and its absence is a refusal that names the
       real fix, because "npm failed" at a person who has never heard of npm
       is a dead end. */
    installStart(providerId, emit) {
      const provider = LOGIN_PROVIDERS[providerId]
      if (!provider) {
        return {
          ok: false,
          code: 'PROVIDER_LOGIN_UNKNOWN',
          reason: 'That program has no install this product can run.',
        }
      }
      if (typeof emit !== 'function') throw new TypeError('installStart() requires a listener')
      if (flights.has(providerId)) {
        return {
          ok: false,
          code: 'PROVIDER_LOGIN_RUNNING',
          reason: 'Something is already running for this program. Let it finish, or press Stop.',
        }
      }
      const npm = commandOnPath('npm', { env, platform, statSync })
      if (!npm) {
        return {
          ok: false,
          code: 'PROVIDER_LOGIN_NPM_MISSING',
          reason: 'The installer needs npm, which is not on this computer. Install Node.js from nodejs.org first; npm comes with it.',
        }
      }
      return fly(providerId, 'install', npm, ['install', '-g', provider.npmPackage], env, emit)
    },

    stop(providerId) {
      const flight = flights.get(providerId)
      if (!flight) return { ok: true, stopped: false }
      try { flight.child.kill() } catch { /* already gone */ }
      return { ok: true, stopped: true }
    },

    stopAll() {
      for (const flight of flights.values()) {
        try { flight.child.kill() } catch { /* already gone */ }
      }
    },

    running(providerId) {
      return flights.has(providerId)
    },

    lastUrl(providerId) {
      const flight = flights.get(providerId)
      return flight && flight.url ? flight.url : null
    },
  })
}

module.exports = {
  LOGIN_PROVIDER_IDS,
  createProviderLoginService,
}
