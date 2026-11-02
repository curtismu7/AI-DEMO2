'use strict';
/**
 * GET /api/accounts/my — a token-only call keeps the caller's vertical.
 *
 * The MCP server answers get_my_accounts by calling this route with only the
 * user's token. With no session the route took the process-wide vertical as
 * the caller's, saw the user's accounts as a "mismatch" and switched them to
 * it: a session on banking whose agent read balances got another vertical's
 * accounts back, and its next transfer could not find "checking". The MCP
 * server now forwards the session's vertical as X-Active-Vertical; it is used
 * only when the request has no session vertical of its own, and only if it is
 * an activatable vertical.
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
    activationRefusal: jest.fn(),
  },
}));
jest.mock('../../services/verticalAccountSnapshots', () => ({ switchUserVertical: jest.fn() }));

const dataStore = require('../../data/store');
const { verticalManifest } = require('../../services/verticalManifest');
const { switchUserVertical } = require('../../services/verticalAccountSnapshots');
const router = require('../../routes/accounts');

function app({ sessionVertical } = {}) {
  const a = express();
  a.use((req, _res, next) => { req.session = sessionVertical ? { active_vertical: sessionVertical } : {}; next(); });
  a.use('/api/accounts', router);
  return a;
}

const PRIMARY = { banking: 'checking', workforce: 'pto balance' };

describe('GET /api/accounts/my — forwarded vertical', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // The process-wide default is workforce; the user's accounts are banking.
    verticalManifest.resolver.activeIdFor.mockImplementation((req) => req.session?.active_vertical || 'workforce');
    verticalManifest.loader.get.mockImplementation((id) => ({ manifest: { terminology: { accountTypes: [PRIMARY[id]] } } }));
    verticalManifest.activationRefusal.mockImplementation((id) => (PRIMARY[id] ? null : 'unknown'));
    dataStore.getAccountsByUserId.mockReturnValue([{ id: 'b1', accountType: 'checking', name: 'Checking', balance: 5000, currency: 'USD' }]);
  });

  test('a token-only call carrying the session vertical does not switch the accounts', async () => {
    const res = await request(app()).get('/api/accounts/my').set('X-Active-Vertical', 'banking').expect(200);
    expect(switchUserVertical).not.toHaveBeenCalled();
    expect(res.body.accounts[0].accountType).toBe('checking');
  });

  test('without the header, a token-only call still falls back to the global vertical (unchanged)', async () => {
    await request(app()).get('/api/accounts/my').expect(200);
    expect(switchUserVertical).toHaveBeenCalledWith('u1', 'workforce');
  });

  test('an unknown forwarded vertical is ignored', async () => {
    await request(app()).get('/api/accounts/my').set('X-Active-Vertical', 'atlantis').expect(200);
    expect(switchUserVertical).toHaveBeenCalledWith('u1', 'workforce');
  });

  test('a session vertical wins over the header', async () => {
    await request(app({ sessionVertical: 'workforce' })).get('/api/accounts/my').set('X-Active-Vertical', 'banking').expect(200);
    expect(switchUserVertical).toHaveBeenCalledWith('u1', 'workforce');
  });
});
