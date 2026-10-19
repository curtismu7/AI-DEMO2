import { describe, it, expect } from 'vitest';
import { TOKEN_FLOW_DIAGRAMS, TOKEN_FLOW_ENDPOINTS, TOKEN_FLOW_GROUPS } from '../tokenFlowDiagram';
import { TOKEN_FLOW_DETAIL } from '../tokenFlowStandards';

// Step counts of the page's own scenario lists (ArchitectureTokenFlowPage.js): the diagram must stay one arrow per step.
const PAGE_STEP_COUNTS = { 'full-flow': 15, 'id-token': 5, 'user-token': 5, 'get-accounts': 6, withdrawal: 6, 'bad-scope': 5, 'api-key-path': 3, 'dual-token-path': 4, 'oauth-bearer-path': 3 };

describe('token flow ping-style diagrams', () => {
  it('one figure per scenario with the page\'s step count', () => {
    expect(Object.keys(TOKEN_FLOW_DIAGRAMS).sort()).toEqual(Object.keys(PAGE_STEP_COUNTS).sort());
    for (const [k, n] of Object.entries(PAGE_STEP_COUNTS)) {
      expect(TOKEN_FLOW_ENDPOINTS[k]).toHaveLength(n);
      expect(TOKEN_FLOW_DETAIL[k]).toHaveLength(n);
      expect(TOKEN_FLOW_DIAGRAMS[k].STEPS).toHaveLength(n);
    }
  });

  it('every edge joins known boxes of its own figure, and each step maps to its arrow', () => {
    for (const d of Object.values(TOKEN_FLOW_DIAGRAMS)) {
      const ids = new Set(d.NODES.map((n) => n.id));
      expect(ids.size).toBe(d.NODES.length);
      d.NODES.forEach((n) => expect(TOKEN_FLOW_GROUPS[n.group]).toBeTruthy());
      d.EDGES.forEach(([a, b]) => { expect(ids.has(a)).toBe(true); expect(ids.has(b)).toBe(true); });
      expect(d.STEPS.map((s) => s.edges)).toEqual(d.EDGES.map((_e, i) => [i]));
    }
  });

  it('uses the Ping palette', () => {
    expect(Object.values(TOKEN_FLOW_GROUPS).map((g) => g.bg).sort()).toEqual(['#151a24', '#5a5f69', '#b5231a']);
  });

  const steps = Object.values(TOKEN_FLOW_DIAGRAMS).flatMap((d) => d.STEPS);
  it('every step has a request form, a tokens list and kinded standards', () => {
    steps.forEach((s) => {
      expect(s.detail.form.length).toBeGreaterThan(10);
      expect(Array.isArray(s.detail.tokens)).toBe(true);
      expect(s.detail.refs.length).toBeGreaterThan(0);
      s.detail.refs.forEach((r) => {
        expect(['rfc', 'spec', 'emerging']).toContain(r.kind);
        expect(r.id).toBeTruthy();
        expect(r.title).toBeTruthy();
      });
      expect(new Set(s.detail.refs.map((r) => r.id)).size).toBe(s.detail.refs.length);
    });
  });

  it('an empty token list says why, and mock tokens carry claims', () => {
    steps.forEach((s) => {
      if (!s.detail.tokens.length) expect(s.detail.form).toContain('No token on this hop');
      s.detail.tokens.forEach((t) => { expect(t.note).toContain('·'); expect(t.claims.iss).toBeTruthy(); });
    });
  });

  it('no JWT literals or real-looking secrets in forms and tokens', () => {
    const text = steps.map((s) => `${s.detail.form}\n${JSON.stringify(s.detail.tokens)}`).join('\n');
    expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    expect(text).not.toMatch(/Bearer [A-Za-z0-9._-]{20,}/);
  });

  it('exchange steps show both input tokens and the issued one; the bad scope run is denied', () => {
    const ex = TOKEN_FLOW_DETAIL['full-flow'][6];
    expect(ex.form).toContain('urn:ietf:params:oauth:grant-type:token-exchange');
    expect(ex.tokens).toHaveLength(3);
    expect(ex.tokens[2].claims.act.sub).toBe('AI_AGENT_CLIENT_ID');
    expect(ex.refs.map((r) => r.id)).toContain('RFC 8693');
    expect(TOKEN_FLOW_DETAIL['bad-scope'][3].form).toContain('403 Forbidden');
    expect(TOKEN_FLOW_DETAIL.withdrawal[2].form).toContain('428');
  });
});
