import { describe, it, expect } from 'vitest';
import { isA2aUseCase, extractA2aFacts } from '../a2aFacts';

const runEvents = [
  { id: 'a2a-agent1-actor', claims: { client_id: 'agent1-cid' }, vertical: 'banking' },
  { id: 'a2a-exchange1', claims: { aud: 'a2a-intermediate-investment.ping.demo', act: { sub: 'agent1-cid' } } },
  { id: 'a2a-agent2-actor', specialist: 'Investment Advisor', claims: { client_id: 'agent2-cid' } },
  {
    id: 'a2a-exchange2',
    specialist: 'Investment Advisor',
    scope: 'invest:read',
    actChainDepth: 2,
    a2aTool: 'get_portfolio_summary',
    claims: { aud: ['mcpgateway-a2a.ping.demo'], scope: 'invest:read', act: { sub: 'agent2-cid', act: { sub: 'agent1-cid' } } },
  },
];

describe('isA2aUseCase', () => {
  it('is true for UC2 and UC2.5, false otherwise', () => {
    expect(isA2aUseCase({ id: 'UC2' })).toBe(true);
    expect(isA2aUseCase({ id: 'UC2.5' })).toBe(true);
    expect(isA2aUseCase({ id: 'UC7' })).toBe(false);
    expect(isA2aUseCase(null)).toBe(false);
  });

  it('is true for an explicit a2a-flagged object (used by the auto-open synthetic uc)', () => {
    expect(isA2aUseCase({ id: 'A2A', a2a: true })).toBe(true);
  });
});

describe('extractA2aFacts', () => {
  it('maps a full a2a run to facts', () => {
    const f = extractA2aFacts(runEvents);
    expect(f.present).toBe(true);
    expect(f.specialist).toBe('Investment Advisor');
    expect(f.intermediateAud).toBe('a2a-intermediate-investment.ping.demo');
    expect(f.gatewayAud).toBe('mcpgateway-a2a.ping.demo');
    expect(f.scope).toBe('invest:read');
    expect(f.actChainDepth).toBe(2);
    expect(f.tool).toBe('get_portfolio_summary');
    expect(f.actChain).toEqual(['agent2-cid', 'agent1-cid']);
  });

  it('returns present:false and nulls for empty/absent events without throwing', () => {
    const f = extractA2aFacts([]);
    expect(f.present).toBe(false);
    expect(f.specialist).toBeNull();
    expect(f.gatewayAud).toBeNull();
    expect(() => extractA2aFacts(undefined)).not.toThrow();
  });
});
