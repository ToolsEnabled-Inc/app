import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const packageJson = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
);

const EXPECTED_VERIFY_SCRIPT = /^node\s+tools[\\/]test-ratchet\.mjs$/;

const REQUIRED_STAGES = [
  {
    name: 'verify',
    pattern: /\bnpm\s+run\s+verify\b/,
    missing:
      'The dist ship path must invoke scripts.verify; otherwise an installer can be produced without the test ratchet passing.',
  },
  {
    name: 'build',
    pattern: /\bnpm\s+run\s+build\b/,
    missing:
      'The dist ship path must build the renderer; otherwise packaging can reuse stale renderer output.',
  },
  {
    name: 'package',
    pattern: /(?:^|\s)electron-builder(?=\s|$).*?--win\s+nsis(?=\s|$)/,
    missing:
      'The dist ship path must run electron-builder with --win nsis; otherwise it does not produce the Windows installer this gate is meant to prove.',
  },
  {
    name: 'strip',
    pattern:
      /(?:^|\s)(?:node\s+)?\S*strip-build-diagnostics\.mjs\s+release(?=\s|$)/,
    missing:
      'The dist ship path must strip build diagnostics from release; otherwise builder-debug.yml can ship the owner\'s home-directory path.',
  },
  {
    name: 'smoke',
    pattern:
      /(?:^|\s)(?:node\s+)?\S*smoke-packaged\.mjs\s+release[\\/]win-unpacked(?=\s|$)/,
    missing:
      'The packaged smoke gate must target release/win-unpacked; targeting dist tests only the renderer and leaves the packaged application unproved.',
  },
];

/**
 * Assert that a dist script preserves the fail-closed ship path.
 *
 * Exported so callers can exercise the contract against hypothetical scripts
 * without modifying package.json.
 */
export function assertShipPath(distScript, verifyScript) {
  assert.equal(
    typeof verifyScript,
    'string',
    'scripts.verify must exist; otherwise dist has no named ratchet gate to invoke.',
  );
  assert.match(
    verifyScript,
    EXPECTED_VERIFY_SCRIPT,
    'scripts.verify must run tools/test-ratchet.mjs; otherwise dist can invoke a verify alias that no longer enforces the test ratchet.',
  );
  assert.equal(
    typeof distScript,
    'string',
    'scripts.dist must exist; otherwise there is no guarded path that produces the installer.',
  );
  assert.doesNotMatch(
    distScript,
    /[;|]/,
    'Required ship stages must be joined with &&; ; or | can continue into packaging after a failed safety gate.',
  );

  const commands = distScript.split(/\s*&&\s*/);
  const positions = REQUIRED_STAGES.map((stage) => {
    const position = commands.findIndex((command) => stage.pattern.test(command));
    assert.notEqual(position, -1, stage.missing);
    return position;
  });

  assert.equal(
    positions[0],
    0,
    'The verify gate must be the first dist command; work performed before it can create or mutate an artifact before safety checks pass.',
  );

  for (let index = 1; index < positions.length; index += 1) {
    const previous = REQUIRED_STAGES[index - 1];
    const current = REQUIRED_STAGES[index];
    assert.ok(
      positions[index - 1] < positions[index],
      current.name === 'smoke'
        ? 'Packaging and diagnostic stripping must finish before smoke-packaged; otherwise the smoke gate can validate a previous or privacy-unsafe artifact.'
        : `${previous.name} must run before ${current.name}; reversing them allows a later ship stage to invalidate evidence from an earlier gate.`,
    );
  }
}

const VALID_CHAIN =
  'npm run verify && npm run build && electron-builder --win nsis && node tools/strip-build-diagnostics.mjs release && node tools/smoke-packaged.mjs release/win-unpacked';
const VALID_VERIFY = 'node tools/test-ratchet.mjs';

test('the real package.json dist chain preserves the ship-path contract', () => {
  assertShipPath(packageJson.scripts?.dist, packageJson.scripts?.verify);
});

test('rejects smoke-packaged before electron-builder', () => {
  const badChain =
    'npm run verify && npm run build && node tools/smoke-packaged.mjs release/win-unpacked && electron-builder --win nsis && node tools/strip-build-diagnostics.mjs release';

  assert.throws(
    () => assertShipPath(badChain, VALID_VERIFY),
    /Packaging and diagnostic stripping must finish before smoke-packaged/,
  );
});

test('rejects a chain with strip-build-diagnostics deleted', () => {
  const badChain = VALID_CHAIN.replace(
    ' && node tools/strip-build-diagnostics.mjs release',
    '',
  );

  assert.throws(
    () => assertShipPath(badChain, VALID_VERIFY),
    /builder-debug\.yml can ship the owner's home-directory path/,
  );
});

test('rejects non-fail-closed separators', () => {
  const badChain = VALID_CHAIN.replaceAll(' && ', ' ; ');

  assert.throws(
    () => assertShipPath(badChain, VALID_VERIFY),
    /can continue into packaging after a failed safety gate/,
  );
});

test('rejects smoke-packaged targeting the renderer dist directory', () => {
  const badChain = VALID_CHAIN.replace(
    'smoke-packaged.mjs release/win-unpacked',
    'smoke-packaged.mjs dist',
  );

  assert.throws(
    () => assertShipPath(badChain, VALID_VERIFY),
    /targeting dist tests only the renderer/,
  );
});
