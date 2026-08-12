#!/usr/bin/env node
// LICENSE-NOTICE DELIVERY GATE.
//
// WHAT IS ACTUALLY AT RISK. The installer redistributes font binaries under the
// SIL Open Font License and code under Apache-2.0 and BSD-3-Clause. All three
// require that their copyright notices and license texts travel WITH the copies
// handed to users. Listing dependencies in package.json does not discharge that
// -- the texts have to be in the box. This gate fails the build when they are
// not, rather than warning, because a warning in a build log is how this class
// of defect ships.
//
// It also fails when a NEW production dependency appears that
// THIRD-PARTY-LICENSES.md does not cover. That is the realistic failure mode:
// nobody removes a notice on purpose, they add a dependency and never think
// about notices at all.
//
// TWO MODES:
//   node tools/check-license-notices.mjs
//       Repository mode. Checks the source-of-truth documents and drift.
//   node tools/check-license-notices.mjs release/win-unpacked
//       Packaged mode. Additionally proves the texts reached the built product.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const packagedRoot = process.argv[2] || null;

// sha256 of the unmodified GNU AGPLv3 as published at
// https://www.gnu.org/licenses/agpl-3.0.txt (34523 bytes, LF endings).
const AGPL_SHA256 = '0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0';

// Production packages that are resolved but NOT redistributed in the payload.
// Anything here must also be explained in THIRD-PARTY-LICENSES.md.
const NOT_REDISTRIBUTED = new Set(['@ibm/telemetry-js']);

const REQUIRED_DOCS = ['LICENSE', 'NOTICE', 'THIRD-PARTY-LICENSES.md'];

const failures = [];
const fail = (msg) => failures.push(msg);

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

// Hash the TEXT, not the line-ending convention. This repository is checked out
// with core.autocrlf=true and carries no .gitattributes, so a fresh clone gets a
// CRLF LICENSE whose raw digest differs from the canonical LF one while the
// licence itself is untouched. Hashing raw bytes would fail the build on a
// correct file, and a gate that cries wolf on a fresh clone is a gate somebody
// deletes. Normalising costs nothing: a changed WORD still changes the digest,
// which is the tampering this actually guards against.
function sha256Text(path) {
  return sha256(Buffer.from(readFileSync(path, 'utf8').replace(/\r\n/g, '\n'), 'utf8'));
}

