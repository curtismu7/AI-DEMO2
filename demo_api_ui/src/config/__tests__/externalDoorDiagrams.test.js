import { describe, it, expect } from 'vitest';
import { EXT_DOOR_TOPO_DIAGRAM, EXT_DOOR_SEQ_DIAGRAM } from '../externalDoorDiagrams';
import { TOPO_DETAIL, SEQ_DETAIL } from '../externalDoorStandards';

const KINDS = ['rfc', 'spec', 'emerging'];

describe.each([['topology', EXT_DOOR_TOPO_DIAGRAM], ['dual-path sequence', EXT_DOOR_SEQ_DIAGRAM]])('external door %s diagram', (_n, { GROUPS, NODES, EDGES, STEPS }) => {
  it('edges reference nodes, nodes reference groups, ids are unique', () => {
    const ids = new Set(NODES.map((n) => n.id));
    expect(ids.size).toBe(NODES.length);
    EDGES.forEach(([s, t]) => { expect(ids.has(s)).toBe(true); expect(ids.has(t)).toBe(true); });
    NODES.forEach((n) => expect(GROUPS[n.group]).toBeDefined());
  });
  it('uses the Ping palette', () => {
    Object.values(GROUPS).forEach((g) => expect(['#151a24', '#b5231a', '#5a5f69']).toContain(g.bg));
  });
  it('steps cover every edge exactly once', () => {
    expect(STEPS.flatMap((s) => s.edges).sort((a, b) => a - b)).toEqual(EDGES.map((_, i) => i));
  });
  it('every step has a request form and kinded, unique standards', () => {
    STEPS.forEach((s) => {
      expect(s.detail.form.length, s.key).toBeGreaterThan(20);
      expect(s.detail.refs.length, s.key).toBeGreaterThan(0);
      s.detail.refs.forEach((r) => { expect(KINDS).toContain(r.kind); expect(r.id).toBeTruthy(); expect(r.title).toBeTruthy(); });
      const ids = s.detail.refs.map((r) => r.id);
      expect(new Set(ids).size, s.key).toBe(ids.length);
    });
  });
  it('every step either shows MOCK tokens or says why there is none', () => {
    STEPS.forEach((s) => {
      const d = s.detail;
      if (d.tokens.length) d.tokens.forEach((t) => { expect(t.note).toContain('·'); expect(Object.keys(t.claims).length).toBeGreaterThan(0); });
      else { expect(d.noToken, s.key).toBeTruthy(); expect(d.form, s.key).toContain(d.noToken); }
    });
  });
  it('no JWT literal, no emoji', () => {
    const text = JSON.stringify({ NODES, EDGES, STEPS });
    expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe('external door facts match the code', () => {
  const text = JSON.stringify([TOPO_DETAIL, SEQ_DETAIL]);
  it('uses the real claim names, endpoints and audiences', () => {
    ['mcpserver.ping.demo', 'enduser.ping.demo', 'mcp:invoke', 'agent-federated-passthrough', 'agent-passthrough', 'relayState', '/authorize/callback', '/introspect', 'McpToolCall'].forEach((w) => expect(text).toContain(w));
  });
  it('the client_credentials token has no user: sub is the client id', () => {
    const cc = SEQ_DETAIL.ccJwt.tokens[0].claims;
    expect(cc.sub).toBe(cc.client_id);
  });
  it('the exchange-skipping hops cite RFC 8693 and name the skipped step', () => {
    [SEQ_DETAIL.resolveFederated, SEQ_DETAIL.resolvePassthrough, TOPO_DETAIL.bankingApi].forEach((d) => expect(d.refs.map((r) => r.id)).toContain('RFC 8693'));
  });
});
