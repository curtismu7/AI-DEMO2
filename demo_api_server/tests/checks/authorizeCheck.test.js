'use strict';
jest.mock('../../services/pingOneAuthorizeService', () => ({
  isConfigured: jest.fn(() => true),
  evaluateTransaction: jest.fn(),
}));
jest.mock('../../services/configStore', () => ({ getEffective: jest.fn(() => 'ep-123') }));

const p1az = require('../../services/pingOneAuthorizeService');
const { mode, realDecision, failOpen } = require('../../services/checks/authorizeCheck');

describe('authorizeCheck', () => {
  beforeEach(() => {
    p1az.isConfigured.mockReturnValue(true);
    p1az.evaluateTransaction.mockClear();
  });
  afterEach(() => jest.clearAllMocks());

  test('mode reports Real when not simulated', async () => {
    const r = await mode.run({ flags: { ff_authorize_simulated: false } });
    expect(r.status).toBe('pass');
    expect(r.meta.mode).toBe('real');
  });

  test('real_decision passes when both eval calls return a decision + id', async () => {
    p1az.evaluateTransaction
      .mockResolvedValueOnce({ decision: 'PERMIT', decisionId: 'a1' })
      .mockResolvedValueOnce({ decision: 'DENY', decisionId: 'a2' });
    const r = await realDecision.run({ flags: { ff_authorize_simulated: false } });
    expect(r.status).toBe('pass');
    expect(r.meta.decisions.map((d) => d.decision)).toEqual(['PERMIT', 'DENY']);
  });

  test('real_decision fails when not configured', async () => {
    p1az.isConfigured.mockReturnValue(false);
    const r = await realDecision.run({ flags: {} });
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/not configured/i);
  });

  test('real_decision fails when PingOne call throws', async () => {
    p1az.evaluateTransaction.mockRejectedValue(new Error('policy_not_found'));
    const r = await realDecision.run({ flags: {} });
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/policy_not_found/);
  });

  test('real_decision warns when policy does not discriminate', async () => {
    p1az.evaluateTransaction
      .mockResolvedValueOnce({ decision: 'PERMIT', decisionId: 'a1' })
      .mockResolvedValueOnce({ decision: 'PERMIT', decisionId: 'a2' });
    const r = await realDecision.run({ flags: {} });
    expect(r.status).toBe('warn');
  });

  test('failOpen warns when fail-open is off', async () => {
    expect((await failOpen.run({ flags: { ff_authorize_fail_open: false } })).status).toBe('warn');
    expect((await failOpen.run({ flags: { ff_authorize_fail_open: true } })).status).toBe('pass');
  });
});
