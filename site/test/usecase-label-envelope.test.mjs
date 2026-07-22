import assert from 'node:assert/strict'
import test from 'node:test'
import { inspectSemanticLabelEnvelopes } from '../src/lib/drawio/semanticLabelEnvelope.ts'

const ACTOR_IDS = new Set(['ac-streamer', 'ac-editor', 'ac-ops'])

function vertex(id, bounds, labelBounds, labelNodeMapped = true) {
  return { id, bounds, labelBounds, labelNodeMapped }
}

test('UML actor labels use the 20px bottom visual envelope while ordinary labels stay inside their nodes', () => {
  const vertices = [
    vertex('ac-streamer', { x: 96, y: 352, width: 66, height: 120 }, { x: 108.5, y: 474.07, width: 41, height: 13.43 }),
    vertex('ac-editor', { x: 2538, y: 600, width: 66, height: 120 }, { x: 2555.5, y: 722.07, width: 31, height: 13.43 }),
    vertex('ac-ops', { x: 96, y: 1198, width: 66, height: 120 }, { x: 113.5, y: 1320.07, width: 31, height: 13.43 }),
    vertex('uc-login', { x: 402, y: 722, width: 235, height: 82 }, { x: 430, y: 752, width: 179, height: 16 }),
  ]

  assert.deepEqual(inspectSemanticLabelEnvelopes(vertices, ACTOR_IDS), {
    measured: 4,
    unavailable: [],
    outside: [],
    nodeInside: 1,
    nodeExpected: 1,
    actorConvention: 3,
    actorExpected: 3,
  })
})

test('actor and ordinary-node envelope violations remain fail-closed', () => {
  const vertices = [
    vertex('ac-streamer', { x: 96, y: 352, width: 66, height: 120 }, { x: 94, y: 474, width: 41, height: 13 }),
    vertex('ac-editor', { x: 2538, y: 600, width: 66, height: 120 }, { x: 2555, y: 740, width: 31, height: 3 }),
    vertex('uc-login', { x: 402, y: 722, width: 235, height: 82 }, { x: 430, y: 800, width: 179, height: 16 }),
    vertex('uc-invite', { x: 683, y: 722, width: 235, height: 82 }, null, false),
  ]

  assert.deepEqual(inspectSemanticLabelEnvelopes(vertices, ACTOR_IDS), {
    measured: 3,
    unavailable: ['uc-invite'],
    outside: ['ac-streamer', 'ac-editor', 'uc-login'],
    nodeInside: 0,
    nodeExpected: 2,
    actorConvention: 0,
    actorExpected: 2,
  })
})
