import { createHash } from 'node:crypto'
import {
  USERJOURNEY_SEMANTIC_CONTRACT,
  boundsOf,
  listJourneyDecorationCells,
  semanticJourneyEdges,
  semanticJourneyVertices,
} from './userjourney-layout.mjs'
import { cellMap, cloneModel, edgeCell, pointVertex, setCellStyle } from './xml-model.mjs'

// actor 계층 없음 — 모든 atom은 role='relation', relationKind='transition' 단일.
const ROLE_PRIORITY = Object.freeze({ relation: 0 })

// transition relation 시각 계약 (contract styleClass/share/direction/arrow와 정합).
const TRANSITION_RELATION = Object.freeze({
  styleClass: 'dashed/open', shareClass: 'solo', directionClass: 'forward', arrowMode: 'exclusive', bendTarget: 3,
})

// 조건2: 엣지1 x=1345 수직 direct(0-bend), 엣지2 Z corridor
//   (1787,600)→(1817,600)→(1817,452)→(2205,452)→(2205,390).
//   수직 corridor x=1817(phase2/3 gutter 1815~1830), 중간 수평 y=452(카드행1 bottom390↔행2 top500 gap),
//   종단 x=2205=approve.cx.
const TRANSITION_SPECS = Object.freeze({
  'edge-uj-hotkey-to-uj-editor': [
    { id: 'uj-hotkey', side: 'bottom' }, { id: 'uj-editor', side: 'top' },
  ],
  'edge-uj-editor-to-uj-approve': [
    { id: 'uj-editor', side: 'right' }, { x: 1817, y: 600 }, { x: 1817, y: 452 },
    { x: 2205, y: 452 }, { id: 'uj-approve', side: 'bottom' },
  ],
})

function point(x, y) {
  return { x, y }
}

function samePoint(left, right) {
  return left.x === right.x && left.y === right.y
}

function canonicalPointKey(value) {
  return `${value.x},${value.y}`
}

function canonicalSegmentKey(start, end) {
  const left = canonicalPointKey(start)
  const right = canonicalPointKey(end)
  return left.localeCompare(right, 'en') <= 0 ? `${left}|${right}` : `${right}|${left}`
}

function port(byId, id, side) {
  const bounds = boundsOf(byId.get(id))
  if (side === 'left') return point(bounds.x, bounds.y + bounds.height / 2)
  if (side === 'right') return point(bounds.x + bounds.width, bounds.y + bounds.height / 2)
  if (side === 'top') return point(bounds.x + bounds.width / 2, bounds.y)
  if (side === 'bottom') return point(bounds.x + bounds.width / 2, bounds.y + bounds.height)
  throw new Error(`User Journey port side 오류: ${id}.${side}`)
}

function transitionRoute(byId, semantic, steps) {
  const points = steps.map((step) => (step.id ? port(byId, step.id, step.side) : point(step.x, step.y)))
  return { semantic, group: 'transition', points, roles: points.slice(1).map(() => 'relation') }
}

function canonicalRoutes(model) {
  const byId = cellMap(model)
  const semanticById = new Map(semanticJourneyEdges(model).map((edge) => [edge.id, {
    id: edge.id,
    sourceId: edge.attributes.source,
    targetId: edge.attributes.target,
    relationKind: edge.style.pokeRelationKind,
    bundleFamilyKey: edge.style.pokeBundleFamilyKey,
  }]))
  return USERJOURNEY_SEMANTIC_CONTRACT.edges.map((edge) =>
    transitionRoute(byId, semanticById.get(edge.id), TRANSITION_SPECS[edge.id]))
}

function between(value, left, right) {
  return value >= Math.min(left, right) && value <= Math.max(left, right)
}

function isHorizontal(segment) {
  return segment.start.y === segment.end.y
}

function addBreakpoint(segment, value) {
  if (!segment.breakpoints.some((pointValue) => samePoint(pointValue, value))) segment.breakpoints.push(value)
}

