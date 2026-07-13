'use strict';

const { runIntentBindingDemo } = require('../../services/attackSimulatorService');

describe('runIntentBindingDemo — structural (no creds needed)', () => {
  test('returns no_session_token when session is missing (permit action)', async () => {
    const result = await runIntentBindingDemo('permit', { session: { oauthTokens: {} } });
    expect(result.status).toBe(401);
    expect(result.errorCode).toBe('no_session_token');
  });

  test('returns unknown_action for an unrecognized action', async () => {
    const result = await runIntentBindingDemo('nonsense', { session: { oauthTokens: { accessToken: 'x' } } });
    expect(result.status).toBe(400);
    expect(result.errorCode).toBe('unknown_action');
  });

  test('drift action delegates to the existing rar-exceeded attack sim', async () => {
    const result = await runIntentBindingDemo('drift', { session: { oauthTokens: {} } });
    // Same session-missing guard as runAttackSim('rar-exceeded', ...) — proves delegation, not a parallel no-op.
    expect(result.sim).toBe('rar-exceeded');
    expect(result.status).toBe(401);
    expect(result.errorCode).toBe('no_session_token');
  });
});
