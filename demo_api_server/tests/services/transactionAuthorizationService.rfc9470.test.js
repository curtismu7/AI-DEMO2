/**
 * @file transactionAuthorizationService.rfc9470.test.js
 * @description The step-up block is a mode switch on ff_rfc9470_challenge:
 *   OFF (default) → legacy { status: 428, body } (no headers key)
 *   ON            → RFC 9470 { status: 401, headers: { WWW-Authenticate }, body }
 * The JSON body is identical in both modes.
 */

jest.mock('../../services/configStore', () => ({
  get: jest.fn(() => null),
  getEffective: jest.fn(() => null),
}));

jest.mock('../../services/simulatedAuthorizeService', () => ({
  isSimulatedModeEnabled: jest.fn(() => true),
  resolveAuthorizeMode: jest.fn(() => ({ failoverMode: 'fallback_simulated' })),
  evaluateTransaction: jest.fn(),
  buildAuthorizeFallbackSignal: jest.fn(() => ({})),
}));

jest.mock('../../services/pingOneAuthorizeService', () => ({
  evaluateTransaction: jest.fn(),
}));

jest.mock('../../services/appEventService', () => ({
  logEvent: jest.fn(),
  EVENT_CATEGORIES: { AUTHORIZE: 'authorize', HITL: 'hitl' },
}));

const configStore = require('../../services/configStore');
const simulatedAuthorizeService = require('../../services/simulatedAuthorizeService');
const runtimeSettings = require('../../config/runtimeSettings');
const { evaluateTransactionPolicy } = require('../../services/transactionAuthorizationService');

const evaluateOpts = {
  runtimeSettings,
  userRole: 'user',
  userId: 'u1',
  amount: 500,
  type: 'transfer',
  acr: null,
  useCaseId: '',
};

let originalSettings;
beforeAll(() => {
  originalSettings = runtimeSettings.getAll();
});

beforeEach(() => {
  jest.clearAllMocks();
  simulatedAuthorizeService.isSimulatedModeEnabled.mockReturnValue(true);
  simulatedAuthorizeService.evaluateTransaction.mockResolvedValue({
    decision: 'INDETERMINATE',
    stepUpRequired: true,
    consentRequired: false,
    path: 'sim',
    decisionId: 'd1',
    raw: {},
  });
  runtimeSettings.update(
    { stepUpAcrValue: 'Multi_Factor', stepUpMaxAge: 300, stepUpMethod: 'ciba' },
    'test'
  );
});

afterAll(() => {
  runtimeSettings.update(
    {
      stepUpAcrValue: originalSettings.stepUpAcrValue,
      stepUpMaxAge: originalSettings.stepUpMaxAge,
      stepUpMethod: originalSettings.stepUpMethod,
    },
    'test-cleanup'
  );
});

describe('step-up block mode switch (ff_rfc9470_challenge)', () => {
  it('flag OFF → legacy 428 block with no headers', async () => {
    configStore.getEffective.mockReturnValue(null); // flag unset = OFF

    const res = await evaluateTransactionPolicy(evaluateOpts);

    expect(res.ran).toBe(true);
    expect(res.block.status).toBe(428);
    expect(res.block.headers).toBeUndefined();
    expect(res.block.body.error).toBe('step_up_required');
    expect(res.block.body.step_up_acr).toBe('Multi_Factor');
    expect(res.block.body.step_up_url).toBe('/api/auth/oauth/user/stepup');
  });

  it('flag ON → 401 with spec-exact WWW-Authenticate header, same body', async () => {
    configStore.getEffective.mockImplementation((key) =>
      key === 'ff_rfc9470_challenge' ? 'true' : null
    );

    const res = await evaluateTransactionPolicy(evaluateOpts);

    expect(res.block.status).toBe(401);
    expect(res.block.headers['WWW-Authenticate']).toBe(
      'Bearer error="insufficient_user_authentication", ' +
        'error_description="A different authentication level is required", ' +
        'acr_values="Multi_Factor", max_age="300"'
    );
    expect(res.block.body.error).toBe('step_up_required');
    expect(res.block.body.step_up_acr).toBe('Multi_Factor');
  });

  it('flag ON → challenge max_age reflects stepUpMaxAge (0 when disabled)', async () => {
    configStore.getEffective.mockImplementation((key) =>
      key === 'ff_rfc9470_challenge' ? 'true' : null
    );
    runtimeSettings.update({ stepUpMaxAge: 0 }, 'test');

    const res = await evaluateTransactionPolicy(evaluateOpts);

    expect(res.block.headers['WWW-Authenticate']).toContain('max_age="0"');
  });

  it('fallback-simulated path keeps authorizeFallback in the body in RFC mode', async () => {
    configStore.getEffective.mockImplementation((key) =>
      key === 'ff_rfc9470_challenge' ? 'true' : null
    );
    // Force the PingOne path, make it throw, and fall back to simulated.
    simulatedAuthorizeService.isSimulatedModeEnabled.mockReturnValue(false);
    configStore.get.mockImplementation((key) =>
      key === 'authorize_decision_endpoint_id' ? 'ep-1' : null
    );
    const pingOneAuthorizeService = require('../../services/pingOneAuthorizeService');
    pingOneAuthorizeService.evaluateTransaction.mockRejectedValue(new Error('down'));
    simulatedAuthorizeService.buildAuthorizeFallbackSignal.mockReturnValue({ fellBack: true });

    const res = await evaluateTransactionPolicy(evaluateOpts);

    expect(res.block.status).toBe(401);
    expect(res.block.headers['WWW-Authenticate']).toContain('insufficient_user_authentication');
    expect(res.block.body.authorizeFallback).toEqual({ fellBack: true });
  });
});