function routesMayShareJunction(left, right) {
  if (left.semantic.id === right.semantic.id) return true
  const leftTerminals = new Set([left.semantic.sourceId, left.semantic.targetId])
  return [right.semantic.sourceId, right.semantic.targetId].some((id) => leftTerminals.has(id))
}

function collectBreakpoints(segments) {
  for (let leftIndex = 0; leftIndex < segments.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < segments.length; rightIndex += 1) {
      const left = segments[leftIndex]
      const right = segments[rightIndex]
      const leftHorizontal = isHorizontal(left)
      const rightHorizontal = isHorizontal(right)
      if (leftHorizontal !== rightHorizontal) {
        const horizontal = leftHorizontal ? left : right
        const vertical = leftHorizontal ? right : left
        const intersection = point(vertical.start.x, horizontal.start.y)
        if (between(intersection.x, horizontal.start.x, horizontal.end.x)
          && between(intersection.y, vertical.start.y, vertical.end.y)
          && routesMayShareJunction(left.route, right.route)) {
          addBreakpoint(horizontal, intersection)
          addBreakpoint(vertical, intersection)
        }
        continue
      }
      const collinear = leftHorizontal
        ? left.start.y === right.start.y
        : left.start.x === right.start.x
      if (!collinear || !routesMayShareJunction(left.route, right.route)) continue
      for (const candidate of [left.start, left.end]) {
        const contained = leftHorizontal
          ? between(candidate.x, right.start.x, right.end.x)
          : between(candidate.y, right.start.y, right.end.y)
        if (contained) addBreakpoint(right, candidate)
      }
      for (const candidate of [right.start, right.end]) {
        const contained = leftHorizontal
          ? between(candidate.x, left.start.x, left.end.x)
          : between(candidate.y, left.start.y, left.end.y)
        if (contained) addBreakpoint(left, candidate)
      }
    }
  }
}

function sortedBreakpoints(segment) {
  const axis = isHorizontal(segment) ? 'x' : 'y'
  const direction = segment.end[axis] >= segment.start[axis] ? 1 : -1
  return [...segment.breakpoints].sort((left, right) => direction * (left[axis] - right[axis]))
}

function rawSegments(routes) {
  const result = []
  for (const route of routes) {
    route.points.slice(1).forEach((end, index) => {
      const start = route.points[index]
      if (samePoint(start, end)) return
      if (start.x !== end.x && start.y !== end.y) throw new Error(`User Journey diagonal raw segment: ${route.semantic.id}[${index}]`)
      result.push({ route, index, start, end, role: route.roles[index], breakpoints: [start, end] })
    })
  }
  collectBreakpoints(result)
  return result
}

function terminalAt(route, pointValue) {
  if (samePoint(pointValue, route.points[0])) return route.semantic.sourceId
  if (samePoint(pointValue, route.points.at(-1))) return route.semantic.targetId
  return null
}

function sideAt(cell, pointValue) {
  const bounds = boundsOf(cell)
  if (pointValue.x === bounds.x && pointValue.y === bounds.y + bounds.height / 2) return 'left'
  if (pointValue.x === bounds.x + bounds.width && pointValue.y === bounds.y + bounds.height / 2) return 'right'
  if (pointValue.x === bounds.x + bounds.width / 2 && pointValue.y === bounds.y) return 'top'
  if (pointValue.x === bounds.x + bounds.width / 2 && pointValue.y === bounds.y + bounds.height) return 'bottom'
  throw new Error(`User Journey endpoint가 중앙 포트가 아닙니다: ${cell.id}@${canonicalPointKey(pointValue)}`)
}

