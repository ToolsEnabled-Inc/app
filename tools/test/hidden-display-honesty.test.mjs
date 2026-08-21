/* THE hidden ATTRIBUTE MUST WIN, EVERYWHERE, OR THE PAGE LIES.
 *
 * `[hidden] { display: none }` is a USER-AGENT rule, and ANY author
 * `display:` declaration on the same element beats it — origin, not
 * specificity. So every class this product both styles with a display value
 * and ships with the `hidden` attribute needs the stylesheet to re-assert
 * `.cls[hidden] { display: none }`, which is already this repository's own
 * stated convention (src/styles.css at .chat-queue-strip and .ctl-btn,
 * src/tree-graph.css at .tree-empty-node — each written after the same bug).
 *
 * THE BUG THIS GATE WAS WRITTEN AFTER, proven on the packaged build
 * (tools/tree-panel-audit-drive.mjs, 2026-08-20, shot 07): the tree rail's
 * Setup box showed "Restart it in the new folder" with no profile change,
 * and an empty "Reports to" menu with a live Save button directly above the
 * sentence explaining there is nowhere to move the agent. Both rows carry
 * `hidden` in their markup; both wear .ctl-row { display: flex }; the
 * re-assert did not exist, so the product contradicted itself in one
 * viewport. Each earlier instance of this bug was fixed one class at a time;
 * this test is the whole-repo ratchet so the next one cannot ship.
 *
 * WHAT IS MEASURED, deliberately narrow so a violation is always real:
 *   set A  every class that any src CSS rule gives a display other than none
 *          (the [hidden] re-assert rules themselves are excluded)
 *   set B  every class on a template element whose tag also carries the
 *          bare `hidden` attribute — the elements the product itself ships
 *          hidden and toggles
 *   rule   every class in A ∩ B must have a `.cls[hidden]` rule whose body
 *          sets display: none
 *
 * Multi-line template tags and elements only ever hidden at runtime are out
 * of this net; the gate is a ratchet, not a completeness proof. It must
 * never report a violation that is not one.
 */

import { strict as assert } from 'node:assert'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

function walk(dir, keep, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, keep, found)
    else if (keep.test(entry.name)) found.push(full)
  }
  return found
}

/* Strip comments first: CSS comments legitimately quote selectors and
   display values while explaining them, and a gate that reads prose as rules
   reports fiction. */
const stripCssComments = text => text.replace(/\/\*[\s\S]*?\*\//g, '')

function cssRules(text) {
  /* Flatten nested blocks (@media) by splitting on braces and pairing each
     declaration block with the selector text immediately before it. */
  const rules = []
  const cleaned = stripCssComments(text)
  const pattern = /([^{}]+)\{([^{}]*)\}/g
  for (let match = pattern.exec(cleaned); match; match = pattern.exec(cleaned)) {
    const selector = match[1].trim()
    if (selector.startsWith('@')) continue
    rules.push({ selector, body: match[2] })
  }
  return rules
}

test('every class both displayed and shipped hidden re-asserts [hidden]', () => {
  const cssFiles = walk(path.join(REPO, 'src'), /\.css$/)
  const jsFiles = walk(path.join(REPO, 'src'), /\.js$/)

  /* A: class -> the rules that give it a non-none display. */
  const displayed = new Map()
  /* Re-asserts seen: class -> true when `.cls[hidden]` sets display none. */
  const reasserted = new Set()
  for (const file of cssFiles) {
    for (const { selector, body } of cssRules(readFileSync(file, 'utf8'))) {
      const display = /(?:^|;|\s)display\s*:\s*([a-z-]+)/.exec(body)
      if (!display) continue
      for (const part of selector.split(',')) {
        for (const cls of part.matchAll(/\.([A-Za-z0-9_-]+)(\[hidden\])?/g)) {
          /* A display rule addressed to a PSEUDO-ELEMENT of the class styles
             the pseudo, not the element — `[hidden]` on the host still
             removes both, so `.run-live::before { display: inline-block }`
             is not a violation. The pseudo lives in the same compound as the
             class, between the class token and the next combinator. */
          const restOfCompound = part.slice(cls.index + cls[0].length).split(/[\s>+~]/, 1)[0]
          if (restOfCompound.includes('::')) continue
          if (cls[2] && display[1] === 'none') reasserted.add(cls[1])
          else if (!part.includes('[hidden]') && display[1] !== 'none') {
            if (!displayed.has(cls[1])) displayed.set(cls[1], [])
            displayed.get(cls[1]).push(`${path.relative(REPO, file)}: ${part.trim().replace(/\s+/g, ' ')} -> ${display[1]}`)
          }
        }
      }
    }
  }

  /* B: classes on template elements shipped with the bare hidden attribute.
     Only single-tag matches — a `<div class="x" hidden>` shape — so every
     hit is an element the product genuinely renders hidden. */
  const shippedHidden = new Map()
  const tagPattern = /<[a-z][a-z0-9-]*\b[^<>]*?\bclass="([^"]+)"[^<>]*?(?<![-\w])hidden(?![-\w=])[^<>]*>/g
  for (const file of jsFiles) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(tagPattern)) {
      for (const cls of match[1].split(/\s+/).filter(Boolean)) {
        if (!shippedHidden.has(cls)) shippedHidden.set(cls, [])
        shippedHidden.get(cls).push(path.relative(REPO, file))
      }
    }
  }

  const violations = []
  for (const [cls, rules] of displayed) {
    if (!shippedHidden.has(cls)) continue
    if (reasserted.has(cls)) continue
    violations.push(
      `.${cls} is shipped with the hidden attribute (${[...new Set(shippedHidden.get(cls))].join(', ')}) ` +
      `but its display rule beats [hidden]: ${rules.join(' | ')} — add \`.${cls}[hidden] { display: none; }\` beside the display rule`,
    )
  }
  assert.deepEqual(violations, [], `\n${violations.join('\n\n')}\n`)
})
