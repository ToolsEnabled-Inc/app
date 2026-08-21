/* THE ONE PLACE EVERY AGENT AND ORGANISATION COMMAND IS DECIDED.
 *
 * WHY THIS FILE EXISTS. docs/relay-agent-facade-DESIGN.md (§2.1) commits the
 * product to serving the agent and org surface to a signed-in browser over a
 * sealed relay, which means the same commands will be reached from TWO
 * callers: the Electron IPC handlers in shell/main.cjs (the window at the
 * keyboard) and, later, a loopback facade the relay child forwards to. If the
 * two callers each held their own copy of "what may a start do, what does a
 * send refuse, in what order are the checks made", they would drift apart the
 * first time one of them was edited, and the web would quietly disagree with
 * the desk about what a person is allowed to do to their own computer. So the
 * bodies of all thirty handlers live HERE, once, and every caller dispatches
 * through run(). The IPC handlers in main.cjs are thin wrappers: they make the
 * Electron frame check (that is a fact about Electron, not about a command)
 * and hand the rest to this module.
 *
 * WHO IS ASKING: THE PRINCIPAL. The handlers used to answer the question "does
 * this session belong to the caller" with `session.owner === event.sender` --
 * the WebContents that started it. That was right and it stays right, but a
 * relay caller has no WebContents, so the question is now asked of a
 * principal:
 *
 *   { kind: 'window' | 'relay',   // the window's wrappers build 'window';
 *                                 // the agent facade builds 'relay'
 *     owner: <opaque identity>,   // the window passes event.sender, unchanged
 *     mayWrite: boolean,          // false refuses every state-changing command
 *     label: string }             // for refusal sentences
 *
 * For the window caller nothing observable changes: `owner` IS event.sender,
 * `mayWrite` is true, and every refusal code, string and ordering is the one
 * main.cjs raised before the extraction. The ownership test becomes
 * `session.owner !== principal.owner` and refuses with the same
 * MC_AGENT_UNKNOWN_SESSION it always did.
 *
 * THE READ-ONLY GATE. `mayWrite: false` refuses every command marked `write`
 * in COMMANDS with MC_AGENT_PRINCIPAL_READ_ONLY, before the payload is even
 * parsed, and reads keep answering so a surface can say what the state is and
 * WHY a command was refused. No window caller sets it false; it is the seam
 * the owner-ruled "this computer may be driven from the web" switch will use,
 * and that switch defaults OFF.
 *
 * THE DIALOG GATE. Three commands open a native dialog on this computer -- the
 * attachment picker, the mention picker and profile creation -- and the
 * attachment dialog is the ENTIRE security design of the image allowlist: the
 * only way a path enters a session's allowlist is a person choosing it in that
 * dialog. A caller that is not at the keyboard cannot be shown a dialog, so
 * those commands refuse any principal whose kind is not 'window' with
 * MC_AGENT_DIALOG_REQUIRES_WINDOW, rather than opening a dialog nobody is
 * present to see. The dialog itself is injected through `deps` -- this module
 * never requires electron -- which is what makes it testable here and
 * refusable there.
 *
 * NOTHING IN THIS FILE IS A CONSTANT THAT MAIN.CJS ALSO HOLDS. Every value the
 * bodies used to close over (the session map, the host, the recorders, the
 * parsers, the stores, the bounds) is passed in through `deps` and checked for
 * presence at construction: a dependency that is absent fails the construction
 * closed, never a later command open. */
'use strict'

const path = require('node:path')

/* The refusal a read-only principal receives for every write. One code, so a
   caller can branch on it; the sentence names the caller so a person reading a
   log knows WHICH caller was held back. */
const READ_ONLY_REFUSAL = 'MC_AGENT_PRINCIPAL_READ_ONLY'
/* The refusal a principal that is not at the keyboard receives for a command
   whose whole meaning is a native dialog. */
const DIALOG_REFUSAL = 'MC_AGENT_DIALOG_REQUIRES_WINDOW'
/* A principal that is not the documented shape is not a caller this surface
   can reason about, so it is refused before any command is considered. */
const PRINCIPAL_REFUSAL = 'MC_AGENT_PRINCIPAL_INVALID'
const UNKNOWN_COMMAND_REFUSAL = 'MC_AGENT_UNKNOWN_COMMAND'

