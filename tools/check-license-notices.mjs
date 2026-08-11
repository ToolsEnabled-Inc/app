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
  const got = sha256(readFileSync(join(REPO, 'LICENSE')));
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
      const a = readFileSync(join(REPO, doc));
      const b = readFileSync(shipped);
      if (sha256(a) !== sha256(b)) {
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
