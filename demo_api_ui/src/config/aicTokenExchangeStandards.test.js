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
    expect(AIC_STEP_DETAIL[4].tokens[0].claims.may_act).toBeDefined();
  });
  it('contains no real secrets', () => {
    expect(JSON.stringify(AIC_STEP_DETAIL)).not.toMatch(/client_secret|eyJ/);
  });
});
