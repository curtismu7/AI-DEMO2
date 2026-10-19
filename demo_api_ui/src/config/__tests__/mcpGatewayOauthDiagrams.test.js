import { describe, it, expect } from 'vitest';
import { MGOF_ARCH_DIAGRAM, MGOF_SEQ_DIAGRAM } from '../mcpGatewayOauthDiagrams';

const KINDS = ['rfc', 'spec', 'emerging'];

describe.each([['architecture', MGOF_ARCH_DIAGRAM, 11], ['sequence', MGOF_SEQ_DIAGRAM, 24]])('MCP gateway OAuth %s diagram', (_n, { GROUPS, NODES, EDGES, STEPS }, count) => {
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
  it('uses resource= (PingOne ignores audience=) and sends an actor token on the exchange', () => {
    expect(text).toContain('resource=<MCP server resource URI>');
    expect(text).not.toMatch(/[&\\n]audience=/);
    expect(text).toContain('actor_token=<actor token>');
  });
  it('names the gateway broker (own authorization server, DCR, S256) and does not claim CIMD support', () => {
    expect(text).toContain('/oauth/register');
    expect(text).toMatch(/code_challenge_methods_supported[^\]]*S256/);
    expect(text).not.toMatch(/client_id_metadata_document_supported/);
  });
  it('the PingOne Authorize call is the Decision Endpoints API, not AuthZEN', () => {
    expect(text).toContain('decisionEndpoints');
    expect(text).not.toContain('AuthZEN"');
  });
  it('the exchange step shows both input tokens', () => {
    const ex = MGOF_SEQ_DIAGRAM.STEPS[13].detail.tokens.map((t) => t.note);
    expect(ex.some((n) => n.startsWith('Access token'))).toBe(true);
    expect(ex.some((n) => n.startsWith('Actor token'))).toBe(true);
  });
});
