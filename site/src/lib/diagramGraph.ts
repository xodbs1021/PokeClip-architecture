// 다이어그램 iframe 내부의 노드(박스)와 SVG 연결선을 런타임에 스캔해
// 클릭 인터랙션용 그래프를 만든다. 원본 HTML은 수정하지 않는다.
// - wired 모드: 선 끝점이 노드 경계 위에 놓이는 원본 배선 방식에 기대어 기하 매칭
// - grid 모드: 연결선이 거의 없는 매트릭스형 다이어그램(유저 저니)은 행·열 정렬로 연계 구성

interface Point {
  x: number
  y: number
}

interface NodeRect {
  l: number
  t: number
  r: number
  b: number
  area: number
}

export interface DiagramNode {
  el: HTMLElement
  rect: NodeRect
}

export interface DiagramEdge {
  line: SVGElement
  labels: SVGElement[]
  marker: string | null
  a: number
  b: number
}

export type GraphMode = 'wired' | 'grid'

export interface DiagramGraph {
  mode: GraphMode
  nodes: DiagramNode[]
  edges: DiagramEdge[]
  svgs: SVGElement[]
  adj: Map<number, Set<number>>
}

const STYLE_ID = 'pk-enhance-style'
const MIN_NODE_AREA = 800
const MAX_NODE_AREA_RATIO = 0.28
const ENDPOINT_SLACK = 7
const HIT_SLACK = 4
const MIN_WIRED_EDGES = 3
const BIG_NODE_RATIO = 0.04
const GRID_OVERLAP = 0.55
const GRID_LEAF_AREA_RATIO = 0.06
const GRID_MIN_LEAF_AREA = 9000

const ENHANCE_CSS = `
  .pk-node { transition: opacity .3s ease, transform .45s cubic-bezier(.34, 1.56, .64, 1), box-shadow .35s ease; }
  svg line, svg path, svg polyline { transition: stroke .3s ease, stroke-width .45s cubic-bezier(.34, 1.56, .64, 1), opacity .3s ease, filter .45s cubic-bezier(.34, 1.56, .64, 1); }
  svg text { transition: font-size .45s cubic-bezier(.34, 1.56, .64, 1), fill .3s ease, opacity .3s ease; }
  .pk-dim { opacity: .16 !important; }
  .pk-edge-dim { opacity: .09 !important; }
  .pk-focus { z-index: 60 !important; box-shadow: 0 14px 34px rgba(0,0,0,.22), 0 0 0 2.5px #e5484d !important; }
  .pk-linked { z-index: 50 !important; box-shadow: 0 10px 26px rgba(0,0,0,.16), 0 0 0 2px #1c1917 !important; }
  .pk-edge-hot { stroke: #e5484d !important; stroke-width: 4.2px !important; opacity: 1 !important;
                 filter: drop-shadow(0 3px 5px rgba(229,72,77,.45)); }
  .pk-label-hot { fill: #b3261e !important; opacity: 1 !important; font-size: 14.5px !important; font-weight: 800 !important; }
`

function containsPoint(rect: NodeRect, p: Point, slack: number): boolean {
  return p.x >= rect.l - slack && p.x <= rect.r + slack && p.y >= rect.t - slack && p.y <= rect.b + slack
}

/** 점에서 사각형 테두리까지의 거리 — 안쪽이면 가장 가까운 변까지, 바깥이면 사각형까지. */
function borderDistance(rect: NodeRect, p: Point): number {
  const outX = Math.max(rect.l - p.x, p.x - rect.r, 0)
  const outY = Math.max(rect.t - p.y, p.y - rect.b, 0)
  if (outX > 0 || outY > 0) return Math.hypot(outX, outY)
  return Math.min(p.x - rect.l, rect.r - p.x, p.y - rect.t, rect.b - p.y)
}

/** 선 끝점이 닿은 노드 — 테두리에 가장 가까운 후보(원본이 경계 위에 끝점을 그리므로). */
function nodeAtEndpoint(nodes: DiagramNode[], p: Point): number {
  let best = -1
  let bestDist = Infinity
  for (let i = 0; i < nodes.length; i += 1) {
    if (!containsPoint(nodes[i].rect, p, ENDPOINT_SLACK)) continue
    const dist = borderDistance(nodes[i].rect, p)
    if (dist < bestDist - 0.5 || (Math.abs(dist - bestDist) <= 0.5 && best >= 0 && nodes[i].rect.area < nodes[best].rect.area)) {
      best = i
      bestDist = dist
    }
  }
  return best
}