function portStyle(prefix, side) {
  if (side === 'left') return { [`${prefix}X`]: '0', [`${prefix}Y`]: '0.5' }
  if (side === 'right') return { [`${prefix}X`]: '1', [`${prefix}Y`]: '0.5' }
  if (side === 'top') return { [`${prefix}X`]: '0.5', [`${prefix}Y`]: '0' }
  if (side === 'bottom') return { [`${prefix}X`]: '0.5', [`${prefix}Y`]: '1' }
  return { [`${prefix}X`]: '0.5', [`${prefix}Y`]: '0.5' }
}

function pad(index, width = 2) {
  return String(index + 1).padStart(width, '0')
}

function physicalStyle(edge, arrow) {
  const startSide = edge.sourceTerminal ? edge.sourceSide : 'center'
  const endSide = edge.targetTerminal ? edge.targetSide : 'center'
  return {
    rounded: '0', html: '0', ...portStyle('exit', startSide), ...portStyle('entry', endSide),
    exitPerimeter: '0', entryPerimeter: '0', strokeColor: '#1f2937', strokeWidth: '1.4',
    dashed: '1', dashPattern: '7 5',
    endArrow: arrow ? 'open' : 'none', endFill: '0', pointerEvents: '0', pokeKind: 'physical',
    pokeRoute: 'transition-lane', pokeGroup: edge.group,
    pokePhysicalRole: edge.role, pokeRelationKind: edge.relationKind, pokeSemanticRefs: edge.semanticRefs.join(','),
    pokeBundleFamilyKey: edge.bundleFamilyKey, pokeBundleId: edge.bundleId,
    pokeStyleClass: edge.styleClass, pokeShareClass: edge.shareClass,
    pokeDirectionClass: edge.directionClass, pokeArrowMode: edge.arrowMode,
    pokeResourceIds: edge.resourceIds.join(','),
  }
}

function bundleIdFor(semantic) {
  const bytes = JSON.stringify({
    terminalId: semantic.targetId,
    terminalRole: 'target',
    bundleFamilyKey: semantic.bundleFamilyKey,
    styleClass: TRANSITION_RELATION.styleClass,
    shareClass: TRANSITION_RELATION.shareClass,
    directionClass: TRANSITION_RELATION.directionClass,
    arrowMode: TRANSITION_RELATION.arrowMode,
  })
  return `bundle-${createHash('sha256').update(bytes, 'utf8').digest('hex')}`
}

