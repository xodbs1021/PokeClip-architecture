import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { normalizeUseCaseSource } from '../scripts/drawio-routing/usecase-layout.mjs'
import { buildPhysicalUseCase } from '../scripts/drawio-routing/usecase-router.mjs'
import { validatePhysicalUseCase } from '../scripts/drawio-routing/usecase-validation.mjs'
import { edgeCell, parseDrawioXml, pointVertex } from '../scripts/drawio-routing/xml-model.mjs'

const sourcePath = fileURLToPath(new URL('../../labs/drawio/0_Pokeclip_UseCase.source.drawio', import.meta.url))
const contractPath = fileURLToPath(new URL('../shared/usecase-semantic-contract.json', import.meta.url))

async function sourceModel() {
  return parseDrawioXml(await readFile(sourcePath, 'utf8'))
}

async function routedUseCase() {
  const normalized = normalizeUseCaseSource(await sourceModel())
  const routed = buildPhysicalUseCase(normalized.model)
  assert.doesNotThrow(() => validatePhysicalUseCase(routed.model, routed), 'canonical Use Case must be valid')
  return routed
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
  const startVertex = pointVertex(startId, start.x, start.y, 'probe')
  const endVertex = pointVertex(endId, end.x, end.y, 'probe')
  const cell = edgeCell(id, startId, endId, {
    rounded: '0', html: '0', exitX: '0.5', exitY: '0.5', entryX: '0.5', entryY: '0.5',
    exitPerimeter: '0', entryPerimeter: '0', endArrow: 'none', pokeKind: 'physical',
    pokeRoute: 'probe', pokeGroup: 'probe', pokePhysicalRole: 'probe', pokeSemanticRefs: semanticId,
  })
  routed.model.cells.push(startVertex, endVertex, cell)
  routed.junctions.push(
    { id: startId, x: start.x, y: start.y, group: 'probe', role: 'probe' },
    { id: endId, x: end.x, y: end.y, group: 'probe', role: 'probe' },
  )
  routed.physicalEdges.push({
    id, sourceId: startId, targetId: endId, group: 'probe', route: 'probe', role: 'probe',
    router: 'deterministic-usecase-v1', orderedWaypoints: [], semanticRefs: [semanticId],
  })
}

function incidentPhysicalEdges(routed, junctionId) {
  return routed.physicalEdges.filter(({ sourceId, targetId }) => sourceId === junctionId || targetId === junctionId)
}

test('canonical contract preserves exact 41 vertices, 26 typed relations, labels, badges, and 8 decorations', async () => {
  const contract = JSON.parse(await readFile(contractPath, 'utf8'))
  assert.equal(contract.actorIds.length, 3)
  assert.equal(contract.useCaseIds.length, 38)
  assert.equal(new Set([...contract.actorIds, ...contract.useCaseIds]).size, 41)
  assert.equal(contract.edges.length, 26)
  assert.deepEqual(
    Object.fromEntries(contract.edges.map(({ relationKind }) => [relationKind, (contract.edges.filter((edge) => edge.relationKind === relationKind)).length])),
    { actor: 19, feature: 7 },
  )
  assert.equal(contract.decorations.length, 8)
  assert.deepEqual(contract.decorationIds, contract.decorations.map(({ id }) => id))
  assert.equal(new Set(contract.decorations.map(({ id }) => id)).size, 8)
  assert.ok(contract.actors.every(({ id, label }) => contract.actorIds.includes(id) && label.length > 0))
  assert.ok(contract.useCases.every(({ id, label, badge }) => contract.useCaseIds.includes(id) && label.length > 0 && typeof badge === 'string'))
  assert.deepEqual(
    contract.edges.map(({ id, sourceId, targetId, relationKind }) => `${id}|${sourceId}|${targetId}|${relationKind}`),
    [
      'edge-ac-streamer-to-uc-plugin-install|ac-streamer|uc-plugin-install|actor',
      'edge-ac-streamer-to-uc-simulcast|ac-streamer|uc-simulcast|actor',
      'edge-ac-streamer-to-uc-hotkey|ac-streamer|uc-hotkey|actor',
      'edge-ac-streamer-to-uc-auto-reconnect|ac-streamer|uc-auto-reconnect|actor',
      'edge-ac-streamer-to-uc-live-watch|ac-streamer|uc-live-watch|actor',
      'edge-ac-streamer-to-uc-clip-range|ac-streamer|uc-clip-range|actor',
      'edge-ac-streamer-to-uc-yt-oauth|ac-streamer|uc-yt-oauth|actor',
      'edge-ac-streamer-to-uc-invite|ac-streamer|uc-invite|actor',
      'edge-ac-streamer-to-uc-approve|ac-streamer|uc-approve|actor',
      'edge-ac-editor-to-uc-live-watch|ac-editor|uc-live-watch|actor',
      'edge-ac-editor-to-uc-jumpcard-list|ac-editor|uc-jumpcard-list|actor',
      'edge-ac-editor-to-uc-clip-range|ac-editor|uc-clip-range|actor',
      'edge-ac-editor-to-uc-upload|ac-editor|uc-upload|actor',
      'edge-ac-editor-to-uc-vod-clip|ac-editor|uc-vod-clip|actor',
      'edge-ac-editor-to-uc-auto-upload|ac-editor|uc-auto-upload|actor',
      'edge-ac-ops-to-uc-ops-account|ac-ops|uc-ops-account|actor',
      'edge-ac-ops-to-uc-ops-monitor|ac-ops|uc-ops-monitor|actor',
      'edge-ac-ops-to-uc-ops-incident|ac-ops|uc-ops-incident|actor',
      'edge-ac-ops-to-uc-ops-stats|ac-ops|uc-ops-stats|actor',
      'edge-uc-auto-highlight-to-uc-jumpcard-list|uc-auto-highlight|uc-jumpcard-list|feature',
      'edge-uc-subtitle-to-uc-title|uc-subtitle|uc-title|feature',
      'edge-uc-template-to-uc-auto-upload|uc-template|uc-auto-upload|feature',
      'edge-uc-vod-clip-to-uc-clip-range|uc-vod-clip|uc-clip-range|feature',
      'edge-uc-hotkey-to-uc-jumpcard-list|uc-hotkey|uc-jumpcard-list|feature',
      'edge-uc-approve-to-uc-upload|uc-approve|uc-upload|feature',
      'edge-uc-upload-to-uc-cc|uc-upload|uc-cc|feature',
    ],
  )
})

