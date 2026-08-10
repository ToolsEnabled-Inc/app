#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// PATTERNS ARE IN TWO HALVES, AND THE SPLIT IS THE POINT.
//
// This product started as one person's personal tool and is becoming something
// strangers install. Some of what must never ship is true for ANY builder -- a home
// directory path, a credential variable name, the internal name of this repository.
// Those are product facts and belong here, in code.
//
// The rest is WHO THE BUILDER IS: their name, username, account aliases, LAN range.
// That is user data. Hardcoding it protects exactly one person and gives the next one
// nowhere to put their own, so it lives in private/owner-data-patterns.owner.json.
//
// The mechanism is code. The identity is a setting.

// UNTRACKING IS NOT HISTORY REMOVAL. Keeping this profile under private/ prevents
// future commits from carrying it, but values already committed still exist in Git
// history. Publishing this repository publicly therefore requires a fresh repository
// or a history rewrite; untracking alone is not sufficient.

// Built-in: true for anyone who builds this product, regardless of who they are.
const BUILT_IN_PATTERNS = [
  // Home-directory paths. Any absolute user path leaks the builder's account name
  // even when the account name itself is not in the identity profile.
  { label: String.raw`C:\Users`, bytes: Buffer.from(String.raw`C:\Users`), caseInsensitive: true },
  { label: "C:/Users", bytes: Buffer.from("C:/Users"), caseInsensitive: true },
  // CREDENTIALS ARE MATCHED BY VALUE SHAPE, NOT BY VARIABLE NAME.
  //
  // This rule used to be the literals ANTHROPIC_API_KEY and OPENAI_API_KEY, on the
  // reasoning that a shipped file naming a secret env var teaches an attacker what to
  // look for. That reasoning does not survive contact with the payload. Those variable
  // names are public, documented by their own vendors; knowing one reveals nothing. And
  // of the ten matches the name rule actually produced, the load-bearing one was in
  // src/lib/providers/cli-provider-gateway.js -- the code that DELETES those variables
  // from bounded child environments so a spawned CLI cannot inherit the operator's
  // credentials. The rest were vault KEY NAMES (aicalendar_anthropic_api_key), which are
  // identifiers for a lookup, not secrets.
  //
  // So the old rule flagged the credential-isolation code as a privacy defect. That is
  // worse than useless: the only way to ship with it was --allow-owner-data, and a guard
  // that must be overridden to pass is a guard that is overridden the day a REAL leak is
  // behind it too. Naming a variable is not a leak; carrying its value is.
  //
  // The replacement matches issued key material by its provider prefix and length, which
  // is the thing that must never ship and which the name rule never caught. Coverage
  // goes up, not down: a hardcoded sk-ant-... string was invisible to the old rule and
  // fails this one. Verified by planting one; see the guard-plant note in the P3.4 record.
  { label: "provider API key value (sk-...)", regex: /\bsk-[A-Za-z0-9_-]{20,}/g },
  // Internal repository and tree names are forbidden. The product's OWN public
  // identity is not, and must not be caught by the same rule -- those are two
  // different things that happen to share a word.
  //
  // toolsenabled-current names the private working layout this product is
  // built from, and appeared in shipped failure text rendered into the DOM.
  // That is unambiguously a tree-name leak and stays matched exactly as
  // written.
  //
  // A bare, unanchored "ToolsEnabled" used to sit here too, and it was wrong.
  // It was written when "ToolsEnabled" was only ever an internal name, before
  // this product had a public identity of its own -- so at the time, every
  // occurrence really was a leak. That stopped being true the day the product
  // got a real publisher: "ToolsEnabled, Inc." is now the required
  // CompanyName/Publisher (Machine B's acceptance matrix), and
  // com.toolsenabled.missioncontrol is the required appId. Case-insensitive
  // and unanchored, the bare word matched both of those every time, which
  // means it did not just block one manifest field -- it forbade the
  // product's own identity namespace in every future build, forever. The
  // actual owner-data leak in the old rejected build was
  // com.joshp.missioncontrol, which carries the owner's username; that is
  // caught below, by the identity profile, not by this rule, and remains
  // caught.
  //
  // THE PATH-SEPARATOR REFINEMENT WAS THE SAME MISTAKE ONE STEP SMALLER, and
  // this is the second correction. Matching the word next to a separator was
  // meant to mean "this is a filesystem path". It does not. Measured over the
  // real staged payload it produced 36 matches and every single one was the
  // product's own identity, because a separator next to the product name is
  // what the product's own namespace LOOKS LIKE:
  //
  //   'user-agent': 'ToolsEnabled/1.4'          five providers
  //   \ToolsEnabled-<name>                      Windows scheduled task names,
  //                                             asserted by exact equality in
  //                                             scheduler-adapter.js and
  //                                             state-store.js
  //   \\.\pipe\ToolsEnabled.UacDelegation.V1    the UAC delegation pipe
  //   toolsenabled/agent-playwright-sandbox     the sandbox docker image tag
  //   /opt/toolsenabled/bounded-exec.js         paths INSIDE that image
  //   /toolsenabled/cws/oauth2/callback         our own loopback OAuth route
  //   ToolsEnabled/FRA/workspace-policy/v1      sha256/HMAC domain separators
  //   config/toolsenabled.policy.json           product files, repo-relative
  //
  // The domain separators are the load-bearing case and the reason this rule
  // could never be satisfied by purging: they are hashed into digests and FRA
  // runtime-integrity anchors that already exist, so changing the string
  // invalidates signatures on disk. A rule with zero true positives that is
  // also impossible to satisfy does not get fixed -- it gets overridden, and
  // then it is not protecting anything at all.
  //
  // What the rule was always trying to catch is narrower and has a shape: the
  // tree name as a DIRECTORY COMPONENT OF AN ABSOLUTE PATH ON A REAL MACHINE.
  // That shape needs a drive root, so that is what is matched. None of the
  // product surfaces above have one; a checkout path always does, whether or
  // not it lives under C:\Users -- "D:\dev\ToolsEnabled\src" is caught here
  // and by nothing else in this list.
  { label: "toolsenabled-current", bytes: Buffer.from("toolsenabled-current"), caseInsensitive: true },
  { label: "builder checkout path (<drive>:\\...\\ToolsEnabled)", regex: /[A-Za-z]:[\\/][^\r\n]{0,160}?[\\/]toolsenabled/gi },
  // "agent-coord" was here, as an "internal coordination surface". It is not
  // internal. It is the durable memory namespace this product's own shipped
  // tool descriptions instruct agents to use -- memory.set names it as the
  // inter-agent coordination board, and it is the documented agent-to-agent
  // channel. Removing the string from the payload would mean renaming a live
  // namespace that existing durable rows, every running agent and CLAUDE.md
  // all refer to. It also identifies nobody: it is a fixed product string with
  // no builder, machine or account in it. It was 26 of the 113 original
  // matches and not one of them was owner data.
];

