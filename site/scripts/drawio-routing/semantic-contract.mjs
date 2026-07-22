import { readFileSync } from 'node:fs'

const contractUrl = new URL('../../shared/ia-semantic-contract.json', import.meta.url)
export const IA_SEMANTIC_CONTRACT = Object.freeze(JSON.parse(readFileSync(contractUrl, 'utf8')))

export function semanticEdgeTuple(edge) {
  return `${edge.id}|${edge.sourceId}|${edge.targetId}`
}

function setDifference(left, right) {
  return [...left].filter((value) => !right.has(value)).sort()
}

export function inspectIaSemanticContract(vertexIds, edges) {
  const actualVertices = new Set(vertexIds)
  const expectedVertices = new Set(IA_SEMANTIC_CONTRACT.vertexIds)
  const actualEdges = new Set(edges.map(semanticEdgeTuple))
  const expectedEdges = new Set(IA_SEMANTIC_CONTRACT.edgeTuples)
  const duplicateVertices = vertexIds.length - actualVertices.size
  const duplicateEdges = edges.length - actualEdges.size
  const missingVertices = setDifference(expectedVertices, actualVertices)
  const unexpectedVertices = setDifference(actualVertices, expectedVertices)
  const missingEdges = setDifference(expectedEdges, actualEdges)
  const unexpectedEdges = setDifference(actualEdges, expectedEdges)
  return {
    pass: duplicateVertices === 0 && duplicateEdges === 0
      && missingVertices.length === 0 && unexpectedVertices.length === 0
      && missingEdges.length === 0 && unexpectedEdges.length === 0,
    duplicateVertices,
    duplicateEdges,
    missingVertices,
    unexpectedVertices,
    missingEdges,
    unexpectedEdges,
  }
}

export function assertIaSemanticContract(vertexIds, edges) {
  const result = inspectIaSemanticContract(vertexIds, edges)
  if (result.pass) return
  throw new Error(
    `IA semantic contract 불일치: duplicate vertex ${result.duplicateVertices} · edge ${result.duplicateEdges}`
    + ` · missing vertex [${result.missingVertices.join(',')}] · unexpected vertex [${result.unexpectedVertices.join(',')}]`
    + ` · missing edge [${result.missingEdges.join(',')}] · unexpected edge [${result.unexpectedEdges.join(',')}]`,
  )
}
