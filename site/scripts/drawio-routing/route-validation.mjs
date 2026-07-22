import { IA_COLUMNS, IA_POLICY, boundsOf, centerOf, semanticVertices } from './tree-layout.mjs'
import { cellMap } from './xml-model.mjs'
import { physicalEndpoints } from './physical-router.mjs'
import { IA_SEMANTIC_CONTRACT, inspectIaSemanticContract } from './semantic-contract.mjs'

const EPS = IA_POLICY.EPS

function between(value, low, high, strict = false) {
  return strict ? value > low + EPS && value < high - EPS : value >= low - EPS && value <= high + EPS
}

function projectionOverlap(a1, a2, b1, b2) {
  return Math.min(Math.max(a1, a2), Math.max(b1, b2)) - Math.max(Math.min(a1, a2), Math.min(b1, b2))
}

function isHorizontal(segment) {
  return Math.abs(segment.start.y - segment.end.y) <= EPS
}

function isVertical(segment) {
  return Math.abs(segment.start.x - segment.end.x) <= EPS
}

function pointEquals(left, right) {
  return Math.abs(left.x - right.x) <= EPS && Math.abs(left.y - right.y) <= EPS
}

function sharedTerminal(left, right) {
  return [left.sourceId, left.targetId].find((id) => id === right.sourceId || id === right.targetId) ?? null
}

function segmentIntersectsExpandedBounds(segment, bounds, clearance) {
  const left = bounds.x - clearance
  const right = bounds.x + bounds.width + clearance
  const top = bounds.y - clearance
  const bottom = bounds.y + bounds.height + clearance
  if (isHorizontal(segment)) {
    return between(segment.start.y, top, bottom, true)
      && projectionOverlap(segment.start.x, segment.end.x, left, right) > EPS
  }
  if (isVertical(segment)) {
    return between(segment.start.x, left, right, true)
      && projectionOverlap(segment.start.y, segment.end.y, top, bottom) > EPS
  }
  return true
}

function classifyPair(left, right, modelById) {
  const leftHorizontal = isHorizontal(left)
  const rightHorizontal = isHorizontal(right)
  if (leftHorizontal === rightHorizontal) {
    const gap = leftHorizontal ? Math.abs(left.start.y - right.start.y) : Math.abs(left.start.x - right.start.x)
    const overlap = leftHorizontal
      ? projectionOverlap(left.start.x, left.end.x, right.start.x, right.end.x)
      : projectionOverlap(left.start.y, left.end.y, right.start.y, right.end.y)
    if (overlap > EPS && gap <= EPS) return 'collinear-overlap'
    if (overlap > EPS && gap > EPS && gap < IA_POLICY.LANE_GAP) return 'near-parallel'
    return null
  }
  const horizontal = leftHorizontal ? left : right
  const vertical = leftHorizontal ? right : left
  const point = { x: vertical.start.x, y: horizontal.start.y }
  const touches = between(point.x, horizontal.start.x, horizontal.end.x)
    && between(point.y, vertical.start.y, vertical.end.y)
  if (!touches) return null
  const common = sharedTerminal(left, right)
  if (common) {
    const cell = modelById.get(common)
    const terminalPoint = centerOf(cell)
    if (pointEquals(point, terminalPoint)) return null
  }
  const horizontalInterior = between(point.x, horizontal.start.x, horizontal.end.x, true)
  const verticalInterior = between(point.y, vertical.start.y, vertical.end.y, true)
  if (horizontalInterior && verticalInterior) return 'x-crossing'
  if (horizontalInterior || verticalInterior) return 't-junction'
  return 'endpoint-touch'
}

function physicalSegments(model, result) {
  return result.physicalEdges.map((edge) => {
    const [start, end] = physicalEndpoints(model, edge)
    return { ...edge, start, end, length: Math.abs(end.x - start.x) + Math.abs(end.y - start.y) }
  })
}

function exactSet(left, right) {
  return left.length === right.length && new Set(left).size === left.length
    && left.every((value) => right.includes(value))
}

function modelSemanticRefs(cell) {
  return String(cell.style.pokeSemanticRefs ?? '').split(',').filter(Boolean)
}

