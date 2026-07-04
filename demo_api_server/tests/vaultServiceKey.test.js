const request = require('supertest');
const express = require('express');

jest.mock('../services/configStore', () => ({ get: jest.fn() }));
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
  beforeEach(() => configStore.get.mockReset());

  test('403 when the internal secret is missing', async () => {
    const res = await request(buildApp())
      .get('/internal/vault/service-key')
      .query({ name: 'DEMO_MORTGAGE_SERVICE_KEY' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  test('403 when the internal secret is wrong', async () => {
    const res = await request(buildApp())
      .get('/internal/vault/service-key')
      .set('x-internal-gateway-secret', 'nope')
      .query({ name: 'DEMO_MORTGAGE_SERVICE_KEY' });
    expect(res.status).toBe(403);
  });

  test('404 for a non-allow-listed name (never leaks other secrets)', async () => {
    configStore.get.mockReturnValue('super-secret-value');
    const res = await request(buildApp())
      .get('/internal/vault/service-key')
      .set('x-internal-gateway-secret', SECRET)
      .query({ name: 'SESSION_SECRET' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_allowlisted');
    expect(configStore.get).not.toHaveBeenCalled();
  });

  test('404 when an allow-listed key is unset', async () => {
    configStore.get.mockReturnValue(null);
    const res = await request(buildApp())
      .get('/internal/vault/service-key')
      .set('x-internal-gateway-secret', SECRET)
      .query({ name: 'DEMO_INVEST_SERVICE_KEY' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('key_unset');
    expect(configStore.get).toHaveBeenCalledWith('demo_invest_service_key');
  });

  test('200 returns the value for an allow-listed name', async () => {
    configStore.get.mockReturnValue('demo-mortgage-key-0000');
    const res = await request(buildApp())
      .get('/internal/vault/service-key')
      .set('x-internal-gateway-secret', SECRET)
      .query({ name: 'DEMO_MORTGAGE_SERVICE_KEY' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: 'DEMO_MORTGAGE_SERVICE_KEY', value: 'demo-mortgage-key-0000' });
    expect(configStore.get).toHaveBeenCalledWith('demo_mortgage_service_key');
  });
});
