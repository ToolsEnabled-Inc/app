#!/usr/bin/env node

// AN IDENTIFIER NOTHING IN THE FILE EVER BOUND.
//
// THE DEFECT THIS EXISTS TO END, measured on the packaged build 2026-08-16.
// src/setup-profile-settings.js called `isWriteEnabled(flag.id)` and imported
// only `{ WRITE_ACTION_FLAGS, setWriteEnabled }`. The name was free. Nothing
// stopped it:
//
//   - `vite build` bundled it happily. A bundler resolves MODULES, not names,
//     and a free identifier is legal JavaScript until it runs.
//   - `npm test` never saw it. The suite that owns that file calls markup()
//     and greps the source for `chooseTier`; neither invokes the handler.
//   - there is no lint anywhere in `npm test` or in the `dist` chain.
//
// So the identifier shipped, unminified, in the renderer bundle of every build
// that ever carried that row, and the control it broke wrote the person's
// permission level to disk before throwing. A whole settings section died on
// every press, silently, in the released product.
//
// WHAT IT CHECKS, AND WHAT IT DELIBERATELY DOES NOT. This is not a scope
// analyser and does not try to be one. It collects every name a module BINDS
// anywhere -- import, declaration, parameter, catch, function or class name --
// and every name it REFERENCES, and reports references that are bound nowhere
// in the file and are not a known runtime global. Ignoring scope is the
// conservative direction on purpose: a name bound in some other function of the
// same file is accepted, so shadowing, hoisting and block scope can never
// produce a false accusation. The defect class it does catch is the one that
// actually ships -- a name that exists in this codebase's vocabulary, used in a
// file that never bound it.
//
// A GLOBAL THIS LIST DOES NOT KNOW IS A FAILURE, NOT A PASS. The allowlist
// below is every global the renderer legitimately reaches for, and it was built
// by running this over the whole of src/ until it was quiet. A new one added
// later fails here and gets added deliberately, in a diff, which is the point:
// the alternative is a guard that grows a wildcard the first time it is
// inconvenient and stops guarding anything.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseAst } from 'rollup/parseAst'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..')

/* Every global the renderer may reach for. Standard built-ins first, then the
   browser surface this product actually uses. Nothing product-specific belongs
   here: `mcAgent`, `mcSetup` and their siblings are read through `window.` or
   `globalThis.` in every file that touches them, deliberately, because a bare
   bridge name is indistinguishable from a typo at exactly this distance. */
const KNOWN_GLOBALS = new Set([
  // language built-ins
  'globalThis', 'undefined', 'NaN', 'Infinity',
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt',
  'Function', 'Math', 'JSON', 'Date', 'RegExp', 'Promise', 'Proxy', 'Reflect',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef', 'Intl',
  'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'EvalError', 'URIError', 'AggregateError',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
  'encodeURI', 'decodeURI', 'structuredClone', 'queueMicrotask', 'atob', 'btoa',
  'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array',
  'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array',
  'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'TextEncoder', 'TextDecoder',
  // the window this renderer runs in
  'window', 'document', 'navigator', 'location', 'history', 'screen', 'console',
  'localStorage', 'sessionStorage', 'performance', 'crypto',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback',
  'fetch', 'Headers', 'Request', 'Response', 'AbortController', 'AbortSignal',
  'URL', 'URLSearchParams', 'Blob', 'File', 'FileReader', 'FormData',
  'Event', 'CustomEvent', 'EventTarget', 'MessageChannel', 'MessagePort',
  'MutationObserver', 'IntersectionObserver', 'ResizeObserver',
  'getComputedStyle', 'matchMedia', 'DOMParser', 'XMLHttpRequest', 'WebSocket',
  'Worker', 'Image', 'Audio', 'Option', 'Node', 'Element', 'HTMLElement',
  'HTMLCanvasElement', 'HTMLImageElement', 'HTMLInputElement', 'SVGElement',
  'CanvasRenderingContext2D', 'WebGLRenderingContext', 'WebGL2RenderingContext',
  'ImageData', 'Path2D', 'OffscreenCanvas', 'DOMRect', 'ClipboardItem',
  'ResizeObserverEntry', 'IntersectionObserverEntry', 'DOMMatrix',
  'self', 'postMessage', 'addEventListener', 'removeEventListener', 'dispatchEvent',
  'innerWidth', 'innerHeight', 'devicePixelRatio', 'scrollX', 'scrollY',
  'alert', 'confirm', 'prompt', 'close', 'open', 'scrollTo', 'getSelection',
])

/* Where a name is BOUND, in every form this codebase uses. */
function collectPatternNames(node, into) {
  if (!node || typeof node !== 'object') return
  switch (node.type) {
    case 'Identifier':
      into.add(node.name)
      return
    case 'ObjectPattern':
      for (const property of node.properties || []) {
        if (property.type === 'RestElement') collectPatternNames(property.argument, into)
        else collectPatternNames(property.value, into)
      }
      return
    case 'ArrayPattern':
      for (const element of node.elements || []) collectPatternNames(element, into)
      return
    case 'AssignmentPattern':
      collectPatternNames(node.left, into)
      return
    case 'RestElement':
      collectPatternNames(node.argument, into)
      return
    default:
  }
}