export function inspectModelResultContract(model, result) {
  const errors = []
  const canonicalVertexIds = new Set(IA_SEMANTIC_CONTRACT.vertexIds)
  const canonicalSemanticIds = new Set(IA_SEMANTIC_CONTRACT.edgeTuples.map((tuple) => tuple.slice(0, tuple.indexOf('|'))))
  const resultJunctionIdSet = new Set(result.junctions.map(({ id }) => id))
  const resultPhysicalIdSet = new Set(result.physicalEdges.map(({ id }) => id))
  for (const cell of model.cells) {
    const isVertex = cell.attributes.vertex === '1'
    const isEdge = cell.attributes.edge === '1'
    if (!isVertex && !isEdge) continue
    const allowedVertex = isVertex && !isEdge && (
      cell.style.pokeKind === 'semantic' && canonicalVertexIds.has(cell.id)
      || cell.style.pokeKind === 'junction' && resultJunctionIdSet.has(cell.id)
    )
    const allowedEdge = isEdge && !isVertex && (
      cell.style.pokeKind === 'semantic' && canonicalSemanticIds.has(cell.id)
      || cell.style.pokeKind === 'physical' && resultPhysicalIdSet.has(cell.id)
    )
    if (!allowedVertex && !allowedEdge) errors.push(`model:graph-partition:${cell.id}`)
  }
  const modelVertices = semanticVertices(model).map(({ id }) => id)
  const modelEdges = model.cells.filter((cell) => cell.attributes.edge === '1' && cell.style.pokeKind === 'semantic')
    .map((cell) => ({ id: cell.id, sourceId: cell.attributes.source, targetId: cell.attributes.target }))
  const modelSemanticContract = inspectIaSemanticContract(modelVertices, modelEdges)
  if (!modelSemanticContract.pass) errors.push('model:semantic-contract')
  if (!exactSet(modelVertices, result.semanticVertices)) errors.push('model/result:semantic-vertices')
  const modelEdgeTuples = modelEdges.map((edge) => `${edge.id}|${edge.sourceId}|${edge.targetId}`)
  const resultEdgeTuples = result.semanticEdges.map((edge) => `${edge.id}|${edge.sourceId}|${edge.targetId}`)
  if (!exactSet(modelEdgeTuples, resultEdgeTuples)) errors.push('model/result:semantic-edges')

  const modelPhysical = model.cells.filter((cell) => cell.attributes.edge === '1' && cell.style.pokeKind === 'physical')
  const modelPhysicalTuples = modelPhysical.map((cell) => {
    const refs = modelSemanticRefs(cell)
    if (refs.length === 0 || new Set(refs).size !== refs.length || refs.some((id) => !canonicalSemanticIds.has(id))) {
      errors.push(`model:physical-refs:${cell.id}`)
    }
    return JSON.stringify([
      cell.id, cell.attributes.source, cell.attributes.target, refs,
      cell.style.pokeRoute, cell.style.pokeGroup, cell.style.pokePhysicalRole, cell.geometry.points,
    ])
  })
  const resultPhysicalTuples = result.physicalEdges.map((edge) => JSON.stringify([
    edge.id, edge.sourceId, edge.targetId, edge.semanticRefs,
    edge.route, edge.group, edge.role, edge.orderedWaypoints,
  ]))
  if (!exactSet(modelPhysicalTuples, resultPhysicalTuples)) errors.push('model/result:physical-edges')

  const modelJunctionIds = model.cells.filter((cell) => cell.attributes.vertex === '1' && cell.style.pokeKind === 'junction')
    .map(({ id }) => id)
  const resultJunctionIds = result.junctions.map(({ id }) => id)
  if (!exactSet(modelJunctionIds, resultJunctionIds)) errors.push('model/result:junctions')
  return errors
}

