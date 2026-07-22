export const USE_CASE_BROWSER_METRIC_KEYS = Object.freeze([
  'endpointMaximumErrorPx',
  'nonCentralPortCount',
  'directionViolationCount',
  'terminalReentryCount',
  'nodePenetrationCount',
  'actorPenetrationCount',
  'groupInteriorPenetrationCount',
  'groupBorderOverlapCount',
  'gatewayViolationCount',
  'crossingCount',
  'overlapCount',
  'degree4XCount',
  'mixedAtomCount',
  'parallelLaneGapMinimumPx',
  'microSegmentCount',
  'totalSemanticBendCount',
  'maxSemanticBendCount',
  'physicalTotalBendCount',
  'maxDetourRatio',
  'labelUnavailableCount',
  'labelOutsideCount',
  'labelEdgeCollisionCount',
  'labelLabelCollisionCount',
] as const)

export const USE_CASE_MANIFEST_ONLY_METRIC_KEYS = Object.freeze([
  'resourceCapacityViolationCount',
] as const)

export type UseCaseBrowserMetricKey = typeof USE_CASE_BROWSER_METRIC_KEYS[number]
export type UseCaseBrowserMetrics = Readonly<Record<UseCaseBrowserMetricKey, number>>

export interface UseCaseManifestExpectations {
  readonly schemaVersion: string | number
  readonly schemaHash: string
  readonly engineVersion?: string
  readonly profileHash: string
  readonly contractHash: string
}

export interface UseCaseRenderedSets {
  readonly semanticVertexIds: readonly string[]
  readonly semanticEdgeTuples: readonly string[]
  readonly decorationIds: readonly string[]
  readonly junctionIds: readonly string[]
  readonly physicalEdgeIds: readonly string[]
  readonly semanticToPhysical: Readonly<Record<string, readonly string[]>>
}

export interface UseCaseManifestInputs {
  readonly expected: UseCaseManifestExpectations
  readonly rendered: UseCaseRenderedSets
  readonly measured: UseCaseBrowserMetrics
  readonly fontReady: boolean
}

export interface UseCaseManifestInspection {
  readonly manifest: InspectionGate
  readonly setParity: InspectionGate
  readonly geometryParity: InspectionGate
}

interface InspectionGate {
  readonly pass: boolean
  readonly detail: string
}

type UnknownRecord = Record<string, unknown>

const MANIFEST_KEYS = Object.freeze([
  'schemaVersion', 'schemaHash', 'engineVersion', 'profileHash', 'contractHash',
  'sourceSha256', 'generatedSha256', 'domainVersion', 'searchComplete', 'termination',
  'rounds', 'score', 'semantic', 'decorations', 'routing', 'resources', 'validation',
])
const ROUND_KEYS = Object.freeze([
  'round', 'domainVersion', 'candidateCount', 'variableCount', 'componentCount',
  'exploredStates', 'prunedStates', 'backtrackStates', 'mergeStates',
  'searchComplete', 'termination', 'rejectedCandidateReasons',
])
const SCORE_KEYS = Object.freeze([
  'tuple', 'canonicalTieKey', 'edgeCountOverProfileBendTarget',
  'maxSemanticEdgeBendCount', 'totalSemanticEdgeBendCount', 'physicalTotalBendCount',
  'maxBundleTrunkBranchBendCount', 'totalBundleTrunkBranchBendCount',
  'maxPortDirectionPenalty', 'totalPortDirectionPenalty', 'maxDetourRatio',
  'totalDetourRatio', 'totalManhattanLength', 'maxActorDisplacement',
  'totalActorDisplacement', 'totalGroupDisplacement', 'canvasArea',
])
const SCORE_SCALAR_KEYS = SCORE_KEYS.filter((key) => key !== 'tuple' && key !== 'canonicalTieKey')
const RESOURCE_KEYS = Object.freeze(['complete', 'capacities', 'consumption', 'violations'])
const SHA256_PATTERN = /^[0-9a-f]{64}$/

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: UnknownRecord, expected: readonly string[]) {
  const actual = Object.keys(value).sort()
  const canonical = [...expected].sort()
  return actual.length === canonical.length && actual.every((key, index) => key === canonical[index])
}

function nonEmptyRecord(value: unknown): value is UnknownRecord {
  return isRecord(value) && Object.keys(value).length > 0
}

function sha256(value: unknown) {
  return typeof value === 'string' && SHA256_PATTERN.test(value)
}

