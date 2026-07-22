import {
  USERJOURNEY_POLICY,
  USERJOURNEY_SEMANTIC_CONTRACT,
  annotationEnvelopes,
  boundsOf,
  centerOf,
  listJourneyDecorationCells,
  normalizeUserJourneySource,
  semanticJourneyEdges,
  semanticJourneyVertices,
} from './userjourney-layout.mjs'
import { physicalEndpoints } from './userjourney-router.mjs'
import { cellMap, cloneModel } from './xml-model.mjs'

const EPS = USERJOURNEY_POLICY.EPS

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y)
}

function between(value, low, high, strict = false) {
  return strict
    ? value > Math.min(low, high) + EPS && value < Math.max(low, high) - EPS
    : value >= Math.min(low, high) - EPS && value <= Math.max(low, high) + EPS
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
  return distance(left, right) <= EPS
}

function exactSet(actual, expected) {
  return actual.length === expected.length && new Set(actual).size === actual.length
    && actual.every((value) => expected.includes(value))
}

function modelSemanticRefs(cell) {
  return String(cell.style.pokeSemanticRefs ?? '').split(',').filter(Boolean)
}

function semanticTuple(edge) {
  return `${edge.id}|${edge.sourceId}|${edge.targetId}|${edge.relationKind}`
}

function physicalSegments(model, result) {
  return result.physicalEdges.map((edge) => {
    const [start, end] = physicalEndpoints(model, edge)
    return {
      ...edge,
      start,
      end,
      length: Math.abs(end.x - start.x) + Math.abs(end.y - start.y),
    }
  })
}

function inspectSemanticContract(result) {
  const expectedVertices = USERJOURNEY_SEMANTIC_CONTRACT.nodeIds
  const expectedEdges = USERJOURNEY_SEMANTIC_CONTRACT.edges.map(semanticTuple)
  const actualEdges = result.semanticEdges.map(semanticTuple)
  const relationKinds = result.semanticEdges.reduce((counts, edge) => {
    counts[edge.relationKind] = (counts[edge.relationKind] ?? 0) + 1
    return counts
  }, {})
  const errors = []
  if (!exactSet(result.semanticVertices, expectedVertices)) errors.push('vertices')
  if (!exactSet(actualEdges, expectedEdges)) errors.push('typed-edge-tuples')
  if (relationKinds.transition !== 2 || Object.keys(relationKinds).length !== 1) errors.push('relationKind-counts')
  return { pass: errors.length === 0, errors, vertexCount: result.semanticVertices.length, edgeCount: result.semanticEdges.length, relationKinds }
}

function inspectDecorationPartition(model, result) {
  const modelDecorationIds = listJourneyDecorationCells(model).map(({ id }) => id)
  const errors = []
  if (!exactSet(modelDecorationIds, USERJOURNEY_SEMANTIC_CONTRACT.decorationIds)) errors.push('model-decoration-ids')
  if (!exactSet(result.decorations, USERJOURNEY_SEMANTIC_CONTRACT.decorationIds)) errors.push('result-decoration-ids')
  const interactiveDecorations = model.cells.filter((cell) => cell.style.pokeKind === 'decoration'
    && (cell.style.pointerEvents === '1' || cell.style.pokeSemanticRole))
  if (interactiveDecorations.length > 0) errors.push(...interactiveDecorations.map(({ id }) => `interactive:${id}`))
  return { pass: errors.length === 0, errors, count: modelDecorationIds.length }
}

// 조건1: contract annotation envelope가 EDGE_Y_BAND(240~940)를 침범하면 hard FAIL.
// 서브셋 validator가 annotation envelope 교차를 안 잡으므로, 밴드 이탈의 회귀 안전망.
function inspectAnnotationBand(model) {
  const band = USERJOURNEY_POLICY.EDGE_Y_BAND
  const violations = []
  for (const envelope of annotationEnvelopes(model)) {
    const intersects = envelope.bottom > band.top + EPS && envelope.top < band.bottom - EPS
    if (intersects) violations.push(`${envelope.id}:${envelope.top}-${envelope.bottom}`)
  }
  return { pass: violations.length === 0, violations, band }
}

