import { describe, it, expect } from 'vitest';
import { analyzeRouting } from '../../test-utils/diagramRouting';
import {
  CONNECTOR_EDGES, CONNECTOR_FOOTNOTE, CONNECTOR_GROUPS, CONNECTOR_NODES, CONNECTOR_STEPS,
} from '../connectorFlowDiagram';

// The Ping palette shared by the pingStyle diagrams.
const PING = new Set(['#151a24', '#5a5f69', '#b5231a']);

describe('connector flow diagram config', () => {
  it('has the seven participants with unique ids and known groups', () => {
    const ids = CONNECTOR_NODES.map((n) => n.id);
    expect(ids).toHaveLength(7);
    expect(new Set(ids).size).toBe(7);
    CONNECTOR_NODES.forEach((n) => expect(CONNECTOR_GROUPS[n.group], n.id).toBeTruthy());
    Object.values(CONNECTOR_GROUPS).forEach((g) => expect(PING.has(g.bg), g.label).toBe(true));
  });

  it('every edge joins real nodes and no arrow is coloured', () => {
    const ids = new Set(CONNECTOR_NODES.map((n) => n.id));
    CONNECTOR_EDGES.forEach(([a, b, , o]) => {
      expect(ids.has(a)).toBe(true);
      expect(ids.has(b)).toBe(true);
      expect(o?.color).toBeUndefined();
    });
  });

  it('has 12 steps whose edge indexes cover every edge exactly once, in order', () => {
    expect(CONNECTOR_STEPS).toHaveLength(12);
    const covered = CONNECTOR_STEPS.flatMap((s) => s.edges);
    expect(covered).toEqual(CONNECTOR_EDGES.map((_, i) => i));
    CONNECTOR_STEPS.forEach((s) => {
      expect(s.title).toBeTruthy();
      expect(s.what).toBeTruthy();
      expect(s.evidence).toBeTruthy();
    });
  });

  it('edge labels carry the step number and leg letter matching their step', () => {
    CONNECTOR_STEPS.forEach((s, i) => s.edges.forEach((e) => {
      expect(CONNECTOR_EDGES[e][2]).toMatch(new RegExp(`^${i + 1}[a-d] `));
    }));
  });

  it('step 6 has 4 legs and step 8 has 3', () => {
    expect(CONNECTOR_STEPS[5].edges).toHaveLength(4);
    expect(CONNECTOR_STEPS[7].edges).toHaveLength(3);
  });

  it('keeps the decision-point footnote and the P1AZ wording', () => {
    expect(CONNECTOR_FOOTNOTE).toBe('P1AZ = policy decision point; MCP gateway = enforcement point.');
    expect(CONNECTOR_STEPS[9].title).toBe('Fine-grained P1AZ decision');
    expect(CONNECTOR_STEPS[9].what).toMatch(/never overrides policy/);
    expect(CONNECTOR_STEPS[10].what).toMatch(/Deny stops execution/);
  });

  it('routes every arrow around the boxes', () => {
    const r = analyzeRouting(CONNECTOR_NODES, CONNECTOR_EDGES);
    expect(r.fallbacks).toBe(0);
    expect(r.throughBox).toBe(0);
    // Ratchet: lower it, never raise it (many paired request/response legs).
    expect(r.crossings).toBeLessThanOrEqual(37);
  });
});
