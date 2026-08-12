#!/usr/bin/env node

// Ratchet gate over the discovered test suite.
//
// WHY THIS EXISTS, and why it is not a plain "must be green" gate:
//
// The suite is legitimately red (6 known failures at the time of writing).
// `dist` previously fronted itself with a bare `npm test`, which blocks the
// ship path outright until all six are fixed. The clean-VM install is the
// last unproven link before this product can ship, and a gate that blocks
// the launch-critical path on pre-existing debt gets bypassed or deleted
// within a day. A bypassed gate is worse than no gate, because it still
// reads as protection.
//
// So this ratchets against a committed baseline of failures BY NAME:
//   - a failure NOT in the baseline is a regression         -> block
//   - a baselined failure that now passes is an improvement -> block, and
//     say "lower the baseline", because a ratchet that silently absorbs
//     improvement stops ratcheting inside a month
//   - anything else                                          -> pass
//
// By NAME and not by count, deliberately: a count alone lets a newly broken
// test hide behind a newly fixed one.
//
// It also refuses to report success when it did not actually measure
// anything. `node --test` EXITS 0 WHEN ITS GLOB MATCHES NO FILES (verified:
// `node --test tools/test/*.nosuchpattern.mjs` -> exit 0), so the discovering
// runner can silently become a no-op. tools/check-suites-discovered.mjs is
// the guard for that and it runs as the first half of `npm test`, which is
// why this spawns `npm test` rather than `npm run test:data` -- going
// straight to the runner would skip the guard. The zero-tests check below is
// a second, independent line of defence at the measurement layer, not a
// reimplementation of that guard. Every "measured nothing" path exits 2,
// never 0.

import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const BASELINE_PATH = path.join(HERE, "test-baseline.json");

// THE TREE MUST NOT MOVE UNDER THE MEASUREMENT.
//
// Measured 2026-08-11 (R1526), and it is why this exists: a `--update` run in
// a detached worktree reported 17 failures five minutes after the identical
// command reported 0, and wrote all 17 into the baseline as accepted known
// failures. Nothing had changed in the code. Another process on the machine
// had moved `capability/` out of the tree while the suite was running, so
// seventeen tests died on ENOENT reading a payload that had been there when
// the run started.
//
// That is the worst thing this gate can do. A regression it misses is a bug
// that ships; a baseline it RAISES on environmental noise is a permanent,
// signed-off licence for real failures to hide behind, and it looks exactly
// like a deliberate human decision afterwards.
//
// tools/check-test-inputs.mjs already refuses an incomplete checkout at the
// START of `npm test` -- but a check at the start cannot see a directory
// removed at second sixty. So the inputs are fingerprinted before and after,
// and a reading taken across a change is refused outright rather than ruled
// on. Same doctrine this file already applies to its own disagreeing counts:
// refuse to rule on a reading it cannot trust.
//
// dist/ is on this list even though it is OPTIONAL to the suite, and that is
// the point: its absence is handled by an honest skip, so moving it mid-run
// silently changes the skip count rather than the failure count. Measured in
// the same session -- two sequential runs of an unchanged tree reported 3
// skips and then 2, because something moved dist/ between them. A reading
// whose skip count is not reproducible is not reproducible.
const MEASUREMENT_INPUTS = [
  path.join(REPO_ROOT, "capability"),
  path.join(REPO_ROOT, "dist"),
  path.join(REPO_ROOT, "private", "capability-source.owner.json"),
  path.join(REPO_ROOT, "private", "owner-data-patterns.owner.json"),
  path.join(REPO_ROOT, "tools", "test"),
];

function fingerprintInputs() {
  const fingerprint = {};
  for (const target of MEASUREMENT_INPUTS) {
    const key = path.relative(REPO_ROOT, target).split(path.sep).join("/");
    if (!existsSync(target)) {
      fingerprint[key] = "absent";
      continue;
    }
    try {
      const stats = statSync(target);
      fingerprint[key] = stats.isDirectory()
        ? `dir:${readdirSync(target).length} entries`
        : `file:${stats.size} bytes`;
    } catch (error) {
      fingerprint[key] = `unreadable:${error.code ?? "unknown"}`;
    }
  }
  return fingerprint;
}

function describeFingerprintDrift(before, after) {
  return Object.keys(before)
    .filter((key) => before[key] !== after[key])
    .map((key) => `  ${key}: ${before[key]} -> ${after[key]}`);
}