function inspectModelResult(model, result) {
  const errors = []
  const byId = cellMap(model)
  const canonicalVertices = new Set(USERJOURNEY_SEMANTIC_CONTRACT.nodeIds)
  const canonicalEdges = new Set(USERJOURNEY_SEMANTIC_CONTRACT.edges.map(({ id }) => id))
  const canonicalDecorations = new Set(USERJOURNEY_SEMANTIC_CONTRACT.decorationIds)
  const resultJunctionIds = result.junctions.map(({ id }) => id)
  const resultJunctions = new Set(resultJunctionIds)
  const resultPhysical = new Set(result.physicalEdges.map(({ id }) => id))
  for (const cell of model.cells) {
    const isVertex = cell.attributes.vertex === '1'
    const isEdge = cell.attributes.edge === '1'
    if (!isVertex && !isEdge) continue
    const allowed = isVertex && !isEdge && (
      cell.style.pokeKind === 'semantic' && canonicalVertices.has(cell.id)
      || cell.style.pokeKind === 'decoration' && canonicalDecorations.has(cell.id)
      || cell.style.pokeKind === 'junction' && resultJunctions.has(cell.id)
    ) || isEdge && !isVertex && (
      cell.style.pokeKind === 'semantic' && canonicalEdges.has(cell.id)
      || cell.style.pokeKind === 'physical' && resultPhysical.has(cell.id)
    )
    if (!allowed) errors.push(`graph-partition:${cell.id}`)
  }
  const modelSemantic = semanticJourneyEdges(model).map((edge) => semanticTuple({
    id: edge.id, sourceId: edge.attributes.source, targetId: edge.attributes.target,
    relationKind: edge.style.pokeRelationKind,
  }))
  if (!exactSet(modelSemantic, result.semanticEdges.map(semanticTuple))) errors.push('semantic-edges')
  if (!exactSet(semanticJourneyVertices(model).map(({ id }) => id), result.semanticVertices)) errors.push('semantic-vertices')
  const modelJunctionIds = model.cells
    .filter((cell) => cell.attributes.vertex === '1' && cell.style.pokeKind === 'junction')
    .map(({ id }) => id)
  if (!exactSet(resultJunctionIds, modelJunctionIds)) errors.push('junction-exact-unique-set')

  for (const physical of result.physicalEdges) {
    const cell = byId.get(physical.id)
    if (!cell) {
      errors.push(`physical-missing:${physical.id}`)
      continue
    }
    const refs = modelSemanticRefs(cell)
    if (cell.attributes.source !== physical.sourceId || cell.attributes.target !== physical.targetId
      || cell.style.pokeRoute !== physical.route || cell.style.pokeGroup !== physical.group
      || cell.style.pokePhysicalRole !== physical.role || cell.style.pokeRelationKind !== physical.relationKind
      || !exactSet(refs, physical.semanticRefs) || JSON.stringify(cell.geometry.points) !== JSON.stringify(physical.orderedWaypoints)) {
      errors.push(`physical-drift:${physical.id}`)
    }
  }
  for (const junction of result.junctions) {
    const cell = byId.get(junction.id)
    if (!cell || cell.style.pokeKind !== 'junction') errors.push(`junction-missing:${junction.id}`)
    else {
      const bounds = boundsOf(cell)
      if (Math.abs(bounds.x - junction.x) > EPS || Math.abs(bounds.y - junction.y) > EPS
        || bounds.width !== 0 || bounds.height !== 0) errors.push(`junction-drift:${junction.id}`)
    }
  }
  return { pass: errors.length === 0, errors }
}

function inspectPhysicalRelationKinds(result) {
  const semanticById = new Map(result.semanticEdges.map((edge) => [edge.id, edge]))
  const violations = []
  for (const physical of result.physicalEdges) {
    const referencedKinds = new Set(physical.semanticRefs.map((id) => semanticById.get(id)?.relationKind))
    if (physical.relationKind !== 'transition' || referencedKinds.size !== 1 || !referencedKinds.has('transition')) {
      violations.push(physical.id)
    }
  }
  return { pass: violations.length === 0, count: violations.length, violations }
}

