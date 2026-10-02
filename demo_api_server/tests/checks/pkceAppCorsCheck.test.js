'use strict';

/**
 * The embedded (pi.flow) sign-in on /sdk-login only completes when the PingOne
 * PKCE app lists the browser origin in corsSettings. With corsSettings null,
 * GET /as/resume answers without Access-Control-Allow-Origin and the failure
 * reads like a bad password (TECH_DEBT 2026-09-14). All HTTP here is mocked.
 */

jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn(),
  getOAuthProvider: jest.fn(() => 'pingone'),
}));

const configStore = require('../../services/configStore');
const { runPkceAppCorsCheck, check } = require('../../services/checks/pkceAppCorsCheck');

const APP_ID = 'app-1234';
const SECRET = 'worker-secret-do-not-leak';
const ENV = {
  PINGONE_ENVIRONMENT_ID: 'env-1',
  PINGONE_WORKER_CLIENT_ID: 'worker-1',
  PINGONE_WORKER_CLIENT_SECRET: SECRET,
};
const KNOWN = ['https://local.ping-devops.com:4000', 'https://api.ping.demo:4000', 'https://ai-demo.ping-devops.com'];

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

/** Token request answers a token; the application GET answers `app`. */
function fetchFor(app, status = 200) {
  return jest.fn(async (url) => (String(url).endsWith('/as/token')
    ? json(200, { access_token: 'mgmt-token-do-not-leak' })
    : json(status, app)));
}

function config(values) {
  configStore.getEffective.mockImplementation((key) => values[key] ?? '');
}

describe('pingone.pkce_app_cors', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    configStore.getOAuthProvider.mockReturnValue('pingone');
    config({ pingone_sdk_demo_client_id: APP_ID });
  });

  test('fails when corsSettings is null, and names the remedy and the app', async () => {
    const fetchImpl = fetchFor({ id: APP_ID, name: 'Demo AI App - PKCE', corsSettings: null });

    const out = await runPkceAppCorsCheck({ env: ENV, fetchImpl });

    expect(out.status).toBe('fail');
    expect(out.detail).toMatch(/corsSettings/);
    expect(out.nextAction).toContain('ALLOW_SPECIFIC_ORIGINS');
    expect(out.nextAction).toContain('Demo AI App - PKCE');
    expect(out.nextAction).toContain(APP_ID);
    for (const origin of KNOWN) expect(out.nextAction).toContain(origin);
  });

  test('reads exactly one application, read-only', async () => {
    const fetchImpl = fetchFor({ id: APP_ID, corsSettings: null });

    await runPkceAppCorsCheck({ env: ENV, fetchImpl });

    const reads = fetchImpl.mock.calls.filter(([url]) => !String(url).endsWith('/as/token'));
    expect(reads).toHaveLength(1);
    expect(reads[0][0]).toBe('https://api.pingone.com/v1/environments/env-1/applications/' + APP_ID);
    expect(reads[0][1].method).toBe('GET');
  });

  test('fails and names the one served origin the list is missing', async () => {
    const fetchImpl = fetchFor({
      id: APP_ID,
      corsSettings: { behavior: 'ALLOW_SPECIFIC_ORIGINS', origins: [KNOWN[0], KNOWN[2]] },
    });

    const out = await runPkceAppCorsCheck({ env: ENV, fetchImpl });

    expect(out.status).toBe('fail');
    expect(out.detail).toContain(KNOWN[1]);
    expect(out.detail).not.toContain(KNOWN[0]);
    expect(out.meta.missing).toEqual([KNOWN[1]]);
  });

  test('passes when every served origin is listed', async () => {
    const fetchImpl = fetchFor({ id: APP_ID, corsSettings: { behavior: 'ALLOW_SPECIFIC_ORIGINS', origins: KNOWN } });

    const out = await runPkceAppCorsCheck({ env: ENV, fetchImpl });

    expect(out.status).toBe('pass');
  });

  test('requires the configured public app URL and CORS_ORIGIN entries too', async () => {
    config({ pingone_sdk_demo_client_id: APP_ID, PUBLIC_APP_URL: 'https://demo.example.com/' });
    const fetchImpl = fetchFor({ id: APP_ID, corsSettings: { behavior: 'ALLOW_SPECIFIC_ORIGINS', origins: KNOWN } });

    const out = await runPkceAppCorsCheck({ env: { ...ENV, CORS_ORIGIN: 'https://other.example.com, ' + KNOWN[0] }, fetchImpl });

    expect(out.status).toBe('fail');
    expect(out.meta.missing).toEqual(['https://demo.example.com', 'https://other.example.com']);
  });

  test('fails when the app rejects every origin (ALLOW_NO_ORIGINS)', async () => {
    const fetchImpl = fetchFor({ id: APP_ID, corsSettings: { behavior: 'ALLOW_NO_ORIGINS' } });

    const out = await runPkceAppCorsCheck({ env: ENV, fetchImpl });

    expect(out.status).toBe('fail');
    expect(out.detail).toContain('ALLOW_NO_ORIGINS');
  });

  test('warns — not fails — when worker credentials are not configured, naming which', async () => {
    const fetchImpl = jest.fn();

    const out = await runPkceAppCorsCheck({ env: { PINGONE_ENVIRONMENT_ID: 'env-1' }, fetchImpl });

    expect(out.status).toBe('warn');
    expect(out.detail).toContain('PINGONE_WORKER_CLIENT_ID');
    expect(out.detail).toContain('PINGONE_WORKER_CLIENT_SECRET');
    expect(out.detail).not.toContain('PINGONE_ENVIRONMENT_ID');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('warns when the PKCE app id is not configured', async () => {
    config({});
    const fetchImpl = jest.fn();

    const out = await runPkceAppCorsCheck({ env: ENV, fetchImpl });

    expect(out.status).toBe('warn');
    expect(out.detail).toContain('PINGONE_SDK_DEMO_CLIENT_ID');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('an upstream error warns and leaks no credential material', async () => {
    const fetchImpl = jest.fn(async (url) => {
      if (String(url).endsWith('/as/token')) return json(200, { access_token: 'mgmt-token-do-not-leak' });
      const err = new Error('request failed: Authorization: Bearer mgmt-token-do-not-leak secret=' + SECRET);
      err.code = 'ECONNRESET';
      throw err;
    });

    const out = await runPkceAppCorsCheck({ env: ENV, fetchImpl });

    expect(out.status).toBe('warn');
    const text = JSON.stringify(out);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('mgmt-token-do-not-leak');
    // normalizeAxiosError's code for a connection failure — a code, not the message.
    expect(out.detail).toContain('UPSTREAM_UNREACHABLE');
  });

  test('a non-200 application read warns with the status', async () => {
    const out = await runPkceAppCorsCheck({ env: ENV, fetchImpl: fetchFor({ code: 'NOT_FOUND' }, 404) });

    expect(out.status).toBe('warn');
    expect(out.detail).toContain('404');
  });

  test('applies only while PingOne is the active provider', () => {
    expect(check.appliesWhen({})).toBe(true);
    configStore.getOAuthProvider.mockReturnValue('pingfederate');
    expect(check.appliesWhen({})).toBe(false);
  });

  test('is registered through the checks index', () => {
    const { ALL_CHECKS } = require('../../services/checks');
    expect(ALL_CHECKS.map((c) => c.id)).toContain('pingone.pkce_app_cors');
  });
});
