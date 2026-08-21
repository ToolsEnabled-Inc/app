// Proof for tools/installer-identity.mjs.
//
// The defect this guards against was measured, not supposed: on 2026-08-12 the
// build machine carried a real install registered under the exact GUID that
// package.json pinned for every build --
//
//   HKCU\...\Uninstall\21cb002d-a6ac-5e62-b88d-ba3c87d67396
//     DisplayName = ToolsEnabled, DisplayVersion = 1.0.3
//
// so a test build shared the real copy's uninstall entry, install directory,
// and %APPDATA% profile directory. These tests assert the three properties
// that make that impossible, and one property that keeps upgrade working.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import {
  ELECTRON_BUILDER_NS_UUID,
  RELEASE_CHANNEL,
  RELEASE_GUID,
  assertReleasePinAgrees,
  builderOverrides,
  deriveInstallIdentity,
  normalizeChannel,
  resolveChannel,
  uuidV5,
} from '../installer-identity.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);

const APP_ID = 'com.toolsenabled.desktop';
const PRODUCT = 'ToolsEnabled';

const identity = (channel, version = '1.0.6') =>
  deriveInstallIdentity({ appId: APP_ID, productName: PRODUCT, version, channel });

// --- the derivation itself ------------------------------------------------

test('uuidV5 matches electron-builder\'s own UUID.v5 byte for byte', () => {
  // Rather than trusting a comment that says "this is standard v5", compare
  // against the implementation electron-builder will actually use.
  const { UUID } = require('builder-util-runtime');
  const namespace = UUID.parse(ELECTRON_BUILDER_NS_UUID);
  for (const name of [APP_ID, `${APP_ID}#test`, `${APP_ID}#rc`, 'x']) {
    assert.equal(uuidV5(name), String(UUID.v5(name, namespace)), `mismatch for ${name}`);
  }
});

