import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  USERJOURNEY_POLICY,
  boundsOf,
  normalizeUserJourneySource,
} from '../scripts/drawio-routing/userjourney-layout.mjs'
import { buildPhysicalUserJourney } from '../scripts/drawio-routing/userjourney-router.mjs'
import { validatePhysicalUserJourney } from '../scripts/drawio-routing/userjourney-validation.mjs'
import { generateUserJourneyRouting } from '../scripts/drawio-routing/userjourney-generator.mjs'
import { edgeCell, parseDrawioXml, pointVertex, serializeDrawioXml } from '../scripts/drawio-routing/xml-model.mjs'

const sourcePath = fileURLToPath(new URL('../../labs/drawio/2_Pokeclip_UserJourney.source.drawio', import.meta.url))
const contractPath = fileURLToPath(new URL('../shared/userjourney-semantic-contract.json', import.meta.url))

async function sourceModel() {
  return parseDrawioXml(await readFile(sourcePath, 'utf8'))
}

async function routedUserJourney() {
  const normalized = normalizeUserJourneySource(await sourceModel())
  const routed = buildPhysicalUserJourney(normalized.model)
  assert.doesNotThrow(() => validatePhysicalUserJourney(routed.model, routed), 'canonical User Journey must be valid')
  return routed
}

function segmentsOf(routed) {
  return validatePhysicalUserJourney(routed.model, routed).segments
}

function rebuildPhysicalReferences(routed) {
  for (const physical of routed.physicalEdges) {
    physical.semanticRefs = Object.entries(routed.semanticToPhysical)
      .filter(([, physicalIds]) => physicalIds.includes(physical.id))
      .map(([semanticId]) => semanticId)
      .sort()
    const cell = routed.model.cells.find(({ id }) => id === physical.id)
    if (cell) cell.style.pokeSemanticRefs = physical.semanticRefs.join(',')
  }
}

function addProbeSegment(routed, { id, start, end, semanticId }) {
  const startId = `${id}--start`
  const endId = `${id}--end`
  routed.model.cells.push(
    pointVertex(startId, start.x, start.y, 'probe'),
    pointVertex(endId, end.x, end.y, 'probe'),
    edgeCell(id, startId, endId, {
      rounded: '0', html: '0', exitX: '0.5', exitY: '0.5', entryX: '0.5', entryY: '0.5',
      exitPerimeter: '0', entryPerimeter: '0', endArrow: 'none', pokeKind: 'physical',
      pokeRoute: 'probe', pokeGroup: 'probe', pokePhysicalRole: 'probe', pokeSemanticRefs: semanticId,
    }),
  )
  routed.junctions.push(
    { id: startId, x: start.x, y: start.y, group: 'probe', role: 'probe' },
    { id: endId, x: end.x, y: end.y, group: 'probe', role: 'probe' },
  )
  routed.physicalEdges.push({
    id, sourceId: startId, targetId: endId, group: 'probe', route: 'probe', role: 'probe',
    router: 'deterministic-userjourney-v1', orderedWaypoints: [], semanticRefs: [semanticId],
  })
}

// ── T4 기하: endpoint · orthogonal · nodeClearance · edgeCrossing · overlap · junctionTopology ──
test('T4 validator rejects endpoint error over 1px', async () => {
  const routed = await routedUserJourney()
  const physical = routed.physicalEdges.find(({ sourceTerminal }) => sourceTerminal)
  const cell = routed.model.cells.find(({ id }) => id === physical.id)
  cell.style.exitY = String(Number(cell.style.exitY) + 0.25)
  assert.throws(() => validatePhysicalUserJourney(routed.model, routed), /endpoint/i)
})

test('T4 validator rejects a diagonal physical segment', async () => {
  const routed = await routedUserJourney()
  const physical = routed.physicalEdges.find(({ sourceId, targetId }) =>
    sourceId.startsWith('route-junction') && targetId.startsWith('route-junction'))
  const [start, end] = segmentsOf(routed).filter(({ id }) => id === physical.id).map((segment) => [segment.start, segment.end])[0]
  const target = routed.model.cells.find(({ id }) => id === physical.targetId)
  const attribute = Math.abs(start.x - end.x) <= 1 ? 'x' : 'y'
  target.geometry.attributes[attribute] = String(Number(target.geometry.attributes[attribute]) + 7)
  routed.junctions.find(({ id }) => id === physical.targetId)[attribute] += 7
  assert.throws(() => validatePhysicalUserJourney(routed.model, routed), /orthogonal/i)
})

