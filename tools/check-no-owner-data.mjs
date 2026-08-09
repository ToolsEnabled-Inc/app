#!/usr/bin/env node

import { existsSync } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const PATTERNS = [
  { label: "joshp", bytes: Buffer.from("joshp"), caseInsensitive: true },
  { label: "192.168.214.", bytes: Buffer.from("192.168.214.") },
  { label: String.raw`C:\Users`, bytes: Buffer.from(String.raw`C:\Users`), caseInsensitive: true },
  { label: "C:/Users", bytes: Buffer.from("C:/Users"), caseInsensitive: true },
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
