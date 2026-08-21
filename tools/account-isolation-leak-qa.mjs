#!/usr/bin/env node
/* CAN THE SECOND PERSON ON THIS COMPUTER SEE THE FIRST PERSON'S THINGS?
 *
 * THE QUESTION, PUT THE WAY A CUSTOMER WOULD PUT IT. Two people have accounts
 * in this product on one Windows login. One of them has been using it: they
 * have a name the program greets them by, settings they chose, and a list of
 * things they were thinking of buying with choices ticked on it. The other one
 * signs in for the first time. What is on their screen?
 *
 * AND THE OTHER DIRECTION, WHICH IS NOT DECORATION. A one-way test misses
 * INHERITANCE: it is entirely possible for a fresh account to start clean and
 * for the first person to come back and find the second person's choices in
 * their own settings. So the run goes both ways -- owner then stranger, and
 * stranger then owner -- and reports each direction separately, because the two
 * have different fixes.
 *
 * WHAT IS MEASURED, AND WHERE. Both. The SCREEN, because that is what a person
 * experiences and the acceptance matrix this lane reuses says a literal-name
 * scan and a small route subset are not proof of whole-product privacy. And the
 * FILE under userData, because that is the mechanism, and a screen that happens
 * to be showing a default today is not a partition.
 *
 * NO REAL OWNER DATA IS HANDLED. The first account is a STAND-IN with a marker
 * string this file invents; the operator's own purchase list is deliberately not
 * loaded, and a synthetic catalogue with invented vendors is used instead, so
 * nothing this run reads or writes is the owner's. The separate privacy sweep at
 * the end DOES look for the owner's real identity, and it takes those patterns
 * from private/owner-data-patterns.owner.json at runtime -- the same profile the
 * ship gate uses -- so no identity value is written into this tool, and a match
 * is reported by its NOTE and location, never by quoting the value it matched.
 *
 * MONEY IS NEVER MOVED AND NO CONFIRM IS PRESSED. The checkout screen is
 * reached, read, and ticked, because ticking is how a selection comes to exist.
 * The Confirm button at the end of the review step is deliberately never
 * pressed: approving is the owner's, not a test lane's, and a QA run that walks
 * up to it and stops is the correct shape of this test.
 *
 *   node tools/account-isolation-leak-qa.mjs [--visible] [--release <dir>]
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import {
  REPO_ROOT, VISIBLE, accountState, assertIsolated, closeDrawer, closeWindow, createAccountOnScreen,
  createLedger, delay, describeTimeline, generatedPassword, gotoAccount, gotoSettings, openDrawer,
  openWindow, prefsFileFor, releaseDirectory, route, scratchDirectory, screenText, seedMachineRecord,
  signInOnScreen, signOutOnScreen, stage, userDataFor, writeEvidence,
} from './test-account-harness.mjs'

/* The two people. Their display names carry markers this file invented, so a
   leak is unambiguous: these strings exist nowhere else on this computer. */
const OWNER = Object.freeze({
  username: 'first-person-standin',
  displayName: 'First Person Stand-In QAMARK-ALPHA',
  marker: 'QAMARK-ALPHA',
})
const TESTER = Object.freeze({
  username: 'test-account',
  displayName: 'Test Account — not a real user',
  marker: 'not a real user',
})

