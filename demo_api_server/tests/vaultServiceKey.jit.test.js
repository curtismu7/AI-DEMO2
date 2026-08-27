'use strict';

// JIT behaviour of the gateway-only bridge, kept in its own file so
// tests/vaultServiceKey.test.js stays the untouched REGRESSION_PLAN §1 pin.
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

jest.mock('../services/configStore', () => ({ get: jest.fn(), getEffective: jest.fn() }));
jest.mock('../services/killSwitchService', () => ({ isAgentRevoked: jest.fn() }));

const configStore = require('../services/configStore');
const killSwitchService = require('../services/killSwitchService');

process.env.BFF_INTERNAL_SECRET = 'test-internal-secret';
const vaultServiceKey = require('../routes/vaultServiceKey');

const SECRET = 'test-internal-secret';
const KEY_NAME = 'DEMO_API_RESOURCE_SERVER_KEY';
const FAKE_BACKEND_KEY = 'not-a-secret-test-fixture';

function buildApp() {
  const app = express();
  app.use('/internal', vaultServiceKey);
  return app;
}

function get(query) {
  return request(buildApp())
    .get('/internal/vault/service-key')
    .set('x-internal-gateway-secret', SECRET)
    .query(query);
}

/** getEffective serves both the flag and the backend key. */
function withFlag(on) {
  configStore.getEffective.mockImplementation((k) => {
    if (k === 'ff_jit_credentials') return on ? 'true' : 'false';
    if (k === 'demo_api_resource_server_key') return FAKE_BACKEND_KEY;
    return '';
  });
}

describe('GET /internal/vault/service-key — JIT credentials', () => {
  beforeEach(() => {
    configStore.getEffective.mockReset();
    killSwitchService.isAgentRevoked.mockReset();
    killSwitchService.isAgentRevoked.mockResolvedValue(false);
  });

  test('flag OFF returns the legacy body verbatim — no new fields', async () => {
    withFlag(false);
    const res = await get({ name: KEY_NAME, tool: 'show_mortgage' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: KEY_NAME, value: FAKE_BACKEND_KEY });
  });

  test('flag ON returns a minted credential instead of the raw key', async () => {
    withFlag(true);
    const res = await get({ name: KEY_NAME, tool: 'show_mortgage', aud: 'mortgage' });

    expect(res.status).toBe(200);
    // The point of the change: the static key never leaves the BFF.
    expect(res.body.value).not.toBe(FAKE_BACKEND_KEY);

    const claims = jwt.verify(res.body.value, FAKE_BACKEND_KEY, { algorithms: ['HS256'] });
    expect(claims.tool).toBe('show_mortgage');
    expect(res.body.expiresAt).toBeGreaterThan(Date.now());
  });

  test('flag ON fails closed when minting is refused — never falls back to the raw key', async () => {
    withFlag(true);
    killSwitchService.isAgentRevoked.mockResolvedValue(true);

    const res = await get({ name: KEY_NAME, tool: 'show_mortgage' });

    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain(FAKE_BACKEND_KEY);
  });
});
