/**
 * @file accounts-cold-start.test.js
 * @description Tests for STAB-02: cold-start account restoration via KV snapshot.
 *
 * Covers GET /accounts/my when the in-memory dataStore is empty (Vercel cold-start),
 * verifying that stored snapshots are restored and provisioning falls back correctly.
 */

'use strict';

const request = require('supertest');
const express = require('express');

// ─── Mutable state shared across mocks ───────────────────────────────────────
const _state = {
  accounts: [],
  snapshot: null, // null = not configured, [] = empty, [...] = accounts to restore
};

// ─── Mock: data/store ─────────────────────────────────────────────────────────
jest.mock('../../data/store', () => ({
  getAccountsByUserId: jest.fn((userId) => _state.accounts.filter((a) => a.userId === userId)),
  getAccountById: jest.fn((id) => _state.accounts.find((a) => a.id === id) || null),
  createAccount: jest.fn(async (data) => {
    const acct = { ...data };
    _state.accounts.push(acct);
    return acct;
  }),
  deleteAccount: jest.fn(async (id) => {
    _state.accounts = _state.accounts.filter((a) => a.id !== id);
  }),
  getTransactionsByUserId: jest.fn(() => []),
  deleteTransaction: jest.fn(async () => {}),
  createTransaction: jest.fn(async (data) => data),
  getAllAccounts: jest.fn(() => _state.accounts),
  // Vertical-aware reseeding path used by GET /my when the snapshot is empty
  // (replaced the legacy provisionDemoAccounts call in the verticals cutover).
  reseedAllCustomersForVertical: jest.fn(async () => {
    _state.accounts = [
      { id: 'chk-u1', userId: 'u1', accountType: 'checking', name: 'Checking', balance: 5000, currency: 'USD' },
      { id: 'sav-u1', userId: 'u1', accountType: 'savings',  name: 'Savings',  balance: 2000, currency: 'USD' },
    ];
  }),
  // Per-user (session-scoped) reseed — GET /my now reseeds only the requesting
  // user for their session's vertical instead of all customers.
  reseedUserForVertical: jest.fn(async (userId) => {
    _state.accounts = _state.accounts.filter((a) => a.userId !== userId);
    _state.accounts.push(
      { id: `chk-${userId}`, userId, accountType: 'checking', name: 'Checking', balance: 5000, currency: 'USD' },
      { id: `sav-${userId}`, userId, accountType: 'savings',  name: 'Savings',  balance: 2000, currency: 'USD' },
    );
  }),
  // GET /my iterates dataStore.users.values() to snapshot every customer.
  users: new Map([['u1', { id: 'u1', role: 'customer' }]]),
}));

// ─── Mock: demoScenarioStore ──────────────────────────────────────────────────
jest.mock('../../services/demoScenarioStore', () => ({
  load: jest.fn(async () => ({
    accountSnapshot: _state.snapshot,
  })),
  save: jest.fn(async () => {}),
  isPersistenceConfigured: jest.fn(() => true),
}));

// ─── Mock: middleware/auth — bypass token verification ───────────────────────
jest.mock('../../middleware/auth', () => ({
  requireNotBankDelegate: () => (req, res, next) => next(),
  authenticateToken: (req, res, next) => next(),
  requireNotAdmin: (_req, _res, next) => next(),
  requireSession: (req, res, next) => next(),
  requireScopes: () => (req, res, next) => next(),
}));

// ─── Mock: middleware/demoMode ────────────────────────────────────────────────
jest.mock('../../middleware/demoMode', () => ({
  blockInDemoMode: (_label) => (req, res, next) => next(),
}));

// ─── SUT ──────────────────────────────────────────────────────────────────────
const dataStore = require('../../data/store');
const demoScenarioStore = require('../../services/demoScenarioStore');
const accountsRouter = require('../../routes/accounts');

const SNAPSHOT_3 = [
  { id: 'chk-001', accountType: 'checking',    accountNumber: '001', name: 'Checking',    balance: 5000,   currency: 'USD', isActive: true },
  { id: 'sav-001', accountType: 'savings',     accountNumber: '002', name: 'Savings',     balance: 3000,   currency: 'USD', isActive: true },
  { id: 'inv-001', accountType: 'investment',  accountNumber: '003', name: 'Investments', balance: 10000,  currency: 'USD', isActive: true },
  // loan + credit card included so the banking top-up is a no-op and counts stay predictable
  { id: 'loan-u1', accountType: 'loan',        accountNumber: '004', name: 'Car Loan',    balance: -12000, currency: 'USD', isActive: true },
  { id: 'cc-u1',   accountType: 'credit_card', accountNumber: '005', name: 'Credit Card', balance: -1850,  currency: 'USD', isActive: true },
];

function makeApp(userId = 'u1') {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: userId, role: 'customer', sub: userId };
    req.sessionID = 'sess-test';
    next();
  });
  app.use('/accounts', accountsRouter);
  return app;
}