/* Settings each of them changes. Different ids, so "the stranger sees the
   default" and "the stranger sees the owner's value" cannot be confused.

   THESE WERE `board_mode` AND `thread_sort` UNTIL 2026-08-20, and both were
   removed from the page that day: they wrote a `mc.set.<id>` key nothing read.
   That did not make this probe wrong -- account isolation is about the KEY being
   partitioned, not about anything consuming it -- but a probe cannot click a
   control that is no longer on the screen, and a probe whose subject is a dead
   row is measuring storage rather than the product. Both are now rows that
   genuinely act, so a leak shows up as behaviour and not only as a stored
   string.

   THE STORAGE KEY IS NAMED, NOT DERIVED, because it is not `mc.set.<id>` for
   every row and this file used to assume it was. `theme` writes `mc.theme`, and
   public/durable-storage.js `isAccountScoped()` partitions exactly three
   things: `mc.theme`, `mc.checkout.v1`, and anything under `mc.set.`. A subject
   whose key falls outside that set is not account-scoped at all, so choosing one
   would make this probe pass by testing nothing. That is also why neither
   subject is the example toggle or a `write_*` flag: those store under
   `mc.example` and `mc.write.`, which `isAccountScoped()` does not cover.

   BOTH ARE SEGMENTED CONTROLS on purpose -- the click path below addresses
   `button[data-setting-value=...]`, which only a seg has. Of the rows that
   survive, act, and are account-scoped, `theme` and `uninstall_data` are the
   two segs. `uninstall_data` is only ever set to "keep my data" here: this
   stores a preference that the uninstaller reads, and nothing in this probe
   uninstalls anything. */
const OWNER_SETTING = Object.freeze({ id: 'theme', key: 'mc.theme', value: 'black', def: 'white' })
const TESTER_SETTING = Object.freeze({ id: 'uninstall_data', key: 'mc.set.uninstall_data', value: 'keep-my-data', def: 'ask' })

/* A purchase list that is nobody's. Invented vendors, invented reasons. It
   exists so the checkout screen is on the ring and has something to tick. */
function syntheticCatalog() {
  const item = (id, name, usd) => ({
    id,
    name,
    vendor: 'Example Vendor QAMARK-CATALOGUE',
    category: 'required-to-ship',
    cadence: 'annual',
    firstYearUsd: usd,
    renewalUsd: null,
    priceVerified: false,
    priceVerifiedDate: null,
    quantityMax: 1,
    defaultSelected: false,
    whatItIs: 'An invented line item that exists only so this screen has something on it.',
    whatBreaksWithout: 'Nothing. This list is synthetic and belongs to no one.',
    whyHeWantedIt: 'It was written by a test so that a purchase surface could be driven.',
    sourceUrl: null,
    warning: null,
    blockers: [],
    notes: null,
  })
  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    currency: 'USD',
    spendPolicy: { dailyLimitUsd: 100, source: 'a synthetic test policy', readAt: new Date().toISOString() },
    categories: [{
      id: 'required-to-ship',
      label: 'Synthetic group',
      blurb: 'Invented lines, present so the purchase screen can be driven by a test.',
    }],
    items: [item('qa-line-one', 'Synthetic line one', 12), item('qa-line-two', 'Synthetic line two', 34)],
  }
}

/* Every stop on the ring, plus the two surfaces that are not stops. Captured as
   text so the same corpus answers the leak question and the privacy sweep. */
async function captureEverySurface(window, label) {
  const surfaces = []
  const capture = async name => {
    surfaces.push({ label, surface: name, route: await route(window), text: await screenText(window) })
  }
  /* Round the ring by clicking the arrow, which is the only navigation this
     product has. Ten steps covers a ring of eight with room to spare. */
  await closeDrawer(window)
  for (let step = 0; step < 10; step += 1) {
    await capture(`ring-${step}`)
    if ((await window.clickVisible('#nav-next')) !== 'clicked') break
    await delay(420)
  }
  /* The two surfaces that are not stops on the ring, reached the way a person
     reaches them. The account screen is captured because it is the one place
     the signed-in person's own name is printed, and a leak sweep that never
     opened it would be looking for a string the product shows nowhere. */
  await gotoSettings(window)
  await capture('settings')
  await gotoAccount(window)
  await capture('account')
  return surfaces
}

/** Tick a line on the purchase screen. Ticking is not buying and never was. */
async function tickCheckoutLine(window, itemId) {
  const clicked = await window.clickVisible(`[data-item-id="${itemId}"] .checkout-pick`)
  await delay(500)
  return clicked
}

