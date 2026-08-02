const request = require('supertest');
const express = require('express');

jest.mock('../services/configStore', () => ({ get: jest.fn(), getEffective: jest.fn() }));
const configStore = require('../services/configStore');

process.env.BFF_INTERNAL_SECRET = 'test-internal-secret';
const vaultServiceKey = require('../routes/vaultServiceKey');

function buildApp() {
  const app = express();
  app.use('/internal', vaultServiceKey);
  return app;
}

const SECRET = 'test-internal-secret';

describe('GET /internal/vault/service-key', () => {
  beforeEach(() => {
    configStore.get.mockReset();
    configStore.getEffective.mockReset();
  });

  test('403 when the internal secret is missing', async () => {
    const res = await request(buildApp())
      .get('/internal/vault/service-key')
      .query({ name: 'DEMO_API_RESOURCE_SERVER_KEY' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  test('403 when the internal secret is wrong', async () => {
    const res = await request(buildApp())
      .get('/internal/vault/service-key')
      .set('x-internal-gateway-secret', 'nope')
      .query({ name: 'DEMO_API_RESOURCE_SERVER_KEY' });
    expect(res.status).toBe(403);
  });

  test('404 for a non-allow-listed name (never leaks other secrets)', async () => {
    configStore.getEffective.mockReturnValue('super-secret-value');
    const res = await request(buildApp())
      .get('/internal/vault/service-key')
      .set('x-internal-gateway-secret', SECRET)
      .query({ name: 'SESSION_SECRET' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_allowlisted');
    expect(configStore.getEffective).not.toHaveBeenCalled();
  });

  test('404 when an allow-listed key is unset', async () => {
    configStore.getEffective.mockReturnValue(null);
    const res = await request(buildApp())
      .get('/internal/vault/service-key')
      .set('x-internal-gateway-secret', SECRET)
      .query({ name: 'DEMO_MCP_RESOURCE_SERVER_KEY' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('key_unset');
    expect(configStore.getEffective).toHaveBeenCalledWith('demo_mcp_resource_server_key');
  });

  test('200 returns the value for an allow-listed name', async () => {
    configStore.getEffective.mockReturnValue('demo-mortgage-key-0000');
    const res = await request(buildApp())
      .get('/internal/vault/service-key')
      .set('x-internal-gateway-secret', SECRET)
      .query({ name: 'DEMO_API_RESOURCE_SERVER_KEY' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: 'DEMO_API_RESOURCE_SERVER_KEY', value: 'demo-mortgage-key-0000' });
    expect(configStore.getEffective).toHaveBeenCalledWith('demo_api_resource_server_key');
  });

  // The mortgage backend hard-rejects the committed defaults at boot, so a
  // bridge serving one in production can only yield a confusing downstream
  // 401 ("backend rejected the service API key"). Fail HERE instead.
  // The guard keys off VAULT_INTERNAL_STRICT, NOT NODE_ENV: k8s and
  // docker-compose both pin the BFF to NODE_ENV=development deliberately (the
  // simulated Authorize service requires it), so the old NODE_ENV==='production'
  // condition was dead code in every real deployment.
  describe('committed-default guard (VAULT_INTERNAL_STRICT=true)', () => {
    const prevStrict = process.env.VAULT_INTERNAL_STRICT;
    afterEach(() => {
      if (prevStrict === undefined) delete process.env.VAULT_INTERNAL_STRICT;
      else process.env.VAULT_INTERNAL_STRICT = prevStrict;
    });

    test('503 key_not_provisioned when the resolved value is a committed default', async () => {
      process.env.VAULT_INTERNAL_STRICT = 'true';
      configStore.getEffective.mockReturnValue('demo-mortgage-key-0000');
      const res = await request(buildApp())
        .get('/internal/vault/service-key')
        .set('x-internal-gateway-secret', SECRET)
        .query({ name: 'DEMO_API_RESOURCE_SERVER_KEY' });
      expect(res.status).toBe(503);
      expect(res.body.error).toBe('key_not_provisioned');
    });

    test('200 under strict mode for a real (non-default) key', async () => {
      process.env.VAULT_INTERNAL_STRICT = 'true';
      configStore.getEffective.mockReturnValue('mortgage-abc123def456');
      const res = await request(buildApp())
        .get('/internal/vault/service-key')
        .set('x-internal-gateway-secret', SECRET)
        .query({ name: 'DEMO_API_RESOURCE_SERVER_KEY' });
      expect(res.status).toBe(200);
      expect(res.body.value).toBe('mortgage-abc123def456');
    });
  });
});
