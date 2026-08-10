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
  // Credential names. A shipped file naming a secret env var teaches an attacker
  // what to look for, and signals internal tooling was packaged by accident.
  { label: "ANTHROPIC_API_KEY", bytes: Buffer.from("ANTHROPIC_API_KEY"), caseInsensitive: true },
  { label: "OPENAI_API_KEY", bytes: Buffer.from("OPENAI_API_KEY"), caseInsensitive: true },
  // Internal repository and tree names. These name the private working layout this
  // product is built from, and appeared in shipped failure text rendered into the DOM.
  { label: "toolsenabled-current", bytes: Buffer.from("toolsenabled-current"), caseInsensitive: true },
  { label: "ToolsEnabled", bytes: Buffer.from("ToolsEnabled"), caseInsensitive: true },
  // Internal coordination surfaces that should never be named in a shipped product.
  { label: "agent-coord", bytes: Buffer.from("agent-coord"), caseInsensitive: true },
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

function findMatches(buffer, pattern) {
  const offsets = [];
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
    if (matched) offsets.push(start);
  }

  return offsets;
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
        const offsets = findMatches(buffer, pattern);
        if (offsets.length === 0) continue;

        totalMatches += offsets.length;
        perPattern.set(pattern.label, perPattern.get(pattern.label) + offsets.length);
        console.log(`${filePath} | pattern=${JSON.stringify(pattern.label)} | matches=${offsets.length}`);
        for (const offset of offsets) {
          console.log(`  offset=${offset} | excerpt=${JSON.stringify(excerpt(buffer, offset, pattern.bytes.length))}`);
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
