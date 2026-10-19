import { describe, it, expect } from 'vitest';
import { PMD_ARCH_DIAGRAM, PMD_SEQ_DIAGRAM, PMD_FLOW_DIAGRAM } from '../privilegeMcpDiagrams';

const KINDS = ['rfc', 'spec', 'emerging'];

describe.each([['architecture', PMD_ARCH_DIAGRAM], ['sign-in + tool call', PMD_SEQ_DIAGRAM], ['auth flow', PMD_FLOW_DIAGRAM]])('privilege MCP %s diagram', (_n, { GROUPS, NODES, EDGES, STEPS }) => {
  it('edges reference nodes and nodes reference groups', () => {
    const ids = new Set(NODES.map((n) => n.id));
    expect(ids.size).toBe(NODES.length);
    EDGES.forEach(([s, t]) => { expect(ids.has(s)).toBe(true); expect(ids.has(t)).toBe(true); });
    NODES.forEach((n) => expect(GROUPS[n.group]).toBeDefined());
  });
  it('steps cover every edge exactly once', () => {
    expect(STEPS.flatMap((s) => s.edges).sort((a, b) => a - b)).toEqual(EDGES.map((_, i) => i));
  });
  it('every step has the request form and standards (RFC/spec/emerging kinds, unique ids)', () => {
    STEPS.forEach((s) => {
      expect(s.detail.form, s.key).toBeTruthy();
      expect(s.detail.refs.length, s.key).toBeGreaterThan(0);
      s.detail.refs.forEach((r) => expect(KINDS).toContain(r.kind));
      const ids = s.detail.refs.map((r) => r.id);
      expect(new Set(ids).size, s.key).toBe(ids.length);
    });
  });
  it('mock tokens carry a note and claims, and no real secret shape', () => {
    STEPS.flatMap((s) => s.detail.tokens || []).forEach((t) => {
      expect(t.note).toContain('·');
      expect(Object.keys(t.claims).length).toBeGreaterThan(0);
    });
    expect(JSON.stringify(STEPS)).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
  });
  it('uses no emoji in the visible strings', () => {
    expect(JSON.stringify({ NODES, EDGES, STEPS })).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe('privilege MCP diagrams: arrows that share a pair of cards get their own path', () => {
  it('no two arrows between the same two nodes use the same geometry', () => {
    [PMD_ARCH_DIAGRAM, PMD_SEQ_DIAGRAM, PMD_FLOW_DIAGRAM].forEach(({ EDGES }) => {
      const seen = new Set();
      EDGES.forEach(([s, t, , o = {}]) => {
        // A->B and B->A drawn the default way trace the same line, so the pair is the key, not the direction.
        const key = `${[s, t].sort().join('|')}:${o.vertical ? 'v' : o.lane ? `l${o.lane}` : 'd'}`;
        expect(seen.has(key), key).toBe(false);
        seen.add(key);
      });
    });
  });
  it('the sequence tab keeps the participant names the page has always shown', () => {
    const labels = PMD_SEQ_DIAGRAM.NODES.map((n) => n.label);
    expect(labels).toContain('Operator');
    expect(labels).toContain('mcp-server — MCP SERVER');
  });
});
