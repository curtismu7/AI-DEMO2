import { describe, test, expect } from 'vitest';
import { buildSequenceFlow } from '../SequenceFlowDiagram';

// The Playground's canned CIBA-PF default diagram (3 participants) shipped clipped:
// the third participant box ran past the canvas edge. The drawing's bounds must
// cover every node's full extent (position + size), or fitView computes a zoom
// that still overflows.
describe('buildSequenceFlow bounds', () => {
  const CIBA_PF = `sequenceDiagram
    autonumber
    participant CA0 as Client App
    participant P1 as Pingfederate
    participant HA2 as Person
    CA0->>P1: POST /api/pf-ai-agent/ciba/start
    HA2->>CA0: POST /api/pf-ai-agent/ciba/mock-decision
    CA0->>P1: GET /api/pf-ai-agent/ciba/status`;

  test('bounds.w covers the right edge of every node, including the last participant', () => {
    const { nodes, bounds } = buildSequenceFlow(CIBA_PF);
    const rightEdges = nodes
      .filter((n) => n.type === 'part' || n.type === 'lifeline')
      .map((n) => n.position.x + (n.data?.w ?? n.data?.h ?? 0));
    const maxRight = Math.max(...rightEdges);
    expect({ maxRight, boundsW: bounds.w, covered: bounds.w >= maxRight })
      .toEqual({ maxRight, boundsW: bounds.w, covered: true });
  });

  test('every participant box sits fully inside the declared bounds', () => {
    const { nodes, bounds } = buildSequenceFlow(CIBA_PF);
    for (const n of nodes.filter((x) => x.type === 'part')) {
      expect({ id: n.id, left: n.position.x, right: n.position.x + (n.data?.w ?? 0) }).toEqual(
        expect.objectContaining({ left: expect.any(Number) }),
      );
      expect(n.position.x).toBeGreaterThanOrEqual(0);
      expect(n.position.x + (n.data?.w ?? 0)).toBeLessThanOrEqual(bounds.w);
    }
  });
});