test('T4 validator rejects third-node penetration', async () => {
  const routed = await routedUserJourney()
  const segment = segmentsOf(routed).find(({ length, sourceId, targetId }) =>
    length > 100 && sourceId.startsWith('route-junction') && targetId.startsWith('route-junction'))
  const victim = routed.model.cells.find(({ id }) => id === 'uj-reject-recover')
  victim.geometry.attributes.x = String((segment.start.x + segment.end.x) / 2 - 20)
  victim.geometry.attributes.y = String((segment.start.y + segment.end.y) / 2 - 20)
  victim.geometry.attributes.width = '40'
  victim.geometry.attributes.height = '40'
  assert.throws(() => validatePhysicalUserJourney(routed.model, routed), /nodeClearance/i)
})

test('T4 validator rejects a crossing probe', async () => {
  const routed = await routedUserJourney()
  const baseline = segmentsOf(routed).find(({ length, start, end }) => length > 80 && Math.abs(start.y - end.y) <= 1)
  const x = (baseline.start.x + baseline.end.x) / 2
  addProbeSegment(routed, {
    id: 'route-edge--probe--cross', semanticId: routed.semanticEdges[0].id,
    start: { x, y: baseline.start.y - 30 }, end: { x, y: baseline.start.y + 30 },
  })
  assert.throws(() => validatePhysicalUserJourney(routed.model, routed), /edgeCrossing/i)
})

test('T4 validator rejects a collinear overlap probe', async () => {
  const routed = await routedUserJourney()
  const baseline = segmentsOf(routed).find(({ length }) => length > 80)
  addProbeSegment(routed, {
    id: 'route-edge--probe--overlap', semanticId: routed.semanticEdges[0].id,
    start: baseline.start, end: baseline.end,
  })
  assert.throws(() => validatePhysicalUserJourney(routed.model, routed), /overlap/i)
})

test('T4 validator rejects a mutated degree-4 X junction', async () => {
  const routed = await routedUserJourney()
  const junction = routed.junctions.find(({ id }) => {
    const incidents = routed.physicalEdges.filter(({ sourceId, targetId }) => sourceId === id || targetId === id)
    const horizontal = incidents.filter(({ expectedStart, expectedEnd }) => expectedStart.y === expectedEnd.y)
    const vertical = incidents.filter(({ expectedStart, expectedEnd }) => expectedStart.x === expectedEnd.x)
    return horizontal.length === 1 && vertical.length === 1
  })
  assert.ok(junction, 'a degree-2 bend junction exists')
  addProbeSegment(routed, {
    id: 'route-edge--probe--h', semanticId: routed.semanticEdges[1].id,
    start: { x: junction.x, y: junction.y }, end: { x: junction.x - 100, y: junction.y },
  })
  addProbeSegment(routed, {
    id: 'route-edge--probe--v', semanticId: routed.semanticEdges[1].id,
    start: { x: junction.x, y: junction.y }, end: { x: junction.x, y: junction.y - 100 },
  })
  // 프로브 세그먼트의 실제 terminal을 junction으로 지정해 degree-4를 만든다.
  routed.physicalEdges.at(-2).sourceId = junction.id
  routed.physicalEdges.at(-2).expectedStart = { x: junction.x, y: junction.y }
  routed.physicalEdges.at(-2).expectedEnd = { x: junction.x - 100, y: junction.y }
  routed.physicalEdges.at(-1).sourceId = junction.id
  routed.physicalEdges.at(-1).expectedStart = { x: junction.x, y: junction.y }
  routed.physicalEdges.at(-1).expectedEnd = { x: junction.x, y: junction.y - 100 }
  routed.model.cells.find(({ id }) => id === 'route-edge--probe--h').attributes.source = junction.id
  routed.model.cells.find(({ id }) => id === 'route-edge--probe--v').attributes.source = junction.id
  assert.throws(() => validatePhysicalUserJourney(routed.model, routed), /junctionTopology/i)
})

// ── T5 파리티: crossing/overlap 0 · atom transition · mapping drift · label deferred ──
test('T5 canonical route has no crossing or overlap allowlist debt', async () => {
  const routed = await routedUserJourney()
  const { validation } = validatePhysicalUserJourney(routed.model, routed)
  assert.deepEqual(validation.edgeCrossing, { pass: true, count: 0, allowlist: [], violations: [] })
  assert.deepEqual(validation.overlap, { pass: true, count: 0, allowlist: [], violations: [] })
})

test('T5 every physical atom is a transition relation', async () => {
  const routed = await routedUserJourney()
  assert.deepEqual(routed.physicalEdges.filter(({ relationKind }) => relationKind !== 'transition'), [])
})

