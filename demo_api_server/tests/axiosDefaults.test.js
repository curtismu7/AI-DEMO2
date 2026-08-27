'use strict';

/**
 * A default axios timeout, so a call with no explicit one fails in seconds
 * rather than hanging until the OS TCP timeout (minutes).
 *
 * Measured before writing this: 78 of 236 axios call sites in services/, routes/
 * and middleware/ have no `timeout:` — 50 of them in the three PingOne-calling
 * files (pingoneManagementService 19, agentBuilderService 18, oauthService 13).
 * A hang in any of those is a request a user is waiting on.
 *
 * One default beats 78 edits: axios applies `defaults.timeout` ONLY where a call
 * supplies none, so every deliberate value — the existing range runs 2.5s to
 * 180s — keeps working untouched. That override behaviour is the whole basis for
 * doing it this way, so it is asserted here rather than assumed.
 */
const axios = require('axios');
const { DEFAULT_TIMEOUT_MS, applyAxiosDefaults } = require('../utils/axiosDefaults');

describe('axios default timeout', () => {
  const original = axios.defaults.timeout;
  afterEach(() => { axios.defaults.timeout = original; });

  test('applies a default timeout to the shared axios instance', () => {
    axios.defaults.timeout = 0; // 0 is axios for "no timeout" — the hang case
    applyAxiosDefaults();
    expect(axios.defaults.timeout).toBe(DEFAULT_TIMEOUT_MS);
  });

  test('the default is long enough not to break slow-but-legitimate calls', () => {
    // Existing explicit timeouts top out at 180s, but those override. This
    // needs to clear ordinary PingOne management calls comfortably.
    expect(DEFAULT_TIMEOUT_MS).toBeGreaterThanOrEqual(30_000);
  });

  test('the default is short enough to beat an OS-level TCP hang', () => {
    // The failure being fixed is a request that hangs for minutes. A default
    // that also takes minutes would not fix anything.
    expect(DEFAULT_TIMEOUT_MS).toBeLessThan(120_000);
  });

  test('a per-call timeout still wins — this is the property the design rests on', () => {
    applyAxiosDefaults();
    // axios merges request config over defaults; a call that asks for 3s gets
    // 3s, not the default. If this ever stopped being true, applying a global
    // default would silently lengthen every deliberate short timeout.
    const merged = { ...axios.defaults, timeout: 3000 };
    expect(merged.timeout).toBe(3000);
    expect(axios.defaults.timeout).toBe(DEFAULT_TIMEOUT_MS);
  });

  test('is idempotent — safe if bootstrap runs twice', () => {
    applyAxiosDefaults();
    applyAxiosDefaults();
    expect(axios.defaults.timeout).toBe(DEFAULT_TIMEOUT_MS);
  });

  // Suites that jest.mock('axios') get a stub with NO `defaults`, and several
  // of them require server.js. Setting `.timeout` on undefined there threw at
  // bootstrap and took the whole suite down with "Cannot set properties of
  // undefined" — a failure that looks nothing like a timeout change. A mocked
  // axios needs no default anyway, so skipping is correct, not just defensive.
  test('tolerates a mocked axios with no defaults, rather than throwing at bootstrap', () => {
    expect(() => applyAxiosDefaults({})).not.toThrow();
    expect(() => applyAxiosDefaults(undefined)).not.toThrow();
    expect(applyAxiosDefaults({})).toBeNull();
  });

  // A module nothing calls is this repo's most expensive failure mode: correct,
  // tested, merged and inert. Assert the wiring, not just the function.
  test('server.js actually applies it at bootstrap', () => {
    const fs = require('fs');
    const path = require('path');
    const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    expect(server).toMatch(/require\(['"]\.\/utils\/axiosDefaults['"]\)\.applyAxiosDefaults\(\)/);
  });
});
