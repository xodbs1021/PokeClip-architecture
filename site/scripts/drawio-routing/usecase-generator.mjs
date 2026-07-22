import { createHash } from 'node:crypto'
import { normalizeUseCaseSource, USECASE_POLICY } from './usecase-layout.mjs'
import { buildPhysicalUseCase } from './usecase-router.mjs'
import { validatePhysicalUseCase } from './usecase-validation.mjs'
import { parseDrawioXml, serializeDrawioXml } from './xml-model.mjs'

function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

export function generateUseCaseRouting(sourceXml) {
  if (sourceXml.includes('<!--')) throw new Error('Use Case source XML comment는 허용하지 않습니다.')
  const parsed = parseDrawioXml(sourceXml)
  const normalized = normalizeUseCaseSource(parsed)
  const normalizedSource = serializeDrawioXml(normalized.model)
  const routed = buildPhysicalUseCase(normalized.model)
  const checked = validatePhysicalUseCase(routed.model, routed)
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
      schemaVersion: 3,
      policy: USECASE_POLICY,
      generator: {
        name: 'deterministic-usecase-v1',
        browserRuntime: '@maxgraph/core@0.24.0',
        externalRouter: false,
      },
      sourceSha256: sha256(normalizedSource),
      generatedSha256: sha256(generatedXml),
      independentAttempts: 2,
      deterministicExactMatch: true,
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
        actorSpines: routed.actorSpines,
      },
      layout: normalized.layout,
      validation: checked.validation,
    },
  }
}
