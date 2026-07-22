import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { cellMap, cloneModel, setCellStyle } from './xml-model.mjs'

const contractUrl = new URL('../../shared/userjourney-semantic-contract.json', import.meta.url)
const contractText = readFileSync(contractUrl, 'utf8')
export const USERJOURNEY_SEMANTIC_CONTRACT = Object.freeze(JSON.parse(contractText))
export const USERJOURNEY_CONTRACT_HASH = createHash('sha256').update(contractText).digest('hex')

// USERJOURNEY_POLICY는 밴드·클리어런스 상수의 단일 소스다.
// EDGE_Y_BAND는 두 전이 엣지(y390~600)가 지나는 세로 통로이며,
// annotation envelope가 이 밴드를 침범하면 hard FAIL이다(조건1).
export const USERJOURNEY_POLICY = Object.freeze({
  profile: 'deterministic-userjourney',
  engineVersion: 'userjourney-v1',
  contractHash: USERJOURNEY_CONTRACT_HASH,
  EPS: 1,
  GRID: 2,
  NODE_CLEARANCE: 4,
  LANE_GAP: 8,
  expectedCrossings: Object.freeze([]),
  expectedOverlaps: Object.freeze([]),
  EDGE_Y_BAND: Object.freeze({ top: 240, bottom: 940 }),
  ANNOTATION_BAND: Object.freeze({ titleMaxBottom: 130, stripMinTop: 1017, footerMinTop: 1226 }),
})

const JOURNEY_CARD_STYLE = Object.freeze({
  rounded: '1', whiteSpace: 'wrap', html: '0', strokeColor: '#1f2937', fillColor: '#ffffff',
  fontColor: '#111827', fontStyle: '1', pokeKind: 'semantic', pokeSemanticRole: 'journey-card',
})

const OVERLAY_STYLE = Object.freeze({
  rounded: '1', whiteSpace: 'wrap', html: '0', dashed: '1', strokeColor: '#c7cdd6', fillColor: 'none',
  fontColor: '#6b7280', align: 'left', verticalAlign: 'top', spacing: '12',
  pokeKind: 'decoration', pokeContainerKind: 'overlay',
})

const ANNOTATION_STYLE = Object.freeze({
  rounded: '0', whiteSpace: 'wrap', html: '0', dashed: '1', strokeColor: '#d1d5db', fillColor: 'none',
  fontColor: '#6b7280', align: 'left', verticalAlign: 'top', spacing: '12',
  pokeKind: 'decoration', pokeContainerKind: 'annotation',
})

function exactSet(actual, expected) {
  return actual.length === expected.length && new Set(actual).size === actual.length
    && actual.every((id) => expected.includes(id))
}

function edgeTuple(edge) {
  return `${edge.id}|${edge.attributes.source}|${edge.attributes.target}|${edge.style.pokeRelationKind}`
}

function canonicalEdgeTuple(edge) {
  return `${edge.id}|${edge.sourceId}|${edge.targetId}|${edge.relationKind}`
}

function assertPlainCell(cell) {
  if (cell.style.html !== '0') throw new Error(`User Journey source는 html=0이어야 합니다: ${cell.id}`)
  const value = cell.attributes.value ?? ''
  if (/[<>]/.test(value) || /&(?:lt|gt);/i.test(value)) throw new Error(`User Journey HTML label 금지: ${cell.id}`)
  if (cell.geometry.points.length > 0) throw new Error(`User Journey source waypoint 금지: ${cell.id}`)
}

export function assertSourceUserJourneyContract(model) {
  const contract = USERJOURNEY_SEMANTIC_CONTRACT
  const vertices = model.cells.filter((cell) => cell.attributes.vertex === '1')
  const semanticVertices = vertices.filter((cell) => cell.style.pokeKind === 'semantic')
  const decorations = vertices.filter((cell) => cell.style.pokeKind === 'decoration')
  const edges = model.cells.filter((cell) => cell.attributes.edge === '1')
  if (!exactSet(decorations.map(({ id }) => id), contract.decorationIds)) {
    throw new Error('User Journey decoration contract 불일치')
  }
  if (!exactSet(semanticVertices.map(({ id }) => id), contract.nodeIds)) {
    throw new Error('User Journey semantic contract vertex ID 불일치')
  }
  if (vertices.length !== semanticVertices.length + decorations.length) {
    throw new Error('User Journey decoration/semantic graph partition 불일치')
  }
  const actualEdgeTuples = edges.map(edgeTuple)
  const expectedEdgeTuples = contract.edges.map(canonicalEdgeTuple)
  if (!exactSet(actualEdgeTuples, expectedEdgeTuples)) throw new Error('User Journey semantic contract edge tuple 불일치')
  const contractById = new Map(contract.edges.map((edge) => [edge.id, edge]))
  for (const edge of edges) {
    const bundleFamilyKey = edge.style.pokeBundleFamilyKey
    if (bundleFamilyKey && bundleFamilyKey !== contractById.get(edge.id)?.bundleFamilyKey) {
      throw new Error(`User Journey semantic contract bundleFamilyKey 불일치: ${edge.id}`)
    }
    if (edge.style.pokeRelationKind !== 'transition') throw new Error(`User Journey relationKind는 transition만 허용: ${edge.id}`)
  }
  if (edges.some((edge) => edge.style.pokeKind !== 'semantic')) throw new Error('User Journey semantic edge tag 불일치')

  const byId = cellMap(model)
  for (const node of contract.nodes) {
    const cell = byId.get(node.id)
    if (cell.attributes.value !== node.label || cell.style.pokeSemanticRole !== 'journey-card'
      || cell.style.pokeLane !== node.laneId || cell.style.pokePhase !== node.phaseId) {
      throw new Error(`User Journey semantic contract journey-card 불일치: ${node.id}`)
    }
  }
  for (const overlay of contract.overlays) {
    const cell = byId.get(overlay.id)
    if (cell.attributes.value !== overlay.label || cell.style.pokeContainerKind !== 'overlay'
      || cell.style.pokeAxis !== overlay.axis) {
      throw new Error(`User Journey overlay decoration 불일치: ${overlay.id}`)
    }
  }
  for (const annotation of contract.annotations) {
    const cell = byId.get(annotation.id)
    if (cell.attributes.value !== annotation.label || cell.style.pokeContainerKind !== 'annotation') {
      throw new Error(`User Journey annotation decoration 불일치: ${annotation.id}`)
    }
  }
  for (const cell of [...vertices, ...edges]) assertPlainCell(cell)
}