function finiteNonNegative(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function completeRound(value: UnknownRecord) {
  return hasExactKeys(value, ROUND_KEYS)
    && Number.isInteger(value.round) && finiteNonNegative(value.round)
    && sha256(value.domainVersion)
    && ['candidateCount', 'variableCount', 'componentCount', 'exploredStates', 'prunedStates', 'backtrackStates', 'mergeStates']
      .every((key) => Number.isInteger(value[key]) && finiteNonNegative(value[key]))
    && value.searchComplete === true
    && value.termination === 'OPTIMAL'
    && isRecord(value.rejectedCandidateReasons)
    && Object.values(value.rejectedCandidateReasons).every((count) => Number.isInteger(count) && finiteNonNegative(count))
}

function completeScore(value: unknown) {
  if (!isRecord(value) || !hasExactKeys(value, SCORE_KEYS)) return false
  const tuple = value.tuple
  return Array.isArray(tuple) && tuple.length === SCORE_SCALAR_KEYS.length + 1
    && tuple.every((scalar) => typeof scalar === 'string' && scalar.length > 0 || finiteNonNegative(scalar))
    && typeof value.canonicalTieKey === 'string' && value.canonicalTieKey.length > 0
    && SCORE_SCALAR_KEYS.every((key) => finiteNonNegative(value[key]))
}

function completeResources(value: unknown) {
  if (!isRecord(value) || !hasExactKeys(value, RESOURCE_KEYS)) return false
  const capacities = recordArray(value.capacities)
  const consumption = recordArray(value.consumption)
  const violations = recordArray(value.violations)
  return value.complete === true && capacities !== null && consumption !== null
    && violations !== null && violations.length === 0
}

function uniqueStrings(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item.length > 0)) return null
  return new Set(value).size === value.length ? value : null
}

function recordArray(value: unknown): UnknownRecord[] | null {
  return Array.isArray(value) && value.every(isRecord) ? value : null
}

function sameStringSet(left: readonly string[] | null, right: readonly string[]) {
  if (!left || new Set(right).size !== right.length || left.length !== right.length) return false
  const expected = new Set(right)
  return left.every((value) => expected.has(value))
}

function semanticEdgeTuples(value: unknown): string[] | null {
  const edges = recordArray(value)
  if (!edges) return null
  const tuples = edges.flatMap((edge) => {
    const { id, sourceId, targetId, relationKind } = edge
    return typeof id === 'string' && id.length > 0
      && typeof sourceId === 'string' && sourceId.length > 0
      && typeof targetId === 'string' && targetId.length > 0
      && typeof relationKind === 'string' && relationKind.length > 0
      ? [`${id}|${sourceId}|${targetId}|${relationKind}`] : []
  })
  return tuples.length === edges.length && new Set(tuples).size === tuples.length ? tuples : null
}

function objectIds(value: unknown): string[] | null {
  const records = recordArray(value)
  if (!records) return null
  const ids = records.map(({ id }) => id)
  return uniqueStrings(ids)
}

function mappingSets(value: unknown): Record<string, readonly string[]> | null {
  if (!isRecord(value)) return null
  const mapping: Record<string, readonly string[]> = {}
  for (const [semanticId, physicalIds] of Object.entries(value)) {
    const ids = uniqueStrings(physicalIds)
    if (!semanticId || !ids || ids.length === 0) return null
    mapping[semanticId] = ids
  }
  return Object.keys(mapping).length > 0 ? mapping : null
}

function sameMapping(
  actual: Readonly<Record<string, readonly string[]>> | null,
  expected: Readonly<Record<string, readonly string[]>>,
) {
  if (!actual) return false
  const actualKeys = Object.keys(actual)
  const expectedKeys = Object.keys(expected)
  return sameStringSet(actualKeys, expectedKeys)
    && expectedKeys.every((key) => sameStringSet(actual[key] ?? null, expected[key] ?? []))
}

function manifestGate(manifest: unknown, expected: UseCaseManifestExpectations): InspectionGate {
  if (!isRecord(manifest)) return { pass: false, detail: 'manifest object 누락' }
  const failures: string[] = []
  if (!hasExactKeys(manifest, MANIFEST_KEYS)) failures.push('top-level schema')
  if (manifest.schemaVersion !== expected.schemaVersion) failures.push('schemaVersion')
  if (!sha256(manifest.schemaHash) || manifest.schemaHash !== expected.schemaHash) failures.push('schemaHash')
  if (!sha256(manifest.profileHash) || manifest.profileHash !== expected.profileHash) failures.push('profileHash')
  if (!sha256(manifest.contractHash) || manifest.contractHash !== expected.contractHash) failures.push('contractHash')
  if (typeof manifest.engineVersion !== 'string' || manifest.engineVersion.length === 0
    || expected.engineVersion !== undefined && manifest.engineVersion !== expected.engineVersion) failures.push('engineVersion')
  if (!sha256(manifest.sourceSha256)) failures.push('sourceSha256')
  if (!sha256(manifest.generatedSha256)) failures.push('generatedSha256')
  if (!sha256(manifest.domainVersion)) failures.push('domainVersion')
  if (manifest.searchComplete !== true) failures.push('searchComplete')
  if (manifest.termination !== 'OPTIMAL') failures.push('termination')
  const rounds = recordArray(manifest.rounds)
  if (!rounds || rounds.length === 0 || !rounds.every(completeRound)
    || rounds.at(-1)?.domainVersion !== manifest.domainVersion) failures.push('rounds')
  if (!completeScore(manifest.score)) failures.push('score')
  if (!nonEmptyRecord(manifest.semantic)) failures.push('semantic')
  if (!nonEmptyRecord(manifest.decorations)) failures.push('decorations')
  if (!nonEmptyRecord(manifest.routing)) failures.push('routing')
  if (!completeResources(manifest.resources)) failures.push('resources')
  if (!nonEmptyRecord(manifest.validation)) failures.push('validation')
  return {
    pass: failures.length === 0,
    detail: failures.length === 0 ? 'schema·digest·complete search state 일치' : `invalid ${failures.join(', ')}`,
  }
}

