import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

import { bumpSemver, computeNextVersion, writePackageVersion } from "../release-packager/lib/version-bump.mjs";
import { measureFile, sameBytes, sha256File } from "../release-packager/lib/hash.mjs";
import { findOtherCandidates } from "../release-packager/lib/scan-artifacts.mjs";
import { assertStagingFree, classifyStagedCandidate } from "../release-packager/lib/staging-collision.mjs";
import { currentBranch, isAncestor, revParse } from "../release-packager/lib/git.mjs";
import { renderDeclaration } from "../release-packager/generate-declaration.mjs";
import { copyPrivateInputs, parseKnownFixArg } from "../release-packager/cut-release-candidate.mjs";

// --- version-bump.mjs -------------------------------------------------------

test("bumpSemver bumps exactly one component and zeroes the ones below it", () => {
  assert.equal(bumpSemver("1.0.1", "patch"), "1.0.2");
  assert.equal(bumpSemver("1.0.1", "minor"), "1.1.0");
  assert.equal(bumpSemver("1.0.1", "major"), "2.0.0");
});

test("bumpSemver rejects a non-semver string rather than guessing", () => {
  assert.throws(() => bumpSemver("1.0", "patch"));
  assert.throws(() => bumpSemver("v1.0.1", "patch"));
});

test("computeNextVersion defaults to a patch bump and never silently repeats the current version", () => {
  assert.equal(computeNextVersion({ currentVersion: "1.0.1" }), "1.0.2");
  assert.throws(
    () => computeNextVersion({ currentVersion: "1.0.1", explicitVersion: "1.0.1" }),
    /identical to the current version/,
  );
});

test("computeNextVersion allows the same version only with the explicit override", () => {
  assert.equal(
    computeNextVersion({ currentVersion: "1.0.1", explicitVersion: "1.0.1", allowSameVersion: true }),
    "1.0.1",
  );
});

test("computeNextVersion honours an explicit version over --bump", () => {
  assert.equal(computeNextVersion({ currentVersion: "1.0.1", explicitVersion: "2.5.0", bump: "patch" }), "2.5.0");
});