function inspectPaths(model, result) {
  const errors = []
  const byId = cellMap(model)
  const physicalById = new Map(result.physicalEdges.map((edge) => [edge.id, edge]))
  const canonicalIds = new Set(USERJOURNEY_SEMANTIC_CONTRACT.edges.map(({ id }) => id))
  const mappingKeys = Object.keys(result.semanticToPhysical)
  if (!exactSet(mappingKeys, [...canonicalIds])) errors.push('mapping:exact-key-set')
  for (const semantic of result.semanticEdges) {
    const ids = result.semanticToPhysical[semantic.id] ?? []
    if (ids.length === 0 || new Set(ids).size !== ids.length) {
      errors.push(`${semantic.id}:empty-or-duplicate-path`)
      continue
    }
    let current = semantic.sourceId
    const visited = new Set([current])
    for (const id of ids) {
      const physical = physicalById.get(id)
      if (!physical) {
        errors.push(`${semantic.id}:missing:${id}`)
        break
      }
      const next = physical.sourceId === current ? physical.targetId : physical.targetId === current ? physical.sourceId : null
      if (!next) {
        errors.push(`${semantic.id}:disconnected:${id}`)
        break
      }
      if (visited.has(next)) {
        errors.push(`${semantic.id}:cycle:${next}`)
        break
      }
      if (next !== semantic.targetId && byId.get(next)?.style.pokeKind !== 'junction') {
        errors.push(`${semantic.id}:foreign-terminal:${next}`)
        break
      }
      visited.add(next)
      current = next
    }
    if (current !== semantic.targetId) errors.push(`${semantic.id}:ends-at:${current}`)
  }
  const refErrors = []
  for (const physical of result.physicalEdges) {
    const expected = Object.entries(result.semanticToPhysical)
      .filter(([, ids]) => ids.includes(physical.id)).map(([id]) => id).sort()
    if (physical.semanticRefs.length === 0 || !exactSet(physical.semanticRefs, expected)
      || physical.semanticRefs.some((id) => !canonicalIds.has(id))) refErrors.push(physical.id)
  }
  if (refErrors.length > 0) errors.push(...refErrors.map((id) => `ref:${id}`))
  return { pass: errors.length === 0, errors }
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

function sharedTerminal(left, right) {
  return [left.sourceId, left.targetId].find((id) => id === right.sourceId || id === right.targetId) ?? null
}

function classifyPair(left, right, byId) {
  const leftHorizontal = isHorizontal(left)
  const rightHorizontal = isHorizontal(right)
  if ((!leftHorizontal && !isVertical(left)) || (!rightHorizontal && !isVertical(right))) return null
  if (leftHorizontal === rightHorizontal) {
    const gap = leftHorizontal ? Math.abs(left.start.y - right.start.y) : Math.abs(left.start.x - right.start.x)
    const overlap = leftHorizontal
      ? projectionOverlap(left.start.x, left.end.x, right.start.x, right.end.x)
      : projectionOverlap(left.start.y, left.end.y, right.start.y, right.end.y)
    if (overlap > EPS && gap <= EPS) return 'collinear-overlap'
    if (overlap > EPS && gap > EPS && gap < USERJOURNEY_POLICY.LANE_GAP) return 'near-parallel'
    return null
  }
  const horizontal = leftHorizontal ? left : right
  const vertical = leftHorizontal ? right : left
  const intersection = { x: vertical.start.x, y: horizontal.start.y }
  if (!between(intersection.x, horizontal.start.x, horizontal.end.x)
    || !between(intersection.y, vertical.start.y, vertical.end.y)) return null
  const common = sharedTerminal(left, right)
  if (common && pointEquals(intersection, centerOf(byId.get(common)))) return null
  const horizontalInterior = between(intersection.x, horizontal.start.x, horizontal.end.x, true)
  const verticalInterior = between(intersection.y, vertical.start.y, vertical.end.y, true)
  if (horizontalInterior && verticalInterior) return 'x-crossing'
  if (horizontalInterior || verticalInterior) return 't-junction'
  return 'endpoint-touch'
}

function inspectGeometry(model, result, segments) {
  const byId = cellMap(model)
  const endpointViolations = []
  let maximumErrorPx = 0
  for (const segment of segments) {
    const startError = segment.expectedStart ? distance(segment.start, segment.expectedStart) : Number.POSITIVE_INFINITY
    const endError = segment.expectedEnd ? distance(segment.end, segment.expectedEnd) : Number.POSITIVE_INFINITY
    maximumErrorPx = Math.max(maximumErrorPx, startError, endError)
    if (startError > EPS || endError > EPS) endpointViolations.push({ id: segment.id, startError, endError })
  }
  const nonOrthogonal = segments.filter((segment) => !isHorizontal(segment) && !isVertical(segment)).map(({ id }) => id)
  const nodeViolations = []
  const vertices = semanticJourneyVertices(model)
  for (const segment of segments) {
    const terminals = new Set([segment.sourceId, segment.targetId])
    for (const vertex of vertices) {
      if (terminals.has(vertex.id)) continue
      if (segmentIntersectsExpandedBounds(segment, boundsOf(vertex), USERJOURNEY_POLICY.NODE_CLEARANCE)) {
        nodeViolations.push(`${segment.id}→${vertex.id}`)
      }
    }
  }
  const intersections = []
  for (let leftIndex = 0; leftIndex < segments.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < segments.length; rightIndex += 1) {
      const classification = classifyPair(segments[leftIndex], segments[rightIndex], byId)
      if (classification) {
        const left = segments[leftIndex]
        const right = segments[rightIndex]
        const horizontal = isHorizontal(left) ? left : right
        const vertical = isHorizontal(left) ? right : left
        const pointValue = isHorizontal(horizontal) && isVertical(vertical)
          ? { x: vertical.start.x, y: horizontal.start.y }
          : null
        intersections.push({ classification, left: left.id, right: right.id, point: pointValue })
      }
    }
  }
  const overlaps = intersections.filter(({ classification }) => ['collinear-overlap', 'near-parallel'].includes(classification))
  const crossings = intersections.filter(({ classification }) => !['collinear-overlap', 'near-parallel'].includes(classification))
  const incidentsByJunction = new Map(result.junctions.map(({ id }) => [id, []]))
  for (const segment of segments) {
    const topologySegment = {
      ...segment,
      start: segment.expectedStart ?? segment.start,
      end: segment.expectedEnd ?? segment.end,
    }
    if (incidentsByJunction.has(segment.sourceId)) incidentsByJunction.get(segment.sourceId).push(topologySegment)
    if (incidentsByJunction.has(segment.targetId)) incidentsByJunction.get(segment.targetId).push(topologySegment)
  }
  const fourWayJunctions = []
  const junctionById = new Map(result.junctions.map((junction) => [junction.id, junction]))
  for (const [junctionId, incidents] of incidentsByJunction) {
    const horizontal = incidents.filter(isHorizontal)
    const vertical = incidents.filter(isVertical)
    if (horizontal.length >= 2 && vertical.length >= 2) {
      const junction = junctionById.get(junctionId)
      fourWayJunctions.push({ junctionId, x: junction?.x, y: junction?.y, incidentIds: incidents.map(({ id }) => id).sort() })
    }
  }
  const physicalById = new Map(result.physicalEdges.map((edge) => [edge.id, edge]))
  const crossingKeys = crossings.map(({ classification, left, right, point: pointValue }) => {
    const refPair = [physicalById.get(left)?.semanticRefs.join('+') ?? left, physicalById.get(right)?.semanticRefs.join('+') ?? right]
      .sort().join('|')
    return pointValue ? `${classification}:${pointValue.x},${pointValue.y}:${refPair}` : `${classification}:${refPair}`
  }).sort()
  const overlapKeys = overlaps.map(({ classification, left, right }) => `${classification}:${left}|${right}`).sort()
  return {
    endpoints: { pass: endpointViolations.length === 0, maximumErrorPx, violations: endpointViolations },
    orthogonal: { pass: nonOrthogonal.length === 0, violations: nonOrthogonal },
    nodeClearance: { pass: nodeViolations.length === 0, violations: nodeViolations },
    edgeCrossing: {
      pass: JSON.stringify(crossingKeys) === JSON.stringify([...USERJOURNEY_POLICY.expectedCrossings]),
      count: crossingKeys.length,
      allowlist: USERJOURNEY_POLICY.expectedCrossings,
      violations: crossings,
    },
    overlap: {
      pass: JSON.stringify(overlapKeys) === JSON.stringify([...USERJOURNEY_POLICY.expectedOverlaps]),
      count: overlapKeys.length,
      allowlist: USERJOURNEY_POLICY.expectedOverlaps,
      violations: overlaps,
    },
    junctionTopology: { pass: fourWayJunctions.length === 0, violations: fourWayJunctions },
  }
}

