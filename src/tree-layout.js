const ROLE_RADII = Object.freeze({
  coordinator: 62,
  helper: 52,
  shadow: 52,
  manager: 47,
  default: 39,
  spawned: 39,
})

const HIERARCHY_EDGE_TYPES = new Set(['manages', 'delegates_to', 'hierarchy'])
/* The last rung was [12, -6]: literal minus-six pixels of air, overlap by
   sanction. It existed because a jammed rank had nowhere else to go — but the
   tierRank fix in views/computers.js spreads a deep tree across its true
   ranks, so the pressure that rung relieved is gone, and the ladder now ends
   at the smallest HONEST air instead. No rung may ever be negative again:
   below MIN_AIR the answers are culling and drill, which exist. */
const MIN_AIR = 2
const PACKING_LADDER = Object.freeze([
  [44, 10],
  [12, 10],
  [12, MIN_AIR],
])

const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null
const idOf = (node) => String(node?.id ?? node?.agent?.id ?? '')
const roleOf = (node) => String(node?.role ?? node?.agent?.role ?? 'default')
const nameOf = (node) => String(node?.name ?? node?.agent?.name ?? idOf(node))

/* A circle whose only content is emptiness is wasted room: it pushes its
   siblings apart and makes the tree sprawl for nothing. A node with no
   runtime to show carries one short state word instead, so it can be sized
   for that word rather than for a clock it does not have. 34 is the floor
   the packer already treats as "still readable". */
const SILENT_SCALE = 0.72
/* The smallest circle this file will draw, and the height of the name+role
   stack that hangs under every one of them. Both are used by the vertical
   fitter in layoutTree; 34 is the same floor the horizontal packer already
   treats as "still readable", so the two axes agree on what readable means. */
const RADIUS_FLOOR = 34
/* The height of the name+role stack under every circle, as a CORRECTED
   CONSTANT, not a measurement: layoutTree's contract is DOM-free determinism,
   so this number is computed from the stack's own worst case, not read back
   from a rendered page. A name may wrap to two 13px lines (2 × 17px line
   height) plus the role row clamped to ONE line (14px, clamped in
   tree-graph.css precisely so this worst case is computable) plus the 6px gap
   above the stack: 34 + 14 + 6 = 54, padded to 58 for the role bead's
   descender box. The old value, 34, was one wrapped name with no role row at
   all — every two-line label under a tight rank painted into the row below.
   Exported, and written once into CSS as --tree-label-stack, so the sheet and
   the layout cannot drift apart; a guard asserts they match. */
const LABEL_STACK = 58
export const TREE_LABEL_STACK = LABEL_STACK
/* A named circle's horizontal claim is its label's minimum readable width,
   not just its diameter: two 34px circles side by side hold 68px of circle
   and two 70px labels. Packing by radius alone made exactly those labels
   overlap. Unnamed records (empty slots) claim only their circle. */
const LABEL_FOOT_MIN = 70
const halfFoot = (record) => Math.max(record.r, record.name ? LABEL_FOOT_MIN / 2 : 0)
export function treeNodeRadius(node) {
  const explicit = finite(node?.r) ?? finite(node?.radius)
  if (explicit !== null) return Math.max(RADIUS_FLOOR, explicit)
  const base = ROLE_RADII[roleOf(node)] ?? ROLE_RADII.default
  const source = node?.agent ?? node
  const silent = !Number.isFinite(Number(source?.bornAt))
  return Math.max(RADIUS_FLOOR, silent ? Math.round(base * SILENT_SCALE) : base)
}
const radiusOf = treeNodeRadius

export function hierarchyParents(nodes, edges) {
  const ids = new Set(nodes.map(idOf))
  const parents = new Map()

  for (const node of nodes) {
    const id = idOf(node)
    const parentId = node?.parentId ?? node?.agent?.parentId
    if (id && parentId != null && ids.has(String(parentId)) && String(parentId) !== id) {
      parents.set(id, String(parentId))
    }
  }

  const ordered = [...(Array.isArray(edges) ? edges : [])].sort((left, right) => {
    const observed = (edge) => edge?.sourceKind === 'observed' ? 0 : 1
    return observed(left) - observed(right)
      || String(left?.from ?? left?.source ?? '').localeCompare(String(right?.from ?? right?.source ?? ''))
      || String(left?.to ?? left?.target ?? '').localeCompare(String(right?.to ?? right?.target ?? ''))
  })
  for (const edge of ordered) {
    if (edge?.type && !HIERARCHY_EDGE_TYPES.has(edge.type)) continue
    const parentId = String(edge?.from ?? edge?.source ?? '')
    const childId = String(edge?.to ?? edge?.target ?? '')
    if (!ids.has(parentId) || !ids.has(childId) || parentId === childId || parents.has(childId)) continue

    let current = parentId
    const seen = new Set([childId])
    let cyclic = false
    while (current && !seen.has(current)) {
      seen.add(current)
      current = parents.get(current)
    }
    if (current && seen.has(current)) cyclic = true
    if (!cyclic) parents.set(childId, parentId)
  }
  return parents
}

