import {
  USECASE_SEMANTIC_CONTRACT,
  boundsOf,
  semanticUseCaseEdges,
  semanticUseCaseVertices,
  listUseCaseDecorationCells,
} from './usecase-layout.mjs'
import { cellMap, cloneModel, edgeCell, pointVertex, setCellStyle } from './xml-model.mjs'

const ROLE_PRIORITY = Object.freeze({ stem: 0, spine: 1, entry: 2, rail: 3, branch: 4, relation: 5 })

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
  throw new Error(`Use Case port side 오류: ${id}.${side}`)
}

function actorRoute(byId, semantic, spec) {
  const start = port(byId, semantic.sourceId, spec.actorSide)
  const end = port(byId, semantic.targetId, spec.targetSide)
  const points = [
    start,
    point(spec.spineX, start.y),
    point(spec.spineX, spec.laneY),
    point(spec.railX, spec.laneY),
    point(spec.railX, end.y),
    end,
  ]
  const roles = ['stem', 'spine', 'entry', 'rail', 'branch']
  if (samePoint(points.at(-2), points.at(-1))) {
    points.splice(-2, 1)
    roles.splice(-2, 1)
  }
  return {
    semantic,
    group: semantic.sourceId.replace(/^ac-/, ''),
    points,
    roles,
  }
}

function featureRoute(byId, semantic, steps) {
  const points = steps.map((step) => {
    if (step.id) return port(byId, step.id, step.side)
    return point(step.x, step.y)
  })
  return { semantic, group: 'feature', points, roles: points.slice(1).map(() => 'relation') }
}

