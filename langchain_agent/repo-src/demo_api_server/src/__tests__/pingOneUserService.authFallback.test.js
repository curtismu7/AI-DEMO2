/**
 * pingOneUserService.getAccessToken — auth-method self-heal.
 * A stale pingone_mgmt_token_auth_method='post' against a client_secret_basic worker app
 * must not wedge the worker token: it should retry with 'basic' on invalid_client.
 */
'use strict';

jest.mock('axios', () => ({ post: jest.fn() }));
jest.mock('../../services/oauthEndpointResolver', () => ({ getTokenEndpoint: () => 'https://auth.example/as/token' }));
jest.mock('../../services/configStore', () => ({ getEffective: jest.fn() }));
jest.mock('../../utils/logger', () => ({
  logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() },
  LOG_CATEGORIES: { USER_MANAGEMENT: 'user' },
}));

const axios = require('axios');
const configStore = require('../../services/configStore');
const svc = require('../../services/pingOneUserService');

const invalidClient = { response: { status: 401, data: { error: 'invalid_client' } } };

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.PINGONE_WORKER_TOKEN_AUTH_METHOD;
  svc.workerAppClientId = 'cid';
  svc.workerAppClientSecret = 'sec';
  svc.environmentId = 'env';
  svc.accessToken = null;
  svc.tokenExpiry = null;
});

test("configured 'post' but app is basic → falls back to basic and succeeds", async () => {
  configStore.getEffective.mockImplementation((k) => (k === 'pingone_mgmt_token_auth_method' ? 'post' : null));
  axios.post.mockImplementation((url, body, cfg) => {
    // post method puts the secret in the body; basic uses axiosConfig.auth
    if (cfg.auth) return Promise.resolve({ data: { access_token: 'TOKEN', expires_in: 300 } });
    return Promise.reject(invalidClient);
  });

  const tok = await svc.getAccessToken();
  expect(tok).toBe('TOKEN');
  expect(axios.post).toHaveBeenCalledTimes(2); // post (rejected) → basic (ok)
  // first attempt carried the secret in the body (post), second used Basic auth
  expect(axios.post.mock.calls[0][1]).toContain('client_secret=');
  expect(axios.post.mock.calls[1][2].auth).toEqual({ username: 'cid', password: 'sec' });
});

test('basic works first try → no fallback, secret never in body', async () => {
  configStore.getEffective.mockReturnValue(null); // default basic
  axios.post.mockResolvedValue({ data: { access_token: 'TOKEN', expires_in: 300 } });

  const tok = await svc.getAccessToken();
  expect(tok).toBe('TOKEN');
  expect(axios.post).toHaveBeenCalledTimes(1);
  expect(axios.post.mock.calls[0][1]).not.toContain('client_secret=');
});

test('non-auth error (e.g. 500) is not retried', async () => {
  configStore.getEffective.mockReturnValue(null);
  axios.post.mockRejectedValue({ response: { status: 500, data: {} } });
  await expect(svc.getAccessToken()).rejects.toBeDefined();
  expect(axios.post).toHaveBeenCalledTimes(1);
});
