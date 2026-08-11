#!/usr/bin/env node

// THE OPEN / PAID BOUNDARY, AS A BUILD GATE RATHER THAN A RULE.
//
// This product is being open-sourced except for a paid part. The decision of
// WHERE that line goes belongs to the owner. This file does not contain the
// decision -- config/payload-boundary.json does. This file is the mechanism
// that makes the decision take effect, and makes getting it wrong loud.
//
// WHY A GATE AND NOT A WRITTEN RULE. "Do not publish the paid part" as prose
// has already failed on this project in the general case: a standing order was
// retired in one tree and changed nothing, because the live hook ran from a
// different tree; three separate lanes independently found the live scheduled
// tasks executing the retired tree. Prose depends on someone remembering, at
// the moment it matters, which tree they are in. A gate does not.
//
// WHAT IS ACTUALLY AT RISK. The installer's capability payload
// (resources/capability/) is 224 PLAIN .js FILES. Not compiled, not minified,
// not obfuscated -- readable source, sitting next to a trivially extractable
// app.asar. Publishing the installer publicly IS publishing that source,
// whether or not a public repository exists. So the payload directory, not the
// repository, is the thing that has to be gated.
//
// THREE RULES GOVERN THIS FILE.
//
//   1. FAIL, DO NOT WARN. A file classified `paid` or `excluded` that is
//      present in the payload exits 1. `npm run dist` stops. There is no flag
//      that turns this into a warning, because a guard that can be downgraded
//      is downgraded on the day it finally catches something real.
//
//   2. UNCLASSIFIED IS A FAILURE, NOT A DEFAULT. Every file in the payload
//      must be named in the manifest. A file that appears tomorrow and matches
//      nothing stops the build until a human classifies it. Defaulting the
//      unknown to `open` would mean the next provider anyone adds ships
//      publicly by silence -- which is the absence-as-emptiness defect this
//      project has now found repeatedly, in its worst possible form: the
//      failure is invisible and the consequence is published source.
//
//      This rule is also what makes a TYPO in the manifest safe. A `paid` entry
//      spelled wrongly matches nothing -- but the real file then matches
//      nothing either, so it lands in unclassified and fails. A misspelled
//      boundary cannot silently ship the thing it was meant to hold back.
//
//   3. ASSERT BY NAMED PATH. NEVER BY COUNT. There is no expected-file-count
//      anywhere in this file, and there must never be one. On this project a
//      "216 -> 221 files" coincidence once nearly produced a false "it shipped"
//      conclusion: two different sets of the same size are indistinguishable by
//      counting, and the one time it matters is the one time they differ in
//      content rather than size. Counts are printed here as information and are
//      never compared against anything.
//
// EXIT CODES, mirroring tools/check-no-owner-data.mjs so the two guards are
// read the same way:
//   0  every payload file is classified, and nothing paid or excluded is present
//   1  VIOLATIONS -- the payload carries paid/excluded/unclassified files
//   2  guard error -- the manifest is missing, malformed, or self-contradictory