function rawRoutes(model) {
  const byId = cellMap(model)
  const semanticById = new Map(semanticUseCaseEdges(model).map((edge) => [edge.id, {
    id: edge.id,
    sourceId: edge.attributes.source,
    targetId: edge.attributes.target,
    relationKind: edge.style.pokeRelationKind,
  }]))
  const actorSpecs = {
    'edge-ac-streamer-to-uc-plugin-install': { actorSide: 'right', spineX: 280, laneY: 220, railX: 360, targetSide: 'left' },
    'edge-ac-streamer-to-uc-simulcast': { actorSide: 'right', spineX: 280, laneY: 220, railX: 360, targetSide: 'left' },
    'edge-ac-streamer-to-uc-hotkey': { actorSide: 'right', spineX: 280, laneY: 220, railX: 360, targetSide: 'left' },
    'edge-ac-streamer-to-uc-auto-reconnect': { actorSide: 'right', spineX: 280, laneY: 220, railX: 960, targetSide: 'right' },
    'edge-ac-streamer-to-uc-live-watch': { actorSide: 'right', spineX: 280, laneY: 200, railX: 1100, targetSide: 'left' },
    'edge-ac-streamer-to-uc-clip-range': { actorSide: 'right', spineX: 280, laneY: 620, railX: 1100, targetSide: 'left' },
    'edge-ac-streamer-to-uc-yt-oauth': { actorSide: 'right', spineX: 280, laneY: 640, railX: 1800, targetSide: 'left' },
    'edge-ac-streamer-to-uc-invite': { actorSide: 'right', spineX: 280, laneY: 640, railX: 960, targetSide: 'right' },
    'edge-ac-streamer-to-uc-approve': { actorSide: 'right', spineX: 280, laneY: 640, railX: 960, targetSide: 'right' },
    'edge-ac-editor-to-uc-live-watch': { actorSide: 'left', spineX: 2480, laneY: 180, railX: 1410, targetSide: 'right' },
    'edge-ac-editor-to-uc-jumpcard-list': { actorSide: 'left', spineX: 2480, laneY: 180, railX: 1410, targetSide: 'right' },
    'edge-ac-editor-to-uc-clip-range': { actorSide: 'left', spineX: 2480, laneY: 650, railX: 1410, targetSide: 'right' },
    'edge-ac-editor-to-uc-upload': { actorSide: 'left', spineX: 2480, laneY: 650, railX: 2280.5, targetSide: 'top' },
    'edge-ac-editor-to-uc-vod-clip': { actorSide: 'left', spineX: 2480, laneY: 190, railX: 2140, targetSide: 'right' },
    'edge-ac-editor-to-uc-auto-upload': { actorSide: 'left', spineX: 2480, laneY: 1140, railX: 1999.5, targetSide: 'bottom' },
    'edge-ac-ops-to-uc-ops-account': { actorSide: 'right', spineX: 250, laneY: 1400, railX: 360, targetSide: 'left' },
    'edge-ac-ops-to-uc-ops-monitor': { actorSide: 'right', spineX: 250, laneY: 1400, railX: 960, targetSide: 'right' },
    'edge-ac-ops-to-uc-ops-incident': { actorSide: 'right', spineX: 250, laneY: 1400, railX: 360, targetSide: 'left' },
    'edge-ac-ops-to-uc-ops-stats': { actorSide: 'right', spineX: 250, laneY: 1400, railX: 960, targetSide: 'right' },
  }
  const routes = []
  for (const edge of USECASE_SEMANTIC_CONTRACT.edges.filter(({ relationKind }) => relationKind === 'actor')) {
    const semantic = semanticById.get(edge.id)
    if (edge.id === 'edge-ac-streamer-to-uc-yt-oauth') {
      const start = port(byId, semantic.sourceId, 'right')
      const end = port(byId, semantic.targetId, 'left')
      routes.push({
        semantic,
        group: 'streamer',
        points: [
          start, point(280, start.y), point(280, 640), point(960, 640),
          point(960, 810), point(1800, 810), point(1800, end.y), end,
        ],
        roles: ['stem', 'spine', 'entry', 'rail', 'rail', 'rail', 'branch'],
      })
    } else if (edge.id === 'edge-ac-editor-to-uc-auto-upload') {
      const start = port(byId, semantic.sourceId, 'left')
      const end = port(byId, semantic.targetId, 'bottom')
      routes.push({
        semantic,
        group: 'editor',
        points: [
          start,
          point(2480, start.y),
          point(2480, 650),
          point(2124, 650),
          point(2124, 810),
          point(1870, 810),
          point(1870, 907),
          point(2148, 907),
          point(2148, 1080),
          point(end.x, 1080),
          end,
        ],
        roles: ['stem', 'spine', 'entry', 'rail', 'entry', 'rail', 'entry', 'rail', 'entry', 'branch'],
      })
    } else {
      routes.push(actorRoute(byId, semantic, actorSpecs[edge.id]))
    }
  }
  const featureSpecs = {
    'edge-uc-auto-highlight-to-uc-jumpcard-list': [
      { id: 'uc-auto-highlight', side: 'bottom' }, { x: 1540.5, y: 590 }, { x: 1080, y: 590 },
      { x: 1080, y: 381 }, { x: 1259.5, y: 381 }, { id: 'uc-jumpcard-list', side: 'top' },
    ],
    'edge-uc-subtitle-to-uc-title': [
      { id: 'uc-subtitle', side: 'left' }, { x: 1400, y: 859 }, { x: 1400, y: 955 },
      { id: 'uc-title', side: 'right' },
    ],
    'edge-uc-template-to-uc-auto-upload': [
      { id: 'uc-template', side: 'right' }, { x: 2420, y: 859 }, { x: 2420, y: 1100 }, { x: 1810, y: 1100 },
      { x: 1810, y: 955 }, { id: 'uc-auto-upload', side: 'left' },
    ],
    'edge-uc-vod-clip-to-uc-clip-range': [
      { id: 'uc-vod-clip', side: 'left' }, { x: 1830, y: 429 }, { x: 1830, y: 620 },
      { x: 1259.5, y: 620 }, { id: 'uc-clip-range', side: 'top' },
    ],
    'edge-uc-hotkey-to-uc-jumpcard-list': [
      { id: 'uc-hotkey', side: 'bottom' }, { x: 519.5, y: 590 }, { x: 1080, y: 590 },
      { x: 1080, y: 381 }, { x: 1259.5, y: 381 }, { id: 'uc-jumpcard-list', side: 'top' },
    ],
    'edge-uc-approve-to-uc-upload': [
      { id: 'uc-approve', side: 'bottom' }, { x: 800.5, y: 1170 }, { x: 2490, y: 1170 },
      { x: 2490, y: 763 }, { id: 'uc-upload', side: 'right' },
    ],
    'edge-uc-upload-to-uc-cc': [
      { id: 'uc-upload', side: 'left' }, { x: 2135, y: 763 }, { x: 2135, y: 859 },
      { id: 'uc-cc', side: 'right' },
    ],
  }
  for (const edge of USECASE_SEMANTIC_CONTRACT.edges.filter(({ relationKind }) => relationKind === 'feature')) {
    routes.push(featureRoute(byId, semanticById.get(edge.id), featureSpecs[edge.id]))
  }
  return routes
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
  if (left.semantic.relationKind === 'actor' && right.semantic.relationKind === 'actor'
    && left.semantic.sourceId === right.semantic.sourceId) return true
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
      if (samePoint(start, end)) throw new Error(`Use Case zero length raw segment: ${route.semantic.id}[${index}]`)
      if (start.x !== end.x && start.y !== end.y) throw new Error(`Use Case diagonal raw segment: ${route.semantic.id}[${index}]`)
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
  throw new Error(`Use Case endpoint가 중앙 포트가 아닙니다: ${cell.id}@${canonicalPointKey(pointValue)}`)
}