async function checkoutSelectionState(window) {
  return window.evaluate(`(() => {
    const rows = [...document.querySelectorAll('.checkout-item')]
    return {
      rows: rows.length,
      selected: rows.filter(row => row.dataset.selected === 'true').map(row => row.dataset.itemId),
      chosenStat: (document.querySelector('.checkout-stat .checkout-stat-value')?.textContent || '').trim(),
    }
  })()`)
}

/** Reach the purchase screen by clicking the arrow until it is the stop. */
async function walkToCheckout(window) {
  await closeDrawer(window)
  for (let step = 0; step < 12; step += 1) {
    if ((await route(window)) === 'checkout') return true
    if ((await window.clickVisible('#nav-next')) !== 'clicked') return false
    await delay(420)
  }
  return (await route(window)) === 'checkout'
}

function readPrefs(profile) {
  try { return JSON.parse(readFileSync(prefsFileFor(profile), 'utf8')) } catch { return null }
}

function prefValue(prefs, key) {
  if (!prefs) return null
  const entries = prefs.entries || prefs.values || prefs.keys || prefs
  if (entries && typeof entries === 'object' && !Array.isArray(entries)) {
    if (Object.hasOwn(entries, key)) {
      const held = entries[key]
      return held && typeof held === 'object' && Object.hasOwn(held, 'value') ? held.value : held
    }
  }
  return null
}

/* The owner's real identity profile, loaded at runtime. Values are never
   printed; a hit is reported by its note and where it was found. */
function ownerIdentityPatterns() {
  const file = path.join(REPO_ROOT, 'private', 'owner-data-patterns.owner.json')
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(parsed?.patterns) ? parsed.patterns : null
  } catch { return null }
}

/* THE HARNESS'S OWN SCRATCH PATH IS NOT A LEAK, AND MUST NOT BE COUNTED AS ONE.
 *
 * The sterile profile lives under the OS temp directory, which on this machine
 * is inside the owner's home directory -- so the workspace folder the settings
 * page correctly shows the person running the app contains the owner's Windows
 * username, and the identity sweep matched it on all three sessions. That is
 * this rig's shadow, not the product's. It is REDACTED rather than the pattern
 * being dropped: any occurrence of that username anywhere else on the screen
 * still fails, which is the whole point of the sweep. The count of redactions
 * is reported so the exemption cannot quietly grow. */
function withoutHarnessPaths(text, roots) {
  let redacted = text
  let count = 0
  for (const root of roots) {
    if (!root) continue
    const needle = root.toLowerCase()
    for (;;) {
      const at = redacted.toLowerCase().indexOf(needle)
      if (at === -1) break
      redacted = `${redacted.slice(0, at)}<harness scratch>${redacted.slice(at + root.length)}`
      count += 1
    }
  }
  return { text: redacted, count }
}

function sweepForOwnerIdentity(surfaces, patterns) {
  const hits = []
  patterns.forEach((pattern, index) => {
    const needle = String(pattern.value ?? '')
    if (!needle) return
    for (const surface of surfaces) {
      const haystack = pattern.caseSensitive === true ? surface.text : surface.text.toLowerCase()
      const probe = pattern.caseSensitive === true ? needle : needle.toLowerCase()
      if (haystack.includes(probe)) {
        /* The NOTE and the place, never the value. This report is read by
           people and stored in a lane file. */
        hits.push(`pattern #${index + 1} (${pattern.note || 'no note'}) on ${surface.label}/${surface.route}`)
      }
    }
  })
  return hits
}

