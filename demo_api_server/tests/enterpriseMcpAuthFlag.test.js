'use strict';
/**
 * /internal/feature-flags/enterprise-managed-mcp-auth — the pull half of making
 * the UI toggle the single answer for ID-JAG.
 *
 * Guards two things the gateway depends on: the secret gate (this route is
 * mounted outside /api and has no session auth), and that an unset flag reports
 * false. The neighbouring weather route defaults an unset flag to TRUE, so
 * copying its shape here would silently turn ID-JAG on everywhere.
 *
 * Everything is resolved inside load() rather than at module scope: setup.js
 * calls jest.resetModules() after every test, so a handle captured once points
 * at a registry entry the route no longer uses and every assertion reads
 * "Number of calls: 0".
 */
const express = require('express');
const request = require('supertest');

jest.mock('../services/configStore', () => ({ getEffective: jest.fn() }));
jest.mock('../utils/internalSecret', () => ({ internalSecretMatches: jest.fn() }));

const PATH = '/internal/feature-flags/enterprise-managed-mcp-auth';

function load({ secretOk = true, stored } = {}) {
  const configStore = require('../services/configStore');
  const { internalSecretMatches } = require('../utils/internalSecret');
  internalSecretMatches.mockReturnValue(secretOk);
  configStore.getEffective.mockReturnValue(stored);

  const app = express();
  app.use('/internal', require('../routes/enterpriseMcpAuthFlag'));
  return { app, configStore, internalSecretMatches };
}

describe('secret gate', () => {
  test('403s when the internal secret does not match', async () => {
    const { app } = load({ secretOk: false });
    const res = await request(app).get(PATH);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'forbidden' });
  });

  test('checks the x-internal-gateway-secret header specifically', async () => {
    const { app, internalSecretMatches } = load();
    await request(app).get(PATH).set('x-internal-gateway-secret', 'abc');
    expect(internalSecretMatches).toHaveBeenCalledWith('abc');
  });
});

describe('flag value', () => {
  test.each([
    ['true', true],
    [true, true],
    ['false', false],
    [false, false],
  ])('reports %p as enabled=%p', async (stored, expected) => {
    const { app } = load({ stored });
    const res = await request(app).get(PATH);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: expected });
  });

  // Registry defaultValue is false. The weather route next door defaults an
  // unset flag to true — do not let that shape leak in here.
  test.each([[null], [undefined], ['']])('reports an unset flag (%p) as disabled', async (stored) => {
    const { app } = load({ stored });
    const res = await request(app).get(PATH);
    expect(res.body).toEqual({ enabled: false });
  });

  test('reads the ff_enterprise_managed_mcp_auth key', async () => {
    const { app, configStore } = load({ stored: 'true' });
    await request(app).get(PATH);
    expect(configStore.getEffective).toHaveBeenCalledWith('ff_enterprise_managed_mcp_auth');
  });
});
