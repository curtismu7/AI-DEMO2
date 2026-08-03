/**
 * @file investment.route.test.js
 * HTTP-level test for GET /api/investment/accounts/:accountId/portfolio — the
 * route the A2A Investment Advisor specialist's get_portfolio_summary tool
 * calls (demo_mcp_resource_server/src/tools/investToolHandler.ts). Previously missing
 * entirely, so every A2A portfolio-summary delegation 404'd silently.
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