test('semantic contract rejects vertex ID and relationKind drift', async (suite) => {
  await suite.test('renamed semantic vertex', async () => {
    const model = await sourceModel()
    model.cells.find(({ id }) => id === 'uc-plugin-install').id = 'uc-plugin-install-renamed'
    assert.throws(() => normalizeUseCaseSource(model), /semantic contract/i)
  })

  await suite.test('changed relation kind', async () => {
    const model = await sourceModel()
    model.cells.find(({ id }) => id === 'edge-ac-streamer-to-uc-plugin-install').style.pokeRelationKind = 'feature'
    assert.throws(() => normalizeUseCaseSource(model), /semantic contract/i)
  })
})

test('decoration partition rejects missing, extra, and mistagged cells', async (suite) => {
  await suite.test('missing canonical decoration', async () => {
    const model = await sourceModel()
    model.cells = model.cells.filter(({ id }) => id !== 'grp-broadcast')
    assert.throws(() => normalizeUseCaseSource(model), /decoration/i)
  })

  await suite.test('extra decoration', async () => {
    const model = await sourceModel()
    const extra = structuredClone(model.cells.find(({ id }) => id === 'grp-broadcast'))
    extra.id = 'grp-extra'
    model.cells.push(extra)
    assert.throws(() => normalizeUseCaseSource(model), /decoration/i)
  })

  await suite.test('mistagged decoration', async () => {
    const model = await sourceModel()
    model.cells.find(({ id }) => id === 'grp-broadcast').style.pokeKind = 'semantic'
    assert.throws(() => normalizeUseCaseSource(model), /decoration/i)
  })
})

test('semantic mapping rejects unknown, duplicate, disconnected, and ref drift', async (suite) => {
  await suite.test('unknown mapping key', async () => {
    const routed = await routedUseCase()
    routed.semanticToPhysical['edge-evil'] = [routed.physicalEdges[0].id]
    rebuildPhysicalReferences(routed)
    assert.throws(() => validatePhysicalUseCase(routed.model, routed), /mapping|path/i)
  })

  await suite.test('duplicate physical path member', async () => {
    const routed = await routedUseCase()
    const semanticId = routed.semanticEdges[0].id
    routed.semanticToPhysical[semanticId].splice(1, 0, routed.semanticToPhysical[semanticId][0])
    rebuildPhysicalReferences(routed)
    assert.throws(() => validatePhysicalUseCase(routed.model, routed), /path/i)
  })

  await suite.test('disconnected physical member', async () => {
    const routed = await routedUseCase()
    const actorEdge = routed.semanticEdges.find(({ sourceId }) => sourceId === 'ac-streamer')
    const unrelated = routed.semanticEdges.find(({ sourceId }) => sourceId === 'ac-editor')
    routed.semanticToPhysical[actorEdge.id].push(routed.semanticToPhysical[unrelated.id].at(-1))
    rebuildPhysicalReferences(routed)
    assert.throws(() => validatePhysicalUseCase(routed.model, routed), /path/i)
  })

  await suite.test('physical semanticRefs asymmetry', async () => {
    const routed = await routedUseCase()
    routed.physicalEdges[0].semanticRefs = ['edge-evil']
    assert.throws(() => validatePhysicalUseCase(routed.model, routed), /ref|model/i)
  })
})

