'use strict';
/**
 * GET /api/accounts/my — banking identifiers must not leak into other verticals.
 *
 * The response mapping applied `swiftCode||'CHASUS33'`, `branchName||'Super
 * Banking Main Branch'`, `branchCode||'001'`, iban and a masked-accountNumber
 * fallback unconditionally, so a healthcare/retail/workforce account was stamped
 * with banking identifiers it never had. Those fields are now emitted (with
 * defaults) only for the banking vertical; other verticals surface them only
 * when the account genuinely carries them. Banking output is unchanged.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../../middleware/auth', () => ({
  authenticateToken: (req, _res, next) => { req.user = { id: 'u1', sub: 'u1', name: 'Pat Doe' }; next(); },
  requireScopes: () => (_req, _res, next) => next(),
  requireNotBankDelegate: () => (_req, _res, next) => next(),
  requireNotAdmin: (_req, _res, next) => next(),
}));
jest.mock('../../middleware/demoMode', () => ({ blockInDemoMode: () => (_req, _res, next) => next() }));
jest.mock('../../data/store', () => ({ getAccountsByUserId: jest.fn() }));
jest.mock('../../services/demoScenarioStore', () => ({ load: jest.fn(async () => ({})), save: jest.fn(async () => {}) }));
jest.mock('../../services/posthog', () => ({ capture: jest.fn() }));
jest.mock('../../services/verticalManifest', () => ({
  verticalManifest: {
    resolver: { activeIdFor: jest.fn() },
    loader: { get: jest.fn() },
  },
}));
jest.mock('../../services/verticalAccountSnapshots', () => ({ switchUserVertical: jest.fn() }));

const dataStore = require('../../data/store');
const { verticalManifest } = require('../../services/verticalManifest');
const router = require('../../routes/accounts');

const app = express();
app.use('/api/accounts', router);

describe('GET /api/accounts/my — vertical-scoped banking identifiers', () => {
  beforeEach(() => jest.clearAllMocks());

  test('non-banking (healthcare) account omits fabricated banking identifiers', async () => {
    verticalManifest.resolver.activeIdFor.mockReturnValue('healthcare');
    verticalManifest.loader.get.mockReturnValue({ manifest: { terminology: { accountTypes: ['policy'] } } });
    dataStore.getAccountsByUserId.mockReturnValue([
      { id: 'a1', accountType: 'policy', name: 'Health Plan', balance: 0, currency: 'USD' },
    ]);

    const res = await request(app).get('/api/accounts/my').expect(200);
    const acct = res.body.accounts[0];

    expect(acct.swiftCode).toBeUndefined();
    expect(acct.iban).toBeUndefined();
    expect(acct.branchName).toBeUndefined();
    expect(acct.branchCode).toBeUndefined();
    expect(acct.accountNumber).toBeUndefined();
    // Real fields still present.
    expect(acct.accountType).toBe('policy');
    expect(acct.name).toBe('Health Plan');
  });

  test('banking account output keeps the banking identifiers (unchanged)', async () => {
    verticalManifest.resolver.activeIdFor.mockReturnValue('banking');
    verticalManifest.loader.get.mockReturnValue({ manifest: { terminology: { accountTypes: ['CHECKING'] } } });
    dataStore.getAccountsByUserId.mockReturnValue([
      { id: 'b1', accountType: 'CHECKING', name: 'Checking', balance: 5000, currency: 'USD' },
    ]);

    const res = await request(app).get('/api/accounts/my').expect(200);
    const acct = res.body.accounts[0];

    expect(acct.swiftCode).toBe('CHASUS33');
    expect(acct.branchName).toBe('Super Banking Main Branch');
    expect(acct.branchCode).toBe('001');
    expect(acct.iban).toBe('');
    expect(acct.accountNumber).toBe('****');
  });
});