// inspectLayout는 semantic 정점만 canonical과 대조한다.
// decoration(overlay/annotation)은 비-obstacle이라 위치 게이트는 annotationBand만 담당한다(조건1 독립성).
function inspectLayout(model) {
  const base = cloneModel(model)
  base.cells = base.cells.filter((cell) => !['junction', 'physical'].includes(cell.style.pokeKind))
  try {
    const canonical = normalizeUserJourneySource(base).model
    const canonicalById = cellMap(canonical)
    const violations = []
    for (const cell of semanticJourneyVertices(base)) {
      const canonicalCell = canonicalById.get(cell.id)
      if (JSON.stringify(cell.geometry.attributes) !== JSON.stringify(canonicalCell.geometry.attributes)) {
        violations.push(cell.id)
      }
    }
    return { pass: violations.length === 0, violations }
  } catch (error) {
    return { pass: false, violations: [error instanceof Error ? error.message : String(error)] }
  }
}

function directionMatches(side, start, end, terminalRole) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  if (terminalRole === 'source') {
    return side === 'left' && dx < -EPS || side === 'right' && dx > EPS
      || side === 'top' && dy < -EPS || side === 'bottom' && dy > EPS
  }
  return side === 'left' && dx > EPS || side === 'right' && dx < -EPS
    || side === 'top' && dy > EPS || side === 'bottom' && dy < -EPS
}

