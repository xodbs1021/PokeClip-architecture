import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'

const SITE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MCP_DIR = join(SITE_DIR, 'node_modules', '@drawio', 'mcp')
const MCP_ENTRY = join(MCP_DIR, 'src', 'index.js')
const PRELOAD = join(SITE_DIR, 'scripts', 'block-drawio-routing-network.mjs')
const CORE_FILE = join(MCP_DIR, 'vendor', 'libavoid', 'libavoid-routing.js')
const WASM_FILE = join(MCP_DIR, 'vendor', 'libavoid', 'libavoid.wasm')
const IA_WORKER = join(SITE_DIR, 'scripts', 'drawio-routing', 'ia-worker.mjs')
const USECASE_WORKER = join(SITE_DIR, 'scripts', 'drawio-routing', 'usecase-worker.mjs')
const USERJOURNEY_WORKER = join(SITE_DIR, 'scripts', 'drawio-routing', 'userjourney-worker.mjs')
const FALLBACK_WARNING = '[libavoid] routing core CDN/cache unavailable (POKECLIP_VENDORED_CORE_ONLY); using the vendored copy'
const TOOL_TIMEOUT_MS = 30_000
const EXIT_TIMEOUT_MS = 2_000
const KILL_TIMEOUT_MS = 1_000
const EPSILON = 1

function fail(message) {
  throw new Error(message)
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

function parseAttributes(source) {
  const attributes = {}
  const pattern = /([\w:.-]+)\s*=\s*"([^"]*)"/g
  for (const match of source.matchAll(pattern)) attributes[match[1]] = match[2]
  return attributes
}

function parseStyle(style) {
  const result = {}
  for (const token of (style ?? '').split(';')) {
    const separator = token.indexOf('=')
    if (separator > 0) result[token.slice(0, separator)] = token.slice(separator + 1)
  }
  return result
}

function parseGeometry(body) {
  const block = /<mxGeometry\b([^>]*?)(?:\/>|>([\s\S]*?)<\/mxGeometry>)/.exec(body)
  if (!block) return { attributes: {}, points: [] }
  const points = [...(block[2] ?? '').matchAll(/<mxPoint\b([^>]*?)\/>/g)].map((match) => {
    const attributes = parseAttributes(match[1])
    return { x: Number(attributes.x), y: Number(attributes.y) }
  })
  return { attributes: parseAttributes(block[1]), points }
}

function parseCells(xml) {
  const cells = new Map()
  const pattern = /<mxCell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/mxCell>)/g
  for (const match of xml.matchAll(pattern)) {
    const attributes = parseAttributes(match[1])
    if (!attributes.id) fail('모든 mxCell에는 ID가 필요합니다.')
    if (cells.has(attributes.id)) fail(`중복 mxCell ID: ${attributes.id}`)
    cells.set(attributes.id, {
      id: attributes.id,
      attributes,
      style: parseStyle(attributes.style),
      geometry: parseGeometry(match[2] ?? ''),
    })
  }
  if (cells.size === 0) fail('mxCell을 찾지 못했습니다.')
  return cells
}

function assertPlainSource(cells) {
  for (const cell of cells.values()) {
    const value = cell.attributes.value ?? ''
    if (value.includes('<') || value.includes('>') || /&(?:lt|gt);/i.test(value)) {
      fail(`markup label은 허용하지 않습니다: ${cell.id}`)
    }
    if (cell.style.html !== '0' && (cell.attributes.vertex === '1' || cell.attributes.edge === '1')) {
      fail(`source cell은 html=0이어야 합니다: ${cell.id}`)
    }
    if (cell.geometry.points.length > 0) fail(`source waypoint는 허용하지 않습니다: ${cell.id}`)
  }
}

function replaceHtmlStyle(style) {
  const tokens = style.split(';').filter(Boolean)
  let replaced = 0
  const normalized = tokens.map((token) => {
    if (token === 'html=1') {
      replaced += 1
      return 'html=0'
    }
    return token
  })
  if (replaced !== 1) fail(`generated edge html=1 정규화 횟수 오류: ${replaced}`)
  return `${normalized.join(';')};`
}

