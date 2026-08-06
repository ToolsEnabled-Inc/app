/**
 * Shared, fail-closed projection machinery for the six Mission Control data
 * domains.  This module never reads live SQLite files and never reaches the
 * network.  Domain generators use existing ToolsEnabled readers/CLIs, validate
 * their complete payload against the public schema, then replace one snapshot
 * atomically.  Invalid payloads are not emitted.
 */
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))

export const PROJECT_ROOT = dirname(here)
export const CANONICAL_ROOT = resolve(process.env.MC_CANONICAL_ROOT || 'C:/Users/joshp/Desktop/toolsenabled-current')
export const LIVE_ROOT = resolve(process.env.MC_LIVE_ROOT || 'C:/Users/joshp/Desktop/ToolsEnabled')
export const OUTPUT_ROOT = resolve(process.env.MC_OUTPUT_ROOT || join(PROJECT_ROOT, 'public', 'data'))
export const SCHEMA_ROOT = resolve(process.env.MC_SCHEMA_ROOT || join(PROJECT_ROOT, 'public', 'data', 'schema'))
// Match the established gen-status behavior: real runs refresh both the build
// input and an already-built static preview. Tests that set MC_OUTPUT_ROOT are
// intentionally single-target and never touch the worktree's dist directory.
export const DIST_OUTPUT_ROOT = process.env.MC_OUTPUT_ROOT
  ? null
  : resolve(process.env.MC_DIST_OUTPUT_ROOT || join(PROJECT_ROOT, 'dist', 'data'))
export const SCHEMA_VERSION = 1

export const DOMAINS = Object.freeze(['fleet', 'agents', 'metrics', 'ops', 'ledger', 'coordinator'])

const SECRET_PATTERNS = Object.freeze([
  /sk_live_[A-Za-z0-9]+/,
  /sk-[A-Za-z0-9]{20,}/,
  /AIza[0-9A-Za-z_-]{20,}/,
  /ghp_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /xox[a-z]?-[A-Za-z0-9-]+/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
  /\bAKIA[0-9A-Z]{16}\b/,
])

export class ProjectionError extends Error {
  constructor(code, message, details = undefined) {
    super(message)
    this.name = 'ProjectionError'
    this.code = code
    if (details !== undefined) this.details = details
  }
}

function fail(code, message, details) {
  throw new ProjectionError(code, message, details)
}

export function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function generatedAt() {
  const value = process.env.MC_NOW || new Date().toISOString()
  if (!Number.isFinite(Date.parse(value))) fail('PROJECTION_CLOCK_INVALID', 'MC_NOW must be an ISO-compatible timestamp.')
  return new Date(value).toISOString()
}

export function unavailable(reason, observedAt = null) {
  return Object.freeze({ ok: false, reason: cleanReason(reason), observedAt: normalizeTimestamp(observedAt), value: null })
}

export function available(value, observedAt = null) {
  return Object.freeze({ ok: true, reason: null, observedAt: normalizeTimestamp(observedAt), value })
}

export function source({ id, kind, path, ok, observedAt = null, reason = null }) {
  return Object.freeze({
    id: cleanId(id),
    kind: cleanId(kind),
    path: cleanPath(path),
    ok: Boolean(ok),
    observedAt: normalizeTimestamp(observedAt),
    reason: ok ? null : cleanReason(reason),
  })
}

export function availableEnvelope(domain, data, sources, at = generatedAt()) {
  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    domain: assertDomain(domain),
    generatedAt: normalizeTimestamp(at, true),
    ok: true,
    reason: null,
    sources: Object.freeze([...sources]),
    data,
  })
}

export function unavailableEnvelope(domain, reason, sources = [], at = generatedAt()) {
  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    domain: assertDomain(domain),
    generatedAt: normalizeTimestamp(at, true),
    ok: false,
    reason: cleanReason(reason),
    sources: Object.freeze([...sources]),
    data: null,
  })
}

export function readJsonFile(root, relativePath, sourceId) {
  const result = readTextFile(root, relativePath, sourceId)
  if (!result.ok) return result
  try {
    return { ...result, value: JSON.parse(result.value) }
  } catch {
    return { ok: false, reason: 'source-malformed', sourceId, path: slash(relativePath), observedAt: result.observedAt }
  }
}

export function readTextFile(root, relativePath, sourceId) {
  const absolute = resolveUnder(root, relativePath)
  try {
    const value = readFileSync(absolute, 'utf8')
    const observedAt = new Date(statSync(absolute).mtimeMs).toISOString()
    return { ok: true, value, sourceId, path: slash(relativePath), observedAt }
  } catch (error) {
    return {
      ok: false,
      reason: error?.code === 'ENOENT' ? 'source-missing' : 'source-unreadable',
      sourceId,
      path: slash(relativePath),
      observedAt: null,
    }
  }
}

