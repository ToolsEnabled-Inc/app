/* THE WORDS FOR "YOU HAVE MORE THAN ONE ACCOUNT", AND THE WARNING THAT SHIPS
 * BESIDE THE CLAUDE ONE.
 *
 * WHY THE COPY IS HERE AND NOT IN THE VIEW. src/views/guide.js is a renderer;
 * every sentence it draws already comes from src/first-run-needs.js, for the
 * reason that file's own header gives -- copy inside a render function can only
 * be checked by reading the render function. The plain-language gate
 * (tools/check-plain-language.mjs) and the suites walk VALUES, so a sentence
 * written inline is a sentence nothing measures.
 *
 * WHAT THE PANEL IS FOR. A person can hold two accounts with the same program:
 * a school one and a personal one is the ordinary case. Each keeps its sign-in
 * in a folder of its own. Until this panel there was no way to see that list or
 * add to it from inside the product -- the only route was hand-writing a file
 * in a directory a customer has no reason to know exists.
 *
 * NOTHING HERE ASKS FOR A SIGN-IN. The panel shows the COMMAND a person runs
 * themselves, in their own terminal, which is the one arrangement where this
 * product never touches a credential. There is deliberately no field for a key
 * and no button that signs anybody in.
 */

export const ACCOUNT_PANEL = Object.freeze({
  heading: 'Accounts you have added',

  /* The whole idea in two short sentences. "One account, one folder" is the
     rule the engine actually enforces, said as a person would say it. */
  help: 'One account, one folder. Each folder keeps its own sign-in, so two accounts never write over each other.',

  /* THE EMPTY STATE IS NOT A FAILURE AND MUST NOT READ AS ONE. Almost everybody
     has exactly one sign-in, and that is a working setup, not a missing step.
     So this says what IS true first, and offers the addition second. */
  none: 'Nothing is listed here, so this copy uses the one sign-in already on this computer. Add a name and a folder below to keep a second account.',

  /* Absence and damage are different, and only one of them means a list is
     still there. This is the second. */
  unreadable: 'This copy could not read its list of accounts, so none are shown. Nothing has been lost; open this page again to retry.',

  inUse: 'In use now',
  activeNote: 'The mark shows the account this computer switched to last.',

  signedIn: 'Signed in',
  notSignedIn: 'No sign-in in that folder yet',

  commandLead: 'To sign this folder in, paste this line into Windows Terminal:',
  commandNote: 'Nothing here runs that line, and nothing here reads what it writes.',

  namePlaceholder: 'Name this account…',
  folderPlaceholder: 'Folder that holds its sign-in…',
  nameLabel: 'Name for this account',
  folderLabel: 'Folder that holds its sign-in',
  add: (program) => `Add a ${program} account`,
  remove: 'Remove',

  needBoth: 'Type a name and a folder, then press the button again.',
  refused: 'That account was not added. Pick a different name or folder, then press the button again.',
  removeRefused: 'That account is still listed. Press Remove again.',
})

/* THE WORDS AROUND THE ONE BUTTON THAT STARTS A SIGN-IN.
 *
 * WHY THE BUTTON EXISTS. The first external user of 1.0.20 followed the
 * guide's commands by hand and got stuck exactly where the owner predicted:
 * the window their install ran in could not see the new program and called
 * "codex login" not a command. The button removes the terminal from the path:
 * the product starts the provider's own login program directly, so there is
 * no window to be stale.
 *
 * WHAT THE WORDS MUST HOLD. The button starts the OFFICIAL program's own
 * flow and nothing else; the sentences must never suggest this product
 * collects, sees, or keeps a sign-in, because it structurally cannot -- the
 * spawned program's input is closed and its files are never read. The
 * disabled states are the honest half: a missing program disables the button
 * and says the fix, because a button that spawns nothing is the defect the
 * guide exists to prevent. */