// THE IDENTITY PROFILE IS REQUIRED, AND A MISSING ONE IS AN ERROR.
//
// Every identity pattern now lives in config. That makes absence dangerous in a way it
// was not when these values were literals: with no profile, this guard still reports a
// clean scan while looking for nothing that identifies anybody. A privacy control that
// passes because it was given nothing to find is the absence-as-emptiness defect this
// project has now found seven times, and it would be at its worst here -- the failure
// is invisible and the consequence ships.
//
// So: missing file, unreadable file, wrong shape, or empty list are all hard errors
// naming the example template. Getting a build to pass must require saying who you are.
function loadIdentityPatterns(root) {
  const file = path.join(root, "private", "owner-data-patterns.owner.json");
  const relative = "private/owner-data-patterns.owner.json";

  if (!existsSync(file)) {
    throw new Error(
      `${relative} is missing. This guard has no identity to look for, so it would pass ` +
        "any bundle containing your name, username or account aliases. Copy " +
        "config/owner-data-patterns.example.json to that path and fill in your own values.",
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${relative} is present but unreadable: ${error.message}`);
  }

  const list = parsed && Array.isArray(parsed.patterns) ? parsed.patterns : null;
  if (!list) throw new Error(`${relative} must contain a "patterns" array.`);
  if (list.length === 0) {
    throw new Error(`${relative} declares no patterns. An empty identity profile protects nobody.`);
  }

  return list.map((entry, index) => {
    const value = typeof entry === "string" ? entry : entry && entry.value;
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`${relative} entry ${index} has no usable string value.`);
    }
    return {
      label: value,
      bytes: Buffer.from(value),
      caseInsensitive: !(entry && entry.caseSensitive === true),
    };
  });
}

// A PROFILE THAT EXISTS IS NOT YET A PROFILE THAT IS YOURS.
//
// The owner's filled-in profile stays local on purpose: it is their data, and their
// working build on this machine must retain it. A profile can still be copied from a
// different account, restored from an unsafe cache, or supplied incorrectly on a shared
// build machine. The guard above would find that file, scan all 366 MB, and report clean
// while looking for someone else's name, username and aliases. The builder's own identity
// would walk into the installer untouched. Same shape as the empty-profile hole this file
// already closes: the check passes because of what it was not given, the failure is
// invisible, and the consequence ships.
//
// Requiring a profile to EXIST therefore proves nothing about WHOSE it is. So the guard
// also asks whether anything in the profile relates to the account running the build.
//
// The relation test is deliberately loose -- case-insensitive substring in either
// direction -- because the account "builder", the pattern "builder" and a longer alias
// containing it are all the same person, and a stricter rule would reject legitimate
// profiles and get deleted. Loose is enough: the case that must never pass is a profile
// with NOTHING in it relating to the current account, which is exactly what a stranger
// inherits. Built-in patterns are excluded from this test on purpose; they belong to the
// product, not to a person, and letting `C:\Users` vouch for an account named "user"
// would hand back the hole.
const ACCOUNT_OVERRIDE_VARIABLE = "MC_IDENTITY_PROFILE_ACCOUNT";

function detectBuildAccount() {
  const override = process.env[ACCOUNT_OVERRIDE_VARIABLE];

  if (override !== undefined) {
    // The escape hatch exists for CI and shared build machines, whose account name is
    // legitimately not the profile owner's. It renames the account being checked; it
    // never means "skip the check". A blank value is refused rather than ignored,
    // because the empty string is a substring of every pattern -- accepting it would
    // turn this variable into an off switch, which is the hole with extra steps.
    if (!override.trim()) {
      throw new Error(
        `${ACCOUNT_OVERRIDE_VARIABLE} is set but empty. It overrides the account name this ` +
          "guard checks the identity profile against; it cannot switch the check off. Set it to " +
          "the account name private/owner-data-patterns.owner.json describes, or unset it.",
      );
    }
    return { name: override.trim(), source: ACCOUNT_OVERRIDE_VARIABLE };
  }

  let username;
  try {
    username = os.userInfo().username;
  } catch (error) {
    throw new Error(
      `cannot determine which account is building this (${error.message}), so it cannot be ` +
        `checked against private/owner-data-patterns.owner.json. Set ${ACCOUNT_OVERRIDE_VARIABLE} to the ` +
        "account name that profile describes.",
    );
  }

  if (typeof username !== "string" || !username.trim()) {
    throw new Error(
      "the operating system reported an empty account name, so the identity profile cannot be " +
        `checked against it. Set ${ACCOUNT_OVERRIDE_VARIABLE} to the account name ` +
        "private/owner-data-patterns.owner.json describes.",
    );
  }

  return { name: username.trim(), source: "os.userInfo().username" };
}

function relatesToAccount(value, accountName) {
  const pattern = value.trim().toLowerCase();
  const account = accountName.toLowerCase();
  if (!pattern || !account) return false;
  return pattern.includes(account) || account.includes(pattern);
}

function assertProfileBelongsToBuilder(identityPatterns, account) {
  if (identityPatterns.some((pattern) => relatesToAccount(pattern.label, account.name))) return;

  throw new Error(
    "private/owner-data-patterns.owner.json is somebody else's identity profile (it does not mention " +
      `the account building this: ${account.name}). Copy config/owner-data-patterns.example.json ` +
      "to private/owner-data-patterns.owner.json and fill in your own values, or add your own entries. " +
      `[account name from ${account.source}; a build machine whose account legitimately differs ` +
      `can set ${ACCOUNT_OVERRIDE_VARIABLE} to the account the profile describes]`,
  );
}

// Resolved at the START of main, not at module load. Both matter:
//
// - Not at module load, because a throw there escapes main()'s catch, exits 1 -- the
//   code that means MATCHES WERE FOUND -- and prints a Node stack trace. A setup
//   problem must not be indistinguishable from a leak, and the person most likely to
//   see it is a new user who needs one sentence, not a traceback.
// - Still before the walk, so a broken profile fails in milliseconds rather than
//   part-way through 366 MB.
let ACTIVE_PATTERNS = [];

function asciiLower(byte) {
  return byte >= 0x41 && byte <= 0x5a ? byte + 0x20 : byte;
}

// Returns {offset, length} rather than a bare offset because a pattern may now
// be a regex, whose match length varies per hit and is what the excerpt window
// has to be centred on.
function findMatches(buffer, pattern) {
  const found = [];

  if (pattern.regex) {
    // latin1 maps one byte to one character with no multi-byte collapsing, so
    // string indices ARE byte offsets. Decoding as utf8 here would silently
    // shift every reported offset in any file containing a non-ASCII byte, and
    // would drop bytes that are not valid utf8 -- which is exactly where
    // something could hide from this scan.
    const text = buffer.toString("latin1");
    pattern.regex.lastIndex = 0;
    let match;
    while ((match = pattern.regex.exec(text)) !== null) {
      found.push({ offset: match.index, length: match[0].length });
      if (match[0].length === 0) pattern.regex.lastIndex += 1;
    }
    return found;
  }

  const lastStart = buffer.length - pattern.bytes.length;

  for (let start = 0; start <= lastStart; start += 1) {
    let matched = true;
    for (let index = 0; index < pattern.bytes.length; index += 1) {
      const actual = buffer[start + index];
      const expected = pattern.bytes[index];
      if (
        pattern.caseInsensitive
          ? asciiLower(actual) !== asciiLower(expected)
          : actual !== expected
      ) {
        matched = false;
        break;
      }
    }
    if (matched) found.push({ offset: start, length: pattern.bytes.length });
  }

  return found;
}

function excerpt(buffer, offset, matchLength) {
  const maximumLength = 120;
  const context = Math.floor((maximumLength - matchLength) / 2);
  const start = Math.max(0, offset - context);
  const end = Math.min(buffer.length, offset + matchLength + context);
  const printable = Array.from(buffer.subarray(start, end), (byte) =>
    byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : ".",
  ).join("");

  return `${start > 0 ? "..." : ""}${printable}${end < buffer.length ? "..." : ""}`;
}

async function walk(directory, visitFile) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;

    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await walk(entryPath, visitFile);
    } else if (entry.isFile()) {
      await visitFile(entryPath);
    }
  }
}

function chooseRoots(arguments_) {
  if (arguments_.length > 0) return arguments_;
  if (existsSync("release")) return ["release"];
  if (existsSync("dist")) return ["dist"];
  throw new Error('nothing to check: pass a directory, or create "release" or "dist"');
}

async function main() {
  // Load, then prove ownership, then walk. Both checks are cheap and both run before a
  // single file is read, so a setup problem costs milliseconds instead of surfacing
  // part-way through 366 MB -- and both throw inside main(), so they exit 2 with one
  // sentence rather than 1 with a stack trace.
  const identityPatterns = loadIdentityPatterns(REPO_ROOT);
  assertProfileBelongsToBuilder(identityPatterns, detectBuildAccount());
  ACTIVE_PATTERNS = [...BUILT_IN_PATTERNS, ...identityPatterns];
  const roots = chooseRoots(process.argv.slice(2));
  let filesScanned = 0;
  let bytesScanned = 0;
  let totalMatches = 0;
  const perPattern = new Map(ACTIVE_PATTERNS.map(({ label }) => [label, 0]));

  for (const root of roots) {
    const resolvedRoot = path.resolve(root);
    let rootStat;
    try {
      rootStat = await lstat(resolvedRoot);
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new Error(`nothing to check: directory does not exist: ${root}`);
      }
      throw error;
    }

    if (rootStat.isSymbolicLink()) {
      throw new Error(`nothing to check: refusing to follow symlink: ${root}`);
    }
    if (!rootStat.isDirectory()) {
      throw new Error(`nothing to check: not a directory: ${root}`);
    }

    await walk(resolvedRoot, async (filePath) => {
      const buffer = await readFile(filePath);
      filesScanned += 1;
      bytesScanned += buffer.length;

      for (const pattern of ACTIVE_PATTERNS) {
        const hits = findMatches(buffer, pattern);
        if (hits.length === 0) continue;

        totalMatches += hits.length;
        perPattern.set(pattern.label, perPattern.get(pattern.label) + hits.length);
        console.log(`${filePath} | pattern=${JSON.stringify(pattern.label)} | matches=${hits.length}`);
        for (const hit of hits) {
          console.log(`  offset=${hit.offset} | excerpt=${JSON.stringify(excerpt(buffer, hit.offset, hit.length))}`);
        }
      }
    });
  }

  if (filesScanned === 0) {
    throw new Error(`nothing to check: scanned 0 files in ${roots.length} director${roots.length === 1 ? "y" : "ies"}`);
  }

  console.log(`Scanned ${filesScanned} files (${bytesScanned} bytes). Total matches: ${totalMatches}.`);
  console.log(
    `Per-pattern matches: ${ACTIVE_PATTERNS.map(({ label }) => `${JSON.stringify(label)}=${perPattern.get(label)}`).join(", ")}`,
  );

  if (totalMatches > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Owner-data guard error: ${error.message}`);
  process.exitCode = 2;
});