function inspectDirections(segments) {
  const violations = []
  for (const segment of segments) {
    if (segment.sourceTerminal && !directionMatches(segment.sourceSide, segment.start, segment.end, 'source')) {
      violations.push(`${segment.id}:source`)
    }
    if (segment.targetTerminal && !directionMatches(segment.targetSide, segment.start, segment.end, 'target')) {
      violations.push(`${segment.id}:target`)
    }
  }
  return { pass: violations.length === 0, violations }
}

function compactPoints(points) {
  const result = []
  for (const pointValue of points) {
    if (result.length > 0 && pointEquals(result.at(-1), pointValue)) continue
    while (result.length >= 2) {
      const previous = result.at(-2)
      const current = result.at(-1)
      const collinear = Math.abs(previous.x - current.x) <= EPS && Math.abs(current.x - pointValue.x) <= EPS
        || Math.abs(previous.y - current.y) <= EPS && Math.abs(current.y - pointValue.y) <= EPS
      if (!collinear) break
      result.pop()
    }
    result.push(pointValue)
  }
  return result
}

function semanticRouteMetrics(result, segments) {
  const segmentById = new Map(segments.map((segment) => [segment.id, segment]))
  const perEdge = []
  for (const semantic of result.semanticEdges) {
    let currentId = semantic.sourceId
    const points = []
    for (const physicalId of result.semanticToPhysical[semantic.id] ?? []) {
      const segment = segmentById.get(physicalId)
      if (!segment) continue
      const forward = segment.sourceId === currentId
      const start = forward ? segment.start : segment.end
      const end = forward ? segment.end : segment.start
      if (points.length === 0) points.push(start)
      points.push(end)
      currentId = forward ? segment.targetId : segment.sourceId
    }
    const compacted = compactPoints(points)
    const routedLength = compacted.slice(1).reduce((total, pointValue, index) =>
      total + Math.abs(pointValue.x - compacted[index].x) + Math.abs(pointValue.y - compacted[index].y), 0)
    const directDistance = compacted.length < 2 ? 0
      : Math.abs(compacted.at(-1).x - compacted[0].x) + Math.abs(compacted.at(-1).y - compacted[0].y)
    const detourRatio = directDistance === 0 ? Number.POSITIVE_INFINITY : routedLength / directDistance
    perEdge.push({ id: semantic.id, bends: Math.max(0, compacted.length - 2), directDistance, routedLength, detourRatio })
  }
  return perEdge
}

function round6(value) {
  if (!Number.isFinite(value)) return Number.MAX_SAFE_INTEGER
  return Math.round(value * 1_000_000) / 1_000_000
}

