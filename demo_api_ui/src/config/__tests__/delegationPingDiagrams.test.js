import { describe, it, expect } from 'vitest';
import { EXCHANGE_DIAGRAM, PROOF_DIAGRAM } from '../delegatedAccessProofDiagrams';
import { INVEST_DIAGRAM } from '../investDualAuthDiagram';
import * as dc from '../delegatedCommerceDiagram';
import * as chain from '../delegationChainValueDiagram';

const KINDS = ['rfc', 'spec', 'emerging'];
const PALETTE = ['#151a24', '#b5231a', '#5a5f69'];
const commerce = { GROUPS: dc.DELEGATED_COMMERCE_GROUPS, NODES: dc.DELEGATED_COMMERCE_NODES, EDGES: dc.DELEGATED_COMMERCE_EDGES, STEPS: dc.DELEGATED_COMMERCE_STEPS };
const chainCfg = { GROUPS: chain.DELEGATION_CHAIN_GROUPS, NODES: chain.DELEGATION_CHAIN_NODES, EDGES: chain.DELEGATION_CHAIN_EDGES, STEPS: chain.DELEGATION_CHAIN_STEPS };

describe.each([
  ['Delegated Access Proof: exchange', EXCHANGE_DIAGRAM],
  ['Delegated Access Proof: proof', PROOF_DIAGRAM],
  ['Invest Dual-Auth', INVEST_DIAGRAM],
  ['Delegated Commerce', commerce],
  ['Delegation Chain Value', chainCfg],
])('%s Ping-style config', (_n, { GROUPS, NODES, EDGES, STEPS }) => {
  it('edges reference nodes, nodes reference groups, ids are unique', () => {
    const ids = new Set(NODES.map((n) => n.id));
    expect(ids.size).toBe(NODES.length);
    EDGES.forEach(([s, t]) => { expect(ids.has(s)).toBe(true); expect(ids.has(t)).toBe(true); });
    NODES.forEach((n) => expect(GROUPS[n.group]).toBeDefined());
  });
  it('uses the Ping palette and puts no two boxes on one spot', () => {
    Object.values(GROUPS).forEach((g) => expect(PALETTE).toContain(g.bg));
    const spots = NODES.map((n) => `${n.x},${n.y}`);
    expect(new Set(spots).size).toBe(spots.length);
  });
  it('steps cover every edge exactly once', () => {
    expect(STEPS.flatMap((s) => s.edges).sort((a, b) => a - b)).toEqual(EDGES.map((_, i) => i));
  });
  it('every step has a request form, kinded unique standards, and either MOCK tokens or the reason there is none', () => {
    STEPS.forEach((s) => {
      const d = s.detail;
      expect(d.form.length, s.key).toBeGreaterThan(20);
      expect(d.refs.length, s.key).toBeGreaterThan(0);
      d.refs.forEach((r) => { expect(KINDS).toContain(r.kind); expect(r.id).toBeTruthy(); expect(r.title).toBeTruthy(); });
      expect(new Set(d.refs.map((r) => r.id)).size, s.key).toBe(d.refs.length);
      if (d.tokens.length) d.tokens.forEach((t) => { expect(t.note).toContain('·'); expect(Object.keys(t.claims).length).toBeGreaterThan(0); });
      else { expect(d.noToken, s.key).toBeTruthy(); expect(d.form, s.key).toContain(d.noToken); }
    });
  });
  it('no JWT literal and no emoji', () => {
    const text = JSON.stringify({ NODES, EDGES, STEPS });
    expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe('delegation facts', () => {
  it('the nested act chain runs specialist over generalist and keeps the user as sub', () => {
    const ex2 = chain.DELEGATION_CHAIN_STEPS.find((s) => s.key === 'exchange2').detail.tokens.at(-1).claims;
    expect(ex2.sub).toBe('user-1aee74ae');
    expect(ex2.act.act.sub).toBe('banking-agent-client');
  });
  it('the invest steps split into the exchanged-token path and the shared-key path', () => {
    const rs = INVEST_DIAGRAM.STEPS.filter((s) => s.key.startsWith('rs-'));
    const key = INVEST_DIAGRAM.STEPS.filter((s) => s.key.startsWith('key-'));
    expect(rs.length).toBe(3);
    expect(key.length).toBe(3);
    expect(rs.find((s) => s.key === 'rs-exchange').detail.tokens.at(-1).claims.aud).toEqual(['mcp-invest.ping.demo']);
    expect(key.find((s) => s.key === 'key-http').detail.form).toContain('X-API-Key');
  });
  it('revoking ends in a denied retry', () => {
    expect(dc.DELEGATED_COMMERCE_EDGES.at(-1)[2]).toMatch(/denied/);
  });
});
