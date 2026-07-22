export interface LabelBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface SemanticLabelGeometry {
  readonly id: string
  readonly bounds: LabelBounds
  readonly labelBounds: LabelBounds | null
  readonly labelNodeMapped: boolean
}

export interface SemanticLabelEnvelopeSummary {
  readonly measured: number
  readonly unavailable: readonly string[]
  readonly outside: readonly string[]
  readonly nodeInside: number
  readonly nodeExpected: number
  readonly actorConvention: number
  readonly actorExpected: number
}

const EPSILON = 1
const UML_ACTOR_LABEL_BOTTOM_ENVELOPE_PX = 20

function contains(outer: LabelBounds, inner: LabelBounds) {
  return inner.x >= outer.x - EPSILON
    && inner.y >= outer.y - EPSILON
    && inner.x + inner.width <= outer.x + outer.width + EPSILON
    && inner.y + inner.height <= outer.y + outer.height + EPSILON
}

function followsUmlActorBottomConvention(actor: LabelBounds, label: LabelBounds) {
  const actorBottom = actor.y + actor.height
  return label.x >= actor.x - EPSILON
    && label.x + label.width <= actor.x + actor.width + EPSILON
    && label.y >= actorBottom - EPSILON
    && label.y + label.height <= actorBottom + UML_ACTOR_LABEL_BOTTOM_ENVELOPE_PX + EPSILON
}

export function inspectSemanticLabelEnvelopes(
  vertices: readonly SemanticLabelGeometry[],
  actorIds: ReadonlySet<string>,
): SemanticLabelEnvelopeSummary {
  const unavailable: string[] = []
  const outside: string[] = []
  let nodeInside = 0
  let nodeExpected = 0
  let actorConvention = 0
  let actorExpected = 0

  for (const vertex of vertices) {
    const isActor = actorIds.has(vertex.id)
    if (isActor) actorExpected += 1
    else nodeExpected += 1

    const label = vertex.labelBounds
    if (!vertex.labelNodeMapped || !label || label.width <= 0 || label.height <= 0) {
      unavailable.push(vertex.id)
      continue
    }

    const insideVisualEnvelope = isActor
      ? followsUmlActorBottomConvention(vertex.bounds, label)
      : contains(vertex.bounds, label)
    if (!insideVisualEnvelope) {
      outside.push(vertex.id)
      continue
    }
    if (isActor) actorConvention += 1
    else nodeInside += 1
  }

  return {
    measured: vertices.length - unavailable.length,
    unavailable,
    outside,
    nodeInside,
    nodeExpected,
    actorConvention,
    actorExpected,
  }
}