beforeEach(() => {
  _state.accounts = [];
  _state.snapshot = null;
  jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /accounts/my — cold-start account restoration (STAB-02)', () => {

  it('Test A: restores 5 accounts from snapshot when dataStore is empty', async () => {
    _state.snapshot = [...SNAPSHOT_3];
    // dataStore starts empty (cold-start); SNAPSHOT_3 includes loan + credit card so no extras created

    const res = await request(makeApp()).get('/accounts/my');

    expect(res.status).toBe(200);
    expect(res.body.accounts).toHaveLength(5);
  });

  it('Test B: each snapshot account not in dataStore triggers createAccount (cold-start path)', async () => {
    _state.snapshot = [...SNAPSHOT_3];
    // getAccountById returns null for all (not yet in memory); SNAPSHOT_3 has 5 accounts

    await request(makeApp()).get('/accounts/my');

    // Should have called createAccount once per snapshot account (5 accounts in SNAPSHOT_3)
    expect(dataStore.createAccount).toHaveBeenCalledTimes(5);
  });

  it('Test C: no snapshot → vertical reseed runs and snapshot is saved', async () => {
    _state.snapshot = []; // empty snapshot → falls through to vertical-aware reseed

    const res = await request(makeApp()).get('/accounts/my');

    // After reseeding, demoScenarioStore.save is called per customer with accountSnapshot.
    expect(demoScenarioStore.save).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({
        accountSnapshot: expect.any(Array),
      })
    );
    // Reseed gives checking + savings
    expect(res.body.accounts.length).toBeGreaterThanOrEqual(2);
  });

  it('Test D: warm instance (non-empty dataStore) does NOT call demoScenarioStore.load', async () => {
    // Pre-populate in-memory store — simulates warm Lambda.
    // Loan + credit card included so the banking top-up is a no-op (no saveAccountSnapshot call).
    _state.accounts = [
      { id: 'chk-w1',  userId: 'u1', accountType: 'checking',    name: 'Checking',    balance: 5000,   currency: 'USD' },
      { id: 'sav-w1',  userId: 'u1', accountType: 'savings',     name: 'Savings',     balance: 2000,   currency: 'USD' },
      { id: 'loan-u1', userId: 'u1', accountType: 'loan',        name: 'Car Loan',    balance: -12000, currency: 'USD' },
      { id: 'cc-u1',   userId: 'u1', accountType: 'credit_card', name: 'Credit Card', balance: -1850,  currency: 'USD' },
    ];

    const res = await request(makeApp()).get('/accounts/my');

    // Warm path: dataStore already has accounts, snapshot load skipped
    expect(demoScenarioStore.load).not.toHaveBeenCalled();
    expect(res.body.accounts).toHaveLength(4);
  });

  it('Test E-loan: car loan added when user has checking+savings but no loan account', async () => {
    // 340ffed2: addMissingLoanAccount() called from GET /my when user has
    // checking+savings but no loan — must add the loan without wiping other accounts.
    _state.accounts = [
      { id: 'chk-u1', userId: 'u1', accountType: 'checking', name: 'Checking', balance: 5000, currency: 'USD' },
      { id: 'sav-u1', userId: 'u1', accountType: 'savings',  name: 'Savings',  balance: 2000, currency: 'USD' },
    ];

    const res = await request(makeApp()).get('/accounts/my');

    expect(res.status).toBe(200);
    const types = res.body.accounts.map((a) => a.accountType);
    expect(types).toContain('loan');
    // Original accounts must still be present
    expect(types).toContain('checking');
    expect(types).toContain('savings');
  });

  it('Test E-loan-no-dupe: car loan NOT added when user already has one', async () => {
    const loanId = `loan-${('u1').replace(/-/g, '').slice(0, 10)}`;
    _state.accounts = [
      { id: 'chk-u1', userId: 'u1', accountType: 'checking', name: 'Checking', balance: 5000, currency: 'USD' },
      { id: 'sav-u1', userId: 'u1', accountType: 'savings',  name: 'Savings',  balance: 2000, currency: 'USD' },
      { id: loanId,   userId: 'u1', accountType: 'loan',     name: 'Car Loan', balance: -12000, currency: 'USD' },
    ];

    const callsBefore = dataStore.createAccount.mock.calls.length;
    await request(makeApp()).get('/accounts/my');
    // createAccount must not be called for the loan (already exists)
    const loanCreates = dataStore.createAccount.mock.calls
      .slice(callsBefore)
      .filter(([d]) => d.accountType === 'loan');
    expect(loanCreates).toHaveLength(0);
  });

  it('Test E: snapshot with investment account re-creates it with accountType=investment', async () => {
    _state.snapshot = [
      { id: 'inv-001', accountType: 'investment', accountNumber: '003', name: 'Investments', balance: 10000, currency: 'USD', isActive: true },
    ];

    await request(makeApp()).get('/accounts/my');

    const investmentCreateCall = dataStore.createAccount.mock.calls.find(
      ([data]) => data.accountType === 'investment'
    );
    expect(investmentCreateCall).toBeDefined();
    expect(investmentCreateCall[0].id).toBe('inv-001');
  });
});
