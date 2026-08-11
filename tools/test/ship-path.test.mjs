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
    // Added after the SHIPPED INSTALLER was measured missing a fix that was
    // present in the checkout, and nothing could see the gap. This stage writes
    // dist/build-info.json -- the only statement an artifact ever makes about
    // which commit it came from -- and dist/** ships it inside app.asar. Measured
    // 2026-08-11: that record was absent from all three app.asar files on the
    // build machine, because `electron-builder` had been run directly and this
    // stage simply never executed. Every downstream gate passed the result.
    //
    // It is enshrined HERE for the same reason the privacy scan below is: a stage
    // that lives only in a package.json string can be dropped by anyone without a
    // test noticing, which is exactly how a control ends up wired to nothing.
    name: 'provenance',
    pattern: /(?:^|\s)(?:node\s+)?\S*require-clean-tree\.mjs\s+dist(?=\s|$)/,
    missing:
      'The dist ship path must run require-clean-tree.mjs against dist; otherwise the installer carries no record of which commit it was built from, and a build produced off this chain becomes indistinguishable from a gated one.',
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
    // The gate that READS the provenance stage's record back out of the packaged
    // archive. Without it the record is written and never checked, which is how
    // require-clean-tree's promise that dirty:true "ships inside the package,
    // inspectable by anyone holding only the .exe" went unkept by every artifact
    // ever built here. A record nobody reads is not a control.
    name: 'manifest',
    pattern: /(?:^|\s)(?:node\s+)?\S*check-asar-manifest\.mjs\s+release[\\/]win-unpacked(?=\s|$)/,
    missing:
      'The dist ship path must run check-asar-manifest.mjs against release/win-unpacked; otherwise nothing verifies that the archive contains the files the build declares, or that it can state which commit it came from.',
  },
  {
    // Added after the built app.asar -- the exact payload of the installer -- was
    // measured carrying the owner's real name (x20), a credential env var name (x2),
    // the internal repo name, and internal coordination-board references (x18): 53
    // matches in total. tools/check-no-owner-data.mjs existed, was fully unit-tested,
    // and was invoked by NO npm script, so it caught none of it. A commit message
    // asserted it ran automatically on every data file; that claim was false.
    //
    // It is enshrined HERE, and not merely added to the dist string, because a stage
    // present only in package.json can be dropped by anyone without a test noticing --
    // which is exactly how a privacy control ends up wired to nothing twice.
    name: 'privacy',
    pattern:
      /(?:^|\s)(?:node\s+)?\S*check-no-owner-data\.mjs\s+release[\\/]win-unpacked(?=\s|$)/,
    missing:
      'The dist ship path must scan release/win-unpacked for owner data; otherwise the installer can ship the owner\'s name, credential names, and internal repository details to strangers.',
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
  'npm run verify && npm run build && node tools/require-clean-tree.mjs dist && electron-builder --win nsis && node tools/strip-build-diagnostics.mjs release && node tools/check-asar-manifest.mjs release/win-unpacked && node tools/check-no-owner-data.mjs release/win-unpacked && node tools/smoke-packaged.mjs release/win-unpacked';
const VALID_VERIFY = 'node tools/test-ratchet.mjs';

test('the real package.json dist chain preserves the ship-path contract', () => {
  assertShipPath(packageJson.scripts?.dist, packageJson.scripts?.verify);
});

test('rejects smoke-packaged before electron-builder', () => {
  // Derived from VALID_CHAIN rather than hand-written. This case previously
  // carried its own copy of the chain, which silently went stale the moment a
  // stage was added: it then threw about the MISSING stage instead of the
  // ordering it exists to prove, and still read as a pass because assert.throws
  // was matching a pattern that no longer described why it threw.
  const SMOKE = ' && node tools/smoke-packaged.mjs release/win-unpacked';
  const badChain = VALID_CHAIN.replace(SMOKE, '').replace(
    ' && electron-builder --win nsis',
    `${SMOKE} && electron-builder --win nsis`,
  );

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

test('rejects a chain with the owner-data privacy scan deleted', () => {
  // The gate this proves exists because the previous privacy control was fully
  // unit-tested and invoked by nothing, so it caught 53 owner-data matches in the
  // shipped app.asar. A stage that cannot be shown to bite is the same defect again.
  const badChain = VALID_CHAIN.replace(
    ' && node tools/check-no-owner-data.mjs release/win-unpacked',
    '',
  );

  assert.throws(
    () => assertShipPath(badChain, VALID_VERIFY),
    /must scan release[\\/]win-unpacked for owner data/,
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

test('rejects a chain with the provenance record deleted', () => {
  // The measured incident: the installed application did not contain that
  // night's fix, and no one could tell, because the artifact could not say
  // which commit it was. This stage is what makes it able to say.
  const badChain = VALID_CHAIN.replace(
    ' && node tools/require-clean-tree.mjs dist',
    '',
  );

  assert.throws(
    () => assertShipPath(badChain, VALID_VERIFY),
    /carries no record of which commit it was built from/,
  );
});

test('rejects a chain with the packaged archive gate deleted', () => {
  const badChain = VALID_CHAIN.replace(
    ' && node tools/check-asar-manifest.mjs release/win-unpacked',
    '',
  );

  assert.throws(
    () => assertShipPath(badChain, VALID_VERIFY),
    /must run check-asar-manifest\.mjs against release[\\/]win-unpacked/,
  );
});

test('rejects recording provenance before the renderer build that erases it', () => {
  // Not a stylistic ordering rule. There is no vite.config in this repo, so
  // `vite build` runs with emptyOutDir defaulted on and WIPES dist/. A
  // build-info.json written before that step is deleted before electron-builder
  // can pack it, and the chain then looks fully gated while shipping an artifact
  // that still cannot state what it is -- the worst of both, since the terminal
  // shows the gate passing.
  const badChain =
    'npm run verify && node tools/require-clean-tree.mjs dist && npm run build && electron-builder --win nsis && node tools/strip-build-diagnostics.mjs release && node tools/check-asar-manifest.mjs release/win-unpacked && node tools/check-no-owner-data.mjs release/win-unpacked && node tools/smoke-packaged.mjs release/win-unpacked';

  assert.throws(
    () => assertShipPath(badChain, VALID_VERIFY),
    /build must run before provenance/,
  );
});
