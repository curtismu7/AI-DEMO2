'use strict';
/**
 * GET /api/investment/accounts/:accountId/{portfolio,balance} must validate the
 * requested account.
 *
 * Both routes ignored :accountId, calling store.get(req.user.id) and returning
 * the caller's default portfolio (200) while echoing back whatever id was asked
 * for. An unknown/other account id now returns 404; the caller's real account
 * (profile.portfolioId, the id GET /accounts returns) still resolves.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../../middleware/auth', () => ({
  authenticateToken: (req, _res, next) => { req.user = { id: 'u1' }; next(); },
  requireScopes: () => (_req, _res, next) => next(),
}));

const { createInvestmentStore } = require('../../config/verticals/investment/data');
const store = createInvestmentStore();

jest.mock('../../services/verticalDispatch', () => ({ resolvePlugin: jest.fn() }));
const verticalDispatch = require('../../services/verticalDispatch');
verticalDispatch.resolvePlugin.mockReturnValue({ getDataStore: () => store });

const router = require('../../routes/investment');

const app = express();
app.use('/api/investment', router);

const OWN_ID = store.get('u1').profile.portfolioId; // INV-8842

describe('investment routes validate :accountId ownership', () => {
  test('portfolio: caller\'s own account id resolves (200)', async () => {
    const res = await request(app).get(`/api/investment/accounts/${OWN_ID}/portfolio`).expect(200);
    expect(res.body.accountId).toBe(OWN_ID);
    expect(res.body.portfolioId).toBe(OWN_ID);
  });

  test('portfolio: unknown account id returns 404', async () => {
    const res = await request(app).get('/api/investment/accounts/NOT-MINE/portfolio').expect(404);
    expect(res.body.status).toBe('not_found');
    expect(res.body.accountId).toBe('NOT-MINE');
  });

  test('balance: caller\'s own account id resolves (200)', async () => {
    const res = await request(app).get(`/api/investment/accounts/${OWN_ID}/balance`).expect(200);
    expect(res.body.accountId).toBe(OWN_ID);
    expect(Array.isArray(res.body.holdings)).toBe(true);
  });

  test('balance: unknown account id returns 404', async () => {
    const res = await request(app).get('/api/investment/accounts/NOT-MINE/balance').expect(404);
    expect(res.body.status).toBe('not_found');
  });
});
