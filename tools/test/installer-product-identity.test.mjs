/* THE INSTALLER HAS TO RECOGNISE THE INSTALL IT IS REPLACING.
 *
 * Measured on Machine A, 2026-08-11, after installing ToolsEnabled Setup 1.0.3
 * over an existing Mission Control 1.0.5:
 *
 *   %LOCALAPPDATA%\Programs\mission-control   AND  ...\Programs\toolsenabled
 *   HKCU\...\Uninstall\{21cb002d-...} "Mission Control" 1.0.5
 *   HKCU\...\Uninstall\{1de271ec-...} "ToolsEnabled"    1.0.3
 *   two Start Menu shortcuts, two Desktop shortcuts
 *   %APPDATA%\Mission Control (populated)  AND  %APPDATA%\ToolsEnabled (empty)
 *
 * Not an upgrade -- a second product, installed alongside, at a LOWER version
 * number, with the person's data left in a directory the new build never reads.
 *
 * THE CAUSE. electron-builder keys a Windows installation on a GUID:
 *
 *   NsisTarget.js:157  const guid = options.guid || UUID.v5(appInfo.id, NS)
 *   multiUser.nsh:8    INSTALL_REGISTRY_KEY   "Software\${APP_GUID}"
 *   multiUser.nsh:9    UNINSTALL_REGISTRY_KEY "...\Uninstall\${UNINSTALL_APP_KEY}"
 *   multiUser.nsh:26   ReadRegStr $perUserInstallationFolder HKCU
 *                        "${INSTALL_REGISTRY_KEY}" InstallLocation
 *
 * That last line is how an installer finds the install it must replace. With no
 * `guid` set, the GUID is a hash of appId -- so renaming the product from
 * com.toolsenabled.missioncontrol to com.toolsenabled.desktop pointed the new
 * installer at a registry key that had never existed. It read no prior
 * InstallLocation, concluded there was nothing to upgrade, and installed a
 * second copy. Verified bit-exactly: UUID.v5 of the OLD appId is the GUID on the
 * Mission Control uninstall entry, and UUID.v5 of the NEW appId is the GUID on
 * the ToolsEnabled one.
 *
 * WHAT THIS SUITE PROTECTS. Not "the string is in package.json" -- a grep cannot
 * tell a live setting from a dead one. It resolves the GUID through
 * electron-builder's OWN UUID implementation, the same call the build makes, and
 * asserts the identity the resulting installer will own. The load-bearing test
 * is `identity is pinned, not derived`: it re-resolves with a DIFFERENT appId and
 * requires the answer not to move. That is the property whose absence caused
 * this, and it cannot be satisfied by any amount of source text.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const packageJson = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'))
const { LEGACY_USER_DATA_NAMES } = require('../../shell/userdata-adoption.cjs')

/* electron-builder's own namespace and hash, not a reimplementation. */
const { UUID } = require('builder-util-runtime')
const ELECTRON_BUILDER_NS_UUID = UUID.parse('50e065bc-3134-11e6-9bab-38c9862bdaf3')

/* The identity the installed base already carries. This is an external fact
   about customers' machines, not a value derived from this repo, which is why
   it is written out rather than computed: it is the thing package.json must
   keep agreeing with. It is UUID.v5('com.toolsenabled.missioncontrol'), the
   appId every shipped build up to and including 1.0.5 used. */
const SHIPPED_PRODUCT_GUID = '21cb002d-a6ac-5e62-b88d-ba3c87d67396'

/* Mirrors NsisTarget.js:157. `nsisDriftGuard` below fails if that line changes
   shape, so this cannot quietly stop describing what the build does. */
function resolveInstallerGuid({ nsisOptions, appId }) {
  return nsisOptions.guid || UUID.v5(appId, ELECTRON_BUILDER_NS_UUID).toString()
}

test('the installer owns the registry key the installed base already uses', () => {
  const guid = resolveInstallerGuid({
    nsisOptions: packageJson.build.nsis,
    appId: packageJson.build.appId,
  })

  assert.equal(
    String(guid).toLowerCase(),
    SHIPPED_PRODUCT_GUID,
    'a build with a different GUID cannot see the existing install and will install beside it',
  )
})

test('identity is pinned, not derived — appId can change without forking the install', () => {
  const asShipped = resolveInstallerGuid({
    nsisOptions: packageJson.build.nsis,
    appId: packageJson.build.appId,
  })
  const afterAnotherRename = resolveInstallerGuid({
    nsisOptions: packageJson.build.nsis,
    appId: 'com.toolsenabled.some-future-rename',
  })

  assert.equal(
    String(afterAnotherRename).toLowerCase(),
    String(asShipped).toLowerCase(),
    'product identity still floats with appId; the next rename orphans every install again',
  )
})

test('the uninstall entry is a single entry, keyed on that identity', () => {
  /* UNINSTALL_APP_KEY is the guid with backslashes replaced; a guid containing
     one would split the registry path and leave a second stray entry, which is
     the shape of the defect this suite exists for. */
  const guid = resolveInstallerGuid({
    nsisOptions: packageJson.build.nsis,
    appId: packageJson.build.appId,
  })

  assert.match(String(guid), /^[0-9a-fA-F-]{36}$/)
})

test('every product name this app has shipped under can still be found', () => {
  /* The GUID pin keeps the INSTALL together. Electron keys userData on
     productName instead, so a rename also has to leave a trail for
     shell/userdata-adoption.cjs -- otherwise the install upgrades correctly and
     the person's data is still stranded. */
  const current = packageJson.productName

  assert.ok(
    LEGACY_USER_DATA_NAMES.includes('Mission Control'),
    'Mission Control shipped to real machines; dropping it strands their userData',
  )
  assert.equal(
    LEGACY_USER_DATA_NAMES.includes(current),
    false,
    'the current productName is the destination, not a source to adopt from',
  )
})

test('nsisDriftGuard: electron-builder still resolves the guid the way this suite mirrors', () => {
  /* Secondary, and deliberately so: it does not prove the product's behaviour,
     it proves this file is still describing the dependency correctly. If
     electron-builder changes how a GUID is chosen, the assertions above could
     go on passing while the shipped installer does something else. */
  const source = readFileSync(
    path.join(REPO_ROOT, 'node_modules', 'app-builder-lib', 'out', 'targets', 'nsis', 'NsisTarget.js'),
    'utf8',
  )

  assert.match(
    source,
    /const guid = options\.guid \|\| \w+\.UUID\.v5\(appInfo\.id, ELECTRON_BUILDER_NS_UUID\)/,
    'NsisTarget no longer picks the GUID as mirrored here; re-derive resolveInstallerGuid()',
  )
  assert.match(
    source,
    /UUID\.parse\("50e065bc-3134-11e6-9bab-38c9862bdaf3"\)/,
    'the electron-builder UUID namespace moved; SHIPPED_PRODUCT_GUID must be re-checked',
  )
})
