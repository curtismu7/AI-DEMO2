'use strict';

const express = require('express');
const request = require('supertest');
const crypto = require('crypto');

jest.mock('../../middleware/auth', () => ({
  authenticateToken: (req, res, next) => {
    if (!req.get('x-test-role')) return res.status(401).json({ error: 'Authentication required' });
    req.user = { role: req.get('x-test-role') };
    next();
  },
  requireAdmin: (req, res, next) => req.user.role === 'admin'
    ? next() : res.status(403).json({ error: 'Administrator required' }),
}));
jest.mock('../../services/configStore', () => ({ getVaultValue: jest.fn(), setRaw: jest.fn(), getEffective: jest.fn(() => { throw new Error('Forbidden fallback'); }) }));
jest.mock('../../lib/vault', () => ({ openVault: jest.fn() }));
jest.mock('../../services/vaultLoader', () => ({ DEFAULT_VAULT_PATH: '/synthetic/server/secrets.vault' }));
jest.mock('../../services/apiCallTrackerService', () => ({ registerCall: jest.fn(() => { throw new Error('Forbidden tracker'); }) }));
jest.mock('../../services/privilegeUserApiKeyVaultService', () => {
  const actual = jest.requireActual('../../services/privilegeUserApiKeyVaultService');
  return { ...actual, savePrivilegeUserApiCredentials: jest.fn(actual.savePrivilegeUserApiCredentials) };
});
jest.mock('../../services/privilegeUserApiKeyService', () => {
  const actual = jest.requireActual('../../services/privilegeUserApiKeyService');
  return { ...actual, runPrivilegeUserApiKeyFlow: jest.fn(actual.runPrivilegeUserApiKeyFlow) };
});

const configStore = require('../../services/configStore');
const vaultLib = require('../../lib/vault');
const vaultService = require('../../services/privilegeUserApiKeyVaultService');
const flowService = require('../../services/privilegeUserApiKeyService');
const tracker = require('../../services/apiCallTrackerService');
const app = express();
app.use(express.json());
app.use('/api/privilege-user-api-keys', require('../../routes/privilegeUserApiKeys'));

