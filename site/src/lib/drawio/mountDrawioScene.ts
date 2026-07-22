import { Graph, ModelXmlSerializer, type Cell, type CellState } from '@maxgraph/core'
import { buildDrawioTopology, type DrawioCellRecord, type DrawioTopology } from './drawioTopology'

export interface DrawioScene {
  readonly svg: SVGSVGElement
  readonly topology: DrawioTopology
  readonly naturalSize: { width: number; height: number }
  refreshAndCollectGeometry(signal: AbortSignal): Promise<DrawioGeometrySnapshot>
  dispose(): void
}

export interface DrawioGeometrySnapshot {
  readonly vertices: readonly DrawioVertexGeometry[]
  readonly junctions: readonly DrawioJunctionGeometry[]
  readonly edges: readonly DrawioEdgeGeometry[]
}

export interface DrawioJunctionGeometry {
  readonly id: string
  readonly point: DrawioPoint
  readonly group: string | null
}

export interface DrawioVertexGeometry {
  readonly id: string
  readonly pokeKind: DrawioCellRecord['pokeKind']
  readonly bounds: DrawioBounds
  readonly labelBounds: DrawioBounds | null
  readonly labelNodeMapped: boolean
  readonly childCount: number
}

export interface DrawioEdgeGeometry {
  readonly id: string
  readonly sourceId: string
  readonly targetId: string
  readonly points: readonly DrawioPoint[]
  readonly style: Readonly<Record<string, string | number>>
  readonly route: string | null
  readonly group: string | null
  readonly role: string | null
  readonly semanticRefs: readonly string[]
  readonly labelBounds: DrawioBounds | null
}

export interface DrawioBounds extends DrawioPoint {
  readonly width: number
  readonly height: number
}

export interface DrawioPoint {
  readonly x: number
  readonly y: number
}

interface ValidatedDrawioModel {
  readonly modelXml: string
  readonly records: readonly DrawioCellRecord[]
}

const REJECTED_XML_MARKERS = ['<![CDATA[', '&lt;mxGraphModel'] as const

function parseXml(sourceXml: string) {
  if (REJECTED_XML_MARKERS.some((marker) => sourceXml.includes(marker))) {
    throw new Error('압축·CDATA·HTML-escaped draw.io XML은 지원하지 않습니다.')
  }
  const documentNode = new DOMParser().parseFromString(sourceXml, 'application/xml')
  if (documentNode.querySelector('parsererror')) throw new Error('draw.io XML 문법이 올바르지 않습니다.')
  return documentNode
}

function selectSingleModel(documentNode: XMLDocument) {
  const root = documentNode.documentElement
  if (root.tagName === 'mxGraphModel') return root
  if (root.tagName !== 'mxfile') throw new Error('mxGraphModel 또는 mxfile 루트만 허용합니다.')
  const models = root.querySelectorAll('mxGraphModel')
  if (models.length !== 1) throw new Error('mxfile에는 비압축 mxGraphModel이 정확히 하나 있어야 합니다.')
  const diagrams = root.querySelectorAll(':scope > diagram')
  if (diagrams.length !== 1 || !diagrams[0].contains(models[0])) {
    throw new Error('mxfile에는 diagram이 정확히 하나 있어야 합니다.')
  }
  return models[0]
}

function cellKind(cell: Element): DrawioCellRecord['kind'] {
  if (cell.getAttribute('vertex') === '1') return 'vertex'
  if (cell.getAttribute('edge') === '1') return 'edge'
  return 'other'
}

function styleMetadata(style: string): Pick<DrawioCellRecord, 'pokeKind' | 'relationKind' | 'route' | 'group' | 'physicalRole' | 'semanticRefs'> {
  const values = new Map(style.split(';').flatMap((token) => {
    const separator = token.indexOf('=')
    return separator > 0 ? [[token.slice(0, separator), token.slice(separator + 1)] as const] : []
  }))
  const pokeKind = values.get('pokeKind')
  const normalizedKind: DrawioCellRecord['pokeKind'] = pokeKind === 'semantic' || pokeKind === 'junction'
    || pokeKind === 'physical' || pokeKind === 'decoration' ? pokeKind : null
  return {
    pokeKind: normalizedKind,
    relationKind: values.get('pokeRelationKind') ?? null,
    route: values.get('pokeRoute') ?? null,
    group: values.get('pokeGroup') ?? null,
    physicalRole: values.get('pokePhysicalRole') ?? null,
    semanticRefs: Object.freeze((values.get('pokeSemanticRefs') ?? '').split(',').filter(Boolean)),
  }
}

