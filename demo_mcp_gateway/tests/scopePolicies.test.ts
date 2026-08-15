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