test('validator rejects endpoint error over 1px and diagonal segments', async (suite) => {
  await suite.test('port center error', async () => {
    const routed = await routedUseCase()
    const physical = routed.physicalEdges.find(({ sourceId }) => routed.semanticVertices.includes(sourceId))
    const cell = routed.model.cells.find(({ id }) => id === physical.id)
    cell.style.exitY = String(Number(cell.style.exitY) + 0.25)
    assert.throws(() => validatePhysicalUseCase(routed.model, routed), /endpoint/i)
  })

  await suite.test('diagonal physical segment', async () => {
    const routed = await routedUseCase()
    const physical = routed.physicalEdges.find(({ sourceId, targetId }) => sourceId.startsWith('route-junction') && targetId.startsWith('route-junction'))
    const [start, end] = validatePhysicalUseCase(routed.model, routed).segments
      .filter(({ id }) => id === physical.id)
      .map((segment) => [segment.start, segment.end])[0]
    const target = routed.model.cells.find(({ id }) => id === physical.targetId)
    const attribute = Math.abs(start.x - end.x) <= 1 ? 'x' : 'y'
    target.geometry.attributes[attribute] = String(Number(target.geometry.attributes[attribute]) + 7)
    assert.throws(() => validatePhysicalUseCase(routed.model, routed), /orthogonal/i)
  })
})

test('validator rejects third-node penetration', async () => {
  const routed = await routedUseCase()
  const segment = validatePhysicalUseCase(routed.model, routed).segments.find(({ length, sourceId, targetId }) =>
    length > 100 && sourceId.startsWith('route-junction') && targetId.startsWith('route-junction'))
  const victim = routed.model.cells.find(({ id }) => id === 'uc-track-map')
  victim.geometry.attributes.x = String((segment.start.x + segment.end.x) / 2 - 20)
  victim.geometry.attributes.y = String((segment.start.y + segment.end.y) / 2 - 20)
  victim.geometry.attributes.width = '40'
  victim.geometry.attributes.height = '40'
  assert.throws(() => validatePhysicalUseCase(routed.model, routed), /nodeClearance/i)
})

test('validator rejects crossing and collinear overlap probes independently', async (suite) => {
  await suite.test('x crossing', async () => {
    const routed = await routedUseCase()
    const baseline = validatePhysicalUseCase(routed.model, routed).segments.find(({ length, start, end }) => length > 80 && Math.abs(start.y - end.y) <= 1)
    const semanticId = routed.semanticEdges[0].id
    const x = (baseline.start.x + baseline.end.x) / 2
    addProbeSegment(routed, { id: 'route-edge--probe--cross', start: { x, y: baseline.start.y - 30 }, end: { x, y: baseline.start.y + 30 }, semanticId })
    assert.throws(() => validatePhysicalUseCase(routed.model, routed), /edgeCrossing/i)
  })

  await suite.test('collinear overlap', async () => {
    const routed = await routedUseCase()
    const baseline = validatePhysicalUseCase(routed.model, routed).segments.find(({ length }) => length > 80)
    const semanticId = routed.semanticEdges[0].id
    addProbeSegment(routed, { id: 'route-edge--probe--overlap', start: baseline.start, end: baseline.end, semanticId })
    assert.throws(() => validatePhysicalUseCase(routed.model, routed), /overlap/i)
  })
})

test('canonical route has no crossing or overlap allowlist debt', async () => {
  const routed = await routedUseCase()
  const { validation } = validatePhysicalUseCase(routed.model, routed)
  assert.deepEqual(validation.edgeCrossing, { pass: true, count: 0, allowlist: [], violations: [] })
  assert.deepEqual(validation.overlap, { pass: true, count: 0, allowlist: [], violations: [] })
})

test('canonical physical atoms never mix actor and feature relations', async () => {
  const routed = await routedUseCase()
  assert.deepEqual(
    routed.physicalEdges.filter(({ relationKind }) => relationKind !== 'actor' && relationKind !== 'feature'),
    [],
  )
})