test("writePackageVersion changes only the version field and preserves formatting", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "release-packager-test-"));
  try {
    const pkgPath = path.join(home, "package.json");
    const original = '{\n  "name": "fixture",\n  "version": "1.0.1",\n  "private": true\n}\n';
    await writeFile(pkgPath, original, "utf8");

    const result = await writePackageVersion(pkgPath, "1.0.2");
    assert.equal(result.previousVersion, "1.0.1");
    assert.equal(result.newVersion, "1.0.2");

    const { readFile } = await import("node:fs/promises");
    const rewritten = await readFile(pkgPath, "utf8");
    assert.match(rewritten, /"version": "1\.0\.2"/);
    assert.match(rewritten, /"name": "fixture"/);
    assert.ok(rewritten.endsWith("\n"), "trailing newline preserved");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

// --- hash.mjs ----------------------------------------------------------------

test("sha256File/measureFile/sameBytes agree with each other and detect a changed byte", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "release-packager-test-"));
  try {
    const fileA = path.join(home, "a.bin");
    const fileB = path.join(home, "b.bin");
    await writeFile(fileA, Buffer.from("identical content"));
    await writeFile(fileB, Buffer.from("identical content"));

    const measuredA = await measureFile(fileA);
    const measuredB = await measureFile(fileB);
    assert.equal(measuredA.sha256, await sha256File(fileA));
    assert.ok(sameBytes(measuredA, measuredB), "two files with identical bytes must hash identically");

    await writeFile(fileB, Buffer.from("identical content!"));
    const measuredBChanged = await measureFile(fileB);
    assert.ok(!sameBytes(measuredA, measuredBChanged), "a single changed byte must change the verdict");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

// --- scan-artifacts.mjs -------------------------------------------------------

test("findOtherCandidates finds same-pattern installers one level deep and excludes the declared one", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "release-packager-test-"));
  try {
    const root = path.join(home, "staging-root");
    const versionedSubdir = path.join(root, "1.0.1");
    await mkdir(versionedSubdir, { recursive: true });

    const stray = path.join(root, "ToolsEnabled Setup 1.0.0.exe");
    const nested = path.join(versionedSubdir, "ToolsEnabled Setup 1.0.1.exe");
    const irrelevant = path.join(root, "readme.txt");
    await writeFile(stray, Buffer.from("stray"));
    await writeFile(nested, Buffer.from("this-is-the-declared-one"));
    await writeFile(irrelevant, Buffer.from("not an installer"));

    const found = await findOtherCandidates([root], nested);
    const paths = found.map((f) => f.path).sort();
    assert.deepEqual(paths, [stray].sort());
    assert.ok(!paths.includes(nested), "the declared candidate itself must never appear in its own exclusion list");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("findOtherCandidates tolerates a missing search root instead of throwing", async () => {
  const found = await findOtherCandidates(["C:\\this\\path\\should\\not\\exist\\anywhere"], "C:\\nope.exe");
  assert.deepEqual(found, []);
});

// --- git.mjs (read-only, against this checkout) -------------------------------

test("git.mjs primitives read real state from this checkout without mutating it", () => {
  const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
  const head = revParse(repoRoot);
  assert.match(head, /^[0-9a-f]{40}$/);
  assert.equal(typeof currentBranch(repoRoot), "string");
  // 95a7a14 is an ancestor of every commit on installer/nsis as of this
  // tool's authoring; if that ever stops being true it means history was
  // rewritten, which is itself worth this test failing loudly over.
  assert.ok(isAncestor(repoRoot, "95a7a14176f297ac04212eee0cb1f3c652d8e27c", head));
});

// --- generate-declaration.mjs --------------------------------------------------

function baseFacts(overrides = {}) {
  return {
    test: false,
    date: "2026-08-10",
    version: "1.0.2",
    previousVersion: "1.0.1",
    repo: "C:\\fixture\\repo",
    branch: "installer/nsis",
    sourceRef: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    buildRef: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    branchAdvanced: false,
    candidate: { filename: "ToolsEnabled Setup 1.0.2.exe", bytes: 123456789, sha256: "DEADBEEF" },
    treeState: { worktreePath: "C:\\fixture\\wt", worktreeRemoved: true, buildInfoConfirmedClean: true },
    versionInfo: {
      companyName: "ToolsEnabled, Inc.",
      productName: "ToolsEnabled",
      fileVersion: "1.0.2",
      productVersion: "1.0.2",
      legalCopyright: "Copyright \u00A9 2026 ToolsEnabled",
    },
    appId: { configured: "com.toolsenabled.desktop" },
    unsigned: { signExecutable: false },
    pipeline: { verifySummary: null, checkNoOwnerData: null, smokePackagedLine: null, distExitCode: 0 },
    excludedWip: { sourceWorktree: "C:\\fixture\\repo", measuredAt: "2026-08-10T00:00:00.000Z", dirtyFiles: [] },
    otherCandidates: [],
    stagingDir: "C:\\fixture\\staging\\1.0.2",
    privateInputsCopied: [],
    ...overrides,
  };
}

test("renderDeclaration includes every field the acceptance matrix names, measured not assumed", () => {
  const markdown = renderDeclaration(baseFacts());
  assert.match(markdown, /ToolsEnabled Setup 1\.0\.2\.exe/);
  assert.match(markdown, /123,456,789/);
  assert.match(markdown, /DEADBEEF/);
  assert.match(markdown, /bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/);
  assert.match(markdown, /ToolsEnabled, Inc\./);
  assert.match(markdown, /com\.toolsenabled\.desktop/);
  assert.match(markdown, /certifies the configured value only/);
});

test("renderDeclaration marks a --test run unmistakably and never claims it is a real candidate", () => {
  const markdown = renderDeclaration(baseFacts({ test: true }));
  assert.match(markdown, /NOT A DECLARED CANDIDATE -- DO NOT SEND TO MACHINE B/);
  assert.match(markdown, /TEST ARTIFACT -- not offered as a candidate/);
});

test("renderDeclaration names uncommitted WIP in the source worktree instead of hiding it", () => {
  const markdown = renderDeclaration(
    baseFacts({
      excludedWip: {
        sourceWorktree: "C:\\fixture\\repo",
        measuredAt: "2026-08-10T00:00:00.000Z",
        dirtyFiles: [" M index.html", "?? src/owner-popup.css"],
      },
    }),
  );
  assert.match(markdown, /Another lane's in-progress, uncommitted work/);
  assert.match(markdown, /index\.html/);
  assert.match(markdown, /owner-popup\.css/);
});

test("renderDeclaration lists other same-name installers as explicitly NOT the candidate", () => {
  const markdown = renderDeclaration(
    baseFacts({
      otherCandidates: [
        { path: "C:\\fixture\\release\\ToolsEnabled Setup 1.0.1.exe", bytes: 999, sha256: "CAFEBABE", mtime: "x" },
      ],
    }),
  );
  assert.match(markdown, /ToolsEnabled Setup 1\.0\.1\.exe/);
  assert.match(markdown, /CAFEBABE/);
  assert.match(markdown, /not this candidate; different bytes/);
});

test("renderDeclaration's unsigned caveat tracks the real signExecutable value, not a fixed sentence", () => {
  const unsignedMarkdown = renderDeclaration(baseFacts({ unsigned: { signExecutable: false } }));
  assert.match(unsignedMarkdown, /This build is unsigned/);

  const signedMarkdown = renderDeclaration(baseFacts({ unsigned: { signExecutable: true } }));
  assert.doesNotMatch(signedMarkdown, /This build is unsigned/);
  assert.match(signedMarkdown, /did not independently verify a valid Authenticode signature/);
});

test("renderDeclaration flags it as suspect if require-clean-tree.mjs's own build-info.json did not independently confirm clean", () => {
  const cleanMarkdown = renderDeclaration(baseFacts());
  assert.match(cleanMarkdown, /Confirmed: `dirty: false`, `overridden: false`/);

  const suspectMarkdown = renderDeclaration(
    baseFacts({ treeState: { worktreePath: "C:\\fixture\\wt", worktreeRemoved: true, buildInfoConfirmedClean: false } }),
  );
  assert.match(suspectMarkdown, /DID NOT CONFIRM CLEAN -- this declaration should not have been produced/);
});

test("renderDeclaration says when the branch was NOT advanced, with the exact fast-forward command", () => {
  const markdown = renderDeclaration(baseFacts({ branchAdvanced: false }));
  assert.match(markdown, /was NOT advanced/);
  assert.match(markdown, /git branch -f installer\/nsis bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/);
});

// --- cut-release-candidate.mjs: parseKnownFixArg --------------------------------

test("parseKnownFixArg splits on :: and requires both description and verifiedBy", () => {
  assert.deepEqual(parseKnownFixArg("Fixed the thing::source-only"), {
    description: "Fixed the thing",
    verifiedBy: "source-only",
    evidence: undefined,
  });
  assert.deepEqual(parseKnownFixArg("Fixed the thing::observed::saw it work at http://x::y"), {
    description: "Fixed the thing",
    verifiedBy: "observed",
    evidence: "saw it work at http://x::y",
  });
  assert.throws(() => parseKnownFixArg("only a description"), /description::verifiedBy/);
  assert.throws(() => parseKnownFixArg(""), /requires a value/);
});

// --- cut-release-candidate.mjs: copyPrivateInputs ------------------------------
//
// Regression test for a real bug a first end-to-end test run of the packager
// actually hit: private/ contains a mix of genuinely untracked, per-builder
// files (copy them in) and files that are committed to git with their own
// reviewed content despite living under the same directory (leave them
// alone -- overwriting them with whatever is on the live machine dirties an
// otherwise-clean isolated worktree and silently discards reviewed content).

function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

test("copyPrivateInputs copies untracked private/ files but leaves git-tracked ones as their committed content", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "release-packager-test-"));
  try {
    const repo = path.join(home, "repo");
    const worktree = path.join(home, "worktree");
    await mkdir(path.join(repo, "private"), { recursive: true });

    git(["init", "--initial-branch=main", repo], home);
    git(["config", "user.email", "fixture@example.com"], repo);
    git(["config", "user.name", "Fixture"], repo);

    // Mirror the real repo's .gitignore: a blanket `/private/` rule that
    // does NOT retroactively untrack a file already force-added (below) --
    // this is the exact shape that made the real bug surprising.
    await writeFile(path.join(repo, ".gitignore"), "/private/\n");
    git(["add", "--", ".gitignore"], repo);

    // A file that IS committed to git, mirroring private/research-queue.authored.json.
    await writeFile(path.join(repo, "private", "tracked.json"), '{"committed":true}\n');
    git(["add", "--force", "--", "private/tracked.json"], repo);
    git(["commit", "-m", "add tracked private fixture"], repo);

    // Simulate the worktree: a second checkout of the same commit.
    git(["worktree", "add", "--detach", worktree, "HEAD"], repo);

    // Now the SOURCE repo's live private/ has drifted from what's committed
    // (as it legitimately does day to day), plus a genuinely new, untracked file.
    await writeFile(path.join(repo, "private", "tracked.json"), '{"committed":true,"localDrift":true}\n');
    await writeFile(path.join(repo, "private", "owner-data-patterns.owner.json"), '{"patterns":["fixture-owner"]}\n');

    const result = await copyPrivateInputs(repo, worktree, { log: () => {} });

    assert.deepEqual(result.copied.sort(), ["owner-data-patterns.owner.json"]);
    assert.deepEqual(result.skippedTracked.sort(), ["tracked.json"]);

    const copiedContent = await readFile(path.join(worktree, "private", "owner-data-patterns.owner.json"), "utf8");
    assert.match(copiedContent, /fixture-owner/);

    // The tracked file in the worktree must be untouched -- still its
    // committed content, not the source repo's locally-drifted version.
    const trackedInWorktree = await readFile(path.join(worktree, "private", "tracked.json"), "utf8");
    assert.doesNotMatch(trackedInWorktree, /localDrift/);
    assert.match(trackedInWorktree, /"committed":true/);

    const status = git(["status", "--porcelain"], worktree);
    assert.equal(status.trim(), "", `worktree must remain clean after copyPrivateInputs; git status reported:\n${status}`);
  } finally {
    // Windows worktree metadata can hold a brief file lock right after
    // `git worktree add`; retry the cleanup instead of failing the test on it.
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

// --- serve-candidate.mjs: --detach --------------------------------------------
//
// Regression test for a real bug found during the 1.0.2 transfer: three of
// four server instances launched through an agent session's own background-
// task mechanism (`nohup ... &` and equivalents) died when that mechanism's
// process tree was torn down, even though the launching command itself had
// already returned successfully. `--detach` re-spawns a genuinely OS-detached
// child (`detached: true` + `unref()`) and exits the launcher immediately --
// this test proves the child answers real HTTP requests correctly and that
// the token is never written into the child's redirected log file, which is
// as much of "survives the launcher exiting" as a single test process can
// exercise without spawning a second harness process to simulate the
// original failure mode (verified manually, across genuinely separate tool
// calls, when this fix was built).

const SERVE_CANDIDATE_PATH = fileURLToPath(new URL("../release-packager/serve-candidate.mjs", import.meta.url));

function extractServeOutput(stdout) {
  const tokenMatch = /token \(share this[^)]*\):\s*\r?\n\s*([0-9a-f]{64})/.exec(stdout);
  const pidMatch = /detached: PID (\d+)/.exec(stdout);
  return { token: tokenMatch?.[1], pid: pidMatch ? Number(pidMatch[1]) : null };
}

async function killIfAlive(pid) {
  if (!pid) return;
  try {
    process.kill(pid);
  } catch {
    // Already gone -- fine, this is cleanup.
  }
}

test("serve-candidate.mjs --detach survives the launcher exiting, serves correctly, and never logs the token", { timeout: 20_000 }, async () => {
  const home = await mkdtemp(path.join(tmpdir(), "release-packager-test-"));
  const port = 47900 + Math.floor(Math.random() * 500); // avoid colliding with a real transfer or another test run
  let childPid = null;
  try {
    const dummyFile = path.join(home, "dummy-candidate.bin");
    const fileBytes = Buffer.from("regression-test-payload-for-detach-mode");
    await writeFile(dummyFile, fileBytes);
    const logFile = path.join(home, "detach.log");

    // The launcher process: runs to completion and exits, exactly like the
    // real failure mode's launching command did. If --detach only looked
    // like it worked while sharing this test's own process tree, this
    // `spawnSync` (waited on fully, no `detached` on OUR side) still proves
    // nothing survives past it unless the CHILD is genuinely independent.
    const launch = spawnSync(process.execPath, [
      SERVE_CANDIDATE_PATH, dummyFile,
      "--bind", "127.0.0.1", "--port", String(port),
      "--force-bind-any", "--once", "--detach", "--log-file", logFile,
    ], { encoding: "utf8" });

    assert.equal(launch.status, 0, launch.stderr);
    const { token, pid } = extractServeOutput(launch.stdout);
    assert.ok(token, `expected a token in launcher output:\n${launch.stdout}`);
    assert.ok(pid, `expected a detached PID in launcher output:\n${launch.stdout}`);
    childPid = pid;

    // Give the detached child a moment to finish binding (the launcher
    // returning does not guarantee the child's server.listen() callback has
    // already fired).
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Wrong token must fail -- auth is enforced in detached mode too.
    await assert.rejects(
      execFileAsync("curl.exe", ["-sf", "-H", "Authorization: Bearer wrong", `http://127.0.0.1:${port}/candidate`]),
    );

    // Correct token must succeed and return the exact bytes.
    const outFile = path.join(home, "fetched.bin");
    await execFileAsync("curl.exe", [
      "-sf", "-H", `Authorization: Bearer ${token}`, `http://127.0.0.1:${port}/candidate`, "-o", outFile,
    ]);
    const fetched = await readFile(outFile);
    assert.deepEqual(fetched, fileBytes);

    // --once must have shut the detached child down after that success.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await assert.rejects(execFileAsync("curl.exe", ["-sf", "--max-time", "2", `http://127.0.0.1:${port}/candidate`]));

    // The one property this whole design exists to guarantee: the token
    // must never appear in the child's redirected log file.
    const logContent = await readFile(logFile, "utf8");
    assert.doesNotMatch(logContent, new RegExp(token), "the token must never be written to the detached child's log file");
  } finally {
    await killIfAlive(childPid);
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

// --- staging-collision.mjs --------------------------------------------------
//
// The other half of version-bump.mjs's rule. computeNextVersion() compares the
// new number against package.json's, and package.json does not advance unless
// --advance-branch was used -- so two cuts from two DIFFERENT tips compute the
// same "next" version, and the second one used to copy straight over the first
// one's installer AND its declaration. Measured for real on 2026-08-12 (R1531
// w1): 1.0.7 staged from e521606, the next cut from f8be6ed computed 1.0.7.

test("an empty or missing staging slot is free", () => {
  assert.equal(classifyStagedCandidate({ entries: [], version: "1.0.7", sourceRef: "aaa" }).free, true);
  assert.equal(classifyStagedCandidate({ entries: undefined, version: "1.0.7", sourceRef: "aaa" }).free, true);
});

test("files that are not candidate artifacts do not occupy the slot", () => {
  const verdict = classifyStagedCandidate({
    entries: ["README.md", "notes.txt", ".gitkeep"],
    version: "1.0.7",
    sourceRef: "aaa",
  });
  assert.equal(verdict.free, true);
  assert.deepEqual(verdict.occupants, []);
});

test("a candidate already staged from a DIFFERENT source ref refuses, and names both refs", () => {
  const verdict = classifyStagedCandidate({
    entries: ["ToolsEnabled Setup 1.0.7.exe", "DECLARATION.md", "declaration-facts.json"],
    factsRaw: JSON.stringify({ version: "1.0.7", sourceRef: "e521606b9033f9025a7986f7e5669e665d6217d3" }),
    version: "1.0.7",
    sourceRef: "f8be6ed720ab14746ea539eb366cda310074d68b",
  });
  assert.equal(verdict.free, false);
  assert.match(verdict.reason, /DIFFERENT source ref/);
  assert.match(verdict.reason, /e521606b9033f9025a7986f7e5669e665d6217d3/);
  assert.match(verdict.reason, /f8be6ed720ab14746ea539eb366cda310074d68b/);
  assert.match(verdict.reason, /--version|--staging|--replace-staged/);
});

// ABSENCE IS NEVER CONSENT: these three are the whole point of the guard.
test("an installer with NO declaration-facts.json refuses -- unreadable provenance is a stronger reason, not a weaker one", () => {
  const verdict = classifyStagedCandidate({
    entries: ["ToolsEnabled Setup 1.0.7.exe"],
    factsRaw: null,
    version: "1.0.7",
    sourceRef: "f8be6ed",
  });
  assert.equal(verdict.free, false);
  assert.match(verdict.reason, /no declaration-facts\.json/);
});

test("a BLANK sourceRef in the staged facts never reads as a match", () => {
  const verdict = classifyStagedCandidate({
    entries: ["DECLARATION.md", "declaration-facts.json"],
    factsRaw: JSON.stringify({ version: "1.0.7", sourceRef: "   " }),
    version: "1.0.7",
    sourceRef: "f8be6ed",
  });
  assert.equal(verdict.free, false);
  assert.equal(verdict.sameSource, false);
  assert.match(verdict.reason, /records no sourceRef/);
});

test("unparseable staged facts refuse rather than being treated as absent", () => {
  const verdict = classifyStagedCandidate({
    entries: ["declaration-facts.json"],
    factsRaw: "{ not json",
    version: "1.0.7",
    sourceRef: "f8be6ed",
  });
  assert.equal(verdict.free, false);
  assert.match(verdict.reason, /could not be parsed/);
});

test("even the SAME source ref refuses without the explicit override -- a rebuild is still a second binary", () => {
  const verdict = classifyStagedCandidate({
    entries: ["ToolsEnabled Setup 1.0.7.exe", "declaration-facts.json"],
    factsRaw: JSON.stringify({ sourceRef: "f8be6ed" }),
    version: "1.0.7",
    sourceRef: "f8be6ed",
  });
  assert.equal(verdict.free, false);
  assert.equal(verdict.sameSource, true);
  assert.match(verdict.reason, /THE SAME source ref/);
});

test("--replace-staged permits the overwrite and says exactly what it is discarding", () => {
  const verdict = classifyStagedCandidate({
    entries: ["ToolsEnabled Setup 1.0.7.exe", "declaration-facts.json"],
    factsRaw: JSON.stringify({ sourceRef: "e521606" }),
    version: "1.0.7",
    sourceRef: "f8be6ed",
    replaceStaged: true,
  });
  assert.equal(verdict.free, true);
  assert.equal(verdict.replaced, true);
  assert.match(verdict.reason, /overwriting the 1\.0\.7 candidate/);
  assert.match(verdict.reason, /e521606/);
});

test("assertStagingFree throws on an occupied slot on disk and passes on a fresh one", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "release-packager-staging-"));
  try {
    const taken = path.join(home, "1.0.7");
    await mkdir(taken, { recursive: true });
    await writeFile(path.join(taken, "ToolsEnabled Setup 1.0.7.exe"), "not really an installer", "utf8");
    await writeFile(path.join(taken, "declaration-facts.json"), JSON.stringify({ sourceRef: "e521606" }), "utf8");

    assert.throws(
      () => assertStagingFree({ stagingDir: taken, version: "1.0.7", sourceRef: "f8be6ed", log: () => {} }),
      /staging-collision/,
    );

    const fresh = path.join(home, "1.0.8");
    const verdict = assertStagingFree({ stagingDir: fresh, version: "1.0.8", sourceRef: "f8be6ed", log: () => {} });
    assert.equal(verdict.free, true);
  } finally {
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
