/**
 * @file mfaService.test.js
 * Unit tests for mfaService.js — PingOne MFA device authentication and enrollment.
 *
 * All axios calls are mocked. Tests cover:
 *  - _getWorkerToken: basic vs post auth methods
 *  - _getDefaultMfaPolicy: cache, picks default:true, picks first when none flagged
 *  - initiateDeviceAuth: explicit policy, auto-resolve, credential error
 *  - selectDevice, submitOtp, getDeviceAuthStatus, submitFido2Assertion
 *  - listMfaDevices, enrollEmailDevice, initFido2Registration, completeFido2Registration
 *  - _wrapError: 401 → token_expired, 404/410 → challenge_expired
 */

'use strict';

jest.mock('axios');
jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn(),
  ensureInitialized: jest.fn().mockResolvedValue(undefined),
}));

const axios = require('axios');
const configStore = require('../../services/configStore');
const mfaService = require('../../services/mfaService');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setupEnv({ haveWorker = true, havePolicy = false } = {}) {
  process.env.PINGONE_ENVIRONMENT_ID = 'env-test-id';
  process.env.PINGONE_REGION = 'com';
  if (haveWorker) {
    process.env.PINGONE_WORKER_TOKEN_CLIENT_ID = 'worker-cid';
    process.env.PINGONE_WORKER_TOKEN_CLIENT_SECRET = 'worker-sec';
    process.env.PINGONE_WORKER_TOKEN_AUTH_METHOD = 'basic';
  } else {
    delete process.env.PINGONE_WORKER_TOKEN_CLIENT_ID;
    delete process.env.PINGONE_WORKER_TOKEN_CLIENT_SECRET;
  }
  configStore.getEffective.mockImplementation((key) => {
    if (key === 'pingone_environment_id') return 'env-test-id';
    if (key === 'pingone_region') return 'com';
    if (key === 'PINGONE_ENVIRONMENT_ID') return 'env-test-id';
    if (key === 'PINGONE_REGION') return 'com';
    if (key === 'pingone_mfa_policy_id') return havePolicy ? 'policy-123' : '';
    return '';
  });
}

function mockWorkerTokenSuccess(token = 'test-worker-token') {
  axios.post.mockResolvedValueOnce({ data: { access_token: token } });
}

function pingoneError(status, code, message = 'PingOne error') {
  const err = new Error(message);
  err.response = { status, data: { code, message } };
  return err;
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mfaService._resetDefaultPolicyCache();
  setupEnv();
});

afterEach(() => {
  delete process.env.PINGONE_ENVIRONMENT_ID;
  delete process.env.PINGONE_REGION;
  delete process.env.PINGONE_WORKER_TOKEN_CLIENT_ID;
  delete process.env.PINGONE_WORKER_TOKEN_CLIENT_SECRET;
  delete process.env.PINGONE_WORKER_TOKEN_AUTH_METHOD;
});

// ─── _getWorkerToken ──────────────────────────────────────────────────────────

