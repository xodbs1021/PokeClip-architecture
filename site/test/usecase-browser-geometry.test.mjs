import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const modulePath = fileURLToPath(new URL('../src/lib/drawio/useCaseBrowserMeasurements.ts', import.meta.url))

async function loadMeasurements() {
  const source = await readFile(modulePath, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const context = { module: { exports: {} }, exports: {} }
  context.exports = context.module.exports
  vm.runInNewContext(compiled, context, { filename: 'useCaseBrowserMeasurements.cjs' })
  return context.module.exports
}

function directFixture() {
  const edgeDefinition = { id: 'edge', sourceId: 'actor', targetId: 'node', relationKind: 'actor' }
  const topology = {
    vertexIds: new Set(['actor', 'node']),
    edgeIds: new Set(['edge']),
    junctionIds: new Set(),
    physicalEdgeIds: new Set(['physical']),
    terminalsOf: (id) => id === 'edge' ? { sourceId: 'actor', targetId: 'node' } : null,
    relationKindOf: () => 'actor',
    physicalEdgeIdsOf: (id) => new Set(id === 'edge' ? ['physical'] : []),
  }
  return {
    scene: { topology },
    contract: {
      actorIds: ['actor'],
      useCaseIds: ['node'],
      decorationIds: ['group'],
      useCases: [{ id: 'node', groupId: 'group' }],
      decorations: [{ id: 'group', decorationKind: 'group' }],
      edges: [edgeDefinition],
    },
    snapshot: {
      vertices: [
        { id: 'actor', pokeKind: 'semantic', bounds: { x: 0, y: 0, width: 10, height: 10 }, labelBounds: { x: 0, y: 10, width: 10, height: 10 }, labelNodeMapped: true, childCount: 0, label: 'actor' },
        { id: 'node', pokeKind: 'semantic', bounds: { x: 90, y: 0, width: 20, height: 10 }, labelBounds: { x: 92, y: 2, width: 16, height: 6 }, labelNodeMapped: true, childCount: 0, label: 'node' },
        { id: 'group', pokeKind: 'decoration', bounds: { x: 80, y: -10, width: 40, height: 30 }, labelBounds: { x: 82, y: -8, width: 10, height: 4 }, labelNodeMapped: true, childCount: 1, label: 'group' },
      ],
      junctions: [],
      edges: [{
        id: 'physical', sourceId: 'actor', targetId: 'node',
        points: [{ x: 10, y: 5 }, { x: 90, y: 5 }],
        style: { exitX: 1, exitY: 0.5, entryX: 0, entryY: 0.5, pokeRelationKind: 'actor' },
        route: 'direct', group: 'actor', role: 'branch', semanticRefs: ['edge'], labelBounds: null, label: '',
      }],
    },
  }
}

test('direct SVG route is independently measured into the canonical metric set', async () => {
  const { measureUseCaseBrowser } = await loadMeasurements()
  const fixture = directFixture()
  const result = measureUseCaseBrowser(fixture.scene, fixture.snapshot, fixture.contract)

  assert.equal(result.metrics.endpointMaximumErrorPx, 0)
  assert.equal(result.metrics.nonCentralPortCount, 0)
  assert.equal(result.metrics.directionViolationCount, 0)
  assert.equal(result.metrics.terminalReentryCount, 0)
  assert.equal(result.metrics.nodePenetrationCount, 0)
  assert.equal(result.metrics.actorPenetrationCount, 0)
  assert.equal(result.metrics.groupInteriorPenetrationCount, 0)
  assert.equal(result.metrics.groupBorderOverlapCount, 0)
  assert.equal(result.metrics.gatewayViolationCount, 0)
  assert.equal(result.metrics.crossingCount, 0)
  assert.equal(result.metrics.overlapCount, 0)
  assert.equal(result.metrics.degree4XCount, 0)
  assert.equal(result.metrics.mixedAtomCount, 0)
  assert.equal(result.metrics.parallelLaneGapMinimumPx, 16)
  assert.equal(result.metrics.microSegmentCount, 0)
  assert.equal(result.metrics.totalSemanticBendCount, 0)
  assert.equal(result.metrics.maxSemanticBendCount, 0)
  assert.equal(result.metrics.physicalTotalBendCount, 0)
  assert.equal(result.metrics.maxDetourRatio, 1)
  assert.equal(result.metrics.labelUnavailableCount, 0)
  assert.equal(result.metrics.labelOutsideCount, 0)
  assert.equal(result.metrics.labelEdgeCollisionCount, 0)
  assert.equal(result.metrics.labelLabelCollisionCount, 0)
  assert.deepEqual([...result.rendered.semanticEdgeTuples], ['edge|actor|node|actor'])
  assert.deepEqual([...result.rendered.semanticToPhysical.edge], ['physical'])
})

test('wrong terminal direction and third-node penetration are measured from SVG geometry', async () => {
  const { measureUseCaseBrowser } = await loadMeasurements()
  const fixture = directFixture()
  fixture.snapshot.edges[0].style.exitX = 0
  fixture.snapshot.vertices.push({
    id: 'victim', pokeKind: 'semantic', bounds: { x: 45, y: 0, width: 10, height: 10 },
    labelBounds: { x: 46, y: 2, width: 8, height: 6 }, labelNodeMapped: true, childCount: 0, label: 'victim',
  })
  fixture.contract.useCaseIds.push('victim')
  fixture.scene.topology.vertexIds.add('victim')

  const { metrics } = measureUseCaseBrowser(fixture.scene, fixture.snapshot, fixture.contract)
  assert.ok(metrics.endpointMaximumErrorPx > 1)
  assert.equal(metrics.directionViolationCount, 1)
  assert.equal(metrics.nodePenetrationCount, 1)
})

test('semantic bend and detour are reconstructed over ordered physical paths', async () => {
  const { measureUseCaseBrowser } = await loadMeasurements()
  const fixture = directFixture()
  fixture.scene.topology.junctionIds.add('junction-a')
  fixture.scene.topology.junctionIds.add('junction-b')
  fixture.scene.topology.physicalEdgeIds = new Set(['physical-a', 'physical-b', 'physical-c'])
  fixture.scene.topology.physicalEdgeIdsOf = () => new Set(['physical-a', 'physical-b', 'physical-c'])
  fixture.snapshot.junctions.push(
    { id: 'junction-a', point: { x: 50, y: 5 }, group: 'actor' },
    { id: 'junction-b', point: { x: 50, y: 15 }, group: 'actor' },
  )
  fixture.snapshot.edges = [
    { ...fixture.snapshot.edges[0], id: 'physical-a', targetId: 'junction-a', points: [{ x: 10, y: 5 }, { x: 50, y: 5 }], style: { exitX: 1, exitY: 0.5, entryX: 0.5, entryY: 0.5 } },
    { ...fixture.snapshot.edges[0], id: 'physical-b', sourceId: 'junction-a', targetId: 'junction-b', points: [{ x: 50, y: 5 }, { x: 50, y: 15 }], style: { exitX: 0.5, exitY: 0.5, entryX: 0.5, entryY: 0.5 } },
    { ...fixture.snapshot.edges[0], id: 'physical-c', sourceId: 'junction-b', points: [{ x: 50, y: 15 }, { x: 90, y: 5 }], style: { exitX: 0.5, exitY: 0.5, entryX: 0, entryY: 0.5 } },
  ]

  const { metrics } = measureUseCaseBrowser(fixture.scene, fixture.snapshot, fixture.contract)
  assert.equal(metrics.maxSemanticBendCount, 2)
  assert.equal(metrics.totalSemanticBendCount, 2)
  assert.equal(metrics.physicalTotalBendCount, 2)
  assert.equal(metrics.maxDetourRatio, 1.25)
})
