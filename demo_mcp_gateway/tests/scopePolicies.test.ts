'use strict';

/**
 * scopePolicies.ts — TS mirror of ping-gateway's tx-weather-scope.groovy /
 * tx-brave-scope.groovy. Covers: Texas-only geofence permit/deny, brave
 * blocked-terms, and the flag-fetch fail-open(enabled)/fail-closed(policy)
 * posture on a BFF outage.
 */

import axios from 'axios';
import { checkWeatherScope, checkBraveScope } from '../src/scopePolicies';
import { routeTool } from '../src/router';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('router — weather/brave targets', () => {
  test('get_weather routes to weather, brave_news_search routes to brave', () => {
    expect(routeTool('get_weather')).toBe('weather');
    expect(routeTool('brave_news_search')).toBe('brave');
  });
});

describe('checkWeatherScope', () => {
  beforeEach(() => jest.clearAllMocks());

  test('permits a Texas city_name when the flag fetch succeeds with allowedState=texas', async () => {
    mockedAxios.get.mockResolvedValue({ status: 200, data: { enabled: true, allowedState: 'texas' } });
    const out = await checkWeatherScope({ city_name: 'Austin, TX' }, 'http://bff/flag', 'secret');
    expect(out.denied).toBe(false);
  });

  test('permits a bare Texas city name with no state qualifier', async () => {
    mockedAxios.get.mockResolvedValue({ status: 200, data: { enabled: true, allowedState: 'texas' } });
    const out = await checkWeatherScope({ city_name: 'Houston' }, 'http://bff/flag', 'secret');
    expect(out.denied).toBe(false);
  });

  test('denies a non-Texas city_name', async () => {
    mockedAxios.get.mockResolvedValue({ status: 200, data: { enabled: true, allowedState: 'texas' } });
    const out = await checkWeatherScope({ city_name: 'Miami, FL' }, 'http://bff/flag', 'secret');
    expect(out.denied).toBe(true);
    expect(out.message).toMatch(/Texas/);
  });

  test('denies a city_name that only shares a substring with an allowed city', async () => {
    mockedAxios.get.mockResolvedValue({ status: 200, data: { enabled: true, allowedState: 'texas' } });
    const out = await checkWeatherScope({ city_name: 'Plano, IL' }, 'http://bff/flag', 'secret');
    expect(out.denied).toBe(true);
  });

  test('permits coordinates inside the Texas bounding box', async () => {
    mockedAxios.get.mockResolvedValue({ status: 200, data: { enabled: true, allowedState: 'texas' } });
    const out = await checkWeatherScope({ latitude: 30.27, longitude: -97.74 }, 'http://bff/flag', 'secret');
    expect(out.denied).toBe(false);
  });

  test('denies coordinates outside the Texas bounding box', async () => {
    mockedAxios.get.mockResolvedValue({ status: 200, data: { enabled: true, allowedState: 'texas' } });
    const out = await checkWeatherScope({ latitude: 40.71, longitude: -74.0 }, 'http://bff/flag', 'secret');
    expect(out.denied).toBe(true);
  });

  test('denies location_name (cannot be scope-verified)', async () => {
    mockedAxios.get.mockResolvedValue({ status: 200, data: { enabled: true, allowedState: 'texas' } });
    const out = await checkWeatherScope({ location_name: 'home' }, 'http://bff/flag', 'secret');
    expect(out.denied).toBe(true);
  });

  test('permits any location when allowedState=any', async () => {
    mockedAxios.get.mockResolvedValue({ status: 200, data: { enabled: true, allowedState: 'any' } });
    const out = await checkWeatherScope({ city_name: 'Paris, FR' }, 'http://bff/flag', 'secret');
    expect(out.denied).toBe(false);
  });

  test('denies outright when ff_weather_mcp_showcase is disabled', async () => {
    mockedAxios.get.mockResolvedValue({ status: 200, data: { enabled: false, allowedState: 'texas' } });
    const out = await checkWeatherScope({ city_name: 'Austin, TX' }, 'http://bff/flag', 'secret');
    expect(out.denied).toBe(true);
    expect(out.message).toMatch(/disabled/);
  });

  test('fails open on enabled but fails closed to texas (narrowest) when the BFF flag fetch errors', async () => {
    mockedAxios.get.mockRejectedValue(new Error('ECONNREFUSED'));
    const permitTexas = await checkWeatherScope({ city_name: 'Austin, TX' }, 'http://bff/flag', 'secret');
    expect(permitTexas.denied).toBe(false); // enabled fails open
    const denyOther = await checkWeatherScope({ city_name: 'Miami, FL' }, 'http://bff/flag', 'secret');
    expect(denyOther.denied).toBe(true); // policy still enforced (defaults to texas, not "any")
  });

  test('permits when no location argument is present at all', async () => {
    mockedAxios.get.mockResolvedValue({ status: 200, data: { enabled: true, allowedState: 'texas' } });
    const out = await checkWeatherScope({}, 'http://bff/flag', 'secret');
    expect(out.denied).toBe(false);
  });
});

