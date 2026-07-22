import { boundsOf, centerOf, iaGroupId, iaSideForVertex, semanticEdges, semanticVertices } from './tree-layout.mjs'
import { cellMap, cloneModel, edgeCell, pointVertex, setCellStyle } from './xml-model.mjs'

const ROOT_ROWS = [396, 636, 900, 1236]

function pad(index) {
  return String(index + 1).padStart(2, '0')
}

function junctionId(group, index) {
  return `route-junction--${group}--${pad(index)}`
}

function physicalEdgeId(group, role, index) {
  return `route-edge--${group}--${role}--${pad(index)}`
}

function pointAt(cell, side) {
  const bounds = boundsOf(cell)
  if (side === 'left') return { x: bounds.x, y: bounds.y + bounds.height / 2 }
  if (side === 'right') return { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2 }
  if (side === 'top') return { x: bounds.x + bounds.width / 2, y: bounds.y }
  if (side === 'bottom') return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height }
  return centerOf(cell)
}

function physicalStyle({ route, group, role, startSide = 'center', endSide = 'center', arrow = false }) {
  const sourcePort = startSide === 'left' ? { exitX: '0', exitY: '0.5' }
    : startSide === 'right' ? { exitX: '1', exitY: '0.5' }
      : startSide === 'top' ? { exitX: '0.5', exitY: '0' }
        : startSide === 'bottom' ? { exitX: '0.5', exitY: '1' }
          : { exitX: '0.5', exitY: '0.5' }
  const targetPort = endSide === 'left' ? { entryX: '0', entryY: '0.5' }
    : endSide === 'right' ? { entryX: '1', entryY: '0.5' }
      : endSide === 'top' ? { entryX: '0.5', entryY: '0' }
        : endSide === 'bottom' ? { entryX: '0.5', entryY: '1' }
          : { entryX: '0.5', entryY: '0.5' }
  return {
    rounded: '0', html: '0', ...sourcePort, ...targetPort, exitPerimeter: '0', entryPerimeter: '0',
    strokeColor: '#111111', strokeWidth: '1', endArrow: arrow ? 'open' : 'none', endFill: '0',
    pokeKind: 'physical', pokeRoute: route, pokeGroup: group, pokePhysicalRole: role, pokeSemanticRefs: '',
  }
}

function addPhysicalEdge(context, spec) {
  const cell = edgeCell(spec.id, spec.sourceId, spec.targetId, physicalStyle(spec))
  context.physicalCells.push(cell)
  context.physicalEdges.push({
    id: spec.id,
    sourceId: spec.sourceId,
    targetId: spec.targetId,
    group: spec.group,
    route: spec.route,
    role: spec.role,
    router: 'deterministic-tree-v1',
    orderedWaypoints: [],
    semanticRefs: [],
  })
  return spec.id
}

function addJunction(context, group, index, x, y, role) {
  const id = junctionId(group, index)
  context.junctionCells.push(pointVertex(id, x, y, group))
  context.junctions.push({ id, x, y, group, role })
  return id
}

