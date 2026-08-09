import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const guardPath = fileURLToPath(new URL("../check-no-owner-data.mjs", import.meta.url));

async function withFixture(run) {
  const fixture = await mkdtemp(path.join(tmpdir(), "no-owner-data-"));
  try {
    await run(fixture);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}

function runGuard(directory) {
  const result = spawnSync(process.execPath, [guardPath, directory], {
    encoding: "utf8",
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

test("fails for a private-network address in JavaScript", async () => {
  await withFixture(async (fixture) => {
    const filename = "network.js";
    await writeFile(path.join(fixture, filename), "const host = '192.168.214.2';");
    const result = runGuard(fixture);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, new RegExp(filename));
    assert.match(result.output, /192\.168\.214\./);
  });
});

test("fails for the owner name in a path-like string", async () => {
  await withFixture(async (fixture) => {
    await writeFile(path.join(fixture, "path.txt"), String.raw`C:\Users\joshp\project`);
    const result = runGuard(fixture);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /joshp/i);
  });
});

test("fails for a Windows users path", async () => {
  await withFixture(async (fixture) => {
    await writeFile(path.join(fixture, "windows-path.txt"), String.raw`C:\Users\someone`);
    const result = runGuard(fixture);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /windows-path\.txt/);
    assert.match(result.output, /C:\\\\Users/);
  });
});

test("recurses into deeply nested directories", async () => {
  await withFixture(async (fixture) => {
    const nested = path.join(fixture, "one", "two", "three");
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(nested, "deep.txt"), "JOSHP");
    const result = runGuard(fixture);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /deep\.txt/);
  });
});

test("scans files without an extension", async () => {
  await withFixture(async (fixture) => {
    await writeFile(path.join(fixture, "artifact"), "192.168.214.99");
    const result = runGuard(fixture);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /artifact/);
  });
});

test("finds a leak in a minified single-line file", async () => {
  await withFixture(async (fixture) => {
    const filename = "bundle.min.js";
    await writeFile(path.join(fixture, filename), `(()=>{const x="${"a".repeat(200)}C:/Users/person${"z".repeat(200)}"})()`);
    const result = runGuard(fixture);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /bundle\.min\.js/);
    assert.match(result.output, /C:\/Users/);
  });
});

test("passes a clean non-empty fixture", async () => {
  await withFixture(async (fixture) => {
    await writeFile(path.join(fixture, "clean.json"), JSON.stringify({ status: "clean" }));
    const result = runGuard(fixture);
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /Scanned 1 files/);
    assert.match(result.output, /Total matches: 0/);
  });
});

test("an explicitly supplied empty directory is not a silent success", async () => {
  await withFixture(async (fixture) => {
    const result = runGuard(fixture);
    assert.notEqual(result.status, 0, result.output);
    assert.match(result.output, /nothing to check/i);
    assert.match(result.output, /scanned 0 files/i);
  });
});