function validateCell(cell: Element, ids: Set<string>): DrawioCellRecord {
  const id = cell.getAttribute('id')?.trim()
  if (!id) throw new Error('모든 mxCell에는 ID가 필요합니다.')
  if (ids.has(id)) throw new Error(`중복 mxCell ID: ${id}`)
  ids.add(id)
  const style = cell.getAttribute('style') ?? ''
  const value = cell.getAttribute('value') ?? ''
  if (/(?:^|;)html=1(?:;|$)/.test(style) || /<[^>]+>/.test(value)) {
    throw new Error(`HTML label은 허용하지 않습니다: ${id}`)
  }
  return {
    id,
    kind: cellKind(cell),
    sourceId: cell.getAttribute('source'),
    targetId: cell.getAttribute('target'),
    ...styleMetadata(style),
  }
}

export function validateDrawioXml(sourceXml: string): ValidatedDrawioModel {
  const documentNode = parseXml(sourceXml)
  const model = selectSingleModel(documentNode)
  const ids = new Set<string>()
  const records = [...model.querySelectorAll('mxCell')].map((cell) => validateCell(cell, ids))
  if (records.length === 0) throw new Error('mxGraphModel에 mxCell이 없습니다.')
  for (const record of records) {
    if (record.kind !== 'edge') continue
    if (!record.sourceId || !record.targetId) throw new Error(`edge terminal 누락: ${record.id}`)
    if (!ids.has(record.sourceId) || !ids.has(record.targetId)) throw new Error(`존재하지 않는 edge terminal: ${record.id}`)
  }
  return { modelXml: new XMLSerializer().serializeToString(model), records }
}

function collectCells(root: Cell | null): Cell[] {
  if (!root) return []
  return [root, ...root.getChildren().flatMap((child) => collectCells(child))]
}

function setCellIdentity(node: Element, cell: Cell, kind: 'vertex' | 'edge' | 'decoration', interactive: boolean) {
  const id = cell.getId()
  if (!id) throw new Error('decoded maxGraph cell ID가 누락되었습니다.')
  node.setAttribute('data-cell-id', id)
  node.setAttribute('data-cell-kind', kind)
  if (!interactive) return
  node.setAttribute('data-cell-interactive', 'true')
  node.setAttribute('tabindex', '0')
  node.setAttribute('role', 'button')
  node.setAttribute('aria-label', String(cell.getValue() ?? id))
  node.setAttribute('aria-pressed', 'false')
}

function recordStateData(state: CellState, record: DrawioCellRecord) {
  const shapeNode = state.shape?.node
  const textNode = state.text?.node
  if (record.pokeKind === 'junction' || record.pokeKind === 'semantic' && record.kind === 'edge') {
    shapeNode?.setAttribute('display', 'none')
    textNode?.setAttribute('display', 'none')
    return
  }
  if (!shapeNode) throw new Error(`공개 CellState shape DOM이 없습니다: ${state.cell.getId() ?? 'unknown'}`)
  const renderedKind = record.pokeKind === 'decoration' ? 'decoration' : record.kind === 'vertex' ? 'vertex' : 'edge'
  setCellIdentity(shapeNode, state.cell, renderedKind, renderedKind === 'vertex')
  shapeNode.setAttribute('data-cell-style', JSON.stringify(state.cell.getStyle()))
  shapeNode.setAttribute('data-cell-parent', state.cell.getParent()?.getId() ?? '')
  shapeNode.setAttribute('data-cell-child-count', String(state.cell.getChildCount()))
  if (textNode) {
    setCellIdentity(textNode, state.cell, renderedKind, false)
    if (record.pokeKind === 'semantic' && record.kind === 'vertex') {
      textNode.setAttribute('pointer-events', 'none')
    }
  }
  if (record.kind === 'vertex') {
    shapeNode.setAttribute('data-cell-bounds', [state.x, state.y, state.width, state.height].join(','))
    shapeNode.setAttribute('data-cell-label', String(state.cell.getValue() ?? ''))
    const labelBounds = state.text?.boundingBox
    if (labelBounds) {
      shapeNode.setAttribute('data-label-bounds', [labelBounds.x, labelBounds.y, labelBounds.width, labelBounds.height].join(','))
    }
    return
  }
  const points = state.absolutePoints.filter((point) => point !== null).map((point) => [point.x, point.y])
  shapeNode.setAttribute('data-cell-points', JSON.stringify(points))
  shapeNode.setAttribute('data-cell-source', state.cell.getTerminal(true)?.getId() ?? '')
  shapeNode.setAttribute('data-cell-target', state.cell.getTerminal(false)?.getId() ?? '')
}