export const PROVIDER_SIGN_IN = Object.freeze({
  button: (program) => `Sign in to ${program}`,
  stopButton: 'Stop',
  lead: (program) => `One press starts ${program}'s own sign-in and your browser finishes it. Nothing here sees your password or your key.`,
  /* The disabled reasons. Absence names the fix that is already on screen --
     the install line sits directly above this button. */
  absent: (program) => `${program} is not on this computer yet, so there is no sign-in to start.`,
  unsure: (program) => `This copy could not tell whether ${program} is on this computer. The commands above still work in a terminal.`,
  /* Presence already says "Installed here, and signed in." right above; this
     is the button's own answer to "then what does pressing it do?" */
  alreadyIn: 'You are signed in already. Pressing this runs the program\'s own sign-in again, which is how accounts are switched.',
  running: 'The sign-in program is running. Your browser should open; what the program prints appears below.',
  openPage: 'Open the sign-in page',
  openPageLead: 'If your browser did not open on its own, this button opens the same page.',
  /* After the program exits, the truthful source is the presence line, so the
     done sentence points at it rather than declaring success itself. */
  doneOk: 'The sign-in program finished. The line above now says how this computer stands.',
  doneFail: 'The sign-in program stopped without finishing. Its own words are above; press the button to start it fresh.',
  /* NOT "nothing was changed": a stop can land after the browser already
     finished, and the program may have written its own store in between. The
     truthful sentence reports the stop and offers the way on. */
  stopped: 'The sign-in was stopped. Press the button to start it again.',
  refused: 'The sign-in program could not be started.',

  /* THE INSTALL HALF, added with the owner's one-click ruling. The programs
     are not bundled -- Claude Code's licence grants no redistribution, and the
     legal record REQ-engine-bundle-provider-clis.md settles Codex the same way
     for now -- so the button runs the official package install and this
     computer fetches the program from its maker's own channel. The sentences
     must say that plainly: the download is the provider's, not ours. */
  installButton: (program) => `Install ${program}`,
  installLead: (program) => `One press downloads ${program} from its maker's own channel and installs it for you. ToolsEnabled does not ship it or change it.`,
  installRunning: 'The installer is running. What it prints appears below, and it can take a few minutes.',
  installDoneFail: 'The install stopped without finishing. Its own words are above; press the button to try again.',
})

/* THE FOUR THINGS A PERSON IS OWED BEFORE THEY RUN CLAUDE FROM HERE.
 *
 * These four, in this order, are the whole instrument. The legal position
 * dropped every cap and every restriction on the Claude path -- the user decides
 * -- and this warning is what makes that a real choice rather than a shrug. So
 * each point is a finding a person can act on, and not one of them is
 * boilerplate:
 *
 *   1. it is THEIR account that carries the consequence, said first
 *   2. the provider can change it without telling anybody
 *   3. how much you run is what gets noticed, not what you ran it from
 *   4. the one correlation that is concrete enough to avoid
 *
 * THE FOURTH SENTENCE OF `today` IS WHERE THIS BUILD DIFFERS FROM THE ADVICE IT
 * FOLLOWS. The position says to name key-based sign-in as the alternative in the
 * same breath. This build does not carry it -- the transport is approved and
 * unwritten -- and a screen that offered a door with nothing behind it would be
 * a worse failure than the one the warning exists to prevent. So the alternative
 * named here is the one that is real today: do the work by hand, outside this
 * window.
 */
export const CLAUDE_ACCOUNT_RISK = Object.freeze({
  heading: 'Before you run Claude from here',
  points: Object.freeze([
    'If Anthropic acts on this, it acts on your own account, not on ours. That is why the choice is yours to make.',
    'Anthropic can change this or shut it off at any time, and it does not have to tell you first.',
    'How much you run is the signal, not which program you run it from. Heavy or unattended use is what draws attention.',
    'One pattern is worth naming: changing your plan while heavy automation is running. Most reported blocks followed a payment or a plan change.',
  ]),
  today: 'This copy starts Claude on your own sign-in and offers no other way in. If you would rather not take that risk, run Claude by hand outside this window.',
})
