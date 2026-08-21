#!/usr/bin/env node

/* WHICH TOOLS DOES AN AGENT SESSION ACTUALLY GET, PER LEVEL, PER PROVIDER --
 * MEASURED FROM REAL SESSIONS AGAINST THE STAGED PAYLOAD, NOT READ FROM SOURCE.
 *
 * WHY THIS DRIVER EXISTS. The first outside user reported that their agents
 * "weren't able to use credential manager or vault". Whether that is a defect,
 * a deliberate limit, or a broken tool cannot be answered by reading the
 * registry, because the surface an agent sees is decided at spawn time by the
 * generated configuration -- and this repository has already shipped three
 * separate defects that lived only in that seam (the empty-document packaged
 * install, the stale nodePath second window, the missing ELECTRON_RUN_AS_NODE).
 *
 * WHAT IT DOES. For every permission level (guided / standard / unrestricted)
 * and both provider config shapes, it builds a fresh scratch installation --
 * sealed machine record, scratch state root, scratch services root -- exactly
 * the way the product does, then generates the configuration each provider's
 * session reads:
 *
 *   codex   the confined home's config.toml, written by the payload's own
 *           agent-session-confinement.confinedSessionPlan()
 *   claude  the `.mcp.json` a Claude lane is handed via --mcp-config, written
 *           by the payload's own machine-record.writeMcpConfig() the way
 *           shell/setup-record.cjs writes it
 *
 * and then STARTS every server those documents name, over real stdio JSON-RPC,
 * and records what each one advertises in tools/list. Nothing is asserted from
 * the allowlist string; the count is the server's own answer.
 *
 * IT THEN ANSWERS THE CREDENTIAL QUESTION END TO END. On the level that should
 * carry the credential surface it drives the real flow an agent would run:
 * owner_forms.describe -> system.credential_request (acknowledged) ->
 * owner_prompts.status, all against the scratch state root. On the read-only
 * level it captures the verbatim refusal the user's agent actually hit.
 *
 * SCRATCH STATE ONLY. TOOLSENABLED_STATE_ROOT and LOCALAPPDATA are pointed at
 * a temporary directory before the first payload require, so nothing in this
 * run can read or write the real installation's records or vault.
 *
 *   node tools/agent-tools-matrix-qa.mjs [--json <file>]
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const STAGED = path.join(REPO, 'release', 'win-unpacked', 'resources', 'capability')
const PAYLOAD = existsSync(path.join(STAGED, 'src', 'mcp-server.js')) ? STAGED : path.join(REPO, 'capability')
const require_ = createRequire(import.meta.url)

/* The scratch installation, claimed BEFORE any payload module is required.
 * src/lib state modules decide their root at first require; a require that
 * happens first wins, and the loser is the real user's state. */
const SCRATCH = mkdtempSync(path.join(tmpdir(), 'tool-matrix-'))
process.env.TOOLSENABLED_STATE_ROOT = path.join(SCRATCH, 'state')
process.env.LOCALAPPDATA = path.join(SCRATCH, 'local')
delete process.env.CODEX_HOME
mkdirSync(process.env.TOOLSENABLED_STATE_ROOT, { recursive: true })
mkdirSync(process.env.LOCALAPPDATA, { recursive: true })

const machineRecord = require_(path.join(PAYLOAD, 'src/lib/setup/machine-record.js'))
const confinement = require_(path.join(PAYLOAD, 'src/lib/agent-session-confinement.js'))

const TIERS = ['guided', 'standard', 'unrestricted']

/* The credential-manager / vault surface, by real registry name. These are the
 * tools an agent uses to see, request, and consume owner credentials. */
const CREDENTIAL_SURFACE = [
  'system.doctor',
  'owner_forms.describe',
  'owner_prompts.status',
  'owner_prompts.events',
  'system.credential_request',
  'owner_prompts.start',
  'owner_prompts.cancel',
  'payment_method.card_status',
  'payment_method.card_register',
  'http.request',
  'gcloud.service_account_key_to_vault',
]

const findings = []
const note = (level, text) => { findings.push({ level, text }); console.log(`  ${level.padEnd(5)} ${text}`) }

/* ---------------------------------------------------------------- rpc -- */

