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
  it('every step cites at least one emerging item', () => {
    STEPS.forEach((s) => expect(s.detail.refs.some((r) => r.kind === 'emerging'), s.key).toBe(true));
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

describe('privilege MCP diagrams: lanes stay on the canvas', () => {
  it('left lanes beside the leftmost column are 60 or less (fitView leaves 56px on the left)', () => {
    [PMD_ARCH_DIAGRAM, PMD_SEQ_DIAGRAM, PMD_FLOW_DIAGRAM].forEach(({ NODES, EDGES }) => {
      const x = Object.fromEntries(NODES.map((n) => [n.id, n.x]));
      const minX = Math.min(...NODES.map((n) => n.x));
      EDGES.forEach(([s, t, , o = {}]) => {
        if (o.lane > 0 && (x[s] === minX || x[t] === minX)) expect(o.lane, `${s}->${t}`).toBeLessThanOrEqual(60);
      });
    });
  });
});

describe('privilege MCP standards: facts checked against the BFF code', () => {
  const all = JSON.stringify([PMD_ARCH_DIAGRAM, PMD_SEQ_DIAGRAM, PMD_FLOW_DIAGRAM].map((d) => d.STEPS));
  it('does not claim the gateway endpoints are PingOne, drops invented enrollment claims and AuthZEN', () => {
    expect(all).not.toContain('AuthZEN');
    expect(all).not.toContain('grpc.privilege.pingone.com\",');
    expect(all).not.toContain('gateway:<gateway id>');
    expect(all).not.toMatch(/token_uri="https:\/\/auth\.pingone/);
    expect(all).toContain('/register');
  });
  it('mock tokens carry the audience and scopes the BFF requests', () => {
    const claims = [PMD_ARCH_DIAGRAM, PMD_SEQ_DIAGRAM, PMD_FLOW_DIAGRAM].flatMap((d) => d.STEPS).flatMap((st) => st.detail.tokens || []).map((t) => t.claims);
    expect(claims.length).toBeGreaterThan(0);
    claims.forEach((c) => expect(c.aud).toBe('mcpserver.ping.demo'));
    expect(all).toContain('read write mcp:invoke');
    expect(all).toContain('openid profile email offline_access');
  });
});