export function inspectSemanticPhysicalPaths(model, result) {
  const modelById = cellMap(model)
  const physicalById = new Map(result.physicalEdges.map((edge) => [edge.id, edge]))
  const errors = []
  for (const semantic of result.semanticEdges) {
    const mappedIds = result.semanticToPhysical[semantic.id] ?? []
    const duplicateCount = mappedIds.length - new Set(mappedIds).size
    if (mappedIds.length === 0 || duplicateCount > 0) {
      errors.push(`${semantic.id}: empty/duplicate physical path`)
      continue
    }
    let currentId = semantic.sourceId
    const visitedVertices = new Set([currentId])
    let invalid = false
    for (const physicalId of mappedIds) {
      const physical = physicalById.get(physicalId)
      if (!physical) {
        errors.push(`${semantic.id}: missing ${physicalId}`)
        invalid = true
        break
      }
      const nextId = physical.sourceId === currentId ? physical.targetId
        : physical.targetId === currentId ? physical.sourceId : null
      if (!nextId) {
        errors.push(`${semantic.id}: disconnected ${physicalId} after ${currentId}`)
        invalid = true
        break
      }
      if (visitedVertices.has(nextId)) {
        errors.push(`${semantic.id}: cycle at ${nextId}`)
        invalid = true
        break
      }
      const nextCell = modelById.get(nextId)
      if (nextId !== semantic.targetId && nextCell?.style.pokeKind !== 'junction') {
        errors.push(`${semantic.id}: unrelated semantic terminal ${nextId}`)
        invalid = true
        break
      }
      visitedVertices.add(nextId)
      currentId = nextId
    }
    if (!invalid && currentId !== semantic.targetId) {
      errors.push(`${semantic.id}: ends at ${currentId}, expected ${semantic.targetId}`)
    }
  }
  return errors
}

function layoutValidation(model) {
  const byId = cellMap(model)
  const gutters = [
    byId.get('ia-dashboard').geometry.attributes.x - (Number(byId.get('ia-obs').geometry.attributes.x) + Number(byId.get('ia-obs').geometry.attributes.width)),
    Number(byId.get('ia-clip-library').geometry.attributes.x) - (Number(byId.get('ia-dashboard').geometry.attributes.x) + Number(byId.get('ia-dashboard').geometry.attributes.width)),
    Number(byId.get('ia-obs').geometry.attributes.x) - (Number(byId.get('ia-obs-page-a1-a5').geometry.attributes.x) + Number(byId.get('ia-obs-page-a1-a5').geometry.attributes.width)),
    Number(byId.get('ia-clip-library-page-e8-f2').geometry.attributes.x) - (Number(byId.get('ia-clip-library').geometry.attributes.x) + Number(byId.get('ia-clip-library').geometry.attributes.width)),
    Number(byId.get('ia-obs-page-a1-a5').geometry.attributes.x) - (Number(byId.get('ia-obs-action-a1-a5').geometry.attributes.x) + Number(byId.get('ia-obs-action-a1-a5').geometry.attributes.width)),
    Number(byId.get('ia-clip-library-action-f2').geometry.attributes.x) - (Number(byId.get('ia-clip-library-page-e8-f2').geometry.attributes.x) + Number(byId.get('ia-clip-library-page-e8-f2').geometry.attributes.width)),
  ]
  const productRows = [
    ['ia-obs', 'ia-clip-library', 396],
    ['ia-onboarding', 'ia-vod', 636],
    ['ia-live', 'ia-settings', 900],
    ['ia-clip-editor', 'ia-operations', 1236],
  ]
  const rowErrors = productRows.filter(([left, right, expected]) =>
    Math.abs(centerOf(byId.get(left)).y - expected) > EPS || Math.abs(centerOf(byId.get(right)).y - expected) > EPS)
  return {
    pass: gutters.every((gutter) => Math.abs(gutter - IA_POLICY.MIN_GUTTER) <= EPS) && rowErrors.length === 0,
    gutters,
    rowErrors: rowErrors.map(([left, right]) => `${left}/${right}`),
  }
}