function startServer(entry, { baseEnv }) {
  const child = spawn(entry.command, entry.args, {
    cwd: entry.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...baseEnv, ...(entry.env || {}) },
  })
  let stdout = ''
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += String(chunk) })
  const waiting = new Map()
  child.stdout.on('data', chunk => {
    stdout += String(chunk)
    let index = stdout.indexOf('\n')
    while (index >= 0) {
      const line = stdout.slice(0, index).trim()
      stdout = stdout.slice(index + 1)
      index = stdout.indexOf('\n')
      if (!line) continue
      let message = null
      try { message = JSON.parse(line) } catch { continue }
      const resolve = waiting.get(message.id)
      if (resolve) { waiting.delete(message.id); resolve(message) }
    }
  })
  let nextId = 1
  const call = (method, params, timeoutMs = 60_000) => new Promise((resolve, reject) => {
    const id = nextId++
    waiting.set(id, resolve)
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    setTimeout(() => {
      if (waiting.delete(id)) reject(new Error(`${method} did not answer in ${timeoutMs / 1000}s; stderr: ${stderr.slice(0, 400)}`))
    }, timeoutMs)
  })
  return { child, call, stop: () => { try { child.kill() } catch { /* already gone */ } }, stderrText: () => stderr }
}

function structured(answer) {
  const result = answer && answer.result
  if (result && result.structuredContent) return result.structuredContent
  const text = result && Array.isArray(result.content) && result.content[0] && result.content[0].text
  if (typeof text === 'string') { try { return JSON.parse(text) } catch { return { text } } }
  if (answer && answer.error) return { error: answer.error }
  return answer
}

async function enumerateTools(entry, { baseEnv, label }) {
  const server = startServer(entry, { baseEnv })
  try {
    await server.call('initialize', {
      protocolVersion: '2025-06-18', capabilities: {},
      clientInfo: { name: 'tool-matrix-qa', version: '1' },
    })
    const listed = await server.call('tools/list', {})
    const tools = ((listed.result && listed.result.tools) || []).map(tool => tool.name)
    return { ok: true, tools, server }
  } catch (error) {
    server.stop()
    return { ok: false, reason: `${label}: ${error.message}`, tools: [], server: null }
  }
}

/* ------------------------------------------------- config.toml reader -- */

/* Reads exactly the shapes confinedCodexConfig() writes: literal single-quoted
 * strings, one server table and one optional env table per server. */
function parseConfinedToml(text) {
  const servers = {}
  let current = null
  let target = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const envHeader = /^\[mcp_servers\.([A-Za-z0-9_-]+)\.env\]$/.exec(line)
    if (envHeader) {
      current = servers[envHeader[1]] = servers[envHeader[1]] || {}
      current.env = current.env || {}
      target = 'env'
      continue
    }
    const header = /^\[mcp_servers\.([A-Za-z0-9_-]+)\]$/.exec(line)
    if (header) {
      current = servers[header[1]] = servers[header[1]] || {}
      target = 'entry'
      continue
    }
    const pair = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line)
    if (!pair || !current) continue
    const [, key, value] = pair
    const literal = /^'([^']*)'$/.exec(value)
    const list = /^\[(.*)\]$/.exec(value)
    const parsed = literal
      ? literal[1]
      : list
        ? [...list[1].matchAll(/'([^']*)'/g)].map(match => match[1])
        : value
    if (target === 'env') current.env[key] = parsed
    else current[key] = parsed
  }
  return servers
}

/* -------------------------------------------------------------- cells -- */

function baseEnvFor() {
  return {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    /* Where the machine record lives in this scratch installation; the real
       spawn inherits the app's LOCALAPPDATA the same way. */
    LOCALAPPDATA: process.env.LOCALAPPDATA,
  }
}

async function measureDocument(document, { providerLabel, tier, results }) {
  for (const [name, entry] of Object.entries(document.mcpServers || {})) {
    if (name === 'playwright') {
      /* The gateway needs the pinned @playwright/mcp package resolvable; it is
         attempted like every other server, with its failure recorded rather
         than hidden, but a slow npx cold start is bounded shorter. */
      const attempt = await enumerateTools(entry, { baseEnv: baseEnvFor(), label: `${tier}/${providerLabel}/${name}` })
      results.push({ tier, provider: providerLabel, server: name, ok: attempt.ok, count: attempt.tools.length, reason: attempt.ok ? null : attempt.reason })
      if (attempt.server) attempt.server.stop()
      note(attempt.ok ? 'ok' : 'warn', `${tier} ${providerLabel} ${name}: ${attempt.ok ? `${attempt.tools.length} tools` : attempt.reason}`)
      continue
    }
    const attempt = await enumerateTools(entry, { baseEnv: baseEnvFor(), label: `${tier}/${providerLabel}/${name}` })
    const credentialTools = CREDENTIAL_SURFACE.filter(tool => attempt.tools.includes(tool))
    results.push({
      tier, provider: providerLabel, server: name, ok: attempt.ok,
      count: attempt.tools.length,
      credentialTools,
      env: Object.keys(entry.env || {}),
      reason: attempt.ok ? null : attempt.reason,
    })
    note(attempt.ok ? 'ok' : 'FAIL',
      `${tier} ${providerLabel} ${name}: ${attempt.ok ? `${attempt.tools.length} tools; credential surface: [${credentialTools.join(', ')}]` : attempt.reason}`)
    if (attempt.server) attempt.server.stop()
  }
}

