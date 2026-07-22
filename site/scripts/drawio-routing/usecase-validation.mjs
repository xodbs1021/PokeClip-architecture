import {
  USECASE_POLICY,
  USECASE_SEMANTIC_CONTRACT,
  boundsOf,
  centerOf,
  normalizeUseCaseSource,
  semanticUseCaseEdges,
  semanticUseCaseVertices,
  listUseCaseDecorationCells,
} from './usecase-layout.mjs'
import { physicalEndpoints } from './usecase-router.mjs'
import { cellMap, cloneModel } from './xml-model.mjs'

const EPS = USECASE_POLICY.EPS

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
  const expectedVertices = [...USECASE_SEMANTIC_CONTRACT.actorIds, ...USECASE_SEMANTIC_CONTRACT.useCaseIds]
  const expectedEdges = USECASE_SEMANTIC_CONTRACT.edges.map(semanticTuple)
  const actualEdges = result.semanticEdges.map(semanticTuple)
  const relationKinds = result.semanticEdges.reduce((counts, edge) => {
    counts[edge.relationKind] = (counts[edge.relationKind] ?? 0) + 1
    return counts
  }, {})
  const errors = []
  if (!exactSet(result.semanticVertices, expectedVertices)) errors.push('vertices')
  if (!exactSet(actualEdges, expectedEdges)) errors.push('typed-edge-tuples')
  if (relationKinds.actor !== 19 || relationKinds.feature !== 7 || Object.keys(relationKinds).length !== 2) errors.push('relationKind-counts')
  return { pass: errors.length === 0, errors, vertexCount: result.semanticVertices.length, edgeCount: result.semanticEdges.length, relationKinds }
}

function inspectDecorationPartition(model, result) {
  const modelDecorationIds = listUseCaseDecorationCells(model).map(({ id }) => id)
  const errors = []
  if (!exactSet(modelDecorationIds, USECASE_SEMANTIC_CONTRACT.decorationIds)) errors.push('model-decoration-ids')
  if (!exactSet(result.decorations, USECASE_SEMANTIC_CONTRACT.decorationIds)) errors.push('result-decoration-ids')
  const interactiveDecorations = model.cells.filter((cell) => cell.style.pokeKind === 'decoration'
    && (cell.style.pointerEvents === '1' || cell.style.pokeSemanticRole))
  if (interactiveDecorations.length > 0) errors.push(...interactiveDecorations.map(({ id }) => `interactive:${id}`))
  return { pass: errors.length === 0, errors, count: modelDecorationIds.length }
}

function inspectModelResult(model, result) {
  const errors = []
  const byId = cellMap(model)
  const canonicalVertices = new Set([...USECASE_SEMANTIC_CONTRACT.actorIds, ...USECASE_SEMANTIC_CONTRACT.useCaseIds])
  const canonicalEdges = new Set(USECASE_SEMANTIC_CONTRACT.edges.map(({ id }) => id))
  const canonicalDecorations = new Set(USECASE_SEMANTIC_CONTRACT.decorationIds)
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
  const modelSemantic = semanticUseCaseEdges(model).map((edge) => semanticTuple({
    id: edge.id, sourceId: edge.attributes.source, targetId: edge.attributes.target,
    relationKind: edge.style.pokeRelationKind,
  }))
  if (!exactSet(modelSemantic, result.semanticEdges.map(semanticTuple))) errors.push('semantic-edges')
  if (!exactSet(semanticUseCaseVertices(model).map(({ id }) => id), result.semanticVertices)) errors.push('semantic-vertices')
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
    if (!['actor', 'feature'].includes(physical.relationKind)
      || referencedKinds.size !== 1 || !referencedKinds.has(physical.relationKind)) {
      violations.push(physical.id)
    }
  }
  return { pass: violations.length === 0, count: violations.length, violations }
}