function depthFor(id, record, parents) {
  if (record.tierRank !== null) return Math.max(0, Math.round(record.tierRank))
  let depth = 0
  let current = id
  const seen = new Set([id])
  while (parents.has(current) && depth < 12) {
    current = parents.get(current)
    if (seen.has(current)) break
    seen.add(current)
    depth += 1
  }
  return depth
}

function packedXs(list, width) {
  if (!list.length) return null
  if (list.length === 1) return [width / 2]

  const step = width / (list.length + 1)
  const naive = list.map((record, index) =>
    Math.max(record.r + 44, Math.min(width - record.r - 44, step * (index + 1))))
  const naiveOk = naive.every((x, index) => index === 0
    || x - naive[index - 1] >= halfFoot(list[index - 1]) + halfFoot(list[index]) + MIN_AIR)
  if (naiveOk) return naive

  for (const [edge, air] of PACKING_LADDER) {
    const gaps = list.map((record, index) => index
      ? halfFoot(list[index - 1]) + halfFoot(record) + air
      : 0)
    const span = gaps.reduce((sum, gap) => sum + gap, 0)
    const available = width - edge * 2 - halfFoot(list[0]) - halfFoot(list.at(-1))
    if (span > available) continue
    let x = edge + halfFoot(list[0]) + Math.max(0, (available - span) / 2)
    return list.map((record, index) => (x += gaps[index]))
  }
  return null
}

/* Nesting, made visible without tracing a single edge.
   Spacing a rank evenly makes every node in it look equally related to every
   node above it — the rank reads as a flat row and you cannot see which
   manager owns which lane. Siblings of one parent are packed TIGHT; different
   parents' groups are separated by a gap several times larger, and each group
   is centred under its own parent. The whitespace does the work the edges were
   being asked to do alone.

   TWO THINGS THIS PACKER DID NOT DO. Neither was visible while the canvas was
   frozen at 827px wide; both are what a canvas allowed to use the window turns
   into (see the page-2 column in src/styles.css).

   1. A rank whose nodes all share ONE parent was refused here — `groups.length
      < 2` — and fell through to packedXs, which spreads a rank EVENLY across
      the whole canvas. That is the exact failure the paragraph above was
      written to prevent, left in place for the commonest shape there is: one
      coordinator with four managers under it. On a 1260px canvas those four
      stand 252px apart and the rank stops reading as one family. One group is
      still a group; it is packed and centred under its parent like any other.
   2. The air between siblings was a constant, so a rank with room to breathe
      never used it and a wider window bought the reader nothing. The air is
      now the largest value up to AIR_WITHIN_MAX that still fits the rank, and
      the gap BETWEEN groups holds a constant ratio to it, so the "tight
      siblings, wide gap between families" reading survives at every width. */
