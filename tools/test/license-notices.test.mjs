// Behavioural tests for the license-notice delivery gate.
//
// These assert what the gate DOES, not what its source says. A source-text
// assertion would pass just as happily against dead code, and the whole point
// of this gate is that it actually fails a build.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
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

// A DUPLICATED PARAGRAPH IN A SHIPPED LEGAL NOTICE, AND THE GATE THAT COULD NOT SEE IT.
//
// Measured 2026-08-11: NOTICE carried the "Mission Control" trademark paragraph
// twice, verbatim and back to back, and this gate reported PASS. Everything it
// checked was still true -- the file existed, it was not empty, and LICENSE still
// hashed to the unmodified AGPL -- so the duplicate was invisible to it and
// shipped to every user as resources/NOTICE.
//
// THIS TEST PLANTS THAT EXACT DEFECT INTO THE REAL FILE rather than into a
// fixture, because the gate resolves REPO from its own location and always reads
// the real NOTICE; a fixture would prove a copy of the rule works on a copy of
// the file. Planting the real thing is also what makes this a mutation proof
// rather than a decoration: the red state asserted below IS the state that
// shipped.
//
// The restore is asserted by sha256, not assumed. A test that damages a legal
// notice and cannot prove it put the bytes back is worse than no test.
test('gate fails when a shipped notice repeats a paragraph verbatim', () => {
  const noticePath = join(REPO, 'NOTICE');
  const original = readFileSync(noticePath);
  const originalSha = createHash('sha256').update(original).digest('hex');

  // Match the file's own line endings. This repository is checked out with
  // core.autocrlf=true, so a hardcoded \n plant silently fails to find its
  // target on a fresh clone -- and a plant that does not land produces a green
  // that looks exactly like a working rule.
  const text = original.toString('utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const paragraph = [
    'The interface was previously called "Mission Control". That name was dropped',
    'before launch: a USPTO search returned 17 live marks for it in the relevant',
    'classes, including Apple Inc. (Reg. 4240125, IC 009) and BMC Software.',
    '"ToolsEnabled" returned no hits, live or dead.',
  ].join(eol);

  assert.ok(
    text.includes(paragraph),
    'the paragraph this test plants a duplicate of is no longer in NOTICE, so the plant ' +
      'would not land and the assertions below would pass without testing anything. ' +
      'Update the paragraph text here to a block that NOTICE actually contains.'
  );

  try {
    writeFileSync(noticePath, text.replace(paragraph, `${paragraph}${eol}${eol}${paragraph}`));

    // Prove the plant changed the file before trusting what the gate says about it.
    const plantedSha = createHash('sha256').update(readFileSync(noticePath)).digest('hex');
    assert.notEqual(plantedSha, originalSha, 'the plant did not change NOTICE, so the gate result below is meaningless');

    const { status, out } = runGate();
    assert.equal(status, 1, `expected exit 1 on a duplicated paragraph, got ${status}:\n${out}`);
    // The failure must NAME the document and the offending text. A red that does
    // not say what is wrong sends the reader to the wrong file.
    assert.match(out, /NOTICE repeats the same paragraph 2 times verbatim/, out);
    assert.match(out, /Mission Control/, out);
  } finally {
    writeFileSync(noticePath, original);
  }

  const restoredSha = createHash('sha256').update(readFileSync(noticePath)).digest('hex');
  assert.equal(restoredSha, originalSha, 'NOTICE was not restored byte-identically after the plant');

  // And the restored file must actually pass, so a failure here cannot be left
  // looking like a pre-existing condition.
  const after = runGate();
  assert.equal(after.status, 0, `NOTICE should pass again after restore:\n${after.out}`);
});

// THIRD-PARTY-LICENSES.md MUST NOT BE SUBJECT TO THE DUPLICATE RULE.
//
// It reproduces the full licence text of every redistributed dependency, so
// identical MIT and BSD-3-Clause bodies repeat legitimately -- 44 duplicated
// blocks when measured on 2026-08-11. If the rule ever grows to cover it, this
// gate goes permanently red and the only way out is deleting the rule. This test
// fails the moment that happens, while the fix is still cheap.
test('the duplicate-paragraph rule does not apply to reproduced third-party licence texts', () => {
  const tpl = readFileSync(join(REPO, 'THIRD-PARTY-LICENSES.md'), 'utf8').replace(/\r\n/g, '\n');
  const counts = new Map();
  for (const block of tpl.split(/\n\s*\n/)) {
    const trimmed = block.trim();
    if (trimmed.length < 60) continue;
    counts.set(trimmed, (counts.get(trimmed) || 0) + 1);
  }
  const duplicated = [...counts.values()].filter((n) => n > 1).length;
  assert.ok(
    duplicated > 0,
    'expected THIRD-PARTY-LICENSES.md to contain legitimately repeated licence bodies; if it no ' +
      'longer does, this test is no longer proving the exclusion is needed'
  );
  // The gate passes today, which is the actual assertion: the rule is scoped away from this file.
  const { status } = runGate();
  assert.equal(status, 0, 'the gate must stay green despite the repeated licence bodies above');
});
