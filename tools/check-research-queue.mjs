import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { validateAgainstSchema } from './gen-projection-lib.mjs';

const defaultQueuePath = fileURLToPath(
  new URL('../public/data/research-queue.json', import.meta.url),
);
const schemaPath = fileURLToPath(
  new URL('../public/data/schema/research-queue.schema.json', import.meta.url),
);

function readJson(path, label) {
  let source;
  try {
    source = readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(`${label} is missing or unreadable at ${path}: ${error.message}`);
  }

  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${label} is not valid JSON at ${path}: ${error.message}`);
  }
}

function describeError(error, queue) {
  const match = /^\$\.items\[(\d+)\]/.exec(error);
  if (!match) return `[queue] ${error}`;

  const index = Number(match[1]);
  const id = queue?.items?.[index]?.id;
  const identity = typeof id === 'string' && id.length > 0
    ? `index ${index}, id ${JSON.stringify(id)}`
    : `index ${index}, id unavailable`;
  return `[${identity}] ${error}`;
}

function main() {
  const queuePath = process.argv[2] ?? defaultQueuePath;
  const schema = readJson(schemaPath, 'Research queue schema');
  const queue = readJson(queuePath, 'Research queue');

  if (Array.isArray(queue?.items) && queue.items.length === 0) {
    throw new Error(`Research queue at ${queuePath} contains zero items; refusing to pass.`);
  }

  const errors = validateAgainstSchema(queue, schema, schema, '$');
  if (errors.length > 0) {
    process.stderr.write(
      `Research queue validation failed for ${queuePath}:\n${errors.map(error => `- ${describeError(error, queue)}`).join('\n')}\n`,
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`Research queue valid: validated ${queue.items.length} items from ${queuePath}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`Research queue check failed: ${error.message}\n`);
  process.exitCode = 1;
}
