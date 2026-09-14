/**
 * EXTERNAL_GUARDRAIL_WEBHOOK_URL receives every denied AI Guard prompt, and
 * GET /api/admin/config is unauthenticated — so the URL must be masked there,
 * and an admin must be able to clear it (setConfig drops '' by default).
 */
'use strict';

describe('configStore EXTERNAL_GUARDRAIL_WEBHOOK_URL', () => {
  beforeEach(() => {
    delete process.env.EXTERNAL_GUARDRAIL_WEBHOOK_URL;
    jest.resetModules();
  });

  it('is masked in getMasked() but readable server-side', async () => {
    const configStore = require('../services/configStore');
    await configStore.setConfig({ EXTERNAL_GUARDRAIL_WEBHOOK_URL: 'https://webhook.site/secret-id' });
    expect(configStore.getMasked().EXTERNAL_GUARDRAIL_WEBHOOK_URL).toBe('••••••••');
    expect(configStore.getEffective('EXTERNAL_GUARDRAIL_WEBHOOK_URL')).toBe('https://webhook.site/secret-id');
  });

  it('can be cleared with an empty string', async () => {
    const configStore = require('../services/configStore');
    await configStore.setConfig({ EXTERNAL_GUARDRAIL_WEBHOOK_URL: 'https://webhook.site/secret-id' });
    await configStore.setConfig({ EXTERNAL_GUARDRAIL_WEBHOOK_URL: '' });
    expect(configStore.getEffective('EXTERNAL_GUARDRAIL_WEBHOOK_URL')).toBeFalsy();
    expect(configStore.getMasked().EXTERNAL_GUARDRAIL_WEBHOOK_URL).toBe('');
  });
});