export function loadReader(root, relativePath, sourceId) {
  const absolute = resolveUnder(root, relativePath)
  try {
    const value = require(absolute)
    const observedAt = new Date(statSync(absolute).mtimeMs).toISOString()
    return { ok: true, value, sourceId, path: slash(relativePath), observedAt }
  } catch (error) {
    return {
      ok: false,
      reason: error?.code === 'MODULE_NOT_FOUND' ? 'source-missing' : 'source-reader-failed',
      sourceId,
      path: slash(relativePath),
      observedAt: null,
      errorCode: typeof error?.code === 'string' ? error.code : null,
    }
  }
}

/** Run a bounded existing JSON CLI from its own tree. No shell is involved. */
export function runJsonCli(root, relativeScript, args = [], sourceId = relativeScript, timeoutMs = 15_000) {
  const script = resolveUnder(root, relativeScript)
  if (!existsSync(script)) {
    return { ok: false, reason: 'source-unreachable', sourceId, path: slash(relativeScript), observedAt: null }
  }
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], {
      cwd: root,
      encoding: 'utf8',
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const value = JSON.parse(stdout)
    const observedAt = normalizeTimestamp(value?.generatedAt)
    return { ok: true, value, sourceId, path: slash(relativeScript), observedAt }
  } catch (error) {
    const reason = error instanceof SyntaxError
      ? 'source-malformed'
      : (error?.code === 'ETIMEDOUT' || error?.killed ? 'source-timeout' : 'source-unreachable')
    return { ok: false, reason, sourceId, path: slash(relativeScript), observedAt: null }
  }
}

export function sourceFromResult(result, kind) {
  return source({
    id: result.sourceId,
    kind,
    path: result.path,
    ok: result.ok,
    observedAt: result.observedAt,
    reason: result.reason,
  })
}

export function timestampFromAge(referenceIso, ageMs) {
  const reference = Date.parse(referenceIso)
  if (!Number.isFinite(reference) || !Number.isFinite(ageMs) || ageMs < 0) return null
  return new Date(Math.max(0, reference - ageMs)).toISOString()
}

export function readSchema(domain) {
  assertDomain(domain)
  const path = join(SCHEMA_ROOT, `${domain}.schema.json`)
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    fail('PROJECTION_SCHEMA_UNAVAILABLE', `Schema for ${domain} is unavailable.`, { code: error?.code || null })
  }
  try {
    return JSON.parse(raw)
  } catch {
    fail('PROJECTION_SCHEMA_MALFORMED', `Schema for ${domain} is malformed JSON.`)
  }
}

/**
 * Validate the deliberately small JSON-Schema subset used by public/data.
 * Returning errors instead of throwing makes the same fixtures usable by the
 * browser reader; emitProjection is the fail-closed throwing boundary.
 */
export function validateAgainstSchema(value, schema, rootSchema = schema, path = '$') {
  const errors = []
  validateNode(value, schema, rootSchema, path, errors)
  return errors
}

export function assertValidProjection(domain, payload, schema = readSchema(domain)) {
  if (!recognizedProjectionSchema(schema, domain)) {
    fail('PROJECTION_SCHEMA_UNRECOGNIZED', `Schema for ${domain} does not declare the required v1 contract.`)
  }
  const errors = validateAgainstSchema(payload, schema)
  if (errors.length) {
    fail('PROJECTION_SCHEMA_REJECTED', `Projection ${domain} failed schema validation.`, errors.slice(0, 12))
  }
  const serialized = JSON.stringify(payload)
  if (SECRET_PATTERNS.some(pattern => pattern.test(serialized))) {
    fail('PROJECTION_SECRET_REJECTED', `Projection ${domain} contains secret-shaped content.`)
  }
  return payload
}

function recognizedProjectionSchema(schema, domain) {
  return plainObject(schema)
    && schema.type === 'object'
    && schema.additionalProperties === false
    && typeof schema.$schema === 'string'
    && typeof schema.$id === 'string'
    && schema.$id.endsWith(`/${domain}.schema.json`)
    && plainObject(schema.properties)
    && schema.properties.schemaVersion?.const === SCHEMA_VERSION
    && schema.properties.domain?.const === domain
    && plainObject(schema.$defs?.source)
    && plainObject(schema.$defs?.data)
    && Array.isArray(schema.required)
    && ['schemaVersion', 'domain', 'generatedAt', 'ok', 'reason', 'sources', 'data']
      .every(key => schema.required.includes(key))
}

export function writeProjection(domain, payload) {
  assertValidProjection(domain, payload)
  const targets = [OUTPUT_ROOT, DIST_OUTPUT_ROOT].filter(Boolean).map(root => join(root, `${domain}.json`))
  const content = `${JSON.stringify(payload, null, 2)}\n`
  for (const target of targets) {
    mkdirSync(dirname(target), { recursive: true })
    const temporary = `${target}.${process.pid}.tmp`
    try {
      writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx' })
      renameSync(temporary, target)
    } finally {
      try { rmSync(temporary, { force: true }) } catch {}
    }
  }
  return targets
}

