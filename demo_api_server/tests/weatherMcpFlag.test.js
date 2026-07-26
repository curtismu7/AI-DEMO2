'use strict';

const express = require('express');
const request = require('supertest');

describe('GET /internal/feature-flags/weather-mcp-showcase', () => {
  const SECRET = 'test-secret';
  let app;
  let configStore;

  function makeApp() {
    jest.resetModules();
    process.env.BFF_INTERNAL_SECRET = SECRET;
    configStore = require('../services/configStore');
    const router = require('../routes/weatherMcpFlag');
    const a = express();
    a.use('/internal', router);
    return a;
  }

  beforeEach(() => {
    app = makeApp();
  });

  afterEach(() => {
    delete process.env.BFF_INTERNAL_SECRET;
  });

  test('403 without the internal secret header', async () => {
    const res = await request(app).get('/internal/feature-flags/weather-mcp-showcase');
    expect(res.status).toBe(403);
  });

  test('defaults to enabled=true, allowedState=texas when unset', async () => {
    jest.spyOn(configStore, 'getEffective').mockReturnValue(undefined);
    const res = await request(app)
      .get('/internal/feature-flags/weather-mcp-showcase')
      .set('x-internal-gateway-secret', SECRET);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: true, allowedState: 'texas' });
  });

  test('reflects a stored allowedState value', async () => {
    jest.spyOn(configStore, 'getEffective').mockImplementation((key) => {
      if (key === 'ff_weather_mcp_allowed_state') return 'michigan';
      return undefined;
    });
    const res = await request(app)
      .get('/internal/feature-flags/weather-mcp-showcase')
      .set('x-internal-gateway-secret', SECRET);
    expect(res.body.allowedState).toBe('michigan');
  });

  test('falls back to texas for an unrecognized stored value', async () => {
    jest.spyOn(configStore, 'getEffective').mockImplementation((key) => {
      if (key === 'ff_weather_mcp_allowed_state') return 'not-a-real-state';
      return undefined;
    });
    const res = await request(app)
      .get('/internal/feature-flags/weather-mcp-showcase')
      .set('x-internal-gateway-secret', SECRET);
    expect(res.body.allowedState).toBe('texas');
  });

  test('enabled reflects a stored false value independently of allowedState', async () => {
    jest.spyOn(configStore, 'getEffective').mockImplementation((key) => {
      if (key === 'ff_weather_mcp_showcase') return false;
      if (key === 'ff_weather_mcp_allowed_state') return 'michigan';
      return undefined;
    });
    const res = await request(app)
      .get('/internal/feature-flags/weather-mcp-showcase')
      .set('x-internal-gateway-secret', SECRET);
    expect(res.body).toEqual({ enabled: false, allowedState: 'michigan' });
  });
});
