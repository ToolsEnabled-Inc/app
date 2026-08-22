/* THE ONE PARAGRAPH WHERE THE WRONG COMPUTER IS DANGEROUS.
 *
 * Measured on the live site on 2026-08-22, the first time a browser drove a
 * machine: the compose panel said "This computer is set to Unrestricted.
 * Nothing narrows it: it can read, change and delete any file on this computer
 * and run any program, without asking."
 *
 * Read at a laptop, about a machine at home. Everywhere else on the page a
 * wrong referent is confusing; here it is somebody agreeing to something on a
 * computer they thought they were only looking at.
 *
 * The lead sentence names the subject and the sentences after it inherit that
 * reading, so these tests hold the lead and the default together. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const {
  confinementNote, startControlLine,
  CONFINEMENT_SUBJECT_HERE, CONFINEMENT_SUBJECT_REMOTE,
} = await import(new URL('../../src/agent-confinement-copy.js', import.meta.url).href)

/* A reading the copy recognises, so the lead sentence is actually produced. */
const UNRESTRICTED = { ok: true, tier: 'unrestricted', sandbox: 'danger-full-access' }

test('the default subject is unchanged, so the desktop reads exactly as it did', () => {
  const note = confinementNote(UNRESTRICTED)
  assert.ok(note.level, 'a recognised reading must still produce a lead sentence')
  assert.ok(note.level.startsWith('This computer is set to'), note.level)
})

test('a caller can name the machine instead', () => {
  const note = confinementNote(UNRESTRICTED, { subject: CONFINEMENT_SUBJECT_REMOTE })
  assert.ok(note.level.startsWith('The computer you are driving is set to'), note.level)
  assert.ok(!note.level.startsWith('This computer'), 'the wrong referent must be gone, not merely softened')
})

test('the two subjects are different words', () => {
  assert.notEqual(CONFINEMENT_SUBJECT_HERE, CONFINEMENT_SUBJECT_REMOTE)
})

test('the start-control line carries the subject through', () => {
  const here = startControlLine(UNRESTRICTED)
  const remote = startControlLine(UNRESTRICTED, { subject: CONFINEMENT_SUBJECT_REMOTE })
  assert.ok(here.startsWith('This computer is set to'), here)
  assert.ok(remote.startsWith('The computer you are driving is set to'), remote)
  /* The rest of the paragraph -- what it may actually do -- must be identical.
     Only the referent changes; softening the danger for a remote machine would
     be the opposite of the point. */
  assert.equal(here.slice(here.indexOf('.')), remote.slice(remote.indexOf('.')))
})

test('the compose panel chooses the subject by where the machine is', async () => {
  const view = await readFile(path.join(ROOT, 'src', 'views', 'computers.js'), 'utf8')
  const at = view.indexOf('composeConfinementLine = startControlLine(')
  assert.ok(at > 0, 'the compose panel must still compose this line')
  const call = view.slice(at, at + 400)
  assert.ok(/CONFINEMENT_SUBJECT_REMOTE/.test(call), 'the relay case must name the remote machine')
  assert.ok(/currentDataSource\(\) === 'relay'/.test(call), 'and it must decide from where the data came')
})
