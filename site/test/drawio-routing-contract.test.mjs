import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildPhysicalIa } from '../scripts/drawio-routing/physical-router.mjs'
import { inspectSemanticPhysicalPaths, validatePhysicalIa } from '../scripts/drawio-routing/route-validation.mjs'
import { normalizeIaSource } from '../scripts/drawio-routing/tree-layout.mjs'
import { edgeCell, parseDrawioXml, pointVertex } from '../scripts/drawio-routing/xml-model.mjs'

const sourcePath = fileURLToPath(new URL('../../labs/drawio/1_Pokeclip_IA.source.drawio', import.meta.url))

async function normalizedIa() {
  const sourceXml = await readFile(sourcePath, 'utf8')
  return normalizeIaSource(parseDrawioXml(sourceXml)).model
}

async function routedIa() {
  const model = await normalizedIa()
  const routed = buildPhysicalIa(model)
  assert.doesNotThrow(() => validatePhysicalIa(routed.model, routed), 'unmodified IA must be a valid baseline')
  return routed
}

function rebuildPhysicalReferences(routed) {
  for (const physical of routed.physicalEdges) {
    physical.semanticRefs = Object.entries(routed.semanticToPhysical)
      .filter(([, physicalIds]) => physicalIds.includes(physical.id))
      .map(([semanticId]) => semanticId)
      .sort()
  }
}

test('semantic mapping rejects a symmetric but unrelated physical branch', async () => {
  const routed = await routedIa()
  const leftSemanticId = 'edge-ia-dashboard-to-ia-obs'
  const unrelatedSemanticId = 'edge-ia-dashboard-to-ia-clip-library'
  routed.semanticToPhysical[leftSemanticId] = [...routed.semanticToPhysical[unrelatedSemanticId]]
  rebuildPhysicalReferences(routed)

  assert.throws(
    () => validatePhysicalIa(routed.model, routed),
    /semantic physical path|trunk/i,
  )
})

test('semantic mapping rejects an unknown key even when physical references are symmetric', async () => {
  const routed = await routedIa()
  routed.semanticToPhysical['edge-evil'] = ['route-edge--root-products--stem--01']
  rebuildPhysicalReferences(routed)

  assert.throws(() => validatePhysicalIa(routed.model, routed), /trunk/i)
})

test('semantic mapping rejects disconnected extras, cycles, and branch contamination', async (suite) => {
  await suite.test('disconnected extra', async () => {
    const routed = await routedIa()
    const semanticId = 'edge-ia-dashboard-to-ia-obs'
    routed.semanticToPhysical[semanticId].push('route-edge--vod--branch--01')
    rebuildPhysicalReferences(routed)
    assert.throws(() => validatePhysicalIa(routed.model, routed), /trunk/i)
  })

  await suite.test('distinct physical edges return to a visited junction', async () => {
    const routed = await routedIa()
    const physicalId = 'route-edge--root-products--rail--02'
    const physical = routed.physicalEdges.find(({ id }) => id === physicalId)
    const modelCell = routed.model.cells.find(({ id }) => id === physicalId)
    assert.ok(physical)
    assert.ok(modelCell)
    physical.targetId = 'route-junction--root-products--01'
    modelCell.attributes.target = physical.targetId
    const errors = inspectSemanticPhysicalPaths(routed.model, routed)
    assert.ok(errors.some((error) => error.includes('cycle at route-junction--root-products--01')), errors.join('\n'))
  })

  await suite.test('duplicate physical ID is rejected before path traversal', async () => {
    const routed = await routedIa()
    const semanticId = 'edge-ia-dashboard-to-ia-obs'
    const path = routed.semanticToPhysical[semanticId]
    path.splice(1, 0, path[0])
    rebuildPhysicalReferences(routed)
    const errors = inspectSemanticPhysicalPaths(routed.model, routed)
    assert.ok(
      errors.includes(`${semanticId}: empty/duplicate physical path`),
      errors.join('\n'),
    )
    assert.throws(() => validatePhysicalIa(routed.model, routed), /trunk/i)
  })

  await suite.test('unrelated branch inserted into an otherwise valid path', async () => {
    const routed = await routedIa()
    const semanticId = 'edge-ia-dashboard-to-ia-clip-editor'
    const path = routed.semanticToPhysical[semanticId]
    path.splice(path.length - 1, 0, 'route-edge--root-products--branch--08')
    rebuildPhysicalReferences(routed)
    assert.throws(() => validatePhysicalIa(routed.model, routed), /trunk/i)
  })
})