test('uuidV5 emits a well-formed version-5 variant-1 UUID', () => {
  const value = uuidV5(`${APP_ID}#test`);
  assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

// --- stability ------------------------------------------------------------

test('a channel derives the same GUID every time it is computed', () => {
  for (const channel of [RELEASE_CHANNEL, 'test', 'rc', 'beta']) {
    const runs = new Set(Array.from({ length: 25 }, () => identity(channel).guid));
    assert.equal(runs.size, 1, `${channel} was not stable across repeated derivation`);
  }
});

test('a channel keeps one identity across versions, so upgrades still find it', () => {
  // This is the property that makes upgrade testable at all. If identity moved
  // per version, 1.0.6 -> 1.0.7 would leave two installs and two uninstall
  // entries on every customer machine.
  const versions = ['1.0.3', '1.0.6', '1.0.7', '2.4.11'];
  for (const channel of [RELEASE_CHANNEL, 'test']) {
    const guids = new Set(versions.map((version) => identity(channel, version).guid));
    const names = new Set(versions.map((version) => identity(channel, version).productName));
    assert.equal(guids.size, 1, `${channel} GUID drifted across versions`);
    assert.equal(names.size, 1, `${channel} productName drifted across versions`);
  }
});

test('the release identity is exactly what is already installed in the field', () => {
  const release = identity(RELEASE_CHANNEL);
  assert.equal(release.guid, RELEASE_GUID);
  assert.equal(release.guid, '21cb002d-a6ac-5e62-b88d-ba3c87d67396');
  assert.equal(release.productName, PRODUCT);
  assert.equal(release.isRelease, true);
});

// --- isolation ------------------------------------------------------------

test('every non-release channel is distinct from release and from each other', () => {
  const channels = [RELEASE_CHANNEL, 'test', 'rc', 'beta', 'nightly', 'qa'];
  const rows = channels.map((channel) => identity(channel));

  const guids = rows.map((row) => row.guid);
  assert.equal(new Set(guids).size, channels.length, 'two channels share an uninstall registry key');

  const dirs = rows.map((row) => row.installDirName);
  assert.equal(new Set(dirs).size, channels.length, 'two channels share an install directory');

  const caches = rows.map((row) => row.updaterCacheDirName);
  assert.equal(new Set(caches).size, channels.length, 'two channels share an updater cache');

  for (const row of rows.filter((r) => !r.isRelease)) {
    assert.notEqual(row.guid, RELEASE_GUID, `${row.channel} collides with the shipped release GUID`);
    assert.notEqual(row.installDirName, PRODUCT, `${row.channel} installs over the real copy`);
  }
});

test('a test channel cannot address the real copy through any of the three paths', () => {
  const release = identity(RELEASE_CHANNEL);
  const testing = identity('test');
  // registry key, install directory, and the %APPDATA% tree the uninstaller
  // deletes (templates/nsis/uninstaller.nsh:237) must all differ.
  assert.notEqual(testing.guid, release.guid);
  assert.notEqual(testing.installDirName, release.installDirName);
  assert.notEqual(testing.userDataDirName, release.userDataDirName);
});

test('a derived productName stays usable as an NSIS install directory name', () => {
  // If it is not, app-builder-lib falls back to the channel-independent
  // sanitizedName and the isolation silently disappears.
  const NSIS_DIR_SAFE = /^[-_+0-9a-zA-Z .]+$/;
  for (const channel of ['test', 'rc', 'beta', 'nightly', 'release-candidate', 'qa2']) {
    assert.match(identity(channel).productName, NSIS_DIR_SAFE);
  }
});

// --- channel resolution ---------------------------------------------------

test('channel resolution: env wins, then a prerelease tag, then release', () => {
  assert.equal(resolveChannel({ env: {}, version: '1.0.6' }), 'release');
  assert.equal(resolveChannel({ env: {}, version: '1.0.7-rc.1' }), 'rc');
  assert.equal(resolveChannel({ env: {}, version: '1.0.7-test' }), 'test');
  assert.equal(resolveChannel({ env: { TE_INSTALL_CHANNEL: 'test' }, version: '1.0.6' }), 'test');
  assert.equal(resolveChannel({ env: { TE_INSTALL_CHANNEL: 'TEST' }, version: '1.0.6' }), 'test');
  // an explicit channel overrides even a prerelease version
  assert.equal(resolveChannel({ env: { TE_INSTALL_CHANNEL: 'qa' }, version: '1.0.7-rc.1' }), 'qa');
});

test('a malformed channel is refused rather than silently sanitised', () => {
  for (const bad of ['', ' ', '-test', 'test-', 'te st', 'test/prod', 'a'.repeat(25), 'ünicode']) {
    assert.throws(() => normalizeChannel(bad), /invalid channel/, `accepted ${JSON.stringify(bad)}`);
  }
});

test('deriveInstallIdentity refuses incomplete input', () => {
  assert.throws(() => deriveInstallIdentity({ productName: PRODUCT }), /appId/);
  assert.throws(() => deriveInstallIdentity({ appId: APP_ID }), /productName/);
});

// --- the overrides handed to electron-builder -----------------------------

test('a release build emits no identity override at all', () => {
  // The committed config is already correct for release. Re-stating it in the
  // wrapper would give the installed base's identity a second home to drift in.
  const args = builderOverrides(identity(RELEASE_CHANNEL));
  assert.deepEqual(args, []);
});

test('a non-release build overrides every field that could reach the real copy', () => {
  const args = builderOverrides(identity('test'));
  assert.ok(args.includes('-c.nsis.guid=bcf2eb9a-404d-5a33-91d2-441f04bcf924'));
  assert.ok(args.includes('-c.productName=ToolsEnabled Test'));
  assert.ok(args.includes('-c.publish.channel=test'));
  assert.ok(args.some((a) => a.startsWith('-c.nsis.uninstallDisplayName=')));
});

test('a feed URL is only added when one is supplied', () => {
  assert.ok(!builderOverrides(identity('test')).some((a) => a.startsWith('-c.publish.url=')));
  const withUrl = builderOverrides(identity('test'), { updateFeedUrl: 'https://example.invalid/u/' });
  assert.ok(withUrl.includes('-c.publish.url=https://example.invalid/u/'));
});

// --- the committed config -------------------------------------------------

test('package.json still pins the identity the installed base already carries', async () => {
  // Removing this pin is NOT the fix. tools/test/installer-product-identity.test.mjs
  // records the measured defect it prevents: unpinned, the GUID floats with
  // appId, and the 1.0.5 -> renamed build installed a second product beside the
  // customer's copy instead of upgrading it. The pin stays; only non-release
  // channels move off it.
  const pkg = JSON.parse(await readFile(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.build?.nsis?.guid, RELEASE_GUID);
  assert.equal(pkg.build?.appId, APP_ID, 'appId moved; RELEASE_GUID continuity needs re-checking');
  assert.equal(pkg.productName, PRODUCT, 'productName moved; channel derivation assumes this base');
});

test('a drift between the committed pin and RELEASE_GUID is refused, not averaged', () => {
  assert.equal(assertReleasePinAgrees({ build: { nsis: { guid: RELEASE_GUID } } }), RELEASE_GUID);
  assert.throws(() => assertReleasePinAgrees({ build: { nsis: {} } }), /missing/);
  assert.throws(() => assertReleasePinAgrees({ build: {} }), /missing/);
  assert.throws(
    () => assertReleasePinAgrees({ build: { nsis: { guid: '1de271ec-9b43-59e5-b4aa-0fd300d862cb' } } }),
    /disagrees with RELEASE_GUID/,
  );
});

test('the shipping chain still runs electron-builder directly, so it is fail-safe', async () => {
  // A release installer must be buildable without this wrapper: if the ship
  // path depended on it, a bare `electron-builder --win nsis` would silently
  // produce a build with a derived GUID and orphan the installed base.
  const pkg = JSON.parse(await readFile(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.dist, /(?:^|\s)electron-builder(?=\s|$).*?--win\s+nsis(?=\s|$)/);
  assert.ok(!pkg.scripts.dist.includes('installer-identity'), 'the release ship path must not route through the channel wrapper');
  assert.match(pkg.scripts['dist:test'], /installer-identity\.mjs --channel test --exec --win nsis/);
});

test('package.json declares an update feed that never uploads anything', async () => {
  const pkg = JSON.parse(await readFile(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const publish = pkg.build?.publish;
  assert.ok(publish, 'no publish block: a shipped build emits no latest.yml, so there is no way to ship a fix');
  const entries = Array.isArray(publish) ? publish : [publish];
  assert.equal(entries.length, 1);
  // "generic" is the only provider that produces update metadata without an
  // account: app-builder-lib/out/publish/PublishManager.js:273 returns a null
  // publisher for it, so a build can never push artifacts anywhere.
  assert.equal(entries[0].provider, 'generic');
  assert.match(entries[0].url, /^https:\/\//);
});

test('code signing is still honestly declared as absent', async () => {
  // Guard against a future edit that "fixes" the SmartScreen warning by
  // asserting a certificate this project does not have.
  const pkg = JSON.parse(await readFile(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const win = pkg.build?.win ?? {};
  for (const key of ['certificateFile', 'certificateSubjectName', 'certificateSha1', 'signtoolOptions', 'azureSignOptions']) {
    assert.equal(win[key], undefined, `${key} is set but no certificate has been purchased`);
  }
  assert.equal(win.forceCodeSigning, undefined, 'forceCodeSigning would fail the build with no certificate');
});
