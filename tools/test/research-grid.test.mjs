import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_RESULT_SCHEMA,
  cellBrief,
  cellLabel,
  gridCellCount,
  gridCells,
  parseAxes,
  parseResultSchema,
  parseRunner,
} from '../../src/research-grid.js'

/* The grid engine: axes × values as data, refusals as sentences, and no
   domain vocabulary anywhere in the machinery. */

test('axes parse into ordered cells, and every refusal is a sentence', () => {
  const parsed = parseAxes({ first: ['a', 'b'], second: ['1', '2', '3'] })
  assert.equal(parsed.ok, true)
  assert.equal(parsed.cellCount, 6)
  const cells = gridCells(parsed.axes)
  assert.equal(cells.length, 6)
  assert.deepEqual(cells[0], { first: 'a', second: '1' })
  assert.deepEqual(cells.at(-1), { first: 'b', second: '3' })
  assert.equal(gridCellCount(parsed.axes), 6)

  assert.match(parseAxes(null).sentence, /object/)
  assert.match(parseAxes({}).sentence, /at least one axis/)
  assert.match(parseAxes({ 'Bad Name': ['x'] }).sentence, /cannot name an axis/)
  assert.match(parseAxes({ a: [] }).sentence, /at least one value/)
  assert.match(parseAxes({ a: ['x', 'x'] }).sentence, /repeats a value/)
  const four = parseAxes({ a: ['1'], b: ['1'], c: ['1'], d: ['1'] })
  assert.match(four.sentence, /at most 3 axes/)
})

test('the reserved axis names are refused with the reason', () => {
  assert.match(parseAxes({ replicate: ['1', '2'] }).sentence, /reserved for the repeat counter/)
  assert.match(parseAxes({ dataset: ['a'] }).sentence, /reserved for the dataset path token/)
  assert.equal(parseAxes({ tier: ['luna'] }).ok, true, 'tier is the reserved-meaning axis and stays legal')
})

test('replicates multiply cells and carry a replicate field', () => {
  const parsed = parseAxes({ a: ['x', 'y'] })
  const cells = gridCells(parsed.axes, { replicates: 3 })
  assert.equal(cells.length, 6)
  assert.deepEqual(cells[0], { a: 'x', replicate: 1 })
  assert.deepEqual(cells.at(-1), { a: 'y', replicate: 3 })
  assert.equal(cellLabel(parsed.axes, cells[0]), 'x · #1')
})

test('the oversized grid is refused by count, not truncated', () => {
  const wide = { a: Array.from({ length: 24 }, (_v, i) => `a${i}`), b: Array.from({ length: 24 }, (_v, i) => `b${i}`) }
  assert.match(parseAxes(wide).sentence, /576 cells/, 'the refusal states the size it measured')
})

test('runner declarations validate per kind', () => {
  assert.equal(parseRunner({ kind: 'agent', briefTemplate: 'Do {a}.' }).ok, true)
  assert.equal(parseRunner({ kind: 'process', command: 'node', args: ['-e', '1'] }).ok, true)
  assert.equal(parseRunner({ kind: 'http', url: 'https://example.test/x' }).ok, true)
  assert.match(parseRunner({ kind: 'http', url: 'http://example.test/x' }).sentence, /https/)
  assert.match(parseRunner({ kind: 'process' }).sentence, /command/)
  assert.match(parseRunner({ kind: 'agent' }).sentence, /brief/)
  assert.match(parseRunner({ kind: 'other' }).sentence, /agent, process, or http/)
})

test('result columns parse shallowly with a frozen default', () => {
  assert.equal(parseResultSchema(undefined).resultSchema, DEFAULT_RESULT_SCHEMA)
  const parsed = parseResultSchema({ fields: { score: 'number', label: 'string' }, required: ['score'] })
  assert.equal(parsed.ok, true)
  assert.deepEqual(parsed.resultSchema.required, ['score'])
  assert.match(parseResultSchema({ fields: { score: 'float' } }).sentence, /string, number, or boolean/)
  assert.match(parseResultSchema({ fields: { score: 'number' }, required: ['missing'] }).sentence, /must be one of the declared fields/)
})

test('a brief substitutes every axis token and refuses an unknown one', () => {
  const built = cellBrief('Run {a} against {b}.', { a: 'x', b: 'y' })
  assert.equal(built.ok, true)
  assert.equal(built.text, 'Run x against y.')
  const missing = cellBrief('Run {c}.', { a: 'x' })
  assert.equal(missing.ok, false)
  assert.match(missing.sentence, /no axis called c/, 'an empty substitution is how a wrong brief runs quietly')
})
