import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const modulePath = fileURLToPath(new URL('../src/lib/drawio/useCaseManifestDiagnostics.ts', import.meta.url))

async function loadManifestModule() {
  const source = await readFile(modulePath, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const context = { module: { exports: {} }, exports: {} }
  context.exports = context.module.exports
  vm.runInNewContext(compiled, context, { filename: 'useCaseManifestDiagnostics.cjs' })
  return context.module.exports
}

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)
const HASH_D = 'd'.repeat(64)

function browserMetrics() {
  return {
    endpointMaximumErrorPx: 0,
    nonCentralPortCount: 0,
    directionViolationCount: 0,
    terminalReentryCount: 0,
    nodePenetrationCount: 0,
    actorPenetrationCount: 0,
    groupInteriorPenetrationCount: 0,
    groupBorderOverlapCount: 0,
    gatewayViolationCount: 0,
    crossingCount: 0,
    overlapCount: 0,
    degree4XCount: 0,
    mixedAtomCount: 0,
    microSegmentCount: 0,
    parallelLaneGapMinimumPx: 16,
    resourceCapacityViolationCount: 0,
    totalSemanticBendCount: 1,
    maxSemanticBendCount: 1,
    physicalTotalBendCount: 1,
    maxDetourRatio: 1.25,
    labelUnavailableCount: 0,
    labelOutsideCount: 0,
    labelEdgeCollisionCount: 0,
    labelLabelCollisionCount: 0,
  }
}

function canonicalManifest() {
  return {
    schemaVersion: 4,
    schemaHash: HASH_A,
    engineVersion: 'usecase-routing-v4',
    profileHash: HASH_B,
    contractHash: HASH_C,
    sourceSha256: HASH_D,
    generatedSha256: HASH_A,
    domainVersion: HASH_D,
    searchComplete: true,
    termination: 'OPTIMAL',
    rounds: [{
      round: 0,
      domainVersion: HASH_D,
      candidateCount: 4,
      variableCount: 1,
      componentCount: 1,
      exploredStates: 12,
      prunedStates: 4,
      backtrackStates: 2,
      mergeStates: 1,
      searchComplete: true,
      termination: 'OPTIMAL',
      rejectedCandidateReasons: {},
    }],
    score: {
      tuple: [0, 1, 1, 1, 0, 0, 0, 0, 1.25, 1.25, 100, 0, 0, 0, 1000, 'candidate-a'],
      canonicalTieKey: 'candidate-a',
      edgeCountOverProfileBendTarget: 0,
      maxSemanticEdgeBendCount: 1,
      totalSemanticEdgeBendCount: 1,
      physicalTotalBendCount: 1,
      maxBundleTrunkBranchBendCount: 0,
      totalBundleTrunkBranchBendCount: 0,
      maxPortDirectionPenalty: 0,
      totalPortDirectionPenalty: 0,
      maxDetourRatio: 1.25,
      totalDetourRatio: 1.25,
      totalManhattanLength: 100,
      maxActorDisplacement: 0,
      totalActorDisplacement: 0,
      totalGroupDisplacement: 0,
      canvasArea: 1000,
    },
    semantic: {
      vertexIds: ['actor', 'node'],
      edges: [{ id: 'edge', sourceId: 'actor', targetId: 'node', relationKind: 'actor' }],
    },
    decorations: { ids: ['group'] },
    routing: {
      junctions: [{ id: 'junction' }],
      physicalEdges: [{ id: 'physical', semanticRefs: ['edge'] }],
      semanticToPhysical: { edge: ['physical'] },
    },
    resources: { complete: true, capacities: [], consumption: [], violations: [] },
    validation: { metrics: browserMetrics() },
  }
}

function inputs() {
  return {
    expected: { schemaVersion: 4, schemaHash: HASH_A, profileHash: HASH_B, contractHash: HASH_C },
    rendered: {
      semanticVertexIds: ['actor', 'node'],
      semanticEdgeTuples: ['edge|actor|node|actor'],
      decorationIds: ['group'],
      junctionIds: ['junction'],
      physicalEdgeIds: ['physical'],
      semanticToPhysical: { edge: ['physical'] },
    },
    measured: browserMetrics(),
    fontReady: true,
  }
}