export async function emitProjection(domain, build) {
  assertDomain(domain)
  const at = generatedAt()
  let payload
  try {
    payload = await build(at)
  } catch (error) {
    const reason = error instanceof ProjectionError ? cleanReason(error.code.toLowerCase().replaceAll('_', '-')) : 'source-reader-failed'
    payload = unavailableEnvelope(domain, reason, [], at)
  }
  const targets = writeProjection(domain, payload)
  process.stdout.write(`${JSON.stringify({ domain, ok: payload.ok, reason: payload.reason, generatedAt: payload.generatedAt, targets: targets.map(slash) })}\n`)
  return payload
}

function validateNode(value, schema, rootSchema, path, errors) {
  if (!plainObject(schema)) {
    errors.push(`${path}: schema node is not an object`)
    return
  }
  if (typeof schema.$ref === 'string') {
    const target = resolveRef(rootSchema, schema.$ref)
    if (!target) errors.push(`${path}: unresolved schema reference ${schema.$ref}`)
    else validateNode(value, target, rootSchema, path, errors)
    return
  }
  if (Array.isArray(schema.allOf)) {
    for (const candidate of schema.allOf) validateNode(value, candidate, rootSchema, path, errors)
  }
  if (Array.isArray(schema.anyOf)) {
    const matches = schema.anyOf.filter(candidate => validateAgainstSchema(value, candidate, rootSchema, path).length === 0)
    if (matches.length === 0) errors.push(`${path}: does not match any allowed shape`)
  }
  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter(candidate => validateAgainstSchema(value, candidate, rootSchema, path).length === 0)
    if (matches.length !== 1) errors.push(`${path}: must match exactly one allowed shape (matched ${matches.length})`)
  }
  if (plainObject(schema.if)) {
    const matched = validateAgainstSchema(value, schema.if, rootSchema, path).length === 0
    if (matched && plainObject(schema.then)) validateNode(value, schema.then, rootSchema, path, errors)
    if (!matched && plainObject(schema.else)) validateNode(value, schema.else, rootSchema, path, errors)
  }
  if (Object.hasOwn(schema, 'const') && !deepEqual(value, schema.const)) errors.push(`${path}: must equal the declared constant`)
  if (Array.isArray(schema.enum) && !schema.enum.some(entry => deepEqual(value, entry))) errors.push(`${path}: value is not in the declared enum`)

  const allowedTypes = Array.isArray(schema.type) ? schema.type : (typeof schema.type === 'string' ? [schema.type] : [])
  if (allowedTypes.length && !allowedTypes.some(type => typeMatches(value, type))) {
    errors.push(`${path}: expected ${allowedTypes.join('|')}`)
    return
  }

  if (plainObject(value)) {
    const properties = plainObject(schema.properties) ? schema.properties : {}
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) if (!Object.hasOwn(value, key)) errors.push(`${path}: missing required property ${key}`)
    }
    for (const [key, child] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) validateNode(child, properties[key], rootSchema, `${path}.${key}`, errors)
      else if (schema.additionalProperties === false) errors.push(`${path}: unexpected property ${key}`)
      else if (plainObject(schema.additionalProperties)) validateNode(child, schema.additionalProperties, rootSchema, `${path}.${key}`, errors)
    }
    if (Number.isSafeInteger(schema.minProperties) && Object.keys(value).length < schema.minProperties) errors.push(`${path}: too few properties`)
    if (Number.isSafeInteger(schema.maxProperties) && Object.keys(value).length > schema.maxProperties) errors.push(`${path}: too many properties`)
  }

  if (Array.isArray(value)) {
    if (Number.isSafeInteger(schema.minItems) && value.length < schema.minItems) errors.push(`${path}: too few items`)
    if (Number.isSafeInteger(schema.maxItems) && value.length > schema.maxItems) errors.push(`${path}: too many items`)
    if (schema.uniqueItems === true) {
      const keys = value.map(item => JSON.stringify(item))
      if (new Set(keys).size !== keys.length) errors.push(`${path}: items must be unique`)
    }
    if (plainObject(schema.items)) value.forEach((item, index) => validateNode(item, schema.items, rootSchema, `${path}[${index}]`, errors))
  }

  if (typeof value === 'string') {
    if (Number.isSafeInteger(schema.minLength) && value.length < schema.minLength) errors.push(`${path}: string is too short`)
    if (Number.isSafeInteger(schema.maxLength) && value.length > schema.maxLength) errors.push(`${path}: string is too long`)
    if (typeof schema.pattern === 'string' && !(new RegExp(schema.pattern, 'u')).test(value)) errors.push(`${path}: string does not match pattern`)
    if (schema.format === 'date-time' && !Number.isFinite(Date.parse(value))) errors.push(`${path}: invalid date-time`)
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (typeof schema.minimum === 'number' && value < schema.minimum) errors.push(`${path}: number is below minimum`)
    if (typeof schema.maximum === 'number' && value > schema.maximum) errors.push(`${path}: number is above maximum`)
  }
}

