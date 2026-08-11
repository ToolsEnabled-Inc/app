// Behavioural tests for the license-notice delivery gate.
//
// These assert what the gate DOES, not what its source says. A source-text
// assertion would pass just as happily against dead code, and the whole point
// of this gate is that it actually fails a build.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GATE = join(REPO, 'tools', 'check-license-notices.mjs');

function runGate(args = []) {
  // Capture status from the bare process. Never read an exit code through a
  // pipe -- a pipeline reports the LAST command's status, not the gate's.
  const r = spawnSync(process.execPath, [GATE, ...args], { encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

test('gate passes against the current repository', () => {
  const { status, out } = runGate();
  assert.equal(status, 0, `expected exit 0, got ${status}:\n${out}`);
  assert.match(out, /LICENSE NOTICE GATE: PASS/);
});

test('gate fails when the packaged product is missing the notices', () => {
  // A directory that looks like a packaged root but ships no notices. This
  // exercises the packaged-mode branch for real rather than trusting it.
  const dir = mkdtempSync(join(tmpdir(), 'te-licgate-'));
  try {
    mkdirSync(join(dir, 'resources'), { recursive: true });
    const { status, out } = runGate([dir]);
    assert.equal(status, 1, `expected exit 1, got ${status}:\n${out}`);
    for (const doc of ['LICENSE', 'NOTICE', 'THIRD-PARTY-LICENSES.md']) {
      assert.ok(
        out.includes(`${doc} did not reach the built product`),
        `failure output should name the missing ${doc}:\n${out}`
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gate fails when the packaged root has no resources directory at all', () => {
  const dir = mkdtempSync(join(tmpdir(), 'te-licgate-empty-'));
  try {
    const { status, out } = runGate([dir]);
    assert.equal(status, 1, `expected exit 1, got ${status}:\n${out}`);
    assert.match(out, /has no resources\/ directory/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('LICENSE is the unmodified GNU AGPLv3', () => {
  // Verified on 2026-08-11 byte-for-byte against
  // https://www.gnu.org/licenses/agpl-3.0.txt (34523 bytes, LF).
  const AGPL = '0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0';
  // Normalised, matching the gate: core.autocrlf=true with no .gitattributes
  // means a fresh clone has a CRLF LICENSE whose raw digest differs while the
  // licence text is identical.
  const text = readFileSync(join(REPO, 'LICENSE'), 'utf8').replace(/\r\n/g, '\n');
  const got = createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
  assert.equal(got, AGPL, 'the AGPL must ship verbatim; put custom wording in NOTICE');
});

test('the free product does not claim all rights reserved', () => {
  // The launch blocker this lane existed to close: a reserved-rights notice is
  // incompatible with an open-source release.
  for (const doc of ['README.md', 'NOTICE', 'LICENSING.md', 'COMMERCIAL-LICENSE.md']) {
    const text = readFileSync(join(REPO, doc), 'utf8');
    assert.ok(
      !/all rights reserved/i.test(text),
      `${doc} still reserves all rights, which contradicts the AGPL grant`
    );
  }
});

test('third-party notices reproduce the license bodies, not just the names', () => {
  const tpl = readFileSync(join(REPO, 'THIRD-PARTY-LICENSES.md'), 'utf8');
  // Distinctive operative sentences from each license family that actually
  // ships. A heading alone does not discharge a notice obligation.
  assert.ok(
    tpl.includes('SIL OPEN FONT LICENSE Version 1.1'),
    'the bundled fonts are OFL-1.1 and their license text must be reproduced'
  );
  assert.ok(
    tpl.includes('Apache License'),
    'Apache-2.0 components require a copy of the Apache license'
  );
  assert.ok(
    tpl.includes('Redistributions in binary form must reproduce the above copyright notice'),
    'zrender is BSD-3-Clause and requires its binary-form notice to be reproduced'
  );
});

test('every production dependency is covered by the notice file', () => {
  const tpl = readFileSync(join(REPO, 'THIRD-PARTY-LICENSES.md'), 'utf8');
  const root = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
  for (const name of Object.keys(root.dependencies || {})) {
    const dir = join(REPO, 'node_modules', ...name.split('/'));
    if (!existsSync(dir)) continue; // install state is not what this asserts
    const version = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version;
    assert.ok(
      tpl.includes(`### ${name} ${version} —`),
      `${name}@${version} ships but has no section in THIRD-PARTY-LICENSES.md`
    );
  }
});

test('the notices are configured to ship with the installer', () => {
  // The obligation is only discharged if the texts are in the box. This asserts
  // the build config, which is what determines whether they get there.
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
  const targets = (pkg.build?.extraResources || []).map((e) => (typeof e === 'string' ? e : e.to));
  for (const doc of ['LICENSE', 'NOTICE', 'THIRD-PARTY-LICENSES.md']) {
    assert.ok(
      targets.includes(doc),
      `${doc} is not in build.extraResources, so it will not reach users`
    );
  }
});