function normalizeGeneratedXml(xml) {
  return xml.replace(/<mxCell\b([^>]*\bedge="1"[^>]*)>/g, (opening, attributesSource) => {
    const attributes = parseAttributes(attributesSource)
    if (!attributes.style) fail(`generated edge style 누락: ${attributes.id ?? 'unknown'}`)
    const normalizedStyle = replaceHtmlStyle(attributes.style)
    const escaped = normalizedStyle.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
    return opening.replace(/\bstyle="[^"]*"/, `style="${escaped}"`)
  })
}

function decodeToolUrl(toolResult) {
  if (toolResult?.isError) fail('open_drawio_xml tool이 오류를 반환했습니다.')
  const text = toolResult?.content?.find((item) => item.type === 'text')?.text
  const urlText = text?.match(/https?:\/\/[^\s]+#create=[^\s]+/)?.[0]
  if (!urlText) fail('open_drawio_xml 응답에서 #create URL을 찾지 못했습니다.')
  const url = new URL(urlText)
  const payload = JSON.parse(decodeURIComponent(url.hash.slice('#create='.length)))
  if (payload.type !== 'xml' || payload.compressed !== true || typeof payload.data !== 'string') {
    fail('open_drawio_xml #create payload 계약이 다릅니다.')
  }
  const encodedXml = inflateRawSync(Buffer.from(payload.data, 'base64')).toString('utf8')
  return decodeURIComponent(encodedXml)
}

function sendJson(child, value) {
  child.stdin.write(`${JSON.stringify(value)}\n`)
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve(true)
  return new Promise((resolvePromise) => {
    const timer = setTimeout(() => resolvePromise(false), timeoutMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolvePromise(true)
    })
  })
}

async function stopChild(child) {
  child.stdin.end()
  if (await waitForExit(child, EXIT_TIMEOUT_MS)) return
  child.kill('SIGTERM')
  if (await waitForExit(child, KILL_TIMEOUT_MS)) fail('MCP child가 SIGTERM 후 종료됐습니다.')
  child.kill('SIGKILL')
  await waitForExit(child, KILL_TIMEOUT_MS)
  fail('MCP child가 timeout으로 강제 종료됐습니다.')
}

async function createAttemptEnvironment() {
  const root = await mkdtemp(join(tmpdir(), 'pokeclip-drawio-route-'))
  const bin = join(root, 'bin')
  const cache = join(root, 'cache')
  await mkdir(bin)
  await mkdir(cache)
  const opener = join(bin, 'open')
  await writeFile(opener, '#!/bin/sh\nexit 0\n')
  await chmod(opener, 0o755)
  return { root, bin, cache }
}

function warningContract(stderr) {
  const lines = stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const fallbackCount = lines.filter((line) => line === FALLBACK_WARNING).length
  if (fallbackCount !== 1) fail(`vendored fallback 진단 횟수 오류: ${fallbackCount}`)
  const allowed = lines.filter((line) => line !== 'Draw.io MCP server running on stdio')
  const unknown = allowed.filter((line) => line !== FALLBACK_WARNING && !line.includes('skipping checkpoint'))
  if (unknown.length > 0) fail(`알 수 없는 MCP stderr: ${unknown.join(' | ')}`)
  return { lines, warnings: allowed }
}