const prefix = '/api/privilege-user-api-keys';
const ids = { environment_id: '11111111-2222-3333-4444-555555555555', user_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' };
const apiKey = 'synthetic-api-key-sentinel';
const apiSecret = 'synthetic-api-secret-sentinel';
const password = 'synthetic-password-sentinel';
const jwt = 'synthetic.header.signature-sentinel';
let values;
let vault;
let fetchStub;
let encryptedResponse;
const originalFetch = globalThis.fetch;
const originalPath = process.env.VAULT_PATH;
const originalBase = process.env.PRIVILEGE_USER_API_BASE_URL;

function post(endpoint, body, csrf = '1', role = 'admin') {
  const req = request(app).post(`${prefix}/${endpoint}`).set('x-test-role', role);
  if (csrf !== undefined) req.set('x-privilege-user-api-csrf', csrf);
  return req.send(body);
}

function assertSafe(body) {
  const text = JSON.stringify(body);
  for (const secret of [apiKey, apiSecret, password, jwt, encryptedResponse, 'Bearer ', 'raw-error-sentinel']) {
    if (secret) expect(text).not.toContain(secret);
  }
  expect(configStore.getEffective).not.toHaveBeenCalled();
  expect(tracker.registerCall).not.toHaveBeenCalled();
}

beforeEach(() => {
  delete process.env.VAULT_PATH;
  process.env.PRIVILEGE_USER_API_BASE_URL = 'https://synthetic-controller.example';
  values = { PRIVILEGE_USER_API_KEY: apiKey, PRIVILEGE_USER_API_SECRET: apiSecret };
  configStore.getVaultValue.mockImplementation(name => values[name]);
  configStore.setRaw.mockImplementation(async updates => Object.assign(values, updates));
  vault = { set: jest.fn(), save: jest.fn().mockResolvedValue(undefined), close: jest.fn() };
  vaultLib.openVault.mockResolvedValue(vault);
  vaultService.savePrivilegeUserApiCredentials.mockImplementation(jest.requireActual('../../services/privilegeUserApiKeyVaultService').savePrivilegeUserApiCredentials);
  flowService.runPrivilegeUserApiKeyFlow.mockImplementation(jest.requireActual('../../services/privilegeUserApiKeyService').runPrivilegeUserApiKeyFlow);
  encryptedResponse = '';
  fetchStub = jest.fn().mockRejectedValue(new Error('Unexpected synthetic request'));
  globalThis.fetch = fetchStub;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  if (originalPath === undefined) delete process.env.VAULT_PATH; else process.env.VAULT_PATH = originalPath;
  if (originalBase === undefined) delete process.env.PRIVILEGE_USER_API_BASE_URL; else process.env.PRIVILEGE_USER_API_BASE_URL = originalBase;
});

describe('fixed-purpose authenticated administrator routes', () => {
  test.each([['post', 'credentials'], ['post', 'run']])('%s %s rejects anonymous and non-admin callers', async (method, endpoint) => {
    expect((await request(app)[method](`${prefix}/${endpoint}`).send({})).status).toBe(401);
    expect((await request(app)[method](`${prefix}/${endpoint}`).set('x-test-role', 'customer').send({})).status).toBe(403);
    expect(vaultLib.openVault).not.toHaveBeenCalled();
    expect(fetchStub).not.toHaveBeenCalled();
  });

  test.each(['credentials', 'run'])('%s requires the exact CSRF header', async endpoint => {
    for (const value of [undefined, '0', 'true']) {
      const req = request(app).post(`${prefix}/${endpoint}`).set('x-test-role', 'admin');
      if (value !== undefined) req.set('x-privilege-user-api-csrf', value);
      expect((await req.send({})).status).toBe(403);
    }
    expect(vaultLib.openVault).not.toHaveBeenCalled();
    expect(fetchStub).not.toHaveBeenCalled();
  });

  test('status returns only masked vault presence and trusted controller URL', async () => {
    const res = await request(app).get(`${prefix}/status?baseUrl=https://attacker.example`).set('x-test-role', 'admin');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ apiKeySet: true, apiSecretSet: true, apiKeyPreview: 'synt••••••••inel', apiSecretPreview: 'synt••••••••inel', missingEntries: [], controllerUrl: 'https://synthetic-controller.example' });
    expect(configStore.getVaultValue.mock.calls.map(call => call[0])).toEqual(['PRIVILEGE_USER_API_KEY', 'PRIVILEGE_USER_API_SECRET']);
    assertSafe(res.body);
    expect(vaultLib.openVault).not.toHaveBeenCalled();
    expect(fetchStub).not.toHaveBeenCalled();
  });

  test('customers can read configured/missing state but never the masked key previews', async () => {
    const res = await request(app).get(`${prefix}/status`).set('x-test-role', 'customer');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ apiKeySet: true, apiSecretSet: true, missingEntries: [], controllerUrl: expect.any(String) });
    expect(res.body).not.toHaveProperty('apiKeyPreview');
    expect(res.body).not.toHaveProperty('apiSecretPreview');
  });

  test('missing status identifies required fixed entry names', async () => {
    values = {};
    const res = await request(app).get(`${prefix}/status`).set('x-test-role', 'admin');
    expect(res.body.missingEntries).toEqual(['PRIVILEGE_USER_API_KEY', 'PRIVILEGE_USER_API_SECRET']);
    expect(res.body.apiKeySet).toBe(false);
    expect(res.body.apiSecretSet).toBe(false);
    assertSafe(res.body);
  });

  test('status uses the approved controller default without browser configuration', async () => {
    delete process.env.PRIVILEGE_USER_API_BASE_URL;
    const res = await request(app).get(`${prefix}/status`).set('x-test-role', 'admin');
    expect(res.body.controllerUrl).toBe('https://privilege.test-one-pingone.com');
    assertSafe(res.body);
  });

  test.each(['vaultPath', 'keyName', 'baseUrl', 'url', 'path', 'method', 'body', 'fetchImpl'])('rejects browser override %s for save and run', async field => {
    for (const [endpoint, body] of [['credentials', { api_key: apiKey, current_password: password }], ['run', ids]]) {
      const res = await post(endpoint, { ...body, [field]: 'attacker-input' });
      expect(res.status).toBe(400);
      assertSafe(res.body);
    }
    expect(vaultLib.openVault).not.toHaveBeenCalled();
    expect(fetchStub).not.toHaveBeenCalled();
  });

  test.each([null, [], 'bad', { api_key: 12 }, { api_secret: {} }, { current_password: [] }])('rejects invalid credential input %j', async body => {
    const res = await post('credentials', body);
    expect(res.status).toBe(400);
    expect(vaultLib.openVault).not.toHaveBeenCalled();
  });

  test.each([{ api_key: '', api_secret: '', current_password: password }, { api_key: ' ', api_secret: ' ', current_password: password }, { api_key: apiKey }])('empty save/password fails before vault or network', async body => {
    const res = await post('credentials', body);
    expect(res.status).toBe(400);
    assertSafe(res.body);
    expect(vaultLib.openVault).not.toHaveBeenCalled();
    expect(fetchStub).not.toHaveBeenCalled();
  });

  test('save writes only fixed credentials with server vault path and returns masked status', async () => {
    process.env.VAULT_PATH = '/synthetic/trusted/override.vault';
    const res = await post('credentials', { api_key: apiKey, api_secret: apiSecret, current_password: password });
    expect(res.status).toBe(200);
    expect(vaultLib.openVault).toHaveBeenCalledWith('/synthetic/trusted/override.vault', password, { caller: 'privilegeUserApiKeyVaultService' });
    expect(vault.set.mock.calls).toEqual([['PRIVILEGE_USER_API_KEY', apiKey], ['PRIVILEGE_USER_API_SECRET', apiSecret]]);
    expect(vault.close).toHaveBeenCalledTimes(1);
    assertSafe(res.body);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  test('save supports an independent replacement and loader default path', async () => {
    const res = await post('credentials', { api_secret: apiSecret, current_password: password });
    expect(res.status).toBe(200);
    expect(vaultLib.openVault.mock.calls[0][0]).toBe('/synthetic/server/secrets.vault');
    expect(vault.set.mock.calls).toEqual([['PRIVILEGE_USER_API_SECRET', apiSecret]]);
  });

  test.each([['VaultAuthError', 401, 'VAULT_AUTH_FAILED'], ['VaultIntegrityError', 401, 'VAULT_AUTH_FAILED'], ['VaultNotFoundError', 404, 'VAULT_NOT_FOUND'], ['Error', 500, 'VAULT_OPEN_FAILED']])('sanitizes %s', async (name, status, code) => {
    vaultLib.openVault.mockRejectedValue(Object.assign(new Error(`raw-error-sentinel ${password}`), { name }));
    const res = await post('credentials', { api_key: apiKey, current_password: password });
    expect(res.status).toBe(status);
    expect(res.body.code).toBe(code);
    assertSafe(res.body);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  test('sanitizes vault write failure and closes the handle', async () => {
    vault.save.mockRejectedValue(new Error(`raw-error-sentinel ${apiSecret}`));
    const res = await post('credentials', { api_key: apiKey, current_password: password });
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('VAULT_SAVE_FAILED');
    expect(configStore.setRaw).not.toHaveBeenCalled();
    expect(vault.close).toHaveBeenCalled();
    assertSafe(res.body);
  });

  test('maps known error codes without trusting supplied error message or HTTP status', async () => {
    vaultService.savePrivilegeUserApiCredentials.mockRejectedValue(Object.assign(new Error(`raw-error-sentinel ${password}`), { code: 'VAULT_AUTH_FAILED', httpStatus: 200 }));
    const res = await post('credentials', { api_key: apiKey, current_password: password });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unable to unlock the vault.');
    assertSafe(res.body);
  });

  test('sanitizes cache refresh failure after saving', async () => {
    configStore.setRaw.mockRejectedValueOnce(new Error(`raw-error-sentinel ${password}`));
    const res = await post('credentials', { api_key: apiKey, current_password: password });
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('VAULT_CACHE_REFRESH_FAILED');
    expect(vault.close).toHaveBeenCalled();
    assertSafe(res.body);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  test.each(['status', 'credentials', 'run'])('sanitizes unexpected %s errors', async endpoint => {
    const error = new Error(`raw-error-sentinel ${apiKey} ${password}`);
    if (endpoint === 'status') configStore.getVaultValue.mockImplementation(() => { throw error; });
    if (endpoint === 'credentials') vaultService.savePrivilegeUserApiCredentials.mockRejectedValue(error);
    if (endpoint === 'run') flowService.runPrivilegeUserApiKeyFlow.mockRejectedValue(error);
    const res = endpoint === 'status'
      ? await request(app).get(`${prefix}/status`).set('x-test-role', 'admin')
      : await post(endpoint, endpoint === 'run' ? ids : { api_key: apiKey, current_password: password });
    expect(res.status).toBe(500);
    assertSafe(res.body);
  });

  test.each(['', 'x', '../users', 'a'.repeat(100), 123, null, '11111111222233334444555555555555'])('rejects noncanonical or unbounded UUID %j before service', async value => {
    for (const field of ['environment_id', 'user_id']) {
      const res = await post('run', { ...ids, [field]: value });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe(field === 'environment_id' ? 'INVALID_ENVIRONMENT_ID' : 'INVALID_USER_ID');
    }
    expect(flowService.runPrivilegeUserApiKeyFlow).not.toHaveBeenCalled();
    expect(fetchStub).not.toHaveBeenCalled();
  });

  test.each(['environment_id', 'user_id'])('requires %s before calling service', async field => {
    const body = { ...ids };
    delete body[field];
    const res = await post('run', body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(field === 'environment_id' ? 'INVALID_ENVIRONMENT_ID' : 'INVALID_USER_ID');
    expect(flowService.runPrivilegeUserApiKeyFlow).not.toHaveBeenCalled();
    expect(fetchStub).not.toHaveBeenCalled();
  });

  test.each(['PRIVILEGE_USER_API_KEY', 'PRIVILEGE_USER_API_SECRET'])('run requires vault-proven credential %s', async name => {
    delete values[name];
    const res = await post('run', ids);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CREDENTIALS_REQUIRED');
    expect(res.body.missingEntries).toEqual([name]);
    expect(flowService.runPrivilegeUserApiKeyFlow).not.toHaveBeenCalled();
    expect(fetchStub).not.toHaveBeenCalled();
  });

  test.each(['token', 'decryption', 'nonce'])('%s failure never requests users and returns sanitized stages', async failure => {
    fetchStub.mockImplementation(async () => {
      if (failure === 'token') return { status: 401, json: jest.fn() };
      if (failure === 'decryption') return { status: 200, json: async () => ({ GuestMetaRes: { EncResData: 'raw-error-sentinel' } }) };
      return tokenResponse('wrong-nonce');
    });
    const res = await post('run', ids);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe({ token: 'UPSTREAM_HTTP_ERROR', decryption: 'DECRYPTION_FAILED', nonce: 'NONCE_MISMATCH' }[failure]);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    assertSafe(res.body);
  });

  test('run returns users and masked JWT, with fixed trusted requests only', async () => {
    fetchStub.mockImplementationOnce(async (_url, options) => {
      const payload = JSON.parse(options.body);
      const raw = Buffer.from(payload.GuestMetaReq.EncReqData, 'base64');
      const material = crypto.pbkdf2Sync(apiSecret, raw.subarray(8, 16), 10000, 48, 'sha256');
      const decipher = crypto.createDecipheriv('aes-256-cbc', material.subarray(0, 32), material.subarray(32));
      const decoded = JSON.parse(Buffer.concat([decipher.update(raw.subarray(16)), decipher.final()]).toString());
      return tokenResponse(decoded.nonce);
    }).mockResolvedValueOnce({ status: 200, json: async () => ({ users: [{ id: 'synthetic-user' }] }) });
    const res = await post('run', ids);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.users).toEqual({ users: [{ id: 'synthetic-user' }] });
    expect(res.body.jwtPreview).toBe('synt****inel');
    expect(res.body.stages.map(stage => stage.status)).toEqual(['success', 'success', 'success', 'success']);
    expect(fetchStub.mock.calls.map(call => [call[0], call[1].method])).toEqual([
      [`https://synthetic-controller.example/pubapi/${ids.environment_id}/v1/appusertoken`, 'POST'],
      [`https://synthetic-controller.example/api/${ids.environment_id}/v1/users`, 'GET'],
    ]);
    expect(flowService.runPrivilegeUserApiKeyFlow.mock.calls[0][0]).toEqual({ environmentId: ids.environment_id, userId: ids.user_id, apiKey, apiSecret });
    assertSafe(res.body);
  });

  test('redacts nested sensitive users fields and echoed credentials while preserving normal JSON', async () => {
    const embeddedJwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.signature';
    const sensitive = {
      api_key: apiKey,
      api_secret: apiSecret,
      jwt,
      authorization: `Bearer ${jwt}`,
      EncReqData: 'synthetic-request-ciphertext',
      enc_res_data: 'synthetic-response-ciphertext',
      encrypted_payload: 'synthetic-encrypted-payload',
    };
    const users = { users: [{ id: 'synthetic-user', name: 'Normal User', enabled: true,
      attributes: { ...sensitive, display: `echo ${apiKey} and ${apiSecret}`, note: `token ${embeddedJwt}`, other: null },
      labels: ['normal', apiKey, apiSecret, { APISecret: apiSecret, status: 'active' }],
    }], count: 1 };
    flowService.runPrivilegeUserApiKeyFlow.mockResolvedValueOnce({ ok: true, stages: [], users, jwtPreview: 'synt****inel' });
    const res = await post('run', ids);
    expect(res.status).toBe(200);
    expect(res.body.users).toEqual({ users: [{ id: 'synthetic-user', name: 'Normal User', enabled: true,
      attributes: { api_key: '[REDACTED]', api_secret: '[REDACTED]', jwt: '[REDACTED]', authorization: '[REDACTED]',
        EncReqData: '[REDACTED]', enc_res_data: '[REDACTED]', encrypted_payload: '[REDACTED]',
        display: 'echo [REDACTED] and [REDACTED]', note: 'token [REDACTED]', other: null },
      labels: ['normal', '[REDACTED]', '[REDACTED]', { APISecret: '[REDACTED]', status: 'active' }],
    }], count: 1 });
    expect(res.body.jwtPreview).toBe('synt****inel');
    for (const value of [...Object.values(sensitive), embeddedJwt]) expect(JSON.stringify(res.body)).not.toContain(value);
    expect(users.users[0].attributes.api_key).toBe(apiKey);
    expect(fetchStub).not.toHaveBeenCalled();
    assertSafe(res.body);
  });

  test('omits credential-bearing property names at every users JSON depth', async () => {
    const users = { [apiKey]: 'key-value', [`prefix-${apiSecret}-suffix`]: 'secret-value',
      users: [{ id: 'synthetic-user', nested: { [apiSecret]: 'secret-value',
        [`prefix-${apiKey}-suffix`]: 'key-value', normal: 'preserved',
        deeper: [{ [apiKey]: 'key-value', [apiSecret]: 'secret-value', count: 2 }],
      } }], status: 'normal' };
    flowService.runPrivilegeUserApiKeyFlow.mockResolvedValueOnce({ ok: true, stages: [], users, jwtPreview: 'synt****inel' });
    const res = await post('run', ids);
    expect(res.status).toBe(200);
    expect(res.body.users).toEqual({ users: [{ id: 'synthetic-user', nested: {
      normal: 'preserved', deeper: [{ count: 2 }],
    } }], status: 'normal' });
    const collectKeys = value => {
      if (Array.isArray(value)) return value.flatMap(collectKeys);
      if (value && typeof value === 'object') return [...Object.keys(value), ...Object.values(value).flatMap(collectKeys)];
      return [];
    };
    for (const key of collectKeys(res.body)) {
      expect(key).not.toContain(apiKey);
      expect(key).not.toContain(apiSecret);
    }
    assertSafe(res.body);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  test('redacts compact JWTs with any valid header encoding in embedded values and property names', async () => {
    const unusualHeader = Buffer.from('{ "alg": "HS256" }').toString('base64url');
    const echoedJwt = `${unusualHeader}.${Buffer.from('{"sub":"synthetic"}').toString('base64url')}.synthetic-signature`;
    flowService.runPrivilegeUserApiKeyFlow.mockResolvedValueOnce({
      ok: true,
      stages: [],
      users: { users: [{ [`jwt-${echoedJwt}-echo`]: `prefix${echoedJwt} suffix`,
        email: 'person@department.pingidentity.com', website: 'https://privilege.test-one-pingone.com/profile',
        username: 'alexander.christopher.smith', note: 'preserved' }] },
      jwtPreview: 'synt****inel',
    });
    const res = await post('run', ids);
    expect(res.status).toBe(200);
    expect(res.body.users).toEqual({ users: [{ email: 'person@department.pingidentity.com',
      website: 'https://privilege.test-one-pingone.com/profile', username: 'alexander.christopher.smith', note: 'preserved' }] });
    expect(JSON.stringify(res.body)).not.toContain(echoedJwt);
    assertSafe(res.body);
  });
});

function tokenResponse(nonce) {
  const salt = Buffer.from('2222222222222222', 'hex');
  const material = crypto.pbkdf2Sync(apiSecret, salt, 10000, 48, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-cbc', material.subarray(0, 32), material.subarray(32));
  encryptedResponse = Buffer.concat([Buffer.from('Salted__'), salt, cipher.update(JSON.stringify({ nonce, jwt })), cipher.final()]).toString('base64');
  return { status: 200, json: async () => ({ GuestMetaRes: { EncResData: encryptedResponse } }) };
}