test('validator rejects a physical atom whose declared kind disagrees with its semantic refs', async () => {
  const routed = await routedUseCase()
  const physical = routed.physicalEdges.find(({ relationKind }) => relationKind === 'actor')
  const cell = routed.model.cells.find(({ id }) => id === physical.id)
  physical.relationKind = 'feature'
  physical.route = 'feature-lane'
  cell.style.pokeRelationKind = 'feature'
  cell.style.pokeRoute = 'feature-lane'
  assert.throws(() => validatePhysicalUseCase(routed.model, routed), /physicalRelationKinds/i)
})

test('canonical junctions allow bends and T branches but never a four-way X', async () => {
  const routed = await routedUseCase()
  const fourWay = routed.junctions.filter(({ id }) => {
    const incidents = incidentPhysicalEdges(routed, id)
    const horizontal = incidents.filter(({ expectedStart, expectedEnd }) => expectedStart.y === expectedEnd.y)
    const vertical = incidents.filter(({ expectedStart, expectedEnd }) => expectedStart.x === expectedEnd.x)
    return horizontal.length >= 2 && vertical.length >= 2
  })
  assert.deepEqual(fourWay, [])
})

test('validator rejects a mutated degree-4 X junction even within one actor family', async () => {
  const routed = await routedUseCase()
  const junction = routed.junctions.find(({ id }) => {
    const incidents = incidentPhysicalEdges(routed, id)
    const horizontal = incidents.filter(({ expectedStart, expectedEnd }) => expectedStart.y === expectedEnd.y)
    const vertical = incidents.filter(({ expectedStart, expectedEnd }) => expectedStart.x === expectedEnd.x)
    return incidents.length === 3 && ((horizontal.length === 2 && vertical.length === 1)
      || (horizontal.length === 1 && vertical.length === 2))
  })
  assert.ok(junction)
  const incidents = incidentPhysicalEdges(routed, junction.id)
  const horizontalCount = incidents.filter(({ expectedStart, expectedEnd }) => expectedStart.y === expectedEnd.y).length
  const donor = routed.physicalEdges.find(({ sourceId, targetId }) => sourceId.startsWith('route-junction')
    && targetId.startsWith('route-junction') && sourceId !== junction.id && targetId !== junction.id)
  const donorCell = routed.model.cells.find(({ id }) => id === donor.id)
  const donorTarget = routed.junctions.find(({ id }) => id === donor.targetId)
  const donorTargetCell = routed.model.cells.find(({ id }) => id === donor.targetId)
  const nextPoint = horizontalCount === 2
    ? { x: junction.x, y: junction.y + 24 }
    : { x: junction.x + 24, y: junction.y }
  donor.sourceId = junction.id
  donor.expectedStart = { x: junction.x, y: junction.y }
  donor.expectedEnd = nextPoint
  donorTarget.x = nextPoint.x
  donorTarget.y = nextPoint.y
  donorCell.attributes.source = junction.id
  donorCell.style.exitX = '0.5'
  donorCell.style.exitY = '0.5'
  donorTargetCell.geometry.attributes.x = String(nextPoint.x)
  donorTargetCell.geometry.attributes.y = String(nextPoint.y)
  assert.throws(() => validatePhysicalUseCase(routed.model, routed), /junctionTopology/i)
})

test('validator rejects duplicate junction metadata even when the model remains unchanged', async () => {
  const routed = await routedUseCase()
  routed.junctions.push(structuredClone(routed.junctions[0]))
  assert.throws(() => validatePhysicalUseCase(routed.model, routed), /junction|modelResult/i)
})

test('actor spine policy rejects cardinality and stem ref drift', async (suite) => {
  await suite.test('actor spine metadata cardinality', async () => {
    const routed = await routedUseCase()
    delete routed.actorSpines['ac-streamer']
    assert.throws(() => validatePhysicalUseCase(routed.model, routed), /actorSpines/i)
  })

  await suite.test('actor relation no longer shares its actor stem', async () => {
    const routed = await routedUseCase()
    const { stemId, semanticEdgeIds } = routed.actorSpines['ac-streamer']
    routed.semanticToPhysical[semanticEdgeIds[0]] = routed.semanticToPhysical[semanticEdgeIds[0]].filter((id) => id !== stemId)
    rebuildPhysicalReferences(routed)
    assert.throws(() => validatePhysicalUseCase(routed.model, routed), /actorSpines|path/i)
  })
})

test('static label clearance is explicitly deferred and never disguised as PASS', async () => {
  const routed = await routedUseCase()
  const { validation } = validatePhysicalUseCase(routed.model, routed)
  assert.deepEqual(validation.labelClearance, { status: 'deferred-to-browser' })
  assert.equal(Object.hasOwn(validation.labelClearance, 'pass'), false)
})