async function runMcpAttempt(sourceXml) {
  const temporary = await createAttemptEnvironment()
  const nodeOptions = [process.env.NODE_OPTIONS, `--import=${PRELOAD}`].filter(Boolean).join(' ')
  const child = spawn(process.execPath, [MCP_ENTRY], {
    cwd: SITE_DIR,
    env: {
      ...process.env,
      NODE_OPTIONS: nodeOptions,
      XDG_CACHE_HOME: temporary.cache,
      PATH: `${temporary.bin}:${process.env.PATH ?? ''}`,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const pending = new Map()
  const seenIds = new Set()
  let protocolError = null
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
  lines.on('line', (line) => {
    try {
      const message = JSON.parse(line)
      if (message.jsonrpc !== '2.0' || !Number.isInteger(message.id)) fail(`잘못된 JSON-RPC 응답: ${line}`)
      if (!pending.has(message.id) || seenIds.has(message.id)) fail(`중복/미등록 JSON-RPC id: ${message.id}`)
      seenIds.add(message.id)
      const callback = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) callback.reject(new Error(`MCP ${message.id} 오류: ${JSON.stringify(message.error)}`))
      else callback.resolve(message.result)
    } catch (error) {
      protocolError = error
      for (const callback of pending.values()) callback.reject(error)
      pending.clear()
    }
  })

  const request = (id, method, params) => new Promise((resolvePromise, rejectPromise) => {
    pending.set(id, { resolve: resolvePromise, reject: rejectPromise })
    sendJson(child, { jsonrpc: '2.0', id, method, params })
  })
  const timeout = AbortSignal.timeout(TOOL_TIMEOUT_MS)
  const onTimeout = new Promise((_, rejectPromise) => {
    timeout.addEventListener('abort', () => rejectPromise(new Error('MCP tool timeout 30초')), { once: true })
  })

  try {
    const initialize = await Promise.race([
      request(1, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'pokeclip-route-generator', version: '1.0.0' } }),
      onTimeout,
    ])
    if (initialize?.serverInfo?.version !== '1.5.0') fail(`MCP server version 불일치: ${initialize?.serverInfo?.version}`)
    sendJson(child, { jsonrpc: '2.0', method: 'notifications/initialized' })
    const result = await Promise.race([
      request(2, 'tools/call', { name: 'open_drawio_xml', arguments: { content: sourceXml, routing: 'libavoid' } }),
      onTimeout,
    ])
    if (protocolError) throw protocolError
    await stopChild(child)
    const warningResult = warningContract(stderr)
    return { xml: normalizeGeneratedXml(decodeToolUrl(result)), stderrLines: warningResult.lines, warnings: warningResult.warnings }
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGKILL')
      await waitForExit(child, KILL_TIMEOUT_MS)
    }
    lines.close()
    await rm(temporary.root, { recursive: true, force: true })
  }
}

function runIaAttempt(sourceXml) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [IA_WORKER], { cwd: SITE_DIR, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', rejectPromise)
    child.once('exit', (code) => {
      if (code !== 0) {
        rejectPromise(new Error(`deterministic IA worker 실패(${code}): ${stderr.trim()}`))
        return
      }
      try {
        resolvePromise(JSON.parse(stdout))
      } catch (error) {
        rejectPromise(new Error(`deterministic IA worker JSON 오류: ${error instanceof Error ? error.message : String(error)}`))
      }
    })
    child.stdin.end(sourceXml)
  })
}

function runUseCaseAttempt(sourceXml) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [USECASE_WORKER], { cwd: SITE_DIR, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', rejectPromise)
    child.once('exit', (code) => {
      if (code !== 0) {
        rejectPromise(new Error(`deterministic Use Case worker 실패(${code}): ${stderr.trim()}`))
        return
      }
      try {
        resolvePromise(JSON.parse(stdout))
      } catch (error) {
        rejectPromise(new Error(`deterministic Use Case worker JSON 오류: ${error instanceof Error ? error.message : String(error)}`))
      }
    })
    child.stdin.end(sourceXml)
  })
}