import { existsSync, readFileSync } from "node:fs";
import { lstat, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_MANIFEST = path.join(REPO_ROOT, "config", "payload-boundary.json");
const MANIFEST_RELATIVE = "config/payload-boundary.json";

// The payload roots this guard checks when none is named. Both are the SAME
// payload at different stages: `capability/` is what the packer stages, and
// resources/capability is where electron-builder copied it. Checking whichever
// exists means the guard is useful before a build and after one.
const DEFAULT_ROOTS = ["capability", "release/win-unpacked/resources/capability"];

const CLASSES = ["excluded", "paid", "open"];
const STATUS_PROPOSED = "proposed";
const STATUS_RATIFIED = "owner-ratified";

class GuardError extends Error {}

// ---------------------------------------------------------------------------
// Manifest loading and validation.
//
// Everything below throws GuardError, which becomes exit 2. A malformed
// boundary must never be reported as a clean payload, and must never be
// confused with a violation: those are different problems with different fixes,
// and telling them apart is the difference between "fix your manifest" and
// "you are about to publish the paid part".
// ---------------------------------------------------------------------------

// Paths in the manifest are payload-relative and POSIX. Anything else is
// rejected rather than normalised, because a manifest entry that does not
// match the way this guard walks the payload is an entry that silently
// classifies nothing -- and rule 2 is only load-bearing if entries mean what
// they appear to mean.
function assertUsablePath(value, where, { directory = false } = {}) {
  if (typeof value !== "string" || !value.trim()) {
    throw new GuardError(`${MANIFEST_RELATIVE}: ${where} contains an empty or non-string entry.`);
  }
  if (value !== value.trim()) {
    throw new GuardError(`${MANIFEST_RELATIVE}: ${where} entry ${JSON.stringify(value)} has surrounding whitespace.`);
  }
  if (value.includes("\\")) {
    throw new GuardError(
      `${MANIFEST_RELATIVE}: ${where} entry ${JSON.stringify(value)} uses a backslash. ` +
        "Payload paths are POSIX-relative; a backslash entry would match nothing on any platform.",
    );
  }
  if (value.startsWith("/") || /^[A-Za-z]:/.test(value)) {
    throw new GuardError(
      `${MANIFEST_RELATIVE}: ${where} entry ${JSON.stringify(value)} is absolute. ` +
        "Entries are relative to the payload root so the same manifest checks the staged and the packed copy.",
    );
  }
  if (value.startsWith("./") || value.split("/").includes("..") || value.split("/").includes(".")) {
    throw new GuardError(
      `${MANIFEST_RELATIVE}: ${where} entry ${JSON.stringify(value)} is not in normal form ` +
        '(no "./", no "..", no bare "." segments).',
    );
  }
  if (directory && !value.endsWith("/")) {
    throw new GuardError(
      `${MANIFEST_RELATIVE}: ${where} entry ${JSON.stringify(value)} must end with "/" so it is ` +
        'unambiguously a directory prefix. Without it, "state" would also match "stateful.js".',
    );
  }
  if (!directory && value.endsWith("/")) {
    throw new GuardError(`${MANIFEST_RELATIVE}: ${where} entry ${JSON.stringify(value)} is a file path and must not end with "/".`);
  }
}

function readList(container, key, where) {
  const value = container[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new GuardError(`${MANIFEST_RELATIVE}: ${where}.${key} must be an array.`);
  return value;
}

function loadManifest(file) {
  if (!existsSync(file)) {
    throw new GuardError(
      `${MANIFEST_RELATIVE} is missing. This guard holds the open/paid boundary and has been given ` +
        "no boundary to hold, so it would pass a payload containing anything at all.",
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new GuardError(`${MANIFEST_RELATIVE} is present but unreadable: ${error.message}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new GuardError(`${MANIFEST_RELATIVE} must be a JSON object.`);
  }
  if (parsed.schemaVersion !== 1) {
    throw new GuardError(`${MANIFEST_RELATIVE}: schemaVersion must be 1, found ${JSON.stringify(parsed.schemaVersion)}.`);
  }
  if (parsed.status !== STATUS_PROPOSED && parsed.status !== STATUS_RATIFIED) {
    throw new GuardError(
      `${MANIFEST_RELATIVE}: status must be ${JSON.stringify(STATUS_PROPOSED)} or ` +
        `${JSON.stringify(STATUS_RATIFIED)}, found ${JSON.stringify(parsed.status)}.`,
    );
  }

  const rules = { excluded: { paths: [], prefixes: [] }, paid: { paths: [], prefixes: [] }, open: { paths: [] } };

  for (const name of CLASSES) {
    const section = parsed[name];
    if (section === undefined) continue;
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      throw new GuardError(`${MANIFEST_RELATIVE}: "${name}" must be an object.`);
    }
    for (const entry of readList(section, "paths", name)) {
      assertUsablePath(entry, `${name}.paths`);
      rules[name].paths.push(entry);
    }
    // PREFIXES ARE ALLOWED ONLY IN THE DIRECTION THAT FAILS THE BUILD.
    //
    // A too-broad `paid` or `excluded` prefix over-matches, which stops a build
    // and gets noticed and corrected in minutes. A too-broad `open` prefix
    // under-matches nothing and over-permits everything beneath it -- so the
    // next paid file dropped into that directory would be classified open by a
    // rule written before it existed, and would ship. `open` is therefore exact
    // paths only: every openly-published file is named by a human, once.
    if (name === "open") {
      if (section.prefixes !== undefined) {
        throw new GuardError(
          `${MANIFEST_RELATIVE}: "open" may not use prefixes. An open prefix would classify files ` +
            "that do not exist yet, so a paid module added under it later would ship by silence. " +
            "List open files by exact path.",
        );
      }
      continue;
    }
    for (const entry of readList(section, "prefixes", name)) {
      assertUsablePath(entry, `${name}.prefixes`, { directory: true });
      rules[name].prefixes.push(entry);
    }
  }

  // `pending` is the honest state for "this lane proposes moving it out, the
  // owner has not ruled, and it is still in the payload today". It reports
  // loudly on every build and does not fail. Without it, a proposal could only
  // be expressed by failing the build over a decision nobody has made yet --
  // and a gate that is red before anyone has done anything wrong is a gate that
  // gets commented out in week one.
  const pending = new Map();
  if (parsed.pending !== undefined) {
    if (!parsed.pending || typeof parsed.pending !== "object" || Array.isArray(parsed.pending)) {
      throw new GuardError(`${MANIFEST_RELATIVE}: "pending" must be an object of path -> reason.`);
    }
    for (const [entry, reason] of Object.entries(parsed.pending)) {
      assertUsablePath(entry, "pending");
      if (typeof reason !== "string" || !reason.trim()) {
        throw new GuardError(
          `${MANIFEST_RELATIVE}: pending entry ${JSON.stringify(entry)} has no reason. ` +
            "A pending item without a stated reason is an unexplained exception, which is how a " +
            "temporary list becomes permanent.",
        );
      }
      pending.set(entry, reason.trim());
    }
  }

  // RATIFICATION MUST FORCE A DECISION ON EVERY PENDING ITEM.
  //
  // "The owner has decided" and "these items are undecided" cannot both be
  // true. Making that contradiction a hard error is the mechanism that turns
  // his decision into enforcement: flipping status to owner-ratified is
  // impossible until every pending path has been moved into open, paid or
  // excluded. Nothing can be ratified by being overlooked.
  if (parsed.status === STATUS_RATIFIED && pending.size > 0) {
    throw new GuardError(
      `${MANIFEST_RELATIVE}: status is ${JSON.stringify(STATUS_RATIFIED)} but ${pending.size} path(s) ` +
        `are still "pending": ${[...pending.keys()].join(", ")}. A ratified boundary cannot contain ` +
        "undecided items. Move each into open, paid or excluded.",
    );
  }

  // A path in two classes is an ambiguous decision in the one file whose whole
  // job is to be unambiguous. Precedence would resolve it safely, but silently,
  // and a boundary that is silently resolved is a boundary nobody can read.
  const owner = new Map();
  const claim = (entry, label) => {
    const previous = owner.get(entry);
    if (previous && previous !== label) {
      throw new GuardError(
        `${MANIFEST_RELATIVE}: ${JSON.stringify(entry)} is declared in both "${previous}" and "${label}". ` +
          "One path, one class.",
      );
    }
    if (previous === label) {
      throw new GuardError(`${MANIFEST_RELATIVE}: ${JSON.stringify(entry)} is listed twice in "${label}".`);
    }
    owner.set(entry, label);
  };
  for (const name of CLASSES) for (const entry of rules[name].paths) claim(entry, name);
  for (const entry of pending.keys()) claim(entry, "pending");

  return { status: parsed.status, rules, pending };
}

// ---------------------------------------------------------------------------
// Classification.
//
// Precedence is fixed and runs strictest-first: excluded, paid, pending, open.
// A path that is somehow reachable by both a restrictive prefix and an open
// exact path resolves to the restrictive one, so a mistake in the open list can
// never unblock something held back. (The duplicate check above already refuses
// the literal case; this ordering covers a prefix overlapping an exact entry,
// which is legitimate -- excluding a whole directory while a file inside it was
// individually listed open is a real editing state, and it must resolve closed.)
// ---------------------------------------------------------------------------

function classify(relativePath, { rules, pending }) {
  for (const name of ["excluded", "paid"]) {
    const exact = rules[name].paths.find((entry) => entry === relativePath);
    if (exact) return { klass: name, rule: `${name}.paths: ${exact}` };
    const prefix = rules[name].prefixes.find((entry) => relativePath.startsWith(entry));
    if (prefix) return { klass: name, rule: `${name}.prefixes: ${prefix}` };
  }
  if (pending.has(relativePath)) return { klass: "pending", rule: pending.get(relativePath) };
  if (rules.open.paths.includes(relativePath)) return { klass: "open", rule: `open.paths: ${relativePath}` };
  return { klass: "unclassified", rule: null };
}

// ---------------------------------------------------------------------------
// Payload walk.
// ---------------------------------------------------------------------------

async function walk(directory, root, visit) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const entryPath = path.join(directory, entry.name);
    // A symlink in a payload is a file whose real content this guard cannot
    // classify from its name. Refusing is the only fail-closed answer: following
    // it would classify the link path while shipping the target's bytes.
    if (entry.isSymbolicLink()) {
      throw new GuardError(`refusing to classify a symlink in the payload: ${path.relative(root, entryPath)}`);
    }
    if (entry.isDirectory()) await walk(entryPath, root, visit);
    else if (entry.isFile()) visit(path.relative(root, entryPath).split(path.sep).join("/"));
  }
}

async function chooseRoots(requested) {
  if (requested.length > 0) return requested;
  const found = [];
  for (const candidate of DEFAULT_ROOTS) {
    if (!existsSync(candidate)) continue;
    if ((await stat(candidate)).isDirectory()) found.push(candidate);
  }
  if (found.length === 0) {
    throw new GuardError(
      `nothing to check: pass a payload directory, or build one (tried ${DEFAULT_ROOTS.join(", ")}).`,
    );
  }
  return found;
}

function parseArguments(argv) {
  const roots = [];
  let manifest = DEFAULT_MANIFEST;
  let ship = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--manifest") {
      manifest = argv[index + 1];
      if (!manifest) throw new GuardError("--manifest needs a path.");
      index += 1;
      continue;
    }
    if (argv[index] === "--ship") {
      ship = true;
      continue;
    }
    if (argv[index].startsWith("--")) throw new GuardError(`unknown flag ${argv[index]}`);
    roots.push(argv[index]);
  }
  return { roots, manifest: path.resolve(manifest), ship };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const boundary = loadManifest(options.manifest);
  const roots = await chooseRoots(options.roots);

  // Findings are keyed by class and always carry the path. Nothing in this
  // function compares a total against an expectation (rule 3).
  const found = { excluded: [], paid: [], unclassified: [], pending: [], open: [] };
  const matchedRules = new Set();
  let filesSeen = 0;

  for (const root of roots) {
    const resolvedRoot = path.resolve(root);
    let rootStat;
    try {
      rootStat = await lstat(resolvedRoot);
    } catch (error) {
      if (error?.code === "ENOENT") throw new GuardError(`nothing to check: directory does not exist: ${root}`);
      throw error;
    }
    if (rootStat.isSymbolicLink()) throw new GuardError(`nothing to check: refusing to follow symlink: ${root}`);
    if (!rootStat.isDirectory()) throw new GuardError(`nothing to check: not a directory: ${root}`);

    await walk(resolvedRoot, resolvedRoot, (relativePath) => {
      filesSeen += 1;
      const verdict = classify(relativePath, boundary);
      if (verdict.rule) matchedRules.add(verdict.rule);
      found[verdict.klass].push({ root, path: relativePath, rule: verdict.rule });
    });
  }

  // Scanning nothing is an error, not a pass. Same rule as the owner-data
  // guard: a clean report produced by looking at zero files is the most
  // dangerous output this program could print.
  if (filesSeen === 0) {
    throw new GuardError(`nothing to check: scanned 0 files under ${roots.join(", ")}`);
  }

  console.log(`Payload boundary: ${MANIFEST_RELATIVE} (status: ${boundary.status})`);
  console.log(`Roots checked: ${roots.join(", ")}`);
  console.log(
    `Files seen: ${filesSeen} (informational -- this guard asserts on named paths, never on a count).`,
  );
  // COUNT DISTINCT PATHS, NOT FINDINGS.
  //
  // By default two roots are scanned -- the staged payload and the copy already
  // inside release/win-unpacked -- so every finding is counted once per root and
  // the raw totals come out doubled. Six files reported as twelve is not a
  // rounding annoyance: a reader who goes to config/payload-boundary.json to see
  // the twelve finds six, and a gate whose number disagrees with the file it
  // reads is a gate people learn to argue with. Worse, the --ship refusal below
  // already deduplicates, so the same run printed "pending=12" and "NOT
  // PUBLISHABLE -- 6 file(s)" a few lines apart and contradicted itself.
  //
  // Both roots are still scanned and every finding is still reported below with
  // its own root; only the headline totals are per-path. The root count is
  // printed alongside so the difference is visible rather than surprising.
  const distinct = (klass) => new Set(found[klass].map((item) => item.path)).size;
  console.log(
    `Classified (distinct paths across ${roots.length} root(s)): ` +
      `open=${distinct("open")} pending=${distinct("pending")} ` +
      `paid=${distinct("paid")} excluded=${distinct("excluded")} unclassified=${distinct("unclassified")}`,
  );

  if (boundary.status === STATUS_PROPOSED) {
    console.log(
      "\nNOTE: this boundary is a PROPOSAL and has not been ratified by the owner. It is enforced as " +
        `written; "pending" items below are still shipping. Set status to ${JSON.stringify(STATUS_RATIFIED)} ` +
        "once the owner has ruled -- which is refused while anything is still pending.",
    );
  }

  if (found.pending.length > 0) {
    console.log(`\n${found.pending.length} file(s) PROPOSED for removal, still in the payload (not a failure):`);
    for (const item of found.pending) console.log(`  ${item.path}  --  ${item.rule}`);
  }

  const violations = [...found.excluded, ...found.paid, ...found.unclassified];
  const pendingPaths = new Set(found.pending.map((item) => item.path));

  // WHY THERE ARE TWO VERDICTS, AND WHY BOTH ALWAYS PRINT.
  //
  // The default verdict deliberately tolerates `pending`, and that is correct.
  // pending means "a lane proposes removing this, the owner has ruled, and it
  // still ships today". Failing every build until that work lands would make this
  // guard an obstacle to ordinary development, and a guard that blocks every build
  // gets switched off. So a dev build stays green while the report says plainly,
  // in prose, that pending items are still shipping.
  //
  // But prose is not what a build chain consumes -- it consumes the exit code.
  // Three separate lanes read "exit 0" as "safe to publish" while the commercial
  // tier table with real prices sat in the payload, because the honest sentence
  // and the exit code disagreed and only one of the two is machine-readable. That
  // is the same defect as a permissive destructured default: the absence of a
  // complaint read as consent. --ship closes it without breaking development.
  //
  // ORDER IS LOAD-BEARING, and this is the second version. The first returned
  // early on pending, which silently suppressed the violation report: a --ship run
  // with an unclassified file present exited 1 and never named that file. Right
  // exit code, wrong reason, and the operator would have gone hunting for a
  // pending file that was not the problem. A mutation -- planting an unclassified
  // file and checking that --ship still NAMES it -- is what caught that, and it is
  // why the counts below are deduplicated by path too: the default roots include
  // both the staged payload and the copy already in release/win-unpacked, so a raw
  // finding count says "12 files" where the manifest names 6, and a gate whose
  // number disagrees with the file it reads is one people learn to argue with.
  const shipRefusal = options.ship && pendingPaths.size > 0;

  if (violations.length === 0 && !shipRefusal) {
    console.log("\nPayload boundary: clean. Nothing paid, excluded or unclassified is present.");
    return;
  }

  if (violations.length > 0) {
    console.error(`\nPAYLOAD BOUNDARY VIOLATION -- ${violations.length} file(s). This build must not ship.`);

    for (const [label, heading] of [
      ["excluded", "MUST NOT SHIP AT ALL (excluded)"],
      ["paid", "PAID -- not for public release (paid)"],
      [
        "unclassified",
        "UNCLASSIFIED -- present in the payload and named nowhere in the boundary manifest. " +
          "This is a failure by design: an unknown file is not assumed open",
      ],
    ]) {
      if (found[label].length === 0) continue;
      console.error(`\n${heading}:`);
      for (const item of found[label]) {
        console.error(`  ${item.path}${item.rule ? `   [${item.rule}]` : ""}`);
      }
    }

    console.error(
      `\nFix by either removing these files from the payload, or -- if a file is genuinely open -- ` +
        `adding its exact path to "open".paths in ${MANIFEST_RELATIVE}. Do not add a prefix; do not ` +
        "widen a rule to make a red build green without reading what the file is.",
    );
  }

  if (shipRefusal) {
    console.error(
      `\nNOT PUBLISHABLE -- ${pendingPaths.size} file(s) are still "pending" and still ship:`,
    );
    for (const entry of [...pendingPaths].sort()) console.error(`  ${entry}`);
    console.error(
      '\n--ship requires pending=0. Without --ship, exit 0 means "nothing unclassified, paid or ' +
        'excluded is present" -- it has never meant "safe to publish", and the files above are ' +
        'precisely what that difference is about.',
    );
  }

  process.exitCode = 1;
}

main().catch((error) => {
  if (error instanceof GuardError) {
    console.error(`Payload boundary guard error: ${error.message}`);
    process.exitCode = 2;
    return;
  }
  console.error(`Payload boundary guard error: ${error.stack || error.message}`);
  process.exitCode = 2;
});