/* THE INVENTORY. `write` marks a command that changes state on this computer
   (a process, a record, a store, a session's allowlist); `dialog` marks one
   whose body opens a native dialog. tools/test/agent-command-surface.test.mjs
   derives the thirty channel names from shell/main.cjs and fails if this table
   and those handlers disagree in either direction. */
const COMMANDS = Object.freeze({
  'agent:availability': Object.freeze({ write: false, dialog: false }),
  'agent:confinement': Object.freeze({ write: false, dialog: false }),
  'agent:tools': Object.freeze({ write: false, dialog: false }),
  'agent:local-messages': Object.freeze({ write: false, dialog: false }),
  'agent:startable-tiers': Object.freeze({ write: false, dialog: false }),
  'agent:history': Object.freeze({ write: false, dialog: false }),
  'agent:usage': Object.freeze({ write: false, dialog: false }),
  'agent:start': Object.freeze({ write: true, dialog: false }),
  'agent:send': Object.freeze({ write: true, dialog: false }),
  'agent:request': Object.freeze({ write: true, dialog: false }),
  'agent:requests': Object.freeze({ write: false, dialog: false }),
  'agent:profiles': Object.freeze({ write: false, dialog: false }),
  'agent:profile-create': Object.freeze({ write: true, dialog: true }),
  'agent:profile-remove': Object.freeze({ write: true, dialog: false }),
  /* ISSUES an allowlist grant into the session: a write, and a dialog. */
  'agent:pick-attachment': Object.freeze({ write: true, dialog: true }),
  /* Returns words for the renderer to insert; changes nothing, but it is a
     dialog, so it is gated on being at the keyboard. */
  'agent:pick-mention': Object.freeze({ write: false, dialog: true }),
  'agent:interrupt': Object.freeze({ write: true, dialog: false }),
  'agent:approval-answer': Object.freeze({ write: true, dialog: false }),
  'agent:rewind': Object.freeze({ write: true, dialog: false }),
  'agent:effort': Object.freeze({ write: true, dialog: false }),
  'agent:models': Object.freeze({ write: false, dialog: false }),
  'agent:close': Object.freeze({ write: true, dialog: false }),
  'org:read': Object.freeze({ write: false, dialog: false }),
  'org:reparent': Object.freeze({ write: true, dialog: false }),
  'org:assign-role': Object.freeze({ write: true, dialog: false }),
  'org:create-role': Object.freeze({ write: true, dialog: false }),
  'org:edit-role': Object.freeze({ write: true, dialog: false }),
  'org:reset-role': Object.freeze({ write: true, dialog: false }),
  'org:reset': Object.freeze({ write: true, dialog: false }),
  'org:export': Object.freeze({ write: false, dialog: false }),
})

/* Every dependency a body closes over, by name and by kind. Enumerated from
   the handler bodies, not guessed; a missing one refuses construction. */
const REQUIRED_DEPS = Object.freeze({
  agentSessions: 'object',
  currentAgentHost: 'function',
  getAgentHost: 'function',
  agentIpcError: 'function',
  agentPayload: 'function',
  boundedAgentString: 'function',
  parseAgentStart: 'function',
  parseAgentSend: 'function',
  parseAgentSessionCommand: 'function',
  rendererSafeAgentError: 'function',
  spawnRecordAvailability: 'function',
  spawnRecordHistory: 'function',
  usageRecordHistory: 'function',
  engineAvailability: 'function',
  ensureWorkspaceRoot: 'function',
  chosenWorkspaceCwd: 'function',
  readAgentConfinement: 'function',
  listAgentTools: 'function',
  resolveCapabilityRoot: 'function',
  requireModule: 'function',
  readStandingRequests: 'function',
  sessionProfiles: 'object',
  recordSpawnIntent: 'function',
  recordSpawnOutcome: 'function',
  recordSessionEnd: 'function',
  bindAgentOwner: 'function',
  agentOrgRecord: 'object',
  dialog: 'object',
  MAX_AGENT_SESSIONS: 'number',
  MAX_SESSION_ID_LENGTH: 'number',
  AGENT_EFFORT_VALUES: 'object',
  WORKSPACE_ROOT: 'string',
})