function inspectPaths(model, result) {
  const errors = []
  const byId = cellMap(model)
  const physicalById = new Map(result.physicalEdges.map((edge) => [edge.id, edge]))
  const canonicalIds = new Set(USECASE_SEMANTIC_CONTRACT.edges.map(({ id }) => id))
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
    if (overlap > EPS && gap > EPS && gap < USECASE_POLICY.LANE_GAP) return 'near-parallel'
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
  const vertices = semanticUseCaseVertices(model)
  for (const segment of segments) {
    const terminals = new Set([segment.sourceId, segment.targetId])
    for (const vertex of vertices) {
      if (terminals.has(vertex.id)) continue
      if (segmentIntersectsExpandedBounds(segment, boundsOf(vertex), USECASE_POLICY.NODE_CLEARANCE)) {
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
        const point = isHorizontal(horizontal) && isVertical(vertical)
          ? { x: vertical.start.x, y: horizontal.start.y }
          : null
        intersections.push({ classification, left: left.id, right: right.id, point })
      }
    }
  }
  const overlaps = intersections.filter(({ classification }) => ['collinear-overlap', 'near-parallel'].includes(classification))
  const crossings = intersections.filter(({ classification }) => !['collinear-overlap', 'near-parallel'].includes(classification))
  const incidentsByJunction = new Map(result.junctions.map(({ id }) => [id, []]))
  const semanticById = new Map(result.semanticEdges.map((edge) => [edge.id, edge]))
  for (const segment of segments) {
    if (incidentsByJunction.has(segment.sourceId)) incidentsByJunction.get(segment.sourceId).push(segment)
    if (incidentsByJunction.has(segment.targetId)) incidentsByJunction.get(segment.targetId).push(segment)
  }
  const unrelatedJunctions = new Map()
  const fourWayJunctions = []
  const junctionById = new Map(result.junctions.map((junction) => [junction.id, junction]))
  for (const [junctionId, incidents] of incidentsByJunction) {
    const horizontal = incidents.filter(isHorizontal)
    const vertical = incidents.filter(isVertical)
    if (horizontal.length >= 2 && vertical.length >= 2) {
      const junction = junctionById.get(junctionId)
      fourWayJunctions.push({ junctionId, x: junction?.x, y: junction?.y, incidentIds: incidents.map(({ id }) => id).sort() })
    }
    for (const horizontalSegment of horizontal) {
      for (const verticalSegment of vertical) {
        const sharedRefs = horizontalSegment.semanticRefs.filter((id) => verticalSegment.semanticRefs.includes(id))
        const allRefs = [...horizontalSegment.semanticRefs, ...verticalSegment.semanticRefs]
        const referencedEdges = allRefs.map((id) => semanticById.get(id))
        const everyRefIsKnown = referencedEdges.every(Boolean)
        const actorFamilies = [...new Set(referencedEdges
          .filter((edge) => edge?.relationKind === 'actor')
          .map(({ sourceId }) => sourceId))]
        const everyRefIsSameActorFamily = everyRefIsKnown && actorFamilies.length === 1
          && allRefs
            .every((id) => semanticById.get(id)?.sourceId === actorFamilies[0])
        const commonSemanticTerminal = everyRefIsKnown && referencedEdges.length > 0
          ? referencedEdges.map((edge) => new Set([edge.sourceId, edge.targetId]))
            .reduce((left, right) => new Set([...left].filter((id) => right.has(id)))).size > 0
          : false
        const sameActorTBranch = incidents.length <= 3 && everyRefIsSameActorFamily
        const commonTerminalTBranch = incidents.length <= 3 && commonSemanticTerminal
        if (sharedRefs.length === 0 && !sameActorTBranch && !commonTerminalTBranch) {
          const junction = junctionById.get(junctionId)
          const refPair = [horizontalSegment.semanticRefs.join('+'), verticalSegment.semanticRefs.join('+')].sort().join('|')
          const key = `unrelated-junction-crossing:${junction.x},${junction.y}:${refPair}`
          if (!unrelatedJunctions.has(key)) unrelatedJunctions.set(key, {
            key,
            classification: 'unrelated-junction-crossing',
            left: horizontalSegment.id,
            right: verticalSegment.id,
            junctionId,
            semanticRefPair: refPair,
          })
        }
      }
    }
  }
  crossings.push(...unrelatedJunctions.values())
  const physicalById = new Map(result.physicalEdges.map((edge) => [edge.id, edge]))
  const crossingKeys = crossings.map(({ key, classification, left, right, point }) => {
    if (key) return key
    const refPair = [physicalById.get(left)?.semanticRefs.join('+') ?? left, physicalById.get(right)?.semanticRefs.join('+') ?? right]
      .sort().join('|')
    return point ? `${classification}:${point.x},${point.y}:${refPair}` : `${classification}:${refPair}`
  }).sort()
  const overlapKeys = overlaps.map(({ classification, left, right }) => `${classification}:${left}|${right}`).sort()
  return {
    endpoints: { pass: endpointViolations.length === 0, maximumErrorPx, violations: endpointViolations },
    orthogonal: { pass: nonOrthogonal.length === 0, violations: nonOrthogonal },
    nodeClearance: { pass: nodeViolations.length === 0, violations: nodeViolations },
    edgeCrossing: {
      pass: JSON.stringify(crossingKeys) === JSON.stringify([...USECASE_POLICY.expectedCrossings]),
      count: crossingKeys.length,
      allowlist: USECASE_POLICY.expectedCrossings,
      violations: crossings,
    },
    overlap: {
      pass: JSON.stringify(overlapKeys) === JSON.stringify([...USECASE_POLICY.expectedOverlaps]),
      count: overlapKeys.length,
      allowlist: USECASE_POLICY.expectedOverlaps,
      violations: overlaps,
    },
    junctionTopology: { pass: fourWayJunctions.length === 0, violations: fourWayJunctions },
  }
}

