import type {
  DrawioBounds,
  DrawioEdgeGeometry,
  DrawioGeometrySnapshot,
  DrawioPoint,
  DrawioScene,
} from './mountDrawioScene'
import { inspectSemanticLabelEnvelopes } from './semanticLabelEnvelope'
import semanticContractJson from '../../../shared/ia-semantic-contract.json?raw'
import useCaseContractJson from '../../../shared/usecase-semantic-contract.json?raw'
import userJourneyContractJson from '../../../shared/userjourney-semantic-contract.json?raw'

export interface DrawioDiagnostic {
  readonly id: string
  readonly label: string
  readonly pass: boolean
  readonly detail: string
}

const EPSILON = 1
const IA_SEMANTIC_CONTRACT = JSON.parse(semanticContractJson) as {
  readonly vertexIds: readonly string[]
  readonly edgeTuples: readonly string[]
}
interface UseCaseContractEdge {
  readonly id: string
  readonly sourceId: string
  readonly targetId: string
  readonly relationKind: 'actor' | 'feature'
}

const USE_CASE_CONTRACT = JSON.parse(useCaseContractJson) as {
  readonly actorIds: readonly string[]
  readonly useCaseIds: readonly string[]
  readonly decorationIds: readonly string[]
  readonly useCases: readonly { readonly id: string; readonly groupId: string }[]
  readonly decorations: readonly { readonly id: string; readonly decorationKind: 'system' | 'group' }[]
  readonly edges: readonly UseCaseContractEdge[]
}

const USER_JOURNEY_CONTRACT = JSON.parse(userJourneyContractJson) as {
  readonly nodeIds: readonly string[]
  readonly decorationIds: readonly string[]
  readonly edges: readonly {
    readonly id: string
    readonly sourceId: string
    readonly targetId: string
    readonly relationKind: 'transition'
  }[]
}

function interactiveVertexCount(scene: DrawioScene) {
  return scene.svg.querySelectorAll('[data-cell-kind="vertex"][data-cell-interactive="true"]').length
}

function boundsById(snapshot: DrawioGeometrySnapshot) {
  return new Map([
    ...snapshot.vertices.map((vertex) => [vertex.id, vertex.bounds] as const),
    ...snapshot.junctions.map((junction) => [junction.id, { ...junction.point, width: 0, height: 0 }] as const),
  ])
}

function sameIds(actualIds: readonly string[], expectedIds: ReadonlySet<string>) {
  const actual = new Set(actualIds)
  return actual.size === actualIds.length
    && actual.size === expectedIds.size
    && [...expectedIds].every((id) => actual.has(id))
}

function snapshotTopologyIntegrity(scene: DrawioScene, snapshot: DrawioGeometrySnapshot) {
  const tagged = snapshot.vertices.some(({ pokeKind }) => pokeKind !== null)
  const semanticVertices = snapshot.vertices.filter(({ pokeKind }) => !tagged || pokeKind === 'semantic')
  const vertexIdsMatch = sameIds(semanticVertices.map(({ id }) => id), scene.topology.vertexIds)
  const edgeIdsMatch = sameIds(snapshot.edges.map(({ id }) => id), scene.topology.physicalEdgeIds)
  const terminalMismatches = snapshot.edges.flatMap((edge) => {
    return scene.topology.physicalEdgeIds.has(edge.id) ? [] : [`${edge.id}:${edge.sourceId}→${edge.targetId}`]
  })
  return {
    pass: vertexIdsMatch && edgeIdsMatch && terminalMismatches.length === 0,
    detail: `snapshot semantic vertex ${semanticVertices.length}/${scene.topology.vertexIds.size} · rendered vertex ${snapshot.vertices.length} · semantic edge ${scene.topology.edgeIds.size} · physical edge ${snapshot.edges.length}/${scene.topology.physicalEdgeIds.size} · terminal mismatch ${terminalMismatches.length}`,
  }
}

function expectedPoint(bounds: DrawioBounds, x: number, y: number): DrawioPoint {
  return { x: bounds.x + bounds.width * x, y: bounds.y + bounds.height * y }
}

function pointError(actual: DrawioPoint, expected: DrawioPoint) {
  return Math.max(Math.abs(actual.x - expected.x), Math.abs(actual.y - expected.y))
}

function endpointError(snapshot: DrawioGeometrySnapshot) {
  const vertices = boundsById(snapshot)
  let maximum = 0
  for (const edge of snapshot.edges) {
    const source = vertices.get(edge.sourceId)
    const target = vertices.get(edge.targetId)
    const first = edge.points[0]
    const last = edge.points.at(-1)
    if (!source || !target || !first || !last) return Infinity
    const sourceExpected = expectedPoint(source, Number(edge.style.exitX), Number(edge.style.exitY))
    const targetExpected = expectedPoint(target, Number(edge.style.entryX), Number(edge.style.entryY))
    maximum = Math.max(maximum, pointError(first, sourceExpected), pointError(last, targetExpected))
  }
  return maximum
}

function nonOrthogonalSegments(snapshot: DrawioGeometrySnapshot) {
  return snapshot.edges.flatMap((edge) => edge.points.slice(1).flatMap((point, index) => {
    const previous = edge.points[index]
    const diagonal = Math.abs(point.x - previous.x) > EPSILON && Math.abs(point.y - previous.y) > EPSILON
    return diagonal ? [`${edge.id}[${index}]`] : []
  }))
}

function segmentCrossesOpenBounds(start: DrawioPoint, end: DrawioPoint, bounds: DrawioBounds) {
  const right = bounds.x + bounds.width
  const bottom = bounds.y + bounds.height
  if (Math.abs(start.x - end.x) <= EPSILON) {
    const low = Math.min(start.y, end.y)
    const high = Math.max(start.y, end.y)
    return start.x > bounds.x + EPSILON && start.x < right - EPSILON && high > bounds.y + EPSILON && low < bottom - EPSILON
  }
  if (Math.abs(start.y - end.y) <= EPSILON) {
    const low = Math.min(start.x, end.x)
    const high = Math.max(start.x, end.x)
    return start.y > bounds.y + EPSILON && start.y < bottom - EPSILON && high > bounds.x + EPSILON && low < right - EPSILON
  }
  return true
}

function leafCrossings(snapshot: DrawioGeometrySnapshot) {
  const leaves = snapshot.vertices.filter(({ childCount }) => childCount === 0)
  const crossings: string[] = []
  for (const edge of snapshot.edges) {
    const terminals = new Set([edge.sourceId, edge.targetId])
    for (const leaf of leaves) {
      if (terminals.has(leaf.id)) continue
      const crosses = edge.points.slice(1).some((point, index) =>
        segmentCrossesOpenBounds(edge.points[index], point, leaf.bounds),
      )
      if (crosses) crossings.push(`${edge.id}→${leaf.id}`)
    }
  }
  return crossings
}

function smokeCodecDiagnostic(edge: DrawioEdgeGeometry | undefined): DrawioDiagnostic {
  const style = edge?.style
  const pass = edge?.sourceId === 'smoke-source' && edge.targetId === 'smoke-target'
    && style?.edgeStyle === 'orthogonalEdgeStyle' && style.exitX === 1 && style.exitY === 0.5
    && style.entryX === 0 && style.entryY === 0.5
  return {
    id: 'smoke-codec',
    label: 'codec ID·terminal·port style',
    pass,
    detail: pass ? 'critical fields 보존' : 'critical fields 손실',
  }
}