function assertDeps(deps) {
  if (!deps || typeof deps !== 'object') {
    throw new Error('createAgentCommandSurface needs an explicit deps object')
  }
  for (const [name, kind] of Object.entries(REQUIRED_DEPS)) {
    const value = deps[name]
    if (value === null || value === undefined || typeof value !== kind) {
      throw new Error('createAgentCommandSurface: missing or wrong-kind dependency: ' + name)
    }
  }
  if (!(deps.agentSessions instanceof Map)) {
    throw new Error('createAgentCommandSurface: agentSessions must be a Map')
  }
  if (typeof deps.dialog.showOpenDialog !== 'function') {
    throw new Error('createAgentCommandSurface: dialog must offer showOpenDialog')
  }
  if (!Array.isArray(deps.AGENT_EFFORT_VALUES)) {
    throw new Error('createAgentCommandSurface: AGENT_EFFORT_VALUES must be an array')
  }
  /* OPTIONAL, but never the wrong kind: absence has a defined meaning
     (relay-owned sessions' events are dropped, counted, and logged), a
     wrong-kind value is a wiring mistake and refuses construction. */
  for (const name of ['emitRelayEvent', 'log']) {
    if (deps[name] !== undefined && typeof deps[name] !== 'function') {
      throw new Error('createAgentCommandSurface: ' + name + ' must be a function when provided')
    }
  }
}

function validPrincipal(principal) {
  return Boolean(principal)
    && typeof principal === 'object'
    && typeof principal.kind === 'string' && principal.kind.length > 0
    && principal.owner !== null && principal.owner !== undefined
    && typeof principal.mayWrite === 'boolean'
    && typeof principal.label === 'string' && principal.label.length > 0
}

