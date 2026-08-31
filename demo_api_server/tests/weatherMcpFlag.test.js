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
    expect(res.body).toMatchObject({ enabled: true, allowedState: 'texas' });
    // The gateway needs the list on the SAME response — a second round-trip in
    // the policy hot path is exactly what this endpoint exists to avoid.
    expect(Array.isArray(res.body.blockedCities)).toBe(true);
    expect(typeof res.body.blockRadiusDeg).toBe('number');
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

  // The denylist mode has to survive the allowlist below. Dropping it from the
  // route's `includes` list does NOT error — it silently collapses to 'texas',
  // so the gateway would deny every city while the admin dropdown still read
  // "Any except blocked cities". That is the failure this asserts.
  test('passes the any-except-blocked denylist mode through unchanged', async () => {
    jest.spyOn(configStore, 'getEffective').mockImplementation((key) => {
      if (key === 'ff_weather_mcp_allowed_state') return 'any-except-blocked';
      return undefined;
    });
    const res = await request(app)
      .get('/internal/feature-flags/weather-mcp-showcase')
      .set('x-internal-gateway-secret', SECRET);
    expect(res.body.allowedState).toBe('any-except-blocked');
  });

  // any-except-miami shipped first. If the flag is already set to it, dropping
  // the alias sends the value down the unrecognized path to 'texas' — silently
  // turning "block one city" into "block every city but Texas" mid-demo.
  test('folds the legacy any-except-miami value into any-except-blocked', async () => {
    jest.spyOn(configStore, 'getEffective').mockImplementation((key) => {
      if (key === 'ff_weather_mcp_allowed_state') return 'any-except-miami';
      return undefined;
    });
    const res = await request(app)
      .get('/internal/feature-flags/weather-mcp-showcase')
      .set('x-internal-gateway-secret', SECRET);
    expect(res.body.allowedState).toBe('any-except-blocked');
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
    expect(res.body).toMatchObject({ enabled: false, allowedState: 'michigan' });
  });
});