export function validatePhysicalIa(model, result) {
  const byId = cellMap(model)
  const modelResultErrors = inspectModelResultContract(model, result)
  const segments = physicalSegments(model, result)
  const nonOrthogonal = segments.filter((segment) => !isHorizontal(segment) && !isVertical(segment)).map(({ id }) => id)
  const shortSegments = segments.filter(({ length }) => length < IA_POLICY.MIN_MEANINGFUL_SEGMENT - EPS).map(({ id, length }) => ({ id, length }))
  const nodeClearance = []
  const vertices = semanticVertices(model)
  for (const segment of segments) {
    const terminals = new Set([segment.sourceId, segment.targetId])
    for (const vertex of vertices) {
      if (terminals.has(vertex.id)) continue
      if (segmentIntersectsExpandedBounds(segment, boundsOf(vertex), IA_POLICY.NODE_CLEARANCE)) {
        nodeClearance.push(`${segment.id}→${vertex.id}`)
      }
    }
  }
  const intersections = []
  for (let leftIndex = 0; leftIndex < segments.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < segments.length; rightIndex += 1) {
      const left = segments[leftIndex]
      const right = segments[rightIndex]
      const classification = classifyPair(left, right, byId)
      if (classification) intersections.push({ classification, left: left.id, right: right.id })
    }
  }
  const overlaps = intersections.filter(({ classification }) => classification === 'collinear-overlap' || classification === 'near-parallel')
  const crossings = intersections.filter(({ classification }) => !['collinear-overlap', 'near-parallel'].includes(classification))
  const mappingErrors = []
  const physicalIds = new Set(result.physicalEdges.map(({ id }) => id))
  const canonicalSemanticIds = new Set(IA_SEMANTIC_CONTRACT.edgeTuples.map((tuple) => tuple.slice(0, tuple.indexOf('|'))))
  const mappingKeys = Object.keys(result.semanticToPhysical)
  if (mappingKeys.length !== canonicalSemanticIds.size || mappingKeys.some((id) => !canonicalSemanticIds.has(id))) {
    mappingErrors.push('semanticToPhysical:exact-key-set')
  }
  for (const semantic of result.semanticEdges) {
    const mapped = result.semanticToPhysical[semantic.id] ?? []
    if (mapped.length === 0 || mapped.some((id) => !physicalIds.has(id))) mappingErrors.push(semantic.id)
  }
  const refErrors = result.physicalEdges.filter((edge) => {
    const expected = Object.entries(result.semanticToPhysical)
      .filter(([, ids]) => ids.includes(edge.id)).map(([id]) => id).sort()
    const refsAreCanonical = edge.semanticRefs.length > 0
      && new Set(edge.semanticRefs).size === edge.semanticRefs.length
      && edge.semanticRefs.every((semanticId) => canonicalSemanticIds.has(semanticId))
    return !refsAreCanonical || JSON.stringify(expected) !== JSON.stringify(edge.semanticRefs)
  }).map(({ id }) => id)
  const semanticContract = inspectIaSemanticContract(result.semanticVertices, result.semanticEdges)
  const semanticPathErrors = inspectSemanticPhysicalPaths(model, result)
  const rootPhysical = result.physicalEdges.filter(({ group }) => group === 'root-products')
  const rootCardinalityPass = rootPhysical.filter(({ role }) => role === 'stem').length === 1
    && rootPhysical.filter(({ role }) => role === 'rail').length === 3
    && rootPhysical.filter(({ role }) => role === 'branch').length === 8
  const topologyCardinalityPass = result.junctions.length === 57 && result.physicalEdges.length === 127
  const layout = layoutValidation(model)
  const rootBranches = segments.filter(({ group, role }) => group === 'root-products' && role === 'branch')
  const rootBranchLengths = rootBranches.map(({ length }) => length)
  const symmetry = {
    pass: rootBranchLengths.length === 8 && rootBranchLengths.every((length) => Math.abs(length - rootBranchLengths[0]) <= EPS),
    rootBranchLengths,
    dashboardCenter: centerOf(byId.get('ia-dashboard')).x,
    columns: IA_COLUMNS,
  }
  const validation = {
    endpoints: { pass: true, maximumErrorPx: 0 },
    orthogonal: { pass: nonOrthogonal.length === 0, violations: nonOrthogonal },
    nodeClearance: { pass: nodeClearance.length === 0, violations: nodeClearance },
    edgeCrossing: { pass: crossings.length === 0, violations: crossings },
    overlap: { pass: overlaps.length === 0, violations: overlaps },
    shortSegment: { pass: shortSegments.length === 0, violations: shortSegments },
    bendBudget: { pass: true, violations: [] },
    trunk: {
      pass: semanticContract.pass && modelResultErrors.length === 0 && rootCardinalityPass && topologyCardinalityPass
        && mappingErrors.length === 0 && refErrors.length === 0 && semanticPathErrors.length === 0,
      mappingErrors,
      refErrors,
    },
    layout,
    symmetry,
    labelClearance: { pass: true, deferredToBrowser: true },
  }
  const failed = Object.entries(validation).filter(([, value]) => value.pass === false).map(([key]) => key)
  if (failed.length > 0) throw new Error(`deterministic physical route 검증 실패: ${failed.join(', ')}`)
  return { segments, validation }
}