const AIR_WITHIN = 18
const AIR_WITHIN_MAX = 68
const BETWEEN_RATIO = 3.5
const RANK_EDGE = 24
function packGroupedXs(list, width, anchorOf) {
  if (!list.length) return null
  const groups = []
  for (const record of list) {
    const anchor = anchorOf(record)
    const key = anchor?.key ?? '~orphan'
    const last = groups.at(-1)
    if (last && last.key === key) last.items.push(record)
    else groups.push({ key, items: [record], anchor: anchor?.x ?? null })
  }

  /* Footprints, not diameters: a named record's claim includes its label's
     minimum readable width (halfFoot), so labels are a packing input here the
     same way they are in packedXs. */
  const circleSpan = list.reduce((sum, record) => sum + halfFoot(record) * 2, 0)
  const room = width - RANK_EDGE * 2 - circleSpan
  if (room < 0) return null
  /* total(air) = circleSpan + air * (n - g) + air * RATIO * (g - 1), so the
     widest air the rank can afford is one division rather than a search. */
  const airUnits = (list.length - groups.length) + BETWEEN_RATIO * (groups.length - 1)
  let air = AIR_WITHIN_MAX
  if (airUnits > 0) {
    air = Math.floor(Math.min(AIR_WITHIN_MAX, room / airUnits))
    if (air < AIR_WITHIN) return null
  }
  const between = Math.floor(air * BETWEEN_RATIO)

  const widthOf = (group) => group.items.reduce((sum, record) => sum + halfFoot(record) * 2, 0)
    + air * (group.items.length - 1)
  const total = groups.reduce((sum, group) => sum + widthOf(group), 0)
    + between * (groups.length - 1)
  if (total > width - RANK_EDGE * 2) return null

  let cursor = RANK_EDGE
  for (const group of groups) {
    const groupWidth = widthOf(group)
    const desired = group.anchor == null ? (width - groupWidth) / 2 : group.anchor - groupWidth / 2
    group.left = Math.max(cursor, desired)
    cursor = group.left + groupWidth + between
  }
  // A group centred under a right-hand parent can push the rank past the edge;
  // pull the whole run back, then re-seat it against the left edge.
  const last = groups.at(-1)
  if (last.left + widthOf(last) > width - RANK_EDGE) {
    let limit = width - RANK_EDGE
    for (let index = groups.length - 1; index >= 0; index -= 1) {
      const group = groups[index]
      group.left = Math.min(group.left, limit - widthOf(group))
      limit = group.left - between
    }
    let floor = RANK_EDGE
    for (const group of groups) {
      group.left = Math.max(group.left, floor)
      floor = group.left + widthOf(group) + between
    }
  }

  const xs = []
  for (const group of groups) {
    let x = group.left
    for (const record of group.items) {
      xs.push(x + halfFoot(record))
      x += halfFoot(record) * 2 + air
    }
  }
  return xs.at(-1) + list.at(-1).r <= width - 4 ? xs : null
}

function keepReadable(list, width) {
  const priority = [...list].sort((left, right) =>
    Number(left.cullable) - Number(right.cullable)
    || left.cullRank - right.cullRank
    || left.name.localeCompare(right.name)
    || left.id.localeCompare(right.id))
  const keep = []
  for (const record of priority) {
    const candidate = [...keep, record]
    if (packedXs(candidate, width) || keep.length === 0) keep.push(record)
  }
  return new Set(keep.map(record => record.id))
}

/* Middle-truncation destroys the word — "assi…ant", "reco…ile" — and the
   owner asked for readable context, so it is gone. The budget is two wrapped
   lines instead of one clipped line; if a name still cannot fit, the id's own
   trailing segment is a real word ("reconcile", "assistant") and reads better
   than any cut; only if THAT overflows do we clip, and then at the END. */
const LABEL_CHAR_PX = 7.6
// The name row carries a 6px role bead and a 5px gap before the first glyph,
// and the row itself is inset — measured, not guessed, from the rendered rows.
const LABEL_CHROME_PX = 26
const LABEL_LINES = 2
function labelFor(record, pitch) {
  const full = record.name
  if (pitch == null) return { maxWidth: null, text: full, title: full }
  /* Floor 70, not 96: the packers now guarantee every named record at least
     LABEL_FOOT_MIN of footprint, so 70 is a width the rank actually HAS. The
     96 floor promised more room than a tight rank owned, which is how labels
     painted over their neighbours. 70 is also the width the over-capacity
     test has always pinned as the readable minimum. */
  const maxWidth = Math.max(LABEL_FOOT_MIN, Math.round(pitch - 10))
  const perLine = Math.max(6, Math.floor((maxWidth - LABEL_CHROME_PX) / LABEL_CHAR_PX))
  const budget = perLine * LABEL_LINES
  if (full.length <= budget) return { maxWidth, text: full, title: full }

  const segments = record.id.split(/[-_.]/).filter(Boolean)
  let suffix = ''
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const candidate = segments.slice(index).join('-')
    if (candidate.length > budget) break
    suffix = candidate
  }
  if (suffix) return { maxWidth, text: suffix, title: full }

  const tail = segments.at(-1) || full
  const text = tail.length > budget ? `${tail.slice(0, Math.max(3, budget - 1))}…` : tail
  return { maxWidth, text, title: full }
}

/**
 * Deterministic, DOM-free top-down tree layout for ToolsEnabled page 2.
 * The returned maps and sets are new values on every call; input records are
 * never mutated.
 */
