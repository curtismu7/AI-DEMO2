// demo_api_ui/src/utils/authorizeResultExplain.test.js
import {
  explainAuthorizeResult,
  resolvePolicyContext,
  TX_DENY_USD,
} from './authorizeResultExplain';

const MOCK_POLICIES = [{
  kind: 'POLICY_SET',
  name: 'AI Demo Policies',
  algorithm: 'DenyOverrides',
  children: [{
    kind: 'POLICY',
    name: 'AI Demo Transaction Authorization',
    description: 'Authorizes AI Demo transaction requests by amount, type, and ACR.',
    algorithm: 'DenyOverrides',
    children: [{
      kind: 'RULE',
      name: 'Deny Large Transactions',
      description: 'DENY any transaction where Amount > $2,000.',
    }],
  }],
}];

describe('explainAuthorizeResult — transaction', () => {
  const base = { Amount: 5000, TransactionType: 'withdrawal', UserId: 'demoUser', Acr: 'Single' };

  it('explains DENY for amount above hard deny', () => {
    const r = explainAuthorizeResult({
      parameters: base,
      result: { decision: 'DENY', engine: 'pingone', stepUpRequired: false, consentRequired: false },
      preset: 'transaction',
      policies: MOCK_POLICIES,
    });
    expect(r.headline).toMatch(/DENY/i);
    expect(r.ruleLikely).toBe('Deny Large Transactions');
    expect(r.policyName).toBe('AI Demo Transaction Authorization');
    expect(r.policyDescription).toContain('AI Demo transaction requests');
    expect(r.ruleName).toBe('Deny Large Transactions');
    expect(r.ruleDescription).toMatch(/\$2,000/);
    expect(r.reasons.some((x) => x.includes(TX_DENY_USD.toLocaleString()))).toBe(true);
  });

  it('explains step-up for mid amount without MFA', () => {
    const r = explainAuthorizeResult({
      parameters: { ...base, Amount: 600, Acr: '' },
      result: { decision: 'PERMIT', stepUpRequired: true, engine: 'pingone' },
      preset: 'transaction',
    });
    expect(r.ruleLikely).toMatch(/Step-Up/i);
    expect(r.headline).toMatch(/step-up/i);
  });

  it('includes PingOne statement names when present', () => {
    const r = explainAuthorizeResult({
      parameters: { ...base, Amount: 100 },
      result: {
        decision: 'PERMIT',
        raw: { statements: [{ name: 'Standard permit', code: 'permit' }] },
      },
      preset: 'transaction',
    });
    expect(r.reasons.some((x) => x.includes('Standard permit'))).toBe(true);
  });
});

describe('resolvePolicyContext', () => {
  it('picks transaction policy and matching rule from tree', () => {
    const ctx = resolvePolicyContext(MOCK_POLICIES, { isMcp: false, ruleLikely: 'Deny Large Transactions' });
    expect(ctx.policyName).toBe('AI Demo Transaction Authorization');
    expect(ctx.ruleName).toBe('Deny Large Transactions');
  });
});

describe('explainAuthorizeResult — mcp', () => {
  it('explains audience mismatch DENY', () => {
    const r = explainAuthorizeResult({
      parameters: {
        DecisionContext: 'McpFirstTool',
        TokenAudience: 'wrong',
        McpResourceUri: 'right',
        UserId: 'u1',
        ActClientId: 'actor-1',
      },
      result: { decision: 'DENY' },
      preset: 'mcp',
    });
    expect(r.ruleLikely).toMatch(/Audience/i);
  });
});