function inspectLayout(model) {
  const base = cloneModel(model)
  base.cells = base.cells.filter((cell) => !['junction', 'physical'].includes(cell.style.pokeKind))
  try {
    const canonical = normalizeUseCaseSource(base).model
    const canonicalById = cellMap(canonical)
    const violations = []
    for (const cell of [...semanticUseCaseVertices(base), ...listUseCaseDecorationCells(base)]) {
      if (JSON.stringify(cell.geometry.attributes) !== JSON.stringify(canonicalById.get(cell.id).geometry.attributes)) {
        violations.push(cell.id)
      }
    }
    return { pass: violations.length === 0, violations, columns: [380, 1120, 1860] }
  } catch (error) {
    return { pass: false, violations: [error instanceof Error ? error.message : String(error)], columns: [380, 1120, 1860] }
  }
}

function inspectActorSpines(result) {
  const errors = []
  const actorKeys = Object.keys(result.actorSpines ?? {})
  if (!exactSet(actorKeys, USECASE_SEMANTIC_CONTRACT.actorIds)) errors.push('actorSpines:exact-key-set')
  const physicalById = new Map(result.physicalEdges.map((edge) => [edge.id, edge]))
  const allStemIds = result.physicalEdges.filter(({ role }) => role === 'stem').map(({ id }) => id)
  if (allStemIds.length !== 3) errors.push(`actorSpines:stem-cardinality:${allStemIds.length}`)
  for (const actorId of USECASE_SEMANTIC_CONTRACT.actorIds) {
    const metadata = result.actorSpines?.[actorId]
    if (!metadata) continue
    const expectedSemanticIds = result.semanticEdges
      .filter(({ sourceId, relationKind }) => sourceId === actorId && relationKind === 'actor').map(({ id }) => id)
    if (!exactSet(metadata.semanticEdgeIds, expectedSemanticIds)) errors.push(`actorSpines:semantic-ids:${actorId}`)
    const stem = physicalById.get(metadata.stemId)
    if (!stem || stem.role !== 'stem' || stem.group !== actorId.replace(/^ac-/, '')) errors.push(`actorSpines:stem:${actorId}`)
    const expectedSpines = result.physicalEdges.filter(({ group, role }) => group === actorId.replace(/^ac-/, '') && role === 'spine').map(({ id }) => id)
    if (expectedSpines.length === 0 || !exactSet(metadata.spineIds, expectedSpines)) errors.push(`actorSpines:spine:${actorId}`)
    for (const semanticId of expectedSemanticIds) {
      const path = result.semanticToPhysical[semanticId] ?? []
      if (!path.includes(metadata.stemId) || !path.some((id) => metadata.spineIds.includes(id))) {
        errors.push(`actorSpines:path:${semanticId}`)
      }
    }
  }
  const stemSet = new Set(allStemIds)
  for (const semantic of result.semanticEdges.filter(({ relationKind }) => relationKind === 'feature')) {
    if ((result.semanticToPhysical[semantic.id] ?? []).some((id) => stemSet.has(id))) errors.push(`actorSpines:feature-stem:${semantic.id}`)
  }
  return { pass: errors.length === 0, errors, stemIds: allStemIds }
}

export function validatePhysicalUseCase(model, result) {
  const segments = physicalSegments(model, result)
  const validation = {
    semanticContract: inspectSemanticContract(result),
    modelResult: inspectModelResult(model, result),
    paths: inspectPaths(model, result),
    physicalRelationKinds: inspectPhysicalRelationKinds(result),
    ...inspectGeometry(model, result, segments),
    layout: inspectLayout(model),
    actorSpines: inspectActorSpines(result),
    decorationPartition: inspectDecorationPartition(model, result),
    labelClearance: { status: 'deferred-to-browser' },
  }
  const failed = Object.entries(validation)
    .filter(([, value]) => Object.hasOwn(value, 'pass') && value.pass === false)
    .map(([key]) => key)
  if (failed.length > 0) {
    const error = new Error(`Use Case physical route 검증 실패: ${failed.join(', ')}`)
    error.validation = validation
    throw error
  }
  return { segments, validation }
}
