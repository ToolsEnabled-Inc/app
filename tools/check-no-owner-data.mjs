#!/usr/bin/env node

import { existsSync } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

// Every pattern here is a class of thing that must never reach a stranger's disk.
// The first four are machine identity: username, LAN range, home-directory paths.
//
// The rest were added after all four of the originals passed while the built
// app.asar -- the exact payload of the installer -- contained the owner's real name,
// two references to a credential env var, the internal repo name, and vendor
// provenance in shipped UI text. The originals could not see any of it: they look for
// PATHS and ADDRESSES, and this leak was PROSE. `public/data/research-queue.json`
// ships 28 internal engineering post-mortems that name the owner and describe his
// private fleet, and `src/views/research.js` renders them verbatim on first run.
//
// So: identity is not only a path. A control that checks the shape of a leak it has
// already seen will not catch the next one wearing different clothes.
const PATTERNS = [
  { label: "joshp", bytes: Buffer.from("joshp"), caseInsensitive: true },
  { label: "192.168.214.", bytes: Buffer.from("192.168.214.") },
  { label: String.raw`C:\Users`, bytes: Buffer.from(String.raw`C:\Users`), caseInsensitive: true },
  { label: "C:/Users", bytes: Buffer.from("C:/Users"), caseInsensitive: true },
  // Owner identity as prose, not as a path.
  { label: "Josh Pinckard", bytes: Buffer.from("Josh Pinckard"), caseInsensitive: true },
  { label: "Pinckard", bytes: Buffer.from("Pinckard"), caseInsensitive: true },
  // ACCOUNT ALIASES. Added after `jpinc005` -- the owner's real university account --
  // was found shipping in src/vocab.js and src/views/metrics.js as simulation pool
  // names. NOT ONE PATTERN ABOVE CAUGHT IT: the name checks look for "Pinckard" and
  // "joshp", and an alias is neither. The scan would have passed with a real account
  // identifier in the bundle, on that build and every future one.
  //
  // The lesson generalises past these two strings: identity leaks as whatever the
  // owner actually types into systems, which is rarely his full name. Any new alias,
  // handle or account id he uses belongs here the day it is known.
  { label: "jpinc005", bytes: Buffer.from("jpinc005"), caseInsensitive: true },
  { label: "jpinckard", bytes: Buffer.from("jpinckard"), caseInsensitive: true },
  // Credential names. A shipped file naming a secret env var teaches an attacker
  // what to look for, and signals internal tooling was packaged by accident.
  { label: "ANTHROPIC_API_KEY", bytes: Buffer.from("ANTHROPIC_API_KEY"), caseInsensitive: true },
  { label: "OPENAI_API_KEY", bytes: Buffer.from("OPENAI_API_KEY"), caseInsensitive: true },
  // Internal repository and tree names. These identify the owner's private working
  // layout and appeared in shipped failure text rendered into the DOM.
  { label: "toolsenabled-current", bytes: Buffer.from("toolsenabled-current"), caseInsensitive: true },
  { label: "ToolsEnabled", bytes: Buffer.from("ToolsEnabled"), caseInsensitive: true },
  // Internal coordination surfaces that should never be named in a shipped product.
  { label: "agent-coord", bytes: Buffer.from("agent-coord"), caseInsensitive: true },
];

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
  const roots = chooseRoots(process.argv.slice(2));
  let filesScanned = 0;
  let bytesScanned = 0;
  let totalMatches = 0;
  const perPattern = new Map(PATTERNS.map(({ label }) => [label, 0]));

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

      for (const pattern of PATTERNS) {
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
    `Per-pattern matches: ${PATTERNS.map(({ label }) => `${JSON.stringify(label)}=${perPattern.get(label)}`).join(", ")}`,
  );

  if (totalMatches > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Owner-data guard error: ${error.message}`);
  process.exitCode = 2;
});
