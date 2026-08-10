import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { bumpSemver, computeNextVersion, writePackageVersion } from "../release-packager/lib/version-bump.mjs";
import { measureFile, sameBytes, sha256File } from "../release-packager/lib/hash.mjs";
import { findOtherCandidates } from "../release-packager/lib/scan-artifacts.mjs";
import { currentBranch, isAncestor, revParse } from "../release-packager/lib/git.mjs";
import { renderDeclaration } from "../release-packager/generate-declaration.mjs";
import { copyPrivateInputs } from "../release-packager/cut-release-candidate.mjs";

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

    const stray = path.join(root, "Mission Control Setup 1.0.0.exe");
    const nested = path.join(versionedSubdir, "Mission Control Setup 1.0.1.exe");
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
    candidate: { filename: "Mission Control Setup 1.0.2.exe", bytes: 123456789, sha256: "DEADBEEF" },
    treeState: { worktreePath: "C:\\fixture\\wt", worktreeRemoved: true, buildInfoConfirmedClean: true },
    versionInfo: {
      companyName: "ToolsEnabled, Inc.",
      productName: "Mission Control",
      fileVersion: "1.0.2",
      productVersion: "1.0.2",
      legalCopyright: "Copyright \u00A9 2026 Mission Control",
    },
    appId: { configured: "com.toolsenabled.missioncontrol" },
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
  assert.match(markdown, /Mission Control Setup 1\.0\.2\.exe/);
  assert.match(markdown, /123,456,789/);
  assert.match(markdown, /DEADBEEF/);
  assert.match(markdown, /bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/);
  assert.match(markdown, /ToolsEnabled, Inc\./);
  assert.match(markdown, /com\.toolsenabled\.missioncontrol/);
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
        { path: "C:\\fixture\\release\\Mission Control Setup 1.0.1.exe", bytes: 999, sha256: "CAFEBABE", mtime: "x" },
      ],
    }),
  );
  assert.match(markdown, /Mission Control Setup 1\.0\.1\.exe/);
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
