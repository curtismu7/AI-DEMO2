import { describe, it, expect } from 'vitest';
import { GROUP_POLICY_DIAGRAM } from '../groupPolicyBoardDiagram';
import { GROUP_POLICY_DETAIL } from '../groupPolicyStandards';
import { AUTHZ, BEARER, CREDS } from '../pingStyleStandards';

describe('group policy ping-style detail', () => {
  const { GROUPS, EDGES, STEPS } = GROUP_POLICY_DIAGRAM;
  const text = Object.values(GROUP_POLICY_DETAIL).map((d) => `${d.form}\n${JSON.stringify(d.tokens || [])}`).join('\n');

  it('one step per arrow, each with its detail', () => {
    expect(STEPS.map((s) => s.edges)).toEqual(EDGES.map((_e, i) => [i]));
    STEPS.forEach((s, i) => expect(s.detail).toBe(GROUP_POLICY_DETAIL[i]));
  });
  it('every step has a request form and kinded standards', () => {
    STEPS.forEach((s) => {
      expect(s.detail.form.length).toBeGreaterThan(10);
      expect(s.detail.refs.length).toBeGreaterThan(1);
      s.detail.refs.forEach((r) => expect(['rfc', 'spec', 'emerging']).toContain(r.kind));
    });
  });
  it('mock tokens are labelled and carry claims; no JWT-looking secrets', () => {
    const toks = STEPS.flatMap((s) => s.detail.tokens || []);
    expect(toks.length).toBeGreaterThan(0);
    toks.forEach((t) => { expect(t.note).toContain('·'); expect(t.claims.iss).toBeTruthy(); });
    expect(text).not.toMatch(/eyJ[A-Za-z0-9]{10,}/);
  });
  it('matches the real wire: flag body, decision endpoint path, real group and tool, no invented codes', () => {
    expect(text).toContain('"updates"');
    expect(text).toContain('/decisionEndpoints/MCP_DECISION_ENDPOINT_ID');
    expect(text).not.toContain('DECISION_ENDPOINT_URL');
    expect(text).toContain('Banking_PremiumTier');
    expect(text).toContain('get_sensitive_account_details');
    expect(text).toContain('mcp-user-not-in-group');
    expect(text).not.toMatch(/GROUP_MEMBER|NOT_IN_GROUP|banking-tellers|group_gated|p1:read:user/);
    expect(text).not.toContain('"groups"'); // userGroups is not forwarded to PingOne (INVALID_VALUE)
  });
  it('standards are product-specific and use shared bundles', () => {
    const ids = (i) => GROUP_POLICY_DETAIL[i].refs.map((r) => r.id);
    expect(ids(3)).toEqual(expect.arrayContaining(['PingOne Authorize decision endpoints', CREDS[0].id, BEARER[0].id]));
    expect(ids(0)).toContain('RFC 5789');
    expect(ids(0)).not.toContain('RFC 9110 (PATCH)');
    expect(ids(2)).toContain('PingOne Management API');
    expect(AUTHZ.length).toBeGreaterThan(0);
  });
  it('uses the Ping palette and shows dashed decision answers', () => {
    expect(Object.values(GROUPS).map((g) => g.bg).sort()).toEqual(['#151a24', '#5a5f69', '#b5231a']);
    expect(EDGES.filter((e) => e[3]?.dashed).map((e) => EDGES.indexOf(e))).toEqual([4, 6]);
  });
});