function rootTrunk(context, groupEdges) {
  const group = 'root-products'
  const byId = context.byId
  const dashboard = byId.get('ia-dashboard')
  const junctionIds = ROOT_ROWS.map((y, index) => addJunction(context, group, index, 1140, y, 'row'))
  const stemId = addPhysicalEdge(context, {
    id: physicalEdgeId(group, 'stem', 0), sourceId: dashboard.id, targetId: junctionIds[0],
    route: 'trunk', group, role: 'stem', startSide: 'bottom', endSide: 'center',
  })
  const railIds = ROOT_ROWS.slice(1).map((_, index) => addPhysicalEdge(context, {
    id: physicalEdgeId(group, 'rail', index), sourceId: junctionIds[index], targetId: junctionIds[index + 1],
    route: 'trunk', group, role: 'rail',
  }))
  const edgeByTarget = new Map(groupEdges.map((edge) => [edge.attributes.target, edge]))
  const rows = [
    ['ia-obs', 'ia-clip-library'],
    ['ia-onboarding', 'ia-vod'],
    ['ia-live', 'ia-settings'],
    ['ia-clip-editor', 'ia-operations'],
  ]
  rows.forEach((targets, rowIndex) => targets.forEach((targetId, sideIndex) => {
    const semantic = edgeByTarget.get(targetId)
    if (!semantic) throw new Error(`root semantic edge 누락: ${targetId}`)
    const branchIndex = rowIndex * 2 + sideIndex
    const side = iaSideForVertex(targetId)
    const branchId = addPhysicalEdge(context, {
      id: physicalEdgeId(group, 'branch', branchIndex), sourceId: junctionIds[rowIndex], targetId,
      route: 'trunk', group, role: 'branch', endSide: side === 'left' ? 'right' : 'left', arrow: true,
    })
    context.mapping[semantic.id] = [stemId, ...railIds.slice(0, rowIndex), branchId]
  }))
}

function genericTrunk(context, sourceId, groupEdges) {
  const group = iaGroupId(sourceId)
  const source = context.byId.get(sourceId)
  const side = iaSideForVertex(groupEdges[0].attributes.target)
  if (!source || !side) throw new Error(`trunk side/source 누락: ${sourceId}`)
  const sourceBounds = boundsOf(source)
  const sourceBoundary = side === 'left' ? sourceBounds.x : sourceBounds.x + sourceBounds.width
  const targetBounds = groupEdges.map((edge) => boundsOf(context.byId.get(edge.attributes.target)))
  const targetBoundary = side === 'left'
    ? Math.max(...targetBounds.map(({ x, width }) => x + width))
    : Math.min(...targetBounds.map(({ x }) => x))
  const railX = (sourceBoundary + targetBoundary) / 2
  const parentY = centerOf(source).y
  const sortedEdges = [...groupEdges].sort((left, right) => {
    const delta = centerOf(context.byId.get(left.attributes.target)).y - centerOf(context.byId.get(right.attributes.target)).y
    return delta || left.id.localeCompare(right.id, 'en')
  })
  const yValues = [...new Set([parentY, ...sortedEdges.map((edge) => centerOf(context.byId.get(edge.attributes.target)).y)])].sort((a, b) => a - b)
  const junctionIds = yValues.map((y, index) => addJunction(context, group, index, railX, y, y === parentY ? 'stem' : 'branch'))
  const parentIndex = yValues.indexOf(parentY)
  const stemId = addPhysicalEdge(context, {
    id: physicalEdgeId(group, 'stem', 0), sourceId, targetId: junctionIds[parentIndex],
    route: 'trunk', group, role: 'stem', startSide: side, endSide: 'center',
  })
  const railIds = yValues.slice(1).map((_, index) => addPhysicalEdge(context, {
    id: physicalEdgeId(group, 'rail', index), sourceId: junctionIds[index], targetId: junctionIds[index + 1],
    route: 'trunk', group, role: 'rail',
  }))
  sortedEdges.forEach((semantic, branchIndex) => {
    const targetId = semantic.attributes.target
    const childIndex = yValues.indexOf(centerOf(context.byId.get(targetId)).y)
    const branchId = addPhysicalEdge(context, {
      id: physicalEdgeId(group, 'branch', branchIndex), sourceId: junctionIds[childIndex], targetId,
      route: 'trunk', group, role: 'branch', endSide: side === 'left' ? 'right' : 'left', arrow: true,
    })
    const rails = childIndex >= parentIndex
      ? railIds.slice(parentIndex, childIndex)
      : railIds.slice(childIndex, parentIndex).reverse()
    context.mapping[semantic.id] = [stemId, ...rails, branchId]
  })
}

