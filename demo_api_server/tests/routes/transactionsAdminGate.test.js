'use strict';
/**
 * GET /, PUT /:id and DELETE /:id on /api/transactions are admin-only. Pins the
 * exact non-admin response, and that the store is never touched, so the gate
 * can move between an inline check and a named guard without changing what a
 * caller sees.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../../middleware/auth', () => ({
  authenticateToken: (req, _res, next) => {
    req.user = JSON.parse(req.headers['x-test-user']);
    next();
  },
  requireScopes: () => (_req, _res, next) => next(),
  requireNotAdmin: (_req, _res, next) => next(),
}));
jest.mock('../../middleware/demoMode', () => ({
  blockInDemoMode: () => (_req, _res, next) => next(),
}));
jest.mock('../../services/configStore', () => ({ getEffective: jest.fn() }));
jest.mock('../../data/store', () => ({
  getAllTransactions: jest.fn(() => [{ id: 't1', userId: 'u1', amount: 5 }]),
  getAllUsers: jest.fn(() => [{ id: 'u1', firstName: 'Ada', lastName: 'Lovelace', username: 'ada', email: 'ada@example.com' }]),
  updateTransaction: jest.fn(async (id, body) => ({ id, ...body })),
  deleteTransaction: jest.fn(async () => true),
}));

const dataStore = require('../../data/store');
const transactionsRoutes = require('../../routes/transactions');

const app = express();
app.use(express.json());
app.use('/api/transactions', transactionsRoutes);

const as = (role) => JSON.stringify({ id: 'u1', role });
const DENIED = { error: 'Access denied. Admin role required.' };

describe('admin-only transaction routes', () => {
  beforeEach(() => jest.clearAllMocks());

  test.each([
    ['get', '/api/transactions'],
    ['put', '/api/transactions/t1'],
    ['delete', '/api/transactions/t1'],
  ])('%s %s: a non-admin gets 403 and the store is never touched', async (verb, path) => {
    const res = await request(app)[verb](path).set('x-test-user', as('customer'));
    expect(res.status).toBe(403);
    expect(res.body).toEqual(DENIED);
    expect(dataStore.getAllTransactions).not.toHaveBeenCalled();
    expect(dataStore.updateTransaction).not.toHaveBeenCalled();
    expect(dataStore.deleteTransaction).not.toHaveBeenCalled();
  });

  test('GET /: an admin gets the list', async () => {
    const res = await request(app).get('/api/transactions').set('x-test-user', as('admin'));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.transactions[0]).toMatchObject({ id: 't1', performedBy: 'Ada Lovelace', ownerUsername: 'ada' });
  });

  test('PUT /:id: an admin updates', async () => {
    const res = await request(app).put('/api/transactions/t1').set('x-test-user', as('admin')).send({ amount: 9 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Transaction updated successfully', transaction: { id: 't1', amount: 9 } });
  });

  test('DELETE /:id: an admin deletes', async () => {
    const res = await request(app).delete('/api/transactions/t1').set('x-test-user', as('admin'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Transaction deleted successfully' });
  });
});
