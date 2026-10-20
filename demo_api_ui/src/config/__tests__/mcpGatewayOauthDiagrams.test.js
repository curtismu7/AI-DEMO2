import { describe, it, expect } from 'vitest';
import { MGOF_ARCH_DIAGRAM, MGOF_SEQ_DIAGRAM } from '../mcpGatewayOauthDiagrams';

const KINDS = ['rfc', 'spec', 'emerging'];

describe.each([['architecture', MGOF_ARCH_DIAGRAM, 13], ['sequence', MGOF_SEQ_DIAGRAM, 26]])('MCP gateway OAuth %s diagram', (_n, { GROUPS, NODES, EDGES, STEPS }, count) => {
  it('edges reference nodes and nodes reference groups', () => {
    const ids = new Set(NODES.map((n) => n.id));
    expect(ids.size).toBe(NODES.length);
    EDGES.forEach(([s, t]) => { expect(ids.has(s)).toBe(true); expect(ids.has(t)).toBe(true); });
    NODES.forEach((n) => expect(GROUPS[n.group]).toBeDefined());
  });
  it('keeps the page\'s arrow count (arrow n is step n)', () => {
    expect(EDGES.length).toBe(count);
  });
  it('steps cover every edge exactly once', () => {
    expect(STEPS.flatMap((s) => s.edges).sort((a, b) => a - b)).toEqual(EDGES.map((_, i) => i));
    expect(new Set(STEPS.map((s) => s.key)).size).toBe(STEPS.length);
  });
  it('every step has the request form, the token (or the reason there is none) and standards', () => {
    STEPS.forEach((s) => {
      expect(s.detail.form, s.key).toBeTruthy();
      expect(Array.isArray(s.detail.tokens), s.key).toBe(true);
      if (!s.detail.tokens.length) expect(s.detail.form, s.key).toMatch(/No token is involved|no token/i);
      expect(s.detail.refs.length, s.key).toBeGreaterThan(0);
      s.detail.refs.forEach((r) => { expect(KINDS).toContain(r.kind); expect(r.id).toBeTruthy(); expect(r.title).toBeTruthy(); });
      const ids = s.detail.refs.map((r) => r.id);
      expect(new Set(ids).size, s.key).toBe(ids.length);
    });
  });
  it('mock tokens carry a note and claims; no JWT literal, secret or emoji anywhere', () => {
    STEPS.flatMap((s) => s.detail.tokens).forEach((t) => {
      expect(t.note).toContain('·');
      expect(Object.keys(t.claims).length).toBeGreaterThan(0);
    });
    const text = JSON.stringify({ NODES, EDGES, STEPS });
    expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe('MCP gateway OAuth standards: facts checked against demo_mcp_gateway', () => {
  const text = JSON.stringify(MGOF_SEQ_DIAGRAM.STEPS);
  const steps = MGOF_SEQ_DIAGRAM.STEPS;
  const refIds = (i) => steps[i].detail.refs.map((r) => r.id);
  it('uses resource= (PingOne ignores audience=) and sends an actor token on the exchange', () => {
    expect(text).toContain('resource=<MCP server resource URI>');
    expect(text).not.toMatch(/[&\\n]audience=/);
    expect(text).toContain('actor_token=<actor token>');
  });
  it('the client talks to the gateway broker, which relays to PingOne (own AS, DCR, S256), and no hop claims CIMD', () => {
    expect(text).toContain('/oauth/register');
    expect(text).toMatch(/code_challenge_methods_supported[^\]]*S256/);
    expect(text).not.toMatch(/client_id_metadata_document_supported/);
    expect(MGOF_SEQ_DIAGRAM.EDGES[5].slice(0, 2)).toEqual(['A', 'B']);
    expect(MGOF_SEQ_DIAGRAM.EDGES[6].slice(0, 2)).toEqual(['B', 'P']);
    expect(MGOF_SEQ_DIAGRAM.EDGES[8].slice(0, 2)).toEqual(['B', 'A']);
    MGOF_ARCH_DIAGRAM.STEPS.concat(steps).forEach((s) => s.detail.refs.forEach((r) => expect(r.id).not.toMatch(/client-id-metadata/)));
  });
  it('the PingOne Authorize call posts to the PAP decision path the gateway uses, not decisionEndpoints or AuthZEN', () => {
    expect(steps[14].detail.form).toContain('/governance/pap/alpha/policy/<worker id>/decision');
    expect(text).not.toContain('decisionEndpoints');
    expect(text).not.toContain('AuthZEN"');
  });
  it('introspection is plain RFC 7662 JSON: no JWT-response RFC, no RFC 9068 profile on the mock tokens', () => {
    expect(refIds(13)).toEqual(['RFC 7662']);
    expect(text).not.toContain('RFC 9701');
    expect(text).not.toContain('RFC 9068');
    expect(text).not.toContain('at+jwt');
  });
  it('the local pre-filter step says signature checking depends on PINGONE_JWKS_ENDPOINT', () => {
    expect(steps[11].detail.form).toContain('PINGONE_JWKS_ENDPOINT');
    expect(steps[11].detail.form).not.toContain('it does not verify the signature here');
  });
  it('the exchange step shows both input tokens', () => {
    const ex = steps[15].detail.tokens.map((t) => t.note);
    expect(ex.some((n) => n.startsWith('Access token'))).toBe(true);
    expect(ex.some((n) => n.startsWith('Actor token'))).toBe(true);
  });
});
