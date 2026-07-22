import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  USECASE_CONTRACT_HASH,
  USECASE_PROFILE_HASH,
  USECASE_ROUTING_PROFILE,
  USECASE_SCHEMA_HASH,
  canonicalJson,
  parseRoutingProfile,
} from '../scripts/drawio-routing/routing-profile.mjs'
import { buildFiniteDomains, domainVersionFor } from '../scripts/drawio-routing/routing-domain.mjs'
import { RoutingFailure, solveRouting } from '../scripts/drawio-routing/routing-solver.mjs'
import { generateUseCaseRouting } from '../scripts/drawio-routing/usecase-generator.mjs'

const sourcePath = fileURLToPath(new URL('../../labs/drawio/0_Pokeclip_UseCase.source.drawio', import.meta.url))
const profilePath = fileURLToPath(new URL('../shared/usecase-routing-profile.json', import.meta.url))

const METRIC_KEYS = [
  'actorPenetrationCount',
  'crossingCount',
  'degree4XCount',
  'directionViolationCount',
  'endpointMaximumErrorPx',
  'gatewayViolationCount',
  'groupBorderOverlapCount',
  'groupInteriorPenetrationCount',
  'labelEdgeCollisionCount',
  'labelLabelCollisionCount',
  'labelOutsideCount',
  'labelUnavailableCount',
  'maxDetourRatio',
  'maxSemanticBendCount',
  'microSegmentCount',
  'mixedAtomCount',
  'nodePenetrationCount',
  'nonCentralPortCount',
  'overlapCount',
  'parallelLaneGapMinimumPx',
  'physicalTotalBendCount',
  'resourceCapacityViolationCount',
  'terminalReentryCount',
  'totalSemanticBendCount',
]

function profileClone() {
  return structuredClone(USECASE_ROUTING_PROFILE)
}

function candidate(candidateId, score = [0], resources = []) {
  return { candidateId, canonicalKey: candidateId, scoreLowerBound: score, resources, conflicts: [], hardValid: true }
}

function round(variables, overrides = {}) {
  return {
    round: 0,
    domainVersion: domainVersionFor(USECASE_PROFILE_HASH, 4, 0, variables),
    variables,
    rejectedCandidateReasons: {},
    ...overrides,
  }
}

test('profile parser is fail-closed and canonical SHA-256 is key-order independent', async (suite) => {
  const profileText = await readFile(profilePath, 'utf8')
  const parsed = parseRoutingProfile(profileText)
  assert.equal(parsed.profileHash, USECASE_PROFILE_HASH)
  assert.equal(parsed.schemaHash, USECASE_SCHEMA_HASH)
  assert.equal(parsed.contractHash, USECASE_CONTRACT_HASH)
  assert.equal(canonicalJson({ z: 1, a: { y: 2, b: 3 } }), canonicalJson({ a: { b: 3, y: 2 }, z: 1 }))

  await suite.test('unknown field', () => {
    const profile = profileClone()
    profile.rules.allowCrossing = true
    assert.throws(() => parseRoutingProfile(profile), /PROFILE_UNKNOWN_FIELD/)
  })
  await suite.test('required gateway mapping', () => {
    const profile = profileClone()
    delete profile.containers['env-sys'].permeability.left
    assert.throws(() => parseRoutingProfile(profile), /PROFILE_REQUIRED_FIELD/)
  })
  await suite.test('common minimum cannot be relaxed', () => {
    const profile = profileClone()
    profile.rules.nodeClearancePx = 11
    assert.throws(() => parseRoutingProfile(profile), /PROFILE_RULE_RELAXATION/)
  })
})

test('semantic contract gives every edge a total bundleFamilyKey', () => {
  const edges = USECASE_ROUTING_PROFILE.semanticEdges
  assert.equal(edges.length, 26)
  assert.ok(edges.every(({ bundleFamilyKey }) => typeof bundleFamilyKey === 'string' && bundleFamilyKey.length > 0))
})

test('finite domains are nested, deterministic, complete catalogues with stable versions', async () => {
  const sourceXml = await readFile(sourcePath, 'utf8')
  const first = buildFiniteDomains(sourceXml, USECASE_ROUTING_PROFILE)
  const second = buildFiniteDomains(sourceXml, USECASE_ROUTING_PROFILE)
  assert.deepEqual(first, second)
  assert.equal(first.length, USECASE_ROUTING_PROFILE.finiteDomain.maxRound + 1)
  assert.ok(first.every((item, index) => item.round === index && /^[a-f0-9]{64}$/.test(item.domainVersion)))
  for (let index = 1; index < first.length; index += 1) {
    const previous = new Set(first[index - 1].candidateCatalogue.map(({ candidateId }) => candidateId))
    assert.ok([...previous].every((id) => first[index].candidateCatalogue.some(({ candidateId }) => candidateId === id)))
  }
  assert.ok(first[0].variables.every(({ candidates }) => candidates.some(({ pattern }) => pattern === 'outer')))
})

