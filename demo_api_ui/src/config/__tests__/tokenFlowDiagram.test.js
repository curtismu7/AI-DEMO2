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

  it('stays grounded in the repo: real callback, scope-topology scopes, no invented specs or headers', () => {
    const all = Object.values(TOKEN_FLOW_DETAIL).flat();
    const text = all.map((d) => `${d.form}\n${JSON.stringify(d.tokens)}`).join('\n');
    expect(text).toContain('/api/auth/oauth/user/callback');
    expect(text).not.toMatch(/\/api\/auth\/callback/);
    expect(text).not.toMatch(/banking:(read|write)/);
    expect(text).not.toContain('WWW-Authenticate');
    expect(text).not.toContain('approval_required');
    expect(text).not.toContain('banking_api_resource_server');
    const titles = all.flatMap((d) => d.refs.map((r) => `${r.id} ${r.title}`)).join('\n');
    expect(titles).not.toMatch(/PingGateway route filters|PingOne Agent Gateway|CIBA|9470|AuthZEN|XACML|9396/);
  });

  it('attaches standards only to the hops they govern', () => {
    const ids = (d) => d.refs.map((r) => r.id);
    // withdrawal: the approval is an in-app session-cookie action, not CIBA or a step-up challenge; the 428 sits on gateway to agent
    TOKEN_FLOW_DETAIL.withdrawal.slice(2, 5).forEach((d) => expect(ids(d).join()).not.toMatch(/CIBA|9470/));
    expect(ids(TOKEN_FLOW_DETAIL.withdrawal[2])).toContain('RFC 6585');
    expect(TOKEN_FLOW_ENDPOINTS.withdrawal[2].slice(0, 2)).toEqual(['gateway', 'agent']);
    expect(TOKEN_FLOW_DETAIL.withdrawal[3].form).toContain('hitl_consent');
    expect(TOKEN_FLOW_DETAIL.withdrawal[4].form).toContain('/api/agent/consent/');
    // no RFC 8693 outside the steps that exchange, and Path A / Path C do not exchange
    TOKEN_FLOW_DETAIL['api-key-path'].forEach((d) => expect(ids(d)).not.toContain('RFC 8693'));
    [0, 2].forEach((i) => expect(ids(TOKEN_FLOW_DETAIL['oauth-bearer-path'][i])).not.toContain('RFC 8693')); // step 2 is the Authorize ask: RFC 8693 there is the act claim
    TOKEN_FLOW_ENDPOINTS['oauth-bearer-path'].forEach(([a, b]) => expect([a, b]).not.toContain('pingone'));
    // the decision call is PingOne Authorize's own endpoint
    TOKEN_FLOW_DETAIL['get-accounts'].forEach((d) => expect(ids(d)).not.toContain('RFC 9396'));
  });

  it('uses the repo\'s real wire shapes', () => {
    expect(TOKEN_FLOW_DETAIL['dual-token-path'][1].form).toContain('identity.show');
    expect(TOKEN_FLOW_DETAIL['dual-token-path'][2].form).toContain('credentialPath');
    expect(TOKEN_FLOW_DETAIL['full-flow'][0].form).toContain('threadId');
    expect(TOKEN_FLOW_DETAIL['full-flow'][4].form).toContain('"prompt"');
    expect(TOKEN_FLOW_DETAIL['bad-scope'][3].form).toContain('"access_denied"');
  });
});
