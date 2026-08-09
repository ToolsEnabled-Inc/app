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
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const BASELINE_PATH = path.join(HERE, "test-baseline.json");

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
  let reportedFail = null;
  let reportedTests = null;

  for (const line of lines) {
    // Top-level test points only. Verified against this suite: the count of
    // `^not ok` lines equals the `# fail` summary, so no failure is hiding
    // inside an indented subtest. The equality is re-checked every run
    // below, so if that ever stops holding this gate refuses to rule.
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

  return { failures, reportedFail, reportedTests };
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
  const { code, stdout, stderr } = await runSuite();
  const { failures, reportedFail, reportedTests } = parseTap(stdout);

  // --- measurement integrity, before any verdict -------------------------

  if (reportedTests === null) {
    const detail = (stderr.trim() || stdout.trim()).slice(-2000);
    if (detail) console.error(`\n--- runner output (tail) ---\n${detail}`);
    throw new Error(
      "could not find a `# tests N` summary in the runner output; the suite " +
        `did not run in the shape this gate reads (child exit ${code}). ` +
        "If the discovery guard rejected the run, fix that first.",
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
  // readings disagree.
  if (reportedFail !== null && reportedFail !== failures.length) {
    throw new Error(
      `runner disagrees with itself: \`# fail ${reportedFail}\` but ` +
        `${failures.length} \`not ok\` lines parsed. Refusing to rule on a ` +
        "reading this gate cannot trust.",
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
