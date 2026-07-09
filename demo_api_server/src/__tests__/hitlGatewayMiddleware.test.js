'use strict';

jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn((key) => {
    if (key === 'mfa_threshold_usd_banking') return '750';
    if (key === 'mfa_threshold_usd') return '500';
    return null;
  }),
}));

jest.mock('../../services/verticalManifest', () => ({
  verticalManifest: {
    resolver: {
      activeId: () => 'banking',
      activeIdFor: () => 'banking',
    },
  },
}));

const mockGetChallengeStatus = jest.fn();
jest.mock('../../services/hitlServiceClient', () => ({
  getChallengeStatus: (...args) => mockGetChallengeStatus(...args),
  verifyHitlReceipt: jest.requireActual('../../services/hitlServiceClient').verifyHitlReceipt,
  createChallenge: jest.fn(),
}));

const {
  evaluateToolCall,
  getHitlThreshold,
  getConsentDecision,
} = require('../../middleware/hitlGatewayMiddleware');

describe('hitlGatewayMiddleware.evaluateToolCall — vertical thresholds', () => {
  test('uses vertical-specific threshold when configured', async () => {
    const result = await evaluateToolCall(
      { tool: 'create_transfer', params: { amount: 600 } },
      'user-1',
      { verticalId: 'banking' },
    );
    expect(result.requiresConsent).toBe(false);
  });

  test('requires consent when amount exceeds vertical threshold', async () => {
    const result = await evaluateToolCall(
      { tool: 'create_transfer', params: { amount: 800 } },
      'user-1',
      { verticalId: 'banking' },
    );
    expect(result.requiresConsent).toBe(true);
    expect(result.consentId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  test('getHitlThreshold falls back to global when vertical key missing', () => {
    expect(getHitlThreshold('unknown-vertical')).toBe(500);
    expect(getHitlThreshold('banking')).toBe(750);
  });
});

describe('hitlGatewayMiddleware.getConsentDecision — amount binding', () => {
  beforeEach(() => {
    mockGetChallengeStatus.mockReset();
  });

  test('rejects when retry amount does not match receipt amount', async () => {
    mockGetChallengeStatus.mockResolvedValue({
      status: 'approved',
      userId: 'u1',
      agentId: 'a1',
      tool: 'create_transfer',
      expiresAt: '2099-01-01T00:00:00Z',
      context: { amount: 250 },
    });
    const result = await getConsentDecision('c1', {
      userId: 'u1',
      agentId: 'a1',
      tool: 'create_transfer',
      amount: 499,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/amount/i);
  });

  test('accepts when retry amount matches receipt amount', async () => {
    mockGetChallengeStatus.mockResolvedValue({
      status: 'approved',
      userId: 'u1',
      agentId: 'a1',
      tool: 'create_transfer',
      expiresAt: '2099-01-01T00:00:00Z',
      context: { amount: 250 },
    });
    const result = await getConsentDecision('c1', {
      userId: 'u1',
      agentId: 'a1',
      tool: 'create_transfer',
      amount: 250,
    });
    expect(result.valid).toBe(true);
    expect(result.approved).toBe(true);
  });
});
