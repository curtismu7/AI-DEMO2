'use strict';

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
jest.mock('../services/configStore', () => ({ getEffective: jest.fn() }));
jest.mock('../services/pingOneClientService', () => ({
  getManagementToken: jest.fn(),
  resolveWorkerCredentials: jest.fn(() => ({ clientId: 'worker-id', clientSecret: 'worker-secret' })),
}));

const axios = require('axios');
const configStore = require('../services/configStore');
const pingOneClientService = require('../services/pingOneClientService');
const verifyService = require('../services/verifyService');

const ENV_ID = 'b64b0000-0000-4000-8000-000000000001';
const POLICY_ID = 'b64b0000-0000-4000-8000-000000000002';
const USER_ID = 'b64b0000-0000-4000-8000-000000000003';
const TRANSACTION_ID = 'b64b0000-0000-4000-8000-000000000004';

describe('verifyService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    configStore.getEffective.mockImplementation((key) => ({
      pingone_environment_id: ENV_ID,
      pingone_region: 'com',
      pingone_verify_policy_id: POLICY_ID,
    })[String(key).toLowerCase()] || '');
    pingOneClientService.getManagementToken.mockResolvedValue('management-token');
  });

  test('creates a user-scoped Verify transaction with only configured policy and fixed redirect data', async () => {
    axios.post.mockResolvedValue({ data: {
      _links: { user: { href: `https://api.pingone.com/v1/environments/${ENV_ID}/users/${USER_ID}` } },
      id: TRANSACTION_ID,
      webVerificationUrl: `https://apps.pingone.com/${ENV_ID}/verify?txnid=${TRANSACTION_ID}`,
      expiresAt: '2026-09-29T23:30:00.000Z',
      transactionStatus: { status: 'REQUESTED' },
    } });

    const result = await verifyService.createTransaction({
      pingOneUserId: USER_ID,
      redirectUrl: 'https://local.ping-devops.com:4000/profile?verify=return',
    });

    expect(axios.post).toHaveBeenCalledWith(
      `https://api.pingone.com/v1/environments/${ENV_ID}/users/${USER_ID}/verifyTransactions`,
      {
        verifyPolicy: { id: POLICY_ID },
        redirect: { url: 'https://local.ping-devops.com:4000/profile?verify=return' },
      },
      expect.objectContaining({
        headers: { Authorization: 'Bearer management-token', 'Content-Type': 'application/json' },
        timeout: 20000,
      }),
    );
    expect(result).toEqual({
      id: TRANSACTION_ID,
      webVerificationUrl: `https://apps.pingone.com/${ENV_ID}/verify?txnid=${TRANSACTION_ID}`,
      expiresAt: '2026-09-29T23:30:00.000Z',
      status: 'REQUESTED',
    });
  });

  test('reads a transaction only through its PingOne user scoped endpoint', async () => {
    axios.get.mockResolvedValue({ data: {
      _links: { user: { href: `https://api.pingone.com/v1/environments/${ENV_ID}/users/${USER_ID}` } },
      id: TRANSACTION_ID,
      transactionStatus: { status: 'SUCCESS' },
      expiresAt: '2026-09-29T23:30:00.000Z',
    } });

    await expect(verifyService.readTransaction({
      pingOneUserId: USER_ID,
      transactionId: TRANSACTION_ID,
    })).resolves.toEqual({ id: TRANSACTION_ID, status: 'SUCCESS', expiresAt: '2026-09-29T23:30:00.000Z' });
    expect(axios.get).toHaveBeenCalledWith(
      `https://api.pingone.com/v1/environments/${ENV_ID}/users/${USER_ID}/verifyTransactions/${TRANSACTION_ID}`,
      expect.objectContaining({ timeout: 20000 }),
    );
  });

  test('does not normalize unknown or manual outcomes into SUCCESS', () => {
    expect(verifyService.normalizeStatus('APPROVED_MANUALLY')).toBe('APPROVED_MANUALLY');
    expect(verifyService.normalizeStatus('NOT_REQUIRED')).toBe('NOT_REQUIRED');
    expect(verifyService.normalizeStatus('future-provider-state')).toBe('UNKNOWN');
  });

  test('missing Verify policy fails before making an upstream request', async () => {
    configStore.getEffective.mockImplementation((key) => ({
      pingone_environment_id: ENV_ID,
      pingone_region: 'com',
    })[String(key).toLowerCase()] || '');

    await expect(verifyService.createTransaction({
      pingOneUserId: USER_ID,
      redirectUrl: 'https://local.ping-devops.com:4000/profile?verify=return',
    })).rejects.toMatchObject({ code: 'VERIFY_NOT_CONFIGURED' });
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('rejects a non-PingOne region before building an upstream URL', async () => {
    configStore.getEffective.mockImplementation((key) => ({
      pingone_environment_id: ENV_ID,
      pingone_region: 'com.attacker.example',
      pingone_verify_policy_id: POLICY_ID,
    })[String(key).toLowerCase()] || '');

    await expect(verifyService.createTransaction({
      pingOneUserId: USER_ID,
      redirectUrl: 'https://local.ping-devops.com:4000/profile?verify=return',
    })).rejects.toMatchObject({ code: 'VERIFY_NOT_CONFIGURED' });
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('propagates provider timeout errors for the route to normalize', async () => {
    axios.post.mockRejectedValue(Object.assign(new Error('provider timed out'), { code: 'ECONNABORTED' }));

    await expect(verifyService.createTransaction({
      pingOneUserId: USER_ID,
      redirectUrl: 'https://local.ping-devops.com:4000/profile?verify=return',
    })).rejects.toMatchObject({ code: 'ECONNABORTED' });
  });

  test('rejects malformed provider responses and wrong user or transaction bindings', async () => {
    axios.post.mockResolvedValue({ data: {
      _links: { user: { href: `https://api.pingone.com/v1/environments/${ENV_ID}/users/${USER_ID}` } },
      id: TRANSACTION_ID,
      transactionStatus: { status: 'SUCCESS' },
    } });
    await expect(verifyService.createTransaction({
      pingOneUserId: USER_ID,
      redirectUrl: 'https://local.ping-devops.com:4000/profile?verify=return',
    })).rejects.toMatchObject({ code: 'VERIFY_INVALID_PROVIDER_RESPONSE' });

    axios.get.mockResolvedValue({ data: {
      _links: { user: { href: `https://api.pingone.com/v1/environments/${ENV_ID}/users/b64b0000-0000-4000-8000-000000000006` } },
      id: TRANSACTION_ID,
      transactionStatus: { status: 'SUCCESS' },
      expiresAt: '2026-09-29T23:30:00.000Z',
    } });
    await expect(verifyService.readTransaction({
      pingOneUserId: USER_ID,
      transactionId: TRANSACTION_ID,
    })).rejects.toMatchObject({ code: 'VERIFY_INVALID_PROVIDER_RESPONSE' });
  });

  test('rejects a Verify handoff URL outside PingOne hosted verification domains', async () => {
    axios.post.mockResolvedValue({ data: {
      _links: { user: { href: `https://api.pingone.com/v1/environments/${ENV_ID}/users/${USER_ID}` } },
      id: TRANSACTION_ID,
      webVerificationUrl: `https://attacker.example/${TRANSACTION_ID}`,
      expiresAt: '2026-09-29T23:30:00.000Z',
      transactionStatus: { status: 'REQUESTED' },
    } });

    await expect(verifyService.createTransaction({
      pingOneUserId: USER_ID,
      redirectUrl: 'https://local.ping-devops.com:4000/profile?verify=return',
    })).rejects.toMatchObject({ code: 'VERIFY_INVALID_PROVIDER_RESPONSE' });
  });
});