function createAgentCommandSurface(deps) {
  assertDeps(deps)
  const {
    agentSessions,
    currentAgentHost,
    getAgentHost,
    agentIpcError,
    agentPayload,
    boundedAgentString,
    parseAgentStart,
    parseAgentSend,
    parseAgentSessionCommand,
    rendererSafeAgentError,
    spawnRecordAvailability,
    spawnRecordHistory,
    usageRecordHistory,
    engineAvailability,
    ensureWorkspaceRoot,
    chosenWorkspaceCwd,
    readAgentConfinement,
    listAgentTools,
    resolveCapabilityRoot,
    requireModule,
    readStandingRequests,
    sessionProfiles,
    recordSpawnIntent,
    recordSpawnOutcome,
    recordSessionEnd,
    bindAgentOwner,
    agentOrgRecord,
    dialog,
    MAX_AGENT_SESSIONS,
    MAX_SESSION_ID_LENGTH,
    AGENT_EFFORT_VALUES,
    WORKSPACE_ROOT,
    emitRelayEvent,
    log,
  } = deps

  /* A session belongs to the principal that started it, and to nobody else.
     This used to compare against event.sender; the comparison is the same,
     the left-hand side is now whatever identity the principal carries -- for
     the window, still event.sender. The refusal is unchanged in code and in
     sentence. */
  function ownedAgentSession(principal, sessionId) {
    const session = agentSessions.get(sessionId)
    if (!session || session.owner !== principal.owner) {
      agentIpcError('MC_AGENT_UNKNOWN_SESSION', 'Unknown sessionId: ' + sessionId)
    }
    return session
  }

  const handlers = Object.freeze({
    /* Availability is a READ, and deliberately the only agent command that
       starts nothing. EVERY condition a start needs, from the same values the
       start uses, IN THE ORDER THE START REFUSES IN: the recorder first,
       because recordSpawnIntent() runs before getAgentHost().startSession().
       `defaultCwd` is passed rather than defaulted so the probe validates the
       directory the session will actually run in, prepared by the same
       ensureWorkspaceRoot() getAgentHost() calls. */
    'agent:availability': async (value) => {
      agentPayload(value === undefined || value === null ? {} : value, [])
      const record = spawnRecordAvailability()
      if (record.ok !== true) return record
      return engineAvailability({ defaultCwd: ensureWorkspaceRoot() })
    },

    /* What a session started here would be allowed to do. A tier name, a
       sandbox word and two counts; no path. */
    'agent:confinement': async () => {
      return readAgentConfinement({ capabilityRoot: resolveCapabilityRoot() })
    },

    /* The tool surface BY NAME. Registry identifiers only, never a path. */
    'agent:tools': async () => {
      return listAgentTools({ capabilityRoot: resolveCapabilityRoot() })
    },

    /* The messages this computer has already written down. A read of the
       owner journal; degrades to {ok:false, reason} rather than throwing,
       because "this build cannot read messages yet" and "the messages could
       not be read" are different things to be told. */
    'agent:local-messages': async (value) => {
      try {
        const engineRoot = resolveCapabilityRoot()
        if (!engineRoot) return { ok: false, reason: 'the live message reader is not available in this build' }
        const journal = requireModule(path.join(engineRoot, 'src', 'lib', 'providers', 'agent-comms-local.js'))
        /* Bounded here rather than trusted from the caller: a caller that can
           ask for everything is a caller that can be made to. */
        const limit = Number.isSafeInteger(value?.limit) ? Math.min(Math.max(value.limit, 1), 200) : 100
        return await journal.ownerJournal({ limit })
      } catch {
        return { ok: false, reason: 'the live message reader is not available in this build' }
      }
    },

    /* Which tiers this installation can actually start: the same
       resolveStartTier() the press runs, so the menu and the press agree. If
       the host cannot be built the call rejects and the caller takes its
       codex-only fallback. */
    'agent:startable-tiers': async () => {
      const host = await getAgentHost()
      return host.startableTiers()
    },

    /* What has actually run on this computer. Starts nothing. */
    'agent:history': async (value) => {
      const payload = agentPayload(value === undefined || value === null ? {} : value, ['limit'])
      return spawnRecordHistory(payload.limit)
    },

    /* What the turns on this computer cost. Starts nothing. */
    'agent:usage': async (value) => {
      const payload = agentPayload(value === undefined || value === null ? {} : value, ['limit'])
      return usageRecordHistory(payload.limit)
    },

    'agent:start': async (value, principal) => {
      const request = parseAgentStart(value)
      if (request.profileId) {
        /* Resolved HERE, not in the caller and not in the host: the store only
           holds folders the person picked through the OS dialog, and a stale
           or unknown profile refuses the start loudly instead of spawning an
           agent somewhere nobody chose. profileId is authoritative when
           present. */
        try {
          request.cwd = sessionProfiles.resolveCwd(request.profileId)
        } catch (error) {
          agentIpcError(
            'MC_AGENT_' + (typeof error?.code === 'string' ? error.code : 'PROFILE_UNKNOWN'),
            'That session profile could not be used: pick the folder again in its settings.',
          )
        }
        delete request.profileId
      }
      /* A START THAT NAMES NO FOLDER RUNS IN THE ONE THE PERSON CHOSE IN SETUP.
         Resolved BEFORE recordSpawnIntent below, so the signed record and the
         app-local record both carry the real folder instead of cwd:null, and
         so the confinement the host binds at spawn anchors on the chosen
         folder. A profile pick above still wins. */
      if (request.cwd === undefined) {
        const chosen = chosenWorkspaceCwd()
        if (chosen) request.cwd = chosen
      }
      if (agentSessions.has(request.sessionId)) {
        agentIpcError('MC_AGENT_SESSION_EXISTS', 'Session already exists: ' + request.sessionId)
      }
      if (agentSessions.size >= MAX_AGENT_SESSIONS) {
        agentIpcError('MC_AGENT_SESSION_LIMIT', 'At most ' + MAX_AGENT_SESSIONS + ' agent sessions may be open')
      }

      /* Before anything is spawned. If this throws, no process was created and
         nothing needs unwinding -- which is why it comes first. */
      const record = recordSpawnIntent(request)

      /* `turnsCompleted` starts at ZERO, not undefined, because zero is the
         true count for a session that is stopped before it ever answered. The
         owner is the principal's identity -- for the window, event.sender,
         exactly as before. `ownerKind` remembers WHAT KIND of principal that
         identity is, because the event fan-out must route by it: a window
         owner is a WebContents that can be sent to and destroyed, a relay
         owner is a stable token that is neither. */
      const session = { owner: principal.owner, ownerKind: principal.kind, state: 'starting', turnsCompleted: 0, lastTurnStatus: null, ended: false }
      agentSessions.set(request.sessionId, session)
      /* The destroyed hook is a fact about a WINDOW's owner: when its
         WebContents dies the app is on its way out and the sessions end with
         it. A relay principal's owner has no 'destroyed' event, and the
         design (§5.1) requires the opposite lifetime -- a dropped tab or a
         lease expiry must NOT kill remote sessions -- so for a relay
         principal the bind is deliberately a no-op and the session simply
         stays owned by the relay principal's stable owner token. */
      if (principal.kind !== 'relay') bindAgentOwner(principal.owner)
      try {
        const result = await getAgentHost().startSession(request)
        session.state = 'ready'
        /* `request.tier`, NOT `result.tier`: the request's is the MODEL ROW a
           person chose, the result's is the CONFINEMENT level. See the usage
           record for why the two were once confused. */
        session.tier = typeof request.tier === 'string' ? request.tier : null
        session.account = typeof result.account === 'string' ? result.account : null
        recordSpawnOutcome(request, record, 'started', null)
        /* The start this session's ending will resolve; set only after
           `started` is written, because a refused start has no run to end. If
           the child was already reported gone, that ending is written here. */
        session.started = { sequence: record.sequence }
        if (session.exitedBeforeStarted === true) recordSessionEnd(session, request.sessionId, 'exited')
        return { ...result, record: { sequence: record.sequence, eventHash: record.eventHash } }
      } catch (error) {
        if (error && error.code === 'AGENT_SESSION_CLEANUP_FAILED') {
          session.state = 'close-failed'
        } else if (agentSessions.get(request.sessionId) === session) {
          agentSessions.delete(request.sessionId)
        }
        /* Recorded BEFORE the throw, because the throw leaves this process and
           the reason is only in scope here. */
        recordSpawnOutcome(request, record, 'refused', typeof error?.code === 'string' ? error.code : null)
        throw rendererSafeAgentError(error)
      }
    },

    'agent:send': async (value, principal) => {
      try {
        const request = parseAgentSend(value)
        const session = ownedAgentSession(principal, request.sessionId)
        /* THE SECURITY LINE FOR IMAGES: the caller can never name an arbitrary
           disk path for the engine to read into model context. Only paths a
           person picked in this session's own native dialog ride -- anything
           else refuses by name, whether typed, guessed or replayed from
           another session. The allowlist is fed by exactly one command,
           agent:pick-attachment, which requires the same ownership this check
           does, so under a principal the fence reads: only paths issued by
           THIS principal's own picker for THIS session. */
        if (request.images && request.images.length) {
          const issued = session.attachments instanceof Set ? session.attachments : new Set()
          for (const image of request.images) {
            if (!issued.has(image.path)) {
              agentIpcError('MC_AGENT_ATTACHMENT_UNKNOWN', 'An attached file was not picked in this session, so nothing was sent')
            }
          }
        }
        return await currentAgentHost().sendTurn({
          sessionId: request.sessionId,
          text: request.text,
          ...(request.images ? { images: request.images } : {}),
          ...(request.model ? { options: { model: request.model } } : {}),
        })
      } catch (error) {
        throw rendererSafeAgentError(error)
      }
    },

    /* File one standing request. No session is required -- a rule can be
       filed before any agent runs -- so this goes through getAgentHost() like
       a start does. Bounds: the words cap matches the ledger module's own
       MAX_WORDS_BYTES (16KB); scope and key are bounded identifiers. */
    'agent:request': async (value) => {
      try {
        const payload = agentPayload(value, ['scope', 'key', 'words'])
        const scope = boundedAgentString(payload.scope, 'scope', 16)
        const words = boundedAgentString(payload.words, 'words', 16 * 1024)
        const key = payload.key === undefined || payload.key === null
          ? null
          : boundedAgentString(payload.key, 'key', 128)
        return await getAgentHost().fileStandingRequest({ scope, key, words })
      } catch (error) {
        throw rendererSafeAgentError(error)
      }
    },

    /* Read back the standing requests one scope carries. A READ AND NOTHING
       MORE; a file parse, so it does not go through getAgentHost(). */
    'agent:requests': async (value) => {
      try {
        const payload = agentPayload(value === undefined || value === null ? {} : value, ['scope', 'key'])
        const scope = boundedAgentString(payload.scope, 'scope', 16)
        const key = payload.key === undefined || payload.key === null
          ? null
          : boundedAgentString(payload.key, 'key', 128)
        return readStandingRequests({ scope, key })
      } catch (error) {
        throw rendererSafeAgentError(error)
      }
    },

    /* Session profiles. list/remove are plain store calls; create runs the OS
       folder dialog, so the only way a folder enters the store is the person
       choosing it in a native picker -- that dialog is the consent boundary
       the whole design rests on. */
    'agent:profiles': async () => {
      return { ok: true, profiles: sessionProfiles.list() }
    },

    'agent:profile-create': async (value) => {
      try {
        const payload = agentPayload(value, ['name'])
        const name = boundedAgentString(payload.name, 'name', 64)
        const picked = await dialog.showOpenDialog({
          title: 'Choose the folder agents in this profile work in',
          properties: ['openDirectory'],
        })
        if (picked.canceled || !picked.filePaths.length) return { ok: true, profile: null }
        const profile = sessionProfiles.create({ name, cwd: picked.filePaths[0] })
        return { ok: true, profile }
      } catch (error) {
        throw rendererSafeAgentError(error)
      }
    },

    'agent:profile-remove': async (value) => {
      try {
        const payload = agentPayload(value, ['profileId'])
        const removed = sessionProfiles.remove(boundedAgentString(payload.profileId, 'profileId', 128))
        return { ok: true, removed }
      } catch (error) {
        throw rendererSafeAgentError(error)
      }
    },

    /* THE ATTACHMENT PICKER -- the only way a file path enters a session's
       image allowlist. A native dialog the person drives; the chosen path is
       issued to exactly this session and refused everywhere else. */
    'agent:pick-attachment': async (value, principal) => {
      try {
        const request = parseAgentSessionCommand(value)
        const session = ownedAgentSession(principal, request.sessionId)
        const picked = await dialog.showOpenDialog({
          title: 'Attach an image to this message',
          properties: ['openFile'],
          filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
        })
        if (picked.canceled || !picked.filePaths.length) return { ok: true, path: null }
        const chosen = picked.filePaths[0]
        if (!(session.attachments instanceof Set)) session.attachments = new Set()
        session.attachments.add(chosen)
        return { ok: true, path: chosen }
      } catch (error) {
        throw rendererSafeAgentError(error)
      }
    },

    /* THE MENTION PICKER -- returns a path for the caller to insert as TEXT.
       No allowlist: it becomes words in the message, and the agent's own
       confined tools do (or refuse) the reading. */
    'agent:pick-mention': async (value, principal) => {
      try {
        const request = parseAgentSessionCommand(value)
        ownedAgentSession(principal, request.sessionId)
        const picked = await dialog.showOpenDialog({
          title: 'Mention a file in this message',
          defaultPath: WORKSPACE_ROOT,
          properties: ['openFile'],
        })
        if (picked.canceled || !picked.filePaths.length) return { ok: true, path: null }
        return { ok: true, path: picked.filePaths[0] }
      } catch (error) {
        throw rendererSafeAgentError(error)
      }
    },

    'agent:interrupt': async (value, principal) => {
      try {
        const request = parseAgentSessionCommand(value)
        ownedAgentSession(principal, request.sessionId)
        return await currentAgentHost().interrupt(request)
      } catch (error) {
        throw rendererSafeAgentError(error)
      }
    },

    /* THE APPROVAL ANSWER -- the reply half of approval_request. approvalPolicy
       is 'never' at every tier, so nothing fires this today; the path exists
       FIRST. */
    'agent:approval-answer': async (value, principal) => {
      try {
        const payload = agentPayload(value, ['sessionId', 'approvalId', 'decision'])
        const request = {
          sessionId: boundedAgentString(payload.sessionId, 'sessionId', MAX_SESSION_ID_LENGTH),
          approvalId: boundedAgentString(payload.approvalId, 'approvalId', 1024),
          decision: boundedAgentString(payload.decision, 'decision', 64),
        }
        ownedAgentSession(principal, request.sessionId)
        return await currentAgentHost().answerApproval(request)
      } catch (error) {
        throw rendererSafeAgentError(error)
      }
    },

    /* REWIND -- fork the session's thread at one of the person's own turns. */
    'agent:rewind': async (value, principal) => {
      try {
        const payload = agentPayload(value, ['sessionId', 'turnId'])
        const request = {
          sessionId: boundedAgentString(payload.sessionId, 'sessionId', MAX_SESSION_ID_LENGTH),
          turnId: boundedAgentString(payload.turnId, 'turnId', 512),
        }
        ownedAgentSession(principal, request.sessionId)
        return await currentAgentHost().rewindSession(request)
      } catch (error) {
        throw rendererSafeAgentError(error)
      }
    },

    /* How hard a running agent thinks: the engine's own knob, changed on a
       live thread rather than by restarting it. The closed set is
       load-bearing because the provider accepts an unknown effort silently. */
    'agent:effort': async (value, principal) => {
      try {
        const payload = agentPayload(value, ['sessionId', 'effort'])
        const effort = boundedAgentString(payload.effort, 'effort', 8)
        if (!AGENT_EFFORT_VALUES.includes(effort)) {
          agentIpcError('MC_AGENT_EFFORT_UNKNOWN', `effort must be one of: ${AGENT_EFFORT_VALUES.join(', ')}`)
        }
        const request = {
          sessionId: boundedAgentString(payload.sessionId, 'sessionId', MAX_SESSION_ID_LENGTH),
          effort,
        }
        ownedAgentSession(principal, request.sessionId)
        return await currentAgentHost().setSessionEffort(request)
      } catch (error) {
        throw rendererSafeAgentError(error)
      }
    },

    /* What this engine actually offers: the provider's model catalog. */
    'agent:models': async (value, principal) => {
      try {
        const payload = agentPayload(value || {}, ['sessionId'])
        const request = {}
        if (Object.prototype.hasOwnProperty.call(payload, 'sessionId')) {
          request.sessionId = boundedAgentString(payload.sessionId, 'sessionId', MAX_SESSION_ID_LENGTH)
          ownedAgentSession(principal, request.sessionId)
        }
        return await currentAgentHost().listEngineModels(request)
      } catch (error) {
        throw rendererSafeAgentError(error)
      }
    },

    'agent:close': async (value, principal) => {
      try {
        const request = parseAgentSessionCommand(value)
        const session = ownedAgentSession(principal, request.sessionId)
        const result = await currentAgentHost().closeSession(request)
        /* THE PERSON STOPPED IT -- the first genuine ending. Recorded once the
           close has actually resolved (a close that rejects throws past this
           line and leaves the session, and its record, exactly as they were),
           and before the session leaves the map. */
        recordSessionEnd(session, request.sessionId, 'closed')
        if (agentSessions.get(request.sessionId) === session) {
          agentSessions.delete(request.sessionId)
        }
        return result
      } catch (error) {
        throw rendererSafeAgentError(error)
      }
    },

    /* ---------- the declared organisation ----------
       The tier is NOT consulted here, deliberately: naming a manager or
       writing a role description is a statement of intent that grants no
       authority (`grantsAuthority: false` on the record the engine returns).
       The record answers its own refusals as {ok:false, ...}; the IPC wrapper
       in main.cjs keeps withFleetProfileSender's never-throws envelope. */
    'org:read': async () => agentOrgRecord.read(),

    'org:reparent': async (request) => agentOrgRecord.reparent({
      agentId: String(request?.agentId ?? ''),
      parentId: request?.parentId === null || request?.parentId === undefined ? null : String(request.parentId),
      expectedRevision: request?.expectedRevision,
    }),

    'org:assign-role': async (request) => agentOrgRecord.assignRole({
      agentId: String(request?.agentId ?? ''),
      role: String(request?.role ?? ''),
      expectedRevision: request?.expectedRevision,
    }),

    'org:create-role': async (request) => agentOrgRecord.createRole({
      id: String(request?.id ?? ''),
      baseDefaultRole: request?.baseDefaultRole ? String(request.baseDefaultRole) : null,
      rules: request?.rules,
    }),

    'org:edit-role': async (request) => agentOrgRecord.editRole({
      id: String(request?.id ?? ''),
      rules: request?.rules,
    }),

    'org:reset-role': async (request) => agentOrgRecord.resetRole({ id: String(request?.id ?? '') }),

    'org:reset': async () => agentOrgRecord.resetOrg(),

    'org:export': async () => agentOrgRecord.exportOrg(),
  })

  for (const command of Object.keys(COMMANDS)) {
    if (typeof handlers[command] !== 'function') {
      throw new Error('createAgentCommandSurface: inventory names a command with no body: ' + command)
    }
  }

  /* THE ORDER OF THE GATES, and why it is this order. The command must be one
     this surface knows; the principal must be one it can reason about; a
     read-only principal is refused every write BEFORE its payload is parsed
     (nothing it sends to a write is worth reading); a principal not at the
     keyboard is refused every dialog. Only then does the body run, with the
     checks it always made, in the order it always made them. */
  async function run(command, payload, principal) {
    const spec = COMMANDS[command]
    if (!spec) {
      agentIpcError(UNKNOWN_COMMAND_REFUSAL, 'No such agent command: ' + String(command))
    }
    if (!validPrincipal(principal)) {
      agentIpcError(PRINCIPAL_REFUSAL, 'The caller of ' + command + ' did not identify itself in the documented shape, so nothing was done.')
    }
    if (spec.write && principal.mayWrite !== true) {
      agentIpcError(
        READ_ONLY_REFUSAL,
        principal.label + ' may read this computer\'s agents but not change them, so ' + command + ' was refused.',
      )
    }
    if (spec.dialog && principal.kind !== 'window') {
      agentIpcError(
        DIALOG_REFUSAL,
        command + ' opens a dialog on this computer, and ' + principal.label + ' is not at its keyboard, so it was refused.',
      )
    }
    return handlers[command](payload, principal)
  }

  /* ---------- the event fan-out seam ----------
     The fan-out itself stays in main.cjs (host.onEvent is wired where the
     host is built), but the ROUTING DECISION lives here, where the principal
     kinds are defined. A relay-owned session's packet goes to the injected
     emitRelayEvent -- the facade's ring buffer -- because its owner is a
     token, not a WebContents; with no sink wired the packet is dropped,
     counted and logged, NEVER thrown, because an event fan-out that can
     take down the host loop is worse than a lost packet. Returns true when
     the packet belonged to a relay-owned session (handled or dropped here),
     false when it is the caller's to forward to the window exactly as it
     always has. */
  let relayEventsDropped = 0
  function forwardSessionEvent(packet) {
    const session = agentSessions.get(packet && packet.sessionId)
    if (!session || session.ownerKind !== 'relay') return false
    if (typeof emitRelayEvent !== 'function') {
      relayEventsDropped += 1
      if (log && (relayEventsDropped === 1 || relayEventsDropped % 500 === 0)) {
        try { log('events for relay-owned sessions have no sink (emitRelayEvent is not wired); dropped so far: ' + relayEventsDropped) } catch { /* the log must never break the fan-out */ }
      }
      return true
    }
    try {
      emitRelayEvent(packet)
    } catch {
      relayEventsDropped += 1
      if (log) {
        try { log('the relay event sink threw and the packet was dropped (' + relayEventsDropped + ' dropped so far)') } catch { /* see above */ }
      }
    }
    return true
  }

  return Object.freeze({
    run,
    commands: Object.freeze(Object.keys(COMMANDS)),
    isWrite: (command) => Boolean(COMMANDS[command] && COMMANDS[command].write),
    needsDialog: (command) => Boolean(COMMANDS[command] && COMMANDS[command].dialog),
    forwardSessionEvent,
    /* How full this machine is, for the facade's remote-status: the count a
       browser may honestly be shown ("N of 8 sessions") without a start. */
    sessionLoad: () => ({ open: agentSessions.size, max: MAX_AGENT_SESSIONS }),
    relayEventDropCount: () => relayEventsDropped,
  })
}

module.exports = {
  createAgentCommandSurface,
  COMMANDS,
  REQUIRED_DEPS,
  READ_ONLY_REFUSAL,
  DIALOG_REFUSAL,
  PRINCIPAL_REFUSAL,
  UNKNOWN_COMMAND_REFUSAL,
}
