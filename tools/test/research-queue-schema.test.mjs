import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateAgainstSchema } from '../gen-projection-lib.mjs';

const root = new URL('../../', import.meta.url);
const queueUrl = new URL('public/data/research-queue.json', root);
const schema = JSON.parse(
  readFileSync(new URL('public/data/schema/research-queue.schema.json', root), 'utf8'),
);
const realQueue = JSON.parse(readFileSync(queueUrl, 'utf8'));
const checkerPath = new URL('tools/check-research-queue.mjs', root);

function validFixture() {
  return {
    schemaVersion: 1,
    items: [{
      id: 'fixture-item',
      title: 'Fixture item',
      status: 'queued',
      provenance: 'test',
      observation: 'A test observation.',
      researchQuestion: 'What does the fixture prove?',
    }],
  };
}

function validationErrors(value) {
  return validateAgainstSchema(value, schema, schema, '$');
}

test('the real authored research queue validates against its schema', () => {
  assert.equal(realQueue.items.length > 0, true);
  assert.deepEqual(validationErrors(realQueue), []);
});

test('a malformed item status is rejected with its index', () => {
  const fixture = validFixture();
  fixture.items[0].status = 'unknown';

  assert.match(validationErrors(fixture).join('\n'), /\$\.items\[0\]\.status/);
});

test('missing required item fields are rejected', () => {
  const fixture = validFixture();
  delete fixture.items[0].researchQuestion;

  assert.match(validationErrors(fixture).join('\n'), /\$\.items\[0\]: missing required property researchQuestion/);
});

test('over-length item fields are rejected', () => {
  const fixture = validFixture();
  fixture.items[0].id = 'x'.repeat(121);

  assert.match(validationErrors(fixture).join('\n'), /\$\.items\[0\]\.id: string is too long/);
});

test('wrong schemaVersion is rejected', () => {
  const fixture = validFixture();
  fixture.schemaVersion = 2;

  assert.match(validationErrors(fixture).join('\n'), /\$\.schemaVersion: must equal the declared constant/);
});

test('an extra top-level key is rejected', () => {
  const fixture = { ...validFixture(), unexpected: true };

  assert.match(validationErrors(fixture).join('\n'), /\$: unexpected property unexpected/);
});

test('items must be an array', () => {
  const fixture = { ...validFixture(), items: {} };

  assert.match(validationErrors(fixture).join('\n'), /\$\.items: expected array/);
});

test('zero items are rejected', () => {
  const fixture = { ...validFixture(), items: [] };

  assert.match(validationErrors(fixture).join('\n'), /\$\.items: too few items/);
});

test('the checker rejects a bad fixture and accepts the real queue', (t) => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'research-queue-schema-'));
  t.after(() => rmSync(temporaryDirectory, { recursive: true, force: true }));

  const fixture = validFixture();
  fixture.items[0].status = 'unknown';
  const fixturePath = join(temporaryDirectory, 'bad-queue.json');
  writeFileSync(fixturePath, `${JSON.stringify(fixture)}\n`, 'utf8');

  const badResult = spawnSync(process.execPath, [fileURLToPath(checkerPath), fixturePath], {
    cwd: fileURLToPath(root),
    encoding: 'utf8',
  });
  assert.notEqual(badResult.status, 0);
  assert.match(badResult.stderr, /index 0, id "fixture-item"/);
  assert.match(badResult.stderr, /status: value is not in the declared enum/);

  const realResult = spawnSync(process.execPath, [fileURLToPath(checkerPath), fileURLToPath(queueUrl)], {
    cwd: fileURLToPath(root),
    encoding: 'utf8',
  });
  assert.equal(realResult.status, 0, realResult.stderr);
  assert.match(realResult.stdout, new RegExp(`validated ${realQueue.items.length} items`));
});
