'use strict';
const crypto = require('crypto');
const service = () => require('../../services/privilegeUserApiKeyService');
const environmentId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const apiKey = 'synthetic-api-key';
const apiSecret = 'synthetic-api-secret';
const nonce = '11'.repeat(32);
const jwt = 'header.payload.signature';
// Independent OpenSSL CLI fixtures: Go JSON order, PBKDF2-SHA256/10000,
// synthetic credentials, 8-byte salt = 0x22, AES-256-CBC with PKCS#7.
const requestFixture = 'U2FsdGVkX18iIiIiIiIiImFU248I6V3kVvgVUful+x0KhNopZVGCU72hdiwrM2RzLwNUStCF1ANMngr9nyIYYL6ZBZzeh4yU23ekmpaM1ir9ypJyKHsuaxdF0eTGsLE3y6ahwnoUj8KTHp3StJ+26bKSyafgDsIYpyGKZhYPG0IS4ii0oj+4cF2uuUHdpwkTHbyy+cO4ep71nJ9dYEAAdXsWMvd8nSMh5YUZQDSeWfM=';
const responseFixture = 'U2FsdGVkX18iIiIiIiIiImRd+KRJL7NY9gazoJgYuqMceFdpP4bNIGTHWmBKGrOEYoy3f3AFZ8oLbo7o/mPa8Dh48mPtsTTMG0sw4ayBxjW4MnVk9wzEdY0F1ddPl97UQd6G+h2uorr+asnOtbFJmY+ffZEXr57kaTcldwZiT6AV9MwMM87PLN1r1ZPJO6ku8ZmtYNLghMN5VTykE4M1EQ==';
const options = () => ({ environmentId, userId, apiKey, apiSecret, baseUrl: 'https://privilege.example', now: () => new Date('2026-09-29T12:00:00Z'), randomBytes: size => Buffer.alloc(size, size === 32 ? 0x11 : 0x22) });
const response = (status, body) => ({ status, json: jest.fn().mockResolvedValue(body) });
const tokenResponse = () => response(200, { GuestMetaRes: { EncResData: responseFixture } });
function encryptedResponse(value) {
  const salt = Buffer.alloc(8, 0x22);
  const material = crypto.pbkdf2Sync(apiSecret, salt, 10000, 48, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-cbc', material.subarray(0, 32), material.subarray(32));
  return Buffer.concat([Buffer.from('Salted__'), salt, cipher.update(JSON.stringify(value)), cipher.final()]).toString('base64');
}
function expectSafe(result) {
  const serialized = JSON.stringify(result);
  for (const secret of [apiKey, apiSecret, jwt, requestFixture, responseFixture, 'Authorization', 'RAW-ERROR-SENTINEL']) expect(serialized).not.toContain(secret);
  expect(result).not.toHaveProperty('users');
  expect(result).not.toHaveProperty('jwtPreview');
}

describe('Privilege user API key crypto', () => {
  test('encrypts exactly the independent Go-compatible fixture', () => {
    expect(service().encryptAppUserTokenRequest(options())).toEqual({ nonce, encReqData: requestFixture });
  });
  test('decrypts OpenSSL response and verifies nonce', () => {
    expect(service().decryptAppUserTokenResponse({ encResData: responseFixture, apiSecret, expectedNonce: nonce })).toEqual({ jwt });
  });
  test('supports OpenSSL wrapped base64', () => {
    expect(service().decryptAppUserTokenResponse({ encResData: responseFixture.match(/.{1,64}/g).join('\n'), apiSecret, expectedNonce: nonce })).toEqual({ jwt });
  });
  test.each(['bad!', '', Buffer.from('not an openssl envelope').toString('base64'), responseFixture.slice(0, -8), responseFixture + '!'])('rejects malformed ciphertext (%#)', encResData => {
    expect(() => service().decryptAppUserTokenResponse({ encResData, apiSecret, expectedNonce: nonce })).toThrow('Token response decryption failed');
  });
  test('rejects wrong secret', () => {
    expect(() => service().decryptAppUserTokenResponse({ encResData: responseFixture, apiSecret: 'wrong', expectedNonce: nonce })).toThrow('Token response decryption failed');
  });
  test('rejects mismatched nonce', () => {
    expect(() => service().decryptAppUserTokenResponse({ encResData: responseFixture, apiSecret, expectedNonce: '33'.repeat(32) })).toThrow('Token response nonce did not match');
  });
  test.each([{ jwt: '', nonce }, { jwt: 42, nonce }, { jwt: 'header\r\nInjected: value', nonce }, null])('rejects unusable JWT response (%#)', value => {
    expect(() => service().decryptAppUserTokenResponse({ encResData: encryptedResponse(value), apiSecret, expectedNonce: nonce })).toThrow('Token response decryption failed');
  });
  test('sanitizes injected entropy and clock failures', () => {
    const badEntropy = () => { throw Object.assign(new Error('RAW-ERROR-SENTINEL'), { code: 'RAW-CODE' }); };
    expect(() => service().encryptAppUserTokenRequest({ ...options(), randomBytes: badEntropy })).toThrow('Token request encryption failed');
    expect(() => service().encryptAppUserTokenRequest({ ...options(), now: () => 'invalid' })).toThrow('Token request encryption failed');
  });
  test('creates fresh nonce, timestamp and ciphertext per run', () => {
    const a = service().encryptAppUserTokenRequest({ environmentId, userId, apiKey, apiSecret });
    const b = service().encryptAppUserTokenRequest({ environmentId, userId, apiKey, apiSecret });
    expect(a.nonce).toMatch(/^[a-f0-9]{64}$/);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.encReqData).not.toBe(b.encReqData);
    const raw = Buffer.from(a.encReqData, 'base64');
    expect(raw.subarray(0, 8).toString()).toBe('Salted__');
    const material = crypto.pbkdf2Sync(apiSecret, raw.subarray(8, 16), 10000, 48, 'sha256');
    const decipher = crypto.createDecipheriv('aes-256-cbc', material.subarray(0, 32), material.subarray(32));
    const plain = JSON.parse(Buffer.concat([decipher.update(raw.subarray(16)), decipher.final()]).toString());
    expect(Object.keys(plain)).toEqual(['nonce', 'timestamp', 'apiKey', 'ttl']);
    expect(plain).toMatchObject({ nonce: a.nonce, apiKey, ttl: 3600 });
    expect(plain.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(Math.abs(Date.now() - Date.parse(plain.timestamp))).toBeLessThan(2000);
  });
});

describe('Privilege fixed token and users flow', () => {
  test('issues only PDF requests and returns users plus masked JWT', async () => {
    const users = { Users: [{ ObjectMeta: { Name: 'synthetic-user' } }] };
    const fetchImpl = jest.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(response(200, users));
    const result = await service().runPrivilegeUserApiKeyFlow({ ...options(), fetchImpl, url: 'https://evil.example', path: '/secrets', method: 'DELETE', body: { injected: true } });
    expect(result).toMatchObject({ ok: true, httpStatus: 200, users, stages: [{ stage: 'encryption', status: 'success' }, { stage: 'token-request', status: 'success', httpStatus: 200 }, { stage: 'decryption', status: 'success' }, { stage: 'users-list', status: 'success', httpStatus: 200 }] });
    expect(result.jwtPreview).not.toBe(jwt);
    expect(result.jwtPreview).toContain('****');
    expect(JSON.stringify(result)).not.toContain(jwt);
    const [postUrl, post] = fetchImpl.mock.calls[0];
    const [getUrl, get] = fetchImpl.mock.calls[1];
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(postUrl).toBe(`https://privilege.example/pubapi/${environmentId}/v1/appusertoken`);
    expect(post).toMatchObject({ method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' } });
    expect(JSON.parse(post.body)).toEqual({ ObjectMeta: { Tenant: environmentId, Namespace: 'default', Name: userId }, GuestMetaReq: { APIKey: apiKey, Tenant: environmentId, Namespace: 'default', EncReqData: requestFixture } });
    expect(getUrl).toBe(`https://privilege.example/api/${environmentId}/v1/users`);
    expect(get).toMatchObject({ method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${jwt}` } });
    expect(get).not.toHaveProperty('body');
    for (const request of [post, get]) {
      expect(request.headers['x-procyon-session-id']).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
      expect(request.signal).toBeInstanceOf(AbortSignal);
    }
    expect(post.headers['x-procyon-session-id']).not.toBe(get.headers['x-procyon-session-id']);
  });
  test('redacts JWTs and flow secrets echoed anywhere in user JSON, including keys', async () => {
    const unusualHeader = Buffer.from('{ "alg": "HS256", "typ": "JWT" }').toString('base64url');
    const echoedJwt = `${unusualHeader}.${Buffer.from('{"sub":"synthetic"}').toString('base64url')}.synthetic-signature`;
    const separateJwt = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{}').toString('base64url')}.sig`;
    const echoedCiphertext = encryptedResponse({ jwt: echoedJwt, nonce });
    const users = {
      users: [{
        profile: {
          note: `prefix${echoedJwt} suffix`,
          [`token-${echoedJwt}-label`]: 'remove token-bearing property name',
          [`observed-${separateJwt}-value`]: 'remove another JWT-bearing property name',
          requestPayload: `request:${requestFixture}`,
          nestedData: `response:${echoedCiphertext}`,
          email: 'person@department.pingidentity.com',
          website: 'https://privilege.test-one-pingone.com/profile',
          username: 'alexander.christopher.smith',
          normal: 'preserve this user field',
        },
      }],
    };
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response(200, { GuestMetaRes: { EncResData: echoedCiphertext } }))
      .mockResolvedValueOnce(response(200, users));

    const result = await service().runPrivilegeUserApiKeyFlow({ ...options(), fetchImpl });

    expect(result.ok).toBe(true);
    expect(result.users).toEqual({ users: [{ profile: {
      note: 'prefix[REDACTED] suffix',
      requestPayload: 'request:[REDACTED]',
      nestedData: 'response:[REDACTED]',
      email: 'person@department.pingidentity.com',
      website: 'https://privilege.test-one-pingone.com/profile',
      username: 'alexander.christopher.smith',
      normal: 'preserve this user field',
    } }] });
    const serialized = JSON.stringify(result);
    for (const secret of [echoedJwt, requestFixture, echoedCiphertext, nonce]) expect(serialized).not.toContain(secret);
  });
  test('stops at encryption when entropy fails', async () => {
    const fetchImpl = jest.fn();
    const result = await service().runPrivilegeUserApiKeyFlow({ ...options(), fetchImpl, randomBytes: () => { throw new Error('RAW-ERROR-SENTINEL'); } });
    expect(result).toMatchObject({ ok: false, code: 'ENCRYPTION_FAILED', stages: [{ stage: 'encryption', status: 'error' }] });
    expect(fetchImpl).not.toHaveBeenCalled();
    expectSafe(result);
  });
  test.each(['http://privilege.example', 'https://user:password@privilege.example', 'https://privilege.example/path', 'https://privilege.example?url=other', 'invalid'])('rejects unsafe server base URL (%#)', async baseUrl => {
    const fetchImpl = jest.fn();
    const result = await service().runPrivilegeUserApiKeyFlow({ ...options(), baseUrl, fetchImpl });
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expectSafe(result);
  });
  test.each([{ environmentId: '../evil' }, { userId: 'email@example.com' }, { apiKey: '' }, { apiSecret: '' }, { timeoutMs: 0 }, { timeoutMs: Infinity }, { timeoutMs: 30001 }])('rejects invalid configuration before HTTP (%#)', async overrides => {
    const fetchImpl = jest.fn();
    const result = await service().runPrivilegeUserApiKeyFlow({ ...options(), ...overrides, fetchImpl });
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expectSafe(result);
  });
  test.each([302, 401, 500])('stops after token HTTP %i without reading body', async status => {
    const token = response(status, { raw: `RAW-ERROR-SENTINEL ${apiKey} ${jwt}` });
    const fetchImpl = jest.fn().mockResolvedValue(token);
    const result = await service().runPrivilegeUserApiKeyFlow({ ...options(), fetchImpl });
    expect(result).toMatchObject({ ok: false, httpStatus: status, stages: [{ stage: 'encryption', status: 'success' }, { stage: 'token-request', status: 'error', httpStatus: status }] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(token.json).not.toHaveBeenCalled();
    expectSafe(result);
  });
  test.each([{}, { GuestMetaRes: {} }, { GuestMetaRes: { EncResData: 42 } }])('rejects malformed token response (%#)', async body => {
    const fetchImpl = jest.fn().mockResolvedValue(response(200, body));
    const result = await service().runPrivilegeUserApiKeyFlow({ ...options(), fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.stages.at(-1)).toMatchObject({ stage: 'token-request', status: 'error' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expectSafe(result);
  });
  test.each(['malformed', encryptedResponse({ jwt, nonce: 'wrong' }), encryptedResponse({ jwt: '', nonce })])('stops after decryption failure (%#)', async encResData => {
    const fetchImpl = jest.fn().mockResolvedValue(response(200, { GuestMetaRes: { EncResData: encResData } }));
    const result = await service().runPrivilegeUserApiKeyFlow({ ...options(), fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.stages.at(-1)).toMatchObject({ stage: 'decryption', status: 'error' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expectSafe(result);
  });
  test.each([401, 403, 500])('sanitizes users HTTP %i and skips error body', async status => {
    const users = response(status, { detail: `${jwt} RAW-ERROR-SENTINEL` });
    const fetchImpl = jest.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(users);
    const result = await service().runPrivilegeUserApiKeyFlow({ ...options(), fetchImpl });
    expect(result).toMatchObject({ ok: false, httpStatus: status });
    expect(result.stages.at(-1)).toMatchObject({ stage: 'users-list', status: 'error', httpStatus: status });
    if (status === 401) expect(result.error).toMatch(/rejected the JWT.*expiry.*owning user.*environment.*permissions/i);
    expect(users.json).not.toHaveBeenCalled();
    expectSafe(result);
  });
  test.each(['token-request', 'users-list'])('sanitizes TLS/network errors at %s', async stage => {
    const fetchImpl = jest.fn();
    if (stage === 'users-list') fetchImpl.mockResolvedValueOnce(tokenResponse());
    fetchImpl.mockRejectedValueOnce(Object.assign(new Error(`RAW-ERROR-SENTINEL ${jwt}`), { code: 'CERT_HAS_EXPIRED' }));
    const result = await service().runPrivilegeUserApiKeyFlow({ ...options(), fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.stages.at(-1)).toMatchObject({ stage, status: 'error' });
    expectSafe(result);
  });
  test.each(['token-request', 'users-list'])('bounds %s even when fetch ignores abort', async stage => {
    const fetchImpl = jest.fn();
    if (stage === 'users-list') fetchImpl.mockResolvedValueOnce(tokenResponse());
    fetchImpl.mockImplementationOnce(() => new Promise(() => {}));
    const result = await service().runPrivilegeUserApiKeyFlow({ ...options(), fetchImpl, timeoutMs: 20 });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('timed out');
    expect(result.stages.at(-1)).toMatchObject({ stage, status: 'error' });
    expect(fetchImpl.mock.calls.at(-1)[1].signal.aborted).toBe(true);
    expectSafe(result);
  });
  test.each(['token-request', 'users-list'])('bounds hanging response body at %s', async stage => {
    const fetchImpl = jest.fn();
    if (stage === 'users-list') fetchImpl.mockResolvedValueOnce(tokenResponse());
    fetchImpl.mockResolvedValueOnce({ status: 200, json: () => new Promise(() => {}) });
    const result = await service().runPrivilegeUserApiKeyFlow({ ...options(), fetchImpl, timeoutMs: 20 });
    expect(result.error).toContain('timed out');
    expect(result.stages.at(-1)).toMatchObject({ stage, status: 'error', httpStatus: 200 });
    expectSafe(result);
  });
  test.each(['token-request', 'users-list'])('sanitizes invalid JSON at %s', async stage => {
    const fetchImpl = jest.fn();
    if (stage === 'users-list') fetchImpl.mockResolvedValueOnce(tokenResponse());
    fetchImpl.mockResolvedValueOnce({ status: 200, json: () => { throw new Error(`RAW-ERROR-SENTINEL ${jwt}`); } });
    const result = await service().runPrivilegeUserApiKeyFlow({ ...options(), fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.stages.at(-1)).toMatchObject({ stage, status: 'error' });
    expectSafe(result);
  });
});