describe('_getWorkerToken (via listMfaDevices)', () => {
  it('uses Basic auth by default and returns a worker token', async () => {
    mockWorkerTokenSuccess('my-worker-token');
    axios.get.mockResolvedValueOnce({ data: { _embedded: { devices: [] } } });

    await mfaService.listMfaDevices('user-1');

    const tokenCall = axios.post.mock.calls[0];
    expect(tokenCall[0]).toBe('https://auth.pingone.com/env-test-id/as/token');
    // Basic auth puts credentials in config.auth, not in body
    expect(tokenCall[2].auth).toEqual({ username: 'worker-cid', password: 'worker-sec' });
    expect(tokenCall[1]).not.toContain('client_secret');
  });

  it('uses POST body auth when PINGONE_WORKER_TOKEN_AUTH_METHOD=post', async () => {
    process.env.PINGONE_WORKER_TOKEN_AUTH_METHOD = 'post';
    mockWorkerTokenSuccess();
    axios.get.mockResolvedValueOnce({ data: { _embedded: { devices: [] } } });

    await mfaService.listMfaDevices('user-1');

    const tokenCall = axios.post.mock.calls[0];
    expect(tokenCall[2].auth).toBeUndefined();
    expect(tokenCall[1]).toContain('client_id=worker-cid');
    expect(tokenCall[1]).toContain('client_secret=worker-sec');
  });

  it('throws when credentials are missing', async () => {
    setupEnv({ haveWorker: false });
    // _getWorkerToken throws before any axios call; _wrapError wraps it with status 500
    const err = await mfaService.listMfaDevices('user-1').catch(e => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(500);
    expect(axios.post).not.toHaveBeenCalled();
  });
});

// ─── _getDefaultMfaPolicy ─────────────────────────────────────────────────────

describe('_getDefaultMfaPolicy (via initiateDeviceAuth when no policy configured)', () => {
  it('fetches mfaPolicies and picks the policy with default:true', async () => {
    setupEnv({ havePolicy: false });
    mockWorkerTokenSuccess();
    // mfaPolicies response
    axios.get.mockResolvedValueOnce({
      data: {
        _embedded: {
          deviceAuthenticationPolicies: [
            { id: 'pol-a', name: 'Custom', default: false },
            { id: 'pol-b', name: 'Default Policy', default: true },
          ],
        },
      },
    });
    // initiateDeviceAuth call
    axios.post.mockResolvedValueOnce({
      data: { id: 'da-1', status: 'DEVICE_SELECTION_REQUIRED', _embedded: { devices: [] } },
    });

    const result = await mfaService.initiateDeviceAuth('user-1', 'user-token');
    expect(result.id).toBe('da-1');

    // The deviceAuthentications POST should use pol-b
    const daCall = axios.post.mock.calls[1];
    expect(daCall[1].policy.id).toBe('pol-b');
  });

  it('falls back to first policy when none has default:true', async () => {
    setupEnv({ havePolicy: false });
    mockWorkerTokenSuccess();
    axios.get.mockResolvedValueOnce({
      data: { _embedded: { deviceAuthenticationPolicies: [{ id: 'pol-only', name: 'Only', default: false }] } },
    });
    axios.post.mockResolvedValueOnce({
      data: { id: 'da-2', status: 'DEVICE_SELECTION_REQUIRED', _embedded: { devices: [] } },
    });

    await mfaService.initiateDeviceAuth('user-1', 'user-token');

    const daCall = axios.post.mock.calls[1];
    expect(daCall[1].policy.id).toBe('pol-only');
  });

  it('throws mfa_not_configured when mfaPolicies is empty', async () => {
    setupEnv({ havePolicy: false });
    mockWorkerTokenSuccess();
    axios.get.mockResolvedValueOnce({ data: { _embedded: { deviceAuthenticationPolicies: [] } } });

    const err = await mfaService.initiateDeviceAuth('user-1', 'user-token').catch(e => e);
    expect(err.code).toBe('mfa_not_configured');
    expect(err.status).toBe(503);
  });

  it('caches the resolved policy ID on second call', async () => {
    setupEnv({ havePolicy: false });
    // First call: worker token + policies
    mockWorkerTokenSuccess();
    axios.get.mockResolvedValueOnce({
      data: { _embedded: { deviceAuthenticationPolicies: [{ id: 'pol-cached', name: 'X', default: true }] } },
    });
    axios.post.mockResolvedValueOnce({
      data: { id: 'da-3', status: 'DEVICE_SELECTION_REQUIRED', _embedded: {} },
    });
    await mfaService.initiateDeviceAuth('user-1', 'user-token');

    // Second call: worker token mint + deviceAuthentications POST, but NO policy
    // fetch (policy id is cached).
    jest.clearAllMocks();
    mockWorkerTokenSuccess();
    axios.post.mockResolvedValueOnce({
      data: { id: 'da-4', status: 'DEVICE_SELECTION_REQUIRED', _embedded: {} },
    });
    await mfaService.initiateDeviceAuth('user-1', 'user-token');

    // axios.post called twice (worker token + deviceAuthentications); axios.get
    // not called (policy resolution was cached).
    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(axios.get).not.toHaveBeenCalled();
  });
});

// ─── initiateDeviceAuth ───────────────────────────────────────────────────────

describe('initiateDeviceAuth', () => {
  it('uses explicit policyId when configured, mints a worker token for the call', async () => {
    setupEnv({ havePolicy: true });
    // deviceAuthentications uses a WORKER token (the user's custom-audience token is
    // rejected by PingOne MFA), so a worker-token mint precedes the deviceAuth POST.
    mockWorkerTokenSuccess();
    axios.post.mockResolvedValueOnce({
      data: { id: 'da-explicit', status: 'DEVICE_SELECTION_REQUIRED', _embedded: { devices: [{ id: 'd1' }] } },
    });

    const result = await mfaService.initiateDeviceAuth('user-1', 'user-token');

    expect(result.id).toBe('da-explicit');
    // Two axios.post calls: worker token mint, then deviceAuthentications. Policy GET skipped.
    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(axios.get).not.toHaveBeenCalled();
    const [url, body] = axios.post.mock.calls[1];
    expect(url).toContain('deviceAuthentications');
    expect(body.policy.id).toBe('policy-123');
    expect(body.user.id).toBe('user-1');
  });

  it('wraps a worker-token 401 as mfa_service_auth_failed (not token_expired)', async () => {
    // deviceAuthentications uses the worker token, so a 401 is a service/credential
    // failure — refreshing the user session would not help, so it must NOT be
    // labeled token_expired (which triggers the route's refresh→session_expired loop).
    setupEnv({ havePolicy: true });
    mockWorkerTokenSuccess();
    axios.post.mockRejectedValueOnce(pingoneError(401, 'INVALID_TOKEN'));

    const err = await mfaService.initiateDeviceAuth('user-1', 'bad-token').catch(e => e);
    expect(err.code).toBe('mfa_service_auth_failed');
    expect(err.status).toBe(401);
  });

  it('wraps 404 as challenge_expired', async () => {
    setupEnv({ havePolicy: true });
    mockWorkerTokenSuccess();
    axios.post.mockRejectedValueOnce(pingoneError(404, 'NOT_FOUND'));

    const err = await mfaService.initiateDeviceAuth('user-1', 'user-token').catch(e => e);
    expect(err.code).toBe('challenge_expired');
  });
});

// ─── initiateOneTimeOtp ───────────────────────────────────────────────────────
// One-time OTP init uses a WORKER token (platform audience), because PingOne's MFA
// API rejects the user's custom-resource-audience token. The user-token arg is ignored.

describe('initiateOneTimeOtp', () => {
  it('POSTs a one-time deviceAuthentication using the WORKER token (ignores the passed user token)', async () => {
    mockWorkerTokenSuccess('one-time-worker-tok'); // axios.post #1 = token endpoint
    axios.post.mockResolvedValueOnce({ data: { id: 'da-ot-1', status: 'OTP_REQUIRED' } }); // #2 = deviceAuthentications

    const result = await mfaService.initiateOneTimeOtp('user-9', 'EMAIL', 'u@example.com', 'IGNORED-user-token');

    expect(result.id).toBe('da-ot-1');
    expect(axios.post).toHaveBeenCalledTimes(2); // worker token fetch + deviceAuthentications
    const [url, body, cfg] = axios.post.mock.calls[1];
    expect(url).toContain('deviceAuthentications');
    expect(cfg.headers.Authorization).toBe('Bearer one-time-worker-tok'); // worker, NOT the user token
    expect(body).toEqual({ user: { id: 'user-9' }, selectedDevice: { oneTime: { type: 'EMAIL', email: 'u@example.com' } } });
  });

  it('SMS delivery sends a phone oneTime body', async () => {
    mockWorkerTokenSuccess('wtok');
    axios.post.mockResolvedValueOnce({ data: { id: 'da-ot-2', status: 'OTP_REQUIRED' } });
    await mfaService.initiateOneTimeOtp('user-9', 'SMS', '+15551234567', 'ignored');
    const [, body] = axios.post.mock.calls[1];
    expect(body.selectedDevice.oneTime).toEqual({ type: 'SMS', phone: '+15551234567' });
  });
});

// ─── selectDevice ─────────────────────────────────────────────────────────────
// selectDevice uses a worker token (axios.post for token) then axios.post for the actual call.

describe('selectDevice', () => {
  it('sends POST to deviceAuthentications/:daId with selectedDevice', async () => {
    setupEnv();
    mockWorkerTokenSuccess();
    axios.post.mockResolvedValueOnce({ data: { id: 'da-1', status: 'OTP_REQUIRED' } });

    const result = await mfaService.selectDevice('da-1', 'dev-1', 'user-token');

    expect(result.status).toBe('OTP_REQUIRED');
    // Second post call is the actual selectDevice request
    const [url, body] = axios.post.mock.calls[1];
    expect(url).toContain('deviceAuthentications/da-1');
    expect(body.device.id).toBe('dev-1'); // service uses { device: { id } } not selectedDevice
  });

  it('wraps 410 as challenge_expired', async () => {
    setupEnv();
    mockWorkerTokenSuccess();
    axios.post.mockRejectedValueOnce(pingoneError(410, 'GONE'));
    const err = await mfaService.selectDevice('da-1', 'dev-1', 'user-token').catch(e => e);
    expect(err.code).toBe('challenge_expired');
  });

  it('wraps a worker-token 401 as mfa_service_auth_failed (not token_expired)', async () => {
    // selectDevice uses the worker token, so a 401 must not be token_expired (which
    // triggers the route's refresh→session_expired loop). See PR #346/#372.
    setupEnv();
    mockWorkerTokenSuccess();
    axios.post.mockRejectedValueOnce(pingoneError(401, 'INVALID_TOKEN'));
    const err = await mfaService.selectDevice('da-1', 'dev-1', 'user-token').catch(e => e);
    expect(err.code).toBe('mfa_service_auth_failed');
  });
});

// ─── submitOtp ────────────────────────────────────────────────────────────────
// submitOtp uses a worker token (not user token) per pingone-mfa skill §3 token rules.
// First axios.post call = worker token grant; second = otp.check.

describe('submitOtp', () => {
  it('sends POST with otp coerced to string', async () => {
    setupEnv();
    mockWorkerTokenSuccess('worker-tok');
    axios.post.mockResolvedValueOnce({ data: { id: 'da-1', status: 'COMPLETED' } });

    const result = await mfaService.submitOtp('da-1', 'dev-1', 123456, null);

    expect(result.status).toBe('COMPLETED');
    const [, body] = axios.post.mock.calls[1]; // calls[0] = worker token grant
    expect(body.otp).toBe('123456');
  });

  it('wraps a worker-token 401 as mfa_service_auth_failed (not token_expired)', async () => {
    // submitOtp uses the worker token, so a 401 is a service/credential failure —
    // it must NOT be token_expired (which triggers the route's refresh→session_expired loop).
    setupEnv();
    mockWorkerTokenSuccess('worker-tok');
    axios.post.mockRejectedValueOnce(pingoneError(401, 'INVALID_TOKEN'));
    const err = await mfaService.submitOtp('da-1', 'dev-1', '000000', null).catch(e => e);
    expect(err.code).toBe('mfa_service_auth_failed');
  });
});

// ─── getDeviceAuthStatus ──────────────────────────────────────────────────────
// getDeviceAuthStatus uses a worker token (axios.post) then axios.get.

describe('getDeviceAuthStatus', () => {
  it('sends GET to deviceAuthentications/:daId using worker token', async () => {
    setupEnv();
    mockWorkerTokenSuccess('worker-tok');
    axios.get.mockResolvedValueOnce({ data: { id: 'da-1', status: 'PUSH_CONFIRMATION_PENDING' } });

    const result = await mfaService.getDeviceAuthStatus('da-1', 'user-token');

    expect(result.status).toBe('PUSH_CONFIRMATION_PENDING');
    const [url, cfg] = axios.get.mock.calls[0];
    expect(url).toContain('deviceAuthentications/da-1');
    expect(cfg.headers.Authorization).toBe('Bearer worker-tok');
  });

  it('wraps a worker-token 401 as mfa_service_auth_failed (not token_expired)', async () => {
    // The GET uses the worker token, so a 401 must not be token_expired (which
    // triggers the status route's refresh→session_expired loop). See PR #346/#372.
    setupEnv();
    mockWorkerTokenSuccess('worker-tok');
    axios.get.mockRejectedValueOnce(pingoneError(401, 'INVALID_TOKEN'));
    const err = await mfaService.getDeviceAuthStatus('da-1', 'user-token').catch(e => e);
    expect(err.code).toBe('mfa_service_auth_failed');
  });
});

// ─── submitFido2Assertion ─────────────────────────────────────────────────────

describe('submitFido2Assertion', () => {
  it('sends POST with assertion payload', async () => {
    axios.post.mockResolvedValueOnce({ data: { id: 'da-1', status: 'COMPLETED' } });
    const assertion = { id: 'cred-id', response: { clientDataJSON: 'abc', authenticatorData: 'def', signature: 'ghi' } };

    const result = await mfaService.submitFido2Assertion('da-1', assertion, 'user-token');

    expect(result.status).toBe('COMPLETED');
    const lastCall = axios.post.mock.calls[axios.post.mock.calls.length - 1];
    expect(JSON.parse(lastCall[1].assertion)).toEqual(assertion);
  });
});

// ─── listMfaDevices ───────────────────────────────────────────────────────────

describe('listMfaDevices', () => {
  it('returns devices array from _embedded.devices', async () => {
    mockWorkerTokenSuccess();
    const devices = [{ id: 'd1', type: 'EMAIL', status: 'ACTIVE' }];
    axios.get.mockResolvedValueOnce({ data: { _embedded: { devices } } });

    const result = await mfaService.listMfaDevices('user-1');

    expect(result.devices).toEqual(devices);
    const [url] = axios.get.mock.calls[0];
    expect(url).toContain('users/user-1/devices');
    expect(url).toContain('status eq "ACTIVE"');
  });

  it('returns empty array when _embedded is absent', async () => {
    mockWorkerTokenSuccess();
    axios.get.mockResolvedValueOnce({ data: {} });

    const result = await mfaService.listMfaDevices('user-1');
    expect(Array.isArray(result.devices)).toBe(true);
    expect(result.devices.length).toBe(0);
  });
});

// ─── enrollEmailDevice ────────────────────────────────────────────────────────

describe('enrollEmailDevice', () => {
  it('posts EMAIL device to /users/:userId/devices', async () => {
    mockWorkerTokenSuccess();
    axios.post.mockResolvedValueOnce({ data: { id: 'dev-new', type: 'EMAIL', email: 'test@bank.com', status: 'ACTIVE' } });

    const result = await mfaService.enrollEmailDevice('user-1', 'test@bank.com');

    expect(result.id).toBe('dev-new');
    const [url, body] = axios.post.mock.calls[1]; // [0] is worker token
    expect(url).toContain('users/user-1/devices');
    expect(body).toEqual({ type: 'EMAIL', email: 'test@bank.com' });
  });
});

// ─── initFido2Registration ────────────────────────────────────────────────────

describe('initFido2Registration', () => {
  it('posts FIDO2 to /devices and returns deviceId + creationOptions', async () => {
    mockWorkerTokenSuccess();
    axios.post.mockResolvedValueOnce({
      data: {
        id: 'dev-fido',
        publicKeyCredentialCreationOptions: { challenge: 'abc123' },
      },
    });

    const result = await mfaService.initFido2Registration('user-1');

    expect(result.deviceId).toBe('dev-fido');
    expect(result.publicKeyCredentialCreationOptions).toEqual({ challenge: 'abc123' });
    const [url, body] = axios.post.mock.calls[1];
    expect(url).toContain('users/user-1/devices');
    expect(body.type).toBe('FIDO2');
    expect(body.nickname).toBe('My Passkey');
  });
});

// ─── completeFido2Registration ────────────────────────────────────────────────

describe('completeFido2Registration', () => {
  it('sends POST to /devices/:deviceId with activation content-type and serialized attestation + origin', async () => {
    mockWorkerTokenSuccess();
    // axios.post: [0] = worker token, [1] = device activation
    axios.post.mockResolvedValueOnce({ data: { id: 'dev-fido', status: 'ACTIVE' } });
    const attestation = { id: 'att-id', rawId: 'att-id', type: 'public-key', response: { attestationObject: 'xyz', clientDataJSON: 'abc' } };

    const result = await mfaService.completeFido2Registration('user-1', 'dev-fido', attestation);

    expect(result.status).toBe('ACTIVE');
    // Must be POST (activation), not PUT
    const [url, body, cfg] = axios.post.mock.calls[1];
    expect(url).toContain('users/user-1/devices/dev-fido');
    // Attestation sent as JSON string under 'attestation' key per PingOne activation API contract
    expect(JSON.parse(body.attestation)).toEqual(attestation);
    // origin is resolved from config/env fallbacks when not provided
    expect(typeof body.origin).toBe('string');
    // Correct activation content-type
    expect(cfg.headers['Content-Type']).toBe('application/vnd.pingidentity.device.activate+json');
  });

  it('wraps PingOne error on activation failure', async () => {
    mockWorkerTokenSuccess();
    axios.post.mockRejectedValueOnce(pingoneError(400, 'INVALID_ATTESTATION', 'Attestation verification failed'));
    const attestation = { id: 'bad', rawId: 'bad', type: 'public-key', response: {} };

    const err = await mfaService.completeFido2Registration('user-1', 'dev-fido', attestation).catch(e => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(400);
  });
});

// ─── completeEmailEnrollment ──────────────────────────────────────────────────

describe('completeEmailEnrollment', () => {
  it('PUTs otp to /users/{userId}/devices/{deviceId} with activate content-type', async () => {
    mockWorkerTokenSuccess();
    axios.put.mockResolvedValueOnce({
      data: { id: 'dev-abc', type: 'EMAIL', status: 'ACTIVE' },
    });
    const result = await mfaService.completeEmailEnrollment('user-1', 'dev-abc', '123456');
    expect(axios.put).toHaveBeenCalledWith(
      expect.stringContaining('/users/user-1/devices/dev-abc'),
      { otp: '123456' },
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/vnd.pingidentity.device.activate+json',
        }),
      }),
    );
    expect(result.status).toBe('ACTIVE');
  });

  it('throws a wrapped error when PingOne returns 400', async () => {
    mockWorkerTokenSuccess();
    axios.put.mockRejectedValueOnce(
      Object.assign(new Error('Bad OTP'), { response: { status: 400, data: { code: 'INVALID_OTP', message: 'Invalid OTP provided' } } }),
    );
    const err = await mfaService.completeEmailEnrollment('user-1', 'dev-abc', '000000').catch(e => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(400);
    expect(err.message).toBe('Invalid OTP provided');
  });
});
