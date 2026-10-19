import { describe, it, expect } from 'vitest';
import { AIC_EXCHANGE_EDGES, AIC_EXCHANGE_STEPS } from './aicTokenExchangeDiagram';
import { AIC_STEP_DETAIL } from './aicTokenExchangeStandards';

describe('aic token exchange detail', () => {
  it('has one step per arrow, each with a form and standards', () => {
    expect(AIC_EXCHANGE_STEPS).toHaveLength(AIC_EXCHANGE_EDGES.length);
    AIC_EXCHANGE_STEPS.forEach((s, i) => {
      expect(s.edges).toEqual([i]);
      expect(s.detail.form).toBeTruthy();
      expect(s.detail.refs.length).toBeGreaterThan(0);
    });
  });
  it('labels delegation: exchange cites RFC 8693 and the delegated token carries act', () => {
    expect(AIC_STEP_DETAIL[6].refs.map((r) => r.id)).toContain('RFC 8693');
    expect(AIC_STEP_DETAIL[7].tokens[0].claims.act).toEqual({ sub: 'agent' });
    expect(AIC_STEP_DETAIL[4].tokens[1].claims.may_act).toBeDefined();
  });
  it('contains no real secrets', () => {
    expect(JSON.stringify(AIC_STEP_DETAIL)).not.toMatch(/client_secret|eyJ/);
  });
  it('matches what the server sends: nonce, full scope, no token_type_hint, honest user-token introspection', () => {
    expect(AIC_STEP_DETAIL[0].form).toMatch(/nonce=/);
    expect(AIC_STEP_DETAIL[0].form).toContain('scope=openid profile email repair');
    expect(JSON.stringify(AIC_STEP_DETAIL)).not.toMatch(/token_type_hint|openid repair/);
    expect(AIC_STEP_DETAIL[1].tokens[1].claims.nonce).toBeDefined();
    expect(AIC_STEP_DETAIL[4].tokens[0].claims).toEqual({ active: false });
    expect(AIC_STEP_DETAIL[4].tokens[1].note).toMatch(/am-introspect-all-tokens/);
  });
  it('cites only standards the step uses, and marks emerging work', () => {
    const ids = (i) => AIC_STEP_DETAIL[i].refs.map((r) => r.id);
    [3, 6, 7].forEach((i) => expect(ids(i)).not.toEqual(expect.arrayContaining(['RFC 7523'])));
    [3, 6, 7].forEach((i) => expect(ids(i).some((id) => /RFC (7523|8705|8707)/.test(id))).toBe(false));
    [0, 1, 2, 3, 6, 7].forEach((i) => expect(AIC_STEP_DETAIL[i].refs.some((r) => r.kind === 'emerging')).toBe(true));
  });
});
