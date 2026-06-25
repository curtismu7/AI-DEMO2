/**
 * pingOneWorkerPreflight — boot-time worker-credential health check.
 * Collapses the management-token failure class into one actionable verdict.
 */
'use strict';

jest.mock('../../services/configStore', () => ({ getEffective: jest.fn() }));
jest.mock('../../services/pingOneClientService', () => ({
  getManagementToken: jest.fn(),
  resolveWorkerCredentials: jest.fn(),
}));
jest.mock('../../services/pingOneUserService', () => ({
  initialize: jest.fn(),
  listUsers: jest.fn(),
}));

const configStore = require('../../services/configStore');
const { getManagementToken, resolveWorkerCredentials } = require('../../services/pingOneClientService');
const pingOneUserService = require('../../services/pingOneUserService');
const { runWorkerTokenPreflight } = require('../../services/pingOneWorkerPreflight');

const httpErr = (status, body) => Object.assign(new Error('http'), { response: { status, data: body } });

beforeEach(() => {
  jest.clearAllMocks();
  configStore.getEffective.mockReturnValue(null); // flags default
  resolveWorkerCredentials.mockReturnValue({ clientId: 'worker-id', clientSecret: 's' });
  getManagementToken.mockResolvedValue('tok');
  pingOneUserService.listUsers.mockResolvedValue({ _embedded: { users: [{ id: 'u1' }] } });
});

test('healthy: token + user read OK', async () => {
  const r = await runWorkerTokenPreflight();
  expect(r).toMatchObject({ ok: true, code: 'healthy' });
  expect(pingOneUserService.initialize).toHaveBeenCalled();
});

test('disabled via PINGONE_WORKER_PREFLIGHT=false → skipped, never calls PingOne', async () => {
  configStore.getEffective.mockImplementation((k) => (k === 'pingone_worker_preflight' ? 'false' : null));
  const r = await runWorkerTokenPreflight();
  expect(r).toMatchObject({ ok: true, skipped: true, code: 'disabled' });
  expect(getManagementToken).not.toHaveBeenCalled();
});

test('no credentials → clean skip (never fatal)', async () => {
  resolveWorkerCredentials.mockReturnValue({ clientId: null, clientSecret: null });
  const r = await runWorkerTokenPreflight();
  expect(r).toMatchObject({ ok: true, skipped: true, code: 'no_credentials' });
  expect(r.fatal).toBeUndefined();
  expect(getManagementToken).not.toHaveBeenCalled();
});

test('grant_type 400 → not ok, classified, fatal only in strict mode', async () => {
  getManagementToken.mockRejectedValue(httpErr(400, { error: 'unauthorized_client', error_description: 'Unsupported grant type: client_credentials' }));
  const r = await runWorkerTokenPreflight();
  expect(r.ok).toBe(false);
  expect(r.code).toBe('grant_type');
  expect(r.fatal).toBe(false);
});

test('grant_type 400 in strict mode → fatal', async () => {
  configStore.getEffective.mockImplementation((k) => (k === 'pingone_preflight_strict' ? 'true' : null));
  getManagementToken.mockRejectedValue(httpErr(400, { error: 'unauthorized_client', error_description: 'Unsupported grant type: client_credentials' }));
  const r = await runWorkerTokenPreflight();
  expect(r).toMatchObject({ ok: false, code: 'grant_type', fatal: true });
});

test('invalid_client → auth code', async () => {
  getManagementToken.mockRejectedValue(httpErr(401, { error: 'invalid_client' }));
  const r = await runWorkerTokenPreflight();
  expect(r.code).toBe('auth');
});

test('network error minting token → unreachable, never fatal even in strict', async () => {
  configStore.getEffective.mockImplementation((k) => (k === 'pingone_preflight_strict' ? 'true' : null));
  getManagementToken.mockRejectedValue(new Error('ECONNRESET')); // no .response
  const r = await runWorkerTokenPreflight();
  expect(r).toMatchObject({ ok: false, code: 'unreachable', fatal: false });
});

test('token OK but user read 403 → role code', async () => {
  pingOneUserService.listUsers.mockRejectedValue(httpErr(403, { error: 'insufficient_scope' }));
  const r = await runWorkerTokenPreflight();
  expect(r.code).toBe('role');
});
