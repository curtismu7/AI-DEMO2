'use strict';

const mockMemory = new Map();
const mockConfig = new Map();
const mockCreateTransaction = jest.fn();
const mockReadTransaction = jest.fn();
const mockGet = jest.fn((id) => mockMemory.get(id) || null);
const mockSave = jest.fn((record) => {
  const saved = { ...(mockMemory.get(record.id) || {}), ...record };
  mockMemory.set(record.id, saved);
  return saved;
});
const mockPruneExpired = jest.fn();

jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, res, next) => req.user ? next() : res.status(401).json({ error: 'authentication_required' }),
}));
jest.mock('../services/configStore', () => ({ getEffective: (key) => mockConfig.get(String(key).toLowerCase()) || '' }));
jest.mock('../services/verifyService', () => ({
  createTransaction: (...args) => mockCreateTransaction(...args),
  readTransaction: (...args) => mockReadTransaction(...args),
  isConfigured: jest.fn(() => true),
}));
jest.mock('../services/lmdb/verifyTransactionStore.lmdb', () => ({
  get: (...args) => mockGet(...args),
  save: (...args) => mockSave(...args),
  pruneExpired: (...args) => mockPruneExpired(...args),
}));
jest.mock('../services/oauthEndpointResolver', () => ({ getPingOneIssuer: () => 'https://auth.pingone.com/env-123/as' }));
jest.mock('../services/oauthRedirectUris', () => ({ getFrontendOrigin: () => 'https://local.ping-devops.com:4000' }));

const express = require('express');
const request = require('supertest');
const verifyRoutes = require('../routes/verify');
const verifyService = require('../services/verifyService');

const USER_ID = 'b64b0000-0000-4000-8000-000000000001';
const OTHER_USER_ID = 'b64b0000-0000-4000-8000-000000000002';
const ISSUER = 'https://auth.pingone.com/env-123/as';
const FUTURE = '2099-01-01T00:00:00.000Z';

function makeApp(user = { id: USER_ID, sub: USER_ID, issuer: ISSUER, role: 'user', userType: 'customer', clientType: 'enduser' }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { if (user) req.user = user; next(); });
  app.use('/api/verify', verifyRoutes);
  return app;
}

function startVerification(app, body = {}) {
  return request(app).post('/api/verify/transactions').set('x-pingone-verify-csrf', '1').send(body);
}

