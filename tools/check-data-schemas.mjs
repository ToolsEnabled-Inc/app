import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { validateAgainstSchema } from './gen-projection-lib.mjs'

const defaultDataDirectory = fileURLToPath(new URL('../public/data/', import.meta.url))

async function readJson(path, label) {
  let source
  try {
    source = await readFile(path, 'utf8')
  } catch (error) {
    throw new Error(`${label} is missing or unreadable: ${error.message}`)
  }

  try {
    return JSON.parse(source)
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`)
  }
}

async function main() {
  const dataDirectory = resolve(process.argv[2] ?? defaultDataDirectory)
  let entries
  try {
    entries = await readdir(dataDirectory, { withFileTypes: true })
  } catch (error) {
    throw new Error(`data directory is missing or unreadable at ${dataDirectory}: ${error.message}`)
  }

  const dataFiles = entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => entry.name)
    .sort()

  if (dataFiles.length === 0) {
    process.stdout.write('Discovered 0 JSON data files; validated 0.\n')
    throw new Error(`discovered zero JSON data files in ${dataDirectory}; refusing to pass`)
  }

  const failures = []
  let validated = 0
  for (const fileName of dataFiles) {
    const stem = fileName.slice(0, -'.json'.length)
    const dataPath = join(dataDirectory, fileName)
    const schemaPath = join(dataDirectory, 'schema', `${stem}.schema.json`)
    try {
      const [data, schema] = await Promise.all([
        readJson(dataPath, `data file ${fileName}`),
        readJson(schemaPath, `schema for ${fileName}`),
      ])
      const errors = validateAgainstSchema(data, schema, schema, '$')
      if (errors.length > 0) {
        failures.push(`${fileName}: schema validation failed:\n${errors.slice(0, 12).map(error => `  - ${error}`).join('\n')}`)
        continue
      }
      validated += 1
    } catch (error) {
      failures.push(`${fileName}: ${error.message}`)
    }
  }

  process.stdout.write(`Discovered ${dataFiles.length} JSON data files; validated ${validated}.\n`)
  if (failures.length > 0) {
    process.stderr.write(`Data schema check failed:\n${failures.map(failure => `- ${failure}`).join('\n')}\n`)
    process.exitCode = 1
    return
  }
  process.stdout.write(`Data schema check passed for ${dataDirectory}.\n`)
}

main().catch(error => {
  process.stderr.write(`Data schema check failed: ${error.message}\n`)
  process.exitCode = 1
})