test('semantic contract rejects a renamed vertex even when counts and terminals remain valid', async () => {
  const sourceXml = await readFile(sourcePath, 'utf8')
  const model = parseDrawioXml(sourceXml)
  const originalId = 'ia-obs-action-a1-a5'
  const renamedId = 'ia-obs-action-a1-a5-renamed'
  const vertex = model.cells.find(({ id }) => id === originalId)
  assert.ok(vertex)
  vertex.id = renamedId
  vertex.attributes.id = renamedId
  for (const edge of model.cells.filter(({ attributes }) => attributes.edge === '1')) {
    if (edge.attributes.source === originalId) edge.attributes.source = renamedId
    if (edge.attributes.target === originalId) edge.attributes.target = renamedId
  }

  assert.throws(
    () => normalizeIaSource(model),
    /semantic contract/i,
  )
})

test('semantic contract rejects a changed edge terminal even when every ID and count remains valid', async () => {
  const sourceXml = await readFile(sourcePath, 'utf8')
  const model = parseDrawioXml(sourceXml)
  const edge = model.cells.find(({ id }) => id === 'edge-ia-obs-to-ia-obs-page-a1-a5')
  assert.ok(edge)
  edge.attributes.target = 'ia-obs-page-a2-a3'
  assert.throws(() => normalizeIaSource(model), /semantic contract/i)
})

test('validator rejects a hidden semantic edge terminal drift in the model', async () => {
  const routed = await routedIa()
  const edge = routed.model.cells.find(({ id }) => id === 'edge-ia-dashboard-to-ia-obs')
  assert.ok(edge)
  edge.attributes.target = 'ia-clip-library'
  assert.throws(() => validatePhysicalIa(routed.model, routed), /model|trunk/i)
})

test('validator rejects a physical edge terminal drift in the model', async () => {
  const routed = await routedIa()
  const edge = routed.model.cells.find(({ id }) => id === 'route-edge--root-products--branch--01')
  assert.ok(edge)
  edge.attributes.target = 'ia-clip-library'
  assert.throws(() => validatePhysicalIa(routed.model, routed), /model|trunk/i)
})

test('validator rejects a physical semanticRefs drift in the model', async () => {
  const routed = await routedIa()
  const edge = routed.model.cells.find(({ id }) => id === 'route-edge--root-products--branch--01')
  assert.ok(edge)
  edge.style.pokeSemanticRefs = 'edge-evil'
  assert.throws(() => validatePhysicalIa(routed.model, routed), /model|trunk/i)
})

test('validator rejects an unreferenced disconnected physical component present only in the model', async () => {
  const routed = await routedIa()
  const firstJunction = pointVertex('route-junction--evil--01', 2300, 100, 'evil')
  const secondJunction = pointVertex('route-junction--evil--02', 2320, 100, 'evil')
  const physical = edgeCell('route-edge--evil--branch--01', firstJunction.id, secondJunction.id, {
    rounded: '0', html: '0', exitX: '0.5', exitY: '0.5', entryX: '0.5', entryY: '0.5',
    exitPerimeter: '0', entryPerimeter: '0', endArrow: 'none', pokeKind: 'physical',
    pokeRoute: 'trunk', pokeGroup: 'evil', pokePhysicalRole: 'branch', pokeSemanticRefs: '',
  })
  routed.model.cells.push(firstJunction, secondJunction, physical)
  assert.throws(() => validatePhysicalIa(routed.model, routed), /model|trunk/i)
})

test('validator rejects an untagged graph vertex outside the semantic and junction partitions', async () => {
  const routed = await routedIa()
  const vertex = pointVertex('evil-untagged-vertex', 2300, 100, 'evil')
  delete vertex.style.pokeKind
  routed.model.cells.push(vertex)
  assert.throws(() => validatePhysicalIa(routed.model, routed), /model|trunk/i)
})