function buildPlanarGraph(model, routes) {
  const segments = rawSegments(routes)
  const junctionPoints = new Map()
  for (const segment of segments) {
    for (const pointValue of sortedBreakpoints(segment)) {
      if (!terminalAt(segment.route, pointValue)) junctionPoints.set(canonicalPointKey(pointValue), pointValue)
    }
  }
  const sortedJunctions = [...junctionPoints.values()].sort((left, right) => left.y - right.y || left.x - right.x)
  const junctionIdByPoint = new Map(sortedJunctions.map((pointValue, index) => [canonicalPointKey(pointValue), `route-junction--${pad(index, 3)}`]))
  const junctions = sortedJunctions.map((pointValue, index) => ({
    id: `route-junction--${pad(index, 3)}`, x: pointValue.x, y: pointValue.y, group: 'transition', role: 'bend-or-intersection',
  }))
  const atomsByKey = new Map()
  const pathAtoms = new Map(routes.map(({ semantic }) => [semantic.id, []]))
  for (const segment of segments) {
    const breakpoints = sortedBreakpoints(segment)
    breakpoints.slice(1).forEach((end, index) => {
      const start = breakpoints[index]
      const key = canonicalSegmentKey(start, end)
      let atom = atomsByKey.get(key)
      if (!atom) {
        atom = {
          key, start, end, group: segment.route.group, role: segment.role,
          uses: [], semanticRefs: [], relationKinds: [], bundleFamilyKeys: [], finalFor: [],
        }
        atomsByKey.set(key, atom)
      } else if ((ROLE_PRIORITY[segment.role] ?? 99) < (ROLE_PRIORITY[atom.role] ?? 99)) {
        atom.role = segment.role
        atom.group = segment.route.group
      }
      atom.uses.push({ semanticId: segment.route.semantic.id, start, end })
      if (!atom.semanticRefs.includes(segment.route.semantic.id)) atom.semanticRefs.push(segment.route.semantic.id)
      if (!atom.relationKinds.includes(segment.route.semantic.relationKind)) atom.relationKinds.push(segment.route.semantic.relationKind)
      if (!atom.bundleFamilyKeys.includes(segment.route.semantic.bundleFamilyKey)) atom.bundleFamilyKeys.push(segment.route.semantic.bundleFamilyKey)
      if (samePoint(end, segment.route.points.at(-1))) atom.finalFor.push(segment.route.semantic.id)
      pathAtoms.get(segment.route.semantic.id).push({ key, start, end })
    })
  }
  const sortedAtoms = [...atomsByKey.values()].sort((left, right) => {
    const group = left.group.localeCompare(right.group, 'en')
    const role = (ROLE_PRIORITY[left.role] ?? 99) - (ROLE_PRIORITY[right.role] ?? 99)
    return group || role || left.start.y - right.start.y || left.start.x - right.start.x || left.end.y - right.end.y || left.end.x - right.end.x
  })
  const counters = new Map()
  const byId = cellMap(model)
  const physicalCells = []
  const physicalEdges = []
  const physicalIdByAtom = new Map()
  for (const atom of sortedAtoms) {
    const counterKey = `${atom.group}|${atom.role}`
    const counter = counters.get(counterKey) ?? 0
    counters.set(counterKey, counter + 1)
    const id = `route-edge--${atom.group}--${atom.role}--${pad(counter)}`
    const firstUse = atom.uses[0]
    const route = routes.find(({ semantic }) => semantic.id === firstUse.semanticId)
    const sourceTerminal = terminalAt(route, atom.start)
    const targetTerminal = terminalAt(route, atom.end)
    const sourceId = sourceTerminal ?? junctionIdByPoint.get(canonicalPointKey(atom.start))
    const targetId = targetTerminal ?? junctionIdByPoint.get(canonicalPointKey(atom.end))
    if (!sourceId || !targetId) throw new Error(`User Journey physical terminal 구성 실패: ${id}`)
    atom.semanticRefs.sort()
    if (atom.relationKinds.length !== 1) {
      throw new Error(`User Journey physical atom relationKind 혼합 금지: ${atom.key} [${atom.relationKinds.join(',')}]`)
    }
    if (atom.bundleFamilyKeys.length !== 1) {
      throw new Error(`User Journey physical atom bundleFamilyKey 혼합 금지: ${atom.key} [${atom.bundleFamilyKeys.join(',')}]`)
    }
    const [relationKind] = atom.relationKinds
    const [bundleFamilyKey] = atom.bundleFamilyKeys
    const bundleId = bundleIdFor(route.semantic)
    const arrow = atom.finalFor.length > 0
    const resourceIds = [
      `trunk:${bundleId}`,
      ...(sourceTerminal ? [`port:${sourceTerminal}:${sideAt(byId.get(sourceTerminal), atom.start)}:${bundleId}`] : []),
      ...(targetTerminal ? [`port:${targetTerminal}:${sideAt(byId.get(targetTerminal), atom.end)}:${bundleId}`] : []),
      ...(arrow ? [`arrow:${atom.finalFor.sort().join('+')}`] : []),
    ].sort()
    const record = {
      id, sourceId, targetId, group: atom.group, route: 'transition-lane',
      role: atom.role, router: 'deterministic-userjourney-v1', orderedWaypoints: [], semanticRefs: atom.semanticRefs,
      expectedStart: atom.start, expectedEnd: atom.end, relationKind,
      bundleFamilyKey, bundleId,
      styleClass: TRANSITION_RELATION.styleClass, shareClass: TRANSITION_RELATION.shareClass,
      directionClass: TRANSITION_RELATION.directionClass, arrowMode: TRANSITION_RELATION.arrowMode, resourceIds,
      sourceTerminal: Boolean(sourceTerminal), targetTerminal: Boolean(targetTerminal),
      sourceSide: sourceTerminal ? sideAt(byId.get(sourceTerminal), atom.start) : 'center',
      targetSide: targetTerminal ? sideAt(byId.get(targetTerminal), atom.end) : 'center',
    }
    physicalCells.push(edgeCell(id, sourceId, targetId, physicalStyle(record, arrow)))
    physicalEdges.push(record)
    physicalIdByAtom.set(atom.key, id)
  }
  const semanticToPhysical = {}
  for (const route of routes) semanticToPhysical[route.semantic.id] = pathAtoms.get(route.semantic.id).map(({ key }) => physicalIdByAtom.get(key))
  return { junctions, physicalCells, physicalEdges, semanticToPhysical }
}