async function main() {
  const ledger = createLedger()
  const scratch = scratchDirectory('account-isolation-leak-qa')
  const profile = path.join(scratch, 'shared-windows-user')
  let window = null
  const started = Date.now()
  const allSurfaces = []

  console.log(`release  : ${releaseDirectory()}`)
  console.log(`scratch  : ${scratch}`)
  console.log(`mode     : ${VISIBLE ? 'VISIBLE (control run)' : 'headless'}`)

  try {
    const { executable, appRoot } = await stage(scratch)
    seedMachineRecord(profile, appRoot, 'standard')
    mkdirSync(userDataFor(profile), { recursive: true })
    writeFileSync(
      path.join(userDataFor(profile), 'purchase-catalog.json'),
      `${JSON.stringify(syntheticCatalog(), null, 2)}\n`,
      'utf8',
    )

    const ownerPassword = generatedPassword()
    const testerPassword = generatedPassword()

    /* ================= 1. THE FIRST PERSON MAKES AN ACCOUNT ================= */
    window = await openWindow(executable, profile)
    ledger.check('the packaged application opens on a profile that holds a purchase list',
      window.timeline.windowAt !== null, describeTimeline(window.timeline))
    assertIsolated(profile)

    const reached = await gotoAccount(window)
    ledger.check('the sign-in screen is reachable by clicking, from Settings, without typing an address',
      reached === 'clicked' || reached === 'already-there', reached)

    const ownerCreated = await createAccountOnScreen(window, OWNER, ownerPassword)
    ledger.check('creating the first account works from that screen', ownerCreated === 'submitted', ownerCreated)
    const asOwner = await accountState(window)
    ledger.check('the first person is signed in under the display name they chose',
      asOwner?.current?.account?.displayName === OWNER.displayName,
      String(asOwner?.current?.account?.displayName))

    /* ================= 2. THE FIRST PERSON USES THE PRODUCT ================= */
    await window.clickVisible('[data-account-home]')
    await delay(900)
    await openDrawer(window)
    await window.clickVisible('#theme-seg button[data-theme="black"]')
    await delay(900)
    const ownerTheme = await window.evaluate('document.documentElement.dataset.theme')
    await closeDrawer(window)
    ledger.check('the first person picks a theme', ownerTheme === 'black', `theme=${ownerTheme}`)
    const toSettings = await gotoSettings(window)
    /* The groups ship collapsed (settings-ia); open them the way a person does. */
    await window.evaluate(`(() => { for (const head of document.querySelectorAll('.settings-group-head[aria-expanded="false"]')) head.click(); return true })()`)
    await delay(500)
    const ownerSet = await window.clickVisible(
      `[data-setting-id="${OWNER_SETTING.id}"] button[data-setting-value="${OWNER_SETTING.value}"]`)
    await delay(800)
    ledger.check('the first person changes a setting on the settings page',
      ownerSet === 'clicked', `${OWNER_SETTING.id}=${OWNER_SETTING.value} nav=${toSettings} click=${ownerSet}`)

    /* MEASURED ON ITS OWN, because the navigation above routes around it.
       While the settings page is showing, the floating fleet-profile notice is
       painted over the drawer's own "all settings" link, so a person who opens
       the drawer there cannot press it. It is redundant on that one route, which
       is why this is recorded rather than treated as a stopper. */
    await openDrawer(window)
    const drawerLink = await window.waitForVisible('.drawer-all', 8000)
    await closeDrawer(window)
    ledger.check('the settings drawer\'s "all settings" link is not covered by another element',
      drawerLink?.state === 'visible', `on the settings route it reads ${drawerLink?.state}${drawerLink?.by ? ` (covered by ${drawerLink.by})` : ''}`)

    const atCheckout = await walkToCheckout(window)
    ledger.check('the purchase screen is a stop on the ring once a list is installed', atCheckout,
      `route=${await route(window)}`)
    const ticked = await tickCheckoutLine(window, 'qa-line-one')
    const ownerSelection = await checkoutSelectionState(window)
    ledger.check('the first person can tick a line on the purchase screen',
      ticked === 'clicked' && ownerSelection.selected.includes('qa-line-one'),
      `${ticked} selected=${ownerSelection.selected.join(',')}`)
    ledger.note('the Confirm button on the review step is deliberately NOT pressed by this lane')

    const ownerSurfaces = await captureEverySurface(window, 'first-person-signed-in')
    allSurfaces.push(...ownerSurfaces)
    const ownerNameSeen = ownerSurfaces.filter(surface => surface.text.includes(OWNER.marker))
    ledger.check('the first person is in fact greeted by name somewhere, so the leak test has something to look for',
      ownerNameSeen.length > 0, ownerNameSeen.map(surface => surface.route).join(', ') || 'their name is on no surface')

    const prefsAfterOwner = readPrefs(profile)
    writeEvidence(scratch, 'prefs-after-first-person.json', prefsAfterOwner)

    /* ================= 3. THE SECOND PERSON SIGNS IN ================= */
    const ownerSignedOut = await signOutOnScreen(window)
    ledger.check('the first person can sign out from the account screen',
      ownerSignedOut === 'clicked', ownerSignedOut)
    const afterSignOut = await accountState(window)
    ledger.check('signing out actually ends the session rather than only changing the screen',
      afterSignOut?.current?.signedIn === false, `signedIn=${afterSignOut?.current?.signedIn}`)

    const testerCreated = await createAccountOnScreen(window, TESTER, testerPassword)
    ledger.check('a second account can be created on the same computer', testerCreated === 'submitted', testerCreated)
    const asTester = await accountState(window)
    ledger.check('the second person is signed in as themselves, not as the first person',
      asTester?.current?.account?.username === TESTER.username
      && asTester?.current?.account?.displayName === TESTER.displayName,
      `${asTester?.current?.account?.username} / ${asTester?.current?.account?.displayName}`)
    ledger.check('and the two accounts have different ids, so the product can tell them apart at all',
      Boolean(asTester?.current?.account?.id) && asTester.current.account.id !== asOwner?.current?.account?.id,
      `${String(asOwner?.current?.account?.id).slice(0, 8)}… vs ${String(asTester?.current?.account?.id).slice(0, 8)}…`)

    /* ============ 4. THE LEAK TEST, FIRST DIRECTION: OWNER -> STRANGER ======= */
    await window.clickVisible('[data-account-home]')
    await delay(900)
    const testerSurfaces = await captureEverySurface(window, 'second-person-signed-in')
    allSurfaces.push(...testerSurfaces)

    const nameLeaks = testerSurfaces.filter(surface => surface.text.includes(OWNER.marker))
    ledger.check('THE SECOND PERSON NEVER SEES THE FIRST PERSON\'S NAME on any surface',
      nameLeaks.length === 0, nameLeaks.map(surface => `${surface.surface}/${surface.route}`).join(', '))

    const testerTheme = await window.evaluate('document.documentElement.dataset.theme')
    ledger.check('the second person does not inherit the first person\'s appearance choice',
      testerTheme !== ownerTheme, `theirs=${ownerTheme} mine=${testerTheme}`)

    await gotoSettings(window)
    const testerSettingValue = await window.evaluate(`(() => {
      const row = document.querySelector('[data-setting-id="${OWNER_SETTING.id}"]')
      if (!row) return 'row-absent'
      const pressed = row.querySelector('button[aria-pressed="true"]')
      return pressed ? pressed.dataset.settingValue : 'nothing-pressed'
    })()`)
    ledger.check('the second person does not inherit the first person\'s setting',
      testerSettingValue === OWNER_SETTING.def,
      `${OWNER_SETTING.id} reads ${testerSettingValue}, first person chose ${OWNER_SETTING.value}, default is ${OWNER_SETTING.def}`)

    await walkToCheckout(window)
    const testerSelection = await checkoutSelectionState(window)
    ledger.check('THE SECOND PERSON DOES NOT SEE THE FIRST PERSON\'S PURCHASE SELECTION',
      testerSelection.selected.length === 0,
      `selected=${testerSelection.selected.join(',') || 'none'} of ${testerSelection.rows} lines`)

    const checkoutText = await screenText(window)
    ledger.check('and no payment binding, card, or vault line belonging to anyone else is on the purchase screen',
      !/card ending|•••|\*\*\*\*\s?\d{4}|cardholder/i.test(checkoutText),
      checkoutText.split('\n').filter(line => /card|vault|payment/i.test(line)).slice(0, 3).join(' / ') || 'no card line')
    writeEvidence(scratch, 'checkout-as-second-person.txt', checkoutText)

    /* ============ 5. THE SECOND PERSON LEAVES TRACES OF THEIR OWN =========== */
    await openDrawer(window)
    await window.clickVisible('#theme-seg button[data-theme="tan"]')
    await delay(900)
    const testerTheme2 = await window.evaluate('document.documentElement.dataset.theme')
    await closeDrawer(window)
    await gotoSettings(window)
    /* A different person may have a different remembered open-state, so the
       groups are opened again the way this person would. */
    await window.evaluate(`(() => { for (const head of document.querySelectorAll('.settings-group-head[aria-expanded="false"]')) head.click(); return true })()`)
    await delay(500)
    const testerSet = await window.clickVisible(
      `[data-setting-id="${TESTER_SETTING.id}"] button[data-setting-value="${TESTER_SETTING.value}"]`)
    await delay(800)
    ledger.check('the second person changes a setting of their own',
      testerSet === 'clicked', `theme=${testerTheme2} ${TESTER_SETTING.id} click=${testerSet}`)
    await walkToCheckout(window)
    const testerTick = await tickCheckoutLine(window, 'qa-line-two')
    const testerPicked = await checkoutSelectionState(window)
    ledger.check('and ticks a different line on the purchase screen',
      testerPicked.selected.includes('qa-line-two'), `${testerTick} selected=${testerPicked.selected.join(',')}`)

    /* ============ 6. THE REVERSE DIRECTION: STRANGER -> OWNER =============== */
    const testerSignedOut = await signOutOnScreen(window)
    ledger.check('the second person signs out', testerSignedOut === 'clicked', testerSignedOut)
    const ownerBackIn = await signInOnScreen(window, OWNER, ownerPassword)
    ledger.check('the first person can sign back in', ownerBackIn === 'submitted', ownerBackIn)
    const backAsOwner = await accountState(window)
    ledger.check('and is recognised as themselves again',
      backAsOwner?.current?.account?.username === OWNER.username,
      String(backAsOwner?.current?.account?.username))

    await window.clickVisible('[data-account-home]')
    await delay(900)
    const ownerAgainSurfaces = await captureEverySurface(window, 'first-person-returned')
    allSurfaces.push(...ownerAgainSurfaces)

    const inheritedName = ownerAgainSurfaces.filter(surface => surface.text.includes(TESTER.marker))
    ledger.check('THE FIRST PERSON DOES NOT INHERIT THE SECOND PERSON\'S NAME on any surface',
      inheritedName.length === 0, inheritedName.map(surface => `${surface.surface}/${surface.route}`).join(', '))

    const ownerThemeBack = await window.evaluate('document.documentElement.dataset.theme')
    ledger.check('the first person\'s own appearance choice is what they come back to',
      ownerThemeBack === 'black', `expected black, found ${ownerThemeBack}`)

    await gotoSettings(window)
    const ownerSettingBack = await window.evaluate(`(() => {
      const row = document.querySelector('[data-setting-id="${TESTER_SETTING.id}"]')
      if (!row) return 'row-absent'
      const pressed = row.querySelector('button[aria-pressed="true"]')
      return pressed ? pressed.dataset.settingValue : 'nothing-pressed'
    })()`)
    ledger.check('the first person does not inherit the setting the second person changed',
      ownerSettingBack === TESTER_SETTING.def,
      `${TESTER_SETTING.id} reads ${ownerSettingBack}, second person chose ${TESTER_SETTING.value}`)

    await walkToCheckout(window)
    const ownerSelectionBack = await checkoutSelectionState(window)
    ledger.check('THE FIRST PERSON DOES NOT INHERIT THE SECOND PERSON\'S PURCHASE SELECTION',
      !ownerSelectionBack.selected.includes('qa-line-two'),
      `selected=${ownerSelectionBack.selected.join(',') || 'none'}`)
    ledger.check('and the first person\'s own selection is still theirs',
      ownerSelectionBack.selected.includes('qa-line-one'),
      `selected=${ownerSelectionBack.selected.join(',') || 'none'}`)

    /* ============ 7. THE MECHANISM, NOT ONLY THE SCREEN ==================== */
    const prefs = readPrefs(profile)
    writeEvidence(scratch, 'prefs-at-end.json', prefs)
    const themeKey = prefValue(prefs, 'mc.theme')
    /* Each subject's OWN key. This built `mc.set.<id>` for both until
       2026-08-20, which was true of the two rows it then used and is not true
       in general -- `theme` stores under `mc.theme`. A probe that reads a key
       nothing writes finds nothing and reports a clean partition. */
    const ownerKey = prefValue(prefs, OWNER_SETTING.key)
    const testerKey = prefValue(prefs, TESTER_SETTING.key)
    const selectionKey = prefValue(prefs, 'mc.checkout.v1')
    ledger.note(`the preferences file holds: mc.theme=${JSON.stringify(themeKey)} `
      + `${OWNER_SETTING.key}=${JSON.stringify(ownerKey)} `
      + `${TESTER_SETTING.key}=${JSON.stringify(testerKey)} `
      + `mc.checkout.v1=${selectionKey ? `${String(selectionKey).length} bytes` : 'absent'}`)

    /* THE PARTITION, ASKED OF THE FILE RATHER THAN OF THE SCREEN.
     *
     * Two people have now each chosen a theme, each changed a different
     * setting, and each ticked a different line. If the store is partitioned by
     * account, the file holds BOTH of each pair at the same time -- two theme
     * bindings, two selection records -- because neither person's choice was
     * ever the same record as the other's. If it is not, the file holds one of
     * each and the second person overwrote the first. That is a question about
     * bytes, and it does not care what the screen was showing when it was
     * asked. */
    const storedKeys = Object.keys(prefs?.values || prefs?.entries || prefs || {})
    const themeBindings = storedKeys.filter(key => key === 'mc.theme' || key.endsWith(':mc.theme') || /mc\.theme/.test(key))
    const selectionBindings = storedKeys.filter(key => /mc\.checkout\.v1/.test(key))
    ledger.check('the appearance choice is stored once PER ACCOUNT, not once per computer',
      themeBindings.length >= 2, `${themeBindings.length} theme binding(s): ${themeBindings.join(', ') || 'none'}`)
    ledger.check('the purchase selection is stored once PER ACCOUNT, not once per computer',
      selectionBindings.length >= 2, `${selectionBindings.length} selection binding(s): ${selectionBindings.join(', ') || 'none'}`)
    ledger.note(`preference keys on disk (${storedKeys.length}): ${storedKeys.slice(0, 14).join(', ')}`)

    /* WHERE THE PARTITION WOULD BE, IF THE SCREENS USED IT.
     *
     * The main process has a per-account store -- shell/product-account.cjs
     * names the directory, shell/main.cjs registers the channels, and the
     * preload exposes getSetting/putSetting on the `mcAccount` bridge. So the
     * question this lane can answer that a unit test cannot is whether the
     * SCREENS reach it. Two people have now each changed a theme, changed a
     * setting and ticked a purchase line through the shipped controls; if any
     * of that went to an account, there is a file with an account id on it. */
    const partitionDirectory = path.join(userDataFor(profile), 'accounts')
    const partitionFiles = existsSync(partitionDirectory) ? readdirSync(partitionDirectory) : []
    ledger.check('the per-account store holds a file for each account after both people used the product',
      partitionFiles.length >= 2,
      existsSync(partitionDirectory)
        ? `${partitionFiles.length} file(s) in ${partitionDirectory}`
        : `${partitionDirectory} was never created`)

    const bridgeSurface = await window.evaluate(`(() => {
      const bridge = globalThis.mcAccount
      return bridge ? Object.keys(bridge) : null
    })()`)
    ledger.note(`the mcAccount bridge exposes: ${Array.isArray(bridgeSurface) ? bridgeSurface.join(', ') : 'no bridge'}`)
    const hasSettingChannel = Array.isArray(bridgeSurface)
      && bridgeSurface.includes('getSetting') && bridgeSurface.includes('putSetting')
    ledger.note(hasSettingChannel
      ? 'a per-account settings channel EXISTS on the bridge, so the gap above is wiring rather than a missing mechanism'
      : 'there is no per-account settings channel on the bridge at all')

    /* ============ 8. THE PRIVACY SWEEP, OVER EVERY SURFACE CAPTURED ========= */
    let redactions = 0
    const sweepCorpus = allSurfaces.map(surface => {
      const cleaned = withoutHarnessPaths(surface.text, [scratch, path.dirname(scratch)])
      redactions += cleaned.count
      return { ...surface, text: cleaned.text }
    })
    ledger.note(`the rig's own scratch path was redacted ${redactions} time(s) before the sweep, `
      + 'so a temp directory that happens to sit under the developer home is not counted as a leak')

    const patterns = ownerIdentityPatterns()
    if (!patterns) {
      ledger.check('the owner identity profile is available, so the privacy sweep can run at all',
        false, 'private/owner-data-patterns.owner.json is not on this machine')
    } else {
      const hits = sweepForOwnerIdentity(sweepCorpus, patterns)
      ledger.check(`no surface shows the owner's real identity (${patterns.length} patterns x ${sweepCorpus.length} captures)`,
        hits.length === 0, hits.slice(0, 8).join(' | '))
    }

    /* Machine paths, private addresses and unrelated project names, which the
       identity profile does not cover and which strangers must never see. */
    const environmental = [
      { name: 'a path into a developer home directory', re: /[A-Z]:\\Users\\[A-Za-z0-9._-]+\\/i },
      { name: 'a private LAN address', re: /\b(?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/ },
      { name: 'an internal source path', re: /\b(?:src|tools|shell)\/[a-z0-9-]+\.(?:js|cjs|mjs|json)\b/ },
      { name: 'an owner-request identifier', re: /\bR1[0-9]{3}\b/ },
    ]
    const environmentalHits = []
    for (const probe of environmental) {
      for (const surface of sweepCorpus) {
        const match = probe.re.exec(surface.text)
        if (match) environmentalHits.push(`${probe.name} on ${surface.label}/${surface.route}`)
      }
    }
    ledger.check('no surface shows a machine path, a private address, an internal source path, or a request id',
      environmentalHits.length === 0, [...new Set(environmentalHits)].slice(0, 8).join(' | '))

    writeEvidence(scratch, 'surfaces.json', allSurfaces.map(surface => ({
      label: surface.label, surface: surface.surface, route: surface.route, chars: surface.text.length,
    })))
    for (const surface of allSurfaces) {
      writeEvidence(scratch, `surface-${surface.label}-${surface.surface}-${surface.route}.txt`, surface.text)
    }
  } finally {
    try { await closeWindow(window) } catch { /* already gone */ }
    if (!process.env.TEST_ACCOUNT_QA_KEEP) {
      try { rmSync(scratch, { recursive: true, force: true, maxRetries: 3 }) } catch { /* Windows may hold a DLL */ }
    } else {
      console.log(`kept evidence in ${scratch}`)
    }
  }

  console.log(`\nrun duration ${((Date.now() - started) / 1000).toFixed(1)}s over ${allSurfaces.length} captured surfaces`)
  ledger.finish('account isolation, both directions')
}

main().catch(error => {
  console.error(error?.stack || error?.message || String(error))
  process.exitCode = 1
})
