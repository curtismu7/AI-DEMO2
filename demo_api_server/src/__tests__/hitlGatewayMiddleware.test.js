'use strict';

const { evaluateToolCall, getHitlThreshold } = require('../../middleware/hitlGatewayMiddleware');

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