function setParityGate(manifest: unknown, rendered: UseCaseRenderedSets): InspectionGate {
  if (!isRecord(manifest)) return { pass: false, detail: 'manifest object 누락' }
  const semantic = isRecord(manifest.semantic) ? manifest.semantic : null
  const decorations = isRecord(manifest.decorations) ? manifest.decorations : null
  const routing = isRecord(manifest.routing) ? manifest.routing : null
  const failures: string[] = []
  if (!sameStringSet(uniqueStrings(semantic?.vertexIds), rendered.semanticVertexIds)) failures.push('semantic vertices')
  if (!sameStringSet(semanticEdgeTuples(semantic?.edges), rendered.semanticEdgeTuples)) failures.push('semantic edges')
  if (!sameStringSet(uniqueStrings(decorations?.ids), rendered.decorationIds)) failures.push('decorations')
  if (!sameStringSet(objectIds(routing?.junctions), rendered.junctionIds)) failures.push('junctions')
  if (!sameStringSet(objectIds(routing?.physicalEdges), rendered.physicalEdgeIds)) failures.push('physical edges')
  if (!sameMapping(mappingSets(routing?.semanticToPhysical), rendered.semanticToPhysical)) failures.push('semantic mapping')
  return {
    pass: failures.length === 0,
    detail: failures.length === 0 ? 'model↔manifest exact set parity' : `drift ${failures.join(', ')}`,
  }
}

function geometryParityGate(
  manifest: unknown,
  measured: UseCaseBrowserMetrics,
  fontReady: boolean,
): InspectionGate {
  const validation = isRecord(manifest) && isRecord(manifest.validation) ? manifest.validation : null
  const metrics = validation && isRecord(validation.metrics) ? validation.metrics : null
  const failures: string[] = []
  for (const key of USE_CASE_BROWSER_METRIC_KEYS) {
    const manifestValue = metrics?.[key]
    const measuredValue = measured[key]
    if (typeof manifestValue !== 'number' || !Number.isFinite(manifestValue)) {
      failures.push(`${key}:missing`)
    } else if (!Number.isFinite(measuredValue) || manifestValue !== measuredValue) {
      failures.push(`${key}:drift`)
    }
  }
  const resourceViolationCount = metrics?.resourceCapacityViolationCount
  if (resourceViolationCount !== 0) failures.push('resourceCapacityViolationCount:manifest')
  if (!fontReady) failures.push('font unavailable')
  if (measured.labelUnavailableCount !== 0) failures.push('bounds unavailable')
  const zeroViolationKeys: readonly UseCaseBrowserMetricKey[] = [
    'nonCentralPortCount', 'directionViolationCount', 'terminalReentryCount',
    'nodePenetrationCount', 'actorPenetrationCount', 'groupInteriorPenetrationCount',
    'groupBorderOverlapCount', 'gatewayViolationCount', 'crossingCount', 'overlapCount',
    'degree4XCount', 'mixedAtomCount', 'microSegmentCount',
    'labelUnavailableCount', 'labelOutsideCount', 'labelEdgeCollisionCount', 'labelLabelCollisionCount',
  ]
  if (measured.endpointMaximumErrorPx > 1) failures.push('endpointMaximumErrorPx:limit')
  if (measured.parallelLaneGapMinimumPx < 16) failures.push('parallelLaneGapMinimumPx:limit')
  for (const key of zeroViolationKeys) {
    if (measured[key] !== 0) failures.push(`${key}:nonzero`)
  }
  return {
    pass: failures.length === 0,
    detail: failures.length === 0 ? 'SVG 재측정 metric exact parity' : `invalid ${failures.join(', ')}`,
  }
}

export function inspectUseCaseManifest(
  manifest: unknown,
  inputs: UseCaseManifestInputs,
): UseCaseManifestInspection {
  return {
    manifest: manifestGate(manifest, inputs.expected),
    setParity: setParityGate(manifest, inputs.rendered),
    geometryParity: geometryParityGate(manifest, inputs.measured, inputs.fontReady),
  }
}