function runUserJourneyAttempt(sourceXml) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [USERJOURNEY_WORKER], { cwd: SITE_DIR, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', rejectPromise)
    child.once('exit', (code) => {
      if (code !== 0) {
        rejectPromise(new Error(`deterministic User Journey worker 실패(${code}): ${stderr.trim()}`))
        return
      }
      try {
        resolvePromise(JSON.parse(stdout))
      } catch (error) {
        rejectPromise(new Error(`deterministic User Journey worker JSON 오류: ${error instanceof Error ? error.message : String(error)}`))
      }
    })
    child.stdin.end(sourceXml)
  })
}

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function absoluteBounds(cells, id) {
  const cell = cells.get(id)
  const geometry = cell?.geometry.attributes ?? {}
  let x = number(geometry.x)
  let y = number(geometry.y)
  let parentId = cell?.attributes.parent
  const visited = new Set()
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId)
    const parent = cells.get(parentId)
    if (!parent || parent.attributes.vertex !== '1') break
    x += number(parent.geometry.attributes.x)
    y += number(parent.geometry.attributes.y)
    parentId = parent.attributes.parent
  }
  return { x, y, width: number(geometry.width), height: number(geometry.height) }
}

function edgePoints(cells, edge) {
  const source = absoluteBounds(cells, edge.attributes.source)
  const target = absoluteBounds(cells, edge.attributes.target)
  const sourcePoint = { x: source.x + source.width * number(edge.style.exitX), y: source.y + source.height * number(edge.style.exitY) }
  const targetPoint = { x: target.x + target.width * number(edge.style.entryX), y: target.y + target.height * number(edge.style.entryY) }
  return [sourcePoint, ...edge.geometry.points, targetPoint]
}

function segmentCrossesOpenBounds(start, end, bounds) {
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

function criticalCellTuple(cell) {
  return {
    id: cell.id,
    value: cell.attributes.value ?? '',
    parent: cell.attributes.parent ?? '',
    vertex: cell.attributes.vertex ?? '',
    edge: cell.attributes.edge ?? '',
    source: cell.attributes.source ?? '',
    target: cell.attributes.target ?? '',
  }
}

function assertPreserved(sourceCells, generatedCells) {
  if (sourceCells.size !== generatedCells.size) fail('source/generated cell 개수가 다릅니다.')
  const portKeys = ['exitX', 'exitY', 'entryX', 'entryY', 'exitDx', 'exitDy', 'entryDx', 'entryDy']
  for (const [id, source] of sourceCells) {
    const generated = generatedCells.get(id)
    if (!generated) fail(`generated cell 누락: ${id}`)
    if (JSON.stringify(criticalCellTuple(source)) !== JSON.stringify(criticalCellTuple(generated))) fail(`cell 의미 필드 변화: ${id}`)
    if (source.attributes.vertex === '1' && JSON.stringify(source.geometry.attributes) !== JSON.stringify(generated.geometry.attributes)) {
      fail(`node geometry 변화: ${id}`)
    }
    if (source.attributes.edge === '1') {
      for (const key of portKeys) if ((source.style[key] ?? '') !== (generated.style[key] ?? '')) fail(`port style 변화: ${id}.${key}`)
      if (generated.style.html !== '0') fail(`generated html=0 손실: ${id}`)
    }
  }
}

function routingPostconditions(sourceXml, generatedXml) {
  const sourceCells = parseCells(sourceXml)
  const generatedCells = parseCells(generatedXml)
  assertPlainSource(sourceCells)
  assertPreserved(sourceCells, generatedCells)
  if (sourceXml === generatedXml) fail('official routing output이 source와 같습니다.')
  const vertices = [...generatedCells.values()].filter((cell) => cell.attributes.vertex === '1')
  const edges = [...generatedCells.values()].filter((cell) => cell.attributes.edge === '1')
  const parentIds = new Set(vertices.map((cell) => cell.attributes.parent).filter((id) => generatedCells.get(id)?.attributes.vertex === '1'))
  const leaves = vertices.filter((cell) => !parentIds.has(cell.id))
  const nonOrthogonal = []
  const crossings = []
  const edgeRoutes = {}
  const staticallyValidatedEdges = []
  const deferredToBrowser = []
  for (const edge of edges) {
    if (edge.style.libavoidRouting !== '1') fail(`libavoidRouting=1 누락: ${edge.id}`)
    const points = edgePoints(generatedCells, edge)
    const terminals = new Set([edge.attributes.source, edge.attributes.target])
    const hasStoredRoute = edge.geometry.points.length > 0
    if (hasStoredRoute) {
      staticallyValidatedEdges.push(edge.id)
      points.slice(1).forEach((point, index) => {
        const previous = points[index]
        if (Math.abs(point.x - previous.x) > EPSILON && Math.abs(point.y - previous.y) > EPSILON) {
          nonOrthogonal.push(`${edge.id}[${index}](${previous.x},${previous.y})→(${point.x},${point.y})`)
        }
      })
      for (const leaf of leaves) {
        if (terminals.has(leaf.id)) continue
        const bounds = absoluteBounds(generatedCells, leaf.id)
        if (points.slice(1).some((point, index) => segmentCrossesOpenBounds(points[index], point, bounds))) crossings.push(`${edge.id}→${leaf.id}`)
      }
    } else {
      deferredToBrowser.push(edge.id)
    }
    edgeRoutes[edge.id] = {
      waypointCount: edge.geometry.points.length,
      orderedWaypoints: edge.geometry.points,
      staticValidation: hasStoredRoute ? 'endpoint-through-ordered-waypoints' : 'deferredToBrowser',
      provenance: 'official @drawio/mcp@1.5.0 routing=libavoid',
    }
  }
  const obstacleFixtureEdge = generatedCells.get('routing-edge-to-child')
  if (obstacleFixtureEdge && obstacleFixtureEdge.geometry.points.length === 0) fail('대상 obstacle edge waypoint가 없습니다.')
  if (nonOrthogonal.length > 0) fail(`비직교 segment ${nonOrthogonal.length}개: ${nonOrthogonal.join(', ')}`)
  if (crossings.length > 0) fail(`제3 leaf 관통 ${crossings.length}개: ${crossings.join(', ')}`)
  return {
    outputDiffersFromInput: true,
    sourceWaypointCount: 0,
    targetObstacleEdgeCheck: obstacleFixtureEdge ? 'pass' : 'notApplicable',
    allEdgesLibavoidRouting: true,
    criticalFieldsPreserved: true,
    staticRouteValidation: {
      method: 'source endpoint → ordered waypoints → target endpoint',
      checkedEdges: staticallyValidatedEdges,
      deferredToBrowser,
    },
    renderedGeometryValidation: 'deferredToBrowser',
    nonOrthogonalSegments: nonOrthogonal,
    leafCrossings: crossings,
    edgeRoutes,
  }
}

async function hashFile(path) {
  return sha256(await readFile(path))
}

async function regularFiles(root) {
  const result = []
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile()) result.push(path)
    }
  }
  await visit(root)
  return result.sort((left, right) => relative(root, left).localeCompare(relative(root, right), 'en'))
}