function transformedBounds(node: SVGGraphicsElement): DrawioBounds | null {
  try {
    const bounds = node.getBBox()
    const nodeMatrix = node.getCTM()
    const rootMatrix = node.ownerSVGElement?.getCTM()
    if (!nodeMatrix || bounds.width <= 0 || bounds.height <= 0) return null
    const matrix = rootMatrix ? rootMatrix.inverse().multiply(nodeMatrix) : nodeMatrix
    const corners = [
      new DOMPoint(bounds.x, bounds.y),
      new DOMPoint(bounds.x + bounds.width, bounds.y),
      new DOMPoint(bounds.x, bounds.y + bounds.height),
      new DOMPoint(bounds.x + bounds.width, bounds.y + bounds.height),
    ].map((point) => point.matrixTransform(matrix))
    const xs = corners.map(({ x }) => x)
    const ys = corners.map(({ y }) => y)
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    return Object.freeze({ x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y })
  } catch {
    return null
  }
}

function unionBounds(bounds: readonly DrawioBounds[]): DrawioBounds | null {
  if (bounds.length === 0) return null
  const x = Math.min(...bounds.map((item) => item.x))
  const y = Math.min(...bounds.map((item) => item.y))
  const right = Math.max(...bounds.map((item) => item.x + item.width))
  const bottom = Math.max(...bounds.map((item) => item.y + item.height))
  return Object.freeze({ x, y, width: right - x, height: bottom - y })
}

function labelBounds(state: CellState): DrawioBounds | null {
  const node = state.text?.node
  if (!(node instanceof SVGGraphicsElement)) return null
  const wrapperBounds = transformedBounds(node)
  if (wrapperBounds) return wrapperBounds
  const descendants = [...node.querySelectorAll<SVGGraphicsElement>('text, tspan')]
    .map(transformedBounds)
    .filter((bounds): bounds is DrawioBounds => bounds !== null)
  return unionBounds(descendants)
}

function immutableStyle(state: CellState) {
  const style: Record<string, string | number> = {}
  for (const [key, value] of Object.entries(state.cell.getStyle())) {
    if (typeof value === 'string' || typeof value === 'number') style[key] = value
  }
  return Object.freeze(style)
}

function exactIdSet(label: string, actualIds: readonly string[], expectedIds: ReadonlySet<string>) {
  const actual = new Set(actualIds)
  const missing = [...expectedIds].filter((id) => !actual.has(id))
  const unexpected = [...actual].filter((id) => !expectedIds.has(id))
  const duplicateCount = actualIds.length - actual.size
  if (missing.length > 0 || unexpected.length > 0 || duplicateCount > 0) {
    throw new Error(
      `${label} snapshot ID 불일치: missing [${missing.join(',')}] · unexpected [${unexpected.join(',')}] · duplicate ${duplicateCount}`,
    )
  }
}

function assertCompleteGeometrySnapshot(
  snapshot: DrawioGeometrySnapshot,
  records: readonly DrawioCellRecord[],
) {
  const tagged = records.some(({ pokeKind }) => pokeKind !== null)
  const expectedVertices = new Set(records.filter(({ kind, pokeKind }) => kind === 'vertex' && pokeKind !== 'junction').map(({ id }) => id))
  const expectedJunctions = new Set(records.filter(({ pokeKind }) => pokeKind === 'junction').map(({ id }) => id))
  const expectedEdges = new Map(records
    .filter((record): record is DrawioCellRecord & { sourceId: string; targetId: string } =>
      record.kind === 'edge' && record.sourceId !== null && record.targetId !== null
      && (!tagged || record.pokeKind === 'physical'))
    .map((record) => [record.id, record]))
  exactIdSet('vertex', snapshot.vertices.map(({ id }) => id), expectedVertices)
  exactIdSet('junction', snapshot.junctions.map(({ id }) => id), expectedJunctions)
  exactIdSet('edge', snapshot.edges.map(({ id }) => id), new Set(expectedEdges.keys()))
  for (const edge of snapshot.edges) {
    const expected = expectedEdges.get(edge.id)
    if (!expected || edge.sourceId !== expected.sourceId || edge.targetId !== expected.targetId) {
      throw new Error(
        `edge terminal snapshot 불일치: ${edge.id} ${edge.sourceId}→${edge.targetId} (expected ${expected?.sourceId ?? 'missing'}→${expected?.targetId ?? 'missing'})`,
      )
    }
    if (edge.points.length < 2) throw new Error(`edge rendered point가 2개 미만입니다: ${edge.id}`)
  }
}

