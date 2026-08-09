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

test('the renderer has no exposed bridge to the agent IPC channels', () => {
  const preload = read('shell/preload.cjs')
  assert.doesNotMatch(preload, /mcAgent/, 'preload.cjs must not expose an agent global on window')
  assert.doesNotMatch(preload, /mc-agent:/, 'preload.cjs must not wire any mc-agent IPC channel to the renderer')
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

test('no source under src/ or shell/ names the internal repo or the dead chat placeholder', () => {
  const forbidden = [
    { label: 'toolsenabled-current', pattern: /toolsenabled-current/ },
    { label: 'Ask Codex or Claude', pattern: /Ask Codex or Claude/ },
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