export function buildPhysicalUserJourney(inputModel) {
  const model = cloneModel(inputModel)
  const semanticVertices = semanticJourneyVertices(model)
  const semanticCells = semanticJourneyEdges(model)
  const decorations = listJourneyDecorationCells(model)
  for (const edge of semanticCells) {
    setCellStyle(edge, {
      pokeKind: 'semantic', opacity: '0', strokeOpacity: '0', fillOpacity: '0', pointerEvents: '0', endArrow: 'none',
    })
    edge.geometry.points = []
  }
  const semanticEdges = semanticCells.map((edge) => ({
    id: edge.id, sourceId: edge.attributes.source, targetId: edge.attributes.target,
    relationKind: edge.style.pokeRelationKind, bundleFamilyKey: edge.style.pokeBundleFamilyKey,
  })).sort((left, right) => left.id.localeCompare(right.id, 'en'))
  const routes = canonicalRoutes(model)
  const planar = buildPlanarGraph(model, routes)
  const junctionCells = planar.junctions.map(({ id, x, y }) => pointVertex(id, x, y, 'transition'))
  const baseCells = model.cells.filter((cell) => cell.style.pokeKind !== 'junction' && cell.style.pokeKind !== 'physical')
  model.cells = [...baseCells, ...junctionCells, ...planar.physicalCells]
  const result = {
    model,
    semanticVertices: semanticVertices.map(({ id }) => id).sort(),
    semanticEdges,
    decorations: decorations.map(({ id }) => id).sort(),
    junctions: planar.junctions,
    physicalEdges: planar.physicalEdges,
    semanticToPhysical: Object.fromEntries(Object.entries(planar.semanticToPhysical).sort(([left], [right]) => left.localeCompare(right, 'en'))),
  }
  result.bundles = [...new Map(result.physicalEdges.map((edge) => [edge.bundleId, {
    id: edge.bundleId,
    bundleFamilyKey: edge.bundleFamilyKey,
    relationKind: edge.relationKind,
    styleClass: edge.styleClass,
    shareClass: edge.shareClass,
    directionClass: edge.directionClass,
    arrowMode: edge.arrowMode,
    semanticRefs: result.physicalEdges.filter(({ bundleId }) => bundleId === edge.bundleId)
      .flatMap(({ semanticRefs }) => semanticRefs).filter((id, index, values) => values.indexOf(id) === index).sort(),
  }])).values()].sort((left, right) => left.id.localeCompare(right.id, 'en'))
  return result
}

function endpointFor(cell, terminal, prefix) {
  const bounds = boundsOf(terminal)
  return {
    x: bounds.x + bounds.width * Number(cell.style[`${prefix}X`]),
    y: bounds.y + bounds.height * Number(cell.style[`${prefix}Y`]),
  }
}

export function physicalEndpoints(model, physical) {
  const byId = cellMap(model)
  const cell = byId.get(physical.id)
  return [endpointFor(cell, byId.get(physical.sourceId), 'exit'), endpointFor(cell, byId.get(physical.targetId), 'entry')]
}