/* The record shell/setup-record.cjs hands the generator for `.mcp.json`:
 * installRoot substituted to the engine root, nodePath to the running binary. */
function assistantConfigRecord(record) {
  return { ...record, installRoot: PAYLOAD, nodePath: process.execPath }
}

async function main() {
  console.log(`\npayload under measurement: ${PAYLOAD}`)
  console.log(`scratch installation root: ${SCRATCH}\n`)
  const results = []
  const drives = []

  const keepServers = {}

  for (const tier of TIERS) {
    const servicesRoot = path.join(process.env.LOCALAPPDATA, 'ToolsEnabled')
    /* A FRESH record per level, in place: one scratch installation whose level
       changes between measurements, which is exactly how a person changes it. */
    const workspace = path.join(SCRATCH, 'home', 'AI Workspace')
    mkdirSync(workspace, { recursive: true })
    machineRecord.writeMachineRecord(machineRecord.buildMachineRecord({
      tier,
      servicesRoot,
      installRoot: PAYLOAD,
      nodePath: process.execPath,
      workspaceRoots: [workspace],
    }), { servicesRoot })

    /* --- codex: the confined home's config.toml ----------------------- */
    const fakeCodexHome = path.join(SCRATCH, 'codex-user-home')
    mkdirSync(fakeCodexHome, { recursive: true })
    writeFileSync(path.join(fakeCodexHome, 'auth.json'), '{}\n', 'utf8')
    const plan = confinement.confinedSessionPlan({ userCodexHome: fakeCodexHome })
    if (plan.ok !== true) {
      note('FAIL', `${tier} codex: confinedSessionPlan refused: ${plan.code}`)
      results.push({ tier, provider: 'codex', server: null, ok: false, reason: plan.code })
    } else {
      const toml = readFileSync(path.join(plan.codexHome, 'config.toml'), 'utf8')
      const servers = parseConfinedToml(toml)
      await measureDocument({ mcpServers: servers }, { providerLabel: 'codex', tier, results })
      /* Kept for the credential drive below. */
      keepServers[tier] = { servers }
    }

    /* --- claude: the .mcp.json a lane reads via --mcp-config ----------- */
    const dispatchRoot = path.join(SCRATCH, 'dispatch', tier)
    mkdirSync(dispatchRoot, { recursive: true })
    const record = machineRecord.readMachineRecord({ servicesRoot })
    const generated = machineRecord.writeMcpConfig(assistantConfigRecord(record), { targetDirectory: dispatchRoot })
    await measureDocument(generated.document, { providerLabel: 'claude', tier, results })
  }

  /* ---------------- the credential answer, driven end to end ------------- */

  console.log('\n[credential drive] the flow an agent runs at a level that carries it')
  {
    const servicesRoot = path.join(process.env.LOCALAPPDATA, 'ToolsEnabled')
    const workspace = path.join(SCRATCH, 'home', 'AI Workspace')
    machineRecord.writeMachineRecord(machineRecord.buildMachineRecord({
      tier: 'standard', servicesRoot, installRoot: PAYLOAD,
      nodePath: process.execPath, workspaceRoots: [workspace],
    }), { servicesRoot })
    const entry = keepServers.standard && keepServers.standard.servers && keepServers.standard.servers.toolsenabled
    if (!entry) {
      note('FAIL', 'standard write server entry unavailable for the credential drive')
    } else {
      const attempt = await enumerateTools(entry, { baseEnv: baseEnvFor(), label: 'drive/standard/toolsenabled' })
      if (!attempt.ok) {
        note('FAIL', `credential drive server did not start: ${attempt.reason}`)
      } else {
        const server = attempt.server
        const contract = structured(await server.call('tools/call', {
          name: 'owner_forms.describe', arguments: { formId: 'credential_value' },
        }))
        const acknowledgement = contract && contract.acknowledgement
          ? contract.acknowledgement
          : { formId: contract.formId, contractVersion: contract.contractVersion, fieldIds: contract.fieldIds, contractHash: contract.contractHash }
        drives.push({ step: 'owner_forms.describe', answer: contract })
        note(contract && (contract.contractHash || (contract.acknowledgement && contract.acknowledgement.contractHash)) ? 'ok' : 'FAIL',
          `owner_forms.describe(credential_value) answered the contract: ${JSON.stringify(acknowledgement).slice(0, 220)}`)

        const queued = structured(await server.call('tools/call', {
          name: 'system.credential_request',
          arguments: {
            credential: 'github_pat',
            requestContext: {
              purpose: 'Publish this project to the user\'s own GitHub repository',
              scope: 'One repository, contents read and write only',
              lifetime: 'Until the user revokes it on GitHub',
            },
            acknowledgement,
          },
        }))
        drives.push({ step: 'system.credential_request', answer: queued })
        note(queued && queued.status === 'queued' ? 'ok' : 'FAIL',
          `system.credential_request(github_pat): ${JSON.stringify(queued).slice(0, 300)}`)

        const status = structured(await server.call('tools/call', { name: 'owner_prompts.status', arguments: {} }))
        drives.push({ step: 'owner_prompts.status', answer: status })
        note(status && (status.pending >= 1 || (Array.isArray(status.requests) && status.requests.length >= 1) || status.queued >= 1) ? 'ok' : 'warn',
          `owner_prompts.status after the queue: ${JSON.stringify(status).slice(0, 300)}`)

        const doctor = structured(await server.call('tools/call', { name: 'system.doctor', arguments: {} }, 120_000))
        drives.push({ step: 'system.doctor', answer: doctor })
        note(doctor ? 'ok' : 'FAIL', `system.doctor answered (${JSON.stringify(doctor).length} bytes, scratch vault)`)
        server.stop()
      }
    }
  }

  console.log('\n[refusal capture] what the same request answers at guided, verbatim')
  {
    const servicesRoot = path.join(process.env.LOCALAPPDATA, 'ToolsEnabled')
    const workspace = path.join(SCRATCH, 'home', 'AI Workspace')
    machineRecord.writeMachineRecord(machineRecord.buildMachineRecord({
      tier: 'guided', servicesRoot, installRoot: PAYLOAD,
      nodePath: process.execPath, workspaceRoots: [workspace],
    }), { servicesRoot })
    const entry = keepServers.guided && keepServers.guided.servers && keepServers.guided.servers['toolsenabled-readonly']
    if (!entry) {
      note('FAIL', 'guided read-only server entry unavailable for the refusal capture')
    } else {
      const attempt = await enumerateTools(entry, { baseEnv: baseEnvFor(), label: 'refusal/guided/toolsenabled-readonly' })
      if (!attempt.ok) {
        note('FAIL', `guided server did not start: ${attempt.reason}`)
      } else {
        const server = attempt.server
        const refused = await server.call('tools/call', {
          name: 'system.credential_request',
          arguments: { credential: 'github_pat', requestContext: { purpose: 'x', scope: 'x', lifetime: 'x' }, acknowledgement: { formId: 'credential_value', contractVersion: 1, fieldIds: ['credential_value'], contractHash: '0'.repeat(64) } },
        })
        const body = structured(refused)
        drives.push({ step: 'guided refusal', answer: body })
        note('info', `guided system.credential_request answers: ${JSON.stringify(body).slice(0, 400)}`)
        const present = attempt.tools.includes('system.credential_request')
        note(present ? 'FAIL' : 'ok', present
          ? 'guided ADVERTISES system.credential_request, which the read-only level must not'
          : 'guided does not advertise system.credential_request (deliberate read-only gating)')
        server.stop()
      }
    }
  }

  /* ------------------------------------------------------------ report -- */

  console.log('\n=== MATRIX ===')
  for (const row of results) {
    console.log(`${row.tier.padEnd(13)} ${row.provider.padEnd(7)} ${String(row.server).padEnd(22)} ${row.ok ? String(row.count).padStart(4) : 'FAIL'}${row.reason ? `  ${row.reason}` : ''}`)
  }

  const jsonIndex = process.argv.indexOf('--json')
  if (jsonIndex >= 0 && process.argv[jsonIndex + 1]) {
    writeFileSync(process.argv[jsonIndex + 1], JSON.stringify({ payload: PAYLOAD, results, drives }, null, 2))
    console.log(`\nwrote ${process.argv[jsonIndex + 1]}`)
  }

  try { rmSync(SCRATCH, { recursive: true, force: true, maxRetries: 5 }) } catch { /* scratch outlives the run */ }

  const failed = findings.filter(finding => finding.level === 'FAIL')
  console.log(`\n${findings.length} observation(s), ${failed.length} failing`)
  for (const finding of failed) console.log(`  FAIL ${finding.text}`)
  process.exitCode = failed.length ? 1 : 0
}

main().catch(error => {
  console.error(`the driver itself failed, which is not a product defect: ${error?.stack || error}`)
  process.exitCode = 2
})
