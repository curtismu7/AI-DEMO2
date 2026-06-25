/**
 * Route tests for the Client Credentials Resource Server Tester.
 * Verifies the route is open to any authenticated user (no admin gate) and the
 * token-resolution paths (server-fetched CC token vs pasted JWT), plus the reveal path.
 * The validation logic itself is covered by resourceServerTester.test.js.
 */
const express = require('express');
const request = require('supertest');

// Mock the CC token fetch and the tester service so the route's own behavior is isolated.
jest.mock('../../services/oauthService', () => ({
  getAgentClientCredentialsToken: jest.fn(),
}));
jest.mock('../../services/resourceServerTesterService', () => ({
  validate: jest.fn(),
  decode: jest.fn(),
  probe: jest.fn(),
  reveal: jest.fn(),
}));

const oauthService = require('../../services/oauthService');
const tester = require('../../services/resourceServerTesterService');
const ccRouter = require('../../routes/resourceServerTesterCC');

function makeApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/resource-server-cc/test', ccRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  tester.validate.mockResolvedValue({ decision: 'REJECT', rules: [], claims: {} });
  tester.decode.mockReturnValue({ decision: 'WOULD_REJECT', rules: [], claims: {} });
  tester.probe.mockResolvedValue({ status: 401, statusText: 'Unauthorized', headers: {}, body: {} });
  tester.reveal.mockReturnValue({ source: 'cc', label: 'Client Credentials token', token: 'cc.tok', header: {}, claims: {} });
});

describe('open to any authenticated user (no admin gate)', () => {
  test('a non-admin (customer) user can run the tester', async () => {
    oauthService.getAgentClientCredentialsToken.mockResolvedValue('cc.fetched.token');
    const res = await request(makeApp({ role: 'customer' })).post('/api/resource-server-cc/test/validate').send({});
    expect(res.status).toBe(200);
    expect(tester.validate).toHaveBeenCalledWith('cc.fetched.token');
  });
});

describe('token resolution', () => {
  const user = { role: 'customer' };

  test('fetches a CC token server-side when nothing is pasted', async () => {
    oauthService.getAgentClientCredentialsToken.mockResolvedValue('cc.fetched.token');
    const res = await request(makeApp(user)).post('/api/resource-server-cc/test/validate').send({});
    expect(res.status).toBe(200);
    expect(oauthService.getAgentClientCredentialsToken).toHaveBeenCalledTimes(1);
    expect(tester.validate).toHaveBeenCalledWith('cc.fetched.token');
  });

  test('uses the pasted JWT and does NOT fetch a CC token', async () => {
    const res = await request(makeApp(user)).post('/api/resource-server-cc/test/decode').send({ tokenRaw: '  paste.me.now  ' });
    expect(res.status).toBe(200);
    expect(oauthService.getAgentClientCredentialsToken).not.toHaveBeenCalled();
    expect(tester.decode).toHaveBeenCalledWith('paste.me.now');
  });

  test('502 when the CC token fetch fails', async () => {
    oauthService.getAgentClientCredentialsToken.mockRejectedValue(new Error('worker creds missing'));
    const res = await request(makeApp(user)).post('/api/resource-server-cc/test/validate').send({});
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('cc_token_unavailable');
    expect(tester.validate).not.toHaveBeenCalled();
  });

  test('probe forwards the targetPath', async () => {
    oauthService.getAgentClientCredentialsToken.mockResolvedValue('cc.tok');
    const res = await request(makeApp(user)).post('/api/resource-server-cc/test/probe').send({ targetPath: '/api/resource-server/accounts' });
    expect(res.status).toBe(200);
    expect(tester.probe).toHaveBeenCalledWith('cc.tok', '/api/resource-server/accounts');
  });
});

describe('reveal', () => {
  const user = { role: 'customer' };

  test('returns the raw CC token + claims (source=cc) when nothing is pasted', async () => {
    oauthService.getAgentClientCredentialsToken.mockResolvedValue('cc.fetched.token');
    const res = await request(makeApp(user)).post('/api/resource-server-cc/test/reveal').send({});
    expect(res.status).toBe(200);
    expect(tester.reveal).toHaveBeenCalledWith('cc.fetched.token', 'cc');
    expect(res.body.token).toBe('cc.tok'); // not scrubbed — raw token is the point
  });

  test('labels a pasted token as source=pasted', async () => {
    const res = await request(makeApp(user)).post('/api/resource-server-cc/test/reveal').send({ tokenRaw: 'paste.me.now' });
    expect(res.status).toBe(200);
    expect(oauthService.getAgentClientCredentialsToken).not.toHaveBeenCalled();
    expect(tester.reveal).toHaveBeenCalledWith('paste.me.now', 'pasted');
  });
});
