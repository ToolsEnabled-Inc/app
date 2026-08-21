#!/usr/bin/env node

// CAN THE THING WE SHIP START AN AGENT? ASKED BY POSTING A REAL DISPATCH.
//
// THE DEFECT THIS EXISTS TO CATCH, AND WHY NO SOURCE TEST COULD.
//
// The mission bridge resolves a dispatch by finding a DECLARED agent whose id
// and provider match the requested tier. It reads that declaration from
// `config/agent-org.json` inside the capability payload. The builder's own
// organisation declares twenty agents, so every dispatch on this machine
// resolved; the organisation the BUILD STAGES IN ITS PLACE
// (capability-defaults/config/agent-org.json) declared the controller and
// nothing else, so every dispatch on every packaged install refused with
// BRIDGE_AGENT_DECLARATION_MISSING. The product could not start an agent at all.
//
// Every unit suite in this repository passed throughout, and would have gone on
// passing: they run against the builder's tree, where the masking file lives.
// The defect is a property of the PAYLOAD -- of which config file ends up beside
// the engine -- and the only instrument that can see it is one that starts the
// payload and asks it to dispatch. That is this file.
//
// WHAT IT MEASURES, AND HOW THAT IS "PACKAGED".
//
// By default it stages a payload with the build's own staging step
// (tools/pack-capability-layer.mjs) into a temporary directory, which is
// byte-for-byte what `npm run dist` puts under `resources\capability`, including
// the substituted organisation. `--release <dir>` measures the payload inside an
// already-built application instead. Either way it then starts THAT payload's
// bridge -- the real `tools/mission-bridge.js`, the real per-boot bootstrap
// proof, the real bearer, the real HTTP route -- and POSTs to
// /v1/actions/dispatch exactly as src/mission-bridge.js does from the window.
//
// It does not open a window. A window would add twenty minutes and several
// failure modes to a question that is entirely about what the payload answers,
// and tools/agent-route-reachability.mjs already owns the can-a-person-get-there
// half.
//
// IT SPENDS NO PROVIDER BUDGET, AND THAT IS ENFORCED RATHER THAN INTENDED.
//
// A dispatch that resolves ends by spawning a real Codex or Claude process. So
// the bridge child is given an environment in which neither CLI can be found:
// PATH is cut back to the Windows system directories, and APPDATA and USERPROFILE
// point at empty temporary directories, which between them defeat all three ways
// src/lib/providers/cli-provider-gateway.js resolves an executable (the global
// npm layout, the bundled VS Code one, and the bare command on PATH). The
// dispatch therefore travels the WHOLE way -- actor, policy, lane resolution,
// launch record, phase claim, brief and checkpoint -- and stops at the last
// possible instant, on "that program is not installed on this computer", which
// is also the honest state of a machine that has not installed either CLI.
//
// A dispatch that nevertheless succeeds is a HARNESS failure, not a pass: it is
// reported as one and the bridge's whole process tree is reaped immediately.
//
// WHY A REFUSAL CODE IS NOT THE EVIDENCE.
//
// "It did not say BRIDGE_AGENT_DECLARATION_MISSING" is satisfied by a refusal
// from any EARLIER gate -- a policy guard, a malformed root, an unauthorised
// actor -- none of which proves the organisation declares anything. So the
// evidence is positive and comes from the audit chain the bridge writes for
// itself: a `controller.agent.launch` record naming the seat that was allocated.
// That record is written by createLaunch(), which runs after the lane has been
// resolved and after the phase-claim gate, so its existence is proof that both
// passed. The refusal code is checked as well, and only against the codes that
// mean "the lane was ready and the program was missing".
//
// ONE OBJECTIVE IS PHASE-SHAPED, AND THAT IS NOT DECORATION. `objectiveRef`
// values matching /^Q[0-9]{1,3}$/ are queue phase ids, and only those reach
// mayClaim() in the launch record -- the gate that decides whether this agent is
// allowed to take this work. Every obvious test value ("probe-lane", the fleet
// page's own "page2-<id>") is a plain label that skips that gate entirely, so a
// suite built from obvious values would leave the phase claim unmeasured on
// every install.
//
// THE INSTRUMENT PROVES ITSELF BEFORE IT REPORTS. A green run that could not
// have gone red is worth nothing, and this one is cheap to fool: any bridge that
// refuses everything for any reason satisfies "not this code". So the run ends
// by rebuilding the defect -- the same payload with a controller-only
// organisation -- and REQUIRING BRIDGE_AGENT_DECLARATION_MISSING back. If the
// defect cannot be reproduced, this file cannot claim to detect it, and the run
// fails.
//
// USAGE
//   node tools/agent-dispatch-packaged-qa.mjs                stage and measure
//   node tools/agent-dispatch-packaged-qa.mjs --release <dir> measure that build
//   node tools/agent-dispatch-packaged-qa.mjs --keep          keep the sandbox