function overlapRatio(a1: number, a2: number, b1: number, b2: number): number {
  const overlap = Math.min(a2, b2) - Math.max(a1, b1)
  return overlap <= 0 ? 0 : overlap / Math.min(a2 - a1, b2 - b1)
}

interface Connector {
  line: SVGElement
  labels: SVGElement[]
  p1: Point | null
  p2: Point | null
}

/** SVG 커넥터(선·경로)를 생성 순서대로 수집한다. 뒤따르는 text는 그 선의 라벨. */
function collectConnectors(doc: Document): Connector[] {
  const connectors: Connector[] = []
  doc.querySelectorAll<SVGElement>('svg').forEach((svg) => {
    let current: Connector | null = null
    Array.from(svg.children).forEach((child) => {
      const tag = child.tagName.toLowerCase()
      if (tag === 'defs') return
      if (tag === 'line' || tag === 'path' || tag === 'polyline') {
        let p1: Point | null = null
        let p2: Point | null = null
        if (tag === 'line') {
          p1 = { x: Number(child.getAttribute('x1')), y: Number(child.getAttribute('y1')) }
          p2 = { x: Number(child.getAttribute('x2')), y: Number(child.getAttribute('y2')) }
        } else {
          const geo = child as SVGGeometryElement
          if (typeof geo.getTotalLength === 'function') {
            try {
              const len = geo.getTotalLength()
              if (len > 0) {
                p1 = geo.getPointAtLength(0)
                p2 = geo.getPointAtLength(len)
              }
            } catch {
              p1 = null
            }
          }
        }
        if (p1 && (Number.isNaN(p1.x) || Number.isNaN(p2!.x))) {
          p1 = null
          p2 = null
        }
        current = { line: child as SVGElement, labels: [], p1, p2 }
        connectors.push(current)
      } else if (tag === 'text' && current) {
        current.labels.push(child as SVGElement)
      }
    })
  })
  return connectors
}

/**
 * 원본 스크립트에서 연결 정의(id 쌍)를 선언 순서대로 파싱한다.
 * wire('a','b') 호출 또는 ['a','b',...] 배열 리터럴 — 다이어그램 원본이 쓰는 두 방식.
 */
