/**
 * pingoneClientSecretPreflight — boot-time client-secret drift detector.
 *
 * Compares the STORED admin/user login client secrets against what PingOne
 * reports (GET /applications/{id}/secret via the worker token). Catches a
 * rotation done server-side that configStore never saw. Axios is mocked with
 * an explicit factory; jest.resetModules in beforeEach gives each test a fresh
 * configStore so cache entries cannot leak between tests.
 */
'use strict';

jest.mock('axios', () => {
  const post = jest.fn();
  const get = jest.fn();
  return { __esModule: true, default: { post, get }, post, get, __mock: { post, get } };
});

function freshEnv() {
  process.env.PINGONE_ENVIRONMENT_ID = 'env-123';
  process.env.PINGONE_WORKER_CLIENT_ID = 'worker-id';
  process.env.PINGONE_WORKER_CLIENT_SECRET = 'worker-secret';
  process.env.PINGONE_ADMIN_CLIENT_ID = 'admin-app-id';
  process.env.PINGONE_USER_CLIENT_ID = 'user-app-id';
  process.env.PINGONE_CLIENT_SECRET_PREFLIGHT = 'true';
}

function mockResponses({ secret = 'current-pingone-secret', secretStatus = 200, appExists = true } = {}) {
  const { __mock } = require('axios');
  __mock.post.mockResolvedValue({ data: { access_token: 'worker-token' } });
  __mock.get.mockImplementation(async (url) => {
    if (String(url).includes('/secret')) {
      if (!appExists) throw Object.assign(new Error('not found'), { response: { status: 404, data: {} } });
      if (secretStatus !== 200) throw Object.assign(new Error('denied'), { response: { status: secretStatus, data: {} } });
      return { data: { secret } };
    }
    return { data: {} };
  });
}

describe('runClientSecretPreflight', () => {
  beforeEach(() => {
    jest.resetModules();
    freshEnv();
  });

  afterEach(() => {
    delete process.env.PINGONE_ENVIRONMENT_ID;
    delete process.env.PINGONE_WORKER_CLIENT_ID;
    delete process.env.PINGONE_WORKER_CLIENT_SECRET;
    delete process.env.PINGONE_ADMIN_CLIENT_ID;
    delete process.env.PINGONE_USER_CLIENT_ID;
    delete process.env.PINGONE_CLIENT_SECRET_PREFLIGHT;
  });

  async function bootStore(cache) {
    const configStore = require('../services/configStore');
    await configStore.setRaw(cache, { persist: false });
    const { runClientSecretPreflight } = require('../services/pingoneClientSecretPreflight');
    return runClientSecretPreflight;
  }

  it('is healthy when stored secrets match PingOne', async () => {
    const run = await bootStore({ admin_client_secret: 'current-pingone-secret', user_client_secret: 'current-pingone-secret' });
    mockResponses();
    const result = await run();
    expect(result).toMatchObject({ ok: true, code: 'healthy' });
  });

  it('reports secret_drift when the stored admin secret is stale', async () => {
    const run = await bootStore({ admin_client_secret: 'stale-rotated-away', user_client_secret: 'current-pingone-secret' });
    mockResponses();
    const result = await run();
    expect(result).toMatchObject({ ok: false, code: 'secret_drift' });
    expect(result.fatal).toBe(false); // warn-and-continue by default
  });

  it('skips clients whose id or stored secret is not configured', async () => {
    const run = await bootStore({});
    mockResponses();
    const result = await run();
    expect(result).toMatchObject({ ok: true, code: 'healthy' });
    const { __mock } = require('axios');
    expect(__mock.get).not.toHaveBeenCalled();
  });

  it('treats a 404 app (stale client id) as a mismatch', async () => {
    const run = await bootStore({ admin_client_secret: 'whatever' });
    mockResponses({ appExists: false });
    const result = await run();
    expect(result).toMatchObject({ ok: false, code: 'secret_drift' });
  });

  it('stays healthy when the worker lacks secret-read (403) — cannot check, not a mismatch', async () => {
    const run = await bootStore({ admin_client_secret: 'anything' });
    mockResponses({ secretStatus: 403 });
    const result = await run();
    expect(result).toMatchObject({ ok: true, code: 'healthy' });
  });

  it('stays non-fatal on a transient network error reading the secret', async () => {
    const run = await bootStore({ admin_client_secret: 'anything' });
    const { __mock } = require('axios');
    __mock.post.mockResolvedValue({ data: { access_token: 'worker-token' } });
    __mock.get.mockRejectedValue(new Error('socket hang up'));
    const result = await run();
    expect(result).toMatchObject({ ok: true, code: 'healthy' });
  });

  it('respects the disable flag', async () => {
    process.env.PINGONE_CLIENT_SECRET_PREFLIGHT = 'false';
    const run = await bootStore({});
    const result = await run();
    expect(result).toMatchObject({ ok: true, code: 'disabled', skipped: true });
    const { __mock } = require('axios');
    expect(__mock.post).not.toHaveBeenCalled();
  });
});