import { execFile as execFileCallback, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const require_ = createRequire(import.meta.url)
const SELF = fileURLToPath(import.meta.url)
const REPO = path.resolve(path.dirname(SELF), '..')
const DEFAULTS_ORG = path.join(REPO, 'capability-defaults', 'config', 'agent-org.json')

const {
  readCapabilityProof,
  startCapabilityLayer,
  stopCapabilityLayer,
} = require_(path.join(REPO, 'shell', 'capability-layer.cjs'))

function argument(name, fallback = null) {
  const inline = process.argv.find(value => value.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const at = process.argv.indexOf(name)
  return at === -1 ? fallback : (process.argv[at + 1] ?? fallback)
}

const RELEASE = argument('--release')
const KEEP = process.argv.includes('--keep')

/* THE TIERS THE PRODUCT OFFERS, read off the engine's own table rather than
   listed here. A tier this file forgot is a tier nothing measures, and the
   table is the one place that knows which exist. */
/* The tier table, with each row's KIND, because the kinds do not behave alike and
   this file used to assume they did. A tier's kind decides how far a dispatch gets
   before the payload refuses it, and asserting one uniform depth for all of them
   made the local tier read as a defect when it was doing exactly what it should.
   See the two checks that reference `kind` below. */
function tierTable(payload) {
  const source = readFileSync(path.join(payload, 'src', 'lib', 'mission-bridge', 'actions.js'), 'utf8')
  const table = source.slice(source.indexOf('const TIERS'), source.indexOf('});', source.indexOf('const TIERS')))
  const rows = new Map()
  for (const match of table.matchAll(/^\s*'?([a-z][a-z0-9-]*)'?:\s*Object\.freeze\(\{([^}]*)\}/gm)) {
    const kind = /\bkind:\s*'([a-z]+)'/.exec(match[2])
    /* A row whose kind cannot be read is reported as such rather than defaulted:
       guessing 'codex' here would silently reinstate the assumption above. */
    rows.set(match[1], kind ? kind[1] : 'unreadable')
  }
  return rows
}

function tierNames(payload) {
  return [...tierTable(payload).keys()]
}

/* A plain label and a queue phase id. The second one is the only shape that
   reaches the phase-claim gate; see the header. */
const OBJECTIVES = Object.freeze(['fleet-page-lane', 'Q1'])

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok: Boolean(ok) })
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`)
}

/* The environment that makes a resolved dispatch harmless. Everything the
   gateway uses to find a provider CLI is removed; everything Windows itself
   needs to hand out a file ACL is kept, because the bridge refuses to start if
   it cannot lock its own token file down (measured: a bare PATH produced
   UAC_TOKEN_UNAVAILABLE and no bridge at all). */
function providerlessEnvironment(sandbox) {
  const environment = { ...process.env }
  for (const key of Object.keys(environment)) {
    if (/^(path|appdata|userprofile|home|homepath|homedrive)$/i.test(key)) delete environment[key]
  }
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  environment.PATH = [
    path.join(systemRoot, 'system32'),
    systemRoot,
    path.join(systemRoot, 'System32', 'Wbem'),
    path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0'),
  ].join(';')
  environment.APPDATA = path.join(sandbox, 'no-npm')
  environment.USERPROFILE = path.join(sandbox, 'no-home')
  mkdirSync(environment.APPDATA, { recursive: true })
  mkdirSync(environment.USERPROFILE, { recursive: true })
  delete environment.ELECTRON_RUN_AS_NODE
  return environment
}

function reap(pid) {
  if (!pid) return
  try {
    spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 30_000 })
  } catch { /* the tree is already gone */ }
}

/** Start one payload's bridge, POST the dispatches, and read the audit chain. */
async function measurePayload(payload, sandbox, label, dispatches) {
  const stateRoot = path.join(sandbox, `${label}-state`)
  const workspace = path.join(sandbox, `${label}-workspace`)
  mkdirSync(stateRoot, { recursive: true })
  mkdirSync(workspace, { recursive: true })

  const started = await startCapabilityLayer({
    root: payload,
    /* The shell passes its own window origin. Any loopback origin is accepted;
       the bearer is authorised by the per-boot proof file, not by this. */
    origin: 'http://127.0.0.1:4600',
    workspaceRoot: workspace,
    stateRoot,
    env: providerlessEnvironment(sandbox),
    execPath: process.execPath,
    timeoutMs: 90_000,
  })
  if (!started.ok) return { ok: false, code: started.code, reason: started.reason }

  const answers = []
  try {
    const proof = readCapabilityProof(started.bootstrapProofFile)
    if (!proof.ok) return { ok: false, code: proof.code, reason: proof.reason }
    const bootstrapUrl = new URL('/v1/bootstrap', started.baseUrl)
    bootstrapUrl.searchParams.set('proof', proof.proof)
    const boot = await (await fetch(bootstrapUrl, { headers: { accept: 'application/json' } })).json()
    if (boot?.ok !== true || typeof boot.token !== 'string') {
      return { ok: false, code: boot?.error?.code || 'BRIDGE_BOOTSTRAP_REFUSED', reason: 'no bearer' }
    }

    for (const { tier, objectiveRef } of dispatches) {
      const response = await fetch(`${started.baseUrl}/v1/actions/dispatch`, {
        method: 'POST',
        headers: { accept: 'application/json', authorization: `Bearer ${boot.token}`, 'content-type': 'application/json' },
        /* The same body src/write-surfaces.js sends when a person presses
           Dispatch, with the smallest cap the launch record accepts. */
        body: JSON.stringify({
          rootId: 'main',
          tier,
          objectiveRef,
          brief: 'Packaged dispatch check. This lane is never expected to run; do nothing.',
          cap: { kind: 'turns', value: 1, capMs: 60_000 },
        }),
      })
      const body = await response.json().catch(() => null)
      const started_ = body?.ok === true
      if (started_) reap(started.child?.pid)
      answers.push({
        tier,
        objectiveRef,
        status: response.status,
        started: started_,
        code: started_ ? null : (body?.error?.code || 'NO_CODE'),
      })
      if (started_) break
    }
  } finally {
    await stopCapabilityLayer(started.child)
    reap(started.child?.pid)
  }

  return { ok: true, answers, launches: launchRecords(stateRoot) }
}

/* The bridge's own audit chain, which is where the positive evidence is. Each
   `controller.agent.launch` event carries the record createLaunch() built, and
   createLaunch() runs only after the lane has been resolved from the declared
   organisation and after the phase-claim gate. */
function launchRecords(stateRoot) {
  const file = path.join(stateRoot, 'logs', 'actions.jsonl')
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => { try { return JSON.parse(line) } catch { return null } })
    .filter(event => event && event.action === 'controller.agent.launch')
    .map(event => event.details?.record)
    .filter(Boolean)
}

/* Where the payload under test comes from. Staging is the default because the
   question is about what SHIPS, and the staging step is the thing that decides
   it -- running it here means this driver measures the next build rather than
   the last one. */
async function resolvePayload(sandbox) {
  if (RELEASE) {
    const payload = path.join(path.resolve(RELEASE), 'resources', 'capability')
    if (!existsSync(path.join(payload, 'PAYLOAD.json'))) {
      return { ok: false, reason: `${RELEASE} carries no capability payload under resources\\capability` }
    }
    return { ok: true, payload, origin: 'the built application named by --release' }
  }
  const payload = path.join(sandbox, 'payload')
  try {
    await execFile(process.execPath, [path.join(REPO, 'tools', 'pack-capability-layer.mjs'), '--out', payload, '--quiet'], {
      cwd: REPO, timeout: 240_000, windowsHide: true,
    })
    return { ok: true, payload, origin: 'a payload staged by the build\'s own staging step' }
  } catch (error) {
    /* Falling back rather than refusing: a checkout that cannot reach the engine
       source can still measure the payload it already has, as long as the report
       says which one it measured. A silent substitution would be the defect this
       whole file is about, one layer up. */
    const staged = path.join(REPO, 'capability')
    if (!existsSync(path.join(staged, 'PAYLOAD.json'))) {
      return { ok: false, reason: `staging failed (${String(error.message).split('\n')[0]}) and ${staged} holds no payload either` }
    }
    return { ok: true, payload: staged, origin: 'the payload already staged in this checkout (staging failed; this may be older than the source)' }
  }
}

/* The defect, rebuilt. A whole copy of the measured payload with ONE file
   changed: the declared organisation, cut back to the controller alone, which is
   exactly what shipped. A copy rather than a junction tree, because a junction
   tree is a second implementation of "what a payload is" and this file already
   depends on being wrong about that in only one way. */
function controllerOnlyPayload(payload, sandbox) {
  const copy = path.join(sandbox, 'control-payload')
  cpSync(payload, copy, { recursive: true })
  const org = JSON.parse(readFileSync(path.join(payload, 'config', 'agent-org.json'), 'utf8'))
  writeFileSync(path.join(copy, 'config', 'agent-org.json'), `${JSON.stringify({
    ...org,
    agents: org.agents.filter(agent => agent.role === 'controller'),
    relationships: [],
  }, null, 2)}\n`)
  return copy
}

async function main() {
  const sandbox = mkdtempSync(path.join(tmpdir(), 'mc-dispatch-qa-'))
  console.log(`sandbox: ${sandbox}`)
  try {
    const resolved = await resolvePayload(sandbox)
    if (!resolved.ok) {
      console.error(`agent-dispatch-packaged-qa: no payload to measure -- ${resolved.reason}`)
      return 2
    }
    const { payload } = resolved
    console.log(`payload: ${resolved.origin}\n         ${payload}`)

    /* ---------- 1. THE PAYLOAD CARRIES THE SHIPPED ORGANISATION ---------- */
    const orgFile = path.join(payload, 'config', 'agent-org.json')
    const shipped = existsSync(orgFile) ? readFileSync(orgFile, 'utf8') : ''
    const declared = shipped ? JSON.parse(shipped) : { agents: [] }
    console.log(`declared agents: ${declared.agents.map(agent => `${agent.id}(${agent.provider})`).join(', ') || 'none'}`)
    check('the payload carries the organisation the build stages, not the builder\'s own',
      shipped === readFileSync(DEFAULTS_ORG, 'utf8'),
      shipped ? `${declared.agents.length} declared` : 'no organisation in the payload')

    /* ---------- 2. A REAL DISPATCH, EVERY TIER, BOTH OBJECTIVE SHAPES ---------- */
    const tiers = tierNames(payload)
    check('the engine\'s tier table was readable, so every tier the product offers is measured',
      tiers.length >= 6, `tiers: ${tiers.join(', ') || 'none found'}`)
    const dispatches = tiers.flatMap(tier => OBJECTIVES.map(objectiveRef => ({ tier, objectiveRef })))

    const measured = await measurePayload(payload, sandbox, 'shipped', dispatches)
    if (!measured.ok) {
      check('the payload\'s own capability layer started', false, `${measured.code}: ${measured.reason}`)
      return report()
    }
    check('the payload\'s own capability layer started', true, `${dispatches.length} dispatches posted`)

    for (const answer of measured.answers) {
      const where = `${answer.tier} / ${answer.objectiveRef}`
      /* THE ASSERTION THIS FILE EXISTS FOR. */
      check(`${where}: the shipped organisation declares an agent for this tier`,
        answer.code !== 'BRIDGE_AGENT_DECLARATION_MISSING', `${answer.status} ${answer.code || 'started'}`)
      check(`${where}: the launch record accepted it`,
        !String(answer.code || '').startsWith('LAUNCH_'), `${answer.status} ${answer.code || 'started'}`)
      /* The budget guarantee, asserted rather than assumed. */
      check(`${where}: nothing was actually spawned`, answer.started === false,
        answer.started ? 'A REAL AGENT STARTED -- the environment fence failed' : 'refused at the provider')
      /* AND IT GOT ALL THE WAY THERE. Without this, a refusal from any earlier
         gate would satisfy the two checks above while proving nothing. */
      /* PER KIND, NOT ONE LIST FOR ALL OF THEM. A local node has no provider CLI
         to be missing; what it lacks is a model runtime, and the payload says so
         with its own code. Accepting that code for a CODEX tier would be wrong --
         it would mean the codex lane had somehow taken the local branch -- so the
         allowed set is chosen by the tier's kind rather than merged into one list. */
      const kinds = tierTable(payload)
      const REFUSALS_BY_KIND = {
        codex: ['BRIDGE_CODEX_NATIVE_PAIR_UNAVAILABLE', 'BRIDGE_CODEX_UNAVAILABLE', 'BRIDGE_CODEX_SPAWN_REFUSED', 'BRIDGE_AGENT_LANE_START_FAILED'],
        claude: ['BRIDGE_CLAUDE_UNAVAILABLE', 'BRIDGE_CLAUDE_SPAWN_REFUSED', 'BRIDGE_AGENT_LANE_START_FAILED'],
        local: ['BRIDGE_LOCAL_RUNTIME_UNAVAILABLE'],
      }
      const kind = kinds.get(answer.tier)
      const allowed = REFUSALS_BY_KIND[kind] || []
      check(`${where}: it was refused only because this kind of agent has nothing installed to run it`,
        allowed.includes(answer.code),
        `kind=${kind || 'unknown'} ${answer.status} ${answer.code || 'started'}`)
    }

    /* ---------- 3. THE POSITIVE EVIDENCE, FROM THE AUDIT CHAIN ---------- */
    /* NOT EVERY DISPATCH IS SUPPOSED TO REACH THE LAUNCH RECORD, AND ASSUMING SO
       MADE THIS FILE GO RED ON CORRECT BEHAVIOUR.
       A local tier resolves its runtime BEFORE anything is recorded, deliberately.
       The payload says why, verbatim: "'Do not offer a node that cannot start' has
       to be enforced at the earliest point that can tell ... Resolving after
       createLaunch would leave a launch record and an audit event for a lane that
       never existed, and would report the failure as a spawn problem rather than
       as 'you have no local runtime installed, here is the command'."
       So the count is taken over the kinds that DO record, and the local tier's
       silence is asserted as the intended outcome rather than quietly excused. */
    const kindOf = tierTable(payload)
    const recording = dispatches.filter(d => kindOf.get(d.tier) !== 'local')
    const earlyRefusing = dispatches.filter(d => kindOf.get(d.tier) === 'local')
    check('every dispatch that is meant to reach the launch record did, which is past the lane resolver',
      measured.launches.length === recording.length,
      `launch records = ${measured.launches.length}, dispatches that record = ${recording.length}`
      + (earlyRefusing.length ? ` (${earlyRefusing.length} local dispatch(es) refuse before recording, by design)` : ''))
    check('a local tier left no launch record, because it refuses before anything is written',
      earlyRefusing.length > 0 && !measured.launches.some(record => record.model?.startsWith('local/')),
      earlyRefusing.length
        ? `${earlyRefusing.length} local dispatch(es), ${measured.launches.filter(r => r.model?.startsWith('local/')).length} local launch record(s)`
        : 'no local tier in the table -- this check measured nothing')
    const declaredIds = new Set(declared.agents.map(agent => agent.id))
    check('every launch record names a seat the shipped organisation declares',
      measured.launches.length > 0 && measured.launches.every(record => declaredIds.has(record.targetAgentId)),
      [...new Set(measured.launches.map(record => record.targetAgentId))].join(', ') || 'none')
    check('a phase-shaped objective passed the claim gate rather than skipping it',
      measured.launches.some(record => record.objectiveRef === 'Q1'),
      `${measured.launches.filter(record => record.objectiveRef === 'Q1').length} phase claims recorded`)

    /* ---------- 4. THE INSTRUMENT PROVES IT CAN STILL GO RED ---------- */
    const control = await measurePayload(
      controllerOnlyPayload(payload, sandbox),
      sandbox,
      'control',
      [{ tier: tiers[0], objectiveRef: 'Q1' }],
    )
    check('the defect can still be reproduced, so a green run above means something',
      control.ok && control.answers[0]?.code === 'BRIDGE_AGENT_DECLARATION_MISSING',
      control.ok ? `${control.answers[0]?.code}` : `${control.code}: ${control.reason}`)

    return report()
  } finally {
    if (KEEP) console.log(`sandbox kept: ${sandbox}`)
    else { try { rmSync(sandbox, { recursive: true, force: true }) } catch { /* cleanup may never fail the run */ } }
  }
}

function report() {
  const failed = checks.filter(entry => !entry.ok)
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
  for (const entry of failed) console.log(`  FAILED: ${entry.name}`)
  return failed.length === 0 ? 0 : 1
}

main().then(
  code => { process.exit(code) },
  error => { console.error(error?.stack || String(error)); process.exit(2) },
)
