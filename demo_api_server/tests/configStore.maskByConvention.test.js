/**
 * GET /api/admin/config is unauthenticated and returns configStore.getMasked().
 * A field that is a secret by NAME (anthropic_api_key, pingone_mgmt_client_secret)
 * must be redacted there even when it was never added to SECRET_KEYS — otherwise
 * its plaintext ships to the browser. getMasked() masks SECRET_KEYS plus anything
 * matching /(_secret|_password|_api_key)$/i, while getEffective() still returns
 * the real value server-side.
 */
'use strict';

describe('configStore getMasked() masks secrets by naming convention', () => {
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.PINGONE_MGMT_CLIENT_SECRET;
    jest.resetModules();
  });

  it('masks anthropic_api_key in getMasked() but keeps it readable server-side', async () => {
    const configStore = require('../services/configStore');
    await configStore.setConfig({ anthropic_api_key: 'sk-ant-secret-value' });
    const masked = configStore.getMasked();
    expect(masked.anthropic_api_key).toBe('••••••••');
    expect(masked.anthropic_api_key_set).toBe(true);
    expect(configStore.getEffective('anthropic_api_key')).toBe('sk-ant-secret-value');
  });

  it('masks pingone_mgmt_client_secret in getMasked() but keeps it readable server-side', async () => {
    const configStore = require('../services/configStore');
    await configStore.setConfig({ pingone_mgmt_client_secret: 'mgmt-secret-value' });
    const masked = configStore.getMasked();
    expect(masked.pingone_mgmt_client_secret).toBe('••••••••');
    expect(configStore.getEffective('pingone_mgmt_client_secret')).toBe('mgmt-secret-value');
  });

  it('does not over-mask: a client_id stays visible', async () => {
    // The suffix rule is anchored to _secret/_password/_api_key, so a sibling
    // _id field (same prefix as a masked secret) must still show its value.
    const configStore = require('../services/configStore');
    await configStore.setConfig({ pingone_mgmt_client_id: 'client-id-123' });
    expect(configStore.getMasked().pingone_mgmt_client_id).toBe('client-id-123');
  });
});
