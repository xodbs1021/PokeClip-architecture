function decodeXml(value) {
  return String(value ?? '')
    .replaceAll('&quot;', '"')
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&')
}

export function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

export function parseAttributes(source) {
  const attributes = {}
  for (const match of String(source ?? '').matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) {
    attributes[match[1]] = decodeXml(match[2])
  }
  return attributes
}

export function parseStyle(source) {
  const style = {}
  for (const token of String(source ?? '').split(';')) {
    const separator = token.indexOf('=')
    if (separator > 0) style[token.slice(0, separator)] = token.slice(separator + 1)
  }
  return style
}

export function serializeStyle(style) {
  return `${Object.entries(style).map(([key, value]) => `${key}=${value}`).join(';')};`
}

function parseGeometry(body) {
  const match = /<mxGeometry\b([^>]*?)(?:\/>|>([\s\S]*?)<\/mxGeometry>)/.exec(body)
  if (!match) return { attributes: {}, points: [] }
  const points = [...(match[2] ?? '').matchAll(/<mxPoint\b([^>]*?)\/>/g)].map((pointMatch) => {
    const attributes = parseAttributes(pointMatch[1])
    return { x: Number(attributes.x), y: Number(attributes.y) }
  })
  return { attributes: parseAttributes(match[1]), points }
}

export function parseDrawioXml(xml) {
  if (xml.includes('<![CDATA[') || xml.includes('&lt;mxGraphModel')) throw new Error('비압축 draw.io XML만 허용합니다.')
  const modelMatch = /<mxGraphModel\b([^>]*)>([\s\S]*?)<\/mxGraphModel>/.exec(xml)
  if (!modelMatch) throw new Error('mxGraphModel을 찾지 못했습니다.')
  const diagramMatch = /<diagram\b([^>]*)>/.exec(xml)
  const fileMatch = /<mxfile\b([^>]*)>/.exec(xml)
  const cells = []
  const seen = new Set()
  for (const match of modelMatch[2].matchAll(/<mxCell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/mxCell>)/g)) {
    const attributes = parseAttributes(match[1])
    if (!attributes.id || seen.has(attributes.id)) throw new Error(`mxCell ID 오류: ${attributes.id ?? 'missing'}`)
    seen.add(attributes.id)
    const { style: styleSource = '', ...cellAttributes } = attributes
    cells.push({
      id: attributes.id,
      attributes: cellAttributes,
      style: parseStyle(styleSource),
      geometry: parseGeometry(match[2] ?? ''),
    })
  }
  if (cells.length === 0) throw new Error('mxCell을 찾지 못했습니다.')
  return {
    fileAttributes: fileMatch ? parseAttributes(fileMatch[1]) : { host: 'PokeClip' },
    diagramAttributes: diagramMatch ? parseAttributes(diagramMatch[1]) : { id: 'pokeclip', name: 'PokeClip' },
    modelAttributes: parseAttributes(modelMatch[1]),
    cells,
  }
}

export function cloneModel(model) {
  return structuredClone(model)
}

export function cellMap(model) {
  return new Map(model.cells.map((cell) => [cell.id, cell]))
}

function serializeAttributes(attributes) {
  return Object.entries(attributes)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}="${escapeXml(value)}"`)
    .join(' ')
}

function serializeGeometry(geometry) {
  const attributes = serializeAttributes(geometry.attributes)
  if (geometry.points.length === 0) return `<mxGeometry ${attributes}/>`
  const points = geometry.points.map(({ x, y }) => `<mxPoint x="${x}" y="${y}"/>`).join('')
  return `<mxGeometry ${attributes}><Array as="points">${points}</Array></mxGeometry>`
}

function serializeCell(cell) {
  const attributes = {
    id: cell.id,
    ...cell.attributes,
    ...(Object.keys(cell.style).length > 0 ? { style: serializeStyle(cell.style) } : {}),
  }
  const opening = `<mxCell ${serializeAttributes(attributes)}`
  const hasGeometry = Object.keys(cell.geometry.attributes).length > 0 || cell.geometry.points.length > 0
  return hasGeometry ? `${opening}>${serializeGeometry(cell.geometry)}</mxCell>` : `${opening}/>`
}

export function serializeDrawioXml(model) {
  const fileAttributes = serializeAttributes(model.fileAttributes)
  const diagramAttributes = serializeAttributes(model.diagramAttributes)
  const modelAttributes = serializeAttributes(model.modelAttributes)
  const cells = model.cells.map((cell) => `        ${serializeCell(cell)}`).join('\n')
  return `<mxfile ${fileAttributes}>
  <diagram ${diagramAttributes}>
    <mxGraphModel ${modelAttributes}>
      <root>
${cells}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`
}

export function setCellStyle(cell, patch) {
  cell.style = { ...cell.style, ...patch }
  for (const [key, value] of Object.entries(cell.style)) if (value === null) delete cell.style[key]
}

export function pointVertex(id, x, y, group) {
  return {
    id,
    attributes: { value: '', vertex: '1', parent: '1' },
    style: {
      shape: 'ellipse', perimeter: 'none', opacity: '0', fillOpacity: '0', strokeOpacity: '0',
      pointerEvents: '0', html: '0', pokeKind: 'junction', pokeGroup: group,
    },
    geometry: { attributes: { x: String(x), y: String(y), width: '0', height: '0', as: 'geometry' }, points: [] },
  }
}

export function edgeCell(id, source, target, style) {
  return {
    id,
    attributes: { value: '', edge: '1', parent: '1', source, target },
    style,
    geometry: { attributes: { relative: '1', as: 'geometry' }, points: [] },
  }
}
