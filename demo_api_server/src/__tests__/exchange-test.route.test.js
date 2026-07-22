/**
 * @file exchange-test.route.test.js
 * POST /api/tokens/exchange-test — single vs double mode.
 */
'use strict';

jest.mock('../../services/mcpWebSocketClient', () => ({
  getSessionAccessToken: jest.fn(),
}));
jest.mock('../../services/oauthService', () => ({
  performTokenExchange: jest.fn(),
  config: { clientId: 'test-client', tokenEndpoint: 'https://example/as/token' },
}));
jest.mock('../../services/agentMcpTokenService', () => ({
  buildSessionPreviewTokenEvents: jest.fn(),
  buildTokenEvent: jest.fn(),
  decodeJwtClaims: jest.fn(),
  runTwoExchangeInteractiveTest: jest.fn(),
}));
jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn(() => null),
}));

const express = require('express');
const tokensRouter = require('../../routes/tokens');
const { getSessionAccessToken } = require('../../services/mcpWebSocketClient');
const oauthService = require('../../services/oauthService');
const agentMcpTokenService = require('../../services/agentMcpTokenService');

function makeJwt(claims) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.sig`;
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/tokens', tokensRouter);
  return app;
}

describe('POST /api/tokens/exchange-test', () => {
  let app;
  let server;
  const userJwt = makeJwt({
    sub: 'user-1',
    aud: 'enduser.ping.demo',
    scope: 'openid profile read write',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  beforeAll((done) => {
    app = createApp();
    server = app.listen(0, done);
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    getSessionAccessToken.mockReturnValue(userJwt);
  });

  /**
   * POST helper against the ephemeral server.
   * @param {object} body
   */
  async function postExchange(body) {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/tokens/exchange-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return { status: res.status, data };
  }

  it('returns login_required when no session token', async () => {
    getSessionAccessToken.mockReturnValue(null);
    const { status, data } = await postExchange({ mode: 'single', audience: 'mcpgateway.ping.demo' });
    expect(status).toBe(401);
    expect(data.code).toBe('login_required');
    expect(data.loginUrl).toContain('/token-exchange-tester');
  });

  it('single mode still requires audience and calls performTokenExchange', async () => {
    const mcpJwt = makeJwt({
      sub: 'user-1',
      aud: 'mcpgateway.ping.demo',
      scope: 'read write',
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    oauthService.performTokenExchange.mockResolvedValue(mcpJwt);

    const { status, data } = await postExchange({
      mode: 'single',
      audience: 'mcpgateway.ping.demo',
      scopes: ['read', 'write'],
    });

    expect(status).toBe(200);
    expect(data.mode).toBe('single');
    expect(data.success).toBe(true);
    expect(oauthService.performTokenExchange).toHaveBeenCalledWith(
      userJwt,
      'mcpgateway.ping.demo',
      ['read', 'write']
    );
    expect(agentMcpTokenService.runTwoExchangeInteractiveTest).not.toHaveBeenCalled();
  });

  it('double mode returns scrubbed two-ex steps from runTwoExchangeInteractiveTest', async () => {
    agentMcpTokenService.runTwoExchangeInteractiveTest.mockResolvedValue({
      success: true,
      mcpResourceUri: 'mcpgateway.ping.demo',
      subjectClaims: { sub: 'user-1', aud: 'enduser.ping.demo' },
      finalClaims: {
        sub: 'user-1',
        aud: 'mcpgateway.ping.demo',
        act: { sub: 'agent-client' },
        exp: Math.floor(Date.now() / 1000) + 600,
      },
      tokenEvents: [
        { id: 'two-ex-agent-actor', label: 'Agent Actor', status: 'active', claims: { sub: 'agent' } },
        { id: 'two-ex-exchange1', label: 'Exchange #1', status: 'exchanged', claims: { aud: 'agentgateway.ping.demo' } },
        { id: 'user-token', label: 'ignore', status: 'active' },
        { id: 'two-ex-final-token', label: 'Final MCP', status: 'exchanged', claims: { aud: 'mcpgateway.ping.demo' } },
      ],
    });

    const { status, data } = await postExchange({
      mode: 'double',
      scopes: ['read', 'write'],
    });

    expect(status).toBe(200);
    expect(data.mode).toBe('double');
    expect(data.success).toBe(true);
    expect(data.steps).toHaveLength(3);
    expect(data.steps.every((s) => String(s.id).startsWith('two-ex-'))).toBe(true);
    expect(oauthService.performTokenExchange).not.toHaveBeenCalled();
    expect(agentMcpTokenService.runTwoExchangeInteractiveTest).toHaveBeenCalled();
  });
});
