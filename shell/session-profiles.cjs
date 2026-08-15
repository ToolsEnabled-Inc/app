'use strict'

/* SESSION PROFILES — the main process's own record of the working folders a
 * person has chosen for their agents.
 *
 * The owner's ask (iteration 5, W6): different trees run agents under
 * different "profiles" — at minimum a working folder — because one
 * onboarding polluting non-ToolsEnabled work is a real, daily pain. Codex
 * discovers its instructions from the directory it runs in, so per-tree cwd
 * IS per-tree onboarding.
 *
 * WHY THIS LIVES IN THE MAIN PROCESS, AND NOT IN RENDERER STORAGE. The
 * boundary is the point: a session's working directory decides what an agent
 * can read and which instructions it wakes into, and normalizeCwd in
 * agent-host.cjs validates existence only — no containment. So the renderer
 * NEVER sends a raw path for a session. It sends a profileId; this store —
 * which only ever holds folders the person picked through the OS folder
 * dialog — resolves it. A hand-built IPC payload can name a profile that
 * exists or be refused; it cannot smuggle a path.
 *
 * Storage: <userData>/session-profiles.json, atomic replace, damaged file
 * degrades to an empty list (the research-queue-store doctrine: absence and
 * damage are the same honest answer — nothing).
 */

const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const MAX_PROFILES = 16
const MAX_NAME_LENGTH = 64
const MAX_CWD_LENGTH = 1024
const FILE_VERSION = 1

function createSessionProfileStore({ file }) {
  if (typeof file !== 'string' || !file) throw new Error('session-profile store needs its file path')

  function readAll() {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (!parsed || parsed.v !== FILE_VERSION || !Array.isArray(parsed.profiles)) return []
      return parsed.profiles.filter(entry =>
        entry && typeof entry.id === 'string' && typeof entry.name === 'string' && typeof entry.cwd === 'string')
    } catch {
      return []
    }
  }

  function writeAll(profiles) {
    const temp = `${file}.tmp-${process.pid}`
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(temp, JSON.stringify({ v: FILE_VERSION, profiles }, null, 2))
    fs.renameSync(temp, file)
  }

  function assertUsableFolder(cwd) {
    if (typeof cwd !== 'string' || !cwd || cwd.length > MAX_CWD_LENGTH || cwd.includes('\0')) {
      throw refusal('PROFILE_FOLDER_INVALID', 'The chosen folder path is not usable.')
    }
    let stat
    try { stat = fs.statSync(cwd) } catch {
      throw refusal('PROFILE_FOLDER_MISSING', 'That folder does not exist any more. Pick it again.')
    }
    if (!stat.isDirectory()) throw refusal('PROFILE_FOLDER_NOT_DIRECTORY', 'That path is a file, not a folder.')
    if (cwd.includes('.asar')) throw refusal('PROFILE_FOLDER_INVALID', 'That folder is inside the application package.')
  }

  function refusal(code, message) {
    const error = new Error(message)
    error.code = code
    return error
  }

  return {
    list() {
      return readAll().map(entry => ({ id: entry.id, name: entry.name, cwd: entry.cwd }))
    },

    create({ name, cwd }) {
      const cleanName = typeof name === 'string' ? name.trim().slice(0, MAX_NAME_LENGTH) : ''
      if (!cleanName) throw refusal('PROFILE_NAME_MISSING', 'Give the profile a name.')
      assertUsableFolder(cwd)
      const profiles = readAll()
      if (profiles.length >= MAX_PROFILES) {
        throw refusal('PROFILE_LIMIT', `This computer holds ${MAX_PROFILES} profiles already. Remove one to add another.`)
      }
      if (profiles.some(entry => entry.name.toLowerCase() === cleanName.toLowerCase())) {
        throw refusal('PROFILE_NAME_TAKEN', 'A profile with that name already exists.')
      }
      const profile = { id: `profile-${randomUUID()}`, name: cleanName, cwd, createdAt: new Date().toISOString() }
      writeAll([...profiles, profile])
      return { id: profile.id, name: profile.name, cwd: profile.cwd }
    },

    remove(id) {
      const profiles = readAll()
      const next = profiles.filter(entry => entry.id !== id)
      if (next.length === profiles.length) return false
      writeAll(next)
      return true
    },

    /* The start path's resolver: id in, validated folder out. Refuses an
       unknown id and a folder that vanished since it was picked — a stale
       profile must fail the START loudly, not spawn an agent somewhere the
       person did not choose. */
    resolveCwd(id) {
      const entry = readAll().find(profile => profile.id === id)
      if (!entry) throw refusal('PROFILE_UNKNOWN', 'That session profile is not on this computer.')
      assertUsableFolder(entry.cwd)
      return entry.cwd
    },
  }
}

module.exports = { createSessionProfileStore, MAX_PROFILES, MAX_NAME_LENGTH }