export function runSmokeDiagnostics(
  scene: DrawioScene,
  snapshot: DrawioGeometrySnapshot,
): readonly DrawioDiagnostic[] {
  const integrity = snapshotTopologyIntegrity(scene, snapshot)
  const endpoint = endpointError(snapshot)
  const diagonals = nonOrthogonalSegments(snapshot)
  return [
    {
      id: 'smoke-dom',
      label: '공개 CellState SVG 매핑',
      pass: integrity.pass && interactiveVertexCount(scene) === 2 && snapshot.edges.length === 1,
      detail: `interactive vertex ${interactiveVertexCount(scene)} · ${integrity.detail}`,
    },
    smokeCodecDiagnostic(snapshot.edges[0]),
    {
      id: 'smoke-ports',
      label: '좌→우 중앙 포트',
      pass: endpoint <= EPSILON,
      detail: `최대 오차 ${Number.isFinite(endpoint) ? endpoint.toFixed(2) : '∞'}px`,
    },
    {
      id: 'smoke-orthogonal',
      label: '직교 segment',
      pass: diagonals.length === 0,
      detail: `비직교 ${diagonals.length}개`,
    },
  ]
}

function childContainmentDiagnostic(snapshot: DrawioGeometrySnapshot): DrawioDiagnostic {
  const container = snapshot.vertices.find(({ id }) => id === 'routing-container')?.bounds
  const child = snapshot.vertices.find(({ id }) => id === 'routing-container-child')?.bounds
  const pass = Boolean(container && child
    && child.x >= container.x && child.y >= container.y
    && child.x + child.width <= container.x + container.width
    && child.y + child.height <= container.y + container.height)
  return {
    id: 'routing-container',
    label: 'container/child 경계',
    pass,
    detail: pass ? 'child가 container 내부' : 'child가 container 밖',
  }
}

function topologyDiagnostic(scene: DrawioScene, snapshot: DrawioGeometrySnapshot): DrawioDiagnostic {
  const integrity = snapshotTopologyIntegrity(scene, snapshot)
  const adjacent = scene.topology.adjacentTo('routing-focus')
  const vertices = [...adjacent.vertexIds].sort().join(',')
  const edges = [...adjacent.edgeIds].sort().join(',')
  const pass = integrity.pass
    && vertices === 'routing-direct-bottom,routing-direct-top'
    && edges === 'routing-edge-focus-bottom,routing-edge-focus-top'
    && !adjacent.vertexIds.has('routing-two-hop')
  return {
    id: 'routing-topology',
    label: '직접 인접 강조 집합',
    pass,
    detail: `${integrity.detail} · adjacent vertex [${vertices}] · edge [${edges}]`,
  }
}

function boxesOverlap(left: DrawioBounds, right: DrawioBounds) {
  return left.x < right.x + right.width && left.x + left.width > right.x
    && left.y < right.y + right.height && left.y + left.height > right.y
}

function labelDiagnostic(snapshot: DrawioGeometrySnapshot, fontFaceCount: number): DrawioDiagnostic {
  const vertex = snapshot.vertices.find(({ id }) => id === 'routing-vertical-bottom')
  const label = vertex?.labelBounds ?? null
  const measurementAvailable = Boolean(label && label.width > 0 && label.height > 0 && vertex?.labelNodeMapped)
  const inside = Boolean(vertex && label
    && label.x >= vertex.bounds.x - EPSILON && label.y >= vertex.bounds.y - EPSILON
    && label.x + label.width <= vertex.bounds.x + vertex.bounds.width + EPSILON
    && label.y + label.height <= vertex.bounds.y + vertex.bounds.height + EPSILON)
  const overlaps = Boolean(label && snapshot.vertices.some((candidate) =>
    candidate.id !== vertex?.id && candidate.childCount === 0 && boxesOverlap(label, candidate.bounds),
  ))
  const pass = fontFaceCount > 0 && measurementAvailable && inside && !overlaps
  const labelText = label ? `${label.x.toFixed(1)},${label.y.toFixed(1)},${label.width.toFixed(1)},${label.height.toFixed(1)}` : 'unavailable'
  return {
    id: 'routing-label',
    label: 'Pretendard 한글 label',
    pass,
    detail: `font face ${fontFaceCount} · measured ${measurementAvailable} · inside ${inside} · overlap ${overlaps} · label [${labelText}]`,
  }
}

function fullIaLabelDiagnostic(snapshot: DrawioGeometrySnapshot, fontFaceCount: number): DrawioDiagnostic {
  const unavailable: string[] = []
  const outside: string[] = []
  for (const vertex of snapshot.vertices) {
    const label = vertex.labelBounds
    if (!vertex.labelNodeMapped || !label || label.width <= 0 || label.height <= 0) {
      unavailable.push(vertex.id)
      continue
    }
    const inside = label.x >= vertex.bounds.x - EPSILON && label.y >= vertex.bounds.y - EPSILON
      && label.x + label.width <= vertex.bounds.x + vertex.bounds.width + EPSILON
      && label.y + label.height <= vertex.bounds.y + vertex.bounds.height + EPSILON
    if (!inside) {
      const overrun = {
        left: Math.max(0, vertex.bounds.x - label.x),
        top: Math.max(0, vertex.bounds.y - label.y),
        right: Math.max(0, label.x + label.width - vertex.bounds.x - vertex.bounds.width),
        bottom: Math.max(0, label.y + label.height - vertex.bounds.y - vertex.bounds.height),
      }
      outside.push(
        `${vertex.id}[node ${vertex.bounds.x.toFixed(1)},${vertex.bounds.y.toFixed(1)},${vertex.bounds.width.toFixed(1)},${vertex.bounds.height.toFixed(1)}; label ${label.x.toFixed(1)},${label.y.toFixed(1)},${label.width.toFixed(1)},${label.height.toFixed(1)}; overrun L${overrun.left.toFixed(1)}/T${overrun.top.toFixed(1)}/R${overrun.right.toFixed(1)}/B${overrun.bottom.toFixed(1)}]`,
      )
    }
  }
  return {
    id: 'ia-label',
    label: '전체 한글 label 측정·내부 배치',
    pass: fontFaceCount > 0 && unavailable.length === 0 && outside.length === 0,
    detail: `font face ${fontFaceCount} · measured ${snapshot.vertices.length - unavailable.length}/${snapshot.vertices.length} · unavailable ${unavailable.length}${unavailable.length > 0 ? ` [${unavailable.join(', ')}]` : ''} · outside ${outside.length}${outside.length > 0 ? ` [${outside.join(', ')}]` : ''}`,
  }
}

interface RouteSegment {
  readonly edge: DrawioEdgeGeometry
  readonly index: number
  readonly start: DrawioPoint
  readonly end: DrawioPoint
  readonly horizontal: boolean
  readonly vertical: boolean
  readonly length: number
}

function routeSegments(snapshot: DrawioGeometrySnapshot) {
  return snapshot.edges.flatMap((edge) => edge.points.slice(1).map((end, index): RouteSegment => {
    const start = edge.points[index]
    return {
      edge,
      index,
      start,
      end,
      horizontal: Math.abs(start.y - end.y) <= EPSILON,
      vertical: Math.abs(start.x - end.x) <= EPSILON,
      length: Math.abs(start.x - end.x) + Math.abs(start.y - end.y),
    }
  }))
}

