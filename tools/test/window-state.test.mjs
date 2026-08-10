import assert from 'node:assert/strict'
import test from 'node:test'

import windowState from '../../shell/window-state.cjs'

const { restoredWindowState, shellStateRecord } = windowState
const primary = { x: 0, y: 0, width: 1920, height: 1040 }

test('non-object and malformed shell state falls back to a visible default', () => {
  for (const value of [null, undefined, true, 7, 'tan', []]) {
    assert.deepEqual(shellStateRecord(value), {})
    assert.deepEqual(restoredWindowState(value, [primary]), {
      theme: 'white',
      maximized: false,
      bounds: {
        x: 240,
        y: 70,
        width: 1440,
        height: 900,
        minWidth: 980,
        minHeight: 640,
      },
    })
  }
})

test('valid Tan state and visible bounds are preserved', () => {
  assert.deepEqual(restoredWindowState({
    theme: 'tan',
    maximized: true,
    x: 120,
    y: 80,
    width: 1280,
    height: 760,
  }, [primary]), {
    theme: 'tan',
    maximized: true,
    bounds: {
      x: 120,
      y: 80,
      width: 1280,
      height: 760,
      minWidth: 980,
      minHeight: 640,
    },
  })
})

test('invalid fields never reach BrowserWindow options', () => {
  const restored = restoredWindowState({
    theme: 'constructor',
    maximized: 'true',
    x: Number.MAX_SAFE_INTEGER,
    y: NaN,
    width: '1440',
    height: -1,
  }, [primary])

  assert.equal(restored.theme, 'white')
  assert.equal(restored.maximized, false)
  assert.deepEqual(restored.bounds, {
    x: 240,
    y: 70,
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 640,
  })
  for (const value of Object.values(restored.bounds)) assert.equal(Number.isInteger(value), true)
})

test('bounds from a removed display are centered on the current primary display', () => {
  const restored = restoredWindowState({
    theme: 'black',
    x: -2200,
    y: 100,
    width: 1600,
    height: 900,
  }, [primary])

  assert.equal(restored.theme, 'black')
  assert.deepEqual(restored.bounds, {
    x: 160,
    y: 70,
    width: 1600,
    height: 900,
    minWidth: 980,
    minHeight: 640,
  })
})

test('a low-resolution display produces internally consistent dimensions', () => {
  const restored = restoredWindowState({
    x: 0,
    y: 0,
    width: 1440,
    height: 900,
  }, [{ x: 0, y: 0, width: 800, height: 600 }])

  assert.deepEqual(restored.bounds, {
    x: 0,
    y: 0,
    width: 800,
    height: 600,
    minWidth: 800,
    minHeight: 600,
  })
})

test('visible bounds on a secondary display remain on that display', () => {
  const secondary = { x: -1600, y: 0, width: 1600, height: 900 }
  const restored = restoredWindowState({
    theme: 'tan',
    x: -1500,
    y: 50,
    width: 1200,
    height: 700,
  }, [primary, secondary])

  assert.deepEqual(restored.bounds, {
    x: -1500,
    y: 50,
    width: 1200,
    height: 700,
    minWidth: 980,
    minHeight: 640,
  })
})

test('shrinking an oversized restored window cannot move its final bounds off-screen', () => {
  const secondary = { x: -800, y: 0, width: 800, height: 600 }
  const restored = restoredWindowState({
    x: -1550,
    y: 0,
    width: 1600,
    height: 600,
  }, [primary, secondary])

  assert.deepEqual(restored.bounds, {
    x: -800,
    y: 0,
    width: 800,
    height: 600,
    minWidth: 800,
    minHeight: 600,
  })
})
