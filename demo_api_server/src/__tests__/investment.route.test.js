/**
 * @file investment.route.test.js
 * HTTP-level tests for the four /api/investment routes
 * demo_mcp_resource_server/src/tools/investToolHandler.ts calls. /portfolio was
 * the only one implemented; get_investment_accounts/balance/transactions 404'd
 * on every call.
 */

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth', () => ({
  authenticateToken: (req, res, next) => {
    const h = req.headers['x-test-user'];
    if (!h) return res.status(401).json({ error: 'authentication_required' });
    req.user = JSON.parse(h);
    return next();
  },
  requireScopes: () => (req, res, next) => next(),
}));

const investmentRouter = require('../../routes/investment');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/investment', investmentRouter);
  return app;
}

const userHeader = (id) => JSON.stringify({ id, role: 'user', scopes: ['read'] });

describe('GET /api/investment/accounts/:accountId/portfolio', () => {
  it('returns the user\'s portfolio summary from the shared investment store', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/api/investment/accounts/PF-01/portfolio')
      .set('x-test-user', userHeader('user-1'));

    expect(res.status).toBe(200);
    expect(res.body.accountId).toBe('PF-01');
    expect(typeof res.body.totalValue).toBe('number');
    expect(Array.isArray(res.body.portfolios)).toBe(true);
    expect(res.body.portfolios.length).toBeGreaterThan(0);
  });

  it('requires authentication', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/investment/accounts/PF-01/portfolio');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/investment/accounts', () => {
  it('lists the user\'s single investment account', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/api/investment/accounts')
      .set('x-test-user', userHeader('user-1'));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.accounts)).toBe(true);
    expect(res.body.accounts.length).toBe(1);
    expect(res.body.accounts[0].id).toBe('INV-8842');
    expect(typeof res.body.accounts[0].totalValue).toBe('number');
  });

  it('requires authentication', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/investment/accounts');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/investment/accounts/:accountId/balance', () => {
  it('returns balance and holdings', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/api/investment/accounts/INV-8842/balance')
      .set('x-test-user', userHeader('user-1'));

    expect(res.status).toBe(200);
    expect(res.body.accountId).toBe('INV-8842');
    expect(typeof res.body.totalValue).toBe('number');
    expect(Array.isArray(res.body.holdings)).toBe(true);
    expect(res.body.holdings.length).toBeGreaterThan(0);
  });

  it('requires authentication', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/investment/accounts/INV-8842/balance');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/investment/accounts/:accountId/transactions', () => {
  it('returns recent transactions, defaulting the limit to 20', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/api/investment/accounts/INV-8842/transactions')
      .set('x-test-user', userHeader('user-1'));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.transactions)).toBe(true);
    expect(res.body.transactions.length).toBeGreaterThan(0);
  });

  it('honours a caller-supplied limit', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/api/investment/accounts/INV-8842/transactions?limit=1')
      .set('x-test-user', userHeader('user-1'));

    expect(res.status).toBe(200);
    expect(res.body.transactions.length).toBe(1);
  });

  it('clamps a garbage limit back to the default', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/api/investment/accounts/INV-8842/transactions?limit=not-a-number')
      .set('x-test-user', userHeader('user-1'));

    expect(res.status).toBe(200);
    expect(res.body.transactions.length).toBeGreaterThan(0);
  });

  it('requires authentication', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/investment/accounts/INV-8842/transactions');
    expect(res.status).toBe(401);
  });
});
