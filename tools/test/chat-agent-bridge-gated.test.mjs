import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import test from 'node:test'

// BLOCKER 2 (R1162 non-author review): shell/agent-host.cjs resolved the
// Codex engine to `__dirname/../../toolsenabled-current/src/lib/agent-engine`
// -- a sibling repo unreachable from build.files (`dist/**`, `shell/**`), so
// it existed on NO installation. The chat feature was therefore guaranteed
// dead in every shipped build, and its failure path rendered the owner's
// internal repo name into the DOM. Confirmed present in the packaged
// app.asar bytes before this fix: both "toolsenabled-current" and the
// composer's "Ask Codex or Claude..." placeholder.
//
// The fix removes the chat route from the router, removes the renderer's
// only path to the agent IPC channels (the preload exposure), and deletes
// the hardcoded sibling-repo default from the engine resolver. There is no
// build/env flag to flip back on: nothing behind any of the three ever
// worked on a real installation, so a flag would only be a slower way to
// ship the same defect. This suite is the regression gate -- it goes red the
// moment any of the three reappears without a deliberate, reviewed decision
// to wire up a WORKING engine path.

const ROOT = resolve(import.meta.dirname, '..', '..')
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8')

function listFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) listFiles(full, out)
    else out.push(full)
  }
  return out
}

test('the chat route is not registered in the hash router', () => {
  const main = read('src/main.js')
  assert.doesNotMatch(main, /views\/chat\.js/, 'src/main.js must not import a chat view module')
  assert.doesNotMatch(main, /chatView/, 'src/main.js must not reference chatView anywhere')
  assert.doesNotMatch(main, /parts\[0\] === 'chat'/, 'the hash parser must not recognize #/chat')
  assert.doesNotMatch(main, /case 'chat':/, 'the view switch must not carry a chat case')
})

// SUPERSEDED CLAUSE (agents-from-ui lane). This suite previously asserted that
// the renderer had NO bridge to the agent IPC channels at all. That assertion
// was right for as long as the engine behind those channels shipped nowhere:
// an exposure whose only possible outcome is failure is worse than no
// exposure. It is wrong as a permanent rule, because it is also the reason no
// agent can be started from the interface -- which is now a requirement, not a
// nice-to-have.
//
// The header above anticipated exactly this and set the condition for
// reversing it: "a deliberate, reviewed decision to wire up a WORKING engine
// path." That condition is met, and narrowly:
//   - The engine is resolved from configuration (MISSION_CONTROL_ENGINE), never
//     a filesystem guess. Unconfigured still fails closed.
//   - The surface probes availability BEFORE offering a control, so a build
//     with no engine renders a stated-unavailable surface, not a dead button.
//   - Nothing on the path can carry a path to the DOM.
// Measured working end to end on 2026-08-10: the real engine spawned a Codex
// child, streamed deltas, and completed a turn, exit 0.
//
// The invariants that replace this assertion live in
// tools/test/agent-session-surface.test.mjs. The other two clauses of this
// suite are untouched and still permanent.
test('the renderer bridge to the agent IPC channels stays bounded', () => {
  // The preload main.cjs actually loads, not a named guess -- see
  // activePreloadPath() in agent-session-surface.test.mjs for why.
  const main = read('shell/main.cjs')
  const declared = main.match(/preload:\s*path\.join\(__dirname,\s*'([^']+)'\)/)
  assert.ok(declared, 'main.cjs must declare its preload')
  const preload = read(`shell/${declared[1]}`)
  // Not "no bridge" -- a bridge that cannot hand over raw IPC. The renderer
  // gets named calls only, so the reachable surface stays exactly the set
  // main.cjs validates.
  assert.doesNotMatch(
    preload,
    /exposeInMainWorld\([^)]*\bipcRenderer\b\s*\)/,
    'preload.cjs must never expose ipcRenderer itself to the renderer',
  )
  assert.doesNotMatch(
    preload,
    /mc-agent:(?!event\b)[a-z]*['"]\s*[,)]?\s*$/m,
    'agent channels must be reached through named preload calls, not assembled in the renderer',
  )
})

