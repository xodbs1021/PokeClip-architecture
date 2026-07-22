import { readFileSync } from 'node:fs'
import { cellMap, cloneModel, setCellStyle } from './xml-model.mjs'

const contractUrl = new URL('../../shared/usecase-semantic-contract.json', import.meta.url)
export const USECASE_SEMANTIC_CONTRACT = Object.freeze(JSON.parse(readFileSync(contractUrl, 'utf8')))

export const USECASE_POLICY = Object.freeze({
  profile: 'pokeclip-usecase-actor-spine-v1',
  EPS: 1,
  GRID: 2,
  NODE_CLEARANCE: 4,
  LANE_GAP: 8,
  expectedCrossings: Object.freeze([]),
  expectedOverlaps: Object.freeze([]),
})

export const USECASE_GROUP_LAYOUT = Object.freeze({
  'env-sys': Object.freeze({ x: 350, y: 170, width: 2100, height: 1230 }),
  'grp-broadcast': Object.freeze({ x: 380, y: 250, width: 560, height: 340, column: 0, row: 0 }),
  'grp-account': Object.freeze({ x: 380, y: 680, width: 560, height: 440, column: 0, row: 1 }),
  'grp-ops': Object.freeze({ x: 380, y: 1140, width: 560, height: 240, column: 0, row: 2 }),
  'grp-live': Object.freeze({ x: 1120, y: 250, width: 560, height: 340, column: 1, row: 0 }),
  'grp-vod': Object.freeze({ x: 1860, y: 250, width: 560, height: 340, column: 2, row: 0 }),
  'grp-clip': Object.freeze({ x: 1120, y: 680, width: 560, height: 440, column: 1, row: 1 }),
  'grp-upload': Object.freeze({ x: 1860, y: 680, width: 560, height: 440, column: 2, row: 1 }),
})

const ACTOR_LAYOUT = Object.freeze({
  'ac-streamer': Object.freeze({ x: 96, y: 352, width: 66, height: 120 }),
  'ac-editor': Object.freeze({ x: 2538, y: 600, width: 66, height: 120 }),
  'ac-ops': Object.freeze({ x: 96, y: 1198, width: 66, height: 120 }),
})

const NODE_LAYOUT = Object.freeze({ insetX: 22, insetY: 42, width: 235, height: 82, columnGap: 46, rowGap: 14 })

function setGeometry(cell, bounds) {
  cell.geometry.attributes = {
    ...cell.geometry.attributes,
    x: String(bounds.x),
    y: String(bounds.y),
    width: String(bounds.width),
    height: String(bounds.height),
    as: 'geometry',
  }
  cell.geometry.points = []
}

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

function displayUseCase(item) {
  return item.badge ? `${item.label} [${item.badge}]` : item.label
}

function assertPlainCell(cell) {
  if (cell.style.html !== '0') throw new Error(`Use Case source는 html=0이어야 합니다: ${cell.id}`)
  const value = cell.attributes.value ?? ''
  if (/[<>]/.test(value) || /&(?:lt|gt);/i.test(value)) throw new Error(`Use Case HTML label 금지: ${cell.id}`)
  if (cell.geometry.points.length > 0) throw new Error(`Use Case source waypoint 금지: ${cell.id}`)
}

function assertSourceContract(model) {
  const vertices = model.cells.filter((cell) => cell.attributes.vertex === '1')
  const semanticVertices = vertices.filter((cell) => cell.style.pokeKind === 'semantic')
  const decorations = vertices.filter((cell) => cell.style.pokeKind === 'decoration')
  const edges = model.cells.filter((cell) => cell.attributes.edge === '1')
  const expectedVertexIds = [...USECASE_SEMANTIC_CONTRACT.actorIds, ...USECASE_SEMANTIC_CONTRACT.useCaseIds]
  if (!exactSet(decorations.map(({ id }) => id), USECASE_SEMANTIC_CONTRACT.decorationIds)) {
    throw new Error('Use Case decoration contract 불일치')
  }
  if (!exactSet(semanticVertices.map(({ id }) => id), expectedVertexIds)) {
    throw new Error('Use Case semantic contract vertex ID 불일치')
  }
  if (vertices.length !== semanticVertices.length + decorations.length) {
    throw new Error('Use Case decoration/semantic graph partition 불일치')
  }
  const actualEdgeTuples = edges.map(edgeTuple)
  const expectedEdgeTuples = USECASE_SEMANTIC_CONTRACT.edges.map(canonicalEdgeTuple)
  if (!exactSet(actualEdgeTuples, expectedEdgeTuples)) throw new Error('Use Case semantic contract edge tuple 불일치')
  if (edges.some((edge) => edge.style.pokeKind !== 'semantic')) throw new Error('Use Case semantic edge tag 불일치')

  const byId = cellMap(model)
  for (const actor of USECASE_SEMANTIC_CONTRACT.actors) {
    const cell = byId.get(actor.id)
    if (cell.attributes.value !== actor.label || cell.style.pokeDescription !== actor.description
      || cell.style.pokeSemanticRole !== 'actor') throw new Error(`Use Case semantic contract actor label 불일치: ${actor.id}`)
  }
  for (const useCase of USECASE_SEMANTIC_CONTRACT.useCases) {
    const cell = byId.get(useCase.id)
    if (cell.attributes.value !== displayUseCase(useCase) || cell.style.pokeBadge !== useCase.badge
      || cell.style.pokeDescription !== useCase.description || cell.style.pokeGroup !== useCase.groupId
      || cell.style.pokeSemanticRole !== 'usecase') throw new Error(`Use Case semantic contract label/badge 불일치: ${useCase.id}`)
  }
  for (const decoration of USECASE_SEMANTIC_CONTRACT.decorations) {
    const cell = byId.get(decoration.id)
    if (cell.attributes.value !== decoration.label || cell.style.pokeDecorationKind !== decoration.decorationKind) {
      throw new Error(`Use Case decoration label 불일치: ${decoration.id}`)
    }
  }
  for (const cell of [...vertices, ...edges]) assertPlainCell(cell)
}

