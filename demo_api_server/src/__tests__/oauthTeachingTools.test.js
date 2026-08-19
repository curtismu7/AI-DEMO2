'use strict';
const plugin = require('../../config/verticals/oauth-teaching');

describe('oauth-teaching plugin — EXPLAIN tools', () => {
  it('marks teaching tools as local', () => {
    ['explain_concept', 'open_education_panel', 'show_flow_diagram', 'inspect_token']
      .forEach((n) => {
        expect(plugin.isLocalTool(n)).toBe(true);
      });
    expect(plugin.isLocalTool('create_transfer')).toBe(false);
  });

  it('explain_concept(token exchange) returns text + the token-exchange panel directive', async () => {
    const out = await plugin.executeTool('explain_concept', { topic: 'token exchange' }, {});
    expect(out.render).toBe('text');
    expect(out.result.text).toMatch(/RFC 8693/);
    expect(out.result.education).toEqual({ panel: 'token-exchange', tab: null });
  });

  it('explain_concept(delegation) opens the may-act panel (not token-exchange)', async () => {
    const out = await plugin.executeTool('explain_concept', { topic: 'delegation' }, {});
    expect(out.result.education.panel).toBe('may-act');
  });

  it('explain_concept(unknown) lists what it can explain, no panel', async () => {
    const out = await plugin.executeTool('explain_concept', { topic: 'zzz' }, {});
    expect(out.result.text).toMatch(/I can explain/i);
    expect(out.result.education).toBeUndefined();
  });

  it('open_education_panel returns the requested panel directive', async () => {
    const out = await plugin.executeTool('open_education_panel', { edu_id: 'may-act' }, {});
    expect(out.result.education).toEqual({ panel: 'may-act', tab: null });
  });

  it('exposes tools with inputSchema (not parameters)', () => {
    const tools = plugin.getTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['explain_concept', 'open_education_panel']));
    const ec = tools.find((t) => t.name === 'explain_concept');
    expect(ec.inputSchema).toBeDefined();
  });

  it('heuristics route explain phrasing to explain_concept', () => {
    const h = plugin.getHeuristics().find((x) => /explain/.test(String(x.re)) && x.action === 'explain_concept');
    expect(h).toBeTruthy();
    expect('explain token exchange').toMatch(h.re);
  });

  it('show_flow_diagram(auth code) opens the login-flow panel', async () => {
    const out = await plugin.executeTool('show_flow_diagram', { flow: 'auth code' }, {});
    expect(out.result.education).toEqual({ panel: 'login-flow', tab: null });
  });

  it('show_flow_diagram(unknown) falls back to flow-diagrams', async () => {
    const out = await plugin.executeTool('show_flow_diagram', { flow: 'mystery' }, {});
    expect(out.result.education.panel).toBe('flow-diagrams');
  });
});

describe('oauth-teaching plugin — inspect_token', () => {
  // A minimal unsigned JWT (header.payload.sig) — decodeToken only base64-decodes.
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = (payload) => `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}.sig`;

  it('returns a text reply (no token-pair) when not signed in', async () => {
    const out = await plugin.executeTool('inspect_token', {}, { userToken: null });
    expect(out.render).toBe('text');
    expect(out.result.text).toMatch(/sign\s*in/i);
  });

  it('decodes T1 and renders token_pair even if the exchange is unavailable', async () => {
    const t1 = jwt({ sub: 'u-123', aud: 'enduser.ping.demo', scope: 'read' });
    const out = await plugin.executeTool('inspect_token', {}, { userToken: t1, req: {}, tokenEvents: [] });
    expect(out.render).toBe('token_pair');
    expect(out.result.t1.payload.sub).toBe('u-123');
    // t2 may be null when no live exchange is reachable in unit context
    expect('t2' in out.result).toBe(true);
  });
});