function collectGeometry(graph: Graph, records: readonly DrawioCellRecord[]): DrawioGeometrySnapshot {
  const recordById = new Map(records.map((record) => [record.id, record]))
  const states = graph.getView().getStates()
  const vertices: DrawioVertexGeometry[] = []
  const junctions: DrawioJunctionGeometry[] = []
  const edges: DrawioEdgeGeometry[] = []
  for (const cell of collectCells(graph.getDataModel().getRoot())) {
    const id = cell.getId()
    const record = id ? recordById.get(id) : undefined
    if (!id || !record || record.kind === 'other') continue
    const state = states.get(cell)
    if (!state) throw new Error(`geometry CellState가 없습니다: ${id}`)
    if (record.pokeKind === 'junction') {
      junctions.push(Object.freeze({ id, point: Object.freeze({ x: state.x, y: state.y }), group: record.group }))
      continue
    }
    if (record.pokeKind === 'semantic' && record.kind === 'edge') continue
    if (record.kind === 'vertex') {
      vertices.push(Object.freeze({
        id,
        pokeKind: record.pokeKind,
        bounds: Object.freeze({ x: state.x, y: state.y, width: state.width, height: state.height }),
        labelBounds: labelBounds(state),
        labelNodeMapped: state.text?.node?.getAttribute('data-cell-id') === id,
        childCount: cell.getChildCount(),
      }))
      continue
    }
    const points = state.absolutePoints
      .filter((point) => point !== null)
      .map((point) => Object.freeze({ x: point.x, y: point.y }))
    edges.push(Object.freeze({
      id,
      sourceId: cell.getTerminal(true)?.getId() ?? '',
      targetId: cell.getTerminal(false)?.getId() ?? '',
      points: Object.freeze(points),
      style: immutableStyle(state),
      route: record.route,
      group: record.group,
      role: record.physicalRole,
      semanticRefs: record.semanticRefs,
      labelBounds: labelBounds(state),
    }))
  }
  const snapshot = Object.freeze({ vertices: Object.freeze(vertices), junctions: Object.freeze(junctions), edges: Object.freeze(edges) })
  assertCompleteGeometrySnapshot(snapshot, records)
  return snapshot
}

function mapPublicCellStates(graph: Graph, records: readonly DrawioCellRecord[]) {
  const recordById = new Map(records.map((record) => [record.id, record]))
  const states = graph.getView().getStates()
  for (const cell of collectCells(graph.getDataModel().getRoot())) {
    const id = cell.getId()
    const record = id ? recordById.get(id) : undefined
    if (!record || record.kind === 'other') continue
    const state = states.get(cell)
    if (!state) throw new Error(`공개 CellState가 생성되지 않았습니다: ${id}`)
    recordStateData(state, record)
  }
}

function findSvgRoot(graph: Graph) {
  const canvas = graph.getView().getCanvas()
  if (canvas instanceof SVGSVGElement) return canvas
  if (canvas instanceof SVGElement && canvas.ownerSVGElement) return canvas.ownerSVGElement
  throw new Error('maxGraph가 inline SVG canvas를 만들지 못했습니다.')
}

function abortError() {
  return new DOMException('draw.io scene mount가 취소되었습니다.', 'AbortError')
}

export async function mountDrawioScene(
  host: HTMLElement,
  sourceXml: string,
  options: { signal: AbortSignal },
): Promise<DrawioScene> {
  if (options.signal.aborted) throw abortError()
  const validated = validateDrawioXml(sourceXml)
  const graphHost = document.createElement('div')
  graphHost.className = 'drawio-lab-graph-host'
  const graph = new Graph(graphHost)
  let disposed = false

  const dispose = () => {
    if (disposed) return
    disposed = true
    graph.destroy()
    graphHost.replaceChildren()
    if (graphHost.parentNode === host) host.replaceChildren()
  }

  try {
    graph.setEnabled(false)
    new ModelXmlSerializer(graph.getDataModel()).import(validated.modelXml)
    graph.getView().validate()
    mapPublicCellStates(graph, validated.records)
    const svg = findSvgRoot(graph)
    const bounds = graph.getView().getGraphBounds()
    const width = Math.max(1, Math.ceil(bounds.x + bounds.width + 40))
    const height = Math.max(1, Math.ceil(bounds.y + bounds.height + 40))
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
    svg.setAttribute('width', '100%')
    svg.setAttribute('height', '100%')
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
    svg.style.removeProperty('min-width')
    svg.style.removeProperty('min-height')
    svg.classList.add('drawio-lab-svg')
    await Promise.resolve()
    if (options.signal.aborted) throw abortError()
    host.replaceChildren(graphHost)
    const refreshAndCollectGeometry = async (signal: AbortSignal) => {
      if (disposed || signal.aborted) throw abortError()
      graph.refresh()
      if (disposed || signal.aborted) throw abortError()
      svg.style.removeProperty('min-width')
      svg.style.removeProperty('min-height')
      mapPublicCellStates(graph, validated.records)
      const snapshot = collectGeometry(graph, validated.records)
      if (disposed || signal.aborted) throw abortError()
      return snapshot
    }
    return {
      svg,
      topology: buildDrawioTopology(validated.records),
      naturalSize: { width, height },
      refreshAndCollectGeometry,
      dispose,
    }
  } catch (error) {
    dispose()
    throw error
  }
}