test('T5 semantic mapping rejects unknown, duplicate, disconnected, and ref drift', async (suite) => {
  await suite.test('unknown mapping key', async () => {
    const routed = await routedUserJourney()
    routed.semanticToPhysical['edge-evil'] = [routed.physicalEdges[0].id]
    rebuildPhysicalReferences(routed)
    assert.throws(() => validatePhysicalUserJourney(routed.model, routed), /mapping|path/i)
  })

  await suite.test('duplicate physical path member', async () => {
    const routed = await routedUserJourney()
    const semanticId = 'edge-uj-editor-to-uj-approve'
    routed.semanticToPhysical[semanticId].splice(1, 0, routed.semanticToPhysical[semanticId][0])
    rebuildPhysicalReferences(routed)
    assert.throws(() => validatePhysicalUserJourney(routed.model, routed), /path/i)
  })

  await suite.test('disconnected physical member', async () => {
    const routed = await routedUserJourney()
    routed.semanticToPhysical['edge-uj-hotkey-to-uj-editor'].push(
      routed.semanticToPhysical['edge-uj-editor-to-uj-approve'].at(-1),
    )
    rebuildPhysicalReferences(routed)
    assert.throws(() => validatePhysicalUserJourney(routed.model, routed), /path/i)
  })

  await suite.test('physical semanticRefs asymmetry', async () => {
    const routed = await routedUserJourney()
    routed.physicalEdges[0].semanticRefs = ['edge-evil']
    assert.throws(() => validatePhysicalUserJourney(routed.model, routed), /ref|model/i)
  })
})

test('T5 static label clearance is explicitly deferred and never disguised as PASS', async () => {
  const routed = await routedUserJourney()
  const { validation } = validatePhysicalUserJourney(routed.model, routed)
  assert.deepEqual(validation.labelClearance, { status: 'deferred-to-browser' })
  assert.equal(Object.hasOwn(validation.labelClearance, 'pass'), false)
})

// ── T6 결정성: 독립 재생성 byte-exact + manifest 카운트 ──
test('T6 generation is deterministic and manifest counts are exact', async () => {
  const sourceXml = await readFile(sourcePath, 'utf8')
  const first = generateUserJourneyRouting(sourceXml)
  const second = generateUserJourneyRouting(sourceXml)
  assert.equal(first.normalizedSource, second.normalizedSource)
  assert.equal(first.xml, second.xml)
  assert.equal(JSON.stringify(first.manifest), JSON.stringify(second.manifest))
  assert.equal(first.manifest.semantic.vertexCount, 9)
  assert.equal(first.manifest.semantic.edgeCount, 2)
  assert.equal(first.manifest.decorations.count, 8)
  assert.equal(first.normalizedSource, sourceXml, 'committed source is already canonical')
})

test('T6 committed .drawio and .routing.json match a fresh generation byte-for-byte', async () => {
  const sourceXml = await readFile(sourcePath, 'utf8')
  const generatedPath = fileURLToPath(new URL('../../labs/drawio/2_Pokeclip_UserJourney.drawio', import.meta.url))
  const manifestFilePath = fileURLToPath(new URL('../../labs/drawio/2_Pokeclip_UserJourney.routing.json', import.meta.url))
  const result = generateUserJourneyRouting(sourceXml)
  assert.equal(await readFile(generatedPath, 'utf8'), result.xml)
  assert.equal(await readFile(manifestFilePath, 'utf8'), `${JSON.stringify(result.manifest, null, 2)}\n`)
})

// ── T2 계약: 9 노드 · 2 transition · 8 decoration exact set ──
test('T2 contract fixes 9 nodes, 2 transition edges, 8 decorations exactly', async () => {
  const contract = JSON.parse(await readFile(contractPath, 'utf8'))
  assert.equal(contract.nodeIds.length, 9)
  assert.equal(new Set(contract.nodeIds).size, 9)
  assert.equal(contract.overlayIds.length, 5)
  assert.equal(contract.annotationIds.length, 3)
  assert.equal(contract.decorationIds.length, 8)
  assert.deepEqual(contract.decorationIds, [...contract.overlayIds, ...contract.annotationIds])
  assert.equal(contract.edges.length, 2)
  assert.deepEqual(
    Object.fromEntries(contract.edges.map(({ relationKind }) => [relationKind, contract.edges.filter((edge) => edge.relationKind === relationKind).length])),
    { transition: 2 },
  )
  assert.ok(contract.nodes.every(({ id, label }) => contract.nodeIds.includes(id) && label.length > 0))
  assert.deepEqual(
    contract.edges.map(({ id, sourceId, targetId, relationKind }) => `${id}|${sourceId}|${targetId}|${relationKind}`),
    [
      'edge-uj-hotkey-to-uj-editor|uj-hotkey|uj-editor|transition',
      'edge-uj-editor-to-uj-approve|uj-editor|uj-approve|transition',
    ],
  )
})

