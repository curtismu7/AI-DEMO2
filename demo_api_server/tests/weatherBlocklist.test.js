'use strict';
/**
 * The blocked-city list behind the weather-mcp 'any-except-blocked' mode.
 *
 * The load-bearing property is that every stored entry carries COORDINATES: the
 * gateway blocks a demo chip by `city_name` but a typed prompt arrives as
 * latitude/longitude (the agent resolves the name via search_location first).
 * An entry without coordinates silently degrades the deny to name-only, which
 * passes scripted chips and then fails on the first typed city — so the tests
 * that matter here are the ones that go RED if coordinates stop being required.
 */
const configStore = require('../services/configStore');
const blocklist = require('../services/weatherBlocklist');

const { STORE_KEY, SEED, getBlockedCities, geocodeCity, addCity, removeCity } = blocklist;

/** A Nominatim reply for one place. */
function geocoderReturning(rows) {
  return jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => rows,
  });
}

describe('weather blocklist store', () => {
  let stored;

  beforeEach(() => {
    stored = undefined;
    jest.spyOn(configStore, 'getEffective').mockImplementation((key) =>
      key === STORE_KEY ? stored : undefined,
    );
    jest.spyOn(configStore, 'setRaw').mockImplementation(async (obj) => {
      stored = obj[STORE_KEY];
    });
  });

  afterEach(() => jest.restoreAllMocks());

  test('unset falls back to the shipped Miami seed', () => {
    expect(getBlockedCities()).toEqual(SEED);
  });

  test('an empty list is honoured, NOT re-seeded', () => {
    // Removing the last city must stay removed. Re-seeding here would make the
    // control look broken: the admin deletes Miami and it reappears.
    stored = '[]';
    expect(getBlockedCities()).toEqual([]);
  });

  test('entries missing coordinates are dropped, not stored name-only', () => {
    stored = JSON.stringify([
      { label: 'Good, TX', lat: 30.1, lon: -97.7 },
      { label: 'NoCoords, CA' },
      { label: 'Bad, NY', lat: 'not-a-number', lon: -74 },
    ]);
    expect(getBlockedCities()).toEqual([{ label: 'Good, TX', lat: 30.1, lon: -97.7 }]);
  });

  test('unparseable stored JSON falls back to the seed rather than throwing', () => {
    stored = 'not json at all';
    expect(getBlockedCities()).toEqual(SEED);
  });
});

describe('geocodeCity', () => {
  test('stores the admin wording as the label, not Nominatim\'s postal address', async () => {
    // The gateway matches the TYPED city name against the label. Nominatim's
    // display_name is a full address ("Denver, Denver County, Colorado, United
    // States") and would never match what a user types.
    const fetchImpl = geocoderReturning([
      { lat: '39.7392', lon: '-104.9903', display_name: 'Denver, Denver County, Colorado, United States' },
    ]);
    const entry = await geocodeCity('Denver, CO', { fetchImpl });
    expect(entry).toEqual({ label: 'Denver, CO', lat: 39.7392, lon: -104.9903 });
  });

  test('sends a User-Agent — Nominatim rejects requests without one', async () => {
    const fetchImpl = geocoderReturning([{ lat: '1', lon: '2' }]);
    await geocodeCity('Anywhere', { fetchImpl });
    const [, opts] = fetchImpl.mock.calls[0];
    expect(opts.headers['User-Agent']).toBeTruthy();
  });

  test('404 when the geocoder matches nothing', async () => {
    const fetchImpl = geocoderReturning([]);
    await expect(geocodeCity('Zzzzz Not A Place', { fetchImpl })).rejects.toMatchObject({
      status: 404,
    });
  });

  test('502 when the geocoder is unreachable — a typo and an outage are different problems', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(geocodeCity('Denver, CO', { fetchImpl })).rejects.toMatchObject({
      status: 502,
    });
  });
});

describe('add / remove', () => {
  let stored;

  beforeEach(() => {
    stored = '[]';
    jest.spyOn(configStore, 'getEffective').mockImplementation((key) =>
      key === STORE_KEY ? stored : undefined,
    );
    jest.spyOn(configStore, 'setRaw').mockImplementation(async (obj) => {
      stored = obj[STORE_KEY];
    });
  });

  afterEach(() => jest.restoreAllMocks());

  test('add persists the geocoded coordinates', async () => {
    const fetchImpl = geocoderReturning([{ lat: '39.7392', lon: '-104.9903' }]);
    const { list } = await addCity('Denver, CO', { fetchImpl });
    expect(list).toEqual([{ label: 'Denver, CO', lat: 39.7392, lon: -104.9903 }]);
    expect(JSON.parse(stored)).toHaveLength(1);
  });

  test('adding the same city twice does not duplicate it', async () => {
    const fetchImpl = geocoderReturning([{ lat: '39.7392', lon: '-104.9903' }]);
    await addCity('Denver, CO', { fetchImpl });
    const { list, added } = await addCity('  denver, co  ', { fetchImpl });
    expect(list).toHaveLength(1);
    expect(added).toBeNull();
  });

  test('remove is case-insensitive and reports a miss', async () => {
    const fetchImpl = geocoderReturning([{ lat: '39.7392', lon: '-104.9903' }]);
    await addCity('Denver, CO', { fetchImpl });

    const miss = await removeCity('Nowhere, ZZ');
    expect(miss.removed).toBe(false);

    const hit = await removeCity('DENVER, co');
    expect(hit.removed).toBe(true);
    expect(hit.list).toEqual([]);
  });
});