async function packageTreeSha256() {
  const hash = createHash('sha256')
  for (const path of await regularFiles(MCP_DIR)) {
    hash.update(relative(MCP_DIR, path)).update('\0').update(await readFile(path)).update('\0')
  }
  return hash.digest('hex')
}

async function provenance() {
  const packageInfo = JSON.parse(await readFile(join(MCP_DIR, 'package.json'), 'utf8'))
  const lock = JSON.parse(await readFile(join(SITE_DIR, 'package-lock.json'), 'utf8'))
  return {
    packageName: '@drawio/mcp',
    packageVersion: packageInfo.version,
    lockIntegrity: lock.packages?.['node_modules/@drawio/mcp']?.integrity ?? fail('package-lock integrity 누락'),
    packageTreeSha256: await packageTreeSha256(),
    routingCoreSha256: await hashFile(CORE_FILE),
    routingWasmSha256: await hashFile(WASM_FILE),
  }
}

function manifestPath(generatedPath) {
  return generatedPath.replace(/\.drawio$/, '.routing.json')
}

async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`)
  await writeFile(temporary, content)
  await rename(temporary, path)
}

async function generate(sourceXml) {
  const first = await runMcpAttempt(sourceXml)
  const second = await runMcpAttempt(sourceXml)
  if (first.xml !== second.xml) fail('독립 MCP child 2회 생성 XML이 exact 일치하지 않습니다.')
  if (JSON.stringify(first.warnings) !== JSON.stringify(second.warnings)) fail('독립 MCP child 2회 warning이 exact 일치하지 않습니다.')
  const postconditions = routingPostconditions(sourceXml, first.xml)
  return {
    xml: first.xml,
    manifest: {
      schemaVersion: 1,
      generator: await provenance(),
      sourceSha256: sha256(sourceXml),
      generatedSha256: sha256(first.xml),
      independentAttempts: 2,
      deterministicExactMatch: true,
      warnings: first.warnings,
      stderrLines: first.stderrLines,
      postconditions,
    },
  }
}

async function main() {
  const [mode, sourceArgument, generatedArgument, ...extra] = process.argv.slice(2)
  if (!['--write', '--check'].includes(mode) || !sourceArgument || !generatedArgument || extra.length > 0) {
    fail('사용법: npm run drawio:route -- --write|--check <source.drawio> <generated.drawio>')
  }
  const sourcePath = resolve(SITE_DIR, sourceArgument)
  const generatedPath = resolve(SITE_DIR, generatedArgument)
  if (!sourcePath.endsWith('.source.drawio') || !generatedPath.endsWith('.drawio') || generatedPath.endsWith('.source.drawio')) {
    fail('source는 .source.drawio, output은 .drawio여야 합니다.')
  }
  if ((await stat(sourcePath)).isFile() === false) fail('source 파일이 아닙니다.')
  const sourceXml = await readFile(sourcePath, 'utf8')
  const isFullIa = basename(sourcePath) === '1_Pokeclip_IA.source.drawio'
  const isFullUseCase = basename(sourcePath) === '0_Pokeclip_UseCase.source.drawio'
  const isFullUserJourney = basename(sourcePath) === '2_Pokeclip_UserJourney.source.drawio'
  let result
  if (isFullIa || isFullUseCase || isFullUserJourney) {
    const runAttempt = isFullUserJourney ? runUserJourneyAttempt : isFullUseCase ? runUseCaseAttempt : runIaAttempt
    const profile = isFullUserJourney ? 'deterministic-userjourney' : isFullUseCase ? 'deterministic-usecase' : 'deterministic-tree'
    const [first, second] = await Promise.all([runAttempt(sourceXml), runAttempt(sourceXml)])
    if (first.normalizedSource !== second.normalizedSource || first.xml !== second.xml
      || JSON.stringify(first.manifest) !== JSON.stringify(second.manifest)) {
      fail(`독립 ${profile} 2회 생성 결과가 exact 일치하지 않습니다.`)
    }
    result = first
  } else {
    result = await generate(sourceXml)
  }
  const manifestText = `${JSON.stringify(result.manifest, null, 2)}\n`
  const routingManifestPath = manifestPath(generatedPath)
  if (mode === '--write') {
    if ((isFullIa || isFullUseCase || isFullUserJourney) && sourceXml !== result.normalizedSource) await atomicWrite(sourcePath, result.normalizedSource)
    await atomicWrite(generatedPath, result.xml)
    await atomicWrite(routingManifestPath, manifestText)
    console.log(`routed ${basename(sourcePath)} → ${basename(generatedPath)}`)
    return
  }
  const [committedXml, committedManifest] = await Promise.all([
    readFile(generatedPath, 'utf8'),
    readFile(routingManifestPath, 'utf8'),
  ])
  if ((isFullIa || isFullUseCase || isFullUserJourney) && sourceXml !== result.normalizedSource) {
    fail(`source XML이 canonical ${isFullUserJourney ? 'User Journey' : isFullUseCase ? 'Use Case' : 'IA'} layout과 다릅니다.`)
  }
  if (committedXml !== result.xml) fail('generated XML이 독립 재생성 결과와 다릅니다.')
  if (committedManifest !== manifestText) fail('routing manifest가 독립 재생성 결과와 다릅니다.')
  console.log(`checked ${basename(generatedPath)} + ${basename(routingManifestPath)}`)
}

main().catch((error) => {
  console.error(`[drawio-route] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