/**
 * allowedState='any-except-blocked' — the denylist mode. This port predates
 * that mode: it accepted only 'any' or a key in STATES, so the real value fell
 * through to the 'texas' DEFAULT and the gateway silently enforced Texas while
 * the UI said "Any except blocked cities". A blocked Texas city (Dallas) was
 * therefore permitted no matter what the admin put on the list.
 *
 * Semantics mirror tx-weather-scope.groovy: everywhere allowed EXCEPT the
 * listed cities, matched on BOTH argument shapes — the coordinate branch is not
 * optional, because weather-mcp's own tool descriptions steer a typed prompt
 * through search_location first and the tool call then carries lat/lon.
 */
describe('checkWeatherScope — any-except-blocked', () => {
  beforeEach(() => jest.clearAllMocks());

  const BLOCKED = {
    enabled: true,
    allowedState: 'any-except-blocked',
    blockedCities: [
      { label: 'Miami, FL', lat: 25.7743, lon: -80.1937 },
      { label: 'Dallas, TX', lat: 32.7762719, lon: -96.7968559 },
    ],
    blockRadiusDeg: 0.2,
  };

  test('denies a blocked city by name even though it is inside Texas', async () => {
    mockedAxios.get.mockResolvedValue({ status: 200, data: BLOCKED });
    const out = await checkWeatherScope({ city_name: 'Dallas, TX' }, 'http://bff/flag', 'secret');
    expect(out.denied).toBe(true);
    expect(out.message).toMatch(/Dallas, TX/);
  });

  test('denies a blocked city by the coordinates the agent resolved', async () => {
    mockedAxios.get.mockResolvedValue({ status: 200, data: BLOCKED });
    const out = await checkWeatherScope({ latitude: 32.7763, longitude: -96.7969 }, 'http://bff/flag', 'secret');
    expect(out.denied).toBe(true);
    expect(out.message).toMatch(/Dallas, TX/);
  });

  test('permits a city that is on nobody list — this mode is not a Texas allowlist', async () => {
    mockedAxios.get.mockResolvedValue({ status: 200, data: BLOCKED });
    const out = await checkWeatherScope({ city_name: 'Chicago, IL' }, 'http://bff/flag', 'secret');
    expect(out.denied).toBe(false);
  });

  test('a differently-qualified same-name city is still permitted', async () => {
    mockedAxios.get.mockResolvedValue({ status: 200, data: BLOCKED });
    const out = await checkWeatherScope({ city_name: 'Miami, OH' }, 'http://bff/flag', 'secret');
    expect(out.denied).toBe(false);
  });

  test('drops a half-populated entry rather than degrading the deny to name-only', async () => {
    mockedAxios.get.mockResolvedValue({
      status: 200,
      data: { ...BLOCKED, blockedCities: [{ label: 'Dallas, TX', lat: null, lon: null }] },
    });
    const out = await checkWeatherScope({ city_name: 'Dallas, TX' }, 'http://bff/flag', 'secret');
    expect(out.denied).toBe(false);
  });
});

describe('checkBraveScope', () => {
  beforeEach(() => jest.clearAllMocks());

  test('permits a benign query', async () => {
    mockedAxios.get.mockResolvedValue({ status: 200, data: { enabled: true } });
    const out = await checkBraveScope({ query: 'weather in Austin' }, 'http://bff/flag', 'secret');
    expect(out.denied).toBe(false);
  });

  test('denies a query containing a blocked term (case-insensitive)', async () => {
    mockedAxios.get.mockResolvedValue({ status: 200, data: { enabled: true } });
    const out = await checkBraveScope({ query: 'Bitcoin price today' }, 'http://bff/flag', 'secret');
    expect(out.denied).toBe(true);
    expect(out.message).toMatch(/blocked term/);
  });

  test('denies outright when ff_brave_mcp_showcase is disabled', async () => {
    mockedAxios.get.mockResolvedValue({ status: 200, data: { enabled: false } });
    const out = await checkBraveScope({ query: 'weather in Austin' }, 'http://bff/flag', 'secret');
    expect(out.denied).toBe(true);
    expect(out.message).toMatch(/disabled/);
  });

  test('fails open on enabled when the BFF flag fetch errors, blocklist still enforced', async () => {
    mockedAxios.get.mockRejectedValue(new Error('ECONNREFUSED'));
    const permit = await checkBraveScope({ query: 'weather in Austin' }, 'http://bff/flag', 'secret');
    expect(permit.denied).toBe(false);
    const deny = await checkBraveScope({ query: 'cryptocurrency news' }, 'http://bff/flag', 'secret');
    expect(deny.denied).toBe(true);
  });
});
