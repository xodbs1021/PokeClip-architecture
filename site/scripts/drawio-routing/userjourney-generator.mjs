import { createHash } from 'node:crypto'
import {
  USERJOURNEY_CONTRACT_HASH,
  USERJOURNEY_SEMANTIC_CONTRACT,
  normalizeUserJourneySource,
} from './userjourney-layout.mjs'
import { buildPhysicalUserJourney } from './userjourney-router.mjs'
import { validatePhysicalUserJourney } from './userjourney-validation.mjs'
import { parseDrawioXml, serializeDrawioXml } from './xml-model.mjs'

function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

function orderedScore(score) {
  const { tuple, canonicalTieKey, ...details } = score
  return { tuple, canonicalTieKey, ...details }
}

export function generateUserJourneyRouting(sourceXml) {
  if (sourceXml.includes('<!--')) throw new Error('User Journey source XML comment는 허용하지 않습니다.')
  const parsed = parseDrawioXml(sourceXml)
  const normalized = normalizeUserJourneySource(parsed)
  const normalizedSource = serializeDrawioXml(normalized.model)
  const routed = buildPhysicalUserJourney(normalized.model)
  const checked = validatePhysicalUserJourney(routed.model, routed)
  const generatedXml = serializeDrawioXml(routed.model)
  const segmentsById = new Map(checked.segments.map((segment) => [segment.id, segment]))
  const physicalEdges = routed.physicalEdges.map((edge) => {
    const segment = segmentsById.get(edge.id)
    return { ...edge, points: [segment.start, segment.end], length: segment.length }
  })
  return {
    normalizedSource,
    xml: generatedXml,
    manifest: {
      schemaVersion: USERJOURNEY_SEMANTIC_CONTRACT.schemaVersion,
      engineVersion: 'userjourney-v1',
      contractHash: USERJOURNEY_CONTRACT_HASH,
      sourceSha256: sha256(normalizedSource),
      generatedSha256: sha256(generatedXml),
      score: orderedScore(checked.score),
      semantic: {
        vertexCount: routed.semanticVertices.length,
        edgeCount: routed.semanticEdges.length,
        vertexIds: routed.semanticVertices,
        edges: routed.semanticEdges,
      },
      decorations: {
        count: routed.decorations.length,
        ids: routed.decorations,
      },
      routing: {
        junctionCount: routed.junctions.length,
        physicalEdgeCount: physicalEdges.length,
        junctions: routed.junctions,
        physicalEdges,
        semanticToPhysical: routed.semanticToPhysical,
        bundles: routed.bundles,
      },
      validation: checked.validation,
    },
  }
}
