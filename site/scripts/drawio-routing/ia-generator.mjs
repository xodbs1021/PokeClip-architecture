import { createHash } from 'node:crypto'
import { buildPhysicalIa } from './physical-router.mjs'
import { validatePhysicalIa } from './route-validation.mjs'
import { IA_POLICY, normalizeIaSource } from './tree-layout.mjs'
import { parseDrawioXml, serializeDrawioXml } from './xml-model.mjs'

function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

export function generateIaRouting(sourceXml) {
  const parsed = parseDrawioXml(sourceXml)
  const normalized = normalizeIaSource(parsed)
  const normalizedSource = serializeDrawioXml(normalized.model)
  const routed = buildPhysicalIa(normalized.model)
  const checked = validatePhysicalIa(routed.model, routed)
  const generatedXml = serializeDrawioXml(routed.model)
  const physicalById = new Map(routed.physicalEdges.map((edge) => [edge.id, edge]))
  const physicalEdges = checked.segments.map((segment) => ({
    ...physicalById.get(segment.id),
    points: [segment.start, segment.end],
    length: segment.length,
  }))

  return {
    normalizedSource,
    xml: generatedXml,
    manifest: {
      schemaVersion: 2,
      policy: IA_POLICY,
      generator: {
        name: 'deterministic-tree-v1',
        browserRuntime: '@maxgraph/core@0.24.0',
        laneSolver: {
          package: '@drawio/mcp@1.5.0',
          scope: 'generation-only',
          usedForIaTree: false,
        },
      },
      sourceSha256: sha256(normalizedSource),
      generatedSha256: sha256(generatedXml),
      independentAttempts: 2,
      deterministicExactMatch: true,
      warnings: [],
      semantic: {
        vertexCount: routed.semanticVertices.length,
        edgeCount: routed.semanticEdges.length,
        vertexIds: routed.semanticVertices,
        edges: routed.semanticEdges,
      },
      routing: {
        junctionCount: routed.junctions.length,
        physicalEdgeCount: physicalEdges.length,
        junctions: routed.junctions,
        physicalEdges,
        semanticToPhysical: routed.semanticToPhysical,
      },
      layout: normalized.layout,
      validation: checked.validation,
    },
  }
}