test('complete v4 manifest passes digest, completion, set, and browser metric parity gates', async () => {
  const { inspectUseCaseManifest } = await loadManifestModule()
  const result = inspectUseCaseManifest(canonicalManifest(), inputs())
  assert.equal(result.manifest.pass, true, result.manifest.detail)
  assert.equal(result.setParity.pass, true, result.setParity.detail)
  assert.equal(result.geometryParity.pass, true, result.geometryParity.detail)
})

test('manifest gate fails closed for missing or drifted hashes and incomplete search state', async (suite) => {
  const { inspectUseCaseManifest } = await loadManifestModule()
  const mutations = [
    ['schemaVersion', (manifest) => { manifest.schemaVersion = 3 }],
    ['schemaHash', (manifest) => { delete manifest.schemaHash }],
    ['profileHash', (manifest) => { manifest.profileHash = HASH_C }],
    ['contractHash', (manifest) => { manifest.contractHash = '' }],
    ['searchComplete', (manifest) => { manifest.searchComplete = false }],
    ['domainVersion', (manifest) => { manifest.domainVersion = '' }],
    ['termination', (manifest) => { manifest.termination = 'SEARCH_INCOMPLETE' }],
    ['rounds', (manifest) => { manifest.rounds = [] }],
    ['score', (manifest) => { manifest.score = {} }],
    ['resources', (manifest) => { delete manifest.resources }],
    ['resources', (manifest) => { manifest.resources.complete = false }],
    ['resources', (manifest) => { manifest.resources.violations.push({ resourceId: 'port', capacity: 1, consumed: 2 }) }],
  ]
  for (const [name, mutate] of mutations) {
    await suite.test(name, () => {
      const manifest = canonicalManifest()
      mutate(manifest)
      const result = inspectUseCaseManifest(manifest, inputs())
      assert.equal(result.manifest.pass, false, `${name} must fail closed`)
      assert.match(result.manifest.detail, new RegExp(name, 'i'))
    })
  }
})

test('manifest set parity rejects semantic, decoration, physical, junction, and mapping drift', async (suite) => {
  const { inspectUseCaseManifest } = await loadManifestModule()
  const mutations = [
    ['semantic vertices', (manifest) => manifest.semantic.vertexIds.push('extra')],
    ['semantic edges', (manifest) => { manifest.semantic.edges[0].targetId = 'wrong' }],
    ['decorations', (manifest) => manifest.decorations.ids.push('extra')],
    ['junctions', (manifest) => manifest.routing.junctions.push({ id: 'extra' })],
    ['physical edges', (manifest) => manifest.routing.physicalEdges.push({ id: 'extra', semanticRefs: ['edge'] })],
    ['semantic mapping', (manifest) => manifest.routing.semanticToPhysical.edge.push('extra')],
  ]
  for (const [name, mutate] of mutations) {
    await suite.test(name, () => {
      const manifest = canonicalManifest()
      mutate(manifest)
      const result = inspectUseCaseManifest(manifest, inputs())
      assert.equal(result.setParity.pass, false, `${name} must fail closed`)
    })
  }
})

test('every SVG-remeasurable metric must exist and exactly match the manifest', async () => {
  const { inspectUseCaseManifest, USE_CASE_BROWSER_METRIC_KEYS } = await loadManifestModule()
  for (const key of USE_CASE_BROWSER_METRIC_KEYS) {
    const missing = canonicalManifest()
    delete missing.validation.metrics[key]
    assert.equal(inspectUseCaseManifest(missing, inputs()).geometryParity.pass, false, `${key}: missing`)

    const drifted = canonicalManifest()
    drifted.validation.metrics[key] += 1
    assert.equal(inspectUseCaseManifest(drifted, inputs()).geometryParity.pass, false, `${key}: drifted`)
  }
})

test('font unavailable, bounds unavailable, and deferred label state are FAIL', async () => {
  const { inspectUseCaseManifest } = await loadManifestModule()

  const fontMissing = inputs()
  fontMissing.fontReady = false
  assert.equal(inspectUseCaseManifest(canonicalManifest(), fontMissing).geometryParity.pass, false)

  const boundsMissing = inputs()
  boundsMissing.measured.labelUnavailableCount = 1
  assert.equal(inspectUseCaseManifest(canonicalManifest(), boundsMissing).geometryParity.pass, false)

  const deferred = canonicalManifest()
  deferred.validation.metrics.labelUnavailableCount = 'deferred-to-browser'
  assert.equal(inspectUseCaseManifest(deferred, inputs()).geometryParity.pass, false)
})
