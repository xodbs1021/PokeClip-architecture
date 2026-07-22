import { cellMap, cloneModel, setCellStyle } from './xml-model.mjs'
import { assertIaSemanticContract } from './semantic-contract.mjs'

export const IA_POLICY = Object.freeze({
  profile: 'pokeclip-ia-tree-v1',
  EPS: 1,
  GRID: 4,
  MIN_GUTTER: 64,
  MIN_ROW_GAP: 12,
  PREFERRED_ROW_GAP: 16,
  NODE_CLEARANCE: 12,
  MIN_LEAD: 16,
  PREFERRED_LEAD: 24,
  MIN_ARROW_RUN: 16,
  LANE_GAP: 16,
  MIN_MEANINGFUL_SEGMENT: 16,
})

export const IA_COLUMNS = Object.freeze({
  left: Object.freeze({ action: { x: 103, width: 255 }, page: { x: 422, width: 260 }, category: { x: 746, width: 225 } }),
  dashboard: Object.freeze({ x: 1035, width: 210, center: 1140 }),
  right: Object.freeze({ category: { x: 1309, width: 225 }, page: { x: 1598, width: 260 }, action: { x: 1922, width: 255 } }),
})

const LEFT_ALIASES = ['obs', 'onboarding', 'live', 'clip-editor']
const RIGHT_ALIASES = ['clip-library', 'vod', 'settings', 'operations']
const ROW_CENTERS = new Map([
  ['obs', 396], ['clip-library', 396],
  ['onboarding', 636], ['vod', 636],
  ['live', 900], ['settings', 900],
  ['clip-editor', 1236], ['operations', 1236],
])

function number(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`숫자 geometry가 아닙니다: ${value}`)
  return parsed
}

export function semanticVertices(model) {
  return model.cells.filter((cell) => cell.attributes.vertex === '1' && cell.id.startsWith('ia-'))
}

export function semanticEdges(model) {
  return model.cells.filter((cell) => cell.attributes.edge === '1' && cell.id.startsWith('edge-ia-'))
}

export function boundsOf(cell) {
  return {
    x: number(cell.geometry.attributes.x),
    y: number(cell.geometry.attributes.y),
    width: number(cell.geometry.attributes.width),
    height: number(cell.geometry.attributes.height),
  }
}

export function centerOf(cell) {
  const bounds = boundsOf(cell)
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
}

function aliasOf(id) {
  return [...LEFT_ALIASES, ...RIGHT_ALIASES].find((alias) => id === `ia-${alias}` || id.startsWith(`ia-${alias}-`)) ?? null
}

function roleOf(id) {
  if (id === 'ia-login' || id === 'ia-dashboard') return 'root'
  if (/^ia-(?:obs|onboarding|live|clip-editor|clip-library|vod|settings|operations)$/.test(id)) return 'category'
  if (id.includes('-page-')) return 'page'
  if (id.includes('-action-')) return 'action'
  throw new Error(`IA vertex role을 분류할 수 없습니다: ${id}`)
}

function sideOf(alias) {
  if (LEFT_ALIASES.includes(alias)) return 'left'
  if (RIGHT_ALIASES.includes(alias)) return 'right'
  throw new Error(`IA side를 분류할 수 없습니다: ${alias}`)
}

function groupId(sourceId) {
  return sourceId === 'ia-dashboard' ? 'root-products' : sourceId.replace(/^ia-/, '')
}

function horizontalPorts(side) {
  return side === 'left'
    ? { exitX: '0', exitY: '0.5', entryX: '1', entryY: '0.5' }
    : { exitX: '1', exitY: '0.5', entryX: '0', entryY: '0.5' }
}

function canonicalColumn(side, role) {
  if (role === 'root') return null
  return IA_COLUMNS[side][role]
}

function assertSemanticContract(vertices, edges) {
  const vertexIds = new Set(vertices.map(({ id }) => id))
  for (const edge of edges) {
    if (!vertexIds.has(edge.attributes.source) || !vertexIds.has(edge.attributes.target)) {
      throw new Error(`semantic edge terminal 누락: ${edge.id}`)
    }
  }
  assertIaSemanticContract(
    vertices.map(({ id }) => id),
    edges.map((edge) => ({ id: edge.id, sourceId: edge.attributes.source, targetId: edge.attributes.target })),
  )
}

export function normalizeIaSource(inputModel) {
  const model = cloneModel(inputModel)
  const vertices = semanticVertices(model)
  const edges = semanticEdges(model)
  assertSemanticContract(vertices, edges)
  const byId = cellMap(model)
  const layoutShifts = []

  const dashboard = byId.get('ia-dashboard')
  dashboard.geometry.attributes.x = String(IA_COLUMNS.dashboard.x)
  dashboard.geometry.attributes.width = String(IA_COLUMNS.dashboard.width)
  setCellStyle(dashboard, { pokeKind: 'semantic' })

  const login = byId.get('ia-login')
  const loginBounds = boundsOf(login)
  login.geometry.attributes.x = String(IA_COLUMNS.dashboard.center - loginBounds.width / 2)
  setCellStyle(login, { pokeKind: 'semantic' })

  for (const alias of [...LEFT_ALIASES, ...RIGHT_ALIASES]) {
    const category = byId.get(`ia-${alias}`)
    if (!category) throw new Error(`IA category 누락: ${alias}`)
    const currentCenter = centerOf(category).y
    const desiredCenter = ROW_CENTERS.get(alias)
    const deltaY = desiredCenter - currentCenter
    layoutShifts.push({ subtree: alias, deltaY })
    const side = sideOf(alias)
    for (const vertex of vertices.filter(({ id }) => aliasOf(id) === alias)) {
      const role = roleOf(vertex.id)
      const column = canonicalColumn(side, role)
      vertex.geometry.attributes.x = String(column.x)
      vertex.geometry.attributes.width = String(column.width)
      vertex.geometry.attributes.y = String(number(vertex.geometry.attributes.y) + deltaY)
      setCellStyle(vertex, { pokeKind: 'semantic' })
    }
  }

  const childrenBySource = new Map()
  for (const edge of edges) {
    const children = childrenBySource.get(edge.attributes.source) ?? []
    children.push(edge)
    childrenBySource.set(edge.attributes.source, children)
  }
  for (const [sourceId, children] of childrenBySource) {
    const route = children.length >= 2 ? 'trunk' : 'direct'
    const group = groupId(sourceId)
    for (const edge of children) {
      const targetAlias = aliasOf(edge.attributes.target)
      const side = targetAlias ? sideOf(targetAlias) : edge.attributes.source === 'ia-login' ? 'down' : null
      const ports = side === 'down'
        ? { exitX: '0.5', exitY: '1', entryX: '0.5', entryY: '0' }
        : horizontalPorts(side)
      setCellStyle(edge, {
        edgeStyle: 'orthogonalEdgeStyle', rounded: '0', html: '0', orthogonalLoop: '1', jettySize: 'auto',
        ...ports, exitPerimeter: '0', entryPerimeter: '0', pokeKind: 'semantic', pokeRoute: route, pokeGroup: group,
      })
      edge.geometry.points = []
    }
  }

  return {
    model,
    layout: {
      columns: IA_COLUMNS,
      pairedProductRowCenters: [396, 636, 900, 1236],
      layoutShifts,
    },
  }
}

export function iaSideForVertex(id) {
  const alias = aliasOf(id)
  return alias ? sideOf(alias) : null
}

export function iaGroupId(sourceId) {
  return groupId(sourceId)
}