test('validator rejects an untagged graph edge outside the semantic and physical partitions', async () => {
  const routed = await routedIa()
  const edge = edgeCell(
    'edge-untagged-evil',
    'route-junction--root-products--01',
    'route-junction--root-products--02',
    { html: '0' },
  )
  routed.model.cells.push(edge)
  assert.throws(() => validatePhysicalIa(routed.model, routed), /model|trunk/i)
})

test('validator rejects a physical role drift in the model', async () => {
  const routed = await routedIa()
  const edge = routed.model.cells.find(({ id }) => id === 'route-edge--root-products--branch--01')
  assert.ok(edge)
  edge.style.pokePhysicalRole = 'rail'
  assert.throws(() => validatePhysicalIa(routed.model, routed), /model|trunk/i)
})

test('validator rejects a physical group drift in the model', async () => {
  const routed = await routedIa()
  const edge = routed.model.cells.find(({ id }) => id === 'route-edge--root-products--branch--01')
  assert.ok(edge)
  edge.style.pokeGroup = 'evil'
  assert.throws(() => validatePhysicalIa(routed.model, routed), /model|trunk/i)
})

test('validator rejects a physical route drift in the model', async () => {
  const routed = await routedIa()
  const edge = routed.model.cells.find(({ id }) => id === 'route-edge--root-products--branch--01')
  assert.ok(edge)
  edge.style.pokeRoute = 'lane'
  assert.throws(() => validatePhysicalIa(routed.model, routed), /model|trunk/i)
})

test('validator rejects physical waypoints that drift from result metadata', async () => {
  const routed = await routedIa()
  const edge = routed.model.cells.find(({ id }) => id === 'route-edge--root-products--branch--01')
  assert.ok(edge)
  edge.geometry.points = [{ x: 1100, y: 396 }]
  assert.throws(() => validatePhysicalIa(routed.model, routed), /model|trunk/i)
})

test('validator rejects coordinated root role drift in both model and result metadata', async () => {
  const routed = await routedIa()
  const edgeId = 'route-edge--root-products--stem--01'
  const modelEdge = routed.model.cells.find(({ id }) => id === edgeId)
  const resultEdge = routed.physicalEdges.find(({ id }) => id === edgeId)
  assert.ok(modelEdge)
  assert.ok(resultEdge)
  modelEdge.style.pokePhysicalRole = 'rail'
  resultEdge.role = 'rail'
  assert.throws(() => validatePhysicalIa(routed.model, routed), /trunk/i)
})

test('validator rejects a coordinated extra junction and physical segment', async () => {
  const routed = await routedIa()
  const semanticId = 'edge-ia-login-to-ia-dashboard'
  const existingId = 'route-edge--login--branch--01'
  const junctionId = 'route-junction--login--01'
  const extraId = 'route-edge--login--branch--02'
  const modelEdge = routed.model.cells.find(({ id }) => id === existingId)
  const resultEdge = routed.physicalEdges.find(({ id }) => id === existingId)
  assert.ok(modelEdge)
  assert.ok(resultEdge)
  const junction = pointVertex(junctionId, 1140, 104, 'login')
  const extra = edgeCell(extraId, junctionId, 'ia-dashboard', {
    rounded: '0', html: '0', exitX: '0.5', exitY: '0.5', entryX: '0.5', entryY: '0',
    exitPerimeter: '0', entryPerimeter: '0', endArrow: 'open', pokeKind: 'physical',
    pokeRoute: 'direct', pokeGroup: 'login', pokePhysicalRole: 'branch', pokeSemanticRefs: semanticId,
  })
  modelEdge.attributes.target = junctionId
  modelEdge.style.entryY = '0.5'
  resultEdge.targetId = junctionId
  routed.model.cells.push(junction, extra)
  routed.junctions.push({ id: junctionId, x: 1140, y: 104, group: 'login', role: 'branch' })
  routed.physicalEdges.push({
    id: extraId, sourceId: junctionId, targetId: 'ia-dashboard', group: 'login', route: 'direct', role: 'branch',
    router: 'deterministic-tree-v1', orderedWaypoints: [], semanticRefs: [semanticId],
  })
  routed.semanticToPhysical[semanticId] = [existingId, extraId]
  rebuildPhysicalReferences(routed)
  assert.throws(() => validatePhysicalIa(routed.model, routed), /trunk/i)
})