test('T2 canonical source normalizes idempotently and satisfies contract', async () => {
  const first = normalizeUserJourneySource(await sourceModel())
  const firstXml = serializeDrawioXml(first.model)
  const second = normalizeUserJourneySource(parseDrawioXml(firstXml))
  assert.equal(serializeDrawioXml(second.model), firstXml)
})

test('T2 semantic contract rejects vertex ID and transition drift', async (suite) => {
  await suite.test('renamed journey card', async () => {
    const model = await sourceModel()
    model.cells.find(({ id }) => id === 'uj-hotkey').id = 'uj-hotkey-renamed'
    assert.throws(() => normalizeUserJourneySource(model), /semantic contract/i)
  })

  await suite.test('transition relation drift', async () => {
    const model = await sourceModel()
    model.cells.find(({ id }) => id === 'edge-uj-hotkey-to-uj-editor').style.pokeRelationKind = 'feature'
    assert.throws(() => normalizeUserJourneySource(model), /transition|semantic contract/i)
  })
})

test('T2 decoration partition rejects missing, extra, and mistagged cells', async (suite) => {
  await suite.test('missing canonical decoration', async () => {
    const model = await sourceModel()
    model.cells = model.cells.filter(({ id }) => id !== 'ov-lane-broadcast')
    assert.throws(() => normalizeUserJourneySource(model), /decoration/i)
  })

  await suite.test('extra decoration', async () => {
    const model = await sourceModel()
    const extra = structuredClone(model.cells.find(({ id }) => id === 'an-strip'))
    extra.id = 'an-extra'
    model.cells.push(extra)
    assert.throws(() => normalizeUserJourneySource(model), /decoration/i)
  })

  await suite.test('mistagged decoration', async () => {
    const model = await sourceModel()
    model.cells.find(({ id }) => id === 'ov-phase-before').style.pokeKind = 'semantic'
    assert.throws(() => normalizeUserJourneySource(model), /decoration|semantic/i)
  })
})

// ── T3 corridor: 엣지1 x=1345 수직 direct · 엣지2 (1787,600)-(1817,600)-(1817,452)-(2205,452)-(2205,390) ──
test('T3 edge1 is a vertical direct at x=1345 and edge2 follows the Z corridor', async () => {
  const routed = await routedUserJourney()
  const points1 = routed.semanticToPhysical['edge-uj-hotkey-to-uj-editor']
    .map((id) => segmentsOf(routed).find((segment) => segment.id === id))
  const flat1 = points1.flatMap(({ start, end }) => [start, end])
  assert.ok(flat1.every(({ x }) => x === 1345), 'edge1 stays on x=1345')
  assert.deepEqual([flat1[0], flat1.at(-1)], [{ x: 1345, y: 390 }, { x: 1345, y: 500 }])

  const segments = segmentsOf(routed)
  const path2 = routed.semanticToPhysical['edge-uj-editor-to-uj-approve'].map((id) => segments.find((segment) => segment.id === id))
  const corridor = [path2[0].start, ...path2.map(({ end }) => end)]
  assert.deepEqual(corridor, [
    { x: 1787, y: 600 }, { x: 1817, y: 600 }, { x: 1817, y: 452 }, { x: 2205, y: 452 }, { x: 2205, y: 390 },
  ])
})

// ── T1 (조건1, HIGH): annotation을 EDGE_Y_BAND 안으로 옮기면 annotationBand만 단독 FAIL ──
test('T1 moving an annotation into the edge y-band fails annotationBand alone', async () => {
  const routed = await routedUserJourney()
  const band = USERJOURNEY_POLICY.EDGE_Y_BAND
  const strip = routed.model.cells.find(({ id }) => id === 'an-strip')
  strip.geometry.attributes.y = String(Math.round((band.top + band.bottom) / 2))
  let error
  try {
    validatePhysicalUserJourney(routed.model, routed)
  } catch (thrown) {
    error = thrown
  }
  assert.ok(error, 'validation must fail')
  assert.match(error.message, /annotationBand/)
  const failed = Object.entries(error.validation)
    .filter(([, value]) => Object.hasOwn(value, 'pass') && value.pass === false)
    .map(([key]) => key)
  assert.deepEqual(failed, ['annotationBand'], 'annotationBand is the only failing check')
})

test('T1 canonical annotations clear the edge y-band', async () => {
  const routed = await routedUserJourney()
  const { validation } = validatePhysicalUserJourney(routed.model, routed)
  assert.equal(validation.annotationBand.pass, true)
  assert.deepEqual(validation.annotationBand.violations, [])
})