function resolveRef(rootSchema, ref) {
  if (!ref.startsWith('#/')) return null
  let current = rootSchema
  for (const raw of ref.slice(2).split('/')) {
    const key = raw.replaceAll('~1', '/').replaceAll('~0', '~')
    if (!plainObject(current) || !Object.hasOwn(current, key)) return null
    current = current[key]
  }
  return current
}

function typeMatches(value, type) {
  if (type === 'null') return value === null
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return plainObject(value)
  if (type === 'integer') return Number.isSafeInteger(value)
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  return typeof value === type
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function assertDomain(domain) {
  if (!DOMAINS.includes(domain)) fail('PROJECTION_DOMAIN_INVALID', `Unknown projection domain: ${domain}`)
  return domain
}

function cleanId(value) {
  const text = String(value || '')
  if (!/^[a-z][a-z0-9._-]{0,79}$/.test(text)) fail('PROJECTION_SOURCE_ID_INVALID', 'Projection source id is invalid.')
  return text
}

function cleanPath(value) {
  const text = slash(String(value || ''))
  if (!text || text.length > 240 || text.includes('\0')) fail('PROJECTION_SOURCE_PATH_INVALID', 'Projection source path is invalid.')
  return text
}

function cleanReason(value) {
  const text = String(value || 'source-unavailable').trim().toLowerCase().replace(/[^a-z0-9._:-]+/g, '-')
  return text.slice(0, 160) || 'source-unavailable'
}

function normalizeTimestamp(value, required = false) {
  if (value === undefined || value === null || value === '') {
    if (required) fail('PROJECTION_TIMESTAMP_INVALID', 'A required timestamp is missing.')
    return null
  }
  const milliseconds = Date.parse(String(value))
  if (!Number.isFinite(milliseconds)) {
    if (required) fail('PROJECTION_TIMESTAMP_INVALID', 'A required timestamp is malformed.')
    return null
  }
  return new Date(milliseconds).toISOString()
}

function resolveUnder(root, relativePath) {
  const base = resolve(root)
  if (isAbsolute(relativePath)) fail('PROJECTION_SOURCE_PATH_INVALID', 'Source paths must be relative to their declared root.')
  const target = resolve(base, relativePath)
  const prefix = `${base.toLowerCase()}\\`
  if (target.toLowerCase() !== base.toLowerCase() && !target.toLowerCase().startsWith(prefix)) {
    fail('PROJECTION_SOURCE_PATH_INVALID', 'Source path escapes its declared root.')
  }
  return target
}

function slash(value) {
  return String(value).replaceAll('\\', '/')
}

/* Terse, content-preserving typesetting for raw service detail strings.
 * Mechanical transforms only — never invents or drops a fact:
 * separators normalize to " · ", "--" becomes an em-dash, key=true flattens
 * to the key, key=value to "key value", snake_case opens up, SHOUTED words
 * lower to sentence case, and immediately repeated tokens collapse. */
export function terseDetail(value) {
  if (typeof value !== 'string') return null
  let text = value.trim()
  if (!text) return null
  text = text.replace(/\s*--\s*/g, ' — ')
  text = text.replace(/,\s+(?=(?:but|and|or|so|yet|while)\b)/gi, ', ')
  text = text.replace(/\s*\/\s*/g, ' · ')
  text = text.replace(/,\s+(?!(?:but|and|or|so|yet|while)\b)/gi, ' · ')
  text = text.replace(/\s*;\s*/g, ' · ')
  text = text.replace(/\(([^)]+)\)/g, (_, inner) => `— ${inner.replace(/_/g, ' ')}`)
  text = text.replace(/\b([A-Za-z][A-Za-z0-9_.-]*)=(\S+)/g, (_, key, raw) => {
    const k = key.replace(/_/g, ' ')
    if (/^true$/i.test(raw)) return k
    if (/^false$/i.test(raw)) return `not ${k}`
    return `${k} ${raw}`
  })
  text = text.replace(/\b[A-Z]{3,}\b/g, word => word.toLowerCase())
  const parts = text.split(' · ').map(part => part.trim()).filter(Boolean)
  const deduped = parts.filter((part, index) => index === 0 || part.toLowerCase() !== parts[index - 1].toLowerCase())
  return deduped.join(' · ').replace(/\s{2,}/g, ' ').trim() || null
}
