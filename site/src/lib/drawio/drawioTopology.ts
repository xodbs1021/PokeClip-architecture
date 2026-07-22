export interface DrawioCellRecord {
  readonly id: string
  readonly kind: 'vertex' | 'edge' | 'other'
  readonly sourceId: string | null
  readonly targetId: string | null
  readonly pokeKind: 'semantic' | 'junction' | 'physical' | 'decoration' | null
  readonly relationKind: string | null
  readonly route: string | null
  readonly group: string | null
  readonly physicalRole: string | null
  readonly semanticRefs: readonly string[]
}

export interface DrawioAdjacency {
  readonly vertexIds: ReadonlySet<string>
  readonly edgeIds: ReadonlySet<string>
}

export interface DrawioTerminals {
  readonly sourceId: string
  readonly targetId: string
}

export interface DrawioTopology {
  adjacentTo(vertexId: string): DrawioAdjacency
  terminalsOf(edgeId: string): DrawioTerminals | null
  relationKindOf(edgeId: string): string | null
  physicalEdgeIdsOf(semanticEdgeId: string): ReadonlySet<string>
  readonly vertexIds: ReadonlySet<string>
  readonly edgeIds: ReadonlySet<string>
  readonly physicalEdgeIds: ReadonlySet<string>
  readonly junctionIds: ReadonlySet<string>
}

export function buildDrawioTopology(records: readonly DrawioCellRecord[]): DrawioTopology {
  const tagged = records.some(({ pokeKind }) => pokeKind !== null)
  const semanticVertices = records.filter(({ kind, pokeKind }) =>
    kind === 'vertex' && (!tagged || pokeKind === 'semantic'))
  const junctionIds = new Set(records.filter(({ pokeKind }) => pokeKind === 'junction').map(({ id }) => id))
  const semanticEdges = records.filter(
    (record): record is DrawioCellRecord & { sourceId: string; targetId: string } =>
      record.kind === 'edge' && record.sourceId !== null && record.targetId !== null
      && (!tagged || record.pokeKind === 'semantic'),
  )
  const physicalEdges = records.filter(
    (record): record is DrawioCellRecord & { sourceId: string; targetId: string } =>
      record.kind === 'edge' && record.sourceId !== null && record.targetId !== null
      && (!tagged || record.pokeKind === 'physical'),
  )
  const terminalsByEdgeId = new Map(semanticEdges.map(({ id, sourceId, targetId }) => [
    id,
    Object.freeze({ sourceId, targetId }),
  ]))
  const relationKindByEdgeId = new Map(semanticEdges.map(({ id, relationKind }) => [id, relationKind]))
  const physicalBySemantic = new Map<string, Set<string>>()
  for (const physical of physicalEdges) {
    const refs = tagged ? physical.semanticRefs : [physical.id]
    for (const semanticId of refs) {
      const ids = physicalBySemantic.get(semanticId) ?? new Set<string>()
      ids.add(physical.id)
      physicalBySemantic.set(semanticId, ids)
    }
  }

  return {
    vertexIds: new Set(semanticVertices.map(({ id }) => id)),
    edgeIds: new Set(semanticEdges.map(({ id }) => id)),
    physicalEdgeIds: new Set(physicalEdges.map(({ id }) => id)),
    junctionIds,
    terminalsOf(edgeId) {
      return terminalsByEdgeId.get(edgeId) ?? null
    },
    relationKindOf(edgeId) {
      return relationKindByEdgeId.get(edgeId) ?? null
    },
    physicalEdgeIdsOf(semanticEdgeId) {
      return physicalBySemantic.get(semanticEdgeId) ?? new Set<string>()
    },
    adjacentTo(vertexId) {
      const adjacentVertices = new Set<string>()
      const incidentEdges = new Set<string>()
      for (const edge of semanticEdges) {
        if (edge.sourceId === vertexId) {
          adjacentVertices.add(edge.targetId)
          incidentEdges.add(edge.id)
        } else if (edge.targetId === vertexId) {
          adjacentVertices.add(edge.sourceId)
          incidentEdges.add(edge.id)
        }
      }
      return { vertexIds: adjacentVertices, edgeIds: incidentEdges }
    },
  }
}