function normalizeDecoration(cell, spec) {
  setGeometry(cell, USECASE_GROUP_LAYOUT[cell.id])
  setCellStyle(cell, {
    rounded: '1', whiteSpace: 'wrap', html: '0', dashed: '1', strokeColor: '#9ca3af', fillColor: 'none',
    fontColor: '#374151', align: 'left', verticalAlign: 'top', spacing: '12', pokeKind: 'decoration',
    pokeDecorationKind: spec.decorationKind,
  })
}

function normalizeActor(cell) {
  setGeometry(cell, ACTOR_LAYOUT[cell.id])
  setCellStyle(cell, {
    shape: 'umlActor', verticalLabelPosition: 'bottom', verticalAlign: 'top', html: '0',
    strokeColor: '#111111', fillColor: '#ffffff', fontColor: '#111111', fontStyle: '1',
    pokeKind: 'semantic', pokeSemanticRole: 'actor',
  })
}

function normalizeUseCase(cell, item, indexWithinGroup) {
  const group = USECASE_GROUP_LAYOUT[item.groupId]
  const column = indexWithinGroup % 2
  const row = Math.floor(indexWithinGroup / 2)
  setGeometry(cell, {
    x: group.x + NODE_LAYOUT.insetX + column * (NODE_LAYOUT.width + NODE_LAYOUT.columnGap),
    y: group.y + NODE_LAYOUT.insetY + row * (NODE_LAYOUT.height + NODE_LAYOUT.rowGap),
    width: NODE_LAYOUT.width,
    height: NODE_LAYOUT.height,
  })
  setCellStyle(cell, {
    rounded: '1', whiteSpace: 'wrap', html: '0', strokeColor: '#1f2937', fillColor: '#ffffff',
    fontColor: '#111827', fontStyle: '1', pokeKind: 'semantic', pokeSemanticRole: 'usecase',
    pokeGroup: item.groupId, pokeBadge: item.badge, pokeDescription: item.description,
  })
}

export function semanticUseCaseVertices(model) {
  const canonical = new Set([...USECASE_SEMANTIC_CONTRACT.actorIds, ...USECASE_SEMANTIC_CONTRACT.useCaseIds])
  return model.cells.filter((cell) => cell.attributes.vertex === '1' && cell.style.pokeKind === 'semantic' && canonical.has(cell.id))
}

export function listUseCaseDecorationCells(model) {
  const canonical = new Set(USECASE_SEMANTIC_CONTRACT.decorationIds)
  return model.cells.filter((cell) => cell.attributes.vertex === '1' && cell.style.pokeKind === 'decoration' && canonical.has(cell.id))
}

export function semanticUseCaseEdges(model) {
  const canonical = new Set(USECASE_SEMANTIC_CONTRACT.edges.map(({ id }) => id))
  return model.cells.filter((cell) => cell.attributes.edge === '1' && cell.style.pokeKind === 'semantic' && canonical.has(cell.id))
}

export function boundsOf(cell) {
  const number = (value) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) throw new Error(`Use Case 숫자 geometry 오류: ${cell.id}`)
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

export function normalizeUseCaseSource(inputModel) {
  assertSourceContract(inputModel)
  const model = cloneModel(inputModel)
  const byId = cellMap(model)
  for (const decoration of USECASE_SEMANTIC_CONTRACT.decorations) normalizeDecoration(byId.get(decoration.id), decoration)
  for (const actor of USECASE_SEMANTIC_CONTRACT.actors) normalizeActor(byId.get(actor.id))
  const groupIndexes = new Map()
  for (const item of USECASE_SEMANTIC_CONTRACT.useCases) {
    const index = groupIndexes.get(item.groupId) ?? 0
    normalizeUseCase(byId.get(item.id), item, index)
    groupIndexes.set(item.groupId, index + 1)
  }
  for (const edge of semanticUseCaseEdges(model)) {
    setCellStyle(edge, { html: '0', pokeKind: 'semantic' })
    edge.geometry.points = []
  }
  return {
    model,
    layout: {
      groupGrid: USECASE_GROUP_LAYOUT,
      node: NODE_LAYOUT,
      actors: ACTOR_LAYOUT,
      columns: [380, 1120, 1860],
      rows: [250, 680, 1140],
    },
  }
}