function portStyle(prefix, side) {
  if (side === 'left') return { [`${prefix}X`]: '0', [`${prefix}Y`]: '0.5' }
  if (side === 'right') return { [`${prefix}X`]: '1', [`${prefix}Y`]: '0.5' }
  if (side === 'top') return { [`${prefix}X`]: '0.5', [`${prefix}Y`]: '0' }
  if (side === 'bottom') return { [`${prefix}X`]: '0.5', [`${prefix}Y`]: '1' }
  return { [`${prefix}X`]: '0.5', [`${prefix}Y`]: '0.5' }
}

function pad(index, width = 3) {
  return String(index + 1).padStart(width, '0')
}

function physicalStyle(edge, relationKind, arrow) {
  const startSide = edge.sourceTerminal ? edge.sourceSide : 'center'
  const endSide = edge.targetTerminal ? edge.targetSide : 'center'
  return {
    rounded: '0', html: '0', ...portStyle('exit', startSide), ...portStyle('entry', endSide),
    exitPerimeter: '0', entryPerimeter: '0', strokeColor: '#111111', strokeWidth: '1.2',
    dashed: relationKind === 'feature' ? '1' : '0', dashPattern: relationKind === 'feature' ? '6 5' : '',
    endArrow: arrow ? 'open' : 'none', endFill: '0', pointerEvents: '0', pokeKind: 'physical',
    pokeRoute: relationKind === 'actor' ? 'actor-spine' : 'feature-lane', pokeGroup: edge.group,
    pokePhysicalRole: edge.role, pokeRelationKind: relationKind, pokeSemanticRefs: edge.semanticRefs.join(','),
  }
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
  const junctionIdByPoint = new Map(sortedJunctions.map((pointValue, index) => [canonicalPointKey(pointValue), `route-junction--${pad(index)}`]))
  const junctions = sortedJunctions.map((pointValue, index) => ({
    id: `route-junction--${pad(index)}`, x: pointValue.x, y: pointValue.y, group: 'usecase', role: 'bend-or-intersection',
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
          uses: [], semanticRefs: [], relationKinds: [], finalFor: [],
        }
        atomsByKey.set(key, atom)
      } else if ((ROLE_PRIORITY[segment.role] ?? 99) < (ROLE_PRIORITY[atom.role] ?? 99)) {
        atom.role = segment.role
        atom.group = segment.route.group
      }
      atom.uses.push({ semanticId: segment.route.semantic.id, start, end })
      if (!atom.semanticRefs.includes(segment.route.semantic.id)) atom.semanticRefs.push(segment.route.semantic.id)
      if (!atom.relationKinds.includes(segment.route.semantic.relationKind)) atom.relationKinds.push(segment.route.semantic.relationKind)
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
    const id = `route-edge--${atom.group}--${atom.role}--${pad(counter, 2)}`
    const firstUse = atom.uses[0]
    const sourceTerminal = terminalAt(routes.find(({ semantic }) => semantic.id === firstUse.semanticId), atom.start)
    const targetTerminal = terminalAt(routes.find(({ semantic }) => semantic.id === firstUse.semanticId), atom.end)
    const sourceId = sourceTerminal ?? junctionIdByPoint.get(canonicalPointKey(atom.start))
    const targetId = targetTerminal ?? junctionIdByPoint.get(canonicalPointKey(atom.end))
    if (!sourceId || !targetId) throw new Error(`Use Case physical terminal 구성 실패: ${id}`)
    atom.semanticRefs.sort()
    if (atom.relationKinds.length !== 1) {
      throw new Error(`Use Case physical atom relationKind 혼합 금지: ${atom.key} [${atom.relationKinds.join(',')}]`)
    }
    const [relationKind] = atom.relationKinds
    const record = {
      id, sourceId, targetId, group: atom.group, route: relationKind === 'actor' ? 'actor-spine' : 'feature-lane',
      role: atom.role, router: 'deterministic-usecase-v1', orderedWaypoints: [], semanticRefs: atom.semanticRefs,
      expectedStart: atom.start, expectedEnd: atom.end, relationKind,
      sourceTerminal: Boolean(sourceTerminal), targetTerminal: Boolean(targetTerminal),
      sourceSide: sourceTerminal ? sideAt(byId.get(sourceTerminal), atom.start) : 'center',
      targetSide: targetTerminal ? sideAt(byId.get(targetTerminal), atom.end) : 'center',
    }
    const arrow = atom.finalFor.length > 0
    physicalCells.push(edgeCell(id, sourceId, targetId, physicalStyle(record, relationKind, arrow)))
    physicalEdges.push(record)
    physicalIdByAtom.set(atom.key, id)
  }
  const semanticToPhysical = {}
  for (const route of routes) semanticToPhysical[route.semantic.id] = pathAtoms.get(route.semantic.id).map(({ key }) => physicalIdByAtom.get(key))
  return { junctions, physicalCells, physicalEdges, semanticToPhysical }
}