describe('/api/verify', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMemory.clear();
    mockConfig.clear();
    mockConfig.set('pingone_verify_enabled', 'true');
    mockConfig.set('pingone_environment_id', 'env-123');
    mockConfig.set('pingone_region', 'com');
    mockConfig.set('pingone_verify_policy_id', 'policy-456');
    verifyService.isConfigured.mockReturnValue(true);
    mockCreateTransaction.mockResolvedValue({
      id: 'transaction-789',
      webVerificationUrl: 'https://apps.pingone.com/env-123/verify?txnid=transaction-789',
      expiresAt: FUTURE,
      status: 'REQUESTED',
    });
    mockReadTransaction.mockResolvedValue({ id: 'transaction-789', status: 'IN_PROGRESS', expiresAt: FUTURE });
  });

  test('requires authentication and an eligible PingOne customer identity', async () => {
    const unauthenticated = await startVerification(makeApp(null));
    expect(unauthenticated.status).toBe(401);

    const wrongIssuer = await request(makeApp({ id: USER_ID, sub: USER_ID, issuer: 'https://pf.example', userType: 'customer', clientType: 'enduser' }))
      .post('/api/verify/transactions').set('x-pingone-verify-csrf', '1').send({});
    expect(wrongIssuer.status).toBe(403);

    const demoBinding = await request(makeApp({ id: USER_ID, sub: USER_ID, issuer: ISSUER, openAccessDemoBinding: true }))
      .post('/api/verify/transactions').set('x-pingone-verify-csrf', '1').send({});
    expect(demoBinding.status).toBe(403);
    expect(mockCreateTransaction).not.toHaveBeenCalled();
  });

  test('creates a transaction for the authenticated user and persists ownership before returning the handoff', async () => {
    const res = await startVerification(makeApp(), {
      userId: OTHER_USER_ID,
      status: 'SUCCESS',
      redirectUrl: 'https://attacker.example/return',
      requirements: { given_name: { value: 'Untrusted' } },
    });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: 'transaction-789',
      webVerificationUrl: 'https://apps.pingone.com/env-123/verify?txnid=transaction-789',
      expiresAt: FUTURE,
      status: 'REQUESTED',
    });
    expect(mockCreateTransaction).toHaveBeenCalledWith({
      pingOneUserId: USER_ID,
      redirectUrl: 'https://local.ping-devops.com:4000/profile?verify=return',
    });
    expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({
      id: 'transaction-789',
      appUserId: USER_ID,
      pingOneUserId: USER_ID,
      status: 'REQUESTED',
      verifiedAt: null,
    }));
    expect(JSON.stringify(res.body)).not.toContain('Untrusted');
  });

  test('status is read from PingOne and a provider SUCCESS records verification', async () => {
    mockMemory.set('transaction-789', { id: 'transaction-789', appUserId: USER_ID, pingOneUserId: USER_ID, expiresAt: FUTURE, verifiedAt: null });
    mockReadTransaction.mockResolvedValue({ id: 'transaction-789', status: 'SUCCESS', expiresAt: FUTURE });

    const res = await request(makeApp()).get('/api/verify/transactions/transaction-789?status=FAIL');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ id: 'transaction-789', status: 'SUCCESS', canEnrollRecognize: false }));
    expect(res.body.verifiedAt).toEqual(expect.any(String));
    expect(mockReadTransaction).toHaveBeenCalledWith({ pingOneUserId: USER_ID, transactionId: 'transaction-789' });
    expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ status: 'SUCCESS', verifiedAt: expect.any(String) }));
  });

  test.each(['APPROVED_MANUALLY', 'APPROVED_NO_REQUEST', 'NOT_REQUIRED', 'FAIL', 'UNKNOWN'])(
    '%s does not unlock Recognize', async (status) => {
      mockMemory.set('transaction-789', { id: 'transaction-789', appUserId: USER_ID, pingOneUserId: USER_ID, expiresAt: FUTURE, verifiedAt: null });
      mockReadTransaction.mockResolvedValue({ id: 'transaction-789', status, expiresAt: FUTURE });
      const res = await request(makeApp()).get('/api/verify/transactions/transaction-789');
      expect(res.status).toBe(200);
      expect(res.body.canEnrollRecognize).toBe(false);
      expect(res.body.verifiedAt).toBeNull();
    },
  );

  test('cannot read another customer transaction and cannot trust an unowned transaction id', async () => {
    mockMemory.set('transaction-789', { id: 'transaction-789', appUserId: OTHER_USER_ID, pingOneUserId: OTHER_USER_ID, expiresAt: FUTURE, verifiedAt: null });
    const res = await request(makeApp()).get('/api/verify/transactions/transaction-789');
    expect(res.status).toBe(404);
    expect(mockReadTransaction).not.toHaveBeenCalled();
  });

  test('marks an expired transaction expired without an upstream read', async () => {
    mockMemory.set('transaction-789', { id: 'transaction-789', appUserId: USER_ID, pingOneUserId: USER_ID, expiresAt: '2000-01-01T00:00:00.000Z', verifiedAt: null });
    const res = await request(makeApp()).get('/api/verify/transactions/transaction-789');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('EXPIRED');
    expect(res.body.canEnrollRecognize).toBe(false);
    expect(mockReadTransaction).not.toHaveBeenCalled();
  });

  test('disabled feature and incomplete config fail closed', async () => {
    mockConfig.set('pingone_verify_enabled', 'false');
    const disabled = await startVerification(makeApp());
    expect(disabled.status).toBe(404);
    expect(mockCreateTransaction).not.toHaveBeenCalled();

    mockConfig.set('pingone_verify_enabled', 'true');
    verifyService.isConfigured.mockReturnValue(false);
    const unavailable = await startVerification(makeApp());
    expect(unavailable.status).toBe(503);
    expect(unavailable.body.error).toBe('verify_not_configured');
  });

  test('provider failures are returned as normalized errors without upstream details', async () => {
    mockCreateTransaction.mockRejectedValueOnce(Object.assign(new Error('private provider detail'), {
      response: { data: { access_token: 'never-return-this' } },
    }));
    const create = await startVerification(makeApp());
    expect(create.status).toBe(502);
    expect(create.body).toEqual({ error: 'verify_transaction_create_failed' });
    expect(JSON.stringify(create.body)).not.toContain('never-return-this');

    mockMemory.set('transaction-789', { id: 'transaction-789', appUserId: USER_ID, pingOneUserId: USER_ID, expiresAt: FUTURE, verifiedAt: null });
    mockReadTransaction.mockRejectedValueOnce(Object.assign(new Error('private provider detail'), {
      response: { data: { access_token: 'never-return-this' } },
    }));
    const status = await request(makeApp()).get('/api/verify/transactions/transaction-789');
    expect(status.status).toBe(502);
    expect(status.body).toEqual({ error: 'verify_transaction_status_failed' });
    expect(JSON.stringify(status.body)).not.toContain('never-return-this');
  });
});