function projectionOverlap(a1: number, a2: number, b1: number, b2: number) {
  return Math.min(Math.max(a1, a2), Math.max(b1, b2)) - Math.max(Math.min(a1, a2), Math.min(b1, b2))
}

function between(value: number, low: number, high: number, strict = false) {
  const minimum = Math.min(low, high)
  const maximum = Math.max(low, high)
  return strict ? value > minimum + EPSILON && value < maximum - EPSILON : value >= minimum - EPSILON && value <= maximum + EPSILON
}

function routeIntersections(snapshot: DrawioGeometrySnapshot) {
  const segments = routeSegments(snapshot)
  const junctions = new Map(snapshot.junctions.map(({ id, point }) => [id, point]))
  const crossings: string[] = []
  const overlaps: string[] = []
  for (let leftIndex = 0; leftIndex < segments.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < segments.length; rightIndex += 1) {
      const left = segments[leftIndex]
      const right = segments[rightIndex]
      if (left.edge.id === right.edge.id) continue
      if (left.horizontal === right.horizontal) {
        const gap = left.horizontal ? Math.abs(left.start.y - right.start.y) : Math.abs(left.start.x - right.start.x)
        const overlap = left.horizontal
          ? projectionOverlap(left.start.x, left.end.x, right.start.x, right.end.x)
          : projectionOverlap(left.start.y, left.end.y, right.start.y, right.end.y)
        if (overlap > EPSILON && gap < 16 - EPSILON) overlaps.push(`${left.edge.id}/${right.edge.id}:${gap.toFixed(1)}px`)
        continue
      }
      const horizontal = left.horizontal ? left : right
      const vertical = left.horizontal ? right : left
      if (!horizontal.horizontal || !vertical.vertical) continue
      const point = { x: vertical.start.x, y: horizontal.start.y }
      if (!between(point.x, horizontal.start.x, horizontal.end.x) || !between(point.y, vertical.start.y, vertical.end.y)) continue
      const commonTerminal = [left.edge.sourceId, left.edge.targetId].find((id) => id === right.edge.sourceId || id === right.edge.targetId)
      const commonPoint = commonTerminal ? junctions.get(commonTerminal) : null
      if (commonPoint && Math.abs(commonPoint.x - point.x) <= EPSILON && Math.abs(commonPoint.y - point.y) <= EPSILON) continue
      crossings.push(`${left.edge.id}/${right.edge.id}@${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    }
  }
  return { crossings, overlaps }
}

function routeNodeClearance(snapshot: DrawioGeometrySnapshot) {
  const violations: string[] = []
  for (const segment of routeSegments(snapshot)) {
    const terminals = new Set([segment.edge.sourceId, segment.edge.targetId])
    for (const vertex of snapshot.vertices) {
      if (terminals.has(vertex.id)) continue
      const bounds = vertex.bounds
      const left = bounds.x - 12
      const right = bounds.x + bounds.width + 12
      const top = bounds.y - 12
      const bottom = bounds.y + bounds.height + 12
      const hit = segment.horizontal
        ? between(segment.start.y, top, bottom, true) && projectionOverlap(segment.start.x, segment.end.x, left, right) > EPSILON
        : segment.vertical
          ? between(segment.start.x, left, right, true) && projectionOverlap(segment.start.y, segment.end.y, top, bottom) > EPSILON
          : true
      if (hit) violations.push(`${segment.edge.id}→${vertex.id}`)
    }
  }
  return violations
}

function routeLayout(snapshot: DrawioGeometrySnapshot) {
  const bounds = new Map(snapshot.vertices.map((vertex) => [vertex.id, vertex.bounds]))
  const dashboard = bounds.get('ia-dashboard')
  const obs = bounds.get('ia-obs')
  const library = bounds.get('ia-clip-library')
  const leftPage = bounds.get('ia-obs-page-a1-a5')
  const leftAction = bounds.get('ia-obs-action-a1-a5')
  const rightPage = bounds.get('ia-clip-library-page-e8-f2')
  const rightAction = bounds.get('ia-clip-library-action-f2')
  const gutters = dashboard && obs && library && leftPage && leftAction && rightPage && rightAction
    ? [dashboard.x - obs.x - obs.width, library.x - dashboard.x - dashboard.width,
      obs.x - leftPage.x - leftPage.width, leftPage.x - leftAction.x - leftAction.width,
      rightPage.x - library.x - library.width, rightAction.x - rightPage.x - rightPage.width]
    : []
  const rows = [
    ['ia-obs', 'ia-clip-library', 396], ['ia-onboarding', 'ia-vod', 636],
    ['ia-live', 'ia-settings', 900], ['ia-clip-editor', 'ia-operations', 1236],
  ] as const
  const rowErrors = rows.filter(([leftId, rightId, expected]) => {
    const left = bounds.get(leftId)
    const right = bounds.get(rightId)
    return !left || !right || Math.abs(left.y + left.height / 2 - expected) > EPSILON || Math.abs(right.y + right.height / 2 - expected) > EPSILON
  })
  return { pass: gutters.length === 6 && gutters.every((gutter) => Math.abs(gutter - 64) <= EPSILON) && rowErrors.length === 0, gutters, rowErrors }
}

function routeTrunk(scene: DrawioScene, snapshot: DrawioGeometrySnapshot) {
  const referencedSemantic = new Set(snapshot.edges.flatMap(({ semanticRefs }) => semanticRefs))
  const missing = [...scene.topology.edgeIds].filter((id) => !referencedSemantic.has(id))
  const actualVertexIds = [...scene.topology.vertexIds].sort()
  const actualEdgeTuples = [...scene.topology.edgeIds].map((edgeId) => {
    const terminals = scene.topology.terminalsOf(edgeId)
    return `${edgeId}|${terminals?.sourceId ?? ''}|${terminals?.targetId ?? ''}`
  }).sort()
  const semanticContractPass = JSON.stringify(actualVertexIds) === JSON.stringify(IA_SEMANTIC_CONTRACT.vertexIds)
    && JSON.stringify(actualEdgeTuples) === JSON.stringify(IA_SEMANTIC_CONTRACT.edgeTuples)
  const semanticIds = new Set(IA_SEMANTIC_CONTRACT.edgeTuples.map((tuple) => tuple.slice(0, tuple.indexOf('|'))))
  const invalidPhysicalRefs = snapshot.edges.filter(({ semanticRefs }) =>
    semanticRefs.length === 0 || new Set(semanticRefs).size !== semanticRefs.length
      || semanticRefs.some((semanticId) => !semanticIds.has(semanticId)),
  ).map(({ id }) => id)
  const physicalPathErrors = IA_SEMANTIC_CONTRACT.edgeTuples.flatMap((tuple) => {
    const [semanticId, sourceId, targetId] = tuple.split('|')
    const physicalEdges = snapshot.edges.filter(({ semanticRefs }) => semanticRefs.includes(semanticId))
    if (physicalEdges.length === 0) return [`${semanticId}:empty`]
    const adjacency = new Map<string, Set<string>>()
    const addNeighbor = (left: string, right: string) => {
      const neighbors = adjacency.get(left) ?? new Set<string>()
      neighbors.add(right)
      adjacency.set(left, neighbors)
    }
    for (const edge of physicalEdges) {
      addNeighbor(edge.sourceId, edge.targetId)
      addNeighbor(edge.targetId, edge.sourceId)
    }
    const endpointsPass = adjacency.get(sourceId)?.size === 1 && adjacency.get(targetId)?.size === 1
    const internalPass = [...adjacency].every(([vertexId, neighbors]) =>
      vertexId === sourceId || vertexId === targetId
        ? neighbors.size === 1
        : scene.topology.junctionIds.has(vertexId) && neighbors.size === 2,
    )
    const seen = new Set<string>()
    const pending = [sourceId]
    while (pending.length > 0) {
      const current = pending.pop()
      if (!current || seen.has(current)) continue
      seen.add(current)
      for (const neighbor of adjacency.get(current) ?? []) pending.push(neighbor)
    }
    const connectedPass = seen.has(targetId) && seen.size === adjacency.size
    const acyclicPass = physicalEdges.length === adjacency.size - 1
    return endpointsPass && internalPass && connectedPass && acyclicPass
      ? [] : [`${semanticId}:invalid-path`]
  })
  const root = snapshot.edges.filter(({ group }) => group === 'root-products')
  const rootStem = root.filter(({ role }) => role === 'stem')
  const rootRails = root.filter(({ role }) => role === 'rail')
  const rootBranches = root.filter(({ role }) => role === 'branch')
  return {
    pass: semanticContractPass && scene.topology.vertexIds.size === 71 && scene.topology.edgeIds.size === 70
      && snapshot.junctions.length === 57 && snapshot.edges.length === 127 && missing.length === 0
      && invalidPhysicalRefs.length === 0 && physicalPathErrors.length === 0
      && rootStem.length === 1 && rootRails.length === 3 && rootBranches.length === 8,
    missing,
    semanticContractPass,
    invalidPhysicalRefs,
    physicalPathErrors,
    rootStem: rootStem.length,
    rootRails: rootRails.length,
    rootBranches: rootBranches.length,
  }
}

function routeSymmetry(snapshot: DrawioGeometrySnapshot) {
  const branches = snapshot.edges.filter(({ group, role }) => group === 'root-products' && role === 'branch')
  const lengths = branches.map((edge) => routeSegments({ ...snapshot, edges: [edge] }).reduce((sum, segment) => sum + segment.length, 0))
  return { pass: lengths.length === 8 && lengths.every((length) => Math.abs(length - lengths[0]) <= EPSILON), lengths }
}

export function runFullIaDiagnostics(
  scene: DrawioScene,
  snapshot: DrawioGeometrySnapshot,
  fontFaceCount: number,
): readonly DrawioDiagnostic[] {
  const integrity = snapshotTopologyIntegrity(scene, snapshot)
  const endpoint = endpointError(snapshot)
  const diagonals = nonOrthogonalSegments(snapshot)
  const nodeClearance = routeNodeClearance(snapshot)
  const intersections = routeIntersections(snapshot)
  const segments = routeSegments(snapshot)
  const shortSegments = segments.filter(({ length }) => length < 16 - EPSILON)
  const bendViolations = snapshot.edges.filter(({ points }) => points.length > 2)
  const trunk = routeTrunk(scene, snapshot)
  const layout = routeLayout(snapshot)
  const symmetry = routeSymmetry(snapshot)
  const label = fullIaLabelDiagnostic(snapshot, fontFaceCount)
  return [
    {
      id: 'route-endpoints', label: '모든 연결선 중앙 포트', pass: integrity.pass && endpoint <= EPSILON,
      detail: `최대 오차 ${Number.isFinite(endpoint) ? endpoint.toFixed(2) : '∞'}px · ${integrity.detail}`,
    },
    {
      id: 'route-orthogonal', label: '모든 segment 직교', pass: diagonals.length === 0,
      detail: `비직교 ${diagonals.length}개`,
    },
    {
      id: 'route-node-clearance', label: '노드 외곽 12px clearance', pass: nodeClearance.length === 0,
      detail: `침범 ${nodeClearance.length}개${nodeClearance.length ? ` (${nodeClearance.slice(0, 4).join(', ')})` : ''}`,
    },
    {
      id: 'route-edge-crossing', label: '비의미 edge 교차 없음', pass: intersections.crossings.length === 0,
      detail: `교차 ${intersections.crossings.length}개${intersections.crossings.length ? ` (${intersections.crossings.slice(0, 4).join(', ')})` : ''}`,
    },
    { id: 'route-overlap', label: '중복·16px 미만 평행선 없음', pass: intersections.overlaps.length === 0, detail: `위반 ${intersections.overlaps.length}개` },
    { id: 'route-short-segment', label: '의미 선분 16px 이상', pass: shortSegments.length === 0, detail: `짧은 선분 ${shortSegments.length}개` },
    { id: 'route-bend-budget', label: '물리 segment별 bend 0', pass: bendViolations.length === 0, detail: `초과 ${bendViolations.length}개` },
    { id: 'route-trunk', label: 'semantic 관계와 단일 물리 trunk', pass: trunk.pass, detail: `semantic 71/70 exact ${trunk.semanticContractPass} · junction ${snapshot.junctions.length}/57 · physical ${snapshot.edges.length}/127 · root ${trunk.rootStem}/${trunk.rootRails}/${trunk.rootBranches} · unmapped ${trunk.missing.length} · bad refs ${trunk.invalidPhysicalRefs.length} · bad paths ${trunk.physicalPathErrors.length}` },
    { id: 'route-layout', label: '64px gutter·paired row 정렬', pass: layout.pass, detail: `gutter [${layout.gutters.map((value) => value.toFixed(0)).join(',')}] · row error ${layout.rowErrors.length}` },
    { id: 'route-symmetry', label: 'root 좌우 분기 대칭', pass: symmetry.pass, detail: `branch length [${symmetry.lengths.map((value) => value.toFixed(0)).join(',')}]` },
    { ...label, id: 'route-label-clearance', label: 'Pretendard label 측정·노드 내부 배치' },
  ]
}

function inspectUseCaseSemanticContract(scene: DrawioScene, snapshot: DrawioGeometrySnapshot) {
  const expectedVertexIds = [...USE_CASE_CONTRACT.actorIds, ...USE_CASE_CONTRACT.useCaseIds].sort()
  const actualTopologyIds = [...scene.topology.vertexIds].sort()
  const actualSnapshotIds = snapshot.vertices
    .filter(({ pokeKind }) => pokeKind === 'semantic')
    .map(({ id }) => id)
    .sort()
  const expectedTuples = USE_CASE_CONTRACT.edges
    .map(({ id, sourceId, targetId, relationKind }) => `${id}|${sourceId}|${targetId}|${relationKind}`)
    .sort()
  const actualTuples = [...scene.topology.edgeIds].map((edgeId) => {
    const terminals = scene.topology.terminalsOf(edgeId)
    return `${edgeId}|${terminals?.sourceId ?? ''}|${terminals?.targetId ?? ''}|${scene.topology.relationKindOf(edgeId) ?? ''}`
  }).sort()
  const interactiveIds = [...scene.svg.querySelectorAll<SVGElement>(
    '[data-cell-kind="vertex"][data-cell-interactive="true"]',
  )].map(({ dataset }) => dataset.cellId ?? '')
  const canonicalCardinality = USE_CASE_CONTRACT.actorIds.length === 3
    && USE_CASE_CONTRACT.useCaseIds.length === 38
    && expectedVertexIds.length === 41
    && new Set(expectedVertexIds).size === 41
    && USE_CASE_CONTRACT.edges.length === 26
    && new Set(expectedTuples).size === 26
  const verticesPass = JSON.stringify(actualTopologyIds) === JSON.stringify(expectedVertexIds)
    && JSON.stringify(actualSnapshotIds) === JSON.stringify(expectedVertexIds)
    && sameIds(interactiveIds, new Set(expectedVertexIds))
  const edgesPass = JSON.stringify(actualTuples) === JSON.stringify(expectedTuples)
  return {
    pass: canonicalCardinality && verticesPass && edgesPass,
    canonicalCardinality,
    verticesPass,
    edgesPass,
    interactiveCount: interactiveIds.length,
  }
}

function inspectUseCaseDecorationPartition(scene: DrawioScene, snapshot: DrawioGeometrySnapshot) {
  const expectedIds = new Set(USE_CASE_CONTRACT.decorationIds)
  const decorations = snapshot.vertices.filter(({ pokeKind }) => pokeKind === 'decoration')
  const unexpectedKinds = snapshot.vertices.filter(({ pokeKind }) => pokeKind !== 'semantic' && pokeKind !== 'decoration')
  const decorationNodes = [...scene.svg.querySelectorAll<SVGElement>('[data-cell-kind="decoration"]')]
  const renderedIds = [...new Set(decorationNodes.map(({ dataset }) => dataset.cellId ?? ''))]
  const interactive = decorationNodes.filter((node) => node.dataset.cellInteractive === 'true'
    || node.hasAttribute('tabindex') || node.hasAttribute('role') || node.hasAttribute('aria-pressed'))
  const leakedIntoTopology = USE_CASE_CONTRACT.decorationIds.filter((id) => scene.topology.vertexIds.has(id))
  const pass = USE_CASE_CONTRACT.decorationIds.length === 8
    && expectedIds.size === 8
    && sameIds(decorations.map(({ id }) => id), expectedIds)
    && sameIds(renderedIds, expectedIds)
    && unexpectedKinds.length === 0
    && interactive.length === 0
    && leakedIntoTopology.length === 0
  return {
    pass,
    decorationCount: decorations.length,
    renderedCount: renderedIds.length,
    unexpectedKinds: unexpectedKinds.map(({ id }) => id),
    interactiveCount: interactive.length,
    leakedIntoTopology,
  }
}

function inspectUseCasePhysicalPaths(scene: DrawioScene, snapshot: DrawioGeometrySnapshot) {
  const semanticIds = new Set(USE_CASE_CONTRACT.edges.map(({ id }) => id))
  const physicalById = new Map(snapshot.edges.map((edge) => [edge.id, edge]))
  const invalidRefs = snapshot.edges.filter(({ semanticRefs }) => semanticRefs.length === 0
    || new Set(semanticRefs).size !== semanticRefs.length
    || semanticRefs.some((semanticId) => !semanticIds.has(semanticId))).map(({ id }) => id)
  const pathErrors: string[] = []

  for (const semantic of USE_CASE_CONTRACT.edges) {
    const mappedIds = [...scene.topology.physicalEdgeIdsOf(semantic.id)]
    const referencedIds = snapshot.edges
      .filter(({ semanticRefs }) => semanticRefs.includes(semantic.id))
      .map(({ id }) => id)
    if (!sameIds(mappedIds, new Set(referencedIds)) || mappedIds.length === 0) {
      pathErrors.push(`${semantic.id}:mapping`)
      continue
    }
    const degree = new Map<string, number>()
    const neighbors = new Map<string, Set<string>>()
    const addEndpoint = (left: string, right: string) => {
      degree.set(left, (degree.get(left) ?? 0) + 1)
      const adjacent = neighbors.get(left) ?? new Set<string>()
      adjacent.add(right)
      neighbors.set(left, adjacent)
    }
    let missingPhysical = false
    for (const physicalId of mappedIds) {
      const physical = physicalById.get(physicalId)
      if (!physical) {
        missingPhysical = true
        break
      }
      addEndpoint(physical.sourceId, physical.targetId)
      addEndpoint(physical.targetId, physical.sourceId)
    }
    const endpointPass = degree.get(semantic.sourceId) === 1 && degree.get(semantic.targetId) === 1
    const internalPass = [...degree].every(([vertexId, count]) =>
      vertexId === semantic.sourceId || vertexId === semantic.targetId
        ? count === 1
        : count === 2 && scene.topology.junctionIds.has(vertexId))
    const seen = new Set<string>()
    const pending = [semantic.sourceId]
    while (pending.length > 0) {
      const current = pending.pop()
      if (!current || seen.has(current)) continue
      seen.add(current)
      for (const neighbor of neighbors.get(current) ?? []) pending.push(neighbor)
    }
    const connectedPass = seen.has(semantic.targetId) && seen.size === degree.size
    const acyclicPass = mappedIds.length === degree.size - 1
    if (missingPhysical || !endpointPass || !internalPass || !connectedPass || !acyclicPass) {
      pathErrors.push(`${semantic.id}:path`)
    }
  }

  return { pass: invalidRefs.length === 0 && pathErrors.length === 0, invalidRefs, pathErrors }
}

function inspectUseCasePhysicalRelationKinds(snapshot: DrawioGeometrySnapshot) {
  const semanticById = new Map(USE_CASE_CONTRACT.edges.map((edge) => [edge.id, edge]))
  const violations = snapshot.edges.flatMap((edge) => {
    const declaredKind = String(edge.style.pokeRelationKind ?? '')
    const referencedKinds = new Set(edge.semanticRefs.map((id) => semanticById.get(id)?.relationKind))
    return (declaredKind === 'actor' || declaredKind === 'feature')
      && referencedKinds.size === 1 && referencedKinds.has(declaredKind) ? [] : [edge.id]
  })
  return { pass: violations.length === 0, violations }
}

function inspectUseCaseJunctionTopology(scene: DrawioScene, snapshot: DrawioGeometrySnapshot) {
  const incidents = new Map([...scene.topology.junctionIds].map((id) => [id, [] as RouteSegment[]]))
  for (const segment of routeSegments(snapshot)) {
    for (const terminalId of [segment.edge.sourceId, segment.edge.targetId]) {
      incidents.get(terminalId)?.push(segment)
    }
  }
  const fourWay = [...incidents].flatMap(([junctionId, segments]) => {
    const horizontalCount = segments.filter(({ horizontal }) => horizontal).length
    const verticalCount = segments.filter(({ vertical }) => vertical).length
    return horizontalCount >= 2 && verticalCount >= 2 ? [junctionId] : []
  })
  return { pass: fourWay.length === 0, fourWay }
}

function centralPortErrors(scene: DrawioScene, snapshot: DrawioGeometrySnapshot) {
  const normalizedPortTolerance = 0.001
  const validPort = (terminalId: string, xValue: string | number | undefined, yValue: string | number | undefined) => {
    const x = Number(xValue)
    const y = Number(yValue)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false
    if (scene.topology.junctionIds.has(terminalId)) {
      return Math.abs(x - 0.5) <= normalizedPortTolerance && Math.abs(y - 0.5) <= normalizedPortTolerance
    }
    if (!scene.topology.vertexIds.has(terminalId)) return false
    const horizontalCenter = Math.abs(y - 0.5) <= normalizedPortTolerance
      && (Math.abs(x) <= normalizedPortTolerance || Math.abs(x - 1) <= normalizedPortTolerance)
    const verticalCenter = Math.abs(x - 0.5) <= normalizedPortTolerance
      && (Math.abs(y) <= normalizedPortTolerance || Math.abs(y - 1) <= normalizedPortTolerance)
    return horizontalCenter || verticalCenter
  }
  return snapshot.edges.flatMap((edge) => validPort(edge.sourceId, edge.style.exitX, edge.style.exitY)
    && validPort(edge.targetId, edge.style.entryX, edge.style.entryY) ? [] : [edge.id])
}

function inspectUseCaseNodeCrossings(snapshot: DrawioGeometrySnapshot) {
  const semanticVertices = snapshot.vertices.filter(({ pokeKind }) => pokeKind === 'semantic')
  const crossings: string[] = []
  for (const edge of snapshot.edges) {
    const terminals = new Set([edge.sourceId, edge.targetId])
    for (const vertex of semanticVertices) {
      if (terminals.has(vertex.id)) continue
      if (edge.points.slice(1).some((point, index) =>
        segmentCrossesOpenBounds(edge.points[index], point, vertex.bounds))) {
        crossings.push(`${edge.id}→${vertex.id}`)
      }
    }
  }
  return crossings
}

function pointAtSegmentEnd(point: DrawioPoint, segment: RouteSegment) {
  return pointError(point, segment.start) <= EPSILON || pointError(point, segment.end) <= EPSILON
}

function inspectUseCaseIntersections(snapshot: DrawioGeometrySnapshot) {
  const segments = routeSegments(snapshot)
  const crossings: string[] = []
  const overlaps: string[] = []
  for (let leftIndex = 0; leftIndex < segments.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < segments.length; rightIndex += 1) {
      const left = segments[leftIndex]
      const right = segments[rightIndex]
      if (left.edge.id === right.edge.id) continue
      if (left.horizontal === right.horizontal) {
        const gap = left.horizontal ? Math.abs(left.start.y - right.start.y) : Math.abs(left.start.x - right.start.x)
        const overlap = left.horizontal
          ? projectionOverlap(left.start.x, left.end.x, right.start.x, right.end.x)
          : projectionOverlap(left.start.y, left.end.y, right.start.y, right.end.y)
        if (gap <= EPSILON && overlap > EPSILON) overlaps.push(`${left.edge.id}/${right.edge.id}`)
        continue
      }
      const horizontal = left.horizontal ? left : right
      const vertical = left.horizontal ? right : left
      if (!horizontal.horizontal || !vertical.vertical) continue
      const point = { x: vertical.start.x, y: horizontal.start.y }
      if (!between(point.x, horizontal.start.x, horizontal.end.x)
        || !between(point.y, vertical.start.y, vertical.end.y)) continue
      const commonTerminal = [left.edge.sourceId, left.edge.targetId]
        .find((id) => id === right.edge.sourceId || id === right.edge.targetId)
      if (commonTerminal && pointAtSegmentEnd(point, left) && pointAtSegmentEnd(point, right)) continue
      crossings.push(`${left.edge.id}/${right.edge.id}@${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    }
  }
  return { crossings, overlaps }
}

function inspectUseCaseGrid(snapshot: DrawioGeometrySnapshot) {
  const byId = new Map(snapshot.vertices.map((vertex) => [vertex.id, vertex]))
  const useCases = USE_CASE_CONTRACT.useCaseIds.flatMap((id) => {
    const vertex = byId.get(id)
    return vertex ? [vertex] : []
  })
  const decorations = USE_CASE_CONTRACT.decorationIds.flatMap((id) => {
    const vertex = byId.get(id)
    return vertex ? [vertex] : []
  })
  const systemId = USE_CASE_CONTRACT.decorations.find(({ decorationKind }) => decorationKind === 'system')?.id
  const groupIds = USE_CASE_CONTRACT.decorations
    .filter(({ decorationKind }) => decorationKind === 'group')
    .map(({ id }) => id)
  const systemBoundary = systemId ? byId.get(systemId) : undefined
  const groups = groupIds.flatMap((id) => {
    const group = byId.get(id)
    return group ? [group] : []
  })
  const firstUseCase = useCases[0]
  const sizeErrors = useCases.filter(({ bounds }) => !firstUseCase
    || Math.abs(bounds.width - firstUseCase.bounds.width) > EPSILON
    || Math.abs(bounds.height - firstUseCase.bounds.height) > EPSILON).map(({ id }) => id)
  const groupColumns = [...new Set(groups.map(({ bounds }) => Math.round(bounds.x)))].sort((left, right) => left - right)
  const columnGaps = groupColumns.slice(1).map((x, index) => x - groupColumns[index])
  const groupWidth = groups[0]?.bounds.width
  const groupWidthErrors = groups.filter(({ bounds }) => groupWidth === undefined
    || Math.abs(bounds.width - groupWidth) > EPSILON).map(({ id }) => id)
  const localXs = new Set<number>()
  const localYs = new Set<number>()
  const containmentErrors: string[] = []
  for (const useCaseDefinition of USE_CASE_CONTRACT.useCases) {
    const useCase = byId.get(useCaseDefinition.id)
    const group = byId.get(useCaseDefinition.groupId)
    if (!useCase || !group || !groupIds.includes(group.id)) {
      containmentErrors.push(useCaseDefinition.id)
      continue
    }
    const center = {
      x: useCase.bounds.x + useCase.bounds.width / 2,
      y: useCase.bounds.y + useCase.bounds.height / 2,
    }
    const inside = center.x >= group.bounds.x - EPSILON
      && center.x <= group.bounds.x + group.bounds.width + EPSILON
      && center.y >= group.bounds.y - EPSILON
      && center.y <= group.bounds.y + group.bounds.height + EPSILON
    if (!inside) containmentErrors.push(useCase.id)
    localXs.add(Math.round(useCase.bounds.x - group.bounds.x))
    localYs.add(Math.round(useCase.bounds.y - group.bounds.y))
  }
  const systemContainmentErrors = systemBoundary ? groups.filter(({ bounds }) =>
    bounds.x < systemBoundary.bounds.x - EPSILON || bounds.y < systemBoundary.bounds.y - EPSILON
    || bounds.x + bounds.width > systemBoundary.bounds.x + systemBoundary.bounds.width + EPSILON
    || bounds.y + bounds.height > systemBoundary.bounds.y + systemBoundary.bounds.height + EPSILON).map(({ id }) => id) : groupIds
  const groupsOverlap = groups.flatMap((left, leftIndex) => groups.slice(leftIndex + 1)
    .filter((right) => boxesOverlap(left.bounds, right.bounds)).map((right) => `${left.id}/${right.id}`))
  const sortedLocalYs = [...localYs].sort((left, right) => left - right)
  const rowGaps = sortedLocalYs.slice(1).map((y, index) => y - sortedLocalYs[index])
  return {
    pass: useCases.length === 38 && decorations.length === 8 && groups.length === 7
      && groupColumns.length === 3 && columnGaps.length === 2
      && columnGaps.every((gap) => Math.abs(gap - columnGaps[0]) <= EPSILON)
      && localXs.size === 2 && localYs.size === 4 && rowGaps.length === 3
      && rowGaps.every((gap) => Math.abs(gap - rowGaps[0]) <= EPSILON)
      && groupWidthErrors.length === 0 && sizeErrors.length === 0 && containmentErrors.length === 0
      && systemContainmentErrors.length === 0 && groupsOverlap.length === 0,
    groupColumns: groupColumns.length,
    groupWidthErrors,
    nodeColumns: localXs.size,
    nodeRows: localYs.size,
    sizeErrors,
    containmentErrors,
    systemContainmentErrors,
    groupsOverlap,
  }
}

function inspectUseCaseActorSpines(scene: DrawioScene, snapshot: DrawioGeometrySnapshot) {
  const stems = snapshot.edges.filter(({ role }) => role === 'stem')
  const spines = snapshot.edges.filter(({ role }) => role === 'spine')
  const spineIds = new Set<string>()
  const actorsWithSpineSegments = new Set<string>()
  const errors: string[] = []
  for (const actorId of USE_CASE_CONTRACT.actorIds) {
    const actorRelations = USE_CASE_CONTRACT.edges.filter(({ relationKind, sourceId }) =>
      relationKind === 'actor' && sourceId === actorId)
    const relationStemSets = actorRelations.map(({ id }) => new Set(
      [...scene.topology.physicalEdgeIdsOf(id)].filter((physicalId) => physicalByRole(snapshot, physicalId, 'stem')),
    ))
    const shared = relationStemSets.length === 0 ? new Set<string>()
      : new Set([...relationStemSets[0]].filter((stemId) => relationStemSets.every((ids) => ids.has(stemId))))
    if (relationStemSets.some((ids) => ids.size !== 1) || shared.size !== 1) {
      errors.push(`${actorId}:shared-stem`)
      continue
    }
    spineIds.add([...shared][0])
  }
  for (const spine of spines) {
    const referencedActors = new Set(spine.semanticRefs.flatMap((semanticId) => {
      const semantic = USE_CASE_CONTRACT.edges.find(({ id }) => id === semanticId)
      return semantic?.relationKind === 'actor' ? [semantic.sourceId] : []
    }))
    if (spine.semanticRefs.length === 0 || referencedActors.size !== 1) {
      errors.push(`${spine.id}:spine-refs`)
      continue
    }
    actorsWithSpineSegments.add([...referencedActors][0])
  }
  for (const feature of USE_CASE_CONTRACT.edges.filter(({ relationKind }) => relationKind === 'feature')) {
    if ([...scene.topology.physicalEdgeIdsOf(feature.id)].some((physicalId) => physicalByRole(snapshot, physicalId, 'stem'))) {
      errors.push(`${feature.id}:feature-uses-stem`)
    }
  }
  const orphanStems = stems.filter(({ id }) => !spineIds.has(id)).map(({ id }) => id)
  return {
    pass: stems.length === 3 && spineIds.size === 3 && spines.length > 0
      && actorsWithSpineSegments.size === 3 && errors.length === 0 && orphanStems.length === 0,
    stemCount: stems.length,
    actorSpineCount: spineIds.size,
    spineSegmentCount: spines.length,
    actorsWithSpineSegments: actorsWithSpineSegments.size,
    errors,
    orphanStems,
  }
}

function physicalByRole(snapshot: DrawioGeometrySnapshot, physicalId: string, role: string) {
  return snapshot.edges.some(({ id, role: actualRole }) => id === physicalId && actualRole === role)
}

function inspectUseCaseLabelContainment(snapshot: DrawioGeometrySnapshot, fontFaceCount: number) {
  const semantic = snapshot.vertices.filter(({ pokeKind }) => pokeKind === 'semantic')
  const labels = inspectSemanticLabelEnvelopes(semantic, new Set(USE_CASE_CONTRACT.actorIds))
  return {
    pass: fontFaceCount > 0 && semantic.length === 41
      && labels.unavailable.length === 0 && labels.outside.length === 0
      && labels.nodeInside === labels.nodeExpected
      && labels.actorConvention === labels.actorExpected,
    ...labels,
  }
}

export function runFullUseCaseDiagnostics(
  scene: DrawioScene,
  snapshot: DrawioGeometrySnapshot,
  fontFaceCount: number,
): readonly DrawioDiagnostic[] {
  const integrity = snapshotTopologyIntegrity(scene, snapshot)
  const semantic = inspectUseCaseSemanticContract(scene, snapshot)
  const decoration = inspectUseCaseDecorationPartition(scene, snapshot)
  const physicalPaths = inspectUseCasePhysicalPaths(scene, snapshot)
  const physicalKinds = inspectUseCasePhysicalRelationKinds(snapshot)
  const junctionTopology = inspectUseCaseJunctionTopology(scene, snapshot)
  const endpoint = endpointError(snapshot)
  const portErrors = centralPortErrors(scene, snapshot)
  const diagonals = nonOrthogonalSegments(snapshot)
  const bentPhysicalEdges = snapshot.edges.filter(({ points }) => points.length !== 2).map(({ id }) => id)
  const nodeCrossings = inspectUseCaseNodeCrossings(snapshot)
  const intersections = inspectUseCaseIntersections(snapshot)
  const grid = inspectUseCaseGrid(snapshot)
  const actorSpines = inspectUseCaseActorSpines(scene, snapshot)
  const labels = inspectUseCaseLabelContainment(snapshot, fontFaceCount)
  return [
    {
      id: 'usecase-semantic-contract', label: 'semantic 41/26 exact tuple',
      pass: integrity.pass && semantic.pass,
      detail: `cardinality ${semantic.canonicalCardinality} · vertex ${semantic.verticesPass} · edge tuple ${semantic.edgesPass} · interactive ${semantic.interactiveCount}/41 · ${integrity.detail}`,
    },
    {
      id: 'usecase-decoration-partition', label: 'decoration 8개·비인터랙티브', pass: decoration.pass,
      detail: `snapshot ${decoration.decorationCount}/8 · rendered ${decoration.renderedCount}/8 · interactive ${decoration.interactiveCount} · invalid kind ${decoration.unexpectedKinds.length} · topology leak ${decoration.leakedIntoTopology.length}`,
    },
    {
      id: 'usecase-semantic-physical', label: 'semantic→physical path/ref 대칭', pass: physicalPaths.pass,
      detail: `bad refs ${physicalPaths.invalidRefs.length} · bad paths ${physicalPaths.pathErrors.length}`,
    },
    {
      id: 'usecase-physical-relation-kinds', label: 'actor/feature 물리 atom 혼합 0', pass: physicalKinds.pass,
      detail: `혼합·불명 atom ${physicalKinds.violations.length}${physicalKinds.violations.length > 0 ? ` (${physicalKinds.violations.slice(0, 4).join(', ')})` : ''}`,
    },
    {
      id: 'usecase-junction-topology', label: '공용 spine T 분기·degree-4 X 0', pass: junctionTopology.pass,
      detail: `degree-4 X ${junctionTopology.fourWay.length}${junctionTopology.fourWay.length > 0 ? ` (${junctionTopology.fourWay.slice(0, 4).join(', ')})` : ''}`,
    },
    {
      id: 'usecase-central-ports', label: '모든 연결선 중앙 포트 ≤1px',
      pass: integrity.pass && portErrors.length === 0 && endpoint <= EPSILON,
      detail: `최대 오차 ${Number.isFinite(endpoint) ? endpoint.toFixed(2) : '∞'}px · 비중앙 ${portErrors.length}`,
    },
    {
      id: 'usecase-orthogonal', label: '모든 물리 선분 직교·무굴곡',
      pass: diagonals.length === 0 && bentPhysicalEdges.length === 0,
      detail: `비직교 ${diagonals.length} · 굴곡 edge ${bentPhysicalEdges.length}`,
    },
    {
      id: 'usecase-node-clearance', label: '제3 semantic node 관통 0', pass: nodeCrossings.length === 0,
      detail: `관통 ${nodeCrossings.length}${nodeCrossings.length > 0 ? ` (${nodeCrossings.slice(0, 4).join(', ')})` : ''}`,
    },
    {
      id: 'usecase-crossing-policy', label: '물리 선분 교차 정책', pass: intersections.crossings.length === 0,
      detail: `허용되지 않은 교차 ${intersections.crossings.length}${intersections.crossings.length > 0 ? ` (${intersections.crossings.slice(0, 4).join(', ')})` : ''}`,
    },
    {
      id: 'usecase-overlap-policy', label: '물리 선분 중첩 정책', pass: intersections.overlaps.length === 0,
      detail: `동일축 중첩 ${intersections.overlaps.length}${intersections.overlaps.length > 0 ? ` (${intersections.overlaps.slice(0, 4).join(', ')})` : ''}`,
    },
    {
      id: 'usecase-grid', label: '3열 그룹·2열 노드 grid·동일 노드 크기', pass: grid.pass,
      detail: `group column ${grid.groupColumns}/3 · group width ${grid.groupWidthErrors.length} · node grid ${grid.nodeColumns}/2×${grid.nodeRows}/4 · size ${grid.sizeErrors.length} · containment ${grid.containmentErrors.length + grid.systemContainmentErrors.length} · group overlap ${grid.groupsOverlap.length}`,
    },
    {
      id: 'usecase-actor-spines', label: '액터별 공용 spine 정책', pass: actorSpines.pass,
      detail: `stem ${actorSpines.stemCount}/3 · actor spine ${actorSpines.actorSpineCount}/3 · spine segment ${actorSpines.spineSegmentCount} (actors ${actorSpines.actorsWithSpineSegments}/3) · policy error ${actorSpines.errors.length} · orphan ${actorSpines.orphanStems.length}`,
    },
    {
      id: 'usecase-label-containment', label: 'Pretendard label 측정·노드/actor 시각 배치', pass: labels.pass,
      detail: `font face ${fontFaceCount} · measured ${labels.measured}/41 · node inside ${labels.nodeInside}/${labels.nodeExpected} · actor convention ${labels.actorConvention}/${labels.actorExpected} · unavailable ${labels.unavailable.length} · outside ${labels.outside.length}${labels.outside.length > 0 ? ` (${labels.outside.join(', ')})` : ''}`,
    },
  ]
}

export function runFullUserJourneyDiagnostics(
  scene: DrawioScene,
  snapshot: DrawioGeometrySnapshot,
  fontFaceCount: number,
): readonly DrawioDiagnostic[] {
  const integrity = snapshotTopologyIntegrity(scene, snapshot)
  const endpoint = endpointError(snapshot)
  const diagonals = nonOrthogonalSegments(snapshot)
  const nodeClearance = routeNodeClearance(snapshot)
  const intersections = routeIntersections(snapshot)
  const bentPhysicalEdges = snapshot.edges.filter(({ points }) => points.length !== 2).map(({ id }) => id)
  const expectedNodeIds = [...USER_JOURNEY_CONTRACT.nodeIds].sort()
  const semanticVertexIds = snapshot.vertices
    .filter(({ pokeKind }) => pokeKind === 'semantic')
    .map(({ id }) => id)
    .sort()
  const semanticPass = JSON.stringify(semanticVertexIds) === JSON.stringify(expectedNodeIds)
    && sameIds([...scene.topology.vertexIds], new Set(expectedNodeIds))
    && scene.topology.edgeIds.size === USER_JOURNEY_CONTRACT.edges.length
  const decorationIds = snapshot.vertices
    .filter(({ pokeKind }) => pokeKind === 'decoration')
    .map(({ id }) => id)
    .sort()
  const decorationPass = JSON.stringify(decorationIds) === JSON.stringify([...USER_JOURNEY_CONTRACT.decorationIds].sort())
  return [
    {
      id: 'userjourney-semantic-contract', label: '9 journey card · 2 transition exact set',
      pass: integrity.pass && semanticPass,
      detail: `semantic vertex ${semanticVertexIds.length}/9 · semantic edge ${scene.topology.edgeIds.size}/2 · ${integrity.detail}`,
    },
    {
      id: 'userjourney-decoration-partition', label: 'overlay·annotation 비-obstacle 장식 분리',
      pass: decorationPass, detail: `decoration ${decorationIds.length}/8`,
    },
    {
      id: 'userjourney-endpoints', label: '전이 엣지 중앙 포트', pass: integrity.pass && endpoint <= EPSILON,
      detail: `최대 오차 ${Number.isFinite(endpoint) ? endpoint.toFixed(2) : '∞'}px`,
    },
    {
      id: 'userjourney-orthogonal', label: '모든 segment 직교', pass: diagonals.length === 0,
      detail: `비직교 ${diagonals.length}개`,
    },
    {
      id: 'userjourney-node-clearance', label: '경유 카드 clearance', pass: nodeClearance.length === 0,
      detail: `침범 ${nodeClearance.length}개${nodeClearance.length ? ` (${nodeClearance.slice(0, 4).join(', ')})` : ''}`,
    },
    {
      id: 'userjourney-edge-crossing', label: '전이 엣지 교차 없음', pass: intersections.crossings.length === 0,
      detail: `교차 ${intersections.crossings.length}개`,
    },
    {
      id: 'userjourney-overlap', label: '중복·근접 평행선 없음', pass: intersections.overlaps.length === 0,
      detail: `위반 ${intersections.overlaps.length}개`,
    },
    {
      id: 'userjourney-physical-bend', label: '물리 segment별 bend 0', pass: bentPhysicalEdges.length === 0,
      detail: `초과 ${bentPhysicalEdges.length}개`,
    },
    {
      id: 'userjourney-label', label: 'Pretendard label 로드', pass: fontFaceCount > 0,
      detail: `font face ${fontFaceCount}`,
    },
  ]
}

export function runRoutingDiagnostics(
  scene: DrawioScene,
  snapshot: DrawioGeometrySnapshot,
  fontFaceCount: number,
): readonly DrawioDiagnostic[] {
  const endpoint = endpointError(snapshot)
  const diagonals = nonOrthogonalSegments(snapshot)
  const crossings = leafCrossings(snapshot)
  return [
    {
      id: 'routing-ports',
      label: '고정 중앙 포트',
      pass: endpoint <= EPSILON,
      detail: `최대 오차 ${Number.isFinite(endpoint) ? endpoint.toFixed(2) : '∞'}px`,
    },
    {
      id: 'routing-orthogonal',
      label: '모든 segment 직교',
      pass: diagonals.length === 0,
      detail: `비직교 ${diagonals.length}개${diagonals.length > 0 ? ` (${diagonals.join(', ')})` : ''}`,
    },
    {
      id: 'routing-crossing',
      label: '제3 leaf node 비관통',
      pass: crossings.length === 0,
      detail: `관통 ${crossings.length}개${crossings.length > 0 ? ` (${crossings.join(', ')})` : ''}`,
    },
    childContainmentDiagnostic(snapshot),
    topologyDiagnostic(scene, snapshot),
    labelDiagnostic(snapshot, fontFaceCount),
  ]
}
