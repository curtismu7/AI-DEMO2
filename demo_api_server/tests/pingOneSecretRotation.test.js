'use strict';

jest.mock('axios');
const axios = require('axios');

// Family 1 has an id but NO secret; family 3 has a matching id+secret pair. That
// is the split that makes resolveWorkerCredentials(false) and (true) name
// DIFFERENT apps — see the isWorkerApp tests at the bottom.
const mockConfig = {
  PINGONE_ENVIRONMENT_ID: 'env-1',
  PINGONE_REGION: 'com',
  PINGONE_WORKER_CLIENT_ID: 'worker-client-id',
  PINGONE_MGMT_CLIENT_ID: 'mgmt-client-id',
  PINGONE_MGMT_CLIENT_SECRET: 'mgmt-secret',
};
jest.mock('../services/configStore', () => ({
  getEffective: (k) => (mockConfig[k] || ''),
}));
jest.mock('../services/pingOneClientService', () => ({
  getManagementToken: jest.fn().mockResolvedValue('tok-abc'),
  WORKER_CREDENTIAL_FAMILIES: [
    ['PINGONE_WORKER_CLIENT_ID', 'PINGONE_WORKER_CLIENT_SECRET'],
    ['PINGONE_WORKER_TOKEN_CLIENT_ID', 'PINGONE_WORKER_TOKEN_CLIENT_SECRET'],
    ['PINGONE_MGMT_CLIENT_ID', 'PINGONE_MGMT_CLIENT_SECRET'],
    ['PINGONE_MANAGEMENT_CLIENT_ID', 'PINGONE_MANAGEMENT_CLIENT_SECRET'],
  ],
}));

const {
  regenerateClientSecret, verifySecret, fingerprint, isWorkerApp,
} = require('../services/pingOneSecretRotation');

describe('pingOneSecretRotation', () => {
  beforeEach(() => jest.clearAllMocks());

  test('regenerate POSTs with the regenerate content-type', async () => {
    axios.post.mockResolvedValue({ data: { secret: 'new-secret-value' } });
    const out = await regenerateClientSecret('app-9');
    expect(out).toBe('new-secret-value');
    const [url, body, cfg] = axios.post.mock.calls[0];
    expect(url).toBe('https://api.pingone.com/v1/environments/env-1/applications/app-9/secret');
    expect(body).toEqual({});
    expect(cfg.headers['Content-Type']).toBe('application/vnd.pingidentity.secret.regenerate+json');
    expect(cfg.headers.Authorization).toBe('Bearer tok-abc');
  });

  test('regenerate throws when PingOne returns no secret', async () => {
    axios.post.mockResolvedValue({ data: {} });
    await expect(regenerateClientSecret('app-9')).rejects.toThrow(/no secret/i);
  });

  test('fingerprint is 8 hex chars and stable', () => {
    expect(fingerprint('abc')).toMatch(/^[0-9a-f]{8}$/);
    expect(fingerprint('abc')).toBe(fingerprint('abc'));
    expect(fingerprint('abc')).not.toBe(fingerprint('abd'));
  });

  test('CLIENT_SECRET_POST sends credentials in the body, not a Basic header', async () => {
    axios.post.mockResolvedValue({ data: { access_token: 't' } });
    const res = await verifySecret(
      { clientId: 'c-1', tokenEndpointAuthMethod: 'CLIENT_SECRET_POST' }, 's-1');
    expect(res.ok).toBe(true);
    const [, body, cfg] = axios.post.mock.calls[0];
    expect(body).toContain('client_secret=s-1');
    expect(cfg.headers.Authorization).toBeUndefined();
  });

  test('invalid_scope counts as a PASS — the credential was accepted', async () => {
    axios.post.mockRejectedValue({ response: { data: { error: 'invalid_scope' } } });
    await expect(verifySecret({ clientId: 'c', tokenEndpointAuthMethod: 'CLIENT_SECRET_BASIC' }, 's'))
      .resolves.toEqual({ ok: true, code: 'invalid_scope' });
  });

  test('invalid_client is a real failure', async () => {
    axios.post.mockRejectedValue({ response: { data: { error: 'invalid_client' } } });
    await expect(verifySecret({ clientId: 'c', tokenEndpointAuthMethod: 'CLIENT_SECRET_BASIC' }, 's'))
      .resolves.toEqual({ ok: false, code: 'invalid_client' });
  });

  test('isWorkerApp matches the configured worker clientId', () => {
    expect(isWorkerApp({ clientId: 'worker-client-id' })).toBe(true);
    expect(isWorkerApp({ clientId: 'something-else' })).toBe(false);
  });

  // I3: resolveWorkerCredentials(false) returns family 1 (id, no secret);
  // getManagementToken's resolveWorkerCredentials(true) skips it and returns
  // family 3. Guarding only the first left the app that actually holds the
  // management token rotatable — the one exclusion this tool exists to enforce.
  test('isWorkerApp guards EVERY credential family, not just the first resolvable one', () => {
    expect(isWorkerApp({ clientId: 'mgmt-client-id' })).toBe(true);
  });
});