function readPkg(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

// Resolve the production dependency closure by walking node_modules, the way
// the bundler does. No npm subprocess: this must be deterministic and fast
// enough to run on every build.
function resolveFrom(startDir, name) {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, 'node_modules', ...name.split('/'));
    if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function productionClosure() {
  const root = readPkg(REPO);
  if (!root) throw new Error('cannot read root package.json');
  const found = new Map(); // name -> version
  const seen = new Set();
  const queue = Object.keys(root.dependencies || {}).map((n) => [n, REPO]);
  while (queue.length) {
    const [name, from] = queue.shift();
    const dir = resolveFrom(from, name);
    if (!dir) {
      fail(`dependency "${name}" is declared but not installed; cannot verify its license`);
      continue;
    }
    const pkg = readPkg(dir);
    if (!pkg) {
      fail(`dependency "${name}" has no readable package.json`);
      continue;
    }
    const key = `${name}@${pkg.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.set(name, pkg.version);
    for (const dep of Object.keys(pkg.dependencies || {})) queue.push([dep, dir]);
  }
  return found;
}

// ---- Repository mode ---------------------------------------------------

for (const doc of REQUIRED_DOCS) {
  const p = join(REPO, doc);
  if (!existsSync(p)) {
    fail(`${doc} is missing from the repository root`);
    continue;
  }
  if (readFileSync(p, 'utf8').trim().length === 0) fail(`${doc} exists but is empty`);
}

if (existsSync(join(REPO, 'LICENSE'))) {
  const got = sha256Text(join(REPO, 'LICENSE'));
  if (got !== AGPL_SHA256) {
    fail(
      'LICENSE is not the unmodified GNU AGPLv3.\n' +
        `      expected sha256 ${AGPL_SHA256}\n` +
        `      actual   sha256 ${got}\n` +
        '      The AGPL must be shipped verbatim; put project-specific wording in ' +
        'NOTICE or LICENSING.md instead.'
    );
  }
}

// A NOTICE THAT SAYS THE SAME THING TWICE HAS BEEN APPENDED TO WITHOUT BEING READ.
//
// Measured 2026-08-11: NOTICE carried the "Mission Control" trademark paragraph
// TWICE, verbatim, back to back -- and this gate passed, because everything it
// checked was still true. The file existed, it was non-empty, and LICENSE still
// hashed to the unmodified AGPL. The duplicate had nothing to do with any of
// those, so the gate could not see it, and the duplicated text shipped to every
// user inside the installer as resources/NOTICE.
//
// That is worth a rule rather than a proofread. NOTICE, LICENSING.md and
// COMMERCIAL-LICENSE.md are the documents that state the licence grant, the
// dual-licensing position and the founder attribution. They are edited by
// appending a paragraph, which is exactly the operation that duplicates one --
// and a legal notice that contradicts or repeats itself is the kind of defect
// nobody catches by reading, because everyone skims a file they have seen before.
//
// THIRD-PARTY-LICENSES.md IS DELIBERATELY EXCLUDED, and that exclusion is the
// load-bearing part of the design rather than a convenience. It reproduces the
// full licence text of every redistributed dependency, so identical MIT and
// BSD-3-Clause bodies repeat legitimately -- 44 duplicated blocks when measured.
// Applying this rule there would produce a permanently red gate whose only
// possible resolution is deleting the rule, and a gate that must be deleted to
// get a build out protects nothing the day it finally catches something real.
//
// Blocks shorter than 60 characters are ignored: headings, rule lines and the
// aligned "Sole founder and creator : ..." field lines repeat by design.
const PROSE_NOTICE_DOCS = ['NOTICE', 'LICENSING.md', 'COMMERCIAL-LICENSE.md', 'CONTRIBUTORS.md'];
const MINIMUM_PARAGRAPH = 60;

for (const doc of PROSE_NOTICE_DOCS) {
  const p = join(REPO, doc);
  if (!existsSync(p)) continue; // absence is already a failure above for REQUIRED_DOCS
  const text = readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  const counts = new Map();
  for (const block of text.split(/\n\s*\n/)) {
    const trimmed = block.trim();
    if (trimmed.length < MINIMUM_PARAGRAPH) continue;
    counts.set(trimmed, (counts.get(trimmed) || 0) + 1);
  }
  for (const [block, n] of counts) {
    if (n === 1) continue;
    const firstLine = block.split('\n')[0].slice(0, 90);
    fail(
      `${doc} repeats the same paragraph ${n} times verbatim: "${firstLine}..."\n` +
        '      A licence notice that states something twice was appended to without being read. ' +
        'This document ships to every user; remove the duplicate.'
    );
  }
}

const tplPath = join(REPO, 'THIRD-PARTY-LICENSES.md');
if (existsSync(tplPath)) {
  const tpl = readFileSync(tplPath, 'utf8');
  const closure = productionClosure();

  for (const [name, version] of [...closure].sort()) {
    if (NOT_REDISTRIBUTED.has(name)) {
      if (!tpl.includes(name)) {
        fail(
          `"${name}" is marked not-redistributed by this gate but is never mentioned in ` +
            'THIRD-PARTY-LICENSES.md; a reader comparing against package-lock.json would ' +
            'find an unexplained gap'
        );
      }
      continue;
    }
    if (!tpl.includes(`### ${name} ${version} —`)) {
      fail(
        `production dependency "${name}@${version}" has no section in ` +
          'THIRD-PARTY-LICENSES.md. Regenerate it, or add the package to ' +
          'NOT_REDISTRIBUTED in this gate if it genuinely never reaches the payload.'
      );
      continue;
    }
    // The heading alone is not the obligation; the license body is.
    const dir = resolveFrom(REPO, name);
    const licFiles = dir
      ? readdirSync(dir).filter((f) => /^(LICEN[CS]E|COPYING)/i.test(f))
      : [];
    let body = null;
    for (const f of licFiles) {
      try {
        const t = readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n').trim();
        if (t) { body = t; break; }
      } catch { /* directory entry */ }
    }
    if (!body) {
      fail(`"${name}" ships no license text in node_modules; cannot verify its notice`);
      continue;
    }
    // Compare a distinctive slice rather than the whole body, so trailing
    // whitespace normalisation cannot cause a false failure.
    const probe = body.split('\n').find((l) => l.trim().length > 40);
    if (probe && !tpl.includes(probe.trim())) {
      fail(
        `THIRD-PARTY-LICENSES.md names "${name}" but does not reproduce its license text ` +
          '(a heading without the body does not satisfy the notice requirement)'
      );
    }
  }
}

// ---- Packaged mode -----------------------------------------------------

if (packagedRoot) {
  const resources = join(packagedRoot, 'resources');
  if (!existsSync(resources)) {
    fail(`packaged root "${packagedRoot}" has no resources/ directory`);
  } else {
    for (const doc of REQUIRED_DOCS) {
      const shipped = join(resources, doc);
      if (!existsSync(shipped)) {
        fail(
          `${doc} did not reach the built product (expected at resources/${doc}). ` +
            'Add it to build.extraResources in package.json -- the SIL OFL, Apache-2.0 ' +
            'and BSD-3-Clause terms require the notices to ship with the binary.'
        );
        continue;
      }
      if (sha256Text(join(REPO, doc)) !== sha256Text(shipped)) {
        fail(`resources/${doc} does not match the repository copy of ${doc}`);
      }
    }
  }
}

// ---- Verdict -----------------------------------------------------------

const scope = packagedRoot ? `repository + ${packagedRoot}` : 'repository';
if (failures.length) {
  console.error(`\nLICENSE NOTICE GATE: FAIL (${failures.length}) -- scope: ${scope}\n`);
  for (const f of failures) console.error(`  - ${f}`);
  console.error(
    '\nThis gate fails rather than warns because an unmet notice obligation is a ' +
      'license violation in every copy already handed out, and cannot be fixed ' +
      'retroactively for those copies.\n'
  );
  process.exit(1);
}
console.log(`LICENSE NOTICE GATE: PASS -- scope: ${scope}`);
