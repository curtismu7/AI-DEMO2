'use strict';
/**
 * GET /api/demo-scenario — restoreAccountsFromSnapshot() must not swallow a
 * genuine demoScenarioStore.load() failure (LMDB env-open/read error) into
 * the same "[]" result as the legitimate "no snapshot exists" case. Doing so
 * caused the handler to fall through to provisionDemoAccounts() + save the
 * fresh defaults over the real (unreadable, not missing) snapshot — a
 * permanent, silent data loss on a transient store failure.
 *
 * finding #72
 */

const request = require('supertest');
const express = require('express');

jest.mock('../../middleware/auth', () => ({
  authenticateToken: (req, _res, next) => { req.user = { id: 'u1', sub: 'u1' }; next(); },
}));
jest.mock('../../data/store', () => ({
  getAccountsByUserId: jest.fn(() => []),
  getUserById: jest.fn(() => ({ id: 'u1' })),
  getAccountById: jest.fn(),
  createAccount: jest.fn(),
}));
jest.mock('../../services/demoScenarioStore', () => ({
  load: jest.fn(),
  save: jest.fn(async () => {}),
  isPersistenceConfigured: jest.fn(() => true),
}));
jest.mock('../../routes/accounts', () => ({
  provisionDemoAccounts: jest.fn(async () => [
    { id: 'fresh-1', accountType: 'checking', accountNumber: 'CHK1', name: 'Checking Account', balance: 3000, currency: 'USD' },
  ]),
}));

const dataStore = require('../../data/store');
const demoScenarioStore = require('../../services/demoScenarioStore');
const accountsRouter = require('../../routes/accounts');
const { authenticateToken } = require('../../middleware/auth');
const router = require('../../routes/demoScenario');

const app = express();
app.use('/api/demo-scenario', authenticateToken, router);

describe('GET /api/demo-scenario — cold-start snapshot restore', () => {
  beforeEach(() => jest.clearAllMocks());

  test('legitimate "no snapshot" case still reprovisions cleanly (no regression)', async () => {
    dataStore.getAccountsByUserId.mockReturnValue([]);
    demoScenarioStore.load.mockResolvedValue({}); // no accountSnapshot key = genuinely never saved

    const res = await request(app).get('/api/demo-scenario').expect(200);

    expect(res.body.accounts).toHaveLength(1);
    expect(res.body.accounts[0].id).toBe('fresh-1');
    expect(accountsRouter.provisionDemoAccounts).toHaveBeenCalledWith('u1');
    expect(demoScenarioStore.save).toHaveBeenCalled(); // saveAccountSnapshot persisted the fresh defaults
  });

  test('a genuine LMDB read error is NOT treated as "no snapshot" — never overwrites the real snapshot', async () => {
    dataStore.getAccountsByUserId.mockReturnValue([]);
    demoScenarioStore.load.mockRejectedValue(new Error('MDB_INVALID: unable to open database environment'));

    const res = await request(app).get('/api/demo-scenario').expect(500);

    expect(res.body.error).toBe('demo_scenario_failed');
    // The crux of the fix: a transient read failure must never fall through to
    // reprovisioning defaults and persisting them over the (unreadable, not
    // missing) real snapshot.
    expect(accountsRouter.provisionDemoAccounts).not.toHaveBeenCalled();
    expect(demoScenarioStore.save).not.toHaveBeenCalled();
  });
});