function directRelation(context, semantic) {
  const sourceId = semantic.attributes.source
  const targetId = semantic.attributes.target
  const group = iaGroupId(sourceId)
  const isVertical = sourceId === 'ia-login'
  const side = isVertical ? null : iaSideForVertex(targetId)
  const id = physicalEdgeId(group, 'branch', 0)
  addPhysicalEdge(context, {
    id, sourceId, targetId, route: 'direct', group, role: 'branch',
    startSide: isVertical ? 'bottom' : side,
    endSide: isVertical ? 'top' : side === 'left' ? 'right' : 'left',
    arrow: true,
  })
  context.mapping[semantic.id] = [id]
}

function applySemanticReferences(context) {
  const refs = new Map(context.physicalEdges.map(({ id }) => [id, []]))
  for (const [semanticId, physicalIds] of Object.entries(context.mapping)) {
    for (const physicalId of physicalIds) refs.get(physicalId).push(semanticId)
  }
  const physicalById = new Map(context.physicalEdges.map((edge) => [edge.id, edge]))
  for (const cell of context.physicalCells) {
    const semanticRefs = refs.get(cell.id).sort()
    setCellStyle(cell, { pokeSemanticRefs: semanticRefs.join(',') })
    physicalById.get(cell.id).semanticRefs = semanticRefs
  }
}

export function buildPhysicalIa(inputModel) {
  const sourceModel = cloneModel(inputModel)
  const vertices = semanticVertices(sourceModel)
  const semantic = semanticEdges(sourceModel)
  const byId = cellMap(sourceModel)
  const context = {
    byId,
    junctionCells: [],
    physicalCells: [],
    junctions: [],
    physicalEdges: [],
    mapping: {},
  }
  for (const vertex of vertices) setCellStyle(vertex, { pokeKind: 'semantic' })
  for (const edge of semantic) {
    setCellStyle(edge, {
      pokeKind: 'semantic', opacity: '0', strokeOpacity: '0', fillOpacity: '0', pointerEvents: '0', endArrow: 'none',
    })
    edge.geometry.points = []
  }
  const groups = new Map()
  for (const edge of semantic) {
    const edges = groups.get(edge.attributes.source) ?? []
    edges.push(edge)
    groups.set(edge.attributes.source, edges)
  }
  for (const [sourceId, groupEdges] of groups) {
    if (sourceId === 'ia-dashboard') rootTrunk(context, groupEdges)
    else if (groupEdges.length >= 2) genericTrunk(context, sourceId, groupEdges)
    else directRelation(context, groupEdges[0])
  }
  applySemanticReferences(context)
  const baseCells = sourceModel.cells.filter((cell) => cell.attributes.edge !== '1' || semantic.some(({ id }) => id === cell.id))
  sourceModel.cells = [...baseCells, ...context.junctionCells, ...context.physicalCells]
  return {
    model: sourceModel,
    semanticVertices: vertices.map(({ id }) => id).sort(),
    semanticEdges: semantic.map((edge) => ({ id: edge.id, sourceId: edge.attributes.source, targetId: edge.attributes.target })).sort((a, b) => a.id.localeCompare(b.id, 'en')),
    junctions: context.junctions,
    physicalEdges: context.physicalEdges,
    semanticToPhysical: Object.fromEntries(Object.entries(context.mapping).sort(([left], [right]) => left.localeCompare(right, 'en'))),
  }
}

export function physicalEndpoints(model, physical) {
  const byId = cellMap(model)
  const cell = byId.get(physical.id)
  const source = byId.get(physical.sourceId)
  const target = byId.get(physical.targetId)
  const startSide = Number(cell.style.exitX) === 0 ? 'left' : Number(cell.style.exitX) === 1 ? 'right'
    : Number(cell.style.exitY) === 0 ? 'top' : Number(cell.style.exitY) === 1 ? 'bottom' : 'center'
  const endSide = Number(cell.style.entryX) === 0 ? 'left' : Number(cell.style.entryX) === 1 ? 'right'
    : Number(cell.style.entryY) === 0 ? 'top' : Number(cell.style.entryY) === 1 ? 'bottom' : 'center'
  return [pointAt(source, startSide), pointAt(target, endSide)]
}