function setGeometry(cell, spec) {
  cell.geometry.attributes = {
    x: String(spec.x), y: String(spec.y), width: String(spec.w), height: String(spec.h), as: 'geometry',
  }
  cell.geometry.points = []
}

function normalizeJourneyCard(cell, node) {
  setGeometry(cell, node)
  setCellStyle(cell, { ...JOURNEY_CARD_STYLE, pokeLane: node.laneId, pokePhase: node.phaseId })
}

function normalizeOverlay(cell, overlay) {
  setGeometry(cell, overlay)
  setCellStyle(cell, { ...OVERLAY_STYLE, pokeAxis: overlay.axis, pokeOrder: String(overlay.order) })
}

function normalizeAnnotation(cell, annotation) {
  setGeometry(cell, annotation)
  setCellStyle(cell, { ...ANNOTATION_STYLE })
}

export function semanticJourneyVertices(model) {
  const canonical = new Set(USERJOURNEY_SEMANTIC_CONTRACT.nodeIds)
  return model.cells.filter((cell) => cell.attributes.vertex === '1' && cell.style.pokeKind === 'semantic' && canonical.has(cell.id))
}

export function listJourneyDecorationCells(model) {
  const canonical = new Set(USERJOURNEY_SEMANTIC_CONTRACT.decorationIds)
  return model.cells.filter((cell) => cell.attributes.vertex === '1' && cell.style.pokeKind === 'decoration' && canonical.has(cell.id))
}

export function semanticJourneyEdges(model) {
  const canonical = new Set(USERJOURNEY_SEMANTIC_CONTRACT.edges.map(({ id }) => id))
  return model.cells.filter((cell) => cell.attributes.edge === '1' && cell.style.pokeKind === 'semantic' && canonical.has(cell.id))
}

export function boundsOf(cell) {
  const number = (value) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) throw new Error(`User Journey 숫자 geometry 오류: ${cell.id}`)
    return parsed
  }
  return {
    x: number(cell.geometry.attributes.x), y: number(cell.geometry.attributes.y),
    width: number(cell.geometry.attributes.width), height: number(cell.geometry.attributes.height),
  }
}

export function centerOf(cell) {
  const bounds = boundsOf(cell)
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
}

export function annotationEnvelopes(model) {
  const byId = cellMap(model)
  return USERJOURNEY_SEMANTIC_CONTRACT.annotationIds.map((id) => {
    const bounds = boundsOf(byId.get(id))
    return { id, top: bounds.y, bottom: bounds.y + bounds.height }
  })
}

export function normalizeUserJourneySource(inputModel) {
  assertSourceUserJourneyContract(inputModel)
  const model = cloneModel(inputModel)
  const byId = cellMap(model)
  for (const node of USERJOURNEY_SEMANTIC_CONTRACT.nodes) normalizeJourneyCard(byId.get(node.id), node)
  for (const overlay of USERJOURNEY_SEMANTIC_CONTRACT.overlays) normalizeOverlay(byId.get(overlay.id), overlay)
  for (const annotation of USERJOURNEY_SEMANTIC_CONTRACT.annotations) normalizeAnnotation(byId.get(annotation.id), annotation)
  for (const edge of semanticJourneyEdges(model)) {
    const contractEdge = USERJOURNEY_SEMANTIC_CONTRACT.edges.find(({ id }) => id === edge.id)
    setCellStyle(edge, { html: '0', pokeKind: 'semantic', pokeRelationKind: 'transition', pokeBundleFamilyKey: contractEdge.bundleFamilyKey })
    edge.geometry.points = []
  }
  const layout = {
    nodes: USERJOURNEY_SEMANTIC_CONTRACT.nodes,
    overlays: USERJOURNEY_SEMANTIC_CONTRACT.overlays,
    annotations: USERJOURNEY_SEMANTIC_CONTRACT.annotations,
    edgeYBand: USERJOURNEY_POLICY.EDGE_Y_BAND,
  }
  return { model, layout }
}