function parseSourcePairs(doc: Document): [string, string][] {
  const src = Array.from(doc.querySelectorAll('script'))
    .map((el) => el.textContent ?? '')
    .join('\n')
  const wired = Array.from(src.matchAll(/wire\(\s*'([^']+)'\s*,\s*'([^']+)'/g)).map(
    (m) => [m[1], m[2]] as [string, string],
  )
  if (wired.length > 0) return wired
  return Array.from(src.matchAll(/\[\s*'([A-Za-z][\w-]*)'\s*,\s*'([A-Za-z][\w-]*)'/g)).map(
    (m) => [m[1], m[2]] as [string, string],
  )
}

export function buildGraph(doc: Document): DiagramGraph | null {
  const view = doc.defaultView
  if (!view || !doc.body) return null

  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement('style')
    style.id = STYLE_ID
    style.textContent = ENHANCE_CSS
    doc.head.appendChild(style)
  }

  const bodyBg = view.getComputedStyle(doc.body).backgroundColor
  const canvasArea = doc.body.scrollWidth * doc.body.scrollHeight

  const nodes: DiagramNode[] = []
  doc.body.querySelectorAll<HTMLElement>('div, section, article, ul').forEach((el) => {
    const cs = view.getComputedStyle(el)
    const hasBox =
      parseFloat(cs.borderTopWidth) > 0 ||
      cs.boxShadow !== 'none' ||
      (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent' && cs.backgroundColor !== bodyBg)
    if (!hasBox) return
    const b = el.getBoundingClientRect()
    const area = b.width * b.height
    if (area < MIN_NODE_AREA || area > canvasArea * MAX_NODE_AREA_RATIO) return
    nodes.push({ el, rect: { l: b.left, t: b.top, r: b.right, b: b.bottom, area } })
  })

  const edges: DiagramEdge[] = []
  const adj = new Map<number, Set<number>>()
  const link = (a: number, b: number) => {
    if (!adj.has(a)) adj.set(a, new Set())
    adj.get(a)!.add(b)
  }

  const connectors = collectConnectors(doc)

  // 노드를 요소로 찾아 없으면 등록한다 — id로 지목된 요소는 박스 휴리스틱과 무관하게 노드다.
  const indexOfEl = (el: HTMLElement): number => {
    const found = nodes.findIndex((n) => n.el === el)
    if (found >= 0) return found
    const b = el.getBoundingClientRect()
    nodes.push({ el, rect: { l: b.left, t: b.top, r: b.right, b: b.bottom, area: b.width * b.height } })
    return nodes.length - 1
  }

  // 1순위: 원본 스크립트의 연결 정의 — 선 생성 순서와 정의 순서가 같아 1:1 매칭된다.
  const sourcePairs = parseSourcePairs(doc)
    .map(([a, b]) => [doc.getElementById(a), doc.getElementById(b)] as const)
    .filter((pair): pair is readonly [HTMLElement, HTMLElement] => Boolean(pair[0] && pair[1]))

  if (sourcePairs.length >= MIN_WIRED_EDGES && sourcePairs.length === connectors.length) {
    sourcePairs.forEach(([elA, elB], k) => {
      const a = indexOfEl(elA)
      const b = indexOfEl(elB)
      edges.push({ line: connectors[k].line, labels: connectors[k].labels, marker: connectors[k].line.getAttribute('marker-end'), a, b })
      link(a, b)
      link(b, a)
    })
    return { mode: 'wired', nodes, edges, svgs: collectSvgs(edges), adj }
  }

  // 2순위: 선 끝점 ↔ 노드 테두리 기하 매칭 (id 정의가 없는 다이어그램)
  connectors.forEach((conn) => {
    if (!conn.p1 || !conn.p2) return
    const a = nodeAtEndpoint(nodes, conn.p1)
    const b = nodeAtEndpoint(nodes, conn.p2)
    if (a < 0 || b < 0 || a === b) return
    edges.push({ line: conn.line, labels: conn.labels, marker: conn.line.getAttribute('marker-end'), a, b })
    link(a, b)
    link(b, a)
  })

  if (edges.length >= MIN_WIRED_EDGES) {
    return { mode: 'wired', nodes, edges, svgs: collectSvgs(edges), adj }
  }

  // 그리드 폴백 — 리프 카드끼리 같은 열(단계)·같은 행(레인)이면 연계로 본다.
  const leaves = nodes
    .map((node, i) => ({ node, i }))
    .filter(({ node }) => node.rect.area >= GRID_MIN_LEAF_AREA && node.rect.area < canvasArea * GRID_LEAF_AREA_RATIO)
    .filter(({ node }, _idx, arr) => !arr.some(({ node: other }) => other.el !== node.el && node.el.contains(other.el)))
  for (let x = 0; x < leaves.length; x += 1) {
    for (let y = x + 1; y < leaves.length; y += 1) {
      const A = leaves[x].node.rect
      const B = leaves[y].node.rect
      const sameCol = overlapRatio(A.l, A.r, B.l, B.r) >= GRID_OVERLAP
      const sameRow = overlapRatio(A.t, A.b, B.t, B.b) >= GRID_OVERLAP
      if (sameCol || sameRow) {
        link(leaves[x].i, leaves[y].i)
        link(leaves[y].i, leaves[x].i)
      }
    }
  }
  if (adj.size === 0) return null
  return { mode: 'grid', nodes, edges, svgs: collectSvgs(edges), adj }
}

/**
 * 클릭 좌표에 해당하는 배선 노드.
 * 1) 점을 포함하는 후보를 작은 것부터 훑어 배선된 첫 노드
 * 2) 없으면 그 컨테이너 안의 배선 노드 중 클릭점에 가장 가까운 것 (자손 폴백)
 */
export function hitTest(graph: DiagramGraph, p: Point): number {
  const containing = graph.nodes
    .map((node, i) => ({ node, i }))
    .filter(({ node }) => containsPoint(node.rect, p, HIT_SLACK))
    .sort((a, b) => a.node.rect.area - b.node.rect.area)
  if (containing.length === 0) return -1

  for (const { i } of containing) {
    if (graph.adj.has(i)) return i
  }
  return -1
}

function collectSvgs(edges: DiagramEdge[]): SVGElement[] {
  return Array.from(
    new Set(edges.map((edge) => edge.line.closest('svg')).filter((svg): svg is SVGSVGElement => Boolean(svg))),
  )
}

const HOT_MARKER_SCALE = 1.9

/** 선의 marker-end 화살촉을 복제해 빨간색·확대판 마커 id를 만든다 (문서당 1회 생성). */
function hotMarkerFor(line: SVGElement): string | null {
  const ref = line.getAttribute('marker-end')
  const match = ref?.match(/url\(#([^)]+)\)/)
  if (!match) return null
  const doc = line.ownerDocument
  const hotId = `${match[1]}-pkhot`
  if (!doc.getElementById(hotId)) {
    const original = doc.getElementById(match[1])
    if (!original) return null
    const clone = original.cloneNode(true) as Element
    clone.setAttribute('id', hotId)
    const scaleAttr = (attr: string) => {
      const value = parseFloat(clone.getAttribute(attr) ?? '')
      if (!Number.isNaN(value)) clone.setAttribute(attr, String(value * HOT_MARKER_SCALE))
    }
    scaleAttr('markerWidth')
    scaleAttr('markerHeight')
    scaleAttr('refX')
    scaleAttr('refY')
    clone.querySelectorAll('path').forEach((shape) => {
      shape.setAttribute('stroke', '#e5484d')
      shape.setAttribute('transform', `scale(${HOT_MARKER_SCALE})`)
    })
    original.parentElement?.appendChild(clone)
  }
  return `url(#${hotId})`
}

export function applyHighlight(graph: DiagramGraph, focus: number): void {
  const canvasArea = (() => {
    const body = graph.nodes[0]?.el.ownerDocument.body
    return body ? body.scrollWidth * body.scrollHeight : Infinity
  })()
  const linked = graph.adj.get(focus) ?? new Set<number>()
  const raised = new Set<number>([focus, ...linked])

  graph.nodes.forEach((node, i) => {
    node.el.classList.add('pk-node')
    const isFocus = i === focus
    const isLinked = linked.has(i)
    // 강조 대상의 조상/자손 박스는 흐리게 하지 않는다 — opacity가 중첩되므로.
    const touchesRaised =
      isFocus ||
      isLinked ||
      [...raised].some((r) => graph.nodes[r].el.contains(node.el) || node.el.contains(graph.nodes[r].el))
    node.el.classList.toggle('pk-focus', isFocus)
    node.el.classList.toggle('pk-linked', isLinked)
    node.el.classList.toggle('pk-dim', !touchesRaised)
    if (isFocus || isLinked) {
      const isBig = node.rect.area > canvasArea * BIG_NODE_RATIO
      const scale = isFocus ? (isBig ? 1.012 : 1.05) : isBig ? 1.008 : 1.025
      const hasOwnTransform = node.el.style.transform !== '' && !node.el.style.transform.startsWith('scale')
      if (!hasOwnTransform) node.el.style.transform = `scale(${scale})`
    } else {
      node.el.style.removeProperty('transform')
    }
  })

  // 관계선이 박스에 가려지지 않도록 강조 중에는 SVG 레이어를 박스(z 50~60) 위로 올린다.
  graph.svgs.forEach((svg) => {
    const view = svg.ownerDocument.defaultView
    if (view && view.getComputedStyle(svg).position === 'static' && svg.dataset.pkRaised !== 'pos') {
      svg.style.position = 'relative'
      svg.dataset.pkRaised = 'pos'
    }
    svg.style.zIndex = '70'
  })

  graph.edges.forEach((edge) => {
    const hot = edge.a === focus || edge.b === focus
    edge.line.classList.toggle('pk-edge-hot', hot)
    edge.line.classList.toggle('pk-edge-dim', !hot)
    if (edge.marker) {
      edge.line.setAttribute('marker-end', hot ? (hotMarkerFor(edge.line) ?? edge.marker) : edge.marker)
    }
    edge.labels.forEach((label) => {
      label.classList.toggle('pk-label-hot', hot)
      label.classList.toggle('pk-edge-dim', !hot)
    })
  })
}

export function clearHighlight(graph: DiagramGraph): void {
  graph.nodes.forEach((node) => {
    node.el.classList.remove('pk-focus', 'pk-linked', 'pk-dim')
    node.el.style.removeProperty('transform')
  })
  graph.svgs.forEach((svg) => {
    svg.style.removeProperty('z-index')
    if (svg.dataset.pkRaised === 'pos') {
      svg.style.removeProperty('position')
      delete svg.dataset.pkRaised
    }
  })

  graph.edges.forEach((edge) => {
    edge.line.classList.remove('pk-edge-hot', 'pk-edge-dim')
    if (edge.marker) edge.line.setAttribute('marker-end', edge.marker)
    edge.labels.forEach((label) => label.classList.remove('pk-label-hot', 'pk-edge-dim'))
  })
}
