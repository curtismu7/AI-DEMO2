import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildSequenceFlow } from '../SequenceFlowDiagram';
import { buildSequenceSource } from '../../services/protocolMermaid';

// "Check all default diagram state for all protocols" — for every flow in
// protocolFlows.json, the default (nothing executed yet) diagram's declared
// bounds must cover every participant box and lifeline, so fitView's zoom
// actually fits the drawing. The CIBA-PF default shipped clipped until the
// source-swap refit landed; these checks keep every other flow honest.
describe('every protocol default diagram fits its declared bounds', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const flows = JSON.parse(readFileSync(join(here, '..', '..', 'data', 'protocolFlows.json'), 'utf8'));

  for (const [id, spec] of Object.entries(flows)) {
    test(`${id}: nodes inside bounds.w`, () => {
      const source = buildSequenceSource(spec, [], null);
      if (!source) return; // flow with no steps — nothing drawn
      const { nodes, bounds } = buildSequenceFlow(source);
      expect(bounds.w).toBeGreaterThan(0);
      expect(bounds.h).toBeGreaterThan(0);
      for (const n of nodes) {
        const w = n.data?.w ?? (n.type === 'anchor' ? 6 : 2);
        expect({ id: n.id, right: n.position.x + w }).toEqual(
          expect.objectContaining({ right: expect.any(Number) }),
        );
        expect(n.position.x).toBeGreaterThanOrEqual(-120);
        expect(n.position.x + w).toBeLessThanOrEqual(bounds.w + 120);
      }
    });
  }
});