function physicalBendCount(result, segments) {
  const incidents = new Map(result.junctions.map(({ id }) => [id, []]))
  for (const segment of segments) {
    if (incidents.has(segment.sourceId)) incidents.get(segment.sourceId).push(segment)
    if (incidents.has(segment.targetId)) incidents.get(segment.targetId).push(segment)
  }
  return [...incidents.values()].filter((items) => items.some(isHorizontal) && items.some(isVertical)).length
}

function buildMetrics(result, segments, validation, directions) {
  const routeMetrics = semanticRouteMetrics(result, segments)
  const microSegments = segments.filter(({ length }) => length < 16 - EPS)
  const maxDetour = routeMetrics.reduce((maximum, item) => Math.max(maximum, item.detourRatio), 0)
  return {
    metrics: {
      endpointMaximumErrorPx: round6(validation.endpoints.maximumErrorPx),
      nonCentralPortCount: validation.endpoints.violations.length,
      directionViolationCount: directions.violations.length,
      terminalReentryCount: 0,
      nodePenetrationCount: validation.nodeClearance.violations.length,
      crossingCount: validation.edgeCrossing.count,
      overlapCount: validation.overlap.count,
      degree4XCount: validation.junctionTopology.violations.length,
      microSegmentCount: microSegments.length,
      totalSemanticBendCount: routeMetrics.reduce((total, item) => total + item.bends, 0),
      maxSemanticBendCount: routeMetrics.reduce((maximum, item) => Math.max(maximum, item.bends), 0),
      physicalTotalBendCount: physicalBendCount(result, segments),
      maxDetourRatio: round6(maxDetour),
      labelUnavailableCount: 0,
      labelOutsideCount: 0,
    },
    routeMetrics,
  }
}

function scorePhysicalUserJourney(result, metrics, routeMetrics) {
  const totalLength = routeMetrics.reduce((total, item) => total + item.routedLength, 0)
  const totalRatio = round6(routeMetrics.reduce((total, item) => total + item.detourRatio, 0))
  const edgeCountOverTarget = routeMetrics.filter((item) => item.bends > 3).length
  const score = {
    edgeCountOverProfileBendTarget: edgeCountOverTarget,
    maxSemanticEdgeBendCount: metrics.maxSemanticBendCount,
    totalSemanticEdgeBendCount: metrics.totalSemanticBendCount,
    physicalTotalBendCount: metrics.physicalTotalBendCount,
    maxPortDirectionPenalty: metrics.directionViolationCount,
    totalPortDirectionPenalty: metrics.directionViolationCount,
    maxDetourRatio: metrics.maxDetourRatio,
    totalDetourRatio: totalRatio,
    totalManhattanLength: round6(totalLength),
    canonicalTieKey: result.physicalEdges.map(({ id }) => id).sort().join('|'),
  }
  score.tuple = [
    score.edgeCountOverProfileBendTarget,
    score.maxSemanticEdgeBendCount,
    score.totalSemanticEdgeBendCount,
    score.physicalTotalBendCount,
    score.maxPortDirectionPenalty,
    score.totalPortDirectionPenalty,
    score.maxDetourRatio,
    score.totalDetourRatio,
    score.totalManhattanLength,
  ]
  return score
}

export function validatePhysicalUserJourney(model, result) {
  const segments = physicalSegments(model, result)
  const validation = {
    semanticContract: inspectSemanticContract(result),
    modelResult: inspectModelResult(model, result),
    paths: inspectPaths(model, result),
    physicalRelationKinds: inspectPhysicalRelationKinds(result),
    ...inspectGeometry(model, result, segments),
    layout: inspectLayout(model),
    decorationPartition: inspectDecorationPartition(model, result),
    annotationBand: inspectAnnotationBand(model),
    labelClearance: { status: 'deferred-to-browser' },
  }
  const directions = inspectDirections(segments)
  const { metrics, routeMetrics } = buildMetrics(result, segments, validation, directions)
  validation.metrics = metrics
  validation.directions = directions
  const failed = Object.entries(validation)
    .filter(([, value]) => Object.hasOwn(value, 'pass') && value.pass === false)
    .map(([key]) => key)
  if (failed.length > 0) {
    const error = new Error(`User Journey physical route 검증 실패: ${failed.join(', ')}`)
    error.validation = validation
    throw error
  }
  const score = scorePhysicalUserJourney(result, metrics, routeMetrics)
  return { segments, validation, score }
}
