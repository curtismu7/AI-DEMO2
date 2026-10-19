import { describe, it, expect } from 'vitest';
import { DELEGATION_DIAGRAM, DISCOVERY_DIAGRAM } from '../a2aArchitectureDiagram';
import { DELEGATION_DETAIL, DISCOVERY_DETAIL } from '../a2aArchitectureStandards';

const cases = [
  ['delegation', DELEGATION_DIAGRAM, DELEGATION_DETAIL],
  ['discovery', DISCOVERY_DIAGRAM, DISCOVERY_DETAIL],
];

describe.each(cases)('a2a architecture %s figure', (_n, { GROUPS, NODES, EDGES, STEPS }, DETAIL) => {
  const text = Object.values(DETAIL).map((d) => `${d.form}\n${JSON.stringify(d.tokens)}`).join('\n');

  it('edges reference nodes, nodes reference groups, ids are unique', () => {
    const ids = new Set(NODES.map((n) => n.id));
    expect(ids.size).toBe(NODES.length);
    EDGES.forEach(([s, t]) => { expect(ids.has(s)).toBe(true); expect(ids.has(t)).toBe(true); });
    NODES.forEach((n) => expect(GROUPS[n.group]).toBeDefined());
  });
  it('one step per arrow, each with its detail', () => {
    expect(STEPS.map((s) => s.edges)).toEqual(EDGES.map((_e, i) => [i]));
    STEPS.forEach((s, i) => expect(s.detail).toBe(DETAIL[i]));
  });
  it('every step has a form, a token list and kinded standards with ids and titles', () => {
    STEPS.forEach((s) => {
      expect(s.detail.form.length).toBeGreaterThan(10);
      expect(Array.isArray(s.detail.tokens)).toBe(true);
      if (!s.detail.tokens.length) expect(s.detail.form).toMatch(/No token|no Authorization header|No access token/);
      expect(s.detail.refs.length).toBeGreaterThan(1);
      const seen = new Set();
      s.detail.refs.forEach((r) => {
        expect(['rfc', 'spec', 'emerging']).toContain(r.kind);
        expect(r.id && r.title).toBeTruthy();
        expect(seen.has(r.id)).toBe(false);
        seen.add(r.id);
      });
    });
  });
  it('mock tokens are labelled and carry claims; no JWT literals in any form', () => {
    STEPS.flatMap((s) => s.detail.tokens).forEach((t) => { expect(t.note).toContain('·'); expect(t.claims.iss).toBeTruthy(); });
    expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
  });
});

describe('a2a architecture content matches the repo wire', () => {
  it('both exchanges show subject, actor and the result token', () => {
    [1, 3].forEach((i) => {
      expect(DELEGATION_DETAIL[i].tokens).toHaveLength(3);
      expect(DELEGATION_DETAIL[i].form).toContain('actor_token=');
      expect(DELEGATION_DETAIL[i].form).toContain('subject_token=');
    });
  });
  it('Exchange #2 nests act inside act; the hop token is exactly one deep', () => {
    expect(DELEGATION_DETAIL[3].tokens[2].claims.act.act.sub).toBe('banking-agent-client');
    expect(DELEGATION_DETAIL[2].tokens[0].claims.act.sub).toBe('banking-agent-client');
    expect(DELEGATION_DETAIL[2].tokens[0].claims.act.act).toBeUndefined();
  });
  it('uses the real gate scope, decision parameters and data-only replies', () => {
    expect(DELEGATION_DETAIL[2].form).toContain('A2A-Version: 1.0');
    expect(DELEGATION_DETAIL[4].form).toContain('ActChainDepth');
    expect(DELEGATION_DETAIL[4].form).toContain('NestedActClientId');
    expect(DELEGATION_DETAIL[7].form).toContain('No access token crosses back');
    expect(DELEGATION_DETAIL[8].form).toContain('No token is returned');
  });
  it('uses the 1.0 wire: SendMessage method, result.message wrapper, signature objects, post-style client auth', () => {
    expect(DELEGATION_DETAIL[2].form).toContain('"method": "SendMessage"');
    expect(DELEGATION_DETAIL[2].form).not.toContain('message/send');
    expect(DELEGATION_DETAIL[7].form).toContain('"message": {');
    expect(DISCOVERY_DETAIL[1].form).toContain('"protected"');
    expect(DELEGATION_DETAIL[1].form).toContain('audience=a2a-intermediate-<appKey>.ping.demo');
    expect(DELEGATION_DETAIL[3].form).toContain('client_id=<appKey>-specialist-client');
    expect(DELEGATION_DETAIL[3].form).not.toContain('Basic');
    expect(DELEGATION_DETAIL[3].tokens[2].claims.scope).toBe('purchase:read');
  });
  it('attaches only standards that govern the hop: no product docs as specs, no analogy drafts, no unverified at+jwt profile', () => {
    const refs = [...Object.values(DELEGATION_DETAIL), ...Object.values(DISCOVERY_DETAIL)].flatMap((d) => d.refs);
    refs.forEach((r) => {
      expect(r.id).not.toMatch(/^PingOne|Ping Agent Gateway|AuthZEN|RFC 9068|wimse|transaction-tokens|identity-chaining/i);
      expect(r.title).not.toMatch(/analogy|counterpart|instead/i);
    });
    expect(JSON.stringify(DELEGATION_DETAIL)).not.toContain('at+jwt');
  });
});
