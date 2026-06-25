'use strict';

describe('vaultLoader env-scoped filtering helper', () => {
  test('drops env-scoped keys only when verdict is reconcile', () => {
    const { filterVaultForReconcile } = require('../../services/vaultLoader');
    const data = {
      pingone_ai_agent_client_secret: 'STALE', // env-scoped
      ff_hitl_enabled: 'true',                  // agnostic
    };
    const stubCs = {
      getEnvReconcileVerdict: () => 'reconcile',
      isEnvScoped: (k) => k === 'pingone_ai_agent_client_secret',
    };
    const dropped = filterVaultForReconcile(data, stubCs);
    expect(dropped).toEqual(['pingone_ai_agent_client_secret']);
    expect(data).toEqual({ ff_hitl_enabled: 'true' }); // mutated in place
  });

  test('keeps everything when verdict is noop', () => {
    const { filterVaultForReconcile } = require('../../services/vaultLoader');
    const data = { pingone_ai_agent_client_secret: 'KEEP' };
    const dropped = filterVaultForReconcile(data, { getEnvReconcileVerdict: () => 'noop', isEnvScoped: () => true });
    expect(dropped).toEqual([]);
    expect(data).toEqual({ pingone_ai_agent_client_secret: 'KEEP' });
  });
});