function actorSpineMetadata(semanticEdges, physicalEdges, semanticToPhysical) {
  const result = {}
  for (const actorId of USECASE_SEMANTIC_CONTRACT.actorIds) {
    const edgeIds = semanticEdges.filter(({ sourceId, relationKind }) => sourceId === actorId && relationKind === 'actor').map(({ id }) => id)
    const shared = edgeIds.map((id) => new Set(semanticToPhysical[id]))
      .reduce((left, right) => new Set([...left].filter((id) => right.has(id))))
    const stemIds = [...shared].filter((id) => physicalEdges.find((edge) => edge.id === id)?.role === 'stem')
    const spineIds = physicalEdges.filter((edge) => edge.group === actorId.replace(/^ac-/, '') && edge.role === 'spine').map(({ id }) => id)
    if (stemIds.length !== 1 || spineIds.length === 0) throw new Error(`Use Case actor spine 생성 실패: ${actorId}`)
    result[actorId] = { stemId: stemIds[0], spineIds, semanticEdgeIds: edgeIds }
  }
  return result
}

export function buildPhysicalUseCase(inputModel) {
  const model = cloneModel(inputModel)
  const semanticVertices = semanticUseCaseVertices(model)
  const semanticCells = semanticUseCaseEdges(model)
  const decorations = listUseCaseDecorationCells(model)
  for (const edge of semanticCells) {
    setCellStyle(edge, {
      pokeKind: 'semantic', opacity: '0', strokeOpacity: '0', fillOpacity: '0', pointerEvents: '0', endArrow: 'none',
    })
    edge.geometry.points = []
  }
  const semanticEdges = semanticCells.map((edge) => ({
    id: edge.id, sourceId: edge.attributes.source, targetId: edge.attributes.target,
    relationKind: edge.style.pokeRelationKind,
  })).sort((left, right) => left.id.localeCompare(right.id, 'en'))
  const routes = rawRoutes(model)
  const planar = buildPlanarGraph(model, routes)
  const junctionCells = planar.junctions.map(({ id, x, y }) => pointVertex(id, x, y, 'usecase'))
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
  result.actorSpines = actorSpineMetadata(result.semanticEdges, result.physicalEdges, result.semanticToPhysical)
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
