// demo_api_ui/src/utils/authorizeResultExplain.test.js
import { explainAuthorizeResult, TX_DENY_USD } from './authorizeResultExplain';

describe('explainAuthorizeResult — transaction', () => {
  const base = { Amount: 5000, TransactionType: 'withdrawal', UserId: 'demoUser', Acr: 'Single' };

  it('explains DENY for amount above hard deny', () => {
    const r = explainAuthorizeResult({
      parameters: base,
      result: { decision: 'DENY', engine: 'pingone', stepUpRequired: false, consentRequired: false },
      preset: 'transaction',
    });
    expect(r.headline).toMatch(/DENY/i);
    expect(r.ruleLikely).toBe('Deny Large Transactions');
    expect(r.reasons.some((x) => x.includes(String(TX_DENY_USD)))).toBe(true);
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