// Single source of truth for what the suite IS lives in package.json's
// `test` script. This spawns that entry point rather than restating the
// glob, so the runner and the gate can never drift apart -- and so the
// discovery guard wired into `test` runs here too.
const SUITE_COMMAND = "npm test";

const EXIT_PASS = 0;
const EXIT_RATCHET = 1;
const EXIT_BROKEN_MEASUREMENT = 2;

function runSuite() {
  return new Promise((resolve, reject) => {
    // Piped (not a TTY) so `node --test` emits TAP, which is what we parse.
    const child = spawn(SUITE_COMMAND, {
      cwd: REPO_ROOT,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

// TAP escapes "#" as "\#" and "\" as "\\" inside descriptions.
function unescapeTapName(name) {
  return name.replace(/\\(.)/g, "$1");
}

function parseTap(output) {
  const lines = output.split(/\r?\n/);
  const failures = [];
  let totalNotOk = 0;
  let reportedFail = null;
  let reportedTests = null;

  for (const line of lines) {
    // Two different counts, on purpose, because they answer two different
    // questions:
    //
    // - `failures` (by NAME, top-level `not ok` only) is what the baseline
    //   ratchets against. It stays top-level because that is the stable
    //   identity a baseline entry names -- node's test runner marks a
    //   top-level test `not ok` whenever any of ITS subtests fail, so every
    //   nested failure is already represented here through its parent's
    //   name. Counting indented lines into this list would invent baseline
    //   identities for subtests that can be renamed or reordered freely.
    //
    // - `totalNotOk` (ANY indentation) is what the measurement-integrity
    //   check below cross-references against the runner's own `# fail N`
    //   summary. This one WAS wrongly restricted to top-level lines, which
    //   is exactly what let 13 failures hide inside one indented subtest
    //   block (`# fail 18` vs 5 top-level lines) and made this gate abstain
    //   instead of ruling. Verified empirically against that run: `# fail`
    //   counts every `not ok` line, parent and child alike, so this is the
    //   correct total to check equality against -- re-checked every run
    //   below, so if that ever stops holding this gate still refuses to
    //   rule rather than trusting a count it can't reconcile.
    if (/^\s*not ok \d+ - .+$/.test(line)) {
      totalNotOk += 1;
    }
    const failed = /^not ok \d+ - (.*)$/.exec(line);
    if (failed) {
      failures.push(unescapeTapName(failed[1]).trim());
      continue;
    }
    const failSummary = /^# fail (\d+)$/.exec(line);
    if (failSummary) {
      reportedFail = Number(failSummary[1]);
      continue;
    }
    const testsSummary = /^# tests (\d+)$/.exec(line);
    if (testsSummary) reportedTests = Number(testsSummary[1]);
  }

  return { failures, totalNotOk, reportedFail, reportedTests };
}

async function readBaseline() {
  const raw = await readFile(BASELINE_PATH, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.knownFailures)) {
    throw new Error(`${BASELINE_PATH} has no knownFailures array`);
  }
  return parsed;
}

async function writeBaseline(baseline, failures, notesByName) {
  const next = {
    ...baseline,
    knownFailures: failures
      .slice()
      .sort()
      .map((name) => ({ name, note: notesByName.get(name) ?? "" })),
    updated: new Date().toISOString(),
  };
  await writeFile(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

function report(label, names, notesByName) {
  console.log(`\n${label}`);
  for (const name of names) {
    console.log(`  - ${name}`);
    const note = notesByName.get(name);
    if (note) console.log(`      note: ${note}`);
  }
}

async function main() {
  const update = process.argv.includes("--update");

  const baseline = await readBaseline();
  const notesByName = new Map(
    baseline.knownFailures.map((entry) => [entry.name, entry.note ?? ""]),
  );

  console.log(`Test ratchet: running \`${SUITE_COMMAND}\` ...`);
  const inputsBefore = fingerprintInputs();
  const { code, stdout, stderr } = await runSuite();
  const inputsAfter = fingerprintInputs();
  const { failures, totalNotOk, reportedFail, reportedTests } = parseTap(stdout);

  // --- measurement integrity, before any verdict -------------------------

  // The tree first, because everything below is a reading OF the tree. A run
  // whose inputs moved underneath it is not a weaker measurement, it is not a
  // measurement -- and `--update` would carve the resulting noise into the
  // baseline permanently. See MEASUREMENT_INPUTS above for the run this cost.
  const drift = describeFingerprintDrift(inputsBefore, inputsAfter);
  if (drift.length > 0) {
    throw new Error(
      "the tree changed while the suite was running, so this reading is not a " +
        "measurement of the code:\n" +
        `${drift.join("\n")}\n` +
        "Nothing has been ruled on and the baseline has NOT been touched. " +
        "Find out what else is writing to this checkout -- another test run, a " +
        "build, or another session -- and re-measure in a tree only you are using.",
    );
  }

  if (reportedTests === null) {
    const detail = (stderr.trim() || stdout.trim()).slice(-2000);
    if (detail) console.error(`\n--- runner output (tail) ---\n${detail}`);
    throw new Error(
      "could not find a `# tests N` summary in the runner output; the suite " +
        `did not run in the shape this gate reads (child exit ${code}). ` +
        "The runner output printed above says why. Child exit 3 is the " +
        "derived-input gate (tools/check-test-inputs.mjs) refusing an " +
        "incomplete checkout, and exit 1 with no TAP is usually the " +
        "discovery guard (tools/check-suites-discovered.mjs); either way, " +
        "clear that first -- this gate has measured nothing about the code.",
    );
  }
  if (reportedTests === 0) {
    throw new Error(
      "the runner discovered ZERO tests and would have exited 0. " +
        "`node --test` exits 0 when its glob matches nothing, so a green " +
        "reading here means the suite vanished, not that it passed.",
    );
  }
  // Measure the failure count a second way and refuse to rule if the two
  // readings disagree. Cross-checked against totalNotOk (every `not ok`
  // line, any indentation) rather than failures.length (top-level only, the
  // by-name list the ratchet actually uses below) -- see parseTap for why
  // those are deliberately different counts answering different questions.
  if (reportedFail !== null && reportedFail !== totalNotOk) {
    throw new Error(
      `runner disagrees with itself: \`# fail ${reportedFail}\` but ` +
        `${totalNotOk} \`not ok\` line(s) parsed (${failures.length} of them ` +
        "top-level). Refusing to rule on a reading this gate cannot trust.",
    );
  }

  console.log(
    `Ran ${reportedTests} tests: ${reportedTests - failures.length} pass, ` +
      `${failures.length} fail (suite exit ${code}).`,
  );

  // --- the ratchet -------------------------------------------------------

  const expected = new Set(baseline.knownFailures.map((entry) => entry.name));
  const actual = new Set(failures);
  const regressions = [...actual].filter((name) => !expected.has(name)).sort();
  const improvements = [...expected].filter((name) => !actual.has(name)).sort();

  if (update) {
    await writeBaseline(baseline, failures, notesByName);
    console.log(
      `\nBaseline UPDATED: ${failures.length} known failure(s) written to ` +
        `${path.relative(REPO_ROOT, BASELINE_PATH)}.`,
    );
    console.log("Commit that file so the change is visible in review.");
    return EXIT_PASS;
  }

  if (regressions.length === 0 && improvements.length === 0) {
    console.log(
      `\nRatchet OK: all ${failures.length} failure(s) are known, and none ` +
        "were fixed without the baseline coming down.",
    );
    return EXIT_PASS;
  }

  if (regressions.length > 0) {
    report(
      `REGRESSION -- ${regressions.length} failure(s) NOT in the baseline:`,
      regressions,
      notesByName,
    );
    console.log(
      "\nThese are new, and they block the ship path. Fix them; or if you " +
        "are deliberately accepting them, run `node tools/test-ratchet.mjs " +
        "--update` and commit the raised baseline so someone sees you do it.",
    );
  }

  if (improvements.length > 0) {
    report(
      `FIXED -- ${improvements.length} baselined failure(s) now pass:`,
      improvements,
      notesByName,
    );
    console.log(
      "\nGood news, but the baseline must come down or the ratchet stops " +
        "ratcheting. Run `node tools/test-ratchet.mjs --update` and commit " +
        "the lower baseline.",
    );
    console.log(
      "If any of those carry an environment note, it may have flipped " +
        "because the environment changed rather than because anyone fixed " +
        "it. Read the note before lowering.",
    );
  }

  return EXIT_RATCHET;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`\nTest ratchet could not measure the suite: ${error.message}`);
    process.exitCode = EXIT_BROKEN_MEASUREMENT;
  });