const isFunction = type => type === 'FunctionDeclaration'
  || type === 'FunctionExpression'
  || type === 'ArrowFunctionExpression'

/* One walk, both jobs. `bound` over-collects on purpose (see the header);
   `referenced` under-collects for the same reason -- a property name, a label
   and an export specifier are not references to anything. */
function walk(node, bound, referenced) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const entry of node) walk(entry, bound, referenced)
    return
  }
  if (typeof node.type !== 'string') return

  switch (node.type) {
    case 'ImportDeclaration':
      for (const specifier of node.specifiers || []) bound.add(specifier.local.name)
      return
    case 'ExportNamedDeclaration':
      /* `export { a as b }` names a local, but a module that exports a name it
         never bound is a build error the bundler itself reports. The
         declaration half still has to be walked. */
      walk(node.declaration, bound, referenced)
      return
    case 'ExportAllDeclaration':
      return
    case 'VariableDeclarator':
      collectPatternNames(node.id, bound)
      /* A default inside a pattern is real code and can reference anything. */
      walk(node.id, bound, referenced)
      walk(node.init, bound, referenced)
      return
    case 'ClassDeclaration':
    case 'ClassExpression':
      if (node.id) bound.add(node.id.name)
      walk(node.superClass, bound, referenced)
      walk(node.body, bound, referenced)
      return
    case 'MethodDefinition':
    case 'PropertyDefinition':
      if (node.computed) walk(node.key, bound, referenced)
      walk(node.value, bound, referenced)
      return
    case 'CatchClause':
      collectPatternNames(node.param, bound)
      walk(node.body, bound, referenced)
      return
    case 'Property':
      if (node.computed) walk(node.key, bound, referenced)
      walk(node.value, bound, referenced)
      return
    case 'MemberExpression':
      walk(node.object, bound, referenced)
      if (node.computed) walk(node.property, bound, referenced)
      return
    case 'MetaProperty':
      /* `import.meta` and `new.target` are two Identifier nodes wearing a
         MetaProperty hat; walking into them reports `import` and `meta` as free
         names in every module that reads import.meta.url. */
      return
    case 'LabeledStatement':
      walk(node.body, bound, referenced)
      return
    case 'BreakStatement':
    case 'ContinueStatement':
      return
    case 'Identifier':
      referenced.add(node.name)
      return
    default:
  }

  if (isFunction(node.type)) {
    if (node.id) bound.add(node.id.name)
    for (const param of node.params || []) {
      collectPatternNames(param, bound)
      walk(param, bound, referenced)
    }
    walk(node.body, bound, referenced)
    return
  }

  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') continue
    walk(node[key], bound, referenced)
  }
}

/** Every identifier this source references and never binds. */
export function unboundIdentifiers(source, { globals = KNOWN_GLOBALS } = {}) {
  const ast = parseAst(source)
  const bound = new Set()
  const referenced = new Set()
  walk(ast, bound, referenced)
  return [...referenced].filter(name => !bound.has(name) && !globals.has(name)).sort()
}

function jsFilesUnder(directory) {
  const found = []
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry)
    if (statSync(full).isDirectory()) found.push(...jsFilesUnder(full))
    else if (entry.endsWith('.js')) found.push(full)
  }
  return found
}

/** Every renderer module, checked. Returns the findings; prints nothing. */
export function scanRendererSource(root = REPO_ROOT) {
  const files = jsFilesUnder(path.join(root, 'src'))
  const findings = []
  for (const file of files) {
    const names = unboundIdentifiers(readFileSync(file, 'utf8'))
    for (const name of names) findings.push({ file: path.relative(root, file).replace(/\\/g, '/'), name })
  }
  return { scanned: files.length, findings }
}

/* pathToFileURL, not a hand-built `file://` string: on Windows the argv path is
   `C:\...` and the hand-built comparison is silently false forever, which makes
   this whole file a no-op that exits 0. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { scanned, findings } = scanRendererSource()
  /* "Nothing to check" is a failure here, the same rule
     tools/check-suites-discovered.mjs applies to the test glob. */
  if (scanned === 0) {
    console.error('check-unbound-identifiers: scanned 0 files, so this proved nothing.')
    process.exit(2)
  }
  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(`${finding.file}: "${finding.name}" is used and never bound in this file.`)
    }
    console.error(`\n${findings.length} unbound identifier(s) across ${scanned} renderer modules.`)
    console.error('Each one throws the moment its line runs. Import it, declare it, or add it to KNOWN_GLOBALS if it really is one.')
    process.exit(1)
  }
  console.log(`check-unbound-identifiers: ${scanned} renderer modules, no unbound identifiers.`)
}
