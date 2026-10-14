const express = require('express');
const request = require('supertest');

jest.mock('../../../services/oboExchangeService', () => ({ runObo: jest.fn() }));
const { runObo } = require('../../../services/oboExchangeService');
const oboRouter = require('../../../routes/obo');

function app(session = {}) {
  const a = express();
  a.use(express.json());
  a.use((req, res, next) => { req.session = session; next(); });
  a.use('/api/obo', oboRouter);
  return a;
}

beforeEach(() => runObo.mockReset());

test('401 without a signed-in session, and the exchange is never attempted', async () => {
  const res = await request(app({})).post('/api/obo/run');
  expect(res.status).toBe(401);
  expect(runObo).not.toHaveBeenCalled();
});

test('401 when the session holds only the cookie placeholder', async () => {
  const res = await request(app({ oauthTokens: { accessToken: '_cookie_session' } })).post('/api/obo/run');
  expect(res.status).toBe(401);
});

test('returns the evidence object from the signed-in session token', async () => {
  runObo.mockResolvedValue({ source: 'page', checks: [{ id: 'sub', pass: true }] });
  const res = await request(app({ oauthTokens: { accessToken: 'tok-sess' } })).post('/api/obo/run');
  expect(res.status).toBe(200);
  expect(res.body.checks).toEqual([{ id: 'sub', pass: true }]);
  expect(runObo).toHaveBeenCalledWith(expect.objectContaining({ subjectToken: 'tok-sess', source: 'page' }));
});

test('503 with a plain message when PingOne is not configured, and no internal detail', async () => {
  runObo.mockRejectedValue(Object.assign(new Error('OBO demo not configured (Token Exchanger or AI Agent client missing)'), { code: 'obo_not_configured', httpStatus: 503 }));
  const res = await request(app({ oauthTokens: { accessToken: 'tok-sess' } })).post('/api/obo/run');
  expect(res.status).toBe(503);
  expect(res.body.error).toMatch(/not configured/);
  expect(JSON.stringify(res.body)).not.toMatch(/Token Exchanger|client/);
});

test('502 with no upstream detail on any other failure', async () => {
  runObo.mockRejectedValue(new Error('exchange 400 invalid_grant tok-sess'));
  const res = await request(app({ oauthTokens: { accessToken: 'tok-sess' } })).post('/api/obo/run');
  expect(res.status).toBe(502);
  expect(JSON.stringify(res.body)).not.toMatch(/tok-sess|invalid_grant/);
});
