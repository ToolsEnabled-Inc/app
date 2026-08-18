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