test('the agent engine resolver carries no hardcoded sibling-repo default', () => {
  const agentHost = read('shell/agent-host.cjs')
  assert.doesNotMatch(
    agentHost,
    /toolsenabled-current/,
    'agent-host.cjs must not hardcode a path into the private toolsenabled-current checkout',
  )
  assert.doesNotMatch(
    agentHost,
    /sibling default/,
    'the engine resolver must not carry an implicit filesystem-guess candidate',
  )
})

// The owner-data guard (tools/check-no-owner-data.mjs) is the authority, but it
// only sees the BUILT bundle -- it fires at the end of a multi-minute `dist`,
// after electron-builder has already packed. These same classes checked at the
// source, so a reintroduction goes red in seconds at `npm test`.
//
// Two of these are not in the built-bundle guard at all and belong here:
// `jpinckard` (the owner's real Google account aliases, which sat in
// src/sim.js's simulation data as pool ids) and `jpinc005` (his real university
// account, which sat in src/vocab.js's POOLS and was caught by nothing). The
// fictional stand-ins are `northwind21` / `northwind95` / `north005`.
test('no source under src/ or shell/ names the internal repo or the dead chat placeholder', () => {
  const forbidden = [
    { label: 'toolsenabled-current', pattern: /toolsenabled-current/ },
    { label: 'Ask Codex or Claude', pattern: /Ask Codex or Claude/ },
    // NARROWED, and the narrowing is the product rename, not a relaxation.
    //
    // This clause used to be a bare, unanchored /toolsenabled/i. That was
    // correct while "ToolsEnabled" was only ever the name of the owner's
    // private tree: at the time, every occurrence in shipped source really was
    // a leak of an internal name. It stopped being correct the moment the
    // product was RENAMED to ToolsEnabled, because the rule then forbade the
    // product's own on-screen name -- the window title, the titlebar, and every
    // sentence of user-facing copy that says which program is speaking. A gate
    // that forbids the product from naming itself does not protect anybody.
    //
    // tools/check-no-owner-data.mjs, which is the authority and which scans the
    // BUILT bundle, has already been through this exact correction twice and
    // settled on the shape below; see its comment at the "toolsenabled-current"
    // rule. What the rule is actually aiming at is the tree name as a DIRECTORY
    // COMPONENT OF AN ABSOLUTE PATH ON A REAL MACHINE, which always has a drive
    // root. The product's own identity never does. So the drive root is what is
    // matched, and this file now agrees with the guard it exists to front-run.
    //
    // Still caught by this clause, and by nothing else here:
    //   C:\Users\joshp\Desktop\ToolsEnabled\src   D:/dev/toolsenabled/lib
    // Still caught by the exact clause above it, unchanged:  toolsenabled-current
    // Now permitted, deliberately:  "ToolsEnabled", 'toolsenabled', TOOLSENABLED
    { label: 'builder checkout path (<drive>:\\...\\ToolsEnabled)', pattern: /[A-Za-z]:[\\/][^\r\n]{0,160}?[\\/]toolsenabled/i },
    { label: 'agent-coord', pattern: /agent-coord/i },
    { label: "the owner's account aliases", pattern: /jpinckard/i },
    { label: "the owner's university account", pattern: /jpinc005/i },
    { label: "the owner's name", pattern: /pinckard/i },
  ]
  const offenders = []
  for (const name of ['src', 'shell']) {
    for (const file of listFiles(resolve(ROOT, name))) {
      const text = readFileSync(file, 'utf8')
      for (const { label, pattern } of forbidden) {
        if (pattern.test(text)) offenders.push(`${file}: ${label}`)
      }
    }
  }
  assert.deepEqual(offenders, [])
})
