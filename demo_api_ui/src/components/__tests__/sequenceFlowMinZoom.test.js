import { describe, test, expect } from 'vitest';
import { buildSequenceFlow, flowWidth } from '../SequenceFlowDiagram';

// The 6-participant "CIBA + token exchange" sequence in the ~640px CIBA drawer fit-to-width
// at zoom ~0.43, so its 13px message labels drew at ~5.6px. The flow area must be wide
// enough that React Flow's fitView (padding 0.04) keeps labels at >= 11px; the canvas
// scrolls sideways instead.
const SIX = `sequenceDiagram
  participant Agent
  participant BFF
  participant P1 as PingOne
  participant User as User<br/>(email / text link)
  participant MCP as MCP server
  participant API as Banking API
  Agent->>BFF: 1. create_transfer $500
  BFF->>P1: 3. POST /as/bc-authorize<br/>login_hint, binding_message
  MCP->>API: 10. transfer`;
const LABEL_PX = 13; // --font-size-sm

const fitZoom = (width, nodes) => {
  const parts = nodes.filter((n) => n.type === 'part');
  const left = Math.min(...parts.map((n) => n.position.x));
  const right = Math.max(...parts.map((n) => n.position.x + n.data.w));
  return width / ((right - left) * 1.04);
};

describe('sequence diagram minimum readable zoom', () => {
  test('6 participants in a 600px drawer canvas keep message text >= 11px', () => {
    const { nodes, bounds } = buildSequenceFlow(SIX);
    const w = flowWidth(600, bounds);
    expect(LABEL_PX * fitZoom(w, nodes)).toBeGreaterThanOrEqual(11);
  });

  test('a canvas already wide enough is left at its own width (no sideways scroll)', () => {
    const { bounds } = buildSequenceFlow(SIX);
    expect(flowWidth(1600, bounds)).toBe(1600);
  });
});