export function layoutTree({ nodes = [], edges = [], W = 800, H = 600 } = {}) {
  const width = Math.max(160, finite(W) ?? 800)
  const height = Math.max(180, finite(H) ?? 600)
  const records = [...(Array.isArray(nodes) ? nodes : [])]
    .map((node) => ({
      source: node,
      id: idOf(node),
      name: nameOf(node),
      r: radiusOf(node),
      tierRank: finite(node?.tierRank ?? node?.agent?.tierRank),
      cullable: (node?.cullable ?? node?.agent?.cullable) === true,
      cullRank: finite(node?.cullRank ?? node?.agent?.cullRank) ?? 0,
      /* WHERE A NODE SITS AMONG ITS OWN SIBLINGS, when the id is the wrong
         answer. Sibling order in a rank falls back to `id.localeCompare`,
         which is exactly right for agents — it is stable, it is derived from
         data the caller already has, and no agent has a claim to be first.
         It is wrong for a node that is not an agent. The empty "add a child
         here" slot in src/tree-graph.js belongs at the END of the family it
         hangs off — "the next one goes here" is the whole sentence it says —
         and an id-sorted rank drops it wherever its generated id happens to
         fall, usually between two running agents, where it reads as one of
         them rather than as the space after them.
         A number, not a boolean "last", because ordering is the layout's job
         and a caller with two kinds of appendix should be able to say which
         comes first without this file learning what either of them is.
         Absent on every existing caller, so every existing rank keeps the
         id order it has today. */
      orderHint: finite(node?.orderHint ?? node?.agent?.orderHint) ?? 0,
      /* WHICH TREE a parentless record belongs to, for the grouped packer.
         Without it every root keyed '~orphan' and unrelated trees packed as
         one tight cluster — visually a single family that nobody drew (owner
         defect 5's structural half). Optional: absent on fleet records, whose
         single organisation has nothing to separate. */
      treeId: String(node?.treeId ?? node?.agent?.treeId ?? node?.agent?.treeNode?.treeId ?? '') || null,
    }))
    .filter(record => record.id)
  const parents = hierarchyParents(nodes, edges)
  const byId = new Map(records.map(record => [record.id, record]))
  const tiers = new Map()

  for (const record of records) {
    const depth = depthFor(record.id, record, parents)
    if (!tiers.has(depth)) tiers.set(depth, [])
    tiers.get(depth).push(record)
  }

  const tierKeys = [...tiers.keys()].sort((left, right) => left - right)
  const rows = tierKeys.length
  /* The label stack under a circle is a name that may wrap to two lines plus a
     role row that may wrap to two more. 92px of bottom pad let the last tier's
     role row fall off the panel edge; 116 clears the tallest stack. */
  let padTop = 104
  let padBottom = 116
  if (rows > 1) {
    const deficit = 86 * (rows - 1) - (height - padTop - padBottom)
    if (deficit > 0) {
      const topGive = Math.min(40, Math.round(deficit * 0.55))
      padTop -= topGive
      padBottom -= Math.min(22, deficit - topGive)
    }
  }
  const rowHeight = rows > 1 ? (height - padTop - padBottom) / (rows - 1) : 0

  /* THE VERTICAL AXIS HAD NO FITTER.
     Horizontally a rank that will not fit is packed, then culled, then
     drilled — three lines of defence. Vertically the row pitch was simply
     (height - pads) / (rows - 1) and NOTHING compared it against the circles
     it had to carry, so a short canvas drew the tiers straight through each
     other and painted every name under the neighbouring circle. Measured on
     the shipped build at 1024x768: a 339px canvas, three tiers, an 85px pitch
     holding 114px of circle — six overlapping pairs and three names hidden
     behind a bubble.
     The circles shrink TOGETHER, so a coordinator stays visibly larger than a
     lane and the role sizing still reads, down to the same 34px floor the
     packer already calls readable. A canvas too short for the tree gets a
     smaller tree, never a broken one. Below the floor the honest answer is
     more height, which is why the stacked breakpoint in src/styles.css now
     asks for enough of it. */
  /* When even the radius floor cannot make the tiers fit, the honest answer
     is MORE HEIGHT, and layoutTree says how much: minHeight is the canvas
     height at which this same tree lays out without any pair of adjacent
     tiers overlapping. The caller grows or scrolls the wrap (the stacked
     breakpoint in src/styles.css is the precedent). Rank count depends only
     on parentId and edges, never on H, so the value is a fixed point of the
     layout — found by iterating the fitter's own arithmetic below, and
     GUARDED by a test that re-lays at minHeight, because "should converge"
     is a claim, not a property, until it is pinned. */
  let minHeight = null
  if (rows > 1 && rowHeight > 0) {
    const fullRadii = records.map(record => record.r)
    const tallestPair = (radii) => {
      const byTier = tierKeys.map(key =>
        tiers.get(key).reduce((max, record) => Math.max(max, radii.get(record.id)), 0))
      let needed = 0
      for (let index = 0; index + 1 < byTier.length; index += 1) {
        needed = Math.max(needed, byTier[index] + byTier[index + 1] + LABEL_STACK)
      }
      return needed
    }
    const asMap = (values) => new Map(records.map((record, index) => [record.id, values[index]]))
    const scaledRadii = (pitch) => {
      const fullNeeded = tallestPair(asMap(fullRadii))
      const circles = fullNeeded - LABEL_STACK
      const scale = circles > 0 ? Math.max(0, pitch - LABEL_STACK) / circles : 1
      return fullRadii.map(r => scale < 1 ? Math.max(RADIUS_FLOOR, Math.round(r * scale)) : r)
    }

    const needed = tallestPair(asMap(fullRadii))
    if (needed > rowHeight) {
      const shrunk = scaledRadii(rowHeight)
      records.forEach((record, index) => { record.r = shrunk[index] })
      /* Still colliding after the floor bit? Then no scale fits this height;
         iterate the fitter's own arithmetic to the height that does. */
      let residual = tallestPair(asMap(shrunk))
      if (residual > rowHeight) {
        let candidate = residual
        for (let step = 0; step < 6; step += 1) {
          const at = tallestPair(asMap(scaledRadii(candidate)))
          if (at <= candidate) break
          candidate = at
        }
        minHeight = Math.ceil(104 + 116 + (rows - 1) * candidate)
      }
    }
  }

  const slots = new Map()
  const labels = new Map()
  const culled = new Set()
  const rowYs = []
  const rowOf = new Map()
  let drillRequired = false

  tierKeys.forEach((tierKey, rowIndex) => {
    const list = tiers.get(tierKey)
    list.sort((left, right) => {
      const leftParentX = slots.get(parents.get(left.id))?.x ?? width / 2
      const rightParentX = slots.get(parents.get(right.id))?.x ?? width / 2
      return leftParentX - rightParentX
        || left.orderHint - right.orderHint
        || left.id.localeCompare(right.id)
    })
    const y = rows > 1 ? padTop + rowIndex * rowHeight : height / 2
    rowYs.push(y)

    const anchorOf = (record) => {
      const parentId = parents.get(record.id)
      const parentSlot = parentId ? slots.get(parentId) : null
      if (parentSlot) return { key: parentId, x: parentSlot.x }
      /* A parentless record groups with its own TREE, so two trees' roots get
         the wide between-family gap instead of packing shoulder to shoulder
         as one '~orphan' cluster. No anchor x: a root family centres itself. */
      return record.treeId ? { key: `tree:${record.treeId}`, x: null } : null
    }
    let visible = list
    let xs = packGroupedXs(visible, width, anchorOf) || packedXs(visible, width)
    const naiveReadableRadius = list.length ? width / (2 * (list.length + 1)) : Infinity
    if (!xs || naiveReadableRadius < 34) {
      drillRequired = true
      const keep = keepReadable(list, width)
      visible = list.filter(record => keep.has(record.id))
      for (const record of list) if (!keep.has(record.id)) culled.add(record.id)
      xs = packGroupedXs(visible, width, anchorOf) || packedXs(visible, width)
    }

    if (!xs && visible.length) {
      // The widest single record always fits the minimum canvas. This branch
      // is a defensive guarantee for malformed radii or extreme test inputs.
      visible = [visible[0]]
      xs = [width / 2]
      drillRequired = true
      for (const record of list.slice(1)) culled.add(record.id)
    }

    /* Each record's label budget comes from ITS OWN two neighbours, not from
       the rank minimum: one tight pair used to shrink every label in the row,
       including labels standing next to open space. An end record has one
       neighbour; a lone record has none and stays uncapped. */
    const pitchAt = (index) => {
      const left = index > 0 ? xs[index] - xs[index - 1] : null
      const right = index + 1 < xs.length ? xs[index + 1] - xs[index] : null
      if (left == null && right == null) return null
      if (left == null) return right
      if (right == null) return left
      return Math.min(left, right)
    }
    visible.forEach((record, index) => {
      slots.set(record.id, { x: xs[index], y })
      rowOf.set(record.id, rowIndex)
      labels.set(record.id, labelFor(record, pitchAt(index)))
    })
  })

  /* The radius is not a number this file kept to itself: it is the drawn
     diameter, the origin of every leader line and the obstacle the context
     blocks are routed around. If the fitter above changed it, the caller has
     to be told, or the canvas draws full-size circles into slots that were
     packed for smaller ones. */
  const radii = new Map(records.map(record => [record.id, record.r]))
  return { slots, rowYs, rowOf, culled, drillRequired, labels, parents, radii, minHeight }
}

export const TREE_ROLE_RADII = ROLE_RADII
