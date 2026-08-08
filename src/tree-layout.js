const ROLE_RADII = Object.freeze({
  coordinator: 62,
  helper: 52,
  shadow: 52,
  manager: 47,
  default: 39,
  spawned: 39,
})

const HIERARCHY_EDGE_TYPES = new Set(['manages', 'delegates_to', 'hierarchy'])
const PACKING_LADDER = Object.freeze([
  [44, 10],
  [12, 10],
  [12, 0],
  [12, -6],
])

const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null
const idOf = (node) => String(node?.id ?? node?.agent?.id ?? '')
const roleOf = (node) => String(node?.role ?? node?.agent?.role ?? 'default')
const nameOf = (node) => String(node?.name ?? node?.agent?.name ?? idOf(node))
const radiusOf = (node) => Math.max(34,
  finite(node?.r) ?? finite(node?.radius) ?? ROLE_RADII[roleOf(node)] ?? ROLE_RADII.default)

function hierarchyParents(nodes, edges) {
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
    || x - naive[index - 1] >= list[index - 1].r + list[index].r + 2)
  if (naiveOk) return naive

  for (const [edge, air] of PACKING_LADDER) {
    const gaps = list.map((record, index) => index
      ? list[index - 1].r + record.r + air
      : 0)
    const span = gaps.reduce((sum, gap) => sum + gap, 0)
    const available = width - edge * 2 - list[0].r - list.at(-1).r
    if (span > available) continue
    let x = edge + list[0].r + Math.max(0, (available - span) / 2)
    return list.map((record, index) => (x += gaps[index]))
  }
  return null
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

function labelFor(record, pitch) {
  if (pitch == null) return { maxWidth: null, text: record.name }
  const maxWidth = Math.max(70, Math.round(pitch - 14))
  const characters = Math.max(6, Math.floor((maxWidth - 16) / 7.2))
  if (record.name.length <= characters) return { maxWidth, text: record.name }

  const segments = record.id.split(/[-_.]/).filter(Boolean)
  let suffix = ''
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const candidate = segments.slice(index).join('-')
    if (candidate.length > characters) break
    suffix = candidate
  }
  if (suffix) return { maxWidth, text: suffix }

  const tail = segments.at(-1) || record.name
  const text = tail.length > characters
    ? `${tail.slice(0, Math.max(2, characters - 4))}…${tail.slice(-3)}`
    : tail
  return { maxWidth, text }
}

/**
 * Deterministic, DOM-free top-down tree layout for Mission Control page 2.
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
  let padTop = 104
  let padBottom = 92
  if (rows > 1) {
    const deficit = 86 * (rows - 1) - (height - padTop - padBottom)
    if (deficit > 0) {
      const topGive = Math.min(40, Math.round(deficit * 0.55))
      padTop -= topGive
      padBottom -= Math.min(22, deficit - topGive)
    }
  }
  const rowHeight = rows > 1 ? (height - padTop - padBottom) / (rows - 1) : 0
  const slots = new Map()
  const labels = new Map()
  const culled = new Set()
  const rowYs = []
  let drillRequired = false

  tierKeys.forEach((tierKey, rowIndex) => {
    const list = tiers.get(tierKey)
    list.sort((left, right) => {
      const leftParentX = slots.get(parents.get(left.id))?.x ?? width / 2
      const rightParentX = slots.get(parents.get(right.id))?.x ?? width / 2
      return leftParentX - rightParentX || left.id.localeCompare(right.id)
    })
    const y = rows > 1 ? padTop + rowIndex * rowHeight : height / 2
    rowYs.push(y)

    let visible = list
    let xs = packedXs(visible, width)
    const naiveReadableRadius = list.length ? width / (2 * (list.length + 1)) : Infinity
    if (!xs || naiveReadableRadius < 34) {
      drillRequired = true
      const keep = keepReadable(list, width)
      visible = list.filter(record => keep.has(record.id))
      for (const record of list) if (!keep.has(record.id)) culled.add(record.id)
      xs = packedXs(visible, width)
    }

    if (!xs && visible.length) {
      // The widest single record always fits the minimum canvas. This branch
      // is a defensive guarantee for malformed radii or extreme test inputs.
      visible = [visible[0]]
      xs = [width / 2]
      drillRequired = true
      for (const record of list.slice(1)) culled.add(record.id)
    }

    const pitch = visible.length > 1
      ? Math.min(...xs.slice(1).map((x, index) => x - xs[index]))
      : null
    visible.forEach((record, index) => {
      slots.set(record.id, { x: xs[index], y })
      labels.set(record.id, labelFor(record, pitch))
    })
  })

  return { slots, rowYs, culled, drillRequired, labels }
}

export const TREE_ROLE_RADII = ROLE_RADII