test('finite domain rejects a thirteenth non-dominated candidate without truncation', () => {
  const variables = [{
    variableId: 'edge:x',
    variableKind: 'edge',
    directDistance: 100,
    candidates: Array.from({ length: 13 }, (_, index) => candidate(`candidate-${index}`, [index])),
  }]
  assert.throws(
    () => solveRouting([round(variables)], { ...USECASE_ROUTING_PROFILE, finiteDomain: { ...USECASE_ROUTING_PROFILE.finiteDomain, maxCandidatesPerVariable: 12 } }),
    (error) => error instanceof RoutingFailure && error.code === 'DOMAIN_TOO_WIDE' && error.partialOutput === undefined,
  )
})

test('solver is deterministic and enforces exactly-one plus n-ary resource capacities globally', () => {
  const variables = [
    {
      variableId: 'edge:a', variableKind: 'edge', directDistance: 20,
      candidates: [
        candidate('a-shared', [0], [{ resourceId: 'port:p', count: 1, capacity: 1 }]),
        candidate('a-free', [2]),
      ],
    },
    {
      variableId: 'edge:b', variableKind: 'edge', directDistance: 20,
      candidates: [
        candidate('b-shared', [0], [{ resourceId: 'port:p', count: 1, capacity: 1 }]),
        candidate('b-free', [1]),
      ],
    },
  ]
  const domain = round(variables)
  const first = solveRouting([domain], USECASE_ROUTING_PROFILE)
  const second = solveRouting([structuredClone(domain)], USECASE_ROUTING_PROFILE)
  assert.deepEqual(first, second)
  assert.equal(first.searchComplete, true)
  assert.equal(first.termination, 'OPTIMAL')
  assert.equal(Object.keys(first.selections).length, variables.length)
  assert.notDeepEqual(
    [first.selections['edge:a'].candidateId, first.selections['edge:b'].candidateId],
    ['a-shared', 'b-shared'],
  )
})

test('state and merge limits fail SEARCH_INCOMPLETE without partial output', async (suite) => {
  const variables = [{
    variableId: 'edge:a', variableKind: 'edge', directDistance: 20,
    candidates: [candidate('a-1'), candidate('a-2')],
  }]
  await suite.test('component state limit', () => {
    const profile = profileClone()
    profile.finiteDomain.maxComponentStates = 1
    assert.throws(
      () => solveRouting([round(variables)], profile),
      (error) => error instanceof RoutingFailure && error.code === 'SEARCH_INCOMPLETE' && error.partialOutput === undefined,
    )
  })
  await suite.test('frontier merge state limit', () => {
    const profile = profileClone()
    profile.finiteDomain.maxMergeStates = 0
    assert.throws(
      () => solveRouting([round(variables)], profile),
      (error) => error instanceof RoutingFailure && error.code === 'SEARCH_INCOMPLETE' && error.partialOutput === undefined,
    )
  })
})

test('exhausted rounds fail closed without a partial solution', () => {
  const variables = [{
    variableId: 'edge:a', variableKind: 'edge', directDistance: 20,
    candidates: [{ ...candidate('invalid'), hardValid: false }],
  }]
  assert.throws(
    () => solveRouting([round(variables)], USECASE_ROUTING_PROFILE),
    (error) => error instanceof RoutingFailure && error.code === 'LAYOUT_DOMAIN_EXHAUSTED' && error.partialOutput === undefined,
  )
})

test('canonical generator emits the approved fail-closed manifest and static metrics', async () => {
  const sourceXml = await readFile(sourcePath, 'utf8')
  const first = generateUseCaseRouting(sourceXml)
  const second = generateUseCaseRouting(sourceXml)
  assert.equal(first.normalizedSource, second.normalizedSource)
  assert.equal(first.xml, second.xml)
  assert.deepEqual(first.manifest, second.manifest)
  assert.deepEqual(Object.keys(first.manifest), [
    'schemaVersion', 'schemaHash', 'engineVersion', 'profileHash', 'contractHash',
    'sourceSha256', 'generatedSha256', 'domainVersion', 'searchComplete', 'termination',
    'rounds', 'score', 'semantic', 'decorations', 'routing', 'resources', 'validation',
  ])
  assert.equal(first.manifest.searchComplete, true)
  assert.equal(first.manifest.termination, 'OPTIMAL')
  assert.ok(first.manifest.rounds.every(({ searchComplete, termination }) => searchComplete && termination === 'OPTIMAL'))
  assert.deepEqual(Object.keys(first.manifest.validation.metrics).sort(), METRIC_KEYS)
  for (const key of [
    'nonCentralPortCount', 'directionViolationCount', 'terminalReentryCount', 'nodePenetrationCount',
    'actorPenetrationCount', 'groupInteriorPenetrationCount', 'groupBorderOverlapCount',
    'gatewayViolationCount', 'crossingCount', 'overlapCount', 'degree4XCount', 'mixedAtomCount',
    'microSegmentCount', 'resourceCapacityViolationCount', 'labelUnavailableCount', 'labelOutsideCount',
    'labelEdgeCollisionCount', 'labelLabelCollisionCount',
  ]) assert.equal(first.manifest.validation.metrics[key], 0, key)
})
